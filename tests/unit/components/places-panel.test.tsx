import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AppProviders } from 'src/app';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import {
  exploreFilterAtom,
  mapBoundsAtom,
  mapFocusAtom,
  mapViewportUsableAtom,
} from 'src/sections/explore/store/explore-state';
import { DEFAULT_FILTER } from 'src/sections/explore/store/filters';
import { ExploreFilters } from 'src/sections/explore/view/ExploreFilters';
import { placeScrollAckAtom } from 'src/sections/explore/view/virtual-place-state';
import { PlacesPanel } from 'src/sections/explore/view/PlacesPanel';
import { ExplorePanel } from 'src/sections/explore/view/ExplorePanel';
import { detailAtom, selectedPlaceScrollRequestAtom } from 'src/sections/views/store/view-session';
import { createTripStore, TripStoreContext } from 'src/stores/trip-store';
import { selectedPlaceAtom, searchQueryAtom, viewModeAtom } from 'src/stores/ui-store';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const D1 = '2026-11-14';
const D2 = '2026-11-15';
const NOW = '2026-10-03T02:00:00.000Z';
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: () => {},
  });
});
afterEach(cleanup);

function setup(
  trip: TripData,
  edit: EditLayer,
  child: ReactNode,
  initial?: (store: ReturnType<typeof createStore>) => void,
) {
  const storage = createMemoryStorage();
  storage.setItem(storageKey('testtrip0001'), JSON.stringify(edit));
  const ts = createTripStore('testtrip0001', {
    storage,
    locks: undefined,
    now: () => 1759460000000,
    nowIso: () => NOW,
  });
  const store = createStore();
  store.set(ts.tripAtom, trip);
  store.set(ts.editLayerAtom, edit);
  initial?.(store);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProviders>
      <TripStoreContext value={ts}>
        <Provider store={store}>{children}</Provider>
      </TripStoreContext>
    </AppProviders>
  );
  return { store, ts, storage, ...render(child, { wrapper }), wrapper };
}

it('compact 요약 행은 공통 상세를 열고 inline 메모 폼을 만들지 않는다', async () => {
  const { store } = setup(makeTrip({ days: { [D1]: ['A'] } }), makeEdit(), <ExplorePanel />);
  await userEvent.click(screen.getByRole('button', { name: 'A 상세' }));
  expect(store.get(selectedPlaceAtom)).toBe('n:1');
  expect(store.get(detailAtom)).toEqual({ kind: 'place', placeKey: 'n:1' });
  expect(store.get(mapFocusAtom)?.seq).toBe(1);
  expect(store.get(selectedPlaceScrollRequestAtom)).toBe(1);
  expect(screen.queryByLabelText('내 메모')).toBeNull();
});

it('compact 목록 초기 mount와 remount는 복원한 스크롤을 방해하지 않고 새 요청만 스크롤한다', async () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  const { store, unmount, wrapper } = setup(
    makeTrip({ days: { [D1]: ['A'] } }),
    makeEdit(),
    <ExplorePanel />,
    (s) => {
      s.set(selectedPlaceAtom, 'n:1');
      s.set(selectedPlaceScrollRequestAtom, 5);
      s.set(placeScrollAckAtom, 5);
    },
  );
  expect(scroll).not.toHaveBeenCalled();
  act(() => store.set(selectedPlaceScrollRequestAtom, 6));
  await waitFor(() => expect(store.get(placeScrollAckAtom)).toBe(6));
  expect(scroll).toHaveBeenCalledTimes(1);
  unmount();
  render(<ExplorePanel />, { wrapper });
  expect(scroll).toHaveBeenCalledTimes(1);
  act(() => store.set(selectedPlaceAtom, null));
  expect(scroll).toHaveBeenCalledTimes(1);
  act(() => {
    store.set(selectedPlaceAtom, 'n:1');
    store.set(selectedPlaceScrollRequestAtom, 7);
  });
  await waitFor(() => expect(store.get(placeScrollAckAtom)).toBe(7));
  expect(scroll).toHaveBeenCalledTimes(2);
  scroll.mockRestore();
});

