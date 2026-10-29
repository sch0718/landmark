// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import {
  createLibrarySyncEngine,
  SAVE_DEBOUNCE_MS,
  type EngineDeps,
} from 'src/services/library-sync/sync-engine';
import { createSyncApi } from 'src/services/library-sync/api';
import {
  newDeviceMeta,
  readSyncMeta,
  writeSyncMeta,
  writeSession,
  readSession,
  readBase,
  readConflicts,
} from 'src/services/library-sync/storage';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { emptyLibrary, type Library, type Place } from 'src/schema/library';
import { LibraryStore, LIBRARY_KEY } from 'src/services/library-store';
import { TripSchema, checkTrip, type Trip } from 'src/schema/trip';
import { safeParse } from 'src/schema/parse';
import { IdGen } from 'src/services/id-gen';
import { OFF_STATUS } from 'src/stores/sync-status';
import { createHeldLocks } from '../../fixtures/fake-locks';
import { createSyncMemoryServer } from '../../helpers/sync-memory-server';
const f = <T>(value: T, updatedAt = '2026-10-03T00:00:00.000Z') => ({ value, updatedAt });
const p: Place = {
  id: 'place00001',
  source: { kind: 'pin' },
  name: f('장소'),
  address: '',
  lng: 127,
  lat: 37,
  category: f(null),
  memo: f('처음'),
  labelIds: f([]),
  saved: f(true),
  createdAt: '2026-10-03T00:00:00.000Z',
  deletedAt: null,
};
const disposers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const dispose of disposers.splice(0)) await dispose();
});
async function device(
  server: ReturnType<typeof createSyncMemoryServer>,
  lib: Library = emptyLibrary(),
) {
  const storage = createMemoryStorage();
  storage.setItem(LIBRARY_KEY, JSON.stringify(lib));
  writeSession(storage, { v: 1, provider: 'kakao', sessionId: await server.login() });
  const api = createSyncApi({
    config: {
      apiBase: 'http://localhost:8795/api/sync',
      firebase: null,
      kakao: null,
      naver: null,
      devFake: true,
    },
    storage,
    auth: null,
    fetch: server.fetch,
  });
  const me = await api.me();
  if (!me.ok) throw Error('로그인 실패');
  writeSyncMeta(storage, {
    ...newDeviceMeta(),
    enabled: true,
    pendingChoice: true,
    userId: me.data.userId,
    provider: 'kakao',
  });
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      LibraryStore.layerWith({ storage, locks: createHeldLocks().locks }),
      IdGen.layer,
    ),
  );
  disposers.push(() => runtime.dispose());
  const state = { time: Date.now(), online: true, status: OFF_STATUS, lib };
  const deps: EngineDeps = {
    api,
    storage,
    runLibrary: (effect) => runtime.runPromise(effect),
    setLibrary: (lib) => {
      state.lib = lib;
    },
    setStatus: (status) => {
      state.status = status;
    },
    now: () => state.time,
    online: () => state.online,
    visible: () => true,
    notify: vi.fn(),
    newConflictId: () => crypto.randomUUID(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const engine = createLibrarySyncEngine(deps);
  disposers.push(() => engine.stop());
  const edit = async (text: string) => {
    state.time += 1000;
    await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* store.update((current) =>
          Effect.succeed({
            ...current,
            places: {
              ...current.places,
              [p.id]: {
                ...current.places[p.id]!,
                memo: f(text, new Date(state.time).toISOString()),
              },
            },
          }),
        );
      }),
    );
  };
  return { storage, api, engine, state, deps, runtime, edit };
}
it('두 기기의 올리기·받기·충돌 복원과 연결 해제를 끝까지 처리한다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server, { ...emptyLibrary(), places: { [p.id]: p } });
  const b = await device(server);
  expect((await a.engine.connect('upload')).phase).toBe('synced');
  expect(Object.keys(readBase(a.storage).items)).toHaveLength(1);
  expect((await b.engine.connect('merge')).phase).toBe('synced');
  expect(b.state.lib.places[p.id]?.memo.value).toBe('처음');
  await a.edit('A 메모');
  await a.engine.runNow('manual');
  await b.engine.runNow('open');
  expect(b.state.lib.places[p.id]?.memo.value).toBe('A 메모');
  b.state.online = false;
  await b.edit('B 오프라인');
  expect(await b.engine.runNow('manual')).toMatchObject({ phase: 'local', offline: true });
  a.state.time = b.state.time + 1000;
  await a.edit('A 나중');
  await a.engine.runNow('manual');
  b.state.online = true;
  b.state.time = a.state.time + 1000;
  expect((await b.engine.runNow('online')).phase).toBe('conflict');
  expect(readConflicts(b.storage)).toHaveLength(1);
  await b.engine.runNow('manual');
  expect(b.deps.notify).toHaveBeenCalledTimes(1);
  await b.engine.resolveConflict(readConflicts(b.storage)[0]!.id, 'mine');
  await b.engine.runNow('manual');
  await a.engine.runNow('manual');
  expect(a.state.lib.places[p.id]?.memo.value).toBe('B 오프라인');
  const base = readBase(a.storage);
  await a.engine.disconnect();
  expect(readSession(a.storage)).toBeNull();
  expect(readBase(a.storage)).toEqual(base);
  expect(await b.engine.deleteServerData()).toBe(true);
  expect(readSyncMeta(b.storage).userId).toBeNull();
});
it('꺼짐·오프라인·세션 철회와 2초 저장 모음을 처리한다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server);
  await a.engine.connect('merge');
  const changes = vi.spyOn(a.api, 'changes');
  a.engine.disable();
  expect((await a.engine.runNow('open')).phase).toBe('off');
  expect(changes).not.toHaveBeenCalled();
  writeSyncMeta(a.storage, { ...readSyncMeta(a.storage), enabled: true, pendingChoice: false });
  a.state.online = false;
  expect((await a.engine.runNow('open')).offline).toBe(true);
  expect(changes).not.toHaveBeenCalled();
  a.state.online = true;
  vi.useFakeTimers();
  a.engine.schedule('save');
  a.engine.schedule('save');
  a.engine.schedule('save');
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
  expect(changes).not.toHaveBeenCalled();
  const finished = new Promise<void>((resolve) => {
    a.engine.onRunFinished(() => resolve());
  });
  await vi.advanceTimersByTimeAsync(1);
  await finished;
  expect(changes).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
  await a.api.client.endSession();
  expect((await a.engine.runNow('manual')).phase).toBe('auth');
  expect(readSession(a.storage)).toBeNull();
});
it('서버 보관함으로 바꾸기는 되살리기 사본을 남긴다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server, { ...emptyLibrary(), places: { [p.id]: p } });
  await a.engine.connect('upload');
  const b = await device(server, {
    ...emptyLibrary(),
    places: { place00002: { ...p, id: 'place00002' } },
  });
  await b.engine.connect('replace-local');
  expect(b.state.lib.places[p.id]).toBeDefined();
  expect(b.state.lib.places.place00002).toBeUndefined();
  expect(
    await b.runtime.runPromise(Effect.flatMap(LibraryStore, (s) => s.previous)),
  ).not.toBeNull();
});
it('전송 중 추가 수정과 410 뒤 없어진 서버 묘비를 보존한다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server, { ...emptyLibrary(), places: { [p.id]: p } });
  await a.engine.connect('upload');
  await a.edit('전송 값');
  const push = a.api.push.bind(a.api);
  vi.spyOn(a.api, 'push').mockImplementationOnce(async (body) => {
    await a.edit('전송 중 수정');
    return push(body);
  });
  await a.engine.runNow('manual');
  expect(a.state.lib.places[p.id]?.memo.value).toBe('전송 중 수정');
  await a.engine.runNow('manual');
  await server.db.prepare('DELETE FROM library_items').run();
  await server.db.prepare('UPDATE library_state SET purged_rev = rev + 10').run();
  expect((await a.engine.runNow('manual')).phase).toBe('synced');
  expect(a.state.lib.places[p.id]?.deletedAt).not.toBeNull();
});
it('실행 중 예약은 한 번만 이어지고 장애 재시도는 정해진 간격을 쓴다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server);
  await a.engine.connect('merge');
  const original = a.api.changes.bind(a.api);
  let release: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    vi.spyOn(a.api, 'changes').mockImplementationOnce(async (q) => {
      resolve();
      await new Promise<void>((r) => {
        release = r;
      });
      return original(q);
    });
  });
  vi.useFakeTimers();
  const run = a.engine.runNow('manual');
  await entered;
  a.engine.schedule('save');
  a.engine.schedule('visible');
  release!();
  await run;
  vi.advanceTimersByTime(2000);
  await a.engine.runNow('manual');
  expect(a.api.changes).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
  const timer = vi.spyOn(a.deps, 'setTimer');
  vi.spyOn(a.api, 'changes').mockResolvedValue({ ok: false, kind: 'limit', code: 'rate-limited' });
  expect((await a.engine.runNow('manual')).phase).toBe('unavailable');
  expect(timer).toHaveBeenLastCalledWith(expect.any(Function), 30000);
  await a.engine.runNow('retry');
  expect(timer).toHaveBeenLastCalledWith(expect.any(Function), 120000);
});
it('동기화 Web Lock을 얻은 뒤에만 서버에 요청한다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server);
  await a.engine.connect('merge');
  const held = createHeldLocks();
  held.hold();
  a.deps.locks = held.locks;
  const changes = vi.spyOn(a.api, 'changes');
  const run = a.engine.runNow('manual');
  await Promise.resolve();
  expect(held.requested).toEqual(['tripmap:library-sync']);
  expect(changes).not.toHaveBeenCalled();
  held.release();
  await run;
  expect(changes).toHaveBeenCalledTimes(1);
});
it('저장 직후 서버 확인 전에는 완료로 표시하지 않는다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server, { ...emptyLibrary(), places: { [p.id]: p } });
  await a.engine.connect('upload');
  await a.edit('저장됨');
  a.engine.schedule('save');
  expect(a.state.status.phase).toBe('local');
});
it('전송 중 수정이 남았으면 마지막 동기화 시각을 앞당겨 유실을 숨기지 않는다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server, { ...emptyLibrary(), places: { [p.id]: p } });
  await a.engine.connect('upload');
  const before = readSyncMeta(a.storage).lastSyncAt;
  await a.edit('전송 값');
  const push = a.api.push.bind(a.api);
  vi.spyOn(a.api, 'push').mockImplementationOnce(async (body) => {
    await a.edit('아직 안 올린 값');
    a.state.time += 1000;
    return push(body);
  });
  await a.engine.runNow('manual');
  expect(readSyncMeta(a.storage).lastSyncAt).toBe(before);
});
it('이 기기에 없는 보류 항목을 내 값으로 맞추면 건너뛰기로 처리한다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server);
  await a.engine.connect('merge');
  const key = 'place:missing001';
  writeSyncMeta(a.storage, {
    ...readSyncMeta(a.storage),
    held: [{ key, rev: 2, reason: 'decode' }],
  });
  await a.engine.resolveHeld(key, 'mine');
  expect(readSyncMeta(a.storage).skipped).toContain(key);
});

