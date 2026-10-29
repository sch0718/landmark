import {
  FolderLinkSchema,
  LabelSchema,
  PlaceSchema,
  type FolderLink,
  type Label,
  type Library,
  type Place,
} from 'src/schema/library';
import { checkMeeting, MeetingSchema, type Meeting } from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';
import { checkTrip, TripSchema, type Trip } from 'src/schema/trip';

export const ITEM_KINDS = ['label', 'place', 'folder', 'trip', 'meeting'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type ItemDocOf = {
  label: Label;
  place: Place;
  folder: FolderLink;
  trip: Trip;
  meeting: Meeting;
};
export type AnyItem = ItemDocOf[ItemKind];
export type ItemKey = `${ItemKind}:${string}`;
export type ItemEntry = { key: ItemKey; kind: ItemKind; id: string; doc: AnyItem };

const COLLECTIONS = {
  label: 'labels',
  place: 'places',
  folder: 'folders',
  trip: 'trips',
  meeting: 'meetings',
} as const;

export function itemKey(kind: ItemKind, id: string): ItemKey {
  return `${kind}:${id}`;
}

export function parseItemKey(key: string): { kind: ItemKind; id: string } | null {
  const colon = key.indexOf(':');
  const kind = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if (colon < 0 || !id || !ITEM_KINDS.some((known) => known === kind)) return null;
  return { kind: kind as ItemKind, id };
}

export function listItems(lib: Library): ItemEntry[] {
  return ITEM_KINDS.flatMap((kind) =>
    Object.entries(lib[COLLECTIONS[kind]] ?? {})
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, doc]) => ({ key: itemKey(kind, id), kind, id, doc })),
  );
}

export function getItem(lib: Library, kind: ItemKind, id: string): AnyItem | undefined {
  const collection = lib[COLLECTIONS[kind]];
  return collection && Object.hasOwn(collection, id) ? collection[id] : undefined;
}

export function putItems(
  lib: Library,
  entries: readonly { kind: ItemKind; id: string; doc: AnyItem }[],
): Library {
  let result = lib;
  const copies = new Set<string>();
  for (const { kind, id, doc } of entries) {
    if (getItem(result, kind, id) === doc) continue;
    const key = COLLECTIONS[kind];
    if (!copies.has(key)) {
      result = { ...result, [key]: { ...result[key] } };
      copies.add(key);
    }
    // 외부 id가 객체의 프로토타입을 바꾸지 못하도록 자체 속성으로 넣는다.
    Object.defineProperty(result[key], id, {
      value: doc,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

export function removeItems(lib: Library, keys: readonly ItemKey[]): Library {
  let result = lib;
  const copies = new Set<string>();
  for (const key of keys) {
    const parsed = parseItemKey(key);
    if (!parsed || getItem(result, parsed.kind, parsed.id) === undefined) continue;
    const collection = COLLECTIONS[parsed.kind];
    if (!copies.has(collection)) {
      result = { ...result, [collection]: { ...result[collection] } };
      copies.add(collection);
    }
    delete (result[collection] as Record<string, AnyItem>)[parsed.id];
  }
  return result;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, node: unknown) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return node;
    const record = node as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashItem(doc: unknown): string {
  return cyrb53(stableStringify(doc)).toString(36);
}

export function isDeleted(doc: AnyItem): boolean {
  return doc.deletedAt !== null;
}

export function itemLabel(kind: ItemKind, doc: AnyItem): string {
  return kind === 'trip' || kind === 'meeting'
    ? (doc as Trip | Meeting).title.value
    : (doc as Place | Label | FolderLink).name.value;
}

export function lastTouched(doc: AnyItem): string {
  let latest = doc.createdAt;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (
        (key === 'createdAt' ||
          key === 'deletedAt' ||
          key === 'checkedAt' ||
          (key === 'updatedAt' && Object.hasOwn(value, 'value'))) &&
        typeof child === 'string' &&
        child > latest
      )
        latest = child;
      visit(child);
    }
  };
  visit(doc);
  return latest;
}

export function tripRefs(trip: Trip): string[] {
  const refs = new Set(trip.candidates.value);
  if (trip.origin.value !== null) refs.add(trip.origin.value);
  for (const day of trip.days) {
    for (const stop of day.stops.value) refs.add(stop.placeId);
    if (day.lodging.value !== null) refs.add(day.lodging.value);
  }
  return [...refs].sort();
}

export const ITEM_DOC_MAX_CHARS = 200_000;

export function decodeItem(
  kind: ItemKind,
  id: string,
  value: unknown,
): { ok: true; doc: AnyItem } | { ok: false; reason: 'invalid' | 'too-large' } {
  try {
    if (stableStringify(value).length > ITEM_DOC_MAX_CHARS)
      return { ok: false, reason: 'too-large' };
    const schema = {
      place: PlaceSchema,
      label: LabelSchema,
      folder: FolderLinkSchema,
      trip: TripSchema,
      meeting: MeetingSchema,
    }[kind];
    const parsed = safeParse(schema, value);
    if (!parsed.success) return { ok: false, reason: 'invalid' };
    const doc = parsed.data;
    if (('shareId' in doc ? doc.shareId : doc.id) !== id) return { ok: false, reason: 'invalid' };
    if (kind === 'trip') {
      const trip = doc as Trip;
      const places = Object.fromEntries(tripRefs(trip).map((placeId) => [placeId, true]));
      if (checkTrip(trip, places, []).length) return { ok: false, reason: 'invalid' };
    }
    if (kind === 'meeting' && checkMeeting(doc as Meeting, []).length)
      return { ok: false, reason: 'invalid' };
    return { ok: true, doc };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
