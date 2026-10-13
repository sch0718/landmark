import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { exportSeaPlaces, LIBRARY_KEY, PREFS_KEY, SEA_COUNT } from './fixtures';

/**
 * 받은 공유 파일 가져오기(스펙 §2). 내보내기 시험과 같은 방법으로 "바다" 9곳을 파일로 받고,
 * 보관함을 비운 뒤 ＋ 시트·보기 화면의 `Landmark에 담기` 링크·PC 끌어 놓기로 가져온다.
 * 내보낸 파일의 제목은 기본값인 "바다"다(제목 라벨 이름도 같다).
 */

const TITLE = '바다';
/** 보기 화면 링크가 가리키는 운영 앱 주소(빌드 기본값). 시험에서는 `baseURL`로 바꿔 쓴다. */
const BUILD_APP_ORIGIN = 'https://landmark-c5f.pages.dev';

/** 보관함(목록 보기)에 보이는 장소 행. */
const rowsOf = (page: Page): Locator =>
  page.getByRole('list', { name: '장소 목록' }).getByRole('listitem');

/**
 * 내보낸 뒤의 보관함을 비운 상태로 되돌린다. 저장소 값을 빈 보관함·기본 UI 선호(필터 없음)로 덮고
 * 새로 불러온다(시드 심기는 값이 있으면 건드리지 않는다).
 */
async function emptyLibrary(page: Page): Promise<void> {
  await page.evaluate(
    ({ libraryKey, prefsKey }) => {
      localStorage.setItem(
        libraryKey,
        JSON.stringify({ schemaVersion: 2, places: {}, labels: {}, trips: {} }),
      );
      localStorage.setItem(
        prefsKey,
        JSON.stringify({
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
        }),
      );
    },
    { libraryKey: LIBRARY_KEY, prefsKey: PREFS_KEY },
  );
  await page.goto('/');
  await expect(rowsOf(page)).toHaveCount(0);
}

/** 보관함 화면의 ＋ → 시트의 `공유 파일 가져오기` → `파일 고르기`에 파일을 준다. */
async function pickFromSheet(page: Page, file: string): Promise<void> {
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

/** 미리보기에서 `<N>곳 가져오기`를 누르고 토스트 문구를 확인한다. */
async function importPreview(page: Page, count: number, toast: string): Promise<void> {
  await expect(page.getByText(`${TITLE} · ${count}곳`)).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(count);
  await expect(page.getByRole('switch', { name: '파일 제목 라벨도 붙이기' })).toBeChecked();
  await expect(page.getByRole('switch', { name: '받은 메모도 덧붙이기' })).toBeAttached();
  await page.getByRole('button', { name: `${count}곳 가져오기`, exact: true }).click();
  await expect(page.getByText(toast)).toBeVisible();
}

/** 가져온 뒤 목록: 제목 라벨로 걸러져 받은 수만큼 보인다. */
async function expectTitleFiltered(page: Page, count: number): Promise<void> {
  await expect(page.getByRole('button', { name: /곳 가져오기$/ })).toHaveCount(0);
  const chip = page.getByRole('group', { name: '라벨' }).getByRole('button', { name: /^바다/ });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(rowsOf(page)).toHaveCount(count);
}

/** 받은 파일을 `file://`로 연 보기 화면의 `Landmark에 담기` 링크를, 테스트 앱 주소로 바꾼 이동 주소를 준다. */
async function viewerImportUrl(page: Page, file: string, baseURL: string): Promise<string> {
  const viewer = await page.context().newPage();
  await viewer.goto(pathToFileURL(file).href);
  const href = await viewer.getByRole('link', { name: 'Landmark에 담기' }).getAttribute('href');
  await viewer.close();
  expect(href).toMatch(new RegExp(`^${BUILD_APP_ORIGIN}/import#d=.+`));
  return href!.replace(BUILD_APP_ORIGIN, baseURL.replace(/\/$/, ''));
}

test.describe('공유 파일 가져오기', () => {
  test('@smoke ＋ 시트에서 파일을 골라 가져오면 토스트와 제목 라벨 목록이 보인다', async ({
    page,
  }, testInfo) => {
    const file = await exportSeaPlaces(page, testInfo);
    await emptyLibrary(page);

    await pickFromSheet(page, file);
    await importPreview(page, SEA_COUNT, `${SEA_COUNT}곳을 새로 넣었어요`);
    await expectTitleFiltered(page, SEA_COUNT);
  });

  test('@smoke 보기 화면의 Landmark에 담기 링크로 미리보기가 열리고, 같은 파일을 다시 가져오면 라벨만 더한다', async ({
    page,
    baseURL,
  }, testInfo) => {
    const file = await exportSeaPlaces(page, testInfo);
    await emptyLibrary(page);
    const url = await viewerImportUrl(page, file, baseURL!);

    await page.goto(url);
    // `/import#d=…`는 곧 `/`로 바뀌고 해시는 사라진다(새로고침해도 다시 열리지 않는다).
    await expect(page).toHaveURL(new RegExp(`^${baseURL!.replace(/\/$/, '')}/$`));
    await importPreview(page, SEA_COUNT, `${SEA_COUNT}곳을 새로 넣었어요`);
    await expectTitleFiltered(page, SEA_COUNT);

    // 같은 파일을 한 번 더: 모두 이미 있으니 라벨만 더한다.
    await page.goto(url);
    await expect(page).toHaveURL(new RegExp(`^${baseURL!.replace(/\/$/, '')}/$`));
    await importPreview(page, SEA_COUNT, `${SEA_COUNT}곳은 라벨만 더했어요`);
    await expectTitleFiltered(page, SEA_COUNT);
  });

  test('@desktop 보관함 위로 파일을 끌어 놓으면 안내가 뜨고 미리보기가 열린다', async ({
    page,
  }, testInfo) => {
    const file = await exportSeaPlaces(page, testInfo);
    await emptyLibrary(page);

    const html = readFileSync(file, 'utf8');
    const name = file.split('/').pop()!;
    // 끌기 이벤트는 페이지에서 `DataTransfer`에 파일을 담아 `body`에 쏜다(`window`까지 올라간다).
    const drag = (type: 'dragenter' | 'dragover' | 'dragleave' | 'drop') =>
      page.evaluate(
        ({ type, html, name }) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([html], name, { type: 'text/html' }));
          document.body.dispatchEvent(
            new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }),
          );
        },
        { type, html, name },
      );

    const overlay = page.getByText('여기에 놓으면 가져와요');
    await expect(overlay).toHaveCount(0);
    // 화면 폭을 읽은 뒤에야 `window`에 듣기가 붙으므로, 안내가 뜰 때까지 끌어 오기를 되풀이한다.
    await expect(async () => {
      await drag('dragenter');
      await expect(overlay).toBeVisible({ timeout: 500 });
    }).toPass();
    await drag('dragover');
    // 놓지 않고 벗어나면 안내가 사라진다.
    await drag('dragleave');
    await expect(overlay).toHaveCount(0);

    await drag('dragenter');
    await expect(overlay).toBeVisible();
    await drag('drop');
    await expect(overlay).toHaveCount(0);
    await importPreview(page, SEA_COUNT, `${SEA_COUNT}곳을 새로 넣었어요`);
    await expectTitleFiltered(page, SEA_COUNT);
  });
});
