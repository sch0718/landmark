// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readShareHash } from 'src/domain/share/read-share';
import { hashToken } from 'src/server/meet/tokens';
import { handleShareOpen } from 'src/server/share/handlers';
import * as idGen from 'src/services/id-gen';
import { createSyncMemoryServer } from '../../../helpers/sync-memory-server';
import { main, type CliDeps } from '../../../../pipeline/cli/trip';
import { runBuild } from '../../../../pipeline/agent-trip/run-build';
import { parsePlan } from '../../../../pipeline/agent-trip/plan-schema';
import { requestKey, toIssue, createAgentClient } from '../../../../pipeline/agent-trip/client';
import {
  addShare,
  readShares,
  withShareStore,
  type StoredShare,
} from '../../../../pipeline/agent-trip/share-store';

const app = 'http://localhost:8795';
const file = 'tests/fixtures/agent-trip/plan.json';
const fixture = readFileSync(file, 'utf8');
let server: ReturnType<typeof createSyncMemoryServer>;
let deps: CliDeps;
let home: string;
let token: string;
let session: string;
let secrets: string[];
let output: string[];
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const store = () => ({ home, now: () => new Date() });
const saved = (): StoredShare => ({
  app,
  id: randomBytes(12).toString('base64url'),
  deleteToken: randomBytes(32).toString('base64url'),
  title: '여행',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});
async function command(args: string[], json = true) {
  const lines: string[] = [];
  const current = {
    ...deps,
    stdout: (s: string) => {
      lines.push(s);
      output.push(s);
    },
  };
  const exit = await main([...args, '--app', app, ...(json ? ['--json'] : [])], current);
  return { exit, data: json ? JSON.parse(lines.join('')) : null, text: lines.join('') };
}
async function sessionGet(path: string) {
  return server.fetch(app + '/api/sync/v1/agent/' + path, {
    headers: { 'X-Landmark-Session': session },
  });
}
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'agent-cli-'));
  server = createSyncMemoryServer();
  session = await server.login();
  const issued = await server.fetch(app + '/api/sync/v1/agent/tokens', {
    method: 'POST',
    headers: { 'X-Landmark-Session': session },
    body: JSON.stringify({ name: '여행 도우미', scopes: ['inbox:write', 'share:create'] }),
  });
  expect(issued.status).toBe(201);
  token = (await issued.json()).token;
  secrets = [token, session];
  output = [];
  fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (new URL(String(input)).pathname.startsWith('/api/agent/'))
      return server.agentFetch(input, init);
    throw new Error('외부 요청은 허용하지 않아요');
  });
  deps = {
    env: { LANDMARK_AGENT_TOKEN: token, LANDMARK_TRIP_HOME: home },
    platform: 'linux',
    execFile: vi.fn(async () => {
      throw new Error('실제 키체인을 부르면 안 돼요');
    }),
    fetch: fetcher,
    now: () => new Date(),
    sleep: async () => {},
    readFile: async () => fixture,
    writeFile: async () => {},
    stdout: (s) => {
      output.push(s);
    },
    stderr: (s) => {
      output.push(s);
    },
  };
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  try {
    const raw = JSON.parse(await readFile(join(home, 'agent-shares.json'), 'utf8'));
    secrets.push(...raw.items.map((x: StoredShare) => x.deleteToken).filter(Boolean));
  } catch {
    /* 파일을 만들지 않은 사례도 있다. */
  }
  const text = output.join('') + server.logs.join('');
  server.db.close();
  await rm(home, { recursive: true, force: true });
  for (const secret of secrets) expect(text.includes(secret)).toBe(false);
});

