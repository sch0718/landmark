import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  buildTripShareDoc,
  thinPaths,
  type BuildTripShareOptions,
  type ShareLegTime,
} from 'src/domain/share/build-trip-share';
import { buildShareDoc } from 'src/domain/share/build-share';
import { checkShareTrip } from 'src/domain/share/check-share-trip';
import { WALK_MAX_M } from 'src/domain/trips/geo';
import { dayLegs, type Leg } from 'src/domain/trips/query';
import { emptyLibrary, type Library, type Place } from 'src/schema/library';
import { ShareDocSchema, ShareDocV2Schema, type ShareDay } from 'src/schema/share';
import type { Stop, Trip } from 'src/schema/trip';
import { L_FOOD, makeLabel, makePlace, T0 } from '../../sections/library/fixtures';

const f = <V>(value: V) => ({ value, updatedAt: T0 });
const NOW = new Date('2026-10-16T05:00:00.000Z');
const opts: BuildTripShareOptions = {
  title: '강릉 2박 3일',
  includeMemo: true,
  includeCandidates: true,
  now: NOW,
};

// 장소 번호: 1 home, 2 A, 3 B, 4 H(숙소), 5 C(A와 같은 라벨), 6 D(후보), 7 E(다른 여행)
const pid = (n: number) => `place${String(n).padStart(5, '0')}`;
const [HOME, A, B, H, C, D, E] = [1, 2, 3, 4, 5, 6, 7].map(pid) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

function place(n: number, over: Parameters<typeof makePlace>[1] = {}): Place {
  // 서로 직선 5km 이상 떨어뜨려 이동 수단이 자동으로 car가 되게 한다.
  return { ...makePlace(n, over), lng: 128.9 + n * 0.1, lat: 37.7 };
}

function stop(n: number, placeN: number, over: Partial<Stop> = {}): Stop {
  return {
    id: `stop${String(n).padStart(4, '0')}`,
    placeId: pid(placeN),
    stayMin: 60,
    fixedTime: null,
    note: '',
    ...over,
  };
}

const day = (stops: Stop[], lodging: string | null, startTime = '09:00') => ({
  stops: f(stops),
  lodging: f(lodging),
  startTime: f(startTime),
});

