import { haversineM, type LngLat } from 'src/domain/trips/geo';

// 순서 정리와 Day 자동 나누기(스펙 §5). 거리는 모두 직선거리(하버사인)이고, 입력을 바꾸지 않는 순수 함수다.
// 같은 입력 → 같은 결과: 난수를 쓰지 않고, 동률은 늘 인덱스·id 순으로 정한다.

export type OptStop = { id: string; at: LngLat; fixedTime: string | null };

type OrderInput = { start: LngLat | null; end: LngLat | null; stops: OptStop[] };

/** 움직일 장소가 이 수 이하면 Held–Karp로 정확히 푼다. 넘으면 nearest neighbor + 2-opt. */
const EXACT_MAX = 12;
/** 제약을 어기지 않는 지금 순서는 새 총 거리가 이 비율 이하(1% 이상 짧음)일 때만 바꾼다. */
const CHANGE_RATIO = 0.99;
const KMEANS_MAX_ITER = 50;
/** 2-opt 개선 판정의 부동소수 여유(m). */
const EPS_M = 1e-9;

const compareId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function toMinutes(t: string | null): number | null {
  if (t === null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  // 형식이 틀린 시각은 스키마가 막지만, 여기서는 제약 없음으로 본다.
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 장소마다 고정 시각 순번(없으면 -1). 시각 오름차순, 같은 시각은 지금 순서. */
function fixedRanks(stops: OptStop[]): number[] {
  const fixed: { i: number; min: number }[] = [];
  stops.forEach((s, i) => {
    const min = toMinutes(s.fixedTime);
    if (min !== null) fixed.push({ i, min });
  });
  fixed.sort((a, b) => a.min - b.min || a.i - b.i);
  const ranks = stops.map(() => -1);
  fixed.forEach((f, r) => {
    ranks[f.i] = r;
  });
  return ranks;
}

/** 순서 안의 고정 시각 장소가 순번 0, 1, 2… 그대로 나오는가. */
function respects(order: number[], ranks: number[]): boolean {
  let next = 0;
  for (const i of order) {
    const r = ranks[i]!;
    if (r < 0) continue;
    if (r !== next) return false;
    next++;
  }
  return true;
}

/** 장소 사이·출발점에서·도착점까지의 거리표. 출발점·도착점이 없으면 그 쪽은 0(자유). */
type Metric = { n: number; between: Float64Array; fromStart: Float64Array; toEnd: Float64Array };

function metricOf(input: OrderInput): Metric {
  const n = input.stops.length;
  const between = new Float64Array(n * n);
  const fromStart = new Float64Array(n);
  const toEnd = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = input.stops[i]!.at;
    if (input.start) fromStart[i] = haversineM(input.start, a);
    if (input.end) toEnd[i] = haversineM(a, input.end);
    for (let j = i + 1; j < n; j++) {
      const d = haversineM(a, input.stops[j]!.at);
      between[i * n + j] = d;
      between[j * n + i] = d;
    }
  }
  return { n, between, fromStart, toEnd };
}

function lengthOf(m: Metric, order: number[]): number {
  if (order.length === 0) return 0;
  let sum = m.fromStart[order[0]!]! + m.toEnd[order[order.length - 1]!]!;
  for (let k = 1; k < order.length; k++) sum += m.between[order[k - 1]! * m.n + order[k]!]!;
  return sum;
}

function popcount(x: number): number {
  let c = 0;
  for (let v = x; v !== 0; v &= v - 1) c++;
  return c;
}

/**
 * Held–Karp(비트 DP). 상태 (방문 집합, 마지막 장소)의 최단 거리. 고정 시각 장소는 순번이
 * "지금까지 방문한 고정 장소 수"와 같을 때만 더할 수 있어 제약을 어기는 상태는 만들지 않는다.
 * 출발점이 없으면 순번 0 이하인 모든 장소가 시작 후보다(시작 자유).
 */
function heldKarp(m: Metric, ranks: number[]): number[] {
  const { n } = m;
  const full = (1 << n) - 1;
  const dp = new Float64Array((full + 1) * n).fill(Infinity);
  const parent = new Int8Array((full + 1) * n).fill(-1);
  let fixedMask = 0;
  ranks.forEach((r, i) => {
    if (r >= 0) fixedMask |= 1 << i;
  });
  for (let j = 0; j < n; j++) {
    if (ranks[j]! <= 0) dp[(1 << j) * n + j] = m.fromStart[j]!;
  }
  for (let mask = 1; mask <= full; mask++) {
    const fixedDone = popcount(mask & fixedMask);
    for (let last = 0; last < n; last++) {
      if ((mask & (1 << last)) === 0) continue;
      const cur = dp[mask * n + last]!;
      if (cur === Infinity) continue;
      for (let next = 0; next < n; next++) {
        const bit = 1 << next;
        if ((mask & bit) !== 0) continue;
        const r = ranks[next]!;
        if (r >= 0 && r !== fixedDone) continue;
        const idx = (mask | bit) * n + next;
        const v = cur + m.between[last * n + next]!;
        if (v < dp[idx]!) {
          dp[idx] = v;
          parent[idx] = last;
        }
      }
    }
  }
  let bestLast = 0;
  let best = Infinity;
  for (let last = 0; last < n; last++) {
    const v = dp[full * n + last]! + m.toEnd[last]!;
    if (v < best) {
      best = v;
      bestLast = last;
    }
  }
  const order: number[] = [];
  let mask = full;
  let last = bestLast;
  while (last >= 0) {
    order.push(last);
    const prev = parent[mask * n + last]!;
    mask &= ~(1 << last);
    last = prev;
  }
  return order.reverse();
}

/** 제약을 지키는 nearest neighbor. first가 있으면 그 장소에서, 없으면 출발점에서 시작한다. */
function nearestNeighbour(m: Metric, ranks: number[], first: number | null): number[] {
  const { n } = m;
  const visited = new Uint8Array(n);
  const order: number[] = [];
  let fixedDone = 0;
  const visit = (i: number) => {
    visited[i] = 1;
    order.push(i);
    if (ranks[i]! >= 0) fixedDone++;
  };
  if (first !== null) visit(first);
  while (order.length < n) {
    const at = order.length > 0 ? order[order.length - 1]! : null;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      const r = ranks[j]!;
      if (r >= 0 && r !== fixedDone) continue;
      const d = at === null ? m.fromStart[j]! : m.between[at * n + j]!;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    visit(best);
  }
  return order;
}

/** 2-opt: 구간 [i..j]를 뒤집어 짧아지면 받아들인다. 고정 장소가 2곳 이상인 구간은 뒤집으면 제약을 어기므로 건너뛴다. */
function twoOpt(m: Metric, ranks: number[], initial: number[]): number[] {
  const { n } = m;
  const order = initial.slice();
  // 이웃 거리. 출발점·도착점은 null로 나타내고, 없으면 0(자유).
  const leg = (a: number | null, b: number | null): number =>
    a === null ? m.fromStart[b!]! : b === null ? m.toEnd[a]! : m.between[a * n + b]!;
  let improved = true;
  // 매 회 엄격히 짧아지므로 끝나지만, 만일을 대비해 회수를 묶는다.
  for (let pass = 0; improved && pass < 1000; pass++) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      let fixedIn = ranks[order[i]!]! >= 0 ? 1 : 0;
      for (let j = i + 1; j < n; j++) {
        if (ranks[order[j]!]! >= 0) fixedIn++;
        if (fixedIn >= 2) break;
        const p = i > 0 ? order[i - 1]! : null;
        const q = j < n - 1 ? order[j + 1]! : null;
        const before = leg(p, order[i]!) + leg(order[j]!, q);
        const after = leg(p, order[j]!) + leg(order[i]!, q);
        if (after < before - EPS_M) {
          for (let a = i, b = j; a < b; a++, b--) {
            const t = order[a]!;
            order[a] = order[b]!;
            order[b] = t;
          }
          improved = true;
        }
      }
    }
  }
  return order;
}

