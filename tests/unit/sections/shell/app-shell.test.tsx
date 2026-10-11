import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { mockViewport, renderApp } from './harness';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const PLACE = '/place/abcde12345';

describe('AppShell layout', () => {
  it('renders bottom tabs below 768 and rail at 768+', async () => {
    mockViewport(767);
    await renderApp();
    expect(screen.getByRole('navigation', { name: '하단 메뉴' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '사이드 메뉴' })).not.toBeInTheDocument();
    cleanup();

    mockViewport(768);
    await renderApp();
    expect(screen.getByRole('navigation', { name: '사이드 메뉴' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '하단 메뉴' })).not.toBeInTheDocument();
  });

  it('wide layout shows list, map and detail slots side by side at 1280', async () => {
    mockViewport(1280);
    await renderApp();
    const list = screen.getByRole('region', { name: '장소 목록' });
    const map = screen.getByRole('region', { name: '지도' });
    const detail = screen.getByRole('region', { name: '장소 상세' });
    expect(list.parentElement).toBe(map.parentElement);
    expect(map.parentElement).toBe(detail.parentElement);
    expect([...list.parentElement!.children]).toEqual([list, map, detail]);
    expect(screen.getByRole('navigation', { name: '사이드 메뉴' })).toBeInTheDocument();
  });

  it('medium layout overlays detail over map', async () => {
    mockViewport(1279);
    await renderApp({ path: '/' });
    expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument();
    cleanup();

    await renderApp({ path: PLACE });
    const map = screen.getByRole('region', { name: '지도' });
    const detail = screen.getByRole('region', { name: '장소 상세' });
    expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    // 상세는 지도와 같은 칸 안에서 지도 위에 겹친다.
    expect(detail.parentElement).toBe(map.parentElement);
    expect(getComputedStyle(detail).position).toBe('absolute');
    expect(getComputedStyle(detail).width).toBe('360px');
  });

  it('keeps the map and detail DOM nodes when crossing 1280px', async () => {
    const viewport = mockViewport(1280);
    await renderApp({ path: PLACE });
    const map = screen.getByRole('region', { name: '지도' });
    const mapSlot = within(map).getByTestId('map-host');
    const detail = screen.getByRole('region', { name: '장소 상세' });
    const detailSlot = within(detail).getByText('장소를 찾을 수 없어요');
    expect(screen.queryByRole('button', { name: '닫기' })).not.toBeInTheDocument();

    viewport.setWidth(1279);
    expect(screen.getByRole('region', { name: '지도' })).toBe(map);
    expect(within(map).getByTestId('map-host')).toBe(mapSlot);
    expect(screen.getByRole('region', { name: '장소 상세' })).toBe(detail);
    expect(within(detail).getByText('장소를 찾을 수 없어요')).toBe(detailSlot);
    expect(getComputedStyle(detail).position).toBe('absolute');
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();

    viewport.setWidth(1280);
    expect(screen.getByRole('region', { name: '지도' })).toBe(map);
    expect(screen.getByRole('region', { name: '장소 상세' })).toBe(detail);
    expect(getComputedStyle(detail).position).not.toBe('absolute');
  });

  it('keeps the map node when crossing 1280px with no place open', async () => {
    const viewport = mockViewport(1300);
    await renderApp({ path: '/' });
    const map = screen.getByRole('region', { name: '지도' });
    viewport.setWidth(1000);
    expect(screen.getByRole('region', { name: '지도' })).toBe(map);
    expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument();
  });

  it('map pane clips its content and fills the height', async () => {
    mockViewport(1280);
    await renderApp();
    const style = getComputedStyle(screen.getByRole('region', { name: '지도' }));
    expect(style.overflow).toBe('hidden');
    expect(style.height).toBe('100%');
  });

  it('closes the medium overlay back to the library', async () => {
    mockViewport(900);
    const { router } = await renderApp({ path: PLACE });
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(router.state.location.pathname).toBe('/');
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument(),
    );
  });

  it('compact layout shows one slot at a time and detail as a full-screen sheet', async () => {
    mockViewport(390);
    const { router } = await renderApp({ path: '/' });
    expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole('navigation')).getByRole('link', { name: '지도' }),
    );
    expect(router.state.location.pathname).toBe('/map');
    expect(await screen.findByRole('region', { name: '지도' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '장소 목록' })).not.toBeInTheDocument();

    await act(async () => {
      await router.navigate(PLACE);
    });
    const sheet = screen.getByRole('region', { name: '장소 상세' });
    expect(getComputedStyle(sheet).position).toBe('fixed');
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(router.state.location.pathname).toBe('/map');
  });

  it('compact: closing a sheet opened from the list goes back instead of pushing', async () => {
    mockViewport(390);
    const { router } = await renderApp({ path: '/' });
    await act(async () => {
      await router.navigate(PLACE);
    });
    expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(router.state.location.pathname).toBe('/');
    // 기록을 되감았으므로(POP) 뒤로가기가 시트를 다시 열지 않는다.
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument(),
    );
  });

  it('compact: a sheet opened from the map keeps the map behind it and closes to the map', async () => {
    mockViewport(390);
    const { router } = await renderApp({ path: '/map' });
    await act(async () => {
      await router.navigate(PLACE);
    });
    expect(screen.getByRole('region', { name: '지도' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '장소 목록' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(router.state.historyAction).toBe('POP');
    expect(await screen.findByRole('region', { name: '지도' })).toBeInTheDocument();
  });

  it('compact: a sheet entered directly replaces history instead of leaving the app', async () => {
    mockViewport(390);
    const { router } = await renderApp({ path: PLACE });
    expect(router.state.location.key).toBe('default');
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('region', { name: '장소 목록' })).toBeInTheDocument();
  });

  it('treats a trailing slash as the same path', async () => {
    mockViewport(390);
    await renderApp({ path: '/map/' });
    expect(screen.getByRole('region', { name: '지도' })).toBeInTheDocument();
    cleanup();

    await renderApp({ path: `${PLACE}/` });
    expect(screen.getByRole('region', { name: '장소 상세' })).toBeInTheDocument();
    cleanup();

    mockViewport(1280);
    await renderApp({ path: '/map/' });
    expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
  });

  it('marks the current destination and keeps library active on a place', async () => {
    mockViewport(390);
    await renderApp({ path: PLACE });
    const nav = screen.getByRole('navigation', { name: '하단 메뉴' });
    expect(within(nav).getByRole('link', { name: '보관함' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: '지도' })).not.toHaveAttribute('aria-current');
  });

  it('shows the trips placeholder at /trips', async () => {
    mockViewport(390);
    await renderApp({ path: '/trips' });
    expect(screen.getByText('여행 계획은 곧 제공돼요')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '여행' })).toHaveAttribute('aria-current', 'page');
  });

  it('bottom tab targets are at least 44px', async () => {
    mockViewport(390);
    await renderApp();
    const nav = screen.getByRole('navigation', { name: '하단 메뉴' });
    const targets = [...within(nav).getAllByRole('link'), within(nav).getByRole('button')];
    expect(targets).toHaveLength(5);
    for (const target of targets) {
      const style = getComputedStyle(target);
      expect(parseFloat(style.minWidth), target.textContent ?? '＋').toBeGreaterThanOrEqual(44);
      expect(parseFloat(style.minHeight), target.textContent ?? '＋').toBeGreaterThanOrEqual(44);
    }
  });

  it('rail targets are at least 44px', async () => {
    mockViewport(1280);
    await renderApp();
    const nav = screen.getByRole('navigation', { name: '사이드 메뉴' });
    for (const target of [...within(nav).getAllByRole('link'), within(nav).getByRole('button')]) {
      const style = getComputedStyle(target);
      expect(parseFloat(style.width)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(style.height)).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('AddSheet', () => {
  it('add sheet lists three enabled options', async () => {
    mockViewport(390);
    await renderApp();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '장소 추가' }));

    const sheet = await screen.findByRole('dialog');
    const options = within(sheet).getAllByRole('button');
    expect(options.map((option) => option.querySelector('span')?.textContent)).toEqual([
      '링크 붙여넣기',
      '지도에서 핀 찍기',
      '네이버 폴더 가져오기',
    ]);
    for (const option of options) expect(option).toBeEnabled();
    expect(sheet).not.toHaveTextContent('곧 제공돼요');
  });

  it('opens from the rail on wide screens too', async () => {
    mockViewport(1280);
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: '장소 추가' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
