import { expect, test } from '@playwright/test';
import type { Library } from '../../src/schema/library';
import { isCompact, LIBRARY_KEY, seedStorage } from './fixtures';

test('@smoke 라벨 이모지를 고르면 칩과 지도 이름표에 보인다', async ({ page }) => {
  await seedStorage(page, { prefs: { libraryView: 'list' } });
  await page.goto('/labels');
  const list = page.getByRole('list', { name: '라벨 목록' });
  await list.getByRole('button', { name: /^카페/ }).click();
  const editor = page.getByRole('dialog', { name: '라벨 고치기' });
  const emojis = editor.getByRole('radiogroup', { name: '이모지' });
  await emojis.getByRole('radio', { name: '카페', exact: true }).click();
  await expect(emojis.getByRole('radio', { name: '카페', exact: true })).toBeChecked();
  await editor.getByRole('button', { name: '닫기' }).click();
  await expect(list.getByRole('button', { name: /^카페/ })).toContainText('☕');

  // 첫 라벨이 카페인 시드 장소를 골라 실제 이름표와 비교한다.
  const place = await page.evaluate((key) => {
    const lib = JSON.parse(localStorage.getItem(key)!) as Library;
    const cafe = Object.values(lib.labels).find((label) => label.name.value === '카페')!;
    return Object.values(lib.places).find((place) => place.labelIds.value[0] === cafe.id)!;
  }, LIBRARY_KEY);
  expect(place).toBeTruthy();
  await page.goto('/');
  const chip = page.getByRole('group', { name: '라벨' }).getByRole('button', { name: /^카페/ });
  await expect(chip).toContainText('☕');
  await page.reload();
  await expect(chip).toContainText('☕');
  if (isCompact(page)) await page.goto('/map');
  await expect(page.getByTestId(`marker-${place.id}`)).toContainText(`☕ ${place.name.value}`);
});

test('이름으로 여러 라벨의 이모지를 정하고 토스트로 되돌린다', async ({ page }) => {
  await seedStorage(page);
  await page.goto('/labels');
  await page.getByRole('button', { name: '이름으로 이모지 정하기' }).click();
  const preview = page.getByRole('dialog', { name: '이름으로 이모지 정하기' });
  const count = await preview.getByRole('checkbox').count();
  expect(count).toBeGreaterThan(1);
  await expect(preview.getByRole('checkbox').first()).toBeChecked();
  await preview.getByRole('button', { name: '적용' }).click();
  await expect(preview).toHaveCount(0);
  const list = page.getByRole('list', { name: '라벨 목록' });
  await expect(list.getByRole('button', { name: /^카페/ })).toContainText('☕');
  await expect(list.getByRole('button', { name: /^맛집/ })).toContainText('🍽️');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(list.getByRole('button', { name: /^카페/ })).not.toContainText('☕');
  await expect(list.getByRole('button', { name: /^맛집/ })).not.toContainText('🍽️');
});
