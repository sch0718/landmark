// @vitest-environment node
import { onRequestGet as onSearchGet } from '../../../functions/api/search';
import { parseSearchQuery, searchInputKey } from 'src/server/search';
import { searchCacheKey } from 'src/server/cache-key';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Effect, Fiber } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheKey, hoursCacheKey, routeCacheKey } from 'src/server/cache-key';
import { RouteLookup } from 'src/services/route-lookup';
import { onRequestGet as onFolderGet } from '../../../functions/api/naver-folder';
import { onRequestGet as onHoursGet } from '../../../functions/api/hours';
import { onRequestGet as onPlaceGet } from '../../../functions/api/place';
import { onRequestGet as onRouteGet } from '../../../functions/api/route';

const SHARE_ID = 'fb65e7f93f8a4144a4ded594d604a7aa';
const FOLDER_API = `https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/${SHARE_ID}/bookmarks`;
const NAVER_SUMMARY = 'https://map.naver.com/p/api/place/summary/';
const NAVER_WEB_LINK =
  'https://map.naver.com/p/entry/place/1958911015?c=15.00,0,0,0,dh&placePath=/home?entry=plt';
const NAVER_CAR =
  'https://map.naver.com/p/api/directions/car?start=128.89610,37.79530&goal=128.90060,37.79300';
const NAVER_WALK =
  'https://map.naver.com/p/api/directions/walk?o=all&l=128.89610,37.79530;128.90060,37.79300&lang=ko';
const ROUTE_QS = 'from=128.8961,37.7953&to=128.9006,37.793';
const ALLOWED_ORIGIN = 'http://localhost:8788';

function routeFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/routes', name), 'utf8');
}

function fixtureText(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/links', name), 'utf8');
}

type Route = () => Response;

/**
 * 전역 fetch를 가짜로 바꾼다. 등록하지 않은 주소로 요청하면 실패한다.
 * Cloudflare 런타임처럼 다른 객체의 메서드로 불리면(`deps.fetch(…)`) `Illegal invocation`으로 실패한다.
 */
function stubFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async function (this: unknown, input: RequestInfo | URL) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
    }
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`예상하지 못한 요청: ${url}`);
    return route();
  });
  return calls;
}

function makeContext(path: string, headers: Record<string, string> = { Origin: ALLOWED_ORIGIN }) {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    request: new Request(`http://localhost:8788${path}`, { headers }),
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
  };
  return { ctx, pending };
}

const placePath = (url: string) => `/api/place?url=${encodeURIComponent(url)}`;
const folderPath = (share: string) => `/api/naver-folder?share=${encodeURIComponent(share)}`;

