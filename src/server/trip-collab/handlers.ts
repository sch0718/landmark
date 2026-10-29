import { Schema } from 'effect';
import {
  COLLAB_LIMITS,
  COLLAB_DEVICE_ID_PATTERN,
  COLLAB_INVITE_KEY_PATTERN,
  COLLAB_STOP_ID_PATTERN,
  OWNER_DEVICE,
  OWNER_LABEL,
  inviteExpiresAt,
  inviteKeyOf,
  normalizeDeviceLabel,
  normalizeInviteLabel,
} from '../../domain/trip-collab/constants';
import type { ProgressOp, SharedProgress } from '../../domain/trip-collab/progress';
import {
  LIVE_ID_PATTERN,
  LIVE_TOKEN_PATTERN,
  LIVE_REQUEST_MAX_BYTES,
  LIVE_DOC_MAX_BYTES,
  parseLiveDoc,
  liveDocBytes,
  liveExpiresAt,
} from '../../domain/trip-live/live-doc';
import { CalendarDate, IsoDateTime } from '../../schema/common';
import { ApiError, jsonResponse } from '../http';
import type { MeetContext } from '../meet/env';
import type { MeetDb } from '../meet/db';
import {
  withRequest,
  prepare,
  checkLimit,
  validate,
  MeetError,
  type MeetDeps,
} from '../meet/handlers';
import { hashToken } from '../meet/tokens';
import { readLimitedJson } from '../share/handlers';
import { pruneExpiredLive } from '../trip-live/handlers';

const headers = { 'Cache-Control': 'private, no-store' };
const reply = (body: unknown, status = 200) => jsonResponse(body, { status, headers });
const empty = () => new Response(null, { status: 204, headers });
const tokenSchema = Schema.String.check(Schema.isPattern(LIVE_TOKEN_PATTERN));
const stopSchema = Schema.String.check(Schema.isPattern(COLLAB_STOP_ID_PATTERN));
const revision = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const inviteSchema = Schema.Struct({ token: tokenSchema, label: Schema.NullOr(Schema.String) });
const acceptSchema = Schema.Struct({ deviceToken: tokenSchema, label: Schema.String });
const docSchema = Schema.Struct({ doc: Schema.Unknown, baseRev: revision });
const progressSchema = Schema.Struct({
  ops: Schema.Array(
    Schema.Struct({
      stopId: stopSchema,
      visited: Schema.Boolean,
      date: CalendarDate,
      at: IsoDateTime,
    }),
  ).check(Schema.isMaxLength(COLLAB_LIMITS.progressOps)),
  next: Schema.optionalKey(
    Schema.Struct({ stopId: Schema.NullOr(stopSchema), date: CalendarDate, at: IsoDateTime }),
  ),
});
type ShareRow = {
  rev: number;
  updated_at: string;
  expires_at: string;
  progress_rev: number | null;
  edited_label: string | null;
};
type Role =
  | { role: 'owner'; deviceId: null; label: string; hash: string }
  | { role: 'editor'; deviceId: string; label: string; hash: string; seenAt: string };
const bearer = (ctx: MeetContext): string | null =>
  /^Bearer\s+(\S+)$/i.exec(ctx.request.headers.get('Authorization') ?? '')?.[1] ?? null;
