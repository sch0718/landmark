import { Effect } from 'effect';
import { atom, type PrimitiveAtom } from 'jotai';
import { atomWithLazy } from 'jotai/utils';
import { forkEffect, startEffectSync } from 'src/lib/effect/runtime';
import { DEFAULT_PREFS, type Prefs } from 'src/schema/prefs';
import { PrefsStore } from 'src/services/prefs-store';

/** 저장된 선호. `PrefsStore.get`은 localStorage를 동기로 읽으므로 첫 렌더 전에 읽을 수 있다. */
const readSavedPrefs = (): Prefs => {
  try {
    return startEffectSync(
      Effect.gen(function* () {
        return yield* (yield* PrefsStore).get;
      }),
    );
  } catch (error) {
    console.warn('저장된 UI 선호를 읽지 못해 기본값을 써요', error);
    return structuredClone(DEFAULT_PREFS);
  }
};

/**
 * 화면이 읽는 UI 선호. 스토어가 이 atom을 처음 읽을 때(첫 렌더) 저장된 값으로 채워지므로
 * 저장된 테마가 기본값보다 먼저 그려지는 일이 없고, 바꾸기 전에 읽은 값이 이미 저장본이라
 * 다른 필드를 기본값으로 덮어쓰지 않는다.
 */
export const prefsAtom: PrimitiveAtom<Prefs> = atomWithLazy(readSavedPrefs);

/** 선호를 바꾸고 저장한다. 화면은 바로 바뀌고(`prefsAtom`), 저장은 뒤에서 한다. */
export const setPrefsAtom = atom(null, (_get, set, next: Prefs) => {
  set(prefsAtom, next);
  forkEffect(
    Effect.gen(function* () {
      yield* (yield* PrefsStore).set(next);
    }),
  );
});
