import { describe, expect, it } from 'vitest';
import type { PlannedLeg } from 'src/sections/trips/planner/use-day-plan';
import type { GeoFix } from 'src/services/geolocation';
import {
  directionsFrom,
  legInto,
  pointBefore,
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
      origin: { from: fromOf(P1), leg: legWith('walk') },
      platform: 'app',
    });
    expect(url).toMatch(/^nmap:\/\/route\/walk\?slat=37\.75&slng=128\.9&sname=/);
    expect(url).toContain('dlat=37.772&dlng=128.947');
  });

  it('구간이 없으면 직선 800m 이하는 도보, 그보다 멀면 자동차', () => {
    // 중앙시장 닭강정 → 창가 자리 약 440m, → 안목 카페거리 약 4.8km.
    expect(
      todayDirections({
        to: places[P5]!,
        origin: { from: fromOf(P1), leg: null },
        platform: 'web',
      }),
    ).toMatch(/^https:\/\/map\.naver\.com\/p\/directions\/128\.9,37\.75,.+\/-\/walk$/);
    expect(
      todayDirections({
        to: places[P2]!,
        origin: { from: fromOf(P1), leg: null },
        platform: 'web',
      }),
    ).toMatch(/\/-\/car$/);
  });

  it('출발점이 없으면 null', () => {
    expect(todayDirections({ to: places[P2]!, origin: null, platform: 'app' })).toBeNull();
  });
});

