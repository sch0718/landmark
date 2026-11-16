import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChunkErrorBoundary } from 'src/components/ChunkErrorBoundary';
import { ChunkErrorNotice } from 'src/components/ChunkErrorNotice';
import { ChunkLoadError, reloadWithFreshChunks } from 'src/lib/lazy-chunk';

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

  it('새로고침 버튼은 받은 파일을 캐시 없이 다시 받은 뒤 location.reload를 부른다', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    render(<ChunkErrorNotice />);
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});

describe('reloadWithFreshChunks', () => {
  it('이 페이지가 받은 /assets/*.js만 cache: reload로 다시 받고 새로고침한다', async () => {
    const reload = vi.fn();
    const fetch = vi.fn(() => Promise.resolve(new Response('')));
    const origin = 'https://landmark.example';
    const names = [
      `${origin}/assets/TripsPage-abc.js`,
      `${origin}/assets/TripsPage-abc.js`,
      `${origin}/assets/index-def.css`,
      `${origin}/api/search`,
      'https://maps.googleapis.com/maps/api/js',
    ];
    await reloadWithFreshChunks({
      location: { origin, reload } as unknown as Location,
      performance: {
        getEntriesByType: () => names.map((name) => ({ name })),
      } as unknown as Performance,
      fetch: fetch as unknown as typeof window.fetch,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${origin}/assets/TripsPage-abc.js`, { cache: 'reload' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('다시 받기가 실패해도 새로고침한다', async () => {
    const reload = vi.fn();
    const origin = 'https://landmark.example';
    await reloadWithFreshChunks({
      location: { origin, reload } as unknown as Location,
      performance: {
        getEntriesByType: () => [{ name: `${origin}/assets/a.js` }],
      } as unknown as Performance,
      fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof window.fetch,
    });
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
