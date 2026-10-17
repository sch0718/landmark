import { atom, type PrimitiveAtom } from 'jotai';
import type { PlaceHours } from 'src/server/hours';
import type { HoursLookupErrorCode } from 'src/services/errors';

// 장소 영업시간의 화면 상태(스펙 §5). 문서(보관함)에 저장하지 않는다. 기기 캐시는 `HoursLookup`이 맡는다.

/**
 * 한 네이버 장소(sid)의 영업시간 상태.
 * - `hours`: 받은 정보(옛것일 수 있음). 한 번도 못 받았으면 null. 다시 받다 실패해도 지우지 않는다.
 * - `pending`: 이 장소의 요청이 진행 중이다.
 * - `error`: 마지막 요청이 실패했으면 그 코드. 성공하면 null.
 * - `seq`: 이 상태를 만든 서버 요청 번호(`HoursAnswer.seq`·`HoursLookupError.seq`, 캐시 답은 0). 번호가 같거나
 *   큰 답만 쓴다: 나중에 *시작한* 요청의 답이 이긴다(경로와 같은 규칙).
 * - `refresh`: `error`가 `OFFLINE`일 때, 실패한 요청이 `다시 확인`(fresh)이었는가. 인터넷이 돌아오면 같은 종류로
 *   다시 묻는다(보통 요청으로 물으면 캐시가 번호 0으로 답해 순서에서 진다). 그 밖에는 false.
 */
export type HoursState = {
  hours: PlaceHours | null;
  pending: boolean;
  error: HoursLookupErrorCode | null;
  seq: number;
  refresh: boolean;
};

/** 키는 네이버 sid라 여행과 상관없이 같은 장소면 함께 쓴다. */
export const hoursStatesAtom: PrimitiveAtom<Record<string, HoursState>> = atom<
  Record<string, HoursState>
>({});
