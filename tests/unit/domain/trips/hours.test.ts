import { afterEach, describe, expect, it } from 'vitest';
import type { HoursDay, PlaceHours } from 'src/server/hours';
import {
  checkDate,
  checkVisit,
  dayRuleFor,
  irregularMatch,
  ruleExtras,
  ruleText,
  uncountedRules,
  visitMessage,
  visitOf,
  weekdayOf,
  type Visit,
  type VisitCheck,
} from 'src/domain/trips/hours';

// 2026-10-16(금), 2026-10-20(화), 2026-10-21(수)
const FRI = '2026-10-16';
const TUE = '2026-10-20';
const WED = '2026-10-21';

const open = (
  day: string,
  start: string,
  end: string,
  over: Partial<Omit<HoursDay, 'day' | 'open'>> & { endsNextDay?: boolean } = {},
): HoursDay => {
  const { endsNextDay = false, ...rest } = over;
  return {
    day,
    open: { start, end, endsNextDay },
    closed: false,
    breaks: [],
    lastOrders: [],
    note: null,
    ...rest,
  };
};
const closed = (day: string, note: string | null = null): HoursDay => ({
  day,
  open: null,
  closed: true,
  breaks: [],
  lastOrders: [],
  note,
});
const place = (days: HoursDay[], over: Partial<PlaceHours> = {}): PlaceHours => ({
  sid: '1',
  fetchedAt: '2026-10-16T00:00:00.000Z',
  days,
  irregularClosed: [],
  regularClosed: null,
  note: null,
  otherSchedules: [],
  ...over,
});

// Task 1의 단천면옥(11733192) 정규화 기대값.
const dancheonDay = (day: string): HoursDay =>
  open(day, '11:00', '21:00', {
    breaks: [{ start: '14:30', end: '16:30' }],
    lastOrders: ['19:40'],
  });
const DANCHEON: PlaceHours = place([
  dancheonDay('금'),
  dancheonDay('토'),
  dancheonDay('일'),
  dancheonDay('월'),
  dancheonDay('화'),
  closed('수', '정기휴무 (매주 수요일)'),
  dancheonDay('목'),
]);

const v = (startMin: number, endMin = startMin, waited = false): Visit => ({
  startMin,
  endMin,
  waited,
});
const at = (h: number, m = 0) => h * 60 + m;
const run = (hours: PlaceHours, date: string, visit: Visit): [VisitCheck, string | null] => {
  const check = checkVisit(hours, date, visit);
  return [check, visitMessage(check)];
};

describe('weekdayOf', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('날짜의 요일', () => {
    expect(weekdayOf(WED)).toBe('수');
    expect(weekdayOf(FRI)).toBe('금');
  });

  it('기기 시간대와 무관하다', () => {
    for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Seoul', 'UTC']) {
      process.env.TZ = tz;
      expect(weekdayOf(WED)).toBe('수');
      expect(weekdayOf(FRI)).toBe('금');
    }
  });
});

describe('dayRuleFor', () => {
  it('요일 항목: 수요일 휴무(설명), 금요일 영업', () => {
    expect(dayRuleFor(DANCHEON, WED)).toEqual({ kind: 'closed', note: '정기휴무 (매주 수요일)' });
    expect(dayRuleFor(DANCHEON, FRI)).toEqual({ kind: 'open', day: DANCHEON.days[0] });
  });

  it('매일만 있으면 아무 날이나 영업', () => {
    const h = place([open('매일', '08:30', '20:15')]);
    expect(dayRuleFor(h, WED)).toMatchObject({ kind: 'open' });
    expect(dayRuleFor(h, FRI)).toMatchObject({ kind: 'open' });
  });

  it('그 요일도 매일도 없으면 모름', () => {
    expect(dayRuleFor(place([open('월', '11:00', '21:00')]), FRI)).toEqual({ kind: 'unknown' });
  });

  it('open null·closed false는 모름, days []도 모름', () => {
    const blank: HoursDay = { ...closed('금'), closed: false };
    expect(dayRuleFor(place([blank]), FRI)).toEqual({ kind: 'unknown' });
    expect(dayRuleFor(place([]), FRI)).toEqual({ kind: 'unknown' });
  });

  it('요일 항목이 매일보다 먼저', () => {
    const h = place([open('매일', '09:00', '18:00'), closed('금')]);
    expect(dayRuleFor(h, FRI)).toEqual({ kind: 'closed', note: null });
  });
});

