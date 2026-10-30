import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CollabEngine,
  collabEngineFor,
  resetCollabEngines,
  type CollabEngineDeps,
} from 'src/sections/trips/collab/collab-engine';
import { createTripCollabStore, type TripCollabRecord } from 'src/services/trip-collab/store';
import { tripCollabApi, type CollabState } from 'src/services/trip-collab/client';
import { createTripLiveStore } from 'src/services/trip-live/store';
import { planFromDoc, projectLocalTrip } from 'src/domain/trip-collab/plan';
import { buildCollabDoc } from 'src/domain/trip-collab/build-doc';
import { ESTIMATE_ONLY } from 'src/domain/trip-live/build-live-doc';
import type { Library } from 'src/schema/library';
import { buildLiveDoc } from '../../../fixtures/live-trip';
import { buildLiveLibrary } from '../../../fixtures/builders';
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
  localStorage.clear();
  resetCollabEngines();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function setup() {
  let lib: Library = buildLiveLibrary();
  const doc = { ...buildLiveDoc(), v: 2 as const },
    store = createTripCollabStore(),
    liveStore = createTripLiveStore();
  const record: TripCollabRecord = {
    tripId: 'trip000001',
    liveId: 'abcdefghij',
    role: 'editor',
    token: 'e'.repeat(43),
    deviceId: 'device01',
    label: '내 폰',
    status: 'live',
    rev: 2,
    prev: 0,
    dayIds: [...doc.ids.days],
    placeMap: { place00001: 'place00001', place00002: 'place00002' },
    syncedAt: new Date().toISOString(),
    title: '시험 여행',
    pendingProgress: [],
  };
  store.put(record);
  store.writeBase(record.liveId, { rev: 2, plan: planFromDoc(doc), progress: null });
  let remote: CollabState = {
    rev: 2,
    updatedAt: new Date().toISOString(),
    expiresAt: '2026-12-31',
    role: 'editor',
    deviceId: record.deviceId,
    members: 1,
    editedBy: '민지 폰',
    doc,
    progress: { prev: 0, marks: [], next: null },
  };
  const api = {
    ...tripCollabApi,
    state: vi.fn<CollabEngineDeps['api']['state']>(async () => ({
      ok: true as const,
      value: remote,
    })),
    putDoc: vi.fn<CollabEngineDeps['api']['putDoc']>(async () => ({
      ok: true as const,
      value: { rev: 3, expiresAt: '2026-12-31' },
    })),
    progress: vi.fn<CollabEngineDeps['api']['progress']>(async () => ({
      ok: true as const,
      value: { prev: 1, marks: [], next: null },
    })),
  };
  const deps: CollabEngineDeps = {
    tripId: record.tripId,
    api,
    store,
    liveStore,
    getLibrary: () => lib,
    run: vi.fn(async (op) => {
      const r = op(lib, {
        now: new Date().toISOString(),
        newId: (kind: string) => (kind === 'stop' ? 'newstop0' : 'newplace00'),
      });
      if ('ok' in r) {
        if (!r.ok) return r;
        lib = r.lib;
      } else lib = r;
      return { ok: true };
    }),
    routeOf: () => () => ({ mode: 'car', time: ESTIMATE_ONLY({} as never) }),
    now: () => new Date(),
    newPlaceId: () => 'newplace00',
    locks: null,
    win: window,
    reportError: vi.fn(),
  };
  const engine = new CollabEngine(deps);
  const change = (day: number, time: string) => {
    const trip = lib.trips.trip000001!;
    lib = {
      ...lib,
      trips: {
        ...lib.trips,
        [trip.id]: {
          ...trip,
          days: trip.days.map((d, i) =>
            i === day
              ? { ...d, startTime: { value: time, updatedAt: new Date().toISOString() } }
              : d,
          ),
        },
      },
    };
  };
  return {
    engine,
    deps,
    api,
    store,
    record,
    doc,
    get: () => lib,
    change,
    remote: () => remote,
    setRemote: (s: CollabState) => {
      remote = s;
    },
  };
}
describe('함께 편집 맞추기 엔진', () => {
  it('기록이 live가 아니면 요청하지 않는다', async () => {
    const s = setup();
    s.store.update(s.record.tripId, { status: 'ended' });
    stop = s.engine.retain();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.api.state).not.toHaveBeenCalled();
  });
  it('처음에는 두 revision 없이 읽고 같은 계획은 올리지 않는다', async () => {
    const s = setup();
    await s.engine.sync();
    expect(s.api.state).toHaveBeenCalledWith('abcdefghij', s.record.token, {
      rev: null,
      prev: null,
    });
    expect(s.api.putDoc).not.toHaveBeenCalled();
    expect(s.engine.getSnapshot().state).toBe('synced');
  });
  it('공동본만 바뀌면 반영하고 마지막 편집 기기를 보인다', async () => {
    const s = setup();
    s.doc.share.trips[0]!.days[0]!.startTime = '10:00';
    s.setRemote({ ...s.remote(), rev: 3 });
    await s.engine.sync();
    expect(s.get().trips.trip000001!.days[0]!.startTime.value).toBe('10:00');
    expect(s.api.putDoc).not.toHaveBeenCalled();
    expect(s.engine.getSnapshot().changedBy).toBe('민지 폰');
  });
  it('이 기기 변경은 3초 모아 올리고 새 revision을 저장한다', async () => {
    const s = setup();
    s.change(0, '10:00');
    s.engine.localChanged();
    await vi.advanceTimersByTimeAsync(2999);
    expect(s.api.putDoc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.api.putDoc).toHaveBeenCalledOnce();
    expect(s.store.get(s.record.tripId)?.rev).toBe(3);
  });
  it('다른 Day의 동시 변경은 둘 다 반영해서 올린다', async () => {
    const s = setup();
    s.change(0, '10:00');
    s.doc.share.trips[0]!.days[1]!.startTime = '08:00';
    await s.engine.sync();
    expect(s.get().trips.trip000001!.days.map((d) => d.startTime.value)).toEqual([
      '10:00',
      '08:00',
    ]);
    expect(s.api.putDoc).toHaveBeenCalledOnce();
  });
  it('겹침은 반영·올리기를 멈추고 공동 쪽으로 고르면 올리지 않는다', async () => {
    const s = setup();
    s.change(0, '10:00');
    s.doc.share.trips[0]!.days[0]!.startTime = '08:00';
    await s.engine.sync();
    expect(s.engine.getSnapshot().state).toBe('conflict');
    expect(s.api.putDoc).not.toHaveBeenCalled();
    expect(s.get().trips.trip000001!.days[0]!.startTime.value).toBe('10:00');
    await s.engine.resolve({ 'day.0.startTime': 'theirs' });
    expect(s.get().trips.trip000001!.days[0]!.startTime.value).toBe('08:00');
    expect(s.api.putDoc).not.toHaveBeenCalled();
  });
  it('겹침에서 이 기기를 고르면 올린다', async () => {
    const s = setup();
    s.change(0, '10:00');
    s.doc.share.trips[0]!.days[0]!.startTime = '08:00';
    await s.engine.sync();
    await s.engine.resolve({ 'day.0.startTime': 'mine' });
    expect(s.api.putDoc).toHaveBeenCalledOnce();
  });
  it('오프라인 순서 겹침은 보관함 갱신 알림 뒤에도 비교 상태와 기준을 유지한다', async () => {
    const s = setup();
    await s.deps.run((lib) => {
      const trip = lib.trips.trip000001!,
        first = trip.days[0]!,
        second = trip.days[1]!,
        third = { ...first.stops.value[0]!, id: 'stop0003', placeId: 'place00003' };
      return {
        ...lib,
        places: {
          ...lib.places,
          place00003: { ...lib.places.place00001!, id: third.placeId },
        },
        trips: {
          ...lib.trips,
          [trip.id]: {
            ...trip,
            days: [
              {
                ...first,
                stops: {
                  ...first.stops,
                  value: [...first.stops.value, ...second.stops.value, third],
                },
              },
              { ...second, stops: { ...second.stops, value: [] } },
            ],
          },
        },
      };
    });
    const placeMap = { ...s.record.placeMap, place00003: 'place00003' },
      original = projectLocalTrip(s.get().trips.trip000001!, (id) => id, s.record.dayIds);
    s.store.update(s.record.tripId, { placeMap });
    Object.assign(
      s.doc,
      buildCollabDoc({
        plan: original,
        previous: s.doc,
        lib: s.get(),
        placeMap,
        role: 'editor',
        options: s.doc.options,
        createdAt: s.doc.share.createdAt,
        routeOf: s.deps.routeOf(),
      }),
    );
    s.store.writeBase(s.record.liveId, { rev: 2, plan: original, progress: null });
    await s.engine.sync();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await s.deps.run((lib) => {
      const trip = lib.trips.trip000001!,
        day = trip.days[0]!,
        [a, b, c] = day.stops.value;
      return {
        ...lib,
        trips: {
          ...lib.trips,
          [trip.id]: {
            ...trip,
            days: [{ ...day, stops: { ...day.stops, value: [b!, a!, c!] } }, trip.days[1]!],
          },
        },
      };
    });
    s.engine.localChanged();
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.engine.getSnapshot().state).toBe('offline');
    const day = s.doc.share.trips[0]!.days[0]!,
      [a, b, c] = day.stops;
    day.stops = [c!, a!, b!];
    s.doc.ids.stops[0] = ['stop0003', 'stop0001', 'stop0002'];
    s.setRemote({ ...s.remote(), rev: 3 });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    // 온라인 이벤트가 route 해제보다 먼저 도착해 첫 요청이 실패하는 경우도 거친다.
    s.api.state.mockResolvedValueOnce({ ok: false, error: 'offline' } as never);
    await s.engine.sync();
    await s.engine.sync();
    const merge = s.engine.getSnapshot().merge!;
    expect(s.engine.getSnapshot().state).toBe('conflict');
    expect(merge.conflicts.map((conflict) => conflict.id)).toEqual(['placement.d0']);
    expect(merge.base).toEqual(original);
    expect(merge.mine.days[0]!.stops.map((stop) => stop.id)).toEqual([
      'stop0002',
      'stop0001',
      'stop0003',
    ]);
    expect(merge.theirs.days[0]!.stops.map((stop) => stop.id)).toEqual([
      'stop0003',
      'stop0001',
      'stop0002',
    ]);

    // run(mapServerPlaces) 뒤 React의 library 갱신 효과가 같은 투영을 다시 알린다.
    const requests = s.api.state.mock.calls.length;
    s.engine.localChanged();
    expect(s.engine.getSnapshot().state).toBe('conflict');
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.api.state).toHaveBeenCalledTimes(requests);
    expect(s.store.readBase(s.record.liveId)?.plan).toEqual(original);
    expect(s.store.get(s.record.tripId)?.rev).toBe(2);
    expect(s.api.putDoc).not.toHaveBeenCalled();

    await s.engine.resolve({ 'placement.d0': 'theirs' });
    expect(s.engine.getSnapshot().state).toBe('synced');
    expect(s.get().trips.trip000001!.days[0]!.stops.value.map((stop) => stop.id)).toEqual([
      'stop0003',
      'stop0001',
      'stop0002',
    ]);
    expect(s.store.get(s.record.tripId)?.rev).toBe(3);
    expect(s.api.putDoc).not.toHaveBeenCalled();
  });
  it('반영 연산 안에서 사람이 고쳤으면 다시 투영한다', async () => {
    const s = setup(),
      run = s.deps.run;
    let changed = false;
    s.doc.share.trips[0]!.days[0]!.startTime = '08:00';
    s.deps.run = async (op) => {
      if (!changed && vi.mocked(run).mock.calls.length > 0) {
        changed = true;
        s.change(1, '07:00');
      }
      return run(op);
    };
    await s.engine.sync();
    expect(s.get().trips.trip000001!.days.map((d) => d.startTime.value)).toEqual([
      '08:00',
      '07:00',
    ]);
  });
  it.each(['11:00', '09:00'])(
    '겹침 중 실제로 %s로 고치면 비교 안내를 유지하고 다시 병합한다',
    async (time) => {
      const s = setup();
      s.change(0, '10:00');
      s.doc.share.trips[0]!.days[0]!.startTime = '08:00';
      await s.engine.sync();
      expect(s.engine.getSnapshot().state).toBe('conflict');
      s.change(0, time);
      s.engine.localChanged();
      expect(s.engine.getSnapshot().state).toBe('conflict');
      await vi.advanceTimersByTimeAsync(3000);
      if (time === '09:00') {
        expect(s.engine.getSnapshot().state).toBe('synced');
        expect(s.get().trips.trip000001!.days[0]!.startTime.value).toBe('08:00');
      } else {
        expect(s.engine.getSnapshot().state).toBe('conflict');
        expect(s.engine.getSnapshot().merge?.mine.days[0]!.startTime).toBe(time);
      }
      expect(s.api.putDoc).not.toHaveBeenCalled();
    },
  );
  it('409 revision은 다시 받아 병합하고 세 번 넘으면 busy다', async () => {
    const s = setup();
    s.change(0, '10:00');
    s.api.putDoc.mockResolvedValue({ ok: false, error: 'conflict', rev: 3 } as never);
    await s.engine.sync();
    expect(s.api.putDoc).toHaveBeenCalledTimes(3);
    expect(s.engine.getSnapshot().state).toBe('busy');
  });
  it.each([
    ['unauthorized', 'revoked'],
    ['ended', 'ended'],
    ['version', 'version'],
    ['switched-off', 'off'],
    ['rate-limited', 'limited'],
    ['offline', 'offline'],
  ] as const)('%s 응답은 %s 상태다', async (error, state) => {
    const s = setup();
    s.api.state.mockResolvedValue({ ok: false, error } as never);
    await s.engine.sync();
    expect(s.engine.getSnapshot().state).toBe(state);
    if (state === 'revoked' || state === 'ended')
      expect(s.store.get(s.record.tripId)?.status).toBe(state);
  });
  it('소유자의 401은 2A 관리 연결도 끊는다', async () => {
    const s = setup();
    s.store.update(s.record.tripId, { role: 'owner', token: null, deviceId: null });
    s.deps.liveStore.put({
      tripId: s.record.tripId,
      liveId: 'abcdefghij',
      status: 'live',
      ownerToken: 'o'.repeat(43),
      viewToken: 'v'.repeat(43),
      rev: 2,
      dayIds: s.doc.ids.days,
      options: { title: '여행', includeMemo: false, includeCandidates: true },
      createdAt: s.doc.share.createdAt,
    });
    s.api.state.mockResolvedValue({ ok: false, error: 'unauthorized' } as never);
    await s.engine.sync();
    expect(s.deps.liveStore.get(s.record.tripId)?.status).toBe('disconnected');
  });
  it('체크 전송 실패는 대기열에 남고 다음 맞추기에 보낸다', async () => {
    const s = setup();
    s.api.progress.mockResolvedValueOnce({ ok: false, error: 'offline' } as never);
    s.engine.queueProgress({ stopId: 'stop0001', visited: true, date: '2026-11-01' });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.store.get(s.record.tripId)?.pendingProgress).toHaveLength(1);
    await s.engine.sync();
    expect(s.store.get(s.record.tripId)?.pendingProgress).toEqual([]);
    expect(s.api.progress).toHaveBeenCalledTimes(2);
  });
  it('기준이 사라진 상태에서 다른 값은 비교한다', async () => {
    const s = setup();
    localStorage.removeItem('tripmap:trip-collab-base:v1:abcdefghij');
    s.change(0, '10:00');
    await s.engine.sync();
    expect(s.engine.getSnapshot().state).toBe('conflict');
  });
  it('쓰기가 꺼져도 다른 기기 변경은 계속 받는다', async () => {
    const s = setup();
    s.change(0, '10:00');
    s.api.putDoc.mockResolvedValueOnce({ ok: false, error: 'switched-off' } as never);
    await s.engine.sync();
    expect(s.engine.getSnapshot().state).toBe('off');
    s.doc.share.trips[0]!.days[1]!.startTime = '07:00';
    s.setRemote({ ...s.remote(), rev: 3 });
    await s.engine.sync();
    expect(s.get().trips.trip000001!.days[1]!.startTime.value).toBe('07:00');
    expect(s.api.putDoc).toHaveBeenCalledOnce();
  });
  it('새 로컬 장소는 같은 서버 id와 대응표로 올라간다', async () => {
    const s = setup();
    await s.deps.run((lib) => ({
      ...lib,
      places: {
        ...lib.places,
        newlocal00: {
          ...lib.places.place00001!,
          id: 'newlocal00',
          source: { kind: 'naver', sid: '999' },
        },
      },
      trips: {
        ...lib.trips,
        trip000001: {
          ...lib.trips.trip000001!,
          candidates: { value: ['newlocal00'], updatedAt: new Date().toISOString() },
        },
      },
    }));
    await s.engine.sync();
    expect(s.store.get(s.record.tripId)?.placeMap.newlocal00).toBe('newlocal00');
    expect(s.api.putDoc).toHaveBeenCalledWith(
      'abcdefghij',
      s.record.token,
      expect.objectContaining({
        share: expect.objectContaining({
          places: expect.arrayContaining([expect.objectContaining({ id: 'newlocal00' })]),
        }),
      }),
      2,
    );
  });
  it('꺼짐 응답은 5분 뒤 쓰기를 다시 시도한다', async () => {
    const s = setup();
    s.change(0, '10:00');
    s.api.putDoc.mockResolvedValueOnce({ ok: false, error: 'switched-off' } as never);
    await s.engine.sync();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(s.api.putDoc).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.api.putDoc).toHaveBeenCalledTimes(2);
  });
  it('숨기면 폴링을 멈추고 해제하면 타이머가 사라진다', async () => {
    const s = setup();
    stop = s.engine.retain();
    await vi.advanceTimersByTimeAsync(0);
    const n = s.api.state.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.api.state).toHaveBeenCalledTimes(n);
    stop();
    stop = undefined;
  });
});

