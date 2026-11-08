// @vitest-environment node
import { expect, it } from 'vitest';
import { socialAuthorizeUrl, socialNonce } from '@sch0718/firebase-session/client';
import { base64url } from '@sch0718/firebase-session/worker';
import { handleSync } from 'src/server/library-sync/router';
import { productionDeps } from 'src/server/library-sync/env';
import { createTestD1 } from '@sch0718/firebase-session/testing/d1';
it.each([
  ['kakao', 'kakao:dev-me,naver:dev-me'],
  ['naver', 'kakao:dev-me,naver:dev-me'],
  ['kakao', undefined],
] as const)('가짜 %s 로그인에 서버 설정(%s, 없으면 열림)을 연결한다', async (provider, allowed) => {
  const db = createTestD1();
  const deps = productionDeps();
  deps.log = () => {};
  const env = { DB: db, SYNC_DEV_FAKE_SOCIAL: '1', ALLOWED_ACCOUNTS: allowed, LIBRARY_SYNC: '' };
  const call = (path: string, init?: RequestInit) =>
    handleSync(
      {
        request: new Request(`http://localhost:8795${path}`, {
          ...init,
          headers: { Origin: 'http://localhost:8795', ...init?.headers },
        }),
        env,
        params: {},
        waitUntil: () => {},
      },
      deps,
    );
  try {
    const verifier = 'a'.repeat(43);
    const nonce = await socialNonce(verifier);
    const challenge = base64url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
    );
    const url = new URL(
      socialAuthorizeUrl(provider, {
        clientId: `dev-fake-${provider}`,
        redirectUri: 'http://localhost:8795/auth/callback',
        state: 'test-state',
        nonce,
        codeChallenge: challenge,
      }),
    );
    url.searchParams.set('provider', provider);
    const query = url.searchParams;
    const authorize = await call(`/api/sync/dev/fake-social/authorize?${query}`);
    expect(authorize.status).toBe(200);
    for (const [sub, result, status] of [
      ['me', 'ok', 200],
      ['stranger', 'ok', allowed ? 403 : 200],
    ] as const) {
      query.set('sub', sub);
      query.set('result', result);
      const approved = await call(`/api/sync/dev/fake-social/approve?${query}`);
      const html = await approved.text();
      const callback = new URL(html.match(/url=([^"<]+)/)![1]!.replaceAll('&amp;', '&'));
      const response = await call('/api/sync/v1/session/social', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          code: callback.searchParams.get('code'),
          codeVerifier: verifier,
          redirectUri: 'http://localhost:8795/auth/callback',
          label: '시험 기기',
        }),
      });
      expect(response.status).toBe(status);
      if (status === 200) {
        const body = await response.json();
        expect(body.user.sub).toBe(`${provider}:dev-${sub}`);
        expect(
          (
            await call('/api/sync/v1/sessions', {
              headers: { 'X-Landmark-Session': body.sessionId },
            })
          ).status,
        ).toBe(200);
      }
      if (status === 403)
        expect(await response.json()).toMatchObject({ account: `${provider}:dev-stranger` });
    }
    env.LIBRARY_SYNC = 'off';
    const off = await call('/api/sync/v1/session/social', { method: 'POST' });
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ error: 'off' });
    const crossOrigin = await call('/api/sync/v1/session/social', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toEqual({ error: 'origin' });
  } finally {
    db.close();
  }
});

it('운영 요청에는 가짜 공급자를 열지 않는다', async () => {
  const deps = productionDeps();
  deps.log = () => {};
  const response = await handleSync(
    {
      request: new Request('https://landmark.sch0718.dev/api/sync/dev/fake-social/authorize'),
      env: { SYNC_DEV_FAKE_SOCIAL: '1' },
      params: {},
      waitUntil: () => {},
    },
    deps,
  );
  expect(response.status).toBe(404);
});
