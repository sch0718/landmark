// @vitest-environment node
import { expect, it } from 'vitest';
import { ensureSchema } from 'src/server/meet/db';
import { SCHEMA_STATEMENTS } from 'src/server/meet/schema-sql';
import { createSqliteD1 } from '../../helpers/sqlite-d1';
it('버전 2에서 표 다섯 개와 identity를 멱등으로 더한다', async () => {
  const db = createSqliteD1();
  try {
    await db.batch(SCHEMA_STATEMENTS.slice(0, 10).map((s) => db.prepare(s)));
    await db.prepare('INSERT INTO schema_meta VALUES (2)').run();
    await ensureSchema(db);
    expect(await db.prepare('SELECT version FROM schema_meta').first()).toEqual({ version: 6 });
    for (const table of ['users', 'sessions', 'library_state', 'library_items', 'library_devices'])
      expect(
        await db.prepare('SELECT name FROM sqlite_master WHERE name = ?').bind(table).first(),
      ).not.toBeNull();
    expect((await db.prepare('PRAGMA table_info(sessions)').all()).results).toContainEqual(
      expect.objectContaining({ name: 'identity' }),
    );
    await db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s)));
    await db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s)));
    expect(SCHEMA_STATEMENTS.every((s) => !/^\s*ALTER\b/i.test(s))).toBe(true);
  } finally {
    db.close();
  }
});
