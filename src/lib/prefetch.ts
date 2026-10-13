/** 한가할 때 `run`을 부르도록 예약하는 함수. 테스트에서 바꿔 끼운다. */
export type IdleScheduler = (run: () => void) => void;

const FALLBACK_DELAY_MS = 2000;

const defaultScheduler: IdleScheduler = (run) => {
  if (typeof requestIdleCallback === 'function') {
    // 시한(timeout)을 주지 않는다: 한가할 때만 받고, 바쁜 페이지에서는 강제로 받지 않는다.
    requestIdleCallback(() => run());
  } else {
    setTimeout(run, FALLBACK_DELAY_MS);
  }
};

let started = false;

function saveDataOn(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * 첫 화면을 그린 뒤 브라우저가 한가할 때 나눠 받는 단위들을 미리 받는다(결과는 버린다).
 * 한 번만 하고, 실패는 무시하며, 데이터 절약 모드면 하지 않는다. 예약 전에는 어떤 load도 부르지 않는다.
 */
export function prefetchWhenIdle(
  loads: readonly (() => Promise<unknown>)[],
  schedule: IdleScheduler = defaultScheduler,
): void {
  if (started || saveDataOn()) return;
  started = true;
  schedule(() => {
    for (const load of loads) {
      try {
        load().catch(() => {});
      } catch {
        // 동기로 던져도 미리 받기는 조용히 넘어간다.
      }
    }
  });
}

export function resetPrefetchForTest(): void {
  started = false;
}
