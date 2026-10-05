import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { atom, createStore, Provider, useAtomValue } from 'jotai';
import { StrictMode, useLayoutEffect } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, expect, it } from 'vitest';
import { AppProviders } from 'src/app';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { detailAtom, memoDraftsAtom, stopDraftsAtom } from 'src/sections/views/store/view-session';
import { useViewQuerySync } from 'src/sections/views/use-view-query-sync';
import { useUrlPlaceDetailSync } from 'src/sections/views/use-url-place-detail-sync';
import { DetailSurface } from 'src/sections/views/view/DetailSurface';
import { createTripStore, TripStoreContext, type LoadState } from 'src/stores/trip-store';
import { selectedPlaceAtom, searchQueryAtom, viewModeAtom } from 'src/stores/ui-store';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const DATE = '2026-11-14';
afterEach(cleanup);

function setup(place = 'n:1', onLocation?: (search: string) => void) {
  const store = createStore();
  const storage = createMemoryStorage();
  const a = createTripStore('testtrip0001', { storage });
  const b = createTripStore('testtrip0002', { storage });
  const aLoad = atom<LoadState>({ status: 'ready' });
  const bLoad = atom<LoadState>({ status: 'loading' });
  a.loadStateAtom = aLoad;
  b.loadStateAtom = bLoad;
  const trip = makeTrip({ days: { [DATE]: ['A', 'B'] } });
  store.set(a.tripAtom, trip);
  store.set(a.editLayerAtom, makeEdit());
  const ownerAtom = atom(a);
  function Session() {
    const ready = useViewQuerySync();
    useUrlPlaceDetailSync(ready);
    const location = useLocation();
    useLayoutEffect(() => {
      onLocation?.(location.search);
    }, [location.search]);
    return ready ? <DetailSurface modal onClose={() => store.set(detailAtom, null)} /> : null;
  }
  function Sync() {
    const owner = useAtomValue(ownerAtom);
    return (
      <TripStoreContext value={owner}>
        <Session />
      </TripStoreContext>
    );
  }
  const router = createMemoryRouter([{ path: '/', element: <Sync /> }], {
    initialEntries: [`/?view=places&place=${encodeURIComponent(place)}`],
  });
  const ui = render(
    <StrictMode>
      <AppProviders>
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      </AppProviders>
    </StrictMode>,
  );
  const navigate = async (url: string | number) => {
    await act(async () => {
      if (typeof url === 'number') await router.navigate(url);
      else await router.navigate(url);
    });
  };
  return { store, a, b, aLoad, bLoad, trip, ownerAtom, router, ui, navigate };
}

it('초기 URL 상세를 닫으면 선택과 URL을 유지하고 동일 URL·뷰·무관 atom으로 재개방하지 않는다', async () => {
  const h = setup();
  expect(await screen.findByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  const opened: unknown[] = [];
  const unsubscribe = h.store.sub(detailAtom, () => {
    if (h.store.get(detailAtom)) opened.push(h.store.get(detailAtom));
  });
  expect(h.store.get(selectedPlaceAtom)).toBe('n:1');
  expect(h.router.state.location.search).toBe('?view=places&place=n%3A1');
  act(() => h.store.set(searchQueryAtom, 'A'));
  await h.navigate('/?view=places&place=n%3A1');
  await h.navigate('/?view=day&place=n%3A1');
  expect(h.store.get(detailAtom)).toBeNull();
  expect(opened).toEqual([]);
  unsubscribe();
});

it('UI 선택의 URL 반영이 닫기보다 늦어도 상세를 다시 열지 않는다', async () => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  await act(async () => {
    h.store.set(selectedPlaceAtom, 'n:2');
    h.store.set(detailAtom, { kind: 'place', placeKey: 'n:2' });
    h.store.set(detailAtom, null);
  });
  expect(h.router.state.location.search).toBe('?view=places&place=n%3A2');
  expect(h.store.get(selectedPlaceAtom)).toBe('n:2');
  expect(h.store.get(detailAtom)).toBeNull();
  await act(async () => {
    h.store.set(searchQueryAtom, 'B');
    h.store.set(viewModeAtom, 'day');
  });
  expect(h.store.get(detailAtom)).toBeNull();
});

