import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CollabEngine,
  resetCollabEngines,
  type CollabEngineDeps,
} from 'src/sections/trips/collab/collab-engine';
import { createTripCollabStore, type TripCollabRecord } from 'src/services/trip-collab/store';
import { tripCollabApi, type CollabState } from 'src/services/trip-collab/client';
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
it('계획·당일 두 탭이 저장소를 공유해도 다른 탭의 공개 변경을 보존한다', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
  let lib: Library = buildLiveLibrary();
  let serverDoc: LiveTripDoc = { ...buildLiveDoc(), v: 2 as const };
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
  const storeA = createTripCollabStore(),
    storeB = createTripCollabStore();
  storeA.put(record);
  storeA.writeBase(record.liveId, { rev: 2, plan: planFromDoc(serverDoc), progress: null });
  const calls: string[] = [];
  const api = {
    ...tripCollabApi,
    state: vi.fn(
      async (_id: string, _t: string, since: { rev: number | null; prev: number | null }) => {
        calls.push(`state rev=${since.rev}`);
        if (since.rev === serverRev && since.prev === 0)
          return { ok: true as const, value: 'unchanged' as const };
        const value: CollabState = {
          rev: serverRev,
          updatedAt: '',
          expiresAt: '2026-12-31',
          role: 'editor',
          deviceId: 'device01',
          members: 1,
          editedBy: null,
          doc: structuredClone(serverDoc),
          progress: { prev: 0, marks: [], next: null },
        };
        return { ok: true as const, value };
      },
    ),
    putDoc: vi.fn(async (_id: string, _t: string, doc: LiveTripDoc, baseRev: number) => {
      calls.push(`put base=${baseRev} server=${serverRev}`);
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
  const deps = (store: ReturnType<typeof createTripCollabStore>): CollabEngineDeps => ({
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
  const change = (day: number, time: string) => {
    const trip = lib.trips.trip000001!;
    lib = {
      ...lib,
      trips: {
        ...lib.trips,
        [trip.id]: {
          ...trip,
          days: trip.days.map((d, i) =>
            i === day
              ? { ...d, startTime: { value: time, updatedAt: new Date().toISOString() } }
              : d,
          ),
        },
      },
    };
  };
  const tabA = new CollabEngine(deps(storeA)),
    tabB = new CollabEngine(deps(storeB));
  await tabB.sync(); // 탭 B가 rev 2 문서를 메모리에 든다
  change(0, '10:00'); // 탭 A에서 Day 1 출발 시각
  await tabA.sync(); // rev 3 으로 올림, 기록 rev=3·기준=plan3 (공용 localStorage)
  expect(serverDoc.share.trips[0]!.days[0]!.startTime).toBe('10:00');
  change(1, '11:00'); // 아직 올리지 않은 다른 변경(공용 보관함)
  vi.advanceTimersByTime(20_000);
  await tabB.sync(); // 탭 B가 보이게 됨
  expect(serverDoc.share.trips[0]!.days[0]!.startTime).toBe('10:00');
  expect(lib.trips.trip000001!.days[0]!.startTime.value).toBe('10:00');
});
