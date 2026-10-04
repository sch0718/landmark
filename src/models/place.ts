import type { Place } from 'src/schema/trip-data';

/** 네이버 플레이스 모바일 페이지 URL. 네이버 sid가 없는 custom 장소는 null. */
export function naverPlaceUrl(place: Place): string | null {
  return place.sid ? `https://m.place.naver.com/place/${place.sid}` : null;
}
