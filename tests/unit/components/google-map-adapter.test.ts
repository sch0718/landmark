import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleMapAdapter, fitCamera } from 'src/components/map/GoogleMapAdapter';
import { MAP_CLICK_DELAY_MS } from 'src/components/map/NaverMapAdapter';

let release: () => void;
vi.mock('src/components/map/load-google-sdk', () => ({
  loadGoogleSdk: () =>
    new Promise<void>((resolve) => {
      release = resolve;
    }),
}));
function installSdk() {
  const listeners = new Map<string, (event?: unknown) => void>();
  const pane = document.createElement('div');
  document.body.append(pane);
  let center = { lat: 37.5, lng: 128.2 };
  let zoom = 8;
  const map = {
    getCenter: () => ({ lat: () => center.lat, lng: () => center.lng }),
    getZoom: () => zoom,
    getBounds: () => ({
      getSouthWest: () => ({ lat: () => -80, lng: () => -180 }),
      getNorthEast: () => ({ lat: () => 80, lng: () => 180 }),
    }),
    moveCamera: vi.fn((camera) => {
      center = camera.center;
      zoom = camera.zoom;
    }),
  };
  const overlays = new Set<unknown>();
  class OverlayView {
    onAdd() {}
    draw() {}
    onRemove() {}
    setMap(map: unknown) {
      if (map) {
        overlays.add(this);
        this.onAdd();
        this.draw();
      } else {
        overlays.delete(this);
        this.onRemove();
      }
    }
    getPanes() {
      return { overlayMouseTarget: pane };
    }
    getProjection() {
      return { fromLatLngToDivPixel: () => ({ x: 100, y: 200 }) };
    }
    static preventMapHitsAndGesturesFrom = vi.fn();
  }
  class Shape {
    constructor(readonly options: unknown) {
      overlays.add(this);
    }
    setMap(map: unknown) {
      if (!map) overlays.delete(this);
    }
  }
  const MapCtor = vi.fn(function () {
    return map;
  });
  const Polyline = vi.fn(class extends Shape {});
  const Circle = vi.fn(class extends Shape {});
  const remove = vi.fn();
  vi.stubGlobal('google', {
    maps: {
      Map: MapCtor,
      OverlayView,
      Polyline,
      Circle,
      LatLng: class {
        constructor(
          readonly lat: number,
          readonly lng: number,
        ) {}
      },
      event: {
        addListener: (_: unknown, name: string, cb: (event?: unknown) => void) => {
          listeners.set(name, cb);
          return {
            remove: () => {
              listeners.delete(name);
              remove();
            },
          };
        },
        clearInstanceListeners: vi.fn(),
      },
    },
  });
  return { map, pane, listeners, overlays, MapCtor, Polyline, Circle, remove, OverlayView };
}
async function mount(adapter: GoogleMapAdapter) {
  const el = document.createElement('div');
  Object.defineProperties(el, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const pending = adapter.mount(el);
  release();
  await pending;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const marker = {
  id: 'a',
  label: '장소',
  lng: 128,
  lat: 37.5,
  color: '#123456',
  clusterable: false,
};

describe('GoogleMapAdapter', () => {
  it('기본 조작 설정으로 붙고 마커·선택·묶음·키보드 입력을 그린다', async () => {
    const sdk = installSdk();
    const adapter = new GoogleMapAdapter('key', { zoomControl: false });
    await mount(adapter);
    expect(sdk.MapCtor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        zoom: 8,
        disableDefaultUI: true,
        zoomControl: false,
        clickableIcons: false,
        gestureHandling: 'greedy',
      }),
    );
    const click = vi.fn();
    adapter.onMarkerClick(click);
    adapter.setMarkers([marker, { ...marker, id: '점', shape: 'dot' }]);
    const dot = sdk.pane.querySelector<HTMLElement>('[data-shape="dot"]')!;
    expect(dot).toHaveAccessibleName('장소');
    expect(dot.style.zIndex).toBe('-1');
    dot.click();
    for (const key of ['Enter', ' ']) dot.dispatchEvent(new KeyboardEvent('keydown', { key }));
    expect(click.mock.calls).toEqual([['점'], ['점'], ['점']]);
    adapter.setSelectedMarker({ ...marker, selected: true });
    expect(sdk.pane.querySelector<HTMLElement>('[style*="z-index: 1000"]')).not.toBeNull();
    adapter.setSelectedMarker(null);
    adapter.setClusterStyle({ color: '#102030', textColor: '#a0b0c0' });
    adapter.setMarkers([
      { ...marker, clusterable: true },
      { ...marker, id: 'b', clusterable: true },
    ]);
    const cluster = sdk.pane.querySelector<HTMLElement>('[role="button"]')!;
    expect(cluster.textContent).toBe('2');
    expect(cluster.style.background).toBe('rgb(16, 32, 48)');
    cluster.click();
    expect(adapter.getCamera()!.zoom).toBeGreaterThan(8);
    adapter.destroy();
    dot.click();
    expect(click).toHaveBeenCalledTimes(3);
    expect(sdk.overlays.size).toBe(0);
    expect(sdk.pane.children).toHaveLength(0);
    expect(sdk.listeners.size).toBe(0);
    adapter.destroy();
    expect(sdk.remove).toHaveBeenCalledTimes(3);
  });
  it('카메라를 바로 옮기고 fitBounds 직후 맞춘 값을 읽을 수 있다', async () => {
    installSdk();
    const adapter = new GoogleMapAdapter('key');
    await mount(adapter);
    adapter.setCamera({ center: [135, 35], zoom: 12 });
    expect(adapter.getCamera()).toEqual({ center: [135, 35], zoom: 12 });
    const points: [number, number][] = [
      [135, 34],
      [136, 35],
    ];
    adapter.fitBounds(points);
    expect(adapter.getCamera()).toEqual(fitCamera(points, { width: 800, height: 600 }));
    const camera = adapter.getCamera();
    const bounds = vi.fn();
    adapter.onBoundsChange(bounds);
    adapter.resize(400, 500);
    expect(adapter.getCamera()).toEqual(camera);
    expect(bounds).toHaveBeenCalled();
    adapter.destroy();
    expect(adapter.getCamera()).toBeNull();
  });
  it('지도 click은 미루고 dblclick·마커 입력·destroy가 오면 버린다', async () => {
    const sdk = installSdk();
    const adapter = new GoogleMapAdapter('key');
    await mount(adapter);
    const click = vi.fn();
    adapter.onMapClick(click);
    sdk.listeners.get('click')!();
    vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);
    expect(click).toHaveBeenCalledTimes(1);
    sdk.listeners.get('click')!();
    sdk.listeners.get('dblclick')!();
    vi.runAllTimers();
    expect(click).toHaveBeenCalledTimes(1);
    adapter.setMarkers([marker]);
    sdk.listeners.get('click')!();
    sdk.pane.querySelector<HTMLElement>('[role="button"]')!.click();
    vi.runAllTimers();
    expect(click).toHaveBeenCalledTimes(1);
    sdk.listeners.get('click')!();
    adapter.destroy();
    vi.runAllTimers();
    expect(click).toHaveBeenCalledTimes(1);
  });
  it('점선·내 위치를 그리고 교체·삭제 때 오버레이를 걷는다', async () => {
    const sdk = installSdk();
    const adapter = new GoogleMapAdapter('key');
    adapter.setMyLocation({ lng: 128, lat: 37, accuracyM: 30 });
    await mount(adapter);
    expect(sdk.Circle).toHaveBeenCalledWith(
      expect.objectContaining({ radius: 30, clickable: false, zIndex: -2 }),
    );
    expect(sdk.pane.querySelector<HTMLElement>('[data-my-location]')!.style.pointerEvents).toBe(
      'none',
    );
    adapter.setPolylines([{ id: '선', path: [[128, 37]], color: '#000', dashed: true }]);
    expect(sdk.Polyline).toHaveBeenCalledWith(
      expect.objectContaining({ strokeOpacity: 0, icons: expect.any(Array) }),
    );
    adapter.setMyLocation(null);
    expect(sdk.pane.querySelector('[data-my-location]')).toBeNull();
    adapter.destroy();
    expect(sdk.overlays.size).toBe(0);
  });
  it('SDK를 기다리는 동안 destroy하면 지도를 만들지 않는다', async () => {
    const sdk = installSdk();
    const adapter = new GoogleMapAdapter('key');
    const pending = adapter.mount(document.createElement('div'));
    adapter.destroy();
    release();
    await pending;
    expect(sdk.MapCtor).not.toHaveBeenCalled();
  });
});

