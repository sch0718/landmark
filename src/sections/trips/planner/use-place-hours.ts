import { Effect, Result } from 'effect';
import { useAtomValue, useStore } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useCallback, useEffect, useMemo } from 'react';
import { visibleStops } from 'src/domain/trips/query';
import { forkEffect } from 'src/lib/effect/runtime';
import type { Place } from 'src/schema/library';
import type { PlaceHours } from 'src/server/hours';
import type { HoursLookupErrorCode } from 'src/services/errors';
import { HoursLookup, isHoursFresh } from 'src/services/hours-lookup';
import { libraryAtom } from 'src/stores/library-state';
import { hoursStatesAtom, type HoursState } from 'src/stores/place-hours';

type Store = ReturnType<typeof useStore>;

/** 영업시간을 받을 수 있는 장소(네이버)의 sid. 카카오·구글·핀은 null. */
export function naverSid(place: Place): string | null {
  return place.source.kind === 'naver' ? place.source.sid : null;
}

// 저장소(store)마다, sid마다 마지막으로 시작한 요청의 표. 그 요청의 답(또는 실패·중단)이 와야 `pending`을 거둔다.
const latestStarted = new WeakMap<Store, Map<string, number>>();
let lastToken = 0;

function startedOf(store: Store): Map<string, number> {
  let started = latestStarted.get(store);
  if (started === undefined) {
    started = new Map();
    latestStarted.set(store, started);
  }
  return started;
}

/**
 * 한 장소를 묻고 결과를 `hoursStatesAtom`에 쓴다. 실패도 상태로 남기므로 이 효과는 실패하지 않는다.
 * - 시작하면 받아 둔 정보(없으면 기기 캐시의 것)를 그대로 두고 `pending`을 켠다.
 * - 답을 만든 서버 요청의 번호(`seq`)가 지금 상태보다 작으면 내용은 버린다(`useDayPlan`의 `lookupLeg`와 같은
 *   규칙). 다만 받은 정보가 없을 때(나중 요청이 실패) 그 답이 성공이면 정보만 채운다. 실패해도 받아 둔 정보는
 *   지우지 않는다.
 * - `pending`은 이 장소에 이 요청보다 나중에 시작한 요청이 없을 때 거둔다. 내용을 버린 답이어도 거둔다:
 *   캐시 답(번호 0)이나 진행 중인 앞 요청에 합류한 답은 번호가 작아 버려지는데, 그때 켜 둔 채로 두면
 *   `pending`이 영영 꺼지지 않는다.
 */
function lookupHours(store: Store, sid: string, refresh: boolean) {
  return Effect.gen(function* () {
    const lookup = yield* HoursLookup;
    const token = ++lastToken;
    const started = startedOf(store);
    started.set(sid, token);
    const before = store.get(hoursStatesAtom)[sid];
    store.set(hoursStatesAtom, (prev) => {
      const known = prev[sid];
      const state: HoursState = {
        hours: known?.hours ?? lookup.peek(sid),
        pending: true,
        error: known?.error ?? null,
        seq: known?.seq ?? 0,
        refresh: known?.refresh ?? false,
      };
      return { ...prev, [sid]: state };
    });
    const isLatest = () => started.get(sid) === token;

    const result = yield* Effect.result(lookup.place(sid, { refresh })).pipe(
      // 런타임이 정리되며 중단되면 받는 중 표시를 거둔다. 처음 묻던 장소나 보일 것(정보·실패)이 없는 장소는
      // 상태를 지워 다음에 다시 묻게 한다(정보도 실패도 없이 받는 중이 아닌 상태를 남기지 않는다).
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          if (!isLatest()) return;
          store.set(hoursStatesAtom, (prev) => {
            const known = prev[sid];
            if (known === undefined) return prev;
            const first = before === undefined && known.seq === 0 && known.error === null;
            if (first || (known.hours === null && known.error === null)) {
              const { [sid]: _dropped, ...rest } = prev;
              void _dropped;
              return rest;
            }
            return { ...prev, [sid]: { ...known, pending: false } };
          });
        }),
      ),
    );
    const latest = isLatest();
    store.set(hoursStatesAtom, (prev) => {
      const known = prev[sid];
      const pending = latest ? false : (known?.pending ?? false);
      const seq = Result.isSuccess(result) ? result.success.seq : result.failure.seq;
      if (known !== undefined && seq < known.seq) {
        // 나중 요청이 실패해 받은 정보가 없으면, 늦게 온 앞 요청의 성공 답으로 정보만 채운다(번호·실패는 그대로).
        if (Result.isSuccess(result) && known.hours === null) {
          return { ...prev, [sid]: { ...known, hours: result.success.hours, pending } };
        }
        return known.pending === pending ? prev : { ...prev, [sid]: { ...known, pending } };
      }
      let state: HoursState;
      if (Result.isSuccess(result)) {
        state = { hours: result.success.hours, pending, error: null, seq, refresh: false };
      } else {
        // 연결 실패는 호출한 쪽의 `refresh`가 아니라 실제로 실패한 요청의 종류(`fresh`)를 남긴다(경로와 같다).
        const { code, fresh } = result.failure;
        state = {
          hours: known?.hours ?? null,
          pending,
          error: code,
          seq,
          refresh: code === 'OFFLINE' && fresh,
        };
      }
      return { ...prev, [sid]: state };
    });
  });
}

