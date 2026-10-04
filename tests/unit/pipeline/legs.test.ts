import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildLegs } from '../../../pipeline/legs';
import type { RouteResult } from '../../../pipeline/naver-client';
import { routeCacheKey, type RouteCache } from '../../../pipeline/route-cache';
import { TripDataSchema, type Place, type Stop } from 'src/schema/trip-data';

type Entry = RouteResult & { queriedAt: string };
const NOW = '2026-10-03T01:00:00.000Z';
const OLD = '2026-09-01T00:00:00.000Z';

const place = (lng: number, lat: number): Place => ({
  name: 'p',
  address: '',
  lng,
  lat,
  category: null,
  folderIds: [],
  savedAt: null,
});
const places: Record<string, Place> = {
  'c:a': place(128.5, 38.1),
  'c:b': place(128.6, 38.2),
  'c:c': place(128.7, 38.3),
};
const stops: Stop[] = [
  { id: 'stop1', placeKey: 'c:a' },
  { id: 'stop2', placeKey: 'c:b' },
  { id: 'stop3', placeKey: 'c:c' },
];

const okRoute = (): RouteResult => {
  const body = JSON.parse(readFileSync('tests/fixtures/naver/route-ok.json', 'utf-8')) as {
    route: Record<string, { summary: Record<string, number>; path: [number, number][] }[]>;
  };
  const first = body.route[Object.keys(body.route)[0]!]![0]!;
  return {
    distanceM: first.summary.distance!,
    durationMs: first.summary.duration!,
    staticDurationMs: first.summary.staticDuration!,
    tollFare: first.summary.tollFare!,
    path: first.path,
  };
};

function memCache(): RouteCache & { store: Map<string, Entry> } {
  const store = new Map<string, Entry>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
  };
}

const wrap = (days: Awaited<ReturnType<typeof buildLegs>>['days']) =>
  TripDataSchema.parse({
    schemaVersion: 1,
    publicId: 'abcdefghij',
    title: 't',
    startDate: '2026-10-10',
    endDate: '2026-10-10',
    dataVersion: NOW,
    folders: [],
    places,
    days,
  });

