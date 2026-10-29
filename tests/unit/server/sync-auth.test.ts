// @vitest-environment node
import { expect, it } from 'vitest';
import { handleSync } from 'src/server/library-sync/router';
import { providerStatus, redirectUrisFor } from 'src/server/library-sync/auth';
import { isSyncOrigin } from 'src/server/library-sync/http';
import { productionDeps, type SyncContext } from 'src/server/library-sync/env';
import { createSqliteD1 } from '../../helpers/sqlite-d1';
const db = createSqliteD1();
const ctx = (
  path: string,
  extra: Partial<SyncContext['env']> = {},
  method = 'GET',
): SyncContext => ({
  request: new Request(`http://localhost:8795/api/sync${path}`, {
    method,
    headers: { Origin: 'http://localhost:4185' },
  }),
  env: { DB: db, ...extra },
  params: {},
  waitUntil: () => {},
});
it('로컬 임의 포트는 로컬 요청에만 허용한다', () => {
  for (const origin of ['http://localhost:4185', 'http://127.0.0.1:8795']) {
    expect(
      isSyncOrigin(new Request('http://localhost:8795', { headers: { Origin: origin } })),
    ).toBe(true);
    expect(
      isSyncOrigin(new Request('https://landmark.sch0718.dev', { headers: { Origin: origin } })),
    ).toBe(false);
  }
  for (const origin of ['https://landmark.sch0718.dev', 'https://abc.landmark-c5f.pages.dev'])
    expect(
      isSyncOrigin(new Request('https://landmark.sch0718.dev', { headers: { Origin: origin } })),
    ).toBe(true);
  expect(
    isSyncOrigin(
      new Request('http://localhost:8795', { headers: { Origin: 'https://evil.example' } }),
    ),
  ).toBe(false);
});
it('공급자 설정과 콜백 주소를 검사한다', () => {
  expect(providerStatus(ctx('/'))).toEqual({
    google: false,
    kakao: false,
    naver: false,
    devFake: false,
  });
  expect(
    providerStatus(ctx('/', { KAKAO_CLIENT_ID: 'public', NAVER_CLIENT_ID: 'public' })).kakao,
  ).toBe(true);
  expect(providerStatus(ctx('/', { NAVER_CLIENT_ID: 'public' })).naver).toBe(false);
  expect(redirectUrisFor(ctx('/'))).toEqual(['http://localhost:8795/auth/callback']);
  expect(
    redirectUrisFor(
      ctx('/', {
        SYNC_REDIRECT_URIS:
          'https://example.com/auth/callback,https://example.com/#x,javascript:bad',
      }),
    ),
  ).toEqual(['https://example.com/auth/callback']);
});
it('스위치·설정·메서드·출처와 no-store를 지킨다', async () => {
  const deps = productionDeps();
  deps.log = () => {};
  const off = await handleSync(ctx('/v1/status', { LIBRARY_SYNC: 'off' }), deps);
  expect(await off.json()).toMatchObject({ enabled: false, reason: 'off' });
  expect(off.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await (await handleSync(ctx('/v1/status'), deps)).json()).toMatchObject({
    reason: 'config',
  });
  for (const [path, env, method, status] of [
    ['/v1/session/social', { LIBRARY_SYNC: 'off' }, 'POST', 503],
    ['/v1/session', { LIBRARY_SYNC: 'off' }, 'DELETE', 401],
    ['/none', {}, 'GET', 404],
    ['/v1/status', { DB: undefined }, 'GET', 503],
  ] as const)
    expect((await handleSync(ctx(path, env, method), deps)).status).toBe(status);
  const bad = ctx('/v1/status');
  bad.request = new Request(bad.request.url, { headers: { Origin: 'https://evil.example' } });
  expect((await handleSync(bad, deps)).status).toBe(403);
});
it('로그인 61번째는 공급자 호출 전에 제한한다', async () => {
  const deps = productionDeps();
  deps.log = () => {};
  let response: Response | undefined;
  for (let i = 0; i < 61; i++)
    response = await handleSync(
      ctx('/v1/session/social', { SYNC_DEV_FAKE_SOCIAL: '1' }, 'POST'),
      deps,
    );
  expect(response?.status).toBe(429);
  db.close();
});
it('기존 개발 포트 출처도 운영 요청에는 허용하지 않는다', () => {
  expect(
    isSyncOrigin(
      new Request('https://landmark.sch0718.dev', { headers: { Origin: 'http://localhost:5173' } }),
    ),
  ).toBe(false);
});