describe('visitOf', () => {
  it('고정 시각을 기다리면 고정 시각부터, waited', () => {
    expect(
      visitOf({ arriveMin: at(9), departMin: at(12), slackMin: 120 }, { fixedTime: '11:00' }),
    ).toEqual({ startMin: 660, endMin: 720, waited: true });
  });

  it('고정 = 도착이면 waited false', () => {
    expect(
      visitOf({ arriveMin: at(11), departMin: at(12), slackMin: 0 }, { fixedTime: '11:00' }),
    ).toEqual({ startMin: 660, endMin: 720, waited: false });
  });

  it('늦은 고정(slack < 0)이면 도착부터', () => {
    expect(
      visitOf({ arriveMin: at(11, 30), departMin: at(12), slackMin: -30 }, { fixedTime: '11:00' }),
    ).toEqual({ startMin: 690, endMin: 720, waited: false });
  });

  it('고정 시각이 없으면 도착부터', () => {
    expect(
      visitOf({ arriveMin: at(10), departMin: at(11), slackMin: null }, { fixedTime: null }),
    ).toEqual({ startMin: 600, endMin: 660, waited: false });
  });
});

describe('checkVisit — 단천면옥(금)', () => {
  it('10:30 → 영업 전', () => {
    const [c, msg] = run(DANCHEON, FRI, v(at(10, 30), at(11, 30)));
    expect(c).toMatchObject({ kind: 'before-open', opensAt: '11:00' });
    expect(msg).toBe('10:30 도착 — 영업 시작 11:00');
  });

  it('15:40 → 브레이크타임', () => {
    const [c, msg] = run(DANCHEON, FRI, v(at(15, 40), at(16, 40)));
    expect(c).toMatchObject({ kind: 'break', span: { start: '14:30', end: '16:30' } });
    expect(msg).toBe('15:40 도착 — 브레이크타임 14:30~16:30');
  });

  it('19:50 → 라스트오더', () => {
    const [c, msg] = run(DANCHEON, FRI, v(at(19, 50), at(20, 30)));
    expect(c).toMatchObject({ kind: 'last-order', lastOrder: '19:40' });
    expect(msg).toBe('19:50 도착 — 라스트오더 19:40');
  });

  it('21:10 → 영업 끝', () => {
    const [c, msg] = run(DANCHEON, FRI, v(at(21, 10), at(22)));
    expect(c).toMatchObject({ kind: 'after-close', closedAt: '21:00' });
    expect(msg).toBe('21:10 도착 — 영업 종료 21:00');
  });

  it('14:00~15:00 → 머무는 중 브레이크타임', () => {
    const [c, msg] = run(DANCHEON, FRI, v(at(14), at(15)));
    expect(c).toEqual({ kind: 'break-during-stay', span: { start: '14:30', end: '16:30' } });
    expect(msg).toBe('머무는 중 브레이크타임 14:30~16:30');
  });

  it('18:00~21:30 → 머무는 중 영업 끝', () => {
    const [c, msg] = run(DANCHEON, FRI, v(at(18), at(21, 30)));
    expect(c).toEqual({ kind: 'closes-during-stay', closesAt: '21:00' });
    expect(msg).toBe('머무는 중 영업 종료 21:00');
  });

  it('12:00~13:00 → 문제없음', () => {
    const [c, msg] = run(DANCHEON, FRI, v(at(12), at(13)));
    expect(c).toEqual({ kind: 'ok' });
    expect(msg).toBeNull();
  });

  it('수요일 12:00 → 휴무일', () => {
    const [c, msg] = run(DANCHEON, WED, v(at(12), at(13)));
    expect(c).toEqual({ kind: 'closed-day', note: '정기휴무 (매주 수요일)' });
    expect(msg).toBe('휴무일 — 정기휴무 (매주 수요일)');
  });

  it('화요일 Day의 1500분(수 01:00) → 휴무일', () => {
    expect(checkVisit(DANCHEON, TUE, v(1500, 1560))).toMatchObject({ kind: 'closed-day' });
  });

  it('설명 없는 휴무일', () => {
    expect(visitMessage({ kind: 'closed-day', note: null })).toBe('휴무일');
  });
});

