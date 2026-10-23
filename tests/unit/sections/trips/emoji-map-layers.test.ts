import { describe, expect, it } from 'vitest';
import type { Library } from 'src/schema/library';
import { tripMapLayers } from 'src/sections/trips/planner/trip-map-layers';
import { todayMapLayers } from 'src/sections/trips/today/today-map-layers';
import { L_CAFE, L_FOOD, L_SEA } from '../library/fixtures';
import { f, HOUSE, makeTrip, P1, P2, P3, P5, plannerLibrary, withTrip } from './planner-fixtures';

const trip = makeTrip({ origin: HOUSE, stops: [[P1], [P5]], candidates: [P3], lodging: [P2] });

function library(): Library {
  const base = plannerLibrary();
  return withTrip(
    {
      ...base,
      places: { ...base.places, [HOUSE]: { ...base.places[HOUSE]!, labelIds: f([L_CAFE]) } },
      labels: {
        ...base.labels,
        [L_FOOD]: { ...base.labels[L_FOOD]!, emoji: f('🍽️') },
        [L_CAFE]: { ...base.labels[L_CAFE]!, emoji: f('☕') },
        [L_SEA]: { ...base.labels[L_SEA]!, emoji: f('🌊') },
      },
    },
    trip,
  );
}

describe('계획·당일 지도 이모지', () => {
  it('번호·출발지·숙소·후보 이름 앞에 첫 라벨 이모지를 붙이고 다른 Day 점은 Day·이름을 설명한다', () => {
    const { markers } = tripMapLayers(library(), trip, 0, [], null);
    const names = new Map(markers.map((marker) => [marker.id, marker.label]));
    expect(names.get(P1)).toBe('1 🍽️ 중앙시장 닭강정');
    expect(names.get(`start:${HOUSE}`)).toBe('🏠 ☕ 바다 숙소');
    expect(names.get(`end:${P2}`)).toBe('🛏 ☕ 안목 카페거리');
    expect(names.get(P3)).toBe('🍽️ 속초 횟집');
    expect(names.get(P5)).toBe('Day 2 · 창가 자리');
  });

  it('첫 라벨을 지우면 뒤 라벨 이모지를 대신 쓰지 않는다', () => {
    const base = library();
    const lib = {
      ...base,
      labels: { ...base.labels, [L_FOOD]: { ...base.labels[L_FOOD]!, emoji: f(null) } },
    };
    expect(
      tripMapLayers(lib, trip, 0, [], null).markers.find((marker) => marker.id === P3)?.label,
    ).toBe('속초 횟집');
  });

  it('당일 지도도 번호·이모지·방문 흐림을 함께 유지한다', () => {
    const { markers } = todayMapLayers(library(), trip, 0, [], {
      visited: new Set([P1]),
      selectedPlaceId: null,
    });
    expect(markers.find((marker) => marker.id === P1)).toMatchObject({
      label: '1 🍽️ 중앙시장 닭강정',
      dimmed: true,
    });
    expect(markers.find((marker) => marker.id === `start:${HOUSE}`)?.label).toBe('🏠 ☕ 바다 숙소');
    expect(markers.some((marker) => marker.id === P3 || marker.id === P5)).toBe(false);
  });
});
