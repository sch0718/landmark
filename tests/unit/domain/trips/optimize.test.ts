import { describe, expect, it } from 'vitest';
import { haversineM, type LngLat } from 'src/domain/trips/geo';
import { autoSplit, optimizeOrder, type OptStop } from 'src/domain/trips/optimize';

// 시드 고정 의사 난수(mulberry32). 같은 시드 → 같은 수열이라 실패를 재현할 수 있다.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 강원 범위 좌표.
const gangwon = (rnd: () => number): LngLat => [127.1 + rnd() * 2.3, 37.0 + rnd() * 1.6];

const TIMES = ['09:00', '10:00', '10:00', '13:00', '15:30'];

function randomStops(rnd: () => number, n: number, fixedRate: number, prefix = 's'): OptStop[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    at: gangwon(rnd),
    fixedTime: rnd() < fixedRate ? TIMES[Math.floor(rnd() * TIMES.length)]! : null,
  }));
}

type Input = { start: LngLat | null; end: LngLat | null; stops: OptStop[] };

/** 테스트 쪽 총 거리 계산(구현과 독립). */
function lengthOf(input: Input, order: string[]): number {
  const byId = new Map(input.stops.map((s) => [s.id, s.at]));
  const pts: LngLat[] = [];
  if (input.start) pts.push(input.start);
  for (const id of order) pts.push(byId.get(id)!);
  if (input.end) pts.push(input.end);
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += haversineM(pts[i - 1]!, pts[i]!);
  return sum;
}

const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** a가 b보다 먼저 와야 하는가: 둘 다 고정 시각이고 a가 이르거나, 같은 시각이면 입력(지금) 순서가 앞. */
function mustPrecede(input: Input, a: string, b: string): boolean {
  const ia = input.stops.findIndex((s) => s.id === a);
  const ib = input.stops.findIndex((s) => s.id === b);
  const fa = input.stops[ia]!.fixedTime;
  const fb = input.stops[ib]!.fixedTime;
  if (fa === null || fb === null || a === b) return false;
  return toMin(fa) < toMin(fb) || (toMin(fa) === toMin(fb) && ia < ib);
}

/** 쌍 단위 제약 검사(구현과 독립). */
function respectsFixed(input: Input, order: string[]): boolean {
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      if (mustPrecede(input, order[j]!, order[i]!)) return false;
    }
  }
  return true;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)]))
      out.push([x, ...rest]);
  });
  return out;
}

/** 테스트 쪽 nearest neighbor(제약 지킴). 출발점이 없으면 가능한 모든 첫 장소 중 가장 짧은 것. */
function nearestNeighbourLength(input: Input): number {
  const ids = input.stops.map((s) => s.id);
  const run = (first: string | null): string[] | null => {
    const left = new Set(ids);
    const order: string[] = [];
    let at: LngLat | null = input.start;
    if (first !== null) {
      order.push(first);
      left.delete(first);
      at = input.stops.find((s) => s.id === first)!.at;
    }
    while (left.size > 0) {
      let best: string | null = null;
      let bestD = Infinity;
      for (const id of ids) {
        if (!left.has(id)) continue;
        if ([...left].some((other) => mustPrecede(input, other, id))) continue;
        const d = at ? haversineM(at, input.stops.find((s) => s.id === id)!.at) : 0;
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best === null) return null;
      order.push(best);
      left.delete(best);
      at = input.stops.find((s) => s.id === best)!.at;
    }
    return order;
  };
  if (input.start) return lengthOf(input, run(null)!);
  let min = Infinity;
  for (const id of ids) {
    const o = run(id);
    if (o && respectsFixed(input, o)) min = Math.min(min, lengthOf(input, o));
  }
  return min;
}

const sorted = (xs: string[]): string[] => [...xs].sort();

