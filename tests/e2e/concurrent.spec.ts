import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  E2E_PUBLIC_ID,
  fillNewMemo,
  openPlace,
  openSettingsItem,
  openTrip,
  placeKey,
  submitNickname,
} from './trip';

/**
 * 같은 브라우저 컨텍스트(= 같은 localStorage·Web Locks)의 두 페이지가 같은 여행을 동시에 편집한다
 * (Review Focus 4). 닉네임은 페이지 A에서 UI(설정 → 닉네임 변경)로 한 번 만들고, B는 저장소에서 읽는다.
 */
async function openTwoPages(context: BrowserContext): Promise<[Page, Page]> {
  const a = await context.newPage();
  await openTrip(a);
  expect(await a.evaluate(() => typeof navigator.locks?.request === 'function')).toBe(true);
  await openSettingsItem(a, '닉네임 변경');
  await submitNickname(a, '나');
  await expect
    .poll(() => a.evaluate((id) => localStorage.getItem(`tripmap:edit:${id}`), E2E_PUBLIC_ID))
    .not.toBeNull();

  const b = await context.newPage();
  await openTrip(b);
  return [a, b];
}

/** 저장소에 남은 (장소 → 메모) 목록. */
async function storedMemos(page: Page): Promise<Record<string, string>> {
  return page.evaluate((id) => {
    const raw = localStorage.getItem(`tripmap:edit:${id}`);
    if (!raw) return {};
    const layer = JSON.parse(raw) as {
      places: Record<string, { memos: Record<string, { text: string | null }> }>;
    };
    const out: Record<string, string> = {};
    for (const [key, place] of Object.entries(layer.places)) {
      for (const memo of Object.values(place.memos)) if (memo.text !== null) out[key] = memo.text;
    }
    return out;
  }, E2E_PUBLIC_ID);
}

test('A가 저장한 뒤 B가 새로고침 없이 저장해도 두 메모가 모두 남는다 @smoke', async ({
  context,
}) => {
  const [a, b] = await openTwoPages(context);

  const cardA = await openPlace(a, 1);
  await (await fillNewMemo(cardA, '첫 번째 메모')).click();
  await expect(cardA.getByText('첫 번째 메모')).toBeVisible();

  const cardB = await openPlace(b, 2);
  await (await fillNewMemo(cardB, '두 번째 메모')).click();
  await expect(cardB.getByText('두 번째 메모')).toBeVisible();

  for (const page of [a, b]) {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E 테스트 여행' })).toBeVisible();
    await expect((await openPlace(page, 1)).getByText('첫 번째 메모')).toBeVisible();
    await expect((await openPlace(page, 2)).getByText('두 번째 메모')).toBeVisible();
  }
});

test('두 페이지가 동시에 3번씩 저장해도 6개 메모가 모두 남는다(Web Locks) @smoke', async ({
  context,
}) => {
  const [a, b] = await openTwoPages(context);
  const ROUNDS = 3;

  for (let i = 0; i < ROUNDS; i++) {
    const na = 3 + 2 * i;
    const nb = 4 + 2 * i;
    const cardA = await openPlace(a, na);
    const saveA = await fillNewMemo(cardA, `동시메모 A${i}`);
    const cardB = await openPlace(b, nb);
    const saveB = await fillNewMemo(cardB, `동시메모 B${i}`);
    // 두 저장을 같은 순간에 시작한다.
    await Promise.all([saveA.click(), saveB.click()]);
    await Promise.all([
      expect(cardA.getByText(`동시메모 A${i}`)).toBeVisible(),
      expect(cardB.getByText(`동시메모 B${i}`)).toBeVisible(),
    ]);
  }

  const expected: Record<string, string> = {};
  for (let i = 0; i < ROUNDS; i++) {
    expected[placeKey(3 + 2 * i)] = `동시메모 A${i}`;
    expected[placeKey(4 + 2 * i)] = `동시메모 B${i}`;
  }

  for (const page of [a, b]) {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E 테스트 여행' })).toBeVisible();
    expect(await storedMemos(page)).toEqual(expected);
    // 화면의 검색 결과에도 저장한 모든 메모가 나타난다.
    await page
      .getByRole('dialog', { name: '장소 상세', exact: true })
      .getByRole('button', { name: '닫기', exact: true })
      .click();
    await page.getByRole('button', { name: '장소', exact: true }).click();
    await page.getByRole('textbox', { name: '검색', exact: true }).fill('동시메모');
    await page.getByRole('button', { name: '목록', exact: true }).click();
    await expect(page.getByText(`${ROUNDS * 2}곳`, { exact: true })).toBeVisible();
    await expect((await openPlace(page, 3)).getByText('동시메모 A0')).toBeVisible();
    await expect(
      (await openPlace(page, 4 + 2 * (ROUNDS - 1))).getByText(`동시메모 B${ROUNDS - 1}`),
    ).toBeVisible();
  }
});
