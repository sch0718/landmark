import { parseAccountList, parseAllowList } from '@sch0718/firebase-session/worker';
import { devFakeEnabled } from '../library-sync/auth';
import type { SyncContext, SyncDeps } from '../library-sync/env';
import { isLocalRequest, SyncHttpError } from '../library-sync/http';
import { consumeCounter, counterKey } from '../library-sync/limits';
import { hashIp, hashToken } from '../meet/tokens';
import {
  AGENT_LIMITS,
  AGENT_SCOPES,
  AGENT_TOKEN_PATTERN,
  AGENT_TOKEN_TOUCH_MS,
  type AgentScope,
} from './tokens';

export type AgentPrincipal = {
  userId: string;
  tokenId: string;
  tokenName: string;
  scopes: AgentScope[];
  expiresAt: number;
  provider: 'google' | 'kakao' | 'naver';
};

type AuthRow = {
  id: string;
  user_id: string;
  name: string;
  scopes: string;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  firebase_sub: string;
  email: string;
};

export async function requireAgentToken(
  ctx: SyncContext,
  deps: SyncDeps,
  scope: AgentScope | null,
): Promise<AgentPrincipal> {
  const { request, env } = ctx;
  const db = env.DB;
  if (!db) throw new SyncHttpError(503, 'config');
  const now = deps.now();
  const header = request.headers.get('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const row =
    token && AGENT_TOKEN_PATTERN.test(token)
      ? await db
          .prepare(
            `
        SELECT t.id, t.user_id, t.name, t.scopes, t.expires_at, t.last_used_at, t.revoked_at, u.firebase_sub, u.email
        FROM agent_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?
      `,
          )
          .bind(await hashToken(token))
          .first<AuthRow>()
      : null;
  if (!row) {
    const salt = env.IP_HASH_SALT ?? (isLocalRequest(request) ? 'dev-salt' : null);
    if (!salt) throw new SyncHttpError(503, 'config');
    const ipHash = await hashIp(request.headers.get('CF-Connecting-IP') ?? 'local', salt);
    if (
      !(await consumeCounter(
        db,
        counterKey('agent-auth-fail', ipHash, now),
        1,
        AGENT_LIMITS.authFail,
      ))
    )
      throw new SyncHttpError(429, 'rate-limited');
    throw new SyncHttpError(401, 'unauthorized');
  }
  if (row.revoked_at !== null) throw new SyncHttpError(401, 'token-revoked');
  if (row.expires_at <= now) throw new SyncHttpError(401, 'token-expired');

  const social = /^(kakao|naver):/i.exec(row.firebase_sub);
  const allowed = social
    ? parseAccountList(
        env.ALLOWED_ACCOUNTS ?? (devFakeEnabled(ctx) ? 'kakao:dev-me,naver:dev-me' : undefined),
      ).has(row.firebase_sub)
    : !!row.email && parseAllowList(env.ALLOWED_EMAILS).has(row.email.toLowerCase());
  if (!allowed) throw new SyncHttpError(403, 'not-allowed');
  const scopes = AGENT_SCOPES.filter((value) => row.scopes.split(' ').includes(value));
  if (scope && !scopes.includes(scope)) throw new SyncHttpError(403, 'scope');
  if (now - (row.last_used_at ?? 0) >= AGENT_TOKEN_TOUCH_MS) {
    await db
      .prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?')
      .bind(now, row.id)
      .run();
  }
  return {
    userId: row.user_id,
    tokenId: row.id,
    tokenName: row.name,
    scopes,
    expiresAt: row.expires_at,
    provider: social ? (social[1]!.toLowerCase() as 'kakao' | 'naver') : 'google',
  };
}
