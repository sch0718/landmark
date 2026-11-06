import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { AgentSection } from 'src/sections/agent/AgentSection';
import { AgentTokenDialog } from 'src/sections/agent/AgentTokenDialog';
import type { AgentApi, AgentTokenView } from 'src/services/agent-inbox/api';
import {
  newDeviceMeta,
  clearSession,
  writeSession,
  writeSyncMeta,
  SYNC_META_KEY,
  SYNC_SESSION_KEY,
} from 'src/services/library-sync/storage';
import { agentChangesOpenAtom, agentInboxOpenAtom } from 'src/stores/agent-inbox';
import { OFF_STATUS, syncStatusAtom } from 'src/stores/sync-status';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sameOwner: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('src/services/agent-inbox/api', () => ({
  createAgentApi: mocks.create,
  sameOwner: mocks.sameOwner,
}));
vi.mock('src/services/library-sync/shared-api', () => ({
  getSharedSyncStorage: () => syncStorage,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const now = new Date(2026, 10, 20, 16).getTime();
const token: AgentTokenView = {
  id: 'abcdef123456',
  name: '여행 도우미',
  scopes: ['inbox:write', 'share:create'],
  createdAt: now,
  expiresAt: new Date(2027, 0, 30).getTime(),
  lastUsedAt: null,
  revokedAt: null,
};
const list = (tokens = [token], enabled = true, canCreate = true, maxActive = 10) => ({
  ok: true as const,
  data: { tokens, enabled, canCreate, maxActive },
});
let api: AgentApi;
let syncStorage: Storage;
function signIn(userId = 'owner-a') {
  writeSyncMeta(syncStorage, { ...newDeviceMeta(), userId, enabled: true });
  // 실제 세션 기록 함수를 쓰되 무작위 세션은 메모리 저장소에만 둬요.
  writeSession(syncStorage, {
    v: 1,
    provider: 'kakao',
    sessionId: crypto.randomUUID().replaceAll('-', '').padEnd(43, '_'),
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function mount() {
  const store = createStore();
  const view = render(
    <Provider store={store}>
      <AgentSection />
    </Provider>,
  );
  return { ...view, store, user: userEvent.setup() };
}
async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '새 연결 만들기' }));
  return within(screen.getByRole('dialog', { name: '새 AI 연결' }));
}
beforeEach(() => {
  vi.resetAllMocks();
  syncStorage = createMemoryStorage();
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  api = {
    owner: 'owner-a',
    tokens: vi.fn().mockResolvedValue(list()),
    issue: vi.fn(),
    revoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
    inbox: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
    item: vi.fn(),
    discard: vi.fn(),
    changes: vi.fn(),
    undo: vi.fn(),
  };
  mocks.create.mockReturnValue(api);
  mocks.sameOwner.mockReturnValue(true);
  signIn();
});
afterEach(() => vi.restoreAllMocks());

describe('설정 AI 연결', () => {
  it.each(['사용자', '세션'])('%s가 없으면 구역과 API 요청이 없어요', (missing) => {
    if (missing === '사용자') writeSyncMeta(syncStorage, newDeviceMeta());
    else clearSession(syncStorage);
    mount();
    expect(screen.queryByRole('heading', { name: 'AI 연결' })).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('같은 페이지의 로그인·로그아웃·연결 해제를 반영해요', async () => {
    clearSession(syncStorage);
    const { store } = mount();
    act(() => {
      signIn();
      store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
    });
    expect(await screen.findByText('받은 일정 없음')).toBeInTheDocument();
    act(() => {
      clearSession(syncStorage);
      store.set(syncStatusAtom, { ...OFF_STATUS });
    });
    expect(screen.queryByRole('heading', { name: 'AI 연결' })).toBeNull();
    act(() => {
      signIn();
      store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
    });
    await screen.findByText('받은 일정 없음');
    act(() => {
      writeSyncMeta(syncStorage, newDeviceMeta());
      store.set(syncStatusAtom, { ...OFF_STATUS });
    });
    expect(screen.queryByRole('heading', { name: 'AI 연결' })).toBeNull();
  });
  it.each([SYNC_META_KEY, SYNC_SESSION_KEY, null])('다른 탭의 %s 변경도 반영해요', async (key) => {
    const { unmount } = mount();
    await screen.findByText('받은 일정 없음');
    clearSession(syncStorage);
    fireEvent(window, new StorageEvent('storage', { key: '무관한 키' }));
    expect(screen.getByRole('heading', { name: 'AI 연결' })).toBeInTheDocument();
    fireEvent(window, new StorageEvent('storage', { key }));
    expect(screen.queryByRole('heading', { name: 'AI 연결' })).toBeNull();
    unmount();
  });
  it('목록에 이름·권한·만료·마지막 사용과 비활성 상태를 표시해요', async () => {
    vi.mocked(api.tokens).mockResolvedValue(
      list([
        token,
        { ...token, id: 'b', name: '오늘 연결', lastUsedAt: now },
        { ...token, id: 'c', name: '어제 연결', lastUsedAt: now - 86400000 },
        { ...token, id: 'd', name: '예전 연결', lastUsedAt: new Date(2026, 10, 18).getTime() },
        { ...token, id: 'e', name: '만료 연결', expiresAt: now },
        { ...token, id: 'f', name: '철회 연결', expiresAt: now - 1, revokedAt: now - 1 },
      ]),
    );
    mount();
    expect(
      await screen.findByText(
        '여행 도우미 · 받은함·짧은 링크 · 만료 1월 30일(71일 남음) · 마지막 사용 없음',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/오늘 연결 .*마지막 사용 오늘/)).toBeInTheDocument();
    expect(screen.getByText(/어제 연결 .*마지막 사용 어제/)).toBeInTheDocument();
    expect(screen.getByText(/예전 연결 .*마지막 사용 11월 18일/)).toBeInTheDocument();
    expect(screen.getByText(/만료 연결 .* · 만료됨 ·/)).toHaveStyle({
      color: 'var(--tm-text-secondary)',
    });
    expect(screen.getByText(/철회 연결 .* · 철회됨 ·/)).toHaveStyle({
      color: 'var(--tm-text-secondary)',
    });
    expect(screen.queryByRole('button', { name: /만료 연결.*철회/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /철회 연결.*철회/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'AI 연결', level: 3 })).toBeInTheDocument();
  });
  it('철회는 확인을 거치고 성공 뒤 목록을 다시 읽어요', async () => {
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: '「여행 도우미」 철회' }));
    expect(api.revoke).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '취소' }));
    expect(api.revoke).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: '「여행 도우미」 철회' }));
    vi.mocked(api.tokens).mockResolvedValue(list([{ ...token, revokedAt: now }]));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '철회' }));
    await screen.findByText(/여행 도우미 .* · 철회됨 ·/);
    expect(api.revoke).toHaveBeenCalledExactlyOnceWith(token.id);
    expect(api.tokens).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'AI 연결' })).toHaveFocus());
  });
  it('철회 실패를 안내해요', async () => {
    vi.mocked(api.revoke).mockResolvedValue({ ok: false, reason: 'offline' });
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: '「여행 도우미」 철회' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '철회' }));
    expect(await screen.findByText('연결을 철회하지 못했어요')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'AI 연결' })).toHaveFocus());
  });
  it.each([
    [false, false, '지금은 AI 연결을 쓸 수 없어요'],
    [true, false, '동기화가 꺼져 있어 새 연결을 만들 수 없어요'],
  ])('enabled=%s canCreate=%s이면 만들기를 끄고 안내해요', async (enabled, canCreate, message) => {
    vi.mocked(api.tokens).mockResolvedValue(list([], enabled, canCreate));
    mount();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 연결 만들기' })).toBeDisabled();
  });
  it('살아 있는 연결만 세어 상한에 도달하면 만들기를 꺼요', async () => {
    vi.mocked(api.tokens).mockResolvedValue(
      list(Array.from({ length: 10 }, (_, i) => ({ ...token, id: String(i) }))),
    );
    mount();
    expect(
      await screen.findByText('연결은 10개까지예요. 쓰지 않는 연결을 철회해 주세요'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 연결 만들기' })).toBeDisabled();
  });
  it('서버 maxActive를 따르고 만료·철회된 연결은 상한에서 빼요', async () => {
    vi.mocked(api.tokens).mockResolvedValue(
      list(
        [token, { ...token, id: 'b', revokedAt: now }, { ...token, id: 'c', expiresAt: now }],
        true,
        true,
        2,
      ),
    );
    mount();
    expect(await screen.findByRole('button', { name: '새 연결 만들기' })).toBeEnabled();
  });
  it('받은 일정 개수를 보여 주고 보기를 누르면 atom을 열고 닫은 뒤 다시 읽어요', async () => {
    vi.mocked(api.inbox).mockResolvedValue({
      ok: true,
      data: { items: [{} as never, {} as never] },
    });
    const { user, store } = mount();
    await user.click(await screen.findByRole('button', { name: '받은 일정 2개 · 보기' }));
    expect(store.get(agentInboxOpenAtom)).toBe(true);
    vi.mocked(api.inbox).mockResolvedValue({ ok: true, data: { items: [] } });
    act(() => store.set(agentInboxOpenAtom, false));
    expect(await screen.findByText('받은 일정 없음')).toBeInTheDocument();
  });
  it.each([
    ['off', '지금은 AI 연결을 쓸 수 없어요'],
    ['offline', '인터넷 연결을 확인해 주세요'],
    ['server', 'AI 연결 정보를 불러오지 못했어요'],
  ] as const)('읽기 실패 %s를 안내하고 다시 시도해요', async (reason, message) => {
    vi.mocked(api.tokens).mockResolvedValueOnce({ ok: false, reason });
    const { user } = mount();
    expect(await screen.findByText(message)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByText('받은 일정 없음');
    expect(api.tokens).toHaveBeenCalledTimes(2);
  });
  it.each(['응답 실패', '예외'])(
    '받은함 %s만 나면 토큰 관리와 다시 시도를 유지해요',
    async (kind) => {
      if (kind === '예외') vi.mocked(api.inbox).mockRejectedValueOnce(new Error('연결 실패'));
      else vi.mocked(api.inbox).mockResolvedValueOnce({ ok: false, reason: 'offline' });
      const { user } = mount();
      expect(await screen.findByText('받은 일정을 불러오지 못했어요')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '「여행 도우미」 철회' })).toBeEnabled();
      expect(screen.getByRole('button', { name: '새 연결 만들기' })).toBeEnabled();
      expect(screen.queryByText('받은 일정 없음')).toBeNull();
      expect(screen.getByRole('button', { name: '다시 시도' })).toHaveStyle({ minHeight: '44px' });
      await user.click(screen.getByRole('button', { name: '다시 시도' }));
      expect(await screen.findByText('받은 일정 없음')).toBeInTheDocument();
    },
  );
  it.each(['사용자', '세션'])(
    '%s가 바뀌면 API를 새로 만들고 이전 응답을 버려요',
    async (changed) => {
      const reply = deferred<Awaited<ReturnType<AgentApi['tokens']>>>();
      vi.mocked(api.tokens).mockReturnValue(reply.promise);
      const { store } = mount();
      await waitFor(() => expect(api.tokens).toHaveBeenCalledOnce());
      const next = {
        ...api,
        owner: changed === '사용자' ? 'owner-b' : 'owner-a',
        tokens: vi.fn().mockResolvedValue(list([{ ...token, name: '새 연결' }])),
      };
      mocks.create.mockReturnValue(next);
      act(() => {
        signIn(next.owner);
        store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' });
      });
      await screen.findByText(/새 연결 ·/);
      await act(async () => reply.resolve(list([{ ...token, name: '늦은 연결' }])));
      expect(screen.queryByText(/늦은 연결/)).toBeNull();
      expect(mocks.create).toHaveBeenCalledTimes(2);
    },
  );
  it('응답 전에 sameOwner가 거짓이면 목록을 버려요', async () => {
    const reply = deferred<Awaited<ReturnType<AgentApi['tokens']>>>();
    vi.mocked(api.tokens).mockReturnValue(reply.promise);
    mount();
    await waitFor(() => expect(api.tokens).toHaveBeenCalledOnce());
    mocks.sameOwner.mockReturnValue(false);
    await act(async () => reply.resolve(list()));
    expect(screen.queryByText(/여행 도우미 ·/)).toBeNull();
  });
});

