import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { BACKUP_META_KEY } from 'src/services/backup-meta-store';
import { persistenceAtom } from 'src/stores/library-state';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
const downloadMock = vi.hoisted(() => vi.fn());
vi.mock('src/lib/download-text', () => ({ downloadText: downloadMock }));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

// 시드 장소의 `createdAt`(2026-10-08)이 8일 전이 되는 시각.
const NOW = '2026-10-16T05:30:00.000Z';
const NINE_DAYS_AGO = '2026-10-07T05:30:00.000Z';
const NEVER = '아직 백업하지 않았어요. 보관함은 이 기기에만 있어요';
const STALE = '마지막 백업이 9일 전이에요. 그 뒤로 바뀐 내용이 있어요';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toastMock.mockClear();
  downloadMock.mockClear();
  setAppRuntimeForTest(null);
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

const banner = () => screen.queryByRole('region', { name: '백업 알림' });
const storedMeta = (storage: Storage) =>
  JSON.parse(storage.getItem(BACKUP_META_KEY)!) as {
    lastBackupAt: string | null;
    snoozedAt: string | null;
  };

describe('BackupReminder', () => {
  it('shows on the library view when never backed up, and not on settings or trips', async () => {
    await renderLibrary(sampleLibrary(), { path: '/' });
    expect(within(banner()!).getByText(NEVER)).toBeInTheDocument();
    cleanup();
    await renderLibrary(sampleLibrary(), { path: '/settings' });
    expect(banner()).toBeNull();
    cleanup();
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    expect(banner()).toBeNull();
  });

  it('also shows on the map view', async () => {
    await renderLibrary(sampleLibrary(), { path: '/map' });
    expect(banner()).not.toBeNull();
  });

  it('"나중에" hides the banner, focuses #main and stores snoozedAt', async () => {
    const user = userEvent.setup();
    const { storage } = await renderLibrary(sampleLibrary(), { path: '/' });
    await user.click(within(banner()!).getByRole('button', { name: '나중에' }));
    expect(banner()).toBeNull();
    expect(document.getElementById('main')).toHaveFocus();
    await waitFor(() => expect(storedMeta(storage).snoozedAt).toBe(NOW));
  });

  it('"백업 받기" downloads once and hides the banner', async () => {
    const user = userEvent.setup();
    const { storage } = await renderLibrary(sampleLibrary(), { path: '/' });
    await user.click(within(banner()!).getByRole('button', { name: '백업 받기' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(banner()).toBeNull());
    expect(document.getElementById('main')).toHaveFocus();
    await waitFor(() => expect(storedMeta(storage).lastBackupAt).toBe(NOW));
  });

  it('uses the share sheet when the device can share', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { path: '/' });
    await user.click(within(banner()!).getByRole('button', { name: '백업 받기' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(downloadMock).not.toHaveBeenCalled();
    await waitFor(() => expect(banner()).toBeNull());
  });

  it('stays without error toast or backup record when the share sheet is dismissed', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const share = vi.fn(() => Promise.reject(abort));
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const user = userEvent.setup();
    const { storage } = await renderLibrary(sampleLibrary(), { path: '/' });
    await user.click(within(banner()!).getByRole('button', { name: '백업 받기' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(banner()!).getByRole('button', { name: '백업 받기' })).toBeEnabled(),
    );
    expect(banner()).not.toBeNull();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(storage.getItem(BACKUP_META_KEY)).toBeNull();
  });

  it('toasts once and stays when sharing fails', async () => {
    const share = vi.fn(() => Promise.reject(new Error('boom')));
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const user = userEvent.setup();
    const { storage } = await renderLibrary(sampleLibrary(), { path: '/' });
    await user.click(within(banner()!).getByRole('button', { name: '백업 받기' }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        '공유하지 못했어요. 백업 파일 받기를 이용해 주세요',
      ),
    );
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(banner()).not.toBeNull();
    expect(within(banner()!).queryByRole('alert')).toBeNull();
    expect(storage.getItem(BACKUP_META_KEY)).toBeNull();
  });

  it('says how many days ago when changes came after the last backup', async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      BACKUP_META_KEY,
      JSON.stringify({ lastBackupAt: NINE_DAYS_AGO, snoozedAt: null }),
    );
    await renderLibrary(sampleLibrary(), { path: '/', storage });
    expect(within(banner()!).getByText(STALE)).toBeInTheDocument();
  });

  it('is hidden in memory mode', async () => {
    const { store } = await renderLibrary(sampleLibrary(), { path: '/' });
    expect(banner()).not.toBeNull();
    act(() => store.set(persistenceAtom, 'memory'));
    expect(banner()).toBeNull();
  });

  it('is not a live region', async () => {
    await renderLibrary(sampleLibrary(), { path: '/' });
    const region = banner()!;
    expect(within(region).queryByRole('status')).toBeNull();
    expect(within(region).queryByRole('alert')).toBeNull();
    expect(region.querySelector('[aria-live],[role="status"],[role="alert"]')).toBeNull();
  });
});
