import { lazyChunk } from 'src/lib/lazy-chunk';
export function readBootFlag(storage?: Storage): boolean {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem('tripmap:sync:v1') ?? 'null') as {
      enabled?: unknown;
      pendingChoice?: unknown;
    } | null;
    return value?.enabled === true && value.pendingChoice !== true;
  } catch {
    return false;
  }
}
export function syncFeatureVisible(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): boolean {
  const present = (key: string) => typeof env[key] === 'string' && !!env[key].trim();
  return (
    [
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_APP_ID',
    ].every(present) ||
    present('VITE_KAKAO_LOGIN_CLIENT_ID') ||
    present('VITE_NAVER_LOGIN_CLIENT_ID') ||
    ((env.DEV ?? import.meta.env.DEV) === true && env.VITE_SYNC_DEV_FAKE === '1')
  );
}
export const loadSyncEngine = lazyChunk(() => import('src/services/library-sync/sync-engine'));
export const loadSyncSection = lazyChunk(() => import('src/sections/library-sync/SyncSection'));
