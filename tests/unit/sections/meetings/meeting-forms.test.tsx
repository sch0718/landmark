import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingFormDialog } from 'src/sections/meetings/MeetingFormDialog';
import { ParticipantList } from 'src/sections/meetings/ParticipantList';
import { buildMeeting } from '../../../fixtures/builders';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router';
import { replyFromDraft } from 'src/domain/meeting/link';
import { emptyLibrary } from 'src/schema/library';
import { ReplyImport } from 'src/sections/meetings/ReplyImport';
import { libraryAtom } from 'src/stores/library-state';

afterEach(() => vi.useRealTimers());

it('주최자 본인의 답장을 미리보기에서 안내하고 반영 단추를 숨긴다', () => {
  const meeting = buildMeeting();
  const store = createStore();
  store.set(libraryAtom, { ...emptyLibrary(), meetings: { [meeting.id]: meeting } });
  const doc = replyFromDraft({
    meetingId: meeting.id,
    participantId: 'person01',
    likes: [],
    sentAt: meeting.createdAt,
  });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <ReplyImport doc={doc} />
      </MemoryRouter>
    </Provider>,
  );
  expect(screen.getByText('주최자 본인의 답장은 반영할 수 없어요')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '반영' })).not.toBeInTheDocument();
});

describe('약속 이름 오류 표시', () => {
  it('주최자는 삭제 단추만 숨기고 이름과 출발지는 계속 고칠 수 있다', () => {
    const base = buildMeeting();
    const meeting = {
      ...base,
      participants: {
        ...base.participants,
        value: [
          { ...base.participants.value[0]!, name: '주최자' },
          { id: 'friend01', name: '친구', origin: null },
        ],
      },
    };
    render(<ParticipantList meeting={meeting} />);
    expect(screen.queryByRole('button', { name: '주최자 삭제' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '친구 삭제' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '주최자 이름 고치기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '주최자 출발지 고르기' })).toBeInTheDocument();
  });
  it('새 약속은 입력을 지운 뒤에만 필수 오류를 보이고 다시 열면 초기화한다', () => {
    const props = { mode: 'create' as const, onClose: vi.fn() };
    const { rerender } = render(<MeetingFormDialog {...props} open />);
    const input = screen.getByRole('textbox', { name: '약속 이름' });
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText('약속 이름을 넣어 주세요')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '모임' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('약속 이름을 넣어 주세요')).toBeInTheDocument();
    rerender(<MeetingFormDialog {...props} open={false} />);
    rerender(<MeetingFormDialog {...props} open />);
    expect(screen.queryByText('약속 이름을 넣어 주세요')).not.toBeInTheDocument();
  });

  it('빈 새 약속 폼을 제출하면 필수 오류를 보인다', () => {
    render(<MeetingFormDialog mode="create" open onClose={vi.fn()} />);
    expect(screen.queryByText('약속 이름을 넣어 주세요')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('textbox', { name: '약속 이름' }).closest('form')!);
    expect(screen.getByText('약속 이름을 넣어 주세요')).toBeInTheDocument();
  });

  it.each(['참석자 추가', '나 이름 고치기'])(
    '%s도 입력을 지우기 전에는 오류를 숨긴다',
    async (action) => {
      render(<ParticipantList meeting={buildMeeting()} />);
      fireEvent.click(screen.getByRole('button', { name: action }));
      const dialog = screen.getByRole('dialog');
      const input = within(dialog).getByRole('textbox', { name: '참석자 이름' });
      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(within(dialog).queryByText('이름을 넣어 주세요')).not.toBeInTheDocument();
      fireEvent.change(input, { target: { value: '친구' } });
      fireEvent.change(input, { target: { value: '' } });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(within(dialog).getByText('이름을 넣어 주세요')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: '참석자 추가' }));
      expect(
        within(screen.getByRole('dialog')).queryByText('이름을 넣어 주세요'),
      ).not.toBeInTheDocument();
    },
  );

  it('빈 참석자 폼을 제출하면 필수 오류를 보인다', () => {
    render(<ParticipantList meeting={buildMeeting()} />);
    fireEvent.click(screen.getByRole('button', { name: '참석자 추가' }));
    expect(screen.queryByText('이름을 넣어 주세요')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('textbox', { name: '참석자 이름' }).closest('form')!);
    expect(screen.getByText('이름을 넣어 주세요')).toBeInTheDocument();
  });
});

describe('답장 받은 시각', () => {
  it.each([
    ['2026-10-23T17:33:24.000Z', '2026-10-24T03:00:00+09:00', '10.24 02:33'],
    ['2025-10-23T17:33:24.000Z', '2026-10-24T03:00:00+09:00', '2025.10.24 02:33'],
    ['2025-12-31T15:05:24.000Z', '2025-12-31T15:10:00.000Z', '01.01 00:05'],
  ])('%s를 한국 시각의 분까지만 표시한다', (receivedAt, now, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const meeting = buildMeeting({
      replies: {
        value: { person01: { likes: [], sentAt: receivedAt, receivedAt } },
        updatedAt: receivedAt,
      },
    });
    render(<ParticipantList meeting={meeting} />);
    const time = screen.getByText(expected);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', receivedAt);
  });
});
