import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, vi } from 'vitest';
import { it } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { extractBusinessHours, toPlaceHours, type PlaceHours } from 'src/server/hours';
import { HoursLookupError } from 'src/services/errors';
import {
  HOURS_CACHE_KEY,
  HOURS_CACHE_MAX,
  HOURS_CACHE_MAX_CHARS,
  HOURS_MAX_CONCURRENT,
  HOURS_STALE_MS,
  HOURS_TIMEOUT_MS,
  HoursLookup,
  toPlaceHoursValue,
} from 'src/services/hours-lookup';

const SID = '11733192';
const FETCHED = '2026-10-16T03:00:00.000Z';
const FETCHED_MS = Date.parse(FETCHED);

const hours = (over: Partial<PlaceHours> = {}): PlaceHours => ({
  sid: SID,
  fetchedAt: FETCHED,
  days: [
    {
      day: '금',
      open: { start: '11:00', end: '21:00', endsNextDay: false },
      closed: false,
      breaks: [{ start: '15:00', end: '16:30' }],
      lastOrders: ['20:30'],
      note: null,
    },
    { day: '수', open: null, closed: true, breaks: [], lastOrders: [], note: '정기휴무' },
  ],
  irregularClosed: [],
  regularClosed: '매주 수요일',
  note: null,
  otherSchedules: [],
  ...over,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
const errorBody = (code: string) => ({ error: { code, message: 'm' } });

type StoredDoc = { entries: Record<string, PlaceHours & { usedAt: string }> };
const readDoc = (storage: Storage): StoredDoc =>
  JSON.parse(storage.getItem(HOURS_CACHE_KEY) ?? '{"entries":{}}') as StoredDoc;
const stored = (sid: string, usedAt: string, over: Partial<PlaceHours> = {}) => ({
  ...hours({ sid, ...over }),
  usedAt,
});
const seedDoc = (storage: Storage, entries: StoredDoc['entries']) =>
  storage.setItem(HOURS_CACHE_KEY, JSON.stringify({ entries }));

type RunOptions = { fetch: unknown; storage: Storage | null; base?: string; now?: () => Date };

/** 기본 시각: 받은 시각에서 1시간 뒤(7일 안). */
const at = (ms: number) => () => new Date(ms);
const DEFAULT_NOW = at(FETCHED_MS + 3_600_000);

const run = <A>(
  options: RunOptions,
  use: (lookup: HoursLookup['Service']) => Effect.Effect<A, HoursLookupError>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* HoursLookup);
  }).pipe(
    Effect.provide(
      HoursLookup.layerWith({
        fetch: options.fetch as typeof fetch,
        storage: options.storage,
        base: options.base,
        now: options.now ?? DEFAULT_NOW,
      }),
    ),
  );

/** 마이크로태스크·타이머 한 바퀴를 기다린다. */
const settle = Effect.promise(() => new Promise<void>((r) => setTimeout(r, 0)));

/** `done`이 참이 될 때까지 `settle`을 되풀이한다(최대 50번). 파이버가 언제 도는지는 한 바퀴로 정해지지 않는다. */
const settleUntil = (done: () => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 50 && !done(); i += 1) yield* settle;
  });

/** 오류는 그대로, 그 밖의 실패는 결함으로(타입을 `HoursLookupError`로 좁힌다). */
const onlyLookupErrors = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.catch((e) => (e instanceof HoursLookupError ? Effect.fail(e) : Effect.die(e))),
  );

