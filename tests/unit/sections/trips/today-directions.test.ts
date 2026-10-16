import { describe, expect, it } from 'vitest';
import type { PlannedLeg } from 'src/sections/trips/planner/use-day-plan';
import {
  directionsFrom,
  legInto,
  todayDirections,
  type DirectionsFrom,
} from 'src/sections/trips/today/today-directions';
import type { TodayModel, TodayStop } from 'src/sections/trips/today/use-today';
import { HOUSE, P1, P2, P5, plannerLibrary } from './planner-fixtures';

const places = plannerLibrary().places;
const fromOf = (id: string): DirectionsFrom => {
  const p = places[id]!;
  return { name: p.name.value, lng: p.lng, lat: p.lat };
};
const legWith = (mode: 'car' | 'walk') => ({ mode }) as PlannedLeg;

describe('todayDirections', () => {
  it('구간이 있으면 그 수단(먼 곳이어도 도보로 정했으면 도보)', () => {
    const url = todayDirections({
      to: places[P2]!,
      from: fromOf(P1),
      leg: legWith('walk'),
      platform: 'app',
    });
    expect(url).toMatch(/^nmap:\/\/route\/walk\?slat=37\.75&slng=128\.9&sname=/);
    expect(url).toContain('dlat=37.772&dlng=128.947');
  });

  it('구간이 없으면 직선 800m 이하는 도보, 그보다 멀면 자동차', () => {
    // 중앙시장 닭강정 → 창가 자리 약 440m, → 안목 카페거리 약 4.8km.
    expect(
      todayDirections({ to: places[P5]!, from: fromOf(P1), leg: null, platform: 'web' }),
    ).toMatch(/^https:\/\/map\.naver\.com\/p\/directions\/128\.9,37\.75,.+\/-\/walk$/);
    expect(
      todayDirections({ to: places[P2]!, from: fromOf(P1), leg: null, platform: 'web' }),
    ).toMatch(/\/-\/car$/);
  });

  it('출발점이 없으면 null', () => {
    expect(
      todayDirections({ to: places[P2]!, from: null, leg: legWith('car'), platform: 'app' }),
    ).toBeNull();
  });
});

describe('directionsFrom·legInto', () => {
  const stop = (id: string): TodayStop => ({ place: places[id]! }) as TodayStop;
  const legs = ['a', 'b', 'c', 'd'].map((key) => ({ key }) as PlannedLeg);
  const model = (start: string | null, end: string | null, ids: string[]) =>
    ({
      start: start === null ? null : places[start]!,
      end: end === null ? null : places[end]!,
      stops: ids.map(stop),
      plan: { legs },
    }) as unknown as TodayModel;

  it('앞 지점은 직전 Stop, 첫 Stop이면 출발점, 출발점도 없으면 null', () => {
    expect(directionsFrom(model(null, null, [P1, P2]), 1)).toEqual(fromOf(P1));
    expect(directionsFrom(model(HOUSE, null, [P1, P2]), 0)).toEqual(fromOf(HOUSE));
    expect(directionsFrom(model(null, null, [P1, P2]), 0)).toBeNull();
  });

  it('숙소(`end`)는 마지막 Stop, Stop이 없으면 출발점', () => {
    expect(directionsFrom(model(null, HOUSE, [P1, P2]), 'end')).toEqual(fromOf(P2));
    expect(directionsFrom(model(P5, HOUSE, []), 'end')).toEqual(fromOf(P5));
    expect(directionsFrom(model(null, HOUSE, []), 'end')).toBeNull();
  });

  it('구간은 앞 지점에서 그 도착까지의 것', () => {
    // 출발점 없음: [P1, P2, 숙소] → 구간 a(P1→P2), b(P2→숙소).
    expect(legInto(model(null, HOUSE, [P1, P2]), 0)).toBeNull();
    expect(legInto(model(null, HOUSE, [P1, P2]), 1)?.key).toBe('a');
    expect(legInto(model(null, HOUSE, [P1, P2]), 'end')?.key).toBe('b');
    // 출발점 있음: [출발, P1, P2] → 구간 a(출발→P1), b(P1→P2).
    expect(legInto(model(HOUSE, null, [P1, P2]), 0)?.key).toBe('a');
    expect(legInto(model(HOUSE, null, [P1, P2]), 1)?.key).toBe('b');
    expect(legInto(model(HOUSE, null, [P1, P2]), 'end')).toBeNull();
  });
});
