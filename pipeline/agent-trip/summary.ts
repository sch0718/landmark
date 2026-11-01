import type { ShareLegTime } from 'src/domain/share/build-trip-share';
import { dayEndpoints, dayLegs, tripDates, visibleStops, type Leg } from 'src/domain/trips/query';
import { computeSchedule, formatClock } from 'src/domain/trips/schedule';
import type { BuiltLibrary } from './build-library';
import type { TripPlan } from './plan-schema';

export type DaySummary = {
  date: string;
  stops: {
    key: string;
    name: string;
    arrive: string;
    depart: string;
    fixedTime: string | null;
    slackMin: number | null;
  }[];
  travelMin: number;
  estimatedLegs: number;
};

export function summarize(
  built: BuiltLibrary,
  routeOf: (leg: Leg) => ShareLegTime,
  plan: TripPlan,
): DaySummary[] {
  const { lib, tripId } = built;
  const trip = lib.trips[tripId]!;
  const dates = tripDates(trip);
  const keys = new Map(plan.places.map(({ key }) => [built.placeIds.get(key), key]));
  return trip.days.map((day, d) => {
    const { start, end } = dayEndpoints(lib, trip, d);
    const stops = visibleStops(lib, day);
    const legs = dayLegs(lib, trip, d).map(routeOf);
    const estimated = (leg: ShareLegTime) =>
      leg.status === 'estimated' || leg.status === 'no-route';
    const schedule = computeSchedule({
      startTime: day.startTime.value,
      hasStart: start !== null,
      // 앱 계획 화면처럼 null 체류를 그대로 넘긴다(계산기에서는 0분).
      stops: stops.map(({ stayMin, fixedTime }) => ({ stayMin, fixedTime })),
      hasEnd: end !== null,
      legs: legs.map((leg) => ({ ...leg, estimated: estimated(leg) })),
    });
    return {
      date: dates[d]!,
      stops: stops.map((stop, s) => {
        const point = schedule.points[s + (start === null ? 0 : 1)]!;
        return {
          key: keys.get(stop.placeId)!,
          name: lib.places[stop.placeId]!.name.value,
          arrive: formatClock(point.arriveMin),
          depart: formatClock(point.departMin),
          fixedTime: stop.fixedTime,
          slackMin: point.slackMin,
        };
      }),
      // 구간마다 반올림하지 않고, 앱 계산기의 초 합계를 분으로 바꾼 뒤 한 번만 반올림한다.
      travelMin: Math.round(schedule.totals.travelS / 60),
      estimatedLegs: legs.filter(estimated).length,
    };
  });
}
