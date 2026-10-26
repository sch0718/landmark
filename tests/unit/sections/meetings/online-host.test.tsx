import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { Effect } from 'effect';
import { RouteLookup } from 'src/services/route-lookup';
import * as effectRuntime from 'src/lib/effect/runtime';
import { haversineM } from 'src/domain/trips/geo';
import { removeCandidate } from 'src/domain/meeting/ops';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { useLibraryAction } from 'src/stores/library-state';
type LibraryOp = Parameters<ReturnType<typeof useLibraryAction>['run']>[0];
import type { Meeting } from 'src/schema/meeting';
import { emptyLibrary } from 'src/schema/library';
import { docFromMeeting, type OnlineState } from 'src/domain/meeting/online-doc';
import { meetApi, type OnlineError } from 'src/services/meet-online/client';
import { MEET_ONLINE_KEY, readOnline, writeOnline } from 'src/services/meet-online/store';
import { getTurnstileToken } from 'src/services/meet-online/turnstile-loader';
import { shareLink, shareMeetingDoc } from 'src/sections/meetings/share-link';
import { useOnlineMeeting, type OnlineCompute } from 'src/sections/meetings/use-online-meeting';
import { OnlineHostMenu } from 'src/sections/meetings/OnlineHostMenu';
import { OnlineInviteView } from 'src/sections/meetings/OnlineInviteView';
import { buildMeeting } from '../../../fixtures/builders';

vi.mock('src/components/map/MapView', () => ({ MapView: () => <div /> }));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(async () => {}) }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
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
  writeOnline(saved.id, { hostToken: token, lastRev: 1, docRev: 1, syncedDoc: state().doc });
}

it.each(['성공', '실패', '전송 중 새 출발지'] as const)(
  '합친 B를 저장된 A로 되돌리면 본문이 같아도 답장 출발지를 비우도록 올린다: %s',
  async (outcome) => {
    const originA = { name: '저장된 A', lng: 127, lat: 37.5 };
    const originB = { name: '친구 B', lng: 128, lat: 38 };
    const originD = { name: '새 친구 D', lng: 126.5, lat: 37.2 };
    saved = {
      ...saved,
      participants: f(
        saved.participants.value.map((p) => (p.id === 'person02' ? { ...p, origin: originA } : p)),
      ),
    };
    online();
    const baseline = state().doc;
    vi.mocked(meetApi.get).mockResolvedValueOnce({
      ok: true,
      value: state({
        replies: [
          {
            participantId: 'person02',
            name: '친구',
            origin: originB,
            likes: [],
            times: null,
            updatedAt: startAt,
          },
        ],
      }),
    });
    setup();
    await flush();
    expect(saved.participants.value[1]?.origin).toEqual(originB);
    await edit({ participants: f(baseline.participants) });
    let finish!: (value: Awaited<ReturnType<typeof meetApi.update>>) => void;
    vi.mocked(meetApi.update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await advance(1000);
    expect(meetApi.update).toHaveBeenCalledExactlyOnceWith(
      saved.id,
      baseline,
      1,
      token,
      [],
      expect.any(AbortSignal),
      [{ participantId: 'person02', origin: originB }],
    );
    if (outcome === '전송 중 새 출발지')
      writeOnline(saved.id, {
        ...readOnline(saved.id)!,
        replyOrigins: { person02: originD },
      });
    await act(async () =>
      finish(
        outcome === '실패'
          ? { ok: false, error: { code: 'offline' } }
          : { ok: true, value: { rev: 3, docRev: 2 } },
      ),
    );
    expect(readOnline(saved.id)?.replyOrigins ?? {}).toEqual(
      outcome === '성공' ? {} : { person02: outcome === '실패' ? originB : originD },
    );
  },
);

it.each(['person01', 'person02'])(
  '올리기 전 %s 출발지 수정은 원격 제목에 덮이지 않고 다음 올리기에 실린다',
  async (pid) => {
    online();
    const syncedDoc = state().doc;
    const changed = { name: '새 집', lng: 128, lat: 38 };
    saved = {
      ...saved,
      participants: f(
        saved.participants.value.map((p) => (p.id === pid ? { ...p, origin: changed } : p)),
      ),
    };
    vi.mocked(meetApi.get).mockResolvedValue({
      ok: true,
      value: state({ docRev: 2, doc: { ...syncedDoc, title: '다른 기기 제목' } }),
    });
    setup();
    await flush();
    expect(saved.participants.value.find((p) => p.id === pid)?.origin).toEqual(changed);
    expect(saved.title.value).toBe(syncedDoc.title);
    await advance(1100);
    expect(meetApi.update).toHaveBeenCalledWith(
      saved.id,
      expect.objectContaining({ participants: saved.participants.value }),
      1,
      token,
      [],
      expect.any(AbortSignal),
      [],
    );
  },
);

it('주최자 기기의 친구 화면은 동기화 기준을 지키고 다음 주최자 확인이 다른 기기의 확정을 받는다', async () => {
  const syncedDoc = state().doc;
  writeOnline(saved.id, {
    hostToken: token,
    pendingHostToken: 'p'.repeat(43),
    lastRev: 3,
    docRev: 2,
    syncedDoc,
    hostLikes: [],
    seen: [],
  });
  let remote = state({ rev: 3, docRev: 2, doc: syncedDoc });
  vi.mocked(meetApi.get).mockImplementation(async (_id, since, auth) => ({
    ok: true,
    value:
      since === remote.rev
        ? 'unchanged'
        : auth === token
          ? structuredClone(remote)
          : { ...structuredClone(remote), originNames: {} },
  }));
  setup();
  await flush();
  const hostRecord = readOnline(saved.id);
  remote = state({ rev: 5, docRev: 4, doc: { ...syncedDoc, decided: 'choice01' } });
  render(
    <MemoryRouter>
      <OnlineInviteView id={saved.id} />
    </MemoryRouter>,
  );
  await flush();
  expect(screen.getByRole('heading', { name: '확정 · 강남역' })).toBeInTheDocument();
  expect.soft(readOnline(saved.id)).toEqual(hostRecord);

  await advance(10000);
  expect.soft(meetApi.get).toHaveBeenCalledWith(saved.id, 3, token, expect.any(AbortSignal));
  expect(saved.decided.value).toBe('choice01');
  expect(readOnline(saved.id)).toMatchObject({ lastRev: 5, docRev: 4, syncedDoc: remote.doc });
  await advance(1100);
  expect(meetApi.update).not.toHaveBeenCalled();
});

it.each([false, true])(
  '친구 출발지를 합친 뒤 화면 재진입=%s여도 서버 확정을 받고 옛 확정을 올리지 않는다',
  async (reopen) => {
    online();
    const firstDoc = state().doc;
    writeOnline(saved.id, { ...readOnline(saved.id)!, syncedDoc: firstDoc });
    const reply = {
      participantId: 'person02',
      name: '친구',
      origin: { name: '회사', lng: 128, lat: 38 },
      likes: [],
      times: null,
      updatedAt: startAt,
    };
    const inputCompute = { ...compute, pending: true };
    const first = setup(inputCompute);
    await flush();
    vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: true, value: state({ replies: [reply] }) });
    await advance(10000);
    const remoteDoc = { ...firstDoc, decided: 'choice01' };
    vi.mocked(meetApi.get).mockResolvedValue({
      ok: true,
      value: state({ rev: 3, docRev: 2, doc: remoteDoc, replies: [reply] }),
    });
    if (reopen) {
      // 새 훅은 보관한 본문으로 첫 화면의 미전송 여부를 판단한다.
      first.unmount();
      setup();
      await flush();
    } else {
      await advance(10000);
      inputCompute.pending = false;
      first.rerender();
    }
    expect(saved.decided.value).toBe('choice01');
    await advance(1100);
    for (const call of vi.mocked(meetApi.update).mock.calls)
      expect(call[1].decided).toBe('choice01');
    expect(readOnline(saved.id)?.syncedDoc?.decided).toBe('choice01');
  },
);

