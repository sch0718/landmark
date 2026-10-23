import { Context, Deferred, Effect, Layer } from 'effect';
import { parseSearchInputKey, searchInputKey, type SearchResult } from 'src/server/search';
import { readApiErrorCode } from 'src/services/api-response';
import {
  PLACE_SEARCH_ERROR_CODES,
  PlaceSearchError,
  type PlaceSearchErrorCode,
} from 'src/services/errors';

export type { SearchResult };
export const PLACE_SEARCH_TIMEOUT_MS = 8_000;
export const PLACE_SEARCH_CACHE_MAX = 50;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
function resultsOf(body: unknown): SearchResult[] | null {
  if (!isRecord(body) || !Array.isArray(body.results) || body.results.length > 10) return null;
  const results: SearchResult[] = [];
  for (const p of body.results) {
    if (
      !isRecord(p) ||
      typeof p.name !== 'string' ||
      typeof p.address !== 'string' ||
      typeof p.category !== 'string' ||
      typeof p.lng !== 'number' ||
      !(p.lng >= 124 && p.lng <= 132) ||
      typeof p.lat !== 'number' ||
      !(p.lat >= 33 && p.lat <= 39)
    )
      return null;
    results.push({
      name: p.name,
      address: p.address,
      category: p.category,
      lng: p.lng,
      lat: p.lat,
    });
  }
  return results;
}

export class PlaceSearch extends Context.Service<
  PlaceSearch,
  {
    search(q: string, near?: [number, number]): Effect.Effect<SearchResult[], PlaceSearchError>;
  }
>()('tripmap/PlaceSearch') {
  static layerWith(options: { fetch: typeof fetch; base?: string }) {
    return Layer.sync(PlaceSearch, () => {
      const cache = new Map<string, SearchResult[]>();
      const inflight = new Map<string, Deferred.Deferred<SearchResult[], PlaceSearchError>>();
      const fail = (code: PlaceSearchErrorCode) => new PlaceSearchError({ code });
      const request = Effect.fnUntraced(function* (key: string) {
        const response = yield* Effect.tryPromise({
          try: async (signal) => {
            const response = await options.fetch(`${options.base ?? ''}/api/search?${key}`, {
              signal,
            });
            return { status: response.status, ok: response.ok, text: await response.text() };
          },
          catch: () => fail('OFFLINE'),
        }).pipe(
          Effect.timeoutOrElse({
            duration: PLACE_SEARCH_TIMEOUT_MS,
            orElse: () => Effect.fail(fail('TIMEOUT')),
          }),
        );
        let body: unknown;
        try {
          body = JSON.parse(response.text);
        } catch {
          return yield* fail(response.status >= 500 ? 'UPSTREAM_ERROR' : 'OFFLINE');
        }
        const code = readApiErrorCode(body);
        if (code !== null)
          return yield* fail(
            (PLACE_SEARCH_ERROR_CODES as readonly string[]).includes(code)
              ? (code as PlaceSearchErrorCode)
              : 'UPSTREAM_ERROR',
          );
        if (response.status === 404) return yield* fail('OFFLINE');
        if (!response.ok) return yield* fail('UPSTREAM_ERROR');
        const results = resultsOf(body);
        if (results === null) return yield* fail('UPSTREAM_ERROR');
        cache.delete(key);
        cache.set(key, results);
        if (cache.size > PLACE_SEARCH_CACHE_MAX) cache.delete(cache.keys().next().value!);
        return results;
      });
      const search = (
        q: string,
        near?: [number, number],
      ): Effect.Effect<SearchResult[], PlaceSearchError> =>
        Effect.suspend(() => {
          let key: string;
          try {
            // 서버와 같은 정규화·검증·좌표 정밀도로 메모리 캐시를 나눈다.
            key = searchInputKey(
              parseSearchInputKey(searchInputKey({ q, ...(near === undefined ? {} : { near }) })),
            );
          } catch {
            return Effect.fail(fail('BAD_REQUEST'));
          }
          const cached = cache.get(key);
          if (cached !== undefined) {
            cache.delete(key);
            cache.set(key, cached);
            return Effect.succeed(cached);
          }
          const running = inflight.get(key);
          if (running !== undefined) return Deferred.await(running);
          const pending = Deferred.makeUnsafe<SearchResult[], PlaceSearchError>();
          inflight.set(key, pending);
          return Effect.forkDetach(
            request(key).pipe(
              Effect.onExit((exit) =>
                Effect.suspend(() => {
                  inflight.delete(key);
                  return Deferred.done(pending, exit);
                }),
              ),
            ),
          ).pipe(Effect.andThen(Deferred.await(pending)));
        });
      return PlaceSearch.of({ search });
    });
  }
  static readonly layer = Layer.suspend(() =>
    PlaceSearch.layerWith({ fetch: (...args) => globalThis.fetch(...args) }),
  );
}
