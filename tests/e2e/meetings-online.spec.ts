import { expect, test, type Page } from '@playwright/test';
import type { Library } from '../../src/schema/library';
import { LIBRARY_KEY, mockRoutes, mockSearch, seedStorage } from './fixtures';
import { createMeetServer, installMeetServer } from './meet-server';

declare global {
  interface Window {
    onlineMeetingLinks: string[];
  }
}

async function captureShares(page: Page) {
  await page.addInitScript(() => {
    window.onlineMeetingLinks = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        if (data.url) window.onlineMeetingLinks.push(data.url);
      },
    });
  });
}

async function sharedLink(page: Page, button: string) {
  const count = await page.evaluate(() => window.onlineMeetingLinks.length);
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.onlineMeetingLinks.length)).toBe(count + 1);
  return new URL(await page.evaluate(() => window.onlineMeetingLinks.at(-1)!));
}

async function readMeeting(page: Page, id: string) {
  return page.evaluate(
    ({ key, id }) => {
      const library = JSON.parse(localStorage.getItem(key)!) as Library;
      return library.meetings?.[id] ?? null;
    },
    { key: LIBRARY_KEY, id },
  );
}

async function addParticipant(page: Page, name: string) {
  await page.getByRole('button', { name: '참석자 추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '참석자 추가' });
  await dialog.getByRole('textbox', { name: '참석자 이름' }).fill(name);
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('@desktop @smoke 온라인 약속의 자동 집계·차지 충돌·확정·다른 주최자 기기를 잇는다', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const server = createMeetServer();
  const contexts = [context];
  async function newPage() {
    const next = await browser.newContext({
      baseURL,
      viewport: page.viewportSize(),
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    contexts.push(next);
    await installMeetServer(next, server);
    const nextPage = await next.newPage();
    await seedStorage(nextPage, { library: false });
    await mockRoutes(nextPage);
    await mockSearch(nextPage);
    return nextPage;
  }
  try {
    await installMeetServer(context, server);
    await seedStorage(page);
    const calls = await mockRoutes(page);
    await mockSearch(page);
    await captureShares(page);
    await page.clock.install();
    await page.goto('/meetings');
    await page.getByRole('button', { name: '새 약속', exact: true }).click();
    const form = page.getByRole('dialog', { name: '새 약속', exact: true });
    await form.getByRole('textbox', { name: '약속 이름' }).fill('온라인 주말 모임');
    await form.getByRole('button', { name: '만들기', exact: true }).click();
    await expect(page).toHaveURL(/\/meetings\/[a-z0-9]{10}$/);
    const id = new URL(page.url()).pathname.split('/').at(-1)!;
    await addParticipant(page, '답장 친구');
    await addParticipant(page, '다른 친구');
    for (const name of ['나', '답장 친구']) {
      await page.getByRole('button', { name: `${name} 출발지 고르기`, exact: true }).click();
      const picker = page.getByRole('dialog', { name: '출발지 고르기' });
      await picker.getByRole('searchbox', { name: '출발지 검색' }).fill('원주');
      await picker.getByRole('button', { name: /^원주 출발 / }).click();
      await expect(picker).toBeHidden();
    }
    await page.getByRole('button', { name: '중간 지점 찾기', exact: true }).click();
    const hubs = page.getByRole('region', { name: '번화가 역 순위' });
    await expect
      .poll(() => calls.filter((call) => call.mode === 'transit').length)
      .toBeGreaterThan(0);
    await expect(page.getByRole('status').filter({ hasText: /^조회 중/ })).toHaveCount(0);
    await hubs.getByRole('button', { name: '원주역 후보에 담기', exact: true }).click();
    const invite = await sharedLink(page, '후보 링크 보내기');
    expect(invite.pathname).toBe(`/meet/${id}`);
    expect(invite.hash).toBe('');
    expect(invite.search).toBe('');
    const meeting = (await readMeeting(page, id))!;
    const friendId = meeting.participants.value.find((p) => p.name === '답장 친구')!.id;
    const candidateId = meeting.candidates.value.find((c) => c.name === '원주역')!.id;

    const friend = await newPage();
    await friend.clock.install();
    await friend.goto(invite.pathname);
    await expect(
      friend.getByRole('heading', { name: '온라인 주말 모임', exact: true }),
    ).toBeVisible();
    const friendLibrary = await friend.evaluate((key) => localStorage.getItem(key), LIBRARY_KEY);
    await friend
      .getByRole('region', { name: '나는 누구?' })
      .getByRole('button', { name: '답장 친구', exact: true })
      .click();
    await expect(friend.getByRole('region', { name: '내 출발지', exact: true })).toBeVisible();
    await expect(friend.getByRole('button', { name: '답장 링크 보내기', exact: true })).toHaveCount(
      0,
    );
    const saved = friend.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/meet/${id}/reply`) &&
        response.request().method() === 'PUT' &&
        response.status() === 200,
    );
    await friend.getByRole('button', { name: '원주역 좋아요', exact: true }).click();
    await friend.clock.runFor(1000);
    await saved;
    const polled = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/meet/${id}?since=`) &&
        response.request().method() === 'GET' &&
        response.status() === 200,
    );
    await page.clock.runFor(10_000);
    await polled;
    await expect(
      page
        .getByRole('region', { name: '후보와 집계' })
        .getByText('좋아요 1명 · 답장 친구', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await readMeeting(page, id))?.replies.value[friendId]?.likes)
      .toEqual([candidateId]);
    expect(await friend.evaluate((key) => localStorage.getItem(key), LIBRARY_KEY)).toBe(
      friendLibrary,
    );

    const rival = await newPage();
    await rival.goto(invite.pathname);
    await rival
      .getByRole('region', { name: '나는 누구?' })
      .getByRole('button', { name: '답장 친구', exact: true })
      .click();
    await expect(rival.getByRole('alert')).toHaveText(
      '다른 기기에서 이미 답했어요. 주최자에게 풀어 달라고 하세요',
    );

    const decided = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/meet/${id}` &&
        response.request().method() === 'PUT' &&
        response.status() === 200,
    );
    await page.getByRole('button', { name: '원주역 확정', exact: true }).click();
    await page.clock.runFor(1000);
    await decided;
    await friend.clock.runFor(10_000);
    await expect(friend.getByRole('heading', { name: '확정 · 원주역', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '약속 공유 메뉴', exact: true }).click();
    await page.getByRole('menuitem', { name: '다른 기기에서 열기', exact: true }).click();
    const hostLink = await sharedLink(page, '주최자 링크 보내기');
    expect(hostLink.pathname).toBe(invite.pathname);
    expect(hostLink.hash).toMatch(/^#h=[A-Za-z0-9_-]{43}$/);
    expect(hostLink.search).toBe('');
    const otherHost = await newPage();
    await otherHost.goto(`${hostLink.pathname}${hostLink.hash}`);
    await expect(otherHost).toHaveURL(new RegExp(`/meetings/${id}$`));
    expect(new URL(otherHost.url()).hash).toBe('');
    await expect(
      otherHost.getByRole('heading', { name: '온라인 주말 모임', exact: true }),
    ).toBeVisible();
    await expect(
      otherHost.getByRole('button', { name: '약속 공유 메뉴', exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const imported = await readMeeting(otherHost, id);
        return {
          decided: imported?.decided.value,
          likes: imported?.replies.value[friendId]?.likes,
          participants: imported?.participants.value,
        };
      })
      .toEqual({
        decided: candidateId,
        likes: [candidateId],
        participants: meeting.participants.value,
      });
  } finally {
    // 문맥의 확인 타이머·요청을 먼저 끝내고 공유 DB를 닫는다.
    try {
      await Promise.all(contexts.map((item) => item.close()));
    } finally {
      server.close();
    }
  }
});
