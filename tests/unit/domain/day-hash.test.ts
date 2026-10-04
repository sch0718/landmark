import { describe, expect, it } from 'vitest';
import { hashDayStops } from 'src/domain/day-hash';

describe('hashDayStops', () => {
  it('64비트 FNV-1a 16자리 소문자 hex를 낸다', () => {
    // fnv1a64("[]"), 파이썬으로 따로 계산
    expect(hashDayStops([])).toBe('09612b07b5ecb5a5');
    expect(hashDayStops([{ id: 'x000', placeKey: 'n:1', note: '219449961' }])).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });

  it('32비트에서 충돌하던 쌍(a6dc8dac)이 다른 값을 낸다', () => {
    const a = hashDayStops([{ id: 'x000', placeKey: 'n:1', note: '219449961' }]);
    const b = hashDayStops([{ id: 'x000', placeKey: 'n:1', note: '3478588219' }]);
    expect(a).not.toBe(b);
  });
});
