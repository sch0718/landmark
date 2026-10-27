import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema-sql';

export type MeetStatement = {
  bind(...values: (string | number | null)[]): MeetStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
};

export type MeetDb = {
  prepare(sql: string): MeetStatement;
  batch(stmts: MeetStatement[]): Promise<unknown[]>;
};

// 같은 격리의 동시 요청은 초기화를 함께 기다린다. 실패한 결과는 남기지 않는다.
let schemaMemo = new WeakMap<MeetDb, Promise<void>>();

async function initializeSchema(db: MeetDb): Promise<void> {
  let version = 0;
  try {
    const row = await db
      .prepare('SELECT version FROM schema_meta LIMIT 1')
      .first<{ version: number }>();
    version = row?.version ?? 0;
  } catch (error) {
    // 첫 요청에는 버전 표가 없다. 다른 DB 오류는 초기화로 덮지 않는다.
    if (!(error instanceof Error) || !/no such table:\s*schema_meta\b/i.test(error.message)) {
      throw error;
    }
  }
  if (version >= SCHEMA_VERSION) return;

  await db.batch([
    ...SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)),
    db.prepare('DELETE FROM schema_meta'),
    db.prepare('INSERT INTO schema_meta (version) VALUES (?)').bind(SCHEMA_VERSION),
  ]);
}

export function ensureSchema(db: MeetDb): Promise<void> {
  const memo = schemaMemo.get(db);
  if (memo) return memo;

  const pending = initializeSchema(db).catch((error: unknown) => {
    schemaMemo.delete(db);
    throw error;
  });
  schemaMemo.set(db, pending);
  return pending;
}

/** 시험 사이에 격리의 초기화 기록을 비운다. */
export function resetSchemaMemo(): void {
  schemaMemo = new WeakMap();
}
