import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnlinePoll } from 'src/sections/meetings/use-online-poll';

const advance = async (ms: number) => {
  await act(() => vi.advanceTimersByTimeAsync(ms));
};
function visibility(value: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}
function network(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => window.dispatchEvent(new Event(online ? 'online' : 'offline')));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('온라인 약속 확인 주기', () => {
  it('보이는 온라인 화면에서 10초마다 확인하고 마지막 성공 시각을 준다', async () => {
    const tick = vi.fn(async () => 'ok' as const);
    const { result } = renderHook(() => useOnlinePoll({ enabled: true, tick }));
    expect(result.current).toEqual({ lastOkAt: null, failing: false });
    await advance(9_999);
    expect(tick).not.toHaveBeenCalled();
    await advance(1);
    expect(result.current).toEqual({ lastOkAt: 10_000, failing: false });
    await advance(10_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('숨기면 멈추고 보이면 즉시 확인한다', async () => {
    const tick = vi.fn(async () => 'ok' as const);
    renderHook(() => useOnlinePoll({ enabled: true, tick }));
    visibility('hidden');
    await advance(60_000);
    expect(tick).not.toHaveBeenCalled();
    visibility('visible');
    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('오프라인이면 멈추고 online에 즉시 확인한다', async () => {
    network(false);
    const tick = vi.fn(async () => 'ok' as const);
    renderHook(() => useOnlinePoll({ enabled: true, tick }));
    await advance(60_000);
    expect(tick).not.toHaveBeenCalled();
    network(true);
    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
    network(false);
    await advance(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('숨긴 화면의 online 이벤트도 확인하지 않는다', async () => {
    visibility('hidden');
    const tick = vi.fn(async () => 'ok' as const);
    renderHook(() => useOnlinePoll({ enabled: true, tick }));
    network(true);
    await advance(60_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it('연속 실패 뒤 간격이 10·30·60초로 늘고 성공하면 10초로 돌아온다', async () => {
    const tick = vi
      .fn<() => Promise<'ok' | 'error'>>()
      .mockResolvedValueOnce('error')
      .mockResolvedValueOnce('error')
      .mockResolvedValueOnce('error')
      .mockResolvedValue('ok');
    const { result } = renderHook(() => useOnlinePoll({ enabled: true, tick }));
    await advance(10_000);
    expect(result.current).toEqual({ lastOkAt: null, failing: true });
    await advance(9_999);
    expect(tick).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(tick).toHaveBeenCalledTimes(2);
    await advance(29_999);
    expect(tick).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(tick).toHaveBeenCalledTimes(3);
    await advance(59_999);
    expect(tick).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(result.current).toEqual({ lastOkAt: 110_000, failing: false });
    await advance(10_000);
    expect(tick).toHaveBeenCalledTimes(5);
  });

  it('실패해도 마지막 성공 시각을 보존한다', async () => {
    const tick = vi
      .fn<() => Promise<'ok' | 'error'>>()
      .mockResolvedValueOnce('ok')
      .mockResolvedValue('error');
    const { result } = renderHook(() => useOnlinePoll({ enabled: true, tick }));
    await advance(20_000);
    expect(result.current).toEqual({ lastOkAt: 10_000, failing: true });
  });

  it('tickの例外も失敗として扱い再確認を続ける', async () => {
    const tick = vi
      .fn<() => Promise<'ok' | 'error'>>()
      .mockRejectedValueOnce(new Error('실패'))
      .mockResolvedValue('ok');
    const { result } = renderHook(() => useOnlinePoll({ enabled: true, tick }));
    await advance(10_000);
    expect(result.current.failing).toBe(true);
    await advance(10_000);
    expect(result.current).toEqual({ lastOkAt: 20_000, failing: false });
  });

  it('실행 중에는 타이머·복귀 이벤트가 겹쳐도 호출하지 않는다', async () => {
    let finish!: (value: 'ok') => void;
    const tick = vi.fn(
      () =>
        new Promise<'ok'>((resolve) => {
          finish = resolve;
        }),
    );
    renderHook(() => useOnlinePoll({ enabled: true, tick }));
    await advance(10_000);
    visibility('hidden');
    visibility('visible');
    network(true);
    await advance(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
    await act(async () => finish('ok'));
    await advance(10_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('비활성 중에는 멈추고 활성화하면 10초 간격으로 돌아온다', async () => {
    const tick = vi.fn(async () => 'ok' as const);
    const { rerender } = renderHook(({ enabled }) => useOnlinePoll({ enabled, tick }), {
      initialProps: { enabled: false },
    });
    visibility('visible');
    network(true);
    await advance(60_000);
    expect(tick).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await advance(10_000);
    expect(tick).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    await advance(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('tick이 바뀌어도 10초 대기를 다시 시작하지 않고 최신 함수를 쓴다', async () => {
    const first = vi.fn(async () => 'ok' as const);
    const latest = vi.fn(async () => 'ok' as const);
    const { rerender } = renderHook(({ tick }) => useOnlinePoll({ enabled: true, tick }), {
      initialProps: { tick: first },
    });
    await advance(9_000);
    rerender({ tick: latest });
    await advance(1_000);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('비활성화 후 다시 활성화해도 실행 중인 호출과 겹치지 않는다', async () => {
    let finish!: (value: 'ok') => void;
    const tick = vi.fn(
      () =>
        new Promise<'ok'>((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ enabled }) => useOnlinePoll({ enabled, tick }), {
      initialProps: { enabled: true },
    });
    await advance(10_000);
    rerender({ enabled: false });
    rerender({ enabled: true });
    await advance(10_000);
    expect(tick).toHaveBeenCalledTimes(1);
    await act(async () => finish('ok'));
    expect(result.current.lastOkAt).toBeNull();
    await advance(10_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('언마운트하면 타이머·이벤트·늦은 완료를 정리한다', async () => {
    const tick = vi.fn(async () => 'ok' as const);
    const { unmount } = renderHook(() => useOnlinePoll({ enabled: true, tick }));
    unmount();
    visibility('visible');
    network(true);
    await advance(60_000);
    expect(tick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
