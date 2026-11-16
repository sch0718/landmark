/** 네이버가 지원하는 한국 사각형 범위(경계 포함). */
export function isInKorea(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= 124 &&
    lng <= 132 &&
    lat >= 33 &&
    lat <= 39
  );
}

/** 출발지·도착지 중 한 곳이라도 한국 밖이면 해외 구간이다. */
export function isAbroadLeg(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
): boolean {
  return !isInKorea(from.lng, from.lat) || !isInKorea(to.lng, to.lat);
}
