import { setVisitedOn, type OpCtx, type OpResult } from 'src/domain/library/ops';
import { visitedOnOf } from 'src/domain/library/visit';
import type { Library } from 'src/schema/library';

// 여행 당일 모드의 다녀옴 체크·풀기·되돌리기 연산(스펙 §4.4). `LibraryStore.update` 안에서 최신본에 적용한다.
// 쓰기는 F2의 `setVisitedOn`만 쓴다. `markVisited`(늦은 날 유지)·`markVisitedToday`(기기 날짜)는 날짜 규칙이 달라 쓰지 않는다.

export type VisitOp = (lib: Library, ctx: OpCtx) => OpResult;

/** 장소의 다녀온 날을 `visitedOn`(오늘 Day의 날짜)으로 쓰거나, `null`이면 지운다. */
export function markVisit(placeId: string, visitedOn: string | null): VisitOp {
  return (lib, ctx) => setVisitedOn(lib, { [placeId]: visitedOn }, ctx);
}

/**
 * 체크·풀기를 되돌린다. 지금 값이 그때 쓴 값(`expected`)이면 바꾸기 전 값(`previous`, 옛 여행 날짜 포함)으로 되쓴다.
 * 그사이 다른 곳이 값을 바꿨거나 장소를 지웠으면 문서를 그대로 두고 `merged: 1`로 알린다(덮어쓰지 않는다).
 */
export function revertVisit(
  placeId: string,
  expected: string | null,
  previous: string | null,
): VisitOp {
  return (lib, ctx) => {
    const place = lib.places[placeId];
    if (place === undefined || place.deletedAt !== null || visitedOnOf(place) !== expected) {
      return { ok: true, lib, summary: { created: 0, merged: 1, restored: 0 } };
    }
    return setVisitedOn(lib, { [placeId]: previous }, ctx);
  };
}
