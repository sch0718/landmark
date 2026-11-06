// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  CHANGES_KEEP_MS,
  CHANGES_MAX,
  CHANGES_BEFORE_DOC_MAX_CHARS,
  listChanges,
  pruneChanges,
  recordChanges,
  type ChangeRow,
} from 'src/server/agent/changes';
import { ensureSchema, resetSchemaMemo } from 'src/server/meet/db';
import { createSqliteD1 } from '../../helpers/sqlite-d1';

let db: ReturnType<typeof createSqliteD1>;
const now = 1_800_000_000_000;

function row(n: number, extra: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id: `change${String(n).padStart(4, '0')}`,
    userId: 'u1',
    tokenId: 'token000001',
    requestId: 'req-1',
    kind: 'place',
    itemId: `place${n}`,
    beforeDoc: '{"a":1}',
    beforeRev: 1,
    afterRev: 2,
    label: `장소 ${n}`,
    at: now - 1000,
    ...extra,
  };
}

async function count(userId = 'u1'): Promise<number> {
  const found = await db
    .prepare('SELECT COUNT(*) AS n FROM agent_changes WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return found!.n;
}

beforeEach(async () => {
  resetSchemaMemo();
  db = createSqliteD1();
  await ensureSchema(db);
});

afterEach(() => {
  db.close();
});

it('기록한 변경을 최근 순으로, 같은 시각이면 나중에 넣은 것을 먼저 돌려주고 본문은 싣지 않는다', async () => {
  await recordChanges(db, [
    row(1, { at: now - 5000 }),
    row(2, { at: now - 1000, beforeDoc: null, beforeRev: 0 }),
    row(3, { at: now - 1000 }),
  ]);

  const list = await listChanges(db, 'u1', now);

  expect(list.map((change) => change.id)).toEqual(['change0003', 'change0002', 'change0001']);
  expect(list[1]).toEqual({
    id: 'change0002',
    tokenId: 'token000001',
    requestId: 'req-1',
    kind: 'place',
    itemId: 'place2',
    beforeRev: 0,
    afterRev: 2,
    label: '장소 2',
    at: now - 1000,
    undoneAt: null,
    tokenName: null,
  });
  expect(JSON.stringify(list)).not.toContain('beforeDoc');
});

it('목록은 그 사용자의 최근 100건만 낸다', async () => {
  await recordChanges(
    db,
    Array.from({ length: CHANGES_MAX + 5 }, (_, i) => row(i, { at: now - 10_000 + i })),
  );
  await recordChanges(db, [row(900, { userId: 'u2' })]);

  const list = await listChanges(db, 'u1', now);

  expect(list).toHaveLength(CHANGES_MAX);
  expect(list[0]!.id).toBe('change0104');
  expect(list.at(-1)!.id).toBe('change0005');
});

it('30일이 지난 변경은 목록에서 빠진다', async () => {
  await recordChanges(db, [
    row(1, { at: now - CHANGES_KEEP_MS - 1 }),
    row(2, { at: now - CHANGES_KEEP_MS + 1 }),
  ]);

  expect((await listChanges(db, 'u1', now)).map((change) => change.id)).toEqual(['change0002']);
});

it('정리는 100건을 넘은 행과 30일 지난 행만 그 사용자에게서 지운다', async () => {
  await recordChanges(db, [
    ...Array.from({ length: CHANGES_MAX + 3 }, (_, i) => row(i, { at: now - 10_000 + i })),
    row(500, { at: now - CHANGES_KEEP_MS - 1 }),
    row(600, { userId: 'u2', at: now - CHANGES_KEEP_MS - 1 }),
  ]);

  await pruneChanges(db, 'u1', now);

  expect(await count()).toBe(CHANGES_MAX);
  const oldest = await db
    .prepare('SELECT MIN(id) AS id FROM agent_changes WHERE user_id = ?')
    .bind('u1')
    .first<{ id: string }>();
  expect(oldest!.id).toBe('change0003');
  expect(await count('u2')).toBe(1);
});

it('이전 문서 합계가 5MB를 넘으면 가장 오래된 기록부터 지운다', async () => {
  const big = 'x'.repeat(200_000);
  // 30건 × 200,000자 = 6MB. 합계 5MB 이하로 남는 가장 최근 26건(5MiB=5,242,880자)을 둔다.
  await recordChanges(
    db,
    Array.from({ length: 30 }, (_, i) => row(i, { beforeDoc: big, at: now - 10_000 + i })),
  );
  await recordChanges(db, [row(800, { beforeDoc: null, at: now - 20_000 })]);

  await pruneChanges(db, 'u1', now);

  const kept = await db
    .prepare('SELECT id, length(before_doc) AS n FROM agent_changes ORDER BY at, rowid')
    .all<{ id: string; n: number | null }>();
  const total = kept.results.reduce((sum, item) => sum + (item.n ?? 0), 0);
  expect(total).toBeLessThanOrEqual(CHANGES_BEFORE_DOC_MAX_CHARS);
  expect(kept.results).toHaveLength(26);
  expect(kept.results[0]!.id).toBe('change0004');
  expect(kept.results.at(-1)!.id).toBe('change0029');
});

it('기록할 행이 없으면 아무 것도 하지 않는다', async () => {
  await recordChanges(db, []);
  expect(await count()).toBe(0);
});

it('recordChanges: 50행도 prepare 한 번, batch 없이 한 문장으로 넣는다', async () => {
  let prepares = 0;
  let batches = 0;
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  db.prepare = ((sql: string) => (prepares++, prepare(sql))) as typeof db.prepare;
  db.batch = ((stmts: never[]) => (batches++, batch(stmts))) as typeof db.batch;
  await recordChanges(
    db,
    Array.from({ length: 50 }, (_, i) => row(i)),
  );
  db.prepare = prepare;
  db.batch = batch;
  expect(prepares).toBe(1);
  expect(batches).toBeLessThanOrEqual(1);
  expect(await count()).toBe(50);
});

it('recordChanges: null before_doc·긴 한국어·특수문자가 그대로 저장되고 undone_at은 NULL이다', async () => {
  const long = '가나다라마바사'.repeat(5000);
  const special = '{"t":"따옴표 \\" \' \n줄바꿈\t탭 \\\\ 😀 %?"}';
  await recordChanges(db, [
    row(1, { beforeDoc: null }),
    row(2, { beforeDoc: long }),
    row(3, { beforeDoc: special, label: '라벨 "인용"\n둘째 줄' }),
  ]);
  const { results } = await db
    .prepare(
      'SELECT id, before_doc, label, before_rev, after_rev, at, undone_at FROM agent_changes ORDER BY rowid',
    )
    .all<{
      id: string;
      before_doc: string | null;
      label: string;
      before_rev: number;
      after_rev: number;
      at: number;
      undone_at: number | null;
    }>();
  expect(results.map((r) => r.before_doc)).toEqual([null, long, special]);
  expect(results[2]!.label).toBe('라벨 "인용"\n둘째 줄');
  expect(
    results.every((r) => r.undone_at === null && r.before_rev === 1 && r.after_rev === 2),
  ).toBe(true);
});
