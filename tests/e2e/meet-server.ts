import type { BrowserContext } from '@playwright/test';
import { require as tsxRequire } from 'tsx/cjs/api';
import type { MeetContext } from '../../src/server/meet/env';
import type { MeetDeps } from '../../src/server/meet/handlers';
import { createSqliteD1 } from '../helpers/sqlite-d1';

// Node에서도 기존 dayjs 플러그인의 확장자 없는 import를 읽도록 이미 쓰는 tsx로 불러온다.
const {
  handleClaim,
  handleCreate,
  handleDelete,
  handleGet,
  handleRelease,
  handleReply,
  handleUpdate,
} = tsxRequire(
  '../../src/server/meet/handlers.ts',
  import.meta.url,
) as typeof import('../../src/server/meet/handlers');

export type MeetServer = {
  handle(request: Request): Promise<Response | null>;
  close(): void;
};

type Handler = (context: MeetContext, deps: MeetDeps) => Promise<Response>;
const ACTIONS: Record<string, Handler> = {
  'POST claim': handleClaim,
  'PUT reply': handleReply,
  'POST release': handleRelease,
  'GET ': handleGet,
  'PUT ': handleUpdate,
  'DELETE ': handleDelete,
};

/** 시험마다 DB 하나를 만들고 같은 시험의 모든 브라우저 문맥이 공유한다. */
export function createMeetServer(): MeetServer {
  const db = createSqliteD1();
  const deps: MeetDeps = {
    now: () => new Date(),
    fetch: async () => {
      throw new Error('약속 시험에서는 외부 통신을 쓰지 않아요');
    },
  };
  return {
    async handle(request) {
      const { pathname } = new URL(request.url);
      const match = /^\/api\/meet\/([^/]+)(?:\/(claim|reply|release))?$/.exec(pathname);
      const handler =
        pathname === '/api/meet' && request.method === 'POST'
          ? handleCreate
          : match
            ? ACTIONS[`${request.method} ${match[2] ?? ''}`]
            : undefined;
      if (!handler) return null;
      const pending: Promise<unknown>[] = [];
      const response = await handler(
        {
          request,
          env: { DB: db, MEET_ONLINE: 'on' },
          params: match ? { id: match[1]! } : {},
          waitUntil: (promise) => {
            pending.push(promise);
          },
        },
        deps,
      );
      // 정리를 기다린 뒤 응답해 다음 시험까지 DB 처리를 남기지 않는다.
      await Promise.all(pending);
      return response;
    },
    close: () => db.close(),
  };
}

export async function installMeetServer(
  context: BrowserContext,
  server: MeetServer,
): Promise<void> {
  await context.route('**/api/meet**', async (route) => {
    const source = route.request();
    const headers = new Headers(await source.allHeaders());
    // E2E_PORT와 무관하게 기존 허용 출처로 처리한다. 실제 허용 목록은 바꾸지 않는다.
    headers.set('Origin', 'http://localhost:5173');
    const response = await server.handle(
      new Request(source.url(), {
        method: source.method(),
        headers,
        body: source.postData(),
      }),
    );
    if (!response) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}
