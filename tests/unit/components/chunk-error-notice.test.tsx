import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChunkErrorBoundary } from 'src/components/ChunkErrorBoundary';
import { ChunkErrorNotice } from 'src/components/ChunkErrorNotice';
import { ChunkLoadError } from 'src/lib/lazy-chunk';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOTICE = '새 버전이 나왔어요. 새로고침해 주세요';

describe('ChunkErrorNotice (칸 안)', () => {
  it('새 버전 안내와 새로고침 버튼을 보인다', () => {
    render(<ChunkErrorNotice />);
    expect(screen.getByRole('alert')).toHaveTextContent(NOTICE);
    expect(screen.getByRole('button', { name: '새로고침' })).toBeInTheDocument();
  });

  it('새로고침 버튼은 location.reload를 부른다', () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    render(<ChunkErrorNotice />);
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

function Throws({ error }: { error: unknown }): never {
  throw error;
}

describe('ChunkErrorBoundary', () => {
  it('ChunkLoadError면 fallback을 보인다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ChunkErrorBoundary fallback={<ChunkErrorNotice />}>
        <Throws error={new ChunkLoadError('x')} />
      </ChunkErrorBoundary>,
    );
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it('다른 오류는 다시 던져 바깥 경계가 받게 한다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <ChunkErrorBoundary fallback={<p>바깥으로 안 나가야 함</p>}>
          <Throws error={new Error('boom')} />
        </ChunkErrorBoundary>,
      ),
    ).toThrow('boom');
    expect(screen.queryByText('바깥으로 안 나가야 함')).not.toBeInTheDocument();
  });
});
