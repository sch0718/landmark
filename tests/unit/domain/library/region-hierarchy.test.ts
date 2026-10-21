import { describe, expect, it } from 'vitest';
import {
  provinceOf,
  regionPathOf,
  regionPathsByPlace,
  regionsByPlace,
} from 'src/domain/library/region';
import { DEFAULT_QUERY, livePlaces, queryPlaces, regionTreeCounts } from 'src/domain/library/query';
import { emptyLibrary, type Place } from 'src/schema/library';
import { referenceRegions } from '../../helpers/reference-regions';

const aliases = [
  ['서울', '서울특별시'],
  ['부산', '부산광역시'],
  ['대구', '대구광역시'],
  ['인천', '인천광역시'],
  ['광주', '광주광역시'],
  ['대전', '대전광역시'],
  ['울산', '울산광역시'],
  ['세종', '세종특별자치시'],
  ['경기', '경기도'],
  ['강원', '강원도', '강원특별자치도'],
  ['충북', '충청북도'],
  ['충남', '충청남도'],
  ['전북', '전라북도', '전북특별자치도'],
  ['전남', '전라남도'],
  ['경북', '경상북도'],
  ['경남', '경상남도'],
  ['제주', '제주도', '제주특별자치도'],
];
const time = '2026-10-22T00:00:00.000Z';
const field = <T>(value: T) => ({ value, updatedAt: time });
const place = (id: string, address: string, lng = 128, lat = 37): Place => ({
  id,
  address,
  lng,
  lat,
  source: { kind: 'naver', sid: id },
  name: field(id),
  category: field(null),
  labelIds: field([]),
  memo: field(''),
  saved: field(true),
  createdAt: time,
  deletedAt: null,
});

describe('시·도와 두 단계 지역', () => {
  it.each(aliases)('%s의 모든 별칭을 맞춘다', (...tokens) => {
    for (const token of tokens) expect(provinceOf(`  ${token}   강릉시 도로 1 `)).toBe(tokens[0]);
  });
  it('도는 시·군을, 광역시는 시만 쓴다', () => {
    expect(regionPathOf('강원 강릉시 도로')).toBe('강원/강릉');
    expect(regionPathOf('서울 강남구 도로')).toBe('서울');
    expect(regionPathOf('경기')).toBe('경기');
    expect(regionPathOf('알수없음')).toBe('기타');
  });
  it('계층 개수를 세고 도 전체·시군·옛 값을 거른다', () => {
    const places = [
      place('a', '강원 강릉시'),
      place('b', '강원 속초시'),
      place('c', '서울 강남구'),
    ];
    const lib = { ...emptyLibrary(), places: Object.fromEntries(places.map((p) => [p.id, p])) };
    expect(regionTreeCounts(lib, DEFAULT_QUERY)).toEqual([
      {
        region: '강원',
        count: 2,
        children: [
          { region: '강원/강릉', count: 1 },
          { region: '강원/속초', count: 1 },
        ],
      },
      { region: '서울', count: 1, children: [] },
    ]);
    const ids = (regions: string[]) =>
      queryPlaces(lib, { ...DEFAULT_QUERY, regions })
        .map((p) => p.id)
        .sort();
    expect(ids(['강원/전체'])).toEqual(['a', 'b']);
    expect(ids(['강원/강릉'])).toEqual(['a']);
    expect(ids(['강릉'])).toEqual(['a']);
    expect(ids(['강원/강릉', '서울/전체'])).toEqual(['a', 'c']);
    expect(regionTreeCounts(lib, { ...DEFAULT_QUERY, regions: ['서울'] })).toEqual(
      regionTreeCounts(lib, DEFAULT_QUERY),
    );
  });
  it('제주·광주 옛 값은 새 시·도 전체와 구분한다', () => {
    const places = [
      place('jeju', '제주특별자치도 제주시'),
      place('seogwipo', '제주특별자치도 서귀포시'),
      place('metro', '광주광역시 동구'),
      place('city', '경기도 광주시'),
    ];
    const lib = { ...emptyLibrary(), places: Object.fromEntries(places.map((p) => [p.id, p])) };
    const ids = (region: string) =>
      queryPlaces(lib, { ...DEFAULT_QUERY, regions: [region] })
        .map((p) => p.id)
        .sort();
    expect(ids('제주')).toEqual(['jeju']);
    expect(ids('제주/전체')).toEqual(['jeju', 'seogwipo']);
    expect(ids('광주')).toEqual(['city', 'metro']);
    expect(ids('광주/전체')).toEqual(['metro']);
    expect(ids('경기/광주')).toEqual(['city']);
  });
  it('캐시를 다시 읽을 때 주소를 재해석하지 않는다', () => {
    const p = place('a', '강원 강릉시');
    let reads = 0;
    Object.defineProperty(p, 'address', {
      get: () => {
        reads++;
        return '강원 강릉시';
      },
    });
    const places = [p];
    regionsByPlace(places);
    regionPathsByPlace(places);
    const initial = reads;
    regionsByPlace(places);
    regionPathsByPlace(places);
    expect(reads).toBe(initial);
  });
  it('장소 레코드와 배열 정체성으로 계산 결과를 함께 쓴다', () => {
    const p = place('a', '강원 강릉시');
    const lib = { ...emptyLibrary(), places: { a: p } };
    const places = livePlaces(lib);
    expect(livePlaces({ ...lib, labels: {} })).toBe(places);
    expect(regionsByPlace(places)).toBe(regionsByPlace(places));
    expect(regionPathsByPlace(places)).toBe(regionPathsByPlace(places));
    const updated = livePlaces({ ...lib, places: { a: { ...p, address: '경기 수원시' } } });
    expect(updated).not.toBe(places);
    expect(regionPathsByPlace(updated).get('a')).toBe('경기/수원');
  });
});

