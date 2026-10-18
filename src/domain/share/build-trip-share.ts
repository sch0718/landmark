import { toShareLabels, toSharePlace } from 'src/domain/share/build-share';
import { SHARE_TRIP_LIMITS } from 'src/domain/share/check-share-trip';
import {
  dayEndpoints,
  dayLegs,
  visibleCandidates,
  visibleStops,
  type Leg,
} from 'src/domain/trips/query';
import type { Library } from 'src/schema/library';
import type {
  ShareDay,
  ShareDocV2,
  ShareLeg,
  SharePlace,
  ShareStop,
  ShareTrip,
} from 'src/schema/share';

/** 창의 `routeOf`가 구간마다 돌려주는 시간·거리·상태·경로선. */
export type ShareLegTime = Pick<
  ShareLeg,
  'durationS' | 'distanceM' | 'tollFare' | 'status' | 'queriedAt' | 'path'
>;

export type BuildTripShareOptions = {
  title: string;
  includeMemo: boolean;
  includeCandidates: boolean;
  now: Date;
};

/**
 * 보관함의 여행 하나로 v2 공유 문서를 만든다(스펙 §3.3). 여행이 없거나 지웠으면 null.
 *
 * - 장소 순서: 출발지 → Day마다 [Stop → 숙소] → 후보. 같은 장소는 처음 나온 자리 하나만.
 *   지운 장소(묘비)는 빠지고, 지운 출발지·숙소는 `null`이다(계획 화면의 `dayEndpoints` 규칙).
 * - 구간은 `dayLegs`와 같은 순서이며 시간·경로는 `routeOf`가 준 값을 그대로 쓴다.
 *   다만 `routed`가 아니면 `path: []`·`queriedAt: null`로 맞추고, 경로선 점이 문서 전체 한도를
 *   넘으면 `thinPaths`로 솎는다.
 */
export function buildTripShareDoc(
  lib: Library,
  tripId: string,
  routeOf: (leg: Leg) => ShareLegTime,
  opts: BuildTripShareOptions,
): ShareDocV2 | null {
  const trip = lib.trips[tripId];
  if (trip === undefined || trip.deletedAt !== null) return null;

  // 문서에 담는 장소 id를 처음 나온 순서로 모은다.
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null) => {
    if (id === null || seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };

  const candidates = opts.includeCandidates ? visibleCandidates(lib, trip) : [];
  const days: ShareDay[] = trip.days.map((day, di) => {
    const { start, end } = dayEndpoints(lib, trip, di);
    if (di === 0) add(start?.id ?? null);
    const stops: ShareStop[] = visibleStops(lib, day).map((stop) => {
      add(stop.placeId);
      const out: ShareStop = {
        placeId: stop.placeId,
        stayMin: stop.stayMin,
        fixedTime: stop.fixedTime,
      };
      if (stop.note !== '') out.note = stop.note;
      return out;
    });
    add(end?.id ?? null);

    const legs = dayLegs(lib, trip, di).map((leg) => toShareLeg(leg, routeOf(leg)));
    return { startTime: day.startTime.value, lodgingId: end?.id ?? null, stops, legs };
  });
  for (const place of candidates) add(place.id);

  const places: SharePlace[] = [];
  const usedLabelIds = new Set<string>();
  for (const id of order) {
    const out = toSharePlace(lib.places[id]!, lib, opts.includeMemo, true);
    for (const labelId of out.labelIds) usedLabelIds.add(labelId);
    places.push(out);
  }

  // 사람이 고른 이동 수단 가운데 문서에 담긴 두 장소 사이의 것만.
  const legModes: ShareTrip['legModes'] = {};
  for (const [key, mode] of Object.entries(trip.legModes.value)) {
    const parts = key.split('>');
    if (parts.length === 2 && seen.has(parts[0]!) && seen.has(parts[1]!)) legModes[key] = mode;
  }

  const shareTrip: ShareTrip = {
    title: trip.title.value,
    startDate: trip.startDate.value,
    endDate: trip.endDate.value,
    originId: dayEndpoints(lib, trip, 0).start?.id ?? null,
    candidateIds: candidates.map((place) => place.id),
    days: thinPaths(days, SHARE_TRIP_LIMITS.pathPointsTotal),
    legModes,
  };

  return {
    format: 'tripmap-share',
    version: 2,
    title: opts.title.trim(),
    createdAt: opts.now.toISOString(),
    labels: toShareLabels(lib, usedLabelIds),
    places,
    trips: [shareTrip],
  };
}

function toShareLeg(leg: Leg, time: ShareLegTime): ShareLeg {
  const routed = time.status === 'routed';
  return {
    from: leg.from.id,
    to: leg.to.id,
    mode: leg.mode,
    durationS: time.durationS,
    distanceM: time.distanceM,
    tollFare: time.tollFare,
    status: time.status,
    queriedAt: routed ? time.queriedAt : null,
    path: routed ? time.path : [],
  };
}

/**
 * 문서 전체 경로선 점이 `max`를 넘으면 구간마다 같은 비율로 점을 솎는다. 점이 2개 이상인 선은
 * 첫·끝 점을 남기고(그래서 2점 아래로는 줄이지 않는다), 입력은 바꾸지 않는다.
 */
export function thinPaths(days: ShareDay[], max: number): ShareDay[] {
  let total = 0;
  for (const day of days) for (const leg of day.legs) total += leg.path.length;
  if (total <= max) return days;

  const ratio = max / total;
  return days.map((day) => ({
    ...day,
    legs: day.legs.map((leg) => ({ ...leg, path: thinLine(leg.path, ratio) })),
  }));
}

/** 선의 점을 `ratio` 비율로 고르게 솎는다. 점이 2개 미만이면 그대로. */
function thinLine(path: [number, number][], ratio: number): [number, number][] {
  const n = path.length;
  if (n < 2) return path;
  const keep = Math.min(n, Math.max(2, Math.floor(n * ratio)));
  const out: [number, number][] = [];
  for (let i = 0; i < keep; i++) {
    out.push(path[Math.round((i * (n - 1)) / (keep - 1))]!);
  }
  return out;
}
