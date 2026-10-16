import { haversineM, type LngLat } from 'src/domain/trips/geo';
import type { Place } from 'src/schema/library';

/** 반경 고르기. `null`은 전체(반경 제한 없음). */
export const NEARBY_RADII = [500, 1000, 3000, 5000, 10_000, null] as const;
export type NearbyRadius = (typeof NEARBY_RADII)[number];
export const DEFAULT_RADIUS_M: NearbyRadius = 3000;
/** 위치 오차가 이 값(m)을 넘으면 정확도 경고를 보인다. */
export const ACCURACY_WARN_M = 1000;

/**
 * 위도 1도의 길이(m). `haversineM`의 구형 지구에서는 약 111,195m다. 111,320(적도 경도 1도 값)을 쓰면
 * 상자가 원보다 3m쯤 작아지므로, 상자가 원을 덮도록 조금 작은 값으로 잡았다(스펙 §테스트 "원을 감싼다").
 */
const METERS_PER_LAT_DEGREE = 111_000;

const compareKo = (a: string, b: string): number => a.localeCompare(b, 'ko');

/**
 * `from`에서 반경 `radiusM`(경계 포함) 안의 장소를 가까운 순으로 돌려준다. `null`이면 전부.
 * 거리가 같으면 이름(한국어) → id 순. `distances`는 결과 장소의 직선거리(m)만 담는다.
 */
export function nearbyPlaces(
  places: readonly Place[],
  from: LngLat,
  radiusM: NearbyRadius,
): { places: Place[]; distances: Map<string, number> } {
  const measured: { place: Place; distance: number }[] = [];
  for (const place of places) {
    const distance = haversineM(from, [place.lng, place.lat]);
    if (radiusM === null || distance <= radiusM) measured.push({ place, distance });
  }
  measured.sort(
    (a, b) =>
      a.distance - b.distance ||
      compareKo(a.place.name.value, b.place.name.value) ||
      a.place.id.localeCompare(b.place.id),
  );
  return {
    places: measured.map((m) => m.place),
    distances: new Map(measured.map((m) => [m.place.id, m.distance])),
  };
}

/**
 * 직선거리 글자. 1km 미만은 10m 단위 반올림(최소 `10m`), 1~10km는 소수 한 자리, 10km 이상은 정수.
 * 반올림이 다음 단계에 닿으면 다음 단계로 쓴다(995 → `1.0km`, 9,960 → `10km`).
 */
export function formatDistanceM(m: number): string {
  const rounded10 = Math.max(10, Math.round(m / 10) * 10);
  if (rounded10 < 1000) return `${rounded10}m`;
  const tenthKm = Math.round(Math.max(m, 1000) / 100) / 10;
  if (tenthKm < 10) return `${tenthKm.toFixed(1)}km`;
  return `${Math.round(m / 1000)}km`;
}

export function radiusLabel(r: NearbyRadius): string {
  if (r === null) return '전체';
  return r < 1000 ? `${r}m` : `${r / 1000}km`;
}

/** 반경 한 단계 넓히기. 끝(전체)이면 그대로. */
export function nextRadius(r: NearbyRadius): NearbyRadius {
  const index = NEARBY_RADII.indexOf(r);
  return NEARBY_RADII[Math.min(index + 1, NEARBY_RADII.length - 1)] ?? null;
}

/** 중심에서 동서남북 `radiusM`까지 덮는 상자 `[남서, 북동]`. 경도는 위도의 `cos`로 늘린다. */
export function radiusBox(center: LngLat, radiusM: number): [LngLat, LngLat] {
  const [lng, lat] = center;
  const dLat = radiusM / METERS_PER_LAT_DEGREE;
  const dLng = radiusM / (METERS_PER_LAT_DEGREE * Math.cos((lat * Math.PI) / 180));
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat + dLat],
  ];
}
