import { describe, expect, it } from 'vitest';
import type { Bounds } from 'src/components/map/MapAdapter';
import { overlay } from 'src/domain/overlay';
import {
  categoryCounts,
  DEFAULT_FILTER,
  filterPlaces,
  type ExploreFilter,
} from 'src/sections/explore/store/filters';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const D1 = '2026-11-14';
const NOW = '2026-10-03T00:00:00.000Z';

function trip(): TripData {
  const t = makeTrip({ days: { [D1]: ['A'] }, places: ['B', 'C', 'D', 'E'] });
  // n:1=A n:2=B n:3=C n:4=D n:5=E
  t.folders = [
    { id: 'f1', name: '맛집', count: 3 },
    { id: 'f2', name: '명소', count: 2 },
  ];
  const p = t.places;
  p['n:1']!.folderIds = ['f1'];
  p['n:1']!.category = '음식점';
  p['n:2']!.folderIds = ['f1'];
  p['n:2']!.category = '카페';
  p['n:2']!.naverMemos = [{ folderId: 'f1', memo: '뷰 좋음 Ocean' }];
  p['n:3']!.folderIds = ['f2'];
  p['n:3']!.category = '음식점';
  p['n:4']!.folderIds = ['f1', 'f2'];
  p['n:4']!.category = null;
  p['n:5']!.folderIds = ['f2'];
  p['n:5']!.category = '카페';
  p['n:5']!.address = '강원 속초시 해변로';
  p['n:5']!.lng = 130;
  return t;
}

const edit = (places: EditLayer['places'] = {}): EditLayer => makeEdit({ places });
const run = (t: TripData, e: EditLayer | null, f: Partial<ExploreFilter>, bounds?: Bounds) =>
  filterPlaces(t, e, overlay(t, e), { ...DEFAULT_FILTER, ...f }, bounds);

describe('filterPlaces', () => {
  const t = trip();
  it('기본값은 숨김 제외 전체', () => {
    expect(run(t, null, {})).toEqual(['n:1', 'n:2', 'n:3', 'n:4', 'n:5']);
  });

  it.each<[string, Partial<ExploreFilter>, string[]]>([
    ['폴더 f1', { folderIds: ['f1'] }, ['n:1', 'n:2', 'n:4']],
    ['폴더 f1+f2(합집합)', { folderIds: ['f1', 'f2'] }, ['n:1', 'n:2', 'n:3', 'n:4', 'n:5']],
    ['카테고리 카페', { categories: ['카페'] }, ['n:2', 'n:5']],
    ['카테고리 미분류', { categories: ['미분류'] }, ['n:4']],
    ['폴더 f2 + 카테고리 음식점', { folderIds: ['f2'], categories: ['음식점'] }, ['n:3']],
    ['네이버 메모 있음', { hasMemo: true }, ['n:2']],
    ['일정에 있음', { inItinerary: 'in' }, ['n:1']],
    ['일정에 없음', { inItinerary: 'out' }, ['n:2', 'n:3', 'n:4', 'n:5']],
    ['검색: 이름·주소', { query: '주소 c' }, ['n:3']],
    ['검색: 주소', { query: '속초' }, ['n:5']],
    ['검색: 네이버 메모 대소문자 무시', { query: 'ocean' }, ['n:2']],
    ['검색: 앞뒤 공백 무시', { query: '  속초 ' }, ['n:5']],
    ['검색: 없음', { query: '없는말' }, []],
  ])('%s', (_name, f, expected) => {
    expect(run(t, null, f)).toEqual(expected);
  });

  it('사용자 메모(null 제외)·태그로 검색, 태그 필터', () => {
    const e = edit({
      'n:3': {
        memos: {
          'a-local': { text: '웨이팅 길다', updatedAt: NOW },
          other: { text: null, updatedAt: NOW },
        },
        tags: { value: ['꼭가기'], updatedAt: NOW },
      },
      'n:4': {
        memos: { other: { text: null, updatedAt: NOW } },
        tags: { value: ['꼭가기', '야경'], updatedAt: NOW },
      },
    });
    expect(run(t, e, { query: '웨이팅' })).toEqual(['n:3']);
    expect(run(t, e, { query: '야경' })).toEqual(['n:4']);
    expect(run(t, e, { tags: ['꼭가기'] })).toEqual(['n:3', 'n:4']);
    expect(run(t, e, { tags: ['야경'] })).toEqual(['n:4']);
    expect(run(t, e, { hasMemo: true })).toEqual(['n:2', 'n:3']);
  });

  it('숨김은 기본 제외, showHidden이면 포함', () => {
    const e = edit({ 'n:2': { memos: {}, hidden: { value: true, updatedAt: NOW } } });
    expect(run(t, e, {})).toEqual(['n:1', 'n:3', 'n:4', 'n:5']);
    expect(run(t, e, { showHidden: true })).toEqual(['n:1', 'n:2', 'n:3', 'n:4', 'n:5']);
  });

  it('일정 상태는 실효 일정 기준', () => {
    const e = edit({});
    e.days[D1] = { mode: 'override', stops: [], baseDayHash: 'x', updatedAt: NOW };
    expect(run(t, e, { inItinerary: 'in' })).toEqual([]);
  });

  it('inViewOnly는 bounds 안만', () => {
    const b = { west: 126, south: 36, east: 128, north: 38 };
    expect(run(t, null, { inViewOnly: true }, b)).toEqual(['n:1', 'n:2', 'n:3', 'n:4']);
    expect(run(t, null, { inViewOnly: true })).toEqual(['n:1', 'n:2', 'n:3', 'n:4', 'n:5']);
    expect(run(t, null, { inViewOnly: false }, b)).toHaveLength(5);
  });
});

