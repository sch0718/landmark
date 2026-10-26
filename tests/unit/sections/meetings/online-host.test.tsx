import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { Effect } from 'effect';
import * as effectRuntime from 'src/lib/effect/runtime';
import { haversineM } from 'src/domain/trips/geo';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { useLibraryAction } from 'src/stores/library-state';
type LibraryOp = Parameters<ReturnType<typeof useLibraryAction>['run']>[0];
import type { Meeting } from 'src/schema/meeting';
import { emptyLibrary } from 'src/schema/library';
import { docFromMeeting, type OnlineState } from 'src/domain/meeting/online-doc';
import { meetApi, type OnlineError } from 'src/services/meet-online/client';
import { readOnline, writeOnline } from 'src/services/meet-online/store';
import { getTurnstileToken } from 'src/services/meet-online/turnstile-loader';
import { shareLink, shareMeetingDoc } from 'src/sections/meetings/share-link';
import { useOnlineMeeting, type OnlineCompute } from 'src/sections/meetings/use-online-meeting';
import { OnlineHostMenu } from 'src/sections/meetings/OnlineHostMenu';
import { buildMeeting } from '../../../fixtures/builders';

vi.mock('src/components/map/MapView', () => ({ MapView: () => <div /> }));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(async () => {}) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('src/services/meet-online/client', () => ({
  meetApi: {
    create: vi.fn(),
    reply: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    release: vi.fn(),
  },
}));
vi.mock('src/services/meet-online/turnstile-loader', () => ({ getTurnstileToken: vi.fn() }));
vi.mock('src/sections/meetings/share-link', async (original) => ({
  ...(await original<typeof import('src/sections/meetings/share-link')>()),
  shareLink: vi.fn(),
  shareMeetingDoc: vi.fn(),
}));
let saved = buildMeeting();
let refresh: (meeting: Meeting) => void;
const run = async (op: LibraryOp) => {
  const result = op(
    { ...emptyLibrary(), meetings: { [saved.id]: saved } },
    { now: new Date().toISOString(), newId: () => 'person03' },
  );
  if ('ok' in result && !result.ok) return result;
  const lib = 'ok' in result ? result.lib : result;
  saved = lib.meetings![saved.id]!;
  refresh(saved);
  return { ok: true as const };
};
vi.mock('src/sections/meetings/use-meeting', () => ({
  useMeeting: () => ({
    run,
    meeting: saved,
    library: { ...emptyLibrary(), meetings: { [saved.id]: saved } },
  }),
}));
const f = <T,>(value: T, updatedAt = '2026-10-26T00:00:00.000Z') => ({ value, updatedAt });
const compute = { times: {}, unit: 'min' as const, pending: false };
const token = 'h'.repeat(43);
const startAt = '2026-10-26T01:00:00.000Z';
function state(overrides: Partial<OnlineState> = {}): OnlineState {
  return {
    rev: 2,
    docRev: 1,
    doc: docFromMeeting(saved, {}, saved.mode.value === 'straight' ? 'm' : 'min'),
    replies: [],
    ...overrides,
  };
}
function online() {
  writeOnline(saved.id, { hostToken: token, lastRev: 1, docRev: 1, syncedAt: startAt });
}

function setup() {
  return renderHook(() => {
    const [meeting, setMeeting] = useState(saved);
    refresh = setMeeting;
    return useOnlineMeeting(meeting, {
      ...compute,
      unit: meeting.mode.value === 'straight' ? 'm' : 'min',
    });
  });
}
async function flush() {
  await act(async () => {});
}
async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}
async function edit(patch: Partial<Meeting>) {
  await act(async () => {
    saved = { ...saved, ...patch };
    refresh(saved);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(startAt);
  vi.clearAllMocks();
  localStorage.clear();
  refresh = () => {};
  saved = buildMeeting({
    participants: f([
      { id: 'person01', name: '나', origin: null },
      { id: 'person02', name: '친구', origin: null },
    ]),
  });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(getTurnstileToken).mockResolvedValue('dev');
  vi.mocked(meetApi.create).mockResolvedValue({
    ok: true,
    value: { id: saved.id, rev: 1, docRev: 1, hostToken: token },
  });
  vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: 'unchanged' });
  vi.mocked(meetApi.reply).mockResolvedValue({ ok: true, value: { rev: 3 } });
  vi.mocked(meetApi.update).mockResolvedValue({ ok: true, value: { rev: 3, docRev: 2 } });
  vi.mocked(meetApi.release).mockResolvedValue({
    ok: true,
    value: { rev: 4, hostToken: 'n'.repeat(43) },
  });
  vi.mocked(meetApi.remove).mockResolvedValue({ ok: true, value: undefined });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(['첫 확인', '정기 확인', '본문 버전 확인', '충돌 재시도'] as const)(
  '%s에서 가린 응답을 받으면 출발지를 지키고 연결 끊김을 알린다',
  async (path) => {
    saved = {
      ...saved,
      participants: f([
        { id: 'person01', name: '나', origin: { name: '집', lng: 127, lat: 37.5 } },
        { id: 'person02', name: '친구', origin: { name: '회사', lng: 128, lat: 36 } },
      ]),
    };
    online();
    const before = saved.participants;
    const doc = state().doc;
    const redacted = state({
      rev: 3,
      docRev: 2,
      originNames: { person01: '집', person02: '회사' },
      doc: { ...doc, participants: doc.participants.map((p) => ({ ...p, origin: null })) },
    });
    if (path === '첫 확인') vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: redacted });
    const { result } = setup();
    await flush();
    vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: redacted });
    if (path === '정기 확인') await advance(10000);
    if (path === '본문 버전 확인' || path === '충돌 재시도') {
      if (path === '본문 버전 확인')
        writeOnline(saved.id, { hostToken: token, lastRev: 1, syncedAt: startAt });
      else
        vi.mocked(meetApi.update).mockResolvedValueOnce({
          ok: false,
          error: { code: 'conflict', docRev: 2 },
        });
      await edit({ title: f('미전송 제목') });
      await advance(1000);
    }
    expect(saved.participants).toEqual(before);
    expect(result.current.status.failing).toBe(true);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      '이 기기의 주최자 연결이 끊겼어요. 주최자 링크로 다시 연결하세요',
    );
    expect(meetApi.update).toHaveBeenCalledTimes(path === '충돌 재시도' ? 1 : 0);
  },
);

