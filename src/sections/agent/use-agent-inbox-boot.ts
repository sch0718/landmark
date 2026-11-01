import { useStore } from 'jotai';
import { useEffect } from 'react';
import { loadAgentInbox } from 'src/services/agent-inbox/boot';
import { readBootFlag } from 'src/services/library-sync/boot';
import { syncStatusAtom } from 'src/stores/sync-status';

export function useAgentInboxBoot(): void {
  const store = useStore();
  useEffect(() => {
    let active = true;
    let running = false;
    let started = false;
    const start = async () => {
      if (!active || running || started) return;
      running = true;
      try {
        const module = await loadAgentInbox();
        if (!active) return;
        await module.startInboxCheck();
        if (!active) return;
        started = true;
        off();
      } catch {
        // 실패하면 구독을 유지해 다음 동기화 완료 때 다시 시도해요.
      } finally {
        running = false;
      }
    };
    const off = store.sub(syncStatusAtom, () => {
      if (store.get(syncStatusAtom).phase === 'synced') {
        void start();
      }
    });
    if (readBootFlag()) void start();
    return () => {
      active = false;
      off();
    };
  }, [store]);
}
