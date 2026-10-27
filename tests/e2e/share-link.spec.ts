import { expect, type Locator, type Page } from '@playwright/test';
import {
  test,
  addButton,
  createGangneungTrip,
  emptyLibrary,
  mockRoutes,
  openSheetTab,
  rowsOf,
  SEA_COUNT,
  seedStorage,
  timeline,
} from './fixtures';

/** Chromium은 실제 클립보드를 읽는다. WebKit에서는 권한 API가 없어 버튼 준비 상태까지만 확인한다. */
async function copiedLink(
  page: Page,
  dialog: Locator,
  browserName: string,
  base: string,
): Promise<string | null> {
  const copy = dialog.getByRole('button', { name: '링크 복사' });
  await expect(copy).toBeEnabled();
  await expect(dialog.getByText('링크를 받은 사람은 누구나 메모를 볼 수 있어요')).toBeVisible();
  if (browserName !== 'chromium') return null;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await copy.click();
  await expect(page.getByText('링크를 복사했어요')).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(
    new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/view#d=[A-Za-z0-9_-]+$`),
  );
  return url;
}

/** 같은 탭에서 원래 해시 그대로 /import로 보낸다. 앱은 곧 주소를 /로 지운다. */
async function importInSameTab(page: Page, url: string): Promise<void> {
  const link = page.getByRole('link', { name: 'Landmark에 담기' });
  await expect(link).toHaveAttribute('href', `/import${new URL(url).hash}`);
  await expect(link).not.toHaveAttribute('target', '_blank');
  const count = page.context().pages().length;
  const request = page.waitForRequest(
    (r) => r.isNavigationRequest() && new URL(r.url()).pathname === '/import',
  );
  await link.click();
  await request;
  await expect(page).toHaveURL(`${new URL(url).origin}/`);
  expect(page.context().pages()).toHaveLength(count);
}

test('@smoke 장소 링크 복사 → 도메인 목록·지도 → 같은 탭 미리보기 → 가져오기', async ({
  page,
  browserName,
  baseURL,
}) => {
  await seedStorage(page, { prefs: { libraryView: 'list' } });
  await page.goto('/');
  await page.getByRole('group', { name: '라벨' }).getByRole('button', { name: /^바다/ }).click();
  await expect(rowsOf(page)).toHaveCount(SEA_COUNT);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '내보내기' });
  const url = await copiedLink(page, dialog, browserName, baseURL!);
  if (url === null) return;
  await emptyLibrary(page);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('바다');
  await expect(page).toHaveTitle('바다');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    '랜드마크로 공유한 장소',
  );
  await expect(page.getByRole('list', { name: '장소 목록' }).locator('article')).toHaveCount(
    SEA_COUNT,
  );
  const map = page.locator('iframe[title="지도"]').contentFrame();
  await expect(map.getByTestId('fake-map')).toBeVisible();
  await expect(map.locator('[data-testid^="marker-"]')).toHaveCount(SEA_COUNT);
  await importInSameTab(page, url);
  await expect(page.getByText(`바다 · ${SEA_COUNT}곳`)).toBeVisible();
  await page.getByRole('button', { name: `${SEA_COUNT}곳 가져오기`, exact: true }).click();
  await expect(page.getByText(`${SEA_COUNT}곳을 새로 넣었어요`)).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(SEA_COUNT);
});

test('일정 링크 복사 → Day·지도 → 여행 가져오기', async ({ page, browserName, baseURL }) => {
  await mockRoutes(page);
  await createGangneungTrip(page);
  await addButton(page, '초당순두부 본점').click();
  await addButton(page, '경포대').click();
  await openSheetTab(page, 'Day 1');
  await timeline(page).getByRole('button', { name: '일정 공유', exact: true }).click();
  const url = await copiedLink(
    page,
    page.getByRole('dialog', { name: '일정 공유' }),
    browserName,
    baseURL!,
  );
  if (url === null) return;
  await emptyLibrary(page);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('강릉 여행');
  await expect(page.getByRole('tablist', { name: 'Day 고르기' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Day 1 일정' }).getByRole('heading', { level: 2 }),
  ).toHaveText(['초당순두부 본점', '경포대']);
  await expect(
    page.locator('iframe[title="지도"]').contentFrame().getByTestId('fake-map'),
  ).toBeVisible();
  await importInSameTab(page, url);
  await expect(page.getByRole('switch', { name: '여행 계획도 가져오기' })).toBeChecked();
  await page.getByRole('button', { name: '여행 가져오기', exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await expect(page.getByText('여행 ‘강릉 여행’을 가져왔어요').first()).toBeVisible();
});

test('데이터 없는 /view와 손상·과대 링크는 복구 안내를 표시한다', async ({ page }) => {
  for (const hash of ['', '#d=!!', `#d=${'A'.repeat(32_001)}`]) {
    await page.goto(`/view${hash}`);
    await expect(
      page.getByText('링크가 손상됐거나 너무 길어요. 보낸 사람에게 파일로 보내 달라고 해 주세요'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Landmark 열기' })).toHaveAttribute('href', '/');
  }
});

test('장소 링크가 카카오톡 한도(400자)를 넘으면 카카오톡만 끄고 안내한다', async ({ page }) => {
  // 보내는 카드 모양은 단위 시험(share-link-dialog·kakao-share)이 본다. 장소 링크는 1곳이어도 400자를 넘는다.
  const { fakeKakao } = await import('./fixtures');
  await fakeKakao(page);
  await seedStorage(page, { prefs: { libraryView: 'list' } });
  await page.goto('/');
  await page.getByRole('group', { name: '라벨' }).getByRole('button', { name: /^바다/ }).click();
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '내보내기' });
  await expect(dialog.getByRole('button', { name: '링크 복사', exact: true })).toBeEnabled();
  await expect(
    dialog.getByText('링크가 길어 카카오톡으로 보낼 수 없어요. 링크 복사를 이용해 주세요'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: '카카오톡', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.kakaoInitKeys)).toEqual(['e2e-kakao-key']);
  expect(await page.evaluate(() => window.kakaoCalls)).toEqual([]);
});
