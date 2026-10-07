import { act, cleanup, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import { categoryColor } from 'src/components/map/map-colors';
import { useExploreMarkers } from 'src/sections/explore/store/explore-state';
import * as filters from 'src/sections/explore/store/filters';
import { createTripStore, TripStoreContext } from 'src/stores/trip-store';
import { searchQueryAtom, selectedPlaceAtom, viewModeAtom } from 'src/stores/ui-store';
import { makeEdit, makeTrip } from '../../fixtures/builders';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const ts = createTripStore('testtrip0001');
  const store = createStore();
  store.set(ts.tripAtom, makeTrip({ days: { '2026-11-14': ['A', 'B'] } }));
  store.set(viewModeAtom, 'places');
  const filter = vi.spyOn(filters, 'filterPlaces');
  function Markers() {
    const markers = useExploreMarkers();
    return <output data-testid="markers">{JSON.stringify(markers)}</output>;
  }
  render(
    <TripStoreContext value={ts}>
      <Provider store={store}>
        <Markers />
      </Provider>
    </TripStoreContext>,
  );
  return { store, filter, editAtom: ts.editLayerAtom };
}

it('장소 화면의 검색 변경은 비활성 지도의 필터·마커 계산을 실행하지 않는다', () => {
  const { store, filter } = setup();
  expect(screen.getByTestId('markers')).toHaveTextContent('[]');
  expect(filter).not.toHaveBeenCalled();
  act(() => store.set(searchQueryAtom, 'A'));
  expect(filter).not.toHaveBeenCalled();
  expect(screen.getByTestId('markers')).toHaveTextContent('[]');
});

it('숨긴 지도에 복귀하면 현재 검색과 선택을 적용하고 숨긴 동안의 마커를 재사용하지 않는다', () => {
  const { store, filter } = setup();
  act(() => {
    store.set(searchQueryAtom, 'A');
    store.set(selectedPlaceAtom, 'n:1');
    store.set(viewModeAtom, 'map');
  });
  let markers = JSON.parse(screen.getByTestId('markers').textContent!);
  expect(markers).toHaveLength(1);
  expect(markers[0]).toMatchObject({ id: 'n:1', selected: true });
  filter.mockClear();
  act(() => store.set(viewModeAtom, 'places'));
  act(() => {
    store.set(searchQueryAtom, 'B');
    store.set(selectedPlaceAtom, 'n:2');
  });
  expect(filter).not.toHaveBeenCalled();
  expect(screen.getByTestId('markers')).toHaveTextContent('[]');
  act(() => store.set(viewModeAtom, 'map'));
  markers = JSON.parse(screen.getByTestId('markers').textContent!);
  expect(markers).toHaveLength(1);
  expect(markers[0]).toMatchObject({ id: 'n:2', selected: true });
});

it('지도 마커 색은 편집 레이어에서 바꾼 분류를 따른다', () => {
  const { store, editAtom } = setup();
  act(() => store.set(viewModeAtom, 'map'));
  let markers = JSON.parse(screen.getByTestId('markers').textContent!);
  expect(markers[0]).toMatchObject({ id: 'n:1', color: categoryColor('음식점') });
  expect(categoryColor('공항')).not.toBe(categoryColor('음식점'));
  act(() =>
    store.set(
      editAtom,
      makeEdit({
        places: {
          'n:1': { memos: {}, category: { value: '공항', updatedAt: '2026-10-03T00:00:00.000Z' } },
        },
      }),
    ),
  );
  markers = JSON.parse(screen.getByTestId('markers').textContent!);
  expect(markers[0]).toMatchObject({ id: 'n:1', color: categoryColor('공항') });
});
