import type { BrowserContext } from '@playwright/test';
import { require as tsxRequire } from 'tsx/cjs/api';
import type { MeetDeps } from '../../src/server/meet/handlers';
import { createSqliteD1 } from '../helpers/sqlite-d1';
const { handleLiveCreate, handleLiveGet, handleLiveUpdate, handleLiveRotate, handleLiveDelete } =
  tsxRequire(
    '../../src/server/trip-live/handlers.ts',
    import.meta.url,
  ) as typeof import('../../src/server/trip-live/handlers');
/** 문맥마다 같은 시험용 D1을 연결해 기기 간 흐름도 실제 처리 코드로 검사한다. */
export function createTripLiveServer(): {
  install(context: BrowserContext): Promise<void>;
  close(): void;
} {
  const db = createSqliteD1();
  const deps: MeetDeps = {
    now: () => new Date(),
    fetch: async () => {
      throw new Error('갱신 공유 시험은 외부 통신을 쓰지 않아요');
    },
  };
  return {
    async install(context) {
      await context.route(
        (url) => url.pathname === '/api/trip-live' || url.pathname.startsWith('/api/trip-live/'),
        async (route) => {
          const source = route.request(),
            url = new URL(source.url()),
            method = source.method();
          const match = /^\/api\/trip-live\/([a-z0-9]{10})(\/rotate)?$/.exec(url.pathname);
          const handler =
            url.pathname === '/api/trip-live' && method === 'POST'
              ? handleLiveCreate
              : match?.[2] && method === 'POST'
                ? handleLiveRotate
                : match && !match[2]
                  ? method === 'GET'
                    ? handleLiveGet
                    : method === 'PUT'
                      ? handleLiveUpdate
                      : method === 'DELETE'
                        ? handleLiveDelete
                        : undefined
                  : undefined;
          if (!handler) {
            await route.fallback();
            return;
          }
          const headers = new Headers(await source.allHeaders());
          headers.set('Origin', 'http://localhost:5173');
          const pending: Promise<unknown>[] = [];
          const response = await handler(
            {
              request: new Request(url, { method, headers, body: source.postData() }),
              env: { DB: db },
              params: match ? { id: match[1]! } : {},
              waitUntil(p) {
                pending.push(p);
              },
            },
            deps,
          );
          await Promise.all(pending);
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
          });
        },
      );
    },
    close() {
      db.close();
    },
  };
}
