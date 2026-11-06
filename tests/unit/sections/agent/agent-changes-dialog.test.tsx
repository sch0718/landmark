import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentChangesDialog } from 'src/sections/agent/AgentChangesDialog';
import { SYNC_META_KEY } from 'src/services/library-sync/storage';
import type { AgentApi, AgentChangeView } from 'src/services/agent-inbox/api';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sameOwner: vi.fn(),
  toast: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock('src/services/agent-inbox/api', () => ({
  createAgentApi: mocks.create,
  sameOwner: mocks.sameOwner,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('src/services/library-sync/boot', () => ({
  loadSyncEngine: () =>
    Promise.resolve({ ensureLibrarySyncEngine: () => ({ schedule: mocks.schedule }) }),
}));

const now = new Date(2026, 10, 20, 16);
const change = (id: string, over: Partial<AgentChangeView> = {}): AgentChangeView => ({
  id,
  tokenId: 't1',
  tokenName: '여행 도우미',
  requestId: 'req-1',
  kind: 'place',
  itemId: 'item-' + id,
  beforeRev: 1,
  afterRev: 2,
  label: '안목 카페',
  at: new Date(2026, 10, 20, 15, 12).getTime(),
  undoneAt: null,
  ...over,
});
let api: AgentApi;
let rows: AgentChangeView[];
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
  rows = [change('c1'), change('c2', { kind: 'trip', label: '강릉 여행' })];
  api = {
    owner: 'owner-a',
    tokens: vi.fn(),
    issue: vi.fn(),
    revoke: vi.fn(),
    inbox: vi.fn(),
    item: vi.fn(),
    discard: vi.fn(),
    changes: vi
      .fn()
      .mockImplementation(() => Promise.resolve({ ok: true, data: { changes: rows } })),
    undo: vi.fn(),
  };
  mocks.create.mockReturnValue(api);
  mocks.sameOwner.mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());
function mount() {
  const close = vi.fn();
  render(<AgentChangesDialog open onClose={close} />);
  return { close, user: userEvent.setup() };
}

describe('AI 변경 기록 창', () => {
  it('종류·이름·시각·토큰 이름과 제약 문구를 보여요', async () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'AI 변경 기록' })).toBeInTheDocument();
    expect(await screen.findByText('장소 · 안목 카페')).toBeInTheDocument();
    expect(screen.getByText('여행 · 강릉 여행')).toBeInTheDocument();
    expect(screen.getAllByText('여행 도우미 · 오늘 오후 3:12')).toHaveLength(2);
    expect(screen.getByText('같은 항목은 가장 최근 변경만 되돌릴 수 있어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '「안목 카페」 되돌리기' })).toHaveStyle({
      minHeight: '44px',
    });
  });
  it('기록이 없으면 안내해요', async () => {
    rows = [];
    mount();
    expect(await screen.findByText('AI 변경 기록이 없어요')).toBeInTheDocument();
  });
  it('되돌린 변경은 표시하고 단추를 막아요', async () => {
    rows = [change('c1', { undoneAt: 5 })];
    mount();
    expect(await screen.findByText('여행 도우미 · 오늘 오후 3:12 · 되돌림')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '「안목 카페」 되돌리기' })).toBeDisabled();
  });
  it('항목을 되돌린 뒤 기록을 다시 읽고 동기화를 한 번 불러요', async () => {
    vi.mocked(api.undo).mockImplementation(() => {
      rows = [change('c1', { undoneAt: 9 }), rows[1]!];
      return Promise.resolve({
        ok: true,
        data: { results: [{ id: 'c1', status: 'undone' }] },
      } as never);
    });
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: '「안목 카페」 되돌리기' }));
    expect(api.undo).toHaveBeenCalledExactlyOnceWith({ ids: ['c1'] });
    await screen.findByText('여행 도우미 · 오늘 오후 3:12 · 되돌림');
    expect(api.changes).toHaveBeenCalledTimes(2);
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('manual');
  });
  it('같은 요청 묶음은 requestId로 한 번에 되돌려요', async () => {
    rows = [change('c1'), change('c2'), change('c3', { requestId: 'req-2' })];
    vi.mocked(api.undo).mockResolvedValue({ ok: true, data: { results: [] } });
    const { user } = mount();
    const buttons = await screen.findAllByRole('button', { name: /모두 되돌리기/ });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]!);
    expect(api.undo).toHaveBeenCalledExactlyOnceWith({ requestId: 'req-1' });
    await waitFor(() => expect(mocks.schedule).toHaveBeenCalledOnce());
  });
  it('changed와 gone은 항목 옆에 사유를 알려요', async () => {
    vi.mocked(api.undo).mockResolvedValue({
      ok: true,
      data: {
        results: [
          { id: 'c1', status: 'changed' },
          { id: 'c2', status: 'gone' },
        ],
      },
    });
    rows = [change('c1'), change('c2')];
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: /^모두 되돌리기/ }));
    const note = await screen.findByText('그 사이 바뀌어서 그대로 뒀어요');
    expect(note.closest('li')).toHaveTextContent('안목 카페');
    expect(screen.getByText('기록이 만료돼 되돌릴 수 없어요')).toBeInTheDocument();
  });
  it('되돌리기가 실패하면 알리고 동기화는 부르지 않아요', async () => {
    vi.mocked(api.undo).mockResolvedValue({ ok: false, reason: 'server' });
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: '「안목 카페」 되돌리기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('되돌리지 못했어요');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('기록을 읽지 못하면 다시 시도할 수 있어요', async () => {
    vi.mocked(api.changes).mockResolvedValueOnce({ ok: false, reason: 'server' });
    const { user } = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('변경 기록을 불러오지 못했어요');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('장소 · 안목 카페')).toBeInTheDocument();
  });
  it('닫기 단추가 onClose를 불러요', async () => {
    const { user, close } = mount();
    await screen.findByText('장소 · 안목 카페');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('응답이 돌아온 뒤 계정이 달라졌으면 기록을 버리고 창을 닫아요', async () => {
    let resolve!: (value: never) => void;
    vi.mocked(api.changes).mockImplementation(
      () => new Promise((r) => (resolve = r as never)) as ReturnType<AgentApi['changes']>,
    );
    const { close } = mount();
    await waitFor(() => expect(api.changes).toHaveBeenCalled());
    mocks.sameOwner.mockReturnValue(false);
    resolve({ ok: true, data: { changes: rows } } as never);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(screen.queryByText('장소 · 안목 카페')).toBeNull();
  });
  it('인증 저장소가 바뀌어 계정이 달라지면 기록을 비우고 창을 닫아요', async () => {
    const { close } = mount();
    await screen.findByText('장소 · 안목 카페');
    mocks.sameOwner.mockReturnValue(false);
    fireEvent(window, new StorageEvent('storage', { key: SYNC_META_KEY }));
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByText('장소 · 안목 카페')).toBeNull();
  });
  it('되돌리는 중에 창이 닫혀도 성공하면 동기화를 한 번 예약해요', async () => {
    let resolve!: (value: never) => void;
    vi.mocked(api.undo).mockImplementation(
      () => new Promise((r) => (resolve = r as never)) as ReturnType<AgentApi['undo']>,
    );
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: '「안목 카페」 되돌리기' }));
    cleanup();
    resolve({ ok: true, data: { results: [{ id: 'c1', status: 'undone' }] } } as never);
    await waitFor(() => expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('manual'));
  });
  it('되돌리는 중에 창이 닫히고 계정도 달라지면 동기화하지 않아요', async () => {
    let resolve!: (value: never) => void;
    vi.mocked(api.undo).mockImplementation(
      () => new Promise((r) => (resolve = r as never)) as ReturnType<AgentApi['undo']>,
    );
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: '「안목 카페」 되돌리기' }));
    cleanup();
    mocks.sameOwner.mockReturnValue(false);
    resolve({ ok: true, data: { results: [] } } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('모두 되돌리기 단추는 묶음마다 시각과 건수로 구분돼요', async () => {
    rows = [
      change('c1'),
      change('c2'),
      change('c3', { requestId: 'req-2', at: new Date(2026, 10, 20, 14, 5).getTime() }),
      change('c4', { requestId: 'req-2', at: new Date(2026, 10, 20, 14, 5).getTime() }),
      change('c5', { requestId: 'req-2', at: new Date(2026, 10, 20, 14, 5).getTime() }),
    ];
    mount();
    expect(
      await screen.findByRole('button', {
        name: '모두 되돌리기 — 여행 도우미 · 오늘 오후 3:12 · 2건',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '모두 되돌리기 — 여행 도우미 · 오늘 오후 2:05 · 3건' }),
    ).toBeInTheDocument();
  });
});
