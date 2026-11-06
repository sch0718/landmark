// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as inboxModule from 'src/server/agent/inbox';
import { encodeShareHash, hashDoc } from 'src/share-viewer/encode';
import type { ShareDocV2 } from 'src/schema/share';
import { AGENT_LIMITS, issueAgentToken, type AgentScope } from 'src/server/agent/tokens';
import { pullChanges, parsePullQuery } from 'src/server/library-sync/library';
import { productionDeps } from 'src/server/library-sync/env';
import { counterKey } from 'src/server/library-sync/limits';
import { hashToken } from 'src/server/meet/tokens';
import { handleShareOpen } from 'src/server/share/handlers';
import { createSyncMemoryServer } from '../../helpers/sync-memory-server';
import { largeAgentDoc } from '../../helpers/agent-import-doc';

const origin = 'http://localhost:8795';
const randomSecret = () => randomBytes(32).toString('base64url');
let server: ReturnType<typeof createSyncMemoryServer>;
let token: string;
let session: string;
let secrets: string[];
let inbox: { v: number; key: string; d: string };

async function issue(scopes = ['inbox:write', 'share:create']) {
  const response = await server.fetch(origin + '/api/sync/v1/agent/tokens', {
    method: 'POST',
    headers: { 'X-Landmark-Session': session },
    body: JSON.stringify({ name: '여행 도우미', scopes }),
  });
  expect(response.status).toBe(201);
  const body = await response.json();
  secrets.push(body.token);
  return body.token as string;
}
/** 발급 경로는 library 범위를 받지 않으므로(PR ①) 발급 함수를 직접 부른다. */
async function issueLibrary(scopes: AgentScope[]) {
  const row = await server.db
    .prepare('SELECT user_id FROM agent_tokens WHERE token_hash = ?')
    .bind(await hashToken(token))
    .first<{ user_id: string }>();
  const issued = await issueAgentToken(
    server.db,
    row!.user_id,
    { name: '보관함 도우미', scopes },
    productionDeps(),
  );
  secrets.push(issued.token);
  return issued.token;
}
const t = '2026-10-01T00:00:00.000Z';
const f = <T>(value: T) => ({ value, updatedAt: t });
const place = (id: string) => ({
  id,
  source: { kind: 'pin' },
  name: f('장소'),
  address: '',
  lng: 127,
  lat: 37,
  category: f(null),
  memo: f('처음'),
  labelIds: f([]),
  saved: f(true),
  createdAt: t,
  deletedAt: null,
});
const requestId = '11111111-2222-4333-8444-555555555555';
const editBody = (ids: string[], id = requestId) => ({
  v: 1,
  requestId: id,
  ops: ids.map((i) => ({ op: 'put', kind: 'place', id: i, baseRev: 0, doc: place(i) })),
});
function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return server.agentFetch(origin + '/api/agent' + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: code });
  expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
}
async function fillCounter(action: string, limit: number) {
  const row = await server.db
    .prepare('SELECT user_id FROM agent_tokens WHERE token_hash = ?')
    .bind(await hashToken(token))
    .first<{ user_id: string }>();
  await server.db
    .prepare('INSERT INTO rate_counters (key, count) VALUES (?, ?)')
    .bind(counterKey(action, row!.user_id, Date.now()), limit)
    .run();
}
function shareBody() {
  const deleteToken = randomSecret();
  secrets.push(deleteToken);
  const body = randomBytes(64).toString('base64url');
  secrets.push(body);
  return { body, kind: 'trip', deleteToken };
}

beforeEach(async () => {
  secrets = [];
  server = createSyncMemoryServer();
  session = await server.login();
  secrets.push(session);
  const doc = JSON.parse(
    readFileSync(new URL('../../fixtures/agent-trip/doc.json', import.meta.url), 'utf8'),
  ) as ShareDocV2;
  inbox = { v: 1, key: randomSecret(), d: await encodeShareHash(hashDoc(doc)) };
  secrets.push(inbox.d);
  token = await issue();
});
afterEach(() => {
  vi.restoreAllMocks();
  const output = (server.logs ?? []).join('\n');
  server.db.close();
  for (const secret of secrets) expect(output.includes(secret)).toBe(false);
});

