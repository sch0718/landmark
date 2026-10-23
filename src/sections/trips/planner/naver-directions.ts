/** 길찾기 링크가 필요로 하는 구간: 두 지점의 이름·좌표(WGS84)와 이동 수단. */
export type DirectionsLeg = {
  from: { name: string; lng: number; lat: number };
  to: { name: string; lng: number; lat: number };
  mode: 'car' | 'walk' | 'transit';
};

/** 네이버 지도 URL Scheme의 `appname`: 배포 도메인. */
const APP_NAME = 'landmark.sch0718.dev';

const valid = (p: { lng: number; lat: number }): boolean =>
  Number.isFinite(p.lng) &&
  Number.isFinite(p.lat) &&
  Math.abs(p.lng) <= 180 &&
  Math.abs(p.lat) <= 90;

/**
 * 네이버 지도 길찾기 주소.
 * - `app`(좁은 화면): 네이버 지도 앱 URL Scheme `nmap://route/<car|walk|public>?…`(위도·경도 따로, 이름은 percent 인코딩).
 * - `web`(넓은 화면): `https://map.naver.com/p/directions/<출발>/<도착>/<경유>/<수단>`.
 *   각 지점은 `경도,위도,이름,,SIMPLE_POI`(id 없이 좌표로 지점을 찾는 형식), 경유는 없음(`-`).
 *   map.naver.com 웹 번들 분석으로 확인한 형식이다(근거: task-14-report.md).
 * 좌표가 유한하지 않으면 잘못된 주소를 내보내지 않고 null.
 */
export function naverDirectionsUrl(leg: DirectionsLeg, platform: 'app' | 'web'): string | null {
  const { from, to, mode } = leg;
  if (!valid(from) || !valid(to)) return null;
  if (platform === 'app') {
    const query = [
      `slat=${from.lat}`,
      `slng=${from.lng}`,
      `sname=${encodeURIComponent(from.name)}`,
      `dlat=${to.lat}`,
      `dlng=${to.lng}`,
      `dname=${encodeURIComponent(to.name)}`,
      `appname=${APP_NAME}`,
    ].join('&');
    return `nmap://route/${mode === 'transit' ? 'public' : mode}?${query}`;
  }
  const point = (p: DirectionsLeg['from']) =>
    `${p.lng},${p.lat},${encodeURIComponent(p.name)},,SIMPLE_POI`;
  return `https://map.naver.com/p/directions/${point(from)}/${point(to)}/-/${mode}`;
}
