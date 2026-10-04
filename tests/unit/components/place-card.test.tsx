import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from 'src/app';
import { findDuplicateStopIds, overlay } from 'src/domain/overlay';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import { routes } from 'src/routes/router';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import { DEFAULT_FILTER } from 'src/sections/explore/store/filters';
import { exploreFilterAtom } from 'src/sections/explore/store/explore-state';
import { ExploreFilters } from 'src/sections/explore/view/ExploreFilters';
import { PlaceCard } from 'src/sections/explore/view/PlaceCard';
import { createTripStore, TripDepsContext, TripStoreContext } from 'src/stores/trip-store';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';

const PID = 'testtrip0001';
const KEY = storageKey(PID);
const NOW_MS = 1759460000000;
const NOW = '2026-10-03T02:00:00.000Z';
const OLD = '2026-10-03T00:30:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';
const XSS = '<img src=x onerror=alert(1)>';

const saved = (storage: Storage): EditLayer => JSON.parse(storage.getItem(KEY)!) as EditLayer;

function setupCard(trip: TripData, edit: EditLayer, placeKey = 'n:1') {
  const storage = createMemoryStorage();
  storage.setItem(KEY, JSON.stringify(edit));
  const ts = createTripStore(PID, {
    storage,
    locks: undefined,
    now: () => NOW_MS,
    nowIso: () => NOW,
  });
  const store = createStore();
  store.set(ts.tripAtom, trip);
  store.set(ts.editLayerAtom, edit);
  const view = render(
    <TripStoreContext value={ts}>
      <Provider store={store}>
        <PlaceCard placeKey={placeKey} />
      </Provider>
    </TripStoreContext>,
  );
  return { storage, store, ts, ...view };
}

const mem = (text: string | null) => ({ text, updatedAt: OLD });

describe('ExploreFilters 태그 칩', () => {
  it('선택한 태그의 마지막 사용이 지워져도 칩이 남아 해제할 수 있다', async () => {
    const edit = makeEdit({
      places: { 'n:1': { memos: {}, tags: { value: ['야경'], updatedAt: OLD } } },
    });
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(edit));
    const ts = createTripStore(PID, { storage, locks: undefined });
    const store = createStore();
    store.set(ts.tripAtom, makeTrip({ days: { [D1]: ['A'] } }));
    store.set(ts.editLayerAtom, edit);
    store.set(exploreFilterAtom, { ...DEFAULT_FILTER, tags: ['사라진'] });
    render(
      <TripStoreContext value={ts}>
        <Provider store={store}>
          <ExploreFilters />
        </Provider>
      </TripStoreContext>,
    );
    const gone = screen.getByRole('button', { name: '#사라진' });
    expect(gone).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '#야경' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(gone);
    expect(store.get(exploreFilterAtom).tags).toEqual([]);
    expect(screen.queryByRole('button', { name: '#사라진' })).toBeNull();
  });
});