describe('checkVisit — 자정 넘김(매일 18:00~02:00)', () => {
  const BAR = place([open('매일', '18:00', '02:00', { endsNextDay: true })]);
  const BAR_NO_FLAG = place([open('매일', '18:00', '02:00')]);

  for (const [name, h] of [
    ['endsNextDay true', BAR],
    ['endsNextDay false', BAR_NO_FLAG],
  ] as const) {
    describe(name, () => {
      it('금 Day 1500분(다음 날 01:00) → 문제없음', () => {
        expect(checkVisit(h, FRI, v(1500, 1530))).toEqual({ kind: 'ok' });
      });

      it('150분(02:30) → 전날 밤 영업의 끝', () => {
        const [c, msg] = run(h, FRI, v(150, 180));
        expect(c).toMatchObject({ kind: 'after-close', closedAt: '02:00' });
        expect(msg).toBe('02:30 도착 — 영업 종료 02:00');
      });

      it('600분(10:00) → 영업 전 18:00', () => {
        const [c, msg] = run(h, FRI, v(600, 660));
        expect(c).toMatchObject({ kind: 'before-open', opensAt: '18:00' });
        expect(msg).toBe('10:00 도착 — 영업 시작 18:00');
      });

      it('23:00~다음 날 03:00 → 머무는 중 영업 종료 02:00(다음 날)', () => {
        const [c, msg] = run(h, FRI, v(at(23), 1440 + at(3)));
        expect(c).toEqual({ kind: 'closes-during-stay', closesAt: '02:00(다음 날)' });
        expect(msg).toBe('머무는 중 영업 종료 02:00(다음 날)');
      });
    });
  }

  it('방문일 규칙을 몰라도 전날 밤 영업 구간 안이면 그 구간으로 본다', () => {
    // 금 18:00~02:00, 토 항목 없음.
    const fri = place([open('금', '18:00', '02:00', { endsNextDay: true, lastOrders: ['00:30'] })]);
    const SAT = '2026-10-17';
    expect(checkVisit(fri, SAT, v(at(1, 0), at(1, 0)))).toMatchObject({ kind: 'last-order' });
    const noLastOrder = place([open('금', '18:00', '02:00', { endsNextDay: true })]);
    expect(checkVisit(noLastOrder, SAT, v(at(1), at(1, 30)))).toEqual({ kind: 'ok' });
    expect(checkVisit(noLastOrder, FRI, v(1440 + at(1), 1440 + at(1, 30)))).toEqual({ kind: 'ok' });
    expect(checkVisit(noLastOrder, SAT, v(at(1), at(2, 30)))).toEqual({
      kind: 'closes-during-stay',
      closesAt: '02:00',
    });
    // 구간 밖(토 05:00)은 여전히 모름.
    expect(checkVisit(noLastOrder, SAT, v(at(5), at(6)))).toEqual({ kind: 'unknown' });
    expect(checkVisit(noLastOrder, SAT, v(at(2, 30), at(3)))).toEqual({ kind: 'unknown' });
  });

  it('하루 경계: 03:59 → 영업 끝 02:00, 04:00 → 영업 전 18:00', () => {
    expect(run(BAR, FRI, v(239, 250))[1]).toBe('03:59 도착 — 영업 종료 02:00');
    expect(run(BAR, FRI, v(240, 250))[1]).toBe('04:00 도착 — 영업 시작 18:00');
  });

  it('다음 날 새벽: 1679분 → 영업 끝 02:00, 1680분 → 영업 전 18:00', () => {
    const [late, lateMsg] = run(BAR, FRI, v(1679, 1690));
    expect(late).toMatchObject({ kind: 'after-close', closedAt: '02:00' });
    expect(lateMsg).toBe('다음 날 03:59 도착 — 영업 종료 02:00');
    const [early, earlyMsg] = run(BAR, FRI, v(1680, 1690));
    expect(early).toMatchObject({ kind: 'before-open', opensAt: '18:00' });
    expect(earlyMsg).toBe('다음 날 04:00 도착 — 영업 시작 18:00');
  });
});

