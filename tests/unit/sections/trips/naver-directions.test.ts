import { describe, expect, it } from 'vitest';
import { naverDirectionsUrl } from 'src/sections/trips/planner/naver-directions';

const leg = {
  from: { name: '중앙시장 닭강정', lng: 128.8961, lat: 37.7953 },
  to: { name: '안목 카페거리, 강릉', lng: 128.9506, lat: 37.7715 },
  mode: 'car' as const,
};

describe('naverDirectionsUrl', () => {
  it('대중교통 앱은 public, 웹은 transit', () => {
    expect(naverDirectionsUrl({ ...leg, mode: 'transit' }, 'app')).toMatch(
      /^nmap:\/\/route\/public\?/,
    );
    expect(naverDirectionsUrl({ ...leg, mode: 'transit' }, 'web')).toMatch(/\/-\/transit$/);
  });
  it('app: 네이버 지도 URL Scheme(nmap://route/car)에 위도·경도·이름·appname을 넣는다', () => {
    const url = naverDirectionsUrl(leg, 'app')!;
    expect(url.startsWith('nmap://route/car?')).toBe(true);
    const params = new URL(url.replace('nmap://', 'https://x/')).searchParams;
    expect(params.get('slat')).toBe('37.7953');
    expect(params.get('slng')).toBe('128.8961');
    expect(params.get('sname')).toBe('중앙시장 닭강정');
    expect(params.get('dlat')).toBe('37.7715');
    expect(params.get('dlng')).toBe('128.9506');
    expect(params.get('dname')).toBe('안목 카페거리, 강릉');
    expect(params.get('appname')).toBe('landmark.sch0718.dev');
  });

  it('app: 이름은 percent 인코딩되어 쉼표·&·공백이 값을 깨지 않는다', () => {
    const url = naverDirectionsUrl({ ...leg, from: { ...leg.from, name: 'A&B 식당 #1' } }, 'app')!;
    expect(url).toContain('sname=A%26B%20%EC%8B%9D%EB%8B%B9%20%231&');
    expect(url).toContain(
      'dname=%EC%95%88%EB%AA%A9%20%EC%B9%B4%ED%8E%98%EA%B1%B0%EB%A6%AC%2C%20%EA%B0%95%EB%A6%89&',
    );
  });

  it('app: 도보는 route/walk', () => {
    expect(naverDirectionsUrl({ ...leg, mode: 'walk' }, 'app')).toMatch(/^nmap:\/\/route\/walk\?/);
  });

  it('web: map.naver.com/p/directions/<출발>/<도착>/-/<수단>, 각 지점은 경도,위도,이름,,SIMPLE_POI', () => {
    expect(naverDirectionsUrl(leg, 'web')).toBe(
      'https://map.naver.com/p/directions/' +
        '128.8961,37.7953,%EC%A4%91%EC%95%99%EC%8B%9C%EC%9E%A5%20%EB%8B%AD%EA%B0%95%EC%A0%95,,SIMPLE_POI/' +
        '128.9506,37.7715,%EC%95%88%EB%AA%A9%20%EC%B9%B4%ED%8E%98%EA%B1%B0%EB%A6%AC%2C%20%EA%B0%95%EB%A6%89,,SIMPLE_POI/' +
        '-/car',
    );
    expect(naverDirectionsUrl({ ...leg, mode: 'walk' }, 'web')).toMatch(/\/-\/walk$/);
  });

  it('좌표가 유한하지 않으면 null', () => {
    expect(naverDirectionsUrl({ ...leg, to: { ...leg.to, lat: Number.NaN } }, 'app')).toBeNull();
    expect(naverDirectionsUrl({ ...leg, from: { ...leg.from, lng: Infinity } }, 'web')).toBeNull();
  });
});
