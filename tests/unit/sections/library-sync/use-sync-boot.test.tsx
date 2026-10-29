import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import { useSyncBoot } from 'src/sections/library-sync/use-sync-boot';
import { libraryAtom } from 'src/stores/library-state';
import { emptyLibrary } from 'src/schema/library';
const mock = vi.hoisted(() => ({
  enabled: false,
  own: false,
  start: vi.fn(),
  schedule: vi.fn(),
  load: vi.fn(),
}));
vi.mock('src/services/library-sync/boot', () => ({
  readBootFlag: () => mock.enabled,
  loadSyncEngine: mock.load,
}));
afterEach(() => {
  cleanup();
  mock.enabled = false;
  mock.own = false;
  vi.clearAllMocks();
});
it('꺼진 기기는 엔진을 불러오지 않는다', () => {
  renderHook(useSyncBoot);
  expect(mock.load).not.toHaveBeenCalled();
});
it('켜진 기기는 시작하고 자기 반영을 빼고 저장을 예약한다', async () => {
  mock.enabled = true;
  mock.load.mockResolvedValue({
    ensureLibrarySyncEngine: () => ({
      start: mock.start,
      schedule: mock.schedule,
      isOwnWrite: () => mock.own,
    }),
  });
  const store = createStore();
  renderHook(useSyncBoot, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(1));
  act(() => store.set(libraryAtom, emptyLibrary()));
  expect(mock.schedule).toHaveBeenCalledWith('save');
  mock.own = true;
  mock.schedule.mockClear();
  act(() => store.set(libraryAtom, emptyLibrary()));
  expect(mock.schedule).not.toHaveBeenCalled();
});
it('화면에서 처음 연결한 뒤의 저장도 엔진에 전달한다', async () => {
  const store = createStore();
  mock.load.mockResolvedValue({
    ensureLibrarySyncEngine: () => ({
      start: mock.start,
      schedule: mock.schedule,
      isOwnWrite: () => false,
    }),
  });
  renderHook(useSyncBoot, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  mock.enabled = true;
  act(() => store.set(libraryAtom, emptyLibrary()));
  await waitFor(() => expect(mock.schedule).toHaveBeenCalledWith('save'));
});