describe('checkVisit — 하루 경계(낮 영업)', () => {
  const DAYTIME = place([open('매일', '11:00', '21:00')]);

  it('02:00 → 전날 밤 영업의 끝 21:00', () => {
    const [c, msg] = run(DAYTIME, FRI, v(120, 150));
    expect(c).toMatchObject({ kind: 'after-close', closedAt: '21:00' });
    expect(msg).toBe('02:00 도착 — 영업 종료 21:00');
  });

  it('05:00 → 영업 전 11:00', () => {
    expect(run(DAYTIME, FRI, v(300, 330))[1]).toBe('05:00 도착 — 영업 시작 11:00');
  });

  it('두 구간 사이(11:00~14:00, 17:00~22:00) 15:00 → 영업 끝 14:00', () => {
    // 같은 요일 항목이 둘이면 둘 다 그날의 영업 구간이다.
    const h = place([open('금', '11:00', '14:00'), open('금', '17:00', '22:00')]);
    const [c, msg] = run(h, FRI, v(at(15), at(16)));
    expect(c).toMatchObject({ kind: 'after-close', closedAt: '14:00' });
    expect(msg).toBe('15:00 도착 — 영업 종료 14:00');
  });
});

describe('checkVisit — 24시간·24:00', () => {
  const ALLDAY = place([open('매일', '00:00', '24:00')]);

  it('00:00~24:00 매일: 23:30~다음 날 00:30 → 문제없음(X+1까지 이어 붙임)', () => {
    expect(checkVisit(ALLDAY, FRI, v(1410, 1470))).toEqual({ kind: 'ok' });
  });

  it('00:00~24:00 매일: 다음 날 02:00 도착 → 문제없음', () => {
    expect(checkVisit(ALLDAY, FRI, v(1560, 1620))).toEqual({ kind: 'ok' });
  });

  it('11:00~24:00: X+1과 맞닿지 않아 23:00~다음 날 00:30 → 머무는 중 영업 종료 24:00', () => {
    const h = place([open('매일', '11:00', '24:00')]);
    const [c, msg] = run(h, FRI, v(at(23), 1470));
    expect(c).toEqual({ kind: 'closes-during-stay', closesAt: '24:00' });
    expect(msg).toBe('머무는 중 영업 종료 24:00');
  });

  it('11:00~24:00: 23:50 → 문제없음, 다음 날 00:10 → 영업 종료 24:00', () => {
    const h = place([open('매일', '11:00', '24:00')]);
    expect(checkVisit(h, FRI, v(at(23, 50), at(23, 55)))).toEqual({ kind: 'ok' });
    const [c, msg] = run(h, FRI, v(1450, 1460));
    expect(c).toMatchObject({ kind: 'after-close', closedAt: '24:00' });
    expect(msg).toBe('다음 날 00:10 도착 — 영업 종료 24:00');
  });
});

describe('checkVisit — 라스트오더 둘', () => {
  const h = place([
    open('매일', '11:00', '21:00', {
      breaks: [{ start: '15:00', end: '17:00' }],
      lastOrders: ['14:30', '20:00'],
    }),
  ]);

  it('14:40 → 라스트오더 14:30', () => {
    expect(run(h, FRI, v(at(14, 40), at(14, 50)))[1]).toBe('14:40 도착 — 라스트오더 14:30');
  });

  it('17:30 → 문제없음', () => {
    expect(checkVisit(h, FRI, v(at(17, 30), at(18)))).toEqual({ kind: 'ok' });
  });

  it('20:10 → 라스트오더 20:00', () => {
    expect(run(h, FRI, v(at(20, 10), at(20, 30)))[1]).toBe('20:10 도착 — 라스트오더 20:00');
  });
});

