import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { type AgentApi, type AgentFailure, type InboxItemView } from 'src/services/agent-inbox/api';
import {
  attachInboxCheck,
  checkInboxOnce,
  discardInboxItem,
  INBOX_CHECK_GAP_MS,
  openInboxDialog,
  sameOwnerNow,
  startInboxCheck,
  type InboxCheckDeps,
} from 'src/services/agent-inbox/inbox-check';
import {
  AGENT_INBOX_KEY,
  readAgentInboxLocal,
  writeAgentInboxLocal,
} from 'src/services/agent-inbox/storage';
import type { SyncApi } from 'src/services/library-sync/api';
import * as shared from 'src/services/library-sync/shared-api';
import {
  newDeviceMeta,
  readSession,
  writeSession,
  writeSyncMeta,
} from 'src/services/library-sync/storage';
import { agentInboxOpenAtom } from 'src/stores/agent-inbox';
import { OFF_STATUS, syncStatusAtom } from 'src/stores/sync-status';
const { loadEngine, toast } = vi.hoisted(() => ({ loadEngine: vi.fn(), toast: vi.fn() }));
vi.mock('src/services/library-sync/boot', () => ({ loadSyncEngine: loadEngine }));
vi.mock('sonner', () => ({ toast }));

let storage: Storage;
const randomSession = () =>
  (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '').slice(0, 43);
