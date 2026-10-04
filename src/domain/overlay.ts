import { hashDayStops } from 'src/domain/day-hash';
import type { EditLayer } from 'src/schema/edit-layer';
import type { Stop, TripData } from 'src/schema/trip-data';

export type EffectiveDay = {
  date: string;
  stops: Stop[];
  source: 'base' | 'override';
  /** override의 baseDayHash가 현재 원본 그날과 다르다(미해결 원본 변경). */
  unresolved: boolean;
  /** overlay 배치 규칙으로 이 날에서 뺀 stop id. */
  removedByPlacement: string[];
};

export type EffectiveTrip = {
  days: EffectiveDay[];
  /** 원본에 없는 날짜의 DayEdit. */
  hiddenEditDates: string[];
};

/**
 * 원본(TripData)과 로컬 편집(EditLayer)으로 실효 일정을 계산한다.
 * 배치 규칙(§3.3): 같은 stop id가 override인 날과 원본을 따르는 날에 함께 있으면
 * override인 날을 택하고 원본을 따르는 날에서 뺀다.
 */
export function overlay(trip: TripData, edit: EditLayer | null): EffectiveTrip {
  const dayEdits = edit?.days ?? {};
  const tripDates = new Set(trip.days.map((d) => d.date));

  const overrideIds = new Set<string>();
  for (const day of trip.days) {
    const dayEdit = dayEdits[day.date];
    if (dayEdit?.mode === 'override') for (const stop of dayEdit.stops) overrideIds.add(stop.id);
  }

  const days = trip.days.map((day): EffectiveDay => {
    const dayEdit = dayEdits[day.date];
    if (dayEdit?.mode === 'override') {
      return {
        date: day.date,
        stops: dayEdit.stops,
        source: 'override',
        unresolved: dayEdit.baseDayHash !== hashDayStops(day.stops),
        removedByPlacement: [],
      };
    }
    const removedByPlacement = day.stops.filter((s) => overrideIds.has(s.id)).map((s) => s.id);
    return {
      date: day.date,
      stops: day.stops.filter((s) => !overrideIds.has(s.id)),
      source: 'base',
      unresolved: false,
      removedByPlacement,
    };
  });

  const hiddenEditDates = Object.keys(dayEdits)
    .filter((date) => !tripDates.has(date))
    .sort();
  return { days, hiddenEditDates };
}

/** 여행 전체에서 두 번 이상 나타난 stop id(각 id 한 번씩). */
export function findDuplicateStopIds(days: { stops: Stop[] }[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const day of days) {
    for (const stop of day.stops) {
      if (seen.has(stop.id)) dup.add(stop.id);
      seen.add(stop.id);
    }
  }
  return [...dup];
}

/**
 * 그날을 override로 만든다. 이미 override면 그대로 반환한다.
 * 아니면 현재 실효 stops(배치 규칙으로 빠진 방문 제외)를 복사해 시작한다.
 * 입력 edit는 변경하지 않는다.
 */
export function ensureOverride(
  trip: TripData,
  edit: EditLayer,
  date: string,
  now: string,
): EditLayer {
  if (edit.days[date]?.mode === 'override') return edit;
  const baseDay = trip.days.find((d) => d.date === date);
  if (!baseDay) throw new Error(`원본에 없는 날짜입니다: ${date}`);
  const effective = overlay(trip, edit).days.find((d) => d.date === date);
  const stops = (effective?.stops ?? baseDay.stops).map((s) => ({ ...s }));
  return {
    ...edit,
    days: {
      ...edit.days,
      [date]: { mode: 'override', stops, baseDayHash: hashDayStops(baseDay.stops), updatedAt: now },
    },
  };
}
