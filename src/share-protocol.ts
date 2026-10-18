import { LABEL_COLORS, type LabelColorName } from 'src/schema/label-colors';

/**
 * 내보낸 HTML(보기 화면)과 GitHub Pages의 지도 페이지가 iframe + postMessage로 주고받는 메시지 규약(v1, v2).
 * 두 쪽 모두 Effect·React 없이 번들되므로 `src/schema/label-colors.ts` 말고는 import하지 않는다.
 * 규약을 바꿀 때는 필드를 더하는 방식으로만 바꾼다(이미 보낸 파일이 계속 열려야 한다).
 *
 * 지도 페이지는 하나의 주소로 모든 파일(옛 파일 포함)을 받는다. 그래서 지도 페이지의 `ready`는
 * 앞으로도 늘 v1 봉투(`v: 1`)로 보내야 한다 — 이미 보낸 파일은 `v !== 1`인 메시지를 버리므로
 * 봉투 버전을 올리면 그 파일들의 지도가 시한(10초) 뒤 실패 안내로 바뀐다. 더 새 규약을 안다는 것은
 * `ready.maxV`로만 알리고, 파일이 그 값을 보고 새 버전을 쓸지 고른다.
 *
 * v2는 파일 → 지도 `draw`(Day 색 핀·경로선)를 더한다. 봉투 `v: 2`는 파일 → 지도에서만 쓰고,
 * `draw`는 v2 봉투에서만 유효하다. 지도 → 파일은 계속 v1 봉투만 받는다(`parseFromMap`).
 */

export const SHARE_SOURCE = 'tripmap-share';
/** 지도 → 파일 봉투와 v1 메시지의 버전. 지도 페이지는 늘 이 값으로 보낸다. */
export const SHARE_PROTOCOL_VERSION = 1;
/** 지도 페이지가 아는 가장 높은 규약. `ready.maxV`로 알린다. */
export const SHARE_PROTOCOL_MAX_VERSION = 2;

/** `draw` 검사 한도. 넘으면 메시지를 통째로 버린다. */
export const MAP_DRAW_LIMITS = {
  pins: 2000,
  lines: 2000,
  pointsPerLine: 1000,
  pointsTotal: 60_000,
  maxDay: 29,
} as const;

export type MapPlace = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  color: LabelColorName | null;
};

/**
 * 일정 지도의 핀(v2). 색은 지도 페이지가 정한다: `day`가 수면 Day 색, `null`이면 회색.
 * `endpoint`는 출발점·숙소(검정 테두리), `dim`은 다른 Day의 흐린 점(이름 없음, 맞추기 제외).
 * id는 Stop·후보·흐린 점이 장소 id, 출발점은 `start:<장소 id>`, 숙소는 `end:<장소 id>`.
 */
export type MapPin = {
  id: string;
  label: string;
  lng: number;
  lat: number;
  day: number | null;
  role: 'stop' | 'endpoint' | 'dim';
};

/** 일정 지도의 경로선(v2). `path`는 `[경도, 위도]`의 열이다. */
export type MapLine = { id: string; day: number; walk: boolean; path: [number, number][] };

/** 파일 → 지도 */
export type ToMap =
  | { kind: 'init'; places: MapPlace[] }
  | { kind: 'focus'; placeId: string | null }
  | { kind: 'filter'; placeIds: string[] }
  | { kind: 'draw'; pins: MapPin[]; lines: MapLine[] };

/** 지도 → 파일 */
export type FromMap =
  { kind: 'ready'; maxV: number } | { kind: 'select'; placeId: string } | { kind: 'tiles-failed' };

export type Envelope<T> = T & {
  source: typeof SHARE_SOURCE;
  v: 1 | 2;
};

/** 보내기 전에 봉투(`source`, `v`)를 붙인다. `v`는 기본 1이고, `draw`는 2로 보낸다. */
export function envelope<T extends ToMap | FromMap>(msg: T, v: 1 | 2 = 1): Envelope<T> {
  return { ...msg, source: SHARE_SOURCE, v };
}

type Rec = Record<string, unknown>;