it.each([false, true])(
  '두 번 나눠 받은 출발지와 주최자 직접 수정=%s를 구별해 재진입 뒤 서버 확정을 받는다',
  async (hostEdit) => {
    saved = {
      ...saved,
      participants: f([
        ...saved.participants.value,
        { id: 'person03', name: '친구 둘', origin: null },
      ]),
    };
    online();
    const initialDoc = state().doc;
    const originA = { name: '회사', lng: 128, lat: 38 };
    const originB = { name: '학교', lng: 127.5, lat: 37.5 };
    const a = {
      participantId: 'person02',
      name: '친구',
      origin: originA,
      likes: [],
      times: null,
      updatedAt: startAt,
    };
    const b = { ...a, participantId: 'person03', name: '친구 둘', origin: originB };
    vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: true, value: state({ replies: [a] }) });
    const first = setup({ ...compute, pending: true });
    await flush();
    vi.mocked(meetApi.get).mockResolvedValueOnce({
      ok: true,
      value: state({ rev: 3, replies: [a, b] }),
    });
    await advance(10000);
    const replyParticipants = saved.participants.value;
    expect
      .soft(readOnline(saved.id)?.replyOrigins)
      .toEqual({ person02: originA, person03: originB });
    const hostOrigin = { name: '주최자가 고친 출발지', lng: 126.5, lat: 37.2 };
    if (hostEdit)
      await edit({
        participants: f(
          saved.participants.value.map((p) =>
            p.id === 'person03' ? { ...p, origin: hostOrigin } : p,
          ),
          new Date().toISOString(),
        ),
      });
    const finalDoc = { ...initialDoc, participants: replyParticipants, decided: 'choice01' };
    vi.mocked(meetApi.get).mockResolvedValue({
      ok: true,
      value: state({
        rev: 4,
        docRev: 2,
        doc: finalDoc,
        replies: [
          { ...a, origin: null },
          { ...b, origin: null },
        ],
      }),
    });
    first.unmount();
    setup({ ...compute, pending: true });
    await flush();
    expect(saved.decided.value).toBe(hostEdit ? null : 'choice01');
    expect(saved.participants.value.find((p) => p.id === 'person03')?.origin).toEqual(
      hostEdit ? hostOrigin : originB,
    );
    expect(meetApi.update).not.toHaveBeenCalled();
  },
);