it('compact 요약은 실제 실효 일정 badge와 메모 preview를 보인다', () => {
  const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['A'] } });
  const edit = makeEdit({
    places: { 'n:1': { memos: { 'a-local': { text: '내 메모 내용', updatedAt: NOW } } } },
  });
  edit.days[D1] = { mode: 'override', stops: [], baseDayHash: 'x', updatedAt: NOW };
  setup(trip, edit, <ExplorePanel />);
  expect(screen.getByText('내 메모 내용')).toBeInTheDocument();
  expect(screen.getByText(/Day 2/)).toBeInTheDocument();
  expect(screen.queryByText(/Day 1/)).toBeNull();
});

it('compact 숨겨진 지도 bounds는 places/day 결과를 비우지 않고 체크 의도를 유지한다', () => {
  const { store } = setup(
    makeTrip({ days: { [D1]: ['A'] } }),
    makeEdit(),
    <ExplorePanel />,
    (s) => {
      s.set(viewModeAtom, 'places');
      s.set(exploreFilterAtom, { ...DEFAULT_FILTER, inViewOnly: true });
      s.set(mapBoundsAtom, { west: 0, south: 0, east: 1, north: 1 });
    },
  );
  expect(screen.getByRole('button', { name: 'A 상세' })).toBeInTheDocument();
  act(() => store.set(viewModeAtom, 'day'));
  expect(screen.getByRole('button', { name: 'A 상세' })).toBeInTheDocument();
  expect(store.get(exploreFilterAtom).inViewOnly).toBe(true);
});

it('최종 탐색은 공통 상세를 열고 준비된 지도 영역 필터를 적용한다', async () => {
  const { store } = setup(makeTrip({ days: { [D1]: ['A'] } }), makeEdit(), <ExplorePanel />);
  await userEvent.click(screen.getByRole('button', { name: 'A 상세' }));
  expect(store.get(detailAtom)).toEqual({ kind: 'place', placeKey: 'n:1' });
  act(() => {
    store.set(exploreFilterAtom, { ...DEFAULT_FILTER, inViewOnly: true });
    store.set(mapBoundsAtom, { west: 0, south: 0, east: 1, north: 1 });
    store.set(mapViewportUsableAtom, true);
  });
  expect(screen.getByText('조건에 맞는 장소가 없어요')).toBeInTheDocument();
});

async function setupPlaces(
  trip = makeTrip({ days: { [D1]: ['A'] }, places: ['B'] }),
  edit = makeEdit(),
  initial?: Parameters<typeof setup>[3],
) {
  return setup(trip, edit, <PlacesPanel />, initial);
}

it('카드 빠른 추가는 날짜 선택 패널을 열며 편집 데이터를 변경하지 않는다', async () => {
  const { store, ts, storage } = await setupPlaces();
  const saved = storage.getItem(storageKey('testtrip0001'));
  const before = store.get(ts.editLayerAtom);
  await userEvent.click(screen.getByRole('button', { name: 'B 일정에 추가' }));
  expect(store.get(detailAtom)).toEqual({ kind: 'add', placeKey: 'n:2' });
  expect(store.get(ts.editLayerAtom)).toEqual(before);
  expect(storage.getItem(storageKey('testtrip0001'))).toBe(saved);
});

it('카드를 열어도 목록 안에 메모 편집 폼을 중복 생성하지 않는다', async () => {
  const { store } = await setupPlaces();
  await userEvent.click(screen.getByRole('button', { name: 'A 상세' }));
  expect(store.get(selectedPlaceAtom)).toBe('n:1');
  expect(store.get(detailAtom)).toEqual({ kind: 'place', placeKey: 'n:1' });
  expect(screen.queryByLabelText('내 메모')).toBeNull();
  expect(screen.queryByTestId('place-card-n:1')).toBeNull();
});

