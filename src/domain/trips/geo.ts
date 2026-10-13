export type LngLat = [number, number];

/** 직선 800m 이하는 도보가 자동 기본값. */
export const WALK_AUTO_MAX_M = 800;
/** 직선 50km를 넘는 구간은 도보를 고를 수 없다(네이버 도보 길찾기 한도). */
export const WALK_MAX_M = 50_000;
/** 직선 10m 미만은 같은 지점으로 본다. 경로를 묻지 않고 거리 0·시간 0. */
export const SAME_POINT_M = 10;

const EARTH_RADIUS_M = 6_371_008.8;
/** 직선거리를 도로·보행 거리로 늘리는 계수. */
const DETOUR = 1.3;
const SPEED_MPS = { car: 40_000 / 3600, walk: 4000 / 3600 } as const;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** 두 좌표의 하버사인 거리(m). 같은 점·거의 같은 점에서도 NaN이 나오지 않는다. */
export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  // 부동소수 오차로 h가 [0, 1]을 살짝 벗어나면 asin/sqrt가 NaN을 낸다.
  const clamped = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(clamped));
}

export function autoMode(straightM: number): 'car' | 'walk' {
  return straightM <= WALK_AUTO_MAX_M ? 'walk' : 'car';
}

/** 경로를 얻지 못했을 때의 직선 추정: 거리 = 직선 × 1.3, 자동차 시속 40km, 도보 시속 4km. */
export function estimateLeg(
  mode: 'car' | 'walk',
  straightM: number,
): { distanceM: number; durationS: number } {
  if (!(straightM >= SAME_POINT_M)) return { distanceM: 0, durationS: 0 };
  const distance = straightM * DETOUR;
  return { distanceM: Math.round(distance), durationS: Math.round(distance / SPEED_MPS[mode]) };
}
