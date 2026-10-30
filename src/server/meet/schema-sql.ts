export const SCHEMA_VERSION = 4;

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
  // 4: 여행 함께 편집(2B). 초대는 2A trip_share_tokens(kind='invite')를 쓴다.
  `CREATE TABLE IF NOT EXISTS trip_collab_devices (
    share_id TEXT NOT NULL, device_id TEXT NOT NULL, token_hash TEXT NOT NULL,
    label TEXT NOT NULL, created_at TEXT NOT NULL, seen_at TEXT NOT NULL,
    PRIMARY KEY (share_id, device_id)
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS trip_collab_devices_token ON trip_collab_devices(token_hash)',
  `CREATE TABLE IF NOT EXISTS trip_collab_meta (
    share_id TEXT PRIMARY KEY, progress_rev INTEGER NOT NULL,
    next_stop_id TEXT, next_date TEXT, next_label TEXT, next_at TEXT,
    edited_label TEXT, edited_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS trip_progress (
    share_id TEXT NOT NULL, stop_id TEXT NOT NULL, visited INTEGER NOT NULL,
    date TEXT NOT NULL, by_device TEXT NOT NULL, by_label TEXT NOT NULL, at TEXT NOT NULL,
    PRIMARY KEY (share_id, stop_id)
  )`,
];
