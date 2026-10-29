import {
  publicSessionId,
  purgeSessions,
  readJson,
  type D1Database,
} from '@sch0718/firebase-session/worker';
import { ensureSchema } from '../meet/db';
import { pruneLimits } from '../meet/limits';
import { devFakeEnabled, providerStatus, redirectUrisFor, sessionAuthFor } from './auth';
import { createFakeSocial } from './dev-fake-social';
import type { SyncContext, SyncDeps } from './env';
import { isSyncOrigin, syncError, SyncHttpError, syncJson } from './http';
import { consumeLoginLimit } from './limits';
export type SyncRoute = {
  method: 'GET' | 'POST' | 'DELETE';
  path: RegExp;
  pattern: string;
  allowWhenOff?: true;
  run(ctx: SyncContext, deps: SyncDeps, params: string[], url: URL): Promise<Response>;
};
async function create(ctx: SyncContext, deps: SyncDeps, social: boolean): Promise<Response> {
  await consumeLoginLimit(ctx, deps.now());
  const auth = sessionAuthFor(ctx, deps);
  const body = await readJson(ctx.request);
  const reply = social
    ? await auth.createSocial(ctx.request, body)
    : await auth.create(ctx.request, body);
  ctx.waitUntil(purgeSessions(ctx.env.DB as unknown as D1Database, deps.now(), 100));
  ctx.waitUntil(pruneLimits(ctx.env.DB!, new Date(deps.now())));
  return syncJson(200, reply);
}
async function revoke(
  ctx: SyncContext,
  deps: SyncDeps,
  target: 'current' | 'others' | { id: string },
): Promise<Response> {
  const auth = sessionAuthFor(ctx, deps);
  const user = await auth.authenticate(ctx.request);
  const revoked = await auth.revoke(user, target);
  const id = typeof target === 'object' ? target.id : publicSessionId(user.sessionHash);
  await ctx.env
    .DB!.prepare(
      `DELETE FROM library_devices WHERE user_id = ? AND session_id ${target === 'others' ? '<>' : '='} ?`,
    )
    .bind(user.userId, id)
    .run();
  return syncJson(200, { revoked });
}
export const SYNC_ROUTES: SyncRoute[] = [
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
  {
    method: 'POST',
    path: /^\/v1\/session$/,
    pattern: '/v1/session',
    run: (c, d) => create(c, d, false),
  },
  {
    method: 'POST',
    path: /^\/v1\/session\/social$/,
    pattern: '/v1/session/social',
    run: (c, d) => create(c, d, true),
  },
  {
    method: 'DELETE',
    path: /^\/v1\/session$/,
    pattern: '/v1/session',
    allowWhenOff: true,
    run: (c, d) => revoke(c, d, 'current'),
  },
  {
    method: 'GET',
    path: /^\/v1\/sessions$/,
    pattern: '/v1/sessions',
    allowWhenOff: true,
    async run(c, d) {
      const auth = sessionAuthFor(c, d);
      return syncJson(200, { sessions: await auth.list(await auth.authenticate(c.request)) });
    },
  },
  {
    method: 'DELETE',
    path: /^\/v1\/sessions$/,
    pattern: '/v1/sessions',
    allowWhenOff: true,
    async run(c, d, _p, url) {
      if (url.search !== '?others=1') throw new SyncHttpError(422, 'invalid');
      return revoke(c, d, 'others');
    },
  },
  {
    method: 'DELETE',
    path: /^\/v1\/sessions\/([^/]+)$/,
    pattern: '/v1/sessions/:id',
    allowWhenOff: true,
    run: (c, d, p) => revoke(c, d, { id: p[0]! }),
  },
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
        ? ((await createFakeSocial({ now: deps.now }).handle(ctx.request, redirectUrisFor(ctx))) ??
          syncJson(404, { error: 'not-found' }))
        : syncJson(404, { error: 'not-found' });
    } else {
      if (!isSyncOrigin(ctx.request)) throw new SyncHttpError(403, 'origin');
      if (!ctx.env.DB) throw new SyncHttpError(503, 'config');
      await ensureSchema(ctx.env.DB);
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
