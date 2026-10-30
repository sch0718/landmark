import type { Library } from 'src/schema/library';
export const FOLDER_WATCH_KEY = 'tripmap:folder-watch:v1';
export const FOLDER_WATCH_INTERVAL_MS = 86_400_000;
export const FOLDER_WATCH_MAX_PER_RUN = 5;
export const FOLDER_WATCH_MAX_MANUAL = 20;
export const FOLDER_WATCH_MANUAL_GAP_MS = 60_000;
export const FOLDER_WATCH_DELAY_MS = 3_000;
export const FOLDER_WATCH_LOCK = 'tripmap:folder-watch';
export type FolderWatchEntry = {
  checkedAt: number;
  /** 마지막 성공 확인. 없으면 옛 v1 기록의 checkedAt을 쓴다. null은 성공 이력이 없음. */
  okAt?: number | null;
  fresh: number;
  missing: number;
  signature: string | null;
  notified: string | null;
  error: 'not-found' | null;
};
export type FolderWatchState = {
  v: 1;
  enabled: boolean;
  lastRunAt: number | null;
  lastManualAt: number | null;
  folders: Record<string, FolderWatchEntry>;
};
export const EMPTY_FOLDER_WATCH: FolderWatchState = {
  v: 1,
  enabled: true,
  lastRunAt: null,
  lastManualAt: null,
  folders: {},
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nullableTime = (v: unknown) => v === null || integer(v);
const nullableString = (v: unknown) => v === null || typeof v === 'string';
export function readFolderWatch(storage: Storage | undefined): FolderWatchState {
  try {
    const v: unknown = JSON.parse(storage?.getItem(FOLDER_WATCH_KEY) ?? 'null');
    if (
      record(v) &&
      v.v === 1 &&
      typeof v.enabled === 'boolean' &&
      nullableTime(v.lastRunAt) &&
      nullableTime(v.lastManualAt) &&
      record(v.folders)
    ) {
      const folders: Record<string, FolderWatchEntry> = {};
      for (const [id, entry] of Object.entries(v.folders))
        if (
          record(entry) &&
          integer(entry.checkedAt) &&
          (entry.okAt === undefined || nullableTime(entry.okAt)) &&
          integer(entry.fresh) &&
          integer(entry.missing) &&
          nullableString(entry.signature) &&
          nullableString(entry.notified) &&
          (entry.error === null || entry.error === 'not-found')
        )
          folders[id] = entry as FolderWatchEntry;
      return {
        v: 1,
        enabled: v.enabled,
        lastRunAt: v.lastRunAt as number | null,
        lastManualAt: v.lastManualAt as number | null,
        folders,
      };
    }
  } catch {
    /* 깨진 기록은 버린다. */
  }
  return { ...EMPTY_FOLDER_WATCH, folders: {} };
}
export function writeFolderWatch(storage: Storage | undefined, state: FolderWatchState): void {
  try {
    storage?.setItem(FOLDER_WATCH_KEY, JSON.stringify(state));
  } catch {
    console.warn('네이버 폴더 확인 기록을 저장하지 못했어요');
  }
}
export function liveLinkIds(lib: Library): string[] {
  return Object.keys(lib.folders ?? {}).filter((id) => {
    const link = lib.folders![id]!;
    const label = lib.labels[link.labelId.value];
    return link.deletedAt === null && label !== undefined && label.deletedAt === null;
  });
}
export function dueFolders(
  lib: Library,
  state: FolderWatchState,
  now: number,
  opts: { interval?: number; max?: number; ignoreInterval?: boolean } = {},
): string[] {
  const at = (id: string) =>
    Math.max(state.folders[id]?.checkedAt ?? 0, Date.parse(lib.folders![id]!.checkedAt));
  return liveLinkIds(lib)
    .filter(
      (id) => opts.ignoreInterval || now - at(id) >= (opts.interval ?? FOLDER_WATCH_INTERVAL_MS),
    )
    .sort((a, b) => at(a) - at(b) || a.localeCompare(b))
    .slice(0, opts.max ?? FOLDER_WATCH_MAX_PER_RUN);
}
