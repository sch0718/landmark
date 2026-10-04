import { describe, expect, it } from 'vitest';
import { buildPlaces } from '../../../pipeline/build-places';
import type { Bookmark, FetchedFolder } from '../../../pipeline/naver-client';
import { TripSourceSchema } from 'src/schema/trip-source';

const SHARE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHARE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function bm(over: Partial<Bookmark> & { sid: string }): Bookmark {
  return {
    name: '장소',
    address: '강원 속초시',
    px: 128.59,
    py: 38.2,
    memo: '',
    mcidName: '음식점',
    creationTime: 1_700_000_000_000,
    lastUpdateTime: 1_700_000_000_000,
    available: true,
    ...over,
  };
}

function source(over: Record<string, unknown> = {}) {
  return TripSourceSchema.parse({
    title: '속초',
    startDate: '2026-10-10',
    endDate: '2026-10-11',
    folders: [SHARE_A, SHARE_B],
    customPlaces: [{ key: 'home', name: '숙소', lng: 128.5, lat: 38.1 }],
    days: [],
    ...over,
  });
}

const folderA = (bookmarks: Bookmark[]): FetchedFolder => ({
  shareId: SHARE_A,
  name: '속초 맛집',
  bookmarks,
});
const folderB = (bookmarks: Bookmark[]): FetchedFolder => ({
  shareId: SHARE_B,
  name: '강릉 카페',
  bookmarks,
});

describe('buildPlaces', () => {
  it('같은 sid가 두 폴더에 있으면 최신 lastUpdateTime 값, 최소 creationTime, 두 폴더, 두 메모를 쓴다', () => {
    const a = bm({
      sid: '1',
      name: '옛 이름',
      px: 128.1,
      py: 38.1,
      memo: '메모A',
      creationTime: 2_000,
      lastUpdateTime: 10,
      mcidName: '카페',
    });
    const b = bm({
      sid: '1',
      name: '새 이름',
      px: 128.2,
      py: 38.2,
      memo: '메모B',
      creationTime: 1_000,
      lastUpdateTime: 20,
      mcidName: '음식점',
    });
    const { folders, places } = buildPlaces(source(), [folderA([a]), folderB([b])]);
    expect(folders).toEqual([
      { id: 'f1', name: '속초 맛집', count: 1 },
      { id: 'f2', name: '강릉 카페', count: 1 },
    ]);
    expect(places['n:1']).toEqual({
      name: '새 이름',
      address: '강원 속초시',
      lng: 128.2,
      lat: 38.2,
      category: '음식점',
      folderIds: ['f1', 'f2'],
      savedAt: new Date(1_000).toISOString(),
      sid: '1',
      naverMemos: [
        { folderId: 'f1', memo: '메모A' },
        { folderId: 'f2', memo: '메모B' },
      ],
    });
  });

  it('빈 메모는 제외하고, 메모가 하나도 없으면 naverMemos 키가 없다', () => {
    const { places } = buildPlaces(source(), [
      folderA([bm({ sid: '1', memo: '' }), bm({ sid: '2', memo: '있음' })]),
      folderB([bm({ sid: '2', memo: '  ' })]),
    ]);
    expect('naverMemos' in places['n:1']!).toBe(false);
    expect(places['n:2']!.naverMemos).toEqual([{ folderId: 'f1', memo: '있음' }]);
  });

  it('available:false는 제외하고 개수를 보고하며 폴더 count에도 넣지 않는다', () => {
    const { folders, places, report } = buildPlaces(source(), [
      folderA([bm({ sid: '1' }), bm({ sid: '2', available: false })]),
      folderB([]),
    ]);
    expect(Object.keys(places).filter((k) => k.startsWith('n:'))).toEqual(['n:1']);
    expect(report.excludedUnavailable).toBe(1);
    expect(folders[0]!.count).toBe(1);
  });

  it('좌표 범위 밖(도쿄) 항목은 places에서 빠지고 excludedOutOfRange에 보고된다', () => {
    const { places, report, folders } = buildPlaces(source(), [
      folderA([bm({ sid: '9', name: '도쿄타워', px: 139.7, py: 35.6 }), bm({ sid: '1' })]),
      folderB([]),
    ]);
    expect(places['n:9']).toBeUndefined();
    expect(report.excludedOutOfRange).toEqual([{ sid: '9', name: '도쿄타워' }]);
    expect(folders[0]!.count).toBe(1);
  });

  it('publish.naverMemo:false면 어떤 Place에도 naverMemos가 없다', () => {
    const { places } = buildPlaces(source({ publish: { naverMemo: false } }), [
      folderA([bm({ sid: '1', memo: '비밀' })]),
      folderB([]),
    ]);
    expect(Object.values(places).some((p) => 'naverMemos' in p)).toBe(false);
  });

  it('customPlaces는 c:<key>, category·savedAt null, sid 없음', () => {
    const { places } = buildPlaces(source(), [folderA([]), folderB([])]);
    expect(places['c:home']).toEqual({
      name: '숙소',
      address: '',
      lng: 128.5,
      lat: 38.1,
      category: null,
      folderIds: [],
      savedAt: null,
    });
  });

  it('출력 어디에도 shareId가 없다', () => {
    const result = buildPlaces(source(), [
      folderA([bm({ sid: '1' })]),
      folderB([bm({ sid: '2' })]),
    ]);
    const json = JSON.stringify(result);
    expect(json).not.toContain(SHARE_A);
    expect(json).not.toContain(SHARE_B);
  });
});
