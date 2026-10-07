import type { Bounds } from 'src/components/map/MapAdapter';
import type { EffectiveTrip } from 'src/domain/overlay';
import { effectiveCategory } from 'src/domain/place-category';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';

export type ExploreFilter = {
  folderIds: string[];
  categories: string[];
  tags: string[];
  hasMemo: boolean;
  inItinerary: 'any' | 'in' | 'out';
  showHidden: boolean;
  query: string;
  inViewOnly: boolean;
};

export const DEFAULT_FILTER: ExploreFilter = {
  folderIds: [],
  categories: [],
  tags: [],
  hasMemo: false,
  inItinerary: 'any',
  showHidden: false,
  query: '',
  inViewOnly: false,
};

/** category가 null인 장소를 가리키는 표시·필터 값. */
export const UNCATEGORIZED = '미분류';

/** 편집 레이어의 분류를 적용한 분류별 장소 수. */
export function categoryCounts(
  trip: TripData,
  edit: EditLayer | null,
): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const [key, place] of Object.entries(trip.places)) {
    const c = effectiveCategory(place, edit?.places[key]) ?? UNCATEGORIZED;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'ko'));
}

/** 편집 레이어에 쓰인 모든 태그(가나다순). */
export function allTags(edit: EditLayer | null): string[] {
  const set = new Set<string>();
  for (const p of Object.values(edit?.places ?? {}))
    for (const t of p.tags?.value ?? []) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

/**
 * 필터를 통과한 placeKey 목록(trip.places 순서). 같은 항목 안은 합집합, 항목 사이는 교집합이다.
 * 검색은 이름·주소·네이버 메모·사용자 메모(null 제외)·태그를 대소문자만 무시하고 `includes`로 본다.
 */
export function filterPlaces(
  trip: TripData,
  edit: EditLayer | null,
  eff: EffectiveTrip,
  f: ExploreFilter,
  bounds?: Bounds,
): string[] {
  const inItinerary = new Set<string>();
  for (const day of eff.days) for (const s of day.stops) inItinerary.add(s.placeKey);
  const query = f.query.trim().toLowerCase();

  const result: string[] = [];
  for (const [key, place] of Object.entries(trip.places)) {
    const pe = edit?.places[key];
    if (!f.showHidden && pe?.hidden?.value) continue;
    if (f.folderIds.length > 0 && !place.folderIds.some((id) => f.folderIds.includes(id))) continue;
    if (
      f.categories.length > 0 &&
      !f.categories.includes(effectiveCategory(place, pe) ?? UNCATEGORIZED)
    )
      continue;
    const tags = pe?.tags?.value ?? [];
    if (f.tags.length > 0 && !tags.some((t) => f.tags.includes(t))) continue;

    const userMemos = Object.values(pe?.memos ?? {}).flatMap((m) =>
      m.text === null ? [] : [m.text],
    );
    const naverMemos = (place.naverMemos ?? []).map((m) => m.memo);
    if (f.hasMemo && userMemos.length === 0 && naverMemos.length === 0) continue;
    if (f.inItinerary === 'in' && !inItinerary.has(key)) continue;
    if (f.inItinerary === 'out' && inItinerary.has(key)) continue;
    if (f.inViewOnly && bounds) {
      if (
        place.lng < bounds.west ||
        place.lng > bounds.east ||
        place.lat < bounds.south ||
        place.lat > bounds.north
      )
        continue;
    }
    if (query) {
      const hay = [place.name, place.address, ...naverMemos, ...userMemos, ...tags];
      if (!hay.some((s) => s.toLowerCase().includes(query))) continue;
    }
    result.push(key);
  }
  return result;
}
