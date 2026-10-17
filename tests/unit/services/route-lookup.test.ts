import { afterEach, describe, expect, vi } from 'vitest';
import { it } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { routeInputKey, type RouteMode, type RouteResult } from 'src/server/route';
import { RouteLookupError } from 'src/services/errors';
import {
  listenPageLeave,
  ROUTE_CACHE_KEY,
  ROUTE_MAX_CONCURRENT,
  ROUTE_PERSIST_DELAY_MS,
  ROUTE_TIMEOUT_MS,
  RouteLookup,
} from 'src/services/route-lookup';

type Pt = [number, number];
const A: Pt = [127.0, 37.5];
const B: Pt = [127.05, 37.52];

const result = (over: Partial<RouteResult> = {}): RouteResult => ({
  mode: 'car',
  distanceM: 5000,
  durationS: 600,
  tollFare: 0,
  path: [A, B],
  queriedAt: '2026-10-13T00:00:00.000Z',
  ...over,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
const errorBody = (code: string) => ({ error: { code, message: 'm' } });

type StoredDoc = { entries: Record<string, RouteResult & { usedAt: string }> };
const readDoc = (storage: Storage): StoredDoc =>
  JSON.parse(storage.getItem(ROUTE_CACHE_KEY) ?? '{"entries":{}}') as StoredDoc;

/** 시각을 1초씩 올리며 돌려준다(오래된 순 비교용). */
const clock = () => {
  let t = Date.UTC(2026, 9, 13);
  return () => new Date((t += 1000));
};

type RunOptions = {
  fetch: unknown;
  storage: Storage | null;
  base?: string;
  /** 기본은 마이크로태스크에 저장한다(테스트가 300ms를 기다리지 않게). */
  schedule?: (flush: () => void) => void;
  onLeave?: (flush: () => void) => () => void;
  maxChars?: number;
};

const run = <A>(
  options: RunOptions,
  use: (lookup: (typeof RouteLookup)['Service']) => Effect.Effect<A, RouteLookupError>,
) =>
  Effect.gen(function* () {
    const out = yield* use(yield* RouteLookup);
    // 모아 둔 저장이 끝난 뒤 저장소를 확인한다.
    yield* settle;
    return out;
  }).pipe(
    Effect.provide(
      RouteLookup.layerWith({
        fetch: options.fetch as typeof fetch,
        storage: options.storage,
        base: options.base,
        now: clock(),
        schedule: options.schedule ?? ((flush) => queueMicrotask(flush)),
        onLeave: options.onLeave,
        maxChars: options.maxChars,
      }),
    ),
  );

/** 마이크로태스크에 예약된 저장이 돌 때까지 기다린다. */
const settle = Effect.promise(() => new Promise<void>((r) => setTimeout(r, 0)));

const leg = (mode: RouteMode, from: Pt, to: Pt, refresh?: boolean) => (l: RouteLookup['Service']) =>
  l.leg(mode, from, to, refresh === undefined ? undefined : { refresh });

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

describe('RouteLookup 요청', () => {
  it.effect('GET /api/route 에 모드와 경도,위도를 소수 5자리로 보낸다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => json(result()));
      const got = yield* run({ fetch: fetchFn, storage: null, base: 'https://x.test' }, (l) =>
        l.leg('car', A, B),
      );
      expect(got).toEqual({ ...result(), seq: 1, fresh: false });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledWith(
        'https://x.test/api/route?mode=car&from=127.00000,37.50000&to=127.05000,37.52000',
        { signal: expect.any(AbortSignal) },
      );
    }),
  );

  it.effect('직선 10m 미만이면 요청하지 않고 거리 0·시간 0으로 답한다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => json(result()));
      const near: Pt = [A[0] + 0.00005, A[1]]; // 약 4m
      const car = yield* run({ fetch: fetchFn, storage: null }, leg('car', A, near));
      const walk = yield* run({ fetch: fetchFn, storage: null }, leg('walk', A, A));
      expect(fetchFn).not.toHaveBeenCalled();
      expect(car).toMatchObject({ mode: 'car', distanceM: 0, durationS: 0, tollFare: 0 });
      expect(car.path).toEqual([A, near]);
      expect(walk).toMatchObject({ mode: 'walk', distanceM: 0, durationS: 0, tollFare: null });
      expect(Number.isNaN(Date.parse(car.queriedAt))).toBe(false);
    }),
  );
});

