import type { MeetDb } from '../meet/db';
import { hashIp } from '../meet/tokens';
import type { SyncContext } from './env';
import { isLocalRequest, SyncHttpError } from './http';
export const SYNC_LIMITS = { login: 60, pull: 5000, push: 2000, items: 30000 } as const;
export function counterKey(action: string, subject: string, now: number): string {
  return `${action}:${subject}:${new Date(now).toISOString().slice(0, 10)}`;
}
export async function consumeCounter(
  db: MeetDb,
  key: string,
  amount: number,
  max: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      'INSERT INTO rate_counters (key, count) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET count = count + excluded.count RETURNING count',
    )
    .bind(key, amount)
    .first<{ count: number }>();
  if (!row) throw new Error('일 한도 카운터를 읽지 못함');
  return row.count <= max;
}
export async function consumeLoginLimit(ctx: SyncContext, now: number): Promise<void> {
  const salt = ctx.env.IP_HASH_SALT ?? (isLocalRequest(ctx.request) ? 'dev-salt' : null);
  if (!salt || !ctx.env.DB) throw new SyncHttpError(503, 'config');
  const hash = await hashIp(ctx.request.headers.get('CF-Connecting-IP') ?? 'local', salt);
  if (
    !(await consumeCounter(ctx.env.DB, counterKey('sync-login', hash, now), 1, SYNC_LIMITS.login))
  )
    throw new SyncHttpError(429, 'rate-limited');
}
