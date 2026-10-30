import { Effect } from 'effect';
import { getDefaultStore } from 'jotai';
import { toast } from 'sonner';
import { liveFolderLink, planFolderSync } from 'src/domain/library/folder-links';
import type { FolderItem } from 'src/domain/library/add-place';
import { hashItem } from 'src/domain/library-sync/items';
import { setField } from 'src/domain/library/lww';
import { startEffect } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { paths } from 'src/routes/paths';
import { browserStorage } from 'src/services/browser-storage';
import { PlaceLookup } from 'src/services/place-lookup';
import { PlaceLookupError } from 'src/services/errors';
import { LibraryStore } from 'src/services/library-store';
import { libraryAtom, reflectSaved } from 'src/stores/library-state';
import { openFolderSyncAtom } from 'src/stores/add-place';
import { folderWatchAtom } from 'src/stores/folder-watch';
import {
  dueFolders,
  liveLinkIds,
  readFolderWatch,
  writeFolderWatch,
  FOLDER_WATCH_LOCK,
  FOLDER_WATCH_MANUAL_GAP_MS,
  FOLDER_WATCH_MAX_MANUAL,
  FOLDER_WATCH_MAX_PER_RUN,
  type FolderWatchState,
  type FolderWatchEntry,
} from './state';
export type FolderLookup = (
  shareId: string,
) => Promise<{ ok: true; items: readonly FolderItem[] } | { ok: false; code: string }>;
export type FolderChange = { shareId: string; name: string; fresh: number; missing: number };
export type FolderWatchRun = {
  checked: number;
  failed: number;
  changes: FolderChange[];
  skipped?: 'disabled' | 'busy' | 'gap' | 'none';
};
export type FolderWatchDeps = {
  storage: Storage | undefined;
  library(): Library;
  lookup: FolderLookup;
  now(): number;
  locks?: Pick<LockManager, 'request'>;
  onState?(state: FolderWatchState): void;
};
export function folderSignature(
  freshSids: readonly string[],
  missingSids: readonly string[],
): string {
  return hashItem([[...freshSids].sort(), [...missingSids].sort()]);
}
export async function runFolderWatch(
  deps: FolderWatchDeps,
  opts: { manual?: boolean } = {},
): Promise<FolderWatchRun> {
  const empty = (skipped: NonNullable<FolderWatchRun['skipped']>): FolderWatchRun => ({
    checked: 0,
    failed: 0,
    changes: [],
    skipped,
  });
  const run = async (): Promise<FolderWatchRun> => {
    let state = readFolderWatch(deps.storage);
    const now = deps.now();
    if (!opts.manual && !state.enabled) return empty('disabled');
    if (
      opts.manual &&
      state.lastManualAt !== null &&
      now - state.lastManualAt < FOLDER_WATCH_MANUAL_GAP_MS
    )
      return empty('gap');
    const save = () => {
      state = { ...state, enabled: readFolderWatch(deps.storage).enabled };
      writeFolderWatch(deps.storage, state);
      deps.onState?.(state);
    };
    const prune = () => {
      const live = new Set(liveLinkIds(deps.library()));
      state = {
        ...state,
        folders: Object.fromEntries(Object.entries(state.folders).filter(([id]) => live.has(id))),
      };
    };
    prune();
    const ids = dueFolders(
      deps.library(),
      state,
      now,
      opts.manual
        ? { ignoreInterval: true, max: FOLDER_WATCH_MAX_MANUAL }
        : { max: FOLDER_WATCH_MAX_PER_RUN },
    );
    if (!ids.length) {
      if (opts.manual) state = { ...state, lastManualAt: now };
      save();
      return empty('none');
    }
    const changes: FolderChange[] = [];
    let checked = 0;
    let failed = 0;
    const stopped = () => {
      const latest = readFolderWatch(deps.storage);
      if (opts.manual || latest.enabled) return false;
      deps.onState?.(latest);
      return true;
    };
    for (const id of ids) {
      if (stopped()) return { checked, failed, changes: [], skipped: 'disabled' };
      if (!liveFolderLink(deps.library(), id)) continue;
      let result;
      try {
        result = await deps.lookup(id);
      } catch {
        result = { ok: false as const, code: 'UNKNOWN' };
      }
      if (stopped()) return { checked, failed, changes: [], skipped: 'disabled' };
      const lib = deps.library();
      const link = liveFolderLink(lib, id);
      if (!link) continue;
      checked++;
      const prev = state.folders[id];
      let entry: FolderWatchEntry;
      if (result.ok) {
        const plan = planFolderSync(lib, link, result.items);
        const fresh = plan.fresh.length;
        const missing = plan.missing.length;
        const signature = folderSignature(
          plan.fresh.map((f) => f.item.sid),
          plan.missing.map((m) => m.sid),
        );
        let notified = prev?.notified ?? null;
        if (fresh + missing > 0 && signature !== notified) {
          changes.push({ shareId: id, name: link.name.value, fresh, missing });
          notified = signature;
        }
        entry = { checkedAt: now, okAt: now, fresh, missing, signature, notified, error: null };
      } else if (result.code === 'NOT_FOUND')
        entry = {
          checkedAt: now,
          okAt: now,
          fresh: 0,
          missing: 0,
          signature: null,
          notified: prev?.notified ?? null,
          error: 'not-found',
        };
      else {
        failed++;
        entry = {
          ...(prev ?? { fresh: 0, missing: 0, signature: null, notified: null, error: null }),
          checkedAt: now,
          okAt: prev ? (prev.okAt === undefined ? prev.checkedAt : prev.okAt) : null,
        };
      }
      state = { ...state, folders: { ...state.folders, [id]: entry } };
      save();
    }
    prune();
    state = {
      ...state,
      ...(checked > failed
        ? { lastRunAt: now, ...(opts.manual ? { lastManualAt: now } : {}) }
        : {}),
    };
    save();
    return { checked, failed, changes };
  };
  const state = readFolderWatch(deps.storage);
  if (!opts.manual && !state.enabled) return empty('disabled');
  if (
    opts.manual &&
    state.lastManualAt !== null &&
    deps.now() - state.lastManualAt < FOLDER_WATCH_MANUAL_GAP_MS
  )
    return empty('gap');
  return deps.locks
    ? deps.locks.request(FOLDER_WATCH_LOCK, { ifAvailable: true }, (lock) =>
        lock === null ? Promise.resolve(empty('busy')) : run(),
      )
    : run();
}
export function changeMessage(changes: readonly FolderChange[]): string {
  if (changes.length === 1) {
    const c = changes[0]!;
    const name = c.name || '이름 없는 폴더';
    return c.fresh > 0
      ? `‘${name}’ 폴더에 새로 저장한 곳이 ${c.fresh}곳 있어요${c.missing > 0 ? ` · 빠진 곳 ${c.missing}곳` : ''}`
      : `‘${name}’ 폴더에서 빠진 곳이 ${c.missing}곳 있어요`;
  }
  const fresh = changes.reduce((n, c) => n + c.fresh, 0);
  return `네이버 폴더 ${changes.length}개가 바뀌었어요${fresh > 0 ? ` (새로 저장한 곳 ${fresh}곳)` : ''}`;
}
export async function startFolderWatch(opts: {
  navigate(path: string): void;
  manual?: boolean;
}): Promise<FolderWatchRun> {
  const store = getDefaultStore();
  const result = await runFolderWatch(
    {
      storage: browserStorage(),
      library: () => store.get(libraryAtom),
      now: Date.now,
      locks: navigator.locks,
      onState: (s) => store.set(folderWatchAtom, s),
      lookup: (id) =>
        startEffect(
          Effect.gen(function* () {
            const r = yield* (yield* PlaceLookup).lookupFolder(id);
            return { ok: true as const, items: r.places };
          }).pipe(
            Effect.catch((e) =>
              Effect.succeed({
                ok: false as const,
                code: e instanceof PlaceLookupError ? e.code : 'UNKNOWN',
              }),
            ),
          ),
        ),
    },
    opts,
  );
  const changes = result.changes;
  if (changes.length === 1)
    toast(changeMessage(changes), {
      action: {
        label: '가져오기',
        onClick: () => store.set(openFolderSyncAtom, changes[0]!.shareId, null),
      },
    });
  else if (changes.length > 1)
    toast(changeMessage(changes), {
      action: { label: '보기', onClick: () => opts.navigate(paths.labels) },
    });
  else if (opts.manual && !result.skipped)
    toast(
      result.failed === result.checked && result.failed > 0
        ? '네이버 폴더를 확인하지 못했어요. 잠시 뒤 다시 해 주세요'
        : `바뀐 네이버 폴더가 없어요${result.failed > 0 ? ` (확인하지 못한 폴더 ${result.failed}개)` : ''}`,
    );
  else if (result.skipped === 'gap') toast('잠시 뒤에 다시 확인해 주세요');
  return result;
}
declare global {
  interface Window {
    __landmarkDev?: {
      [key: string]: unknown;
      forgetFolderSids?(shareId: string, count?: number): Promise<void>;
    };
  }
}
export function installFolderWatchDevTools(): void {
  if (!import.meta.env.DEV) return;
  window.__landmarkDev = {
    ...window.__landmarkDev,
    forgetFolderSids: async (shareId, count = 1) => {
      const store = getDefaultStore();
      const before = store.get(libraryAtom);
      const saved = await startEffect(
        Effect.gen(function* () {
          return yield* (yield* LibraryStore).update((lib) => {
            const link = liveFolderLink(lib, shareId);
            if (!link) return Effect.succeed(lib);
            const trim = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
            const seenSids = setField(
              link.seenSids,
              link.seenSids.value.slice(0, Math.max(0, link.seenSids.value.length - trim)),
              new Date().toISOString(),
            );
            return Effect.succeed({
              ...lib,
              folders: { ...lib.folders, [shareId]: { ...link, seenSids } },
            });
          });
        }),
      );
      await reflectSaved(store, before, saved);
    },
  };
}
