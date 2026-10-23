import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { NavRail } from 'src/sections/shell/NavRail';

describe('사이드 메뉴 브랜딩', () => {
  it('맨 위의 랜드마크 로고 링크가 보관함을 가리킨다', () => {
    render(
      <MemoryRouter initialEntries={['/trips']}>
        <NavRail onAdd={vi.fn()} />
      </MemoryRouter>,
    );

    const nav = screen.getByRole('navigation', { name: '사이드 메뉴' });
    const logo = within(nav).getByRole('link', { name: '랜드마크' });
    expect(logo).toHaveAttribute('href', '/');
    expect(nav.firstElementChild).toBe(logo);
    expect(logo.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(logo.querySelector('svg')).toHaveAttribute('width', '32');
    expect(getComputedStyle(logo).width).toBe('44px');
    expect(getComputedStyle(logo).height).toBe('44px');
  });

  it('로고 다음에 기존 내비 순서대로 탭 이동하고 추가 버튼을 실행한다', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <MemoryRouter>
        <NavRail onAdd={onAdd} />
      </MemoryRouter>,
    );

    const nav = screen.getByRole('navigation', { name: '사이드 메뉴' });
    for (const name of ['랜드마크', '보관함', '지도', '장소 추가', '여행', '약속', '설정']) {
      await user.tab();
      expect(document.activeElement).toHaveAccessibleName(name);
      if (name === '장소 추가') {
        await user.keyboard('{Enter}');
        expect(onAdd).toHaveBeenCalledWith(within(nav).getByRole('button', { name }));
      }
    }
  });
});
