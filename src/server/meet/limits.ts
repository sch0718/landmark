import type { MeetDb } from './db';

export const LIMITS = {
  create: 20,
  claim: 60,
  reply: 600,
  update: 300,
  read: 5000,
  shareCreate: 50,
  shareDelete: 200,
  shareRead: 5000,
  tripCreate: 20,
  tripUpdate: 600,
  tripRotate: 60,
  tripRead: 5000,
  collabInvite: 60,
  collabAccept: 30,
  collabUpdate: 1200,
  collabProgress: 2000,
  collabManage: 300,
  collabRead: 5000,
} as const;
export type LimitAction = keyof typeof LIMITS;

export async function consumeLimit(
  db: MeetDb,
  action: LimitAction,
  ipHash: string,
  now: Date,
): Promise<boolean> {
  const key = `${action}:${ipHash}:${now.toISOString().slice(0, 10)}`;
  const row = await db
    .prepare(
      `INSERT INTO rate_counters (key, count) VALUES (?, 1)
      ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .bind(key)
    .first<{ count: number }>();
  if (!row) throw new Error('일 한도 카운터를 읽지 못함');
  return row.count <= LIMITS[action];
}

export async function pruneLimits(db: MeetDb, now: Date): Promise<void> {
  await db
    .prepare(
      `DELETE FROM rate_counters WHERE key IN (
      SELECT key FROM rate_counters WHERE substr(key, -10) < ? LIMIT 200
    )`,
    )
    .bind(now.toISOString().slice(0, 10))
    .run();
}
