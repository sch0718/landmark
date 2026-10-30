import {
  createSessionClient,
  firebaseAuth,
  type ApiResult,
  type BaseFail,
  type SessionClient,
  type AuthClient,
} from '@sch0718/firebase-session/client';
import type { RemoteItem } from 'src/domain/library-sync/apply';
import type { ItemKind } from 'src/domain/library-sync/items';
import type { SyncClientConfig } from './config';
import { readSession, type SyncCursor, type SyncProvider } from './storage';
export type SyncFail =
  | BaseFail
  | { ok: false; kind: 'resync'; purgedRev: number }
  | { ok: false; kind: 'busy' }
  | { ok: false; kind: 'off' };
export type { ApiResult };
type ExtraFail = Extract<SyncFail, { kind: 'resync' | 'busy' | 'off' }>;
export type StatusReply = {
  enabled: boolean;
  reason?: 'off' | 'config';
  providers: { google: boolean; kakao: boolean; naver: boolean };
  devFake: boolean;
};
export type MeReply = {
  userId: string;
  provider: SyncProvider;
  account: string;
  library: { rev: number; items: number; live: number };
  devices: { deviceId: string; sessionId: string; lastSyncAt: number }[];
};
export type PullReply = {
  rev: number;
  purgedRev: number;
  more: boolean;
  next: SyncCursor;
  items: RemoteItem[];
};
export type PushRequest = {
  v: 1;
  deviceId: string;
  items: {
    kind: ItemKind;
    id: string;
    baseRev: number;
    baseDeleted: boolean | null;
    doc: unknown;
  }[];
};
export type PushReply = {
  rev: number;
  results: { kind: ItemKind; id: string; rev: number; doc?: unknown }[];
  rejected: { kind: ItemKind; id: string; reason: 'invalid' | 'too-large' | 'clock' }[];
};
export type SyncApi = {
  client: SessionClient<ExtraFail>;
  status(): Promise<ApiResult<StatusReply, SyncFail>>;
  me(): Promise<ApiResult<MeReply, SyncFail>>;
  changes(q: {
    since: number;
    after: string;
    limit: number;
    deviceId: string;
  }): Promise<ApiResult<PullReply, SyncFail>>;
  push(body: PushRequest): Promise<ApiResult<PushReply, SyncFail>>;
  deleteAccount(): Promise<ApiResult<unknown, SyncFail>>;
};
export function createSyncApi(opts: {
  config: SyncClientConfig;
  storage: Storage;
  auth: AuthClient | null;
  fetch?: typeof fetch;
}): SyncApi {
  const { config, storage, auth } = opts;
  const client = createSessionClient<ExtraFail>({
    baseUrl: config.apiBase,
    sessionHeader: 'X-Landmark-Session',
    allowSessionOnly: true,
    credentials: {
      idToken: (force) =>
        readSession(storage)?.provider === 'google' && auth
          ? auth.idToken(force)
          : Promise.resolve(null),
      sessionId: async () => readSession(storage)?.sessionId ?? null,
    },
    fetch: opts.fetch,
    mapStatus: (status, body) => {
      if (status === 410 && body.error === 'resync')
        return { ok: false, kind: 'resync', purgedRev: Number(body.purgedRev) || 0 };
      if (status === 409 && body.error === 'busy') return { ok: false, kind: 'busy' };
      if (status === 503 && body.error === 'off') return { ok: false, kind: 'off' };
      return undefined;
    },
  });
  return {
    client,
    status: () => client.send('GET', '/v1/status', { auth: 'none' }),
    me: () => client.send('GET', '/v1/me'),
    changes: (q) =>
      client.send(
        'GET',
        '/v1/library/changes?' +
          new URLSearchParams({
            since: String(q.since),
            after: q.after,
            limit: String(q.limit),
            device: q.deviceId,
          }),
      ),
    push: (body) => client.send('POST', '/v1/library/push', { body }),
    deleteAccount: () => client.send('DELETE', '/v1/account', { body: { confirm: 'delete' } }),
  };
}
export function googleAuth(config: SyncClientConfig): AuthClient | null {
  return config.firebase ? firebaseAuth(config.firebase) : null;
}
