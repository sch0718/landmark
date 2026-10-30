import { parseLinkDoc } from '../../share-viewer/parse';
import type { ShareDocV2 } from '../../schema/share';

export const LIVE_ID_PATTERN = /^[a-z0-9]{10}$/;
export const LIVE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const LIVE_DAY_ID_PATTERN = /^[a-z0-9]{8}$/;
export const LIVE_STOP_ID_PATTERN = /^[a-z0-9]{8}$/;
export const LIVE_DOC_MAX_BYTES = 524_288;
export const LIVE_REQUEST_MAX_BYTES = 600_000;
export const LIVE_PATH_POINTS_MAX = 10_000;
export const LIVE_KEEP_DAYS = { afterTrip: 30, min: 30, max: 180 } as const;
export const LIVE_POLL_MS = 10_000;
export type LiveTripOptions = { includeMemo: boolean; includeCandidates: boolean };
export type LiveTripDoc = {
  format: 'landmark-trip-live';
  v: 1;
  share: ShareDocV2;
  ids: { days: string[]; stops: string[][] };
  options: LiveTripOptions;
};
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function ids(value: unknown, count: number, pattern: RegExp): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every((id) => typeof id === 'string' && pattern.test(id))
  );
}
/** 보기 화면과 서버가 같은 엄격한 검사로 정규화한다. */
export function parseLiveDoc(value: unknown): LiveTripDoc | null {
  try {
    if (
      !exact(value, ['format', 'v', 'share', 'ids', 'options']) ||
      value.format !== 'landmark-trip-live' ||
      value.v !== 1
    )
      return null;
    if (
      !exact(value.ids, ['days', 'stops']) ||
      !exact(value.options, ['includeMemo', 'includeCandidates'])
    )
      return null;
    const { includeMemo, includeCandidates } = value.options;
    if (typeof includeMemo !== 'boolean' || typeof includeCandidates !== 'boolean') return null;
    const share = parseLinkDoc(value.share);
    if (share?.version !== 2 || share.trips.length !== 1 || share.places.length === 0) return null;
    const days = share.trips[0]!.days;
    const { days: dayIds, stops } = value.ids;
    if (
      !ids(dayIds, days.length, LIVE_DAY_ID_PATTERN) ||
      new Set(dayIds).size !== dayIds.length ||
      !Array.isArray(stops) ||
      stops.length !== days.length
    )
      return null;
    if (!stops.every((row, i) => ids(row, days[i]!.stops.length, LIVE_STOP_ID_PATTERN)))
      return null;
    const stopIds = stops as string[][];
    const all = stopIds.flat();
    if (new Set(all).size !== all.length) return null;
    return {
      format: 'landmark-trip-live',
      v: 1,
      share,
      ids: { days: [...dayIds], stops: stopIds.map((row) => [...row]) },
      options: { includeMemo, includeCandidates },
    };
  } catch {
    return null;
  }
}
export function liveDocBytes(doc: LiveTripDoc): number {
  return new TextEncoder().encode(JSON.stringify(doc)).byteLength;
}
export function liveExpiresAt(endDate: string, now: Date): Date {
  const day = 86_400_000;
  const min = now.getTime() + LIVE_KEEP_DAYS.min * day;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ? Date.parse(`${endDate}T23:59:59.999+09:00`)
    : NaN;
  return new Date(
    Math.min(
      now.getTime() + LIVE_KEEP_DAYS.max * day,
      Math.max(min, Number.isFinite(end) ? end + LIVE_KEEP_DAYS.afterTrip * day : min),
    ),
  );
}
export function alignDayIds(prev: readonly string[], count: number, make: () => string): string[] {
  const result = prev.slice(0, count);
  const used = new Set(result);
  while (result.length < count) {
    const id = make();
    if (!used.has(id)) {
      result.push(id);
      used.add(id);
    }
  }
  return result;
}
export function liveLinks(
  origin: string,
  liveId: string,
  tokens: { viewToken: string; ownerToken?: string },
): { view: string; owner: string | null } {
  const base = origin.replace(/\/+$/, '');
  return {
    view: `${base}/view#t=${liveId}.${tokens.viewToken}`,
    owner: tokens.ownerToken ? `${base}/trips/live/${liveId}#h=${tokens.ownerToken}` : null,
  };
}
export function readLiveHash(hash: string): { id: string; token: string } | null {
  const match = /^#t=([a-z0-9]{10})\.([A-Za-z0-9_-]{43})$/.exec(hash);
  return match ? { id: match[1]!, token: match[2]! } : null;
}
export function readOwnerHash(hash: string): string | null {
  return /^#h=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1] ?? null;
}
