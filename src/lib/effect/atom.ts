import type { Effect } from 'effect';
import { atom, type Atom, type Getter } from 'jotai';
import { startEffect, type AppServices } from 'src/lib/effect/runtime';

/** Effect를 읽기 함수로 쓰는 비동기 atom. 실패는 Promise 거부로 나가 Suspense·ErrorBoundary가 받는다. */
export function effectAtom<A, E>(
  read: (get: Getter) => Effect.Effect<A, E, AppServices>,
): Atom<Promise<A>> {
  return atom(async (get) => startEffect(read(get)));
}