/** 13곳 이상: nearest neighbor(출발점이 없으면 가능한 모든 첫 장소 중 최단) → 2-opt. 지금 순서가 제약을 지키면 그것도 2-opt해 짧은 쪽. */
function approximate(
  m: Metric,
  ranks: number[],
  current: number[] | null,
  hasStart: boolean,
): number[] {
  let seed: number[] = [];
  let seedLen = Infinity;
  const firsts = hasStart ? [null] : ranks.flatMap((r, i) => (r <= 0 ? [i] : []));
  for (const first of firsts) {
    const tour = nearestNeighbour(m, ranks, first);
    const len = lengthOf(m, tour);
    if (len < seedLen) {
      seedLen = len;
      seed = tour;
    }
  }
  const best = twoOpt(m, ranks, seed);
  if (current === null) return best;
  const alt = twoOpt(m, ranks, current);
  return lengthOf(m, alt) < lengthOf(m, best) ? alt : best;
}

/**
 * 순서 정리(스펙 §5.1). 지금 순서가 고정 시각 순서를 어기면 늘 제약을 지키는 최단 순서로 바꾸고,
 * 어기지 않으면 새 총 거리가 지금 × 0.99 이하일 때만 바꾼다. 바꾸지 않으면 `order`는 지금 순서다.
 */
