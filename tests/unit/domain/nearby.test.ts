import { describe, expect, it, vi } from 'vitest';
import {
  ACCURACY_WARN_M,
  DEFAULT_RADIUS_M,
  NEARBY_RADII,
  formatDistanceM,
  nearbyPlaces,
  nextRadius,
  radiusBox,
  radiusLabel,
} from 'src/domain/nearby';
import { haversineM, type LngLat } from 'src/domain/trips/geo';
import type { Place } from 'src/schema/library';

// 부동소수로는 거리가 정확히 1000m인 좌표를 만들 수 없어, 표식 좌표(경도 999·998)만 거리를 못 박는다.
vi.mock('src/domain/trips/geo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/domain/trips/geo')>();
  return {
    ...actual,
    haversineM: (a: LngLat, b: LngLat) =>
      b[0] === 999 ? 1000 : b[0] === 998 ? 1000.000001 : actual.haversineM(a, b),
  };
});

const T = '2026-10-16T01:00:00.000Z';
const f = <V>(value: V) => ({ value, updatedAt: T });

function place(id: string, name: string, lng: number, lat: number): Place {
  return {
    id,
    source: { kind: 'naver', sid: id },
    name: f(name),
    address: '강원특별자치도 속초시',
    lng,
    lat,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T,
    deletedAt: null,
  };
}

/** 기준점에서 정북쪽으로 거의 `meters`m 떨어진 위도(이분법). `atMost`면 그 값 이하 중 가장 먼 점. */
function latAt(from: LngLat, meters: number, side: 'atMost' | 'above'): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (haversineM(from, [from[0], from[1] + mid]) < meters) lo = mid;
    else hi = mid;
  }
  return from[1] + (side === 'atMost' ? lo : hi);
}

// 적도 위 기준점: 위도 오차가 부동소수 한 칸 단위로 갈려 경계(≤)를 가를 수 있다.
const FROM: LngLat = [128.9, 0];

describe('상수', () => {
  it('반경 목록·기본값·경고 기준', () => {
    expect(NEARBY_RADII).toEqual([500, 1000, 3000, 5000, 10_000, null]);
    expect(DEFAULT_RADIUS_M).toBe(3000);
    expect(ACCURACY_WARN_M).toBe(1000);
  });
});

describe('formatDistanceM', () => {
  it.each([
    [0, '10m'],
    [4, '10m'],
    [567.7, '570m'],
    [995, '1.0km'],
    [1000, '1.0km'],
    [2435, '2.4km'],
    [9949, '9.9km'],
    [9960, '10km'],
    [13510, '14km'],
  ])('%d → %s', (m, text) => {
    expect(formatDistanceM(m)).toBe(text);
  });
});

describe('nearbyPlaces', () => {
  const near = place('p1', '가까운곳', FROM[0], FROM[1]);
  const edge = place('p2', '경계', FROM[0], latAt(FROM, 1000, 'atMost'));
  const far = place('p3', '먼곳', FROM[0], FROM[1] + 1001 / 111_195);

  it('반경 1000m: 경계(1000m)까지 포함하고 가까운 순', () => {
    const { places, distances } = nearbyPlaces([far, edge, near], FROM, 1000);
    expect(places.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(distances.size).toBe(2);
    expect(distances.get('p1')).toBe(0);
    expect(distances.get('p2')).toBeLessThanOrEqual(1000);
    expect(distances.get('p2')).toBeGreaterThan(999.999);
  });

  it('반경 바로 밖(부동소수 한 칸 위)은 뺀다', () => {
    const justOut = place('p4', '바로밖', FROM[0], latAt(FROM, 1000, 'above'));
    expect(haversineM(FROM, [justOut.lng, justOut.lat])).toBeGreaterThan(1000);
    expect(nearbyPlaces([justOut, edge], FROM, 1000).places.map((p) => p.id)).toEqual(['p2']);
  });

  it('거리가 정확히 반경과 같으면 포함하고, 조금이라도 넘으면 뺀다', () => {
    const exact = place('e1', '정확히', 999, 0);
    const over = place('e2', '넘음', 998, 0);
    expect(nearbyPlaces([exact, over], FROM, 1000).places.map((p) => p.id)).toEqual(['e1']);
  });

  it('반경 밖 장소는 1001m 근처에서 빠진다', () => {
    expect(haversineM(FROM, [far.lng, far.lat])).toBeGreaterThan(1000);
    expect(nearbyPlaces([far], FROM, 1000).places).toEqual([]);
  });

  it('같은 거리면 이름(한국어) 순, 이름도 같으면 id 순', () => {
    const a = place('p9', '나', 128.9, 0.001);
    const b = place('p8', '가', 128.9, 0.001);
    const c1 = place('p6', '다', 128.9, 0.001);
    const c2 = place('p5', '다', 128.9, 0.001);
    const { places } = nearbyPlaces([a, c1, b, c2], FROM, null);
    expect(places.map((p) => p.id)).toEqual(['p8', 'p9', 'p5', 'p6']);
  });

  it('null이면 전부, distances 크기는 결과 수와 같다', () => {
    const { places, distances } = nearbyPlaces([far, edge, near], FROM, null);
    expect(places).toHaveLength(3);
    expect(distances.size).toBe(3);
  });

  it('빈 목록', () => {
    const { places, distances } = nearbyPlaces([], FROM, 500);
    expect(places).toEqual([]);
    expect(distances.size).toBe(0);
  });
});

describe('반경 도우미', () => {
  it('nextRadius: 한 단계씩, 끝은 그대로', () => {
    expect(nextRadius(500)).toBe(1000);
    expect(nextRadius(5000)).toBe(10_000);
    expect(nextRadius(10_000)).toBeNull();
    expect(nextRadius(null)).toBeNull();
  });

  it('radiusLabel', () => {
    expect(radiusLabel(500)).toBe('500m');
    expect(radiusLabel(1000)).toBe('1km');
    expect(radiusLabel(3000)).toBe('3km');
    expect(radiusLabel(10_000)).toBe('10km');
    expect(radiusLabel(null)).toBe('전체');
  });

  it('radiusBox: 동서남북 3000m 점이 상자 안에 들고 상자가 지나치게 크지 않다', () => {
    const center: LngLat = [128.9, 37.75];
    const [sw, ne] = radiusBox(center, 3000);
    // haversineM 기준 정확히 3000m인 동서남북 점을 이분법으로 만든다.
    const solve = (toPoint: (t: number) => LngLat): LngLat => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        if (haversineM(center, toPoint(mid)) < 3000) lo = mid;
        else hi = mid;
      }
      return toPoint(lo);
    };
    const points = [
      solve((t) => [center[0], center[1] + t]),
      solve((t) => [center[0], center[1] - t]),
      solve((t) => [center[0] + t, center[1]]),
      solve((t) => [center[0] - t, center[1]]),
    ];
    for (const point of points) {
      expect(haversineM(center, point)).toBeGreaterThan(2999);
      expect(haversineM(center, point)).toBeLessThanOrEqual(3000);
      expect(point[0]).toBeGreaterThanOrEqual(sw[0]);
      expect(point[0]).toBeLessThanOrEqual(ne[0]);
      expect(point[1]).toBeGreaterThanOrEqual(sw[1]);
      expect(point[1]).toBeLessThanOrEqual(ne[1]);
    }
    // 상자 끝도 원보다 크게 벗어나지 않는다(0.3% 이내).
    expect(haversineM(center, [center[0], ne[1]])).toBeLessThan(3010);
    expect(haversineM(center, [ne[0], center[1]])).toBeLessThan(3010);
  });
});
