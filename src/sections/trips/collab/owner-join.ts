import { OWNER_LABEL } from 'src/domain/trip-collab/constants';
import { mapServerPlaces, assignServerPlaceIds } from 'src/domain/trip-collab/places';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import { liveEditKey } from 'src/domain/trip-live/build-live-doc';
import { alignDayIds } from 'src/domain/trip-live/live-doc';
import type { TripCollabError } from 'src/services/trip-collab/client';
import { tripLiveApi, type LiveState } from 'src/services/trip-live/client';
import { newDayId } from 'src/services/trip-live/tokens';
import { collabEngineFor, type CollabEngineDeps } from './collab-engine';

export async function joinCollabAsOwner(deps: CollabEngineDeps, live: LiveState): Promise<void> {
  const { tripId, store } = deps;
  const record = deps.liveStore.get(tripId);
  if (!record || store.get(tripId)) return;
  let placeMap: Record<string, string> = {};
  const result = await deps.run((lib, ctx) => {
    const r = mapServerPlaces(lib, live.doc, {}, ctx);
    if (r.ok) placeMap = r.placeMap;
    return r;
  });
  if (!result.ok) {
    deps.reportError(result.error);
    throw new Error('공동 여행 장소를 담지 못했어요');
  }
  const trip = deps.getLibrary().trips[tripId];
  if (!trip || trip.deletedAt !== null || store.get(tripId)) return;
  const dayIds = alignDayIds(live.doc.ids.days, trip.days.length, newDayId);
  placeMap = assignServerPlaceIds(
    trip,
    placeMap,
    new Set(live.doc.share.places.map((p) => p.id)),
    deps.newPlaceId,
  );
  // 2A는 마지막 공개본의 지문만 보관한다. 받은 판이 그 공개본임을 확인할 때만 기준으로 쓴다.
  const matchesPublished =
    record.publishedKey !== undefined &&
    (await liveEditKey({ ...live.doc, v: 1 })) === record.publishedKey;
  if (store.get(tripId)) return;
  if (matchesPublished && !store.readBase(record.liveId))
    store.writeBase(record.liveId, { rev: live.rev, plan: planFromDoc(live.doc), progress: null });
  store.put({
    tripId,
    liveId: record.liveId,
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
}

export async function enableCollabAsOwner(
  deps: CollabEngineDeps,
): Promise<{ ok: true } | { ok: false; error: TripCollabError | 'empty' }> {
  const record = deps.liveStore.get(deps.tripId),
    trip = deps.getLibrary().trips[deps.tripId];
  if (!record || record.status !== 'live' || !trip || trip.deletedAt !== null)
    return { ok: false, error: 'empty' };
  if (!deps.store.get(deps.tripId)) {
    const result = await tripLiveApi.get(record.liveId, null, record.ownerToken);
    if (!result.ok) return result;
    if (result.value === 'unchanged') return { ok: false, error: 'invalid' };
    await joinCollabAsOwner(deps, result.value);
  }
  // v1도 같은 병합·비교·재시도를 거치고, 선택한 결과만 공동본 경로로 v2로 올린다.
  const engine = collabEngineFor(deps.tripId, () => deps);
  await engine.sync();
  const state = engine.getSnapshot().state;
  if (state === 'synced') return { ok: true };
  return {
    ok: false,
    error:
      state === 'conflict'
        ? 'conflict'
        : state === 'off'
          ? 'switched-off'
          : state === 'limited'
            ? 'rate-limited'
            : state === 'too-big'
              ? 'too-big'
              : state === 'revoked'
                ? 'unauthorized'
                : state === 'ended'
                  ? 'ended'
                  : state === 'version'
                    ? 'version'
                    : 'unavailable',
  };
}
