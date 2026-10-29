import { Schema } from 'effect';
import { useSyncExternalStore } from 'react';
import {
  LIVE_ID_PATTERN,
  LIVE_TOKEN_PATTERN,
  LIVE_DAY_ID_PATTERN,
} from 'src/domain/trip-live/live-doc';
import { safeParse } from 'src/schema/parse';
export const TRIP_LIVE_KEY = 'tripmap:trip-live:v1';
export const TRIP_LIVE_MAX = 100;
export type TripLiveStatus = 'pending' | 'live' | 'disconnected' | 'ended';
export type TripLiveRecord = {
  tripId: string;
  liveId: string;
  status: TripLiveStatus;
  ownerToken: string;
  viewToken: string;
  rev: number;
  dayIds: string[];
  options: { title: string; includeMemo: boolean; includeCandidates: boolean };
  createdAt: string;
  publishedKey?: string;
  publishedAt?: string;
  expiresAt?: string;
  paused?: true;
};
const id = Schema.String.check(Schema.isPattern(LIVE_ID_PATTERN));
const token = Schema.String.check(Schema.isPattern(LIVE_TOKEN_PATTERN));
const recordSchema = Schema.Struct({
  tripId: id,
  liveId: id,
  status: Schema.Literals(['pending', 'live', 'disconnected', 'ended']),
  ownerToken: token,
  viewToken: token,
  rev: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  dayIds: Schema.mutable(Schema.Array(Schema.String.check(Schema.isPattern(LIVE_DAY_ID_PATTERN)))),
  options: Schema.Struct({
    title: Schema.String,
    includeMemo: Schema.Boolean,
    includeCandidates: Schema.Boolean,
  }),
  createdAt: Schema.String,
  publishedKey: Schema.optionalKey(Schema.String),
  publishedAt: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(Schema.String),
  paused: Schema.optionalKey(Schema.Literal(true)),
});
export function createTripLiveStore(storage: () => Storage = () => window.localStorage) {
  let memory: readonly TripLiveRecord[] = [],
    memoryOnly = false;
  let snapshot: { raw: string | null; records: readonly TripLiveRecord[] } | null = null;
  const listeners = new Set<() => void>();
  function raw() {
    if (memoryOnly) return null;
    try {
      return storage().getItem(TRIP_LIVE_KEY);
    } catch {
      memoryOnly = true;
      return null;
    }
  }
  function list(): readonly TripLiveRecord[] {
    const text = raw();
    if (snapshot?.raw === text) return snapshot.records;
    let records = memory;
    if (!memoryOnly) {
      let value: unknown;
      try {
        value = JSON.parse(text ?? '{}');
      } catch {
        value = {};
      }
      records =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? Object.entries(value).flatMap(([key, item]) => {
              const r = safeParse(recordSchema, item, { onExcessProperty: 'error' });
              return r.success && r.data.tripId === key ? [r.data] : [];
            })
          : [];
    }
    memory = [...records]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, TRIP_LIVE_MAX);
    snapshot = { raw: text, records: memory };
    return memory;
  }
  function save(records: readonly TripLiveRecord[]) {
    memory = [...records]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, TRIP_LIVE_MAX);
    snapshot = null;
    if (!memoryOnly)
      try {
        storage().setItem(
          TRIP_LIVE_KEY,
          JSON.stringify(Object.fromEntries(memory.map((r) => [r.tripId, r]))),
        );
      } catch {
        memoryOnly = true;
      }
    for (const fn of listeners) fn();
  }
  const get = (tripId: string) => list().find((r) => r.tripId === tripId);
  function put(record: TripLiveRecord) {
    save([...list().filter((r) => r.tripId !== record.tripId), record]);
  }
  function update(tripId: string, patch: Partial<Omit<TripLiveRecord, 'tripId'>>) {
    const record = get(tripId);
    if (record)
      put(
        Object.fromEntries(
          Object.entries({ ...record, ...patch, tripId }).filter(([, v]) => v !== undefined),
        ) as TripLiveRecord,
      );
  }
  function remove(tripId: string) {
    save(list().filter((r) => r.tripId !== tripId));
  }
  function subscribe(fn: () => void) {
    listeners.add(fn);
    const onStorage = (event: StorageEvent) => {
      if (event.key === TRIP_LIVE_KEY || event.key === null) {
        snapshot = null;
        fn();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener('storage', onStorage);
    };
  }
  return {
    subscribe,
    list,
    get,
    byLiveId: (liveId: string) => list().find((r) => r.liveId === liveId),
    put,
    update,
    remove,
  };
}
export const tripLiveStore = createTripLiveStore();
export function useTripLiveRecord(tripId: string): TripLiveRecord | undefined {
  return useSyncExternalStore(tripLiveStore.subscribe, () => tripLiveStore.get(tripId));
}
export function useTripLiveRecords(): readonly TripLiveRecord[] {
  return useSyncExternalStore(tripLiveStore.subscribe, tripLiveStore.list);
}
