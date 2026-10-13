import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { emptyLibrary, LIBRARY_LIMITS, LibrarySchema, type Place } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { daysBetween, TripId, TripStopId, type Stop, type Trip } from 'src/schema/trip';

const T = '2026-10-08T01:00:00.000Z';
const f = <V>(value: V) => ({ value, updatedAt: T });

const pid = (n: number) => `p${String(n).padStart(9, '0')}`;

function place(n: number, over: Partial<Place> = {}): Place {
  return {
    id: pid(n),
    source: { kind: 'naver', sid: String(1000 + n) },
    name: f(`장소 ${n}`),
    address: '강원 강릉시 창해로 14번길 20',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T,
    deletedAt: null,
    ...over,
  };
}

const PLACES = [1, 2, 3, 4, 5, 6].map((n) => place(n));

function stop(n: number, placeN: number, over: Partial<Stop> = {}): Stop {
  return {
    id: `s${String(n).padStart(7, '0')}`,
    placeId: pid(placeN),
    stayMin: 60,
    fixedTime: null,
    note: '',
    ...over,
  };
}

function day(stops: Stop[] = [], lodging: string | null = null) {
  return { stops: f(stops), lodging: f(lodging), startTime: f('09:00') };
}

/** Day 2개, 후보 1(장소 3), Stop 2(장소 1·2). */
function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't000000001',
    title: f('강릉 2박'),
    startDate: f('2026-10-20'),
    endDate: f('2026-10-21'),
    origin: f<string | null>(pid(4)),
    candidates: f([pid(3)]),
    days: [day([stop(1, 1)], pid(5)), day([stop(2, 2)])],
    legModes: f<Record<string, 'car' | 'walk'>>({}),
    createdAt: T,
    deletedAt: null,
    ...over,
  };
}

function lib(trips: Trip[], places: Place[] = PLACES): unknown {
  return {
    ...emptyLibrary(),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    trips: Object.fromEntries(trips.map((t) => [t.id, t])),
  };
}

function messages(value: unknown): string[] {
  const r = safeParse(LibrarySchema, value);
  return r.success ? [] : r.issues.map((i) => i.message);
}

describe('TripId / TripStopId', () => {
  it('accepts 10 / 8 lowercase alphanumerics only', () => {
    expect(safeParse(TripId, 'abcdefghij').success).toBe(true);
    expect(safeParse(TripId, 'abcdefghi').success).toBe(false);
    expect(safeParse(TripId, 'ABCDEFGHIJ').success).toBe(false);
    expect(safeParse(TripStopId, 'abcd1234').success).toBe(true);
    expect(safeParse(TripStopId, 'abcd123').success).toBe(false);
    expect(safeParse(TripStopId, 'abcd12345').success).toBe(false);
  });
});

describe('daysBetween', () => {
  it('counts both ends, so the same day is 1', () => {
    expect(daysBetween('2026-10-20', '2026-10-20')).toBe(1);
    expect(daysBetween('2026-10-20', '2026-10-21')).toBe(2);
    expect(daysBetween('2026-10-01', '2026-10-30')).toBe(30);
  });

  it('is not shifted by month ends, leap days or the year boundary', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(4);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(3);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(4);
  });

  it('is zero or negative when start is after end', () => {
    expect(daysBetween('2026-10-21', '2026-10-20')).toBe(0);
    expect(daysBetween('2026-10-22', '2026-10-20')).toBe(-1);
  });
});

