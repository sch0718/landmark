// 붙여 넣은 지도 링크를 장소 하나(또는 네이버 공유 폴더)로 풀고, 공유 폴더의 장소를 읽는다.
// Cloudflare 서버 함수에서도 쓰므로 상대 경로 import만 쓰고 브라우저·React 코드를 끌어오지 않는다.
import {
  FOLDER_PAGE_SIZE,
  TooManyPlacesError,
  fetchFolder,
  fetchPlaceSummary,
  type HttpDeps,
} from '../../pipeline/naver-client';
import { ApiError } from './http';
import { classifyLink, isAllowedUrl, type LinkKind } from './links';
import { decodePlusCode } from './plus-code';

export type ResolvedPlace = {
  kind: 'place';
  provider: 'naver' | 'kakao' | 'google';
  /** null은 구글뿐이다(장소 ID 없이 좌표만 있는 링크). */
  providerId: string | null;
  name: string;
  address: string;
  lng: number;
  lat: number;
  category: string | null;
};
export type FolderRef = { kind: 'folder'; shareId: string };
export type FolderResult = {
  folderName: string;
  places: { sid: string; name: string; address: string; lng: number; lat: number; memo: string }[];
};
export type Deps = { fetch: typeof fetch; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MAX_FOLDER_PLACES = 1_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// 구글 짧은 링크는 브라우저 UA면 302 대신 HTML을 준다.
const GOOGLE_SHORT_LINK_USER_AGENT = 'landmark-link-resolver';
const GOOGLE_SHORT_LINK_HOSTS: readonly string[] = ['maps.app.goo.gl', 'goo.gl'];
const SHARE_ID = /^[0-9a-zA-Z]+$/;
// 장소 북마크의 sid는 숫자다. 주소 북마크는 숫자가 아닌 sid를 가져 장소로 넣을 수 없다.
const SID_DIGITS = /^\d+$/;

const unsupported = () =>
  new ApiError('UNSUPPORTED_LINK', '네이버·카카오·구글 지도 장소 링크가 아님');
const notFound = () => new ApiError('NOT_FOUND', '장소를 찾지 못함');

type RequestOptions = {
  /** 이동 응답(3xx)을 돌려받는다. 짧은 링크를 풀 때만 켠다. 꺼져 있으면 3xx는 UPSTREAM_ERROR. */
  acceptRedirect?: boolean;
  /** NOT_FOUND로 볼 HTTP 상태. 기본은 404만. */
  notFoundStatuses?: readonly number[];
};

type Requester = (url: string, init: RequestInit, options?: RequestOptions) => Promise<Response>;

/**
 * 바깥 요청 하나: 허용 목록 검사 → `redirect: 'manual'`로 요청 → 상태 검사 → 본문까지 읽기.
 * 시한(기본 8초)은 본문을 다 읽을 때까지 잰다. 넘으면 요청을 끊고 TIMEOUT.
 */
function makeRequester(deps: Deps): Requester {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (url, init, options = {}) => {
    const target = new URL(url);
    // 바깥 요청은 https만 보낸다. 사용자가 붙여 넣은 http 주소는 호출하는 쪽이 https로 올려서 넘긴다.
    if (!isAllowedUrl(target) || target.protocol !== 'https:') throw unsupported();

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ApiError('TIMEOUT', '바깥 서비스가 제때 응답하지 않음'));
      }, timeoutMs);
    });

    const send = async (): Promise<Response> => {
      let res: Response;
      try {
        res = await deps.fetch(target.href, {
          ...init,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch {
        throw new ApiError('UPSTREAM_ERROR', '바깥 서비스에 연결하지 못함');
      }
      const { status } = res;
      if ((options.notFoundStatuses ?? [404]).includes(status)) throw notFound();
      if (status >= 300 && status < 400 && !options.acceptRedirect) {
        throw new ApiError(
          'UPSTREAM_ERROR',
          `바깥 서비스가 예상하지 못한 이동을 줌 (HTTP ${status})`,
        );
      }
      if (status >= 400) {
        throw new ApiError('UPSTREAM_ERROR', `바깥 서비스 오류 (HTTP ${status})`);
      }
      let body: ArrayBuffer;
      try {
        body = await res.arrayBuffer();
      } catch {
        throw new ApiError('UPSTREAM_ERROR', '바깥 서비스 응답을 끝까지 받지 못함');
      }
      return new Response(body.byteLength === 0 ? null : body, { status, headers: res.headers });
    };

    try {
      return await Promise.race([send(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

function httpDeps(request: Requester, options?: RequestOptions): HttpDeps {
  return {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      request(String(input), init ?? {}, options)) as typeof fetch,
    sleep,
  };
}

/** 짧은 링크의 이동을 최대 3번 따라가 짧은 링크가 아닌 분류에 닿는다. 이동 대상은 요청 전에 허용 목록으로 거른다. */
async function followRedirects(raw: string, request: Requester): Promise<LinkKind> {
  let link = classifyLink(raw);
  for (let hops = 0; link.kind === 'redirect'; hops += 1) {
    if (hops === MAX_REDIRECTS) throw unsupported();
    const current = new URL(link.url);
    // 처음 링크는 사용자가 붙여 넣은 값이라 http일 수 있다. 요청은 https로 올려 보낸다.
    current.protocol = 'https:';
    const userAgent = GOOGLE_SHORT_LINK_HOSTS.includes(current.hostname)
      ? GOOGLE_SHORT_LINK_USER_AGENT
      : BROWSER_USER_AGENT;
    const res = await request(
      current.href,
      { headers: { 'User-Agent': userAgent } },
      { acceptRedirect: true },
    );
    // 이동하지 않은 응답(예: 구글이 HTML을 준 경우)은 장소 링크로 풀 수 없다.
    if (res.status < 300 || res.status >= 400) throw unsupported();
    const location = res.headers.get('Location');
    if (location === null || location === '') {
      throw new ApiError('UPSTREAM_ERROR', '이동 응답에 Location이 없음');
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw unsupported();
    }
    // 이동 대상이 http면 허용 밖 이동과 같게 거절한다(https에서 http로 내려가지 않는다).
    if (!isAllowedUrl(next) || next.protocol !== 'https:') throw unsupported();
    link = classifyLink(next.href);
  }
  return link;
}

async function resolveNaverPlace(sid: string, request: Requester): Promise<ResolvedPlace> {
  try {
    const place = await fetchPlaceSummary(sid, httpDeps(request));
    return {
      kind: 'place',
      provider: 'naver',
      providerId: place.sid,
      name: place.name,
      address: place.address,
      lng: place.lng,
      lat: place.lat,
      category: place.category,
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // 본문이 JSON이 아니면 응답 형식이 바뀐 것이다.
    if (e instanceof SyntaxError) {
      throw new ApiError('UPSTREAM_ERROR', '네이버 장소 응답을 읽지 못함');
    }
    // 그 밖은 placeDetail·좌표가 없다는 뜻이다. 없는 ID도 200에 좌표 null로 온다.
    throw notFound();
  }
}

type Raw = Record<string, unknown>;

const asRecord = (value: unknown): Raw | undefined =>
  typeof value === 'object' && value !== null ? (value as Raw) : undefined;
const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

async function resolveKakaoPlace(kakaoId: string, request: Requester): Promise<ResolvedPlace> {
  // User-Agent가 없으면 406을 준다(2026-10-12 확인).
  const res = await request(`https://place-api.map.kakao.com/places/panel3/${kakaoId}`, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      pf: 'web',
      Referer: 'https://place.map.kakao.com/',
    },
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('UPSTREAM_ERROR', '카카오 장소 응답을 읽지 못함');
  }
  const summary = asRecord(asRecord(body)?.summary);
  const point = asRecord(summary?.point);
  const lng = Number(point?.lon);
  const lat = Number(point?.lat);
  if (!summary || point?.lon == null || point.lat == null || !isCoordinate(lng, lat)) {
    throw notFound();
  }
  const address = asRecord(summary.address);
  return {
    kind: 'place',
    provider: 'kakao',
    providerId: kakaoId,
    name: nonEmptyString(summary.name) ?? '',
    address: nonEmptyString(address?.disp) ?? nonEmptyString(address?.road) ?? '',
    lng,
    lat,
    category: nonEmptyString(asRecord(summary.category)?.name),
  };
}

function resolveGooglePlace(link: Extract<LinkKind, { kind: 'google-place' }>): ResolvedPlace {
  const location =
    link.lat !== null && link.lng !== null
      ? { lat: link.lat, lng: link.lng }
      : link.plusCode !== null
        ? decodePlusCode(link.plusCode)
        : null;
  if (location === null) {
    if (link.name === '') throw notFound();
    throw new ApiError('NOT_FOUND', '링크에 장소 위치가 없음', {
      reason: 'no-location',
      placeName: link.name,
    });
  }
  return {
    kind: 'place',
    provider: 'google',
    providerId: link.googleId,
    name: link.name,
    // 구글 링크에는 주소가 없다. 앱이 좌표로 주소를 채운다.
    address: '',
    lng: location.lng,
    lat: location.lat,
    category: null,
  };
}

export async function resolveLink(raw: string, deps: Deps): Promise<ResolvedPlace | FolderRef> {
  const request = makeRequester(deps);
  const link = await followRedirects(raw, request);
  switch (link.kind) {
    case 'naver-place':
      return resolveNaverPlace(link.sid, request);
    case 'naver-folder':
      return { kind: 'folder', shareId: link.shareId };
    case 'kakao-place':
      return resolveKakaoPlace(link.kakaoId, request);
    case 'google-place':
      return resolveGooglePlace(link);
    case 'redirect':
    case 'unsupported':
      throw unsupported();
  }
}

// 네이버 북마크는 빈 좌표(null·'')가 0으로 바뀌어 온다. 실제 장소가 정확히 0도에 있을 일은 없으니 0도 좌표 없음으로 본다.
function isCoordinate(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90 &&
    lng !== 0 &&
    lat !== 0
  );
}

export async function resolveFolder(shareId: string, deps: Deps): Promise<FolderResult> {
  if (!SHARE_ID.test(shareId)) throw unsupported();
  // 없는 공유 ID는 400(apiErrorCode 1603 "공유 정보가 존재하지 않습니다")으로 온다(2026-10-12 확인).
  const http = httpDeps(makeRequester(deps), { notFoundStatuses: [400, 404] });
  try {
    const folder = await fetchFolder(shareId, http, FOLDER_PAGE_SIZE, MAX_FOLDER_PLACES);
    return {
      folderName: folder.name,
      places: folder.bookmarks
        .filter((b) => b.available && isCoordinate(b.px, b.py) && SID_DIGITS.test(b.sid))
        .map((b) => ({
          sid: b.sid,
          name: b.name,
          address: b.address,
          lng: b.px,
          lat: b.py,
          memo: b.memo,
        })),
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof TooManyPlacesError) {
      throw new ApiError('TOO_MANY_PLACES', `폴더 장소가 ${MAX_FOLDER_PLACES}곳을 넘음`);
    }
    throw new ApiError('UPSTREAM_ERROR', '네이버 폴더 응답을 읽지 못함');
  }
}
