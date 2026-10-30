import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RestoreDialog, type RemoteRestoreSource } from 'src/sections/backup/RestoreDialog';
import { readBackupText } from 'src/domain/backup/read-backup';
import { buildBackupText } from 'src/domain/backup/build-backup';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { LIBRARY_KEY } from 'src/services/library-store';
import { BACKUP_META_KEY } from 'src/services/backup-meta-store';
import { emptyLibrary } from 'src/schema/library';
import { OFF_STATUS, syncStatusAtom } from 'src/stores/sync-status';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
import { makeLibrary, place } from '../../domain/backup/fixtures';
const boot = vi.hoisted(() => ({ enabled: false, runThen: vi.fn() }));
vi.mock('src/services/library-sync/boot', async (original) => ({
  ...(await original<typeof import('src/services/library-sync/boot')>()),
  readBootFlag: () => boot.enabled,
  loadSyncEngine: async () => ({ ensureLibrarySyncEngine: () => ({ runThen: boot.runThen }) }),
}));
const { download, replacing } = vi.hoisted(() => ({ download: vi.fn(), replacing: vi.fn() }));
vi.mock('src/lib/download-text', () => ({ downloadText: download }));
vi.mock('src/stores/backup-state', async (original) => {
  const actual = await original<typeof import('src/stores/backup-state')>();
  return {
    ...actual,
    useRestoreActions: () => {
      const actions = actual.useRestoreActions();
      return {
        ...actions,
        replace: (...args: Parameters<typeof actions.replace>) => {
          replacing(...args);
          return actions.replace(...args);
        },
      };
    },
  };
});
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
beforeEach(() => {
  download.mockReset();
  replacing.mockReset();
  boot.runThen.mockReset();
  boot.runThen.mockImplementation(async (_, after) => after({ ...OFF_STATUS, phase: 'synced' }));
});
afterEach(() => {
  boot.enabled = false;
  cleanup();
  setAppRuntimeForTest(null);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
const target = makeLibrary({ places: [place(1)] });
const read = readBackupText(
  buildBackupText({ rawLibrary: target, prefs: null, now: new Date('2026-10-29T00:00:00Z') }),
);
if (!read.ok) throw Error('시험 백업 오류');
const loaded = { ok: true as const, backup: read.backup, header: '서버 백업 · 시험 기기' };
async function setup(
  load = vi.fn().mockResolvedValue(loaded),
  live = true,
  syncNote = true,
  remote = true,
) {
  const { store, storage } = await renderLibrary(live ? sampleLibrary() : emptyLibrary(), {
    path: '/settings',
  });
  const source = (): RemoteRestoreSource => ({
    title: '서버 백업에서 되살리기',
    loadingText: '서버 백업을 받는 중…',
    load,
    syncNote,
  });
  const onClose = vi.fn();
  const ui = (open: boolean) => (
    <Provider store={store}>
      <RestoreDialog
        open={open}
        onClose={onClose}
        mode="normal"
        remote={remote ? source() : undefined}
      />
    </Provider>
  );
  const rendered = render(ui(true));
  return {
    store,
    storage,
    rerender: (open: boolean) => rendered.rerender(ui(open)),
    load,
    onClose,
  };
}
it('읽는 중과 머리 줄을 보이고 파일 선택은 숨긴다', async () => {
  let resolve!: (value: typeof loaded) => void;
  await setup(
    vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ),
  );
  expect(screen.getByText('서버 백업을 받는 중…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '파일 고르기' })).not.toBeInTheDocument();
  await act(async () => resolve(loaded));
  expect(await screen.findByText(loaded.header)).toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: '바꾸기 전에 지금 보관함을 파일로 받기' }),
  ).toBeChecked();
  expect(screen.getByText(/지금 보관함은 이 기기에 '되살리기 전 보관함'/)).toBeInTheDocument();
  expect(
    screen.getByText('이 백업 뒤에 만든 장소·여행은 동기화로 다시 들어와요.'),
  ).toBeInTheDocument();
});
it('실패 뒤 다시 받고 부모의 새 객체 때문에 중복으로 받지 않는다', async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, message: '받지 못했어요' })
    .mockResolvedValue(loaded);
  const h = await setup(load);
  expect(await screen.findByText('받지 못했어요')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText(loaded.header)).toBeInTheDocument();
  h.rerender(true);
  expect(load).toHaveBeenCalledTimes(2);
});
it('닫기 전의 느린 응답은 버린다', async () => {
  let resolve!: (value: typeof loaded) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ ...loaded, header: '새 응답' });
  const h = await setup(load);
  h.rerender(false);
  h.rerender(true);
  expect(await screen.findByText('새 응답')).toBeInTheDocument();
  await act(async () => resolve(loaded));
  expect(screen.queryByText(loaded.header)).not.toBeInTheDocument();
});
it('같은 클릭에서 파일을 먼저 받고 받은 원문으로 바꾸며 원격 시각은 기록하지 않는다', async () => {
  const h = await setup();
  await screen.findByText(loaded.header);
  const before = h.storage.getItem(LIBRARY_KEY);
  download.mockImplementation(() => {
    expect(h.storage.getItem(LIBRARY_KEY)).toBe(before);
    expect(replacing).not.toHaveBeenCalled();
  });
  await userEvent.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
  await waitFor(() => expect(replacing).toHaveBeenCalled());
  expect(download).toHaveBeenCalledOnce();
  expect(replacing).toHaveBeenCalledWith(expect.objectContaining({ exportedAt: null }), {
    requirePrevious: false,
    savedText: before,
  });
  expect(JSON.parse(h.storage.getItem(BACKUP_META_KEY)!).lastBackupAt).not.toBe(
    read.backup.exportedAt,
  );
});
it('파일 받기에 실패하면 바꾸지 않는다', async () => {
  await setup();
  await screen.findByText(loaded.header);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  download.mockImplementationOnce(() => {
    throw Error('받기 실패');
  });
  await userEvent.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
  expect(
    await screen.findByText(
      '지금 보관함을 파일로 받지 못했어요. 체크를 풀고 바꾸거나 다시 해 주세요',
    ),
  ).toBeInTheDocument();
  expect(replacing).not.toHaveBeenCalled();
});
it('체크를 풀면 기기 사본을 필수로 남긴다', async () => {
  await setup();
  await screen.findByText(loaded.header);
  await userEvent.click(
    screen.getByRole('checkbox', { name: '바꾸기 전에 지금 보관함을 파일로 받기' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
  await waitFor(() =>
    expect(replacing).toHaveBeenCalledWith(expect.anything(), { requirePrevious: true }),
  );
  expect(download).not.toHaveBeenCalled();
});
it('빈 보관함은 파일 체크가 없고 동기화 안내를 조건부로 보인다', async () => {
  await setup(undefined, false, false);
  await screen.findByText(loaded.header);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(
    screen.queryByText('이 백업 뒤에 만든 장소·여행은 동기화로 다시 들어와요.'),
  ).not.toBeInTheDocument();
});

it.each(['syncing', 'synced', 'error'] as const)(
  '동기화 켜짐: %s에서는 완료했을 때만 되살린다',
  async (phase) => {
    boot.enabled = true;
    const h = await setup();
    await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase }));
    await screen.findByText(loaded.header);
    const button = screen.getByRole('button', { name: '이 백업으로 바꾸기' });
    if (phase === 'synced') {
      expect(button).toBeEnabled();
      expect(screen.queryByText('동기화가 끝난 뒤 되살릴 수 있어요')).toBeNull();
    } else {
      expect(button).toBeDisabled();
      expect(
        screen.getByText(
          phase === 'syncing'
            ? '동기화가 끝난 뒤 되살릴 수 있어요'
            : '동기화 오류를 해결한 뒤 다시 시도해 주세요',
        ),
      ).toHaveAttribute('role', 'status');
    }
  },
);
it.each(['syncing', 'error'] as const)('동기화 꺼짐: %s여도 되살릴 수 있다', async (phase) => {
  const h = await setup();
  await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase }));
  await screen.findByText(loaded.header);
  expect(screen.getByRole('button', { name: '이 백업으로 바꾸기' })).toBeEnabled();
});
it('클릭 직전에 phase가 바뀌면 되살리지 않는다', async () => {
  boot.enabled = true;
  const h = await setup();
  await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
  await screen.findByText(loaded.header);
  const button = screen.getByRole('button', { name: '이 백업으로 바꾸기' });
  await act(async () => {
    h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'syncing' });
    button.click();
  });
  expect(replacing).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
});
it('파일 사본을 받는 동안 phase가 바뀌어도 되살리지 않는다', async () => {
  boot.enabled = true;
  const h = await setup();
  await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
  await screen.findByText(loaded.header);
  download.mockImplementationOnce(() =>
    h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'syncing' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
  expect(download).toHaveBeenCalledOnce();
  expect(replacing).not.toHaveBeenCalled();
});

it('최신 변경을 받는 동안 기다리고 파일 받기 → 받기 완료 → 바꾸기 순서를 지킨다', async () => {
  boot.enabled = true;
  const h = await setup();
  await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
  await screen.findByText(loaded.header);
  let finish!: () => void;
  const order: string[] = [];
  download.mockImplementationOnce(() => order.push('file'));
  boot.runThen.mockImplementationOnce(async (_, after) => {
    order.push('pull');
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    order.push('pulled');
    return after({ ...OFF_STATUS, phase: 'synced' });
  });
  replacing.mockImplementationOnce(() => order.push('replace'));
  await userEvent.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
  expect(order).toEqual(['file', 'pull']);
  expect(screen.getByText('서버의 최신 변경을 먼저 받는 중…')).toHaveAttribute('role', 'status');
  expect(screen.getByRole('button', { name: '이 백업으로 바꾸기' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '취소' })).toBeEnabled();
  await act(async () => finish());
  await waitFor(() => expect(order).toEqual(['file', 'pull', 'pulled', 'replace']));
});

it.each(['취소', 'Escape'] as const)(
  '최신 변경을 받는 중 %s로 닫으면 늦게 불린 after는 보관함을 바꾸지 않는다',
  async (action) => {
    boot.enabled = true;
    const h = await setup();
    h.onClose.mockImplementation(() => h.rerender(false));
    await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
    await screen.findByText(loaded.header);
    const before = h.storage.getItem(LIBRARY_KEY);
    let finish!: () => void;
    const afterCalled = vi.fn();
    boot.runThen.mockImplementationOnce(async (_, after) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      afterCalled();
      return after({ ...OFF_STATUS, phase: 'synced' });
    });
    await userEvent.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
    expect(screen.getByText('서버의 최신 변경을 먼저 받는 중…')).toBeInTheDocument();
    if (action === '취소') await userEvent.click(screen.getByRole('button', { name: '취소' }));
    else {
      screen.getByRole('button', { name: '취소' }).focus();
      await userEvent.keyboard('{Escape}');
    }
    expect(h.onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => finish());
    expect(afterCalled).toHaveBeenCalledOnce();
    expect(replacing).not.toHaveBeenCalled();
    expect(h.storage.getItem(LIBRARY_KEY)).toBe(before);
  },
);

