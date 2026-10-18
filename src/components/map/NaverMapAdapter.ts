import { buildClusterIndex, clusterFeatures, type ClusterIndex } from './cluster';
import { loadNaverSdk } from './load-naver-sdk';
import {
  DEFAULT_CLUSTER_STYLE,
  MY_LOCATION_COLOR,
  MY_LOCATION_Z_INDEX,
  type Bounds,
  type ClusterStyle,
  type MapAdapter,
  type MapCamera,
  type MapMarker,
  type MapPadding,
  type MapPolyline,
  type MyLocation,
} from './MapAdapter';
import { createMarkerLabelElement } from './marker-label';

/** 사용하는 Naver Maps v3 API만 좁게 선언한다(전용 타입 패키지는 추가하지 않는다). */
type Overlay = { setMap(map: unknown): void };
type NaverMaps = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => NaverMap;
  Size: new (width: number, height: number) => unknown;
  LatLng: new (lat: number, lng: number) => unknown;
  LatLngBounds: new (sw: unknown, ne: unknown) => unknown;
  Marker: new (opts: Record<string, unknown>) => Overlay;
  Polyline: new (opts: Record<string, unknown>) => Overlay;
  Circle: new (
    opts: Record<string, unknown>,
  ) => Overlay & { setCenter?(c: unknown): void; setRadius?(r: number): void };
  Event: {
    addListener(target: unknown, name: string, cb: (event?: unknown) => void): unknown;
    removeListener(listener: unknown): void;
  };
};
type NaverMap = {
  getBounds(): { getMin(): { x: number; y: number }; getMax(): { x: number; y: number } };
  getCenter(): { x: number; y: number };
  setSize(size: unknown): void;
  getZoom(): number;
  setZoom(z: number): void;
  setCenter(c: unknown): void;
  fitBounds(b: unknown, margin?: Record<string, number>): void;
  destroy(): void;
};

/** 선택된 마커가 다른 마커·클러스터 위에 오도록 하는 쌓임 순서. */
const SELECTED_Z_INDEX = 1000;

/** 내 위치 점의 지름(px)과 흰 테두리 두께(px). */
const MY_LOCATION_DOT_SIZE = 18;
const MY_LOCATION_DOT_BORDER = 3;

function createMyLocationDotElement(): HTMLElement {
  const el = document.createElement('div');
  // 테두리까지 18px이 되도록 border-box. 누를 수 없고 아래 지도에 이벤트를 넘긴다.
  el.style.cssText = [
    'box-sizing:border-box',
    `width:${MY_LOCATION_DOT_SIZE}px`,
    `height:${MY_LOCATION_DOT_SIZE}px`,
    'border-radius:50%',
    `background:${MY_LOCATION_COLOR}`,
    `border:${MY_LOCATION_DOT_BORDER}px solid #fff`,
    'box-shadow:0 0 3px rgba(0,0,0,.4)',
    'pointer-events:none',
  ].join(';');
  return el;
}

/** 마커·클러스터 아이콘 DOM 표시. 그 위를 누른 것이 지도 `click`으로도 오면 걸러 낸다. */
const MARKER_ATTR = 'data-map-marker';

/** SDK `click` 이벤트가 마커 아이콘에서 시작됐는가(`domEvent`는 SDK가 넘기는 원래 DOM 이벤트). */
function fromMarker(event: unknown): boolean {
  const target = (event as { domEvent?: { target?: unknown } } | undefined)?.domEvent?.target;
  return target instanceof Element && target.closest(`[${MARKER_ATTR}]`) !== null;
}

const maps = (): NaverMaps => (window as unknown as { naver: { maps: NaverMaps } }).naver.maps;

export class NaverMapAdapter implements MapAdapter {
  private map: NaverMap | null = null;
  private markers: MapMarker[] = [];
  private cluster: ClusterIndex = buildClusterIndex([]);
  private clusterStyle: ClusterStyle = DEFAULT_CLUSTER_STYLE;
  private markerOverlays: Overlay[] = [];
  private lineOverlays: Overlay[] = [];
  private lines: MapPolyline[] = [];
  private myLocation: MyLocation | null = null;
  private myLocationOverlays: Overlay[] = [];
  private destroyed = false;
  private listeners: unknown[] = [];
  private markerClickCleanups: (() => void)[] = [];
  private markerCb: ((id: string) => void) | null = null;
  private boundsCb: ((b: Bounds) => void) | null = null;
  private mapClickCb: (() => void) | null = null;

