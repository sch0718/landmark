import {
  beginSocialSignIn,
  readSocialCallback,
  SOCIAL_AUTHORIZE_URLS,
  type AuthClient,
  type SignInResult,
  type SocialProvider,
} from '@sch0718/firebase-session/client';
import type { SyncApi, SyncFail } from './api';
import type { SyncClientConfig } from './config';
import {
  readSyncMeta,
  readBase,
  writeSyncMeta,
  writeSession,
  clearSyncRecords,
  clearSession,
  SyncStorageError,
  type SyncProvider,
} from './storage';
export const AUTH_CALLBACK_PATH = '/auth/callback';
export type LoginOutcome =
  | { ok: true; provider: SyncProvider; next: 'resume' | 'choose' }
  | { ok: false; reason: 'not-allowed'; account?: string; email?: string }
  | {
      ok: false;
      reason:
        | 'cancelled'
        | 'mismatch'
        | 'expired'
        | 'provider-error'
        | 'no-pending'
        | 'limit'
        | 'offline'
        | 'auth'
        | 'server'
        | 'off'
        | 'storage';
    };
export function deviceLabel(ua: string): string {
  const device = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Mac/i.test(ua)
          ? 'Mac'
          : /Windows/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : '기기';
  const browser = /KAKAOTALK/i.test(ua)
    ? '카카오톡'
    : /NAVER\(inapp/i.test(ua)
      ? '네이버'
      : /Edg/i.test(ua)
        ? 'Edge'
        : /Chrome|CriOS/i.test(ua)
          ? 'Chrome'
          : /Firefox|FxiOS/i.test(ua)
            ? 'Firefox'
            : /Safari/i.test(ua)
              ? 'Safari'
              : '브라우저';
  return `${device} · ${browser}`.slice(0, 40);
}
export function fakeAuthorizeUrl(realUrl: string, origin: string): string {
  const real = new URL(realUrl);
  const provider = (Object.keys(SOCIAL_AUTHORIZE_URLS) as SocialProvider[]).find(
    (p) => new URL(SOCIAL_AUTHORIZE_URLS[p]).origin === real.origin,
  );
  if (!provider) throw new Error('알 수 없는 로그인 공급자예요');
  const url = new URL(origin + '/api/sync/dev/fake-social/authorize');
  url.search = real.search;
  url.searchParams.set('provider', provider);
  return url.href;
}
export async function startSocialLogin(
  provider: SocialProvider,
  config: SyncClientConfig,
  opts: { navigate?: (url: string) => void; storage?: Storage; origin?: string } = {},
): Promise<void> {
  const storage = opts.storage ?? localStorage;
  const origin = opts.origin ?? location.origin;
  const nav = opts.navigate ?? ((url) => location.assign(url));
  const clientId = config[provider]?.clientId;
  if (!clientId) throw new Error('로그인 설정이 없어요');
  try {
    storage.setItem('tripmap:sync-return', '/settings#sync');
  } catch {
    throw new SyncStorageError();
  }
  await beginSocialSignIn(provider, {
    clientId,
    redirectUri: origin + AUTH_CALLBACK_PATH,
    navigate: config.devFake ? (url) => nav(fakeAuthorizeUrl(url, origin)) : nav,
    storage,
  });
}
function failure(result: SyncFail): LoginOutcome {
  if (result.kind === 'not-allowed')
    return { ok: false, reason: 'not-allowed', account: result.account };
  if (result.kind === 'off' || (result.kind === 'limit' && result.code === 'off'))
    return { ok: false, reason: 'off' };
  const reason =
    result.kind === 'limit' || result.kind === 'offline' || result.kind === 'auth'
      ? result.kind
      : 'server';
  return { ok: false, reason };
}
export async function afterLogin(
  api: SyncApi,
  storage: Storage,
  provider: SyncProvider,
): Promise<LoginOutcome> {
  const reply = await api.me();
  if (!reply.ok) {
    clearSession(storage);
    return failure(reply);
  }
  const meta = readSyncMeta(storage);
  const base = readBase(storage);
  const me = reply.data;
  const resume =
    meta.userId === me.userId && base.userId === me.userId && Object.keys(base.items).length > 0;
  if (!resume) clearSyncRecords(storage);
  writeSyncMeta(storage, {
    ...readSyncMeta(storage),
    enabled: true,
    pendingChoice: !resume,
    userId: me.userId,
    provider,
    accountLabel:
      provider === 'google' ? me.account : provider === 'kakao' ? '카카오 계정' : '네이버 계정',
  });
  return { ok: true, provider, next: resume ? 'resume' : 'choose' };
}
export async function finishSocialLogin(
  api: SyncApi,
  href: string,
  storage: Storage,
  label: string,
): Promise<LoginOutcome> {
  try {
    const cb = readSocialCallback(href, { storage });
    if (!cb) return { ok: false, reason: 'no-pending' };
    if (!cb.ok)
      return {
        ok: false,
        reason:
          cb.reason === 'redirect-mismatch' || cb.reason === 'state-mismatch'
            ? 'mismatch'
            : cb.reason,
      };
    const result = await api.client.createSocialSession(cb, label);
    if (!result.ok) return failure(result);
    writeSession(storage, { v: 1, sessionId: result.data.sessionId, provider: cb.provider });
    return await afterLogin(api, storage, cb.provider);
  } catch (error) {
    return { ok: false, reason: error instanceof SyncStorageError ? 'storage' : 'server' };
  }
}
async function finishGoogle(
  api: SyncApi,
  auth: AuthClient,
  storage: Storage,
  label: string,
  signed: SignInResult | 'redirect' | null,
): Promise<LoginOutcome> {
  if (signed === 'redirect') return new Promise(() => {});
  if (!signed) return { ok: false, reason: 'cancelled' };
  const result = await api.client.createSession(signed.idToken, label);
  if (!result.ok) {
    if (result.kind === 'not-allowed') {
      await auth.signOut();
      return { ok: false, reason: 'not-allowed', email: signed.user.email ?? undefined };
    }
    return failure(result);
  }
  writeSession(storage, { v: 1, sessionId: result.data.sessionId, provider: 'google' });
  return afterLogin(api, storage, 'google');
}
export async function googleLogin(
  api: SyncApi,
  auth: AuthClient,
  storage: Storage,
  label: string,
): Promise<LoginOutcome> {
  try {
    return await finishGoogle(api, auth, storage, label, await auth.signIn());
  } catch (error) {
    return { ok: false, reason: error instanceof SyncStorageError ? 'storage' : 'server' };
  }
}
export async function googleRedirectResult(
  api: SyncApi,
  auth: AuthClient,
  storage: Storage,
  label: string,
): Promise<LoginOutcome> {
  try {
    return await finishGoogle(api, auth, storage, label, await auth.redirectResult());
  } catch (error) {
    return { ok: false, reason: error instanceof SyncStorageError ? 'storage' : 'server' };
  }
}
