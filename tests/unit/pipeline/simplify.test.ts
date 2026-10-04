import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { simplifyPath } from '../../../pipeline/simplify';

describe('simplifyPath', () => {
  it('route-ok.json 경로를 줄이되 시작·끝점은 유지한다', () => {
    const body = JSON.parse(readFileSync('tests/fixtures/naver/route-ok.json', 'utf-8')) as {
      route: Record<string, { path: [number, number][] }[]>;
    };
    const key = Object.keys(body.route)[0]!;
    const path = body.route[key]![0]!.path;
    const out = simplifyPath(path);
    expect(out.length).toBeLessThan(path.length);
    expect(out[0]).toEqual(path[0]);
    expect(out[out.length - 1]).toEqual(path[path.length - 1]);
  });

  it('일직선 위의 점은 제거하고 꺾이는 점은 남긴다', () => {
    const out = simplifyPath([
      [128, 38],
      [128.001, 38],
      [128.002, 38],
      [128.002, 38.01],
    ]);
    expect(out).toEqual([
      [128, 38],
      [128.002, 38],
      [128.002, 38.01],
    ]);
  });

  it('점이 2개 이하면 그대로 돌려준다', () => {
    expect(simplifyPath([])).toEqual([]);
    expect(simplifyPath([[128, 38]])).toEqual([[128, 38]]);
    expect(
      simplifyPath([
        [128, 38],
        [129, 38],
      ]),
    ).toEqual([
      [128, 38],
      [129, 38],
    ]);
  });
});
