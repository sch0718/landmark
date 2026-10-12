/** 한 구간의 이동 정보. `dayLegs` 순서(`[출발점?, …장소, 도착점?]`의 인접 쌍)와 같은 순서로 받는다. */
export type LegTime = {
  durationS: number;
  distanceM: number;
  tollFare: number | null;
  estimated: boolean;
};

/**
 * 한 점(출발점·장소·도착점)의 시각. 분은 Day 0시 기준 절대 분이라 자정을 넘기면 1440 이상이 된다.
 * slackMin: 양수는 여유, 음수는 늦음, 고정 시각이 없으면 null.
 */
export type PointTime = { arriveMin: number; departMin: number; slackMin: number | null };

export type DaySchedule = {
  points: PointTime[];
  totals: { travelS: number; distanceM: number; tollFare: number; approximate: boolean };
};

export type ScheduleInput = {
  startTime: string; // 'HH:mm'
  /** 출발점(출발지/숙소)이 있는가. 있으면 points[0]이 출발점이다. */
  hasStart: boolean;
  stops: { stayMin: number | null; fixedTime: string | null }[];
  hasEnd: boolean;
  legs: LegTime[];
};

const DAY_MIN = 24 * 60;

/** 'HH:mm' → 분. 형식이 틀리면 null. */
function parseClock(text: string | null): number | null {
  if (text === null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 0 이상의 유한한 정수 분으로 다듬는다(null·NaN·음수는 0). */
function safeMin(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

export function computeSchedule(input: ScheduleInput): DaySchedule {
  const { hasStart, hasEnd, stops, legs } = input;
  const startMin = parseClock(input.startTime) ?? 0;
  const pointCount = (hasStart ? 1 : 0) + stops.length + (hasEnd ? 1 : 0);
  const legCount = Math.max(0, pointCount - 1);
  // 모자란 구간은 0으로, 남는 구간은 무시해 점과 구간의 짝을 지킨다.
  const usedLegs = legs.slice(0, legCount);
  // 구간 시간은 구간마다 가장 가까운 분으로 반올림해 더한다(합계 초는 반올림하지 않는다).
  const legMin = (i: number): number => safeMin((usedLegs[i]?.durationS ?? 0) / 60);

  const points: PointTime[] = [];
  let clock = startMin; // 직전 점의 출발 시각
  let legIndex = 0;

  if (hasStart) {
    points.push({ arriveMin: startMin, departMin: startMin, slackMin: null });
  }
  stops.forEach((stop, i) => {
    // 출발점이 없으면 첫 장소는 이동 없이 startTime에 도착한다.
    const isFirstWithoutStart = !hasStart && i === 0;
    const arrive = isFirstWithoutStart ? startMin : clock + legMin(legIndex++);
    const stay = safeMin(stop.stayMin);
    const fixed = parseClock(stop.fixedTime);
    let depart = arrive + stay;
    let slack: number | null = null;
    if (fixed !== null) {
      slack = fixed - arrive;
      // 여유면 고정 시각까지 기다린 뒤 체류, 늦으면 도착하자마자 체류.
      depart = (slack >= 0 ? fixed : arrive) + stay;
    }
    points.push({ arriveMin: arrive, departMin: depart, slackMin: slack });
    clock = depart;
  });
  if (hasEnd) {
    const arrive = clock + legMin(legIndex++);
    points.push({ arriveMin: arrive, departMin: arrive, slackMin: null });
  }

  const totals = { travelS: 0, distanceM: 0, tollFare: 0, approximate: false };
  for (const l of usedLegs) {
    totals.travelS += l.durationS;
    totals.distanceM += l.distanceM;
    totals.tollFare += l.tollFare ?? 0;
    if (l.estimated) totals.approximate = true;
  }
  return { points, totals };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 640 → '10:40', 1510 → '다음 날 01:10'. 48시간 넘게 가도 '다음 날'로만 보인다. */
export function formatClock(min: number): string {
  const total = Number.isFinite(min) ? Math.max(0, Math.round(min)) : 0;
  const inDay = total % DAY_MIN;
  const clock = `${pad2(Math.floor(inDay / 60))}:${pad2(inDay % 60)}`;
  return total >= DAY_MIN ? `다음 날 ${clock}` : clock;
}

/** 40 → '여유 40분', -80 → '늦음 1시간 20분'. */
export function formatSlack(slackMin: number): string {
  const abs = Number.isFinite(slackMin) ? Math.round(Math.abs(slackMin)) : 0;
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  let span: string;
  if (hours === 0) span = `${rest}분`;
  else if (rest === 0) span = `${hours}시간`;
  else span = `${hours}시간 ${rest}분`;
  return `${slackMin < 0 && abs > 0 ? '늦음' : '여유'} ${span}`;
}
