// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from 'src/server/http';
import { decodePlusCode } from 'src/server/plus-code';
import { resolveFolder, resolveLink, type Deps } from 'src/server/resolve';

const SHARE_ID = 'fb65e7f93f8a4144a4ded594d604a7aa';
const FOLDER_API = `https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/${SHARE_ID}/bookmarks`;
const NAVER_SUMMARY = 'https://map.naver.com/p/api/place/summary/';
const KAKAO_PANEL3 = 'https://place-api.map.kakao.com/places/panel3/';
const NAVER_WEB_LINK =
  'https://map.naver.com/p/entry/place/1540168051?c=15.00,0,0,0,dh&placePath=/home?entry=plt';
const GOOGLE_NO_LOCATION =
  'https://www.google.com/maps/place/%EC%9D%B4%EC%9E%AC%EB%AA%A8%ED%94%BC%EC%9E%90+%EB%B3%B8%EC%A0%90/data=!4m2!3m1!1s0x1520f8eed52456f1:0x129df2a4704f8520';

function fixtureText(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/links', name), 'utf8');
}

function fixtureJson<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

const REDIRECTS =
  fixtureJson<Record<string, { status: number; location: string }>>('redirects.json');

type Route = () => Response | Promise<Response>;
type Call = { url: string; init: RequestInit | undefined; headers: Record<string, string> };

function json(name: string, status = 200): Route {
  return () => new Response(fixtureText(name), { status });
}

function redirect(location: string, status = 302): Route {
  return () => new Response(null, { status, headers: { Location: location } });
}

function recorded(url: string): Route {
  const r = REDIRECTS[url];
  if (!r) throw new Error(`녹화된 이동 없음: ${url}`);
  return redirect(r.location, r.status);
}

function makeDeps(routes: Record<string, Route>, timeoutMs?: number) {
  const calls: Call[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url, init, headers });
    const route = routes[url];
    if (!route) throw new Error(`예상하지 못한 요청: ${url}`);
    return route();
  };
  const deps: Deps = { fetch: fakeFetch as typeof fetch };
  if (timeoutMs !== undefined) deps.timeoutMs = timeoutMs;
  return { deps, calls };
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('ApiError가 나지 않음');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveLink — 사용자 예시 링크', () => {
  it('naver.me 짧은 링크 → 네이버 장소', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/Fk73Vab5': recorded('https://naver.me/Fk73Vab5'),
      [`${NAVER_SUMMARY}1958911015`]: json('naver-place-1958911015.json'),
    });
    expect(await resolveLink('https://naver.me/Fk73Vab5', deps)).toEqual({
      kind: 'place',
      provider: 'naver',
      providerId: '1958911015',
      name: '구십도씨',
      address: '경기 시흥시 서울대학로264번길 7 138호, 139호 카페 구십도씨',
      lng: 126.7260583,
      lat: 37.3691439,
      category: '카페,디저트',
    });
    expect(calls.map((c) => c.url)).toEqual([
      'https://naver.me/Fk73Vab5',
      `${NAVER_SUMMARY}1958911015`,
    ]);
    const summary = calls[1]!;
    expect(summary.headers['accept-language']).toMatch(/^ko-KR/);
    expect(summary.headers['referer']).toBe('https://map.naver.com/');
    expect(summary.headers['user-agent']).toMatch(/Mozilla/);
    expect(summary.headers['origin']).toBeUndefined();
  });

  it('네이버 웹 주소 → 이동 없이 조회, 도로명이 없으면 지번 주소', async () => {
    const { deps, calls } = makeDeps({
      [`${NAVER_SUMMARY}1540168051`]: json('naver-place-1540168051.json'),
    });
    expect(await resolveLink(NAVER_WEB_LINK, deps)).toEqual({
      kind: 'place',
      provider: 'naver',
      providerId: '1540168051',
      name: '콤포트',
      address: '서울 용산구 후암동 358-144',
      lng: 126.9833092,
      lat: 37.5494047,
      category: '전시,행사대행',
    });
    expect(calls).toHaveLength(1);
  });

  it('kko.to 짧은 링크 → 카카오 장소(도로명 주소, point 좌표)', async () => {
    const { deps, calls } = makeDeps({
      'https://kko.to/MWuG8x8eN4': recorded('https://kko.to/MWuG8x8eN4'),
      [`${KAKAO_PANEL3}16990385`]: json('kakao-panel3-16990385.json'),
    });
    expect(await resolveLink('https://kko.to/MWuG8x8eN4', deps)).toEqual({
      kind: 'place',
      provider: 'kakao',
      providerId: '16990385',
      name: '쟝블랑제리',
      address: '서울 관악구 낙성대역길 8 1층 (봉천동)',
      lng: 126.96196823436256,
      lat: 37.477157623198956,
      category: '제과,베이커리',
    });
    const panel = calls[1]!;
    expect(panel.url).toBe(`${KAKAO_PANEL3}16990385`);
    expect(panel.headers['pf']).toBe('web');
    expect(panel.headers['referer']).toBe('https://place.map.kakao.com/');
    expect(panel.headers['user-agent']).toMatch(/Mozilla/);
  });

  it('maps.app.goo.gl 짧은 링크 → 구글 장소(Plus Code 좌표, 빈 주소)', async () => {
    const { deps, calls } = makeDeps({
      'https://maps.app.goo.gl/SsZWtW1xgZVgijxK6': recorded(
        'https://maps.app.goo.gl/SsZWtW1xgZVgijxK6',
      ),
    });
    const place = await resolveLink('https://maps.app.goo.gl/SsZWtW1xgZVgijxK6', deps);
    const expected = decodePlusCode('8Q7F422J+R6X')!;
    expect(place).toEqual({
      kind: 'place',
      provider: 'google',
      providerId: '0x1520f8eed52456f1:0x129df2a4704f8520',
      name: '이재모피자 본점',
      address: '',
      lng: expected.lng,
      lat: expected.lat,
      category: null,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['user-agent']).toBe('landmark-link-resolver');
  });

  it('모든 요청은 redirect: manual이다', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/Fk73Vab5': recorded('https://naver.me/Fk73Vab5'),
      [`${NAVER_SUMMARY}1958911015`]: json('naver-place-1958911015.json'),
    });
    await resolveLink('https://naver.me/Fk73Vab5', deps);
    expect(calls.map((c) => c.init?.redirect)).toEqual(['manual', 'manual']);
  });
});

