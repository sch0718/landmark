import type { Place, Stop } from 'src/schema/legacy/trip-data';
import type { TripSource } from 'src/schema/legacy/trip-source';

export class UnresolvedPlacesError extends Error {
  places: { date: string; place: string }[];

  constructor(places: { date: string; place: string }[]) {
    super(`찾을 수 없는 장소: ${places.map((p) => `${p.date} ${p.place}`).join(', ')}`);
    this.name = 'UnresolvedPlacesError';
    this.places = places;
  }
}

/** yaml `place` → PlaceKey. 숫자 문자열은 `n:<sid>`, 그 외는 `c:<key>`. */
export const placeKeyOf = (place: string): string =>
  /^\d+$/.test(place) ? `n:${place}` : `c:${place}`;

/** yaml의 stop을 placeKey로 연결한다. 숫자 문자열은 네이버 sid, 그 외는 customPlaces key. */
export function resolveStops(
  source: TripSource,
  places: Record<string, Place>,
): { date: string; stops: Stop[] }[] {
  const unresolved: { date: string; place: string }[] = [];
  const days = source.days.map((day) => {
    const stops: Stop[] = [];
    for (const s of day.stops) {
      const placeKey = placeKeyOf(s.place);
      if (!(placeKey in places)) {
        unresolved.push({ date: day.date, place: s.place });
        continue;
      }
      if (s.id === undefined)
        throw new Error(`stop id가 없습니다(ensureIds 먼저 실행): ${day.date} ${s.place}`);
      const stop: Stop = { id: s.id, placeKey };
      if (s.time !== undefined) stop.time = s.time;
      if (s.note !== undefined) stop.note = s.note;
      stops.push(stop);
    }
    return { date: day.date, stops };
  });
  if (unresolved.length > 0) throw new UnresolvedPlacesError(unresolved);
  return days;
}
