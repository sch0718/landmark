import {
  decodeItem,
  isDeleted,
  itemKey,
  ITEM_KINDS,
  lastTouched,
  stableStringify,
  tripRefs,
  type AnyItem,
  type ItemKind,
} from '../../domain/library-sync/items';
import { mergeItem } from '../../domain/library-sync/merge';
import type { Trip } from '../../schema/trip';
import type { MeetDb } from '../meet/db';
import type { SyncUser } from './auth';
import { SyncHttpError } from './http';
export const TOMBSTONE_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
export const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const PULL_MAX_LIMIT = 500;
export const PUSH_MAX_ITEMS = 100;
export const PUSH_MAX_BYTES = 1_000_000;
export const CLOCK_SKEW_MS = 10 * 60 * 1000;
export const DEVICE_TOUCH_MS = 60 * 60 * 1000;
export const ACCOUNT_DATA_TABLES: string[] = ['library_items', 'library_devices', 'library_state'];
export type MeReply = {
  userId: string;
  provider: SyncUser['provider'];
  account: string;
  library: { rev: number; items: number; live: number };
  devices: { deviceId: string; sessionId: string; lastSyncAt: number }[];
};
export async function readMe(db: MeetDb, user: SyncUser): Promise<MeReply> {
  const state = await db
    .prepare('SELECT rev FROM library_state WHERE user_id = ?')
    .bind(user.userId)
    .first<{ rev: number }>();
  const counts = await db
    .prepare(
      'SELECT count(*) AS items, coalesce(sum(deleted = 0), 0) AS live FROM library_items WHERE user_id = ?',
    )
    .bind(user.userId)
    .first<{ items: number; live: number }>();
  const devices = await db
    .prepare(
      'SELECT device_id AS deviceId, session_id AS sessionId, last_sync_at AS lastSyncAt FROM library_devices WHERE user_id = ?',
    )
    .bind(user.userId)
    .all<MeReply['devices'][number]>();
  return {
    userId: user.userId,
    provider: user.provider,
    account: user.account,
    library: { rev: state?.rev ?? 0, items: counts?.items ?? 0, live: counts?.live ?? 0 },
    devices: devices.results,
  };
}
export type PullQuery = { since: number; after: string; limit: number; deviceId: string | null };
function invalid(path: string): never {
  throw new SyncHttpError(422, 'invalid', { path });
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const idPattern = /^[A-Za-z0-9]{1,64}$/;
const devicePattern = /^[a-z0-9]{16}$/;
export function parsePullQuery(url: URL): PullQuery {
  const q = url.searchParams;
  for (const key of q.keys())
    if (!['since', 'after', 'limit', 'device'].includes(key) || q.getAll(key).length !== 1)
      invalid(key);
  const number = (key: string, fallback: number) => {
    const raw = q.get(key);
    if (raw !== null && !/^\d+$/.test(raw)) invalid(key);
    const n = raw === null ? fallback : Number(raw);
    if (!integer(n)) invalid(key);
    return n;
  };
  const since = number('since', 0);
  const limit = number('limit', PULL_MAX_LIMIT);
  if (limit < 1 || limit > PULL_MAX_LIMIT) invalid('limit');
  const after = q.get('after') ?? '';
  if (after && !/^(label|place|folder|trip|meeting):[A-Za-z0-9]{1,64}$/.test(after))
    invalid('after');
  const deviceId = q.get('device');
  if (deviceId !== null && !devicePattern.test(deviceId)) invalid('device');
  return { since, after, limit, deviceId };
}
type StateRow = { rev: number; purged_rev: number; purged_at: number };
type ItemRow = { kind: ItemKind; id: string; rev: number; deleted: number; doc: string };
export async function pullChanges(
  db: MeetDb,
  user: SyncUser,
  q: PullQuery,
  now: number,
): Promise<{ body: string; purgedAt: number } | { resync: number }> {
  const state = await db
    .prepare('SELECT rev, purged_rev, purged_at FROM library_state WHERE user_id = ?')
    .bind(user.userId)
    .first<StateRow>();
  if (q.since > 0 && q.since < (state?.purged_rev ?? 0)) return { resync: state!.purged_rev };
  const rows = state
    ? (
        await db
          .prepare(
            "SELECT kind, item_id AS id, rev, deleted, doc FROM library_items WHERE user_id = ?1 AND (rev > ?2 OR (rev = ?2 AND (kind || ':' || item_id) > ?3)) ORDER BY rev, kind || ':' || item_id LIMIT ?4",
          )
          .bind(user.userId, q.since, q.after, q.limit + 1)
          .all<ItemRow>()
      ).results
    : [];
  const more = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const last = items.at(-1);
  const next = last
    ? { rev: last.rev, key: itemKey(last.kind, last.id) }
    : { rev: q.since, key: q.after };
  if (state && !more && q.deviceId)
    await db
      .prepare(
        `INSERT INTO library_devices (user_id, device_id, session_id, last_rev, last_sync_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(user_id, device_id) DO UPDATE SET session_id = excluded.session_id, last_rev = excluded.last_rev, last_sync_at = excluded.last_sync_at WHERE library_devices.session_id <> excluded.session_id OR library_devices.last_sync_at <= excluded.last_sync_at - ${DEVICE_TOUCH_MS}`,
      )
      .bind(user.userId, q.deviceId, user.sessionId, next.rev, now)
      .run();
  const docs = items
    .map(
      (r) =>
        '{"kind":' +
        JSON.stringify(r.kind) +
        ',"id":' +
        JSON.stringify(r.id) +
        ',"rev":' +
        r.rev +
        ',"deleted":' +
        (r.deleted === 1) +
        ',"doc":' +
        r.doc +
        '}',
    )
    .join(',');
  return {
    body:
      '{"rev":' +
      (state?.rev ?? 0) +
      ',"purgedRev":' +
      (state?.purged_rev ?? 0) +
      ',"more":' +
      more +
      ',"next":' +
      JSON.stringify(next) +
      ',"items":[' +
      docs +
      ']}',
    purgedAt: state?.purged_at ?? now,
  };
}
export type PushItem = {
  kind: ItemKind;
  id: string;
  baseRev: number;
  baseDeleted: boolean | null;
  doc: unknown;
};
export type PushBody = { v: 1; deviceId: string; items: PushItem[] };
export function parsePushBody(value: unknown): PushBody {
  if (!isRecord(value)) invalid('');
  if (Object.keys(value).some((k) => !['v', 'deviceId', 'items'].includes(k))) invalid('');
  if (value.v !== 1) invalid('v');
  if (typeof value.deviceId !== 'string' || !devicePattern.test(value.deviceId))
    invalid('deviceId');
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > PUSH_MAX_ITEMS)
    invalid('items');
  const seen = new Set<string>();
  for (const [i, v] of (value.items as unknown[]).entries()) {
    const path = `items.${i}`;
    if (!isRecord(v)) invalid(path);
    if (Object.keys(v).some((k) => !['kind', 'id', 'baseRev', 'baseDeleted', 'doc'].includes(k)))
      invalid(path);
    if (!ITEM_KINDS.includes(v.kind as ItemKind)) invalid(path + '.kind');
    if (typeof v.id !== 'string' || !idPattern.test(v.id)) invalid(path + '.id');
    if (!integer(v.baseRev)) invalid(path + '.baseRev');
    if (v.baseDeleted !== null && typeof v.baseDeleted !== 'boolean')
      invalid(path + '.baseDeleted');
    if (!Object.hasOwn(v, 'doc')) invalid(path + '.doc');
    const key = `${v.kind}:${v.id}`;
    if (seen.has(key)) invalid(path);
    seen.add(key);
  }
  return value as unknown as PushBody;
}
export type PushReply = {
  rev: number;
  results: { kind: ItemKind; id: string; rev: number; doc?: unknown }[];
  rejected: { kind: ItemKind; id: string; reason: 'invalid' | 'too-large' | 'clock' }[];
};
export async function pushItems(
  db: MeetDb,
  user: SyncUser,
  body: PushBody,
  now: number,
): Promise<PushReply> {
  const accepted: { item: PushItem; doc: AnyItem; text: string }[] = [];
  const rejected: PushReply['rejected'] = [];
  for (const item of body.items) {
    const decoded = decodeItem(item.kind, item.id, item.doc);
    const reason = !decoded.ok
      ? decoded.reason
      : Date.parse(lastTouched(decoded.doc)) > now + CLOCK_SKEW_MS
        ? 'clock'
        : null;
    if (reason) {
      rejected.push({ kind: item.kind, id: item.id, reason });
      continue;
    }
    const doc = (decoded as { ok: true; doc: AnyItem }).doc;
    accepted.push({ item, doc, text: stableStringify(doc) });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await db
      .prepare('SELECT rev FROM library_state WHERE user_id = ?')
      .bind(user.userId)
      .first<{ rev: number }>();
    const r0 = state?.rev ?? 0;
    const rows = accepted.length
      ? (
          await db
            .prepare(
              "SELECT kind, item_id AS id, rev, deleted, doc FROM library_items WHERE user_id = ?1 AND (kind || ':' || item_id) IN (SELECT value FROM json_each(?2))",
            )
            .bind(user.userId, JSON.stringify(accepted.map((a) => itemKey(a.item.kind, a.item.id))))
            .all<ItemRow>()
        ).results
      : [];
    const byKey = new Map(rows.map((r) => [itemKey(r.kind, r.id), r]));
    const evaluated = accepted.map((a) => {
      const stored = byKey.get(itemKey(a.item.kind, a.item.id));
      const doc =
        !stored || stored.rev === a.item.baseRev
          ? a.doc
          : mergeItem(a.item.kind, JSON.parse(stored.doc) as AnyItem, a.doc, {
              baseDeleted: a.item.baseDeleted ?? undefined,
            }).doc;
      const text = stableStringify(doc);
      return {
        ...a,
        stored,
        result: doc,
        resultText: text,
        changed: !stored || text !== stored.doc,
      };
    });
    const changed = evaluated.filter((e) => e.changed);
    let rev = r0;
    if (changed.length) {
      const data = changed.map((e) => ({
        kind: e.item.kind,
        id: e.item.id,
        doc: e.resultText,
        deleted: isDeleted(e.result) ? 1 : 0,
        deletedAt: isDeleted(e.result) ? now : null,
        refs: e.item.kind === 'trip' ? ',' + tripRefs(e.result as Trip).join(',') + ',' : null,
      }));
      const batch = (await db.batch([
        db
          .prepare(
            'INSERT INTO library_state (user_id, rev, purged_rev, purged_at, created_at, updated_at) VALUES (?1, 1, 0, 0, ?2, ?2) ON CONFLICT(user_id) DO UPDATE SET rev = library_state.rev + 1, updated_at = excluded.updated_at',
          )
          .bind(user.userId, now),
        db
          .prepare(
            `INSERT INTO library_items (user_id, kind, item_id, rev, doc, deleted, deleted_at, refs, device_id, updated_at) SELECT ?1, json_extract(value, '$.kind'), json_extract(value, '$.id'), (SELECT rev FROM library_state WHERE user_id = ?1), json_extract(value, '$.doc'), json_extract(value, '$.deleted'), json_extract(value, '$.deletedAt'), json_extract(value, '$.refs'), ?2, ?3 FROM json_each(?4) WHERE true ON CONFLICT(user_id, kind, item_id) DO UPDATE SET rev = excluded.rev, doc = excluded.doc, deleted = excluded.deleted, deleted_at = CASE WHEN excluded.deleted = 0 THEN NULL WHEN library_items.deleted = 1 THEN library_items.deleted_at ELSE excluded.deleted_at END, refs = excluded.refs, device_id = excluded.device_id, updated_at = excluded.updated_at WHERE library_items.rev <= ?5`,
          )
          .bind(user.userId, body.deviceId, now, JSON.stringify(data), r0),
        db.prepare('SELECT rev FROM library_state WHERE user_id = ?').bind(user.userId),
      ])) as { meta: { changes: number }; results: { rev: number }[] }[];
      if (batch[1]!.meta.changes < changed.length) continue;
      rev = batch[2]!.results[0]!.rev;
    }
    return {
      rev,
      rejected,
      results: evaluated.map((e) => ({
        kind: e.item.kind,
        id: e.item.id,
        rev: e.changed ? rev : e.stored!.rev,
        ...(e.resultText !== e.text ? { doc: e.result } : {}),
      })),
    };
  }
  throw new SyncHttpError(409, 'busy');
}
export async function purgeTombstones(db: MeetDb, userId: string, now: number): Promise<number> {
  const rows = (
    await db
      .prepare(
        "SELECT i.kind, i.item_id AS id, i.rev FROM library_items i WHERE i.user_id = ?1 AND i.deleted = 1 AND i.deleted_at <= ?2 AND NOT (i.kind = 'place' AND EXISTS (SELECT 1 FROM library_items t WHERE t.user_id = ?1 AND t.kind = 'trip' AND instr(t.refs, ',' || i.item_id || ',') > 0)) ORDER BY i.deleted_at LIMIT 500",
      )
      .bind(userId, now - TOMBSTONE_KEEP_MS)
      .all<{ kind: ItemKind; id: string; rev: number }>()
  ).results;
  const keys = JSON.stringify(rows.map((r) => itemKey(r.kind, r.id)));
  // 읽기와 정리 사이에 복원되거나 여행에서 참조된 행은 같은 배치 안에서 다시 거른다.
  const predicate = `i.user_id = ?1 AND (i.kind || ':' || i.item_id) IN (SELECT value FROM json_each(?2))
    AND i.deleted = 1 AND i.deleted_at <= ?3
    AND NOT (i.kind = 'place' AND EXISTS (SELECT 1 FROM library_items t
      WHERE t.user_id = ?1 AND t.kind = 'trip' AND instr(t.refs, ',' || i.item_id || ',') > 0))`;
  const results = (await db.batch([
    db
      .prepare(
        `UPDATE library_state SET purged_rev = max(purged_rev,
      coalesce((SELECT max(i.rev) FROM library_items i WHERE ${predicate}), 0)),
      purged_at = ?4 WHERE user_id = ?1`,
      )
      .bind(userId, keys, now - TOMBSTONE_KEEP_MS, now),
    db
      .prepare(`DELETE FROM library_items AS i WHERE ${predicate}`)
      .bind(userId, keys, now - TOMBSTONE_KEEP_MS),
  ])) as { meta: { changes: number } }[];
  return results[1]!.meta.changes;
}
export async function deleteAccountData(db: MeetDb, userId: string): Promise<void> {
  await db.batch([
    ...ACCOUNT_DATA_TABLES.map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId),
    ),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}
