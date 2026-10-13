import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { createStore, Provider } from 'jotai';
import { StrictMode, Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importFolder } from 'src/domain/library/add-place';
import { createLabel, setPlaceMemo, type OpCtx } from 'src/domain/library/ops';
import { forkEffect, setAppRuntimeForTest, type AppRuntime } from 'src/lib/effect/runtime';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { emptyLibrary, type Library, type Place } from 'src/schema/library';
import { StorageQuotaExceeded } from 'src/services/errors';
import { IdGen } from 'src/services/id-gen';
import { LegacyTripSource } from 'src/services/legacy-trip-source';
import { LIBRARY_KEY, LibraryStore } from 'src/services/library-store';
import { PlaceLookup } from 'src/services/place-lookup';
import { PrefsStore } from 'src/services/prefs-store';
import { ReverseGeocoder } from 'src/services/reverse-geocoder';
import { RouteLookup } from 'src/services/route-lookup';
import { ShareTemplate } from 'src/services/share-template';
import {
  libraryAtom,
  libraryLoadAtom,
  persistenceAtom,
  useDraft,
  useLibraryAction,
  useLibrarySync,
} from 'src/stores/library-state';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));

const T0 = '2026-10-08T01:00:00.000Z';
const P1 = 'place00001';
const f = <V,>(value: V) => ({ value, updatedAt: T0 });

function place(id: string): Place {
  return {
    id,
    source: { kind: 'naver', sid: id.replace(/\D/g, '') },
    name: f(`장소 ${id}`),
    address: '강원특별자치도 강릉시 난설헌로 131',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
  };
}

const seeded: Library = { ...emptyLibrary(), places: { [P1]: place(P1) } };

/** `seeded`의 메모만 바꾼 문서. */
const withMemo = (base: Library, text: string, updatedAt: string): Library => ({
  ...base,
  places: { ...base.places, [P1]: { ...base.places[P1]!, memo: { value: text, updatedAt } } },
});

function setup(
  options: {
    library?: Library;
    ids?: string[];
    limit?: number;
    clock?: boolean;
    strict?: boolean;
  } = {},
) {
  const storage = createMemoryStorage();
  if (options.library !== undefined) storage.setItem(LIBRARY_KEY, JSON.stringify(options.library));
  // 구독 시점과 저장소 읽기 순서를 관찰한다.
  const log: string[] = [];
  const listeners = { active: 0 };
  const getItem = storage.getItem.bind(storage);
  storage.getItem = (key) => {
    if (key === LIBRARY_KEY) {
      log.push('read');
    }
    return getItem(key);
  };
  const events = new EventTarget();
  const addListener = events.addEventListener.bind(events);
  const removeListener = events.removeEventListener.bind(events);
  events.addEventListener = (...args: Parameters<EventTarget['addEventListener']>) => {
    listeners.active++;
    log.push('subscribe');
    addListener(...args);
  };
  events.removeEventListener = (...args: Parameters<EventTarget['removeEventListener']>) => {
    listeners.active--;
    removeListener(...args);
  };
  const limits = options.limit === undefined ? undefined : { libraryChars: options.limit };
  const layers = Layer.mergeAll(
    LibraryStore.layerWith({ storage, events, limits }),
    PrefsStore.layerWith({ storage }),
    IdGen.layerSequence(options.ids ?? ['label001']),
    LegacyTripSource.layerWith({ storage, fetch: (...args) => globalThis.fetch(...args) }),
    ShareTemplate.layer,
    PlaceLookup.layer,
    ReverseGeocoder.layer,
    RouteLookup.layer,
  );
  const runtime = ManagedRuntime.make(
    options.clock === true ? Layer.mergeAll(layers, TestClock.layer()) : layers,
  );
  runtimes.push(runtime);
  setAppRuntimeForTest(runtime);
  const store = createStore();
  const Mode =
    options.strict === true ? StrictMode : ({ children }: { children: ReactNode }) => children;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Mode>
      <Provider store={store}>
        <Suspense fallback={null}>{children}</Suspense>
      </Provider>
    </Mode>
  );
  /** 다른 탭이 `library`를 저장한 것처럼 저장소를 바꾸고 `storage` 이벤트를 보낸다. */
  const emitRemote = (library: Library) => {
    const raw = JSON.stringify(library);
    storage.setItem(LIBRARY_KEY, raw);
    events.dispatchEvent(new StorageEvent('storage', { key: LIBRARY_KEY, newValue: raw }));
  };
  return { storage, store, wrapper, emitRemote, runtime, log, listeners };
}

