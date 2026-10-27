import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect, type Page } from '@playwright/test';
import {
  test,
  BUILD_APP_ORIGIN,
  emptyLibrary,
  exportSeaPlaces,
  pickFromSheet,
  rowsOf,
  SEA_COUNT,
} from './fixtures';

/**
 * 받은 공유 파일 가져오기(스펙 §2). 내보내기 시험과 같은 방법으로 "바다" 9곳을 파일로 받고,
 * 보관함을 비운 뒤 ＋ 시트·보기 화면의 `Landmark에 담기` 링크·PC 끌어 놓기로 가져온다.
 * 내보낸 파일의 제목은 기본값인 "바다"다(제목 라벨 이름도 같다).
 */

const TITLE = '바다';

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

/** 받은 파일을 `file://`로 연 보기 화면의 `Landmark에 담기` 링크를, 테스트 앱 주소(`base`, 끝 `/` 없음)로 바꾼 이동 주소를 준다. */
async function viewerImportUrl(page: Page, file: string, base: string): Promise<string> {
  const viewer = await page.context().newPage();
  await viewer.goto(pathToFileURL(file).href);
  const href = await viewer.getByRole('link', { name: 'Landmark에 담기' }).getAttribute('href');
  await viewer.close();
  expect(href).not.toBeNull();
  expect(String(href).startsWith(`${BUILD_APP_ORIGIN}/import#d=`)).toBe(true);
  return String(href).replace(BUILD_APP_ORIGIN, base);
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
    const base = baseURL!.replace(/\/$/, '');
    const url = await viewerImportUrl(page, file, base);

    await page.goto(url);
    // `/import#d=…`는 곧 `/`로 바뀌고 해시는 사라진다(새로고침해도 다시 열리지 않는다).
    await expect(page).toHaveURL(`${base}/`);
    await importPreview(page, SEA_COUNT, `${SEA_COUNT}곳을 새로 넣었어요`);
    await expectTitleFiltered(page, SEA_COUNT);

    // 새로고침해도 미리보기가 다시 열리지 않는다(주소는 그대로 `/`). 장소 목록이 다시 그려진 뒤에 본다.
    await page.reload();
    await expect(rowsOf(page)).toHaveCount(SEA_COUNT);
    await expect(page).toHaveURL(`${base}/`);
    await expect(page.getByText(`${TITLE} · ${SEA_COUNT}곳`)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /곳 가져오기$/ })).toHaveCount(0);

    // 같은 파일을 한 번 더: 모두 이미 있으니 라벨만 더한다.
    await page.goto(url);
    await expect(page).toHaveURL(`${base}/`);
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
