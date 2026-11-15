import { browserStorage } from 'src/services/browser-storage';
export const RECOMMEND_PREFS_KEY = 'tripmap:recommend:v1';
export type RecommendPrefs = { hidden: string[]; mapOff: boolean };
export function readRecommendPrefs(storage = browserStorage()): RecommendPrefs {
  try {
    const value: unknown = JSON.parse(storage?.getItem(RECOMMEND_PREFS_KEY) ?? 'null');
    if (
      value &&
      typeof value === 'object' &&
      'hidden' in value &&
      Array.isArray(value.hidden) &&
      value.hidden.every((id) => typeof id === 'string') &&
      'mapOff' in value &&
      typeof value.mapOff === 'boolean'
    )
      return { hidden: value.hidden, mapOff: value.mapOff };
  } catch {
    /* 저장소를 읽을 수 없으면 기본값을 쓴다. */
  }
  return { hidden: [], mapOff: false };
}
export function writeRecommendPrefs(prefs: RecommendPrefs, storage = browserStorage()): void {
  try {
    storage?.setItem(RECOMMEND_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* 저장소가 막혀도 현재 화면의 선택은 유지한다. */
  }
}
