import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'jotai';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServerBackupSection } from 'src/sections/server-backup/ServerBackupSection';
import {
  readServerBackupLocal,
  EMPTY_SERVER_BACKUP_LOCAL,
  SERVER_BACKUP_KEY,
} from 'src/services/server-backup/storage';
import { newDeviceMeta, writeSyncMeta } from 'src/services/library-sync/storage';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
const mocks = vi.hoisted(() => ({
  api: { meta: vi.fn(), upload: vi.fn(), download: vi.fn(), remove: vi.fn() },
  session: vi.fn(),
  sync: vi.fn(),
  start: vi.fn(),
  build: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('src/services/library-sync/shared-api', () => ({
  getSharedSyncApi: () => ({}),
  getSharedSyncStorage: () => localStorage,
}));
vi.mock('src/services/server-backup/api', async (original) => ({
  ...(await original<typeof import('src/services/server-backup/api')>()),
  createBackupApi: () => mocks.api,
}));
vi.mock('src/services/server-backup/snapshot', async (original) => ({
  ...(await original<typeof import('src/services/server-backup/snapshot')>()),
  buildSnapshot: mocks.build,
}));
vi.mock('src/services/server-backup/boot', () => ({
  readAutoBackupFlag: () => false,
  loadAutoBackup: async () => ({
    startAutoBackup: mocks.start,
    autoBackupInterval: () => 86400000,
  }),
  loadServerBackupSection: async () => ({ ServerBackupSection }),
}));
vi.mock('src/services/library-sync/storage', async (original) => ({
  ...(await original<typeof import('src/services/library-sync/storage')>()),
  readSession: mocks.session,
}));
vi.mock('src/services/library-sync/boot', async (original) => ({
  ...(await original<typeof import('src/services/library-sync/boot')>()),
  readBootFlag: mocks.sync,
  loadSyncEngine: async () => ({
    ensureLibrarySyncEngine: () => ({ start() {}, schedule() {}, isOwnWrite: () => false }),
  }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(mocks.toast, { error: vi.fn() }) }));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
const meta = {
  id: '0123456789abcdef',
  createdAt: Date.now(),
  exportedAt: new Date().toISOString(),
  storedBytes: 10,
  rawBytes: 100,
  contentHash: 'abc',
  counts: { places: 5, labels: 3, trips: 0, meetings: 0 },
  deviceId: 'abcdefgh12345678',
  deviceLabel: '시험 기기',
  reason: 'manual',
};
beforeEach(() => {
  localStorage.clear();
  mocks.session.mockReturnValue({ provider: 'kakao', sessionId: '시험용' });
  mocks.sync.mockReturnValue(true);
  mocks.api.meta.mockResolvedValue({
    ok: true,
    data: { now: Date.now(), writable: true, maxStoredBytes: 1048576, backup: null },
  });
  mocks.api.upload.mockResolvedValue({ ok: true, data: { now: Date.now(), backup: meta } });
  mocks.api.remove.mockResolvedValue({ ok: true, data: null });
  mocks.build.mockResolvedValue({
    ok: true,
    snapshot: {
      data: 'H4sI',
      rawBytes: 100,
      storedBytes: 10,
      contentHash: 'abc',
      counts: meta.counts,
      exportedAt: meta.exportedAt,
    },
  });
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.clearAllMocks();
});
async function setup() {
  const { store } = await renderLibrary(sampleLibrary(), { path: '/settings' });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <ServerBackupSection />
      </MemoryRouter>
    </Provider>,
  );
  const region = screen.getByRole('region', { name: '서버 백업' });
  return Object.assign(() => within(region), { store });
}
it('빌드 변수가 없으면 설정 페이지에 구역이 없다', async () => {
  await renderLibrary(sampleLibrary(), { path: '/settings' });
  expect(screen.queryByRole('region', { name: '서버 백업' })).not.toBeInTheDocument();
});
it('로그인 전 안내를 보인다', async () => {
  mocks.session.mockReturnValue(null);
  const q = await setup();
  expect(q().getByText('로그인하면 서버에도 보관함 백업을 하나 둘 수 있어요')).toBeInTheDocument();
});
it('없을 때 되살리기는 꺼지고 지우기는 없다', async () => {
  const q = await setup();
  await q().findByText('서버 백업: 없음');
  expect(q().getByRole('button', { name: '서버 백업에서 되살리기' })).toBeDisabled();
  expect(q().queryByRole('button', { name: '서버 백업 지우기' })).not.toBeInTheDocument();
});
it('쓰기가 꺼져도 복원과 지우기는 남긴다', async () => {
  mocks.api.meta.mockResolvedValue({ ok: true, data: { writable: false, backup: meta } });
  const q = await setup();
  await q().findByText(/시험 기기/);
  expect(q().getByRole('button', { name: '서버 백업 지금 만들기' })).toBeDisabled();
  expect(q().getByRole('button', { name: '서버 백업에서 되살리기' })).toBeEnabled();
});
it('수동으로 올리고 기한과 줄을 갱신한다', async () => {
  const q = await setup();
  await q().findByText('서버 백업: 없음');
  await userEvent.click(q().getByRole('button', { name: '서버 백업 지금 만들기' }));
  await waitFor(() => expect(mocks.api.upload).toHaveBeenCalled());
  const body = mocks.api.upload.mock.calls[0]![0];
  expect(body.reason).toBe('manual');
  expect(body).not.toHaveProperty('ifMatch');
  expect(await q().findByText(/시험 기기/)).toBeInTheDocument();
  expect(readServerBackupLocal(localStorage).nextCheckAt).toBeGreaterThan(Date.now());
});
it('꺼진 동기화의 덮어쓰기를 확인하고 취소한다', async () => {
  mocks.sync.mockReturnValue(false);
  mocks.api.meta.mockResolvedValue({ ok: true, data: { writable: true, backup: meta } });
  const q = await setup();
  await q().findByText(/시험 기기/);
  await userEvent.click(q().getByRole('button', { name: '서버 백업 지금 만들기' }));
  const dialog = await screen.findByRole('dialog', { name: '서버 백업 바꾸기' });
  await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
  expect(mocks.api.upload).not.toHaveBeenCalled();
});
it('압축 실패를 알린다', async () => {
  mocks.build.mockResolvedValue({ ok: false, reason: 'too-large' });
  const q = await setup();
  await q().findByText('서버 백업: 없음');
  await userEvent.click(q().getByRole('button', { name: '서버 백업 지금 만들기' }));
  expect(await q().findByText(/보관함이 커서 서버 백업/)).toBeInTheDocument();
});
it('인증 오류에 로그인 단추를 보인다', async () => {
  mocks.api.meta.mockResolvedValue({ ok: false, reason: 'auth' });
  const q = await setup();
  expect(await q().findByRole('link', { name: '동기화에서 로그인' })).toBeInTheDocument();
});
it('백업 지우기를 확인하고 없음으로 갱신한다', async () => {
  mocks.api.meta.mockResolvedValue({ ok: true, data: { writable: true, backup: meta } });
  const q = await setup();
  await q().findByText(/시험 기기/);
  await userEvent.click(q().getByRole('button', { name: '서버 백업 지우기' }));
  await userEvent.click(
    within(await screen.findByRole('dialog', { name: '서버 백업 지우기' })).getByRole('button', {
      name: '지우기',
    }),
  );
  expect(await q().findByText('서버 백업: 없음')).toBeInTheDocument();
});
it('자동 백업을 켜고 실행기를 붙인다', async () => {
  const q = await setup();
  await q().findByText('서버 백업: 없음');
  await userEvent.click(q().getByRole('switch', { name: '자동 백업' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  expect(readServerBackupLocal(localStorage).auto).toBe(true);
});
it('자동 업로드가 끝나면 열린 설정의 서버 요약을 다시 읽는다', async () => {
  const q = await setup();
  await q().findByText('서버 백업: 없음');
  mocks.api.meta.mockResolvedValue({
    ok: true,
    data: { writable: true, backup: { ...meta, reason: 'auto' } },
  });
  const { writeServerBackupLocal } = await import('src/services/server-backup/storage');
  const { act } = await import('@testing-library/react');
  act(() =>
    writeServerBackupLocal(localStorage, {
      v: 1,
      auto: true,
      userId: null,
      nextCheckAt: null,
      last: { at: Date.now(), outcome: 'uploaded' },
    }),
  );
  expect(await q().findByText(/시험 기기 · 자동/)).toBeInTheDocument();
});
it('서버 백업 id로 원격 복원 창을 연다', async () => {
  mocks.api.meta.mockResolvedValue({ ok: true, data: { writable: true, backup: meta } });
  mocks.api.download.mockResolvedValue({ ok: false, reason: 'changed' });
  const q = await setup();
  await q().findByText(/시험 기기/);
  await userEvent.click(q().getByRole('button', { name: '서버 백업에서 되살리기' }));
  expect(await screen.findByRole('dialog', { name: '서버 백업에서 되살리기' })).toBeInTheDocument();
  await waitFor(() => expect(mocks.api.download).toHaveBeenCalledWith(meta.id));
  expect(
    await screen.findByText('서버 백업이 그사이 바뀌었어요. 창을 닫고 다시 열어 주세요'),
  ).toBeInTheDocument();
});

it('동기화를 끈 같은 설정 화면에서 자동 스위치를 끄고 덮어쓰기를 확인한다', async () => {
  mocks.api.meta.mockResolvedValue({ ok: true, data: { writable: true, backup: meta } });
  const q = await setup();
  await q().findByText(/시험 기기/);
  const { syncStatusAtom, OFF_STATUS } = await import('src/stores/sync-status');
  const { act } = await import('@testing-library/react');
  mocks.sync.mockReturnValue(false);
  act(() => q.store.set(syncStatusAtom, { ...OFF_STATUS }));
  expect(q().getByRole('switch', { name: '자동 백업' })).toBeDisabled();
  await userEvent.click(q().getByRole('button', { name: '서버 백업 지금 만들기' }));
  expect(await screen.findByRole('dialog', { name: '서버 백업 바꾸기' })).toBeInTheDocument();
  expect(mocks.api.upload).not.toHaveBeenCalled();
});
it('계정 전환 뒤 늦게 온 메타는 새 계정 화면에 보이지 않는다', async () => {
  let resolve!: (value: unknown) => void;
  mocks.api.meta.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const q = await setup();
  await waitFor(() => expect(mocks.api.meta).toHaveBeenCalledOnce());
  mocks.api.meta.mockResolvedValue({
    ok: true,
    data: { writable: true, backup: { ...meta, deviceLabel: '새 계정 기기' } },
  });
  mocks.session.mockReturnValue({ provider: 'kakao', sessionId: '다음 시험 세션' });
  const { act } = await import('@testing-library/react');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'tripmap:sync-session:v1' })));
  expect(await q().findByText(/새 계정 기기/)).toBeInTheDocument();
  await act(async () => resolve({ ok: true, data: { writable: true, backup: meta } }));
  expect(q().queryByText(/시험 기기/)).not.toBeInTheDocument();
});
it('계정 전환이 수동 압축 중 일어나면 이전 보관함을 올리지 않는다', async () => {
  const q = await setup();
  await q().findByText('서버 백업: 없음');
  mocks.build.mockImplementationOnce(async () => {
    mocks.session.mockReturnValue({ provider: 'kakao', sessionId: '다음 시험 세션' });
    return {
      ok: true,
      snapshot: {
        data: 'H4sI',
        rawBytes: 1,
        storedBytes: 3,
        contentHash: 'abc',
        counts: meta.counts,
        exportedAt: meta.exportedAt,
      },
    };
  });
  await userEvent.click(q().getByRole('button', { name: '서버 백업 지금 만들기' }));
  expect(mocks.api.upload).not.toHaveBeenCalled();
});
it('바뀐 서버 백업 창을 닫았다 다시 열면 최신 id를 받는다', async () => {
  mocks.api.meta.mockResolvedValue({ ok: true, data: { writable: true, backup: meta } });
  const q = await setup();
  await q().findByText(/시험 기기/);
  const next = { ...meta, id: 'fedcba9876543210', deviceLabel: '바뀐 기기' };
  mocks.api.meta.mockResolvedValue({ ok: true, data: { writable: true, backup: next } });
  mocks.api.download.mockResolvedValue({ ok: false, reason: 'changed' });
  await userEvent.click(q().getByRole('button', { name: '서버 백업에서 되살리기' }));
  await screen.findByText('서버 백업이 그사이 바뀌었어요. 창을 닫고 다시 열어 주세요');
  const dialog = screen.getByRole('dialog', { name: '서버 백업에서 되살리기' });
  await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
  await q().findByText(/바뀐 기기/);
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: '서버 백업에서 되살리기' }),
    ).not.toBeInTheDocument(),
  );
  await userEvent.click(q().getByRole('button', { name: '서버 백업에서 되살리기' }));
  await waitFor(() => expect(mocks.api.download).toHaveBeenLastCalledWith(next.id));
});

