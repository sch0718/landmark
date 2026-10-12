import { describe, expect, it } from 'vitest';
import {
  autoMode,
  estimateLeg,
  haversineM,
  SAME_POINT_M,
  WALK_AUTO_MAX_M,
  WALK_MAX_M,
} from 'src/domain/trips/geo';

const CITY_HALL: [number, number] = [126.978, 37.5666];
const GANGNEUNG_STATION: [number, number] = [128.9, 37.7644];

describe('haversineM', () => {
  it('서울시청↔강릉역은 약 170.7km(±1%)', () => {
    // 기준값은 R=6371.0088km 구면에서 독립 계산한 값. 도로 거리(약 230km)나 어림 165km가 아니다.
    const d = haversineM(CITY_HALL, GANGNEUNG_STATION);
    expect(d).toBeGreaterThan(170_700 * 0.99);
    expect(d).toBeLessThan(170_700 * 1.01);
  });

  it('같은 점은 정확히 0이고 NaN이 아니다', () => {
    expect(haversineM(CITY_HALL, CITY_HALL)).toBe(0);
  });

  it('거의 같은 점(부동소수 오차)에서도 NaN이 나오지 않는다', () => {
    const d = haversineM([128.95, 37.77], [128.95 + 1e-15, 37.77 + 1e-15]);
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBeGreaterThanOrEqual(0);
  });

  it('반대편 점도 NaN 없이 유한하다', () => {
    const d = haversineM([0, 0], [180, 0]);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(20_000_000);
  });
});

describe('autoMode', () => {
  it('800m까지는 도보, 801m부터 자동차', () => {
    expect(WALK_AUTO_MAX_M).toBe(800);
    expect(autoMode(0)).toBe('walk');
    expect(autoMode(800)).toBe('walk');
    expect(autoMode(801)).toBe('car');
  });
});

describe('estimateLeg', () => {
  it('직선 1000m 자동차: 거리 1300m, 시간 117초(시속 40km)', () => {
    expect(estimateLeg('car', 1000)).toEqual({ distanceM: 1300, durationS: 117 });
  });

  it('직선 1000m 도보: 거리 1300m, 시간 1170초(시속 4km)', () => {
    expect(estimateLeg('walk', 1000)).toEqual({ distanceM: 1300, durationS: 1170 });
  });

  it('직선 10m 미만은 거리 0·시간 0', () => {
    expect(SAME_POINT_M).toBe(10);
    expect(estimateLeg('car', 0)).toEqual({ distanceM: 0, durationS: 0 });
    expect(estimateLeg('walk', 9.9)).toEqual({ distanceM: 0, durationS: 0 });
  });

  it('직선 10m는 추정값을 낸다', () => {
    expect(estimateLeg('walk', SAME_POINT_M).distanceM).toBe(13);
  });

  it('50km 상수', () => {
    expect(WALK_MAX_M).toBe(50_000);
  });
});
