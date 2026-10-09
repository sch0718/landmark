import type { Place } from 'src/schema/library';

const METRO_SUFFIX = /(특별자치시|특별시|광역시)$/;
const CITY_COUNTY_SUFFIX = /[시군]$/;
const OTHER = '기타';
/** 주소가 없는 장소가 이웃의 지역을 빌려 올 수 있는 최대 거리. */
const BORROW_RADIUS_KM = 10;
const EARTH_RADIUS_KM = 6371;

/**
 * 주소에서 지역 이름을 뽑는다.
 * 첫 토큰이 특별시·광역시·특별자치시면 그 접미사를 뗀 이름, 아니면 두 번째 토큰에서
 * 시·군을 뗀 이름, 둘 다 아니면 `기타`.
 */
export function regionOf(address: string): string {
  const [first, second] = address.trim().split(/\s+/);
  if (first !== undefined && METRO_SUFFIX.test(first)) {
    const name = first.replace(METRO_SUFFIX, '');
    if (name !== '') return name;
  }
  if (second !== undefined && CITY_COUNTY_SUFFIX.test(second)) {
    const name = second.replace(CITY_COUNTY_SUFFIX, '');
    if (name !== '') return name;
  }
  return '기타';
}

function haversineKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * 장소별 지역(`장소 id → 지역`). 주소에서 지역을 뽑을 수 있으면 `regionOf` 그대로이고,
 * 주소가 없거나 해석되지 않으면(`기타`) 지역이 확인된 가장 가까운 장소의 지역을 10km 안에서 빌려 온다.
 * 빌려 올 곳이 없으면 `기타`. 빌린 지역은 다시 다른 장소에 빌려 주지 않는다.
 */
export function regionsByPlace(places: Place[]): Map<string, string> {
  const result = new Map<string, string>();
  const known: Array<{ region: string; lng: number; lat: number }> = [];
  const unknown: Place[] = [];
  for (const place of places) {
    const region = regionOf(place.address);
    if (region === OTHER) unknown.push(place);
    else known.push({ region, lng: place.lng, lat: place.lat });
    result.set(place.id, region);
  }
  for (const place of unknown) {
    let best: string = OTHER;
    let bestKm = BORROW_RADIUS_KM;
    for (const k of known) {
      const km = haversineKm(place.lng, place.lat, k.lng, k.lat);
      if (km <= bestKm) {
        bestKm = km;
        best = k.region;
      }
    }
    result.set(place.id, best);
  }
  return result;
}
