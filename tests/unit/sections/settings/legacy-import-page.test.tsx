import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
import { NEW_IDS, stubTripFetch, tripOf } from './import-fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

beforeEach(() => toastMock.mockClear());
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

describe('LegacyImportPage', () => {
  it('/t/:publicId renders preview from fetched data; 404 shows not found', async () => {
    stubTripFetch({ testtrip0001: tripOf() });
    await renderLibrary(sampleLibrary(), { path: '/t/testtrip0001', ids: NEW_IDS });
    expect(await screen.findByText(/^새로 추가/)).toHaveTextContent(
      '새로 추가 2 · 이미 있음 0(라벨만 합침) · 새 라벨 1 · 확인 필요 0',
    );
    expect(screen.getByRole('heading', { name: '테스트 여행' })).toBeInTheDocument();
    cleanup();

    await renderLibrary(sampleLibrary(), { path: '/t/nothere0001' });
    expect(await screen.findByText('이 링크의 여행을 찾지 못했어요')).toBeInTheDocument();
    expect(screen.queryByText(/^새로 추가/)).not.toBeInTheDocument();
  });

  it('importing from the page saves, toasts and returns to the library', async () => {
    const user = userEvent.setup();
    stubTripFetch({ testtrip0001: tripOf() });
    const { router, storage } = await renderLibrary(sampleLibrary(), {
      path: '/t/testtrip0001',
      ids: NEW_IDS,
    });
    await user.click(await screen.findByRole('button', { name: '가져오기' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('2곳을 가져왔어요'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const lib = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
    expect(Object.keys(lib.places)).toHaveLength(7);
  });
});
