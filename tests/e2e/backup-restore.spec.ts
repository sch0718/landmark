import { readFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { test, LIBRARY_KEY, seed, seedJson, SEED_PLACE_COUNT, seedStorage } from './fixtures';

/**
 * 전체 백업·복원(스펙 §8): 백업 파일 받기 → 보관함이 비어도 그 파일로 되살리기 → 되돌리기 →
 * 보관함 문서가 손상된 화면에서 되살리기. 저장소 내용은 `localStorage`를 직접 읽어 확인한다.
 */

type Json = Record<string, unknown>;

const TRIP_ID = 'tr01abcdef';
const TRIP_TITLE = '백업 시험 여행';
const EXTRA_PLACE_ID = 'plxxabcdef';
const NUMBERS = `장소 ${SEED_PLACE_COUNT}곳 · 라벨 6개 · 여행 1개`;
const BACKUP_NAME = /^landmark-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;

const stamp = '2026-10-10T00:00:00.000Z';
const field = <T>(value: T) => ({ value, updatedAt: stamp });

/** 시드 보관함에 여행 하나(1일, 후보 한 곳)를 더한 문서. */
function libraryWithTrip(): Json {
  const library = JSON.parse(seedJson) as Json;
  const firstPlaceId = Object.keys(seed.places)[0]!;
  library.trips = {
    [TRIP_ID]: {
      id: TRIP_ID,
      title: field(TRIP_TITLE),
      startDate: field('2026-11-01'),
      endDate: field('2026-11-01'),
      origin: field(null),
      candidates: field([firstPlaceId]),
      days: [{ stops: field([]), lodging: field(null), startTime: field('09:00') }],
      legModes: field({}),
      createdAt: stamp,
      deletedAt: null,
    },
  };
  return library;
}

/** 위 문서에 장소 하나를 더한 것(되살린 뒤 보관함이 바뀐 상태). */
function withExtraPlace(library: Json): Json {
  const places = library.places as Record<string, Json>;
  const template = places[Object.keys(places)[0]!]!;
  return {
    ...library,
    places: {
      ...places,
      [EXTRA_PLACE_ID]: {
        ...template,
        id: EXTRA_PLACE_ID,
        source: { kind: 'naver', sid: '2999999' },
        name: field('나중에 넣은 장소'),
        labelIds: field([]),
      },
    },
  };
}

/** 첫 방문 때 한 번만 저장소에 원문을 심는다(탭 세션 표시로 구분해서, 지운 뒤 새로고침해도 다시 심지 않는다). */
async function seedOnce(page: Page, text: string): Promise<void> {
  await seedStorage(page, { library: false });
  await page.addInitScript(
    ({ key, value }) => {
      if (sessionStorage.getItem('e2e:seeded') === null) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('e2e:seeded', '1');
      }
    },
    { key: LIBRARY_KEY, value: text },
  );
}

const readLibrary = (page: Page): Promise<unknown> =>
  page.evaluate((key) => {
    const text = localStorage.getItem(key);
    return text === null ? null : (JSON.parse(text) as unknown);
  }, LIBRARY_KEY);

/** 설정의 `백업 파일 받기`를 눌러 받은 파일 경로. */
async function downloadBackup(page: Page, testInfo: TestInfo): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '백업 파일 받기' }).click(),
  ]);
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(BACKUP_NAME);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  return file;
}

/** 대화상자에 파일을 넣어 미리보기가 나오게 한다. */
async function chooseFile(page: Page, file: string) {
  const dialog = page.getByRole('dialog', { name: '백업에서 되살리기' });
  await dialog.getByLabel('백업 파일 선택').setInputFiles(file);
  return dialog;
}

