import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { App } from 'src/app';

describe('smoke', () => {
  it('렌더되고 안내 문구를 보여준다', () => {
    render(createElement(App));
    expect(screen.getByText('공유받은 링크로 접속하세요')).toBeInTheDocument();
  });
});
