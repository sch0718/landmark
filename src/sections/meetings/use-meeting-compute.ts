import { Effect, Result } from 'effect';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { haversineM } from 'src/domain/trips/geo';
import { transitDeparture } from 'src/domain/meeting/rank';
import { startEffect } from 'src/lib/effect/runtime';
import type { Meeting, Participant } from 'src/schema/meeting';
import type { RouteLookupErrorCode } from 'src/services/errors';
import { RouteLookup } from 'src/services/route-lookup';

export type ComputeTarget = { id: string; name: string; lng: number; lat: number };
export type MeetingTimes = Record<string, Record<string, number | null>>;
type Errors = Record<string, Record<string, RouteLookupErrorCode>>;
type Input = {
  participants: readonly Participant[];
  targets: readonly ComputeTarget[];
  mode: Meeting['mode']['value'];
  at: Meeting['at']['value'];
};
type State = {
  key: string;
  times: MeetingTimes;
  errors: Errors;
  progress: { done: number; total: number };
  pending: boolean;
  queriedAts: Record<string, Record<string, string>>;
  departure: string | null;
};
const empty = (): State => ({
  key: '',
  times: {},
  errors: {},
  progress: { done: 0, total: 0 },
  pending: false,
  queriedAts: {},
  departure: null,
});

/** 소요시간은 화면 메모리에만 둔다. 조건 변경과 늦게 끝난 이전 요청을 구별한다. */
export function useMeetingCompute(input: Input) {
  const key = JSON.stringify({
    participants: input.participants.map((p) => ({ id: p.id, origin: p.origin })),
    targets: input.targets,
    mode: input.mode,
    at: input.at,
  });
  const latest = useRef({ input, key });
  useLayoutEffect(() => {
    latest.current = { input, key };
  });
  const generation = useRef(0);
  const requests = useRef(new Map<string, number>());
  const requestSeq = useRef(0);
  const [state, setState] = useState<State>(empty);

  const execute = useCallback(async (only?: { cid: string; pid: string }, refresh = false) => {
    const { input: args, key: startedKey } = latest.current;
    const token = only === undefined ? ++generation.current : generation.current;
    const now = new Date();
    const departure = args.mode === 'transit' ? transitDeparture(args.at, now) : null;
    const cells = args.targets.flatMap((t) =>
      args.participants
        .filter(
          (p) =>
            p.origin !== null && (only === undefined || (only.cid === t.id && only.pid === p.id)),
        )
        .map((p) => ({ t, p })),
    );
    setState((prev) => ({
      ...empty(),
      ...(only !== undefined && prev.key === startedKey ? prev : {}),
      key: startedKey,
      pending: true,
      progress:
        only !== undefined && prev.key === startedKey
          ? { done: prev.progress.done, total: prev.progress.total + cells.length }
          : { done: 0, total: cells.length },
      departure,
    }));
    await Promise.all(
      cells.map(async ({ t, p }) => {
        const requestKey = `${t.id}:${p.id}`;
        const requestToken = ++requestSeq.current;
        requests.current.set(requestKey, requestToken);
        const origin = p.origin!;
        const from: [number, number] = [origin.lng, origin.lat];
        const to: [number, number] = [t.lng, t.lat];
        let value: number | null = null;
        let error: RouteLookupErrorCode | null = null;
        let queriedAt: string | null = null;
        if (args.mode === 'straight') value = Math.round(haversineM(from, to));
        else {
          const mode = args.mode;
          const result = await startEffect(
            Effect.gen(function* () {
              const routes = yield* RouteLookup;
              return yield* Effect.result(
                routes.leg(mode, from, to, {
                  ...(departure === null ? {} : { at: departure }),
                  refresh: only !== undefined || (refresh && mode === 'car'),
                }),
              );
            }),
          );
          if (Result.isSuccess(result)) {
            value = Math.round(result.success.durationS / 60);
            queriedAt = result.success.queriedAt;
          } else error = result.failure.code;
        }
        if (generation.current !== token) return;
        setState((prev) => {
          if (prev.key !== startedKey) return prev;
          const done = prev.progress.done + 1;
          if (requests.current.get(requestKey) !== requestToken)
            return {
              ...prev,
              progress: { ...prev.progress, done },
              pending: done < prev.progress.total,
            };
          const errors = { ...prev.errors, [t.id]: { ...prev.errors[t.id] } };
          if (error === null) delete errors[t.id]![p.id];
          else errors[t.id]![p.id] = error;
          const queriedAts = { ...prev.queriedAts, [t.id]: { ...prev.queriedAts[t.id] } };
          if (queriedAt === null) delete queriedAts[t.id]![p.id];
          else queriedAts[t.id]![p.id] = queriedAt;
          return {
            ...prev,
            times: { ...prev.times, [t.id]: { ...prev.times[t.id], [p.id]: value } },
            errors,
            queriedAts,
            progress: { ...prev.progress, done },
            pending: done < prev.progress.total,
          };
        });
      }),
    );
    if (cells.length === 0 && generation.current === token)
      setState((prev) => (prev.key !== startedKey ? prev : { ...prev, pending: false }));
  }, []);
  const stale = state.key !== '' && state.key !== key;
  const times = stale
    ? Object.fromEntries(
        input.targets.map((t) => [
          t.id,
          Object.fromEntries(input.participants.map((p) => [p.id, null])),
        ]),
      )
    : state.times;
  return {
    ...state,
    times,
    errors: stale ? ({} as Errors) : state.errors,
    queriedAt: stale
      ? null
      : (Object.values(state.queriedAts)
          .flatMap((times) => Object.values(times))
          .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null),
    pending: !stale && state.pending,
    stale,
    compute: useCallback(
      (options?: { refresh?: boolean }) => execute(undefined, options?.refresh),
      [execute],
    ),
    retry: useCallback((cid: string, pid: string) => execute({ cid, pid }), [execute]),
    unit: input.mode === 'straight' ? ('m' as const) : ('min' as const),
  };
}
