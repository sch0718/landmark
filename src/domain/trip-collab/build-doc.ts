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
) => { mode: 'car' | 'walk'; time: ShareLegTime };
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
  trip.days = thinPaths(
    trip.days.map((day, i) => {
      const points = dayPoints(trip, i);
      return {
        ...day,
        legs: points.slice(1).map((to, j) => {
          const from = points[j]!,
            { mode, time } = routeOf(from, to);
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
      version: 2,
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
