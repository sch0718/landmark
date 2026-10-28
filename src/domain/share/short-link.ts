// 짧은 공유 링크(`/s/<id>#k=<키>`)의 보관 기한·모양. 서버 함수도 상대 경로로 가져오므로 import 없이 쓴다.

export type ShortLinkKind = 'places' | 'trip';

const DAY = 24 * 60 * 60 * 1000;
/** 장소는 30일, 일정은 여행 마지막 날 + 7일과 30일 중 늦은 쪽(최대 180일). */
export const SHORT_LINK_DAYS = { min: 30, max: 180, afterTrip: 7 } as const;
export const SHORT_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
export const SHORT_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** 압축 24,000바이트(해시 32,000자) + IV 12바이트 + 태그 16바이트 = 24,028바이트 → 32,038자. */
export const SHORT_BODY_MAX = 32_040;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 일정 문서에서 보관 기한의 기준일(마지막 여행의 끝날 + 7일, 한국 날짜). 장소 문서는 null. */
export function shortKeepUntil(endDates: readonly string[]): string | null {
  const last = endDates
    .filter((date) => CALENDAR_DATE.test(date))
    .sort()
    .at(-1);
  if (last === undefined) return null;
  const at = new Date(`${last}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + SHORT_LINK_DAYS.afterTrip);
  return at.toISOString().slice(0, 10);
}

/** 서버와 화면이 같은 기한을 쓰도록 한 곳에서 자른다. 기준일은 그날 한국 시각 끝까지. */
export function shortExpiresAt(
  kind: ShortLinkKind,
  keepUntil: string | null | undefined,
  now: Date,
): Date {
  const min = now.getTime() + SHORT_LINK_DAYS.min * DAY;
  const max = now.getTime() + SHORT_LINK_DAYS.max * DAY;
  if (kind !== 'trip' || !keepUntil || !CALENDAR_DATE.test(keepUntil)) return new Date(min);
  const until = new Date(`${keepUntil}T23:59:59.999+09:00`).getTime();
  if (!Number.isFinite(until)) return new Date(min);
  return new Date(Math.min(max, Math.max(min, until)));
}

/** `11월 27일`, 해가 바뀌면 `2027년 4월 26일`(한국 날짜). */
export function formatShortExpiry(at: Date, now: Date): string {
  const year = (date: Date) =>
    new Intl.DateTimeFormat('ko-KR', { year: 'numeric', timeZone: 'Asia/Seoul' }).format(date);
  return new Intl.DateTimeFormat('ko-KR', {
    ...(year(at) === year(now) ? {} : { year: 'numeric' }),
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(at);
}
