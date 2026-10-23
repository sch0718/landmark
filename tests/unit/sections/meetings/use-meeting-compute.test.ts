import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { AppLayer, setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { RouteLookup } from 'src/services/route-lookup';
import { RouteLookupError } from 'src/services/errors';
import { useMeetingCompute } from 'src/sections/meetings/use-meeting-compute';
import type { Participant } from 'src/schema/meeting';

const participants: Participant[] = [
  { id: 'person01', name: '나', origin: { name: '출발', lng: 127, lat: 37.5 } },
];
const targets = [{ id: 'choice01', name: '도착', lng: 127.01, lat: 37.51 }];
afterEach(() => setAppRuntimeForTest(null));

describe('약속 소요시간 계산', () => {
  it('직선거리를 미터로 계산하고 조건 변경은 재조회 없이 오래됨으로 표시한다', async () => {
    const { result, rerender } = renderHook(
      ({ mode }) => useMeetingCompute({ participants, targets, mode, at: null }),
      { initialProps: { mode: 'straight' as 'straight' | 'car' } },
    );
    await act(() => result.current.compute());
    expect(result.current.times.choice01?.person01).toBeGreaterThan(1000);
    expect(result.current.progress).toEqual({ done: 1, total: 1 });
    expect(result.current.stale).toBe(false);
    rerender({ mode: 'car' });
    expect(result.current.stale).toBe(true);
    expect(result.current.times.choice01?.person01).toBeNull();
  });
  it('대중교통에 약속 한 시간 전을 보내고 초를 분으로 바꾼다', async () => {
    const calls: string[] = [];
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        AppLayer,
        Layer.succeed(
          RouteLookup,
          RouteLookup.of({
            leg: (mode, _from, _to, opts) => {
              calls.push(`${mode}:${opts?.at}`);
              return Effect.succeed({
                mode,
                durationS: 3900,
                distanceM: 10000,
                tollFare: null,
                path: [],
                queriedAt: '2026-10-23T00:00:00Z',
                seq: 1,
                fresh: false,
              });
            },
          }),
        ),
      ),
    );
    setAppRuntimeForTest(runtime);
    const { result, unmount } = renderHook(() =>
      useMeetingCompute({
        participants,
        targets,
        mode: 'transit',
        at: { date: '2026-10-31', time: '18:00' },
      }),
    );
    await act(() => result.current.compute());
    await waitFor(() => expect(result.current.times.choice01?.person01).toBe(65));
    expect(calls).toEqual(['transit:2026-10-31T17:00']);
    unmount();
    await runtime.dispose();
  });
  it('조회 실패 칸을 null로 남기고 그 칸만 다시 시도한다', async () => {
    let count = 0;
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        AppLayer,
        Layer.succeed(
          RouteLookup,
          RouteLookup.of({
            leg: () =>
              ++count === 1
                ? Effect.fail(new RouteLookupError({ code: 'OFFLINE', seq: 1, fresh: false }))
                : Effect.succeed({
                    mode: 'car',
                    durationS: 600,
                    distanceM: 1000,
                    tollFare: null,
                    path: [],
                    queriedAt: '2026-10-23T00:00:00Z',
                    seq: 2,
                    fresh: true,
                  }),
          }),
        ),
      ),
    );
    setAppRuntimeForTest(runtime);
    const { result, unmount } = renderHook(() =>
      useMeetingCompute({ participants, targets, mode: 'car', at: null }),
    );
    await act(() => result.current.compute());
    expect(result.current.times.choice01?.person01).toBeNull();
    expect(result.current.errors.choice01?.person01).toBe('OFFLINE');
    await act(() => result.current.retry('choice01', 'person01'));
    expect(result.current.times.choice01?.person01).toBe(10);
    expect(count).toBe(2);
    unmount();
    await runtime.dispose();
  });
});

it('조회 중 실패 칸을 다시 시도해도 다른 칸의 늦은 응답을 보존한다', async () => {
  let finish!: () => void;
  let count = 0;
  const answer = {
    mode: 'car' as const,
    durationS: 600,
    distanceM: 1000,
    tollFare: null,
    path: [],
    queriedAt: '2026-10-23T00:00:00Z',
    seq: 2,
    fresh: true,
  };
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      AppLayer,
      Layer.succeed(
        RouteLookup,
        RouteLookup.of({
          leg: () => {
            count += 1;
            if (count === 1)
              return Effect.fail(new RouteLookupError({ code: 'OFFLINE', seq: 1, fresh: false }));
            if (count === 2)
              return Effect.promise(
                () =>
                  new Promise<typeof answer>((resolve) => {
                    finish = () => resolve(answer);
                  }),
              );
            return Effect.succeed(answer);
          },
        }),
      ),
    ),
  );
  setAppRuntimeForTest(runtime);
  const { result, unmount } = renderHook(() =>
    useMeetingCompute({
      participants,
      targets: [...targets, { ...targets[0]!, id: 'choice02' }],
      mode: 'car',
      at: null,
    }),
  );
  let computing!: Promise<void>;
  act(() => {
    computing = result.current.compute();
  });
  await waitFor(() => expect(result.current.errors.choice01?.person01).toBe('OFFLINE'));
  await act(() => result.current.retry('choice01', 'person01'));
  await act(async () => {
    finish();
    await computing;
  });
  expect(result.current.times.choice02?.person01).toBe(10);
  expect(result.current.times.choice01?.person01).toBe(10);
  expect(result.current.pending).toBe(false);
  unmount();
  await runtime.dispose();
});