it('복원으로 사라진 항목을 전체 재동기화로 받고 다음 실행은 기존 커서를 쓴다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server, { ...emptyLibrary(), places: { [p.id]: p } });
  await a.engine.connect('upload');
  await a.engine.runNow('manual'); // 첫 올리기의 메아리를 받아 차분 커서를 확정한다.
  const cursor = readSyncMeta(a.storage).cursor!;
  expect(cursor.rev).toBeGreaterThan(0);
  await a.runtime.runPromise(
    Effect.flatMap(LibraryStore, (store) =>
      store.replace(emptyLibrary(), { requirePrevious: true }),
    ),
  );
  const changes = vi.spyOn(a.api, 'changes');
  expect((await a.engine.runNow('open')).phase).toBe('synced');
  expect(changes.mock.calls[0]?.[0]).toMatchObject({ since: 0, after: '' });
  expect(a.state.lib.places[p.id]).toEqual(p);
  changes.mockClear();
  await a.engine.runNow('visible');
  expect(changes).toHaveBeenCalledTimes(1);
  expect(changes.mock.calls[0]?.[0]).toMatchObject({ since: cursor.rev, after: cursor.key });
});

it.each([1, 3])('여행 %s일 날짜·일정 충돌을 한 번에 되돌려 보관함에 저장한다', async (mineDays) => {
  const makeTrip = (count: number, at: string, title = f('여행')): Trip => ({
    id: 'trip000001',
    title,
    startDate: f('2026-11-01', at),
    endDate: f(`2026-11-0${count}`, at),
    origin: f(null),
    candidates: f([]),
    days: Array.from({ length: count }, () => ({
      stops: f([], at),
      lodging: f(null, at),
      startTime: f('10:00', at),
    })),
    legModes: f({}),
    createdAt: p.createdAt,
    deletedAt: null,
  });
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const initial = makeTrip(1, p.createdAt);
  const a = await device(server, { ...emptyLibrary(), trips: { [initial.id]: initial } });
  await a.engine.connect('upload');
  const b = await device(server);
  await b.engine.connect('merge');
  a.state.time += 1000;
  b.state.time = a.state.time + 1000;
  const mine = makeTrip(mineDays, new Date(a.state.time).toISOString());
  const theirs = makeTrip(
    mineDays === 1 ? 3 : 1,
    new Date(b.state.time).toISOString(),
    f('다른 기기의 제목', new Date(b.state.time).toISOString()),
  );
  for (const [d, trip] of [
    [a, mine],
    [b, theirs],
  ] as const)
    await d.runtime.runPromise(
      Effect.flatMap(LibraryStore, (store) =>
        store.update((current) => Effect.succeed({ ...current, trips: { [trip.id]: trip } })),
      ),
    );
  await b.engine.runNow('manual');
  expect((await a.engine.runNow('manual')).phase).toBe('conflict');
  const conflicts = readConflicts(a.storage);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]).toMatchObject({
    path: 'dates',
    mine: { startDate: mine.startDate, endDate: mine.endDate, days: mine.days },
    theirs: { startDate: theirs.startDate, endDate: theirs.endDate, days: theirs.days },
  });
  a.state.time = b.state.time + 1000;
  await a.engine.resolveConflict(conflicts[0]!.id, 'mine');
  const restored = a.state.lib.trips[initial.id]!;
  const now = new Date(a.state.time).toISOString();
  expect(restored.startDate).toEqual(f(mine.startDate.value, now));
  expect(restored.endDate).toEqual(f(mine.endDate.value, now));
  expect(restored.days).toEqual(
    mine.days.map((day) => ({
      stops: f(day.stops.value, now),
      lodging: f(day.lodging.value, now),
      startTime: f(day.startTime.value, now),
    })),
  );
  expect(restored.title).toEqual(theirs.title);
  expect(safeParse(TripSchema, restored).success).toBe(true);
  expect(checkTrip(restored, {}, [])).toEqual([]);
  const saved = await a.runtime.runPromise(Effect.flatMap(LibraryStore, (store) => store.snapshot));
  expect(saved.library.trips[initial.id]).toEqual(restored);
  expect(readConflicts(a.storage)).toEqual([]);
});

