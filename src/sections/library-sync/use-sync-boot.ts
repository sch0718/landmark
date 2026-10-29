import { useStore } from 'jotai';
import { useEffect } from 'react';
import { loadSyncEngine, readBootFlag } from 'src/services/library-sync/boot';
import type { LibrarySyncEngine } from 'src/services/library-sync/sync-engine';
import { libraryAtom } from 'src/stores/library-state';
export function useSyncBoot(): void {
  const store = useStore();
  useEffect(() => {
    let live = true;
    let engine: LibrarySyncEngine | undefined;
    let loading: Promise<LibrarySyncEngine> | undefined;
    const getEngine = () =>
      (loading ??= loadSyncEngine().then((m) => {
        engine = m.ensureLibrarySyncEngine();
        return engine;
      }));
    if (readBootFlag())
      void getEngine()
        .then((e) => {
          if (live) e.start();
        })
        .catch(() => {});
    const unsubscribe = store.sub(libraryAtom, () => {
      if (!readBootFlag()) return;
      const lib = store.get(libraryAtom);
      if (engine) {
        if (!engine.isOwnWrite(lib)) engine.schedule('save');
      } else
        void getEngine()
          .then((e) => {
            if (live && !e.isOwnWrite(lib)) e.schedule('save');
          })
          .catch(() => {});
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [store]);
}
