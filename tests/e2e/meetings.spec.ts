import { expect, test, type Page } from '@playwright/test';
import type { Library } from '../../src/schema/library';
import { isCompact, LIBRARY_KEY, mockRoutes, mockSearch, seedStorage, seedJson } from './fixtures';

declare global {
  interface Window {
    meetingLinks: string[];
  }
}

/** 공유 창 대신 주소만 기록한다. 외부 앱이나 실제 네트워크를 사용하지 않는다. */
async function captureShares(page: Page) {
  await page.addInitScript(() => {
    const state = window;
    state.meetingLinks = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        if (data.url) state.meetingLinks.push(data.url);
      },
    });
  });
}
async function sharedLink(page: Page, button: string, kind: 'd' | 'r' | 'f') {
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.meetingLinks.at(-1) ?? ''))
    .toContain(`/meet#${kind}=`);
  return page.evaluate(() => window.meetingLinks.at(-1)!);
}
const localLink = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.hash}`;
};
async function addParticipant(page: Page, name: string) {
  await page.getByRole('button', { name: '참석자 추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '참석자 추가' });
  await dialog.getByRole('textbox', { name: '참석자 이름' }).fill(name);
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(dialog).toBeHidden();
}

// 새 약속이 생겨도 원래의 보관함 시드는 유지하고, 한 카페만 시험 역 1km 안에 놓는다.
async function seedMeetingLibrary(page: Page) {
  await seedStorage(page, { library: false });
  await page.addInitScript(
    ({ key, json }) => {
      if (localStorage.getItem(key) !== null) return;
      const library = JSON.parse(json) as {
        places: Record<string, { name: { value: string }; lng: number; lat: number }>;
      };
      const cafe = Object.values(library.places).find((p) => p.name.value === '성수동 카페거리');
      if (cafe) {
        cafe.lng = 127.921887;
        cafe.lat = 37.315942;
      }
      localStorage.setItem(key, JSON.stringify(library));
    },
    { key: LIBRARY_KEY, json: seedJson },
  );
}

test('@smoke 약속 만들기부터 친구 답장 반영·집계·확정 길찾기까지 이어진다', async ({
  page,
  browser,
  baseURL,
}) => {
  await seedMeetingLibrary(page);
  await mockSearch(page);
  const calls = await mockRoutes(page);
  await captureShares(page);
  await page.goto('/meetings');
  await page.getByRole('button', { name: '새 약속', exact: true }).click();
  const form = page.getByRole('dialog', { name: '새 약속', exact: true });
  await form.getByRole('textbox', { name: '약속 이름' }).fill('주말 모임');
  await form.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings\/[a-z0-9]{10}$/);
  const editorPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: '나 출발지 고르기', exact: true }).click();
  let picker = page.getByRole('dialog', { name: '출발지 고르기' });
  await picker.getByRole('searchbox', { name: '출발지 검색' }).fill('원주');
  await picker.getByRole('button', { name: /^원주 출발 / }).click();
  await addParticipant(page, '보관함 친구');
  await page.getByRole('button', { name: '보관함 친구 출발지 고르기', exact: true }).click();
  picker = page.getByRole('dialog', { name: '출발지 고르기' });
  await picker.getByRole('tab', { name: '보관함에서', exact: true }).click();
  await picker.getByRole('searchbox', { name: '보관함 장소 검색' }).fill('성수동');
  await picker.getByRole('button', { name: /^성수동 카페거리/ }).click();
  await addParticipant(page, '지도 친구');
  await page.getByRole('button', { name: '지도 친구 출발지 고르기', exact: true }).click();
  picker = page.getByRole('dialog', { name: '출발지 고르기' });
  await picker.getByRole('tab', { name: '지도에서 고르기', exact: true }).click();
  await expect(picker.getByTestId('fake-map')).toBeVisible();
  await expect(picker.getByTestId('meeting-crosshair')).toBeVisible();
  await picker.getByRole('button', { name: '여기로 정하기', exact: true }).click();
  await page.getByRole('button', { name: '중간 지점 찾기', exact: true }).click();
  const hubs = page.getByRole('region', { name: '번화가 역 순위' });
  await expect(hubs.getByRole('button', { name: '원주역 후보에 담기', exact: true })).toBeEnabled();
  await expect.poll(() => calls.filter((c) => c.mode === 'transit').length).toBeGreaterThan(0);
  await hubs.getByRole('button', { name: /^\d+\. 원주역 ·/ }).click();
  const nearby = page.getByRole('region', { name: '원주역 근처 보관함 장소' });
  await nearby.getByRole('button', { name: '성수동 카페거리 후보에 담기', exact: true }).click();
  await hubs.getByRole('button', { name: '원주역 후보에 담기', exact: true }).click();
  // 후보 저장이 끝난 뒤 보관함을 읽어 기존 답장을 넣는다.
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const library = JSON.parse(localStorage.getItem(key)!) as Library;
        return Object.values(library.meetings!)[0]!.candidates.value.length;
      }, LIBRARY_KEY),
    )
    .toBe(2);
  // 다른 참석자의 기존 답장이 있는 약속은 계속 링크 방식으로 공유한다.
  await page.evaluate((key) => {
    const library = JSON.parse(localStorage.getItem(key)!) as Library;
    const meeting = Object.values(library.meetings!)[0]!;
    const participant = meeting.participants.value.find((p) => p.name === '보관함 친구')!;
    const now = new Date().toISOString();
    localStorage.setItem(
      key,
      JSON.stringify({
        ...library,
        meetings: {
          ...library.meetings,
          [meeting.id]: {
            ...meeting,
            replies: {
              value: { [participant.id]: { likes: [], sentAt: now, receivedAt: now } },
              updatedAt: now,
            },
          },
        },
      }),
    );
  }, LIBRARY_KEY);
  await page.reload();
  const invite = await sharedLink(page, '후보 링크 보내기', 'd');
  const friendContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  try {
    const friend = await friendContext.newPage();
    await mockRoutes(friend);
    await mockSearch(friend, [
      {
        name: '친구 새 출발지',
        address: '원주시 새 출발지',
        category: '장소',
        lng: 127.94,
        lat: 37.33,
      },
    ]);
    await captureShares(friend);
    await friend.goto(localLink(invite));
    await expect(friend.getByRole('heading', { name: '주말 모임', exact: true })).toBeVisible();
    const friendLibrary = await friend.evaluate((key) => localStorage.getItem(key), LIBRARY_KEY);
    await friend.getByRole('radio', { name: '지도 친구', exact: true }).check();
    await friend.getByRole('button', { name: '내 출발지 고르기', exact: true }).click();
    const friendPicker = friend.getByRole('dialog', { name: '출발지 고르기' });
    await friendPicker.getByRole('searchbox', { name: '출발지 검색' }).fill('새 출발지');
    await friendPicker.getByRole('button', { name: /^친구 새 출발지 / }).click();
    await friend.getByRole('button', { name: '원주역 좋아요', exact: true }).click();
    const reply = await sharedLink(friend, '답장 링크 보내기', 'r');
    await friend.reload();
    await expect(friend.getByRole('radio', { name: '지도 친구', exact: true })).toBeChecked();
    await expect(
      friend.getByRole('button', { name: '원주역 좋아요', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await friend.evaluate((key) => localStorage.getItem(key), LIBRARY_KEY)).toBe(
      friendLibrary,
    );
    await page.goto(localLink(reply));
    await expect(page.getByText(/지도 친구님 답장: 좋아요 1곳, 출발지 바뀜/)).toBeVisible();
    await page.getByRole('button', { name: '반영', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${editorPath}$`));
    const candidateTimes = page.getByRole('region', { name: '후보와 집계' }).locator('dd');
    await expect(candidateTimes).toHaveCount(6);
    for (const cell of await candidateTimes.all()) {
      await expect(cell).toHaveText(/분/);
    }
    await expect(page.getByRole('button', { name: '중간 지점 찾기', exact: true })).toBeEnabled();
    await expect(page.getByText('좋아요 1명 · 지도 친구', { exact: true })).toBeVisible();
    await expect(page.getByText('친구 새 출발지', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '원주역 확정', exact: true }).click();
    const final = await sharedLink(page, '확정 링크 보내기', 'f');
    await friend.goto(localLink(final));
    const directions = friend.getByRole('link', { name: '지도 친구 출발 길찾기', exact: true });
    await expect(directions).toHaveAttribute(
      'href',
      isCompact(friend)
        ? /^nmap:\/\/route\/public\?/
        : /^https:\/\/map\.naver\.com\/p\/directions\/.*\/transit$/,
    );
    await friend.reload();
    await expect(directions).toBeVisible();
    // 약속 없는 기기에서는 답장 미리보기로 보관함을 변경할 수 없다.
    await friend.goto(localLink(reply));
    await expect(friend.getByText('이 기기에 없는 약속의 답장이에요')).toBeVisible();
    await expect(friend.getByRole('button', { name: '반영', exact: true })).toHaveCount(0);
  } finally {
    await friendContext.close();
  }
});

test('깨진 약속 링크를 안내하고 해시를 유지한다', async ({ page }) => {
  await seedStorage(page, { library: false });
  await page.goto('/meet#d=broken');
  await expect(page.getByText('링크를 읽지 못했어요')).toBeVisible();
  await expect(page).toHaveURL(/#d=broken$/);
  await page.getByRole('link', { name: '약속 목록으로' }).click();
  await expect(page).toHaveURL(/\/meetings$/);
});

test('@mobile 좁은 화면에서 여섯 탭과 44px 목표를 유지하고 약속으로 이동한다', async ({ page }) => {
  await seedStorage(page);
  await page.goto('/');
  const tabs = page.getByRole('navigation', { name: '하단 메뉴' });
  const targets = tabs.locator('a,button');
  await expect(targets).toHaveCount(6);
  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await tabs.getByRole('link', { name: '약속', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings$/);
  await expect(tabs.getByRole('link', { name: '약속', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
