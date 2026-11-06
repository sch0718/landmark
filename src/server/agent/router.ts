import { base64url } from '@sch0718/firebase-session/worker';
import { Schema } from 'effect';
import { SHORT_ID_PATTERN } from '../../domain/share/short-link';
import { safeParse } from '../../schema/parse';
import { ApiError } from '../http';
import type { SyncContext, SyncDeps } from '../library-sync/env';
import { syncError, SyncHttpError, syncJson } from '../library-sync/http';
import { consumeCounter, counterKey } from '../library-sync/limits';
import { parsePullQuery, pullChanges, PUSH_MAX_BYTES } from '../library-sync/library';
import { ensureSchema } from '../meet/db';
import { hashToken } from '../meet/tokens';
import {
  deleteShareLink,
  insertShareLink,
  pruneExpiredShares,
  readLimitedJson,
  SHARE_CREATE_FIELDS,
  SHARE_REQUEST_MAX_BYTES,
} from '../share/handlers';
import { requireAgentToken, type AgentPrincipal } from './auth';
import { listChanges, pruneChanges } from './changes';
import { editItems, parseEditBody, parseUndoBody, undoChanges } from './library-edit';
import { checkInboxDoc, findPendingInbox, parseInboxBody, pruneInbox, putInbox } from './inbox';
import { AGENT_LIMITS, type AgentScope } from './tokens';

export type AgentRoute = {
  method: 'GET' | 'POST' | 'DELETE';
  path: RegExp;
  pattern: string;
  scope: AgentScope | null;
  allowWhenOff?: true;
  /** 값이 'off'인 AGENT_EDIT이면 토큰 검사 전에 막는다. */
  editSwitch?: true;
  run(ctx: SyncContext, deps: SyncDeps, who: AgentPrincipal, params: string[]): Promise<Response>;
};

const shareSchema = Schema.Struct({ ...SHARE_CREATE_FIELDS, kind: Schema.Literal('trip') });

async function consume(
  ctx: SyncContext,
  who: AgentPrincipal,
  action: string,
  max: number,
  now: number,
  amount = 1,
): Promise<void> {
  if (!(await consumeCounter(ctx.env.DB!, counterKey(action, who.userId, now), amount, max)))
    throw new SyncHttpError(429, 'rate-limited');
}

