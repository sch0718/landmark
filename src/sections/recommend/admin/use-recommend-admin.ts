import { useCallback, useEffect, useRef, useState } from 'react';
import { getSharedSyncApi, getSharedSyncStorage } from 'src/services/library-sync/shared-api';
import { readSession } from 'src/services/library-sync/storage';
import { createRecommendAdminApi, type RecommendationMeta } from 'src/services/recommend/api';

export function useRecommendAdmin(): {
  admin: boolean;
  items: RecommendationMeta[];
  reload(): Promise<void>;
} {
  const [state, setState] = useState<{ admin: boolean; items: RecommendationMeta[] }>({
    admin: false,
    items: [],
  });
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const run = ++generation.current;
    const storage = getSharedSyncStorage();
    const session = readSession(storage);
    const api = session ? getSharedSyncApi() : null;
    if (!session || !api) {
      setState({ admin: false, items: [] });
      return;
    }
    try {
      const result = await createRecommendAdminApi(api).list();
      if (run !== generation.current || readSession(storage)?.sessionId !== session.sessionId)
        return;
      setState(result.ok ? { admin: true, items: result.data.items } : { admin: false, items: [] });
    } catch {
      if (run === generation.current) setState({ admin: false, items: [] });
    }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
      generation.current += 1;
    };
  }, [reload]);
  return { ...state, reload };
}
