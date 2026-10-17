import { Context, Deferred, Effect, Layer, Semaphore } from 'effect';
import type { HoursDay, HoursSpan, PlaceHours } from 'src/server/hours';
import type { ApiErrorCode } from 'src/server/http';
import { browserStorage } from 'src/services/browser-storage';
import { HoursLookupError, type HoursLookupErrorCode } from 'src/services/errors';

/** 영업시간 기기 캐시의 저장 키(스펙 §4.2). 보관함 밖에 두고 백업·공유에 넣지 않는다. */
export const HOURS_CACHE_KEY = 'tripmap:hours:v1';
/** 캐시에 둘 수 있는 장소 수. 넘으면 `usedAt`이 오래된 것부터 지운다. */
export const HOURS_CACHE_MAX = 300;
/** 캐시 문서(JSON)의 최대 글자 수. 넘으면 `usedAt`이 오래된 것부터 지운다. */
export const HOURS_CACHE_MAX_CHARS = 400_000;
/** 받은 지(`fetchedAt`) 이만큼 지나면 다시 받는다(ms, 스펙 §4.3). 그 전까지는 오래된 정보도 판정에 쓴다. */
export const HOURS_STALE_MS = 7 * 86_400_000;
/** 클라이언트가 응답을 기다리는 최대 시간(ms). */
export const HOURS_TIMEOUT_MS = 12_000;
/** 동시에 서버에 보내는 영업시간 요청 수. 네이버 장소 홈은 무겁고 잦으면 빈 응답이 와서 적게 둔다. */
export const HOURS_MAX_CONCURRENT = 2;

const OFFLINE_WARNING = '영업시간 서버에 연결하지 못했어요(로컬이면 yarn dev:full)';
const FORBIDDEN_ORIGIN_WARNING =
  '영업시간 서버가 요청 출처를 거부했어요(허용 출처는 src/server/http.ts에서 설정)';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// 서버 정규화(`src/server/hours.ts`)와 같은 시각 꼴. 끝 시각만 '24:00'이 올 수 있다.
const START = /^([01]\d|2[0-3]):[0-5]\d$/;
const isStart = (value: unknown): value is string => typeof value === 'string' && START.test(value);
const isEnd = (value: unknown): value is string => value === '24:00' || isStart(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);
const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isText);

function toSpan(value: unknown): HoursSpan | null {
  if (!isObject(value) || !isStart(value.start) || !isEnd(value.end)) return null;
  return { start: value.start, end: value.end };
}

function toDay(value: unknown): HoursDay | null {
  if (!isObject(value)) return null;
  const { day, open, closed, breaks, lastOrders, note } = value;
  if (!isText(day) || typeof closed !== 'boolean' || !isTextOrNull(note)) return null;
  let openSpan: HoursDay['open'] = null;
  if (open !== null) {
    const span = toSpan(open);
    if (span === null || !isObject(open) || typeof open.endsNextDay !== 'boolean') return null;
    openSpan = { ...span, endsNextDay: open.endsNextDay };
  }
  if (!Array.isArray(breaks)) return null;
  const spans = breaks.map(toSpan);
  if (spans.some((s) => s === null)) return null;
  if (!Array.isArray(lastOrders) || !lastOrders.every(isStart)) return null;
  return {
    day,
    open: openSpan,
    closed,
    breaks: spans as HoursSpan[],
    lastOrders: [...lastOrders],
    note,
  };
}

/** 서버 응답·저장 항목이 PlaceHours 모양이면 그 부분만, 아니면 null. */
export function toPlaceHoursValue(value: unknown): PlaceHours | null {
  if (!isObject(value)) return null;
  const { sid, fetchedAt, days, irregularClosed, regularClosed, note, otherSchedules } = value;
  if (!isText(sid) || !isText(fetchedAt) || !Array.isArray(days)) return null;
  if (!isTextList(irregularClosed) || !isTextOrNull(regularClosed) || !isTextOrNull(note))
    return null;
  if (!isTextList(otherSchedules)) return null;
  const parsedDays = days.map(toDay);
  if (parsedDays.some((d) => d === null)) return null;
  return {
    sid,
    fetchedAt,
    days: parsedDays as HoursDay[],
    irregularClosed: [...irregularClosed],
    regularClosed,
    note,
    otherSchedules: [...otherSchedules],
  };
}

