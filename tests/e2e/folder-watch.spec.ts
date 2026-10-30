import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { test, seedStorage, LIBRARY_KEY } from './fixtures';
const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/links/api/${name}`, import.meta.url)), 'utf8');
const name = '속초, 고성, 양양 맛집';
async function prepare(page: Page) {
  let body = fixture('naver-folder.json');
  const calls: { share: string | null; fresh: string | null }[] = [];
  // 로컬 응답으로 시험하므로 호스트 기기의 인터넷 연결 상태에 영향을 받지 않는다.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => true });
  });
  await page.route('**/api/place?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: fixture('place-folder.json'),
    }),
  );
  await page.route('**/api/naver-folder?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    calls.push({ share: params.get('share'), fresh: params.get('fresh') });
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await seedStorage(page, { library: false, prefs: { libraryView: 'list' } });
  await page.goto('/');
  await page.getByRole('button', { name: '장소 추가', exact: true }).first().click();
  await page
    .getByRole('dialog', { name: '장소 추가' })
    .getByRole('button', { name: /네이버 폴더 가져오기/ })
    .click();
  await page.getByRole('textbox', { name: '링크', exact: true }).fill('https://naver.me/xjYaIYfe');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('button', { name: '3곳 가져오기', exact: true }).click();
  await expect(page.getByText('3곳을 새로 넣었어요', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: '장소 목록' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '3곳 가져오기', exact: true })).toHaveCount(0);
  const age = () =>
    page.evaluate((key) => {
      const lib = JSON.parse(localStorage.getItem(key)!);
      for (const link of Object.values(lib.folders) as { checkedAt: string }[])
        link.checkedAt = new Date(Date.now() - 3 * 86400000).toISOString();
      localStorage.setItem(key, JSON.stringify(lib));
      // 기한은 연결과 알림 기록 중 최근 시각으로 판단한다. 첫 실행에는 알림 키가 없을 수 있다.
      const watchKey = 'tripmap:folder-watch:v1';
      const state = JSON.parse(localStorage.getItem(watchKey) ?? 'null') ?? {
        v: 1,
        enabled: true,
        lastRunAt: null,
        lastManualAt: null,
      };
      state.folders = {};
      localStorage.setItem(watchKey, JSON.stringify(state));
    }, LIBRARY_KEY);
  body = fixture('naver-folder-more.json');
  calls.length = 0;
  return { calls, age };
}
test('@desktop 폴더 변경 토스트에서 새 곳만 가져온다', async ({ page }) => {
  const { calls, age } = await prepare(page);
  await age();
  await page.reload();
  const notice = page.locator('[data-sonner-toast]').filter({
    hasText: `‘${name}’ 폴더에 새로 저장한 곳이 1곳 있어요`,
  });
  // FolderWatchBoot는 셸이 열린 뒤 3초가 지나야 확인한다.
  await expect(notice).toBeVisible({ timeout: 10000 });
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((call) => call.fresh === null)).toBe(true);
  await notice.getByRole('button', { name: '가져오기', exact: true }).click();
  await expect(
    page.getByText('새로 저장한 곳 1 · 그대로 3 · 폴더에서 빠진 곳 0', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '1곳 가져오기', exact: true }).click();
  await expect(page.getByText('1곳을 새로 넣었어요', { exact: true })).toBeVisible();
  await page.goto('/labels');
  await expect(
    page.getByRole('button', { name: /속초, 고성, 양양 맛집.*장소 4곳 · 네이버 폴더$/ }),
  ).toBeVisible();
});
test('@desktop 라벨의 폴더 변경 표시와 알림 끄기를 지킨다', async ({ page }) => {
  const { calls, age } = await prepare(page);
  await page.goto('/labels');
  await age();
  await page.reload();
  const row = page.getByRole('button', {
    name: /속초, 고성, 양양 맛집.*장소 3곳 · 네이버 폴더 · 새로 저장한 곳 1곳$/,
  });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
  const editor = page.getByRole('dialog', { name: '라벨 고치기', exact: true });
  await expect(editor.getByText(/네이버에 새로 저장한 곳 1곳/)).toBeVisible();
  await editor.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: '네이버 폴더 변경 알림', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await age();
  calls.length = 0;
  await page.reload();
  await expect(toggle).not.toBeChecked();
  // 셸과 설정이 보인 뒤 부트 지연(3초)을 넘겨도 조회가 없어야 한다.
  await page.waitForTimeout(5000);
  expect(calls).toHaveLength(0);
  await toggle.check();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect.poll(() => calls.length, { timeout: 10000 }).toBeGreaterThan(0);
});