/** 저장소 흉내. `maxChars`를 넘는 값을 쓰면 용량 초과로 던진다. */
class QuotaStorage implements Storage {
  readonly items = new Map<string, string>();
  writes = 0;
  constructor(private readonly maxChars: number) {}
  [name: string]: unknown;
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.writes += 1;
    if (value.length > this.maxChars) throw new DOMException('quota', 'QuotaExceededError');
    this.items.set(key, value);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('상수', () => {
  it('스펙 값', () => {
    expect(HOURS_CACHE_KEY).toBe('tripmap:hours:v1');
    expect(HOURS_CACHE_MAX).toBe(300);
    expect(HOURS_CACHE_MAX_CHARS).toBe(400_000);
    expect(HOURS_STALE_MS).toBe(7 * 86_400_000);
    expect(HOURS_TIMEOUT_MS).toBe(12_000);
    expect(HOURS_MAX_CONCURRENT).toBe(2);
  });
});

describe('HoursLookup 요청과 캐시', () => {
  it.effect('첫 요청은 /api/hours?sid=로 보내 seq 1, 저장소에 넣고, 다시 부르면 캐시(seq 0)', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi.fn(async () => json(hours()));
      const [first, second] = yield* run({ fetch: fetchFn, storage, base: 'https://x.test' }, (l) =>
        Effect.gen(function* () {
          return [yield* l.place(SID), yield* l.place(SID)] as const;
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledWith(`https://x.test/api/hours?sid=${SID}`, {
        signal: expect.any(AbortSignal),
      });
      expect(first).toEqual({ hours: hours(), seq: 1 });
      expect(second).toEqual({ hours: hours(), seq: 0 });
      const entry = readDoc(storage).entries[SID];
      expect(entry).toMatchObject(hours());
      expect(entry?.usedAt).toBe(DEFAULT_NOW().toISOString());
      expect(entry).not.toHaveProperty('seq');
    }),
  );

  it.effect('새 레이어도 저장소의 캐시를 읽는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi.fn(async () => json(hours()));
      yield* run({ fetch: fetchFn, storage }, (l) => l.place(SID));
      const again = yield* run({ fetch: fetchFn, storage }, (l) => l.place(SID));
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(again).toEqual({ hours: hours(), seq: 0 });
    }),
  );

  it.effect('받은 지 7일 − 1ms면 캐시, 7일이면 다시 요청한다(fresh 없이)', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seedDoc(storage, { [SID]: stored(SID, FETCHED) });
      const fetchFn = vi.fn(async () => json(hours({ fetchedAt: '2026-10-23T03:00:00.000Z' })));
      const fresh = yield* run(
        { fetch: fetchFn, storage, now: at(FETCHED_MS + HOURS_STALE_MS - 1) },
        (l) => l.place(SID),
      );
      expect(fetchFn).not.toHaveBeenCalled();
      expect(fresh).toEqual({ hours: hours(), seq: 0 });

      const stale = yield* run(
        { fetch: fetchFn, storage, now: at(FETCHED_MS + HOURS_STALE_MS) },
        (l) => l.place(SID),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toBe(`/api/hours?sid=${SID}`);
      expect(stale.seq).toBe(1);
      expect(stale.hours.fetchedAt).toBe('2026-10-23T03:00:00.000Z');
      expect(readDoc(storage).entries[SID]?.fetchedAt).toBe('2026-10-23T03:00:00.000Z');
    }),
  );

  it.effect('refresh면 캐시가 새것이어도 &fresh=1로 다시 받는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seedDoc(storage, { [SID]: stored(SID, FETCHED) });
      const fetchFn = vi.fn(async () => json(hours({ fetchedAt: '2026-10-16T04:00:00.000Z' })));
      const got = yield* run({ fetch: fetchFn, storage }, (l) => l.place(SID, { refresh: true }));
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toBe(`/api/hours?sid=${SID}&fresh=1`);
      expect(got).toEqual({ hours: hours({ fetchedAt: '2026-10-16T04:00:00.000Z' }), seq: 1 });
    }),
  );

  it.effect('저장소가 없으면(null) 메모리 캐시만 쓴다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => json(hours()));
      yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.andThen(l.place(SID), l.place(SID)),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }),
  );
});

describe('HoursLookup.peek', () => {
  it.effect('캐시에 없으면 null이고 요청하지 않는다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => json(hours()));
      const got = yield* run({ fetch: fetchFn, storage: createMemoryStorage() }, (l) =>
        Effect.sync(() => l.peek(SID)),
      );
      expect(got).toBeNull();
      expect(fetchFn).not.toHaveBeenCalled();
    }),
  );

  it.effect('8일 된 것도 그대로 돌려준다(요청하지 않는다)', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seedDoc(storage, { [SID]: stored(SID, FETCHED) });
      const fetchFn = vi.fn(async () => json(hours()));
      const got = yield* run(
        { fetch: fetchFn, storage, now: at(FETCHED_MS + 8 * 86_400_000) },
        (l) => Effect.sync(() => l.peek(SID)),
      );
      expect(got).toEqual(hours());
      expect(fetchFn).not.toHaveBeenCalled();
    }),
  );
});

