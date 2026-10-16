import { Context, Effect, Layer } from 'effect';
import { GeolocationError, type GeolocationErrorReason } from 'src/services/errors';

/** 위치 한 번. 좌표(경도, 위도)와 오차 반경(m), 잰 시각(epoch ms). 어디에도 저장·전송하지 않는다. */
export type GeoFix = { lng: number; lat: number; accuracyM: number; at: number };

/** 브라우저 위치 API 중 쓰는 것만 좁게 선언한 구조 타입(DOM의 `Geolocation`과 이름이 겹쳐 따로 둔다). */
export type GeolocationApi = {
  getCurrentPosition(
    ok: PositionCallback,
    fail: PositionErrorCallback,
    options?: PositionOptions,
  ): void;
  watchPosition(
    ok: PositionCallback,
    fail: PositionErrorCallback,
    options?: PositionOptions,
  ): number;
  clearWatch(id: number): void;
};

/** 앱 쪽 시한은 두지 않는다. 브라우저의 `timeout`이 지나면 `timeout` 오류로 끝난다. */
export const CURRENT_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 60_000,
};
export const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 30_000,
  maximumAge: 10_000,
};

const failure = (reason: GeolocationErrorReason) => new GeolocationError({ reason });

const REASON_BY_CODE: Record<number, GeolocationErrorReason> = {
  1: 'denied',
  2: 'unavailable',
  3: 'timeout',
};
const errorOf = (error: GeolocationPositionError): GeolocationError =>
  failure(REASON_BY_CODE[error.code] ?? 'unavailable');

/** 좌표가 유한한 숫자가 아니면 null(→ `unavailable`). */
function fixOf(position: GeolocationPosition): GeoFix | null {
  const { longitude, latitude, accuracy } = position.coords;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(accuracy)) {
    return null;
  }
  return { lng: longitude, lat: latitude, accuracyM: accuracy, at: position.timestamp };
}

/**
 * 내 위치(스펙 §7.2, 약속 C2). 요청은 부르는 쪽이 사용자의 누름에 맞춰서만 한다.
 * `current`는 한 번 묻고, `watch`는 해제 함수를 부를 때까지 계속 받는다.
 * 실패는 `GeolocationError` 값이고 앱 오류 보고자로 보내지 않는다.
 */
export class Geolocation extends Context.Service<
  Geolocation,
  {
    readonly current: Effect.Effect<GeoFix, GeolocationError>;
    watch(onFix: (fix: GeoFix) => void, onError: (error: GeolocationError) => void): () => void;
  }
>()('tripmap/Geolocation') {
  /** `api`가 없거나 `secure`가 거짓(보안 연결 아님)이면 모든 요청이 `unsupported`다. */
  static layerWith(options: {
    api: GeolocationApi | undefined;
    secure: boolean;
  }): Layer.Layer<Geolocation> {
    const { api, secure } = options;
    const usable = secure ? api : undefined;

    const current = Effect.callback<GeoFix, GeolocationError>((resume, signal) => {
      if (usable === undefined) {
        resume(Effect.fail(failure('unsupported')));
        return;
      }
      // 중단된 뒤 온 응답은 버린다.
      try {
        usable.getCurrentPosition(
          (position) => {
            if (signal.aborted) return;
            const fix = fixOf(position);
            resume(fix === null ? Effect.fail(failure('unavailable')) : Effect.succeed(fix));
          },
          (error) => {
            if (signal.aborted) return;
            resume(Effect.fail(errorOf(error)));
          },
          CURRENT_OPTIONS,
        );
      } catch {
        resume(Effect.fail(failure('unavailable')));
      }
    });

    const watch = (
      onFix: (fix: GeoFix) => void,
      onError: (error: GeolocationError) => void,
    ): (() => void) => {
      if (usable === undefined) {
        queueMicrotask(() => onError(failure('unsupported')));
        return () => {};
      }
      let active = true;
      let id: number | undefined;
      const stop = () => {
        if (!active) return;
        active = false;
        if (id !== undefined) usable.clearWatch(id);
      };
      try {
        id = usable.watchPosition(
          (position) => {
            if (!active) return;
            const fix = fixOf(position);
            if (fix === null) onError(failure('unavailable'));
            else onFix(fix);
          },
          (error) => {
            if (!active) return;
            const mapped = errorOf(error);
            // 권한을 거부당하면 더 받을 수 없다. 스스로 거두고 그 뒤 콜백은 무시한다.
            if (mapped.reason === 'denied') stop();
            onError(mapped);
          },
          WATCH_OPTIONS,
        );
      } catch {
        active = false;
        queueMicrotask(() => onError(failure('unavailable')));
        return () => {};
      }
      // 걸자마자 콜백이 동기로 거둔 경우(`id`를 받기 전)를 마저 정리한다.
      if (!active) usable.clearWatch(id);
      return stop;
    };

    return Layer.succeed(Geolocation, Geolocation.of({ current, watch }));
  }

  static readonly layer = Layer.suspend(() =>
    Geolocation.layerWith({
      api: typeof navigator === 'undefined' ? undefined : (navigator.geolocation ?? undefined),
      secure: typeof window !== 'undefined' && window.isSecureContext,
    }),
  );
}
