// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from 'src/server/http';
import type { Deps } from 'src/server/request';
import {
  parseRouteInputKey,
  parseRouteQuery,
  resolveRoute,
  routeInputKey,
  type RouteQuery,
} from 'src/server/route';

const CAR_URL =
  'https://map.naver.com/p/api/directions/car?start=128.89610,37.79530&goal=128.90060,37.79300';
const WALK_URL =
  'https://map.naver.com/p/api/directions/walk?o=all&l=128.89610,37.79530;128.90060,37.79300&lang=ko';
const FROM: [number, number] = [128.8961, 37.7953];
const TO: [number, number] = [128.9006, 37.793];
const NOW = new Date('2026-10-12T03:00:00.000Z');

function fixtureText(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/routes', name), 'utf8');
}

type Call = { url: string; headers: Record<string, string> };

function makeDeps(handler: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const deps: Deps & { now: () => Date } = {
    now: () => NOW,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers)) });
      return handler(String(input));
    }) as typeof fetch,
  };
  return { deps, calls };
}

const carQuery: RouteQuery = { mode: 'car', from: FROM, to: TO };
const walkQuery: RouteQuery = { mode: 'walk', from: FROM, to: TO };

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('오류가 나야 함');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseRouteQuery', () => {
  const url = (qs: string) => new URL(`http://localhost:8788/api/route?${qs}`);

  it('정상 질의', () => {
    expect(parseRouteQuery(url('mode=car&from=128.8961,37.7953&to=128.9006,37.793'))).toEqual({
      mode: 'car',
      from: [128.8961, 37.7953],
      to: [128.9006, 37.793],
    });
    expect(parseRouteQuery(url('mode=walk&from=128,37&to=129,38')).mode).toBe('walk');
  });

  it.each([
    ['mode 없음', 'from=128.8,37.7&to=128.9,37.8'],
    ['mode 틀림', 'mode=bike&from=128.8,37.7&to=128.9,37.8'],
    ['from 없음', 'mode=car&to=128.9,37.8'],
    ['to 없음', 'mode=car&from=128.8,37.7'],
    ['좌표 형식 틀림', 'mode=car&from=abc,37.7&to=128.9,37.8'],
    ['좌표가 한 개', 'mode=car&from=128.8&to=128.9,37.8'],
    ['좌표가 세 개', 'mode=car&from=128.8,37.7,1&to=128.9,37.8'],
    ['지수 표기', 'mode=car&from=1.288e2,37.7&to=128.9,37.8'],
    ['빈 값', 'mode=car&from=&to='],
    ['경도 범위 밖(서쪽)', 'mode=car&from=123.9,37.7&to=128.9,37.8'],
    ['경도 범위 밖(동쪽)', 'mode=car&from=128.8,37.7&to=132.1,37.8'],
    ['위도 범위 밖(남쪽)', 'mode=car&from=128.8,32.9&to=128.9,37.8'],
    ['위도 범위 밖(북쪽)', 'mode=car&from=128.8,37.7&to=128.9,39.1'],
    ['위도·경도를 바꿈', 'mode=car&from=37.7,128.8&to=128.9,37.8'],
  ])('%s → BAD_REQUEST', (_label, qs) => {
    try {
      parseRouteQuery(url(qs));
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('BAD_REQUEST');
      return;
    }
    throw new Error('오류가 나야 함');
  });

  it('범위 경계값은 받는다', () => {
    expect(() => parseRouteQuery(url('mode=car&from=124,33&to=132,39'))).not.toThrow();
  });
});

