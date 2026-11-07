import type { MeetDb } from '../meet/db';

export const CHANGES_MAX = 100;
export const CHANGES_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** 사용자별 before_doc UTF-8 바이트 합계 상한(5MiB). 넘으면 오래된 기록부터 지운다. */
export const CHANGES_BEFORE_DOC_MAX_BYTES = 5 * 1024 * 1024;

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

/** 한 문장에 묶는 JSON 크기 상한(바이트). D1의 문자열·행 한도(2MB)보다 충분히 작게 둔다. */
export const RECORD_CHUNK_BYTES = 1_000_000;
const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

const RECORD_SQL = `INSERT INTO agent_changes
        (id, user_id, token_id, request_id, kind, item_id, before_doc, before_rev, after_rev, label, at, undone_at)
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
         json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
         json_extract(value, '$[6]'), json_extract(value, '$[7]'), json_extract(value, '$[8]'),
         json_extract(value, '$[9]'), json_extract(value, '$[10]'), NULL
       FROM json_each(?)`;

/** 문서 하나는 ITEM_DOC_MAX_CHARS(20만 자) 이하라 이스케이프 뒤에도 행당 약 600KB다. 그래서 한 행이 혼자 한도를 넘지 않는다. */
export async function recordChanges(db: MeetDb, rows: ChangeRow[]): Promise<void> {
  if (!rows.length) return;
  // JSON을 RECORD_CHUNK_BYTES 안팎으로 나눠 db.batch 한 번에 보낸다(D1 문자열 2MB 한도, 호출당 쿼리 수는 몇 개).
  const chunks: string[][] = [[]];
  let size = 2;
  for (const row of rows) {
    const text = JSON.stringify([
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
    const bytes = utf8Bytes(text) + 1;
    const last = chunks[chunks.length - 1]!;
    if (last.length && size + bytes > RECORD_CHUNK_BYTES) {
      chunks.push([text]);
      size = 2 + bytes;
    } else {
      last.push(text);
      size += bytes;
    }
  }
  await db.batch(chunks.map((chunk) => db.prepare(RECORD_SQL).bind(`[${chunk.join(',')}]`)));
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

/** 30일 지난 행, 100건 초과 행, before_doc UTF-8 바이트 합계 5MiB 초과분을 지운다. */
export async function pruneChanges(db: MeetDb, userId: string, now: number): Promise<void> {
  // 최근 순에서 세 조건 모두 한 번 넘으면 더 오래된 행도 넘으므로 한 문장으로 지운다.
  await db
    .prepare(
      `DELETE FROM agent_changes WHERE user_id = ? AND id IN (
         SELECT id FROM (
           SELECT id, at,
             ROW_NUMBER() OVER (ORDER BY at DESC, rowid DESC) AS position,
             SUM(COALESCE(length(CAST(before_doc AS BLOB)), 0)) OVER (
               ORDER BY at DESC, rowid DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS total_bytes
           FROM agent_changes WHERE user_id = ?
         )
         WHERE at <= ? OR position > ? OR total_bytes > ?
       )`,
    )
    .bind(userId, userId, now - CHANGES_KEEP_MS, CHANGES_MAX, CHANGES_BEFORE_DOC_MAX_BYTES)
    .run();
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
