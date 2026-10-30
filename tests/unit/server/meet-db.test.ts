// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSchema, resetSchemaMemo, type MeetDb } from 'src/server/meet/db';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from 'src/server/meet/schema-sql';
import { createSqliteD1 } from '../../helpers/sqlite-d1';

let db: ReturnType<typeof createSqliteD1>;

beforeEach(() => {
  resetSchemaMemo();
  db = createSqliteD1();
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

describe('ensureSchema', () => {
  it('본문 충돌 검사에 쓸 정수 doc_rev 열을 필수로 만든다', async () => {
    await ensureSchema(db);
    const { results } = await db.prepare('PRAGMA table_info(meetings)').all();
    expect(results).toContainEqual(
      expect.objectContaining({ name: 'doc_rev', type: 'INTEGER', notnull: 1 }),
    );
  });
  it('빈 DB에 설계의 표·색인과 버전 4를 만든다', async () => {
    await ensureSchema(db);

    expect(SCHEMA_VERSION).toBe(4);
    expect(await db.prepare('SELECT version FROM schema_meta').all()).toEqual({
      results: [{ version: 4 }],
    });
    expect(
      await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
    ).toEqual({
      results: [
        { name: 'meeting_replies' },
        { name: 'meeting_tokens' },
        { name: 'meetings' },
        { name: 'rate_counters' },
        { name: 'schema_meta' },
        { name: 'share_links' },
        { name: 'trip_collab_devices' },
        { name: 'trip_collab_meta' },
        { name: 'trip_progress' },
        { name: 'trip_share_tokens' },
        { name: 'trip_shares' },
      ],
    });
    expect(
      await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('meetings_expires', 'meeting_tokens_guest') ORDER BY name",
        )
        .all(),
    ).toEqual({ results: [{ name: 'meeting_tokens_guest' }, { name: 'meetings_expires' }] });
    expect(
      await db
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'share_links_%' ORDER BY name")
        .all(),
    ).toEqual({ results: [{ name: 'share_links_delete' }, { name: 'share_links_expires' }] });
  });

  it('버전 1 DB는 약속 자료를 그대로 두고 짧은 링크 표를 더한다', async () => {
    // 버전 1 시점의 문장(짧은 링크 표 앞까지)만 실행한 DB.
    const v1 = SCHEMA_STATEMENTS.filter(
      (sql) => !sql.includes('share_links') && !sql.includes('trip_share'),
    );
    await db.batch(v1.map((sql) => db.prepare(sql)));
    await db.prepare('INSERT INTO schema_meta (version) VALUES (1)').run();
    await db
      .prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('meeting001', '{}', 1, 1, '생성 시각', '변경 시각', '만료 시각')
      .run();

    await ensureSchema(db);

    expect(await db.prepare('SELECT id FROM meetings').all()).toEqual({
      results: [{ id: 'meeting001' }],
    });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM share_links').first()).toEqual({
      count: 0,
    });
    expect(await db.prepare('SELECT version FROM schema_meta').all()).toEqual({
      results: [{ version: 4 }],
    });
  });

  it('두 번 불러도 초기화와 버전 읽기는 한 번만 한다', async () => {
    const prepare = vi.spyOn(db, 'prepare');
    const batch = vi.spyOn(db, 'batch');
    await ensureSchema(db);
    const prepared = prepare.mock.calls.length;

    await ensureSchema(db);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(prepared);
    expect(await db.prepare('SELECT version FROM schema_meta').all()).toEqual({
      results: [{ version: 4 }],
    });
  });

  it('동시에 들어온 초기화도 한 배치로 처리한다', async () => {
    const batch = vi.spyOn(db, 'batch');
    await Promise.all([ensureSchema(db), ensureSchema(db), ensureSchema(db)]);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('배치가 실패하면 다음 호출에서 다시 시도한다', async () => {
    const batch = vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('초기화 실패'));

    await expect(ensureSchema(db)).rejects.toThrow('초기화 실패');
    await ensureSchema(db);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(await db.prepare('SELECT version FROM schema_meta').first()).toEqual({ version: 4 });
  });

  it('표 없음 이외의 읽기 오류는 전파하고 다음 호출에서 다시 시도한다', async () => {
    const prepare = vi.spyOn(db, 'prepare').mockImplementationOnce(() => {
      throw new Error('DB 읽기 실패');
    });

    await expect(ensureSchema(db)).rejects.toThrow('DB 읽기 실패');
    expect(prepare).toHaveBeenCalledTimes(1);
    await ensureSchema(db);
    expect(await db.prepare('SELECT version FROM schema_meta').first()).toEqual({ version: 4 });
  });

  it('이전 버전의 자료는 보존하고 버전 기록만 하나로 갱신한다', async () => {
    await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
    await db.prepare('INSERT INTO schema_meta (version) VALUES (0)').run();
    await db
      .prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('meeting001', '{}', 1, 1, '생성 시각', '변경 시각', '만료 시각')
      .run();

    await ensureSchema(db);

    expect(await db.prepare('SELECT id, doc FROM meetings').first()).toEqual({
      id: 'meeting001',
      doc: '{}',
    });
    expect(await db.prepare('SELECT version FROM schema_meta').all()).toEqual({
      results: [{ version: 4 }],
    });
  });

  it('버전 표가 비어 있어도 초기화한다', async () => {
    await db.prepare('CREATE TABLE schema_meta (version INTEGER NOT NULL)').run();
    await ensureSchema(db);
    expect(await db.prepare('SELECT version FROM schema_meta').first()).toEqual({ version: 4 });
    expect(await db.prepare('SELECT * FROM rate_counters').all()).toEqual({ results: [] });
  });

  it.each([4, 5])('이미 버전 %i이면 배치를 실행하지 않는다', async (version) => {
    await db.prepare('CREATE TABLE schema_meta (version INTEGER NOT NULL)').run();
    await db.prepare('INSERT INTO schema_meta (version) VALUES (?)').bind(version).run();
    const batch = vi.spyOn(db, 'batch');

    await ensureSchema(db);

    expect(batch).not.toHaveBeenCalled();
    expect(await db.prepare('SELECT version FROM schema_meta').first()).toEqual({ version });
  });

  it('시험용 메모 초기화 뒤에는 버전을 다시 읽는다', async () => {
    await ensureSchema(db);
    await db.prepare('UPDATE schema_meta SET version = 0').run();
    resetSchemaMemo();
    await ensureSchema(db);
    expect(await db.prepare('SELECT version FROM schema_meta').first()).toEqual({ version: 4 });
  });
});

