import { atom, useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { liveLabels, type LibraryQuery } from 'src/domain/library/query';
import { libraryAtom } from 'src/stores/library-state';
import { prefsAtom, setPrefsAtom } from 'src/stores/prefs-state';

/** 필터 변경을 저장소에 쓰기 전에 기다리는 시간. 타이핑 중에는 쓰지 않는다. */
export const QUERY_PERSIST_DELAY_MS = 300;

/**
 * 화면이 바로 읽는 메모리상의 조건. 저장은 늦게 하므로(디바운스) 화면은 이 값을 본다.
 * `null`이면 아직 바꾼 적이 없어 저장된 선호(`prefsAtom`)가 기준이다. atom이라서 목록이 잠시
 * 사라졌다 다시 그려져도(좁은 화면에서 지도 탭을 다녀옴) 조건이 유지된다.
 */
const queryDraftAtom = atom<LibraryQuery | null>(null);

/**
 * 보관함 화면의 필터·정렬 조건.
 * - 바꾸면 화면에는 바로 반영하고, 선호 저장(`PrefsStore`)은 300ms 디바운스한다. 화면을 떠나면 대기 중인 저장을 바로 쓴다.
 * - 지워진 라벨의 id는 걸러서 돌려준다. 걸러내지 않으면 '모두 포함'에서 목록이 비어 버리고 칩도 없어 풀 수 없다.
 *   저장된 값은 건드리지 않는다.
 */
export function useLibraryQuery(): [LibraryQuery, (patch: Partial<LibraryQuery>) => void] {
  const store = useStore();
  const draft = useAtomValue(queryDraftAtom);
  const saved = useAtomValue(prefsAtom).query;
  const library = useAtomValue(libraryAtom);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    const query = store.get(queryDraftAtom);
    // 저장 시점의 최신 선호에 합친다. 그 사이에 바뀐 보기 방식 등을 덮어쓰지 않는다.
    if (query !== null) store.set(setPrefsAtom, { ...store.get(prefsAtom), query });
  }, [store]);

  useEffect(() => flush, [flush]);

  const patch = useCallback(
    (change: Partial<LibraryQuery>) => {
      const current = store.get(queryDraftAtom) ?? store.get(prefsAtom).query;
      store.set(queryDraftAtom, { ...current, ...change });
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, QUERY_PERSIST_DELAY_MS);
    },
    [store, flush],
  );

  const base = draft ?? saved;
  const query = useMemo(() => {
    const live = new Set(liveLabels(library).map((label) => label.id));
    return base.labelIds.every((id) => live.has(id))
      ? base
      : { ...base, labelIds: base.labelIds.filter((id) => live.has(id)) };
  }, [base, library]);

  return [query, patch];
}
