export type TripErrorCode =
  | 'schema'
  | 'unknown-place'
  | 'duplicate-in-trip'
  | 'day-count'
  | 'duplicate-sid'
  | 'leg-modes'
  | 'no-places'
  | 'lookup-failed'
  | 'ambiguous'
  | 'not-found'
  | 'duplicate-source'
  | 'out-of-range'
  | 'walk-too-far'
  | 'merged-places'
  | 'item-too-large'
  | 'too-big'
  | 'app-origin'
  | 'unused-place'
  | 'no-token'
  | 'unauthorized'
  | 'token-expired'
  | 'token-revoked'
  | 'not-allowed'
  | 'scope'
  | 'delete-token'
  | 'unknown-share'
  | 'share-store-full'
  | 'share-store'
  | 'inbox-full'
  | 'rate-limited'
  | 'off'
  | 'config'
  | 'old-server'
  | 'offline'
  | 'timeout'
  | 'server'
  | 'internal';

export type TripIssue = {
  path: string;
  code: TripErrorCode;
  message: string;
  candidates?: { naverSid: string; name: string; address: string; category: string }[];
};

export const EXIT = { ok: 0, internal: 1, input: 2, lookup: 3, auth: 4, server: 5 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

const EXIT_BY_CODE = {
  schema: EXIT.input,
  'unknown-place': EXIT.input,
  'duplicate-in-trip': EXIT.input,
  'day-count': EXIT.input,
  'duplicate-sid': EXIT.input,
  'leg-modes': EXIT.input,
  'no-places': EXIT.input,
  'lookup-failed': EXIT.lookup,
  ambiguous: EXIT.lookup,
  'not-found': EXIT.lookup,
  'duplicate-source': EXIT.input,
  'out-of-range': EXIT.input,
  'walk-too-far': EXIT.input,
  'merged-places': EXIT.input,
  'item-too-large': EXIT.input,
  'too-big': EXIT.input,
  'app-origin': EXIT.input,
  // 경고 전용 코드도 실패 분류에 쓰면 성공(0)으로 끝내지 않는다.
  'unused-place': EXIT.input,
  'share-store': EXIT.input,
  'no-token': EXIT.auth,
  unauthorized: EXIT.auth,
  'token-expired': EXIT.auth,
  'token-revoked': EXIT.auth,
  'not-allowed': EXIT.auth,
  scope: EXIT.auth,
  'delete-token': EXIT.auth,
  'unknown-share': EXIT.input,
  'share-store-full': EXIT.input,
  'inbox-full': EXIT.server,
  'rate-limited': EXIT.server,
  off: EXIT.server,
  config: EXIT.server,
  'old-server': EXIT.server,
  offline: EXIT.server,
  timeout: EXIT.server,
  server: EXIT.server,
  internal: EXIT.internal,
} as const satisfies Record<TripErrorCode, ExitCode>;

/** 설계의 끝 코드 표를 오류 코드별로 고정한다. */
export function exitFor(code: TripErrorCode): ExitCode {
  return EXIT_BY_CODE[code];
}

export class TripFailure extends Error {
  constructor(
    readonly issues: TripIssue[],
    readonly exit: ExitCode,
  ) {
    super(issues.map((issue) => issue.message).join('\n'));
    this.name = 'TripFailure';
  }
}
