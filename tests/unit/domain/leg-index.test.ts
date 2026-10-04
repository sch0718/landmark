import { describe, expect, it } from 'vitest';
import { buildLegIndex, effectiveLegs } from 'src/domain/leg-index';
import { overlay } from 'src/domain/overlay';
import type { EffectiveDay } from 'src/domain/overlay';
import type { EditLayer } from 'src/schema/edit-layer';
import type { Stop, TripData } from 'src/schema/trip-data';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';

const D1 = '2026-11-14';
const D2 = '2026-11-15';

const stopOf = (trip: TripData, symbol: string): Stop => {
  for (const day of trip.days) {
    const found = day.stops.find((s) => s.id === sid(symbol));
    if (found) return found;
  }
  throw new Error(symbol);
};

const overrideEdit = (trip: TripData, date: string, symbols: string[]): EditLayer =>
  makeEdit({
    days: {
      [date]: {
        mode: 'override',
        stops: symbols.map((s) => ({ id: sid(s), placeKey: stopOf(trip, s).placeKey })),
        baseDayHash: 'deadbeef',
        updatedAt: '2026-10-03T01:00:00.000Z',
      },
    },
  });

const dayOf = (trip: TripData, edit: EditLayer | null, date: string): EffectiveDay =>
  overlay(trip, edit).days.find((d) => d.date === date)!;

describe('buildLegIndex', () => {
  it('routed만 from→to 키로 색인한다', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const second = trip.days[0]!.legs[1]!;
    trip.days[0]!.legs[1] = {
      ...second,
      status: 'failed',
      distanceM: 0,
      durationMs: null,
      staticDurationMs: null,
      tollFare: null,
      path: [],
      queriedAt: null,
    };
    const index = buildLegIndex(trip);
    const a = stopOf(trip, 'A').placeKey;
    const b = stopOf(trip, 'B').placeKey;
    const c = stopOf(trip, 'C').placeKey;
    expect(index.has(`${a}→${b}`)).toBe(true);
    expect(index.has(`${b}→${c}`)).toBe(false);
    expect(index.has(`${b}→${a}`)).toBe(false);
  });
});

describe('effectiveLegs', () => {
  it('원본 그대로인 날은 실패 구간 포함 원본 legs를 쓴다', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const second = trip.days[0]!.legs[1]!;
    trip.days[0]!.legs[1] = {
      ...second,
      status: 'failed',
      distanceM: 1234,
      distanceKind: 'straight',
      durationMs: null,
      staticDurationMs: null,
      tollFare: null,
      queriedAt: null,
    };
    const legs = effectiveLegs(dayOf(trip, null, D1), trip, buildLegIndex(trip));
    expect(legs).toHaveLength(2);
    expect(legs[1]!.status).toBe('failed');
    expect(legs[1]!.distanceM).toBe(1234);
  });

  it('A→C→B override: 원본에 없는 쌍은 unrouted, 다른 날에 있는 쌍은 재사용', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'], [D2]: ['B', 'A'] } });
    const edit = overrideEdit(trip, D1, ['A', 'C', 'B']);
    const legs = effectiveLegs(dayOf(trip, edit, D1), trip, buildLegIndex(trip));
    expect(legs.map((l) => l.status)).toEqual(['unrouted', 'unrouted']);
    expect(legs[0]).toMatchObject({
      fromStopId: sid('A'),
      toStopId: sid('C'),
      distanceKind: 'straight',
      durationMs: null,
      staticDurationMs: null,
      tollFare: null,
      queriedAt: null,
    });
    expect(legs[0]!.path).toHaveLength(2);
    expect(legs[0]!.distanceM).toBeGreaterThan(0);
    expect(Number.isInteger(legs[0]!.distanceM)).toBe(true);

    const edit2 = overrideEdit(trip, D1, ['B', 'A']);
    const legs2 = effectiveLegs(dayOf(trip, edit2, D1), trip, buildLegIndex(trip));
    expect(legs2).toHaveLength(1);
    expect(legs2[0]).toMatchObject({
      status: 'routed',
      distanceKind: 'road',
      fromStopId: sid('B'),
      toStopId: sid('A'),
    });
  });

  it('반복 방문 H→A→H: stop id가 각 방문과 일치한다', () => {
    const trip = makeTrip({ days: { [D1]: ['H', 'A', 'H2'] } });
    const edit = overrideEdit(trip, D1, ['H', 'A', 'H2']);
    const legs = effectiveLegs(dayOf(trip, edit, D1), trip, buildLegIndex(trip));
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => [l.fromStopId, l.toStopId])).toEqual([
      [sid('H'), sid('A')],
      [sid('A'), sid('H2')],
    ]);
  });

  it('재사용 시 같은 장소의 다른 방문 id로 바꿔 끼운다', () => {
    const trip = makeTrip({ days: { [D1]: ['H', 'A'], [D2]: ['B', 'H2'] } });
    const edit = overrideEdit(trip, D2, ['H2', 'A']);
    const legs = effectiveLegs(dayOf(trip, edit, D2), trip, buildLegIndex(trip));
    expect(legs[0]).toMatchObject({ status: 'routed', fromStopId: sid('H2'), toStopId: sid('A') });
  });

  it('배치 규칙으로 줄어든 원본 날은 연속 쌍으로 다시 만든다', () => {
    const trip = makeTrip({ days: { [D1]: ['Q'], [D2]: ['A', 'X', 'B'] } });
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [{ id: sid('X'), placeKey: stopOf(trip, 'X').placeKey }],
          baseDayHash: 'deadbeef',
          updatedAt: '2026-10-03T01:00:00.000Z',
        },
      },
    });
    const day = dayOf(trip, edit, D2);
    expect(day.removedByPlacement).toEqual([sid('X')]);
    const legs = effectiveLegs(day, trip, buildLegIndex(trip));
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ status: 'unrouted', fromStopId: sid('A'), toStopId: sid('B') });
  });

  it('stop이 0개·1개인 날은 빈 배열', () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: [] } });
    const index = buildLegIndex(trip);
    expect(effectiveLegs(dayOf(trip, null, D1), trip, index)).toEqual([]);
    expect(effectiveLegs(dayOf(trip, null, D2), trip, index)).toEqual([]);
    const edit = overrideEdit(trip, D1, ['A']);
    expect(effectiveLegs(dayOf(trip, edit, D1), trip, index)).toEqual([]);
  });

  it('trip.places에 없는 장소가 낀 쌍은 던지지 않고 구간을 빼며, 나머지 쌍은 그대로 만든다', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [
            { id: sid('A'), placeKey: 'n:1' },
            { id: 'zzzz', placeKey: 'n:999' },
            { id: sid('B'), placeKey: 'n:2' },
            { id: sid('C'), placeKey: 'n:3' },
          ],
          baseDayHash: 'deadbeef',
          updatedAt: '2026-10-03T01:00:00.000Z',
        },
      },
    });
    const day = dayOf(trip, edit, D1);
    expect(day.stops.map((s) => s.placeKey)).toContain('n:999');
    const legs = effectiveLegs(day, trip, buildLegIndex(trip));
    expect(legs.map((l) => [l.fromStopId, l.toStopId])).toEqual([[sid('B'), sid('C')]]);
    expect(legs[0]!.status).toBe('routed');
  });
});
