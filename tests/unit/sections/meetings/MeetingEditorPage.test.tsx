import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { libraryAtom } from 'src/stores/library-state';
import type { Participant } from 'src/schema/meeting';
import { buildMeeting } from '../../../fixtures/builders';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
vi.mock('src/sections/meetings/MeetingResults', () => ({
  MeetingResults: () => <section aria-label="약속 결과">중간 지점 결과</section>,
}));
vi.mock('src/components/map/MapView', () => ({ MapView: () => <div data-testid="meeting-map" /> }));
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});
const f = <T,>(value: T) => ({ value, updatedAt: '2026-10-23T00:00:00.000Z' });
const seed = (participants?: Participant[]) => {
  const meeting = buildMeeting(participants ? { participants: f(participants) } : {});
  return { ...sampleLibrary(), meetings: { [meeting.id]: meeting } };
};
const renderMeeting = (library = seed()) =>
  renderLibrary(library, { path: '/meetings/meeting001', ids: ['person02'] });
describe('약속 편집과 참석자', () => {
  it('기본 정보와 참석자·지도·결과를 보인다', async () => {
    await renderMeeting();
    expect(screen.getByRole('heading', { level: 1, name: '친구 모임' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '참석자' })).toBeInTheDocument();
    expect(screen.getByTestId('meeting-map')).toBeInTheDocument();
    expect(screen.getByText('출발지 없음')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '약속 결과' })).toBeInTheDocument();
  });
  it.each(['없음', '삭제됨'])('%s 약속이면 목록으로 돌아갈 안내를 보인다', async (state) => {
    const lib =
      state === '없음'
        ? sampleLibrary()
        : {
            ...sampleLibrary(),
            meetings: { meeting001: buildMeeting({ deletedAt: '2026-10-24T00:00:00.000Z' }) },
          };
    await renderLibrary(lib, { path: '/meetings/meeting001' });
    expect(screen.getByRole('alert')).toHaveTextContent('약속을 찾지 못했어요');
    expect(screen.getByRole('link', { name: '약속 목록으로' })).toHaveAttribute(
      'href',
      '/meetings',
    );
  });
  it('기본 정보를 고치면 같은 약속에 저장한다', async () => {
    const { store } = await renderMeeting();
    await userEvent.click(screen.getByRole('button', { name: '기본 정보 고치기' }));
    const dialog = screen.getByRole('dialog', { name: '약속 고치기' });
    fireEvent.change(within(dialog).getByLabelText('약속 이름'), {
      target: { value: '금요일 모임' },
    });
    await userEvent.click(within(dialog).getByLabelText('직선거리'));
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(store.get(libraryAtom).meetings?.meeting001?.title.value).toBe('금요일 모임'),
    );
    expect(store.get(libraryAtom).meetings?.meeting001?.mode.value).toBe('straight');
  });
  it('이름 필수·20자 제한을 확인하고 참석자를 추가한다', async () => {
    const { store } = await renderMeeting();
    await userEvent.click(screen.getByRole('button', { name: '참석자 추가' }));
    const dialog = screen.getByRole('dialog', { name: '참석자 추가' });
    const input = within(dialog).getByRole('textbox', { name: '참석자 이름' });
    expect(within(dialog).getByRole('button', { name: '추가' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '가'.repeat(21) } });
    expect(within(dialog).getByRole('button', { name: '추가' })).toBeDisabled();
    fireEvent.change(input, { target: { value: ' 민지 ' } });
    await userEvent.click(within(dialog).getByRole('button', { name: '추가' }));
    await waitFor(() =>
      expect(store.get(libraryAtom).meetings?.meeting001?.participants.value).toHaveLength(2),
    );
    expect(store.get(libraryAtom).meetings?.meeting001?.participants.value[1]).toMatchObject({
      name: '민지',
      origin: null,
    });
  });
  it('주최자 이름은 수정할 수 있고 친구 삭제는 확인 뒤 반영한다', async () => {
    const { store } = await renderMeeting(
      seed([
        { id: 'person01', name: '나', origin: null },
        { id: 'person02', name: '친구', origin: null },
      ]),
    );
    await userEvent.click(screen.getByRole('button', { name: '나 이름 고치기' }));
    const rename = screen.getByRole('dialog', { name: '참석자 이름 고치기' });
    fireEvent.change(within(rename).getByRole('textbox', { name: '참석자 이름' }), {
      target: { value: '주최자' },
    });
    await userEvent.click(within(rename).getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(store.get(libraryAtom).meetings?.meeting001?.participants.value[0]?.name).toBe(
        '주최자',
      ),
    );
    expect(screen.queryByRole('button', { name: '주최자 삭제' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '친구 삭제' }));
    expect(store.get(libraryAtom).meetings?.meeting001?.participants.value).toHaveLength(2);
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '참석자 지우기' })).getByRole('button', {
        name: '취소',
      }),
    );
    expect(store.get(libraryAtom).meetings?.meeting001?.participants.value).toHaveLength(2);
    await userEvent.click(await screen.findByRole('button', { name: '친구 삭제' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '참석자 지우기' })).getByRole('button', {
        name: '삭제',
      }),
    );
    await waitFor(() =>
      expect(store.get(libraryAtom).meetings?.meeting001?.participants.value).toHaveLength(1),
    );
    expect(store.get(libraryAtom).meetings?.meeting001?.participants.value[0]).toMatchObject({
      id: 'person01',
      name: '주최자',
    });
  });
  it('10명이면 참석자 추가를 막는다', async () => {
    await renderMeeting(
      seed(
        Array.from({ length: 10 }, (_, i) => ({
          id: `person${String(i).padStart(2, '0')}`,
          name: `친구 ${i}`,
          origin: null,
        })),
      ),
    );
    expect(screen.getByRole('button', { name: '참석자 추가' })).toBeDisabled();
    expect(screen.getByText('참석자는 10명까지예요')).toBeInTheDocument();
  });
  it('보관함에서 고른 출발지를 참석자에 저장한다', async () => {
    const { store } = await renderMeeting();
    await userEvent.click(screen.getByRole('button', { name: '나 출발지 고르기' }));
    const dialog = screen.getByRole('dialog', { name: '출발지 고르기' });
    await userEvent.click(within(dialog).getByRole('tab', { name: '보관함에서' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /강남 한 곳/ }));
    await waitFor(() =>
      expect(
        store.get(libraryAtom).meetings?.meeting001?.participants.value[0]?.origin,
      ).toMatchObject({ name: '강남 한 곳', placeId: 'place00004' }),
    );
  });
  it('답장 받은 시각을 표시한다', async () => {
    const lib = seed();
    lib.meetings.meeting001 = {
      ...lib.meetings.meeting001!,
      replies: f({
        person01: {
          likes: [],
          sentAt: '2026-10-23T00:00:00.000Z',
          receivedAt: '2026-10-23T01:00:00.000Z',
        },
      }),
    };
    await renderMeeting(lib);
    expect(screen.getByText(/답장 받음/)).toBeInTheDocument();
  });
});
