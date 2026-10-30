import { queriedLabel } from 'src/sections/trips/planner/format';
import { useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useMemo } from 'react';
import type { ShareLegTime } from 'src/domain/share/build-trip-share';
import { dayLegs, type Leg } from 'src/domain/trips/query';
import {
  isSamePointLeg,
  planLeg,
  requestLegs,
  routeKeyOf,
  useOnlineRetry,
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
 * 여행 하나의 모든 구간 시간(일정 공유 창, 스펙 §3.2). `active`인 동안 계획 화면과 같은 방식으로 묻는다:
 * 상태가 없는 구간과 연결 실패였던 구간을 열 때 묻고, 인터넷이 돌아오면(`online`) 연결 실패 구간을 다시
 * 묻는다(`routeStatesAtom`에 답이 쌓인다). 꺼지거나 화면이 사라지면 묻기를 멈춘다.
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

  useEffect(
    () => (active ? requestLegs(store, requestKeys) : undefined),
    [active, requestKeys, store],
  );
  // 인터넷이 돌아오면 연결 실패 구간을 다시 묻는다(창이 열려 있는 동안만).
  useOnlineRetry(store, active ? requestKeys : '');

  const routeOf = useCallback(
    (leg: Leg): ShareLegTime => {
      if (isSamePointLeg(leg)) return SAME_POINT;
      const planned = planLeg(leg, states[routeKeyOf(leg)]);
      const routed = planned.status === 'routed';
      return {
        durationS: planned.time.durationS,
        distanceM: planned.time.distanceM,
        tollFare: planned.time.tollFare,
        status: routed ? 'routed' : planned.status === 'no-route' ? 'no-route' : 'estimated',
        // 받은 경로가 아니면 경로선·조회 시각이 없다(계획 화면의 직선 추정 선은 넣지 않는다).
        queriedAt: routed ? planned.queriedAt : null,
        path: routed ? planned.path : [],
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

/** 경로 상태 한 줄(스펙 §3.2). 구간이 없으면 null. */
export function legStatus(legs: TripLegs): string | null {
  if (legs.total === 0) return null;
  if (legs.answered < legs.total) {
    return `이동 경로를 받는 중이에요 (${legs.answered}/${legs.total})`;
  }
  if (legs.estimated > 0) return `${legs.estimated}구간은 경로를 받지 못해 어림값으로 들어가요`;
  // `queriedLabel`은 `10월 16일 조회`(계획 화면과 같은 날짜 규칙).
  if (legs.oldestQueriedAt !== null) {
    return `이동 시간은 ${queriedLabel(legs.oldestQueriedAt)} 기준이에요`;
  }
  return null;
}
