import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  getSharedSyncApi,
  getSharedSyncStorage,
  resetSharedSyncApiForTest,
} from 'src/services/library-sync/shared-api';

beforeEach(() => {
  vi.stubEnv('VITE_KAKAO_LOGIN_CLIENT_ID', '');
  vi.stubEnv('VITE_NAVER_LOGIN_CLIENT_ID', '');
  vi.stubEnv('VITE_SYNC_DEV_FAKE', '');
  vi.stubEnv('VITE_FIREBASE_API_KEY', '');
  resetSharedSyncApiForTest();
});
afterEach(() => vi.unstubAllEnvs());
it('공급자 설정이 없으면 API가 없다', () => {
  expect(getSharedSyncApi()).toBeNull();
});
it('공급자 설정이 있으면 API와 저장소를 한 번만 만든다', () => {
  vi.stubEnv('VITE_KAKAO_LOGIN_CLIENT_ID', 'public');
  const api = getSharedSyncApi();
  expect(api).not.toBeNull();
  expect(getSharedSyncApi()).toBe(api);
  expect(getSharedSyncStorage()).toBe(getSharedSyncStorage());
  resetSharedSyncApiForTest();
  expect(getSharedSyncApi()).not.toBe(api);
});
