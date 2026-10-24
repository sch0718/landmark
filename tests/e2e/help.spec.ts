import { expect, test } from '@playwright/test';
import { HELP_SEEN_KEY, seedStorage } from './fixtures';

test('@smoke 처음 보관함 안내를 시작하면 새로고침 뒤 다시 열리지 않는다', async ({ page }) => {
  await seedStorage(page, { helpSeen: false });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: '보관함', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '시작하기', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), HELP_SEEN_KEY),
    )
    .toContain('library');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: '보관함', exact: true })).toBeAttached();
  await expect(dialog).toHaveCount(0);
});

test('설정의 도움말 목록에서 여행 그림과 사용 단계를 읽는다', async ({ page }) => {
  await seedStorage(page);
  await page.goto('/settings');
  await page.getByRole('link', { name: '도움말 보기', exact: true }).click();
  await expect(page).toHaveURL(/\/help$/);

  await page.getByRole('main').getByRole('link', { name: /^여행/ }).click();
  await expect(page).toHaveURL(/\/help\/trips$/);
  await expect(page.getByRole('heading', { level: 1, name: '여행', exact: true })).toBeVisible();
  const image = page.getByRole('img', { name: /^여행 사용법:/ });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: '이렇게 써요', exact: true })).toBeVisible();
  for (const title of [
    '새 여행 만들기',
    '후보 담고 Day에 넣기',
    'Day 일정과 이동 시간',
    '여행 당일 모드',
  ]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
});

test('보관함의 물음표 링크로 해당 도움말을 연다', async ({ page }) => {
  await seedStorage(page);
  await page.goto('/');

  await page
    .getByRole('region', { name: '장소 목록', exact: true })
    .getByRole('link', { name: '도움말', exact: true })
    .click();
  await expect(page).toHaveURL(/\/help\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: '보관함', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /^보관함 사용법:/ })).toBeVisible();
});
