import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RouteResult } from './naver-client';

export type CachedRoute = RouteResult & { queriedAt: string };

export type RouteCache = {
  get(key: string): Promise<CachedRoute | null>;
  set(key: string, v: CachedRoute): Promise<void>;
};

const round7 = (x: number): number => Number(x.toFixed(7));

export function routeCacheKey(start: [number, number], goal: [number, number]): string {
  const payload = {
    cacheVersion: 1,
    start: [round7(start[0]), round7(start[1])],
    goal: [round7(goal[0]), round7(goal[1])],
    option: 'car:default',
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function isCachedRoute(v: unknown): v is CachedRoute {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r.path) &&
    typeof r.distanceM === 'number' &&
    typeof r.durationMs === 'number' &&
    typeof r.staticDurationMs === 'number' &&
    typeof r.tollFare === 'number' &&
    typeof r.queriedAt === 'string'
  );
}

export function createFileRouteCache(dir: string): RouteCache {
  const file = (key: string) => join(dir, `${key}.json`);
  return {
    async get(key) {
      try {
        const v: unknown = JSON.parse(await readFile(file(key), 'utf-8'));
        return isCachedRoute(v) ? v : null;
      } catch {
        return null;
      }
    },
    async set(key, v) {
      await mkdir(dir, { recursive: true });
      await writeFile(file(key), JSON.stringify(v));
    },
  };
}
