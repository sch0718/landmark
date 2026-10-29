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
  await page.getByRole('button', { name: '보관함에서 보기', exact: true }).click();
  const age = () =>
    page.evaluate((key) => {
      const lib = JSON.parse(localStorage.getItem(key)!);
      for (const link of Object.values(lib.folders) as { checkedAt: string }[])
        link.checkedAt = new Date(Date.now() - 3 * 86400000).toISOString();
      localStorage.setItem(key, JSON.stringify(lib));
    }, LIBRARY_KEY);
  await age();
  body = fixture('naver-folder-more.json');
  calls.length = 0;
  return { calls, age };
}
test('@desktop 폴더 변경 토스트에서 새 곳만 가져온다', async ({ page }) => {
  const { calls } = await prepare(page);
  await page.reload();
  await expect(
    page.getByText(`‘${name}’ 폴더에 새로 저장한 곳이 1곳 있어요`, { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  expect(calls[0]?.fresh).toBeNull();
  await page.getByRole('button', { name: '가져오기', exact: true }).click();
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
  await page.reload();
  const row = page.getByRole('button', {
    name: /속초, 고성, 양양 맛집.*장소 3곳 · 네이버 폴더 · 새로 저장한 곳 1곳$/,
  });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
  await expect(
    page.getByRole('dialog', { name: '라벨 고치기' }).getByText(/네이버에 새로 저장한 곳 1곳/),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: '라벨 고치기' })
    .getByRole('button', { name: '닫기', exact: true })
    .click();
  await page.goto('/settings');
  await page.getByRole('switch', { name: '네이버 폴더 변경 알림', exact: true }).uncheck();
  await page.evaluate(() => {
    const key = 'tripmap:folder-watch:v1';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.folders = {};
    localStorage.setItem(key, JSON.stringify(state));
  });
  await age();
  calls.length = 0;
  await page.reload();
  await page.waitForTimeout(5000);
  expect(calls).toHaveLength(0);
  await page.getByRole('switch', { name: '네이버 폴더 변경 알림', exact: true }).check();
  await page.reload();
  await expect.poll(() => calls.length, { timeout: 10000 }).toBeGreaterThan(0);
});
