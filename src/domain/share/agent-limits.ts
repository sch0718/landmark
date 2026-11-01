import type { ShareDocV2 } from 'src/schema/share';

export const AGENT_INBOX_LIMITS = {
  fileBytes: 5_242_880,
  places: 200,
  hashChars: 32_000,
  decodedBytes: 1_048_576,
} as const;

export const AGENT_PLACE_LIMITS = {
  nameChars: 100,
  addressChars: 200,
  titleChars: 60,
  memoChars: 10_000,
  numericIdPattern: /^\d{1,20}$/,
  googleIdChars: 64,
} as const;

/** 문서 하나의 제목·장소 내용·출처 id를 받은함 기준으로 검사한다. */
export function agentDocProblem(doc: ShareDocV2): 'title' | 'place-too-long' | null {
  const limits = AGENT_PLACE_LIMITS;
  if (doc.title.length > limits.titleChars || doc.trips[0]!.title.length > limits.titleChars)
    return 'title';
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
