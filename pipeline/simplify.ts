const M_PER_DEG = 111_320;

type Pt = [number, number];

/** 위도 기준 등장방형 근사로 점 p와 선분 a-b 사이의 거리(m)를 구한다. */
function distToSegmentM(p: Pt, a: Pt, b: Pt, cosLat: number): number {
  const ax = a[0] * cosLat * M_PER_DEG;
  const ay = a[1] * M_PER_DEG;
  const bx = b[0] * cosLat * M_PER_DEG;
  const by = b[1] * M_PER_DEG;
  const px = p[0] * cosLat * M_PER_DEG;
  const py = p[1] * M_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas-Peucker. 시작·끝점은 항상 유지한다. */
export function simplifyPath(path: Pt[], toleranceM = 5): Pt[] {
  if (path.length <= 2) return path.map((p) => [p[0], p[1]]);
  const cosLat = Math.cos((path[0]![1] * Math.PI) / 180);
  const keep = new Array<boolean>(path.length).fill(false);
  keep[0] = true;
  keep[path.length - 1] = true;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegmentM(path[i]!, path[lo]!, path[hi]!, cosLat);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = true;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return path.filter((_, i) => keep[i]).map((p) => [p[0], p[1]]);
}
