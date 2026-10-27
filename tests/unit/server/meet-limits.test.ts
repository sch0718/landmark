// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema, resetSchemaMemo } from 'src/server/meet/db';
import { consumeLimit, LIMITS, pruneLimits, type LimitAction } from 'src/server/meet/limits';
import { createSqliteD1 } from '../../helpers/sqlite-d1';

let db: ReturnType<typeof createSqliteD1>;
const now = new Date('2026-10-26T12:00:00Z');

beforeEach(async () => {
  resetSchemaMemo();
  db = createSqliteD1();
  await ensureSchema(db);
});

afterEach(() => {
  db.close();
});

describe('consumeLimit', () => {
  it('동작별 일 한도는 설계와 같다', () => {
    expect(LIMITS).toEqual({ create: 20, claim: 60, reply: 600, update: 300, read: 5000 });
  });

  it.each(Object.keys(LIMITS) as LimitAction[])(
    '%s 한도까지 허용하고 초과하면 거부한다',
    async (action) => {
      for (let count = 1; count <= LIMITS[action]; count++) {
        expect(await consumeLimit(db, action, 'IP해시', now)).toBe(true);
      }
      expect(await consumeLimit(db, action, 'IP해시', now)).toBe(false);
      expect(await db.prepare('SELECT key, count FROM rate_counters').first()).toEqual({
        key: `${action}:IP해시:2026-10-26`,
        count: LIMITS[action] + 1,
      });
    },
  );

  it('한국 자정에는 이어 세고 UTC 자정에는 새로 센다', async () => {
    for (let count = 0; count < LIMITS.create; count++) {
      await consumeLimit(db, 'create', 'IP해시', new Date('2026-10-26T14:59:59Z'));
    }
    expect(await consumeLimit(db, 'create', 'IP해시', new Date('2026-10-27T00:00:00+09:00'))).toBe(
      false,
    );
    expect(await consumeLimit(db, 'create', 'IP해시', new Date('2026-10-27T00:00:00Z'))).toBe(true);
  });

  it('다른 동작과 IP는 한도를 따로 센다', async () => {
    for (let count = 0; count < LIMITS.create; count++) {
      await consumeLimit(db, 'create', 'IP해시1', now);
    }
    expect(await consumeLimit(db, 'create', 'IP해시1', now)).toBe(false);
    expect(await consumeLimit(db, 'claim', 'IP해시1', now)).toBe(true);
    expect(await consumeLimit(db, 'create', 'IP해시2', now)).toBe(true);
  });

  it('동시에 한도를 소비해도 증가분을 잃지 않는다', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => consumeLimit(db, 'create', 'IP해시', now)),
    );
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(await db.prepare('SELECT count FROM rate_counters').first()).toEqual({ count: 25 });
  });
});

describe('pruneLimits', () => {
  it('UTC 기준 지난 날짜만 지우고 오늘과 미래 키는 남긴다', async () => {
    const insert = db.prepare('INSERT INTO rate_counters VALUES (?, 1)');
    await db.batch([
      insert.bind('create:IP해시:2025-12-31'),
      insert.bind('read:IP해시:2026-10-25'),
      insert.bind('create:IP해시:2026-10-26'),
      insert.bind('claim:IP해시:2026-10-27'),
    ]);

    await pruneLimits(db, new Date('2026-10-27T00:00:00+09:00'));

    expect(await db.prepare('SELECT key FROM rate_counters ORDER BY key').all()).toEqual({
      results: [{ key: 'claim:IP해시:2026-10-27' }, { key: 'create:IP해시:2026-10-26' }],
    });
  });

  it('한 번에 최대 200개를 지우고 다음 호출에서 나머지를 지운다', async () => {
    await db.batch(
      Array.from({ length: 205 }, (_, i) =>
        db.prepare('INSERT INTO rate_counters VALUES (?, 1)').bind(`read:해시${i}:2026-10-25`),
      ),
    );

    await pruneLimits(db, now);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM rate_counters').first()).toEqual({
      count: 5,
    });
    await pruneLimits(db, now);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM rate_counters').first()).toEqual({
      count: 0,
    });
  });
});
