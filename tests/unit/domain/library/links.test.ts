import { describe, expect, it } from 'vitest';
import { naverPlaceUrlOf } from 'src/domain/library/links';
import { makePlace } from '../../sections/library/fixtures';

describe('naverPlaceUrlOf', () => {
  it('naver link only for naver source', () => {
    expect(naverPlaceUrlOf(makePlace(1, { sid: '12345' }))).toBe(
      'https://m.place.naver.com/place/12345',
    );
    const pin = { ...makePlace(2), source: { kind: 'pin' as const } };
    expect(naverPlaceUrlOf(pin)).toBeNull();
  });
});