describe('resolveLink — 구글 링크 변형', () => {
  it('좌표(!3d!4d)가 있으면 그것을 쓴다', async () => {
    const { deps } = makeDeps({});
    const place = await resolveLink(
      'https://www.google.com/maps/place/Foo/@35.1,129.0,17z/data=!4m6!3m5!1s0x1:0x2!8m2!3d35.1021!4d129.0306',
      deps,
    );
    expect(place).toMatchObject({
      providerId: '0x1:0x2',
      name: 'Foo',
      lat: 35.1021,
      lng: 129.0306,
    });
  });

  it('장소 ID 없이 좌표만 있으면 providerId: null', async () => {
    const { deps } = makeDeps({});
    const place = await resolveLink('https://www.google.com/maps/place/Foo/@35.1,129.0,17z', deps);
    expect(place).toMatchObject({ provider: 'google', providerId: null, lat: 35.1, lng: 129.0 });
  });

  it('좌표·Plus Code가 없으면 NOT_FOUND + no-location과 장소 이름', async () => {
    const { deps } = makeDeps({});
    const e = await apiError(resolveLink(GOOGLE_NO_LOCATION, deps));
    expect(e.code).toBe('NOT_FOUND');
    expect(e.detail).toEqual({ reason: 'no-location', placeName: '이재모피자 본점' });
  });

  it('이름도 위치도 없으면 detail 없는 NOT_FOUND', async () => {
    const { deps } = makeDeps({});
    const e = await apiError(
      resolveLink('https://www.google.com/maps/place//data=!4m2!3m1!1s0x1:0x2', deps),
    );
    expect(e.code).toBe('NOT_FOUND');
    expect(e.detail).toBeUndefined();
  });
});

describe('resolveLink — 폴더', () => {
  it('naver.me 폴더 링크 → FolderRef(폴더는 조회하지 않음)', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/xjYaIYfe': recorded('https://naver.me/xjYaIYfe'),
    });
    expect(await resolveLink('https://naver.me/xjYaIYfe', deps)).toEqual({
      kind: 'folder',
      shareId: SHARE_ID,
    });
    expect(calls).toHaveLength(1);
  });

  it('v5 내 장소 폴더로 이동하는 naver.me 링크 → FolderRef', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/FQI4XSw3': redirect(
        `https://map.naver.com/v5/favorite/myPlace/folder/${SHARE_ID}`,
      ),
    });
    expect(await resolveLink('https://naver.me/FQI4XSw3', deps)).toEqual({
      kind: 'folder',
      shareId: SHARE_ID,
    });
    expect(calls).toHaveLength(1);
  });

  it('폴더 웹 주소 → FolderRef', async () => {
    const { deps } = makeDeps({});
    expect(
      await resolveLink(`https://map.naver.com/p/favorite/sharedPlace/folder/${SHARE_ID}`, deps),
    ).toEqual({ kind: 'folder', shareId: SHARE_ID });
  });
});

