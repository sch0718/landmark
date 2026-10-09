export type Bounds = { west: number; south: number; east: number; north: number };

export type MapCamera = { center: [number, number]; zoom: number };
export type MapPadding = { top: number; right: number; bottom: number; left: number };

export type MapMarker = {
  id: string;
  lng: number;
  lat: number;
  label?: string;
  /** 마커 바탕색. */
  color: string;
  /** 이름 글자색. 기본은 흰색. */
  textColor?: string;
  /** 테두리색. 기본은 흰색(선택되면 검정). */
  borderColor?: string;
  dimmed?: boolean;
  selected?: boolean;
  clusterable: boolean;
};

/** 클러스터(묶음) 마커의 바탕색과 글자색. */
export type ClusterStyle = { color: string; textColor: string };

export const DEFAULT_CLUSTER_STYLE: ClusterStyle = { color: '#455a64', textColor: '#fff' };

export type MapPolyline = {
  id: string;
  path: [number, number][];
  color: string;
  dashed: boolean;
};

export interface MapAdapter {
  mount(el: HTMLElement): Promise<void>;
  setMarkers(markers: MapMarker[]): void;
  setClusterStyle(style: ClusterStyle): void;
  setPolylines(lines: MapPolyline[]): void;
  resize(width: number, height: number): void;
  getCamera(): MapCamera | null;
  setCamera(camera: MapCamera): void;
  fitBounds(points: [number, number][], padding?: MapPadding): void;
  onMarkerClick(cb: (id: string) => void): void;
  onBoundsChange(cb: (b: Bounds) => void): void;
  destroy(): void;
}
