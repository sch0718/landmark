import { buildClusterIndex, clusterFeatures, type ClusterIndex } from './cluster';
import { loadGoogleSdk } from './load-google-sdk';
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
import { MAP_CLICK_DELAY_MS } from './NaverMapAdapter';

/** 사용하는 Maps JavaScript API만 좁게 선언한다. */
type LatLng = { lat(): number; lng(): number };
type Overlay = { setMap(map: GoogleMap | null): void };
type GoogleMap = {
  getCenter(): LatLng | undefined;
  getZoom(): number | undefined;
  getBounds(): { getSouthWest(): LatLng; getNorthEast(): LatLng } | undefined;
  moveCamera(camera: { center: { lat: number; lng: number }; zoom: number }): void;
};
type MarkerLayer = Overlay & {
  onAdd(): void;
  draw(): void;
  onRemove(): void;
  getPanes(): { overlayMouseTarget: HTMLElement } | null;
  getProjection(): { fromLatLngToDivPixel(point: unknown): { x: number; y: number } | null };
};
type GoogleMaps = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GoogleMap;
  LatLng: new (lat: number, lng: number) => unknown;
  OverlayView: { new (): MarkerLayer; preventMapHitsAndGesturesFrom(el: HTMLElement): void };
  Polyline: new (opts: Record<string, unknown>) => Overlay;
  Circle: new (opts: Record<string, unknown>) => Overlay;
  event: {
    addListener(target: unknown, name: string, cb: (event?: unknown) => void): { remove(): void };
    clearInstanceListeners(target: unknown): void;
  };
};
const maps = (): GoogleMaps => (window as unknown as { google: { maps: GoogleMaps } }).google.maps;
const DEFAULT_PADDING: MapPadding = { top: 40, right: 40, bottom: 40, left: 40 };
const SELECTED_Z_INDEX = 1000;

function mercatorY(lat: number): number {
  const sin = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}
