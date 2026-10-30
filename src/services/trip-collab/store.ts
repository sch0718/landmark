import { Schema } from 'effect';
import { useSyncExternalStore } from 'react';
import {
  COLLAB_DEVICE_ID_PATTERN,
  COLLAB_LIMITS,
  COLLAB_STOP_ID_PATTERN,
} from 'src/domain/trip-collab/constants';
import { checkPlan, type CollabPlan } from 'src/domain/trip-collab/plan';
import type { ProgressOp, SharedProgress } from 'src/domain/trip-collab/progress';
import {
  LIVE_ID_PATTERN,
  LIVE_TOKEN_PATTERN,
  LIVE_DAY_ID_PATTERN,
} from 'src/domain/trip-live/live-doc';
import { safeParse } from 'src/schema/parse';
import { sharedProgressSchema } from './client';
export const TRIP_COLLAB_KEY = 'tripmap:trip-collab:v1';
export const TRIP_COLLAB_MAX = 100;
export const collabBaseKey = (liveId: string) => `tripmap:trip-collab-base:v1:${liveId}`;
export type TripCollabRecord = {
  tripId: string;
  liveId: string;
  role: 'owner' | 'editor';
  token: string | null;
  deviceId: string | null;
  label: string;
  status: 'live' | 'revoked' | 'ended';
  rev: number;
  prev: number;
  dayIds: string[];
  placeMap: Record<string, string>;
  syncedAt: string;
  title: string;
  pendingProgress: ProgressOp[];
};
export type CollabBase = { rev: number; plan: CollabPlan; progress: SharedProgress | null };
const pattern = (p: RegExp) => Schema.String.check(Schema.isPattern(p));
const id = pattern(LIVE_ID_PATTERN),
  dayId = pattern(LIVE_DAY_ID_PATTERN),
  stopId = pattern(COLLAB_STOP_ID_PATTERN);