it('다른 계정에서 자동 백업을 켜면 앞 계정의 기한과 결과를 비운다', async () => {
  writeSyncMeta(localStorage, { ...newDeviceMeta(), userId: 'current' });
  localStorage.setItem(
    SERVER_BACKUP_KEY,
    JSON.stringify({
      ...EMPTY_SERVER_BACKUP_LOCAL,
      userId: 'previous',
      nextCheckAt: Date.now() + 86400000,
      last: { at: Date.now(), outcome: 'failed' },
    }),
  );
  const q = await setup();
  await q().findByText('서버 백업: 없음');
  await userEvent.click(q().getByRole('switch', { name: '자동 백업' }));
  expect(readServerBackupLocal(localStorage)).toMatchObject({
    auto: true,
    userId: 'current',
    nextCheckAt: null,
    last: null,
  });
});
it('자동 백업을 켤 때 화면을 연 뒤 바뀐 같은 계정의 최신 기록을 유지한다', async () => {
  writeSyncMeta(localStorage, { ...newDeviceMeta(), userId: 'current' });
  const q = await setup();
  await q().findByText('서버 백업: 없음');
  // 다른 탭의 기록이 아직 이 화면에 전달되지 않은 상태다.
  const latest = {
    ...EMPTY_SERVER_BACKUP_LOCAL,
    userId: 'current',
    nextCheckAt: Date.now() + 123456,
    last: { at: Date.now(), outcome: 'skipped-empty' as const },
  };
  localStorage.setItem(SERVER_BACKUP_KEY, JSON.stringify(latest));
  await userEvent.click(q().getByRole('switch', { name: '자동 백업' }));
  expect(readServerBackupLocal(localStorage)).toEqual({ ...latest, auto: true });
});
