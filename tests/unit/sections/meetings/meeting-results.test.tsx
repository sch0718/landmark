import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, expect, it, vi } from 'vitest';
import { AppLayer, setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { emptyLibrary } from 'src/schema/library';
import { MeetingResults } from 'src/sections/meetings/MeetingResults';
import { RouteLookup } from 'src/services/route-lookup';
import { RouteLookupError } from 'src/services/errors';
import { buildMeeting } from '../../../fixtures/builders';

afterEach(() => setAppRuntimeForTest(null));

function departureRoutes() {
  const calls: { at: string | undefined; lng: number }[] = [];
  let failCandidate = true;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      AppLayer,
      Layer.succeed(
        RouteLookup,
        RouteLookup.of({
          leg: (mode, _from, to, options) => {
            calls.push({ at: options?.at, lng: to[0] });
            if (to[0] === 124.5 && failCandidate) {
              failCandidate = false;
              return Effect.fail(new RouteLookupError({ code: 'OFFLINE', seq: 1, fresh: false }));
            }
            return Effect.succeed({
              mode,
              durationS: 600,
              distanceM: 1000,
              tollFare: null,
              path: [],
              queriedAt: new Date().toISOString(),
              seq: calls.length,
              fresh: false,
            });
          },
        }),
      ),
    ),
  );
  setAppRuntimeForTest(runtime);
  const base = buildMeeting();
  const meeting = buildMeeting({
    participants: {
      ...base.participants,
      value: [
        { id: 'person01', name: '나', origin: { name: '서울', lng: 127, lat: 37.5 } },
        { id: 'person02', name: '친구', origin: { name: '수원', lng: 127.01, lat: 37.3 } },
      ],
    },
    candidates: {
      ...base.candidates,
      value: [{ ...base.candidates.value[0]!, lng: 124.5, lat: 33.5 }],
    },
  });
  return { calls, runtime, meeting };
}

it.each([false, true])(
  '기존 후보 %s: 09:00 계산 뒤 09:20에 담은 후보와 재시도도 같은 출발 시각을 쓴다',
  async (hasCandidates) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T09:00:00+09:00'));
    const { calls, runtime, meeting } = departureRoutes();
    const library = emptyLibrary();
    const initial = hasCandidates
      ? meeting
      : { ...meeting, candidates: { ...meeting.candidates, value: [] } };
    const { rerender, unmount } = render(<MeetingResults meeting={initial} library={library} />);
    try {
      const find = screen.getByRole('button', { name: '중간 지점 찾기' });
      await waitFor(() => expect(find).toBeEnabled());
      // 기존 후보가 있으면 첫 자동 계산이, 없으면 찾기가 스냅숏을 정한다.
      if (!hasCandidates) fireEvent.click(find);
      await waitFor(() => expect(screen.getByText(/09:00 출발 기준/)).toBeInTheDocument());
      await waitFor(() => expect(find).toBeEnabled());
      vi.setSystemTime(new Date('2026-10-24T09:20:00+09:00'));
      const before = calls.length;
      const added = hasCandidates
        ? {
            ...meeting,
            candidates: {
              ...meeting.candidates,
              value: [
                ...meeting.candidates.value,
                { ...meeting.candidates.value[0]!, id: 'choice02', name: '추가 후보', lng: 124.6 },
              ],
            },
          }
        : meeting;
      rerender(<MeetingResults meeting={added} library={library} />);
      await waitFor(() => expect(calls.length).toBeGreaterThan(before));
      await waitFor(() => expect(find).toBeEnabled());
      expect(calls.slice(before).every((call) => call.at === '2026-10-24T09:00')).toBe(true);
      expect(screen.getByText(/09:00 출발 기준/)).toBeInTheDocument();
      if (!hasCandidates) {
        vi.setSystemTime(new Date('2026-10-24T09:30:00+09:00'));
        fireEvent.click(screen.getByRole('button', { name: '강남역 나 다시 시도' }));
        await waitFor(() => expect(find).toBeEnabled());
        expect(calls.at(-1)?.at).toBe('2026-10-24T09:00');
      }
    } finally {
      unmount();
      await runtime.dispose();
      vi.useRealTimers();
    }
  },
);