describe('RouteLookup 캐시', () => {
  it.effect('캐시에 있으면 fetch를 부르지 않고, 저장소에도 남는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi.fn(async () => json(result()));
      const [first, second] = yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          return [yield* l.leg('car', A, B), yield* l.leg('car', A, B)] as const;
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
      const key = routeInputKey({ mode: 'car', from: A, to: B });
      expect(Object.keys(readDoc(storage).entries)).toEqual([key]);
    }),
  );

  it.effect('새 레이어도 저장소의 캐시를 읽는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi.fn(async () => json(result()));
      yield* run({ fetch: fetchFn, storage }, leg('car', A, B));
      const again = yield* run({ fetch: fetchFn, storage }, leg('car', A, B));
      expect(fetchFn).toHaveBeenCalledTimes(1);
      // 저장소에서 읽은 캐시는 번호 0(새 레이어의 어떤 요청보다 먼저).
      expect(again).toEqual({ ...result(), seq: 0, fresh: false });
    }),
  );

  it.effect('refresh면 캐시를 건너뛰고 다시 요청해 결과를 덮어쓴다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi
        .fn()
        .mockImplementationOnce(async () => json(result({ durationS: 600 })))
        .mockImplementationOnce(async () => json(result({ durationS: 900 })));
      const [fresh, after] = yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          yield* l.leg('car', A, B);
          const refreshed = yield* l.leg('car', A, B, { refresh: true });
          return [refreshed, yield* l.leg('car', A, B)] as const;
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(2);
      // 보통 요청은 엣지 캐시를 쓰고, refresh는 `fresh=1`로 엣지 캐시도 건너뛰게 한다(스펙 §4.2).
      expect(fetchFn.mock.calls.map(([url]) => String(url))).toEqual([
        '/api/route?mode=car&from=127.00000,37.50000&to=127.05000,37.52000',
        '/api/route?mode=car&from=127.00000,37.50000&to=127.05000,37.52000&fresh=1',
      ]);
      expect(fresh.durationS).toBe(900);
      expect(after.durationS).toBe(900);
      expect(Object.values(readDoc(storage).entries)[0]?.durationS).toBe(900);
    }),
  );

  it.effect('캐시에서 읽으면 usedAt이 새로워진다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi.fn(async () => json(result()));
      yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          yield* l.leg('car', A, B);
          yield* settle;
          const before = Object.values(readDoc(storage).entries)[0]?.usedAt ?? '';
          expect(before).not.toBe('');
          yield* l.leg('car', A, B);
          // 읽기로 인한 저장도 모아서 한다.
          yield* settle;
          const after = Object.values(readDoc(storage).entries)[0]?.usedAt ?? '';
          expect(after > before).toBe(true);
        }),
      );
    }),
  );

  it.effect('500개를 넘기면 가장 오래 안 쓴 것부터 지운다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const entries: StoredDoc['entries'] = {};
      const target = (i: number): Pt => [126 + i * 0.001, 37.5];
      for (let i = 0; i < 500; i += 1) {
        const key = routeInputKey({ mode: 'car', from: A, to: target(i) });
        entries[key] = {
          ...result(),
          usedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        };
      }
      storage.setItem(ROUTE_CACHE_KEY, JSON.stringify({ entries }));
      const fetchFn = vi.fn(async () => json(result()));
      // 가장 오래된 0번을 읽어 최신으로 만든 뒤 새 항목을 넣으면 1번이 지워진다.
      yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          yield* l.leg('car', A, target(0));
          yield* l.leg('car', A, B);
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const saved = readDoc(storage).entries;
      expect(Object.keys(saved)).toHaveLength(500);
      expect(saved[routeInputKey({ mode: 'car', from: A, to: target(0) })]).toBeDefined();
      expect(saved[routeInputKey({ mode: 'car', from: A, to: target(1) })]).toBeUndefined();
      expect(saved[routeInputKey({ mode: 'car', from: A, to: B })]).toBeDefined();
    }),
  );

  it.effect('쓰기가 용량 초과면 오래된 절반을 지우고 한 번 더 쓴다', () =>
    Effect.gen(function* () {
      const old = (i: number) => ({
        ...result(),
        usedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      });
      const entries: StoredDoc['entries'] = {};
      for (let i = 0; i < 10; i += 1) {
        entries[routeInputKey({ mode: 'car', from: A, to: [126 + i * 0.01, 37.5] })] = old(i);
      }
      const seed = JSON.stringify({ entries });
      // 시드 문서보다 조금 큰 한도: 11개째는 넘고 절반을 지우면 들어간다.
      const storage = new QuotaStorage(seed.length + 50);
      storage.items.set(ROUTE_CACHE_KEY, seed);
      const fetchFn = vi.fn(async () => json(result()));
      yield* run({ fetch: fetchFn, storage }, leg('car', A, B));
      const saved = readDoc(storage).entries;
      const keys = Object.keys(saved);
      expect(keys.length).toBeLessThan(11);
      expect(keys).toContain(routeInputKey({ mode: 'car', from: A, to: B }));
      // 가장 오래된 것이 먼저 사라진다
      expect(keys).not.toContain(routeInputKey({ mode: 'car', from: A, to: [126, 37.5] }));
    }),
  );

  it.effect('두 번째 쓰기도 실패하면 메모리에만 두고, 화면은 계속 동작한다', () =>
    Effect.gen(function* () {
      const storage = new QuotaStorage(0);
      const fetchFn = vi.fn(async () => json(result()));
      const got = yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          const first = yield* l.leg('car', A, B);
          const second = yield* l.leg('car', A, B);
          expect(second).toEqual(first);
          yield* settle;
          // 처음 쓰기는 실패 → 절반 삭제 → 재시도 실패로 두 번 시도하고, 그 뒤로는 저장소에 쓰지 않는다.
          const writesAtFallback = storage.writes;
          expect(writesAtFallback).toBe(2);
          for (const lng of [127.1, 127.2, 127.3]) yield* l.leg('car', A, [lng, 37.5]);
          yield* settle;
          expect(storage.writes).toBe(writesAtFallback);
          return first;
        }),
      );
      expect(got).toEqual({ ...result(), seq: 1, fresh: false });
      expect(fetchFn).toHaveBeenCalledTimes(4);
      expect(storage.items.has(ROUTE_CACHE_KEY)).toBe(false);
    }),
  );

  it.effect('저장소가 없으면(null) 메모리 캐시만 쓴다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => json(result()));
      yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.andThen(l.leg('car', A, B), l.leg('car', A, B)),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect.each([
    ['JSON이 아님', '{not json'],
    ['entries가 없음', JSON.stringify({ foo: 1 })],
    ['entries가 배열', JSON.stringify({ entries: [1, 2] })],
  ])('저장 값이 깨졌으면(%s) 비우고 시작한다', ([, raw]) =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(ROUTE_CACHE_KEY, raw as string);
      const fetchFn = vi.fn(async () => json(result()));
      const got = yield* run({ fetch: fetchFn, storage }, leg('car', A, B));
      expect(got).toEqual({ ...result(), seq: 1, fresh: false });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(Object.keys(readDoc(storage).entries)).toHaveLength(1);
    }),
  );

  it.effect('모양이 틀린 항목은 버리고 나머지는 쓴다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const good = routeInputKey({ mode: 'car', from: A, to: B });
      const other: Pt = [127.2, 37.5];
      const bad = routeInputKey({ mode: 'car', from: A, to: other });
      storage.setItem(
        ROUTE_CACHE_KEY,
        JSON.stringify({
          entries: {
            [good]: { ...result(), usedAt: '2026-10-01T00:00:00.000Z' },
            // 요청하는 키 아래에 모양이 틀린 값이 있다: 검증이 없으면 이 값이 그대로 나온다.
            [bad]: { distanceM: 'x', usedAt: '2026-10-01T00:00:00.000Z' },
          },
        }),
      );
      const fetchFn = vi.fn(async () => json(result({ durationS: 777 })));
      const [kept, refetched] = yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          return [yield* l.leg('car', A, B), yield* l.leg('car', A, other)] as const;
        }),
      );
      expect(kept).toEqual({ ...result(), seq: 0, fresh: false });
      expect(refetched.durationS).toBe(777);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }),
  );
});

