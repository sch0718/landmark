import type {
  Bounds,
  ClusterStyle,
  MapAdapter,
  MapCamera,
  MapMarker,
  MapPadding,
  MapPolyline,
  MyLocation,
} from './MapAdapter';
import { createMarkerLabelElement } from './marker-label';

/** 한국 전체를 덮는 고정 영역(테스트의 "지도 영역 안만 보기"용). */
export const FAKE_BOUNDS: Bounds = { west: 124, south: 33, east: 132, north: 39 };

let nextInstanceId = 0;

/** DOM만 쓰는 테스트·E2E용 어댑터. */
export class FakeMapAdapter implements MapAdapter {
  private root: HTMLElement | null = null;
  private markerRoot: HTMLElement | null = null;
  private lineRoot: HTMLElement | null = null;
  private myLocation: MyLocation | null = null;
  private markerCb: ((id: string) => void) | null = null;
  private boundsCb: ((b: Bounds) => void) | null = null;
  private markers: MapMarker[] = [];
  private lines: MapPolyline[] = [];
  private markerNodes = new Map<
    string,
    { button: HTMLButtonElement; label: string; cleanup: () => void }
  >();
  private camera: MapCamera = { center: [128, 37.5], zoom: 8 };
  readonly resizeCalls: [number, number][] = [];
  /** 테스트용: `setMyLocation` 호출마다 받은 값을 기록한다. */
  readonly myLocationCalls: (MyLocation | null)[] = [];

  mount(el: HTMLElement): Promise<void> {
    const root = document.createElement('div');
    root.setAttribute('data-testid', 'fake-map');
    root.dataset.instanceId = String(++nextInstanceId);
    root.style.cssText =
      'position:relative;width:100%;height:100%;background:#e8eef3;overflow:auto';
    el.appendChild(root);
    this.root = root;
    this.markerRoot = document.createElement('div');
    this.lineRoot = document.createElement('div');
    root.append(this.markerRoot, this.lineRoot);
    this.renderMarkers();
    this.renderLines();
    this.renderMyLocation();
    this.boundsCb?.(FAKE_BOUNDS);
    return Promise.resolve();
  }

  setMarkers(markers: MapMarker[]): void {
    this.markers = markers;
    this.renderMarkers();
  }

  /** 이 어댑터는 클러스터를 그리지 않아 받은 값을 기록만 한다. */
  clusterStyle: ClusterStyle | null = null;

  setClusterStyle(style: ClusterStyle): void {
    this.clusterStyle = style;
  }

  setPolylines(lines: MapPolyline[]): void {
    this.lines = lines;
    this.renderLines();
  }

  setMyLocation(fix: MyLocation | null): void {
    this.myLocationCalls.push(fix);
    this.myLocation = fix;
    this.renderMyLocation();
  }

  /** 테스트용: fitBounds 호출마다 받은 좌표를 기록한다. */
  readonly fitCalls: [number, number][][] = [];

  resize(width: number, height: number): void {
    if (!this.root || width <= 0 || height <= 0) return;
    this.resizeCalls.push([width, height]);
    this.root.dataset.width = String(width);
    this.root.dataset.height = String(height);
  }

  getCamera(): MapCamera | null {
    return this.root ? { center: [...this.camera.center], zoom: this.camera.zoom } : null;
  }

  setCamera(camera: MapCamera): void {
    if (!this.root) return;
    this.camera = { center: [...camera.center], zoom: camera.zoom };
    this.root.dataset.center = camera.center.join(',');
    this.root.dataset.zoom = String(camera.zoom);
    // 네이버 지도는 카메라가 바뀌면 `idle`로 영역을 알린다. 테스트에서 지도를 끄는 것도 이 경로다.
    this.boundsCb?.(FAKE_BOUNDS);
  }

  fitBounds(points: [number, number][], padding?: MapPadding): void {
    this.fitCalls.push(points);
    if (this.root) {
      this.root.dataset.fitCount = String(this.fitCalls.length);
      if (padding) this.root.dataset.padding = JSON.stringify(padding);
    }
  }

  onMarkerClick(cb: (id: string) => void): void {
    this.markerCb = cb;
  }

  onBoundsChange(cb: (b: Bounds) => void): void {
    this.boundsCb = cb;
    if (this.root) cb(FAKE_BOUNDS);
  }

  destroy(): void {
    for (const entry of this.markerNodes.values()) entry.cleanup();
    this.markerNodes.clear();
    this.markerCb = null;
    this.boundsCb = null;
    this.markers = [];
    this.lines = [];
    this.myLocation = null;
    this.root?.remove();
    this.root = null;
    this.markerRoot = null;
    this.lineRoot = null;
  }

  private renderMarkers(): void {
    const root = this.markerRoot;
    if (!root) return;
    const wanted = new Set(this.markers.map((marker) => marker.id));
    for (const [id, entry] of this.markerNodes) {
      if (!wanted.has(id)) {
        entry.cleanup();
        entry.button.remove();
        this.markerNodes.delete(id);
      }
    }
    this.markers.forEach((marker, index) => {
      let entry = this.markerNodes.get(marker.id);
      if (!entry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-testid', `marker-${marker.id}`);
        const click = () => this.markerCb?.(marker.id);
        button.addEventListener('click', click);
        entry = { button, label: '', cleanup: () => button.removeEventListener('click', click) };
        this.markerNodes.set(marker.id, entry);
      }
      const { button } = entry;
      const label = JSON.stringify([
        marker.label ?? '',
        marker.color,
        marker.textColor,
        marker.borderColor,
        marker.selected,
        marker.visited,
        marker.dimmed,
        marker.clusterable,
      ]);
      if (entry.label !== label) {
        entry.label = label;
        if (marker.selected) button.setAttribute('aria-pressed', 'true');
        else button.removeAttribute('aria-pressed');
        if (marker.dimmed) button.dataset.dimmed = 'true';
        else delete button.dataset.dimmed;
        button.replaceChildren(createMarkerLabelElement(marker.label ?? '', marker.color, marker));
      }
      if (root.children[index] !== button) {
        root.insertBefore(button, root.children[index] ?? null);
      }
    });
  }

  private renderMyLocation(): void {
    const root = this.root;
    if (!root) return;
    const fix = this.myLocation;
    let el = root.querySelector<HTMLElement>(':scope > [data-testid="my-location"]');
    if (!fix) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-testid', 'my-location');
      root.appendChild(el);
    }
    el.dataset.lng = String(fix.lng);
    el.dataset.lat = String(fix.lat);
    el.dataset.accuracy = String(fix.accuracyM);
  }

  private renderLines(): void {
    const root = this.lineRoot;
    if (!root) return;
    const fragment = document.createDocumentFragment();
    for (const line of this.lines) {
      const div = document.createElement('div');
      div.setAttribute('data-testid', `polyline-${line.id}`);
      div.dataset.dashed = String(line.dashed);
      div.dataset.color = line.color;
      div.dataset.points = String(line.path.length);
      fragment.appendChild(div);
    }
    root.replaceChildren(fragment);
  }
}
