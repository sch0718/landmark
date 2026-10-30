import { HttpError, CertsUnavailableError } from '@sch0718/firebase-session/worker';
import { isAllowedOrigin } from '../http';
import { requestOrigin } from '../handler';
export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
export function syncJson(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}
export function syncError(error: unknown): Response | null {
  if (error instanceof SyncHttpError || error instanceof HttpError)
    return syncJson(error.status, { error: error.code, ...error.extra });
  if (error instanceof CertsUnavailableError) return syncJson(503, { error: 'certs-unavailable' });
  return null;
}
export function isLocalRequest(request: Request): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
}
export function isSyncOrigin(request: Request): boolean {
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    !request.headers.has('Origin') &&
    !request.headers.has('Referer')
  ) {
    // 리퍼러를 생략한 같은 출처 요청과 직접 탐색만 허용한다.
    // Fetch Metadata도 없으면 출처를 확인할 수 없으므로 거절한다.
    // 세션 없이 부수 효과를 일으키는 GET은 앞으로도 추가하지 않는다.
    const site = request.headers.get('Sec-Fetch-Site');
    return site === 'same-origin' || site === 'none';
  }
  const origin = requestOrigin(request);
  const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/.test(origin ?? '');
  return localOrigin ? isLocalRequest(request) : isAllowedOrigin(origin);
}
