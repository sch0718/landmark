import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SyncSection from 'src/sections/library-sync/SyncSection';
import { SyncConnectDialog } from 'src/sections/library-sync/SyncConnectDialog';
import { SyncConflictsDialog } from 'src/sections/library-sync/SyncConflictsDialog';
import { SyncDeleteDialog } from 'src/sections/library-sync/SyncDeleteDialog';
import { SyncDevices } from 'src/sections/library-sync/SyncDevices';
import { libraryAtom } from 'src/stores/library-state';
import { OFF_STATUS, syncStatusAtom } from 'src/stores/sync-status';
import {
  newDeviceMeta,
  writeSyncMeta,
  writeSession,
  writeConflicts,
} from 'src/services/library-sync/storage';
import { emptyLibrary } from 'src/schema/library';
import { place } from '../../domain/backup/fixtures';
import { buildMeeting } from '../../../fixtures/builders';
const mock = vi.hoisted(() => ({
  status: vi.fn(),
  me: vi.fn(),
  list: vi.fn(),
  revoke: vi.fn(),
  connect: vi.fn(),
  resolve: vi.fn(),
  remove: vi.fn(),
  providers: { google: false, kakao: true, naver: false },
}));
vi.mock('src/services/library-sync/config', () => ({
  readSyncClientConfig: () => ({
    apiBase: 'http://localhost/api/sync',
    firebase: null,
    kakao: { clientId: 'public' },
    naver: null,
    devFake: false,
  }),
}));
vi.mock('src/services/library-sync/api', () => ({
  googleAuth: () => null,
  createSyncApi: () => ({
    status: mock.status,
    me: mock.me,
    client: { listSessions: mock.list, revokeSession: mock.revoke },
  }),
}));
vi.mock('src/services/library-sync/boot', () => ({
  readBootFlag: () => false,
  syncFeatureVisible: () => false,
  loadSyncSection: async () => ({ default: () => null }),
  loadSyncEngine: async () => ({
    ensureLibrarySyncEngine: () => ({
      connect: mock.connect,
      resolveConflict: mock.resolve,
      deleteServerData: mock.remove,
      disconnect: vi.fn(),
      start: vi.fn(),
    }),
  }),
}));
vi.mock('src/sections/backup/use-backup-file', () => ({
  useBackupFile: () => ({ save: vi.fn(), busy: false }),
}));
beforeEach(() => {
  localStorage.clear();
  mock.providers.kakao = true;
  mock.status.mockImplementation(async () => ({
    ok: true,
    data: { enabled: true, providers: mock.providers },
  }));
  mock.me.mockResolvedValue({ ok: true, data: { library: { live: 0 }, devices: [] } });
  mock.list.mockResolvedValue({ ok: true, data: { sessions: [] } });
  mock.connect.mockResolvedValue({ ...OFF_STATUS, phase: 'synced' });
  mock.remove.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const show = (ui: React.ReactNode, withPlace = false) => {
  const store = createStore();
  if (withPlace) store.set(libraryAtom, { ...emptyLibrary(), places: { [place(1).id]: place(1) } });
  return { ...render(<Provider store={store}>{ui}</Provider>), store };
};
it('설정과 서버 양쪽이 켠 공급자만 보이고 저장 안내를 보인다', async () => {
  show(<SyncSection />);
  expect(await screen.findByRole('button', { name: '카카오로 로그인' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Google로 로그인' })).toBeNull();
  expect(screen.getByText(/암호화하지 않고/)).toBeInTheDocument();
});
it('서버가 공급자를 끄면 버튼을 숨긴다', async () => {
  mock.providers.kakao = false;
  show(<SyncSection />);
  await waitFor(() => expect(mock.status).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: '카카오로 로그인' })).toBeNull();
});
it.each(['upload', 'receive', 'merge', 'replace-local'] as const)(
  '연결 방식 %s를 엔진으로 전달한다',
  async (mode) => {
    mock.me.mockResolvedValue({
      ok: true,
      data: { library: { live: mode === 'upload' ? 0 : 3 }, devices: [] },
    });
    const user = userEvent.setup();
    show(<SyncConnectDialog open onClose={() => {}} />, mode !== 'receive');
    if (mode === 'merge' || mode === 'replace-local') {
      await user.click(
        await screen.findByLabelText(mode === 'merge' ? '합치기(권장)' : '서버 보관함으로 바꾸기'),
      );
      await user.click(screen.getByRole('button', { name: '계속' }));
    } else
      await user.click(
        await screen.findByRole('button', {
          name: mode === 'upload' ? '올리기' : '서버 보관함 받기',
        }),
      );
    await waitFor(() =>
      expect(mock.connect).toHaveBeenCalledWith(mode === 'receive' ? 'merge' : mode),
    );
  },
);
it('상태 atom과 충돌 복원 단추를 연결한다', async () => {
  writeSyncMeta(localStorage, {
    ...newDeviceMeta(),
    enabled: true,
    userId: 'u',
    provider: 'kakao',
    accountLabel: '카카오 계정',
  });
  writeSession(localStorage, { v: 1, sessionId: 'a'.repeat(43), provider: 'kakao' });
  const { store } = show(<SyncSection />);
  for (const [phase, text] of [
    ['local', '이 기기에 저장됨'],
    ['syncing', '동기화 중'],
    ['synced', '동기화 완료'],
    ['conflict', '확인 필요한 충돌'],
  ] as const) {
    act(() => store.set(syncStatusAtom, { ...OFF_STATUS, phase }));
    expect(screen.getByText(text)).toBeInTheDocument();
  }
});
it('충돌에서 내 값 복원을 요청한다', async () => {
  writeConflicts(localStorage, [
    {
      id: 'c',
      key: 'place:place00001',
      kind: 'place',
      label: '장소',
      path: 'memo',
      mine: '내 메모',
      theirs: '남은 메모',
      at: '2026-10-29T00:00:00.000Z',
    },
  ]);
  show(<SyncConflictsDialog open onClose={() => {}} />);
  await userEvent.setup().click(screen.getByRole('button', { name: '내 값으로 되돌리기' }));
  await waitFor(() => expect(mock.resolve).toHaveBeenCalledWith('c', 'mine'));
});
it('지우기를 입력해야 서버 자료 삭제가 켜진다', async () => {
  show(<SyncDeleteDialog open onClose={() => {}} />);
  const button = screen.getByRole('button', { name: '서버 자료 모두 지우기' });
  expect(button).toBeDisabled();
  await userEvent.setup().type(screen.getByLabelText('지우기 입력'), '지우기');
  await userEvent.setup().click(button);
  await waitFor(() => expect(mock.remove).toHaveBeenCalled());
});
it('다른 기기 연결을 철회한다', async () => {
  mock.list.mockResolvedValue({
    ok: true,
    data: {
      sessions: [{ id: 'other', label: '다른 기기', current: false, lastUsedAt: Date.now() }],
    },
  });
  mock.revoke.mockResolvedValue({ ok: true, data: { revoked: 1 } });
  show(<SyncDevices />);
  await userEvent.setup().click(await screen.findByRole('button', { name: '연결 끊기' }));
  expect(mock.revoke).toHaveBeenCalledWith('other');
});

it('빌드 변수가 없으면 설정 화면에 동기화 절이 없다', async () => {
  const { renderLibrary } = await import('../library/fixtures');
  await renderLibrary(emptyLibrary(), { path: '/settings' });
  expect(await screen.findByRole('heading', { name: '설정', level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '동기화' })).toBeNull();
  const { setAppRuntimeForTest } = await import('src/lib/effect/runtime');
  setAppRuntimeForTest(null);
});

it('여행 날짜와 일정 충돌을 한 묶음으로 표시한다', () => {
  writeConflicts(localStorage, [
    {
      id: 'dates',
      key: 'trip:trip000001',
      kind: 'trip',
      label: '여행',
      path: 'dates',
      mine: {},
      theirs: {},
      at: '2026-10-29T00:00:00.000Z',
    },
  ]);
  show(<SyncConflictsDialog open onClose={() => {}} />);
  expect(screen.getByText('여행 · 날짜·일정')).toBeInTheDocument();
});

it.each([0, 2])(
  '연결 안내는 약속 %i개도 표시하고 서버 합계는 항목 단위로 안내한다',
  async (count) => {
    mock.me.mockResolvedValue({ ok: true, data: { library: { live: 3 }, devices: [] } });
    const { store } = show(<SyncConnectDialog open onClose={() => {}} />);
    const meetings = Object.fromEntries(
      Array.from({ length: count }, (_, index) => {
        const id = `meeting00${index + 1}`;
        return [id, buildMeeting({ id })];
      }),
    );
    act(() =>
      store.set(libraryAtom, {
        ...emptyLibrary(),
        meetings: {
          ...meetings,
          meeting003: buildMeeting({ id: 'meeting003', deletedAt: '2026-10-29T00:00:00.000Z' }),
        },
      }),
    );
    expect(
      screen.getByText(`이 기기 보관함: 장소 0곳 · 라벨 0개 · 여행 0개 · 약속 ${count}개`),
    ).toBeInTheDocument();
    expect(await screen.findByText('서버 보관함: 항목 3개')).toBeInTheDocument();
  },
);
