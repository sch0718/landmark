import { describe, expect, it } from 'vitest';
import {
  importSharedTrip,
  receivedTripTitle,
  RECEIVED_TRIP_TITLE,
  sameTripExists,
} from 'src/domain/library/import-share-trip';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { safeParse } from 'src/schema/parse';
import { emptyLibrary, LibrarySchema, type Library, type Place } from 'src/schema/library';
import type { ShareDocV2 } from 'src/schema/share';
import type { Trip } from 'src/schema/trip';
import { IDS, makeShareV2Doc } from '../../helpers/share-v2-doc';

const T0 = '2026-10-08T01:00:00.000Z';
const NOW = '2026-10-17T02:00:00.000Z';
const f = <V>(value: V, updatedAt = T0) => ({ value, updatedAt });

function makeCtx(): OpCtx {
  let seq = 0;
  return {
    now: NOW,
    newId: (kind) => {
      const n = String(seq++);
      if (kind === 'place') return `np${n.padStart(8, '0')}`;
      if (kind === 'trip') return `nt${n.padStart(8, '0')}`;
      if (kind === 'stop') return `ns${n.padStart(6, '0')}`;
      return `nl${n.padStart(6, '0')}`;
    },
  };
}

const INPUT: { titleLabel: string | null; appendMemo: boolean } = {
  titleLabel: null,
  appendMemo: true,
};

