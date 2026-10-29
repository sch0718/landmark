import {
  createSessionAuth,
  publicSessionId,
  type D1Database,
  type SessionAuth,
  type SocialLoginOptions,
} from '@sch0718/firebase-session/worker';
import type { SyncContext, SyncDeps } from './env';
import { isLocalRequest, SyncHttpError } from './http';
import { createFakeSocial } from './dev-fake-social';
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
export function redirectUrisFor(ctx: SyncContext): string[] {
  if (ctx.env.SYNC_REDIRECT_URIS === undefined)
    return [new URL(ctx.request.url).origin + '/auth/callback'];
  return ctx.env.SYNC_REDIRECT_URIS.split(',')
    .map((s) => s.trim())
    .filter((s) => {
      try {
        const url = new URL(s);
        return (
          !s.includes('#') &&
          !url.username &&
          !url.password &&
          (url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        );
      } catch {
        return false;
      }
    });
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
  const fake = status.devFake ? createFakeSocial({ now: deps.now }) : null;
  const redirectUris = redirectUrisFor(ctx);
  const env = ctx.env;
  const social: SocialLoginOptions | undefined =
    status.kakao || status.naver
      ? {
          allowedAccounts: env.ALLOWED_ACCOUNTS ?? (fake ? 'kakao:dev-me,naver:dev-me' : undefined),
          keys: fake?.keys ?? deps.socialKeys,
          fetch: fake?.fetch ?? deps.fetch,
          ...(status.kakao
            ? {
                kakao: {
                  clientId: fake ? 'dev-fake-kakao' : env.KAKAO_CLIENT_ID!,
                  clientSecret: fake ? 'dev-fake-secret' : env.KAKAO_CLIENT_SECRET,
                  redirectUris,
                },
              }
            : {}),
          ...(status.naver
            ? {
                naver: {
                  clientId: fake ? 'dev-fake-naver' : env.NAVER_CLIENT_ID!,
                  clientSecret: fake ? 'dev-fake-secret' : env.NAVER_CLIENT_SECRET,
                  redirectUris,
                },
              }
            : {}),
        }
      : undefined;
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
