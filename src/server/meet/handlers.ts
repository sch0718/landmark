import { Schema } from 'effect';
import {
  MeetingDocSchema,
  type MeetingDoc,
  type OnlineReply,
  type OnlineState,
} from '../../domain/meeting/online-doc';
import { MeetingId } from '../../schema/meeting';
import { safeParse } from '../../schema/parse';
import { requestOrigin } from '../handler';
import { ApiError, errorResponse, isAllowedOrigin, jsonResponse, type ApiErrorCode } from '../http';
import { ensureSchema, type MeetDb } from './db';
import type { MeetContext } from './env';
import { consumeLimit, pruneLimits, type LimitAction } from './limits';
import { hashIp, hashToken, newToken } from './tokens';
import { verifyTurnstile } from './turnstile';

export type MeetDeps = { fetch: typeof fetch; now(): Date };

type MeetingRow = {
  id: string;
  doc: string;
  rev: number;
  doc_rev: number;
  expires_at: string;
};
type ReplyRow = {
  participant_id: string;
  name: string;
  origin: string | null;
  likes: string;
  times: string | null;
  updated_at: string;
};
type TokenRow = { kind: 'host' | 'guest'; participant_id: string | null };
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
const createSchema = Schema.Struct({ doc: Schema.Unknown, turnstile: Schema.String });
const updateSchema = Schema.Struct({
  doc: MeetingDocSchema,
  baseRev: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});

// 공통 오류 형식을 지키면서 이 API의 이유·현재 버전을 덧붙인다.
class MeetError extends ApiError {
  constructor(
    code: ApiErrorCode,
    message: string,
    readonly fields: Record<string, unknown>,
  ) {
    super(code, message);
  }
}

function validate<S extends Schema.Decoder<unknown>>(schema: S, value: unknown): S['Type'] {
  const result = safeParse(schema, value, { onExcessProperty: 'error' });
  if (!result.success) throw new ApiError('BAD_REQUEST', '약속 입력이 올바르지 않아요');
  return result.data;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError('BAD_REQUEST', '요청 본문을 읽지 못했어요');
  }
}

async function withRequest(
  ctx: MeetContext,
  run: (origin: string) => Promise<Response>,
): Promise<Response> {
  try {
    const origin = requestOrigin(ctx.request);
    if (!isAllowedOrigin(origin) || origin === null) {
      throw new ApiError('FORBIDDEN_ORIGIN', '허용하지 않는 요청 출처');
    }
    return await run(origin);
  } catch (error) {
    const response = errorResponse(error);
    if (!(error instanceof MeetError)) return response;
    return jsonResponse(
      { ...(await response.json()), ...error.fields },
      {
        status: response.status,
        headers: response.headers,
      },
    );
  }
}

function isLocal(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === 'http:' && url.hostname === 'localhost';
}

function configurationError(): never {
  throw new MeetError('UNAVAILABLE', '서버 설정을 확인해 주세요', { reason: 'config' });
}

async function prepare(
  ctx: MeetContext,
  origin: string,
  now: Date,
  action?: LimitAction,
): Promise<void> {
  if (!ctx.env.DB) configurationError();
  await ensureSchema(ctx.env.DB);
  if (action) await checkLimit(ctx, origin, now, action);
}

async function checkLimit(
  ctx: MeetContext,
  origin: string,
  now: Date,
  action: LimitAction,
): Promise<void> {
  const salt = ctx.env.IP_HASH_SALT || (isLocal(origin) ? 'dev-salt' : null);
  if (!salt) configurationError();
  const ip = ctx.request.headers.get('CF-Connecting-IP') ?? 'local';
  if (!(await consumeLimit(ctx.env.DB, action, await hashIp(ip, salt), now))) {
    throw new ApiError('RATE_LIMITED', '오늘의 요청 한도를 넘었어요');
  }
}

export function readMeetingId(ctx: MeetContext): string {
  return validate(MeetingId, ctx.params.id);
}

async function activeMeeting(db: MeetDb, id: string, now: Date): Promise<MeetingRow> {
  const row = await db
    .prepare('SELECT id, doc, rev, doc_rev, expires_at FROM meetings WHERE id = ?')
    .bind(id)
    .first<MeetingRow>();
  if (!row) throw new ApiError('NOT_FOUND', '약속이 없어요');
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new ApiError('ENDED', '끝난 약속이에요');
  }
  return row;
}

async function readToken(ctx: MeetContext, id: string): Promise<TokenRow | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(ctx.request.headers.get('Authorization') ?? '');
  if (!match) return null;
  return ctx.env.DB.prepare(
    'SELECT kind, participant_id FROM meeting_tokens WHERE meeting_id = ? AND hash = ?',
  )
    .bind(id, await hashToken(match[1]!))
    .first<TokenRow>();
}

