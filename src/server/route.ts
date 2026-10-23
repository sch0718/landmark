// 네이버 자동차·도보·대중교통 길찾기를 앱이 쓰기 좋은 모양으로 정리한다(스펙 §4.1).
// Cloudflare 서버 함수에서도 쓰므로 상대 경로 import만 쓰고 브라우저·React 코드를 끌어오지 않는다.
import { haversineM } from '../domain/trips/geo';
import { ApiError } from './http';
import { BROWSER_USER_AGENT, makeRequester, type Deps } from './request';
import { simplifyPath } from './simplify';

export type RouteMode = 'car' | 'walk' | 'transit';
export type RouteQuery = {
  mode: RouteMode;
  from: [number, number];
  to: [number, number];
  at?: string;
};
export type RouteResult = {
  mode: RouteMode;
  distanceM: number;
  durationS: number;
  tollFare: number | null;
  fare?: number | null;
  transfers?: number;
  walkS?: number;
  path: [number, number][];
  /** 조회한 시각(ISO 8601). 자동차 시간은 이 시점의 교통 기준이다. */
  queriedAt: string;
};

const MAX_PATH_POINTS = 200;
const WALK_MAX_STRAIGHT_M = 50_000;
const LNG_RANGE = [124, 132] as const;
const LAT_RANGE = [33, 39] as const;
const COORDINATE = /^-?\d+(?:\.\d+)?$/;
const INPUT_KEY =
  /^(car|walk|transit):(?:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):)?(-?\d+\.\d{5}),(-?\d+\.\d{5})>(-?\d+\.\d{5}),(-?\d+\.\d{5})$/;

const badRequest = (message: string) => new ApiError('BAD_REQUEST', message);
const noRoute = () => new ApiError('NO_ROUTE', '경로를 찾지 못함');
const badResponse = () => new ApiError('UPSTREAM_ERROR', '네이버 경로 응답을 읽지 못함');

export function parseCoordinate(raw: string | null, name: string): [number, number] {
  const parts = (raw ?? '').split(',');
  if (parts.length !== 2 || !parts.every((part) => COORDINATE.test(part))) {
    throw badRequest(`${name} 좌표 형식이 틀림`);
  }
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (lng < LNG_RANGE[0] || lng > LNG_RANGE[1] || lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) {
    throw badRequest(`${name} 좌표가 한국 범위 밖`);
  }
  return [lng, lat];
}

/** `mode=car|walk|transit&from=경도,위도&to=경도,위도`를 읽는다. 대중교통만 출발 시각 `at`을 받는다. 형식이 틀리거나 한국 범위 밖이면 BAD_REQUEST. */
export function parseRouteQuery(url: URL): RouteQuery {
  const mode = url.searchParams.get('mode');
  if (mode !== 'car' && mode !== 'walk' && mode !== 'transit')
    throw badRequest('mode는 car, walk 또는 transit');
  const at = url.searchParams.get('at');
  if (mode === 'transit') floorTransitAt(at ?? '');
  else if (at !== null) throw badRequest('대중교통만 출발 시각을 씁니다');
  return {
    mode,
    ...(mode === 'transit' ? { at: at! } : {}),
    from: parseCoordinate(url.searchParams.get('from'), 'from'),
    to: parseCoordinate(url.searchParams.get('to'), 'to'),
  };
}

const fixed = ([lng, lat]: [number, number]) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

/** 질의를 정규화한 입력 키. 캐시 키와 `resolve` 입력으로 쓴다. 좌표는 소수 5자리(약 1m)로 맞춘다. */
export function routeInputKey(q: RouteQuery): string {
  const prefix = q.mode === 'transit' ? `transit:${floorTransitAt(q.at ?? '')}` : q.mode;
  return `${prefix}:${fixed(q.from)}>${fixed(q.to)}`;
}

/** `routeInputKey`가 만든 키를 다시 질의로 푼다. */
export function parseRouteInputKey(input: string): RouteQuery {
  const m = INPUT_KEY.exec(input);
  if (m === null) throw badRequest('경로 입력 키 형식이 틀림');
  const params = new URLSearchParams({
    mode: m[1]!,
    from: `${m[3]},${m[4]}`,
    to: `${m[5]},${m[6]}`,
  });
  if (m[2] !== undefined) params.set('at', m[2]);
  return parseRouteQuery(new URL(`https://cache.landmark/?${params}`));
}

/** 한국 시각의 실제 날짜·시각을 확인하고 10분 단위로 내린다. */
export function floorTransitAt(at: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(at))
    throw badRequest('출발 시각 형식이 틀림');
  const date = at.slice(0, 10);
  const instant = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== date)
    throw badRequest('실제 달력 날짜가 아님');
  return at.slice(0, 15) + '0';
}

type Raw = Record<string, unknown>;
const asRecord = (value: unknown): Raw | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : undefined;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function toPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lng, lat] = value as unknown[];
  return isFiniteNumber(lng) && isFiniteNumber(lat) ? [lng, lat] : null;
}

/** 연속으로 같은 점은 한 번만 남긴다. */
function dropRepeated(points: [number, number][]): [number, number][] {
  return points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1],
  );
}

function summaryOf(route: Raw): { distanceM: number; duration: number; tollFare: number | null } {
  const summary = asRecord(route.summary);
  if (!summary || !isFiniteNumber(summary.distance) || !isFiniteNumber(summary.duration)) {
    throw badResponse();
  }
  return {
    distanceM: summary.distance,
    duration: summary.duration,
    tollFare: isFiniteNumber(summary.tollFare) ? summary.tollFare : null,
  };
}

