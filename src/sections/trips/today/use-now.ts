import { useEffect, useState } from 'react';

/** 당일 모드가 시각을 다시 읽는 간격(ms). */
export const NOW_TICK_MS = 30_000;

/**
 * 지금 시각. `tickMs`마다, 그리고 화면이 다시 보일 때(`visibilitychange` → `visible`) 새 `Date`가 된다.
 * 다른 앱(네이버 지도 등)에 다녀오면 틱을 기다리지 않고 바로 맞춘다(스펙 §4.1).
 */
export function useNow(tickMs: number = NOW_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, tickMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tickMs]);
  return now;
}