describe('checkVisit — 고정 시각', () => {
  it('09:00 도착·11:00 고정·영업 10:00~ → 문제없음', () => {
    const h = place([open('매일', '10:00', '20:00')]);
    const visit = visitOf(
      { arriveMin: at(9), departMin: at(12), slackMin: 120 },
      { fixedTime: '11:00' },
    );
    expect(visit).toMatchObject({ startMin: 660, waited: true });
    expect(checkVisit(h, FRI, visit)).toEqual({ kind: 'ok' });
  });

  it('14:00 도착·15:00 고정·브레이크 15:00~16:30 → 15:00 시작 — 브레이크타임', () => {
    const h = place([
      open('매일', '10:00', '20:00', { breaks: [{ start: '15:00', end: '16:30' }] }),
    ]);
    const visit = visitOf(
      { arriveMin: at(14), departMin: at(16), slackMin: 60 },
      { fixedTime: '15:00' },
    );
    const [c, msg] = run(h, FRI, visit);
    expect(c).toMatchObject({ kind: 'break' });
    expect(msg).toBe('15:00 시작 — 브레이크타임 15:00~16:30');
  });
});

describe('임시 휴무', () => {
  const withIrregular = (text: string) => place(DANCHEON.days, { irregularClosed: [text] });

  it('YYYY-MM-DD 원문이 그날이면 임시 휴무', () => {
    const h = withIrregular('2026-10-17 내부 공사');
    expect(irregularMatch(h, '2026-10-17')).toBe('2026-10-17 내부 공사');
    const [c, msg] = run(h, '2026-10-17', v(at(12), at(13)));
    expect(c).toEqual({ kind: 'irregular-closed', text: '2026-10-17 내부 공사' });
    expect(msg).toBe('임시 휴무 — 2026-10-17 내부 공사');
  });

  it('다른 날짜는 맞지 않는다', () => {
    expect(irregularMatch(withIrregular('2026-10-17 내부 공사'), '2026-10-18')).toBeNull();
  });

  it.each([
    '2026.10.17 휴무',
    '2026. 10. 17 휴무',
    '10월 17일 휴무',
    '2026-10-17',
    '2026.10.7 휴무',
  ])('날짜 꼴: %s', (text) => {
    const expected = text === '2026.10.7 휴무' ? '2026-10-07' : '2026-10-17';
    expect(irregularMatch(withIrregular(text), expected)).toBe(text);
  });

  it('연도가 적힌 M월 D일은 그 연도로 본다', () => {
    const text = '2026년 10월 17일 휴무';
    expect(irregularMatch(withIrregular(text), '2026-10-17')).toBe(text);
    expect(irregularMatch(withIrregular('2026년10월17일 휴무'), '2026-10-17')).not.toBeNull();
    expect(irregularMatch(withIrregular('2025년 10월 17일 휴무'), '2026-10-17')).toBeNull();
    expect(irregularMatch(withIrregular('2025년 10월 17일 휴무'), '2025-10-17')).not.toBeNull();
    // 네 자리 연도가 아닌 `매년`·`내년` 뒤의 `M월 D일`은 그날 연도로 읽는다.
    expect(irregularMatch(withIrregular('매년 10월 17일 휴무'), '2026-10-17')).not.toBeNull();
    expect(irregularMatch(withIrregular('내년 10월 17일 휴무'), '2026-10-17')).not.toBeNull();
  });

  it.each(['2026-10-170', '2026.10.170 휴무', '12026-10-17', '110월 17일 휴무', '10월 117일 휴무'])(
    '숫자가 이어지면 맞지 않는다: %s',
    (text) => {
      expect(irregularMatch(withIrregular(text), '2026-10-17')).toBeNull();
    },
  );

  it('날짜 없는 원문은 맞지 않는다', () => {
    expect(irregularMatch(withIrregular('추석 연휴'), '2026-10-17')).toBeNull();
  });

  it('휴무일보다 임시 휴무가 먼저', () => {
    const h = withIrregular('2026-10-21 임시휴무');
    expect(checkVisit(h, WED, v(at(12), at(13)))).toEqual({
      kind: 'irregular-closed',
      text: '2026-10-21 임시휴무',
    });
    expect(checkDate(h, WED)).toEqual({ kind: 'irregular-closed', text: '2026-10-21 임시휴무' });
  });

  it('다음 날로 넘어간 방문은 그 날짜의 임시 휴무를 본다', () => {
    const h = withIrregular('10월 17일 휴무');
    expect(checkVisit(h, FRI, v(1440 + at(12), 1440 + at(13)))).toMatchObject({
      kind: 'irregular-closed',
    });
  });
});

