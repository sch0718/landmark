import type { EffectiveDay } from 'src/domain/overlay';
import type { Leg, Stop, TripData } from 'src/schema/trip-data';

/** 화면용 구간. 원본에 없는 쌍은 `unrouted`(직선거리)로 만든다. */
export type DisplayLeg = Omit<Leg, 'status'> & { status: 'routed' | 'failed' | 'unrouted' };

const EARTH_RADIUS_M = 6_371_000;

const legKey = (fromPlaceKey: string, toPlaceKey: string): string =>
  `${fromPlaceKey}→${toPlaceKey}`;

/** 두 좌표 사이 하버사인 거리(m, 정수). */
function haversineM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** TripData의 모든 routed Leg를 `fromPlaceKey→toPlaceKey`로 색인한다(날짜 무관, 방향 구분). */
export function buildLegIndex(trip: TripData): Map<string, Leg> {
  const index = new Map<string, Leg>();
  for (const day of trip.days) {
    for (const leg of day.legs) {
      if (leg.status !== 'routed') continue;
      const key = legKey(leg.fromPlaceKey, leg.toPlaceKey);
      if (!index.has(key)) index.set(key, leg);
    }
  }
  return index;
}

/** 두 stop 사이 구간. 어느 한쪽 장소가 trip.places에 없으면 null(그 구간은 빼고 던지지 않는다). */
function pairLeg(from: Stop, to: Stop, trip: TripData, index: Map<string, Leg>): DisplayLeg | null {
  const found = index.get(legKey(from.placeKey, to.placeKey));
  if (found) return { ...found, fromStopId: from.id, toStopId: to.id };
  const a = trip.places[from.placeKey];
  const b = trip.places[to.placeKey];
  if (!a || !b) return null;
  return {
    fromStopId: from.id,
    toStopId: to.id,
    fromPlaceKey: from.placeKey,
    toPlaceKey: to.placeKey,
    status: 'unrouted',
    distanceM: haversineM(a, b),
    distanceKind: 'straight',
    durationMs: null,
    staticDurationMs: null,
    tollFare: null,
    path: [
      [a.lng, a.lat],
      [b.lng, b.lat],
    ],
    queriedAt: null,
  };
}

/**
 * 실효 일정의 하루에 대한 표시용 구간.
 * 원본 그대로인 날(base이고 배치 규칙으로 빠진 방문이 없음)만 원본 legs를 쓰고,
 * 그 밖의 날은 실효 stops의 연속 쌍마다 색인을 재사용하거나 unrouted 구간을 만든다.
 * 장소 정보가 없는 stop이 낀 쌍은 구간을 만들지 않는다(화면은 stop id로 구간을 찾는다).
 */
export function effectiveLegs(
  day: EffectiveDay,
  trip: TripData,
  index: Map<string, Leg>,
): DisplayLeg[] {
  if (day.source === 'base' && day.removedByPlacement.length === 0) {
    return trip.days.find((d) => d.date === day.date)?.legs.map((leg) => ({ ...leg })) ?? [];
  }
  const legs: DisplayLeg[] = [];
  for (let i = 1; i < day.stops.length; i++) {
    const leg = pairLeg(day.stops[i - 1]!, day.stops[i]!, trip, index);
    if (leg) legs.push(leg);
  }
  return legs;
}