  /**
   * @param options.zoomControl SDK 확대·축소 막대를 보일까(기본 보임). 대신 쓸 ＋/− 버튼을 직접 그리는 쪽
   *   (`MapView`의 `MapZoomButtons`)만 끈다 — 끄기만 하면 한 손가락 축소 수단이 없어진다.
   */
  constructor(
    private readonly clientId: string,
    private readonly options: { zoomControl?: boolean } = {},
  ) {}

  async mount(el: HTMLElement): Promise<void> {
    await loadNaverSdk(this.clientId);
    if (this.destroyed) return;
    const m = maps();
    const map = new m.Map(el, {
      center: new m.LatLng(37.5, 128.2),
      zoom: 8,
      zoomControl: this.options.zoomControl ?? true,
    });
    this.map = map;
    this.listeners.push(
      m.Event.addListener(map, 'idle', () => {
        this.drawMarkers();
        const b = this.currentBounds();
        if (b) this.boundsCb?.(b);
      }),
      m.Event.addListener(map, 'click', (event?: unknown) => {
        if (fromMarker(event)) return;
        this.mapClickCb?.();
      }),
    );
    this.drawPolylines();
    this.drawMyLocation();
  }

  setMarkers(markers: MapMarker[]): void {
    this.markers = markers;
    this.cluster = buildClusterIndex(markers);
    this.drawMarkers();
  }

  setClusterStyle(style: ClusterStyle): void {
    this.clusterStyle = style;
    this.drawMarkers();
  }

  setPolylines(lines: MapPolyline[]): void {
    this.lines = lines;
    this.drawPolylines();
  }

  setMyLocation(fix: MyLocation | null): void {
    this.myLocation = fix;
    this.drawMyLocation();
  }

  /**
   * 정확도 원과 점을 지우고 다시 만든다. 옵션 이름은 Naver Maps v3 공식 문서(CircleOptions·MarkerOptions)와
   * 대조했다(2026-10-17, PR #24 리뷰). 음수 zIndex로 장소 마커 아래에 깔리는지는 실제 화면 확인 필요(스펙 §11).
   */
  private drawMyLocation(): void {
    for (const o of this.myLocationOverlays) o.setMap(null);
    this.myLocationOverlays = [];
    const map = this.map;
    const fix = this.myLocation;
    if (!map || !fix) return;
    const m = maps();
    const center = new m.LatLng(fix.lat, fix.lng);
    const circle = new m.Circle({
      map,
      center,
      radius: fix.accuracyM,
      fillColor: MY_LOCATION_COLOR,
      fillOpacity: 0.12,
      strokeColor: MY_LOCATION_COLOR,
      strokeOpacity: 0.35,
      strokeWeight: 1,
      clickable: false,
      zIndex: MY_LOCATION_Z_INDEX - 1,
    });
    const half = MY_LOCATION_DOT_SIZE / 2;
    const dot = new m.Marker({
      map,
      position: center,
      icon: { content: createMyLocationDotElement(), anchor: { x: half, y: half } },
      clickable: false,
      zIndex: MY_LOCATION_Z_INDEX,
    });
    this.myLocationOverlays = [circle, dot];
  }

  private drawPolylines(): void {
    if (!this.map) return;
    const lines = this.lines;
    const m = maps();
    for (const o of this.lineOverlays) o.setMap(null);
    this.lineOverlays = lines.map(
      (l) =>
        new m.Polyline({
          map: this.map,
          path: l.path.map(([lng, lat]) => new m.LatLng(lat, lng)),
          strokeColor: l.color,
          strokeWeight: 4,
          strokeOpacity: 0.85,
          strokeStyle: l.dashed ? 'shortdash' : 'solid',
        }),
    );
  }

  resize(width: number, height: number): void {
    if (!this.map || width <= 0 || height <= 0) return;
    const camera = this.getCamera();
    this.map.setSize(new (maps().Size)(width, height));
    if (camera) this.setCamera(camera);
    this.drawMarkers();
    const bounds = this.currentBounds();
    if (bounds) this.boundsCb?.(bounds);
  }