describe('routeInputKey / parseRouteInputKey', () => {
  it('좌표를 소수 5자리로 맞춘다', () => {
    expect(
      routeInputKey({ mode: 'car', from: [128.89612345, 37.7953], to: [128.9, 37.79300049] }),
    ).toBe('car:128.89612,37.79530>128.90000,37.79300');
  });

  it('입력 키를 다시 질의로 푼다', () => {
    const key = routeInputKey(walkQuery);
    expect(key).toBe('walk:128.89610,37.79530>128.90060,37.79300');
    expect(parseRouteInputKey(key)).toEqual(walkQuery);
  });

  it('모양이 틀린 키는 BAD_REQUEST', () => {
    expect(() => parseRouteInputKey('bike:1,2>3,4')).toThrow(ApiError);
    expect(() => parseRouteInputKey('car:128.1,37.1')).toThrow(ApiError);
  });
});

describe('resolveRoute 자동차', () => {
  it('픽스처 → 거리·시간(ms → 초 반올림)·통행료·경로선', async () => {
    const { deps, calls } = makeDeps(() => new Response(fixtureText('car-gangneung.json')));
    const result = await resolveRoute(carQuery, deps);
    // 2026-10-13에 녹화한 값: duration 48636ms. 조회 시점 교통에 따라 달라지는 값이라 픽스처에 고정한다.
    expect(result.mode).toBe('car');
    expect(result.distanceM).toBe(408);
    expect(result.durationS).toBe(Math.round(48636 / 1000));
    expect(result.tollFare).toBe(0);
    expect(result.queriedAt).toBe('2026-10-12T03:00:00.000Z');
    expect(result.path.length).toBeGreaterThanOrEqual(2);
    expect(result.path.length).toBeLessThanOrEqual(200);
    const fixture = JSON.parse(fixtureText('car-gangneung.json')) as {
      route: Record<string, { path: [number, number][] }[]>;
    };
    const raw = Object.values(fixture.route)[0]![0]!.path;
    expect(result.path[0]).toEqual(raw[0]);
    expect(result.path.at(-1)).toEqual(raw.at(-1));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(CAR_URL);
    expect(calls[0]!.headers['referer']).toBe('https://map.naver.com/');
    expect(calls[0]!.headers['user-agent']).toMatch(/^Mozilla\/5\.0 .*Chrome/);
  });

  it('통행료가 있으면 그 값', async () => {
    const body = JSON.parse(fixtureText('car-gangneung.json')) as {
      route: Record<string, { summary: { tollFare: number } }[]>;
    };
    Object.values(body.route)[0]![0]!.summary.tollFare = 4_800;
    const { deps } = makeDeps(() => new Response(JSON.stringify(body)));
    expect((await resolveRoute(carQuery, deps)).tollFare).toBe(4_800);
  });

  it('긴 경로선은 200점 이하로 줄인다', async () => {
    const body = JSON.parse(fixtureText('car-gangneung.json')) as {
      route: Record<string, { path: [number, number][] }[]>;
    };
    Object.values(body.route)[0]![0]!.path = Array.from({ length: 2_000 }, (_, i) => [
      128 + i * 0.0001,
      37 + Math.sin(i / 20) * 0.01,
    ]);
    const { deps } = makeDeps(() => new Response(JSON.stringify(body)));
    const result = await resolveRoute(carQuery, deps);
    expect(result.path.length).toBeLessThanOrEqual(200);
    expect(result.path[0]).toEqual([128, 37]);
    expect(result.path.at(-1)![0]).toBeCloseTo(128 + 1_999 * 0.0001, 10);
  });

  it.each([
    ['code가 0이 아님', { code: 1, message: '경로 없음', route: {} }],
    ['route가 비어 있음', { code: 0, message: 'ok', route: {} }],
    ['route 결과가 빈 배열', { code: 0, message: 'ok', route: { '3,0,0,0,0,0': [] } }],
  ])('%s → NO_ROUTE (HTTP 200이어도)', async (_label, body) => {
    const { deps } = makeDeps(() => new Response(JSON.stringify(body)));
    expect((await apiError(resolveRoute(carQuery, deps))).code).toBe('NO_ROUTE');
  });

  it.each([
    ['route 없음', { code: 0, message: 'ok' }],
    ['route가 문자열', { code: 0, route: 'x' }],
    ['route가 배열', { code: 0, route: [] }],
    ['route가 null', { code: 0, route: null }],
    ['code가 문자열', { code: '0', route: {} }],
    ['code가 null', { code: null, route: {} }],
  ])('%s → UPSTREAM_ERROR (모양이 다름)', async (_label, body) => {
    const { deps } = makeDeps(() => new Response(JSON.stringify(body)));
    expect((await apiError(resolveRoute(carQuery, deps))).code).toBe('UPSTREAM_ERROR');
  });
});