function isRecord(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isLabelColor(x: unknown): x is LabelColorName {
  return typeof x === 'string' && (LABEL_COLORS as readonly string[]).includes(x);
}

function parseMapPlace(x: unknown): MapPlace | null {
  if (!isRecord(x)) return null;
  const { id, name, lng, lat, color } = x;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
  if (color !== null && !isLabelColor(color)) return null;
  // 아는 필드만 돌려준다(그 밖의 값은 지도 쪽 코드가 보지 못하게 한다).
  return { id, name, lng, lat, color };
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** 0~`maxDay`의 정수. */
function isDay(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= MAP_DRAW_LIMITS.maxDay;
}

const PIN_ROLES: readonly string[] = ['stop', 'endpoint', 'dim'];

function parseMapPin(x: unknown): MapPin | null {
  if (!isRecord(x)) return null;
  const { id, label, lng, lat, day, role } = x;
  if (typeof id !== 'string' || typeof label !== 'string') return null;
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
  if (day !== null && !isDay(day)) return null;
  if (typeof role !== 'string' || !PIN_ROLES.includes(role)) return null;
  return { id, label, lng, lat, day, role: role as MapPin['role'] };
}

/** `[경도, 위도]` 한 점. 길이가 정확히 2이고 둘 다 유한한 수. */
function parsePoint(x: unknown): [number, number] | null {
  if (!Array.isArray(x) || x.length !== 2) return null;
  const [lng, lat] = x as unknown[];
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
  return [lng, lat];
}

/** 선 하나를 검사한다. `budget`은 아직 받을 수 있는 전체 점 수이고, 쓴 만큼 줄여 돌려준다. */
function parseMapLine(x: unknown, budget: number): { line: MapLine; used: number } | null {
  if (!isRecord(x)) return null;
  const { id, day, walk, path } = x;
  if (typeof id !== 'string' || !isDay(day) || typeof walk !== 'boolean') return null;
  // 점을 훑기 전에 길이로 먼저 거른다(아주 긴 배열을 돌지 않는다).
  if (!Array.isArray(path) || path.length > MAP_DRAW_LIMITS.pointsPerLine || path.length > budget) {
    return null;
  }
  const points: [number, number][] = [];
  for (const raw of path as unknown[]) {
    const point = parsePoint(raw);
    if (point === null) return null;
    points.push(point);
  }
  return { line: { id, day, walk, path: points }, used: points.length };
}

function parseDraw(msg: Rec): ToMap | null {
  const { pins: rawPins, lines: rawLines } = msg;
  if (!Array.isArray(rawPins) || rawPins.length > MAP_DRAW_LIMITS.pins) return null;
  if (!Array.isArray(rawLines) || rawLines.length > MAP_DRAW_LIMITS.lines) return null;
  const pins: MapPin[] = [];
  for (const raw of rawPins as unknown[]) {
    const pin = parseMapPin(raw);
    if (pin === null) return null;
    pins.push(pin);
  }
  const lines: MapLine[] = [];
  let budget: number = MAP_DRAW_LIMITS.pointsTotal;
  for (const raw of rawLines as unknown[]) {
    const parsed = parseMapLine(raw, budget);
    if (parsed === null) return null;
    budget -= parsed.used;
    lines.push(parsed.line);
  }
  return { kind: 'draw', pins, lines };
}

/**
 * 봉투를 확인하고 본문(`kind`가 든 객체)을 돌려준다. 맞지 않으면 null. 던지지 않는다.
 * 돌려주는 본문에 `v`가 들어 있으니 호출한 쪽이 버전별 규칙을 확인한다.
 */
function openEnvelope(data: unknown, versions: readonly number[]): Rec | null {
  try {
    if (!isRecord(data)) return null;
    if (data.source !== SHARE_SOURCE) return null;
    const v = data.v;
    if (typeof v !== 'number' || !versions.includes(v)) return null;
    return data;
  } catch {
    // 접근자가 던지는 객체 등
    return null;
  }
}

/** 파일 → 지도 메시지를 검사한다. 봉투 없는 메시지를 돌려주고, 잘못된 것은 null. */
export function parseToMap(data: unknown): ToMap | null {
  try {
    const msg = openEnvelope(data, [1, 2]);
    if (msg === null) return null;
    switch (msg.kind) {
      case 'init': {
        if (!Array.isArray(msg.places)) return null;
        const places: MapPlace[] = [];
        for (const raw of msg.places) {
          const p = parseMapPlace(raw);
          if (p === null) return null;
          places.push(p);
        }
        return { kind: 'init', places };
      }
      case 'focus': {
        const { placeId } = msg;
        if (placeId !== null && typeof placeId !== 'string') return null;
        return { kind: 'focus', placeId };
      }
      case 'filter': {
        const { placeIds } = msg;
        if (!Array.isArray(placeIds) || !placeIds.every((id) => typeof id === 'string')) {
          return null;
        }
        return { kind: 'filter', placeIds: [...(placeIds as string[])] };
      }
      case 'draw':
        // v2 봉투에서만 유효하다.
        return msg.v === 2 ? parseDraw(msg) : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** 지도 → 파일 메시지를 검사한다. 봉투 없는 메시지를 돌려주고, 잘못된 것은 null. */
export function parseFromMap(data: unknown): FromMap | null {
  try {
    const msg = openEnvelope(data, [SHARE_PROTOCOL_VERSION]);
    if (msg === null) return null;
    switch (msg.kind) {
      case 'ready': {
        const { maxV } = msg;
        if (typeof maxV !== 'number' || !Number.isFinite(maxV)) return null;
        return { kind: 'ready', maxV };
      }
      case 'select': {
        const { placeId } = msg;
        if (typeof placeId !== 'string') return null;
        return { kind: 'select', placeId };
      }
      case 'tiles-failed':
        return { kind: 'tiles-failed' };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
