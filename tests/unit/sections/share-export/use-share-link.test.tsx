import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ShareDoc } from 'src/schema/share';
import { useShareLink } from 'src/sections/share-export/use-share-link';
import type { ShareFileOptions } from 'src/sections/share-export/ShareFileDialog';

const viewLinkMock = vi.hoisted(() => vi.fn());
vi.mock('src/share-viewer/encode', async (original) => ({
  ...(await original<typeof import('src/share-viewer/encode')>()),
  viewLink: viewLinkMock,
}));
const makeDoc = (opts: ShareFileOptions): ShareDoc => ({
  format: 'tripmap-share',
  version: 1,
  title: opts.title,
  createdAt: opts.now.toISOString(),
  labels: [],
  places: [],
});
afterEach(() => {
  vi.unstubAllEnvs();
  viewLinkMock.mockReset();
});

it('운영에서는 현재 출처 대신 기본 앱 주소를 쓴다', async () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_APP_URL', '');
  viewLinkMock.mockResolvedValue({ kind: 'direct', href: '준비됨' });
  const { result } = renderHook(() => useShareLink(true, '제목', true, makeDoc));
  await waitFor(() => expect(result.current?.kind).toBe('direct'));
  expect(viewLinkMock).toHaveBeenCalledWith(expect.any(Object), 'https://landmark.sch0718.dev');
});

it('제목·메모가 바뀌면 옛 압축 결과를 버리고 닫으면 결과를 숨긴다', async () => {
  const pending: Array<(value: { kind: 'direct'; href: string }) => void> = [];
  viewLinkMock.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const { result, rerender } = renderHook(
    ({ title, memo, open }) => useShareLink(open, title, memo, makeDoc),
    { initialProps: { title: '옛 제목', memo: true, open: true } },
  );
  rerender({ title: '새 제목', memo: false, open: true });
  await act(async () => pending[1]!({ kind: 'direct', href: '새 링크' }));
  expect(result.current).toEqual({ kind: 'direct', href: '새 링크' });
  await act(async () => pending[0]!({ kind: 'direct', href: '옛 링크' }));
  expect(result.current).toEqual({ kind: 'direct', href: '새 링크' });
  rerender({ title: '새 제목', memo: false, open: false });
  expect(result.current).toBeNull();
});
