import type { ShareLegTime } from 'src/domain/share/build-trip-share';
import { estimateLeg, SAME_POINT_M } from 'src/domain/trips/geo';
import { dayLegs, type Leg } from 'src/domain/trips/query';
import { ApiError } from 'src/server/http';
import { resolveRoute, routeInputKey, type RouteQuery, type RouteResult } from 'src/server/route';
import type { BuiltLibrary } from './build-library';
import type { TripIssue } from './errors';

export type RouteStats = {
  /** 같은 입력의 중복도 포함한 모든 Day의 구간 수. */
  legs: number;
  routed: number;
  estimated: number;
  noRoute: number;
  samePoint: number;
  oldestQueriedAt: string | null;
};
export type RouteDeps = {
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  gapMs?: number;
  /** 길찾기를 생략한다(--no-routes). */
  skip?: boolean;
};

type Answer = { status: 'routed'; result: RouteResult } | { status: 'no-route' | 'estimated' };
const queryOf = (leg: Leg): RouteQuery => ({
  mode: leg.mode,
  from: [leg.from.lng, leg.from.lat],
  to: [leg.to.lng, leg.to.lat],
});
const isSamePoint = (leg: Leg) => !(leg.straightM >= SAME_POINT_M);

/** 모든 구간을 한 번씩 묻고 앱 공유 창과 같은 동기 구간 함수를 돌려준다. */
export async function prepareRoutes(
  built: BuiltLibrary,
  deps: RouteDeps,
  warnings: TripIssue[],
): Promise<{ routeOf(leg: Leg): ShareLegTime; stats: RouteStats }> {
  const trip = built.lib.trips[built.tripId]!;
  const legs = trip.days.flatMap((_, d) => dayLegs(built.lib, trip, d));
  const pending = new Map<string, { query: RouteQuery; day: number }>();
  trip.days.forEach((_, d) => {
    for (const leg of dayLegs(built.lib, trip, d)) {
      if (isSamePoint(leg)) continue;
      const query = queryOf(leg);
      const key = routeInputKey(query);
      if (!pending.has(key)) pending.set(key, { query, day: d });
    }
  });

  const answers = new Map<string, Answer>();
  if (!deps.skip) {
    let requested = false;
    for (const [key, { query, day }] of pending) {
      if (requested) await deps.sleep(deps.gapMs ?? 300);
      requested = true;
      try {
        answers.set(key, {
          status: 'routed',
          result: await resolveRoute(query, { fetch: deps.fetch }),
        });
      } catch (error) {
        const noRoute = error instanceof ApiError && error.code === 'NO_ROUTE';
        answers.set(key, { status: noRoute ? 'no-route' : 'estimated' });
        // 같은 입력 키가 여러 Day에 있으면 첫 Day에만 경고한다.
        warnings.push({
          path: `days[${day}]`,
          code: 'lookup-failed',
          message: noRoute
            ? '경로가 없어 직선 어림값을 썼어요'
            : '경로를 받지 못해 직선 어림값을 썼어요',
        });
      }
    }
  }

  const routeOf = (leg: Leg): ShareLegTime => {
    if (isSamePoint(leg)) {
      return {
        durationS: 0,
        distanceM: 0,
        tollFare: null,
        status: 'same-point',
        queriedAt: null,
        path: [],
      };
    }
    const answer = answers.get(routeInputKey(queryOf(leg)));
    if (answer?.status === 'routed') {
      const { durationS, distanceM, tollFare, queriedAt, path } = answer.result;
      return { durationS, distanceM, tollFare, status: 'routed', queriedAt, path };
    }
    return {
      ...estimateLeg(leg.mode, leg.straightM),
      tollFare: null,
      status: answer?.status === 'no-route' ? 'no-route' : 'estimated',
      queriedAt: null,
      path: [],
    };
  };

  const stats: RouteStats = {
    legs: legs.length,
    routed: 0,
    estimated: 0,
    noRoute: 0,
    samePoint: 0,
    oldestQueriedAt: null,
  };
  // 상태별 구간 수라 no-route는 estimated와 따로 센다. 중복 입력도 실제 구간마다 센다.
  for (const leg of legs) {
    const time = routeOf(leg);
    if (time.status === 'same-point') stats.samePoint++;
    else if (time.status === 'no-route') stats.noRoute++;
    else if (time.status === 'estimated') stats.estimated++;
    else {
      stats.routed++;
      if (
        time.queriedAt !== null &&
        (stats.oldestQueriedAt === null ||
          Date.parse(time.queriedAt) < Date.parse(stats.oldestQueriedAt))
      )
        stats.oldestQueriedAt = time.queriedAt;
    }
  }
  return { routeOf, stats };
}