it('첫 연결 성공 뒤 탭·온라인 복귀를 구독하고 중복 시작은 한 번만 구독한다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server);
  const events = new EventTarget();
  a.deps.events = events;
  const add = vi.spyOn(events, 'addEventListener');
  const remove = vi.spyOn(events, 'removeEventListener');
  vi.useFakeTimers();
  expect((await a.engine.connect('merge')).phase).toBe('synced');
  expect(add).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  expect(add).toHaveBeenCalledWith('online', expect.any(Function));
  a.engine.start();
  expect(add).toHaveBeenCalledTimes(2);
  const schedule = vi.spyOn(a.engine, 'schedule');
  events.dispatchEvent(new Event('visibilitychange'));
  expect(schedule).toHaveBeenCalledWith('visible');
  events.dispatchEvent(new Event('online'));
  expect(schedule).toHaveBeenCalledWith('online');
  a.engine.stop();
  expect(remove).toHaveBeenCalledTimes(2);
  schedule.mockClear();
  events.dispatchEvent(new Event('online'));
  events.dispatchEvent(new Event('visibilitychange'));
  expect(schedule).not.toHaveBeenCalled();
});
it('연결 실패 때는 구독하지 않고 다음 연결 성공 때 시작한다', async () => {
  const server = createSyncMemoryServer();
  disposers.push(() => server.db.close());
  const a = await device(server);
  a.deps.events = new EventTarget();
  const add = vi.spyOn(a.deps.events, 'addEventListener');
  vi.spyOn(a.api, 'changes').mockResolvedValueOnce({ ok: false, kind: 'server', status: 500 });
  expect((await a.engine.connect('merge')).phase).toBe('unavailable');
  expect(add).not.toHaveBeenCalled();
  expect((await a.engine.connect('merge')).phase).toBe('synced');
  expect(add).toHaveBeenCalledTimes(2);
});
