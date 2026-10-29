import { buildCollabDoc } from 'src/domain/trip-collab/build-doc';
import { OWNER_LABEL } from 'src/domain/trip-collab/constants';
import { mapServerPlaces, assignServerPlaceIds, serverIdOf } from 'src/domain/trip-collab/places';
import { projectLocalTrip } from 'src/domain/trip-collab/plan';
import {
  buildLiveTripDoc,
  ESTIMATE_ONLY,
  fitLiveDoc,
  liveEditKey,
} from 'src/domain/trip-live/build-live-doc';
import { alignDayIds } from 'src/domain/trip-live/live-doc';
import type { Library } from 'src/schema/library';
import type { TripCollabError } from 'src/services/trip-collab/client';
import { tripLiveApi, type LiveState } from 'src/services/trip-live/client';
import type { TripLiveRecord } from 'src/services/trip-live/store';
import { newDayId } from 'src/services/trip-live/tokens';
import type { CollabEngineDeps } from './collab-engine';
export async function isCleanOwnerDevice(
  lib: Library,
  tripId: string,
  record: TripLiveRecord,
): Promise<boolean> {
  const trip = lib.trips[tripId];
  if (!trip) return false;
  const doc = buildLiveTripDoc(lib, tripId, ESTIMATE_ONLY, {
    title: record.options.title,
    options: record.options,
    dayIds: alignDayIds(record.dayIds, trip.days.length, newDayId),
    createdAt: record.createdAt,
  });
  return doc ? (await liveEditKey(doc)) === record.publishedKey : record.publishedKey === undefined;
}
export async function joinCollabAsOwner(
  deps: CollabEngineDeps,
  live: LiveState,
  clean: boolean,
): Promise<void> {
  const { tripId, store } = deps;
  let placeMap: Record<string, string> = {};
  if (clean) {
    const result = await deps.run((lib, ctx) => {
      const r = mapServerPlaces(lib, live.doc, {}, ctx);
      if (r.ok) placeMap = r.placeMap;
      return r;
    });
    if (!result.ok) {
      deps.reportError(result.error);
      throw new Error('공동 여행 장소를 담지 못했어요');
    }
  }
  const trip = deps.getLibrary().trips[tripId];
  if (!trip || trip.deletedAt !== null) return;
  const dayIds = alignDayIds(live.doc.ids.days, trip.days.length, newDayId);
  store.put({
    tripId,
    liveId: deps.liveStore.get(tripId)!.liveId,
    role: 'owner',
    token: null,
    deviceId: null,
    label: OWNER_LABEL,
    status: 'live',
    rev: live.rev,
    prev: 0,
    dayIds,
    placeMap,
    syncedAt: deps.now().toISOString(),
    title: live.doc.share.title,
    pendingProgress: [],
  });
  if (clean) {
    placeMap = assignServerPlaceIds(
      trip,
      placeMap,
      new Set(live.doc.share.places.map((p) => p.id)),
      deps.newPlaceId,
    );
    store.update(tripId, { placeMap });
    store.writeBase(deps.liveStore.get(tripId)!.liveId, {
      rev: live.rev,
      plan: projectLocalTrip(trip, serverIdOf(placeMap), dayIds),
      progress: null,
    });
  }
}
export async function enableCollabAsOwner(
  deps: CollabEngineDeps,
): Promise<{ ok: true } | { ok: false; error: TripCollabError | 'conflict' | 'empty' }> {
  const liveRecord = deps.liveStore.get(deps.tripId),
    trip = deps.getLibrary().trips[deps.tripId];
  if (!liveRecord || liveRecord.status !== 'live' || !trip || trip.deletedAt !== null)
    return { ok: false, error: 'empty' };
  const result = await tripLiveApi.get(liveRecord.liveId, null, liveRecord.ownerToken);
  if (!result.ok) return result;
  if (result.value === 'unchanged') return { ok: false, error: 'invalid' };
  if (result.value.doc.v === 2) {
    await joinCollabAsOwner(
      deps,
      result.value,
      await isCleanOwnerDevice(deps.getLibrary(), deps.tripId, liveRecord),
    );
    return { ok: true };
  }
  const placeMap = assignServerPlaceIds(trip, {}, new Set(), deps.newPlaceId),
    dayIds = alignDayIds(liveRecord.dayIds, trip.days.length, newDayId),
    plan = projectLocalTrip(trip, serverIdOf(placeMap), dayIds);
  const built = buildCollabDoc({
    plan,
    previous: null,
    lib: deps.getLibrary(),
    placeMap,
    role: 'owner',
    options: { includeMemo: liveRecord.options.includeMemo, includeCandidates: true },
    createdAt: liveRecord.createdAt,
    routeOf: deps.routeOf(),
  });
  if (!built) return { ok: false, error: 'empty' };
  const doc = fitLiveDoc(built);
  if (!doc) return { ok: false, error: 'too-big' };
  const updated = await tripLiveApi.update(
    liveRecord.liveId,
    doc,
    result.value.rev,
    liveRecord.ownerToken,
  );
  if (!updated.ok) return { ok: false, error: updated.error };
  deps.store.put({
    tripId: deps.tripId,
    liveId: liveRecord.liveId,
    role: 'owner',
    token: null,
    deviceId: null,
    label: OWNER_LABEL,
    status: 'live',
    rev: updated.value.rev,
    prev: 0,
    dayIds,
    placeMap,
    syncedAt: deps.now().toISOString(),
    title: plan.title,
    pendingProgress: [],
  });
  deps.store.writeBase(liveRecord.liveId, { rev: updated.value.rev, plan, progress: null });
  return { ok: true };
}