describe('resolveRoute 도보', () => {
  it('픽스처 → 거리·시간(초 그대로)·통행료 null·경로선', async () => {
    const { deps, calls } = makeDeps(() => new Response(fixtureText('walk-gangneung.json')));
    const result = await resolveRoute(walkQuery, deps);
    expect(result.mode).toBe('walk');
    expect(result.distanceM).toBe(1074);
    expect(result.durationS).toBe(958);
    expect(result.tollFare).toBeNull();
    expect(result.queriedAt).toBe('2026-10-12T03:00:00.000Z');
    expect(result.path.length).toBeGreaterThanOrEqual(2);
    expect(result.path.length).toBeLessThanOrEqual(200);

    // 끝점은 걸음 경로 문자열의 첫 점과 마지막 점이다.
    const fixture = JSON.parse(fixtureText('walk-gangneung.json')) as {
      routes: { legs: { steps: { path: string | null }[] }[] }[];
    };
    const points = fixture.routes[0]!.legs[0]!.steps.flatMap((s) =>
      s.path === null ? [] : s.path.split(' ').map((p) => p.split(',').map(Number)),
    );
    expect(result.path[0]).toEqual(points[0]);
    expect(result.path.at(-1)).toEqual(points.at(-1));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(WALK_URL);
    expect(calls[0]!.headers['referer']).toBe('https://map.naver.com/');
  });

  it('null 단계는 건너뛰고 이어 붙이며 연속 중복 점은 한 번만', async () => {
    const body = {
      routes: [
        {
          summary: { distance: 100, duration: 80 },
          legs: [
            {
              steps: [
                { path: null },
                { path: '128.1,37.1 128.2,37.1' },
                { path: '128.2,37.1 128.2,37.3' },
                { path: null },
                { path: '128.2,37.3 128.5,37.3' },
              ],
            },
          ],
        },
      ],
    };
    const { deps } = makeDeps(() => new Response(JSON.stringify(body)));
    expect((await resolveRoute(walkQuery, deps)).path).toEqual([
      [128.1, 37.1],
      [128.2, 37.1],
      [128.2, 37.3],
      [128.5, 37.3],
    ]);
  });

  it('직선 위의 중간점은 줄이지만 방향이 바뀌는 점은 남는다', async () => {
    const body = {
      routes: [
        {
          summary: { distance: 100, duration: 80 },
          legs: [{ steps: [{ path: '128.1,37.1 128.2,37.1 128.2,37.2' }] }],
        },
      ],
    };
    const { deps } = makeDeps(() => new Response(JSON.stringify(body)));
    expect((await resolveRoute(walkQuery, deps)).path).toEqual([
      [128.1, 37.1],
      [128.2, 37.1],
      [128.2, 37.2],
    ]);
  });

  it('code 4(직선 50km 초과) → NO_ROUTE', async () => {
    const { deps } = makeDeps(() => new Response(fixtureText('walk-too-far.json')));
    // 질의는 50km 이내라 네이버를 부르지만 응답이 code 4인 경우.
    expect((await apiError(resolveRoute(walkQuery, deps))).code).toBe('NO_ROUTE');
  });

  it('routes가 빈 배열이면 NO_ROUTE', async () => {
    const { deps } = makeDeps(() => new Response(JSON.stringify({ routes: [] })));
    expect((await apiError(resolveRoute(walkQuery, deps))).code).toBe('NO_ROUTE');
  });

  it.each([
    ['routes 없음', {}],
    ['routes가 객체', { routes: {} }],
    ['routes가 null', { routes: null }],
    ['code가 문자열', { code: '4' }],
    ['code가 null', { code: null, routes: [] }],
  ])('%s → UPSTREAM_ERROR (모양이 다름)', async (_label, body) => {
    const { deps } = makeDeps(() => new Response(JSON.stringify(body)));
    expect((await apiError(resolveRoute(walkQuery, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('숫자 code가 0이 아니면 routes가 없어도 NO_ROUTE', async () => {
    const { deps } = makeDeps(() => new Response(JSON.stringify({ code: 4, error: 'x' })));
    expect((await apiError(resolveRoute(walkQuery, deps))).code).toBe('NO_ROUTE');
  });

  it('한쪽이 빈 쌍·숫자가 아닌 쌍은 건너뛴다(빈 값이 0으로 읽히지 않는다)', async () => {
    const body = {
      routes: [
        {
          summary: { distance: 100, duration: 80 },
          legs: [{ steps: [{ path: '128.1,37.1 ,37.1 128.2, abc,def 128.2,37.1,5 128.3,37.2' }] }],
        },
      ],
    };
    const { deps } = makeDeps(() => new Response(JSON.stringify(body)));
    expect((await resolveRoute(walkQuery, deps)).path).toEqual([
      [128.1, 37.1],
      [128.3, 37.2],
    ]);
  });

  it('직선 50km 초과 도보는 네이버에 묻지 않고 NO_ROUTE', async () => {
    const { deps, calls } = makeDeps(() => new Response(fixtureText('walk-too-far.json')));
    const far: RouteQuery = { mode: 'walk', from: [126.978, 37.5665], to: [126.5312, 33.4996] };
    expect((await apiError(resolveRoute(far, deps))).code).toBe('NO_ROUTE');
    expect(calls).toHaveLength(0);
  });

  it('직선 50km 바로 안쪽은 묻는다', async () => {
    const { deps, calls } = makeDeps(() => new Response(fixtureText('walk-gangneung.json')));
    // 위도 0.44도 ≈ 48.9km
    const near: RouteQuery = { mode: 'walk', from: [128.9, 37.5], to: [128.9, 37.94] };
    await resolveRoute(near, deps);
    expect(calls).toHaveLength(1);
  });
});

describe('resolveRoute 오류', () => {
  it('JSON이 아니면 UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps(() => new Response('<html>점검 중</html>'));
    expect((await apiError(resolveRoute(carQuery, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('본문이 비어 있으면 UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps(() => new Response(null, { status: 200 }));
    expect((await apiError(resolveRoute(walkQuery, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it.each([400, 404, 500, 503])('HTTP %i → UPSTREAM_ERROR', async (status) => {
    const { deps } = makeDeps(() => new Response('{}', { status }));
    expect((await apiError(resolveRoute(carQuery, deps))).code).toBe('UPSTREAM_ERROR');
    expect((await apiError(resolveRoute(walkQuery, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('요약 값이 숫자가 아니면 UPSTREAM_ERROR', async () => {
    const body = { code: 0, route: { a: [{ summary: { distance: 'x', duration: 1 }, path: [] }] } };
    const { deps } = makeDeps(() => new Response(JSON.stringify(body)));
    expect((await apiError(resolveRoute(carQuery, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('연결 실패 → UPSTREAM_ERROR', async () => {
    const deps: Deps = {
      fetch: (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch,
    };
    expect((await apiError(resolveRoute(carQuery, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('8초 안에 끝나지 않으면 TIMEOUT', async () => {
    vi.useFakeTimers();
    const deps: Deps = { fetch: (() => new Promise<Response>(() => {})) as typeof fetch };
    const assertion = expect(resolveRoute(carQuery, deps)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });
});