it('링크 방식 약속은 후보와 확정 해시 문서를 공유한다', async () => {
  saved = {
    ...saved,
    replies: f({ person02: { likes: ['choice01'], sentAt: startAt, receivedAt: startAt } }),
    decided: f('choice01'),
  };
  const { result } = setup();
  expect(result.current.mode).toBe('link');
  await act(() => result.current.share());
  await act(() => result.current.shareFinal());
  expect(shareMeetingDoc).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ kind: 'd' }),
    '친구 모임',
  );
  expect(shareMeetingDoc).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ kind: 'f' }),
    '친구 모임',
  );
  expect(meetApi.create).not.toHaveBeenCalled();
});
it('첫 공유는 한 번 올리고 기록을 저장하며 다음 공유와 확정은 짧은 링크만 보낸다', async () => {
  const { result } = setup();
  await act(() => result.current.share());
  await act(() => result.current.share());
  await act(() => result.current.shareFinal());
  expect(meetApi.create).toHaveBeenCalledTimes(1);
  expect(meetApi.create).toHaveBeenCalledWith(docFromMeeting(saved, {}, 'min'), 'dev');
  expect(readOnline(saved.id)).toMatchObject({ hostToken: token, docRev: 1, syncedAt: startAt });
  expect(shareLink).toHaveBeenCalledWith(expect.stringMatching(/\/meet\/meeting001$/), '친구 모임');
  expect(result.current.mode).toBe('online');
});
it.each([
  ['offline', '지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요'],
  ['unavailable', '지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요'],
  ['turnstile', '확인에 실패했어요. 다시 해 주세요'],
  ['rate-limited', '오늘은 더 만들 수 없어요'],
  ['unauthorized', '이 기기의 주최자 연결이 끊겼어요. 주최자 링크로 다시 연결하세요'],
  ['ended', '끝난 약속이에요'],
  ['not-found', '끝난 약속이에요'],
] as const)('create %s 안내', async (code, message) => {
  vi.mocked(meetApi.create).mockResolvedValue({ ok: false, error: { code } });
  const { result } = setup();
  await act(() => result.current.share());
  expect(toast.error).toHaveBeenCalledWith(message);
  expect(readOnline(saved.id)).toBeNull();
});
it('기능 스위치가 꺼지면 알림과 기록 없이 해시 문서를 공유한다', async () => {
  vi.mocked(meetApi.create).mockResolvedValue({ ok: false, error: { code: 'switched-off' } });
  const { result } = setup();
  await act(() => result.current.share());
  expect(shareMeetingDoc).toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(readOnline(saved.id)).toBeNull();
});
it('Turnstile 거절을 안내한다', async () => {
  vi.mocked(getTurnstileToken).mockRejectedValue(new Error('확인 실패'));
  const { result } = setup();
  await act(() => result.current.share());
  expect(toast.error).toHaveBeenCalledWith('확인에 실패했어요. 다시 해 주세요');
  expect(meetApi.create).not.toHaveBeenCalled();
});
it('열 때 즉시 확인하고 참석자 수정 두 번을 1초 모아 docRev로 올린다', async () => {
  online();
  const { result } = setup();
  await flush();
  expect(meetApi.get).toHaveBeenCalledWith(saved.id, null, token);
  await edit({ title: f('첫 변경') });
  await advance(500);
  await edit({ title: f('두 번째') });
  await advance(999);
  expect(meetApi.update).not.toHaveBeenCalled();
  await advance(1);
  expect(meetApi.update).toHaveBeenCalledTimes(1);
  expect(meetApi.update).toHaveBeenCalledWith(
    saved.id,
    expect.objectContaining({ title: '두 번째' }),
    1,
    token,
  );
  expect(readOnline(saved.id)).toMatchObject({ docRev: 2, syncedAt: '2026-10-26T01:00:01.500Z' });
  expect(result.current.status.failing).toBe(false);
});
it('충돌한 본문 버전이 다를 때 get·merge 뒤 새 docRev로 한 번 재시도한다', async () => {
  online();
  const remote = state({
    docRev: 8,
    rev: 9,
    replies: [
      {
        participantId: 'person03',
        name: '새 친구',
        origin: null,
        likes: [],
        times: null,
        updatedAt: startAt,
      },
    ],
  });
  const { result } = setup();
  await flush();
  vi.mocked(meetApi.update).mockResolvedValueOnce({
    ok: false,
    error: { code: 'conflict', docRev: 8 },
  });
  vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: remote });
  await edit({ title: f('수정') });
  await advance(1000);
  expect(meetApi.get).toHaveBeenLastCalledWith(saved.id, null, token);
  expect(meetApi.update).toHaveBeenLastCalledWith(
    saved.id,
    expect.objectContaining({
      participants: expect.arrayContaining([expect.objectContaining({ id: 'person03' })]),
    }),
    8,
    token,
  );
  expect(meetApi.update).toHaveBeenCalledTimes(2);
  expect(result.current.status.failing).toBe(false);
});
it.each([
  { code: 'conflict' },
  { code: 'conflict', docRev: 1 },
  { code: 'offline' },
] satisfies OnlineError[])('실패 %j는 다음 확인 때 다시 올린다', async (error) => {
  online();
  setup();
  await flush();
  vi.mocked(meetApi.update).mockResolvedValueOnce({ ok: false, error });
  await edit({ title: f('수정') });
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledTimes(1);
  expect(meetApi.get).toHaveBeenCalledTimes(1);
  await advance(9000);
  expect(meetApi.update).toHaveBeenCalledTimes(2);
});
it('새 답장을 보관함에 합쳐도 syncedAt은 올리지 않는다', async () => {
  online();
  vi.mocked(meetApi.get).mockResolvedValue({
    ok: true,
    value: state({
      replies: [
        {
          participantId: 'person02',
          name: '친구',
          origin: null,
          likes: ['choice01'],
          times: { choice01: 12 },
          updatedAt: startAt,
        },
      ],
    }),
  });
  setup();
  await flush();
  expect(saved.replies.value.person02?.likes).toEqual(['choice01']);
  expect(readOnline(saved.id)).toMatchObject({ lastRev: 2, syncedAt: startAt });
});
it('확정 직후 확인이 돌아도 보내기 전 확정을 지키고 응답 시각 대신 본문의 기준 시각을 저장한다', async () => {
  online();
  const remote = state();
  setup();
  await flush();
  await advance(9500);
  await edit({ decided: f('choice01', new Date().toISOString()) });
  vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: true, value: remote });
  await advance(500);
  expect(saved.decided.value).toBe('choice01');
  expect(readOnline(saved.id)?.syncedAt).toBe(startAt);
  let finish!: (value: Awaited<ReturnType<typeof meetApi.update>>) => void;
  vi.mocked(meetApi.update).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await advance(500);
  await advance(2000);
  await act(async () => finish({ ok: true, value: { rev: 4, docRev: 2 } }));
  expect(readOnline(saved.id)?.syncedAt).toBe('2026-10-26T01:00:10.500Z');
});
it.each(['ended', 'not-found'] as const)('%s 응답은 끝남 기록으로 남기고 멈춘다', async (code) => {
  online();
  vi.mocked(meetApi.get).mockResolvedValue({ ok: false, error: { code } });
  const { result } = setup();
  await flush();
  expect(result.current.mode).toBe('ended');
  expect(readOnline(saved.id)).toMatchObject({ ended: true });
  await advance(30000);
  expect(meetApi.get).toHaveBeenCalledTimes(1);
});
it('주최자 링크는 #h=로 공유하고 다시 발급하면 기록 토큰을 바꾼다', async () => {
  online();
  const { result } = setup();
  await flush();
  await act(() => result.current.openOnOtherDevice());
  expect(shareLink).toHaveBeenCalledWith(
    expect.stringContaining(`/meet/${saved.id}#h=${token}`),
    '친구 모임',
  );
  await act(() => result.current.reissueHostLink());
  expect(readOnline(saved.id)?.hostToken).toBe('n'.repeat(43));
  expect(toast.success).toHaveBeenCalledWith('이전 주최자 링크는 이제 쓸 수 없어요');
});
it('참석자 차지 풀기와 서버 삭제는 확인을 받고 보관함을 남긴다', async () => {
  online();
  const { result } = setup();
  await flush();
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  await act(() => result.current.releaseParticipant('person02'));
  expect(meetApi.release).not.toHaveBeenCalled();
  await act(() => result.current.releaseParticipant('person02'));
  expect(meetApi.release).toHaveBeenCalledWith(saved.id, { participantId: 'person02' }, token);
  await act(() => result.current.removeFromServer());
  expect(readOnline(saved.id)).toEqual(expect.objectContaining({ ended: true }));
  expect(readOnline(saved.id)?.hostToken).toBeUndefined();
  expect(saved.deletedAt).toBeNull();
  expect(result.current.mode).toBe('ended');
});
it('온라인 메뉴에서 참석자를 고르고 주최자 링크를 다시 발급한다', () => {
  const actions = {
    mode: 'online' as const,
    openOnOtherDevice: vi.fn(),
    releaseParticipant: vi.fn(),
    removeFromServer: vi.fn(),
    reissueHostLink: vi.fn(),
  };
  render(<OnlineHostMenu meeting={saved} online={actions} />);
  fireEvent.click(screen.getByRole('button', { name: '약속 공유 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '참석자 차지 풀기' }));
  expect(screen.queryByRole('button', { name: '나' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '친구' }));
  expect(actions.releaseParticipant).toHaveBeenCalledWith('person02');
});

it('온라인 결과는 자동 집계 상태와 마지막 확인 시각을 표시하고 후보·확정을 짧은 링크로 보낸다', async () => {
  const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
  online();
  saved = { ...saved, decided: f('choice01') };
  const { result } = setup();
  await flush();
  render(<MeetingResults meeting={saved} library={emptyLibrary()} online={result.current} />);
  expect(screen.getByText(/친구 답장이 자동으로 모여요 · 0분 전 기준/)).toBeInTheDocument();
  expect(screen.queryByText('반영')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '후보 링크 보내기' }));
  fireEvent.click(screen.getByRole('button', { name: '확정 링크 보내기' }));
  await flush();
  expect(shareLink).toHaveBeenCalledTimes(2);
});
it('끝난 온라인 약속은 안내를 보이고 공유 단추를 막는다', async () => {
  const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
  online();
  writeOnline(saved.id, { ...readOnline(saved.id)!, ended: true });
  const { result } = setup();
  render(<MeetingResults meeting={saved} library={emptyLibrary()} online={result.current} />);
  expect(screen.getByText('공유가 끝난 약속이에요')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '후보 링크 보내기' })).toBeDisabled();
});
it('확인에 실패하면 마지막 성공 시각과 연결 안내를 보인다', async () => {
  const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
  online();
  const { result } = setup();
  await flush();
  vi.mocked(meetApi.get).mockResolvedValue({ ok: false, error: { code: 'offline' } });
  await advance(60000);
  render(<MeetingResults meeting={saved} library={emptyLibrary()} online={result.current} />);
  expect(screen.getByText(/연결이 원활하지 않아요 · 1분 전 기준/)).toBeInTheDocument();
});

