import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

describe('본문 영역', () => {
  it.each([
    ['넓은 화면 보관함', 1280, '/'],
    ['중간 화면 지도', 1024, '/map'],
    ['좁은 화면 보관함', 390, '/'],
    ['넓은 화면 라벨 관리', 1280, '/labels'],
    ['좁은 화면 설정', 390, '/settings'],
  ])('%s: 셸에 본문(main#main)이 하나이고 스크립트로 포커스할 수 있다', async (_, width, path) => {
    await renderLibrary(sampleLibrary(), { width, path });
    const mains = document.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main');
    expect(mains[0]).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('main')).toBe(mains[0]);
  });

  it('메뉴(nav)는 본문 밖에 있다', async () => {
    await renderLibrary(sampleLibrary(), { width: 390 });
    const main = screen.getByRole('main');
    expect(main).not.toContainElement(screen.getByRole('navigation', { name: '하단 메뉴' }));
    cleanup();
    await renderLibrary(sampleLibrary(), { width: 1280 });
    expect(screen.getByRole('main')).not.toContainElement(
      screen.getByRole('navigation', { name: '사이드 메뉴' }),
    );
  });

  it('목록·지도·상세 칸은 본문 안에 있다', async () => {
    await renderLibrary(sampleLibrary(), { width: 1280 });
    const main = screen.getByRole('main');
    expect(main).toContainElement(screen.getByRole('region', { name: '장소 목록' }));
    expect(main).toContainElement(screen.getByRole('region', { name: '지도' }));
    expect(main).toContainElement(screen.getByRole('region', { name: '장소 상세' }));
  });
});

describe('본문 바로가기', () => {
  it('첫 Tab에 포커스되고 보이며, Enter를 누르면 본문으로 포커스가 간다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { width: 1280 });
    const link = screen.getByRole('link', { name: '본문으로 바로 가기' });
    expect(link).toHaveAttribute('href', '#main');
    // 포커스 전에는 화면에 보이지 않는 자리(visually hidden)에 있다.
    expect(getComputedStyle(link).position).toBe('absolute');
    expect(getComputedStyle(link).width).toBe('1px');

    await user.tab();
    expect(link).toHaveFocus();
    // 포커스를 받으면 왼쪽 위에 고정되어 보인다. jsdom은 포커스만 옮겨서는 계산해 둔 스타일을 새로
    // 계산하지 않으므로(DOM이 바뀔 때만) 한 번 바꿔 다시 계산하게 한다.
    document.body.dataset.recompute = '';
    expect(getComputedStyle(link).position).toBe('fixed');
    expect(getComputedStyle(link).width).not.toBe('1px');
    delete document.body.dataset.recompute;

    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('좁은 화면에서도 첫 Tab이 본문 바로가기다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { width: 390 });
    await user.tab();
    expect(screen.getByRole('link', { name: '본문으로 바로 가기' })).toHaveFocus();
  });
});