it('기록을 지운 뒤 새 공유에 연결하면 문서 캐시 없는 새 엔진을 쓴다', async () => {
  const s = setup(),
    first = collabEngineFor(s.record.tripId, () => s.deps);
  await first.sync();
  s.api.state.mockResolvedValueOnce({ ok: false, error: 'unauthorized' } as never);
  await first.sync();
  first.dismiss();
  s.store.put({ ...s.record, liveId: 'newshare00', rev: 1 });
  const second = collabEngineFor(s.record.tripId, () => s.deps);
  expect(second).not.toBe(first);
  await second.sync();
  expect(s.api.state).toHaveBeenLastCalledWith('newshare00', s.record.token, {
    rev: null,
    prev: null,
  });
});
it('같은 공유에 새 편집 토큰으로 다시 참여해도 종료된 엔진을 재사용하지 않는다', async () => {
  const s = setup(),
    first = collabEngineFor(s.record.tripId, () => s.deps);
  s.api.state.mockResolvedValueOnce({ ok: false, error: 'unauthorized' } as never);
  await first.sync();
  s.store.put({ ...s.record, token: 'n'.repeat(43), deviceId: 'newdev00' });
  const second = collabEngineFor(s.record.tripId, () => s.deps);
  expect(second).not.toBe(first);
  await second.sync();
  expect(s.api.state).toHaveBeenLastCalledWith('abcdefghij', 'n'.repeat(43), {
    rev: null,
    prev: null,
  });
});
it.each(['revoked', 'ended'] as const)(
  '저장된 %s 기록을 다시 열면 종료 안내 상태를 복원한다',
  (status) => {
    const s = setup();
    s.store.update(s.record.tripId, { status });
    expect(new CollabEngine(s.deps).getSnapshot().state).toBe(status);
  },
);
it('이전 연결의 늦은 오류는 새 연결 기록을 끊지 않는다', async () => {
  const s = setup(),
    first = collabEngineFor(s.record.tripId, () => s.deps);
  let finish!: () => void;
  s.api.state.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ ok: false, error: 'unauthorized' } as never);
      }),
  );
  const pending = first.sync();
  await vi.advanceTimersByTimeAsync(0);
  s.store.put({ ...s.record, liveId: 'newshare00', rev: 1 });
  collabEngineFor(s.record.tripId, () => s.deps);
  finish();
  await pending;
  expect(s.store.get(s.record.tripId)?.status).toBe('live');
});
it('소유자가 메모 포함을 끄면 이후 새 장소의 메모와 한 줄 평은 공개하지 않는다', async () => {
  const s = setup();
  s.doc.options.includeMemo = true;
  s.store.update(s.record.tripId, { role: 'owner', token: null, deviceId: null });
  s.deps.liveStore.put({
    tripId: s.record.tripId,
    liveId: s.record.liveId,
    status: 'live',
    ownerToken: 'o'.repeat(43),
    viewToken: 'v'.repeat(43),
    rev: 2,
    dayIds: s.record.dayIds,
    options: { title: '여행', includeMemo: false, includeCandidates: true },
    createdAt: s.doc.share.createdAt,
  });
  await s.deps.run((lib) => ({
    ...lib,
    places: {
      ...lib.places,
      newlocal00: {
        ...lib.places.place00001!,
        id: 'newlocal00',
        source: { kind: 'naver', sid: '999' },
        review: { value: '새 한 줄 평', updatedAt: new Date().toISOString() },
      },
    },
    trips: {
      ...lib.trips,
      trip000001: {
        ...lib.trips.trip000001!,
        candidates: { value: ['newlocal00'], updatedAt: new Date().toISOString() },
      },
    },
  }));
  await s.engine.sync();
  const sent = vi.mocked(s.api.putDoc).mock.calls[0] as unknown as [
    string,
    string,
    typeof s.doc,
    number,
  ];
  expect(sent).toBeDefined();
  expect(sent[2].share.places.find((p) => p.id === 'newlocal00')).not.toHaveProperty('memo');
  expect(sent[2].share.places.find((p) => p.id === 'newlocal00')).not.toHaveProperty('review');
  expect(sent[2].options.includeMemo).toBe(false);
});
it('기록을 지우면 진행 중인 엔진도 끝내고 같은 연결을 다시 넣어도 새로 만든다', async () => {
  const s = setup(),
    first = collabEngineFor(s.record.tripId, () => s.deps);
  let finish!: () => void;
  s.api.state.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ ok: true, value: s.remote() });
      }),
  );
  const pending = first.sync();
  await vi.advanceTimersByTimeAsync(0);
  s.store.remove(s.record.tripId);
  finish();
  await pending;
  expect(s.store.readBase(s.record.liveId)).toBeNull();
  s.store.put(s.record);
  expect(collabEngineFor(s.record.tripId, () => s.deps)).not.toBe(first);
});

