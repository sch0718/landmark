import type { Bounds, MapAdapter, MapMarker, MapPolyline } from './MapAdapter';
import { createMarkerLabelElement } from './marker-label';

/** 한국 전체를 덮는 고정 영역(테스트의 "지도 영역 안만 보기"용). */
export const FAKE_BOUNDS: Bounds = { west: 124, south: 33, east: 132, north: 39 };

/** DOM만 쓰는 테스트·E2E용 어댑터. */
export class FakeMapAdapter implements MapAdapter {
  private root: HTMLElement | null = null;
  private markerCb: ((id: string) => void) | null = null;
  private boundsCb: ((b: Bounds) => void) | null = null;
  private markers: MapMarker[] = [];
  private lines: MapPolyline[] = [];

  mount(el: HTMLElement): Promise<void> {
    const root = document.createElement('div');
    root.setAttribute('data-testid', 'fake-map');
    root.style.cssText =
      'position:relative;width:100%;height:100%;background:#e8eef3;overflow:auto';
    el.appendChild(root);
    this.root = root;
    this.render();
    this.boundsCb?.(FAKE_BOUNDS);
    return Promise.resolve();
  }

  setMarkers(markers: MapMarker[]): void {
    this.markers = markers;
    this.render();
  }

  setPolylines(lines: MapPolyline[]): void {
    this.lines = lines;
    this.render();
  }

  /** 테스트용: fitBounds 호출마다 받은 좌표를 기록한다. */
  readonly fitCalls: [number, number][][] = [];

  fitBounds(points: [number, number][]): void {
    this.fitCalls.push(points);
    if (this.root) this.root.dataset.fitCount = String(this.fitCalls.length);
  }

  onMarkerClick(cb: (id: string) => void): void {
    this.markerCb = cb;
  }

  onBoundsChange(cb: (b: Bounds) => void): void {
    this.boundsCb = cb;
    if (this.root) cb(FAKE_BOUNDS);
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    root.replaceChildren();
    for (const m of this.markers) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-testid', `marker-${m.id}`);
      if (m.selected) btn.setAttribute('aria-pressed', 'true');
      if (m.dimmed) btn.dataset.dimmed = 'true';
      btn.appendChild(createMarkerLabelElement(m.label ?? '', m.color, m));
      btn.addEventListener('click', () => this.markerCb?.(m.id));
      root.appendChild(btn);
    }
    for (const l of this.lines) {
      const div = document.createElement('div');
      div.setAttribute('data-testid', `polyline-${l.id}`);
      div.dataset.dashed = String(l.dashed);
      div.dataset.color = l.color;
      div.dataset.points = String(l.path.length);
      root.appendChild(div);
    }
  }
}
