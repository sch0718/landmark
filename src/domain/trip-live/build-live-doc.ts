import { buildTripShareDoc, thinPaths, type ShareLegTime } from 'src/domain/share/build-trip-share';
import { SHARE_TRIP_LIMITS } from 'src/domain/share/check-share-trip';
import { visibleStops, type Leg } from 'src/domain/trips/query';
import type { Library } from 'src/schema/library';
import {
  LIVE_DOC_MAX_BYTES,
  LIVE_PATH_POINTS_MAX,
  liveDocBytes,
  parseLiveDoc,
  type LiveTripDoc,
  type LiveTripOptions,
} from './live-doc';
export const ESTIMATE_ONLY: (leg: Leg) => ShareLegTime = () => ({
  durationS: 0,
  distanceM: 0,
  tollFare: null,
  status: 'estimated',
  queriedAt: null,
  path: [],
});
export function buildLiveTripDoc(
  lib: Library,
  tripId: string,
  routeOf: (leg: Leg) => ShareLegTime,
  opts: { title: string; options: LiveTripOptions; dayIds: readonly string[]; createdAt: string },
): LiveTripDoc | null {
  const trip = lib.trips[tripId];
  if (!trip || trip.deletedAt !== null) return null;
  if (opts.dayIds.length !== trip.days.length) throw new Error('dayIds 길이가 Day 수와 다릅니다');
  const share = buildTripShareDoc(lib, tripId, routeOf, {
    title: opts.title,
    ...opts.options,
    now: new Date(opts.createdAt),
  });
  if (!share || !share.places.length) return null;
  share.trips[0]!.days = thinPaths(
    share.trips[0]!.days.map((day) => ({
      ...day,
      legs: day.legs.map(
        (leg) =>
          thinPaths([{ ...day, legs: [leg] }], SHARE_TRIP_LIMITS.pathPointsPerLeg)[0]!.legs[0]!,
      ),
    })),
    LIVE_PATH_POINTS_MAX,
  );
  return parseLiveDoc({
    format: 'landmark-trip-live',
    v: 1,
    share,
    ids: {
      days: [...opts.dayIds],
      stops: trip.days.map((day) => visibleStops(lib, day).map((s) => s.id)),
    },
    options: {
      includeMemo: opts.options.includeMemo,
      includeCandidates: opts.options.includeCandidates,
    },
  });
}
export function fitLiveDoc(doc: LiveTripDoc): LiveTripDoc | null {
  if (liveDocBytes(doc) <= LIVE_DOC_MAX_BYTES) return doc;
  const copy: LiveTripDoc = {
    ...doc,
    share: {
      ...doc.share,
      trips: doc.share.trips.map((trip) => ({
        ...trip,
        days: trip.days.map((day) => ({
          ...day,
          legs: day.legs.map((leg) => ({ ...leg, path: [] })),
        })),
      })),
    },
  };
  return liveDocBytes(copy) <= LIVE_DOC_MAX_BYTES ? copy : null;
}
/** 경로를 처음 받았을 때는 반영하고, 이미 받은 경로의 재조회 결과는 무시한다. */
export function liveEditKey(doc: LiveTripDoc): Promise<string> {
  return liveDocKey(doc, true);
}
/** 합류 기준 판정용. 경로 조회 결과를 빼고 공개 계획 값은 모두 담는다. */
export function livePlanKey(doc: LiveTripDoc): Promise<string> {
  return liveDocKey(doc, false);
}
async function liveDocKey(doc: LiveTripDoc, includeRouteStatus: boolean): Promise<string> {
  const value = {
    ...doc,
    share: {
      ...doc.share,
      createdAt: '',
      trips: doc.share.trips.map((trip) => ({
        ...trip,
        days: trip.days.map((day) => ({
          ...day,
          legs: day.legs.map(({ from, to, mode, status }) =>
            includeRouteStatus ? [from, to, mode, status === 'routed'] : [from, to, mode],
          ),
        })),
      })),
    },
  };
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