describe('HoursLookup 동시 요청', () => {
  it.effect('같은 sid 셋을 동시에 부르면 요청은 하나이고 셋 다 같은 답', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return json(hours());
      });
      const answers = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.all([l.place(SID), l.place(SID), l.place(SID)], { concurrency: 'unbounded' }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(answers).toEqual([
        { hours: hours(), seq: 1 },
        { hours: hours(), seq: 1 },
        { hours: hours(), seq: 1 },
      ]);
    }),
  );

  it.effect('서로 다른 sid 다섯을 동시에 부르면 동시에 나가는 요청은 2개를 넘지 않는다', () =>
    Effect.gen(function* () {
      let inFlight = 0;
      let peak = 0;
      const fetchFn = vi.fn(async (url: unknown) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        const sid = new URL(String(url), 'https://x.test').searchParams.get('sid') ?? '';
        return json(hours({ sid }));
      });
      const sids = ['1', '2', '3', '4', '5'];
      const answers = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.all(
          sids.map((sid) => l.place(sid)),
          { concurrency: 'unbounded' },
        ),
      );
      expect(fetchFn).toHaveBeenCalledTimes(5);
      expect(peak).toBe(2);
      expect(answers.map((a) => a.hours.sid)).toEqual(sids);
    }),
  );

  /** 응답을 테스트가 정한다: `answer(n, 응답)`을 불러야 n번째 요청이 응답한다. */
  const gatedFetch = () => {
    const gates: ((res: Response) => void)[] = [];
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          gates.push(resolve);
        }),
    );
    const answer = (n: number, res: Response) =>
      Effect.gen(function* () {
        yield* settle;
        gates[n]?.(res);
        yield* settle;
      });
    return { fetchFn, answer };
  };
  const STALE = hours({ fetchedAt: '2026-10-16T03:00:00.000Z', note: '오래된 답' });
  const NEWER = hours({ fetchedAt: '2026-10-16T05:00:00.000Z', note: '새 답' });

  it.effect(
    '보통 요청 중 refresh는 fresh=1로 따로 나가 seq가 더 크고, 늦게 온 오래된 보통 응답은 캐시의 새것을 덮지 않는다',
    () =>
      Effect.gen(function* () {
        const storage = createMemoryStorage();
        const { fetchFn, answer } = gatedFetch();
        const [plain, refreshed, later] = yield* run({ fetch: fetchFn, storage }, (l) =>
          Effect.gen(function* () {
            const [plain, refreshed] = yield* Effect.all(
              [
                l.place(SID),
                Effect.andThen(settle, l.place(SID, { refresh: true })),
                // refresh가 요청을 낸 뒤(settle 한 번 더)에 refresh부터 답한다.
                Effect.andThen(
                  settle,
                  Effect.andThen(answer(1, json(NEWER)), answer(0, json(STALE))),
                ),
              ],
              { concurrency: 'unbounded' },
            );
            return [plain, refreshed, yield* l.place(SID)] as const;
          }),
        );
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(fetchFn.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual([
          `/api/hours?sid=${SID}`,
          `/api/hours?sid=${SID}&fresh=1`,
        ]);
        expect(refreshed).toEqual({ hours: NEWER, seq: 2 });
        expect(refreshed.seq).toBeGreaterThan(1);
        // 늦게 온 오래된 응답을 받은 보통 호출도 캐시가 지킨 새 값과 그 번호를 받는다.
        expect(plain).toEqual({ hours: NEWER, seq: 2 });
        expect(later.hours).toEqual(NEWER);
        expect(readDoc(storage).entries[SID]).toMatchObject({ note: '새 답' });
      }),
  );

  it.effect('refresh가 진행 중이면 보통 호출은 그 요청에 합류한다', () =>
    Effect.gen(function* () {
      const { fetchFn, answer } = gatedFetch();
      const [refreshed, plain] = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.all(
          [
            l.place(SID, { refresh: true }),
            Effect.andThen(settle, l.place(SID)),
            Effect.andThen(settle, answer(0, json(NEWER))),
          ],
          { concurrency: 'unbounded' },
        ),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('fresh=1');
      expect(refreshed).toEqual({ hours: NEWER, seq: 1 });
      expect(plain).toEqual({ hours: NEWER, seq: 1 });
    }),
  );
});

