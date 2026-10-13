import { atom, type PrimitiveAtom } from 'jotai';
import type { Trip } from 'src/schema/trip';
import type { RouteResult } from 'src/server/route';
import type { RouteLookupErrorCode } from 'src/services/errors';

// 계획 화면(`/trips/:id`)의 화면 상태. 문서(보관함)에 저장하지 않는다.

/** 여행별로 지금 보는 Day(0부터). 없으면 Day 1. */
export const selectedDayAtom: PrimitiveAtom<Record<string, number>> = atom<Record<string, number>>(
  {},
);

/** 지도 위 카드로 보는 장소(장소 핀·후보 행·시간표 행을 눌렀을 때). */
export const mapCardAtom: PrimitiveAtom<{ tripId: string; placeId: string } | null> = atom<{
  tripId: string;
  placeId: string;
} | null>(null);

/**
 * Day 자동 나누기 미리보기. `plan[d]`는 Day d에 둘 장소 id들, `base`는 미리보기를 만든 때의 여행이다.
 * 여행이 `base`와 다른 객체가 되면(다른 편집·다른 탭) 미리보기는 낡은 것이라 닫는다.
 */
export type SplitPreview = { tripId: string; plan: string[][]; base: Trip };
export const splitPreviewAtom: PrimitiveAtom<SplitPreview | null> = atom<SplitPreview | null>(null);

/**
 * 구간 경로 조회 결과. 키는 `routeInputKey`(수단·좌표 소수 5자리)라 여행과 상관없이 같은 구간이면 함께 쓴다.
 * - `routed`: 받은 경로
 * - `no-route`: 네이버가 경로 없음(`NO_ROUTE`)
 * - `failed`: 서버 문제·시한 초과 등(`다시 시도` 대상)
 * - `offline`: 연결 실패. 다음 요청 때 다시 묻는다. `refresh`는 실패한 요청이 `다시 계산`이었는가로,
 *   다시 물을 때 같은 요청을 보낸다(보통 요청이면 캐시의 이전 경로가 답하는데, 그 경로는 실패한 요청보다
 *   먼저 시작한 요청의 것이라 순서에서 진다).
 *
 * `seq`는 이 상태를 만든 서버 요청의 순서 번호(`RouteAnswer.seq`·`RouteLookupError.seq`). 합류한 호출과
 * 캐시 읽기도 그 답을 만든 요청의 번호를 받는다. 번호가 같거나 큰 답만 쓴다: 나중에 *시작한* 요청의 답이
 * 이긴다(성공·실패 모두, 끝난 순서와 상관없이).
 */
export type RouteState = { seq: number } & (
  | { status: 'routed'; result: RouteResult }
  | { status: 'no-route' }
  | { status: 'failed'; code: RouteLookupErrorCode }
  | { status: 'offline'; refresh: boolean }
);

export const routeStatesAtom: PrimitiveAtom<Record<string, RouteState>> = atom<
  Record<string, RouteState>
>({});
