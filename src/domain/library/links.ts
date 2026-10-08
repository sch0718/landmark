import type { Place } from 'src/schema/library';

/** 네이버 플레이스 모바일 페이지 URL. 네이버 장소가 아닌 핀(`pin`)은 null. */
export function naverPlaceUrlOf(place: Place): string | null {
  return place.source.kind === 'naver'
    ? `https://m.place.naver.com/place/${place.source.sid}`
    : null;
}
