import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TripCollabJoinPage } from 'src/sections/trips/collab/TripCollabJoinPage';
import { tripCollabApi } from 'src/services/trip-collab/client';
import { tripCollabStore } from 'src/services/trip-collab/store';
import { libraryAtom } from 'src/stores/library-state';
import { emptyLibrary } from 'src/schema/library';
import { buildLiveDoc } from '../../../fixtures/live-trip';
import { buildLiveLibrary } from '../../../fixtures/builders';
vi.mock('src/services/trip-collab/client', async (original) => ({
  ...(await original<typeof import('src/services/trip-collab/client')>()),
  tripCollabApi: { previewInvite: vi.fn(), accept: vi.fn(), state: vi.fn() },
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
            newId: () => `p${String(++n).padStart(9, '0')}`,
          }) as { ok: boolean; lib: ReturnType<typeof emptyLibrary> };
          if (r.ok) store.set(m.libraryAtom, r.lib);
          return r;
        },
      };
    },
  };
});
const id = 'abcdefghij',
  invite = 'i'.repeat(43);
const doc = () => ({ ...buildLiveDoc(), v: 2 as const });
const state = () => ({
  rev: 2,
  updatedAt: '2026-11-01',
  expiresAt: '2026-12-31',
  role: 'editor' as const,
  deviceId: 'device01',
  members: 1,
  editedBy: null,
  doc: doc(),
  progress: { prev: 0, marks: [], next: null },
});
function Destination() {
  return <p>{useLocation().pathname}</p>;
}
function mount(lib = emptyLibrary()) {
  const store = createStore();
  store.set(libraryAtom, lib);
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/trips/join/${id}`]}>
        <Routes>
          <Route path="/trips/join/:id" element={<TripCollabJoinPage />} />
          <Route path="*" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return store;
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  history.replaceState(null, '', `/trips/join/${id}#i=${invite}`);
  vi.mocked(tripCollabApi.previewInvite).mockResolvedValue({
    ok: true,
    value: {
      title: '시험 여행',
      startDate: '2026-12-09',
      endDate: '2026-12-10',
      expiresAt: '2026-11-08',
    },
  });
  vi.mocked(tripCollabApi.accept).mockResolvedValue({
    ok: true,
    value: { deviceId: 'device01', rev: 2 },
  });
  vi.mocked(tripCollabApi.state).mockResolvedValue({ ok: true, value: state() });
});
afterEach(() => history.replaceState(null, '', '/'));
describe('편집 초대 수락 화면', () => {
  it('해시를 지우고 미리보기·기본 기기 이름을 보인다', async () => {
    mount();
    expect(await screen.findByText('시험 여행')).toBeVisible();
    expect(location.hash).toBe('');
    expect(screen.getByText('12.09(수) ~ 12.10(목) · 1박 2일')).toBeVisible();
    expect(screen.getByRole('textbox', { name: '이 기기 이름' })).toHaveValue('내 컴퓨터');
    expect(screen.getByText(/암호화하지 않고 저장돼요/)).toBeVisible();
  });
  it('수락 뒤 서버 Stop id와 연결 기록·기준이 있는 새 여행으로 간다', async () => {
    const store = mount();
    await userEvent.click(await screen.findByRole('button', { name: '수락하고 함께 편집하기' }));
    await waitFor(() => expect(tripCollabStore.byLiveId(id)?.role).toBe('editor'));
    const record = tripCollabStore.byLiveId(id)!;
    expect(screen.getByText(`/trips/${record.tripId}`)).toBeVisible();
    expect(
      store.get(libraryAtom).trips[record.tripId]!.days.map((d) => d.stops.value.map((s) => s.id)),
    ).toEqual(doc().ids.stops);
    expect(tripCollabStore.readBase(id)?.rev).toBe(2);
  });
  it('수락 응답 유실 뒤에도 같은 기기 토큰으로 재시도한다', async () => {
    vi.mocked(tripCollabApi.accept).mockResolvedValueOnce({ ok: false, error: 'offline' });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: '수락하고 함께 편집하기' }));
    await screen.findByText('인터넷 연결을 확인하고 다시 해 주세요');
    const first = vi.mocked(tripCollabApi.accept).mock.calls[0]![2].deviceToken;
    await userEvent.click(screen.getByRole('button', { name: '수락하고 함께 편집하기' }));
    await waitFor(() => expect(tripCollabApi.accept).toHaveBeenCalledTimes(2));
    expect(vi.mocked(tripCollabApi.accept).mock.calls[1]![2].deviceToken).toBe(first);
  });
  it('이미 참여한 여행이면 초대를 쓰지 않고 그 여행으로 간다', async () => {
    tripCollabStore.put({
      tripId: 'trip000001',
      liveId: id,
      role: 'editor',
      token: 'e'.repeat(43),
      deviceId: 'device01',
      label: '내 폰',
      status: 'live',
      rev: 2,
      prev: 0,
      dayIds: doc().ids.days,
      placeMap: {},
      syncedAt: new Date().toISOString(),
      title: '여행',
      pendingProgress: [],
    });
    mount(buildLiveLibrary());
    expect(await screen.findByText('/trips/trip000001')).toBeVisible();
    expect(tripCollabApi.accept).not.toHaveBeenCalled();
    expect(tripCollabApi.previewInvite).not.toHaveBeenCalled();
  });
  it('기기 이름이 비면 입력 오류이고 수락하지 않는다', async () => {
    mount();
    const input = await screen.findByRole('textbox', { name: '이 기기 이름' });
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: '수락하고 함께 편집하기' }));
    expect(screen.getByText('1~30자로 입력하세요')).toBeVisible();
    expect(tripCollabApi.accept).not.toHaveBeenCalled();
  });
  it('이미 쓴 초대 안내와 오프라인 다시 시도를 보인다', async () => {
    vi.mocked(tripCollabApi.previewInvite)
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce({ ok: false, error: 'invite' });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: '다시 시도' }));
    expect(
      await screen.findByText(
        '이미 쓴 초대이거나 닫힌 초대예요. 보낸 사람에게 새 초대 링크를 받아 주세요',
      ),
    ).toBeVisible();
  });
  it('수락 기기 수를 넘으면 안내한다', async () => {
    vi.mocked(tripCollabApi.accept).mockResolvedValue({ ok: false, error: 'full' });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: '수락하고 함께 편집하기' }));
    expect(await screen.findByText('함께 고칠 수 있는 기기 수(20대)를 넘었어요')).toBeVisible();
  });
});
it('수락 뒤 받기에 실패하면 새로 고침 대신 재시도와 기기 거두기 방법을 알린다', async () => {
  vi.mocked(tripCollabApi.state).mockResolvedValueOnce({ ok: false, error: 'offline' });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: '수락하고 함께 편집하기' }));
  expect(await screen.findByText(/새로 고쳤다면.*이 기기의 권한을 거두고 새 초대/)).toBeVisible();
  const token = vi.mocked(tripCollabApi.accept).mock.calls[0]![2].deviceToken;
  await userEvent.click(screen.getByRole('button', { name: '수락하고 함께 편집하기' }));
  await waitFor(() => expect(tripCollabStore.byLiveId(id)?.token).toBe(token));
});

it('수락 뒤 보관함 반영 실패에도 새로 고침 복구 방법을 안내하고 재시도한다', async () => {
  const apply = await import('src/domain/trip-collab/apply');
  const spy = vi
    .spyOn(apply, 'importCollabTrip')
    .mockReturnValueOnce({ ok: false, error: { _tag: 'NotFound', id: 'missing000' } });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: '수락하고 함께 편집하기' }));
  expect(await screen.findByText(/새로 고쳤다면.*이 기기의 권한을 거두고 새 초대/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '수락하고 함께 편집하기' }));
  await waitFor(() => expect(tripCollabStore.byLiveId(id)).toBeDefined());
  spy.mockRestore();
});
