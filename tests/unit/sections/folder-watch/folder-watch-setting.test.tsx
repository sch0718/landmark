import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FolderWatchSetting } from 'src/sections/folder-watch/FolderWatchSetting';
import { libraryAtom } from 'src/stores/library-state';
import { folderWatchAtom } from 'src/stores/folder-watch';
import { readFolderWatch, EMPTY_FOLDER_WATCH } from 'src/services/folder-watch/state';
import { recordFolderLink } from 'src/domain/library/folder-links';
import { label, makeLibrary } from '../../domain/backup/fixtures';
const { start } = vi.hoisted(() => ({ start: vi.fn().mockResolvedValue({}) }));
vi.mock('src/services/folder-watch/boot', () => ({
  loadFolderWatch: async () => ({ startFolderWatch: start }),
}));
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup(linked = false, lastRunAt: number | null = null) {
  const store = createStore();
  const lib = linked
    ? recordFolderLink(
        makeLibrary({ labels: [label(1)] }),
        { shareId: 'abc123', folderName: '폴더', labelId: label(1).id, seenSids: [] },
        { now: new Date().toISOString(), newId: () => '' },
      )
    : makeLibrary();
  store.set(libraryAtom, lib);
  store.set(folderWatchAtom, { ...EMPTY_FOLDER_WATCH, lastRunAt });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <FolderWatchSetting />
      </MemoryRouter>
    </Provider>,
  );
}
it('기본은 켜지고 끄면 기기 기록에 남긴다', async () => {
  setup();
  const toggle = screen.getByRole('switch', { name: '네이버 폴더 변경 알림' });
  expect(toggle).toBeChecked();
  await userEvent.click(toggle);
  expect(readFolderWatch(localStorage).enabled).toBe(false);
  expect(screen.queryByRole('button', { name: '지금 확인' })).not.toBeInTheDocument();
});
it('살아 있는 연결을 수동으로 확인한다', async () => {
  setup(true);
  await userEvent.click(screen.getByRole('button', { name: '지금 확인' }));
  await waitFor(() =>
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ manual: true })),
  );
});
it('마지막 확인 시각을 보인다', () => {
  setup(true, Date.parse('2026-10-30T00:00:00Z'));
  expect(screen.getByText(/마지막 확인 10.30/)).toBeInTheDocument();
});
