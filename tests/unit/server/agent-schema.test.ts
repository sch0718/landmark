// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { deleteAccountData } from 'src/server/library-sync/library';
import { ensureSchema, resetSchemaMemo } from 'src/server/meet/db';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from 'src/server/meet/schema-sql';
import { hashToken } from 'src/server/meet/tokens';
import { createSqliteD1 } from '../../helpers/sqlite-d1';

let db: ReturnType<typeof createSqliteD1>;

beforeEach(() => {
  resetSchemaMemo();
  db = createSqliteD1();
});

afterEach(() => {
  db.close();
});

it.each([0, 6])('버전 %i에서 AI 표 두 개와 색인 다섯 개를 멱등으로 만든다', async (version) => {
  if (version) {
    await db.batch(
      SCHEMA_STATEMENTS.filter((sql) => !sql.includes('agent_')).map((sql) => db.prepare(sql)),
    );
    await db.prepare('INSERT INTO schema_meta VALUES (?)').bind(version).run();
    await db
      .prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)')
      .bind('기존사용자', '기존계정', '', 1, 1)
      .run();
  }

  await ensureSchema(db);

  expect(
    await db
      .prepare("SELECT name, type FROM sqlite_master WHERE name LIKE 'agent_%' ORDER BY name")
      .all(),
  ).toEqual({
    results: [
      { name: 'agent_inbox', type: 'table' },
      { name: 'agent_inbox_expires', type: 'index' },
      { name: 'agent_inbox_key', type: 'index' },
      { name: 'agent_inbox_user', type: 'index' },
      { name: 'agent_tokens', type: 'table' },
      { name: 'agent_tokens_hash', type: 'index' },
      { name: 'agent_tokens_user', type: 'index' },
    ],
  });
  for (const [table, columns] of Object.entries({
    agent_tokens: 'id,user_id,token_hash,name,scopes,created_at,expires_at,last_used_at,revoked_at',
    agent_inbox:
      'id,user_id,token_id,request_key,data,title,start_date,end_date,places,created_at,expires_at',
  })) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual(columns.split(','));
  }

  await ensureSchema(db);
  for (let i = 0; i < 2; i++) {
    await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
    resetSchemaMemo();
    await ensureSchema(db);
  }
  expect(SCHEMA_VERSION).toBe(7);
  expect(await db.prepare('SELECT version FROM schema_meta').all()).toEqual({
    results: [{ version: 7 }],
  });
  if (version) {
    expect(await db.prepare('SELECT id FROM users').all()).toEqual({
      results: [{ id: '기존사용자' }],
    });
  }
});

it('스키마 문장에 ALTER를 넣지 않고 AI 문장은 하나씩 멱등으로 실행한다', () => {
  expect(SCHEMA_STATEMENTS.every((sql) => !/\bALTER\b/i.test(sql.replace(/--[^\n]*/g, '')))).toBe(
    true,
  );
  const statements = SCHEMA_STATEMENTS.filter((sql) => sql.includes('agent_'));
  expect(statements).toHaveLength(7);
  expect(statements[0]).toMatch(/^-- 7: AI 연결 토큰과 받은함\. 토큰 원문은 두지 않는다\./);
  for (const sql of statements) {
    expect(sql.match(/\bCREATE\b/g)).toHaveLength(1);
    expect(sql).toContain('IF NOT EXISTS');
  }
});

it('계정 자료 삭제는 두 AI 표에서 그 사용자의 모든 행만 지운다', async () => {
  await ensureSchema(db);
  for (const userId of ['지울사용자', '남길사용자']) {
    await db
      .prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)')
      .bind(userId, userId, '', 1, 1)
      .run();
    for (let i = 0; i < 2; i++) {
      const tokenId = crypto.randomUUID();
      await db
        .prepare('INSERT INTO agent_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(
          tokenId,
          userId,
          await hashToken(crypto.randomUUID()),
          '시험 연결',
          'inbox:write',
          1,
          2,
          null,
          null,
        )
        .run();
      await db
        .prepare('INSERT INTO agent_inbox VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(
          crypto.randomUUID(),
          userId,
          tokenId,
          `요청${i}`,
          '시험자료',
          '시험 일정',
          '2026-11-01',
          '2026-11-01',
          1,
          1,
          2,
        )
        .run();
    }
  }

  await deleteAccountData(db, '지울사용자');

  for (const table of ['agent_inbox', 'agent_tokens']) {
    expect(await db.prepare(`SELECT user_id FROM ${table} ORDER BY id`).all()).toEqual({
      results: [{ user_id: '남길사용자' }, { user_id: '남길사용자' }],
    });
  }
  expect(await db.prepare('SELECT id FROM users').all()).toEqual({
    results: [{ id: '남길사용자' }],
  });
});
