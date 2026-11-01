import type { ShareDocV2 } from 'src/schema/share';

export const AGENT_INBOX_LIMITS = {
  fileBytes: 5_242_880,
  places: 200,
  hashChars: 32_000,
  decodedBytes: 393_216,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 원시 JSON의 큰 배열·구간 설정을 스키마 순회 전에 거절한다. 모양 오류는 스키마에 맡긴다. */
export function agentRawProblem(json: unknown): 'labels' | 'path' | 'leg-modes' | null {
  if (!isRecord(json) || !Array.isArray(json.labels)) return null;
  if (json.labels.length > 0) return 'labels';
  if (!Array.isArray(json.trips) || json.trips.length === 0) return null;

  let maxLegModes = 0;
  for (let i = 0; i < json.trips.length; i++) {
    const trip: unknown = json.trips[i];
    if (!isRecord(trip) || !Array.isArray(trip.days)) return null;
    for (const day of trip.days) {
      if (!isRecord(day) || !Array.isArray(day.stops) || !Array.isArray(day.legs)) return null;
      if (i === 0) maxLegModes += day.stops.length + 1;
      for (const leg of day.legs) {
        if (!isRecord(leg) || !Array.isArray(leg.path)) return null;
        if (leg.path.length > 0) return 'path';
      }
    }
  }

  const trip: unknown = json.trips[0];
  if (!isRecord(trip) || !isRecord(trip.legModes)) return null;
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
