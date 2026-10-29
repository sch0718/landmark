import { useStore } from 'jotai';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { browserStorage } from 'src/services/browser-storage';
import { loadFolderWatch } from 'src/services/folder-watch/boot';
import {
  dueFolders,
  readFolderWatch,
  FOLDER_WATCH_DELAY_MS,
  FOLDER_WATCH_MAX_PER_RUN,
} from 'src/services/folder-watch/state';
import { libraryAtom } from 'src/stores/library-state';
export function useFolderWatchBoot(): void {
  const store = useStore();
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    let running = false;
    const tryRun = () => {
      const state = readFolderWatch(browserStorage());
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection;
      if (
        !active ||
        running ||
        !state.enabled ||
        !navigator.onLine ||
        connection?.saveData === true ||
        dueFolders(store.get(libraryAtom), state, Date.now(), { max: FOLDER_WATCH_MAX_PER_RUN })
          .length === 0
      )
        return;
      running = true;
      void loadFolderWatch()
        .then((m) =>
          active
            ? m.startFolderWatch({
                navigate: (p) => {
                  void navigate(p);
                },
              })
            : undefined,
        )
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    };
    const timer = setTimeout(tryRun, FOLDER_WATCH_DELAY_MS);
    const visible = () => {
      if (document.visibilityState === 'visible') tryRun();
    };
    document.addEventListener('visibilitychange', visible);
    if (import.meta.env.DEV)
      void loadFolderWatch()
        .then((m) => {
          if (active) m.installFolderWatchDevTools();
        })
        .catch(() => {});
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [store, navigate]);
}
