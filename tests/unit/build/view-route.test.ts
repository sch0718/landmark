// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it, vi } from 'vitest';

type Middleware = (request: { url?: string }, response: object, next: () => void) => void;
type RoutePlugin = {
  name: string;
  configureServer(server: { middlewares: { use(middleware: Middleware): void } }): void;
};
let middleware: Middleware;
beforeAll(async () => {
  const path = fileURLToPath(new URL('../../../vite.config.ts', import.meta.url));
  const { default: configure } = await import(path);
  const config = configure({ command: 'serve', mode: 'development' }) as { plugins: RoutePlugin[] };
  const plugin = config.plugins.find((p) => p.name === 'tripmap:view-route')!;
  plugin.configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  });
});

it.each([
  ['/view', '/view.html'],
  ['/view?x=1', '/view.html?x=1'],
  ['/view/', '/view.html'],
  ['/view.html', '/view.html'],
  ['/api/place?sid=1', '/api/place?sid=1'],
  ['/import', '/import'],
  ['/trips/abc', '/trips/abc'],
  ['/', '/'],
])('개발 경로 %s → %s (API·SPA 유지)', (url, expected) => {
  const request = { url };
  const next = vi.fn();
  middleware(request, {}, next);
  expect(request.url).toBe(expected);
  expect(next).toHaveBeenCalledOnce();
});
