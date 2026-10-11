import { LABEL_COLORS } from 'src/schema/label-colors';
import type { ShareDoc, ShareLabel, SharePlace } from 'src/schema/share';

/**
 * 보기 화면이 데이터 블록을 읽고 검사한다. Effect를 번들에 넣지 않으려고 `src/schema/share.ts`의
 * 스키마 대신 손으로 검사한다(타입만 import). 형식이 조금이라도 다르면 null이다.
 */

type Rec = Record<string, unknown>;

function isRecord(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function parseLabel(x: unknown): ShareLabel | null {
  if (!isRecord(x)) return null;
  const { id, name, color, order } = x;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  if (typeof color !== 'string' || !(LABEL_COLORS as readonly string[]).includes(color))
    return null;
  if (!isFiniteNumber(order)) return null;
  return { id, name, color: color as ShareLabel['color'], order };
}

function parsePlace(x: unknown): SharePlace | null {
  if (!isRecord(x)) return null;
  const { id, name, address, lng, lat, labelIds, memo, naverSid } = x;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof address !== 'string')
    return null;
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
  if (!Array.isArray(labelIds) || !labelIds.every((v) => typeof v === 'string')) return null;
  if (memo !== undefined && typeof memo !== 'string') return null;
  if (naverSid !== undefined && typeof naverSid !== 'string') return null;
  const place: SharePlace = { id, name, address, lng, lat, labelIds: [...(labelIds as string[])] };
  if (memo !== undefined) place.memo = memo;
  if (naverSid !== undefined) place.naverSid = naverSid;
  return place;
}

/** 값이 `ShareDoc` 형식이면 돌려주고, 아니면 null. 던지지 않는다. */
export function parseShareDoc(value: unknown): ShareDoc | null {
  if (!isRecord(value)) return null;
  const { format, version, title, createdAt, labels, places } = value;
  if (format !== 'tripmap-share' || version !== 1) return null;
  if (typeof title !== 'string' || typeof createdAt !== 'string') return null;
  if (!Array.isArray(labels) || !Array.isArray(places)) return null;

  const parsedLabels: ShareLabel[] = [];
  for (const raw of labels) {
    const label = parseLabel(raw);
    if (label === null) return null;
    parsedLabels.push(label);
  }
  const parsedPlaces: SharePlace[] = [];
  for (const raw of places) {
    const place = parsePlace(raw);
    if (place === null) return null;
    parsedPlaces.push(place);
  }
  return {
    format: 'tripmap-share',
    version: 1,
    title,
    createdAt,
    labels: parsedLabels,
    places: parsedPlaces,
  };
}

/** `<script type="application/json" id="tripmap-share">`의 내용을 읽는다. 없거나 깨졌으면 null. */
export function readShareDoc(doc: Document): ShareDoc | null {
  try {
    const text = doc.getElementById('tripmap-share')?.textContent;
    if (text === null || text === undefined) return null;
    return parseShareDoc(JSON.parse(text));
  } catch {
    return null;
  }
}
