// @vitest-environment node
import { expect, it } from 'vitest';
import { socialAuthorizeUrl, socialNonce } from '@sch0718/firebase-session/client';
import { base64url } from '@sch0718/firebase-session/worker';
import { handleSync } from 'src/server/library-sync/router';
import { productionDeps } from 'src/server/library-sync/env';
import { createSqliteD1 } from '../../helpers/sqlite-d1';
it.each(['kakao', 'naver'] as const)(
  '가짜 %s도 PKCE·nonce·토큰 검증과 허용 목록을 거친다',
  async (provider) => {
    const db = createSqliteD1();
    const deps = productionDeps();
    deps.log = () => {};
    const call = (path: string, init?: RequestInit) =>
      handleSync(
        {
          request: new Request(`http://localhost:8795${path}`, {
            ...init,
            headers: { Origin: 'http://localhost:8795', ...init?.headers },
          }),
          env: { DB: db, SYNC_DEV_FAKE_SOCIAL: '1' },
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
      expect(authorize.headers.get('Content-Security-Policy')).toBeTruthy();
      expect(await authorize.text()).toContain('계정 ID');
      for (const [sub, result, status] of [
        ['me', 'ok', 200],
        ['stranger', 'ok', 403],
        ['me', 'down', 503],
        ['me', 'bad-code', 401],
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
          expect(body.sessionId).toHaveLength(43);
          expect(body.user.sub).toBe(`${provider}:dev-me`);
          const row = await db
            .prepare('SELECT id_hash, identity FROM sessions')
            .first<{ id_hash: string; identity: string }>();
          expect(row?.id_hash).not.toBe(body.sessionId);
          expect(row?.identity).toBe(`${provider}:dev-me`);
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
      const production = await handleSync(
        {
          request: new Request('https://landmark.sch0718.dev/api/sync/dev/fake-social/authorize'),
          env: { DB: db, SYNC_DEV_FAKE_SOCIAL: '1' },
          params: {},
          waitUntil: () => {},
        },
        deps,
      );
      expect(production.status).toBe(404);
    } finally {
      db.close();
    }
  },
);
