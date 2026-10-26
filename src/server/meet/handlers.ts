import { Schema } from 'effect';
import {
  MeetingDocSchema,
  ReplyInputSchema,
  type MeetingDoc,
  type ReplyInput,
  type OnlineReply,
  type OnlineState,
} from '../../domain/meeting/online-doc';
import { MeetingId, MeetingMemberId, MeetingName } from '../../schema/meeting';
import { LIBRARY_LIMITS } from '../../schema/library-base';
import { safeParse } from '../../schema/parse';
import { requestOrigin } from '../handler';
import { ApiError, errorResponse, isAllowedOrigin, jsonResponse, type ApiErrorCode } from '../http';
import { ensureSchema, type MeetDb, type MeetStatement } from './db';
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
const createSchema = Schema.Struct({
  doc: Schema.Unknown,
  turnstile: Schema.String,
  hostToken: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
});
const updateSchema = Schema.Struct({
  doc: MeetingDocSchema,
  baseRev: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  removed: Schema.optionalKey(
    Schema.Array(MeetingMemberId).check(Schema.isMaxLength(LIBRARY_LIMITS.meetingParticipantsMax)),
  ),
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
    const token = input.hostToken;
    const hash = await hashToken(token);
    async function retryExisting(): Promise<Response | null> {
      const row = await db
        .prepare('SELECT rev, doc_rev FROM meetings WHERE id = ?')
        .bind(doc.meetingId)
        .first<Pick<MeetingRow, 'rev' | 'doc_rev'>>();
      if (!row) return null;
      const host = await db
        .prepare(
          "SELECT hash FROM meeting_tokens WHERE meeting_id = ? AND kind = 'host' AND hash = ?",
        )
        .bind(doc.meetingId, hash)
        .first();
      if (!host) throw new ApiError('CONFLICT', '이미 올린 약속이에요');
      return jsonResponse(
        { id: doc.meetingId, rev: row.rev, docRev: row.doc_rev, hostToken: token, created: false },
        { headers: PRIVATE_HEADERS },
      );
    }
    const existing = await retryExisting();
    if (existing) return existing;
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
      // 동시에 만든 같은 토큰의 요청도 이미 저장된 약속으로 이어진다.
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: meetings\.id\b/i.test(error.message)
      ) {
        const existing = await retryExisting();
        if (existing) return existing;
      }
      throw error;
    }
    ctx.waitUntil(
      Promise.all([pruneExpired(db, now, 20), pruneLimits(db, now)]).catch(() => undefined),
    );
    return jsonResponse(
      { id: doc.meetingId, rev: 1, docRev: 1, hostToken: token, created: true },
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
    const token = await readToken(ctx, id);
    if (ctx.request.headers.has('Authorization') && token === null) {
      throw new ApiError('UNAUTHORIZED', '약속 연결을 확인해 주세요');
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
    await activeMeeting(ctx.env.DB, id, now);
    await requireHost(ctx, id);
    const {
      doc,
      baseRev,
      removed: requestedRemoved = [],
    } = validate(updateSchema, await readJson(ctx.request));
    if (doc.meetingId !== id) throw new ApiError('BAD_REQUEST', '약속 id가 경로와 달라요');
    const conflict = (docRev: number): never => {
      throw new MeetError('CONFLICT', '약속이 바뀌었어요. 다시 확인해 주세요', { docRev });
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await activeMeeting(ctx.env.DB, id, now);
      await requireHost(ctx, id);
      if (baseRev !== row.doc_rev) conflict(row.doc_rev);
      const old: MeetingDoc = JSON.parse(row.doc);
      const remaining = new Set(doc.participants.map((p) => p.id));
      const hostId = old.participants[0]!.id;
      const removed = [
        ...new Set([...old.participants.map((p) => p.id), ...requestedRemoved]),
      ].filter((pid) => pid !== hostId && !remaining.has(pid));
      const db = ctx.env.DB;
      const { results: replies } = await db
        .prepare('SELECT participant_id FROM meeting_replies WHERE meeting_id = ?')
        .bind(id)
        .all<{ participant_id: string }>();
      const replyOnly = replies.filter(
        (r) => !remaining.has(r.participant_id) && !removed.includes(r.participant_id),
      );
      if (doc.participants.length + replyOnly.length > LIBRARY_LIMITS.meetingParticipantsMax)
        throw new MeetError('CONFLICT', '참석자는 10명까지예요', { reason: 'full' });
      // 삭제도 버전 조건에 묶는다. 뒤늦게 도착한 요청이 다른 기기의 답장을 지우지 않는다.
      const guard = 'EXISTS (SELECT 1 FROM meetings WHERE id = ? AND doc_rev = ? AND rev = ?)';
      const cleanup = removed.flatMap((pid) => [
        db
          .prepare(
            `DELETE FROM meeting_replies WHERE meeting_id = ? AND participant_id = ? AND ${guard}`,
          )
          .bind(id, pid, id, baseRev, row.rev),
        db
          .prepare(
            `DELETE FROM meeting_tokens WHERE meeting_id = ? AND participant_id = ? AND kind = 'guest' AND ${guard}`,
          )
          .bind(id, pid, id, baseRev, row.rev),
      ]);
      const oldCandidates = new Map(old.candidates.map((c) => [c.id, c]));
      const changedConditions =
        doc.mode !== old.mode ||
        JSON.stringify(doc.at) !== JSON.stringify(old.at) ||
        doc.candidates.length !== old.candidates.length ||
        doc.candidates.some((c) => {
          const previous = oldCandidates.get(c.id);
          return !previous || c.lng !== previous.lng || c.lat !== previous.lat;
        });
      if (changedConditions) {
        cleanup.push(
          db
            .prepare(`UPDATE meeting_replies SET times = NULL WHERE meeting_id = ? AND ${guard}`)
            .bind(id, id, baseRev, row.rev),
        );
      }
      const results = await db.batch([
        ...cleanup,
        db
          .prepare(
            'UPDATE meetings SET doc = ?, doc_rev = doc_rev + 1, rev = rev + 1, updated_at = ?, expires_at = ? WHERE id = ? AND doc_rev = ? AND rev = ?',
          )
          .bind(JSON.stringify(doc), now.toISOString(), expiresAt(doc, now), id, baseRev, row.rev),
      ]);
      if (changes(results[results.length - 1]) === 0) {
        continue;
      }
      // 뒤이은 변경도 다음 확인에서 전체로 받도록 rev는 처음 읽은 값에서 보수적으로 올린다.
      return jsonResponse({ rev: row.rev + 1, docRev: baseRev + 1 }, { headers: PRIVATE_HEADERS });
    }
    const latest = await activeMeeting(ctx.env.DB, id, now);
    if (latest.doc_rev !== baseRev) conflict(latest.doc_rev);
    throw new MeetError('CONFLICT', '잠시 뒤 다시 해 주세요', { reason: 'busy' });
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

const claimSchema = Schema.Union([
  Schema.Struct({ participantId: MeetingMemberId }),
  Schema.Struct({ newName: Schema.String }),
]);
const releaseSchema = Schema.Union([
  Schema.Struct({ participantId: MeetingMemberId }),
  Schema.Struct({ host: Schema.Literal(true), hostToken: createSchema.fields.hostToken }),
]);
const normalizeName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ');
const revisionGuard = 'EXISTS (SELECT 1 FROM meetings WHERE id = ? AND rev = ?)';

function newParticipantId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  while (id.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte >= 252) continue;
      id += alphabet[byte % alphabet.length];
      if (id.length === 8) break;
    }
  }
  return id;
}

