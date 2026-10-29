import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enableCollabAsOwner,
  isCleanOwnerDevice,
  joinCollabAsOwner,
} from 'src/sections/trips/collab/owner-join';
import type { CollabEngineDeps } from 'src/sections/trips/collab/collab-engine';
import { createTripCollabStore } from 'src/services/trip-collab/store';
import { createTripLiveStore } from 'src/services/trip-live/store';
import { tripLiveApi } from 'src/services/trip-live/client';
import { tripCollabApi } from 'src/services/trip-collab/client';
import { buildLiveTripDoc, ESTIMATE_ONLY, liveEditKey } from 'src/domain/trip-live/build-live-doc';
import type { Library } from 'src/schema/library';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
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
    api: tripCollabApi,
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
  return { deps, store, record, live, lib };
}
describe('소유자 공동 편집 합류', () => {
  it('v1은 v2로 올리고 연결 기록·기준을 만든다', async () => {
    const s = await setup();
    expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: true });
    expect(tripLiveApi.update).toHaveBeenCalledWith(
      'abcdefghij',
      expect.objectContaining({ v: 2 }),
      1,
      s.record.ownerToken,
    );
    expect(s.store.get(s.record.tripId)).toMatchObject({ role: 'owner', rev: 2, token: null });
    expect(s.store.readBase('abcdefghij')?.rev).toBe(2);
  });
  it('2A 올리기 충돌은 기록을 만들지 않는다', async () => {
    const s = await setup();
    vi.mocked(tripLiveApi.update).mockResolvedValue({ ok: false, error: 'conflict', rev: 3 });
    expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: false, error: 'conflict' });
    expect(s.store.list()).toEqual([]);
  });
  it('v2면 새로 올리지 않고 소유자로 합류한다', async () => {
    const s = await setup();
    s.live.doc.v = 2;
    expect(await enableCollabAsOwner(s.deps)).toEqual({ ok: true });
    expect(tripLiveApi.update).not.toHaveBeenCalled();
    expect(s.store.get(s.record.tripId)?.role).toBe('owner');
  });
  it('깨끗한 기기만 로컬 투영을 기준으로 쓰고 수정한 기기는 기준 없이 합류한다', async () => {
    const s = await setup();
    await joinCollabAsOwner(s.deps, s.live, true);
    expect(s.store.readBase('abcdefghij')).not.toBeNull();
    s.store.remove(s.record.tripId);
    await joinCollabAsOwner(s.deps, s.live, false);
    expect(s.store.readBase('abcdefghij')).toBeNull();
  });
  it('소유자 지문은 2A 규칙으로 판단한다', async () => {
    const s = await setup();
    expect(await isCleanOwnerDevice(s.lib, s.record.tripId, s.record)).toBe(true);
    const doc = buildLiveTripDoc(s.lib, s.record.tripId, ESTIMATE_ONLY, {
      title: '바꿈',
      options: { includeMemo: false, includeCandidates: true },
      dayIds: s.record.dayIds,
      createdAt: s.record.createdAt,
    })!;
    expect(
      await isCleanOwnerDevice(s.lib, s.record.tripId, {
        ...s.record,
        publishedKey: await liveEditKey(doc),
      }),
    ).toBe(false);
  });
});