it('전송 중에 다시 고친 본문도 첫 전송이 끝나면 자동으로 이어 올린다', async () => {
  online();
  setup();
  await flush();
  let finish!: (value: Awaited<ReturnType<typeof meetApi.update>>) => void;
  vi.mocked(meetApi.update).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit({ title: f('먼저') });
  await advance(1000);
  await edit({ title: f('나중') });
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: true, value: { rev: 3, docRev: 2 } }));
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledTimes(2);
  expect(meetApi.update).toHaveBeenLastCalledWith(
    saved.id,
    expect.objectContaining({ title: '나중' }),
    2,
    token,
  );
});
it('두 번째 충돌은 바로 또 시도하지 않고 다음 확인까지 기다린다', async () => {
  online();
  setup();
  await flush();
  vi.mocked(meetApi.update).mockResolvedValue({
    ok: false,
    error: { code: 'conflict', docRev: 3 },
  });
  vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: state({ docRev: 2 }) });
  await edit({ title: f('수정') });
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledTimes(2);
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledTimes(2);
});
it('계산 중에는 올리지 않고 계산이 끝난 뒤 1초 후 올린다', async () => {
  online();
  const { rerender } = renderHook(
    ({ pending }) => {
      const [meeting, setMeeting] = useState(saved);
      refresh = setMeeting;
      return useOnlineMeeting(meeting, { ...compute, pending });
    },
    { initialProps: { pending: true } },
  );
  await flush();
  await edit({ title: f('수정') });
  await advance(3000);
  expect(meetApi.update).not.toHaveBeenCalled();
  rerender({ pending: false });
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledTimes(1);
});
it('중복 공유 클릭은 create를 겹쳐 보내지 않는다', async () => {
  const { result } = setup();
  await act(async () => {
    await Promise.all([result.current.share(), result.current.share()]);
  });
  expect(meetApi.create).toHaveBeenCalledTimes(1);
});
it('응답에 담긴 친구 소요시간을 집계표에 쓴다', async () => {
  const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
  online();
  vi.mocked(meetApi.get).mockResolvedValue({
    ok: true,
    value: state({
      replies: [
        {
          participantId: 'person02',
          name: '친구',
          origin: null,
          likes: [],
          times: { choice01: 12 },
          updatedAt: startAt,
        },
      ],
    }),
  });
  const { result } = setup();
  await flush();
  render(<MeetingResults meeting={saved} library={emptyLibrary()} online={result.current} />);
  expect(screen.getByText('12분')).toBeInTheDocument();
});
it('온라인 메뉴의 다른 기기 창에서 공유와 다시 발급을 고른다', () => {
  const actions = {
    mode: 'online' as const,
    openOnOtherDevice: vi.fn(),
    releaseParticipant: vi.fn(),
    removeFromServer: vi.fn(),
    reissueHostLink: vi.fn(),
  };
  render(<OnlineHostMenu meeting={saved} online={actions} />);
  fireEvent.click(screen.getByRole('button', { name: '약속 공유 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '다른 기기에서 열기' }));
  fireEvent.click(screen.getByRole('button', { name: '주최자 링크 보내기' }));
  expect(actions.openOnOtherDevice).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '주최자 링크 다시 발급' }));
  expect(actions.reissueHostLink).toHaveBeenCalledTimes(1);
});
it('목록에서 공유 중과 공유 끝남을 표시한다', async () => {
  const { createStore, Provider } = await import('jotai');
  const { MemoryRouter } = await import('react-router');
  const { libraryAtom } = await import('src/stores/library-state');
  const { MeetingsPage } = await import('src/sections/meetings/MeetingsPage');
  online();
  const ended = { ...saved, id: 'meeting002', title: f('지난 모임') };
  writeOnline(ended.id, { lastRev: 1, ended: true });
  const store = createStore();
  store.set(libraryAtom, { ...emptyLibrary(), meetings: { [saved.id]: saved, [ended.id]: ended } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <MeetingsPage />
      </MemoryRouter>
    </Provider>,
  );
  expect(screen.getByText('공유 중')).toBeInTheDocument();
  expect(screen.getByText('공유 끝남')).toBeInTheDocument();
});

it('편집 화면 첫 공유가 온라인 메뉴와 자동 집계 상태로 이어진다', async () => {
  const { MemoryRouter, Routes, Route } = await import('react-router');
  const { MeetingEditorPage } = await import('src/sections/meetings/MeetingEditorPage');
  render(
    <MemoryRouter initialEntries={['/meetings/meeting001']}>
      <Routes>
        <Route path="/meetings/:id" element={<MeetingEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.queryByRole('button', { name: '약속 공유 메뉴' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '후보 링크 보내기' }));
  await flush();
  expect(screen.getByRole('button', { name: '약속 공유 메뉴' })).toBeInTheDocument();
  expect(screen.getByText(/친구 답장이 자동으로 모여요/)).toBeInTheDocument();
  expect(meetApi.create).toHaveBeenCalledTimes(1);
  expect(meetApi.get).toHaveBeenCalledTimes(1);
});

it('다시 열 때 전체 상태를 읽어 이미 받은 친구 소요시간도 복원한다', async () => {
  online();
  vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: true, value: state() });
  setup();
  await flush();
  expect(meetApi.get).toHaveBeenCalledWith(saved.id, null, token);
  await advance(10000);
  expect(meetApi.get).toHaveBeenLastCalledWith(saved.id, 2, token);
});
it('주최자가 친구 출발지를 바꾸면 이전 답장의 시간을 덮어쓰지 않는다', async () => {
  online();
  const origin = { name: '집', lng: 127, lat: 37.5 };
  vi.mocked(meetApi.get).mockResolvedValue({
    ok: true,
    value: state({
      replies: [
        {
          participantId: 'person02',
          name: '친구',
          origin,
          likes: [],
          times: { choice01: 12 },
          updatedAt: startAt,
        },
      ],
    }),
  });
  const { result } = setup();
  await flush();
  expect(result.current.replyTimes.choice01?.person02).toBe(12);
  await edit({
    participants: f(
      saved.participants.value.map((p) =>
        p.id === 'person02' ? { ...p, origin: { name: '회사', lng: 128, lat: 36 } } : p,
      ),
    ),
  });
  expect(result.current.replyTimes.choice01?.person02).toBeUndefined();
});

