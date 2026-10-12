import { locatePlace, type TripLocation } from 'src/domain/trips/query';
import type { Trip } from 'src/schema/trip';

// 후보 넣기 알림 문구(스펙 §2.2). 여러 곳은 새로 넣은 수만 세고, 이미 있으면 어디에 있는지 말한다.

export const ALREADY_CANDIDATE = '이미 후보에 있어요';

/** `<N>곳을 후보에 넣었어요`. */
export const addedNotice = (count: number): string => `${count}곳을 후보에 넣었어요`;

/** 이미 이 여행에 있는 장소의 위치 문구. 여행에 없으면 null. */
export function locationNotice(location: TripLocation | null): string | null {
  if (location === null) return null;
  return location.where === 'day'
    ? `이미 Day ${location.dayIndex + 1}에 있어요`
    : ALREADY_CANDIDATE;
}

/**
 * 후보에 넣은 뒤의 알림. 새로 넣은 곳이 있으면 그 수, 없으면 이미 있다는 문구다.
 * 한 곳만 넣으려 했고 그곳이 Day에 있으면 `이미 Day <N>에 있어요`.
 * `trip`은 넣은 뒤의 여행이다(없으면 후보로 본다).
 */
export function candidatesNotice(
  created: number,
  trip: Trip | undefined,
  placeIds: readonly string[],
): string {
  if (created > 0) return addedNotice(created);
  if (placeIds.length === 1 && trip !== undefined) {
    return locationNotice(locatePlace(trip, placeIds[0]!)) ?? ALREADY_CANDIDATE;
  }
  return ALREADY_CANDIDATE;
}