describe('Trip in LibrarySchema', () => {
  it('round-trips a valid trip through decode and encode', () => {
    const input = lib([trip()]);
    const decoded = safeParse(LibrarySchema, input);
    expect(decoded.success).toBe(true);
    if (decoded.success) {
      expect(Schema.encodeSync(LibrarySchema)(decoded.data)).toEqual(input);
    }
  });

  it('exposes the new limits', () => {
    expect(LIBRARY_LIMITS).toMatchObject({
      tripTitleChars: 60,
      tripMaxDays: 30,
      stopNoteChars: 500,
      stayMaxMin: 1440,
    });
  });

  it('rejects a trip whose key differs from its id', () => {
    const bad = { ...(lib([]) as object), trips: { WRONGKEY: trip() } };
    expect(messages(bad)).toContain('키와 id가 다릅니다: WRONGKEY');
  });

  it('rejects days.length that differs from the date span', () => {
    expect(messages(lib([trip({ days: [day()] })]))).toContain('Day 수가 기간과 다릅니다');
    expect(messages(lib([trip({ days: [day(), day(), day()] })]))).toContain(
      'Day 수가 기간과 다릅니다',
    );
  });

  it('rejects a place in both candidates and a stop', () => {
    const t = trip({ candidates: f([pid(1)]) });
    expect(messages(lib([t]))).toContain(`여행 안에서 장소가 중복됩니다: ${pid(1)}`);
  });

  it('rejects a place in two days, or twice in one list', () => {
    const twoDays = trip({ days: [day([stop(1, 1)]), day([stop(2, 1)])] });
    expect(messages(lib([twoDays]))).toContain(`여행 안에서 장소가 중복됩니다: ${pid(1)}`);
    const sameDay = trip({ days: [day([stop(1, 1), stop(2, 1)]), day()] });
    expect(messages(lib([sameDay]))).toContain(`여행 안에서 장소가 중복됩니다: ${pid(1)}`);
    const twoCandidates = trip({ candidates: f([pid(3), pid(3)]) });
    expect(messages(lib([twoCandidates]))).toContain(`여행 안에서 장소가 중복됩니다: ${pid(3)}`);
  });

  it('rejects unknown placeId, origin and lodging', () => {
    const missing = pid(9);
    expect(messages(lib([trip({ days: [day([stop(1, 9)]), day()] })]))).toContain(
      `없는 장소입니다: ${missing}`,
    );
    expect(messages(lib([trip({ candidates: f([missing]) })]))).toContain(
      `없는 장소입니다: ${missing}`,
    );
    expect(messages(lib([trip({ origin: f<string | null>(missing) })]))).toContain(
      `없는 장소입니다: ${missing}`,
    );
    expect(messages(lib([trip({ days: [day([stop(1, 1)], missing), day()] })]))).toContain(
      `없는 장소입니다: ${missing}`,
    );
  });

  it('rejects a duplicated stop id', () => {
    const dup = stop(1, 2, { id: stop(1, 1).id });
    const t = trip({ days: [day([stop(1, 1)]), day([dup])] });
    expect(messages(lib([t]))).toContain(`Stop id가 중복됩니다: ${stop(1, 1).id}`);
  });

  it('rejects malformed stop ids and place ids', () => {
    const t = trip({ days: [day([stop(1, 1, { id: 'short' })]), day()] });
    expect(safeParse(LibrarySchema, lib([t])).success).toBe(false);
    const p = trip({ candidates: f(['nope']) });
    expect(safeParse(LibrarySchema, lib([p])).success).toBe(false);
  });

  it('rejects spans over 30 days and start after end', () => {
    const long = trip({
      endDate: f('2026-11-19'), // 31일
      days: Array.from({ length: 31 }, () => day()),
    });
    expect(safeParse(LibrarySchema, lib([long])).success).toBe(false);
    const ok30 = trip({
      endDate: f('2026-11-18'), // 30일
      days: Array.from({ length: 30 }, () => day()),
    });
    expect(safeParse(LibrarySchema, lib([ok30])).success).toBe(true);
    const reversed = trip({ startDate: f('2026-10-21'), endDate: f('2026-10-20'), days: [] });
    expect(safeParse(LibrarySchema, lib([reversed])).success).toBe(false);
  });

  it('rejects titles that are empty or over 60 chars', () => {
    expect(safeParse(LibrarySchema, lib([trip({ title: f('') })])).success).toBe(false);
    expect(safeParse(LibrarySchema, lib([trip({ title: f('가'.repeat(61)) })])).success).toBe(
      false,
    );
    expect(safeParse(LibrarySchema, lib([trip({ title: f('가'.repeat(60)) })])).success).toBe(true);
  });

  it('accepts stayMin 0..1440 integers or null and rejects the rest', () => {
    const withStay = (stayMin: number | null) =>
      safeParse(LibrarySchema, lib([trip({ days: [day([stop(1, 1, { stayMin })]), day()] })]))
        .success;
    expect(withStay(0)).toBe(true);
    expect(withStay(1440)).toBe(true);
    expect(withStay(null)).toBe(true);
    expect(withStay(1441)).toBe(false);
    expect(withStay(-1)).toBe(false);
    expect(withStay(1.5)).toBe(false);
  });

  it('limits note to 500 chars and fixedTime to HH:mm', () => {
    const withStop = (over: Partial<Stop>) =>
      safeParse(LibrarySchema, lib([trip({ days: [day([stop(1, 1, over)]), day()] })])).success;
    expect(withStop({ note: 'a'.repeat(500) })).toBe(true);
    expect(withStop({ note: 'a'.repeat(501) })).toBe(false);
    expect(withStop({ fixedTime: '12:30' })).toBe(true);
    expect(withStop({ fixedTime: '24:00' })).toBe(false);
  });

  it('allows origin and lodging to also be candidates or stops', () => {
    const t = trip({
      origin: f<string | null>(pid(3)), // 후보와 같음
      days: [day([stop(1, 1)], pid(3)), day([stop(2, 2)], pid(1))], // 숙소가 후보·Stop과 같음
    });
    expect(messages(lib([t]))).toEqual([]);
  });

  it('allows references to tombstoned places', () => {
    const dead = [...PLACES.slice(0, 5), place(6, { deletedAt: T })];
    const t = trip({
      candidates: f([pid(6)]),
      origin: f<string | null>(pid(6)),
    });
    expect(messages(lib([t], dead))).toEqual([]);
  });

  it('rejects malformed legModes keys and values', () => {
    const key = `${pid(1)}>${pid(2)}`;
    expect(messages(lib([trip({ legModes: f({ [key]: 'walk' as const }) })]))).toEqual([]);
    expect(
      safeParse(LibrarySchema, lib([trip({ legModes: f<Record<string, 'car'>>({ nope: 'car' }) })]))
        .success,
    ).toBe(false);
    const badMode = trip({ legModes: f({ [key]: 'bike' }) as unknown as Trip['legModes'] });
    expect(safeParse(LibrarySchema, lib([badMode])).success).toBe(false);
  });

  it('accepts tombstoned trips (deletedAt set)', () => {
    expect(messages(lib([trip({ deletedAt: T })]))).toEqual([]);
  });
});
