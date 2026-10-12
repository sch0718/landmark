import type { MapMarker, MapPolyline } from 'src/components/map/MapAdapter';
import { dayColor, NO_CATEGORY_COLOR } from 'src/components/map/map-colors';
import { dayEndpoints, visibleCandidates, visibleStops } from 'src/domain/trips/query';
import type { Library, Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { isSamePointLeg, type PlannedLeg } from 'src/sections/trips/planner/use-day-plan';

/** 출발점·숙소 마커 id의 머리. 같은 장소가 Day의 Stop이기도 하면 마커가 따로 있어야 해서 구분한다. */
const START_PREFIX = 'start:';
const END_PREFIX = 'end:';
const ENDPOINT_BORDER = '#000000';
const MARKER_TEXT = '#ffffff';

/** 마커 id → 장소 id. */
export function placeIdOfMarker(markerId: string): string {
  if (markerId.startsWith(START_PREFIX)) return markerId.slice(START_PREFIX.length);
  if (markerId.startsWith(END_PREFIX)) return markerId.slice(END_PREFIX.length);
  return markerId;
}

const point = (place: Place) => ({ lng: place.lng, lat: place.lat });

/**
 * 계획 화면 지도의 마커·경로선(스펙 §2.3). 핀은 묶지 않는다(`clusterable: false`).
 * - 고른 Day의 Stop: `"<번호> <이름>"`, Day 색
 * - 출발점·숙소: `"🏠 <이름>"`(여행 출발지) / `"🛏 <이름>"`(숙소), Day 색에 검정 테두리
 * - 후보: 이름, 회색
 * - 다른 Day의 Stop: 그 Day 색의 흐린 작은 점(이름 없음)
 * - 경로선: 고른 Day의 구간마다 하나(같은 지점 구간은 없음), 도보는 점선. 경로가 없으면 두 점 직선이다.
 */
export function tripMapLayers(
  lib: Library,
  trip: Trip,
  dayIndex: number,
  legs: PlannedLeg[],
  selectedPlaceId: string | null,
): { markers: MapMarker[]; polylines: MapPolyline[] } {
  const color = dayColor(dayIndex);
  const markers: MapMarker[] = [];
  const used = new Set<string>();
  const push = (marker: MapMarker) => {
    if (used.has(marker.id)) return; // 문서가 어긋나 같은 장소가 두 번 나와도 마커 id는 하나만
    used.add(marker.id);
    markers.push(marker);
  };
  const selected = (placeId: string) => placeId === selectedPlaceId;

  const day = trip.days[dayIndex];
  if (day !== undefined) {
    visibleStops(lib, day).forEach((stop, i) => {
      const place = lib.places[stop.placeId]!;
      push({
        id: place.id,
        ...point(place),
        label: `${i + 1} ${place.name.value}`,
        color,
        textColor: MARKER_TEXT,
        selected: selected(place.id),
        clusterable: false,
      });
    });
    const { start, end } = dayEndpoints(lib, trip, dayIndex);
    const endpoint = (prefix: string, place: Place, icon: string) =>
      push({
        id: `${prefix}${place.id}`,
        ...point(place),
        label: `${icon} ${place.name.value}`,
        color,
        textColor: MARKER_TEXT,
        borderColor: ENDPOINT_BORDER,
        selected: selected(place.id),
        clusterable: false,
      });
    // 1일차 출발점은 여행 출발지(집), 그 뒤는 전날 숙소(침대). 출발점과 숙소가 같으면 하나만 둔다.
    if (start !== null) endpoint(START_PREFIX, start, dayIndex === 0 ? '🏠' : '🛏');
    if (end !== null && end.id !== start?.id) endpoint(END_PREFIX, end, '🛏');
  }

  for (const place of visibleCandidates(lib, trip)) {
    push({
      id: place.id,
      ...point(place),
      label: place.name.value,
      color: NO_CATEGORY_COLOR,
      textColor: MARKER_TEXT,
      selected: selected(place.id),
      clusterable: false,
    });
  }

  trip.days.forEach((other, d) => {
    if (d === dayIndex) return;
    for (const stop of visibleStops(lib, other)) {
      const place = lib.places[stop.placeId]!;
      push({
        id: place.id,
        ...point(place),
        label: '',
        color: dayColor(d),
        dimmed: true,
        selected: selected(place.id),
        clusterable: false,
      });
    }
  });

  const polylines: MapPolyline[] = legs
    .filter((leg) => !isSamePointLeg(leg))
    .map((leg) => ({ id: leg.key, path: leg.path, color, dashed: leg.mode === 'walk' }));

  return { markers, polylines };
}
