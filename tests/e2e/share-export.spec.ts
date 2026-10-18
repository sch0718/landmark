import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  exportSeaPlaces,
  SEA_COUNT,
  SHARE_MAP_URL,
  SHARE_VIEWER_FILE,
  TEMPLATE_LIMIT,
} from './fixtures';

/**
 * 내보낸 HTML 파일을 `file://`로 열어 확인한다(spec §6.2–§6.3).
 * 지도 페이지는 `playwright.config.ts`가 `dist-map/`을 `SHARE_MAP_URL`로 띄우고, 틀은 global setup이
 * 그 주소로 빌드한다. 지도 페이지는 `VITE_MAP_ADAPTER=fake`로 빌드한 것이라(`yarn build:map:e2e`)
 * 네이버 인증 없이 DOM 가짜 지도(`FakeMapAdapter`)에 마커 버튼(`data-testid="marker-<id>"`)을 그린다.
 * 강조된 마커는 `aria-pressed="true"`다.
 */

const MAP_FAILED = '지도를 불러오지 못했어요. 목록과 네이버 지도 링크는 그대로 쓸 수 있어요';
/** 그중 "카페" 라벨도 붙은 곳: 강릉(안목)과 제주(애월)라 처음 맞춘 지도에서 마커가 겹치지 않는다. */
const SEA_CAFES = ['안목해변 커피거리', '애월 카페거리'];

const cardsOf = (page: Page): Locator =>
  page.getByRole('list', { name: '장소 목록' }).locator('article[data-place-id]');
const cardNamed = (page: Page, name: string): Locator =>
  cardsOf(page).filter({ has: page.getByRole('heading', { name, exact: true }) });

test.describe('HTML 내보내기 파일', () => {
  test('@smoke 라벨로 거른 장소를 HTML로 내보내고 file://로 열면 목록과 지도가 보인다', async ({
    page,
  }, testInfo) => {
    const file = await exportSeaPlaces(page, testInfo);
    const context = page.context();

    const viewer = await context.newPage();
    // 파일 문서(메인 프레임)가 직접 부르는 요청만 모은다. iframe 안의 지도 페이지 요청은 따로다.
    const fileRequests: string[] = [];
    viewer.on('request', (request) => {
      if (request.frame() === viewer.mainFrame()) fileRequests.push(request.url());
    });
    await viewer.goto(pathToFileURL(file).href);

    // 목록: 거른 수만큼 카드.
    await expect(viewer.getByRole('heading', { level: 1 })).toBeVisible();
    const cards = cardsOf(viewer);
    await expect(cards).toHaveCount(SEA_COUNT);

    // 지도: iframe 안 마커가 같은 수.
    const iframe = viewer.locator('iframe[title="지도"]');
    await expect(iframe).toBeVisible();
    const map = iframe.contentFrame();
    await expect(map.getByTestId('fake-map')).toBeVisible();
    const markers = map.locator('[data-testid^="marker-"]');
    await expect(markers).toHaveCount(SEA_COUNT);
    const markerNamed = (name: string): Locator =>
      map.locator('[data-testid^="marker-"]', { hasText: name });

    // 라벨 칩 하나 → 카드와 마커가 함께 준다.
    const chips = viewer.getByRole('group', { name: '라벨' });
    await expect(chips.getByRole('button', { name: '모두' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await chips.getByRole('button', { name: '카페', exact: true }).click();
    await expect(viewer.locator('article[data-place-id]:visible')).toHaveCount(SEA_CAFES.length);
    await expect(markers).toHaveCount(SEA_CAFES.length);

    // 마커 클릭 → 그 카드가 현재 카드.
    const [gangneung, jeju] = SEA_CAFES as [string, string];
    await markerNamed(jeju).click();
    await expect(cardNamed(viewer, jeju)).toHaveAttribute('aria-current', 'true');
    await expect(markerNamed(jeju)).toHaveAttribute('aria-pressed', 'true');

    // 다른 카드 클릭 → 그 마커가 강조, 앞 카드는 현재 카드가 아니고 앞 마커도 풀린다.
    await cardNamed(viewer, gangneung).getByRole('heading').click();
    await expect(cardNamed(viewer, gangneung)).toHaveAttribute('aria-current', 'true');
    await expect(cardNamed(viewer, jeju)).not.toHaveAttribute('aria-current', 'true');
    await expect(markerNamed(gangneung)).toHaveAttribute('aria-pressed', 'true');
    await expect(markerNamed(jeju)).not.toHaveAttribute('aria-pressed', 'true');

    // 카드로 고른 뒤 다른 마커 클릭 → 그 마커로 강조가 옮겨 가고, 앞 마커는 풀린다.
    await markerNamed(jeju).click();
    await expect(cardNamed(viewer, jeju)).toHaveAttribute('aria-current', 'true');
    await expect(markerNamed(jeju)).toHaveAttribute('aria-pressed', 'true');
    await expect(markerNamed(gangneung)).not.toHaveAttribute('aria-pressed', 'true');

    // 네이버 지도 링크.
    const href = await cards
      .first()
      .getByRole('link', { name: '네이버 지도에서 보기' })
      .getAttribute('href');
    expect(href).toMatch(/^https:\/\/map\.naver\.com\/p\//);

    // 파일은 외부 스크립트를 직접 불러오지 않는다(JS는 틀 안에 들어 있다).
    const scripts = fileRequests.filter((url) => /\.js($|[?#])/.test(new URL(url).pathname));
    expect(scripts).toEqual([]);
  });

  test('지도 페이지가 없으면 10초 뒤 안내가 나오고 목록은 그대로다', async ({ page }, testInfo) => {
    const file = await exportSeaPlaces(page, testInfo);
    const context = page.context();
    await context.route(`${SHARE_MAP_URL}**`, (route) => route.abort());

    const viewer = await context.newPage();
    await viewer.goto(pathToFileURL(file).href);
    await expect(cardsOf(viewer)).toHaveCount(SEA_COUNT);
    await expect(viewer.getByText(MAP_FAILED)).toBeVisible({ timeout: 12_000 });
    await expect(cardsOf(viewer)).toHaveCount(SEA_COUNT);
    await expect(
      cardsOf(viewer).first().getByRole('link', { name: '네이버 지도에서 보기' }),
    ).toBeVisible();
  });

  test('@smoke 틀 크기', () => {
    expect(statSync(SHARE_VIEWER_FILE).size).toBeLessThanOrEqual(TEMPLATE_LIMIT);
  });
});