it('겹침 중에는 받은 문서 revision으로 폴링해 전체 문서를 되받지 않는다', async () => {
  const s = setup();
  s.change(0, '10:00');
  s.doc.share.trips[0]!.days[0]!.startTime = '08:00';
  s.setRemote({ ...s.remote(), rev: 3 });
  await s.engine.sync();
  s.api.state.mockResolvedValueOnce({ ok: true, value: 'unchanged' } as never);
  await s.engine.sync();
  expect(s.api.state).toHaveBeenLastCalledWith(s.record.liveId, s.record.token, {
    rev: 3,
    prev: 0,
  });
  expect(s.engine.getSnapshot().state).toBe('conflict');
});
it.each(['unchanged', 'progress'] as const)(
  '다른 탭 기준이 새로우면 %s 응답 뒤 문서를 다시 받는다',
  async (kind) => {
    const s = setup();
    await s.engine.sync();
    const fresh = structuredClone(s.doc);
    fresh.share.trips[0]!.days[0]!.startTime = '10:00';
    s.change(0, '10:00');
    s.store.update(s.record.tripId, { rev: 3 });
    s.store.writeBase(s.record.liveId, { rev: 3, plan: planFromDoc(fresh), progress: null });
    s.setRemote({ ...s.remote(), rev: 3, doc: fresh });
    s.api.state.mockResolvedValueOnce({
      ok: true,
      value: kind === 'unchanged' ? 'unchanged' : { ...s.remote(), doc: undefined },
    } as never);
    await s.engine.sync();
    expect(s.api.state).toHaveBeenLastCalledWith(s.record.liveId, s.record.token, {
      rev: null,
      prev: null,
    });
    expect(s.get().trips.trip000001!.days[0]!.startTime.value).toBe('10:00');
    expect(s.api.putDoc).not.toHaveBeenCalled();
  },
);

