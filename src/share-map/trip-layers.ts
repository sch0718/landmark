import type { MapMarker, MapPolyline } from 'src/components/map/MapAdapter';
import { dayColor, NO_CATEGORY_COLOR } from 'src/components/map/map-colors';
import type { MapLine, MapPin } from 'src/share-protocol';

/**
 * 일정 지도(`draw`)의 마커·경로선(spec §4.6, §6.1). 앱 계획 화면의 `trip-map-layers.ts`와 같은 값이다:
 * Day 색 바탕(`day`가 null이면 회색)에 흰 글자, 출발점·숙소(`endpoint`)는 검정 테두리, 다른 Day의 점(`dim`)은
 * 이름 없는 흐린 점. 핀은 묶지 않는다. 앱 쪽 파일은 React·Effect를 끌고 와서 지도 페이지가 import하지
 * 못하므로 작은 규칙만 여기에 따로 둔다.
 * 지도 맞추기는 `fit: false`가 아닌 핀만 쓴다(흐린 점·Day 없는 핀은 뺀다. 맞출 핀이 없으면 어댑터가 전부에 맞춘다).
 */

const ENDPOINT_BORDER = '#000000';
const MARKER_TEXT = '#ffffff';

export function drawLayers(
  pins: MapPin[],
  lines: MapLine[],
  selectedId: string | null,
): { markers: MapMarker[]; polylines: MapPolyline[] } {
  const markers = pins.map((pin): MapMarker => {
    const dim = pin.role === 'dim';
    return {
      id: pin.id,
      lng: pin.lng,
      lat: pin.lat,
      label: dim ? '' : pin.label,
      color: pin.day === null ? NO_CATEGORY_COLOR : dayColor(pin.day),
      textColor: MARKER_TEXT,
      ...(pin.role === 'endpoint' ? { borderColor: ENDPOINT_BORDER } : {}),
      ...(dim ? { dimmed: true } : {}),
      selected: pin.id === selectedId,
      clusterable: false,
      ...(dim || pin.day === null ? { fit: false as const } : {}),
    };
  });
  const polylines = lines.map((line): MapPolyline => ({
    id: line.id,
    path: line.path,
    color: dayColor(line.day),
    dashed: line.walk,
  }));
  return { markers, polylines };
}
