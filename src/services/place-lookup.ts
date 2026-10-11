import { Context, Effect, Layer } from 'effect';
import type { ApiErrorCode } from 'src/server/http';
import type { FolderRef, FolderResult, ResolvedPlace } from 'src/server/resolve';
import { isApiErrorCode, PlaceLookupError } from 'src/services/errors';

const FORBIDDEN_ORIGIN_WARNING =
  '장소 조회 서버가 요청 출처를 거부했어요(허용 출처는 src/server/http.ts에서 설정)';
const OFFLINE_WARNING = '장소 조회 서버에 연결하지 못했어요(로컬이면 yarn dev:full)';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 서버가 준 오류 본문(`{ error: { code, … } }`)에서 코드·세부를 뽑는다. 알아볼 수 없으면 null. */
function readApiError(
  body: unknown,
): { code: string; reason?: unknown; placeName?: unknown } | null {
  if (!isObject(body) || !isObject(body.error) || typeof body.error.code !== 'string') return null;
  return body.error as { code: string; reason?: unknown; placeName?: unknown };
}

function toLookupError(error: NonNullable<ReturnType<typeof readApiError>>): PlaceLookupError {
  const code: ApiErrorCode = isApiErrorCode(error.code) ? error.code : 'UPSTREAM_ERROR';
  return new PlaceLookupError({
    code,
    ...(error.reason === 'no-location' ? { reason: 'no-location' as const } : {}),
    ...(typeof error.placeName === 'string' ? { placeName: error.placeName } : {}),
  });
}

/**
 * 붙여 넣은 지도 링크·네이버 공유 폴더를 서버 함수(`/api/place`·`/api/naver-folder`)로 조회한다.
 * 서버 함수 없이 `yarn dev`만 띄우면 `/api`가 HTML(SPA 기본 페이지)이나 `error` 없는 404를 주므로
 * 이를 `OFFLINE`으로 다루고 콘솔에 원인을 한 번 경고한다.
 */
export class PlaceLookup extends Context.Service<
  PlaceLookup,
  {
    lookupLink(url: string): Effect.Effect<ResolvedPlace | FolderRef, PlaceLookupError>;
    lookupFolder(shareId: string): Effect.Effect<FolderResult, PlaceLookupError>;
  }
>()('tripmap/PlaceLookup') {
  static layerWith(options: { fetch: typeof fetch; base?: string }) {
    const base = options.base ?? '';

    const offline = (cause: unknown) =>
      Effect.sync(() => {
        console.warn(OFFLINE_WARNING, cause);
      }).pipe(Effect.andThen(Effect.fail(new PlaceLookupError({ code: 'OFFLINE' }))));

    const request = Effect.fnUntraced(function* (path: string) {
      const response = yield* Effect.tryPromise({
        try: () => options.fetch(`${base}${path}`),
        catch: (e) => e,
      }).pipe(Effect.catch(offline));
      const text = yield* Effect.tryPromise({ try: () => response.text(), catch: (e) => e }).pipe(
        Effect.catch(offline),
      );
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        // 서버 함수가 있는 환경의 5xx(예: Cloudflare 오류 HTML 페이지)는 서버 문제이지 서버 함수 부재가 아니다.
        if (response.status >= 500) return yield* new PlaceLookupError({ code: 'UPSTREAM_ERROR' });
        return yield* offline(`JSON이 아닌 응답(HTTP ${response.status})`);
      }
      const apiError = readApiError(body);
      if (apiError !== null) {
        // 개발 설정 오류이므로 화면 문구와 별개로 콘솔에 원인을 남긴다(스펙 §5).
        if (apiError.code === 'FORBIDDEN_ORIGIN') {
          const serverMessage =
            isObject(body) && isObject(body.error) ? body.error.message : undefined;
          yield* Effect.sync(() => {
            console.warn(FORBIDDEN_ORIGIN_WARNING, apiError.code, serverMessage);
          });
        }
        return yield* toLookupError(apiError);
      }
      if (response.status === 404) return yield* offline('error 본문이 없는 404');
      if (!response.ok) {
        return yield* new PlaceLookupError({ code: 'UPSTREAM_ERROR' });
      }
      return body;
    });

    const lookupLink = Effect.fnUntraced(function* (url: string) {
      const body = yield* request(`/api/place?url=${encodeURIComponent(url)}`);
      if (isObject(body) && (body.kind === 'place' || body.kind === 'folder')) {
        return body as unknown as ResolvedPlace | FolderRef;
      }
      return yield* new PlaceLookupError({ code: 'UPSTREAM_ERROR' });
    });

    const lookupFolder = Effect.fnUntraced(function* (shareId: string) {
      const body = yield* request(`/api/naver-folder?share=${encodeURIComponent(shareId)}`);
      if (isObject(body) && typeof body.folderName === 'string' && Array.isArray(body.places)) {
        return body as unknown as FolderResult;
      }
      return yield* new PlaceLookupError({ code: 'UPSTREAM_ERROR' });
    });

    return Layer.succeed(PlaceLookup, PlaceLookup.of({ lookupLink, lookupFolder }));
  }

  static readonly layer = Layer.suspend(() =>
    PlaceLookup.layerWith({ fetch: (...args) => globalThis.fetch(...args) }),
  );
}
