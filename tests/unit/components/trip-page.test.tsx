import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { atom, createStore, Provider, useAtomValue } from 'jotai';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from 'src/routes/router';
import { legacyTripRoutes } from '../../fixtures/legacy-trip-routes';
import { AppProviders } from 'src/app';
import { FakeMapAdapter, FAKE_BOUNDS } from 'src/components/map/FakeMapAdapter';
import { installMapResources } from './helpers/map-resources';
import { ReconcileBanner } from 'src/components/ReconcileBanner';
import { overlay } from 'src/domain/overlay';
import { mapBoundsAtom, mapViewportUsableAtom } from 'src/sections/explore/store/explore-state';
import { detailAtom, selectedPlaceScrollRequestAtom } from 'src/sections/views/store/view-session';
import { hashDayStops } from 'src/domain/day-hash';
import type { ReconcileReport } from 'src/domain/reconcile';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import {
  createTripStore,
  TripDepsContext,
  TripStoreContext,
  type TripStore,
  type LoadState,
} from 'src/stores/trip-store';
import { itineraryEditingAtom, stopDraftsAtom } from 'src/sections/views/store/view-session';
import { useViewQuerySync } from 'src/sections/views/use-view-query-sync';
import { writePreferredView } from 'src/sections/views/store/ui-preferences';
import {
  modeAtom,
  selectedDayAtom,
  selectedPlaceAtom,
  uiQueryReadyAtom,
  viewModeAtom,
} from 'src/stores/ui-store';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';

const PID = 'testtrip0001';
const KEY = storageKey(PID);
const NOW_MS = 1759460000000;
const NOW_ISO = '2026-10-03T02:00:00.000Z';
const OLD = '2026-10-03T00:30:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderAt(
  url: string,
  opts: {
    trip?: TripData;
    response?: Response;
    storage?: Storage;
    strict?: boolean;
    load?: () => Promise<Response>;
    routes?: RouteObject[];
  } = {},
) {
  const storage = opts.storage ?? createMemoryStorage();
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      opts.load ? await opts.load() : (opts.response ?? jsonResponse(opts.trip)),
    );
  const store = createStore();
  const router = createMemoryRouter(opts.routes ?? legacyTripRoutes, { initialEntries: [url] });
  const wrap = (node: ReactNode) => (opts.strict ? <StrictMode>{node}</StrictMode> : node);
  render(
    wrap(
      <TripDepsContext
        value={{ storage, fetchFn, now: () => NOW_MS, nowIso: () => NOW_ISO, jotaiStore: store }}
      >
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </TripDepsContext>,
    ),
  );
  return { storage, store, router, fetchFn };
}

const saved = (storage: Storage): EditLayer => JSON.parse(storage.getItem(KEY)!) as EditLayer;

// 라우트가 TripPage를 지연 로드하므로, 부하가 큰 전체 실행에서 첫 테스트가 findBy 시간을 넘지 않게 미리 불러 둔다.
beforeAll(async () => {
  await import('src/pages/TripPage');
}, 20_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('라우트 오류 화면', () => {
  function Boom(): ReactNode {
    throw new Error('boom');
  }

  it('옛 여행 라우트에 errorElement가 있고, 렌더 오류면 한국어 안내와 새로고침 버튼을 보여 준다', async () => {
    const withError = legacyTripRoutes.filter((r) => r.path !== '*');
    expect(withError.length).toBeGreaterThanOrEqual(1);
    for (const r of withError) expect(r.errorElement).toBeTruthy();

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const router = createMemoryRouter(
      [{ path: '/', element: <Boom />, errorElement: legacyTripRoutes[0]!.errorElement }],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('문제가 생겨 화면을 표시하지 못했어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(reload).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    vi.unstubAllGlobals();
    error.mockRestore();
  });
});

describe('라우트', () => {
  it('/는 보관함 셸을 보여 주고 여행(/t/) 링크가 없다', async () => {
    // 보관함을 읽는 동안 Suspense가 멈추므로 act 안에서 그려야 다시 시도된다.
    await act(async () => {
      renderAt('/', { routes });
    });
    expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs.filter((href) => href?.startsWith('/t/'))).toEqual([]);
  });

  it('404면 만료 안내', async () => {
    renderAt(`/t/${PID}`, { response: new Response('nope', { status: 404 }) });
    expect(await screen.findByText('링크가 잘못되었거나 만료된 여행입니다')).toBeInTheDocument();
  });

  it('검증 실패면 schemaVersion과 첫 오류', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    renderAt(`/t/${PID}`, { response: jsonResponse({ ...trip, schemaVersion: 7 }) });
    expect(await screen.findByText(/schemaVersion: 7/)).toBeInTheDocument();
    expect(screen.getByText(/schemaVersion:.*expected 1|Invalid input/i)).toBeInTheDocument();
  });

  it('?mode=itinerary&day=2 → modeAtom·selectedDayAtom', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
    const { store } = renderAt(`/t/${PID}?mode=itinerary&day=2`, { trip });
    expect(await screen.findByText('테스트 여행')).toBeInTheDocument();
    expect(store.get(modeAtom)).toBe('itinerary');
    expect(store.get(selectedDayAtom)).toBe(D2);
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: '일정' })).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('StrictMode에서도 ?mode=itinerary&day=2 딥 링크가 유지되고, [탐색]은 URL을 한 번만 바꾼다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
    const { router } = renderAt(`/t/${PID}?mode=itinerary&day=2`, { trip, strict: true });
    await screen.findByTestId('itinerary-panel');
    await vi.waitFor(() => {
      const panel = screen.getByTestId('itinerary-panel');
      expect(within(panel).getByRole('tab', { name: 'Day 2' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(within(panel).getByRole('region', { name: 'Day 2 (11/15)' })).toBeInTheDocument();
      expect(within(panel).queryByRole('region', { name: 'Day 1 (11/14)' })).toBeNull();
    });
    // effect가 모두 끝난 뒤에도 쿼리가 그대로다.
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.search).toBe('?mode=itinerary&day=2');

    const changes: string[] = [];
    let key = router.state.location.key;
    const unsubscribe = router.subscribe((state) => {
      if (state.location.key === key) return;
      key = state.location.key;
      changes.push(state.location.search);
    });
    await userEvent.click(screen.getByRole('button', { name: '지도' }));
    await screen.findByTestId('explore-panel');
    await new Promise((r) => setTimeout(r, 50));
    unsubscribe();
    expect(changes).toEqual(['?day=2&view=map']);
    expect(router.state.location.search).toBe('?day=2&view=map');
  });

  it('모드 전환이 URL 쿼리에 반영된다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const { router } = renderAt(`/t/${PID}`, { trip });
    await userEvent.click(await screen.findByRole('button', { name: '일정' }));
    expect(router.state.location.search).toContain('view=day');
  });
});

