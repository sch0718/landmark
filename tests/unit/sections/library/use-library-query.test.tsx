import { act, renderHook } from '@testing-library/react';
import { Layer, ManagedRuntime } from 'effect';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { QUERY_PERSIST_DELAY_MS, useLibraryQuery } from 'src/sections/library/use-library-query';
import { IdGen } from 'src/services/id-gen';
import { LegacyTripSource } from 'src/services/legacy-trip-source';
import { LibraryStore } from 'src/services/library-store';
import { PREFS_KEY, PrefsStore } from 'src/services/prefs-store';
import { ShareTemplate } from 'src/services/share-template';
import { libraryAtom } from 'src/stores/library-state';
import { prefsAtom } from 'src/stores/prefs-state';
import { L_FOOD, sampleLibrary } from './fixtures';

function setup() {
  const storage = createMemoryStorage();
  setAppRuntimeForTest(
    ManagedRuntime.make(
      Layer.mergeAll(
        LibraryStore.layerWith({ storage, events: new EventTarget() }),
        PrefsStore.layerWith({ storage }),
        IdGen.layerSequence([]),
        LegacyTripSource.layerWith({ storage, fetch: (...args) => globalThis.fetch(...args) }),
        ShareTemplate.layer,
      ),
    ),
  );
  const store = createStore();
  store.set(libraryAtom, sampleLibrary());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const savedQuery = () => {
    const raw = storage.getItem(PREFS_KEY);
    return raw === null ? null : JSON.parse(raw).query;
  };
  return { storage, store, wrapper, savedQuery };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  setAppRuntimeForTest(null);
});

/** 저장은 Effect 파이버에서 비동기로 일어난다. 마이크로태스크를 비워 끝나게 한다. */
const settle = () => act(async () => void (await Promise.resolve()));

describe('useLibraryQuery', () => {
  it('returns the new query at once and saves it once, 300ms after the last change', async () => {
    const s = setup();
    const { result } = renderHook(() => useLibraryQuery(), { wrapper: s.wrapper });

    act(() => result.current[1]({ text: '강' }));
    expect(result.current[0].text).toBe('강');
    act(() => void vi.advanceTimersByTime(QUERY_PERSIST_DELAY_MS - 1));
    act(() => result.current[1]({ text: '강릉' }));
    expect(result.current[0].text).toBe('강릉');

    // 마지막 변경 뒤 300ms가 지나기 전에는 쓰지 않는다.
    act(() => void vi.advanceTimersByTime(QUERY_PERSIST_DELAY_MS - 1));
    await settle();
    expect(s.savedQuery()).toBeNull();

    act(() => void vi.advanceTimersByTime(1));
    await settle();
    expect(s.savedQuery().text).toBe('강릉');
  });

  it('writes a pending change when the screen goes away', async () => {
    const s = setup();
    const { result, unmount } = renderHook(() => useLibraryQuery(), { wrapper: s.wrapper });
    act(() => result.current[1]({ labelIds: [L_FOOD] }));
    unmount();
    await settle();
    expect(s.savedQuery().labelIds).toEqual([L_FOOD]);
  });

  it('keeps other preferences that changed while a save was pending', async () => {
    const s = setup();
    const { result } = renderHook(() => useLibraryQuery(), { wrapper: s.wrapper });
    act(() => result.current[1]({ text: '횟집' }));
    act(() => s.store.set(prefsAtom, { ...s.store.get(prefsAtom), libraryView: 'tiles' }));
    act(() => void vi.advanceTimersByTime(QUERY_PERSIST_DELAY_MS));
    await settle();
    const saved = JSON.parse(s.storage.getItem(PREFS_KEY)!);
    expect(saved.query.text).toBe('횟집');
    expect(saved.libraryView).toBe('tiles');
  });

  it('keeps the in-memory query across remounts before the save lands', async () => {
    const s = setup();
    const first = renderHook(() => useLibraryQuery(), { wrapper: s.wrapper });
    act(() => first.result.current[1]({ text: '속초' }));
    first.unmount();
    const second = renderHook(() => useLibraryQuery(), { wrapper: s.wrapper });
    expect(second.result.current[0].text).toBe('속초');
  });

  it('drops label ids that are not live from the returned query, not from storage', async () => {
    const s = setup();
    const { result } = renderHook(() => useLibraryQuery(), { wrapper: s.wrapper });
    act(() => result.current[1]({ labelIds: ['gone0000', L_FOOD], mode: 'all' }));
    expect(result.current[0].labelIds).toEqual([L_FOOD]);
    act(() => void vi.advanceTimersByTime(QUERY_PERSIST_DELAY_MS));
    await settle();
    expect(s.savedQuery().labelIds).toEqual(['gone0000', L_FOOD]);
  });
});
