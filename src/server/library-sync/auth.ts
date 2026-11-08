import {
  createSessionAuth,
  publicSessionId,
  parseRedirectUris,
  socialLoginOptions,
  type D1Database,
  type SessionAuth,
} from '@sch0718/firebase-session/worker';
import type { SyncContext, SyncDeps } from './env';
import { isLocalRequest, SyncHttpError } from './http';
import {
  createFakeSocial,
  FAKE_CLIENT_IDS,
  FAKE_CLIENT_SECRET,
} from '@sch0718/firebase-session/testing';
export const SYNC_SESSION_HEADER = 'X-Landmark-Session';
export type SyncUser = {
  userId: string;
  sessionHash: string;
  sessionId: string;
  provider: 'google' | 'kakao' | 'naver';
  account: string;
};
export function devFakeEnabled(ctx: SyncContext): boolean {
  return isLocalRequest(ctx.request) && ctx.env.SYNC_DEV_FAKE_SOCIAL === '1';
}
export function fakeSocial(now: () => number) {
  return createFakeSocial({
    basePath: '/api/sync/dev/fake-social',
    defaultSub: 'dev-me',
    approveResponse: 'refresh',
    now,
  });
}
export function redirectUrisFor(ctx: SyncContext): string[] {
  return parseRedirectUris(
    ctx.env.SYNC_REDIRECT_URIS ?? [new URL(ctx.request.url).origin + '/auth/callback'],
  );
}
/** 허용 목록 변수가 둘 다 없으면(정의되지 않음) 누구나 쓴다. 하나라도 있으면 목록 안만(빈 값은 모두 거절). */
export function allowListOpen(env: SyncContext['env']): boolean {
  return env.ALLOWED_EMAILS === undefined && env.ALLOWED_ACCOUNTS === undefined;
}
export function providerStatus(ctx: SyncContext) {
  const devFake = devFakeEnabled(ctx);
  return {
    google: !!ctx.env.FIREBASE_PROJECT_ID,
    kakao: devFake || !!ctx.env.KAKAO_CLIENT_ID,
    naver: devFake || !!(ctx.env.NAVER_CLIENT_ID && ctx.env.NAVER_CLIENT_SECRET),
    devFake,
  };
}
export function sessionAuthFor(ctx: SyncContext, deps: SyncDeps): SessionAuth {
  if (!ctx.env.DB) throw new SyncHttpError(503, 'config');
  const status = providerStatus(ctx);
  const fake = status.devFake ? fakeSocial(deps.now) : null;
  const redirectUris = redirectUrisFor(ctx);
  const env = ctx.env;
  const social = socialLoginOptions({
    allowedAccounts: env.ALLOWED_ACCOUNTS,
    kakao: {
      clientId: fake ? FAKE_CLIENT_IDS.kakao : env.KAKAO_CLIENT_ID,
      clientSecret: fake ? FAKE_CLIENT_SECRET : env.KAKAO_CLIENT_SECRET,
    },
    naver: {
      clientId: fake ? FAKE_CLIENT_IDS.naver : env.NAVER_CLIENT_ID,
      clientSecret: fake ? FAKE_CLIENT_SECRET : env.NAVER_CLIENT_SECRET,
    },
    redirectUris,
    keys: fake?.keys ?? deps.socialKeys,
    fetch: fake?.fetch ?? deps.fetch,
  });
  return createSessionAuth({
    db: env.DB as unknown as D1Database,
    projectId: env.FIREBASE_PROJECT_ID ?? '',
    allowedEmails: env.ALLOWED_EMAILS,
    certs: deps.certs,
    sessionHeader: SYNC_SESSION_HEADER,
    defaultLabel: '이름 없는 기기',
    now: deps.now,
    random: deps.random,
    uuid: deps.uuid,
    social,
    ...(allowListOpen(env) ? { isAllowed: () => true } : {}),
  });
}
export async function requireSyncUser(ctx: SyncContext, deps: SyncDeps): Promise<SyncUser> {
  const auth = await sessionAuthFor(ctx, deps).authenticate(ctx.request);
  const provider = auth.user.provider ?? 'google';
  return {
    userId: auth.userId,
    sessionHash: auth.sessionHash,
    sessionId: publicSessionId(auth.sessionHash),
    provider,
    account: provider === 'google' ? auth.user.email : auth.user.sub,
  };
}
