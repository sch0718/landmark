import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBackupText } from 'src/domain/backup/build-backup';
import { readBackupText } from 'src/domain/backup/read-backup';
import { formatLocalDateTime } from 'src/domain/backup/summary';
import { DEFAULT_QUERY } from 'src/domain/library/query';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { loadRestoreDialog, PANEL_CHUNKS } from 'src/routes/lazy-routes';
import { RestoreDialog } from 'src/sections/backup/RestoreDialog';
import { DEFAULT_PREFS, type Prefs } from 'src/schema/prefs';
import { emptyLibrary, type Library } from 'src/schema/library';
import { BACKUP_META_KEY } from 'src/services/backup-meta-store';
import { LIBRARY_KEY, PREVIOUS_KEY } from 'src/services/library-store';
import { PREFS_KEY } from 'src/services/prefs-store';
import { label, makeLibrary, place, trip } from '../../domain/backup/fixtures';
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

afterEach(() => {
  cleanup();
  toastMock.mockClear();
  toastMock.error.mockClear();
  downloadMock.mockClear();
  setAppRuntimeForTest(null);
});

const EXPORTED_AT = '2026-10-15T01:00:00.000Z';
const FILE_COUNTS = '장소 30곳 · 라벨 6개 · 여행 2개';
const SAMPLE_COUNTS = '장소 5곳 · 라벨 3개 · 여행 0개';
const FILE_PREFS: Prefs = {
  ...structuredClone(DEFAULT_PREFS),
  theme: 'night',
  libraryView: 'list',
  query: { ...structuredClone(DEFAULT_QUERY), text: '강릉' },
};

const REPLACE_WARNING = '지금 보관함은 지워지고 이 백업 내용으로 바뀌어요.';
const PREFS_NOTE = '테마·보기 설정도 백업 때로 돌아가요. 보관함 필터는 풀어요.';
const UNKNOWN_WARNING =
  '이 백업에는 이 버전이 모르는 정보가 있어요. 되살리면 그 정보는 빠져요. 앱을 새로 고친 뒤 되살리는 것이 좋아요.';
const QUOTA_NOT_KEPT =
  "저장 공간이 부족해 지금 보관함을 기기에 남겨 둘 수 없어요. 먼저 '지금 보관함 먼저 받기'로 파일을 받은 뒤 바꿔 주세요";
const CHANGED = "그사이 보관함이 바뀌었어요. '지금 보관함 먼저 받기'로 다시 받은 뒤 바꿔 주세요";
const CORRUPT_CHANGED = "그사이 데이터가 바뀌었어요. '지금 원문 받기'로 다시 받아 주세요";
const CORRUPT_QUOTA =
  "저장 공간이 부족해 지금 데이터를 남겨 둘 수 없어요. 먼저 '백업 파일 받기'로 받아 주세요";
const RESTORED = `백업에서 되살렸어요 (${FILE_COUNTS})`;

/** 여행 2개·장소 30곳·라벨 6개. */
function fileLibrary(): Library {
  return makeLibrary({
    places: Array.from({ length: 30 }, (_, i) => place(i + 1)),
    labels: Array.from({ length: 6 }, (_, i) => label(i + 1)),
    trips: [trip(1, 1), trip(2, 2)],
  });
}

const backupFile = (library: unknown = fileLibrary(), prefs: Prefs | null = FILE_PREFS) =>
  new File(
    [buildBackupText({ rawLibrary: library, prefs, now: new Date(EXPORTED_AT) })],
    'landmark-backup-2026-10-15-1000.json',
    { type: 'application/json' },
  );

/** 사본 키 쓰기만 용량 초과로 실패하는 저장소. */
function overflowPreviousStorage(): Storage {
  const storage = createMemoryStorage();
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key: string, value: string) => {
    if (key === PREVIOUS_KEY) throw new DOMException('', 'QuotaExceededError');
    setItem(key, value);
  };
  return storage;
}

const storedLibrary = (storage: Storage) => JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;

const user = () => userEvent.setup({ applyAccept: false });

const openSettings = (library: Library = sampleLibrary(), storage?: Storage) =>
  renderLibrary(library, { path: '/settings', storage });
const section = () => screen.getByRole('region', { name: '백업' });
const dialog = () => screen.getByRole('dialog', { name: '백업에서 되살리기' });

/** 대화상자를 열고 단위가 와서 `파일 고르기`가 보일 때까지 기다린다(처음에는 기다림 틀이 먼저 보인다). */
async function openDialog(u: ReturnType<typeof user>) {
  await u.click(within(section()).getByRole('button', { name: '백업 파일로 되살리기' }));
  await screen.findByRole('button', { name: '파일 고르기' });
  return dialog();
}

