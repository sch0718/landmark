import { Effect, Result } from 'effect';
import { useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { estimateLeg, SAME_POINT_M } from 'src/domain/trips/geo';
import { dayEndpoints, dayLegs, visibleStops, type Leg } from 'src/domain/trips/query';
import { computeSchedule, type DaySchedule, type LegTime } from 'src/domain/trips/schedule';
import { forkEffect } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { parseRouteInputKey, routeInputKey } from 'src/server/route';
import { RouteLookup, ROUTE_MAX_CONCURRENT } from 'src/services/route-lookup';
import { libraryAtom } from 'src/stores/library-state';
import { routeStatesAtom, type RouteState } from 'src/stores/trip-planner';

export type PlannedLeg = Leg & {
  time: LegTime;
  status: 'routed' | 'estimated' | 'no-route' | 'failed';
  queriedAt: string | null;
  path: [number, number][];
};

export type DayPlan = {
  legs: PlannedLeg[];
  schedule: DaySchedule;
  /** 그날 받은 경로 중 가장 오래된 조회 시각. 받은 경로가 없으면 null. */
  oldestQueriedAt: string | null;
  /** 그날 구간 중 연결 실패(`OFFLINE`)로 어림값을 쓰는 것이 있는가. */
  offline: boolean;
  /** 그날 구간을 캐시를 건너뛰고 다시 요청한다(`다시 계산`). */
  refresh(): void;
  /** 구간 하나(`Leg.key`)를 캐시를 건너뛰고 다시 요청한다(`다시 시도`). */
  retryLeg(key: string): void;
};

type Store = ReturnType<typeof useStore>;

/** 직선 10m 미만(NaN 포함)은 같은 지점: 묻지 않고 거리 0·시간 0. */
export const isSamePointLeg = (leg: Leg): boolean => !(leg.straightM >= SAME_POINT_M);

const routeKeyOf = (leg: Leg): string =>
  routeInputKey({
    mode: leg.mode,
    from: [leg.from.lng, leg.from.lat],
    to: [leg.to.lng, leg.to.lat],
  });

const liveTrip = (lib: Library, tripId: string): Trip | null => {
  const trip = lib.trips[tripId];
  return trip !== undefined && trip.deletedAt === null ? trip : null;
};

/** 한 구간을 묻고 결과를 `routeStatesAtom`에 쓴다. 실패도 상태로 남기므로 이 효과는 실패하지 않는다. */
function lookupLeg(store: Store, key: string, refresh: boolean) {
  const { mode, from, to } = parseRouteInputKey(key);
  return Effect.gen(function* () {
    const lookup = yield* RouteLookup;
    const result = yield* Effect.result(lookup.leg(mode, from, to, { refresh }));
    let state: RouteState;
    if (Result.isSuccess(result)) state = { status: 'routed', result: result.success };
    else if (result.failure.code === 'NO_ROUTE') state = { status: 'no-route' };
    else if (result.failure.code === 'OFFLINE') state = { status: 'offline' };
    else state = { status: 'failed', code: result.failure.code };
    store.set(routeStatesAtom, (prev) => ({ ...prev, [key]: state }));
  });
}

/** 여러 구간을 차례로(동시 4개까지) 묻는다. 목록 앞쪽이 먼저 나간다. */
const lookupAll = (store: Store, keys: string[], refresh: boolean) =>
  Effect.forEach(keys, (key) => Effect.suspend(() => lookupLeg(store, key, refresh)), {
    concurrency: ROUTE_MAX_CONCURRENT,
    discard: true,
  });

const straightPath = (leg: Leg): [number, number][] => [
  [leg.from.lng, leg.from.lat],
  [leg.to.lng, leg.to.lat],
];

/** 구간에 시간을 붙인다. 경로가 없으면(요청 전·실패) 직선 추정이다. */
function planLeg(leg: Leg, state: RouteState | undefined): PlannedLeg {
  if (isSamePointLeg(leg)) {
    return {
      ...leg,
      time: { durationS: 0, distanceM: 0, tollFare: null, estimated: false },
      status: 'routed',
      queriedAt: null,
      path: straightPath(leg),
    };
  }
  if (state?.status === 'routed') {
    const { durationS, distanceM, tollFare, queriedAt, path } = state.result;
    return {
      ...leg,
      time: { durationS, distanceM, tollFare, estimated: false },
      status: 'routed',
      queriedAt,
      path,
    };
  }
  const estimate = estimateLeg(leg.mode, leg.straightM);
  const status =
    state?.status === 'no-route' ? 'no-route' : state?.status === 'failed' ? 'failed' : 'estimated';
  return {
    ...leg,
    time: { ...estimate, tollFare: null, estimated: true },
    status,
    queriedAt: null,
    path: straightPath(leg),
  };
}

/** 화면에 쓰는 값이 같은 구간인가(장소는 참조로 비교: 문서는 바뀐 장소만 새 객체로 만든다). */
const sameLeg = (a: Leg, b: Leg): boolean =>
  a.key === b.key &&
  a.from === b.from &&
  a.to === b.to &&
  a.mode === b.mode &&
  a.modeSource === b.modeSource &&
  a.walkAllowed === b.walkAllowed &&
  a.straightM === b.straightM;

/**
 * 원소가 모두 `same`이면 지난 렌더의 배열을 그대로 돌려준다. 문서·조회 결과가 다른 곳에서 바뀌어도
 * 이 값을 쓰는 쪽(메모·효과)이 헛되이 다시 돌지 않게 한다.
 */
function useStableArray<T>(next: T[], same: (a: T, b: T) => boolean = Object.is): T[] {
  const [kept, setKept] = useState(next);
  if (kept.length === next.length && kept.every((value, i) => same(value, next[i]!))) return kept;
  setKept(next); // 렌더 중 상태 갱신(값이 다를 때만)
  return next;
}

/**
 * 한 Day의 구간·시각(스펙 §4.2·§4.3). 구간마다 `RouteLookup.leg`로 경로를 묻는데, 고른 Day의 구간을 먼저,
 * 그다음 다른 Day의 구간을 차례로 미리 묻는다. 결과가 오기 전이나 실패한 구간은 직선 추정으로 계산한다.
 * 이미 답을 받은 구간(경로·경로 없음·실패)은 다시 묻지 않고, 연결 실패는 요청 목록이 바뀔 때와
 * 인터넷이 돌아올 때(`online`) 다시 묻는다. 돌려주는 값은 내용이 같으면 렌더 사이에 같은 참조다.
 */
export function useDayPlan(tripId: string, dayIndex: number): DayPlan {
  const library = useAtomValue(libraryAtom);
  const states = useAtomValue(routeStatesAtom);
  const store = useStore();
  const trip = liveTrip(library, tripId);

  // 문서가 바뀌어도 이 Day의 구간(장소 참조·수단)이 같으면 이전 배열을 그대로 쓴다.
  const legs = useStableArray(trip === null ? [] : dayLegs(library, trip, dayIndex), sameLeg);
  // 이 Day 구간의 조회 결과만. 다른 Day의 결과가 와도 참조가 바뀌지 않는다.
  const dayStates = useStableArray(legs.map((leg) => states[routeKeyOf(leg)]));
  const day = trip?.days[dayIndex];
  const stops = useStableArray(day === undefined ? [] : visibleStops(library, day));
  const { start, end } =
    trip === null ? { start: null, end: null } : dayEndpoints(library, trip, dayIndex);
  const hasStart = start !== null;
  const hasEnd = end !== null;
  const startTime = day?.startTime.value ?? '09:00';

  // 요청할 구간 키(고른 Day 먼저). 문자열 하나로 만들어 내용이 같으면 효과가 다시 돌지 않게 한다.
  const requestKeys = useMemo(() => {
    if (trip === null) return '';
    const order = [dayIndex, ...trip.days.keys()].filter((d, i) => i === 0 || d !== dayIndex);
    const keys = new Set<string>();
    for (const d of order) {
      for (const leg of dayLegs(library, trip, d)) {
        if (!isSamePointLeg(leg)) keys.add(routeKeyOf(leg));
      }
    }
    return [...keys].join('\n');
  }, [library, trip, dayIndex]);

  useEffect(() => {
    if (requestKeys === '') return;
    const pending = requestKeys.split('\n').filter((key) => {
      const known = store.get(routeStatesAtom)[key];
      return known === undefined || known.status === 'offline';
    });
    if (pending.length === 0) return;
    return forkEffect(lookupAll(store, pending, false));
  }, [requestKeys, store]);

  // 인터넷이 돌아오면 연결 실패로 어림값을 쓰던 구간만 다시 묻는다.
  useEffect(() => {
    if (requestKeys === '') return;
    let cancel: (() => void) | null = null;
    const onOnline = () => {
      const states = store.get(routeStatesAtom);
      const offline = requestKeys.split('\n').filter((key) => states[key]?.status === 'offline');
      if (offline.length === 0) return;
      cancel?.();
      cancel = forkEffect(lookupAll(store, offline, false));
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      cancel?.();
    };
  }, [requestKeys, store]);

  const planned = useMemo(
    () => legs.map((leg, i) => planLeg(leg, dayStates[i])),
    [legs, dayStates],
  );

  const schedule = useMemo(
    () =>
      computeSchedule({
        startTime,
        hasStart,
        stops: stops.map((s) => ({ stayMin: s.stayMin, fixedTime: s.fixedTime })),
        hasEnd,
        legs: planned.map((leg) => leg.time),
      }),
    [startTime, hasStart, stops, hasEnd, planned],
  );

  let oldestQueriedAt: string | null = null;
  for (const leg of planned) {
    if (leg.queriedAt === null) continue;
    if (oldestQueriedAt === null || Date.parse(leg.queriedAt) < Date.parse(oldestQueriedAt)) {
      oldestQueriedAt = leg.queriedAt;
    }
  }
  const offline = legs.some((leg, i) => !isSamePointLeg(leg) && dayStates[i]?.status === 'offline');

  // 다시 요청은 화면이 사라져도 끝까지 돌게 둔다(결과는 공용 atom에 남아 다음에 쓴다).
  const refresh = useCallback(() => {
    const keys = legs.filter((leg) => !isSamePointLeg(leg)).map(routeKeyOf);
    if (keys.length > 0) forkEffect(lookupAll(store, keys, true));
  }, [legs, store]);
  const retryLeg = useCallback(
    (key: string) => {
      const leg = legs.find((l) => l.key === key);
      if (leg === undefined || isSamePointLeg(leg)) return;
      forkEffect(lookupAll(store, [routeKeyOf(leg)], true));
    },
    [legs, store],
  );

  return useMemo(
    () => ({ legs: planned, schedule, oldestQueriedAt, offline, refresh, retryLeg }),
    [planned, schedule, oldestQueriedAt, offline, refresh, retryLeg],
  );
}
