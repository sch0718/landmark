import { afterEach, describe, expect, it, vi } from 'vitest';
import { tripCollabApi } from 'src/services/trip-collab/client';
import { buildLiveDoc } from '../../fixtures/live-trip';
const id = 'abcdefghij',
  token = 'e'.repeat(43),
  expiresAt = '2026-12-01';
const progress = { prev: 0, marks: [], next: null };
const state = () => ({
  rev: 1,
  updatedAt: expiresAt,
  expiresAt,
  role: 'editor',
  deviceId: 'device01',
  members: 1,
  editedBy: null,
  doc: { ...buildLiveDoc(), v: 2 },
  progress,
});
const mock = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        [204, 304].includes(status)
          ? new Response(null, { status })
          : Response.json(body, { status }),
      ),
  );
afterEach(() => vi.unstubAllGlobals());
describe('함께 편집 API 클라이언트', () => {
  it('각 메서드가 경로·메서드·토큰·본문을 맞춘다', async () => {
    const inviteBody = { token, label: null },
      acceptBody = { deviceToken: token, label: '내 폰' };
    const cases = [
      [
        () => tripCollabApi.createInvite(id, token, inviteBody),
        '/invites',
        'POST',
        { key: 'a'.repeat(16), expiresAt, created: true },
        inviteBody,
      ],
      [
        () => tripCollabApi.previewInvite(id, token),
        '/invite',
        'GET',
        { title: '여행', startDate: '2026-11-01', endDate: '2026-11-02', expiresAt },
        undefined,
      ],
      [
        () => tripCollabApi.accept(id, token, acceptBody),
        '/accept',
        'POST',
        { deviceId: 'device01', rev: 1 },
        acceptBody,
      ],
      [
        () => tripCollabApi.state(id, token, { rev: null, prev: null }),
        '/state',
        'GET',
        state(),
        undefined,
      ],
      [
        () => tripCollabApi.putDoc(id, token, buildLiveDoc(), 1),
        '/doc',
        'PUT',
        { rev: 2, expiresAt },
        { doc: buildLiveDoc(), baseRev: 1 },
      ],
      [
        () => tripCollabApi.progress(id, token, { ops: [] }),
        '/progress',
        'POST',
        progress,
        { ops: [] },
      ],
      [
        () => tripCollabApi.members(id, token),
        '/members',
        'GET',
        { devices: [], invites: [] },
        undefined,
      ],
      [
        () => tripCollabApi.cancelInvite(id, token, 'a'.repeat(16)),
        '/invites/' + 'a'.repeat(16),
        'DELETE',
        null,
        undefined,
      ],
      [() => tripCollabApi.removeMember(id, token, 'me'), '/members/me', 'DELETE', null, undefined],
    ] as const;
    for (const [call, suffix, method, body, input] of cases) {
      mock(body, body === null ? 204 : 200);
      expect((await call()).ok).toBe(true);
      const [url, options] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe(`/api/trip-collab/${id}${suffix}`);
      expect(options).toMatchObject({ method, credentials: 'same-origin', cache: 'no-store' });
      expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${token}`);
      expect(options?.body).toBe(input === undefined ? undefined : JSON.stringify(input));
    }
  });
  it('304와 두 revision 질의를 보낸다', async () => {
    mock(null, 304);
    expect(await tripCollabApi.state(id, token, { rev: 2, prev: 3 })).toEqual({
      ok: true,
      value: 'unchanged',
    });
    expect(fetch).toHaveBeenCalledWith(
      `/api/trip-collab/${id}/state?rev=2&prev=3`,
      expect.anything(),
    );
  });
  it('잘못된 문서·진행·모르는 키를 거절한다', async () => {
    for (const value of [
      { ...state(), doc: {} },
      { ...state(), progress: { ...progress, marks: [{}] } },
      { ...state(), unknown: true },
    ]) {
      mock(value);
      expect(await tripCollabApi.state(id, token, { rev: null, prev: null })).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
  });
  it.each([
    [401, 'invite', 'invite'],
    [409, 'full', 'full'],
    [409, 'upgrade', 'upgrade'],
    [409, 'version', 'version'],
    [409, '', 'conflict'],
  ])('상태 %s %s를 구분한다', async (status, reason, error) => {
    mock({ error: { code: '오류', message: '실패' }, reason, rev: 3 }, Number(status));
    expect(await tripCollabApi.state(id, token, { rev: null, prev: null })).toMatchObject({
      ok: false,
      error,
      rev: 3,
    });
  });
  it('네트워크 거절은 offline이고 그만두기 404·410은 성공이다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('연결 끊김')));
    expect(await tripCollabApi.state(id, token, { rev: null, prev: null })).toEqual({
      ok: false,
      error: 'offline',
    });
    for (const status of [404, 410]) {
      mock({}, status);
      expect(await tripCollabApi.removeMember(id, token, 'me')).toEqual({
        ok: true,
        value: undefined,
      });
    }
  });
});
