import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackupText } from 'src/domain/backup/build-backup';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { CorruptScreen } from 'src/sections/shell/CorruptScreen';
import { LibraryCorrupt } from 'src/services/errors';
import { emptyLibrary } from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
import { label, makeLibrary, place, trip } from '../../domain/backup/fixtures';
import { mockViewport, renderApp } from './harness';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

const RAW = '{"version":99,"places":"망가짐"}';
const BACKUP_KEY = 'tripmap:library:v2:corrupt-2026-10-09T00:00:00.000Z';

let blobs: Blob[];
let downloads: { name: string; href: string; connected: boolean }[];

beforeEach(() => {
  blobs = [];
  downloads = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:tripmap-test';
  });
  URL.revokeObjectURL = vi.fn();
  // jsdom은 링크 이동을 구현하지 않는다. 누른 링크만 기록한다.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, href: this.href, connected: this.isConnected });
  });
});

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

describe('CorruptScreen', () => {
  it('downloads the backup copy as landmark-backup-<ISO>.json', async () => {
    localStorage.setItem(BACKUP_KEY, RAW);
    localStorage.setItem(LIBRARY_KEY, 'LIBRARY와 다른 내용');
    render(
      <CorruptScreen
        error={new LibraryCorrupt({ backupKey: BACKUP_KEY, issues: [] })}
        onRecovered={vi.fn()}
      />,
    );
    expect(screen.getByText('데이터를 읽지 못했어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '백업 파일 받기' }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toMatch(/^landmark-backup-\d{4}-\d{2}-\d{2}T[\d:.]+Z\.json$/);
    expect(await readBlob(blobs[0]!)).toBe(RAW);
  });

  it('clicks an attached link and revokes the object URL only after a delay', () => {
    vi.useFakeTimers();
    localStorage.setItem(LIBRARY_KEY, RAW);
    render(
      <CorruptScreen
        error={new LibraryCorrupt({ backupKey: null, issues: [] })}
        onRecovered={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '백업 파일 받기' }));

    expect(downloads).toHaveLength(1);
    // WebKit은 문서에 붙지 않은 링크 클릭이나 바로 해제한 주소로는 내려받지 못한다.
    expect(downloads[0]!.connected).toBe(true);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:tripmap-test');
  });

  it('downloads the stored raw text when there is no backup key', async () => {
    localStorage.setItem(LIBRARY_KEY, RAW);
    render(
      <CorruptScreen
        error={new LibraryCorrupt({ backupKey: null, issues: [] })}
        onRecovered={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '백업 파일 받기' }));
    expect(await readBlob(blobs[0]!)).toBe(RAW);
  });

  it('says so instead of downloading an empty file when nothing can be read', async () => {
    render(
      <CorruptScreen
        error={new LibraryCorrupt({ backupKey: null, issues: [] })}
        onRecovered={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '백업 파일 받기' }));
    expect(downloads).toHaveLength(0);
    expect(screen.getByText('백업할 데이터를 찾지 못했어요')).toBeInTheDocument();
  });
});

describe('corrupt screen offers backup download and reset', () => {
  it('shows the corrupt screen for a broken document and returns to the library after reset', async () => {
    mockViewport(390);
    localStorage.setItem(LIBRARY_KEY, RAW);
    await renderApp({ storage: localStorage });

    expect(await screen.findByText('데이터를 읽지 못했어요')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    // 불러오면서 원문을 백업 키에 남겼다. 아직 덮어쓰지 않았다.
    expect(localStorage.getItem(LIBRARY_KEY)).toBe(RAW);
    const backupKey = Object.keys(localStorage).find((key) =>
      key.startsWith(`${LIBRARY_KEY}:corrupt-`),
    );
    expect(backupKey).toBeDefined();
    expect(localStorage.getItem(backupKey!)).toBe(RAW);

    await userEvent.click(screen.getByRole('button', { name: '백업 파일 받기' }));
    expect(await readBlob(blobs[0]!)).toBe(RAW);
    expect(localStorage.getItem(LIBRARY_KEY)).toBe(RAW);

    await userEvent.click(screen.getByRole('button', { name: '새로 시작' }));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    });
    expect(screen.queryByText('데이터를 읽지 못했어요')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)!)).not.toEqual(JSON.parse(RAW));
    expect(localStorage.getItem(backupKey!)).toBe(RAW);
  });

  it('goes straight to the library when another tab already recovered the document', async () => {
    mockViewport(390);
    localStorage.setItem(LIBRARY_KEY, RAW);
    await renderApp({ storage: localStorage });
    expect(await screen.findByText('데이터를 읽지 못했어요')).toBeInTheDocument();

    // 이 화면이 떠 있는 사이 다른 탭이 이미 복구했다.
    const recovered = JSON.stringify(emptyLibrary());
    localStorage.setItem(LIBRARY_KEY, recovered);
    await userEvent.click(screen.getByRole('button', { name: '새로 시작' }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    });
    // 정상 문서는 덮어쓰지 않는다.
    expect(localStorage.getItem(LIBRARY_KEY)).toBe(recovered);
  });
});

