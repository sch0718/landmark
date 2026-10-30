import { Effect } from 'effect';
import { getDefaultStore } from 'jotai';
import { hasLiveContent, libraryCounts, type LibraryCounts } from 'src/domain/backup/summary';
import { startEffect } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { Prefs } from 'src/schema/prefs';
import { LibraryStore } from 'src/services/library-store';
import { getSharedSyncApi, getSharedSyncStorage } from 'src/services/library-sync/shared-api';
import { loadSyncEngine } from 'src/services/library-sync/boot';
import { readSyncMeta } from 'src/services/library-sync/storage';
import { deviceLabel } from 'src/services/library-sync/login';
import { prefsAtom } from 'src/stores/prefs-state';
import { syncStatusAtom, type SyncStatus } from 'src/stores/sync-status';
import { createBackupApi, uploadBody, type BackupApi, type BackupCounts } from './api';
import { buildSnapshot, libraryContentHash } from './snapshot';
import { readServerBackupLocal, writeServerBackupLocal, type AutoOutcome } from './storage';
export const AUTO_BACKUP_INTERVAL_MS = 86_400_000;
export const AUTO_RETRY_MS = 3_600_000;
export const AUTO_CANCEL_RETRY_MS = 5 * 60_000;
export const AUTO_SHRINK_MIN = 20;
export const AUTO_BACKUP_LOCK = 'tripmap:server-backup';
export function autoBackupInterval(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): number {
  if (import.meta.env.DEV && env.DEV === true) {
    const value = Number(env.VITE_AUTO_BACKUP_INTERVAL_MS);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return AUTO_BACKUP_INTERVAL_MS;
}
export function shrunk(server: BackupCounts, current: LibraryCounts): boolean {
  const before = server.places + server.trips;
  return before >= AUTO_SHRINK_MIN && current.places + current.trips < before / 2;
}
export type AutoStep =
  | 'disabled'
  | 'not-synced'
  | 'waiting'
  | 'busy'
  | 'recent'
  | 'unchanged'
  | 'changed'
  | 'auth'
  | AutoOutcome;
export type AutoBackupDeps = {
  api: BackupApi;
  storage: Storage;
  locks?: Pick<LockManager, 'request'>;
  now(): number;
  readLibrary(): Promise<{ raw: unknown; library: Library }>;
  prefs(): Prefs | null;
  syncUserId(): string | null;
  deviceId(): string;
  deviceLabel(): string;
  interval?: number;
  build?: typeof buildSnapshot;
};
export async function runAutoBackup(
  status: Pick<SyncStatus, 'phase'>,
  deps: AutoBackupDeps,
): Promise<AutoStep> {
  let local = readServerBackupLocal(deps.storage);
  if (!local.auto) return 'disabled';
  const userId = deps.syncUserId();
  if (local.userId !== userId) {
    local = { ...local, userId, nextCheckAt: null, last: null };
    writeServerBackupLocal(deps.storage, local);
  }
  if (status.phase !== 'synced') return 'not-synced';
  if (local.nextCheckAt !== null && deps.now() < local.nextCheckAt) return 'waiting';
  let requested = false;
  const cancelled = (): AutoStep | null => {
    const latest = readServerBackupLocal(deps.storage);
    const step = !latest.auto
      ? 'disabled'
      : status.phase !== 'synced'
        ? 'not-synced'
        : deps.syncUserId() !== userId || latest.userId !== userId
          ? 'auth'
          : null;
    if (step && requested && latest.userId === userId)
      writeServerBackupLocal(deps.storage, {
        ...latest,
        nextCheckAt: deps.now() + AUTO_CANCEL_RETRY_MS,
      });
    return step;
  };
  const interval = deps.interval ?? autoBackupInterval();
  const run = async (): Promise<AutoStep> => {
    // 잠금을 기다리는 동안 다른 탭이 기록한 기한과 사용자 설정을 다시 확인한다.
    local = readServerBackupLocal(deps.storage);
    const stopped = cancelled();
    if (stopped) return stopped;
    if (local.nextCheckAt !== null && deps.now() < local.nextCheckAt) return 'waiting';
    const now = deps.now();
    const finish = (step: AutoStep, wait: number, outcome?: AutoOutcome): AutoStep => {
      const latest = readServerBackupLocal(deps.storage);
      writeServerBackupLocal(deps.storage, {
        ...latest,
        userId,
        nextCheckAt: now + wait,
        last: outcome ? { at: now, outcome } : latest.last,
      });
      return step;
    };
    try {
      requested = true;
      const reply = await deps.api.meta();
      const afterMeta = cancelled();
      if (afterMeta) return afterMeta;
      if (!reply.ok)
        return reply.reason === 'auth' || reply.reason === 'not-allowed'
          ? 'auth'
          : finish('failed', AUTO_RETRY_MS, 'failed');
      const { backup } = reply.data;
      if (!reply.data.writable) return finish('off', interval, 'off');
      if (backup && reply.data.now - backup.createdAt < interval)
        return finish('recent', interval - (reply.data.now - backup.createdAt));
      const { raw, library } = await deps.readLibrary();
      const afterRead = cancelled();
      if (afterRead) return afterRead;
      if (backup && libraryContentHash(library) === backup.contentHash)
        return finish('unchanged', interval);
      if (!hasLiveContent(library)) return finish('skipped-empty', interval, 'skipped-empty');
      if (backup && shrunk(backup.counts, libraryCounts(library)))
        return finish('skipped-shrunk', interval, 'skipped-shrunk');
      const built = await (deps.build ?? buildSnapshot)({
        rawLibrary: raw,
        library,
        prefs: deps.prefs(),
        now: new Date(now),
      });
      const afterBuild = cancelled();
      if (afterBuild) return afterBuild;
      if (!built.ok) return finish(built.reason, interval, built.reason);
      const result = await deps.api.upload(
        uploadBody(
          built.snapshot,
          { deviceId: deps.deviceId(), deviceLabel: deps.deviceLabel() },
          'auto',
          backup?.id ?? null,
        ),
      );
      const afterUpload = cancelled();
      if (afterUpload) return afterUpload;
      if (result.ok) return finish('uploaded', interval, 'uploaded');
      if (result.reason === 'auth' || result.reason === 'not-allowed') return 'auth';
      if (result.reason === 'changed') return finish('changed', AUTO_RETRY_MS);
      if (result.reason === 'limit' || result.reason === 'off')
        return finish(result.reason, interval, result.reason);
      return finish('failed', AUTO_RETRY_MS, 'failed');
    } catch {
      return cancelled() ?? finish('failed', AUTO_RETRY_MS, 'failed');
    }
  };
  return deps.locks
    ? deps.locks.request(AUTO_BACKUP_LOCK, { ifAvailable: true }, (lock) =>
        lock === null ? Promise.resolve('busy' as const) : run(),
      )
    : run();
}
export function attachAutoBackup(
  engine: { onRunFinished(listener: (status: SyncStatus) => void): () => void },
  deps: AutoBackupDeps,
  current: () => Pick<SyncStatus, 'phase'>,
): () => void {
  let active = true;
  let running = false;
  const run = (status: Pick<SyncStatus, 'phase'>) => {
    if (!active || running || status.phase !== 'synced') return;
    running = true;
    void runAutoBackup(
      {
        get phase() {
          return active ? current().phase : 'off';
        },
      },
      deps,
    )
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  };
  const off = engine.onRunFinished(run);
  if (current().phase === 'synced') run(current());
  return () => {
    active = false;
    off();
  };
}
let started: Promise<void> | undefined;
export async function startAutoBackup(): Promise<void> {
  if (started) return started;
  const sync = getSharedSyncApi();
  if (!sync) return;
  started = (async () => {
    const storage = getSharedSyncStorage();
    const engine = (await loadSyncEngine()).ensureLibrarySyncEngine();
    attachAutoBackup(
      engine,
      {
        api: createBackupApi(sync),
        storage,
        locks: navigator.locks,
        now: Date.now,
        readLibrary: () =>
          startEffect(
            Effect.gen(function* () {
              const s = yield* (yield* LibraryStore).snapshot;
              return { raw: s.raw, library: s.library };
            }),
          ),
        prefs: () => getDefaultStore().get(prefsAtom),
        syncUserId: () => readSyncMeta(storage).userId,
        deviceId: () => readSyncMeta(storage).deviceId,
        deviceLabel: () => deviceLabel(navigator.userAgent),
      },
      () => getDefaultStore().get(syncStatusAtom),
    );
  })().catch((error: unknown) => {
    started = undefined;
    throw error;
  });
  return started;
}
