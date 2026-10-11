import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import {
  emptyLibrary,
  type Label,
  type LabelColor,
  type LabelIcon,
  type Library,
  type Place,
} from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
import { PREFS_KEY } from 'src/services/prefs-store';
import { DEFAULT_PREFS, type Prefs } from 'src/schema/prefs';
import { mockViewport, renderApp } from '../shell/harness';

export const T0 = '2026-10-08T01:00:00.000Z';
const f = <V,>(value: V, updatedAt = T0) => ({ value, updatedAt });

export const GANGNEUNG = '강원특별자치도 강릉시 난설헌로 131';
export const SOKCHO = '강원특별자치도 속초시 해맞이로 10';
export const SEOUL = '서울특별시 강남구 테헤란로 1';

export function makeLabel(
  id: string,
  name: string,
  color: LabelColor,
  icon: LabelIcon,
  order: number,
): Label {
  return {
    id,
    name: f(name),
    color: f(color),
    icon: f(icon),
    order: f(order),
    createdAt: T0,
    deletedAt: null,
  };
}

export function makePlace(
  n: number,
  options: {
    name?: string;
    address?: string;
    memo?: string;
    labelIds?: string[];
    sid?: string;
    deletedAt?: string | null;
  } = {},
): Place {
  const id = `place${String(n).padStart(5, '0')}`;
  // 번호가 클수록 나중에 저장한 장소라서 "최근 저장순"에서 앞선다.
  const savedAt = new Date(Date.parse(T0) + n * 1000).toISOString();
  return {
    id,
    source: { kind: 'naver', sid: options.sid ?? String(1000 + n) },
    name: f(options.name ?? `장소 ${n}`),
    address: options.address ?? GANGNEUNG,
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>(null),
    labelIds: f<string[]>(options.labelIds ?? []),
    memo: f(options.memo ?? ''),
    saved: f(true, savedAt),
    createdAt: T0,
    deletedAt: options.deletedAt ?? null,
  };
}

export const L_FOOD = 'label001';
export const L_CAFE = 'label002';
export const L_SEA = 'label003';

/**
 * 맛집 2곳(닭강정·횟집), 카페 1곳, 바다뷰 1곳(횟집과 겹침), 미분류 2곳(서울·메모 있는 곳).
 * 최근 저장순: 창가 자리 → 서울 → 횟집 → 카페 → 닭강정.
 */
export function sampleLibrary(): Library {
  const labels = [
    makeLabel(L_FOOD, '맛집', 'red', 'utensils', 0),
    makeLabel(L_CAFE, '카페', 'yellow', 'coffee', 1),
    makeLabel(L_SEA, '바다뷰', 'blue', 'waves', 2),
  ];
  const places = [
    makePlace(1, { name: '중앙시장 닭강정', labelIds: [L_FOOD] }),
    makePlace(2, { name: '안목 카페거리', labelIds: [L_CAFE] }),
    makePlace(3, { name: '속초 횟집', address: SOKCHO, labelIds: [L_FOOD, L_SEA] }),
    makePlace(4, { name: '강남 한 곳', address: SEOUL }),
    makePlace(5, { name: '창가 자리', memo: '비밀 메모: 창가 자리가 좋아요' }),
  ];
  return {
    ...emptyLibrary(),
    labels: Object.fromEntries(labels.map((l) => [l.id, l])),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
  };
}

export function withPlaces(base: Library, places: Place[]): Library {
  return {
    ...base,
    places: { ...base.places, ...Object.fromEntries(places.map((p) => [p.id, p])) },
  };
}

/** 보관함과 선호를 저장소에 심고 앱을 그린다. 기본은 넓은 화면(목록 칸이 항상 보인다). */
export async function renderLibrary(
  library: Library,
  options: {
    prefs?: Partial<Prefs>;
    width?: number;
    path?: string;
    ids?: string[];
    storage?: Storage;
    /** `renderApp`의 `shareTemplate`를 그대로 넘긴다. */
    shareTemplate?: NonNullable<Parameters<typeof renderApp>[0]>['shareTemplate'];
  } = {},
) {
  const { prefs, width = 1280, path = '/', ids, shareTemplate } = options;
  const storage = options.storage ?? createMemoryStorage();
  storage.setItem(LIBRARY_KEY, JSON.stringify(library));
  if (prefs !== undefined) {
    storage.setItem(PREFS_KEY, JSON.stringify({ ...structuredClone(DEFAULT_PREFS), ...prefs }));
  }
  const viewport = mockViewport(width);
  const rendered = await renderApp({ path, storage, ids, shareTemplate });
  return { ...rendered, storage, setWidth: viewport.setWidth };
}
