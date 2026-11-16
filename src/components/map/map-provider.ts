import { isInKorea } from 'src/lib/korea';

export type MapProvider = 'naver' | 'google';

/** 저장값과 키로 실제로 그릴 지도. 구글 키가 없으면 네이버. */
export function resolveMapProvider(pref: MapProvider, googleKey: string | undefined): MapProvider {
  return googleKey ? pref : 'naver';
}

/** 공유 보기: 키가 있고 점이 하나 이상이며 모두 한국 밖이면 구글. */
export function shareMapProvider(
  points: [number, number][],
  googleKey: string | undefined,
): MapProvider {
  return googleKey && points.length > 0 && points.every(([lng, lat]) => !isInKorea(lng, lat))
    ? 'google'
    : 'naver';
}
