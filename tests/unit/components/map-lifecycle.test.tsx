import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MapView } from 'src/components/map/MapView';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import { ResponsiveTripLayout } from 'src/layouts/ResponsiveTripLayout';
import type { LayoutKind } from 'src/layouts/layout-metrics';
import type { ViewMode } from 'src/stores/ui-store';
import { installMapResources } from './helpers/map-resources';
const auth = vi.hoisted(() => ({ fail: null as (() => void) | null }));
vi.mock('src/components/map/load-naver-sdk', () => ({
  loadNaverSdk: vi.fn(() => Promise.resolve()),
  onNaverAuthFailure: vi.fn((callback: () => void) => {
    auth.fail = callback;
    return () => {
      auth.fail = null;
    };
  }),
}));
let resources: ReturnType<typeof installMapResources>;
beforeEach(() => {
  resources = installMapResources();
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
});
afterEach(() => {
  cleanup();
  resources.restore();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete (window as { naver?: unknown }).naver;
});
const markers = [
  { id: 'a', lng: 128, lat: 37, label: '장소', color: '#123456', clusterable: true },
];
const markerClick = vi.fn();
const boundsChange = vi.fn();
const padding = vi.fn();
function Shell({
  layout,
  view,
  unavailable = null,
}: {
  layout: LayoutKind;
  view: ViewMode;
  unavailable?: string | null;
}) {
  const visible = !unavailable && (view === 'map' || (view === 'day' && layout !== 'compact'));
  return (
    <ResponsiveTripLayout
      topBar={<div>상단</div>}
      map={
        <MapView
          visible={visible}
          markers={markers}
          polylines={[]}
          onMarkerClick={markerClick}
          onBoundsChange={boundsChange}
          onUnavailable={vi.fn()}
        />
      }
      panel={<div>목록</div>}
      detail={{ open: false, content: null, onClose: vi.fn() }}
      layout={layout}
      view={view}
      unavailable={unavailable}
      routeMapVisible={false}
      onMapPaddingChange={padding}
    />
  );
}
for (const initial of ['places', 'day'] as const)
  it(`처음 compact ${initial}은 지도 자원을 만들지 않고 10회 순환에서도 최초 instance를 유지한다`, async () => {
    const store = createStore();
    const wrap = (layout: LayoutKind, view: ViewMode) => (
      <Provider store={store}>
        <Shell layout={layout} view={view} />
      </Provider>
    );
    const { rerender, unmount } = render(wrap('compact', initial));
    expect(resources.mount).not.toHaveBeenCalled();
    expect(resources.activeTargets()).toBe(0);
    rerender(wrap('compact', 'map'));
    const map = await screen.findByTestId('fake-map');
    await waitFor(() => expect(resources.activeTargets()).toBe(1));
    const id = map.dataset.instanceId;
    for (let n = 0; n < 10; n++)
      for (const [layout, view] of [
        ['compact', 'places'],
        ['split', 'day'],
        ['wide', 'map'],
        ['compact', 'day'],
        ['compact', 'map'],
      ] as const) {
        rerender(wrap(layout, view));
        const visible = view === 'map' || (view === 'day' && layout !== 'compact');
        await waitFor(() => expect(resources.activeTargets()).toBe(visible ? 1 : 0));
        expect(screen.getByTestId('fake-map').dataset.instanceId).toBe(id);
        expect(resources.snapshot().activeAdapters).toBe(1);
        expect(resources.snapshot().callbackSlots).toBe(2);
      }
    expect(resources.mount).toHaveBeenCalledTimes(1);
    expect(resources.destroy).not.toHaveBeenCalled();
    unmount();
    expect(resources.snapshot()).toMatchObject({
      activeAdapters: 0,
      callbackSlots: 0,
      observedHosts: 0,
      bodyTargets: 0,
      pendingFrames: 0,
    });
  });
