export type Bounds = { west: number; south: number; east: number; north: number };

export type MapCamera = { center: [number, number]; zoom: number };
export type MapPadding = { top: number; right: number; bottom: number; left: number };

export type MapMarker = {
  id: string;
  lng: number;
  lat: number;
  label?: string;
  color: string;
  dimmed?: boolean;
  selected?: boolean;
  clusterable: boolean;
};

export type MapPolyline = {
  id: string;
  path: [number, number][];
  color: string;
  dashed: boolean;
};

export interface MapAdapter {
  mount(el: HTMLElement): Promise<void>;
  setMarkers(markers: MapMarker[]): void;
  setPolylines(lines: MapPolyline[]): void;
  resize(width: number, height: number): void;
  getCamera(): MapCamera | null;
  setCamera(camera: MapCamera): void;
  fitBounds(points: [number, number][], padding?: MapPadding): void;
  onMarkerClick(cb: (id: string) => void): void;
  onBoundsChange(cb: (b: Bounds) => void): void;
  destroy(): void;
}
