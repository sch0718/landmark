import { Cause, Clock, Effect, ErrorReporter, Pull, Stream } from 'effect';
import { isEqual } from 'es-toolkit';
import { atom, useAtomValue, useSetAtom, useStore, type PrimitiveAtom } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpCtx, OpError, OpResult } from 'src/domain/library/ops';
import { effectAtom } from 'src/lib/effect/atom';
import { forkEffect, startEffect } from 'src/lib/effect/runtime';
import { emptyLibrary, type Library } from 'src/schema/library';
import { IdGen } from 'src/services/id-gen';
import { LibraryStore, type LoadResult } from 'src/services/library-store';

/** 올리면 `libraryLoadAtom`이 저장소를 다시 읽는다(복구 화면에서 "새로 시작"한 뒤). */
export const libraryReloadAtom = atom(0);

/** 보관함 로드 결과. 읽지 못하면(`LibraryCorrupt`) Promise가 그 오류로 거부된다. */
export const libraryLoadAtom = effectAtom((get) =>
  Effect.gen(function* () {
    get(libraryReloadAtom);
    const store = yield* LibraryStore;
    return yield* store.load;
  }),
);

/** 화면이 읽는 보관함 문서. `useLibrarySync`가 채우고 `run` 결과·다른 탭 변경으로 갱신한다. */
export const libraryAtom: PrimitiveAtom<Library> = atom<Library>(emptyLibrary());

/** 저장 방식. `useLibrarySync`가 로드 결과로 채운다(로드 전에는 'local'). */
export const persistenceAtom: PrimitiveAtom<'local' | 'memory'> = atom<'local' | 'memory'>('local');

// ---------- 동기화 ----------

/** 저장소에서 최신 문서를 다시 읽는다. 저장소가 기준이라 읽은 순서대로 적용하면 항상 최신이 남는다. */
const readLatest = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return (yield* store.load).library;
});

/**
 * 앱 루트에서 한 번 쓴다. 로드가 끝날 때까지 Suspense로 멈추고(오류는 ErrorBoundary로),
 * 첫 렌더 전에 `libraryAtom`을 채운 뒤 다른 탭의 변경(`changes`)을 구독한다.
 * 다른 탭의 변경은 이벤트 값을 쓰지 않고 저장소를 다시 읽어 반영한다(스펙 §6.3). 구독을 먼저
 * 걸고 한 번 더 읽으므로 로드와 구독 사이의 변경도 놓치지 않는다.
 */
export function useLibrarySync(): LoadResult {
  const loaded = useAtomValue(libraryLoadAtom);
  useHydrateAtoms([
    [libraryAtom, loaded.library],
    [persistenceAtom, loaded.persistence],
  ]);
  const setLibrary = useSetAtom(libraryAtom);
  useEffect(() => {
    const refresh = readLatest.pipe(
      Effect.tap((library) => Effect.sync(() => setLibrary(library))),
      Effect.asVoid,
      // 읽지 못해도(다른 탭이 문서를 망가뜨림) 구독은 이어 간다. 오류만 보고한다.
      Effect.catchCause((cause) => ErrorReporter.report(cause)),
    );
    return forkEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          // 구독을 먼저 걸고 그 뒤에 읽어야 로드와 구독 사이의 변경이 빠지지 않는다.
          const pull = yield* Stream.toPull(store.changes);
          yield* Effect.yieldNow; // 구독을 거는 포크가 먼저 돌게 한다.
          yield* refresh;
          yield* Effect.forever(Effect.flatMap(pull, () => refresh));
        }),
      ).pipe(Pull.catchDone(() => Effect.void)),
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
  const jotaiStore = useStore();
  const run = useCallback(
    async (op: LibraryOp): Promise<LibraryActionResult> => {
      const before = jotaiStore.get(libraryAtom);
      const applied = await startEffect(settle(op));
      if (!applied.ok) return applied;
      // 실행하는 사이 atom이 바뀌었다면(다른 탭 변경·다른 실행) 어느 쪽이 최신인지 이 결과만으로는
      // 알 수 없다. 저장소가 기준이므로 다시 읽어 반영한다(읽지 못하면 이 결과를 쓴다).
      if (jotaiStore.get(libraryAtom) === before) {
        jotaiStore.set(libraryAtom, applied.lib);
      } else {
        const latest = await startEffect(Effect.option(readLatest));
        jotaiStore.set(libraryAtom, latest._tag === 'Some' ? latest.value : applied.lib);
      }
      return applied.createdId === undefined
        ? { ok: true }
        : { ok: true, createdId: applied.createdId };
    },
    [jotaiStore],
  );
  return { run };
}