type HoursRequest = { sid: string; refresh: boolean };

/** 여러 장소를 함께 묻는다. 동시에 나가는 서버 요청 수는 `HoursLookup`이 제한하고, 목록 앞쪽이 먼저 나간다. */
const lookupAll = (store: Store, requests: HoursRequest[]) =>
  Effect.forEach(requests, ({ sid, refresh }) => lookupHours(store, sid, refresh), {
    concurrency: 'unbounded',
    discard: true,
  });

/**
 * 물을 장소인가(스펙 §4.3): 상태가 없거나, 받는 중이 아니고 마지막 요청이 성공했는데 받은 정보가 7일을 넘었다.
 * 7일 안의 정보는 다시 묻지 않는다. 실패한 장소는 여기서 다시 묻지 않는다(연결 실패는 `online` 때, 그 밖은
 * `다시 확인`으로).
 */
function needsRequest(state: HoursState | undefined): boolean {
  if (state === undefined) return true;
  if (state.pending || state.error !== null || state.hours === null) return false;
  return !isHoursFresh(state.hours, Date.now());
}

/**
 * 상태가 없거나 받은 정보가 7일을 넘은 장소만 보통 요청으로 묻는다(캐시로 답할지는 `HoursLookup`이 정한다).
 * 고르는 일도 효과 안에서 해, 앞 요청이 상태를 남긴 뒤의 목록으로 거른다.
 */
const requestNeeded = (store: Store, sids: readonly string[]) =>
  Effect.suspend(() => {
    const states = store.get(hoursStatesAtom);
    return lookupAll(
      store,
      sids.filter((sid) => needsRequest(states[sid])).map((sid) => ({ sid, refresh: false })),
    );
  });

/** 연결 실패였던(받는 중이 아닌) 장소를 실패한 요청과 같은 종류로 다시 묻는다. */
const retryOffline = (store: Store, sids: readonly string[]) =>
  Effect.suspend(() => {
    const states = store.get(hoursStatesAtom);
    const requests = sids.flatMap((sid) => {
      const known = states[sid];
      return known?.error === 'OFFLINE' && !known.pending ? [{ sid, refresh: known.refresh }] : [];
    });
    return lookupAll(store, requests);
  });

