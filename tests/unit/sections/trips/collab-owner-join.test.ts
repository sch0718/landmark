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
import { ESTIMATE_ONLY, liveEditKey } from 'src/domain/trip-live/build-live-doc';
import type { Library } from 'src/schema/library';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
beforeEach(() => localStorage.clear());
afterEach(() => {
  resetCollabEngines();
  vi.restoreAllMocks();
});
async function setup() {
  let lib: Library = buildLiveLibrary();
  const doc = buildLiveDoc(),
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
    options: { title: '시험 여행', includeMemo: false, includeCandidates: true },
    createdAt: doc.share.createdAt,
    publishedKey: await liveEditKey(doc),
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
    routeOf: () => () => ({ mode: 'car', time: ESTIMATE_ONLY({} as never) }),
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
  it('마지막 공개 지문이 받은 판과 같을 때만 그 서버 판을 기준으로 쓴다', async () => {
    const s = await setup();
    await joinCollabAsOwner(s.deps, s.live);
    expect(s.store.readBase('abcdefghij')).not.toBeNull();
    s.store.remove(s.record.tripId);
    s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
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
it('깨끗한 다른 소유자도 서버와 다른 자기 공개본을 기준으로 삼지 않는다', async () => {
  const s = await setup();
  s.live.doc.v = 2;
  s.live.rev = 3;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  await joinCollabAsOwner(s.deps, s.live);
  expect(s.store.readBase(s.record.liveId)).toBeNull();
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
it('다른 소유자 합류도 서버와 다른 공개 변경을 비교하고 보관함에 보존한다', async () => {
  const s = await setup();
  s.live.doc.v = 2;
  s.live.rev = 3;
  s.live.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  await joinCollabAsOwner(s.deps, s.live);
  const engine = collabEngineFor(s.record.tripId, () => s.deps);
  await engine.sync();
  expect(engine.getSnapshot().state).toBe('conflict');
  expect(s.deps.api.putDoc).not.toHaveBeenCalled();
  expect(s.deps.getLibrary().trips.trip000001!.days[0]!.startTime.value).toBe('09:00');
  await engine.resolve({ 'day.0.startTime': 'mine' });
  expect(engine.getSnapshot().state).toBe('synced');
  expect(s.deps.getLibrary().trips.trip000001!.days[0]!.startTime.value).toBe('09:00');
});
