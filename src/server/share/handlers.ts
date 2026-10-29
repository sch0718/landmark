import { Schema } from 'effect';
import {
  SHORT_BODY_MAX,
  SHORT_ID_PATTERN,
  shortExpiresAt,
  type ShortLinkKind,
} from '../../domain/share/short-link';
import { ApiError, jsonResponse } from '../http';
import type { MeetDb } from '../meet/db';
import type { MeetContext } from '../meet/env';
import {
  checkLimit,
  configurationError,
  isLocal,
  MeetError,
  prepare,
  validate,
  withRequest,
  type MeetDeps,
} from '../meet/handlers';
import { pruneLimits } from '../meet/limits';
import { hashToken } from '../meet/tokens';
import { verifyTurnstile } from '../meet/turnstile';
import { messagePageResponse, OPEN_TEXT, openPageResponse } from './open-page';

type ShareRow = { id: string; body: string; expires_at: string };
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
/** 본문(32,040자)과 나머지 필드를 넉넉히 담는 요청 크기. */
export const SHARE_REQUEST_MAX_BYTES = 40_000;
const createSchema = Schema.Struct({
  body: Schema.String.check(Schema.isPattern(new RegExp(`^[A-Za-z0-9_-]{1,${SHORT_BODY_MAX}}$`))),
  kind: Schema.Literals(['places', 'trip']),
  keepUntil: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
  turnstile: Schema.String,
  deleteToken: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
});

function newShareId(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * 본문을 읽기 전에 길이 헤더를 보고, 헤더가 없거나 틀려도 조금씩 읽으며 세어 한도를 넘는 순간 끊는다
 * (큰 본문을 통째로 메모리에 받지 않는다).
 */
export async function readLimitedJson(
  request: Request,
  maxBytes: number = SHARE_REQUEST_MAX_BYTES,
): Promise<unknown> {
  const tooLarge = () => new ApiError('TOO_LARGE', '공유 문서가 너무 커요');
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > maxBytes) throw tooLarge();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    const reader = request.body?.getReader();
    for (;;) {
      if (!reader) break;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      parts.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('BAD_REQUEST', '요청 본문을 읽지 못했어요');
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError('BAD_REQUEST', '요청 본문을 읽지 못했어요');
  }
}

export async function pruneExpiredShares(db: MeetDb, now: Date, max: number): Promise<number> {
  const { meta } = await db
    .prepare(
      `DELETE FROM share_links WHERE id IN (
      SELECT id FROM share_links WHERE expires_at <= ? ORDER BY expires_at, id LIMIT ?
    )`,
    )
    .bind(now.toISOString(), max)
    .run();
  return meta.changes;
}

function readShareId(ctx: MeetContext): string | null {
  const id = ctx.params.id;
  return typeof id === 'string' && SHORT_ID_PATTERN.test(id) ? id : null;
}

export function handleShareCreate(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    if (ctx.env.SHARE_SHORT === 'off') {
      throw new MeetError('UNAVAILABLE', '짧은 링크 만들기가 꺼져 있어요', { reason: 'off' });
    }
    const now = deps.now();
    await prepare(ctx, now, 'shareCreate');
    const secret = ctx.env.TURNSTILE_SECRET;
    if (!secret && !isLocal(ctx.request)) configurationError();
    const input = validate(createSchema, await readLimitedJson(ctx.request));
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
    const db = ctx.env.DB;
    const deleteHash = await hashToken(input.deleteToken);
    // 응답이 사라져 같은 토큰으로 다시 오면 처음 만든 링크를 돌려준다(본문은 처음 것을 둔다).
    async function existing(): Promise<Response | null> {
      const row = await db
        .prepare('SELECT id, expires_at FROM share_links WHERE delete_hash = ?')
        .bind(deleteHash)
        .first<{ id: string; expires_at: string }>();
      return row
        ? jsonResponse(
            { id: row.id, expiresAt: row.expires_at, created: false },
            { headers: PRIVATE_HEADERS },
          )
        : null;
    }
    const retried = await existing();
    if (retried) return retried;
    const kind: ShortLinkKind = input.kind;
    const expiresAt = shortExpiresAt(kind, input.keepUntil, now).toISOString();
    for (let attempt = 0; ; attempt++) {
      const id = newShareId();
      try {
        await db
          .prepare(
            'INSERT INTO share_links (id, body, kind, delete_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .bind(id, input.body, kind, deleteHash, now.toISOString(), expiresAt)
          .run();
        ctx.waitUntil(
          Promise.all([pruneExpiredShares(db, now, 20), pruneLimits(db, now)]).catch(
            () => undefined,
          ),
        );
        return jsonResponse(
          { id, expiresAt, created: true },
          { status: 201, headers: PRIVATE_HEADERS },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/UNIQUE constraint failed: share_links\.delete_hash\b/i.test(message)) {
          const raced = await existing();
          if (raced) return raced;
        }
        if (!/UNIQUE constraint failed: share_links\.id\b/i.test(message) || attempt >= 2) {
          throw error;
        }
      }
    }
  });
}

/**
 * 받는 사람이 카카오톡에서 여는 주소. 화면 이동에는 `Origin`·`Referer`가 없으므로 출처를 보지 않고,
 * JSON 대신 사람이 읽는 HTML을 돌려준다. 없는·만료된 링크만 읽기 한도를 센다(넘겨짚기 늦추기).
 */
export async function handleShareOpen(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  try {
    const now = deps.now();
    await prepare(ctx, now);
    const db = ctx.env.DB;
    const id = readShareId(ctx);
    const row =
      id === null
        ? null
        : await db
            .prepare('SELECT id, body, expires_at FROM share_links WHERE id = ?')
            .bind(id)
            .first<ShareRow>();
    ctx.waitUntil(pruneExpiredShares(db, now, 20).catch(() => undefined));
    if (row && new Date(row.expires_at).getTime() > now.getTime()) {
      return await openPageResponse(row.body);
    }
    await checkLimit(ctx, now, 'shareRead');
    return row
      ? messagePageResponse(410, OPEN_TEXT.ended)
      : messagePageResponse(404, OPEN_TEXT.notFound);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
      return messagePageResponse(429, OPEN_TEXT.busy);
    }
    return messagePageResponse(503, OPEN_TEXT.unavailable);
  }
}

export function handleShareDelete(ctx: MeetContext, deps: MeetDeps): Promise<Response> {
  return withRequest(ctx, async () => {
    const now = deps.now();
    await prepare(ctx, now, 'shareDelete');
    const id = readShareId(ctx);
    if (id === null) throw new ApiError('NOT_FOUND', '짧은 링크가 없어요');
    const match = /^Bearer\s+([A-Za-z0-9_-]{43})$/i.exec(
      ctx.request.headers.get('Authorization') ?? '',
    );
    if (!match) throw new ApiError('UNAUTHORIZED', '지울 권한을 확인해 주세요');
    const db = ctx.env.DB;
    const { meta } = await db
      .prepare('DELETE FROM share_links WHERE id = ? AND delete_hash = ?')
      .bind(id, await hashToken(match[1]!))
      .run();
    if (meta.changes === 0) {
      const row = await db.prepare('SELECT id FROM share_links WHERE id = ?').bind(id).first();
      if (row) throw new ApiError('UNAUTHORIZED', '지울 권한을 확인해 주세요');
      throw new ApiError('NOT_FOUND', '짧은 링크가 없어요');
    }
    return new Response(null, { status: 204, headers: PRIVATE_HEADERS });
  });
}
