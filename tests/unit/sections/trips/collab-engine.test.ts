import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollabEngine, type CollabEngineDeps } from 'src/sections/trips/collab/collab-engine';
import { createTripCollabStore, type TripCollabRecord } from 'src/services/trip-collab/store';
import { tripCollabApi, type CollabState } from 'src/services/trip-collab/client';
import { createTripLiveStore } from 'src/services/trip-live/store';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import { ESTIMATE_ONLY } from 'src/domain/trip-live/build-live-doc';
import type { Library } from 'src/schema/library';
import { buildLiveDoc } from '../../../fixtures/live-trip';
import { buildLiveLibrary } from '../../../fixtures/builders';
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
  localStorage.clear();
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
    state: vi.fn(async () => ({ ok: true as const, value: remote })),
    putDoc: vi.fn(async () => ({ ok: true as const, value: { rev: 3, expiresAt: '2026-12-31' } })),
    progress: vi.fn(async () => ({ ok: true as const, value: { prev: 1, marks: [], next: null } })),
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
