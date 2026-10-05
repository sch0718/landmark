import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import {
  buildViewQuery,
  modeAtom,
  parseViewQuery,
  viewModeAtom,
  viewStateKey,
} from 'src/stores/ui-store';
import { readPreferredView, writePreferredView } from 'src/sections/views/store/ui-preferences';

const dates = ['2026-11-14', '2026-11-15'];
const parse = (query: string) =>
  parseViewQuery(new URLSearchParams(query), dates, 'places', dates[0]!);

describe('view query', () => {
  it('신규 view가 legacy mode보다 우선한다', () => {
    expect(parse('view=places&mode=itinerary&day=2')).toEqual({
      view: 'places',
      day: dates[1],
      place: null,
    });
    expect(parse('view=map&mode=itinerary').view).toBe('map');
  });
  it('기존 일정 링크는 날짜 누락 시 전체를 유지한다', () => {
    expect(parse('mode=itinerary')).toEqual({ view: 'day', day: 'all', place: null });
    expect(parse('mode=explore').view).toBe('map');
  });
  it('뷰 키가 없을 때만 선호를 사용한다', () => {
    expect(parse('').view).toBe('places');
    expect(parse('view=unknown').view).toBe('map');
    expect(parse('mode=unknown').view).toBe('map');
    expect(parse('view=unknown&mode=itinerary').view).toBe('day');
  });
  it('신규 일정 기본 날짜는 여행 중 현지 날짜다', () => {
    expect(parse('view=day').day).toBe(dates[0]);
    expect(parse('view=day&day=all').day).toBe('all');
    expect(parse('view=day&day=2').day).toBe(dates[1]);
    expect(parseViewQuery(new URLSearchParams('view=day'), dates, 'map', dates[1]!).day).toBe(
      dates[1],
    );
  });
  it('여행 기간 밖은 첫 날짜, 빈 날짜 배열은 전체로 해석한다', () => {
    expect(parseViewQuery(new URLSearchParams('view=day'), dates, 'map', '2026-10-03').day).toBe(
      dates[0],
    );
    expect(parseViewQuery(new URLSearchParams('view=day'), [], 'map', dates[0]!).day).toBe('all');
  });
  it.each(['0', '-1', '999', 'not-number', ''])('잘못된 명시 day=%s는 전체다', (day) => {
    expect(parse(`view=day&day=${day}`).day).toBe('all');
  });
  it('빈 place는 null이며 장소 키는 그대로 해석한다', () => {
    expect(parse('place=').place).toBeNull();
    expect(parse('place=n%3A1').place).toBe('n:1');
  });
  it('정규화는 무관한 쿼리를 보존하고 day 번호를 유지한다', () => {
    const result = buildViewQuery(
      new URLSearchParams('mode=itinerary&x=1'),
      { view: 'places', day: dates[1]!, place: 'n:1' },
      dates,
    );
    expect(result.get('mode')).toBeNull();
    expect(result.get('view')).toBe('places');
    expect(result.get('day')).toBe('2');
    expect(result.get('place')).toBe('n:1');
    expect(result.get('x')).toBe('1');
  });
  it('day 전체를 명시하여 재진입 시 전체 선택을 유지한다', () => {
    const state = { view: 'day' as const, day: 'all', place: null };
    const result = buildViewQuery(new URLSearchParams('day=2&place=n:1'), state, dates);
    expect(result.toString()).toBe('day=all&view=day');
    expect(parseViewQuery(result, dates, 'map', dates[0]!)).toEqual(state);
    expect(
      buildViewQuery(result, { view: 'map', day: 'missing', place: null }, dates).get('day'),
    ).toBeNull();
  });
  it('state key는 구분자가 포함된 값도 구별한다', () => {
    expect(viewStateKey({ view: 'map', day: 'a|b', place: 'c' })).not.toBe(
      viewStateKey({ view: 'map', day: 'a', place: 'b|c' }),
    );
  });
  it('places를 선택해도 탐색 마커 레이어가 활성이다', () => {
    const store = createStore();
    store.set(viewModeAtom, 'places');
    expect(store.get(modeAtom)).toBe('explore');
    store.set(modeAtom, 'itinerary');
    expect(store.get(viewModeAtom)).toBe('day');
    store.set(modeAtom, 'explore');
    expect(store.get(viewModeAtom)).toBe('map');
  });
});

describe('preferred view', () => {
  it('여행별로 격리하고 손상 값은 map으로 복구한다', () => {
    const storage = createMemoryStorage();
    expect(writePreferredView(storage, 'trip-a', 'places')).toBe(true);
    expect(readPreferredView(storage, 'trip-a')).toBe('places');
    expect(readPreferredView(storage, 'trip-b')).toBe('map');
    storage.setItem('trip-map:ui:trip-a', '{');
    expect(readPreferredView(storage, 'trip-a')).toBe('map');
  });
  it.each([
    'null',
    '1',
    '"day"',
    '{}',
    '{"version":2,"view":"day"}',
    '{"version":1,"view":"unknown"}',
  ])('잘못된 레코드 %s는 map이다', (raw) => {
    const storage = createMemoryStorage();
    storage.setItem('trip-map:ui:trip-a', raw);
    expect(readPreferredView(storage, 'trip-a')).toBe('map');
  });
  it('차단된 저장소를 전파하지 않는다', () => {
    const blocked = {
      getItem() {
        throw Error('blocked');
      },
      setItem() {
        throw Error('blocked');
      },
    };
    expect(readPreferredView(blocked, 'trip-a')).toBe('map');
    expect(writePreferredView(blocked, 'trip-a', 'day')).toBe(false);
  });
});
