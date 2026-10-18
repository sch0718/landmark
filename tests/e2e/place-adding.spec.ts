import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedStorage } from './fixtures';

/** 앱이 `/api`에서 받는 응답을 녹화해 둔 fixture(`tests/fixtures/links/api/`). */
const apiFixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/links/api/${name}`, import.meta.url)), 'utf8');

const PLACE_NAVER = apiFixture('place-naver.json');
const PLACE_FOLDER = apiFixture('place-folder.json');
const PLACE_UNSUPPORTED = apiFixture('place-unsupported.json');
const NAVER_FOLDER = apiFixture('naver-folder.json');

/** 네이버 앱 "공유 → 복사" 문구: 링크 앞뒤에 글자가 붙는다. */
const SHARE_TEXT = '[네이버 지도]\n콤포트\nhttps://naver.me/Fk73Vab5';
const FOLDER_LINK = 'https://naver.me/xjYaIYfe';
const FOLDER_NAME = '속초, 고성, 양양 맛집';

const markers = (page: Page): Locator => page.locator('[data-testid^="marker-"]');
const rows = (page: Page): Locator =>
  page.getByRole('list', { name: '장소 목록' }).getByRole('listitem');

const json = (body: string, status = 200) => ({
  status,
  contentType: 'application/json; charset=utf-8',
  body,
});

/** 앱이 `/api`로 보낸 질의 값(`url=`·`share=`)을 요청 순서대로 모은 것. */
type ApiCalls = { place: string[]; folder: string[] };

/**
 * `/api/place`·`/api/naver-folder`를 녹화 응답으로 대신한다. 실제 네트워크는 타지 않는다.
 * 앱이 보낸 질의 값을 모아 돌려주니, 호출한 쪽이 흐름이 끝난 뒤 `expect`로 확인한다.
 */
async function mockApi(
  page: Page,
  replies: { place?: { body: string; status?: number }; folder?: string },
): Promise<ApiCalls> {
  const calls: ApiCalls = { place: [], folder: [] };
  if (replies.place !== undefined) {
    const { body, status } = replies.place;
    await page.route('**/api/place?**', (route) => {
      calls.place.push(new URL(route.request().url()).searchParams.get('url') ?? '');
      return route.fulfill(json(body, status));
    });
  }
  if (replies.folder !== undefined) {
    const body = replies.folder;
    await page.route('**/api/naver-folder?**', (route) => {
      calls.folder.push(new URL(route.request().url()).searchParams.get('share') ?? '');
      return route.fulfill(json(body));
    });
  }
  return calls;
}

/** 빈 보관함으로 시작한다. */
async function openEmptyLibrary(page: Page): Promise<void> {
  await seedStorage(page, { library: false, prefs: { libraryView: 'list' } });
  await page.goto('/');
}

/**
 * ＋ → 시트 항목. 시트가 닫혀야 다음 단계로 간다. 좁은 화면에서는 추가 시트와 단계 칸(하단 시트)의 이름이
 * 둘 다 `장소 추가`라서, 항목 버튼이 있는 쪽이 사라지는 것으로 닫힘을 확인한다.
 */
async function openFrom(page: Page, item: RegExp): Promise<void> {
  await page.getByRole('button', { name: '장소 추가', exact: true }).first().click();
  const option = page
    .getByRole('dialog', { name: '장소 추가' })
    .getByRole('button', { name: item });
  await option.click();
  await expect(option).toHaveCount(0);
}

/** 링크 입력칸에 붙여 넣고 `확인`을 누른다(붙여 넣기 이벤트를 쓰지 않고 값을 채운다). */
async function submitLink(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: '링크' }).fill(text);
  await page.getByRole('button', { name: '확인', exact: true }).click();
}

/** 좁은 화면(하단 시트·`/map` 이동)인가. */
const isCompact = (page: Page): boolean => page.viewportSize()!.width < 768;

/**
 * 좁은 화면에서 상세 시트를 닫고 보관함 탭의 목록을 연다. 시트는 지도 위에서 열렸으므로
 * 닫으면 지도로 돌아간다.
 */
async function showLibraryTab(page: Page, detail: Locator): Promise<void> {
  await detail.getByRole('button', { name: '닫기' }).click();
  await page
    .getByRole('navigation', { name: '하단 메뉴' })
    .getByRole('link', { name: '보관함' })
    .click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe('장소 추가', () => {
  test('@smoke 링크로 장소를 추가하면 목록과 지도에 나타난다', async ({ page }) => {
    const calls = await mockApi(page, { place: { body: PLACE_NAVER } });
    await openEmptyLibrary(page);
    await expect(rows(page)).toHaveCount(0);

    await openFrom(page, /링크 붙여넣기/);
    await submitLink(page, SHARE_TEXT);

    // 확인 카드: 이름·주소가 채워지고, 좁은 화면에서는 후보 핀을 보이려고 지도(/map)로 옮긴다.
    await expect(page.getByRole('heading', { name: '콤포트' })).toBeVisible();
    // 붙여 넣은 공유 문구에서 링크만 뽑아 조회했다.
    expect(calls.place).toEqual(['https://naver.me/Fk73Vab5']);
    await expect(page.getByRole('textbox', { name: '주소' })).toHaveValue(
      '서울 용산구 후암동 358-144',
    );
    if (isCompact(page)) {
      await expect(page).toHaveURL(/\/map$/);
      await expect(page.getByTestId('marker-candidate')).toBeVisible();
    }

    // 라벨을 새로 만들면 고른 상태가 된다.
    await page.getByRole('button', { name: '라벨 바꾸기' }).click();
    const picker = page.getByRole('dialog', { name: '라벨 바꾸기' });
    const search = picker.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    await search.fill('데이트');
    await search.press('Enter');
    await expect(picker.getByRole('checkbox', { name: /^데이트/ })).toBeChecked();
    await picker.getByRole('button', { name: '완료' }).click();

    await page.getByRole('button', { name: '추가', exact: true }).click();

    // 상세가 열린다.
    await expect(page).toHaveURL(/\/place\/[^/]+$/);
    const detail = page.getByRole('region', { name: '장소 상세' });
    await expect(detail.getByRole('button', { name: '이름 수정' })).toContainText('콤포트');
    await expect(detail.getByRole('list', { name: '붙은 라벨' })).toContainText('데이트');

    // 목록 행 1, 지도 마커 1(좁은 화면은 목록·지도가 다른 탭이라 탭을 옮겨 본다).
    if (isCompact(page)) {
      await showLibraryTab(page, detail);
      await expect(rows(page)).toHaveCount(1);
      await page
        .getByRole('navigation', { name: '하단 메뉴' })
        .getByRole('link', { name: '지도' })
        .click();
      await expect(page).toHaveURL(/\/map$/);
    } else {
      await expect(rows(page)).toHaveCount(1);
    }
    await expect(markers(page)).toHaveCount(1);
  });

  test('폴더를 가져오면 그 라벨로 걸러진 장소가 보인다', async ({ page }) => {
    const calls = await mockApi(page, { place: { body: PLACE_FOLDER }, folder: NAVER_FOLDER });
    await openEmptyLibrary(page);

    await openFrom(page, /네이버 폴더 가져오기/);
    await submitLink(page, FOLDER_LINK);

    // 미리보기: 3곳이 모두 체크되어 있고 라벨 이름은 폴더 이름이다.
    await expect(page.getByRole('heading', { name: `${FOLDER_NAME} · 3곳` })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '붙일 라벨 이름' })).toHaveValue(FOLDER_NAME);
    await page.getByRole('button', { name: '3곳 가져오기', exact: true }).click();
    expect(calls.place).toEqual([FOLDER_LINK]);
    // 개발 서버의 StrictMode는 효과를 두 번 돌려 같은 조회가 두 번 갈 수 있다. 모두 같은 공유 ID여야 한다.
    expect(calls.folder.length).toBeGreaterThan(0);
    expect([...new Set(calls.folder)]).toEqual(['fb65e7f93f8a4144a4ded594d604a7aa']);

    // 가져온 뒤에는 그 라벨로 걸러진 목록이 보인다.
    await expect(page.getByText('3곳을 새로 넣었어요')).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
    await expect(
      page
        .getByRole('group', { name: '라벨' })
        .getByRole('button', { name: /^속초, 고성, 양양 맛집/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page).getByRole('button', { name: /청초수물회 속초본점/ })).toBeVisible();
  });

  test('지도에서 핀을 찍어 추가한다', async ({ page }) => {
    // .env.local에 지도 키가 있으면 SDK를 불러오다 오래 걸린다. 주소 변환은 없는 셈 치고(주소 미확인 안내) 막는다.
    await page.route('https://oapi.map.naver.com/**', (route) => route.abort());
    await openEmptyLibrary(page);

    await openFrom(page, /지도에서 핀 찍기/);
    await expect(page.getByText('지도를 움직여 위치를 맞추세요')).toBeVisible();
    // 조준점은 크기 0인 틀이라 보임 여부 대신 붙어 있는지만 본다.
    await expect(page.getByTestId('pin-crosshair')).toBeAttached();
    if (isCompact(page)) await expect(page).toHaveURL(/\/map$/);

    await page.getByRole('button', { name: '여기에 추가', exact: true }).click();

    // 위에서 네이버 지도 SDK 요청을 막았으므로 주소 변환이 null을 돌려줘 직접 입력 안내가 뜬다.
    await expect(page.getByText('주소를 찾지 못했어요. 직접 입력해 주세요')).toBeVisible();
    const add = page.getByRole('button', { name: '추가', exact: true });
    await expect(add).toBeDisabled();
    await page.getByRole('textbox', { name: '이름', exact: true }).fill('우리 동네 벤치');
    await expect(add).toBeEnabled();
    await add.click();

    await expect(page).toHaveURL(/\/place\/[^/]+$/);
    const detail = page.getByRole('region', { name: '장소 상세' });
    await expect(detail.getByRole('button', { name: '이름 수정' })).toContainText('우리 동네 벤치');
    if (isCompact(page)) {
      await showLibraryTab(page, detail);
    }
    await expect(rows(page)).toHaveCount(1);
  });

  test('지원하지 않는 링크는 안내한다', async ({ page }) => {
    const calls = await mockApi(page, { place: { body: PLACE_UNSUPPORTED, status: 400 } });
    await openEmptyLibrary(page);

    await openFrom(page, /링크 붙여넣기/);
    await submitLink(page, 'https://example.com/not-a-map');

    await expect(
      page.getByText('네이버·카카오·구글 지도의 장소 링크만 넣을 수 있어요'),
    ).toBeVisible();
    // 입력은 그대로 남고, 다시 시도 버튼은 없으며, 보관함은 비어 있다.
    await expect(page.getByRole('textbox', { name: '링크' })).toHaveValue(
      'https://example.com/not-a-map',
    );
    await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0);
    expect(calls.place).toEqual(['https://example.com/not-a-map']);
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(rows(page)).toHaveCount(0);
  });
});

test.describe('키보드·포커스', () => {
  test(
    '데스크톱: 첫 Tab에 본문 바로가기, ＋ → 링크 붙여넣기면 입력칸에 포커스, Esc로 닫으면 ＋로',
    {
      tag: '@desktop',
    },
    async ({ page }) => {
      await openEmptyLibrary(page);
      const plus = page.getByRole('button', { name: '장소 추가', exact: true });
      // 셸이 그려진 뒤에 Tab을 누른다.
      await expect(plus).toBeVisible();

      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: '본문으로 바로 가기' });
      await expect(skip).toBeFocused();
      // 포커스 전에는 1px로 숨어 있다가 포커스를 받으면 글자가 보이는 크기로 나타난다.
      expect((await skip.boundingBox())!.width).toBeGreaterThan(40);

      // 레일: 보관함 → 지도 → ＋ 순서다.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(plus).toBeFocused();
      await page.keyboard.press('Enter');
      // 시트가 열리면 시트 자체에 포커스가 가고, 다음 Tab이 첫 항목이다.
      const linkItem = page
        .getByRole('dialog', { name: '장소 추가' })
        .getByRole('button', { name: /링크 붙여넣기/ });
      await expect(linkItem).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(linkItem).toBeFocused();
      await page.keyboard.press('Enter');

      const panel = page.getByRole('region', { name: '장소 추가' });
      await expect(panel.getByRole('textbox', { name: '링크' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(plus).toBeFocused();
    },
  );

  test(
    '휴대폰: ＋ → 링크 붙여넣기면 시트의 링크 입력칸에 포커스',
    { tag: '@mobile' },
    async ({ page }) => {
      await openEmptyLibrary(page);
      await openFrom(page, /링크 붙여넣기/);
      await expect(page.getByRole('textbox', { name: '링크' })).toBeFocused();
    },
  );
});
