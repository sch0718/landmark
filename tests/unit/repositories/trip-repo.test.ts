import { describe, expect, it, vi } from 'vitest';
import { loadTrip } from 'src/repositories/trip-repo';
import { makeTrip } from '../../fixtures/builders';

const trip = makeTrip({ days: { '2026-11-14': ['A', 'B'] } });

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('loadTrip', () => {
  it('/data/<publicId>.json을 받아 검증된 TripData를 돌려준다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(trip));
    const result = await loadTrip('testtrip0001', { fetchFn });
    expect(result).toEqual({ ok: true, trip });
    expect(fetchFn).toHaveBeenCalledWith('/data/testtrip0001.json', {});
  });

  it('noCache면 cache: no-cache로 요청한다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(trip));
    await loadTrip('testtrip0001', { noCache: true, fetchFn });
    expect(fetchFn).toHaveBeenCalledWith('/data/testtrip0001.json', { cache: 'no-cache' });
  });

  it('404면 not-found', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status: 404 }));
    const result = await loadTrip('testtrip0001', { fetchFn });
    expect(result).toEqual({
      ok: false,
      kind: 'not-found',
      message: '링크가 잘못되었거나 만료된 여행입니다',
    });
  });

  it('스키마 위반이면 invalid와 원본의 schemaVersion, 첫 검증 오류', async () => {
    const broken = { ...trip, schemaVersion: 2 };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(broken));
    const result = await loadTrip('testtrip0001', { fetchFn });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid');
    expect(result.schemaVersion).toBe(2);
    expect(result.message).toContain('schemaVersion');
  });

  it('schemaVersion 필드가 없으면 schemaVersion을 넣지 않는다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ title: 'x' }));
    const result = await loadTrip('testtrip0001', { fetchFn });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid');
    expect('schemaVersion' in result).toBe(false);
  });

  it('404가 아닌 HTTP 오류는 상태 코드를 담은 invalid', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('x', { status: 500 }));
    const result = await loadTrip('testtrip0001', { fetchFn });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid');
    expect(result.message).toContain('500');
  });

  it('네트워크 오류는 오류 내용을 담은 invalid', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await loadTrip('testtrip0001', { fetchFn });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid');
    expect(result.message).toContain('Failed to fetch');
  });

  it('JSON 해석 실패는 invalid', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse('{not json'));
    const result = await loadTrip('testtrip0001', { fetchFn });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid');
  });

  it('SPA 폴백으로 200 text/html(index.html)이 오면 not-found', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
    const result = await loadTrip('bad-id', { fetchFn });
    expect(result).toEqual({
      ok: false,
      kind: 'not-found',
      message: '링크가 잘못되었거나 만료된 여행입니다',
    });
  });

  it('charset이 붙은 application/json도 JSON으로 받는다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(trip), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }),
    );
    expect(await loadTrip('testtrip0001', { fetchFn })).toEqual({ ok: true, trip });
  });
});
