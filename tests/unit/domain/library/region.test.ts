import { describe, expect, it } from 'vitest';
import { regionOf, regionsByPlace } from 'src/domain/library/region';
import type { Place } from 'src/schema/library';

describe('regionOf', () => {
  it.each([
    ['강원특별자치도 강릉시 난설헌로 131', '강릉'],
    ['강원도 양양군 현남면 인구길 1', '양양'],
    ['제주특별자치도 서귀포시 성산읍', '서귀포'],
    ['서울특별시 강남구 강남대로 396', '서울'],
    ['부산광역시 해운대구 우동', '부산'],
    ['세종특별자치시 한누리대로 2130', '세종'],
    ['경기도 수원시 영통구 광교로', '수원'],
    ['', '기타'],
    ['Seoul', '기타'],
    ['123', '기타'],
    ['  강원도   속초시 ', '속초'],
    ['서울특별시', '서울'],
    ['강원도 강릉', '기타'],
  ])('%j -> %s', (address, expected) => {
    expect(regionOf(address)).toBe(expected);
  });
});

describe('regionsByPlace', () => {
  const T = '2026-10-08T01:00:00.000Z';
  const f = <V>(value: V) => ({ value, updatedAt: T });
  const place = (id: string, address: string, lng: number, lat: number): Place => ({
    id,
    source: { kind: 'naver', sid: id },
    name: f(id),
    address,
    lng,
    lat,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T,
    deletedAt: null,
  });
  const JEJU = '제주특별자치도 제주시 연동 1';
  const SEOGWIPO = '제주특별자치도 서귀포시 성산읍 1';

  it('keeps the region of places that have a parsable address', () => {
    const regions = regionsByPlace([
      place('a', JEJU, 126.5, 33.5),
      place('b', SEOGWIPO, 126.5, 33.5),
    ]);
    expect(regions.get('a')).toBe('제주');
    expect(regions.get('b')).toBe('서귀포');
  });

  it('borrows the region of the nearest addressed place within 10 km', () => {
    const regions = regionsByPlace([
      place('jeju', JEJU, 126.53, 33.5),
      place('seogwipo', SEOGWIPO, 126.9, 33.45),
      place('near-jeju', '', 126.54, 33.51), // 약 1.4km
      place('near-seogwipo', 'Jeju', 126.89, 33.46), // 해석되지 않는 주소도 같다
    ]);
    expect(regions.get('near-jeju')).toBe('제주');
    expect(regions.get('near-seogwipo')).toBe('서귀포');
  });

  it('picks the nearest of several candidates', () => {
    const regions = regionsByPlace([
      place('far', JEJU, 126.6, 33.5), // 약 6.1km
      place('close', SEOGWIPO, 126.54, 33.5), // 약 1.0km
      place('x', '', 126.53, 33.5),
    ]);
    expect(regions.get('x')).toBe('서귀포');
  });

  it('stays 기타 beyond 10 km or without any addressed place', () => {
    const regions = regionsByPlace([
      place('jeju', JEJU, 126.5, 33.5),
      place('far', '', 126.7, 33.5), // 약 18.6km
      place('lonely', '', 128, 37),
    ]);
    expect(regions.get('far')).toBe('기타');
    expect(regions.get('lonely')).toBe('기타');
    expect(regionsByPlace([place('only', '', 126.5, 33.5)]).get('only')).toBe('기타');
  });

  it('does not borrow from other places that are themselves unresolved', () => {
    const regions = regionsByPlace([
      place('a', '', 126.5, 33.5),
      place('b', '', 126.51, 33.5),
      place('c', JEJU, 126.53, 33.5),
    ]);
    expect(regions.get('a')).toBe('제주');
    expect(regions.get('b')).toBe('제주');
  });
});
