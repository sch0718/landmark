import { afterEach, describe, expect, vi } from 'vitest';
import { it } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { PlaceSearch, PLACE_SEARCH_TIMEOUT_MS } from 'src/services/place-search';
import { PlaceSearchError } from 'src/services/errors';

const results = [{ name: '강남역', address: '서울', category: '역', lng: 127, lat: 37 }];
const run = <A, E>(
  fetch: typeof globalThis.fetch,
  use: (s: PlaceSearch['Service']) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* PlaceSearch);
  }).pipe(Effect.provide(PlaceSearch.layerWith({ fetch, base: 'https://example.test' })));
afterEach(() => vi.restoreAllMocks());

describe('PlaceSearch', () => {
  it.effect('검색어와 주변 좌표를 정규화하고 같은 요청은 캐시한다', () =>
    Effect.gen(function* () {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ results }));
      const got = yield* run(fetcher, (s) =>
        Effect.gen(function* () {
          const first = yield* s.search(' 강남역 ', [127, 37]);
          yield* s.search('강남역', [127.000001, 37]);
          return first;
        }),
      );
      expect(got).toEqual(results);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const url = new URL(String(fetcher.mock.calls[0]![0]));
      expect(url.origin).toBe('https://example.test');
      expect(url.searchParams.get('q')).toBe('강남역');
      expect(url.searchParams.get('near')).toBe('127.00000,37.00000');
    }),
  );
  it.effect('진행 중인 같은 질의는 합치고 다른 near는 나눈다', () =>
    Effect.gen(function* () {
      let finish!: () => void;
      const wait = new Promise<void>((r) => {
        finish = r;
      });
      const fetcher = vi.fn(async () => {
        await wait;
        return Response.json({ results });
      });
      yield* run(fetcher, (s) =>
        Effect.gen(function* () {
          const first = yield* s.search('역').pipe(Effect.forkChild);
          const second = yield* s.search('역').pipe(Effect.forkChild);
          const third = yield* s.search('역', [128, 37]).pipe(Effect.forkChild);
          yield* Effect.promise(() => vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)));
          expect(fetcher).toHaveBeenCalledTimes(2);
          finish();
          expect(yield* Fiber.join(first)).toEqual(results);
          expect(yield* Fiber.join(second)).toEqual(results);
          yield* Fiber.join(third);
          expect(fetcher).toHaveBeenCalledTimes(2);
        }),
      );
    }),
  );
  it.effect('LRU는 최근 사용을 지키고 50개를 넘으면 오래된 질의를 버린다', () =>
    Effect.gen(function* () {
      const fetcher = vi.fn(async () => Response.json({ results }));
      yield* run(fetcher, (s) =>
        Effect.gen(function* () {
          for (let i = 0; i < 50; i++) yield* s.search(`역${i}`);
          yield* s.search('역0');
          yield* s.search('역50');
          yield* s.search('역0');
          expect(fetcher).toHaveBeenCalledTimes(51);
          yield* s.search('역1');
          expect(fetcher).toHaveBeenCalledTimes(52);
        }),
      );
    }),
  );
  for (const code of ['BAD_REQUEST', 'UPSTREAM_ERROR', 'TIMEOUT', 'FORBIDDEN_ORIGIN'] as const) {
    it.effect(`서버 오류 ${code} 보존`, () =>
      Effect.gen(function* () {
        const error = yield* run(
          async () => Response.json({ error: { code } }, { status: 400 }),
          (s) => Effect.flip(s.search('역')),
        );
        expect(error).toBeInstanceOf(PlaceSearchError);
        expect(error.code).toBe(code);
      }),
    );
  }
  it.effect('네트워크 실패·HTML·본문 없는 404는 OFFLINE, 서버 HTML 502는 UPSTREAM_ERROR', () =>
    Effect.gen(function* () {
      for (const fetcher of [
        async () => {
          throw new Error('연결 끊김');
        },
        async () => new Response('<html>'),
        async () => Response.json({}, { status: 404 }),
      ]) {
        const error = yield* run(fetcher, (s) => Effect.flip(s.search('역')));
        expect(error.code).toBe('OFFLINE');
      }
      const error = yield* run(
        async () => new Response('<html>', { status: 502 }),
        (s) => Effect.flip(s.search('역')),
      );
      expect(error.code).toBe('UPSTREAM_ERROR');
    }),
  );
  it.effect('질의 오류는 요청하지 않고 BAD_REQUEST', () =>
    Effect.gen(function* () {
      const fetcher = vi.fn(async () => Response.json({ results }));
      for (const q of ['', ' ', '가'.repeat(41)]) {
        const error = yield* run(fetcher, (s) => Effect.flip(s.search(q)));
        expect(error.code).toBe('BAD_REQUEST');
      }
      const error = yield* run(fetcher, (s) => Effect.flip(s.search('역', [0, 0])));
      expect(error.code).toBe('BAD_REQUEST');
      expect(fetcher).not.toHaveBeenCalled();
    }),
  );
  it.effect('깨진 결과와 모르는 오류 코드는 UPSTREAM_ERROR', () =>
    Effect.gen(function* () {
      for (const body of [
        { results: [{ ...results[0], lng: 0 }] },
        { results: '오류' },
        { error: { code: 'UNKNOWN' } },
      ]) {
        const error = yield* run(
          async () => Response.json(body),
          (s) => Effect.flip(s.search('역')),
        );
        expect(error.code).toBe('UPSTREAM_ERROR');
      }
    }),
  );
  it.effect('실패한 질의는 다시 시도할 수 있다', () =>
    Effect.gen(function* () {
      const fetcher = vi
        .fn()
        .mockRejectedValueOnce(new Error('끊김'))
        .mockImplementation(async () => Response.json({ results }));
      yield* run(fetcher, (s) =>
        Effect.gen(function* () {
          yield* Effect.flip(s.search('역'));
          expect(yield* s.search('역')).toEqual(results);
        }),
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    }),
  );
  it.effect('8초 시한은 본문 읽기까지 포함하고 중단 뒤 재시도된다', () =>
    Effect.gen(function* () {
      let signal: AbortSignal | null | undefined;
      const readBody = vi.fn(() => new Promise<string>(() => {}));
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        return { status: 200, ok: true, text: () => readBody() } as Response;
      });
      yield* run(fetcher, (s) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.flip(s.search('역')).pipe(Effect.forkChild);
          yield* Effect.promise(() => vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1)));
          yield* TestClock.adjust(`${PLACE_SEARCH_TIMEOUT_MS} millis`);
          const error = yield* Fiber.join(fiber);
          expect(error.code).toBe('TIMEOUT');
          expect(signal?.aborted).toBe(true);
        }),
      );
    }),
  );
  it('실패 안내는 한국어다', () => {
    expect(new PlaceSearchError({ code: 'OFFLINE' }).userMessage).toContain('오프라인');
    expect(new PlaceSearchError({ code: 'UPSTREAM_ERROR' }).userMessage).toContain(
      '지도 핀이나 보관함',
    );
  });
});