describe('resolveLink — 이동 따라가기', () => {
  it('세 번 이동해 장소 주소에 닿으면 조회한다', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/a': redirect('https://naver.me/b'),
      'https://naver.me/b': redirect('https://naver.me/c'),
      'https://naver.me/c': redirect('https://map.naver.com/p/entry/place/1958911015'),
      [`${NAVER_SUMMARY}1958911015`]: json('naver-place-1958911015.json'),
    });
    expect(await resolveLink('https://naver.me/a', deps)).toMatchObject({
      providerId: '1958911015',
    });
    expect(calls).toHaveLength(4);
  });

  it('상대·프로토콜 생략 Location은 응답 주소 기준 절대 주소로 풀어 분류한다', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/x': redirect('/y'),
      'https://naver.me/y': redirect('//map.naver.com/p/entry/place/1958911015'),
      [`${NAVER_SUMMARY}1958911015`]: json('naver-place-1958911015.json'),
    });
    expect(await resolveLink('https://naver.me/x', deps)).toMatchObject({
      providerId: '1958911015',
    });
    expect(calls.map((c) => c.url)).toEqual([
      'https://naver.me/x',
      'https://naver.me/y',
      `${NAVER_SUMMARY}1958911015`,
    ]);
  });

  it('4번째 이동은 UNSUPPORTED_LINK, 네 번째 링크는 요청하지 않는다', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/a': redirect('https://naver.me/b'),
      'https://naver.me/b': redirect('https://naver.me/c'),
      'https://naver.me/c': redirect('https://naver.me/d'),
      'https://naver.me/d': redirect('https://map.naver.com/p/entry/place/1958911015'),
    });
    const e = await apiError(resolveLink('https://naver.me/a', deps));
    expect(e.code).toBe('UNSUPPORTED_LINK');
    expect(calls.map((c) => c.url)).toEqual([
      'https://naver.me/a',
      'https://naver.me/b',
      'https://naver.me/c',
    ]);
  });

  it.each([
    ['허용 밖 호스트', 'https://evil.example.com/p/entry/place/1'],
    ['허용 호스트를 흉내 낸 접미사', 'https://map.naver.com.evil.example.com/p/entry/place/1'],
    ['포트', 'https://map.naver.com:8443/p/entry/place/1'],
    ['사용자 정보', 'https://user@map.naver.com/p/entry/place/1'],
    ['다른 프로토콜', 'ftp://map.naver.com/p/entry/place/1'],
  ])('이동 대상이 %s이면 UNSUPPORTED_LINK, 그 주소로 요청하지 않는다', async (_label, target) => {
    const { deps, calls } = makeDeps({ 'https://naver.me/x': redirect(target) });
    const e = await apiError(resolveLink('https://naver.me/x', deps));
    expect(e.code).toBe('UNSUPPORTED_LINK');
    expect(calls.map((c) => c.url)).toEqual(['https://naver.me/x']);
  });

  it('이동 중 허용 밖 이동 링크로 바뀌어도 요청하지 않는다', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/x': redirect('https://kko.to/y'),
      'https://kko.to/y': redirect('https://evil.example.com/'),
    });
    const e = await apiError(resolveLink('https://naver.me/x', deps));
    expect(e.code).toBe('UNSUPPORTED_LINK');
    expect(calls.map((c) => c.url)).toEqual(['https://naver.me/x', 'https://kko.to/y']);
  });

  it('http로 붙여 넣은 짧은 링크는 https로 올려 요청한다', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/x': redirect('https://map.naver.com/p/entry/place/1958911015'),
      [`${NAVER_SUMMARY}1958911015`]: json('naver-place-1958911015.json'),
    });
    expect(await resolveLink('http://naver.me/x?utm=1#h', deps)).toMatchObject({
      providerId: '1958911015',
    });
    // 쿼리·해시도 보내지 않는다.
    expect(calls.map((c) => c.url)).toEqual(['https://naver.me/x', `${NAVER_SUMMARY}1958911015`]);
  });

  it('이동 대상이 http면 거절하고 그 주소로 요청하지 않는다', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/x': redirect('http://map.naver.com/p/entry/place/1958911015'),
    });
    const e = await apiError(resolveLink('https://naver.me/x', deps));
    expect(e.code).toBe('UNSUPPORTED_LINK');
    expect(calls.map((c) => c.url)).toEqual(['https://naver.me/x']);
  });

  it('이동 대상이 http 짧은 링크여도 따라가지 않는다', async () => {
    const { deps, calls } = makeDeps({
      'https://naver.me/x': redirect('http://kko.to/y'),
    });
    expect((await apiError(resolveLink('https://naver.me/x', deps))).code).toBe('UNSUPPORTED_LINK');
    expect(calls).toHaveLength(1);
  });

  it('허용 호스트지만 장소가 아닌 곳으로 가면 UNSUPPORTED_LINK', async () => {
    const { deps } = makeDeps({
      'https://naver.me/x': redirect('https://map.naver.com/p/'),
    });
    expect((await apiError(resolveLink('https://naver.me/x', deps))).code).toBe('UNSUPPORTED_LINK');
  });

  it('짧은 링크가 404면 NOT_FOUND', async () => {
    const { deps } = makeDeps({
      'https://naver.me/zzzz': () => new Response('', { status: 404 }),
    });
    expect((await apiError(resolveLink('https://naver.me/zzzz', deps))).code).toBe('NOT_FOUND');
  });

  it('짧은 링크가 이동 없이 200이면 UNSUPPORTED_LINK', async () => {
    const { deps } = makeDeps({
      'https://maps.app.goo.gl/x': () => new Response('<html></html>', { status: 200 }),
    });
    expect((await apiError(resolveLink('https://maps.app.goo.gl/x', deps))).code).toBe(
      'UNSUPPORTED_LINK',
    );
  });

  it('이동 응답에 Location이 없으면 UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps({
      'https://naver.me/x': () => new Response(null, { status: 302 }),
    });
    expect((await apiError(resolveLink('https://naver.me/x', deps))).code).toBe('UPSTREAM_ERROR');
  });
});

