import {
  insertStop,
  moveStop,
  removeCandidate,
  setLodging,
  unscheduleStop,
} from 'src/domain/trips/ops';
import type { Library } from 'src/schema/library';
import { directionParticle } from 'src/sections/trips/planner/format';
import type { TripOp } from 'src/sections/trips/planner/use-trip-undo';

// 계획 화면의 넣기·빼기·옮기기(행 메뉴·끌기·`＋`·지도 위 카드가 함께 쓴다).
// 자리는 화면의 문서가 아니라 저장 직전의 최신본(잠금 안)에서 정한다. 그사이 다른 탭이 Day를 바꿨어도
// "그 행 앞"·"그 Day 끝"이 뜻대로 된다.

/** 되돌리기 토스트 문구(넣기·빼기·옮기기). */
export const insertedMessage = (dayIndex: number) => `Day ${dayIndex + 1}에 넣었어요`;
export function movedMessage(dayIndex: number): string {
  const day = `Day ${dayIndex + 1}`;
  return `${day}${directionParticle(day)} 옮겼어요`;
}
export const UNSCHEDULED_MESSAGE = '후보로 뺐어요';
export const REMOVED_MESSAGE = '후보에서 뺐어요';
/** 숙소 정하기·빼기의 되돌리기 토스트 문구. */
export const LODGING_SET_MESSAGE = '숙소를 정했어요';
export const LODGING_CLEARED_MESSAGE = '숙소를 뺐어요';

/** 최신본에서 Day의 Stop 수(끝 자리). */
function endOf(lib: Library, tripId: string, dayIndex: number): number {
  return lib.trips[tripId]?.days[dayIndex]?.stops.value.length ?? 0;
}

/** 최신본에서 Stop `stopId`의 자리. 없으면(다른 곳에서 뺐음) 끝 자리. */
function indexOf(lib: Library, tripId: string, dayIndex: number, stopId: string): number {
  const stops = lib.trips[tripId]?.days[dayIndex]?.stops.value ?? [];
  const index = stops.findIndex((s) => s.id === stopId);
  return index < 0 ? stops.length : index;
}

/** 장소(후보)를 Day 끝에 넣는다. */
export const insertAtEnd =
  (tripId: string, placeId: string, dayIndex: number): TripOp =>
  (lib, ctx) =>
    insertStop(lib, tripId, placeId, dayIndex, endOf(lib, tripId, dayIndex), ctx);

/** 장소(후보)를 Day의 Stop `targetStopId` 자리(그 앞)에 넣는다. */
export const insertAt =
  (tripId: string, placeId: string, dayIndex: number, targetStopId: string): TripOp =>
  (lib, ctx) =>
    insertStop(lib, tripId, placeId, dayIndex, indexOf(lib, tripId, dayIndex, targetStopId), ctx);

/** Stop을 Day 끝으로 옮긴다. */
export const moveToEnd =
  (tripId: string, stopId: string, dayIndex: number): TripOp =>
  (lib, ctx) =>
    moveStop(lib, tripId, stopId, dayIndex, endOf(lib, tripId, dayIndex), ctx);

/**
 * 같은 Day 안에서 Stop을 `targetStopId`의 자리로 옮긴다(배열 이동: 아래로 가면 그 뒤, 위로 가면 그 앞).
 * 위로·아래로(이웃 행)와 시간표 안 끌기가 쓴다.
 */
export const moveOnto =
  (tripId: string, stopId: string, dayIndex: number, targetStopId: string): TripOp =>
  (lib, ctx) =>
    moveStop(lib, tripId, stopId, dayIndex, indexOf(lib, tripId, dayIndex, targetStopId), ctx);

export const unschedule =
  (tripId: string, stopId: string): TripOp =>
  (lib, ctx) =>
    unscheduleStop(lib, tripId, stopId, ctx);

export const dropCandidate =
  (tripId: string, placeId: string): TripOp =>
  (lib, ctx) =>
    removeCandidate(lib, tripId, placeId, ctx);

/**
 * Day의 숙소를 정한다(`placeId`가 null이면 뺀다). `alsoFollowingDays`면 그 뒤 Day들도 같은 숙소가 된다.
 * 여러 Day가 바뀌어도 되돌리기 기록(`diffTrip`)이 Day마다 숙소 필드를 담아 한 번에 되돌린다.
 */
export const lodgingOp =
  (tripId: string, dayIndex: number, placeId: string | null, alsoFollowingDays: boolean): TripOp =>
  (lib, ctx) =>
    setLodging(lib, tripId, dayIndex, placeId, alsoFollowingDays, ctx);

/** 숙소 연산의 토스트 문구. */
export const lodgingMessage = (placeId: string | null) =>
  placeId === null ? LODGING_CLEARED_MESSAGE : LODGING_SET_MESSAGE;