it('카드와 목록이 같은 메모 검색 및 실효 일정 badge를 표시한다', async () => {
  const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['A'] }, places: ['B'] });
  const edit = makeEdit({
    places: { 'n:1': { memos: { 'a-local': { text: '웨이팅 길다', updatedAt: NOW } } } },
  });
  edit.days[D1] = { mode: 'override', stops: [], baseDayHash: 'x', updatedAt: NOW };
  const { store } = await setupPlaces(trip, edit);
  expect(screen.getByText(/Day 2/)).toBeInTheDocument();
  expect(screen.queryByText(/Day 1/)).toBeNull();
  await userEvent.type(screen.getByRole('textbox', { name: '검색' }), '웨이팅');
  expect(screen.getByRole('button', { name: 'A 상세' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'B 상세' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '목록' }));
  expect(store.get(searchQueryAtom)).toBe('웨이팅');
  expect(
    within(screen.getByRole('list', { name: '장소 목록' })).getByText('웨이팅 길다'),
  ).toBeInTheDocument();
  expect(screen.getByText(/Day 2/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '카드' }));
  expect(screen.getByRole('button', { name: 'A 일정에 추가' })).toBeInTheDocument();
});

it('상위 세 카테고리와 폴더는 실제 데이터의 서로 다른 필터로 연결된다', async () => {
  const trip = makeTrip({ days: { [D1]: ['A'] }, places: ['B', 'C', 'D', 'E'] });
  trip.folders = [{ id: 'f1', name: '보관함', count: 5 }];
  trip.places['n:2']!.category = '카페';
  trip.places['n:3']!.category = '카페';
  trip.places['n:4']!.category = '공원';
  trip.places['n:5']!.category = '호텔';
  const { store } = await setupPlaces(trip);
  expect(screen.getAllByRole('button', { name: /^(카페|공원|음식점|호텔)$/ })).toHaveLength(3);
  await userEvent.click(screen.getByRole('button', { name: '카페' }));
  expect(store.get(exploreFilterAtom).categories).toEqual(['카페']);
  expect(store.get(exploreFilterAtom).folderIds).toEqual([]);
  expect(screen.queryByRole('button', { name: 'A 상세' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '보관함' }));
  expect(store.get(exploreFilterAtom).folderIds).toEqual(['f1']);
  expect(store.get(exploreFilterAtom).categories).toEqual(['카페']);
});

it('필터 badge는 모든 상세 조건과 검색을 세고 해제하면 검색도 비운다', async () => {
  const { store } = await setupPlaces(undefined, undefined, (s) => {
    s.set(exploreFilterAtom, {
      ...DEFAULT_FILTER,
      folderIds: ['f1'],
      categories: ['음식점'],
      tags: ['야경'],
      hasMemo: true,
      inItinerary: 'in',
      showHidden: true,
      inViewOnly: true,
    });
    s.set(searchQueryAtom, '메모');
  });
  await userEvent.click(screen.getByRole('button', { name: '필터 8' }));
  expect(store.get(detailAtom)).toEqual({ kind: 'filter' });
  await userEvent.click(screen.getByRole('button', { name: '모두 해제' }));
  expect(store.get(exploreFilterAtom)).toEqual(DEFAULT_FILTER);
  expect(store.get(searchQueryAtom)).toBe('');
  expect(screen.queryByRole('button', { name: '모두 해제' })).toBeNull();
});

it('새 경로는 usable 지도에서만 영역 필터를 적용하고 상세 체크 의도를 보존한다', async () => {
  const { store, rerender } = await setupPlaces(undefined, undefined, (s) => {
    s.set(exploreFilterAtom, { ...DEFAULT_FILTER, inViewOnly: true });
    s.set(mapBoundsAtom, { west: 0, south: 0, east: 1, north: 1 });
  });
  expect(screen.getByRole('button', { name: 'A 상세' })).toBeInTheDocument();
  act(() => store.set(mapViewportUsableAtom, true));
  expect(screen.getByText('조건에 맞는 장소가 없어요')).toBeInTheDocument();
  act(() => store.set(viewModeAtom, 'places'));
  expect(screen.getByRole('button', { name: 'A 상세' })).toBeInTheDocument();
  rerender(<ExploreFilters />);
  expect(screen.getByRole('checkbox', { name: '지도 영역 안만 보기' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: '지도 영역 안만 보기' })).toBeChecked();
  expect(screen.getByText('지도 보기에서 적용돼요')).toBeInTheDocument();
  act(() => store.set(viewModeAtom, 'map'));
  expect(screen.getByRole('checkbox', { name: '지도 영역 안만 보기' })).toBeEnabled();
  act(() => store.set(mapViewportUsableAtom, false));
  expect(screen.getByRole('checkbox', { name: '지도 영역 안만 보기' })).toBeDisabled();
  expect(store.get(exploreFilterAtom).inViewOnly).toBe(true);
});

