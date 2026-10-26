import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { docFromMeeting, type OnlineState } from 'src/domain/meeting/online-doc';
import { emptyLibrary, type Library } from 'src/schema/library';
import { meetApi } from 'src/services/meet-online/client';
import { redactForGuest } from 'src/server/meet/handlers';
import { readOnline, writeOnline } from 'src/services/meet-online/store';
import { loadMeetDraft, saveMeetDraft } from 'src/sections/meetings/meet-drafts';
import { OnlineInviteView } from 'src/sections/meetings/OnlineInviteView';
import { useMeetingCompute } from 'src/sections/meetings/use-meeting-compute';
import { MeetLinkPage } from 'src/sections/meetings/MeetLinkPage';
import type { useLibraryAction } from 'src/stores/library-state';
import { buildMeeting } from '../../../fixtures/builders';

type LibraryOp = Parameters<ReturnType<typeof useLibraryAction>['run']>[0];
let library: Library;
let remote: OnlineState;
let runWait: { before?: Promise<void>; after?: Promise<void> };
const now = '2026-10-26T01:00:00.000Z';
const token = 'g'.repeat(43);
const hostToken = 'h'.repeat(43);
const f = <T,>(value: T) => ({ value, updatedAt: now });
const compute = vi.hoisted(() => ({
  times: {} as Record<string, Record<string, number | null>>,
  errors: {},
  pending: false,
  stale: false,
  queriedAt: null,
  compute: vi.fn(async () => {}),
  retry: vi.fn(),
}));
vi.mock('src/sections/meetings/use-meeting-compute', () => ({
  useMeetingCompute: vi.fn(() => compute),
}));
vi.mock('src/components/map/MapView', () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock('src/sections/meetings/OriginPicker', () => ({
  OriginPicker: ({
    open,
    onPick,
  }: {
    open: boolean;
    onPick: (o: { name: string; lng: number; lat: number }) => void;
  }) =>
    open ? (
      <button onClick={() => onPick({ name: '새 출발지', lng: 128, lat: 36 })}>시험 출발지</button>
    ) : null,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(async () => {}) }));
vi.mock('src/services/meet-online/client', () => ({
  meetApi: { get: vi.fn(), claim: vi.fn(), reply: vi.fn() },
}));
vi.mock('src/sections/meetings/use-meeting', () => ({
  useMeeting: () => ({
    run: async (op: LibraryOp) => {
      if (runWait.before) await runWait.before;
      const out = op(library, {
        now,
        newId: () => {
          throw new Error('새 id를 만들면 안 돼요');
        },
      });
      if ('ok' in out && !out.ok) return out;
      library = 'ok' in out ? out.lib : out;
      if (runWait.after) await runWait.after;
      return { ok: true };
    },
  }),
}));
async function setup(path = '/meet/meeting001', hostView = <h1>주최자 화면</h1>) {
  const router = createMemoryRouter(
    [
      { path: '/meet/:id', element: <MeetLinkPage /> },
      { path: '/meetings/:id', element: hostView },
    ],
    { initialEntries: [path] },
  );
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}
async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}
function guest() {
  writeOnline('meeting001', { guest: { participantId: 'person02', token }, lastRev: 1 });
}
function like(name = '강남역') {
  fireEvent.click(screen.getByRole('button', { name: `${name} 좋아요` }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  library = emptyLibrary();
  runWait = {};
  const meeting = buildMeeting({
    participants: f([
      { id: 'person01', name: '주최자', origin: null },
      { id: 'person02', name: '친구', origin: null },
      { id: 'person03', name: '다른 친구', origin: null },
    ]),
    candidates: f([
      { id: 'choice01', name: '강남역', kind: 'hub', lng: 127, lat: 37.5 },
      { id: 'choice02', name: '시청역', kind: 'hub', lng: 126.97, lat: 37.56 },
    ]),
  });
  remote = {
    rev: 2,
    docRev: 1,
    doc: docFromMeeting(meeting, { choice01: { person01: 10, person02: 20 } }, 'min'),
    replies: [],
    originNames: { person01: '주최자 집', person03: '다른 회사' },
  };
  compute.times = {};
  compute.pending = false;
  compute.stale = false;
  vi.mocked(meetApi.get).mockImplementation(async () => ({
    ok: true,
    value: structuredClone(remote),
  }));
  vi.mocked(meetApi.claim).mockResolvedValue({
    ok: true,
    value: { participantId: 'person02', guestToken: token, rev: 3 },
  });
  vi.mocked(meetApi.reply).mockResolvedValue({ ok: true, value: { rev: 4 } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('첫 전체 조회 후 주최자를 뺀 나는 누구와 후보 지도를 보인다', async () => {
  await setup();
  expect(meetApi.get).toHaveBeenCalledWith('meeting001', null, null);
  expect(screen.getByText('나는 누구?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '친구' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '주최자' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '후보 지도' })).toBeInTheDocument();
});
it('참석자를 고르기 전에는 기록을 쓰지 않고 화면의 버전으로 계속 확인한다', async () => {
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  await setup();
  await advance(10000);
  expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', remote.rev, null);
  expect(readOnline('meeting001')).toBeNull();
  expect(writes).not.toHaveBeenCalled();
});
it('고르면 기록을 저장하고 내 답장 화면을 연다', async () => {
  await setup();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '친구' }));
  });
  expect(meetApi.claim).toHaveBeenCalledWith(
    'meeting001',
    { participantId: 'person02' },
    expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  );
  expect(readOnline('meeting001')?.guest).toEqual({ participantId: 'person02', token });
  expect(readOnline('meeting001')).toEqual({ guest: { participantId: 'person02', token } });
  expect(screen.getByRole('button', { name: '강남역 좋아요' })).toBeEnabled();
  expect(screen.queryByText('나는 누구?')).not.toBeInTheDocument();
  expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, token);
  expect(meetApi.reply).not.toHaveBeenCalled();
});
it('참석자를 차지하는 동안 바뀐 주최자 기록을 다시 읽어 guest만 더한다', async () => {
  await setup();
  let finish!: (value: Awaited<ReturnType<typeof meetApi.claim>>) => void;
  vi.mocked(meetApi.claim).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: '친구' }));
  const hostRecord = {
    hostToken,
    pendingHostToken: 'p'.repeat(43),
    lastRev: 7,
    docRev: 4,
    syncedDoc: { ...remote.doc, title: '다른 화면에서 받은 제목' },
    hostLikes: ['choice02'],
    seen: ['person04'],
  };
  writeOnline('meeting001', {
    ...hostRecord,
    pendingGuest: readOnline('meeting001')?.pendingGuest,
  });
  await act(async () => {
    finish({ ok: true, value: { participantId: 'person02', guestToken: token, rev: 8 } });
  });
  expect(readOnline('meeting001')).toEqual({
    ...hostRecord,
    guest: { participantId: 'person02', token },
  });
});
it.each(['get', 'reply'] as const)(
  '친구 화면의 %s 인증 실패는 최신 주최자 기록에서 guest만 지운다',
  async (method) => {
    guest();
    await setup();
    let finish!: (value: { ok: false; error: { code: 'unauthorized' } }) => void;
    const response = new Promise<{ ok: false; error: { code: 'unauthorized' } }>((resolve) => {
      finish = resolve;
    });
    vi.mocked(meetApi[method]).mockImplementationOnce(() => response);
    if (method === 'reply') like();
    await advance(method === 'get' ? 10000 : 1000);
    const hostRecord = {
      hostToken,
      pendingHostToken: 'p'.repeat(43),
      lastRev: 7,
      docRev: 4,
      syncedDoc: { ...remote.doc, title: '다른 화면에서 받은 제목' },
      hostLikes: ['choice02'],
      seen: ['person04'],
    };
    writeOnline('meeting001', { ...hostRecord, guest: { participantId: 'person02', token } });
    await act(async () => {
      finish({ ok: false, error: { code: 'unauthorized' } });
    });
    expect(readOnline('meeting001')).toEqual(hostRecord);
    expect(screen.getByRole('region', { name: '나는 누구?' })).toBeInTheDocument();
  },
);
it.each(['get', 'reply'] as const)(
  '옛 토큰의 %s 401은 다른 탭의 새 참석자 토큰을 보존하고 새 토큰으로 이어간다',
  async (method) => {
    guest();
    await setup();
    let finish!: (value: { ok: false; error: { code: 'unauthorized' } }) => void;
    const response = new Promise<{ ok: false; error: { code: 'unauthorized' } }>((resolve) => {
      finish = resolve;
    });
    vi.mocked(meetApi[method]).mockImplementationOnce(() => response);
    if (method === 'reply') like();
    await advance(method === 'get' ? 10000 : 1000);
    const newGuest = { participantId: 'person03', token: 'n'.repeat(43) };
    const record = { ...readOnline('meeting001')!, hostToken, guest: newGuest };
    writeOnline('meeting001', record);
    saveMeetDraft('meeting001', { participantId: newGuest.participantId, likes: ['choice02'] });
    await act(async () => {
      finish({ ok: false, error: { code: 'unauthorized' } });
    });
    expect(readOnline('meeting001')).toEqual(record);
    expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, newGuest.token);
    expect(screen.queryByRole('region', { name: '나는 누구?' })).toBeNull();
    expect(screen.getByRole('button', { name: '시청역 좋아요' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await advance(1000);
    expect(meetApi.reply).toHaveBeenLastCalledWith(
      'meeting001',
      { likes: ['choice02'] },
      newGuest.token,
    );
  },
);
it('목록에 없는 이름은 정리해서 차지한다', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '목록에 없어요' }));
  fireEvent.change(screen.getByRole('textbox', { name: '내 이름' }), {
    target: { value: ' 새 친구 ' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '참석하기' }));
  });
  expect(meetApi.claim).toHaveBeenCalledWith(
    'meeting001',
    { newName: '새 친구' },
    expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  );
});
it.each([
  ['taken', '다른 기기에서 이미 답했어요. 주최자에게 풀어 달라고 하세요'],
  ['full', '참석자가 가득 찼어요'],
] as const)('%s 차지 오류를 보인다', async (code, message) => {
  vi.mocked(meetApi.claim).mockResolvedValue({ ok: false, error: { code } });
  await setup();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '친구' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(readOnline('meeting001')?.guest).toBeUndefined();
});
it('좋아요 두 번을 1초 모아 한 번 보내고 저장한 초안은 지운다', async () => {
  guest();
  await setup();
  like();
  like('시청역');
  await advance(999);
  expect(meetApi.reply).not.toHaveBeenCalled();
  await advance(1);
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(
    'meeting001',
    { likes: ['choice01', 'choice02'] },
    token,
  );
  expect(loadMeetDraft('meeting001')).toBeNull();
});
it.each(['304', '성공', '실패'] as const)(
  '확인 중 건너뛴 좋아요 저장은 GET 결과가 %s이면 바로 다시 보낸다',
  async (outcome) => {
    guest();
    await setup();
    let finish!: (value: Awaited<ReturnType<typeof meetApi.get>>) => void;
    vi.mocked(meetApi.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await advance(10000);
    like();
    await advance(1000);
    expect(meetApi.reply).not.toHaveBeenCalled();
    await act(async () => {
      finish(
        outcome === '실패'
          ? { ok: false, error: { code: 'offline' } }
          : { ok: true, value: outcome === '304' ? 'unchanged' : { ...remote, rev: 3 } },
      );
    });
    expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(
      'meeting001',
      { likes: ['choice01'] },
      token,
    );
    expect(loadMeetDraft('meeting001')).toBeNull();
    await advance(1000);
    expect(meetApi.reply).toHaveBeenCalledTimes(1);
  },
);

it('화면이 숨겨지면 1초를 기다리던 남은 좋아요를 바로 보낸다', async () => {
  guest();
  await setup();
  like();
  await advance(500);
  expect(meetApi.reply).not.toHaveBeenCalled();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(
    'meeting001',
    { likes: ['choice01'] },
    token,
  );
  expect(loadMeetDraft('meeting001')).toBeNull();
});

it('확인 중 숨겨져도 남은 좋아요를 확인 완료 직후 보낸다', async () => {
  guest();
  await setup();
  let finish!: (value: Awaited<ReturnType<typeof meetApi.get>>) => void;
  vi.mocked(meetApi.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await advance(10000);
  like();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(meetApi.reply).not.toHaveBeenCalled();
  await act(async () => {
    finish({ ok: true, value: 'unchanged' });
  });
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(
    'meeting001',
    { likes: ['choice01'] },
    token,
  );
});

it('실패한 답장 초안을 남겼다가 다음 확인에 다시 보낸다', async () => {
  guest();
  vi.mocked(meetApi.reply).mockResolvedValueOnce({ ok: false, error: { code: 'offline' } });
  await setup();
  like();
  await advance(1000);
  expect(loadMeetDraft('meeting001')).toMatchObject({
    participantId: 'person02',
    likes: ['choice01'],
  });
  await advance(9000);
  expect(meetApi.reply).toHaveBeenCalledTimes(2);
  expect(loadMeetDraft('meeting001')).toBeNull();
});
it('다시 연 기기는 남아 있는 초안을 전송한다', async () => {
  guest();
  saveMeetDraft('meeting001', { participantId: 'person02', likes: ['choice02'] });
  await setup();
  expect(screen.getByRole('button', { name: '시청역 좋아요' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledWith('meeting001', { likes: ['choice02'] }, token);
});
it.each(['get', 'reply'] as const)(
  '%s 401이면 참석자 기록을 지우고 다시 고르게 한다',
  async (method) => {
    guest();
    if (method === 'get')
      vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: false, error: { code: 'unauthorized' } });
    else
      vi.mocked(meetApi.reply).mockResolvedValueOnce({
        ok: false,
        error: { code: 'unauthorized' },
      });
    await setup();
    if (method === 'reply') {
      like();
      await advance(1000);
    }
    expect(readOnline('meeting001')?.guest).toBeUndefined();
    expect(screen.getByText('나는 누구?')).toBeInTheDocument();
    expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, null);
  },
);

it('차지가 풀린 토큰은 정기 확인의 401 뒤 토큰 없이 읽고 참석자를 다시 고른다', async () => {
  guest();
  await setup();
  vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: false, error: { code: 'unauthorized' } });
  await advance(10000);
  expect(readOnline('meeting001')?.guest).toBeUndefined();
  expect(screen.getByRole('region', { name: '나는 누구?' })).toBeInTheDocument();
  expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, null);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '친구' }));
  });
  expect(meetApi.claim).toHaveBeenCalledWith(
    'meeting001',
    { participantId: 'person02' },
    expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  );
  expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, token);
  expect(screen.queryByRole('region', { name: '나는 누구?' })).toBeNull();
});
it('다른 사람 좋아요와 출발지 이름을 보이고 보관함은 쓰지 않는다', async () => {
  guest();
  remote = {
    ...remote,
    replies: [
      {
        participantId: 'person03',
        name: '다른 친구',
        origin: { name: '다른 회사', lng: 128, lat: 36 },
        likes: ['choice01'],
        times: { choice01: 12 },
        updatedAt: now,
      },
    ],
  };
  await setup();
  expect(screen.getByText('좋아요 1명 · 다른 친구')).toBeInTheDocument();
  expect(screen.getByText(/다른 회사/)).toBeInTheDocument();
  expect(
    within(screen.getByRole('listitem', { name: '강남역' })).getByText('12분'),
  ).toBeInTheDocument();
  expect(library.meetings).toBeUndefined();
  expect(screen.getByText('0분 전 기준')).toBeInTheDocument();
});
it('출발지를 바꾸면 내 줄을 계산해 출발지와 함께 보낸다', async () => {
  guest();
  compute.times = { choice01: { person02: 7 }, choice02: { person02: 9 } };
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '내 출발지 고르기' }));
  fireEvent.click(screen.getByRole('button', { name: '시험 출발지' }));
  await advance(1000);
  expect(compute.compute).toHaveBeenCalled();
  expect(meetApi.reply).toHaveBeenCalledWith(
    'meeting001',
    {
      likes: [],
      origin: { name: '새 출발지', lng: 128, lat: 36 },
      times: { choice01: 7, choice02: 9 },
      docRev: 1,
    },
    token,
  );
});
it('확정을 확인하면 내 출발지만 길찾기를 보이고 취소되면 후보로 돌아온다', async () => {
  guest();
  remote = {
    ...remote,
    doc: {
      ...remote.doc,
      participants: remote.doc.participants.map((p) =>
        p.id === 'person02' ? { ...p, origin: { name: '내 집', lng: 127, lat: 37.5 } } : p,
      ),
    },
  };
  await setup();
  remote = { ...remote, rev: remote.rev + 1, doc: { ...remote.doc, decided: 'choice02' } };
  await advance(10000);
  expect(screen.getByRole('heading', { name: '확정 · 시청역' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '친구 출발 길찾기' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '주최자 출발 길찾기' })).not.toBeInTheDocument();
  remote = { ...remote, rev: remote.rev + 1, doc: { ...remote.doc, decided: null } };
  await advance(10000);
  expect(screen.getByRole('button', { name: '강남역 좋아요' })).toBeInTheDocument();
});
it.each(['ended', 'not-found'] as const)('%s이면 끝난 약속과 목록 링크를 보인다', async (code) => {
  vi.mocked(meetApi.get).mockResolvedValue({ ok: false, error: { code } });
  await setup();
  expect(screen.getByText('끝난 약속이에요')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '약속 목록으로' })).toHaveAttribute('href', '/meetings');
});
it('잘못된 경로 id는 서버에 보내지 않는다', async () => {
  await setup('/meet/bad');
  expect(screen.getByText('링크를 읽지 못했어요')).toBeInTheDocument();
  expect(meetApi.get).not.toHaveBeenCalled();
});
it.each([false, true])(
  '주최자 링크는 해시를 지우고 서버 본문과 답장을 보관함에 담는다(기존=%s)',
  async (existing) => {
    if (existing)
      library = { ...library, meetings: { meeting001: buildMeeting({ title: f('옛 제목') }) } };
    remote = { ...remote, doc: { ...remote.doc, decided: 'choice02' } };
    remote = {
      ...remote,
      replies: [
        {
          participantId: 'person02',
          name: '친구',
          origin: { name: '회사', lng: 128, lat: 36 },
          likes: ['choice01'],
          times: null,
          updatedAt: now,
        },
      ],
    };
    remote = { rev: remote.rev, docRev: remote.docRev, doc: remote.doc, replies: remote.replies };
    const replace = vi.spyOn(window.history, 'replaceState');
    const router = await setup(`/meet/meeting001#h=${hostToken}`);
    expect(replace).toHaveBeenCalled();
    expect(replace.mock.calls.every((call) => !String(call[2]).includes('#h='))).toBe(true);
    expect(meetApi.get).toHaveBeenCalledWith('meeting001', null, hostToken);
    expect(library.meetings?.meeting001).toMatchObject({
      title: f('친구 모임'),
      decided: f('choice02'),
      replies: { value: { person02: { likes: ['choice01'] } } },
    });
    expect(readOnline('meeting001')).toMatchObject({
      hostToken,
      lastRev: 2,
      docRev: 1,
      syncedDoc: remote.doc,
    });
    expect(router.state.location.pathname).toBe('/meetings/meeting001');
  },
);
it('철회된 주최자 링크는 안내하고 보관함과 토큰을 저장하지 않는다', async () => {
  vi.mocked(meetApi.get).mockResolvedValue({ ok: false, error: { code: 'unauthorized' } });
  await setup(`/meet/meeting001#h=${hostToken}`);
  expect(screen.getByText('주최자 링크가 더 이상 쓸 수 없어요')).toBeInTheDocument();
  expect(library.meetings).toBeUndefined();
  expect(readOnline('meeting001')).toBeNull();
});

