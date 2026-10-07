import { describe, expect, it } from 'vitest';
import { hashDayStops } from 'src/domain/day-hash';
import { pickLww } from 'src/domain/lww';
import { applyMerge, planMerge } from 'src/domain/merge';
import { findDuplicateStopIds, overlay } from 'src/domain/overlay';
import { LIMITS } from 'src/schema/common';
import type { DayEdit, EditLayer } from 'src/schema/edit-layer';
import type { Stop, TripData } from 'src/schema/trip-data';
import { makeEdit, makeTrip, sid, withBulkyMemos } from '../../fixtures/builders';

const T1 = '2026-10-03T00:10:00.000Z';
const T2 = '2026-10-03T00:20:00.000Z';
const T3 = '2026-10-03T00:30:00.000Z';
const NOW = '2026-10-03T01:00:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';
const D3 = '2026-11-16';

const baseStops = (trip: TripData, date: string): Stop[] =>
  trip.days.find((d) => d.date === date)!.stops;

const stopOf = (trip: TripData, symbol: string): Stop =>
  trip.days.flatMap((d) => d.stops).find((s) => s.id === sid(symbol))!;

const override = (trip: TripData, date: string, stops: Stop[], updatedAt: string): DayEdit => ({
  mode: 'override',
  stops,
  baseDayHash: hashDayStops(baseStops(trip, date)),
  updatedAt,
});

/** 실효 일정에서 stop id가 놓인 날짜들. */
const datesOf = (trip: TripData, edit: EditLayer, symbol: string): string[] =>
  overlay(trip, edit)
    .days.filter((d) => d.stops.some((s) => s.id === sid(symbol)))
    .map((d) => d.date);

const mustMerge = (
  local: EditLayer,
  incoming: EditLayer,
  trip: TripData,
  choices: Record<string, 'local' | 'incoming'> = {},
): EditLayer => {
  const r = applyMerge(local, incoming, trip, choices, NOW);
  if (!r.ok) throw new Error(r.reason);
  return r.edit;
};

const content = (e: EditLayer) => ({ authors: e.authors, places: e.places, days: e.days });

const withAuthors = (ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { nickname: id, updatedAt: T1 }]));

/** 원본 D1=[X], D2=[Y]; A(local): X를 D2로 옮김; B(incoming, 나중): D2의 Y note 수정. */
function moveScenario() {
  const trip = makeTrip({ days: { [D1]: ['X'], [D2]: ['Y'] } });
  const x = stopOf(trip, 'X');
  const y = stopOf(trip, 'Y');
  const a = makeEdit({
    authorId: 'a-a',
    days: { [D1]: override(trip, D1, [], T1), [D2]: override(trip, D2, [y, x], T1) },
  });
  const b = makeEdit({
    authorId: 'a-b',
    days: { [D2]: override(trip, D2, [{ ...y, note: 'Y 메모' }], T2) },
  });
  return { trip, a, b, x, y };
}

describe('applyMerge 크기 제한(§5.3 6단계)', () => {
  const fileBytes = (e: EditLayer) => new TextEncoder().encode(JSON.stringify(e, null, 2)).length;

  it('각각 1MB 미만인 두 레이어라도 합친 결과가 1MB를 넘으면 거부한다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'] } });
    const local = withBulkyMemos(makeEdit(), 1001, 90);
    const incoming = withBulkyMemos(
      makeEdit({ authorId: 'a-friend', authors: withAuthors(['a-friend']) }),
      2001,
      90,
    );
    expect(fileBytes(local)).toBeLessThan(LIMITS.fileBytes);
    expect(fileBytes(incoming)).toBeLessThan(LIMITS.fileBytes);

    const result = applyMerge(local, incoming, trip, {}, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('병합 결과가 1MB를 넘어 저장할 수 없어요');
  });
});