describe('에이전트 토큰 경로', () => {
  it('whoami는 이름·범위·만료·공급자를 돌려준다', async () => {
    const response = await request('/v1/whoami');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: '여행 도우미',
      scopes: ['inbox:write', 'share:create'],
      expiresAt: expect.any(Number),
      provider: 'kakao',
    });
  });
  it('Origin을 넣는 기존 fetch와 빈 Origin도 거절한다', async () => {
    await error(
      await server.fetch(origin + '/api/agent/v1/whoami', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      403,
      'origin',
    );
    await error(await request('/v1/whoami', 'GET', undefined, { Origin: '' }), 403, 'origin');
  });
  it('토큰이 없으면 401, 범위가 없으면 403', async () => {
    await error(
      await request('/v1/whoami', 'GET', undefined, { Authorization: '' }),
      401,
      'unauthorized',
    );
    token = await issue(['share:create']);
    await error(await request('/v1/inbox', 'POST', inbox), 403, 'scope');
  });
  it('경로·메서드를 Origin·DB보다 먼저 검사하고 CORS를 열지 않는다', async () => {
    server.env.DB = undefined;
    await error(await request('/missing', 'GET', undefined, { Origin: origin }), 404, 'not-found');
    await error(
      await request('/v1/whoami', 'OPTIONS', undefined, { Origin: origin }),
      405,
      'method',
    );
    await error(await request('/v1/whoami'), 503, 'config');
  });
  it('API가 꺼지면 만들기·whoami는 막고 두 스위치가 꺼져도 삭제는 된다', async () => {
    const input = shareBody();
    const { id } = await (await request('/v1/share', 'POST', input)).json();
    server.env.AGENT_API = 'off';
    server.env.SHARE_SHORT = 'off';
    for (const [path, method] of [
      ['/v1/whoami', 'GET'],
      ['/v1/inbox', 'POST'],
      ['/v1/share', 'POST'],
    ])
      await error(await request(path!, method!), 503, 'off');
    expect(
      (
        await request(`/v1/share/${id}`, 'DELETE', undefined, {
          'X-Delete-Token': input.deleteToken,
        })
      ).status,
    ).toBe(204);
  });
  it('짧은 링크 스위치가 꺼지면 share는 503', async () => {
    server.env.SHARE_SHORT = 'off';
    await error(await request('/v1/share', 'POST', shareBody()), 503, 'off');
  });
  it.each(['/v1/inbox', '/v1/share'])(
    '%s의 큰 본문·깨진 JSON을 경계 오류로 바꾼다',
    async (path) => {
      await error(await request(path, 'POST', 'a'.repeat(40_001)), 413, 'too-large');
      await error(await request(path, 'POST', '{'), 400, 'bad-json');
    },
  );
  it('받은함 정상 201, 같은 키 재시도 200과 같은 id', async () => {
    const first = await request('/v1/inbox', 'POST', inbox);
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/),
      expiresAt: expect.any(Number),
      created: true,
    });
    const retry = await request('/v1/inbox', 'POST', inbox);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ...created, created: false });
  });
  it('받은함 스키마·문서 검사 실패는 422', async () => {
    await error(await request('/v1/inbox', 'POST', { ...inbox, extra: true }), 422, 'invalid');
    await error(await request('/v1/inbox', 'POST', { ...inbox, d: 'a' }), 422, 'invalid');
  });
  it('같은 키의 깨진 문서도 검사·저장 없이 기존 항목을 돌려주며 하루 한도에 센다', async () => {
    const first = await request('/v1/inbox', 'POST', inbox);
    expect(first.status).toBe(201);
    const created = await first.json();
    const check = vi.spyOn(inboxModule, 'checkInboxDoc');
    const put = vi.spyOn(inboxModule, 'putInbox');
    const retry = await request('/v1/inbox', 'POST', { ...inbox, d: 'a' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ...created, created: false });
    expect(check).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    const counters = await server.db
      .prepare("SELECT count FROM rate_counters WHERE key LIKE 'agent-inbox:%'")
      .all<{ count: number }>();
    expect(counters.results).toEqual([{ count: 2 }]);
    await server.db
      .prepare("UPDATE rate_counters SET count = ? WHERE key LIKE 'agent-inbox:%'")
      .bind(AGENT_LIMITS.inbox)
      .run();
    await error(await request('/v1/inbox', 'POST', { ...inbox, d: 'a' }), 429, 'rate-limited');
  });
  it('받은함에 가져온 여행이 동기화 상한을 넘는 문서를 보내면 422 item-too-large이다', async () => {
    const d = await encodeShareHash(hashDoc(largeAgentDoc()));
    const response = await request('/v1/inbox', 'POST', { ...inbox, d });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'invalid', reason: 'item-too-large' });
    expect(await server.db.prepare('SELECT id FROM agent_inbox').all()).toMatchObject({
      results: [],
    });
  });
  it.each([
    ['agent-whoami', AGENT_LIMITS.whoami, '/v1/whoami', 'GET'],
    ['agent-inbox', AGENT_LIMITS.inbox, '/v1/inbox', 'POST'],
    ['agent-share', AGENT_LIMITS.share, '/v1/share', 'POST'],
    ['agent-share-delete', AGENT_LIMITS.shareDelete, '/v1/share/abcdefghijklmnop', 'DELETE'],
  ])('%s 하루 한도를 본문 검사 전에 적용한다', async (key, max, path, method) => {
    await fillCounter(key, max);
    await error(
      await request(path, method, method === 'POST' ? '{' : undefined),
      429,
      'rate-limited',
    );
  });
  it('짧은 링크 생성·재시도·HTML 열기·삭제를 연결한다', async () => {
    const input = shareBody();
    const response = await request('/v1/share', 'POST', input);
    expect(response.status).toBe(201);
    const created = await response.json();
    const retry = await request('/v1/share', 'POST', input);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ...created, created: false });
    const pending: Promise<unknown>[] = [];
    const page = await handleShareOpen(
      {
        request: new Request(origin + `/s/${created.id}`),
        env: { DB: server.db },
        params: { id: created.id },
        waitUntil: (p) => {
          pending.push(p);
        },
      },
      {
        fetch: async () => {
          throw Error('외부 요청 금지');
        },
        now: () => new Date(),
      },
    );
    await Promise.all(pending);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    await error(
      await request(`/v1/share/${created.id}`, 'DELETE', undefined, {
        'X-Delete-Token': randomSecret(),
      }),
      403,
      'delete-token',
    );
    expect(
      (
        await request(`/v1/share/${created.id}`, 'DELETE', undefined, {
          'X-Delete-Token': input.deleteToken,
        })
      ).status,
    ).toBe(204);
    await error(
      await request(`/v1/share/${created.id}`, 'DELETE', undefined, {
        'X-Delete-Token': input.deleteToken,
      }),
      404,
      'not-found',
    );
  });
  it('공유 스키마는 trip만 받고 모르는 필드를 거절한다', async () => {
    await error(
      await request('/v1/share', 'POST', { ...shareBody(), kind: 'places' }),
      422,
      'invalid',
    );
    await error(
      await request('/v1/share', 'POST', { ...shareBody(), extra: true }),
      422,
      'invalid',
    );
  });
  it('삭제 id·헤더 모양을 검사한다', async () => {
    await error(await request('/v1/share/bad', 'DELETE'), 404, 'not-found');
    await error(await request('/v1/share/abcdefghijklmnop', 'DELETE'), 400, 'bad-json');
  });
  it('다른 사용자의 연결도 삭제 토큰이 맞으면 지운다', async () => {
    const input = shareBody();
    const { id } = await (await request('/v1/share', 'POST', input)).json();
    server.env.ALLOWED_ACCOUNTS += ',kakao:dev-other';
    session = await server.login('other');
    secrets.push(session);
    token = await issue();
    expect(
      (
        await request(`/v1/share/${id}`, 'DELETE', undefined, {
          'X-Delete-Token': input.deleteToken,
        })
      ).status,
    ).toBe(204);
  });
  it.each([true, false])('알 수 없는 500은 비밀 없이 오류 종류만 기록한다(D1 %s)', async (d1) => {
    const secret = randomSecret();
    secrets.push(secret);
    vi.spyOn(server.db, 'prepare').mockImplementation(() => {
      throw new TypeError((d1 ? 'D1_ERROR: ' : '') + secret);
    });
    server.logs.length = 0;
    await error(await request('/v1/whoami'), 500, 'internal');
    expect(server.logs).toHaveLength(1);
    const logged = JSON.parse(server.logs[0]!);
    expect(logged).toMatchObject({ status: 500, error: 'TypeError' });
    expect(Object.values(logged).includes('D1_ERROR')).toBe(d1);
    expect(server.logs.join('').includes(secret)).toBe(false);
  });
  it('에이전트 로그는 패턴·상태·시간만 한 줄 남긴다', async () => {
    const input = shareBody();
    const { id } = await (await request('/v1/share', 'POST', input)).json();
    server.logs.length = 0;
    await request(`/v1/share/${id}`, 'DELETE', undefined, { 'X-Delete-Token': input.deleteToken });
    expect(server.logs).toHaveLength(1);
    expect(JSON.parse(server.logs[0]!)).toEqual({
      method: 'DELETE',
      path: '/v1/share/:id',
      status: 204,
      ms: expect.any(Number),
    });
  });

  describe('보관함 경로', () => {
    beforeEach(async () => {
      token = await issueLibrary(['library:read', 'library:write']);
    });
    it('범위가 없는 토큰은 보관함 경로 모두 403 scope', async () => {
      token = await issue();
      await error(await request('/v1/library/changes'), 403, 'scope');
      await error(await request('/v1/library/edits'), 403, 'scope');
      await error(
        await request('/v1/library/edit', 'POST', editBody(['place00001'])),
        403,
        'scope',
      );
      await error(await request('/v1/library/undo', 'POST', { requestId }), 403, 'scope');
      token = await issueLibrary(['library:read']);
      await error(
        await request('/v1/library/edit', 'POST', editBody(['place00001'])),
        403,
        'scope',
      );
    });
    it('Origin 헤더가 있으면 403', async () => {
      await error(
        await request('/v1/library/changes', 'GET', undefined, { Origin: origin }),
        403,
        'origin',
      );
    });
    it('edit으로 쓰고 changes·edits로 읽고 undo로 되돌린다', async () => {
      const edited = await request('/v1/library/edit', 'POST', editBody(['place00001']));
      expect(edited.status).toBe(200);
      expect(await edited.json()).toMatchObject({
        rev: 1,
        results: [{ kind: 'place', id: 'place00001', status: 'ok', rev: 1 }],
      });
      const changes = await request('/v1/library/changes');
      expect(changes.status).toBe(200);
      expect(await changes.json()).toMatchObject({ rev: 1, items: [{ id: 'place00001' }] });
      const edits = (await (await request('/v1/library/edits')).json()) as {
        changes: { id: string; itemId: string }[];
      };
      expect(edits.changes).toMatchObject([{ itemId: 'place00001' }]);
      const undone = await request('/v1/library/undo', 'POST', { requestId });
      expect(await undone.json()).toEqual({
        results: [{ id: edits.changes[0]!.id, status: 'undone' }],
      });
    });
    it('changes는 deviceId가 없는 pullChanges와 같은 본문·커서·410 resync를 준다', async () => {
      await request(
        '/v1/library/edit',
        'POST',
        editBody(['place00001', 'place00002', 'place00003']),
      );
      const user = (await server.db.prepare('SELECT id FROM users').first<{ id: string }>())!.id;
      for (const query of ['', '?limit=2', '?since=1&limit=1']) {
        const expected = await pullChanges(
          server.db,
          { userId: user },
          { ...parsePullQuery(new URL('http://x/' + query)), deviceId: null },
          Date.now(),
        );
        const response = await request('/v1/library/changes' + query);
        expect(await response.text()).toBe((expected as { body: string }).body);
      }
      const page = (await (await request('/v1/library/changes?limit=2')).json()) as {
        more: boolean;
        next: { rev: number; key: string };
      };
      expect(page.more).toBe(true);
      await server.db.prepare('UPDATE library_state SET purged_rev = 5').run();
      const gone = await request('/v1/library/changes?since=1');
      expect(gone.status).toBe(410);
      expect(await gone.json()).toEqual({ error: 'resync', purgedRev: 5 });
    });
    it('device 질의는 값이 있든 비었든 422이고 기기 행을 만들지 않는다', async () => {
      await request('/v1/library/edit', 'POST', editBody(['place00001']));
      for (const query of ['device=aaaaaaaaaaaaaaaa', 'device=', 'device=BAD']) {
        const response = await request('/v1/library/changes?' + query);
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ error: 'invalid', path: 'device' });
      }
      await request('/v1/library/changes');
      expect(
        (await server.db
          .prepare('SELECT count(*) AS n FROM library_devices')
          .first<{ n: number }>())!.n,
      ).toBe(0);
    });
    it('AGENT_EDIT=off는 edit·undo를 토큰 검사 전에 503, 읽기는 된다', async () => {
      server.env.AGENT_EDIT = 'off';
      for (const authorization of ['', 'Bearer lmk_bad', `Bearer ${token}`]) {
        for (const path of ['/v1/library/edit', '/v1/library/undo'])
          await error(
            await request(path, 'POST', {}, { Authorization: authorization }),
            503,
            'off',
          );
      }
      expect((await request('/v1/library/changes')).status).toBe(200);
      expect((await request('/v1/library/edits')).status).toBe(200);
    });
    it('AGENT_API=off는 보관함 경로 전부 503', async () => {
      server.env.AGENT_API = 'off';
      for (const [path, method] of [
        ['/v1/library/changes', 'GET'],
        ['/v1/library/edits', 'GET'],
        ['/v1/library/edit', 'POST'],
        ['/v1/library/undo', 'POST'],
      ] as const)
        await error(await request(path, method, method === 'POST' ? {} : undefined), 503, 'off');
    });
    it('edit은 항목 수만큼 하루 한도를 쓰고 넘으면 429', async () => {
      await fillCounter('agent-edit', AGENT_LIMITS.edit - 2);
      expect(
        (await request('/v1/library/edit', 'POST', editBody(['place00001', 'place00002']))).status,
      ).toBe(200);
      await error(
        await request('/v1/library/edit', 'POST', editBody(['place00003'])),
        429,
        'rate-limited',
      );
    });
    it('큰 본문은 413, 잘못된 본문은 422', async () => {
      await error(
        await request('/v1/library/edit', 'POST', 'x'.repeat(1_000_001)),
        413,
        'too-large',
      );
      expect((await request('/v1/library/edit', 'POST', { v: 1 })).status).toBe(422);
      expect((await request('/v1/library/undo', 'POST', {})).status).toBe(422);
    });
  });
});
