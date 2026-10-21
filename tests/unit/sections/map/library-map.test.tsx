import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { radiusBox } from 'src/domain/nearby';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { emptyLibrary, type Library, type Place } from 'src/schema/library';
import type { Prefs } from 'src/schema/prefs';
import { Geolocation } from 'src/services/geolocation';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { focusPlaceAtom } from 'src/stores/library-ui';
import { TOKENS } from 'src/theme/tokens';
import { VIRTUALIZE_AFTER } from 'src/sections/library/views/VirtualRows';
import { installMapResources } from '../../components/helpers/map-resources';
import { fakeGeolocation, type FakeCoords } from '../../helpers/fake-geolocation';
import {
  L_CAFE,
  L_FOOD,
  makeLabel,
  makePlace,
  renderLibrary,
  sampleLibrary,
  withPlaces,
} from '../library/fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

let resources: ReturnType<typeof installMapResources>;
const restores: (() => void)[] = [];
/** jsdom에 없는 `Element` 메서드를 테스트 동안만 심는다. */
function stubElementMethod(name: 'scrollIntoView' | 'scrollTo', fn: (...args: never[]) => void) {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, name);
  Object.defineProperty(Element.prototype, name, { configurable: true, writable: true, value: fn });
  restores.push(() => {
    if (original) Object.defineProperty(Element.prototype, name, original);
    else Reflect.deleteProperty(Element.prototype, name);
  });
}
beforeEach(() => {
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  resources = installMapResources();
});
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  cleanup();
  toastMock.mockClear();
  toastMock.error.mockClear();
  setAppRuntimeForTest(null);
  resources.restore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 샘플: 1 닭강정(맛집) · 2 카페거리(카페) · 3 속초 횟집(맛집+바다뷰) · 4 강남(미분류) · 5 창가 자리(미분류)
const id = (n: number) => `place${String(n).padStart(5, '0')}`;
const marker = (n: number) => screen.queryByTestId(`marker-${id(n)}`);
const shownMarkers = () =>
  screen.queryAllByTestId(/^marker-/).map((el) => el.getAttribute('data-testid')!.slice(7));
const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};
const fakeMap = () => screen.getByTestId('fake-map');
const fakeAdapter = () => [...resources.liveInstances][0]!;

async function ready() {
  await waitFor(() => expect(screen.getByTestId('fake-map')).toBeInTheDocument());
  await waitFor(() => expect(shownMarkers().length).toBeGreaterThan(0));
}

describe('library map with a detail overlay', () => {
  const expectUncovered = (lng: number) => {
    const camera = fakeAdapter().getCamera()!;
    // 1100px 화면: 레일 64, 목록 360, 지도 676, 상세가 오른쪽 360을 덮는다.
    const x = 338 + ((lng - camera.center[0]) * 256 * 2 ** camera.zoom) / 360;
    expect(x).toBeGreaterThanOrEqual(40);
    expect(x).toBeLessThanOrEqual(276);
  };

  it('keeps the selected place uncovered when a wide detail becomes an overlay', async () => {
    const { router, setWidth } = await renderLibrary(sampleLibrary(), { width: 1280 });
    await ready();
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() =>
      expect(fakeAdapter().getCamera()).toEqual({ center: [128.95, 37.77], zoom: 16 }),
    );
    const adapter = fakeAdapter();

    setWidth(1100);

    await waitFor(() =>
      expect(getComputedStyle(screen.getByRole('region', { name: '장소 상세' })).position).toBe(
        'absolute',
      ),
    );
    await waitFor(() => expectUncovered(128.95));
    expect(fakeAdapter()).toBe(adapter);
  });

  it('keeps a clicked marker uncovered when its detail overlay opens', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1100 });
    await ready();
    fakeAdapter().setCamera({ center: [128.95, 37.77], zoom: 16 });

    await user.click(marker(2)!);

    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
    expect(await screen.findByRole('button', { name: '닫기' })).toBeInTheDocument();
    await waitFor(() => expectUncovered(128.95));
  });

  it('leaves the map alone when the overlay goes away', async () => {
    const { router, setWidth } = await renderLibrary(sampleLibrary(), { width: 1100 });
    await ready();
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() => expectUncovered(128.95));
    const panned = { center: [128.9, 37.7] as [number, number], zoom: 12 };
    fakeAdapter().setCamera(panned);

    setWidth(1280);

    await waitFor(() =>
      expect(getComputedStyle(screen.getByRole('region', { name: '장소 상세' })).position).not.toBe(
        'absolute',
      ),
    );
    expect(fakeAdapter().getCamera()).toEqual(panned);
  });
});

