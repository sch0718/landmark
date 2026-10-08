import { describe, expect, it } from 'vitest';
import { buildPlaces } from '../../../pipeline/build-places';
import type { Bookmark, FetchedFolder } from '../../../pipeline/naver-client';
import { UnresolvedPlacesError, resolveStops } from '../../../pipeline/resolve-stops';
import { parseOrThrow } from 'src/schema/parse';
import { TripSourceSchema } from 'src/schema/trip-source';

const SHARE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const bm = (sid: string, px = 128.59, py = 38.2): Bookmark => ({
  sid,
  name: `장소${sid}`,
  address: '',
  px,
  py,
  memo: '',
  mcidName: null,
  creationTime: 1,
  lastUpdateTime: 1,
  available: true,
});

function setup(stops: { id?: string; place: string; time?: string; note?: string }[]) {
  const source = parseOrThrow(TripSourceSchema, {
    title: 't',
    startDate: '2026-10-10',
    endDate: '2026-10-11',
    folders: [SHARE],
    customPlaces: [{ key: 'home', name: '숙소', lng: 128.5, lat: 38.1 }],
    days: [{ date: '2026-10-10', stops }],
  });
  const folder: FetchedFolder = {
    shareId: SHARE,
    name: 'f',
    bookmarks: [bm('1'), bm('9', 139.7, 35.6)],
  };
  return { source, ...buildPlaces(source, [folder]) };
}

describe('resolveStops', () => {
  it('숫자 문자열은 n:<sid>, 그 외는 c:<key>로 연결하고 time·note를 옮긴다', () => {
    const { source, places } = setup([
      { id: 'aaaa', place: '1', time: '10:00', note: '점심' },
      { id: 'bbbb', place: 'home' },
    ]);
    expect(resolveStops(source, places)).toEqual([
      {
        date: '2026-10-10',
        stops: [
          { id: 'aaaa', placeKey: 'n:1', time: '10:00', note: '점심' },
          { id: 'bbbb', placeKey: 'c:home' },
        ],
      },
    ]);
  });

  it('없는 장소는 UnresolvedPlacesError(date, place 목록)', () => {
    const { source, places } = setup([
      { id: 'aaaa', place: '777' },
      { id: 'bbbb', place: 'nope' },
    ]);
    try {
      resolveStops(source, places);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnresolvedPlacesError);
      expect((e as UnresolvedPlacesError).places).toEqual([
        { date: '2026-10-10', place: '777' },
        { date: '2026-10-10', place: 'nope' },
      ]);
    }
  });

  it('범위 밖으로 제외된 sid를 stop이 가리키면 UnresolvedPlacesError', () => {
    const { source, places } = setup([{ id: 'aaaa', place: '9' }]);
    expect(() => resolveStops(source, places)).toThrow(UnresolvedPlacesError);
  });
});