describe('RouteLookup 캐시 저장 공간', () => {
  /** 예약된 저장을 손으로 돌리는 스케줄러. */
  const manualSchedule = () => {
    const queued: (() => void)[] = [];
    return {
      schedule: (flush: () => void) => void queued.push(flush),
      runAll: () => queued.splice(0).forEach((flush) => flush()),
      get size() {
        return queued.length;
      },
    };
  };
  const to = (i: number): Pt => [127.1 + i * 0.01, 37.5];

  it.effect('새로 받은 구간 여러 개를 한 번에 모아 저장한다', () =>
    Effect.gen(function* () {
      const storage = new QuotaStorage(Number.MAX_SAFE_INTEGER);
      const timer = manualSchedule();
      const fetchFn = vi.fn(async () => json(result()));
      yield* run({ fetch: fetchFn, storage, schedule: timer.schedule }, (l) =>
        Effect.gen(function* () {
          for (const i of [0, 1, 2]) yield* l.leg('car', A, to(i));
          yield* l.leg('car', A, to(0)); // 캐시 읽기도 같은 저장에 모인다
          return null;
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(storage.writes).toBe(0);
      expect(timer.size).toBe(1);
      timer.runAll();
      expect(storage.writes).toBe(1);
      expect(Object.keys(readDoc(storage).entries)).toHaveLength(3);
    }),
  );

  it.effect('기본 지연은 300ms다', () =>
    Effect.sync(() => {
      expect(ROUTE_PERSIST_DELAY_MS).toBe(300);
    }),
  );

  it.effect('페이지를 떠나면 기다리던 저장을 바로 하고, 예약된 저장은 다시 쓰지 않는다', () =>
    Effect.gen(function* () {
      const storage = new QuotaStorage(Number.MAX_SAFE_INTEGER);
      const timer = manualSchedule();
      let leave = () => {};
      const fetchFn = vi.fn(async () => json(result()));
      yield* run(
        {
          fetch: fetchFn,
          storage,
          schedule: timer.schedule,
          onLeave: (flush) => {
            leave = flush;
            return () => {};
          },
        },
        leg('car', A, B),
      );
      expect(storage.writes).toBe(0);
      leave();
      expect(storage.writes).toBe(1);
      expect(Object.keys(readDoc(storage).entries)).toHaveLength(1);
      timer.runAll();
      expect(storage.writes).toBe(1);
    }),
  );

  it.effect('경로선 좌표는 소수 5자리로 줄여 저장한다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const path: Pt[] = [
        [127.123456789, 37.987654321],
        [127.000004999, 37.500005001],
      ];
      const fetchFn = vi.fn(async () => json(result({ path })));
      yield* run({ fetch: fetchFn, storage }, leg('car', A, B));
      const saved = Object.values(readDoc(storage).entries)[0]!;
      expect(saved.path).toEqual([
        [127.12346, 37.98765],
        [127, 37.50001],
      ]);
    }),
  );

  it.effect('문서가 글자 수 한도를 넘으면 오래 안 쓴 것부터 지운다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const entries: StoredDoc['entries'] = {};
      for (let i = 0; i < 20; i += 1) {
        entries[routeInputKey({ mode: 'car', from: A, to: to(i) })] = {
          ...result(),
          usedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        };
      }
      const seed = JSON.stringify({ entries });
      storage.setItem(ROUTE_CACHE_KEY, seed);
      const maxChars = Math.floor(seed.length / 2);
      const fetchFn = vi.fn(async () => json(result()));
      yield* run({ fetch: fetchFn, storage, maxChars }, leg('car', A, B));
      const raw = storage.getItem(ROUTE_CACHE_KEY)!;
      expect(raw.length).toBeLessThanOrEqual(maxChars);
      const keys = Object.keys(readDoc(storage).entries);
      expect(keys).toContain(routeInputKey({ mode: 'car', from: A, to: B }));
      expect(keys).not.toContain(routeInputKey({ mode: 'car', from: A, to: to(0) }));
      expect(keys).toContain(routeInputKey({ mode: 'car', from: A, to: to(19) }));
    }),
  );

  it('listenPageLeave: pagehide와 숨김(visibilitychange)에 flush를 부르고, 돌려준 함수로 뗀다', () => {
    const flush = vi.fn();
    const stop = listenPageLeave(flush);
    window.dispatchEvent(new Event('pagehide'));
    expect(flush).toHaveBeenCalledTimes(1);

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(flush).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(flush).toHaveBeenCalledTimes(2);

    stop();
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(flush).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it.effect('Layer의 scope가 닫히면 페이지 이탈 리스너를 뗀다', () =>
    Effect.gen(function* () {
      const winAdd = vi.spyOn(window, 'addEventListener');
      const winRemove = vi.spyOn(window, 'removeEventListener');
      const docAdd = vi.spyOn(document, 'addEventListener');
      const docRemove = vi.spyOn(document, 'removeEventListener');
      const countOf = (spy: typeof winAdd, type: string) =>
        spy.mock.calls.filter((call) => call[0] === type);
      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* RouteLookup;
            expect(countOf(winAdd, 'pagehide')).toHaveLength(1);
            expect(countOf(docAdd, 'visibilitychange')).toHaveLength(1);
            expect(countOf(winRemove, 'pagehide')).toHaveLength(0);
          }).pipe(
            Effect.provide(
              RouteLookup.layerWith({
                fetch: vi.fn() as never,
                storage: null,
                onLeave: listenPageLeave,
              }),
            ),
          ),
        );
        const added = countOf(winAdd, 'pagehide')[0]![1];
        const removed = countOf(winRemove, 'pagehide');
        expect(removed).toHaveLength(1);
        expect(removed[0]![1]).toBe(added);
        const docAdded = countOf(docAdd, 'visibilitychange')[0]![1];
        const docRemoved = countOf(docRemove, 'visibilitychange');
        expect(docRemoved).toHaveLength(1);
        expect(docRemoved[0]![1]).toBe(docAdded);
      } finally {
        winAdd.mockRestore();
        winRemove.mockRestore();
        docAdd.mockRestore();
        docRemove.mockRestore();
      }
    }),
  );
});