describe('library map', () => {
  /** 카메라가 장소로 줌 16에 옮겨졌는가(넓은 화면의 고른 padding이라 지도 중심이 곧 장소). */
  const expectFocusedOn = ([lng, lat]: [number, number]) => {
    const camera = fakeAdapter().getCamera()!;
    expect(camera.zoom).toBe(16);
    expect(camera.center[0]).toBeCloseTo(lng, 4);
    expect(camera.center[1]).toBeCloseTo(lat, 4);
  };

  it('map shows only filtered places', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary());
    await ready();
    expect(shownMarkers().sort()).toEqual([1, 2, 3, 4, 5].map(id));

    // 목록과 같은 필터를 쓴다: 카페 칩을 고르면 카페 장소만 남는다.
    await user.click(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name: /^카페/ }),
    );
    await waitFor(() => expect(shownMarkers()).toEqual([id(2)]));

    // 검색어도 같다.
    await user.click(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name: /^카페/ }),
    );
    await user.type(screen.getByRole('searchbox', { name: '장소 검색' }), '횟집');
    await waitFor(() => expect(shownMarkers()).toEqual([id(3)]));
  });

  it('refits the map when the filter changes', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary());
    await ready();
    const before = fakeAdapter().fitCalls.length;
    await user.click(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name: /^카페/ }),
    );
    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(before));
  });

  it('paints markers with the first label colors of the current theme', async () => {
    await renderLibrary(sampleLibrary(), { prefs: { theme: 'night', mode: 'dark' } });
    await ready();
    const night = TOKENS.night.dark;
    const pill = (n: number) => marker(n)!.firstElementChild as HTMLElement;
    expect(pill(1).style.background).toBe(rgb(night.label.red.fill)); // 맛집
    expect(pill(1).style.color).toBe(rgb(night.label.red.text));
    expect(pill(2).style.background).toBe(rgb(night.label.yellow.fill)); // 카페
    expect(pill(4).style.background).toBe(rgb(night.bg.surface)); // 라벨 없음
    expect(pill(4).style.color).toBe(rgb(night.text.primary));
  });

  it('shows the place name on each marker', async () => {
    await renderLibrary(sampleLibrary());
    await ready();
    expect(marker(1)).toHaveTextContent('닭강정');
    expect(marker(2)).toHaveTextContent('안목 카페거리');
    expect(marker(3)).toHaveTextContent('속초 횟집');
    expect(marker(2)!.firstElementChild).toHaveAttribute('title', '안목 카페거리');
  });

  it('keeps the selected place on the map even when the filter hides it', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    // 미분류만 보는 중에 카페 장소를 연다.
    await user.click(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name: /^미분류/ }),
    );
    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(4), id(5)]));
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() => expect(marker(2)).toBeInTheDocument());
    expect(marker(2)).toHaveAttribute('aria-pressed', 'true');
    expect(marker(2)).toHaveTextContent('안목 카페거리');
    expect(shownMarkers().sort()).toEqual([id(2), id(4), id(5)]);

    // 닫으면 다시 필터대로 돌아온다.
    await router.navigate('/');
    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(4), id(5)]));
  });

  it('marker click opens detail and focuses list row', async () => {
    const scrolled = vi.fn();
    stubElementMethod('scrollIntoView', scrolled);
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    const fits = fakeAdapter().fitCalls.length;

    await user.click(marker(3)!);

    expect(router.state.location.pathname).toBe(`/place/${id(3)}`);
    // 목록의 그 행으로 스크롤한다.
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    const row = within(screen.getByRole('list', { name: '장소 목록' })).getByRole('button', {
      name: /속초 횟집/,
    });
    expect(scrolled.mock.contexts.at(-1)).toBe(row.closest('li'));
    // 방금 지도에서 누른 마커라 지도는 다시 움직이지 않고, 선택 표시만 바뀐다.
    expect(marker(3)).toHaveAttribute('aria-pressed', 'true');
    expect(fakeAdapter().fitCalls).toHaveLength(fits);
  });

  it('marker click scrolls a virtualized list to the row', async () => {
    const originals = ['offsetHeight', 'offsetWidth', 'scrollHeight'] as const;
    const saved = originals.map((k) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, k));
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.index === undefined ? 600 : 57;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 360,
    });
    // 스크롤 가능한 최대 위치를 알려 줘야 먼 줄로 갈 수 있다.
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 300 * 57,
    });
    // jsdom에는 요소의 `scrollTo`가 없다. 스크롤 위치를 바꾸고 이벤트를 낸다.
    const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0;
      fireEvent.scroll(this);
    });
    stubElementMethod('scrollTo', scrollTo);
    try {
      const library = withPlaces(
        emptyLibrary(),
        Array.from({ length: 300 }, (_, i) => makePlace(i + 1, { name: `장소 ${i + 1}` })),
      );
      expect(300).toBeGreaterThan(VIRTUALIZE_AFTER);
      const user = userEvent.setup();
      await renderLibrary(library, { prefs: { libraryView: 'list' } });
      await ready();
      // 지도 마커에도 이름이 있으므로 목록 안에서만 찾는다.
      const rows = () => within(screen.getByRole('list', { name: '장소 목록' }));
      expect(rows().queryByRole('button', { name: /^장소 20\b/ })).not.toBeInTheDocument();
      await user.click(marker(20)!);
      await waitFor(() =>
        expect(
          within(screen.getByRole('list', { name: '장소 목록' })).getByRole('button', {
            name: /^장소 20\b/,
          }),
        ).toBeInTheDocument(),
      );
    } finally {
      originals.forEach((k, i) => {
        if (saved[i]) Object.defineProperty(HTMLElement.prototype, k, saved[i]!);
      });
    }
  });

  it('selecting a row focuses map', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await user.click(
      within(screen.getByRole('list', { name: '장소 목록' })).getByRole('button', {
        name: /안목 카페거리/,
      }),
    );

    // 화면 폭과 상관없이 줌 16으로, 장소가 (padding을 뺀) 지도 가운데에 온다.
    await waitFor(() => expectFocusedOn([128.95, 37.77]));
    expect(marker(2)).toHaveAttribute('aria-pressed', 'true');
    expect(fakeMap()).toBeInTheDocument();
  });

  it('고른 마커를 다시 누르면 선택이 풀린다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await user.click(marker(2)!);
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
    await waitFor(() => expect(marker(2)).toHaveAttribute('aria-pressed', 'true'));

    await user.click(marker(2)!);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(marker(2)).not.toHaveAttribute('aria-pressed'));
  });

  it('지도 빈 곳을 누르면 선택이 풀리고 카메라는 그대로다', async () => {
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() => expectFocusedOn([128.95, 37.77]));
    const camera = fakeAdapter().getCamera();

    fireEvent.click(fakeMap());

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(fakeAdapter().getCamera()).toEqual(camera);
  });

  it('장소가 안 열렸을 때 빈 곳을 눌러도 아무 일 없다', async () => {
    const { router } = await renderLibrary(sampleLibrary(), { path: '/map' });
    await ready();
    fireEvent.click(fakeMap());
    expect(router.state.location.pathname).toBe('/map');
  });

  it('추가 칸이 열려 있으면 고른 마커를 다시 눌러도 선택이 풀리지 않는다', async () => {
    const user = userEvent.setup();
    const { router, store } = await renderLibrary(sampleLibrary(), {
      prefs: { libraryView: 'list' },
    });
    await ready();
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() => expect(marker(2)).toHaveAttribute('aria-pressed', 'true'));
    act(() => store.set(addFlowAtom, { step: 'link', hint: 'place' }));

    await user.click(marker(2)!);

    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
    expect(marker(2)).toHaveAttribute('aria-pressed', 'true');
  });

  it('추가 칸이 열려 있으면 빈 곳을 눌러도 선택이 풀리지 않는다', async () => {
    const { router, store } = await renderLibrary(sampleLibrary(), {
      prefs: { libraryView: 'list' },
    });
    await ready();
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() => expect(marker(2)).toHaveAttribute('aria-pressed', 'true'));
    act(() => store.set(addFlowAtom, { step: 'link', hint: 'place' }));

    fireEvent.click(fakeMap());

    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
  });

  it('핀 모드에서는 빈 곳을 눌러도 선택이 풀리지 않는다', async () => {
    const { router, store } = await renderLibrary(sampleLibrary(), {
      prefs: { libraryView: 'list' },
    });
    await ready();
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() => expect(marker(2)).toHaveAttribute('aria-pressed', 'true'));
    act(() => store.set(addFlowAtom, { step: 'pin', name: '', start: null }));

    fireEvent.click(fakeMap());

    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
  });

  it('거르기로 열린 장소가 결과에서 빠지면 선택을 풀고, 결과 전체에 맞춘다', async () => {
    const user = userEvent.setup();
    // 샘플 장소는 좌표가 모두 같다. 속초 횟집만 속초로 옮겨 맞추기 점을 가른다.
    const base = sampleLibrary();
    const library: Library = {
      ...base,
      places: { ...base.places, [id(3)]: { ...base.places[id(3)]!, lng: 128.59, lat: 38.2 } },
    };
    const { router } = await renderLibrary(library, { prefs: { libraryView: 'list' } });
    await ready();
    await router.navigate(`/place/${id(3)}`); // 속초 횟집(맛집·바다뷰)
    await waitFor(() => expect(marker(3)).toHaveAttribute('aria-pressed', 'true'));
    const fits = fakeAdapter().fitCalls.length;

    // 열린 상세의 라벨 고르개도 같은 이름의 묶음이라, 목록 위 필터 칩(첫 번째)을 집는다.
    await user.click(
      within(screen.getAllByRole('group', { name: '라벨' })[0]!).getByRole('button', {
        name: /^카페/,
      }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    // 강제로 보이던 열린 장소(`fit: false`)는 맞추기 점에 들지 않는다. 점이 하나면 그 근처 상자로 넓혀 맞춘다.
    const fitted = fakeAdapter().fitCalls.at(-1)!;
    expect(fitted.length).toBeGreaterThan(0);
    for (const [lng, lat] of fitted) {
      expect(lng).toBeCloseTo(128.95, 1);
      expect(lat).toBeCloseTo(37.77, 1);
    }
    expect(shownMarkers()).toEqual([id(2)]);
    // 거르기 한 번에 기록이 둘 쌓이지 않는다(교체).
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('열린 장소가 결과 안에 남으면 선택은 그대로이고 그 장소로 확대하지 않는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await router.navigate(`/place/${id(3)}`);
    await waitFor(() => expect(fakeAdapter().getCamera()?.zoom).toBe(16));
    const panned = { center: [127, 36] as [number, number], zoom: 9 };
    fakeAdapter().setCamera(panned);
    const fits = fakeAdapter().fitCalls.length;

    await user.type(screen.getByRole('searchbox', { name: '장소 검색' }), '횟집');

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    expect(router.state.location.pathname).toBe(`/place/${id(3)}`);
    expect(marker(3)).toHaveAttribute('aria-pressed', 'true');
    // 가짜 fitBounds는 카메라를 옮기지 않는다: 열린 장소로 다시 모으지 않았다.
    expect(fakeAdapter().getCamera()).toEqual(panned);
  });

  it('opening the same place twice moves the map each time', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    const row = () =>
      within(screen.getByRole('list', { name: '장소 목록' })).getByRole('button', {
        name: /안목 카페거리/,
      });
    const open = () => user.click(row());
    await open();
    await waitFor(() => expectFocusedOn([128.95, 37.77]));
    await router.navigate('/');
    // 라우터 갱신은 트랜지션으로 그려진다. 닫힌 상태가 그려지기 전에 다시 누르면 두 이동이 합쳐진다.
    await waitFor(() => expect(row()).not.toHaveAttribute('aria-current'));
    fakeAdapter().setCamera({ center: [127, 36], zoom: 9 });
    await open();
    await waitFor(() => expectFocusedOn([128.95, 37.77]));
  });

  it('focus requests are consumed once by the list', async () => {
    const scrolled = vi.fn();
    stubElementMethod('scrollIntoView', scrolled);
    const { store } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    store.set(focusPlaceAtom, { id: id(1), seq: 1 });
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    fireEvent.scroll(document.body);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('shows the unavailable reason when the map cannot load', async () => {
    vi.stubEnv('VITE_MAP_ADAPTER', '');
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', '');
    await renderLibrary(sampleLibrary());
    expect(await screen.findByRole('status')).toHaveTextContent('지도 키가 설정되지 않았어요');
  });
});

describe('library map on a compact screen', () => {
  it('shows a full-screen map with one row of filter chips', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    expect(screen.queryByRole('region', { name: '장소 목록' })).not.toBeInTheDocument();
    const chips = screen.getByRole('group', { name: '라벨' });
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(shownMarkers()).toHaveLength(5);

    await user.click(within(chips).getByRole('button', { name: /^맛집/ }));
    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(1), id(3)]));
    expect(L_FOOD).toBe('label001');
    expect(L_CAFE).toBe('label002');
  });

  it('방문 칩이 같은 칩 줄에 있고 가 본 곳은 마커 하나만 남긴다', async () => {
    const user = userEvent.setup();
    const library = withPlaces(sampleLibrary(), [
      makePlace(3, { name: '속초 횟집', labelIds: [L_FOOD], visitedOn: '2026-10-01' }),
    ]);
    await renderLibrary(library, { width: 390, path: '/map' });
    await ready();
    const labels = screen.getByRole('group', { name: '라벨' });
    const visit = screen.getByRole('group', { name: '방문' });
    expect(visit.parentElement).toBe(labels.parentElement);

    await user.click(within(visit).getByRole('button', { name: '가 본 곳 1' }));
    await waitFor(() => expect(shownMarkers()).toEqual([id(3)]));
    expect(within(visit).getByRole('button', { name: '가 본 곳 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('다녀온 곳이 없으면 칩 줄에 방문 묶음이 없다', async () => {
    await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    expect(screen.queryByRole('group', { name: '방문' })).not.toBeInTheDocument();
  });

  it('opens the detail sheet from a marker and keeps the map behind it', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    await user.click(marker(2)!);
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
    expect(await screen.findByRole('region', { name: '장소 상세' })).toBeInTheDocument();
    expect(fakeMap()).toBeInTheDocument();
  });

  it('휴대폰: 마커를 누르면 반쯤 시트가 열리고 장소를 시트 위 영역 가운데로 모은다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    await user.click(marker(2)!);
    expect(router.state.location.state).toEqual({
      sheet: { from: 'map', snap: 'half', inApp: true },
    });
    expect(await screen.findByRole('button', { name: '펼치기' })).toBeInTheDocument();
    // 아래쪽 여백(시트)만큼 지도 중심이 장소보다 남쪽이다 — 장소는 보이는 영역 가운데에 온다.
    await waitFor(() => {
      const camera = fakeAdapter().getCamera()!;
      expect(camera.zoom).toBe(16);
      expect(camera.center[0]).toBeCloseTo(128.95, 4);
      expect(camera.center[1]).toBeLessThan(37.77);
    });
  });

  it('휴대폰: 시트가 열린 채 다른 마커를 누르면 기록을 바꿔치기하고 지도는 그대로 둔다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    await user.click(marker(2)!);
    await screen.findByRole('button', { name: '펼치기' });
    const panned = { center: [128.9, 37.7] as [number, number], zoom: 12 };
    fakeAdapter().setCamera(panned);

    await user.click(marker(1)!);

    expect(router.state.location.pathname).toBe(`/place/${id(1)}`);
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fakeAdapter().getCamera()).toEqual(panned);
  });

  // A1(선택 해제)과 A2(시트)가 만나는 곳: 휴대폰의 해제는 시트 닫기와 같아서 시트를 연 기록을 되감는다.
  it('휴대폰: 다른 마커로 바꾼 뒤 그 마커를 다시 누르면 시트가 닫히고 뒤로 한 번에 지도로 돌아간다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    await user.click(marker(2)!);
    await screen.findByRole('button', { name: '펼치기' });
    await user.click(marker(1)!);
    await waitFor(() => expect(marker(1)).toHaveAttribute('aria-pressed', 'true'));

    await user.click(marker(1)!);

    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument(),
    );
  });

  it('휴대폰: 시트가 열린 채 지도 빈 곳을 누르면 시트가 닫히고 지도로 돌아간다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    await user.click(marker(2)!);
    await screen.findByRole('button', { name: '펼치기' });

    fireEvent.click(fakeMap());

    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(router.state.historyAction).toBe('POP');
  });

  it('휴대폰: 링크로 바로 들어온 시트도 빈 곳을 누르면 앱을 벗어나지 않고 지도로 바꿔치기한다', async () => {
    const { router } = await renderLibrary(sampleLibrary(), {
      width: 390,
      path: `/place/${id(2)}`,
    });
    await ready();
    await screen.findByRole('button', { name: '펼치기' });

    fireEvent.click(fakeMap());

    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

// 내 위치(스펙 §4.3). 기준점은 장소 좌표와 겹치지 않는 자릿수다.
const BASE: FakeCoords = { longitude: 128.90031, latitude: 37.75517, accuracy: 30 };
const FIX_AT = Date.parse('2026-10-16T05:05:00.000Z');
/**
 * 기기 시각을 위치를 잰 때 조금 뒤로 고정한다. 위치 서비스는 하루보다 오래됐거나 미래인 `timestamp`를
 * 받은 때로 바꾸므로, 시각을 고정하지 않으면 `FIX_AT`이 실제 날짜에 따라 다른 값이 된다.
 */
function freezeClockAfterFix() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIX_AT + 120_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
/** `haversineM`의 지구 반지름 기준 위도 1도의 길이(m). */
const M_PER_LAT_DEGREE = (6_371_008.8 * Math.PI) / 180;
const northOf = (place: Place, m: number): Place => ({
  ...place,
  lng: 128.9003,
  lat: BASE.latitude + m / M_PER_LAT_DEGREE,
});

/** 기준점에서 북쪽으로 0.5km `가 식당`, 2km `라 카페`, 4km `나 식당`, 20km `다 카페`. */
function nearbyLibrary(options: { visited?: boolean } = {}): Library {
  const labels = [
    makeLabel(L_FOOD, '맛집', 'red', 'utensils', 0),
    makeLabel(L_CAFE, '카페', 'yellow', 'coffee', 1),
  ];
  const places = [
    northOf(makePlace(1, { name: '가 식당', labelIds: [L_FOOD] }), 500),
    northOf(
      makePlace(2, {
        name: '라 카페',
        labelIds: [L_CAFE],
        ...(options.visited === true ? { visitedOn: '2026-10-01' } : {}),
      }),
      2000,
    ),
    northOf(makePlace(3, { name: '나 식당', labelIds: [L_FOOD] }), 4000),
    northOf(makePlace(4, { name: '다 카페', labelIds: [L_CAFE] }), 20_000),
  ];
  return {
    ...emptyLibrary(),
    labels: Object.fromEntries(labels.map((l) => [l.id, l])),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
  };
}

async function renderWithLocation(
  library: Library,
  options: { width?: number; path?: string; prefs?: Partial<Prefs> } = {},
) {
  const fake = fakeGeolocation();
  const rendered = await renderLibrary(library, {
    ...options,
    geolocation: Geolocation.layerWith({ api: fake.api, secure: true }),
  });
  return { fake, ...rendered };
}

async function answer(fake: ReturnType<typeof fakeGeolocation>, index = 0) {
  await act(async () => fake.succeed(index, BASE, FIX_AT));
}

const DENIED = '위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 켜 주세요';
const locateButton = () => screen.getByRole('button', { name: '내 위치 보기' });
const dot = () => screen.queryByTestId('my-location');
const lastFit = () => fakeAdapter().fitCalls.at(-1) ?? [];
const pickNearby = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: '최근 저장순' }));
  await user.click(screen.getByRole('menuitemradio', { name: '가까운 순' }));
};