it.each(['mode', 'at', 'find'] as const)(
  '%s 변경 뒤 새 찾기는 새 출발 시각을 두 계산과 표시에 적용한다',
  async (change) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T09:00:00+09:00'));
    const { calls, runtime, meeting } = departureRoutes();
    const library = emptyLibrary();
    const { rerender, unmount } = render(<MeetingResults meeting={meeting} library={library} />);
    try {
      const find = screen.getByRole('button', { name: '중간 지점 찾기' });
      await waitFor(() => expect(find).toBeEnabled());
      fireEvent.click(find);
      await waitFor(() => expect(find).toBeEnabled());
      vi.setSystemTime(new Date('2026-10-24T09:20:00+09:00'));
      if (change === 'mode') {
        rerender(
          <MeetingResults
            meeting={{ ...meeting, mode: { ...meeting.mode, value: 'straight' } }}
            library={library}
          />,
        );
        rerender(<MeetingResults meeting={meeting} library={library} />);
      } else if (change === 'at') {
        rerender(
          <MeetingResults
            meeting={{
              ...meeting,
              at: { ...meeting.at, value: { date: '2026-10-31', time: '18:00' } },
            }}
            library={library}
          />,
        );
        rerender(<MeetingResults meeting={meeting} library={library} />);
      }
      await waitFor(() => expect(find).toBeEnabled());
      const before = calls.length;
      fireEvent.click(find);
      await waitFor(() => expect(calls.length).toBeGreaterThan(before));
      await waitFor(() => expect(find).toBeEnabled());
      expect(calls.slice(before).every((call) => call.at === '2026-10-24T09:20')).toBe(true);
      expect(calls.slice(before).some((call) => call.lng === 124.5)).toBe(true);
      expect(calls.slice(before).some((call) => call.lng !== 124.5)).toBe(true);
      expect(screen.getByText(/09:20 출발 기준/)).toBeInTheDocument();
    } finally {
      unmount();
      await runtime.dispose();
      vi.useRealTimers();
    }
  },
);

it('일시가 있는 약속은 시계가 바뀌어도 약속 한 시간 전을 공유한다', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T09:00:00+09:00'));
  const { calls, runtime, meeting } = departureRoutes();
  const scheduled = {
    ...meeting,
    at: { ...meeting.at, value: { date: '2026-10-31', time: '18:19' } },
  };
  const { unmount } = render(<MeetingResults meeting={scheduled} library={emptyLibrary()} />);
  try {
    const find = screen.getByRole('button', { name: '중간 지점 찾기' });
    await waitFor(() => expect(find).toBeEnabled());
    vi.setSystemTime(new Date('2026-10-24T09:20:00+09:00'));
    fireEvent.click(find);
    await waitFor(() => expect(find).toBeEnabled());
    expect(calls.every((call) => call.at === '2026-10-31T17:10')).toBe(true);
    expect(screen.getByText(/10-31 17:10 출발 기준/)).toBeInTheDocument();
  } finally {
    unmount();
    await runtime.dispose();
    vi.useRealTimers();
  }
});

it.each(['car', 'transit'] as const)(
  '%s 찾기를 다시 누르면 새로 조회 여부와 실제 조회 날짜를 유지한다',
  async (mode) => {
    const calls: (boolean | undefined)[] = [];
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        AppLayer,
        Layer.succeed(
          RouteLookup,
          RouteLookup.of({
            leg: (routeMode, _from, to, options) => {
              calls.push(options?.refresh);
              return Effect.succeed({
                mode: routeMode,
                durationS: 600,
                distanceM: 1000,
                tollFare: null,
                path: [],
                queriedAt:
                  to[0] === 124.5 ? '2026-10-19T00:00:00.000Z' : '2026-10-22T00:00:00.000Z',
                seq: calls.length,
                fresh: options?.refresh === true,
              });
            },
          }),
        ),
      ),
    );
    setAppRuntimeForTest(runtime);
    const base = buildMeeting();
    const meeting = buildMeeting({
      mode: { ...base.mode, value: mode },
      at: { ...base.at, value: { date: '2026-10-31', time: '18:00' } },
      participants: {
        ...base.participants,
        value: [
          { id: 'person01', name: '나', origin: { name: '서울', lng: 127, lat: 37.5 } },
          { id: 'person02', name: '친구', origin: { name: '수원', lng: 127.01, lat: 37.3 } },
        ],
      },
      candidates: {
        ...base.candidates,
        value: [{ ...base.candidates.value[0]!, lng: 124.5, lat: 33.5 }],
      },
    });
    const { unmount } = render(<MeetingResults meeting={meeting} library={emptyLibrary()} />);
    try {
      const find = screen.getByRole('button', { name: '중간 지점 찾기' });
      await waitFor(() => expect(find).toBeEnabled());
      expect(calls).toEqual([false, false]);
      for (let count = 0; count < 2; count += 1) {
        const before = calls.length;
        fireEvent.click(find);
        await waitFor(() => expect(calls.length).toBeGreaterThan(before));
        await waitFor(() => expect(find).toBeEnabled());
        expect(calls.slice(before).every((refresh) => refresh === (mode === 'car'))).toBe(true);
        expect(screen.getByText(/조회 2026\.10\.19/)).toBeInTheDocument();
      }
    } finally {
      unmount();
      await runtime.dispose();
    }
  },
);