it('답장 전송 중 건너뛴 새 좋아요도 앞 요청 완료 직후 저장한다', async () => {
  guest();
  let finish!: (value: Awaited<ReturnType<typeof meetApi.reply>>) => void;
  vi.mocked(meetApi.reply).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await setup();
  like();
  await advance(1000);
  like('시청역');
  await advance(1000);
  expect(loadMeetDraft('meeting001')?.likes).toEqual(['choice01', 'choice02']);
  await act(async () => {
    finish({ ok: true, value: { rev: 4 } });
  });
  expect(loadMeetDraft('meeting001')).toBeNull();
  expect(meetApi.reply).toHaveBeenCalledTimes(2);
  expect(meetApi.reply).toHaveBeenLastCalledWith(
    'meeting001',
    { likes: ['choice01', 'choice02'] },
    token,
  );
});
it('버전 확인 중에도 참석자를 고르면 토큰으로 전체 본문을 다시 받는다', async () => {
  await setup();
  let finish!: (value: Awaited<ReturnType<typeof meetApi.get>>) => void;
  vi.mocked(meetApi.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await advance(10000);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '친구' }));
  });
  await act(async () => {
    finish({ ok: true, value: 'unchanged' });
  });
  expect(meetApi.claim).toHaveBeenCalledTimes(1);
  expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, token);
});
it.each(['offline', 'hidden', 'failed'] as const)(
  '%s 상태로 연 화면도 첫 확인을 다시 한다',
  async (condition) => {
    if (condition === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    if (condition === 'hidden')
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    if (condition === 'failed')
      vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: false, error: { code: 'offline' } });
    await setup();
    if (condition === 'failed') await advance(10000);
    else
      await act(async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        window.dispatchEvent(new Event('online'));
      });
    expect(screen.getByText('나는 누구?')).toBeInTheDocument();
    expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, null);
  },
);
it('304일 때 마지막 집계와 좋아요를 유지한다', async () => {
  guest();
  await setup();
  vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: 'unchanged' });
  await advance(10000);
  expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', 2, token);
  expect(screen.getByRole('button', { name: '강남역 좋아요' })).toBeInTheDocument();
});
it('목록 밖 참석자의 출발지도 확정 화면에서 자기 길찾기로 쓴다', async () => {
  writeOnline('meeting001', { guest: { participantId: 'person04', token }, lastRev: 1 });
  remote = {
    ...remote,
    doc: { ...remote.doc, decided: 'choice01' },
    replies: [
      {
        participantId: 'person04',
        name: '새 친구',
        origin: { name: '내 회사', lng: 128, lat: 36 },
        likes: [],
        times: null,
        updatedAt: now,
      },
    ],
  };
  await setup();
  expect(screen.getByRole('link', { name: '새 친구 출발 길찾기' })).toBeInTheDocument();
});