function readShareId(ctx: MeetContext): string {
  if (typeof ctx.params.id !== 'string' || !LIVE_ID_PATTERN.test(ctx.params.id))
    throw new ApiError('BAD_REQUEST', '공유 id가 올바르지 않아요');
  return ctx.params.id;
}
function switchesOff(ctx: MeetContext, progress = false): void {
  if (ctx.env.TRIP_COLLAB === 'off' || (!progress && ctx.env.TRIP_SHARE_LIVE === 'off'))
    throw new MeetError('UNAVAILABLE', '함께 편집이 꺼져 있어요', { reason: 'off' });
}
async function liveShare(
  ctx: MeetContext,
  id: string,
  now: Date,
  count = false,
  expired = false,
): Promise<ShareRow> {
  const row = await ctx.env.DB.prepare(
    'SELECT s.rev, s.updated_at, s.expires_at, m.progress_rev, m.edited_label FROM trip_shares s LEFT JOIN trip_collab_meta m ON m.share_id = s.id WHERE s.id = ?',
  )
    .bind(id)
    .first<ShareRow>();
  if (!row || (!expired && row.expires_at <= now.toISOString())) {
    if (count) await checkLimit(ctx, now, 'collabRead');
    throw new ApiError(
      row ? 'ENDED' : 'NOT_FOUND',
      row ? '공유가 끝난 여행이에요' : '공동 여행이 없어요',
    );
  }
  return row;
}
async function resolveRole(ctx: MeetContext, id: string): Promise<Role> {
  const token = bearer(ctx);
  if (token && LIVE_TOKEN_PATTERN.test(token)) {
    const hash = await hashToken(token);
    if (
      await ctx.env.DB.prepare(
        "SELECT hash FROM trip_share_tokens WHERE share_id = ? AND kind = 'owner' AND hash = ?",
      )
        .bind(id, hash)
        .first()
    )
      return { role: 'owner', deviceId: null, label: OWNER_LABEL, hash };
    const row = await ctx.env.DB.prepare(
      'SELECT device_id, label, seen_at FROM trip_collab_devices WHERE share_id = ? AND token_hash = ?',
    )
      .bind(id, hash)
      .first<{ device_id: string; label: string; seen_at: string }>();
    if (row)
      return {
        role: 'editor',
        deviceId: row.device_id,
        label: row.label,
        seenAt: row.seen_at,
        hash,
      };
  }
  throw new ApiError('UNAUTHORIZED', '함께 편집 권한을 확인해 주세요');
}
async function requireOwner(ctx: MeetContext, id: string): Promise<Role> {
  const role = await resolveRole(ctx, id);
  if (role.role !== 'owner') throw new ApiError('UNAUTHORIZED', '만든 사람만 관리할 수 있어요');
  return role;
}
const full = () => new MeetError('CONFLICT', '함께 편집 한도를 넘었어요', { reason: 'full' });
const invalidInvite = () =>
  new MeetError('UNAUTHORIZED', '이미 쓴 초대이거나 닫힌 초대예요', { reason: 'invite' });
async function inviteHash(ctx: MeetContext): Promise<string> {
  const t = bearer(ctx);
  return t && LIVE_TOKEN_PATTERN.test(t) ? hashToken(t) : '';
}
const changes = (r: unknown) => (r as { meta: { changes: number } }).meta.changes;
const numberOf = async (db: MeetDb, sql: string, ...values: (string | number)[]) =>
  (
    await db
      .prepare(sql)
      .bind(...values)
      .first<{ n: number }>()
  )?.n ?? 0;
