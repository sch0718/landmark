import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { renderApp } from '../sections/shell/harness';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
vi.mock('src/lib/prefetch', () => ({ prefetchWhenIdle: vi.fn() }));
// 새 배포 뒤 옛 파일이 없는 경우처럼, 설정 화면 파일 받기가 실패한다.
vi.mock('src/sections/settings/SettingsPage', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('라우트 화면 받기 실패', () => {
  it('화면 파일을 받지 못하면 새 버전 안내와 새로고침 버튼을 보인다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderApp({ path: '/settings', preloadRoutes: false });
    expect(await screen.findByText('새 버전이 나왔어요. 새로고침해 주세요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.queryByText('문제가 생겨 화면을 표시하지 못했어요')).not.toBeInTheDocument();
  });
});
