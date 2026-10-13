// 서버 함수 결과를 Cloudflare Cache API에 넣고 꺼낼 때 쓰는 키.
// 키는 요청 입력 하나에서만 만들어 조회·저장에 같은 키를 쓴다. 네트워크 요청은 하지 않는다.
import { classifyLink } from './links';

export const CACHE_ORIGIN = 'https://cache.landmark';

/**
 * - 장소: 네트워크 없이 ID를 알 수 있는 링크(네이버 웹 주소·카카오 장소 주소)는 `place/<서비스>/<ID>`,
 *   그 밖(짧은 링크·구글)은 쿼리·해시를 뺀 `link/<호스트><경로>`.
 * - 폴더: `folder/<공유 ID>`.
 *
 * 장소 입력은 `URL`로 읽을 수 있어야 한다. 읽을 수 없는 입력에는 쓰지 않는다(`TypeError`).
 */
export function cacheKey(kind: 'place' | 'folder', input: string): string {
  if (kind === 'folder') return `${CACHE_ORIGIN}/folder/${encodeURIComponent(input)}`;
  const link = classifyLink(input);
  if (link.kind === 'naver-place') return `${CACHE_ORIGIN}/place/naver/${link.sid}`;
  if (link.kind === 'kakao-place') return `${CACHE_ORIGIN}/place/kakao/${link.kakaoId}`;
  const url = new URL(input.trim());
  return `${CACHE_ORIGIN}/link/${url.hostname}${url.pathname}`;
}

/** 경로 입력 키(`routeInputKey`)로 만든 캐시 키. 자동차·도보와 좌표 소수 5자리가 키에 들어 있다. */
export function routeCacheKey(input: string): string {
  return `${CACHE_ORIGIN}/route/${encodeURIComponent(input)}`;
}