// ---------- 초안 ----------

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

type DraftState<T> = {
  key: string;
  /** 키가 바뀔 때마다 늘린다. 이전 키(A→B→A 포함)의 늦은 `commit` 결과를 걸러 낸다. */
  epoch: number;
  /** 사용자가 고친 값. 없으면 dirty가 아니다. */
  edit: { value: T } | null;
  /** 고치기 시작할 때(또는 마지막으로 저장했을 때) 기준이던 저장본. 다른 탭 변경을 알아채는 기준. */
  base: T;
  status: DraftStatus;
  /** 진행 중인 `commit` 수. */
  inflight: number;
  /** 가장 최근에 성공한 `commit`의 번호(시작 순). 이보다 오래된 결과는 `base`를 되돌리지 못한다. */
  lastOk: number;
  /** 가장 최근에 실패한 `commit`의 번호. 0이면 없음. */
  lastFail: number;
};

const freshDraft = <T>(key: string, saved: T, epoch: number): DraftState<T> => ({
  key,
  epoch,
  edit: null,
  base: saved,
  status: 'idle',
  inflight: 0,
  lastOk: 0,
  lastFail: 0,
});

/** `commit` 하나가 끝난 뒤의 상태. 진행 중인 저장이 남아 있으면 계속 'saving'이다. */
function settled<T>(from: DraftState<T>, patch: Partial<DraftState<T>>): DraftState<T> {
  const next = { ...from, ...patch, inflight: from.inflight - 1 };
  const status: DraftStatus =
    next.inflight > 0
      ? 'saving'
      : next.edit === null
        ? 'saved'
        : next.lastFail > next.lastOk
          ? 'error'
          : 'idle';
  return { ...next, status };
}

/**
 * 디바운스되는 편집(메모 입력 등)의 화면 초안.
 * - dirty(저장 전 수정)면 `saved`가 바뀌어도(다른 탭) 화면 값을 덮어쓰지 않고 `remoteChanged`만 켠다.
 * - `status`가 'saved'가 되는 것은 `commit`의 `save`가 `ok: true`를 돌려준 뒤뿐이다.
 *   실패하면 초안을 지우지 않고 dirty·'error'로 남는다.
 * - `key`가 바뀌면 이전 초안은 버린다. 이전 키로 돌아와도 되살아나지 않고, 이전 키의
 *   `commit` 결과는 상태에 반영하지 않는다(저장 자체는 그대로 진행된다).
 */
export function useDraft<T>(key: string, saved: T) {
  const [state, setState] = useState<DraftState<T>>(() => freshDraft(key, saved, 0));
  let current = state;
  if (state.key !== key) {
    // 렌더 중 상태 재설정: 이전 키의 초안을 `state`에서도 지운다.
    current = freshDraft(key, saved, state.epoch + 1);
    setState(current);
  }

  // 핸들러가 항상 가장 최근 상태를 보도록 ref에 둔다(같은 이벤트 안에서 setValue 직후 commit해도 된다).
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  });
  const commitSeq = useRef(0);
  const write = useCallback((next: DraftState<T>) => {
    latest.current = next;
    setState(next);
  }, []);

  const setValue = useCallback(
    (value: T) => {
      const from = latest.current;
      write({
        ...from,
        edit: { value },
        base: from.edit === null ? saved : from.base,
        status: from.inflight > 0 ? 'saving' : 'idle',
        lastFail: 0,
      });
    },
    [saved, write],
  );

  const commit = useCallback(
    async (save: (value: T) => Promise<{ ok: boolean }>): Promise<void> => {
      const start = latest.current;
      const sent = start.edit;
      if (start.key !== key || sent === null) return;
      const n = ++commitSeq.current;
      write({ ...start, status: 'saving', inflight: start.inflight + 1 });
      const ok = await save(sent.value).then(
        (result) => result.ok,
        () => false,
      );
      const from = latest.current;
      if (from.epoch !== start.epoch) return; // 저장하는 사이 다른 대상으로 바뀌었다.
      if (!ok) {
        write(settled(from, n > from.lastOk ? { lastFail: Math.max(from.lastFail, n) } : {}));
      } else if (n < from.lastOk) {
        write(settled(from, {})); // 더 나중에 시작한 저장이 이미 끝났다. 기준을 되돌리지 않는다.
      } else {
        // 저장하는 사이에 더 고쳤다면 그 수정은 아직 저장 전이다.
        const edit = from.edit === sent || from.edit === null ? null : from.edit;
        write(settled(from, { edit, base: sent.value, lastOk: n }));
      }
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