function latitude(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/** 256px 세계 좌표와 여백으로 계산해 애니메이션 없이 바로 적용할 카메라를 돌려준다. */
export function fitCamera(
  points: [number, number][],
  size: { width: number; height: number },
  padding: MapPadding = DEFAULT_PADDING,
): MapCamera | null {
  if (points.length === 0 || size.width <= 0 || size.height <= 0) return null;
  // 날짜 변경선을 가로지르는 경우도 가장 짧은 경도 구간으로 맞춘다.
  const xs = points.map(([lng]) => ((((lng + 180) / 360) % 1) + 1) % 1).sort((a, b) => a - b);
  let gap = -1;
  let start = xs[0]!;
  for (let i = 0; i < xs.length; i++) {
    const next = xs[(i + 1) % xs.length]! + (i === xs.length - 1 ? 1 : 0);
    if (next - xs[i]! > gap) {
      gap = next - xs[i]!;
      start = next % 1;
    }
  }
  const spanX = 1 - gap;
  const ys = points.map(([, lat]) => mercatorY(lat));
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const width = Math.max(1, size.width - padding.left - padding.right);
  const height = Math.max(1, size.height - padding.top - padding.bottom);
  const zoom = Math.max(
    0,
    Math.min(
      21,
      Math.floor(
        Math.min(Math.log2(width / (256 * spanX)), Math.log2(height / (256 * (maxY - minY)))),
      ),
    ),
  );
  const scale = 256 * 2 ** zoom;
  const x = start + spanX / 2 + (padding.right - padding.left) / (2 * scale);
  const y = (minY + maxY) / 2 + (padding.bottom - padding.top) / (2 * scale);
  return { center: [(((x % 1) + 1) % 1) * 360 - 180, latitude(y)], zoom };
}

type PositionedElement = { lng: number; lat: number; el: HTMLElement };

export class GoogleMapAdapter implements MapAdapter {
  private map: GoogleMap | null = null;
  private host: HTMLElement | null = null;
  private layer: MarkerLayer | null = null;
  private container: HTMLElement | null = null;
  private elements: PositionedElement[] = [];
  private markers: MapMarker[] = [];
  private selectedMarker: MapMarker | null = null;
  private cluster: ClusterIndex = buildClusterIndex([]);
  private clusterStyle: ClusterStyle = DEFAULT_CLUSTER_STYLE;
  private lines: MapPolyline[] = [];
  private lineOverlays: Overlay[] = [];
  private myLocation: MyLocation | null = null;
  private locationCircle: Overlay | null = null;
  private destroyed = false;
  private listeners: { remove(): void }[] = [];
  private markerClickCleanups: (() => void)[] = [];
  private markerCb: ((id: string) => void) | null = null;
  private boundsCb: ((b: Bounds) => void) | null = null;
  private mapClickCb: (() => void) | null = null;
  private markerClickSeq = 0;
  private recentMarkerClick = false;
  private recentMarkerTimer: ReturnType<typeof setTimeout> | null = null;
  private mapClickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly options: { zoomControl?: boolean } = {},
  ) {}

  async mount(el: HTMLElement): Promise<void> {
    await loadGoogleSdk(this.apiKey);
    if (this.destroyed) return;
    const m = maps();
    this.host = el;
    const map = new m.Map(el, {
      center: { lat: 37.5, lng: 128.2 },
      zoom: 8,
      disableDefaultUI: true,
      zoomControl: this.options.zoomControl ?? true,
      clickableIcons: false,
      gestureHandling: 'greedy',
    });
    this.map = map;
    const addContainer = (layer: MarkerLayer) => {
      this.container = document.createElement('div');
      this.container.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
      layer.getPanes()?.overlayMouseTarget.append(this.container);
      this.drawMarkers();
    };
    const draw = () => this.positionElements();
    const removeContainer = () => {
      this.clearElements();
      this.container?.remove();
      this.container = null;
    };
    this.layer = new (class extends m.OverlayView {
      onAdd(): void {
        addContainer(this);
      }
      draw(): void {
        draw();
      }
      onRemove(): void {
        removeContainer();
      }
    })();
    this.layer.setMap(map);
    this.listeners.push(
      m.event.addListener(map, 'idle', () => {
        this.drawMarkers();
        const bounds = this.currentBounds();
        if (bounds) this.boundsCb?.(bounds);
      }),
      m.event.addListener(map, 'click', (event) => this.handleMapClick(event)),
      m.event.addListener(map, 'dblclick', () => this.cancelMapClick()),
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

  private drawMyLocation(): void {
    this.locationCircle?.setMap(null);
    this.locationCircle = null;
    if (this.map && this.myLocation) {
      const fix = this.myLocation;
      this.locationCircle = new (maps().Circle)({
        map: this.map,
        center: { lat: fix.lat, lng: fix.lng },
        radius: fix.accuracyM,
        fillColor: MY_LOCATION_COLOR,
        fillOpacity: 0.12,
        strokeColor: MY_LOCATION_COLOR,
        strokeOpacity: 0.35,
        strokeWeight: 1,
        clickable: false,
        zIndex: MY_LOCATION_Z_INDEX - 1,
      });
    }
    this.drawMarkers();
  }
  private drawPolylines(): void {
    for (const overlay of this.lineOverlays) overlay.setMap(null);
    this.lineOverlays = [];
    if (!this.map) return;
    this.lineOverlays = this.lines.map(
      (line) =>
        new (maps().Polyline)({
          map: this.map,
          path: line.path.map(([lng, lat]) => ({ lat, lng })),
          strokeColor: line.color,
          strokeWeight: 4,
          strokeOpacity: line.dashed ? 0 : 0.85,
          clickable: false,
          ...(line.dashed
            ? {
                icons: [
                  {
                    icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.85, scale: 2 },
                    offset: '0',
                    repeat: '12px',
                  },
                ],
              }
            : {}),
        }),
    );
  }
  resize(width: number, height: number): void {
    if (!this.map || width <= 0 || height <= 0) return;
    const camera = this.getCamera();
    if (camera) this.setCamera(camera);
    this.drawMarkers();
    const bounds = this.currentBounds();
    if (bounds) this.boundsCb?.(bounds);
  }
  getCamera(): MapCamera | null {
    const center = this.map?.getCenter();
    const zoom = this.map?.getZoom();
    return center && zoom !== undefined ? { center: [center.lng(), center.lat()], zoom } : null;
  }
  setCamera(camera: MapCamera): void {
    this.map?.moveCamera({
      center: { lat: camera.center[1], lng: camera.center[0] },
      zoom: camera.zoom,
    });
  }
  fitBounds(points: [number, number][], padding?: MapPadding): void {
    if (!this.map || !this.host) return;
    const camera = fitCamera(
      points,
      { width: this.host.clientWidth, height: this.host.clientHeight },
      padding,
    );
    if (camera) this.setCamera(camera);
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
    this.cancelMapClick();
    if (this.recentMarkerTimer) clearTimeout(this.recentMarkerTimer);
    this.recentMarkerTimer = null;
    this.recentMarkerClick = false;
    this.markerCb = null;
    this.mapClickCb = null;
    this.boundsCb = null;
    for (const listener of this.listeners) listener.remove();
    this.listeners = [];
    this.layer?.setMap(null);
    this.layer = null;
    for (const overlay of this.lineOverlays) overlay.setMap(null);
    this.lineOverlays = [];
    this.locationCircle?.setMap(null);
    this.locationCircle = null;
    if (this.map) maps().event.clearInstanceListeners(this.map);
    this.map = null;
    this.host?.replaceChildren();
    this.host = null;
    this.markers = [];
    this.selectedMarker = null;
    this.lines = [];
    this.myLocation = null;
    this.cluster = buildClusterIndex([]);
  }
  private cancelMapClick(): void {
    if (this.mapClickTimer) clearTimeout(this.mapClickTimer);
    this.mapClickTimer = null;
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
  private handleMapClick(event: unknown): void {
    const target = (event as { domEvent?: { target?: unknown } } | undefined)?.domEvent?.target;
    if (
      this.recentMarkerClick ||
      (target instanceof Element && target.closest('[data-map-marker]'))
    )
      return;
    const seq = this.markerClickSeq;
    this.cancelMapClick();
    this.mapClickTimer = setTimeout(() => {
      this.mapClickTimer = null;
      if (seq === this.markerClickSeq) this.mapClickCb?.();
    }, MAP_CLICK_DELAY_MS);
  }
  private currentBounds(): Bounds | null {
    const bounds = this.map?.getBounds();
    if (!bounds) return null;
    const sw = bounds.getSouthWest(),
      ne = bounds.getNorthEast();
    return { west: sw.lng(), south: sw.lat(), east: ne.lng(), north: ne.lat() };
  }
  private clearElements(): void {
    for (const cleanup of this.markerClickCleanups) cleanup();
    this.markerClickCleanups = [];
    this.container?.replaceChildren();
    this.elements = [];
  }
  private positionElements(): void {
    if (!this.layer || !this.container) return;
    const projection = this.layer.getProjection();
    for (const { lng, lat, el } of this.elements) {
      const point = projection.fromLatLngToDivPixel(new (maps().LatLng)(lat, lng));
      if (point) {
        el.style.left = `${point.x}px`;
        el.style.top = `${point.y}px`;
      }
    }
  }
  private drawMarkers(): void {
    this.clearElements();
    const map = this.map;
    if (!map || !this.container) return;
    const addElement = (lng: number, lat: number, el: HTMLElement, zIndex: number) => {
      el.style.position = 'absolute';
      el.style.zIndex = String(zIndex);
      this.container!.append(el);
      this.elements.push({ lng, lat, el });
    };
    const add = (lng: number, lat: number, el: HTMLElement, onClick: () => void, zIndex = 0) => {
      el.setAttribute('data-map-marker', '');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'auto';
      maps().OverlayView.preventMapHitsAndGesturesFrom(el);
      const handleClick = () => {
        this.noteMarkerClick();
        onClick();
      };
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
      addElement(lng, lat, el, zIndex);
    };
    const bounds = this.currentBounds();
    const byId = new Map(this.markers.map((marker) => [marker.id, marker]));
    const singles = [...this.cluster.fixed];
    if (bounds)
      for (const feature of clusterFeatures(this.cluster, bounds, map.getZoom() ?? 0)) {
        if (feature.kind === 'point') {
          const marker = byId.get(feature.markerId);
          if (marker) singles.push(marker);
        } else {
          const { color, textColor } = this.clusterStyle;
          add(
            feature.lng,
            feature.lat,
            createMarkerLabelElement(String(feature.count), color, { textColor }),
            () => {
              this.setCamera({
                center: [feature.lng, feature.lat],
                zoom: this.cluster.expansionZoom(feature.id),
              });
            },
          );
        }
      }
    const selected = this.selectedMarker;
    const shown =
      selected === null
        ? singles
        : [...singles.filter((marker) => marker.id !== selected.id), selected];
    for (const marker of shown)
      add(
        marker.lng,
        marker.lat,
        createMarkerLabelElement(marker.label ?? '', marker.color, marker),
        () => this.markerCb?.(marker.id),
        marker.selected ? SELECTED_Z_INDEX : marker.shape === 'dot' ? -1 : 0,
      );
    if (this.myLocation) {
      const el = document.createElement('div');
      el.setAttribute('data-my-location', '');
      el.style.cssText = `box-sizing:border-box;width:18px;height:18px;border-radius:50%;background:${MY_LOCATION_COLOR};border:3px solid #fff;box-shadow:0 0 3px rgba(0,0,0,.4);pointer-events:none;transform:translate(-50%, -50%)`;
      addElement(this.myLocation.lng, this.myLocation.lat, el, MY_LOCATION_Z_INDEX);
    }
    this.positionElements();
  }
}