/**
 * `place`가 돌려주는 영업시간. `seq`는 이 답을 만든 서버 요청의 순서 번호(요청을 시작할 때 1부터 하나씩 올린다).
 * 진행 중인 요청에 합류한 호출도 같은 번호를 받는다. 캐시에서 바로 답하면 0이다. 실패는
 * `HoursLookupError.seq`에 같은 번호를 싣는다. 같은 장소의 답이 엇갈려 와도 번호가 큰 쪽이 나중에 시작한 요청의 답이다.
 */
export type HoursAnswer = { hours: PlaceHours; seq: number };

/** 메모리 캐시 항목. `seq`는 메모리에만 두고 저장하지 않는다(새 페이지의 요청 번호는 다시 1부터다). */
type CachedHours = { hours: PlaceHours; usedAt: string; seq: number };

/** 서버가 준 오류 본문(`{ error: { code, … } }`)에서 코드를 뽑는다. 알아볼 수 없으면 null. */
function readApiErrorCode(body: unknown): string | null {
  if (!isObject(body) || !isObject(body.error) || typeof body.error.code !== 'string') return null;
  return body.error.code;
}

const HOURS_ERROR_CODES: readonly string[] = [
  'NOT_FOUND',
  'UPSTREAM_ERROR',
  'TIMEOUT',
  'BAD_REQUEST',
  'FORBIDDEN_ORIGIN',
] satisfies readonly (HoursLookupErrorCode & ApiErrorCode)[];

/** 서버 코드 중 영업시간 조회가 구분하는 것만 남기고, 나머지는 서버 문제(`UPSTREAM_ERROR`)로 본다. */
const toHoursCode = (code: string): HoursLookupErrorCode =>
  HOURS_ERROR_CODES.includes(code) ? (code as HoursLookupErrorCode) : 'UPSTREAM_ERROR';

/** 저장된 캐시 문서를 읽는다. 저장 값이 깨졌거나 없으면 빈 캐시. 모양이 틀린 항목만 버린다. */
function readCache(storage: Storage | null): Map<string, CachedHours> {
  const entries = new Map<string, CachedHours>();
  if (storage === null) return entries;
  let doc: unknown;
  try {
    const raw = storage.getItem(HOURS_CACHE_KEY);
    if (raw === null) return entries;
    doc = JSON.parse(raw);
  } catch {
    return entries;
  }
  if (!isObject(doc) || !isObject(doc.entries)) return entries;
  const loaded: [string, CachedHours][] = [];
  for (const [sid, value] of Object.entries(doc.entries)) {
    const hours = toPlaceHoursValue(value);
    if (hours === null || !isObject(value) || typeof value.usedAt !== 'string') continue;
    // 저장소에서 읽은 항목은 이 세션의 어떤 요청보다 먼저다.
    loaded.push([sid, { hours, usedAt: value.usedAt, seq: 0 }]);
  }
  // 오래된 것이 앞에 오도록 맞춰 둔다(Map 삽입 순서 = 오래된 순).
  loaded.sort((a, b) => (a[1].usedAt < b[1].usedAt ? -1 : a[1].usedAt > b[1].usedAt ? 1 : 0));
  for (const [sid, value] of loaded) entries.set(sid, value);
  return entries;
}

