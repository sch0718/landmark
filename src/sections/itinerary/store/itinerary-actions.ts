import { ensureOverride } from 'src/domain/overlay';
import type { EditLayer } from 'src/schema/edit-layer';
import type { Stop, TripData } from 'src/schema/trip-data';

/**
 * 일정 편집 액션(순수 함수). 모두 `ensureOverride`로 그날을 override로 만든 뒤 적용한다.
 * stop은 인덱스가 아니라 id로 가리킨다 — 다른 탭의 저장이 반영된 최신 레이어에 적용될 수 있다.
 * 입력은 변경하지 않는다.
 */

function overrideStops(edit: EditLayer, date: string): Stop[] {
  const day = edit.days[date];
  if (day?.mode !== 'override') throw new Error(`override가 아닙니다: ${date}`);
  return day.stops;
}

function withStops(edit: EditLayer, date: string, stops: Stop[], now: string): EditLayer {
  const day = edit.days[date];
  if (day?.mode !== 'override') throw new Error(`override가 아닙니다: ${date}`);
  return { ...edit, days: { ...edit.days, [date]: { ...day, stops, updatedAt: now } } };
}

function indexOfStop(stops: Stop[], stopId: string, date: string): number {
  const i = stops.findIndex((s) => s.id === stopId);
  if (i < 0) throw new Error(`그날에 없는 방문입니다: ${date} ${stopId}`);
  return i;
}

/** 방문을 다른 날 끝으로 옮긴다. 같은 stop id를 유지하고 두 날을 같은 `now`로 기록한다(§3.3). */
export function moveStop(
  trip: TripData,
  edit: EditLayer,
  stopId: string,
  fromDate: string,
  toDate: string,
  now: string,
): EditLayer {
  if (fromDate === toDate) return edit;
  let next = ensureOverride(trip, edit, fromDate, now);
  next = ensureOverride(trip, next, toDate, now);
  const from = overrideStops(next, fromDate);
  const stop = from[indexOfStop(from, stopId, fromDate)]!;
  next = withStops(
    next,
    fromDate,
    from.filter((s) => s.id !== stopId),
    now,
  );
  return withStops(next, toDate, [...overrideStops(next, toDate), { ...stop }], now);
}

export function removeStop(
  trip: TripData,
  edit: EditLayer,
  date: string,
  stopId: string,
  now: string,
): EditLayer {
  const next = ensureOverride(trip, edit, date, now);
  const stops = overrideStops(next, date);
  indexOfStop(stops, stopId, date);
  return withStops(
    next,
    date,
    stops.filter((s) => s.id !== stopId),
    now,
  );
}

/** 같은 날 안에서 순서를 바꾼다. `toIndex`는 옮긴 뒤 배열에서의 위치. */
export function reorderStops(
  trip: TripData,
  edit: EditLayer,
  date: string,
  stopId: string,
  toIndex: number,
  now: string,
): EditLayer {
  const next = ensureOverride(trip, edit, date, now);
  const stops = [...overrideStops(next, date)];
  const [stop] = stops.splice(indexOfStop(stops, stopId, date), 1);
  const at = Math.max(0, Math.min(stops.length, Math.trunc(toIndex)));
  stops.splice(at, 0, stop!);
  return withStops(next, date, stops, now);
}

export type StopPatch = { time?: string | null; note?: string | null };

/** time·note를 바꾼다. `null`이면 필드를 지우고, 키가 없으면 그대로 둔다. */
export function updateStop(
  trip: TripData,
  edit: EditLayer,
  date: string,
  stopId: string,
  patch: StopPatch,
  now: string,
): EditLayer {
  const next = ensureOverride(trip, edit, date, now);
  const stops = overrideStops(next, date).map((s) => {
    if (s.id !== stopId) return s;
    const out: Stop = { ...s };
    for (const key of ['time', 'note'] as const) {
      if (!(key in patch)) continue;
      const value = patch[key];
      if (value === null || value === undefined) delete out[key];
      else out[key] = value;
    }
    return out;
  });
  indexOfStop(stops, stopId, date);
  return withStops(next, date, stops, now);
}
