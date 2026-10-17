import type { HoursDay, HoursSpan, PlaceHours } from 'src/server/hours';
import { addDays } from 'src/schema/trip';
import { formatClock, type PointTime } from 'src/domain/trips/schedule';
import { DAY_ROLLOVER_HOUR } from 'src/domain/trips/today';

// 영업시간 판정의 순수 규칙(스펙 §3). 장소의 영업시간·Day 날짜·방문 분을 받아 경고 종류와 문구를 낸다.
// 분은 Day 축(그날 0시 = 0분, 자정을 넘기면 1440 이상)이다.

export type Weekday = '일' | '월' | '화' | '수' | '목' | '금' | '토';

const WEEKDAYS: readonly Weekday[] = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MIN = 24 * 60;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD'를 UTC 자정으로 읽은 요일(기기 시간대와 무관). */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

export type DayRule =
  { kind: 'open'; day: HoursDay } | { kind: 'closed'; note: string | null } | { kind: 'unknown' };

/** 그 요일 항목, 없으면 `매일` 항목(스펙 §3.1). */
function entryFor(hours: PlaceHours, date: string): HoursDay | null {
  if (!DATE.test(date)) return null;
  const weekday = weekdayOf(date);
  return (
    hours.days.find((d) => d.day === weekday) ?? hours.days.find((d) => d.day === '매일') ?? null
  );
}

export function dayRuleFor(hours: PlaceHours, date: string): DayRule {
  const entry = entryFor(hours, date);
  if (entry === null) return { kind: 'unknown' };
  if (entry.closed) return { kind: 'closed', note: entry.note };
  if (entry.open === null) return { kind: 'unknown' };
  return { kind: 'open', day: entry };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

// 임시 휴무 원문의 날짜 꼴(스펙 §3.6). 월·일만 있는 꼴은 대상 날짜의 연도로 본다.
const FULL_DATES = [/(\d{4})-(\d{1,2})-(\d{1,2})/g, /(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})/g];
const MONTH_DAY = /(\d{1,2})월\s?(\d{1,2})일/g;

/** 원문에서 뽑은 'YYYY-MM-DD'들. */
function datesIn(text: string, year: string): string[] {
  const found: string[] = [];
  for (const re of FULL_DATES) {
    for (const m of text.matchAll(re))
      found.push(`${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`);
  }
  for (const m of text.matchAll(MONTH_DAY)) {
    found.push(`${year}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`);
  }
  return found;
}

/** 그 날짜가 든 임시 휴무 원문. 없으면 null. */
export function irregularMatch(hours: PlaceHours, date: string): string | null {
  if (!DATE.test(date)) return null;
  const year = date.slice(0, 4);
  return hours.irregularClosed.find((text) => datesIn(text, year).includes(date)) ?? null;
}

export type Visit = { startMin: number; endMin: number; waited: boolean };