it.each(['성공', '실패', '전송 중 새 출발지'] as const)(
  '본문 올리기 %s 때 덮어쓰지 않은 마지막 답장 출발지를 보존한다',
  async (outcome) => {
    online();
    const origin = { name: '회사', lng: 128, lat: 38 };
    vi.mocked(meetApi.get).mockResolvedValueOnce({
      ok: true,
      value: state({
        replies: [
          {
            participantId: 'person02',
            name: '친구',
            origin,
            likes: [],
            times: null,
            updatedAt: startAt,
          },
        ],
      }),
    });
    const inputCompute = { ...compute, pending: true };
    const view = setup(inputCompute);
    await flush();
    let finish!: (value: Awaited<ReturnType<typeof meetApi.update>>) => void;
    vi.mocked(meetApi.update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    inputCompute.pending = false;
    view.rerender();
    await advance(1000);
    expect(meetApi.update).toHaveBeenCalledTimes(1);
    const newer = { name: '새 회사', lng: 127.5, lat: 37.2 };
    if (outcome === '전송 중 새 출발지')
      writeOnline(saved.id, {
        ...readOnline(saved.id)!,
        replyOrigins: { person02: newer },
      });
    await act(async () =>
      finish(
        outcome === '실패'
          ? { ok: false, error: { code: 'offline' } }
          : { ok: true, value: { rev: 3, docRev: 2 } },
      ),
    );
    expect(readOnline(saved.id)?.replyOrigins ?? {}).toEqual({
      person02: outcome === '전송 중 새 출발지' ? newer : origin,
    });
  },
);

it.each([undefined, 4])(
  '좋아요 rev 3 저장 뒤 늦게 도착한 rev 2 확인은 좋아요를 되돌리지 않는다(기존 확인 버전=%s)',
  async (hostLikesAckRev) => {
    saved = {
      ...saved,
      replies: f({ person01: { likes: [], sentAt: startAt, receivedAt: startAt } }),
    };
    online();
    writeOnline(saved.id, { ...readOnline(saved.id)!, hostLikes: [], hostLikesAckRev });
    const old = state({
      replies: [
        {
          participantId: 'person01',
          name: '나',
          origin: null,
          likes: [],
          times: null,
          updatedAt: startAt,
        },
        {
          participantId: 'person02',
          name: '친구',
          origin: null,
          likes: ['choice01'],
          times: null,
          updatedAt: startAt,
        },
      ],
    });
    let finish!: (value: Awaited<ReturnType<typeof meetApi.get>>) => void;
    vi.mocked(meetApi.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    await edit({
      replies: f({ person01: { likes: ['choice01'], sentAt: startAt, receivedAt: startAt } }),
    });
    await advance(1000);
    expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(saved.id, { likes: ['choice01'] }, token);
    expect(readOnline(saved.id)?.lastRev).toBe(1);
    await act(async () => finish({ ok: true, value: old }));
    expect(saved.replies.value.person01?.likes).toEqual(['choice01']);
    expect(saved.replies.value.person02?.likes).toEqual(['choice01']);
    expect(readOnline(saved.id)).toMatchObject({
      hostLikes: ['choice01'],
      hostLikesAckRev: hostLikesAckRev ?? 3,
      lastRev: 2,
    });
  },
);

it('동기화 뒤 바꾸지 않은 빈 좋아요는 다른 기기의 서버 좋아요를 받고 되돌려 보내지 않는다', async () => {
  saved = {
    ...saved,
    replies: f({ person01: { likes: [], sentAt: startAt, receivedAt: startAt } }),
  };
  writeOnline(saved.id, {
    hostToken: token,
    lastRev: 1,
    docRev: 1,
    syncedDoc: state().doc,
    hostLikes: [],
  });
  vi.mocked(meetApi.get).mockResolvedValue({
    ok: true,
    value: state({
      replies: [
        {
          participantId: 'person01',
          name: '나',
          origin: null,
          likes: ['choice01'],
          times: null,
          updatedAt: startAt,
        },
      ],
    }),
  });
  setup();
  await flush();
  await advance(1100);
  expect(saved.replies.value.person01?.likes).toEqual(['choice01']);
  expect(readOnline(saved.id)?.hostLikes).toEqual(['choice01']);
  expect(meetApi.reply).not.toHaveBeenCalled();
});

it.each([true, false])(
  '좋아요를 취소한 뒤 처음 공유하면 빈 기준을 남기고 다른 기기 좋아요를 받는다(created=%s)',
  async (created) => {
    const { result } = setup();
    await edit({
      replies: f({ person01: { likes: ['choice01'], sentAt: startAt, receivedAt: startAt } }),
    });
    await edit({ replies: f({ person01: { likes: [], sentAt: startAt, receivedAt: startAt } }) });
    vi.mocked(meetApi.create).mockResolvedValueOnce({
      ok: true,
      value: { id: saved.id, rev: 1, docRev: 1, hostToken: token, created },
    });
    await act(() => result.current.share());
    expect(readOnline(saved.id)?.hostLikes).toEqual([]);
    expect(meetApi.reply).not.toHaveBeenCalled();
    vi.mocked(meetApi.get).mockResolvedValueOnce({
      ok: true,
      value: state({
        replies: [
          {
            participantId: 'person01',
            name: '나',
            origin: null,
            likes: ['choice01'],
            times: null,
            updatedAt: startAt,
          },
        ],
      }),
    });
    await advance(10000);
    expect(saved.replies.value.person01?.likes).toEqual(['choice01']);
    expect(readOnline(saved.id)?.hostLikes).toEqual(['choice01']);
    expect(meetApi.reply).not.toHaveBeenCalled();
  },
);

it('동기화 기록과 다른 로컬 좋아요는 서버 확인 뒤에도 보존해 올린다', async () => {
  saved = {
    ...saved,
    replies: f({ person01: { likes: ['choice01'], sentAt: startAt, receivedAt: startAt } }),
  };
  writeOnline(saved.id, {
    hostToken: token,
    lastRev: 1,
    docRev: 1,
    syncedDoc: state().doc,
    hostLikes: [],
  });
  vi.mocked(meetApi.get).mockResolvedValue({
    ok: true,
    value: state({
      replies: [
        {
          participantId: 'person01',
          name: '나',
          origin: null,
          likes: [],
          times: null,
          updatedAt: startAt,
        },
      ],
    }),
  });
  setup();
  await flush();
  await advance(1100);
  expect(saved.replies.value.person01?.likes).toEqual(['choice01']);
  expect(meetApi.reply).toHaveBeenCalledExactlyOnceWith(saved.id, { likes: ['choice01'] }, token);
  expect(readOnline(saved.id)?.hostLikes).toEqual(['choice01']);
});

function setup(inputCompute: OnlineCompute = compute, strict = false) {
  return renderHook(
    () => {
      const [meeting, setMeeting] = useState(saved);
      refresh = setMeeting;
      return useOnlineMeeting(meeting, {
        ...inputCompute,
        unit: meeting.mode.value === 'straight' ? 'm' : 'min',
      });
    },
    { wrapper: strict ? StrictMode : undefined },
  );
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
    value: { id: saved.id, rev: 1, docRev: 1, hostToken: token, created: true },
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
  vi.unstubAllGlobals();
});

it.each([false, true])(
  '올리기 응답 유실 뒤 제목 수정 %s 후 다시 공유하면 같은 토큰으로 복구하고 수정은 자동으로 올린다',
  async (edited) => {
    const { webcrypto } = await import('node:crypto');
    const { createSqliteD1 } = await import('../../../helpers/sqlite-d1');
    const { handleCreate } = await import('src/server/meet/handlers');
    const { meetApi: actualApi } = await vi.importActual<
      typeof import('src/services/meet-online/client')
    >('src/services/meet-online/client');
    vi.stubGlobal('crypto', webcrypto);
    const db = createSqliteD1();
    const pending: Promise<unknown>[] = [];
    const sentTokens: string[] = [];
    const storedBeforeRequest: boolean[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      sentTokens.push(body.hostToken);
      storedBeforeRequest.push(
        readOnline(saved.id)?.pendingHostToken === body.hostToken &&
          readOnline(saved.id)?.syncedDoc?.title === '친구 모임',
      );
      const response = await handleCreate(
        {
          request: new Request('http://localhost:8788/api/meet', {
            ...init,
            headers: { Origin: 'http://localhost:8788' },
          }),
          env: { DB: db },
          params: {},
          waitUntil: (p) => {
            pending.push(p);
          },
        },
        { now: () => new Date(), fetch: fetchMock },
      );
      await Promise.all(pending);
      expect(response.status).toBe(sentTokens.length === 1 ? 201 : 200);
      if (sentTokens.length === 1) throw new TypeError('응답 유실');
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(meetApi.create).mockImplementation(actualApi.create);
    try {
      const first = setup();
      await act(() => first.result.current.share());
      const pendingToken = readOnline(saved.id)?.pendingHostToken;
      expect(pendingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(readOnline(saved.id)?.hostToken).toBeUndefined();
      expect(shareLink).not.toHaveBeenCalled();
      first.unmount();
      if (edited) {
        await advance(2000);
        saved = { ...saved, title: f('응답 유실 뒤 고친 제목', new Date().toISOString()) };
      }
      const second = setup();
      await act(() => second.result.current.share());
      expect(sentTokens).toEqual([pendingToken, pendingToken]);
      expect(storedBeforeRequest).toEqual([true, true]);
      expect(readOnline(saved.id)?.hostToken).toBe(pendingToken);
      expect(readOnline(saved.id)?.pendingHostToken).toBeUndefined();
      expect(await db.prepare('SELECT COUNT(*) AS count FROM meetings').first()).toEqual({
        count: 1,
      });
      expect(shareLink).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/\/meet\/meeting001$/),
        edited ? '응답 유실 뒤 고친 제목' : '친구 모임',
        { quietFailure: true },
      );
      expect(readOnline(saved.id)?.syncedDoc?.title).toBe('친구 모임');
      if (edited) {
        expect(
          JSON.parse((await db.prepare('SELECT doc FROM meetings').first<{ doc: string }>())!.doc)
            .title,
        ).toBe('친구 모임');
        await advance(1100);
        expect(meetApi.update).toHaveBeenCalledExactlyOnceWith(
          saved.id,
          expect.objectContaining({ title: '응답 유실 뒤 고친 제목' }),
          1,
          pendingToken,
          [],
          expect.any(AbortSignal),
          [],
        );
      }
    } finally {
      await Promise.all(pending);
      db.close();
    }
  },
);

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
        writeOnline(saved.id, { hostToken: token, lastRev: 1, syncedDoc: state().doc });
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
  expect(meetApi.create).toHaveBeenCalledWith(
    docFromMeeting(saved, {}, 'min'),
    'dev',
    expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  );
  expect(readOnline(saved.id)).toMatchObject({
    hostToken: token,
    docRev: 1,
    syncedDoc: state().doc,
  });
  expect(shareLink).toHaveBeenCalledWith(
    expect.stringMatching(/\/meet\/meeting001$/),
    '친구 모임',
    { quietFailure: true },
  );
  expect(result.current.mode).toBe('online');
});
it.each(['처음 올리기', '다시 올리기', '확정 공유', '주최자 링크', '주최자 링크 다시 발급'])(
  '%s 뒤 공유와 복사가 거절되면 지속 알림의 동작으로 같은 주소를 다시 공유한다',
  async (path) => {
    const { shareLink: actualShareLink } = await vi.importActual<
      typeof import('src/sections/meetings/share-link')
    >('src/sections/meetings/share-link');
    vi.mocked(shareLink)
      .mockImplementationOnce(actualShareLink)
      .mockImplementationOnce(actualShareLink);
    const denied = new DOMException('사용자 동작이 필요해요', 'NotAllowedError');
    const share = vi.fn().mockRejectedValueOnce(denied).mockResolvedValue(undefined);
    const writeText = vi.fn().mockRejectedValue(denied);
    vi.stubGlobal('navigator', { onLine: true, share, clipboard: { writeText } });
    if (path !== '처음 올리기') online();
    const { result } = setup();
    await flush();
    if (path === '다시 올리기' || path === '확정 공유')
      await edit({ decided: f('choice01', startAt) });
    if (path === '주최자 링크 다시 발급') await act(() => result.current.reissueHostLink());
    const host = path.startsWith('주최자 링크');
    const url = `${window.location.origin}/meet/${saved.id}${host ? `#h=${readOnline(saved.id)!.hostToken}` : ''}`;
    await act(() =>
      host
        ? result.current.openOnOtherDevice()
        : path === '확정 공유'
          ? result.current.shareFinal()
          : result.current.share(),
    );
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: '친구 모임', url });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(url);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledExactlyOnceWith('링크가 준비됐어요', {
      duration: Infinity,
      action: { label: '링크 공유하기', onClick: expect.any(Function) },
    });
    const options = vi.mocked(toast).mock.calls[0]![1]!;
    const action = options.action;
    if (!action || typeof action !== 'object' || !('onClick' in action))
      throw new Error('공유 동작이 있어야 합니다');
    await act(async () => {
      action.onClick({} as Parameters<typeof action.onClick>[0]);
      // 새 사용자 동작 안에서 바로 공유를 시작해야 한다.
      expect(share).toHaveBeenCalledTimes(2);
    });
    expect(share).toHaveBeenLastCalledWith({ title: '친구 모임', url });
    expect(writeText).toHaveBeenCalledTimes(1);
  },
);
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
  expect(readOnline(saved.id)).toEqual({
    lastRev: 0,
    pendingHostToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    syncedDoc: state().doc,
  });
});
it('기능 스위치가 꺼지면 대기 토큰을 보존하고 알림 없이 해시 문서를 공유한다', async () => {
  vi.mocked(meetApi.create).mockResolvedValue({ ok: false, error: { code: 'switched-off' } });
  const { result } = setup();
  await act(() => result.current.share());
  expect(shareMeetingDoc).toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(readOnline(saved.id)).toEqual({
    lastRev: 0,
    pendingHostToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    syncedDoc: state().doc,
  });
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
  expect(meetApi.get).toHaveBeenCalledWith(saved.id, null, token, expect.any(AbortSignal));
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
    [],
    expect.any(AbortSignal),
    [],
  );
  expect(readOnline(saved.id)).toMatchObject({ docRev: 2, syncedDoc: state().doc });
  expect(result.current.status.failing).toBe(false);
});
it('충돌 복구에서 친구 출발지 B를 합치면 계산이 끝난 뒤 받은 docRev로 B 소요시간을 올린다', async () => {
  const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
  const originA = { name: '출발지 A', lng: 127.1, lat: 37.6 };
  const originB = { name: '출발지 B', lng: 127.2, lat: 37.7 };
  saved = {
    ...saved,
    mode: f('car'),
    participants: f([
      { id: 'person01', name: '나', origin: null },
      { id: 'person02', name: '친구', origin: originA },
    ]),
  };
  online();
  let hold = false;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fork = effectRuntime.forkEffect;
  const lookup = RouteLookup.of({
    leg: (mode, from) =>
      Effect.succeed({
        mode,
        durationS: from[0] === originB.lng ? 1200 : 600,
        distanceM: 1000,
        tollFare: null,
        path: [],
        queriedAt: startAt,
        seq: 1,
        fresh: false,
      }),
  });
  vi.spyOn(effectRuntime, 'forkEffect').mockImplementation((effect) =>
    fork(
      Effect.promise(() => (hold ? gate : Promise.resolve())).pipe(
        Effect.andThen(effect),
        Effect.provideService(RouteLookup, lookup),
      ),
    ),
  );
  let reported!: OnlineCompute;
  function Editor() {
    const [meeting, setMeeting] = useState(saved);
    const [computed, setComputed] = useState<OnlineCompute>({ ...compute, pending: true });
    refresh = setMeeting;
    const host = useOnlineMeeting(meeting, computed);
    return (
      <MeetingResults
        meeting={meeting}
        library={emptyLibrary()}
        online={host}
        onComputeChange={(value) => {
          reported = value;
          setComputed(value);
        }}
      />
    );
  }
  render(<Editor />);
  try {
    await flush();
    await advance(1000);
    expect(reported.times.choice01?.person02).toBe(10);
    vi.mocked(meetApi.update).mockClear();
    vi.mocked(meetApi.update)
      .mockResolvedValue({ ok: true, value: { rev: 10, docRev: 9 } })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'conflict', docRev: 8 },
      });
    vi.mocked(meetApi.get).mockResolvedValueOnce({
      ok: true,
      value: state({
        rev: 9,
        docRev: 8,
        replies: [
          {
            participantId: 'person02',
            name: '친구',
            origin: originB,
            likes: [],
            times: null,
            updatedAt: startAt,
          },
        ],
      }),
    });
    hold = true;
    await edit({ title: f('수정한 제목') });
    await advance(1000);
    expect(saved.participants.value[1]?.origin).toEqual(originB);
    expect(reported.pending).toBe(true);
    expect(meetApi.update).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(meetApi.update).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(reported.pending).toBe(false);
    await advance(1000);
    expect(meetApi.update).toHaveBeenCalledTimes(2);
    expect(meetApi.update).toHaveBeenLastCalledWith(
      saved.id,
      expect.objectContaining({
        title: '수정한 제목',
        participants: saved.participants.value,
        times: { choice01: { person01: null, person02: 20 } },
        unit: 'min',
      }),
      8,
      token,
      [],
      expect.any(AbortSignal),
      [],
    );
    expect(readOnline(saved.id)).toMatchObject({
      docRev: 9,
      syncedDoc: { times: { choice01: { person01: null, person02: 20 } } },
    });
    await advance(1000);
    expect(meetApi.update).toHaveBeenCalledTimes(2);
  } finally {
    finish();
  }
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
  expect(meetApi.get).toHaveBeenLastCalledWith(saved.id, null, token, expect.any(AbortSignal));
  expect(meetApi.update).toHaveBeenLastCalledWith(
    saved.id,
    expect.objectContaining({
      participants: expect.arrayContaining([expect.objectContaining({ id: 'person03' })]),
    }),
    8,
    token,
    [],
    expect.any(AbortSignal),
    [],
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
it('새 답장을 보관함에 합쳐도 마지막으로 맞춘 본문은 바꾸지 않는다', async () => {
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
  expect(readOnline(saved.id)).toMatchObject({ lastRev: 2, syncedDoc: state().doc });
});
it('확정 직후 확인이 돌아도 보내기 전 확정을 지키고 응답 시점 대신 보낸 본문을 저장한다', async () => {
  online();
  const remote = state();
  setup();
  await flush();
  await advance(9500);
  await edit({ decided: f('choice01', new Date().toISOString()) });
  vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: true, value: remote });
  await advance(500);
  expect(saved.decided.value).toBe('choice01');
  expect(readOnline(saved.id)?.syncedDoc?.decided).toBeNull();
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
  expect(readOnline(saved.id)?.syncedDoc?.decided).toBe('choice01');
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
it.each(['확인', '다시 발급'] as const)(
  '재발급 응답 유실 뒤 %s에서 같은 토큰으로 주최자 권한을 복구한다',
  async (path) => {
    const { webcrypto } = await import('node:crypto');
    const { createSqliteD1 } = await import('../../../helpers/sqlite-d1');
    const { handleCreate, handleRelease, handleGet } = await import('src/server/meet/handlers');
    const { meetApi: actualApi } = await vi.importActual<
      typeof import('src/services/meet-online/client')
    >('src/services/meet-online/client');
    vi.stubGlobal('crypto', webcrypto);
    const db = createSqliteD1();
    const pending: Promise<unknown>[] = [];
    const sentTokens: string[] = [];
    const context = (request: Request) => ({
      request,
      env: { DB: db },
      params: { id: saved.id },
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p);
      },
    });
    const deps = { now: () => new Date(), fetch: vi.fn<typeof fetch>() };
    try {
      await handleCreate(
        context(
          new Request('http://localhost:8788/api/meet', {
            method: 'POST',
            headers: { Origin: 'http://localhost:8788' },
            body: JSON.stringify({ doc: state().doc, turnstile: 'dev', hostToken: token }),
          }),
        ),
        deps,
      );
      await Promise.all(pending);
      online();
      const syncedDoc = state().doc;
      writeOnline(saved.id, { ...readOnline(saved.id)!, syncedDoc });
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set('Origin', 'http://localhost:8788');
          const ctx = context(new Request(`http://localhost:8788${url}`, { ...init, headers }));
          if (String(url).endsWith('/release')) {
            const body = JSON.parse(init!.body as string);
            sentTokens.push(body.hostToken);
            expect(readOnline(saved.id)?.pendingHostToken).toBe(body.hostToken);
            expect(readOnline(saved.id)?.syncedDoc).toEqual(syncedDoc);
            const response = await handleRelease(ctx, deps);
            if (sentTokens.length === 1) throw new TypeError('응답 유실');
            return response;
          }
          return handleGet(ctx, deps);
        }),
      );
      let finishInitial!: () => void;
      let finishRecovery!: () => void;
      const initialChecked = new Promise<void>((resolve) => {
        finishInitial = resolve;
      });
      const recoveryChecked = new Promise<void>((resolve) => {
        finishRecovery = resolve;
      });
      vi.mocked(meetApi.get).mockImplementation(async (...args) => {
        const response = await actualApi.get(...args);
        if (response.ok) {
          if (args[2] === token) finishInitial();
          else finishRecovery();
        }
        return response;
      });
      vi.mocked(meetApi.release).mockImplementation(actualApi.release);
      const first = setup();
      await act(async () => {
        await initialChecked;
      });
      await act(() => first.result.current.reissueHostLink());
      const pendingToken = readOnline(saved.id)?.pendingHostToken;
      expect(pendingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(readOnline(saved.id)?.hostToken).toBe(token);
      vi.mocked(toast.error).mockClear();
      if (path === '확인') {
        first.unmount();
        setup();
        await act(async () => {
          await recoveryChecked;
        });
      } else await act(() => first.result.current.reissueHostLink());
      expect(sentTokens).toEqual([pendingToken, pendingToken]);
      expect(readOnline(saved.id)?.hostToken).toBe(pendingToken);
      expect(readOnline(saved.id)?.pendingHostToken).toBeUndefined();
      expect(readOnline(saved.id)?.syncedDoc).toEqual(syncedDoc);
      expect(toast.error).not.toHaveBeenCalled();
      expect((await actualApi.get(saved.id, null, pendingToken!)).ok).toBe(true);
    } finally {
      await Promise.all(pending);
      db.close();
    }
  },
);
it('주최자 링크는 #h=로 공유하고 다시 발급하면 기록 토큰을 바꾼다', async () => {
  online();
  const { result } = setup();
  await flush();
  await act(() => result.current.openOnOtherDevice());
  expect(shareLink).toHaveBeenCalledWith(
    expect.stringContaining(`/meet/${saved.id}#h=${token}`),
    '친구 모임',
    { quietFailure: true },
  );
  await act(() => result.current.reissueHostLink());
  expect(meetApi.release).toHaveBeenCalledWith(
    saved.id,
    { host: true, hostToken: readOnline(saved.id)?.hostToken },
    token,
  );
  expect(readOnline(saved.id)?.hostToken).not.toBe(token);
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
    [],
    expect.any(AbortSignal),
    [],
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
  expect(meetApi.get).toHaveBeenCalledWith(saved.id, null, token, expect.any(AbortSignal));
  await advance(10000);
  expect(meetApi.get).toHaveBeenLastCalledWith(saved.id, 2, token, expect.any(AbortSignal));
});
it.each(['mode', 'at', 'candidate', 'origin'] as const)(
  '주최자가 %s 계산 조건을 바꾸면 이전 답장의 시간을 덮어쓰지 않는다',
  async (condition) => {
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
    if (condition === 'mode') await edit({ mode: f('car') });
    else if (condition === 'at') await edit({ at: f({ date: '2026-10-27', time: '12:00' }) });
    else if (condition === 'candidate')
      await edit({
        candidates: f(saved.candidates.value.map((c) => ({ ...c, lng: c.lng + 0.1 }))),
      });
    else
      await edit({
        participants: f(
          saved.participants.value.map((p) =>
            p.id === 'person02' ? { ...p, origin: { name: '회사', lng: 128, lat: 36 } } : p,
          ),
        ),
      });
    expect(result.current.replyTimes.choice01?.person02).toBeUndefined();
  },
);

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
  writeOnline(saved.id, { hostToken: token, lastRev: 1, syncedDoc: state().doc });
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
  '다시 올린 뒤에도 %s 조건에 맞는 서버 답장만 쓴다',
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
      // 서버는 이동수단 변경 때 시간을 비우고, 본문 출발지 변경 때는 보존한다.
      replies: [{ ...reply, times: condition === 'mode' ? null : reply.times }],
      doc: docFromMeeting(saved, {}, saved.mode.value === 'straight' ? 'm' : 'min'),
    });
    vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: remote });
    await advance(7000);
    expect(result.current.replyTimes.choice01?.person02).toBe(
      condition === 'mode' ? undefined : 12,
    );
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
  expect(readOnline(saved.id)).toMatchObject({ docRev: 2, syncedDoc: state().doc });
  vi.mocked(meetApi.get).mockResolvedValueOnce({
    ok: true,
    value: state({ rev: 4, docRev: 3, doc: { ...state().doc, decided: null } }),
  });
  await advance(10000);
  expect(saved.decided.value).toBeNull();
  await advance(1000);
  expect(meetApi.update).not.toHaveBeenCalled();
});

