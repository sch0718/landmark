import { afterEach, describe, expect, vi } from 'vitest';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { PlaceLookupError } from 'src/services/errors';
import { PlaceLookup } from 'src/services/place-lookup';
import type { FolderRef, FolderResult, ResolvedPlace } from 'src/server/resolve';

const PLACE: ResolvedPlace = {
  kind: 'place',
  provider: 'naver',
  providerId: '1540168051',
  name: '콤포트',
  address: '서울 용산구 후암로 1',
  lng: 126.98,
  lat: 37.55,
  category: '카페',
};
const FOLDER: FolderRef = { kind: 'folder', shareId: 'abc123' };
const FOLDER_RESULT: FolderResult = {
  folderName: '속초 맛집',
  places: [{ sid: '1', name: '식당', address: '속초', lng: 128.5, lat: 38.2, memo: '' }],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
const errorBody = (code: string, extra: object = {}) => ({
  error: { code, message: 'm', ...extra },
});

const lookupLink = (fetchFn: unknown, url: string, base?: string) =>
  Effect.gen(function* () {
    const lookup = yield* PlaceLookup;
    return yield* lookup.lookupLink(url);
  }).pipe(Effect.provide(PlaceLookup.layerWith({ fetch: fetchFn as typeof fetch, base })));

const lookupFolder = (fetchFn: unknown, shareId: string) =>
  Effect.gen(function* () {
    const lookup = yield* PlaceLookup;
    return yield* lookup.lookupFolder(shareId);
  }).pipe(Effect.provide(PlaceLookup.layerWith({ fetch: fetchFn as typeof fetch })));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlaceLookup.lookupLink', () => {
  it.effect('GET /api/place 에 링크를 인코딩해 보내고 장소를 돌려준다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => json(PLACE));
      const url = 'https://naver.me/abc?x=1&y=한글 #z';
      const result = yield* lookupLink(fetchFn, url);
      expect(result).toEqual(PLACE);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledWith(`/api/place?url=${encodeURIComponent(url)}`);
    }),
  );

  it.effect('base가 있으면 앞에 붙인다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => json(PLACE));
      yield* lookupLink(fetchFn, 'https://naver.me/a', 'http://localhost:8788');
      expect(fetchFn).toHaveBeenCalledWith(
        `http://localhost:8788/api/place?url=${encodeURIComponent('https://naver.me/a')}`,
      );
    }),
  );

  it.effect('폴더 링크는 FolderRef를 돌려준다', () =>
    Effect.gen(function* () {
      const result = yield* lookupLink(
        vi.fn(async () => json(FOLDER)),
        'https://naver.me/folder',
      );
      expect(result).toEqual(FOLDER);
    }),
  );

  const codes = [
    ['UNSUPPORTED_LINK', 400],
    ['NOT_FOUND', 404],
    ['FORBIDDEN_ORIGIN', 403],
    ['TOO_MANY_PLACES', 413],
    ['UPSTREAM_ERROR', 502],
    ['TIMEOUT', 504],
  ] as const;
  for (const [code, status] of codes) {
    it.effect(`${status} ${code} 본문의 코드를 그대로 담는다`, () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          lookupLink(
            vi.fn(async () => json(errorBody(code), status)),
            'https://x.test',
          ),
        );
        expect(error).toBeInstanceOf(PlaceLookupError);
        expect(error.code).toBe(code);
        expect(error.reason).toBeUndefined();
        expect(error.placeName).toBeUndefined();
      }),
    );
  }

  it.effect('NOT_FOUND + no-location 은 reason과 placeName을 담는다', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        lookupLink(
          vi.fn(async () =>
            json(
              errorBody('NOT_FOUND', { reason: 'no-location', placeName: '이재모피자 본점' }),
              404,
            ),
          ),
          'https://maps.app.goo.gl/x',
        ),
      );
      expect(error.code).toBe('NOT_FOUND');
      expect(error.reason).toBe('no-location');
      expect(error.placeName).toBe('이재모피자 본점');
      expect(error.userMessage).toBe('위치를 알 수 없는 링크예요. 지도에서 위치를 맞춰 주세요');
    }),
  );

  it.effect('알 수 없는 reason은 버린다', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        lookupLink(
          vi.fn(async () => json(errorBody('NOT_FOUND', { reason: 'weird', placeName: 5 }), 404)),
          'https://x.test',
        ),
      );
      expect(error.reason).toBeUndefined();
      expect(error.placeName).toBeUndefined();
    }),
  );

  it.effect('HTML 응답(서버 함수 없이 yarn dev)은 OFFLINE이고 경고를 한 번 남긴다', () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = yield* Effect.flip(
        lookupLink(
          vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200 })),
          'https://x.test',
        ),
      );
      expect(error.code).toBe('OFFLINE');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toBe(
        '장소 조회 서버에 연결하지 못했어요(로컬이면 yarn dev:full)',
      );
    }),
  );

  it.effect('error 본문 없는 404는 OFFLINE이고 경고를 한 번 남긴다', () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = yield* Effect.flip(
        lookupLink(
          vi.fn(async () => new Response('Not Found', { status: 404 })),
          'https://x.test',
        ),
      );
      expect(error.code).toBe('OFFLINE');
      expect(warn).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect('JSON이지만 error가 없는 404도 OFFLINE', () =>
    Effect.gen(function* () {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = yield* Effect.flip(
        lookupLink(
          vi.fn(async () => json({ message: 'nope' }, 404)),
          'https://x.test',
        ),
      );
      expect(error.code).toBe('OFFLINE');
    }),
  );

  it.effect('네트워크 거부는 OFFLINE이고 경고에 원인을 싣는다', () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cause = new TypeError('Failed to fetch');
      const error = yield* Effect.flip(
        lookupLink(
          vi.fn(async () => Promise.reject(cause)),
          'https://x.test',
        ),
      );
      expect(error.code).toBe('OFFLINE');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toContain(cause);
    }),
  );

  it.effect('error.code가 알려진 코드가 아니면 OFFLINE이 아니라 UPSTREAM_ERROR로 본다', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        lookupLink(
          vi.fn(async () => json(errorBody('WHAT'), 500)),
          'https://x.test',
        ),
      );
      expect(error.code).toBe('UPSTREAM_ERROR');
    }),
  );

  it.effect('성공 응답이 올바른 모양이 아니면 UPSTREAM_ERROR', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        lookupLink(
          vi.fn(async () => json({ hello: 'world' })),
          'https://x.test',
        ),
      );
      expect(error.code).toBe('UPSTREAM_ERROR');
    }),
  );
});

