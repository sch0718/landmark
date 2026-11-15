import { atom, useStore, type PrimitiveAtom } from 'jotai';
import { atomWithLazy } from 'jotai/utils';
import { useEffect } from 'react';
import { fetchRecommendations, type Recommendation } from 'src/services/recommend/api';
import {
  readRecommendPrefs,
  writeRecommendPrefs,
  type RecommendPrefs,
} from 'src/services/recommend/prefs';
export const recommendationsAtom: PrimitiveAtom<Recommendation[]> = atom<Recommendation[]>([]);
const prefsAtom = atomWithLazy<RecommendPrefs>(() => readRecommendPrefs());
export const recommendPrefsAtom = atom(
  (get) => get(prefsAtom),
  (_get, set, prefs: RecommendPrefs) => {
    set(prefsAtom, prefs);
    writeRecommendPrefs(prefs);
  },
);
export const visibleRecommendationsAtom = atom((get) => {
  const hidden = new Set(get(recommendPrefsAtom).hidden);
  return get(recommendationsAtom).filter((rec) => !hidden.has(rec.id));
});
export const hideRecommendationAtom = atom(null, (get, set, id: string) => {
  const prefs = get(recommendPrefsAtom);
  if (!prefs.hidden.includes(id))
    set(recommendPrefsAtom, { ...prefs, hidden: [...prefs.hidden, id] });
});
export const toggleRecommendMapAtom = atom(null, (get, set) => {
  const prefs = get(recommendPrefsAtom);
  set(recommendPrefsAtom, { ...prefs, mapOff: !prefs.mapOff });
});
type Store = ReturnType<typeof useStore>;
const receivedAt = new WeakMap<Store, number>();
export async function refreshRecommendations(store: Store): Promise<void> {
  const result = await fetchRecommendations();
  if (result.ok) {
    store.set(recommendationsAtom, result.items);
    receivedAt.set(store, Date.now());
  }
}
export function useRecommendationsBoot(): void {
  const store = useStore();
  useEffect(() => {
    let active = true;
    let running = false;
    const run = async (initial = false) => {
      if (!active || running || (!initial && Date.now() - (receivedAt.get(store) ?? 0) < 300_000))
        return;
      running = true;
      try {
        await refreshRecommendations(store);
      } finally {
        running = false;
      }
    };
    void run(true);
    const visible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const online = () => {
      void run();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', online);
    };
  }, [store]);
}