describe('pickLww', () => {
  it('updatedAt이 큰 쪽, 같으면 JSON 사전순 큰 쪽을 택한다', () => {
    const p = { v: 'a', updatedAt: T1 };
    const q = { v: 'b', updatedAt: T1 };
    const r = { v: 'a', updatedAt: T2 };
    expect(pickLww(p, r)).toBe(r);
    expect(pickLww(r, p)).toBe(r);
    expect(pickLww(p, q)).toBe(q);
    expect(pickLww(q, p)).toBe(q);
    expect(pickLww(undefined, p)).toBe(p);
    expect(pickLww(p, undefined)).toBe(p);
    expect(pickLww(undefined, undefined)).toBeUndefined();
  });
});

describe('merge', () => {
  it('멱등: 병합 결과에 같은 incoming을 다시 병합해도 같다', () => {
    const { trip, a, b } = moveScenario();
    const local: EditLayer = {
      ...a,
      authors: { ...a.authors, 'a-b': { nickname: '옛 닉', updatedAt: T1 } },
      places: { 'n:1': { memos: { 'a-a': { text: '메모', updatedAt: T1 } } } },
    };
    const incoming: EditLayer = {
      ...b,
      places: {
        'n:1': {
          memos: { 'a-b': { text: '동행 메모', updatedAt: T2 } },
          tags: { value: ['맛집'], updatedAt: T2 },
          category: { value: '숙소', updatedAt: T2 },
        },
      },
    };
    for (const choice of ['local', 'incoming'] as const) {
      const m = mustMerge(local, incoming, trip, { [D1]: choice });
      expect(mustMerge(m, incoming, trip)).toEqual(m);
    }
    const m = mustMerge(local, incoming, trip);
    expect(mustMerge(m, incoming, trip)).toEqual(m);
  });

  it('교환: 충돌 기본값에서 merge(a,b)와 merge(b,a)의 병합 콘텐츠가 같다', () => {
    const { trip, a, b } = moveScenario();
    const ea: EditLayer = {
      ...a,
      places: {
        'n:1': {
          memos: { 'a-a': { text: 'A', updatedAt: T1 } },
          hidden: { value: true, updatedAt: T3 },
          category: { value: '숙소', updatedAt: T2 },
        },
      },
    };
    const eb: EditLayer = {
      ...b,
      places: {
        'n:1': {
          memos: { 'a-a': { text: 'A 수정', updatedAt: T2 }, 'a-b': { text: 'B', updatedAt: T1 } },
          tags: { value: ['t'], updatedAt: T1 },
          hidden: { value: false, updatedAt: T3 },
          category: { value: '공항', updatedAt: T2 },
        },
      },
    };
    const ab = mustMerge(ea, eb, trip);
    const ba = mustMerge(eb, ea, trip);
    expect(content(ab)).toEqual(content(ba));
    expect(ab.authorId).toBe('a-a');
    expect(ba.authorId).toBe('a-b');
  });

  it('메모 툼스톤(text: null, 더 최신)이 옛 메모를 이긴다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'] } });
    const local = makeEdit({
      places: { 'n:1': { memos: { 'a-local': { text: '옛 메모', updatedAt: T1 } } } },
    });
    const incoming = makeEdit({
      places: { 'n:1': { memos: { 'a-local': { text: null, updatedAt: T2 } } } },
    });
    expect(mustMerge(local, incoming, trip).places['n:1']!.memos['a-local']).toEqual({
      text: null,
      updatedAt: T2,
    });
    expect(mustMerge(incoming, local, trip).places['n:1']!.memos['a-local']).toEqual({
      text: null,
      updatedAt: T2,
    });
    expect(planMerge(local, incoming, trip).summary.memosDeleted).toBe(1);
  });

  it('같은 닉네임·다른 authorId의 메모는 둘 다 남는다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'] } });
    const local = makeEdit({
      authorId: 'a-1',
      authors: { 'a-1': { nickname: '민수', updatedAt: T1 } },
      places: { 'n:1': { memos: { 'a-1': { text: '하나', updatedAt: T1 } } } },
    });
    const incoming = makeEdit({
      authorId: 'a-2',
      authors: { 'a-2': { nickname: '민수', updatedAt: T1 } },
      places: { 'n:1': { memos: { 'a-2': { text: '둘', updatedAt: T1 } } } },
    });
    const m = mustMerge(local, incoming, trip);
    expect(Object.keys(m.authors).sort()).toEqual(['a-1', 'a-2']);
    expect(m.places['n:1']!.memos).toEqual({
      'a-1': { text: '하나', updatedAt: T1 },
      'a-2': { text: '둘', updatedAt: T1 },
    });
  });

  it('태그(A)와 숨김(B)을 서로 다른 사람이 바꾸면 필드별로 둘 다 유지된다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'] } });
    const a = makeEdit({
      places: {
        'n:1': {
          memos: {},
          tags: { value: ['카페'], updatedAt: T2 },
          hidden: { value: false, updatedAt: T1 },
        },
      },
    });
    const b = makeEdit({
      places: {
        'n:1': {
          memos: {},
          tags: { value: [], updatedAt: T1 },
          hidden: { value: true, updatedAt: T2 },
        },
      },
    });
    const m = mustMerge(a, b, trip);
    expect(m.places['n:1']!.tags).toEqual({ value: ['카페'], updatedAt: T2 });
    expect(m.places['n:1']!.hidden).toEqual({ value: true, updatedAt: T2 });
    const { summary } = planMerge(a, b, trip);
    expect(summary.tagChanges).toEqual([]);
    expect(summary.hiddenChanges).toEqual([{ placeKey: 'n:1', from: false, to: true }]);
  });

  it('분류(A)와 태그(B)를 서로 다른 사람이 바꾸면 필드별로 둘 다 유지된다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'] } });
    const a = makeEdit({
      places: { 'n:1': { memos: {}, category: { value: '숙소', updatedAt: T2 } } },
    });
    const b = makeEdit({
      places: { 'n:1': { memos: {}, tags: { value: ['맛집'], updatedAt: T1 } } },
    });
    const m = mustMerge(a, b, trip);
    expect(m.places['n:1']!.category).toEqual({ value: '숙소', updatedAt: T2 });
    expect(m.places['n:1']!.tags).toEqual({ value: ['맛집'], updatedAt: T1 });
  });

  it('더 최신의 원본으로 되돌림(value: null)이 옛 분류 덮어쓰기를 이긴다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'] } });
    const local = makeEdit({
      places: { 'n:1': { memos: {}, category: { value: '숙소', updatedAt: T1 } } },
    });
    const incoming = makeEdit({
      places: { 'n:1': { memos: {}, category: { value: null, updatedAt: T2 } } },
    });
    expect(mustMerge(local, incoming, trip).places['n:1']!.category).toEqual({
      value: null,
      updatedAt: T2,
    });
    expect(mustMerge(incoming, local, trip).places['n:1']!.category).toEqual({
      value: null,
      updatedAt: T2,
    });
    expect(planMerge(local, incoming, trip).summary.categoryChanges).toEqual([
      { placeKey: 'n:1', from: '숙소', to: null },
    ]);
  });

  it('분류 요약: incoming이 이기고 값이 다를 때만 넣는다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'] }, places: ['Y', 'Z'] });
    const local = makeEdit({
      places: {
        'n:2': { memos: {}, category: { value: '카페', updatedAt: T3 } },
        'n:3': { memos: {}, category: { value: '공항', updatedAt: T1 } },
      },
    });
    const incoming = makeEdit({
      places: {
        'n:1': { memos: {}, category: { value: '숙소', updatedAt: T1 } },
        'n:2': { memos: {}, category: { value: '식당', updatedAt: T2 } },
        'n:3': { memos: {}, category: { value: '공항', updatedAt: T2 } },
      },
    });
    expect(planMerge(local, incoming, trip).summary.categoryChanges).toEqual([
      { placeKey: 'n:1', from: undefined, to: '숙소' },
    ]);
  });

  it('reset(최신)이 옛 override 파일을 이긴다', () => {
    const trip = makeTrip({ days: { [D1]: ['X', 'Y'] } });
    const local = makeEdit({ days: { [D1]: { mode: 'reset', updatedAt: T2 } } });
    const incoming = makeEdit({ days: { [D1]: override(trip, D1, [stopOf(trip, 'Y')], T1) } });
    expect(planMerge(local, incoming, trip).conflicts).toEqual([
      { id: D1, dates: [D1], defaultSide: 'local', promoted: false },
    ]);
    expect(mustMerge(local, incoming, trip).days[D1]).toEqual({ mode: 'reset', updatedAt: T2 });
  });

  it('Day 충돌 감지: 같은 날을 양쪽이 다르게 고치면 충돌, 한쪽만 고친 날은 채택한다', () => {
    const trip = makeTrip({ days: { [D1]: ['X', 'Y'], [D2]: ['Z'] } });
    const local = makeEdit({
      days: { [D1]: override(trip, D1, [stopOf(trip, 'Y'), stopOf(trip, 'X')], T2) },
    });
    const incoming = makeEdit({
      days: {
        [D1]: override(trip, D1, [stopOf(trip, 'X')], T1),
        [D2]: { mode: 'reset', updatedAt: T1 },
      },
    });
    const plan = planMerge(local, incoming, trip);
    expect(plan.conflicts).toEqual([
      { id: D1, dates: [D1], defaultSide: 'local', promoted: false },
    ]);
    expect(plan.summary.daysAdopted).toEqual([D2]);
    const m = mustMerge(local, incoming, trip, { [D1]: 'incoming' });
    expect(m.days[D1]).toEqual({ ...incoming.days[D1], updatedAt: NOW });
    expect(m.days[D2]).toEqual(incoming.days[D2]);
  });

  it('날짜 간 이동: B가 D2를 고치면 {D1,D2}가 충돌이고 어느 쪽이든 X는 한 번', () => {
    const { trip, a, b } = moveScenario();
    expect(planMerge(a, b, trip).conflicts).toEqual([
      { id: D1, dates: [D1, D2], defaultSide: 'incoming', promoted: false },
    ]);
    const mLocal = mustMerge(a, b, trip, { [D1]: 'local' });
    expect(datesOf(trip, mLocal, 'X')).toEqual([D2]);
    expect(findDuplicateStopIds(overlay(trip, mLocal).days)).toEqual([]);
    const mIncoming = mustMerge(a, b, trip, { [D1]: 'incoming' });
    expect(datesOf(trip, mIncoming, 'X')).toEqual([D1]);
    expect(mIncoming.days[D1]).toBeUndefined();
    expect(findDuplicateStopIds(overlay(trip, mIncoming).days)).toEqual([]);
  });

  it('날짜 간 이동: B가 D1을 고쳐도 같은 묶음이고 어느 쪽이든 X는 한 번', () => {
    const { trip, a, x } = moveScenario();
    const b = makeEdit({
      authorId: 'a-b',
      days: { [D1]: override(trip, D1, [{ ...x, note: 'X 메모' }], T2) },
    });
    expect(planMerge(a, b, trip).conflicts).toEqual([
      { id: D1, dates: [D1, D2], defaultSide: 'incoming', promoted: false },
    ]);
    for (const [choice, where] of [
      ['local', [D2]],
      ['incoming', [D1]],
    ] as const) {
      const m = mustMerge(a, b, trip, { [D1]: choice });
      expect(datesOf(trip, m, 'X')).toEqual(where);
      expect(findDuplicateStopIds(overlay(trip, m).days)).toEqual([]);
    }
  });

  it('같은 방문을 다른 날로: {D1,D2,D3}가 승격 충돌이고 어느 선택이든 성공, X는 한 번', () => {
    const trip = makeTrip({ days: { [D1]: ['X'], [D2]: ['Y'], [D3]: ['Z'] } });
    const x = stopOf(trip, 'X');
    const a = makeEdit({
      days: {
        [D1]: override(trip, D1, [], T1),
        [D2]: override(trip, D2, [stopOf(trip, 'Y'), x], T1),
      },
    });
    const b = makeEdit({
      authorId: 'a-b',
      days: {
        [D1]: override(trip, D1, [], T1),
        [D3]: override(trip, D3, [stopOf(trip, 'Z'), x], T2),
      },
    });
    const { conflicts } = planMerge(a, b, trip);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      id: D1,
      dates: [D1, D2, D3],
      defaultSide: 'incoming',
      promoted: true,
    });
    for (const choice of ['local', 'incoming'] as const) {
      const r = applyMerge(a, b, trip, { [D1]: choice }, NOW);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(datesOf(trip, r.edit, 'X')).toEqual([choice === 'local' ? D2 : D3]);
    }
  });

  it('authors 합집합 51명이면 실패하고 입력은 바뀌지 않는다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'] } });
    const localIds = Array.from({ length: 26 }, (_, i) => `l-${i}`);
    const incomingIds = Array.from({ length: 25 }, (_, i) => `i-${i}`);
    const local = makeEdit({ authorId: 'l-0', authors: withAuthors(localIds) });
    const incoming = makeEdit({ authorId: 'i-0', authors: withAuthors(incomingIds) });
    const localCopy = structuredClone(local);
    const incomingCopy = structuredClone(incoming);
    const r = applyMerge(local, incoming, trip, {}, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('병합 결과가 유효하지 않아요');
    expect(local).toEqual(localCopy);
    expect(incoming).toEqual(incomingCopy);
  });

  it('기본값이 아닌 쪽을 고르면 updatedAt = now로 기록되어 옛 incoming을 다시 병합해도 유지된다', () => {
    const { trip, a, b } = moveScenario();
    const aCopy = structuredClone(a);
    const m = mustMerge(a, b, trip, { [D1]: 'local' });
    expect(a).toEqual(aCopy);
    expect(m.days[D1]!.updatedAt).toBe(NOW);
    expect(m.days[D2]!.updatedAt).toBe(NOW);
    const again = mustMerge(m, b, trip);
    expect(again.days).toEqual(m.days);
    expect(datesOf(trip, again, 'X')).toEqual([D2]);
  });

  it('요약: 메모 추가/변경/삭제, 태그 변경, 채택한 날을 incoming 대 local로 센다', () => {
    const trip = makeTrip({ days: { [D1]: ['X'], [D2]: ['Y'] } });
    const local = makeEdit({
      authors: withAuthors(['a-local', 'a-1', 'a-2']),
      places: {
        'n:1': {
          memos: {
            'a-local': { text: '유지', updatedAt: T2 },
            'a-1': { text: '옛', updatedAt: T1 },
          },
          tags: { value: ['옛'], updatedAt: T1 },
        },
        'n:2': { memos: { 'a-2': { text: '지울 것', updatedAt: T1 } } },
      },
    });
    const incoming = makeEdit({
      authorId: 'a-in',
      authors: withAuthors(['a-in', 'a-local', 'a-1', 'a-2']),
      places: {
        'n:1': {
          memos: {
            'a-local': { text: '옛 값', updatedAt: T1 },
            'a-1': { text: '새', updatedAt: T2 },
            'a-in': { text: '추가', updatedAt: T1 },
          },
          tags: { value: ['새'], updatedAt: T2 },
        },
        'n:2': {
          memos: { 'a-2': { text: null, updatedAt: T2 } },
          hidden: { value: true, updatedAt: T1 },
        },
      },
      days: { [D2]: { mode: 'reset', updatedAt: T1 } },
    });
    const { conflicts, summary } = planMerge(local, incoming, trip);
    expect(conflicts).toEqual([]);
    expect(summary).toEqual({
      memosAdded: 1,
      memosChanged: 1,
      memosDeleted: 1,
      tagChanges: [{ placeKey: 'n:1', from: ['옛'], to: ['새'] }],
      hiddenChanges: [{ placeKey: 'n:2', from: undefined, to: true }],
      categoryChanges: [],
      daysAdopted: [D2],
    });
  });
});