it.each(['offline', 'switched-off', 'rate-limited', 'gap'] as const)(
  '반영 뒤 %s 대기 중에도 다른 기기의 되돌림을 보존한다',
  async (path) => {
    const s = setup();
    if (path === 'gap') {
      s.change(1, '10:00');
      await s.engine.sync();
      s.doc.share.trips[0]!.days[1]!.startTime = '10:00';
    }
    s.change(1, '11:00');
    s.doc.share.trips[0]!.days[0]!.startTime = '07:00';
    s.setRemote({ ...s.remote(), rev: 4 });
    if (path !== 'gap') s.api.putDoc.mockResolvedValueOnce({ ok: false, error: path } as never);
    await s.engine.sync();
    expect(s.get().trips.trip000001!.days[0]!.startTime.value).toBe('07:00');
    expect(s.store.readBase(s.record.liveId)?.plan.days[0]!.startTime).toBe('07:00');
    expect(s.store.readBase(s.record.liveId)?.rev).toBe(4);
    s.doc.share.trips[0]!.days[0]!.startTime = '09:00';
    s.setRemote({ ...s.remote(), rev: 5 });
    await s.engine.sync();
    expect(s.get().trips.trip000001!.days[0]!.startTime.value).toBe('09:00');
    expect(s.get().trips.trip000001!.days[1]!.startTime.value).toBe('11:00');
  },
);
it('선택 뒤 같은 id의 겹침 값이 바뀌면 적용하지 않고 다시 비교한다', async () => {
  const s = setup();
  s.change(0, '10:00');
  s.doc.share.trips[0]!.days[0]!.startTime = '08:00';
  await s.engine.sync();
  s.doc.share.trips[0]!.days[0]!.startTime = '07:00';
  s.setRemote({ ...s.remote(), rev: 3 });
  await s.engine.resolve({ 'day.0.startTime': 'mine' });
  expect(s.engine.getSnapshot().state).toBe('conflict');
  expect(s.engine.getSnapshot().merge?.theirs.days[0]!.startTime).toBe('07:00');
  expect(s.api.putDoc).not.toHaveBeenCalled();
});
it('동시 추가한 같은 장소의 값을 고른 뒤 결과 Stop id를 보관함에 반영한다', async () => {
  const s = setup();
  const base = planFromDoc(s.doc);
  base.candidates.push(base.days[1]!.stops.pop()!.placeId);
  s.store.writeBase(s.record.liveId, { rev: 2, plan: base, progress: null });
  await s.deps.run((lib) => {
    const trip = lib.trips.trip000001!;
    const day = trip.days[1]!;
    return {
      ...lib,
      trips: {
        ...lib.trips,
        [trip.id]: {
          ...trip,
          days: [
            trip.days[0]!,
            {
              ...day,
              stops: {
                ...day.stops,
                value: day.stops.value.map((stop) => ({
                  ...stop,
                  id: 'mine0001',
                  note: '내 메모',
                })),
              },
            },
          ],
        },
      },
    };
  });
  s.doc.ids.stops[1] = ['thrs0001'];
  await s.engine.sync();
  expect(s.engine.getSnapshot().state).toBe('conflict');
  await s.engine.resolve({ 'stop.thrs0001.note': 'mine' });
  expect(s.engine.getSnapshot().state).toBe('synced');
  expect(s.get().trips.trip000001!.days[1]!.stops.value[0]).toMatchObject({
    id: 'thrs0001',
    note: '내 메모',
  });
});
it('병합 결과가 같은 v1도 비교를 마친 뒤 v2로 올린다', async () => {
  const s = setup();
  s.doc.v = 1 as never;
  await s.engine.sync();
  expect(s.api.putDoc).toHaveBeenCalledWith(
    s.record.liveId,
    s.record.token,
    expect.objectContaining({ v: 2 }),
    2,
  );
});
it('맞추는 중 편집해도 끝난 뒤 3초 모아 다시 맞춘다', async () => {
  const s = setup();
  s.change(0, '10:00');
  let finish!: () => void;
  s.api.putDoc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ ok: true, value: { rev: 3, expiresAt: '2026-12-31' } });
      }),
  );
  const first = s.engine.sync();
  await vi.advanceTimersByTimeAsync(0);
  s.change(1, '11:00');
  s.engine.localChanged();
  finish();
  await first;
  s.doc.share.trips[0]!.days[0]!.startTime = '10:00';
  s.setRemote({ ...s.remote(), rev: 3 });
  await vi.advanceTimersByTimeAsync(2999);
  const requests = s.api.state.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1);
  expect(s.api.state).toHaveBeenCalledTimes(requests + 1);
  await vi.advanceTimersByTimeAsync(7000);
  expect(s.api.putDoc).toHaveBeenCalledTimes(2);
  expect(s.api.putDoc.mock.calls[1]![2].share.trips[0]!.days[1]!.startTime).toBe('11:00');
});

