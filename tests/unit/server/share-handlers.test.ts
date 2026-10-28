// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSchemaMemo } from 'src/server/meet/db';
import type { MeetContext, MeetEnv } from 'src/server/meet/env';
import type { MeetDeps } from 'src/server/meet/handlers';
import { LIMITS } from 'src/server/meet/limits';
import { hashIp, hashToken, newToken } from 'src/server/meet/tokens';
import {
  handleShareCreate,
  handleShareDelete,
  handleShareOpen,
  pruneExpiredShares,
  SHARE_REQUEST_MAX_BYTES,
} from 'src/server/share/handlers';
import { OPEN_SCRIPT, OPEN_TEXT } from 'src/server/share/open-page';
import { encryptShareHash } from 'src/services/share-short/crypto';
import { createSqliteD1 } from '../../helpers/sqlite-d1';

const NOW = new Date('2026-10-28T03:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const LOCAL = 'http://localhost:8788';
const BODY = 'A'.repeat(64);
let db: ReturnType<typeof createSqliteD1>;
let env: MeetEnv;
let deps: MeetDeps;
let pending: Promise<unknown>[];
let now: Date;

beforeEach(() => {
  resetSchemaMemo();
  db = createSqliteD1();
  env = { DB: db };
  now = NOW;
  deps = { fetch: vi.fn<typeof fetch>(), now: () => now };
  pending = [];
});
afterEach(async () => {
  await Promise.all(pending);
  db.close();
});

function context(
  method: string,
  path: string,
  options: {
    body?: unknown;
    raw?: string;
    origin?: string | null;
    url?: string;
    token?: string;
    id?: string;
    ip?: string;
    headers?: Record<string, string>;
  } = {},
): MeetContext {
  const headers = new Headers(options.headers);
  if (options.origin !== null) headers.set('Origin', options.origin ?? LOCAL);
  headers.set('CF-Connecting-IP', options.ip ?? '192.0.2.10');
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  const body =
    options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return {
    request: new Request(`${options.url ?? LOCAL}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    }),
    env,
    params: options.id === undefined ? {} : { id: options.id },
    waitUntil: (promise) => {
      pending.push(promise);
    },
  };
}

const input = (patch: Record<string, unknown> = {}) => ({
  body: BODY,
  kind: 'places',
  turnstile: 'dev',
  deleteToken: newToken(),
  ...patch,
});
async function create(patch: Record<string, unknown> = {}, options = {}) {
  const response = await handleShareCreate(
    context('POST', '/api/share', { body: input(patch), ...options }),
    deps,
  );
  await Promise.all(pending);
  return response;
}
async function created(patch: Record<string, unknown> = {}) {
  const response = await create(patch);
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; expiresAt: string; created: boolean };
}
const open = (id: string, options = {}) =>
  handleShareOpen(context('GET', `/s/${id}`, { origin: null, id, ...options }), deps);

describe('POST /api/share', () => {
  it('암호문을 그대로 두고 16자 id·장소 30일 기한을 돌려준다', async () => {
    const token = newToken();
    const response = await create({ deleteToken: token });
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await response.json()) as { id: string; expiresAt: string; created: boolean };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(body).toMatchObject({
      expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      created: true,
    });
    expect(await db.prepare('SELECT * FROM share_links').all()).toEqual({
      results: [
        {
          id: body.id,
          body: BODY,
          kind: 'places',
          delete_hash: await hashToken(token),
          created_at: NOW.toISOString(),
          expires_at: body.expiresAt,
        },
      ],
    });
  });

  it.each([
    [
      '여행이 먼 일정은 마지막 날 + 7일 한국 자정 직전까지',
      '2027-01-10',
      '2027-01-10T14:59:59.999Z',
    ],
    [
      '곧 끝나는 일정도 30일은 둔다',
      '2026-10-30',
      new Date(NOW.getTime() + 30 * DAY).toISOString(),
    ],
    ['아주 먼 일정은 180일까지', '2028-01-01', new Date(NOW.getTime() + 180 * DAY).toISOString()],
  ])('%s', async (_name, keepUntil, expected) => {
    expect((await created({ kind: 'trip', keepUntil })).expiresAt).toBe(expected);
  });

  it('장소 문서의 기준일은 무시한다', async () => {
    expect((await created({ keepUntil: '2027-06-01' })).expiresAt).toBe(
      new Date(NOW.getTime() + 30 * DAY).toISOString(),
    );
  });

  it('같은 삭제 토큰으로 다시 보내면 처음 링크를 200으로 돌려주고 본문을 바꾸지 않는다', async () => {
    const token = newToken();
    const first = await created({ deleteToken: token });
    const again = await create({ deleteToken: token, body: 'B'.repeat(10) });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      id: first.id,
      expiresAt: first.expiresAt,
      created: false,
    });
    expect(await db.prepare('SELECT body FROM share_links').all()).toEqual({
      results: [{ body: BODY }],
    });
  });

  it('id가 겹치면 새 id로 다시 넣는다', async () => {
    const tokens = [newToken(), newToken()];
    const values = [new Uint8Array(12), new Uint8Array(12), new Uint8Array(12).fill(1)];
    const real = crypto.getRandomValues.bind(crypto);
    const random = vi.spyOn(crypto, 'getRandomValues');
    // id(12바이트)만 정해 둔다. 다른 길이는 진짜 난수를 쓴다.
    random.mockImplementation(((array: Uint8Array<ArrayBuffer>) => {
      if (array.length !== 12) return real(array);
      array.set(values.shift() ?? new Uint8Array(12).fill(2));
      return array;
    }) as typeof crypto.getRandomValues);
    try {
      const first = await created({ deleteToken: tokens[0] });
      const second = await created({ deleteToken: tokens[1] });
      expect(first.id).toBe('AAAAAAAAAAAAAAAA');
      expect(second.id).toBe('AQEBAQEBAQEBAQEB');
    } finally {
      random.mockRestore();
    }
  });

  it.each([
    ['본문 글자', { body: 'a+b' }],
    ['본문 길이', { body: 'A'.repeat(32_041) }],
    ['빈 본문', { body: '' }],
    ['종류', { kind: 'files' }],
    ['기준일 모양', { kind: 'trip', keepUntil: '2027/01/10' }],
    ['삭제 토큰', { deleteToken: 'short' }],
    ['모르는 필드', { extra: 1 }],
  ])('%s가 틀리면 400', async (_name, patch) => {
    expect((await create(patch)).status).toBe(400);
  });

  it('32,040자 본문은 받는다', async () => {
    expect((await create({ body: 'A'.repeat(32_040) })).status).toBe(201);
  });

  it('요청이 40,000바이트를 넘으면 본문을 읽기 전에 413', async () => {
    const response = await handleShareCreate(
      context('POST', '/api/share', {
        raw: '{}',
        headers: { 'Content-Length': String(SHARE_REQUEST_MAX_BYTES + 1) },
      }),
      deps,
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'TOO_LARGE' } });
  });

  it('길이 헤더가 없어도 실제 바이트가 넘으면 413', async () => {
    const response = await handleShareCreate(
      context('POST', '/api/share', { raw: JSON.stringify(input({ pad: 'x'.repeat(40_000) })) }),
      deps,
    );
    expect(response.status).toBe(413);
  });

  it('허용하지 않는 출처는 403', async () => {
    expect((await create({}, { origin: 'https://evil.test' })).status).toBe(403);
  });

  it('SHARE_SHORT=off면 503 off', async () => {
    env.SHARE_SHORT = 'off';
    const response = await create();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reason: 'off', error: { code: 'UNAVAILABLE' } });
  });

  it('운영에서 Turnstile 비밀 키가 없으면 503 config', async () => {
    env.IP_HASH_SALT = 'salt';
    const response = await create(
      {},
      { url: 'https://landmark.sch0718.dev', origin: 'https://landmark.sch0718.dev' },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reason: 'config' });
  });

  it('Turnstile 검증이 실패하면 400 turnstile, 성공하면 만든다', async () => {
    env.TURNSTILE_SECRET = 'secret';
    vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ success: false }));
    const failed = await create({ turnstile: 'bad' });
    expect(failed.status).toBe(400);
    expect(await failed.json()).toMatchObject({ reason: 'turnstile' });
    vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ success: true }));
    expect((await create({ turnstile: 'good' })).status).toBe(201);
  });

  it(`IP 해시당 하루 ${LIMITS.shareCreate}번까지 만든다`, async () => {
    for (let i = 0; i < LIMITS.shareCreate; i++) expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(429);
    expect((await create({}, { ip: '192.0.2.99' })).status).toBe(201);
  });

  it('만들 때 기한이 지난 링크를 정리한다', async () => {
    const old = await created();
    now = new Date(NOW.getTime() + 31 * DAY);
    await created();
    expect(
      await db.prepare('SELECT id FROM share_links WHERE id = ?').bind(old.id).first(),
    ).toBeNull();
  });
});

describe('GET /s/:id', () => {
  it('출처 없이 열리고 암호문을 데이터 블록에 넣은 페이지를 준다', async () => {
    const { id } = await created();
    const response = await open(id);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    const html = await response.text();
    expect(html).toContain(`<script type="application/json" id="c">"${BODY}"</script>`);
    expect(html).toContain(OPEN_TEXT.opening);
  });

  it('CSP가 인라인 스크립트의 해시만 허락한다', async () => {
    const { id } = await created();
    const response = await open(id);
    const html = await response.text();
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts).toEqual([OPEN_SCRIPT]);
    const hash = createHash('sha256').update(scripts[0]!).digest('base64');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'sha256-${hash}'`,
    );
  });

  it('없는 id·틀린 모양은 404, 만료는 410 안내 페이지', async () => {
    const { id } = await created();
    expect((await open('AAAAAAAAAAAAAAAA')).status).toBe(404);
    const bad = await open('짧음');
    expect(bad.status).toBe(404);
    expect(await bad.text()).toContain(OPEN_TEXT.notFound);
    now = new Date(NOW.getTime() + 30 * DAY);
    const ended = await open(id);
    expect(ended.status).toBe(410);
    expect(await ended.text()).toContain(OPEN_TEXT.ended);
  });

  it(`없는 링크는 IP 해시당 하루 ${LIMITS.shareRead}번까지 세고, 정상 읽기는 세지 않는다`, async () => {
    const { id } = await created();
    for (let i = 0; i < 3; i++) expect((await open(id)).status).toBe(200);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS count FROM rate_counters WHERE key LIKE 'shareRead:%'")
        .first(),
    ).toEqual({ count: 0 });
    // 로컬 요청은 개발용 소금을 쓴다. 한도까지 이미 센 상태로 둔다.
    await db
      .prepare('INSERT INTO rate_counters (key, count) VALUES (?, ?)')
      .bind(`shareRead:${await hashIp('192.0.2.10', 'dev-salt')}:2026-10-28`, LIMITS.shareRead)
      .run();
    const busy = await open('AAAAAAAAAAAAAAAA');
    expect(busy.status).toBe(429);
    expect(await busy.text()).toContain(OPEN_TEXT.busy);
    expect((await open(id)).status).toBe(200);
  });

  it('DB가 없으면 503 안내 페이지', async () => {
    env = {} as MeetEnv;
    const response = await open('AAAAAAAAAAAAAAAA');
    expect(response.status).toBe(503);
    expect(await response.text()).toContain(OPEN_TEXT.unavailable);
  });

  it('SHARE_SHORT=off여도 이미 만든 링크는 열린다', async () => {
    const { id } = await created();
    env.SHARE_SHORT = 'off';
    expect((await open(id)).status).toBe(200);
  });

  it('읽을 때도 기한이 지난 링크를 정리한다', async () => {
    const { id } = await created();
    now = new Date(NOW.getTime() + 31 * DAY);
    await open(id);
    await Promise.all(pending);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM share_links').first()).toEqual({
      count: 0,
    });
  });
});

