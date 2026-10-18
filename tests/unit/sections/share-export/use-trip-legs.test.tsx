import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayLegs, type Leg } from 'src/domain/trips/query';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { useTripLegs } from 'src/sections/share-export/use-trip-legs';
import { routeKeyOf } from 'src/sections/trips/planner/use-day-plan';
import { libraryAtom } from 'src/stores/library-state';
import { routeStatesAtom } from 'src/stores/trip-planner';
import { makePlace, withPlaces } from '../library/fixtures';
import {
  at,
  fakeRoutes,
  HOUSE,
  makeTrip,
  open,
  P1,
  P2,
  P3,
  P5,
  plannerLibrary,
  route,
  TRIP,
  withTrip,
} from '../trips/planner-fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

// P1과 같은 좌표의 가게: P1 → NEAR는 같은 지점 구간이다.
const NEAR = 'place00007';

/**
 * Day 1: P1 → NEAR(같은 지점) → P2 → P5 → HOUSE(숙소), Day 2: HOUSE → P3.
 * 같은 지점이 아닌 구간: NEAR→P2, P2→P5, P5→HOUSE, HOUSE→P3 (4개).
 */
function library() {
  const base = plannerLibrary();
  const lib = withPlaces(base, [at(makePlace(7, { name: '옆 가게' }), 128.9, 37.75)]);
  return withTrip(lib, makeTrip({ stops: [[P1, NEAR, P2, P5], [P3]], lodging: [HOUSE] }));
}

async function setup(answer: Parameters<typeof fakeRoutes>[0], active: boolean) {
  const routes = fakeRoutes(answer);
  // 앱은 목록에 두고(런타임·보관함 준비), 같은 저장소로 훅만 따로 그린다.
  const { store } = await open(library(), { routes, path: '/trips' });
  const lib = store.get(libraryAtom);
  const trip = lib.trips[TRIP]!;
  const legs: Leg[] = [...dayLegs(lib, trip, 0), ...dayLegs(lib, trip, 1)];
  const legBetween = (from: string, to: string) =>
    legs.find((l) => l.from.id === from && l.to.id === to)!;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(({ on }: { on: boolean }) => useTripLegs(TRIP, on), {
    wrapper,
    initialProps: { on: active },
  });
  return { routes, store, legBetween, hook };
}

describe('useTripLegs', () => {
  it('active가 아니면 묻지 않고, 답이 없는 구간은 어림값·같은 지점은 same-point다', async () => {
    const { routes, legBetween, hook } = await setup(() => route(12, 1100), false);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(routes.calls).toHaveLength(0);

    const legs = hook.result.current;
    expect(legs.total).toBe(4);
    expect(legs.answered).toBe(0);
    expect(legs.estimated).toBe(0);
    expect(legs.oldestQueriedAt).toBeNull();

    expect(legs.routeOf(legBetween(P1, NEAR))).toEqual({
      durationS: 0,
      distanceM: 0,
      tollFare: null,
      status: 'same-point',
      queriedAt: null,
      path: [],
    });
    const pending = legs.routeOf(legBetween(NEAR, P2));
    expect(pending.status).toBe('estimated');
    expect(pending.queriedAt).toBeNull();
    expect(pending.tollFare).toBeNull();
    expect(pending.durationS).toBeGreaterThan(0);
  });

  it('열면 상태가 없는 구간만 묻고, 네 갈래 상태를 공유 상태로 바꾼다', async () => {
    const { routes, store, legBetween, hook } = await setup((call) => {
      if (call.from === '안목 카페거리')
        return route(20, 3900, { queriedAt: '2026-10-17T03:00:00.000Z' });
      if (call.to === '바다 숙소') return 'NO_ROUTE';
      return 'UPSTREAM_ERROR';
    }, false);

    // NEAR → P2는 이미 받은 경로가 있다(묻지 않는다).
    const known = legBetween(NEAR, P2);
    act(() => {
      store.set(routeStatesAtom, {
        [routeKeyOf(known)]: {
          seq: 0,
          status: 'routed',
          result: {
            ...route(9, 4800, { toll: 1200, queriedAt: '2026-10-16T03:00:00.000Z' }),
          },
        },
      });
    });

    hook.rerender({ on: true });
    await waitFor(() => expect(hook.result.current.answered).toBe(4));
    expect(routes.calls.map((c) => `${c.from}→${c.to}`).sort()).toEqual(
      ['안목 카페거리→창가 자리', '창가 자리→바다 숙소', '바다 숙소→속초 횟집'].sort(),
    );
    expect(routes.calls.every((c) => !c.refresh)).toBe(true);

    const legs = hook.result.current;
    expect(legs.total).toBe(4);
    expect(legs.estimated).toBe(2);
    expect(legs.oldestQueriedAt).toBe('2026-10-16T03:00:00.000Z');

    expect(legs.routeOf(known)).toEqual({
      durationS: 9 * 60,
      distanceM: 4800,
      tollFare: 1200,
      status: 'routed',
      queriedAt: '2026-10-16T03:00:00.000Z',
      path: [
        [128.9, 37.75],
        [128.947, 37.772],
      ],
    });
    expect(legs.routeOf(legBetween(P2, P5))).toMatchObject({
      status: 'routed',
      durationS: 20 * 60,
      queriedAt: '2026-10-17T03:00:00.000Z',
    });
    const noRoute = legs.routeOf(legBetween(P5, HOUSE));
    expect(noRoute).toMatchObject({ status: 'no-route', queriedAt: null, tollFare: null });
    expect(noRoute.durationS).toBeGreaterThan(0);
    const failed = legs.routeOf(legBetween(HOUSE, P3));
    expect(failed).toMatchObject({ status: 'estimated', queriedAt: null, tollFare: null });
    expect(failed.durationS).toBeGreaterThan(0);
  });

  it('연결 실패도 답으로 세고(answered) 어림값으로 넣는다', async () => {
    const { hook, legBetween } = await setup(() => 'OFFLINE', true);
    await waitFor(() => expect(hook.result.current.answered).toBe(4));
    expect(hook.result.current.estimated).toBe(4);
    expect(hook.result.current.oldestQueriedAt).toBeNull();
    expect(hook.result.current.routeOf(legBetween(P2, P5)).status).toBe('estimated');
  });
});
