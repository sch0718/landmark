import { addDays, daysBetween, type Trip } from 'src/schema/trip';
import type { GeoFix } from 'src/services/geolocation';
import { haversineM } from 'src/domain/trips/geo';
import {
  computeSchedule,
  type DaySchedule,
  type PointTime,
  type ScheduleInput,
} from 'src/domain/trips/schedule';

// 여행 당일 모드의 순수 규칙. 시각·위치·체크 상태를 받아 오늘 Day, 다음 장소, 늦어짐을 판정한다.

/** 이 시각 전이고 어제가 여행 기간 안이면 오늘을 어제로 본다(늦은 밤 일정이 자정을 넘기기 때문). */
export const DAY_ROLLOVER_HOUR = 4;
/** 다음 장소의 예상 도착이 계획보다 이 분 이상 늦으면 "늦음". */
export const LATE_MIN = 5;
/** 다음 장소와 직선 이 거리(m) 안이면 "지금 여기". */
export const NEAR_M = 150;
/** 위치 정확도가 이 값(m) 이하여야 "지금 여기"로 본다. */
export const NEAR_ACCURACY_M = 200;
/** 받은 지 이 시간(ms) 이내인 위치만 쓴다. */
export const FIX_FRESH_MS = 120_000;

type TripPeriod = Pick<Trip, 'startDate' | 'endDate'>;

export type TodayStatus =
  | { kind: 'during'; dayIndex: number; date: string }
  | { kind: 'before'; daysUntil: number }
  | { kind: 'after' };

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 이 기기 시간대의 'YYYY-MM-DD'. */
function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/**
 * 지금이 여행의 어느 때인지. 기준은 기기의 지역 시각이다.
 * 04:00 전이고 어제가 기간 안이면 어제를 오늘로 본다(스펙 §4.1).
 * 'YYYY-MM-DD'는 사전순이 곧 날짜순이라 문자열로 견준다.
 */
export function todayStatus(trip: TripPeriod, now: Date): TodayStatus {
  const start = trip.startDate.value;
  const end = trip.endDate.value;
  let date = localDate(now);
  if (now.getHours() < DAY_ROLLOVER_HOUR) {
    const yesterday = addDays(date, -1);
    if (yesterday >= start && yesterday <= end) date = yesterday;
  }
  if (date < start) return { kind: 'before', daysUntil: daysBetween(date, start) - 1 };
  if (date > end) return { kind: 'after' };
  return { kind: 'during', dayIndex: daysBetween(start, date) - 1, date };
}

/** `date`의 지역 자정부터 지난 분(내림). 새벽 경계로 어제를 보면 1440 이상이 된다. */
export function dayClockMin(date: string, now: Date): number {
  const [y, m, d] = date.split('-').map(Number);
  const midnight = new Date(y!, m! - 1, d!);
  return Math.floor((now.getTime() - midnight.getTime()) / 60_000);
}

/** 다녀온 날짜가 이 여행 기간 안인가(지난 여행에서 다녀온 날짜는 이번 체크가 아니다). */
export function visitedInTrip(visitedOn: string | null | undefined, trip: TripPeriod): boolean {
  if (!visitedOn) return false;
  return visitedOn >= trip.startDate.value && visitedOn <= trip.endDate.value;
}

export type NextPick = {
  /** 다음 Stop의 자리. 모두 다녀왔거나 Stop이 없으면 null(그때는 숙소를 화면 모델이 고른다). */
  nextIndex: number | null;
  /** 마지막 체크 뒤에 미체크가 없어 앞쪽으로 되감았는가. */
  wrapped: boolean;
  /** 마지막 체크보다 앞에 있는 미체크 Stop(건너뛴 곳). */
  skipped: ReadonlySet<number>;
};

/** 스펙 §4.5의 1~3. `visited[i]`는 그날 보이는 i번째 Stop의 다녀옴 여부. */
export function pickNext(visited: readonly boolean[]): NextPick {
  const last = visited.lastIndexOf(true);
  const skipped = new Set<number>();
  for (let i = 0; i < last; i++) if (!visited[i]) skipped.add(i);

  const after = visited.findIndex((v, i) => i > last && !v);
  if (after !== -1) return { nextIndex: after, wrapped: false, skipped };
  // 마지막 체크 뒤에 미체크가 없다. 앞쪽에 건너뛴 곳이 있으면 되감는다.
  const first = visited.indexOf(false);
  if (first !== -1) return { nextIndex: first, wrapped: true, skipped };
  return { nextIndex: null, wrapped: false, skipped };
}

export type Projection = {
  /** 다음 장소부터 그날 끝(도착점 포함)까지의 예상 시각. */
  points: PointTime[];
  /** 다음 장소의 예상 도착 − 계획 도착(분). 분 반올림 때문에 ±1분 흔들릴 수 있다(자르지 않는다). */
  delayMin: number;
};

/**
 * "지금 나서면" 예상(스펙 §4.6). `nextIndex`는 Stop 자리이고, 도착점(숙소)이면 `stops.length`다.
 * 앞 지점이 있고 `here`가 아니면 앞 지점을 출발점으로 두고 출발 = max(지금, 앞 지점 계획 출발),
 * 그 밖에는 다음 장소 도착 = max(지금, 계획 도착). 계획보다 이르게 잡지 않는다.
 */
export function projectFromNow(args: {
  input: ScheduleInput;
  planned: DaySchedule;
  nextIndex: number;
  nowMin: number;
  here: boolean;
}): Projection {
  const { input, planned, nextIndex, nowMin, here } = args;
  const offset = input.hasStart ? 1 : 0;
  // 자리가 음수·소수이거나 점 범위를 벗어나면 예상할 것이 없다.
  const nextPlanned =
    Number.isInteger(nextIndex) && nextIndex >= 0 ? planned.points[offset + nextIndex] : undefined;
  if (nextPlanned === undefined) return { points: [], delayMin: 0 };

  const previous =
    nextIndex > 0 || input.hasStart ? planned.points[offset + nextIndex - 1] : undefined;
  let points: PointTime[];
  if (previous !== undefined && !here) {
    const schedule = computeSchedule({
      ...input,
      hasStart: true,
      startMin: Math.max(nowMin, previous.departMin),
      stops: input.stops.slice(nextIndex),
      legs: input.legs.slice(offset + nextIndex - 1),
    });
    points = schedule.points.slice(1);
  } else {
    const schedule = computeSchedule({
      ...input,
      hasStart: false,
      startMin: Math.max(nowMin, nextPlanned.arriveMin),
      stops: input.stops.slice(nextIndex),
      legs: input.legs.slice(offset + nextIndex),
    });
    points = schedule.points;
  }
  const first = points[0];
  return { points, delayMin: first === undefined ? 0 : first.arriveMin - nextPlanned.arriveMin };
}

/** 받은 지 `FIX_FRESH_MS` 이내인 위치만 쓴다. */
export function usableFix(fix: GeoFix | null, nowMs: number): GeoFix | null {
  if (fix === null) return null;
  return nowMs - fix.at <= FIX_FRESH_MS ? fix : null;
}

/** "지금 여기": 정확도가 충분하고 장소와 직선 `NEAR_M` 이내. */
export function isNear(fix: GeoFix, place: { lng: number; lat: number }): boolean {
  return (
    fix.accuracyM <= NEAR_ACCURACY_M &&
    haversineM([fix.lng, fix.lat], [place.lng, place.lat]) <= NEAR_M
  );
}
