import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  addButton,
  BUILD_APP_ORIGIN,
  candidatePanel,
  createGangneungTrip,
  day1Names,
  emptyLibrary,
  mockRoutes,
  openSheetTab,
  pickFromSheet,
  SHARE_VIEWER_FILE,
  TEMPLATE_LIMIT,
  timeline,
} from './fixtures';

/**
 * 여행 일정 공유(스펙 §15.2). 강릉 여행(2일)의 Day 1에 3곳을 넣고 숙소를 정한 뒤 `일정 공유` → `파일 저장`으로
 * 일정 파일(v2)을 받는다. `/api/route`는 녹화 응답(`mockRoutes`)이고, 파일 안 지도 페이지는 가짜 지도 빌드라
 * iframe 안에 마커 버튼(`marker-<핀 id>`, 라벨 글자·강조는 `aria-pressed`, 흐린 점은 `data-dimmed`)과
 * 경로선(`polyline-<구간 id>`)을 DOM으로 그린다.
 */

const TRIP_TITLE = '강릉 여행';
/** Day 1에 넣는 순서. */
const STOPS = ['초당순두부 본점', '경포대', '오죽헌'] as const;
const LODGING = '강릉 씨마크 호텔';
/** 출발지가 없어 Day 1 구간은 장소 사이 둘과 마지막 장소 → 숙소 하나. */
const DAY1_LEGS = 3;

