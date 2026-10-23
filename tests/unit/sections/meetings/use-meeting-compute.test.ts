import { createElement, StrictMode, useEffect, useRef } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
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
  it('자동차를 직접 다시 찾으면 캐시를 새로 조회하고 결과의 가장 오래된 조회 시각을 쓴다', async () => {
    const calls: (boolean | undefined)[] = [];
    const old = '2026-10-20T00:00:00.000Z';
    const newer = '2026-10-22T00:00:00.000Z';
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        AppLayer,
        Layer.succeed(
          RouteLookup,
          RouteLookup.of({
            leg: (mode, _from, _to, options) => {
              calls.push(options?.refresh);
              return Effect.succeed({
                mode,
                durationS: 600,
                distanceM: 1000,
                tollFare: null,
                path: [],
                queriedAt: calls.length % 2 === 0 ? old : newer,
                seq: calls.length,
                fresh: options?.refresh === true,
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
        targets: [...targets, { ...targets[0]!, id: 'choice02' }],
        mode: 'car',
        at: null,
      }),
    );
    try {
      await act(() => result.current.compute());
      expect(calls).toEqual([false, false]);
      await act(() => result.current.compute({ refresh: true }));
      expect(calls).toEqual([false, false, true, true]);
      expect(result.current.queriedAt).toBe(old);
      await act(() => result.current.retry('choice02', 'person01'));
      expect(result.current.queriedAt).toBe(newer);
    } finally {
      unmount();
      await runtime.dispose();
    }
  });

  it('자동 계산도 캐시 결과의 조회 시각을 표시한다', async () => {
    const queriedAt = '2026-10-19T00:00:00.000Z';
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
                queriedAt,
                seq: 0,
                fresh: false,
              }),
          }),
        ),
      ),
    );
    setAppRuntimeForTest(runtime);
    const { result, unmount } = renderHook(() =>
      useMeetingCompute({ participants, targets, mode: 'car', at: null }),
    );
    try {
      await act(() => result.current.compute());
      expect(result.current.queriedAt).toBe(queriedAt);
    } finally {
      unmount();
      await runtime.dispose();
    }
  });
  it('직선거리를 미터로 계산하고 조건 변경은 재조회 없이 오래됨으로 표시한다', async () => {
    const { result, rerender } = renderHook(
      ({ mode }) => useMeetingCompute({ participants, targets, mode, at: null }),
      { initialProps: { mode: 'straight' as 'straight' | 'car' } },
    );
    await act(() => result.current.compute());
    expect(result.current.times.choice01?.person01).toBeGreaterThan(1000);
    expect(result.current.progress).toEqual({ done: 1, total: 1 });
    expect(result.current.stale).toBe(false);
    expect(result.current.queriedAt).toBeNull();
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

it('조회 중 조건을 바꾸고 완료 후 되돌리면 결과가 유효하고 대기가 풀린다', async () => {
  let finish!: () => void;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      AppLayer,
      Layer.succeed(
        RouteLookup,
        RouteLookup.of({
          leg: (mode) =>
            Effect.promise(
              () =>
                new Promise<void>((resolve) => {
                  finish = resolve;
                }),
            ).pipe(
              Effect.as({
                mode,
                durationS: 600,
                distanceM: 1000,
                tollFare: null,
                path: [],
                queriedAt: '2026-10-24T00:00:00Z',
                seq: 1,
                fresh: false,
              }),
            ),
        }),
      ),
    ),
  );
  setAppRuntimeForTest(runtime);
  const { result, rerender, unmount } = renderHook(
    ({ mode }) => useMeetingCompute({ participants, targets, mode, at: null }),
    { initialProps: { mode: 'car' as 'car' | 'straight' } },
  );
  try {
    let computing!: Promise<void>;
    act(() => {
      computing = result.current.compute();
    });
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(result.current.pending).toBe(true);
    rerender({ mode: 'straight' });
    await act(async () => {
      finish();
      await computing;
    });
    expect(result.current.stale).toBe(true);
    expect(result.current.times.choice01?.person01).toBeNull();
    rerender({ mode: 'car' });
    expect(result.current.pending).toBe(false);
    expect(result.current.stale).toBe(false);
    expect(result.current.times.choice01?.person01).toBe(10);
    expect(result.current.progress).toEqual({ done: 1, total: 1 });
    expect(result.current.queriedAt).toBe('2026-10-24T00:00:00Z');
  } finally {
    unmount();
    await runtime.dispose();
  }
});

it('다른 조건으로 새 계산을 시작하면 이전 계산의 늦은 응답을 버린다', async () => {
  let finish!: () => void;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      AppLayer,
      Layer.succeed(
        RouteLookup,
        RouteLookup.of({
          leg: (mode) =>
            Effect.promise(
              () =>
                new Promise<void>((resolve) => {
                  finish = resolve;
                }),
            ).pipe(
              Effect.as({
                mode,
                durationS: 600,
                distanceM: 1000,
                tollFare: null,
                path: [],
                queriedAt: '2026-10-24T00:00:00Z',
                seq: 1,
                fresh: false,
              }),
            ),
        }),
      ),
    ),
  );
  setAppRuntimeForTest(runtime);
  const { result, rerender, unmount } = renderHook(
    ({ mode }) => useMeetingCompute({ participants, targets, mode, at: null }),
    { initialProps: { mode: 'car' as 'car' | 'straight' } },
  );
  try {
    let computing!: Promise<void>;
    act(() => {
      computing = result.current.compute();
    });
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    rerender({ mode: 'straight' });
    await act(() => result.current.compute());
    const distance = result.current.times.choice01?.person01;
    expect(distance).toBeGreaterThan(1000);
    await act(async () => {
      finish();
      await computing;
    });
    expect(result.current.times.choice01?.person01).toBe(distance);
    expect(result.current.progress).toEqual({ done: 1, total: 1 });
    expect(result.current.pending).toBe(false);
    expect(result.current.stale).toBe(false);
    expect(result.current.queriedAt).toBeNull();
  } finally {
    unmount();
    await runtime.dispose();
  }
});

it('StrictMode에서 마운트 직후 한 번 시작한 계산이 완료되고 대기를 푼다', async () => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      AppLayer,
      Layer.succeed(
        RouteLookup,
        RouteLookup.of({
          leg: (mode) =>
            Effect.succeed({
              mode,
              durationS: 3900,
              distanceM: 10000,
              tollFare: null,
              path: [],
              queriedAt: '2026-10-23T00:00:00Z',
              seq: 1,
              fresh: false,
            }),
        }),
      ),
    ),
  );
  setAppRuntimeForTest(runtime);
  function OnMount() {
    const result = useMeetingCompute({ participants, targets, mode: 'car', at: null });
    const started = useRef(false);
    const compute = result.compute;
    useEffect(() => {
      if (started.current) return;
      started.current = true;
      void compute();
    }, [compute]);
    return createElement(
      'output',
      null,
      `${result.times.choice01?.person01}:${result.pending}:${result.progress.done}/${result.progress.total}`,
    );
  }
  const { unmount } = render(createElement(OnMount), { wrapper: StrictMode });
  try {
    expect(await screen.findByText('65:false:1/1')).toBeInTheDocument();
  } finally {
    unmount();
    await runtime.dispose();
  }
});
