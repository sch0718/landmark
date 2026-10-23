import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, expect, it } from 'vitest';
import { AppLayer, setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { emptyLibrary } from 'src/schema/library';
import { MeetingResults } from 'src/sections/meetings/MeetingResults';
import { RouteLookup } from 'src/services/route-lookup';
import { buildMeeting } from '../../../fixtures/builders';

afterEach(() => setAppRuntimeForTest(null));

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