describe('optimizeOrder — Held–Karp(12곳 이하)', () => {
  it('무작위 7곳 이하 50회: 모든 순열 중 제약을 지키는 최단과 같은 길이(바꾸지 않으면 1% 규칙)', () => {
    const rnd = prng(20261012);
    for (let run = 0; run < 50; run++) {
      const n = 1 + Math.floor(rnd() * 7);
      const input: Input = {
        start: rnd() < 0.5 ? gangwon(rnd) : null,
        end: rnd() < 0.5 ? gangwon(rnd) : null,
        stops: randomStops(rnd, n, 0.35),
      };
      const ids = input.stops.map((s) => s.id);
      let min = Infinity;
      for (const p of permutations(ids)) {
        if (respectsFixed(input, p)) min = Math.min(min, lengthOf(input, p));
      }
      const currentOk = respectsFixed(input, ids);
      const current = lengthOf(input, ids);
      const res = optimizeOrder(input);

      expect(sorted(res.order)).toEqual(sorted(ids));
      expect(respectsFixed(input, res.order)).toBe(true);
      if (res.changed) {
        expect(lengthOf(input, res.order)).toBeCloseTo(min, 3);
        if (currentOk) expect(min).toBeLessThanOrEqual(current * 0.99 + 1e-6);
      } else {
        expect(currentOk).toBe(true);
        expect(res.order).toEqual(ids);
        expect(min).toBeGreaterThan(current * 0.99 - 1e-6);
      }
    }
  });

  it('리뷰 반례: 출발·도착 없음, 지금 순서가 고정 시각을 어기면 거리가 같아도 바꾼다', () => {
    const res = optimizeOrder({
      start: null,
      end: null,
      stops: [
        { id: 'A', at: [128.8961, 37.7953], fixedTime: '10:00' },
        { id: 'B', at: [128.9, 37.79], fixedTime: '09:00' },
      ],
    });
    expect(res).toEqual({ order: ['B', 'A'], changed: true });
  });

  it('고정 시각이 지금 첫 장소보다 이른 장소가 뒤에 있으면 앞으로 온다', () => {
    const input: Input = {
      start: [128.9, 37.79],
      end: null,
      stops: [
        { id: 'X', at: [128.91, 37.79], fixedTime: '12:00' },
        { id: 'Y', at: [128.92, 37.79], fixedTime: null },
        { id: 'Z', at: [128.93, 37.79], fixedTime: '09:00' },
      ],
    };
    const res = optimizeOrder(input);
    expect(res.changed).toBe(true);
    expect(res.order.indexOf('Z')).toBeLessThan(res.order.indexOf('X'));
  });

  it('같은 시각의 고정 장소는 지금 순서를 지킨다(어긴 것으로 보지 않는다)', () => {
    const input: Input = {
      start: [128.9, 37.79],
      end: null,
      stops: [
        { id: 'far', at: [129.0, 37.79], fixedTime: '10:00' },
        { id: 'near', at: [128.91, 37.79], fixedTime: '10:00' },
      ],
    };
    // 거리로는 near가 먼저가 짧지만 같은 시각이면 지금 순서(far → near)를 지킨다.
    expect(optimizeOrder(input)).toEqual({ order: ['far', 'near'], changed: false });
  });

  it('출발·도착은 고정되고 장소만 움직인다', () => {
    const input: Input = {
      start: [128.0, 37.5],
      end: [129.0, 37.5],
      stops: [
        { id: 'c', at: [128.75, 37.5], fixedTime: null },
        { id: 'a', at: [128.25, 37.5], fixedTime: null },
        { id: 'b', at: [128.5, 37.5], fixedTime: null },
      ],
    };
    expect(optimizeOrder(input)).toEqual({ order: ['a', 'b', 'c'], changed: true });
    // 출발·도착을 뒤집으면 순서도 뒤집힌다.
    expect(optimizeOrder({ ...input, start: input.end, end: input.start }).order).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('출발이 없으면 시작이 자유: 도착 쪽에서 먼 끝부터 시작한다', () => {
    const input: Input = {
      start: null,
      end: [129.0, 37.5],
      stops: [
        { id: 'b', at: [128.5, 37.5], fixedTime: null },
        { id: 'a', at: [128.25, 37.5], fixedTime: null },
        { id: 'c', at: [128.75, 37.5], fixedTime: null },
      ],
    };
    expect(optimizeOrder(input)).toEqual({ order: ['a', 'b', 'c'], changed: true });
  });

  it('1% 미만 개선이면 바꾸지 않고, 1% 이상이면 바꾼다', () => {
    const start: LngLat = [128.9, 37.79];
    const small = optimizeOrder({
      start,
      end: null,
      stops: [
        { id: 'B', at: [128.91005, 37.79], fixedTime: null },
        { id: 'A', at: [128.91, 37.79], fixedTime: null },
      ],
    });
    expect(small).toEqual({ order: ['B', 'A'], changed: false });
    const big = optimizeOrder({
      start,
      end: null,
      stops: [
        { id: 'B', at: [128.92, 37.79], fixedTime: null },
        { id: 'A', at: [128.91, 37.79], fixedTime: null },
      ],
    });
    expect(big).toEqual({ order: ['A', 'B'], changed: true });
  });

  it('같은 좌표 두 곳(같은 건물)에서도 NaN 없이 정리한다', () => {
    const same: LngLat = [128.8961, 37.7953];
    const input: Input = {
      start: null,
      end: null,
      stops: [
        { id: 'cafe', at: same, fixedTime: null },
        { id: 'far', at: [129.0, 37.9], fixedTime: null },
        { id: 'food', at: [same[0], same[1]], fixedTime: null },
      ],
    };
    const res = optimizeOrder(input);
    expect(sorted(res.order)).toEqual(['cafe', 'far', 'food']);
    expect(Number.isFinite(lengthOf(input, res.order))).toBe(true);
    // 같은 건물 두 곳은 붙어 있어야 최단.
    const i = res.order.indexOf('cafe');
    const j = res.order.indexOf('food');
    expect(Math.abs(i - j)).toBe(1);
    // 모두 같은 좌표면 거리 0 → 바꾸지 않는다.
    expect(
      optimizeOrder({
        start: same,
        end: same,
        stops: [
          { id: 'p', at: same, fixedTime: null },
          { id: 'q', at: same, fixedTime: null },
        ],
      }),
    ).toEqual({ order: ['p', 'q'], changed: false });
  });

  it('장소 0곳·1곳은 그대로', () => {
    expect(optimizeOrder({ start: null, end: null, stops: [] })).toEqual({
      order: [],
      changed: false,
    });
    expect(
      optimizeOrder({
        start: [128, 37],
        end: null,
        stops: [{ id: 'a', at: [128.1, 37], fixedTime: null }],
      }),
    ).toEqual({ order: ['a'], changed: false });
  });

  it('12곳·출발 없음도 빠르게 정확히 푼다', () => {
    const rnd = prng(12);
    const input: Input = { start: null, end: null, stops: randomStops(rnd, 12, 0.25) };
    const t0 = performance.now();
    const res = optimizeOrder(input);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(sorted(res.order)).toEqual(sorted(input.stops.map((s) => s.id)));
    expect(respectsFixed(input, res.order)).toBe(true);
    expect(lengthOf(input, res.order)).toBeLessThanOrEqual(nearestNeighbourLength(input) + 1e-6);
  });
});

describe('optimizeOrder — 근사(13곳 이상)', () => {
  for (const n of [13, 20]) {
    for (const withStart of [true, false]) {
      it(`${n}곳(출발 ${withStart ? '있음' : '없음'}): 제약을 지키고 nearest neighbor보다 길지 않다`, () => {
        const rnd = prng(n * 7 + (withStart ? 1 : 0));
        const input: Input = {
          start: withStart ? gangwon(rnd) : null,
          end: rnd() < 0.5 ? gangwon(rnd) : null,
          stops: randomStops(rnd, n, 0.3),
        };
        const t0 = performance.now();
        const res = optimizeOrder(input);
        // 느린 CI에서도 흔들리지 않게 넉넉히 둔다(실제로는 수 ms).
        expect(performance.now() - t0).toBeLessThan(1000);
        expect(sorted(res.order)).toEqual(sorted(input.stops.map((s) => s.id)));
        expect(respectsFixed(input, res.order)).toBe(true);
        const len = lengthOf(input, res.changed ? res.order : input.stops.map((s) => s.id));
        expect(Number.isFinite(len)).toBe(true);
        // 무작위 지금 순서는 매우 길어서 늘 바뀐다.
        expect(res.changed).toBe(true);
        expect(len).toBeLessThanOrEqual(nearestNeighbourLength(input) + 1e-6);
      });
    }
  }

  it('20곳 근사에서 지금 순서가 제약을 어기면 늘 바꾼다', () => {
    const rnd = prng(99);
    const stops = randomStops(rnd, 20, 0);
    stops[0] = { ...stops[0]!, fixedTime: '15:00' };
    stops[19] = { ...stops[19]!, fixedTime: '08:00' };
    const input: Input = { start: null, end: null, stops };
    const res = optimizeOrder(input);
    expect(res.changed).toBe(true);
    expect(respectsFixed(input, res.order)).toBe(true);
  });
});

// 자동 나누기 ------------------------------------------------------------

type Day = { start: LngLat | null; end: LngLat | null; stops: OptStop[] };
const emptyDay = (anchor: LngLat | null = null): Day => ({ start: null, end: anchor, stops: [] });
const stop = (id: string, at: LngLat): OptStop => ({ id, at, fixedTime: null });

function newCounts(days: Day[], result: string[][]): number[] {
  return result.map((ids, d) => ids.length - days[d]!.stops.length);
}

describe('autoSplit', () => {
  it('리뷰 반례: 후보 10곳이 Day 1 기준점 근처에 몰려도 [4, 3, 3]', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      at: [128.8961 + i * 0.0001, 37.7953] as LngLat,
    }));
    const days = [
      emptyDay([128.8961, 37.7953]),
      emptyDay([129.1, 37.7953]),
      emptyDay([129.4, 37.7953]),
    ];
    const res = autoSplit({ candidates, days });
    expect(newCounts(days, res)).toEqual([4, 3, 3]);
    // 기준점에 가장 가까운 4곳이 Day 1로.
    expect(sorted(res[0]!)).toEqual(['c0', 'c1', 'c2', 'c3']);
  });

  it('무작위 입력 30회: 모든 후보가 한 번씩 배정되고 이미 넣은 장소는 제자리, 넘친 Day 없으면 균형', () => {
    const rnd = prng(5);
    for (let run = 0; run < 30; run++) {
      const nDays = 1 + Math.floor(rnd() * 5);
      const days: Day[] = Array.from({ length: nDays }, (_, d) => ({
        start: rnd() < 0.4 ? gangwon(rnd) : null,
        end: rnd() < 0.4 ? gangwon(rnd) : null,
        stops: randomStops(rnd, Math.floor(rnd() * 5), 0.2, `d${d}s`),
      }));
      const candidates = Array.from({ length: Math.floor(rnd() * 16) }, (_, i) => ({
        id: `c${i}`,
        at: gangwon(rnd),
      }));
      const res = autoSplit({ candidates, days });
      expect(res).toHaveLength(nDays);
      const all = res.flat();
      expect(new Set(all).size).toBe(all.length);
      const candIds = new Set(candidates.map((c) => c.id));
      expect(all.filter((id) => candIds.has(id)).sort()).toEqual(sorted([...candIds]));
      res.forEach((ids, d) => {
        for (const s of days[d]!.stops) expect(ids).toContain(s.id);
      });
      const existing = days.map((d) => d.stops.length);
      const T = candidates.length + existing.reduce((a, b) => a + b, 0);
      if (existing.every((e) => e <= Math.floor(T / nDays))) {
        const totals = res.map((ids) => ids.length);
        expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('이미 목표를 넘은 Day: Day 1에 6곳, 후보 3, Day 3개 → Day 1 용량 0, 나머지 [2, 1]', () => {
    const base: LngLat = [128.9, 37.79];
    const days: Day[] = [
      {
        start: null,
        end: null,
        stops: Array.from({ length: 6 }, (_, i) => stop(`e${i}`, [base[0] + i * 0.01, base[1]])),
      },
      emptyDay([129.2, 37.79]),
      emptyDay([129.3, 37.79]),
    ];
    // 후보는 Day 1 장소들 바로 옆에 있어도 Day 1로 가지 않는다.
    const candidates = [0, 1, 2].map((i) => ({
      id: `c${i}`,
      at: [base[0] + i * 0.001, base[1]] as LngLat,
    }));
    const res = autoSplit({ candidates, days });
    expect(newCounts(days, res)).toEqual([0, 2, 1]);
  });

  it('숙소 기준점에 가까운 후보가 그 Day로 간다', () => {
    const origin: LngLat = [127.5, 37.5];
    const lodging: LngLat = [128.9, 37.75];
    const days: Day[] = [
      { start: origin, end: lodging, stops: [] },
      { start: lodging, end: null, stops: [] },
    ];
    const candidates = [
      { id: 'nearOrigin1', at: [127.51, 37.5] as LngLat },
      { id: 'nearLodging1', at: [128.91, 37.75] as LngLat },
      { id: 'nearOrigin2', at: [127.52, 37.51] as LngLat },
      { id: 'nearLodging2', at: [128.9, 37.76] as LngLat },
    ];
    const res = autoSplit({ candidates, days });
    expect(sorted(res[0]!)).toEqual(['nearOrigin1', 'nearOrigin2']);
    expect(sorted(res[1]!)).toEqual(['nearLodging1', 'nearLodging2']);
  });

  it('기준점 없는 Day들은 k-means로 후보 무리를 나눠 갖는다', () => {
    const west = Array.from({ length: 4 }, (_, i) => ({
      id: `w${i}`,
      at: [127.5 + i * 0.002, 37.5] as LngLat,
    }));
    const east = Array.from({ length: 4 }, (_, i) => ({
      id: `e${i}`,
      at: [129.0 + i * 0.002, 37.8] as LngLat,
    }));
    const candidates = [
      west[0]!,
      east[0]!,
      west[1]!,
      east[1]!,
      west[2]!,
      east[2]!,
      west[3]!,
      east[3]!,
    ];
    const days: Day[] = [emptyDay(), emptyDay()];
    const res = autoSplit({ candidates, days });
    const groups = res.map((ids) => sorted(ids));
    // 첫 중심은 id 사전순 첫째(e0)이므로 동쪽 무리가 Day 1.
    expect(groups).toEqual([
      ['e0', 'e1', 'e2', 'e3'],
      ['w0', 'w1', 'w2', 'w3'],
    ]);
  });

  it('기준점 있는 Day와 없는 Day가 섞여도 모두 배정된다', () => {
    const rnd = prng(77);
    const candidates = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, at: gangwon(rnd) }));
    const days: Day[] = [emptyDay([128.9, 37.79]), emptyDay(), emptyDay()];
    const res = autoSplit({ candidates, days });
    expect(newCounts(days, res)).toEqual([3, 3, 3]);
  });

  it('기준점 없는 Day가 후보보다 많아도 모두 배정된다', () => {
    const days: Day[] = [emptyDay(), emptyDay(), emptyDay()];
    const candidates = [{ id: 'only', at: [128.9, 37.79] as LngLat }];
    expect(autoSplit({ candidates, days })).toEqual([['only'], [], []]);
  });

  it('같은 입력 두 번 → 같은 결과', () => {
    const rnd = prng(31);
    const candidates = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, at: gangwon(rnd) }));
    const days: Day[] = [
      { start: gangwon(rnd), end: gangwon(rnd), stops: randomStops(rnd, 2, 0.5, 'a') },
      emptyDay(),
      { start: null, end: gangwon(rnd), stops: [] },
      emptyDay(),
    ];
    const a = autoSplit({ candidates, days });
    const b = autoSplit({ candidates, days });
    expect(a).toEqual(b);
  });

  it('후보 0곳 → 지금 순서 그대로', () => {
    const days: Day[] = [
      {
        start: null,
        end: null,
        stops: [stop('b', [129.0, 37.8]), stop('a', [128.0, 37.5]), stop('c', [129.1, 37.9])],
      },
      emptyDay([128.9, 37.79]),
    ];
    expect(autoSplit({ candidates: [], days })).toEqual([['b', 'a', 'c'], []]);
  });

  it('배정 뒤 Day마다 순서 정리를 적용한다', () => {
    const days: Day[] = [{ start: [128.0, 37.5], end: null, stops: [stop('x3', [128.3, 37.5])] }];
    const candidates = [
      { id: 'x2', at: [128.2, 37.5] as LngLat },
      { id: 'x1', at: [128.1, 37.5] as LngLat },
    ];
    expect(autoSplit({ candidates, days })).toEqual([['x1', 'x2', 'x3']]);
  });
});