it.each([false, true])(
  '이미 선택한 장소와 같은 외부 URL도 닫힌 상세를 연다(replace=%s)',
  async (replace) => {
    const h = setup();
    await screen.findByRole('dialog', { name: '장소 상세' });
    await act(async () => {
      h.store.set(selectedPlaceAtom, 'n:2');
      h.store.set(detailAtom, null);
      await h.router.navigate('/?view=places&place=n%3A2', { replace });
    });
    expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('B');
  },
);

it('늦은 UI B URL을 무시한 뒤 history 뒤로 A 이동은 상세를 연다', async () => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  await h.navigate('/?view=places&place=n%3A1');
  await act(async () => {
    h.store.set(selectedPlaceAtom, 'n:2');
    h.store.set(detailAtom, { kind: 'place', placeKey: 'n:2' });
    h.store.set(detailAtom, null);
  });
  expect(h.store.get(detailAtom)).toBeNull();
  await h.navigate(-1);
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
});

it('UI에서 쓴 URL도 history 뒤로·앞으로 이동하면 상세를 연다', async () => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  await act(async () => {
    h.store.set(selectedPlaceAtom, 'n:2');
    h.store.set(detailAtom, { kind: 'place', placeKey: 'n:2' });
    h.store.set(detailAtom, null);
  });
  await h.navigate('/?view=places&place=n%3A1');
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  await h.navigate(-1);
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('B');
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  await h.navigate(1);
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
});

it('다른 목표의 UI origin을 보존한 외부 REPLACE는 상세를 연다', async () => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  await act(async () => {
    h.store.set(selectedPlaceAtom, 'n:2');
    h.store.set(detailAtom, { kind: 'place', placeKey: 'n:2' });
    h.store.set(detailAtom, null);
  });
  const state = h.router.state.location.state;
  expect(state).toEqual({ tripMapUiQuery: 'view=places&place=n%3A2' });
  await act(async () => {
    h.store.set(selectedPlaceAtom, 'n:1');
    await h.router.navigate('/?view=places&place=n%3A1', { replace: true, state });
  });
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
});

it('invalid URL로 정리한 상세는 UI 선택만으로 다시 열 수 있다', async () => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  await h.navigate('/?view=places&place=missing');
  expect(h.store.get(detailAtom)).toBeNull();
  await act(async () => h.store.set(selectedPlaceAtom, 'n:1'));
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
});

it('외부 A→B 변경과 실제 history 뒤로·앞으로는 닫힌 상세를 다시 연다', async () => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  await h.navigate('/?view=places&place=n%3A2');
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('B');
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  await h.navigate(-1);
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
  await h.navigate(1);
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('B');
});

it.each(['place', 'add'] as const)('URL 제거는 %s 상세만 닫는다', async (kind) => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  act(() => h.store.set(detailAtom, { kind, placeKey: 'n:1' }));
  await h.navigate('/?view=places');
  expect(h.store.get(detailAtom)).toBeNull();
  expect(h.store.get(selectedPlaceAtom)).toBeNull();
});

it.each([{ kind: 'filter' } as const, { kind: 'stop', date: DATE, stopId: 'a100' } as const])(
  'URL 제거는 $kind 상세와 초안을 유지한다',
  async (detail) => {
    const h = setup();
    await screen.findByRole('dialog', { name: '장소 상세' });
    act(() => {
      h.store.set(detailAtom, detail);
      h.store.set(memoDraftsAtom, { 'n:1': '메모' });
      h.store.set(stopDraftsAtom, { a100: { date: DATE, time: '', note: '방문' } });
    });
    await h.navigate('/?view=places');
    expect(h.store.get(detailAtom)).toEqual(detail);
    expect(h.store.get(memoDraftsAtom)).toEqual({ 'n:1': '메모' });
    expect(h.store.get(stopDraftsAtom).a100?.note).toBe('방문');
  },
);

