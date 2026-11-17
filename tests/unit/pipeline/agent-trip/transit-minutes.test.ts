// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayLegs } from 'src/domain/trips/query';
import * as route from 'src/server/route';
import { buildDoc } from '../../../../pipeline/agent-trip/build-doc';
import { buildLibrary } from '../../../../pipeline/agent-trip/build-library';
import { TripFailure } from '../../../../pipeline/agent-trip/errors';
import { helpText } from '../../../../pipeline/agent-trip/help';
import {
  parsePlan,
  planJsonSchema,
  toPlanPath,
  type TripPlan,
} from '../../../../pipeline/agent-trip/plan-schema';
import { prepareRoutes } from '../../../../pipeline/agent-trip/route-legs';
import { summarize } from '../../../../pipeline/agent-trip/summary';

afterEach(() => vi.restoreAllMocks());

function plan(): TripPlan {
  return {
    format: 'landmark-trip-plan',
    version: 1,
    title: '이동',
    startDate: '2026-11-20',
    endDate: '2026-11-20',
    origin: 'a',
    places: [
      { key: 'a', name: '출발', lng: 128, lat: 37 },
      { key: 'b', name: '도착', lng: 128, lat: 37.09 },
      { key: 'c', name: '후보', lng: 128.1, lat: 37.1 },
    ],
    days: [{ startTime: '09:00', stops: [{ place: 'b' }] }],
    candidates: ['c'],
  };
}
function build(p: TripPlan) {
  return buildLibrary(
    p,
    p.places.map((x, index) => ({
      key: x.key,
      index,
      memo: '',
      candidate: {
        source: { kind: 'pin' as const },
        name: x.name!,
        address: '',
        lng: x.lng!,
        lat: x.lat!,
        category: null,
      },
    })),
    new Date('2026-11-01T00:00:00Z'),
    [],
  );
}
function issues(p: unknown) {
  try {
    parsePlan(p);
  } catch (e) {
    expect(e).toBeInstanceOf(TripFailure);
    return (e as TripFailure).issues;
  }
  throw new Error('입력 오류가 필요해요');
}