it('StrictMode 안정화 후 view 변경은 mount를 추가하지 않고 route 교체/실패는 정리한다', async () => {
  const store = createStore();
  const wrap = (view: ViewMode, route = 'one', unavailable: string | null = null) => (
    <StrictMode>
      <Provider store={store}>
        <Shell key={route} layout="wide" view={view} unavailable={unavailable} />
      </Provider>
    </StrictMode>
  );
  const { rerender, unmount } = render(wrap('map'));
  await screen.findByTestId('fake-map');
  await waitFor(() => expect(resources.activeTargets()).toBe(1));
  expect(resources.mount).toHaveBeenCalledTimes(2);
  rerender(wrap('places'));
  rerender(wrap('map'));
  await waitFor(() => expect(resources.activeTargets()).toBe(1));
  expect(resources.mount).toHaveBeenCalledTimes(2);
  rerender(wrap('map', 'two'));
  await waitFor(() => expect(resources.mount).toHaveBeenCalledTimes(4));
  expect(resources.snapshot().activeAdapters).toBe(1);
  rerender(wrap('map', 'two', '지도 실패'));
  expect(resources.snapshot().activeAdapters).toBe(0);
  expect(resources.activeTargets()).toBe(0);
  unmount();
  expect(resources.snapshot().pendingFrames).toBe(0);
});
it('숨김→표시에서 camera fit을 반복하지 않고 marker callback을 한 번 호출한다', async () => {
  const setMarkers = vi.spyOn(FakeMapAdapter.prototype, 'setMarkers');
  const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
  markerClick.mockClear();
  const store = createStore();
  const wrap = (view: ViewMode) => (
    <Provider store={store}>
      <Shell layout="compact" view={view} />
    </Provider>
  );
  const { rerender, unmount } = render(wrap('map'));
  await screen.findByTestId('marker-a');
  await waitFor(() => expect(fit).toHaveBeenCalledTimes(1));
  setMarkers.mockClear();
  rerender(wrap('places'));
  rerender(wrap('map'));
  await waitFor(() => expect(setMarkers).toHaveBeenCalledTimes(1));
  expect(fit).toHaveBeenCalledTimes(1);
  screen.getByTestId('marker-a').click();
  expect(markerClick).toHaveBeenCalledTimes(1);
  const detached = screen.getByTestId('marker-a');
  unmount();
  detached.click();
  expect(markerClick).toHaveBeenCalledTimes(1);
});
function installSdk() {
  const listeners = new Set<unknown>();
  const overlays = new Set<Overlay>();
  const labels: HTMLElement[] = [];
  class LatLng {
    x: number;
    y: number;
    constructor(lat: number, lng: number) {
      this.x = lng;
      this.y = lat;
    }
  }
  class Size {
    constructor(
      public width: number,
      public height: number,
    ) {}
  }
  class LatLngBounds {
    constructor(
      private sw: LatLng,
      private ne: LatLng,
    ) {}
    getMin() {
      return this.sw;
    }
    getMax() {
      return this.ne;
    }
  }
  class Overlay {
    private label?: HTMLElement;
    constructor(opts: Record<string, unknown>) {
      overlays.add(this);
      const icon = opts.icon as { content: HTMLElement } | undefined;
      if (icon) {
        this.label = icon.content;
        labels.push(icon.content);
        document.body.appendChild(icon.content);
      }
    }
    setMap(map: unknown) {
      if (map === null) {
        overlays.delete(this);
        this.label?.remove();
      }
    }
  }
  const map = {
    center: new LatLng(37.5, 128),
    zoom: 12,
    getBounds: () => new LatLngBounds(new LatLng(33, 124), new LatLng(39, 132)),
    getCenter: vi.fn(() => map.center),
    getZoom: vi.fn(() => map.zoom),
    setCenter: vi.fn((center: LatLng) => {
      map.center = center;
    }),
    setZoom: vi.fn((zoom: number) => {
      map.zoom = zoom;
    }),
    setSize: vi.fn(() => {
      map.center = new LatLng(0, 0);
      map.zoom = 1;
    }),
    fitBounds: vi.fn(),
    destroy: vi.fn(),
  };
  const MapCtor = vi.fn(function () {
    return map;
  });
  const removeListener = vi.fn((listener: unknown) => {
    listeners.delete(listener);
  });
  (window as unknown as { naver: unknown }).naver = {
    maps: {
      Map: MapCtor,
      Size,
      LatLng,
      LatLngBounds,
      Marker: Overlay,
      Polyline: Overlay,
      Event: {
        addListener: (_: unknown, name: string, callback: () => void) => {
          const listener = { name, callback };
          listeners.add(listener);
          return listener;
        },
        removeListener,
      },
    },
  };
  return { map, listeners, overlays, labels, removeListener, MapCtor };
}

