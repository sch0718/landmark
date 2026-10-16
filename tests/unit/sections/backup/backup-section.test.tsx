import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBackupText } from 'src/domain/backup/read-backup';
import { formatLocalDateTime } from 'src/domain/backup/summary';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { BACKUP_META_KEY } from 'src/services/backup-meta-store';
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

const NOW = '2026-10-16T05:30:00.000Z';
const THREE_DAYS_AGO = '2026-10-13T05:30:00.000Z';
const SHARE_FAILED = '공유하지 못했어요. 백업 파일 받기를 이용해 주세요';

/** 공유 API를 흉내 낸다. */
function stubShare(share: (data: ShareData) => Promise<void>, canShare = true) {
  const shareFn = vi.fn(share);
  Object.defineProperty(navigator, 'canShare', {
    value: vi.fn(() => canShare),
    configurable: true,
  });
  Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true });
  return shareFn;
}

beforeEach(() => {
  // 시각만 고정한다(타이머는 진짜 그대로).
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

const open = (storage: Storage = createMemoryStorage()) =>
  renderLibrary(sampleLibrary(), { path: '/settings', storage });
const section = () => screen.getByRole('region', { name: '백업' });
const saveButton = () => within(section()).getByRole('button', { name: '백업 파일 받기' });
const statusLine = () => within(section()).getByText(/^마지막 백업:/);
const storedMeta = (storage: Storage) =>
  JSON.parse(storage.getItem(BACKUP_META_KEY)!) as { lastBackupAt: string | null };

describe('BackupSection', () => {
  it('shows the description and "없음" when nothing was backed up', async () => {
    await open();
    expect(
      within(section()).getByText(
        '보관함(장소·라벨·여행)은 이 기기의 브라우저에만 저장돼요. 브라우저는 오래 쓰지 않은 사이트의 데이터를 지울 수 있어요(특히 아이폰 사파리). 가끔 백업 파일을 받아 두세요.',
      ),
    ).toBeInTheDocument();
    expect(statusLine()).toHaveTextContent('마지막 백업: 없음');
    expect(within(section()).getByRole('button', { name: '백업 파일로 되살리기' })).toBeEnabled();
  });

  it('shows the recorded time with days ago', async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      BACKUP_META_KEY,
      JSON.stringify({ lastBackupAt: THREE_DAYS_AGO, snoozedAt: null }),
    );
    await open(storage);
    expect(statusLine()).toHaveTextContent(
      `마지막 백업: ${formatLocalDateTime(THREE_DAYS_AGO)} (3일 전)`,
    );
  });

  it('says "오늘" for a backup from the same day', async () => {
    const storage = createMemoryStorage();
    storage.setItem(BACKUP_META_KEY, JSON.stringify({ lastBackupAt: NOW, snoozedAt: null }));
    await open(storage);
    expect(statusLine()).toHaveTextContent(`마지막 백업: ${formatLocalDateTime(NOW)} (오늘)`);
  });

  it('download hands the file text to downloadText, toasts and records the time', async () => {
    const user = userEvent.setup();
    const { storage } = await open();
    await user.click(saveButton());

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const [text, fileName, type] = downloadMock.mock.calls[0]! as [string, string, string];
    expect(fileName).toMatch(/^landmark-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(type).toBe('application/json');
    const read = readBackupText(text);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(Object.keys(read.backup.library.places)).toHaveLength(5);
      expect(read.backup.exportedAt).toBe(NOW);
    }
    expect(toastMock).toHaveBeenCalledWith('백업 파일을 만들었어요');
    await waitFor(() =>
      expect(statusLine()).toHaveTextContent(`${formatLocalDateTime(NOW)} (오늘)`),
    );
    await waitFor(() => expect(storedMeta(storage).lastBackupAt).toBe(NOW));
  });

  it('a fast double click downloads only once', async () => {
    const { storage } = await open();
    const button = saveButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(storedMeta(storage).lastBackupAt).toBe(NOW));
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('hides the share button when files cannot be shared', async () => {
    stubShare(() => Promise.resolve(), false);
    await open();
    expect(within(section()).queryByRole('button', { name: '백업 공유' })).not.toBeInTheDocument();
  });

  it('hides the share button when canShare is missing', async () => {
    await open();
    expect(within(section()).queryByRole('button', { name: '백업 공유' })).not.toBeInTheDocument();
  });

  it('closing the share sheet (AbortError) is not an error and records nothing', async () => {
    const user = userEvent.setup();
    const share = stubShare(() => Promise.reject(new DOMException('닫음', 'AbortError')));
    const { storage } = await open();
    await user.click(within(section()).getByRole('button', { name: '백업 공유' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(section()).getByRole('button', { name: '백업 공유' })).toBeEnabled(),
    );
    expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
    expect(statusLine()).toHaveTextContent('마지막 백업: 없음');
    expect(toastMock).not.toHaveBeenCalled();
    expect(storage.getItem(BACKUP_META_KEY)).toBeNull();
  });

  it('another share failure shows the alert and records nothing', async () => {
    const user = userEvent.setup();
    stubShare(() => Promise.reject(new Error('공유 실패')));
    const { storage } = await open();
    await user.click(within(section()).getByRole('button', { name: '백업 공유' }));
    expect(await within(section()).findByRole('alert')).toHaveTextContent(SHARE_FAILED);
    expect(statusLine()).toHaveTextContent('마지막 백업: 없음');
    expect(storage.getItem(BACKUP_META_KEY)).toBeNull();
  });

  it('a successful share sends a landmark-backup file, toasts and records the time', async () => {
    const user = userEvent.setup();
    const share = stubShare(() => Promise.resolve());
    const { storage } = await open();
    await user.click(within(section()).getByRole('button', { name: '백업 공유' }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const data = share.mock.calls[0]![0];
    expect(data.title).toBe('Landmark 백업');
    expect(data.files).toHaveLength(1);
    expect(data.files![0]!.name.startsWith('landmark-backup-')).toBe(true);
    expect(data.files![0]!.type).toBe('application/json');
    expect(readBackupText(await data.files![0]!.text()).ok).toBe(true);
    expect(toastMock).toHaveBeenCalledWith('백업 파일을 만들었어요');
    await waitFor(() => expect(storedMeta(storage).lastBackupAt).toBe(NOW));
    await act(async () => {});
    expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('백업 파일로 되살리기 opens the restore dialog with focus on 파일 고르기', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(within(section()).getByRole('button', { name: '백업 파일로 되살리기' }));
    // 처음에는 단위를 기다리는 틀이 같은 제목으로 먼저 보인다.
    const pickButton = await screen.findByRole('button', { name: '파일 고르기' });
    expect(screen.getByRole('dialog', { name: '백업에서 되살리기' })).toContainElement(pickButton);
    await waitFor(() => expect(pickButton).toHaveFocus());
  });

  it('a corrupt stored library shows the rebuild message and downloads nothing', async () => {
    const user = userEvent.setup();
    const { storage } = await open();
    // 화면을 연 뒤 다른 탭이 문서를 망가뜨린 상황.
    storage.setItem('tripmap:library:v2', '{broken');
    await user.click(saveButton());
    expect(await within(section()).findByRole('alert')).toHaveTextContent(
      '백업 파일을 만들지 못했어요. 새로고침해 주세요',
    );
    expect(downloadMock).not.toHaveBeenCalled();
    expect(statusLine()).toHaveTextContent('마지막 백업: 없음');
  });
});
