import type { Label, Library, Place } from 'src/schema/library';
import { regionsByPlace } from 'src/domain/library/region';
import { isVisited, reviewOf, visitedOnOf } from 'src/domain/library/visit';

/** 방문 필터: 전체 / 안 가 본 곳 / 가 본 곳. */
export type VisitFilter = 'all' | 'unvisited' | 'visited';

export type LibraryQuery = {
  labelIds: string[];
  mode: 'any' | 'all';
  unlabeled: boolean;
  regions: string[];
  text: string;
  /** 방문 조건. 저장되는 선호이므로 `sort`와 달리 새 선택 키로만 더했다(`다녀온 날순`은 저장하지 않는다). */
  visited: VisitFilter;
  sort: 'recent' | 'name' | 'label';
};

export const DEFAULT_QUERY: LibraryQuery = {
  labelIds: [],
  mode: 'any',
  unlabeled: false,
  regions: [],
  text: '',
  visited: 'all',
  sort: 'recent',
};

const OTHER_REGION = '기타';
const compareKo = (a: string, b: string): number => a.localeCompare(b, 'ko');

export function livePlaces(lib: Library): Place[] {
  return Object.values(lib.places).filter((p) => p.deletedAt === null && p.saved.value === true);
}

export function liveLabels(lib: Library): Label[] {
  return Object.values(lib.labels)
    .filter((l) => l.deletedAt === null)
    .sort((a, b) => a.order.value - b.order.value || a.id.localeCompare(b.id));
}

function foldText(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase('ko-KR');
}

/**
 * 이름·주소로 장소를 찾는다. 보관함 목록과 달리 `saved: false`(보관함에서 숨긴 장소)도 포함하고
 * 지운 장소는 뺀다. 검색어가 비면 전부, 이름순(한국어)이다. 여행의 출발지·숙소 고르기가 쓴다.
 */
export function searchPlaces(lib: Library, text: string): Place[] {
  const needle = foldText(text.trim());
  return Object.values(lib.places)
    .filter(
      (p) =>
        p.deletedAt === null &&
        (needle === '' ||
          foldText(p.name.value).includes(needle) ||
          foldText(p.address).includes(needle)),
    )
    .sort((a, b) => compareKo(a.name.value, b.name.value) || a.id.localeCompare(b.id));
}

/** 장소에 붙은 라벨 중 지워지지 않은 것만, 보관함의 라벨 순서대로. */
function labelsOf(place: Place, byId: ReadonlyMap<string, Label>): Label[] {
  const labels: Label[] = [];
  for (const id of place.labelIds.value) {
    const label = byId.get(id);
    if (label !== undefined) labels.push(label);
  }
  return labels.sort(
    (a, b) => a.order.value - b.order.value || compareKo(a.name.value, b.name.value),
  );
}

type Context = {
  byId: ReadonlyMap<string, Label>;
  needle: string;
  regions: ReadonlySet<string>;
  /** 장소 id → 지역(주소가 없으면 가까운 장소에서 빌린 지역). */
  regionOf: ReadonlyMap<string, string>;
};

function contextOf(lib: Library, q: LibraryQuery): Context {
  return {
    byId: new Map(liveLabels(lib).map((l) => [l.id, l])),
    needle: foldText(q.text.trim()),
    regions: new Set(q.regions),
    regionOf: regionsByPlace(livePlaces(lib)),
  };
}

function matchesText(place: Place, labels: readonly Label[], needle: string): boolean {
  if (needle === '') return true;
  const haystacks = [
    place.name.value,
    place.address,
    place.memo.value,
    reviewOf(place),
    ...labels.map((l) => l.name.value),
  ];
  return haystacks.some((h) => foldText(h).includes(needle));
}

function matchesVisit(place: Place, q: LibraryQuery): boolean {
  if (q.visited === 'all') return true;
  return isVisited(place) === (q.visited === 'visited');
}

function matchesRegion(place: Place, ctx: Context): boolean {
  return ctx.regions.size === 0 || ctx.regions.has(ctx.regionOf.get(place.id) ?? OTHER_REGION);
}

function matchesLabels(labels: readonly Label[], q: LibraryQuery): boolean {
  if (q.unlabeled) return labels.length === 0;
  if (q.labelIds.length === 0) return true;
  const own = new Set(labels.map((l) => l.id));
  return q.mode === 'all'
    ? q.labelIds.every((id) => own.has(id))
    : q.labelIds.some((id) => own.has(id));
}