export function optimizeOrder(input: OrderInput): { order: string[]; changed: boolean } {
  const ids = input.stops.map((s) => s.id);
  const n = ids.length;
  if (n <= 1) return { order: ids, changed: false };
  const ranks = fixedRanks(input.stops);
  const m = metricOf(input);
  const current = ids.map((_, i) => i);
  const valid = respects(current, ranks);
  const best =
    n <= EXACT_MAX
      ? heldKarp(m, ranks)
      : approximate(m, ranks, valid ? current : null, input.start !== null);
  const toIds = (order: number[]) => order.map((i) => ids[i]!);
  if (!valid) return { order: toIds(best), changed: true };
  const bestLen = lengthOf(m, best);
  const curLen = lengthOf(m, current);
  // 거리 0끼리(모두 같은 좌표)처럼 줄지 않았으면 바꾸지 않는다.
  if (bestLen < curLen && bestLen <= curLen * CHANGE_RATIO)
    return { order: toIds(best), changed: true };
  return { order: ids, changed: false };
}

// 자동 나누기 ------------------------------------------------------------

type DayInput = { start: LngLat | null; end: LngLat | null; stops: OptStop[] };
type Candidate = { id: string; at: LngLat };

function mean(points: LngLat[]): LngLat | null {
  if (points.length === 0) return null;
  let lng = 0;
  let lat = 0;
  for (const p of points) {
    lng += p[0];
    lat += p[1];
  }
  return [lng / points.length, lat / points.length];
}

/**
 * Day별 용량. 목표 t_d = floor(T/N), 나머지는 이미 넣은 장소가 적은 Day부터(같으면 앞 Day) +1.
 * c_d = max(0, t_d − 이미 넣은 수). 합이 후보 수보다 크면 큰 용량부터(같으면 뒤 Day) 1씩 줄인다.
 */
function capacities(candidateCount: number, existing: number[]): number[] {
  const n = existing.length;
  const total = candidateCount + existing.reduce((a, b) => a + b, 0);
  const targets = existing.map(() => Math.floor(total / n));
  const fewestFirst = existing.map((e, i) => ({ e, i })).sort((a, b) => a.e - b.e || a.i - b.i);
  for (let k = 0; k < total % n; k++) targets[fewestFirst[k]!.i]! += 1;
  const caps = targets.map((t, i) => Math.max(0, t - existing[i]!));
  // Σ max(0, t−e) ≥ Σ(t−e) = 후보 수이므로 줄이기만 하면 된다.
  let excess = caps.reduce((a, b) => a + b, 0) - candidateCount;
  while (excess > 0) {
    let k = 0;
    for (let d = 1; d < n; d++) if (caps[d]! >= caps[k]!) k = d;
    caps[k]! -= 1;
    excess--;
  }
  return caps;
}

/**
 * k-means++ 초기화(결정적: 첫 중심 = id 사전순 첫째, 다음은 가까운 중심까지 가장 먼 점, 동률은 id 순)
 * → k-means(최대 50회). 점보다 많은 중심은 만들지 않는다.
 */
