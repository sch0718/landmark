import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo } from '@playwright/test';

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

const SEED_FILE = fileURLToPath(new URL('../fixtures/library/seed.json', import.meta.url));

export const LIBRARY_KEY = 'tripmap:library:v2';
export const PREFS_KEY = 'tripmap:prefs';

/** 보관함 시드 JSON 문자열(장소 30 · 라벨 6). */
export const seedJson: string = readFileSync(SEED_FILE, 'utf8');
export const seed = JSON.parse(seedJson) as {
  places: Record<string, { id: string; name: { value: string } }>;
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
 * 첫 로드 전에 localStorage에 보관함 시드(와 UI 선호)를 심는다. 이미 값이 있으면 건드리지 않아서
 * 새로고침 후에도 앱이 저장한 값이 유지된다.
 */
export async function seedStorage(
  page: Page,
  options: { library?: boolean; prefs?: PrefsSeed } = {},
): Promise<void> {
  const { library = true, prefs } = options;
  const prefsValue = prefs === undefined ? null : prefsJson(prefs);
  await page.addInitScript(
    ({ libraryKey, prefsKey, libraryJson, prefsValue }) => {
      if (libraryJson !== null && localStorage.getItem(libraryKey) === null) {
        localStorage.setItem(libraryKey, libraryJson);
      }
      if (prefsValue !== null && localStorage.getItem(prefsKey) === null) {
        localStorage.setItem(prefsKey, prefsValue);
      }
    },
    {
      libraryKey: LIBRARY_KEY,
      prefsKey: PREFS_KEY,
      libraryJson: library ? seedJson : null,
      prefsValue,
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
