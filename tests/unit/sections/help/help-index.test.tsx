import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { HelpIndexPage } from 'src/sections/help/HelpIndexPage';
import { HELP_PAGES } from 'src/sections/help/help-content';

describe('도움말 목록', () => {
  it('아홉 메뉴와 단계를 보여 주고 백틱은 강조로 바꾼다', () => {
    const { container } = render(
      <MemoryRouter>
        <HelpIndexPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '도움말', level: 1 })).toBeInTheDocument();
    for (const page of HELP_PAGES) {
      expect(screen.getByRole('link', { name: new RegExp('^' + page.title) })).toHaveAttribute(
        'href',
        '/help/' + page.id,
      );
    }
    expect(container.textContent).not.toContain('`');
    expect(screen.getByRole('button', { name: '처음 안내 다시 보기' })).toBeInTheDocument();
  });
});