it('미전송 수정이 있으면 원격 본문 버전과 동기화 본문도 보존한다', async () => {
  online();
  const remote = state({ rev: 5, docRev: 4 });
  setup();
  await flush();
  await advance(9500);
  await edit({ title: f('로컬 제목', new Date().toISOString()) });
  vi.mocked(meetApi.get).mockResolvedValueOnce({ ok: true, value: remote });
  await advance(500);
  expect(saved.title.value).toBe('로컬 제목');
  expect(readOnline(saved.id)).toMatchObject({ docRev: 1, syncedDoc: remote.doc, lastRev: 5 });
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

it.each([
  ['straight', 'car', false],
  ['straight', 'transit', false],
  ['car', 'car', true],
  ['transit', 'transit', true],
] as const)(
  '온라인 %s→%s 일시 변경=%s 뒤 재계산이 끝나면 도중 고친 제목도 올린다',
  async (before, after, changeAt) => {
    const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
    saved = {
      ...saved,
      mode: f(before),
      participants: f([
        { id: 'person01', name: '나', origin: { name: '집', lng: 126.9, lat: 37.4 } },
        { id: 'person02', name: '친구', origin: { name: '회사', lng: 127.1, lat: 37.6 } },
      ]),
    };
    online();
    let hold = false;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const fork = effectRuntime.forkEffect;
    const lookup = RouteLookup.of({
      leg: (mode) =>
        Effect.succeed({
          mode,
          durationS: 600,
          distanceM: 1000,
          tollFare: null,
          path: [],
          queriedAt: startAt,
          seq: 1,
          fresh: false,
        }),
    });
    const computations = vi
      .spyOn(effectRuntime, 'forkEffect')
      .mockImplementation((effect) =>
        fork(
          Effect.promise(() => (hold ? gate : Promise.resolve())).pipe(
            Effect.andThen(effect),
            Effect.provideService(RouteLookup, lookup),
          ),
        ),
      );
    let reported!: OnlineCompute;
    function Editor() {
      const [meeting, setMeeting] = useState(saved);
      const [computed, setComputed] = useState<OnlineCompute>({ ...compute, pending: true });
      refresh = setMeeting;
      const host = useOnlineMeeting(meeting, computed);
      return (
        <MeetingResults
          meeting={meeting}
          library={emptyLibrary()}
          online={host}
          onComputeChange={(value) => {
            reported = value;
            setComputed(value);
          }}
        />
      );
    }
    const view = render(<Editor />);
    try {
      await flush();
      await advance(1000);
      expect(reported.pending).toBe(false);
      vi.mocked(meetApi.update).mockClear();
      computations.mockClear();
      hold = true;
      await edit({
        mode: f(after),
        ...(changeAt ? { at: f({ date: '2026-10-27', time: '18:00' }) } : {}),
      });
      expect(reported.pending).toBe(true);
      expect(computations).toHaveBeenCalledTimes(1);
      await edit({ title: f('계산 중 바꾼 제목') });
      await advance(1100);
      expect(meetApi.update).not.toHaveBeenCalled();
      expect(computations).toHaveBeenCalledTimes(1);
      await act(async () => finish());
      await advance(1000);
      expect(reported.pending).toBe(false);
      expect(meetApi.update).toHaveBeenCalledExactlyOnceWith(
        saved.id,
        expect.objectContaining({
          title: '계산 중 바꾼 제목',
          mode: after,
          at: saved.at.value,
          unit: 'min',
          times: { choice01: { person01: 10, person02: 10 } },
        }),
        expect.any(Number),
        token,
        [],
        expect.any(AbortSignal),
        [],
      );
    } finally {
      finish();
      view.unmount();
    }
  },
);

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
        [],
        expect.any(AbortSignal),
        [],
      );
    } finally {
      finish();
    }
  },
);

