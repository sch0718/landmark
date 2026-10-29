import { readSyncConfig, type FirebaseConfig } from '@sch0718/firebase-session/client';
export type SyncClientConfig = {
  apiBase: string;
  firebase: FirebaseConfig | null;
  kakao: { clientId: string } | null;
  naver: { clientId: string } | null;
  devFake: boolean;
};
export function readSyncClientConfig(
  env: Record<string, string | boolean | undefined>,
  origin: string,
): SyncClientConfig | null {
  const apiBase = origin + '/api/sync';
  const firebase = readSyncConfig({ ...env, VITE_SYNC_API_URL: apiBase })?.firebase ?? null;
  const devFake = import.meta.env.DEV && env.VITE_SYNC_DEV_FAKE === '1';
  const client = (key: string) =>
    typeof env[key] === 'string' && env[key].trim() ? { clientId: env[key].trim() } : null;
  const kakao =
    import.meta.env.DEV && devFake
      ? { clientId: 'dev-fake-kakao' }
      : client('VITE_KAKAO_LOGIN_CLIENT_ID');
  const naver =
    import.meta.env.DEV && devFake
      ? { clientId: 'dev-fake-naver' }
      : client('VITE_NAVER_LOGIN_CLIENT_ID');
  return firebase || kakao || naver ? { apiBase, firebase, kakao, naver, devFake } : null;
}
