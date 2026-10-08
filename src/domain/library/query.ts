import type { Label, Library, Place } from 'src/schema/library';
import { regionOf } from 'src/domain/library/region';

export type LibraryQuery = {
  labelIds: string[];
  mode: 'any' | 'all';
  unlabeled: boolean;
  regions: string[];
  text: string;
  sort: 'recent' | 'name' | 'label';
};

export const DEFAULT_QUERY: LibraryQuery = {
  labelIds: [],
  mode: 'any',
  unlabeled: false,
  regions: [],
  text: '',
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
};

function contextOf(lib: Library, q: LibraryQuery): Context {
  return {
    byId: new Map(liveLabels(lib).map((l) => [l.id, l])),
    needle: foldText(q.text.trim()),
    regions: new Set(q.regions),
  };
}

function matchesText(place: Place, labels: readonly Label[], needle: string): boolean {
  if (needle === '') return true;
  const haystacks = [
    place.name.value,
    place.address,
    place.memo.value,
    ...labels.map((l) => l.name.value),
  ];
  return haystacks.some((h) => foldText(h).includes(needle));
}

function matchesRegion(place: Place, regions: ReadonlySet<string>): boolean {
  return regions.size === 0 || regions.has(regionOf(place.address));
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
      matchesRegion(p, ctx.regions) &&
      matchesLabels(labels, q)
    );
  });
  return sortPlaces(matched, q, ctx.byId);
}

/** 라벨 칩 숫자. 텍스트·지역 필터를 적용하고 라벨 필터는 빼고 센다. 라벨 없음은 `'unlabeled'` 키. */
export function labelCounts(lib: Library, q: LibraryQuery): Map<string | 'unlabeled', number> {
  const ctx = contextOf(lib, q);
  const counts = new Map<string | 'unlabeled', number>([['unlabeled', 0]]);
  for (const id of ctx.byId.keys()) counts.set(id, 0);
  for (const p of livePlaces(lib)) {
    const labels = labelsOf(p, ctx.byId);
    if (!matchesText(p, labels, ctx.needle) || !matchesRegion(p, ctx.regions)) continue;
    if (labels.length === 0) counts.set('unlabeled', (counts.get('unlabeled') ?? 0) + 1);
    for (const l of labels) counts.set(l.id, (counts.get(l.id) ?? 0) + 1);
  }
  return counts;
}

/**
 * 지역 칩 숫자. 텍스트·라벨 필터를 적용하고 지역 필터는 빼고 센다.
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
    if (!matchesText(p, labels, ctx.needle) || !matchesLabels(labels, q)) continue;
    const region = regionOf(p.address);
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
