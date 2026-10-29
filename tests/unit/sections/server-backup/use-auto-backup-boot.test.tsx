import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const { flag, start, load } = vi.hoisted(() => ({ flag: vi.fn(), start: vi.fn(), load: vi.fn() }));
vi.mock('src/services/server-backup/boot', () => ({
  readAutoBackupFlag: flag,
  loadAutoBackup: load,
}));
import { useAutoBackupBoot } from 'src/sections/server-backup/use-auto-backup-boot';
it('플래그가 켜진 마운트에만 한 번 붙인다', async () => {
  flag.mockReturnValue(false);
  const first = renderHook(useAutoBackupBoot);
  expect(load).not.toHaveBeenCalled();
  first.unmount();
  flag.mockReturnValue(true);
  load.mockResolvedValue({ startAutoBackup: start });
  renderHook(useAutoBackupBoot);
  await waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(load).toHaveBeenCalledOnce();
});
