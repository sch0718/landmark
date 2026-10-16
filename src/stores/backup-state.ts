import { Cause, Effect, ErrorReporter } from 'effect';
import { atom, useAtomValue, useSetAtom, useStore, type PrimitiveAtom } from 'jotai';
import { atomWithLazy } from 'jotai/utils';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ReadBackup } from 'src/domain/backup/read-backup';
import { libraryCounts, type LibraryCounts } from 'src/domain/backup/summary';
import { DEFAULT_QUERY } from 'src/domain/library/query';
import { forkEffect, startEffect, startEffectSync } from 'src/lib/effect/runtime';
import type { PersistState } from 'src/lib/storage-persist';
import { EMPTY_BACKUP_META, type BackupMeta } from 'src/schema/backup';
import type { Library } from 'src/schema/library';
import { BackupMetaStore } from 'src/services/backup-meta-store';
import { NoPrevious, PreviousNotKept, StorageQuotaExceeded } from 'src/services/errors';
import { LibraryStore } from 'src/services/library-store';
import { queryDraftAtom } from 'src/stores/library-query-draft';
import { libraryAtom, reflectSaved } from 'src/stores/library-state';
import { prefsAtom, setPrefsAtom } from 'src/stores/prefs-state';

/** 저장된 백업 기록. localStorage를 동기로 읽으므로 첫 렌더 전에 읽을 수 있다. */
const readSavedMeta = (): BackupMeta => {
  try {
    return startEffectSync(
      Effect.gen(function* () {
        return yield* (yield* BackupMetaStore).get;
      }),
    );
  } catch (error) {
    console.warn('저장된 백업 기록을 읽지 못해 빈 기록을 써요', error);
    return { ...EMPTY_BACKUP_META };
  }
};

/**
 * 마지막 백업 기록. 처음 읽을 때 저장된 값으로 채워지고, 다른 탭의 변경은 새로고침 전까지 반영하지 않는다.
 */
export const backupMetaAtom: PrimitiveAtom<BackupMeta> = atomWithLazy(readSavedMeta);

/** 바꾼 기록을 화면에 바로 쓰고, 저장은 뒤에서 한다. */
const writeMeta = (
  set: (a: PrimitiveAtom<BackupMeta>, v: BackupMeta) => void,
  next: BackupMeta,
) => {
  set(backupMetaAtom, next);
  forkEffect(
    Effect.gen(function* () {
      yield* (yield* BackupMetaStore).set(next);
    }),
  );
};

/**
 * 백업을 받았다고 기록한다. 시각은 UTC ISO라 사전순이 시간순이므로 더 이른 시각이 오면 그대로 두고,
 * 미룸은 지운다(새 백업으로 알림 조건이 처음부터 다시 센다).
 */
export const markBackedUpAtom = atom(null, (get, set, at: string) => {
  const current = get(backupMetaAtom);
  const lastBackupAt =
    current.lastBackupAt !== null && current.lastBackupAt >= at ? current.lastBackupAt : at;
  writeMeta(set, { lastBackupAt, snoozedAt: null });
});

/** `나중에`: 미룬 시각을 기록한다. */
export const snoozeReminderAtom = atom(null, (get, set, at: string) => {
  writeMeta(set, { ...get(backupMetaAtom), snoozedAt: at });
});

/** 브라우저의 저장 보호 상태(아직 확인 전이면 `null`). */
export const persistStateAtom: PrimitiveAtom<PersistState | null> = atom<PersistState | null>(null);

// ---------- 되살리기 ----------

export type RestoreOutcome =
  { ok: true; previousKept: boolean; counts: LibraryCounts } | { ok: false; error: unknown };

/** 되살리기 전 사본이 바뀔 때마다 올린다. `usePreviousCopy`가 이 값이 바뀌면 사본을 다시 읽는다. */
const previousVersionAtom = atom(0);

const UNDONE = '되살리기 전으로 되돌렸어요';
const UNDO_FAILED = '되돌리지 못했어요';
const DROPPED = '되살리기 전 보관함을 지웠어요';
const DROP_FAILED = '되살리기 전 보관함을 지우지 못했어요';

/** 예상 밖 오류를 앱 오류 보고자(`ErrorReporter`)로 보고한다. 보고가 실패해도 흐름을 막지 않는다. */
function reportUnexpected(error: unknown): void {
  startEffect(ErrorReporter.report(Cause.die(error))).catch(() => {});
}

/** 저장이 끝난 뒤의 화면 반영 한 단계. 던져도 이미 바뀐 보관함을 되돌릴 수 없으므로 보고만 하고 이어 간다. */
async function afterSaved(step: () => void | Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    reportUnexpected(error);
  }
}

type ReplaceOptions = { requirePrevious: boolean; savedText?: string | null };

/** 화면이 문구로 알리는 실패(스펙 §2.7). 그 밖은 프로그램 오류라 보고한다(`ErrorReporter`). */
const isExpectedReplaceError = (error: unknown): boolean =>
  error instanceof PreviousNotKept || error instanceof StorageQuotaExceeded;

const replaceEffect = (next: Library, options: ReplaceOptions) =>
  Effect.gen(function* () {
    return yield* (yield* LibraryStore).replace(next, options);
  }).pipe(
    Effect.tapCause((cause) =>
      isExpectedReplaceError(Cause.squash(cause)) ? Effect.void : ErrorReporter.report(cause),
    ),
  );

