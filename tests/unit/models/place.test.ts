import { describe, expect, it } from 'vitest';
import { naverPlaceUrl } from 'src/models/place';
import { makeTrip } from '../../fixtures/builders';

describe('naverPlaceUrl', () => {
  const place = makeTrip({ days: { '2026-11-14': ['A'] } }).places['n:1']!;

  it('sid가 있으면 네이버 플레이스 모바일 URL', () => {
    expect(naverPlaceUrl({ ...place, sid: '12345' })).toBe('https://m.place.naver.com/place/12345');
  });

  it('custom 장소(sid 없음)는 null', () => {
    const custom = { ...place };
    delete custom.sid;
    expect(naverPlaceUrl(custom)).toBeNull();
  });
});
