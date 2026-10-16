import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { seedStorage } from './fixtures';

/** 앱이 `/api`에서 받는 응답을 녹화해 둔 fixture(`tests/fixtures/links/api/`). */
const apiFixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/links/api/${name}`, import.meta.url)), 'utf8');

const PLACE_FOLDER = apiFixture('place-folder.json');
/** 처음 가져올 때의 폴더(3곳). */
const NAVER_FOLDER = apiFixture('naver-folder.json');
/** 그 뒤 한 곳을 새로 저장한 폴더(4곳: 위 세 곳 + 새 한 곳). 새 녹화가 아니라 `bookmarks-sokcho.json`에서 뽑았다. */
const NAVER_FOLDER_MORE = apiFixture('naver-folder-more.json');

const FOLDER_LINK = 'https://naver.me/xjYaIYfe';
const FOLDER_NAME = '속초, 고성, 양양 맛집';

const json = (body: string) => ({
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body,
});

/** `/api/naver-folder` 요청 하나의 질의 값. */
type FolderCall = { share: string | null; fresh: string | null };

test('@smoke 가져온 폴더를 라벨 관리에서 다시 가져오면 새로 저장한 곳만 더한다', async ({
  page,
}) => {
  // 폴더 응답은 아래에서 바꿔 끼운다. 받은 질의 값은 요청 순서대로 모은다.
  let folderBody = NAVER_FOLDER;
  const folderCalls: FolderCall[] = [];
  await page.route('**/api/place?**', (route) => route.fulfill(json(PLACE_FOLDER)));
  await page.route('**/api/naver-folder?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    folderCalls.push({ share: params.get('share'), fresh: params.get('fresh') });
    return route.fulfill(json(folderBody));
  });

  // 1~2. 빈 보관함에서 폴더 링크로 처음 가져온다.
  await seedStorage(page, { library: false, prefs: { libraryView: 'list' } });
  await page.goto('/');
  const rows = page.getByRole('list', { name: '장소 목록' }).getByRole('listitem');
  await expect(rows).toHaveCount(0);

  await page.getByRole('button', { name: '장소 추가', exact: true }).first().click();
  const option = page
    .getByRole('dialog', { name: '장소 추가' })
    .getByRole('button', { name: /네이버 폴더 가져오기/ });
  await option.click();
  await expect(option).toHaveCount(0);
  await page.getByRole('textbox', { name: '링크' }).fill(FOLDER_LINK);
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('button', { name: '3곳 가져오기', exact: true }).click();
  await expect(page.getByText('3곳을 새로 넣었어요')).toBeVisible();
  await expect(rows).toHaveCount(3);
  // 첫 가져오기는 캐시를 쓰는 조회라 `fresh`가 없다.
  expect(folderCalls.length).toBeGreaterThan(0);
  expect(folderCalls.every((call) => call.fresh === null)).toBe(true);
  const firstCalls = folderCalls.length;

  // 3. 폴더에 한 곳이 새로 저장됐다. 라벨 관리에서 연결된 폴더를 연다.
  folderBody = NAVER_FOLDER_MORE;
  await page.goto('/labels');
  const labelRow = page.getByRole('button', {
    name: /속초, 고성, 양양 맛집.*장소 3곳 · 네이버 폴더/,
  });
  await expect(labelRow).toBeVisible();
  await labelRow.click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('heading', { name: '네이버 폴더' })).toBeVisible();
  await editor
    .getByRole('button', { name: `‘${FOLDER_NAME}’에서 새로 저장한 곳 가져오기` })
    .click();

  // 4. 새로 저장한 곳 1곳만 더한다.
  await expect(page.getByText('새로 저장한 곳 1 · 그대로 3 · 폴더에서 빠진 곳 0')).toBeVisible();
  await page.getByRole('button', { name: '1곳 가져오기', exact: true }).click();
  await expect(page.getByText('1곳을 새로 넣었어요')).toBeVisible();
  await page.getByRole('button', { name: '보관함에서 보기' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(rows).toHaveCount(4);
  await expect(
    page
      .getByRole('group', { name: '라벨' })
      .getByRole('button', { name: /^속초, 고성, 양양 맛집/ }),
  ).toHaveAttribute('aria-pressed', 'true');

  // 5. 다시 가져오기 요청에는 `fresh=1`이 있었고 첫 가져오기 요청에는 없었다.
  const resyncCalls = folderCalls.slice(firstCalls);
  expect(resyncCalls.length).toBeGreaterThan(0);
  expect(resyncCalls.every((call) => call.fresh === '1')).toBe(true);
  expect(folderCalls.slice(0, firstCalls).every((call) => call.fresh === null)).toBe(true);
  expect([...new Set(folderCalls.map((call) => call.share))]).toEqual([
    'fb65e7f93f8a4144a4ded594d604a7aa',
  ]);

  // 6. 같은 링크를 다시 붙여 넣으면 새로 저장한 곳이 없는 다시 가져오기 화면이 열린다.
  await page.getByRole('button', { name: '장소 추가', exact: true }).first().click();
  const again = page
    .getByRole('dialog', { name: '장소 추가' })
    .getByRole('button', { name: /네이버 폴더 가져오기/ });
  await again.click();
  await expect(again).toHaveCount(0);
  await page.getByRole('textbox', { name: '링크' }).fill(FOLDER_LINK);
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByText('새로 저장한 곳 0 · 그대로 4 · 폴더에서 빠진 곳 0')).toBeVisible();
  await expect(page.getByRole('button', { name: '확인했어요', exact: true })).toBeVisible();
});
