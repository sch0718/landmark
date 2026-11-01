import type { ShareDocV2 } from 'src/schema/share';
import { SHARE_TRIP_LIMITS } from './check-share-trip';

export const AGENT_INBOX_LIMITS = {
  fileBytes: 5_242_880,
  places: 200,
  hashChars: 32_000,
  decodedBytes: 393_216,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 모양과 큰 모음의 길이를 먼저 검사해 스키마의 대량 오류 수집을 막는다. */
export function agentRawProblem(
  json: unknown,
): 'corrupt' | 'not-trip' | 'too-many' | 'labels' | 'path' | 'leg-modes' | null {
  // 장소만 담은 v1 공유 문서는 모양을 더 보지 않고 여행 문서가 아니라고 알린다.
  if (isRecord(json) && json.format === 'tripmap-share' && json.version === 1) return 'not-trip';
  if (
    !isRecord(json) ||
    !Array.isArray(json.labels) ||
    !Array.isArray(json.places) ||
    !Array.isArray(json.trips) ||
    json.trips.length !== 1
  )
    return 'corrupt';
  const trip: unknown = json.trips[0];
  if (
    !isRecord(trip) ||
    !Array.isArray(trip.days) ||
    trip.days.length > SHARE_TRIP_LIMITS.maxDays ||
    !isRecord(trip.legModes) ||
    !Array.isArray(trip.candidateIds)
  )
    return 'corrupt';

  let placedCount = trip.candidateIds.length;
  if (placedCount > json.places.length) return 'corrupt';
  let maxLegModes = 0;
  let hasPath = false;
  for (const day of trip.days) {
    if (
      !isRecord(day) ||
      !Array.isArray(day.stops) ||
      !Array.isArray(day.legs) ||
      day.legs.length > day.stops.length + 1
    )
      return 'corrupt';
    placedCount += day.stops.length;
    if (placedCount > json.places.length) return 'corrupt';
    maxLegModes += day.stops.length + 1;
    for (const stop of day.stops) {
      if (!isRecord(stop)) return 'corrupt';
    }
    for (const leg of day.legs) {
      if (!isRecord(leg) || !Array.isArray(leg.path)) return 'corrupt';
      if (leg.path.length > 0) hasPath = true;
    }
  }
  let hasLabels = json.labels.length > 0;
  for (const place of json.places) {
    if (!isRecord(place) || !Array.isArray(place.labelIds)) return 'corrupt';
    if (place.labelIds.length > 0) hasLabels = true;
  }
  if (json.places.length > AGENT_INBOX_LIMITS.places) return 'too-many';
  if (hasLabels) return 'labels';
  if (hasPath) return 'path';
  let count = 0;
  for (const key in trip.legModes) {
    if (Object.hasOwn(trip.legModes, key) && ++count > maxLegModes) return 'leg-modes';
  }
  return null;
}

export const AGENT_PLACE_LIMITS = {
  nameChars: 100,
  addressChars: 200,
  titleChars: 60,
  memoChars: 10_000,
  numericIdPattern: /^\d{1,20}$/,
  googleIdChars: 64,
} as const;

/**
 * 문서 하나의 제목·라벨·장소 내용·출처 id를 받은함 기준으로 검사한다.
 * 에이전트 문서는 장소 라벨을 싣지 않는다(설계 「하지 않는 것」). 라벨 수를 묶지 않으면
 * 서버의 모의 가져오기가 라벨마다 보관함을 복사해 작은 요청으로도 CPU를 오래 쓴다.
 */
export function agentDocProblem(doc: ShareDocV2): 'title' | 'labels' | 'place-too-long' | null {
  const limits = AGENT_PLACE_LIMITS;
  if (doc.title.length > limits.titleChars || doc.trips[0]!.title.length > limits.titleChars)
    return 'title';
  if (doc.labels.length > 0 || doc.places.some((place) => place.labelIds.length > 0))
    return 'labels';
  for (const place of doc.places) {
    if (
      place.name.length > limits.nameChars ||
      place.address.length > limits.addressChars ||
      (place.memo !== undefined && place.memo.length > limits.memoChars) ||
      (place.naverSid !== undefined && !limits.numericIdPattern.test(place.naverSid)) ||
      (place.kakaoId !== undefined && !limits.numericIdPattern.test(place.kakaoId)) ||
      (place.googleId !== undefined && place.googleId.length > limits.googleIdChars)
    )
      return 'place-too-long';
  }
  return null;
}
