import type { MeetDb } from '../meet/db';

export const CHANGES_MAX = 100;
export const CHANGES_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** 사용자별 before_doc 글자 수 합계 상한(5MiB). 넘으면 오래된 기록부터 지운다. */
export const CHANGES_BEFORE_DOC_MAX_CHARS = 5 * 1024 * 1024;

export type ChangeRow = {
  id: string;
  userId: string;
  tokenId: string;
  requestId: string;
  kind: string;
  itemId: string;
  beforeDoc: string | null;
  beforeRev: number;
  afterRev: number;
  label: string;
  at: number;
};

export type ChangeMeta = Omit<ChangeRow, 'userId' | 'beforeDoc'> & {
  undoneAt: number | null;
  /** 토큰이 지워졌으면 null */
  tokenName: string | null;
};

export async function recordChanges(db: MeetDb, rows: ChangeRow[]): Promise<void> {
  if (!rows.length) return;
  // 행 수와 무관하게 SQL 한 문장(json_each)으로 넣는다(Workers Free 호출당 D1 쿼리 한도).
  const data = rows.map((row) => [
    row.id,
    row.userId,
    row.tokenId,
    row.requestId,
    row.kind,
    row.itemId,
    row.beforeDoc,
    row.beforeRev,
    row.afterRev,
    row.label,
    row.at,
  ]);
  await db
    .prepare(
      `INSERT INTO agent_changes
        (id, user_id, token_id, request_id, kind, item_id, before_doc, before_rev, after_rev, label, at, undone_at)
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
         json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
         json_extract(value, '$[6]'), json_extract(value, '$[7]'), json_extract(value, '$[8]'),
         json_extract(value, '$[9]'), json_extract(value, '$[10]'), NULL
       FROM json_each(?)`,
    )
    .bind(JSON.stringify(data))
    .run();
}

/** 최근 순(같은 시각이면 나중에 넣은 것 먼저). before_doc은 싣지 않는다. */
export async function listChanges(db: MeetDb, userId: string, now: number): Promise<ChangeMeta[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.token_id, c.request_id, c.kind, c.item_id, c.before_rev, c.after_rev, c.label, c.at, c.undone_at, t.name AS token_name
       FROM agent_changes c LEFT JOIN agent_tokens t ON t.id = c.token_id AND t.user_id = c.user_id
       WHERE c.user_id = ? AND c.at > ?
       ORDER BY c.at DESC, c.rowid DESC LIMIT ?`,
    )
    .bind(userId, now - CHANGES_KEEP_MS, CHANGES_MAX)
    .all<{
      id: string;
      token_id: string;
      request_id: string;
      kind: string;
      item_id: string;
      before_rev: number;
      after_rev: number;
      label: string;
      at: number;
      undone_at: number | null;
      token_name: string | null;
    }>();
  return results.map((row) => ({
    id: row.id,
    tokenId: row.token_id,
    requestId: row.request_id,
    kind: row.kind,
    itemId: row.item_id,
    beforeRev: row.before_rev,
    afterRev: row.after_rev,
    label: row.label,
    at: row.at,
    undoneAt: row.undone_at,
    tokenName: row.token_name,
  }));
}

/** 30일 지난 행, 100건 초과 행, before_doc 합계 5MiB 초과분(오래된 것부터)을 지운다. */
export async function pruneChanges(db: MeetDb, userId: string, now: number): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT id, at, COALESCE(length(before_doc), 0) AS size
       FROM agent_changes WHERE user_id = ? ORDER BY at DESC, rowid DESC`,
    )
    .bind(userId)
    .all<{ id: string; at: number; size: number }>();
  const stale: string[] = [];
  let kept = 0;
  let total = 0;
  for (const row of results) {
    total += row.size;
    if (
      row.at <= now - CHANGES_KEEP_MS ||
      kept >= CHANGES_MAX ||
      total > CHANGES_BEFORE_DOC_MAX_CHARS
    ) {
      // 한 번 넘으면 그보다 오래된 행도 모두 지운다.
      stale.push(row.id);
      total = Number.POSITIVE_INFINITY;
      continue;
    }
    kept += 1;
  }
  if (!stale.length) return;
  await db.batch(
    stale.map((id) =>
      db.prepare('DELETE FROM agent_changes WHERE user_id = ? AND id = ?').bind(userId, id),
    ),
  );
}

/** 한 요청(`requestId`)으로 이미 적용된 항목. 재전송을 건너뛸 때 쓴다. */
export async function listRequestChanges(
  db: MeetDb,
  userId: string,
  requestId: string,
): Promise<{ kind: string; itemId: string; afterRev: number }[]> {
  const { results } = await db
    .prepare(
      'SELECT kind, item_id AS itemId, after_rev AS afterRev FROM agent_changes WHERE user_id = ? AND request_id = ?',
    )
    .bind(userId, requestId)
    .all<{ kind: string; itemId: string; afterRev: number }>();
  return results;
}
