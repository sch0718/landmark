// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from 'src/server/http';
import type { Deps } from 'src/server/request';
import {
  extractBusinessHours,
  parseHoursQuery,
  resolveHours,
  toPlaceHours,
} from 'src/server/hours';

const T = '2026-10-16T03:00:00.000Z';
const NOW = new Date('2026-10-17T05:00:00.000Z');

function fixtureHtml(sid: string): string {
  return readFileSync(
    resolve(process.cwd(), `tests/fixtures/naver/pcmap-home-${sid}.html`),
    'utf8',
  );
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('오류가 나야 함');
}

function errorOf(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('오류가 나야 함');
}

/** 배열(JSON 글)을 녹화 HTML과 같은 틀에 끼운다. */
function pageWith(value: string): string {
  return `<html><script>window.__APOLLO_STATE__ = {"ROOT_QUERY":{"a":{"newBusinessHours":${value}}}};
    !function(n,t){var a="]}[{";}("c","n");</script></html>`;
}

describe('parseHoursQuery', () => {
  const url = (qs: string) => new URL(`http://localhost:8788/api/hours?${qs}`);

  it('숫자 sid를 읽는다', () => {
    expect(parseHoursQuery(url('sid=11733192'))).toBe('11733192');
  });

  it.each(['', 'sid=abc', 'sid=1234567890123456', 'sid=1%202'])('%s는 BAD_REQUEST', (qs) => {
    expect(errorOf(() => parseHoursQuery(url(qs))).code).toBe('BAD_REQUEST');
  });
});

describe('extractBusinessHours', () => {
  it('녹화 HTML에서 배열을 떼어 낸다 (뒤 스크립트의 "]}[{"에 속지 않는다)', () => {
    const raw = extractBusinessHours(fixtureHtml('11733192'));
    expect(raw).toHaveLength(1);
    const first = raw![0] as { businessHours: unknown[] };
    expect(first.businessHours).toHaveLength(7);
  });

  it('null은 null, []는 []', () => {
    expect(extractBusinessHours(pageWith('null'))).toBeNull();
    expect(extractBusinessHours(pageWith('[]'))).toEqual([]);
    expect(extractBusinessHours(pageWith(' \n [ ]'))).toEqual([]);
  });

  it('__APOLLO_STATE__가 없으면 UPSTREAM_ERROR', () => {
    expect(errorOf(() => extractBusinessHours('<html>"newBusinessHours":[]</html>')).code).toBe(
      'UPSTREAM_ERROR',
    );
    expect(errorOf(() => extractBusinessHours('')).code).toBe('UPSTREAM_ERROR');
  });

  it('__APOLLO_STATE__는 있는데 키가 없으면 UPSTREAM_ERROR', () => {
    const html = '<script>window.__APOLLO_STATE__ = {"ROOT_QUERY":{}};</script>';
    expect(errorOf(() => extractBusinessHours(html)).code).toBe('UPSTREAM_ERROR');
  });

  it('닫는 괄호가 없으면 UPSTREAM_ERROR', () => {
    expect(errorOf(() => extractBusinessHours(pageWith('[{"a":[1,2]'))).code).toBe(
      'UPSTREAM_ERROR',
    );
  });

  it('배열도 null도 아닌 값이나 깨진 JSON은 UPSTREAM_ERROR', () => {
    expect(errorOf(() => extractBusinessHours(pageWith('"x"'))).code).toBe('UPSTREAM_ERROR');
    expect(errorOf(() => extractBusinessHours(pageWith('{"a":1}'))).code).toBe('UPSTREAM_ERROR');
    expect(errorOf(() => extractBusinessHours(pageWith('[{a:1}]'))).code).toBe('UPSTREAM_ERROR');
  });

  it('문자열 안의 ]와 \\" 가 든 freeText를 바르게 읽는다', () => {
    const raw = extractBusinessHours(pageWith('[{"freeText":"a]\\"b","businessHours":[]}]'));
    expect(raw).toEqual([{ freeText: 'a]"b', businessHours: [] }]);
  });
});