it.each(['missing', '__proto__', 'constructor', 'toString'])(
  '원본에 없는 %s URL은 보존하고 선택과 상세를 비운다',
  async (place) => {
    const h = setup(place);
    expect(h.store.get(selectedPlaceAtom)).toBeNull();
    expect(h.store.get(detailAtom)).toBeNull();
    expect(h.router.state.location.search).toContain(`place=${place}`);
    act(() => h.store.set(selectedPlaceAtom, 'n:1'));
    expect(await screen.findByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
    expect(h.router.state.location.search).toContain('place=n%3A1');
  },
);

it('import의 phantom 장소는 원본 검사를 통과하지 않고 닫은 유효 상세도 재개방하지 않는다', async () => {
  const h = setup('phantom');
  const imported = makeEdit();
  imported.places.phantom = { memos: {} };
  act(() => h.store.set(h.a.editLayerAtom, imported));
  expect(h.store.get(selectedPlaceAtom)).toBeNull();
  expect(h.store.get(detailAtom)).toBeNull();
  await h.navigate('/?view=places&place=n%3A1');
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  act(() => h.store.set(h.a.editLayerAtom, makeEdit()));
  expect(h.store.get(detailAtom)).toBeNull();
});

it('날짜가 같은 새 원본 snapshot에서 URL 장소가 사라지면 선택과 상세를 정리한다', async () => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  const next = { ...h.trip, places: { 'n:2': h.trip.places['n:2']! } };
  act(() => h.store.set(h.a.tripAtom, next));
  expect(h.store.get(selectedPlaceAtom)).toBeNull();
  expect(h.store.get(detailAtom)).toBeNull();
  expect(h.router.state.location.search).toContain('place=n%3A1');
});

it('동일 ID 새 ready load는 닫은 상세를 다시 열고 loading 중 모든 상세만 정리한다', async () => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  act(() => h.store.set(h.aLoad, { status: 'ready' }));
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
  act(() => {
    h.store.set(detailAtom, { kind: 'filter' });
    h.store.set(memoDraftsAtom, { 'n:1': '초안' });
    h.store.set(h.aLoad, { status: 'loading' });
  });
  expect(h.store.get(detailAtom)).toBeNull();
  expect(h.store.get(memoDraftsAtom)).toEqual({ 'n:1': '초안' });
  await h.navigate('/?view=places&place=n%3A2');
  act(() => h.store.set(h.aLoad, { status: 'ready' }));
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('B');
});

it('같은 Provider의 A→B 지연 owner 전환은 최신 URL만 연다', async () => {
  const h = setup();
  await screen.findByRole('dialog', { name: '장소 상세' });
  act(() => h.store.set(h.ownerAtom, h.b));
  expect(h.store.get(detailAtom)).toBeNull();
  await h.navigate('/?view=places&place=n%3A2');
  act(() => {
    h.store.set(h.b.tripAtom, { ...h.trip, publicId: h.b.publicId });
    h.store.set(h.b.editLayerAtom, makeEdit());
    h.store.set(h.bLoad, { status: 'ready' });
  });
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toHaveTextContent('B');
  expect(h.store.get(selectedPlaceAtom)).toBe('n:2');
});

it('UI B URL commit 직후 C를 열고 닫아도 늦은 B·C URL은 상세를 재개방하지 않는다', async () => {
  let changed = false;
  let closedLatest = false;
  const h = setup('n:1', (search) => {
    if (!search.includes('place=n%3A2') || changed) return;
    changed = true;
    h.store.set(selectedPlaceAtom, 'n:1');
    h.store.set(detailAtom, { kind: 'place', placeKey: 'n:1' });
    h.store.set(detailAtom, null);
    closedLatest = true;
  });
  await screen.findByRole('dialog', { name: '장소 상세' });
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  const reopened: unknown[] = [];
  const unsubscribe = h.store.sub(detailAtom, () => {
    if (closedLatest && h.store.get(detailAtom)) reopened.push(h.store.get(detailAtom));
  });
  await act(async () => {
    h.store.set(selectedPlaceAtom, 'n:2');
    h.store.set(detailAtom, { kind: 'place', placeKey: 'n:2' });
  });
  unsubscribe();
  expect(changed).toBe(true);
  expect(reopened).toEqual([]);
  expect(h.store.get(selectedPlaceAtom)).toBe('n:1');
  expect(h.store.get(detailAtom)).toBeNull();
  expect(screen.queryByRole('dialog', { name: '장소 상세' })).toBeNull();
});