// 읽었던 버전일 때만 한 배치로 쓴다. 충돌하면 권한과 인원도 다시 확인한다.
async function changeMeeting(
  ctx: MeetContext,
  id: string,
  now: Date,
  build: (
    row: MeetingRow,
    doc: MeetingDoc,
  ) => Promise<
    | {
        statements: MeetStatement[];
        fields?: Record<string, unknown>;
      }
    | Response
  >,
): Promise<Response> {
  const db = ctx.env.DB;
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await activeMeeting(db, id, now);
    const doc: MeetingDoc = JSON.parse(row.doc);
    const change = await build(row, doc);
    if (change instanceof Response) return change;
    const { statements, fields } = change;
    const results = await db.batch([
      ...statements,
      db
        .prepare(
          'UPDATE meetings SET rev = rev + 1, updated_at = ?, expires_at = ? WHERE id = ? AND rev = ?',
        )
        .bind(now.toISOString(), expiresAt(doc, now), id, row.rev),
    ]);
    if (changes(results[results.length - 1]) === 0) continue;
    return jsonResponse({ rev: row.rev + 1, ...fields }, { headers: PRIVATE_HEADERS });
  }
  throw new MeetError('CONFLICT', '잠시 뒤 다시 해 주세요', { reason: 'busy' });
}