test.describe('백업과 되살리기', () => {
  test('@smoke 백업을 받고, 보관함을 비운 뒤 되살리고, 되돌리기까지 한다', async ({
    page,
  }, testInfo) => {
    const original = libraryWithTrip();
    await seedOnce(page, JSON.stringify(original));
    await page.goto('/settings');

    // 1) 백업 파일 받기: 이름 규칙, 토스트, 마지막 백업 날짜가 (오늘).
    const section = page.getByRole('region', { name: '백업' });
    await expect(section.getByText('마지막 백업: 없음')).toBeVisible();
    const file = await downloadBackup(page, testInfo);
    await expect(page.getByText('백업 파일을 만들었어요')).toBeVisible();
    await expect(
      section.getByText(/^마지막 백업: \d{4}\.\d{2}\.\d{2} \d{2}:\d{2} \(오늘\)$/),
    ).toBeVisible();
    const backup = JSON.parse(readFileSync(file, 'utf8')) as Json;
    expect(backup.format).toBe('tripmap-backup');
    expect(backup.library).toEqual(original);

    // 2) 보관함을 지우고 새로고침 → 되살리기.
    await page.evaluate((key) => localStorage.removeItem(key), LIBRARY_KEY);
    await page.reload();
    await page.goto('/settings');
    await page.getByRole('button', { name: '백업 파일로 되살리기' }).click();
    const dialog = await chooseFile(page, file);
    await expect(dialog.getByText(`백업 파일: ${NUMBERS}`)).toBeVisible();
    await dialog.getByRole('button', { name: '이 백업으로 바꾸기' }).click();
    await expect(page.getByText(`백업에서 되살렸어요 (${NUMBERS})`)).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await readLibrary(page)).toEqual(original);

    // 3) 보관함 목록(여행)에 되살린 여행이 보인다.
    await page.goto('/trips');
    await expect(page.getByText(TRIP_TITLE)).toBeVisible();

    // 4) 되살린 뒤 장소를 하나 더 넣은 상태에서 같은 백업으로 다시 되살리면, 토스트의 되돌리기가 그 상태로 돌린다.
    const changed = withExtraPlace(original);
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: LIBRARY_KEY,
      value: JSON.stringify(changed),
    });
    await page.goto('/settings');
    await page.getByRole('button', { name: '백업 파일로 되살리기' }).click();
    const again = await chooseFile(page, file);
    await expect(again.getByText(`백업 파일: ${NUMBERS}`)).toBeVisible();
    await again.getByRole('button', { name: '이 백업으로 바꾸기' }).click();
    const toast = page.getByText(`백업에서 되살렸어요 (${NUMBERS})`);
    await expect(toast).toBeVisible();
    expect(await readLibrary(page)).toEqual(original);
    await page.getByRole('button', { name: '되돌리기', exact: true }).click();
    await expect(page.getByText('되살리기 전으로 되돌렸어요')).toBeVisible();
    expect(await readLibrary(page)).toEqual(changed);
  });

  test('@smoke 보관함 문서가 손상된 화면에서 백업 파일로 되살린다', async ({ page }, testInfo) => {
    // 먼저 정상 보관함에서 백업 파일을 받아 둔다.
    const original = libraryWithTrip();
    await seedStorage(page, { library: false, prefs: { libraryView: 'list' } });
    await seedOnce(page, JSON.stringify(original));
    await page.goto('/settings');
    const file = await downloadBackup(page, testInfo);

    // 보관함 원문을 깨뜨리고 새로고침 → 손상 화면.
    await page.evaluate((key) => localStorage.setItem(key, '{"schemaVersion":2'), LIBRARY_KEY);
    await page.reload();
    await expect(page.getByRole('heading', { name: '데이터를 읽지 못했어요' })).toBeVisible();
    await expect(page.getByRole('button', { name: '백업 파일 받기' })).toBeVisible();
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeVisible();

    await page.getByRole('button', { name: '백업 파일로 되살리기' }).click();
    const dialog = await chooseFile(page, file);
    await expect(dialog.getByText(`백업 파일: ${NUMBERS}`)).toBeVisible();
    await dialog.getByRole('button', { name: '이 백업으로 바꾸기' }).click();

    // 손상 화면이 사라지고(설정 화면이 그대로 열린다) 보관함 목록이 보인다.
    await expect(page.getByRole('heading', { name: '데이터를 읽지 못했어요' })).toBeHidden();
    await expect(page.getByRole('heading', { name: '설정' })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('list', { name: '장소 목록' }).getByRole('listitem')).toHaveCount(
      SEED_PLACE_COUNT,
    );
    expect(await readLibrary(page)).toEqual(original);
  });
});
