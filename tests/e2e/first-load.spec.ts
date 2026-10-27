import { expect, type Locator, type Page } from '@playwright/test';
import { test, seedStorage } from './fixtures';

/**
 * 첫 로딩(D2 스펙 §7). 첫 화면이 아닌 화면은 나눠 받으므로, 메뉴 이동·직접 진입·받기 실패를 실제 앱에서 본다.
 * E2E 앱은 Vite 개발 서버라 나눠 받는 모듈 주소가 소스 경로(`/src/sections/trips/TripsPage.tsx`)다.
 */
const TRIPS_PAGE_MODULE = '**/src/sections/trips/TripsPage.tsx*';

/** 넓은 화면은 사이드 메뉴, 좁은 화면은 하단 메뉴. */
const menu = (page: Page): Locator =>
  page.getByRole('navigation', { name: /^(사이드|하단) 메뉴$/ });

const pageHeading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 1, name, exact: true });

test('첫 화면을 연 뒤 메뉴로 여행·설정·라벨 관리 화면에 간다', async ({ page }) => {
  await seedStorage(page);
  await page.goto('/');
  await expect(menu(page)).toBeVisible();

  await menu(page).getByRole('link', { name: '여행', exact: true }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(pageHeading(page, '여행')).toBeVisible();

  await menu(page).getByRole('link', { name: '설정', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(pageHeading(page, '설정')).toBeVisible();

  // 라벨 관리는 메뉴 항목이 없고 보관함 라벨 줄의 `라벨 관리` 링크로 간다.
  await menu(page).getByRole('link', { name: '보관함', exact: true }).click();
  await page.getByRole('link', { name: '라벨 관리' }).click();
  await expect(page).toHaveURL(/\/labels$/);
  await expect(pageHeading(page, '라벨 관리')).toBeVisible();
});

test('/trips를 주소로 바로 열면 셸(메뉴)이 먼저 그려지고 여행 화면이 뒤따른다', async ({
  page,
}) => {
  // 여행 화면 모듈 응답을 붙잡아 두고, 그동안 셸과 화면 자리의 기다림 표시가 보이는지 본다.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = 0;
  await page.route(TRIPS_PAGE_MODULE, async (route) => {
    requested += 1;
    await held;
    await route.continue();
  });
  await seedStorage(page);
  await page.goto('/trips');

  await expect(menu(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '불러오는 중…' })).toBeVisible();
  await expect(pageHeading(page, '여행')).toHaveCount(0);
  expect(requested).toBeGreaterThan(0);

  release();
  await expect(pageHeading(page, '여행')).toBeVisible();
  await expect(menu(page)).toBeVisible();
});

test('나중에 받는 화면 파일이 없으면(새 배포 뒤) 새 버전 안내와 새로고침 버튼을 보인다', async ({
  page,
}) => {
  let blocked = 0;
  await page.route(TRIPS_PAGE_MODULE, (route) => {
    blocked += 1;
    return route.fulfill({ status: 404 });
  });
  await seedStorage(page);
  await page.goto('/');
  await expect(menu(page)).toBeVisible();

  await menu(page).getByRole('link', { name: '여행', exact: true }).click();
  await expect(page.getByText('새 버전이 나왔어요. 새로고침해 주세요')).toBeVisible();
  await expect(page.getByRole('button', { name: '새로고침' })).toBeVisible();
  expect(blocked).toBeGreaterThan(0);
});
