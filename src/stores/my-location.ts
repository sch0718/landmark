import { Effect, Result } from 'effect';
import { atom, type Atom, type PrimitiveAtom, type WritableAtom } from 'jotai';
import { DEFAULT_RADIUS_M, type NearbyRadius } from 'src/domain/nearby';
import { startEffect } from 'src/lib/effect/runtime';
import { GeolocationError } from 'src/services/errors';
import { Geolocation, type GeoFix } from 'src/services/geolocation';

/**
 * 내 위치와 근처 모드는 메모리에만 둔다(스펙 §7). localStorage·URL·백업 어디에도 쓰지 않고,
 * 저장 선호(`LibraryQuery.sort`)에 `가까운 순`을 넣지도 않는다.
 */
export type MyLocationState = {
  fix: GeoFix | null;
  locating: boolean;
  error: GeolocationError | null;
};

const INITIAL: MyLocationState = { fix: null, locating: false, error: null };

const stateAtom: PrimitiveAtom<MyLocationState> = atom<MyLocationState>(INITIAL);

/** 읽기 전용으로 내보낸다. 바꾸는 길은 `locateAtom`뿐이다. */
export const myLocationAtom: Atom<MyLocationState> = atom((get) => get(stateAtom));

export type LocateResult =
  { kind: 'fix'; fix: GeoFix } | { kind: 'error'; error: GeolocationError };

/** 찾는 중인 요청. 모듈 변수가 아니라 atom 상태라 store마다(시험마다) 따로다. */
const inFlightAtom: PrimitiveAtom<Promise<LocateResult> | null> =
  atom<Promise<LocateResult> | null>(null);

const locateOnce = async (): Promise<LocateResult> => {
  try {
    const result = await startEffect(
      Effect.result(
        Effect.gen(function* () {
          return yield* (yield* Geolocation).current;
        }),
      ),
    );
    return Result.isSuccess(result)
      ? { kind: 'fix', fix: result.success }
      : { kind: 'error', error: result.failure };
  } catch (defect) {
    // 프로그램 오류. 좌표가 담길 수 있는 값을 찍지 않고 오류 종류만 남긴다.
    console.error(
      '위치 요청 중 예상 밖 오류',
      defect instanceof Error ? defect.name : typeof defect,
    );
    return { kind: 'error', error: new GeolocationError({ reason: 'unavailable' }) };
  }
};

/**
 * 내 위치를 한 번 찾는다. 찾는 중에 또 부르면 새 요청 없이 진행 중인 Promise를 그대로 돌려준다.
 * 성공하면 `fix`를 바꾸고 `error`를 비운다. 실패하면 `fix`는 이전 값 그대로 두고 `error`만 채운다.
 */
export const locateAtom: WritableAtom<null, [], Promise<LocateResult>> = atom(
  null,
  (get, set): Promise<LocateResult> => {
    const running = get(inFlightAtom);
    if (running !== null) return running;
    set(stateAtom, (prev) => ({ ...prev, locating: true }));
    const promise = locateOnce().then((result) => {
      set(inFlightAtom, null);
      if (result.kind === 'fix') set(stateAtom, { fix: result.fix, locating: false, error: null });
      else set(stateAtom, (prev) => ({ ...prev, locating: false, error: result.error }));
      return result;
    });
    set(inFlightAtom, promise);
    return promise;
  },
);

export type NearbyState = { on: boolean; radiusM: NearbyRadius };

/** `가까운 순` 모드와 반경. 처음엔 꺼져 있고 반경은 기본 3km. */
export const nearbyAtom: PrimitiveAtom<NearbyState> = atom<NearbyState>({
  on: false,
  radiusM: DEFAULT_RADIUS_M,
});

/** 근처 모드만 끈다. 반경과 내 위치는 그대로 둔다(다시 켤 때 이어 쓴다). */
export const nearbyOffAtom: WritableAtom<null, [], void> = atom(null, (_get, set) => {
  set(nearbyAtom, (prev) => ({ ...prev, on: false }));
});
