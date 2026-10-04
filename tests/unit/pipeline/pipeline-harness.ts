import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { CollectDeps } from '../../../pipeline/collect';
import type { FsPort } from '../../../pipeline/fs-port';
import type { CachedRoute, RouteCache } from '../../../pipeline/route-cache';

/** collect·apply-edit 테스트 공용: 메모리 FsPort와 녹화 fixture 기반 http. */

export const fixture = (p: string): string => readFileSync(`tests/fixtures/${p}`, 'utf-8');
export const SHARE_ID = 'fb65e7f93f8a4144a4ded594d604a7aa';
export const YAML_PATH = 'trips/basic.yaml';
export const NOW = '2026-10-03T01:00:00.000Z';

export function memFs(files: Record<string, string>): FsPort & { files: Record<string, string> } {
  return {
    files,
    readText: async (p) => {
      const v = files[p];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeTextAtomic: async (p, s) => {
      files[p] = s;
    },
    listFiles: async (dir, ext) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && p.endsWith(ext))
        .sort(),
  };
}

/**
 * collect deps를 만든다. `calls.routeQueries`에는 경로 API 호출의 `start=…&goal=…`이 순서대로 쌓인다.
 */
export function setupCollect(
  yaml = fixture('trips/basic.yaml'),
  folderStatus = 200,
  failRouteCall = 0,
) {
  const fs = memFs({ [YAML_PATH]: yaml });
  const store = new Map<string, CachedRoute>();
  const cache: RouteCache = {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
  };
  const calls = { folder: 0, route: 0, routeQueries: [] as string[] };
  const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes(`/shares/${SHARE_ID}/bookmarks`)) {
      calls.folder += 1;
      if (folderStatus !== 200) return new Response('x', { status: folderStatus });
      return new Response(fixture('naver/bookmarks-sokcho.json'));
    }
    if (url.includes('/api/directions/car')) {
      calls.route += 1;
      calls.routeQueries.push(new URL(url).search.slice(1));
      if (calls.route === failRouteCall) return new Response('x', { status: 500 });
      return new Response(fixture('naver/route-ok.json'));
    }
    return new Response('nf', { status: 404 });
  };
  let n = 0;
  const deps: CollectDeps = {
    fs,
    http: { fetch: fakeFetch as typeof fetch, sleep: async () => {} },
    cache,
    // 호출마다 다른 소문자 영숫자 문자열(길이 len)
    random: (len) => `${'a'.repeat(len)}${(n++).toString(36)}`.slice(-len),
    now: () => NOW,
    log: vi.fn(),
  };
  return { fs, deps, calls };
}
