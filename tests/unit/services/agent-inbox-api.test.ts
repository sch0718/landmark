import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAgentApi, sameOwner, toAgentFailure } from 'src/services/agent-inbox/api';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { createSyncApi, type SyncApi } from 'src/services/library-sync/api';
import * as shared from 'src/services/library-sync/shared-api';
import { newDeviceMeta, writeSession, writeSyncMeta } from 'src/services/library-sync/storage';

let storage: Storage;
const randomSession = () =>
  (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '').slice(0, 43);
const clientApi = (send: ReturnType<typeof vi.fn>) =>
  ({ client: { send } }) as unknown as Pick<SyncApi, 'client'>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  shared.resetSharedSyncApiForTest();
  storage = createMemoryStorage();
  vi.spyOn(shared, 'getSharedSyncStorage').mockReturnValue(storage);
});
afterEach(() => {
  vi.restoreAllMocks();
  shared.resetSharedSyncApiForTest();
  localStorage.clear();
  sessionStorage.clear();
});

it('설정이 없거나 null을 받으면 API를 만들지 않아요', () => {
  const getApi = vi.spyOn(shared, 'getSharedSyncApi').mockReturnValue(null);
  expect(createAgentApi()).toBeNull();
  expect(getApi).toHaveBeenCalledOnce();
  getApi.mockClear();
  expect(createAgentApi(null)).toBeNull();
  expect(getApi).not.toHaveBeenCalled();
});

it('인자를 생략하면 공유 API를 사용해요', async () => {
  const send = vi.fn().mockResolvedValue({ ok: true, data: { items: [] } });
  vi.spyOn(shared, 'getSharedSyncApi').mockReturnValue(clientApi(send) as SyncApi);
  expect(await createAgentApi()?.inbox()).toEqual({ ok: true, data: { items: [] } });
  expect(send).toHaveBeenCalledWith('GET', '/v1/agent/inbox');
});

it('모든 경로·메서드·본문과 머리글을 연결하고 삭제 성공을 null로 돌려줘요', async () => {
  writeSyncMeta(storage, { ...newDeviceMeta(), userId: 'account-a' });
  const data = { enabled: true, canCreate: true, maxActive: 10, tokens: [] };
  const send = vi.fn().mockResolvedValue({ ok: true, data });
  const api = createAgentApi(clientApi(send))!;
  const headers = { 'X-Landmark-Backup-User': 'account-a' };
  expect(api.owner).toBe('account-a');
  expect(await api.tokens()).toEqual({ ok: true, data });
  expect(send).toHaveBeenLastCalledWith('GET', '/v1/agent/tokens', { headers });
  const body = { name: '시험 연결', scopes: ['inbox:write', 'share:create'] as const };
  const input = { ...body, scopes: [...body.scopes] };
  await api.issue(input);
  expect(send).toHaveBeenLastCalledWith('POST', '/v1/agent/tokens', { headers, body: input });
  expect(await api.revoke('a /?')).toEqual({ ok: true, data: null });
  expect(send).toHaveBeenLastCalledWith('DELETE', '/v1/agent/tokens/a%20%2F%3F', { headers });
  const inbox = { items: [{ id: 'inbox-id', title: '여행', from: null }] };
  send.mockResolvedValue({ ok: true, data: inbox });
  expect(await api.inbox()).toEqual({ ok: true, data: inbox });
  expect(send).toHaveBeenLastCalledWith('GET', '/v1/agent/inbox', { headers });
  const item = { id: 'inbox-id', data: 'compressed-document' };
  send.mockResolvedValue({ ok: true, data: item });
  expect(await api.item('a /?')).toEqual({ ok: true, data: item });
  expect(send).toHaveBeenLastCalledWith('GET', '/v1/agent/inbox/a%20%2F%3F', { headers });
  expect(await api.discard('a /?')).toEqual({ ok: true, data: null });
  expect(send).toHaveBeenLastCalledWith('DELETE', '/v1/agent/inbox/a%20%2F%3F', { headers });
});

it('계정이 바뀌어도 생성 시 계정을 모든 요청에서 유지해요', async () => {
  writeSyncMeta(storage, { ...newDeviceMeta(), userId: 'account-a' });
  const send = vi.fn().mockResolvedValue({ ok: true, data: { id: 'id', data: 'document' } });
  const api = createAgentApi(clientApi(send))!;
  writeSyncMeta(storage, { ...newDeviceMeta(), userId: 'account-b' });
  await api.tokens();
  await api.issue({ name: '연결', scopes: ['inbox:write'] });
  await api.revoke('id');
  await api.inbox();
  await api.item('id');
  await api.discard('id');
  expect(api.owner).toBe('account-a');
  expect(send).toHaveBeenCalledTimes(6);
  expect(
    send.mock.calls.every(
      ([, , options]) => options.headers['X-Landmark-Backup-User'] === 'account-a',
    ),
  ).toBe(true);
});