export function handleClaim(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async (origin) => {
    const id = readMeetingId(ctx);
    const now = deps.now();
    await prepare(ctx, origin, now, 'claim');
    // 만료·없는 약속을 입력 오류보다 먼저 알린다.
    await activeMeeting(ctx.env.DB, id, now);
    const input = validate(claimSchema, await readJson(ctx.request));
    const name = 'newName' in input ? validate(MeetingName, normalizeName(input.newName)) : null;
    return changeMeeting(ctx, id, now, async (row, doc) => {
      const db = ctx.env.DB;
      const { results: replies } = await db
        .prepare('SELECT participant_id, name FROM meeting_replies WHERE meeting_id = ?')
        .bind(id)
        .all<Pick<ReplyRow, 'participant_id' | 'name'>>();
      let participantId: string;
      let isNew = false;
      if ('participantId' in input) {
        if (!doc.participants.some((p) => p.id === input.participantId)) {
          throw new ApiError('NOT_FOUND', '참석자가 없어요');
        }
        participantId = input.participantId;
      } else {
        const participant = doc.participants.find((p) => normalizeName(p.name) === name);
        const bodyIds = new Set(doc.participants.map((p) => p.id));
        const reply = replies.find(
          (r) => !bodyIds.has(r.participant_id) && normalizeName(r.name) === name,
        );
        const existing = participant?.id ?? reply?.participant_id;
        if (existing) participantId = existing;
        else {
          const ids = new Set([
            ...doc.participants.map((p) => p.id),
            ...replies.map((r) => r.participant_id),
          ]);
          if (ids.size >= LIBRARY_LIMITS.meetingParticipantsMax) {
            throw new MeetError('CONFLICT', '참석자는 10명까지예요', { reason: 'full' });
          }
          do {
            participantId = newParticipantId();
          } while (ids.has(participantId));
          isNew = true;
        }
      }
      if (participantId === doc.participants[0]?.id) {
        throw new MeetError('CONFLICT', '주최자는 고를 수 없어요', { reason: 'host' });
      }
      if (
        await db
          .prepare(
            "SELECT hash FROM meeting_tokens WHERE meeting_id = ? AND participant_id = ? AND kind = 'guest'",
          )
          .bind(id, participantId)
          .first()
      ) {
        throw new MeetError('CONFLICT', '다른 기기에서 이미 골랐어요', { reason: 'taken' });
      }
      const guestToken = newToken();
      const statements = isNew
        ? [
            db
              .prepare(
                `INSERT INTO meeting_replies (meeting_id, participant_id, name, origin, likes, times, updated_at) SELECT ?, ?, ?, NULL, '[]', NULL, ? WHERE ${revisionGuard}`,
              )
              .bind(id, participantId, name, now.toISOString(), id, row.rev),
          ]
        : [];
      statements.push(
        db
          .prepare(
            `INSERT INTO meeting_tokens (hash, meeting_id, kind, participant_id, created_at) SELECT ?, ?, 'guest', ?, ? WHERE ${revisionGuard}`,
          )
          .bind(await hashToken(guestToken), id, participantId, now.toISOString(), id, row.rev),
      );
      return { statements, fields: { participantId, guestToken } };
    });
  });
}