describe('meeting_tokens_guest', () => {
  it('같은 약속·참석자의 guest 토큰 두 개를 막는다', async () => {
    await ensureSchema(db);
    const insert = db.prepare('INSERT INTO meeting_tokens VALUES (?, ?, ?, ?, ?)');
    await insert.bind('해시1', '약속1', 'guest', '참석자1', '시각').run();

    await expect(insert.bind('해시2', '약속1', 'guest', '참석자1', '시각').run()).rejects.toThrow(
      /UNIQUE/,
    );
    expect(await db.prepare('SELECT COUNT(*) AS count FROM meeting_tokens').first()).toEqual({
      count: 1,
    });
  });

  it('다른 약속·참석자의 guest와 host 토큰은 허용한다', async () => {
    await ensureSchema(db);
    const insert = db.prepare('INSERT INTO meeting_tokens VALUES (?, ?, ?, ?, ?)');
    await db.batch([
      insert.bind('해시1', '약속1', 'guest', '참석자1', '시각'),
      insert.bind('해시2', '약속1', 'guest', '참석자2', '시각'),
      insert.bind('해시3', '약속2', 'guest', '참석자1', '시각'),
      insert.bind('해시4', '약속1', 'host', null, '시각'),
      insert.bind('해시5', '약속1', 'host', null, '시각'),
    ]);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM meeting_tokens').first()).toEqual({
      count: 5,
    });
  });
});

