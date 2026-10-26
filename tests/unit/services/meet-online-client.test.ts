import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docFromMeeting } from 'src/domain/meeting/online-doc';
import { meetApi } from 'src/services/meet-online/client';
import { buildMeeting } from '../../fixtures/builders';

const doc = docFromMeeting(buildMeeting(), {}, 'min');
const token = 'h'.repeat(43);
const state = { rev: 7, docRev: 2, doc, replies: [] };
const fetchMock = vi.fn<typeof fetch>();
const respond = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('온라인 약속 API', () => {
  const cases = [
    [
      '올리기',
      () => meetApi.create(doc, 'dev', token),
      '/api/meet',
      'POST',
      { doc, turnstile: 'dev', hostToken: token },
      null,
      { id: doc.meetingId, rev: 1, docRev: 1, hostToken: token },
      201,
    ],
    [
      '읽기',
      () => meetApi.get(doc.meetingId, 6, token),
      '/api/meet/meeting001?since=6',
      'GET',
      undefined,
      token,
      state,
      200,
    ],
    [
      '처음 읽기',
      () => meetApi.get(doc.meetingId, null, null),
      '/api/meet/meeting001',
      'GET',
      undefined,
      null,
      state,
      200,
    ],
    [
      '본문 고치기',
      () => meetApi.update(doc.meetingId, doc, 2, token),
      '/api/meet/meeting001',
      'PUT',
      { doc, baseRev: 2 },
      token,
      { rev: 8, docRev: 3 },
      200,
    ],
    [
      '지우기',
      () => meetApi.remove(doc.meetingId, token),
      '/api/meet/meeting001',
      'DELETE',
      undefined,
      token,
      undefined,
      204,
    ],
    [
      '참석자 고르기',
      () => meetApi.claim(doc.meetingId, { participantId: 'person02' }),
      '/api/meet/meeting001/claim',
      'POST',
      { participantId: 'person02' },
      null,
      { participantId: 'person02', guestToken: token, rev: 8 },
      200,
    ],
    [
      '새 이름 고르기',
      () => meetApi.claim(doc.meetingId, { newName: '친구' }),
      '/api/meet/meeting001/claim',
      'POST',
      { newName: '친구' },
      null,
      { participantId: 'person02', guestToken: token, rev: 8 },
      200,
    ],
    [
      '답장',
      () => meetApi.reply(doc.meetingId, { likes: ['choice01'], origin: null, times: null }, token),
      '/api/meet/meeting001/reply',
      'PUT',
      { likes: ['choice01'], origin: null, times: null },
      token,
      { rev: 8 },
      200,
    ],
    [
      '참석자 풀기',
      () => meetApi.release(doc.meetingId, { participantId: 'person02' }, token),
      '/api/meet/meeting001/release',
      'POST',
      { participantId: 'person02' },
      token,
      { rev: 8 },
      200,
    ],
    [
      '주최자 다시 발급',
      () => meetApi.release(doc.meetingId, { host: true }, token),
      '/api/meet/meeting001/release',
      'POST',
      { host: true },
      token,
      { rev: 8, hostToken: token },
      200,
    ],
  ] as const;

  it.each(cases)(
    '%s 요청과 응답을 서버 형식에 맞춘다',
    async (_name, call, path, method, body, auth, response, status) => {
      if (status === 204) fetchMock.mockResolvedValueOnce(new Response(null, { status }));
      else respond(response, status);
      expect(await call()).toEqual({ ok: true, value: response });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(path);
      expect(init?.method).toBe(method);
      expect(init?.credentials).toBe('same-origin');
      expect(init?.body === undefined ? undefined : JSON.parse(init.body as string)).toEqual(body);
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe(auth === null ? null : `Bearer ${auth}`);
      if (body !== undefined) expect(headers.get('Content-Type')).toBe('application/json');
      expect(String(url)).not.toContain(token);
    },
  );

  it('304는 JSON을 읽지 않고 unchanged를 돌려준다', async () => {
    const response = new Response(null, { status: 304 });
    const json = vi.spyOn(response, 'json');
    fetchMock.mockResolvedValueOnce(response);
    expect(await meetApi.get(doc.meetingId, 7, null)).toEqual({ ok: true, value: 'unchanged' });
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'BAD_REQUEST', undefined, 'invalid'],
    [400, 'BAD_REQUEST', 'turnstile', 'turnstile'],
    [401, 'UNAUTHORIZED', undefined, 'unauthorized'],
    [403, 'FORBIDDEN_ORIGIN', undefined, 'invalid'],
    [404, 'NOT_FOUND', undefined, 'not-found'],
    [409, 'CONFLICT', undefined, 'conflict'],
    [409, 'CONFLICT', 'taken', 'taken'],
    [409, 'CONFLICT', 'host', 'host'],
    [409, 'CONFLICT', 'full', 'full'],
    [409, 'CONFLICT', 'busy', 'conflict'],
    [410, 'ENDED', undefined, 'ended'],
    [429, 'RATE_LIMITED', undefined, 'rate-limited'],
    [500, 'UPSTREAM_ERROR', undefined, 'unavailable'],
    [503, 'UNAVAILABLE', 'off', 'switched-off'],
    [503, 'UNAVAILABLE', 'config', 'unavailable'],
    [503, 'UNAVAILABLE', undefined, 'unavailable'],
  ] as const)('HTTP %s · %s · %s를 %s로 읽는다', async (status, code, reason, expected) => {
    respond({ error: { code, message: '오류' }, ...(reason ? { reason } : {}) }, status);
    expect(await meetApi.get(doc.meetingId, null, null)).toEqual({
      ok: false,
      error: { code: expected },
    });
  });

  it('충돌의 rev와 docRev를 최상위에서 따로 읽는다', async () => {
    respond({ error: { code: 'CONFLICT', message: '바뀜' }, rev: 9, docRev: 3 }, 409);
    expect(await meetApi.update(doc.meetingId, doc, 2, token)).toEqual({
      ok: false,
      error: { code: 'conflict', rev: 9, docRev: 3 },
    });
  });

  it('오류 안에 잘못 중첩된 reason·rev는 쓰지 않는다', async () => {
    respond({ error: { code: 'CONFLICT', message: '바뀜', reason: 'taken', rev: 9 } }, 409);
    expect(await meetApi.claim(doc.meetingId, { participantId: 'person02' })).toEqual({
      ok: false,
      error: { code: 'conflict' },
    });
  });

  it.each(cases.filter((c) => c[7] !== 204))(
    '%s의 잘못된 응답은 invalid다',
    async (_name, call) => {
      respond({ rev: 0 });
      expect(await call()).toEqual({ ok: false, error: { code: 'invalid' } });
    },
  );

  it.each([
    { ...state, docRev: undefined },
    { ...state, doc: { ...doc, decided: 'absent00' } },
    { ...state, replies: [{ participantId: 'person02' }] },
  ])('전체 상태도 공용 스키마로 검사한다 (%j)', async (invalid) => {
    respond(invalid);
    expect(await meetApi.get(doc.meetingId, null, null)).toEqual({
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it('JSON이 아닌 성공 응답은 invalid다', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>앱</html>'));
    expect(await meetApi.get(doc.meetingId, null, null)).toEqual({
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it('200의 문자열 unchanged는 서버 상태 스키마가 아니므로 거부한다', async () => {
    respond('unchanged');
    expect(await meetApi.get(doc.meetingId, null, null)).toEqual({
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it('HTML 서버 장애도 unavailable이다', async () => {
    fetchMock.mockResolvedValueOnce(new Response('장애', { status: 503 }));
    expect(await meetApi.get(doc.meetingId, null, null)).toEqual({
      ok: false,
      error: { code: 'unavailable' },
    });
  });

  it('fetch 거절은 offline이다', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('연결 끊김'));
    expect(await meetApi.create(doc, 'dev', token)).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
  });
});

it('답장 docRev를 보내고 timesDropped 성공 응답을 읽는다', async () => {
  const input = { likes: ['choice01'], times: { choice01: 20 }, docRev: 1 };
  respond({ rev: 8, timesDropped: true });
  expect(await meetApi.reply(doc.meetingId, input, token)).toEqual({
    ok: true,
    value: { rev: 8, timesDropped: true },
  });
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual(input);
});

it('본문 갱신에 지운 답장 전용 참석자 id를 보낸다', async () => {
  respond({ rev: 8, docRev: 3 });
  await meetApi.update(doc.meetingId, doc, 2, token, ['person03']);
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    doc,
    baseRev: 2,
    removed: ['person03'],
  });
});
