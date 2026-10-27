import { expect, type Locator, type Page } from '@playwright/test';
import { test, SEED_PLACE_COUNT, seedStorage } from './fixtures';

const rows = (page: Page): Locator =>
  page.getByRole('list', { name: '장소 목록' }).getByRole('listitem');

/** 강릉 중앙시장 근처(시드의 강릉 중앙시장 570m · 아르떼뮤지엄 강릉 2.4km). */
const HERE = { latitude: 37.7551, longitude: 128.9003, accuracy: 30 };

/** 좁은 화면(하단 탭·`/map` 이동·근처 칩)인가. 경계는 `use-layout`의 compact(<768)와 같다. */
const isCompact = (page: Page): boolean => page.viewportSize()!.width < 768;

/** 좁은 화면(iPhone·Galaxy)은 하단 탭이 있고 지도가 다른 화면이다. */
async function openMap(page: Page): Promise<void> {
  if (!isCompact(page)) return;
  await page
    .getByRole('navigation', { name: '하단 메뉴' })
    .getByRole('link', { name: '지도' })
    .click();
  await expect(page).toHaveURL(/\/map$/);
}

test.describe('내 근처 저장 장소', () => {
  test.use({ permissions: ['geolocation'], geolocation: HERE });

  // 스펙 §11: iPhone(WebKit)에서도 Playwright의 geolocation 흉내가 동작해(2026-10-16 확인) 가짜 위치를 따로 심지 않는다.
  test.beforeEach(async ({ page }) => {
    await seedStorage(page, { prefs: {} });
  });

  test('@smoke 가까운 순 → 반경 안 거리순 → 반경 바꾸기 → 지도 내 위치 → 위치가 저장되지 않는다', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(rows(page)).toHaveCount(SEED_PLACE_COUNT);

    // 보관함: 정렬 메뉴에서 가까운 순. 위치를 한 번 묻고 반경 3km 안만 거리순으로 보인다.
    await page.getByRole('button', { name: '최근 저장순' }).click();
    await page.getByRole('menuitemradio', { name: '가까운 순' }).click();
    await expect(page.getByRole('button', { name: '가까운 순', exact: true })).toBeVisible();
    const status = page.getByRole('status').filter({ hasText: '내 위치에서 3km 안' });
    await expect(status).toContainText('2곳');
    await expect(status).toContainText(`3km 밖 ${SEED_PLACE_COUNT - 2}곳은 숨김`);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toContainText('강릉 중앙시장');
    await expect(rows(page).nth(0)).toContainText('570m');
    await expect(rows(page).nth(1)).toContainText('아르떼뮤지엄 강릉');
    await expect(rows(page).nth(1)).toContainText('2.4km');

    // 반경 칩: 1km → 1곳, 전체 → 30곳.
    const radius = page.getByRole('group', { name: '반경' });
    await radius.getByRole('button', { name: '1km' }).click();
    await expect(radius.getByRole('button', { name: '1km' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: '내 위치에서 1km 안' })).toContainText(
      '1곳',
    );
    await radius.getByRole('button', { name: '전체' }).click();
    await expect(rows(page)).toHaveCount(SEED_PLACE_COUNT);
    await expect(
      page.getByRole('status').filter({ hasText: '내 위치에서 가까운 순' }),
    ).toContainText(`${SEED_PLACE_COUNT}곳`);
    await radius.getByRole('button', { name: '3km' }).click();
    await expect(rows(page)).toHaveCount(2);

    // 지도: 내 위치 보기 → 점(data-lat). 좁은 화면은 근처 칩도 보인다.
    await openMap(page);
    await page.getByRole('button', { name: '내 위치 보기' }).click();
    await expect(page.getByTestId('my-location')).toHaveAttribute('data-lat', '37.7551');
    if (isCompact(page)) {
      await expect(page.getByText('내 근처 3km')).toBeVisible();
    }

    // 개인정보: 위치 좌표가 localStorage 어디에도 없다. 새로고침하면 근처 모드는 꺼진다.
    const leaked = await page.evaluate(() => {
      const values: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key !== null) values.push(localStorage.getItem(key) ?? '');
      }
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key !== null) values.push(sessionStorage.getItem(key) ?? '');
      }
      return values.some((v) => v.includes('37.7551'));
    });
    expect(leaked).toBe(false);

    await page.reload();
    if (isCompact(page)) {
      await page
        .getByRole('navigation', { name: '하단 메뉴' })
        .getByRole('link', { name: '보관함' })
        .click();
    }
    await expect(page.getByRole('button', { name: '최근 저장순' })).toBeVisible();
    await expect(page.getByRole('group', { name: '반경' })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(SEED_PLACE_COUNT);
  });
});

test.describe('내 근처 저장 장소: 권한 거부', () => {
  test('가까운 순을 눌렀는데 위치 권한이 꺼져 있으면 안내 문구를 보인다', async ({ page }) => {
    await seedStorage(page, { prefs: {} });
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) => {
        fail?.({
          code: 1,
          message: '',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      };
    });
    await page.goto('/');

    await page.getByRole('button', { name: '최근 저장순' }).click();
    await page.getByRole('menuitemradio', { name: '가까운 순' }).click();
    // 데스크톱은 지도 영역에도 status(내 위치 알림)가 있어 문구로 좁힌다.
    await expect(
      page.getByRole('status').filter({
        hasText: '위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 켜 주세요',
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  });
});