describe('AI CLI 대중교통과 직접 입력 시간', () => {
  it('transit과 직접 입력 시간 경계값을 허용한다', () => {
    for (const minutes of [1, 1440]) {
      const p = { ...plan(), legModes: { 'a>b': 'transit' }, legMinutes: { 'a>b': minutes } };
      expect(parsePlan(p)).toEqual(p);
    }
  });
  it.each([0, 1441, 1.5, null, '30', Infinity, NaN])(
    '잘못된 분을 레코드 경로로 거절한다: %s',
    (minutes) => {
      expect(issues({ ...plan(), legMinutes: { 'a>b': minutes } })).toContainEqual(
        expect.objectContaining({ path: 'legMinutes["a>b"]', code: 'schema' }),
      );
    },
  );
  it.each(['a', 'a>', '>b', 'a>b>c', 'missing>b'])(
    '모르는 장소와 잘못된 시간 키를 거절한다: %s',
    (key) => {
      expect(issues({ ...plan(), legMinutes: { [key]: 30 } })).toContainEqual(
        expect.objectContaining({ path: `legMinutes[${JSON.stringify(key)}]`, code: 'leg-modes' }),
      );
    },
  );
  it('분 경로를 변환하고 JSON Schema에도 분 범위를 담는다', () => {
    expect(toPlanPath('legMinutes.a>b')).toBe('legMinutes["a>b"]');
    const schema = JSON.stringify(planJsonSchema());
    expect(schema).toContain('legMinutes');
    expect(schema).toContain('1440');
  });
  it('실제 이웃이 아닌 분과 역방향 분을 보관함 생성에서 거절한다', () => {
    for (const key of ['a>c', 'b>a']) {
      const p = Object.assign(plan(), { legMinutes: { [key]: 30 } });
      expect(() => build(p)).toThrow(TripFailure);
      try {
        build(p);
      } catch (e) {
        expect((e as TripFailure).issues).toContainEqual(
          expect.objectContaining({
            path: `legMinutes[${JSON.stringify(key)}]`,
            code: 'leg-modes',
          }),
        );
      }
    }
  });
  it('수단을 먼저 적용하여 분이 지워지지 않고 자동 수단에도 분을 쓴다', () => {
    for (const mode of ['transit', 'car', undefined] as const) {
      const p = Object.assign(plan(), {
        legMinutes: { 'a>b': 30 },
        ...(mode ? { legModes: { 'a>b': mode } } : {}),
      });
      const b = build(p);
      expect(dayLegs(b.lib, b.lib.trips[b.tripId]!, 0)[0]).toMatchObject({
        minutes: 30,
        ...(mode ? { mode } : {}),
      });
    }
  });
  it.each(['transit', 'car', 'walk', undefined] as const)(
    '직접 입력은 경로 키·요청·대기에 들어가지 않는다(mode=%s)',
    async (mode) => {
      const p = Object.assign(plan(), {
        ...(mode ? { legModes: { 'a>b': mode } } : {}),
        legMinutes: { 'a>b': 30 },
      });
      const skip = mode === undefined;
      const b = build(p);
      const key = vi.spyOn(route, 'routeInputKey');
      const fetch = vi.fn<typeof globalThis.fetch>();
      const sleep = vi.fn(async () => {});
      const result = await prepareRoutes(b, { fetch, sleep, skip }, []);
      const leg = dayLegs(b.lib, b.lib.trips[b.tripId]!, 0)[0]!;
      expect(result.routeOf(leg)).toMatchObject({
        durationS: 1800,
        status: 'manual',
        queriedAt: null,
        path: [],
      });
      expect(result.stats.routed).toBe(0);
      expect(result.stats.estimated).toBe(0);
      expect(result.stats.manual).toBe(1);
      expect(key).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(sleep).not.toHaveBeenCalled();
      key.mockRestore();
    },
  );
  it('같은 지점 > 직접 입력 > 해외 0분 > 국내 대중교통 어림 순서를 지킨다', async () => {
    const p = Object.assign(plan(), { legModes: { 'a>b': 'transit' as const } });
    const b = build(p);
    const result = await prepareRoutes(b, { fetch: vi.fn(), sleep: async () => {} }, []);
    const leg = dayLegs(b.lib, b.lib.trips[b.tripId]!, 0)[0]!;
    expect(result.routeOf({ ...leg, straightM: 10000 })).toMatchObject({
      durationS: 49 * 60,
      status: 'estimated',
    });
    const abroad = { ...leg, to: { ...leg.to, lng: 2, lat: 48 } };
    expect(result.routeOf(abroad)).toMatchObject({ durationS: 0, status: 'estimated' });
    expect(result.routeOf({ ...abroad, minutes: 30 })).toMatchObject({
      durationS: 1800,
      status: 'manual',
    });
    expect(result.routeOf({ ...abroad, straightM: 5, minutes: 30 })).toMatchObject({
      durationS: 0,
      status: 'same-point',
    });
  });
  it('요약도 경로 콜백 전에 직접 입력을 적용해 도착 시각을 바꾸며 추정으로 세지 않는다', () => {
    const p = Object.assign(plan(), { legMinutes: { 'a>b': 30 } });
    const routeOf = vi.fn(() => {
      throw new Error('고정 시간은 경로 콜백에 들어가면 안 돼요');
    });
    const summary = summarize(build(p), routeOf, p);
    expect(summary[0]).toMatchObject({
      travelMin: 30,
      estimatedLegs: 0,
      stops: [{ arrive: '09:30' }],
    });
    expect(routeOf).not.toHaveBeenCalled();
  });
  it('대중교통과 직접 입력 계획은 v3 공유 문서로 만들어지고 --no-routes에도 시간이 유지된다', async () => {
    const p = parsePlan({ ...plan(), legModes: { 'a>b': 'transit' }, legMinutes: { 'a>b': 30 } });
    const built = build(p);
    const { routeOf } = await prepareRoutes(
      built,
      { fetch: vi.fn(), sleep: async () => {}, skip: true },
      [],
    );
    const { doc } = await buildDoc(
      built,
      routeOf,
      {
        title: p.title,
        includeMemo: false,
        app: 'https://landmark.sch0718.dev',
        now: new Date(built.now),
      },
      p,
    );
    expect(doc.version).toBe(3);
    expect(doc.trips[0]!.legModes).toEqual({
      [`${built.placeIds.get('a')}>${built.placeIds.get('b')}`]: 'transit',
    });
    expect(doc.trips[0]!.days[0]!.legs[0]).toMatchObject({
      mode: 'transit',
      status: 'manual',
      durationS: 1800,
    });
  });
  it('직접 입력이 있어도 모의 가져오기에서 합쳐져 사라질 Stop은 입력 오류로 거절한다', async () => {
    const p = parsePlan({
      ...plan(),
      origin: null,
      places: [
        { key: 'a', name: '같은 핀', lng: 127, lat: 37 },
        { key: 'b', name: '같은 핀', lng: 127, lat: 37.00018 },
      ],
      days: [{ stops: [{ place: 'a' }, { place: 'b' }] }],
      candidates: [],
      legModes: { 'a>b': 'transit' },
      legMinutes: { 'a>b': 30 },
    });
    const built = build(p);
    const { routeOf } = await prepareRoutes(built, { fetch: vi.fn(), sleep: async () => {} }, []);
    await expect(
      buildDoc(
        built,
        routeOf,
        {
          title: p.title,
          includeMemo: false,
          app: 'https://landmark.sch0718.dev',
          now: new Date(built.now),
        },
        p,
      ),
    ).rejects.toMatchObject({
      exit: 2,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'merged-places' })]),
    });
  });
  it.each(['transit', 'minutes', 'both'])(
    '출발점과 유일한 Stop이 합쳐져 구간 설정이 사라지는 공유 문서를 거절한다: %s',
    async (setting) => {
      const p = parsePlan({
        ...plan(),
        places: [
          { key: 'a', name: '같은 핀', lng: 127, lat: 37 },
          { key: 'b', name: '같은 핀', lng: 127, lat: 37.00018 },
        ],
        candidates: [],
        ...(setting !== 'minutes' ? { legModes: { 'a>b': 'transit' } } : {}),
        ...(setting !== 'transit' ? { legMinutes: { 'a>b': 30 } } : {}),
      });
      const built = build(p);
      const { routeOf } = await prepareRoutes(built, { fetch: vi.fn(), sleep: async () => {} }, []);
      await expect(
        buildDoc(
          built,
          routeOf,
          {
            title: p.title,
            includeMemo: false,
            app: 'https://landmark.sch0718.dev',
            now: new Date(built.now),
          },
          p,
        ),
      ).rejects.toMatchObject({
        exit: 2,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'merged-places' })]),
      });
    },
  );
  it('도움말에 대중교통과 분을 쓰는 JSON 예제를 제공한다', () => {
    for (const command of [undefined, 'build', 'send', 'share'] as const) {
      const text = helpText(command);
      expect(text).toContain('대중교통');
      expect(text).toContain('"transit"');
      expect(text).toContain('"legMinutes"');
      expect(text).toContain('1~1440');
    }
  });
});