describe('createSqliteD1', () => {
  it('bind·first·all·run과 RETURNING을 D1 모양으로 돌려준다', async () => {
    const meetDb: MeetDb = db;
    await meetDb
      .prepare('CREATE TABLE sample (id TEXT PRIMARY KEY, value INTEGER, note TEXT)')
      .run();
    expect(await meetDb.prepare('SELECT * FROM sample').first()).toBeNull();
    expect(await meetDb.prepare('SELECT * FROM sample').all()).toEqual({ results: [] });
    expect(
      await meetDb.prepare('INSERT INTO sample VALUES (?, ?, ?)').bind('가', 1, null).run(),
    ).toEqual({ meta: { changes: 1 } });
    expect(
      await meetDb.prepare('UPDATE sample SET value = value + 1 RETURNING value').first(),
    ).toEqual({ value: 2 });
    expect(await meetDb.prepare('SELECT * FROM sample').all()).toEqual({
      results: [{ id: '가', value: 2, note: null }],
    });
    expect(
      await meetDb.prepare('UPDATE sample SET value = 3 WHERE id = ?').bind('없음').run(),
    ).toEqual({ meta: { changes: 0 } });
  });

  it('배치 중간에 실패하면 앞의 표 생성과 쓰기도 되돌린다', async () => {
    await expect(
      db.batch([
        db.prepare('CREATE TABLE sample (id TEXT PRIMARY KEY)'),
        db.prepare('INSERT INTO sample VALUES (?)').bind('중복'),
        db.prepare('INSERT INTO sample VALUES (?)').bind('중복'),
      ]),
    ).rejects.toThrow(/UNIQUE/);

    expect(
      await db.prepare("SELECT name FROM sqlite_master WHERE name = 'sample'").first(),
    ).toBeNull();
    await db.batch([
      db.prepare('CREATE TABLE sample (id TEXT PRIMARY KEY)'),
      db.prepare('INSERT INTO sample VALUES (?)').bind('성공'),
    ]);
    expect(await db.prepare('SELECT * FROM sample').first()).toEqual({ id: '성공' });
  });
});

it('버전 2 DB에서 갱신 공유 표와 색인을 더하고 기존 행을 지킨다', async () => {
  await db.batch(
    SCHEMA_STATEMENTS.filter((sql) => !sql.includes('trip_share')).map((sql) => db.prepare(sql)),
  );
  await db.prepare('INSERT INTO schema_meta VALUES (2)').run();
  await db
    .prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('meeting001', '{}', 1, 1, '생성', '변경', '만료')
    .run();
  await db
    .prepare('INSERT INTO share_links VALUES (?, ?, ?, ?, ?, ?)')
    .bind('share001', '{}', 'trip', '해시', '생성', '만료')
    .run();
  await ensureSchema(db);
  expect(await db.prepare('SELECT version FROM schema_meta').first()).toEqual({ version: 4 });
  for (const name of [
    'trip_shares',
    'trip_shares_expires',
    'trip_share_tokens',
    'trip_share_tokens_share',
  ]) {
    expect(
      await db.prepare('SELECT name FROM sqlite_master WHERE name = ?').bind(name).first(),
    ).toEqual({ name });
  }
  for (const name of ['meetings', 'share_links'])
    expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).first()).toEqual({ count: 1 });
});
it('함께 편집 표 앞 네 문장은 멱등 갱신 공유 표와 색인이다', () => {
  for (const sql of SCHEMA_STATEMENTS.slice(-8, -4)) {
    expect(sql).toContain('trip_share');
    expect(sql).toContain('IF NOT EXISTS');
  }
});

it('버전 3 DB에서 함께 편집 표·색인을 더하고 기존 공동본을 지킨다', async () => {
  await db.batch(
    SCHEMA_STATEMENTS.filter(
      (sql) => !sql.includes('trip_collab') && !sql.includes('trip_progress'),
    ).map((sql) => db.prepare(sql)),
  );
  await db.prepare('INSERT INTO schema_meta VALUES (3)').run();
  await db
    .prepare(
      "INSERT INTO trip_shares VALUES ('abcdefghij', '{}', 1, '시험보기', 'trip000001', '생성', '변경', '만료')",
    )
    .run();
  await ensureSchema(db);
  expect(await db.prepare('SELECT id FROM trip_shares').first()).toEqual({ id: 'abcdefghij' });
  for (const name of [
    'trip_collab_devices',
    'trip_collab_devices_token',
    'trip_collab_meta',
    'trip_progress',
  ])
    expect(
      await db.prepare('SELECT name FROM sqlite_master WHERE name = ?').bind(name).first(),
    ).toEqual({ name });
});
it('마지막 네 문장은 함께 편집 표·색인이며 모두 멱등이다', () => {
  expect(SCHEMA_STATEMENTS.slice(-4).map((s) => /IF NOT EXISTS (\w+)/.exec(s)?.[1])).toEqual([
    'trip_collab_devices',
    'trip_collab_devices_token',
    'trip_collab_meta',
    'trip_progress',
  ]);
});
