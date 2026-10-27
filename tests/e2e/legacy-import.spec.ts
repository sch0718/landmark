import { expect } from '@playwright/test';
import { test, E2E_PUBLIC_ID, seedStorage } from './fixtures';

test('@smoke 옛 여행(/t/…) 미리보기 → 가져오기 → 보관함에 장소와 라벨', async ({ page }) => {
  // 보관함은 비어 있는 상태로 시작한다.
  await seedStorage(page, { library: false, prefs: { libraryView: 'list' } });
  await page.goto(`/t/${E2E_PUBLIC_ID}`);

  await expect(page.getByRole('heading', { name: 'E2E 테스트 여행' })).toBeVisible();
  const summary = page.getByRole('status').filter({ hasText: '새로 추가' });
  await expect(summary).toContainText('새로 추가 42');
  await expect(summary).toContainText('확인 필요 0');

  await page.getByRole('button', { name: '가져오기' }).click();

  // 보관함으로 이동해 장소와 라벨이 보인다.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('42곳을 가져왔어요')).toBeVisible();
  await expect(page.getByRole('list', { name: '장소 목록' }).getByRole('listitem')).toHaveCount(42);
  await expect(
    page.getByRole('group', { name: '라벨' }).getByRole('button', { name: /^테스트 폴더/ }),
  ).toContainText('42');
  await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(42);

  // 가져온 것은 새로고침 후에도 남는다.
  await page.reload();
  await expect(page.getByRole('list', { name: '장소 목록' }).getByRole('listitem')).toHaveCount(42);
});