export const AGENT_ROUTES: AgentRoute[] = [
  {
    method: 'GET',
    path: /^\/v1\/whoami$/,
    pattern: '/v1/whoami',
    scope: null,
    async run(ctx, deps, who) {
      await consume(ctx, who, 'agent-whoami', AGENT_LIMITS.whoami, deps.now());
      return syncJson(200, {
        name: who.tokenName,
        scopes: who.scopes,
        expiresAt: who.expiresAt,
        provider: who.provider,
      });
    },
  },
  {
    method: 'POST',
    path: /^\/v1\/inbox$/,
    pattern: '/v1/inbox',
    scope: 'inbox:write',
    async run(ctx, deps, who) {
      const now = deps.now();
      await consume(ctx, who, 'agent-inbox', AGENT_LIMITS.inbox, now);
      const body = parseInboxBody(await readLimitedJson(ctx.request, SHARE_REQUEST_MAX_BYTES));
      const existing = await findPendingInbox(ctx.env.DB!, who.userId, body.key, now);
      if (existing) return syncJson(200, existing);
      const meta = await checkInboxDoc(body.d);
      const result = await putInbox(ctx.env.DB!, who, body, meta, base64url(deps.random(12)), now);
      ctx.waitUntil(pruneInbox(ctx.env.DB!, now).catch(() => undefined));
      return syncJson(result.created ? 201 : 200, result);
    },
  },
  {
    method: 'POST',
    path: /^\/v1\/share$/,
    pattern: '/v1/share',
    scope: 'share:create',
    async run(ctx, deps, who) {
      if (ctx.env.SHARE_SHORT === 'off') throw new SyncHttpError(503, 'off');
      const now = deps.now();
      await consume(ctx, who, 'agent-share', AGENT_LIMITS.share, now);
      const parsed = safeParse(
        shareSchema,
        await readLimitedJson(ctx.request, SHARE_REQUEST_MAX_BYTES),
        { onExcessProperty: 'error' },
      );
      if (!parsed.success) throw new SyncHttpError(422, 'invalid');
      const { deleteToken, ...input } = parsed.data;
      const result = await insertShareLink(
        ctx.env.DB!,
        { ...input, deleteHash: await hashToken(deleteToken) },
        new Date(now),
      );
      if (result.created)
        ctx.waitUntil(pruneExpiredShares(ctx.env.DB!, new Date(now), 20).catch(() => undefined));
      return syncJson(result.created ? 201 : 200, result);
    },
  },
  {
    method: 'DELETE',
    path: /^\/v1\/share\/([^/]+)$/,
    pattern: '/v1/share/:id',
    scope: 'share:create',
    allowWhenOff: true,
    async run(ctx, deps, who, params) {
      await consume(ctx, who, 'agent-share-delete', AGENT_LIMITS.shareDelete, deps.now());
      const id = params[0]!;
      if (!SHORT_ID_PATTERN.test(id)) throw new SyncHttpError(404, 'not-found');
      const deleteToken = ctx.request.headers.get('X-Delete-Token');
      if (!deleteToken || !/^[A-Za-z0-9_-]{43}$/.test(deleteToken))
        throw new SyncHttpError(400, 'bad-json');
      const result = await deleteShareLink(ctx.env.DB!, id, deleteToken);
      if (result === 'forbidden') throw new SyncHttpError(403, 'delete-token');
      if (result === 'not-found') throw new SyncHttpError(404, 'not-found');
      return syncJson(204, null);
    },
  },
  {
    method: 'GET',
    path: /^\/v1\/library\/changes$/,
    pattern: '/v1/library/changes',
    scope: 'library:read',
    async run(ctx, deps, who) {
      const now = deps.now();
      const url = new URL(ctx.request.url);
      // 에이전트 읽기는 기기 동기화가 아니라 서버 사본 읽기다.
      if (url.searchParams.has('device'))
        throw new SyncHttpError(422, 'invalid', { path: 'device' });
      const query = parsePullQuery(url);
      await consume(ctx, who, 'agent-library-read', AGENT_LIMITS.libraryRead, now);
      const result = await pullChanges(ctx.env.DB!, who, { ...query, deviceId: null }, now);
      if ('resync' in result) return syncJson(410, { error: 'resync', purgedRev: result.resync });
      return new Response(result.body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store',
        },
      });
    },
  },
  {
    method: 'GET',
    path: /^\/v1\/library\/edits$/,
    pattern: '/v1/library/edits',
    scope: 'library:read',
    async run(ctx, deps, who) {
      const now = deps.now();
      await consume(ctx, who, 'agent-library-read', AGENT_LIMITS.libraryRead, now);
      return syncJson(200, { changes: await listChanges(ctx.env.DB!, who.userId, now) });
    },
  },
  {
    method: 'POST',
    path: /^\/v1\/library\/edit$/,
    pattern: '/v1/library/edit',
    scope: 'library:write',
    editSwitch: true,
    async run(ctx, deps, who) {
      const now = deps.now();
      const body = parseEditBody(await readLimitedJson(ctx.request, PUSH_MAX_BYTES));
      await consume(ctx, who, 'agent-edit', AGENT_LIMITS.edit, now, body.ops.length);
      const reply = await editItems(ctx.env.DB!, who, body, now);
      ctx.waitUntil(pruneChanges(ctx.env.DB!, who.userId, now).catch(() => undefined));
      return syncJson(200, reply);
    },
  },
  {
    method: 'POST',
    path: /^\/v1\/library\/undo$/,
    pattern: '/v1/library/undo',
    scope: 'library:write',
    editSwitch: true,
    async run(ctx, deps, who) {
      const now = deps.now();
      const target = parseUndoBody(await readLimitedJson(ctx.request, SHARE_REQUEST_MAX_BYTES));
      await consume(ctx, who, 'agent-library-read', AGENT_LIMITS.libraryRead, now);
      return syncJson(200, await undoChanges(ctx.env.DB!, who, target, now));
    },
  },
];

export async function handleAgent(ctx: SyncContext, deps: SyncDeps): Promise<Response> {
  const start = deps.now();
  const path = new URL(ctx.request.url).pathname.replace(/^\/api\/agent/, '');
  let pattern = 'unknown';
  let response: Response;
  let diagnostic: { error: string; d1?: string } | undefined;
  try {
    const matched = AGENT_ROUTES.filter((route) => route.path.test(path));
    const route = matched.find((candidate) => candidate.method === ctx.request.method);
    if (!route)
      throw new SyncHttpError(matched.length ? 405 : 404, matched.length ? 'method' : 'not-found');
    pattern = route.pattern;
    if (ctx.request.headers.has('Origin')) throw new SyncHttpError(403, 'origin');
    if (!ctx.env.DB) throw new SyncHttpError(503, 'config');
    await ensureSchema(ctx.env.DB);
    if (ctx.env.AGENT_API === 'off' && !route.allowWhenOff) throw new SyncHttpError(503, 'off');
    if (route.editSwitch && ctx.env.AGENT_EDIT === 'off') throw new SyncHttpError(503, 'off');
    const who = await requireAgentToken(ctx, deps, route.scope);
    response = await route.run(ctx, deps, who, route.path.exec(path)!.slice(1));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'TOO_LARGE')
      response = syncJson(413, { error: 'too-large' });
    else if (error instanceof ApiError && error.code === 'BAD_REQUEST')
      response = syncJson(400, { error: 'bad-json' });
    else {
      const known = syncError(error);
      if (known) response = known;
      else {
        const d1 = error instanceof Error ? /^(D1_[A-Z_]+)/.exec(error.message)?.[1] : undefined;
        diagnostic = {
          error: error instanceof Error ? error.name : typeof error,
          ...(d1 ? { d1 } : {}),
        };
        response = syncJson(500, { error: 'internal' });
      }
    }
  }
  deps.log(
    JSON.stringify({
      method: ctx.request.method,
      path: pattern,
      status: response.status,
      ms: deps.now() - start,
      ...diagnostic,
    }),
  );
  return response;
}
