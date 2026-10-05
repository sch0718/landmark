import { act, cleanup, render, screen } from '@testing-library/react';
import { atom, createStore, Provider, useAtomValue } from 'jotai';
import { Suspense } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, expect, it } from 'vitest';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { useViewQuerySync } from 'src/sections/views/use-view-query-sync';
import { useUrlPlaceDetailSync } from 'src/sections/views/use-url-place-detail-sync';
import { detailAtom } from 'src/sections/views/store/view-session';
import { createTripStore, TripStoreContext } from 'src/stores/trip-store';
import { selectedPlaceAtom, viewModeAtom } from 'src/stores/ui-store';
import { readPreferredView } from 'src/sections/views/store/ui-preferences';
import { makeTrip } from '../../fixtures/builders';

afterEach(cleanup);

function setup(initialEntries = ['/?view=places'], childDetail = false) {
  const store = createStore();
  const storage = createMemoryStorage();
  const tripStore = createTripStore('testtrip0001', { storage });
  store.set(tripStore.tripAtom, makeTrip({ days: { '2026-11-14': ['A'] } }));
  tripStore.loadStateAtom = atom({ status: 'ready' } as const);
  let release!: () => void;
  let blocked = true;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  function RenderGate() {
    const location = useLocation();
    if (blocked && location.search.includes('view=day')) throw pending;
    return null;
  }
  function Session() {
    const ready = useViewQuerySync();
    const view = useAtomValue(viewModeAtom);
    return (
      <>
        {childDetail && <DetailSession ready={ready} />}
        {ready && <output data-testid="view">{view}</output>}
      </>
    );
  }
  function DetailSession({ ready }: { ready: boolean }) {
    useUrlPlaceDetailSync(ready);
    const detail = useAtomValue(detailAtom);
    return <output data-testid="detail">{detail?.kind === 'place' ? detail.placeKey : ''}</output>;
  }
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <>
            <Session />
            <RenderGate />
          </>
        ),
      },
    ],
    { initialEntries },
  );
  render(
    <Provider store={store}>
      <TripStoreContext value={tripStore}>
        <Suspense fallback={<span>loading</span>}>
          <RouterProvider router={router} />
        </Suspense>
      </TripStoreContext>
    </Provider>,
  );
  const unblock = async () => {
    await act(async () => {
      blocked = false;
      release();
    });
  };
  return { store, storage, router, unblock };
}

it('늦게 렌더링되는 일정 URL은 더 최근의 장소 전환을 덮어쓰지 않는다', async () => {
  const { store, storage, router, unblock } = setup();
  expect(await screen.findByTestId('view')).toHaveTextContent('places');
  await act(async () => store.set(viewModeAtom, 'day'));
  expect(router.state.location.search).toContain('view=day');
  await act(async () => store.set(viewModeAtom, 'places'));
  await unblock();
  expect(store.get(viewModeAtom)).toBe('places');
  expect(screen.getByTestId('view')).toHaveTextContent('places');
  expect(router.state.location.search).toBe('?view=places');
  expect(readPreferredView(storage, 'testtrip0001')).toBe('places');
});

it('URL 반영 대기 중 장소를 선택하면 최신 뷰와 장소를 함께 반영한다', async () => {
  const { store, router, unblock } = setup();
  await screen.findByTestId('view');
  await act(async () => store.set(viewModeAtom, 'day'));
  await act(async () => store.set(selectedPlaceAtom, 'n:1'));
  await unblock();
  expect(store.get(viewModeAtom)).toBe('day');
  expect(store.get(selectedPlaceAtom)).toBe('n:1');
  expect(router.state.location.search).toBe('?view=day&day=all&place=n%3A1');
});

it('UI URL 반영 대기 중의 외부 REPLACE는 이전 origin을 보존해도 새 URL을 적용한다', async () => {
  const { store, storage, router, unblock } = setup();
  await screen.findByTestId('view');
  await act(async () => store.set(viewModeAtom, 'day'));
  const state = router.state.location.state;
  await act(async () => {
    await router.navigate('/?view=map&place=n%3A1&x=1', { replace: true, state });
  });
  await unblock();
  expect(store.get(viewModeAtom)).toBe('map');
  expect(store.get(selectedPlaceAtom)).toBe('n:1');
  expect(router.state.location.search).toBe('?view=map&place=n%3A1&x=1');
  expect(readPreferredView(storage, 'testtrip0001')).toBe('map');
});

it.each(['REPLACE', 'PUSH', 'POP'] as const)(
  'UI URL 반영 대기 중 같은 committed URL로의 외부 %s는 선택을 되돌린다',
  async (navigation) => {
    const { store, storage, router, unblock } = setup(['/?view=places', '/?view=places']);
    await screen.findByTestId('view');
    const committedKey = router.state.location.key;
    await act(async () => store.set(viewModeAtom, 'day'));
    expect(router.state.location.search).toContain('view=day');
    const state = router.state.location.state;
    await act(async () => {
      if (navigation === 'POP') await router.navigate(-1);
      else await router.navigate('/?view=places', { replace: navigation === 'REPLACE', state });
    });
    await unblock();
    expect(router.state.location.key).not.toBe(committedKey);
    expect(router.state.location.search).toBe('?view=places');
    expect(store.get(viewModeAtom)).toBe('places');
    expect(screen.getByTestId('view')).toHaveTextContent('places');
    expect(readPreferredView(storage, 'testtrip0001')).toBe('places');
  },
);

it('자식 상세 동기화가 먼저 실행되어도 외부 URL의 최신 선택을 반영해 상세를 연다', async () => {
  const { store, router, unblock } = setup(undefined, true);
  await screen.findByTestId('view');
  await act(async () => store.set(viewModeAtom, 'day'));
  const query = 'view=map&place=n%3A1';
  await act(async () => {
    await router.navigate(`/?${query}`, { replace: true, state: { tripMapUiQuery: query } });
  });
  await unblock();
  expect(store.get(selectedPlaceAtom)).toBe('n:1');
  expect(store.get(detailAtom)).toEqual({ kind: 'place', placeKey: 'n:1' });
  expect(screen.getByTestId('detail')).toHaveTextContent('n:1');
  expect(router.state.location.search).toBe(`?${query}`);
});
