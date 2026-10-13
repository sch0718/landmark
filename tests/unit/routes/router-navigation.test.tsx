import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { renderApp } from '../sections/shell/harness';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
vi.mock('src/lib/prefetch', () => ({ prefetchWhenIdle: vi.fn() }));

// 이 파일은 화면 사이 이동만 본다. `React.lazy`가 한 번 받은 화면을 기억하므로(다른 테스트 파일과 모듈 상태를
// 나누지 않으려고) 별도 파일에 두고, 설정 화면은 열어 두고 라벨 화면은 이 테스트가 직접 붙잡았다 연다.
const gates = vi.hoisted(() => {
  const make = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { open, opened };
  };
  return { settings: make(), labels: make() };
});
vi.mock('src/sections/settings/SettingsPage', async (importOriginal) => {
  await gates.settings.opened;
  return importOriginal();
});
vi.mock('src/sections/labels/LabelsPage', async (importOriginal) => {
  await gates.labels.opened;
  return importOriginal();
});

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
});

describe('나눠 받는 화면 사이 이동', () => {
  it('받은 화면에서 아직 못 받은 화면으로 이동하면 기다림 표시가 뜨고, 받으면 화면이 나타난다', async () => {
    gates.settings.open();
    const { router } = await renderApp({ path: '/settings', preloadRoutes: false });
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument();

    // react-router는 이동을 전환으로 돌려, 같은 Suspense를 쓰면 React가 옛 화면을 그대로 둔다.
    await act(async () => {
      void router.navigate('/labels');
    });
    expect(screen.getByText('불러오는 중…')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('heading', { name: '설정' })).not.toBeInTheDocument();

    gates.labels.open();
    expect(await screen.findByRole('heading', { name: '라벨 관리' })).toBeInTheDocument();
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument();
  });
});