const TRIP_ID = 'trip000001';
function makeTrip(over: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    title: f('강릉 여행'),
    startDate: f('2026-10-24'),
    endDate: f('2026-10-25'),
    origin: f<string | null>(HOME),
    candidates: f<string[]>([D]),
    days: [
      day([stop(1, 2, { note: '점심' }), stop(2, 3)], H),
      day([stop(3, 5, { stayMin: null, fixedTime: '14:00' })], H, '09:30'),
    ],
    legModes: f<Record<string, 'car' | 'walk'>>({
      [`${A}>${B}`]: 'walk',
      [`${E}>${A}`]: 'car', // 다른 여행의 장소가 낀 키는 빠진다
      [`${A}>${D}`]: 'car',
    }),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

function makeLib(
  tripOver: Partial<Trip> = {},
  placeOver: Record<number, Parameters<typeof makePlace>[1]> = {},
): Library {
  const places = [1, 2, 3, 4, 5, 6, 7].map((n) =>
    place(n, { name: n === 5 ? '장소 2' : `장소 ${n}`, ...placeOver[n] }),
  );
  return {
    ...emptyLibrary(),
    labels: { [L_FOOD]: makeLabel(L_FOOD, '맛집', 'red', 'utensils', 0) },
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    trips: { [TRIP_ID]: makeTrip(tripOver) },
  };
}

const routed = (leg: Leg): ShareLegTime => ({
  durationS: 600,
  distanceM: Math.round(leg.straightM),
  tollFare: null,
  status: 'routed',
  queriedAt: '2026-10-16T04:58:00.000Z',
  path: [
    [128.9, 37.7],
    [128.91, 37.71],
  ],
});

function build(lib: Library, over: Partial<BuildTripShareOptions> = {}, routeOf = routed) {
  const doc = buildTripShareDoc(lib, TRIP_ID, routeOf, { ...opts, ...over });
  if (doc === null) throw new Error('문서를 기대했어요');
  return doc;
}

describe('buildTripShareDoc', () => {
  it('orders places origin → stops → lodging → … → candidates, once each, without other trips', () => {
    const doc = build(makeLib());
    expect(doc.places.map((p) => p.id)).toEqual([HOME, A, B, H, C, D]);
    expect(doc.trips[0]!.originId).toBe(HOME);
    expect(doc.trips[0]!.candidateIds).toEqual([D]);
    expect(doc.title).toBe('강릉 2박 3일');
    expect(doc.trips[0]!.title).toBe('강릉 여행');
    expect(doc.createdAt).toBe(NOW.toISOString());
  });

  it('passes legs to routeOf in dayLegs order and uses them in the result', () => {
    const lib = makeLib();
    const seen: string[] = [];
    const doc = build(lib, {}, (leg) => {
      seen.push(`${leg.from.id}>${leg.to.id}`);
      return routed(leg);
    });
    const expected = [0, 1].flatMap((i) =>
      dayLegs(lib, lib.trips[TRIP_ID]!, i).map((l) => `${l.from.id}>${l.to.id}`),
    );
    expect(seen).toEqual(expected);
    const [d1, d2] = doc.trips[0]!.days;
    expect(d1!.legs.map((l) => `${l.from}>${l.to}`)).toEqual([
      `${HOME}>${A}`,
      `${A}>${B}`,
      `${B}>${H}`,
    ]);
    expect(d2!.legs.map((l) => `${l.from}>${l.to}`)).toEqual([`${H}>${C}`, `${C}>${H}`]);
    expect(d1!.lodgingId).toBe(H);
    expect(d2!.startTime).toBe('09:30');
  });

  it('uses the effective mode of dayLegs for legs, not the stored legModes value', () => {
    // A>B: 사람이 walk를 골랐고 직선 약 8.8km라 걷기 한도(WALK_MAX_M 50km) 안이므로 walk 그대로.
    // B>H: 사람이 walk를 골랐지만 H를 북쪽으로 약 89km 옮겨 한도를 넘으므로 car로 돌아온다.
    const base = makeLib({
      legModes: f<Record<string, 'car' | 'walk'>>({ [`${A}>${B}`]: 'walk', [`${B}>${H}`]: 'walk' }),
    });
    const lib: Library = {
      ...base,
      places: { ...base.places, [H]: { ...base.places[H]!, lat: 38.5 } },
    };
    const effective = dayLegs(lib, lib.trips[TRIP_ID]!, 0);
    expect(effective.find((l) => l.from.id === B && l.to.id === H)!.straightM).toBeGreaterThan(
      WALK_MAX_M,
    );

    const doc = build(lib);
    const legs = doc.trips[0]!.days[0]!.legs;
    expect(legs.find((l) => l.from === A && l.to === B)!.mode).toBe('walk');
    expect(legs.find((l) => l.from === B && l.to === H)!.mode).toBe('car');
    expect(legs.map((l) => l.mode)).toEqual(effective.map((l) => l.mode));
    // 사람이 고른 값은 legModes에 그대로 남는다.
    expect(doc.trips[0]!.legModes[`${B}>${H}`]).toBe('walk');
  });

  it('excludes candidates when includeCandidates is false', () => {
    const doc = build(makeLib(), { includeCandidates: false });
    expect(doc.trips[0]!.candidateIds).toEqual([]);
    expect(doc.places.map((p) => p.id)).toEqual([HOME, A, B, H, C]);
    expect(doc.trips[0]!.legModes).toEqual({ [`${A}>${B}`]: 'walk' });
  });

  it('keeps only legModes between included places', () => {
    const doc = build(makeLib());
    expect(doc.trips[0]!.legModes).toEqual({ [`${A}>${B}`]: 'walk', [`${A}>${D}`]: 'car' });
  });

  it('drops memo and review (not stop notes) when includeMemo is false', () => {
    const lib = makeLib({}, { 2: { memo: '메모', review: '맛있음' } });
    const withMemo = build(lib);
    expect(withMemo.places.find((p) => p.id === A)).toMatchObject({
      memo: '메모',
      review: '맛있음',
    });
    const without = build(lib, { includeMemo: false });
    const a = without.places.find((p) => p.id === A)!;
    expect('memo' in a).toBe(false);
    expect('review' in a).toBe(false);
    expect(without.trips[0]!.days[0]!.stops[0]!.note).toBe('점심');
  });

  it('omits note for empty stop memos and review for empty reviews', () => {
    const lib = makeLib({}, { 2: { review: '' } });
    const doc = build(lib);
    expect('note' in doc.trips[0]!.days[0]!.stops[1]!).toBe(false);
    expect('review' in doc.places.find((p) => p.id === A)!).toBe(false);
  });

  it('never gives review to the v1 builder', () => {
    const lib = makeLib({}, { 2: { review: '맛있음' } });
    const v1 = buildShareDoc(lib, [A], { title: 't', includeMemo: true, now: NOW });
    expect('review' in v1.places[0]!).toBe(false);
    expect(Schema.decodeUnknownExit(ShareDocSchema)(v1, { onExcessProperty: 'error' })._tag).toBe(
      'Success',
    );
  });

  it('includes only live labels used by included places', () => {
    const lib = makeLib({}, { 2: { labelIds: [L_FOOD] }, 7: { labelIds: [L_FOOD] } });
    expect(build(lib).labels.map((l) => l.id)).toEqual([L_FOOD]);
    expect(build(makeLib()).labels).toEqual([]);
  });

  it('turns a tombstoned origin into null and drops its leg', () => {
    const lib = makeLib({}, { 1: { deletedAt: T0 } });
    const doc = build(lib);
    expect(doc.trips[0]!.originId).toBeNull();
    expect(doc.trips[0]!.days[0]!.legs.map((l) => `${l.from}>${l.to}`)).toEqual([
      `${A}>${B}`,
      `${B}>${H}`,
    ]);
    expect(doc.places.map((p) => p.id)).toEqual([A, B, H, C, D]);
  });

  it('turns a tombstoned lodging into null for the day and the next day start', () => {
    const lib = makeLib({}, { 4: { deletedAt: T0 } });
    const doc = build(lib);
    const [d1, d2] = doc.trips[0]!.days;
    expect(d1!.lodgingId).toBeNull();
    expect(d2!.lodgingId).toBeNull();
    expect(d1!.legs).toHaveLength(2);
    expect(d2!.legs).toHaveLength(0);
    expect(checkShareTrip(doc)).toEqual([]);
  });

  it('drops tombstoned stops and reconnects legs', () => {
    const doc2 = build(makeLib({}, { 3: { deletedAt: T0 } }));
    expect(doc2.places.map((p) => p.id)).toEqual([HOME, A, H, C, D]);
    expect(doc2.trips[0]!.days[0]!.stops.map((s) => s.placeId)).toEqual([A]);
    expect(doc2.trips[0]!.days[0]!.legs.map((l) => `${l.from}>${l.to}`)).toEqual([
      `${HOME}>${A}`,
      `${A}>${H}`,
    ]);
    expect(doc2.trips[0]!.legModes).toEqual({ [`${A}>${D}`]: 'car' });
  });

  it('forces path [] and queriedAt null unless routed', () => {
    const doc = build(makeLib(), {}, (leg) => ({
      ...routed(leg),
      status: 'estimated',
    }));
    for (const d of doc.trips[0]!.days) {
      for (const l of d.legs) {
        expect(l.path).toEqual([]);
        expect(l.queriedAt).toBeNull();
      }
    }
    expect(
      Schema.decodeUnknownExit(ShareDocV2Schema)(doc, { onExcessProperty: 'error' })._tag,
    ).toBe('Success');
  });

  it('passes the schema and checkShareTrip', () => {
    for (const over of [{}, { includeCandidates: false }, { includeMemo: false }]) {
      const doc = build(makeLib({}, { 2: { memo: 'm', review: 'r', labelIds: [L_FOOD] } }), over);
      expect(
        Schema.decodeUnknownExit(ShareDocV2Schema)(doc, { onExcessProperty: 'error' })._tag,
      ).toBe('Success');
      expect(checkShareTrip(doc)).toEqual([]);
    }
  });

  it('returns null for a missing or deleted trip', () => {
    const lib = makeLib({ deletedAt: T0 });
    expect(buildTripShareDoc(lib, TRIP_ID, routed, opts)).toBeNull();
    expect(buildTripShareDoc(makeLib(), 'nope000000', routed, opts)).toBeNull();
  });

  it('thins paths to the document-wide limit', () => {
    const long = (leg: Leg): ShareLegTime => ({
      ...routed(leg),
      path: Array.from({ length: 500 }, (_, i): [number, number] => [128 + i / 1000, 37.5]),
    });
    const many = Array.from({ length: 90 }, (_, i) => 11 + i);
    const base = makeLib();
    const lib: Library = {
      ...base,
      places: {
        ...base.places,
        ...Object.fromEntries(many.map((n) => [pid(n), place(n)])),
      },
      trips: {
        [TRIP_ID]: makeTrip({
          origin: f<string | null>(null),
          candidates: f<string[]>([]),
          legModes: f<Record<string, 'car' | 'walk'>>({}),
          days: [
            day(
              many.map((n, i) => stop(i + 1, n)),
              null,
            ),
            day([], null),
          ],
        }),
      },
    };
    const doc = build(lib, {}, long);
    const paths = doc.trips[0]!.days.flatMap((d) => d.legs).map((l) => l.path.length);
    expect(paths).toHaveLength(89);
    expect(paths.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(40_000);
    expect(Math.max(...paths)).toBeLessThan(500);
    expect(checkShareTrip(doc)).toEqual([]);
  });
});

describe('thinPaths', () => {
  const line = (n: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [128 + i / 10_000, 37.5 + i / 10_000]);
  const mkDay = (...lens: number[]): ShareDay => ({
    startTime: '09:00',
    lodgingId: null,
    stops: [],
    legs: lens.map((n) => ({
      from: 'a',
      to: 'b',
      mode: 'car',
      durationS: 1,
      distanceM: 1,
      tollFare: null,
      status: 'routed',
      queriedAt: '2026-10-16T04:58:00.000Z',
      path: line(n),
    })),
  });

  it('thins proportionally to at most max, keeping each line end points, without mutating input', () => {
    const days = [mkDay(300, 300), mkDay(400)];
    const snapshot = JSON.stringify(days);
    const out = thinPaths(days, 500);
    expect(JSON.stringify(days)).toBe(snapshot);
    const lens = out.flatMap((d) => d.legs.map((l) => l.path.length));
    expect(lens.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(500);
    expect(lens).toEqual([150, 150, 200]);
    out
      .flatMap((d) => d.legs)
      .forEach((l, i) => {
        const src = days.flatMap((d) => d.legs)[i]!.path;
        expect(l.path[0]).toEqual(src[0]);
        expect(l.path.at(-1)).toEqual(src.at(-1));
        // 같은 선 위의 점들이 순서를 지킨다
        for (let k = 1; k < l.path.length; k++)
          expect(l.path[k]![0]).toBeGreaterThan(l.path[k - 1]![0]);
      });
  });

  it('returns the input unchanged when within max', () => {
    const days = [mkDay(300, 200)];
    expect(thinPaths(days, 500)).toBe(days);
  });

  it('stays within max when many short lines would hit the 2-point floor', () => {
    // 3점짜리 100개 + 500점짜리 2개(1,300점) → 400점. 같은 비율로 솎으면 짧은 선이 2점에 걸려 506점이 된다.
    const days = [mkDay(...Array.from({ length: 100 }, () => 3)), mkDay(500, 500)];
    const snapshot = JSON.stringify(days);
    const out = thinPaths(days, 400);
    expect(JSON.stringify(days)).toBe(snapshot);
    const src = days.flatMap((d) => d.legs.map((l) => l.path));
    const got = out.flatMap((d) => d.legs.map((l) => l.path));
    expect(got.reduce((a, p) => a + p.length, 0)).toBeLessThanOrEqual(400);
    got.forEach((path, i) => {
      expect(path.length).toBeGreaterThanOrEqual(2);
      expect(path[0]).toEqual(src[i]![0]);
      expect(path.at(-1)).toEqual(src[i]!.at(-1));
    });
    // 남는 점은 긴 선이 받는다.
    expect(got.at(-1)!.length).toBeGreaterThan(90);
  });

  it('keeps 2 points per line when max is below that floor', () => {
    const out = thinPaths([mkDay(10, 10, 10)], 4);
    expect(out[0]!.legs.map((l) => l.path.length)).toEqual([2, 2, 2]);
    const twos = [mkDay(2, 2, 1)];
    expect(thinPaths(twos, 4)).toBe(twos);
  });

  it('leaves empty and single-point lines alone', () => {
    const out = thinPaths([mkDay(0, 1, 1000)], 100);
    expect(out[0]!.legs.map((l) => l.path.length)).toEqual([0, 1, 99]);
  });
});

it('이모지는 장소 공유 v1과 여행 공유 v2에 넣지 않는다', () => {
  const lib = makeLib({}, { 2: { labelIds: [L_FOOD] } });
  const label = lib.labels[L_FOOD]!;
  const withEmoji = {
    ...lib,
    labels: { ...lib.labels, [L_FOOD]: { ...label, emoji: { value: '🍽️', updatedAt: T0 } } },
  };
  const v1 = buildShareDoc(withEmoji, [A], { title: '맛집', includeMemo: true, now: NOW });
  const v2 = build(withEmoji);
  for (const doc of [v1, v2]) {
    expect(doc.labels).toHaveLength(1);
    expect(doc.labels[0]).toEqual({ id: L_FOOD, name: '맛집', color: 'red', order: 0 });
    expect(JSON.stringify(doc)).not.toContain('emoji');
    expect(JSON.stringify(doc)).not.toContain('🍽️');
  }
});
