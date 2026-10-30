import { OWNER_LABEL } from 'src/domain/trip-collab/constants';
import { mapServerPlaces, assignServerPlaceIds, serverIdOf } from 'src/domain/trip-collab/places';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import {
  buildLiveTripDoc,
  ESTIMATE_ONLY,
  liveEditKey,
  livePlanKey,
} from 'src/domain/trip-live/build-live-doc';
import { alignDayIds } from 'src/domain/trip-live/live-doc';
import type { TripCollabError } from 'src/services/trip-collab/client';
import { tripLiveApi, type LiveState } from 'src/services/trip-live/client';
import { tripLivePlanStore } from 'src/services/trip-live/plan-store';
import { newDayId } from 'src/services/trip-live/tokens';
import { collabEngineFor, type CollabEngineDeps } from './collab-engine';

function isCurrentOwnerRecord(
  existing: { status: string; liveId: string },
  liveId: string,
): boolean {
  return existing.status === 'live' && existing.liveId === liveId;
}

export async function joinCollabAsOwner(deps: CollabEngineDeps, live: LiveState): Promise<void> {
  const { tripId, store } = deps;
  const record = deps.liveStore.get(tripId);
  if (!record) return;
  const existing = store.get(tripId);
  if (existing) {
    if (isCurrentOwnerRecord(existing, record.liveId)) return;
    // 끝났거나 권한을 잃었거나 다른 공유의 낡은 기록은 지우고 새 공유로 합류한다.
    store.remove(tripId);
  }
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
  // 2A와 같은 옵션·Day id로 공개본을 다시 만들어 미공개 수정 여부를 확인한다.
  const routeOf = deps.routeOf();
  const publicationOptions = {
    title: record.options.title,
    options: record.options,
    dayIds: alignDayIds(record.dayIds, trip.days.length, newDayId),
    createdAt: record.createdAt,
  };
  const published = buildLiveTripDoc(
    deps.getLibrary(),
    tripId,
    (leg) => routeOf(leg.from.id, leg.to.id).time,
    publicationOptions,
  );
  const matchesPublished =
    record.publishedKey !== undefined &&
    (await liveEditKey({ ...live.doc, v: 1 })) === record.publishedKey;
  let base = matchesPublished ? planFromDoc(live.doc) : null;
  let cleanPublished = false;
  if (!base && published) {
    const planKey = (deps.livePlanStore ?? tripLivePlanStore).get(tripId);
    if (planKey !== undefined) {
      cleanPublished = (await livePlanKey(published)) === planKey;
    } else if (record.publishedKey !== undefined) {
      // 옛 기록은 현재 상태와 모든 구간 미조회 상태 중 공개 지문과 맞는 쪽을 찾는다.
      const estimated = buildLiveTripDoc(
        deps.getLibrary(),
        tripId,
        ESTIMATE_ONLY,
        publicationOptions,
      );
      cleanPublished =
        (await liveEditKey(published)) === record.publishedKey ||
        (estimated !== null && (await liveEditKey(estimated)) === record.publishedKey);
    }
  }
  if (!base && published && cleanPublished) {
    // 로컬 투영 대신 공개 문서를 써서 공개에서 뺀 후보를 기준에 섞지 않는다.
    const plan = planFromDoc(published),
      toServer = serverIdOf(placeMap);
    base = {
      ...plan,
      origin: plan.origin === null ? null : toServer(plan.origin),
      candidates: plan.candidates.map(toServer),
      legModes: Object.fromEntries(
        Object.entries(plan.legModes).map(([key, mode]) => {
          const [a, b] = key.split('>');
          return [`${toServer(a!)}>${toServer(b!)}`, mode];
        }),
      ),
      days: plan.days.map((day, i) => ({
        ...day,
        id: dayIds[i]!,
        lodging: day.lodging === null ? null : toServer(day.lodging),
        stops: day.stops.map((stop) => ({ ...stop, placeId: toServer(stop.placeId) })),
      })),
    };
  }
  if (store.get(tripId)) return;
  if (base && !store.readBase(record.liveId))
    store.writeBase(record.liveId, { rev: live.rev, plan: base, progress: null });
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
  const existing = deps.store.get(deps.tripId);
  if (!existing || !isCurrentOwnerRecord(existing, record.liveId)) {
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
