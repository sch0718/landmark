import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomTabs } from 'src/sections/shell/BottomTabs';
import { NavRail } from 'src/sections/shell/NavRail';

afterEach(cleanup);
describe('약속 내비게이션', () => {
  it('하단 메뉴 여섯 칸을 여행 다음 약속 순서로 놓고 360px에서도 44px을 확보한다', () => {
    render(
      <MemoryRouter initialEntries={['/meetings/meeting001']}>
        <BottomTabs onAdd={vi.fn()} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: '하단 메뉴' });
    const controls = within(nav).getAllByRole('link').concat(within(nav).getAllByRole('button'));
    expect(controls).toHaveLength(6);
    expect(
      within(nav)
        .getAllByRole('link')
        .map((el) => el.textContent),
    ).toEqual(['보관함', '지도', '여행', '약속', '설정']);
    expect(within(nav).getByRole('link', { name: '약속' })).toHaveAttribute('aria-current', 'page');
    for (const control of controls) {
      expect(Number.parseFloat(getComputedStyle(control).minWidth)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(getComputedStyle(control).minHeight)).toBeGreaterThanOrEqual(44);
    }
    expect(360 / controls.length).toBeGreaterThanOrEqual(44);
  });
  it('사이드 메뉴에서도 약속 편집 경로는 약속 탭을 켠다', () => {
    render(
      <MemoryRouter initialEntries={['/meetings/meeting001']}>
        <NavRail onAdd={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: '약속' })).toHaveAttribute('aria-current', 'page');
  });
});