/**
 * 네이버 장소의 영업시간을 서버 함수(`/api/hours`)로 받고, 결과를 localStorage(`tripmap:hours:v1`)에 캐시한다.
 * - 받은 지 7일 안이면 캐시로 답하고, 넘었거나 `refresh`면 서버에 묻는다(`refresh`는 `&fresh=1`).
 * - 300곳 또는 40만 자를 넘으면 `usedAt`이 오래된 것부터 지운다. 저장은 받을 때마다 바로 한다
 *   (경로처럼 한꺼번에 많이 오지 않는다). 캐시 읽기로 바뀐 `usedAt`은 다음 저장 때 함께 쓴다.
 * - 같은 sid 요청이 진행 중이면 합치고, 동시에 나가는 요청은 최대 2개, 응답은 12초까지 기다린다.
 * - 답(성공·실패)마다 그 답을 만든 서버 요청의 순서 번호(`seq`)를 붙인다(`HoursAnswer`).
 * - 서버 응답 처리는 `RouteLookup`과 같다(HTML·`error` 없는 404·네트워크 실패는 `OFFLINE`).
 */
export class HoursLookup extends Context.Service<
  HoursLookup,
  {
    /** 캐시에 있는 것(오래됐어도). 없으면 null. 요청하지 않는다. */
    peek(sid: string): PlaceHours | null;
    /** 캐시가 7일 안이고 refresh가 아니면 캐시(seq 0), 아니면 서버(`refresh`면 `&fresh=1`). */
    place(
      sid: string,
      options?: { refresh?: boolean },
    ): Effect.Effect<HoursAnswer, HoursLookupError>;
  }
