import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { App } from 'src/app';

describe('smoke', () => {
  it('렌더되고 보관함 목록 자리를 보여준다', async () => {
    // 보관함을 읽는 동안 Suspense가 멈추므로 act 안에서 그려야 다시 시도된다.
    await act(async () => {
      render(createElement(App));
    });
    expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
  });
});
