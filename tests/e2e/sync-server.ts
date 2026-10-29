import type { BrowserContext } from '@playwright/test';
import { require as tsxRequire } from 'tsx/cjs/api';
import type { SyncDeps } from '../../src/server/library-sync/env';
import { createSqliteD1 } from '../helpers/sqlite-d1';
// Playwright의 ESM 로더 훅과 충돌하지 않도록 기존 약속 시험과 같은 방식으로 읽는다.
const { handleSync } = tsxRequire(
  '../../src/server/library-sync/router.ts',
  import.meta.url,
) as typeof import('../../src/server/library-sync/router');
export function createSyncServer() {
  const db = createSqliteD1();
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
    const response = await server.handle(
      new Request(source.url(), {
        method: source.method(),
        headers: await source.allHeaders(),
        body: source.postData(),
      }),
    );
    if (!response) return route.fallback();
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}