it('계산 조건이 바뀌어도 부모에 같은 계산 결과를 되풀이 보고하지 않는다', async () => {
  const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
  let reports = 0;
  function Wrapper({ meeting }: { meeting: Meeting }) {
    const [, setComputed] = useState<OnlineCompute>(compute);
    return (
      <MeetingResults
        meeting={meeting}
        library={emptyLibrary()}
        onComputeChange={(value) => {
          reports += 1;
          if (reports > 10) throw new Error('같은 계산 결과 반복');
          setComputed(value);
        }}
      />
    );
  }
  const meeting = { ...saved, mode: f('straight' as const) };
  const { rerender } = render(<Wrapper meeting={meeting} />);
  await flush();
  expect(() =>
    rerender(
      <Wrapper
        meeting={{
          ...meeting,
          participants: f(
            meeting.participants.value.map((p) =>
              p.id === 'person02' ? { ...p, origin: { name: '집', lng: 127, lat: 37.5 } } : p,
            ),
          ),
        }}
      />,
    ),
  ).not.toThrow();
  expect(reports).toBeLessThan(10);
});
it('본문 버전이 없는 기록의 확인 실패도 다음 확인 때 다시 시도한다', async () => {
  online();
  writeOnline(saved.id, { hostToken: token, lastRev: 1, syncedAt: startAt });
  saved = { ...saved, title: f('미전송 수정', '2026-10-26T01:00:01.000Z') };
  vi.mocked(meetApi.get)
    .mockResolvedValueOnce({ ok: false, error: { code: 'offline' } })
    .mockResolvedValueOnce({ ok: false, error: { code: 'offline' } })
    .mockResolvedValueOnce({ ok: true, value: 'unchanged' })
    .mockResolvedValue({ ok: true, value: state() });
  setup();
  await flush();
  await advance(1000);
  await advance(9000);
  expect(meetApi.update).toHaveBeenCalledTimes(1);
});

