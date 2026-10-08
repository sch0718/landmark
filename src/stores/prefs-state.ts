import { Effect } from 'effect';
import { isEqual } from 'es-toolkit';
import { atom, type PrimitiveAtom } from 'jotai';
import { forkEffect } from 'src/lib/effect/runtime';
import { DEFAULT_PREFS, type Prefs } from 'src/schema/prefs';
import { PrefsStore } from 'src/services/prefs-store';

/** 화면이 읽는 UI 선호. `loadPrefsAtom`이 저장된 값으로 채우기 전에는 기본값이다. */
export const prefsAtom: PrimitiveAtom<Prefs> = atom<Prefs>(structuredClone(DEFAULT_PREFS));

/** 사용자가 이미 바꿨는지. 바꿨다면 늦게 도착한 저장값이 그 선택을 덮어쓰면 안 된다. */
const prefsTouchedAtom = atom(false);

/**
 * 저장된 선호를 읽어 `prefsAtom`에 채운다. 쓰면(`store.set`) 읽기를 시작하고 중단 함수를 돌려준다.
 * 읽는 사이 사용자가 먼저 바꿨다면 읽은 값은 버린다.
 */
export const loadPrefsAtom = atom(null, (get, set) =>
  forkEffect(
    Effect.gen(function* () {
      const prefs = yield* (yield* PrefsStore).get;
      if (get(prefsTouchedAtom) || isEqual(get(prefsAtom), prefs)) return;
      set(prefsAtom, prefs);
    }),
  ),
);

/** 선호를 바꾸고 저장한다. 화면은 바로 바뀌고(`prefsAtom`), 저장은 뒤에서 한다. */
export const setPrefsAtom = atom(null, (_get, set, next: Prefs) => {
  set(prefsTouchedAtom, true);
  set(prefsAtom, next);
  forkEffect(
    Effect.gen(function* () {
      yield* (yield* PrefsStore).set(next);
    }),
  );
});
