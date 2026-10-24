import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { AddSheet } from 'src/sections/shell/AddSheet';
import { HelpButton } from 'src/components/HelpButton';

function Location() {
  return <output aria-label="현재 경로">{useLocation().pathname}</output>;
}

afterEach(cleanup);

describe('도움말 진입', () => {
  it('화면별 도움말 주소를 링크로 제공하고 키보드로 이동한다', async () => {
    render(
      <MemoryRouter>
        <HelpButton page="library" />
        <Location />
      </MemoryRouter>,
    );
    const help = screen.getByRole('link', { name: '도움말' });
    expect(help).toHaveAttribute('href', '/help/library');
    expect(help).toHaveAttribute('title', '도움말');
    await userEvent.tab();
    expect(help).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('현재 경로')).toHaveTextContent('/help/library');
  });

  it('장소 추가 시트에서 도움말로 이동하면서 시트를 닫는다', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <AddSheet open onClose={onClose} />
        <Location />
      </MemoryRouter>,
    );
    const help = screen.getByRole('link', { name: '도움말' });
    expect(help).toHaveAttribute('href', '/help/add');
    expect(getComputedStyle(help).width).toBe('44px');
    expect(getComputedStyle(help).height).toBe('44px');
    await userEvent.click(help);
    expect(onClose).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText('현재 경로')).toHaveTextContent('/help/add');
  });
});
