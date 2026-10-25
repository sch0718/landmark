import { useEffect, useEffectEvent, useRef, useState } from 'react';

type Options = { enabled: boolean; tick: () => Promise<'ok' | 'error'> };

export function useOnlinePoll({ enabled, tick }: Options): {
  lastOkAt: number | null;
  failing: boolean;
} {
  const [status, setStatus] = useState<{ lastOkAt: number | null; failing: boolean }>({
    lastOkAt: null,
    failing: false,
  });
  const inFlight = useRef(false);
  const runTick = useEffectEvent(tick);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const ready = () =>
      active && enabled && document.visibilityState === 'visible' && navigator.onLine;
    const delay = () => (failures < 2 ? 10_000 : failures === 2 ? 30_000 : 60_000);
    function clear() {
      clearTimeout(timer);
      timer = undefined;
    }
    function schedule() {
      clear();
      if (ready())
        timer = setTimeout(() => {
          void run();
        }, delay());
    }
    async function run() {
      clear();
      if (!ready()) return;
      if (inFlight.current) {
        schedule();
        return;
      }
      inFlight.current = true;
      let outcome: 'ok' | 'error';
      try {
        outcome = await runTick();
      } catch {
        outcome = 'error';
      } finally {
        inFlight.current = false;
      }
      // 이전 활성 구간의 늦은 응답은 현재 화면 상태를 덮지 않는다.
      if (!active) return;
      failures = outcome === 'ok' ? 0 : failures + 1;
      setStatus((previous) => ({
        lastOkAt: outcome === 'ok' ? Date.now() : previous.lastOkAt,
        failing: outcome === 'error',
      }));
      schedule();
    }
    function wake() {
      clear();
      if (ready()) void run();
    }
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', wake);
    schedule();
    return () => {
      active = false;
      clear();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', wake);
    };
  }, [enabled]);

  return status;
}
