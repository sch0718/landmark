import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import { RestoreDialog, type RemoteRestoreSource } from 'src/sections/backup/RestoreDialog';
import { readBackupText } from 'src/domain/backup/read-backup';
import { buildBackupText } from 'src/domain/backup/build-backup';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { LIBRARY_KEY } from 'src/services/library-store';
import { BACKUP_META_KEY } from 'src/services/backup-meta-store';
import { emptyLibrary } from 'src/schema/library';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
import { makeLibrary, place } from '../../domain/backup/fixtures';
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
afterEach(() => {
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
async function setup(load = vi.fn().mockResolvedValue(loaded), live = true, syncNote = true) {
  const { store, storage } = await renderLibrary(live ? sampleLibrary() : emptyLibrary(), {
    path: '/settings',
  });
  const source = (): RemoteRestoreSource => ({
    title: '서버 백업에서 되살리기',
    loadingText: '서버 백업을 받는 중…',
    load,
    syncNote,
  });
  const ui = (open: boolean) => (
    <Provider store={store}>
      <RestoreDialog open={open} onClose={vi.fn()} mode="normal" remote={source()} />
    </Provider>
  );
  const rendered = render(ui(true));
  return { storage, rerender: (open: boolean) => rendered.rerender(ui(open)), load };
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