it('계획·당일 두 엔진의 진행도 메모리 판으로 받아 체크와 다음 장소를 놓치지 않는다', async () => {
  const s = setup();
  await s.engine.sync();
  const progress = {
    prev: 1,
    marks: [
      {
        stopId: 'stop0001',
        date: '2026-12-09',
        at: new Date().toISOString(),
        by: { device: 'device01', label: '내 폰' },
      },
    ],
    next: { stopId: 'stop0002', date: '2026-12-10', at: new Date().toISOString(), label: '내 폰' },
  };
  const otherStore = createTripCollabStore();
  const other = new CollabEngine({ ...s.deps, store: otherStore });
  s.api.progress.mockResolvedValueOnce({ ok: true, value: progress });
  other.queueProgress({ stopId: 'stop0001', visited: true, date: '2026-12-09' });
  await vi.advanceTimersByTimeAsync(0);
  expect(otherStore.get(s.record.tripId)?.prev).toBe(1);
  s.api.state.mockImplementation(async (_id, _token, since) =>
    since.prev === 1
      ? { ok: true, value: 'unchanged' }
      : { ok: true, value: { ...s.remote(), doc: undefined, progress } },
  );
  await s.engine.sync();
  expect(s.engine.getSnapshot().progress).toEqual(progress);
  expect(s.store.readBase(s.record.liveId)?.progress).toEqual(progress);
  expect(s.api.state).toHaveBeenLastCalledWith(s.record.liveId, s.record.token, {
    rev: 2,
    prev: 0,
  });
});

