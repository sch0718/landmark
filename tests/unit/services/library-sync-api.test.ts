import { beforeEach, expect, it, vi } from 'vitest';
import { createSyncApi } from 'src/services/library-sync/api';
import { writeSession } from 'src/services/library-sync/storage';
import type { AuthClient } from '@sch0718/firebase-session/client';
beforeEach(() => localStorage.clear());
it('경로·세션 헤더·credentials와 공개 status를 연결한다', async () => {
  writeSession(localStorage, { v: 1, provider: 'kakao', sessionId: 'a'.repeat(43) });
  const fetch = vi.fn(async () => Response.json({}));
  const api = createSyncApi({
    config: {
      apiBase: 'http://localhost/api/sync',
      firebase: null,
      kakao: null,
      naver: null,
      devFake: false,
    },
    storage: localStorage,
    auth: null,
    fetch,
  });
  await api.me();
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://localhost/api/sync/v1/me');
  expect(new Headers(init.headers).get('X-Landmark-Session')).toHaveLength(43);
  expect(init.credentials).toBe('omit');
  await api.status();
  expect(
    new Headers((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].headers).has(
      'X-Landmark-Session',
    ),
  ).toBe(false);
});
it.each([
  [410, 'resync'],
  [409, 'busy'],
  [503, 'off'],
] as const)('고유 오류 %i를 %s로 해석한다', async (status, error) => {
  writeSession(localStorage, { v: 1, provider: 'google', sessionId: 'a'.repeat(43) });
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer id-token');
    return Response.json({ error, purgedRev: 3 }, { status });
  });
  const api = createSyncApi({
    config: {
      apiBase: 'http://localhost/api/sync',
      firebase: null,
      kakao: null,
      naver: null,
      devFake: false,
    },
    storage: localStorage,
    auth: { idToken: async () => 'id-token' } as AuthClient,
    fetch,
  });
  expect(await api.me()).toMatchObject({ ok: false, kind: error });
});
