import { beforeEach, expect, it, vi } from 'vitest';
import {
  afterLogin,
  deviceLabel,
  fakeAuthorizeUrl,
  startSocialLogin,
  finishSocialLogin,
} from 'src/services/library-sync/login';
import {
  readSyncMeta,
  writeSyncMeta,
  readBase,
  writeBase,
  readSession,
} from 'src/services/library-sync/storage';
import type { SyncApi } from 'src/services/library-sync/api';
beforeEach(() => localStorage.clear());
const api = (userId = 'u') =>
  ({
    me: async () => ({ ok: true, data: { userId, account: 'kakao:dev-me' } }),
    client: {
      createSocialSession: async () => ({
        ok: true,
        data: { sessionId: 'a'.repeat(43), user: { provider: 'kakao' } },
      }),
    },
  }) as unknown as SyncApi;
it('기기 이름과 가짜 인가 주소를 만든다', () => {
  expect(deviceLabel('iPhone Safari')).toBe('iPhone · Safari');
  expect(deviceLabel('Android Chrome')).toBe('Android · Chrome');
  expect(deviceLabel('Macintosh Chrome KAKAOTALK')).toBe('Mac · 카카오톡');
  const url = new URL(
    fakeAuthorizeUrl('https://kauth.kakao.com/oauth/authorize?state=s', 'http://localhost:8795'),
  );
  expect(url.pathname).toBe('/api/sync/dev/fake-social/authorize');
  expect(url.searchParams.get('provider')).toBe('kakao');
});
it('소셜 콜백을 한 번만 읽고 세션을 저장해 첫 연결을 고르게 한다', async () => {
  const navigate = vi.fn();
  await startSocialLogin(
    'kakao',
    {
      apiBase: 'http://localhost/api/sync',
      firebase: null,
      kakao: { clientId: 'dev-fake-kakao' },
      naver: null,
      devFake: true,
    },
    { navigate, storage: localStorage, origin: 'http://localhost:8795' },
  );
  const url = new URL(navigate.mock.calls[0]![0]);
  expect(url.pathname).toContain('/dev/fake-social/authorize');
  const href = `http://localhost:8795/auth/callback?code=test-code&state=${url.searchParams.get('state')}`;
  expect(await finishSocialLogin(api(), href, localStorage, '시험')).toMatchObject({
    ok: true,
    next: 'choose',
  });
  expect(readSession(localStorage)?.provider).toBe('kakao');
  expect(await finishSocialLogin(api(), href, localStorage, '시험')).toEqual({
    ok: false,
    reason: 'no-pending',
  });
});
it('같은 계정은 이어 가고 다른 계정은 base를 지운다', async () => {
  writeSyncMeta(localStorage, { ...readSyncMeta(localStorage), userId: 'u' });
  writeBase(localStorage, 'u', { 'place:place00001': { rev: 1, hash: 'abc', deleted: false } });
  expect(await afterLogin(api(), localStorage, 'kakao')).toMatchObject({ next: 'resume' });
  expect(await afterLogin(api('other'), localStorage, 'kakao')).toMatchObject({ next: 'choose' });
  expect(readBase(localStorage).items).toEqual({});
});
it('시작한 로그인과 state가 다르면 거절한다', async () => {
  await startSocialLogin(
    'kakao',
    { apiBase: '', firebase: null, kakao: { clientId: 'public' }, naver: null, devFake: false },
    { navigate: () => {}, storage: localStorage, origin: 'http://localhost' },
  );
  expect(
    await finishSocialLogin(
      api(),
      'http://localhost/auth/callback?code=test&state=wrong',
      localStorage,
      '기기',
    ),
  ).toMatchObject({ reason: 'mismatch' });
});
it('허용 밖 소셜 계정은 계정 값을 안내하고 세션을 남기지 않는다', async () => {
  const navigate = vi.fn();
  await startSocialLogin(
    'kakao',
    { apiBase: '', firebase: null, kakao: { clientId: 'public' }, naver: null, devFake: false },
    { navigate, storage: localStorage, origin: 'http://localhost' },
  );
  const state = new URL(navigate.mock.calls[0]![0]).searchParams.get('state');
  const denied = api();
  denied.client.createSocialSession = async () => ({
    ok: false,
    kind: 'not-allowed',
    account: 'kakao:dev-stranger',
  });
  expect(
    await finishSocialLogin(
      denied,
      'http://localhost/auth/callback?code=test&state=' + state,
      localStorage,
      '기기',
    ),
  ).toEqual({ ok: false, reason: 'not-allowed', account: 'kakao:dev-stranger' });
  expect(readSession(localStorage)).toBeNull();
});
