import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider, useAtomValue } from 'jotai';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AppProviders } from 'src/app';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import { exploreFilterAtom } from 'src/sections/explore/store/explore-state';
import { PlacesPanel } from 'src/sections/explore/view/PlacesPanel';
import {
  itineraryEditingAtom,
  memoDraftsAtom,
  stopDraftsAtom,
  searchFocusRequestedAtom,
  tagDraftsAtom,
  viewScrollAtom,
} from 'src/sections/views/store/view-session';
import { TripShareControls } from 'src/sections/views/view/TripShareControls';
import { TripToolbar } from 'src/sections/views/view/TripToolbar';
import { createTripStore, TripStoreContext } from 'src/stores/trip-store';
import { searchQueryAtom, viewModeAtom } from 'src/stores/ui-store';
import { makeEdit, makeTrip } from '../../fixtures/builders';

function Panel({ delayed = false }: { delayed?: boolean }) {
  const view = useAtomValue(viewModeAtom);
  return view === 'places' && !delayed ? <PlacesPanel /> : null;
}
function setup({ delayed = false, view = 'map' as 'map' | 'day' | 'places', shared = false } = {}) {
  const trip = makeTrip({ days: { '2026-11-14': ['A'] } });
  const edit = makeEdit();
  const storage = createMemoryStorage();
  storage.setItem(storageKey('testtrip0001'), JSON.stringify(edit));
  const ts = createTripStore('testtrip0001', { storage, locks: undefined });
  const store = createStore();
  store.set(ts.tripAtom, trip);
  store.set(ts.editLayerAtom, edit);
  store.set(viewModeAtom, view);
  const ui = (delay: boolean) => (
    <AppProviders>
      <TripStoreContext value={ts}>
        <Provider store={store}>
          <MemoryRouter>
            {shared ? <TripShareControls icon="⚙" /> : <TripToolbar />}
            <Panel delayed={delay} />
          </MemoryRouter>
        </Provider>
      </TripStoreContext>
    </AppProviders>
  );
  const rendered = render(ui(delayed));
  return {
    trip,
    edit,
    storage,
    ts,
    store,
    mountPanel: () => rendered.rerender(ui(false)),
    hidePanel: () => rendered.rerender(ui(true)),
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('간결한 상단에도 기존 공유 설정 항목이 남는다', async () => {
  const h = setup();
  expect(screen.getByRole('heading', { name: h.trip.title })).toBeVisible();
  expect(screen.queryByRole('textbox', { name: '검색' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '설정' }));
  expect(screen.getByRole('menuitem', { name: '파일 가져오기' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: '닉네임 변경' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: '내보내기' })).toBeVisible();
});
it('검색은 장소로 전환하고 편집을 종료하며 모든 초안을 보존한다', async () => {
  const h = setup({ view: 'day' });
  const stop = { a000: { date: '2026-11-14', time: '10:00', note: '초안' } };
  act(() => {
    h.store.set(itineraryEditingAtom, true);
    h.store.set(stopDraftsAtom, stop);
    h.store.set(memoDraftsAtom, { 'n:1': '메모 초안' });
    h.store.set(tagDraftsAtom, { 'n:1': '태그 초안' });
    h.store.set(searchQueryAtom, '보존할 검색');
    h.store.set(viewScrollAtom, { map: 10, day: 20, places: 30 });
    h.store.set(exploreFilterAtom, { ...h.store.get(exploreFilterAtom), folderIds: ['saved'] });
  });
  await userEvent.click(screen.getByRole('button', { name: '검색' }));
  expect(h.store.get(viewModeAtom)).toBe('places');
  expect(h.store.get(itineraryEditingAtom)).toBe(false);
  expect(h.store.get(stopDraftsAtom)).toEqual(stop);
  expect(h.store.get(memoDraftsAtom)).toEqual({ 'n:1': '메모 초안' });
  expect(h.store.get(tagDraftsAtom)).toEqual({ 'n:1': '태그 초안' });
  expect(h.store.get(searchQueryAtom)).toBe('보존할 검색');
  expect(h.store.get(viewScrollAtom)).toEqual({ map: 10, day: 20, places: 30 });
  expect(h.store.get(exploreFilterAtom).folderIds).toEqual(['saved']);
  await waitFor(() => expect(screen.getByRole('textbox', { name: '검색' })).toHaveFocus());
});
it('검색 panel이 animation frame 이후 mount되어도 input에 focus한다', async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  const h = setup({ delayed: true });
  await userEvent.click(screen.getByRole('button', { name: '검색' }));
  act(() => frames.forEach((cb) => cb(0)));
  expect(screen.queryByRole('textbox', { name: '검색' })).toBeNull();
  h.mountPanel();
  await waitFor(() => expect(screen.getByRole('textbox', { name: '검색' })).toHaveFocus());
});
it('이미 장소 화면이면 검색 버튼을 다시 눌러 focus한다', async () => {
  setup({ view: 'places' });
  await userEvent.click(screen.getByRole('button', { name: '검색' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '검색' })).toHaveFocus());
});
it('닉네임 변경과 내보내기를 기존 dialog로 연다', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: '설정' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '닉네임 변경' }));
  expect(screen.getByRole('dialog', { name: '닉네임 변경' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: '닉네임' })).toHaveValue(
    h.edit.authors[h.edit.authorId]!.nickname,
  );
  await userEvent.click(screen.getByRole('button', { name: '취소' }));
  await userEvent.click(await screen.findByRole('button', { name: '설정' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '내보내기' }));
  expect(screen.getByRole('dialog', { name: '편집 내보내기' })).toBeVisible();
});

