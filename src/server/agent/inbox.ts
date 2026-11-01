import { agentDocProblem, AGENT_INBOX_LIMITS } from '../../domain/share/agent-limits';
import { dayPoints } from '../../domain/share/check-share-trip';
import { readShareHash } from '../../domain/share/read-share';
import { legKey } from '../../domain/trips/query';
import { SyncHttpError } from '../library-sync/http';
import type { MeetDb } from '../meet/db';

export const INBOX_MAX_PENDING = 20;
export const INBOX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const INBOX_PRUNE_MAX = 50;

export type InboxBody = { v: 1; key: string; d: string };
export type InboxMeta = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  places: number;
  from: string | null;
  createdAt: number;
  expiresAt: number;
};

function isBase64Url(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= min &&
    value.length <= max &&
    !/[^A-Za-z0-9_-]/.test(value)
  );
}

export function parseInboxBody(value: unknown): InboxBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SyncHttpError(422, 'invalid');
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (
    keys.length !== 3 ||
    keys.some((key) => !['v', 'key', 'd'].includes(key)) ||
    body.v !== 1 ||
    !isBase64Url(body.key, 43, 43) ||
    !isBase64Url(body.d, 1, AGENT_INBOX_LIMITS.hashChars)
  ) {
    throw new SyncHttpError(422, 'invalid');
  }
  return { v: 1, key: body.key, d: body.d };
}

export async function checkInboxDoc(
  d: string,
): Promise<{ title: string; startDate: string; endDate: string; places: number }> {
  const result = await readShareHash(d, AGENT_INBOX_LIMITS);
  if (!result.ok) throw new SyncHttpError(422, 'invalid', { reason: result.error });
  const doc = result.doc;
  if (doc.version !== 2) throw new SyncHttpError(422, 'invalid', { reason: 'not-trip' });
  const problem = agentDocProblem(doc);
  if (problem) throw new SyncHttpError(422, 'invalid', { reason: problem });

  const trip = doc.trips[0]!;
  const actualLegs = new Set<string>();
  trip.days.forEach((_day, dayIndex) => {
    const points = dayPoints(trip, dayIndex);
    for (let i = 0; i + 1 < points.length; i++) {
      actualLegs.add(legKey(points[i]!, points[i + 1]!));
    }
  });
  if (Object.keys(trip.legModes).some((key) => !actualLegs.has(key))) {
    throw new SyncHttpError(422, 'invalid', { reason: 'leg-modes' });
  }
  return {
    title: trip.title || doc.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    places: doc.places.length,
  };
}

async function findPending(db: MeetDb, userId: string, key: string, now: number) {
  const row = await db
    .prepare(
      'SELECT id, expires_at FROM agent_inbox WHERE user_id = ? AND request_key = ? AND expires_at > ?',
    )
    .bind(userId, key, now)
    .first<{ id: string; expires_at: number }>();
  return row ? { id: row.id, expiresAt: row.expires_at, created: false } : null;
}

export async function putInbox(
  db: MeetDb,
  p: { userId: string; tokenId: string },
  body: InboxBody,
  meta: Awaited<ReturnType<typeof checkInboxDoc>>,
  id: string,
  now: number,
): Promise<{ id: string; expiresAt: number; created: boolean }> {
  const existing = await findPending(db, p.userId, body.key, now);
  if (existing) return existing;

  const expiresAt = now + INBOX_TTL_MS;
  try {
    const results = (await db.batch([
      db
        .prepare(
          'DELETE FROM agent_inbox WHERE user_id = ?1 AND request_key = ?2 AND expires_at <= ?3',
        )
        .bind(p.userId, body.key, now),
      db
        .prepare(
          `INSERT INTO agent_inbox (id, user_id, token_id, request_key, data, title, start_date, end_date, places, created_at, expires_at)
           SELECT ?4, ?1, ?5, ?2, ?6, ?7, ?8, ?9, ?10, ?3, ?11
           WHERE (SELECT count(*) FROM agent_inbox WHERE user_id = ?1 AND expires_at > ?3) < ?12`,
        )
        .bind(
          p.userId,
          body.key,
          now,
          id,
          p.tokenId,
          body.d,
          meta.title,
          meta.startDate,
          meta.endDate,
          meta.places,
          expiresAt,
          INBOX_MAX_PENDING,
        ),
    ])) as { meta: { changes: number } }[];
    if (results[1]!.meta.changes > 0) return { id, expiresAt, created: true };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/UNIQUE constraint failed: agent_inbox\b/.test(error.message)
    ) {
      throw error;
    }
  }

  // 같은 키 경쟁에서 진 요청은 0행 또는 UNIQUE 충돌 뒤에 승자의 항목을 돌려준다.
  const winner = await findPending(db, p.userId, body.key, now);
  if (winner) return winner;
  throw new SyncHttpError(409, 'inbox-full');
}

export async function listInbox(db: MeetDb, userId: string, now: number): Promise<InboxMeta[]> {
  const rows = await db
    .prepare(
      `SELECT i.id, i.title, i.start_date AS startDate, i.end_date AS endDate, i.places,
              t.name AS "from", i.created_at AS createdAt, i.expires_at AS expiresAt
       FROM agent_inbox i LEFT JOIN agent_tokens t ON t.id = i.token_id
       WHERE i.user_id = ? AND i.expires_at > ? ORDER BY i.created_at, i.id`,
    )
    .bind(userId, now)
    .all<InboxMeta>();
  return rows.results;
}

export async function readInboxItem(
  db: MeetDb,
  userId: string,
  id: string,
  now: number,
): Promise<{ id: string; data: string } | null> {
  return db
    .prepare('SELECT id, data FROM agent_inbox WHERE user_id = ? AND id = ? AND expires_at > ?')
    .bind(userId, id, now)
    .first<{ id: string; data: string }>();
}

export async function deleteInboxItem(db: MeetDb, userId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM agent_inbox WHERE user_id = ? AND id = ?')
    .bind(userId, id)
    .run();
  return result.meta.changes > 0;
}

export async function pruneInbox(db: MeetDb, now: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM agent_inbox WHERE id IN (
         SELECT id FROM agent_inbox WHERE expires_at <= ? ORDER BY expires_at, id LIMIT ?
       )`,
    )
    .bind(now, INBOX_PRUNE_MAX)
    .run();
  return result.meta.changes;
}
