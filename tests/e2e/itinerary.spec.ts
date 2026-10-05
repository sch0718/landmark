import { expect, test, type Page } from '@playwright/test';
import { openSettingsItem, openTrip, placeName, submitNickname, TRIP_PATH } from './trip';

const DAY1 = 'Day 1 (11/14)';
const ORIGINAL = [placeName(1), placeName(2), placeName(3)];
const REORDERED = [placeName(2), placeName(1), placeName(3)];

/** Day 1 타임라인의 읽기/편집 상태와 독립적인 장소 순서. */
async function day1Order(page: Page): Promise<string[]> {
  return page
    .getByRole('list', { name: `${DAY1} 타임라인` })
    .locator('[data-stop-id]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-stop-name') ?? ''));
}

const expectDay1Order = (page: Page, order: string[]) =>
  expect.poll(() => day1Order(page)).toEqual(order);

/** 일정 모드의 Day 1 탭을 버튼으로 연다. 화면 상태가 URL 쿼리에 반영된다. */
async function openDay1(page: Page): Promise<void> {
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page).toHaveURL(/[?&]view=day/);
  await page.getByRole('tab', { name: 'Day 1' }).click();
  await expect(page).toHaveURL(/[?&]day=1/);
}

const expectDay1View = async (page: Page) => {
  await expect(page.getByRole('button', { name: '일정', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'Day 1' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('list', { name: `${DAY1} 타임라인` })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Day 2 (11/15)' })).toHaveCount(0);
};

test('?mode=itinerary&day=1 딥 링크로 Day 1 일정이 바로 열리고 새로고침해도 유지된다 @smoke', async ({
  page,
}) => {
  await openTrip(page, `${TRIP_PATH}?mode=itinerary&day=1`);
  await expectDay1View(page);
  await expectDay1Order(page, ORIGINAL);
  await expect(page).toHaveURL(/\?mode=itinerary&day=1$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E 테스트 여행' })).toBeVisible();
  await expectDay1View(page);
  await expect(page).toHaveURL(/\?mode=itinerary&day=1$/);
});

test('일정 순서 변경 → 파일 내보내기 → 되돌리기 → 옛 파일 가져오기에서 되돌린 상태가 유지된다 @smoke', async ({
  page,
}, testInfo) => {
  await openTrip(page);
  await openDay1(page);
  await expectDay1Order(page, ORIGINAL);
  const hint = page.getByTestId('author-hint');
  await expect(hint).toBeHidden();

  // 키보드 드래그: 장소 1을 한 칸 아래로. 첫 편집이라 닉네임을 묻는다.
  await page.getByRole('button', { name: '일정 편집', exact: true }).click();
  const handle = page.getByRole('button', { name: `${placeName(1)} 순서 바꾸기` });
  await handle.focus();
  // dnd-kit 안내 문구(live region)로 각 단계가 반영됐는지 확인하며 진행한다.
  const live = page.getByRole('status').filter({ hasText: 'draggable item stopaa01' });
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await expect(live).toBeAttached();
  // 집어 든 직후 목록 위치를 재기 전의 ArrowDown은 제자리(stopaa01 위)로 안내되므로,
  // stopaa02 위로 옮겨졌다는 안내가 나올 때까지 다시 누른다.
  await expect(async () => {
    await page.keyboard.press('ArrowDown');
    await expect(live).toContainText('over droppable area stopaa02', { timeout: 500 });
  }).toPass();
  await page.keyboard.press('Space');
  await submitNickname(page, '작성자');
  await expectDay1Order(page, REORDERED);

  // 미계산 구간과 작성자 안내.
  await expect(
    page.getByTestId('leg-row').filter({ hasText: '재계산 필요' }).first(),
  ).toBeVisible();
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('apply-edit');

  // 파일 내보내기 A.
  await openSettingsItem(page, '내보내기');
  const exportDialog = page.getByRole('dialog', { name: '편집 내보내기' });
  const downloadPromise = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: '파일로 저장' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^E2E 테스트 여행-작성자-\d{8}\.tripedit\.json$/);
  const fileA = testInfo.outputPath('a.tripedit.json');
  await download.saveAs(fileA);
  await exportDialog.getByRole('button', { name: '닫기' }).click();
  await expect(exportDialog).toBeHidden();

  // 되돌리기(묶음이 Day 1 하나라 바로 reset).
  await page
    .getByRole('region', { name: DAY1 })
    .getByRole('button', { name: '원본 일정으로 되돌리기' })
    .click();
  await expectDay1Order(page, ORIGINAL);
  await expect(hint).toBeHidden();

  // A 다시 가져오기: Day 1 충돌의 기본값은 더 최신인 reset(내 것).
  await page.getByLabel('편집 파일 선택').setInputFiles(fileA);
  const importDialog = page.getByRole('dialog', { name: '편집 가져오기' });
  await expect(importDialog.getByText('일정 충돌 — 묶음마다 하나를 고르세요')).toBeVisible();
  const conflict = importDialog.getByRole('radiogroup', { name: 'Day 1' });
  await expect(conflict.getByRole('radio', { name: '내 것' })).toBeChecked();
  await expect(conflict.getByRole('radio', { name: '받은 것' })).not.toBeChecked();
  await importDialog.getByRole('button', { name: '가져오기' }).click();
  await expect(importDialog).toBeHidden();
  await expect(page.getByText('편집을 가져왔어요')).toBeVisible();

  // 일정은 원본과 같고, 새로고침해도 유지된다.
  await expectDay1Order(page, ORIGINAL);
  await expect(hint).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E 테스트 여행' })).toBeVisible();
  await expectDay1View(page);
  await expectDay1Order(page, ORIGINAL);
  await expect(page.getByTestId('author-hint')).toBeHidden();
  await expect(page.getByRole('button', { name: '원본 일정으로 되돌리기' })).toHaveCount(0);
});
