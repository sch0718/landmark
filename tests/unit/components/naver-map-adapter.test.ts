import { afterEach, describe, expect, it, vi } from 'vitest';
import { NaverMapAdapter } from 'src/components/map/NaverMapAdapter';
import { installMapResources } from './helpers/map-resources';

let release!: () => void;
let resources: ReturnType<typeof installMapResources> | undefined;
vi.mock('src/components/map/load-naver-sdk', () => ({
  loadNaverSdk: vi.fn(() => new Promise<void>((r) => (release = r))),
}));

afterEach(() => {
  resources?.restore();
  resources = undefined;
  delete (window as { naver?: unknown }).naver;
});

describe('NaverMapAdapter', () => {
  it('SDK 로드 중 destroy되면 Map을 만들지 않는다', async () => {
    const MapCtor = vi.fn();
    (window as unknown as { naver: unknown }).naver = { maps: { Map: MapCtor, LatLng: vi.fn() } };
    const adapter = new NaverMapAdapter('id');
    const mounted = adapter.mount(document.createElement('div'));
    adapter.destroy();
    release();
    await mounted;
    expect(MapCtor).not.toHaveBeenCalled();
  });
});

function installSdk() {
  const listeners = new Set<unknown>();
  const overlays = new Set<Overlay>();
  const labels: HTMLElement[] = [];
  const markerOptions: Record<string, unknown>[] = [];
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
    constructor(opts: Record<string, unknown>) {
      overlays.add(this);
      const icon = opts.icon as { content: HTMLElement } | undefined;
      if (icon) {
        labels.push(icon.content);
        markerOptions.push(opts);
      }
    }
    setMap(map: unknown) {
      if (map === null) overlays.delete(this);
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
  return { map, MapCtor, listeners, overlays, labels, markerOptions, removeListener };
}

describe('NaverMapAdapter SDK 계약', () => {
  // 휴대폰에서는 SDK 막대가 왼쪽 위 핀 이름표를 가린다. 터치 전용 기기에서는 막대를 빼고 MapView가 ＋/− 버튼을 그린다.
  // 마우스를 함께 쓰는 터치 기기는 `any-hover: none`이 아니므로 막대를 그대로 둔다.
  it.each([
    ['터치 전용', ['(any-hover: none) and (any-pointer: coarse)'], false],
    [
      '주 입력이 터치이고 마우스도 연결',
      ['(hover: none) and (pointer: coarse)', '(any-pointer: coarse)'],
      true,
    ],
    ['마우스만', ['(hover: hover) and (pointer: fine)'], true],
  ])('%s → zoomControl=%s', async (_, matching, zoomControl) => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: matching.includes(q) }));
    try {
      const sdk = installSdk();
      const pending = new NaverMapAdapter('id').mount(document.createElement('div'));
      release();
      await pending;
      expect(sdk.MapCtor).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ zoomControl }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('matchMedia가 없으면 확대·축소 막대를 보인다', async () => {
    vi.stubGlobal('matchMedia', undefined);
    try {
      const sdk = installSdk();
      const pending = new NaverMapAdapter('id').mount(document.createElement('div'));
      release();
      await pending;
      expect(sdk.MapCtor).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ zoomControl: true }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resize가 Size를 전달하고 SDK가 바꾼 center/zoom을 복원하며 bounds를 알린다', async () => {
    const sdk = installSdk();
    const adapter = new NaverMapAdapter('id');
    const bounds = vi.fn();
    adapter.onBoundsChange(bounds);
    const pending = adapter.mount(document.createElement('div'));
    release();
    await pending;
    expect(adapter.getCamera()).toEqual({ center: [128, 37.5], zoom: 12 });
    adapter.resize(390, 500);
    expect(sdk.map.setSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 390, height: 500 }),
    );
    expect(adapter.getCamera()).toEqual({ center: [128, 37.5], zoom: 12 });
    expect(bounds).toHaveBeenCalledWith({ west: 124, south: 33, east: 132, north: 39 });
    adapter.resize(0, 500);
    expect(sdk.map.setSize).toHaveBeenCalledTimes(1);
    adapter.setCamera({ center: [127, 36], zoom: 14 });
    expect(sdk.map.center).toMatchObject({ x: 127, y: 36 });
    expect(sdk.map.zoom).toBe(14);
    adapter.destroy();
    expect(adapter.getCamera()).toBeNull();
    adapter.resize(390, 500);
    adapter.setCamera({ center: [128, 37], zoom: 8 });
    expect(sdk.map.setSize).toHaveBeenCalledTimes(1);
  });
  it('fitBounds에 기본 여백과 가림 영역 여백을 전달한다', async () => {
    const sdk = installSdk();
    const adapter = new NaverMapAdapter('id');
    const pending = adapter.mount(document.createElement('div'));
    release();
    await pending;
    const points: [number, number][] = [
      [127, 36],
      [128, 37],
    ];
    adapter.fitBounds(points);
    expect(sdk.map.fitBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sw: expect.objectContaining({ x: 127, y: 36 }),
        ne: expect.objectContaining({ x: 128, y: 37 }),
      }),
      { top: 40, right: 40, bottom: 40, left: 40 },
    );
    const padding = { top: 24, right: 24, bottom: 360, left: 24 };
    adapter.fitBounds(points, padding);
    expect(sdk.map.fitBounds).toHaveBeenLastCalledWith(expect.anything(), padding);
    adapter.destroy();
  });
  it('재그리기와 반복 destroy는 Event·overlay·DOM click·callback 슬롯을 정리한다', async () => {
    resources = installMapResources();
    const sdk = installSdk();
    const adapter = new NaverMapAdapter('id');
    resources.trackNaver(adapter);
    resources.setSdkProbe(() => ({
      sdkListeners: sdk.listeners.size,
      overlays: sdk.overlays.size,
    }));
    const click = vi.fn();
    const bounds = vi.fn();
    adapter.onMarkerClick(click);
    adapter.onBoundsChange(bounds);
    const pending = adapter.mount(document.createElement('div'));
    release();
    await pending;
    const marker = { id: 'a', lng: 128, lat: 37.5, label: 'a', color: '#000', clusterable: false };
    adapter.setMarkers([marker]);
    adapter.setPolylines([{ id: 'l', path: [[128, 37]], color: '#000', dashed: false }]);
    const oldLabel = sdk.labels[0]!;
    oldLabel.click();
    expect(click).toHaveBeenCalledTimes(1);
    adapter.resize(390, 500);
    oldLabel.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(sdk.overlays.size).toBe(2);
    expect(resources.snapshot()).toMatchObject({
      activeAdapters: 1,
      callbackSlots: 2,
      sdkListeners: 1,
      overlays: 2,
    });
    const idle = [...sdk.listeners][0] as { callback: () => void };
    adapter.destroy();
    adapter.destroy();
    for (const label of sdk.labels) label.click();
    idle.callback();
    expect(click).toHaveBeenCalledTimes(1);
    expect(bounds).toHaveBeenCalledTimes(1);
    expect(sdk.listeners.size).toBe(0);
    expect(sdk.overlays.size).toBe(0);
    expect(sdk.removeListener).toHaveBeenCalledTimes(1);
    expect(sdk.map.destroy).toHaveBeenCalledTimes(1);
    expect(adapter).toMatchObject({ markerCb: null, boundsCb: null });
    expect(Object.values(resources.snapshot()).every((count) => count === 0)).toBe(true);
  });
  it('선택된 마커는 더 높은 zIndex로 그린다', async () => {
    resources = installMapResources();
    const sdk = installSdk();
    const adapter = new NaverMapAdapter('id');
    resources.trackNaver(adapter);
    const pending = adapter.mount(document.createElement('div'));
    release();
    await pending;
    const base = { lng: 128, lat: 37.5, color: '#000', clusterable: false };
    adapter.setMarkers([
      { ...base, id: 'a', label: 'a' },
      { ...base, id: 'b', label: 'b', selected: true },
    ]);
    const z = (text: string) =>
      sdk.markerOptions.findLast(
        (o) => (o.icon as { content: HTMLElement }).content.textContent === text,
      )!.zIndex as number;
    expect(z('b')).toBeGreaterThan(z('a'));
    adapter.destroy();
  });

  it('클러스터는 setClusterStyle로 받은 색을 쓴다', async () => {
    resources = installMapResources();
    const sdk = installSdk();
    const adapter = new NaverMapAdapter('id');
    resources.trackNaver(adapter);
    const pending = adapter.mount(document.createElement('div'));
    release();
    await pending;
    adapter.setClusterStyle({ color: '#102030', textColor: '#a0b0c0' });
    adapter.setMarkers([
      { id: 'a', lng: 128, lat: 37.5, label: 'a', color: '#000', clusterable: true },
      { id: 'b', lng: 128.0001, lat: 37.5001, label: 'b', color: '#000', clusterable: true },
    ]);
    const cluster = sdk.labels.findLast((el) => el.textContent === '2')!;
    expect(cluster.style.background).toBe('rgb(16, 32, 48)');
    expect(cluster.style.color).toBe('rgb(160, 176, 192)');
    adapter.destroy();
  });
});
