import { act, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const { flag, load, start } = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), start: vi.fn() }));
vi.mock('src/services/library-sync/boot', () => ({ readBootFlag: flag }));
vi.mock('src/services/agent-inbox/boot', () => ({ loadAgentInbox: load }));
import { useAgentInboxBoot } from 'src/sections/agent/use-agent-inbox-boot';
import { OFF_STATUS, syncStatusAtom } from 'src/stores/sync-status';
beforeEach(() => {
  vi.clearAllMocks();
  flag.mockReturnValue(false);
  load.mockResolvedValue({ startInboxCheck: start });
});
function mount() {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, ...renderHook(useAgentInboxBoot, { wrapper }) };
}
it('동기화가 꺼졌으면 실행기를 받지 않아요', () => {
  mount();
  expect(load).not.toHaveBeenCalled();
});
it('같은 렌더에서 처음 synced가 되면 한 번만 받아 시작해요', async () => {
  const { store, rerender } = mount();
  act(() => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'syncing' }));
  expect(load).not.toHaveBeenCalled();
  act(() => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
  await waitFor(() => expect(start).toHaveBeenCalledOnce());
  act(() => {
    store.set(syncStatusAtom, OFF_STATUS);
    store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
  });
  rerender();
  expect(load).toHaveBeenCalledOnce();
});
it('부트 플래그가 켜졌으면 마운트에 바로 시작해요', async () => {
  flag.mockReturnValue(true);
  const { store } = mount();
  await waitFor(() => expect(start).toHaveBeenCalledOnce());
  act(() => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
  expect(load).toHaveBeenCalledOnce();
});
it('언마운트하면 상태 구독을 풀어요', () => {
  const { store, unmount } = mount();
  unmount();
  act(() => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
  expect(load).not.toHaveBeenCalled();
});
it('조각을 받지 못해도 오류를 밖으로 던지지 않아요', async () => {
  flag.mockReturnValue(true);
  load.mockRejectedValue(Error('파일을 받지 못했어요'));
  mount();
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  expect(start).not.toHaveBeenCalled();
});
