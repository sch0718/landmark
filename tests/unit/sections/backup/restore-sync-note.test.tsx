import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { buildBackupText } from 'src/domain/backup/build-backup';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { emptyLibrary } from 'src/schema/library';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
const mock = vi.hoisted(() => ({ enabled: false }));
vi.mock('src/services/library-sync/boot', async (original) => ({
  ...(await original<typeof import('src/services/library-sync/boot')>()),
  readBootFlag: () => mock.enabled,
}));
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
});
it.each([false, true])('동기화가 %s일 때 되살리기 안내를 확인한다', async (enabled) => {
  mock.enabled = enabled;
  await renderLibrary(sampleLibrary(), { path: '/settings' });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '백업 파일로 되살리기' }));
  const text = buildBackupText({ rawLibrary: emptyLibrary(), prefs: null, now: new Date() });
  await user.upload(
    await screen.findByLabelText('백업 파일 선택'),
    new File([text], 'backup.json', { type: 'application/json' }),
  );
  await screen.findByText(/백업 파일: 장소 0곳/);
  const note = screen.queryByText('동기화가 켜져 있어요. 되살린 내용은 다른 기기에도 반영돼요.');
  if (enabled) expect(note).toBeInTheDocument();
  else expect(note).toBeNull();
});
