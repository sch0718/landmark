import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableCollabAsOwner, joinCollabAsOwner } from 'src/sections/trips/collab/owner-join';
import {
  collabEngineFor,
  resetCollabEngines,
  type CollabEngineDeps,
} from 'src/sections/trips/collab/collab-engine';
import { createTripCollabStore } from 'src/services/trip-collab/store';
import { createTripLiveStore } from 'src/services/trip-live/store';
import { tripLiveApi } from 'src/services/trip-live/client';
import { tripCollabApi } from 'src/services/trip-collab/client';
import {
  buildLiveTripDoc,
  ESTIMATE_ONLY,
  liveEditKey,
  livePlanKey,
} from 'src/domain/trip-live/build-live-doc';
import type { Library } from 'src/schema/library';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
beforeEach(() => localStorage.clear());
afterEach(() => {
  resetCollabEngines();
  vi.restoreAllMocks();
});
const routed = () => ({
  durationS: 600,
  distanceM: 1000,
  tollFare: null,
  status: 'routed' as const,
  queriedAt: '2026-10-30T00:00:00.000Z',
  path: [] as [number, number][],
});
async function setup(
  includeCandidates = true,
  routes?: { published: boolean; join: boolean; legacy?: boolean },
) {
  let lib: Library = buildLiveLibrary();
  if (!includeCandidates) {
    const trip = lib.trips.trip000001!;
    lib = {
      ...lib,
      places: {
        ...lib.places,
        local00003: {
          ...structuredClone(lib.places.place00001!),
          id: 'local00003',
          source: { kind: 'naver', sid: '3' },
        },
      },
      trips: {
        ...lib.trips,
        trip000001: {
          ...trip,
          candidates: { ...trip.candidates, value: ['local00003'] },
        },
      },
    };
  }
  if (routes) {
    const trip = lib.trips.trip000001!;
    lib = {
      ...lib,
      trips: {
        ...lib.trips,
        [trip.id]: { ...trip, origin: { ...trip.origin, value: 'place00002' } },
      },
    };
  }
  const doc = buildLiveTripDoc(lib, 'trip000001', routes?.published ? routed : ESTIMATE_ONLY, {
      title: '시험 여행',
      options: { includeMemo: false, includeCandidates },
      dayIds: buildLiveDoc().ids.days,
      createdAt: buildLiveDoc().share.createdAt,
    })!,
    store = createTripCollabStore(),
    liveStore = createTripLiveStore();
  const record = {
    tripId: 'trip000001',
    liveId: 'abcdefghij',
    status: 'live' as const,
    ownerToken: 'o'.repeat(43),
    viewToken: 'v'.repeat(43),
    rev: 1,
    dayIds: doc.ids.days,
    options: { title: '시험 여행', includeMemo: false, includeCandidates },
    createdAt: doc.share.createdAt,
    publishedKey: await liveEditKey(doc),
    ...(routes && !routes.legacy ? { planKey: await livePlanKey(doc) } : {}),
  };
  liveStore.put(record);
  const live = {
    rev: 1,
    updatedAt: doc.share.createdAt,
    expiresAt: '2026-12-31',
    role: 'owner' as const,
    doc,
    viewToken: record.viewToken,
    sourceTripId: record.tripId,
  };
  vi.spyOn(tripLiveApi, 'get').mockResolvedValue({ ok: true, value: live });
  vi.spyOn(tripLiveApi, 'update').mockResolvedValue({
    ok: true,
    value: { rev: 2, expiresAt: '2026-12-31' },
  });
  const deps: CollabEngineDeps = {
    tripId: record.tripId,
    api: {
      ...tripCollabApi,
      state: vi.fn(async () => ({
        ok: true as const,
        value: { ...live, deviceId: null, members: 0, editedBy: null },
      })),
      putDoc: vi.fn(async () => ({
        ok: true as const,
        value: { rev: 2, expiresAt: live.expiresAt },
      })),
    },
    store,
    liveStore,
    getLibrary: () => lib,
    run: async (op) => {
      const r = op(lib, { now: '2026-11-01T00:00:00.000Z', newId: () => 'newplace00' });
      if ('ok' in r) {
        if (!r.ok) return r;
        lib = r.lib;
      } else lib = r;
      return { ok: true };
    },
    now: () => new Date('2026-11-01T00:00:00.000Z'),
    newPlaceId: () => 'newplace00',
    routeOf: () => () => ({
      mode: 'car',
      time: routes?.join ? routed() : ESTIMATE_ONLY({} as never),
    }),
    reportError: vi.fn(),
  };
  const change = (index: number, time: string) => {
    const trip = lib.trips[record.tripId]!;
    lib = {
      ...lib,
      trips: {
        ...lib.trips,
        [trip.id]: {
          ...trip,
          days: trip.days.map((day, i) =>
            i === index ? { ...day, startTime: { ...day.startTime, value: time } } : day,
          ),
        },
      },
    };
  };
  return { deps, store, record, live, change };
}
describe('소유자 공동 편집 합류', () => {
  it('v1은 v2로 올리고 연결 기록·기준을 만든다', async () => {
    const s = await setup();
    expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: true });
    expect(s.deps.api.putDoc).toHaveBeenCalledWith(
      'abcdefghij',
      s.record.ownerToken,
      expect.objectContaining({ v: 2 }),
      1,
    );
    expect(s.store.get(s.record.tripId)).toMatchObject({ role: 'owner', rev: 2, token: null });
    expect(s.store.readBase('abcdefghij')?.rev).toBe(2);
  });
  it('켜기 중 revision 경합이 반복되면 기록과 기준을 남기고 다시 시도한다', async () => {
    const s = await setup();
    vi.mocked(s.deps.api.putDoc).mockResolvedValue({ ok: false, error: 'conflict', rev: 3 });
    expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: false, error: 'unavailable' });
    expect(s.store.list()).toHaveLength(1);
    expect(s.deps.api.putDoc).toHaveBeenCalledTimes(3);
  });
  it('v2면 새로 올리지 않고 소유자로 합류한다', async () => {
    const s = await setup();
    s.live.doc.v = 2;
    expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: true });
    expect(tripLiveApi.update).not.toHaveBeenCalled();
    expect(s.store.get(s.record.tripId)?.role).toBe('owner');
  });
  it('받은 판이 마지막 공개본이면 미공개 수정이 있어도 서버 판을 기준으로 쓴다', async () => {
    const s = await setup();
    await joinCollabAsOwner(s.deps, s.live);
    expect(s.store.readBase('abcdefghij')).not.toBeNull();
    s.store.remove(s.record.tripId);
    s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
    s.change(1, '11:00');
    await joinCollabAsOwner(s.deps, s.live);
    expect(s.store.readBase('abcdefghij')).toBeNull();
  });
});
it('켜기 전에 다른 소유자가 올린 2A 변경은 비교로 보내고 덮지 않는다', async () => {
  const s = await setup();
  s.live.rev = 3;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  s.change(1, '11:00');
  expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: false, error: 'conflict' });
  expect(tripLiveApi.update).not.toHaveBeenCalled();
  expect(s.deps.api.putDoc).not.toHaveBeenCalled();
  expect(collabEngineFor(s.record.tripId, () => s.deps).getSnapshot().state).toBe('conflict');
  expect(s.deps.getLibrary().trips.trip000001!.days[0]!.startTime.value).toBe('09:00');
});
it('깨끗한 다른 소유자는 다시 만든 공개본을 기준으로 서버 변경을 받는다', async () => {
  const s = await setup();
  s.live.doc.v = 2;
  s.live.rev = 3;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  await joinCollabAsOwner(s.deps, s.live);
  expect(s.store.readBase(s.record.liveId)?.plan.days[0]?.startTime).toBe('09:00');
  expect(s.deps.getLibrary().trips.trip000001!.days[0]!.startTime.value).toBe('09:00');
});

