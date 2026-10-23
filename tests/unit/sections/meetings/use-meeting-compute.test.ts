import { createElement, StrictMode, useEffect } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function gatedRoutes() {
  const calls: number[] = [];
  let finish!: () => void;
  const response = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      AppLayer,
      Layer.succeed(
        RouteLookup,
        RouteLookup.of({
          leg: (mode, _from, to) => {
            calls.push(to[0]);
            return Effect.promise(() => response).pipe(
              Effect.as({
                mode,
                durationS: 600,
                distanceM: 1000,
                tollFare: null,
                path: [],
                queriedAt: '2026-10-24T00:00:00Z',
                seq: calls.length,
                fresh: false,
              }),
            );
          },
        }),
      ),
    ),
  );
  setAppRuntimeForTest(runtime);
  return { calls, finish, runtime };
}

const manyParticipants = Array.from({ length: 10 }, (_, i) => ({
  ...participants[0]!,
  id: `person${i}`,
}));
const manyTargets = Array.from({ length: 8 }, (_, i) => ({
  ...targets[0]!,
  id: `choice${i}`,
  lng: 128 + i / 100,
}));

it('80칸 계산 중 언마운트하면 처음 4칸 뒤로는 경로를 요청하지 않는다', async () => {
  const { calls, finish, runtime } = gatedRoutes();
  const { result, unmount } = renderHook(() =>
    useMeetingCompute({
      participants: manyParticipants,
      targets: manyTargets,
      mode: 'car',
      at: null,
    }),
  );
  let computing!: Promise<void>;
  try {
    act(() => {
      computing = result.current.compute();
    });
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(4));
    unmount();
    const callsAtUnmount = calls.length;
    await act(async () => {
      finish();
      await computing;
    });
    expect(callsAtUnmount).toBe(4);
    expect(calls).toHaveLength(callsAtUnmount);
  } finally {
    finish();
    unmount();
    await runtime.dispose();
  }
});

it('새 계산을 시작하면 이전 계산의 아직 보내지 않은 칸을 요청하지 않는다', async () => {
  const { calls, finish, runtime } = gatedRoutes();
  const { result, rerender, unmount } = renderHook(
    ({ destinations }) =>
      useMeetingCompute({ participants, targets: destinations, mode: 'car', at: null }),
    { initialProps: { destinations: manyTargets } },
  );
  let previous!: Promise<void>;
  let current!: Promise<void>;
  try {
    act(() => {
      previous = result.current.compute();
    });
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(4));
    rerender({ destinations: targets });
    act(() => {
      current = result.current.compute();
    });
    await waitFor(() => expect(calls).toContain(targets[0]!.lng));
    await act(async () => {
      finish();
      await Promise.all([previous, current]);
    });
    expect(calls.filter((lng) => lng >= 128)).toHaveLength(4);
    expect(calls.filter((lng) => lng < 128)).toHaveLength(1);
    expect(result.current.times).toEqual({ choice01: { person01: 10 } });
    expect(result.current.progress).toEqual({ done: 1, total: 1 });
    expect(result.current.pending).toBe(false);
  } finally {
    finish();
    unmount();
    await runtime.dispose();
  }
});

it('effect가 시작한 계산을 취소하면 대기를 풀고 늦은 결과를 쓰지 않는다', async () => {
  const { calls, finish, runtime } = gatedRoutes();
  const { result, unmount } = renderHook(() =>
    useMeetingCompute({ participants, targets: manyTargets, mode: 'car', at: null }),
  );
  const controller = new AbortController();
  let computing!: Promise<void>;
  try {
    act(() => {
      computing = result.current.compute({ signal: controller.signal });
    });
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(4));
    await act(async () => controller.abort());
    expect(result.current.pending).toBe(false);
    await act(async () => finish());
    expect(result.current.times).toEqual({});
    expect(result.current.errors).toEqual({});
    expect(calls).toHaveLength(4);
    await computing;
  } finally {
    finish();
    await computing;
    unmount();
    await runtime.dispose();
  }
});

it('취소하지 않은 80칸은 동시에 4칸씩 끝까지 계산한다', async () => {
  const { calls, finish, runtime } = gatedRoutes();
  const { result, unmount } = renderHook(() =>
    useMeetingCompute({
      participants: manyParticipants,
      targets: manyTargets,
      mode: 'car',
      at: null,
    }),
  );
  let computing!: Promise<void>;
  try {
    act(() => {
      computing = result.current.compute();
    });
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(4));
    expect(calls).toHaveLength(4);
    await act(async () => {
      finish();
      await computing;
    });
    expect(calls).toHaveLength(80);
    expect(result.current.progress).toEqual({ done: 80, total: 80 });
    expect(result.current.pending).toBe(false);
    for (const target of manyTargets) {
      expect(Object.values(result.current.times[target.id]!)).toEqual(Array(10).fill(10));
    }
  } finally {
    finish();
    await computing;
    unmount();
    await runtime.dispose();
  }
});

