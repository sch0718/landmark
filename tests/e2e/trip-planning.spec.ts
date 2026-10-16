import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockRoutes, seedStorage } from './fixtures';

/** 좁은 화면(하단 시트)인가. */
const isCompact = (page: Page): boolean => page.viewportSize()!.width < 768;

/** 좁은 화면의 일정 시트 탭을 연다. 넓은 화면에는 후보 칸과 시간표가 함께 보여 아무것도 하지 않는다. */
async function openSheetTab(page: Page, name: 'candidates' | 'Day 1' | 'Day 2'): Promise<void> {
  if (!isCompact(page)) return;
  const sheet = page.getByRole('region', { name: '일정 시트' });
  await sheet.getByRole('tab', { name: name === 'candidates' ? /^후보 / : name }).click();
}

const candidatePanel = (page: Page): Locator =>
  isCompact(page)
    ? page.getByRole('region', { name: '일정 시트' })
    : page.getByRole('region', { name: '후보 칸' });

const timeline = (page: Page): Locator =>
  isCompact(page)
    ? page.getByRole('region', { name: '일정 시트' })
    : page.getByRole('region', { name: 'Day 시간표' });

/** 후보 이름으로 ＋(을/를은 받침으로 갈리므로 정규식으로 잡는다). */
const addButton = (page: Page, name: string): Locator =>
  candidatePanel(page).getByRole('button', {
    name: new RegExp(`^${name}[을를] Day 1에 넣기$`),
  });

/** 보관함에서 지역 칩 `강릉` → `이 지역으로 여행 만들기` → 만들기. 계획 화면이 열린다. */
async function createGangneungTrip(page: Page): Promise<void> {
  await seedStorage(page, { prefs: { libraryView: 'list' } });
  await page.goto('/');
  await page.getByRole('group', { name: '지역' }).getByRole('button', { name: /^강릉/ }).click();
  await page.getByRole('button', { name: '이 지역으로 여행 만들기' }).click();
  const dialog = page.getByRole('dialog', { name: '새 여행' });
  await expect(dialog.getByRole('textbox', { name: '여행 이름' })).toHaveValue('강릉 여행');
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await expect(candidatePanel(page).getByRole('heading', { name: '강릉 여행' })).toBeVisible();
}

/** Day 1 시간표의 장소 이름을 위에서부터. */
async function day1Names(page: Page, names: string[]): Promise<string[]> {
  const rows = timeline(page).getByRole('list', { name: 'Day 1 일정' }).getByRole('listitem');
  const texts = await rows.allInnerTexts();
  return names
    .filter((name) => texts.some((t) => t.includes(name)))
    .sort((a, b) => texts.findIndex((t) => t.includes(a)) - texts.findIndex((t) => t.includes(b)));
}