it('계정이 없으면 머리글 없이 요청해요', async () => {
  const send = vi.fn().mockResolvedValue({ ok: true, data: {} });
  const api = createAgentApi(clientApi(send))!;
  expect(api.owner).toBeNull();
  await api.tokens();
  expect(send).toHaveBeenLastCalledWith('GET', '/v1/agent/tokens');
  const body = { name: '연결', scopes: ['inbox:write'] as 'inbox:write'[] };
  await api.issue(body);
  expect(send).toHaveBeenLastCalledWith('POST', '/v1/agent/tokens', { body });
});

it.each([
  [{ kind: 'auth' }, 'auth'],
  [{ kind: 'not-allowed' }, 'not-allowed'],
  [{ kind: 'offline' }, 'offline'],
  [{ kind: 'off' }, 'off'],
  [{ kind: 'limit', code: 'off', status: 503 }, 'off'],
  [{ kind: 'limit', code: 'rate-limited', status: 429 }, 'limit'],
  [{ kind: 'limit', code: 'config', status: 503 }, 'server'],
  [{ kind: 'limit' }, 'server'],
  [{ kind: 'busy' }, 'server'],
  [{ kind: 'invalid', code: 'too-large' }, 'invalid'],
  [{ kind: 'invalid' }, 'invalid'],
  [{ kind: 'not-found' }, 'not-found'],
  [{ kind: 'server', status: 409 }, 'server'],
  [{ kind: 'server', status: 500 }, 'server'],
  [{ kind: 'resync' }, 'server'],
])('백업 실패를 앱 실패로 해석해요: %j', async (fail, reason) => {
  expect(toAgentFailure(fail as { kind: string })).toBe(reason);
  const send = vi.fn().mockResolvedValue({ ok: false, ...fail });
  const api = createAgentApi(clientApi(send))!;
  for (const result of [
    await api.tokens(),
    await api.inbox(),
    await api.item('id'),
    await api.revoke('id'),
    await api.discard('id'),
  ]) {
    expect(result).toEqual({ ok: false, reason });
  }
  expect(await api.issue({ name: '연결', scopes: ['inbox:write'] })).toEqual({
    ok: false,
    reason: fail.kind === 'server' && 'status' in fail && fail.status === 409 ? 'too-many' : reason,
  });
});

it.each([
  [401, 'unauthorized', 'auth'],
  [403, 'not-allowed', 'not-allowed'],
  [503, 'off', 'off'],
  [429, 'rate-limited', 'limit'],
  [409, 'too-many-tokens', 'too-many'],
  [404, 'not-found', 'not-found'],
] as const)('실제 동기화 클라이언트를 거쳐 %i를 %s로 해석해요', async (status, error, reason) => {
  const sessionId = randomSession();
  writeSession(storage, { v: 1, provider: 'kakao', sessionId });
  writeSyncMeta(storage, { ...newDeviceMeta(), userId: 'account-a' });
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('X-Landmark-Session') === sessionId).toBe(true);
    expect(new Headers(init?.headers).get('X-Landmark-Backup-User')).toBe('account-a');
    return Response.json({ error }, { status });
  });
  const sync = createSyncApi({
    config: {
      apiBase: 'http://localhost/api/sync',
      firebase: null,
      kakao: null,
      naver: null,
      devFake: false,
    },
    storage,
    auth: null,
    fetch,
  });
  expect(await createAgentApi(sync)!.issue({ name: '연결', scopes: ['inbox:write'] })).toEqual({
    ok: false,
    reason,
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost/api/sync/v1/agent/tokens');
  expect(JSON.stringify(localStorage).includes(sessionId)).toBe(false);
  expect(JSON.stringify(sessionStorage).includes(sessionId)).toBe(false);
});

it('발급 토큰은 응답으로만 전달하고 브라우저 저장소나 로그에 남기지 않아요', async () => {
  const token = 'lmk_' + randomSession();
  const logs = [
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'debug'),
  ];
  const data = { token, id: 'token-id', name: '연결', scopes: ['inbox:write'], expiresAt: 123 };
  const api = createAgentApi(clientApi(vi.fn().mockResolvedValue({ ok: true, data })))!;
  const result = await api.issue({ name: '연결', scopes: ['inbox:write'] });
  expect(result.ok && result.data.token === token).toBe(true);
  expect(JSON.stringify(localStorage).includes(token)).toBe(false);
  expect(JSON.stringify(sessionStorage).includes(token)).toBe(false);
  expect(
    JSON.stringify(
      Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i)!)),
    ).includes(token),
  ).toBe(false);
  expect(logs.every((log) => !JSON.stringify(log.mock.calls).includes(token))).toBe(true);
});

it('같은 계정이고 저장된 세션이 있을 때만 소유자가 같아요', () => {
  writeSyncMeta(storage, { ...newDeviceMeta(), userId: 'account-a' });
  expect(sameOwner('account-a')).toBe(false);
  writeSession(storage, { v: 1, provider: 'kakao', sessionId: randomSession() });
  expect(sameOwner('account-a')).toBe(true);
  expect(sameOwner('account-b')).toBe(false);
  expect(sameOwner(null)).toBe(false);
});
