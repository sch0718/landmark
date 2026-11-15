import { expect } from '@playwright/test';
import { test, emptyLibrary, rowsOf, seedStorage } from './fixtures';

test('추천 카드에서 메타 제목으로 미리 보고 담은 뒤 카드를 숨긴다', async ({ page }) => {
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
            places: 2,
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
  const section = page.getByRole('region', { name: '추천', exact: true });
  await section.getByRole('button', { name: /^가을 단풍.*2곳/ }).click();
  await expect(page.getByRole('heading', { name: '가을 단풍 · 2곳', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: '추천 제목 라벨도 붙이기' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: '추천 제목 라벨 이름' })).toHaveValue('가을 단풍');
  await page.getByRole('button', { name: '2곳 가져오기', exact: true }).click();
  await expect(page.getByText('2곳을 새로 넣었어요', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: '라벨', exact: true })
      .getByRole('button', { name: /^가을 단풍/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(rowsOf(page)).toHaveCount(2);
  await section.getByRole('button', { name: '가을 단풍 추천 숨기기', exact: true }).click();
  await expect(section).toHaveCount(0);
});
