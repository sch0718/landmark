import { dayPoints, dayStartId } from 'src/domain/share/check-share-trip';
import { computeSchedule } from 'src/domain/trips/schedule';
import type { ShareDocV2, ShareLeg, SharePlace, ShareStop, ShareTrip } from 'src/schema/share';
import type { MapLine, MapPin } from 'src/share-protocol';
import { addDays } from 'src/sections/trips/trip-dates';

/**
 * 일정 보기(trip 모드)의 데이터 계산(스펙 §4.4, §4.6). DOM을 만지지 않는 순수 함수만 둔다.
 * 시각은 파일에 넣지 않고, 앱과 같은 `computeSchedule`로 여기서 계산한다.
 */

export type DayRow =
  | { kind: 'start'; placeId: string; icon: '🏠' | '🛏'; departMin: number }
  | { kind: 'no-start'; departMin: number }
  | {
      kind: 'stop';
      number: number;
      stop: ShareStop;
      arriveMin: number;
      departMin: number;
      slackMin: number | null;
    }
  | { kind: 'leg'; leg: ShareLeg }
  | { kind: 'end'; placeId: string; arriveMin: number };

export type DayView = {
  date: string;
  rows: DayRow[];
  totals: { travelS: number; distanceM: number; tollFare: number; approximate: boolean };
  hasLegs: boolean;
  /** 그날 `routed` 구간 조회 시각 중 가장 이른 것. 받은 경로가 없으면 null. */
  oldestQueriedAt: string | null;
};

export function dayView(trip: ShareTrip, dayIndex: number): DayView {
  const day = trip.days[dayIndex];
  const date = addDays(trip.startDate, dayIndex);
  if (day === undefined) {
    return {
      date,
      rows: [],
      totals: { travelS: 0, distanceM: 0, tollFare: 0, approximate: false },
      hasLegs: false,
      oldestQueriedAt: null,
    };
  }
  const startId = dayStartId(trip, dayIndex);
  const endId = day.lodgingId;
  const hasStart = startId !== null;
  const hasEnd = endId !== null;

  const schedule = computeSchedule({
    startTime: day.startTime,
    hasStart,
    stops: day.stops.map((s) => ({ stayMin: s.stayMin, fixedTime: s.fixedTime })),
    hasEnd,
    legs: day.legs.map((l) =>
      // 같은 지점 구간은 이동 시간이 없다.
      l.status === 'same-point'
        ? { durationS: 0, distanceM: 0, tollFare: null, estimated: false }
        : {
            durationS: l.durationS,
            distanceM: l.distanceM,
            tollFare: l.tollFare,
            estimated: l.status === 'estimated' || l.status === 'no-route',
          },
    ),
  });

  // 점(출발점?·Stop·숙소?)과 그 사이 구간을 번갈아 늘어놓는다. 구간 i는 점 i와 i+1 사이다.
  const rows: DayRow[] = [];
  let pointIndex = 0;
  let legIndex = 0;
  const pushLeg = () => {
    const leg = day.legs[legIndex++];
    if (leg !== undefined && leg.status !== 'same-point') rows.push({ kind: 'leg', leg });
  };

  if (hasStart) {
    rows.push({
      kind: 'start',
      placeId: startId,
      icon: dayIndex === 0 ? '🏠' : '🛏',
      departMin: schedule.points[pointIndex++]!.departMin,
    });
  } else if (day.stops.length > 0) {
    // 출발점이 없으면 첫 장소가 출발 시각에 도착한다.
    rows.push({ kind: 'no-start', departMin: schedule.points[0]!.arriveMin });
  }
  day.stops.forEach((stop, i) => {
    if (hasStart || i > 0) pushLeg();
    const point = schedule.points[pointIndex++]!;
    rows.push({
      kind: 'stop',
      number: i + 1,
      stop,
      arriveMin: point.arriveMin,
      departMin: point.departMin,
      slackMin: point.slackMin,
    });
  });
  if (hasEnd) {
    if (hasStart || day.stops.length > 0) pushLeg();
    rows.push({ kind: 'end', placeId: endId, arriveMin: schedule.points[pointIndex++]!.arriveMin });
  }

  let oldestQueriedAt: string | null = null;
  for (const leg of day.legs) {
    if (leg.status !== 'routed' || leg.queriedAt === null) continue;
    if (oldestQueriedAt === null || leg.queriedAt < oldestQueriedAt)
      oldestQueriedAt = leg.queriedAt;
  }

  return {
    date,
    rows,
    totals: schedule.totals,
    hasLegs: day.legs.some((l) => l.status !== 'same-point'),
    oldestQueriedAt,
  };
}

