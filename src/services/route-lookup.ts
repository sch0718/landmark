import { Context, Deferred, Effect, Layer, Semaphore } from 'effect';
import { haversineM, SAME_POINT_M } from 'src/domain/trips/geo';
import type { ApiErrorCode } from 'src/server/http';
import { routeInputKey, type RouteMode, type RouteResult } from 'src/server/route';
import { browserStorage } from 'src/services/browser-storage';
import { RouteLookupError, type RouteLookupErrorCode } from 'src/services/errors';

/** 경로 캐시의 저장 키(스펙 §3.5). */
export const ROUTE_CACHE_KEY = 'tripmap:routes:v1';
/** 캐시에 둘 수 있는 구간 수. 넘으면 `usedAt`이 오래된 것부터 지운다. */
export const ROUTE_CACHE_MAX = 500;
/**
 * 캐시 문서(JSON)의 최대 글자 수. 넘으면 `usedAt`이 오래된 것부터 지운다. 경로선이 긴 구간이 많아도
 * 경로 캐시가 localStorage(대개 5MB)를 차지해 보관함을 밀어내지 않게 한다.
 */
export const ROUTE_CACHE_MAX_CHARS = 1_500_000;
/** 캐시 변경을 모아 저장하는 지연(ms). 구간이 연달아 들어와도 저장은 이 간격에 한 번이다. */
export const ROUTE_PERSIST_DELAY_MS = 300;
/** 클라이언트가 응답을 기다리는 최대 시간(ms). 서버 시한 8초보다 길다. */
export const ROUTE_TIMEOUT_MS = 12_000;
/** 동시에 서버에 보내는 경로 요청 수. 넘으면 대기열에서 차례를 기다린다. */
export const ROUTE_MAX_CONCURRENT = 4;

const OFFLINE_WARNING = '경로 서버에 연결하지 못했어요(로컬이면 yarn dev:full)';
const FORBIDDEN_ORIGIN_WARNING =
  '경로 서버가 요청 출처를 거부했어요(허용 출처는 src/server/http.ts에서 설정)';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type CachedRoute = RouteResult & { usedAt: string };
type LngLat = [number, number];

const isLngLat = (value: unknown): value is LngLat =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n));

/** 서버 응답이나 저장된 항목이 `RouteResult` 모양인지 확인해 그 부분만 뽑는다. 아니면 null. */
function toRouteResult(value: unknown): RouteResult | null {
  if (!isObject(value)) return null;
  const { mode, distanceM, durationS, tollFare, path, queriedAt } = value;
  if (mode !== 'car' && mode !== 'walk') return null;
  if (typeof distanceM !== 'number' || !Number.isFinite(distanceM)) return null;
  if (typeof durationS !== 'number' || !Number.isFinite(durationS)) return null;
  if (tollFare !== null && (typeof tollFare !== 'number' || !Number.isFinite(tollFare)))
    return null;
  if (!Array.isArray(path) || !path.every(isLngLat)) return null;
  if (typeof queriedAt !== 'string') return null;
  return { mode, distanceM, durationS, tollFare, path, queriedAt };
}

const stripUsedAt = (cached: CachedRoute): RouteResult => {
  const { usedAt, ...route } = cached;
  void usedAt;
  return route;
};

/** 서버가 준 오류 본문(`{ error: { code, … } }`)에서 코드를 뽑는다. 알아볼 수 없으면 null. */
function readApiErrorCode(body: unknown): string | null {
  if (!isObject(body) || !isObject(body.error) || typeof body.error.code !== 'string') return null;
  return body.error.code;
}

const ROUTE_ERROR_CODES: readonly string[] = [
  'NO_ROUTE',
  'UPSTREAM_ERROR',
  'TIMEOUT',
  'BAD_REQUEST',
  'FORBIDDEN_ORIGIN',
] satisfies readonly (RouteLookupErrorCode & ApiErrorCode)[];

/** 서버 코드 중 경로 조회가 구분하는 것만 남기고, 나머지는 서버 문제(`UPSTREAM_ERROR`)로 본다. */
const toRouteCode = (code: string): RouteLookupErrorCode =>
  ROUTE_ERROR_CODES.includes(code) ? (code as RouteLookupErrorCode) : 'UPSTREAM_ERROR';