const waitClosed = () =>
  waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '백업에서 되살리기' })).not.toBeInTheDocument(),
  );

async function pick(u: ReturnType<typeof user>, file: File) {
  await u.upload(within(dialog()).getByLabelText('백업 파일 선택'), file);
}

const replaceButton = () => within(dialog()).getByRole('button', { name: '이 백업으로 바꾸기' });
const downloadFirstButton = () =>
  within(dialog()).getByRole('button', { name: '지금 보관함 먼저 받기' });

/** 토스트 동작(`되돌리기`)이 붙은 호출의 동작. */
function toastAction(message: string) {
  const call = toastMock.mock.calls.find(([text]) => text === message);
  const options = call?.[1] as
    { action?: { label: string; onClick(): void }; duration?: number } | undefined;
  return options;
}

describe('RestoreDialog (설정)', () => {
  it('opens with focus on 파일 고르기; a share HTML file shows the share-file alert and allows picking again', async () => {
    const u = user();
    await openSettings();
    const d = await openDialog(u);
    expect(
      within(d).getByText(
        'Landmark 백업 파일(.json)을 고르세요. 손상 화면에서 받은 옛 백업 파일도 돼요.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(d).getByRole('button', { name: '파일 고르기' })).toHaveFocus(),
    );

    await pick(
      u,
      new File(['<!doctype html><html><body>공유</body></html>'], 'share.html', {
        type: 'text/html',
      }),
    );
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      "공유 파일이에요. 설정 › 가져오기의 '공유 파일 가져오기'로 넣어 주세요",
    );
    expect(within(dialog()).getByRole('button', { name: '파일 고르기' })).toBeEnabled();

    await pick(u, backupFile());
    expect(await within(dialog()).findByText(`백업 파일: ${FILE_COUNTS}`)).toBeInTheDocument();
  });

  it('previews a backup: header, two counts, warnings, prefs note; focus on 이 백업으로 바꾸기', async () => {
    const u = user();
    await openSettings();
    await openDialog(u);
    await pick(u, backupFile());
    const d = dialog();
    expect(
      await within(d).findByText(`${formatLocalDateTime(EXPORTED_AT)}에 만든 백업`),
    ).toBeInTheDocument();
    const items = within(within(d).getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      `백업 파일: ${FILE_COUNTS}`,
      `지금 보관함: ${SAMPLE_COUNTS}`,
    ]);
    expect(within(d).getByText(REPLACE_WARNING)).toHaveAttribute('role', 'alert');
    expect(within(d).getByText(PREFS_NOTE)).toBeInTheDocument();
    expect(within(d).queryByText(UNKNOWN_WARNING)).not.toBeInTheDocument();
    expect(within(d).getByRole('button', { name: '지금 보관함 먼저 받기' })).toBeEnabled();
    await waitFor(() => expect(replaceButton()).toHaveFocus());
  });

  it('a legacy raw library file has no date and no prefs note', async () => {
    const u = user();
    await openSettings();
    await openDialog(u);
    await pick(
      u,
      new File([JSON.stringify(fileLibrary())], 'landmark-backup.json', {
        type: 'application/json',
      }),
    );
    const d = dialog();
    expect(await within(d).findByText('만든 날짜를 모르는 옛 백업 파일')).toBeInTheDocument();
    expect(within(d).queryByText(PREFS_NOTE)).not.toBeInTheDocument();
  });

  it('a file with unknown fields shows the unknown-info warning', async () => {
    const u = user();
    await openSettings();
    await openDialog(u);
    const lib = fileLibrary() as unknown as { places: Record<string, Record<string, unknown>> };
    lib.places[place(1).id]!.futureField = { value: '2026-11-01', updatedAt: EXPORTED_AT };
    await pick(u, backupFile(lib));
    const warning = await within(dialog()).findByText(UNKNOWN_WARNING);
    expect(warning).toHaveAttribute('role', 'alert');
  });

  it('the same content as now disables replacing and focuses 취소', async () => {
    const u = user();
    await openSettings();
    await openDialog(u);
    await pick(u, backupFile(sampleLibrary()));
    expect(await within(dialog()).findByText('지금 보관함과 같은 내용이에요')).toBeInTheDocument();
    expect(replaceButton()).toBeDisabled();
    await waitFor(() =>
      expect(within(dialog()).getByRole('button', { name: '취소' })).toHaveFocus(),
    );
  });

  it('replaces: stored library, copy, toast with 되돌리기, prefs, last backup; undo restores', async () => {
    const u = user();
    const { storage } = await openSettings();
    await openDialog(u);
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));

    await waitClosed();
    expect(storedLibrary(storage)).toEqual(fileLibrary());
    expect(storage.getItem(PREVIOUS_KEY)).not.toBeNull();
    const options = toastAction(RESTORED);
    expect(options?.action?.label).toBe('되돌리기');
    expect(options?.duration).toBe(10_000);
    await waitFor(() => {
      const prefs = JSON.parse(storage.getItem(PREFS_KEY)!) as Prefs;
      expect(prefs.theme).toBe('night');
      expect(prefs.libraryView).toBe('list');
      expect(prefs.query).toEqual(DEFAULT_QUERY);
    });
    await waitFor(() =>
      expect(
        (JSON.parse(storage.getItem(BACKUP_META_KEY)!) as { lastBackupAt: string }).lastBackupAt,
      ).toBe(EXPORTED_AT),
    );

    await act(async () => options!.action!.onClick());
    await waitFor(() => expect(storedLibrary(storage)).toEqual(sampleLibrary()));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('되살리기 전으로 되돌렸어요'));
    expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
  });

  it('a full storage keeps the library and asks to download first; after downloading it replaces without undo', async () => {
    const u = user();
    const { storage } = await openSettings(sampleLibrary(), overflowPreviousStorage());
    await openDialog(u);
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));
    expect(await within(dialog()).findByText(QUOTA_NOT_KEPT)).toHaveAttribute('role', 'alert');
    expect(storedLibrary(storage)).toEqual(sampleLibrary());

    await u.click(downloadFirstButton());
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(dialog()).queryByText(QUOTA_NOT_KEPT)).toBeNull());
    await u.click(replaceButton());
    await waitFor(() => expect(storedLibrary(storage)).toEqual(fileLibrary()));
    expect(toastMock).toHaveBeenCalledWith(RESTORED);
    expect(toastAction(RESTORED)).toBeUndefined();
  });

  it('download first → another tab changes the library → copy fails: blocks until downloaded again', async () => {
    const u = user();
    const storage = overflowPreviousStorage();
    const two = makeLibrary({ places: [place(1), place(2)] });
    await openSettings(two, storage);
    await openDialog(u);
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '지금 보관함 먼저 받기' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));

    // 다른 탭이 장소를 하나 더했다(이 탭에는 이벤트가 오지 않는다).
    const otherTab = JSON.stringify(makeLibrary({ places: [place(1), place(2), place(3)] }));
    storage.setItem(LIBRARY_KEY, otherTab);

    await waitFor(() => expect(replaceButton()).toBeEnabled());
    await u.click(replaceButton());
    expect(await within(dialog()).findByText(CHANGED)).toHaveAttribute('role', 'alert');
    expect(storage.getItem(LIBRARY_KEY)).toBe(otherTab);

    // 다시 받지 않고 한 번 더 눌러도 같다.
    await u.click(replaceButton());
    await waitFor(() => expect(replaceButton()).toBeEnabled());
    expect(within(dialog()).getByText(CHANGED)).toBeInTheDocument();
    expect(storage.getItem(LIBRARY_KEY)).toBe(otherTab);

    await u.click(downloadFirstButton());
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(2));
    const second = readBackupText(downloadMock.mock.calls[1]![0] as string);
    expect(second.ok && Object.keys(second.backup.library.places)).toHaveLength(3);
    await waitFor(() => expect(replaceButton()).toBeEnabled());
    await u.click(replaceButton());
    await waitFor(() => expect(storedLibrary(storage)).toEqual(fileLibrary()));
    expect(toastMock).toHaveBeenCalledWith(RESTORED);
    expect(toastAction(RESTORED)).toBeUndefined();
  });

  it('opened empty, another tab adds places, copy fails: blocked with the changed message', async () => {
    const u = user();
    const storage = overflowPreviousStorage();
    await openSettings(emptyLibrary(), storage);
    await openDialog(u);
    await pick(u, backupFile());
    await within(dialog()).findByText(`백업 파일: ${FILE_COUNTS}`);
    const otherTab = JSON.stringify(makeLibrary({ places: [place(1), place(2)] }));
    storage.setItem(LIBRARY_KEY, otherTab);

    await u.click(replaceButton());
    expect(await within(dialog()).findByText(CHANGED)).toHaveAttribute('role', 'alert');
    expect(storage.getItem(LIBRARY_KEY)).toBe(otherTab);
  });

  it('an empty library has no download-first button and replaces at once', async () => {
    const u = user();
    const { storage } = await openSettings(emptyLibrary());
    await openDialog(u);
    await pick(u, backupFile());
    await within(dialog()).findByText(`백업 파일: ${FILE_COUNTS}`);
    expect(
      within(dialog()).queryByRole('button', { name: '지금 보관함 먼저 받기' }),
    ).not.toBeInTheDocument();
    await u.click(replaceButton());
    await waitFor(() => expect(storedLibrary(storage)).toEqual(fileLibrary()));
    expect(toastMock).toHaveBeenCalledWith(RESTORED);
    expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
  });

  it('closing and reopening resets to the pick step', async () => {
    const u = user();
    await openSettings();
    await openDialog(u);
    await pick(u, backupFile());
    await within(dialog()).findByText(`백업 파일: ${FILE_COUNTS}`);
    await u.click(within(dialog()).getByRole('button', { name: '취소' }));
    await waitClosed();
    const d = await openDialog(u);
    expect(within(d).getByRole('button', { name: '파일 고르기' })).toBeInTheDocument();
    expect(within(d).queryByText(`백업 파일: ${FILE_COUNTS}`)).not.toBeInTheDocument();
  });
});

