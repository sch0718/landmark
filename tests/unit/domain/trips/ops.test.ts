import { describe, expect, it } from 'vitest';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import {
  addCandidates,
  applyAutoSplit,
  createTrip,
  deleteTrip,
  diffTrip,
  insertStop,
  moveStop,
  removeCandidate,
  renameTrip,
  reorderDay,
  restoreTrip,
  revertTrip,
  setDayStartTime,
  setLegMode,
  setLodging,
  setOrigin,
  setStopFixedTime,
  setStopNote,
  setStopStay,
  setTripDates,
  unscheduleStop,
} from 'src/domain/trips/ops';
import { legKey } from 'src/domain/trips/query';
import { emptyLibrary, LibrarySchema, type Library, type Place } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import type { Day, Stop, Trip } from 'src/schema/trip';

const T0 = '2026-10-08T01:00:00.000Z';
const NOW = '2026-10-08T02:00:00.000Z';
const f = <V>(value: V, updatedAt = T0) => ({ value, updatedAt });

const pid = (n: number) => `p${String(n).padStart(9, '0')}`;
const sid = (n: number) => `s${String(n).padStart(7, '0')}`;
const TRIP = 't000000001';

let seq = 0;
const ctxAt = (now: string): OpCtx => ({
  now,
  newId: (kind) => {
    const n = String(seq++);
    return kind === 'trip' ? `nt${n.padStart(8, '0')}` : `ns${n.padStart(6, '0')}`;
  },
});
const ctx = ctxAt(NOW);
const at = (n: number) => `2026-10-08T0${n}:00:00.000Z`;