it.each([false, true])(
  '계산 중=%s에 마지막 후보를 지우면 1초 뒤 빈 후보와 확정 취소를 올리고 다음 확인 뒤에도 저장한다',
  async (pending) => {
    const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
    saved = { ...saved, mode: f('straight'), decided: f('choice01') };
    online();
    let reported!: OnlineCompute;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (pending) {
      const fork = effectRuntime.forkEffect;
      vi.spyOn(effectRuntime, 'forkEffect').mockImplementationOnce((effect) =>
        fork(Effect.promise(() => gate).pipe(Effect.andThen(effect))),
      );
    }
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
            setComputed(value);
          }}
        />
      );
    }
    const { unmount } = render(<Editor />);
    try {
      await flush();
      expect(reported.pending).toBe(pending);
      await advance(1000);
      vi.mocked(meetApi.update).mockClear();
      await act(() => run((lib, ctx) => removeCandidate(lib, saved.id, 'choice01', ctx)));
      await advance(999);
      expect(meetApi.update).not.toHaveBeenCalled();
      await advance(1);
      expect(meetApi.update).toHaveBeenCalledExactlyOnceWith(
        saved.id,
        expect.objectContaining({ candidates: [], decided: null, times: {}, unit: 'm' }),
        expect.any(Number),
        token,
        [],
        expect.any(AbortSignal),
        [],
      );
      expect(reported).toEqual({ times: {}, unit: 'm', pending: false });
      vi.mocked(meetApi.get).mockResolvedValue({
        ok: true,
        value: state({ rev: 3, docRev: 2 }),
      });
      await advance(10000);
      expect(saved.candidates.value).toEqual([]);
      expect(saved.decided.value).toBeNull();
      await edit({ title: f('후보를 지운 뒤 수정', new Date().toISOString()) });
      await advance(1000);
      expect(meetApi.update).toHaveBeenCalledTimes(2);
      expect(meetApi.update).toHaveBeenLastCalledWith(
        saved.id,
        expect.objectContaining({ title: '후보를 지운 뒤 수정', candidates: [], decided: null }),
        2,
        token,
        [],
        expect.any(AbortSignal),
        [],
      );
    } finally {
      unmount();
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
      [],
      expect.any(AbortSignal),
      [],
    );
    expect(shareLink).not.toHaveBeenCalled();
    await act(async () => {
      finish({ ok: true, value: { rev: 3, docRev: 2 } });
      await sharing;
    });
    expect(shareLink).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/meet\/meeting001$/),
      '친구 모임',
      { quietFailure: true },
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
    [],
    expect.any(AbortSignal),
    [],
  );
  expect(shareLink).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(/\/meet\/meeting001$/),
    '바뀐 제목',
    { quietFailure: true },
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
    expect(readOnline(saved.id)).toEqual({
      lastRev: 0,
      pendingHostToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      syncedDoc: state().doc,
    });
  },
);

