export const SCHEMA_VERSION = 3;

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    doc TEXT NOT NULL,
    rev INTEGER NOT NULL,
    doc_rev INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS meetings_expires ON meetings(expires_at)',
  `CREATE TABLE IF NOT EXISTS meeting_replies (
    meeting_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    origin TEXT,
    likes TEXT NOT NULL,
    times TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (meeting_id, participant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS meeting_tokens (
    hash TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    participant_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS meeting_tokens_guest
    ON meeting_tokens(meeting_id, participant_id) WHERE kind = 'guest'`,
  `CREATE TABLE IF NOT EXISTS rate_counters (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL
  )`,
  'CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)',
  // 2: 공유 짧은 링크. 본문은 브라우저가 암호화한 값이라 서버는 읽을 수 없다.
  `CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    kind TEXT NOT NULL,
    delete_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS share_links_delete ON share_links(delete_hash)',
  'CREATE INDEX IF NOT EXISTS share_links_expires ON share_links(expires_at)',
  // 3: 여행 갱신 공유(2A). 2B가 쓸 빈 열(label·expires_at)을 미리 둔다(ALTER는 멱등이 아니다).
  `CREATE TABLE IF NOT EXISTS trip_shares (
    id TEXT PRIMARY KEY, doc TEXT NOT NULL, rev INTEGER NOT NULL,
    view_token TEXT NOT NULL, source_trip_id TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS trip_shares_expires ON trip_shares(expires_at)',
  `CREATE TABLE IF NOT EXISTS trip_share_tokens (
    hash TEXT PRIMARY KEY, share_id TEXT NOT NULL, kind TEXT NOT NULL,
    label TEXT, expires_at TEXT, created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS trip_share_tokens_share ON trip_share_tokens(share_id, kind)',
];
