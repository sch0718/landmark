import type { MeetDb } from './db';

export type MeetEnv = {
  DB: MeetDb;
  TURNSTILE_SECRET?: string;
  IP_HASH_SALT?: string;
  MEET_ONLINE?: string;
};

export type MeetContext = {
  request: Request;
  env: MeetEnv;
  waitUntil(p: Promise<unknown>): void;
  params: Record<string, string | string[]>;
};