describe('HoursLookup 오류', () => {
  const failure = (fetchFn: unknown, storage: Storage | null = null) =>
    run({ fetch: fetchFn, storage }, (l) => l.place(SID)).pipe(Effect.flip);

  it.effect('NOT_FOUND 404 본문은 NOT_FOUND이고 캐시하지 않는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const error = yield* failure(
        vi.fn(async () => json(errorBody('NOT_FOUND'), 404)),
        storage,
      );
      expect(error).toBeInstanceOf(HoursLookupError);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.seq).toBe(1);
      expect(storage.getItem(HOURS_CACHE_KEY)).toBeNull();
    }),
  );

  it.effect.each([
    ['BAD_REQUEST', 400, 'BAD_REQUEST'],
    ['UPSTREAM_ERROR', 502, 'UPSTREAM_ERROR'],
    ['TIMEOUT', 504, 'TIMEOUT'],
    ['FORBIDDEN_ORIGIN', 403, 'FORBIDDEN_ORIGIN'],
    ['NO_ROUTE', 404, 'UPSTREAM_ERROR'],
    ['SOMETHING_NEW', 500, 'UPSTREAM_ERROR'],
  ] as const)('서버 코드 %s(HTTP %i)는 %s로 옮긴다', ([code, status, expected]) =>
    Effect.gen(function* () {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = yield* failure(vi.fn(async () => json(errorBody(code), status)));
      expect(error.code).toBe(expected);
    }),
  );

  it.effect('FORBIDDEN_ORIGIN 경고는 세션에 한 번', () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fetchFn = vi.fn(async () => json(errorBody('FORBIDDEN_ORIGIN'), 403));
      yield* run({ fetch: fetchFn, storage: null }, (l) =>
        onlyLookupErrors(
          Effect.gen(function* () {
            yield* Effect.flip(l.place('1'));
            yield* Effect.flip(l.place('2'));
          }),
        ),
      );
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect('502 HTML은 UPSTREAM_ERROR(경고 없음)', () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = yield* failure(
        vi.fn(async () => new Response('<html>oops</html>', { status: 502 })),
      );
      expect(error.code).toBe('UPSTREAM_ERROR');
      expect(warn).not.toHaveBeenCalled();
    }),
  );

  it.effect('200 HTML은 OFFLINE이고 경고는 처음 한 번만 낸다', () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fetchFn = vi.fn(async () => new Response('<!doctype html><html></html>'));
      const codes = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        onlyLookupErrors(
          Effect.gen(function* () {
            const first = yield* Effect.flip(l.place('1'));
            const second = yield* Effect.flip(l.place('2'));
            return [first.code, second.code];
          }),
        ),
      );
      expect(codes).toEqual(['OFFLINE', 'OFFLINE']);
      expect(warn).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect('fetch 거부와 error 본문 없는 404는 OFFLINE', () =>
    Effect.gen(function* () {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const network = yield* failure(
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      );
      const notFound = yield* failure(
        vi.fn(async () => new Response('Not found', { status: 404 })),
      );
      expect(network.code).toBe('OFFLINE');
      expect(network.seq).toBe(1);
      expect(notFound.code).toBe('OFFLINE');
    }),
  );

  it.effect('모양이 틀린 200 JSON은 UPSTREAM_ERROR이고 캐시하지 않는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const error = yield* failure(
        vi.fn(async () => json({ sid: SID, days: 'x' })),
        storage,
      );
      expect(error.code).toBe('UPSTREAM_ERROR');
      expect(storage.getItem(HOURS_CACHE_KEY)).toBeNull();
    }),
  );

  it.effect('12초 안에 응답이 없으면 TIMEOUT이고, 대기 칸과 진행 중 표가 풀린다', () =>
    Effect.gen(function* () {
      const fetchFn = vi
        .fn()
        .mockImplementation(() => new Promise<Response>(() => {})) // 응답이 오지 않는다
        .mockImplementationOnce(() => new Promise<Response>(() => {}))
        .mockImplementationOnce(() => new Promise<Response>(() => {}))
        .mockImplementationOnce(async () => json(hours({ sid: '1' })));
      const outcome = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        onlyLookupErrors(
          Effect.gen(function* () {
            const hung = yield* Effect.all(
              ['1', '2'].map((sid) => Effect.flip(l.place(sid)).pipe(Effect.forkChild)),
            );
            for (let i = 0; i < 5; i += 1) yield* Effect.yieldNow;
            expect(fetchFn).toHaveBeenCalledTimes(2);
            yield* TestClock.adjust('11999 millis');
            expect(hung[0]?.pollUnsafe()).toBeUndefined();
            yield* TestClock.adjust('1 millis');
            const errors = yield* Effect.all(hung.map((f) => Fiber.join(f)));
            // 다시 부르면 진행 중 표에 남아 있지 않아 새로 요청한다.
            const retry = yield* l.place('1');
            return { errors: errors.map((e) => [e.code, e.seq]), retry };
          }),
        ),
      );
      expect(outcome.errors).toEqual([
        ['TIMEOUT', 1],
        ['TIMEOUT', 2],
      ]);
      expect(outcome.retry).toEqual({ hours: hours({ sid: '1' }), seq: 3 });
      expect(fetchFn).toHaveBeenCalledTimes(3);
    }),
  );

  it.effect(
    '본문을 받는 중에 12초가 지나도 TIMEOUT이고 그 요청을 끊어, 받는 중인 전송이 2개를 넘지 않는다',
    () =>
      Effect.gen(function* () {
        // 머리는 오고 본문은 끝나지 않는 응답. 실제 fetch처럼 signal이 끊기면 본문 읽기도 실패한다.
        const signals: AbortSignal[] = [];
        const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
          const signal = init!.signal!;
          signals.push(signal);
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"sid":'));
              signal.addEventListener('abort', () => controller.error(signal.reason));
            },
          });
          return new Response(body, { status: 200 });
        });
        const transferring = () => signals.filter((s) => !s.aborted).length;
        const outcome = yield* run({ fetch: fetchFn, storage: null }, (l) =>
          onlyLookupErrors(
            Effect.gen(function* () {
              const hung = yield* Effect.all(
                ['1', '2'].map((sid) => Effect.flip(l.place(sid)).pipe(Effect.forkChild)),
              );
              yield* settleUntil(() => fetchFn.mock.calls.length >= 2);
              expect(fetchFn).toHaveBeenCalledTimes(2);
              expect(transferring()).toBe(2);
              yield* TestClock.adjust(`${HOURS_TIMEOUT_MS} millis`);
              const errors = yield* Effect.all(hung.map((f) => Fiber.join(f)));
              const aborted = signals.map((s) => s.aborted);
              // 칸이 풀려 셋째 요청이 나가도 끊지 않은 전송은 2개를 넘지 않는다.
              const third = yield* Effect.flip(l.place('3')).pipe(Effect.forkChild);
              yield* settleUntil(() => fetchFn.mock.calls.length >= 3);
              const afterThird = { calls: fetchFn.mock.calls.length, transferring: transferring() };
              yield* TestClock.adjust(`${HOURS_TIMEOUT_MS} millis`);
              const thirdError = yield* Fiber.join(third);
              return { errors: errors.map((e) => e.code), aborted, afterThird, thirdError };
            }),
          ),
        );
        expect(outcome.errors).toEqual(['TIMEOUT', 'TIMEOUT']);
        expect(outcome.aborted).toEqual([true, true]);
        expect(outcome.afterThird).toEqual({ calls: 3, transferring: 1 });
        expect(outcome.thirdError.code).toBe('TIMEOUT');
        expect(signals[2]?.aborted).toBe(true);
      }),
  );

  it.effect('실패에도 그 요청의 seq가 붙고, 실패한 sid는 다시 시도할 수 있다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seedDoc(storage, { [SID]: stored(SID, FETCHED) });
      const fetchFn = vi
        .fn()
        .mockImplementationOnce(async () => json(errorBody('UPSTREAM_ERROR'), 502))
        .mockImplementationOnce(async () => json(hours({ note: '새로 받음' })));
      const out = yield* run(
        { fetch: fetchFn, storage, now: at(FETCHED_MS + 8 * 86_400_000) },
        (l) =>
          onlyLookupErrors(
            Effect.gen(function* () {
              const failed = yield* Effect.flip(l.place(SID));
              // 실패해도 옛 정보는 지우지 않는다.
              const kept = l.peek(SID);
              const second = yield* l.place(SID);
              return { failed: [failed.code, failed.seq], kept, second };
            }),
          ),
      );
      expect(out.failed).toEqual(['UPSTREAM_ERROR', 1]);
      expect(out.kept).toEqual(hours());
      expect(out.second).toEqual({ hours: hours({ note: '새로 받음' }), seq: 2 });
    }),
  );
});