it('성공한 검색 요청은 소비되어 panel 재mount에 focus를 빼앗지 않는다', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: '검색' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '검색' })).toHaveFocus());
  expect(h.store.get(searchFocusRequestedAtom)).toBe(false);
  h.hidePanel();
  screen.getByRole('button', { name: '검색' }).focus();
  h.mountPanel();
  expect(screen.getByRole('button', { name: '검색' })).toHaveFocus();
});
it.each([false, true])(
  '공통 제어=%s: 파일 선택은 가져오기 dialog를 한 번 열고 input 값을 비운다',
  async (shared) => {
    setup({ shared });
    await userEvent.click(screen.getByRole('button', { name: '설정' }));
    const fileInput = screen.getByLabelText('편집 파일 선택') as HTMLInputElement;
    const click = vi.spyOn(fileInput, 'click');
    await userEvent.click(screen.getByRole('menuitem', { name: '파일 가져오기' }));
    expect(click).toHaveBeenCalledOnce();
    await userEvent.upload(fileInput, new File(['{}'], 'edit.json', { type: 'application/json' }));
    expect(await screen.findByRole('dialog', { name: '편집 가져오기' })).toBeVisible();
    expect(screen.getAllByRole('dialog', { name: '편집 가져오기' })).toHaveLength(1);
    expect(fileInput.value).toBe('');
  },
);
it.each([false, true])(
  '공통 제어=%s: hash 가져오기는 한 번 열고 query와 history state를 보존한다',
  async (shared) => {
    const state = { usr: null, key: 'test', idx: 3 };
    window.history.replaceState(state, '', '/t/testtrip0001?view=day#e=invalid');
    setup({ shared });
    expect(await screen.findByRole('dialog', { name: '편집 가져오기' })).toBeVisible();
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?view=day');
    expect(window.history.state).toEqual(state);
    expect(screen.getAllByRole('dialog', { name: '편집 가져오기' })).toHaveLength(1);
    window.history.replaceState(null, '', '/');
  },
);

it('새 상단의 닉네임 저장도 실제 편집 store와 저장소를 갱신한다', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: '설정' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '닉네임 변경' }));
  const input = screen.getByRole('textbox', { name: '닉네임' });
  await userEvent.clear(input);
  await userEvent.type(input, '길동');
  await userEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() =>
    expect(h.store.get(h.ts.editLayerAtom)?.authors[h.edit.authorId]?.nickname).toBe('길동'),
  );
  expect(
    JSON.parse(h.storage.getItem(storageKey('testtrip0001'))!).authors[h.edit.authorId].nickname,
  ).toBe('길동');
});
