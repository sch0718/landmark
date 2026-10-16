import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW_TICK_MS, useNow } from 'src/sections/trips/today/use-now';

let visibility: DocumentVisibilityState = 'visible';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 24, 10, 0));
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

describe('useNow', () => {
  it('30초마다 새 시각', () => {
    expect(NOW_TICK_MS).toBe(30_000);
    const { result } = renderHook(() => useNow());
    const first = result.current;
    expect(first.getTime()).toBe(new Date(2026, 9, 24, 10, 0).getTime());
    act(() => vi.advanceTimersByTime(29_999));
    expect(result.current).toBe(first);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.getTime()).toBe(new Date(2026, 9, 24, 10, 0, 30).getTime());
  });

  it('화면이 다시 보이면 틱을 기다리지 않고 새 시각, 숨을 때는 그대로', () => {
    const { result } = renderHook(() => useNow());
    const first = result.current;
    vi.setSystemTime(new Date(2026, 9, 24, 10, 20));
    setVisibility('hidden');
    expect(result.current).toBe(first);
    setVisibility('visible');
    expect(result.current.getTime()).toBe(new Date(2026, 9, 24, 10, 20).getTime());
  });

  it('언마운트하면 틱과 이벤트를 놓는다', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useNow());
    unmount();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
