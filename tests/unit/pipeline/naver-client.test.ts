import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchCarRoute,
  fetchFolder,
  fetchPlaceSummary,
  TooManyPlacesError,
  type HttpDeps,
} from '../../../pipeline/naver-client';

const SHARE_ID = 'fb65e7f93f8a4144a4ded594d604a7aa';
const FOLDER_BASE = `https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/${SHARE_ID}/bookmarks`;
const ROUTE_URL =
  'https://map.naver.com/p/api/directions/car?start=128.8961,37.7519&goal=128.9184,37.7952';

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/naver', name), 'utf8');
}

type Seen = { url: string; headers: Record<string, string> };

function makeDeps(responses: Record<string, { status?: number; body: string }>): {
  deps: HttpDeps;
  seen: Seen[];
  sleep: ReturnType<typeof vi.fn>;
} {
  const seen: Seen[] = [];
  const sleep = vi.fn(async () => {});
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    seen.push({ url, headers });
    const r = responses[url];
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body, { status: r.status ?? 200 });
  };
  return { deps: { fetch: fakeFetch as typeof fetch, sleep }, seen, sleep };
}

describe('fetchFolder', () => {
  it('폴더 전체를 한 번에 읽는다', async () => {
    const { deps, seen, sleep } = makeDeps({
      [`${FOLDER_BASE}?start=0&limit=500`]: { body: fixture('bookmarks-sokcho.json') },
    });
    const folder = await fetchFolder(SHARE_ID, deps);
    expect(folder.shareId).toBe(SHARE_ID);
    expect(folder.name).toBe('속초, 고성, 양양 맛집');
    expect(folder.bookmarks).toHaveLength(31);
    const first = folder.bookmarks[0];
    expect(typeof first?.sid).toBe('string');
    expect(first).toMatchObject({
      name: '청초수물회 속초본점',
      sid: '12028621',
      mcidName: '음식점',
      available: true,
    });
    expect(seen).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('mcidName이 없거나 비어 있으면 null', async () => {
    const body = JSON.stringify({
      folder: { name: 'f' },
      bookmarkList: [
        {
          sid: 1,
          name: 'a',
          address: 'x',
          px: 128,
          py: 38,
          memo: '',
          mcidName: '',
          creationTime: 1,
          lastUpdateTime: 2,
          available: true,
        },
        {
          sid: '2',
          name: 'b',
          address: 'y',
          px: 128,
          py: 38,
          creationTime: 1,
          lastUpdateTime: 2,
          available: false,
        },
      ],
    });
    const { deps } = makeDeps({ [`${FOLDER_BASE}?start=0&limit=500`]: { body } });
    const { bookmarks } = await fetchFolder(SHARE_ID, deps);
    expect(bookmarks.map((b) => b.mcidName)).toEqual([null, null]);
    expect(bookmarks[0]?.sid).toBe('1');
    expect(bookmarks[1]?.memo).toBe('');
  });

  it('페이지가 가득 차면 다음 페이지를 300ms 대기 후 요청한다', async () => {
    const { deps, seen, sleep } = makeDeps({
      [`${FOLDER_BASE}?start=0&limit=20`]: { body: fixture('bookmarks-page1.json') },
      [`${FOLDER_BASE}?start=20&limit=20`]: { body: fixture('bookmarks-page2.json') },
    });
    const folder = await fetchFolder(SHARE_ID, deps, 20);
    expect(seen.map((s) => s.url)).toEqual([
      `${FOLDER_BASE}?start=0&limit=20`,
      `${FOLDER_BASE}?start=20&limit=20`,
    ]);
    expect(folder.bookmarks).toHaveLength(31);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(300);
  });

  it('Origin 없이 규칙대로 Referer와 UA를 보낸다', async () => {
    const { deps, seen } = makeDeps({
      [`${FOLDER_BASE}?start=0&limit=500`]: { body: fixture('bookmarks-sokcho.json') },
    });
    await fetchFolder(SHARE_ID, deps);
    for (const s of seen) {
      expect(s.headers).not.toHaveProperty('origin');
      expect(s.headers.referer).toBe(
        `https://pages.map.naver.com/save-pages/detail-list/${SHARE_ID}`,
      );
      expect(s.headers['user-agent']).toContain('Chrome/120.0');
    }
  });

  it('장소 이름을 한국어로 받도록 Accept-Language를 ko-KR로 보낸다', async () => {
    // Node fetch는 기본으로 `Accept-Language: *`를 보내고, 그러면 네이버가 영어 이름을 준다.
    const { deps, seen } = makeDeps({
      [`${FOLDER_BASE}?start=0&limit=500`]: { body: fixture('bookmarks-sokcho.json') },
    });
    await fetchFolder(SHARE_ID, deps);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s.headers['accept-language']).toBe('ko-KR,ko;q=0.9');
  });

  it('HTTP 오류면 상태 코드를 담아 throw', async () => {
    const { deps } = makeDeps({
      [`${FOLDER_BASE}?start=0&limit=500`]: { status: 403, body: 'forbidden' },
    });
    await expect(fetchFolder(SHARE_ID, deps)).rejects.toThrow(/403/);
  });

  it('bookmarkList가 없으면 throw', async () => {
    const { deps } = makeDeps({
      [`${FOLDER_BASE}?start=0&limit=500`]: { body: '{"folder":{"name":"f"}}' },
    });
    await expect(fetchFolder(SHARE_ID, deps)).rejects.toThrow(/bookmarkList/);
  });

  describe('maxCount', () => {
    const pages = {
      [`${FOLDER_BASE}?start=0&limit=20`]: { body: fixture('bookmarks-page1.json') },
      [`${FOLDER_BASE}?start=20&limit=20`]: { body: fixture('bookmarks-page2.json') },
    };

    it('장소 수가 maxCount와 같으면 그대로 돌려준다', async () => {
      const { deps } = makeDeps(pages);
      const folder = await fetchFolder(SHARE_ID, deps, 20, 31);
      expect(folder.bookmarks).toHaveLength(31);
    });

    it('maxCount를 넘으면 TooManyPlacesError, 다음 페이지는 요청하지 않는다', async () => {
      const { deps, seen } = makeDeps(pages);
      const error = await fetchFolder(SHARE_ID, deps, 20, 10).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TooManyPlacesError);
      expect(error).toMatchObject({ shareId: SHARE_ID, maxCount: 10 });
      expect(seen).toHaveLength(1);
    });

    it('기본은 제한 없음', async () => {
      const { deps } = makeDeps(pages);
      expect((await fetchFolder(SHARE_ID, deps, 20)).bookmarks).toHaveLength(31);
    });
  });
});