describe('격자와 이전 순차 비교의 결과 동일성', () => {
  it('고정 난수 입력과 칸 경계에서 기존 결과를 그대로 낸다', () => {
    let seed = 427;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let run = 0; run < 15; run++) {
      const places = Array.from({ length: 180 }, (_, i) =>
        place(
          String(i),
          i % 3 ? '' : `강원도 ${i % 2 ? '강릉' : '속초'}시`,
          126 + random() * 4,
          33 + random() * 5,
        ),
      );
      places.push(
        place('edge', '', 128.1, 37.1),
        place('edge-known', '경기도 수원시', 128.100001, 37.100001),
      );
      expect([...regionsByPlace(places)]).toEqual([...referenceRegions(places)]);
      expect([...regionPathsByPlace(places)]).toEqual([...referenceRegions(places, regionPathOf)]);
    }
  });
  it('10km 원이 위도 격자 경계에 걸려도 후보를 놓치지 않는다', () => {
    const delta = ((10 / 6371) * 180) / Math.PI;
    for (let n = -899; n <= 899; n++) {
      for (const direction of [-1, 1]) {
        const latitude = n / 10;
        const places = [
          place('a', '강원도 강릉시', 128, latitude),
          place('x', '', 128, latitude + direction * delta),
        ];
        expect([...regionsByPlace(places)]).toEqual([...referenceRegions(places)]);
      }
    }
  });
  it('동률은 뒤의 장소, 10km 안과 밖·극지방·날짜변경선도 같다', () => {
    const kmDegrees = ((10 / 6371) * 180) / Math.PI;
    const places = [
      place('a', '강원도 강릉시', 128, 37),
      place('b', '강원도 속초시', 128, 37),
      place('tie', '', 128, 37),
      place('origin', '경기도 수원시', 0, 0),
      place('in', '', 0, kmDegrees - 1e-9),
      place('out', '', 0, -kmDegrees - 1e-9),
      place('polar', '경기도 수원시', 120, 89.99),
      place('polar-x', '', -60, 89.99),
      place('date', '강원도 강릉시', 179.99, -30),
      place('date-x', '', -179.99, -30),
    ];
    expect(regionsByPlace(places).get('tie')).toBe('속초');
    expect([...regionsByPlace(places)]).toEqual([...referenceRegions(places)]);
    expect([...regionPathsByPlace(places)]).toEqual([...referenceRegions(places, regionPathOf)]);
  });
});