async function requireHost(ctx: MeetContext, id: string): Promise<void> {
  if ((await readToken(ctx, id))?.kind !== 'host') {
    throw new ApiError('UNAUTHORIZED', '주최자 연결을 확인해 주세요');
  }
}

export function expiresAt(doc: MeetingDoc, updatedAt: Date): string {
  const at = doc.at === null ? 0 : new Date(`${doc.at.date}T${doc.at.time}:00+09:00`).getTime();
  return new Date(Math.max(at, updatedAt.getTime()) + 30 * 24 * 60 * 60 * 1000).toISOString();
}

// D1과 시험용 DB는 모두 batch 결과에 변경 행 수를 돌려준다.
function changes(result: unknown): number {
  return (result as { meta: { changes: number } }).meta.changes;
}

export async function pruneExpired(db: MeetDb, now: Date, max: number): Promise<number> {
  if (!Number.isFinite(max) || max < 1) return 0;
  const expired = `SELECT id FROM meetings WHERE expires_at <= ? ORDER BY expires_at, id LIMIT ?`;
  const values = [now.toISOString(), Math.floor(max)] as const;
  // 같은 배치 안에서 대상을 골라, 갱신으로 만료가 늘어난 약속을 지우지 않는다.
  const results = await db.batch([
    db.prepare(`DELETE FROM meeting_replies WHERE meeting_id IN (${expired})`).bind(...values),
    db.prepare(`DELETE FROM meeting_tokens WHERE meeting_id IN (${expired})`).bind(...values),
    db.prepare(`DELETE FROM meetings WHERE id IN (${expired})`).bind(...values),
  ]);
  return changes(results[2]);
}

export function redactForGuest(state: OnlineState, participantId: string | null): OnlineState {
  const originNames: Record<string, string> = {};
  const participants = state.doc.participants.map((p) => {
    if (p.id === participantId) return p;
    if (p.origin !== null) originNames[p.id] = p.origin.name;
    return { ...p, origin: null };
  });
  const replies = state.replies.map((reply) => {
    if (reply.participantId === participantId) return reply;
    if (reply.origin !== null) originNames[reply.participantId] = reply.origin.name;
    return { ...reply, origin: null };
  });
  return {
    rev: state.rev,
    docRev: state.docRev,
    doc: { ...state.doc, participants },
    replies,
    originNames,
  };
}

export function handleCreate(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async (origin) => {
    if (ctx.env.MEET_ONLINE === 'off') {
      throw new MeetError('UNAVAILABLE', '온라인 공유가 꺼져 있어요', { reason: 'off' });
    }
    const now = deps.now();
    await prepare(ctx, origin, now, 'create');
    const secret = ctx.env.TURNSTILE_SECRET;
    if (!secret && !isLocal(origin)) configurationError();
    const input = validate(createSchema, await readJson(ctx.request));
    if (
      secret &&
      !(await verifyTurnstile(
        input.turnstile,
        secret,
        ctx.request.headers.get('CF-Connecting-IP'),
        deps.fetch,
      ))
    ) {
      throw new MeetError('BAD_REQUEST', '확인에 실패했어요. 다시 해 주세요', {
        reason: 'turnstile',
      });
    }
    const doc = validate(MeetingDocSchema, input.doc);
    const db = ctx.env.DB;
    if (await db.prepare('SELECT id FROM meetings WHERE id = ?').bind(doc.meetingId).first()) {
      throw new ApiError('CONFLICT', '이미 올린 약속이에요');
    }
    const token = newToken();
    const hash = await hashToken(token);
    const timestamp = now.toISOString();
    try {
      await db.batch([
        db
          .prepare(
            'INSERT INTO meetings (id, doc, rev, doc_rev, created_at, updated_at, expires_at) VALUES (?, ?, 1, 1, ?, ?, ?)',
          )
          .bind(doc.meetingId, JSON.stringify(doc), timestamp, timestamp, expiresAt(doc, now)),
        db
          .prepare(
            'INSERT INTO meeting_tokens (hash, meeting_id, kind, participant_id, created_at) VALUES (?, ?, ?, NULL, ?)',
          )
          .bind(hash, doc.meetingId, 'host', timestamp),
      ]);
    } catch (error) {
      // 두 요청이 없는 id를 함께 확인했어도 하나만 만들 수 있다.
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: meetings\.id\b/i.test(error.message)
      ) {
        throw new ApiError('CONFLICT', '이미 올린 약속이에요');
      }
      throw error;
    }
    ctx.waitUntil(
      Promise.all([pruneExpired(db, now, 20), pruneLimits(db, now)]).catch(() => undefined),
    );
    return jsonResponse(
      { id: doc.meetingId, rev: 1, docRev: 1, hostToken: token },
      { status: 201, headers: PRIVATE_HEADERS },
    );
  });
}