function login(owner = 'account-a') {
  writeSyncMeta(storage, { ...newDeviceMeta(), enabled: true, userId: owner });
  writeSession(storage, { v: 1, provider: 'kakao', sessionId: randomSession() });
}
const item = (id: string): InboxItemView => ({
  id,
  title: '여행',
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  places: 1,
  from: null,
  createdAt: 1,
  expiresAt: 2,
});
const reply = (...ids: string[]) => ({ ok: true as const, data: { items: ids.map(item) } });
const clientApi = (send: ReturnType<typeof vi.fn>) => ({ client: { send } }) as unknown as SyncApi;
function fixture() {
  const inbox = vi.fn<AgentApi['inbox']>().mockResolvedValue(reply('first'));
  const api: AgentApi = {
    owner: 'account-a',
    inbox,
    tokens: vi.fn(),
    issue: vi.fn(),
    revoke: vi.fn(),
    item: vi.fn(),
    discard: vi.fn(),
    changes: vi.fn(),
    undo: vi.fn(),
  };
  const deps: InboxCheckDeps = {
    api: () => api,
    storage,
    now: vi.fn(() => 0),
    notify: vi.fn(),
    session: () => readSession(storage)?.sessionId ?? null,
    schedule: vi.fn(),
  };
  return { deps, api, inbox };
}
function engine() {
  let listener: (s: { phase: string }) => void = () => {};
  const off = vi.fn();
  return {
    onRunFinished: vi.fn((next: typeof listener) => {
      listener = next;
      return off;
    }),
    emit: (phase = 'synced') => listener({ phase }),
    off,
  };
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  storage = createMemoryStorage();
  vi.spyOn(shared, 'getSharedSyncStorage').mockReturnValue(storage);
  login();
  getDefaultStore().set(syncStatusAtom, OFF_STATUS);
  getDefaultStore().set(agentInboxOpenAtom, false);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it('첫 synced에 확인하고 시작 시각부터 10분이 지나야 다시 확인해요', async () => {
  const { deps, inbox } = fixture();
  const e = engine();
  let now = 0;
  deps.now = () => now;
  const detach = attachInboxCheck(e, deps, () => ({ phase: 'off' }));
  e.emit('syncing');
  expect(inbox).not.toHaveBeenCalled();
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledTimes(1);
  now = INBOX_CHECK_GAP_MS - 1;
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledTimes(1);
  now++;
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledTimes(2);
  detach();
  expect(e.off).toHaveBeenCalledOnce();
  now += INBOX_CHECK_GAP_MS;
  e.emit();
  expect(inbox).toHaveBeenCalledTimes(2);
});
it('붙일 때 이미 synced면 바로 확인하고 진행 중에는 겹치지 않아요', async () => {
  const { deps, inbox } = fixture();
  const pending = deferred<Awaited<ReturnType<AgentApi['inbox']>>>();
  inbox.mockReturnValueOnce(pending.promise);
  const e = engine();
  attachInboxCheck(e, deps, () => ({ phase: 'synced' }));
  e.emit();
  expect(inbox).toHaveBeenCalledOnce();
  pending.resolve(reply());
  await settle();
});
it('새 id가 있을 때만 전체 개수를 알리고 기기에 기록해요', async () => {
  const { deps, inbox } = fixture();
  inbox.mockResolvedValue(reply('first', 'second'));
  expect(await checkInboxOnce(deps)).toBe('ok');
  expect(deps.notify).toHaveBeenLastCalledWith(2);
  await checkInboxOnce(deps);
  expect(deps.notify).toHaveBeenCalledOnce();
  inbox.mockResolvedValue(reply('first', 'second', 'third'));
  await checkInboxOnce(deps);
  expect(deps.notify).toHaveBeenLastCalledWith(3);
  expect(readAgentInboxLocal(storage, 'account-a').notified).toEqual(['first', 'second', 'third']);
  const session = deps.session()!;
  expect(storage.getItem(AGENT_INBOX_KEY)?.includes(session)).toBe(false);
  expect(JSON.stringify(localStorage).includes(session)).toBe(false);
  expect(JSON.stringify(sessionStorage).includes(session)).toBe(false);
});
it('다른 사용자의 알림 기록을 비워 같은 id도 다시 알려요', async () => {
  const { deps } = fixture();
  writeAgentInboxLocal(storage, { v: 1, userId: 'account-b', notified: ['first', 'old'] });
  await checkInboxOnce(deps);
  expect(deps.notify).toHaveBeenCalledWith(1);
  expect(readAgentInboxLocal(storage, 'account-a').notified).toEqual(['first']);
});
it.each<AgentFailure>(['offline', 'server', 'limit', 'off'])(
  '%s 실패는 알리지 않고 failed를 돌려줘요',
  async (reason) => {
    const { deps, inbox } = fixture();
    inbox.mockResolvedValue({ ok: false, reason });
    expect(await checkInboxOnce(deps)).toBe('failed');
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.schedule).not.toHaveBeenCalled();
  },
);
it('실패해도 10분 뒤에 다시 시도해요', async () => {
  const { deps, inbox } = fixture();
  inbox.mockResolvedValue({ ok: false, reason: 'server' });
  const e = engine();
  let now = 0;
  deps.now = () => now;
  attachInboxCheck(e, deps, () => ({ phase: 'synced' }));
  await settle();
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledOnce();
  now = INBOX_CHECK_GAP_MS;
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledTimes(2);
});
it.each<AgentFailure>(['auth', 'not-allowed'])(
  '%s면 한 번 예약하고 같은 세션에서는 멈추며 새 세션에서 바로 재개해요',
  async (reason) => {
    const { deps, inbox } = fixture();
    inbox.mockResolvedValueOnce({ ok: false, reason });
    const e = engine();
    attachInboxCheck(e, deps, () => ({ phase: 'synced' }));
    await settle();
    expect(deps.schedule).toHaveBeenCalledOnce();
    expect(deps.notify).not.toHaveBeenCalled();
    e.emit();
    await settle();
    expect(inbox).toHaveBeenCalledOnce();
    login();
    e.emit();
    await settle();
    expect(inbox).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenCalledWith(1);
    expect(deps.schedule).toHaveBeenCalledOnce();
  },
);
it('한 번 확인도 인증 실패면 paused를 돌려줘요', async () => {
  const { deps, inbox } = fixture();
  inbox.mockResolvedValue({ ok: false, reason: 'auth' });
  expect(await checkInboxOnce(deps)).toBe('paused');
  expect(deps.schedule).toHaveBeenCalledOnce();
});
it.each(['auth', 'success', 'throw'] as const)(
  '요청 중 새 세션이 생기면 이전 %s 응답을 버리고 바로 재확인해요',
  async (kind) => {
    const { deps, inbox } = fixture();
    const pending = deferred<Awaited<ReturnType<AgentApi['inbox']>>>();
    inbox.mockImplementationOnce(async () => {
      const result = await pending.promise;
      if (kind === 'throw') throw Error('연결 실패');
      return result;
    });
    const e = engine();
    attachInboxCheck(e, deps, () => ({ phase: 'synced' }));
    login();
    pending.resolve(kind === 'success' ? reply('stale') : { ok: false, reason: 'auth' });
    await settle();
    expect(inbox).toHaveBeenCalledTimes(2);
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledOnce();
    expect(readAgentInboxLocal(storage, 'account-a').notified).toEqual(['first']);
  },
);
it('세션 재확인도 마지막 요청을 시작한 때부터 10분을 기다려요', async () => {
  const { deps, inbox } = fixture();
  let now = 0;
  deps.now = () => now;
  const pending = deferred<Awaited<ReturnType<AgentApi['inbox']>>>();
  inbox.mockReturnValueOnce(pending.promise);
  const e = engine();
  attachInboxCheck(e, deps, () => ({ phase: 'synced' }));
  now = INBOX_CHECK_GAP_MS;
  login();
  pending.resolve({ ok: false, reason: 'auth' });
  await settle();
  expect(inbox).toHaveBeenCalledTimes(2);
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledTimes(2);
  now += INBOX_CHECK_GAP_MS;
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledTimes(3);
});
it('재확인의 인증 실패는 재확인을 시작한 세션에서 멈춰요', async () => {
  const { deps, inbox } = fixture();
  const pending = deferred<Awaited<ReturnType<AgentApi['inbox']>>>();
  inbox.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ok: false, reason: 'auth' });
  const e = engine();
  attachInboxCheck(e, deps, () => ({ phase: 'synced' }));
  login();
  pending.resolve({ ok: false, reason: 'auth' });
  await settle();
  expect(inbox).toHaveBeenCalledTimes(2);
  expect(deps.schedule).toHaveBeenCalledOnce();
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledTimes(2);
  login();
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledTimes(3);
});
it('즉시 재확인 중에도 세션이 바뀌면 무한히 재시도하지 않아요', async () => {
  const { deps, inbox } = fixture();
  inbox.mockImplementation(async () => {
    login();
    return reply('stale');
  });
  await checkInboxOnce(deps);
  expect(inbox).toHaveBeenCalledTimes(2);
  expect(deps.notify).not.toHaveBeenCalled();
  expect(deps.schedule).not.toHaveBeenCalled();
});
it('응답 사이 계정이 바뀌면 알림과 기록을 버려요', async () => {
  const { deps, inbox } = fixture();
  const pending = deferred<Awaited<ReturnType<AgentApi['inbox']>>>();
  inbox.mockReturnValue(pending.promise);
  const checking = checkInboxOnce(deps);
  login('account-b');
  pending.resolve(reply('stale'));
  await checking;
  expect(deps.notify).not.toHaveBeenCalled();
  expect(storage.getItem(AGENT_INBOX_KEY)).toBeNull();
});
it('설정이 없으면 엔진도 받지 않고, 시작 실패 뒤에는 다시 붙일 수 있어요', async () => {
  const getApi = vi.spyOn(shared, 'getSharedSyncApi').mockReturnValue(null);
  await startInboxCheck();
  expect(loadEngine).not.toHaveBeenCalled();
  getApi.mockReturnValue(clientApi(vi.fn().mockResolvedValue(reply())));
  loadEngine.mockRejectedValueOnce(Error('엔진을 받지 못했어요'));
  await expect(startInboxCheck()).rejects.toThrow('엔진을 받지 못했어요');
});
it('같은 페이지에서 계정을 바꾸면 새 API의 B 머리글로 확인하고 B 알림을 띄워요', async () => {
  const send = vi.fn().mockResolvedValue(reply('same-id'));
  vi.spyOn(shared, 'getSharedSyncApi').mockReturnValue(clientApi(send));
  const e = engine();
  const schedule = vi.fn();
  loadEngine.mockResolvedValue({ ensureLibrarySyncEngine: () => ({ ...e, schedule }) });
  getDefaultStore().set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
  await Promise.all([startInboxCheck(), startInboxCheck()]);
  await settle();
  expect(send).toHaveBeenLastCalledWith('GET', '/v1/agent/inbox', {
    headers: { 'X-Landmark-Backup-User': 'account-a' },
  });
  expect(toast).toHaveBeenCalledWith('AI가 보낸 일정 1개', {
    action: { label: '보기', onClick: openInboxDialog },
  });
  login('account-b');
  e.emit();
  await settle();
  expect(send).toHaveBeenLastCalledWith('GET', '/v1/agent/inbox', {
    headers: { 'X-Landmark-Backup-User': 'account-b' },
  });
  expect(toast).toHaveBeenCalledTimes(2);
  expect(readAgentInboxLocal(storage, 'account-b').notified).toEqual(['same-id']);
  toast.mock.calls[0]![1].action.onClick();
  expect(getDefaultStore().get(agentInboxOpenAtom)).toBe(true);
  await startInboxCheck();
  expect(e.onRunFinished).toHaveBeenCalledOnce();
});
it('계정이 바뀌면 멈춤과 확인 간격을 초기화해요', async () => {
  const { deps, api, inbox } = fixture();
  inbox.mockResolvedValueOnce({ ok: false, reason: 'auth' });
  const e = engine();
  attachInboxCheck(e, deps, () => ({ phase: 'synced' }));
  await settle();
  writeSyncMeta(storage, { ...newDeviceMeta(), enabled: true, userId: 'account-b' });
  deps.api = () => ({ ...api, owner: 'account-b' });
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledTimes(2);
  expect(deps.notify).toHaveBeenCalledWith(1);
});
it('숨은 탭이면 확인하지 않고 마지막 확인 시각도 쓰지 않아요', async () => {
  const { deps, inbox } = fixture();
  let visible = false;
  deps.visible = () => visible;
  const e = engine();
  attachInboxCheck(e, deps, () => ({ phase: 'synced' }));
  await settle();
  expect(inbox).not.toHaveBeenCalled();
  visible = true;
  e.emit();
  await settle();
  expect(inbox).toHaveBeenCalledOnce();
});
it('버리기는 같은 소유자일 때 성공 또는 이미 없음만 true예요', async () => {
  const send = vi.fn().mockResolvedValue({ ok: true, data: null });
  vi.spyOn(shared, 'getSharedSyncApi').mockReturnValue(clientApi(send));
  expect(sameOwnerNow('account-a')).toBe(true);
  expect(await discardInboxItem('first', 'account-b')).toBe(false);
  expect(send).not.toHaveBeenCalled();
  expect(await discardInboxItem('first', null)).toBe(false);
  expect(await discardInboxItem('first', 'account-a')).toBe(true);
  send.mockResolvedValue({ ok: false, kind: 'not-found', status: 404 });
  expect(await discardInboxItem('first', 'account-a')).toBe(true);
  send.mockResolvedValue({ ok: false, kind: 'offline' });
  expect(await discardInboxItem('first', 'account-a')).toBe(false);
  vi.spyOn(shared, 'getSharedSyncApi').mockReturnValue(null);
  expect(await discardInboxItem('first', 'account-a')).toBe(false);
});
it('API가 없으면 조용히 failed예요', async () => {
  const { deps } = fixture();
  deps.api = () => null;
  expect(await checkInboxOnce(deps)).toBe('failed');
  expect(deps.notify).not.toHaveBeenCalled();
});

it.each([
  'synced',
  'conflict',
  'local',
  'auth',
  'off',
  'pending-choice',
  'syncing',
  'not-allowed',
  'unavailable',
  'error',
])('%s 상태에서 완료된 동기화만 받은함을 확인해요', async (phase) => {
  const { deps, inbox } = fixture();
  const e = engine();
  const detach = attachInboxCheck(e, deps, () => ({ phase: 'off' }));
  e.emit(phase);
  await settle();
  expect(inbox).toHaveBeenCalledTimes(['synced', 'conflict'].includes(phase) ? 1 : 0);
  detach();
});
