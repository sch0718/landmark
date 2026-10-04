import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileRouteCache, routeCacheKey } from '../../../pipeline/route-cache';

const entry = {
  distanceM: 100,
  durationMs: 2000,
  staticDurationMs: 1900,
  tollFare: 0,
  path: [
    [128, 38],
    [128.1, 38.1],
  ] as [number, number][],
  queriedAt: '2026-10-03T00:00:00.000Z',
};

describe('routeCacheKey', () => {
  const s: [number, number] = [128.5968, 38.2133];
  const g: [number, number] = [126.9575, 37.4776];
  it('좌표가 1e-7 바뀌면 키가 다르다', () => {
    expect(routeCacheKey([s[0] + 1e-7, s[1]], g)).not.toBe(routeCacheKey(s, g));
  });
  it('1e-8 차이는 같은 키다', () => {
    expect(routeCacheKey([s[0] + 1e-8, s[1]], g)).toBe(routeCacheKey(s, g));
  });
  it('64자 hex다', () => {
    expect(routeCacheKey(s, g)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createFileRouteCache', () => {
  it('없는 키는 null, set 후 get은 같은 값 (디렉터리 지연 생성)', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'rc-')), 'nested', 'routes');
    const cache = createFileRouteCache(dir);
    expect(await cache.get('abc')).toBeNull();
    await cache.set('abc', entry);
    expect(await cache.get('abc')).toEqual(entry);
    expect(JSON.parse(await readFile(join(dir, 'abc.json'), 'utf-8'))).toEqual(entry);
  });
  it('형식이 맞지 않는 항목은 miss로 취급한다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rc-'));
    await writeFile(join(dir, 'old.json'), JSON.stringify({ distanceM: 1 }));
    expect(await createFileRouteCache(dir).get('old')).toBeNull();
  });
  it('깨진 JSON은 miss로 취급한다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rc-'));
    await writeFile(join(dir, 'bad.json'), '{not json');
    expect(await createFileRouteCache(dir).get('bad')).toBeNull();
  });
});
