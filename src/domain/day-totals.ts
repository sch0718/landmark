import type { DisplayLeg } from 'src/domain/leg-index';

export type DayTotals = {
  durationMs: number;
  roadDistanceM: number;
  tollFare: number;
  /** routed가 아닌(failed·unrouted) 구간 수. */
  uncomputedCount: number;
  straightDistanceM: number;
};

/** routed만 시간·도로거리·통행료에 더한다. 알 수 없는 값을 0으로 더하지 않고 개수와 직선거리로 따로 센다. */
export function dayTotals(legs: DisplayLeg[]): DayTotals {
  const totals: DayTotals = {
    durationMs: 0,
    roadDistanceM: 0,
    tollFare: 0,
    uncomputedCount: 0,
    straightDistanceM: 0,
  };
  for (const leg of legs) {
    if (leg.status === 'routed') {
      totals.durationMs += leg.durationMs ?? 0;
      totals.roadDistanceM += leg.distanceM;
      totals.tollFare += leg.tollFare ?? 0;
    } else {
      totals.uncomputedCount += 1;
      totals.straightDistanceM += leg.distanceM;
    }
  }
  return totals;
}