export type TripTab = { kind: 'day'; dayIndex: number } | { kind: 'candidates' };

const START_PREFIX = 'start:';
const END_PREFIX = 'end:';

/** 핀 id → 장소 id(`start:`·`end:`를 뗀다). */
export function placeIdOfPin(id: string): string {
  if (id.startsWith(START_PREFIX)) return id.slice(START_PREFIX.length);
  if (id.startsWith(END_PREFIX)) return id.slice(END_PREFIX.length);
  return id;
}

/**
 * 지도 페이지로 보낼 핀과 경로선(`draw`). 앱 계획 화면의 `trip-map-layers.ts`와 같은 규칙이다.
 * 같은 id의 핀은 한 번만 낸다(지도 페이지는 id를 걸러 주지 않는다).
 */
export function tripPins(doc: ShareDocV2, tab: TripTab): { pins: MapPin[]; lines: MapLine[] } {
  const trip = doc.trips[0];
  if (trip === undefined) return { pins: [], lines: [] };
  const places = new Map<string, SharePlace>(doc.places.map((p) => [p.id, p]));
  const pins: MapPin[] = [];
  const lines: MapLine[] = [];
  const seen = new Set<string>();
  const push = (pin: MapPin) => {
    if (seen.has(pin.id)) return;
    seen.add(pin.id);
    pins.push(pin);
  };
  const pinOf = (
    id: string,
    placeId: string,
    label: (name: string) => string,
    day: number | null,
    role: MapPin['role'],
  ) => {
    const place = places.get(placeId);
    if (place === undefined) return;
    push({ id, label: label(place.name), lng: place.lng, lat: place.lat, day, role });
  };

  if (tab.kind === 'candidates') {
    for (const placeId of trip.candidateIds) pinOf(placeId, placeId, (n) => n, null, 'stop');
    return { pins, lines };
  }

  const { dayIndex } = tab;
  const day = trip.days[dayIndex];
  if (day !== undefined) {
    day.stops.forEach((stop, i) => {
      pinOf(stop.placeId, stop.placeId, (n) => `${i + 1} ${n}`, dayIndex, 'stop');
    });
    // 1일차 출발점은 여행 출발지(집), 그 뒤는 전날 숙소. 출발점과 숙소가 같으면 하나만 둔다.
    const startId = dayStartId(trip, dayIndex);
    if (startId !== null) {
      const icon = dayIndex === 0 ? '🏠' : '🛏';
      pinOf(`${START_PREFIX}${startId}`, startId, (n) => `${icon} ${n}`, dayIndex, 'endpoint');
    }
    if (day.lodgingId !== null && day.lodgingId !== startId) {
      pinOf(`${END_PREFIX}${day.lodgingId}`, day.lodgingId, (n) => `🛏 ${n}`, dayIndex, 'endpoint');
    }

    const points = dayPoints(trip, dayIndex);
    const lineIds = new Set<string>();
    day.legs.forEach((leg, i) => {
      if (leg.status === 'same-point') return;
      const from = places.get(points[i] ?? leg.from);
      const to = places.get(points[i + 1] ?? leg.to);
      if (from === undefined || to === undefined) return;
      const path: [number, number][] =
        leg.status === 'routed' && leg.path.length >= 2
          ? leg.path
          : [
              [from.lng, from.lat],
              [to.lng, to.lat],
            ];
      // 같은 from>to 쌍이 한 Day에 두 번 나오면(출발지이자 숙소인 장소 등) 구간 번호를 붙여 id를 지킨다.
      let id = `${leg.from}>${leg.to}`;
      if (lineIds.has(id)) id = `${id}#${i}`;
      lineIds.add(id);
      lines.push({ id, day: dayIndex, walk: leg.mode === 'walk', path });
    });
  }

  // 다른 Day의 Stop: 그 Day 색의 흐린 작은 점(이름 없음).
  trip.days.forEach((other, d) => {
    if (d === dayIndex) return;
    for (const stop of other.stops) pinOf(stop.placeId, stop.placeId, () => '', d, 'dim');
  });

  return { pins, lines };
}