describe('BackupSection 되살리기 전 사본 줄', () => {
  const COPY_LINE = new RegExp(
    `^되살리기 전 보관함이 남아 있어요 \\(\\d{4}\\.\\d{2}\\.\\d{2} \\d{2}:\\d{2} · ${SAMPLE_COUNTS}\\)$`,
  );

  async function restoreOnce() {
    const u = user();
    const rendered = await openSettings();
    await openDialog(u);
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));
    await waitClosed();
    expect(await within(section()).findByText(COPY_LINE)).toBeInTheDocument();
    return { u, ...rendered };
  }

  it('지우기 removes only the copy', async () => {
    const { u, storage } = await restoreOnce();
    await u.click(within(section()).getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(within(section()).queryByText(COPY_LINE)).toBeNull());
    expect(toastMock).toHaveBeenCalledWith('되살리기 전 보관함을 지웠어요');
    expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
    expect(storedLibrary(storage)).toEqual(fileLibrary());
  });

  it('되살리기 전으로 되돌리기 brings back the original library', async () => {
    const { u, storage } = await restoreOnce();
    await u.click(within(section()).getByRole('button', { name: '되살리기 전으로 되돌리기' }));
    await waitFor(() => expect(storedLibrary(storage)).toEqual(sampleLibrary()));
    await waitFor(() => expect(within(section()).queryByText(COPY_LINE)).toBeNull());
    expect(toastMock).toHaveBeenCalledWith('되살리기 전으로 되돌렸어요');
  });
});