describe('fetchCarRoute', () => {
  it('첫 옵션의 첫 경로를 변환한다 (녹화값)', async () => {
    const { deps, seen } = makeDeps({ [ROUTE_URL]: { body: fixture('route-ok.json') } });
    const r = await fetchCarRoute([128.8961, 37.7519], [128.9184, 37.7952], deps);
    expect(r.distanceM).toBe(6862);
    expect(r.durationMs).toBe(1192196);
    expect(r.staticDurationMs).toBe(1108039);
    expect(r.tollFare).toBe(0);
    expect(r.path).toHaveLength(280);
    expect(r.path[0]).toHaveLength(2);
    expect(seen[0]?.headers.referer).toBe('https://map.naver.com/');
    expect(seen[0]?.headers).not.toHaveProperty('origin');
    expect(seen[0]?.headers['accept-language']).toBe('ko-KR,ko;q=0.9');
  });

  it('route가 없으면 throw (코드 포함)', async () => {
    const { deps } = makeDeps({ [ROUTE_URL]: { body: fixture('route-error.json') } });
    await expect(fetchCarRoute([128.8961, 37.7519], [128.9184, 37.7952], deps)).rejects.toThrow(
      /code=1.*no route/,
    );
  });

  it('HTTP 오류면 throw', async () => {
    const { deps } = makeDeps({ [ROUTE_URL]: { status: 500, body: '' } });
    await expect(fetchCarRoute([128.8961, 37.7519], [128.9184, 37.7952], deps)).rejects.toThrow(
      /500/,
    );
  });
});

describe('fetchPlaceSummary', () => {
  const URL_20307427 = 'https://map.naver.com/p/api/place/summary/20307427';

  it('장소 ID로 이름·도로명 주소·좌표·분류를 가져온다 (녹화값)', async () => {
    const { deps, seen } = makeDeps({
      [URL_20307427]: { body: fixture('place-summary-20307427.json') },
    });
    const p = await fetchPlaceSummary('20307427', deps);
    expect(p).toEqual({
      sid: '20307427',
      name: '착한전복 제주중문점',
      address: '제주 서귀포시 천제연로 119',
      lng: 126.4181775,
      lat: 33.2545773,
      category: '전복요리',
    });
    expect(seen[0]?.headers.referer).toBe('https://map.naver.com/');
    expect(seen[0]?.headers).not.toHaveProperty('origin');
    expect(seen[0]?.headers['accept-language']).toBe('ko-KR,ko;q=0.9');
  });

  it('도로명 주소가 없으면 지번 주소를, 분류가 없으면 null을 쓴다', async () => {
    const body = JSON.stringify({
      data: {
        placeDetail: {
          id: '1',
          name: '어딘가',
          coordinate: { longitude: 126.5, latitude: 33.4 },
          address: { address: '제주 제주시 어딘가 1', roadAddress: '' },
        },
      },
    });
    const { deps } = makeDeps({ ['https://map.naver.com/p/api/place/summary/1']: { body } });
    const p = await fetchPlaceSummary('1', deps);
    expect(p.address).toBe('제주 제주시 어딘가 1');
    expect(p.category).toBeNull();
  });

  it('placeDetail이 없으면 장소 ID를 담아 throw', async () => {
    const { deps } = makeDeps({ [URL_20307427]: { body: '{"data":{}}' } });
    await expect(fetchPlaceSummary('20307427', deps)).rejects.toThrow(/20307427/);
  });

  it('좌표가 없거나 숫자가 아니면 장소 ID를 담아 throw', async () => {
    for (const coordinate of [undefined, {}, { longitude: 'x', latitude: 'y' }]) {
      const body = JSON.stringify({ data: { placeDetail: { id: '1', name: 'a', coordinate } } });
      const { deps } = makeDeps({ ['https://map.naver.com/p/api/place/summary/1']: { body } });
      await expect(fetchPlaceSummary('1', deps)).rejects.toThrow(/좌표.*sid=1/);
    }
  });
});