it('답장을 계속 못 보내도 다음 확인에서 확정 소식은 받는다', async () => {
  guest();
  vi.mocked(meetApi.reply).mockResolvedValue({ ok: false, error: { code: 'offline' } });
  await setup();
  like();
  await advance(1000);
  remote = { ...remote, rev: 3, doc: { ...remote.doc, decided: 'choice01' } };
  await advance(9000);
  expect(screen.getByRole('heading', { name: '확정 · 강남역' })).toBeInTheDocument();
  expect(loadMeetDraft('meeting001')?.likes).toEqual(['choice01']);
});

it('주최자 토큰 조회가 익명 본문을 돌려줘도 철회된 링크로 처리한다', async () => {
  library = { ...library, meetings: { meeting001: buildMeeting() } };
  const before = library;
  await setup(`/meet/meeting001#h=${hostToken}`);
  expect(screen.getByText('주최자 링크가 더 이상 쓸 수 없어요')).toBeInTheDocument();
  expect(library).toBe(before);
  expect(readOnline('meeting001')).toBeNull();
});
it('출발지를 바꾼 뒤에도 되돌리기 없이 새 출발지만 고를 수 있다', async () => {
  guest();
  remote = {
    ...remote,
    doc: {
      ...remote.doc,
      participants: remote.doc.participants.map((p) =>
        p.id === 'person02' ? { ...p, origin: { name: '원래 집', lng: 127, lat: 37.5 } } : p,
      ),
    },
    replies: [
      {
        participantId: 'person02',
        name: '친구',
        origin: { name: '회사', lng: 128, lat: 36 },
        likes: [],
        times: { choice01: 7 },
        updatedAt: now,
      },
    ],
  };
  await setup();
  expect(screen.queryByRole('button', { name: '원래 출발지로 되돌리기' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '내 출발지 고르기' }));
  fireEvent.click(screen.getByRole('button', { name: '시험 출발지' }));
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledWith(
    'meeting001',
    expect.objectContaining({ origin: { name: '새 출발지', lng: 128, lat: 36 } }),
    token,
  );
});
it('기존 주최자의 좋아요는 재연결 뒤에도 살아 있는 후보만 남긴다', async () => {
  library = {
    ...library,
    meetings: {
      meeting001: buildMeeting({
        replies: f({ person01: { likes: ['choice01', 'choice03'], sentAt: now, receivedAt: now } }),
        candidates: f([
          ...remote.doc.candidates,
          { id: 'choice03', kind: 'hub', name: '옛 후보', lng: 127, lat: 37.5 },
        ]),
      }),
    },
  };
  remote = { rev: remote.rev, docRev: remote.docRev, doc: remote.doc, replies: remote.replies };
  await setup(`/meet/meeting001#h=${hostToken}`);
  expect(library.meetings?.meeting001?.replies.value.person01?.likes).toEqual(['choice01']);
});

