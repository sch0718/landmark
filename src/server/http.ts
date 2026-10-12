// 서버 함수의 오류 코드·응답 모양·요청 출처 검사.
// Cloudflare 서버 함수에서도 쓰므로 import 없이 웹 표준 API(Response·URL)만 쓴다.

export type ApiErrorCode =
  | 'UNSUPPORTED_LINK'
  | 'NOT_FOUND'
  | 'FORBIDDEN_ORIGIN'
  | 'TOO_MANY_PLACES'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'BAD_REQUEST'
  | 'NO_ROUTE';

/** 구글 링크에 위치가 없을 때만 붙는다. 앱이 이름을 채워 핀 모드로 간다. */
export type ApiErrorDetail = { reason: 'no-location'; placeName: string };

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly detail?: ApiErrorDetail,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const STATUS: Record<ApiErrorCode, number> = {
  UNSUPPORTED_LINK: 400,
  NOT_FOUND: 404,
  FORBIDDEN_ORIGIN: 403,
  TOO_MANY_PLACES: 413,
  UPSTREAM_ERROR: 502,
  TIMEOUT: 504,
  BAD_REQUEST: 400,
  NO_ROUTE: 404,
};

const EXACT_ORIGINS: readonly string[] = [
  'https://landmark-c5f.pages.dev',
  'http://localhost:5173',
  'http://localhost:8788',
];
// 미리보기 배포(`<이름>.landmark-c5f.pages.dev`). 서브도메인은 한 단계만 받는다.
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.landmark-c5f\.pages\.dev$/;

/**
 * 요청 출처(`Origin` 헤더 값, 즉 `scheme://host[:port]`)가 허용 목록에 있는가.
 * 경로가 붙은 값(`Referer`)은 받지 않으니 호출하는 쪽이 `new URL(referer).origin`으로 바꿔 넘긴다.
 */
export function isAllowedOrigin(origin: string | null): boolean {
  if (origin === null) return false;
  return EXACT_ORIGINS.includes(origin) || PREVIEW_ORIGIN.test(origin);
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { ...init, headers });
}

// ApiError가 아닌 오류의 메시지에는 바깥 주소가 들어 있을 수 있어 응답에 싣지 않는다.
const UNKNOWN_ERROR_MESSAGE = '바깥 서비스 응답을 처리하지 못함';

export function errorResponse(e: unknown): Response {
  const error = e instanceof ApiError ? e : new ApiError('UPSTREAM_ERROR', UNKNOWN_ERROR_MESSAGE);
  return jsonResponse(
    { error: { code: error.code, message: error.message, ...error.detail } },
    { status: STATUS[error.code] },
  );
}
