import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { MeetingResults } from 'src/sections/meetings/MeetingResults';
import { emptyLibrary } from 'src/schema/library';
import { buildMeeting } from '../../../fixtures/builders';
const f = <T,>(value: T) => ({ value, updatedAt: '2026-10-23T00:00:00Z' });
it('출발지가 두 명 이상이면 8개 역을 찾고 조건 변경을 안내한다', async () => {
  const meeting = buildMeeting({
    candidates: f([]),
    mode: f('straight'),
    participants: f([
      { id: 'person01', name: '나', origin: { name: '강남', lng: 127.0276, lat: 37.4979 } },
      { id: 'person02', name: '친구', origin: { name: '홍대', lng: 126.9246, lat: 37.5572 } },
    ]),
  });
  const onHubsChange = vi.fn();
  const { rerender } = render(
    <MeetingResults meeting={meeting} library={emptyLibrary()} onHubsChange={onHubsChange} />,
  );
  await userEvent.click(screen.getByRole('button', { name: '중간 지점 찾기' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: / 후보에 담기$/ })).toHaveLength(8),
  );
  expect(onHubsChange.mock.calls.at(-1)?.[0]).toHaveLength(8);
  rerender(
    <MeetingResults
      meeting={{ ...meeting, rank: f('spread') }}
      library={emptyLibrary()}
      onHubsChange={onHubsChange}
    />,
  );
  await waitFor(() =>
    expect(onHubsChange.mock.calls.at(-1)?.[0].map((h: { name: string }) => h.name)).toEqual(
      screen
        .getAllByRole('button', { expanded: false })
        .map((b) => b.textContent!.replace(/^\d+\. /, '').split(' · ')[0]),
    ),
  );
  rerender(
    <MeetingResults
      meeting={{ ...meeting, mode: f('car') }}
      library={emptyLibrary()}
      onHubsChange={onHubsChange}
    />,
  );
  expect(screen.getByText('조건이 바뀌었어요 — 다시 찾기')).toBeTruthy();
});
it('출발지가 한 명이면 찾기를 막는다', () => {
  render(<MeetingResults meeting={buildMeeting()} library={emptyLibrary()} />);
  expect(
    (screen.getByRole('button', { name: '중간 지점 찾기' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
