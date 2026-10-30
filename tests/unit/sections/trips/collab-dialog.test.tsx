import { CollabDialogHost } from 'src/sections/trips/collab/CollabDialogHost';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripCollabDialog } from 'src/sections/trips/collab/TripCollabDialog';
import { LiveShareEntry } from 'src/sections/trips/live/LiveShareEntry';
import { enableCollabAsOwner } from 'src/sections/trips/collab/owner-join';
import { tripCollabApi } from 'src/services/trip-collab/client';
import { tripCollabStore } from 'src/services/trip-collab/store';
import { tripLiveStore } from 'src/services/trip-live/store';
import { libraryAtom } from 'src/stores/library-state';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
vi.mock('src/services/trip-collab/client', async (original) => ({
  ...(await original<typeof import('src/services/trip-collab/client')>()),
  tripCollabApi: {
    createInvite: vi.fn(),
    members: vi.fn(),
    removeMember: vi.fn(),
    cancelInvite: vi.fn(),
    state: vi.fn(),
  },
}));
vi.mock('src/sections/trips/collab/owner-join', () => ({ enableCollabAsOwner: vi.fn() }));
vi.mock('src/sections/trips/collab/use-trip-collab', async () => {
  const { useTripCollabRecord } = await import('src/services/trip-collab/store');
  return {
    useCollabDeps: () => ({}),
    useTripCollab: (id: string) => ({ record: useTripCollabRecord(id), members: 2, engine: null }),
  };
});
vi.mock('src/sections/share-export/kakao', () => ({
  useKakao: () => ({ enabled: false }),
  kakaoUrlFits: () => true,
}));
vi.mock('src/stores/library-state', async (original) => {
  const m = await original<typeof import('src/stores/library-state')>(),
    { useStore } = await import('jotai');
  return {
    ...m,
    useLibraryAction: () => {
      const store = useStore();
      let n = 0;
      return {
        run: async (op: (...args: unknown[]) => unknown) => {
          const r = op(store.get(m.libraryAtom), {
            now: '2026-11-01T00:00:00.000Z',
            newId: (kind: string) =>
              `${kind === 'stop' ? 's' : 'p'}${String(++n).padStart(kind === 'stop' ? 7 : 9, '0')}`,
          }) as { ok: boolean; lib: ReturnType<typeof buildLiveLibrary> };
          if (r.ok) store.set(m.libraryAtom, r.lib);
          return r;
        },
      };
    },
  };
});
vi.mock('src/routes/lazy-routes', async () => ({
  ...(await import('src/sections/trips/collab/TripCollabDialog')),
  TripLiveShareDialog: () => null,
  CollabConflictDialog: () => null,
}));
const owner = () =>
  tripLiveStore.put({
    tripId: 'trip000001',
    liveId: 'abcdefghij',
    status: 'live',
    ownerToken: 'o'.repeat(43),
    viewToken: 'v'.repeat(43),
    rev: 1,
    dayIds: ['day00001', 'day00002'],
    options: { title: '여행', includeMemo: false, includeCandidates: true },
    createdAt: '2026-11-01T00:00:00.000Z',
  });
const editor = () =>
  tripCollabStore.put({
    tripId: 'trip000001',
    liveId: 'abcdefghij',
    role: 'editor',
    token: 'e'.repeat(43),
    deviceId: 'device01',
    label: '내 폰',
    status: 'live',
    rev: 2,
    prev: 0,
    dayIds: ['day00001', 'day00002'],
    placeMap: {},
    syncedAt: new Date().toISOString(),
    title: '여행',
    pendingProgress: [],
  });
