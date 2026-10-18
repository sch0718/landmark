import { expect, test, type Locator, type Page } from '@playwright/test';
import { LIBRARY_KEY, placeIdByName, seed, seedStorage } from './fixtures';

const rows = (page: Page): Locator =>
  page.getByRole('list', { name: '장소 목록' }).getByRole('listitem');
/** 목록·카드의 장소 버튼. 지도 마커에도 이름이 있어 목록 안으로 좁힌다. */
const placeButton = (page: Page, name: RegExp): Locator =>
  page.getByRole('list', { name: '장소 목록' }).getByRole('button', { name });

/** 오늘(서울). playwright.config.ts의 `timezoneId: 'Asia/Seoul'`과 같은 날짜가 앱에도 보인다. */
const todaySeoul = (): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

test.describe('다녀옴·한 줄 평: 데스크톱', { tag: '@desktop' }, () => {
  test('@smoke 다녀왔어요 → 날짜·한 줄 평 → 방문 필터·마커 → 다녀온 날순 → 새로고침 뒤에도 유지', async ({
    page,
  }) => {
    await seedStorage(page, { prefs: { libraryView: 'list' } });
    await page.goto('/');
    const id = placeIdByName('경포대');
    await placeButton(page, /경포대/).click();
    await expect(page).toHaveURL(new RegExp(`/place/${id}$`));
    const detail = page.getByRole('region', { name: '장소 상세' });

    // 다녀왔어요: 날짜 칸이 오늘(서울)로 채워진다.
    await detail.getByRole('button', { name: '다녀왔어요' }).click();
    const dateBox = detail.getByLabel('다녀온 날');
    await expect(dateBox).toHaveValue(todaySeoul());
    await expect(dateBox).toBeFocused();

    // 날짜 칸을 비워도(휴대폰 날짜 창의 지우기) 저장하지 않는다. 칸은 입력을 이어 갈 수 있게 비어 있다.
    await dateBox.fill('');
    await expect(dateBox).toHaveValue('');
    // 칸을 떠나면 저장된 날짜로 돌아간다.
    await dateBox.blur();
    await expect(dateBox).toHaveValue(todaySeoul());

    // 오늘 이후 날짜는 안내만 하고 저장하지 않는다.
    await dateBox.fill('2099-01-01');
    await expect(detail.getByRole('alert')).toContainText('오늘 이후 날짜는 고를 수 없어요');
    await dateBox.blur();
    await expect(dateBox).toHaveValue(todaySeoul());
    await expect(detail.getByRole('alert')).toHaveCount(0);

    // 지난 날짜로 고친다.
    await dateBox.fill('2026-10-10');
    await expect(dateBox).toHaveValue('2026-10-10');

    // 한 줄 평.
    await detail.getByRole('button', { name: '한 줄 평 수정' }).click();
    const review = detail.getByRole('textbox', { name: '한 줄 평' });
    await review.fill('일출 최고');
    await review.press('Enter');
    await expect(detail.getByRole('button', { name: '한 줄 평 수정' })).toContainText('일출 최고');

    // 방문 칩: 가 본 곳 1.
    const visitGroup = page.getByRole('group', { name: '방문' });
    const visitedChip = visitGroup.getByRole('button', { name: '가 본 곳 1' });
    await expect(visitedChip).toBeVisible();
    await visitedChip.click();
    await expect(visitedChip).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('경포대');

    // 지도 마커: `✓ 경포대`.
    await expect(page.getByTestId(`marker-${id}`)).toContainText('✓ 경포대');

    // 다녀온 날순은 저장하지 않는 정렬이다.
    await page.getByRole('button', { name: '최근 저장순' }).click();
    await page.getByRole('menuitemradio', { name: '다녀온 날순' }).click();
    await expect(page.getByRole('button', { name: '다녀온 날순' })).toBeVisible();

    // 새로고침: 날짜·평·가 본 곳 필터는 그대로고 정렬만 기본으로 돌아온다.
    await page.reload();
    await expect(detail.getByLabel('다녀온 날')).toHaveValue('2026-10-10');
    await expect(detail.getByRole('button', { name: '한 줄 평 수정' })).toContainText('일출 최고');
    await expect(
      page.getByRole('group', { name: '방문' }).getByRole('button', { name: '가 본 곳 1' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: '최근 저장순' })).toBeVisible();
  });
});

test.describe('다녀옴·한 줄 평: 모바일', { tag: '@mobile' }, () => {
  test('@smoke 시트에서 다녀왔어요·한 줄 평 → 뒤로 → 카드에 배지와 평', async ({ page }) => {
    await seedStorage(page, { prefs: { libraryView: 'cards' } });
    await page.goto('/');
    const id = placeIdByName('경포대');
    await page.getByRole('button', { name: /경포대/ }).click();
    await expect(page).toHaveURL(new RegExp(`/place/${id}$`));
    const sheet = page.getByRole('region', { name: '장소 상세' });

    await sheet.getByRole('button', { name: '다녀왔어요' }).click();
    await expect(sheet.getByLabel('다녀온 날')).toHaveValue(todaySeoul());
    await sheet.getByRole('button', { name: '한 줄 평 수정' }).click();
    const review = sheet.getByRole('textbox', { name: '한 줄 평' });
    await review.fill('일출 최고');
    await review.press('Enter');
    await expect(sheet.getByRole('button', { name: '한 줄 평 수정' })).toContainText('일출 최고');

    await sheet.getByRole('button', { name: '닫기' }).click();
    await expect(page).toHaveURL(/\/$/);
    const card = page.getByRole('button', { name: /경포대/ });
    await expect(card).toContainText(`다녀옴 ${todaySeoul().replaceAll('-', '.')}`);
    await expect(card).toContainText('“일출 최고”');
  });
});

// 세 프로젝트(데스크톱·iPhone·Galaxy) 모두에서 도는 시험이라 태그를 달지 않는다.
test('다녀옴·한 줄 평이 이미 들어 있는 보관함도 손상 없이 열린다', async ({ page }) => {
  const library = structuredClone(seed) as unknown as {
    places: Record<string, Record<string, unknown>>;
  };
  const place = library.places[placeIdByName('경포대')]!;
  const updatedAt = '2026-09-02T00:00:00.000Z';
  place.visitedOn = { value: '2026-09-01', updatedAt };
  place.review = { value: '예전에 다녀옴', updatedAt };
  await seedStorage(page, { library: false, prefs: { libraryView: 'list' } });
  await page.addInitScript(
    ({ key, json }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, json);
    },
    { key: LIBRARY_KEY, json: JSON.stringify(library) },
  );
  await page.goto('/');

  await expect(page.getByRole('button', { name: '백업 파일 받기' })).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: '방문' }).getByRole('button', { name: '가 본 곳 1' }),
  ).toBeVisible();
});
