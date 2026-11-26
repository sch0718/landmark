import { describe, expect, it } from 'vitest';
import { dayColor } from 'src/components/map/map-colors';
import { legBetween } from 'src/domain/trips/query';
import { tripMapLayers } from 'src/sections/trips/planner/trip-map-layers';
import type { PlannedLeg } from 'src/sections/trips/planner/use-day-plan';
import {
  GONE,
  HOUSE,
  makeTrip,
  P1,
  P2,
  P3,
  P5,
  plannerLibrary,
  withTrip,
} from './planner-fixtures';

const trip = makeTrip({ origin: HOUSE, stops: [[P1], [P5]], candidates: [P3], lodging: [P2] });
const lib = withTrip(plannerLibrary(), trip);

it('전체 지도는 모든 Day의 장소와 출발지·숙소를 장소당 한 번씩 보여 준다', () => {
  const trip = makeTrip({
    days: 3,
    stops: [[GONE, P1, P5], [P3]],
    origin: HOUSE,
    lodging: [P2, P1, P2],
    candidates: ['place00004'], // 강남 한 곳
  });
  const lib = withTrip(plannerLibrary(), trip);
  const from = lib.places[P1]!;
  const to = lib.places[P5]!;
  const leg: PlannedLeg = {
    ...legBetween(trip, from, to),
    time: { durationS: 360, distanceM: 450, tollFare: null, estimated: true },
    status: 'estimated',
    queriedAt: null,
    path: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
  };
  const { markers, polylines } = tripMapLayers(lib, trip, 0, [leg], P3, null, true, true);
  expect(markers.map(({ id, label, color }) => ({ id, label, color }))).toEqual([
    { id: P1, label: 'D1·1 중앙시장 닭강정', color: dayColor(0) },
    { id: P5, label: 'D1·2 창가 자리', color: dayColor(0) },
    { id: P3, label: 'D2·1 속초 횟집', color: dayColor(1) },
    { id: HOUSE, label: '🏠 바다 숙소', color: dayColor(0) },
    { id: P2, label: '🛏 안목 카페거리', color: dayColor(0) },
  ]);
  expect(markers.every((marker) => marker.fit === undefined && marker.shape === undefined)).toBe(
    true,
  );
  expect(markers.find((marker) => marker.id === P3)?.selected).toBe(true);
  expect(markers.find((marker) => marker.id === P2)?.borderColor).toBe('#000000');
  expect(polylines).toEqual([]);
  expect(tripMapLayers(lib, trip, 0, [leg], P3).polylines).toHaveLength(1);

  const originAsStop = { ...trip, origin: { ...trip.origin, value: P5 } };
  const { markers: overlapping } = tripMapLayers(lib, originAsStop, 0, [], null, null, true, true);
  expect(overlapping.filter((marker) => marker.id === P5)).toEqual([
    expect.objectContaining({ label: 'D1·2 창가 자리' }),
  ]);
  expect(overlapping.some((marker) => marker.label?.startsWith('🏠'))).toBe(false);
});

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