/** 로드·동기화가 끝난 `useLibraryAction`. */
async function renderAction(s: ReturnType<typeof setup>) {
  // 로드하는 동안 Suspense로 멈추므로 async act로 렌더해 로드가 끝날 때까지 기다린다.
  let hook!: ReturnType<typeof renderHook<ReturnType<typeof useLibraryAction>, unknown>>;
  await act(async () => {
    hook = renderHook(
      () => {
        useLibrarySync();
        return useLibraryAction();
      },
      { wrapper: s.wrapper },
    );
  });
  await waitFor(() => expect(hook.result.current).not.toBeNull());
  // 구독이 걸릴 때까지 기다린다(포크는 비동기).
  await waitFor(() => expect(s.listeners.active).toBeGreaterThan(0));
  return hook;
}

let consoleError: ReturnType<typeof vi.spyOn>;
// 진짜 `RouteLookup.layer`가 창 이벤트 구독을 걸므로 테스트마다 런타임을 닫아 구독이 쌓이지 않게 한다.
const runtimes: AppRuntime[] = [];
beforeEach(() => {
  toastMock.error.mockClear();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  setAppRuntimeForTest(null);
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  consoleError.mockRestore();
});

describe('useLibrarySync', () => {
  it('fills libraryAtom and persistenceAtom from the store', async () => {
    const s = setup({ library: seeded });
    await renderAction(s);
    expect(s.store.get(libraryAtom)).toEqual(seeded);
    expect(s.store.get(persistenceAtom)).toBe('local');
  });

  it('storage change event refreshes libraryAtom', async () => {
    const s = setup({ library: seeded });
    await renderAction(s);
    s.emitRemote(withMemo(seeded, '다른 탭 메모', '2026-10-08T03:00:00.000Z'));
    await waitFor(() =>
      expect(s.store.get(libraryAtom).places[P1]?.memo.value).toBe('다른 탭 메모'),
    );
  });

  it('subscribes to changes before re-reading, so a change between load and mount is not lost', async () => {
    const s = setup({ library: seeded });
    await s.store.get(libraryLoadAtom); // 로드는 끝났다.
    // 로드와 마운트 사이에 다른 탭이 저장했다(이벤트는 아직 구독자가 없어 사라진다).
    s.storage.setItem(
      LIBRARY_KEY,
      JSON.stringify(withMemo(seeded, '사이에 바뀜', '2026-10-08T03:00:00.000Z')),
    );
    s.log.length = 0;
    await renderAction(s);
    await waitFor(() =>
      expect(s.store.get(libraryAtom).places[P1]?.memo.value).toBe('사이에 바뀜'),
    );
    expect(s.log).toEqual(['subscribe', 'read']);
  });

  it('unmounting stops the changes subscription', async () => {
    const s = setup({ library: seeded });
    const hook = await renderAction(s);
    expect(s.listeners.active).toBe(1);
    hook.unmount();
    await waitFor(() => expect(s.listeners.active).toBe(0));
    const before = s.store.get(libraryAtom);
    s.emitRemote(withMemo(seeded, '언마운트 뒤', '2026-10-08T03:00:00.000Z'));
    await new Promise((r) => setTimeout(r, 20));
    expect(s.store.get(libraryAtom)).toBe(before);
  });

  it('keeps exactly one subscription under StrictMode double mount', async () => {
    const s = setup({ library: seeded, strict: true });
    await renderAction(s);
    await waitFor(() => expect(s.listeners.active).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(s.listeners.active).toBe(1);
    s.log.length = 0;
    s.emitRemote(withMemo(seeded, '스트릭트', '2026-10-08T03:00:00.000Z'));
    await waitFor(() => expect(s.store.get(libraryAtom).places[P1]?.memo.value).toBe('스트릭트'));
    expect(s.log).toEqual(['read']); // 이벤트 하나에 읽기 한 번
  });
});

describe('useLibraryAction', () => {
  it('applies the op to the stored document and sets libraryAtom after the store succeeds', async () => {
    const s = setup({ library: seeded });
    const { result } = await renderAction(s);
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run((lib, ctx) => setPlaceMemo(lib, P1, '메모', ctx));
    });
    expect(outcome).toEqual({ ok: true });
    expect(s.store.get(libraryAtom).places[P1]?.memo.value).toBe('메모');
    expect(JSON.parse(s.storage.getItem(LIBRARY_KEY)!).places[P1].memo.value).toBe('메모');
  });

  it('returns the created id from OpResult and uses IdGen for new ids', async () => {
    const s = setup({ ids: ['label001'] });
    const { result } = await renderAction(s);
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run((lib, ctx) => createLabel(lib, '카페', ctx));
    });
    expect(outcome).toEqual({ ok: true, createdId: 'label001' });
    expect(s.store.get(libraryAtom).labels['label001']?.name.value).toBe('카페');
  });

  it('passes the summary from OpResult through', async () => {
    const s = setup({ ids: ['label001', 'place00001'] });
    const { result } = await renderAction(s);
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run((lib, ctx) =>
        importFolder(
          lib,
          [{ sid: '1', name: '콤포트', address: '강원 속초시', lng: 128.59, lat: 38.2, memo: '' }],
          { newLabelName: '속초' },
          ctx,
        ),
      );
    });
    expect(outcome).toEqual({
      ok: true,
      createdId: 'label001',
      summary: { created: 1, merged: 0, restored: 0 },
    });
    expect(s.store.get(libraryAtom).places['place00001']?.name.value).toBe('콤포트');
  });

  it('action updates atom only after store succeeds', async () => {
    const s = setup({ ids: ['label001', 'label002'] });
    const { result } = await renderAction(s);
    await act(async () => {
      await result.current.run((lib, ctx) => createLabel(lib, '카페', ctx));
    });
    const before = s.store.get(libraryAtom);
    const storedBefore = s.storage.getItem(LIBRARY_KEY);

    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run((lib, ctx) => createLabel(lib, '카페', ctx));
    });

    expect(outcome).toEqual({ ok: false, error: { _tag: 'LabelNameTaken', name: '카페' } });
    expect(s.store.get(libraryAtom)).toBe(before);
    expect(s.storage.getItem(LIBRARY_KEY)).toBe(storedBefore);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('keeps atom and storage unchanged and reports when the store rejects the write', async () => {
    const s = setup({ library: seeded, limit: JSON.stringify(seeded).length + 1 });
    const { result } = await renderAction(s);
    const before = s.store.get(libraryAtom);
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run((lib, ctx) => setPlaceMemo(lib, P1, '길어진 메모', ctx));
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome && !outcome.ok && outcome.error).toBeInstanceOf(StorageQuotaExceeded);
    expect(s.store.get(libraryAtom)).toBe(before);
    expect(toastMock.error).toHaveBeenCalledWith(
      new StorageQuotaExceeded({ bytes: 0 }).userMessage,
    );
  });

  it('does not let a run result overwrite a newer document that landed while it ran', async () => {
    const s = setup({ library: seeded });
    const { result } = await renderAction(s);
    const newer = withMemo(seeded, '다른 탭이 나중에 저장', '2026-10-08T05:00:00.000Z');
    // 우리 쓰기 직후 다른 탭이 저장했고, 그 변경이 우리 결과보다 먼저 화면 상태에 닿았다.
    const setItem = s.storage.setItem.bind(s.storage);
    s.storage.setItem = (key, value) => {
      setItem(key, value);
      if (key === LIBRARY_KEY && !value.includes('다른 탭이 나중에 저장')) {
        setItem(key, JSON.stringify(newer));
        s.store.set(libraryAtom, newer);
      }
    };
    await act(async () => {
      await result.current.run((lib, ctx: OpCtx) => setPlaceMemo(lib, P1, '내 메모', ctx));
    });
    expect(s.store.get(libraryAtom)).toEqual(newer);
  });

  it('takes ctx.now from the Effect Clock', async () => {
    const s = setup({ library: seeded, clock: true });
    const { result } = await renderAction(s);
    await act(async () => {
      await result.current.run((lib, ctx) => setPlaceMemo(lib, P1, '시계', ctx));
    });
    expect(s.store.get(libraryAtom).places[P1]?.memo.updatedAt).toBe('1970-01-01T00:00:00.000Z');
    await act(async () => {
      await s.runtime.runPromise(TestClock.adjust('1 hour'));
      await result.current.run((lib, ctx) => setPlaceMemo(lib, P1, '한 시간 뒤', ctx));
    });
    expect(s.store.get(libraryAtom).places[P1]?.memo.updatedAt).toBe('1970-01-01T01:00:00.000Z');
  });
});