it.each(['offline', 'hidden', 'failed'] as const)(
  '%s 상태에서 열린 화면도 첫 전체 상태를 받을 때까지 초기 확인을 이어 간다',
  async (condition) => {
    online();
    const response = state({
      replies: [
        {
          participantId: 'person02',
          name: '친구',
          origin: null,
          likes: [],
          times: { choice01: 12 },
          updatedAt: startAt,
        },
      ],
    });
    vi.mocked(meetApi.get).mockImplementation(async (_id, since) => ({
      ok: true,
      value: since === null ? response : 'unchanged',
    }));
    if (condition === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    if (condition === 'hidden')
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    if (condition === 'failed')
      vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: false, error: { code: 'offline' } });
    const { result } = setup();
    await flush();
    if (condition === 'failed') await advance(10000);
    else
      await act(async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        window.dispatchEvent(new Event('online'));
      });
    expect(result.current.replyTimes.choice01?.person02).toBe(12);
  },
);

it('충돌 합치기로 참석자가 늘어도 두 번째 충돌 후에는 다음 확인까지 기다린다', async () => {
  online();
  setup();
  await flush();
  vi.mocked(meetApi.update).mockResolvedValue({
    ok: false,
    error: { code: 'conflict', docRev: 3 },
  });
  vi.mocked(meetApi.get).mockResolvedValue({
    ok: true,
    value: state({
      docRev: 2,
      replies: [
        {
          participantId: 'person03',
          name: '새 친구',
          origin: null,
          likes: [],
          times: null,
          updatedAt: startAt,
        },
      ],
    }),
  });
  await edit({ title: f('수정') });
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledTimes(2);
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledTimes(2);
});

