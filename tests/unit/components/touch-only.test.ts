import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTouchOnly, TOUCH_ONLY_QUERY } from 'src/components/map/touch-only';

afterEach(() => vi.unstubAllGlobals());

describe('isTouchOnly', () => {
  it.each([
    ['터치 전용', [TOUCH_ONLY_QUERY], true],
    // 주 입력은 터치지만 마우스도 연결되면 `any-hover: none`이 거짓이다.
    ['주 입력이 터치이고 마우스도 연결', ['(hover: none) and (pointer: coarse)'], false],
    ['마우스만', ['(hover: hover) and (pointer: fine)'], false],
  ])('%s → %s', (_, matching, expected) => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: matching.includes(q) }));
    expect(isTouchOnly()).toBe(expected);
  });

  it('matchMedia가 없으면 아니라고 본다', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(isTouchOnly()).toBe(false);
  });

  it('연결된 입력장치 전부를 보는 쿼리를 쓴다', () => {
    expect(TOUCH_ONLY_QUERY).toBe('(any-hover: none) and (any-pointer: coarse)');
  });
});