/** 서버 응답에는 항상 소수 5자리로 보낸다(캐시 키와 같은 정밀도). */
const coordinate = ([lng, lat]: LngLat): string => `${lng.toFixed(5)},${lat.toFixed(5)}`;

/** 저장할 경로선 좌표는 소수 5자리(약 1m)로 줄인다. 그보다 정밀해도 지도에서 차이가 없고 용량만 커진다. */
const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;
const roundPath = (path: readonly LngLat[]): LngLat[] =>
  path.map(([lng, lat]) => [round5(lng), round5(lat)]);

/** 저장된 캐시 문서를 읽는다. 저장 값이 깨졌거나 없으면 빈 캐시. 모양이 틀린 항목만 버린다. */
function readCache(storage: Storage | null): Map<string, CachedRoute> {
  const entries = new Map<string, CachedRoute>();
  if (storage === null) return entries;
  let doc: unknown;
  try {
    const raw = storage.getItem(ROUTE_CACHE_KEY);
    if (raw === null) return entries;
    doc = JSON.parse(raw);
  } catch {
    return entries;
  }
  if (!isObject(doc) || !isObject(doc.entries)) return entries;
  const loaded: [string, CachedRoute][] = [];
  for (const [key, value] of Object.entries(doc.entries)) {
    const route = toRouteResult(value);
    if (route === null || !isObject(value) || typeof value.usedAt !== 'string') continue;
    loaded.push([key, { ...route, usedAt: value.usedAt }]);
  }
  // 오래된 것이 앞에 오도록 맞춰 둔다(Map 삽입 순서 = 오래된 순).
  loaded.sort((a, b) => (a[1].usedAt < b[1].usedAt ? -1 : a[1].usedAt > b[1].usedAt ? 1 : 0));
  for (const [key, value] of loaded) entries.set(key, value);
  return entries;
}

/** 페이지가 숨거나 닫힐 때 `flush`를 부른다(모아 둔 캐시 저장을 잃지 않게). */
export function listenPageLeave(flush: () => void): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/**
 * 구간(두 좌표) 사이 경로를 서버 함수(`/api/route`)로 조회하고, 결과를 localStorage에 캐시한다.
 * - 캐시 키는 Task 6의 `routeInputKey`. 읽을 때 `usedAt`을 새로 하고, 500개 또는 150만 자를 넘으면
 *   오래 안 쓴 것부터 지운다. 경로선 좌표는 소수 5자리로 줄여 저장하고, 저장은 300ms 간격으로 모아서 한다.
 * - 직선 10m 미만은 같은 지점으로 보고 서버에 묻지 않는다.
 * - 같은 키 요청이 진행 중이면 합치고, 동시에 나가는 요청은 최대 4개다.
 * - 서버 응답 처리는 `PlaceLookup`과 같다(HTML·`error` 없는 404·네트워크 실패는 `OFFLINE`).
 */
export class RouteLookup extends Context.Service<
  RouteLookup,
  {
    leg(
      mode: RouteMode,
      from: LngLat,
      to: LngLat,
      options?: { refresh?: boolean },
    ): Effect.Effect<RouteResult, RouteLookupError>;
  }
