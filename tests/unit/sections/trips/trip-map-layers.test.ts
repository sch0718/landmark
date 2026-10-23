import { describe, expect, it } from 'vitest';
import { dayColor } from 'src/components/map/map-colors';
import { tripMapLayers } from 'src/sections/trips/planner/trip-map-layers';
import { HOUSE, makeTrip, P1, P2, P3, P5, plannerLibrary, withTrip } from './planner-fixtures';

const trip = makeTrip({ origin: HOUSE, stops: [[P1], [P5]], candidates: [P3], lodging: [P2] });
const lib = withTrip(plannerLibrary(), trip);

describe('다른 Day 장소 레이어', () => {
  it('다른 Day만 설명을 가진 흐린 점이고 나머지는 이름표다', () => {
    const { markers } = tripMapLayers(lib, trip, 0, [], P5);
    expect(markers.find((m) => m.id === P5)).toMatchObject({
      shape: 'dot',
      label: 'Day 2 · 창가 자리',
      color: dayColor(1),
      dimmed: true,
      selected: true,
      fit: false,
      clusterable: false,
    });
    expect(markers.filter((m) => m.id !== P5).every((m) => m.shape === undefined)).toBe(true);
    expect(markers.filter((m) => m.id !== P5).map((m) => m.label)).toEqual([
      '1 중앙시장 닭강정',
      '🏠 바다 숙소',
      '🛏 안목 카페거리',
      '속초 횟집',
    ]);
  });

  it('끄면 선택된 다른 Day 장소도 빠지고 나머지 마커는 그대로다', () => {
    const shown = tripMapLayers(lib, trip, 0, [], P5);
    const hidden = tripMapLayers(lib, trip, 0, [], P5, null, false);
    expect(hidden.markers).toEqual(shown.markers.filter((m) => m.id !== P5));
    expect(hidden.polylines).toEqual(shown.polylines);
  });
});
