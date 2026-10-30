import { afterEach, describe, expect, it, vi } from 'vitest';
import { tripLiveApi } from 'src/services/trip-live/client';
import { buildLiveDoc } from '../../fixtures/live-trip';
const id = 'abcdefghij',
  token = 'o'.repeat(43);
const state = () => ({
  rev: 1,
  updatedAt: '2026-11-01',
  expiresAt: '2026-12-01',
  role: 'owner',
  viewToken: 'v'.repeat(43),
  sourceTripId: 'trip000001',
  doc: buildLiveDoc(),
});
const mock = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        status === 204 || status === 304
          ? new Response(null, { status })
          : Response.json(body, { status }),
      ),
  );
afterEach(() => vi.unstubAllGlobals());
describe('갱신 공유 API 클라이언트', () => {
  it('메서드·경로·헤더·본문으로 요청하고 응답을 검사한다', async () => {
    mock({ id, rev: 1, expiresAt: '2026-12-01', created: true });
    expect(
      (
        await tripLiveApi.create({
          id,
          sourceTripId: 'trip000001',
          ownerToken: token,
          viewToken: 'v'.repeat(43),
          doc: buildLiveDoc(),
          turnstile: 'dev',
        })
      ).ok,
    ).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/trip-live',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    mock(state());
    expect(await tripLiveApi.get(id, null, token)).toEqual({ ok: true, value: state() });
    expect(fetch).toHaveBeenCalledWith(
      `/api/trip-live/${id}`,
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(new Headers(vi.mocked(fetch).mock.calls[0]![1]?.headers).get('Authorization')).toBe(
      `Bearer ${token}`,
    );
    mock({ rev: 2, expiresAt: '2026-12-01' });
    expect((await tripLiveApi.update(id, buildLiveDoc(), 1, token)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `/api/trip-live/${id}`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ doc: buildLiveDoc(), baseRev: 1 }),
      }),
    );
    mock({ rev: 2 });
    expect((await tripLiveApi.rotate(id, { owner: token }, token)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `/api/trip-live/${id}/rotate`,
      expect.objectContaining({ method: 'POST' }),
    );
    mock(null, 204);
    expect(await tripLiveApi.remove(id, token)).toEqual({ ok: true, value: undefined });
  });
  it('304와 since를 처리한다', async () => {
    mock(null, 304);
    expect(await tripLiveApi.get(id, 3, token)).toEqual({ ok: true, value: 'unchanged' });
    expect(fetch).toHaveBeenCalledWith(`/api/trip-live/${id}?since=3`, expect.anything());
  });
  it.each([
    [400, 'turnstile', 'turnstile'],
    [400, 'doc', 'invalid'],
    [401, '', 'unauthorized'],
    [404, '', 'not-found'],
    [409, 'taken', 'taken'],
    [409, 'version', 'version'],
    [409, '', 'conflict'],
    [410, '', 'ended'],
    [413, '', 'too-big'],
    [429, '', 'rate-limited'],
    [503, 'off', 'switched-off'],
    [503, 'config', 'unavailable'],
    [500, '', 'unavailable'],
  ])('상태 %i %s를 %s로 읽는다', async (status, reason, error) => {
    mock({ error: { code: '오류', message: '실패' }, reason, rev: 3 }, Number(status));
    expect(await tripLiveApi.get(id, null, token)).toMatchObject({
      ok: false,
      error,
      ...(status === 409 ? { rev: 3 } : {}),
    });
  });
  it('잘못된 문서·모르는 응답 키·소유자 필드 누락은 invalid다', async () => {
    for (const x of [
      { ...state(), doc: {} },
      { ...state(), unknown: true },
      { ...state(), viewToken: undefined },
    ]) {
      mock(x);
      expect(await tripLiveApi.get(id, null, token)).toEqual({ ok: false, error: 'invalid' });
    }
  });
  it('fetch 거절은 offline이고 remove 404·410은 성공이다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('끊김')));
    expect(await tripLiveApi.get(id, null, token)).toEqual({ ok: false, error: 'offline' });
    for (const code of [404, 410]) {
      mock({}, code);
      expect(await tripLiveApi.remove(id, token)).toEqual({ ok: true, value: undefined });
    }
  });
});
