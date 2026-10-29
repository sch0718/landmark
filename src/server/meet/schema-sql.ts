export const SCHEMA_VERSION = 6;

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

  `-- 5: 보관함 동기화. users·sessions는 @sch0718/firebase-session 0.2.1의
--    migrations/0001_users_sessions.sql + firebase-session-0002_social_sessions.sql과 같은 최종 모양이다
--    (identity 열을 처음부터 둔다. ALTER TABLE은 ensureSchema가 매번 다시 돌리므로 넣지 않는다).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  firebase_sub TEXT NOT NULL UNIQUE,     -- Google: Firebase uid, 소셜: 'kakao:<sub>'·'naver:<sub>'
  email TEXT NOT NULL,                   -- 소셜은 ''
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,              -- 세션 원문의 SHA-256 hex
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER,
  identity TEXT                          -- 소셜 세션만. Google 세션은 NULL
)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS library_state (
  user_id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL,                  -- 마지막으로 발급한 변경 번호
  purged_rev INTEGER NOT NULL,           -- 이 번호 이하의 묘비는 지워졌을 수 있다
  purged_at INTEGER NOT NULL,            -- 마지막 묘비 정리(ms)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS library_items (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- 'label'|'place'|'folder'|'trip'|'meeting'
  item_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  doc TEXT NOT NULL,                     -- 항목 JSON(키 정렬)
  deleted INTEGER NOT NULL,              -- 0|1
  deleted_at INTEGER,                    -- 묘비가 된 서버 시각(ms). 90일 정리 기준
  refs TEXT,                             -- 여행만: ',<placeId>,<placeId>,'
  device_id TEXT NOT NULL,               -- 마지막으로 쓴 기기
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, item_id)
)`,
  `CREATE INDEX IF NOT EXISTS library_items_rev ON library_items(user_id, rev, kind, item_id)`,
  `CREATE INDEX IF NOT EXISTS library_items_tomb ON library_items(user_id, deleted_at) WHERE deleted = 1`,
  `CREATE TABLE IF NOT EXISTS library_devices (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,               -- 브라우저가 만든 16자
  session_id TEXT NOT NULL,              -- publicSessionId(세션 해시 앞 12자). 세션 목록과 잇는다
  last_rev INTEGER NOT NULL,
  last_sync_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
)`,
  `-- 6: 서버 백업. 사용자(=보관함)당 스냅샷 하나. data는 tripmap-backup v1 텍스트를 gzip한 바이트의 base64 조각
CREATE TABLE IF NOT EXISTS library_backups (
  user_id TEXT PRIMARY KEY,
  id TEXT NOT NULL,                      -- 스냅샷 id(16자 hex). 조각과 잇고 조건부 덮어쓰기에 쓴다
  format INTEGER NOT NULL,               -- 1
  parts INTEGER NOT NULL,                -- 조각 수(1~3)
  stored_bytes INTEGER NOT NULL,         -- gzip 바이트 수
  raw_bytes INTEGER NOT NULL,            -- 원문 UTF-8 바이트 수(브라우저가 알림)
  content_hash TEXT NOT NULL,            -- hashItem(보관함)
  places INTEGER NOT NULL,
  labels INTEGER NOT NULL,
  trips INTEGER NOT NULL,
  meetings INTEGER NOT NULL,
  exported_at TEXT NOT NULL,             -- 봉투 exportedAt(기기 시각 ISO)
  device_id TEXT NOT NULL,
  device_label TEXT NOT NULL,
  reason TEXT NOT NULL,                  -- 'manual' | 'auto'
  created_at INTEGER NOT NULL            -- 서버 ms
)`,
  `CREATE TABLE IF NOT EXISTS library_backup_parts (
  user_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  idx INTEGER NOT NULL,                  -- 0부터
  data TEXT NOT NULL,                    -- base64 조각(524,288자 이하)
  PRIMARY KEY (user_id, backup_id, idx)
)`,
];
