import { buildClusterIndex, clusterFeatures, type ClusterIndex } from './cluster';
import { loadNaverSdk } from './load-naver-sdk';
import type {
  Bounds,
  MapAdapter,
  MapCamera,
  MapMarker,
  MapPadding,
  MapPolyline,
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
  Event: {
    addListener(target: unknown, name: string, cb: () => void): unknown;
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

const maps = (): NaverMaps => (window as unknown as { naver: { maps: NaverMaps } }).naver.maps;

export class NaverMapAdapter implements MapAdapter {
  private map: NaverMap | null = null;
  private markers: MapMarker[] = [];
  private cluster: ClusterIndex = buildClusterIndex([]);
  private markerOverlays: Overlay[] = [];
  private lineOverlays: Overlay[] = [];
  private lines: MapPolyline[] = [];
  private destroyed = false;
  private listeners: unknown[] = [];
  private markerClickCleanups: (() => void)[] = [];
  private markerCb: ((id: string) => void) | null = null;
  private boundsCb: ((b: Bounds) => void) | null = null;

  constructor(private readonly clientId: string) {}

  async mount(el: HTMLElement): Promise<void> {
    await loadNaverSdk(this.clientId);
    if (this.destroyed) return;
    const m = maps();
    const map = new m.Map(el, {
      center: new m.LatLng(37.5, 128.2),
      zoom: 8,
      zoomControl: true,
    });
    this.map = map;
    this.listeners.push(
      m.Event.addListener(map, 'idle', () => {
        this.drawMarkers();
        const b = this.currentBounds();
        if (b) this.boundsCb?.(b);
      }),
    );
    this.drawPolylines();
  }

  setMarkers(markers: MapMarker[]): void {
    this.markers = markers;
    this.cluster = buildClusterIndex(markers);
    this.drawMarkers();
  }

  setPolylines(lines: MapPolyline[]): void {
    this.lines = lines;
    this.drawPolylines();
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

  onBoundsChange(cb: (b: Bounds) => void): void {
    this.boundsCb = cb;
  }

  destroy(): void {
    this.destroyed = true;
    this.markerCb = null;
    this.boundsCb = null;
    this.markers = [];
    this.lines = [];
    this.cluster = buildClusterIndex([]);
    for (const cleanup of this.markerClickCleanups) cleanup();
    this.markerClickCleanups = [];
    const m = (window as unknown as { naver?: { maps?: NaverMaps } }).naver?.maps;
    for (const l of this.listeners) m?.Event.removeListener(l);
    this.listeners = [];
    for (const o of [...this.markerOverlays, ...this.lineOverlays]) o.setMap(null);
    this.markerOverlays = [];
    this.lineOverlays = [];
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
    const add = (lng: number, lat: number, el: HTMLElement, onClick: () => void) => {
      const overlay = new m.Marker({
        map,
        position: new m.LatLng(lat, lng),
        icon: { content: el, anchor: { x: 0, y: 0 } },
      });
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
        add(f.lng, f.lat, createMarkerLabelElement(String(f.count), '#455a64'), () => {
          map.setCenter(new m.LatLng(f.lat, f.lng));
          map.setZoom(this.cluster.expansionZoom(f.id));
        });
      }
    }
    for (const mk of singles) {
      add(mk.lng, mk.lat, createMarkerLabelElement(mk.label ?? '', mk.color, mk), () =>
        this.markerCb?.(mk.id),
      );
    }
  }
}
