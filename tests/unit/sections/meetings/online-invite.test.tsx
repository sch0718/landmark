import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { docFromMeeting, type OnlineState } from 'src/domain/meeting/online-doc';
import { emptyLibrary, type Library } from 'src/schema/library';
import { meetApi } from 'src/services/meet-online/client';
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
      const out = op(library, {
        now,
        newId: () => {
          throw new Error('새 id를 만들면 안 돼요');
        },
      });
      if ('ok' in out && !out.ok) return out;
      library = 'ok' in out ? out.lib : out;
      return { ok: true };
    },
  }),
}));
async function setup(path = '/meet/meeting001') {
  const router = createMemoryRouter(
    [
      { path: '/meet/:id', element: <MeetLinkPage /> },
      { path: '/meetings/:id', element: <h1>주최자 화면</h1> },
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
it('고르면 기록을 저장하고 내 답장 화면을 연다', async () => {
  await setup();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '친구' }));
  });
  expect(meetApi.claim).toHaveBeenCalledWith('meeting001', { participantId: 'person02' });
  expect(readOnline('meeting001')?.guest).toEqual({ participantId: 'person02', token });
  expect(screen.getByRole('button', { name: '강남역 좋아요' })).toBeEnabled();
  expect(screen.queryByText('나는 누구?')).not.toBeInTheDocument();
  expect(meetApi.get).toHaveBeenLastCalledWith('meeting001', null, token);
  expect(meetApi.reply).not.toHaveBeenCalled();
});
it('목록에 없는 이름은 정리해서 차지한다', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '목록에 없어요' }));
  fireEvent.change(screen.getByRole('textbox', { name: '내 이름' }), {
    target: { value: ' 새 친구 ' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '참석하기' }));
  });
  expect(meetApi.claim).toHaveBeenCalledWith('meeting001', { newName: '새 친구' });
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
  },
);
it('다른 사람 좋아요와 출발지 이름을 보이고 보관함은 쓰지 않는다', async () => {
  guest();
  remote = {
    ...remote,
    replies: [
      {
        participantId: 'person03',
        name: '다른 친구',
        origin: null,
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
      syncedAt: now,
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

it('답장을 보내는 동안 더 고친 좋아요도 앞 요청 뒤에 이어서 저장한다', async () => {
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
  await act(async () => {
    finish({ ok: true, value: { rev: 4 } });
  });
  expect(loadMeetDraft('meeting001')?.likes).toEqual(['choice01', 'choice02']);
  await advance(1000);
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