describe('PlaceLookup.lookupFolder', () => {
  it.effect('GET /api/naver-folder?share= 로 조회한다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => json(FOLDER_RESULT));
      const result = yield* lookupFolder(fetchFn, 'a b/c');
      expect(result).toEqual(FOLDER_RESULT);
      expect(fetchFn).toHaveBeenCalledWith(
        `/api/naver-folder?share=${encodeURIComponent('a b/c')}`,
      );
    }),
  );

  it.effect('TOO_MANY_PLACES 코드를 담는다', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        lookupFolder(
          vi.fn(async () => json(errorBody('TOO_MANY_PLACES'), 413)),
          'abc',
        ),
      );
      expect(error.code).toBe('TOO_MANY_PLACES');
      expect(error.userMessage).toBe('장소가 너무 많은 폴더예요(최대 1,000곳)');
    }),
  );

  it.effect('HTML 응답은 OFFLINE', () =>
    Effect.gen(function* () {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = yield* Effect.flip(
        lookupFolder(
          vi.fn(async () => new Response('<html></html>')),
          'abc',
        ),
      );
      expect(error.code).toBe('OFFLINE');
    }),
  );
});

describe('PlaceLookupError.userMessage', () => {
  const cases: ReadonlyArray<readonly [PlaceLookupError['code'], string]> = [
    ['UNSUPPORTED_LINK', '네이버·카카오·구글 지도의 장소 링크만 넣을 수 있어요'],
    ['NOT_FOUND', '장소를 찾지 못했어요. 링크를 다시 확인해 주세요'],
    ['UPSTREAM_ERROR', '지금은 장소 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요'],
    ['TIMEOUT', '지금은 장소 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요'],
    ['FORBIDDEN_ORIGIN', '지금은 장소 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요'],
    ['OFFLINE', '인터넷 연결을 확인하고 다시 시도해 주세요'],
    ['TOO_MANY_PLACES', '장소가 너무 많은 폴더예요(최대 1,000곳)'],
  ];
  for (const [code, message] of cases) {
    it(`${code}`, () => {
      expect(new PlaceLookupError({ code }).userMessage).toBe(message);
    });
  }

  it('Error.name과 겹치지 않는다', () => {
    const error = new PlaceLookupError({ code: 'NOT_FOUND', placeName: '이름' });
    expect(error.name).not.toBe('이름');
    expect(error.placeName).toBe('이름');
  });
});
