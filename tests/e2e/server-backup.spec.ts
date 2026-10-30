import { expect } from '@playwright/test';
import { test, mockRoutes, placeIdByName, SEED_PLACE_COUNT, seedStorage } from './fixtures';
import { createSyncServer, installSyncServer } from './sync-server';
const REMOTE_SYNC_NOTE = '이 백업 뒤에 만든 장소·여행은 동기화로 다시 들어와요.';

test('@desktop 서버 백업 만들기·파일 사본을 받고 되살리기·자동 백업·지우기', async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const server = createSyncServer();
  try {
    await installSyncServer(context, server);
    await seedStorage(page, { prefs: { libraryView: 'list' } });
    await mockRoutes(page);
    await page.goto('/settings');
    const sync = page.getByRole('region', { name: '동기화', exact: true });
    await sync.getByRole('button', { name: '카카오로 로그인', exact: true }).click();
    await page.getByRole('textbox', { name: /계정 ID/ }).fill('me');
    await page.getByLabel('정상 로그인', { exact: true }).check();
    await page.getByRole('button', { name: '계속', exact: true }).click();
    await page
      .getByRole('dialog', { name: '연결 방식' })
      .getByRole('button', { name: '올리기', exact: true })
      .click();
    await expect(sync.getByText('동기화 완료', { exact: true })).toBeVisible({ timeout: 15000 });
    const backup = page.getByRole('region', { name: '서버 백업', exact: true });
    await expect(backup.getByText('서버 백업: 없음', { exact: true })).toBeVisible();
    await backup.getByRole('button', { name: '서버 백업 지금 만들기', exact: true }).click();
    await expect(page.getByText(/^서버 백업을 만들었어요/)).toBeVisible();
    await expect(
      backup.getByText(new RegExp(`^서버 백업: .* · 장소 ${SEED_PLACE_COUNT}곳`)),
    ).toBeVisible();
    // 백업 뒤에 만든 항목은 서버에 올린 다음 복원으로 빠져도 다시 받아야 한다.
    const laterLabel = '백업 뒤에 만든 라벨';
    await page.goto('/labels');
    await page.getByRole('textbox', { name: '새 라벨 이름', exact: true }).fill(laterLabel);
    await page.getByRole('button', { name: '추가', exact: true }).click();
    await expect(page.getByText(laterLabel, { exact: true })).toBeVisible();
    await page.goto('/settings');
    await expect(sync.getByText('동기화 완료', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.goto(`/place/${placeIdByName('경포대')}`);
    await page
      .getByRole('region', { name: '장소 상세' })
      .getByRole('button', { name: '삭제', exact: true })
      .click();
    await page.goto('/settings');
    await expect(sync.getByText('동기화 완료', { exact: true })).toBeVisible({ timeout: 15000 });
    await backup.getByRole('button', { name: '서버 백업에서 되살리기', exact: true }).click();
    const restore = page.getByRole('dialog', { name: '서버 백업에서 되살리기', exact: true });
    await expect(restore.getByText(/^서버 백업 · /)).toBeVisible();
    await expect(
      restore.getByRole('checkbox', { name: '바꾸기 전에 지금 보관함을 파일로 받기', exact: true }),
    ).toBeChecked();
    await expect(restore.getByText(REMOTE_SYNC_NOTE, { exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await restore.getByRole('button', { name: '이 백업으로 바꾸기', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/^landmark-backup-.*\.json$/);
    await expect(page.getByText(/^백업에서 되살렸어요/)).toBeVisible();
    await expect(sync.getByText('동기화 완료', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.goto('/labels');
    await expect(page.getByText(laterLabel, { exact: true })).toBeVisible({ timeout: 15000 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /경포대/ }).first()).toBeVisible();
    await page.goto('/settings');
    await backup.getByRole('switch', { name: '자동 백업', exact: true }).check();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('tripmap:server-backup:v1')!).nextCheckAt,
        ),
      )
      .not.toBeNull();
    await server.db.prepare('UPDATE library_backups SET created_at = created_at - 90000000').run();
    await page.evaluate(() => {
      const key = 'tripmap:server-backup:v1';
      const state = JSON.parse(localStorage.getItem(key)!);
      state.nextCheckAt = null;
      localStorage.setItem(key, JSON.stringify(state));
    });
    await page.goto(`/place/${placeIdByName('경포대')}`);
    const detail = page.getByRole('region', { name: '장소 상세' });
    await detail.getByRole('textbox', { name: '메모', exact: true }).fill('자동 백업 시험');
    await expect(detail.getByRole('status').filter({ hasText: '저장됨' })).toBeVisible();
    await page.reload();
    await page.goto('/settings');
    await expect(backup.getByText(/^서버 백업: .* · 자동$/)).toBeVisible({ timeout: 10000 });
    expect((await server.db.prepare('SELECT reason FROM library_backups').first())?.reason).toBe(
      'auto',
    );
    await backup.getByRole('button', { name: '서버 백업 지우기', exact: true }).click();
    await page
      .getByRole('dialog', { name: '서버 백업 지우기', exact: true })
      .getByRole('button', { name: '지우기', exact: true })
      .click();
    await expect(backup.getByText('서버 백업: 없음', { exact: true })).toBeVisible();
  } finally {
    await page.close();
    server.close();
  }
});
