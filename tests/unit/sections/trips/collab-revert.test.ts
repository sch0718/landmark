import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CollabEngine,
  resetCollabEngines,
  type CollabEngineDeps,
} from 'src/sections/trips/collab/collab-engine';
import { createTripCollabStore, type TripCollabRecord } from 'src/services/trip-collab/store';
import { tripCollabApi } from 'src/services/trip-collab/client';
import { createTripLiveStore } from 'src/services/trip-live/store';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import { ESTIMATE_ONLY } from 'src/domain/trip-live/build-live-doc';
import type { LiveTripDoc } from 'src/domain/trip-live/live-doc';
import type { Library } from 'src/schema/library';
import { buildLiveDoc } from '../../../fixtures/live-trip';
import { buildLiveLibrary } from '../../../fixtures/builders';
beforeEach(() => {
  localStorage.clear();
  resetCollabEngines();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  resetCollabEngines();
  vi.useRealTimers();
});
it('반영 뒤 409 재시도에서도 다른 기기의 되돌림을 보존한다', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
  let lib: Library = buildLiveLibrary();
  const original: LiveTripDoc = { ...buildLiveDoc(), v: 2 as const };
  let serverDoc: LiveTripDoc = structuredClone(original);
  let serverRev = 2;
  const record: TripCollabRecord = {
    tripId: 'trip000001',
    liveId: 'abcdefghij',
    role: 'editor',
    token: 'e'.repeat(43),
    deviceId: 'device01',
    label: '내 폰',
    status: 'live',
    rev: 2,
    prev: 0,
    dayIds: [...serverDoc.ids.days],
    placeMap: { place00001: 'place00001', place00002: 'place00002' },
    syncedAt: new Date().toISOString(),
    title: '시험 여행',
    pendingProgress: [],
  };
  const store = createTripCollabStore();
  store.put(record);
  store.writeBase(record.liveId, { rev: 2, plan: planFromDoc(serverDoc), progress: null });
  // 다른 기기: rev3 에서 Day1 출발을 07:00 으로, rev4 에서 다시 09:00 으로 되돌림
  const t1 = structuredClone(original);
  t1.share.trips[0]!.days[0]!.startTime = '07:00';
  serverDoc = t1;
  serverRev = 3;
  let firstPut = true;
  const api = {
    ...tripCollabApi,
    state: vi.fn(async () => ({
      ok: true as const,
      value: {
        rev: serverRev,
        updatedAt: '',
        expiresAt: '2026-12-31',
        role: 'editor' as const,
        deviceId: 'device01',
        members: 1,
        editedBy: null,
        doc: structuredClone(serverDoc),
        progress: { prev: 0, marks: [], next: null },
      },
    })),
    putDoc: vi.fn(async (_i: string, _t: string, doc: LiveTripDoc, baseRev: number) => {
      if (firstPut) {
        firstPut = false;
        serverDoc = structuredClone(original);
        serverRev = 4;
      }
      if (baseRev !== serverRev)
        return { ok: false as const, error: 'conflict' as const, rev: serverRev };
      serverDoc = structuredClone(doc);
      serverRev++;
      return { ok: true as const, value: { rev: serverRev, expiresAt: '2026-12-31' } };
    }),
  };
  const run: CollabEngineDeps['run'] = async (op) => {
    const r = op(lib, {
      now: new Date().toISOString(),
      newId: (k: string) => (k === 'stop' ? 'newstop0' : 'newplace00'),
    });
    if ('ok' in r) {
      if (!r.ok) return r;
      lib = r.lib;
    } else lib = r;
    return { ok: true };
  };
  const engine = new CollabEngine({
    tripId: record.tripId,
    api: api as never,
    store,
    liveStore: createTripLiveStore(),
    getLibrary: () => lib,
    run,
    routeOf: () => () => ({ mode: 'car', time: ESTIMATE_ONLY({} as never) }),
    now: () => new Date(),
    newPlaceId: () => 'newplace00',
    locks: null,
    win: window,
    reportError: vi.fn(),
  });
  const trip = lib.trips.trip000001!;
  lib = {
    ...lib,
    trips: {
      ...lib.trips,
      [trip.id]: {
        ...trip,
        days: trip.days.map((d, i) =>
          i === 1
            ? { ...d, startTime: { value: '11:00', updatedAt: new Date().toISOString() } }
            : d,
        ),
      },
    },
  };
  await engine.sync();
  expect(serverDoc.share.trips[0]!.days[0]!.startTime).toBe('09:00');
});
