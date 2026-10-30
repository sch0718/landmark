import { atom, type PrimitiveAtom, type WritableAtom } from 'jotai';
import { atomWithLazy } from 'jotai/utils';
import type { FolderLink } from 'src/schema/library';
import { browserStorage } from 'src/services/browser-storage';
import {
  readFolderWatch,
  writeFolderWatch,
  type FolderWatchState,
  type FolderWatchEntry,
} from 'src/services/folder-watch/state';
import { localDate } from 'src/lib/local-date';
export const folderWatchAtom: PrimitiveAtom<FolderWatchState> = atomWithLazy(() =>
  readFolderWatch(browserStorage()),
);
export const setFolderWatchEnabledAtom: WritableAtom<null, [boolean], void> = atom(
  null,
  (_get, set, enabled: boolean) => {
    const state = { ...readFolderWatch(browserStorage()), enabled };
    writeFolderWatch(browserStorage(), state);
    set(folderWatchAtom, state);
  },
);
export type FolderNotice = { fresh: number; missing: number; checkedAt: number; notFound: boolean };
export function folderNotice(
  link: FolderLink,
  entry: FolderWatchEntry | undefined,
): FolderNotice | null {
  if (
    !entry ||
    entry.checkedAt <= Date.parse(link.checkedAt) ||
    (entry.error === null && entry.fresh + entry.missing === 0)
  )
    return null;
  return {
    fresh: entry.fresh,
    missing: entry.missing,
    checkedAt: entry.checkedAt,
    notFound: entry.error === 'not-found',
  };
}
export function labelNoticeText(notices: readonly (FolderNotice | null)[]): string | null {
  const fresh = notices.reduce((n, e) => n + (e?.notFound ? 0 : (e?.fresh ?? 0)), 0);
  const missing = notices.reduce((n, e) => n + (e?.notFound ? 0 : (e?.missing ?? 0)), 0);
  return fresh > 0
    ? ` · 새로 저장한 곳 ${fresh}곳`
    : missing > 0
      ? ` · 폴더에서 빠진 곳 ${missing}곳`
      : null;
}
export function folderNoticeText(notice: FolderNotice): string {
  if (notice.notFound)
    return '마지막 확인 때 폴더를 찾지 못했어요. 네이버에서 공유를 껐을 수 있어요';
  const date = localDate(new Date(notice.checkedAt).toISOString()).slice(5);
  const text =
    notice.fresh > 0
      ? `네이버에 새로 저장한 곳 ${notice.fresh}곳${notice.missing > 0 ? ` · 빠진 곳 ${notice.missing}곳` : ''}`
      : `네이버 폴더에서 빠진 곳 ${notice.missing}곳`;
  return `${text} (${date} 확인)`;
}