describe('HoursLookup 오류의 요청 종류(fresh)', () => {
  const never = () => new Promise<Response>(() => {});
  const cases = [
    ['NOT_FOUND(error 본문)', async () => json(errorBody('NOT_FOUND'), 404), 'NOT_FOUND'],
    ['502 HTML', async () => new Response('<html>oops</html>', { status: 502 }), 'UPSTREAM_ERROR'],
    ['200 HTML', async () => new Response('<!doctype html>'), 'OFFLINE'],
    [
      'fetch 거부',
      async () => {
        throw new TypeError('Failed to fetch');
      },
      'OFFLINE',
    ],
    ['모양 틀린 200 JSON', async () => json({ days: 'x' }), 'UPSTREAM_ERROR'],
  ] as const;

  it.effect.each(cases)(
    '%s: refresh 실패는 fresh true, 보통 실패는 fresh false',
    ([, respond, code]) =>
      Effect.gen(function* () {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fetchFn = vi.fn(respond);
        const out = yield* run({ fetch: fetchFn, storage: null }, (l) =>
          onlyLookupErrors(
            Effect.gen(function* () {
              const plain = yield* Effect.flip(l.place(SID));
              const refreshed = yield* Effect.flip(l.place(SID, { refresh: true }));
              return [
                [plain.code, plain.seq, plain.fresh],
                [refreshed.code, refreshed.seq, refreshed.fresh],
              ];
            }),
          ),
        );
        expect(out).toEqual([
          [code, 1, false],
          [code, 2, true],
        ]);
      }),
  );

  it.effect('TIMEOUT에도 요청 종류가 붙는다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(never);
      const out = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        onlyLookupErrors(
          Effect.gen(function* () {
            const fibers = yield* Effect.all([
              Effect.flip(l.place('1')).pipe(Effect.forkChild),
              Effect.flip(l.place('2', { refresh: true })).pipe(Effect.forkChild),
            ]);
            for (let i = 0; i < 5; i += 1) yield* Effect.yieldNow;
            yield* TestClock.adjust(`${HOURS_TIMEOUT_MS} millis`);
            const errors = yield* Effect.all(fibers.map((f) => Fiber.join(f)));
            return errors.map((e) => [e.code, e.fresh]);
          }),
        ),
      );
      expect(out).toEqual([
        ['TIMEOUT', false],
        ['TIMEOUT', true],
      ]);
    }),
  );

  it.effect(
    '진행 중인 refresh에 합류한 보통 호출의 오류도 fresh true(실제로 나간 요청의 종류)',
    () =>
      Effect.gen(function* () {
        const gates: ((res: Response) => void)[] = [];
        const fetchFn = vi.fn(() => new Promise<Response>((resolve) => gates.push(resolve)));
        const out = yield* run({ fetch: fetchFn, storage: null }, (l) =>
          onlyLookupErrors(
            Effect.gen(function* () {
              const [refreshed, joined] = yield* Effect.all(
                [
                  Effect.flip(l.place(SID, { refresh: true })),
                  Effect.flip(Effect.andThen(settle, l.place(SID))),
                  Effect.gen(function* () {
                    yield* settle;
                    yield* settle;
                    gates[0]?.(json(errorBody('UPSTREAM_ERROR'), 502));
                  }),
                ],
                { concurrency: 'unbounded' },
              );
              return [
                [refreshed.seq, refreshed.fresh],
                [joined.seq, joined.fresh],
              ];
            }),
          ),
        );
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(out).toEqual([
          [1, true],
          [1, true],
        ]);
      }),
  );
});

