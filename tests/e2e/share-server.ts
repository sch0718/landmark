import type { BrowserContext } from '@playwright/test';
import { require as tsxRequire } from 'tsx/cjs/api';
import type { MeetDeps } from '../../src/server/meet/handlers';
import { createSqliteD1 } from '../helpers/sqlite-d1';

// 약속 시험(`meet-server.ts`)처럼 진짜 처리 코드와 시험용 SQLite로 짧은 링크 요청을 받는다.
const { handleShareCreate, handleShareDelete, handleShareOpen } = tsxRequire(
  '../../src/server/share/handlers.ts',
  import.meta.url,
) as typeof import('../../src/server/share/handlers');

/** `/api/share`·`/api/share/:id`·`/s/:id`를 가로챈다. 시험마다 DB 하나를 쓴다. */
export async function installShareServer(context: BrowserContext): Promise<() => void> {
  const db = createSqliteD1();
  const deps: MeetDeps = {
    now: () => new Date(),
    fetch: async () => {
      throw new Error('짧은 링크 시험에서는 외부 통신을 쓰지 않아요');
    },
  };
  const isShare = (url: URL) =>
    url.pathname === '/api/share' ||
    url.pathname.startsWith('/api/share/') ||
    url.pathname.startsWith('/s/');
  await context.route(isShare, async (route) => {
    const source = route.request();
    const url = new URL(source.url());
    const headers = new Headers(await source.allHeaders());
    // 화면 이동(`/s/:id`)에는 출처를 붙이지 않는다. API는 E2E_PORT와 무관하게 기존 허용 출처로 처리한다.
    if (url.pathname.startsWith('/api/')) headers.set('Origin', 'http://localhost:5173');
    const id = /^\/(?:api\/share|s)\/([^/]+)$/.exec(url.pathname)?.[1];
    const handler =
      url.pathname === '/api/share' && source.method() === 'POST'
        ? handleShareCreate
        : url.pathname.startsWith('/s/') && source.method() === 'GET'
          ? handleShareOpen
          : source.method() === 'DELETE'
            ? handleShareDelete
            : undefined;
    if (!handler) {
      await route.fallback();
      return;
    }
    const pending: Promise<unknown>[] = [];
    const response = await handler(
      {
        request: new Request(url, {
          method: source.method(),
          headers,
          body: source.postData(),
        }),
        env: { DB: db },
        params: id === undefined ? {} : { id: decodeURIComponent(id) },
        waitUntil: (promise) => {
          pending.push(promise);
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
  });
  return () => db.close();
}
