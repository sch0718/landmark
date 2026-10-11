import { LABEL_COLORS, type LabelColorName } from 'src/schema/label-colors';

/**
 * 내보낸 HTML(보기 화면)과 GitHub Pages의 지도 페이지가 iframe + postMessage로 주고받는 메시지 규약 v1.
 * 두 쪽 모두 Effect·React 없이 번들되므로 `src/schema/label-colors.ts` 말고는 import하지 않는다.
 * 규약을 바꿀 때는 필드를 더하는 방식으로만 바꾼다(이미 보낸 파일이 계속 열려야 한다).
 *
 * 지도 페이지는 하나의 주소로 모든 파일(옛 파일 포함)을 받는다. 그래서 지도 페이지의 `ready`는
 * 앞으로도 늘 v1 봉투(`v: 1`)로 보내야 한다 — 이미 보낸 파일은 `v !== 1`인 메시지를 버리므로
 * 봉투 버전을 올리면 그 파일들의 지도가 시한(10초) 뒤 실패 안내로 바뀐다. 더 새 규약을 안다는 것은
 * `ready.maxV`로만 알리고, 파일이 그 값을 보고 새 버전을 쓸지 고른다.
 */

export const SHARE_SOURCE = 'tripmap-share';
export const SHARE_PROTOCOL_VERSION = 1;

export type MapPlace = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  color: LabelColorName | null;
};

/** 파일 → 지도 */
export type ToMap =
  | { kind: 'init'; places: MapPlace[] }
  | { kind: 'focus'; placeId: string | null }
  | { kind: 'filter'; placeIds: string[] };

/** 지도 → 파일 */
export type FromMap =
  { kind: 'ready'; maxV: number } | { kind: 'select'; placeId: string } | { kind: 'tiles-failed' };

export type Envelope<T> = T & {
  source: typeof SHARE_SOURCE;
  v: typeof SHARE_PROTOCOL_VERSION;
};

/** 보내기 전에 봉투(`source`, `v`)를 붙인다. */
export function envelope<T extends ToMap | FromMap>(msg: T): Envelope<T> {
  return { ...msg, source: SHARE_SOURCE, v: SHARE_PROTOCOL_VERSION };
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
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (color !== null && !isLabelColor(color)) return null;
  // 아는 필드만 돌려준다(그 밖의 값은 지도 쪽 코드가 보지 못하게 한다).
  return { id, name, lng, lat, color };
}

/** 봉투를 확인하고 본문(`kind`가 든 객체)을 돌려준다. 맞지 않으면 null. 던지지 않는다. */
function openEnvelope(data: unknown): Rec | null {
  try {
    if (!isRecord(data)) return null;
    if (data.source !== SHARE_SOURCE || data.v !== SHARE_PROTOCOL_VERSION) return null;
    return data;
  } catch {
    // 접근자가 던지는 객체 등
    return null;
  }
}

/** 파일 → 지도 메시지를 검사한다. 봉투 없는 메시지를 돌려주고, 잘못된 것은 null. */
export function parseToMap(data: unknown): ToMap | null {
  try {
    const msg = openEnvelope(data);
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
    const msg = openEnvelope(data);
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
