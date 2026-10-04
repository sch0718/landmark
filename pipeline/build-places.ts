import { Lat, Lng } from 'src/schema/common';
import type { Place, TripData } from 'src/schema/trip-data';
import type { TripSource } from 'src/schema/trip-source';
import type { Bookmark, FetchedFolder } from './naver-client';

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
  Lng.safeParse(b.px).success && Lat.safeParse(b.py).success;

/**
 * 네이버 폴더와 customPlaces로 places를 만든다(§3.2 중복 병합 표).
 * 폴더 ID는 yaml `folders` 순서대로 f1, f2 …. 폴더는 shareId로 찾으며 shareId는 출력에 넣지 않는다.
 * `count`는 그 폴더가 기여한 사용 가능·범위 안 북마크 수다.
 */
export function buildPlaces(source: TripSource, folders: FetchedFolder[]): BuildPlacesResult {
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
