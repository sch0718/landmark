import { regionOf } from 'src/domain/library/region';
import type { Place } from 'src/schema/library';

function haversineKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** 개선 전의 순차 비교. 비교 횟수·동률·10km 경계를 검증할 기준이다. */
export function referenceRegions(places: Place[], parse = regionOf): Map<string, string> {
  const result = new Map<string, string>();
  const known: Array<{ region: string; lng: number; lat: number }> = [];
  const unknown: Place[] = [];
  for (const place of places) {
    const region = parse(place.address);
    if (region === '기타') unknown.push(place);
    else known.push({ region, lng: place.lng, lat: place.lat });
    result.set(place.id, region);
  }
  for (const place of unknown) {
    let best = '기타';
    let bestKm = 10;
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