describe('원격 여행 CLI', () => {
  it('send는 메모를 기본 포함하고 같은 계획은 중복되지 않으며 no-memo는 다른 키다', async () => {
    const first = await command(['send', file, '--no-routes']);
    expect(first.exit).toBe(0);
    expect(first.data.inbox).toMatchObject({
      created: true,
      expiresAt: expect.stringMatching(/Z$/),
    });
    const list = await (await sessionGet('inbox')).json();
    expect(list.items).toHaveLength(1);
    const inbox = await (await sessionGet('inbox/' + first.data.inbox.id)).json();
    const doc = await readShareHash(inbox.data);
    expect(doc.ok && doc.doc.places.some((p) => p.memo)).toBe(true);
    const second = await command(['send', file, '--no-routes']);
    expect(second.exit).toBe(0);
    expect(second.data.inbox).toMatchObject({ id: first.data.inbox.id, created: false });
    expect((await command(['send', file, '--no-routes', '--no-memo'])).exit).toBe(0);
    const rows = await server.db
      .prepare('SELECT request_key FROM agent_inbox')
      .all<{ request_key: string }>();
    expect(new Set(rows.results.map((x) => x.request_key)).size).toBe(2);
  });
  it.each([true, false])(
    'share 암호문을 풀면 같은 build 문서이고 기본 메모가 없다(경로 생략 %s)',
    async (noRoutes) => {
      const now = new Date();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      deps.now = () => now;
      let nextId = 0;
      vi.spyOn(idGen, 'randomId').mockImplementation((length) =>
        (++nextId).toString(36).padStart(length, 'a'),
      );
      fetcher.mockImplementation(async (input, init) => {
        if (new URL(String(input)).pathname.startsWith('/api/agent/'))
          return server.agentFetch(input, init);
        return Response.json({
          code: 0,
          route: {
            a: [
              {
                summary: { distance: 2500, duration: 120000, tollFare: 0 },
                path: [
                  [128, 37],
                  [128.02, 37.01],
                ],
              },
            ],
          },
          routes: [
            {
              summary: { distance: 620, duration: 558 },
              legs: [{ steps: [{ path: '128,37 128.005,37' }] }],
            },
          ],
        });
      });
      const r = await command(['share', file, ...(noRoutes ? ['--no-routes'] : [])]);
      expect(r.exit).toBe(0);
      expect(r.data.links.short).toMatch(
        /^http:\/\/localhost:8795\/s\/[A-Za-z0-9_-]{16}#k=[A-Za-z0-9_-]{22}$/,
      );
      expect(r.data.links.import).toBeUndefined();
      const { id } = r.data.share;
      expect(r.data.share.expiresAt).toMatch(/Z$/);
      const row = await server.db
        .prepare('SELECT body FROM share_links WHERE id = ?')
        .bind(id)
        .first<{ body: string }>();
      const bytes = Buffer.from(row!.body, 'base64url');
      const key = await crypto.subtle.importKey(
        'raw',
        Buffer.from(new URL(r.data.links.short).hash.slice(3), 'base64url'),
        'AES-GCM',
        false,
        ['decrypt'],
      );
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.subarray(0, 12) },
        key,
        bytes.subarray(12),
      );
      const decrypted = await readShareHash(Buffer.from(plain).toString('base64url'));
      nextId = 0;
      const built = await runBuild({ file, app, noRoutes, includeMemo: false }, deps);
      expect(decrypted).toEqual(await readShareHash(built.doc.viewHash));
      expect(
        decrypted.ok &&
          decrypted.doc.version === 2 &&
          decrypted.doc.trips[0]!.days.some((day) => day.legs.some((leg) => leg.path.length > 0)),
      ).toBe(!noRoutes);
      expect(decrypted.ok && decrypted.doc.places.every((p) => !Object.hasOwn(p, 'memo'))).toBe(
        true,
      );
      const shares = await readShares(store());
      expect(shares).toHaveLength(1);
      secrets.push(shares[0]!.deleteToken);
      expect(shares[0]!.deleteToken.length).toBe(43);
      const list = await command(['unshare', '--list']);
      expect(list.exit).toBe(0);
      expect(list.data.shares).toEqual([
        {
          id,
          title: '속초 1박 2일',
          createdAt: expect.any(String),
          expiresAt: r.data.share.expiresAt,
        },
      ]);
      expect((await command(['unshare', id])).exit).toBe(0);
      expect(await readShares(store())).toEqual([]);
      const opened = await handleShareOpen(
        {
          request: new Request(app + '/s/' + id),
          env: { DB: server.db },
          params: { id },
          waitUntil: () => {},
        },
        { fetch: fetcher, now: () => new Date() },
      );
      expect(opened.status).toBe(404);
      const again = await command(['unshare', id]);
      expect(again.exit).toBe(2);
      expect(again.data.errors[0].code).toBe('unknown-share');
    },
  );
  it('share --memo와 사람용 출력도 비밀을 노출하지 않는다', async () => {
    const r = await command(['share', file, '--no-routes', '--memo'], false);
    expect(r.exit).toBe(0);
    expect(r.text).toContain('짧은 링크:');
    expect(r.text).not.toContain('가져오기:');
    const view = r.text.match(/보기: (\S+)/)![1]!;
    const doc = await readShareHash(new URL(view).hash.slice(3));
    expect(doc.ok && doc.doc.places.some((p) => p.memo)).toBe(true);
    const shares = await readShares(store());
    secrets.push(shares[0]!.deleteToken);
    expect((await command(['whoami'], false)).exit).toBe(0);
    expect((await command(['unshare', '--list'], false)).exit).toBe(0);
  });
  it.each(['html', 'other'])('unshare의 %s 404는 old-server이며 항목을 남긴다', async (kind) => {
    const item = saved();
    secrets.push(item.deleteToken);
    await addShare(item, store());
    fetcher.mockImplementation(async () =>
      kind === 'html'
        ? new Response('<html/>', { status: 404 })
        : Response.json({ error: 'other' }, { status: 404 }),
    );
    const r = await command(['unshare', item.id]);
    expect(r.exit).toBe(5);
    expect(r.data.errors[0].code).toBe('old-server');
    expect(await readShares(store())).toHaveLength(1);
  });
  it('정확한 not-found 404만 로컬 항목을 지우고 403은 남긴다', async () => {
    const item = saved();
    secrets.push(item.deleteToken);
    await addShare(item, store());
    fetcher.mockImplementation(async () =>
      Response.json({ error: 'delete-token' }, { status: 403 }),
    );
    expect((await command(['unshare', item.id])).exit).toBe(4);
    expect(await readShares(store())).toHaveLength(1);
    fetcher.mockImplementation(async () => Response.json({ error: 'not-found' }, { status: 404 }));
    expect((await command(['unshare', item.id])).exit).toBe(0);
    expect(await readShares(store())).toEqual([]);
  });
  it.each(['-', '--'])("'%s'로 시작하는 짧은 링크 id도 옵션이 아닌 id로 지운다", async (prefix) => {
    const item = { ...saved(), id: prefix + 'a'.repeat(16 - prefix.length) };
    secrets.push(item.deleteToken);
    await addShare(item, store());
    fetcher.mockImplementation(async () => new Response(null, { status: 204 }));
    expect((await command(['unshare', item.id])).exit).toBe(0);
    expect(String(fetcher.mock.calls[0]![0])).toContain('/api/agent/v1/share/' + item.id);
    expect(await readShares(store())).toEqual([]);
  });
  it('예상하지 않은 삭제 성공 상태 200은 로컬 항목을 남긴다', async () => {
    const item = saved();
    secrets.push(item.deleteToken);
    await addShare(item, store());
    fetcher.mockImplementation(async () => Response.json({ ok: true }));
    const r = await command(['unshare', item.id]);
    expect(r.exit).toBe(5);
    expect(r.data.errors[0].code).toBe('server');
    expect(await readShares(store())).toHaveLength(1);
  });
  it('200개면 서버를 부르지 않고 share-store-full로 멈춘다', async () => {
    await withShareStore(store(), () => ({
      items: Array.from({ length: 200 }, saved),
      result: null,
    }));
    const r = await command(['share', file, '--no-routes']);
    expect(r.exit).toBe(2);
    expect(r.data.errors[0].code).toBe('share-store-full');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('서버 실패 뒤 예약을 풀고 서버 성공 뒤 저장 실패는 경고로 알린다', async () => {
    fetcher.mockImplementationOnce(async () => Response.json({ error: 'off' }, { status: 503 }));
    expect((await command(['share', file, '--no-routes'])).exit).toBe(5);
    expect(JSON.parse(await readFile(join(home, 'agent-shares.json'), 'utf8')).items).toHaveLength(
      0,
    );
    fetcher.mockImplementationOnce(async (input, init) => {
      const body = JSON.parse(String(init?.body));
      secrets.push(body.deleteToken);
      const response = await server.agentFetch(input, init);
      await writeFile(join(home, 'agent-shares.json'), '{');
      return response;
    });
    const r = await command(['share', file, '--no-routes']);
    expect(r.exit).toBe(0);
    expect(r.data.warnings).toContainEqual({
      path: '',
      code: 'share-store',
      message: '이 링크는 기한까지 지울 수 없어요',
    });
  });
  it('whoami는 connection을 내고 14일 이내 만료는 별도 경고다', async () => {
    await server.db
      .prepare('UPDATE agent_tokens SET expires_at = ? WHERE token_hash = ?')
      .bind(Date.now() + 3 * 86_400_000, await hashToken(token))
      .run();
    const r = await command(['whoami']);
    expect(r.exit).toBe(0);
    expect(r.data.connection).toMatchObject({
      name: '여행 도우미',
      scopes: ['inbox:write', 'share:create'],
      expiresAt: expect.stringMatching(/Z$/),
      provider: 'kakao',
    });
    expect(r.data.warnings).toEqual([
      { path: '', code: 'token-expiring', message: '3일 뒤 만료돼요' },
    ]);
  });
  it('토큰 없음·철회는 끝 코드 4이고 off는 5다', async () => {
    deps.env.LANDMARK_AGENT_TOKEN = '';
    const no = await command(['whoami']);
    expect(no.exit).toBe(4);
    expect(no.data.errors[0].code).toBe('no-token');
    deps.env.LANDMARK_AGENT_TOKEN = token;
    await server.db
      .prepare('UPDATE agent_tokens SET revoked_at = ? WHERE token_hash = ?')
      .bind(Date.now(), await hashToken(token))
      .run();
    const revoked = await command(['whoami']);
    expect(revoked.exit).toBe(4);
    expect(revoked.data.errors[0].code).toBe('token-revoked');
    server.env.AGENT_API = 'off';
    expect((await command(['send', file, '--no-routes'])).exit).toBe(5);
  });
  it('허용 밖 app은 토큰 조회·fetch 전에 거절한다', async () => {
    expect(await main(['whoami', '--app', 'https://evil.example', '--json'], deps)).toBe(2);
    expect(output.join('')).toContain('app-origin');
    expect(fetcher).not.toHaveBeenCalled();
    expect(deps.execFile).not.toHaveBeenCalled();
  });
  it('발급한 토큰을 가짜 키체인에서 읽어 받은함에 보낸다', async () => {
    deps.env.LANDMARK_AGENT_TOKEN = '';
    deps.platform = 'darwin';
    const exec = vi.fn(async () => ({ stdout: token + '\n' }));
    deps.execFile = exec;
    expect((await command(['send', file, '--no-routes'])).exit).toBe(0);
    expect(exec).toHaveBeenCalledExactlyOnceWith('security', [
      'find-generic-password',
      '-s',
      'landmark-agent-token',
      '-a',
      'localhost:8795',
      '-w',
    ]);
    expect((await (await sessionGet('inbox')).json()).items).toHaveLength(1);
  });
  it('list는 토큰·서버 없이 같은 app의 확정 항목만 출력한다', async () => {
    const item = saved();
    secrets.push(item.deleteToken);
    await addShare(item, store());
    await addShare({ ...saved(), app: 'http://localhost:8798' }, store());
    deps.env.LANDMARK_AGENT_TOKEN = '';
    const r = await command(['unshare', '--list']);
    expect(r.exit).toBe(0);
    expect(r.data.shares.map((x: { id: string }) => x.id)).toEqual([item.id]);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await command(['unshare', item.id])).exit).toBe(4);
  });
  it.each([
    ['send', file, '--memo'],
    ['share', file, '--no-memo'],
    ['build', file, '--list'],
    ['whoami', file],
    ['whoami', '--memo'],
    ['unshare', '--list', randomBytes(12).toString('base64url')],
    ['send', file, '--out', 'x'],
    ['unshare', 'bad-id'],
  ])('받지 않는 인자 %j는 입력 오류다', async (...args) => {
    const r = await command(args);
    expect(r.exit).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('동시 share 두 개와 share·unshare 실행도 항목을 잃지 않는다', async () => {
    const [a, b] = await Promise.all([
      command(['share', file, '--no-routes']),
      command(['share', file, '--no-routes']),
    ]);
    expect([a.exit, b.exit]).toEqual([0, 0]);
    for (const x of await readShares(store())) secrets.push(x.deleteToken);
    const [c, d] = await Promise.all([
      command(['share', file, '--no-routes']),
      command(['unshare', a.data.share.id]),
    ]);
    expect([c.exit, d.exit]).toEqual([0, 0]);
    expect((await readShares(store())).map((x) => x.id).sort()).toEqual(
      [b.data.share.id, c.data.share.id].sort(),
    );
  });
});

