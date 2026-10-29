import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KakaoFeed } from '@sch0718/kakao-share';
import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';

declare global {
  interface Window {
    kakaoCalls: KakaoFeed[];
    kakaoInitKeys: string[];
    kakaoInitializedChecks: number;
  }
}

/** 모든 앱 시험에서 실제 카카오 CDN을 부르지 않는다. */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.route('https://t1.kakaocdn.net/**', (route) => route.abort());
    await provide(context);
  },
});

/** 옛 여행 가져오기 시험용 fixture(`global-setup`이 `public/data/`로 복사한다). */
export const E2E_PUBLIC_ID = 'e2etest000001';
export const E2E_FIXTURE_FILE = fileURLToPath(
  new URL('../fixtures/trips/e2e.json', import.meta.url),
);
export const E2E_DATA_FILE = fileURLToPath(
  new URL(`../../public/data/${E2E_PUBLIC_ID}.json`, import.meta.url),
);

/**
 * 내보낸 HTML 파일이 iframe으로 띄우는 지도 페이지 주소(e2e). `playwright.config.ts`가 `dist-map/`을
 * 이 포트로 내주고, global setup이 보기 화면 틀을 이 주소로 빌드한다(끝 `/`까지 같아야 Referer 확인이 맞다).
 */
export const SHARE_MAP_URL = 'http://localhost:5174/';
/** 보기 화면 틀 빌드 결과(앱이 내보낼 때 받아 가는 파일). */
export const SHARE_VIEWER_FILE = fileURLToPath(
  new URL('../../public/share-viewer.html', import.meta.url),
);
/** 보기 화면 틀(데이터 제외) 크기 한도. */
export const TEMPLATE_LIMIT = 51_200;
/** 보기 화면 링크가 가리키는 운영 앱 주소(빌드 기본값). 시험에서는 `baseURL`로 바꿔 쓴다. */
export const BUILD_APP_ORIGIN = 'https://landmark.sch0718.dev';

const SEED_FILE = fileURLToPath(new URL('../fixtures/library/seed.json', import.meta.url));

export const LIBRARY_KEY = 'tripmap:library:v2';
export const PREFS_KEY = 'tripmap:prefs';
export const HELP_SEEN_KEY = 'tripmap:help-seen:v1';
const HELP_PAGE_IDS = [
  'library',
  'map',
  'add',
  'place',
  'labels',
  'trips',
  'meetings',
  'share',
  'settings',
];

/** 보관함 시드 JSON 문자열(장소 30 · 라벨 6). */
export const seedJson: string = readFileSync(SEED_FILE, 'utf8');
export const seed = JSON.parse(seedJson) as {
  places: Record<string, { id: string; name: { value: string }; lng: number; lat: number }>;
  labels: Record<string, { id: string }>;
};
export const SEED_PLACE_COUNT = Object.keys(seed.places).length;

export type PrefsSeed = {
  theme?: 'pastel' | 'paper' | 'night';
  mode?: 'system' | 'light' | 'dark';
  libraryView?: 'bento' | 'cards' | 'tiles' | 'list';
};

/** UI 선호 JSON 문자열: 파스텔·라이트·목록 보기·필터 없음이 기본이고 `prefs`로 덮는다. */
export function prefsJson(prefs: PrefsSeed = {}): string {
  return JSON.stringify({
    theme: 'pastel',
    mode: 'light',
    libraryView: 'list',
    query: {
      labelIds: [],
      mode: 'any',
      unlabeled: false,
      regions: [],
      text: '',
      sort: 'recent',
    },
    ...prefs,
  });
}

/**
 * 첫 로드 전에 localStorage에 보관함 시드·UI 선호·도움말 확인 이력을 심는다. 이미 값이 있으면
 * 건드리지 않아서 새로고침 후에도 앱이 저장한 값이 유지된다. `helpSeen: false`면 안내를 확인할 수 있다.
 */
