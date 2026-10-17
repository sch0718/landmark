import { describe, expect, it } from 'vitest';
import { dayLegs } from 'src/domain/trips/query';
import { todayMapLayers } from 'src/sections/trips/today/today-map-layers';
import type { PlannedLeg } from 'src/sections/trips/planner/use-day-plan';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { HOUSE, makeTrip, P1, P2, P3, P5, plannerLibrary, withTrip } from './planner-fixtures';

/** 경로 결과 없이 직선 두 점으로 둔 구간. */
const plannedLegs = (lib: Library, trip: Trip, dayIndex: number): PlannedLeg[] =>
  dayLegs(lib, trip, dayIndex).map((leg) => ({
    ...leg,
    time: { durationS: 600, distanceM: 1000, tollFare: null, estimated: true },
    status: 'estimated',
    queriedAt: null,
    path: [
      [leg.from.lng, leg.from.lat],
      [leg.to.lng, leg.to.lat],
    ],
  }));

describe('todayMapLayers', () => {
  // Day 1: 출발지(바다 숙소) → 닭강정 → 카페거리, Day 2: 창가 자리, 후보: 속초 횟집.
  const trip = makeTrip({
    start: '2026-10-24',
    days: 2,
    origin: HOUSE,
    stops: [[P1, P2], [P5]],
    candidates: [P3],
  });
  const lib = withTrip(plannerLibrary(), trip);
  const legs = plannedLegs(lib, trip, 0);

  it('그날 Stop·출발점만 남고 후보·다른 Day 점은 없다', () => {
    const { markers, polylines } = todayMapLayers(lib, trip, 0, legs, {
      visited: new Set(),
      selectedPlaceId: null,
    });
    expect(markers.map((m) => m.id)).toEqual([P1, P2, `start:${HOUSE}`]);
    expect(markers.every((m) => m.fit !== false)).toBe(true);
    expect(polylines.map((p) => p.id)).toEqual(legs.map((l) => l.key));
  });

  it('다녀온 Stop은 흐리게(번호·이름은 그대로), 출발점·숙소는 같은 장소여도 흐리지 않는다', () => {
    const withLodging = makeTrip({
      start: '2026-10-24',
      days: 2,
      origin: HOUSE,
      stops: [[P1, HOUSE, P2], [P5]],
      lodging: [HOUSE],
    });
    const lib2 = withTrip(plannerLibrary(), withLodging);
    const { markers } = todayMapLayers(lib2, withLodging, 0, plannedLegs(lib2, withLodging, 0), {
      visited: new Set([P1, HOUSE]),
      selectedPlaceId: null,
    });
    const byId = new Map(markers.map((m) => [m.id, m]));
    expect(byId.get(P1)).toMatchObject({ dimmed: true, label: '1 중앙시장 닭강정' });
    expect(byId.get(HOUSE)).toMatchObject({ dimmed: true, label: '2 바다 숙소' });
    expect(byId.get(P2)?.dimmed).toBeUndefined();
    expect(byId.get(`start:${HOUSE}`)?.dimmed).toBeUndefined();
    // 출발점과 숙소가 같은 장소면 핀은 하나(출발점)다.
    expect(byId.has(`end:${HOUSE}`)).toBe(false);
  });

  it('카드가 보는 장소의 핀은 `selected`', () => {
    const { markers } = todayMapLayers(lib, trip, 0, legs, {
      visited: new Set(),
      selectedPlaceId: P2,
    });
    expect(markers.filter((m) => m.selected).map((m) => m.id)).toEqual([P2]);
  });

  it('없는 Day면 비어 있다', () => {
    const { markers, polylines } = todayMapLayers(lib, trip, 5, [], {
      visited: new Set(),
      selectedPlaceId: null,
    });
    expect(markers).toEqual([]);
    expect(polylines).toEqual([]);
  });
});