describe('미해결 원본 변경 배너', () => {
  const v1 = makeTrip({ days: { [D1]: ['X'], [D2]: [] } });
  const v2 = makeTrip({ days: { [D1]: [], [D2]: ['X'] } });
  const movedEdit = () =>
    makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [{ ...v1.days[0]!.stops[0]!, note: '내 메모' }],
          baseDayHash: hashDayStops(v1.days[0]!.stops),
          updatedAt: OLD,
        },
      },
    });

  it('[내 편집 유지] → keepMine 결과 저장, 배너 사라짐', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(movedEdit()));
    renderAt(`/t/${PID}`, { trip: v2, storage });
    expect(await screen.findByText('Day 1 원본이 바뀌었어요(관련: Day 2)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '원본 보기' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '내 편집 유지' }));
    await vi.waitFor(() => expect(screen.queryByText(/원본이 바뀌었어요/)).not.toBeInTheDocument());
    const day2 = saved(storage).days[D2]!;
    expect(day2).toEqual({
      mode: 'override',
      stops: [],
      baseDayHash: hashDayStops(v2.days[1]!.stops),
      updatedAt: NOW_ISO,
    });
  });

  it('[원본 보기] → 묶음 전체 reset, 배너 사라짐', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(movedEdit()));
    renderAt(`/t/${PID}`, { trip: v2, storage });
    await userEvent.click(await screen.findByRole('button', { name: '원본 보기' }));
    await vi.waitFor(() => expect(screen.queryByText(/원본이 바뀌었어요/)).not.toBeInTheDocument());
    expect(saved(storage).days).toEqual({
      [D1]: { mode: 'reset', updatedAt: NOW_ISO },
      [D2]: { mode: 'reset', updatedAt: NOW_ISO },
    });
  });

  it('keepMine이 null이면 [원본 보기]만 남는다', async () => {
    const trip = makeTrip({ days: { [D1]: ['X', 'A'], [D2]: ['B'] } });
    const [sx, sa] = trip.days[0]!.stops;
    const sb = trip.days[1]!.stops[0]!;
    expect(sa).toBeDefined();
    const storage = createMemoryStorage();
    storage.setItem(
      KEY,
      JSON.stringify(
        makeEdit({
          days: {
            [D1]: { mode: 'override', stops: [sx!], baseDayHash: 'old', updatedAt: OLD },
            [D2]: { mode: 'override', stops: [sx!, sb], baseDayHash: 'old', updatedAt: OLD },
          },
        }),
      ),
    );
    renderAt(`/t/${PID}`, { trip, storage });
    expect(await screen.findByText(/원본이 바뀌었어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '원본 보기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내 편집 유지' })).not.toBeInTheDocument();
    expect(sid('X')).toBe(sx!.id);
  });
});

