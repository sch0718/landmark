import type { Library, Place } from 'src/schema/library';
import { daysBetween, type Day, type Stop, type Trip } from 'src/schema/trip';
import { autoMode, haversineM, WALK_MAX_M } from 'src/domain/trips/geo';

/** 구간 키: "<출발 PlaceId>><도착 PlaceId>". `Trip.legModes`의 키와 같다. */
export const legKey = (fromId: string, toId: string): string => `${fromId}>${toId}`;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 이 기기의 오늘('YYYY-MM-DD'). */
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** 여행의 날짜(시작일~종료일, 양 끝 포함). UTC 자정 기준이라 시간대·서머타임에 흔들리지 않는다. */
export function tripDates(trip: Trip): string[] {
  const start = trip.startDate.value;
  const count = daysBetween(start, trip.endDate.value);
  const [y, m, d] = start.split('-').map(Number);
  const base = Date.UTC(y!, m! - 1, d!);
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const dt = new Date(base + i * 86_400_000);
    dates.push(`${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`);
  }
  return dates;
}

/**
 * 지워지지 않은 여행. 시작일 오름차순(같으면 id 순)이고,
 * 이미 끝난 여행(`endDate < today`)은 뒤에 같은 순서로 모은다.
 * `today`는 'YYYY-MM-DD'이며 생략하면 이 기기의 오늘이다.
 */
export function liveTrips(lib: Library, today: string = localToday()): Trip[] {
  const byStart = (a: Trip, b: Trip): number =>
    a.startDate.value.localeCompare(b.startDate.value) || a.id.localeCompare(b.id);
  const live = Object.values(lib.trips).filter((t) => t.deletedAt === null);
  const upcoming = live.filter((t) => t.endDate.value >= today).sort(byStart);
  const past = live.filter((t) => t.endDate.value < today).sort(byStart);
  return [...upcoming, ...past];
}

/** 보관함에 있고 지워지지 않은 장소. 없거나 묘비면 null. */
function livePlace(lib: Library, placeId: string | null): Place | null {
  if (placeId === null) return null;
  const place = lib.places[placeId];
  return place !== undefined && place.deletedAt === null ? place : null;
}

/** 묘비(또는 보관함에 없는) 장소의 Stop을 뺀 Day의 Stop. 되살리면 원래 자리로 돌아온다. */
export function visibleStops(lib: Library, day: Day): Stop[] {
  return day.stops.value.filter((s) => livePlace(lib, s.placeId) !== null);
}

export function visibleCandidates(lib: Library, trip: Trip): Place[] {
  const places: Place[] = [];
  for (const id of trip.candidates.value) {
    const place = livePlace(lib, id);
    if (place !== null) places.push(place);
  }
  return places;
}

/** 보관함에서 지워져 일정 계산에서 빠진 장소 수(후보·Stop·출발지·숙소를 통틀어 장소 기준). */
export function hiddenPlaceCount(lib: Library, trip: Trip): number {
  const ids = new Set<string>(trip.candidates.value);
  if (trip.origin.value !== null) ids.add(trip.origin.value);
  for (const day of trip.days) {
    for (const stop of day.stops.value) ids.add(stop.placeId);
    if (day.lodging.value !== null) ids.add(day.lodging.value);
  }
  let hidden = 0;
  for (const id of ids) if (livePlace(lib, id) === null) hidden++;
  return hidden;
}

/** Day의 출발점·도착점. 묘비이거나 없는 장소는 null(없는 것으로 본다). */
export function dayEndpoints(
  lib: Library,
  trip: Trip,
  dayIndex: number,
): { start: Place | null; end: Place | null } {
  const day = trip.days[dayIndex];
  if (day === undefined) return { start: null, end: null };
  const startId =
    dayIndex === 0 ? trip.origin.value : (trip.days[dayIndex - 1]?.lodging.value ?? null);
  return { start: livePlace(lib, startId), end: livePlace(lib, day.lodging.value) };
}

export type Leg = {
  key: string;
  from: Place;
  to: Place;
  mode: 'car' | 'walk';
  modeSource: 'auto' | 'user';
  straightM: number;
  walkAllowed: boolean;
};

/**
 * 그날의 구간: `[출발점?, …보이는 Stop, 도착점?]`의 이웃한 쌍.
 * 장소가 0곳이면 출발점·도착점이 모두 있을 때만 구간 하나다.
 * 이동 수단은 `legModes`의 사람 선택이 우선이고, 없으면 직선거리로 자동 결정한다.
 * 직선 50km를 넘으면 도보를 고를 수 없어 사람이 `walk`를 골랐어도 자동차(`auto`)로 본다.
 */
export function dayLegs(lib: Library, trip: Trip, dayIndex: number): Leg[] {
  const day = trip.days[dayIndex];
  if (day === undefined) return [];
  const { start, end } = dayEndpoints(lib, trip, dayIndex);

  const points: Place[] = [];
  if (start !== null) points.push(start);
  for (const stop of visibleStops(lib, day)) points.push(lib.places[stop.placeId]!);
  if (end !== null) points.push(end);

  const legs: Leg[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const key = legKey(from.id, to.id);
    const straightM = haversineM([from.lng, from.lat], [to.lng, to.lat]);
    const walkAllowed = straightM <= WALK_MAX_M;
    const chosen = trip.legModes.value[key];
    let mode: 'car' | 'walk';
    let modeSource: 'auto' | 'user';
    if (chosen === 'car' || (chosen === 'walk' && walkAllowed)) {
      mode = chosen;
      modeSource = 'user';
    } else {
      mode = walkAllowed ? autoMode(straightM) : 'car';
      modeSource = 'auto';
    }
    legs.push({ key, from, to, mode, modeSource, straightM, walkAllowed });
  }
  return legs;
}

export type TripLocation =
  { where: 'candidate' } | { where: 'day'; dayIndex: number; stopIndex: number };

/** 장소가 여행의 후보 또는 어느 Day의 몇 번째 Stop에 있는지. 출발지·숙소는 위치로 치지 않는다. */
export function locatePlace(trip: Trip, placeId: string): TripLocation | null {
  if (trip.candidates.value.includes(placeId)) return { where: 'candidate' };
  for (let dayIndex = 0; dayIndex < trip.days.length; dayIndex++) {
    const stopIndex = trip.days[dayIndex]!.stops.value.findIndex((s) => s.placeId === placeId);
    if (stopIndex >= 0) return { where: 'day', dayIndex, stopIndex };
  }
  return null;
}