it('확인된 마지막 2A 공개본을 기준으로 미공개 로컬 수정을 병합해 v2로 올린다', async () => {
  const s = await setup();
  s.change(1, '11:00');
  expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: true });
  const doc = vi.mocked(s.deps.api.putDoc).mock.calls[0]![2];
  expect(doc.v).toBe(2);
  expect(doc.share.trips[0]!.days.map((day) => day.startTime)).toEqual(['09:00', '11:00']);
});
it('미공개 수정이 있는 다른 소유자는 서버 변경을 비교하고 보관함에 보존한다', async () => {
  const s = await setup();
  s.change(1, '11:00');
  s.live.doc.v = 2;
  s.live.rev = 3;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  await joinCollabAsOwner(s.deps, s.live);
  const engine = collabEngineFor(s.record.tripId, () => s.deps);
  await engine.sync();
  expect(engine.getSnapshot().state).toBe('conflict');
  expect(s.deps.api.putDoc).not.toHaveBeenCalled();
  expect(s.deps.getLibrary().trips.trip000001!.days[0]!.startTime.value).toBe('09:00');
  await engine.resolve({ 'day.0.startTime': 'mine', 'day.1.startTime': 'mine' });
  expect(engine.getSnapshot().state).toBe('synced');
  expect(s.deps.getLibrary().trips.trip000001!.days[0]!.startTime.value).toBe('09:00');
});

