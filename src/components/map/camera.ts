import type { MapCamera, MapMarker, MapPadding } from './MapAdapter';

/**
 * 지도 카메라 계산(순수 함수). 앱의 `MapView`(React)와 공유 지도 페이지(`src/share-map`)가 함께 쓴다.
 * 지도 페이지에 React가 번들되지 않도록 React 없이 둔다.
 */

const FOCUS_PAD = 0.005;
/** 장소로 이동(focus)할 때의 줌. 15부터는 클러스터 없이 모든 장소가 이름으로 보인다(cluster.ts maxZoom 14). */
export const FOCUS_ZOOM = 16;

/**
 * 장소로 이동할 카메라. 줌은 화면 폭과 상관없이 `FOCUS_ZOOM`이고, 중심은 장소가 `padding`을 뺀 영역의
 * 가운데에 오도록 옮긴다(예: 상세 패널이 지도 오른쪽을 덮을 때). 웹 메르카토르 256px 타일 기준이다.
 */
export function focusCamera(point: [number, number], padding: MapPadding): MapCamera {
  const [lng, lat] = point;
  const degPerPx = 360 / (256 * 2 ** FOCUS_ZOOM);
  const dx = (padding.right - padding.left) / 2;
  const dy = (padding.bottom - padding.top) / 2;
  return {
    center: [lng + dx * degPerPx, lat - dy * degPerPx * Math.cos((lat * Math.PI) / 180)],
    zoom: FOCUS_ZOOM,
  };
}

/** 흐린(후보) 마커를 뺀 마커 좌표. 모두 흐리면 전부. 점이 하나뿐이면 그 근처(약 1km)로 넓힌다. */
export function fitPoints(markers: MapMarker[]): [number, number][] {
  const strong = markers.filter((m) => !m.dimmed);
  const pts = (strong.length > 0 ? strong : markers).map((m): [number, number] => [m.lng, m.lat]);
  const unique = new Set(pts.map(([lng, lat]) => `${lng},${lat}`));
  if (unique.size !== 1) return pts;
  const [lng, lat] = pts[0]!;
  return [
    [lng - FOCUS_PAD, lat - FOCUS_PAD],
    [lng + FOCUS_PAD, lat + FOCUS_PAD],
  ];
}
