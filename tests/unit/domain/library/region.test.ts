import { describe, expect, it } from 'vitest';
import { regionOf } from 'src/domain/library/region';

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