function mount(entry = false) {
  const store = createStore();
  store.set(libraryAtom, buildLiveLibrary());
  const close = vi.fn();
  render(
    <Provider store={store}>
      <MemoryRouter>
        {entry ? (
          <LiveShareEntry tripId="trip000001" />
        ) : (
          <TripCollabDialog open tripId="trip000001" onClose={close} onOpenLiveShare={vi.fn()} />
        )}
      </MemoryRouter>
    </Provider>,
  );
  return { store, close };
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(enableCollabAsOwner).mockResolvedValue({ ok: true });
  vi.mocked(tripCollabApi.createInvite).mockResolvedValue({
    ok: true,
    value: { key: 'a'.repeat(16), expiresAt: '2026-11-08', created: true },
  });
  vi.mocked(tripCollabApi.members).mockResolvedValue({
    ok: true,
    value: { devices: [], invites: [] },
  });
  vi.mocked(tripCollabApi.removeMember).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(tripCollabApi.cancelInvite).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(tripCollabApi.state).mockResolvedValue({
    ok: true,
    value: {
      rev: 2,
      updatedAt: '2026-11-01',
      expiresAt: '2026-12-31',
      role: 'editor',
      deviceId: 'device01',
      members: 2,
      editedBy: null,
      doc: buildLiveDoc(),
    },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
describe('함께 편집 창', () => {
  it('갱신 링크가 없으면 만들기 안내를 보인다', () => {
    mount();
    expect(screen.getByText('함께 편집하려면 먼저 갱신 링크를 만들어야 해요')).toBeVisible();
    expect(screen.getByRole('button', { name: '갱신 링크 만들기…' })).toBeVisible();
  });
  it('첫 초대를 켠 뒤 만들고 초대 링크를 복사한다', async () => {
    owner();
    mount();
    await userEvent.click(screen.getByRole('button', { name: '편집 초대 링크 만들기' }));
    expect(enableCollabAsOwner).toHaveBeenCalledOnce();
    const link = await screen.findByRole('textbox', { name: '편집 초대 링크' });
    expect((link as HTMLInputElement).value).toMatch(
      /\/trips\/join\/abcdefghij#i=[A-Za-z0-9_-]{43}$/,
    );
    await userEvent.click(screen.getByRole('button', { name: '링크 복사' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith((link as HTMLInputElement).value);
  });
  it('응답 유실 뒤에는 같은 초대 토큰으로 재시도한다', async () => {
    owner();
    vi.mocked(tripCollabApi.createInvite).mockResolvedValueOnce({ ok: false, error: 'offline' });
    mount();
    await userEvent.click(screen.getByRole('button', { name: '편집 초대 링크 만들기' }));
    await screen.findByText('인터넷 연결을 확인해 주세요');
    const first = vi.mocked(tripCollabApi.createInvite).mock.calls[0]![2].token;
    await userEvent.click(screen.getByRole('button', { name: '편집 초대 링크 만들기' }));
    await screen.findByRole('textbox', { name: '편집 초대 링크' });
    expect(vi.mocked(tripCollabApi.createInvite).mock.calls[1]![2].token).toBe(first);
  });
  it('기기 거두기 확인과 초대 취소를 요청한다', async () => {
    owner();
    vi.mocked(tripCollabApi.members).mockResolvedValue({
      ok: true,
      value: {
        devices: [
          {
            deviceId: 'device01',
            label: '민지 폰',
            createdAt: new Date().toISOString(),
            seenAt: new Date().toISOString(),
          },
        ],
        invites: [
          {
            key: 'a'.repeat(16),
            label: '민지',
            createdAt: new Date().toISOString(),
            expiresAt: '2026-11-08',
          },
        ],
      },
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: '편집 권한 거두기' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: /기기의 편집 권한을 거둘까요/ })).getByRole(
        'button',
        { name: '거두기' },
      ),
    );
    expect(tripCollabApi.removeMember).toHaveBeenCalledWith(
      'abcdefghij',
      'o'.repeat(43),
      'device01',
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '초대 취소' }, { timeout: 5000 }),
    );
    expect(tripCollabApi.cancelInvite).toHaveBeenCalledWith(
      'abcdefghij',
      'o'.repeat(43),
      'a'.repeat(16),
    );
  });
  it('편집 기기는 확인 뒤 그만두고 연결 기록을 지운다', async () => {
    editor();
    const { close } = mount();
    await userEvent.click(screen.getByRole('button', { name: '편집 그만두기' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '이 기기에서 함께 편집을 그만둘까요?' })).getByRole(
        'button',
        { name: '그만두기' },
      ),
    );
    await waitFor(() => expect(tripCollabStore.get('trip000001')).toBeUndefined());
    expect(tripCollabApi.removeMember).toHaveBeenCalledWith('abcdefghij', 'e'.repeat(43), 'me');
    expect(close).toHaveBeenCalled();
  });
  it('공동 여행을 연결 없는 새 여행으로 따로 저장한다', async () => {
    editor();
    const { store } = mount();
    await userEvent.click(screen.getByRole('button', { name: '내 여행으로 따로 저장' }));
    await waitFor(() => expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(2));
    expect(tripCollabStore.list()).toHaveLength(1);
  });
  it.each([
    ['switched-off', '지금은 편집 초대를 만들 수 없어요'],
    ['full', '기다리는 초대가 많아요. 쓰지 않는 초대를 취소해 주세요'],
  ] as const)('%s 안내를 보인다', async (error, message) => {
    owner();
    vi.mocked(tripCollabApi.createInvite).mockResolvedValue({ ok: false, error });
    mount();
    await userEvent.click(screen.getByRole('button', { name: '편집 초대 링크 만들기' }));
    expect(await screen.findByText(message)).toBeVisible();
  });
  it('편집 기기의 일정 공유 입구는 갱신 링크 만들기를 숨긴다', () => {
    editor();
    mount(true);
    expect(
      screen.getByText('함께 편집 중인 여행의 갱신 링크는 만든 사람이 관리해요'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: '갱신 링크…' })).not.toBeInTheDocument();
  });
});

it('다른 여행 창으로 바꾸면 이전 여행의 초대 링크를 버린다', async () => {
  owner();
  tripLiveStore.put({
    ...tripLiveStore.get('trip000001')!,
    tripId: 'trip000002',
    liveId: 'newshare00',
  });
  const store = createStore();
  store.set(libraryAtom, buildLiveLibrary());
  const ui = (tripId: string) => (
    <Provider store={store}>
      <MemoryRouter>
        <CollabDialogHost open tripId={tripId} onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>
  );
  const { rerender } = render(ui('trip000001'));
  await userEvent.click(await screen.findByRole('button', { name: '편집 초대 링크 만들기' }));
  await screen.findByRole('textbox', { name: '편집 초대 링크' });
  rerender(ui('trip000002'));
  expect(screen.queryByRole('textbox', { name: '편집 초대 링크' })).not.toBeInTheDocument();
});
it('그만두기 요청이 오프라인이면 접근 가능한 오류를 보이고 연결은 남긴다', async () => {
  editor();
  vi.mocked(tripCollabApi.removeMember).mockResolvedValue({ ok: false, error: 'offline' });
  mount();
  await userEvent.click(screen.getByRole('button', { name: '편집 그만두기' }));
  await userEvent.click(
    within(screen.getByRole('dialog', { name: '이 기기에서 함께 편집을 그만둘까요?' })).getByRole(
      'button',
      { name: '그만두기' },
    ),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '인터넷 연결을 확인하고 다시 해 주세요',
  );
  expect(tripCollabStore.get('trip000001')?.status).toBe('live');
});