>()('tripmap/HoursLookup') {
  static layerWith(options: {
    fetch: typeof fetch;
    storage: Storage | null;
    base?: string;
    now?: () => Date;
  }): Layer.Layer<HoursLookup> {
    return Layer.sync(HoursLookup, () => {
      const base = options.base ?? '';
      const now = options.now ?? (() => new Date());
      const storage = options.storage;

      const entries = readCache(storage);
      // 쓰기가 끝내 안 되면 이 세션은 메모리에서만 캐시한다.
      let persistent = storage !== null;
      let offlineWarned = false;
      let forbiddenWarned = false;
      // 마지막으로 시작한 서버 요청의 번호. 캐시 답(0)보다 항상 크다.
      let requestSeq = 0;
      const inflight = new Map<string, Deferred.Deferred<HoursAnswer, HoursLookupError>>();
      const slots = Semaphore.makeUnsafe(HOURS_MAX_CONCURRENT);

      /** `usedAt`이 오래된 것부터 `count`개를 지운다(Map은 오래된 순). */
      const dropOldest = (count: number) => {
        for (const sid of [...entries.keys()].slice(0, count)) entries.delete(sid);
      };

      // 요청 번호(`seq`)는 이 세션에서만 뜻이 있어 저장하지 않는다.
      const serialize = () =>
        JSON.stringify({
          entries: Object.fromEntries(
            [...entries].map(([sid, { hours, usedAt }]) => [sid, { ...hours, usedAt }]),
          ),
        });

      /** 글자 수 한도를 넘으면 넘친 비율만큼 오래된 것부터 지우며 다시 맞춘다. 한도 안의 문서를 돌려준다. */
      const fitted = (): string => {
        let json = serialize();
        while (json.length > HOURS_CACHE_MAX_CHARS && entries.size > 0) {
          const excess = Math.ceil(entries.size * (1 - HOURS_CACHE_MAX_CHARS / json.length));
          dropOldest(Math.max(1, excess));
          json = serialize();
        }
        return json;
      };

      const write = (): boolean => {
        try {
          storage?.setItem(HOURS_CACHE_KEY, fitted());
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

      /** 받은 지 7일 안인가. 받은 시각을 읽을 수 없으면 아니다(다시 받는다). */
      const isFresh = (hours: PlaceHours): boolean => {
        const fetchedAt = Date.parse(hours.fetchedAt);
        return Number.isFinite(fetchedAt) && now().getTime() - fetchedAt < HOURS_STALE_MS;
      };

      /** 캐시에 있던 정보가 들어온 정보보다 확실히 새것인가(`fetchedAt` 비교). 시각을 읽을 수 없으면 아니다. */
      const isNewerThan = (cached: PlaceHours, incoming: PlaceHours): boolean => {
        const cachedAt = Date.parse(cached.fetchedAt);
        const incomingAt = Date.parse(incoming.fetchedAt);
        return Number.isFinite(cachedAt) && Number.isFinite(incomingAt) && cachedAt > incomingAt;
      };

      /**
       * 요청 `seq`가 받은 정보를 캐시에 넣고 바로 저장한 뒤, 캐시에 실제로 남은 정보를 돌려준다. 같은 장소의 보통
       * 요청과 `refresh`는 따로 돌아 끝나는 순서가 뒤바뀔 수 있다. 늦게 온 오래된 응답(엣지 캐시)이 먼저 끝난 새
       * 정보를 덮지 않게, 캐시에 더 새 항목이 있으면 그것을 지키고 호출한 쪽에도 그것을(그 항목을 남긴 요청의
       * 번호와 함께) 돌려준다.
       */
      const remember = (sid: string, hours: PlaceHours, seq: number): HoursAnswer => {
        const existing = entries.get(sid);
        entries.delete(sid);
        const usedAt = now().toISOString();
        if (existing !== undefined && isNewerThan(existing.hours, hours)) {
          // 새 항목은 그대로 두고, 쓴 것으로만 친다(맨 뒤로 옮기고 `usedAt` 갱신).
          entries.set(sid, { ...existing, usedAt });
          persist();
          return { hours: existing.hours, seq: existing.seq };
        }
        entries.set(sid, { hours, usedAt, seq });
        if (entries.size > HOURS_CACHE_MAX) dropOldest(entries.size - HOURS_CACHE_MAX);
        persist();
        return { hours, seq };
      };

      const offline = (seq: number) => (cause: unknown) =>
        Effect.sync(() => {
          if (offlineWarned) return;
          offlineWarned = true;
          console.warn(OFFLINE_WARNING, cause);
        }).pipe(Effect.andThen(Effect.fail(new HoursLookupError({ code: 'OFFLINE', seq }))));

      /** 요청 `seq`가 받은 응답을 영업시간으로 읽는다. 실패에도 그 요청의 번호를 싣는다. */
      const request = Effect.fnUntraced(function* (seq: number, sid: string, fresh: boolean) {
        const upstream = () => new HoursLookupError({ code: 'UPSTREAM_ERROR', seq });
        // `다시 확인`(fresh)은 서버의 엣지 캐시도 건너뛰게 한다(스펙 §4.1). 보통 요청은 엣지 캐시를 함께 쓴다.
        const path = `/api/hours?sid=${encodeURIComponent(sid)}${fresh ? '&fresh=1' : ''}`;
        // 시한까지 안 오면 중단한다. 중단하면 대기 칸과 진행 중 표가 풀린다.
        const response = yield* Effect.gen(function* () {
          const res = yield* Effect.tryPromise({
            try: (signal) => options.fetch(`${base}${path}`, { signal }),
            catch: (e) => e,
          }).pipe(Effect.catch(offline(seq)));
          const body = yield* Effect.tryPromise({ try: () => res.text(), catch: (e) => e }).pipe(
            Effect.catch(offline(seq)),
          );
          return { status: res.status, ok: res.ok, text: body };
        }).pipe(
          Effect.timeoutOrElse({
            duration: HOURS_TIMEOUT_MS,
            orElse: () => Effect.fail(new HoursLookupError({ code: 'TIMEOUT', seq })),
          }),
        );
        let body: unknown;
        try {
          body = JSON.parse(response.text);
        } catch {
          // 서버 함수가 있는 환경의 5xx(예: Cloudflare 오류 HTML 페이지)는 서버 문제이지 서버 함수 부재가 아니다.
          if (response.status >= 500) return yield* upstream();
          return yield* offline(seq)(`JSON이 아닌 응답(HTTP ${response.status})`);
        }
        const errorCode = readApiErrorCode(body);
        if (errorCode !== null) {
          const code = toHoursCode(errorCode);
          if (code === 'FORBIDDEN_ORIGIN' && !forbiddenWarned) {
            forbiddenWarned = true;
            console.warn(FORBIDDEN_ORIGIN_WARNING);
          }
          return yield* new HoursLookupError({ code, seq });
        }
        if (response.status === 404) return yield* offline(seq)('error 본문이 없는 404');
        if (!response.ok) return yield* upstream();
        const hours = toPlaceHoursValue(body);
        if (hours === null) return yield* upstream();
        return hours;
      });

      /**
       * 한 장소를 서버에서 받아 캐시에 넣고, 캐시에 남은 정보를 돌려준다. 동시 요청 수는 `slots`가 제한한다.
       * 부를 때(진행 중 표에 올릴 때) 이 요청의 순서 번호를 매기고, 성공·실패 모두에 싣는다.
       */
      const fetchPlace = (sid: string, fresh: boolean) => {
        const seq = ++requestSeq;
        return slots
          .withPermits(1)(request(seq, sid, fresh))
          .pipe(Effect.map((hours) => remember(sid, hours, seq)));
      };

      const peek = (sid: string): PlaceHours | null => entries.get(sid)?.hours ?? null;

      const place = (
        sid: string,
        placeOptions?: { refresh?: boolean },
      ): Effect.Effect<HoursAnswer, HoursLookupError> =>
        Effect.suspend(() => {
          const fresh = placeOptions?.refresh === true;
          if (!fresh) {
            const cached = entries.get(sid);
            if (cached !== undefined && isFresh(cached.hours)) {
              // 맨 뒤(가장 최근)로 옮기고 `usedAt`을 새로 한다. 저장은 다음에 받을 때 함께 한다.
              entries.delete(sid);
              entries.set(sid, { ...cached, usedAt: now().toISOString() });
              return Effect.succeed<HoursAnswer>({ hours: cached.hours, seq: 0 });
            }
          }
          // 진행 중 표는 (sid, fresh 여부)별로 둔다: `다시 확인`이 엣지 캐시를 쓰는 보통 요청에 합쳐지면
          // 오래된 답을 받고 `fresh=1`도 못 보낸다. refresh끼리는 합쳐도 된다. 보통 호출은 진행 중인
          // refresh에 먼저 합류한다: 그 뒤에 보통 요청을 새로 시작하면 엣지 캐시의 오래된 답이 더 큰 번호를
          // 달고 와 refresh의 새 답을 이긴다.
          const flightKey = fresh ? `${sid}|fresh` : sid;
          const running = fresh
            ? inflight.get(flightKey)
            : (inflight.get(`${sid}|fresh`) ?? inflight.get(flightKey));
          if (running !== undefined) return Deferred.await(running);
          const pending = Deferred.makeUnsafe<HoursAnswer, HoursLookupError>();
          inflight.set(flightKey, pending);
          // 기다리는 쪽이 중단돼도 같은 sid를 기다리는 다른 호출이 있을 수 있으니 요청은 따로 돌린다.
          return Effect.forkDetach(
            fetchPlace(sid, fresh).pipe(
              Effect.onExit((exit) =>
                Effect.suspend(() => {
                  inflight.delete(flightKey);
                  return Deferred.done(pending, exit);
                }),
              ),
            ),
          ).pipe(Effect.andThen(Deferred.await(pending)));
        });

      return HoursLookup.of({ peek, place });
    });
  }

  static readonly layer: Layer.Layer<HoursLookup> = Layer.suspend(() => {
    // 접근만으로 예외가 나는 환경(저장소 차단)은 메모리만 쓴다.
    let storage: Storage | null = browserStorage() ?? null;
    try {
      storage?.getItem(HOURS_CACHE_KEY);
    } catch {
      storage = null;
    }
    return HoursLookup.layerWith({ fetch: (...args) => globalThis.fetch(...args), storage });
  });
}