describe('corrupt screen restores from a backup file', () => {
  const T0 = '{broken-T0';
  const T1 = '{broken-T1';
  const CORRUPT_PREFIX = `${LIBRARY_KEY}:corrupt-`;
  const CHANGED = "그사이 데이터가 바뀌었어요. '지금 원문 받기'로 다시 받아 주세요";
  const QUOTA =
    "저장 공간이 부족해 지금 데이터를 남겨 둘 수 없어요. 먼저 '백업 파일 받기'로 받아 주세요";

  const fileLibrary = () =>
    makeLibrary({
      places: Array.from({ length: 3 }, (_, i) => place(i + 1)),
      labels: [label(1)],
      trips: [trip(1, 1)],
    });
  const backupFile = () =>
    new File(
      [
        buildBackupText({
          rawLibrary: fileLibrary(),
          prefs: null,
          now: new Date('2026-10-15T01:00:00.000Z'),
        }),
      ],
      'landmark-backup-2026-10-15-1000.json',
      { type: 'application/json' },
    );
  const user = () => userEvent.setup({ applyAccept: false });
  const dialog = () => screen.getByRole('dialog', { name: '백업에서 되살리기' });
  const corruptCopies = (storage: Storage) =>
    Object.keys(storage)
      .filter((key) => key.startsWith(CORRUPT_PREFIX))
      .map((key) => storage.getItem(key));

  /**
   * `localStorage`에서 `blocked()`가 참인 동안 손상 사본 키 쓰기가 용량 초과로 실패하게 한다(그 밖의 쓰기는 그대로).
   * 손상 화면이 원문을 읽는 곳(`browserStorage()`)과 앱이 쓰는 저장소가 같은 `localStorage`여야 받기를 볼 수 있다.
   */
  function storageBlocking(blocked: () => boolean): Storage {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (blocked() && key.startsWith(CORRUPT_PREFIX)) {
        throw new DOMException('', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    });
    return localStorage;
  }

  async function openDialog(u: ReturnType<typeof user>) {
    await u.click(screen.getByRole('button', { name: '백업 파일로 되살리기' }));
    await screen.findByRole('button', { name: '파일 고르기' });
  }
  async function pick(u: ReturnType<typeof user>) {
    await u.upload(within(dialog()).getByLabelText('백업 파일 선택'), backupFile());
  }
  const replaceButton = () => within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' });

  const lastDownloadText = () => readBlob(blobs.at(-1)!);

  it('orders the buttons: 백업 파일 받기, 백업 파일로 되살리기, 새로 시작', async () => {
    mockViewport(390);
    localStorage.setItem(LIBRARY_KEY, RAW);
    await renderApp({ storage: localStorage });
    await screen.findByText('데이터를 읽지 못했어요');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '백업 파일 받기',
      '백업 파일로 되살리기',
      '새로 시작',
    ]);
  });

  it('restores without downloading first and keeps the corrupt raw text', async () => {
    mockViewport(390);
    const u = user();
    localStorage.setItem(LIBRARY_KEY, RAW);
    await renderApp({ storage: localStorage });
    await screen.findByText('데이터를 읽지 못했어요');

    await openDialog(u);
    await pick(u);
    expect(await within(dialog()).findByText('지금 보관함: 읽지 못함')).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('button', { name: '지금 보관함 먼저 받기' }),
    ).not.toBeInTheDocument();
    await u.click(await replaceButton());

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    });
    expect(screen.queryByText('데이터를 읽지 못했어요')).not.toBeInTheDocument();
    expect(corruptCopies(localStorage)).toContain(RAW);
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)!)).toEqual(fileLibrary());
  });

  it('with no room for the corrupt copy and no download: the quota message, raw text untouched', async () => {
    mockViewport(390);
    const u = user();
    const storage = storageBlocking(() => true);
    storage.setItem(LIBRARY_KEY, RAW);
    await renderApp({ storage });
    await screen.findByText('데이터를 읽지 못했어요');

    await openDialog(u);
    await pick(u);
    await u.click(await replaceButton());
    expect(await within(dialog()).findByText(QUOTA)).toHaveAttribute('role', 'alert');
    expect(storage.getItem(LIBRARY_KEY)).toBe(RAW);
    expect(within(dialog()).queryByRole('button', { name: '지금 원문 받기' })).toBeNull();
  });

  it('after 백업 파일 받기 the same full storage can be replaced', async () => {
    mockViewport(390);
    const u = user();
    const storage = storageBlocking(() => true);
    storage.setItem(LIBRARY_KEY, RAW);
    await renderApp({ storage });
    await screen.findByText('데이터를 읽지 못했어요');

    await u.click(screen.getByRole('button', { name: '백업 파일 받기' }));
    expect(await lastDownloadText()).toBe(RAW);
    await openDialog(u);
    await pick(u);
    await u.click(await replaceButton());

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    });
    expect(JSON.parse(storage.getItem(LIBRARY_KEY)!)).toEqual(fileLibrary());
  });

  it('raw text changed after 백업 파일 받기: blocked until 지금 원문 받기 takes the current raw text', async () => {
    mockViewport(390);
    const u = user();
    let blocked = false;
    const storage = storageBlocking(() => blocked);
    storage.setItem(LIBRARY_KEY, T0);
    await renderApp({ storage });
    await screen.findByText('데이터를 읽지 못했어요');
    // 불러올 때 손상 사본에 T0가 남았다. 이제 사본을 더 못 남기고, 다른 탭이 원문을 T1으로 바꾼다.
    blocked = true;

    await u.click(screen.getByRole('button', { name: '백업 파일 받기' }));
    expect(await lastDownloadText()).toBe(T0);
    storage.setItem(LIBRARY_KEY, T1);

    await openDialog(u);
    await pick(u);
    await u.click(await replaceButton());
    expect(await within(dialog()).findByText(CHANGED)).toHaveAttribute('role', 'alert');
    expect(storage.getItem(LIBRARY_KEY)).toBe(T1);
    expect(within(dialog()).getByRole('button', { name: '지금 원문 받기' })).toBeInTheDocument();

    // 닫고 `백업 파일 받기`를 다시 눌러도 손상 사본의 옛 원문 T0만 받는다: 여전히 막힌다.
    await u.click(within(dialog()).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await u.click(screen.getByRole('button', { name: '백업 파일 받기' }));
    expect(await lastDownloadText()).toBe(T0);
    await openDialog(u);
    await pick(u);
    await u.click(await replaceButton());
    expect(await within(dialog()).findByText(CHANGED)).toBeInTheDocument();
    expect(storage.getItem(LIBRARY_KEY)).toBe(T1);

    // `지금 원문 받기`는 사본이 아니라 지금 원문(T1)을 받고, 그 뒤에는 바뀐다.
    const before = blobs.length;
    await u.click(within(dialog()).getByRole('button', { name: '지금 원문 받기' }));
    await waitFor(() => expect(blobs).toHaveLength(before + 1));
    expect(await lastDownloadText()).toBe(T1);
    expect(downloads.at(-1)!.name).toMatch(/^landmark-backup-\d{4}-\d{2}-\d{2}T[\d:.]+Z\.json$/);
    await waitFor(() => expect(within(dialog()).queryByText(CHANGED)).toBeNull());
    await u.click(await replaceButton());

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    });
    expect(JSON.parse(storage.getItem(LIBRARY_KEY)!)).toEqual(fileLibrary());
  });
});