it.each([
  { phase: 'local', offline: true, held: 0, message: '인터넷에 연결한 뒤 다시 시도해 주세요' },
  {
    phase: 'conflict',
    offline: false,
    held: 1,
    message: '받지 못한 서버 변경이 있어요. 설정 › 동기화를 확인해 주세요',
  },
  { phase: 'auth', offline: false, held: 0, message: '설정 › 동기화에서 다시 로그인해 주세요' },
  { phase: 'not-allowed', offline: false, held: 0, message: '이 계정은 동기화를 사용할 수 없어요' },
  {
    phase: 'unavailable',
    offline: false,
    held: 0,
    message: '서버 동기화를 사용할 수 없어요. 잠시 뒤 다시 시도해 주세요',
  },
  {
    phase: 'error',
    offline: false,
    held: 0,
    message: '동기화 오류를 해결한 뒤 다시 시도해 주세요',
  },
] as const)(
  '새 받기가 $phase 상태로 끝나면 바꾸지 않고 안내가 상태 회복 때 풀린다',
  async ({ message, ...patch }) => {
    boot.enabled = true;
    const h = await setup();
    await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
    await screen.findByText(loaded.header);
    boot.runThen.mockImplementationOnce(async (_, after) => {
      const status = { ...OFF_STATUS, ...patch };
      h.store.set(syncStatusAtom, status);
      return after(status);
    });
    await userEvent.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
    expect(replacing).not.toHaveBeenCalled();
    expect(screen.getByText(message)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: '이 백업으로 바꾸기' })).toBeDisabled();
    await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
    expect(screen.queryByText(message)).toBeNull();
    expect(screen.getByRole('button', { name: '이 백업으로 바꾸기' })).toBeEnabled();
  },
);

