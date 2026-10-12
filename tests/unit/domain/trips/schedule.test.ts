import { describe, expect, it } from 'vitest';
import { computeSchedule, formatClock, formatSlack, type LegTime } from 'src/domain/trips/schedule';

const leg = (durationS: number, over: Partial<LegTime> = {}): LegTime => ({
  durationS,
  distanceM: 1000,
  tollFare: null,
  estimated: false,
  ...over,
});

describe('computeSchedule', () => {
  it('기본 흐름: 출발점 09:00, 구간 600초, 체류 60분', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [
        { stayMin: 60, fixedTime: null },
        { stayMin: 30, fixedTime: null },
      ],
      hasEnd: true,
      legs: [leg(600), leg(600), leg(600)],
    });
    expect(r.points).toEqual([
      { arriveMin: 540, departMin: 540, slackMin: null },
      { arriveMin: 550, departMin: 610, slackMin: null },
      { arriveMin: 620, departMin: 650, slackMin: null },
      { arriveMin: 660, departMin: 660, slackMin: null },
    ]);
    expect(r.totals).toEqual({ travelS: 1800, distanceM: 3000, tollFare: 0, approximate: false });
  });

  it('출발점이 없으면 첫 장소의 도착이 startTime', () => {
    const r = computeSchedule({
      startTime: '10:00',
      hasStart: false,
      stops: [
        { stayMin: 30, fixedTime: null },
        { stayMin: 0, fixedTime: null },
      ],
      hasEnd: false,
      legs: [leg(1200)],
    });
    expect(r.points).toEqual([
      { arriveMin: 600, departMin: 630, slackMin: null },
      { arriveMin: 650, departMin: 650, slackMin: null },
    ]);
    expect(r.totals.travelS).toBe(1200);
  });

  it('고정 시각이 도착보다 늦으면 여유: 출발 = 고정 + 체류', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [
        { stayMin: 60, fixedTime: '12:00' },
        { stayMin: 0, fixedTime: null },
      ],
      hasEnd: false,
      legs: [leg(600), leg(600)],
    });
    expect(r.points[1]).toEqual({ arriveMin: 550, departMin: 780, slackMin: 170 });
    expect(r.points[2]).toEqual({ arriveMin: 790, departMin: 790, slackMin: null });
  });

  it('고정 시각이 도착보다 이르면 늦음: 출발 = 도착 + 체류', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [{ stayMin: 30, fixedTime: '09:05' }],
      hasEnd: false,
      legs: [leg(600)],
    });
    expect(r.points[1]).toEqual({ arriveMin: 550, departMin: 580, slackMin: -5 });
  });

  it('고정 시각이 도착과 같으면 여유 0', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [{ stayMin: 10, fixedTime: '09:10' }],
      hasEnd: false,
      legs: [leg(600)],
    });
    expect(r.points[1]).toEqual({ arriveMin: 550, departMin: 560, slackMin: 0 });
  });

  it('고정 시각이 Day 시작보다 이르면 늦음(음수·NaN 없음)', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: false,
      stops: [{ stayMin: 20, fixedTime: '07:30' }],
      hasEnd: false,
      legs: [],
    });
    expect(r.points).toEqual([{ arriveMin: 540, departMin: 560, slackMin: -90 }]);
    for (const p of r.points) {
      expect(Number.isFinite(p.arriveMin) && p.arriveMin >= 0).toBe(true);
      expect(Number.isFinite(p.departMin) && p.departMin >= 0).toBe(true);
    }
  });

  it('체류가 비어 있으면(null) 0분으로 본다', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [{ stayMin: null, fixedTime: null }],
      hasEnd: true,
      legs: [leg(300), leg(300)],
    });
    expect(r.points.map((p) => p.arriveMin)).toEqual([540, 545, 550]);
    expect(r.points[1]?.departMin).toBe(545);
  });

  it('값이 이상해도 NaN이 나오지 않는다(잘못된 시각·체류)', () => {
    const r = computeSchedule({
      startTime: 'xx',
      hasStart: false,
      stops: [{ stayMin: Number.NaN, fixedTime: 'zz' }],
      hasEnd: false,
      legs: [],
    });
    expect(r.points).toEqual([{ arriveMin: 0, departMin: 0, slackMin: null }]);
  });

  it('자정을 넘기면 분이 24시간을 넘고 formatClock이 다음 날로 보여 준다', () => {
    const r = computeSchedule({
      startTime: '23:00',
      hasStart: true,
      stops: [{ stayMin: 60, fixedTime: null }],
      hasEnd: true,
      legs: [leg(1800), leg(3600)],
    });
    expect(r.points.map((p) => p.arriveMin)).toEqual([1380, 1410, 1530]);
    expect(formatClock(r.points[2]?.arriveMin ?? 0)).toBe('다음 날 01:30');
  });

  it('시계는 초로 누적하고 점마다 한 번만 반올림한다: 31초 구간 네 개', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [
        { stayMin: 0, fixedTime: null },
        { stayMin: 0, fixedTime: null },
        { stayMin: 0, fixedTime: null },
      ],
      hasEnd: true,
      legs: [leg(31), leg(31), leg(31), leg(31)],
    });
    // 31, 62, 93, 124초 → 0.52, 1.03, 1.55, 2.07분
    expect(r.points.map((p) => p.arriveMin)).toEqual([540, 541, 541, 542, 542]);
    expect(r.totals.travelS).toBe(124);
    expect(r.points[4]?.arriveMin).toBe(540 + Math.round(124 / 60));
  });

  it('29초 구간 열 개: 마지막 도착이 합계 초의 반올림과 맞는다', () => {
    const stops = Array.from({ length: 9 }, () => ({ stayMin: 0, fixedTime: null }));
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops,
      hasEnd: true,
      legs: Array.from({ length: 10 }, () => leg(29)),
    });
    expect(r.totals.travelS).toBe(290);
    expect(r.points.at(-1)?.arriveMin).toBe(540 + Math.round(290 / 60));
  });

  it('31초 여덟 구간도 시간표와 합계가 1분 안에서 맞는다', () => {
    const stops = Array.from({ length: 7 }, () => ({ stayMin: 0, fixedTime: null }));
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops,
      hasEnd: true,
      legs: Array.from({ length: 8 }, () => leg(31)),
    });
    expect(r.points.at(-1)?.arriveMin).toBe(540 + Math.round(248 / 60));
  });

  it('합계: 통행료 null은 0, 추정이 하나라도 있으면 approximate', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [{ stayMin: 0, fixedTime: null }],
      hasEnd: true,
      legs: [
        leg(600, { distanceM: 2500, tollFare: 3000 }),
        leg(900, { distanceM: 1500, tollFare: null, estimated: true }),
      ],
    });
    expect(r.totals).toEqual({ travelS: 1500, distanceM: 4000, tollFare: 3000, approximate: true });
  });

  it('구간 0개: 장소 하나만 있어도 합계는 0', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: false,
      stops: [{ stayMin: 15, fixedTime: null }],
      hasEnd: false,
      legs: [],
    });
    expect(r.points).toEqual([{ arriveMin: 540, departMin: 555, slackMin: null }]);
    expect(r.totals).toEqual({ travelS: 0, distanceM: 0, tollFare: 0, approximate: false });
  });

  it('점이 하나도 없으면 빈 결과', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: false,
      stops: [],
      hasEnd: false,
      legs: [],
    });
    expect(r.points).toEqual([]);
    expect(r.totals).toEqual({ travelS: 0, distanceM: 0, tollFare: 0, approximate: false });
  });

  it('출발점·도착점만 있는 Day는 구간 하나', () => {
    const r = computeSchedule({
      startTime: '08:30',
      hasStart: true,
      stops: [],
      hasEnd: true,
      legs: [leg(1800)],
    });
    expect(r.points).toEqual([
      { arriveMin: 510, departMin: 510, slackMin: null },
      { arriveMin: 540, departMin: 540, slackMin: null },
    ]);
  });

  it('구간 수가 모자라면 빠진 구간은 0으로 본다', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [{ stayMin: 0, fixedTime: null }],
      hasEnd: false,
      legs: [],
    });
    expect(r.points[1]?.arriveMin).toBe(540);
    expect(r.totals.approximate).toBe(true);
  });

  it('남는 구간은 무시하고 합계에도 넣지 않는다', () => {
    const r = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [{ stayMin: 0, fixedTime: null }],
      hasEnd: false,
      legs: [
        leg(600, { distanceM: 500 }),
        leg(6000, { distanceM: 9999, tollFare: 7000, estimated: true }),
      ],
    });
    expect(r.points.map((p) => p.arriveMin)).toEqual([540, 550]);
    expect(r.totals).toEqual({ travelS: 600, distanceM: 500, tollFare: 0, approximate: false });
  });
});

describe('formatClock', () => {
  it('같은 날은 HH:mm', () => {
    expect(formatClock(640)).toBe('10:40');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(1439)).toBe('23:59');
  });
  it('24시간 이상은 다음 날 HH:mm', () => {
    expect(formatClock(1440)).toBe('다음 날 00:00');
    expect(formatClock(1510)).toBe('다음 날 01:10');
  });
  it('48시간 이상도 다음 날로 보여 준다', () => {
    expect(formatClock(2880 + 75)).toBe('다음 날 01:15');
  });
  it('음수·NaN은 00:00', () => {
    expect(formatClock(-5)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
  });
});

describe('formatSlack', () => {
  it('여유와 늦음', () => {
    expect(formatSlack(40)).toBe('여유 40분');
    expect(formatSlack(0)).toBe('여유 0분');
    expect(formatSlack(-5)).toBe('늦음 5분');
  });
  it('60분 경계', () => {
    expect(formatSlack(59)).toBe('여유 59분');
    expect(formatSlack(60)).toBe('여유 1시간');
    expect(formatSlack(61)).toBe('여유 1시간 1분');
    expect(formatSlack(-80)).toBe('늦음 1시간 20분');
    expect(formatSlack(-120)).toBe('늦음 2시간');
  });
});
