import { Effect } from 'effect';
import { getDefaultStore } from 'jotai';
import { toast } from 'sonner';
import {
  applyRemote,
  applyPushResults,
  dirtyItems,
  missingFromLocal,
  type ApplyResult,
  type ApplyOptions,
  type DirtyItem,
  type RemoteItem,
} from 'src/domain/library-sync/apply';
import {
  getItem,
  putItems,
  parseItemKey,
  hashItem,
  itemKey,
  stableStringify,
  ITEM_DOC_MAX_CHARS,
  type AnyItem,
} from 'src/domain/library-sync/items';
import { repairLibrary } from 'src/domain/library-sync/repair';
import { hasAnyEntry } from 'src/domain/backup/summary';
import { startEffect } from 'src/lib/effect/runtime';
import { emptyLibrary, type Library } from 'src/schema/library';
import { browserStorage } from 'src/services/browser-storage';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { IdGen } from 'src/services/id-gen';
import { LibraryStore } from 'src/services/library-store';
import { libraryAtom } from 'src/stores/library-state';
import { OFF_STATUS, syncStatusAtom, type SyncStatus } from 'src/stores/sync-status';
import { createSyncApi, googleAuth, type SyncApi, type SyncFail } from './api';
import { readSyncClientConfig } from './config';
import {
  readSyncMeta,
  writeSyncMeta,
  readBase,
  writeBase,
  readConflicts,
  writeConflicts,
  readSession,
  clearSession,
  clearSyncRecords,
  type SyncMeta,
  type SyncCursor,
} from './storage';
export type SyncRunReason = 'open' | 'visible' | 'save' | 'online' | 'manual' | 'connect' | 'retry';
export type ConnectMode = 'upload' | 'merge' | 'replace-local';
export type EngineDeps = {
  api: SyncApi;
  storage: Storage;
  locks?: LockManager;
  runLibrary<A, E>(effect: Effect.Effect<A, E, LibraryStore | IdGen>): Promise<A>;
  setLibrary(lib: Library): void;
  setStatus(status: SyncStatus): void;
  notify(kind: 'conflict' | 'auth'): void;
  now(): number;
  online(): boolean;
  visible(): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  events?: EventTarget;
  newConflictId(): string;
};
export interface LibrarySyncEngine {
  start(): void;
  stop(): void;
  schedule(reason: SyncRunReason): void;
  runNow(reason: SyncRunReason): Promise<SyncStatus>;
  connect(mode: ConnectMode): Promise<SyncStatus>;
  resolveConflict(id: string, action: 'mine' | 'keep'): Promise<void>;
  resolveHeld(key: string, action: 'mine' | 'skip'): Promise<void>;
  disable(): void;
  enable(): void;
  disconnect(): Promise<void>;
  deleteServerData(): Promise<boolean>;
  onRunFinished(listener: (status: SyncStatus) => void): () => void;
  isOwnWrite(lib: Library): boolean;
}
export const SAVE_DEBOUNCE_MS = 2000;
export const RETRY_STEPS_MS = [30_000, 120_000, 600_000] as const;
export const SYNC_LOCK = 'tripmap:library-sync';
export const PUSH_CHUNK_ITEMS = 100;
export const PUSH_CHUNK_BYTES = 900_000;