>()('tripmap/RouteLookup') {
  static layerWith(options: {
    fetch: typeof fetch;
    storage: Storage | null;
    base?: string;
    now?: () => Date;
    /** 모아 둔 캐시 변경을 저장할 때를 정한다. 기본은 `ROUTE_PERSIST_DELAY_MS` 뒤(`setTimeout`). */
    schedule?: (flush: () => void) => void;
    /** 페이지를 떠날 때(숨김·닫기) 부를 `flush`를 받는다. 기다리던 저장을 바로 한다. */
    onLeave?: (flush: () => void) => void;
    /** 테스트에서 글자 수 한도를 낮추는 용도. */
    maxChars?: number;
  }) {
    return Layer.sync(RouteLookup, () => {
      const base = options.base ?? '';
      const now = options.now ?? (() => new Date());
      const storage = options.storage;
      const schedule =
        options.schedule ?? ((flush: () => void) => void setTimeout(flush, ROUTE_PERSIST_DELAY_MS));
      const maxChars = options.maxChars ?? ROUTE_CACHE_MAX_CHARS;

      const entries = readCache(storage);
      // 쓰기가 끝내 안 되면 이 세션은 메모리에서만 캐시한다.
      let persistent = storage !== null;
      // 저장할 변경이 있는가, 저장이 예약돼 있는가.
      let dirty = false;
      let flushScheduled = false;
      let offlineWarned = false;
      let forbiddenWarned = false;
      const inflight = new Map<string, Deferred.Deferred<RouteResult, RouteLookupError>>();
      const slots = Semaphore.makeUnsafe(ROUTE_MAX_CONCURRENT);

      /** `usedAt`이 오래된 것부터 `count`개를 지운다(Map은 오래된 순). */
      const dropOldest = (count: number) => {
        for (const key of [...entries.keys()].slice(0, count)) entries.delete(key);
      };

      const serialize = () => JSON.stringify({ entries: Object.fromEntries(entries) });

      /** 글자 수 한도를 넘으면 넘친 비율만큼 오래된 것부터 지우며 다시 맞춘다. 한도 안의 문서를 돌려준다. */
      const fitted = (): string => {
        let json = serialize();
        while (json.length > maxChars && entries.size > 0) {
          const excess = Math.ceil(entries.size * (1 - maxChars / json.length));
          dropOldest(Math.max(1, excess));
          json = serialize();
        }
        return json;
      };

      const write = (): boolean => {
        try {
          storage?.setItem(ROUTE_CACHE_KEY, fitted());
          return true;
        } catch {
          return false;
        }
      };

      /** 저장소에 쓴다. 실패(용량 초과 등)하면 오래된 절반을 지우고 한 번 더, 또 실패하면 메모리에만 둔다. */
      const persist = () => {
        if (!persistent) return;
        if (write()) return;
        dropOldest(Math.floor(entries.size / 2));
        if (!write()) persistent = false;
      };

      /** 기다리던 변경이 있으면 지금 저장한다. 예약된 저장이 나중에 와도 할 일이 없다. */
      const flush = () => {
        if (!dirty) return;
        dirty = false;
        persist();
      };

      /**
       * 캐시 변경(읽기로 바뀐 `usedAt`, 새로 받은 구간)을 모아 `schedule`이 정한 때에 한 번 저장한다.
       * 구간을 받을 때마다 캐시 문서 전체를 다시 쓰지 않는다.
       */
      const persistSoon = () => {
        if (!persistent) return;
        dirty = true;
        if (flushScheduled) return;
        flushScheduled = true;
        schedule(() => {
          flushScheduled = false;
          flush();
        });
      };
      options.onLeave?.(flush);

      const remember = (key: string, route: RouteResult) => {
        entries.delete(key);
        entries.set(key, { ...route, path: roundPath(route.path), usedAt: now().toISOString() });
        if (entries.size > ROUTE_CACHE_MAX) dropOldest(entries.size - ROUTE_CACHE_MAX);
        persistSoon();
      };

      const offline = (cause: unknown) =>
        Effect.sync(() => {
          if (offlineWarned) return;
          offlineWarned = true;
          console.warn(OFFLINE_WARNING, cause);
        }).pipe(Effect.andThen(Effect.fail(new RouteLookupError({ code: 'OFFLINE' }))));

      const upstream = () => new RouteLookupError({ code: 'UPSTREAM_ERROR' });

      const request = Effect.fnUntraced(function* (
        mode: RouteMode,
        from: LngLat,
        to: LngLat,
        fresh: boolean,
      ) {
        // `다시 계산`(fresh)은 서버의 엣지 캐시도 건너뛰게 한다(스펙 §4.2). 보통 요청은 엣지 캐시를 함께 쓴다.
        const path = `/api/route?mode=${mode}&from=${coordinate(from)}&to=${coordinate(to)}${fresh ? '&fresh=1' : ''}`;
        // 서버 시한(8초)보다 조금 길게 기다리고, 그래도 안 오면 중단한다. 중단하면 대기 칸과 진행 중 표가 풀린다.
        const response = yield* Effect.gen(function* () {
          const res = yield* Effect.tryPromise({
            try: (signal) => options.fetch(`${base}${path}`, { signal }),
            catch: (e) => e,
          }).pipe(Effect.catch(offline));
          const body = yield* Effect.tryPromise({ try: () => res.text(), catch: (e) => e }).pipe(
            Effect.catch(offline),
          );
          return { status: res.status, ok: res.ok, text: body };
        }).pipe(
          Effect.timeoutOrElse({
            duration: ROUTE_TIMEOUT_MS,
            orElse: () => Effect.fail(new RouteLookupError({ code: 'TIMEOUT' })),
          }),
        );
        const text = response.text;
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          // 서버 함수가 있는 환경의 5xx(예: Cloudflare 오류 HTML 페이지)는 서버 문제이지 서버 함수 부재가 아니다.
          if (response.status >= 500) return yield* upstream();
          return yield* offline(`JSON이 아닌 응답(HTTP ${response.status})`);
        }
        const errorCode = readApiErrorCode(body);
        if (errorCode !== null) {
          const code = toRouteCode(errorCode);
          if (code === 'FORBIDDEN_ORIGIN' && !forbiddenWarned) {
            forbiddenWarned = true;
            console.warn(FORBIDDEN_ORIGIN_WARNING);
          }
          return yield* new RouteLookupError({ code });
        }
        if (response.status === 404) return yield* offline('error 본문이 없는 404');
        if (!response.ok) return yield* upstream();
        const route = toRouteResult(body);
        if (route === null) return yield* upstream();
        return route;
      });

      /** 한 구간을 서버에서 받아 캐시에 넣는다. 동시 요청 수는 `slots`가 제한한다. */
      const fetchLeg = (key: string, mode: RouteMode, from: LngLat, to: LngLat, fresh: boolean) =>
        slots
          .withPermits(1)(request(mode, from, to, fresh))
          .pipe(Effect.tap((route) => Effect.sync(() => remember(key, route))));

      const leg = (
        mode: RouteMode,
        from: LngLat,
        to: LngLat,
        legOptions?: { refresh?: boolean },
      ): Effect.Effect<RouteResult, RouteLookupError> =>
        Effect.suspend(() => {
          // NaN 좌표도 여기서 거리 0으로 답해, 서버로 보내거나 계산에 NaN이 번지지 않게 한다.
          if (!(haversineM(from, to) >= SAME_POINT_M)) {
            return Effect.succeed<RouteResult>({
              mode,
              distanceM: 0,
              durationS: 0,
              tollFare: mode === 'car' ? 0 : null,
              path: [from, to],
              queriedAt: now().toISOString(),
            });
          }
          const key = routeInputKey({ mode, from, to });
          if (legOptions?.refresh !== true) {
            const cached = entries.get(key);
            if (cached !== undefined) {
              // 맨 뒤(가장 최근)로 옮기고 `usedAt`을 새로 한다.
              entries.delete(key);
              entries.set(key, { ...cached, usedAt: now().toISOString() });
              persistSoon();
              return Effect.succeed(stripUsedAt(cached));
            }
          }
          // 진행 중 표는 (경로, fresh 여부)별로 둔다: `다시 계산`이 엣지 캐시를 쓰는 보통 요청에 합쳐지면
          // 오래된 답을 받고 `fresh=1`도 못 보낸다. refresh끼리는 합쳐도 된다.
          const fresh = legOptions?.refresh === true;
          const flightKey = fresh ? `${key}|fresh` : key;
          const running = inflight.get(flightKey);
          if (running !== undefined) return Deferred.await(running);
          const pending = Deferred.makeUnsafe<RouteResult, RouteLookupError>();
          inflight.set(flightKey, pending);
          // 기다리는 쪽이 중단돼도 같은 키를 기다리는 다른 호출이 있을 수 있으니 요청은 따로 돌린다.
          return Effect.forkDetach(
            fetchLeg(key, mode, from, to, fresh).pipe(
              Effect.onExit((exit) =>
                Effect.suspend(() => {
                  inflight.delete(flightKey);
                  return Deferred.done(pending, exit);
                }),
              ),
            ),
          ).pipe(Effect.andThen(Deferred.await(pending)));
        });

      return RouteLookup.of({ leg });
    });
  }

  static readonly layer = Layer.suspend(() => {
    // 접근만으로 예외가 나는 환경(저장소 차단)은 메모리만 쓴다.
    let storage: Storage | null = browserStorage() ?? null;
    try {
      storage?.getItem(ROUTE_CACHE_KEY);
    } catch {
      storage = null;
    }
    return RouteLookup.layerWith({
      fetch: (...args) => globalThis.fetch(...args),
      storage,
      onLeave: listenPageLeave,
    });
  });
}