export async function seedStorage(
  page: Page,
  options: { library?: boolean; prefs?: PrefsSeed; helpSeen?: boolean } = {},
): Promise<void> {
  await page.context().route('https://t1.kakaocdn.net/**', (route) => route.abort());
  const { library = true, prefs, helpSeen = true } = options;
  const prefsValue = prefs === undefined ? null : prefsJson(prefs);
  await page.addInitScript(
    ({ libraryKey, prefsKey, helpSeenKey, libraryJson, prefsValue, helpSeenValue }) => {
      if (libraryJson !== null && localStorage.getItem(libraryKey) === null) {
        localStorage.setItem(libraryKey, libraryJson);
      }
      if (prefsValue !== null && localStorage.getItem(prefsKey) === null) {
        localStorage.setItem(prefsKey, prefsValue);
      }
      if (helpSeenValue !== null && localStorage.getItem(helpSeenKey) === null) {
        localStorage.setItem(helpSeenKey, helpSeenValue);
      }
    },
    {
      libraryKey: LIBRARY_KEY,
      prefsKey: PREFS_KEY,
      helpSeenKey: HELP_SEEN_KEY,
      libraryJson: library ? seedJson : null,
      prefsValue,
      helpSeenValue: helpSeen ? JSON.stringify(HELP_PAGE_IDS) : null,
    },
  );
}

/** 시드에서 이름으로 장소 id를 찾는다. */
export function placeIdByName(name: string): string {
  const found = Object.values(seed.places).find((p) => p.name.value === name);
  if (found === undefined) throw new Error(`시드에 없는 장소: ${name}`);
  return found.id;
}

/** 시드에서 "바다" 라벨이 붙은 장소 수. 이 장소들에는 바다·카페·산책·숙소·맛집 라벨이 함께 쓰인다. */
export const SEA_COUNT = 9;

