import type { GeolocationApi } from 'src/services/geolocation';

export type FakeCoords = { longitude: number; latitude: number; accuracy: number };
export type FakeErrorCode = 1 | 2 | 3;

type Request = {
  options?: PositionOptions;
  ok: PositionCallback;
  fail: PositionErrorCallback;
};
type Watcher = { ok: PositionCallback; fail: PositionErrorCallback; options?: PositionOptions };

const positionOf = (coords: FakeCoords, timestamp: number): GeolocationPosition =>
  ({
    coords: {
      longitude: coords.longitude,
      latitude: coords.latitude,
      accuracy: coords.accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp,
  }) as unknown as GeolocationPosition;

const errorOf = (code: FakeErrorCode): GeolocationPositionError =>
  ({
    code,
    message: '',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  }) as GeolocationPositionError;

/**
 * 브라우저 위치 API를 흉내 내는 가짜(`GeolocationApi` 모양). 요청을 쌓아 두고,
 * 시험이 `succeed`·`fail`(한 번 묻기)과 `emit`·`emitError`(계속 받기)로 답한다.
 */
export function fakeGeolocation() {
  const requests: Request[] = [];
  const watchers = new Map<number, Watcher>();
  const cleared: number[] = [];
  let nextId = 1;

  const api: GeolocationApi = {
    getCurrentPosition(ok, fail, options) {
      requests.push({ ok, fail, options });
    },
    watchPosition(ok, fail, options) {
      const id = nextId++;
      watchers.set(id, { ok, fail, options });
      return id;
    },
    clearWatch(id) {
      cleared.push(id);
      // 진짜 브라우저처럼 해제한 감시에는 더 알리지 않는다. 다만 시험이 그 뒤 `emit`을
      // 불러도 서비스가 스스로 무시하는지 볼 수 있게 `watchers`에는 남겨 둔다.
    },
  };

  const watcherOf = (id: number): Watcher => {
    const watcher = watchers.get(id);
    if (watcher === undefined) throw new Error(`감시 ${id}번이 없어요`);
    return watcher;
  };
  const requestOf = (index: number): Request => {
    const request = requests[index];
    if (request === undefined) throw new Error(`요청 ${index}번이 없어요`);
    return request;
  };

  return {
    api,
    requests,
    watchers,
    cleared,
    succeed(index: number, coords: FakeCoords, timestamp = 1000): void {
      requestOf(index).ok(positionOf(coords, timestamp));
    },
    fail(index: number, code: FakeErrorCode): void {
      requestOf(index).fail(errorOf(code));
    },
    emit(id: number, coords: FakeCoords, timestamp = 1000): void {
      watcherOf(id).ok(positionOf(coords, timestamp));
    },
    emitError(id: number, code: FakeErrorCode): void {
      watcherOf(id).fail(errorOf(code));
    },
  };
}
