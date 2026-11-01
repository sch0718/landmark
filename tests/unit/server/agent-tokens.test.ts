// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAgentToken } from 'src/server/agent/auth';
import {
  AGENT_LIMITS,
  AGENT_SCOPES,
  AGENT_TOKEN_MAX_ACTIVE,
  AGENT_TOKEN_PATTERN,
  AGENT_TOKEN_TOUCH_MS,
  AGENT_TOKEN_TTL_MS,
  issueAgentToken,
  listAgentTokens,
  newAgentToken,
  newAgentTokenId,
  parseIssueBody,
  pruneAgentTokens,
  revokeAgentToken,
} from 'src/server/agent/tokens';
import { productionDeps, type SyncContext, type SyncDeps } from 'src/server/library-sync/env';
import { SyncHttpError, syncError } from 'src/server/library-sync/http';
import { counterKey } from 'src/server/library-sync/limits';
import { hashIp, hashToken } from 'src/server/meet/tokens';
import { createSyncMemoryServer } from '../../helpers/sync-memory-server';

const DAY = 24 * 60 * 60 * 1000;
const input = { name: '시험 연결', scopes: [...AGENT_SCOPES] };
let server: ReturnType<typeof createSyncMemoryServer>;
let deps: SyncDeps;
let ctx: SyncContext;
let userId: string;
let now: number;
let secrets: string[];
let logs: string[];

beforeEach(async () => {
  server = createSyncMemoryServer();
  secrets = [await server.login()];
  userId = (await server.db.prepare('SELECT id FROM users').first<{ id: string }>())!.id;
  now = Date.UTC(2026, 10, 1);
  logs = [];
  deps = {
    ...productionDeps(),
    now: () => now,
    fetch: async () => {
      throw Error('시험에서 외부 요청은 허용하지 않아요');
    },
    log: (line) => logs.push(line),
  };
  ctx = {
    request: new Request('http://localhost:8795/api/agent/v1/whoami'),
    env: { DB: server.db, SYNC_DEV_FAKE_SOCIAL: '1' },
    params: {},
    waitUntil: () => {},
  };
});

afterEach(() => {
  for (const secret of secrets) expect(JSON.stringify(logs).includes(secret)).toBe(false);
  server.db.close();
});

async function issue(owner = userId) {
  const issued = await issueAgentToken(server.db, owner, input, deps);
  secrets.push(issued.token);
  return issued;
}

function authorize(token: string) {
  ctx.request.headers.set('Authorization', `Bearer ${token}`);
}

async function failure(pending: Promise<unknown>, status: number, code: string) {
  let caught: unknown;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  expect(caught instanceof SyncHttpError).toBe(true);
  const response = syncError(caught)!;
  expect(response.status).toBe(status);
  const output = await response.text();
  for (const secret of secrets) {
    expect(output.includes(secret)).toBe(false);
    expect(String(caught).includes(secret)).toBe(false);
  }
  expect(JSON.parse(output)).toEqual({ error: code });
}

async function authCount() {
  return (
    (await server.db
      .prepare('SELECT sum(count) AS count FROM rate_counters WHERE key LIKE ?')
      .bind('agent-auth-fail:%')
      .first<{ count: number | null }>())!.count ?? 0
  );
}

describe('입력과 무작위 값', () => {
  it('32바이트 토큰과 12자 공개 id를 만든다', () => {
    const random = vi.fn((n: number) => crypto.getRandomValues(new Uint8Array(n)));
    const token = newAgentToken({ random });
    secrets.push(token);
    expect(AGENT_TOKEN_PATTERN.test(token)).toBe(true);
    expect(random.mock.calls[0]).toEqual([32]);
    expect(newAgentTokenId(deps)).toMatch(/^[a-z0-9]{12}$/);
  });

  it('공개 id에서 252 이상 바이트를 버리고 다시 받아 모듈로 편향을 피한다', () => {
    let calls = 0;
    const random = (n: number) => new Uint8Array(n).fill(calls++ === 0 ? 255 : 35);
    expect(newAgentTokenId({ random })).toBe('999999999999');
    expect(calls).toBeGreaterThan(1);
  });

  it('이름을 다듬고 범위를 중복 제거해 정렬한다', () => {
    expect(
      parseIssueBody({
        name: '  시험 연결  ',
        scopes: ['share:create', 'inbox:write', 'share:create'],
      }),
    ).toEqual(input);
    expect(parseIssueBody({ name: '가'.repeat(40), scopes: ['share:create'] }).name).toHaveLength(
      40,
    );
  });

  it.each([
    null,
    [],
    '이름',
    {},
    { ...input, extra: true },
    { scopes: input.scopes },
    { ...input, name: 1 },
    { ...input, name: '  ' },
    { ...input, name: '가'.repeat(41) },
    { ...input, name: '앞\n뒤' },
    { ...input, name: '앞\u007f뒤' },
    { ...input, name: '앞\u0085뒤' },
    { ...input, scopes: [] },
    { ...input, scopes: Array(1) },
    { ...input, scopes: 'inbox:write' },
    { ...input, scopes: [1] },
    { ...input, scopes: ['library:read'] },
  ])('잘못된 발급 입력 %#를 422로 거절한다', async (value) => {
    await failure(
      Promise.resolve().then(() => parseIssueBody(value)),
      422,
      'invalid',
    );
  });
});

