// 네이버 자동완성의 장소 결과만 정리한다. Cloudflare 함수에서 상대 경로로 가져온다.
import { ApiError } from './http';
import { BROWSER_USER_AGENT, makeRequester, type Deps } from './request';
import { parseCoordinate } from './route';

export type SearchQuery = { q: string; near?: [number, number] };
export type SearchResult = {
  name: string;
  address: string;
  category: string;
  lng: number;
  lat: number;
};
export function parseSearchQuery(url: URL): SearchQuery {
  const q = (url.searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ');
  if (q.length < 1 || q.length > 40) throw new ApiError('BAD_REQUEST', '검색어는 1~40자입니다');
  const near = url.searchParams.get('near');
  return { q, ...(near === null ? {} : { near: parseCoordinate(near, 'near') }) };
}
export function searchInputKey(q: SearchQuery): string {
  const params = new URLSearchParams({ q: q.q });
  if (q.near !== undefined) params.set('near', q.near.map((n) => n.toFixed(5)).join(','));
  return params.toString();
}
export function parseSearchInputKey(input: string): SearchQuery {
  return parseSearchQuery(new URL(`https://cache.landmark/?${input}`));
}
const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const badResponse = () => new ApiError('UPSTREAM_ERROR', '네이버 검색 응답을 읽지 못함');
const DEFAULT_NEAR: [number, number] = [126.9784, 37.5666];
export async function resolveSearch(
  query: SearchQuery,
  deps: Deps,
): Promise<{ results: SearchResult[] }> {
  // 네이버는 `coords`가 없으면 HTTP 500을 준다(2026-10-24 확인). 주변 좌표가 없으면 서울시청 근처로 묻는다.
  const near = query.near ?? DEFAULT_NEAR;
  const params = new URLSearchParams({
    query: query.q,
    coords: [near[1], near[0]].map((n) => n.toFixed(5)).join(','),
  });
  const response = await makeRequester(deps)(
    `https://map.naver.com/p/api/search/instant-search?${params}`,
    { headers: { 'User-Agent': BROWSER_USER_AGENT, Referer: 'https://map.naver.com/' } },
    { notFoundStatuses: [] },
  );
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw badResponse();
  }
  const body = record(json);
  if (body === null || !Array.isArray(body.place)) throw badResponse();
  const results: SearchResult[] = [];
  for (const value of body.place) {
    const p = record(value);
    if (p === null || typeof p.title !== 'string' || p.title.trim() === '') continue;
    if (
      (typeof p.x !== 'string' && typeof p.x !== 'number') ||
      (typeof p.y !== 'string' && typeof p.y !== 'number') ||
      String(p.x).trim() === '' ||
      String(p.y).trim() === ''
    )
      continue;
    const lng = Number(p.x),
      lat = Number(p.y);
    if (!(lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39)) continue;
    results.push({
      name: p.title,
      address:
        typeof p.roadAddress === 'string' && p.roadAddress !== ''
          ? p.roadAddress
          : typeof p.jibunAddress === 'string'
            ? p.jibunAddress
            : '',
      category: typeof p.ctg === 'string' ? p.ctg : '',
      lng,
      lat,
    });
    if (results.length === 10) break;
  }
  return { results };
}
