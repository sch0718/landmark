import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { SHARE_MAP_URL, SHARE_VIEWER_FILE, seedStorage } from './fixtures';

/**
 * 내보낸 HTML 파일을 `file://`로 열어 확인한다(spec §6.2–§6.3).
 * 지도 페이지는 `playwright.config.ts`가 `dist-map/`을 `SHARE_MAP_URL`로 띄우고, 틀은 global setup이
 * 그 주소로 빌드한다. OSM 타일은 가로채 1×1 PNG를 돌려준다(실제 타일 서버에 요청하지 않는다).
 */

const MAP_FAILED = '지도를 불러오지 못했어요. 목록과 네이버 지도 링크는 그대로 쓸 수 있어요';
/** 보기 화면 틀(데이터 제외) 크기 한도. */
const TEMPLATE_LIMIT = 51_200;
/** 시드에서 "바다" 라벨이 붙은 장소 수. 이 장소들에는 바다·카페·산책·숙소·맛집 라벨이 함께 쓰인다. */
const SEA_COUNT = 9;
/** 그중 "카페" 라벨도 붙은 곳: 강릉(안목)과 제주(애월)라 처음 맞춘 지도에서 마커가 겹치지 않는다. */
const SEA_CAFES = ['안목해변 커피거리', '애월 카페거리'];

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** 보관함에서 "바다"로 거른 뒤 내보내기 → 파일 저장. 받은 파일을 `.html` 이름으로 옮겨 그 경로를 준다. */
async function exportSeaPlaces(page: Page, testInfo: TestInfo): Promise<string> {
  await seedStorage(page, { prefs: { libraryView: 'list' } });
  await page.goto('/');

  const chip = page.getByRole('group', { name: '라벨' }).getByRole('button', { name: /^바다/ });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('list', { name: '장소 목록' }).getByRole('listitem')).toHaveCount(
    SEA_COUNT,
  );

  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '내보내기' });
  await expect(dialog).toContainText(`지금 보이는 ${SEA_COUNT}곳을 내보냅니다 (라벨: 바다)`);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: '파일 저장' }).click(),
  ]);
  expect(await download.failure()).toBeNull();
  // `download.path()`의 임시 파일은 확장자가 없어 브라우저가 HTML로 열지 않는다. 받은 이름 그대로 옮긴다.
  const file = testInfo.outputPath(download.suggestedFilename());
  expect(file.endsWith('.html')).toBe(true);
  await download.saveAs(file);
  return file;
}

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

    const referers: string[] = [];
    await context.route('https://tile.openstreetmap.org/**', async (route) => {
      referers.push((await route.request().headerValue('referer')) ?? '');
      await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
    });

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
    const markers = map.locator('.leaflet-marker-icon');
    await expect(markers).toHaveCount(SEA_COUNT);
    const markerLabel = (name: string): Locator =>
      map.locator('.leaflet-marker-icon', { hasText: name }).locator('span');

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
    await markerLabel(jeju).click();
    await expect(cardNamed(viewer, jeju)).toHaveAttribute('aria-current', 'true');

    // 다른 카드 클릭 → 그 마커가 강조(3px 테두리), 앞 카드는 현재 카드가 아니다.
    await cardNamed(viewer, gangneung).getByRole('heading').click();
    await expect(cardNamed(viewer, gangneung)).toHaveAttribute('aria-current', 'true');
    await expect(cardNamed(viewer, jeju)).not.toHaveAttribute('aria-current', 'true');
    await expect(markerLabel(gangneung)).toHaveCSS('border-top-width', '3px');
    await expect(markerLabel(jeju)).toHaveCSS('border-top-width', '2px');

    // 네이버 지도 링크.
    const href = await cards
      .first()
      .getByRole('link', { name: '네이버 지도에서 보기' })
      .getAttribute('href');
    expect(href).toMatch(/^https:\/\/map\.naver\.com\/p\//);

    // 타일 요청에는 지도 페이지 출처가 Referer로 붙는다(OSM 이용 정책).
    await expect.poll(() => referers.length).toBeGreaterThan(0);
    for (const referer of referers) expect(referer.startsWith(SHARE_MAP_URL)).toBe(true);

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

  test('틀 크기', () => {
    expect(statSync(SHARE_VIEWER_FILE).size).toBeLessThanOrEqual(TEMPLATE_LIMIT);
  });
});