describe('RouteLookup 동시 요청', () => {
  it.effect('같은 키가 진행 중이면 요청을 합친다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return json(result());
      });
      const [a, b] = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.all([l.leg('car', A, B), l.leg('car', A, B)], { concurrency: 'unbounded' }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    }),
  );

  it.effect('refresh 호출은 진행 중인 보통 요청에 합쳐지지 않고 fresh=1로 따로 보낸다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      // 보통 요청은 엣지 캐시의 오래된 답(600초)을, refresh는 새 답(900초)을 받는다.
      const fetchFn = vi.fn(async (url: unknown) => {
        const fresh = String(url).includes('fresh=1');
        await new Promise((r) => setTimeout(r, fresh ? 10 : 5));
        return json(result({ durationS: fresh ? 900 : 600 }));
      });
      const [plain, refreshed] = yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.all([l.leg('car', A, B), l.leg('car', A, B, { refresh: true })], {
          concurrency: 'unbounded',
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(fetchFn.mock.calls.map(([url]) => String(url).includes('fresh=1'))).toEqual([
        false,
        true,
      ]);
      expect(plain.durationS).toBe(600);
      expect(refreshed.durationS).toBe(900);
      // 나중에 끝난 refresh 결과가 캐시에 남는다.
      expect(Object.values(readDoc(storage).entries)[0]?.durationS).toBe(900);
    }),
  );

  describe('보통 요청과 refresh가 엇갈려 끝날 때', () => {
    // 보통 요청은 엣지 캐시의 오래된 답(600초, 00:00)을, refresh는 새 답(900초, 00:05)을 받는다.
    const STALE = { durationS: 600, queriedAt: '2026-10-13T00:00:00.000Z' };
    const NEWER = { durationS: 900, queriedAt: '2026-10-13T00:05:00.000Z' };

    /** 응답 시점을 테스트가 정한다: `finish('plain' | 'fresh')`를 불러야 해당 요청이 응답한다. */
    const heldFetch = () => {
      const gates: Record<'plain' | 'fresh', (() => void) | null> = { plain: null, fresh: null };
      const fetchFn = vi.fn(
        (url: unknown) =>
          new Promise<Response>((resolve) => {
            const fresh = String(url).includes('fresh=1');
            gates[fresh ? 'fresh' : 'plain'] = () => resolve(json(result(fresh ? NEWER : STALE)));
          }),
      );
      const finish = (which: 'plain' | 'fresh') =>
        Effect.gen(function* () {
          yield* settle;
          gates[which]?.();
          yield* settle;
        });
      return { fetchFn, finish };
    };

    it.effect('refresh가 먼저 끝나고 오래된 보통 응답이 늦게 와도 캐시와 반환값은 새 값이다', () =>
      Effect.gen(function* () {
        const storage = createMemoryStorage();
        const { fetchFn, finish } = heldFetch();
        const [plain, refreshed, later] = yield* run({ fetch: fetchFn, storage }, (l) =>
          Effect.gen(function* () {
            const [plain, refreshed] = yield* Effect.all(
              [
                l.leg('car', A, B),
                l.leg('car', A, B, { refresh: true }),
                Effect.andThen(finish('fresh'), finish('plain')),
              ],
              { concurrency: 'unbounded' },
            );
            return [plain, refreshed, yield* l.leg('car', A, B)] as const;
          }),
        );
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(refreshed.durationS).toBe(900);
        // 늦게 온 오래된 응답을 받은 보통 호출도 캐시에 남은 새 값을 돌려준다.
        expect(plain.durationS).toBe(900);
        expect(plain.queriedAt).toBe(NEWER.queriedAt);
        // 이후 읽기(캐시)도 새 값이고, 서버에 다시 묻지 않는다.
        expect(later.durationS).toBe(900);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(Object.values(readDoc(storage).entries)).toMatchObject([
          { durationS: 900, queriedAt: NEWER.queriedAt },
        ]);
      }),
    );

    it.effect('보통 응답이 먼저 끝나고 refresh가 나중에 끝나면 refresh 값으로 바뀐다', () =>
      Effect.gen(function* () {
        const storage = createMemoryStorage();
        const { fetchFn, finish } = heldFetch();
        const [plain, refreshed, later] = yield* run({ fetch: fetchFn, storage }, (l) =>
          Effect.gen(function* () {
            const [plain, refreshed] = yield* Effect.all(
              [
                l.leg('car', A, B),
                l.leg('car', A, B, { refresh: true }),
                Effect.andThen(finish('plain'), finish('fresh')),
              ],
              { concurrency: 'unbounded' },
            );
            return [plain, refreshed, yield* l.leg('car', A, B)] as const;
          }),
        );
        expect(plain.durationS).toBe(600);
        expect(refreshed.durationS).toBe(900);
        expect(later.durationS).toBe(900);
        expect(Object.values(readDoc(storage).entries)).toMatchObject([
          { durationS: 900, queriedAt: NEWER.queriedAt },
        ]);
      }),
    );

    it.effect('조회 시각을 읽을 수 없으면 들어온 값이 이긴다(기존 동작)', () =>
      Effect.gen(function* () {
        const storage = createMemoryStorage();
        const bodies = [
          result({ durationS: 900, queriedAt: NEWER.queriedAt }),
          result({ durationS: 600, queriedAt: '읽을 수 없는 시각' }),
        ];
        const fetchFn = vi.fn(async () => json(bodies.shift()));
        const second = yield* run({ fetch: fetchFn, storage }, (l) =>
          Effect.gen(function* () {
            yield* l.leg('car', A, B);
            return yield* l.leg('car', A, B, { refresh: true });
          }),
        );
        expect(second.durationS).toBe(600);
        expect(Object.values(readDoc(storage).entries)[0]?.durationS).toBe(600);
      }),
    );
  });

  it.effect('refresh끼리는 진행 중인 요청을 나눠 쓴다', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return json(result());
      });
      const [a, b] = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.all([l.leg('car', A, B, { refresh: true }), l.leg('car', A, B, { refresh: true })], {
          concurrency: 'unbounded',
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('fresh=1');
      expect(a).toEqual(b);
    }),
  );

  it.effect('서로 다른 6개를 동시에 부르면 진행 중인 요청은 최대 4개', () =>
    Effect.gen(function* () {
      let inFlight = 0;
      let peak = 0;
      const fetchFn = vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return json(result());
      });
      const targets: Pt[] = Array.from({ length: 6 }, (_, i) => [127.02 + i * 0.01, 37.5]);
      yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.all(
          targets.map((t) => l.leg('car', A, t)),
          { concurrency: 'unbounded' },
        ),
      );
      expect(fetchFn).toHaveBeenCalledTimes(6);
      expect(peak).toBe(4);
    }),
  );
});

