// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ShareDocV2 } from 'src/schema/share';
import { encodeShareHash, hashDoc } from 'src/share-viewer/encode';
import { hashToken } from 'src/server/meet/tokens';
import { AGENT_LIMITS } from 'src/server/agent/tokens';
import { counterKey } from 'src/server/library-sync/limits';
import { createSyncMemoryServer } from '../../helpers/sync-memory-server';

const origin = 'http://localhost:8795';
let server: ReturnType<typeof createSyncMemoryServer>;
let session: string;
let secrets: string[];
function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return server.fetch(origin + '/api/sync/v1' + path, {
    method,
    headers: { 'X-Landmark-Session': session, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function issue() {
  const response = await request('/agent/tokens', 'POST', {
    name: '여행 도우미',
    scopes: ['inbox:write', 'share:create'],
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    token: string;
    id: string;
    name: string;
    scopes: string[];
    expiresAt: number;
  };
  secrets.push(body.token);
  return body;
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: code });
}
async function userId(token: string) {
  const row = await server.db
    .prepare('SELECT user_id FROM agent_tokens WHERE token_hash = ?')
    .bind(await hashToken(token))
    .first<{ user_id: string }>();
  return row!.user_id;
}
async function put(token: string) {
  const doc = JSON.parse(
    readFileSync(new URL('../../fixtures/agent-trip/doc.json', import.meta.url), 'utf8'),
  ) as ShareDocV2;
  const d = await encodeShareHash(hashDoc(doc));
  secrets.push(d);
  const response = await server.agentFetch(origin + '/api/agent/v1/inbox', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ v: 1, key: randomBytes(32).toString('base64url'), d }),
  });
  expect(response.status).toBe(201);
  return { ...((await response.json()) as { id: string }), d };
}
beforeEach(async () => {
  server = createSyncMemoryServer();
  session = await server.login();
  secrets = [session];
});
afterEach(() => {
  const output = (server.logs ?? []).join('\n');
  server.db.close();
  for (const secret of secrets) expect(output.includes(secret)).toBe(false);
});

