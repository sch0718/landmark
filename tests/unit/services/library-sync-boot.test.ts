import { beforeEach, expect, it } from 'vitest';
import { readBootFlag, syncFeatureVisible } from 'src/services/library-sync/boot';
import {
  captureAuthCallback,
  takeCapturedCallback,
} from 'src/services/library-sync/callback-capture';
beforeEach(() => {
  localStorage.clear();
  takeCapturedCallback();
});
it('켜짐과 연결 선택 완료 때만 엔진을 받는다', () => {
  for (const v of [null, '{', '{}', '{"enabled":false}', '{"enabled":true,"pendingChoice":true}']) {
    if (v !== null) localStorage.setItem('tripmap:sync:v1', v);
    expect(readBootFlag()).toBe(false);
  }
  localStorage.setItem('tripmap:sync:v1', '{"enabled":true,"pendingChoice":false}');
  expect(readBootFlag()).toBe(true);
  expect(
    readBootFlag({
      getItem: () => {
        throw Error('차단');
      },
    } as unknown as Storage),
  ).toBe(false);
});
it('공급자 빌드 설정이 있을 때만 설정 절을 보인다', () => {
  expect(syncFeatureVisible({})).toBe(false);
  expect(syncFeatureVisible({ VITE_KAKAO_LOGIN_CLIENT_ID: 'public' })).toBe(true);
  expect(syncFeatureVisible({ DEV: false, VITE_SYNC_DEV_FAKE: '1' })).toBe(false);
  expect(syncFeatureVisible({ DEV: true, VITE_SYNC_DEV_FAKE: '1' })).toBe(true);
});
it('콜백 코드를 주소에서 지우고 메모리에서 한 번만 읽는다', () => {
  const replaceState = {
    replaceState: (...args: unknown[]) => {
      expect(args[2]).toBe('/auth/callback');
    },
    state: null,
  };
  captureAuthCallback(
    {
      pathname: '/auth/callback',
      href: 'http://localhost/auth/callback?code=test&state=s',
      search: '?code=test&state=s',
    } as Location,
    replaceState as unknown as History,
  );
  expect(takeCapturedCallback()).toContain('?code=test');
  expect(takeCapturedCallback()).toBeNull();
  captureAuthCallback(
    { pathname: '/', search: '?code=test' } as Location,
    replaceState as unknown as History,
  );
  expect(takeCapturedCallback()).toBeNull();
});
