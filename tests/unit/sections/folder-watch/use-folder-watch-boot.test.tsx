import { act, cleanup, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useFolderWatchBoot } from 'src/sections/folder-watch/use-folder-watch-boot';
import { libraryAtom } from 'src/stores/library-state';
import { recordFolderLink } from 'src/domain/library/folder-links';
import { makeLibrary, label } from '../../domain/backup/fixtures';
const { load, start } = vi.hoisted(() => ({ load: vi.fn(), start: vi.fn() }));
vi.mock('src/services/folder-watch/boot', () => ({ loadFolderWatch: load }));
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubEnv('DEV', false);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  load.mockResolvedValue({ startFolderWatch: start });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function setup(due: boolean) {
  const store = createStore();
  const lib = recordFolderLink(
    makeLibrary({ labels: [label(1)] }),
    { shareId: 'a'.repeat(32), folderName: '폴더', labelId: label(1).id, seenSids: [] },
    { now: new Date(Date.now() - (due ? 3 * 86400000 : 0)).toISOString(), newId: () => '' },
  );
  store.set(libraryAtom, lib);
  return renderHook(useFolderWatchBoot, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>
        <MemoryRouter>{children}</MemoryRouter>
      </Provider>
    ),
  });
}
it('기한이 있을 때만 3초 뒤 실행한다', async () => {
  const h = setup(true);
  expect(load).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(load).toHaveBeenCalledOnce();
  h.unmount();
});
it.each(['disabled', 'offline', 'recent'])('%s이면 실행기를 받지 않는다', async (kind) => {
  if (kind === 'disabled')
    localStorage.setItem(
      'tripmap:folder-watch:v1',
      JSON.stringify({ v: 1, enabled: false, lastRunAt: null, lastManualAt: null, folders: {} }),
    );
  if (kind === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const h = setup(kind !== 'recent');
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(load).not.toHaveBeenCalled();
  h.unmount();
});
it('탭이 보이면 다시 판단하고 언마운트하면 타이머를 지운다', async () => {
  const h = setup(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(load).toHaveBeenCalledOnce();
  h.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(load).toHaveBeenCalledOnce();
});