/** 'HH:mm' → 분. 끝 시각의 '24:00'은 1440. 형식이 틀리면 null. */
function clockMin(text: string): number | null {
  if (text === '24:00') return DAY_MIN;
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 방문의 시작·끝. 고정 시각을 기다리면 그 시각부터(스펙 §3.2). */
export function visitOf(point: PointTime, stop: { fixedTime: string | null }): Visit {
  const fixed = stop.fixedTime === null ? null : clockMin(stop.fixedTime);
  if (fixed !== null && fixed < DAY_MIN && point.slackMin !== null && point.slackMin >= 0) {
    const startMin = Math.max(fixed, point.arriveMin);
    return { startMin, endMin: point.departMin, waited: startMin > point.arriveMin };
  }
  return { startMin: point.arriveMin, endMin: point.departMin, waited: false };
}

export type VisitCheck =
  | { kind: 'ok' }
  | { kind: 'unknown' }
  | { kind: 'closed-day'; note: string | null }
  | { kind: 'irregular-closed'; text: string }
  | { kind: 'before-open'; visit: Visit; opensAt: string }
  | { kind: 'after-close'; visit: Visit; closedAt: string }
  | { kind: 'break'; visit: Visit; span: HoursSpan }
  | { kind: 'last-order'; visit: Visit; lastOrder: string }
  | { kind: 'closes-during-stay'; closesAt: string }
  | { kind: 'break-during-stay'; span: HoursSpan };

/** Day 축의 한 시점과 그 네이버 원문 시각. */
type Mark = { min: number; text: string };
type Segment = { start: Mark; end: Mark; breaks: { start: Mark; end: Mark }[]; lastOrders: Mark[] };

/** 영업 구간을 Day 축으로 옮긴다. 자정을 넘는 끝·브레이크타임·라스트오더는 여는 시각 뒤로 민다(스펙 §3.2). */
function segmentOf(day: HoursDay, shift: number): Segment | null {
  if (day.open === null) return null;
  const openMin = clockMin(day.open.start);
  let closeMin = clockMin(day.open.end);
  if (openMin === null || closeMin === null || openMin >= DAY_MIN) return null;
  if (day.open.end !== '24:00' && (day.open.endsNextDay || closeMin <= openMin))
    closeMin += DAY_MIN;
  const afterOpen = (min: number) => (min < openMin ? min + DAY_MIN : min);

  const breaks: Segment['breaks'] = [];
  for (const b of day.breaks) {
    const s = clockMin(b.start);
    let e = clockMin(b.end);
    if (s === null || e === null) continue;
    if (e <= s) e += DAY_MIN;
    const moved = afterOpen(s) - s;
    breaks.push({
      start: { min: s + moved + shift, text: b.start },
      end: { min: e + moved + shift, text: b.end },
    });
  }
  const lastOrders: Mark[] = [];
  for (const text of day.lastOrders) {
    const min = clockMin(text);
    if (min !== null) lastOrders.push({ min: afterOpen(min) + shift, text });
  }
  return {
    start: { min: openMin + shift, text: day.open.start },
    end: { min: closeMin + shift, text: day.open.end },
    breaks,
    lastOrders,
  };
}

/** 그날 영업 구간들. 같은 요일 항목이 여럿이면 모두 쓴다. 휴무·모름은 없음. */
function segmentsFor(hours: PlaceHours, date: string, shift: number): Segment[] {
  const rule = dayRuleFor(hours, date);
  if (rule.kind !== 'open') return [];
  return hours.days
    .filter((d) => d.day === rule.day.day)
    .map((d) => segmentOf(d, shift))
    .filter((s): s is Segment => s !== null);
}

/** 시작 순으로 놓고 맞닿거나 겹치는 구간을 하나로 잇는다(24시간 영업이 자정마다 끊기지 않게). */
function mergeSegments(segments: Segment[]): Segment[] {
  const sorted = [...segments].sort((a, b) => a.start.min - b.start.min);
  const merged: Segment[] = [];
  for (const seg of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && seg.start.min <= last.end.min) {
      if (seg.end.min > last.end.min) last.end = seg.end;
      last.breaks.push(...seg.breaks);
      last.lastOrders.push(...seg.lastOrders);
    } else {
      merged.push({ ...seg, breaks: [...seg.breaks], lastOrders: [...seg.lastOrders] });
    }
  }
  return merged;
}

/** 경고 문구의 규칙 시각. 방문 날짜의 다음 날이면 `(다음 날)`, 그날의 `24:00`은 그대로. */
function markText(mark: Mark, dayStart: number): string {
  const rel = mark.min - dayStart;
  const nextDay = rel > DAY_MIN || (rel === DAY_MIN && mark.text !== '24:00');
  return nextDay ? `${mark.text}(다음 날)` : mark.text;
}

const spanText = (b: { start: Mark; end: Mark }, dayStart: number): HoursSpan => ({
  start: markText(b.start, dayStart),
  end: markText(b.end, dayStart),
});

