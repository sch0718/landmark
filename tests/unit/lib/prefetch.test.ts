import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchWhenIdle, resetPrefetchForTest, type IdleScheduler } from 'src/lib/prefetch';

function setSaveData(value: boolean | undefined) {
  Object.defineProperty(navigator, 'connection', {
    value: value === undefined ? undefined : { saveData: value },
    configurable: true,
  });
}

beforeEach(() => {
  resetPrefetchForTest();
  setSaveData(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setSaveData(undefined);
});

describe('prefetchWhenIdle', () => {
  it('주입한 스케줄러가 부를 때만 load 함수들이 불린다', () => {
    const a = vi.fn(() => Promise.resolve());
    const b = vi.fn(() => Promise.resolve());
    let run: (() => void) | undefined;
    const schedule: IdleScheduler = (fn) => {
      run = fn;
    };
    prefetchWhenIdle([a, b], schedule);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    run?.();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('두 번 불러도 한 번만 한다', () => {
    const load = vi.fn(() => Promise.resolve());
    const schedule = vi.fn<IdleScheduler>((fn) => fn());
    prefetchWhenIdle([load], schedule);
    prefetchWhenIdle([load], schedule);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('saveData면 스케줄러 자체를 부르지 않는다', () => {
    setSaveData(true);
    const load = vi.fn(() => Promise.resolve());
    const schedule = vi.fn<IdleScheduler>((fn) => fn());
    prefetchWhenIdle([load], schedule);
    expect(schedule).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('load가 reject하거나 동기로 던져도 처리되지 않은 rejection이 없다', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const ok = vi.fn(() => Promise.resolve());
      prefetchWhenIdle(
        [
          () => Promise.reject(new Error('404')),
          () => {
            throw new Error('sync');
          },
          ok,
        ],
        (fn) => fn(),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(ok).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('기본 스케줄러는 requestIdleCallback이 있으면 그것을 쓴다', () => {
    const ric = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', ric);
    const load = vi.fn(() => Promise.resolve());
    prefetchWhenIdle([load]);
    expect(ric).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('requestIdleCallback이 없으면 setTimeout 2000ms로 미룬다', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const load = vi.fn(() => Promise.resolve());
    prefetchWhenIdle([load]);
    vi.advanceTimersByTime(1999);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
