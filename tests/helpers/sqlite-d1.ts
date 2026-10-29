import { DatabaseSync } from 'node:sqlite';
import type { MeetDb, MeetStatement } from '../../src/server/meet/db';

class SqliteD1Statement implements MeetStatement {
  constructor(
    readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: (string | number | null)[] = [],
  ) {}

  bind(...values: (string | number | null)[]): MeetStatement {
    return new SqliteD1Statement(this.database, this.sql, values);
  }

  private parameters(): (string | number | null)[] {
    const numbered = [...this.sql.matchAll(/\?(\d+)/g)];
    return numbered.length
      ? numbered.map((match) => this.values[Number(match[1]) - 1]!)
      : this.values;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (
      (this.database.prepare(this.sql.replace(/\?\d+/g, '?')).get(...this.parameters()) as
        T | undefined) ?? null
    );
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return Object.defineProperties(
      {
        results: this.database
          .prepare(this.sql.replace(/\?\d+/g, '?'))
          .all(...this.parameters()) as T[],
      },
      { success: { value: true }, meta: { value: { changes: 0 } } },
    );
  }

  execute(): { meta: { changes: number } } {
    const stmt = this.database.prepare(this.sql.replace(/\?\d+/g, '?'));
    if (stmt.columns().length > 0) {
      const results = stmt.all(...this.parameters());
      return Object.defineProperties(
        { meta: { changes: 0 } },
        { results: { value: results }, success: { value: true } },
      );
    }
    const result = stmt.run(...this.parameters());
    return Object.defineProperties(
      { meta: { changes: Number(result.changes) } },
      { results: { value: [] }, success: { value: true } },
    );
  }

  async run(): Promise<{ meta: { changes: number } }> {
    return this.execute();
  }
}

export function createSqliteD1(): MeetDb & { close(): void } {
  const database = new DatabaseSync(':memory:');
  return {
    prepare(sql) {
      return new SqliteD1Statement(database, sql);
    },
    async batch(stmts) {
      database.exec('BEGIN');
      try {
        const results = stmts.map((stmt) => {
          if (!(stmt instanceof SqliteD1Statement) || stmt.database !== database) {
            throw new Error('같은 DB의 문장만 배치할 수 있음');
          }
          return stmt.execute();
        });
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      database.close();
    },
  };
}