describe('계산하지 않는 규칙', () => {
  it('공휴일만 있으면 모름, 문구는 영업시간 확인 필요', () => {
    const h = place([open('공휴일', '10:00', '17:00')]);
    const [c, msg] = run(h, FRI, v(at(12), at(13)));
    expect(c).toEqual({ kind: 'unknown' });
    expect(msg).toBe('영업시간 확인 필요');
    expect(uncountedRules(h)).toEqual(['공휴일 10:00~17:00']);
  });

  it('공휴일 휴무', () => {
    expect(uncountedRules(place([...DANCHEON.days, closed('공휴일')]))).toEqual(['공휴일 휴무']);
  });

  it('요일·매일 항목은 넣지 않는다', () => {
    expect(uncountedRules(DANCHEON)).toEqual([]);
  });
});

describe('checkDate', () => {
  it('수요일 휴무일, 금요일 문제없음, days []는 모름', () => {
    expect(checkDate(DANCHEON, WED)).toEqual({
      kind: 'closed-day',
      note: '정기휴무 (매주 수요일)',
    });
    expect(checkDate(DANCHEON, FRI)).toEqual({ kind: 'ok' });
    expect(checkDate(place([]), FRI)).toEqual({ kind: 'unknown' });
  });
});

describe('ruleText·ruleExtras', () => {
  it('규칙 줄', () => {
    expect(ruleText(dayRuleFor(DANCHEON, FRI))).toBe('11:00~21:00');
    expect(
      ruleText({ kind: 'open', day: open('매일', '18:00', '02:00', { endsNextDay: true }) }),
    ).toBe('18:00~02:00(다음 날)');
    expect(ruleText({ kind: 'open', day: open('매일', '18:00', '02:00') })).toBe(
      '18:00~02:00(다음 날)',
    );
    expect(ruleText({ kind: 'open', day: open('매일', '11:00', '24:00') })).toBe('11:00~24:00');
    expect(ruleText(dayRuleFor(DANCHEON, WED))).toBe('휴무 — 정기휴무 (매주 수요일)');
    expect(ruleText({ kind: 'closed', note: null })).toBe('휴무');
    expect(ruleText({ kind: 'unknown' })).toBe('확인 필요');
  });

  it('브레이크타임·라스트오더', () => {
    expect(ruleExtras(DANCHEON.days[0]!)).toBe('브레이크타임 14:30~16:30 · 라스트오더 19:40');
    expect(ruleExtras(open('매일', '11:00', '21:00', { lastOrders: ['14:30', '20:00'] }))).toBe(
      '라스트오더 14:30, 20:00',
    );
    expect(ruleExtras(open('매일', '11:00', '21:00'))).toBeNull();
  });
});

describe('잘못된 분', () => {
  it.each([
    [Number.NaN, 600],
    [600, Number.NaN],
    [-10, 600],
    [600, -10],
    [Number.POSITIVE_INFINITY, 600],
  ])('start %s, end %s → 모름(던지지 않음)', (startMin, endMin) => {
    expect(checkVisit(DANCHEON, FRI, { startMin, endMin, waited: false })).toEqual({
      kind: 'unknown',
    });
  });

  it('잘못된 날짜 → 모름', () => {
    expect(checkVisit(DANCHEON, 'x', v(600, 660))).toEqual({ kind: 'unknown' });
    expect(checkDate(DANCHEON, '')).toEqual({ kind: 'unknown' });
  });
});
