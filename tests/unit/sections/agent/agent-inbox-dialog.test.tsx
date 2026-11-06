import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeCompressedJson } from 'src/domain/codec';
import { SHARE_READ_MESSAGES } from 'src/domain/share/read-share';
import { AgentInboxDialog } from 'src/sections/agent/AgentInboxDialog';
import { AgentInboxHost } from 'src/sections/agent/AgentInboxHost';
import type { AgentApi, InboxItemView } from 'src/services/agent-inbox/api';
import { SYNC_META_KEY, SYNC_SESSION_KEY } from 'src/services/library-sync/storage';
import { addFlowAtom } from 'src/stores/add-place';
import { agentInboxOpenAtom } from 'src/stores/agent-inbox';
import { makeShareV2Doc } from '../../helpers/share-v2-doc';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sameOwner: vi.fn(),
  toast: vi.fn(),
  load: vi.fn(),
}));
vi.mock('src/services/agent-inbox/api', () => ({
  createAgentApi: mocks.create,
  sameOwner: mocks.sameOwner,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('src/services/agent-inbox/boot', () => ({ loadAgentInboxDialog: mocks.load }));

const now = new Date(2026, 10, 20, 16);
const item: InboxItemView = {
  id: 'inbox00000000001',
  title: '강릉 여행',
  startDate: '2026-11-20',
  endDate: '2026-11-21',
  places: 5,
  from: '여행 도우미',
  createdAt: new Date(2026, 10, 20, 15, 12).getTime(),
  expiresAt: new Date(2026, 11, 20).getTime(),
};
const OWNER_CHANGED = '로그인한 계정이 바뀌어 받은 일정을 닫았어요';
let api: AgentApi;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
  api = {
    owner: 'owner-a',
    tokens: vi.fn(),
    issue: vi.fn(),
    revoke: vi.fn(),
    inbox: vi.fn().mockResolvedValue({ ok: true, data: { items: [item] } }),
    item: vi.fn(),
    discard: vi.fn().mockResolvedValue({ ok: true, data: null }),
    changes: vi.fn(),
    undo: vi.fn(),
  };
  mocks.create.mockReturnValue(api);
  mocks.sameOwner.mockReturnValue(true);
  mocks.load.mockResolvedValue({ AgentInboxDialog });
});
afterEach(() => {
  vi.restoreAllMocks();
});
function mount(open = true) {
  const store = createStore();
  const close = vi.fn();
  const view = render(
    <Provider store={store}>
      <AgentInboxDialog open={open} onClose={close} />
    </Provider>,
  );
  return { store, close, ...view, user: userEvent.setup() };
}
const preview = () => screen.getByRole('button', { name: '「강릉 여행」 미리보기' });
const discard = () => screen.getByRole('button', { name: '「강릉 여행」 버리기' });
async function confirmDiscard(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('강릉 여행 · 11월 20일~21일 · 장소 5곳');
  await user.click(discard());
  const dialog = screen.getByRole('dialog', { name: '이 일정을 버릴까요?' });
  expect(within(dialog).getByText('「강릉 여행」 · 되살릴 수 없어요')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: '버리기' }));
}