test.describe('여행 계획', () => {
  test('@smoke 지역 칩으로 여행을 만들고 Day에 넣으면 시간표가 나온다', async ({ page }) => {
    const calls = await mockRoutes(page);
    await createGangneungTrip(page);

    // 강릉 보관함 장소(11곳)가 모두 후보다.
    await expect(candidatePanel(page).getByRole('heading', { name: '후보 11' })).toBeVisible();

    await addButton(page, '초당순두부 본점').click();
    await addButton(page, '경포대').click();
    await openSheetTab(page, 'Day 1');

    const list = timeline(page).getByRole('list', { name: 'Day 1 일정' });
    // 도착 시각 둘(첫 장소는 출발 시각 09:00)과 그 사이 구간 하나.
    await expect(list.getByText(/^\d{2}:\d{2}$/)).toHaveCount(2);
    await expect(list.getByText('09:00', { exact: true })).toBeVisible();
    const leg = list.getByRole('listitem', { name: /^초당순두부 본점 → 경포대$/ });
    await expect(leg).toHaveCount(1);
    await expect(list.getByRole('listitem', { name: /→/ })).toHaveCount(1);
    // 구간 행: 이동 수단·시간·거리(녹화 응답)와 길찾기 링크.
    await expect(leg.getByText(/\d+(분|초) · [\d.]+k?m/)).toBeVisible();
    const link = leg.getByRole('link', { name: '네이버 지도로 길찾기' });
    const href = (await link.getAttribute('href'))!;
    expect(href).toMatch(
      isCompact(page)
        ? /^nmap:\/\/route\/(car|walk)\?/
        : /^https:\/\/map\.naver\.com\/p\/directions\//,
    );

    // 경로는 서버(/api/route)에 물었다.
    expect(calls.length).toBeGreaterThan(0);
  });

  test('순서 정리로 동선을 줄인다', async ({ page }) => {
    await mockRoutes(page);
    await createGangneungTrip(page);

    // 일부러 멀리 갔다 돌아오는 순서로 넣는다: 초당(128.9,37.79) → 정동진(129.03,37.69) → 경포대(128.9,37.8) → 주문진(128.82,37.89).
    const order = ['초당순두부 본점', '정동진 해변', '경포대', '주문진 수산시장'];
    for (const name of order) await addButton(page, name).click();
    await openSheetTab(page, 'Day 1');
    await expect.poll(() => day1Names(page, order)).toEqual(order);

    await timeline(page).getByRole('button', { name: '순서 정리' }).click();
    await expect(page.getByText('순서를 정리했어요').first()).toBeVisible();
    const sorted = await day1Names(page, order);
    expect(sorted).toHaveLength(4);
    expect(sorted).not.toEqual(order);
    // 정동진은 끝에 가깝다: 경포대·초당·주문진 같은 북쪽 무리와 떨어져 있어 맨 앞이나 맨 뒤로 간다.
    expect([sorted[0], sorted[3]]).toContain('정동진 해변');

    // 되돌리기 토스트로 원래 순서로 돌아간다.
    // (＋로 넣을 때마다 남은 토스트들이 있어 `순서를 정리했어요` 토스트의 버튼을 집는다.)
    await page
      .locator('[data-sonner-toast]')
      .filter({ hasText: '순서를 정리했어요' })
      .getByRole('button', { name: '되돌리기' })
      .click();
    await expect.poll(() => day1Names(page, order)).toEqual(order);

    // 다시 정리하면 같은 결과가 되고, 그 상태에서 한 번 더 누르면 알리기만 한다(순서는 그대로).
    await timeline(page).getByRole('button', { name: '순서 정리' }).click();
    await expect.poll(() => day1Names(page, order)).toEqual(sorted);
    await timeline(page).getByRole('button', { name: '순서 정리' }).click();
    await expect(page.getByText('이미 가장 짧은 순서예요')).toBeVisible();
    expect(await day1Names(page, order)).toEqual(sorted);
  });

  test('Day 자동 나누기를 미리 보고 적용한다', async ({ page }) => {
    await mockRoutes(page);
    await createGangneungTrip(page);
    await openSheetTab(page, 'candidates');

    await candidatePanel(page).getByRole('button', { name: 'Day 자동 나누기' }).click();
    // 미리보기: Day별 곳 수만 보이고 아직 시간표에는 아무것도 없다.
    const summary = candidatePanel(page).getByText(/^Day 1에 \d+곳, Day 2에 \d+곳$/);
    await expect(summary).toBeVisible();
    await expect(
      candidatePanel(page).getByRole('button', { name: '적용', exact: true }),
    ).toBeVisible();
    await expect(candidatePanel(page).getByRole('heading', { name: '후보 11' })).toBeVisible();

    await candidatePanel(page).getByRole('button', { name: '적용', exact: true }).click();
    await expect(page.getByText('Day 자동 나누기를 적용했어요')).toBeVisible();
    // 후보가 모두 Day로 갔다.
    await expect(candidatePanel(page).getByRole('heading', { name: '후보 0' })).toBeVisible();

    await openSheetTab(page, 'Day 1');
    const day1 = await timeline(page)
      .getByRole('list', { name: 'Day 1 일정' })
      .getByRole('listitem')
      .count();
    await openSheetTab(page, 'Day 2');
    if (!isCompact(page)) {
      await page.getByRole('tab', { name: /^Day 2/ }).click();
    }
    const day2 = await timeline(page)
      .getByRole('list', { name: 'Day 2 일정' })
      .getByRole('listitem')
      .count();
    expect(day1).toBeGreaterThan(0);
    expect(day2).toBeGreaterThan(0);
  });
});
