import { browserStorage } from 'src/services/browser-storage';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { createSyncApi, googleAuth, type SyncApi } from './api';
import { readSyncClientConfig } from './config';

let cached: SyncApi | null | undefined;
let storage: Storage | undefined;

/** 엔진과 서버 백업이 저장소 차단 환경에서도 같은 저장소를 쓴다. */
export function getSharedSyncStorage(): Storage {
  return (storage ??= browserStorage() ?? createMemoryStorage());
}

/** 엔진과 서버 백업의 API와 인증 인스턴스를 한 번만 만든다. */
export function getSharedSyncApi(): SyncApi | null {
  if (cached !== undefined) return cached;
  const config = readSyncClientConfig(import.meta.env, location.origin);
  cached =
    config === null
      ? null
      : createSyncApi({
          config,
          storage: getSharedSyncStorage(),
          auth: googleAuth(config),
        });
  return cached;
}

export function resetSharedSyncApiForTest(): void {
  cached = undefined;
  storage = undefined;
}