describe('directionsFrom·legInto·pointBefore', () => {
  const stop = (id: string): TodayStop => ({ place: places[id]! }) as TodayStop;
  const legs = ['a', 'b', 'c', 'd'].map((key) => ({ key }) as PlannedLeg);
  const model = (start: string | null, end: string | null, ids: string[]) =>
    ({
      start: start === null ? null : places[start]!,
      end: end === null ? null : places[end]!,
      stops: ids.map(stop),
      plan: { legs },
    }) as unknown as TodayModel;

  const fromIn = (...args: Parameters<typeof directionsFrom>) => directionsFrom(...args)?.from;

  it('앞 지점은 직전 Stop, 첫 Stop이면 출발점, 출발점도 없으면 null', () => {
    expect(fromIn(model(null, null, [P1, P2]), 1)).toEqual(fromOf(P1));
    expect(fromIn(model(HOUSE, null, [P1, P2]), 0)).toEqual(fromOf(HOUSE));
    expect(directionsFrom(model(null, null, [P1, P2]), 0)).toBeNull();
    expect(pointBefore(model(null, null, [P1, P2]), 1)).toBe(places[P1]);
    expect(pointBefore(model(HOUSE, null, [P1, P2]), 0)).toBe(places[HOUSE]);
    expect(pointBefore(model(null, null, [P1, P2]), 0)).toBeNull();
  });

  it('숙소(`end`)는 마지막 Stop, Stop이 없으면 출발점', () => {
    expect(fromIn(model(null, HOUSE, [P1, P2]), 'end')).toEqual(fromOf(P2));
    expect(fromIn(model(P5, HOUSE, []), 'end')).toEqual(fromOf(P5));
    expect(directionsFrom(model(null, HOUSE, []), 'end')).toBeNull();
  });

  it('앞 지점에서 나서면 그 구간을 함께 준다', () => {
    expect(directionsFrom(model(null, HOUSE, [P1, P2]), 1)?.leg).toEqual({ key: 'a' });
    expect(directionsFrom(model(HOUSE, null, [P1, P2]), 0)?.leg).toEqual({ key: 'a' });
  });

  it('쓸 수 있는 내 위치가 있으면 `내 위치`에서, 계획 구간은 쓰지 않는다', () => {
    const fix: GeoFix = { lng: 128.95, lat: 37.78, accuracyM: 30, at: 0 };
    const origin = directionsFrom(model(null, HOUSE, [P1, P2]), 1, fix);
    expect(origin).toEqual({ from: { name: '내 위치', lng: 128.95, lat: 37.78 }, leg: null });
    // 앞 지점이 없어도 내 위치에서 나선다.
    expect(directionsFrom(model(null, null, [P1]), 0, fix)?.from.name).toBe('내 위치');
    expect(directionsFrom(model(null, HOUSE, []), 'end', fix)?.from.name).toBe('내 위치');
    expect(directionsFrom(model(null, null, [P1]), 0, null)).toBeNull();
  });

  it('내 위치에서 500m면 계획 구간이 자동차여도 도보로 길찾기', () => {
    // 안목 카페거리(128.947, 37.772)에서 북쪽으로 약 500m. 그 앞 구간(P1→P2)은 자동차.
    const fix: GeoFix = { lng: 128.947, lat: 37.772 + 0.0045, accuracyM: 30, at: 0 };
    const carLegs = { ...model(null, null, [P1, P2]), plan: { legs: [legWith('car')] } };
    expect(legInto(carLegs as unknown as TodayModel, 1)?.mode).toBe('car');
    const url = todayDirections({
      to: places[P2]!,
      origin: directionsFrom(carLegs as unknown as TodayModel, 1, fix),
      platform: 'app',
    });
    expect(url).toMatch(
      /^nmap:\/\/route\/walk\?slat=37\.7765&slng=128\.947&sname=%EB%82%B4%20%EC%9C%84%EC%B9%98&/,
    );
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

describe('해외 당일 길찾기', () => {
  const paris = { ...places[P2]!, lng: 2.2945, lat: 48.8584 };
  it.each(['app', 'web'] as const)(
    '%s는 실제 출발점·도착점 중 하나라도 해외면 구글 주소를 쓴다',
    (platform) => {
      for (const [from, to] of [
        [fromOf(P1), paris],
        [{ name: '파리', lng: 2.2945, lat: 48.8584 }, places[P2]!],
      ] as const) {
        const url = new URL(
          todayDirections({ to, origin: { from, leg: legWith('walk') }, platform })!,
        );
        expect(url.origin).toBe('https://www.google.com');
        expect(url.searchParams.get('origin')).toBe(`${from.lat},${from.lng}`);
        expect(url.searchParams.get('destination')).toBe(`${to.lat},${to.lng}`);
        expect(url.searchParams.get('travelmode')).toBe('walking');
      }
      expect(
        todayDirections({
          to: places[P2]!,
          origin: { from: fromOf(P1), leg: legWith('car') },
          platform,
        }),
      ).toMatch(platform === 'app' ? /^nmap:/ : /^https:\/\/map.naver.com/);
    },
  );
  it.each(['app', 'web'] as const)(
    '%s는 계획 구간 대신 내 위치로 해외 여부와 자동 수단을 정한다',
    (platform) => {
      const model = {
        start: places[P1]!,
        end: null,
        stops: [{ place: places[P2]! }],
        plan: { legs: [legWith('walk')] },
      } as unknown as TodayModel;
      const fix = { lng: paris.lng, lat: paris.lat, accuracyM: 30, at: 0 };
      const url = new URL(
        todayDirections({ to: places[P2]!, origin: directionsFrom(model, 0, fix), platform })!,
      );
      expect(url.origin).toBe('https://www.google.com');
      expect(url.searchParams.get('origin')).toBe('48.8584,2.2945');
      expect(url.searchParams.get('destination')).toBe(`${places[P2]!.lat},${places[P2]!.lng}`);
      expect(url.searchParams.get('travelmode')).toBe('driving');
      const domesticFix = { ...fix, lng: places[P2]!.lng, lat: places[P2]!.lat + 0.0045 };
      const domesticModel = { ...model, start: paris };
      expect(
        todayDirections({
          to: places[P2]!,
          origin: directionsFrom(domesticModel, 0, domesticFix),
          platform,
        }),
      ).toMatch(platform === 'app' ? /^nmap:\/\/route\/walk/ : /\/-\/walk$/);
      const nearbyParis = { ...fix, lat: fix.lat + 0.0045 };
      expect(
        new URL(
          todayDirections({ to: paris, origin: directionsFrom(model, 0, nearbyParis), platform })!,
        ).searchParams.get('travelmode'),
      ).toBe('walking');
    },
  );
  it.each(['app', 'web'] as const)(
    '%s는 출발점 없음과 유효하지 않은 좌표에 null을 돌려준다',
    (platform) => {
      expect(todayDirections({ to: paris, origin: null, platform })).toBeNull();
      for (const from of [
        { name: '오류', lng: NaN, lat: 0 },
        { name: '오류', lng: 180.01, lat: 0 },
      ]) {
        expect(todayDirections({ to: paris, origin: { from, leg: null }, platform })).toBeNull();
      }
      expect(
        todayDirections({
          to: { ...paris, lat: 90.01 },
          origin: { from: fromOf(P1), leg: null },
          platform,
        }),
      ).toBeNull();
    },
  );
});
