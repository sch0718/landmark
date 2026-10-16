import { describe, expect, it } from 'vitest';
import type { GeoFix } from 'src/services/geolocation';
import { computeSchedule, type LegTime, type ScheduleInput } from 'src/domain/trips/schedule';
import {
  dayClockMin,
  FIX_FRESH_MS,
  isNear,
  NEAR_ACCURACY_M,
  NEAR_M,
  pickNext,
  projectFromNow,
  todayStatus,
  usableFix,
  visitedInTrip,
} from 'src/domain/trips/today';

const T0 = '2026-10-08T01:00:00.000Z';
const f = <V>(value: V) => ({ value, updatedAt: T0 });

const leg = (durationS: number): LegTime => ({
  durationS,
  distanceM: 1000,
  tollFare: null,
  estimated: false,
});

// 날짜는 지역 시각 생성자로 만든다(시간대에 흔들리지 않게).
const trip = { startDate: f('2026-10-24'), endDate: f('2026-10-26') };

describe('todayStatus', () => {
  it.each([
    [new Date(2026, 9, 25, 10, 0), { kind: 'during', dayIndex: 1, date: '2026-10-25' }],
    [new Date(2026, 9, 25, 3, 59), { kind: 'during', dayIndex: 0, date: '2026-10-24' }],
    [new Date(2026, 9, 25, 4, 0), { kind: 'during', dayIndex: 1, date: '2026-10-25' }],
    // 어제가 기간 밖이면 새벽 경계가 없다.
    [new Date(2026, 9, 24, 3, 0), { kind: 'during', dayIndex: 0, date: '2026-10-24' }],
    [new Date(2026, 9, 27, 3, 0), { kind: 'during', dayIndex: 2, date: '2026-10-26' }],
    [new Date(2026, 9, 27, 4, 0), { kind: 'after' }],
    [new Date(2026, 9, 23, 12, 0), { kind: 'before', daysUntil: 1 }],
    [new Date(2026, 9, 20, 12, 0), { kind: 'before', daysUntil: 4 }],
    // 시작 전날 새벽: 어제(시작 이틀 전)도 기간 밖이라 그대로 시작 전.
    [new Date(2026, 9, 23, 2, 0), { kind: 'before', daysUntil: 1 }],
    // 끝난 다음 다음 날 새벽: 어제가 기간 밖.
    [new Date(2026, 9, 28, 3, 0), { kind: 'after' }],
  ])('todayStatus(%s)', (now, expected) => {
    expect(todayStatus(trip, now)).toEqual(expected);
  });

  it('하루짜리 여행도 된다', () => {
    const one = { startDate: f('2026-10-24'), endDate: f('2026-10-24') };
    expect(todayStatus(one, new Date(2026, 9, 24, 12, 0))).toEqual({
      kind: 'during',
      dayIndex: 0,
      date: '2026-10-24',
    });
    expect(todayStatus(one, new Date(2026, 9, 25, 1, 0))).toEqual({
      kind: 'during',
      dayIndex: 0,
      date: '2026-10-24',
    });
  });

  it('월 경계(11월 1일 새벽)에서도 어제를 맞게 구한다', () => {
    const t = { startDate: f('2026-10-30'), endDate: f('2026-10-31') };
    expect(todayStatus(t, new Date(2026, 10, 1, 2, 0))).toEqual({
      kind: 'during',
      dayIndex: 1,
      date: '2026-10-31',
    });
  });
});

describe('dayClockMin', () => {
  it('날짜의 지역 자정부터 지난 분(내림)', () => {
    expect(dayClockMin('2026-10-24', new Date(2026, 9, 24, 10, 30))).toBe(630);
    expect(dayClockMin('2026-10-24', new Date(2026, 9, 25, 1, 10))).toBe(1510);
    expect(dayClockMin('2026-10-24', new Date(2026, 9, 24, 10, 30, 59))).toBe(630);
  });
});

describe('visitedInTrip', () => {
  it('여행 기간 안만 다녀옴으로 친다', () => {
    expect(visitedInTrip('2026-10-23', trip)).toBe(false);
    expect(visitedInTrip('2026-10-24', trip)).toBe(true);
    expect(visitedInTrip('2026-10-26', trip)).toBe(true);
    expect(visitedInTrip('2026-10-27', trip)).toBe(false);
    expect(visitedInTrip(null, trip)).toBe(false);
    expect(visitedInTrip(undefined, trip)).toBe(false);
  });
});

describe('pickNext', () => {
  it.each([
    [[false, false, false], 0, false, []],
    [[true, false, false], 1, false, []],
    [[false, true, false], 2, false, [0]],
    [[false, false, true], 0, true, [0, 1]],
    [[true, true, true], null, false, []],
    [[], null, false, []],
    [[true, false, true], 1, true, [1]],
  ])('pickNext(%j)', (visited, nextIndex, wrapped, skipped) => {
    const r = pickNext(visited);
    expect([r.nextIndex, r.wrapped, [...r.skipped]]).toEqual([nextIndex, wrapped, skipped]);
  });
});