describe('PlaceCard 메모', () => {
  const trip = () => makeTrip({ days: { [D1]: ['A'] } });

  it('다른 사람 메모는 닉네임과 읽기 전용, 내 메모만 수정·삭제 버튼', () => {
    const edit = makeEdit({
      authors: {
        'a-local': { nickname: '나', updatedAt: OLD },
        'a-other': { nickname: '영희', updatedAt: OLD },
        'a-gone': { nickname: '철수', updatedAt: OLD },
      },
      places: {
        'n:1': {
          memos: { 'a-local': mem('내 메모'), 'a-other': mem('영희 메모'), 'a-gone': mem(null) },
        },
      },
    });
    setupCard(trip(), edit);
    expect(screen.getByText('영희')).toBeInTheDocument();
    expect(screen.getByText('영희 메모')).toBeInTheDocument();
    expect(screen.getByText('내 메모')).toBeInTheDocument();
    expect(screen.queryByText('철수')).toBeNull();
    expect(screen.getAllByRole('button', { name: '메모 수정' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '메모 삭제' })).toHaveLength(1);
  });

  it('메모 저장 → memos[authorId] = { text, updatedAt: now }', async () => {
    const { storage } = setupCard(trip(), makeEdit());
    await userEvent.click(screen.getByRole('button', { name: '메모 추가' }));
    await userEvent.type(screen.getByLabelText('내 메모'), '웨이팅 필수');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(saved(storage).places['n:1']!.memos['a-local']).toEqual({
        text: '웨이팅 필수',
        updatedAt: NOW,
      }),
    );
    expect(await screen.findByText('웨이팅 필수')).toBeInTheDocument();
  });

  it('메모 수정 → 새 text, 삭제 → text: null 묘비', async () => {
    const edit = makeEdit({ places: { 'n:1': { memos: { 'a-local': mem('처음') } } } });
    const { storage } = setupCard(trip(), edit);
    await userEvent.click(screen.getByRole('button', { name: '메모 수정' }));
    const input = screen.getByLabelText('내 메모');
    await userEvent.clear(input);
    await userEvent.type(input, '고침');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(saved(storage).places['n:1']!.memos['a-local']).toEqual({
        text: '고침',
        updatedAt: NOW,
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '메모 삭제' }));
    await waitFor(() =>
      expect(saved(storage).places['n:1']!.memos['a-local']).toEqual({
        text: null,
        updatedAt: NOW,
      }),
    );
    expect(screen.queryByText('고침')).toBeNull();
  });
});

describe('PlaceCard 태그·숨김', () => {
  it('태그 추가·삭제는 필드 전체를 { value, updatedAt }로 교체', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const edit = makeEdit({
      places: { 'n:1': { memos: {}, tags: { value: ['기존'], updatedAt: OLD } } },
    });
    const { storage } = setupCard(trip, edit);
    await userEvent.type(screen.getByLabelText('태그 추가'), '야경{Enter}');
    await waitFor(() =>
      expect(saved(storage).places['n:1']!.tags).toEqual({
        value: ['기존', '야경'],
        updatedAt: NOW,
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '태그 기존 삭제' }));
    await waitFor(() =>
      expect(saved(storage).places['n:1']!.tags).toEqual({ value: ['야경'], updatedAt: NOW }),
    );
  });

  it('중복·빈 태그는 추가하지 않는다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const edit = makeEdit({
      places: { 'n:1': { memos: {}, tags: { value: ['기존'], updatedAt: OLD } } },
    });
    const { storage } = setupCard(trip, edit);
    await userEvent.type(screen.getByLabelText('태그 추가'), '기존{Enter}');
    await userEvent.type(screen.getByLabelText('태그 추가'), '   {Enter}');
    expect(saved(storage).places['n:1']!.tags!.updatedAt).toBe(OLD);
  });

  it('숨기기 → hidden { value: true, updatedAt }, 숨김 해제 → false', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const { storage } = setupCard(trip, makeEdit());
    await userEvent.click(screen.getByRole('button', { name: '숨기기' }));
    await waitFor(() =>
      expect(saved(storage).places['n:1']!.hidden).toEqual({ value: true, updatedAt: NOW }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '숨김 해제' }));
    await waitFor(() =>
      expect(saved(storage).places['n:1']!.hidden).toEqual({ value: false, updatedAt: NOW }),
    );
  });
});

