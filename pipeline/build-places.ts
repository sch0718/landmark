import { Lat, Lng } from 'src/schema/common';
import { safeParse } from 'src/schema/parse';
import type { Place, TripData } from 'src/schema/legacy/trip-data';
import type { TripSource } from 'src/schema/legacy/trip-source';
import type { Bookmark, FetchedFolder, NaverPlace } from './naver-client';

export type BuildPlacesReport = {
  excludedUnavailable: number;
  excludedOutOfRange: { sid: string; name: string }[];
};

export type BuildPlacesResult = {
  folders: TripData['folders'];
  places: Record<string, Place>;
  report: BuildPlacesReport;
};

type Occurrence = { folderId: string; bookmark: Bookmark };

const inRange = (b: Bookmark): boolean =>
  safeParse(Lng, b.px).success && safeParse(Lat, b.py).success;

/** 폴더에 저장된 장소의 sid. 사용 불가·범위 밖으로 제외된 북마크도 포함한다. */
export function folderSids(folders: FetchedFolder[]): Set<string> {
  return new Set(folders.flatMap((f) => f.bookmarks.map((b) => b.sid)));
}

/**
 * 네이버 폴더와 customPlaces로 places를 만든다(§3.2 중복 병합 표).
 * 폴더 ID는 yaml `folders` 순서대로 f1, f2 …. 폴더는 shareId로 찾으며 shareId는 출력에 넣지 않는다.
 * `count`는 그 폴더가 기여한 사용 가능·범위 안 북마크 수다.
 * `naverPlaces`(장소 ID로 지정한 곳)는 폴더에 같은 sid가 없을 때만 `n:<sid>`로 더한다.
 * 폴더에서 제외된(사용 불가·범위 밖) 장소는 naverPlaces로 되살리지 않고 폴더 쪽 제외 보고만 남긴다.
 */
export function buildPlaces(
  source: TripSource,
  folders: FetchedFolder[],
  naverPlaces: NaverPlace[] = [],
): BuildPlacesResult {
  const report: BuildPlacesReport = { excludedUnavailable: 0, excludedOutOfRange: [] };
  const outFolders: TripData['folders'] = [];
  const occurrences = new Map<string, Occurrence[]>();

  source.folders.forEach((shareId, index) => {
    const folderId = `f${index + 1}`;
    const fetched = folders.find((f) => f.shareId === shareId);
    let count = 0;
    for (const bookmark of fetched?.bookmarks ?? []) {
      if (!bookmark.available) {
        report.excludedUnavailable += 1;
        continue;
      }
      if (!inRange(bookmark)) {
        report.excludedOutOfRange.push({ sid: bookmark.sid, name: bookmark.name });
        continue;
      }
      count += 1;
      const list = occurrences.get(bookmark.sid) ?? [];
      list.push({ folderId, bookmark });
      occurrences.set(bookmark.sid, list);
    }
    outFolders.push({ id: folderId, name: fetched?.name ?? '', count });
  });

  const places: Record<string, Place> = {};
  for (const [sid, list] of occurrences) {
    // lastUpdateTime이 같으면 앞선 폴더의 값을 쓴다.
    const latest = list.reduce((best, cur) =>
      cur.bookmark.lastUpdateTime > best.bookmark.lastUpdateTime ? cur : best,
    );
    const place: Place = {
      name: latest.bookmark.name,
      address: latest.bookmark.address,
      lng: latest.bookmark.px,
      lat: latest.bookmark.py,
      category: latest.bookmark.mcidName,
      folderIds: list.map((o) => o.folderId),
      savedAt: new Date(Math.min(...list.map((o) => o.bookmark.creationTime))).toISOString(),
      sid,
    };
    if (source.publish.naverMemo) {
      const naverMemos = list
        .filter((o) => o.bookmark.memo.trim() !== '')
        .map((o) => ({ folderId: o.folderId, memo: o.bookmark.memo }));
      if (naverMemos.length > 0) place.naverMemos = naverMemos;
    }
    places[`n:${sid}`] = place;
  }

  const inFolders = folderSids(folders);
  for (const p of naverPlaces) {
    const key = `n:${p.sid}`;
    if (inFolders.has(p.sid) || places[key]) continue;
    if (!safeParse(Lng, p.lng).success || !safeParse(Lat, p.lat).success) {
      report.excludedOutOfRange.push({ sid: p.sid, name: p.name });
      continue;
    }
    places[key] = {
      name: p.name,
      address: p.address,
      lng: p.lng,
      lat: p.lat,
      category: p.category,
      folderIds: [],
      savedAt: null,
      sid: p.sid,
    };
  }

  for (const custom of source.customPlaces) {
    places[`c:${custom.key}`] = {
      name: custom.name,
      address: '',
      lng: custom.lng,
      lat: custom.lat,
      category: null,
      folderIds: [],
      savedAt: null,
    };
  }

  return { folders: outFolders, places, report };
}
