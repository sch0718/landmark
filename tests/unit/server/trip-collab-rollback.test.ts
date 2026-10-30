// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

it.each(['development.md', 'superpowers/specs/2026-10-29-trip-collab-design.md'])(
  '%s의 롤백 SQL은 v2를 v1으로 바꾸며 revision도 올린다',
  (file) => {
    const text = readFileSync(new URL(`../../../docs/${file}`, import.meta.url), 'utf8');
    const sql = text.match(/UPDATE trip_shares SET doc = json_set\(doc, '\$\.v', 1\)[^"\n]*/)?.[0];
    expect(sql).toBeDefined();
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE trip_shares (id INTEGER PRIMARY KEY, doc TEXT, rev INTEGER)');
      db.prepare('INSERT INTO trip_shares VALUES (?, ?, ?)').run(
        1,
        JSON.stringify({ v: 1, plan: '기존' }),
        3,
      );
      db.prepare('INSERT INTO trip_shares VALUES (?, ?, ?)').run(
        2,
        JSON.stringify({ v: 2, plan: '공동' }),
        7,
      );
      db.exec(sql!);
      expect(db.prepare('SELECT id, doc, rev FROM trip_shares ORDER BY id').all()).toEqual([
        { id: 1, doc: JSON.stringify({ v: 1, plan: '기존' }), rev: 3 },
        { id: 2, doc: JSON.stringify({ v: 1, plan: '공동' }), rev: 8 },
      ]);
      db.exec(sql!);
      expect(db.prepare('SELECT rev FROM trip_shares WHERE id = 2').get()).toEqual({ rev: 8 });
    } finally {
      db.close();
    }
  },
);
