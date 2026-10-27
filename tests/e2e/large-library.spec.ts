import { expect, type Page } from '@playwright/test';
import type { Library } from '../../src/schema/library';
import {
  test,
  isCompact,
  LIBRARY_KEY,
  PREFS_KEY,
  prefsJson,
  rowsOf,
  SEA_COUNT,
  seedJson,
  seedStorage,
} from './fixtures';

/** 실제 백업 대신 공개 시험 시드의 라벨만 늘린다. */
async function seedManyLabels(page: Page) {
  await seedStorage(page, { library: false });
  let library = JSON.parse(seedJson) as Library;
  const template = Object.values(library.labels)[0]!;
  for (let i = 0; i < 8; i++) {
    const id = `extra${String(i).padStart(3, '0')}`;
    library = {
      ...library,
      labels: {
        ...library.labels,
        [id]: {
          ...template,
          id,
          name: { ...template.name, value: `저장 많은 맛집 ${i}` },
          order: { ...template.order, value: 10 + i },
        },
      },
    };
  }
  await page.addInitScript(
    ({ library, prefs, libraryKey, prefsKey }) => {
      if (!localStorage.getItem(libraryKey)) localStorage.setItem(libraryKey, library);
      if (!localStorage.getItem(prefsKey)) localStorage.setItem(prefsKey, prefs);
    },
    {
      library: JSON.stringify(library),
      prefs: prefsJson(),
      libraryKey: LIBRARY_KEY,
      prefsKey: PREFS_KEY,
    },
  );
  return library;
}
const markers = (page: Page) => page.locator('[data-testid^="marker-"]');

test('@smoke 라벨 찾기에서 검색·선택하면 지도 마커가 줄어든다', async ({ page }) => {
  const library = await seedManyLabels(page);
  await page.goto(isCompact(page) ? '/map' : '/');
  await expect(markers(page)).toHaveCount(Object.keys(library.places).length);
  await page.getByRole('button', { name: '라벨 찾기' }).click();
  const dialog = page.getByRole('dialog', { name: '라벨 찾기' });
  await dialog.getByRole('searchbox', { name: '라벨 이름 검색' }).fill('바다');
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await dialog.getByRole('checkbox', { name: /^바다/ }).check();
  await dialog.getByRole('button', { name: '완료' }).click();
  await expect(markers(page)).toHaveCount(SEA_COUNT);
  const selected = page
    .getByRole('group', { name: '라벨', exact: true })
    .getByRole('button', { name: /^바다/ });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '라벨 찾기' }).click();
  await expect(dialog.getByRole('checkbox', { name: /^바다/ })).toBeChecked();
  await dialog.getByRole('button', { name: '완료' }).click();
});

test('시·도 다음 시·군으로 거르면 목록과 지도도 같은 지역만 남는다', async ({ page }) => {
  const library = await seedManyLabels(page);
  await page.goto('/');
  const provinceCount = Object.values(library.places).filter((p) =>
    p.address.startsWith('강원'),
  ).length;
  const cityCount = Object.values(library.places).filter(
    (p) => p.address.startsWith('강원') && p.address.includes('강릉시'),
  ).length;
  const region = page.getByRole('group', { name: '지역', exact: true });
  await expect(region.getByRole('button', { name: /^강릉/ })).toHaveCount(0);
  await region.getByRole('button', { name: /^강원 \d/ }).click();
  await expect(rowsOf(page)).toHaveCount(provinceCount);
  await region.getByRole('button', { name: /^강릉/ }).click();
  await expect(rowsOf(page)).toHaveCount(cityCount);
  if (isCompact(page))
    await page
      .getByRole('navigation', { name: '하단 메뉴' })
      .getByRole('link', { name: '지도' })
      .click();
  await expect(markers(page)).toHaveCount(cityCount);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('tripmap:prefs')!).query.regions),
    )
    .toEqual(['강원/강릉']);
});