describe('여는 쪽 스크립트', () => {
  async function run(hash: string, body: string) {
    const page = {
      m: { textContent: OPEN_TEXT.opening },
      c: { textContent: JSON.stringify(body) },
    };
    const replaced: string[] = [];
    const location = { hash, replace: (url: string) => replaced.push(url) };
    const script = new Function(
      'document',
      'location',
      'window',
      `return ${OPEN_SCRIPT.replace(/;\s*$/, '')}`,
    );
    await script({ getElementById: (id: 'm' | 'c') => page[id] }, location, {
      crypto: globalThis.crypto,
    });
    return { replaced, message: page.m.textContent };
  }

  it('앱이 암호화한 본문을 키로 풀어 원래 해시의 /view로 옮긴다', async () => {
    const original = Buffer.from(crypto.getRandomValues(new Uint8Array(24_000))).toString(
      'base64url',
    );
    const sealed = await encryptShareHash(original);
    expect(sealed.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(sealed.body.length).toBe(32_038);
    const { replaced } = await run(`#k=${sealed.key}`, sealed.body);
    expect(replaced).toEqual([`/view#d=${original}`]);
  });

  it.each([
    ['키가 없으면', ''],
    ['키 모양이 틀리면', '#k=짧은키'],
  ])('%s 링크가 온전하지 않다고 안내한다', async (_name, hash) => {
    const sealed = await encryptShareHash('AAAA');
    const result = await run(hash, sealed.body);
    expect(result).toEqual({ replaced: [], message: OPEN_TEXT.broken });
  });

  it('다른 키로는 풀지 못하고 안내한다', async () => {
    const sealed = await encryptShareHash('AAAA');
    const other = await encryptShareHash('AAAA');
    expect(await run(`#k=${other.key}`, sealed.body)).toEqual({
      replaced: [],
      message: OPEN_TEXT.broken,
    });
  });
});

describe('DELETE /api/share/:id', () => {
  it('삭제 토큰이 맞으면 지우고 204', async () => {
    const token = newToken();
    const { id } = await created({ deleteToken: token });
    const response = await handleShareDelete(
      context('DELETE', `/api/share/${id}`, { id, token }),
      deps,
    );
    expect(response.status).toBe(204);
    expect((await open(id)).status).toBe(404);
  });

  it('토큰이 없거나 틀리면 401, 없는 링크는 404', async () => {
    const { id } = await created();
    expect(
      (await handleShareDelete(context('DELETE', `/api/share/${id}`, { id }), deps)).status,
    ).toBe(401);
    expect(
      (
        await handleShareDelete(
          context('DELETE', `/api/share/${id}`, { id, token: newToken() }),
          deps,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleShareDelete(
          context('DELETE', '/api/share/AAAAAAAAAAAAAAAA', {
            id: 'AAAAAAAAAAAAAAAA',
            token: newToken(),
          }),
          deps,
        )
      ).status,
    ).toBe(404);
    expect((await open(id)).status).toBe(200);
  });

  it('허용하지 않는 출처는 403', async () => {
    const token = newToken();
    const { id } = await created({ deleteToken: token });
    expect(
      (
        await handleShareDelete(
          context('DELETE', `/api/share/${id}`, { id, token, origin: 'https://evil.test' }),
          deps,
        )
      ).status,
    ).toBe(403);
  });
});

describe('pruneExpiredShares', () => {
  it('기한이 지난 것만 오래된 순으로 최대 개수만큼 지운다', async () => {
    await created();
    const insert = db.prepare('INSERT INTO share_links VALUES (?, ?, ?, ?, ?, ?)');
    await db.batch(
      [
        ['first000000000aa', '2026-10-01T00:00:00.000Z'],
        ['second00000000aa', '2026-10-02T00:00:00.000Z'],
        ['future00000000aa', '2026-12-01T00:00:00.000Z'],
      ].map(([id, expires]) => insert.bind(id!, BODY, 'places', id!, '2026-09-01', expires!)),
    );
    expect(await pruneExpiredShares(db, NOW, 1)).toBe(1);
    const left = await db.prepare('SELECT id FROM share_links ORDER BY id').all<{ id: string }>();
    expect(left.results.map((row) => row.id)).not.toContain('first000000000aa');
    expect(left.results.map((row) => row.id)).toContain('second00000000aa');
    expect(await pruneExpiredShares(db, NOW, 20)).toBe(1);
    expect(left.results).toHaveLength(3);
  });
});