describe('HoursLookup sid 확인', () => {
  it.effect('응답의 sid가 요청한 sid와 다르면 UPSTREAM_ERROR이고 캐시하지 않는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi.fn(async () => json(hours({ sid: '999' })));
      const error = yield* run({ fetch: fetchFn, storage }, (l) => l.place(SID)).pipe(Effect.flip);
      expect(error.code).toBe('UPSTREAM_ERROR');
      expect(error.fresh).toBe(false);
      expect(storage.getItem(HOURS_CACHE_KEY)).toBeNull();
    }),
  );

  it.effect('저장된 항목의 sid가 키와 다르면 버린다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seedDoc(storage, {
        [SID]: stored(SID, FETCHED),
        '2': stored('999', FETCHED),
      });
      const fetchFn = vi.fn(async () => json(hours({ sid: '2' })));
      const out = yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          const peeked = l.peek('2');
          return [l.peek(SID), peeked, yield* l.place('2')] as const;
        }),
      );
      expect(out[0]).toEqual(hours());
      expect(out[1]).toBeNull();
      expect(out[2]).toEqual({ hours: hours({ sid: '2' }), seq: 1 });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }),
  );
});

describe('HoursLookup 저장소', () => {
  it.effect.each([
    ['JSON이 아님', '{not json'],
    ['entries가 없음', JSON.stringify({ foo: 1 })],
    ['entries가 배열', JSON.stringify({ entries: [1, 2] })],
  ])('저장 값이 깨졌으면(%s) 빈 캐시로 시작한다', ([, raw]) =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(HOURS_CACHE_KEY, raw as string);
      const fetchFn = vi.fn(async () => json(hours()));
      const got = yield* run({ fetch: fetchFn, storage }, (l) => l.place(SID));
      expect(got).toEqual({ hours: hours(), seq: 1 });
      expect(Object.keys(readDoc(storage).entries)).toEqual([SID]);
    }),
  );

  it.effect('모양이 틀린 항목만 버리고 나머지는 쓴다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(
        HOURS_CACHE_KEY,
        JSON.stringify({
          entries: {
            [SID]: stored(SID, FETCHED),
            // 요청하는 키 아래 모양이 틀린 값: 검사가 없으면 그대로 나온다.
            '2': { ...stored('2', FETCHED), days: [{ day: '월', open: 9 }] },
            '3': hours({ sid: '3' }), // usedAt 없음
          },
        }),
      );
      const fetchFn = vi.fn(async () => json(hours({ sid: '2', note: '새로 받음' })));
      const out = yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          const peekBad = l.peek('2');
          const peekNoUsed = l.peek('3');
          return [yield* l.place(SID), yield* l.place('2'), peekBad, peekNoUsed] as const;
        }),
      );
      expect(out[0]).toEqual({ hours: hours(), seq: 0 });
      expect(out[1].hours.note).toBe('새로 받음');
      expect(out[2]).toBeNull();
      expect(out[3]).toBeNull();
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect('301곳이 되면 가장 오래 안 쓴 것 하나를 지운다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const entries: StoredDoc['entries'] = {};
      for (let i = 0; i < HOURS_CACHE_MAX; i += 1) {
        const sid = String(1000 + i);
        entries[sid] = stored(sid, new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString());
      }
      seedDoc(storage, entries);
      const fetchFn = vi.fn(async () => json(hours({ sid: '9' })));
      // 가장 오래된 1000을 읽어 최근으로 만든 뒤 새 항목을 넣으면 1001이 지워진다.
      yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          yield* l.place('1000');
          yield* l.place('9');
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const saved = readDoc(storage).entries;
      expect(Object.keys(saved)).toHaveLength(HOURS_CACHE_MAX);
      expect(saved['1000']).toBeDefined();
      expect(saved['1001']).toBeUndefined();
      expect(saved['9']).toBeDefined();
    }),
  );

  it.effect('문서가 40만 자를 넘으면 넘친 만큼 오래된 것부터 지운다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const big = 'x'.repeat(20_000);
      const entries: StoredDoc['entries'] = {};
      for (let i = 0; i < 20; i += 1) {
        const sid = String(1000 + i);
        entries[sid] = stored(sid, new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(), {
          note: big,
        });
      }
      seedDoc(storage, entries);
      expect(storage.getItem(HOURS_CACHE_KEY)!.length).toBeGreaterThan(400_000);
      const fetchFn = vi.fn(async () => json(hours({ sid: '9', note: big })));
      yield* run({ fetch: fetchFn, storage }, (l) => l.place('9'));
      const raw = storage.getItem(HOURS_CACHE_KEY)!;
      expect(raw.length).toBeLessThanOrEqual(HOURS_CACHE_MAX_CHARS);
      const keys = Object.keys(readDoc(storage).entries);
      // 한 곳에 약 2만 자: 21곳 중 19곳까지 들어간다. 가장 오래된 둘이 빠진다.
      expect(keys).toHaveLength(19);
      expect(keys).not.toContain('1000');
      expect(keys).not.toContain('1001');
      expect(keys).toContain('1002');
      expect(keys).toContain('9');
    }),
  );

  it.effect('쓰기가 용량 초과면 오래된 절반을 지우고 한 번 더 쓴다', () =>
    Effect.gen(function* () {
      const entries: StoredDoc['entries'] = {};
      for (let i = 0; i < 10; i += 1) {
        const sid = String(1000 + i);
        entries[sid] = stored(sid, new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString());
      }
      const seed = JSON.stringify({ entries });
      const storage = new QuotaStorage(seed.length + 50);
      storage.items.set(HOURS_CACHE_KEY, seed);
      const fetchFn = vi.fn(async () => json(hours({ sid: '9' })));
      yield* run({ fetch: fetchFn, storage }, (l) => l.place('9'));
      expect(storage.writes).toBe(2);
      const keys = Object.keys(readDoc(storage).entries);
      expect(keys).toHaveLength(6);
      expect(keys).toContain('9');
      expect(keys).not.toContain('1000');
      expect(keys).toContain('1009');
    }),
  );

  it.effect('setItem이 늘 던지면 답은 오고, 그 뒤로는 메모리에만 둔다', () =>
    Effect.gen(function* () {
      const storage = new QuotaStorage(0);
      const fetchFn = vi.fn(async (url: unknown) => {
        const sid = new URL(String(url), 'https://x.test').searchParams.get('sid') ?? '';
        return json(hours({ sid }));
      });
      const out = yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          const first = yield* l.place('1');
          // 처음 쓰기 실패 → 절반 삭제 → 재시도 실패로 두 번 시도한 뒤 저장소에 쓰지 않는다.
          expect(storage.writes).toBe(2);
          const cached = yield* l.place('1');
          yield* l.place('2');
          expect(storage.writes).toBe(2);
          return [first, cached] as const;
        }),
      );
      expect(out[0]).toEqual({ hours: hours({ sid: '1' }), seq: 1 });
      expect(out[1]).toEqual({ hours: hours({ sid: '1' }), seq: 0 });
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(storage.items.has(HOURS_CACHE_KEY)).toBe(false);
    }),
  );
});