describe('받은함 창', () => {
  it('닫혀 있으면 API를 만들지 않아요', () => {
    mount(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('받는 중 표시 뒤 제목·기간·장소·연결·받은 때를 보여요', async () => {
    const reply = deferred<Awaited<ReturnType<AgentApi['inbox']>>>();
    vi.mocked(api.inbox).mockReturnValue(reply.promise);
    const { user, close } = mount();
    expect(screen.getByRole('dialog', { name: 'AI가 보낸 일정' })).toBeInTheDocument();
    expect(screen.getByText('받은 일정을 불러오는 중…')).toBeInTheDocument();
    await act(async () => reply.resolve({ ok: true, data: { items: [item] } }));
    expect(screen.getByText('강릉 여행 · 11월 20일~21일 · 장소 5곳')).toBeInTheDocument();
    expect(screen.getByText('여행 도우미 · 오늘 오후 3:12')).toBeInTheDocument();
    expect(preview()).toHaveStyle({ minHeight: '44px' });
    expect(discard()).toHaveStyle({ minHeight: '44px' });
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('부모가 새 onClose로 다시 그려져도 목록은 한 번만 읽어요', async () => {
    const { rerender, store } = mount();
    await screen.findByText('여행 도우미 · 오늘 오후 3:12');
    rerender(
      <Provider store={store}>
        <AgentInboxDialog open onClose={() => {}} />
      </Provider>,
    );
    await act(async () => {});
    expect(api.inbox).toHaveBeenCalledOnce();
  });
  it.each([0, 1, 2])(
    '버린 항목 %s 뒤 다음 또는 이전 항목, 빈 목록 제목으로 초점을 옮겨요',
    async (index) => {
      const rows = [
        item,
        { ...item, id: 'next', title: '속초 여행' },
        { ...item, id: 'last', title: '부산 여행' },
      ];
      vi.mocked(api.inbox).mockResolvedValue({ ok: true, data: { items: rows } });
      const { user } = mount();
      await screen.findByRole('button', { name: '「강릉 여행」 버리기' });
      await user.click(screen.getByRole('button', { name: `「${rows[index]!.title}」 버리기` }));
      const dialog = screen.getByRole('dialog', { name: '이 일정을 버릴까요?' });
      await user.click(within(dialog).getByRole('button', { name: '버리기' }));
      expect(dialog.textContent).toContain(`「${rows[index]!.title}」`);
      expect(dialog.textContent).not.toContain('「」');
      const target = rows[index + 1] ?? rows[index - 1]!;
      await waitFor(() =>
        expect(screen.getByRole('button', { name: `「${target.title}」 미리보기` })).toHaveFocus(),
      );
    },
  );
  it('사용자 문자열을 HTML로 실행하지 않아요', async () => {
    const title = '<img src=x onerror=alert(1)>';
    vi.mocked(api.inbox).mockResolvedValue({
      ok: true,
      data: { items: [{ ...item, title, from: title }] },
    });
    mount();
    expect(await screen.findByText(`${title} · 11월 20일~21일 · 장소 5곳`)).toBeInTheDocument();
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull();
  });
  it('미리보기는 실제 공유 데이터를 읽어 흐름에 넣고 창을 닫아요', async () => {
    const doc = makeShareV2Doc();
    vi.mocked(api.item).mockResolvedValue({
      ok: true,
      data: { id: item.id, data: await encodeCompressedJson(doc) },
    });
    const { user, store, close } = mount();
    await screen.findByText('여행 도우미 · 오늘 오후 3:12');
    await user.click(preview());
    await waitFor(() =>
      expect(store.get(addFlowAtom)).toEqual({
        step: 'share',
        doc,
        inbox: { id: item.id, from: item.from, owner: api.owner },
      }),
    );
    expect(api.item).toHaveBeenCalledExactlyOnceWith(item.id);
    expect(close).toHaveBeenCalledOnce();
    expect(api.discard).not.toHaveBeenCalled();
  });
  it('공유 문서를 읽지 못하면 그 줄에 안내하고 버리기만 남겨요', async () => {
    vi.mocked(api.item).mockResolvedValue({ ok: true, data: { id: item.id, data: '!깨진 값' } });
    const { user, store } = mount();
    await screen.findByText('여행 도우미 · 오늘 오후 3:12');
    await user.click(preview());
    expect(await screen.findByText(SHARE_READ_MESSAGES.corrupt)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '「강릉 여행」 미리보기' })).toBeNull();
    expect(discard()).toBeEnabled();
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
  });
  it('버리기 확인을 취소하면 요청하지 않아요', async () => {
    const { user } = mount();
    await screen.findByText('여행 도우미 · 오늘 오후 3:12');
    await user.click(discard());
    await user.click(
      within(screen.getByRole('dialog', { name: '이 일정을 버릴까요?' })).getByRole('button', {
        name: '취소',
      }),
    );
    expect(api.discard).not.toHaveBeenCalled();
    await waitFor(() => expect(discard()).toBeEnabled());
  });
  it.each([true, false])('확인 뒤 성공 또는 이미 없는 항목을 목록에서 빼요(%s)', async (ok) => {
    vi.mocked(api.discard).mockResolvedValue(
      ok ? { ok: true, data: null } : { ok: false, reason: 'not-found' },
    );
    const { user } = mount();
    await confirmDiscard(user);
    expect(await screen.findByText('받은 일정이 없어요')).toBeInTheDocument();
    expect(api.discard).toHaveBeenCalledExactlyOnceWith(item.id);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'AI가 보낸 일정' })).toHaveFocus(),
    );
  });
  it('버리기 실패는 알리고 항목을 남겨요', async () => {
    vi.mocked(api.discard).mockResolvedValue({ ok: false, reason: 'offline' });
    const { user } = mount();
    await confirmDiscard(user);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('받은 일정을 버리지 못했어요'));
    expect(screen.getByText('강릉 여행 · 11월 20일~21일 · 장소 5곳')).toBeInTheDocument();
    await waitFor(() => expect(discard()).toHaveFocus());
  });
  it('빈 목록을 안내해요', async () => {
    vi.mocked(api.inbox).mockResolvedValue({ ok: true, data: { items: [] } });
    mount();
    expect(await screen.findByText('받은 일정이 없어요')).toBeInTheDocument();
  });
  it('API 설정이 없으면 사용할 수 없다고 안내해요', async () => {
    mocks.create.mockReturnValue(null);
    mount();
    expect(await screen.findByText('지금은 받은 일정을 볼 수 없어요')).toBeInTheDocument();
  });
  it('목록 실패 뒤 다시 시도할 수 있어요', async () => {
    vi.mocked(api.inbox).mockResolvedValueOnce({ ok: false, reason: 'offline' });
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('여행 도우미 · 오늘 오후 3:12')).toBeInTheDocument();
    expect(api.inbox).toHaveBeenCalledTimes(2);
  });
  it('항목이 이미 없으면 목록에서 빼고 안내해요', async () => {
    vi.mocked(api.item).mockResolvedValue({ ok: false, reason: 'not-found' });
    const { user } = mount();
    await screen.findByText('여행 도우미 · 오늘 오후 3:12');
    await user.click(preview());
    expect(await screen.findByText('받은 일정이 없어요')).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith('이미 없는 일정이에요');
  });
  it('항목 요청 실패는 줄 아래 안내하고 재시도할 수 있어요', async () => {
    vi.mocked(api.item).mockResolvedValue({ ok: false, reason: 'offline' });
    const { user } = mount();
    await screen.findByText('여행 도우미 · 오늘 오후 3:12');
    await user.click(preview());
    expect(
      await screen.findByText('받은 일정을 읽지 못했어요. 다시 시도해 주세요'),
    ).toBeInTheDocument();
    expect(preview()).toBeEnabled();
  });
  it('목록 응답 사이 계정이 바뀌면 닫고 응답을 버려요', async () => {
    const reply = deferred<Awaited<ReturnType<AgentApi['inbox']>>>();
    vi.mocked(api.inbox).mockReturnValue(reply.promise);
    const { close } = mount();
    await waitFor(() => expect(api.inbox).toHaveBeenCalledOnce());
    mocks.sameOwner.mockReturnValue(false);
    await act(async () => reply.resolve({ ok: true, data: { items: [item] } }));
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(OWNER_CHANGED);
    expect(screen.queryByText('여행 도우미 · 오늘 오후 3:12')).toBeNull();
  });
  it('항목 응답 사이 계정이 바뀌면 미리보기를 열지 않아요', async () => {
    const reply = deferred<Awaited<ReturnType<AgentApi['item']>>>();
    vi.mocked(api.item).mockReturnValue(reply.promise);
    const { user, store, close } = mount();
    await screen.findByText('여행 도우미 · 오늘 오후 3:12');
    await user.click(preview());
    mocks.sameOwner.mockReturnValue(false);
    await act(async () =>
      reply.resolve({
        ok: true,
        data: { id: item.id, data: await encodeCompressedJson(makeShareV2Doc()) },
      }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
  });
  it.each([SYNC_META_KEY, SYNC_SESSION_KEY, null])(
    'storage의 %s 변경으로 계정이 달라지면 닫아요',
    async (key) => {
      const { close } = mount();
      await screen.findByText('여행 도우미 · 오늘 오후 3:12');
      fireEvent(window, new StorageEvent('storage', { key }));
      expect(close).not.toHaveBeenCalled();
      mocks.sameOwner.mockReturnValue(false);
      fireEvent(window, new StorageEvent('storage', { key: '다른 키' }));
      expect(close).not.toHaveBeenCalled();
      fireEvent(window, new StorageEvent('storage', { key }));
      expect(close).toHaveBeenCalledOnce();
      expect(mocks.toast).toHaveBeenCalledWith(OWNER_CHANGED);
    },
  );
  it('확인 창을 연 뒤 계정이 달라지면 버리지 않아요', async () => {
    const { user, close } = mount();
    await screen.findByText('여행 도우미 · 오늘 오후 3:12');
    await user.click(discard());
    mocks.sameOwner.mockReturnValue(false);
    await user.click(
      within(screen.getByRole('dialog', { name: '이 일정을 버릴까요?' })).getByRole('button', {
        name: '버리기',
      }),
    );
    expect(api.discard).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it('닫은 창의 늦은 응답은 무시하고 storage 구독도 풀어요', async () => {
    const reply = deferred<Awaited<ReturnType<AgentApi['inbox']>>>();
    vi.mocked(api.inbox).mockReturnValue(reply.promise);
    const { unmount, close } = mount();
    await waitFor(() => expect(api.inbox).toHaveBeenCalledOnce());
    unmount();
    mocks.sameOwner.mockReturnValue(false);
    fireEvent(window, new StorageEvent('storage', { key: SYNC_META_KEY }));
    await act(async () => reply.resolve({ ok: true, data: { items: [item] } }));
    expect(close).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

it('Host는 atom이 false면 조각을 받지 않고 열 때만 받아요', async () => {
  const store = createStore();
  const user = userEvent.setup();
  render(
    <Provider store={store}>
      <AgentInboxHost />
    </Provider>,
  );
  expect(mocks.load).not.toHaveBeenCalled();
  act(() => store.set(agentInboxOpenAtom, true));
  await screen.findByText('여행 도우미 · 오늘 오후 3:12');
  expect(mocks.load).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: '닫기' }));
  expect(store.get(agentInboxOpenAtom)).toBe(false);
});
