import { daysBetween } from 'src/lib/calendar';
import type { ShareDocV2, ShareTrip } from 'src/schema/share';

/**
 * 공유 파일 v2의 관계 규칙(스펙 §5.2). Effect 없는 순수 함수라 보기 화면도 import한다.
 * `src/schema/*`는 `import type`만 쓴다.
 */
export const SHARE_TRIP_LIMITS = {
  trips: 1,
  maxDays: 30,
  stopNoteChars: 500,
  stayMaxMin: 1440,
  pathPointsPerLeg: 500,
  pathPointsTotal: 40_000,
} as const;

/** 그날 점 목록: [출발점?, …Stop, 도착점?]. 출발점은 Day 0이면 originId, 그 뒤는 전날 lodgingId. */
export function dayPoints(trip: ShareTrip, dayIndex: number): string[] {
  const day = trip.days[dayIndex];
  if (!day) return [];
  const start = dayIndex === 0 ? trip.originId : (trip.days[dayIndex - 1]?.lodgingId ?? null);
  const points: string[] = [];
  if (start) points.push(start);
  for (const stop of day.stops) points.push(stop.placeId);
  if (day.lodgingId) points.push(day.lodgingId);
  return points;
}

/** 스펙 §5.2 표의 관계 규칙. 문제마다 한국어 한 줄, 없으면 []. */
export function checkShareTrip(doc: ShareDocV2): string[] {
  const problems: string[] = [];
  const ids = new Set(doc.places.map((p) => p.id));
  if (ids.size !== doc.places.length) problems.push('장소 id가 겹쳐요');
  if (doc.places.length < 1) problems.push('장소가 하나도 없어요');
  if (doc.trips.length !== SHARE_TRIP_LIMITS.trips) {
    problems.push(`여행은 정확히 ${SHARE_TRIP_LIMITS.trips}개여야 해요`);
  }

  const used = new Set<string>();
  let pathTotal = 0;

  doc.trips.forEach((trip, ti) => {
    const at = `trips[${ti}]`;
    const span = daysBetween(trip.startDate, trip.endDate);
    if (span < 1) problems.push(`${at}: 시작일이 종료일보다 늦어요`);
    else if (span > SHARE_TRIP_LIMITS.maxDays) {
      problems.push(`${at}: 여행은 ${SHARE_TRIP_LIMITS.maxDays}일까지예요`);
    }
    if (trip.days.length !== span) {
      problems.push(`${at}: 기간은 ${span}일인데 days가 ${trip.days.length}개예요`);
    }

    const known = (id: string, what: string) => {
      if (!ids.has(id)) {
        problems.push(`${at}: ${what}가 places에 없어요 (${id})`);
        return;
      }
      used.add(id);
    };

    if (trip.originId !== null) known(trip.originId, 'originId');

    const placed = new Set<string>();
    const place = (id: string, what: string) => {
      known(id, what);
      if (placed.has(id)) problems.push(`${at}: 장소는 한 번만 넣을 수 있어요 (${id})`);
      placed.add(id);
    };
    trip.candidateIds.forEach((id, i) => place(id, `candidateIds[${i}]`));

    trip.days.forEach((day, di) => {
      const dt = `${at}.days[${di}]`;
      if (day.lodgingId !== null) known(day.lodgingId, `days[${di}].lodgingId`);
      day.stops.forEach((stop, si) => place(stop.placeId, `days[${di}].stops[${si}].placeId`));

      const points = dayPoints(trip, di);
      const expected = Math.max(0, points.length - 1);
      if (day.legs.length !== expected) {
        problems.push(`${dt}: 구간은 ${expected}개여야 하는데 ${day.legs.length}개예요`);
      }
      day.legs.forEach((leg, li) => {
        const lt = `${dt}.legs[${li}]`;
        if (li < expected && (leg.from !== points[li] || leg.to !== points[li + 1])) {
          problems.push(`${lt}: 출발·도착이 그날 점 순서와 달라요`);
        }
        if (leg.status === 'routed') {
          if (leg.queriedAt === null)
            problems.push(`${lt}: 경로를 받은 구간인데 조회 시각이 없어요`);
        } else {
          if (leg.queriedAt !== null)
            problems.push(`${lt}: 경로를 받지 않은 구간에 조회 시각이 있어요`);
          if (leg.path.length > 0) problems.push(`${lt}: 경로를 받지 않은 구간에 경로선이 있어요`);
        }
        if (leg.path.length > SHARE_TRIP_LIMITS.pathPointsPerLeg) {
          problems.push(`${lt}: 경로선은 구간당 ${SHARE_TRIP_LIMITS.pathPointsPerLeg}점까지예요`);
        }
        pathTotal += leg.path.length;
      });
    });

    for (const key of Object.keys(trip.legModes)) {
      const parts = key.split('>');
      if (parts.length !== 2 || !ids.has(parts[0]!) || !ids.has(parts[1]!)) {
        problems.push(`${at}: legModes 키가 올바르지 않아요 (${key})`);
      }
    }
  });

  if (pathTotal > SHARE_TRIP_LIMITS.pathPointsTotal) {
    problems.push(`경로선은 문서 전체 ${SHARE_TRIP_LIMITS.pathPointsTotal}점까지예요`);
  }
  for (const p of doc.places) {
    if (!used.has(p.id)) problems.push(`여행이 쓰지 않는 장소가 있어요 (${p.id})`);
  }
  return problems;
}