/** 강릉 여행을 만들어 Day 1에 3곳·숙소를 정하고, `일정 공유`로 파일을 받아 `.html` 경로를 준다. */
async function exportTrip(page: Page, testInfo: TestInfo): Promise<string> {
  await mockRoutes(page);
  await createGangneungTrip(page);
  for (const name of STOPS) await addButton(page, name).click();
  await openSheetTab(page, 'Day 1');
  await expect.poll(() => day1Names(page, [...STOPS])).toEqual(STOPS);

  await timeline(page).getByRole('button', { name: '숙소 정하기' }).click();
  const picker = page.getByRole('dialog', { name: '숙소 정하기' });
  await picker.getByRole('button', { name: new RegExp(`^${LODGING}`) }).click();
  await expect(picker).toBeHidden();
  await expect(timeline(page).getByRole('button', { name: '숙소 바꾸기' })).toBeVisible();

  await timeline(page).getByRole('button', { name: '일정 공유', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '일정 공유' });
  await expect(dialog).toContainText(`‘${TRIP_TITLE}’ 일정을 HTML 파일 하나로 만들어요`);
  await expect(dialog).toContainText(`일정 ${STOPS.length}곳`);
  // 모든 구간의 경로를 받은 뒤에 저장한다(받는 중이면 그 구간은 어림값으로 들어간다).
  await expect(dialog.getByRole('status')).toHaveText(/^이동 시간은 \d+월 \d+일 조회 기준이에요$/);
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

/** 보기 화면 Day 목록에서 장소 이름으로 그 행(`article`). */
const stopRow = (viewer: Page, list: Locator, name: string): Locator =>
  list.getByRole('article').filter({ has: viewer.getByRole('heading', { name, exact: true }) });

test.describe('여행 일정 공유', () => {
  test('@smoke 일정 공유 파일을 file://로 열면 Day 탭·시간표·번호 마커·경로선이 보인다', async ({
    page,
  }, testInfo) => {
    const file = await exportTrip(page, testInfo);

    const viewer = await page.context().newPage();
    // 파일 문서(메인 프레임)가 직접 부르는 요청만 모은다. iframe 안의 지도 페이지 요청은 따로다.
    const fileRequests: string[] = [];
    viewer.on('request', (request) => {
      if (request.frame() === viewer.mainFrame()) fileRequests.push(request.url());
    });
    await viewer.goto(pathToFileURL(file).href);

    // 머리글과 Day 탭: 처음에는 Day 1.
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(TRIP_TITLE);
    const tabs = viewer.getByRole('tablist', { name: 'Day 고르기' });
    const day1Tab = tabs.getByRole('tab', { name: /^Day 1 / });
    const day2Tab = tabs.getByRole('tab', { name: /^Day 2 / });
    await expect(day1Tab).toHaveAttribute('aria-selected', 'true');
    await expect(day2Tab).toHaveAttribute('aria-selected', 'false');

    // 시간표: 장소 행 3개(넣은 순서), 구간 문구, 합계 줄, 조회 줄.
    const day1 = viewer.getByRole('list', { name: 'Day 1 일정' });
    await expect(day1.getByRole('heading', { level: 2 })).toHaveText([...STOPS]);
    const legTexts = day1.getByText(/^(자동차|도보) \S.* · [\d.,]+k?m$/);
    await expect(legTexts).toHaveCount(DAY1_LEGS);
    await expect(day1.getByText(/^이동 .+ · [\d.,]+k?m/)).toBeVisible();
    await expect(day1.getByText(/^\d{1,2}월 \d{1,2}일 조회$/)).toBeVisible();
    await expect(day1.getByText(`도착 · 🛏 ${LODGING}`, { exact: false })).toBeVisible();

    // 지도: 번호 라벨이 `1 `로 시작하는 마커 하나, 경로선 수 = 그날 구간 수.
    const map = viewer.locator('iframe[title="지도"]').contentFrame();
    await expect(map.getByTestId('fake-map')).toBeVisible();
    const markers = map.locator('[data-testid^="marker-"]');
    const named = map.locator('[data-testid^="marker-"]:not([data-dimmed])');
    const dimmed = map.locator('[data-testid^="marker-"][data-dimmed]');
    const lines = map.locator('[data-testid^="polyline-"]');
    const markerNamed = (name: string): Locator => markers.filter({ hasText: name });
    await expect(markers.filter({ hasText: /^1 / })).toHaveCount(1);
    await expect(markers.filter({ hasText: /^1 / })).toHaveText(`1 ${STOPS[0]}`);
    // Day 1: 장소 3곳 + 숙소, 다른 Day의 점은 없다.
    await expect(named).toHaveCount(STOPS.length + 1);
    await expect(dimmed).toHaveCount(0);
    await expect(lines).toHaveCount(DAY1_LEGS);

    // Day 2 탭 → 장소가 없는 날: 전날 숙소에서 출발하는 마커 하나, Day 1 장소는 흐린 점, 경로선 없음.
    await day2Tab.click();
    await expect(day2Tab).toHaveAttribute('aria-selected', 'true');
    const day2 = viewer.getByRole('list', { name: 'Day 2 일정' });
    await expect(day2.getByText('이 날은 아직 일정이 없어요')).toBeVisible();
    await expect(day2.getByText(`출발 · 🛏 ${LODGING}`, { exact: false })).toBeVisible();
    await expect(named).toHaveCount(1);
    await expect(named).toHaveText(`🛏 ${LODGING}`);
    await expect(dimmed).toHaveCount(STOPS.length);
    await expect(lines).toHaveCount(0);
    await expect(markers.filter({ hasText: /^1 / })).toHaveCount(0);

    // Day 1로 돌아와 행을 누르면 그 마커가 강조된다.
    await day1Tab.click();
    await expect(lines).toHaveCount(DAY1_LEGS);
    const [, second, third] = STOPS;
    await stopRow(viewer, day1, second).getByRole('heading').click();
    await expect(stopRow(viewer, day1, second)).toHaveAttribute('aria-current', 'true');
    await expect(markerNamed(`2 ${second}`)).toHaveAttribute('aria-pressed', 'true');

    // 마커를 누르면 그 행이 현재 행이 되고, 앞 행은 풀린다. 가짜 지도는 마커를 한 줄로 늘어놓아 넓은 화면에서
    // 다음 마커(숙소)의 라벨이 이 마커를 덮으므로, 좌표 클릭 대신 마커 버튼에 click 이벤트를 보낸다.
    await markerNamed(`3 ${third}`).dispatchEvent('click');
    await expect(stopRow(viewer, day1, third)).toHaveAttribute('aria-current', 'true');
    await expect(stopRow(viewer, day1, second)).not.toHaveAttribute('aria-current', 'true');

    // 파일은 외부 스크립트를 직접 불러오지 않는다(JS는 틀 안에 들어 있다).
    const scripts = fileRequests.filter((url) => /\.js($|[?#])/.test(new URL(url).pathname));
    expect(scripts).toEqual([]);
    // 보기 화면 틀(데이터 제외) 크기 한도.
    expect(statSync(SHARE_VIEWER_FILE).size).toBeLessThanOrEqual(TEMPLATE_LIMIT);
  });

  test('Landmark에 담기로 새 여행이 생기고, 같은 파일을 한 번 더 가져오면 같은 이름 여행이 둘이다', async ({
    page,
    baseURL,
  }, testInfo) => {
    const file = await exportTrip(page, testInfo);
    await emptyLibrary(page);

    // 보기 화면의 `Landmark에 담기` 주소(압축이 끝나면 해시가 붙는다)를 테스트 앱 주소로 바꾼다.
    const viewer = await page.context().newPage();
    await viewer.goto(pathToFileURL(file).href);
    const link = viewer.getByRole('link', { name: 'Landmark에 담기' });
    await expect(link).toHaveAttribute('href', /\/import#d=/);
    const href = (await link.getAttribute('href'))!;
    expect(href.startsWith(`${BUILD_APP_ORIGIN}/import#d=`)).toBe(true);
    await viewer.close();
    const base = baseURL!.replace(/\/$/, '');
    await page.goto(href.replace(BUILD_APP_ORIGIN, base));

    // 미리보기의 여행 칸: 제목·`여행 계획도 가져오기`(켬), 아직 같은 여행이 없어 경고는 없다.
    await expect(page).toHaveURL(`${base}/`);
    await expect(page.getByRole('heading', { level: 3, name: TRIP_TITLE })).toBeVisible();
    await expect(page.getByRole('switch', { name: '여행 계획도 가져오기' })).toBeChecked();
    const duplicate = page.getByText(
      '같은 이름·기간의 여행이 이미 있어요. 가져오면 하나 더 생겨요',
    );
    await expect(duplicate).toHaveCount(0);
    await page.getByRole('button', { name: '여행 가져오기', exact: true }).click();

    // 새 여행의 계획 화면: 제목과 Day 1 장소 순서가 보낸 것과 같다.
    await expect(page).toHaveURL(/\/trips\/[^/]+$/);
    await expect(page.getByText(`여행 ‘${TRIP_TITLE}’을 가져왔어요`).first()).toBeVisible();
    await expect(candidatePanel(page).getByRole('heading', { name: TRIP_TITLE })).toBeVisible();
    await openSheetTab(page, 'Day 1');
    await expect.poll(() => day1Names(page, [...STOPS])).toEqual(STOPS);

    // 같은 파일을 `공유 파일 가져오기`로 한 번 더: 경고가 나오고, 가져오면 같은 이름 여행이 둘이다.
    await page.goto('/');
    await pickFromSheet(page, file);
    await expect(page.getByRole('heading', { level: 3, name: TRIP_TITLE })).toBeVisible();
    await expect(duplicate).toBeVisible();
    await page.getByRole('button', { name: '여행 가져오기', exact: true }).click();
    await expect(page).toHaveURL(/\/trips\/[^/]+$/);

    await page.goto('/trips');
    await expect(
      page.getByRole('heading', { level: 2, name: TRIP_TITLE, exact: true }),
    ).toHaveCount(2);
  });
});
