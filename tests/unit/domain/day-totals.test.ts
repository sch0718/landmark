import { describe, expect, it } from 'vitest';
import { dayTotals } from 'src/domain/day-totals';
import type { DisplayLeg } from 'src/domain/leg-index';

const leg = (over: Partial<DisplayLeg>): DisplayLeg => ({
  fromStopId: 'a000',
  toStopId: 'b000',
  fromPlaceKey: 'n:1',
  toPlaceKey: 'n:2',
  status: 'routed',
  distanceM: 0,
  distanceKind: 'road',
  durationMs: null,
  staticDurationMs: null,
  tollFare: null,
  path: [],
  queriedAt: null,
  ...over,
});

describe('dayTotals', () => {
  it('routed만 시간·도로거리·통행료에 더하고 unrouted는 개수와 직선거리에만 센다', () => {
    const totals = dayTotals([
      leg({ distanceM: 10000, durationMs: 3600000, tollFare: 1000 }),
      leg({ status: 'unrouted', distanceKind: 'straight', distanceM: 3200 }),
    ]);
    expect(totals).toEqual({
      durationMs: 3600000,
      roadDistanceM: 10000,
      tollFare: 1000,
      uncomputedCount: 1,
      straightDistanceM: 3200,
    });
  });

  it('failed도 미계산으로 센다', () => {
    const totals = dayTotals([leg({ status: 'failed', distanceKind: 'straight', distanceM: 500 })]);
    expect(totals).toEqual({
      durationMs: 0,
      roadDistanceM: 0,
      tollFare: 0,
      uncomputedCount: 1,
      straightDistanceM: 500,
    });
  });

  it('빈 배열은 모두 0', () => {
    expect(dayTotals([])).toEqual({
      durationMs: 0,
      roadDistanceM: 0,
      tollFare: 0,
      uncomputedCount: 0,
      straightDistanceM: 0,
    });
  });
});
