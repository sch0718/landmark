import { expect, type BrowserContext, type Page } from '@playwright/test';
import { test, mockRoutes, placeIdByName, seedStorage } from './fixtures';
import { createSyncServer, installSyncServer } from './sync-server';
const syncSection = (page: Page) => page.getByRole('region', { name: '동기화', exact: true });
async function settings(page: Page) {
  await page
    .getByRole('navigation', { name: /^(사이드|하단) 메뉴$/ })
    .getByRole('link', { name: '설정', exact: true })
    .click();
}
async function login(page: Page, sub = 'me') {
  await page.goto('/settings');
  await syncSection(page).getByRole('button', { name: '카카오로 로그인' }).click();
  await page.getByRole('textbox', { name: /계정 ID/ }).fill(sub);
  await page.getByLabel('정상 로그인', { exact: true }).check();
  await page.getByRole('button', { name: '계속', exact: true }).click();
}
async function editMemo(page: Page, text: string) {
  const detail = page.getByRole('region', { name: '장소 상세' });
  await detail.getByRole('textbox', { name: '메모', exact: true }).fill(text);
  await expect(detail.getByRole('status').filter({ hasText: '저장됨' })).toBeVisible();
}
async function synced(page: Page) {
  await expect(syncSection(page).getByText('동기화 완료', { exact: true })).toBeVisible({
    timeout: 15000,
  });
}
test('@desktop 두 기기가 로그인·메모 동기화·충돌 복원·계정 삭제를 끝까지 처리한다', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  const server = createSyncServer();
  const contexts: BrowserContext[] = [];
  const device = async (seed: boolean) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1280, height: 800 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    contexts.push(context);
    // Vite는 public/_headers를 적용하지 않으므로 운영 콜백 문서 정책을 재현한다.
    await context.route('**/auth/callback?**', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'referrer-policy': 'no-referrer' },
      });
    });
    await installSyncServer(context, server);
    const page = await context.newPage();
    await seedStorage(page, { library: seed, prefs: { libraryView: 'list' } });
    await mockRoutes(page);
    return page;
  };
  try {
    const a = await device(true);
    const b = await device(false);
    const c = await device(false);
    await login(a);
    await expect(a.getByRole('dialog', { name: '연결 방식' })).toBeVisible();
    // SPA 이동이면 콜백 문서의 navigation 항목과 no-referrer 정책이 남는다.
    expect(
      await a.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        return navigation ? new URL(navigation.name).pathname : null;
      }),
    ).toBe('/settings');
    expect(await a.evaluate(async () => (await fetch('/api/sync/v1/status')).status)).toBe(200);
    await a
      .getByRole('dialog', { name: '연결 방식' })
      .getByRole('button', { name: '올리기', exact: true })
      .click();
    await synced(a);
    await login(b);
    await b
      .getByRole('dialog', { name: '연결 방식' })
      .getByRole('button', { name: '서버 보관함 받기', exact: true })
      .click();
    await synced(b);
    await b.goto('/');
    await expect(b.getByRole('button', { name: /경포대/ }).first()).toBeVisible();
    const path = `/place/${placeIdByName('경포대')}`;
    await a.goto(path);
    await editMemo(a, 'A 메모');
    await settings(a);
    await synced(a);
    await b.goto(path);
    await expect(b.getByRole('textbox', { name: '메모', exact: true })).toHaveValue('A 메모');
    await b.context().setOffline(true);
    await editMemo(b, 'B 오프라인');
    await a.goto(path);
    await editMemo(a, 'A 나중');
    await settings(a);
    await synced(a);
    await b.context().setOffline(false);
    await b.reload();
    await settings(b);
    await expect(syncSection(b).getByText('확인 필요한 충돌', { exact: true })).toBeVisible();
    await syncSection(b).getByRole('button', { name: '확인', exact: true }).click();
    const conflicts = b.getByRole('dialog', { name: '확인 필요한 충돌' });
    await conflicts.getByRole('button', { name: '내 값으로 되돌리기', exact: true }).click();
    await conflicts.getByRole('button', { name: '닫기', exact: true }).click();
    await synced(b);
    await a.goto(path);
    await expect(a.getByRole('textbox', { name: '메모', exact: true })).toHaveValue('B 오프라인');
    await login(c, 'stranger');
    await expect(
      c.getByText('이 계정은 아직 동기화를 쓸 수 없어요', { exact: true }),
    ).toBeVisible();
    await expect(c.getByText('kakao:dev-stranger', { exact: true })).toBeVisible();
    await settings(a);
    await syncSection(a)
      .getByRole('button', { name: '서버 자료 모두 지우기', exact: true })
      .click();
    const remove = a.getByRole('dialog', { name: '서버 자료 모두 지우기' });
    await remove.getByRole('textbox', { name: '지우기 입력' }).fill('지우기');
    await remove.getByRole('button', { name: '서버 자료 모두 지우기', exact: true }).click();
    await expect(remove).toBeHidden();
    await expect(syncSection(a).getByRole('button', { name: '카카오로 로그인' })).toBeVisible();
    await b.reload();
    await expect(syncSection(b).getByText('다시 로그인해 주세요', { exact: true })).toBeVisible();
  } finally {
    await test.info().attach('동기화 GET 요청', {
      body: JSON.stringify(server.getRequests),
      contentType: 'application/json',
    });
    for (const context of contexts) await context.close();
    server.close();
  }
});