it.each(['성공', '실패 후 재시도', '충돌 재시도'] as const)(
  '답장 전용 참석자를 지우면 확인 때 되살리지 않고 removed로 올린다: %s',
  async (path) => {
    online();
    const remote = state({
      replies: [
        {
          participantId: 'person03',
          name: '새 친구',
          origin: null,
          likes: ['choice01'],
          times: null,
          updatedAt: startAt,
        },
      ],
    });
    vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: remote });
    setup();
    await flush();
    expect(saved.participants.value.some((p) => p.id === 'person03')).toBe(true);
    expect(readOnline(saved.id)?.seen).toEqual(['person03']);
    await advance(100);
    await edit({
      participants: f(
        saved.participants.value.filter((p) => p.id !== 'person03'),
        new Date().toISOString(),
      ),
      replies: f({}),
    });
    vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: { ...remote, rev: 3 } });
    if (path === '실패 후 재시도')
      vi.mocked(meetApi.update).mockResolvedValueOnce({ ok: false, error: { code: 'offline' } });
    if (path === '충돌 재시도') {
      vi.mocked(meetApi.update).mockResolvedValueOnce({
        ok: false,
        error: { code: 'conflict', docRev: 2 },
      });
      vi.mocked(meetApi.get).mockResolvedValue({
        ok: true,
        value: { ...remote, rev: 3, docRev: 2 },
      });
    }
    await advance(1000);
    expect(meetApi.update).toHaveBeenCalledWith(
      saved.id,
      expect.objectContaining({
        participants: expect.not.arrayContaining([expect.objectContaining({ id: 'person03' })]),
      }),
      1,
      token,
      ['person03'],
      expect.any(AbortSignal),
      [],
    );
    if (path === '실패 후 재시도') {
      expect(readOnline(saved.id)?.seen).toEqual(['person03']);
      await advance(9000);
      expect(meetApi.update).toHaveBeenCalledTimes(2);
    }
    expect(readOnline(saved.id)?.seen).toEqual([]);
    expect(saved.participants.value.some((p) => p.id === 'person03')).toBe(false);
    vi.mocked(meetApi.get).mockResolvedValue({
      ok: true,
      value: state({ rev: 4, docRev: 2, replies: [] }),
    });
    await advance(10000);
    expect(saved.participants.value.some((p) => p.id === 'person03')).toBe(false);
    expect(saved.replies.value.person03).toBeUndefined();
  },
);