describe('library map 내 위치 보기', () => {
  freezeClockAfterFix();

  it('누를 때만 묻고, 찾으면 점을 그리고 그리로 옮기며 알린다', async () => {
    const user = userEvent.setup();
    const { fake } = await renderWithLocation(nearbyLibrary(), { path: '/map' });
    await ready();
    expect(fake.requests).toHaveLength(0);
    const button = await screen.findByRole('button', { name: '내 위치 보기' });
    expect(getComputedStyle(button).width).toBe('44px');
    expect(getComputedStyle(button).height).toBe('44px');
    expect(within(screen.getByTestId('map-controls')).getByRole('button')).toBe(button);

    await user.click(button);

    const busy = screen.getByRole('button', { name: '내 위치를 찾는 중' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(fake.requests).toHaveLength(1);
    expect(dot()).toBeNull();

    await answer(fake);

    await waitFor(() => expect(dot()).toHaveAttribute('data-lat', String(BASE.latitude)));
    expect(dot()).toHaveAttribute('data-lng', String(BASE.longitude));
    expect(dot()).toHaveAttribute('data-accuracy', '30');
    expect(fakeMap()).toHaveAttribute('data-center', `${BASE.longitude},${BASE.latitude}`);
    expect(fakeMap()).toHaveAttribute('data-zoom', '16');
    expect(screen.getByRole('status')).toHaveTextContent('내 위치를 지도에 표시했어요');
    expect(locateButton()).not.toHaveAttribute('aria-busy');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('실패하면 토스트로 알리고 이전 점은 그대로 둔다', async () => {
    const user = userEvent.setup();
    const { fake } = await renderWithLocation(nearbyLibrary(), { path: '/map' });
    await ready();
    await user.click(await screen.findByRole('button', { name: '내 위치 보기' }));
    await answer(fake);
    await waitFor(() => expect(dot()).toBeInTheDocument());

    await user.click(locateButton());
    expect(fake.requests).toHaveLength(2);
    await act(async () => fake.fail(1, 1));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(DENIED));
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(dot()).toHaveAttribute('data-lat', String(BASE.latitude));
    expect(locateButton()).not.toHaveAttribute('aria-busy');
  });

  it('근처 모드면 반경 안 장소만 보이고 반경 상자에 맞춘다', async () => {
    const user = userEvent.setup();
    const { fake } = await renderWithLocation(nearbyLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    expect(shownMarkers().sort()).toEqual([1, 2, 3, 4].map(id));

    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);

    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(1), id(2)]));
    const center: [number, number] = [BASE.longitude, BASE.latitude];
    await waitFor(() => expect(lastFit()).toEqual(expect.arrayContaining(radiusBox(center, 3000))));
    expect(dot()).toHaveAttribute('data-lat', String(BASE.latitude));
    const fits = fakeAdapter().fitCalls.length;

    await user.click(
      within(screen.getByRole('group', { name: '반경' })).getByRole('button', { name: '1km' }),
    );

    await waitFor(() => expect(shownMarkers()).toEqual([id(1)]));
    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    expect(lastFit()).toEqual(expect.arrayContaining(radiusBox(center, 1000)));
    // 반경 칩은 위치를 다시 묻지 않는다.
    expect(fake.requests).toHaveLength(1);
  });

  it('근처 모드에서 내 위치 보기를 누르면 내 위치로 옮기지 않고 반경에 맞춘다', async () => {
    const user = userEvent.setup();
    const { fake } = await renderWithLocation(nearbyLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);
    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(1), id(2)]));
    const fits = fakeAdapter().fitCalls.length;
    const camera = fakeAdapter().getCamera();

    await user.click(locateButton());
    await act(async () => fake.succeed(1, BASE, FIX_AT + 60_000));

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    expect(lastFit()).toEqual(
      expect.arrayContaining(radiusBox([BASE.longitude, BASE.latitude], 3000)),
    );
    expect(fakeAdapter().getCamera()).toEqual(camera);
    expect(screen.getByText('내 위치를 지도에 표시했어요')).toBeInTheDocument();
  });

  it('중간 폭에서 상세가 지도를 덮으면 단추 기둥을 그만큼 왼쪽으로 옮긴다', async () => {
    const { router } = await renderWithLocation(nearbyLibrary(), {
      width: 1000,
      path: `/place/${id(2)}`,
    });
    await ready();
    const column = await screen.findByTestId('map-controls');
    expect(getComputedStyle(column).right).toBe('368px');

    await router.navigate('/');

    await waitFor(() =>
      expect(getComputedStyle(screen.getByTestId('map-controls')).right).toBe('8px'),
    );
  });
});

