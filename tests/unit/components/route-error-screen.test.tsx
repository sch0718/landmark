import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorScreen } from 'src/components/RouteErrorScreen';
import { ChunkLoadError } from 'src/lib/lazy-chunk';

const routeError = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('react-router', () => ({ useRouteError: () => routeError.current }));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RouteErrorScreen', () => {
  it('ChunkLoadError면 새 버전 안내와 새로고침 버튼을 보인다', () => {
    routeError.current = new ChunkLoadError('x');
    render(<RouteErrorScreen />);
    expect(screen.getByText('새 버전이 나왔어요. 새로고침해 주세요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.queryByText('문제가 생겨 화면을 표시하지 못했어요')).toBeNull();
  });

  it('새로고침 버튼은 location.reload를 부른다', () => {
    routeError.current = new ChunkLoadError('x');
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    render(<RouteErrorScreen />);
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('다른 오류면 지금 화면 그대로', () => {
    routeError.current = new Error('boom');
    render(<RouteErrorScreen />);
    expect(screen.getByText('문제가 생겨 화면을 표시하지 못했어요')).toBeInTheDocument();
    expect(screen.queryByText('새 버전이 나왔어요. 새로고침해 주세요')).toBeNull();
  });
});