describe('세션 AI 연결 경로', () => {
  it('발급 원문은 응답에 한 번만 있고 목록은 공개 정보만 가진다', async () => {
    const issued = await issue();
    expect(Object.keys(issued).sort()).toEqual(['expiresAt', 'id', 'name', 'scopes', 'token']);
    expect(/^lmk_[A-Za-z0-9_-]{43}$/.test(issued.token)).toBe(true);
    const response = await request('/agent/tokens');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      enabled: true,
      canCreate: true,
      maxActive: 10,
      tokens: [
        { id: issued.id, name: issued.name, scopes: issued.scopes, expiresAt: issued.expiresAt },
      ],
    });
    expect(Object.keys(body.tokens[0]).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'id',
      'lastUsedAt',
      'name',
      'revokedAt',
      'scopes',
    ]);
    expect(JSON.stringify(body).includes(issued.token)).toBe(false);
  });
  it('LIBRARY_SYNC=off에서도 목록·철회는 되고 발급은 막힌다', async () => {
    const issued = await issue();
    server.env.LIBRARY_SYNC = 'off';
    await error(await request('/agent/tokens', 'POST', {}), 503, 'off');
    const response = await request('/agent/tokens');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: true, canCreate: false });
    expect((await request(`/agent/tokens/${issued.id}`, 'DELETE')).status).toBe(204);
  });
  it('AGENT_API=off는 목록에 반영되고 인증·본문보다 먼저 발급을 막는다', async () => {
    server.env.AGENT_API = 'off';
    const response = await request('/agent/tokens');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, canCreate: false });
    await error(
      await request('/agent/tokens', 'POST', {}, { 'X-Landmark-Session': '' }),
      503,
      'off',
    );
  });
  it('받은함 목록·항목·지우기는 두 스위치가 꺼져도 된다', async () => {
    const issued = await issue();
    const item = await put(issued.token);
    server.env.LIBRARY_SYNC = 'off';
    server.env.AGENT_API = 'off';
    const list = await request('/agent/inbox');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ items: [{ id: item.id, from: '여행 도우미' }] });
    const response = await request(`/agent/inbox/${item.id}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['data', 'id']);
    expect(body.id).toBe(item.id);
    expect(body.data === item.d).toBe(true);
    expect((await request(`/agent/inbox/${item.id}`, 'DELETE')).status).toBe(204);
    await error(await request(`/agent/inbox/${item.id}`), 404, 'not-found');
    await error(await request(`/agent/inbox/${item.id}`, 'DELETE'), 404, 'not-found');
  });
  it('다른 사용자에게 토큰·받은함을 노출하거나 삭제하지 않는다', async () => {
    const issued = await issue();
    const item = await put(issued.token);
    server.env.ALLOWED_ACCOUNTS += ',kakao:dev-other';
    session = await server.login('other');
    secrets.push(session);
    expect(await (await request('/agent/tokens')).json()).toMatchObject({ tokens: [] });
    expect(await (await request('/agent/inbox')).json()).toEqual({ items: [] });
    await error(await request(`/agent/tokens/${issued.id}`, 'DELETE'), 404, 'not-found');
    await error(await request(`/agent/inbox/${item.id}`), 404, 'not-found');
    await error(await request(`/agent/inbox/${item.id}`, 'DELETE'), 404, 'not-found');
  });
  it('모든 경로는 백업과 같은 사용자 헤더 대조를 한다', async () => {
    const issued = await issue();
    const item = await put(issued.token);
    for (const [path, method] of [
      ['/agent/tokens', 'GET'],
      ['/agent/tokens', 'POST'],
      [`/agent/tokens/${issued.id}`, 'DELETE'],
      ['/agent/inbox', 'GET'],
      [`/agent/inbox/${item.id}`, 'GET'],
      [`/agent/inbox/${item.id}`, 'DELETE'],
    ]) {
      await error(
        await request(path!, method!, method === 'GET' ? undefined : {}, {
          'X-Landmark-Backup-User': 'other-user',
        }),
        401,
        'reauth-required',
      );
    }
  });
  it('계정 삭제 뒤 기존 에이전트 토큰은 401', async () => {
    const issued = await issue();
    await put(issued.token);
    expect((await request('/account', 'DELETE', { confirm: 'delete' })).status).toBe(204);
    const response = await server.agentFetch(origin + '/api/agent/v1/whoami', {
      headers: { Authorization: `Bearer ${issued.token}` },
    });
    await error(response, 401, 'unauthorized');
  });
  it('발급 하루 한도를 본문보다 먼저 적용한다', async () => {
    const issued = await issue();
    await server.db
      .prepare('UPDATE rate_counters SET count = ? WHERE key = ?')
      .bind(
        AGENT_LIMITS.tokenCreate,
        counterKey('agent-token-create', await userId(issued.token), Date.now()),
      )
      .run();
    await error(await request('/agent/tokens', 'POST', {}), 429, 'rate-limited');
  });
  it('받은함 목록·항목은 같은 하루 읽기 한도를 쓴다', async () => {
    const issued = await issue();
    const item = await put(issued.token);
    await server.db
      .prepare('INSERT INTO rate_counters (key, count) VALUES (?, ?)')
      .bind(
        counterKey('agent-inbox-read', await userId(issued.token), Date.now()),
        AGENT_LIMITS.inboxRead,
      )
      .run();
    await error(await request('/agent/inbox'), 429, 'rate-limited');
    await error(await request(`/agent/inbox/${item.id}`), 429, 'rate-limited');
  });
  it('id 모양 밖이면 404', async () => {
    await error(await request('/agent/tokens/BAD', 'DELETE'), 404, 'not-found');
    await error(await request('/agent/inbox/bad'), 404, 'not-found');
    await error(await request('/agent/inbox/bad', 'DELETE'), 404, 'not-found');
  });

  describe('AI 변경 기록·되돌리기', () => {
    const requestId = '11111111-2222-4333-8444-555555555555';
    const t = '2026-10-01T00:00:00.000Z';
    const f = <T>(value: T) => ({ value, updatedAt: t });
    async function seedChange() {
      const issued = await issue();
      const user = await userId(issued.token);
      const { issueAgentToken } = await import('src/server/agent/tokens');
      const { productionDeps } = await import('src/server/library-sync/env');
      const lib = await issueAgentToken(
        server.db,
        user,
        { name: '보관함', scopes: ['library:read', 'library:write'] },
        productionDeps(),
      );
      secrets.push(lib.token);
      const doc = {
        id: 'place00001',
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
      };
      const edited = await server.agentFetch(origin + '/api/agent/v1/library/edit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${lib.token}` },
        body: JSON.stringify({
          v: 1,
          requestId,
          ops: [{ op: 'put', kind: 'place', id: 'place00001', baseRev: 0, doc }],
        }),
      });
      expect(edited.status).toBe(200);
      return user;
    }
    it('기록 조회와 되돌리기는 두 스위치가 꺼져도 된다', async () => {
      await seedChange();
      server.env.AGENT_API = 'off';
      server.env.AGENT_EDIT = 'off';
      server.env.LIBRARY_SYNC = 'off';
      const list = await request('/agent/changes');
      expect(list.status).toBe(200);
      const { changes } = (await list.json()) as { changes: { id: string; itemId: string }[] };
      expect(changes).toMatchObject([{ itemId: 'place00001', undoneAt: null }]);
      const undone = await request('/agent/changes/undo', 'POST', { ids: [changes[0]!.id] });
      expect(await undone.json()).toEqual({ results: [{ id: changes[0]!.id, status: 'undone' }] });
      const again = await request('/agent/changes/undo', 'POST', { requestId });
      expect(await again.json()).toEqual({ results: [{ id: changes[0]!.id, status: 'already' }] });
    });
    it('세션과 본문을 검사하고 다른 사용자의 기록은 보이지 않는다', async () => {
      await seedChange();
      await error(
        await request('/agent/changes', 'GET', undefined, { 'X-Landmark-Session': '' }),
        401,
        'missing-token',
      );
      for (const body of [
        {},
        { ids: [] },
        { ids: [1] },
        { ids: ['a'], requestId },
        { requestId: 'x' },
      ])
        expect((await request('/agent/changes/undo', 'POST', body)).status).toBe(422);
      server.env.ALLOWED_ACCOUNTS += ',kakao:dev-other';
      session = await server.login('other');
      secrets.push(session);
      expect(await (await request('/agent/changes')).json()).toEqual({ changes: [] });
      expect(await (await request('/agent/changes/undo', 'POST', { requestId })).json()).toEqual({
        results: [],
      });
    });
  });
});