it('겹침과 관계없는 공동 변경은 선택과 함께 최신 판으로 반영한다', async () => {
  const s = setup();
  s.change(0, '10:00');
  s.doc.share.trips[0]!.days[0]!.startTime = '08:00';
  await s.engine.sync();
  const seen = s.engine.getSnapshot().merge;
  s.doc.share.trips[0]!.days[1]!.startTime = '07:00';
  s.setRemote({ ...s.remote(), rev: 4 });
  await s.engine.resolve({ 'day.0.startTime': 'mine' }, seen);
  expect(s.engine.getSnapshot().state).toBe('synced');
  expect(s.get().trips.trip000001!.days.map((d) => d.startTime.value)).toEqual(['10:00', '07:00']);
  expect(s.api.putDoc.mock.calls[0]![3]).toBe(4);
});

it('전체 배치에서 무효 쪽을 고르면 이유를 알리고 다른 쪽으로 마칠 수 있다', async () => {
  const s = setup();
  const error = vi.spyOn(toast, 'error');
  // 중복 장소가 남은 보관함을 전체 배치 안전망에서 복구하는 경로다.
  await s.deps.run((lib) => {
    const trip = lib.trips.trip000001!;
    return {
      ...lib,
      trips: {
        ...lib.trips,
        [trip.id]: {
          ...trip,
          candidates: { ...trip.candidates, value: ['place00001'] },
        },
      },
    };
  });
  await s.engine.sync();
  expect(s.engine.getSnapshot().merge?.conflicts.map((c) => c.id)).toEqual(['placement.all']);
  await s.engine.resolve({ 'placement.all': 'mine' }, s.engine.getSnapshot().merge);
  expect(error).toHaveBeenCalledWith('이 조합으로는 장소가 겹쳐요. 다른 쪽을 골라 주세요');
  expect(s.engine.getSnapshot().state).toBe('conflict');
  expect(s.api.putDoc).not.toHaveBeenCalled();
  await s.engine.resolve({ 'placement.all': 'theirs' }, s.engine.getSnapshot().merge);
  expect(s.engine.getSnapshot().state).toBe('synced');
  expect(s.get().trips.trip000001!.candidates.value).toEqual([]);
});
