import { socialAuthorizeUrl, socialNonce } from '@sch0718/firebase-session/client';
import { base64url } from '@sch0718/firebase-session/worker';
import { handleSync } from '../../src/server/library-sync/router';
import { productionDeps, type SyncEnv } from '../../src/server/library-sync/env';
import { createSqliteD1 } from './sqlite-d1';
export function createSyncMemoryServer(extra: Partial<SyncEnv> = {}) {
  const db = createSqliteD1();
  const env: SyncEnv = {
    DB: db,
    SYNC_DEV_FAKE_SOCIAL: '1',
    ALLOWED_ACCOUNTS: 'kakao:dev-me,naver:dev-me',
    ...extra,
  };
  const deps = productionDeps();
  deps.log = () => {};
  deps.fetch = async () => {
    throw Error('시험에서 외부 요청은 허용하지 않아요');
  };
  deps.certs = { key: async () => null };
  deps.socialKeys = { kakao: deps.certs, naver: deps.certs };
  async function handle(request: Request): Promise<Response | null> {
    if (!new URL(request.url).pathname.startsWith('/api/sync/')) return null;
    const pending: Promise<unknown>[] = [];
    const response = await handleSync(
      {
        request,
        env,
        params: {},
        waitUntil: (p) => {
          pending.push(p);
        },
      },
      deps,
    );
    await Promise.all(pending);
    return response;
  }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (!request.headers.has('Origin')) request.headers.set('Origin', new URL(request.url).origin);
    const response = await handle(request);
    if (!response) throw Error('시험 서버가 모르는 경로예요');
    return response;
  };
  async function login(sub = 'me'): Promise<string> {
    const origin = 'http://localhost:8795';
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const nonce = await socialNonce(verifier);
    const challenge = base64url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
    );
    const query = new URL(
      socialAuthorizeUrl('kakao', {
        clientId: 'dev-fake-kakao',
        redirectUri: origin + '/auth/callback',
        state: 'test-state',
        nonce,
        codeChallenge: challenge,
      }),
    ).searchParams;
    query.set('provider', 'kakao');
    await fetch(origin + '/api/sync/dev/fake-social/authorize?' + query);
    query.set('sub', sub);
    query.set('result', 'ok');
    const approved = await fetch(origin + '/api/sync/dev/fake-social/approve?' + query);
    const callback = new URL(
      (await approved.text()).match(/url=([^"<]+)/)![1]!.replaceAll('&amp;', '&'),
    );
    const response = await fetch(origin + '/api/sync/v1/session/social', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'kakao',
        code: callback.searchParams.get('code'),
        codeVerifier: verifier,
        redirectUri: origin + '/auth/callback',
        label: '시험 기기',
      }),
    });
    if (!response.ok) throw Error('시험 로그인 실패');
    return (await response.json()).sessionId as string;
  }
  return { fetch, handle, db, login };
}