/** 날짜만(후보·다른 Day의 장소): ok·unknown·closed-day·irregular-closed만 나온다. date는 Day 날짜. */
export function checkDate(hours: PlaceHours, date: string): VisitCheck {
  if (!DATE.test(date)) return { kind: 'unknown' };
  const irregular = irregularMatch(hours, date);
  if (irregular !== null) return { kind: 'irregular-closed', text: irregular };
  const rule = dayRuleFor(hours, date);
  if (rule.kind === 'closed') return { kind: 'closed-day', note: rule.note };
  if (rule.kind === 'unknown') return { kind: 'unknown' };
  return { kind: 'ok' };
}

const validMin = (n: number): boolean => Number.isFinite(n) && n >= 0;

/** date는 Day 날짜, visit은 그 Day 축의 분. 스펙 §3.3의 순서로 먼저 걸린 것 하나. */
export function checkVisit(hours: PlaceHours, date: string, visit: Visit): VisitCheck {
  const { startMin: s, endMin: e } = visit;
  if (!DATE.test(date) || !validMin(s) || !validMin(e)) return { kind: 'unknown' };

  // 방문일 X = Day 날짜 + floor(S / 1440). X-1·X·X+1의 구간을 Day 축으로 옮겨 함께 본다.
  const dayOffset = Math.floor(s / DAY_MIN);
  const visitDate = addDays(date, dayOffset);
  const dayStart = dayOffset * DAY_MIN;

  const irregular = irregularMatch(hours, visitDate);
  if (irregular !== null) return { kind: 'irregular-closed', text: irregular };

  const segments = mergeSegments(
    [-1, 0, 1].flatMap((k) => segmentsFor(hours, addDays(visitDate, k), dayStart + k * DAY_MIN)),
  );
  const current = segments.find((seg) => seg.start.min <= s && s < seg.end.min);

  const rule = dayRuleFor(hours, visitDate);
  if (rule.kind === 'closed' && current === undefined)
    return { kind: 'closed-day', note: rule.note };
  if (rule.kind === 'unknown') return { kind: 'unknown' };

  if (current === undefined) {
    const lastEnd = segments
      .filter((seg) => seg.end.min <= s)
      .reduce<Mark | null>(
        (best, seg) => (best === null || seg.end.min > best.min ? seg.end : best),
        null,
      );
    const nextStart = segments.find((seg) => seg.start.min > s)?.start ?? null;
    // 하루 경계 B(방문일 04:00) 전이면 전날 밤 영업의 끝, 뒤면 그날 영업을 시작했는지로 가른다.
    const boundary = dayStart + DAY_ROLLOVER_HOUR * 60;
    const closedFirst =
      s < boundary
        ? lastEnd !== null
        : segments.some((seg) => seg.start.min >= boundary && seg.start.min < s);
    if (closedFirst && lastEnd !== null) {
      return { kind: 'after-close', visit, closedAt: markText(lastEnd, dayStart) };
    }
    if (nextStart !== null)
      return { kind: 'before-open', visit, opensAt: markText(nextStart, dayStart) };
    if (lastEnd !== null)
      return { kind: 'after-close', visit, closedAt: markText(lastEnd, dayStart) };
    return { kind: 'unknown' };
  }

  const inBreak = current.breaks.find((b) => b.start.min <= s && s < b.end.min);
  if (inBreak !== undefined) return { kind: 'break', visit, span: spanText(inBreak, dayStart) };

  // S가 든 토막(영업 구간을 브레이크타임으로 나눈 조각) 안의 라스트오더.
  const pieceStart = Math.max(
    current.start.min,
    ...current.breaks.filter((b) => b.end.min <= s).map((b) => b.end.min),
  );
  const pieceEnd = Math.min(
    current.end.min,
    ...current.breaks.filter((b) => b.start.min > s).map((b) => b.start.min),
  );
  const passed = current.lastOrders
    .filter((lo) => lo.min >= pieceStart && lo.min <= pieceEnd && s > lo.min)
    .sort((a, b) => b.min - a.min)[0];
  if (passed !== undefined)
    return { kind: 'last-order', visit, lastOrder: markText(passed, dayStart) };

  if (e > current.end.min)
    return { kind: 'closes-during-stay', closesAt: markText(current.end, dayStart) };

  const breakInStay = current.breaks
    .filter((b) => s < b.start.min && b.start.min < e)
    .sort((a, b) => a.start.min - b.start.min)[0];
  if (breakInStay !== undefined) {
    return { kind: 'break-during-stay', span: spanText(breakInStay, dayStart) };
  }
  return { kind: 'ok' };
}

