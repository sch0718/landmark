import { Effect, Layer, ManagedRuntime } from 'effect';
import { withAppErrorReporter } from 'src/lib/effect/error-reporter';
import { IdGen } from 'src/services/id-gen';
import { LegacyTripSource } from 'src/services/legacy-trip-source';
import { LibraryStore } from 'src/services/library-store';
import { PrefsStore } from 'src/services/prefs-store';

/** 앱 서비스 목록. 서비스를 늘리면 여기에 더한다. */
export const AppLayer = Layer.mergeAll(
  LibraryStore.layer,
  PrefsStore.layer,
  IdGen.layer,
  LegacyTripSource.layer,
);

export type AppServices = Layer.Success<typeof AppLayer>;

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, unknown>;

const defaultRuntime = ManagedRuntime.make(AppLayer);
let current: AppRuntime = defaultRuntime;

/** 앱 런타임. 첫 실행 때 Layer를 만든다. */
export const appRuntime = defaultRuntime;

/** 테스트에서 런타임을 바꾼다. `null`이면 기본 런타임으로 되돌린다. */
export function setAppRuntimeForTest(runtime: AppRuntime | null): void {
  current = runtime ?? defaultRuntime;
}

/** 최상위 실행. 실패는 Promise 거부(오류 값 그대로)로 돌려주고, 보고하지 않는다. */
export function startEffect<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return current.runPromise(withAppErrorReporter(effect));
}

/**
 * 동기 실행. 화면을 처음 그리기 전에 저장값을 읽는 것처럼 비동기를 기다릴 수 없을 때만 쓴다.
 * 효과와 서비스 레이어가 모두 동기로 끝나야 한다(아니면 던진다).
 */
export function startEffectSync<A, E>(effect: Effect.Effect<A, E, AppServices>): A {
  return current.runSync(withAppErrorReporter(effect));
}

/**
 * 백그라운드 실행. 처리되지 않은 실패는 `withErrorReporting`으로 보고한다.
 * 돌려주는 함수를 부르면 실행을 중단한다(React 효과 정리용).
 */
export function forkEffect<A, E>(effect: Effect.Effect<A, E, AppServices>): () => void {
  const fiber = current.runFork(withAppErrorReporter(Effect.withErrorReporting(effect)));
  return () => {
    fiber.interruptUnsafe();
  };
}
