import { afterEach, expect, it } from 'vitest';
import {
  dueFolders,
  liveLinkIds,
  readFolderWatch,
  writeFolderWatch,
  EMPTY_FOLDER_WATCH,
  FOLDER_WATCH_KEY,
} from 'src/services/folder-watch/state';
import { recordFolderLink } from 'src/domain/library/folder-links';
import { makeLibrary, label } from '../domain/backup/fixtures';
const now = Date.parse('2026-10-30T00:00:00Z');
function library(n = 1) {
  let lib = makeLibrary({ labels: [label(1)] });
  for (let i = 0; i < n; i++)
    lib = recordFolderLink(
      lib,
      {
        shareId: String(i).padStart(32, 'a'),
        folderName: '폴더',
        labelId: label(1).id,
        seenSids: [],
      },
      { now: new Date(now - (i + 2) * 86400000).toISOString(), newId: () => '' },
    );
  return lib;
}
afterEach(() => localStorage.clear());
it('깨진 전체 기록과 항목 하나를 따로 버린다', () => {
  expect(readFolderWatch(localStorage)).toEqual(EMPTY_FOLDER_WATCH);
  localStorage.setItem(FOLDER_WATCH_KEY, '{');
  expect(readFolderWatch(localStorage)).toEqual(EMPTY_FOLDER_WATCH);
  const entry = { checkedAt: 1, fresh: 1, missing: 0, signature: 'a', notified: null, error: null };
  writeFolderWatch(localStorage, {
    ...EMPTY_FOLDER_WATCH,
    folders: { valid: entry, invalid: {} as typeof entry },
  });
  expect(readFolderWatch(localStorage).folders).toEqual({ valid: entry });
});
it('살아 있는 라벨과 연결만 고르고 오래된 다섯 개를 먼저 확인한다', () => {
  const lib = library(7);
  const ids = liveLinkIds(lib);
  expect(ids).toHaveLength(7);
  expect(dueFolders(lib, EMPTY_FOLDER_WATCH, now)).toEqual([...ids].reverse().slice(0, 5));
  expect(dueFolders(lib, EMPTY_FOLDER_WATCH, now, { max: 20, ignoreInterval: true })).toHaveLength(
    7,
  );
  const first = ids[0]!;
  const link = lib.folders![first]!;
  expect(
    liveLinkIds({
      ...lib,
      labels: { [label(1).id]: { ...label(1), deletedAt: '2026-10-30T00:00:00Z' } },
    }),
  ).toEqual([]);
  expect(
    liveLinkIds({ ...lib, folders: { [first]: { ...link, deletedAt: '2026-10-30T00:00:00Z' } } }),
  ).toEqual([]);
});
it('연결과 확인 기록 중 더 늦은 시각을 기준으로 하루를 센다', () => {
  const lib = library();
  const id = liveLinkIds(lib)[0]!;
  const link = lib.folders![id]!;
  expect(dueFolders(lib, EMPTY_FOLDER_WATCH, now)).toEqual([id]);
  const recent = {
    ...lib,
    folders: { [id]: { ...link, checkedAt: new Date(now - 3600000).toISOString() } },
  };
  expect(dueFolders(recent, EMPTY_FOLDER_WATCH, now)).toEqual([]);
  const state = {
    ...EMPTY_FOLDER_WATCH,
    folders: {
      [id]: {
        checkedAt: now - 3600000,
        fresh: 0,
        missing: 0,
        signature: null,
        notified: null,
        error: null,
      },
    },
  };
  expect(dueFolders(lib, state, now)).toEqual([]);
  expect(dueFolders(recent, state, now, { ignoreInterval: true })).toEqual([id]);
  state.folders[id]!.checkedAt = now - 2 * 86400000;
  expect(dueFolders(lib, state, now)).toEqual([id]);
});