/** ok는 null, unknown은 '영업시간 확인 필요', 그 밖은 스펙 §2.4의 경고 문구. */
export function visitMessage(check: VisitCheck): string | null {
  const lead = (visit: Visit) => `${formatClock(visit.startMin)} ${visit.waited ? '시작' : '도착'}`;
  switch (check.kind) {
    case 'ok':
      return null;
    case 'unknown':
      return '영업시간 확인 필요';
    case 'closed-day':
      return check.note === null ? '휴무일' : `휴무일 — ${check.note}`;
    case 'irregular-closed':
      return `임시 휴무 — ${check.text}`;
    case 'before-open':
      return `${lead(check.visit)} — 영업 시작 ${check.opensAt}`;
    case 'after-close':
      return `${lead(check.visit)} — 영업 종료 ${check.closedAt}`;
    case 'break':
      return `${lead(check.visit)} — 브레이크타임 ${check.span.start}~${check.span.end}`;
    case 'last-order':
      return `${lead(check.visit)} — 라스트오더 ${check.lastOrder}`;
    case 'closes-during-stay':
      return `머무는 중 영업 종료 ${check.closesAt}`;
    case 'break-during-stay':
      return `머무는 중 브레이크타임 ${check.span.start}~${check.span.end}`;
  }
}

/** 카드 규칙 줄의 시각. 자정을 넘는 끝에는 늘 `(다음 날)`. */
function openText(open: NonNullable<HoursDay['open']>): string {
  const startMin = clockMin(open.start);
  const endMin = clockMin(open.end);
  const crosses =
    open.end !== '24:00' &&
    (open.endsNextDay || (startMin !== null && endMin !== null && endMin <= startMin));
  return `${open.start}~${open.end}${crosses ? '(다음 날)' : ''}`;
}

/** '11:00~21:00' | '18:00~02:00(다음 날)' | '휴무 — 정기휴무 (매주 수요일)' | '휴무' | '확인 필요' */
export function ruleText(rule: DayRule): string {
  if (rule.kind === 'open' && rule.day.open !== null) return openText(rule.day.open);
  if (rule.kind === 'closed') return rule.note === null ? '휴무' : `휴무 — ${rule.note}`;
  return '확인 필요';
}

/** '브레이크타임 14:30~16:30 · 라스트오더 19:40'. 둘 다 없으면 null. */
export function ruleExtras(day: HoursDay): string | null {
  const parts: string[] = [];
  if (day.breaks.length > 0) {
    parts.push(`브레이크타임 ${day.breaks.map((b) => `${b.start}~${b.end}`).join(', ')}`);
  }
  if (day.lastOrders.length > 0) parts.push(`라스트오더 ${day.lastOrders.join(', ')}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** 계산하지 않는 규칙(요일·매일이 아닌 day) 줄: '공휴일 10:00~17:00'. */
export function uncountedRules(hours: PlaceHours): string[] {
  return hours.days
    .filter((d) => d.day !== '매일' && !(WEEKDAYS as readonly string[]).includes(d.day))
    .map((d) => {
      const rule: DayRule = d.closed
        ? { kind: 'closed', note: d.note }
        : d.open === null
          ? { kind: 'unknown' }
          : { kind: 'open', day: d };
      return `${d.day} ${ruleText(rule)}`;
    });
}
