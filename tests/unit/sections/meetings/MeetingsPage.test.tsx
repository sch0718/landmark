import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { MEET_ONLINE_KEY, removeOnline, writeOnline } from 'src/services/meet-online/store';
import { libraryAtom } from 'src/stores/library-state';
import { buildMeeting } from '../../../fixtures/builders';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (original) => ({
  ...(await original<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
vi.mock('src/sections/meetings/MeetingEditorPage', () => ({
  MeetingEditorPage: () => <h1>약속 편집</h1>,
}));
vi.mock('src/sections/meetings/MeetLinkPage', () => ({ MeetLinkPage: () => <h1>약속 링크</h1> }));
beforeEach(() => localStorage.removeItem(MEET_ONLINE_KEY));
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  toastMock.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const f = <T,>(value: T) => ({ value, updatedAt: '2026-10-03T00:00:00.000Z' });
const seeded = () => {
  const first = buildMeeting({
    id: 'meeting001',
    title: f('먼저 만든 약속'),
    decided: f('choice01'),
  });
  const last = buildMeeting({
    id: 'meeting002',
    title: f('최근 약속'),
    at: f({ date: '2026-10-31', time: '18:00' }),
    mode: f('car'),
    createdAt: '2026-10-04T00:00:00.000Z',
  });
  const deleted = buildMeeting({
    id: 'meeting003',
    title: f('지운 약속'),
    deletedAt: '2026-10-04T00:00:00.000Z',
  });
  return {
    ...sampleLibrary(),
    meetings: { [first.id]: first, [last.id]: last, [deleted.id]: deleted },
  };
};

describe('약속 목록', () => {
  it('약속과 온라인 기록 200개를 한 스냅숏으로 읽고 메뉴 렌더에서는 다시 읽지 않는다', async () => {
    const meetings = Array.from({ length: 200 }, (_, i) =>
      buildMeeting({ id: `m${String(i).padStart(9, '0')}`, title: f(`약속 ${i}`) }),
    );
    localStorage.setItem(
      MEET_ONLINE_KEY,
      JSON.stringify(Object.fromEntries(meetings.map(({ id }) => [id, { hostToken: 'host' }]))),
    );
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const onlineReads = () => getItem.mock.calls.filter(([key]) => key === MEET_ONLINE_KEY).length;
    await renderLibrary(
      { ...sampleLibrary(), meetings: Object.fromEntries(meetings.map((m) => [m.id, m])) },
      { path: '/meetings' },
    );
    const list = screen.getByRole('list', { name: '약속 목록' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(200);
    expect(within(list).getAllByText('공유 중')).toHaveLength(200);
    expect(onlineReads()).toBeGreaterThan(0);
    expect(onlineReads()).toBeLessThanOrEqual(2);
    const initialReads = onlineReads();
    await userEvent.click(screen.getByRole('button', { name: '‘약속 0’ 메뉴' }));
    expect(screen.getByRole('menuitem', { name: '삭제' })).toBeInTheDocument();
    expect(onlineReads()).toBe(initialReads);
  });
  it('같은 탭에서 온라인 기록을 쓰거나 지우면 공유 상태를 갱신한다', async () => {
    await renderLibrary(seeded(), { path: '/meetings' });
    expect(screen.queryByText('공유 중')).not.toBeInTheDocument();
    act(() => writeOnline('meeting001', { hostToken: 'host' }));
    expect(screen.getByText('공유 중')).toBeInTheDocument();
    act(() => writeOnline('meeting001', { ended: true }));
    expect(screen.queryByText('공유 중')).not.toBeInTheDocument();
    expect(screen.getByText('공유 끝남')).toBeInTheDocument();
    act(() => removeOnline('meeting001'));
    expect(screen.queryByText('공유 끝남')).not.toBeInTheDocument();
  });
  it('다른 탭의 기록 변경과 저장소 전체 삭제를 목록에 반영한다', async () => {
    await renderLibrary(seeded(), { path: '/meetings' });
    localStorage.setItem(MEET_ONLINE_KEY, JSON.stringify({ meeting002: { hostToken: 'host' } }));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: MEET_ONLINE_KEY })));
    expect(screen.getByText('공유 중')).toBeInTheDocument();
    localStorage.removeItem(MEET_ONLINE_KEY);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(screen.queryByText('공유 중')).not.toBeInTheDocument();
  });
  it('비어 있으면 안내와 새 약속 단추를 보인다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/meetings' });
    expect(screen.getByText('아직 약속이 없어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 약속' })).toBeInTheDocument();
  });
  it('살아 있는 약속을 최근 만든 순으로 보이고 카드 정보를 읽을 수 있다', async () => {
    await renderLibrary(seeded(), { path: '/meetings' });
    const list = screen.getByRole('list', { name: '약속 목록' });
    expect(
      within(list)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['최근 약속', '먼저 만든 약속']);
    expect(within(list).getByText('2026.10.31 18:00 · 자동차')).toBeInTheDocument();
    expect(within(list).getAllByText('참석자 1명 · 후보 1곳')).toHaveLength(2);
    expect(within(list).getByText('확정: 강남역')).toBeInTheDocument();
    expect(screen.queryByText('지운 약속')).not.toBeInTheDocument();
  });
  it('카드를 누르면 약속 편집 경로로 간다', async () => {
    const { router } = await renderLibrary(seeded(), { path: '/meetings' });
    await userEvent.click(screen.getByRole('link', { name: /최근 약속,/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/meeting002'));
  });
  it('삭제 확인 후 묘비를 남기고 8초 알림에서 되돌린다', async () => {
    const { store } = await renderLibrary(seeded(), { path: '/meetings' });
    await userEvent.click(screen.getByRole('button', { name: '‘최근 약속’ 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '약속 지우기' })).getByRole('button', {
        name: '삭제',
      }),
    );
    await waitFor(() =>
      expect(store.get(libraryAtom).meetings?.meeting002?.deletedAt).not.toBeNull(),
    );
    expect(screen.queryByText('최근 약속')).not.toBeInTheDocument();
    const options = toastMock.mock.calls[0]![1];
    expect(options.duration).toBe(8000);
    expect(options.action.label).toBe('되돌리기');
    await act(async () => {
      options.action.onClick();
    });
    expect(await screen.findByText('최근 약속')).toBeInTheDocument();
  });
});

describe('새 약속', () => {
  it('제목·선택 일시·이동수단을 저장하고 첫 참석자는 나로 만든다', async () => {
    const { store, router } = await renderLibrary(sampleLibrary(), {
      path: '/meetings',
      ids: ['meeting004', 'person01'],
    });
    await userEvent.click(screen.getByRole('button', { name: '새 약속' }));
    const dialog = screen.getByRole('dialog', { name: '새 약속' });
    expect(within(dialog).getByRole('button', { name: '만들기' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('약속 이름'), '  가을 모임  ');
    fireEvent.change(within(dialog).getByLabelText('날짜 (선택)'), {
      target: { value: '2026-10-31' },
    });
    fireEvent.change(within(dialog).getByLabelText('시각 (선택)'), { target: { value: '18:00' } });
    await userEvent.click(within(dialog).getByLabelText('직선거리'));
    await userEvent.click(within(dialog).getByRole('button', { name: '만들기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/meeting004'));
    const meeting = store.get(libraryAtom).meetings?.meeting004;
    expect(meeting?.title.value).toBe('가을 모임');
    expect(meeting?.at.value).toEqual({ date: '2026-10-31', time: '18:00' });
    expect(meeting?.mode.value).toBe('straight');
    expect(meeting?.participants.value).toEqual([{ id: 'person01', name: '나', origin: null }]);
  });
  it('제목 61자와 날짜·시각 중 하나만 넣은 입력을 막는다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/meetings' });
    await userEvent.click(screen.getByRole('button', { name: '새 약속' }));
    const dialog = screen.getByRole('dialog', { name: '새 약속' });
    const title = within(dialog).getByLabelText('약속 이름');
    fireEvent.change(title, { target: { value: '가'.repeat(61) } });
    expect(within(dialog).getByText('약속 이름은 60자까지예요')).toBeInTheDocument();
    fireEvent.change(title, { target: { value: '모임' } });
    fireEvent.change(within(dialog).getByLabelText('날짜 (선택)'), {
      target: { value: '2026-10-31' },
    });
    expect(within(dialog).getByRole('button', { name: '만들기' })).toBeDisabled();
    expect(within(dialog).getByText('날짜와 시각을 함께 넣어 주세요')).toBeInTheDocument();
  });
  it('일시를 비워도 만들 수 있고 대중교통을 기본으로 쓴다', async () => {
    const { store } = await renderLibrary(sampleLibrary(), {
      path: '/meetings',
      ids: ['meeting004', 'person01'],
    });
    await userEvent.click(screen.getByRole('button', { name: '새 약속' }));
    const dialog = screen.getByRole('dialog', { name: '새 약속' });
    await userEvent.type(within(dialog).getByLabelText('약속 이름'), '다음 모임');
    await userEvent.click(within(dialog).getByRole('button', { name: '만들기' }));
    await waitFor(() => expect(store.get(libraryAtom).meetings?.meeting004).toBeDefined());
    expect(store.get(libraryAtom).meetings?.meeting004?.at.value).toBeNull();
    expect(store.get(libraryAtom).meetings?.meeting004?.mode.value).toBe('transit');
  });
});
