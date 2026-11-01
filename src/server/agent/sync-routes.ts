import { readJson } from '@sch0718/firebase-session/worker';
import { requireBackupUser } from '../library-sync/backup';
import type { SyncContext, SyncDeps } from '../library-sync/env';
import { SyncHttpError, syncJson } from '../library-sync/http';
import { consumeCounter, counterKey } from '../library-sync/limits';
import type { SyncRoute } from '../library-sync/router';
import { deleteInboxItem, listInbox, pruneInbox, readInboxItem } from './inbox';
import {
  AGENT_LIMITS,
  AGENT_TOKEN_MAX_ACTIVE,
  issueAgentToken,
  listAgentTokens,
  parseIssueBody,
  pruneAgentTokens,
  revokeAgentToken,
} from './tokens';

async function inboxReader(ctx: SyncContext, deps: SyncDeps) {
  const user = await requireBackupUser(ctx, deps);
  const now = deps.now();
  if (
    !(await consumeCounter(
      ctx.env.DB!,
      counterKey('agent-inbox-read', user.userId, now),
      1,
      AGENT_LIMITS.inboxRead,
    ))
  )
    throw new SyncHttpError(429, 'rate-limited');
  return { user, now };
}

export const AGENT_SYNC_ROUTES: SyncRoute[] = [
  {
    method: 'GET',
    path: /^\/v1\/agent\/tokens$/,
    pattern: '/v1/agent/tokens',
    allowWhenOff: true,
    async run(ctx, deps) {
      const user = await requireBackupUser(ctx, deps);
      const enabled = ctx.env.AGENT_API !== 'off';
      return syncJson(200, {
        enabled,
        canCreate: enabled && ctx.env.LIBRARY_SYNC !== 'off',
        maxActive: AGENT_TOKEN_MAX_ACTIVE,
        tokens: await listAgentTokens(ctx.env.DB!, user.userId, deps.now()),
      });
    },
  },
  {
    method: 'POST',
    path: /^\/v1\/agent\/tokens$/,
    pattern: '/v1/agent/tokens',
    async run(ctx, deps) {
      if (ctx.env.AGENT_API === 'off') throw new SyncHttpError(503, 'off');
      const user = await requireBackupUser(ctx, deps);
      const now = deps.now();
      if (
        !(await consumeCounter(
          ctx.env.DB!,
          counterKey('agent-token-create', user.userId, now),
          1,
          AGENT_LIMITS.tokenCreate,
        ))
      )
        throw new SyncHttpError(429, 'rate-limited');
      const input = parseIssueBody(await readJson(ctx.request, 4096));
      const { token, row } = await issueAgentToken(ctx.env.DB!, user.userId, input, deps);
      ctx.waitUntil(pruneAgentTokens(ctx.env.DB!, user.userId, now).catch(() => undefined));
      return syncJson(201, {
        token,
        id: row.id,
        name: row.name,
        scopes: row.scopes,
        expiresAt: row.expiresAt,
      });
    },
  },
  {
    method: 'DELETE',
    path: /^\/v1\/agent\/tokens\/([a-z0-9]{12})$/,
    pattern: '/v1/agent/tokens/:id',
    allowWhenOff: true,
    async run(ctx, deps, params) {
      const user = await requireBackupUser(ctx, deps);
      if (!(await revokeAgentToken(ctx.env.DB!, user.userId, params[0]!, deps.now())))
        throw new SyncHttpError(404, 'not-found');
      return syncJson(204, null);
    },
  },
  {
    method: 'GET',
    path: /^\/v1\/agent\/inbox$/,
    pattern: '/v1/agent/inbox',
    allowWhenOff: true,
    async run(ctx, deps) {
      const { user, now } = await inboxReader(ctx, deps);
      const items = await listInbox(ctx.env.DB!, user.userId, now);
      ctx.waitUntil(pruneInbox(ctx.env.DB!, now).catch(() => undefined));
      return syncJson(200, { items });
    },
  },
  {
    method: 'GET',
    path: /^\/v1\/agent\/inbox\/([A-Za-z0-9_-]{16})$/,
    pattern: '/v1/agent/inbox/:id',
    allowWhenOff: true,
    async run(ctx, deps, params) {
      const { user, now } = await inboxReader(ctx, deps);
      const item = await readInboxItem(ctx.env.DB!, user.userId, params[0]!, now);
      if (!item) throw new SyncHttpError(404, 'not-found');
      return syncJson(200, item);
    },
  },
  {
    method: 'DELETE',
    path: /^\/v1\/agent\/inbox\/([A-Za-z0-9_-]{16})$/,
    pattern: '/v1/agent/inbox/:id',
    allowWhenOff: true,
    async run(ctx, deps, params) {
      const user = await requireBackupUser(ctx, deps);
      if (!(await deleteInboxItem(ctx.env.DB!, user.userId, params[0]!)))
        throw new SyncHttpError(404, 'not-found');
      return syncJson(204, null);
    },
  },
];