describe('forkEffect', () => {
  it('unhandled forked failure with userMessage shows toast', async () => {
    setup();
    forkEffect(Effect.fail(new StorageQuotaExceeded({ bytes: 1 })));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith('저장 공간이 부족해 저장하지 못했어요');
    expect(consoleError).toHaveBeenCalled();
  });

  it('logs failures without userMessage and shows no toast', async () => {
    setup();
    forkEffect(Effect.fail(new Error('boom')));
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('returns a function that stops the fiber', async () => {
    setup();
    let finalized = false;
    const stop = forkEffect(
      Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => (finalized = true)))),
    );
    await new Promise((r) => setTimeout(r, 10));
    stop();
    await waitFor(() => expect(finalized).toBe(true));
  });
});

describe('useDraft', () => {
  const ok = async () => ({ ok: true });

  it('follows saved while not dirty', () => {
    const { result, rerender } = renderHook(({ saved }) => useDraft('p1', saved), {
      initialProps: { saved: 'a' },
    });
    expect(result.current).toMatchObject({ value: 'a', dirty: false, status: 'idle' });
    rerender({ saved: 'b' });
    expect(result.current.value).toBe('b');
  });

  it('dirty draft is not overwritten by remote change and exposes remoteChanged', () => {
    const { result, rerender } = renderHook(({ saved }) => useDraft('p1', saved), {
      initialProps: { saved: 'a' },
    });
    act(() => result.current.setValue('내가 쓰는 중'));
    expect(result.current).toMatchObject({
      value: '내가 쓰는 중',
      dirty: true,
      remoteChanged: false,
    });

    rerender({ saved: '다른 탭' });
    expect(result.current).toMatchObject({
      value: '내가 쓰는 중',
      dirty: true,
      remoteChanged: true,
    });
  });

  it('draft status becomes saved only after successful commit', async () => {
    const { result, rerender } = renderHook(({ saved }) => useDraft('p1', saved), {
      initialProps: { saved: 'a' },
    });
    act(() => result.current.setValue('b'));
    let finish: (r: { ok: boolean }) => void = () => {};
    const pending = new Promise<{ ok: boolean }>((resolve) => (finish = resolve));
    let committing: Promise<void> = Promise.resolve();
    act(() => {
      committing = result.current.commit(() => pending);
    });
    expect(result.current).toMatchObject({ status: 'saving', dirty: true });

    await act(async () => {
      finish({ ok: true });
      await committing;
    });
    rerender({ saved: 'b' });
    expect(result.current).toMatchObject({
      status: 'saved',
      dirty: false,
      value: 'b',
      remoteChanged: false,
    });

    act(() => result.current.setValue('c'));
    expect(result.current.status).toBe('idle');
  });

  it('stays dirty with error status when commit fails or throws, and can retry', async () => {
    const { result } = renderHook(() => useDraft('p1', 'a'));
    act(() => result.current.setValue('b'));

    await act(() => result.current.commit(async () => ({ ok: false })));
    expect(result.current).toMatchObject({ status: 'error', dirty: true, value: 'b' });

    await act(() =>
      result.current.commit(async () => {
        throw new Error('network');
      }),
    );
    expect(result.current).toMatchObject({ status: 'error', dirty: true, value: 'b' });

    await act(() => result.current.commit(ok));
    expect(result.current).toMatchObject({ status: 'saved', dirty: false });
  });

  it('keeps edits made while saving as dirty', async () => {
    const { result } = renderHook(() => useDraft('p1', 'a'));
    act(() => result.current.setValue('b'));
    let finish: (r: { ok: boolean }) => void = () => {};
    const pending = new Promise<{ ok: boolean }>((resolve) => (finish = resolve));
    let committing: Promise<void> = Promise.resolve();
    act(() => {
      committing = result.current.commit(() => pending);
    });
    act(() => result.current.setValue('bc'));
    await act(async () => {
      finish({ ok: true });
      await committing;
    });
    expect(result.current).toMatchObject({ value: 'bc', dirty: true, status: 'idle' });
  });

  it('resets the draft when the key changes', () => {
    const { result, rerender } = renderHook(({ k, saved }) => useDraft(k, saved), {
      initialProps: { k: 'p1', saved: 'a' },
    });
    act(() => result.current.setValue('b'));
    rerender({ k: 'p2', saved: 'z' });
    expect(result.current).toMatchObject({ value: 'z', dirty: false });
  });

  const deferred = () => {
    let resolve: (r: { ok: boolean }) => void = () => {};
    const promise = new Promise<{ ok: boolean }>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('a setValue captured for the old key does not write into the new key draft', () => {
    const { result, rerender } = renderHook(({ k, saved }) => useDraft(k, saved), {
      initialProps: { k: 'A', saved: 'a' },
    });
    const staleSetValue = result.current.setValue;
    rerender({ k: 'B', saved: 'b' });
    act(() => staleSetValue('A의 글'));
    expect(result.current).toMatchObject({ value: 'b', dirty: false, remoteChanged: false });
  });

  it('does not bring the old draft back when returning to a key (A -> B -> A)', () => {
    const { result, rerender } = renderHook(({ k, saved }) => useDraft(k, saved), {
      initialProps: { k: 'A', saved: 'a' },
    });
    act(() => result.current.setValue('x'));
    rerender({ k: 'B', saved: 'b' });
    expect(result.current).toMatchObject({ value: 'b', dirty: false });
    rerender({ k: 'A', saved: 'a' });
    expect(result.current).toMatchObject({
      value: 'a',
      dirty: false,
      remoteChanged: false,
      status: 'idle',
    });
  });

  it('ignores a commit that resolves after switching away and back (A -> B -> A)', async () => {
    const { result, rerender } = renderHook(({ k, saved }) => useDraft(k, saved), {
      initialProps: { k: 'A', saved: 'a' },
    });
    act(() => result.current.setValue('x'));
    const d = deferred();
    let committing: Promise<void> = Promise.resolve();
    act(() => {
      committing = result.current.commit(() => d.promise);
    });
    rerender({ k: 'B', saved: 'b' });
    await act(async () => {
      d.resolve({ ok: true });
      await committing;
    });
    rerender({ k: 'A', saved: 'x' });
    expect(result.current).toMatchObject({
      value: 'x',
      dirty: false,
      remoteChanged: false,
      status: 'idle',
    });
  });

  it('ignores an old commit that resolves after returning to the key', async () => {
    const { result, rerender } = renderHook(({ k, saved }) => useDraft(k, saved), {
      initialProps: { k: 'A', saved: 'a' },
    });
    act(() => result.current.setValue('x'));
    const d = deferred();
    let committing: Promise<void> = Promise.resolve();
    act(() => {
      committing = result.current.commit(() => d.promise);
    });
    rerender({ k: 'B', saved: 'b' });
    rerender({ k: 'A', saved: 'a' });
    act(() => result.current.setValue('y')); // 돌아온 뒤의 새 초안
    await act(async () => {
      d.resolve({ ok: true });
      await committing;
    });
    expect(result.current).toMatchObject({
      value: 'y',
      dirty: true,
      remoteChanged: false,
      status: 'idle',
    });
  });

  it('an older commit succeeding while a newer one is saving keeps status saving', async () => {
    const { result } = renderHook(() => useDraft('p1', 'a'));
    const d1 = deferred();
    const d2 = deferred();
    act(() => result.current.setValue('b'));
    let c1: Promise<void> = Promise.resolve();
    let c2: Promise<void> = Promise.resolve();
    act(() => {
      c1 = result.current.commit(() => d1.promise);
    });
    act(() => result.current.setValue('bc'));
    act(() => {
      c2 = result.current.commit(() => d2.promise);
    });

    await act(async () => {
      d1.resolve({ ok: true });
      await c1;
    });
    expect(result.current).toMatchObject({ status: 'saving', dirty: true, value: 'bc' });

    await act(async () => {
      d2.resolve({ ok: true });
      await c2;
    });
    expect(result.current).toMatchObject({ status: 'saved', dirty: false });
  });

  it('a repeated commit of the same edit never flips saved back to idle', async () => {
    const { result } = renderHook(() => useDraft('p1', 'a'));
    const d1 = deferred();
    const d2 = deferred();
    act(() => result.current.setValue('b'));
    let c1: Promise<void> = Promise.resolve();
    let c2: Promise<void> = Promise.resolve();
    act(() => {
      c1 = result.current.commit(() => d1.promise);
      c2 = result.current.commit(() => d2.promise);
    });
    await act(async () => {
      d1.resolve({ ok: true });
      await c1;
    });
    expect(result.current).toMatchObject({ status: 'saving', dirty: false });
    await act(async () => {
      d2.resolve({ ok: true });
      await c2;
    });
    expect(result.current).toMatchObject({ status: 'saved', dirty: false });

    const save = vi.fn(ok);
    await act(() => result.current.commit(save)); // 저장할 초안이 없다.
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe('saved');
  });

  it('out-of-order commit results do not move the remote-change baseline back', async () => {
    const { result, rerender } = renderHook(({ saved }) => useDraft('p1', saved), {
      initialProps: { saved: 'a' },
    });
    const d1 = deferred();
    const d2 = deferred();
    act(() => result.current.setValue('b'));
    let c1: Promise<void> = Promise.resolve();
    let c2: Promise<void> = Promise.resolve();
    act(() => {
      c1 = result.current.commit(() => d1.promise);
    });
    act(() => result.current.setValue('bc'));
    act(() => {
      c2 = result.current.commit(() => d2.promise);
    });
    act(() => result.current.setValue('bcd'));

    await act(async () => {
      d2.resolve({ ok: true }); // 나중에 시작한 저장이 먼저 끝난다.
      await c2;
    });
    await act(async () => {
      d1.resolve({ ok: true }); // 오래된 저장이 늦게 끝난다.
      await c1;
    });
    rerender({ saved: 'bc' }); // 저장소는 'bc'다. 기준이 'b'로 돌아갔다면 remoteChanged가 켜진다.
    expect(result.current).toMatchObject({
      value: 'bcd',
      dirty: true,
      remoteChanged: false,
      status: 'idle',
    });
  });
});