it('철회 확인을 닫는 중에도 이름과 설명을 유지해요', async () => {
  const { user } = mount();
  await user.click(await screen.findByRole('button', { name: '「여행 도우미」 철회' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('heading').textContent).toBe(
    '「여행 도우미」 연결을 철회할까요?',
  );
  await user.click(within(dialog).getByRole('button', { name: '취소' }));
  expect(dialog.textContent).toContain('「여행 도우미」');
  expect(dialog.textContent).not.toContain('「」');
  expect(dialog.textContent).toContain(
    '이 토큰으로는 더 이상 일정을 보내거나 링크를 만들 수 없어요.',
  );
});

describe('새 AI 연결 창', () => {
  it.each(['닫기', 'Escape', '바깥 클릭'] as const)(
    '발급 중 %s 동작으로 닫은 뒤 성공하면 원문 없이 목록을 다시 읽어요',
    async (closeMethod) => {
      const raw = 'lmk_' + crypto.randomUUID().replaceAll('-', '').padEnd(43, '_');
      const reply = deferred<Awaited<ReturnType<AgentApi['issue']>>>();
      vi.mocked(api.issue).mockReturnValue(reply.promise);
      const { user } = mount();
      const dialog = await openCreate(user);
      await user.click(dialog.getByRole('button', { name: '만들기' }));
      expect(api.issue).toHaveBeenCalledOnce();
      if (closeMethod === '닫기') await user.click(dialog.getByRole('button', { name: '닫기' }));
      else if (closeMethod === 'Escape') await user.keyboard('{Escape}');
      else await user.click(screen.getByRole('dialog').parentElement!);
      expect(screen.queryByRole('dialog') === null).toBe(true);
      expect(api.tokens).toHaveBeenCalledOnce();
      vi.mocked(api.tokens).mockResolvedValue(
        list([token, { ...token, id: 'abcdef123457', name: '늦게 만든 연결' }]),
      );
      await act(async () => reply.resolve({ ok: true, data: { ...token, token: raw } }));
      expect(document.body.textContent?.includes(raw)).toBe(false);
      expect(screen.queryByRole('textbox', { name: '연결 토큰' }) === null).toBe(true);
      for (const storage of [localStorage, sessionStorage, syncStorage]) {
        const values = Array.from({ length: storage.length }, (_, i) =>
          storage.getItem(storage.key(i)!),
        );
        expect(values.some((value) => value?.includes(raw))).toBe(false);
      }
      expect(api.tokens).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: '「늦게 만든 연결」 철회' })).toBeEnabled();
      const reopened = await openCreate(user);
      expect(reopened.queryByRole('textbox', { name: '연결 토큰' }) === null).toBe(true);
    },
  );
  it.each(['계정', '세션'] as const)(
    '발급 중 닫고 응답 전에 %s이 바뀌면 onIssued를 부르지 않아요',
    async (changed) => {
      const raw = 'lmk_' + crypto.randomUUID().replaceAll('-', '').padEnd(43, '_');
      const reply = deferred<Awaited<ReturnType<AgentApi['issue']>>>();
      vi.mocked(api.issue).mockReturnValue(reply.promise);
      const onIssued = vi.fn();
      const onClose = vi.fn();
      const view = render(
        <AgentTokenDialog open api={api} onClose={onClose} onIssued={onIssued} />,
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: '만들기' }));
      expect(api.issue).toHaveBeenCalledOnce();
      await user.click(screen.getByRole('button', { name: '닫기' }));
      expect(onClose).toHaveBeenCalledOnce();
      view.rerender(
        <AgentTokenDialog open={false} api={api} onClose={onClose} onIssued={onIssued} />,
      );
      if (changed === '계정') {
        writeSyncMeta(syncStorage, { ...newDeviceMeta(), userId: 'owner-b', enabled: true });
        mocks.sameOwner.mockReturnValue(false);
      } else signIn();
      await act(async () => reply.resolve({ ok: true, data: { ...token, token: raw } }));
      expect(document.body.textContent?.includes(raw)).toBe(false);
      expect(onIssued).not.toHaveBeenCalled();
    },
  );
  it('원문이 없을 때 Escape로 닫혀요', async () => {
    const { user } = mount();
    await openCreate(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('기본 이름·권한과 이름 길이·빈 권한을 검사해요', async () => {
    const { user } = mount();
    const dialog = await openCreate(user);
    const name = dialog.getByRole('textbox', { name: '이름' });
    expect(name).toHaveValue('Claude Code');
    const inbox = dialog.getByRole('checkbox', { name: '받은함으로 일정 보내기' });
    const share = dialog.getByRole('checkbox', { name: '공유 짧은 링크 만들기' });
    expect(inbox).toBeChecked();
    expect(share).toBeChecked();
    await user.click(inbox);
    await user.click(share);
    expect(dialog.getByRole('button', { name: '만들기' })).toBeDisabled();
    await user.click(inbox);
    await user.clear(name);
    await user.type(name, '   ');
    expect(dialog.getByRole('button', { name: '만들기' })).toBeDisabled();
    expect(dialog.getByText('이름은 1~40자로 적어 주세요')).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, '가'.repeat(41));
    expect(dialog.getByRole('button', { name: '만들기' })).toBeDisabled();
    await user.clear(name);
    await user.type(name, ' 도우미 ');
    vi.mocked(api.issue).mockResolvedValue({ ok: false, reason: 'server' });
    await user.click(dialog.getByRole('button', { name: '만들기' }));
    expect(api.issue).toHaveBeenCalledExactlyOnceWith({ name: '도우미', scopes: ['inbox:write'] });
  });
  it('받은함·짧은 링크를 끄고 보관함만 켜도 만들 수 있어요', async () => {
    vi.mocked(api.issue).mockResolvedValue({ ok: false, reason: 'server' });
    const { user } = mount();
    const dialog = await openCreate(user);
    await user.click(dialog.getByRole('checkbox', { name: '받은함으로 일정 보내기' }));
    await user.click(dialog.getByRole('checkbox', { name: '공유 짧은 링크 만들기' }));
    expect(dialog.getByRole('button', { name: '만들기' })).toBeDisabled();
    await user.click(dialog.getByRole('checkbox', { name: /^보관함 읽기·쓰기/ }));
    expect(dialog.getByRole('button', { name: '만들기' })).toBeEnabled();
    await user.click(dialog.getByRole('button', { name: '만들기' }));
    expect(api.issue).toHaveBeenCalledExactlyOnceWith({
      name: 'Claude Code',
      scopes: ['library:read', 'library:write'],
    });
  });
  it('보관함 스위치는 기본 꺼짐이고 켜면 읽기·쓰기 범위와 되돌리기 안내를 더해요', async () => {
    vi.mocked(api.issue).mockResolvedValue({
      ok: true,
      data: { ...token, token: 'lmk_' + 'a'.repeat(43) },
    });
    const { user } = mount();
    const dialog = await openCreate(user);
    const lib = dialog.getByRole('checkbox', {
      name: '보관함 읽기·쓰기 — AI가 보관함·여행을 직접 고칠 수 있어요',
    });
    expect(lib).not.toBeChecked();
    await user.click(lib);
    expect(lib).toBeChecked();
    await user.click(dialog.getByRole('button', { name: '만들기' }));
    expect(api.issue).toHaveBeenCalledExactlyOnceWith({
      name: 'Claude Code',
      scopes: ['inbox:write', 'share:create', 'library:read', 'library:write'],
    });
    expect(
      await dialog.findByText('고친 내용은 설정 › AI 연결 › AI 변경 기록에서 되돌릴 수 있어요'),
    ).toBeInTheDocument();
  });
  it('보관함 스위치가 꺼져 있으면 안내를 보이지 않고 범위에 넣지 않아요', async () => {
    vi.mocked(api.issue).mockResolvedValue({
      ok: true,
      data: { ...token, token: 'lmk_' + 'a'.repeat(43) },
    });
    const { user } = mount();
    const dialog = await openCreate(user);
    await user.click(dialog.getByRole('button', { name: '만들기' }));
    await dialog.findByRole('textbox', { name: '연결 토큰' });
    expect(api.issue).toHaveBeenCalledExactlyOnceWith({
      name: 'Claude Code',
      scopes: ['inbox:write', 'share:create'],
    });
    expect(dialog.queryByText(/AI 변경 기록/)).toBeNull();
  });
  it.each(['닫기', 'Escape', '바깥 클릭'] as const)(
    '원문 표시 중 %s 동작과 명시적 닫기 뒤 원문 폐기를 확인해요',
    async (closeMethod) => {
      const raw =
        'lmk_' +
        Array.from(
          crypto.getRandomValues(new Uint8Array(43)),
          (v) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[v % 64],
        ).join('');
      vi.mocked(api.issue).mockResolvedValue({ ok: true, data: { ...token, token: raw } });
      const { user } = mount();
      const dialog = await openCreate(user);
      await user.click(dialog.getByRole('button', { name: '만들기' }));
      const field = await dialog.findByRole('textbox', { name: '연결 토큰' });
      expect((field as HTMLInputElement).value === raw).toBe(true);
      expect(field).toHaveAttribute('readonly');
      expect(dialog.queryByRole('button', { name: '만들기' })).toBeNull();
      const warning = dialog.queryByText(
        '이 창을 닫으면 다시 볼 수 없어요. 잃어버렸다면 철회하고 새로 만들어 주세요',
      );
      expect(
        dialog.getByText(
          `security add-generic-password -U -s landmark-agent-token -a ${location.host} -w`,
        ),
      ).toBeInTheDocument();
      for (const storage of [localStorage, sessionStorage, syncStorage]) {
        const values = Array.from({ length: storage.length }, (_, i) =>
          storage.getItem(storage.key(i)!),
        );
        expect(values.some((v) => v?.includes(raw))).toBe(false);
      }
      const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
      await user.click(dialog.getByRole('button', { name: '복사' }));
      expect(copy.mock.calls.length === 1 && copy.mock.calls[0]?.[0] === raw).toBe(true);
      expect(mocks.toast).toHaveBeenCalledWith('복사했어요');
      if (closeMethod === '닫기') await user.click(dialog.getByRole('button', { name: '닫기' }));
      else if (closeMethod === 'Escape') await user.keyboard('{Escape}');
      else fireEvent.click(document.querySelector('.MuiBackdrop-root')!);
      if (closeMethod !== '닫기') {
        // 원문이 실패 출력에 실리지 않도록 불리언만 단언해요.
        expect(screen.queryByRole('dialog') !== null).toBe(true);
        expect(
          (dialog.queryByRole('textbox', { name: '연결 토큰' }) as HTMLInputElement | null)
            ?.value === raw,
        ).toBe(true);
        await user.click(dialog.getByRole('button', { name: '닫기' }));
      }
      expect(warning !== null).toBe(true);
      await waitFor(() => expect(screen.queryByRole('dialog') === null).toBe(true));
      const reopened = await openCreate(user);
      expect(reopened.queryByRole('textbox', { name: '연결 토큰' })).toBeNull();
      expect(document.body.textContent?.includes(raw)).toBe(false);
      expect(api.tokens).toHaveBeenCalledTimes(2);
    },
  );
  it.each([
    ['too-many', '연결은 10개까지예요. 쓰지 않는 연결을 철회해 주세요'],
    ['off', '지금은 AI 연결을 쓸 수 없어요'],
    ['limit', '오늘은 더 만들 수 없어요. 내일 다시 해 주세요'],
    ['server', '연결을 만들지 못했어요'],
  ] as const)('발급 실패 %s를 안내해요', async (reason, message) => {
    vi.mocked(api.issue).mockResolvedValue({ ok: false, reason });
    const { user } = mount();
    const dialog = await openCreate(user);
    await user.click(dialog.getByRole('button', { name: '만들기' }));
    expect(await dialog.findByText(message)).toBeInTheDocument();
  });
  it('발급 중 버튼을 끄고 닫은 창의 응답을 버려요', async () => {
    const reply = deferred<Awaited<ReturnType<AgentApi['issue']>>>();
    vi.mocked(api.issue).mockReturnValue(reply.promise);
    const { user } = mount();
    const dialog = await openCreate(user);
    await user.click(dialog.getByRole('button', { name: '만들기' }));
    expect(dialog.getByRole('button', { name: '만들기' })).toBeDisabled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openCreate(user);
    await act(async () =>
      reply.resolve({
        ok: true,
        data: { ...token, token: 'lmk_' + crypto.randomUUID().replaceAll('-', '').padEnd(43, '_') },
      }),
    );
    expect(screen.queryByRole('textbox', { name: '연결 토큰' })).toBeNull();
  });
  it('발급 요청 뒤 계정이 달라지면 원문을 표시하지 않아요', async () => {
    const reply = deferred<Awaited<ReturnType<AgentApi['issue']>>>();
    vi.mocked(api.issue).mockReturnValue(reply.promise);
    const { user } = mount();
    const dialog = await openCreate(user);
    await user.click(dialog.getByRole('button', { name: '만들기' }));
    mocks.sameOwner.mockReturnValue(false);
    await act(async () =>
      reply.resolve({
        ok: true,
        data: { ...token, token: 'lmk_' + crypto.randomUUID().replaceAll('-', '').padEnd(43, '_') },
      }),
    );
    expect(screen.queryByRole('textbox', { name: '연결 토큰' })).toBeNull();
  });
  describe('AI 변경 기록 단추', () => {
    const writer = {
      ...token,
      id: 'w',
      scopes: ['library:read' as const, 'library:write' as const],
    };
    const record = {
      id: 'c1',
      tokenId: 'w',
      tokenName: '도우미',
      requestId: 'r',
      kind: 'place',
      itemId: 'i',
      beforeRev: 1,
      afterRev: 2,
      label: '카페',
      at: now,
      undoneAt: null,
    };
    it('보관함 쓰기 연결도 기록도 없으면 보이지 않아요', async () => {
      vi.mocked(api.changes).mockResolvedValue({ ok: true, data: { changes: [] } });
      mount();
      await screen.findByText('받은 일정 없음');
      expect(screen.queryByRole('button', { name: 'AI 변경 기록' })).toBeNull();
    });
    it('library:write 연결이 있으면 보여 주고 누르면 창 상태를 켜요', async () => {
      vi.mocked(api.tokens).mockResolvedValue(list([writer]));
      vi.mocked(api.changes).mockResolvedValue({ ok: true, data: { changes: [] } });
      const { user, store } = mount();
      await user.click(await screen.findByRole('button', { name: 'AI 변경 기록' }));
      expect(store.get(agentChangesOpenAtom)).toBe(true);
    });
    it('연결이 없어도 기록이 있으면 보여요', async () => {
      vi.mocked(api.changes).mockResolvedValue({ ok: true, data: { changes: [record] } });
      mount();
      expect(await screen.findByRole('button', { name: 'AI 변경 기록' })).toBeInTheDocument();
    });
  });
});
