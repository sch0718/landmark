import { useStore } from 'jotai';
import { useEffect } from 'react';
import { loadAgentInbox } from 'src/services/agent-inbox/boot';
import { readBootFlag } from 'src/services/library-sync/boot';
import { syncStatusAtom } from 'src/stores/sync-status';

export function useAgentInboxBoot(): void {
  const store = useStore();
  useEffect(() => {
    const start = () => {
      void loadAgentInbox()
        .then((m) => m.startInboxCheck())
        .catch(() => {});
    };
    if (readBootFlag()) {
      start();
      return;
    }
    const off = store.sub(syncStatusAtom, () => {
      if (store.get(syncStatusAtom).phase === 'synced') {
        off();
        start();
      }
    });
    return off;
  }, [store]);
}