function compareRecent(a: Place, b: Place): number {
  // 최근 저장순: 저장한 시각(없으면 만든 시각)이 늦은 것이 앞.
  if (a.saved.updatedAt !== b.saved.updatedAt)
    return a.saved.updatedAt > b.saved.updatedAt ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/** 대표 라벨: `labelIds` 순서(첫 번째가 대표)에서 처음으로 지워지지 않은 라벨. */
function representativeLabel(place: Place, byId: ReadonlyMap<string, Label>): Label | undefined {
  for (const id of place.labelIds.value) {
    const label = byId.get(id);
    if (label !== undefined) return label;
  }
  return undefined;
}

function sortPlaces(places: Place[], q: LibraryQuery, byId: ReadonlyMap<string, Label>): Place[] {
  if (q.sort === 'name') {
    return places.sort((a, b) => compareKo(a.name.value, b.name.value) || compareRecent(a, b));
  }
  if (q.sort === 'label') {
    const first = new Map(places.map((p) => [p.id, representativeLabel(p, byId)]));
    return places.sort((a, b) => {
      const la = first.get(a.id);
      const lb = first.get(b.id);
      if (la === undefined && lb !== undefined) return 1;
      if (la !== undefined && lb === undefined) return -1;
      const byLabel =
        la !== undefined && lb !== undefined
          ? la.order.value - lb.order.value || compareKo(la.name.value, lb.name.value)
          : 0;
      return byLabel || compareKo(a.name.value, b.name.value) || compareRecent(a, b);
    });
  }
  return places.sort(compareRecent);
}

/** 보이는 장소를 조건에 맞게 걸러 정렬한다. `unlabeled`가 켜지면 `labelIds`는 무시한다. */
export function queryPlaces(lib: Library, q: LibraryQuery): Place[] {
  const ctx = contextOf(lib, q);
  const matched = livePlaces(lib).filter((p) => {
    const labels = labelsOf(p, ctx.byId);
    return (
      matchesText(p, labels, ctx.needle) &&
      matchesRegion(p, ctx) &&
      matchesLabels(labels, q) &&
      matchesVisit(p, q)
    );
  });
  return sortPlaces(matched, q, ctx.byId);
}

/**
 * 다녀온 날 내림차순(날짜가 없는 곳은 뒤), 같으면 최근 저장순으로 새 배열을 만든다.
 * 저장하는 정렬이 아니라서 `queryPlaces`는 부르지 않고, 화면이 `다녀온 날순`을 켰을 때만 결과에 적용한다.
 */
export function sortByVisited(places: readonly Place[]): Place[] {
  return [...places].sort((a, b) => {
    const da = visitedOnOf(a);
    const db = visitedOnOf(b);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da > db ? -1 : 1;
    }
    return compareRecent(a, b);
  });
}

/** 보관함에 다녀온 곳(살아 있고 `saved: true`)이 하나라도 있는가. */
export function hasVisited(lib: Library): boolean {
  return livePlaces(lib).some(isVisited);
}

/** 방문 칩 숫자. 검색·지역·라벨 조건을 적용하고 방문 조건은 빼고 센다. */
export function visitCounts(lib: Library, q: LibraryQuery): { visited: number; unvisited: number } {
  const ctx = contextOf(lib, q);
  const counts = { visited: 0, unvisited: 0 };
  for (const p of livePlaces(lib)) {
    const labels = labelsOf(p, ctx.byId);
    if (!matchesText(p, labels, ctx.needle) || !matchesRegion(p, ctx) || !matchesLabels(labels, q))
      continue;
    if (isVisited(p)) counts.visited += 1;
    else counts.unvisited += 1;
  }
  return counts;
}

/** 라벨 칩 숫자. 텍스트·지역·방문 필터를 적용하고 라벨 필터는 빼고 센다. 라벨 없음은 `'unlabeled'` 키. */
export function labelCounts(lib: Library, q: LibraryQuery): Map<string | 'unlabeled', number> {
  const ctx = contextOf(lib, q);
  const counts = new Map<string | 'unlabeled', number>([['unlabeled', 0]]);
  for (const id of ctx.byId.keys()) counts.set(id, 0);
  for (const p of livePlaces(lib)) {
    const labels = labelsOf(p, ctx.byId);
    if (!matchesText(p, labels, ctx.needle) || !matchesRegion(p, ctx) || !matchesVisit(p, q))
      continue;
    if (labels.length === 0) counts.set('unlabeled', (counts.get('unlabeled') ?? 0) + 1);
    for (const l of labels) counts.set(l.id, (counts.get(l.id) ?? 0) + 1);
  }
  return counts;
}

/**
 * 지역 칩 숫자. 텍스트·라벨·방문 필터를 적용하고 지역 필터는 빼고 센다.
 * 개수 내림차순, 같으면 이름순, `기타`는 마지막.
 */
export function regionCounts(
  lib: Library,
  q: LibraryQuery,
): Array<{ region: string; count: number }> {
  const ctx = contextOf(lib, q);
  const counts = new Map<string, number>();
  for (const p of livePlaces(lib)) {
    const labels = labelsOf(p, ctx.byId);
    if (!matchesText(p, labels, ctx.needle) || !matchesLabels(labels, q) || !matchesVisit(p, q))
      continue;
    const region = ctx.regionOf.get(p.id) ?? OTHER_REGION;
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => {
      if ((a.region === OTHER_REGION) !== (b.region === OTHER_REGION)) {
        return a.region === OTHER_REGION ? 1 : -1;
      }
      return b.count - a.count || compareKo(a.region, b.region);
    });
}

/**
 * 그 지역의 보관함 장소 id(지역 칩과 같은 `regionsByPlace` 기준). 검색·라벨 필터와 상관없이 살아 있는
 * `saved: true` 장소 전부다. `이 지역으로 여행 만들기`의 처음 후보.
 */
export function placeIdsInRegion(lib: Library, region: string): string[] {
  const places = livePlaces(lib);
  const regionOf = regionsByPlace(places);
  return places.filter((p) => regionOf.get(p.id) === region).map((p) => p.id);
}
