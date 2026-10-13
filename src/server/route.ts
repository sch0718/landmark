// 네이버 자동차·도보 길찾기를 앱이 쓰기 좋은 모양으로 정리한다(스펙 §4.1).
// Cloudflare 서버 함수에서도 쓰므로 상대 경로 import만 쓰고 브라우저·React 코드를 끌어오지 않는다.
import { ApiError } from './http';
import { BROWSER_USER_AGENT, makeRequester, type Deps } from './request';
import { simplifyPath } from './simplify';

export type RouteMode = 'car' | 'walk';
export type RouteQuery = { mode: RouteMode; from: [number, number]; to: [number, number] };
export type RouteResult = {
  mode: RouteMode;
  distanceM: number;
  durationS: number;
  tollFare: number | null;
  path: [number, number][];
  /** 조회한 시각(ISO 8601). 자동차 시간은 이 시점의 교통 기준이다. */
  queriedAt: string;
};

const MAX_PATH_POINTS = 200;
const WALK_MAX_STRAIGHT_M = 50_000;
const EARTH_RADIUS_M = 6_371_000;
const LNG_RANGE = [124, 132] as const;
const LAT_RANGE = [33, 39] as const;
const COORDINATE = /^-?\d+(?:\.\d+)?$/;
const INPUT_KEY = /^(car|walk):(-?\d+\.\d{5}),(-?\d+\.\d{5})>(-?\d+\.\d{5}),(-?\d+\.\d{5})$/;

const badRequest = (message: string) => new ApiError('BAD_REQUEST', message);
const noRoute = () => new ApiError('NO_ROUTE', '경로를 찾지 못함');
const badResponse = () => new ApiError('UPSTREAM_ERROR', '네이버 경로 응답을 읽지 못함');

function parseCoordinate(raw: string | null, name: string): [number, number] {
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

/** `mode=car|walk&from=경도,위도&to=경도,위도`를 읽는다. 형식이 틀리거나 한국 범위 밖이면 BAD_REQUEST. */
export function parseRouteQuery(url: URL): RouteQuery {
  const mode = url.searchParams.get('mode');
  if (mode !== 'car' && mode !== 'walk') throw badRequest('mode는 car 또는 walk');
  return {
    mode,
    from: parseCoordinate(url.searchParams.get('from'), 'from'),
    to: parseCoordinate(url.searchParams.get('to'), 'to'),
  };
}

const fixed = ([lng, lat]: [number, number]) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

/** 질의를 정규화한 입력 키. 캐시 키와 `resolve` 입력으로 쓴다. 좌표는 소수 5자리(약 1m)로 맞춘다. */
export function routeInputKey(q: RouteQuery): string {
  return `${q.mode}:${fixed(q.from)}>${fixed(q.to)}`;
}

/** `routeInputKey`가 만든 키를 다시 질의로 푼다. */
export function parseRouteInputKey(input: string): RouteQuery {
  const m = INPUT_KEY.exec(input);
  if (m === null) throw badRequest('경로 입력 키 형식이 틀림');
  return {
    mode: m[1] as RouteMode,
    from: [Number(m[2]), Number(m[3])],
    to: [Number(m[4]), Number(m[5])],
  };
}

/** 두 좌표의 직선거리(m, 하버사인). */
function straightDistanceM(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
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

function naverUrl(q: RouteQuery): string {
  const from = fixed(q.from);
  const to = fixed(q.to);
  return q.mode === 'car'
    ? `https://map.naver.com/p/api/directions/car?start=${from}&goal=${to}`
    : `https://map.naver.com/p/api/directions/walk?o=all&l=${from};${to}&lang=ko`;
}

export async function resolveRoute(
  q: RouteQuery,
  deps: Deps & { now?: () => Date },
): Promise<RouteResult> {
  // 직선 50km를 넘는 도보는 네이버가 `code: 4`를 주니 묻지 않는다.
  if (q.mode === 'walk' && straightDistanceM(q.from, q.to) > WALK_MAX_STRAIGHT_M) {
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
  const result = q.mode === 'car' ? parseCar(body) : parseWalk(body);
  return { mode: q.mode, ...result, queriedAt: (deps.now?.() ?? new Date()).toISOString() };
}