export function handleGet(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async (origin) => {
    const id = readMeetingId(ctx);
    const now = deps.now();
    await prepare(ctx, origin, now);
    let row: MeetingRow;
    try {
      row = await activeMeeting(ctx.env.DB, id, now);
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'ENDED')) {
        await checkLimit(ctx, origin, now, 'read');
      }
      throw error;
    }
    if (new URL(ctx.request.url).searchParams.get('since') === String(row.rev)) {
      return new Response(null, { status: 304, headers: PRIVATE_HEADERS });
    }
    const { results } = await ctx.env.DB.prepare(
      'SELECT * FROM meeting_replies WHERE meeting_id = ? ORDER BY participant_id',
    )
      .bind(id)
      .all<ReplyRow>();
    const replies: OnlineReply[] = results.map((reply) => ({
      participantId: reply.participant_id,
      name: reply.name,
      origin: reply.origin === null ? null : JSON.parse(reply.origin),
      likes: JSON.parse(reply.likes),
      times: reply.times === null ? null : JSON.parse(reply.times),
      updatedAt: reply.updated_at,
    }));
    const state: OnlineState = {
      rev: row.rev,
      docRev: row.doc_rev,
      doc: JSON.parse(row.doc),
      replies,
    };
    const token = await readToken(ctx, id);
    const body =
      token?.kind === 'host' ? state : redactForGuest(state, token?.participant_id ?? null);
    return jsonResponse(body, { headers: PRIVATE_HEADERS });
  });
}

export function handleUpdate(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async (origin) => {
    const id = readMeetingId(ctx);
    const now = deps.now();
    await prepare(ctx, origin, now, 'update');
    const row = await activeMeeting(ctx.env.DB, id, now);
    await requireHost(ctx, id);
    const { doc, baseRev } = validate(updateSchema, await readJson(ctx.request));
    if (doc.meetingId !== id) throw new ApiError('BAD_REQUEST', '약속 id가 경로와 달라요');
    const conflict = (docRev: number): never => {
      throw new MeetError('CONFLICT', '약속이 바뀌었어요. 다시 확인해 주세요', { docRev });
    };
    if (baseRev !== row.doc_rev) conflict(row.doc_rev);
    const old: MeetingDoc = JSON.parse(row.doc);
    const remaining = new Set(doc.participants.map((p) => p.id));
    const removed = old.participants.filter((p) => !remaining.has(p.id)).map((p) => p.id);
    const db = ctx.env.DB;
    // 삭제도 버전 조건에 묶는다. 뒤늦게 도착한 요청이 다른 기기의 답장을 지우지 않는다.
    const guard = 'EXISTS (SELECT 1 FROM meetings WHERE id = ? AND doc_rev = ?)';
    const cleanup = removed.flatMap((pid) => [
      db
        .prepare(
          `DELETE FROM meeting_replies WHERE meeting_id = ? AND participant_id = ? AND ${guard}`,
        )
        .bind(id, pid, id, baseRev),
      db
        .prepare(
          `DELETE FROM meeting_tokens WHERE meeting_id = ? AND participant_id = ? AND kind = 'guest' AND ${guard}`,
        )
        .bind(id, pid, id, baseRev),
    ]);
    const results = await db.batch([
      ...cleanup,
      db
        .prepare(
          'UPDATE meetings SET doc = ?, doc_rev = doc_rev + 1, rev = rev + 1, updated_at = ?, expires_at = ? WHERE id = ? AND doc_rev = ?',
        )
        .bind(JSON.stringify(doc), now.toISOString(), expiresAt(doc, now), id, baseRev),
    ]);
    if (changes(results[results.length - 1]) === 0) {
      conflict((await activeMeeting(db, id, now)).doc_rev);
    }
    const updated = await activeMeeting(db, id, now);
    return jsonResponse(
      { rev: updated.rev, docRev: updated.doc_rev },
      { headers: PRIVATE_HEADERS },
    );
  });
}

export function handleDelete(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async (origin) => {
    const id = readMeetingId(ctx);
    const now = deps.now();
    await prepare(ctx, origin, now);
    await activeMeeting(ctx.env.DB, id, now);
    await requireHost(ctx, id);
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('DELETE FROM meeting_replies WHERE meeting_id = ?').bind(id),
      ctx.env.DB.prepare('DELETE FROM meeting_tokens WHERE meeting_id = ?').bind(id),
      ctx.env.DB.prepare('DELETE FROM meetings WHERE id = ?').bind(id),
    ]);
    return new Response(null, { status: 204, headers: PRIVATE_HEADERS });
  });
}