describe('fitCamera', () => {
  it('한 점은 줌 21, 빈 목록·크기 없음은 null이다', () => {
    expect(fitCamera([[135, 35]], { width: 800, height: 600 })!.zoom).toBe(21);
    expect(fitCamera([], { width: 800, height: 600 })).toBeNull();
    expect(fitCamera([[135, 35]], { width: 0, height: 0 })).toBeNull();
  });
  it('비대칭 여백을 빼고 메르카토르 중심과 정수 줌을 계산한다', () => {
    const points: [number, number][] = [
      [135, 34],
      [136, 35],
    ];
    const normal = fitCamera(points, { width: 800, height: 600 })!;
    const padded = fitCamera(
      points,
      { width: 800, height: 600 },
      { top: 40, right: 40, bottom: 300, left: 40 },
    )!;
    expect(normal.center[0]).toBeCloseTo(135.5);
    expect(normal.center[1]).toBeGreaterThan(34.5);
    expect(Number.isInteger(normal.zoom)).toBe(true);
    expect(padded.zoom).toBeLessThanOrEqual(normal.zoom);
    expect(padded.center[1]).toBeLessThan(normal.center[1]);
  });
  it('날짜 변경선을 사이에 둔 점은 짧은 쪽으로 맞춘다', () => {
    const camera = fitCamera(
      [
        [179, 10],
        [-179, 10],
      ],
      { width: 800, height: 600 },
    )!;
    expect(Math.abs(camera.center[0])).toBeCloseTo(180);
    expect(camera.zoom).toBeGreaterThan(7);
  });
});