describe('RouteLookup 오류', () => {
  const failure = (fetchFn: unknown) =>
    run({ fetch: fetchFn, storage: null }, leg('car', A, B)).pipe(Effect.flip);

  it.effect('NO_ROUTE 404 본문을 그대로 돌려주고 캐시하지 않는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi.fn(async () => json(errorBody('NO_ROUTE'), 404));
      const error = yield* run({ fetch: fetchFn, storage }, leg('car', A, B)).pipe(Effect.flip);
      expect(error).toBeInstanceOf(RouteLookupError);
      expect(error.code).toBe('NO_ROUTE');
      expect(storage.getItem(ROUTE_CACHE_KEY)).toBeNull();
    }),
  );

  it.effect.each([
    ['BAD_REQUEST', 400, 'BAD_REQUEST'],
    ['UPSTREAM_ERROR', 502, 'UPSTREAM_ERROR'],
    ['TIMEOUT', 504, 'TIMEOUT'],
    ['FORBIDDEN_ORIGIN', 403, 'FORBIDDEN_ORIGIN'],
    ['NOT_FOUND', 404, 'UPSTREAM_ERROR'],
    ['SOMETHING_NEW', 500, 'UPSTREAM_ERROR'],
  ] as const)('서버 코드 %s(HTTP %i)는 %s로 옮긴다', ([code, status, expected]) =>
    Effect.gen(function* () {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = yield* failure(vi.fn(async () => json(errorBody(code), status)));
      expect(error.code).toBe(expected);
    }),
  );

  it.effect('HTML 응답은 OFFLINE이고 경고는 처음 한 번만 낸다', () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fetchFn = vi.fn(async () => new Response('<!doctype html><html></html>'));
      const codes = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.gen(function* () {
          const first = yield* Effect.flip(l.leg('car', A, B));
          const second = yield* Effect.flip(l.leg('car', A, [127.2, 37.5]));
          return [first.code, second.code];
        }).pipe(
          Effect.catch((e) => (e instanceof RouteLookupError ? Effect.fail(e) : Effect.die(e))),
        ),
      );
      expect(codes).toEqual(['OFFLINE', 'OFFLINE']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toBe('경로 서버에 연결하지 못했어요(로컬이면 yarn dev:full)');
    }),
  );

  it.effect('error 본문 없는 404와 네트워크 실패도 OFFLINE', () =>
    Effect.gen(function* () {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const notFound = yield* failure(
        vi.fn(async () => new Response('Not found', { status: 404 })),
      );
      const network = yield* failure(
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      );
      expect(notFound.code).toBe('OFFLINE');
      expect(network.code).toBe('OFFLINE');
    }),
  );

  it.effect('5xx HTML은 UPSTREAM_ERROR(경고 없음)', () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = yield* failure(
        vi.fn(async () => new Response('<html>oops</html>', { status: 502 })),
      );
      expect(error.code).toBe('UPSTREAM_ERROR');
      expect(warn).not.toHaveBeenCalled();
    }),
  );

  it.effect('성공 본문의 모양이 틀리면 UPSTREAM_ERROR이고 캐시하지 않는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi.fn(async () => json({ distanceM: 'x' }));
      const error = yield* run({ fetch: fetchFn, storage }, leg('car', A, B)).pipe(Effect.flip);
      expect(error.code).toBe('UPSTREAM_ERROR');
      expect(storage.getItem(ROUTE_CACHE_KEY)).toBeNull();
    }),
  );

  it.effect('12초 안에 응답이 없으면 TIMEOUT이고, 대기 칸과 진행 중 표가 풀린다', () =>
    Effect.gen(function* () {
      const fetchFn = vi
        .fn()
        .mockImplementation(() => new Promise<Response>(() => {})) // 응답이 오지 않는다
        .mockImplementationOnce(() => new Promise<Response>(() => {}))
        .mockImplementationOnce(() => new Promise<Response>(() => {}))
        .mockImplementationOnce(() => new Promise<Response>(() => {}))
        .mockImplementationOnce(() => new Promise<Response>(() => {}))
        .mockImplementationOnce(async () => json(result()));
      const targets: Pt[] = Array.from({ length: 4 }, (_, i) => [127.02 + i * 0.01, 37.5]);
      const outcome = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.gen(function* () {
          const hung = yield* Effect.all(
            targets.map((t) => Effect.flip(l.leg('car', A, t)).pipe(Effect.forkChild)),
          );
          for (let i = 0; i < 5; i += 1) yield* Effect.yieldNow;
          expect(fetchFn).toHaveBeenCalledTimes(4);
          yield* TestClock.adjust('11999 millis');
          expect(hung[0]?.pollUnsafe()).toBeUndefined();
          yield* TestClock.adjust('1 millis');
          const errors = yield* Effect.all(hung.map((f) => Fiber.join(f)));
          // 같은 키를 다시 부르면 진행 중 표에 남아 있지 않아 새로 요청한다.
          const retry = yield* l.leg('car', A, targets[0] as Pt);
          return { codes: errors.map((e) => e.code), retry };
        }).pipe(
          Effect.catch((e) => (e instanceof RouteLookupError ? Effect.fail(e) : Effect.die(e))),
        ),
      );
      expect(outcome.codes).toEqual(['TIMEOUT', 'TIMEOUT', 'TIMEOUT', 'TIMEOUT']);
      expect(outcome.retry).toEqual({ ...result(), seq: 5, fresh: false });
      expect(fetchFn).toHaveBeenCalledTimes(5);
    }),
  );

  it.effect(
    `본문을 받는 중에 12초가 지나도 TIMEOUT이고 그 요청을 끊어, 받는 중인 전송이 ${ROUTE_MAX_CONCURRENT}개를 넘지 않는다`,
    () =>
      Effect.gen(function* () {
        // 머리는 오고 본문은 끝나지 않는 응답. 실제 fetch처럼 signal이 끊기면 본문 읽기도 실패한다.
        const signals: AbortSignal[] = [];
        const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
          const signal = init!.signal!;
          signals.push(signal);
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"mode":'));
              signal.addEventListener('abort', () => controller.error(signal.reason));
            },
          });
          return new Response(body, { status: 200 });
        });
        const transferring = () => signals.filter((s) => !s.aborted).length;
        // 칸 수보다 하나 더 부른다. 마지막 하나는 칸이 풀릴 때까지 기다린다.
        const targets: Pt[] = Array.from({ length: ROUTE_MAX_CONCURRENT + 1 }, (_, i) => [
          127.02 + i * 0.01,
          37.5,
        ]);
        const outcome = yield* run({ fetch: fetchFn, storage: null }, (l) =>
          Effect.gen(function* () {
            const legs = yield* Effect.all(
              targets.map((t) => Effect.flip(l.leg('car', A, t)).pipe(Effect.forkChild)),
            );
            yield* settle;
            const before = { calls: fetchFn.mock.calls.length, transferring: transferring() };
            yield* TestClock.adjust(`${ROUTE_TIMEOUT_MS} millis`);
            const errors = yield* Effect.all(
              legs.slice(0, ROUTE_MAX_CONCURRENT).map((f) => Fiber.join(f)),
            );
            const aborted = signals.slice(0, ROUTE_MAX_CONCURRENT).map((s) => s.aborted);
            // 칸이 풀려 기다리던 요청이 나가도 끊지 않은 전송은 칸 수를 넘지 않는다.
            yield* settle;
            const afterQueued = { calls: fetchFn.mock.calls.length, transferring: transferring() };
            yield* TestClock.adjust(`${ROUTE_TIMEOUT_MS} millis`);
            const queuedError = yield* Fiber.join(legs[ROUTE_MAX_CONCURRENT]!);
            return {
              before,
              errors: errors.map((e) => e.code),
              aborted,
              afterQueued,
              queuedError,
            };
          }).pipe(
            Effect.catch((e) => (e instanceof RouteLookupError ? Effect.fail(e) : Effect.die(e))),
          ),
        );
        expect(outcome.before).toEqual({
          calls: ROUTE_MAX_CONCURRENT,
          transferring: ROUTE_MAX_CONCURRENT,
        });
        expect(outcome.errors).toEqual(Array(ROUTE_MAX_CONCURRENT).fill('TIMEOUT'));
        expect(outcome.aborted).toEqual(Array(ROUTE_MAX_CONCURRENT).fill(true));
        expect(outcome.afterQueued).toEqual({ calls: ROUTE_MAX_CONCURRENT + 1, transferring: 1 });
        expect(outcome.queuedError.code).toBe('TIMEOUT');
        expect(signals[ROUTE_MAX_CONCURRENT]?.aborted).toBe(true);
      }),
  );

  it.effect('실패한 요청은 진행 중 표에서 빠져 다시 시도할 수 있다', () =>
    Effect.gen(function* () {
      const fetchFn = vi
        .fn()
        .mockImplementationOnce(async () => json(errorBody('UPSTREAM_ERROR'), 502))
        .mockImplementationOnce(async () => json(result()));
      const outcome = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.gen(function* () {
          const first = yield* Effect.flip(l.leg('car', A, B));
          return { first: first.code, second: yield* l.leg('car', A, B) };
        }).pipe(
          Effect.catch((e) => (e instanceof RouteLookupError ? Effect.fail(e) : Effect.die(e))),
        ),
      );
      expect(outcome.first).toBe('UPSTREAM_ERROR');
      expect(outcome.second).toEqual({ ...result(), seq: 2, fresh: false });
    }),
  );
});

