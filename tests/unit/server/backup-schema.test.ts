// @vitest-environment node
import { expect, it } from 'vitest';
import { ensureSchema } from 'src/server/meet/db';
import { SCHEMA_STATEMENTS } from 'src/server/meet/schema-sql';
import { createSqliteD1 } from '../../helpers/sqlite-d1';

it.each([0, 5])('버전 %i에서 백업 표 두 개를 멱등으로 만든다', async (version) => {
  const db = createSqliteD1();
  try {
    if (version) {
      await db.prepare('CREATE TABLE schema_meta (version INTEGER NOT NULL)').run();
      await db.prepare('INSERT INTO schema_meta VALUES (?)').bind(version).run();
    }
    await ensureSchema(db);
    expect(await db.prepare('SELECT version FROM schema_meta').first()).toEqual({ version: 6 });
    for (const [table, columns] of Object.entries({
      library_backups:
        'user_id,id,format,parts,stored_bytes,raw_bytes,content_hash,places,labels,trips,meetings,exported_at,device_id,device_label,reason,created_at',
      library_backup_parts: 'user_id,backup_id,idx,data',
    })) {
      const rows = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(rows.results.map((r) => r.name)).toEqual(columns.split(','));
    }
    for (let i = 0; i < 2; i++) await db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s)));
    expect(SCHEMA_STATEMENTS.every((s) => !/^\s*ALTER\b/i.test(s))).toBe(true);
  } finally {
    db.close();
  }
});
