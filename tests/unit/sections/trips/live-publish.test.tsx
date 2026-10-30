import { setTimeout as realTimeout } from 'node:timers/promises';
import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTripLivePublish } from 'src/sections/trips/live/use-trip-live-publish';
import { tripCollabStore } from 'src/services/trip-collab/store';
import { joinCollabAsOwner } from 'src/sections/trips/collab/owner-join';
import { tripLiveApi } from 'src/services/trip-live/client';
import { tripLiveStore, type TripLiveRecord } from 'src/services/trip-live/store';
import { libraryAtom } from 'src/stores/library-state';
import {
  buildLiveTripDoc,
  ESTIMATE_ONLY,
  liveEditKey,
  livePlanKey,
} from 'src/domain/trip-live/build-live-doc';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { toast } from 'sonner';
vi.mock('src/services/trip-live/client', () => ({
  tripLiveApi: { update: vi.fn(), get: vi.fn(), rotate: vi.fn() },
}));
vi.mock('src/sections/trips/collab/owner-join', () => ({ joinCollabAsOwner: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const routes = vi.hoisted(() => ({
  total: 0,
  answered: 0,
  estimated: 0,
  oldestQueriedAt: null,
  routeOf: () => ({
    durationS: 0,
    distanceM: 0,
    tollFare: null,
    status: 'estimated' as const,
    queriedAt: null,
    path: [],
  }),
}));
vi.mock('src/sections/share-export/use-trip-legs', () => ({ useTripLegs: () => routes }));
const record = (): TripLiveRecord => ({
  tripId: 'trip000001',
  liveId: 'abcdefghij',
  status: 'live',
  ownerToken: 'o'.repeat(43),
  viewToken: 'v'.repeat(43),
  rev: 1,
  dayIds: ['day00001', 'day00002'],
  options: { title: '시험 여행', includeMemo: false, includeCandidates: true },
  createdAt: '2026-11-01T00:00:00.000Z',
});
const store = createStore();
const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);
const flush = async () => {
  await act(async () => {
    await realTimeout(20);
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await realTimeout(10);
    await vi.advanceTimersByTimeAsync(ms);
    await realTimeout(10);
  });
};
beforeEach(() => {
  localStorage.clear();
  store.set(libraryAtom, buildLiveLibrary());
  vi.clearAllMocks();
  vi.mocked(tripLiveApi.update).mockResolvedValue({
    ok: true,
    value: { rev: 2, expiresAt: '2027-01-01' },
  });
  vi.mocked(tripLiveApi.rotate).mockResolvedValue({ ok: true, value: { rev: 1 } });
  routes.total = 0;
  routes.answered = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
async function mount(put = true) {
  if (put) tripLiveStore.put(record());
  const hook = renderHook(() => useTripLivePublish('trip000001', true), { wrapper });
  await flush();
  return hook;
}
function edit() {
  store.set(libraryAtom, (lib) => ({
    ...lib,
    trips: {
      ...lib.trips,
      trip000001: {
        ...lib.trips.trip000001!,
        days: lib.trips.trip000001!.days.map((d, i) =>
          i ? d : { ...d, startTime: { ...d.startTime, value: '10:00' } },
        ),
      },
    },
  }));
}
describe('소유자 자동 반영', () => {
  it('기록이 없으면 요청하지 않는다', async () => {
    await mount(false);
    await advance(20000);
    expect(tripLiveApi.update).not.toHaveBeenCalled();
  });
  it('같은 편집 지문은 올리지 않는다', async () => {
    const r = record();
    r.publishedKey = await liveEditKey(
      buildLiveTripDoc(buildLiveLibrary(), r.tripId, ESTIMATE_ONLY, {
        title: r.options.title,
        options: r.options,
        dayIds: r.dayIds,
        createdAt: r.createdAt,
      })!,
    );
    tripLiveStore.put(r);
    await mount(false);
    await advance(20000);
    expect(tripLiveApi.update).not.toHaveBeenCalled();
  });
  it('3초 뒤 한 번 올리고 기록 버전과 지문을 갱신한다', async () => {
    await mount();
    await advance(2999);
    expect(tripLiveApi.update).not.toHaveBeenCalled();
    await advance(1);
    expect(tripLiveApi.update).toHaveBeenCalledOnce();
    expect(vi.mocked(tripLiveApi.update).mock.calls[0]![2]).toBe(1);
    expect(tripLiveStore.get('trip000001')).toMatchObject({
      rev: 2,
      publishedKey: expect.any(String),
      planKey: expect.any(String),
    });
    expect(tripLiveStore.get('trip000001')?.planKey).toBe(
      await livePlanKey(vi.mocked(tripLiveApi.update).mock.calls[0]![1]),
    );
  });
  it('구간 조회가 끝나지 않았으면 15초까지 기다린다', async () => {
    routes.total = 2;
    await mount();
    await advance(14999);
    expect(tripLiveApi.update).not.toHaveBeenCalled();
    await advance(1);
    expect(tripLiveApi.update).toHaveBeenCalledOnce();
  });
  it('409면 알리고 덮어쓸 때 서버 버전을 쓴다', async () => {
    vi.mocked(tripLiveApi.update).mockResolvedValueOnce({ ok: false, error: 'conflict', rev: 5 });
    const hook = await mount();
    await advance(3000);
    expect(hook.result.current.state).toBe('conflict');
    expect(toast).toHaveBeenCalledWith(
      '다른 기기에서 갱신 링크의 일정을 바꿨어요',
      expect.anything(),
    );
    await act(() => hook.result.current.overwrite());
    expect(vi.mocked(tripLiveApi.update).mock.calls[1]![2]).toBe(5);
  });
  it('paused 기록은 올리지 않고 멈추면 기록에 남는다', async () => {
    tripLiveStore.put({ ...record(), paused: true });
    const hook = await mount(false);
    await advance(20000);
    expect(tripLiveApi.update).not.toHaveBeenCalled();
    act(() => hook.result.current.resume());
    await advance(3000);
    act(() => hook.result.current.pause());
    expect(tripLiveStore.get('trip000001')?.paused).toBe(true);
  });
  it.each([
    ['unauthorized', 'disconnected'],
    ['ended', 'ended'],
    ['not-found', 'ended'],
  ])('%s는 %s로 기록한다', async (error, status) => {
    vi.mocked(tripLiveApi.update).mockResolvedValueOnce({ ok: false, error: error as 'ended' });
    await mount();
    await advance(3000);
    expect(tripLiveStore.get('trip000001')?.status).toBe(status);
  });
  it('401에 재발급 대기 토큰이 있으면 같은 값으로 복구한 뒤 다시 반영한다', async () => {
    const nextOwnerToken = 'n'.repeat(43);
    tripLiveStore.put({ ...record(), nextOwnerToken });
    vi.mocked(tripLiveApi.update).mockResolvedValueOnce({ ok: false, error: 'unauthorized' });
    await mount(false);
    await advance(3000);
    await advance(3000);
    expect(tripLiveApi.rotate).toHaveBeenCalledWith(
      'abcdefghij',
      { owner: nextOwnerToken },
      record().ownerToken,
    );
    expect(vi.mocked(tripLiveApi.update).mock.calls[1]![3]).toBe(nextOwnerToken);
    expect(tripLiveStore.get('trip000001')).toMatchObject({
      status: 'live',
      ownerToken: nextOwnerToken,
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
  it('진행 중인 요청의 401은 이미 교체된 소유자 토큰을 끊지 않고 다시 시도한다', async () => {
    let finish!: (value: Awaited<ReturnType<typeof tripLiveApi.update>>) => void;
    vi.mocked(tripLiveApi.update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = await mount();
    await advance(3000);
    expect(tripLiveApi.update).toHaveBeenCalledOnce();
    act(() => tripLiveStore.update('trip000001', { ownerToken: 'n'.repeat(43) }));
    await act(async () => {
      finish({ ok: false, error: 'unauthorized' });
      await realTimeout(10);
    });
    await advance(3000);
    expect(tripLiveStore.get('trip000001')?.status).toBe('live');
    expect(vi.mocked(tripLiveApi.update).mock.calls.map((call) => call[3])).toEqual([
      record().ownerToken,
      'n'.repeat(43),
    ]);
    expect(hook.result.current.state).toBe('published');
    expect(toast.error).not.toHaveBeenCalled();
  });
  it('off는 5분 뒤 다시 시도한다', async () => {
    vi.mocked(tripLiveApi.update).mockResolvedValueOnce({ ok: false, error: 'switched-off' });
    const hook = await mount();
    await advance(3000);
    expect(hook.result.current.state).toBe('off');
    await advance(299999);
    expect(tripLiveApi.update).toHaveBeenCalledOnce();
    await advance(1);
    expect(tripLiveApi.update).toHaveBeenCalledTimes(2);
  });
  it('장소를 모두 빼면 empty이며 요청하지 않는다', async () => {
    store.set(libraryAtom, { ...buildLiveLibrary(), places: {} });
    const hook = await mount();
    await advance(20000);
    expect(hook.result.current.state).toBe('empty');
    expect(tripLiveApi.update).not.toHaveBeenCalled();
  });
  it('계획 화면과 창에서 동시에 돌아도 한 번만 올린다', async () => {
    tripLiveStore.put(record());
    renderHook(
      () => {
        useTripLivePublish('trip000001', true);
        useTripLivePublish('trip000001', true);
      },
      { wrapper },
    );
    await flush();
    await advance(3000);
    expect(tripLiveApi.update).toHaveBeenCalledOnce();
  });
  it('편집이 이어지면 마지막 변경 뒤 3초로 모은다', async () => {
    await mount();
    await advance(2000);
    act(() => edit());
    await advance(2999);
    expect(tripLiveApi.update).not.toHaveBeenCalled();
    await advance(1);
    expect(tripLiveApi.update).toHaveBeenCalledOnce();
  });
});

it('두 훅에서 날짜를 늘려도 Day id를 공유하고 편집 없이 다시 올리지 않는다', async () => {
  tripLiveStore.put(record());
  renderHook(
    () => {
      useTripLivePublish('trip000001', true);
      useTripLivePublish('trip000001', true);
    },
    { wrapper },
  );
  await flush();
  act(() =>
    store.set(libraryAtom, (lib) => ({
      ...lib,
      trips: {
        trip000001: {
          ...lib.trips.trip000001!,
          endDate: { ...lib.trips.trip000001!.endDate, value: '2026-12-11' },
          days: [
            ...lib.trips.trip000001!.days,
            {
              startTime: { value: '09:00', updatedAt: record().createdAt },
              lodging: { value: null, updatedAt: record().createdAt },
              stops: { value: [], updatedAt: record().createdAt },
            },
          ],
        },
      },
    })),
  );
  await advance(3000);
  await advance(30000);
  expect(tripLiveApi.update).toHaveBeenCalledOnce();
  expect(tripLiveStore.get('trip000001')?.dayIds).toHaveLength(3);
});
it('덮어쓰기 실패 후 재시도도 사용자가 고른 서버 버전을 쓴다', async () => {
  vi.mocked(tripLiveApi.update)
    .mockResolvedValueOnce({ ok: false, error: 'conflict', rev: 5 })
    .mockResolvedValueOnce({ ok: false, error: 'offline' });
  const hook = await mount();
  await advance(3000);
  await act(() => hook.result.current.overwrite());
  await advance(30000);
  expect(tripLiveApi.update).toHaveBeenCalledTimes(3);
  expect(vi.mocked(tripLiveApi.update).mock.calls[2]![2]).toBe(5);
});
it('온라인 복귀도 편집 모으기와 최소 반영 간격을 지킨다', async () => {
  await mount();
  await advance(3000);
  act(() => edit());
  await advance(1000);
  act(() => window.dispatchEvent(new Event('online')));
  await advance(0);
  expect(tripLiveApi.update).toHaveBeenCalledOnce();
  await advance(8999);
  expect(tripLiveApi.update).toHaveBeenCalledOnce();
  await advance(1);
  expect(tripLiveApi.update).toHaveBeenCalledTimes(2);
});

it('경로·보관함 재조회만으로 off 재시도 대기 시간을 줄이지 않는다', async () => {
  vi.mocked(tripLiveApi.update).mockResolvedValueOnce({ ok: false, error: 'switched-off' });
  const hook = await mount();
  await advance(3000);
  act(() => store.set(libraryAtom, (lib) => ({ ...lib })));
  await advance(10000);
  expect(tripLiveApi.update).toHaveBeenCalledOnce();
  expect(hook.result.current.state).toBe('off');
});

it('덮어쓰기가 다시 충돌하면 온라인 복귀에도 다시 선택하기 전에는 올리지 않는다', async () => {
  vi.mocked(tripLiveApi.update)
    .mockResolvedValueOnce({ ok: false, error: 'conflict', rev: 5 })
    .mockResolvedValueOnce({ ok: false, error: 'conflict', rev: 6 });
  const hook = await mount();
  await advance(3000);
  await act(() => hook.result.current.overwrite());
  act(() => window.dispatchEvent(new Event('online')));
  await advance(0);
  expect(tripLiveApi.update).toHaveBeenCalledTimes(2);
});
it('두 훅이 같이 있어도 같은 문서의 off 대기를 공유한다', async () => {
  tripLiveStore.put(record());
  vi.mocked(tripLiveApi.update).mockResolvedValueOnce({ ok: false, error: 'switched-off' });
  renderHook(
    () => {
      useTripLivePublish('trip000001', true);
      useTripLivePublish('trip000001', true);
    },
    { wrapper },
  );
  await flush();
  await advance(3000);
  act(() => store.set(libraryAtom, (lib) => ({ ...lib })));
  await advance(10000);
  expect(tripLiveApi.update).toHaveBeenCalledOnce();
});

it('실패 요청을 보낸 창이 닫혀도 남은 계획 화면은 대기 뒤 다시 시도한다', async () => {
  tripLiveStore.put(record());
  let finish!: (value: Awaited<ReturnType<typeof tripLiveApi.update>>) => void;
  vi.mocked(tripLiveApi.update).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const first = renderHook(() => useTripLivePublish('trip000001', true), { wrapper });
  await flush();
  renderHook(() => useTripLivePublish('trip000001', true), { wrapper });
  await flush();
  await advance(3000);
  expect(tripLiveApi.update).toHaveBeenCalledOnce();
  await act(async () => {
    finish({ ok: false, error: 'switched-off' });
    await realTimeout(10);
  });
  first.unmount();
  await advance(300000);
  expect(tripLiveApi.update).toHaveBeenCalledTimes(2);
});
it('화면이 모두 닫힌 뒤 도착한 실패 응답은 재시도 타이머를 만들지 않는다', async () => {
  let finish!: (value: Awaited<ReturnType<typeof tripLiveApi.update>>) => void;
  vi.mocked(tripLiveApi.update).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const hook = await mount();
  await advance(3000);
  hook.unmount();
  await act(async () => {
    finish({ ok: false, error: 'switched-off' });
    await realTimeout(10);
  });
  await advance(300000);
  expect(tripLiveApi.update).toHaveBeenCalledOnce();
});

it('연결 기록이 live면 2A 반영을 멈추고 collab을 보인다', async () => {
  tripCollabStore.put({
    tripId: 'trip000001',
    liveId: 'abcdefghij',
    role: 'owner',
    token: null,
    deviceId: null,
    label: '만든 사람',
    status: 'live',
    rev: 2,
    prev: 0,
    dayIds: ['day00001', 'day00002'],
    placeMap: {},
    syncedAt: new Date().toISOString(),
    title: '여행',
    pendingProgress: [],
  });
  const hook = await mount();
  await advance(20_000);
  expect(tripLiveApi.update).not.toHaveBeenCalled();
  expect(hook.result.current.state).toBe('collab');
});
it('버전 거절은 공동 편집 합류로 이어지고 다시 덮어쓰지 않는다', async () => {
  const doc = {
    ...buildLiveTripDoc(buildLiveLibrary(), 'trip000001', ESTIMATE_ONLY, {
      title: '시험 여행',
      options: record().options,
      dayIds: record().dayIds,
      createdAt: record().createdAt,
    })!,
    v: 2 as const,
  };
  vi.mocked(tripLiveApi.update).mockResolvedValue({ ok: false, error: 'version' });
  vi.mocked(tripLiveApi.get).mockResolvedValue({
    ok: true,
    value: { role: 'owner', rev: 3, doc, updatedAt: doc.share.createdAt, expiresAt: '2026-12-31' },
  });
  const hook = await mount();
  await advance(3_000);
  expect(hook.result.current.state).toBe('collab');
  expect(joinCollabAsOwner).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ doc }),
  );
  await advance(20_000);
  expect(tripLiveApi.update).toHaveBeenCalledOnce();
});
it('version 뒤 공동본 읽기가 실패해도 다시 받아 소유자로 합류한다', async () => {
  const { buildLiveDoc } = await import('../../../fixtures/live-trip');
  const doc = { ...buildLiveDoc(), v: 2 as const };
  vi.mocked(tripLiveApi.update).mockResolvedValue({ ok: false, error: 'version' });
  vi.mocked(tripLiveApi.get)
    .mockResolvedValueOnce({ ok: false, error: 'offline' })
    .mockResolvedValue({
      ok: true,
      value: {
        role: 'owner',
        rev: 3,
        doc,
        updatedAt: doc.share.createdAt,
        expiresAt: '2026-12-31',
      },
    });
  const hook = await mount();
  await advance(3000);
  expect(hook.result.current.state).toBe('failed');
  expect(joinCollabAsOwner).not.toHaveBeenCalled();
  await advance(30000);
  expect(joinCollabAsOwner).toHaveBeenCalledOnce();
  expect(hook.result.current.state).toBe('collab');
});
