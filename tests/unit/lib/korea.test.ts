import { describe, expect, it } from 'vitest';
import { isAbroadLeg, isInKorea } from 'src/lib/korea';

describe('한국 범위 판정', () => {
  it.each([
    [124, 33],
    [132, 39],
    [127, 37],
  ])('경계 포함 국내 좌표 %s,%s를 허용한다', (lng, lat) => {
    expect(isInKorea(lng, lat)).toBe(true);
  });
  it.each([
    [123.99, 37],
    [132.01, 37],
    [127, 32.99],
    [127, 39.01],
    [NaN, 37],
    [127, Infinity],
  ])('범위 밖이거나 유한하지 않은 %s,%s를 거부한다', (lng, lat) => {
    expect(isInKorea(lng, lat)).toBe(false);
  });
  it('한쪽이라도 해외면 해외 구간이다', () => {
    const domestic = { lng: 127, lat: 37 };
    const paris = { lng: 2.2945, lat: 48.8584 };
    expect(isAbroadLeg(domestic, domestic)).toBe(false);
    expect(isAbroadLeg(domestic, paris)).toBe(true);
    expect(isAbroadLeg(paris, domestic)).toBe(true);
    expect(isAbroadLeg(paris, paris)).toBe(true);
  });
});
