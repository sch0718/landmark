import type { Day, Leg, Place, Stop } from 'src/schema/legacy/trip-data';
import type { RouteResult } from './naver-client';
import { routeCacheKey, type CachedRoute, type RouteCache } from './route-cache';
import { simplifyPath } from './simplify';

export type BuildLegsDeps = {
  cache: RouteCache;
  fetchRoute: (s: [number, number], g: [number, number]) => Promise<RouteResult>;
  refresh: boolean;
  now: string;
};

export type FailedLeg = { date: string; from: string; to: string };

const EARTH_R = 6_371_000;

function haversineM(a: [number, number], b: [number, number]): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_R * Math.asin(Math.sqrt(h)));
}

function placeOf(places: Record<string, Place>, stop: Stop): Place {
  const p = places[stop.placeKey];
  if (!p) throw new Error(`알 수 없는 placeKey: ${stop.placeKey}`);
  return p;
}

export async function buildLegs(
  days: { date: string; stops: Stop[] }[],
  places: Record<string, Place>,
  deps: BuildLegsDeps,
): Promise<{ days: Day[]; failed: FailedLeg[] }> {
  const failed: FailedLeg[] = [];
  /** 이번 실행에서 실패한 캐시 키. 한 실행 안에서는 재시도하지 않는다(§7.1). */
  const failedKeys = new Set<string>();
  const out: Day[] = [];
  for (const day of days) {
    const legs: Leg[] = [];
    for (let i = 0; i + 1 < day.stops.length; i++) {
      const from = day.stops[i]!;
      const to = day.stops[i + 1]!;
      const fp = placeOf(places, from);
      const tp = placeOf(places, to);
      const start: [number, number] = [fp.lng, fp.lat];
      const goal: [number, number] = [tp.lng, tp.lat];
      const base = {
        fromStopId: from.id,
        toStopId: to.id,
        fromPlaceKey: from.placeKey,
        toPlaceKey: to.placeKey,
      };
      const key = routeCacheKey(start, goal);
      let route: CachedRoute | null = deps.refresh ? null : await deps.cache.get(key);
      if (!route && !failedKeys.has(key)) {
        try {
          route = { ...(await deps.fetchRoute(start, goal)), queriedAt: deps.now };
        } catch {
          route = null;
          failedKeys.add(key);
        }
        // 캐시 저장 오류는 삼키지 않는다 (성공한 경로를 failed로 바꾸지 않음)
        if (route) await deps.cache.set(key, route);
      }
      if (route) {
        legs.push({
          ...base,
          status: 'routed',
          distanceM: route.distanceM,
          distanceKind: 'road',
          durationMs: route.durationMs,
          staticDurationMs: route.staticDurationMs,
          tollFare: route.tollFare,
          path: simplifyPath(route.path),
          queriedAt: route.queriedAt,
        });
      } else {
        failed.push({ date: day.date, from: from.placeKey, to: to.placeKey });
        legs.push({
          ...base,
          status: 'failed',
          distanceM: haversineM(start, goal),
          distanceKind: 'straight',
          durationMs: null,
          staticDurationMs: null,
          tollFare: null,
          path: [start, goal],
          queriedAt: null,
        });
      }
    }
    out.push({ date: day.date, stops: day.stops, legs });
  }
  return { days: out, failed };
}