it.each([1, 2] as const)(
  '손대지 않은 B는 제목·두 Day가 바뀐 v%s에 겹침 없이 합류한다',
  async (v) => {
    const s = await setup();
    s.live.doc.v = v;
    s.live.rev = 5;
    s.live.doc.share.title = '바뀐 제목';
    s.live.doc.share.trips[0]!.title = '바뀐 제목';
    s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
    s.live.doc.share.trips[0]!.days[1]!.startTime = '08:30';
    expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: true });
    const engine = collabEngineFor(s.record.tripId, () => s.deps);
    expect(engine.getSnapshot()).toMatchObject({ state: 'synced', merge: null });
    const trip = s.deps.getLibrary().trips.trip000001!;
    expect(trip.title.value).toBe('바뀐 제목');
    expect(trip.days.map((d) => d.startTime.value)).toEqual(['07:00', '08:30']);
    if (v === 2) expect(s.deps.api.putDoc).not.toHaveBeenCalled();
  },
);
it('후보를 뺀 공개 문서만 서버 id로 바꾸어 기준으로 삼고 숨긴 후보는 로컬 변경으로 남긴다', async () => {
  const s = await setup(false);
  s.live.doc = JSON.parse(JSON.stringify(s.live.doc).replaceAll('place00001', 'server0001'));
  s.live.doc.ids.days = ['srvday01', 'srvday02'];
  s.live.doc.v = 2;
  s.live.rev = 5;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  await joinCollabAsOwner(s.deps, s.live);
  expect(s.store.readBase(s.record.liveId)?.plan).toMatchObject({
    candidates: [],
    days: [{ id: 'srvday01', stops: [{ placeId: 'server0001' }] }, { id: 'srvday02' }],
  });
  const engine = collabEngineFor(s.record.tripId, () => s.deps);
  await engine.sync();
  expect(engine.getSnapshot().state).toBe('synced');
  expect(s.deps.getLibrary().trips.trip000001!.candidates.value).toEqual(['local00003']);
  expect(vi.mocked(s.deps.api.putDoc).mock.calls[0]![2].share.trips[0]!.candidateIds).toEqual([
    'local00003',
  ]);
});

it.each([
  [true, true],
  [true, false],
  [false, true],
])('공개·합류 경로 상태가 같거나 달라도 기준을 쓰고 맞춘다 %s/%s', async (published, join) => {
  const s = await setup(true, { published, join });
  expect(s.live.doc.share.trips[0]!.days[0]!.legs).toHaveLength(1);
  s.live.doc.v = 2;
  s.live.rev = 5;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  s.live.doc.share.trips[0]!.days[1]!.startTime = '08:30';
  await joinCollabAsOwner(s.deps, s.live);
  expect(s.store.readBase(s.record.liveId)?.plan.days.map((d) => d.startTime)).toEqual([
    '09:00',
    '09:00',
  ]);
  const engine = collabEngineFor(s.record.tripId, () => s.deps);
  await engine.sync();
  expect(engine.getSnapshot()).toMatchObject({ state: 'synced', merge: null });
  expect(s.deps.getLibrary().trips.trip000001!.days.map((d) => d.startTime.value)).toEqual([
    '07:00',
    '08:30',
  ]);
});
it.each([
  [true, true],
  [false, true],
  [false, false],
])('옛 기록도 현재 또는 추정 지문이 맞으면 기준을 쓴다 %s/%s', async (published, join) => {
  const s = await setup(true, { published, join, legacy: true });
  s.live.doc.v = 2;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  await joinCollabAsOwner(s.deps, s.live);
  expect(s.store.readBase(s.record.liveId)).not.toBeNull();
  const engine = collabEngineFor(s.record.tripId, () => s.deps);
  await engine.sync();
  expect(engine.getSnapshot().state).toBe('synced');
});
it.each([false, true])(
  '경로 상태가 달라도 미공개 수정은 비교로 보존한다(옛 기록=%s)',
  async (legacy) => {
    const s = await setup(true, { published: false, join: true, legacy });
    s.change(1, '11:00');
    s.live.doc.v = 2;
    s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
    await joinCollabAsOwner(s.deps, s.live);
    expect(s.store.readBase(s.record.liveId)).toBeNull();
    const engine = collabEngineFor(s.record.tripId, () => s.deps);
    await engine.sync();
    expect(engine.getSnapshot().state).toBe('conflict');
    expect(s.deps.api.putDoc).not.toHaveBeenCalled();
    expect(s.deps.getLibrary().trips.trip000001!.days[1]!.startTime.value).toBe('11:00');
  },
);

it('옛 기록의 두 지문이 모두 다르면 기준을 추측하지 않고 비교한다', async () => {
  const s = await setup(true, { published: true, join: false, legacy: true });
  s.live.doc.v = 2;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  await joinCollabAsOwner(s.deps, s.live);
  expect(s.store.readBase(s.record.liveId)).toBeNull();
  const engine = collabEngineFor(s.record.tripId, () => s.deps);
  await engine.sync();
  expect(engine.getSnapshot().state).toBe('conflict');
  expect(s.deps.api.putDoc).not.toHaveBeenCalled();
});
it('경로 상태가 다른 깨끗한 기기는 켜기에서도 최신 2A 변경을 받아 v2로 올린다', async () => {
  const s = await setup(true, { published: true, join: false });
  s.live.rev = 5;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: true });
  expect(collabEngineFor(s.record.tripId, () => s.deps).getSnapshot().state).toBe('synced');
  expect(vi.mocked(s.deps.api.putDoc).mock.calls[0]![2]).toMatchObject({ v: 2 });
  expect(s.deps.getLibrary().trips.trip000001!.days[0]!.startTime.value).toBe('07:00');
});