describe('발급과 보관', () => {
  it('원문은 반환값에만 있고 D1에는 해시와 공백 구분 범위만 저장한다', async () => {
    const { token, row } = await issue();
    expect(AGENT_TOKEN_PATTERN.test(token)).toBe(true);
    expect(row).toEqual({
      id: expect.stringMatching(/^[a-z0-9]{12}$/),
      ...input,
      createdAt: now,
      expiresAt: now + 90 * DAY,
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(AGENT_TOKEN_TTL_MS).toBe(90 * DAY);
    const stored = await server.db.prepare('SELECT * FROM agent_tokens').all();
    expect(JSON.stringify(stored).includes(token)).toBe(false);
    expect(stored.results[0]!.token_hash).toBe(await hashToken(token));
    expect(stored.results[0]!.scopes).toBe('inbox:write share:create');
    expect(JSON.stringify(row).includes(token)).toBe(false);
  });

  it('살아 있는 토큰 10개 뒤에는 거절하고 철회나 만료 뒤에는 다시 발급한다', async () => {
    const issued = [];
    for (let i = 0; i < 10; i++) issued.push(await issue());
    expect(AGENT_TOKEN_MAX_ACTIVE).toBe(10);
    await failure(issue(), 409, 'too-many-tokens');
    await revokeAgentToken(server.db, userId, issued[0]!.row.id, now);
    await issue();
    await server.db
      .prepare('UPDATE agent_tokens SET expires_at = ? WHERE id = ?')
      .bind(now, issued[1]!.row.id)
      .run();
    await issue();
    await issue('다른 사용자');
    expect(await listAgentTokens(server.db, userId, now)).toHaveLength(12);
  });

  it('9개에서 두 발급을 동시에 실행하면 정확히 하나만 성공한다', async () => {
    for (let i = 0; i < 9; i++) await issue();
    const results = await Promise.allSettled([issue(), issue()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    await failure(Promise.reject(rejected.reason), 409, 'too-many-tokens');
    expect(await listAgentTokens(server.db, userId, now)).toHaveLength(10);
  });

  it('목록은 사용자별 만든 순이며 철회는 소유자에게 멱등이다', async () => {
    const first = await issue();
    now++;
    const second = await issue();
    await issue('다른 사용자');
    expect(await revokeAgentToken(server.db, '다른 사용자', first.row.id, now)).toBe(false);
    expect(await revokeAgentToken(server.db, userId, '없는 id', now)).toBe(false);
    expect(await revokeAgentToken(server.db, userId, first.row.id, now)).toBe(true);
    const revokedAt = now;
    now++;
    expect(await revokeAgentToken(server.db, userId, first.row.id, now)).toBe(true);
    expect(await listAgentTokens(server.db, userId, now)).toEqual([
      { ...first.row, revokedAt },
      second.row,
    ]);
  });

  it('목록과 정리는 철회 시각 우선의 30일 경계와 사용자 격리를 지킨다', async () => {
    const cases = [
      { name: '활성', expires: now + DAY, revoked: null, keep: true },
      { name: '최근 만료', expires: now - 30 * DAY + 1, revoked: null, keep: true },
      { name: '만료 경계', expires: now - 30 * DAY, revoked: null, keep: false },
      { name: '최근 철회', expires: now - 40 * DAY, revoked: now - 30 * DAY + 1, keep: true },
      { name: '철회 경계', expires: now + DAY, revoked: now - 30 * DAY, keep: false },
    ];
    const keepIds = [];
    for (const item of cases) {
      const { row } = await issue();
      await server.db
        .prepare('UPDATE agent_tokens SET expires_at = ?, revoked_at = ?, name = ? WHERE id = ?')
        .bind(item.expires, item.revoked, item.name, row.id)
        .run();
      if (item.keep) keepIds.push(row.id);
    }
    const other = await issue('다른 사용자');
    await server.db
      .prepare('UPDATE agent_tokens SET expires_at = ? WHERE id = ?')
      .bind(now - 40 * DAY, other.row.id)
      .run();
    expect((await listAgentTokens(server.db, userId, now)).map((row) => row.id).sort()).toEqual(
      keepIds.sort(),
    );
    await pruneAgentTokens(server.db, userId, now);
    const stored = await server.db.prepare('SELECT id FROM agent_tokens').all<{ id: string }>();
    expect(stored.results.map((row) => row.id).sort()).toEqual([...keepIds, other.row.id].sort());
  });

  it('새 발급 때 자기 토큰 중 오래된 행만 정리한다', async () => {
    const old = await issue();
    await server.db
      .prepare('UPDATE agent_tokens SET expires_at = ? WHERE id = ?')
      .bind(now - 30 * DAY, old.row.id)
      .run();
    await issue();
    expect(
      await server.db.prepare('SELECT id FROM agent_tokens WHERE id = ?').bind(old.row.id).first(),
    ).toBeNull();
  });
});

describe('인증', () => {
  it('모양 오류와 없는 해시만 실패 횟수를 올리고 IP는 해시로 저장한다', async () => {
    const absent = newAgentToken(deps);
    secrets.push(absent);
    const headers = [
      null,
      `Basic ${absent}`,
      `Bearer ${absent.slice(0, -1)}`,
      `bearer ${absent}`,
      `Bearer  ${absent}`,
      `Bearer ${absent}`,
    ];
    ctx.request.headers.set('CF-Connecting-IP', '192.0.2.7');
    for (const header of headers) {
      if (header === null) ctx.request.headers.delete('Authorization');
      else ctx.request.headers.set('Authorization', header);
      await failure(requireAgentToken(ctx, deps, null), 401, 'unauthorized');
    }
    expect(await authCount()).toBe(headers.length);
    expect(
      await server.db
        .prepare('SELECT key, count FROM rate_counters WHERE key LIKE ?')
        .bind('agent-auth-fail:%')
        .all(),
    ).toEqual({
      results: [
        {
          key: counterKey('agent-auth-fail', await hashIp('192.0.2.7', 'dev-salt'), now),
          count: headers.length,
        },
      ],
    });
  });

  it('정상 인증은 권한과 공급자만 돌려주고 알 수 없는 저장 범위는 버린다', async () => {
    const { token, row } = await issue();
    authorize(token);
    await server.db
      .prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
      .bind('library:read share:create inbox:write share:create', row.id)
      .run();
    const principal = await requireAgentToken(ctx, deps, 'inbox:write');
    expect(principal).toEqual({
      userId,
      tokenId: row.id,
      tokenName: input.name,
      scopes: [...AGENT_SCOPES],
      expiresAt: row.expiresAt,
      provider: 'kakao',
    });
    expect(JSON.stringify(principal).includes(token)).toBe(false);
    expect((await listAgentTokens(server.db, userId, now))[0]!.scopes).toEqual([...AGENT_SCOPES]);
    expect(await authCount()).toBe(0);
  });

  it('철회를 만료보다 먼저 검사하고 두 경우 모두 실패 카운터를 쓰지 않는다', async () => {
    const { token, row } = await issue();
    authorize(token);
    await server.db
      .prepare('UPDATE agent_tokens SET expires_at = ?, revoked_at = ? WHERE id = ?')
      .bind(now, now, row.id)
      .run();
    await failure(requireAgentToken(ctx, deps, null), 401, 'token-revoked');
    await server.db
      .prepare('UPDATE agent_tokens SET revoked_at = NULL WHERE id = ?')
      .bind(row.id)
      .run();
    await failure(requireAgentToken(ctx, deps, null), 401, 'token-expired');
    expect(await authCount()).toBe(0);
  });

  it('카카오 허용 목록은 매 요청 다시 읽고 빈 설정도 거절한다', async () => {
    authorize((await issue()).token);
    await requireAgentToken(ctx, deps, null);
    ctx.env.ALLOWED_ACCOUNTS = '';
    await failure(requireAgentToken(ctx, deps, null), 403, 'not-allowed');
    ctx.env.ALLOWED_ACCOUNTS = 'kakao:dev-me';
    await requireAgentToken(ctx, deps, null);
    delete ctx.env.ALLOWED_ACCOUNTS;
    ctx.env.SYNC_DEV_FAKE_SOCIAL = '0';
    await failure(requireAgentToken(ctx, deps, null), 403, 'not-allowed');
    expect(await authCount()).toBe(0);
  });

  it('네이버도 계정 목록으로 검사하고 공급자를 돌려준다', async () => {
    await server.db
      .prepare('UPDATE users SET firebase_sub = ? WHERE id = ?')
      .bind('naver:시험', userId)
      .run();
    authorize((await issue()).token);
    ctx.env.ALLOWED_ACCOUNTS = 'naver:시험';
    expect((await requireAgentToken(ctx, deps, null)).provider).toBe('naver');
    ctx.env.ALLOWED_ACCOUNTS = 'kakao:시험';
    await failure(requireAgentToken(ctx, deps, null), 403, 'not-allowed');
  });

  it('Google은 대문자 이메일을 소문자로 검사하고 빈 이메일은 거절한다', async () => {
    const googleId = crypto.randomUUID();
    await server.db
      .prepare(
        'INSERT INTO users (id, firebase_sub, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(googleId, crypto.randomUUID(), 'TEST@EXAMPLE.COM', now, now)
      .run();
    authorize((await issue(googleId)).token);
    ctx.env.ALLOWED_EMAILS = 'test@example.com';
    expect((await requireAgentToken(ctx, deps, null)).provider).toBe('google');
    ctx.env.ALLOWED_EMAILS = 'other@example.com';
    await failure(requireAgentToken(ctx, deps, null), 403, 'not-allowed');
    ctx.env.ALLOWED_EMAILS = 'test@example.com';
    await server.db.prepare('UPDATE users SET email = ? WHERE id = ?').bind('', googleId).run();
    await failure(requireAgentToken(ctx, deps, null), 403, 'not-allowed');
  });

  it('허용 계정을 범위보다 먼저 검사하고 거절된 요청은 사용 시각을 쓰지 않는다', async () => {
    const { token, row } = await issue();
    authorize(token);
    await server.db
      .prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
      .bind('inbox:write', row.id)
      .run();
    ctx.env.ALLOWED_ACCOUNTS = '';
    await failure(requireAgentToken(ctx, deps, 'share:create'), 403, 'not-allowed');
    delete ctx.env.ALLOWED_ACCOUNTS;
    await failure(requireAgentToken(ctx, deps, 'share:create'), 403, 'scope');
    expect((await listAgentTokens(server.db, userId, now))[0]!.lastUsedAt).toBeNull();
    expect(await authCount()).toBe(0);
  });

  it('마지막 사용은 정확히 한 시간 간격이며 만료 시각은 연장하지 않는다', async () => {
    const { token, row } = await issue();
    authorize(token);
    const firstUse = now;
    await requireAgentToken(ctx, deps, null);
    now += AGENT_TOKEN_TOUCH_MS - 1;
    await requireAgentToken(ctx, deps, null);
    expect((await listAgentTokens(server.db, userId, now))[0]!.lastUsedAt).toBe(firstUse);
    now++;
    await requireAgentToken(ctx, deps, null);
    expect((await listAgentTokens(server.db, userId, now))[0]).toMatchObject({
      lastUsedAt: now,
      expiresAt: row.expiresAt,
    });
  });

  it('실패 300번까지는 401, 301번째는 429이고 정상 요청과 다른 IP·날짜는 독립이다', async () => {
    expect(AGENT_LIMITS.authFail).toBe(300);
    for (let i = 0; i < 300; i++)
      await failure(requireAgentToken(ctx, deps, null), 401, 'unauthorized');
    await failure(requireAgentToken(ctx, deps, null), 429, 'rate-limited');
    expect(await authCount()).toBe(301);
    authorize((await issue()).token);
    await requireAgentToken(ctx, deps, null);
    ctx.request.headers.delete('Authorization');
    ctx.request.headers.set('CF-Connecting-IP', '192.0.2.8');
    await failure(requireAgentToken(ctx, deps, null), 401, 'unauthorized');
    ctx.request.headers.delete('CF-Connecting-IP');
    now += DAY;
    await failure(requireAgentToken(ctx, deps, null), 401, 'unauthorized');
  });

  it('운영 실패 카운터에는 salt가 필수이며 DB 누락도 503이다', async () => {
    ctx.request = new Request('https://landmark.sch0718.dev/api/agent/v1/whoami');
    await failure(requireAgentToken(ctx, deps, null), 503, 'config');
    ctx.env.IP_HASH_SALT = crypto.randomUUID();
    await failure(requireAgentToken(ctx, deps, null), 401, 'unauthorized');
    delete ctx.env.DB;
    await failure(requireAgentToken(ctx, deps, null), 503, 'config');
  });
});
