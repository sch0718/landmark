import { readJson } from '@sch0718/firebase-session/worker';
import type { MeetDb } from '../meet/db';
import { requireSyncUser } from './auth';
import type { SyncEnv, SyncDeps, SyncContext } from './env';
import { SyncHttpError, syncJson } from './http';
import { consumeCounter, counterKey } from './limits';
import type { SyncRoute } from './router';

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MAX_STORED_BYTES = 1_048_576;
export const BACKUP_MAX_DATA_CHARS = 1_398_104;
export const BACKUP_PART_CHARS = 524_288;
export const BACKUP_MAX_BODY_BYTES = 1_500_000;
export const BACKUP_MAX_RAW_BYTES = 16_777_216;
export const BACKUP_COUNT_MAX = 1_000_000;
export const BACKUP_LIMITS = { write: 20, read: 200 } as const;
export type BackupCounts = { places: number; labels: number; trips: number; meetings: number };
export type BackupReason = 'manual' | 'auto';
export type BackupMeta = {
  id: string;
  createdAt: number;
  exportedAt: string;
  storedBytes: number;
  rawBytes: number;
  contentHash: string;
  counts: BackupCounts;
  deviceId: string;
  deviceLabel: string;
  reason: BackupReason;
};
export type BackupBody = {
  v: 1;
  format: 1;
  data: string;
  rawBytes: number;
  contentHash: string;
  counts: BackupCounts;
  exportedAt: string;
  deviceId: string;
  deviceLabel: string;
  reason: BackupReason;
  ifMatch?: string | null;
};
export function backupWritable(env: SyncEnv): boolean {
  return env.AUTO_BACKUP !== 'off' && env.LIBRARY_SYNC !== 'off';
}
export function storedBytesOf(data: string): number {
  return (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}
export function splitParts(data: string): string[] {
  if (!data.length) throw new SyncHttpError(422, 'invalid', { path: 'data' });
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += BACKUP_PART_CHARS)
    parts.push(data.slice(i, i + BACKUP_PART_CHARS));
  return parts;
}
function invalid(path: string): never {
  throw new SyncHttpError(422, 'invalid', { path });
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}
function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}
function integer(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
export function parseBackupBody(value: unknown): BackupBody {
  const b = record(value, 'body');
  const keys = [
    'v',
    'format',
    'data',
    'rawBytes',
    'contentHash',
    'counts',
    'exportedAt',
    'deviceId',
    'deviceLabel',
    'reason',
    'ifMatch',
  ];
  for (const key of Object.keys(b)) if (!keys.includes(key)) invalid(key);
  if (b.v !== 1) invalid('v');
  if (b.format !== 1) invalid('format');
  if (typeof b.data === 'string' && b.data.length > BACKUP_MAX_DATA_CHARS)
    throw new SyncHttpError(413, 'too-large');
  if (
    typeof b.data !== 'string' ||
    !b.data.startsWith('H4sI') ||
    b.data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(b.data)
  )
    invalid('data');
  if (storedBytesOf(b.data) > BACKUP_MAX_STORED_BYTES) throw new SyncHttpError(413, 'too-large');
  if (!integer(b.rawBytes, 1, BACKUP_MAX_RAW_BYTES)) invalid('rawBytes');
  if (!matches(b.contentHash, /^[0-9a-z]{1,16}$/)) invalid('contentHash');
  const counts = record(b.counts, 'counts');
  const countKeys = ['places', 'labels', 'trips', 'meetings'];
  for (const key of Object.keys(counts)) if (!countKeys.includes(key)) invalid('counts.' + key);
  for (const key of countKeys)
    if (!integer(counts[key], 0, BACKUP_COUNT_MAX)) invalid('counts.' + key);
  if (
    typeof b.exportedAt !== 'string' ||
    b.exportedAt.length > 30 ||
    !Number.isFinite(Date.parse(b.exportedAt))
  )
    invalid('exportedAt');
  if (!matches(b.deviceId, /^[a-z0-9]{16}$/)) invalid('deviceId');
  if (
    typeof b.deviceLabel !== 'string' ||
    !b.deviceLabel.trim() ||
    b.deviceLabel.trim().length > 40 ||
    Array.from(b.deviceLabel).some(
      (c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
    )
  )
    invalid('deviceLabel');
  if (b.reason !== 'manual' && b.reason !== 'auto') invalid('reason');
  if (b.ifMatch !== undefined && b.ifMatch !== null && !matches(b.ifMatch, /^[0-9a-f]{16}$/))
    invalid('ifMatch');
  return { ...(b as BackupBody), deviceLabel: b.deviceLabel.trim() };
}
export function newBackupId(deps: Pick<SyncDeps, 'random'>): string {
  return Array.from(deps.random(8), (b) => b.toString(16).padStart(2, '0')).join('');
}
type MetaRow = {
  id: string;
  created_at: number;
  exported_at: string;
  stored_bytes: number;
  raw_bytes: number;
  content_hash: string;
  places: number;
  labels: number;
  trips: number;
  meetings: number;
  device_id: string;
  device_label: string;
  reason: BackupReason;
  parts: number;
};
export async function readBackupMeta(db: MeetDb, userId: string): Promise<BackupMeta | null> {
  const row = await db
    .prepare(
      `SELECT id, created_at, exported_at, stored_bytes, raw_bytes, content_hash, places, labels, trips, meetings, device_id, device_label, reason, parts FROM library_backups WHERE user_id = ?1`,
    )
    .bind(userId)
    .first<MetaRow>();
  return row
    ? {
        id: row.id,
        createdAt: row.created_at,
        exportedAt: row.exported_at,
        storedBytes: row.stored_bytes,
        rawBytes: row.raw_bytes,
        contentHash: row.content_hash,
        counts: {
          places: row.places,
          labels: row.labels,
          trips: row.trips,
          meetings: row.meetings,
        },
        deviceId: row.device_id,
        deviceLabel: row.device_label,
        reason: row.reason,
      }
    : null;
}
export async function writeBackup(
  db: MeetDb,
  userId: string,
  body: BackupBody,
  id: string,
  now: number,
): Promise<BackupMeta> {
  const parts = splitParts(body.data);
  const columns = [
    'id',
    'format',
    'parts',
    'stored_bytes',
    'raw_bytes',
    'content_hash',
    'places',
    'labels',
    'trips',
    'meetings',
    'exported_at',
    'device_id',
    'device_label',
    'reason',
    'created_at',
  ];
  const conflict =
    body.ifMatch === null
      ? 'DO NOTHING'
      : 'DO UPDATE SET ' +
        columns.map((c) => `${c} = excluded.${c}`).join(', ') +
        (body.ifMatch === undefined ? '' : ' WHERE library_backups.id = ?16');
  const values = [
    userId,
    id,
    parts.length,
    storedBytesOf(body.data),
    body.rawBytes,
    body.contentHash,
    body.counts.places,
    body.counts.labels,
    body.counts.trips,
    body.counts.meetings,
    body.exportedAt,
    body.deviceId,
    body.deviceLabel,
    body.reason,
    now,
  ];
  if (typeof body.ifMatch === 'string') values.push(body.ifMatch);
  await db.batch([
    ...parts.map((data, idx) =>
      db
        .prepare(
          'INSERT INTO library_backup_parts (user_id, backup_id, idx, data) VALUES (?1, ?2, ?3, ?4)',
        )
        .bind(userId, id, idx, data),
    ),
    db
      .prepare(
        `INSERT INTO library_backups (user_id, ${columns.join(', ')}) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) ON CONFLICT(user_id) ${conflict}`,
      )
      .bind(...values),
    db
      .prepare(
        'DELETE FROM library_backup_parts WHERE user_id = ?1 AND backup_id IS NOT (SELECT id FROM library_backups WHERE user_id = ?1)',
      )
      .bind(userId),
  ]);
  const meta = await readBackupMeta(db, userId);
  if (meta?.id !== id) throw new SyncHttpError(409, 'backup-changed');
  return meta;
}
export async function readBackupData(
  db: MeetDb,
  userId: string,
  id: string | null,
): Promise<string> {
  const { results } = await db
    .prepare(
      'SELECT b.id AS id, b.parts AS parts, p.idx AS idx, p.data AS data FROM library_backups b JOIN library_backup_parts p ON p.user_id = b.user_id AND p.backup_id = b.id WHERE b.user_id = ?1 ORDER BY p.idx',
    )
    .bind(userId)
    .all<{ id: string; parts: number; idx: number; data: string }>();
  if (!results.length) {
    if ((await readBackupMeta(db, userId)) === null) throw new SyncHttpError(404, 'no-backup');
    throw new SyncHttpError(409, 'backup-changed');
  }
  const first = results[0]!;
  if (
    (id !== null && first.id !== id) ||
    first.parts !== results.length ||
    results.some((r, i) => r.idx !== i)
  )
    throw new SyncHttpError(409, 'backup-changed');
  return '{"id":"' + first.id + '","data":"' + results.map((r) => r.data).join('') + '"}';
}
export async function deleteBackup(db: MeetDb, userId: string): Promise<void> {
  await db.batch(
    ['library_backup_parts', 'library_backups'].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?1`).bind(userId),
    ),
  );
}
export function parseDataQuery(url: URL): { id: string | null } {
  for (const key of url.searchParams.keys()) if (key !== 'id') invalid(key);
  const id = url.searchParams.get('id');
  if (url.searchParams.getAll('id').length > 1 || (id !== null && !/^[0-9a-f]{16}$/.test(id)))
    invalid('id');
  return { id };
}
/** 요청을 준비한 계정과 인증이 끝난 계정이 다르면 적용하지 않는다. 옛 요청의 머리글 생략은 허용한다. */
async function requireBackupUser(ctx: SyncContext, deps: SyncDeps) {
  const user = await requireSyncUser(ctx, deps);
  const expected = ctx.request.headers.get('X-Landmark-Backup-User');
  if (expected !== null && expected !== user.userId)
    throw new SyncHttpError(401, 'reauth-required');
  return user;
}

export const BACKUP_ROUTES: SyncRoute[] = [
  {
    method: 'GET',
    path: /^\/v1\/backup$/,
    pattern: '/v1/backup',
    allowWhenOff: true,
    async run(ctx, deps) {
      const now = deps.now();
      const user = await requireBackupUser(ctx, deps);
      if (
        !(await consumeCounter(
          ctx.env.DB!,
          counterKey('backup-read', user.userId, now),
          1,
          BACKUP_LIMITS.read,
        ))
      )
        throw new SyncHttpError(429, 'rate-limited');
      return syncJson(200, {
        now,
        writable: backupWritable(ctx.env),
        maxStoredBytes: BACKUP_MAX_STORED_BYTES,
        backup: await readBackupMeta(ctx.env.DB!, user.userId),
      });
    },
  },
  {
    method: 'POST',
    path: /^\/v1\/backup$/,
    pattern: '/v1/backup',
    async run(ctx, deps) {
      const now = deps.now();
      if (ctx.env.AUTO_BACKUP === 'off') throw new SyncHttpError(503, 'off');
      const user = await requireBackupUser(ctx, deps);
      const body = parseBackupBody(await readJson(ctx.request, BACKUP_MAX_BODY_BYTES));
      if (
        !(await consumeCounter(
          ctx.env.DB!,
          counterKey('backup-write', user.userId, now),
          1,
          BACKUP_LIMITS.write,
        ))
      )
        throw new SyncHttpError(429, 'rate-limited');
      return syncJson(200, {
        now,
        backup: await writeBackup(ctx.env.DB!, user.userId, body, newBackupId(deps), now),
      });
    },
  },
  {
    method: 'GET',
    path: /^\/v1\/backup\/data$/,
    pattern: '/v1/backup/data',
    allowWhenOff: true,
    async run(ctx, deps, _params, url) {
      const now = deps.now();
      const { id } = parseDataQuery(url);
      const user = await requireBackupUser(ctx, deps);
      if (
        !(await consumeCounter(
          ctx.env.DB!,
          counterKey('backup-read', user.userId, now),
          1,
          BACKUP_LIMITS.read,
        ))
      )
        throw new SyncHttpError(429, 'rate-limited');
      return new Response(await readBackupData(ctx.env.DB!, user.userId, id), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store',
        },
      });
    },
  },
  {
    method: 'DELETE',
    path: /^\/v1\/backup$/,
    pattern: '/v1/backup',
    allowWhenOff: true,
    async run(ctx, deps) {
      const user = await requireBackupUser(ctx, deps);
      await deleteBackup(ctx.env.DB!, user.userId);
      return syncJson(204, null);
    },
  },
];