function authSql(role: Role): string {
  return role.role === 'owner'
    ? "EXISTS (SELECT 1 FROM trip_share_tokens WHERE share_id = ? AND kind = 'owner' AND hash = ?)"
    : 'EXISTS (SELECT 1 FROM trip_collab_devices WHERE share_id = ? AND token_hash = ?)';
}
export function handleCollabInviteCreate(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    switchesOff(ctx);
    const id = readShareId(ctx),
      now = deps.now();
    await prepare(ctx, now, 'collabInvite');
    const share = await liveShare(ctx, id, now);
    await requireOwner(ctx, id);
    const input = validate(
      inviteSchema,
      await readLimitedJson(ctx.request, LIVE_REQUEST_MAX_BYTES),
    );
    const stored = await ctx.env.DB.prepare(
      "SELECT json_extract(doc, '$.v') AS v FROM trip_shares WHERE id = ?",
    )
      .bind(id)
      .first<{ v: number }>();
    if (stored?.v !== 2)
      throw new MeetError('CONFLICT', '먼저 공동 편집을 켜 주세요', { reason: 'upgrade' });
    const hash = await hashToken(input.token),
      db = ctx.env.DB;
    const existing = await db
      .prepare(
        "SELECT expires_at FROM trip_share_tokens WHERE hash = ? AND share_id = ? AND kind = 'invite'",
      )
      .bind(hash, id)
      .first<{ expires_at: string }>();
    if (existing)
      return reply({ key: inviteKeyOf(hash), expiresAt: existing.expires_at, created: false });
    const expiry = inviteExpiresAt(now, share.expires_at);
    await db
      .prepare(
        "DELETE FROM trip_share_tokens WHERE share_id = ? AND kind = 'invite' AND expires_at <= ?",
      )
      .bind(id, now.toISOString())
      .run();
    const r = await db
      .prepare(
        "INSERT INTO trip_share_tokens (hash, share_id, kind, label, expires_at, created_at) SELECT ?, ?, 'invite', ?, ?, ? WHERE (SELECT count(*) FROM trip_share_tokens WHERE share_id = ? AND kind = 'invite') < ?",
      )
      .bind(
        hash,
        id,
        normalizeInviteLabel(input.label),
        expiry,
        now.toISOString(),
        id,
        COLLAB_LIMITS.invites,
      )
      .run();
    if (!r.meta.changes) throw full();
    return reply({ key: inviteKeyOf(hash), expiresAt: expiry, created: true }, 201);
  });
}
export function handleCollabInviteCancel(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    const id = readShareId(ctx),
      now = deps.now(),
      key = ctx.params.key;
    if (typeof key !== 'string' || !COLLAB_INVITE_KEY_PATTERN.test(key))
      throw new ApiError('BAD_REQUEST', '초대 키가 올바르지 않아요');
    await prepare(ctx, now, 'collabManage');
    await liveShare(ctx, id, now, false, true);
    await requireOwner(ctx, id);
    await ctx.env.DB.prepare(
      "DELETE FROM trip_share_tokens WHERE share_id = ? AND kind = 'invite' AND substr(hash, 1, 16) = ?",
    )
      .bind(id, key)
      .run();
    return empty();
  });
}
export function handleCollabInvitePreview(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    const id = readShareId(ctx),
      now = deps.now();
    await prepare(ctx, now);
    await liveShare(ctx, id, now, true);
    const invited = await ctx.env.DB.prepare(
      "SELECT expires_at FROM trip_share_tokens WHERE hash = ? AND share_id = ? AND kind = 'invite' AND expires_at > ?",
    )
      .bind(await inviteHash(ctx), id, now.toISOString())
      .first<{ expires_at: string }>();
    if (!invited) {
      await checkLimit(ctx, now, 'collabRead');
      throw invalidInvite();
    }
    const info = await ctx.env.DB.prepare(
      "SELECT json_extract(doc, '$.share.title') AS title, json_extract(doc, '$.share.trips[0].startDate') AS startDate, json_extract(doc, '$.share.trips[0].endDate') AS endDate FROM trip_shares WHERE id = ?",
    )
      .bind(id)
      .first();
    return reply({ ...info, expiresAt: invited.expires_at });
  });
}
function newDeviceId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  while (result.length < 8)
    for (const n of crypto.getRandomValues(new Uint8Array(16))) {
      if (n < 252) result += alphabet[n % 36];
      if (result.length === 8) break;
    }
  return result;
}
export function handleCollabAccept(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    switchesOff(ctx);
    const id = readShareId(ctx),
      now = deps.now();
    await prepare(ctx, now, 'collabAccept');
    const share = await liveShare(ctx, id, now);
    const input = validate(
        acceptSchema,
        await readLimitedJson(ctx.request, LIVE_REQUEST_MAX_BYTES),
      ),
      label = normalizeDeviceLabel(input.label);
    if (label === null || input.deviceToken === bearer(ctx))
      throw new ApiError('BAD_REQUEST', '기기 이름과 편집 토큰을 확인해 주세요');
    const db = ctx.env.DB,
      hash = await hashToken(input.deviceToken),
      invitation = await inviteHash(ctx);
    const existing = () =>
      db
        .prepare('SELECT device_id FROM trip_collab_devices WHERE share_id = ? AND token_hash = ?')
        .bind(id, hash)
        .first<{ device_id: string }>();
    const already = await existing();
    if (already) return reply({ deviceId: already.device_id, rev: share.rev });
    if (
      (await numberOf(
        db,
        'SELECT count(*) AS n FROM trip_collab_devices WHERE share_id = ?',
        id,
      )) >= COLLAB_LIMITS.devices
    )
      throw full();
    let deviceId: string;
    do {
      deviceId = newDeviceId();
    } while (
      await db
        .prepare('SELECT device_id FROM trip_collab_devices WHERE share_id = ? AND device_id = ?')
        .bind(id, deviceId)
        .first()
    );
    const result = await db.batch([
      db
        .prepare(
          "INSERT INTO trip_collab_devices (share_id, device_id, token_hash, label, created_at, seen_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM trip_share_tokens WHERE hash = ? AND share_id = ? AND kind = 'invite' AND expires_at > ?) AND (SELECT count(*) FROM trip_collab_devices WHERE share_id = ?) < ?",
        )
        .bind(
          id,
          deviceId,
          hash,
          label,
          now.toISOString(),
          now.toISOString(),
          invitation,
          id,
          now.toISOString(),
          id,
          COLLAB_LIMITS.devices,
        ),
      db
        .prepare(
          "DELETE FROM trip_share_tokens WHERE hash = ? AND share_id = ? AND kind = 'invite' AND EXISTS (SELECT 1 FROM trip_collab_devices WHERE share_id = ? AND token_hash = ?)",
        )
        .bind(invitation, id, id, hash),
    ]);
    if (!changes(result[0])) {
      const retry = await existing();
      if (retry) return reply({ deviceId: retry.device_id, rev: share.rev });
      throw invalidInvite();
    }
    await db
      .prepare(
        'INSERT INTO trip_collab_meta (share_id, progress_rev) VALUES (?, 0) ON CONFLICT(share_id) DO NOTHING',
      )
      .bind(id)
      .run();
    return reply({ deviceId, rev: share.rev }, 201);
  });
}
async function readProgress(db: MeetDb, id: string): Promise<SharedProgress> {
  const { results } = await db
    .prepare(
      'SELECT stop_id, date, at, by_device, by_label FROM trip_progress WHERE share_id = ? AND visited = 1 ORDER BY at',
    )
    .bind(id)
    .all<{ stop_id: string; date: string; at: string; by_device: string; by_label: string }>();
  const meta = await db
    .prepare(
      'SELECT progress_rev, next_stop_id, next_date, next_label, next_at FROM trip_collab_meta WHERE share_id = ?',
    )
    .bind(id)
    .first<{
      progress_rev: number;
      next_stop_id: string | null;
      next_date: string | null;
      next_label: string | null;
      next_at: string | null;
    }>();
  return {
    prev: meta?.progress_rev ?? 0,
    marks: results.map((r) => ({
      stopId: r.stop_id,
      date: r.date,
      at: r.at,
      by: { device: r.by_device, label: r.by_label },
    })),
    next: meta?.next_stop_id
      ? {
          stopId: meta.next_stop_id,
          date: meta.next_date!,
          at: meta.next_at!,
          label: meta.next_label!,
        }
      : null,
  };
}
function queryRev(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
export function handleCollabState(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    const id = readShareId(ctx),
      now = deps.now();
    await prepare(ctx, now);
    for (let i = 0; i < 3; i++) {
      const share = await liveShare(ctx, id, now, true),
        role = await resolveRole(ctx, id),
        db = ctx.env.DB;
      if (role.role === 'editor' && now.getTime() - Date.parse(role.seenAt) >= 3_600_000)
        await db
          .prepare(
            'UPDATE trip_collab_devices SET seen_at = ? WHERE share_id = ? AND device_id = ?',
          )
          .bind(now.toISOString(), id, role.deviceId)
          .run();
      const url = new URL(ctx.request.url),
        rev = queryRev(url, 'rev'),
        prev = queryRev(url, 'prev');
      if (rev === share.rev && prev === (share.progress_rev ?? 0))
        return new Response(null, { status: 304, headers });
      const meta = {
        rev: share.rev,
        updatedAt: share.updated_at,
        expiresAt: share.expires_at,
        role: role.role,
        deviceId: role.deviceId,
        members: await numberOf(
          db,
          'SELECT count(*) AS n FROM trip_collab_devices WHERE share_id = ?',
          id,
        ),
        editedBy: share.edited_label,
      };
      let stored: { doc: string } | null = null;
      if (rev !== share.rev) {
        stored = await db
          .prepare(
            `SELECT doc FROM trip_shares WHERE id = ? AND rev = ? AND expires_at > ? AND ${authSql(role)}`,
          )
          .bind(id, share.rev, now.toISOString(), id, role.hash)
          .first<{ doc: string }>();
        if (!stored) continue;
      }
      const progress = prev !== (share.progress_rev ?? 0) ? await readProgress(db, id) : null;
      return new Response(
        `${JSON.stringify(meta).slice(0, -1)}${stored ? ',"doc":' + stored.doc : ''}${progress ? ',"progress":' + JSON.stringify(progress) : ''}}`,
        { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } },
      );
    }
    throw new ApiError('UNAVAILABLE', '일정이 바뀌는 중이에요. 잠시 뒤 다시 해 주세요');
  });
}
export function handleCollabPutDoc(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    switchesOff(ctx);
    const id = readShareId(ctx),
      now = deps.now();
    await prepare(ctx, now, 'collabUpdate');
    await liveShare(ctx, id, now);
    const role = await resolveRole(ctx, id),
      db = ctx.env.DB;
    const input = validate(docSchema, await readLimitedJson(ctx.request, LIVE_REQUEST_MAX_BYTES)),
      doc = parseLiveDoc(input.doc);
    if (!doc || doc.v !== 2)
      throw new MeetError('BAD_REQUEST', '일정 문서가 올바르지 않아요', { reason: 'doc' });
    if (liveDocBytes(doc) > LIVE_DOC_MAX_BYTES) throw new ApiError('TOO_LARGE', '일정이 너무 커요');
    const stored = await db
      .prepare("SELECT json_extract(doc, '$.v') AS v FROM trip_shares WHERE id = ?")
      .bind(id)
      .first<{ v: number }>();
    if ((stored?.v ?? 1) > doc.v)
      throw new MeetError('CONFLICT', '새 버전의 앱이 필요해요', { reason: 'version' });
    const expiry = liveExpiresAt(doc.share.trips[0]!.endDate, now).toISOString();
    const result = await db
      .prepare(
        `UPDATE trip_shares SET doc = ?, rev = rev + 1, updated_at = ?, expires_at = ? WHERE id = ? AND rev = ? AND ${authSql(role)}`,
      )
      .bind(JSON.stringify(doc), now.toISOString(), expiry, id, input.baseRev, id, role.hash)
      .run();
    if (!result.meta.changes) {
      await resolveRole(ctx, id);
      const latest = await liveShare(ctx, id, now);
      throw new MeetError('CONFLICT', '다른 기기에서 일정을 바꿨어요', { rev: latest.rev });
    }
    await db
      .prepare(
        'INSERT INTO trip_collab_meta (share_id, progress_rev, edited_label, edited_at) VALUES (?, 0, ?, ?) ON CONFLICT(share_id) DO UPDATE SET edited_label = excluded.edited_label, edited_at = excluded.edited_at',
      )
      .bind(id, role.label, now.toISOString())
      .run();
    ctx.waitUntil(pruneExpiredLive(db, now, 20).catch(() => undefined));
    return reply({ rev: input.baseRev + 1, expiresAt: expiry });
  });
}
export function handleCollabProgress(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    switchesOff(ctx, true);
    const id = readShareId(ctx),
      now = deps.now();
    await prepare(ctx, now, 'collabProgress');
    await liveShare(ctx, id, now);
    const role = await resolveRole(ctx, id),
      db = ctx.env.DB;
    const input = validate(
      progressSchema,
      await readLimitedJson(ctx.request, COLLAB_LIMITS.progressRequestBytes),
    );
    if (!input.ops.length && !input.next) throw new ApiError('BAD_REQUEST', '진행 변경이 없어요');
    const existing = await db
      .prepare('SELECT stop_id FROM trip_progress WHERE share_id = ?')
      .bind(id)
      .all<{ stop_id: string }>();
    const count = new Set([
      ...existing.results.map((r) => r.stop_id),
      ...input.ops.map((o) => o.stopId),
    ]).size;
    if (count > COLLAB_LIMITS.progressRows) throw full();
    const at = (s: string) => new Date(Math.min(Date.parse(s), now.getTime())).toISOString();
    const statements = input.ops.map((op: ProgressOp) =>
      db
        .prepare(
          `INSERT INTO trip_progress (share_id, stop_id, visited, date, by_device, by_label, at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${authSql(role)} ON CONFLICT(share_id, stop_id) DO UPDATE SET visited = excluded.visited, date = excluded.date, by_device = excluded.by_device, by_label = excluded.by_label, at = excluded.at WHERE excluded.at > trip_progress.at`,
        )
        .bind(
          id,
          op.stopId,
          op.visited ? 1 : 0,
          op.date,
          role.deviceId ?? OWNER_DEVICE,
          role.label,
          at(op.at),
          id,
          role.hash,
        ),
    );
    if (input.next)
      statements.push(
        db
          .prepare(
            `INSERT INTO trip_collab_meta (share_id, progress_rev, next_stop_id, next_date, next_label, next_at) SELECT ?, 0, ?, ?, ?, ? WHERE ${authSql(role)} ON CONFLICT(share_id) DO UPDATE SET next_stop_id = excluded.next_stop_id, next_date = excluded.next_date, next_label = excluded.next_label, next_at = excluded.next_at WHERE trip_collab_meta.next_at IS NULL OR excluded.next_at > trip_collab_meta.next_at`,
          )
          .bind(
            id,
            input.next.stopId,
            input.next.date,
            role.label,
            at(input.next.at),
            id,
            role.hash,
          ),
      );
    statements.push(
      db
        .prepare(
          `INSERT INTO trip_collab_meta (share_id, progress_rev) SELECT ?, 1 WHERE ${authSql(role)} ON CONFLICT(share_id) DO UPDATE SET progress_rev = progress_rev + 1`,
        )
        .bind(id, id, role.hash),
    );
    await db.batch(statements);
    await resolveRole(ctx, id);
    return reply(await readProgress(db, id));
  });
}
export function handleCollabMembers(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    const id = readShareId(ctx),
      now = deps.now();
    await prepare(ctx, now);
    await liveShare(ctx, id, now);
    await requireOwner(ctx, id);
    const { results: devices } = await ctx.env.DB.prepare(
      'SELECT device_id AS deviceId, label, created_at AS createdAt, seen_at AS seenAt FROM trip_collab_devices WHERE share_id = ? ORDER BY created_at',
    )
      .bind(id)
      .all();
    const { results: invites } = await ctx.env.DB.prepare(
      "SELECT substr(hash, 1, 16) AS key, label, created_at AS createdAt, expires_at AS expiresAt FROM trip_share_tokens WHERE share_id = ? AND kind = 'invite' AND expires_at > ? ORDER BY created_at",
    )
      .bind(id, now.toISOString())
      .all();
    return reply({ devices, invites });
  });
}
export function handleCollabRemoveMember(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    const id = readShareId(ctx),
      device = ctx.params.device,
      now = deps.now();
    if (typeof device !== 'string' || (device !== 'me' && !COLLAB_DEVICE_ID_PATTERN.test(device)))
      throw new ApiError('BAD_REQUEST', '기기 id가 올바르지 않아요');
    await prepare(ctx, now, 'collabManage');
    await liveShare(ctx, id, now, false, true);
    const role = await resolveRole(ctx, id);
    if ((device === 'me' && role.role !== 'editor') || (device !== 'me' && role.role !== 'owner'))
      throw new ApiError('UNAUTHORIZED', '기기 관리 권한을 확인해 주세요');
    await ctx.env.DB.prepare('DELETE FROM trip_collab_devices WHERE share_id = ? AND device_id = ?')
      .bind(id, device === 'me' ? role.deviceId : device)
      .run();
    return empty();
  });
}