/** Cloudflare `caches.default`를 흉내 낸다. 키는 문자열로 다룬다. */
function stubCaches() {
  const store = new Map<string, Response>();
  const put = vi.fn(async (key: RequestInfo | URL, res: Response) => {
    store.set(String(key), res);
  });
  const match = vi.fn(async (key: RequestInfo | URL) => store.get(String(key))?.clone());
  vi.stubGlobal('caches', { default: { match, put } });
  return { store, put, match };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('cacheKey', () => {
  it('네이버 웹 주소는 쿼리가 달라도 같은 키(서비스·ID)', () => {
    const a = cacheKey('place', NAVER_WEB_LINK);
    const b = cacheKey('place', 'https://map.naver.com/p/entry/place/1958911015?placePath=%2Fhome');
    expect(a).toBe('https://cache.landmark/place/naver/1958911015');
    expect(b).toBe(a);
  });

  it('짧은 링크는 쿼리·해시를 뺀 링크', () => {
    expect(cacheKey('place', 'https://naver.me/Fk73Vab5')).toBe(
      'https://cache.landmark/link/naver.me/Fk73Vab5',
    );
    expect(cacheKey('place', 'https://naver.me/Fk73Vab5?x=1#y')).toBe(
      'https://cache.landmark/link/naver.me/Fk73Vab5',
    );
  });

  it('카카오 applink는 서비스·ID', () => {
    expect(cacheKey('place', 'https://applink.map.kakao.com/place?id=16990385')).toBe(
      'https://cache.landmark/place/kakao/16990385',
    );
  });

  it('구글 장소 주소는 쿼리를 뺀 링크', () => {
    expect(cacheKey('place', 'https://www.google.com/maps/place/A/@37.5,127.0,17z?entry=tts')).toBe(
      'https://cache.landmark/link/www.google.com/maps/place/A/@37.5,127.0,17z',
    );
  });

  it('폴더는 공유 ID', () => {
    expect(cacheKey('folder', SHARE_ID)).toBe(`https://cache.landmark/folder/${SHARE_ID}`);
  });
});

describe('GET /api/place', () => {
  it('허용 출처 + 네이버 링크 → 200 ResolvedPlace', async () => {
    stubFetch({
      [`${NAVER_SUMMARY}1958911015`]: () =>
        new Response(fixtureText('naver-place-1958911015.json')),
    });
    const { ctx } = makeContext(placePath(NAVER_WEB_LINK));
    const res = await onPlaceGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({
      kind: 'place',
      provider: 'naver',
      providerId: '1958911015',
      name: '구십도씨',
      address: '경기 시흥시 서울대학로264번길 7 138호, 139호 카페 구십도씨',
      lng: 126.7260583,
      lat: 37.3691439,
      category: '카페,디저트',
    });
  });

  it('Origin이 없으면 Referer의 출처로 검사한다', async () => {
    stubFetch({
      [`${NAVER_SUMMARY}1958911015`]: () =>
        new Response(fixtureText('naver-place-1958911015.json')),
    });
    const { ctx } = makeContext(placePath(NAVER_WEB_LINK), {
      Referer: 'https://feat-x.landmark-c5f.pages.dev/trips/a?b=1',
    });
    expect((await onPlaceGet(ctx)).status).toBe(200);
  });

  it.each([
    ['출처 없음', {}],
    ['다른 출처', { Origin: 'https://evil.example.com' }],
    ['다른 Referer', { Referer: 'https://evil.example.com/landmark-c5f.pages.dev' }],
    ['잘못된 Referer', { Referer: 'not a url' }],
    [
      'Origin이 다르면 Referer를 보지 않음',
      { Origin: 'https://evil.example.com', Referer: `${ALLOWED_ORIGIN}/` },
    ],
  ])(
    '%s → 403 FORBIDDEN_ORIGIN, 바깥 요청 없음',
    async (_label, headers: Record<string, string>) => {
      const calls = stubFetch({});
      const { ctx } = makeContext(placePath(NAVER_WEB_LINK), headers);
      const res = await onPlaceGet(ctx);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'FORBIDDEN_ORIGIN',
      );
      expect(calls).toHaveLength(0);
    },
  );

  it.each(['/api/place', '/api/place?url='])('%s → 400 UNSUPPORTED_LINK', async (path) => {
    const { ctx } = makeContext(path);
    const res = await onPlaceGet(ctx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNSUPPORTED_LINK');
  });

  it('지원하지 않는 링크 → 400, 바깥 요청 없음', async () => {
    const calls = stubFetch({});
    const { ctx } = makeContext(placePath('https://example.com/a'));
    expect((await onPlaceGet(ctx)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/naver-folder', () => {
  it('허용 출처 + 공유 ID → 200 FolderResult', async () => {
    stubFetch({
      [`${FOLDER_API}?start=0&limit=500`]: () =>
        new Response(fixtureText('naver-folder-page1.json')),
    });
    const { ctx } = makeContext(folderPath(SHARE_ID));
    const res = await onFolderGet(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { folderName: string; places: unknown[] };
    expect(body.folderName).toBe('속초, 고성, 양양 맛집');
    expect(body.places).toHaveLength(31);
  });

  it('1,001곳 → 413 TOO_MANY_PLACES', async () => {
    vi.useFakeTimers();
    const template = (
      JSON.parse(fixtureText('naver-folder-page1.json')) as { bookmarkList: object[] }
    ).bookmarkList[0]!;
    const all = Array.from({ length: 1_001 }, (_, i) => ({ ...template, sid: String(i + 1) }));
    const page = (start: number) => () =>
      new Response(
        JSON.stringify({
          folder: { name: '큰 폴더' },
          bookmarkList: all.slice(start, start + 500),
        }),
      );
    stubFetch({
      [`${FOLDER_API}?start=0&limit=500`]: page(0),
      [`${FOLDER_API}?start=500&limit=500`]: page(500),
      [`${FOLDER_API}?start=1000&limit=500`]: page(1000),
    });
    const { ctx } = makeContext(folderPath(SHARE_ID));
    const promise = onFolderGet(ctx);
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TOO_MANY_PLACES');
  });

  it('share 없음 → 400, 출처 없음 → 403', async () => {
    expect((await onFolderGet(makeContext('/api/naver-folder').ctx)).status).toBe(400);
    expect((await onFolderGet(makeContext(folderPath(SHARE_ID), {}).ctx)).status).toBe(403);
  });
});

describe('캐시', () => {
  it('caches가 없는 환경에서도 오류 없이 동작하고 waitUntil을 부르지 않는다', async () => {
    expect(typeof (globalThis as { caches?: unknown }).caches).toBe('undefined');
    stubFetch({
      [`${NAVER_SUMMARY}1958911015`]: () =>
        new Response(fixtureText('naver-place-1958911015.json')),
    });
    const { ctx, pending } = makeContext(placePath(NAVER_WEB_LINK));
    expect((await onPlaceGet(ctx)).status).toBe(200);
    expect(pending).toHaveLength(0);
  });

  it('장소 결과를 1일 동안 저장하고, 같은 키로 다시 오면 바깥 요청 없이 돌려준다', async () => {
    const cache = stubCaches();
    const calls = stubFetch({
      [`${NAVER_SUMMARY}1958911015`]: () =>
        new Response(fixtureText('naver-place-1958911015.json')),
    });
    const first = makeContext(placePath(NAVER_WEB_LINK));
    const res = await onPlaceGet(first.ctx);
    expect(res.status).toBe(200);
    // 브라우저에는 공유 캐시 지시를 주지 않는다.
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    await Promise.all(first.pending);
    expect(cache.put).toHaveBeenCalledTimes(1);
    const [key, stored] = cache.put.mock.calls[0]!;
    expect(String(key)).toBe('https://cache.landmark/place/naver/1958911015');
    expect(stored.headers.get('Cache-Control')).toBe('max-age=86400');

    // 쿼리만 다른 같은 장소 링크
    const second = makeContext(placePath('https://map.naver.com/p/entry/place/1958911015'));
    const hit = await onPlaceGet(second.ctx);
    expect(hit.status).toBe(200);
    // 캐시에서 나간 응답도 브라우저에는 private이고, 저장된 사본의 max-age는 그대로다.
    expect(hit.headers.get('Cache-Control')).toBe('private, no-store');
    expect(
      cache.store
        .get('https://cache.landmark/place/naver/1958911015')!
        .headers.get('Cache-Control'),
    ).toBe('max-age=86400');
    expect(((await hit.json()) as { name: string }).name).toBe('구십도씨');
    expect(calls).toHaveLength(1);
  });

  it('폴더 결과는 10분 동안 저장한다', async () => {
    const cache = stubCaches();
    stubFetch({
      [`${FOLDER_API}?start=0&limit=500`]: () =>
        new Response(fixtureText('naver-folder-page1.json')),
    });
    const { ctx, pending } = makeContext(folderPath(SHARE_ID));
    expect((await onFolderGet(ctx)).status).toBe(200);
    await Promise.all(pending);
    const [key, stored] = cache.put.mock.calls[0]!;
    expect(String(key)).toBe(`https://cache.landmark/folder/${SHARE_ID}`);
    expect(stored.headers.get('Cache-Control')).toBe('max-age=600');
  });

  it('오류 응답은 저장하지 않는다', async () => {
    const cache = stubCaches();
    stubFetch({ [`${NAVER_SUMMARY}1958911015`]: () => new Response('err', { status: 500 }) });
    const { ctx, pending } = makeContext(placePath(NAVER_WEB_LINK));
    expect((await onPlaceGet(ctx)).status).toBe(502);
    await Promise.all(pending);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('출처가 막히면 캐시도 보지 않는다', async () => {
    const cache = stubCaches();
    const { ctx } = makeContext(placePath(NAVER_WEB_LINK), {});
    expect((await onPlaceGet(ctx)).status).toBe(403);
    expect(cache.match).not.toHaveBeenCalled();
  });
});

describe('routeCacheKey', () => {
  it('입력 키를 인코딩해 route/ 아래에 둔다', () => {
    expect(routeCacheKey('car:128.89610,37.79530>128.90060,37.79300')).toBe(
      `https://cache.landmark/route/${encodeURIComponent('car:128.89610,37.79530>128.90060,37.79300')}`,
    );
  });
});

describe('GET /api/route', () => {
  it('자동차 → 200 RouteResult, 브라우저에는 private, no-store', async () => {
    const calls = stubFetch({
      [NAVER_CAR]: () => new Response(routeFixture('car-gangneung.json')),
    });
    const { ctx } = makeContext(`/api/route?mode=car&${ROUTE_QS}`);
    const res = await onRouteGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as {
      mode: string;
      distanceM: number;
      durationS: number;
      tollFare: number | null;
      path: unknown[];
      queriedAt: string;
    };
    expect(body).toMatchObject({ mode: 'car', distanceM: 408, durationS: 49, tollFare: 0 });
    expect(body.path.length).toBeLessThanOrEqual(200);
    expect(Number.isNaN(Date.parse(body.queriedAt))).toBe(false);
    expect(calls).toEqual([NAVER_CAR]);
  });

  it('도보 → 200, 통행료 null', async () => {
    stubFetch({ [NAVER_WALK]: () => new Response(routeFixture('walk-gangneung.json')) });
    const res = await onRouteGet(makeContext(`/api/route?mode=walk&${ROUTE_QS}`).ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: 'walk', durationS: 958, tollFare: null });
  });

  it.each([
    ['출처 없음', {}],
    ['다른 출처', { Origin: 'https://evil.example.com' }],
  ])('%s → 403, 바깥 요청 없음', async (_label, headers: Record<string, string>) => {
    const calls = stubFetch({});
    const res = await onRouteGet(makeContext(`/api/route?mode=car&${ROUTE_QS}`, headers).ctx);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it.each([
    '/api/route',
    '/api/route?mode=bike&from=128.8,37.7&to=128.9,37.8',
    '/api/route?mode=car&from=abc&to=128.9,37.8',
    '/api/route?mode=car&from=10,10&to=128.9,37.8',
  ])('%s → 400 BAD_REQUEST, 바깥 요청 없음', async (path) => {
    const calls = stubFetch({});
    const res = await onRouteGet(makeContext(path).ctx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
    expect(calls).toHaveLength(0);
  });

  it('도보 직선 50km 초과 → 404 NO_ROUTE, 바깥 요청 없음', async () => {
    const calls = stubFetch({});
    const res = await onRouteGet(
      makeContext('/api/route?mode=walk&from=126.978,37.5665&to=126.5312,33.4996').ctx,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NO_ROUTE');
    expect(calls).toHaveLength(0);
  });

  it('네이버 503 → 502 UPSTREAM_ERROR, 저장하지 않는다', async () => {
    const cache = stubCaches();
    stubFetch({ [NAVER_CAR]: () => new Response('err', { status: 503 }) });
    const { ctx, pending } = makeContext(`/api/route?mode=car&${ROUTE_QS}`);
    expect((await onRouteGet(ctx)).status).toBe(502);
    await Promise.all(pending);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('자동차는 1시간, 도보는 7일 저장하고 같은 좌표(반올림 후)는 바깥 요청 없이 돌려준다', async () => {
    const cache = stubCaches();
    const calls = stubFetch({
      [NAVER_CAR]: () => new Response(routeFixture('car-gangneung.json')),
      [NAVER_WALK]: () => new Response(routeFixture('walk-gangneung.json')),
    });
    const car = makeContext(`/api/route?mode=car&${ROUTE_QS}`);
    expect((await onRouteGet(car.ctx)).status).toBe(200);
    const walk = makeContext(`/api/route?mode=walk&${ROUTE_QS}`);
    expect((await onRouteGet(walk.ctx)).status).toBe(200);
    await Promise.all([...car.pending, ...walk.pending]);

    const carKey = routeCacheKey('car:128.89610,37.79530>128.90060,37.79300');
    const walkKey = routeCacheKey('walk:128.89610,37.79530>128.90060,37.79300');
    expect(cache.store.get(carKey)!.headers.get('Cache-Control')).toBe('max-age=3600');
    expect(cache.store.get(walkKey)!.headers.get('Cache-Control')).toBe('max-age=604800');

    // 소수 6자리 이하가 달라도 5자리로 반올림하면 같은 키
    const again = makeContext(
      '/api/route?mode=car&from=128.896101,37.795299&to=128.900599,37.793001',
    );
    const hit = await onRouteGet(again.ctx);
    expect(hit.status).toBe(200);
    expect(hit.headers.get('Cache-Control')).toBe('private, no-store');
    expect(calls).toHaveLength(2);
  });

  it('fresh=1이면 캐시를 보지 않고 다시 받아, 같은 키(fresh 없이)에 저장한다', async () => {
    const cache = stubCaches();
    const calls = stubFetch({
      [NAVER_CAR]: () => new Response(routeFixture('car-gangneung.json')),
    });
    const carKey = routeCacheKey('car:128.89610,37.79530>128.90060,37.79300');
    const first = makeContext(`/api/route?mode=car&${ROUTE_QS}`);
    expect((await onRouteGet(first.ctx)).status).toBe(200);
    await Promise.all(first.pending);
    expect(cache.match).toHaveBeenCalledTimes(1);
    expect(cache.match).toHaveBeenLastCalledWith(carKey);

    const fresh = makeContext(`/api/route?mode=car&${ROUTE_QS}&fresh=1`);
    const res = await onRouteGet(fresh.ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    await Promise.all(fresh.pending);
    expect(cache.match).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([NAVER_CAR, NAVER_CAR]);
    expect(cache.put).toHaveBeenCalledTimes(2);
    expect(String(cache.put.mock.calls[1]![0])).toBe(carKey);
    expect([...cache.store.keys()]).toEqual([carKey]);

    // 이후 보통 요청은 다시 캐시를 본다.
    const again = makeContext(`/api/route?mode=car&${ROUTE_QS}`);
    expect((await onRouteGet(again.ctx)).status).toBe(200);
    expect(cache.match).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
  });

  it('장소는 fresh=1을 몰라 그대로 캐시를 본다', async () => {
    const cache = stubCaches();
    stubFetch({});
    await onPlaceGet(makeContext(`${placePath(NAVER_WEB_LINK)}&fresh=1`).ctx);
    expect(cache.match).toHaveBeenCalledTimes(1);
  });

  it('폴더도 fresh=1이면 캐시를 보지 않고 다시 받아, 같은 키에 저장한다', async () => {
    const cache = stubCaches();
    const calls = stubFetch({
      [`${FOLDER_API}?start=0&limit=500`]: () =>
        new Response(fixtureText('naver-folder-page1.json')),
    });
    const folderKey = `https://cache.landmark/folder/${SHARE_ID}`;
    // 캐시에는 옛 응답이 들어 있다.
    cache.store.set(
      folderKey,
      new Response(JSON.stringify({ folderName: '옛 이름', places: [] }), {
        headers: { 'Cache-Control': 'max-age=600' },
      }),
    );

    const fresh = makeContext(`${folderPath(SHARE_ID)}&fresh=1`);
    const res = await onFolderGet(fresh.ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(((await res.json()) as { folderName: string }).folderName).toBe('속초, 고성, 양양 맛집');
    await Promise.all(fresh.pending);
    expect(cache.match).not.toHaveBeenCalled();
    expect(calls).toEqual([`${FOLDER_API}?start=0&limit=500`]);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(String(cache.put.mock.calls[0]![0])).toBe(folderKey);

    // 이어지는 보통 요청은 새 결과를 캐시에서 받는다(네이버 호출이 늘지 않는다).
    const again = makeContext(folderPath(SHARE_ID));
    const hit = await onFolderGet(again.ctx);
    expect(hit.status).toBe(200);
    expect(((await hit.json()) as { folderName: string }).folderName).toBe('속초, 고성, 양양 맛집');
    expect(cache.match).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });
});

describe('다시 계산 → 엣지 캐시 우회(RouteLookup + GET /api/route)', () => {
  it('refresh면 엣지 캐시가 있어도 네이버에 다시 묻고 새 queriedAt을 받는다', async () => {
    stubCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    const calls = stubFetch({
      [NAVER_CAR]: () => new Response(routeFixture('car-gangneung.json')),
    });
    // 브라우저의 fetch 자리에 서버 함수를 바로 잇는다. 응답 저장(waitUntil)이 끝난 뒤 돌려준다.
    const appFetch = (async (input: RequestInfo | URL) => {
      const { ctx, pending } = makeContext(String(input));
      const res = await onRouteGet(ctx);
      await Promise.all(pending);
      return res;
    }) as typeof fetch;
    const from: [number, number] = [128.8961, 37.7953];
    const to: [number, number] = [128.9006, 37.793];

    const [first, refreshed] = await Effect.runPromise(
      Effect.gen(function* () {
        const lookup = yield* RouteLookup;
        vi.setSystemTime(new Date('2026-10-13T01:00:00.000Z'));
        const a = yield* lookup.leg('car', from, to);
        vi.setSystemTime(new Date('2026-10-13T01:20:00.000Z'));
        const b = yield* lookup.leg('car', from, to, { refresh: true });
        return [a, b] as const;
      }).pipe(Effect.provide(RouteLookup.layerWith({ fetch: appFetch, storage: null }))),
    );
    expect(calls).toEqual([NAVER_CAR, NAVER_CAR]);
    expect(first.queriedAt).toBe('2026-10-13T01:00:00.000Z');
    expect(refreshed.queriedAt).toBe('2026-10-13T01:20:00.000Z');
  });

  it('엣지 캐시 응답이 늦어 보통 요청이 진행 중이어도, refresh는 합쳐지지 않고 네이버에 다시 묻는다', async () => {
    const cache = stubCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    const calls = stubFetch({
      [NAVER_CAR]: () => new Response(routeFixture('car-gangneung.json')),
    });
    const appFetch = (async (input: RequestInfo | URL) => {
      const { ctx, pending } = makeContext(String(input));
      const res = await onRouteGet(ctx);
      await Promise.all(pending);
      return res;
    }) as typeof fetch;
    const from: [number, number] = [128.8961, 37.7953];
    const to: [number, number] = [128.9006, 37.793];
    const wait = (ms: number) => Effect.promise(() => new Promise<void>((r) => setTimeout(r, ms)));

    // 엣지 캐시에 오래된 답(01:00)을 미리 넣어 둔다.
    vi.setSystemTime(new Date('2026-10-13T01:00:00.000Z'));
    await appFetch('/api/route?mode=car&from=128.89610,37.79530&to=128.90060,37.79300');
    expect(calls).toEqual([NAVER_CAR]);
    // 이제 엣지 캐시 조회가 느리다: 보통 요청이 캐시 응답을 기다리는 동안 refresh가 들어온다.
    const hit = cache.match.getMockImplementation()!;
    cache.match.mockImplementation(async (key) => {
      const stale = await hit(key); // 조회 시점의 오래된 답을 쥐고 늦게 돌려준다
      await new Promise((r) => setTimeout(r, 40));
      return stale;
    });

    vi.setSystemTime(new Date('2026-10-13T01:20:00.000Z'));
    const [plain, refreshed] = await Effect.runPromise(
      Effect.gen(function* () {
        const lookup = yield* RouteLookup;
        const slow = yield* Effect.forkChild(lookup.leg('car', from, to));
        yield* wait(5);
        const b = yield* lookup.leg('car', from, to, { refresh: true });
        return [yield* Fiber.join(slow), b] as const;
      }).pipe(Effect.provide(RouteLookup.layerWith({ fetch: appFetch, storage: null }))),
    );
    expect(calls).toEqual([NAVER_CAR, NAVER_CAR]);
    // 늦게 온 엣지 캐시의 오래된 답(01:00)은 먼저 끝난 refresh 결과(01:20)를 덮지 못하고, 보통 호출도 새 값을 받는다.
    expect(plain.queriedAt).toBe('2026-10-13T01:20:00.000Z');
    expect(refreshed.queriedAt).toBe('2026-10-13T01:20:00.000Z');
  });
});

describe('hoursCacheKey', () => {
  it('sid를 hours/naver/ 아래에 둔다', () => {
    expect(hoursCacheKey('11733192')).toBe('https://cache.landmark/hours/naver/11733192');
  });
});

describe('GET /api/hours', () => {
  const HOME = 'https://pcmap.place.naver.com';
  const hoursHtml = () =>
    readFileSync(resolve(process.cwd(), 'tests/fixtures/naver/pcmap-home-11733192.html'), 'utf8');
  // /place/… 는 식당·카페면 /restaurant/… 로 한 번 이동한다.
  const naverRoutes = (): Record<string, Route> => ({
    [`${HOME}/place/11733192/home`]: () =>
      new Response(null, { status: 302, headers: { Location: '/restaurant/11733192/home' } }),
    [`${HOME}/restaurant/11733192/home`]: () => new Response(hoursHtml()),
  });
  const hoursPath = (qs: string) => `/api/hours?${qs}`;
  const KEY = 'https://cache.landmark/hours/naver/11733192';

  it('허용 출처 + sid → 200 PlaceHours, 브라우저에는 private, no-store', async () => {
    stubFetch(naverRoutes());
    const { ctx } = makeContext(hoursPath('sid=11733192'));
    const res = await onHoursGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as { sid: string; days: unknown[] };
    expect(body.sid).toBe('11733192');
    expect(body.days).toHaveLength(7);
  });

  it('1일 저장하고, 같은 sid로 다시 오면 바깥 요청 없이 처음 fetchedAt 그대로 돌려준다', async () => {
    const cache = stubCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T01:00:00.000Z'));
    const calls = stubFetch(naverRoutes());
    const first = makeContext(hoursPath('sid=11733192'));
    const res = await onHoursGet(first.ctx);
    expect(res.status).toBe(200);
    await Promise.all(first.pending);
    expect(cache.put).toHaveBeenCalledTimes(1);
    const [key, stored] = cache.put.mock.calls[0]!;
    expect(String(key)).toBe(KEY);
    expect(stored.headers.get('Cache-Control')).toBe('max-age=86400');
    expect(calls).toHaveLength(2);

    vi.setSystemTime(new Date('2026-10-16T05:00:00.000Z'));
    const hit = await onHoursGet(makeContext(hoursPath('sid=11733192')).ctx);
    expect(hit.status).toBe(200);
    expect(hit.headers.get('Cache-Control')).toBe('private, no-store');
    expect(((await hit.json()) as { fetchedAt: string }).fetchedAt).toBe(
      '2026-10-16T01:00:00.000Z',
    );
    expect(calls).toHaveLength(2);
  });

  it('fresh=1은 캐시를 보지 않고 다시 받아 같은 키(fresh 없음)에 저장한다', async () => {
    const cache = stubCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T01:00:00.000Z'));
    const calls = stubFetch(naverRoutes());
    const first = makeContext(hoursPath('sid=11733192'));
    await onHoursGet(first.ctx);
    await Promise.all(first.pending);
    expect(calls).toHaveLength(2);

    vi.setSystemTime(new Date('2026-10-16T05:00:00.000Z'));
    cache.match.mockClear();
    const fresh = makeContext(hoursPath('sid=11733192&fresh=1'));
    const res = await onHoursGet(fresh.ctx);
    await Promise.all(fresh.pending);
    expect(res.status).toBe(200);
    expect(cache.match).not.toHaveBeenCalled();
    expect(((await res.json()) as { fetchedAt: string }).fetchedAt).toBe(
      '2026-10-16T05:00:00.000Z',
    );
    expect(calls).toHaveLength(4);
    expect(cache.put).toHaveBeenCalledTimes(2);
    expect(String(cache.put.mock.calls[1]![0])).toBe(KEY);
    // 보통 요청이 새 값을 받는다.
    const after = await onHoursGet(makeContext(hoursPath('sid=11733192')).ctx);
    expect(((await after.json()) as { fetchedAt: string }).fetchedAt).toBe(
      '2026-10-16T05:00:00.000Z',
    );
    expect(calls).toHaveLength(4);
  });

  it('sid가 숫자가 아니면 400 BAD_REQUEST, 바깥 요청 없음', async () => {
    const calls = stubFetch({});
    const res = await onHoursGet(makeContext(hoursPath('sid=abc')).ctx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
    expect((await onHoursGet(makeContext('/api/hours').ctx)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('상태·키가 없는 HTML이면 502, 저장하지 않는다', async () => {
    const cache = stubCaches();
    const calls = stubFetch({
      [`${HOME}/place/11733192/home`]: () => new Response('<html><body>blocked</body></html>'),
    });
    const { ctx, pending } = makeContext(hoursPath('sid=11733192'));
    const res = await onHoursGet(ctx);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UPSTREAM_ERROR');
    await Promise.all(pending);
    expect(cache.put).not.toHaveBeenCalled();
    // 캐시를 보고 실제로 네이버까지 가서 실패했다(다른 이유로 502가 난 것이 아니다).
    expect(cache.match).toHaveBeenCalledWith(KEY);
    expect(calls).toEqual([`${HOME}/place/11733192/home`]);
  });

  it('출처가 없으면 403, 캐시도 보지 않는다', async () => {
    const cache = stubCaches();
    const calls = stubFetch({});
    const res = await onHoursGet(makeContext(hoursPath('sid=11733192'), {}).ctx);
    expect(res.status).toBe(403);
    expect(cache.match).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe('약속 API 진입점', () => {
  it('transit은 10분 캐시 키와 1시간 TTL을 쓴다', async () => {
    const cache = stubCaches();
    const fetcher = vi.fn(async () => new Response(routeFixture('transit-city.json')));
    vi.stubGlobal('fetch', fetcher);
    const { ctx, pending } = makeContext(`/api/route?mode=transit&${ROUTE_QS}&at=2026-10-31T18:09`);
    expect((await onRouteGet(ctx)).status).toBe(200);
    await Promise.all(pending);
    const key = routeCacheKey('transit:2026-10-31T18:00:128.89610,37.79530>128.90060,37.79300');
    expect(cache.store.get(key)?.headers.get('Cache-Control')).toBe('max-age=3600');
    expect(
      (await onRouteGet(makeContext(`/api/route?mode=transit&${ROUTE_QS}&at=2026-10-31T18:01`).ctx))
        .status,
    ).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([onSearchGet, onRouteGet])(
    '허용하지 않은 출처는 캐시·네트워크 전에 거부한다 %#',
    async (handler) => {
      const cache = stubCaches();
      const calls = stubFetch({});
      expect(
        (await handler(makeContext('/api/search?q=역', { Origin: 'https://evil.test' }).ctx))
          .status,
      ).toBe(403);
      expect(cache.match).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    },
  );
  it('검색은 정규화한 입력 캐시와 7일 TTL을 쓴다', async () => {
    const cache = stubCaches();
    const fetcher = vi.fn(
      async () =>
        new Response(readFileSync('tests/fixtures/naver/instant-search-gangnam.json', 'utf8')),
    );
    vi.stubGlobal('fetch', fetcher);
    const path = '/api/search?q=' + encodeURIComponent(' 강남역 ');
    const { ctx, pending } = makeContext(path);
    const res = await onSearchGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    await Promise.all(pending);
    const key = searchCacheKey(searchInputKey(parseSearchQuery(new URL(ctx.request.url))));
    expect(cache.store.get(key)?.headers.get('Cache-Control')).toBe('max-age=604800');
    expect(
      (await onSearchGet(makeContext('/api/search?q=' + encodeURIComponent('강남역')).ctx)).status,
    ).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['/api/search', '/api/search?q=', '/api/search?q=a&near=0,0'])(
    '검색 입력 오류 %s는 캐시에 넣지 않는다',
    async (path) => {
      const cache = stubCaches();
      expect((await onSearchGet(makeContext(path).ctx)).status).toBe(400);
      expect(cache.match).not.toHaveBeenCalled();
      expect(cache.put).not.toHaveBeenCalled();
    },
  );
});
