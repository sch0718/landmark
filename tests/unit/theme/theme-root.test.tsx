import { act, cleanup, render, screen } from '@testing-library/react';
import { Layer, ManagedRuntime } from 'effect';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { DEFAULT_PREFS, type Prefs } from 'src/schema/prefs';
import { IdGen } from 'src/services/id-gen';
import { LegacyTripSource } from 'src/services/legacy-trip-source';
import { LibraryStore } from 'src/services/library-store';
import { PlaceLookup } from 'src/services/place-lookup';
import { PREFS_KEY, PrefsStore } from 'src/services/prefs-store';
import { ReverseGeocoder } from 'src/services/reverse-geocoder';
import { ShareTemplate } from 'src/services/share-template';
import { prefsAtom, setPrefsAtom } from 'src/stores/prefs-state';
import { cssVarsOf } from 'src/theme/create-app-theme';
import { ThemeRoot } from 'src/theme/ThemeRoot';
import { TOKENS } from 'src/theme/tokens';

const fonts = vi.hoisted(() => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
vi.mock('src/theme/fonts', () => fonts);

/** `matchMedia('(prefers-color-scheme: dark)')`를 흉내 내고, 값을 바꿔 `change`를 보낸다. */
function mockSystemDark(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function setup(saved?: Partial<Prefs>) {
  const storage = createMemoryStorage();
  if (saved) storage.setItem(PREFS_KEY, JSON.stringify({ ...DEFAULT_PREFS, ...saved }));
  setAppRuntimeForTest(
    ManagedRuntime.make(
      Layer.mergeAll(
        LibraryStore.layerWith({ storage, events: new EventTarget() }),
        PrefsStore.layerWith({ storage }),
        IdGen.layerSequence([]),
        LegacyTripSource.layerWith({ storage, fetch: (...args) => globalThis.fetch(...args) }),
        ShareTemplate.layer,
        PlaceLookup.layer,
        ReverseGeocoder.layer,
      ),
    ),
  );
  const store = createStore();
  const renderRoot = async () => {
    await act(async () => {
      render(
        <Provider store={store}>
          <ThemeRoot>
            <p>본문</p>
          </ThemeRoot>
        </Provider>,
      );
    });
  };
  return { storage, store, renderRoot };
}

const html = document.documentElement;

beforeEach(() => {
  fonts.loadDisplayFont.mockClear();
});

afterEach(() => {
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

describe('ThemeRoot', () => {
  it('applies data-theme and css vars from prefs', async () => {
    mockSystemDark(false);
    const { renderRoot } = setup({ theme: 'night', mode: 'dark' });
    await renderRoot();

    expect(screen.getByText('본문')).toBeInTheDocument();
    expect(html.dataset.theme).toBe('night');
    expect(html.dataset.mode).toBe('dark');
    const tokens = TOKENS.night.dark;
    expect(html.style.getPropertyValue('--tm-bg-base')).toBe(tokens.bg.base);
    expect(html.style.getPropertyValue('--tm-accent-main')).toBe(tokens.accent.main);
    expect(html.style.getPropertyValue('--tm-label-red-marker')).toBe(tokens.label.red.marker);
    expect(html.style.getPropertyValue('--tm-radius-lg')).toBe(`${tokens.radius.lg}px`);
    for (const [key, value] of Object.entries(cssVarsOf(tokens))) {
      expect(html.style.getPropertyValue(key), key).toBe(value);
    }
  });

  it('re-themes without reload when prefs change and saves them', async () => {
    mockSystemDark(false);
    const { renderRoot, store, storage } = setup();
    await renderRoot();
    expect(html.dataset.theme).toBe('pastel');
    expect(html.dataset.mode).toBe('light');

    await act(async () => {
      store.set(setPrefsAtom, { ...store.get(prefsAtom), theme: 'paper', mode: 'dark' });
    });
    expect(html.dataset.theme).toBe('paper');
    expect(html.dataset.mode).toBe('dark');
    expect(html.style.getPropertyValue('--tm-accent-main')).toBe(TOKENS.paper.dark.accent.main);
    expect(JSON.parse(storage.getItem(PREFS_KEY) ?? 'null')).toMatchObject({
      theme: 'paper',
      mode: 'dark',
    });
  });

  it('keeps a choice made before the first render', async () => {
    mockSystemDark(false);
    const { renderRoot, store } = setup({ theme: 'night', mode: 'dark' });
    store.set(setPrefsAtom, { ...DEFAULT_PREFS, theme: 'paper', mode: 'light' });
    await renderRoot();
    expect(html.dataset.theme).toBe('paper');
    expect(html.dataset.mode).toBe('light');
  });

  it('paints saved prefs on the first render without flashing the defaults', async () => {
    mockSystemDark(false);
    const { renderRoot } = setup({ theme: 'night', mode: 'dark' });
    const seen: (string | null)[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) seen.push(record.oldValue);
    });
    observer.observe(html, {
      attributes: true,
      attributeFilter: ['data-theme'],
      attributeOldValue: true,
    });
    await renderRoot();
    observer.disconnect();
    // 속성이 처음 생긴 뒤 다른 값으로 바뀐 적이 없다(oldValue가 null뿐).
    expect(seen).toEqual([null]);
    expect(html.dataset.theme).toBe('night');
  });

  it('keeps other saved fields when prefs change right after mount', async () => {
    mockSystemDark(false);
    const saved = {
      theme: 'night',
      mode: 'dark',
      libraryView: 'list',
      query: { ...DEFAULT_PREFS.query, text: '물회', sort: 'name' },
    } satisfies Partial<Prefs>;
    const { renderRoot, store, storage } = setup(saved);
    await renderRoot();
    await act(async () => {
      store.set(setPrefsAtom, { ...store.get(prefsAtom), theme: 'paper' });
    });
    expect(JSON.parse(storage.getItem(PREFS_KEY) ?? 'null')).toEqual({ ...saved, theme: 'paper' });
  });

  it('keeps other saved fields when prefs change before mount', async () => {
    mockSystemDark(false);
    const { renderRoot, store, storage } = setup({ libraryView: 'cards', mode: 'dark' });
    store.set(setPrefsAtom, { ...store.get(prefsAtom), theme: 'paper' });
    await renderRoot();
    expect(JSON.parse(storage.getItem(PREFS_KEY) ?? 'null')).toMatchObject({
      theme: 'paper',
      mode: 'dark',
      libraryView: 'cards',
    });
  });

  it('system mode follows prefers-color-scheme change', async () => {
    const system = mockSystemDark(false);
    const { renderRoot } = setup({ theme: 'pastel', mode: 'system' });
    await renderRoot();
    expect(html.dataset.mode).toBe('light');
    expect(html.style.getPropertyValue('--tm-bg-base')).toBe(TOKENS.pastel.light.bg.base);

    act(() => system.set(true));
    expect(html.dataset.mode).toBe('dark');
    expect(html.style.getPropertyValue('--tm-bg-base')).toBe(TOKENS.pastel.dark.bg.base);

    act(() => system.set(false));
    expect(html.dataset.mode).toBe('light');
  });

  it('explicit mode ignores the system setting', async () => {
    const system = mockSystemDark(true);
    const { renderRoot } = setup({ mode: 'light' });
    await renderRoot();
    expect(html.dataset.mode).toBe('light');
    act(() => system.set(false));
    expect(html.dataset.mode).toBe('light');
  });

  it('loads display font only for paper', async () => {
    mockSystemDark(false);
    const { renderRoot, store } = setup({ theme: 'pastel' });
    await renderRoot();
    expect(fonts.loadDisplayFont).not.toHaveBeenCalled();

    await act(async () => {
      store.set(setPrefsAtom, { ...store.get(prefsAtom), theme: 'night' });
    });
    expect(fonts.loadDisplayFont).not.toHaveBeenCalled();

    await act(async () => {
      store.set(setPrefsAtom, { ...store.get(prefsAtom), theme: 'paper' });
    });
    expect(fonts.loadDisplayFont).toHaveBeenCalledTimes(1);
  });

  it('removes theme attributes and the media listener on unmount', async () => {
    const system = mockSystemDark(false);
    const { renderRoot } = setup();
    await renderRoot();
    expect(system.listenerCount()).toBe(1);
    expect(html.style.getPropertyValue('--tm-bg-base')).not.toBe('');

    cleanup();
    expect(system.listenerCount()).toBe(0);
    expect(html.dataset.theme).toBeUndefined();
    expect(html.style.getPropertyValue('--tm-bg-base')).toBe('');
  });
});