describe('toPlaceHours', () => {
  const raw733 = extractBusinessHours(fixtureHtml('11733192'));
  const raw815 = extractBusinessHours(fixtureHtml('11815720'));

  it('단천면옥: 요일별 규칙·정기휴무·브레이크·라스트오더', () => {
    const hours = toPlaceHours('11733192', raw733, T);
    expect(hours.days).toHaveLength(7);
    expect(hours.days[5]).toEqual({
      day: '수',
      open: null,
      closed: true,
      breaks: [],
      lastOrders: [],
      note: '정기휴무 (매주 수요일)',
    });
    expect(hours.days[0]).toEqual({
      day: '금',
      open: { start: '11:00', end: '21:00', endsNextDay: false },
      closed: false,
      breaks: [{ start: '14:30', end: '16:30' }],
      lastOrders: ['19:40'],
      note: null,
    });
    expect(hours).toMatchObject({
      sid: '11733192',
      fetchedAt: T,
      irregularClosed: [],
      regularClosed: null,
      note: null,
      otherSchedules: [],
    });
  });

  it('88생선구이: 매일 규칙·freeText', () => {
    const hours = toPlaceHours('11815720', raw815, T);
    expect(hours.days).toEqual([
      {
        day: '매일',
        open: { start: '08:30', end: '20:15', endsNextDay: false },
        closed: false,
        breaks: [{ start: '15:00', end: '16:30' }],
        lastOrders: [],
        note: null,
      },
    ]);
    expect(hours.note).toBe('라스트오더 점심14:30 /저녁19:30');
  });

  describe('경계', () => {
    const one = (day: Record<string, unknown>) =>
      toPlaceHours('1', [{ name: '기본', businessHours: [{ day: '월', ...day }] }], T).days[0];
    const span = (start: string, end: string) => ({ businessHours: { start, end } });

    it('끝 24:00은 그대로 둔다', () => {
      expect(one(span('00:00', '24:00'))?.open).toEqual({
        start: '00:00',
        end: '24:00',
        endsNextDay: false,
      });
    });

    it('읽을 수 없는 시각은 open null, closed false (모름)', () => {
      expect(one(span('11:00', '24:30'))).toMatchObject({ open: null, closed: false });
      expect(one(span('9:00', '21:00'))).toMatchObject({ open: null, closed: false });
      expect(one(span('25:00', '21:00'))).toMatchObject({ open: null, closed: false });
    });

    it('showEndsNextDay true는 endsNextDay true', () => {
      expect(one({ ...span('18:00', '02:00'), showEndsNextDay: true })?.open).toEqual({
        start: '18:00',
        end: '02:00',
        endsNextDay: true,
      });
    });

    it('시각도 설명도 null이면 휴무가 아니다', () => {
      expect(one({ businessHours: null, description: null })).toMatchObject({
        open: null,
        closed: false,
        note: null,
      });
    });

    it('설명에 휴무가 없으면 시각이 null이어도 휴무가 아니다', () => {
      expect(one({ businessHours: null, description: '브레이크타임 별도' })).toMatchObject({
        open: null,
        closed: false,
        note: '브레이크타임 별도',
      });
    });

    it('breakHours가 배열이 아니면 빈 배열, 읽을 수 없는 토막은 거른다', () => {
      expect(one({ ...span('10:00', '20:00'), breakHours: 'x' })?.breaks).toEqual([]);
      expect(
        one({
          ...span('10:00', '20:00'),
          breakHours: [{ start: '14:00', end: '15:00' }, { start: '1:00', end: '2:00' }, null],
        })?.breaks,
      ).toEqual([{ start: '14:00', end: '15:00' }]);
    });

    it('lastOrderTimes는 읽을 수 있는 시각만 모은다', () => {
      expect(
        one({
          ...span('10:00', '20:00'),
          lastOrderTimes: [
            { type: '점심', time: '14:30' },
            { type: '저녁', time: '19:30' },
            { type: '?', time: 'x' },
            null,
          ],
        })?.lastOrders,
      ).toEqual(['14:30', '19:30']);
      expect(one({ ...span('10:00', '20:00'), lastOrderTimes: 'x' })?.lastOrders).toEqual([]);
    });

    it('day가 문자열이 아닌 항목은 버린다', () => {
      const hours = toPlaceHours(
        '1',
        [{ businessHours: [{ day: 3, businessHours: null }, null, { day: '공휴일' }] }],
        T,
      );
      expect(hours.days.map((d) => d.day)).toEqual(['공휴일']);
    });
  });

  it('항목이 둘 이상이면 첫 항목으로 계산하고 나머지 이름을 모은다', () => {
    const hours = toPlaceHours(
      '1',
      [
        {
          name: '기본',
          businessHours: [{ day: '매일', businessHours: { start: '10:00', end: '20:00' } }],
        },
        {
          name: '수영장',
          businessHours: [{ day: '매일', businessHours: { start: '06:00', end: '09:00' } }],
        },
        { name: '', businessHours: [] },
      ],
      T,
    );
    expect(hours.days).toHaveLength(1);
    expect(hours.days[0]?.open?.start).toBe('10:00');
    expect(hours.otherSchedules).toEqual(['수영장']);
  });

  it('임시 휴무: 문자열은 그대로, 객체는 문자열 값만 이어 붙이고, 그 밖은 버린다', () => {
    const hours = toPlaceHours(
      '1',
      [
        {
          businessHours: [],
          comingIrregularClosedDays: [
            '2026-10-21 임시휴무',
            { date: '10월 22일', text: '내부 공사' },
            3,
          ],
          comingRegularClosedDays: '매월 둘째 월요일',
          freeText: '  ',
        },
      ],
      T,
    );
    expect(hours.irregularClosed).toEqual(['2026-10-21 임시휴무', '10월 22일 내부 공사']);
    expect(hours.regularClosed).toBe('매월 둘째 월요일');
    expect(hours.note).toBeNull();
  });

  it('raw가 null이거나 빈 배열이면 days는 빈 배열 (정보 없음)', () => {
    for (const raw of [null, []]) {
      expect(toPlaceHours('9', raw, T)).toEqual({
        sid: '9',
        fetchedAt: T,
        days: [],
        irregularClosed: [],
        regularClosed: null,
        note: null,
        otherSchedules: [],
      });
    }
  });
});

