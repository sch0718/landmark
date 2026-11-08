import { AGENT_SYNC_ROUTES } from '../agent/sync-routes';
import { BACKUP_ROUTES } from './backup';
import {
  handleSessionRoute,
  HttpError,
  publicSessionId,
  purgeSessions,
  readJson,
  type D1Database,
} from '@sch0718/firebase-session/worker';
import { ensureSchema } from '../meet/db';
import { pruneLimits } from '../meet/limits';
import {
  devFakeEnabled,
  fakeSocial,
  providerStatus,
  redirectUrisFor,
  requireSyncUser,
  sessionAuthFor,
} from './auth';
import type { SyncContext, SyncDeps } from './env';
import { isSyncOrigin, syncError, SyncHttpError, syncJson } from './http';
import { consumeLoginLimit, consumeCounter, counterKey, SYNC_LIMITS } from './limits';
import {
  readMe,
  pullChanges,
  parsePullQuery,
  parsePushBody,
  pushItems,
  purgeTombstones,
  deleteAccountData,
  PURGE_INTERVAL_MS,
  PUSH_MAX_BYTES,
} from './library';
export type SyncRoute = {
  method: 'GET' | 'POST' | 'DELETE';
  path: RegExp;
  pattern: string;
  allowWhenOff?: true;
  run(ctx: SyncContext, deps: SyncDeps, params: string[], url: URL): Promise<Response>;
};
export const SYNC_ROUTES: SyncRoute[] = [
  {
    method: 'GET',
    path: /^\/v1\/me$/,
    pattern: '/v1/me',
    async run(c, d) {
      return syncJson(200, await readMe(c.env.DB!, await requireSyncUser(c, d)));
    },
  },
  {
    method: 'GET',
    path: /^\/v1\/library\/changes$/,
    pattern: '/v1/library/changes',
    async run(c, d, _p, url) {
      const user = await requireSyncUser(c, d);
      const now = d.now();
      if (
        !(await consumeCounter(
          c.env.DB!,
          counterKey('sync-pull', user.userId, now),
          1,
          SYNC_LIMITS.pull,
        ))
      )
        throw new SyncHttpError(429, 'rate-limited');
      const result = await pullChanges(c.env.DB!, user, parsePullQuery(url), now);
      if ('resync' in result) return syncJson(410, { error: 'resync', purgedRev: result.resync });
      if (result.purgedAt <= now - PURGE_INTERVAL_MS)
        c.waitUntil(purgeTombstones(c.env.DB!, user.userId, now));
      return new Response(result.body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store',
        },
      });
    },
  },
  {
    method: 'POST',
    path: /^\/v1\/library\/push$/,
    pattern: '/v1/library/push',
    async run(c, d) {
      const user = await requireSyncUser(c, d);
      const body = parsePushBody(await readJson(c.request, PUSH_MAX_BYTES));
      const now = d.now();
      for (const [action, amount, max] of [
        ['sync-push', 1, SYNC_LIMITS.push],
        ['sync-items', body.items.length, SYNC_LIMITS.items],
      ] as const)
        if (!(await consumeCounter(c.env.DB!, counterKey(action, user.userId, now), amount, max)))
          throw new SyncHttpError(429, 'rate-limited');
      return syncJson(200, await pushItems(c.env.DB!, user, body, now));
    },
  },
  {
    method: 'DELETE',
    path: /^\/v1\/account$/,
    pattern: '/v1/account',
    allowWhenOff: true,
    async run(c, d) {
      const user = await requireSyncUser(c, d);
      const body = await readJson(c.request);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        (body as { confirm?: string }).confirm !== 'delete'
      )
        throw new SyncHttpError(422, 'invalid');
      await deleteAccountData(c.env.DB!, user.userId);
      return syncJson(204, null);
    },
  },

  {
    method: 'GET',
    path: /^\/v1\/status$/,
    pattern: '/v1/status',
    allowWhenOff: true,
    async run(ctx) {
      const { devFake, ...providers } = providerStatus(ctx);
      const reason =
        ctx.env.LIBRARY_SYNC === 'off'
          ? 'off'
          : !Object.values(providers).some(Boolean)
            ? 'config'
            : undefined;
      return syncJson(200, { enabled: !reason, ...(reason ? { reason } : {}), providers, devFake });
    },
  },
  ...BACKUP_ROUTES,
  ...AGENT_SYNC_ROUTES,
];
export async function handleSync(ctx: SyncContext, deps: SyncDeps): Promise<Response> {
  const start = deps.now();
  const url = new URL(ctx.request.url);
  const path = url.pathname.replace(/^\/api\/sync/, '');
  let pattern = 'unknown';
  let response: Response;
  try {
    if (path.startsWith('/dev/fake-social/')) {
      response = devFakeEnabled(ctx)
        ? ((await fakeSocial(deps.now).handle(ctx.request, redirectUrisFor(ctx))) ??
          syncJson(404, { error: 'not-found' }))
        : syncJson(404, { error: 'not-found' });
    } else {
      if (!isSyncOrigin(ctx.request)) throw new SyncHttpError(403, 'origin');
      if (!ctx.env.DB) throw new SyncHttpError(503, 'config');
      await ensureSchema(ctx.env.DB);
      if (
        ctx.env.LIBRARY_SYNC === 'off' &&
        ctx.request.method === 'POST' &&
        (path === '/v1/session' || path === '/v1/session/social')
      ) {
        pattern = path;
        throw new SyncHttpError(503, 'off');
      }
      const session = await handleSessionRoute(ctx.request, sessionAuthFor(ctx, deps), {
        path,
        onRoute: (p) => {
          pattern = p;
        },
        beforeCreate: async () => {
          try {
            await consumeLoginLimit(ctx, deps.now());
          } catch (error) {
            if (error instanceof SyncHttpError)
              throw new HttpError(error.status, error.code, error.extra);
            throw error;
          }
        },
        onRevoke: async (user, target) => {
          const id = typeof target === 'object' ? target.id : publicSessionId(user.sessionHash);
          await ctx.env
            .DB!.prepare(
              `DELETE FROM library_devices WHERE user_id = ? AND session_id ${target === 'others' ? '<>' : '='} ?`,
            )
            .bind(user.userId, id)
            .run();
        },
        log: (message) => {
          if (!/^@sch0718\/firebase-session: internal \S+$/.test(message)) deps.log(message);
        },
      });
      if (session) {
        if (session.status === 200 && ctx.request.method === 'POST') {
          ctx.waitUntil(purgeSessions(ctx.env.DB as unknown as D1Database, deps.now(), 100));
          ctx.waitUntil(pruneLimits(ctx.env.DB, new Date(deps.now())));
        }
        session.headers.set('Cache-Control', 'private, no-store');
        response = session;
      } else {
        const matched = SYNC_ROUTES.filter((r) => r.path.test(path));
        const route = matched.find((r) => r.method === ctx.request.method);
        if (!route)
          throw new SyncHttpError(
            matched.length ? 405 : 404,
            matched.length ? 'method' : 'not-found',
          );
        pattern = route.pattern;
        if (ctx.env.LIBRARY_SYNC === 'off' && !route.allowWhenOff)
          throw new SyncHttpError(503, 'off');
        response = await route.run(ctx, deps, route.path.exec(path)!.slice(1), url);
      }
    }
  } catch (error) {
    response = syncError(error) ?? syncJson(500, { error: 'internal' });
    if (error instanceof Error && error.message.startsWith('@sch0718/firebase-session:'))
      deps.log(error.message);
  }
  deps.log(
    JSON.stringify({
      method: ctx.request.method,
      path: pattern,
      status: response.status,
      ms: deps.now() - start,
    }),
  );
  return response;
}
