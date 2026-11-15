import { readJson } from '@sch0718/firebase-session/worker';
import { validateShareValue } from '../../domain/share/read-share';
import { CalendarDate } from '../../schema/common';
import { labelNameIssue } from '../../schema/library';
import { safeParse } from '../../schema/parse';
import type { ShareDocV1 } from '../../schema/share';
import { CACHE_ORIGIN } from '../cache-key';
import { requireSyncUser, type SyncUser } from './auth';
import type { SyncContext, SyncDeps, SyncEnv } from './env';
import { SyncHttpError, syncJson } from './http';
import { consumeCounter, counterKey } from './limits';
import type { SyncRoute } from './router';

export const RECOMMEND_LIMITS = {
  places: 500,
  rows: 30,
  bodyBytes: 600_000,
  writes: 100,
  descChars: 80,
} as const;
export type RecommendationMeta = {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  places: number;
  createdAt: number;
  updatedAt: number;
};
export type RecommendationPublic = RecommendationMeta & { doc: ShareDocV1 };
type RecommendBody = {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  doc?: ShareDocV1;
};
export function isAdmin(env: SyncEnv, user: Pick<SyncUser, 'provider' | 'account'>): boolean {
  const normalize = (value: string) => (value.startsWith('google:') ? value.toLowerCase() : value);
  const account = normalize(`${user.provider}:${user.account}`);
  return (env.ADMIN_ACCOUNTS ?? '')
    .split(',')
    .map((v) => normalize(v.trim()))
    .filter(Boolean)
    .includes(account);
}
async function requireAdmin(c: SyncContext, d: SyncDeps): Promise<SyncUser> {
  const user = await requireSyncUser(c, d);
  // 소셜 세션의 sub에는 공급자 접두사가 이미 들어 있다.
  const prefix = `${user.provider}:`;
  const account =
    user.provider !== 'google' && user.account.startsWith(prefix)
      ? user.account.slice(prefix.length)
      : user.account;
  if (!isAdmin(c.env, { provider: user.provider, account }))
    throw new SyncHttpError(403, 'not-admin');
  return user;
}
export function kstDate(now: number): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function invalid(path: string): never {
  throw new SyncHttpError(422, 'invalid', { path });
}
export function parseRecommendBody(value: unknown): RecommendBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('body');
  const b = value as Record<string, unknown>;
  for (const key of Object.keys(b))
    if (!['title', 'description', 'startDate', 'endDate', 'doc'].includes(key)) invalid(key);
  if (typeof b.title !== 'string' || labelNameIssue(b.title) !== null) invalid('title');
  if (
    typeof b.description !== 'string' ||
    b.description.length > RECOMMEND_LIMITS.descChars ||
    /[\n\r]/.test(b.description)
  )
    invalid('description');
  const start = safeParse(CalendarDate, b.startDate);
  const end = safeParse(CalendarDate, b.endDate);
  if (!start.success) invalid('startDate');
  if (!end.success || end.data < start.data) invalid('endDate');
  let doc: ShareDocV1 | undefined;
  if ('doc' in b) {
    const result = validateShareValue(b.doc, RECOMMEND_LIMITS.places);
    if (!result.ok || result.doc.version !== 1) invalid('doc');
    doc = result.doc;
    if (doc.labels.length) invalid('doc.labels');
    doc.places.forEach((place, i) => {
      if (place.labelIds.length) invalid(`doc.places.${i}.labelIds`);
      if ('memo' in place) invalid(`doc.places.${i}.memo`);
    });
  }
  return {
    title: b.title.trim(),
    description: b.description.trim(),
    startDate: start.data,
    endDate: end.data,
    ...(doc ? { doc } : {}),
  };
}
type RecommendRow = {
  id: string;
  title: string;
  description: string;
  doc: string;
  places: number;
  start_date: string;
  end_date: string;
  created_at: number;
  updated_at: number;
};
const META_COLUMNS = 'id, title, description, places, start_date, end_date, created_at, updated_at';
function meta(row: Omit<RecommendRow, 'doc'>): RecommendationMeta {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    places: row.places,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function validId(id: string): string {
  if (!/^[a-z0-9]{8}$/.test(id)) invalid('id');
  return id;
}
function defaultCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}
const cacheKey = (now: number) => `${CACHE_ORIGIN}/recommendations/${kstDate(now)}`;
export const RECOMMEND_ROUTES: SyncRoute[] = [
  {
    method: 'GET',
    path: /^\/v1\/recommendations$/,
    pattern: '/v1/recommendations',
    allowWhenOff: true,
    async run(c, d) {
      const now = d.now();
      const today = kstDate(now);
      const cache = defaultCache();
      const key = cacheKey(now);
      const cached = await cache?.match(key);
      if (cached) return syncJson(200, await cached.json());
      const { results } = await c.env
        .DB!.prepare(
          `SELECT ${META_COLUMNS}, doc FROM recommendations WHERE start_date <= ?1 AND end_date >= ?1 ORDER BY start_date, id`,
        )
        .bind(today)
        .all<RecommendRow>();
      const body = { items: results.map((row) => ({ ...meta(row), doc: JSON.parse(row.doc) })) };
      if (cache) {
        const copy = syncJson(200, body);
        copy.headers.set('Cache-Control', 'public, max-age=60');
        c.waitUntil(cache.put(key, copy));
      }
      return syncJson(200, body);
    },
  },
  {
    method: 'GET',
    path: /^\/v1\/admin\/recommendations$/,
    pattern: '/v1/admin/recommendations',
    allowWhenOff: true,
    async run(c, d) {
      await requireAdmin(c, d);
      const { results } = await c.env
        .DB!.prepare(`SELECT ${META_COLUMNS} FROM recommendations ORDER BY start_date DESC, id`)
        .all<Omit<RecommendRow, 'doc'>>();
      return syncJson(200, { items: results.map(meta) });
    },
  },
  {
    method: 'POST',
    path: /^\/v1\/admin\/recommendations\/([^/]+)$/,
    pattern: '/v1/admin/recommendations/:id',
    async run(c, d, [rawId]) {
      const user = await requireAdmin(c, d);
      const id = validId(rawId!);
      const body = parseRecommendBody(await readJson(c.request, RECOMMEND_LIMITS.bodyBytes));
      const db = c.env.DB!;
      const now = d.now();
      if (
        !(await consumeCounter(
          db,
          counterKey('recommend-write', user.userId, now),
          1,
          RECOMMEND_LIMITS.writes,
        ))
      )
        throw new SyncHttpError(429, 'rate-limited');
      const old = await db
        .prepare(`SELECT ${META_COLUMNS}, doc FROM recommendations WHERE id = ?1`)
        .bind(id)
        .first<RecommendRow>();
      if (!old && !body.doc) invalid('doc');
      if (!old) {
        const count = await db
          .prepare('SELECT COUNT(*) AS n FROM recommendations')
          .first<{ n: number }>();
        if (count!.n >= RECOMMEND_LIMITS.rows) throw new SyncHttpError(422, 'too-many');
      }
      const doc = body.doc ? JSON.stringify(body.doc) : old!.doc;
      const places = body.doc ? body.doc.places.length : old!.places;
      await db
        .prepare(
          `INSERT INTO recommendations (id, title, description, doc, places, start_date, end_date, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, doc = excluded.doc, places = excluded.places, start_date = excluded.start_date, end_date = excluded.end_date, updated_at = excluded.updated_at`,
        )
        .bind(id, body.title, body.description, doc, places, body.startDate, body.endDate, now, now)
        .run();
      await defaultCache()?.delete(cacheKey(now));
      return syncJson(200, {
        item: {
          id,
          title: body.title,
          description: body.description,
          startDate: body.startDate,
          endDate: body.endDate,
          places,
          createdAt: old?.created_at ?? now,
          updatedAt: now,
        } satisfies RecommendationMeta,
      });
    },
  },
  {
    method: 'DELETE',
    path: /^\/v1\/admin\/recommendations\/([^/]+)$/,
    pattern: '/v1/admin/recommendations/:id',
    allowWhenOff: true,
    async run(c, d, [rawId]) {
      await requireAdmin(c, d);
      const id = validId(rawId!);
      const result = await c.env
        .DB!.prepare('DELETE FROM recommendations WHERE id = ?1')
        .bind(id)
        .run();
      if (!result.meta.changes) throw new SyncHttpError(404, 'not-found');
      await defaultCache()?.delete(cacheKey(d.now()));
      return syncJson(204, null);
    },
  },
];
