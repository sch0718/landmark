import { ManagedRuntime } from 'effect';
import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest, type AppRuntime } from 'src/lib/effect/runtime';
import { Geolocation } from 'src/services/geolocation';
import { locateAtom, myLocationAtom, nearbyAtom, nearbyOffAtom } from 'src/stores/my-location';
import { fakeGeolocation } from '../helpers/fake-geolocation';

const SOKCHO = { longitude: 128.9003, latitude: 37.7551, accuracy: 30 };
const GANGNEUNG = { longitude: 128.8761, latitude: 37.7519, accuracy: 55 };

let fake: ReturnType<typeof fakeGeolocation>;

beforeEach(() => {
  fake = fakeGeolocation();
  // 이 시험은 위치 서비스만 쓴다. 나머지 서비스는 꺼내 쓰지 않으므로 좁은 런타임을 그대로 넣는다.
  setAppRuntimeForTest(
    ManagedRuntime.make(
      Geolocation.layerWith({ api: fake.api, secure: true }),
    ) as unknown as AppRuntime,
  );
});

afterEach(() => {
  setAppRuntimeForTest(null);
  vi.restoreAllMocks();
});

/** 비동기 효과가 요청을 낼 때까지 마이크로태스크를 비운다. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('초기 상태', () => {
  it('내 위치는 비어 있고 근처 모드는 꺼져 있으며 반경은 3km', () => {
    const store = createStore();
    expect(store.get(myLocationAtom)).toEqual({ fix: null, locating: false, error: null });
    expect(store.get(nearbyAtom)).toEqual({ on: false, radiusM: 3000 });
  });
});

describe('locateAtom', () => {
  it('찾는 동안 locating, 성공하면 fix를 채우고 locating을 끈다', async () => {
    const store = createStore();
    const pending = store.set(locateAtom);
    expect(store.get(myLocationAtom).locating).toBe(true);
    await settle();
    fake.succeed(0, SOKCHO, 5000);
    const result = await pending;
    const fix = { lng: 128.9003, lat: 37.7551, accuracyM: 30, at: 5000 };
    expect(result).toEqual({ kind: 'fix', fix });
    expect(store.get(myLocationAtom)).toEqual({ fix, locating: false, error: null });
  });

  it('실패하면 이전 fix를 두고 error만 채우고, 다음 성공이 error를 지운다', async () => {
    const store = createStore();
    const first = store.set(locateAtom);
    await settle();
    fake.succeed(0, SOKCHO, 5000);
    await first;
    const previous = store.get(myLocationAtom).fix;

    const second = store.set(locateAtom);
    await settle();
    fake.fail(1, 1);
    const failed = await second;
    expect(failed.kind).toBe('error');
    const afterFail = store.get(myLocationAtom);
    expect(afterFail.error?.reason).toBe('denied');
    expect(afterFail.fix).toEqual(previous);
    expect(afterFail.locating).toBe(false);

    const third = store.set(locateAtom);
    await settle();
    fake.succeed(2, GANGNEUNG, 9000);
    await third;
    const afterOk = store.get(myLocationAtom);
    expect(afterOk.error).toBeNull();
    expect(afterOk.fix).toEqual({ lng: 128.8761, lat: 37.7519, accuracyM: 55, at: 9000 });
  });

  it('찾는 중에 또 부르면 새 요청 없이 같은 결과를 돌려준다', async () => {
    const store = createStore();
    const a = store.set(locateAtom);
    const b = store.set(locateAtom);
    await settle();
    expect(fake.requests).toHaveLength(1);
    fake.succeed(0, SOKCHO, 5000);
    const [resultA, resultB] = await Promise.all([a, b]);
    expect(resultB).toBe(resultA);
    // 끝난 뒤에는 새 요청을 낸다.
    const c = store.set(locateAtom);
    await settle();
    expect(fake.requests).toHaveLength(2);
    fake.succeed(1, SOKCHO, 6000);
    await c;
  });

  it('store마다 찾는 중 상태가 따로다', async () => {
    const one = createStore();
    const two = createStore();
    const a = one.set(locateAtom);
    const b = two.set(locateAtom);
    await settle();
    expect(fake.requests).toHaveLength(2);
    fake.fail(0, 3);
    fake.fail(1, 3);
    await Promise.all([a, b]);
    expect(one.get(myLocationAtom).error?.reason).toBe('timeout');
  });

  it('결함(예상 밖 오류)은 console.error 뒤 unavailable로 끝나고 좌표를 찍지 않는다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setAppRuntimeForTest({
      runPromise: () => Promise.reject(new Error('boom')),
    } as unknown as AppRuntime);
    const store = createStore();
    const result = await store.set(locateAtom);
    expect(result.kind).toBe('error');
    expect(store.get(myLocationAtom).error?.reason).toBe('unavailable');
    expect(store.get(myLocationAtom).locating).toBe(false);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('아무것도 저장하지 않는다', async () => {
    const before = localStorage.length;
    const store = createStore();
    const pending = store.set(locateAtom);
    await settle();
    fake.succeed(0, SOKCHO, 5000);
    await pending;
    const failing = store.set(locateAtom);
    await settle();
    fake.fail(1, 2);
    await failing;
    expect(localStorage.length).toBe(before);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('nearbyOffAtom', () => {
  it('on만 끄고 반경과 내 위치는 그대로', async () => {
    const store = createStore();
    const pending = store.set(locateAtom);
    await settle();
    fake.succeed(0, SOKCHO, 5000);
    await pending;
    const fix = store.get(myLocationAtom).fix;
    store.set(nearbyAtom, { on: true, radiusM: 1000 });
    store.set(nearbyOffAtom);
    expect(store.get(nearbyAtom)).toEqual({ on: false, radiusM: 1000 });
    expect(store.get(myLocationAtom).fix).toBe(fix);
  });
});