/** 보관함에서 "바다"로 거른 뒤 내보내기 → 파일 저장. 받은 파일을 `.html` 이름으로 옮겨 그 경로를 준다. */
export async function exportSeaPlaces(page: Page, testInfo: TestInfo): Promise<string> {
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

/** 앱이 `/api/route`에서 받는 응답을 녹화해 둔 fixture(`tests/fixtures/routes/api/`). */
const routeFixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/routes/api/${name}`, import.meta.url)), 'utf8');

const ROUTE_REPLY: Record<'car' | 'walk' | 'transit', string> = {
  car: routeFixture('car.json'),
  walk: routeFixture('walk.json'),
  transit: JSON.stringify({
    mode: 'transit',
    distanceM: 12000,
    durationS: 1800,
    tollFare: null,
    fare: 1450,
    transfers: 1,
    walkS: 300,
    path: [],
    queriedAt: '2026-10-24T00:00:00.000Z',
  }),
};

/** 앱이 `/api/route`로 보낸 질의를 요청 순서대로 모은 것. */
export type RouteCall = { mode: string; from: string; to: string };

/** `/api/route`를 녹화 응답으로 대신한다. 실제 네트워크는 타지 않는다. */
export async function mockRoutes(page: Page): Promise<RouteCall[]> {
  const calls: RouteCall[] = [];
  await page.route('**/api/route?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const requested = params.get('mode');
    const mode = requested === 'transit' ? 'transit' : requested === 'walk' ? 'walk' : 'car';
    calls.push({ mode, from: params.get('from') ?? '', to: params.get('to') ?? '' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: ROUTE_REPLY[mode],
    });
  });
  return calls;
}

/** 좁은 화면(하단 시트)인가. */
export const isCompact = (page: Page): boolean => page.viewportSize()!.width < 768;

/** 좁은 화면의 일정 시트 탭을 연다. 넓은 화면에는 후보 칸과 시간표가 함께 보여 아무것도 하지 않는다. */
export async function openSheetTab(
  page: Page,
  name: 'candidates' | 'Day 1' | 'Day 2',
): Promise<void> {
  if (!isCompact(page)) return;
  const sheet = page.getByRole('region', { name: '일정 시트' });
  await sheet.getByRole('tab', { name: name === 'candidates' ? /^후보 / : name }).click();
}

/** 계획 화면의 후보 칸(좁은 화면은 일정 시트). */
export const candidatePanel = (page: Page): Locator =>
  isCompact(page)
    ? page.getByRole('region', { name: '일정 시트' })
    : page.getByRole('region', { name: '후보 칸' });

/** 계획 화면의 Day 시간표(좁은 화면은 일정 시트). */
export const timeline = (page: Page): Locator =>
  isCompact(page)
    ? page.getByRole('region', { name: '일정 시트' })
    : page.getByRole('region', { name: 'Day 시간표' });

/** 후보 이름으로 ＋(을/를은 받침으로 갈리므로 정규식으로 잡는다). */
export const addButton = (page: Page, name: string): Locator =>
  candidatePanel(page).getByRole('button', {
    name: new RegExp(`^${name}[을를] Day 1에 넣기$`),
  });

/** 보관함에서 지역 칩 `강릉` → `이 지역으로 여행 만들기` → 만들기. 계획 화면이 열린다. */
export async function createGangneungTrip(page: Page): Promise<void> {
  await seedStorage(page, { prefs: { libraryView: 'list' } });
  await page.goto('/');
  await page
    .getByRole('group', { name: '지역' })
    .getByRole('button', { name: /^강원 \d/ })
    .click();
  await page.getByRole('group', { name: '지역' }).getByRole('button', { name: /^강릉/ }).click();
  await page.getByRole('button', { name: '이 지역으로 여행 만들기' }).click();
  const dialog = page.getByRole('dialog', { name: '새 여행' });
  await expect(dialog.getByRole('textbox', { name: '여행 이름' })).toHaveValue('강릉 여행');
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await expect(candidatePanel(page).getByRole('heading', { name: '강릉 여행' })).toBeVisible();
}

/** Day 1 시간표의 장소 이름을 위에서부터. */
export async function day1Names(page: Page, names: string[]): Promise<string[]> {
  const rows = timeline(page).getByRole('list', { name: 'Day 1 일정' }).getByRole('listitem');
  const texts = await rows.allInnerTexts();
  return names
    .filter((name) => texts.some((t) => t.includes(name)))
    .sort((a, b) => texts.findIndex((t) => t.includes(a)) - texts.findIndex((t) => t.includes(b)));
}

/** 보관함(목록 보기)에 보이는 장소 행. */
export const rowsOf = (page: Page): Locator =>
  page.getByRole('list', { name: '장소 목록' }).getByRole('listitem');

/**
 * 내보낸 뒤의 보관함을 비운 상태로 되돌린다. 저장소 값을 빈 보관함·기본 UI 선호(필터 없음)로 덮고
 * 새로 불러온다(시드 심기는 값이 있으면 건드리지 않는다).
 */
export async function emptyLibrary(page: Page): Promise<void> {
  await page.evaluate(
    ({ libraryKey, prefsKey, prefs }) => {
      localStorage.setItem(
        libraryKey,
        JSON.stringify({ schemaVersion: 2, places: {}, labels: {}, trips: {} }),
      );
      localStorage.setItem(prefsKey, prefs);
    },
    { libraryKey: LIBRARY_KEY, prefsKey: PREFS_KEY, prefs: prefsJson() },
  );
  await page.goto('/');
  await expect(rowsOf(page)).toHaveCount(0);
}

/** 보관함 화면의 ＋ → 시트의 `공유 파일 가져오기` → `파일 고르기`에 파일을 준다. */
export async function pickFromSheet(page: Page, file: string): Promise<void> {
  await page.getByRole('button', { name: '장소 추가', exact: true }).first().click();
  const item = page
    .getByRole('dialog', { name: '장소 추가' })
    .getByRole('button', { name: '공유 파일 가져오기' });
  await item.click();
  await expect(item).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: '파일 고르기' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(file);
}

/** 약속 출발지 이름 검색을 작은 고정 응답으로 대신한다. */
export async function mockSearch(
  page: Page,
  results = [
    {
      name: '원주 출발',
      address: '강원특별자치도 원주시',
      category: '역',
      lng: 127.921887,
      lat: 37.315942,
    },
  ],
): Promise<void> {
  await page.route('**/api/search?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ results }),
    }),
  );
}

/** 외부 앱을 열지 않고 SDK가 받은 카드를 기록한다. */
export async function fakeKakao(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let initialized = false;
    const calls: KakaoFeed[] = [];
    const initKeys: string[] = [];
    Object.assign(window, {
      kakaoCalls: calls,
      kakaoInitKeys: initKeys,
      kakaoInitializedChecks: 0,
    });
    // 실제 SDK처럼 `init` 뒤에야 `Share`를 붙인다.
    const kakao: Record<string, unknown> = {
      init: (appKey: string) => {
        initKeys.push(appKey);
        initialized = true;
        kakao.Share = {
          sendDefault: (card: KakaoFeed) => {
            calls.push(card);
          },
        };
      },
      isInitialized: () => {
        window.kakaoInitializedChecks += 1;
        return initialized;
      },
    };
    Object.assign(window, { Kakao: kakao });
  });
}
