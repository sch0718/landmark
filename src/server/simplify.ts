// 경로선을 Douglas–Peucker로 줄인다. Cloudflare 서버 함수에서도 쓰므로 import 없이 순수 계산만 한다.

type Point = [number, number];

/** 처음 허용 오차(도). 위도 1e-7도는 약 1cm라 사실상 직선 위의 점만 없어진다. */
const START_TOLERANCE = 1e-7;

/** 점 `p`에서 선분 `a`-`b`까지의 거리(도 단위 평면 거리. 경로선을 줄이는 데는 이 정도면 충분하다). */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** 허용 오차 안에 드는 점을 뺀 점들의 위치(원래 순서). 재귀 대신 스택을 써 점이 많아도 안전하다. */
function keptIndexes(points: Point[], tolerance: number): number[] {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  for (let range = stack.pop(); range !== undefined; range = stack.pop()) {
    const [first, last] = range;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const d = distanceToSegment(points[i]!, points[first]!, points[last]!);
      if (d > farthestDistance) {
        farthest = i;
        farthestDistance = d;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  const indexes: number[] = [];
  keep.forEach((flag, i) => {
    if (flag === 1) indexes.push(i);
  });
  return indexes;
}

/**
 * 처음·끝 점을 지키며 점을 `maxPoints`개 이하로 줄인다. 허용 오차를 두 배씩 키워 가며 맞춘다.
 * 직선 위의 점은 개수와 상관없이 없앤다.
 */
export function simplifyPath(points: Point[], maxPoints: number): Point[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const limit = Math.max(2, Math.floor(maxPoints));
  let tolerance = START_TOLERANCE;
  for (;;) {
    const indexes = keptIndexes(points, tolerance);
    // 허용 오차가 충분히 크면 끝점 둘만 남으니 반드시 끝난다.
    if (indexes.length <= limit || indexes.length === 2) {
      return indexes.map((i) => [points[i]![0], points[i]![1]]);
    }
    tolerance *= 2;
  }
}