const integer = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const list = <S extends Schema.Top>(schema: S) => Schema.mutable(Schema.Array(schema));
const mode = Schema.Literals(['car', 'walk']);
const planSchema = Schema.Struct({
  title: Schema.String,
  startDate: Schema.String,
  endDate: Schema.String,
  origin: Schema.NullOr(id),
  candidates: list(id),
  legModes: Schema.Record(Schema.String, mode),
  days: list(
    Schema.Struct({
      id: dayId,
      startTime: Schema.String,
      lodging: Schema.NullOr(id),
      stops: list(
        Schema.Struct({
          id: stopId,
          placeId: id,
          stayMin: Schema.NullOr(Schema.Number),
          fixedTime: Schema.NullOr(Schema.String),
          note: Schema.String,
        }),
      ),
    }),
  ),
});
const baseSchema = Schema.Struct({
  rev: integer,
  plan: planSchema,
  progress: Schema.NullOr(sharedProgressSchema),
});
const recordSchema = Schema.Struct({
  tripId: id,
  liveId: id,
  role: Schema.Literals(['owner', 'editor']),
  token: Schema.NullOr(pattern(LIVE_TOKEN_PATTERN)),
  deviceId: Schema.NullOr(pattern(COLLAB_DEVICE_ID_PATTERN)),
  label: Schema.String,
  status: Schema.Literals(['live', 'revoked', 'ended']),
  rev: integer,
  prev: integer,
  dayIds: list(dayId),
  placeMap: Schema.Record(id, id),
  syncedAt: Schema.String,
  title: Schema.String,
  pendingProgress: list(
    Schema.Struct({ stopId, visited: Schema.Boolean, date: Schema.String, at: Schema.String }),
  ).check(Schema.isMaxLength(COLLAB_LIMITS.pendingOps)),
});
export function createTripCollabStore(storage: () => Storage = () => window.localStorage) {
  let memory: readonly TripCollabRecord[] = [],
    memoryOnly = false;
  let snapshot: { raw: string | null; records: readonly TripCollabRecord[] } | null = null;
  const bases = new Map<string, CollabBase>(),
    failedBases = new Set<string>(),
    listeners = new Set<() => void>();
  function raw() {
    if (memoryOnly) return null;
    try {
      return storage().getItem(TRIP_COLLAB_KEY);
    } catch {
      memoryOnly = true;
      return null;
    }
  }
  function removeBase(id: string) {
    bases.delete(id);
    failedBases.delete(id);
    try {
      storage().removeItem(collabBaseKey(id));
    } catch {
      /* 저장이 막혀도 메모리 기록은 지운다. */
    }
  }
  function trim(records: readonly TripCollabRecord[]): readonly TripCollabRecord[] {
    const sorted = [...records].sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
    sorted.slice(TRIP_COLLAB_MAX).forEach((r) => removeBase(r.liveId));
    return sorted.slice(0, TRIP_COLLAB_MAX);
  }
  function listRecords(): readonly TripCollabRecord[] {
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
              return r.success &&
                r.data.tripId === key &&
                (r.data.role === 'owner'
                  ? r.data.token === null && r.data.deviceId === null
                  : r.data.token !== null && r.data.deviceId !== null)
                ? [r.data]
                : [];
            })
          : [];
    }
    memory = trim(records);
    snapshot = { raw: text, records: memory };
    return memory;
  }
  function save(records: readonly TripCollabRecord[]) {
    memory = trim(records);
    snapshot = null;
    if (!memoryOnly)
      try {
        storage().setItem(
          TRIP_COLLAB_KEY,
          JSON.stringify(Object.fromEntries(memory.map((r) => [r.tripId, r]))),
        );
      } catch {
        memoryOnly = true;
      }
    listeners.forEach((fn) => fn());
  }
  const get = (tripId: string) => listRecords().find((r) => r.tripId === tripId);
  const put = (record: TripCollabRecord) =>
    save([...listRecords().filter((r) => r.tripId !== record.tripId), record]);
  function update(tripId: string, patch: Partial<Omit<TripCollabRecord, 'tripId'>>) {
    const record = get(tripId);
    if (record)
      put(
        Object.fromEntries(
          Object.entries({ ...record, ...patch, tripId }).filter(([, v]) => v !== undefined),
        ) as TripCollabRecord,
      );
  }
  function remove(tripId: string) {
    const record = get(tripId);
    if (record) removeBase(record.liveId);
    save(listRecords().filter((r) => r.tripId !== tripId));
  }
  function readBase(liveId: string): CollabBase | null {
    if (memoryOnly || failedBases.has(liveId)) return bases.get(liveId) ?? null;
    try {
      const value = JSON.parse(storage().getItem(collabBaseKey(liveId)) ?? 'null'),
        r = safeParse(baseSchema, value, { onExcessProperty: 'error' });
      return r.success && checkPlan(r.data.plan).length === 0 ? r.data : null;
    } catch {
      return null;
    }
  }
  function writeBase(liveId: string, base: CollabBase) {
    bases.set(liveId, base);
    if (memoryOnly) return;
    try {
      storage().setItem(collabBaseKey(liveId), JSON.stringify(base));
      failedBases.delete(liveId);
    } catch {
      failedBases.add(liveId);
    }
  }
  function subscribe(fn: () => void) {
    listeners.add(fn);
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === TRIP_COLLAB_KEY ||
        event.key.startsWith('tripmap:trip-collab-base:v1:')
      ) {
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
    list: listRecords,
    get,
    byLiveId: (id: string) => listRecords().find((r) => r.liveId === id),
    put,
    update,
    remove,
    readBase,
    writeBase,
  };
}
export const tripCollabStore = createTripCollabStore();
export function useTripCollabRecord(tripId: string): TripCollabRecord | undefined {
  return useSyncExternalStore(tripCollabStore.subscribe, () => tripCollabStore.get(tripId));
}
export function useTripCollabRecords(): readonly TripCollabRecord[] {
  return useSyncExternalStore(tripCollabStore.subscribe, tripCollabStore.list);
}
