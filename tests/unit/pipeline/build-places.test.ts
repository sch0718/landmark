import { describe, expect, it } from 'vitest';
import { buildPlaces } from '../../../pipeline/build-places';
import type { Bookmark, FetchedFolder, NaverPlace } from '../../../pipeline/naver-client';
import { parseOrThrow } from 'src/schema/parse';
import { TripSourceSchema } from 'src/schema/legacy/trip-source';

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
  return parseOrThrow(TripSourceSchema, {
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

describe('buildPlaces — naverPlaces(장소 ID 직접 지정)', () => {
  const jeju: NaverPlace = {
    sid: '20307427',
    name: '착한전복 제주중문점',
    address: '제주 서귀포시 천제연로 119',
    lng: 126.4181775,
    lat: 33.2545773,
    category: '전복요리',
  };

  it('폴더에 없는 장소 ID는 n:<sid> 장소가 되고 네이버 분류를 그대로 쓴다', () => {
    const r = buildPlaces(source({ folders: [], naverPlaces: ['20307427'] }), [], [jeju]);
    expect(r.places['n:20307427']).toEqual({
      name: '착한전복 제주중문점',
      address: '제주 서귀포시 천제연로 119',
      lng: 126.4181775,
      lat: 33.2545773,
      category: '전복요리',
      folderIds: [],
      savedAt: null,
      sid: '20307427',
    });
  });

  it('같은 장소가 저장 폴더에도 있으면 폴더 쪽 데이터(메모·저장일)를 그대로 둔다', () => {
    const inFolder = bm({ sid: '20307427', name: '폴더 이름', memo: '폴더 메모' });
    const r = buildPlaces(
      source({ folders: [SHARE_A], naverPlaces: ['20307427'] }),
      [folderA([inFolder])],
      [jeju],
    );
    expect(r.places['n:20307427']?.name).toBe('폴더 이름');
    expect(r.places['n:20307427']?.folderIds).toEqual(['f1']);
  });

  it('좌표가 범위 밖이면 제외하고 보고한다', () => {
    const far: NaverPlace = { ...jeju, sid: '9', name: '도쿄', lng: 139.7, lat: 35.6 };
    const r = buildPlaces(source({ folders: [], naverPlaces: ['9'] }), [], [far]);
    expect(r.places['n:9']).toBeUndefined();
    expect(r.report.excludedOutOfRange).toEqual([{ sid: '9', name: '도쿄' }]);
  });

  it('폴더에서 사용 불가로 제외된 sid는 naverPlaces로 되살리지 않는다', () => {
    const gone = bm({ sid: '20307427', available: false });
    const r = buildPlaces(
      source({ folders: [SHARE_A], naverPlaces: ['20307427'] }),
      [folderA([gone])],
      [jeju],
    );
    expect(r.places['n:20307427']).toBeUndefined();
    expect(r.report.excludedUnavailable).toBe(1);
  });

  it('폴더에서 범위 밖으로 제외된 sid는 한 번만 보고한다', () => {
    const far = bm({ sid: '20307427', name: '도쿄', px: 139.7, py: 35.6 });
    const r = buildPlaces(
      source({ folders: [SHARE_A], naverPlaces: ['20307427'] }),
      [folderA([far])],
      [{ ...jeju, lng: 139.7, lat: 35.6 }],
    );
    expect(r.report.excludedOutOfRange).toEqual([{ sid: '20307427', name: '도쿄' }]);
  });
});