describe('buildLegs', () => {
  it('성공 구간은 routed Leg, 캐시 저장(원본 경로), 경로는 단순화', async () => {
    const cache = memCache();
    const route = okRoute();
    const fetchRoute = vi.fn(async () => route);
    const { days, failed } = await buildLegs([{ date: '2026-10-10', stops }], places, {
      cache,
      fetchRoute,
      refresh: false,
      now: NOW,
    });
    expect(failed).toEqual([]);
    expect(fetchRoute).toHaveBeenCalledTimes(2);
    const leg = days[0]!.legs[0]!;
    expect(leg).toMatchObject({
      fromStopId: 'stop1',
      toStopId: 'stop2',
      fromPlaceKey: 'c:a',
      toPlaceKey: 'c:b',
      status: 'routed',
      distanceKind: 'road',
      distanceM: route.distanceM,
      queriedAt: NOW,
    });
    expect(leg.path.length).toBeLessThan(route.path.length);
    const key = routeCacheKey([128.5, 38.1], [128.6, 38.2]);
    expect(cache.store.get(key)?.path).toHaveLength(route.path.length);
    expect(() => wrap(days)).not.toThrow();
  });

  it('캐시 히트면 fetchRoute를 부르지 않고 저장된 queriedAt을 유지, refresh면 호출', async () => {
    const cache = memCache();
    for (const [f, t] of [
      ['c:a', 'c:b'],
      ['c:b', 'c:c'],
    ] as const) {
      cache.store.set(
        routeCacheKey([places[f]!.lng, places[f]!.lat], [places[t]!.lng, places[t]!.lat]),
        { ...okRoute(), queriedAt: OLD },
      );
    }
    const fetchRoute = vi.fn(async () => okRoute());
    const deps = { cache, fetchRoute, refresh: false, now: NOW };
    const hit = await buildLegs([{ date: '2026-10-10', stops }], places, deps);
    expect(fetchRoute).not.toHaveBeenCalled();
    expect(hit.days[0]!.legs[0]!.queriedAt).toBe(OLD);

    const refreshed = await buildLegs([{ date: '2026-10-10', stops }], places, {
      ...deps,
      refresh: true,
    });
    expect(fetchRoute).toHaveBeenCalledTimes(2);
    expect(refreshed.days[0]!.legs[0]!.queriedAt).toBe(NOW);
  });

  it('실패 구간은 failed 직선 Leg, 캐시에 저장하지 않아 다음에 다시 호출', async () => {
    const cache = memCache();
    const fetchRoute = vi
      .fn<(s: [number, number], g: [number, number]) => Promise<RouteResult>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(okRoute());
    const deps = { cache, fetchRoute, refresh: false, now: NOW };
    const r = await buildLegs([{ date: '2026-10-10', stops }], places, deps);
    expect(r.failed).toEqual([{ date: '2026-10-10', from: 'c:a', to: 'c:b' }]);
    const leg = r.days[0]!.legs[0]!;
    expect(leg).toMatchObject({
      status: 'failed',
      distanceKind: 'straight',
      durationMs: null,
      staticDurationMs: null,
      tollFare: null,
      queriedAt: null,
      path: [
        [128.5, 38.1],
        [128.6, 38.2],
      ],
    });
    // 약 14.2km (haversine)
    expect(leg.distanceM).toBeGreaterThan(13_500);
    expect(leg.distanceM).toBeLessThan(14_500);
    expect(Number.isInteger(leg.distanceM)).toBe(true);
    expect(cache.store.size).toBe(1);
    expect(() => wrap(r.days)).not.toThrow();

    fetchRoute.mockClear();
    const again = await buildLegs([{ date: '2026-10-10', stops }], places, deps);
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(again.failed).toEqual([]);
  });

  it('한 실행 안에서 실패한 출발·도착 쌍은 다시 요청하지 않는다(§7.1)', async () => {
    const cache = memCache();
    const A = [128.5, 38.1];
    const fetchRoute = vi
      .fn<(s: [number, number], g: [number, number]) => Promise<RouteResult>>()
      .mockImplementation(async (s) => {
        if (s[0] === A[0] && s[1] === A[1])
          throw new Error('네이버 요청 실패: HTTP 503 (https://map.naver.com/…)');
        return okRoute();
      });
    // A→B, B→A, A→B (같은 날), 다음 날 A→B
    const abab: Stop[] = [
      { id: 'stop1', placeKey: 'c:a' },
      { id: 'stop2', placeKey: 'c:b' },
      { id: 'stop3', placeKey: 'c:a' },
      { id: 'stop4', placeKey: 'c:b' },
    ];
    const r = await buildLegs(
      [
        { date: '2026-10-10', stops: abab },
        {
          date: '2026-10-11',
          stops: [
            { id: 'stop5', placeKey: 'c:a' },
            { id: 'stop6', placeKey: 'c:b' },
          ],
        },
      ],
      places,
      { cache, fetchRoute, refresh: false, now: NOW },
    );
    const abRequests = fetchRoute.mock.calls.filter(([s]) => s[0] === A[0] && s[1] === A[1]);
    expect(abRequests).toHaveLength(1);
    expect(fetchRoute).toHaveBeenCalledTimes(2);
    expect(r.days[0]!.legs.map((l) => l.status)).toEqual(['failed', 'routed', 'failed']);
    expect(r.days[1]!.legs.map((l) => l.status)).toEqual(['failed']);
    expect(r.failed).toEqual([
      { date: '2026-10-10', from: 'c:a', to: 'c:b' },
      { date: '2026-10-10', from: 'c:a', to: 'c:b' },
      { date: '2026-10-11', from: 'c:a', to: 'c:b' },
    ]);
    expect(() =>
      TripDataSchema.parse({
        schemaVersion: 1,
        publicId: 'abcdefghij',
        title: 't',
        startDate: '2026-10-10',
        endDate: '2026-10-11',
        dataVersion: NOW,
        folders: [],
        places,
        days: r.days,
      }),
    ).not.toThrow();
  });

  it('fetch 성공 후 cache.set이 던지면 failed Leg가 아니라 reject', async () => {
    const cache: RouteCache = {
      get: async () => null,
      set: async () => {
        throw new Error('disk full');
      },
    };
    await expect(
      buildLegs([{ date: '2026-10-10', stops }], places, {
        cache,
        fetchRoute: vi.fn(async () => okRoute()),
        refresh: false,
        now: NOW,
      }),
    ).rejects.toThrow('disk full');
  });

  it('stops 0개·1개면 legs는 빈 배열', async () => {
    const deps = { cache: memCache(), fetchRoute: vi.fn(), refresh: false, now: NOW };
    const { days } = await buildLegs(
      [
        { date: '2026-10-10', stops: [] },
        { date: '2026-10-11', stops: [stops[0]!] },
      ],
      places,
      deps,
    );
    expect(days.map((d) => d.legs)).toEqual([[], []]);
    expect(deps.fetchRoute).not.toHaveBeenCalled();
  });

  it('알 수 없는 placeKey는 throw', async () => {
    await expect(
      buildLegs(
        [{ date: '2026-10-10', stops: [stops[0]!, { id: 'stopx', placeKey: 'zzz' }] }],
        places,
        {
          cache: memCache(),
          fetchRoute: vi.fn(),
          refresh: false,
          now: NOW,
        },
      ),
    ).rejects.toThrow(/zzz/);
  });
});
