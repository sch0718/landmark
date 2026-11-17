import { fixedLegTime } from '../trips/leg-time';
import { autoMode, estimateLeg, haversineM, WALK_MAX_M } from '../trips/geo';
import { toShareLabels, toSharePlace } from '../share/build-share';
import { thinPaths, type ShareLegTime } from '../share/build-trip-share';
import { dayPoints, SHARE_TRIP_LIMITS } from '../share/check-share-trip';
import {
  LIVE_PATH_POINTS_MAX,
  parseLiveDoc,
  type LiveTripDoc,
  type LiveTripOptions,
} from '../trip-live/live-doc';
import type { Library } from '../../schema/library';
import type { ShareLabel, SharePlace, ShareTrip } from '../../schema/share';
import type { CollabPlan } from './plan';
import type { PlaceMap } from './places';
export type CollabRouteOf = (
  fromServerId: string,
  toServerId: string,
) => { mode: 'car' | 'walk' | 'transit'; time: ShareLegTime };
export function buildCollabDoc(input: {
  plan: CollabPlan;
  previous: LiveTripDoc | null;
  lib: Library;
  placeMap: PlaceMap;
  role: 'owner' | 'editor';
  options: LiveTripOptions;
  createdAt: string;
  routeOf: CollabRouteOf;
}): LiveTripDoc | null {
  const { plan, previous, lib, placeMap, role, options, createdAt, routeOf } = input;
  const order = [
    ...new Set(
      [
        plan.origin,
        ...plan.days.flatMap((d) => [...d.stops.map((s) => s.placeId), d.lodging]),
        ...plan.candidates,
      ].filter((s): s is string => s !== null),
    ),
  ];
  if (!order.length) return null;
  const old = new Map(previous?.share.places.map((p) => [p.id, p]) ?? []);
  const newLabels = new Set<string>();
  const places: SharePlace[] = order.map((id) => {
    const known = old.get(id);
    if (known) return { ...known, labelIds: [...known.labelIds] };
    const local = lib.places[placeMap[id]!];
    if (!local) throw new Error(`대응이 없는 장소: ${id}`);
    const shared = toSharePlace(local, lib, role === 'owner' && options.includeMemo, true);
    shared.labelIds.forEach((label) => newLabels.add(label));
    return { ...shared, id };
  });
  const used = new Set(places.flatMap((p) => p.labelIds));
  const labels = new Map<string, ShareLabel>();
  for (const label of [
    ...(previous?.share.labels ?? []).filter((l) => used.has(l.id)),
    ...toShareLabels(lib, newLabels),
  ])
    if (!labels.has(label.id)) labels.set(label.id, { ...label });
  for (const p of places) p.labelIds = p.labelIds.filter((id) => labels.has(id));
  const legMinutes = Object.fromEntries(
    Object.entries(plan.legMinutes ?? {}).filter(([key]) =>
      key.split('>').every((id) => order.includes(id)),
    ),
  );
  const trip: ShareTrip = {
    title: plan.title,
    startDate: plan.startDate,
    endDate: plan.endDate,
    originId: plan.origin,
    candidateIds: [...plan.candidates],
    legModes: Object.fromEntries(
      Object.entries(plan.legModes).filter(([key]) =>
        key.split('>').every((id) => order.includes(id)),
      ),
    ),
    ...(Object.keys(legMinutes).length ? { legMinutes } : {}),
    days: plan.days.map((d) => ({
      startTime: d.startTime,
      lodgingId: d.lodging,
      stops: d.stops.map((s) => ({
        placeId: s.placeId,
        stayMin: s.stayMin,
        fixedTime: s.fixedTime,
        ...(s.note ? { note: s.note } : {}),
      })),
      legs: [],
    })),
  };
  // 대중교통·직접 입력 시간은 지금 이웃한 구간의 것만 담는다. 순서가 바뀌어 쓰이지 않는 옛 키로
  // 문서가 v3가 되면 옛 버전 기기가 공동본을 읽지 못한다.
  const adjacent = new Set(
    trip.days.flatMap((_, i) => {
      const points = dayPoints(trip, i);
      return points.slice(1).map((to, j) => `${points[j]!}>${to}`);
    }),
  );
  for (const [key, mode] of Object.entries(trip.legModes))
    if (mode === 'transit' && !adjacent.has(key)) delete trip.legModes[key];
  if (trip.legMinutes) {
    for (const key of Object.keys(trip.legMinutes))
      if (!adjacent.has(key)) delete trip.legMinutes[key];
    if (Object.keys(trip.legMinutes).length === 0) delete trip.legMinutes;
  }
  trip.days = thinPaths(
    trip.days.map((day, i) => {
      const points = dayPoints(trip, i);
      return {
        ...day,
        legs: points.slice(1).map((to, j) => {
          const from = points[j]!,
            key = `${from}>${to}`;
          const chosen = trip.legModes[key],
            minutes = trip.legMinutes?.[key] ?? null;
          const a = places.find((p) => p.id === from)!,
            b = places.find((p) => p.id === to)!;
          const straightM = haversineM([a.lng, a.lat], [b.lng, b.lat]);
          // 앱의 legBetween과 같다: 직선 50km를 넘는 도보는 자동 규칙으로.
          const effectiveMode =
            chosen === undefined || (chosen === 'walk' && straightM > WALK_MAX_M)
              ? autoMode(straightM)
              : chosen;
          const planLeg = {
            key,
            from: { ...lib.places[placeMap[from]!]!, id: from, lng: a.lng, lat: a.lat },
            to: { ...lib.places[placeMap[to]!]!, id: to, lng: b.lng, lat: b.lat },
            mode: effectiveMode,
            minutes,
            straightM,
            walkAllowed: straightM <= WALK_MAX_M,
            modeSource: effectiveMode === chosen ? ('user' as const) : ('auto' as const),
          };
          let route: ReturnType<CollabRouteOf>;
          if (effectiveMode === 'transit' || minutes !== null)
            route = { mode: effectiveMode, time: fixedLegTime(planLeg)! };
          else {
            route = routeOf(from, to);
            // 콜백은 아직 병합 전 로컬 계획을 볼 수 있다. 다른 수단·옛 직접 입력 시간은 버린다.
            if (route.mode !== effectiveMode || route.time.status === 'manual')
              route = {
                mode: effectiveMode,
                time: fixedLegTime(planLeg) ?? {
                  status: 'estimated',
                  ...estimateLeg(effectiveMode, straightM),
                  tollFare: null,
                  queriedAt: null,
                  path: [],
                },
              };
          }
          const { mode, time } = route;
          const leg = {
            from,
            to,
            mode,
            ...time,
            queriedAt: time.status === 'routed' ? time.queriedAt : null,
            path: time.status === 'routed' ? time.path : [],
          };
          return thinPaths([{ ...day, legs: [leg] }], SHARE_TRIP_LIMITS.pathPointsPerLeg)[0]!
            .legs[0]!;
        }),
      };
    }),
    LIVE_PATH_POINTS_MAX,
  );
  const result = parseLiveDoc({
    format: 'landmark-trip-live',
    v: 2,
    share: {
      format: 'tripmap-share',
      version:
        Object.values(trip.legModes).includes('transit') ||
        Object.keys(trip.legMinutes ?? {}).length
          ? 3
          : 2,
      title: plan.title,
      createdAt,
      labels: [...labels.values()].sort((a, b) => a.order - b.order),
      places,
      trips: [trip],
    },
    ids: {
      days: plan.days.map((d) => d.id),
      stops: plan.days.map((d) => d.stops.map((s) => s.id)),
    },
    options: { includeMemo: options.includeMemo, includeCandidates: true },
  });
  if (!result) throw new Error('공동본 검사 실패');
  return result;
}
