import { Cause, Effect, ErrorReporter } from 'effect';
import { toast } from 'sonner';

/** 실패 값이 화면에 보일 문구(`userMessage`)를 갖고 있으면 그 문구를 돌려준다. */
function userMessageOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('userMessage' in value)) return undefined;
  return typeof value.userMessage === 'string' ? value.userMessage : undefined;
}

/** 원인 하나에서 화면에 보일 문구를 중복 없이 모은다(Fail의 오류, Die의 결함). */
function userMessages(cause: Cause.Cause<unknown>): string[] {
  const messages = new Set<string>();
  for (const reason of cause.reasons) {
    if (reason._tag === 'Interrupt') continue;
    const message = userMessageOf(reason._tag === 'Fail' ? reason.error : reason.defect);
    if (message !== undefined) messages.add(message);
  }
  return [...messages];
}

// `ErrorReporter.make`는 원인의 이유(reason)마다 콜백을 부르므로 원인당 한 번만 보고한다.
const handled = new WeakSet<Cause.Cause<unknown>>();

/** 보고 대상은 `console.error`와 sonner 토스트뿐이다(스펙 §6.1). */
export const appErrorReporter = ErrorReporter.make(({ cause }) => {
  if (handled.has(cause)) return;
  handled.add(cause);
  console.error(cause);
  for (const message of userMessages(cause)) toast.error(message);
});

/** 실행하는 파이버에 앱 오류 보고자를 붙인다. */
export const withAppErrorReporter = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.provideService(
    effect,
    ErrorReporter.CurrentErrorReporters,
    new Set<ErrorReporter.ErrorReporter>([appErrorReporter]),
  );