describe('projectFromNow', () => {
  // 09:00 출발점 → A(60분) → B(30분, 고정 12:00) → 숙소, 구간 각 20분
  const input: ScheduleInput = {
    startTime: '09:00',
    hasStart: true,
    stops: [
      { stayMin: 60, fixedTime: null },
      { stayMin: 30, fixedTime: '12:00' },
    ],
    hasEnd: true,
    legs: [leg(1200), leg(1200), leg(1200)],
  };
  const planned = computeSchedule(input);
  // 계획: 출발 540 / A 560~620 / B 640 도착(여유 80) → 720~750 / 숙소 770

  it('계획 시각이 예상대로 짜였다(전제)', () => {
    expect(planned.points.map((p) => p.arriveMin)).toEqual([540, 560, 640, 770]);
  });

  it('앞 지점 출발 = max(지금, 계획 출발): 계획 전이면 늦음 0', () => {
    const r = projectFromNow({ input, planned, nextIndex: 0, nowMin: 500, here: false });
    expect(r.points[0]!.arriveMin).toBe(560);
    expect(r.delayMin).toBe(0);
  });

  it('지금 10:30이면 A 도착 10:50(계획 09:20), 늦음 90분', () => {
    const r = projectFromNow({ input, planned, nextIndex: 0, nowMin: 630, here: false });
    expect(r.points[0]!.arriveMin).toBe(650);
    expect(r.delayMin).toBe(90);
  });

  it('here면 다음 장소 도착 = max(지금, 계획 도착)', () => {
    const r = projectFromNow({ input, planned, nextIndex: 0, nowMin: 630, here: true });
    expect(r.points[0]!.arriveMin).toBe(630);
    expect(r.delayMin).toBe(70);
    const early = projectFromNow({ input, planned, nextIndex: 0, nowMin: 500, here: true });
    expect(early.points[0]!.arriveMin).toBe(560);
    expect(early.delayMin).toBe(0);
  });

  it('고정 시각에 늦으면 slackMin 음수', () => {
    // A 계획 출발 10:20 → 11:50에 나서면 B에 12:10 도착
    const r = projectFromNow({ input, planned, nextIndex: 1, nowMin: 710, here: false });
    expect(r.points[0]!.arriveMin).toBe(730);
    expect(r.points[0]!.slackMin).toBe(-10);
    expect(r.delayMin).toBe(730 - planned.points[2]!.arriveMin);
  });

  it('출발점이 없고 첫 Stop이면 도착 = max(지금, startTime)', () => {
    const noStart: ScheduleInput = {
      startTime: '09:00',
      hasStart: false,
      stops: [
        { stayMin: 60, fixedTime: null },
        { stayMin: 30, fixedTime: null },
      ],
      hasEnd: false,
      legs: [leg(1200)],
    };
    const p = computeSchedule(noStart);
    const late = projectFromNow({
      input: noStart,
      planned: p,
      nextIndex: 0,
      nowMin: 600,
      here: false,
    });
    expect(late.points[0]!.arriveMin).toBe(600);
    expect(late.delayMin).toBe(60);
    const early = projectFromNow({
      input: noStart,
      planned: p,
      nextIndex: 0,
      nowMin: 480,
      here: false,
    });
    expect(early.points[0]!.arriveMin).toBe(540);
    expect(early.delayMin).toBe(0);
    // 두 번째 Stop은 앞 지점(첫 Stop)이 있으므로 그 출발(600) 이후로 잡는다.
    const second = projectFromNow({
      input: noStart,
      planned: p,
      nextIndex: 1,
      nowMin: 700,
      here: false,
    });
    expect(second.points[0]!.arriveMin).toBe(720);
    expect(second.delayMin).toBe(720 - p.points[1]!.arriveMin);
  });

  it('도착점이 points 끝에 들어 있다', () => {
    for (const nextIndex of [0, 1]) {
      for (const here of [false, true]) {
        const r = projectFromNow({ input, planned, nextIndex, nowMin: 630, here });
        expect(r.points).toHaveLength(input.stops.length - nextIndex + 1);
      }
    }
  });

  it('자정을 넘긴 지금(1440 이상)도 이어서 예상한다', () => {
    const r = projectFromNow({ input, planned, nextIndex: 1, nowMin: 1450, here: false });
    expect(r.points[0]!.arriveMin).toBe(1470);
    expect(r.points[0]!.slackMin).toBe(720 - 1470);
  });

  it('다음 장소가 도착점(숙소)이어도 계산된다', () => {
    const r = projectFromNow({ input, planned, nextIndex: 2, nowMin: 800, here: false });
    expect(r.points).toHaveLength(1);
    expect(r.points[0]!.arriveMin).toBe(820);
    expect(r.delayMin).toBe(50);
  });
});

describe('위치 판정', () => {
  const place = { lng: 128.6, lat: 37.7 };
  // 위도 1도 ≈ 111,195m. 정북으로 meters만큼 떨어진 위치.
  const north = (meters: number, accuracyM = 10, at = 0): GeoFix => ({
    lng: place.lng,
    lat: place.lat + meters / 111_195,
    accuracyM,
    at,
  });

  it('상수는 스펙 값', () => {
    expect([NEAR_M, NEAR_ACCURACY_M, FIX_FRESH_MS]).toEqual([150, 200, 120_000]);
  });

  it('isNear 경계', () => {
    expect(isNear(north(149, 200), place)).toBe(true);
    expect(isNear(north(149, 201), place)).toBe(false);
    expect(isNear(north(151, 10), place)).toBe(false);
    expect(isNear(north(0, 10), place)).toBe(true);
  });

  it('usableFix 경계', () => {
    const now = 1_000_000;
    const fresh = north(0, 10, now - 120_000);
    const stale = north(0, 10, now - 120_001);
    expect(usableFix(fresh, now)).toBe(fresh);
    expect(usableFix(stale, now)).toBeNull();
    expect(usableFix(null, now)).toBeNull();
  });
});
