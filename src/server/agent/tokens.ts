import { base64url } from '@sch0718/firebase-session/worker';
import type { MeetDb } from '../meet/db';
import { hashToken } from '../meet/tokens';
import type { SyncDeps } from '../library-sync/env';
import { SyncHttpError } from '../library-sync/http';

export const AGENT_SCOPES = [
  'inbox:write',
  'share:create',
  'library:read',
  'library:write',
] as const;
/** 새 연결에 고를 수 있는 범위. library 범위는 PR ②에서 연다. */
export const ISSUABLE_SCOPES = ['inbox:write', 'share:create'] as const;
export const AGENT_TOKEN_PATTERN = /^lmk_[A-Za-z0-9_-]{43}$/;
export const AGENT_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const AGENT_TOKEN_MAX_ACTIVE = 10;
export const AGENT_TOKEN_TOUCH_MS = 60 * 60 * 1000;
export const AGENT_LIMITS = {
  tokenCreate: 20,
  inbox: 50,
  share: 50,
  shareDelete: 200,
  whoami: 500,
  inboxRead: 2000,
  /** 하루 AI 쓰기 항목 수(사용자별, 모든 토큰 합산) */
  edit: 500,
  libraryRead: 2000,
  authFail: 300,
} as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];
export type AgentTokenRow = {
  id: string;
  name: string;
  scopes: AgentScope[];
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function newAgentToken(deps: Pick<SyncDeps, 'random'>): string {
  return 'lmk_' + base64url(deps.random(32));
}

export function newAgentTokenId(deps: Pick<SyncDeps, 'random'>): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  while (id.length < 12) {
    for (const byte of deps.random(12 - id.length)) {
      // 36으로 나누어떨어지는 범위만 써서 각 문자의 확률을 같게 한다.
      if (byte < 252) id += alphabet[byte % 36];
    }
  }
  return id;
}

export function parseIssueBody(value: unknown): { name: string; scopes: AgentScope[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SyncHttpError(422, 'invalid');
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => key !== 'name' && key !== 'scopes') ||
    typeof body.name !== 'string' ||
    /\p{Cc}/u.test(body.name) ||
    body.name.trim().length < 1 ||
    body.name.trim().length > 40 ||
    !Array.isArray(body.scopes) ||
    body.scopes.length === 0 ||
    !Array.from(body.scopes).every((scope: unknown) =>
      ISSUABLE_SCOPES.some((allowed) => allowed === scope),
    )
  )
    throw new SyncHttpError(422, 'invalid');
  const scopes = body.scopes;
  return {
    name: body.name.trim(),
    scopes: ISSUABLE_SCOPES.filter((scope) => scopes.includes(scope)),
  };
}

export async function issueAgentToken(
  db: MeetDb,
  userId: string,
  input: { name: string; scopes: AgentScope[] },
  deps: Pick<SyncDeps, 'random' | 'now'>,
): Promise<{ token: string; row: AgentTokenRow }> {
  const now = deps.now();
  await pruneAgentTokens(db, userId, now);
  const token = newAgentToken(deps);
  const row: AgentTokenRow = {
    id: newAgentTokenId(deps),
    name: input.name,
    scopes: [...input.scopes],
    createdAt: now,
    expiresAt: now + AGENT_TOKEN_TTL_MS,
    lastUsedAt: null,
    revokedAt: null,
  };
  const result = await db
    .prepare(
      `
    INSERT INTO agent_tokens (id, user_id, token_hash, name, scopes, created_at, expires_at, last_used_at, revoked_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL
    WHERE (SELECT count(*) FROM agent_tokens WHERE user_id = ?2 AND revoked_at IS NULL AND expires_at > ?6) < ?8
  `,
    )
    .bind(
      row.id,
      userId,
      await hashToken(token),
      row.name,
      row.scopes.join(' '),
      now,
      row.expiresAt,
      AGENT_TOKEN_MAX_ACTIVE,
    )
    .run();
  if (result.meta.changes === 0) throw new SyncHttpError(409, 'too-many-tokens');
  return { token, row };
}

type StoredTokenRow = {
  id: string;
  name: string;
  scopes: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

export async function listAgentTokens(
  db: MeetDb,
  userId: string,
  now: number,
): Promise<AgentTokenRow[]> {
  const { results } = await db
    .prepare(
      `
    SELECT id, name, scopes, created_at, expires_at, last_used_at, revoked_at
    FROM agent_tokens WHERE user_id = ? AND COALESCE(revoked_at, expires_at) > ?
    ORDER BY created_at ASC
  `,
    )
    .bind(userId, now - RETENTION_MS)
    .all<StoredTokenRow>();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    scopes: AGENT_SCOPES.filter((scope) => row.scopes.split(' ').includes(scope)),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeAgentToken(
  db: MeetDb,
  userId: string,
  id: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    )
    .bind(now, id, userId)
    .run();
  if (result.meta.changes > 0) return true;
  return (
    (await db
      .prepare(
        'SELECT id FROM agent_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NOT NULL',
      )
      .bind(id, userId)
      .first()) !== null
  );
}

export async function pruneAgentTokens(db: MeetDb, userId: string, now: number): Promise<void> {
  await db
    .prepare('DELETE FROM agent_tokens WHERE user_id = ? AND COALESCE(revoked_at, expires_at) <= ?')
    .bind(userId, now - RETENTION_MS)
    .run();
}
