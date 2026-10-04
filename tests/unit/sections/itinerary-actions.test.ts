import { describe, expect, it } from 'vitest';
import { hashDayStops } from 'src/domain/day-hash';
import { findDuplicateStopIds, overlay } from 'src/domain/overlay';
import {
  moveStop,
  removeStop,
  reorderStops,
  updateStop,
} from 'src/sections/itinerary/store/itinerary-actions';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';

const NOW = '2026-10-04T01:00:00.000Z';
const OLD = '2026-10-03T00:30:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';

const placeKeysOf = (stops: { placeKey: string }[]) => stops.map((s) => s.placeKey);

describe('moveStop', () => {
  it('같은 stop id로 도착일 끝에 한 번만, 두 DayEdit updatedAt이 같다', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'X'], [D2]: ['B'] } });
    const edit = makeEdit();
    const next = moveStop(trip, edit, sid('X'), D1, D2, NOW);
    const eff = overlay(trip, next);
    expect(eff.days[0]!.stops.map((s) => s.id)).toEqual([sid('A')]);
    expect(eff.days[1]!.stops.map((s) => s.id)).toEqual([sid('B'), sid('X')]);
    expect(eff.days.flatMap((d) => d.stops).filter((s) => s.id === sid('X'))).toHaveLength(1);
    expect(findDuplicateStopIds(eff.days)).toEqual([]);
    const d1 = next.days[D1]!;
    const d2 = next.days[D2]!;
    expect(d1.mode).toBe('override');
    expect(d2.mode).toBe('override');
    expect(d1.updatedAt).toBe(NOW);
    expect(d2.updatedAt).toBe(NOW);
    if (d1.mode === 'override') expect(d1.baseDayHash).toBe(hashDayStops(trip.days[0]!.stops));
    expect(edit.days).toEqual({});
  });

  it('time·note를 그대로 옮긴다', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'X'], [D2]: [] } });
    trip.days[0]!.stops[1] = { ...trip.days[0]!.stops[1]!, time: '10:00', note: '메모' };
    const next = moveStop(trip, makeEdit(), sid('X'), D1, D2, NOW);
    expect(overlay(trip, next).days[1]!.stops).toEqual([
      { id: sid('X'), placeKey: 'n:2', time: '10:00', note: '메모' },
    ]);
  });

  it('출발일에 없는 stop id면 오류', () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
    expect(() => moveStop(trip, makeEdit(), sid('B'), D1, D2, NOW)).toThrow();
  });
});

describe('removeStop', () => {
  it('id로 지정한 stop만 빼고 override로 기록한다(입력 불변)', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'A2'] } });
    const edit = makeEdit();
    const next = removeStop(trip, edit, D1, sid('A2'), NOW);
    const day = next.days[D1]!;
    if (day.mode !== 'override') throw new Error('override 아님');
    expect(day.stops.map((s) => s.id)).toEqual([sid('A'), sid('B')]);
    expect(day.updatedAt).toBe(NOW);
    expect(edit.days).toEqual({});
  });
});

describe('reorderStops', () => {
  it('stop id를 toIndex 자리로 옮긴다', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const next = reorderStops(trip, makeEdit(), D1, sid('A'), 2, NOW);
    expect(placeKeysOf(overlay(trip, next).days[0]!.stops)).toEqual(['n:2', 'n:3', 'n:1']);
    const back = reorderStops(trip, next, D1, sid('A'), 0, NOW);
    expect(placeKeysOf(overlay(trip, back).days[0]!.stops)).toEqual(['n:1', 'n:2', 'n:3']);
  });

  it('이미 override인 날은 그 stops에 적용한다', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [
            { id: sid('C'), placeKey: 'n:3' },
            { id: sid('A'), placeKey: 'n:1' },
          ],
          baseDayHash: 'h',
          updatedAt: OLD,
        },
      },
    });
    const next = reorderStops(trip, edit, D1, sid('C'), 1, NOW);
    const day = next.days[D1]!;
    if (day.mode !== 'override') throw new Error('override 아님');
    expect(day.stops.map((s) => s.id)).toEqual([sid('A'), sid('C')]);
    expect(day.baseDayHash).toBe('h');
    expect(day.updatedAt).toBe(NOW);
  });
});

describe('updateStop', () => {
  it('time·note를 바꾸고 null이면 필드를 지운다', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B'] } });
    const a = updateStop(trip, makeEdit(), D1, sid('B'), { time: '09:30', note: '예약' }, NOW);
    expect(overlay(trip, a).days[0]!.stops[1]).toEqual({
      id: sid('B'),
      placeKey: 'n:2',
      time: '09:30',
      note: '예약',
    });
    const b = updateStop(trip, a, D1, sid('B'), { time: null }, NOW);
    expect(overlay(trip, b).days[0]!.stops[1]).toEqual({
      id: sid('B'),
      placeKey: 'n:2',
      note: '예약',
    });
    const c = updateStop(trip, b, D1, sid('B'), { note: null }, NOW);
    expect(overlay(trip, c).days[0]!.stops[1]).toEqual({ id: sid('B'), placeKey: 'n:2' });
  });
});
