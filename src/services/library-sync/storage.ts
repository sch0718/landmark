import type { BaseEntry, BaseMap, Conflict, HeldItem } from 'src/domain/library-sync/apply';
export const SYNC_META_KEY = 'tripmap:sync:v1';
export const SYNC_BASE_KEY = 'tripmap:sync-base:v1';
export const SYNC_CONFLICTS_KEY = 'tripmap:sync-conflicts:v1';
export const SYNC_SESSION_KEY = 'tripmap:sync-session:v1';
export type SyncProvider = 'google' | 'kakao' | 'naver';
export type SyncCursor = { rev: number; key: string };
export type RejectedItem = { key: string; hash: string; reason: 'invalid' | 'too-large' | 'clock' };
export type SyncMeta = {
  v: 1;
  enabled: boolean;
  pendingChoice: boolean;
  userId: string | null;
  provider: SyncProvider | null;
  accountLabel: string | null;
  deviceId: string;
  cursor: SyncCursor | null;
  lastSyncAt: string | null;
  held: HeldItem[];
  skipped: string[];
  skippedAt?: Record<string, string>;
  rejected: RejectedItem[];
};
export class SyncStorageError extends Error {
  constructor() {
    super('동기화 기록을 저장하지 못했어요');
  }
}
const provider = (s: unknown): s is SyncProvider =>
  s === 'google' || s === 'kakao' || s === 'naver';
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function read(storage: Storage, key: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? 'null');
    return record(value) && value.v === 1 ? value : null;
  } catch {
    return null;
  }
}
function write(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    throw new SyncStorageError();
  }
}
function remove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    throw new SyncStorageError();
  }
}
const itemKeyValid = (v: unknown): v is string =>
  typeof v === 'string' && /^(label|place|folder|trip|meeting):[A-Za-z0-9]{1,64}$/.test(v);
const nullableString = (v: unknown) => v === null || typeof v === 'string';
export function newDeviceMeta(): SyncMeta {
  let deviceId = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  while (deviceId.length < 16)
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < 252) deviceId += alphabet[byte % 36];
      if (deviceId.length === 16) break;
    }
  return {
    v: 1,
    enabled: false,
    pendingChoice: false,
    userId: null,
    provider: null,
    accountLabel: null,
    deviceId,
    cursor: null,
    lastSyncAt: null,
    held: [],
    skipped: [],
    skippedAt: {},
    rejected: [],
  };
}
export function readSyncMeta(storage: Storage = localStorage): SyncMeta {
  const v = read(storage, SYNC_META_KEY);
  if (
    !v ||
    typeof v.enabled !== 'boolean' ||
    typeof v.pendingChoice !== 'boolean' ||
    !nullableString(v.userId) ||
    !(v.provider === null || provider(v.provider)) ||
    !nullableString(v.accountLabel) ||
    typeof v.deviceId !== 'string' ||
    !/^[a-z0-9]{16}$/.test(v.deviceId) ||
    !nullableString(v.lastSyncAt) ||
    !(
      v.cursor === null ||
      (record(v.cursor) &&
        Number.isSafeInteger(v.cursor.rev) &&
        Number(v.cursor.rev) >= 0 &&
        typeof v.cursor.key === 'string')
    ) ||
    !Array.isArray(v.held) ||
    !v.held.every(
      (h) =>
        record(h) &&
        itemKeyValid(h.key) &&
        Number.isSafeInteger(h.rev) &&
        Number(h.rev) >= 0 &&
        (h.reason === 'decode' || h.reason === 'library'),
    ) ||
    !Array.isArray(v.skipped) ||
    !v.skipped.every(itemKeyValid) ||
    !(
      v.skippedAt === undefined ||
      (record(v.skippedAt) &&
        Object.entries(v.skippedAt).every(
          ([key, at]) => itemKeyValid(key) && typeof at === 'string',
        ))
    ) ||
    !Array.isArray(v.rejected) ||
    !v.rejected.every(
      (r) =>
        record(r) &&
        itemKeyValid(r.key) &&
        typeof r.hash === 'string' &&
        ['invalid', 'too-large', 'clock'].includes(String(r.reason)),
    )
  )
    return newDeviceMeta();
  return { ...v, skippedAt: v.skippedAt ?? {} } as unknown as SyncMeta;
}
export function writeSyncMeta(storage: Storage, meta: SyncMeta): void {
  write(storage, SYNC_META_KEY, meta);
}
export function encodeBaseEntry(e: BaseEntry): string {
  return `${e.rev.toString(36)}.${e.hash}${e.deleted ? '.d' : ''}`;
}
export function decodeBaseEntry(s: string): BaseEntry | null {
  const match = /^([0-9a-z]+)\.([0-9a-z]+)(\.d)?$/.exec(s);
  if (!match) return null;
  const rev = parseInt(match[1]!, 36);
  return Number.isSafeInteger(rev) ? { rev, hash: match[2]!, deleted: !!match[3] } : null;
}
export function readBase(storage: Storage): { userId: string | null; items: BaseMap } {
  const v = read(storage, SYNC_BASE_KEY);
  if (!v || typeof v.userId !== 'string' || !record(v.items)) return { userId: null, items: {} };
  const items: BaseMap = {};
  for (const [key, value] of Object.entries(v.items)) {
    if (!itemKeyValid(key) || typeof value !== 'string') continue;
    const decoded = decodeBaseEntry(value);
    if (decoded) items[key] = decoded;
  }
  return { userId: v.userId, items };
}
export function writeBase(storage: Storage, userId: string, items: BaseMap): void {
  write(storage, SYNC_BASE_KEY, {
    v: 1,
    userId,
    items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, encodeBaseEntry(v)])),
  });
}
export function readConflicts(storage: Storage): Conflict[] {
  const v = read(storage, SYNC_CONFLICTS_KEY);
  return v && Array.isArray(v.items)
    ? v.items.filter(
        (c): c is Conflict =>
          record(c) &&
          typeof c.id === 'string' &&
          itemKeyValid(c.key) &&
          typeof c.label === 'string' &&
          typeof c.path === 'string' &&
          typeof c.at === 'string' &&
          typeof c.kind === 'string' &&
          ['place', 'label', 'trip', 'folder', 'meeting'].includes(c.kind),
      )
    : [];
}
export function writeConflicts(storage: Storage, items: Conflict[]): void {
  const latest = [...items].sort((a, b) => a.at.localeCompare(b.at)).slice(-50);
  while (latest.length && JSON.stringify({ v: 1, items: latest }).length > 200000) latest.shift();
  write(storage, SYNC_CONFLICTS_KEY, { v: 1, items: latest });
}
export type StoredSession = { v: 1; sessionId: string; provider: SyncProvider };
export function readSession(storage: Storage): StoredSession | null {
  const v = read(storage, SYNC_SESSION_KEY);
  return v &&
    provider(v.provider) &&
    typeof v.sessionId === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(v.sessionId)
    ? (v as StoredSession)
    : null;
}
export function writeSession(storage: Storage, s: StoredSession): void {
  write(storage, SYNC_SESSION_KEY, s);
}
export function clearSession(storage: Storage): void {
  remove(storage, SYNC_SESSION_KEY);
}
export function clearSyncRecords(storage: Storage): void {
  remove(storage, SYNC_BASE_KEY);
  remove(storage, SYNC_CONFLICTS_KEY);
  writeSyncMeta(storage, {
    ...readSyncMeta(storage),
    cursor: null,
    lastSyncAt: null,
    held: [],
    skipped: [],
    skippedAt: {},
    rejected: [],
  });
}