/** 인터넷이 돌아오면(`online`) 연결 실패였던 장소를 다시 묻는다. `key`는 줄바꿈으로 이은 sid들. */
function useOfflineRetry(store: Store, key: string) {
  useEffect(() => {
    if (key === '') return;
    const sids = key.split('\n');
    const onOnline = () => void forkEffect(retryOffline(store, sids));
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [key, store]);
}

// 요청은 화면이 사라지거나 목록이 바뀌어도 끝까지 돌게 둔다(중단하지 않는다). 시작할 때 `pending`을 켜 두었고,
// 결과는 공용 atom에 남아 다음에 쓴다. 서버 요청은 조회 계층이 따로 돌리므로 기다림을 끊어도 줄지 않는다.

/**
 * 그 여행 모든 Day의 네이버 장소(고른 Day 먼저)를 묻는다(스펙 §4.3). 상태가 없거나 받은 정보가 7일을 넘은 것만
 * 묻고(화면을 열 때·장소가 바뀔 때), 그 밖에 한 번 답을 받은 장소(실패 포함)는 다시 묻지 않는다. 연결
 * 실패(`OFFLINE`)는 인터넷이 돌아올 때(`online`) 다시 묻는다. 출발지·숙소는 판정하지 않아 묻지 않는다.
 * 계획 화면이 한 번 부른다.
 */
export function useTripHoursRequests(tripId: string, dayIndex: number): void {
  const library = useAtomValue(libraryAtom);
  const store = useStore();
  const trip = library.trips[tripId];

  // 물을 sid(고른 Day 먼저, 중복 없이). 문자열 하나로 만들어 내용이 같으면 효과가 다시 돌지 않게 한다.
  const key = useMemo(() => {
    if (trip === undefined || trip.deletedAt !== null) return '';
    const order = [dayIndex, ...trip.days.keys()].filter((d, i) => i === 0 || d !== dayIndex);
    const sids = new Set<string>();
    for (const d of order) {
      const day = trip.days[d];
      if (day === undefined) continue;
      for (const stop of visibleStops(library, day)) {
        const place = library.places[stop.placeId];
        const sid = place === undefined ? null : naverSid(place);
        if (sid !== null) sids.add(sid);
      }
    }
    return [...sids].join('\n');
  }, [library, trip, dayIndex]);

  useEffect(() => {
    if (key === '') return;
    forkEffect(requestNeeded(store, key.split('\n')));
  }, [key, store]);
  useOfflineRetry(store, key);
}

/**
 * 화면이 보는 한 장소의 영업시간.
 * - `unsupported`: 네이버 장소가 아니다.
 * - `loading`: 아직 받은 정보도 실패도 없다. `pending`이면 받는 중, 아니면 묻기 전이다(`다시 확인`을 누를 수 있다).
 * - `known`: 받은 정보가 있다(옛것일 수 있음). `pending`은 다시 받는 중, `error`는 마지막 요청의 실패.
 * - `failed`: 받은 정보 없이 실패했다. `pending`이면 다시 묻는 중이다.
 */
export type PlaceHoursView =
  | { kind: 'unsupported' }
  | { kind: 'loading'; pending: boolean }
  | { kind: 'known'; hours: PlaceHours; pending: boolean; error: HoursLookupErrorCode | null }
  | { kind: 'failed'; error: HoursLookupErrorCode; pending: boolean };

/** `request`면 상태가 없어도 곧 물으므로 받는 중으로 본다. */
function viewOf(
  sid: string | null,
  state: HoursState | undefined,
  request: boolean,
): PlaceHoursView {
  if (sid === null) return { kind: 'unsupported' };
  if (state === undefined) return { kind: 'loading', pending: request };
  if (state.hours !== null) {
    return { kind: 'known', hours: state.hours, pending: state.pending, error: state.error };
  }
  if (state.error !== null) return { kind: 'failed', error: state.error, pending: state.pending };
  return { kind: 'loading', pending: state.pending };
}

/**
 * 한 장소의 영업시간 상태와 `다시 확인`(스펙 §2.2). 장소·날짜·시각만 받아 계획 화면 밖에서도 쓸 수 있다.
 * `request`면 상태가 없거나 받은 정보가 7일을 넘었을 때 그 장소 하나를 묻는다(후보 카드). 연결 실패였으면
 * `online` 때 다시 묻는다.
 * `refresh`는 서버 캐시까지 건너뛰고 새로 받는다(`fresh=1`).
 */
export function usePlaceHours(
  place: Place,
  options: { request?: boolean } = {},
): { view: PlaceHoursView; refresh(): void } {
  const store = useStore();
  const sid = naverSid(place);
  // 이 장소의 상태만 구독한다. 다른 장소의 답이 와도 다시 그리지 않는다.
  const stateAtom = useMemo(
    () => selectAtom(hoursStatesAtom, (states) => (sid === null ? undefined : states[sid])),
    [sid],
  );
  const state = useAtomValue(stateAtom);
  const request = options.request === true;
  const missing = state === undefined;

  // 그릴 때 상태가 없거나 받은 정보가 7일을 넘었으면 묻는다. 중단으로 상태가 지워져도(`missing`) 다시 묻는다.
  // 7일 넘음은 의존성에 넣지 않는다: 받은 답이 여전히 7일을 넘어도(기기 시계가 틀림) 거듭 묻지 않게, 들어올
  // 때(마운트)와 상태가 지워질 때만 본다.
  useEffect(() => {
    if (!request || sid === null) return;
    forkEffect(requestNeeded(store, [sid]));
  }, [request, sid, store, missing]);
  useOfflineRetry(store, request && sid !== null ? sid : '');

  const refresh = useCallback(() => {
    if (sid !== null) forkEffect(lookupHours(store, sid, true));
  }, [sid, store]);
  const view = useMemo(() => viewOf(sid, state, request), [sid, state, request]);
  return useMemo(() => ({ view, refresh }), [view, refresh]);
}