it('실제 SDK Map/idle handle/연결 overlay를 뷰 순환 후 모두 정리한다', async () => {
  vi.stubEnv('VITE_MAP_ADAPTER', 'naver');
  vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'test');
  const sdk = installSdk();
  const store = createStore();
  const wrap = (view: ViewMode) => (
    <Provider store={store}>
      <Shell layout="wide" view={view} />
    </Provider>
  );
  const { rerender, unmount } = render(wrap('places'));
  expect(sdk.MapCtor).not.toHaveBeenCalled();
  rerender(wrap('map'));
  await waitFor(() => expect(sdk.overlays.size).toBe(1));
  expect(sdk.listeners.size).toBe(1);
  const firstLabel = sdk.labels[0]!;
  markerClick.mockClear();
  firstLabel.click();
  expect(markerClick).toHaveBeenCalledTimes(1);
  for (let n = 0; n < 10; n++) {
    rerender(wrap('places'));
    await waitFor(() => expect(resources.activeTargets()).toBe(0));
    rerender(wrap('day'));
    await waitFor(() => expect(resources.activeTargets()).toBe(1));
    expect(sdk.MapCtor).toHaveBeenCalledTimes(1);
    expect(sdk.listeners.size).toBe(1);
    expect(document.body.contains(sdk.labels.at(-1)!)).toBe(true);
  }
  const lastLabel = sdk.labels.at(-1)!;
  markerClick.mockClear();
  lastLabel.click();
  expect(markerClick).toHaveBeenCalledTimes(1);
  unmount();
  expect(sdk.map.destroy).toHaveBeenCalledTimes(1);
  expect(sdk.listeners.size).toBe(0);
  expect(sdk.overlays.size).toBe(0);
  expect(lastLabel.isConnected).toBe(false);
  lastLabel.click();
  expect(markerClick).toHaveBeenCalledTimes(1);
  expect(resources.snapshot()).toMatchObject({
    observedHosts: 0,
    bodyTargets: 0,
    pendingFrames: 0,
  });
});

it('SDK 인증 오류 종료는 실제 listener/overlay/observer를 정리한다', async () => {
  vi.stubEnv('VITE_MAP_ADAPTER', 'naver');
  vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'test');
  const sdk = installSdk();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { unmount } = render(
    <Provider>
      <Shell layout="split" view="map" />
    </Provider>,
  );
  await waitFor(() => expect(sdk.overlays.size).toBe(1));
  act(() => auth.fail?.());
  await waitFor(() => expect(resources.activeTargets()).toBe(0));
  expect(sdk.listeners.size).toBe(0);
  expect(sdk.overlays.size).toBe(0);
  expect(sdk.labels.every((label) => !label.isConnected)).toBe(true);
  expect(sdk.map.destroy).toHaveBeenCalledTimes(1);
  unmount();
  expect(resources.snapshot().pendingFrames).toBe(0);
});
it('폐기 어댑터의 marker/bounds 슬롯은 이벤트 주입에도 callback을 부르지 않는다', async () => {
  markerClick.mockClear();
  boundsChange.mockClear();
  const { unmount } = render(
    <Provider>
      <Shell layout="wide" view="map" />
    </Provider>,
  );
  await screen.findByTestId('marker-a');
  const instance = [...resources.liveInstances][0]!;
  markerClick.mockClear();
  boundsChange.mockClear();
  resources.injectEvents(instance);
  expect(markerClick).toHaveBeenCalledTimes(1);
  expect(boundsChange).toHaveBeenCalledTimes(1);
  unmount();
  expect(resources.liveInstances.size).toBe(0);
  resources.injectEvents(instance);
  expect(markerClick).toHaveBeenCalledTimes(1);
  expect(boundsChange).toHaveBeenCalledTimes(1);
});