type Ok = Extract<OpResult, { ok: true }>;
function ok(r: OpResult): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${r.error._tag}`);
  return r;
}

/** 모든 결과 문서가 `LibrarySchema`를 통과하는지 함께 확인한다. */
function run(lib: Library, doc: ShareDocV2, ctx: OpCtx = makeCtx(), input = INPUT): Ok {
  const r = ok(importSharedTrip(lib, doc, input, ctx));
  expect(safeParse(LibrarySchema, r.lib).success).toBe(true);
  return r;
}

const tripOf = (r: Ok): Trip => r.lib.trips[r.createdId!]!;
const idByName = (lib: Library, name: string) =>
  Object.values(lib.places).find((p) => p.name.value === name)!.id;

/** 받은 문서의 장소 하나를 고친 복사본. */
function withPlace(doc: ShareDocV2, id: string, over: Partial<ShareDocV2['places'][number]>) {
  return { ...doc, places: doc.places.map((p) => (p.id === id ? { ...p, ...over } : p)) };
}

function withTrip(doc: ShareDocV2, over: Partial<ShareDocV2['trips'][number]>): ShareDocV2 {
  return { ...doc, trips: [{ ...doc.trips[0]!, ...over }] };
}

function myPlace(id: string, name: string, over: Partial<Place> = {}): Place {
  return {
    id,
    source: { kind: 'pin' },
    name: f(name),
    address: '내 주소',
    lng: 128.9,
    lat: 37.7,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

describe('importSharedTrip', () => {
  it('imports every place and creates one trip with mapped ids', () => {
    const doc = makeShareV2Doc();
    const r = run(emptyLibrary(), doc);
    expect(r.summary).toEqual({ created: 6, merged: 0, restored: 0 });
    expect(Object.keys(r.lib.places)).toHaveLength(6);
    expect(Object.keys(r.lib.trips)).toEqual([r.createdId]);
    expect(r.createdId).toMatch(/^nt\d{8}$/);

    const id = (n: string) => idByName(r.lib, doc.places.find((p) => p.id === n)!.name);
    const trip = tripOf(r);
    expect(trip.id).toBe(r.createdId);
    expect(trip.title.value).toBe('강릉 1박 2일');
    expect(trip.startDate.value).toBe('2026-10-24');
    expect(trip.endDate.value).toBe('2026-10-25');
    expect(trip.origin.value).toBe(id(IDS.home));
    expect(trip.candidates.value).toEqual([id(IDS.d)]);
    expect(trip.legModes.value).toEqual({ [`${id(IDS.a)}>${id(IDS.b)}`]: 'walk' });

    const [d1, d2] = trip.days;
    expect(d1!.startTime.value).toBe('09:00');
    expect(d1!.lodging.value).toBe(id(IDS.hotel));
    expect(d1!.stops.value.map((s) => s.placeId)).toEqual([id(IDS.a), id(IDS.b)]);
    expect(d1!.stops.value.map((s) => s.stayMin)).toEqual([60, null]);
    expect(d1!.stops.value.map((s) => s.fixedTime)).toEqual([null, '12:00']);
    expect(d1!.stops.value.map((s) => s.note)).toEqual(['', '점심']);
    expect(d2!.startTime.value).toBe('09:30');
    expect(d2!.lodging.value).toBeNull();
    expect(d2!.stops.value.map((s) => s.placeId)).toEqual([id(IDS.c)]);
    const stopIds = trip.days.flatMap((d) => d.stops.value.map((s) => s.id));
    expect(stopIds).toHaveLength(3);
    for (const sid of stopIds) expect(sid).toMatch(/^ns\d{6}$/);
  });

  it('stamps every field and createdAt with ctx.now', () => {
    const trip = tripOf(run(emptyLibrary(), makeShareV2Doc()));
    expect(trip.createdAt).toBe(NOW);
    expect(trip.deletedAt).toBeNull();
    for (const fld of [
      trip.title,
      trip.startDate,
      trip.endDate,
      trip.origin,
      trip.candidates,
      trip.legModes,
    ]) {
      expect(fld.updatedAt).toBe(NOW);
    }
    for (const day of trip.days) {
      for (const fld of [day.stops, day.lodging, day.startTime]) expect(fld.updatedAt).toBe(NOW);
    }
  });

  it('keeps null origin and lodging as null', () => {
    const doc = withTrip(makeShareV2Doc(), { originId: null });
    const trip = tripOf(run(emptyLibrary(), doc));
    expect(trip.origin.value).toBeNull();
    expect(trip.days[1]!.lodging.value).toBeNull();
  });

  it('continues onto my existing place with the same source id', () => {
    const doc = withPlace(makeShareV2Doc(), IDS.a, { naverSid: '111' });
    const mine = myPlace('mine000001', '내가 부르는 이름', {
      source: { kind: 'naver', sid: '111' },
    });
    const before: Library = { ...emptyLibrary(), places: { [mine.id]: mine } };
    const r = run(before, doc);
    expect(r.summary).toEqual({ created: 5, merged: 1, restored: 0 });
    expect(Object.keys(r.lib.places)).toHaveLength(6);
    expect(tripOf(r).days[0]!.stops.value[0]!.placeId).toBe('mine000001');
  });

  it('keeps only the first stop when two received pins merge into one place', () => {
    const base = makeShareV2Doc();
    // 장소 3(B)을 장소 2(A)와 같은 이름·같은 위치로 만든다 → 내 장소 하나.
    const a = base.places.find((p) => p.id === IDS.a)!;
    const doc = withTrip(
      {
        ...withPlace(base, IDS.b, { name: a.name, lng: a.lng, lat: a.lat }),
      },
      {
        // 후보에도 B를 넣어 본다.
        candidateIds: [IDS.b, IDS.d],
        legModes: {},
      },
    );
    // Day 2 Stop도 B로 바꿔 Day 1 Stop과 겹치게 한다.
    doc.trips[0]!.days[1]!.stops = [{ placeId: IDS.b, stayMin: 30, fixedTime: null }];
    const r = run(emptyLibrary(), doc);
    expect(Object.keys(r.lib.places)).toHaveLength(5);
    // 결과 장소마다 한 번만 센다.
    expect(r.summary).toEqual({ created: 5, merged: 0, restored: 0 });
    const trip = tripOf(r);
    const aId = idByName(r.lib, a.name);
    expect(trip.days[0]!.stops.value.map((s) => s.placeId)).toEqual([aId]);
    expect(trip.days[1]!.stops.value).toEqual([]);
    expect(trip.candidates.value).toEqual([
      idByName(r.lib, base.places.find((p) => p.id === IDS.d)!.name),
    ]);
  });

  it('drops a duplicate candidate that repeats an earlier candidate or a stop', () => {
    const doc = withTrip(makeShareV2Doc(), { candidateIds: [IDS.d, IDS.d, IDS.a] });
    const trip = tripOf(run(emptyLibrary(), doc));
    expect(trip.candidates.value).toHaveLength(1);
  });

  it('keeps the origin even when it is the same place as a Day 1 stop', () => {
    const doc = withTrip(makeShareV2Doc(), { originId: IDS.a });
    const trip = tripOf(run(emptyLibrary(), doc));
    expect(trip.origin.value).toBe(trip.days[0]!.stops.value[0]!.placeId);
  });

  it('drops legModes whose ends became the same place and keeps the first of colliding keys', () => {
    const base = makeShareV2Doc();
    const a = base.places.find((p) => p.id === IDS.a)!;
    const doc = withTrip(withPlace(base, IDS.b, { name: a.name, lng: a.lng, lat: a.lat }), {
      legModes: {
        [`${IDS.a}>${IDS.b}`]: 'walk', // 같아져 빠진다
        [`${IDS.a}>${IDS.c}`]: 'walk',
        [`${IDS.b}>${IDS.c}`]: 'car', // 위 키와 같은 키가 된다 → 첫 것을 남긴다
      },
    });
    const trip = tripOf(run(emptyLibrary(), doc));
    const lm = trip.legModes.value;
    expect(Object.values(lm)).toEqual(['walk']);
  });

  it('cuts and defaults the title', () => {
    expect(receivedTripTitle('  ')).toBe(RECEIVED_TRIP_TITLE);
    expect(receivedTripTitle('  가나  ')).toBe('가나');
    expect(receivedTripTitle('가'.repeat(61))).toBe('가'.repeat(60));
    const trip = tripOf(run(emptyLibrary(), withTrip(makeShareV2Doc(), { title: '  ' })));
    expect(trip.title.value).toBe('받은 여행');
    const long = tripOf(
      run(emptyLibrary(), withTrip(makeShareV2Doc(), { title: '가'.repeat(61) })),
    );
    expect(long.title.value).toHaveLength(60);
  });

  it('importing the same doc twice makes two trips and no new places', () => {
    const doc = makeShareV2Doc();
    const first = run(emptyLibrary(), doc);
    const second = run(first.lib, doc);
    expect(Object.keys(second.lib.trips)).toHaveLength(2);
    expect(Object.keys(second.lib.places)).toHaveLength(6);
    expect(second.summary).toEqual({ created: 0, merged: 6, restored: 0 });
    expect(second.createdId).not.toBe(first.createdId);
  });

  it('adds a title label to the places when asked', () => {
    const r = run(emptyLibrary(), makeShareV2Doc(), makeCtx(), {
      titleLabel: '강릉',
      appendMemo: true,
    });
    expect(Object.values(r.lib.labels).map((l) => l.name.value)).toEqual(['강릉']);
    for (const p of Object.values(r.lib.places)) expect(p.labelIds.value).toHaveLength(1);
  });

  it('does not change the input library', () => {
    const before = emptyLibrary();
    const snapshot = JSON.stringify(before);
    run(before, makeShareV2Doc());
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('returns a failure instead of an invalid library when the trip cannot be valid', () => {
    const doc = withTrip(makeShareV2Doc(), { endDate: '2026-10-20' });
    const r = importSharedTrip(emptyLibrary(), doc, INPUT, makeCtx());
    expect(r).toEqual({ ok: false, error: { _tag: 'TripDatesInvalid', reason: 'order' } });
  });
});

describe('sameTripExists', () => {
  const trip = makeShareV2Doc().trips[0]!;
  const mine = (over: Partial<Trip> = {}): Library => ({
    ...emptyLibrary(),
    trips: {
      mine000001: {
        id: 'mine000001',
        title: f('강릉 1박 2일'),
        startDate: f('2026-10-24'),
        endDate: f('2026-10-25'),
        origin: f<string | null>(null),
        candidates: f<string[]>([]),
        days: [],
        legModes: f<Record<string, 'car' | 'walk'>>({}),
        createdAt: T0,
        deletedAt: null,
        ...over,
      },
    },
  });

  it('matches normalized title with the same period', () => {
    expect(sameTripExists(mine(), { ...trip, title: ' 강릉  1박   2일 ' })).toBe(true);
  });

  it('is false when the period differs', () => {
    expect(sameTripExists(mine({ endDate: f('2026-10-26') }), trip)).toBe(false);
  });

  it('is false for a deleted trip', () => {
    expect(sameTripExists(mine({ deletedAt: NOW }), trip)).toBe(false);
  });
});
