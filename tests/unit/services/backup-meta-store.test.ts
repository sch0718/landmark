import { describe, expect, vi } from 'vitest';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { EMPTY_BACKUP_META, type BackupMeta } from 'src/schema/backup';
import { BACKUP_META_KEY, BackupMetaStore } from 'src/services/backup-meta-store';

const run = <A>(
  storage: Storage | undefined,
  use: (s: BackupMetaStore['Service']) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* BackupMetaStore);
  }).pipe(Effect.provide(BackupMetaStore.layerWith({ storage })));

describe('BackupMetaStore', () => {
  it('키 이름은 tripmap:backup:v1', () => {
    expect(BACKUP_META_KEY).toBe('tripmap:backup:v1');
  });

  it.effect('저장된 값이 없으면 빈 기록', () =>
    Effect.gen(function* () {
      expect(yield* run(createMemoryStorage(), (s) => s.get)).toEqual(EMPTY_BACKUP_META);
      expect(EMPTY_BACKUP_META).toEqual({ lastBackupAt: null, snoozedAt: null });
    }),
  );

  it.effect('깨진 JSON·스키마 실패(잘못된 시각 포함)는 빈 기록', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(BACKUP_META_KEY, '{bad');
      expect(yield* run(storage, (s) => s.get)).toEqual(EMPTY_BACKUP_META);
      storage.setItem(BACKUP_META_KEY, JSON.stringify({ lastBackupAt: 5, snoozedAt: null }));
      expect(yield* run(storage, (s) => s.get)).toEqual(EMPTY_BACKUP_META);
      // 시각이 아닌 문자열은 NaN 문구가 되므로 읽을 때 걸러야 한다.
      storage.setItem(
        BACKUP_META_KEY,
        JSON.stringify({ lastBackupAt: 'yesterday', snoozedAt: null }),
      );
      expect(yield* run(storage, (s) => s.get)).toEqual(EMPTY_BACKUP_META);
    }),
  );

  it.effect('set 뒤 get 왕복', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const meta: BackupMeta = {
        lastBackupAt: '2026-10-16T05:30:00.000Z',
        snoozedAt: '2026-10-17T00:00:00.000Z',
      };
      const read = yield* run(storage, (s) => s.set(meta).pipe(Effect.andThen(s.get)));
      expect(read).toEqual(meta);
      expect(JSON.parse(storage.getItem(BACKUP_META_KEY)!)).toEqual(meta);
    }),
  );

  it.effect('setItem이 던져도 실패하지 않고 경고만 남긴다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const setItem = storage.setItem.bind(storage);
      storage.setItem = (key: string, value: string) => {
        if (key === BACKUP_META_KEY) throw new DOMException('', 'QuotaExceededError');
        setItem(key, value);
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      yield* run(storage, (s) => s.set(EMPTY_BACKUP_META));
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    }),
  );

  it.effect('저장소가 없으면 메모리에서 동작', () =>
    Effect.gen(function* () {
      const meta: BackupMeta = { lastBackupAt: '2026-10-16T05:30:00.000Z', snoozedAt: null };
      expect(yield* run(undefined, (s) => s.set(meta).pipe(Effect.andThen(s.get)))).toEqual(meta);
    }),
  );
});
