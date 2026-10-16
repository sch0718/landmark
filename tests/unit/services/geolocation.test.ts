import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { it as effectIt } from '@effect/vitest';
import { Effect, Exit, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { GeolocationError } from 'src/services/errors';
import {
  CURRENT_OPTIONS,
  Geolocation,
  WATCH_OPTIONS,
  type GeoFix,
  type GeolocationApi,
} from 'src/services/geolocation';
import { fakeGeolocation } from '../helpers/fake-geolocation';

const SOKCHO = { longitude: 128.9003, latitude: 37.7551, accuracy: 30 };
/** 시험 속 기기 시각(epoch ms). 위치 `timestamp`는 이 시각에 비춰 정규화된다. */
const T = Date.parse('2026-10-16T05:05:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * 브라우저가 줄 수 있는 `timestamp`와 서비스가 내놓을 `at`. µs·초 단위, NaN, 미래 값은 받은 때(T)로,
 * 하루 안의 과거 값(캐시 위치)은 그대로 둔다.
 */
const TIMESTAMP_CASES = [
  ['µs 단위', T * 1000, T],
  ['초 단위', T / 1000, T],
  ['NaN', Number.NaN, T],
  ['5초 뒤(미래)', T + 5_000, T],
  ['하루 넘게 전', T - 86_400_001, T],
  ['30초 전(캐시)', T - 30_000, T - 30_000],
  ['딱 하루 전', T - 86_400_000, T - 86_400_000],
] as const;

const service = (api: GeolocationApi | undefined, secure = true) =>
  Geolocation.layerWith({ api, secure });

const current = Effect.gen(function* () {
  const geolocation = yield* Geolocation;
  return yield* geolocation.current;
});

describe('옵션', () => {
  it('current와 watch 옵션 값', () => {
    expect(CURRENT_OPTIONS).toEqual({
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 60_000,
    });
    expect(WATCH_OPTIONS).toEqual({
      enableHighAccuracy: true,
      timeout: 30_000,
      maximumAge: 10_000,
    });
  });
});

describe('GeolocationError.userMessage', () => {
  it('reason마다 정해진 문구', () => {
    expect(new GeolocationError({ reason: 'denied' }).userMessage).toBe(
      '위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 켜 주세요',
    );
    expect(new GeolocationError({ reason: 'unavailable' }).userMessage).toBe(
      '지금은 위치를 알 수 없어요. 잠시 뒤 다시 해 주세요',
    );
    expect(new GeolocationError({ reason: 'timeout' }).userMessage).toBe(
      '위치를 찾는 데 시간이 너무 오래 걸려요. 다시 해 주세요',
    );
    expect(new GeolocationError({ reason: 'unsupported' }).userMessage).toBe(
      '이 브라우저에서는 위치를 쓸 수 없어요',
    );
  });
});

describe('Geolocation.current', () => {
  effectIt.effect('좌표를 GeoFix로 바꾸고 CURRENT_OPTIONS로 묻는다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const fiber = yield* current.pipe(Effect.provide(service(fake.api)), Effect.forkChild);
      yield* Effect.yieldNow;
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]?.options).toBe(CURRENT_OPTIONS);
      fake.succeed(0, SOKCHO, T - 1000);
      expect(yield* Fiber.join(fiber)).toEqual({
        lng: 128.9003,
        lat: 37.7551,
        accuracyM: 30,
        at: T - 1000,
      } satisfies GeoFix);
    }),
  );

  for (const [label, raw, at] of TIMESTAMP_CASES) {
    effectIt.effect(`timestamp ${label} -> at ${at === T ? '받은 때' : '그대로'}`, () =>
      Effect.gen(function* () {
        const fake = fakeGeolocation();
        const fiber = yield* current.pipe(Effect.provide(service(fake.api)), Effect.forkChild);
        yield* Effect.yieldNow;
        fake.succeed(0, SOKCHO, raw);
        expect((yield* Fiber.join(fiber)).at).toBe(at);
      }),
    );
  }

  effectIt.effect('받은 때는 콜백이 불린 때다(요청한 때가 아니다)', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const fiber = yield* current.pipe(Effect.provide(service(fake.api)), Effect.forkChild);
      yield* Effect.yieldNow;
      vi.setSystemTime(T + 7_000);
      fake.succeed(0, SOKCHO, Number.NaN);
      expect((yield* Fiber.join(fiber)).at).toBe(T + 7_000);
    }),
  );

  for (const [code, reason] of [
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const) {
    effectIt.effect(`코드 ${code} -> ${reason}`, () =>
      Effect.gen(function* () {
        const fake = fakeGeolocation();
        const fiber = yield* current.pipe(Effect.provide(service(fake.api)), Effect.forkChild);
        yield* Effect.yieldNow;
        fake.fail(0, code);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        const error = yield* Effect.flip(Fiber.join(fiber));
        expect(error).toBeInstanceOf(GeolocationError);
        expect(error.reason).toBe(reason);
      }),
    );
  }

  effectIt.effect('api가 없으면 unsupported이고 요청하지 않는다', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(current.pipe(Effect.provide(service(undefined))));
      expect(error.reason).toBe('unsupported');
    }),
  );

  effectIt.effect('보안 연결이 아니면 unsupported이고 요청하지 않는다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const error = yield* Effect.flip(current.pipe(Effect.provide(service(fake.api, false))));
      expect(error.reason).toBe('unsupported');
      expect(fake.requests).toHaveLength(0);
    }),
  );

  effectIt.effect('좌표가 숫자가 아니면 unavailable', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const fiber = yield* current.pipe(Effect.provide(service(fake.api)), Effect.forkChild);
      yield* Effect.yieldNow;
      fake.succeed(0, { ...SOKCHO, latitude: Number.NaN });
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error.reason).toBe('unavailable');
    }),
  );

  effectIt.effect('응답이 없으면 앱 쪽 시한 없이 계속 기다린다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const fiber = yield* current.pipe(Effect.provide(service(fake.api)), Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust('60 seconds');
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* Fiber.interrupt(fiber);
    }),
  );

  effectIt.effect('중단한 뒤 온 응답은 무시한다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const fiber = yield* current.pipe(Effect.provide(service(fake.api)), Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      expect(() => fake.succeed(0, SOKCHO)).not.toThrow();
      expect(() => fake.fail(0, 1)).not.toThrow();
    }),
  );
});