describe('resolveHours', () => {
  type Call = { url: string; init: RequestInit };

  function makeDeps(handler: (url: string, n: number) => Response) {
    const calls: Call[] = [];
    const deps: Deps = {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return handler(String(input), calls.length);
      }) as typeof fetch,
    };
    return { deps, calls };
  }

  const redirect = (location: string, status = 302) =>
    new Response(null, { status, headers: { Location: location } });
  const html200 = (sid = '11733192') => new Response(fixtureHtml(sid), { status: 200 });
  const BASE = 'https://pcmap.place.naver.com';

  it('302 → /restaurant/…를 쿼리 없이 따라가 읽는다', async () => {
    const { deps, calls } = makeDeps((url) =>
      url === `${BASE}/place/11733192/home`
        ? redirect('/restaurant/11733192/home?entry=x')
        : html200(),
    );
    const hours = await resolveHours('11733192', deps, () => NOW);
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/place/11733192/home`,
      `${BASE}/restaurant/11733192/home`,
    ]);
    expect(hours.fetchedAt).toBe(NOW.toISOString());
    expect(hours.sid).toBe('11733192');
    expect(hours.days).toHaveLength(7);
  });

  it('모든 요청은 redirect manual, Origin 없음, 세 헤더 있음', async () => {
    const { deps, calls } = makeDeps((url) =>
      url.includes('/place/') ? redirect('/restaurant/11733192/home') : html200(),
    );
    await resolveHours('11733192', deps, () => NOW);
    expect(calls).toHaveLength(2);
    for (const { init } of calls) {
      expect(init.redirect).toBe('manual');
      const headers = new Headers(init.headers);
      expect(headers.has('Origin')).toBe(false);
      expect(headers.get('User-Agent')).toContain('Mozilla/5.0');
      expect(headers.get('Accept-Language')).toBe('ko-KR,ko;q=0.9');
      expect(headers.get('Referer')).toBe('https://map.naver.com/');
    }
  });

  it('이동 없이 200이면 그대로 읽는다 (박물관)', async () => {
    const { deps, calls } = makeDeps(() => html200('11815720'));
    const hours = await resolveHours('11815720', deps, () => NOW);
    expect(calls).toHaveLength(1);
    expect(hours.days[0]?.day).toBe('매일');
  });

  it('이동은 2번까지, 3번째 이동은 UPSTREAM_ERROR', async () => {
    const two = makeDeps((_, n) =>
      n < 3 ? redirect(`/restaurant/11733192/home?n=${n}`) : html200(),
    );
    await expect(resolveHours('11733192', two.deps, () => NOW)).resolves.toMatchObject({
      sid: '11733192',
    });
    expect(two.calls).toHaveLength(3);

    const three = makeDeps(() => redirect('/restaurant/11733192/home'));
    const error = await apiError(resolveHours('11733192', three.deps, () => NOW));
    expect(error.code).toBe('UPSTREAM_ERROR');
    expect(three.calls).toHaveLength(3);
  });

  it.each([
    ['다른 호스트', 'https://evil.example.com/restaurant/11733192/home'],
    ['허용 목록의 다른 호스트', 'https://map.naver.com/restaurant/11733192/home'],
    ['다른 sid', '/restaurant/99999/home'],
    ['http', 'http://pcmap.place.naver.com/restaurant/11733192/home'],
    ['다른 꼴의 경로', '/restaurant/11733192/review'],
    ['대문자 업종', '/Restaurant/11733192/home'],
    ['포트', 'https://pcmap.place.naver.com:8443/restaurant/11733192/home'],
    ['Location 없음', ''],
  ])('%s로 이동하면 UPSTREAM_ERROR', async (_, location) => {
    const { deps, calls } = makeDeps(() =>
      location === '' ? new Response(null, { status: 302 }) : redirect(location),
    );
    const error = await apiError(resolveHours('11733192', deps, () => NOW));
    expect(error.code).toBe('UPSTREAM_ERROR');
    expect(calls).toHaveLength(1);
  });

  it('네이버 404는 NOT_FOUND', async () => {
    const { deps } = makeDeps(() => new Response('', { status: 404 }));
    expect((await apiError(resolveHours('11733192', deps, () => NOW))).code).toBe('NOT_FOUND');
  });

  it('500은 UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps(() => new Response('', { status: 500 }));
    expect((await apiError(resolveHours('11733192', deps, () => NOW))).code).toBe('UPSTREAM_ERROR');
  });

  it('빈 응답·키 없는 HTML(요청이 막힘)은 UPSTREAM_ERROR이고 빈 정보로 읽지 않는다', async () => {
    for (const body of ['', '<html><body>잠시 후 다시 시도</body></html>']) {
      const { deps } = makeDeps(() => new Response(body, { status: 200 }));
      expect((await apiError(resolveHours('11733192', deps, () => NOW))).code).toBe(
        'UPSTREAM_ERROR',
      );
    }
  });
});
