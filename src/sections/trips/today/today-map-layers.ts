import type { MapMarker, MapPolyline } from 'src/components/map/MapAdapter';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { tripMapLayers } from 'src/sections/trips/planner/trip-map-layers';
import type { PlannedLeg } from 'src/sections/trips/planner/use-day-plan';

/**
 * 당일 모드 지도의 마커·경로선(스펙 §5.4). 계획 화면의 레이어에서 그날 것(`fit !== false`: 그날 Stop·출발점·숙소)만
 * 남긴다. 후보 핀·다른 Day 점은 뺀다. 다녀온 Stop(`visited`, 장소 id)의 핀은 흐리게 한다(번호·이름은 그대로).
 * 출발점·숙소 핀은 id 머리(`start:`·`end:`)가 달라 같은 장소가 다녀온 Stop이어도 흐리지 않는다.
 */
export function todayMapLayers(
  lib: Library,
  trip: Trip,
  dayIndex: number,
  legs: PlannedLeg[],
  opts: { visited: ReadonlySet<string>; selectedPlaceId: string | null },
): { markers: MapMarker[]; polylines: MapPolyline[] } {
  const { markers, polylines } = tripMapLayers(lib, trip, dayIndex, legs, opts.selectedPlaceId);
  return {
    markers: markers
      .filter((marker) => marker.fit !== false)
      .map((marker) => (opts.visited.has(marker.id) ? { ...marker, dimmed: true } : marker)),
    polylines,
  };
}
