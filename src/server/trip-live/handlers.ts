import { Schema } from 'effect';
import {
  LIVE_ID_PATTERN,
  LIVE_TOKEN_PATTERN,
  LIVE_REQUEST_MAX_BYTES,
  LIVE_DOC_MAX_BYTES,
  parseLiveDoc,
  liveDocBytes,
  liveExpiresAt,
} from '../../domain/trip-live/live-doc';
import type { MeetDb } from '../meet/db';
import type { MeetContext } from '../meet/env';
import {
  withRequest,
  prepare,
  checkLimit,
  configurationError,
  isLocal,
  validate,
  MeetError,
  type MeetDeps,
} from '../meet/handlers';
import { hashToken } from '../meet/tokens';
import { verifyTurnstile } from '../meet/turnstile';
import { pruneLimits } from '../meet/limits';
import { readLimitedJson } from '../share/handlers';
import { ApiError, jsonResponse } from '../http';

const headers = { 'Cache-Control': 'private, no-store' };
const idSchema = Schema.String.check(Schema.isPattern(LIVE_ID_PATTERN));
const tokenSchema = Schema.String.check(Schema.isPattern(LIVE_TOKEN_PATTERN));
const revision = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const createSchema = Schema.Struct({
  id: idSchema,
  sourceTripId: idSchema,
  ownerToken: tokenSchema,
  viewToken: tokenSchema,
  doc: Schema.Unknown,
  turnstile: Schema.String,
});
const updateSchema = Schema.Struct({ doc: Schema.Unknown, baseRev: revision });
const rotateSchema = Schema.Union([
  Schema.Struct({ view: tokenSchema }),
  Schema.Struct({ owner: tokenSchema }),
]);
type Row = {
  rev: number;
  view_token: string;
  source_trip_id: string;
  updated_at: string;
  expires_at: string;
};
const reply = (body: unknown, status = 200) => jsonResponse(body, { status, headers });
const readId = (ctx: MeetContext) => validate(idSchema, ctx.params.id);
function switchedOff(ctx: MeetContext) {
  if (ctx.env.TRIP_SHARE_LIVE === 'off')
    throw new MeetError('UNAVAILABLE', '갱신 링크 만들기와 반영이 꺼져 있어요', { reason: 'off' });
}
function checkedDoc(value: unknown) {
  const doc = parseLiveDoc(value);
  if (!doc) throw new MeetError('BAD_REQUEST', '일정 문서가 올바르지 않아요', { reason: 'doc' });
  if (liveDocBytes(doc) > LIVE_DOC_MAX_BYTES) throw new ApiError('TOO_LARGE', '일정이 너무 커요');
  return doc;
}
function bearer(ctx: MeetContext): string | null {
  return /^Bearer\s+(\S+)$/i.exec(ctx.request.headers.get('Authorization') ?? '')?.[1] ?? null;
}
async function isOwner(ctx: MeetContext, id: string, token: string | null): Promise<boolean> {
  if (!token || !LIVE_TOKEN_PATTERN.test(token)) return false;
  return !!(await ctx.env.DB.prepare(
    "SELECT hash FROM trip_share_tokens WHERE share_id = ? AND kind = 'owner' AND hash = ?",
  )
    .bind(id, await hashToken(token))
    .first());
}
async function requireOwner(ctx: MeetContext, id: string) {
  if (!(await isOwner(ctx, id, bearer(ctx))))
    throw new ApiError('UNAUTHORIZED', '소유자 연결을 확인해 주세요');
}
async function readRow(
  ctx: MeetContext,
  id: string,
  now: Date,
  opts: { read?: boolean; expired?: boolean } = {},
): Promise<Row> {
  const row = await ctx.env.DB.prepare(
    'SELECT rev, view_token, source_trip_id, updated_at, expires_at FROM trip_shares WHERE id = ?',
  )
    .bind(id)
    .first<Row>();
  if (!row || (!opts.expired && row.expires_at <= now.toISOString())) {
    if (opts.read) await checkLimit(ctx, now, 'tripRead');
    throw new ApiError(
      row ? 'ENDED' : 'NOT_FOUND',
      row ? '공유가 끝난 일정이에요' : '공유 일정이 없어요',
    );
  }
  return row;
}
function cleanup(ctx: MeetContext, now: Date) {
  ctx.waitUntil(
    Promise.all([pruneExpiredLive(ctx.env.DB, now, 20), pruneLimits(ctx.env.DB, now)]).catch(
      () => undefined,
    ),
  );
}
export async function pruneExpiredLive(db: MeetDb, now: Date, max: number): Promise<number> {
  if (!Number.isFinite(max) || max < 1) return 0;
  const expired =
    'SELECT id FROM trip_shares WHERE expires_at <= ? ORDER BY expires_at, id LIMIT ?';
  const values = [now.toISOString(), Math.floor(max)] as const;
  const result = await db.batch([
    ...['trip_progress', 'trip_collab_meta', 'trip_collab_devices'].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE share_id IN (${expired})`).bind(...values),
    ),
    db.prepare(`DELETE FROM trip_share_tokens WHERE share_id IN (${expired})`).bind(...values),
    db.prepare(`DELETE FROM trip_shares WHERE id IN (${expired})`).bind(...values),
  ]);
  return (result[4] as { meta: { changes: number } }).meta.changes;
}
export function handleLiveCreate(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    switchedOff(ctx);
    const now = deps.now();
    await prepare(ctx, now, 'tripCreate');
    if (!ctx.env.TURNSTILE_SECRET && !isLocal(ctx.request)) configurationError();
    const input = validate(
      createSchema,
      await readLimitedJson(ctx.request, LIVE_REQUEST_MAX_BYTES),
    );
    if (input.ownerToken === input.viewToken)
      throw new ApiError('BAD_REQUEST', '서로 다른 토큰이 필요해요');
    if (
      ctx.env.TURNSTILE_SECRET &&
      !(await verifyTurnstile(
        input.turnstile,
        ctx.env.TURNSTILE_SECRET,
        ctx.request.headers.get('CF-Connecting-IP'),
        deps.fetch,
      ))
    )
      throw new MeetError('BAD_REQUEST', '확인에 실패했어요. 다시 해 주세요', {
        reason: 'turnstile',
      });
    const doc = checkedDoc(input.doc),
      db = ctx.env.DB;
    const retry = async () => {
      const row = await db
        .prepare('SELECT rev, expires_at FROM trip_shares WHERE id = ?')
        .bind(input.id)
        .first<{ rev: number; expires_at: string }>();
      if (!row) return null;
      if (!(await isOwner(ctx, input.id, input.ownerToken)))
        throw new MeetError('CONFLICT', '이미 쓰인 공유 id예요', { reason: 'taken' });
      return reply({ id: input.id, rev: row.rev, expiresAt: row.expires_at, created: false });
    };
    const existing = await retry();
    if (existing) return existing;
    const expiresAt = liveExpiresAt(doc.share.trips[0]!.endDate, now).toISOString();
    try {
      await db.batch([
        db
          .prepare(
            'INSERT INTO trip_shares (id, doc, rev, view_token, source_trip_id, created_at, updated_at, expires_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.id,
            JSON.stringify(doc),
            input.viewToken,
            input.sourceTripId,
            now.toISOString(),
            now.toISOString(),
            expiresAt,
          ),
        db
          .prepare(
            "INSERT INTO trip_share_tokens (hash, share_id, kind, label, expires_at, created_at) VALUES (?, ?, 'owner', NULL, NULL, ?)",
          )
          .bind(await hashToken(input.ownerToken), input.id, now.toISOString()),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: trip_shares.id/.test(error.message)
      ) {
        const response = await retry();
        if (response) return response;
      }
      throw error;
    }
    cleanup(ctx, now);
    return reply({ id: input.id, rev: 1, expiresAt, created: true }, 201);
  });
}
export function handleLiveGet(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    const id = readId(ctx),
      now = deps.now();
    await prepare(ctx, now);
    const token = bearer(ctx);
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await readRow(ctx, id, now, { read: true });
      const role =
        token === row.view_token ? 'view' : (await isOwner(ctx, id, token)) ? 'owner' : null;
      if (!role || !token) throw new ApiError('UNAUTHORIZED', '보기 링크를 확인해 주세요');
      if (new URL(ctx.request.url).searchParams.get('since') === String(row.rev))
        return new Response(null, { status: 304, headers });
      // 메타를 읽은 뒤 갱신·철회가 끼어들면 다시 읽는다. 문서와 revision·권한을 같은 시점으로 맞춘다.
      const stored = await ctx.env.DB.prepare(
        `SELECT doc FROM trip_shares WHERE id = ? AND rev = ? AND view_token = ? AND expires_at > ?
        AND (? = 'view' OR EXISTS (SELECT 1 FROM trip_share_tokens WHERE share_id = trip_shares.id AND kind = 'owner' AND hash = ?))`,
      )
        .bind(
          id,
          row.rev,
          row.view_token,
          now.toISOString(),
          role,
          role === 'owner' ? await hashToken(token) : '',
        )
        .first<{ doc: string }>();
      if (!stored) continue;
      const meta = {
        rev: row.rev,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
        role,
        ...(role === 'owner'
          ? { viewToken: row.view_token, sourceTripId: row.source_trip_id }
          : {}),
      };
      return new Response(`${JSON.stringify(meta).slice(0, -1)},"doc":${stored.doc}}`, {
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    throw new ApiError('UNAVAILABLE', '일정이 바뀌는 중이에요. 잠시 뒤 다시 해 주세요');
  });
}
export function handleLiveUpdate(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    switchedOff(ctx);
    const id = readId(ctx),
      now = deps.now();
    await prepare(ctx, now, 'tripUpdate');
    await readRow(ctx, id, now);
    await requireOwner(ctx, id);
    const input = validate(
        updateSchema,
        await readLimitedJson(ctx.request, LIVE_REQUEST_MAX_BYTES),
      ),
      doc = checkedDoc(input.doc);
    const stored = await ctx.env.DB.prepare(
      "SELECT json_extract(doc, '$.v') AS v FROM trip_shares WHERE id = ?",
    )
      .bind(id)
      .first<{ v: number | null }>();
    if (doc.v < (stored?.v ?? 1))
      throw new MeetError('CONFLICT', '새 버전의 앱이 필요해요', { reason: 'version' });
    const expiresAt = liveExpiresAt(doc.share.trips[0]!.endDate, now).toISOString();
    const result = await ctx.env.DB.prepare(
      `UPDATE trip_shares SET doc = ?, rev = rev + 1, updated_at = ?, expires_at = ? WHERE id = ? AND rev = ?
        AND EXISTS (SELECT 1 FROM trip_share_tokens WHERE share_id = trip_shares.id AND kind = 'owner' AND hash = ?)`,
    )
      .bind(
        JSON.stringify(doc),
        now.toISOString(),
        expiresAt,
        id,
        input.baseRev,
        await hashToken(bearer(ctx)!),
      )
      .run();
    if (result.meta.changes === 0) {
      await requireOwner(ctx, id);
      const row = await readRow(ctx, id, now);
      throw new MeetError('CONFLICT', '다른 기기에서 일정을 바꿨어요', { rev: row.rev });
    }
    cleanup(ctx, now);
    return reply({ rev: input.baseRev + 1, expiresAt });
  });
}
export function handleLiveRotate(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    const id = readId(ctx),
      now = deps.now();
    await prepare(ctx, now, 'tripRotate');
    const row = await readRow(ctx, id, now);
    const input = validate(
      rotateSchema,
      await readLimitedJson(ctx.request, LIVE_REQUEST_MAX_BYTES),
    );
    // 응답 유실 뒤에는 이전 소유자 토큰으로 같은 새 토큰을 다시 보낼 수 있다.
    if ('owner' in input && (await isOwner(ctx, id, input.owner))) return reply({ rev: row.rev });
    await requireOwner(ctx, id);
    const ownerHash = await hashToken(bearer(ctx)!);
    if ('view' in input) {
      const result = await ctx.env.DB.prepare(
        `UPDATE trip_shares SET view_token = ? WHERE id = ?
        AND EXISTS (SELECT 1 FROM trip_share_tokens WHERE share_id = trip_shares.id AND kind = 'owner' AND hash = ?)`,
      )
        .bind(input.view, id, ownerHash)
        .run();
      if (!result.meta.changes) await requireOwner(ctx, id);
    } else {
      const nextHash = await hashToken(input.owner);
      // 배치 안에서 현재 소유권을 확인한 뒤 새 토큰을 넣고 이전 토큰을 철회한다.
      const results = await ctx.env.DB.batch([
        ctx.env.DB.prepare(
          `INSERT INTO trip_share_tokens (hash, share_id, kind, label, expires_at, created_at)
          SELECT ?, ?, 'owner', NULL, NULL, ? WHERE EXISTS
          (SELECT 1 FROM trip_share_tokens WHERE share_id = ? AND kind = 'owner' AND hash = ?)`,
        ).bind(nextHash, id, now.toISOString(), id, ownerHash),
        ctx.env.DB.prepare(
          `DELETE FROM trip_share_tokens WHERE share_id = ? AND kind = 'owner' AND hash <> ?
          AND EXISTS (SELECT 1 FROM trip_share_tokens AS current_owner WHERE current_owner.share_id = ? AND current_owner.kind = 'owner' AND current_owner.hash = ?)`,
        ).bind(id, nextHash, id, nextHash),
      ]);
      if (!(results[0] as { meta: { changes: number } }).meta.changes) await requireOwner(ctx, id);
    }
    return reply({ rev: row.rev });
  });
}
export function handleLiveDelete(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    const id = readId(ctx),
      now = deps.now();
    await prepare(ctx, now);
    await readRow(ctx, id, now, { expired: true });
    await requireOwner(ctx, id);
    const ownerHash = await hashToken(bearer(ctx)!);
    const results = await ctx.env.DB.batch([
      ...['trip_progress', 'trip_collab_meta', 'trip_collab_devices'].map((table) =>
        ctx.env.DB.prepare(
          `DELETE FROM ${table} WHERE share_id = ? AND EXISTS (SELECT 1 FROM trip_share_tokens WHERE share_id = ? AND kind = 'owner' AND hash = ?)`,
        ).bind(id, id, ownerHash),
      ),
      ctx.env.DB.prepare(
        `DELETE FROM trip_shares WHERE id = ? AND EXISTS
        (SELECT 1 FROM trip_share_tokens WHERE share_id = trip_shares.id AND kind = 'owner' AND hash = ?)`,
      ).bind(id, await hashToken(bearer(ctx)!)),
      ctx.env.DB.prepare(
        'DELETE FROM trip_share_tokens WHERE share_id = ? AND NOT EXISTS (SELECT 1 FROM trip_shares WHERE id = ?)',
      ).bind(id, id),
    ]);
    if (!(results[3] as { meta: { changes: number } }).meta.changes) {
      await readRow(ctx, id, now, { expired: true });
      await requireOwner(ctx, id);
    }
    return new Response(null, { status: 204, headers });
  });
}
