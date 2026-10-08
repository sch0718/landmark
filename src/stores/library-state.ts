import { Cause, Clock, Effect, ErrorReporter, Stream } from 'effect';
import { isEqual } from 'es-toolkit';
import { atom, useAtomValue, useSetAtom, type PrimitiveAtom } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpCtx, OpError, OpResult } from 'src/domain/library/ops';
import { effectAtom } from 'src/lib/effect/atom';
import { forkEffect, startEffect } from 'src/lib/effect/runtime';
import { emptyLibrary, type Library } from 'src/schema/library';
import { IdGen } from 'src/services/id-gen';
import { LibraryStore, type LoadResult } from 'src/services/library-store';

/** 보관함 로드 결과. 읽지 못하면(`LibraryCorrupt`) Promise가 그 오류로 거부된다. */
export const libraryLoadAtom = effectAtom(() =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    return yield* store.load;
  }),
);

/** 화면이 읽는 보관함 문서. `useLibrarySync`가 채우고 `run` 결과·다른 탭 변경으로 갱신한다. */
export const libraryAtom: PrimitiveAtom<Library> = atom<Library>(emptyLibrary());

/** 저장 방식. `useLibrarySync`가 로드 결과로 채운다(로드 전에는 'local'). */
export const persistenceAtom: PrimitiveAtom<'local' | 'memory'> = atom<'local' | 'memory'>('local');

// ---------- 동기화 ----------

/**
 * 앱 루트에서 한 번 쓴다. 로드가 끝날 때까지 Suspense로 멈추고(오류는 ErrorBoundary로),
 * 첫 렌더 전에 `libraryAtom`을 채운 뒤 다른 탭의 변경(`changes`)을 구독한다.
 */
export function useLibrarySync(): LoadResult {
  const loaded = useAtomValue(libraryLoadAtom);
  useHydrateAtoms([
    [libraryAtom, loaded.library],
    [persistenceAtom, loaded.persistence],
  ]);
  const setLibrary = useSetAtom(libraryAtom);
  useEffect(() => {
    return forkEffect(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        yield* Stream.runForEach(store.changes, (lib) => Effect.sync(() => setLibrary(lib)));
      }),
    );
  }, [setLibrary]);
  return loaded;
}

// ---------- 변경 ----------

export type LibraryActionResult = { ok: true; createdId?: string } | { ok: false; error: unknown };

type LibraryOp = (lib: Library, ctx: OpCtx) => Library | OpResult;

/** `op`가 `ok: false`를 돌려주면 `update`를 실패시키기 위한 표지. */
class OpRejected {
  readonly _tag = 'OpRejected';
  constructor(readonly error: OpError) {}
}

const isOpResult = (value: Library | OpResult): value is OpResult =>
  'ok' in value && typeof value.ok === 'boolean';

/** 최신본에 `op`를 적용해 저장한다. 성공하면 새 문서를, 실패하면 아무것도 쓰지 않고 오류를 돌려준다. */
const applyOp = Effect.fn('보관함/변경')(function* (op: LibraryOp) {
  const store = yield* LibraryStore;
  const ids = yield* IdGen;
  let createdId: string | undefined;
  const lib = yield* store.update((current) =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis).toISOString();
      const out = op(current, { now, newId: (kind) => ids.next(kind) });
      if (!isOpResult(out)) return out;
      if (!out.ok) return yield* Effect.fail(new OpRejected(out.error));
      createdId = out.createdId;
      return out.lib;
    }),
  );
  return { lib, createdId };
});

type Applied = { ok: true; lib: Library; createdId?: string } | { ok: false; error: unknown };

/** 오류를 결과로 바꾼다. 연산이 거절한 경우(OpError)는 호출한 쪽이 보여 주므로 보고하지 않는다. */
const settle = (op: LibraryOp): Effect.Effect<Applied, never, LibraryStore | IdGen> =>
  applyOp(op).pipe(
    Effect.map(({ lib, createdId }): Applied => ({ ok: true, lib, createdId })),
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      if (error instanceof OpRejected)
        return Effect.succeed<Applied>({ ok: false, error: error.error });
      return ErrorReporter.report(cause).pipe(Effect.as<Applied>({ ok: false, error }));
    }),
  );

