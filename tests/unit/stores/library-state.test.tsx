import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { createStore, Provider } from 'jotai';
import { Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLabel, setPlaceMemo } from 'src/domain/library/ops';
import { forkEffect, setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { emptyLibrary, type Library, type Place } from 'src/schema/library';
import { StorageQuotaExceeded } from 'src/services/errors';
import { IdGen } from 'src/services/id-gen';
import { LIBRARY_KEY, LibraryStore } from 'src/services/library-store';
import { PrefsStore } from 'src/services/prefs-store';
import {
  libraryAtom,
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

function setup(
  options: { library?: Library; ids?: string[]; limit?: number; clock?: boolean } = {},
) {
  const storage = createMemoryStorage();
  if (options.library !== undefined) storage.setItem(LIBRARY_KEY, JSON.stringify(options.library));
  const events = new EventTarget();
  const limits = options.limit === undefined ? undefined : { libraryChars: options.limit };
  const layers = Layer.mergeAll(
    LibraryStore.layerWith({ storage, events, limits }),
    PrefsStore.layerWith({ storage }),
    IdGen.layerSequence(options.ids ?? ['label001']),
  );
  const runtime = ManagedRuntime.make(
    options.clock === true ? Layer.mergeAll(layers, TestClock.layer()) : layers,
  );
  setAppRuntimeForTest(runtime);
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <Suspense fallback={null}>{children}</Suspense>
    </Provider>
  );
  const emitRemote = (library: Library) =>
    events.dispatchEvent(
      new StorageEvent('storage', { key: LIBRARY_KEY, newValue: JSON.stringify(library) }),
    );
  return { storage, store, wrapper, emitRemote, runtime };
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
  return hook;
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  toastMock.error.mockClear();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  setAppRuntimeForTest(null);
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
    const remote: Library = {
      ...seeded,
      places: { [P1]: { ...seeded.places[P1]!, memo: { value: '다른 탭 메모', updatedAt: T0 } } },
    };
    await waitFor(() => {
      s.emitRemote(remote);
      expect(s.store.get(libraryAtom).places[P1]?.memo.value).toBe('다른 탭 메모');
    });
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
});