it('이전 버전의 되돌리기 초안도 null 출발지를 보내지 않는다', async () => {
  guest();
  saveMeetDraft('meeting001', {
    participantId: 'person02',
    likes: ['choice01'],
    origin: null,
    times: null,
  });
  await setup();
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(
    'meeting001',
    { likes: ['choice01'] },
    token,
  );
});

it('초안 없이 직선거리에서 대중교통으로 바뀌면 옛 m 값을 숨기고 내 줄을 재계산해 저장한다', async () => {
  guest();
  const origin = { name: '내 회사', lng: 128, lat: 36 };
  remote = {
    ...remote,
    doc: { ...remote.doc, mode: 'straight', unit: 'm', times: { choice01: { person02: 4200 } } },
    replies: [
      {
        participantId: 'person02',
        name: '친구',
        origin,
        likes: ['choice01'],
        times: { choice01: 4200, choice02: 5000 },
        updatedAt: now,
      },
    ],
  };
  compute.times = { choice01: { person02: 4200 }, choice02: { person02: 5000 } };
  const view = render(<OnlineInviteView id="meeting001" />);
  await act(async () => {});
  expect(loadMeetDraft('meeting001')).toBeNull();
  expect(compute.compute).toHaveBeenCalledTimes(1);
  await advance(1000);
  expect(meetApi.reply).not.toHaveBeenCalled();
  remote = {
    ...remote,
    rev: 3,
    docRev: 2,
    doc: { ...remote.doc, mode: 'transit', unit: 'min' },
    replies: remote.replies.map((r) => ({ ...r, times: null })),
  };
  compute.pending = true;
  compute.times = {};
  await advance(9000);
  expect(screen.queryByText('4200分')).toBeNull();
  expect(screen.getByText('내 소요시간을 다시 찾는 중이에요')).toBeInTheDocument();
  expect(useMeetingCompute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      mode: 'transit',
      participants: [{ id: 'person02', name: '친구', origin }],
    }),
  );
  expect(compute.compute).toHaveBeenCalledTimes(2);
  expect(meetApi.reply).not.toHaveBeenCalled();
  compute.pending = false;
  compute.times = { choice01: { person02: 11 }, choice02: { person02: 13 } };
  view.rerender(<OnlineInviteView id="meeting001" />);
  expect(
    within(screen.getByRole('listitem', { name: '강남역' })).getByText('11분'),
  ).toBeInTheDocument();
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(
    'meeting001',
    {
      likes: ['choice01'],
      times: { choice01: 11, choice02: 13 },
      docRev: 2,
    },
    token,
  );
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledTimes(1);
});