  getCamera(): MapCamera | null {
    if (!this.map) return null;
    const point = this.map.getCenter();
    return { center: [point.x, point.y], zoom: this.map.getZoom() };
  }

  setCamera(camera: MapCamera): void {
    if (!this.map) return;
    this.map.setCenter(new (maps().LatLng)(camera.center[1], camera.center[0]));
    this.map.setZoom(camera.zoom);
  }

  fitBounds(points: [number, number][], padding?: MapPadding): void {
    if (!this.map || points.length === 0) return;
    const m = maps();
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const sw = new m.LatLng(Math.min(...lats), Math.min(...lngs));
    const ne = new m.LatLng(Math.max(...lats), Math.max(...lngs));
    this.map.fitBounds(
      new m.LatLngBounds(sw, ne),
      padding ?? { top: 40, right: 40, bottom: 40, left: 40 },
    );
  }

  onMarkerClick(cb: (id: string) => void): void {
    this.markerCb = cb;
  }

  onMapClick(cb: () => void): void {
    this.mapClickCb = cb;
  }

  onBoundsChange(cb: (b: Bounds) => void): void {
    this.boundsCb = cb;
  }

  destroy(): void {
    this.destroyed = true;
    this.markerCb = null;
    this.mapClickCb = null;
    this.boundsCb = null;
    this.markers = [];
    this.lines = [];
    this.myLocation = null;
    this.cluster = buildClusterIndex([]);
    for (const cleanup of this.markerClickCleanups) cleanup();
    this.markerClickCleanups = [];
    const m = (window as unknown as { naver?: { maps?: NaverMaps } }).naver?.maps;
    for (const l of this.listeners) m?.Event.removeListener(l);
    this.listeners = [];
    for (const o of [...this.markerOverlays, ...this.lineOverlays, ...this.myLocationOverlays])
      o.setMap(null);
    this.markerOverlays = [];
    this.lineOverlays = [];
    this.myLocationOverlays = [];
    this.map?.destroy();
    this.map = null;
  }

  private currentBounds(): Bounds | null {
    if (!this.map) return null;
    const b = this.map.getBounds();
    const min = b.getMin();
    const max = b.getMax();
    return { west: min.x, south: min.y, east: max.x, north: max.y };
  }

  private drawMarkers(): void {
    const map = this.map;
    const bounds = this.currentBounds();
    if (!map || !bounds) return;
    const m = maps();
    for (const cleanup of this.markerClickCleanups) cleanup();
    this.markerClickCleanups = [];
    for (const o of this.markerOverlays) o.setMap(null);
    this.markerOverlays = [];

    const byId = new Map(this.markers.map((mk) => [mk.id, mk]));
    const add = (lng: number, lat: number, el: HTMLElement, onClick: () => void, zIndex = 0) => {
      const overlay = new m.Marker({
        map,
        position: new m.LatLng(lat, lng),
        icon: { content: el, anchor: { x: 0, y: 0 } },
        zIndex,
      });
      el.setAttribute(MARKER_ATTR, '');
      el.addEventListener('click', onClick);
      this.markerClickCleanups.push(() => el.removeEventListener('click', onClick));
      el.style.cursor = 'pointer';
      this.markerOverlays.push(overlay);
    };

    const singles: MapMarker[] = [...this.cluster.fixed];
    for (const f of clusterFeatures(this.cluster, bounds, map.getZoom())) {
      if (f.kind === 'point') {
        const mk = byId.get(f.markerId);
        if (mk) singles.push(mk);
      } else {
        const { color, textColor } = this.clusterStyle;
        add(f.lng, f.lat, createMarkerLabelElement(String(f.count), color, { textColor }), () => {
          map.setCenter(new m.LatLng(f.lat, f.lng));
          map.setZoom(this.cluster.expansionZoom(f.id));
        });
      }
    }
    for (const mk of singles) {
      add(
        mk.lng,
        mk.lat,
        createMarkerLabelElement(mk.label ?? '', mk.color, mk),
        () => this.markerCb?.(mk.id),
        mk.selected ? SELECTED_Z_INDEX : 0,
      );
    }
  }
}