describe('원격 클라이언트 오류와 시간 제한', () => {
  it.each([
    [401, 'unauthorized', 'unauthorized'],
    [401, 'token-expired', 'token-expired'],
    [401, 'token-revoked', 'token-revoked'],
    [403, 'not-allowed', 'not-allowed'],
    [403, 'scope', 'scope'],
    [403, 'delete-token', 'delete-token'],
    [409, 'inbox-full', 'inbox-full'],
    [429, 'rate-limited', 'rate-limited'],
    [503, 'off', 'off'],
    [503, 'config', 'config'],
    [422, 'invalid', 'internal'],
    [403, 'origin', 'server'],
    [413, 'too-large', 'server'],
    [400, 'bad-json', 'server'],
    [500, 'internal', 'server'],
    [404, 'other', 'old-server'],
  ])('%s %s의 오류를 %s로 바꾼다', (status, error, expected) => {
    expect(toIssue(status, { error }).code).toBe(expected);
  });
  it('정렬된 trim 계획과 메모 옵션으로 43자 키를 만든다', async () => {
    const plan = parsePlan(JSON.parse(fixture));
    const reordered = Object.fromEntries(Object.entries(plan).reverse());
    const key = await requestKey(plan, true);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await requestKey(parsePlan(reordered), true)).toBe(key);
    expect(await requestKey(plan, false)).not.toBe(key);
  });
  it.each(['fetch', 'body'])(
    '%s가 신호를 무시하고 멈춰도 15초에 timeout으로 끝난다',
    async (kind) => {
      vi.useFakeTimers();
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        kind === 'fetch'
          ? await new Promise<Response>(() => {})
          : new Response(new ReadableStream({ start() {} })),
      );
      deps.fetch = fetch;
      const result = command(['whoami']);
      await vi.advanceTimersByTimeAsync(15_000);
      const r = await result;
      expect(r.exit).toBe(5);
      expect(r.data.errors[0].code).toBe('timeout');
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('연결 실패는 offline이고 예외·서버 본문의 비밀을 출력하지 않는다', async () => {
    fetcher.mockRejectedValueOnce(new Error(token));
    const r = await command(['whoami']);
    expect(r.exit).toBe(5);
    expect(r.data.errors[0].code).toBe('offline');
    fetcher.mockResolvedValueOnce(Response.json({ error: token, detail: token }, { status: 500 }));
    expect((await command(['whoami'])).exit).toBe(5);
    const client = createAgentClient(app, token, { fetch: fetcher });
    fetcher.mockResolvedValueOnce(Response.json({ error: 'off' }, { status: 503 }));
    expect(await client.whoami()).toMatchObject({ ok: false, issue: { code: 'off' } });
  });
});
