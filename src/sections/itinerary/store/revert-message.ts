import { overlay } from 'src/domain/overlay';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import { dayName } from './format';

/**
 * 묶음 되돌리기 확인 문구(§5.8).
 * 원본과 실효 일정에서 날짜가 다른 방문 하나(누른 날이 관련된 것 우선)로 "Day a의 방문이 Day b로"를 만들고,
 * 누른 날을 뺀 나머지 날을 "다른 편집도 함께 사라져요"에 적는다. 날짜는 trip.days 순서.
 */
export function revertMessage(
  trip: TripData,
  edit: EditLayer,
  dates: string[],
  clickedDate: string,
): string {
  const order = new Map(trip.days.map((d, i) => [d.date, i]));
  const sorted = [...dates].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const inGroup = new Set(sorted);

  const baseDate = new Map<string, string>();
  for (const day of trip.days) for (const s of day.stops) baseDate.set(s.id, day.date);
  const moves: { from: string; to: string }[] = [];
  for (const day of overlay(trip, edit).days) {
    if (!inGroup.has(day.date)) continue;
    for (const s of day.stops) {
      const from = baseDate.get(s.id);
      if (from && from !== day.date && inGroup.has(from)) moves.push({ from, to: day.date });
    }
  }
  const move = moves.find((m) => m.from === clickedDate || m.to === clickedDate) ?? moves[0];

  const name = (date: string) => dayName(trip, date);
  const others = sorted.filter((d) => d !== clickedDate);
  const head = move ? `${name(move.from)}의 방문이 ${name(move.to)}로 옮겨져 있어 ` : '';
  return (
    `${head}${sorted.map(name).join(', ')}를 함께 원본으로 되돌립니다. ` +
    `${others.map(name).join(', ')}의 다른 편집도 함께 사라져요.`
  );
}
