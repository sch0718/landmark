import { Effect } from 'effect';
import { atom, type PrimitiveAtom } from 'jotai';
import { atomWithLazy } from 'jotai/utils';
import { forkEffect, startEffectSync } from 'src/lib/effect/runtime';
import type { PersistState } from 'src/lib/storage-persist';
import { EMPTY_BACKUP_META, type BackupMeta } from 'src/schema/backup';
import { BackupMetaStore } from 'src/services/backup-meta-store';

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
