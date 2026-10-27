import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { test, mockRoutes, seedStorage } from './fixtures';

/** 좁은 화면(하단 시트)인가. 경계는 다른 시험과 같은 compact(<768)다. */
const isCompact = (page: Page): boolean => page.viewportSize()!.width < 768;

/** 앱이 `/api/hours`에서 받는 응답을 녹화해 둔 fixture(`tests/fixtures/hours/api/daily.json`). */
const DAILY_HOURS = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/hours/api/daily.json', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

/** 앱이 `/api/hours`로 보낸 질의(`sid`, `fresh`)를 요청 순서대로 모은 것. */
type HoursCall = { sid: string; fresh: string | null };

/** `/api/hours`를 녹화 응답(질의의 `sid`로 바꿈)으로 대신하고, 받은 질의를 모아 돌려준다. */
async function mockHours(page: Page): Promise<HoursCall[]> {
  const calls: HoursCall[] = [];
  await page.route('**/api/hours?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const sid = params.get('sid') ?? '';
    calls.push({ sid, fresh: params.get('fresh') });
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ...DAILY_HOURS, sid }),
    });
  });
  return calls;
}

const candidatePanel = (page: Page): Locator =>
  isCompact(page)
    ? page.getByRole('region', { name: '일정 시트' })
    : page.getByRole('region', { name: '후보 칸' });

const timeline = (page: Page): Locator =>
  isCompact(page)
    ? page.getByRole('region', { name: '일정 시트' })
    : page.getByRole('region', { name: 'Day 시간표' });

/** 좁은 화면의 일정 시트 `Day 1` 탭을 연다(접힌 시트도 펼쳐진다). 넓은 화면은 시간표가 늘 보여 아무것도 하지 않는다. */
async function openDay1Tab(page: Page): Promise<void> {
  if (!isCompact(page)) return;
  await page.getByRole('region', { name: '일정 시트' }).getByRole('tab', { name: 'Day 1' }).click();
}

/** 보관함에서 지역 칩 `강릉` → `이 지역으로 여행 만들기` → 만들기. 계획 화면이 열린다. */
async function createGangneungTrip(page: Page): Promise<void> {
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

test.describe('영업시간 경고', () => {
  test('@smoke 도착 시각이 영업 전이면 행과 카드에 경고', async ({ page }) => {
    await mockRoutes(page);
    const calls = await mockHours(page);
    await createGangneungTrip(page);

    // 초당순두부 본점을 Day 1에: 출발 시각 09:00이 곧 도착 시각이다(영업은 10:00부터).
    await candidatePanel(page)
      .getByRole('button', { name: /^초당순두부 본점[을를] Day 1에 넣기$/ })
      .click();
    await openDay1Tab(page);

    // 1. 행: 경고 칩.
    const list = timeline(page).getByRole('list', { name: 'Day 1 일정' });
    const row = list.getByRole('listitem').filter({ hasText: '초당순두부 본점' });
    await expect(row).toContainText('09:00 도착 — 영업 시작 10:00');

    // 2. 행을 누르면 지도 위 카드: 그날 규칙과 확인 날짜(고정 응답의 fetchedAt, Asia/Seoul).
    // 행 버튼 이름은 `시각 장소 경고`로 시작한다(끌어 옮기기·메뉴 버튼과 가른다).
    await row.getByRole('button', { name: /^09:00 초당순두부 본점/ }).click();
    const card = page.getByRole('dialog', { name: '초당순두부 본점' });
    await expect(card.getByRole('heading', { level: 3, name: '영업시간' })).toBeVisible();
    await expect(card).toContainText('10:00~20:00');
    await expect(card).toContainText('09:00 도착 — 영업 시작 10:00');
    await expect(card).toContainText('10월 16일 확인 · 네이버');

    // 3. 다시 확인: 서버에 새로 받으라는 질의(fresh=1)가 간다.
    // 바로 읽어도 된다: 칩은 답을 받아야 보이고 처리기는 응답 전에 질의를 모으며, 다시 확인은 아직 누르지 않았다.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.fresh === null)).toBe(true);
    await card.getByRole('button', { name: '다시 확인' }).click();
    await expect.poll(() => calls.some((call) => call.fresh === '1')).toBe(true);
    await expect(card.getByRole('button', { name: '다시 확인' })).toBeEnabled();

    // 4. 카드를 닫고 출발 시각을 10:30으로: 영업 중에 도착하니 경고가 사라진다.
    await card.getByRole('button', { name: '카드 닫기' }).click();
    await expect(card).toHaveCount(0);
    // 좁은 화면은 카드가 열리면 시트가 접힌다. 탭을 눌러 다시 펼친다.
    await openDay1Tab(page);
    const startTime = timeline(page).getByLabel('출발 시각');
    await startTime.fill('10:30');
    await expect(list.getByText('10:30', { exact: true })).toBeVisible();
    // 행이 있어야 아래 `없음` 확인이 뜻을 가진다.
    await expect(row).toContainText('초당순두부 본점');
    await expect(row).not.toContainText('영업 시작');
    await expect(row).not.toContainText('영업시간 확인 필요');
  });
});
