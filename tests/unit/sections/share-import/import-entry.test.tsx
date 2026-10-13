import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { readShareHash, type ShareReadResult } from 'src/domain/share/read-share';
import { addFlowAtom, addTargetAtom, openAddSheetAtom } from 'src/stores/add-place';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
import { SHARE_DOC, shareHashValue } from './share-fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/domain/share/read-share', async (importOriginal) => {
  const original = await importOriginal<typeof import('src/domain/share/read-share')>();
  return { ...original, readShareHash: vi.fn(original.readShareHash) };
});
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  toastMock.mockClear();
  toastMock.error.mockClear();
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

describe('/import entry', () => {
  it('opens the preview step for a valid #d= link and clears the address', async () => {
    const value = await shareHashValue();
    const { router, store } = await renderLibrary(sampleLibrary(), { path: `/import#d=${value}` });
    await waitFor(() => expect(store.get(addFlowAtom).step).toBe('share'));
    expect(store.get(addFlowAtom)).toEqual({ step: 'share', doc: SHARE_DOC });
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.hash).toBe('');
  });

  it('toasts and stays closed for a broken link', async () => {
    const { router, store } = await renderLibrary(sampleLibrary(), { path: '/import#d=!!!' });
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        '공유 파일을 읽지 못했어요. 파일이나 링크가 손상됐을 수 있어요',
      ),
    );
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.hash).toBe('');
  });

  it('opens the file-pick step without a hash and drops any trip target', async () => {
    const { router, store } = await renderLibrary(sampleLibrary(), { path: '/import' });
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'share-pick' }));
    expect(store.get(addTargetAtom)).toBeNull();
    expect(router.state.location.pathname).toBe('/');
    expect(await screen.findByRole('heading', { name: '공유 파일 가져오기' })).toBeInTheDocument();
  });

  it('does not reopen after the address is already /', async () => {
    const value = await shareHashValue();
    const first = await renderLibrary(sampleLibrary(), { path: `/import#d=${value}` });
    await waitFor(() => expect(first.store.get(addFlowAtom).step).toBe('share'));
    const url = first.router.state.location;
    cleanup();

    const second = await renderLibrary(sampleLibrary(), { path: url.pathname + url.hash });
    expect(second.store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('discards the link result when another flow opened while decoding', async () => {
    let finish: (result: ShareReadResult) => void = () => undefined;
    vi.mocked(readShareHash).mockImplementationOnce(
      () => new Promise<ShareReadResult>((resolve) => (finish = resolve)),
    );
    const { store } = await renderLibrary(sampleLibrary(), { path: '/import#d=pending' });
    await waitFor(() => expect(readShareHash).toHaveBeenCalledWith('pending'));
    act(() => store.set(addFlowAtom, { step: 'link', hint: 'place' }));
    await act(async () => finish({ ok: true, doc: SHARE_DOC }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'link', hint: 'place' });
  });
});

describe('entry points', () => {
  it('add sheet shows the item without a trip target and goes to /import', async () => {
    const user = userEvent.setup();
    const { router, store } = await renderLibrary(sampleLibrary(), { width: 390 });
    await user.click(screen.getByRole('button', { name: '장소 추가' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('받은 Landmark 공유 파일(.html)')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /공유 파일 가져오기/ }));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'share-pick' }));
    expect(router.state.location.pathname).toBe('/');
    await waitFor(() => expect(screen.queryByText('받은 Landmark 공유 파일(.html)')).toBeNull());
    // 잠깐 거친 `/import`가 방문 기록을 하나 더 남기지 않는다(뒤로 가도 같은 자리).
    const { key } = router.state.location;
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.key).toBe(key);
  });

  it('add sheet hides the item when a trip target is attached', async () => {
    const { store } = await renderLibrary(sampleLibrary(), { width: 390 });
    act(() => store.set(openAddSheetAtom, { tripId: 'trip0001' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /링크 붙여넣기/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /공유 파일 가져오기/ })).toBeNull();
  });

  it('settings button goes to /import', async () => {
    const user = userEvent.setup();
    const { router, store } = await renderLibrary(sampleLibrary(), { path: '/settings' });
    await user.click(screen.getByRole('button', { name: '공유 파일 가져오기' }));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'share-pick' }));
    expect(router.state.location.pathname).toBe('/');
    // `/import`로도 바꿔치기로 가서 방문 기록이 늘지 않는다(뒤로 가도 같은 자리).
    const { key } = router.state.location;
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.key).toBe(key);
  });
});
