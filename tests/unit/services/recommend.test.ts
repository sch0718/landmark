import { createStore } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import { readRecommendPrefs } from 'src/services/recommend/prefs';
import { emptyLibrary } from 'src/schema/library';
import { recommendMarkers } from 'src/sections/map/recommend-markers';
import { TOKENS } from 'src/theme/tokens';
import {
  hiddenRecommendationCountAtom,
  hideRecommendationAtom,
  recommendPrefsAtom,
  recommendationsAtom,
  refreshRecommendations,
  showHiddenRecommendationsAtom,
  visibleRecommendationsAtom,
} from 'src/stores/recommend';
import type { Recommendation } from 'src/services/recommend/api';
const rec: Recommendation = {
  id: 'label001',
  title: '가을 단풍',
  description: '',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  places: 1,
  updatedAt: 1,
  doc: {
    format: 'tripmap-share',
    version: 1,
    title: '옛 제목',
    createdAt: '2026-11-01T00:00:00.000Z',
    labels: [],
    places: [
      { id: 'place001', name: '단풍길', address: '서울', lng: 127, lat: 37.5, labelIds: [] },
    ],
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
it('추천 핀은 내 장소와 묶지 않고 개별로 보인다', () => {
  const { markers } = recommendMarkers([rec], emptyLibrary(), TOKENS.pastel.light);
  expect(markers).toHaveLength(1);
  expect(markers[0]!.clusterable).toBe(false);
});
it('숨긴 개수는 현재 목록에서만 세고 복원은 같은 저장 키에서 hidden만 비운다', () => {
  const store = createStore();
  store.set(recommendationsAtom, [rec]);
  store.set(recommendPrefsAtom, { hidden: [rec.id, 'oldlabel'], mapOff: true });
  expect(store.get(hiddenRecommendationCountAtom)).toBe(1);
  store.set(recommendationsAtom, []);
  expect(store.get(hiddenRecommendationCountAtom)).toBe(0);
  expect(store.get(recommendPrefsAtom).hidden).toEqual([rec.id, 'oldlabel']);
  store.set(recommendationsAtom, [rec]);

  store.set(showHiddenRecommendationsAtom);

  expect(store.get(hiddenRecommendationCountAtom)).toBe(0);
  expect(store.get(visibleRecommendationsAtom)).toEqual([rec]);
  expect(store.get(recommendPrefsAtom)).toEqual({ hidden: [], mapOff: true });
  expect(JSON.parse(localStorage.getItem('tripmap:recommend:v1')!)).toEqual({
    hidden: [],
    mapOff: true,
  });
  expect(readRecommendPrefs()).toEqual({ hidden: [], mapOff: true });
});
it('숨긴 추천은 빈 목록을 받고 설정을 다시 읽은 뒤 같은 id가 돌아와도 숨긴다', async () => {
  const store = createStore();
  store.set(recommendPrefsAtom, { hidden: [], mapOff: false });
  store.set(recommendationsAtom, [rec]);
  store.set(hideRecommendationAtom, rec.id);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }))));
  await refreshRecommendations(store);
  expect(store.get(recommendationsAtom)).toEqual([]);
  const next = createStore();
  next.set(recommendPrefsAtom, readRecommendPrefs());
  next.set(recommendationsAtom, [rec]);
  expect(next.get(visibleRecommendationsAtom)).toEqual([]);
});
it('공개 목록을 받지 못하면 앞서 받은 목록을 유지한다', async () => {
  const store = createStore();
  store.set(recommendationsAtom, [rec]);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('연결 끊김')));
  await refreshRecommendations(store);
  expect(store.get(recommendationsAtom)).toEqual([rec]);
});
