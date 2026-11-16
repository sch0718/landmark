import { describe, expect, it } from 'vitest';
import { resolveMapProvider, shareMapProvider } from 'src/components/map/map-provider';

describe('지도 선택', () => {
  it('구글 키가 없으면 네이버, 있으면 저장값을 쓴다', () => {
    expect(resolveMapProvider('google', undefined)).toBe('naver');
    expect(resolveMapProvider('google', '')).toBe('naver');
    expect(resolveMapProvider('google', 'key')).toBe('google');
    expect(resolveMapProvider('naver', 'key')).toBe('naver');
  });
  it('공유 지도의 모든 점이 해외일 때만 구글을 쓴다', () => {
    expect(shareMapProvider([[135.5, 34.7]], 'key')).toBe('google');
    expect(
      shareMapProvider(
        [
          [135.5, 34.7],
          [127, 37],
        ],
        'key',
      ),
    ).toBe('naver');
    expect(
      shareMapProvider(
        [
          [124, 33],
          [132, 39],
        ],
        'key',
      ),
    ).toBe('naver');
    expect(shareMapProvider([], 'key')).toBe('naver');
    expect(shareMapProvider([[135.5, 34.7]], '')).toBe('naver');
  });
});
