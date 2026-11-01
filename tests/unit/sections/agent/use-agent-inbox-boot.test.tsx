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

it.each([false, true])(
  '부트 플래그 %s에서 조각 받기가 실패하면 다음 synced에 재시도하고 성공 뒤 멈춰요',
  async (bootFlag) => {
    flag.mockReturnValue(bootFlag);
    load.mockRejectedValueOnce(Error('파일을 받지 못했어요'));
    const { store } = mount();
    await act(async () => {
      if (!bootFlag) store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
    });
    expect(load).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    await act(async () => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
    expect(load).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledOnce();
    await act(async () => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
    expect(load).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledOnce();
  },
);

it.each([false, true])(
  '부트 플래그 %s에서 실행기 시작이 실패하면 다음 synced에 재시도해요',
  async (bootFlag) => {
    flag.mockReturnValue(bootFlag);
    start.mockRejectedValueOnce(Error('시작하지 못했어요'));
    const { store } = mount();
    await act(async () => {
      if (!bootFlag) store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
    });
    expect(start).toHaveBeenCalledOnce();
    await act(async () => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
    expect(load).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(2);
    await act(async () => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
    expect(start).toHaveBeenCalledTimes(2);
  },
);

it('조각 받기와 실행기 시작을 기다리는 동안 synced가 와도 겹쳐 시작하지 않아요', async () => {
  let resolveLoad!: (module: { startInboxCheck: typeof start }) => void;
  let resolveStart!: () => void;
  load.mockReturnValueOnce(new Promise((resolve) => (resolveLoad = resolve)));
  start.mockReturnValueOnce(new Promise<void>((resolve) => (resolveStart = resolve)));
  const { store } = mount();
  await act(async () => {
    store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
    store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
  });
  expect(load).toHaveBeenCalledOnce();
  await act(async () => resolveLoad({ startInboxCheck: start }));
  await act(async () => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
  expect(load).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
  await act(async () => resolveStart());
  await act(async () => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
  expect(load).toHaveBeenCalledOnce();
});

it.each([false, true])(
  '부트 플래그 %s에서 언마운트 뒤 받은 조각은 시작하지 않아요',
  async (bootFlag) => {
    flag.mockReturnValue(bootFlag);
    let resolveLoad!: (module: { startInboxCheck: typeof start }) => void;
    load.mockReturnValueOnce(new Promise((resolve) => (resolveLoad = resolve)));
    const { store, unmount } = mount();
    await act(async () => {
      if (!bootFlag) store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
    });
    unmount();
    await act(async () => resolveLoad({ startInboxCheck: start }));
    act(() => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
    expect(load).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  },
);

it('conflict로 처음 끝나도 실행기를 한 번 시작해요', async () => {
  const { store } = mount();
  act(() => store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'conflict' }));
  await waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(load).toHaveBeenCalledOnce();
});
