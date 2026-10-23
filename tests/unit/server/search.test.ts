// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseSearchQuery,
  searchInputKey,
  parseSearchInputKey,
  resolveSearch,
} from 'src/server/search';
import { ApiError } from 'src/server/http';

const fixture = JSON.parse(
  readFileSync('tests/fixtures/naver/instant-search-gangnam.json', 'utf8'),
);
const url = (q: string, near?: string) =>
  new URL(
    `https://example.test/api/search?q=${encodeURIComponent(q)}${near === undefined ? '' : `&near=${near}`}`,
  );
afterEach(() => vi.useRealTimers());
describe('장소 이름 검색', () => {
  it('공백 정리 후 40자까지 허용하고 near를 키에 포함한다', () => {
    expect(parseSearchQuery(url(' 강남   역 ', '127,37'))).toEqual({
      q: '강남 역',
      near: [127, 37],
    });
    expect(() => parseSearchQuery(url('가'.repeat(40)))).not.toThrow();
    const query = parseSearchQuery(url('강남역', '127.000001,37'));
    expect(parseSearchInputKey(searchInputKey(query))).toEqual({ q: '강남역', near: [127, 37] });
    expect(searchInputKey(query)).not.toBe(searchInputKey({ q: '강남역' }));
  });
  it.each(['', '   ', '가'.repeat(41)])('빈 값과 긴 q 거부: %s', (q) =>
    expect(() => parseSearchQuery(url(q))).toThrow(ApiError),
  );
  it.each(['127', ',37', '0,0', 'NaN,37', '127,40', '127,37,1'])('near 형식 검사 %s', (near) =>
    expect(() => parseSearchQuery(url('역', near))).toThrow(ApiError),
  );
  it('고정물의 place만 이름·도로명 우선 주소·분류·좌표로 정리한다', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture));
    const result = await resolveSearch({ q: '강남역', near: [127, 37] }, { fetch: fetcher });
    expect(result.results).toHaveLength(4);
    expect(result.results[0]).toEqual({
      name: '강남역 2호선',
      address: '서울특별시 강남구 강남대로 396',
      category: '지하철,전철',
      lng: 127.0276242,
      lat: 37.4979526,
    });
    expect(result.results[1]!.address).toBe('서울특별시 강남구 역삼동');
    const request = new URL(String(fetcher.mock.calls[0]![0]));
    expect(request.pathname).toBe('/p/api/search/instant-search');
    expect(request.searchParams.get('coords')).toBe('37.00000,127.00000');
    expect(request.searchParams.get('query')).toBe('강남역');
  });
  it('잘못된 좌표를 버린 뒤 10개까지 남긴다', async () => {
    const item = fixture.place[0];
    const result = await resolveSearch(
      { q: '역' },
      {
        fetch: async () =>
          Response.json({
            place: [
              { ...item, x: '0' },
              { ...item, y: '' },
              ...Array.from({ length: 12 }, () => item),
            ],
          }),
      },
    );
    expect(result.results).toHaveLength(10);
  });
  it('빈 결과는 정상이다', async () => {
    expect(
      await resolveSearch({ q: '역' }, { fetch: async () => Response.json({ place: [] }) }),
    ).toEqual({ results: [] });
  });
  it.each([{}, { place: null }, '문자열'])(
    '응답 모양이 달라지면 UPSTREAM_ERROR %#',
    async (body) => {
      await expect(
        resolveSearch({ q: '역' }, { fetch: async () => Response.json(body) }),
      ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    },
  );
  it('HTTP 오류도 UPSTREAM_ERROR', async () => {
    await expect(
      resolveSearch({ q: '역' }, { fetch: async () => new Response(null, { status: 404 }) }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
  it('8초 넘으면 TIMEOUT', async () => {
    vi.useFakeTimers();
    const assertion = expect(
      resolveSearch({ q: '역' }, { fetch: () => new Promise<Response>(() => {}) }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
  });
});