it('실패한 수정을 원래대로 돌리면 다음 확인 뒤 새 수정을 다시 자동으로 올린다', async () => {
  online();
  setup();
  await flush();
  vi.mocked(meetApi.update).mockResolvedValueOnce({ ok: false, error: { code: 'conflict' } });
  await edit({ title: f('수정') });
  await advance(1000);
  await edit({ title: f('친구 모임') });
  await advance(9000);
  await edit({ title: f('새 수정') });
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledTimes(2);
});

it.each(['mode', 'origin'] as const)(
  '다시 올린 뒤 확인해도 예전 %s 조건의 답장 시간을 되살리지 않는다',
  async (condition) => {
    online();
    const reply = {
      participantId: 'person02',
      name: '친구',
      origin: null,
      likes: [],
      times: { choice01: 12 },
      updatedAt: startAt,
    };
    vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: true, value: state({ replies: [reply] }) });
    const { result } = setup();
    await flush();
    expect(result.current.replyTimes.choice01?.person02).toBe(12);
    await advance(2000);
    const changedAt = new Date().toISOString();
    if (condition === 'mode') await edit({ mode: f('straight', changedAt) });
    else
      await edit({
        participants: f(
          saved.participants.value.map((p) =>
            p.id === 'person02' ? { ...p, origin: { name: '회사', lng: 128, lat: 36 } } : p,
          ),
          changedAt,
        ),
      });
    await advance(1000);
    const remote = state({
      rev: 4,
      docRev: 2,
      replies: [reply],
      doc: docFromMeeting(saved, {}, saved.mode.value === 'straight' ? 'm' : 'min'),
    });
    vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: remote });
    await advance(7000);
    expect(result.current.replyTimes.choice01?.person02).toBeUndefined();
  },
);

it('철회된 기기는 401 확인 세 번에도 출발지를 보존하고 알림을 한 번만 띄운다', async () => {
  saved = {
    ...saved,
    participants: f([
      { id: 'person01', name: '나', origin: { name: '집', lng: 127, lat: 37.5 } },
      { id: 'person02', name: '친구', origin: { name: '회사', lng: 128, lat: 36 } },
    ]),
  };
  const before = saved;
  online();
  vi.mocked(meetApi.get).mockResolvedValue({ ok: false, error: { code: 'unauthorized' } });
  setup();
  await flush();
  await advance(10000);
  await advance(10000);
  expect(meetApi.get).toHaveBeenCalledTimes(3);
  expect(saved).toBe(before);
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(
    '이 기기의 주최자 연결이 끊겼어요. 주최자 링크로 다시 연결하세요',
  );
});