describe('library map 근처 모드의 지도 맞추기', () => {
  freezeClockAfterFix();

  const PANNED = { center: [127, 36] as [number, number], zoom: 9 };
  const center: [number, number] = [BASE.longitude, BASE.latitude];
  const status = () =>
    screen.getByTestId('map-host').parentElement!.querySelector('[role="status"]')!;

  it('장소가 열려 있어도 가까운 순을 켜면 반경 상자에 맞추고, 반경을 바꾸면 다시 맞춘다', async () => {
    const user = userEvent.setup();
    const { fake, router } = await renderWithLocation(nearbyLibrary());
    await ready();
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() => expect(fakeAdapter().getCamera()?.zoom).toBe(16));
    fakeAdapter().setCamera(PANNED);
    const fits = fakeAdapter().fitCalls.length;

    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    expect(lastFit()).toEqual(radiusBox(center, 3000));
    // 맞춘 뒤 열린 장소(줌 16)로 다시 모으지 않는다. 가짜 fitBounds는 카메라를 옮기지 않는다.
    expect(fakeAdapter().getCamera()).toEqual(PANNED);
    const before = fakeAdapter().fitCalls.length;

    await user.click(
      within(screen.getByRole('group', { name: '반경' })).getByRole('button', { name: '10km' }),
    );

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(before));
    expect(lastFit()).toEqual(radiusBox(center, 10_000));
    expect(fakeAdapter().getCamera()).toEqual(PANNED);
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
  });

  it('먼 장소가 열려 있어도 근처 모드의 내 위치 보기는 그 장소가 아니라 반경으로 옮긴다', async () => {
    const user = userEvent.setup();
    const { fake, router } = await renderWithLocation(nearbyLibrary());
    await ready();
    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);
    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(1), id(2)]));
    await router.navigate(`/place/${id(4)}`);
    await waitFor(() => expect(fakeAdapter().getCamera()?.zoom).toBe(16));
    fakeAdapter().setCamera(PANNED);
    const fits = fakeAdapter().fitCalls.length;

    await user.click(locateButton());
    await act(async () => fake.succeed(1, BASE, FIX_AT + 60_000));

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    // 20km 밖의 열린 장소는 맞춤 점에 들지 않는다(반경 상자 그대로).
    expect(lastFit()).toEqual(radiusBox(center, 3000));
    expect(fakeAdapter().getCamera()).toEqual(PANNED);
    expect(status()).toHaveTextContent('내 위치를 지도에 표시했어요');
  });

  it('먼 장소를 열어 둔 채 가까운 순을 켜도 맞춤 범위는 반경 상자뿐이다', async () => {
    const user = userEvent.setup();
    const { fake, router } = await renderWithLocation(nearbyLibrary());
    await ready();
    await router.navigate(`/place/${id(4)}`);
    await waitFor(() => expect(fakeAdapter().getCamera()?.zoom).toBe(16));
    const fits = fakeAdapter().fitCalls.length;

    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    expect(lastFit()).toEqual(radiusBox(center, 3000));
    // 열린 장소의 마커는 그대로 보인다.
    expect(shownMarkers()).toContain(id(4));
  });

  it('반경이 전체면 반경 안 장소와 내 위치로만 맞추고, 필터에 가려진 열린 장소는 넣지 않는다', async () => {
    const user = userEvent.setup();
    const { fake, router } = await renderWithLocation(nearbyLibrary());
    await ready();
    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);
    await user.click(
      within(screen.getByRole('group', { name: '반경' })).getByRole('button', { name: '전체' }),
    );
    // 카페 라벨만 남기고 식당(1·3)을 연다 — 필터에 가려져도 열린 장소라 마커는 보인다.
    await user.click(screen.getAllByRole('button', { name: /^카페/ })[0]!);
    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(2), id(4)]));
    const fits = fakeAdapter().fitCalls.length;
    await router.navigate(`/place/${id(3)}`);
    await user.click(
      within(screen.getByRole('group', { name: '반경' })).getByRole('button', { name: '3km' }),
    );
    await user.click(
      within(screen.getByRole('group', { name: '반경' })).getByRole('button', { name: '전체' }),
    );

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    const pts = lastFit();
    expect(pts).toContainEqual(center);
    const place = (n: number) => {
      const p = nearbyLibrary().places[id(n)]!;
      return [p.lng, p.lat];
    };
    expect(pts).toContainEqual(place(2));
    expect(pts).toContainEqual(place(4));
    expect(pts).not.toContainEqual(place(3));
  });

  it('반경을 바꿨다가 예전 반경으로 돌아와도 옛 카메라가 아니라 반경 상자에 다시 맞춘다', async () => {
    const user = userEvent.setup();
    const { fake } = await renderWithLocation(nearbyLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);
    await waitFor(() => expect(lastFit()).toEqual(radiusBox(center, 3000)));
    fakeAdapter().setCamera(PANNED);
    const radius = (name: string) =>
      within(screen.getByRole('group', { name: '반경' })).getByRole('button', { name });

    await user.click(radius('1km'));
    await waitFor(() => expect(lastFit()).toEqual(radiusBox(center, 1000)));
    const before = fakeAdapter().fitCalls.length;
    await user.click(radius('3km'));

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(before));
    // 고치기 전에는 옛 3km 키를 다시 써서 맞추지 않고 그 키의 옛 카메라만 되살렸다.
    expect(lastFit()).toEqual(radiusBox(center, 3000));
  });

  it('가까운 순을 껐다 다시 켜도 반경 상자에 다시 맞춘다', async () => {
    const user = userEvent.setup();
    const { fake } = await renderWithLocation(nearbyLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);
    await waitFor(() => expect(lastFit()).toEqual(radiusBox(center, 3000)));
    await user.click(screen.getByRole('button', { name: '가까운 순 끄기' }));
    fakeAdapter().setCamera(PANNED);
    const before = fakeAdapter().fitCalls.length;

    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(2));
    await answer(fake, 1);

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(before));
    expect(lastFit()).toEqual(radiusBox(center, 3000));
  });

  it('같은 시각의 위치(브라우저 캐시)가 다시 와도 내 위치 보기를 누를 때마다 반경에 다시 맞춘다', async () => {
    const user = userEvent.setup();
    const { fake } = await renderWithLocation(nearbyLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);
    await waitFor(() => expect(lastFit()).toEqual(expect.arrayContaining(radiusBox(center, 3000))));

    for (const index of [1, 2]) {
      fakeAdapter().setCamera(PANNED);
      fakeAdapter().fitCalls.length = 0;

      await user.click(locateButton());
      await act(async () => fake.succeed(index, BASE, FIX_AT));

      await waitFor(() => expect(fakeAdapter().fitCalls).toHaveLength(1));
      expect(lastFit()).toEqual(expect.arrayContaining(radiusBox(center, 3000)));
      expect(status()).toHaveTextContent('내 위치를 지도에 표시했어요');
    }
  });

  it('근처 모드에서 상관없는 다시 그리기(장소 고침)에는 다시 맞추지 않는다', async () => {
    const user = userEvent.setup();
    const { fake, store } = await renderWithLocation(nearbyLibrary(), {
      prefs: { libraryView: 'list' },
    });
    await ready();
    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);
    await waitFor(() => expect(lastFit()).toEqual(expect.arrayContaining(radiusBox(center, 3000))));
    fakeAdapter().setCamera(PANNED);
    const fits = fakeAdapter().fitCalls.length;

    const current = store.get(libraryAtom);
    const first = current.places[id(1)]!;
    act(() =>
      store.set(libraryAtom, {
        ...current,
        places: {
          ...current.places,
          [id(1)]: { ...first, name: { ...first.name, value: '가 식당 본점' } },
        },
      }),
    );

    await waitFor(() => expect(marker(1)).toHaveTextContent('가 식당 본점'));
    expect(fakeAdapter().fitCalls).toHaveLength(fits);
    expect(fakeAdapter().getCamera()).toEqual(PANNED);
  });

  it('내 위치 보기가 실패하면 숨은 알림은 비어 있다', async () => {
    const user = userEvent.setup();
    const { fake } = await renderWithLocation(nearbyLibrary(), { path: '/map' });
    await ready();
    await user.click(await screen.findByRole('button', { name: '내 위치 보기' }));
    await answer(fake);
    await waitFor(() => expect(status()).toHaveTextContent('내 위치를 지도에 표시했어요'));

    await user.click(locateButton());
    await act(async () => fake.fail(1, 1));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(DENIED));
    expect(status().textContent).toBe('');
  });
});

