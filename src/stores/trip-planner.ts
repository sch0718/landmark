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
 * - `offline`: 연결 실패. 다음 요청 때 다시 묻는다.
 */
export type RouteState =
  | { status: 'routed'; result: RouteResult }
  | { status: 'no-route' }
  | { status: 'failed'; code: RouteLookupErrorCode }
  | { status: 'offline' };

export const routeStatesAtom: PrimitiveAtom<Record<string, RouteState>> = atom<
  Record<string, RouteState>
>({});
