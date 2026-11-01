// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateLeg } from 'src/domain/trips/geo';
import { dayLegs } from 'src/domain/trips/query';
import * as route from 'src/server/route';
import { buildLibrary } from '../../../../pipeline/agent-trip/build-library';
import type { TripIssue } from '../../../../pipeline/agent-trip/errors';
import type { TripPlan } from '../../../../pipeline/agent-trip/plan-schema';
import type { ResolvedPlace } from '../../../../pipeline/agent-trip/resolve-places';
import { prepareRoutes } from '../../../../pipeline/agent-trip/route-legs';

const NOW = new Date('2026-11-01T05:12:00.000Z');
const PATH: [number, number][] = [
  [128, 37],
  [128.02, 37.01],
];
const carBody = () => ({
  code: 0,
  route: { a: [{ summary: { distance: 2500, duration: 120500, tollFare: 1800 }, path: PATH }] },
});
const walkBody = () => ({
  routes: [
    {
      summary: { distance: 620, duration: 558 },
      legs: [{ steps: [{ path: '128,37 128.005,37' }] }],
    },
  ],
});

function fixture(pairs: [number, number][][] = [PATH]) {
  const places: ResolvedPlace[] = pairs.flatMap((pair, d) =>
    pair.map(([lng, lat], i) => ({
      key: `p${d}_${i}`,
      index: d * 2 + i,
      candidate: {
        source: { kind: 'pin' as const },
        name: `장소 ${d}_${i}`,
        address: '',
        lng,
        lat,
        category: null,
      },
      memo: '',
    })),
  );
  const p: TripPlan = {
    format: 'landmark-trip-plan',
    version: 1,
    title: '구간 시험',
    startDate: '2026-11-20',
    endDate: `2026-11-${19 + pairs.length}`,
    places: places.map((r) => ({
      key: r.key,
      name: r.candidate.name,
      lng: r.candidate.lng,
      lat: r.candidate.lat,
    })),
    days: pairs.map((pair, d) => ({ stops: pair.map((_, i) => ({ place: `p${d}_${i}` })) })),
  };
  const built = buildLibrary(p, places, NOW, []);
  const trip = built.lib.trips[built.tripId]!;
  return { built, legs: trip.days.flatMap((_, d) => dayLegs(built.lib, trip, d)) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const stats = (overrides = {}) => ({
  legs: 1,
  routed: 0,
  estimated: 0,
  noRoute: 0,
  samePoint: 0,
  oldestQueriedAt: null,
  ...overrides,
});

describe('여행 구간 미리 조회', () => {
  it.each([
    ['car', [128.0200056, 37.0100056]],
    ['walk', [128.0050056, 37.0000056]],
  ] as const)('%s 조회는 소수 7자리 좌표를 앱처럼 5자리로 맞춘다', async (mode, to) => {
    const from: [number, number] = [128.0000056, 37.0000056];
    const { built, legs } = fixture([[from, [...to]]]);
    const resolve = vi.spyOn(route, 'resolveRoute');
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(mode === 'car' ? carBody() : walkBody()),
    );
    const result = await prepareRoutes(built, { fetch, sleep: async () => {} }, []);
    expect(legs[0]!.mode).toBe(mode);
    expect(result.stats.routed).toBe(1);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    if (mode === 'car') {
      expect(url.searchParams.get('start')).toBe('128.00001,37.00001');
      expect(url.searchParams.get('goal')).toBe('128.02001,37.01001');
    } else {
      expect(url.searchParams.get('l')).toBe('128.00001,37.00001;128.00501,37.00001');
    }
    expect(resolve).toHaveBeenCalledExactlyOnceWith(
      {
        mode,
        from: [128.00001, 37.00001],
        to: mode === 'car' ? [128.02001, 37.01001] : [128.00501, 37.00001],
      },
      { fetch },
    );
  });

  it('자동차 경로의 초·거리·통행료·경로선·조회 시각을 그대로 쓴다', async () => {
    const { built, legs } = fixture();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(carBody()));
    const sleep = vi.fn(async () => {});
    const warnings: TripIssue[] = [];
    const result = await prepareRoutes(built, { fetch, sleep }, warnings);
    expect(result.routeOf(legs[0]!)).toEqual({
      durationS: 121,
      distanceM: 2500,
      tollFare: 1800,
      status: 'routed',
      queriedAt: NOW.toISOString(),
      path: PATH,
    });
    expect(result.stats).toEqual(stats({ routed: 1, oldestQueriedAt: NOW.toISOString() }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toContain(
      '/directions/car?start=128.00000,37.00000&goal=128.02000,37.01000',
    );
    expect(sleep).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });

  it('도보 성공은 초 단위를 유지하고 통행료가 없다', async () => {
    const { built, legs } = fixture([
      [
        [128, 37],
        [128.005, 37],
      ],
    ]);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(walkBody()));
    const result = await prepareRoutes(built, { fetch, sleep: async () => {} }, []);
    expect(result.routeOf(legs[0]!)).toEqual({
      durationS: 558,
      distanceM: 620,
      tollFare: null,
      status: 'routed',
      queriedAt: NOW.toISOString(),
      path: [
        [128, 37],
        [128.005, 37],
      ],
    });
    expect(String(fetch.mock.calls[0]![0])).toContain('/directions/walk?');
    expect(result.stats).toEqual(stats({ routed: 1, oldestQueriedAt: NOW.toISOString() }));
  });

  it.each(['no-route', 'estimated'] as const)(
    '%s는 앱과 같은 어림값과 Day 경고를 쓴다',
    async (status) => {
      const { built, legs } = fixture();
      const warnings: TripIssue[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        status === 'no-route' ? Response.json({ code: 1 }) : new Response('{}', { status: 500 }),
      );
      const result = await prepareRoutes(built, { fetch, sleep: async () => {} }, warnings);
      expect(result.routeOf(legs[0]!)).toEqual({
        ...estimateLeg(legs[0]!.mode, legs[0]!.straightM),
        tollFare: null,
        status,
        queriedAt: null,
        path: [],
      });
      expect(result.stats).toEqual(
        stats(status === 'no-route' ? { noRoute: 1 } : { estimated: 1 }),
      );
      expect(warnings).toEqual([
        {
          path: 'days[0]',
          code: 'lookup-failed',
          message:
            status === 'no-route'
              ? '경로가 없어 직선 어림값을 썼어요'
              : '경로를 받지 못해 직선 어림값을 썼어요',
        },
      ]);
    },
  );

  it('연결 오류도 estimated로 바꾸고 원래 오류 내용을 경고에 노출하지 않는다', async () => {
    const { built, legs } = fixture();
    const warnings: TripIssue[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError('외부 응답 상세');
    });
    const result = await prepareRoutes(built, { fetch, sleep: async () => {} }, warnings);
    expect(result.routeOf(legs[0]!)).toEqual({
      ...estimateLeg(legs[0]!.mode, legs[0]!.straightM),
      tollFare: null,
      status: 'estimated',
      queriedAt: null,
      path: [],
    });
    expect(result.stats).toEqual(stats({ estimated: 1 }));
    expect(JSON.stringify(warnings)).not.toContain('외부 응답 상세');
  });

  it.each([false, true])('약 5m 떨어진 두 장소는 요청 없이 same-point다(skip=%s)', async (skip) => {
    const { built, legs } = fixture([
      [
        [128, 37],
        [128, 37.000045],
      ],
    ]);
    const fetch = vi.fn<typeof globalThis.fetch>();
    const sleep = vi.fn(async () => {});
    const result = await prepareRoutes(built, { fetch, sleep, skip }, []);
    expect(result.routeOf(legs[0]!)).toEqual({
      durationS: 0,
      distanceM: 0,
      tollFare: null,
      status: 'same-point',
      queriedAt: null,
      path: [],
    });
    expect(result.stats).toEqual(stats({ samePoint: 1 }));
    expect(fetch).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('소수 5자리 입력 키가 같은 두 Day는 한 번만 묻고 구간 수는 각각 센다', async () => {
    const { built, legs } = fixture([
      PATH,
      [
        [128.0000001, 37],
        [128.0200001, 37.01],
      ],
    ]);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(carBody()));
    const sleep = vi.fn(async () => {});
    const result = await prepareRoutes(built, { fetch, sleep }, []);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result.routeOf(legs[0]!)).toEqual(result.routeOf(legs[1]!));
    expect(result.stats).toEqual(stats({ legs: 2, routed: 2, oldestQueriedAt: NOW.toISOString() }));
  });

  it('같은 입력 키의 실패도 한 번만 묻고 첫 Day에 경고를 남긴다', async () => {
    const { built, legs } = fixture([PATH, PATH]);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ code: 1 }));
    const warnings: TripIssue[] = [];
    const result = await prepareRoutes(built, { fetch, sleep: async () => {} }, warnings);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.routeOf(legs[0]!).status).toBe('no-route');
    expect(result.routeOf(legs[1]!).status).toBe('no-route');
    expect(result.stats).toEqual(stats({ legs: 2, noRoute: 2 }));
    expect(warnings).toEqual([expect.objectContaining({ path: 'days[0]', code: 'lookup-failed' })]);
  });

  it.each([undefined, 25])(
    '서로 다른 요청 사이에만 간격을 두고 가장 오래된 조회 시각을 고른다(gapMs=%s)',
    async (gapMs) => {
      const { built } = fixture([
        PATH,
        [
          [128.04, 37],
          [128.05, 37.01],
        ],
      ]);
      const events: (string | number)[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async () => {
        events.push('요청');
        if (fetch.mock.calls.length === 2) vi.setSystemTime(new Date('2026-10-31T00:00:00.000Z'));
        return Response.json(carBody());
      });
      const sleep = vi.fn(async (ms: number) => {
        events.push(ms);
      });
      const result = await prepareRoutes(built, { fetch, sleep, gapMs }, []);
      expect(events).toEqual(['요청', gapMs ?? 300, '요청']);
      expect(result.stats).toEqual(
        stats({ legs: 2, routed: 2, oldestQueriedAt: '2026-10-31T00:00:00.000Z' }),
      );
    },
  );

  it('skip이면 일반 구간은 모두 estimated이며 경고·요청·대기가 없다', async () => {
    const { built, legs } = fixture([PATH, PATH]);
    const fetch = vi.fn<typeof globalThis.fetch>();
    const sleep = vi.fn(async () => {});
    const warnings: TripIssue[] = [];
    const result = await prepareRoutes(built, { fetch, sleep, skip: true }, warnings);
    for (const leg of legs)
      expect(result.routeOf(leg)).toEqual({
        ...estimateLeg(leg.mode, leg.straightM),
        tollFare: null,
        status: 'estimated',
        queriedAt: null,
        path: [],
      });
    expect(result.stats).toEqual(stats({ legs: 2, estimated: 2 }));
    expect(fetch).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });

  it('구간이 없는 여행의 통계는 모두 0이다', async () => {
    const { built } = fixture([[[128, 37]]]);
    const fetch = vi.fn<typeof globalThis.fetch>();
    const result = await prepareRoutes(built, { fetch, sleep: async () => {} }, []);
    expect(result.stats).toEqual(stats({ legs: 0 }));
    expect(fetch).not.toHaveBeenCalled();
  });
});
