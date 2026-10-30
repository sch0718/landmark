import { toast } from 'sonner';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { applyCollabPlan } from 'src/domain/trip-collab/apply';
import { buildCollabDoc, type CollabRouteOf } from 'src/domain/trip-collab/build-doc';
import { OWNER_DEVICE, OWNER_LABEL } from 'src/domain/trip-collab/constants';
import {
  mergeCollabPlan,
  resolveCollabMerge,
  type CollabMerge,
  type CollabSide,
} from 'src/domain/trip-collab/merge';
import {
  assignServerPlaceIds,
  mapServerPlaces,
  renameStopIds,
  serverIdOf,
  stopIdClashes,
} from 'src/domain/trip-collab/places';
import { planFromDoc, projectLocalTrip, samePlan } from 'src/domain/trip-collab/plan';
import {
  queueOp,
  withLocalOps,
  type ProgressOp,
  type SharedProgress,
} from 'src/domain/trip-collab/progress';
import { fitLiveDoc } from 'src/domain/trip-live/build-live-doc';
import { alignDayIds, type LiveTripDoc } from 'src/domain/trip-live/live-doc';
import type { Library } from 'src/schema/library';
import {
  tripCollabApi,
  type CollabState,
  type TripCollabError,
} from 'src/services/trip-collab/client';
import { createTripCollabStore, type TripCollabRecord } from 'src/services/trip-collab/store';
import { tripLiveStore } from 'src/services/trip-live/store';
import { newDayId } from 'src/services/trip-live/tokens';
import { createLivePoll } from 'src/share-viewer/live';
import type { LibraryActionResult } from 'src/stores/library-state';
import {
  LIVE_DEBOUNCE_MS,
  LIVE_MIN_GAP_MS,
  LIVE_OFF_RETRY_MS,
  LIVE_LIMIT_RETRY_MS,
} from '../live/use-trip-live-publish';
export type CollabSyncState =
  | 'idle'
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'offline'
  | 'off'
  | 'limited'
  | 'too-big'
  | 'busy'
  | 'revoked'
  | 'ended'
  | 'version'
  | 'failed';
