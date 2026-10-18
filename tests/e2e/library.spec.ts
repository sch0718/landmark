import { expect, test, type Locator, type Page } from '@playwright/test';
import { placeIdByName, SEED_PLACE_COUNT, seedStorage } from './fixtures';

const markers = (page: Page): Locator => page.locator('[data-testid^="marker-"]');
const rows = (page: Page): Locator =>
  page.getByRole('list', { name: '장소 목록' }).getByRole('listitem');
/** 목록·카드의 장소 버튼. 지도 마커에도 이름이 있어 목록 안으로 좁힌다. */
const placeButton = (page: Page, name: RegExp): Locator =>
  page.getByRole('list', { name: '장소 목록' }).getByRole('button', { name });
const memoBox = (scope: Page | Locator): Locator => scope.getByRole('textbox', { name: '메모' });

const SCREEN_DIR = 'test-results/screens';

// 프로젝트별 실행 대상은 `playwright.config.ts`의 grepInvert가 태그로 가른다.
test.describe('데스크톱 3단', { tag: '@desktop' }, () => {
  test('@smoke 라벨 필터로 목록·마커가 줄고, 행과 마커로 상세를 연다', async ({ page }) => {
    await seedStorage(page, { prefs: { libraryView: 'list' } });
    await page.goto('/');

    await expect(rows(page)).toHaveCount(SEED_PLACE_COUNT);
    await expect(markers(page)).toHaveCount(SEED_PLACE_COUNT);

    // 라벨 칩 하나를 켜면 목록과 지도 마커가 함께 줄어든다.
    const chip = page.getByRole('group', { name: '라벨' }).getByRole('button', { name: /^바다/ });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page)).toHaveCount(9);
    await expect(markers(page)).toHaveCount(9);

    // 행을 누르면 상세가 3단의 오른쪽 칸에 열린다.
    const detail = page.getByRole('region', { name: '장소 상세' });
    await expect(detail).toContainText('장소를 고르면 여기에 보여요');
    await rows(page)
      .getByRole('button', { name: /경포대/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/place/${placeIdByName('경포대')}$`));
    await expect(detail.getByRole('button', { name: '이름 수정' })).toContainText('경포대');
    const map = await page.getByRole('region', { name: '지도' }).boundingBox();
    const box = await detail.boundingBox();
    expect(box!.x + box!.width).toBeCloseTo(1280, 0);
    expect(box!.x).toBeGreaterThanOrEqual(map!.x + map!.width - 1);

    // 지도 마커를 누르면 다른 장소의 상세로 바뀐다.
    await page.getByTestId(`marker-${placeIdByName('협재 해수욕장')}`).click();
    await expect(page).toHaveURL(new RegExp(`/place/${placeIdByName('협재 해수욕장')}$`));
    await expect(detail.getByRole('button', { name: '이름 수정' })).toContainText('협재 해수욕장');

    // 같은 필터가 지도 화면에도 이어진다.
    await expect(markers(page)).toHaveCount(9);
  });

  test('@smoke 두 탭이 서로 다른 장소의 메모를 저장해도 둘 다 남는다', async ({ browser }) => {
    const context = await browser.newContext({
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      viewport: { width: 1280, height: 800 },
    });
    try {
      const first = await context.newPage();
      const second = await context.newPage();
      await seedStorage(first, { prefs: { libraryView: 'cards' } });
      await first.goto(`/place/${placeIdByName('경포대')}`);
      await second.goto(`/place/${placeIdByName('영금정')}`);
      await expect(memoBox(first)).toHaveValue('일출 보기 좋음');
      await expect(memoBox(second)).toHaveValue('');

      await memoBox(first).fill('첫 번째 탭에서 쓴 메모');
      await memoBox(second).fill('두 번째 탭에서 쓴 메모');
      await expect(first.getByRole('status').filter({ hasText: '저장됨' })).toBeVisible();
      await expect(second.getByRole('status').filter({ hasText: '저장됨' })).toBeVisible();

      await Promise.all([first.reload(), second.reload()]);
      for (const page of [first, second]) {
        await expect(placeButton(page, /경포대/)).toContainText('첫 번째 탭에서 쓴 메모');
        await expect(placeButton(page, /영금정/)).toContainText('두 번째 탭에서 쓴 메모');
      }
    } finally {
      await context.close();
    }
  });

  test('스크린샷: 보관함과 장소 상세', async ({ page }) => {
    await seedStorage(page, { prefs: { libraryView: 'cards' } });
    await page.goto('/');
    await expect(markers(page)).toHaveCount(SEED_PLACE_COUNT);
    await page.screenshot({ path: `${SCREEN_DIR}/desktop-library.png` });
    await page.goto(`/place/${placeIdByName('경포대')}`);
    await expect(memoBox(page)).toHaveValue('일출 보기 좋음');
    await page.screenshot({ path: `${SCREEN_DIR}/desktop-place.png` });
  });
});

test.describe('모바일', { tag: '@mobile' }, () => {
  test('@smoke 하단 탭 이동 → 장소 시트에서 새 라벨·메모 → 뒤로 → 카드 → 새로고침 후에도 유지', async ({
    page,
  }) => {
    await seedStorage(page, { prefs: { libraryView: 'cards' } });
    await page.goto('/');
    const tabs = page.getByRole('navigation', { name: '하단 메뉴' });
    await expect(tabs).toBeVisible();

    // 하단 탭: 지도 → 보관함.
    await tabs.getByRole('link', { name: '지도' }).click();
    await expect(page).toHaveURL(/\/map$/);
    await expect(markers(page)).toHaveCount(SEED_PLACE_COUNT);
    await tabs.getByRole('link', { name: '보관함' }).click();
    await expect(page).toHaveURL(/\/$/);

    // 카드를 누르면 다 펼친 시트로 상세가 열린다(하단 탭은 그대로 보인다).
    const id = placeIdByName('칠성조선소');
    await page.getByRole('button', { name: /칠성조선소/ }).click();
    await expect(page).toHaveURL(new RegExp(`/place/${id}$`));
    const sheet = page.getByRole('region', { name: '장소 상세' });
    await expect(sheet.getByRole('button', { name: '접기' })).toBeVisible();
    await expect(tabs).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);

    // 새 라벨을 만들어 붙인다.
    await sheet.getByRole('button', { name: '라벨 바꾸기' }).click();
    const picker = page.getByRole('dialog', { name: '라벨 바꾸기' });
    const search = picker.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    await search.fill('재방문');
    await search.press('Enter');
    await expect(picker.getByRole('checkbox', { name: /^재방문/ })).toBeChecked();
    await picker.getByRole('button', { name: '완료' }).click();
    await expect(sheet.getByRole('list', { name: '붙은 라벨' })).toContainText('재방문');

    // 메모를 쓰면 저장됨이 보인다.
    await memoBox(sheet).fill('두 번째 방문: 💛 팥빙수');
    await expect(sheet.getByRole('status').filter({ hasText: '저장됨' })).toBeVisible();

    if (test.info().project.name === 'iphone') {
      await page.screenshot({ path: `${SCREEN_DIR}/iphone-place.png` });
    }

    // 뒤로 가면 카드에 메모와 새 라벨이 보인다.
    await sheet.getByRole('button', { name: '닫기' }).click();
    await expect(page).toHaveURL(/\/$/);
    const card = page.getByRole('button', { name: /칠성조선소/ });
    await expect(card).toContainText('두 번째 방문: 💛 팥빙수');
    await expect(card).toContainText('재방문');

    // 새로고침해도 그대로다.
    await page.reload();
    const reloaded = page.getByRole('button', { name: /칠성조선소/ });
    await expect(reloaded).toContainText('두 번째 방문: 💛 팥빙수');
    await expect(reloaded).toContainText('재방문');

    if (test.info().project.name === 'iphone') {
      await page.screenshot({ path: `${SCREEN_DIR}/iphone-library.png` });
    }
  });

  test('긴 이름과 이모지 메모가 카드에서 가로로 넘치지 않는다', async ({ page }) => {
    await seedStorage(page, { prefs: { libraryView: 'cards' } });
    await page.goto('/');
    const card = page.getByRole('button', { name: /아주아주아주 긴 이름/ });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText('🌊🍜');
    const width = page.viewportSize()!.width;
    const box = await card.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// 세 프로젝트(데스크톱·iPhone·Galaxy) 모두에서 도는 시험이라 태그를 달지 않는다.
test('탭 제목이 화면을 따라간다', async ({ page }) => {
  await seedStorage(page);
  await page.goto('/labels');
  await expect(page).toHaveTitle('라벨 관리 · 랜드마크');
  await page.goto('/');
  await expect(page).toHaveTitle('보관함 · 랜드마크');
});
