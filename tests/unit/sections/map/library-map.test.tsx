import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { emptyLibrary } from 'src/schema/library';
import { focusPlaceAtom } from 'src/stores/library-ui';
import { TOKENS } from 'src/theme/tokens';
import { VIRTUALIZE_AFTER } from 'src/sections/library/views/VirtualRows';
import { installMapResources } from '../../components/helpers/map-resources';
import {
  L_CAFE,
  L_FOOD,
  makePlace,
  renderLibrary,
  sampleLibrary,
  withPlaces,
} from '../library/fixtures';

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

  it('re-focuses the open place when the filter changes', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() => expect(marker(2)).toHaveAttribute('aria-pressed', 'true'));
    const before = fakeAdapter().fitCalls.length;
    fakeAdapter().setCamera({ center: [127, 36], zoom: 9 });

    await user.type(screen.getByRole('searchbox', { name: '장소 검색' }), '횟집');

    // 새 필터로 맞춘 뒤 열린 장소로 다시 모은다.
    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(before));
    await waitFor(() => expectFocusedOn([128.95, 37.77]));
  });

  it('opening the same place twice moves the map each time', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    const open = () =>
      user.click(
        within(screen.getByRole('list', { name: '장소 목록' })).getByRole('button', {
          name: /안목 카페거리/,
        }),
      );
    await open();
    await waitFor(() => expectFocusedOn([128.95, 37.77]));
    await router.navigate('/');
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

  it('opens the detail sheet from a marker and keeps the map behind it', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    await user.click(marker(2)!);
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
    expect(await screen.findByRole('region', { name: '장소 상세' })).toBeInTheDocument();
    expect(fakeMap()).toBeInTheDocument();
  });
});