describe('categoryCounts', () => {
  it('많은 순, 동률은 이름순, null은 미분류', () => {
    expect(categoryCounts(trip(), null)).toEqual([
      { category: '음식점', count: 2 },
      { category: '카페', count: 2 },
      { category: '미분류', count: 1 },
    ]);
  });

  it('바꾼 분류로 집계하고 분류 필터도 바꾼 값으로 거른다', () => {
    const t = trip();
    const e = edit({
      'n:1': { memos: {}, category: { value: '숙소', updatedAt: NOW } },
      'n:4': { memos: {}, category: { value: '숙소', updatedAt: NOW } },
      'n:5': { memos: {}, category: { value: null, updatedAt: NOW } },
    });
    expect(categoryCounts(t, e)).toEqual([
      { category: '숙소', count: 2 },
      { category: '카페', count: 2 },
      { category: '음식점', count: 1 },
    ]);
    expect(run(t, e, { categories: ['숙소'] })).toEqual(['n:1', 'n:4']);
    expect(run(t, e, { categories: ['음식점'] })).toEqual(['n:3']);
    expect(run(t, e, { categories: ['미분류'] })).toEqual([]);
  });
});

it('검색·폴더·카테고리·태그·메모·숨김·실효 일정 조건을 함께 유지한다', () => {
  const t = trip();
  const e = edit({
    'n:3': {
      memos: { 'a-local': { text: '야경 웨이팅', updatedAt: NOW } },
      tags: { value: ['야경'], updatedAt: NOW },
      hidden: { value: true, updatedAt: NOW },
    },
  });
  e.days[D1] = {
    mode: 'override',
    baseDayHash: 'x',
    updatedAt: NOW,
    stops: [{ id: 'new0', placeKey: 'n:3' }],
  };
  const filter: Partial<ExploreFilter> = {
    query: '웨이팅',
    folderIds: ['f2'],
    categories: ['음식점'],
    tags: ['야경'],
    hasMemo: true,
    inItinerary: 'in',
    showHidden: true,
  };
  expect(run(t, e, filter)).toEqual(['n:3']);
  expect(run(t, e, { ...filter, showHidden: false })).toEqual([]);
  expect(run(t, e, { ...filter, inItinerary: 'out' })).toEqual([]);
  expect(run(t, e, { ...filter, categories: ['카페'] })).toEqual([]);
});
