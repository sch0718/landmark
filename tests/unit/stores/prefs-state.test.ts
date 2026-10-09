import { createStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from 'src/schema/prefs';
import { PREFS_KEY } from 'src/services/prefs-store';
import { prefsAtom } from 'src/stores/prefs-state';

afterEach(() => {
  localStorage.clear();
});

describe('prefsAtom', () => {
  it('reads the saved prefs synchronously with the default app runtime', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...DEFAULT_PREFS, theme: 'night' }));
    expect(createStore().get(prefsAtom).theme).toBe('night');
  });

  it('falls back to defaults when nothing is saved', () => {
    expect(createStore().get(prefsAtom)).toEqual(DEFAULT_PREFS);
  });
});
