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

/**
 * 지도 바탕 click을 알리기까지 미루는 시간(ms). 그 사이 SDK `dblclick`(두 번 눌러 확대)이 오면 알리지 않아,
 * 빈 곳을 두 번 눌러 확대해도 선택이 풀리지 않는다.
 */
export const MAP_CLICK_DELAY_MS = 250;

/** 마커·클러스터 아이콘 DOM 표시. 그 위를 누른 것이 지도 `click`으로도 오면 걸러 낸다. */
const MARKER_ATTR = 'data-map-marker';

/**
 * SDK `click` 이벤트가 마커 아이콘에서 시작됐는가. 원래 DOM 이벤트는 Naver Maps v3 `PointerEvent`의
 * `pointerEvent`에 있다(`domEvent`도 함께 본다). 이 필드가 없거나 이름이 달라도 `drawMarkers`의 아이콘
 * click 기록이 한 번 더 막는다 — 이 함수 하나에만 기대지 않는다.
 */
function fromMarker(event: unknown): boolean {
  const e = event as
    { pointerEvent?: { target?: unknown }; domEvent?: { target?: unknown } } | undefined;
  const target = (e?.pointerEvent ?? e?.domEvent)?.target;
  return target instanceof Element && target.closest(`[${MARKER_ATTR}]`) !== null;
}

/** 마커 감싸개 클릭 통과 규칙을 넣는 `<style>`의 고정 id. 문서에 한 번만 넣기 위한 표시다. */
const MARKER_STYLE_ID = 'naver-map-marker-pointer-events';

/**
 * 네이버 SDK는 `icon.content`(우리 알약)를 자기 감싸개 div에 넣는데, 알약은 `translate(-50%, -50%)`로 옮겨 그려져도
 * 감싸개는 원래 자리(알약 오른쪽 아래로 반 칸 어긋난 사각형)에 남는다. 그 보이지 않는 사각형이 이웃 마커와
 * 지도 바탕의 클릭을 가로채므로, 감싸개는 클릭을 통과시키고 보이는 알약만 받게 한다. SDK가 감싸개를 비동기로
 * 붙여도 먹도록 인라인 스타일 대신 문서 규칙으로 건다.
 */
function ensureMarkerPointerStyle(): void {
  if (document.getElementById(MARKER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MARKER_STYLE_ID;
  style.textContent = `div:has(> [${MARKER_ATTR}]) { pointer-events: none; } [${MARKER_ATTR}] { pointer-events: auto; }`;
  document.head.append(style);
}

const maps = (): NaverMaps => (window as unknown as { naver: { maps: NaverMaps } }).naver.maps;

export class NaverMapAdapter implements MapAdapter {
  private map: NaverMap | null = null;
  private markers: MapMarker[] = [];
  private selectedMarker: MapMarker | null = null;
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
  /** 마커·클러스터 아이콘이 눌린 횟수. 지도 click을 미룬 사이 늘었으면 그 click은 마커 것이다. */
  private markerClickSeq = 0;
  /** 마커 아이콘 click 직후(같은 입력 처리 안)인가. DOM click이 SDK 지도 click보다 먼저 올 때를 막는다. */
  private recentMarkerClick = false;
  private recentMarkerTimer: ReturnType<typeof setTimeout> | null = null;
  private mapClickTimer: ReturnType<typeof setTimeout> | null = null;

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
    ensureMarkerPointerStyle();
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
      m.Event.addListener(map, 'click', (event?: unknown) => this.handleMapClick(event)),
      m.Event.addListener(map, 'dblclick', () => this.cancelMapClick()),
    );
    this.drawPolylines();
    this.drawMyLocation();
  }

  setMarkers(markers: MapMarker[]): void {
    this.markers = markers;
    this.cluster = buildClusterIndex(markers);
    this.drawMarkers();
  }

  setSelectedMarker(marker: MapMarker | null): void {
    if (marker === this.selectedMarker) return;
    this.selectedMarker = marker;
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
    if (this.mapClickTimer) clearTimeout(this.mapClickTimer);
    if (this.recentMarkerTimer) clearTimeout(this.recentMarkerTimer);
    this.mapClickTimer = null;
    this.recentMarkerTimer = null;
    this.recentMarkerClick = false;
    this.boundsCb = null;
    this.markers = [];
    this.selectedMarker = null;
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

  private noteMarkerClick(): void {
    this.markerClickSeq += 1;
    this.recentMarkerClick = true;
    if (this.recentMarkerTimer) clearTimeout(this.recentMarkerTimer);
    this.recentMarkerTimer = setTimeout(() => {
      this.recentMarkerTimer = null;
      this.recentMarkerClick = false;
    }, 0);
  }

  /**
   * 지도 바탕 누르기만 `mapClickCb`로 알린다. 마커 아이콘 click이 SDK 지도 click보다 늦게 올 수 있고, 두 번
   * 눌러 확대하는 `dblclick`이 뒤따를 수 있어 `MAP_CLICK_DELAY_MS` 미룬 뒤, 그 사이 아이콘이 눌렸으면 버린다
   * (`dblclick`은 `cancelMapClick`이 지운다).
   */
  private handleMapClick(event: unknown): void {
    if (fromMarker(event) || this.recentMarkerClick) return;
    const seq = this.markerClickSeq;
    this.cancelMapClick();
    this.mapClickTimer = setTimeout(() => {
      this.mapClickTimer = null;
      if (seq === this.markerClickSeq) this.mapClickCb?.();
    }, MAP_CLICK_DELAY_MS);
  }

  /** 미뤄 둔 지도 바탕 click 알림을 버린다(두 번 눌러 확대). */
  private cancelMapClick(): void {
    if (this.mapClickTimer) clearTimeout(this.mapClickTimer);
    this.mapClickTimer = null;
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
      const handleClick = () => {
        this.noteMarkerClick();
        onClick();
      };
      el.setAttribute(MARKER_ATTR, '');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleClick();
      };
      el.addEventListener('click', handleClick);
      el.addEventListener('keydown', handleKeyDown);
      this.markerClickCleanups.push(() => {
        el.removeEventListener('click', handleClick);
        el.removeEventListener('keydown', handleKeyDown);
      });
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
    const selected = this.selectedMarker;
    const shown =
      selected === null ? singles : [...singles.filter((m) => m.id !== selected.id), selected];
    for (const mk of shown) {
      add(
        mk.lng,
        mk.lat,
        createMarkerLabelElement(mk.label ?? '', mk.color, mk),
        () => this.markerCb?.(mk.id),
        mk.selected ? SELECTED_Z_INDEX : mk.shape === 'dot' ? -1 : 0,
      );
    }
  }
}
