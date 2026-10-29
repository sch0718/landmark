import {
  googleCerts,
  socialKeys,
  type CertSource,
  type SocialProvider,
} from '@sch0718/firebase-session/worker';
import type { MeetDb } from '../meet/db';
import { globalFetch } from '../handler';
export type SyncEnv = {
  DB?: MeetDb;
  IP_HASH_SALT?: string;
  LIBRARY_SYNC?: string;
  FIREBASE_PROJECT_ID?: string;
  ALLOWED_EMAILS?: string;
  ALLOWED_ACCOUNTS?: string;
  KAKAO_CLIENT_ID?: string;
  KAKAO_CLIENT_SECRET?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  SYNC_REDIRECT_URIS?: string;
  SYNC_DEV_FAKE_SOCIAL?: string;
};
export type SyncContext = {
  request: Request;
  env: SyncEnv;
  waitUntil(p: Promise<unknown>): void;
  params: Record<string, string | string[]>;
};
export type SyncDeps = {
  now(): number;
  fetch: typeof fetch;
  random(n: number): Uint8Array;
  uuid(): string;
  certs: CertSource;
  socialKeys: Record<SocialProvider, CertSource>;
  log(line: string): void;
};
export function productionDeps(): SyncDeps {
  return {
    now: Date.now,
    fetch: globalFetch,
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    uuid: () => crypto.randomUUID(),
    certs: googleCerts(globalFetch),
    socialKeys: socialKeys(globalFetch),
    log: (line) => console.log(line),
  };
}
