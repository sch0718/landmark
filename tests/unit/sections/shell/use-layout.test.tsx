import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLayout, type Layout } from 'src/sections/shell/use-layout';
import { mockViewport } from './harness';

afterEach(() => vi.unstubAllGlobals());

/** 첫 렌더에서 기록한 값을 모은다(효과로 바뀐 뒤의 값이 아니라). */
function firstRenderValues(width: number): Layout[] {
  mockViewport(width);
  const seen: Layout[] = [];
  renderHook(() => {
    const layout = useLayout();
    seen.push(layout);
    return layout;
  });
  return seen;
}

describe('useLayout', () => {
  it('넓은 화면은 첫 렌더부터 wide다', () => {
    expect(firstRenderValues(1440)[0]).toBe('wide');
  });

  it('중간·좁은 화면도 첫 렌더부터 맞다', () => {
    expect(firstRenderValues(800)[0]).toBe('medium');
    expect(firstRenderValues(390)[0]).toBe('compact');
  });

  it('서버 렌더 같은 기본값 경로에서도 실제 크기로 판정한다(noSsr)', () => {
    mockViewport(1440);
    function Probe() {
      return createElement('span', null, useLayout());
    }
    // 서버 스냅샷을 쓰는 렌더. `noSsr`이 없으면 기본값(false)이라 `compact`로 시작한다.
    expect(renderToString(createElement(Probe))).toContain('wide');
  });
});