function kMeans(points: Candidate[], k: number): LngLat[] {
  const byId = [...points].sort((a, b) => compareId(a.id, b.id));
  const count = Math.min(k, byId.length);
  if (count === 0) return [];
  const centers: LngLat[] = [byId[0]!.at];
  const chosen = new Set<number>([0]);
  while (centers.length < count) {
    let pick = -1;
    let far = -1;
    byId.forEach((p, i) => {
      if (chosen.has(i)) return;
      const d = Math.min(...centers.map((c) => haversineM(p.at, c)));
      if (d > far) {
        far = d;
        pick = i;
      }
    });
    chosen.add(pick);
    centers.push(byId[pick]!.at);
  }
  let assign: number[] = [];
  for (let iter = 0; iter < KMEANS_MAX_ITER; iter++) {
    const next = byId.map((p) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, ci) => {
        const d = haversineM(p.at, c);
        if (d < bestD) {
          bestD = d;
          best = ci;
        }
      });
      return best;
    });
    if (next.every((c, i) => c === assign[i])) break;
    assign = next;
    for (let ci = 0; ci < centers.length; ci++) {
      // 빈 무리는 중심을 그대로 둔다.
      const m = mean(byId.filter((_, i) => assign[i] === ci).map((p) => p.at));
      if (m) centers[ci] = m;
    }
  }
  return centers;
}

/**
 * Day 자동 나누기(스펙 §5.2). 후보를 Day 기준점까지 거리순으로 용량만큼 배정하고,
 * 배정된 후보를 그 Day 끝에 붙인 뒤 Day마다 순서 정리(§5.1)를 적용한 Day별 새 전체 순서를 돌려준다.
 */
export function autoSplit(input: { candidates: Candidate[]; days: DayInput[] }): string[][] {
  const { candidates, days } = input;
  if (candidates.length === 0 || days.length === 0)
    return days.map((d) => d.stops.map((s) => s.id));

  const caps = capacities(
    candidates.length,
    days.map((d) => d.stops.length),
  );

  // 기준점: 출발점·도착점·이미 넣은 장소의 평균. 하나도 없는 Day는 후보 k-means 중심을 Day 순서대로 받는다.
  const anchors: (LngLat | null)[] = days.map((d) =>
    mean([d.start, d.end, ...d.stops.map((s) => s.at)].filter((p): p is LngLat => p !== null)),
  );
  const free = anchors.flatMap((a, d) => (a === null ? [d] : []));
  if (free.length > 0) {
    const centers = kMeans(candidates, free.length);
    free.forEach((d, k) => {
      anchors[d] = centers[k] ?? null;
    });
  }

  // 모든 (후보, Day) 쌍을 거리순(같으면 후보 id, Day 순)으로 보며 남은 용량에 배정한다.
  // 기준점을 끝내 못 받은 Day(후보보다 많은 빈 Day)는 거리 무한대로 맨 뒤에 둔다.
  const pairs: { c: number; d: number; dist: number }[] = [];
  candidates.forEach((cand, c) => {
    anchors.forEach((a, d) => {
      pairs.push({ c, d, dist: a ? haversineM(cand.at, a) : Infinity });
    });
  });
  pairs.sort(
    (x, y) =>
      (x.dist < y.dist ? -1 : x.dist > y.dist ? 1 : 0) ||
      compareId(candidates[x.c]!.id, candidates[y.c]!.id) ||
      x.d - y.d,
  );
  const dayOf = candidates.map(() => -1);
  const left = caps.slice();
  for (const { c, d } of pairs) {
    if (dayOf[c] !== -1 || left[d]! <= 0) continue;
    dayOf[c] = d;
    left[d]! -= 1;
  }

  return days.map((day, d) => {
    const added: OptStop[] = candidates
      .filter((_, c) => dayOf[c] === d)
      .map((cand) => ({ id: cand.id, at: cand.at, fixedTime: null }));
    return optimizeOrder({ start: day.start, end: day.end, stops: [...day.stops, ...added] }).order;
  });
}
