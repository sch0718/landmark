// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheKey } from 'src/server/cache-key';
import { onRequestGet as onFolderGet } from '../../../functions/api/naver-folder';
import { onRequestGet as onPlaceGet } from '../../../functions/api/place';

const SHARE_ID = 'fb65e7f93f8a4144a4ded594d604a7aa';
const FOLDER_API = `https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/${SHARE_ID}/bookmarks`;
const NAVER_SUMMARY = 'https://map.naver.com/p/api/place/summary/';
const NAVER_WEB_LINK =
  'https://map.naver.com/p/entry/place/1958911015?c=15.00,0,0,0,dh&placePath=/home?entry=plt';
const ALLOWED_ORIGIN = 'http://localhost:8788';

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
    await Promise.all(first.pending);
    expect(cache.put).toHaveBeenCalledTimes(1);
    const [key, stored] = cache.put.mock.calls[0]!;
    expect(String(key)).toBe('https://cache.landmark/place/naver/1958911015');
    expect(stored.headers.get('Cache-Control')).toBe('max-age=86400');

    // 쿼리만 다른 같은 장소 링크
    const second = makeContext(placePath('https://map.naver.com/p/entry/place/1958911015'));
    const hit = await onPlaceGet(second.ctx);
    expect(hit.status).toBe(200);
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
