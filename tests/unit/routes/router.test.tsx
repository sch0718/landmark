import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { prefetchWhenIdle } from 'src/lib/prefetch';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { PREFETCH_CHUNKS } from 'src/sections/shell/ShellRoute';
import { LIBRARY_KEY } from 'src/services/library-store';
import { mockViewport, renderApp } from '../sections/shell/harness';
import { makeTrip, plannerLibrary, withTrip } from '../sections/trips/planner-fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
vi.mock('src/lib/prefetch', () => ({ prefetchWhenIdle: vi.fn() }));

// 화면 파일 받기를 문으로 붙잡아, 기다리는 동안의 화면을 볼 수 있게 한다. 문은 화면마다 따로 둔다.
// 주의: `React.lazy`와 모듈 상태는 이 파일 안에서 테스트끼리 이어진다. 한 번 받은 화면은 다시 차갑지 않으므로,
// 각 화면은 자기 테스트에서만 처음 받고(그 전에는 문이 닫혀 있다) 그 테스트가 문을 연다.
const gates = vi.hoisted(() => {
  const make = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { open, opened };
  };
  return { trips: make(), settings: make(), labels: make(), planner: make() };
});
vi.mock('src/sections/trips/TripsPage', async (importOriginal) => {
  await gates.trips.opened;
  return importOriginal();
});
vi.mock('src/sections/settings/SettingsPage', async (importOriginal) => {
  await gates.settings.opened;
  return importOriginal();
});
vi.mock('src/sections/labels/LabelsPage', async (importOriginal) => {
  await gates.labels.opened;
  return importOriginal();
});
vi.mock('src/sections/trips/planner/TripPlannerPage', async (importOriginal) => {
  await gates.planner.opened;
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

const bottomNav = () => screen.getByRole('navigation', { name: '하단 메뉴' });
const waiting = () => screen.getByText('불러오는 중…');

describe('라우트 화면 나눠 받기', () => {
  it('/trips로 바로 들어와도 셸이 먼저 그려지고, 화면 자리에 기다림 표시가 뜬 뒤 화면이 나타난다', async () => {
    await renderApp({ path: '/trips', preloadRoutes: false });
    expect(bottomNav()).toBeInTheDocument();
    expect(waiting()).toHaveAttribute('role', 'status');
    expect(screen.queryByText('아직 만든 여행이 없어요')).not.toBeInTheDocument();

    gates.trips.open();
    expect(await screen.findByText('아직 만든 여행이 없어요')).toBeInTheDocument();
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument();
  });

  it('/settings로 바로 들어와도 셸이 먼저 그려지고, 기다린 뒤 화면이 나타난다', async () => {
    await renderApp({ path: '/settings', preloadRoutes: false });
    expect(bottomNav()).toBeInTheDocument();
    expect(waiting()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '설정' })).not.toBeInTheDocument();

    gates.settings.open();
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument();
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument();
  });

  it('/labels로 바로 들어와도 셸이 먼저 그려지고, 기다린 뒤 화면이 나타난다', async () => {
    await renderApp({ path: '/labels', preloadRoutes: false });
    expect(bottomNav()).toBeInTheDocument();
    expect(waiting()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '라벨 관리' })).not.toBeInTheDocument();

    gates.labels.open();
    expect(await screen.findByRole('heading', { name: '라벨 관리' })).toBeInTheDocument();
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument();
  });

  it('/trips/<id>로 바로 들어와도 셸이 먼저 그려지고, 기다린 뒤 여행 계획 화면이 나타난다', async () => {
    const storage = createMemoryStorage();
    storage.setItem(LIBRARY_KEY, JSON.stringify(withTrip(plannerLibrary(), makeTrip())));
    mockViewport(1280);
    await renderApp({ path: '/trips/trip000001', storage, preloadRoutes: false });
    expect(screen.getByRole('navigation', { name: '사이드 메뉴' })).toBeInTheDocument();
    expect(waiting()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Day 시간표' })).not.toBeInTheDocument();

    gates.planner.open();
    expect(await screen.findByRole('region', { name: 'Day 시간표' })).toBeInTheDocument();
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument();
  });

  it('앱 안에서 이동해도 화면이 나타난다', async () => {
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
    await renderApp({ path: '/', preloadRoutes: false });
    expect(bottomNav()).toBeInTheDocument();
    expect(prefetchWhenIdle).toHaveBeenCalledTimes(1);
    expect(prefetchWhenIdle).toHaveBeenCalledWith(PREFETCH_CHUNKS);
  });
});
