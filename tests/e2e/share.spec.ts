import { devices, expect, test, type Page } from '@playwright/test';
import { fillNewMemo, openPlace, openSettingsItem, openTrip, submitNickname } from './trip';

const MEMO = '여기 꼭 가요';

/**
 * 헤드리스 브라우저에는 OS 공유 시트가 없으므로 `navigator.share`를 지워 클립보드 경로를 쓰게 하고,
 * 복사된 값을 기록해 둔다(클립보드 읽기 권한이 없는 WebKit 대비). 복사가 실패하면 앱이 보여 주는
 * 링크 텍스트 필드에서 읽는다.
 */
async function prepareClipboardCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as Window & { __copied?: string };
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    const original = clipboard.writeText.bind(clipboard);
    clipboard.writeText = (text: string) => {
      w.__copied = text;
      return original(text);
    };
  });
}

async function readExportedLink(page: Page): Promise<string> {
  const dialog = page.getByRole('dialog', { name: '편집 내보내기' });
  await dialog.getByRole('button', { name: '링크 공유' }).click();
  const copied = dialog.getByText('링크를 복사했어요');
  const manual = dialog.getByLabel('링크');
  await expect(copied.or(manual)).toBeVisible();
  const path = (await manual.isVisible()) ? 'manual' : 'clipboard';
  test.info().annotations.push({ type: 'export-path', description: path });
  if (path === 'manual') return manual.inputValue();
  const link = await page.evaluate(() => (window as Window & { __copied?: string }).__copied);
  expect(link).toBeTruthy();
  return link!;
}

test('링크로 받은 동행의 메모를 새 기기에서 가져오면 "동행" 이름으로 보인다 @smoke', async ({
  page,
  browser,
  browserName,
  baseURL,
}) => {
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await prepareClipboardCapture(page);

  // 동행의 휴대폰: 링크 열기 → 장소 카드 메모 → 닉네임 "동행".
  await openTrip(page);
  const card = await openPlace(page, 1);
  await (await fillNewMemo(card, MEMO)).click();
  await submitNickname(page, '동행');
  await expect(card.getByText(MEMO)).toBeVisible();

  // 링크 내보내기.
  await openSettingsItem(page, '내보내기');
  const link = await readExportedLink(page);
  expect(link).toMatch(/\/t\/e2etest000001#e=[A-Za-z0-9_-]+$/);

  // 내 휴대폰(새 컨텍스트 = 저장소 없음): 링크 열기 → 닉네임 → 가져오기.
  const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 13'];
  void _ignored;
  const mine = await browser.newContext({ ...iphone, baseURL });
  try {
    const other = await mine.newPage();
    await other.goto(link);
    // 저장된 편집이 없으므로 가져오기 전에 닉네임부터 묻는다.
    await submitNickname(other, '나');
    const importDialog = other.getByRole('dialog', { name: '편집 가져오기' });
    await expect(importDialog.getByText('메모 추가 1 · 변경 0 · 삭제 0')).toBeVisible();
    await importDialog.getByRole('button', { name: '가져오기' }).click();
    await expect(importDialog).toBeHidden();
    await expect(other).toHaveURL(/\/t\/e2etest000001$/);

    const received = await openPlace(other, 1);
    await expect(received.getByText('동행', { exact: true })).toBeVisible();
    await expect(received.getByText(MEMO)).toBeVisible();
    // 받은 메모는 내 것이 아니므로 수정 버튼이 없다.
    await expect(received.getByRole('button', { name: '메모 수정' })).toHaveCount(0);
  } finally {
    await mine.close();
  }
});