it('다른 기기가 삭제 대기 참석자를 본문에 넣어도 받지 않고 다음 removed 전송 성공 뒤 seen을 지운다', async () => {
  online();
  const reply = {
    participantId: 'person03',
    name: '새 친구',
    origin: null,
    likes: ['choice01'],
    times: null,
    updatedAt: startAt,
  };
  const remote = state({ replies: [reply] });
  vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: remote });
  const inputCompute = { ...compute, pending: true };
  const { rerender } = setup(inputCompute);
  await flush();
  expect(saved.participants.value.some((p) => p.id === 'person03')).toBe(true);
  expect(readOnline(saved.id)?.seen).toEqual(['person03']);
  const otherDeviceDoc = {
    ...remote.doc,
    title: '다른 기기 제목',
    participants: saved.participants.value,
  };
  await edit({
    participants: f(saved.participants.value.filter((p) => p.id !== 'person03')),
    replies: f({}),
  });
  vi.mocked(meetApi.get).mockResolvedValue({
    ok: true,
    value: { ...remote, rev: 3, docRev: 2, doc: otherDeviceDoc },
  });
  await advance(10000);
  expect(saved.title.value).toBe('다른 기기 제목');
  expect(saved.participants.value.some((p) => p.id === 'person03')).toBe(false);
  expect(saved.replies.value.person03).toBeUndefined();
  expect(readOnline(saved.id)?.seen).toEqual(['person03']);
  expect(meetApi.update).not.toHaveBeenCalled();
  let finish!: (value: Awaited<ReturnType<typeof meetApi.update>>) => void;
  vi.mocked(meetApi.update).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  inputCompute.pending = false;
  rerender();
  await advance(1000);
  expect(meetApi.update).toHaveBeenCalledExactlyOnceWith(
    saved.id,
    expect.objectContaining({
      title: '다른 기기 제목',
      participants: expect.not.arrayContaining([expect.objectContaining({ id: 'person03' })]),
    }),
    2,
    token,
    ['person03'],
    expect.any(AbortSignal),
    [],
  );
  expect(readOnline(saved.id)?.seen).toEqual(['person03']);
  await act(async () => finish({ ok: true, value: { rev: 4, docRev: 3 } }));
  expect(readOnline(saved.id)?.seen).toEqual([]);
});

it('올리기 전 화면을 다시 열고 확인해도 지운 답장 전용 참석자를 되살리지 않는다', async () => {
  online();
  const remote = state({
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
  vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: remote });
  const first = setup({ ...compute, pending: true });
  await flush();
  await advance(100);
  await edit({
    participants: f(
      saved.participants.value.filter((p) => p.id !== 'person03'),
      new Date().toISOString(),
    ),
    replies: f({}),
  });
  first.unmount();
  setup({ ...compute, pending: true });
  await flush();
  await advance(10000);
  expect(meetApi.update).not.toHaveBeenCalled();
  expect(saved.participants.value.some((p) => p.id === 'person03')).toBe(false);
  expect(saved.replies.value.person03).toBeUndefined();
  expect(readOnline(saved.id)?.seen).toEqual(['person03']);
});

it('seen 한도가 차도 서버에 남은 답장 전용 참석자의 삭제 기록은 버리지 않는다', async () => {
  const oldIds = Array.from({ length: 9 }, (_, i) => `guest00${i + 1}`);
  saved = {
    ...saved,
    participants: f([
      saved.participants.value[0]!,
      ...oldIds.map((id) => ({ id, name: '옛 친구', origin: null })),
    ]),
  };
  writeOnline(saved.id, {
    hostToken: token,
    lastRev: 1,
    docRev: 1,
    syncedDoc: state().doc,
    seen: oldIds,
  });
  setup({ ...compute, pending: true });
  await flush();
  await advance(100);
  await edit({
    participants: f(saved.participants.value.slice(0, 1), new Date().toISOString()),
    replies: f({}),
  });
  const replyIds = ['guest001', ...Array.from({ length: 8 }, (_, i) => `new0000${i + 1}`)];
  const remote = state({
    rev: 3,
    docRev: 2,
    replies: replyIds.map((participantId) => ({
      participantId,
      name: '친구',
      origin: null,
      likes: [],
      times: null,
      updatedAt: startAt,
    })),
  });
  vi.mocked(meetApi.get).mockResolvedValue({ ok: true, value: remote });
  await advance(10000);
  expect(readOnline(saved.id)?.seen).toContain('guest001');
  expect(readOnline(saved.id)!.seen!.length).toBeLessThanOrEqual(10);
  await advance(10000);
  expect(saved.participants.value.some((p) => p.id === 'guest001')).toBe(false);
});