export function handleReply(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async (origin) => {
    const id = readMeetingId(ctx);
    const now = deps.now();
    await prepare(ctx, origin, now, 'reply');
    let input: ReplyInput | undefined;
    return changeMeeting(ctx, id, now, async (row, doc) => {
      const token = await readToken(ctx, id);
      if (!token || (token.kind === 'guest' && !token.participant_id)) {
        throw new ApiError('UNAUTHORIZED', '참석자 연결을 확인해 주세요');
      }
      input ??= validate(ReplyInputSchema, await readJson(ctx.request));
      const host = token.kind === 'host';
      const timesDropped =
        !host && input.times !== undefined && input.times !== null && input.docRev !== row.doc_rev;
      const participantId = host ? doc.participants[0]!.id : token.participant_id!;
      const candidates = new Set(doc.candidates.map((c) => c.id));
      if (
        input.likes.some((cid) => !candidates.has(cid)) ||
        (!host &&
          !timesDropped &&
          Object.keys(input.times ?? {}).some((cid) => !candidates.has(cid)))
      ) {
        throw new ApiError('BAD_REQUEST', '없는 후보예요');
      }
      const db = ctx.env.DB;
      const old = await db
        .prepare('SELECT * FROM meeting_replies WHERE meeting_id = ? AND participant_id = ?')
        .bind(id, participantId)
        .first<ReplyRow>();
      const name = doc.participants.find((p) => p.id === participantId)?.name ?? old?.name;
      if (!name) throw new ApiError('UNAUTHORIZED', '참석자 연결을 확인해 주세요');
      const encode = (value: unknown) => (value == null ? null : JSON.stringify(value));
      return {
        ...(timesDropped ? { fields: { timesDropped: true } } : {}),
        statements: [
          db
            .prepare(
              `INSERT INTO meeting_replies (meeting_id, participant_id, name, origin, likes, times, updated_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${revisionGuard} ON CONFLICT(meeting_id, participant_id) DO UPDATE SET name = excluded.name, origin = excluded.origin, likes = excluded.likes, times = excluded.times, updated_at = excluded.updated_at`,
            )
            .bind(
              id,
              participantId,
              name,
              host
                ? null
                : input.origin === undefined
                  ? (old?.origin ?? null)
                  : encode(input.origin),
              JSON.stringify(input.likes),
              host || timesDropped
                ? null
                : input.times === undefined
                  ? (old?.times ?? null)
                  : encode(input.times),
              now.toISOString(),
              id,
              row.rev,
            ),
        ],
      };
    });
  });
}

export function handleRelease(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async (origin) => {
    const id = readMeetingId(ctx);
    const now = deps.now();
    await prepare(ctx, origin, now);
    let input: typeof releaseSchema.Type | undefined;
    return changeMeeting(ctx, id, now, async (row) => {
      input ??= validate(releaseSchema, await readJson(ctx.request));
      const db = ctx.env.DB;
      if ('host' in input) {
        const existing = await db
          .prepare(
            "SELECT hash FROM meeting_tokens WHERE meeting_id = ? AND kind = 'host' AND hash = ?",
          )
          .bind(id, await hashToken(input.hostToken))
          .first();
        if (existing)
          return jsonResponse(
            { rev: row.rev, hostToken: input.hostToken },
            { headers: PRIVATE_HEADERS },
          );
      }
      await requireHost(ctx, id);
      if ('participantId' in input) {
        return {
          statements: [
            db
              .prepare(
                `DELETE FROM meeting_tokens WHERE meeting_id = ? AND participant_id = ? AND kind = 'guest' AND ${revisionGuard}`,
              )
              .bind(id, input.participantId, id, row.rev),
          ],
        };
      }
      const hostToken = input.hostToken;
      return {
        statements: [
          db
            .prepare(
              `DELETE FROM meeting_tokens WHERE meeting_id = ? AND kind = 'host' AND ${revisionGuard}`,
            )
            .bind(id, id, row.rev),
          db
            .prepare(
              `INSERT INTO meeting_tokens (hash, meeting_id, kind, participant_id, created_at) SELECT ?, ?, 'host', NULL, ? WHERE ${revisionGuard}`,
            )
            .bind(await hashToken(hostToken), id, now.toISOString(), id, row.rev),
        ],
        fields: { hostToken },
      };
    });
  });
}
