// 바깥 요청 하나를 안전하게 보내는 요청기. 지도 링크 해석(resolve.ts)과 경로 조회(route.ts)가 함께 쓴다.
// Cloudflare 서버 함수에서도 쓰므로 상대 경로 import만 쓰고 브라우저·React 코드를 끌어오지 않는다.
import { ApiError } from './http';
import { isAllowedUrl } from './links';

export type Deps = { fetch: typeof fetch; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 8_000;

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export const unsupported = () =>
  new ApiError('UNSUPPORTED_LINK', '네이버·카카오·구글 지도 장소 링크가 아님');
export const notFound = () => new ApiError('NOT_FOUND', '장소를 찾지 못함');

export type RequestOptions = {
  /** 이동 응답(3xx)을 돌려받는다. 짧은 링크를 풀 때만 켠다. 꺼져 있으면 3xx는 UPSTREAM_ERROR. */
  acceptRedirect?: boolean;
  /** NOT_FOUND로 볼 HTTP 상태. 기본은 404만. */
  notFoundStatuses?: readonly number[];
};

export type Requester = (
  url: string,
  init: RequestInit,
  options?: RequestOptions,
) => Promise<Response>;

/**
 * 바깥 요청 하나: 허용 목록 검사 → `redirect: 'manual'`로 요청 → 상태 검사 → 본문까지 읽기.
 * 시한(기본 8초)은 본문을 다 읽을 때까지 잰다. 넘으면 요청을 끊고 TIMEOUT.
 */
export function makeRequester(deps: Deps): Requester {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (url, init, options = {}) => {
    const target = new URL(url);
    // 바깥 요청은 https만 보낸다. 사용자가 붙여 넣은 http 주소는 호출하는 쪽이 https로 올려서 넘긴다.
    if (!isAllowedUrl(target) || target.protocol !== 'https:') throw unsupported();

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ApiError('TIMEOUT', '바깥 서비스가 제때 응답하지 않음'));
      }, timeoutMs);
    });

    const send = async (): Promise<Response> => {
      let res: Response;
      try {
        res = await deps.fetch(target.href, {
          ...init,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch {
        throw new ApiError('UPSTREAM_ERROR', '바깥 서비스에 연결하지 못함');
      }
      const { status } = res;
      if ((options.notFoundStatuses ?? [404]).includes(status)) throw notFound();
      if (status >= 300 && status < 400 && !options.acceptRedirect) {
        throw new ApiError(
          'UPSTREAM_ERROR',
          `바깥 서비스가 예상하지 못한 이동을 줌 (HTTP ${status})`,
        );
      }
      if (status >= 400) {
        throw new ApiError('UPSTREAM_ERROR', `바깥 서비스 오류 (HTTP ${status})`);
      }
      let body: ArrayBuffer;
      try {
        body = await res.arrayBuffer();
      } catch {
        throw new ApiError('UPSTREAM_ERROR', '바깥 서비스 응답을 끝까지 받지 못함');
      }
      return new Response(body.byteLength === 0 ? null : body, { status, headers: res.headers });
    };

    try {
      return await Promise.race([send(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