export type CollabSnapshot = {
  state: CollabSyncState;
  record: TripCollabRecord | undefined;
  merge: CollabMerge | null;
  syncedAt: string | null;
  changedBy: string | null;
  changedAt: string | null;
  members: number;
  progress: SharedProgress | null;
};
export type CollabEngineDeps = {
  tripId: string;
  api: typeof tripCollabApi;
  store: ReturnType<typeof createTripCollabStore>;
  liveStore: typeof tripLiveStore;
  getLibrary(): Library;
  run(op: (lib: Library, ctx: OpCtx) => Library | OpResult): Promise<LibraryActionResult>;
  routeOf(): CollabRouteOf;
  now(): Date;
  newPlaceId(): string;
  locks?: LockManager | null;
  win?: Window;
  reportError(error: unknown): void;
};
const chains = new Map<string, Promise<void>>();
const terminal = (s: CollabSyncState) => ['revoked', 'ended', 'version'].includes(s);
export class CollabEngine {
  private snapshot: CollabSnapshot;
  private listeners = new Set<() => void>();
  private refs = 0;
  private poll: ReturnType<typeof createLivePoll> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> | null = null;
  private sending: Promise<void> | null = null;
  private doc: LiveTripDoc | null = null;
  private remote: CollabState | null = null;
  private lastPut = -Infinity;
  private retryAt = 0;
  private disposed = false;
  constructor(private deps: CollabEngineDeps) {
    const record = deps.store.get(deps.tripId),
      base = record ? deps.store.readBase(record.liveId) : null;
    this.snapshot = {
      state:
        record?.status === 'revoked' ? 'revoked' : record?.status === 'ended' ? 'ended' : 'idle',
      record,
      merge: null,
      syncedAt: record?.syncedAt ?? null,
      changedBy: null,
      changedAt: null,
      members: 0,
      progress: base?.progress ?? null,
    };
  }
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = (): CollabSnapshot => this.snapshot;
  private emit(patch: Partial<CollabSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch, record: this.deps.store.get(this.deps.tripId) };
    this.listeners.forEach((fn) => fn());
  }
  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  private schedule(ms: number) {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sync();
    }, ms);
  }
  retain(): () => void {
    if (this.disposed) return () => undefined;
    this.refs++;
    if (
      this.refs === 1 &&
      this.deps.store.get(this.deps.tripId)?.status === 'live' &&
      !terminal(this.snapshot.state)
    ) {
      this.poll = createLivePoll({
        win: this.deps.win,
        tick: async () => {
          await this.sync();
          return terminal(this.snapshot.state)
            ? 'stop'
            : ['offline', 'off', 'limited', 'busy', 'failed'].includes(this.snapshot.state)
              ? 'error'
              : 'ok';
        },
      });
      void this.sync();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs--;
      if (!this.refs) {
        this.poll?.stop();
        this.poll = null;
        this.cancelTimer();
      }
    };
  }
  private token(record: TripCollabRecord): string | null {
    return record.role === 'editor'
      ? record.token
      : (this.deps.liveStore.get(record.tripId)?.ownerToken ?? null);
  }
  private error(error: TripCollabError) {
    if (this.disposed) return;
    const { store, tripId, now, liveStore } = this.deps;
    const record = store.get(tripId);
    if (error === 'unauthorized') {
      store.update(tripId, { status: 'revoked' });
      if (record?.role === 'owner') liveStore.update(tripId, { status: 'disconnected' });
      this.emit({ state: 'revoked' });
    } else if (error === 'ended' || error === 'not-found') {
      store.update(tripId, { status: 'ended' });
      this.emit({ state: 'ended' });
    } else if (error === 'switched-off') {
      this.retryAt = now().getTime() + LIVE_OFF_RETRY_MS;
      this.emit({ state: 'off' });
      this.schedule(LIVE_OFF_RETRY_MS);
    } else if (error === 'rate-limited') {
      this.retryAt = now().getTime() + LIVE_LIMIT_RETRY_MS;
      this.emit({ state: 'limited' });
      this.schedule(LIVE_LIMIT_RETRY_MS);
    } else
      this.emit({
        state:
          error === 'version'
            ? 'version'
            : error === 'too-big'
              ? 'too-big'
              : error === 'offline' || error === 'unavailable'
                ? 'offline'
                : 'failed',
      });
    if (terminal(this.snapshot.state)) {
      this.poll?.stop();
      this.cancelTimer();
    }
  }
  sync(): Promise<void> {
    return this.start();
  }
  resolve(choices: Readonly<Record<string, CollabSide>>): Promise<void> {
    return this.start(choices);
  }
  private start(choices?: Readonly<Record<string, CollabSide>>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.inflight)
      return choices ? this.inflight.then(() => this.start(choices)) : this.inflight;
    const run = async () => {
      try {
        await this.perform(choices);
      } catch (error) {
        this.deps.reportError(error);
        this.emit({ state: 'failed' });
      }
    };
    let pending: Promise<void>;
    if (this.deps.locks)
      pending = this.deps.locks.request(`tripmap:trip-collab:${this.deps.tripId}`, run);
    else {
      const before = chains.get(this.deps.tripId) ?? Promise.resolve();
      pending = before.catch(() => undefined).then(run);
      chains.set(this.deps.tripId, pending);
    }
    const done = pending.finally(() => {
      if (chains.get(this.deps.tripId) === pending) chains.delete(this.deps.tripId);
      this.inflight = null;
    });
    this.inflight = done;
    return done;
  }
  private async flushProgress(): Promise<void> {
    if (this.disposed) return;
    if (this.sending) return this.sending;
    const { store, tripId, api } = this.deps,
      record = store.get(tripId);
    if (!record || record.status !== 'live' || !record.pendingProgress.length) return;
    const token = this.token(record);
    if (!token) {
      this.error('unauthorized');
      return;
    }
    const sent = record.pendingProgress.slice(0, 50);
    this.sending = (async () => {
      const r = await api.progress(record.liveId, token, { ops: sent });
      if (this.disposed) return;
      if (!r.ok) {
        this.error(r.error);
        return;
      }
      const remaining =
        store
          .get(tripId)
          ?.pendingProgress.filter(
            (op) =>
              !sent.some(
                (s) => s.stopId === op.stopId && s.at === op.at && s.visited === op.visited,
              ),
          ) ?? [];
      store.update(tripId, { prev: r.value.prev, pendingProgress: remaining });
      const base = store.readBase(record.liveId);
      if (base) store.writeBase(record.liveId, { ...base, progress: r.value });
      this.emit({
        progress: withLocalOps(r.value, remaining, {
          device: record.deviceId ?? OWNER_DEVICE,
          label: record.role === 'owner' ? OWNER_LABEL : record.label,
        }),
      });
    })().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }
  private async perform(choices?: Readonly<Record<string, CollabSide>>): Promise<void> {
    const d = this.deps;
    if (this.disposed) return;
    if (terminal(this.snapshot.state)) return;
    let initial = d.store.get(d.tripId);
    if (!initial || initial.status !== 'live') {
      this.emit({ state: 'idle' });
      return;
    }
    if ((d.win ?? window).navigator.onLine === false) {
      this.error('offline');
      return;
    }
    const waitingState = this.snapshot.state;
    if (d.now().getTime() >= this.retryAt) await this.flushProgress();
    if (terminal(this.snapshot.state)) return;
    this.emit({ state: 'syncing' });
    for (let attempt = 0; attempt < 3; attempt++) {
      initial = d.store.get(d.tripId);
      if (!initial || initial.status !== 'live') return;
      let record = initial;
      const token = this.token(record);
      if (!token) {
        this.error('unauthorized');
        return;
      }
      const response = await d.api.state(record.liveId, token, {
        rev: this.doc ? record.rev : null,
        prev: this.doc ? record.prev : null,
      });
      if (this.disposed) return;
      if (!response.ok) {
        this.error(response.error);
        return;
      }
      if (response.value !== 'unchanged') {
        this.remote = response.value;
        if (response.value.doc) this.doc = response.value.doc;
      }
      const remote = this.remote,
        doc = this.doc;
      if (!doc || !remote) {
        this.emit({ state: 'failed' });
        return;
      }
      let base = d.store.readBase(record.liveId);
      const progress =
        response.value !== 'unchanged' && response.value.progress
          ? response.value.progress
          : (this.snapshot.progress ?? base?.progress ?? null);
      if (response.value !== 'unchanged' && response.value.progress) {
        d.store.update(d.tripId, { prev: response.value.progress.prev });
        if (base) {
          base = { ...base, progress: response.value.progress };
          d.store.writeBase(record.liveId, base);
        }
      }
      this.emit({
        members: remote.members,
        progress: withLocalOps(progress, d.store.get(d.tripId)?.pendingProgress ?? [], {
          device: record.deviceId ?? OWNER_DEVICE,
          label: record.role === 'owner' ? OWNER_LABEL : record.label,
        }),
      });
      let placeMap = record.placeMap;
      const mapped = await d.run((lib, ctx) => {
        if (this.disposed) return { ok: true, lib };
        const r = mapServerPlaces(lib, doc, placeMap, ctx);
        if (r.ok) placeMap = r.placeMap;
        return r;
      });
      if (this.disposed) return;
      if (!mapped.ok) {
        d.reportError(mapped.error);
        this.emit({ state: 'failed' });
        return;
      }
      let lib = d.getLibrary(),
        trip = lib.trips[d.tripId];
      if (!trip || trip.deletedAt !== null) {
        this.emit({ state: 'idle' });
        return;
      }
      const dayIds = alignDayIds(record.dayIds, trip.days.length, newDayId);
      placeMap = assignServerPlaceIds(
        trip,
        placeMap,
        new Set(doc.share.places.map((p) => p.id)),
        d.newPlaceId,
      );
      d.store.update(d.tripId, { placeMap, dayIds });
      record = d.store.get(d.tripId)!;
      let mine = projectLocalTrip(trip, serverIdOf(placeMap), dayIds);
      const theirs = planFromDoc(doc),
        clashes = stopIdClashes(mine, theirs, base?.plan ?? null);
      if (clashes.length) {
        const renamed = await d.run((lib, ctx) =>
          this.disposed ? { ok: true, lib } : renameStopIds(lib, d.tripId, clashes, ctx),
        );
        if (this.disposed) return;
        if (!renamed.ok) {
          this.emit({ state: 'failed' });
          return;
        }
        lib = d.getLibrary();
        trip = lib.trips[d.tripId]!;
        mine = projectLocalTrip(trip, serverIdOf(placeMap), dayIds);
      }
      const merge = mergeCollabPlan(base?.plan ?? null, mine, theirs);
      let plan = merge.plan;
      if (merge.conflicts.length && choices) {
        const r = resolveCollabMerge(merge, choices);
        if (r.ok) plan = r.plan;
        else {
          this.emit({ state: 'conflict', merge: r.reason === 'invalid' ? r.merge : merge });
          return;
        }
      }
      if (!plan) {
        this.emit({ state: 'conflict', merge });
        return;
      }
      const chosen = plan;
      const changed = !samePlan(chosen, mine);
      if (changed) {
        let moved = false;
        const applied = await d.run((latest, ctx) => {
          if (this.disposed) return { ok: true, lib: latest };
          const current = latest.trips[d.tripId];
          if (
            !current ||
            current.deletedAt !== null ||
            current.days.length !== dayIds.length ||
            !samePlan(projectLocalTrip(current, serverIdOf(placeMap), dayIds), mine)
          ) {
            moved = true;
            return { ok: true, lib: latest };
          }
          return applyCollabPlan(latest, d.tripId, chosen, placeMap, ctx);
        });
        if (this.disposed) return;
        if (!applied.ok) {
          d.reportError(applied.error);
          this.emit({ state: 'failed' });
          return;
        }
        if (moved) continue;
      }
      let rev = remote.rev;
      if (!samePlan(chosen, theirs)) {
        if (d.now().getTime() < this.retryAt) {
          this.emit({ state: waitingState === 'limited' ? 'limited' : 'off' });
          this.schedule(this.retryAt - d.now().getTime());
          return;
        }
        const gap = this.lastPut + LIVE_MIN_GAP_MS - d.now().getTime();
        if (gap > 0) {
          this.emit({ state: 'pending' });
          this.schedule(gap);
          return;
        }
        const built = buildCollabDoc({
          plan: chosen,
          previous: doc,
          lib: d.getLibrary(),
          placeMap,
          role: record.role,
          options:
            record.role === 'owner'
              ? {
                  ...doc.options,
                  includeMemo:
                    d.liveStore.get(d.tripId)?.options.includeMemo ?? doc.options.includeMemo,
                }
              : doc.options,
          createdAt: doc.share.createdAt,
          routeOf: d.routeOf(),
        });
        const fitted = built ? fitLiveDoc(built) : null;
        if (!fitted) {
          this.emit({ state: 'too-big' });
          return;
        }
        this.lastPut = d.now().getTime();
        const result = await d.api.putDoc(record.liveId, token, fitted, rev);
        if (this.disposed) return;
        if (!result.ok) {
          if (result.error === 'conflict') {
            this.lastPut = -Infinity;
            this.doc = null;
            continue;
          }
          this.error(result.error);
          return;
        }
        rev = result.value.rev;
        this.doc = fitted;
        this.remote = { ...remote, rev, doc: fitted };
      }
      d.store.writeBase(record.liveId, { rev, plan: chosen, progress });
      const at = d.now().toISOString();
      d.store.update(d.tripId, {
        rev,
        dayIds: chosen.days.map((day) => day.id),
        syncedAt: at,
        title: chosen.title,
      });
      this.emit({
        state: 'synced',
        merge: null,
        syncedAt: at,
        ...(changed ? { changedBy: remote.editedBy, changedAt: at } : {}),
      });
      return;
    }
    this.emit({ state: 'busy' });
    this.schedule(30_000);
  }
  localChanged(): void {
    if (this.disposed) return;
    if (terminal(this.snapshot.state) || this.snapshot.state === 'syncing') return;
    const d = this.deps,
      r = d.store.get(d.tripId),
      trip = d.getLibrary().trips[d.tripId];
    if (!r || r.status !== 'live' || !trip || trip.deletedAt !== null) return;
    const base = d.store.readBase(r.liveId);
    try {
      const map = assignServerPlaceIds(
        trip,
        r.placeMap,
        new Set(this.doc?.share.places.map((p) => p.id) ?? []),
        d.newPlaceId,
      );
      const ids = alignDayIds(r.dayIds, trip.days.length, newDayId);
      const mine = projectLocalTrip(trip, serverIdOf(map), ids);
      if (this.snapshot.state === 'conflict' && this.snapshot.merge) {
        // 보관함 연산의 재알림으로 비교 상태를 지우거나 맞추기를 반복하지 않는다.
        if (samePlan(mine, this.snapshot.merge.mine)) return;
      } else if (base && samePlan(mine, base.plan)) return;
    } catch (error) {
      d.reportError(error);
    }
    if (this.snapshot.state !== 'conflict') this.emit({ state: 'pending' });
    this.schedule(base ? LIVE_DEBOUNCE_MS : 0);
  }
  queueProgress(op: Omit<ProgressOp, 'at'>): void {
    if (this.disposed) return;
    const d = this.deps,
      r = d.store.get(d.tripId);
    if (!r || r.status !== 'live') return;
    const pending = queueOp(r.pendingProgress, { ...op, at: d.now().toISOString() });
    d.store.update(d.tripId, { pendingProgress: pending });
    this.emit({
      progress: withLocalOps(this.snapshot.progress, pending, {
        device: r.deviceId ?? OWNER_DEVICE,
        label: r.role === 'owner' ? OWNER_LABEL : r.label,
      }),
    });
    void this.flushProgress();
  }
  setNext(stopId: string | null, date: string): void {
    if (this.disposed) return;
    const d = this.deps,
      r = d.store.get(d.tripId);
    if (!r || r.status !== 'live') return;
    const token = this.token(r);
    if (!token) return;
    void d.api
      .progress(r.liveId, token, { ops: [], next: { stopId, date, at: d.now().toISOString() } })
      .then((result) => {
        if (this.disposed) return;
        if (!result.ok) {
          toast.error('다음 장소를 정하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요');
          return;
        }
        d.store.update(d.tripId, { prev: result.value.prev });
        const base = d.store.readBase(r.liveId);
        if (base) d.store.writeBase(r.liveId, { ...base, progress: result.value });
        this.emit({ progress: result.value });
      });
  }
  dispose(): void {
    this.disposed = true;
    this.poll?.stop();
    this.cancelTimer();
  }
  dismiss(): void {
    if (this.snapshot.state === 'revoked' || this.snapshot.state === 'ended') {
      this.deps.store.remove(this.deps.tripId);
      this.emit({ state: 'idle', merge: null });
    }
  }
}
type EngineEntry = { engine: CollabEngine; connection: string; unsubscribe(): void };
const engines = new Map<string, EngineEntry>();
function connectionOf(deps: CollabEngineDeps): string {
  const record = deps.store.get(deps.tripId);
  return JSON.stringify([
    record?.liveId,
    record?.role,
    record?.deviceId,
    record?.role === 'editor' ? record.token : deps.liveStore.get(deps.tripId)?.ownerToken,
  ]);
}
export function collabEngineFor(tripId: string, makeDeps: () => CollabEngineDeps): CollabEngine {
  const deps = makeDeps(),
    connection = connectionOf(deps);
  let entry = engines.get(tripId);
  if (!entry || entry.connection !== connection) {
    entry?.unsubscribe();
    entry?.engine.dispose();
    const next: EngineEntry = {
      engine: new CollabEngine(deps),
      connection,
      unsubscribe: () => undefined,
    };
    engines.set(tripId, next);
    next.unsubscribe = deps.store.subscribe(() => {
      if (!deps.store.get(tripId) || connectionOf(deps) !== next.connection) {
        next.engine.dispose();
        next.unsubscribe();
        if (engines.get(tripId) === next) engines.delete(tripId);
      }
    });
    entry = next;
  }
  return entry.engine;
}
export function resetCollabEngines(): void {
  for (const entry of engines.values()) {
    entry.unsubscribe();
    entry.engine.dispose();
  }
  engines.clear();
  chains.clear();
}