it.each(['storage', 'writeOnline', 'tick'] as const)(
  '열린 주최자 화면은 다른 곳의 종료 기록을 받아 공유를 막는다(%s)',
  async (source) => {
    const { MeetingResults } = await import('src/sections/meetings/MeetingResults');
    online();
    function Editor() {
      const [meeting, setMeeting] = useState(saved);
      refresh = setMeeting;
      const host = useOnlineMeeting(meeting, compute);
      return <MeetingResults meeting={meeting} library={emptyLibrary()} online={host} />;
    }
    render(<Editor />);
    await flush();
    expect(screen.getByRole('button', { name: '후보 링크 보내기' })).toBeEnabled();
    const reads = vi.mocked(meetApi.get).mock.calls.length;
    const ended = { ...readOnline(saved.id)!, ended: true as const };
    delete ended.hostToken;
    await act(async () => {
      if (source === 'writeOnline') writeOnline(saved.id, ended);
      else {
        localStorage.setItem(MEET_ONLINE_KEY, JSON.stringify({ [saved.id]: ended }));
        if (source === 'storage')
          window.dispatchEvent(new StorageEvent('storage', { key: MEET_ONLINE_KEY }));
      }
    });
    if (source === 'tick') await advance(10000);
    expect(screen.getByText('공유가 끝난 약속이에요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '후보 링크 보내기' })).toBeDisabled();
    await advance(10000);
    expect(meetApi.get).toHaveBeenCalledTimes(reads);
  },
);

it.each([false, true])(
  '닫힌 화면의 늦은 GET은 새 화면의 제목과 버전 기록을 되돌리지 않는다(StrictMode=%s)',
  async (strict) => {
    online();
    const oldState = state({ rev: 3, docRev: 2, doc: { ...state().doc, title: '옛 제목' } });
    const newState = state({ rev: 5, docRev: 4, doc: { ...state().doc, title: '새 제목' } });
    let finish!: (value: Awaited<ReturnType<typeof meetApi.get>>) => void;
    vi.mocked(meetApi.get)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ ok: true, value: newState });
    const first = setup(compute, strict);
    if (!strict) {
      first.unmount();
      setup();
    }
    await flush();
    expect(saved.title.value).toBe('새 제목');
    const fresh = readOnline(saved.id);
    expect(fresh).toMatchObject({ lastRev: 5, docRev: 4, syncedDoc: newState.doc });
    await act(async () => finish({ ok: true, value: oldState }));
    expect(saved.title.value).toBe('새 제목');
    expect(readOnline(saved.id)).toEqual(fresh);
    const signal = vi.mocked(meetApi.get).mock.calls[0]?.[3];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  },
);

it.each(['hydrate', 'conflict'] as const)(
  '닫힌 화면의 %s GET 응답은 합치거나 다시 올리지 않는다',
  async (stage) => {
    online();
    const first = setup();
    await flush();
    if (stage === 'hydrate') {
      const record = { ...readOnline(saved.id)! };
      delete record.docRev;
      writeOnline(saved.id, record);
    } else {
      vi.mocked(meetApi.update).mockResolvedValueOnce({
        ok: false,
        error: { code: 'conflict', docRev: 2 },
      });
    }
    let finish!: (value: Awaited<ReturnType<typeof meetApi.get>>) => void;
    vi.mocked(meetApi.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await edit({ title: f('로컬 수정') });
    await advance(1000);
    first.unmount();
    const fresh = readOnline(saved.id);
    const before = saved;
    const uploads = vi.mocked(meetApi.update).mock.calls.length;
    await act(async () =>
      finish({
        ok: true,
        value: state({
          rev: 3,
          docRev: 2,
          replies: [
            {
              participantId: 'person03',
              name: '늦은 친구',
              origin: null,
              likes: [],
              times: null,
              updatedAt: startAt,
            },
          ],
        }),
      }),
    );
    expect(saved).toEqual(before);
    expect(readOnline(saved.id)).toEqual(fresh);
    expect(meetApi.update).toHaveBeenCalledTimes(uploads);
    expect(vi.mocked(meetApi.get).mock.calls.at(-1)?.[3]?.aborted).toBe(true);
  },
);

it('닫힌 화면의 늦은 오류는 새 화면을 끝난 약속으로 바꾸지 않는다', async () => {
  online();
  let finish!: (value: Awaited<ReturnType<typeof meetApi.get>>) => void;
  vi.mocked(meetApi.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = setup();
  first.unmount();
  const second = setup();
  await flush();
  const fresh = readOnline(saved.id);
  await act(async () => finish({ ok: false, error: { code: 'ended' } }));
  expect(readOnline(saved.id)).toEqual(fresh);
  expect(second.result.current.mode).toBe('online');
  expect(toast.error).not.toHaveBeenCalled();
});

it.each([
  { closed: false, newer: true },
  { closed: true, newer: true },
  { closed: true, newer: false },
])('늦은 PUT 성공은 닫힌 화면이나 더 새 본문 기록을 덮지 않는다(%j)', async ({ closed, newer }) => {
  online();
  const first = setup();
  await flush();
  let finish!: (value: Awaited<ReturnType<typeof meetApi.update>>) => void;
  vi.mocked(meetApi.update).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit({ title: f('먼저 올린 제목') });
  await advance(1000);
  if (closed) first.unmount();
  if (newer) {
    const newDoc = { ...state().doc, title: '더 새 제목' };
    saved = { ...saved, title: f(newDoc.title) };
    await act(async () =>
      writeOnline(saved.id, { ...readOnline(saved.id)!, lastRev: 5, docRev: 4, syncedDoc: newDoc }),
    );
  }
  if (closed) {
    setup();
    await flush();
  }
  const fresh = readOnline(saved.id);
  await act(async () => finish({ ok: true, value: { rev: 3, docRev: 2 } }));
  expect(saved.title.value).toBe(newer ? '더 새 제목' : '먼저 올린 제목');
  expect(readOnline(saved.id)).toEqual(fresh);
  expect(vi.mocked(meetApi.update).mock.calls[0]?.[5]?.aborted).toBe(closed);
});

it.each([
  { rev: 4, docRev: 3 },
  { rev: 6, docRev: 2 },
])('기록보다 낮은 버전 %j는 최신 본문을 덮지 않는다', async ({ rev, docRev }) => {
  online();
  const newDoc = { ...state().doc, title: '최신 제목' };
  saved = { ...saved, title: f(newDoc.title) };
  writeOnline(saved.id, { ...readOnline(saved.id)!, lastRev: 5, docRev: 3, syncedDoc: newDoc });
  vi.mocked(meetApi.get).mockResolvedValueOnce({
    ok: true,
    value: state({ rev, docRev, doc: { ...newDoc, title: '옛 제목' } }),
  });
  setup();
  await flush();
  expect(saved.title.value).toBe('최신 제목');
  expect(readOnline(saved.id)).toMatchObject({
    lastRev: Math.max(5, rev),
    docRev: 3,
    syncedDoc: newDoc,
  });
});
