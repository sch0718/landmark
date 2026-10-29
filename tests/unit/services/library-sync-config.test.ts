import { afterEach, expect, it, vi } from 'vitest';
import { readSyncClientConfig } from 'src/services/library-sync/config';
afterEach(() => vi.unstubAllEnvs());
it('공급자 변수가 없으면 숨기고 카카오만 설정할 수 있다', () => {
  expect(readSyncClientConfig({}, 'http://localhost')).toBeNull();
  expect(
    readSyncClientConfig({ VITE_KAKAO_LOGIN_CLIENT_ID: ' public ' }, 'http://localhost'),
  ).toMatchObject({
    apiBase: 'http://localhost/api/sync',
    kakao: { clientId: 'public' },
    firebase: null,
    naver: null,
  });
});
it('가짜 공급자는 개발 분기에서만 켠다', () => {
  vi.stubEnv('DEV', true);
  expect(readSyncClientConfig({ VITE_SYNC_DEV_FAKE: '1' }, 'http://localhost')?.devFake).toBe(true);
  vi.stubEnv('DEV', false);
  expect(readSyncClientConfig({ VITE_SYNC_DEV_FAKE: '1' }, 'https://example.com')).toBeNull();
});