/**
 * 보관함 변경 함수를 실행한다. `LibraryStore.update` 안에서 최신본에 적용하므로 오래된 탭이
 * 다른 탭의 변경을 덮어쓰지 않는다. 성공한 뒤에만 `libraryAtom`을 바꾼다.
 */
export function useLibraryAction(): {
  run: (op: LibraryOp) => Promise<LibraryActionResult>;
} {
  const setLibrary = useSetAtom(libraryAtom);
  const run = useCallback(
    async (op: LibraryOp): Promise<LibraryActionResult> => {
      const applied = await startEffect(settle(op));
      if (!applied.ok) return applied;
      setLibrary(applied.lib);
      return applied.createdId === undefined
        ? { ok: true }
        : { ok: true, createdId: applied.createdId };
    },
    [setLibrary],
  );
  return { run };
}

// ---------- 초안 ----------

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

type DraftState<T> = {
  key: string;
  /** 사용자가 고친 값. 없으면 dirty가 아니다. */
  edit: { value: T } | null;
  /** 고치기 시작할 때(또는 마지막으로 저장했을 때) 기준이던 저장본. 다른 탭 변경을 알아채는 기준. */
  base: T;
  status: DraftStatus;
};

/**
 * 디바운스되는 편집(메모 입력 등)의 화면 초안.
 * - dirty(저장 전 수정)면 `saved`가 바뀌어도(다른 탭) 화면 값을 덮어쓰지 않고 `remoteChanged`만 켠다.
 * - `status`가 'saved'가 되는 것은 `commit`의 `save`가 `ok: true`를 돌려준 뒤뿐이다.
 *   실패하면 초안을 지우지 않고 dirty·'error'로 남는다.
 */
export function useDraft<T>(key: string, saved: T) {
  const [state, setState] = useState<DraftState<T>>({
    key,
    edit: null,
    base: saved,
    status: 'idle',
  });
  // 키가 바뀌면(다른 장소) 초안을 버리고 새로 시작한다.
  const current: DraftState<T> =
    state.key === key ? state : { key, edit: null, base: saved, status: 'idle' };

  // 핸들러가 항상 가장 최근 상태를 보도록 ref에 둔다(같은 이벤트 안에서 setValue 직후 commit해도 된다).
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  });
  const write = useCallback((next: DraftState<T>) => {
    latest.current = next;
    setState(next);
  }, []);

  const setValue = useCallback(
    (value: T) => {
      const from = latest.current;
      write({
        key,
        edit: { value },
        base: from.edit === null ? saved : from.base,
        status: 'idle',
      });
    },
    [key, saved, write],
  );

  const commit = useCallback(
    async (save: (value: T) => Promise<{ ok: boolean }>): Promise<void> => {
      const sent = latest.current.edit;
      if (sent === null) return;
      write({ ...latest.current, status: 'saving' });
      const ok = await save(sent.value).then(
        (result) => result.ok,
        () => false,
      );
      const from = latest.current;
      if (from.key !== key) return; // 저장하는 사이 다른 대상으로 바뀌었다.
      if (!ok) write({ ...from, status: 'error' });
      // 저장하는 사이에 더 고쳤다면 그 수정은 아직 저장 전이다.
      else if (from.edit !== sent) write({ ...from, base: sent.value, status: 'idle' });
      else write({ key, edit: null, base: sent.value, status: 'saved' });
    },
    [key, write],
  );

  const dirty = current.edit !== null;
  return {
    value: current.edit === null ? saved : current.edit.value,
    setValue,
    dirty,
    remoteChanged: dirty && !isEqual(saved, current.base),
    status: current.status,
    commit,
  };
}
