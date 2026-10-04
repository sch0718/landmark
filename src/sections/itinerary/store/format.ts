import type { DayTotals } from 'src/domain/day-totals';
import type { DisplayLeg } from 'src/domain/leg-index';
import type { TripData } from 'src/schema/trip-data';

const wonFormat = new Intl.NumberFormat('ko-KR');

/** 분 단위로 내림. 1시간 이상이면 `2시간 31분`, 미만이면 `31분`. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

/** 미터 → 소수 1자리 km 숫자 문자열(`186.0`). */
export const formatKm = (meters: number): string => (meters / 1000).toFixed(1);

/** 천 단위 쉼표(`8,500`). */
export const formatWon = (won: number): string => wonFormat.format(won);

/** 구간 행 문구(§4.4). routed인데 통행료가 미상(null)이면 금액 부분을 생략한다. */
export function formatLeg(leg: DisplayLeg): string {
  if (leg.status === 'routed') {
    const parts = [
      `🚗 ${formatDuration(leg.durationMs ?? 0)}`,
      `도로 ${formatKm(leg.distanceM)}km`,
    ];
    if (leg.tollFare !== null) parts.push(`${formatWon(leg.tollFare)}원`);
    return parts.join(' · ');
  }
  return `┄ 직선 ${formatKm(leg.distanceM)}km · 시간 미상 · 재계산 필요`;
}

/** Day 합계 문구(§4.4). 미계산 구간이 없으면 뒷부분을 생략한다. */
export function formatTotals(t: DayTotals): string {
  const head = `계산된 구간 ${formatDuration(t.durationMs)} · 도로 ${formatKm(t.roadDistanceM)}km · ${formatWon(t.tollFare)}원`;
  if (t.uncomputedCount === 0) return head;
  return `${head} · 미계산 ${t.uncomputedCount}구간(직선 ${formatKm(t.straightDistanceM)}km)`;
}

/** 1~50 → 원문자(①…⑳, ㉑…㉟, ㊱…㊿). 범위 밖은 `(n)`. */
export function circled(n: number): string {
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCodePoint(0x32b1 + n - 36);
  return `(${n})`;
}

/** `Day 1` — trip.days 순서의 1부터 번호. */
export function dayName(trip: TripData, date: string): string {
  const i = trip.days.findIndex((d) => d.date === date);
  return i >= 0 ? `Day ${i + 1}` : date;
}

/** `Day 1 (11/14)` */
export function dayLabel(trip: TripData, date: string): string {
  return `${dayName(trip, date)} (${date.slice(5).replace('-', '/')})`;
}