it.each([
  ['주소', '주소 B', 'B'],
  ['네이버 메모', 'Ocean', 'B'],
  ['태그', '야경', 'B'],
])('장소 카드 검색은 기존 %s 검색도 공유한다', async (_kind, query, name) => {
  const trip = makeTrip({ days: { [D1]: ['A'] }, places: ['B'] });
  trip.places['n:2']!.naverMemos = [{ folderId: 'f1', memo: 'Ocean view' }];
  const edit = makeEdit({
    places: { 'n:2': { memos: {}, tags: { value: ['야경'], updatedAt: NOW } } },
  });
  await setupPlaces(trip, edit);
  await userEvent.type(screen.getByRole('textbox', { name: '검색' }), query);
  expect(screen.getByRole('button', { name: `${name} 상세` })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'A 상세' })).toBeNull();
});

it('목록의 같은 장소 재선택도 새 지도 및 스크롤 요청을 보낸다', async () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  const { store } = setup(makeTrip({ days: { [D1]: ['A'] } }), makeEdit(), <ExplorePanel />);
  const row = screen.getByRole('button', { name: 'A 상세' });
  await userEvent.click(row);
  await userEvent.click(row);
  expect(store.get(mapFocusAtom)?.seq).toBe(2);
  expect(store.get(selectedPlaceScrollRequestAtom)).toBe(2);
  expect(scroll).toHaveBeenCalledTimes(2);
  scroll.mockRestore();
});

it('숨김 포함 카드와 목록은 숨김 표기를 보존하고 목록 추가도 날짜 패널을 연다', async () => {
  const edit = makeEdit({
    places: { 'n:2': { memos: {}, hidden: { value: true, updatedAt: NOW } } },
  });
  const { store } = await setupPlaces(undefined, edit);
  expect(screen.queryByRole('button', { name: 'B 상세' })).toBeNull();
  act(() => store.set(exploreFilterAtom, { ...DEFAULT_FILTER, showHidden: true }));
  expect(
    within(screen.getByRole('button', { name: 'B 상세' })).getByText(/숨김/),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '목록' }));
  expect(
    within(screen.getByRole('button', { name: 'B 상세' })).getByText(/숨김/),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'B 일정에 추가' }));
  expect(store.get(detailAtom)).toEqual({ kind: 'add', placeKey: 'n:2' });
});

it('바꾼 분류가 목록 표시와 분류 칩·필터에 반영된다', async () => {
  const trip = makeTrip({ days: { [D1]: ['A'] }, places: ['B'] });
  trip.places['n:2']!.category = null;
  const edit = makeEdit({
    places: { 'n:2': { memos: {}, category: { value: '공항', updatedAt: NOW } } },
  });
  const { store, rerender } = setup(trip, edit, <ExplorePanel />);
  const row = screen.getByRole('button', { name: 'B 상세' });
  expect(within(row).getByText(/공항/)).toBeInTheDocument();
  expect(within(row).queryByText(/미분류/)).toBeNull();
  rerender(<ExploreFilters />);
  const chip = screen.getByRole('button', { name: '공항 1' });
  expect(screen.queryByRole('button', { name: /미분류/ })).toBeNull();
  await userEvent.click(chip);
  expect(store.get(exploreFilterAtom).categories).toEqual(['공항']);
});