it('이전 effect의 cleanup은 나중에 수동으로 시작한 계산을 취소하지 않는다', async () => {
  const { calls, finish, runtime } = gatedRoutes();
  const { result, unmount } = renderHook(() =>
    useMeetingCompute({ participants, targets, mode: 'car', at: null }),
  );
  const controller = new AbortController();
  let previous!: Promise<void>;
  let current!: Promise<void>;
  try {
    act(() => {
      previous = result.current.compute({ signal: controller.signal });
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => {
      current = result.current.compute({ refresh: true });
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => {
      controller.abort();
      await previous;
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      finish();
      await current;
    });
    expect(result.current.times).toEqual({ choice01: { person01: 10 } });
    expect(result.current.progress).toEqual({ done: 1, total: 1 });
    expect(result.current.pending).toBe(false);
  } finally {
    finish();
    unmount();
    await runtime.dispose();
  }
});

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
  it('대중교통에 약속 한 시간 전을 10분 단위로 내려 보내고 표시한다', async () => {
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
        at: { date: '2026-10-31', time: '18:19' },
      }),
    );
    await act(() => result.current.compute());
    await waitFor(() => expect(result.current.times.choice01?.person01).toBe(65));
    expect(calls).toEqual(['transit:2026-10-31T17:10']);
    expect(result.current.departure).toBe('2026-10-31T17:10');
    unmount();
    await runtime.dispose();
  });
  it.each([
    ['같은 조건의 칸 재시도는 기존 출발 시각을 쓴다', 'retry', '2026-10-24T09:00'],
    ['조건이 바뀐 칸 재시도는 출발 시각을 새로 정한다', 'changed', '2026-10-24T09:10'],
    ['전체 재계산은 같은 조건이어도 출발 시각을 새로 정한다', 'compute', '2026-10-24T09:10'],
  ] as const)('10분 경계를 넘어도 %s', async (_name, action, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T09:00:00+09:00'));
    const calls: { at: string | undefined; lng: number; refresh: boolean | undefined }[] = [];
    const destinations = [...targets, { ...targets[0]!, id: 'choice02', lng: 127.02 }];
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        AppLayer,
        Layer.succeed(
          RouteLookup,
          RouteLookup.of({
            leg: (mode, _from, to, options) => {
              calls.push({ at: options?.at, lng: to[0], refresh: options?.refresh });
              return calls.length === 1
                ? Effect.fail(new RouteLookupError({ code: 'OFFLINE', seq: 1, fresh: false }))
                : Effect.succeed({
                    mode,
                    durationS: 600,
                    distanceM: 1000,
                    tollFare: null,
                    path: [],
                    queriedAt: '2026-10-24T00:00:00Z',
                    seq: calls.length,
                    fresh: options?.refresh === true,
                  });
            },
          }),
        ),
      ),
    );
    setAppRuntimeForTest(runtime);
    const { result, rerender, unmount } = renderHook(
      ({ targets }) => useMeetingCompute({ participants, targets, mode: 'transit', at: null }),
      { initialProps: { targets: destinations } },
    );
    try {
      await act(() => result.current.compute());
      expect(result.current.errors.choice01?.person01).toBe('OFFLINE');
      expect(result.current.times.choice02?.person01).toBe(10);
      expect(result.current.departure).toBe('2026-10-24T09:00');
      expect(calls.map((call) => call.at)).toEqual(['2026-10-24T09:00', '2026-10-24T09:00']);

      vi.setSystemTime(new Date('2026-10-24T09:17:00+09:00'));
      if (action === 'changed') {
        rerender({ targets: destinations.map((t) => ({ ...t, lng: t.lng + 0.01 })) });
      }
      await act(() =>
        action === 'compute'
          ? result.current.compute()
          : result.current.retry('choice01', 'person01'),
      );
      expect(calls.slice(2)).toEqual(
        action === 'compute'
          ? destinations.map((t) => ({ at: expected, lng: t.lng, refresh: false }))
          : [
              {
                at: expected,
                lng: targets[0]!.lng + (action === 'changed' ? 0.01 : 0),
                refresh: true,
              },
            ],
      );
      expect(result.current.departure).toBe(expected);
      expect(result.current.times.choice01?.person01).toBe(10);
      expect(result.current.errors.choice01?.person01).toBeUndefined();
      if (action === 'retry') expect(result.current.times.choice02?.person01).toBe(10);
    } finally {
      unmount();
      await runtime.dispose();
      vi.useRealTimers();
    }
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

it('StrictMode에서 마운트 effect가 다시 시작한 계산이 완료되고 대기를 푼다', async () => {
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
    const compute = result.compute;
    useEffect(() => {
      const controller = new AbortController();
      void compute({ signal: controller.signal });
      return () => controller.abort();
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