describe('RouteLookup 순서 번호(seq)', () => {
  // 화면은 같은 구간의 답이 엇갈려 와도 나중에 *시작한 요청*의 답을 지킨다. 그 순서는 서버 요청이
  // 실제로 시작될 때 매기고, 그 요청에 합류한 호출·그 요청이 남긴 캐시도 같은 번호를 받는다.
  const C: Pt = [127.2, 37.5];

  /** 응답을 테스트가 정한다: 요청마다 `answer(n, 응답)`을 불러야 n번째 요청이 응답한다. */
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

  it.effect('서버 요청마다 1부터 하나씩 올라가고, 실패에도 그 요청의 번호가 붙는다', () =>
    Effect.gen(function* () {
      const fetchFn = vi
        .fn()
        .mockImplementationOnce(async () => json(result()))
        .mockImplementationOnce(async () => json(errorBody('NO_ROUTE'), 404))
        .mockImplementationOnce(async () => json(result({ durationS: 900 })));
      const out = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.gen(function* () {
          const first = yield* l.leg('car', A, B);
          const failed = yield* Effect.flip(l.leg('car', A, C));
          const refreshed = yield* l.leg('car', A, B, { refresh: true });
          return { first: first.seq, failed: [failed.code, failed.seq], refreshed: refreshed.seq };
        }).pipe(
          Effect.catch((e) => (e instanceof RouteLookupError ? Effect.fail(e) : Effect.die(e))),
        ),
      );
      expect(out).toEqual({ first: 1, failed: ['NO_ROUTE', 2], refreshed: 3 });
    }),
  );

  it.effect('진행 중인 요청에 합류한 호출은 그 요청의 번호를 받는다(성공·실패 모두)', () =>
    Effect.gen(function* () {
      const { fetchFn, answer } = gatedFetch();
      const out = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.gen(function* () {
          const [a, b] = yield* Effect.all(
            [l.leg('car', A, B), l.leg('car', A, B), answer(0, json(result()))],
            { concurrency: 'unbounded' },
          );
          const [x, y] = yield* Effect.all(
            [
              Effect.flip(l.leg('car', A, C)),
              Effect.flip(l.leg('car', A, C)),
              answer(1, json(errorBody('NO_ROUTE'), 404)),
            ],
            { concurrency: 'unbounded' },
          );
          return [a.seq, b.seq, x.seq, y.seq];
        }).pipe(
          Effect.catch((e) => (e instanceof RouteLookupError ? Effect.fail(e) : Effect.die(e))),
        ),
      );
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(out).toEqual([1, 1, 2, 2]);
    }),
  );

  it.effect('캐시에서 읽으면 그 캐시를 남긴 요청의 번호를 받는다', () =>
    Effect.gen(function* () {
      const fetchFn = vi
        .fn()
        .mockImplementationOnce(async () => json(result()))
        .mockImplementationOnce(async () => json(result()))
        .mockImplementationOnce(async () => json(result({ durationS: 900 })));
      const out = yield* run({ fetch: fetchFn, storage: null }, (l) =>
        Effect.gen(function* () {
          const first = yield* l.leg('car', A, B); // 요청 1
          const cached = yield* l.leg('car', A, B);
          yield* l.leg('car', A, C); // 요청 2
          yield* l.leg('car', A, B, { refresh: true }); // 요청 3
          const afterRefresh = yield* l.leg('car', A, B);
          return [first.seq, cached.seq, afterRefresh.seq, afterRefresh.durationS];
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(out).toEqual([1, 1, 3, 900]);
    }),
  );

  it.effect('저장소에서 읽은 캐시는 번호 0이고, 번호는 저장하지 않는다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const fetchFn = vi.fn(async () => json(result()));
      const first = yield* run({ fetch: fetchFn, storage }, leg('car', A, B));
      expect(first.seq).toBe(1);
      expect(Object.values(readDoc(storage).entries)[0]).not.toHaveProperty('seq');
      // 새로 연 페이지(새 레이어): 저장된 캐시는 이 세션의 어떤 요청보다 먼저다.
      const reloaded = yield* run({ fetch: fetchFn, storage }, (l) =>
        Effect.gen(function* () {
          const cached = yield* l.leg('car', A, B);
          const next = yield* l.leg('car', A, C);
          return [cached.seq, next.seq];
        }),
      );
      expect(reloaded).toEqual([0, 1]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect('직선 10m 미만(서버에 묻지 않는 답)은 번호 0', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => json(result()));
      const near = yield* run({ fetch: fetchFn, storage: null }, leg('car', A, A));
      expect(near.seq).toBe(0);
      expect(fetchFn).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    '늦게 끝난 먼저 시작한 요청이 캐시의 새 항목을 지키면, 지킨 항목과 그 번호를 돌려준다',
    () =>
      Effect.gen(function* () {
        const { fetchFn, answer } = gatedFetch();
        const [plain, refreshed] = yield* run({ fetch: fetchFn, storage: null }, (l) =>
          Effect.all(
            [
              l.leg('car', A, B), // 요청 1(엣지 캐시의 오래된 답)
              l.leg('car', A, B, { refresh: true }), // 요청 2(새 답)
              Effect.andThen(
                answer(1, json(result({ durationS: 900, queriedAt: '2026-10-13T00:05:00.000Z' }))),
                answer(0, json(result({ durationS: 600, queriedAt: '2026-10-13T00:00:00.000Z' }))),
              ),
            ],
            { concurrency: 'unbounded' },
          ),
        );
        expect(refreshed).toMatchObject({ durationS: 900, seq: 2 });
        expect(plain).toMatchObject({ durationS: 900, seq: 2 });
      }),
  );

  it.effect(
    '다시 계산이 진행 중이면 보통 호출도 그 요청에 합류한다(오래된 답을 새로 시작하지 않는다)',
    () =>
      Effect.gen(function* () {
        const { fetchFn, answer } = gatedFetch();
        const [refreshed, plain] = yield* run({ fetch: fetchFn, storage: null }, (l) =>
          Effect.all(
            [
              l.leg('car', A, B, { refresh: true }),
              Effect.andThen(settle, l.leg('car', A, B)),
              Effect.andThen(settle, answer(0, json(result({ durationS: 900 })))),
            ],
            { concurrency: 'unbounded' },
          ),
        );
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('fresh=1');
        expect(refreshed).toMatchObject({ durationS: 900, seq: 1 });
        expect(plain).toMatchObject({ durationS: 900, seq: 1 });
      }),
  );

  it.effect(
    '답과 오류에 실제로 나간 요청의 종류(fresh)가 붙고, 합류·캐시 읽기도 만든 요청의 값을 받는다',
    () =>
      Effect.gen(function* () {
        const { fetchFn, answer } = gatedFetch();
        const out = yield* run({ fetch: fetchFn, storage: null }, (l) =>
          Effect.gen(function* () {
            // 진행 중인 다시 계산(fresh)에 보통 호출이 합류한다: 부른 쪽은 보통이지만 요청은 fresh다.
            const [refreshed, joined] = yield* Effect.all(
              [
                l.leg('car', A, B, { refresh: true }),
                Effect.andThen(settle, l.leg('car', A, B)),
                Effect.andThen(settle, answer(0, json(result()))),
              ],
              { concurrency: 'unbounded' },
            );
            // 그 요청이 남긴 캐시를 읽은 보통 호출도 fresh를 받는다.
            const cached = yield* l.leg('car', A, B);
            // 보통 요청의 답은 fresh false, 거기 합류한 다시 계산 호출은 따로 fresh 요청을 보낸다.
            const [plain, joinedPlain] = yield* Effect.all(
              [l.leg('car', A, C), l.leg('car', A, C), answer(1, json(result()))],
              { concurrency: 'unbounded' },
            );
            // 실패도 같다: 다시 계산이 실패하면 거기 합류한 보통 호출의 오류도 fresh true다.
            const [failed, joinedFailed] = yield* Effect.all(
              [
                Effect.flip(l.leg('car', B, C, { refresh: true })),
                Effect.flip(Effect.andThen(settle, l.leg('car', B, C))),
                Effect.andThen(settle, answer(2, json(errorBody('NO_ROUTE'), 404))),
              ],
              { concurrency: 'unbounded' },
            );
            const [plainFailed] = yield* Effect.all(
              [Effect.flip(l.leg('car', C, B)), answer(3, json(errorBody('UPSTREAM_ERROR'), 502))],
              { concurrency: 'unbounded' },
            );
            const near = yield* l.leg('car', A, A);
            return {
              refreshed: [refreshed.seq, refreshed.fresh],
              joined: [joined.seq, joined.fresh],
              cached: [cached.seq, cached.fresh],
              plain: [plain.seq, plain.fresh],
              joinedPlain: [joinedPlain.seq, joinedPlain.fresh],
              failed: [failed.seq, failed.fresh],
              joinedFailed: [joinedFailed.seq, joinedFailed.fresh],
              plainFailed: [plainFailed.seq, plainFailed.fresh],
              near: [near.seq, near.fresh],
            };
          }).pipe(
            Effect.catch((e) => (e instanceof RouteLookupError ? Effect.fail(e) : Effect.die(e))),
          ),
        );
        expect(out).toEqual({
          refreshed: [1, true],
          joined: [1, true],
          cached: [1, true],
          plain: [2, false],
          joinedPlain: [2, false],
          failed: [3, true],
          joinedFailed: [3, true],
          plainFailed: [4, false],
          near: [0, false],
        });
      }),
  );
});