const restorePreviousEffect = Effect.gen(function* () {
  return yield* (yield* LibraryStore).restorePrevious;
});

const dropPreviousEffect = Effect.gen(function* () {
  yield* (yield* LibraryStore).dropPrevious;
});

const readPreviousEffect = Effect.gen(function* () {
  return yield* (yield* LibraryStore).previous;
});

/**
 * 백업으로 보관함을 통째로 바꾸고(스펙 §2.3·§5), 되살리기 전 사본으로 되돌리거나 사본을 지운다.
 * 바꾸면 화면 보관함·화면 설정(`query`는 기본값)·마지막 백업 시각을 맞춘다.
 */
export function useRestoreActions() {
  const jotaiStore = useStore();

  const bumpPrevious = useCallback(
    () => jotaiStore.set(previousVersionAtom, (n) => n + 1),
    [jotaiStore],
  );

  const replace = useCallback(
    async (backup: ReadBackup, options: ReplaceOptions): Promise<RestoreOutcome> => {
      const before = jotaiStore.get(libraryAtom);
      let result: { library: Library; previousKept: boolean };
      try {
        result = await startEffect(replaceEffect(backup.library, options));
      } catch (error) {
        return { ok: false, error };
      } finally {
        // 실패해도 옛 사본을 지웠을 수 있다(용량 초과 때 자리 내기).
        bumpPrevious();
      }
      // 여기부터는 보관함이 이미 바뀌었다. 화면 반영이 던져도 성공으로 돌려줘야 대화상자가 닫힌다
      // (실패로 보이면 두 번째 바꾸기가 진짜 바꾸기 전 사본을 덮어쓴다).
      await afterSaved(() => reflectSaved(jotaiStore, before, result.library));
      // 이 세션에서 바꾼 필터(메모리상의 초안)가 남아 되살린 장소를 가리지 않게 비운다.
      // 대기 중이던 저장도 초안이 없으면 아무것도 쓰지 않는다.
      await afterSaved(() => jotaiStore.set(queryDraftAtom, null));
      // 되살린 뒤 필터 때문에 목록이 비어 보이지 않게 `query`는 기본값으로 둔다.
      // 백업에 선호가 없으면(옛 파일) 지금 선호에서 `query`만 바꾼다.
      const prefs = backup.prefs ?? jotaiStore.get(prefsAtom);
      await afterSaved(() =>
        jotaiStore.set(setPrefsAtom, { ...prefs, query: structuredClone(DEFAULT_QUERY) }),
      );
      const { exportedAt } = backup;
      // 그 파일이 이미 있으므로, 기록보다 늦게 만든 백업이면 마지막 백업으로 본다.
      await afterSaved(() => {
        const last = jotaiStore.get(backupMetaAtom).lastBackupAt;
        if (exportedAt !== null && (last === null || exportedAt > last)) {
          jotaiStore.set(markBackedUpAtom, exportedAt);
        }
      });
      return { ok: true, previousKept: result.previousKept, counts: libraryCounts(result.library) };
    },
    [jotaiStore, bumpPrevious],
  );

  /** 사본으로 보관함을 바꾸고 사본을 지운다(한 번뿐). 결과는 토스트로 알린다. */
  const undo = useCallback(async (): Promise<boolean> => {
    const before = jotaiStore.get(libraryAtom);
    let library: Library;
    try {
      library = await startEffect(restorePreviousEffect);
    } catch (error) {
      if (!(error instanceof NoPrevious) && !(error instanceof StorageQuotaExceeded)) {
        reportUnexpected(error);
      }
      toast.error(UNDO_FAILED);
      return false;
    } finally {
      bumpPrevious();
    }
    await afterSaved(() => reflectSaved(jotaiStore, before, library));
    toast(UNDONE);
    return true;
  }, [jotaiStore, bumpPrevious]);

  /** 사본만 지운다. 지우지 못하면 보고하고 토스트로 알린 뒤 `false`를 돌려준다. */
  const drop = useCallback(async (): Promise<boolean> => {
    try {
      await startEffect(dropPreviousEffect);
    } catch (error) {
      reportUnexpected(error);
      toast.error(DROP_FAILED);
      return false;
    } finally {
      bumpPrevious();
    }
    toast(DROPPED);
    return true;
  }, [bumpPrevious]);

  return { replace, undo, drop };
}

export type PreviousCopyInfo = { savedAt: string; counts: LibraryCounts };

/** 되살리기 전 사본의 요약(없으면 `null`). 이 탭에서 사본이 바뀌면 다시 읽고, `refresh`로도 다시 읽는다. */
export function usePreviousCopy(): { info: PreviousCopyInfo | null; refresh(): void } {
  const version = useAtomValue(previousVersionAtom);
  const setVersion = useSetAtom(previousVersionAtom);
  const [info, setInfo] = useState<PreviousCopyInfo | null>(null);

  useEffect(() => {
    let live = true;
    startEffect(readPreviousEffect).then(
      (copy) => {
        if (!live) return;
        setInfo(
          copy === null ? null : { savedAt: copy.savedAt, counts: libraryCounts(copy.library) },
        );
      },
      (error: unknown) => {
        console.error(error);
      },
    );
    return () => {
      live = false;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((n) => n + 1), [setVersion]);
  return { info, refresh };
}