it('주최자 좋아요 변경을 1초 모아 본문 대신 답장으로 한 번 전송한다', async () => {
  online();
  setup();
  await flush();
  await edit({
    replies: f({ person01: { likes: ['choice01'], sentAt: startAt, receivedAt: startAt } }),
  });
  await advance(500);
  await edit({ replies: f({ person01: { likes: [], sentAt: startAt, receivedAt: startAt } }) });
  await advance(500);
  await edit({
    replies: f({ person01: { likes: ['choice01'], sentAt: startAt, receivedAt: startAt } }),
  });
  await advance(999);
  expect(meetApi.reply).not.toHaveBeenCalled();
  await advance(1);
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(saved.id, { likes: ['choice01'] }, token);
  expect(meetApi.update).not.toHaveBeenCalled();
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledTimes(1);
});
it('create 직후 기존 주최자 좋아요를 전송한다', async () => {
  saved = {
    ...saved,
    replies: f({ person01: { likes: ['choice01'], sentAt: startAt, receivedAt: startAt } }),
  };
  const { result } = setup();
  await act(() => result.current.share());
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(saved.id, { likes: ['choice01'] }, token);
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledTimes(1);
});
it('실패한 주최자 좋아요는 다음 확인에서 다시 보내고 빈 좋아요도 저장한다', async () => {
  online();
  setup();
  await flush();
  vi.mocked(meetApi.reply).mockResolvedValueOnce({ ok: false, error: { code: 'offline' } });
  await edit({
    replies: f({ person01: { likes: ['choice01'], sentAt: startAt, receivedAt: startAt } }),
  });
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledTimes(1);
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledTimes(1);
  await advance(8000);
  expect(meetApi.reply).toHaveBeenCalledTimes(2);
  await edit({ replies: f({}) });
  await advance(1000);
  expect(meetApi.reply).toHaveBeenLastCalledWith(saved.id, { likes: [] }, token);
});

it('다른 기기의 확정과 확정 취소를 연이어 받고 다시 올리지 않는다', async () => {
  online();
  setup();
  await flush();
  vi.mocked(meetApi.get).mockResolvedValueOnce({
    ok: true,
    value: state({ rev: 3, docRev: 2, doc: { ...state().doc, decided: 'choice01' } }),
  });
  await advance(10000);
  expect(saved.decided.value).toBe('choice01');
  expect(readOnline(saved.id)).toMatchObject({ docRev: 2, syncedAt: new Date().toISOString() });
  vi.mocked(meetApi.get).mockResolvedValueOnce({
    ok: true,
    value: state({ rev: 4, docRev: 3, doc: { ...state().doc, decided: null } }),
  });
  await advance(10000);
  expect(saved.decided.value).toBeNull();
  await advance(1000);
  expect(meetApi.update).not.toHaveBeenCalled();
});

it('미전송 수정이 있으면 원격 본문 버전과 동기화 시각도 보존한다', async () => {
  online();
  const remote = state({ rev: 5, docRev: 4 });
  setup();
  await flush();
  await advance(9500);
  await edit({ title: f('로컬 제목', new Date().toISOString()) });
  vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: true, value: remote });
  await advance(500);
  expect(saved.title.value).toBe('로컬 제목');
  expect(readOnline(saved.id)).toMatchObject({ docRev: 1, syncedAt: startAt, lastRev: 5 });
});

it('새 기기는 서버 주최자 좋아요를 복원하고 빈 좋아요를 자동 전송하지 않는다', async () => {
  online();
  vi.mocked(meetApi.get).mockResolvedValueOnce({
    ok: true,
    value: state({
      replies: [
        {
          participantId: 'person01',
          name: '나',
          origin: null,
          likes: ['choice01', 'deleted1'],
          times: null,
          updatedAt: startAt,
        },
      ],
    }),
  });
  setup();
  await flush();
  expect(saved.replies.value.person01?.likes).toEqual(['choice01']);
  await advance(1000);
  expect(meetApi.reply).not.toHaveBeenCalled();
});

it('본문과 답장 참석자의 합계 한도 초과를 안내한다', async () => {
  online();
  setup();
  await flush();
  vi.mocked(meetApi.update).mockResolvedValueOnce({ ok: false, error: { code: 'full' } });
  await edit({ title: f('수정', new Date().toISOString()) });
  await advance(1000);
  expect(toast.error).toHaveBeenCalledWith('참석자는 10명까지예요');
});

