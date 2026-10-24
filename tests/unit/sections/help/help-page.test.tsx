import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { HelpPage } from 'src/sections/help/HelpPage';
import { HELP_PAGES } from 'src/sections/help/help-content';

const resolved = vi.hoisted(() => ({ name: 'pastel', mode: 'light' }));
vi.mock('src/theme/use-theme', () => ({ useResolvedTheme: () => resolved }));

function page(id: string) {
  return (
    <MemoryRouter initialEntries={['/help/' + id]}>
      <Routes>
        <Route path="/help/:id" element={<HelpPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('도움말 본문', () => {
  it('제목·단계·팁·그림·앞뒤 링크를 보여 준다', () => {
    resolved.mode = 'light';
    render(page('map'));
    const content = HELP_PAGES.find((p) => p.id === 'map')!;
    expect(screen.getByRole('heading', { name: content.title, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '이렇게 써요' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '알아 두면 좋아요' })).toBeInTheDocument();
    for (const step of content.steps) expect(screen.getByText(step.title)).toBeInTheDocument();
    expect(screen.getByText(content.tips[0])).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/help/img/map-light.svg');
    expect(screen.getByRole('img')).toHaveAttribute(
      'alt',
      expect.stringContaining('지도 사용법: 1.'),
    );
    expect(screen.getByRole('img')).not.toHaveAttribute('loading');
    expect(screen.getByRole('link', { name: /이전.*보관함/ })).toHaveAttribute(
      'href',
      '/help/library',
    );
    expect(screen.getByRole('link', { name: /다음.*장소 추가/ })).toHaveAttribute(
      'href',
      '/help/add',
    );
  });
  it('현재 밝기 모드가 바뀌면 그림도 바뀐다', () => {
    resolved.mode = 'light';
    const view = render(page('trips'));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/help/img/trips-light.svg');
    resolved.mode = 'dark';
    view.rerender(page('trips'));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/help/img/trips-dark.svg');
  });
  it('없는 메뉴는 오류 안내와 목록 링크를 보여 준다', () => {
    render(page('missing'));
    expect(screen.getByRole('heading', { name: '도움말을 찾을 수 없어요' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /도움말/ })).toHaveAttribute('href', '/help');
  });
  it('이전·다음으로 메뉴를 바꾸면 담은 스크롤 칸을 맨 위로 돌린다', () => {
    resolved.mode = 'light';
    const { container } = render(
      <div data-testid="pane" style={{ overflowY: 'auto', height: 200 }}>
        {page('map')}
      </div>,
    );
    const pane = container.querySelector<HTMLElement>('[data-testid="pane"]')!;
    pane.scrollTop = 600;
    fireEvent.click(screen.getByRole('link', { name: /다음.*장소 추가/ }));
    expect(screen.getByRole('heading', { name: '장소 추가', level: 1 })).toBeInTheDocument();
    expect(pane.scrollTop).toBe(0);
  });
});
