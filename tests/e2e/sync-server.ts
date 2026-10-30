import type { BrowserContext } from '@playwright/test';
import { require as tsxRequire } from 'tsx/cjs/api';
import type { SyncDeps } from '../../src/server/library-sync/env';
import { createSqliteD1 } from '../helpers/sqlite-d1';
// Playwright의 ESM 로더 훅과 충돌하지 않도록 기존 약속 시험과 같은 방식으로 읽는다.
const { handleSync } = tsxRequire(
  '../../src/server/library-sync/router.ts',
  import.meta.url,
) as typeof import('../../src/server/library-sync/router');
type OriginHeaders = { origin: string | null; referer: string | null; secFetchSite: string | null };
function originHeaders(headers: Headers): OriginHeaders {
  // 진단에는 인증 헤더·콜백 질의 값을 담지 않는다.
  const referer = headers.get('referer');
  const url = referer ? new URL(referer) : null;
  return {
    origin: headers.get('origin'),
    referer: url ? `${url.origin}${url.pathname}` : null,
    secFetchSite: headers.get('sec-fetch-site'),
  };
}
type GetRequest = {
  path: string;
  browser: OriginHeaders;
  forwarded: OriginHeaders;
  status: number;
};
export function createSyncServer() {
  const db = createSqliteD1();
  const getRequests: GetRequest[] = [];
  const blocked = async () => {
    throw new Error('동기화 시험에서는 외부 통신을 쓰지 않아요');
  };
  const deps: SyncDeps = {
    now: Date.now,
    fetch: blocked,
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    uuid: () => crypto.randomUUID(),
    certs: { key: blocked },
    socialKeys: { kakao: { key: blocked }, naver: { key: blocked } },
    log: () => {},
  };
  return {
    db,
    getRequests,
    async handle(request: Request): Promise<Response | null> {
      if (!new URL(request.url).pathname.startsWith('/api/sync/')) return null;
      const pending: Promise<unknown>[] = [];
      const response = await handleSync(
        {
          request,
          env: { DB: db, SYNC_DEV_FAKE_SOCIAL: '1', ALLOWED_ACCOUNTS: 'kakao:dev-me,naver:dev-me' },
          params: {},
          waitUntil: (p) => {
            pending.push(p);
          },
        },
        deps,
      );
      await Promise.all(pending);
      return response;
    },
    close() {
      db.close();
    },
  };
}
export async function installSyncServer(
  context: BrowserContext,
  server: ReturnType<typeof createSyncServer>,
): Promise<void> {
  await context.route('**/api/sync/**', async (route) => {
    const source = route.request();
    const browserHeaders = new Headers(await source.allHeaders());
    const forwardedHeaders = new Headers(browserHeaders);
    // route.fulfill은 실제 네트워크를 거치지 않아 브라우저의 Fetch Metadata가 빠진다.
    // 요청 프레임의 출처로 Sec-Fetch-Site만 재현하고 Origin·Referer는 그대로 둔다.
    try {
      const frameOrigin = new URL(source.frame().url()).origin;
      forwardedHeaders.set(
        'Sec-Fetch-Site',
        new URL(source.url()).origin === frameOrigin ? 'same-origin' : 'cross-site',
      );
    } catch {
      // 프레임이나 출처를 알 수 없으면 Fetch Metadata를 만들어 넣지 않는다.
    }
    const request = new Request(source.url(), {
      method: source.method(),
      headers: forwardedHeaders,
      body: source.postData(),
    });
    const response = await server.handle(request);
    if (!response) return route.fallback();
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path.startsWith('/api/sync/v1/')) {
      const entry = {
        path,
        browser: originHeaders(browserHeaders),
        forwarded: originHeaders(request.headers),
        status: response.status,
      };
      server.getRequests.push(entry);
    }
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}