it.each(['person02', 'person03'])(
  '온라인 답장의 %s 출발지를 합치면 직선거리를 다시 계산할 때까지 올리지 않고 주최자 값을 지킨다',
  async (pid) => {
    const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
    saved = {
      ...saved,
      mode: f('straight'),
      participants: f([
        { id: 'person01', name: '나', origin: { name: '집', lng: 126.9, lat: 37.4 } },
        { id: 'person02', name: '친구', origin: { name: '회사', lng: 127.1, lat: 37.6 } },
      ]),
    };
    online();
    let reported!: OnlineCompute;
    const reports: OnlineCompute[] = [];
    function Editor() {
      const [meeting, setMeeting] = useState(saved);
      const [computed, setComputed] = useState<OnlineCompute>({
        times: {},
        unit: 'm',
        pending: true,
      });
      refresh = setMeeting;
      const host = useOnlineMeeting(meeting, computed);
      return (
        <MeetingResults
          meeting={meeting}
          library={emptyLibrary()}
          online={host}
          onComputeChange={(value) => {
            reported = value;
            reports.push(value);
            setComputed(value);
          }}
        />
      );
    }
    render(<Editor />);
    await flush();
    await advance(1000);
    const hostDistance = Math.round(haversineM([126.9, 37.4], [127, 37.5]));
    expect(reported.times.choice01?.person01).toBe(hostDistance);
    vi.mocked(meetApi.update).mockClear();
    reports.length = 0;
    const origin = { name: '새 출발', lng: 127.2, lat: 37.7 };
    vi.mocked(meetApi.get).mockResolvedValueOnce({
      ok: true,
      value: state({
        replies: [
          {
            participantId: pid,
            name: '친구',
            origin,
            likes: [],
            times: null,
            updatedAt: startAt,
          },
        ],
      }),
    });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const fork = effectRuntime.forkEffect;
    vi.spyOn(effectRuntime, 'forkEffect').mockImplementationOnce((effect) =>
      fork(Effect.promise(() => gate).pipe(Effect.andThen(effect))),
    );
    try {
      await advance(9000);
      expect(reported.pending).toBe(true);
      expect(reports.every((value) => value.pending)).toBe(true);
      await advance(1000);
      expect(meetApi.update).not.toHaveBeenCalled();
      await act(async () => finish());
      await advance(1000);
      expect(meetApi.update).toHaveBeenCalledTimes(1);
      expect(meetApi.update).toHaveBeenLastCalledWith(
        saved.id,
        expect.objectContaining({
          unit: 'm',
          times: {
            choice01: expect.objectContaining({
              person01: hostDistance,
              [pid]: Math.round(haversineM([origin.lng, origin.lat], [127, 37.5])),
            }),
          },
        }),
        expect.any(Number),
        token,
      );
    } finally {
      finish();
    }
  },
);

it.each(['share', 'shareFinal'] as const)(
  '%s는 확정 직후 미전송 본문을 먼저 저장하고 성공한 뒤 공유한다',
  async (action) => {
    online();
    const { result } = setup();
    await flush();
    await edit({ decided: f('choice01', new Date().toISOString()) });
    let finish!: (value: Awaited<ReturnType<typeof meetApi.update>>) => void;
    vi.mocked(meetApi.update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let sharing!: Promise<void>;
    act(() => {
      sharing = result.current[action]();
    });
    await flush();
    expect(meetApi.update).toHaveBeenCalledWith(
      saved.id,
      expect.objectContaining({ decided: 'choice01' }),
      1,
      token,
    );
    expect(shareLink).not.toHaveBeenCalled();
    await act(async () => {
      finish({ ok: true, value: { rev: 3, docRev: 2 } });
      await sharing;
    });
    expect(shareLink).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/meet\/meeting001$/),
      '친구 모임',
    );
  },
);
it.each(['share', 'shareFinal'] as const)(
  '%s는 확정 저장에 실패하면 공유하지 않고 다시 시도 안내를 띄운다',
  async (action) => {
    online();
    const { result } = setup();
    await flush();
    await edit({ decided: f('choice01', new Date().toISOString()) });
    vi.mocked(meetApi.update).mockResolvedValueOnce({ ok: false, error: { code: 'offline' } });
    await act(() => result.current[action]());
    expect(meetApi.update).toHaveBeenCalledTimes(1);
    expect(shareLink).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요');
  },
);
it('확정 공유는 진행 중인 올리기가 끝나면 새 본문을 다시 확인하고 겹치지 않게 저장한다', async () => {
  online();
  const { result } = setup();
  await flush();
  let finish!: (value: Awaited<ReturnType<typeof meetApi.update>>) => void;
  vi.mocked(meetApi.update).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit({ title: f('바뀐 제목') });
  await advance(1000);
  await edit({ decided: f('choice01', new Date().toISOString()) });
  let sharing!: Promise<void>;
  act(() => {
    sharing = result.current.shareFinal();
  });
  await flush();
  expect(meetApi.update).toHaveBeenCalledTimes(1);
  expect(shareLink).not.toHaveBeenCalled();
  await act(async () => {
    finish({ ok: true, value: { rev: 3, docRev: 2 } });
    await sharing;
  });
  expect(meetApi.update).toHaveBeenCalledTimes(2);
  expect(meetApi.update).toHaveBeenLastCalledWith(
    saved.id,
    expect.objectContaining({ decided: 'choice01' }),
    2,
    token,
  );
  expect(shareLink).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(/\/meet\/meeting001$/),
    '바뀐 제목',
  );
});

it.each([
  ['invite', 'choice01', 'd'],
  ['final', 'choice01', 'f'],
  ['final', null, 'd'],
] as const)(
  '기능 스위치가 꺼지면 %s 공유(확정 %s)는 %s 문서를 보낸다',
  async (kind, decided, expected) => {
    saved = { ...saved, decided: f(decided) };
    vi.mocked(meetApi.create).mockResolvedValue({ ok: false, error: { code: 'switched-off' } });
    const { result } = setup();
    await act(() => (kind === 'final' ? result.current.shareFinal() : result.current.share()));
    expect(shareMeetingDoc).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: expected }),
      '친구 모임',
    );
    expect(shareLink).not.toHaveBeenCalled();
    expect(readOnline(saved.id)).toBeNull();
  },
);