it('주최자 답장의 좋아요도 친구 화면의 온라인 집계에 들어간다', async () => {
  guest();
  remote = {
    ...remote,
    replies: [
      {
        participantId: 'person01',
        name: '주최자',
        origin: null,
        likes: ['choice01'],
        times: null,
        updatedAt: now,
      },
    ],
  };
  await setup();
  expect(screen.getByText('좋아요 1명 · 주최자')).toBeInTheDocument();
  expect(
    within(screen.getByRole('listitem', { name: '강남역' })).getByText('10분'),
  ).toBeInTheDocument();
});

it('내 출발지가 없으면 지난 계산이 stale이어도 좋아요를 저장한다', async () => {
  guest();
  compute.stale = true;
  await setup();
  like();
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(
    'meeting001',
    { likes: ['choice01'] },
    token,
  );
});
it('이전 null 출발지 초안이 있어도 서버에 저장된 내 출발지로 계산한다', async () => {
  guest();
  const origin = { name: '내 회사', lng: 128, lat: 36 };
  remote = {
    ...remote,
    replies: [
      { participantId: 'person02', name: '친구', origin, likes: [], times: null, updatedAt: now },
    ],
  };
  saveMeetDraft('meeting001', { participantId: 'person02', likes: [], origin: null, times: null });
  await setup();
  expect(
    within(screen.getByRole('region', { name: '내 출발지' })).getByText('내 회사'),
  ).toBeInTheDocument();
  expect(useMeetingCompute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      participants: [{ id: 'person02', name: '친구', origin }],
    }),
  );
});

it('새 기기에서 주최자 링크를 담으면 서버 주최자 좋아요도 남는다', async () => {
  remote = {
    rev: remote.rev,
    docRev: remote.docRev,
    doc: remote.doc,
    replies: [
      {
        participantId: 'person01',
        name: '주최자',
        origin: null,
        likes: ['choice01'],
        times: null,
        updatedAt: now,
      },
    ],
  };
  await setup(`/meet/meeting001#h=${hostToken}`);
  expect(library.meetings?.meeting001?.replies.value.person01).toEqual({
    likes: ['choice01'],
    sentAt: now,
    receivedAt: now,
  });
  await advance(1000);
  expect(meetApi.reply).not.toHaveBeenCalled();
});

it.each([null, { name: '내 회사', lng: 128, lat: 36 }])(
  '주최자 링크로 담은 직후 시각만 새로 붙은 본문에서도 답장 출발지 %j의 23분을 표시한다',
  async (origin) => {
    const { useOnlineMeeting } = await import('src/sections/meetings/use-online-meeting');
    const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
    remote = {
      rev: remote.rev,
      docRev: remote.docRev,
      doc: remote.doc,
      replies: [
        {
          participantId: 'person02',
          name: '친구',
          origin,
          likes: [],
          times: { choice01: 23 },
          updatedAt: '2026-10-26T00:00:00.000Z',
        },
      ],
    };
    function HostResults() {
      const meeting = library.meetings!.meeting001!;
      const online = useOnlineMeeting(meeting, { times: {}, unit: 'min', pending: false });
      return <MeetingResults meeting={meeting} library={library} online={online} />;
    }
    await setup(`/meet/meeting001#h=${hostToken}`, <HostResults />);
    expect(library.meetings!.meeting001!.mode.updatedAt).toBe(now);
    expect(screen.getByText('23분')).toBeInTheDocument();
  },
);

it('내 소요시간에는 계산한 본문 버전을 붙인다', async () => {
  guest();
  remote = { ...remote, docRev: 5 };
  compute.times = { choice01: { person02: 7 }, choice02: { person02: 9 } };
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '내 출발지 고르기' }));
  fireEvent.click(screen.getByRole('button', { name: '시험 출발지' }));
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledWith(
    'meeting001',
    expect.objectContaining({ times: { choice01: 7, choice02: 9 }, docRev: 5 }),
    token,
  );
});

it('서버가 옛 조건의 시간을 버리면 다음 확인 뒤 새 조건으로 재계산해 보낸다', async () => {
  guest();
  compute.times = { choice01: { person02: 7 }, choice02: { person02: 9 } };
  await setup();
  vi.mocked(meetApi.reply).mockResolvedValueOnce({
    ok: true,
    value: { rev: 4, timesDropped: true },
  });
  fireEvent.click(screen.getByRole('button', { name: '내 출발지 고르기' }));
  fireEvent.click(screen.getByRole('button', { name: '시험 출발지' }));
  await advance(1000);
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledTimes(1);
  remote = {
    ...remote,
    rev: 4,
    docRev: 2,
    doc: { ...remote.doc, mode: 'car' },
    replies: [
      {
        participantId: 'person02',
        name: '친구',
        origin: { name: '새 출발지', lng: 128, lat: 36 },
        likes: [],
        times: null,
        updatedAt: now,
      },
    ],
  };
  compute.times = { choice01: { person02: 17 }, choice02: { person02: 19 } };
  await advance(8000);
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledTimes(2);
  expect(meetApi.reply).toHaveBeenLastCalledWith(
    'meeting001',
    { likes: [], times: { choice01: 17, choice02: 19 }, docRev: 2 },
    token,
  );
});

it('좋아요만 저장한 친구는 본문의 20분을 계속 표시한다', async () => {
  guest();
  await setup();
  expect(
    within(screen.getByRole('listitem', { name: '강남역' })).getByText('20분'),
  ).toBeInTheDocument();
  like();
  await advance(1000);
  expect(
    within(screen.getByRole('listitem', { name: '강남역' })).getByText('20분'),
  ).toBeInTheDocument();
});

it.each([null, { choice01: 99 }])(
  '남의 답장 출발지가 null이어도 답장 시간 %j가 있으면 쓰고 없으면 본문 시간을 쓴다',
  async (times) => {
    guest();
    remote = {
      ...remote,
      doc: { ...remote.doc, times: { choice01: { person01: 10, person02: 20, person03: 30 } } },
      replies: [
        {
          participantId: 'person03',
          name: '다른 친구',
          origin: null,
          likes: [],
          times,
          updatedAt: now,
        },
      ],
    };
    await setup();
    const row = within(screen.getByRole('listitem', { name: '강남역' }));
    expect(row.getByText(times === null ? '30분' : '1시간 39분')).toBeInTheDocument();
    expect(row.queryByText(times === null ? '1시간 39분' : '30분')).toBeNull();
  },
);

it('서버가 남의 답장 좌표를 가려도 바꾼 출발지의 소요시간을 표시한다', async () => {
  guest();
  remote = redactForGuest(
    {
      ...remote,
      doc: { ...remote.doc, times: { choice01: { person01: 10, person02: 20, person03: 30 } } },
      replies: [
        {
          participantId: 'person03',
          name: '다른 친구',
          origin: { name: '새 회사', lng: 128, lat: 36 },
          likes: [],
          times: { choice01: 17, choice02: 23 },
          updatedAt: now,
        },
      ],
    },
    'person02',
  );
  expect(remote.replies[0]?.origin).toBeNull();
  expect(remote.replies[0]?.times).toEqual({ choice01: 17, choice02: 23 });
  await setup();
  const row = within(screen.getByRole('listitem', { name: '강남역' }));
  expect(row.getByText('17분')).toBeInTheDocument();
  expect(row.queryByText('30분')).toBeNull();
  expect(
    within(screen.getByRole('listitem', { name: '시청역' })).getByText('23분'),
  ).toBeInTheDocument();
});

