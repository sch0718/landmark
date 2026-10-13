import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { prefetchWhenIdle } from 'src/lib/prefetch';
import { ROUTE_CHUNKS } from 'src/routes/lazy-routes';
import { renderApp } from '../sections/shell/harness';
import { makeTrip, open, plannerLibrary, withTrip } from '../sections/trips/planner-fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
vi.mock('src/lib/prefetch', () => ({ prefetchWhenIdle: vi.fn() }));

// 여행 목록 화면을 받는 일을 문으로 붙잡아, 기다리는 동안의 화면을 볼 수 있게 한다.
const gate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
});
vi.mock('src/sections/trips/TripsPage', async (importOriginal) => {
  await gate.opened;
  return importOriginal();
});

beforeEach(() => {
  vi.mocked(prefetchWhenIdle).mockClear();
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

describe('라우트 화면 나눠 받기', () => {
  it('/trips로 바로 들어와도 셸이 먼저 그려지고, 화면 자리에 기다림 표시가 뜬 뒤 화면이 나타난다', async () => {
    await renderApp({ path: '/trips', preloadRoutes: false });
    expect(screen.getByRole('navigation', { name: '하단 메뉴' })).toBeInTheDocument();
    expect(screen.getByText('불러오는 중…')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('아직 만든 여행이 없어요')).not.toBeInTheDocument();

    gate.open();
    expect(await screen.findByText('아직 만든 여행이 없어요')).toBeInTheDocument();
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument();
  });

  it('/settings와 /labels로 바로 들어와도 셸 안에 화면이 나타난다', async () => {
    await renderApp({ path: '/settings', preloadRoutes: false });
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument();
    cleanup();

    await renderApp({ path: '/labels', preloadRoutes: false });
    expect(await screen.findByRole('heading', { name: '라벨 관리' })).toBeInTheDocument();
  });

  it('/trips/<id>로 바로 들어와도 셸 안에 여행 계획 화면이 나타난다', async () => {
    gate.open();
    await open(withTrip(plannerLibrary(), makeTrip()));
    expect(screen.getByRole('navigation', { name: '사이드 메뉴' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Day 시간표' })).toBeInTheDocument();
  });

  it('앱 안에서 이동해도 화면이 나타난다', async () => {
    gate.open();
    const { router } = await renderApp({ path: '/', preloadRoutes: false });
    await act(async () => {
      await router.navigate('/settings');
    });
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument();
    await act(async () => {
      await router.navigate('/trips');
    });
    expect(await screen.findByText('아직 만든 여행이 없어요')).toBeInTheDocument();
  });

  it('셸이 그려진 뒤 미리 받기를 한 번 예약한다', async () => {
    gate.open();
    await renderApp({ path: '/', preloadRoutes: false });
    await userEvent.setup().keyboard('{Tab}');
    expect(screen.getByRole('navigation', { name: '하단 메뉴' })).toBeInTheDocument();
    expect(prefetchWhenIdle).toHaveBeenCalledTimes(1);
    expect(prefetchWhenIdle).toHaveBeenCalledWith(ROUTE_CHUNKS);
  });
});