describe('PlaceCard 표시', () => {
  it('네이버 메모를 폴더 이름과 함께 보여 준다', () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    trip.places['n:1']!.naverMemos = [{ folderId: 'f1', memo: '줄 서는 집' }];
    setupCard(trip, makeEdit());
    expect(screen.getByText('줄 서는 집')).toBeInTheDocument();
    expect(screen.getByText('테스트 폴더')).toBeInTheDocument();
  });

  it('naverMemos가 없으면(publish.naverMemo: false) 네이버 메모 영역이 없다', () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    expect(trip.places['n:1']!.naverMemos).toBeUndefined();
    setupCard(trip, makeEdit());
    expect(screen.queryByText('네이버 메모')).toBeNull();
  });

  it('Review Focus 1: 이름·네이버 메모의 HTML은 문자 그대로 보이고 img가 생기지 않는다', () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    trip.places['n:1']!.name = XSS;
    trip.places['n:1']!.naverMemos = [{ folderId: 'f1', memo: XSS }];
    const edit = makeEdit({
      places: { 'n:1': { memos: { 'a-local': mem(XSS) }, tags: { value: [XSS], updatedAt: OLD } } },
    });
    const { container } = setupCard(trip, edit);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText(XSS).length).toBeGreaterThanOrEqual(3);
  });

  it('[네이버에서 열기]는 sid가 있을 때만, custom 장소엔 없다', () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const { unmount } = setupCard(trip, makeEdit());
    const link = screen.getByRole('link', { name: '네이버에서 열기' });
    expect(link).toHaveAttribute('href', 'https://m.place.naver.com/place/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    unmount();

    const custom = makeTrip({ days: { [D1]: ['A'] } });
    delete custom.places['n:1']!.sid;
    setupCard(custom, makeEdit());
    expect(screen.queryByRole('link', { name: '네이버에서 열기' })).toBeNull();
  });
});

