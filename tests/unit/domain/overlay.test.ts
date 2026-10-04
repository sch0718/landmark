import { describe, expect, it } from 'vitest';
import { hashDayStops } from 'src/domain/day-hash';
import { ensureOverride, findDuplicateStopIds, overlay } from 'src/domain/overlay';
import type { Stop } from 'src/schema/trip-data';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';

const NOW = '2026-10-03T01:00:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';
const D3 = '2026-11-16';
const ids = (stops: Stop[]) => stops.map((s) => s.id);

describe('hashDayStops', () => {
  it('16자리 소문자 hex이고 결정적이다', () => {
    const stops = makeTrip({ days: { [D1]: ['X', 'Y'] } }).days[0]!.stops;
    expect(hashDayStops(stops)).toMatch(/^[0-9a-f]{16}$/);
    expect(hashDayStops(stops)).toBe(hashDayStops([...stops]));
  });

  it('고정 값(FNV-1a 64)을 낸다', () => {
    expect(hashDayStops([])).toBe('09612b07b5ecb5a5'); // fnv1a64("[]"), 파이썬으로 따로 계산
  });

  it('time/note 변화와 순서 변화를 반영한다', () => {
    const [x, y] = makeTrip({ days: { [D1]: ['X', 'Y'] } }).days[0]!.stops as [Stop, Stop];
    const base = hashDayStops([x, y]);
    expect(hashDayStops([y, x])).not.toBe(base);
    expect(hashDayStops([{ ...x, note: 'a' }, y])).not.toBe(base);
    expect(hashDayStops([{ ...x, time: '10:00' }, y])).not.toBe(base);
  });
});

describe('overlay', () => {
  const trip = makeTrip({ days: { [D1]: [], [D2]: ['X'] } });

  it('edit=null이면 원본 그대로', () => {
    const eff = overlay(trip, null);
    expect(eff.days.map((d) => [d.date, d.source, d.unresolved])).toEqual([
      [D1, 'base', false],
      [D2, 'base', false],
    ]);
    expect(ids(eff.days[1]!.stops)).toEqual([sid('X')]);
    expect(eff.hiddenEditDates).toEqual([]);
  });

  it('override 날은 override stops, reset 날은 원본', () => {
    const t = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [{ id: sid('Q'), placeKey: 'n:1' }],
          baseDayHash: hashDayStops(t.days[0]!.stops),
          updatedAt: NOW,
        },
        [D2]: { mode: 'reset', updatedAt: NOW },
      },
    });
    const eff = overlay(t, edit);
    expect(eff.days[0]).toMatchObject({ source: 'override', unresolved: false });
    expect(ids(eff.days[0]!.stops)).toEqual([sid('Q')]);
    expect(eff.days[1]).toMatchObject({ source: 'base', unresolved: false });
    expect(ids(eff.days[1]!.stops)).toEqual([sid('B')]);
  });

  it('baseDayHash가 다르면 unresolved', () => {
    const edit = makeEdit({
      days: { [D2]: { mode: 'override', stops: [], baseDayHash: 'deadbeef', updatedAt: NOW } },
    });
    expect(overlay(trip, edit).days[1]!.unresolved).toBe(true);
  });

  it('배치 규칙: override의 방문이 원본을 따르는 날에서 빠진다', () => {
    const xv = trip.days[1]!.stops[0]!;
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [{ ...xv, note: '메모' }],
          baseDayHash: hashDayStops(trip.days[0]!.stops),
          updatedAt: NOW,
        },
      },
    });
    const eff = overlay(trip, edit);
    expect(eff.days[0]!.stops).toEqual([{ ...xv, note: '메모' }]);
    expect(eff.days[1]!.stops).toEqual([]);
    expect(eff.days[1]!.removedByPlacement).toEqual([sid('X')]);
    expect(eff.days[0]!.removedByPlacement).toEqual([]);
    expect(findDuplicateStopIds(eff.days)).toEqual([]);
  });

  it('원본에 없는 날짜의 DayEdit은 hiddenEditDates', () => {
    const edit = makeEdit({ days: { [D3]: { mode: 'reset', updatedAt: NOW } } });
    const eff = overlay(trip, edit);
    expect(eff.hiddenEditDates).toEqual([D3]);
    expect(eff.days.map((d) => d.date)).toEqual([D1, D2]);
  });

  it('같은 장소를 여러 번 방문해도 stop 3개 유지', () => {
    const t = makeTrip({ days: { [D1]: ['H', 'A', 'H2'] } });
    const eff = overlay(t, null);
    expect(eff.days[0]!.stops).toHaveLength(3);
    expect(findDuplicateStopIds(eff.days)).toEqual([]);
  });
});

describe('findDuplicateStopIds', () => {
  it('중복 id를 한 번씩 돌려준다', () => {
    const s = (id: string): Stop => ({ id, placeKey: 'n:1' });
    expect(
      findDuplicateStopIds([{ stops: [s('a000'), s('b000')] }, { stops: [s('a000'), s('a000')] }]),
    ).toEqual(['a000']);
  });
});

describe('ensureOverride', () => {
  const t = makeTrip({ days: { [D1]: ['C'], [D2]: ['A', 'X', 'B'] } });
  const xv = t.days[1]!.stops[1]!;
  const edit0 = makeEdit({
    days: {
      [D1]: {
        mode: 'override',
        stops: [xv],
        baseDayHash: hashDayStops(t.days[0]!.stops),
        updatedAt: NOW,
      },
    },
  });

  it('이미 override면 그대로 반환', () => {
    expect(ensureOverride(t, edit0, D1, NOW)).toBe(edit0);
  });

  it('줄어든 날에서 현재 실효 stops로 시작하고 원본 해시를 기록', () => {
    const before = structuredClone(edit0);
    const next = ensureOverride(t, edit0, D2, NOW);
    expect(edit0).toEqual(before);
    expect(next).not.toBe(edit0);
    const day = next.days[D2]!;
    if (day.mode !== 'override') throw new Error('override 아님');
    expect(ids(day.stops)).toEqual([sid('A'), sid('B')]);
    expect(day.baseDayHash).toBe(hashDayStops(t.days[1]!.stops));
    expect(day.updatedAt).toBe(NOW);
  });

  it('이어서 장소를 추가해도 X는 한 번뿐', () => {
    const next = ensureOverride(t, edit0, D2, NOW);
    const day = next.days[D2]!;
    if (day.mode !== 'override') throw new Error('override 아님');
    const added = {
      ...next,
      days: {
        ...next.days,
        [D2]: { ...day, stops: [...day.stops, { id: sid('P'), placeKey: 'n:1' }] },
      },
    };
    const all = overlay(t, added).days.flatMap((d) => ids(d.stops));
    expect(all.filter((i) => i === sid('X'))).toHaveLength(1);
  });

  it('reset 날에서도 원본 stops로 시작', () => {
    const e = makeEdit({ days: { [D2]: { mode: 'reset', updatedAt: NOW } } });
    const day = ensureOverride(t, e, D2, NOW).days[D2]!;
    if (day.mode !== 'override') throw new Error('override 아님');
    expect(ids(day.stops)).toEqual([sid('A'), sid('X'), sid('B')]);
  });
});