describe('toPlaceHoursValue', () => {
  const recorded = () => {
    const html = readFileSync(
      resolve(process.cwd(), 'tests/fixtures/naver/pcmap-home-11733192.html'),
      'utf8',
    );
    return toPlaceHours(SID, extractBusinessHours(html), FETCHED);
  };

  it('Task 1 서버 정규화 결과는 그대로 통과한다', () => {
    const value = recorded();
    expect(value.days.length).toBeGreaterThan(0);
    expect(toPlaceHoursValue(value)).toEqual(value);
    expect(toPlaceHoursValue(hours())).toEqual(hours());
    expect(toPlaceHoursValue(hours({ days: [] }))).toEqual(hours({ days: [] }));
  });

  it('PlaceHours 밖의 필드(usedAt)는 뺀다', () => {
    expect(toPlaceHoursValue({ ...hours(), usedAt: FETCHED })).toEqual(hours());
  });

  it.each([
    [
      'open.start가 숫자',
      { days: [{ ...hours().days[0], open: { start: 9, end: '21:00', endsNextDay: false } }] },
    ],
    [
      'open.end가 시각 꼴이 아님',
      { days: [{ ...hours().days[0], open: { start: '09:00', end: '9시', endsNextDay: false } }] },
    ],
    [
      'endsNextDay가 없음',
      { days: [{ ...hours().days[0], open: { start: '09:00', end: '21:00' } }] },
    ],
    ['breaks 항목이 틀림', { days: [{ ...hours().days[0], breaks: [{ start: '15:00' }] }] }],
    ['lastOrders 항목이 숫자', { days: [{ ...hours().days[0], lastOrders: [2030] }] }],
    ['closed가 문자열', { days: [{ ...hours().days[0], closed: 'no' }] }],
    ['days가 배열이 아님', { days: {} }],
    ['fetchedAt이 없음', { fetchedAt: undefined }],
    ['sid가 숫자', { sid: 11733192 }],
    ['irregularClosed 항목이 숫자', { irregularClosed: [1] }],
    ['regularClosed가 숫자', { regularClosed: 1 }],
    ['note가 숫자', { note: 1 }],
    ['otherSchedules가 문자열', { otherSchedules: '점심' }],
  ])('%s면 null', (_, over) => {
    expect(toPlaceHoursValue({ ...hours(), ...over })).toBeNull();
  });

  it.each([null, 'x', 1, []])('객체가 아니면(%s) null', (value) => {
    expect(toPlaceHoursValue(value)).toBeNull();
  });
});

describe('HoursLookupError.userMessage', () => {
  it.each([
    ['NOT_FOUND', '네이버에서 장소를 찾지 못했어요'],
    ['OFFLINE', '인터넷에 연결되지 않았어요'],
    ['UPSTREAM_ERROR', '영업시간을 받지 못했어요'],
    ['TIMEOUT', '영업시간을 받지 못했어요'],
    ['BAD_REQUEST', '영업시간을 받지 못했어요'],
    ['FORBIDDEN_ORIGIN', '영업시간을 받지 못했어요'],
  ] as const)('%s → %s', (code, message) => {
    expect(new HoursLookupError({ code, seq: 0, fresh: false }).userMessage).toBe(message);
  });
});