it('확정된 약속을 처음 열어도 참석자를 고른 뒤 자기 출발 길찾기를 연다', async () => {
  remote = { ...remote, doc: { ...remote.doc, decided: 'choice01' } };
  await setup();
  expect(screen.getByRole('heading', { name: '확정 · 강남역' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '나는 누구?' })).toBeInTheDocument();
  remote = {
    ...remote,
    doc: {
      ...remote.doc,
      participants: remote.doc.participants.map((p) =>
        p.id === 'person02' ? { ...p, origin: { name: '내 집', lng: 127, lat: 37.5 } } : p,
      ),
    },
  };
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '친구' }));
  });
  expect(meetApi.claim).toHaveBeenCalledWith(
    'meeting001',
    { participantId: 'person02' },
    expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  );
  expect(screen.queryByRole('region', { name: '나는 누구?' })).toBeNull();
  expect(screen.getByRole('link', { name: '친구 출발 길찾기' })).toBeInTheDocument();
});

it('확정 화면에서도 이미 차지한 참석자를 고르면 기존 taken 안내를 보인다', async () => {
  remote = { ...remote, doc: { ...remote.doc, decided: 'choice01' } };
  vi.mocked(meetApi.claim).mockResolvedValueOnce({ ok: false, error: { code: 'taken' } });
  await setup();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '친구' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    '다른 기기에서 이미 답했어요. 주최자에게 풀어 달라고 하세요',
  );
});

it('주최자 링크 재연결도 올리지 않은 로컬 본문과 버전을 보존한다', async () => {
  const syncedDoc = remote.doc;
  writeOnline('meeting001', { hostToken, docRev: 1, lastRev: 1, syncedDoc });
  library = { ...library, meetings: { meeting001: buildMeeting({ title: f('미전송 제목') }) } };
  remote = { rev: 3, docRev: 2, doc: remote.doc, replies: [] };
  await setup(`/meet/meeting001#h=${hostToken}`);
  expect(library.meetings?.meeting001?.title.value).toBe('미전송 제목');
  expect(readOnline('meeting001')).toMatchObject({ docRev: 1, syncedDoc, lastRev: 3 });
});

it.each([
  ...['응답', '보관함 연산', '저장 완료'].flatMap((stage) => [
    { stage, lastRev: 5, savedToken: 'n'.repeat(43) },
    { stage, lastRev: 5, savedToken: hostToken },
    { stage, lastRev: 2, savedToken: 'n'.repeat(43) },
  ]),
])(
  '늦은 주최자 링크 응답은 더 새 기록과 같은 버전의 새 토큰을 지킨다: %j',
  async ({ stage, lastRev, savedToken }) => {
    const syncedDoc = remote.doc;
    writeOnline('meeting001', { hostToken, lastRev: 1, docRev: 1, syncedDoc });
    const late: OnlineState = {
      rev: 2,
      docRev: 1,
      doc: syncedDoc,
      replies: [
        {
          participantId: 'person01',
          name: '주최자',
          origin: null,
          likes: ['choice02'],
          times: null,
          updatedAt: now,
        },
      ],
    };
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (stage === '보관함 연산') runWait.before = waiting;
    if (stage === '저장 완료') runWait.after = waiting;
    vi.mocked(meetApi.get).mockImplementationOnce(async () => {
      if (stage === '응답') await waiting;
      return { ok: true, value: late };
    });
    const router = await setup(`/meet/meeting001#h=${hostToken}`);
    const latestMeeting = buildMeeting({
      participants: f(syncedDoc.participants),
      candidates: f(syncedDoc.candidates),
      replies: f({ person01: { likes: ['choice01'], sentAt: now, receivedAt: now } }),
    });
    library = { ...library, meetings: { meeting001: latestMeeting } };
    const latestLibrary = library;
    const record = {
      hostToken: savedToken,
      lastRev,
      docRev: 1,
      syncedDoc,
      hostLikes: ['choice01'],
    };
    // 링크 조회를 기다리는 동안 다른 탭에서 동기화하고 토큰을 다시 발급한 상태다.
    writeOnline('meeting001', record);
    await act(async () => {
      finish();
    });
    expect(router.state.location.pathname).toBe('/meetings/meeting001');
    expect(library).toBe(latestLibrary);
    expect(library.meetings?.meeting001?.replies.value.person01?.likes).toEqual(['choice01']);
    expect(readOnline('meeting001')).toEqual(record);
  },
);

it('보관함에서 지운 약속도 유효한 주최자 링크로 다시 담는다', async () => {
  library = { ...library, meetings: { meeting001: buildMeeting({ deletedAt: now }) } };
  remote = { rev: remote.rev, docRev: remote.docRev, doc: remote.doc, replies: [] };
  const router = await setup(`/meet/meeting001#h=${hostToken}`);
  expect(library.meetings?.meeting001?.deletedAt).toBeNull();
  expect(router.state.location.pathname).toBe('/meetings/meeting001');
});

it.each([false, true])(
  '주최자 링크도 답장 전용 참석자의 seen을 이어받는다(이미 지움=%s)',
  async (deleted) => {
    if (deleted) {
      library = { ...library, meetings: { meeting001: buildMeeting() } };
      writeOnline('meeting001', {
        hostToken,
        lastRev: 1,
        docRev: 1,
        syncedDoc: remote.doc,
        seen: ['person04'],
      });
    }
    remote = {
      rev: 3,
      docRev: 1,
      doc: remote.doc,
      replies: [
        {
          participantId: 'person04',
          name: '새 친구',
          origin: null,
          likes: ['choice01'],
          times: null,
          updatedAt: now,
        },
      ],
    };
    await setup(`/meet/meeting001#h=${hostToken}`);
    expect(library.meetings?.meeting001?.participants.value.some((p) => p.id === 'person04')).toBe(
      !deleted,
    );
    expect(Boolean(library.meetings?.meeting001?.replies.value.person04)).toBe(!deleted);
    expect(readOnline('meeting001')?.seen).toEqual(['person04']);
  },
);

it('주최자 링크에서도 seen이 차면 서버에 남은 삭제 기록을 우선 보존한다', async () => {
  const oldIds = Array.from({ length: 9 }, (_, i) => `guest00${i + 1}`);
  const local = buildMeeting({ participants: f([remote.doc.participants[0]!]) });
  library = { ...library, meetings: { meeting001: local } };
  writeOnline('meeting001', {
    hostToken,
    lastRev: 1,
    docRev: 1,
    syncedDoc: remote.doc,
    seen: oldIds,
  });
  const replyIds = ['guest001', ...Array.from({ length: 8 }, (_, i) => `new0000${i + 1}`)];
  remote = {
    rev: 3,
    docRev: 1,
    doc: { ...remote.doc, participants: [remote.doc.participants[0]!] },
    replies: replyIds.map((participantId) => ({
      participantId,
      name: '친구',
      origin: null,
      likes: [],
      times: null,
      updatedAt: now,
    })),
  };
  await setup(`/meet/meeting001#h=${hostToken}`);
  expect(readOnline('meeting001')?.seen).toContain('guest001');
  expect(readOnline('meeting001')!.seen!.length).toBeLessThanOrEqual(10);
  expect(library.meetings?.meeting001?.participants.value.some((p) => p.id === 'guest001')).toBe(
    false,
  );
});

