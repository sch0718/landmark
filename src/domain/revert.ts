import { groupDates, placementOfEffective, placementOfTrip } from 'src/domain/date-groups';
import { overlay } from 'src/domain/overlay';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';

/** 원본과 local 실효 일정으로 날짜 묶음을 구해 `date`가 속한 묶음을 돌려준다(§5.8). */
export function planRevert(trip: TripData, edit: EditLayer, date: string): { dates: string[] } {
  const groups = groupDates(
    [placementOfTrip(trip), placementOfEffective(overlay(trip, edit))],
    trip.days.map((d) => d.date),
  );
  return { dates: groups.find((g) => g.includes(date)) ?? [date] };
}

/** 각 날짜를 reset으로 만든다. 입력 edit는 변경하지 않는다. */
export function applyRevert(edit: EditLayer, dates: string[], now: string): EditLayer {
  const days = { ...edit.days };
  for (const date of dates) days[date] = { mode: 'reset', updatedAt: now };
  return { ...edit, days };
}