function parseCar(body: Raw): Omit<RouteResult, 'mode' | 'queriedAt'> {
  const options = asRecord(body.route);
  // `route`가 객체가 아니면 응답 모양이 바뀐 것이다. 객체인데 쓸 결과가 없으면 경로 없음이다.
  if (!options) throw badResponse();
  // 옵션 키(`3,0,0,0,0,0` 등)는 요청에 따라 달라질 수 있어 첫 번째 결과를 쓴다.
  const first = Object.values(options).find((v) => Array.isArray(v) && v.length > 0);
  const route = asRecord((first as unknown[] | undefined)?.[0]);
  if (!route) throw noRoute();
  const { distanceM, duration, tollFare } = summaryOf(route);
  const raw = Array.isArray(route.path) ? route.path : [];
  const points = raw.map(toPoint).filter((p): p is [number, number] => p !== null);
  return {
    distanceM,
    // 자동차 시간은 밀리초다.
    durationS: Math.round(duration / 1000),
    tollFare,
    path: simplifyPath(dropRepeated(points), MAX_PATH_POINTS),
  };
}

function parseWalk(body: Raw): Omit<RouteResult, 'mode' | 'queriedAt'> {
  const routes = body.routes;
  // `routes`가 배열이 아니면 응답 모양이 바뀐 것이다. 빈 배열은 경로 없음이다.
  if (!Array.isArray(routes)) throw badResponse();
  const route = asRecord(routes[0]);
  if (!route) throw noRoute();
  const { distanceM, duration } = summaryOf(route);
  const legs = Array.isArray(route.legs) ? route.legs : [];
  const steps = asRecord(legs[0])?.steps;
  const points: [number, number][] = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    const path = asRecord(step)?.path;
    // 첫 단계 등은 경로선이 `null`이다.
    if (typeof path !== 'string') continue;
    for (const pair of path.split(' ')) {
      // `",37.1"`처럼 한쪽이 빈 쌍이 `Number('')`=0으로 읽히지 않도록 형식부터 본다.
      const parts = pair.split(',');
      if (parts.length !== 2 || !parts.every((part) => COORDINATE.test(part))) continue;
      const point = toPoint(parts.map(Number));
      if (point) points.push(point);
    }
  }
  return {
    distanceM,
    // 도보 시간은 초 그대로다.
    durationS: duration,
    tollFare: null,
    path: simplifyPath(dropRepeated(points), MAX_PATH_POINTS),
  };
}

function parseTransit(body: Raw): Omit<RouteResult, 'mode' | 'queriedAt'> {
  if (!Array.isArray(body.paths)) throw badResponse();
  if (body.paths.length === 0) throw noRoute();
  const path = asRecord(body.paths[0]);
  if (!path) throw badResponse();
  const { distance, duration, walkingDuration, transferCount, fare } = path;
  if (
    ![distance, duration, walkingDuration, transferCount].every(
      (v) => isFiniteNumber(v) && v >= 0,
    ) ||
    !Number.isInteger(transferCount) ||
    (fare !== null && fare !== undefined && (!isFiniteNumber(fare) || fare < 0))
  )
    throw badResponse();
  return {
    distanceM: distance as number,
    durationS: (duration as number) * 60,
    tollFare: null,
    fare: isFiniteNumber(fare) ? fare : null,
    transfers: transferCount as number,
    walkS: (walkingDuration as number) * 60,
    path: [],
  };
}

function naverUrl(q: RouteQuery): string {
  const from = fixed(q.from);
  const to = fixed(q.to);
  if (q.mode === 'transit') {
    const params = new URLSearchParams({
      start: from,
      goal: to,
      crs: 'EPSG:4326',
      mode: 'TIME',
      lang: 'ko',
      departureTime: floorTransitAt(q.at ?? ''),
    });
    return `https://map.naver.com/p/api/directions/pubtrans?${params}`;
  }
  return q.mode === 'car'
    ? `https://map.naver.com/p/api/directions/car?start=${from}&goal=${to}`
    : `https://map.naver.com/p/api/directions/walk?o=all&l=${from};${to}&lang=ko`;
}

export async function resolveRoute(
  q: RouteQuery,
  deps: Deps & { now?: () => Date },
): Promise<RouteResult> {
  // 직선 50km를 넘는 도보는 네이버가 `code: 4`를 주니 묻지 않는다.
  if (q.mode === 'walk' && haversineM(q.from, q.to) > WALK_MAX_STRAIGHT_M) {
    throw noRoute();
  }
  const request = makeRequester(deps);
  // 404는 이쪽 요청이 틀렸다는 뜻이라 NOT_FOUND가 아니라 UPSTREAM_ERROR로 둔다.
  const res = await request(
    naverUrl(q),
    { headers: { 'User-Agent': BROWSER_USER_AGENT, Referer: 'https://map.naver.com/' } },
    { notFoundStatuses: [] },
  );
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw badResponse();
  }
  const body = asRecord(parsed);
  if (!body) throw badResponse();
  // 본문 `code`가 0이 아니면 HTTP 200이어도 경로가 없다. 도보 성공 응답에는 `code`가 없다.
  if (body.code !== undefined) {
    // 숫자가 아닌 `code`("0"·null 등)는 모양이 바뀐 것이다.
    if (!isFiniteNumber(body.code)) throw badResponse();
    if (body.code !== 0) throw noRoute();
  }
  if (q.mode === 'transit' && body.status === 'POINTS_ARE_TOO_CLOSE') {
    const walk = await resolveRoute({ mode: 'walk', from: q.from, to: q.to }, deps);
    return { ...walk, mode: 'transit', fare: 0, transfers: 0, walkS: walk.durationS, path: [] };
  }
  const result =
    q.mode === 'car' ? parseCar(body) : q.mode === 'walk' ? parseWalk(body) : parseTransit(body);
  return { mode: q.mode, ...result, queriedAt: (deps.now?.() ?? new Date()).toISOString() };
}
