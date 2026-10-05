import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { viewModeAtom } from 'src/stores/ui-store';
import {
  detailAtom,
  itineraryEditingAtom,
  mapSheetSnapAtom,
  memoDraftsAtom,
  mobileRouteMapAtom,
  placeDisplayAtom,
  selectedPlaceScrollRequestAtom,
  stopDraftsAtom,
  tagDraftsAtom,
  viewScrollAtom,
} from 'src/sections/views/store/view-session';

describe('view session', () => {
  it('초안과 상세 상태는 뷰 전환 및 상세 닫기 후 유지되고 새 store에서는 초기화된다', () => {
    const store = createStore();
    store.set(memoDraftsAtom, { 'n:1:new': '작성 중' });
    store.set(tagDraftsAtom, { 'n:1:new': '조용함, 야외' });
    store.set(stopDraftsAtom, { a000: { date: '2026-11-14', time: '12:30', note: '대기' } });
    store.set(detailAtom, { kind: 'place', placeKey: 'n:1' });
    store.set(viewModeAtom, 'day');
    store.set(detailAtom, null);

    expect(store.get(memoDraftsAtom)['n:1:new']).toBe('작성 중');
    expect(store.get(tagDraftsAtom)['n:1:new']).toBe('조용함, 야외');
    expect(store.get(stopDraftsAtom).a000?.time).toBe('12:30');
    expect(store.get(detailAtom)).toBeNull();
    expect(createStore().get(memoDraftsAtom)).toEqual({});
    expect(createStore().get(tagDraftsAtom)).toEqual({});
    expect(createStore().get(stopDraftsAtom)).toEqual({});
  });

  it('명시적 삭제는 해당 메모 초안만 지운다', () => {
    const store = createStore();
    store.set(memoDraftsAtom, { 'n:1:new': 'A', 'n:2:new': 'B' });
    const next = { ...store.get(memoDraftsAtom) };
    delete next['n:1:new'];
    store.set(memoDraftsAtom, next);
    expect(store.get(memoDraftsAtom)).toEqual({ 'n:2:new': 'B' });
  });

  it('각 session atom은 새 Provider store에서 정의된 초기값을 가진다', () => {
    const store = createStore();
    expect(store.get(detailAtom)).toBeNull();
    expect(store.get(memoDraftsAtom)).toEqual({});
    expect(store.get(stopDraftsAtom)).toEqual({});
    expect(store.get(tagDraftsAtom)).toEqual({});
    expect(store.get(mapSheetSnapAtom)).toBe('peek');
    expect(store.get(itineraryEditingAtom)).toBe(false);
    expect(store.get(mobileRouteMapAtom)).toBe(false);
    expect(store.get(placeDisplayAtom)).toBe('grid');
    expect(store.get(viewScrollAtom)).toEqual({ map: 0, day: 0, places: 0 });
    expect(store.get(selectedPlaceScrollRequestAtom)).toBe(0);
  });
});