describe('RestoreDialog (손상 화면)', () => {
  const C1 = '{broken-1';
  const C2 = '{broken-2';

  /** 손상 백업 키 쓰기만 용량 초과로 실패하는 저장소. */
  function overflowCorruptStorage(): Storage {
    const storage = createMemoryStorage();
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      if (key.startsWith('tripmap:library:v2:corrupt-')) {
        throw new DOMException('', 'QuotaExceededError');
      }
      setItem(key, value);
    };
    return storage;
  }

  /** 앱으로 런타임을 깐 뒤, 저장소를 손상 원문으로 바꾸고 손상 모드 대화상자를 따로 그린다. */
  async function renderCorrupt(props: {
    savedText?: string;
    onDownloadCurrent?(): Promise<string | null>;
  }) {
    const storage = overflowCorruptStorage();
    const { store } = await renderLibrary(sampleLibrary(), { path: '/settings', storage });
    storage.setItem(LIBRARY_KEY, C2);
    const onRestored = vi.fn();
    const onClose = vi.fn();
    const ui = (savedText: string | undefined) => (
      <Provider store={store}>
        <RestoreDialog
          open
          onClose={onClose}
          mode="corrupt"
          savedText={savedText}
          onDownloadCurrent={props.onDownloadCurrent}
          onRestored={onRestored}
        />
      </Provider>
    );
    const rendered = render(ui(props.savedText));
    return { storage, onRestored, onClose, rerender: (s?: string) => rendered.rerender(ui(s)) };
  }

  it('shows 읽지 못함 and no download-first button', async () => {
    const u = user();
    await renderCorrupt({ savedText: C2 });
    await pick(u, backupFile());
    expect(await within(dialog()).findByText('지금 보관함: 읽지 못함')).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('button', { name: '지금 보관함 먼저 받기' }),
    ).not.toBeInTheDocument();
  });

  it('without a downloaded raw text and no room for the corrupt backup: the corrupt quota message', async () => {
    const u = user();
    const { storage } = await renderCorrupt({ onDownloadCurrent: vi.fn() });
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));
    expect(await within(dialog()).findByText(CORRUPT_QUOTA)).toHaveAttribute('role', 'alert');
    expect(within(dialog()).queryByRole('button', { name: '지금 원문 받기' })).toBeNull();
    expect(storage.getItem(LIBRARY_KEY)).toBe(C2);
  });

  it('raw text changed since downloading: 지금 원문 받기 takes the new raw text and then replaces', async () => {
    const u = user();
    const onDownloadCurrent = vi.fn(() => Promise.resolve(C2));
    const { storage, onRestored, onClose } = await renderCorrupt({
      savedText: C1,
      onDownloadCurrent,
    });
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));
    expect(await within(dialog()).findByText(CORRUPT_CHANGED)).toHaveAttribute('role', 'alert');
    expect(storage.getItem(LIBRARY_KEY)).toBe(C2);

    const again = within(dialog()).getByRole('button', { name: '지금 원문 받기' });
    await u.click(again);
    expect(onDownloadCurrent).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(dialog()).queryByText(CORRUPT_CHANGED)).toBeNull());

    await u.click(replaceButton());
    await waitFor(() => expect(storedLibrary(storage)).toEqual(fileLibrary()));
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(RESTORED);
    expect(toastAction(RESTORED)).toBeUndefined();
  });

  it('지금 원문 받기 that finds nothing shows the message inside the dialog alert and keeps focus on a visible control', async () => {
    const u = user();
    await renderCorrupt({ savedText: C1, onDownloadCurrent: vi.fn(() => Promise.resolve(null)) });
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));
    expect(await within(dialog()).findByText(CORRUPT_CHANGED)).toBeInTheDocument();
    await u.click(within(dialog()).getByRole('button', { name: '지금 원문 받기' }));
    const alert = await within(dialog()).findByText('백업할 데이터를 찾지 못했어요');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(within(dialog()).queryByText(CORRUPT_CHANGED)).toBeNull();
    // 다시 눌러 볼 수 있게 버튼은 남고, 포커스는 보이는 버튼에 있다.
    const again = within(dialog()).getByRole('button', { name: '지금 원문 받기' });
    await waitFor(() => expect(again).toHaveFocus());
  });

  it('after a successful 지금 원문 받기 the focus moves to 이 백업으로 바꾸기', async () => {
    const u = user();
    await renderCorrupt({ savedText: C1, onDownloadCurrent: vi.fn(() => Promise.resolve(C2)) });
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));
    await u.click(await within(dialog()).findByRole('button', { name: '지금 원문 받기' }));
    await waitFor(() => expect(within(dialog()).queryByText(CORRUPT_CHANGED)).toBeNull());
    await waitFor(() => expect(replaceButton()).toHaveFocus());
  });

  it('after a failed replace the focus moves to the alert button 지금 원문 받기', async () => {
    const u = user();
    await renderCorrupt({ savedText: C1, onDownloadCurrent: vi.fn() });
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));
    await within(dialog()).findByText(CORRUPT_CHANGED);
    await waitFor(() =>
      expect(within(dialog()).getByRole('button', { name: '지금 원문 받기' })).toHaveFocus(),
    );
  });

  it('a failed replace without a download-current button focuses 이 백업으로 바꾸기', async () => {
    const u = user();
    await renderCorrupt({ onDownloadCurrent: vi.fn() });
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));
    await within(dialog()).findByText(CORRUPT_QUOTA);
    await waitFor(() => expect(replaceButton()).toHaveFocus());
  });

  it('a new savedText prop re-seeds the dialog', async () => {
    const u = user();
    const { storage, rerender } = await renderCorrupt({
      savedText: C1,
      onDownloadCurrent: vi.fn(() => Promise.resolve(null)),
    });
    await pick(u, backupFile());
    await u.click(await within(dialog()).findByRole('button', { name: '이 백업으로 바꾸기' }));
    expect(await within(dialog()).findByText(CORRUPT_CHANGED)).toBeInTheDocument();
    rerender(C2);
    await u.click(replaceButton());
    await waitFor(() => expect(storedLibrary(storage)).toEqual(fileLibrary()));
  });
});

describe('RestoreDialog 단위 나누기', () => {
  it('is prefetched with the panel chunks', () => {
    expect(PANEL_CHUNKS).toContain(loadRestoreDialog);
  });
});