describe('resolveLink — 지원하지 않는 입력', () => {
  it.each(['', '그냥 글', 'https://evil.example.com/p/entry/place/1', 'https://map.naver.com/p/'])(
    '%s → UNSUPPORTED_LINK, 요청 없음',
    async (raw) => {
      const { deps, calls } = makeDeps({});
      expect((await apiError(resolveLink(raw, deps))).code).toBe('UNSUPPORTED_LINK');
      expect(calls).toHaveLength(0);
    },
  );
});

describe('resolveLink — 조회 오류', () => {
  it('네이버 조회 404 → NOT_FOUND', async () => {
    const { deps } = makeDeps({
      [`${NAVER_SUMMARY}1540168051`]: () => new Response('', { status: 404 }),
    });
    expect((await apiError(resolveLink(NAVER_WEB_LINK, deps))).code).toBe('NOT_FOUND');
  });

  it('네이버 조회가 좌표 없는 빈 장소를 주면(없는 ID) NOT_FOUND', async () => {
    const { deps } = makeDeps({
      [`${NAVER_SUMMARY}1540168051`]: json('naver-place-missing.json'),
    });
    expect((await apiError(resolveLink(NAVER_WEB_LINK, deps))).code).toBe('NOT_FOUND');
  });

  it('네이버 조회 500 → UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps({
      [`${NAVER_SUMMARY}1540168051`]: () => new Response('err', { status: 500 }),
    });
    expect((await apiError(resolveLink(NAVER_WEB_LINK, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('네이버 조회가 JSON이 아니면 UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps({
      [`${NAVER_SUMMARY}1540168051`]: () => new Response('<html>', { status: 200 }),
    });
    expect((await apiError(resolveLink(NAVER_WEB_LINK, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('조회가 3xx로 다른 곳에 보내면 따라가지 않고 UPSTREAM_ERROR', async () => {
    const { deps, calls } = makeDeps({
      [`${NAVER_SUMMARY}1540168051`]: redirect('https://evil.example.com/'),
    });
    expect((await apiError(resolveLink(NAVER_WEB_LINK, deps))).code).toBe('UPSTREAM_ERROR');
    expect(calls).toHaveLength(1);
  });

  it('카카오 조회 404(없는 장소) → NOT_FOUND', async () => {
    const { deps } = makeDeps({
      [`${KAKAO_PANEL3}99999999999`]: json('kakao-panel3-missing.json', 404),
    });
    expect(
      (await apiError(resolveLink('https://place.map.kakao.com/99999999999', deps))).code,
    ).toBe('NOT_FOUND');
  });

  it('카카오 응답에 좌표가 없으면 NOT_FOUND', async () => {
    const { deps } = makeDeps({
      [`${KAKAO_PANEL3}1`]: () =>
        new Response(JSON.stringify({ summary: { name: 'x' } }), { status: 200 }),
    });
    expect((await apiError(resolveLink('https://place.map.kakao.com/1', deps))).code).toBe(
      'NOT_FOUND',
    );
  });

  it('카카오 조회 500 → UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps({
      [`${KAKAO_PANEL3}1`]: () => new Response('', { status: 500 }),
    });
    expect((await apiError(resolveLink('https://place.map.kakao.com/1', deps))).code).toBe(
      'UPSTREAM_ERROR',
    );
  });

  it('본문을 받다가 끊기면 UPSTREAM_ERROR(NOT_FOUND로 오인하지 않는다)', async () => {
    const { deps } = makeDeps({
      [`${NAVER_SUMMARY}1540168051`]: () =>
        new Response(
          new ReadableStream({
            pull: (controller) => controller.error(new TypeError('terminated')),
          }),
        ),
    });
    expect((await apiError(resolveLink(NAVER_WEB_LINK, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('fetch가 실패(연결 오류)하면 UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps({
      [`${NAVER_SUMMARY}1540168051`]: () => Promise.reject(new TypeError('fetch failed')),
    });
    expect((await apiError(resolveLink(NAVER_WEB_LINK, deps))).code).toBe('UPSTREAM_ERROR');
  });
});

describe('시한', () => {
  it('fetch가 8초 안에 끝나지 않으면 TIMEOUT, 요청을 끊는다', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const deps: Deps = {
      fetch: ((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    };
    let settled: unknown = 'pending';
    const result = resolveLink(NAVER_WEB_LINK, deps).then(
      () => (settled = 'resolved'),
      (e: unknown) => (settled = e),
    );
    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(settled).toBeInstanceOf(ApiError);
    expect((settled as ApiError).code).toBe('TIMEOUT');
    expect(signal?.aborted).toBe(true);
  });

  it('본문이 끝나지 않아도 TIMEOUT', async () => {
    vi.useFakeTimers();
    const deps: Deps = {
      fetch: (async () =>
        new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), {
          status: 200,
        })) as typeof fetch,
    };
    const assertion = expect(resolveLink(NAVER_WEB_LINK, deps)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });

  it('timeoutMs로 시한을 바꾼다', async () => {
    vi.useFakeTimers();
    const deps: Deps = {
      fetch: (() => new Promise<Response>(() => {})) as typeof fetch,
      timeoutMs: 100,
    };
    const assertion = expect(resolveLink(NAVER_WEB_LINK, deps)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});

type RawBookmark = Record<string, unknown>;
type RawFolder = { folder: { name: string }; bookmarkList: RawBookmark[] };

describe('resolveFolder', () => {
  it('폴더 이름과 장소를 돌려준다', async () => {
    const { deps, calls } = makeDeps({
      [`${FOLDER_API}?start=0&limit=500`]: json('naver-folder-page1.json'),
    });
    const result = await resolveFolder(SHARE_ID, deps);
    expect(result.folderName).toBe('속초, 고성, 양양 맛집');
    expect(result.places).toHaveLength(31);
    expect(result.places[0]).toEqual({
      sid: '12028621',
      name: '청초수물회 속초본점',
      address: '강원 속초시 엑스포로 12-36',
      lng: 128.5905385,
      lat: 38.1921462,
      memo: '',
    });
    const call = calls[0]!;
    expect(call.headers['referer']).toBe(
      `https://pages.map.naver.com/save-pages/detail-list/${SHARE_ID}`,
    );
    expect(call.headers['origin']).toBeUndefined();
    expect(call.init?.redirect).toBe('manual');
  });

  it('좌표가 이상하거나 available: false인 북마크는 뺀다', async () => {
    const folder = fixtureJson<RawFolder>('naver-folder-page1.json');
    const list = folder.bookmarkList;
    list[0] = { ...list[0], available: false };
    list[1] = { ...list[1], px: null };
    list[2] = { ...list[2], py: 'abc' };
    list[3] = { ...list[3], px: undefined };
    list[4] = { ...list[4], px: 0, py: 0 };
    list[5] = { ...list[5], py: 91 };
    list[6] = { ...list[6], memo: '메모 한 줄' };
    const { deps } = makeDeps({
      [`${FOLDER_API}?start=0&limit=500`]: () => new Response(JSON.stringify(folder)),
    });
    const result = await resolveFolder(SHARE_ID, deps);
    expect(result.places).toHaveLength(31 - 6);
    const sids = result.places.map((p) => p.sid);
    for (const b of list.slice(0, 6)) expect(sids).not.toContain(String(b.sid));
    expect(result.places[0]).toMatchObject({ sid: String(list[6]!.sid), memo: '메모 한 줄' });
  });

  it('sid가 숫자가 아닌 북마크(주소 북마크)는 뺀다', async () => {
    const folder = fixtureJson<RawFolder>('naver-folder-page1.json');
    const list = folder.bookmarkList;
    list[0] = { ...list[0], sid: 'addr-abc123' };
    list[1] = { ...list[1], sid: '12a' };
    const { deps } = makeDeps({
      [`${FOLDER_API}?start=0&limit=500`]: () => new Response(JSON.stringify(folder)),
    });
    const result = await resolveFolder(SHARE_ID, deps);
    expect(result.places).toHaveLength(31 - 2);
    expect(result.places.every((p) => /^\d+$/.test(p.sid))).toBe(true);
  });

  it('없는 공유 ID(400 "공유 정보가 존재하지 않습니다") → NOT_FOUND', async () => {
    const { deps } = makeDeps({
      [`https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/deadbeef/bookmarks?start=0&limit=500`]:
        json('naver-folder-missing.json', 400),
    });
    expect((await apiError(resolveFolder('deadbeef', deps))).code).toBe('NOT_FOUND');
  });

  it('조회 500 → UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps({
      [`${FOLDER_API}?start=0&limit=500`]: () => new Response('', { status: 500 }),
    });
    expect((await apiError(resolveFolder(SHARE_ID, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('bookmarkList가 없는 응답 → UPSTREAM_ERROR', async () => {
    const { deps } = makeDeps({
      [`${FOLDER_API}?start=0&limit=500`]: () => new Response('{}'),
    });
    expect((await apiError(resolveFolder(SHARE_ID, deps))).code).toBe('UPSTREAM_ERROR');
  });

  it('공유 ID 형식이 아니면 요청하지 않고 UNSUPPORTED_LINK', async () => {
    const { deps, calls } = makeDeps({});
    for (const bad of ['', '../x', 'a/b', 'a?b', 'https://evil.example.com']) {
      expect((await apiError(resolveFolder(bad, deps))).code).toBe('UNSUPPORTED_LINK');
    }
    expect(calls).toHaveLength(0);
  });

  function bigFolder(count: number): Record<string, Route> {
    const template = fixtureJson<RawFolder>('naver-folder-page1.json').bookmarkList[0]!;
    const all = Array.from({ length: count }, (_, i) => ({ ...template, sid: String(i + 1) }));
    const page = (start: number) => () =>
      new Response(
        JSON.stringify({
          folder: { name: '큰 폴더' },
          bookmarkList: all.slice(start, start + 500),
        }),
      );
    return {
      [`${FOLDER_API}?start=0&limit=500`]: page(0),
      [`${FOLDER_API}?start=500&limit=500`]: page(500),
      [`${FOLDER_API}?start=1000&limit=500`]: page(1000),
    };
  }

  it('1,000곳은 가져온다', async () => {
    vi.useFakeTimers();
    const { deps } = makeDeps(bigFolder(1_000));
    const promise = resolveFolder(SHARE_ID, deps);
    await vi.runAllTimersAsync();
    expect((await promise).places).toHaveLength(1_000);
  });

  it('1,001곳 → TOO_MANY_PLACES', async () => {
    vi.useFakeTimers();
    const { deps } = makeDeps(bigFolder(1_001));
    const assertion = expect(resolveFolder(SHARE_ID, deps)).rejects.toMatchObject({
      code: 'TOO_MANY_PLACES',
    });
    await vi.runAllTimersAsync();
    await assertion;
  });
});
