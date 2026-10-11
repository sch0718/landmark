// Pages Functions GET 진입점의 공통 순서: 출처 검사 → 입력 검사 → 캐시 조회 → 해석 → 캐시 저장 → 응답.
// Cloudflare 서버 함수에서 쓰므로 상대 경로 import와 웹 표준 API만 쓴다.
import { ApiError, errorResponse, isAllowedOrigin, jsonResponse } from './http';

/** Pages Functions가 넘기는 문맥 중 여기서 쓰는 부분. */
export type FunctionContext = { request: Request; waitUntil(p: Promise<unknown>): void };

export type GetHandlerOptions = {
  /** 입력을 담은 쿼리 이름(`url`·`share`). 없거나 비면 UNSUPPORTED_LINK. */
  param: string;
  missingMessage: string;
  /** 성공 결과를 Cache API에 둘 시간(초). */
  maxAgeSeconds: number;
  /** 입력으로 캐시 키를 만든다. null이면 캐시를 건너뛴다. */
  cacheKey(input: string): string | null;
  resolve(input: string): Promise<unknown>;
};

/** 요청 출처: `Origin` 헤더, 없으면 `Referer`의 출처. 둘 다 없거나 `Referer`를 읽을 수 없으면 null. */
export function requestOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (origin !== null) return origin;
  const referer = request.headers.get('Referer');
  if (referer === null) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * 전역 `fetch`를 감싼다. Cloudflare 런타임은 `fetch`를 다른 객체의 메서드로 부르면(`deps.fetch(…)`)
 * `Illegal invocation`으로 실패하므로 `Deps`에는 이것을 넘긴다. 부를 때마다 전역 값을 읽는다.
 */
export const globalFetch: typeof fetch = (input, init) => fetch(input, init);

// Cloudflare 런타임에만 있는 `caches.default`. 테스트·Node에는 `caches`가 없다.
function defaultCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

// 브라우저에는 공유 캐시 지시(`max-age`)를 주지 않는다. 엣지(Cache API)에 둘 사본에만 붙인다.
function toBrowserResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleGet(
  ctx: FunctionContext,
  options: GetHandlerOptions,
): Promise<Response> {
  const { request } = ctx;
  try {
    if (!isAllowedOrigin(requestOrigin(request))) {
      throw new ApiError('FORBIDDEN_ORIGIN', '허용하지 않는 요청 출처');
    }
    const input = new URL(request.url).searchParams.get(options.param) ?? '';
    if (input.trim() === '') throw new ApiError('UNSUPPORTED_LINK', options.missingMessage);

    const cache = defaultCache();
    const key = cache ? options.cacheKey(input) : null;
    if (cache && key !== null) {
      const hit = await cache.match(key).catch(() => undefined);
      if (hit) return toBrowserResponse(hit);
    }

    const result = await options.resolve(input);
    const stored = jsonResponse(result, {
      headers: { 'Cache-Control': `max-age=${options.maxAgeSeconds}` },
    });
    if (cache && key !== null) {
      // 저장 실패는 응답에 영향을 주지 않는다.
      ctx.waitUntil(cache.put(key, stored.clone()).catch(() => undefined));
    }
    return toBrowserResponse(stored);
  } catch (e) {
    // 오류 응답은 캐시하지 않는다.
    return errorResponse(e);
  }
}
