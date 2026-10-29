import type { SyncApi } from 'src/services/library-sync/api';
import type { BuiltSnapshot } from './snapshot';
export type BackupFailure =
  | 'auth'
  | 'not-allowed'
  | 'offline'
  | 'off'
  | 'limit'
  | 'too-large'
  | 'invalid'
  | 'changed'
  | 'not-found'
  | 'server';
export type BackupResult<T> = { ok: true; data: T } | { ok: false; reason: BackupFailure };
export type BackupCounts = { places: number; labels: number; trips: number; meetings: number };
export type ServerBackupMeta = {
  id: string;
  createdAt: number;
  exportedAt: string;
  storedBytes: number;
  rawBytes: number;
  contentHash: string;
  counts: BackupCounts;
  deviceId: string;
  deviceLabel: string;
  reason: 'manual' | 'auto';
};
export type BackupMetaReply = {
  now: number;
  writable: boolean;
  maxStoredBytes: number;
  backup: ServerBackupMeta | null;
};
export type BackupUpload = {
  v: 1;
  format: 1;
  data: string;
  rawBytes: number;
  contentHash: string;
  counts: BackupCounts;
  exportedAt: string;
  deviceId: string;
  deviceLabel: string;
  reason: 'manual' | 'auto';
  ifMatch?: string | null;
};
export type BackupApi = {
  meta(): Promise<BackupResult<BackupMetaReply>>;
  upload(body: BackupUpload): Promise<BackupResult<{ now: number; backup: ServerBackupMeta }>>;
  download(id: string): Promise<BackupResult<{ id: string; data: string }>>;
  remove(): Promise<BackupResult<null>>;
};
export function toBackupFailure(fail: {
  kind: string;
  code?: string;
  status?: number;
}): BackupFailure {
  switch (fail.kind) {
    case 'auth':
    case 'not-allowed':
    case 'offline':
    case 'off':
    case 'not-found':
      return fail.kind;
    case 'busy':
      return 'changed';
    case 'limit':
      return fail.code === 'off' ? 'off' : 'limit';
    case 'invalid':
      return fail.code === 'too-large' ? 'too-large' : 'invalid';
    case 'server':
      return fail.status === 409 ? 'changed' : 'server';
    default:
      return 'server';
  }
}
export function createBackupApi(api: Pick<SyncApi, 'client'>): BackupApi {
  async function send<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: BackupUpload,
  ): Promise<BackupResult<T>> {
    const r =
      body === undefined
        ? await api.client.send<T>(method, path)
        : await api.client.send<T>(method, path, { body });
    return r.ok ? { ok: true, data: r.data } : { ok: false, reason: toBackupFailure(r) };
  }
  return {
    meta: () => send('GET', '/v1/backup'),
    upload: (body) => send('POST', '/v1/backup', body),
    download: (id) => send('GET', '/v1/backup/data?id=' + encodeURIComponent(id)),
    remove: async () => {
      const r = await send('DELETE', '/v1/backup');
      return r.ok ? { ok: true, data: null } : r;
    },
  };
}
export function uploadBody(
  s: BuiltSnapshot,
  device: { deviceId: string; deviceLabel: string },
  reason: 'manual' | 'auto',
  ifMatch?: string | null,
): BackupUpload {
  return {
    v: 1,
    format: 1,
    data: s.data,
    rawBytes: s.rawBytes,
    contentHash: s.contentHash,
    counts: s.counts,
    exportedAt: s.exportedAt,
    ...device,
    reason,
    ...(ifMatch === undefined ? {} : { ifMatch }),
  };
}
