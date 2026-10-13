// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { simplifyPath } from 'src/server/simplify';

type P = [number, number];

describe('simplifyPath', () => {
  it('직선 위의 점은 없앤다', () => {
    const line: P[] = [
      [128, 37],
      [128.001, 37.001],
      [128.002, 37.002],
      [128.003, 37.003],
    ];
    expect(simplifyPath(line, 200)).toEqual([
      [128, 37],
      [128.003, 37.003],
    ]);
  });

  it('꺾이는 점은 남긴다', () => {
    const bend: P[] = [
      [128, 37],
      [128.01, 37],
      [128.01, 37.01],
    ];
    expect(simplifyPath(bend, 200)).toEqual(bend);
  });

  it('점이 maxPoints보다 많으면 줄이되 처음·끝 점은 그대로', () => {
    // 지그재그라 허용 오차를 키워 가야 줄어든다.
    const zigzag: P[] = Array.from({ length: 1_000 }, (_, i) => [
      128 + i * 0.0001,
      37 + (i % 2 === 0 ? 0 : 0.0001 * ((i % 7) + 1)),
    ]);
    const out = simplifyPath(zigzag, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]).toEqual(zigzag[0]);
    expect(out.at(-1)).toEqual(zigzag.at(-1));
  });

  it('남은 점은 원래 순서를 지킨다', () => {
    const wave: P[] = Array.from({ length: 500 }, (_, i) => [
      128 + i * 0.0002,
      37 + Math.sin(i / 5) * 0.001,
    ]);
    const out = simplifyPath(wave, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    const lngs = out.map((p) => p[0]);
    expect(lngs).toEqual([...lngs].sort((a, b) => a - b));
  });

  it('maxPoints가 2여도 끝점 둘은 남긴다', () => {
    const out = simplifyPath(
      [
        [128, 37],
        [128.1, 37.1],
        [128.2, 37],
      ],
      2,
    );
    expect(out).toEqual([
      [128, 37],
      [128.2, 37],
    ]);
  });

  it('점이 0·1·2개면 그대로', () => {
    expect(simplifyPath([], 200)).toEqual([]);
    expect(simplifyPath([[128, 37]], 200)).toEqual([[128, 37]]);
    expect(
      simplifyPath(
        [
          [128, 37],
          [128, 37],
        ],
        200,
      ),
    ).toEqual([
      [128, 37],
      [128, 37],
    ]);
  });
});
