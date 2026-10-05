import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const E2E_PUBLIC_ID = 'e2etest000001';
export const TRIP_PATH = `/t/${E2E_PUBLIC_ID}`;
export const E2E_FIXTURE_FILE = fileURLToPath(
  new URL('../fixtures/trips/e2e.json', import.meta.url),
);
export const E2E_DATA_FILE = fileURLToPath(
  new URL(`../../public/data/${E2E_PUBLIC_ID}.json`, import.meta.url),
);

/** fixture 장소 번호(1~42) → PlaceKey·이름. */
export const placeKey = (n: number) => `n:${1000 + n}`;
export const placeName = (n: number) => `테스트 장소 ${String(n).padStart(2, '0')}`;

/** 여행 화면을 열고 로드가 끝날 때까지 기다린다. */
export async function openTrip(page: Page, url: string = TRIP_PATH): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'E2E 테스트 여행' })).toBeVisible();
}

/** 모바일 하단 시트를 full로 펼친다(peek → half → full). */
export async function expandSheet(page: Page): Promise<void> {
  const handle = page.getByRole('button', { name: '시트 크기 조절' });
  const sheet = page.getByTestId('view-panel');
  const peek = (await sheet.boundingBox())!.height;
  await handle.click();
  await expect.poll(async () => (await sheet.boundingBox())!.height).toBeGreaterThan(peek);
  const half = (await sheet.boundingBox())!.height;
  await handle.click();
  await expect.poll(async () => (await sheet.boundingBox())!.height).toBeGreaterThan(half);
}

/** 탐색 목록에서 장소를 선택하고 펼쳐진 카드를 돌려준다. */
export async function openPlace(page: Page, n: number): Promise<Locator> {
  const detail = page.getByRole('dialog', { name: '장소 상세', exact: true, includeHidden: true });
  if (await detail.isVisible())
    await detail.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await page.getByRole('button', { name: `${placeName(n)} 상세`, exact: true }).click();
  const card = page.getByTestId(`place-card-${placeKey(n)}`);
  await expect(card).toBeVisible();
  return card;
}

/** 카드의 "메모 추가" 폼을 열고 내용을 채운다. 저장 버튼을 돌려준다. */
export async function fillNewMemo(card: Locator, text: string): Promise<Locator> {
  await card.getByRole('button', { name: '메모 추가' }).click();
  await card.getByLabel('내 메모').fill(text);
  return card.getByRole('button', { name: '저장', exact: true });
}

/** 열려 있는 닉네임 대화상자에 입력하고 저장한다. */
export async function submitNickname(page: Page, nickname: string): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ has: page.getByLabel('닉네임') });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('닉네임').fill(nickname);
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(dialog).toBeHidden();
}

/** 상단 설정 메뉴의 항목을 누른다. */
export async function openSettingsItem(page: Page, item: string): Promise<void> {
  const detail = page.getByRole('dialog', { name: '장소 상세', exact: true, includeHidden: true });
  if (await detail.isVisible())
    await detail.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '설정' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}
