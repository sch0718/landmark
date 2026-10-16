import { Context, Effect, Layer } from 'effect';
import { browserStorage } from 'src/services/browser-storage';
import { createMemoryStorage, isStorageAvailable } from 'src/repositories/edit-layer-repo';
import { safeParse } from 'src/schema/parse';
import { BackupMetaSchema, EMPTY_BACKUP_META, type BackupMeta } from 'src/schema/backup';

export const BACKUP_META_KEY = 'tripmap:backup:v1';

function readMeta(storage: Storage): BackupMeta {
  try {
    const raw = storage.getItem(BACKUP_META_KEY);
    if (raw === null) return { ...EMPTY_BACKUP_META };
    const parsed = safeParse(BackupMetaSchema, JSON.parse(raw));
    return parsed.success ? parsed.data : { ...EMPTY_BACKUP_META };
  } catch {
    return { ...EMPTY_BACKUP_META };
  }
}

/**
 * 마지막 백업 기록. 잃어도 알림이 한 번 더 뜰 뿐이라서 읽기 실패·검증 실패는 빈 기록으로,
 * 쓰기 실패는 콘솔 경고만 남기고 넘어간다(`PrefsStore`와 같다).
 */
export class BackupMetaStore extends Context.Service<
  BackupMetaStore,
  { readonly get: Effect.Effect<BackupMeta>; set(meta: BackupMeta): Effect.Effect<void> }
>()('tripmap/BackupMetaStore') {
  static layerWith(options: { storage: Storage | undefined }) {
    return Layer.sync(BackupMetaStore, () => {
      const storage = isStorageAvailable(options.storage) ? options.storage : createMemoryStorage();
      return BackupMetaStore.of({
        get: Effect.sync(() => readMeta(storage)),
        set: (meta) =>
          Effect.sync(() => {
            try {
              storage.setItem(BACKUP_META_KEY, JSON.stringify(meta));
            } catch (error) {
              console.warn('백업 기록을 저장하지 못했어요', error);
            }
          }),
      });
    });
  }

  static readonly layer = Layer.suspend(() =>
    BackupMetaStore.layerWith({ storage: browserStorage() }),
  );
}
