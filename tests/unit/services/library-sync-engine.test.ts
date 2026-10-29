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
  await vi.advanceTimersByTimeAsync(2000);
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
