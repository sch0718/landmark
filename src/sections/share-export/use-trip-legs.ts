import { useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useMemo } from 'react';
import type { ShareLegTime } from 'src/domain/share/build-trip-share';
import { dayLegs, type Leg } from 'src/domain/trips/query';
import { forkEffect } from 'src/lib/effect/runtime';
import {
  isSamePointLeg,
  lookupAll,
  planLeg,
  routeKeyOf,
} from 'src/sections/trips/planner/use-day-plan';
import { libraryAtom } from 'src/stores/library-state';
import { routeStatesAtom } from 'src/stores/trip-planner';

export type TripLegs = {
  /** 구간 하나의 공유 문서용 시간·거리·상태·경로선. */
  routeOf(leg: Leg): ShareLegTime;
  /** 같은 지점이 아닌 구간 수(모든 Day). */
  total: number;
  /** 그중 조회 상태가 있는 수(연결 실패 포함). */
  answered: number;
  /** 답이 있는데 받은 경로(`routed`)가 아닌 수: 경로 없음·실패·연결 실패. */
  estimated: number;
  /** 받은 경로 중 가장 이른 조회 시각. 없으면 null. */
  oldestQueriedAt: string | null;
};

const SAME_POINT: ShareLegTime = {
  durationS: 0,
  distanceM: 0,
  tollFare: null,
  status: 'same-point',
  queriedAt: null,
  path: [],
};

/**
 * 여행 하나의 모든 구간 시간(일정 공유 창, 스펙 §3.2). `active`인 동안 상태가 없는 구간만 계획 화면과 같은
 * `lookupAll`로 묻고(`routeStatesAtom`에 답이 쌓인다), 꺼지거나 화면이 사라지면 묻기를 멈춘다.
 * 그래서 여행 목록에서 창을 열어도 경로가 채워진다. 답이 없는 구간은 계획 화면처럼 직선 추정이다.
 */
export function useTripLegs(tripId: string, active: boolean): TripLegs {
  const library = useAtomValue(libraryAtom);
  const states = useAtomValue(routeStatesAtom);
  const store = useStore();

  // 같은 지점이 아닌 구간(모든 Day, `dayLegs` 순서).
  const legs = useMemo(() => {
    const trip = library.trips[tripId];
    if (trip === undefined || trip.deletedAt !== null) return [];
    return trip.days.flatMap((_, d) => dayLegs(library, trip, d)).filter((l) => !isSamePointLeg(l));
  }, [library, tripId]);

  // 요청할 구간 키. 문자열 하나로 만들어 내용이 같으면 효과가 다시 돌지 않게 한다.
  const requestKeys = useMemo(() => [...new Set(legs.map(routeKeyOf))].join('\n'), [legs]);

  useEffect(() => {
    if (!active || requestKeys === '') return;
    const known = store.get(routeStatesAtom);
    const pending = requestKeys
      .split('\n')
      .filter((key) => known[key] === undefined)
      .map((key) => ({ key, refresh: false }));
    if (pending.length === 0) return;
    return forkEffect(lookupAll(store, pending));
  }, [active, requestKeys, store]);

  const routeOf = useCallback(
    (leg: Leg): ShareLegTime => {
      if (isSamePointLeg(leg)) return SAME_POINT;
      const planned = planLeg(leg, states[routeKeyOf(leg)]);
      return {
        durationS: planned.time.durationS,
        distanceM: planned.time.distanceM,
        tollFare: planned.time.tollFare,
        status:
          planned.status === 'routed' || planned.status === 'no-route'
            ? planned.status
            : 'estimated',
        queriedAt: planned.queriedAt,
        path: planned.path,
      };
    },
    [states],
  );

  return useMemo(() => {
    let answered = 0;
    let estimated = 0;
    let oldestQueriedAt: string | null = null;
    for (const leg of legs) {
      const state = states[routeKeyOf(leg)];
      if (state === undefined) continue;
      answered += 1;
      if (state.status !== 'routed') {
        estimated += 1;
        continue;
      }
      const at = state.result.queriedAt;
      if (oldestQueriedAt === null || Date.parse(at) < Date.parse(oldestQueriedAt)) {
        oldestQueriedAt = at;
      }
    }
    return { routeOf, total: legs.length, answered, estimated, oldestQueriedAt };
  }, [legs, states, routeOf]);
}