describe('ReconcileBanner 정리 알림', () => {
  it('고아 2건·제거 방문 1건이면 그 두 줄만', () => {
    const report: ReconcileReport = {
      removedStops: [{ date: D1, stopId: 'zz00', placeKey: 'n:99' }],
      orphanPlaceKeys: ['n:77', 'n:78'],
      hiddenEditDates: [],
      autoResetDates: [],
      unresolvedGroups: [],
    };
    const { container } = render(
      <ReconcileBanner
        report={report}
        isUnresolved={() => false}
        dayLabel={() => 'Day 1'}
        canKeepMine={() => true}
        onRevert={() => {}}
        onKeepMine={() => {}}
      />,
    );
    expect(screen.getByText('원본에서 사라진 장소 1곳을 일정에서 뺐어요')).toBeInTheDocument();
    expect(
      screen.getByText('사라진 장소의 메모 2건을 보관 중이에요 — 내보내기에 포함돼요'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/여행 기간에서 빠진 날짜/)).not.toBeInTheDocument();
    expect(screen.queryByText(/원본이 바뀌었어요/)).not.toBeInTheDocument();
    expect(within(container).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('설정 메뉴', () => {
  it('기존 상단의 파일 선택은 가져오기 dialog를 하나 열고 input 값을 비운다', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    renderAt(`/t/${PID}`, { trip: makeTrip({ days: { [D1]: ['A'] } }), storage });
    await userEvent.click(await screen.findByRole('button', { name: '설정' }));
    const fileInput = screen.getByLabelText('편집 파일 선택') as HTMLInputElement;
    const click = vi.spyOn(fileInput, 'click');
    await userEvent.click(screen.getByRole('menuitem', { name: '파일 가져오기' }));
    expect(click).toHaveBeenCalledOnce();
    await userEvent.upload(fileInput, new File(['{}'], 'edit.json', { type: 'application/json' }));
    expect(await screen.findByRole('dialog', { name: '편집 가져오기' })).toBeVisible();
    expect(screen.getAllByRole('dialog', { name: '편집 가져오기' })).toHaveLength(1);
    expect(fileInput.value).toBe('');
  });
  it('기존 상단의 hash 가져오기는 한 번 열고 query와 history state를 보존한다', async () => {
    const state = { usr: null, key: 'test', idx: 3 };
    window.history.replaceState(state, '', `/t/${PID}?view=day#e=invalid`);
    try {
      const storage = createMemoryStorage();
      storage.setItem(KEY, JSON.stringify(makeEdit()));
      renderAt(`/t/${PID}?view=day`, {
        trip: makeTrip({ days: { [D1]: ['A'] } }),
        storage,
        strict: true,
      });
      expect(await screen.findByRole('dialog', { name: '편집 가져오기' })).toBeVisible();
      expect(screen.getAllByRole('dialog', { name: '편집 가져오기' })).toHaveLength(1);
      expect(window.location.hash).toBe('');
      expect(window.location.search).toBe('?view=day');
      expect(window.history.state).toEqual(state);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
  it('닉네임 변경 → authors[authorId] 갱신, updatedAt 지금', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    renderAt(`/t/${PID}`, { trip, storage });
    await userEvent.click(await screen.findByRole('button', { name: '설정' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '닉네임 변경' }));
    const input = await screen.findByLabelText('닉네임');
    expect(input).toHaveValue('나');
    await userEvent.clear(input);
    await userEvent.type(input, '길동');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await vi.waitFor(() =>
      expect(saved(storage).authors['a-local']).toEqual({ nickname: '길동', updatedAt: NOW_ISO }),
    );
  });
});

describe('뷰 쿼리 준비', () => {
  it('날짜 해석 전에는 ReadyTrip을 표시하지 않고 대기 중 외부 URL 변경을 따른다', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
    const { store, router } = renderAt(`/t/${PID}?view=day&day=1`, {
      trip,
      strict: true,
      load: () => pending,
    });
    expect(store.get(uiQueryReadyAtom)).toBe(false);
    expect(screen.queryByTestId('itinerary-panel')).toBeNull();
    await act(async () => {
      await router.navigate(`/t/${PID}?view=day&day=2&place=n%3A2`);
    });
    await act(async () => {
      release(jsonResponse(trip));
      await pending;
    });
    await screen.findByTestId('itinerary-panel');
    expect(store.get(uiQueryReadyAtom)).toMatchObject({ trip });
    expect(store.get(viewModeAtom)).toBe('day');
    expect(store.get(selectedDayAtom)).toBe(D2);
    expect(store.get(selectedPlaceAtom)).toBe('n:2');
    expect(router.state.location.search).toBe('?view=day&day=2&place=n%3A2');
  });
  it.each([
    ['view=day', D1],
    ['mode=itinerary', 'all'],
  ])('날짜 생략 %s의 기본값을 유지한다', async (query, day) => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
    const { store, router } = renderAt(`/t/${PID}?${query}`, { trip, strict: true });
    await screen.findByTestId('itinerary-panel');
    expect(store.get(selectedDayAtom)).toBe(day);
    expect(router.state.location.search).toBe(`?${query}`);
  });
  it('선호가 없는 첫 진입은 map이며 URL을 쓰지 않는다', async () => {
    const { store, router } = renderAt(`/t/${PID}`, {
      trip: makeTrip({ days: { [D1]: ['A'] } }),
      strict: true,
    });
    await screen.findByTestId('explore-panel');
    expect(store.get(viewModeAtom)).toBe('map');
    expect(store.get(selectedDayAtom)).toBe('all');
    expect(router.state.location.search).toBe('');
  });
  it.each(['toString', 'constructor', '__proto__'])(
    '상속 속성 장소 %s는 선택하지 않고 첫 URL을 보존한다',
    async (place) => {
      const query = `?view=map&place=${place}`;
      const { store, router } = renderAt(`/t/${PID}${query}`, {
        trip: makeTrip({ days: { [D1]: ['A'] } }),
        strict: true,
      });
      await screen.findByTestId('explore-panel');
      expect(store.get(uiQueryReadyAtom)).toBeTruthy();
      expect(store.get(selectedPlaceAtom)).toBeNull();
      expect(router.state.location.search).toBe(query);
    },
  );
  it('저장한 선호 places는 쿼리 없이 사용한다', async () => {
    const storage = createMemoryStorage();
    writePreferredView(storage, PID, 'places');
    const { store, router } = renderAt(`/t/${PID}`, {
      trip: makeTrip({ days: { [D1]: ['A'] } }),
      storage,
    });
    await screen.findByTestId('places-panel');
    expect(store.get(viewModeAtom)).toBe('places');
    expect(store.get(modeAtom)).toBe('explore');
    expect(router.state.location.search).toBe('');
  });
  it('places 진입은 실제 탐색 마커 레이어를 유지한다', async () => {
    const resources = installMapResources();
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    try {
      const trip = makeTrip({ days: { [D1]: ['A'] }, places: ['B'] });
      const { store } = renderAt(`/t/${PID}?view=places`, { trip });
      await screen.findByTestId('places-panel');
      expect(resources.mount).not.toHaveBeenCalled();
      expect(store.get(viewModeAtom)).toBe('places');
      await userEvent.click(screen.getByRole('button', { name: '지도' }));
      await screen.findByTestId('marker-n:1');
      await screen.findByTestId('marker-n:2');
      expect(store.get(modeAtom)).toBe('explore');
    } finally {
      cleanup();
      resources.restore();
      vi.unstubAllEnvs();
    }
  });
  it('A ready에서 B 지연 로드로 이동하면 이전 준비 화면을 표시하지 않는다', async () => {
    const resources = installMapResources();
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    const mount = vi.spyOn(FakeMapAdapter.prototype, 'mount');
    const markers = vi.spyOn(FakeMapAdapter.prototype, 'setMarkers');
    try {
      const a = makeTrip({ days: { [D1]: ['A'] } });
      const b = { ...makeTrip({ days: { [D1]: ['B'], [D2]: ['C'] } }), publicId: 'testtrip0002' };
      let release!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const { store, router } = renderAt(`/t/${PID}?view=map&place=n%3A1`, {
        load: async () => (++calls === 1 ? jsonResponse(a) : pending),
      });
      await screen.findByTestId('explore-panel');
      await screen.findByTestId('marker-n:1');
      await vi.waitFor(() => expect(screen.getByTestId('fake-map')).toHaveAttribute('data-width'));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      mount.mockClear();
      markers.mockClear();
      await act(async () => {
        await router.navigate('/t/testtrip0002?view=day&day=2&place=n%3A2');
      });
      expect(screen.queryByTestId('explore-panel')).toBeNull();
      expect(screen.queryByTestId('itinerary-panel')).toBeNull();
      expect(screen.queryAllByTestId('map-host')).toHaveLength(0);
      expect(store.get(uiQueryReadyAtom)).toBe(false);
      expect(mount).not.toHaveBeenCalled();
      expect(markers).not.toHaveBeenCalled();
      await act(async () => {
        release(jsonResponse(b));
        await pending;
      });
      await screen.findByTestId('itinerary-panel');
      await userEvent.click(screen.getByRole('button', { name: '동선 지도 보기' }));
      await screen.findByTestId('marker-n:2');
      expect(mount).toHaveBeenCalledTimes(1);
      expect(markers.mock.calls[0]![0].map((marker) => marker.id)).toEqual(['n:2']);
      expect(store.get(viewModeAtom)).toBe('day');
      expect(store.get(selectedDayAtom)).toBe(D2);
      expect(store.get(selectedPlaceAtom)).toBe('n:2');
      expect(router.state.location.search).toBe('?view=day&day=2&place=n%3A2');
    } finally {
      cleanup();
      resources.restore();
      mount.mockRestore();
      markers.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

function ReadyHistory({ owner, history }: { owner: TripStore; history: string[] }) {
  const view = useAtomValue(viewModeAtom);
  const day = useAtomValue(selectedDayAtom);
  const place = useAtomValue(selectedPlaceAtom);
  useLayoutEffect(() => {
    history.push(JSON.stringify([owner.publicId, view, day, place]));
  });
  return <div data-testid="query-ready" />;
}

function queryHarness() {
  const store = createStore();
  const storage = createMemoryStorage();
  const a = createTripStore(PID, { storage, nowIso: () => '2026-11-15T12:00:00' });
  const b = createTripStore('testtrip0002', { storage, nowIso: () => NOW_ISO });
  const aLoad = atom<LoadState>({ status: 'ready' });
  const bLoad = atom<LoadState>({ status: 'loading' });
  a.loadStateAtom = aLoad;
  b.loadStateAtom = bLoad;
  const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
  store.set(a.tripAtom, trip);
  const ownerAtom = atom(a);
  const history: string[] = [];
  const commits: boolean[] = [];
  function Sync() {
    const owner = useAtomValue(ownerAtom);
    return (
      <TripStoreContext value={owner}>
        <Session owner={owner} />
      </TripStoreContext>
    );
  }
  function Session({ owner }: { owner: TripStore }) {
    const ready = useViewQuerySync();
    useLayoutEffect(() => {
      commits.push(ready);
    });
    return ready ? <ReadyHistory owner={owner} history={history} /> : null;
  }
  const router = createMemoryRouter([{ path: '/', element: <Sync /> }], {
    initialEntries: ['/?view=day&place=n%3A2'],
  });
  const ui = render(
    <StrictMode>
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>
    </StrictMode>,
  );
  return { store, a, b, aLoad, bLoad, trip, ownerAtom, history, commits, router, ui };
}

describe('쿼리 로드 세션 격리', () => {
  it('같은 컴포넌트와 Provider에서 owner A→B 전환 첫 commit부터 준비 화면이 없다', async () => {
    const { store, a, b, bLoad, ownerAtom, history } = queryHarness();
    await screen.findByTestId('query-ready');
    expect(store.get(selectedDayAtom)).toBe(D2);
    history.length = 0;
    await act(async () => {
      store.set(ownerAtom, b);
    });
    expect(screen.queryByTestId('query-ready')).toBeNull();
    expect(history).toEqual([]);
    expect(store.get(uiQueryReadyAtom)).toBe(false);
    const trip = { ...makeTrip({ days: { '2026-12-01': ['C'] } }), publicId: b.publicId };
    await act(async () => {
      store.set(b.tripAtom, trip);
      store.set(bLoad, { status: 'ready' });
    });
    await screen.findByTestId('query-ready');
    expect(
      history.every((value) => value === JSON.stringify([b.publicId, 'day', '2026-12-01', null])),
    ).toBe(true);
    expect(store.get(uiQueryReadyAtom)).toMatchObject({ owner: b, trip });
    expect(store.get(uiQueryReadyAtom)).not.toMatchObject({ owner: a });
  });
  it('동일 owner의 loading→새 snapshot ready는 최초 commit부터 닫고 새 날짜·장소를 해석한다', async () => {
    const { store, a, aLoad, history } = queryHarness();
    await screen.findByTestId('query-ready');
    history.length = 0;
    await act(async () => {
      store.set(aLoad, { status: 'loading' });
    });
    expect(history).toEqual([]);
    expect(screen.queryByTestId('query-ready')).toBeNull();
    expect(store.get(uiQueryReadyAtom)).toBe(false);
    const next = makeTrip({ days: { '2026-12-02': ['C'] } });
    await act(async () => {
      store.set(a.tripAtom, next);
      store.set(aLoad, { status: 'ready' });
    });
    await screen.findByTestId('query-ready');
    expect(
      history.every((value) => value === JSON.stringify([PID, 'day', '2026-12-02', null])),
    ).toBe(true);
  });
  it('동일 owner와 load 객체에서 snapshot만 바뀌어도 첫 commit부터 새 쿼리 해석을 기다린다', async () => {
    const { store, a, history, commits } = queryHarness();
    await screen.findByTestId('query-ready');
    const next = makeTrip({ days: { '2026-12-05': ['C'] } });
    history.length = 0;
    commits.length = 0;
    await act(async () => {
      store.set(a.tripAtom, next);
    });
    expect(commits[0]).toBe(false);
    expect(commits.at(-1)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    expect(
      history.every((value) => value === JSON.stringify([PID, 'day', '2026-12-05', null])),
    ).toBe(true);
    expect(store.get(uiQueryReadyAtom)).toMatchObject({ owner: a, trip: next });
  });
  it('새 ready 객체만 교체하면 첫 commit부터 닫고 같은 URL의 기본 날짜를 다시 해석한다', async () => {
    const { store, a, aLoad, history, commits, router, ui } = queryHarness();
    await screen.findByTestId('query-ready');
    expect(store.get(selectedDayAtom)).toBe(D2);
    a.nowIso = () => '2026-11-14T12:00:00';
    ui.rerender(
      <StrictMode>
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      </StrictMode>,
    );
    expect(store.get(selectedDayAtom)).toBe(D2);
    const oldReady = store.get(uiQueryReadyAtom);
    history.length = 0;
    commits.length = 0;
    await act(async () => {
      store.set(aLoad, { status: 'ready' });
    });
    expect(commits[0]).toBe(false);
    expect(commits.at(-1)).toBe(true);
    expect(store.get(uiQueryReadyAtom)).not.toBe(oldReady);
    expect(store.get(uiQueryReadyAtom)).toMatchObject({ owner: a });
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((value) => value === JSON.stringify([PID, 'day', D1, 'n:2']))).toBe(true);
    expect(router.state.location.search).toBe('?view=day&place=n%3A2');
  });
  it('이미 ready인 다른 owner도 첫 commit부터 이전 토큰을 사용하지 않는다', async () => {
    const { store, b, bLoad, ownerAtom, history, commits } = queryHarness();
    await screen.findByTestId('query-ready');
    const next = { ...makeTrip({ days: { '2026-12-04': ['C'] } }), publicId: b.publicId };
    store.set(b.tripAtom, next);
    store.set(bLoad, { status: 'ready' });
    history.length = 0;
    commits.length = 0;
    await act(async () => {
      store.set(ownerAtom, b);
    });
    expect(commits[0]).toBe(false);
    expect(commits.at(-1)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    expect(
      history.every((value) => value === JSON.stringify([b.publicId, 'day', '2026-12-04', null])),
    ).toBe(true);
  });
  it.each(['null', 'error'] as const)(
    '%s에서 readiness를 초기화하고 같은 URL 복구 시 다시 해석한다',
    async (kind) => {
      const { store, a, aLoad, trip, history } = queryHarness();
      await screen.findByTestId('query-ready');
      history.length = 0;
      await act(async () => {
        if (kind === 'null') store.set(a.tripAtom, null);
        else store.set(aLoad, { status: 'error', kind: 'not-found', message: '없음' });
      });
      expect(history).toEqual([]);
      expect(screen.queryByTestId('query-ready')).toBeNull();
      expect(store.get(uiQueryReadyAtom)).toBe(false);
      await act(async () => {
        store.set(a.tripAtom, trip);
        store.set(aLoad, { status: 'ready' });
      });
      await screen.findByTestId('query-ready');
      expect(store.get(selectedDayAtom)).toBe(D2);
    },
  );
  it('외부 URL·날짜 배열 변경을 따르고 같은 atom 값·재렌더는 URL 쓰기가 없다', async () => {
    const { store, a, router, ui } = queryHarness();
    await screen.findByTestId('query-ready');
    const changes: string[] = [];
    let key = router.state.location.key;
    const unsubscribe = router.subscribe((state) => {
      if (key === state.location.key) return;
      key = state.location.key;
      changes.push(state.location.search);
    });
    await act(async () => {
      store.set(viewModeAtom, 'day');
      store.set(selectedDayAtom, D2);
      store.set(selectedPlaceAtom, 'n:2');
    });
    ui.rerender(
      <StrictMode>
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      </StrictMode>,
    );
    expect(changes).toEqual([]);
    await act(async () => {
      await router.navigate('/?view=places&day=1&place=missing&x=1');
    });
    expect(store.get(viewModeAtom)).toBe('places');
    expect(store.get(selectedPlaceAtom)).toBeNull();
    expect(router.state.location.search).toBe('?view=places&day=1&place=missing&x=1');
    await act(async () => {
      store.set(a.tripAtom, makeTrip({ days: { '2026-12-03': ['C'] } }));
    });
    expect(store.get(selectedDayAtom)).toBe('2026-12-03');
    expect(changes).toEqual(['?view=places&day=1&place=missing&x=1']);
    unsubscribe();
  });
});

it('URL의 뷰·날짜 변경만 편집을 종료하고 방문 초안은 유지한다', async () => {
  const { store, router } = queryHarness();
  await screen.findByTestId('query-ready');
  act(() => {
    store.set(itineraryEditingAtom, true);
    store.set(stopDraftsAtom, { a000: { date: D1, time: '', note: '초안' } });
  });
  await act(async () => {
    await router.navigate('/?view=day&day=2&place=n%3A1');
  });
  expect(store.get(itineraryEditingAtom)).toBe(true);
  await act(async () => {
    await router.navigate('/?view=day&day=1&place=n%3A1');
  });
  expect(store.get(itineraryEditingAtom)).toBe(false);
  act(() => store.set(itineraryEditingAtom, true));
  await act(async () => {
    await router.navigate('/?view=places&day=1');
  });
  expect(store.get(itineraryEditingAtom)).toBe(false);
  expect(store.get(stopDraftsAtom).a000?.note).toBe('초안');
});

describe('실제 세 뷰 셸 연결', () => {
  it('places는 지도를 초기화하지 않고 지도 첫 표시 후 같은 adapter를 유지한다', async () => {
    const resources = installMapResources();
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    let width = 390;
    const media = new Map<string, { matches: boolean; notify: Set<() => void> }>();
    vi.stubGlobal('matchMedia', (query: string) => {
      const record = {
        matches: width >= Number(query.match(/\d+/)?.[0]),
        notify: new Set<() => void>(),
      };
      media.set(query, record);
      return {
        media: query,
        get matches() {
          return record.matches;
        },
        addEventListener: (_: string, callback: () => void) => record.notify.add(callback),
        removeEventListener: (_: string, callback: () => void) => record.notify.delete(callback),
      };
    });
    const resize = (next: number) =>
      act(() => {
        width = next;
        for (const [query, record] of media) {
          record.matches = next >= Number(query.match(/\d+/)?.[0]);
          record.notify.forEach((notify) => notify());
        }
        resources.emit(next, 500);
      });
    try {
      const { store, fetchFn } = renderAt(`/t/${PID}?view=places`, {
        trip: makeTrip({ days: { [D1]: ['A'] }, places: ['B'] }),
      });
      await screen.findByTestId('places-panel');
      expect(resources.mount).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: '지도' }));
      const map = await screen.findByTestId('fake-map');
      const instance = map.dataset.instanceId;
      for (const view of ['장소', '일정', '지도', '장소', '지도']) {
        await userEvent.click(screen.getByRole('button', { name: view }));
        expect(screen.getByTestId('fake-map').dataset.instanceId).toBe(instance);
      }
      for (const [next, layout] of [
        [767, 'compact'],
        [768, 'split'],
        [1439, 'split'],
        [1440, 'wide'],
        [390, 'compact'],
      ] as const) {
        resize(next);
        expect(screen.getByTestId('trip-shell')).toHaveAttribute('data-layout', layout);
        expect(screen.getByTestId('fake-map').dataset.instanceId).toBe(instance);
        await userEvent.click(await screen.findByRole('button', { name: '장소' }));
        await vi.waitFor(() => expect(store.get(mapViewportUsableAtom)).toBe(false));
        await userEvent.click(screen.getByRole('button', { name: '지도' }));
        await vi.waitFor(() => expect(store.get(mapViewportUsableAtom)).toBe(true));
      }
      expect(store.get(viewModeAtom)).toBe('map');
      expect(resources.mount).toHaveBeenCalledTimes(1);
      expect(resources.snapshot()).toMatchObject({
        activeAdapters: 1,
        callbackSlots: 2,
        observedHosts: 1,
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
      expect(resources.snapshot()).toMatchObject({
        activeAdapters: 0,
        callbackSlots: 0,
        observers: 0,
        pendingFrames: 0,
      });
      resources.restore();
      vi.unstubAllEnvs();
    }
  }, 15_000);
});

it('장소 추가는 일정에 반영되고 메모 초안은 상세 재개방까지 유지된다', async () => {
  const trip = makeTrip({ days: { [D1]: [] }, places: ['A'] });
  const { router, store, storage, fetchFn } = renderAt(`/t/${PID}?view=places`, { trip });
  await userEvent.click(await screen.findByRole('button', { name: 'A 일정에 추가' }));
  await userEvent.click(screen.getByRole('button', { name: 'Day 1 (11/14)' }));
  const nickname = await screen.findByLabelText('닉네임');
  await userEvent.type(nickname, '나');
  await userEvent.click(
    within(nickname.closest('[role=dialog]')!).getByRole('button', { name: '저장' }),
  );
  await vi.waitFor(() => expect(overlay(trip, saved(storage)).days[0]?.stops).toHaveLength(1));
  await userEvent.click(await screen.findByRole('button', { name: 'A 상세' }));
  await userEvent.click(screen.getByRole('button', { name: '메모 추가' }));
  await userEvent.type(screen.getByLabelText('내 메모'), '아직 저장하지 않은 초안');
  await userEvent.click(
    within(screen.getByRole('dialog', { name: '장소 상세' })).getByRole('button', { name: '닫기' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '일정' }));
  expect(store.get(viewModeAtom)).toBe('day');
  expect(await screen.findByTestId('itinerary-panel')).toHaveTextContent('A');
  expect(router.state.location.search).toContain('view=day');
  await userEvent.click(await screen.findByRole('button', { name: '장소' }));
  await userEvent.click(await screen.findByRole('button', { name: 'A 상세' }));
  expect(screen.getByLabelText('내 메모')).toHaveValue('아직 저장하지 않은 초안');
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it('compact 일정은 최초 mount 0회이며 표시 중인 준비된 지도만 viewport 필터에 쓴다', async () => {
  const resources = installMapResources();
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  try {
    const { store } = renderAt(`/t/${PID}?view=day&day=1`, {
      trip: makeTrip({ days: { [D1]: ['A'] } }),
    });
    await screen.findByTestId('itinerary-panel');
    expect(resources.mount).not.toHaveBeenCalled();
    expect(store.get(mapViewportUsableAtom)).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: '동선 지도 보기' }));
    await screen.findByTestId('marker-n:1');
    await vi.waitFor(() => expect(store.get(mapViewportUsableAtom)).toBe(true));
    act(() => store.set(mapBoundsAtom, null));
    expect(store.get(mapViewportUsableAtom)).toBe(false);
    act(() => store.set(mapBoundsAtom, FAKE_BOUNDS));
    expect(store.get(mapViewportUsableAtom)).toBe(true);
    const before = store.get(selectedPlaceScrollRequestAtom);
    const adapter = [...resources.instances][0]! as unknown as { markerCb(id: string): void };
    for (const id of ['__proto__', 'toString', 'missing']) act(() => adapter.markerCb(id));
    expect(store.get(detailAtom)).toBeNull();
    expect(store.get(selectedPlaceScrollRequestAtom)).toBe(before);
    await userEvent.click(screen.getByTestId('marker-n:1'));
    expect(store.get(detailAtom)).toEqual({ kind: 'place', placeKey: 'n:1' });
    expect(store.get(selectedPlaceScrollRequestAtom)).toBe(before + 1);
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    await userEvent.click(screen.getByTestId('marker-n:1'));
    expect(store.get(selectedPlaceScrollRequestAtom)).toBe(before + 2);
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    await userEvent.click(await screen.findByRole('button', { name: '장소' }));
    await vi.waitFor(() => expect(store.get(mapViewportUsableAtom)).toBe(false));
    expect(resources.snapshot().activeAdapters).toBe(1);
  } finally {
    cleanup();
    resources.restore();
    vi.unstubAllEnvs();
  }
});

it('지도 초기화 실패 후에도 장소 편집과 메뉴 내보내기를 열 수 있다', async () => {
  const resources = installMapResources();
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  resources.mount.mockRejectedValueOnce(new Error('지도 실패'));
  try {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    const { store } = renderAt(`/t/${PID}?view=map`, {
      trip: makeTrip({ days: { [D1]: ['A'] } }),
      storage,
    });
    await screen.findByText(/지도를 불러오지 못했어요/);
    expect(store.get(mapViewportUsableAtom)).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: '설정' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '내보내기' }));
    const exportDialog = screen.getByRole('dialog');
    expect(exportDialog).toBeVisible();
    await userEvent.click(within(exportDialog).getByRole('button', { name: '닫기' }));
    await userEvent.click(await screen.findByRole('button', { name: '장소' }));
    await userEvent.click(await screen.findByRole('button', { name: 'A 상세' }));
    expect(screen.getByRole('dialog', { name: '장소 상세' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '메모 추가' }));
    await userEvent.type(screen.getByLabelText('내 메모'), '지도 실패 중 저장');
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '장소 상세' })).getByRole('button', {
        name: '저장',
      }),
    );
    await vi.waitFor(() =>
      expect(saved(storage).places['n:1']?.memos?.['a-local']?.text).toBe('지도 실패 중 저장'),
    );
  } finally {
    cleanup();
    resources.restore();
    vi.unstubAllEnvs();
  }
});

it('전체 일정 마커는 장소를 열고 후보 마커는 선택한 날짜에 추가한다', async () => {
  const resources = installMapResources();
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  try {
    const trip = makeTrip({ days: { [D1]: ['A'] }, places: ['B'] });
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    const { store } = renderAt(`/t/${PID}?view=day&day=1`, { trip, storage });
    await userEvent.click(await screen.findByRole('button', { name: '동선 지도 보기' }));
    await screen.findByTestId('marker-n:1');
    await userEvent.click(screen.getByRole('tab', { name: '전체' }));
    await userEvent.click(await screen.findByTestId(`marker-${D1}/n:1`));
    expect(store.get(detailAtom)).toEqual({ kind: 'place', placeKey: 'n:1' });
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Day 1' }));
    await userEvent.click(screen.getByRole('switch', { name: '후보 장소 보기' }));
    await userEvent.click(await screen.findByTestId('marker-candidate/n:2'));
    await vi.waitFor(() =>
      expect(overlay(trip, saved(storage)).days[0]?.stops.map((stop) => stop.placeKey)).toEqual([
        'n:1',
        'n:2',
      ]),
    );
    expect(store.get(detailAtom)).toBeNull();
  } finally {
    cleanup();
    resources.restore();
    vi.unstubAllEnvs();
  }
});

it('URL 장소 상세는 X 닫기 후 뷰 변경에 닫힌 채 유지되고 history 장소 전환에 다시 열린다', async () => {
  const { store, router } = renderAt(`/t/${PID}?view=places&place=n%3A1`, {
    trip: makeTrip({ days: { [D1]: ['A', 'B'] } }),
    strict: true,
  });
  expect(await screen.findByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
  await userEvent.click(
    within(screen.getByRole('dialog', { name: '장소 상세' })).getByRole('button', { name: '닫기' }),
  );
  expect(store.get(selectedPlaceAtom)).toBe('n:1');
  expect(router.state.location.search).toContain('place=n%3A1');
  await userEvent.click(screen.getByRole('button', { name: '일정' }));
  expect(store.get(detailAtom)).toBeNull();
  expect(screen.queryByRole('dialog', { name: '장소 상세' })).toBeNull();
  await act(async () => {
    await router.navigate(`/t/${PID}?view=places&place=n%3A2`);
  });
  expect(await screen.findByRole('dialog', { name: '장소 상세' })).toHaveTextContent('B');
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  await act(async () => {
    await router.navigate(-1);
  });
  expect(await screen.findByRole('dialog', { name: '장소 상세' })).toHaveTextContent('A');
  await act(async () => {
    await router.navigate(1);
  });
  expect(await screen.findByRole('dialog', { name: '장소 상세' })).toHaveTextContent('B');
});

it('실제 TripScreen은 로딩 중 URL 장소가 바뀌면 마지막 URL의 상세만 연다', async () => {
  let release!: (value: Response) => void;
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const { store, router } = renderAt(`/t/${PID}?view=places&place=n%3A1`, {
    load: () => response,
  });
  await screen.findByText('불러오는 중…');
  await act(async () => {
    await router.navigate(`/t/${PID}?view=places&place=n%3A2`);
    release(jsonResponse(makeTrip({ days: { [D1]: ['A', 'B'] } })));
  });
  expect(await screen.findByRole('dialog', { name: '장소 상세' })).toHaveTextContent('B');
  expect(store.get(selectedPlaceAtom)).toBe('n:2');
});