it.each([0, 1])('conflict의 보류가 %s개면 받기 완료 기준으로 허용한다', async (held) => {
  boot.enabled = true;
  const h = await setup();
  await act(async () =>
    h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'conflict', held, rejected: 1 }),
  );
  await screen.findByText(loaded.header);
  const button = screen.getByRole('button', { name: '이 백업으로 바꾸기' });
  if (held) {
    expect(button).toBeDisabled();
    expect(
      screen.getByText('받지 못한 서버 변경이 있어요. 설정 › 동기화를 확인해 주세요'),
    ).toHaveAttribute('role', 'status');
  } else {
    expect(button).toBeEnabled();
    boot.runThen.mockImplementationOnce(async (_, after) =>
      after({ ...OFF_STATUS, phase: 'conflict', held: 0, rejected: 1 }),
    );
    await userEvent.click(button);
    await waitFor(() => expect(replacing).toHaveBeenCalledOnce());
  }
});

it('동기화를 끈 기기는 받기를 실행하지 않고 바꾼다', async () => {
  await setup();
  await screen.findByText(loaded.header);
  await userEvent.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
  await waitFor(() => expect(replacing).toHaveBeenCalledOnce());
  expect(boot.runThen).not.toHaveBeenCalled();
});

it('파일 모드는 동기화가 켜지고 보류 중이어도 기존처럼 바꾼다', async () => {
  boot.enabled = true;
  const h = await setup(undefined, true, true, false);
  await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'conflict', held: 1 }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(
    input,
    new File(
      [buildBackupText({ rawLibrary: target, prefs: null, now: new Date() })],
      'backup.json',
      { type: 'application/json' },
    ),
  );
  await userEvent.click(await screen.findByRole('button', { name: '이 백업으로 바꾸기' }));
  await waitFor(() => expect(replacing).toHaveBeenCalledOnce());
  expect(boot.runThen).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  '받기 도중 다시 연 창에는 이전 실행의 진행 문구와 늦은 %s를 남기지 않는다',
  async (completion) => {
    boot.enabled = true;
    const h = await setup();
    await act(async () => h.store.set(syncStatusAtom, { ...OFF_STATUS, phase: 'synced' }));
    await screen.findByText(loaded.header);
    let finish!: () => void;
    boot.runThen.mockImplementationOnce(async (_, after) => {
      await new Promise<void>((resolve, reject) => {
        finish = () => (completion === 'resolve' ? resolve() : reject(Error('이전 받기 실패')));
      });
      return after({ ...OFF_STATUS, phase: 'synced' });
    });
    await userEvent.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
    expect(screen.getByText('서버의 최신 변경을 먼저 받는 중…')).toBeInTheDocument();
    h.rerender(false);
    h.rerender(true);
    await screen.findByText(loaded.header);
    expect(screen.queryByText('서버의 최신 변경을 먼저 받는 중…')).toBeNull();
    await act(async () => finish());
    expect(replacing).not.toHaveBeenCalled();
    expect(
      screen.queryByText('최신 변경을 받지 못했어요. 설정 › 동기화를 확인해 주세요'),
    ).toBeNull();
    expect(screen.getByRole('button', { name: '이 백업으로 바꾸기' })).toBeEnabled();
  },
);

it.each([
  ['auth', '설정 › 동기화에서 다시 로그인해 주세요'],
  ['not-allowed', '이 계정은 동기화를 사용할 수 없어요'],
  ['unavailable', '서버 동기화를 사용할 수 없어요. 잠시 뒤 다시 시도해 주세요'],
  ['error', '동기화 오류를 해결한 뒤 다시 시도해 주세요'],
] as const)('남은 오프라인·보류 값보다 %s 원인을 먼저 안내한다', async (phase, message) => {
  boot.enabled = true;
  const h = await setup();
  await act(async () =>
    h.store.set(syncStatusAtom, { ...OFF_STATUS, phase, offline: true, held: 1 }),
  );
  await screen.findByText(loaded.header);
  expect(screen.getByText(message)).toHaveAttribute('role', 'status');
  expect(screen.getByRole('button', { name: '이 백업으로 바꾸기' })).toBeDisabled();
});
