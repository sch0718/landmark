// 붙여 넣은 지도 링크를 네트워크 없이 분류한다. 호스트·경로만 보고, 값을 꺼내 오는 일은 서버 함수가 한다.
// Cloudflare 서버 함수에서도 쓰므로 import 없이 순수 함수로 둔다.

export type LinkKind =
  | { kind: 'redirect'; url: string }
  | { kind: 'naver-place'; sid: string }
  | { kind: 'naver-folder'; shareId: string }
  | { kind: 'kakao-place'; kakaoId: string }
  | {
      kind: 'google-place';
      name: string;
      googleId: string | null;
      lat: number | null;
      lng: number | null;
      plusCode: string | null;
    }
  | { kind: 'unsupported' };

const UNSUPPORTED: LinkKind = { kind: 'unsupported' };

// 서버가 접속해도 되는 호스트. 정확히 같은 이름만 받는다(접미사 일치 금지).
export const ALLOWED_HOSTS: readonly string[] = [
  'naver.me',
  'map.naver.com',
  'm.place.naver.com',
  'pcmap.place.naver.com',
  'pages.map.naver.com',
  'kko.to',
  'place.map.kakao.com',
  'applink.map.kakao.com',
  'map.kakao.com',
  'place-api.map.kakao.com',
  'maps.app.goo.gl',
  'goo.gl',
  'www.google.com',
  'maps.google.com',
];

const NAVER_ENTRY_PLACE = /^\/p\/entry\/place\/(\d+)(?:\/|$)/;
const NAVER_SEARCH_PLACE = /^\/p\/search\/[^/]+\/place\/(\d+)(?:\/|$)/;
const NAVER_FOLDER = /^\/p\/favorite\/sharedPlace\/folder\/([0-9a-zA-Z]+)\/?$/;
const NAVER_PLACE_HOST_PATH = /^\/[^/]+\/(\d+)(?:\/|$)/;
const KAKAO_PLACE_PATH = /^\/(\d+)\/?$/;
const DIGITS = /^\d+$/;

// 서버가 접속해도 되는 주소인가: http(s), 허용 목록의 정확한 호스트, 기본 포트(URL이 80·443은 지운다), 사용자 정보 없음.
export function isAllowedUrl(url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.port !== '' || url.username !== '' || url.password !== '') return false;
  return ALLOWED_HOSTS.includes(url.hostname);
}

function parseHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  return isAllowedUrl(url) ? url : null;
}

// 짧은 링크는 쿼리·해시를 떼고 바깥에 보낸다(추적 값 전달 방지, 캐시 키와 같은 기준).
function shortLinkUrl(url: URL): string {
  return url.origin + url.pathname;
}

export function classifyLink(raw: string): LinkKind {
  const url = parseHttpUrl(raw);
  if (!url) return UNSUPPORTED;
  const { hostname, pathname } = url;

  switch (hostname) {
    case 'naver.me':
    case 'kko.to':
    case 'maps.app.goo.gl':
      return { kind: 'redirect', url: shortLinkUrl(url) };
    case 'goo.gl':
      return pathname.startsWith('/maps/')
        ? { kind: 'redirect', url: shortLinkUrl(url) }
        : UNSUPPORTED;
    case 'map.naver.com':
      return classifyNaverMap(pathname);
    case 'm.place.naver.com':
    case 'pcmap.place.naver.com': {
      const sid = NAVER_PLACE_HOST_PATH.exec(pathname)?.[1];
      return sid ? { kind: 'naver-place', sid } : UNSUPPORTED;
    }
    case 'place.map.kakao.com': {
      const kakaoId = KAKAO_PLACE_PATH.exec(pathname)?.[1];
      return kakaoId ? { kind: 'kakao-place', kakaoId } : UNSUPPORTED;
    }
    case 'applink.map.kakao.com': {
      const id = pathname === '/place' ? url.searchParams.get('id') : null;
      return id !== null && DIGITS.test(id) ? { kind: 'kakao-place', kakaoId: id } : UNSUPPORTED;
    }
    case 'map.kakao.com': {
      const id = url.searchParams.get('itemId');
      return id !== null && DIGITS.test(id) ? { kind: 'kakao-place', kakaoId: id } : UNSUPPORTED;
    }
    case 'www.google.com':
      return pathname.startsWith('/maps/place/') ? classifyGooglePlace(pathname) : UNSUPPORTED;
    case 'maps.google.com':
      return classifyGooglePlace(pathname);
    default:
      // 조회 API 호스트처럼 접속만 허용되는 호스트는 사용자 링크로 받지 않는다.
      return UNSUPPORTED;
  }
}

function classifyNaverMap(pathname: string): LinkKind {
  const folder = NAVER_FOLDER.exec(pathname)?.[1];
  if (folder) return { kind: 'naver-folder', shareId: folder };
  const sid = (NAVER_ENTRY_PLACE.exec(pathname) ?? NAVER_SEARCH_PLACE.exec(pathname))?.[1];
  return sid ? { kind: 'naver-place', sid } : UNSUPPORTED;
}

function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function toCoordinate(value: string | undefined, limit: number): number | null {
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

// 쿼리·해시는 보지 않는다. 구글 주소의 값(`data=!…`, `@위도,경도`)은 경로에 있다.
function classifyGooglePlace(pathname: string): LinkKind {
  const nameSegment = /\/place\/([^/]+)/.exec(pathname)?.[1] ?? '';
  // 이름의 '+'는 공백이다. 퍼센트 인코딩을 풀기 전에 바꿔야 `%2B`(진짜 +)가 남는다.
  const name = decodeSafely(nameSegment.replace(/\+/g, ' ')).trim();

  // 스키마가 소문자만 받으므로 대문자 ID는 소문자로 바꾼다.
  const googleId = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(pathname)?.[1]?.toLowerCase() ?? null;

  const exact = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(pathname);
  const view = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(pathname);
  const found = exact ?? view;
  let lat = toCoordinate(found?.[1], 90);
  let lng = toCoordinate(found?.[2], 180);
  if (lat === null || lng === null) {
    lat = null;
    lng = null;
  }

  const rawPlusCode = /!20s([^!/?#]+)/.exec(pathname)?.[1];
  const decodedPlusCode = rawPlusCode === undefined ? null : decodeSafely(rawPlusCode);
  const plusCode =
    decodedPlusCode !== null && /^[0-9A-Za-z]+\+[0-9A-Za-z]*$/.test(decodedPlusCode)
      ? decodedPlusCode
      : null;

  // 이름도 위치 단서도 없으면 구글 장소 링크가 아니다(예: maps.google.com 첫 화면).
  if (name === '' && googleId === null && lat === null && plusCode === null) return UNSUPPORTED;

  return { kind: 'google-place', name, googleId, lat, lng, plusCode };
}
