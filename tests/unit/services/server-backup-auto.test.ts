import { beforeEach, expect, it, vi } from 'vitest';
import {
  runAutoBackup,
  attachAutoBackup,
  shrunk,
  autoBackupInterval,
  AUTO_BACKUP_INTERVAL_MS,
} from 'src/services/server-backup/auto-backup';
import type { AutoBackupDeps } from 'src/services/server-backup/auto-backup';
import {
  readServerBackupLocal,
  writeServerBackupLocal,
  EMPTY_SERVER_BACKUP_LOCAL,
} from 'src/services/server-backup/storage';
import { libraryContentHash } from 'src/services/server-backup/snapshot';
import { OFF_STATUS, type SyncStatus } from 'src/stores/sync-status';
import { makeLibrary, place } from '../domain/backup/fixtures';
const now = 200000000;
const library = makeLibrary({ places: [place(1)] });
const counts = { places: 30, labels: 1, trips: 0, meetings: 0 };
const meta = {
  id: '0123456789abcdef',
  createdAt: 0,
  exportedAt: new Date(0).toISOString(),
  storedBytes: 10,
  rawBytes: 20,
  contentHash: 'other',
  counts: { ...counts, places: 1 },
  deviceId: 'abcdefgh12345678',
  deviceLabel: '시험',
  reason: 'manual' as const,
};
function deps(): AutoBackupDeps {
  return {
    api: {
      meta: vi.fn().mockResolvedValue({
        ok: true,
        data: { now, writable: true, maxStoredBytes: 1048576, backup: null },
      }),
      upload: vi.fn().mockResolvedValue({ ok: true, data: { now, backup: meta } }),
      download: vi.fn(),
      remove: vi.fn(),
    },
    storage: localStorage,
    now: () => now,
    readLibrary: async () => ({ raw: library, library }),
    prefs: () => null,
    syncUserId: () => 'me',
    deviceId: () => 'abcdefgh12345678',
    deviceLabel: () => '시험',
    build: vi.fn().mockResolvedValue({
      ok: true,
      snapshot: {
        data: 'H4sI',
        storedBytes: 3,
        rawBytes: 10,
        contentHash: 'abc',
        counts: meta.counts,
        exportedAt: meta.exportedAt,
      },
    }),
  };
}
beforeEach(() => {
  localStorage.clear();
  writeServerBackupLocal(localStorage, { ...EMPTY_SERVER_BACKUP_LOCAL, auto: true, userId: 'me' });
});
it('꺼짐·동기화 전·기한 전에는 요청하지 않는다', async () => {
  const d = deps();
  expect(await runAutoBackup({ phase: 'local' }, d)).toBe('not-synced');
  writeServerBackupLocal(localStorage, {
    ...readServerBackupLocal(localStorage),
    nextCheckAt: now + 1,
  });
  expect(await runAutoBackup({ phase: 'synced' }, d)).toBe('waiting');
  writeServerBackupLocal(localStorage, { ...readServerBackupLocal(localStorage), auto: false });
  expect(await runAutoBackup({ phase: 'synced' }, d)).toBe('disabled');
  expect(d.api.meta).not.toHaveBeenCalled();
});
it('다른 사용자의 기한과 결과를 비우고 서버에 없는 백업을 조건부로 올린다', async () => {
  const d = deps();
  writeServerBackupLocal(localStorage, {
    ...readServerBackupLocal(localStorage),
    userId: 'you',
    nextCheckAt: now + 1,
  });
  expect(await runAutoBackup({ phase: 'synced' }, d)).toBe('uploaded');
  expect(d.api.upload).toHaveBeenCalledWith(
    expect.objectContaining({ reason: 'auto', ifMatch: null }),
  );
  expect(readServerBackupLocal(localStorage)).toMatchObject({
    userId: 'me',
    last: { at: now, outcome: 'uploaded' },
    nextCheckAt: now + 86400000,
  });
});
it.each([
  ['off', { writable: false }, 86400000],
  ['recent', { backup: { ...meta, createdAt: now - 1000 } }, 86400000 - 1000],
  ['unchanged', { backup: { ...meta, contentHash: libraryContentHash(library) } }, 86400000],
  ['skipped-shrunk', { backup: { ...meta, counts } }, 86400000],
] as const)('%s이면 올리지 않고 기한을 기록한다', async (step, over, wait) => {
  const d = deps();
  vi.mocked(d.api.meta).mockResolvedValue({
    ok: true,
    data: { now, writable: true, maxStoredBytes: 1048576, backup: null, ...over },
  });
  expect(await runAutoBackup({ phase: 'synced' }, d)).toBe(step);
  expect(d.api.upload).not.toHaveBeenCalled();
  expect(readServerBackupLocal(localStorage).nextCheckAt).toBe(now + wait);
});
it('빈 보관함은 건너뛴다', async () => {
  const d = deps();
  d.readLibrary = async () => ({ raw: {}, library: makeLibrary() });
  expect(await runAutoBackup({ phase: 'synced' }, d)).toBe('skipped-empty');
});
it.each(['auth', 'not-allowed', 'offline', 'server'] as const)(
  '메타 실패 %s를 기록한다',
  async (reason) => {
    const d = deps();
    vi.mocked(d.api.meta).mockResolvedValue({ ok: false, reason });
    const auth = reason === 'auth' || reason === 'not-allowed';
    expect(await runAutoBackup({ phase: 'synced' }, d)).toBe(auth ? 'auth' : 'failed');
    expect(readServerBackupLocal(localStorage).nextCheckAt).toBe(auth ? null : now + 3600000);
  },
);
it.each(['changed', 'limit', 'off', 'server', 'auth'] as const)(
  '쓰기 실패 %s를 기록한다',
  async (reason) => {
    const d = deps();
    vi.mocked(d.api.meta).mockResolvedValue({
      ok: true,
      data: { now, writable: true, maxStoredBytes: 1048576, backup: meta },
    });
    vi.mocked(d.api.upload).mockResolvedValue({ ok: false, reason });
    expect(await runAutoBackup({ phase: 'synced' }, d)).toBe(
      reason === 'server' ? 'failed' : reason,
    );
    expect(d.api.upload).toHaveBeenCalledWith(expect.objectContaining({ ifMatch: meta.id }));
  },
);
it.each(['too-large', 'unsupported'] as const)('스냅샷 실패 %s를 기록한다', async (reason) => {
  const d = deps();
  d.build = vi.fn().mockResolvedValue({ ok: false, reason });
  expect(await runAutoBackup({ phase: 'synced' }, d)).toBe(reason);
  expect(readServerBackupLocal(localStorage).last?.outcome).toBe(reason);
});
it('잠금을 얻지 못하면 요청하지 않는다', async () => {
  const d = deps();
  d.locks = { request: vi.fn((_name, _opts, fn) => fn(null)) } as unknown as Pick<
    LockManager,
    'request'
  >;
  expect(await runAutoBackup({ phase: 'synced' }, d)).toBe('busy');
  expect(d.api.meta).not.toHaveBeenCalled();
});
it('줄어듦 경계와 개발 간격을 검사한다', () => {
  expect(shrunk({ ...counts, places: 19 }, { ...counts, places: 1 })).toBe(false);
  expect(shrunk({ ...counts, places: 20 }, { ...counts, places: 9 })).toBe(true);
  expect(shrunk({ ...counts, places: 20 }, { ...counts, places: 10 })).toBe(false);
  expect(autoBackupInterval({ DEV: true, VITE_AUTO_BACKUP_INTERVAL_MS: '60000' })).toBe(60000);
  expect(autoBackupInterval({ DEV: false, VITE_AUTO_BACKUP_INTERVAL_MS: '60000' })).toBe(
    AUTO_BACKUP_INTERVAL_MS,
  );
  expect(autoBackupInterval({ DEV: true, VITE_AUTO_BACKUP_INTERVAL_MS: 'abc' })).toBe(
    AUTO_BACKUP_INTERVAL_MS,
  );
});
it('붙일 때 synced만 실행하고 진행 중 중복 신호와 해제 뒤 신호를 버린다', async () => {
  const d = deps();
  let listener: (s: SyncStatus) => void = () => {};
  const unsubscribe = vi.fn();
  const engine = {
    onRunFinished: vi.fn((fn: typeof listener) => {
      listener = fn;
      return unsubscribe;
    }),
  };
  const detach = attachAutoBackup(engine, d, () => ({ phase: 'synced' }));
  listener({ ...OFF_STATUS, phase: 'synced' });
  listener({ ...OFF_STATUS, phase: 'synced' });
  await vi.waitFor(() => expect(d.api.upload).toHaveBeenCalledOnce());
  detach();
  expect(unsubscribe).toHaveBeenCalledOnce();
  listener({ ...OFF_STATUS, phase: 'synced' });
  expect(d.api.meta).toHaveBeenCalledOnce();
  const d2 = deps();
  attachAutoBackup(engine, d2, () => ({ phase: 'local' }));
  expect(d2.api.meta).not.toHaveBeenCalled();
});
it.each(['account', 'auto', 'phase'] as const)(
  '진행 중 %s가 바뀌면 자동 업로드를 취소한다',
  async (change) => {
    const d = deps();
    let userId = 'me';
    const status = { phase: 'synced' as SyncStatus['phase'] };
    d.syncUserId = () => userId;
    d.build = vi.fn().mockImplementation(async () => {
      if (change === 'account') userId = 'you';
      if (change === 'auto')
        writeServerBackupLocal(localStorage, {
          ...readServerBackupLocal(localStorage),
          auto: false,
        });
      if (change === 'phase') status.phase = 'off';
      return {
        ok: true,
        snapshot: {
          data: 'H4sI',
          rawBytes: 1,
          storedBytes: 3,
          contentHash: 'abc',
          counts: meta.counts,
          exportedAt: meta.exportedAt,
        },
      };
    });
    expect(await runAutoBackup(status, d)).toBe(
      change === 'account' ? 'auth' : change === 'auto' ? 'disabled' : 'not-synced',
    );
    expect(d.api.upload).not.toHaveBeenCalled();
    expect(readServerBackupLocal(localStorage).nextCheckAt).toBe(now + 5 * 60000);
  },
);
it.each(['meta', 'read', 'build', 'upload', 'throw'] as const)(
  '요청 뒤 %s 단계에서 취소되면 5분 뒤 다시 확인한다',
  async (stage) => {
    const d = deps();
    const status = { phase: 'synced' as SyncStatus['phase'] };
    const stop = () => {
      status.phase = 'syncing';
    };
    if (stage === 'meta' || stage === 'throw') {
      const meta = d.api.meta;
      d.api.meta = async () => {
        stop();
        if (stage === 'throw') throw Error('연결 실패');
        return meta();
      };
    } else if (stage === 'read') {
      const read = d.readLibrary;
      d.readLibrary = async () => {
        stop();
        return read();
      };
    } else if (stage === 'build') {
      const build = d.build!;
      d.build = async (input) => {
        stop();
        return build(input);
      };
    } else {
      const upload = d.api.upload;
      d.api.upload = async (body) => {
        stop();
        return upload(body);
      };
    }
    expect(await runAutoBackup(status, d)).toBe('not-synced');
    expect(readServerBackupLocal(localStorage)).toMatchObject({
      nextCheckAt: now + 5 * 60000,
      last: null,
    });
    status.phase = 'synced';
    expect(await runAutoBackup(status, d)).toBe('waiting');
  },
);