const watchWith = (api: GeolocationApi | undefined, secure = true) =>
  Effect.gen(function* () {
    const fixes: GeoFix[] = [];
    const errors: GeolocationError[] = [];
    const geolocation = yield* Geolocation.use((g) => Effect.succeed(g)).pipe(
      Effect.provide(service(api, secure)),
    );
    const stop = geolocation.watch(
      (fix) => fixes.push(fix),
      (error) => errors.push(error),
    );
    return { fixes, errors, stop };
  });

describe('Geolocation.watch', () => {
  effectIt.effect('받을 때마다 onFix를 부르고 WATCH_OPTIONS로 건다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const { fixes, stop } = yield* watchWith(fake.api);
      expect(fake.watchers.get(1)?.options).toBe(WATCH_OPTIONS);
      fake.emit(1, SOKCHO, T - 2000);
      fake.emit(1, { ...SOKCHO, accuracy: 12 }, T - 1000);
      expect(fixes).toEqual([
        { lng: 128.9003, lat: 37.7551, accuracyM: 30, at: T - 2000 },
        { lng: 128.9003, lat: 37.7551, accuracyM: 12, at: T - 1000 },
      ]);
      stop();
    }),
  );

  effectIt.effect('timestamp를 받은 때에 비춰 정규화한다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const { fixes, stop } = yield* watchWith(fake.api);
      for (const [, raw] of TIMESTAMP_CASES) fake.emit(1, SOKCHO, raw);
      expect(fixes.map((fix) => fix.at)).toEqual(TIMESTAMP_CASES.map(([, , at]) => at));
      // 받은 때는 콜백마다 새로 읽는다.
      vi.setSystemTime(T + 7_000);
      fake.emit(1, SOKCHO, Number.NaN);
      expect(fixes.at(-1)?.at).toBe(T + 7_000);
      stop();
    }),
  );

  effectIt.effect('해제 함수는 clearWatch를 한 번만 부른다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const { stop } = yield* watchWith(fake.api);
      stop();
      stop();
      expect(fake.cleared).toEqual([1]);
    }),
  );

  effectIt.effect('timeout 오류 뒤에도 계속 받는다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const { fixes, errors } = yield* watchWith(fake.api);
      fake.emitError(1, 3);
      fake.emit(1, SOKCHO);
      expect(errors.map((error) => error.reason)).toEqual(['timeout']);
      expect(fixes).toHaveLength(1);
      expect(fake.cleared).toEqual([]);
    }),
  );

  effectIt.effect('denied면 스스로 해제하고 그 뒤 콜백은 무시한다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const { fixes, errors, stop } = yield* watchWith(fake.api);
      fake.emitError(1, 1);
      expect(errors.map((error) => error.reason)).toEqual(['denied']);
      expect(fake.cleared).toEqual([1]);
      fake.emit(1, SOKCHO);
      fake.emitError(1, 2);
      expect(fixes).toHaveLength(0);
      expect(errors).toHaveLength(1);
      stop();
      expect(fake.cleared).toEqual([1]);
    }),
  );

  effectIt.effect(
    'api가 없으면 마이크로태스크 뒤 unsupported를 한 번 알리고 해제는 아무것도 안 한다',
    () =>
      Effect.gen(function* () {
        const { errors, stop } = yield* watchWith(undefined);
        expect(errors).toHaveLength(0);
        yield* Effect.promise(() => Promise.resolve());
        expect(errors.map((error) => error.reason)).toEqual(['unsupported']);
        expect(() => stop()).not.toThrow();
        yield* Effect.promise(() => Promise.resolve());
        expect(errors).toHaveLength(1);
      }),
  );

  effectIt.effect('보안 연결이 아니면 unsupported이고 감시를 걸지 않는다', () =>
    Effect.gen(function* () {
      const fake = fakeGeolocation();
      const { errors } = yield* watchWith(fake.api, false);
      yield* Effect.promise(() => Promise.resolve());
      expect(errors.map((error) => error.reason)).toEqual(['unsupported']);
      expect(fake.watchers.size).toBe(0);
    }),
  );
});