describe('PlaceCard 일정에 추가', () => {
  it('Day 선택 메뉴에서 고르면 그날 끝에 새 stop(4자 소문자 영숫자, 유일)이 추가된다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] }, places: ['P'] });
    const { storage } = setupCard(trip, makeEdit(), 'n:3');
    await userEvent.click(screen.getByRole('button', { name: '일정에 추가' }));
    expect(screen.getByRole('menuitem', { name: 'Day 1 (11/14)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Day 2 (11/15)' }));
    await waitFor(() => expect(saved(storage).days[D2]).toBeDefined());
    const day = saved(storage).days[D2]!;
    if (day.mode !== 'override') throw new Error('override 아님');
    expect(day.stops).toHaveLength(2);
    expect(day.stops[0]).toEqual({ id: sid('B'), placeKey: 'n:2' });
    expect(day.stops[1]!.placeKey).toBe('n:3');
    expect(day.stops[1]!.id).toMatch(/^[a-z0-9]{4}$/);
    expect(day.updatedAt).toBe(NOW);
  });

  it('줄어든 원본 날: D2=[A,X,B]에서 X가 D1 override로 옮겨진 뒤 D2에 P 추가 → [A,B,P], 중복 없음', async () => {
    const trip = makeTrip({ days: { [D1]: [], [D2]: ['A', 'X', 'B'] }, places: ['P'] });
    const x = trip.days[1]!.stops[1]!;
    const edit = makeEdit({
      days: { [D1]: { mode: 'override', stops: [x], baseDayHash: 'h', updatedAt: OLD } },
    });
    const { storage } = setupCard(trip, edit, 'n:4');
    await userEvent.click(screen.getByRole('button', { name: '일정에 추가' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Day 2 (11/15)' }));
    await waitFor(() => expect(saved(storage).days[D2]).toBeDefined());
    const eff = overlay(trip, saved(storage));
    expect(eff.days[1]!.stops.map((s) => s.placeKey)).toEqual(['n:1', 'n:3', 'n:4']);
    expect(eff.days[0]!.stops.map((s) => s.id)).toEqual([x.id]);
    expect(findDuplicateStopIds(eff.days)).toEqual([]);
  });

  it('난수가 기존 id와 겹치면 다시 뽑는다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] }, places: ['P'] });
    trip.days[0]!.stops[0]!.id = 'aaaa';
    // 첫 4번 호출이 이미 있는 'aaaa'를 만들도록 고정한다.
    const seq = [0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]!);
    const { storage } = setupCard(trip, makeEdit(), 'n:2');
    await userEvent.click(screen.getByRole('button', { name: '일정에 추가' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Day 1 (11/14)' }));
    await waitFor(() => expect(saved(storage).days[D1]).toBeDefined());
    const day = saved(storage).days[D1]!;
    if (day.mode !== 'override') throw new Error('override 아님');
    const ids = day.stops.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---- 탐색 패널(ExplorePanel + 지도 마커) ----

function renderPage(trip: TripData, edit?: EditLayer, search = '') {
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  const storage = createMemoryStorage();
  if (edit) storage.setItem(KEY, JSON.stringify(edit));
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify(trip), { headers: { 'Content-Type': 'application/json' } }),
    );
  const store = createStore();
  const router = createMemoryRouter(routes, { initialEntries: [`/t/${PID}${search}`] });
  render(
    <TripDepsContext
      value={{ storage, fetchFn, now: () => NOW_MS, nowIso: () => NOW, jotaiStore: store }}
    >
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </TripDepsContext>,
  );
  return { storage, store };
}

// 라우트가 TripPage를 지연 로드하므로, 부하가 큰 전체 실행에서 첫 테스트가 findBy 시간을 넘지 않게 미리 불러 둔다.
beforeAll(async () => {
  await import('src/pages/TripPage');
}, 20_000);

beforeEach(() => {
  window.localStorage.clear();
});

describe('ExplorePanel', () => {
  const trip = () => {
    const t = makeTrip({ days: { [D1]: ['A'] }, places: ['B', 'C'] });
    t.places['n:2']!.category = '카페';
    return t;
  };

  it('마커 클릭 → 목록 항목이 선택 상태, 목록 클릭 → 해당 마커 selected', async () => {
    renderPage(trip());
    const list = await screen.findByRole('list', { name: '장소 목록' });
    await userEvent.click(await screen.findByTestId('marker-n:1'));
    await waitFor(() =>
      expect(within(list).getByRole('button', { name: /^A/ })).toHaveAttribute(
        'aria-current',
        'true',
      ),
    );
    expect(within(list).getByRole('button', { name: /^B/ })).not.toHaveAttribute('aria-current');

    await userEvent.click(within(list).getByRole('button', { name: /^C/ }));
    await waitFor(() =>
      expect(screen.getByTestId('marker-n:3')).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(screen.getByTestId('marker-n:1')).not.toHaveAttribute('aria-pressed');
  });

  it('필터가 목록과 마커에 함께 반영된다', async () => {
    renderPage(trip());
    await screen.findByTestId('marker-n:2');
    await userEvent.click(
      within(screen.getByRole('group', { name: '필터' })).getByRole('button', { name: /^카페/ }),
    );
    await waitFor(() => expect(screen.queryByTestId('marker-n:1')).toBeNull());
    expect(screen.getByTestId('marker-n:2')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: '장소 목록' });
    expect(within(list).getAllByRole('button', { name: /^[ABC]/ })).toHaveLength(1);
  });

  it('상단 검색어가 목록을 거른다', async () => {
    renderPage(trip());
    await screen.findByTestId('marker-n:1');
    await userEvent.type(screen.getByRole('textbox', { name: '검색' }), '주소 C');
    await waitFor(() => expect(screen.queryByTestId('marker-n:1')).toBeNull());
    expect(screen.getByTestId('marker-n:3')).toBeInTheDocument();
  });

  it('숨김 장소는 기본 제외, [숨김 포함]이면 포함', async () => {
    const edit = makeEdit({
      places: { 'n:2': { memos: {}, hidden: { value: true, updatedAt: OLD } } },
    });
    renderPage(trip(), edit);
    await screen.findByTestId('marker-n:1');
    expect(screen.queryByTestId('marker-n:2')).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: '숨김 포함' }));
    expect(await screen.findByTestId('marker-n:2')).toBeInTheDocument();
  });

  it('선택한 장소는 카드(메모·일정에 추가)를 펼친다', async () => {
    renderPage(trip(), makeEdit(), '?place=n:2');
    expect(await screen.findByRole('button', { name: '일정에 추가' })).toBeInTheDocument();
  });
});
