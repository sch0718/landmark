export type Bookmark = {
  sid: string;
  name: string;
  address: string;
  px: number;
  py: number;
  memo: string;
  mcidName: string | null;
  creationTime: number;
  lastUpdateTime: number;
  available: boolean;
};

export type FetchedFolder = { shareId: string; name: string; bookmarks: Bookmark[] };

export type HttpDeps = { fetch: typeof fetch; sleep: (ms: number) => Promise<void> };

export type RouteResult = {
  distanceM: number;
  durationMs: number;
  staticDurationMs: number;
  tollFare: number;
  path: [number, number][];
};

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// Node fetch 기본값(`*`)이면 네이버가 장소 이름을 영어로 준다. 한국어 이름을 받으려면 명시한다.
const ACCEPT_LANGUAGE = 'ko-KR,ko;q=0.9';
const REQUEST_GAP_MS = 300;

type Raw = Record<string, unknown>;

async function getJson(url: string, referer: string, deps: HttpDeps): Promise<unknown> {
  // Origin 헤더를 넣으면 폴더 API가 403을 준다. 절대 추가하지 않는다.
  const res = await deps.fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': ACCEPT_LANGUAGE, Referer: referer },
  });
  if (!res.ok) throw new Error(`네이버 요청 실패: HTTP ${res.status} (${url})`);
  return res.json();
}

function toBookmark(raw: Raw): Bookmark {
  const mcid = raw.mcidName;
  return {
    sid: String(raw.sid),
    name: String(raw.name ?? ''),
    address: String(raw.address ?? ''),
    px: Number(raw.px),
    py: Number(raw.py),
    memo: typeof raw.memo === 'string' ? raw.memo : '',
    mcidName: typeof mcid === 'string' && mcid !== '' ? mcid : null,
    creationTime: Number(raw.creationTime),
    lastUpdateTime: Number(raw.lastUpdateTime),
    available: raw.available === true,
  };
}

export async function fetchFolder(
  shareId: string,
  deps: HttpDeps,
  pageSize = 500,
): Promise<FetchedFolder> {
  const base = `https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/${shareId}/bookmarks`;
  const referer = `https://pages.map.naver.com/save-pages/detail-list/${shareId}`;
  const bookmarks: Bookmark[] = [];
  let name = '';
  for (let start = 0; ; start += pageSize) {
    if (start > 0) await deps.sleep(REQUEST_GAP_MS);
    const body = (await getJson(`${base}?start=${start}&limit=${pageSize}`, referer, deps)) as Raw;
    const list = body.bookmarkList;
    if (!Array.isArray(list)) {
      throw new Error(
        `네이버 폴더 응답에 bookmarkList가 없음 (shareId=${shareId}, start=${start})`,
      );
    }
    if (start === 0) name = String((body.folder as Raw | undefined)?.name ?? '');
    bookmarks.push(...list.map((b) => toBookmark(b as Raw)));
    if (list.length < pageSize) break;
  }
  return { shareId, name, bookmarks };
}

export async function fetchCarRoute(
  start: [number, number],
  goal: [number, number],
  deps: HttpDeps,
): Promise<RouteResult> {
  const url = `https://map.naver.com/p/api/directions/car?start=${start[0]},${start[1]}&goal=${goal[0]},${goal[1]}`;
  const body = (await getJson(url, 'https://map.naver.com/', deps)) as Raw;
  const route = body.route as Record<string, unknown> | undefined;
  const firstKey = route ? Object.keys(route)[0] : undefined;
  const first = firstKey === undefined ? undefined : (route?.[firstKey] as Raw[] | undefined)?.[0];
  if (!first) {
    throw new Error(
      `네이버 경로 응답에 route가 없음 (code=${String(body.code)}, message=${String(body.message)})`,
    );
  }
  const summary = first.summary as Raw;
  return {
    distanceM: Number(summary.distance),
    durationMs: Number(summary.duration),
    staticDurationMs: Number(summary.staticDuration),
    tollFare: Number(summary.tollFare),
    path: first.path as [number, number][],
  };
}

export type NaverPlace = {
  sid: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  category: string | null;
};

/** 네이버 장소 ID(sid) 하나의 이름·주소·좌표·분류. 저장 폴더 없이 장소를 지정할 때 쓴다. */
export async function fetchPlaceSummary(sid: string, deps: HttpDeps): Promise<NaverPlace> {
  const url = `https://map.naver.com/p/api/place/summary/${sid}`;
  const body = (await getJson(url, 'https://map.naver.com/', deps)) as Raw;
  const detail = (body.data as Raw | undefined)?.placeDetail as Raw | undefined;
  if (!detail) throw new Error(`네이버 장소 응답에 placeDetail이 없음 (sid=${sid})`);
  const coordinate = detail.coordinate as Raw | undefined;
  const lng = Number(coordinate?.longitude);
  const lat = Number(coordinate?.latitude);
  if (
    coordinate === undefined ||
    coordinate.longitude == null ||
    coordinate.latitude == null ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat)
  ) {
    throw new Error(`네이버 장소 응답에 좌표가 없음 (sid=${sid})`);
  }
  const address = (detail.address ?? {}) as Raw;
  const category = (detail.category as Raw | undefined)?.category;
  const road = typeof address.roadAddress === 'string' ? address.roadAddress : '';
  return {
    sid,
    name: String(detail.name ?? ''),
    address: road !== '' ? road : String(address.address ?? ''),
    lng,
    lat,
    category: typeof category === 'string' && category !== '' ? category : null,
  };
}
