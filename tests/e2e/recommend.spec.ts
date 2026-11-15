import { expect } from '@playwright/test';
import { test, emptyLibrary, rowsOf, seedStorage } from './fixtures';

test('추천 핀의 장소를 먼저 보고 카드로 담은 뒤 숨긴 추천을 복원한다', async ({ page }) => {
  await page.route('**/api/sync/v1/recommendations', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'label001',
            title: '가을 단풍',
            description: '함께 걷기 좋은 곳',
            startDate: '2026-11-01',
            endDate: '2026-11-30',
            places: 3,
            createdAt: 1,
            updatedAt: 1,
            doc: {
              format: 'tripmap-share',
              version: 1,
              title: '옛 제목',
              createdAt: '2026-11-01T00:00:00.000Z',
              labels: [],
              places: [
                {
                  id: 'place001',
                  name: '단풍길',
                  address: '서울',
                  lng: 127,
                  lat: 37.5,
                  labelIds: [],
                },
                {
                  id: 'place002',
                  name: '은행나무길',
                  address: '서울',
                  lng: 127.02,
                  lat: 37.52,
                  labelIds: [],
                },
                {
                  id: 'place003',
                  name: '가을 숲',
                  address: '서울',
                  lng: 127.01,
                  lat: 37.51,
                  labelIds: [],
                },
              ],
            },
          },
        ],
      },
    }),
  );
  await seedStorage(page);
  await page.goto('/');
  await emptyLibrary(page);
  await page.getByRole('button', { name: '☆ 가을 숲', exact: true }).click();
  const places = page.getByRole('list', { name: '가져올 장소', exact: true });
  await expect(places.getByRole('listitem')).toHaveText([
    '가을 숲서울',
    '단풍길서울',
    '은행나무길서울',
  ]);
  await expect(places.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await expect(places.getByRole('checkbox', { name: /가을 숲/ })).toBeChecked();
  await page.getByRole('button', { name: '취소', exact: true }).click();

  const section = page.getByRole('region', { name: '추천', exact: true });
  await section.getByRole('button', { name: /^가을 단풍.*3곳/ }).click();
  await expect(page.getByRole('heading', { name: '가을 단풍 · 3곳', exact: true })).toBeVisible();
  await expect(places.getByRole('listitem')).toHaveText([
    '단풍길서울',
    '은행나무길서울',
    '가을 숲서울',
  ]);
  await expect(page.getByRole('switch', { name: '추천 제목 라벨도 붙이기' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: '추천 제목 라벨 이름' })).toHaveValue('가을 단풍');
  await page.getByRole('button', { name: '3곳 가져오기', exact: true }).click();
  await expect(page.getByText('3곳을 새로 넣었어요', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: '라벨', exact: true })
      .getByRole('button', { name: /^가을 단풍/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(rowsOf(page)).toHaveCount(3);
  await section.getByRole('button', { name: '가을 단풍 추천 숨기기', exact: true }).click();
  await expect(section).toHaveCount(0);
  const restore = page.getByRole('button', { name: '숨긴 추천 다시 보기', exact: true });
  await expect(restore).toBeVisible();
  await expect(
    page.locator('section[aria-label="추천"]').getByRole('button', {
      name: '숨긴 추천 다시 보기',
      exact: true,
    }),
  ).toHaveCount(0);
  await restore.click();
  await expect(section).toBeVisible();
  await expect(section.getByRole('button', { name: /^가을 단풍.*3곳/ })).toBeFocused();
  await expect(restore).toHaveCount(0);
});