describe('library map 근처 모드의 선택 풀기 (스펙 A1 §4)', () => {
  freezeClockAfterFix();

  const search = () => screen.getByRole('searchbox', { name: '장소 검색' });
  const radius = (name: string) =>
    within(screen.getByRole('group', { name: '반경' })).getByRole('button', { name });
  async function nearbyOn() {
    const user = userEvent.setup();
    const rendered = await renderWithLocation(nearbyLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await pickNearby(user);
    await waitFor(() => expect(rendered.fake.requests).toHaveLength(1));
    await answer(rendered.fake);
    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(1), id(2)]));
    return { user, ...rendered };
  }

  it('반경 안 장소를 연 채 검색어가 그 장소를 남기면 그대로, 빼면 선택을 푼다', async () => {
    const { user, router } = await nearbyOn();
    await router.navigate(`/place/${id(1)}`); // 가 식당(0.5km)
    await waitFor(() => expect(marker(1)).toHaveAttribute('aria-pressed', 'true'));

    await user.type(search(), '식당');
    await waitFor(() => expect(shownMarkers()).toEqual([id(1)]));
    expect(router.state.location.pathname).toBe(`/place/${id(1)}`);

    await user.clear(search());
    await user.type(search(), '카페');

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('반경 밖 장소를 연 채 검색어를 바꾸면, 검색어에 맞아도 결과(반경 안)에 없어 선택을 푼다', async () => {
    const { user, router } = await nearbyOn();
    await router.navigate(`/place/${id(3)}`); // 나 식당(4km, 반경 3km 밖)
    await waitFor(() => expect(marker(3)).toHaveAttribute('aria-pressed', 'true'));

    await user.type(search(), '식당');

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('반경 밖 장소를 연 채 반경을 바꿔도(근처 쪽 변화) 선택을 풀지 않는다', async () => {
    const { user, router } = await nearbyOn();
    await router.navigate(`/place/${id(4)}`); // 다 카페(20km)
    await waitFor(() => expect(marker(4)).toHaveAttribute('aria-pressed', 'true'));
    const fits = fakeAdapter().fitCalls.length;

    await user.click(radius('10km'));
    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    await user.click(radius('1km'));
    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(1), id(4)]));

    expect(router.state.location.pathname).toBe(`/place/${id(4)}`);
    expect(marker(4)).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('library map 좁은 화면의 근처 칩', () => {
  freezeClockAfterFix();

  it('근처 모드면 칩 줄 맨 앞에 근처 칩을 두고, 끄면 마커가 모두 돌아온다', async () => {
    const user = userEvent.setup();
    const { fake, router } = await renderWithLocation(nearbyLibrary({ visited: true }), {
      width: 390,
      path: '/',
      prefs: { libraryView: 'list' },
    });
    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);

    await router.navigate('/map');
    await ready();

    const chip = await screen.findByText('내 근처 3km');
    const visit = screen.getByRole('group', { name: '방문' });
    expect(chip.compareDocumentPosition(visit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(visit.parentElement).toBe(screen.getByRole('group', { name: '라벨' }).parentElement);
    await waitFor(() => expect(shownMarkers().sort()).toEqual([id(1), id(2)]));
    // 지도를 새로 만들어도 이미 얻은 위치의 점이 그려진다.
    expect(dot()).toHaveAttribute('data-lat', String(BASE.latitude));
    const off = screen.getByRole('button', { name: '가까운 순 끄기' });
    expect(getComputedStyle(off).minWidth).toBe('44px');
    expect(getComputedStyle(off).minHeight).toBe('44px');

    await user.click(off);

    await waitFor(() => expect(screen.queryByText(/^내 근처/)).not.toBeInTheDocument());
    // ×가 사라지므로 포커스는 같은 칩 줄의 다음 칩(방문 묶음의 첫 칩)으로 옮긴다.
    expect(document.activeElement).toBe(within(visit).getAllByRole('button')[0]);
    await waitFor(() => expect(shownMarkers().sort()).toEqual([1, 2, 3, 4].map(id)));
    expect(dot()).toBeInTheDocument();
  });

  it('반경이 전체면 칩 글자는 내 근처', async () => {
    const user = userEvent.setup();
    const { fake, router } = await renderWithLocation(nearbyLibrary(), {
      width: 390,
      path: '/',
      prefs: { libraryView: 'list' },
    });
    await pickNearby(user);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    await answer(fake);
    await user.click(
      within(screen.getByRole('group', { name: '반경' })).getByRole('button', { name: '전체' }),
    );

    await router.navigate('/map');
    await ready();

    expect(await screen.findByText('내 근처')).toBeInTheDocument();
    expect(shownMarkers()).toHaveLength(4);

    // 방문 묶음이 없으면 포커스는 라벨 묶음의 첫 칩으로 간다.
    await user.click(screen.getByRole('button', { name: '가까운 순 끄기' }));
    await waitFor(() => expect(screen.queryByText('내 근처')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', {
        name: '모두 포함',
      }),
    );
  });

  it('근처 모드가 아니면 칩이 없다', async () => {
    await renderWithLocation(nearbyLibrary(), { width: 390, path: '/map' });
    await ready();
    expect(screen.queryByText(/^내 근처/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '가까운 순 끄기' })).not.toBeInTheDocument();
  });
});

it('장소만 고르면 기본 마커 목록은 다시 전달하지 않는다', async () => {
  const { router } = await renderLibrary(sampleLibrary(), { width: 1280 });
  await ready();
  const adapter = fakeAdapter();
  const setMarkers = vi.spyOn(adapter, 'setMarkers');
  await router.navigate(`/place/${id(2)}`);
  await waitFor(() => expect(marker(2)).toHaveAttribute('aria-pressed', 'true'));
  await router.navigate(`/place/${id(3)}`);
  await waitFor(() => expect(marker(3)).toHaveAttribute('aria-pressed', 'true'));
  expect(setMarkers).not.toHaveBeenCalled();
});

it('라벨 찾기의 검색·다중 선택·모두 포함이 실제 목록과 마커를 함께 거른다', async () => {
  const user = userEvent.setup();
  const sample = sampleLibrary();
  const extra = Array.from({ length: 10 }, (_, i) =>
    makeLabel(`extra${String(i).padStart(3, '0')}`, `추가 라벨 ${i}`, 'blue', 'star', 10 + i),
  );
  await renderLibrary(
    { ...sample, labels: { ...sample.labels, ...Object.fromEntries(extra.map((l) => [l.id, l])) } },
    { width: 1280, prefs: { libraryView: 'list' } },
  );
  await ready();
  await user.click(screen.getByRole('button', { name: '라벨 찾기' }));
  const search = await screen.findByRole('searchbox', { name: '라벨 이름 검색' });
  await user.type(search, '맛집');
  const dialog = screen.getByRole('dialog', { name: '라벨 찾기' });
  await user.click(within(dialog).getByRole('checkbox', { name: '맛집 2곳' }));
  await user.clear(search);
  await user.click(within(dialog).getByRole('checkbox', { name: '바다뷰 1곳' }));
  await user.selectOptions(within(dialog).getByRole('combobox', { name: '라벨 포함 조건' }), 'all');
  await user.click(within(dialog).getByRole('button', { name: '완료' }));
  await waitFor(() => expect(shownMarkers()).toEqual([id(3)]));
  expect(
    within(await screen.findByRole('list', { name: '장소 목록' })).getAllByRole('listitem'),
  ).toHaveLength(1);
});
