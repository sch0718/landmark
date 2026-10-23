import { StrictMode } from 'react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { AppLayer, setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { RouteLookup } from 'src/services/route-lookup';
import { act, render, screen, waitFor } from '@testing-library/react';
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

it('조회 중 조건을 바꾸고 완료 후 되돌리면 찾기와 후보 공유를 다시 누를 수 있다', async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  let finish!: () => void;
  const response = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      AppLayer,
      Layer.succeed(
        RouteLookup,
        RouteLookup.of({
          leg: (mode) => {
            calls += 1;
            return Effect.promise(() => response).pipe(
              Effect.as({
                mode,
                durationS: 600,
                distanceM: 1000,
                tollFare: null,
                path: [],
                queriedAt: '2026-10-24T00:00:00Z',
                seq: calls,
                fresh: false,
              }),
            );
          },
        }),
      ),
    ),
  );
  setAppRuntimeForTest(runtime);
  const meeting = buildMeeting({
    mode: f('car'),
    participants: f([
      { id: 'person01', name: '나', origin: { name: '집', lng: 127, lat: 37.5 } },
      { id: 'person02', name: '친구', origin: { name: '회사', lng: 127.1, lat: 37.6 } },
    ]),
  });
  const library = emptyLibrary();
  const { rerender, unmount } = render(<MeetingResults meeting={meeting} library={library} />);
  try {
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByRole('button', { name: '중간 지점 찾기' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '후보 링크 보내기' })).toBeDisabled();
    rerender(<MeetingResults meeting={{ ...meeting, mode: f('straight') }} library={library} />);
    await act(async () => {
      finish();
      await response;
    });
    rerender(<MeetingResults meeting={meeting} library={library} />);
    expect(screen.getByRole('button', { name: '중간 지점 찾기' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '후보 링크 보내기' })).toBeEnabled();
    expect(screen.queryByText(/조회 중/)).not.toBeInTheDocument();
    expect(screen.getAllByText('10분')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '후보 링크 보내기' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/meet#d=')),
    );
    await user.click(screen.getByRole('button', { name: '중간 지점 찾기' }));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: / 후보에 담기$/ })).toHaveLength(8),
    );
    expect(calls).toBeGreaterThan(2);
  } finally {
    unmount();
    writeText.mockRestore();
    setAppRuntimeForTest(null);
    await runtime.dispose();
  }
});

it('StrictMode로 편집 화면을 열면 후보 시간이 채워지고 찾기·공유를 다시 누를 수 있다', async () => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      AppLayer,
      Layer.succeed(
        RouteLookup,
        RouteLookup.of({
          leg: (mode) =>
            Effect.succeed({
              mode,
              durationS: 600,
              distanceM: 1000,
              tollFare: null,
              path: [],
              queriedAt: '2026-10-24T00:00:00Z',
              seq: 1,
              fresh: false,
            }),
        }),
      ),
    ),
  );
  setAppRuntimeForTest(runtime);
  const meeting = buildMeeting({
    mode: f('car'),
    participants: f([
      { id: 'person01', name: '나', origin: { name: '집', lng: 127, lat: 37.5 } },
      { id: 'person02', name: '친구', origin: { name: '회사', lng: 127.1, lat: 37.6 } },
    ]),
  });
  const { unmount } = render(<MeetingResults meeting={meeting} library={emptyLibrary()} />, {
    wrapper: StrictMode,
  });
  try {
    await waitFor(() => expect(screen.getAllByText('10분')).toHaveLength(2));
    expect(screen.queryByText(/조회 중/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '중간 지점 찾기' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '후보 링크 보내기' })).toBeEnabled();
  } finally {
    unmount();
    setAppRuntimeForTest(null);
    await runtime.dispose();
  }
});