it.each([{ likes: [] }, { likes: ['choice01'] }])(
  '주최자 링크를 담을 때 좋아요 기준을 남긴다(%j)',
  async ({ likes }) => {
    remote = {
      rev: remote.rev,
      docRev: remote.docRev,
      doc: remote.doc,
      replies:
        likes.length === 0
          ? []
          : [
              {
                participantId: 'person01',
                name: '주최자',
                origin: null,
                likes,
                times: null,
                updatedAt: now,
              },
            ],
    };
    await setup(`/meet/meeting001#h=${hostToken}`);
    expect(readOnline('meeting001')?.hostLikes).toEqual(likes);
  },
);

it('지워진 참석자를 고르면 목록을 다시 읽어 안내하고 확인을 계속한다', async () => {
  await setup();
  remote = {
    ...remote,
    rev: 3,
    docRev: 2,
    doc: {
      ...remote.doc,
      participants: remote.doc.participants.filter((p) => p.id !== 'person02'),
    },
  };
  vi.mocked(meetApi.claim).mockResolvedValueOnce({ ok: false, error: { code: 'not-found' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '친구' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    '그 참석자는 이제 목록에 없어요. 다시 골라 주세요',
  );
  expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, null);
  expect(screen.queryByRole('button', { name: '친구' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다른 친구' })).toBeEnabled();
  expect(readOnline('meeting001')?.pendingGuest).toEqual({
    participantId: 'person02',
    token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  });
  expect(readOnline('meeting001')?.guest).toBeUndefined();
  expect(screen.queryByText('끝난 약속이에요')).not.toBeInTheDocument();
  const reads = vi.mocked(meetApi.get).mock.calls.length;
  await advance(10000);
  expect(meetApi.get).toHaveBeenCalledTimes(reads + 1);
  expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', 3, null);
});

it.each(['ended', 'not-found'] as const)(
  '차지 실패 뒤 읽기가 %s이면 끝난 약속을 보인다',
  async (code) => {
    await setup();
    vi.mocked(meetApi.claim).mockResolvedValueOnce({ ok: false, error: { code: 'not-found' } });
    vi.mocked(meetApi.get).mockResolvedValue({ ok: false, error: { code } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '친구' }));
    });
    expect(meetApi.get).toHaveBeenCalledTimes(2);
    expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, null);
    expect(screen.getByRole('heading', { name: '끝난 약속이에요' })).toBeInTheDocument();
  },
);

it('주최자 링크의 옛 확인도 저장 완료한 주최자 좋아요 기준을 되돌리지 않는다', async () => {
  const meeting = buildMeeting({
    replies: f({ person01: { likes: ['choice01'], sentAt: now, receivedAt: now } }),
  });
  library = { ...library, meetings: { meeting001: meeting } };
  writeOnline('meeting001', {
    hostToken,
    lastRev: 1,
    docRev: 1,
    syncedDoc: docFromMeeting(meeting, {}, 'min'),
    hostLikes: ['choice01'],
    hostLikesAckRev: 3,
  });
  remote = {
    doc: remote.doc,
    docRev: remote.docRev,
    rev: 2,
    replies: [
      {
        participantId: 'person01',
        name: '주최자',
        origin: null,
        likes: [],
        times: null,
        updatedAt: now,
      },
    ],
  };
  await setup(`/meet/meeting001#h=${hostToken}`);
  expect(library.meetings?.meeting001?.replies.value.person01?.likes).toEqual(['choice01']);
  expect(readOnline('meeting001')).toMatchObject({
    hostLikes: ['choice01'],
    hostLikesAckRev: 3,
    lastRev: 2,
  });
});

it('주최자 링크에서 미전송 좋아요를 보존해도 서버 좋아요 기준을 남긴다', async () => {
  library = {
    ...library,
    meetings: {
      meeting001: buildMeeting({
        replies: f({ person01: { likes: ['choice01'], sentAt: now, receivedAt: now } }),
      }),
    },
  };
  remote = {
    rev: remote.rev,
    docRev: remote.docRev,
    doc: remote.doc,
    replies: [
      {
        participantId: 'person01',
        name: '주최자',
        origin: null,
        likes: ['choice02'],
        times: null,
        updatedAt: now,
      },
    ],
  };
  await setup(`/meet/meeting001#h=${hostToken}`);
  expect(library.meetings?.meeting001?.replies.value.person01?.likes).toEqual(['choice01']);
  expect(readOnline('meeting001')?.hostLikes).toEqual(['choice02']);
});

it.each(['기존 참석자', '새 이름'] as const)(
  '응답 유실 뒤 같은 선택은 저장한 토큰으로 재시도해 좋아요 화면을 연다: %s',
  async (choice) => {
    const { webcrypto } = await import('node:crypto');
    const { createSqliteD1 } = await import('../../../helpers/sqlite-d1');
    const { handleCreate, handleClaim } = await import('src/server/meet/handlers');
    const { meetApi: actualApi } = await vi.importActual<
      typeof import('src/services/meet-online/client')
    >('src/services/meet-online/client');
    vi.stubGlobal('crypto', webcrypto);
    const db = createSqliteD1();
    const pending: Promise<unknown>[] = [];
    const newPerson = choice === '새 이름';
    const who = newPerson ? { newName: '새 친구' } : { participantId: 'person02' };
    const sentTokens: string[] = [];
    const storedBeforeRequest: boolean[] = [];
    const statuses: number[] = [];
    const ctx = (request: Request) => ({
      request,
      env: { DB: db },
      params: { id: 'meeting001' },
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p);
      },
    });
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      sentTokens.push(body.guestToken);
      storedBeforeRequest.push(
        JSON.stringify(readOnline('meeting001')?.pendingGuest) ===
          JSON.stringify({ ...who, token: body.guestToken }),
      );
      const response = await handleClaim(
        ctx(
          new Request('http://localhost:8788/api/meet/meeting001/claim', {
            ...init,
            headers: { Origin: 'http://localhost:8788' },
          }),
        ),
        { now: () => new Date(), fetch: fetchMock },
      );
      statuses.push(response.status);
      await Promise.all(pending);
      if (sentTokens.length === 1) throw new TypeError('응답 유실');
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);
    let claimFlight: ReturnType<typeof actualApi.claim> | undefined;
    vi.mocked(meetApi.claim).mockImplementation((...args) => {
      claimFlight = actualApi.claim(...args);
      return claimFlight;
    });
    try {
      const created = await handleCreate(
        ctx(
          new Request('http://localhost:8788/api/meet', {
            method: 'POST',
            headers: { Origin: 'http://localhost:8788' },
            body: JSON.stringify({ doc: remote.doc, hostToken, turnstile: 'dev' }),
          }),
        ),
        { now: () => new Date(), fetch: fetchMock },
      );
      expect(created.status).toBe(201);
      await setup();
      if (newPerson) {
        fireEvent.click(screen.getByRole('button', { name: '목록에 없어요' }));
        fireEvent.change(screen.getByRole('textbox', { name: '내 이름' }), {
          target: { value: '새 친구' },
        });
      }
      const choose = async () =>
        act(async () => {
          fireEvent.click(screen.getByRole('button', { name: newPerson ? '참석하기' : '친구' }));
          await claimFlight;
        });
      await choose();
      expect(statuses).toEqual([200]);
      expect(sentTokens[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(readOnline('meeting001')?.pendingGuest).toEqual({ ...who, token: sentTokens[0] });
      expect(readOnline('meeting001')?.guest).toBeUndefined();
      expect(screen.getByText('나는 누구?')).toBeInTheDocument();
      await choose();
      expect(statuses).toEqual([200, 200]);
      expect(storedBeforeRequest).toEqual([true, true]);
      expect(sentTokens).toEqual([sentTokens[0], sentTokens[0]]);
      expect(readOnline('meeting001')?.pendingGuest).toBeUndefined();
      expect(readOnline('meeting001')?.guest?.token).toBe(sentTokens[0]);
      expect(
        await db
          .prepare("SELECT COUNT(*) AS count FROM meeting_tokens WHERE kind = 'guest'")
          .first(),
      ).toEqual({ count: 1 });
      expect(await db.prepare('SELECT COUNT(*) AS count FROM meeting_replies').first()).toEqual({
        count: newPerson ? 1 : 0,
      });
      expect(screen.queryByText('나는 누구?')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '강남역 좋아요' })).toBeEnabled();
    } finally {
      await Promise.all(pending);
      db.close();
      vi.unstubAllGlobals();
    }
  },
);

