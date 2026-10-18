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
  /** 다녀온 곳이면 글자 앞에 `✓`를 붙인다. */
  visited?: boolean;
  clusterable: boolean;
  /**
   * `false`면 지도 맞추기(`fitKey`)에서 뺀다. 맞출 마커가 하나도 없을 때만 이 마커들로 맞춘다.
   * 예: 계획 화면의 후보·다른 Day 핀은 빼고 고른 Day에만 맞춘다. 없으면 맞추기 대상이다.
   */
  fit?: false;
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

/** 내 위치. `accuracyM`은 정확도 반지름(m). `GeoFix`의 앞 세 필드와 같은 모양이다. */
export type MyLocation = { lng: number; lat: number; accuracyM: number };

/** 내 위치 점·정확도 원의 색(구글 지도의 파란 점). */
export const MY_LOCATION_COLOR = '#1a73e8';
/** 내 위치 점의 쌓임 순서. 장소 마커(0)보다 낮다. 정확도 원은 그보다 한 칸 아래(-2). */
export const MY_LOCATION_Z_INDEX = -1;

export interface MapAdapter {
  mount(el: HTMLElement): Promise<void>;
  setMarkers(markers: MapMarker[]): void;
  setClusterStyle(style: ClusterStyle): void;
  setPolylines(lines: MapPolyline[]): void;
  /** 내 위치 점과 정확도 원을 그린다. `null`이면 지운다. 마운트 전에 불러도 마운트 때 그린다. */
  setMyLocation(fix: MyLocation | null): void;
  resize(width: number, height: number): void;
  getCamera(): MapCamera | null;
  setCamera(camera: MapCamera): void;
  fitBounds(points: [number, number][], padding?: MapPadding): void;
  onMarkerClick(cb: (id: string) => void): void;
  /** 마커·클러스터가 아닌 지도 바탕을 눌렀을 때. 끌기·핀치는 누르기가 아니다. */
  onMapClick(cb: () => void): void;
  onBoundsChange(cb: (b: Bounds) => void): void;
  destroy(): void;
}