/** 경도가 n에 비례해 벌어진다(0.1도 ≈ 8.8km). */
function place(n: number, over: Partial<Place> = {}): Place {
  return {
    id: pid(n),
    source: { kind: 'naver', sid: String(1000 + n) },
    name: f(`장소 ${n}`),
    address: '강원 강릉시 창해로 14번길 20',
    lng: 128 + n * 0.1,
    lat: 37.5,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

function stop(n: number, placeN: number, over: Partial<Stop> = {}): Stop {
  return { id: sid(n), placeId: pid(placeN), stayMin: 60, fixedTime: null, note: '', ...over };
}

function day(stops: Stop[] = [], lodging: string | null = null): Day {
  return { stops: f(stops), lodging: f(lodging), startTime: f('09:00') };
}

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: TRIP,
    title: f('강릉'),
    startDate: f('2026-10-20'),
    endDate: f('2026-10-22'),
    origin: f<string | null>(null),
    candidates: f<string[]>([pid(1), pid(2)]),
    days: [day([stop(1, 3), stop(2, 4)]), day([stop(3, 5)]), day()],
    legModes: f<Record<string, 'car' | 'walk'>>({}),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

/** 입력 불변을 확인하려고 문서 전체를 얼린다. 연산이 고치려 하면 TypeError가 난다. */
function deepFreeze<V>(value: V): V {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const PLACES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => place(n));

function library(t: Trip | null = trip(), extra: Place[] = []): Library {
  return deepFreeze({
    ...emptyLibrary(),
    places: Object.fromEntries([...PLACES, ...extra].map((p) => [p.id, p])),
    trips: t === null ? {} : { [t.id]: t },
  });
}

function expectValid(lib: Library) {
  const r = safeParse(LibrarySchema, lib);
  expect(r.success ? [] : r.issues).toEqual([]);
}

/** 성공 결과의 문서. 검증까지 통과해야 한다. */
function ok(result: OpResult): Library {
  if (!result.ok) throw new Error(`실패: ${JSON.stringify(result.error)}`);
  expectValid(result.lib);
  return result.lib;
}

const tripOf = (lib: Library, id = TRIP): Trip => lib.trips[id]!;
const placesOf = (d: Day) => d.stops.value.map((s) => s.placeId);

describe('createTrip', () => {
  it('Day를 날짜 수만큼 만들고, 후보는 중복·모르는 장소·지운 장소를 뺀다', () => {
    const dead = place(9, { deletedAt: T0 });
    const lib = library(null, [dead]);
    const result = createTrip(
      lib,
      {
        title: '  강릉 여행 ',
        startDate: '2026-10-24',
        endDate: '2026-10-26',
        origin: pid(1),
        candidates: [pid(2), pid(3), pid(2), 'pzzzzzzzzz', pid(9)],
      },
      ctx,
    );
    const next = ok(result);
    expect(result.ok && result.createdId).toMatch(/^nt\d{8}$/);
    const t = tripOf(next, result.ok ? result.createdId! : '');
    expect(t.title).toEqual({ value: '강릉 여행', updatedAt: NOW });
    expect(t.origin.value).toBe(pid(1));
    expect(t.candidates.value).toEqual([pid(2), pid(3)]);
    expect(t.days).toHaveLength(3);
    for (const d of t.days) {
      expect(d).toEqual({
        stops: { value: [], updatedAt: NOW },
        lodging: { value: null, updatedAt: NOW },
        startTime: { value: '09:00', updatedAt: NOW },
      });
    }
    expect(t.legModes.value).toEqual({});
    expect(t.createdAt).toBe(NOW);
    expect(t.deletedAt).toBeNull();
  });

  it('제목이 비었거나 60자를 넘으면 거절한다', () => {
    const base = { startDate: '2026-10-24', endDate: '2026-10-24', origin: null, candidates: [] };
    expect(createTrip(library(null), { ...base, title: '   ' }, ctx)).toEqual({
      ok: false,
      error: { _tag: 'TripTitleInvalid', reason: 'empty' },
    });
    expect(createTrip(library(null), { ...base, title: '가'.repeat(61) }, ctx)).toEqual({
      ok: false,
      error: { _tag: 'TripTitleInvalid', reason: 'too-long' },
    });
    ok(createTrip(library(null), { ...base, title: '가'.repeat(60) }, ctx));
  });

  it('종료일이 시작일보다 이르거나 31일이면 거절한다(30일은 된다)', () => {
    const base = { title: '여행', origin: null, candidates: [] };
    expect(
      createTrip(library(null), { ...base, startDate: '2026-10-24', endDate: '2026-10-23' }, ctx),
    ).toEqual({ ok: false, error: { _tag: 'TripDatesInvalid', reason: 'order' } });
    expect(
      createTrip(library(null), { ...base, startDate: '2026-10-01', endDate: '2026-10-31' }, ctx),
    ).toEqual({ ok: false, error: { _tag: 'TripDatesInvalid', reason: 'too-many-days' } });
    const r = createTrip(
      library(null),
      { ...base, startDate: '2026-10-01', endDate: '2026-10-30' },
      ctx,
    );
    expect(tripOf(ok(r), r.ok ? r.createdId! : '').days).toHaveLength(30);
  });

  it('모르는 출발지는 NotFound', () => {
    const r = createTrip(
      library(null),
      {
        title: '여행',
        startDate: '2026-10-24',
        endDate: '2026-10-24',
        origin: 'pzzzzzzzzz',
        candidates: [],
      },
      ctx,
    );
    expect(r).toEqual({ ok: false, error: { _tag: 'NotFound', id: 'pzzzzzzzzz' } });
  });
});

describe('renameTrip', () => {
  it('다듬은 제목으로 바꾸고 그 필드만 갱신한다', () => {
    const lib = library();
    const next = ok(renameTrip(lib, TRIP, ' 속초 ', ctx));
    const t = tripOf(next);
    expect(t.title).toEqual({ value: '속초', updatedAt: NOW });
    expect(t.candidates).toBe(tripOf(lib).candidates);
    expect(t.days).toBe(tripOf(lib).days);
  });

  it('같은 제목이면 문서를 그대로 돌려준다', () => {
    const lib = library();
    const r = renameTrip(lib, TRIP, '강릉', ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('잘못된 제목·없는 여행·지운 여행은 거절한다', () => {
    expect(renameTrip(library(), TRIP, '', ctx)).toEqual({
      ok: false,
      error: { _tag: 'TripTitleInvalid', reason: 'empty' },
    });
    expect(renameTrip(library(), 'tzzzzzzzzz', '새 이름', ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: 'tzzzzzzzzz' },
    });
    const dead = library(trip({ deletedAt: T0 }));
    expect(renameTrip(dead, TRIP, '새 이름', ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: TRIP },
    });
  });
});

describe('setTripDates', () => {
  it('줄이면 잘린 Day의 장소를 순서대로 후보 끝에 둔다', () => {
    const t = trip({
      days: [day([stop(1, 3)]), day([stop(2, 4), stop(3, 5)]), day([stop(4, 6)], pid(7))],
    });
    const next = ok(setTripDates(library(t), TRIP, '2026-10-20', '2026-10-20', ctx));
    const nt = tripOf(next);
    expect(nt.days).toHaveLength(1);
    expect(nt.days[0]).toBe(t.days[0]);
    expect(nt.candidates).toEqual({
      value: [pid(1), pid(2), pid(4), pid(5), pid(6)],
      updatedAt: NOW,
    });
    expect(nt.endDate).toEqual({ value: '2026-10-20', updatedAt: NOW });
    expect(nt.startDate).toBe(t.startDate);
  });

  it('늘리면 뒤에 빈 Day를 붙인다', () => {
    const t = trip();
    const next = ok(setTripDates(library(t), TRIP, '2026-10-20', '2026-10-24', ctx));
    const nt = tripOf(next);
    expect(nt.days).toHaveLength(5);
    expect(nt.days.slice(0, 3)).toEqual(t.days);
    expect(nt.days[3]).toEqual({
      stops: { value: [], updatedAt: NOW },
      lodging: { value: null, updatedAt: NOW },
      startTime: { value: '09:00', updatedAt: NOW },
    });
    expect(nt.candidates).toBe(t.candidates);
  });

  it('시작일만 옮기면(같은 날 수) Day 내용은 그대로 날짜만 바뀐다', () => {
    const t = trip();
    const next = ok(setTripDates(library(t), TRIP, '2026-11-01', '2026-11-03', ctx));
    const nt = tripOf(next);
    expect(nt.days).toEqual(t.days);
    expect(nt.candidates).toBe(t.candidates);
    expect(nt.startDate).toEqual({ value: '2026-11-01', updatedAt: NOW });
    expect(nt.endDate).toEqual({ value: '2026-11-03', updatedAt: NOW });
  });

  it('31일·역순은 TripDatesInvalid', () => {
    expect(setTripDates(library(), TRIP, '2026-10-01', '2026-10-31', ctx)).toEqual({
      ok: false,
      error: { _tag: 'TripDatesInvalid', reason: 'too-many-days' },
    });
    expect(setTripDates(library(), TRIP, '2026-10-21', '2026-10-20', ctx)).toEqual({
      ok: false,
      error: { _tag: 'TripDatesInvalid', reason: 'order' },
    });
  });

  it('같은 기간이면 문서를 그대로 돌려준다', () => {
    const lib = library();
    const r = setTripDates(lib, TRIP, '2026-10-20', '2026-10-22', ctx);
    expect(r.ok && r.lib).toBe(lib);
  });
});

describe('setOrigin', () => {
  it('출발지를 정하고 비운다. 모르는 장소는 NotFound', () => {
    const lib = library();
    const set = ok(setOrigin(lib, TRIP, pid(8), ctx));
    expect(tripOf(set).origin).toEqual({ value: pid(8), updatedAt: NOW });
    // 출발지는 "장소 한 번만" 규칙 밖이라 후보에 있는 장소도 된다.
    ok(setOrigin(lib, TRIP, pid(1), ctx));
    expect(tripOf(ok(setOrigin(set, TRIP, null, ctx))).origin.value).toBeNull();
    expect(setOrigin(lib, TRIP, 'pzzzzzzzzz', ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: 'pzzzzzzzzz' },
    });
  });
});

describe('deleteTrip / restoreTrip', () => {
  it('묘비를 남기고 되살린다', () => {
    const deleted = ok(deleteTrip(library(), TRIP, ctx));
    expect(tripOf(deleted).deletedAt).toBe(NOW);
    const again = deleteTrip(deleted, TRIP, ctxAt(at(5)));
    expect(again.ok && tripOf(again.lib).deletedAt).toBe(NOW);
    const restored = ok(restoreTrip(deleted, TRIP, ctx));
    expect(tripOf(restored).deletedAt).toBeNull();
    expect(deleteTrip(library(), 'tzzzzzzzzz', ctx).ok).toBe(false);
    expect(restoreTrip(library(), 'tzzzzzzzzz', ctx).ok).toBe(false);
  });
});

describe('addCandidates', () => {
  it('이미 여행에 있는 장소(후보·Day)와 중복은 건너뛰고 새로 넣은 수를 센다', () => {
    const lib = library();
    const r = addCandidates(lib, TRIP, [pid(7), pid(1), pid(3), pid(7), pid(8)], ctx);
    const next = ok(r);
    expect(r.ok && r.summary).toEqual({ created: 2, merged: 0, restored: 0 });
    expect(tripOf(next).candidates).toEqual({
      value: [pid(1), pid(2), pid(7), pid(8)],
      updatedAt: NOW,
    });
  });

  it('Day에 있는 장소만 넣으면 아무것도 바꾸지 않는다', () => {
    const lib = library();
    const r = addCandidates(lib, TRIP, [pid(3)], ctx);
    expect(r.ok && r.lib).toBe(lib);
    expect(r.ok && r.summary).toEqual({ created: 0, merged: 0, restored: 0 });
  });

  it('모르는 장소·지운 장소는 넣지 않는다', () => {
    const lib = library(trip(), [place(9, { deletedAt: T0 })]);
    const r = addCandidates(lib, TRIP, ['pzzzzzzzzz', pid(9)], ctx);
    expect(r.ok && r.lib).toBe(lib);
  });
});

describe('removeCandidate', () => {
  it('후보에서 뺀다', () => {
    const next = ok(removeCandidate(library(), TRIP, pid(1), ctx));
    expect(tripOf(next).candidates).toEqual({ value: [pid(2)], updatedAt: NOW });
  });

  it('후보가 아니면 그대로', () => {
    const lib = library();
    const r = removeCandidate(lib, TRIP, pid(3), ctx);
    expect(r.ok && r.lib).toBe(lib);
  });
});

describe('insertStop', () => {
  it('후보를 Day의 자리에 넣고 새 Stop을 만든다', () => {
    const lib = library();
    const next = ok(insertStop(lib, TRIP, pid(2), 0, 1, ctx));
    const t = tripOf(next);
    expect(t.candidates).toEqual({ value: [pid(1)], updatedAt: NOW });
    expect(placesOf(t.days[0]!)).toEqual([pid(3), pid(2), pid(4)]);
    expect(t.days[0]!.stops.updatedAt).toBe(NOW);
    expect(t.days[0]!.stops.value[1]).toEqual({
      id: expect.stringMatching(/^ns\d{6}$/),
      placeId: pid(2),
      stayMin: null,
      fixedTime: null,
      note: '',
    });
    expect(t.days[1]).toBe(tripOf(lib).days[1]);
  });

  it('다른 Day의 장소는 Stop id·체류·메모를 그대로 옮긴다', () => {
    const t0 = trip({
      days: [day([stop(1, 3, { stayMin: 30, note: '메모', fixedTime: '12:00' })]), day(), day()],
    });
    const next = ok(insertStop(library(t0), TRIP, pid(3), 2, 0, ctx));
    const t = tripOf(next);
    expect(t.days[0]!.stops).toEqual({ value: [], updatedAt: NOW });
    expect(t.days[2]!.stops.value).toEqual([
      { id: sid(1), placeId: pid(3), stayMin: 30, fixedTime: '12:00', note: '메모' },
    ]);
  });

  it('후보 칸에서 이미 다른 Day에 있는 장소를 넣으면 AlreadyInTrip 대신 옮긴다', () => {
    // 후보 칸이 오래된 화면이라 pid(5)를 아직 후보로 보여 줬다고 가정한다.
    const r = insertStop(library(), TRIP, pid(5), 0, 0, ctx);
    const t = tripOf(ok(r));
    expect(placesOf(t.days[0]!)).toEqual([pid(5), pid(3), pid(4)]);
    expect(placesOf(t.days[1]!)).toEqual([]);
    expect(t.days[0]!.stops.value[0]!.id).toBe(sid(3));
  });

  it('여행에 없던 장소는 새 Stop으로 넣는다', () => {
    const t = tripOf(ok(insertStop(library(), TRIP, pid(8), 2, 0, ctx)));
    expect(placesOf(t.days[2]!)).toEqual([pid(8)]);
    expect(t.candidates.value).toEqual([pid(1), pid(2)]);
  });

  it('이미 그 자리면 문서를 그대로 돌려준다', () => {
    const lib = library();
    const r = insertStop(lib, TRIP, pid(4), 0, 1, ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('자리는 [0, 길이]로 맞춘다', () => {
    const t = tripOf(ok(insertStop(library(), TRIP, pid(1), 0, 99, ctx)));
    expect(placesOf(t.days[0]!)).toEqual([pid(3), pid(4), pid(1)]);
    const t2 = tripOf(ok(insertStop(library(), TRIP, pid(1), 0, -3, ctx)));
    expect(placesOf(t2.days[0]!)).toEqual([pid(1), pid(3), pid(4)]);
  });

  it('없는 Day·모르는 장소·지운 새 장소는 NotFound', () => {
    expect(insertStop(library(), TRIP, pid(1), 3, 0, ctx).ok).toBe(false);
    expect(insertStop(library(), TRIP, 'pzzzzzzzzz', 0, 0, ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: 'pzzzzzzzzz' },
    });
    const lib = library(trip(), [place(9, { deletedAt: T0 })]);
    expect(insertStop(lib, TRIP, pid(9), 0, 0, ctx).ok).toBe(false);
  });
});

describe('moveStop / unscheduleStop', () => {
  it('같은 Day 안에서 자리를 바꾼다', () => {
    const t = tripOf(ok(moveStop(library(), TRIP, sid(1), 0, 1, ctx)));
    expect(placesOf(t.days[0]!)).toEqual([pid(4), pid(3)]);
  });

  it('다른 Day로 옮긴다(Stop id 유지)', () => {
    const t = tripOf(ok(moveStop(library(), TRIP, sid(2), 1, 0, ctx)));
    expect(placesOf(t.days[0]!)).toEqual([pid(3)]);
    expect(t.days[1]!.stops.value.map((s) => s.id)).toEqual([sid(2), sid(3)]);
  });

  it('후보 끝으로 뺀다', () => {
    const t = tripOf(ok(unscheduleStop(library(), TRIP, sid(1), ctx)));
    expect(placesOf(t.days[0]!)).toEqual([pid(4)]);
    expect(t.candidates).toEqual({ value: [pid(1), pid(2), pid(3)], updatedAt: NOW });
  });

  it('없는 Stop은 NotFound', () => {
    expect(moveStop(library(), TRIP, 'szzzzzzz', 0, 0, ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: 'szzzzzzz' },
    });
    expect(unscheduleStop(library(), TRIP, 'szzzzzzz', ctx).ok).toBe(false);
  });
});

describe('Stop 세부', () => {
  it('체류·고정 시각·메모를 바꾸고 그 Day만 갱신한다', () => {
    const lib = library();
    const a = ok(setStopStay(lib, TRIP, sid(2), 90, ctx));
    expect(tripOf(a).days[0]!.stops.value[1]!.stayMin).toBe(90);
    expect(tripOf(a).days[0]!.stops.updatedAt).toBe(NOW);
    expect(tripOf(a).days[1]).toBe(tripOf(lib).days[1]);
    expect(
      tripOf(ok(setStopStay(a, TRIP, sid(2), null, ctx))).days[0]!.stops.value[1]!.stayMin,
    ).toBeNull();
    const b = ok(setStopFixedTime(lib, TRIP, sid(3), '13:30', ctx));
    expect(tripOf(b).days[1]!.stops.value[0]!.fixedTime).toBe('13:30');
    const c = ok(setStopNote(lib, TRIP, sid(3), '예약함', ctx));
    expect(tripOf(c).days[1]!.stops.value[0]!.note).toBe('예약함');
  });

  it('고정 시각 입력을 비우면(빈 문자열) 고정 시각을 지우고, 틀린 형식은 무시한다', () => {
    const lib = library(trip({ days: [day([stop(1, 3, { fixedTime: '12:00' })]), day(), day()] }));
    const cleared = tripOf(ok(setStopFixedTime(lib, TRIP, sid(1), '', ctx)));
    expect(cleared.days[0]!.stops).toEqual({
      value: [{ ...stop(1, 3), fixedTime: null }],
      updatedAt: NOW,
    });
    const r = setStopFixedTime(lib, TRIP, sid(1), '25:00', ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('같은 값이면 문서를 그대로 돌려준다', () => {
    const lib = library();
    const r = setStopStay(lib, TRIP, sid(1), 60, ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('없는 Stop은 NotFound', () => {
    expect(setStopNote(library(), TRIP, 'szzzzzzz', 'x', ctx).ok).toBe(false);
  });
});

describe('setLodging / setDayStartTime', () => {
  it('그 Day의 숙소만 정한다', () => {
    const t = tripOf(ok(setLodging(library(), TRIP, 0, pid(8), false, ctx)));
    expect(t.days.map((d) => d.lodging.value)).toEqual([pid(8), null, null]);
  });

  it('다음 날들도 같은 숙소면 뒤 Day들을 모두 바꾼다', () => {
    const t0 = trip({ days: [day([], pid(6)), day([], pid(6)), day([], pid(7))] });
    const t = tripOf(ok(setLodging(library(t0), TRIP, 1, pid(8), true, ctx)));
    expect(t.days.map((d) => d.lodging.value)).toEqual([pid(6), pid(8), pid(8)]);
    expect(t.days[0]).toBe(t0.days[0]);
    expect(t.days[2]!.lodging.updatedAt).toBe(NOW);
  });

  it('출발 시각을 바꾼다', () => {
    const t = tripOf(ok(setDayStartTime(library(), TRIP, 1, '10:30', ctx)));
    expect(t.days[1]!.startTime).toEqual({ value: '10:30', updatedAt: NOW });
  });

  it('출발 시각은 필수라 빈 값·틀린 형식은 무시한다', () => {
    const lib = library();
    const empty = setDayStartTime(lib, TRIP, 0, '', ctx);
    expect(empty.ok && empty.lib).toBe(lib);
    const bad = setDayStartTime(lib, TRIP, 0, '9:00', ctx);
    expect(bad.ok && bad.lib).toBe(lib);
  });

  it('모르는 숙소·없는 Day는 NotFound', () => {
    expect(setLodging(library(), TRIP, 0, 'pzzzzzzzzz', false, ctx).ok).toBe(false);
    expect(setLodging(library(), TRIP, 5, pid(1), false, ctx).ok).toBe(false);
    expect(setDayStartTime(library(), TRIP, 5, '10:00', ctx).ok).toBe(false);
  });
});

describe('setLegMode', () => {
  // pid(1)과 가까운 곳(직선 약 90m, 자동 값 도보)
  const near = place(9, { lng: 128.101, lat: 37.5 });
  const lib = library(trip(), [near]);
  const key = legKey(pid(1), pid(9));

  it('자동 값과 다르면 기록하고, 자동 값으로 되돌리면 항목을 지운다', () => {
    const car = ok(setLegMode(lib, TRIP, pid(1), pid(9), 'car', ctx));
    expect(tripOf(car).legModes).toEqual({ value: { [key]: 'car' }, updatedAt: NOW });
    const back = ok(setLegMode(car, TRIP, pid(1), pid(9), 'walk', ctxAt(at(5))));
    expect(tripOf(back).legModes).toEqual({ value: {}, updatedAt: at(5) });
  });

  it('자동 값과 같으면 기록하지 않는다', () => {
    const r = setLegMode(lib, TRIP, pid(1), pid(2), 'car', ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('직선 50km를 넘는 구간의 도보 선택은 무시한다', () => {
    // pid(1)↔pid(8): 경도 0.7도 차이, 직선 약 62km
    const r = setLegMode(lib, TRIP, pid(1), pid(8), 'walk', ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('저장된 값이 도보여도 자동 값(자동차)을 직접 계산해 지운다', () => {
    const t0 = trip({ legModes: f({ [legKey(pid(1), pid(2))]: 'walk' as const }) });
    const t = tripOf(ok(setLegMode(library(t0), TRIP, pid(1), pid(2), 'car', ctx)));
    expect(t.legModes.value).toEqual({});
  });
});

describe('reorderDay', () => {
  it('같은 집합의 새 순서로 바꾼다', () => {
    const t = tripOf(ok(reorderDay(library(), TRIP, 0, [sid(2), sid(1)], ctx)));
    expect(t.days[0]!.stops.value.map((s) => s.id)).toEqual([sid(2), sid(1)]);
  });

  it('집합이 다르면 거절한다', () => {
    expect(reorderDay(library(), TRIP, 0, [sid(2)], ctx).ok).toBe(false);
    expect(reorderDay(library(), TRIP, 0, [sid(2), sid(3)], ctx).ok).toBe(false);
    expect(reorderDay(library(), TRIP, 0, [sid(1), sid(1)], ctx).ok).toBe(false);
  });

  it('같은 순서면 문서를 그대로 돌려준다', () => {
    const lib = library();
    const r = reorderDay(lib, TRIP, 0, [sid(1), sid(2)], ctx);
    expect(r.ok && r.lib).toBe(lib);
  });
});

describe('applyAutoSplit', () => {
  it('plan의 순서로 Day를 채우고, 들어간 후보는 후보에서 뺀다', () => {
    const lib = library();
    const plan = [[pid(3), pid(1)], [pid(5), pid(4)], []];
    const t = tripOf(ok(applyAutoSplit(lib, TRIP, plan, ctx)));
    expect(t.days.map(placesOf)).toEqual(plan);
    expect(t.candidates).toEqual({ value: [pid(2)], updatedAt: NOW });
    expect(t.days[0]!.stops.value[0]!.id).toBe(sid(1));
    expect(t.days[1]!.stops.value.map((s) => s.id)).toEqual([sid(3), sid(2)]);
    expect(t.days[2]).toBe(tripOf(lib).days[2]);
  });

  it('여행에 없는 장소는 무시하고, plan에 빠진 기존 Stop은 원래 Day 끝에 남긴다', () => {
    const t = tripOf(ok(applyAutoSplit(library(), TRIP, [[pid(1), pid(8)], [], []], ctx)));
    expect(t.days.map(placesOf)).toEqual([[pid(1), pid(3), pid(4)], [pid(5)], []]);
  });

  describe('보관함에서 지운 장소의 Stop은 제자리를 지킨다(스펙 §3.3)', () => {
    // Day 1: [장소 1, 장소 9(지움), 장소 3], 후보 장소 4. 미리보기 plan에는 보이는 장소만 있다.
    const hiddenLib = () =>
      library(
        trip({
          candidates: f<string[]>([pid(4)]),
          days: [day([stop(1, 1), stop(2, 9), stop(3, 3)]), day(), day()],
        }),
        [place(9, { deletedAt: T0 })],
      );

    it('순서가 그대로면 숨은 Stop은 원래 자리, 새 장소는 끝', () => {
      const t = tripOf(
        ok(applyAutoSplit(hiddenLib(), TRIP, [[pid(1), pid(3), pid(4)], [], []], ctx)),
      );
      expect(placesOf(t.days[0]!)).toEqual([pid(1), pid(9), pid(3), pid(4)]);
      expect(t.days[0]!.stops.value[1]!.id).toBe(sid(2));
      expect(t.candidates.value).toEqual([]);
    });

    it('보이는 순서가 바뀌어도 숨은 Stop은 같은 칸에 남는다', () => {
      const t = tripOf(
        ok(applyAutoSplit(hiddenLib(), TRIP, [[pid(3), pid(1), pid(4)], [], []], ctx)),
      );
      expect(placesOf(t.days[0]!)).toEqual([pid(3), pid(9), pid(1), pid(4)]);
    });
  });
});

describe('입력 불변', () => {
  it('모든 연산이 얼린 원본을 고치지 않는다', () => {
    const lib = library();
    const before = JSON.stringify(lib);
    const calls = [
      () =>
        createTrip(
          lib,
          {
            title: '새 여행',
            startDate: '2026-11-01',
            endDate: '2026-11-02',
            origin: null,
            candidates: [pid(1)],
          },
          ctx,
        ),
      () => restoreTrip(lib, TRIP, ctx),
      () => renameTrip(lib, TRIP, '새 이름', ctx),
      () => setTripDates(lib, TRIP, '2026-10-20', '2026-10-20', ctx),
      () => setTripDates(lib, TRIP, '2026-10-20', '2026-10-25', ctx),
      () => setOrigin(lib, TRIP, pid(8), ctx),
      () => deleteTrip(lib, TRIP, ctx),
      () => addCandidates(lib, TRIP, [pid(8)], ctx),
      () => removeCandidate(lib, TRIP, pid(1), ctx),
      () => insertStop(lib, TRIP, pid(1), 1, 0, ctx),
      () => moveStop(lib, TRIP, sid(1), 2, 0, ctx),
      () => unscheduleStop(lib, TRIP, sid(3), ctx),
      () => setStopStay(lib, TRIP, sid(1), 10, ctx),
      () => setStopFixedTime(lib, TRIP, sid(1), '10:00', ctx),
      () => setStopNote(lib, TRIP, sid(1), '메모', ctx),
      () => setLodging(lib, TRIP, 0, pid(8), true, ctx),
      () => setDayStartTime(lib, TRIP, 0, '08:00', ctx),
      () => setLegMode(lib, TRIP, pid(1), pid(2), 'walk', ctx),
      () => reorderDay(lib, TRIP, 0, [sid(2), sid(1)], ctx),
      () => applyAutoSplit(lib, TRIP, [[pid(1)], [pid(2)], [pid(3)]], ctx),
    ];
    for (const call of calls) ok(call());
    expect(JSON.stringify(lib)).toBe(before);
  });
});

describe('되돌리기', () => {
  /** `op`를 `now`에 적용하고 기록을 남긴다. */
  function record(lib: Library, op: (l: Library) => OpResult) {
    const next = ok(op(lib));
    return { lib: next, change: diffTrip(tripOf(lib), tripOf(next)) };
  }

  it('왕복: insertStop 뒤 되돌리면 후보·Day가 전과 같은 값', () => {
    const lib = library();
    const { lib: after, change } = record(lib, (l) =>
      insertStop(l, TRIP, pid(1), 1, 0, ctxAt(at(2))),
    );
    const r = revertTrip(after, change, ctxAt(at(3)));
    const t = tripOf(ok(r));
    expect(t.candidates.value).toEqual(tripOf(lib).candidates.value);
    expect(t.days.map((d) => d.stops.value)).toEqual(tripOf(lib).days.map((d) => d.stops.value));
    expect(t.candidates.updatedAt).toBe(at(3));
    expect(r.ok && r.summary).toEqual({ created: 0, merged: 0, restored: 0 });
  });

  it('리뷰 반례: 기록 뒤 다른 편집이 다른 Day를 바꿨으면 그 Day는 그대로 둔다', () => {
    const lib = library();
    // 시각 2: Day 1 출발 시각을 바꾸고 기록한다.
    const { lib: a, change } = record(lib, (l) =>
      setDayStartTime(l, TRIP, 0, '07:00', ctxAt(at(2))),
    );
    // 시각 3: 다른 편집이 Day 2를 바꾼다.
    const b = ok(setDayStartTime(a, TRIP, 1, '11:00', ctxAt(at(3))));
    const r = revertTrip(b, change, ctxAt(at(4)));
    const t = tripOf(ok(r));
    expect(t.days[0]!.startTime).toEqual({ value: '09:00', updatedAt: at(4) });
    expect(t.days[1]!.startTime).toEqual({ value: '11:00', updatedAt: at(3) });
    expect(r.ok && r.summary!.merged).toBe(0);
  });

  it('겹친 필드: 연산이 바꾼 후보를 다른 편집이 또 바꿨으면 건너뛴다', () => {
    const lib = library();
    const { lib: a, change } = record(lib, (l) => insertStop(l, TRIP, pid(1), 2, 0, ctxAt(at(2))));
    const b = ok(addCandidates(a, TRIP, [pid(8)], ctxAt(at(3))));
    const r = revertTrip(b, change, ctxAt(at(4)));
    const t = tripOf(ok(r));
    expect(r.ok && r.summary!.merged).toBe(1);
    // Day 3은 되돌려져 pid(1)이 빠진다. 후보는 건너뛰었으므로(다른 편집의 pid(8) 유지)
    // pid(1)이 여행에서 사라지지 않게 후보 끝에 둔다.
    expect(placesOf(t.days[2]!)).toEqual([]);
    expect(t.candidates).toEqual({ value: [pid(2), pid(8), pid(1)], updatedAt: at(4) });
  });

  it('중복 정리: 되돌린 필드에서 장소를 빼고 다른 곳에서 옮긴 자리를 남긴다', () => {
    const lib = library();
    // 후보 pid(1) → Day 1
    const { lib: a, change } = record(lib, (l) => insertStop(l, TRIP, pid(1), 0, 0, ctxAt(at(2))));
    // 다른 편집이 pid(1)을 Day 1 → Day 2로 옮김
    const stopId = tripOf(a).days[0]!.stops.value[0]!.id;
    const b = ok(moveStop(a, TRIP, stopId, 1, 0, ctxAt(at(3))));
    const r = revertTrip(b, change, ctxAt(at(4)));
    const t = tripOf(ok(r));
    expect(placesOf(t.days[1]!)).toEqual([pid(1), pid(5)]);
    expect(t.candidates.value).toEqual([pid(2)]);
    expect(placesOf(t.days[0]!)).toEqual([pid(3), pid(4)]);
    expect(r.ok && r.summary!.merged).toBe(1);
  });

  describe('기간 변경', () => {
    it('그사이 기간·Day 필드가 모두 그대로면 기간·Day 수·내용을 복원한다', () => {
      const lib = library();
      const { lib: a, change } = record(lib, (l) =>
        setTripDates(l, TRIP, '2026-10-20', '2026-10-20', ctxAt(at(2))),
      );
      expect(change.period).toBeDefined();
      expect(change.fields.map((x) => x.path)).toEqual(['candidates']);
      const r = revertTrip(a, change, ctxAt(at(3)));
      const t = tripOf(ok(r));
      const before = tripOf(lib);
      expect(t.startDate.value).toBe('2026-10-20');
      expect(t.endDate.value).toBe('2026-10-22');
      expect(t.days.map((d) => d.stops.value)).toEqual(before.days.map((d) => d.stops.value));
      expect(t.candidates.value).toEqual(before.candidates.value);
      expect(r.ok && r.summary!.merged).toBe(0);
    });

    it('Day 필드가 바뀌었으면 기간·days를 모두 건너뛴다', () => {
      const lib = library();
      const { lib: a, change } = record(lib, (l) =>
        setTripDates(l, TRIP, '2026-10-20', '2026-10-24', ctxAt(at(2))),
      );
      const b = ok(setDayStartTime(a, TRIP, 0, '06:00', ctxAt(at(3))));
      const r = revertTrip(b, change, ctxAt(at(4)));
      const t = tripOf(ok(r));
      expect(t.endDate.value).toBe('2026-10-24');
      expect(t.days).toHaveLength(5);
      expect(t.days[0]!.startTime.value).toBe('06:00');
      expect(r.ok && r.summary!.merged).toBe(1);
    });

    it('리뷰 반례: 같은 이후 기간을 가진 두 기록은 각자의 이전 기간으로 돌아간다', () => {
      const empty = (start: string, end: string) =>
        trip({
          startDate: f(start),
          endDate: f(end),
          candidates: f<string[]>([]),
          days: [day(), day()],
        });
      const libA = library(empty('2026-10-12', '2026-10-13'));
      const libB = library(empty('2026-10-14', '2026-10-15'));
      const recA = record(libA, (l) =>
        setTripDates(l, TRIP, '2026-10-20', '2026-10-21', ctxAt(at(2))),
      );
      const recB = record(libB, (l) =>
        setTripDates(l, TRIP, '2026-10-20', '2026-10-21', ctxAt(at(2))),
      );
      expect(recA.change).not.toEqual(recB.change);
      expect(recA.change.period!.before.startDate.value).toBe('2026-10-12');
      expect(recB.change.period!.before.startDate.value).toBe('2026-10-14');
      const a = tripOf(ok(revertTrip(recA.lib, recA.change, ctxAt(at(3)))));
      const b = tripOf(ok(revertTrip(recB.lib, recB.change, ctxAt(at(3)))));
      expect([a.startDate.value, a.endDate.value]).toEqual(['2026-10-12', '2026-10-13']);
      expect([b.startDate.value, b.endDate.value]).toEqual(['2026-10-14', '2026-10-15']);
    });

    it('리뷰 반례: 줄인 뒤 다른 편집이 날짜만 옮겼으면 기간·days 모두 건너뛴다', () => {
      const lib = library(trip({ startDate: f('2026-10-12'), endDate: f('2026-10-14') }));
      const { lib: a, change } = record(lib, (l) =>
        setTripDates(l, TRIP, '2026-10-12', '2026-10-13', ctxAt(at(2))),
      );
      const b = ok(setTripDates(a, TRIP, '2026-10-20', '2026-10-21', ctxAt(at(3))));
      const r = revertTrip(b, change, ctxAt(at(4)));
      const t = tripOf(ok(r));
      expect([t.startDate.value, t.endDate.value]).toEqual(['2026-10-20', '2026-10-21']);
      expect(t.days).toHaveLength(2);
      expect(r.ok && r.summary!.merged).toBeGreaterThan(0);
    });

    it('기간을 건너뛰고 후보만 되돌리면 잘린 Day에서 온 장소를 잃지 않는다', () => {
      const t0 = trip({ days: [day([stop(1, 3)]), day(), day([stop(2, 4)])] });
      const lib = library(t0);
      const { lib: a, change } = record(lib, (l) =>
        setTripDates(l, TRIP, '2026-10-20', '2026-10-21', ctxAt(at(2))),
      );
      expect(tripOf(a).candidates.value).toEqual([pid(1), pid(2), pid(4)]);
      const b = ok(setDayStartTime(a, TRIP, 1, '10:00', ctxAt(at(3))));
      const r = revertTrip(b, change, ctxAt(at(4)));
      const t = tripOf(ok(r));
      expect(t.days).toHaveLength(2);
      expect(t.candidates.value).toEqual([pid(1), pid(2), pid(4)]);
      // 값이 그대로면 후보 필드도 그대로(시각을 올리지 않는다).
      expect(t.candidates).toBe(tripOf(b).candidates);
      expect(t.candidates.updatedAt).toBe(at(2));
      expect(r.ok && r.lib).toBe(b);
      expect(r.ok && r.summary!.merged).toBe(1);
    });
  });

  it('applyAutoSplit 기록을 되돌리면 여러 Day와 후보가 함께 돌아간다', () => {
    const lib = library();
    const { lib: a, change } = record(lib, (l) =>
      applyAutoSplit(l, TRIP, [[pid(3), pid(1)], [pid(5), pid(4)], [pid(2)]], ctxAt(at(2))),
    );
    expect(change.fields.map((x) => x.path)).toEqual([
      'candidates',
      { day: 0, field: 'stops' },
      { day: 1, field: 'stops' },
      { day: 2, field: 'stops' },
    ]);
    const r = revertTrip(a, change, ctxAt(at(3)));
    const t = tripOf(ok(r));
    const before = tripOf(lib);
    expect(t.candidates.value).toEqual(before.candidates.value);
    expect(t.days.map((d) => d.stops.value)).toEqual(before.days.map((d) => d.stops.value));
    expect(r.ok && r.summary!.merged).toBe(0);
  });

  it('기록한 Day가 다른 편집으로 없어졌으면 그 필드는 건너뛴다', () => {
    const lib = library();
    // 시각 2: 후보 pid(1)을 Day 3에 넣는다.
    const { lib: a, change } = record(lib, (l) => insertStop(l, TRIP, pid(1), 2, 0, ctxAt(at(2))));
    // 시각 3: 다른 편집이 기간을 2일로 줄여 Day 3(pid(1))이 후보로 돌아간다.
    const b = ok(setTripDates(a, TRIP, '2026-10-20', '2026-10-21', ctxAt(at(3))));
    const r = revertTrip(b, change, ctxAt(at(4)));
    const t = tripOf(ok(r));
    // 후보(시각 3에 바뀜)와 Day 3(없음) 둘 다 건너뛴다.
    expect(r.ok && r.summary!.merged).toBe(2);
    expect(t.days).toHaveLength(2);
    expect(t.candidates).toBe(tripOf(b).candidates);
    expect(t.candidates.value).toEqual([pid(2), pid(1)]);
  });

  it('여행이 없거나 지워졌으면 NotFound', () => {
    const lib = library();
    const { change } = record(lib, (l) => renameTrip(l, TRIP, '새 이름', ctxAt(at(2))));
    expect(revertTrip(library(null), change, ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: TRIP },
    });
    expect(revertTrip(library(trip({ deletedAt: T0 })), change, ctx).ok).toBe(false);
  });

  it('diffTrip은 바뀐 필드만 담는다', () => {
    const lib = library();
    const next = ok(insertStop(lib, TRIP, pid(1), 1, 0, ctxAt(at(2))));
    const change = diffTrip(tripOf(lib), tripOf(next));
    expect(change.tripId).toBe(TRIP);
    expect(change.period).toBeUndefined();
    expect(change.fields.map((x) => x.path)).toEqual(['candidates', { day: 1, field: 'stops' }]);
    expect(change.fields[0]!.before).toBe(tripOf(lib).candidates);
  });
});