it('다른 참석자를 고르면 대기 토큰을 새로 만들고 같은 참석자는 복원한 토큰으로 다시 고른다', async () => {
  const pendingGuest = { participantId: 'person02', token };
  writeOnline('meeting001', { pendingGuest });
  vi.mocked(meetApi.claim).mockResolvedValue({ ok: false, error: { code: 'offline' } });
  await setup();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '친구' }));
  });
  expect(meetApi.claim).toHaveBeenLastCalledWith(
    'meeting001',
    { participantId: 'person02' },
    token,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '다른 친구' }));
  });
  const next = readOnline('meeting001')?.pendingGuest;
  expect(next?.participantId).toBe('person03');
  expect(next?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(next?.token).not.toBe(token);
  expect(meetApi.claim).toHaveBeenLastCalledWith(
    'meeting001',
    { participantId: 'person03' },
    next?.token,
  );
});

it.each(['성공', '실패', '401'] as const)(
  '답장 %s 응답은 다른 탭의 새 초안을 지우거나 덮지 않는다',
  async (outcome) => {
    guest();
    await setup();
    let finish!: (value: Awaited<ReturnType<typeof meetApi.reply>>) => void;
    vi.mocked(meetApi.reply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    like();
    await advance(1000);
    const fresh = { participantId: 'person02', likes: ['choice02'] };
    saveMeetDraft('meeting001', fresh);
    await act(async () =>
      finish(
        outcome === '성공'
          ? { ok: true, value: { rev: 4 } }
          : { ok: false, error: { code: outcome === '401' ? 'unauthorized' : 'offline' } },
      ),
    );
    expect(loadMeetDraft('meeting001')).toEqual(fresh);
  },
);

it('계산을 기다리는 동안 다른 탭이 쓴 초안을 예전 계산 결과로 덮지 않는다', async () => {
  guest();
  await setup();
  like();
  const fresh = { participantId: 'person02', likes: ['choice02'] };
  saveMeetDraft('meeting001', fresh);
  await advance(1000);
  expect(loadMeetDraft('meeting001')).toEqual(fresh);
});

it.each([false, true])(
  '지연된 claim 성공은 다른 탭의 새 선택과 복구 토큰을 지킨다(재시도=%s)',
  async (retry) => {
    if (retry)
      writeOnline('meeting001', {
        pendingGuest: { participantId: 'person02', token: 'p'.repeat(43) },
      });
    await setup();
    let finish!: (value: Awaited<ReturnType<typeof meetApi.claim>>) => void;
    vi.mocked(meetApi.claim).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '친구' })));
    const fresh = {
      guest: { participantId: 'person03', token: 'b'.repeat(43) },
      pendingGuest: { participantId: 'person02', token: 'c'.repeat(43) },
    };
    writeOnline('meeting001', fresh);
    await act(async () =>
      finish({ ok: true, value: { participantId: 'person02', guestToken: token, rev: 3 } }),
    );
    expect(readOnline('meeting001')).toEqual(fresh);
  },
);

it('늦은 주최자 링크는 응답 버전이 더 커도 요청 중 교체된 토큰을 덮지 않는다', async () => {
  writeOnline('meeting001', { hostToken, lastRev: 1 });
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.mocked(meetApi.get).mockImplementationOnce(async () => {
    await wait;
    return { ok: true, value: { ...remote, rev: 9, originNames: undefined } };
  });
  await setup(`/meet/meeting001#h=${hostToken}`);
  const fresh = { hostToken: 'b'.repeat(43), pendingHostToken: 'c'.repeat(43), lastRev: 2 };
  writeOnline('meeting001', fresh);
  await act(async () => finish());
  expect(readOnline('meeting001')).toEqual(fresh);
  expect(library.meetings?.meeting001).toBeUndefined();
});

it.each(['성공', '401'] as const)(
  '답장 %s은 같은 내용으로 다시 쓴 초안의 새 버전도 지킨다',
  async (outcome) => {
    guest();
    await setup();
    let finish!: (value: Awaited<ReturnType<typeof meetApi.reply>>) => void;
    vi.mocked(meetApi.reply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    like();
    await advance(1000);
    const fresh = { participantId: 'person02', likes: ['choice01'] };
    saveMeetDraft('meeting001', fresh);
    await act(async () =>
      finish(
        outcome === '성공'
          ? { ok: true, value: { rev: 4 } }
          : { ok: false, error: { code: 'unauthorized' } },
      ),
    );
    expect(loadMeetDraft('meeting001')).toEqual(fresh);
  },
);

it('초안 쓰기가 막혀도 현재 화면의 답장을 보내고 실패 뒤 다시 시도한다', async () => {
  guest();
  await setup();
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'tripmap:meet-drafts:v1') throw new Error('용량 초과');
    setItem.call(this, key, value);
  });
  vi.mocked(meetApi.reply).mockResolvedValueOnce({ ok: false, error: { code: 'offline' } });
  like();
  await advance(1000);
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(
    'meeting001',
    { likes: ['choice01'] },
    token,
  );
  await advance(9000);
  expect(meetApi.reply).toHaveBeenCalledTimes(2);
  expect(meetApi.reply).toHaveBeenLastCalledWith('meeting001', { likes: ['choice01'] }, token);
});