/** 문서 전체를 되살릴 때 모든 LWW 시각을 새 명령의 시각으로 바꾼다. */
function reviveAsLatest(doc: AnyItem, now: string): AnyItem {
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visit);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.entries(v).map(([key, child]) => [
        key,
        key === 'updatedAt' && 'value' in v ? now : visit(child),
      ]),
    );
  };
  return { ...(visit(doc) as AnyItem), deletedAt: null };
}
function replacePath(doc: AnyItem, path: string, value: unknown, now: string): AnyItem {
  const keys = path.split('.');
  const change = (node: unknown, i: number): unknown => {
    if (i === keys.length) return { value, updatedAt: now };
    const key = keys[i]!;
    if (Array.isArray(node))
      return node.map((v, index) => (String(index) === key ? change(v, i + 1) : v));
    return { ...(node as object), [key]: change((node as Record<string, unknown>)[key], i + 1) };
  };
  return change(doc, 0) as AnyItem;
}
export function createLibrarySyncEngine(deps: EngineDeps): LibrarySyncEngine {
  const { storage, api } = deps;
  let status = { ...OFF_STATUS };
  let active: Promise<SyncStatus> | null = null;
  let queued = false;
  let timer: unknown;
  let retry = 0;
  let started = false;
  let generation = 0;
  const ownWrites = new WeakSet<Library>();
  const listeners = new Set<(s: SyncStatus) => void>();
  const snapshot = () => deps.runLibrary(Effect.flatMap(LibraryStore, (store) => store.snapshot));
  let notified: 'auth' | 'conflict' | null = null;
  function publish(patch: Partial<SyncStatus>): SyncStatus {
    status = { ...status, ...patch };
    deps.setStatus(status);
    if ((status.phase === 'auth' || status.phase === 'conflict') && notified !== status.phase) {
      deps.notify(status.phase);
      notified = status.phase;
    }
    if (status.phase === 'off' || status.phase === 'synced') notified = null;
    return status;
  }
  function setLibrary(lib: Library) {
    ownWrites.add(lib);
    deps.setLibrary(lib);
  }
  function cancelTimer() {
    if (timer !== undefined) {
      deps.clearTimer(timer);
      timer = undefined;
    }
  }
  function scheduleRetry() {
    cancelTimer();
    if (deps.visible())
      timer = deps.setTimer(
        () => {
          timer = undefined;
          void engine.runNow('retry');
        },
        RETRY_STEPS_MS[Math.min(retry++, RETRY_STEPS_MS.length - 1)]!,
      );
  }
  function save(
    meta: SyncMeta,
    base: ReturnType<typeof readBase>['items'],
    conflicts: ReturnType<typeof readConflicts>,
  ) {
    writeConflicts(storage, conflicts);
    writeBase(storage, meta.userId!, base);
    writeSyncMeta(storage, meta);
  }
  async function failed(error: unknown): Promise<SyncStatus> {
    const fail = error as SyncFail;
    const meta = readSyncMeta(storage);
    if (fail?.kind === 'auth' || fail?.kind === 'not-allowed') {
      clearSession(storage);
      cancelTimer();
      return publish({ phase: fail.kind, progress: null });
    }
    if (fail?.kind === 'offline') return publish({ phase: 'local', offline: true, progress: null });
    if (['limit', 'off', 'server', 'busy'].includes(fail?.kind)) {
      scheduleRetry();
      return publish({ phase: fail.kind === 'busy' ? 'local' : 'unavailable', progress: null });
    }
    cancelTimer();
    return publish({
      phase: 'error',
      progress: null,
      message: '저장 공간이 부족해 동기화를 멈췄어요',
      lastSyncAt: meta.lastSyncAt,
    });
  }
  async function execute(): Promise<SyncStatus> {
    let meta = readSyncMeta(storage);
    const session = readSession(storage);
    const runGeneration = generation;
    if (!meta.enabled) return publish({ phase: 'off', progress: null });
    if (meta.pendingChoice) return publish({ phase: 'pending-choice', progress: null });
    if (!session) return publish({ phase: 'auth', progress: null });
    if (!deps.online()) return publish({ phase: 'local', offline: true, progress: null });
    const isCurrent = () =>
      generation === runGeneration &&
      readSyncMeta(storage).userId === meta.userId &&
      readSession(storage)?.sessionId === session.sessionId;
    let base = readBase(storage);
    if (base.userId !== meta.userId) {
      clearSyncRecords(storage);
      meta = { ...readSyncMeta(storage), pendingChoice: true };
      writeSyncMeta(storage, meta);
      return publish({ phase: 'pending-choice' });
    }
    const initial = await snapshot();
    if (!isCurrent()) return status;
    const loaded = await deps.runLibrary(Effect.flatMap(LibraryStore, (store) => store.load));
    if (loaded.persistence !== 'local') throw Error('메모리 저장소에서는 동기화를 켤 수 없어요');
    let fullResync = missingFromLocal(initial.library, base.items);
    let cursor = fullResync ? { rev: 0, key: '' } : (meta.cursor ?? { rev: 0, key: '' });
    let restarted = false;
    const remote: RemoteItem[] = [];
    let conflicts = readConflicts(storage);
    publish({
      phase: 'syncing',
      offline: false,
      message: null,
      progress: { step: 'pull', done: 0, total: 0 },
    });
    for (;;) {
      const reply = await api.changes({
        since: cursor.rev,
        after: cursor.key,
        limit: 500,
        deviceId: meta.deviceId,
      });
      if (!isCurrent()) return status;
      if (!reply.ok) {
        if (reply.kind === 'resync' && !restarted) {
          fullResync = true;
          restarted = true;
          cursor = { rev: 0, key: '' };
          remote.length = 0;
          continue;
        }
        throw reply;
      }
      remote.push(...reply.data.items);
      const next = reply.data.next;
      if (reply.data.more && next.rev === cursor.rev && next.key === cursor.key)
        throw { ok: false, kind: 'server', status: 500 };
      cursor = next;
      if (!reply.data.more) break;
    }
    const options = (ids: { next: IdGen['Service']['next'] }): ApplyOptions => ({
      ctx: { now: new Date(deps.now()).toISOString(), newId: ids.next },
      lastSyncAt: meta.lastSyncAt,
      fullResync,
      conflictId: deps.newConflictId,
      skip: new Set(meta.skipped),
    });
    async function apply(make: (current: Library, opts: ApplyOptions) => ApplyResult) {
      let result: ApplyResult | undefined;
      const lib = await deps.runLibrary(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          const ids = yield* IdGen;
          return yield* store.update((current) => {
            result = make(current, options(ids));
            return Effect.succeed(result.lib);
          });
        }),
      );
      if (!result) return;
      base = { userId: meta.userId, items: result.base };
      conflicts = [...conflicts, ...result.conflicts];
      meta = { ...meta, held: result.held };
      setLibrary(lib);
    }
    if (remote.length || fullResync)
      await apply((current, opts) => applyRemote(current, base.items, remote, opts));
    if (meta.held.length)
      cursor = { rev: Math.max(0, Math.min(...meta.held.map((h) => h.rev)) - 1), key: '' };
    meta = { ...meta, cursor };
    save(meta, base.items, conflicts);
    const dirty = dirtyItems((await snapshot()).library, base.items, meta.rejected);
    const send: DirtyItem[] = [];
    const currentLib = (await snapshot()).library;
    meta = {
      ...meta,
      rejected: meta.rejected.filter((r) => {
        const p = parseItemKey(r.key);
        const doc = p && getItem(currentLib, p.kind, p.id);
        return doc && hashItem(doc) === r.hash;
      }),
    };

    for (const item of dirty) {
      if (stableStringify(item.doc).length > ITEM_DOC_MAX_CHARS)
        meta.rejected.push({ key: item.key, hash: item.hash, reason: 'too-large' });
      else send.push(item);
    }
    let done = 0;
    while (done < send.length) {
      const chunk: DirtyItem[] = [];
      let bytes = 80;
      for (const item of send.slice(done, done + PUSH_CHUNK_ITEMS)) {
        const size =
          new TextEncoder().encode(
            JSON.stringify({
              kind: item.kind,
              id: item.id,
              baseRev: item.baseRev,
              baseDeleted: item.baseDeleted,
              doc: item.doc,
            }),
          ).byteLength + 1;
        if (chunk.length && bytes + size > PUSH_CHUNK_BYTES) break;
        chunk.push(item);
        bytes += size;
      }
      publish({ progress: { step: 'push', done, total: send.length } });
      const reply = await api.push({
        v: 1,
        deviceId: meta.deviceId,
        items: chunk.map(({ kind, id, baseRev, baseDeleted, doc }) => ({
          kind,
          id,
          baseRev,
          baseDeleted,
          doc,
        })),
      });
      if (!isCurrent()) return status;
      if (!reply.ok) throw reply;
      const held = meta.held;
      await apply((current, opts) =>
        applyPushResults(current, base.items, chunk, reply.data.results, {
          ...opts,
          fullResync: false,
        }),
      );
      meta = { ...meta, held: [...held, ...meta.held] };
      for (const r of reply.data.rejected) {
        const sent = chunk.find((s) => s.key === itemKey(r.kind, r.id));
        if (sent) meta.rejected.push({ key: sent.key, hash: sent.hash, reason: r.reason });
      }
      done += chunk.length;
      save(meta, base.items, conflicts);
    }
    if (!isCurrent()) return status;
    const remaining = dirtyItems((await snapshot()).library, base.items, meta.rejected).length;
    // 아직 확인받지 않은 수정은 이전 동기화 뒤의 변경으로 계속 남긴다.
    if (remaining === 0) meta = { ...meta, lastSyncAt: new Date(deps.now()).toISOString() };
    save(meta, base.items, conflicts);
    retry = 0;
    cancelTimer();
    const problem = readConflicts(storage).length + meta.held.length + meta.rejected.length;
    return publish({
      phase: problem ? 'conflict' : remaining ? 'local' : 'synced',
      dirty: remaining,
      conflicts: readConflicts(storage).length,
      held: meta.held.length,
      rejected: meta.rejected.length,
      lastSyncAt: meta.lastSyncAt,
      progress: null,
    });
  }
  const visible = () => {
    if (deps.visible()) engine.schedule('visible');
    else cancelTimer();
  };
  const online = () => engine.schedule('online');
  const engine: LibrarySyncEngine = {
    start() {
      if (started) return;
      started = true;
      deps.events?.addEventListener('visibilitychange', visible);
      deps.events?.addEventListener('online', online);
      engine.schedule('open');
    },
    stop() {
      started = false;
      queued = false;
      cancelTimer();
      deps.events?.removeEventListener('visibilitychange', visible);
      deps.events?.removeEventListener('online', online);
    },
    schedule(reason) {
      if (active) {
        queued = true;
        return;
      }
      if (reason === 'save' && readSyncMeta(storage).enabled) {
        publish({
          phase: status.conflicts + status.held + status.rejected > 0 ? 'conflict' : 'local',
          progress: null,
        });
        void snapshot()
          .then(({ library }) => {
            if (status.phase === 'local')
              publish({
                dirty: dirtyItems(library, readBase(storage).items, readSyncMeta(storage).rejected)
                  .length,
              });
          })
          .catch(() => {});
      }
      cancelTimer();
      timer = deps.setTimer(
        () => {
          timer = undefined;
          void engine.runNow(reason);
        },
        reason === 'save' ? SAVE_DEBOUNCE_MS : 0,
      );
    },
    runNow() {
      if (active) return active;
      cancelTimer();
      active = (async () => {
        try {
          return await (deps.locks ? deps.locks.request(SYNC_LOCK, () => execute()) : execute());
        } catch (error) {
          return failed(error);
        }
      })()
        .then((result) => {
          for (const listener of listeners) listener(result);
          return result;
        })
        .finally(() => {
          active = null;
          if (queued) {
            queued = false;
            engine.schedule('save');
          }
        });
      return active;
    },
    async connect(mode) {
      let meta = readSyncMeta(storage);
      if (!meta.pendingChoice) return engine.runNow('connect');
      try {
        const loaded = await deps.runLibrary(Effect.flatMap(LibraryStore, (store) => store.load));
        if (loaded.persistence !== 'local') throw Error('메모리 저장소');
        if (mode === 'replace-local') {
          publish({ phase: 'syncing', progress: { step: 'pull', done: 0, total: 0 } });
          const items: RemoteItem[] = [];
          let cursor: SyncCursor = { rev: 0, key: '' };
          for (;;) {
            const reply = await api.changes({
              since: cursor.rev,
              after: cursor.key,
              limit: 500,
              deviceId: meta.deviceId,
            });
            if (!reply.ok) throw reply;
            items.push(...reply.data.items);
            cursor = reply.data.next;
            if (!reply.data.more) break;
          }
          const result = applyRemote(emptyLibrary(), {}, items, {
            ctx: { now: new Date(deps.now()).toISOString(), newId: () => '' },
            lastSyncAt: null,
            fullResync: false,
            conflictId: deps.newConflictId,
          });
          if (result.held.length) throw Error('보관함을 모두 읽지 못했어요');
          const replaced = await deps.runLibrary(
            Effect.flatMap(LibraryStore, (store) =>
              store.replace(
                repairLibrary(result.lib, {
                  now: new Date(deps.now()).toISOString(),
                  newId: () => '',
                }),
                { requirePrevious: hasAnyEntry(loaded.library) },
              ),
            ),
          );
          setLibrary(replaced.library);
          writeBase(storage, meta.userId!, result.base);
          meta = { ...meta, cursor };
        } else if (readBase(storage).userId !== meta.userId) writeBase(storage, meta.userId!, {});
        writeSyncMeta(storage, { ...meta, enabled: true, pendingChoice: false });
        return engine.runNow('connect');
      } catch (error) {
        return failed(error);
      }
    },
    async resolveConflict(id, action) {
      const conflicts = readConflicts(storage);
      const c = conflicts.find((c) => c.id === id);
      if (!c) return;
      if (action === 'mine') {
        const lib = await deps.runLibrary(
          Effect.flatMap(LibraryStore, (store) =>
            store.update((current) => {
              const p = parseItemKey(c.key)!;
              const doc = getItem(current, p.kind, p.id);
              if (!doc) return Effect.succeed(current);
              const now = new Date(deps.now()).toISOString();
              const next =
                c.whole || c.deleted
                  ? reviveAsLatest(c.mine as AnyItem, now)
                  : replacePath(doc, c.path, c.mine, now);
              return Effect.succeed(putItems(current, [{ ...p, doc: next }]));
            }),
          ),
        );
        setLibrary(lib);
      }
      writeConflicts(
        storage,
        conflicts.filter((c) => c.id !== id),
      );
      engine.schedule('manual');
    },
    async resolveHeld(key, action) {
      const meta = readSyncMeta(storage);
      const p = parseItemKey(key);
      if (!p) return;
      let skip = action === 'skip';
      if (action === 'mine') {
        const lib = await deps.runLibrary(
          Effect.flatMap(LibraryStore, (store) =>
            store.update((current) => {
              const doc = getItem(current, p.kind, p.id);
              if (!doc) skip = true;
              return Effect.succeed(
                doc
                  ? putItems(current, [
                      { ...p, doc: reviveAsLatest(doc, new Date(deps.now()).toISOString()) },
                    ])
                  : current,
              );
            }),
          ),
        );
        setLibrary(lib);
      }
      writeSyncMeta(storage, {
        ...meta,
        held: meta.held.filter((h) => h.key !== key),
        skipped: skip ? [...new Set([...meta.skipped, key])] : meta.skipped,
      });
      engine.schedule('manual');
    },
    disable() {
      generation++;
      writeSyncMeta(storage, { ...readSyncMeta(storage), enabled: false });
      engine.stop();
      publish({ ...OFF_STATUS });
    },
    enable() {
      writeSyncMeta(storage, { ...readSyncMeta(storage), enabled: true });
      engine.start();
    },
    async disconnect() {
      generation++;
      engine.stop();
      try {
        await api.client.endSession();
      } finally {
        clearSession(storage);
        writeSyncMeta(storage, { ...readSyncMeta(storage), enabled: false, pendingChoice: false });
        publish({ ...OFF_STATUS });
      }
    },
    async deleteServerData() {
      const reply = await api.deleteAccount();
      if (!reply.ok) return false;
      generation++;
      engine.stop();
      clearSession(storage);
      clearSyncRecords(storage);
      writeSyncMeta(storage, {
        ...readSyncMeta(storage),
        enabled: false,
        pendingChoice: false,
        userId: null,
        provider: null,
        accountLabel: null,
      });
      publish({ ...OFF_STATUS });
      return true;
    },
    onRunFinished(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isOwnWrite(lib) {
      return ownWrites.has(lib);
    },
  };
  return engine;
}
let singleton: LibrarySyncEngine | undefined;
export function ensureLibrarySyncEngine(): LibrarySyncEngine {
  if (singleton) return singleton;
  const storage = browserStorage() ?? createMemoryStorage();
  const config = readSyncClientConfig(import.meta.env, location.origin);
  const store = getDefaultStore();
  singleton = createLibrarySyncEngine({
    api: createSyncApi({
      config: config ?? {
        apiBase: location.origin + '/api/sync',
        firebase: null,
        kakao: null,
        naver: null,
        devFake: false,
      },
      storage,
      auth: config ? googleAuth(config) : null,
    }),
    storage,
    locks: navigator.locks,
    runLibrary: startEffect,
    setLibrary: (lib) => store.set(libraryAtom, lib),
    setStatus: (status) => store.set(syncStatusAtom, status),
    notify: (kind) =>
      kind === 'auth'
        ? toast('동기화 로그인이 끊겼어요')
        : toast('다른 기기 변경과 겹친 항목이 있어요', {
            action: { label: '확인', onClick: () => location.assign('/settings#sync') },
          }),
    now: Date.now,
    online: () => navigator.onLine,
    visible: () => document.visibilityState === 'visible',
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    events: window,
    newConflictId: () => crypto.randomUUID(),
  });
  if (!config) singleton.disable();
  return singleton;
}
