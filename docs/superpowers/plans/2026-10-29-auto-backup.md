# 서버 백업(자동 백업)·네이버 폴더 변경 알림 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3단계 로그인 세션 위에 사용자당 하나의 서버 스냅샷(D1)을 두고 수동·자동(앱 열 때 24시간 + 변경 있음)으로 만들고 되살린다. 네이버 폴더에서 가져온 라벨은 앱을 열 때 하루 한 번 원본 폴더를 다시 읽어 바뀐 장소 수를 앱 안에서 알린다(서버 제안 로드맵 4단계).

**Architecture:** 브라우저가 기존 백업 파일 텍스트를 `CompressionStream('gzip')`으로 압축하고 base64로 바꿔 3단계 `SyncApi.client.send`로 `POST /api/sync/v1/backup`에 올린다. 서버(`src/server/library-sync/backup.ts`)는 내용을 풀지 않고 메타 1행 + 512 KiB 조각 최대 3행으로 덮어쓴다. 자동 백업 실행기(`auto-backup` 조각)는 3단계 엔진의 `onRunFinished`에서 `synced`일 때만 판단한다. 되살리기는 기존 `RestoreDialog`에 원격 모드를 더해 재사용한다. 폴더 변경 알림은 서버 없이 `PlaceLookup.lookupFolder` + `planFolderSync`로 브라우저에서 센다.

**Tech Stack:** React 19, MUI 7, Jotai, Effect 4.0.2, Vitest 5, Playwright, Cloudflare Pages Functions + D1, `@sch0718/firebase-session@0.2.1`(3단계가 넣음), 브라우저 `CompressionStream`/`DecompressionStream`, Node 24 `node:sqlite`·`node:zlib`(시험 전용).

**설계 문서:** `docs/superpowers/specs/2026-10-29-auto-backup-design.md` — 이 계획과 다르면 설계 문서가 맞다. 모든 과제 전에 한 번 읽는다. 3단계 설계 `docs/superpowers/specs/2026-10-29-library-sync-design.md`(특히 「4단계가 쓰는 인터페이스」)와 3단계 계획 `docs/superpowers/plans/2026-10-29-library-sync.md`도 읽는다. 폴더 다시 가져오기는 `docs/superpowers/specs/2026-10-16-folder-resync-design.md`.

## Global Constraints

- **3단계 구현 결과 코드가 기준이다.** 이 계획은 3단계 계획서의 이름(`requireSyncUser`, `SyncUser`, `SyncEnv`, `SyncContext`, `SyncDeps`, `syncJson`, `SyncHttpError`, `consumeCounter`, `counterKey`, `SYNC_ROUTES`, `SyncRoute`, `ACCOUNT_DATA_TABLES`, `hashItem`, `createSyncApi`, `SyncApi`, `readSyncClientConfig`, `googleAuth`, `readSyncMeta`, `readSession`, `deviceLabel`, `readBootFlag`, `syncFeatureVisible`, `loadSyncEngine`, `ensureLibrarySyncEngine`, `onRunFinished`, `syncStatusAtom`, `SyncStatus`, `createSqliteD1`, `createSyncMemoryServer`, `createSyncServer`, `installSyncServer`)을 그대로 쓴다. **이름·시그니처·파일 위치가 다르면 코드를 따르고**, 그 차이를 커밋 메시지 본문과 최종 보고에 적는다. 3단계 파일은 이 계획이 적은 줄만 고친다.
- 셸: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`, Yarn 1.22.22. `GITHUB_PACKAGES_TOKEN`은 환경 변수로 있다(값 출력 금지). 설치 없이 명령만 돌릴 때 비어 있으면 `export GITHUB_PACKAGES_TOKEN=`.
- **포트 5173·5174를 쓰거나 끄지 않는다(사용자 개발 서버). `pkill` 금지.** 3단계 작업과 겹치지 않게 E2E는 `E2E_PORT=4186 E2E_MAP_PORT=4187`, 로컬 실행은 Vite 4188·wrangler 8796(`SYNC_VITE_PORT=4188 SYNC_DEV_PORT=8796`). 띄운 프로세스는 PID로만 끈다.
- 원격 D1 마이그레이션·`wrangler secret put`·`wrangler pages deploy`·외부 계정·키 생성 금지. `wrangler.toml`을 만들지 않는다. 세션·스냅샷 데이터를 파일·로그·커밋에 쓰지 않는다.
- **새 의존성 없음.** 압축은 브라우저 내장 `CompressionStream`, 시험은 `node:zlib`.
- 보관함 형식(`tripmap:library:v2`)·백업 파일 형식(`BACKUP_FORMAT = 'tripmap-backup'`, `BACKUP_VERSION = 1`)·폴더 연결 형식(`FolderLinkSchema`)을 바꾸지 않는다. `src/domain/library/folder-links.ts`·`src/domain/backup/*.ts`·`src/schema/*.ts`의 시그니처를 바꾸지 않는다.
- D1: `src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에만** 더하고 `SCHEMA_VERSION = 6`. 모든 문장은 `CREATE … IF NOT EXISTS`. `ALTER TABLE` 금지.
- `functions/**`와 `src/server/**`는 서로 상대 경로로 가져온다(`src/` 별칭 금지). 서버 코드에서 React·MUI 금지. `.sql` 파일을 import하지 않는다.
- 3단계 엔진(`src/services/library-sync/sync-engine.ts`)은 **어디서나 `loadSyncEngine()`(동적 import)으로만** 가져온다. 이 기능의 조각(`auto-backup.ts`, `folder-watch.ts`, `ServerBackupSection.tsx`)도 각자의 `lazyChunk` 함수로만 가져온다. 정적으로 섞이면 `vite.config.ts`의 `INEFFECTIVE_DYNAMIC_IMPORT` 검사로 빌드가 실패한다. 첫 로딩 상한 `initialJsGzipMax` 327,680을 지킨다.
- 사용자 문자열은 React 텍스트로만(`dangerouslySetInnerHTML`·`innerHTML` 금지). 주석·UI 문구는 한국어. `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 고치지 않는다: `docs/rollback.md`, `perf-budget.json`, `.claude/`, `tests/e2e/global-setup*`, `src/sections/shell/AppShell.tsx`, `src/sections/shell/BackupReminder.tsx`, 다른 기능의 기존 시험 단언(단, 스키마 버전 단언 5 → 6은 고친다). `playwright.config.ts`는 Task 8이 적은 줄만 바꾼다.
- 여러 기능이 같이 고치는 문서(`README.md`, `docs/development.md`, 도움말)는 자기 절·줄만 더한다.
- Codex 샌드박스에서 네트워크·포트 열기가 막히면 그 명령을 건너뛰고 보고에 적는다(감독 에이전트가 대신 실행해 결과를 넘긴다).
- 과제마다 커밋한다. 메시지는 한국어 conventional(`feat(auto-backup): …`, `feat(folder-watch): …`), 끝 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **덮어쓰기 안전**: 조각 → 메타(조건부) → 옛 조각 지우기가 한 `batch`인지, 진 쪽 조각이 남지 않는지, 읽기가 메타 id로만 조각을 잇는지, `ifMatch` 세 경우.
- **자동 백업이 좋은 스냅샷을 덮지 않는지**: `synced`에서만, 해시 같으면 안 올림, 빈 보관함·크게 줄어든 보관함 건너뜀, 24시간을 서버 시각으로 비교.
- **되살리기 유실 금지**: 원격 모드에서 파일 받기가 바꾸기와 같은 클릭 안에서 먼저 일어나는지, 받기 실패면 바꾸지 않는지, 체크를 풀면 `requirePrevious: true`인지, 파일 모드 동작이 그대로인지.
- **격리·크기·CPU**: 모든 SQL에 `user_id = ?`(세션 값), 서버가 압축을 풀거나 `data`를 `JSON.parse`하지 않는지(본문 `readJson` 한 번뿐), 응답을 문자열로 이어 붙이는지, 풀기 상한 16 MiB.
- **폴더 알림 빈도**: 폴더당 하루 1번·한 번 열 때 5개·캐시 사용(`fresh` 없음)·Web Lock·꺼짐이면 조각을 받지 않음.
- **첫 로딩**: `yarn size --require-lazy …` 통과, 부트 파일이 실행기·엔진을 정적으로 가져오지 않는지.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/server/meet/schema-sql.ts` | 표 2개 추가, `SCHEMA_VERSION = 6` |
| `src/server/library-sync/env.ts` | `SyncEnv`에 `AUTO_BACKUP?: string` |
| `src/server/library-sync/backup.ts` | 상수·본문 검사·쓰기·읽기·지우기·`BACKUP_ROUTES` |
| `src/server/library-sync/router.ts` | `SYNC_ROUTES`에 `...BACKUP_ROUTES` |
| `src/server/library-sync/library.ts` | `ACCOUNT_DATA_TABLES`에 표 2개 |
| `src/services/library-sync/shared-api.ts` | `getSharedSyncApi()`(엔진과 이 기능이 같은 `SyncApi`) |
| `src/services/server-backup/storage.ts` | 로컬 키 `tripmap:server-backup:v1`(런타임 import 없음) |
| `src/services/server-backup/snapshot.ts` | gzip·base64·스냅샷 만들기·읽기 |
| `src/services/server-backup/api.ts` | `createBackupApi`·실패 해석 |
| `src/services/server-backup/auto-backup.ts` | 자동 백업 판단·실행기(조각 `auto-backup`) |
| `src/services/server-backup/boot.ts` | 첫 로딩: `readAutoBackupFlag`·`loadAutoBackup`·`loadServerBackupSection` |
| `src/sections/server-backup/use-auto-backup-boot.ts` | 첫 로딩: 셸에서 실행기 붙이기 |
| `src/sections/server-backup/server-backup-copy.ts` | 문구·줄 만들기 |
| `src/sections/server-backup/ServerBackupSection.tsx` | 설정 › 백업 › 서버 백업(조각 `ServerBackupSection`) |
| `src/sections/server-backup/ServerBackupConfirmDialog.tsx` | 덮어쓰기·지우기 확인 |
| `src/sections/backup/RestoreDialog.tsx`, `RestoreDialogHost.tsx` | 원격 모드(`remote` prop) |
| `src/services/folder-watch/state.ts` | 첫 로딩: 로컬 키 `tripmap:folder-watch:v1`·기한 계산(런타임 import 없음) |
| `src/services/folder-watch/boot.ts` | 첫 로딩: `loadFolderWatch` |
| `src/services/folder-watch/folder-watch.ts` | 폴더 확인 실행기·토스트(조각 `folder-watch`) |
| `src/stores/folder-watch.ts` | `folderWatchAtom`·표시 계산(라벨 관리·설정 조각 안) |
| `src/sections/folder-watch/use-folder-watch-boot.ts` | 첫 로딩: 셸에서 기한이 된 폴더가 있으면 실행기를 받음 |
| `src/sections/folder-watch/FolderWatchSetting.tsx` | 설정 › 가져오기 스위치·`지금 확인` |
| `src/sections/labels/LabelsPage.tsx`, `LabelEditor.tsx` | 알림 표시 |
| `src/sections/shell/ShellRoute.tsx` | 부트 훅 둘 |
| `src/sections/settings/SettingsPage.tsx` | 서버 백업 구역·폴더 알림 설정 |
| `tests/e2e/server-backup.spec.ts`, `tests/e2e/folder-watch.spec.ts` | E2E |

---

### Task 0: 3단계 결과 들이기와 이름 확인

**Files:**
- Create: `src/services/library-sync/shared-api.ts`
- Modify: `src/services/library-sync/sync-engine.ts`(`ensureLibrarySyncEngine`의 `api` 만들기 한 곳)
- Test: `tests/unit/services/library-sync-shared-api.test.ts`

- [ ] **Step 1: 3단계 구현 들이기** — `git -C <워크트리> fetch` 없이 같은 저장소의 로컬 브랜치를 쓴다: `git merge --no-edit feat/library-sync`. `feat/library-sync`에 3단계 구현 커밋(Task 1~10)이 없으면(마지막 커밋이 `317aa70`이면) **여기서 멈추고** "3단계 구현이 아직 브랜치에 없음"을 보고한다. 충돌은 3단계 쪽을 택한다(이 브랜치는 문서 커밋 둘뿐이다).
- [ ] **Step 2: 이름 확인** — 아래가 모두 나오는지 본다. 하나라도 없거나 시그니처가 다르면 이 계획의 해당 Task에서 코드 쪽 이름을 쓰고, 차이를 이 계획서 끝 「3단계와 다른 점」 절(없으면 만든다)에 한 줄씩 적어 같은 커밋에 넣는다.
  ```bash
  grep -n "export async function requireSyncUser\|export type SyncUser" src/server/library-sync/auth.ts
  grep -n "export type SyncEnv\|export type SyncContext\|export type SyncDeps" src/server/library-sync/env.ts
  grep -n "export class SyncHttpError\|export function syncJson" src/server/library-sync/http.ts
  grep -n "export function counterKey\|export async function consumeCounter" src/server/library-sync/limits.ts
  grep -n "export const SYNC_ROUTES\|export type SyncRoute\|allowWhenOff" src/server/library-sync/router.ts
  grep -n "ACCOUNT_DATA_TABLES" src/server/library-sync/library.ts
  grep -n "export function hashItem" src/domain/library-sync/items.ts
  grep -n "export function createSyncApi\|export type SyncApi\|export function googleAuth" src/services/library-sync/api.ts
  grep -n "export function readSyncClientConfig" src/services/library-sync/config.ts
  grep -n "export function readSyncMeta\|export function readSession" src/services/library-sync/storage.ts
  grep -n "export function deviceLabel" src/services/library-sync/login.ts
  grep -n "export function readBootFlag\|export function syncFeatureVisible\|export const loadSyncEngine" src/services/library-sync/boot.ts
  grep -n "export function ensureLibrarySyncEngine\|onRunFinished" src/services/library-sync/sync-engine.ts
  grep -n "export const syncStatusAtom\|export type SyncStatus" src/stores/sync-status.ts
  grep -n "export function createSyncMemoryServer" tests/helpers/sync-memory-server.ts
  grep -n "export function createSyncServer\|export async function installSyncServer" tests/e2e/sync-server.ts
  ```
  `mapStatus`가 409를 어떻게 바꾸는지(`busy` 코드만인지, 모든 409인지)도 `src/services/library-sync/api.ts`에서 읽어 둔다(Task 2의 `toBackupFailure`는 둘 다 받는다).
- [ ] **Step 3: 실패하는 시험** — `library-sync-shared-api.test.ts`: `vi.stubEnv`로 빌드 변수가 없으면 `getSharedSyncApi() === null`, 카카오 변수가 있으면 객체이고 두 번 불러도 같은 참조(`toBe`), `resetSharedSyncApiForTest()` 뒤에는 새 참조.
- [ ] **Step 4: 구현** —
  ```ts
  // src/services/library-sync/shared-api.ts
  import { createSyncApi, googleAuth, type SyncApi } from 'src/services/library-sync/api';
  import { readSyncClientConfig } from 'src/services/library-sync/config';

  let cached: SyncApi | null | undefined;

  /** 엔진과 서버 백업이 같은 `SyncApi`(같은 Firebase Auth 인스턴스)를 쓰도록 한 번만 만든다. 설정이 없으면 null. */
  export function getSharedSyncApi(): SyncApi | null {
    if (cached !== undefined) return cached;
    const config = readSyncClientConfig(import.meta.env, location.origin);
    cached = config === null ? null : createSyncApi({ config, storage: localStorage, auth: googleAuth(config) });
    return cached;
  }

  export function resetSharedSyncApiForTest(): void {
    cached = undefined;
  }
  ```
  `ensureLibrarySyncEngine()` 안에서 `createSyncApi(...)`를 직접 부르던 곳을 `getSharedSyncApi()`로 바꾼다(null이면 지금처럼 늘 `off`). 3단계에 이미 같은 일을 하는 함수가 있으면 이 파일을 만들지 말고 그 함수를 쓰며, 아래 Task의 `getSharedSyncApi`를 그 이름으로 읽는다.
- [ ] **Step 5:** `yarn vitest run tests/unit/services/library-sync-shared-api.test.ts tests/unit/services/library-sync-engine.test.ts`, `yarn typecheck`
- [ ] **Step 6:** 커밋 `refactor(library-sync): 엔진과 다른 기능이 같은 동기화 API를 쓰도록 공용 접근자`

### Task 1: 서버 — 표·백업 API

**Files:**
- Modify: `src/server/meet/schema-sql.ts`, `src/server/library-sync/env.ts`, `src/server/library-sync/router.ts`, `src/server/library-sync/library.ts`, 버전을 단언하는 기존 시험(`tests/unit/server/meet-db.test.ts`, `tests/unit/server/sync-schema.test.ts`: 5 → 6)
- Create: `src/server/library-sync/backup.ts`
- Test: `tests/unit/server/backup-schema.test.ts`, `tests/unit/server/backup-api.test.ts`

**Interfaces:**
- Consumes: 3단계 `requireSyncUser`, `SyncEnv`, `SyncContext`, `SyncDeps`, `syncJson`, `SyncHttpError`, `consumeCounter`, `counterKey`, `SyncRoute`, `ensureSchema`(라우터가 이미 부름), 패키지 `readJson`(`@sch0718/firebase-session/worker`), `MeetDb`(`src/server/meet/db.ts`).
- Produces:
  - `SCHEMA_VERSION = 6`. `SCHEMA_STATEMENTS` 끝에 설계 §서버 데이터의 `CREATE TABLE IF NOT EXISTS library_backups (…)`와 `CREATE TABLE IF NOT EXISTS library_backup_parts (…)`를 **각각 배열 원소 하나로, 주석 포함 그대로**.
  - `env.ts`의 `SyncEnv`에 `AUTO_BACKUP?: string;`(주석 `/** 'off'면 서버 백업 쓰기를 막는다(읽기·지우기는 됨) */`).
  - `library.ts`: `ACCOUNT_DATA_TABLES`의 끝에 `'library_backup_parts', 'library_backups'`(문자열 그대로, import 없이).
  - `backup.ts`:
    ```ts
    export const BACKUP_FORMAT_VERSION = 1;
    export const BACKUP_MAX_STORED_BYTES = 1_048_576;
    export const BACKUP_MAX_DATA_CHARS = 1_398_104; // 4 * ceil(1_048_576 / 3)
    export const BACKUP_PART_CHARS = 524_288;
    export const BACKUP_MAX_BODY_BYTES = 1_500_000;
    export const BACKUP_MAX_RAW_BYTES = 16_777_216;
    export const BACKUP_COUNT_MAX = 1_000_000;
    export const BACKUP_LIMITS = { write: 20, read: 200 } as const;

    export type BackupCounts = { places: number; labels: number; trips: number; meetings: number };
    export type BackupReason = 'manual' | 'auto';
    export type BackupMeta = {
      id: string;
      createdAt: number;
      exportedAt: string;
      storedBytes: number;
      rawBytes: number;
      contentHash: string;
      counts: BackupCounts;
      deviceId: string;
      deviceLabel: string;
      reason: BackupReason;
    };
    export type BackupBody = {
      v: 1;
      format: 1;
      data: string;
      rawBytes: number;
      contentHash: string;
      counts: BackupCounts;
      exportedAt: string;
      deviceId: string;
      deviceLabel: string;
      reason: BackupReason;
      /** 없음: 늘 덮어씀. null: 서버 백업이 없을 때만. 문자열: 그 id일 때만 */
      ifMatch?: string | null;
    };

    /** AUTO_BACKUP·LIBRARY_SYNC가 둘 다 'off'가 아닌가. */
    export function backupWritable(env: SyncEnv): boolean;
    /** base64 길이에서 원래 바이트 수(`length / 4 * 3 - '=' 수`). */
    export function storedBytesOf(data: string): number;
    /** `BACKUP_PART_CHARS`씩 자른다(빈 문자열은 받지 않는다). */
    export function splitParts(data: string): string[];
    /** 설계 §API의 검사. 실패는 `SyncHttpError(422, 'invalid', { path })`, data 길이 초과는 `SyncHttpError(413, 'too-large')`. deviceLabel은 trim한 값으로 돌려준다. */
    export function parseBackupBody(value: unknown): BackupBody;
    /** `deps.random(8)`의 16자 hex. */
    export function newBackupId(deps: Pick<SyncDeps, 'random'>): string;
    export async function readBackupMeta(db: MeetDb, userId: string): Promise<BackupMeta | null>;
    /** 설계 §API 쓰기. 결과 메타의 id가 `id`가 아니면 `SyncHttpError(409, 'backup-changed')`. */
    export async function writeBackup(db: MeetDb, userId: string, body: BackupBody, id: string, now: number): Promise<BackupMeta>;
    /** 응답 본문 문자열 `{"id":"…","data":"…"}`. 없음 404 `no-backup`, id 다름·조각 수 다름 409 `backup-changed`. */
    export async function readBackupData(db: MeetDb, userId: string, id: string | null): Promise<string>;
    export async function deleteBackup(db: MeetDb, userId: string): Promise<void>;
    /** 질의는 `id`(선택, `^[0-9a-f]{16}$`)만. 그 밖 키·형식 오류는 422 `invalid`(`path: 'id'` 또는 키 이름). */
    export function parseDataQuery(url: URL): { id: string | null };
    export const BACKUP_ROUTES: SyncRoute[];
    ```
  - SQL(바인드 번호는 문장 안 기준):
    ```sql
    -- 메타 읽기
    SELECT id, created_at, exported_at, stored_bytes, raw_bytes, content_hash,
           places, labels, trips, meetings, device_id, device_label, reason, parts
    FROM library_backups WHERE user_id = ?1;

    -- 쓰기 batch: (1) 조각마다
    INSERT INTO library_backup_parts (user_id, backup_id, idx, data) VALUES (?1, ?2, ?3, ?4);
    -- (2) 메타. CONFLICT 절은 ifMatch에 따라 셋 중 하나
    INSERT INTO library_backups (user_id, id, format, parts, stored_bytes, raw_bytes, content_hash,
      places, labels, trips, meetings, exported_at, device_id, device_label, reason, created_at)
    VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
    --   ifMatch 없음:
    ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, format = excluded.format, parts = excluded.parts,
      stored_bytes = excluded.stored_bytes, raw_bytes = excluded.raw_bytes, content_hash = excluded.content_hash,
      places = excluded.places, labels = excluded.labels, trips = excluded.trips, meetings = excluded.meetings,
      exported_at = excluded.exported_at, device_id = excluded.device_id, device_label = excluded.device_label,
      reason = excluded.reason, created_at = excluded.created_at
    --   ifMatch 문자열: 위 절 끝에 `WHERE library_backups.id = ?16`
    --   ifMatch null:  ON CONFLICT(user_id) DO NOTHING
    ;
    -- (3) 메타가 가리키지 않는 조각 지우기(메타가 없으면 모두)
    DELETE FROM library_backup_parts
    WHERE user_id = ?1 AND backup_id IS NOT (SELECT id FROM library_backups WHERE user_id = ?1);

    -- 데이터 읽기
    SELECT b.id AS id, b.parts AS parts, p.idx AS idx, p.data AS data
    FROM library_backups b
    JOIN library_backup_parts p ON p.user_id = b.user_id AND p.backup_id = b.id
    WHERE b.user_id = ?1 ORDER BY p.idx;

    -- 지우기 batch
    DELETE FROM library_backup_parts WHERE user_id = ?1;
    DELETE FROM library_backups WHERE user_id = ?1;
    ```
    `writeBackup`은 batch 뒤 `readBackupMeta`로 확인한다. `readBackupData`는 행이 없으면 `readBackupMeta`가 null이면 404, 아니면 409.
  - `BACKUP_ROUTES`(모두 `/api/sync` 뒤 경로, 시작에 `const now = deps.now()`; 한도 초과는 `SyncHttpError(429, 'rate-limited')` — 3단계 한도 오류 코드가 다르면 그것):
    - `{ method: 'GET', path: /^\/v1\/backup$/, pattern: '/v1/backup', allowWhenOff: true }` → `requireSyncUser` → `consumeCounter(db, counterKey('backup-read', user.userId, now), 1, BACKUP_LIMITS.read)` → `syncJson(200, { now, writable: backupWritable(env), maxStoredBytes: BACKUP_MAX_STORED_BYTES, backup: await readBackupMeta(db, user.userId) })`.
    - `{ method: 'POST', path: /^\/v1\/backup$/, pattern: '/v1/backup' }`(allowWhenOff 없음 → `LIBRARY_SYNC=off`면 라우터가 503) → `env.AUTO_BACKUP === 'off'`면 `SyncHttpError(503, 'off')` → `requireSyncUser` → `parseBackupBody(await readJson(ctx.request, BACKUP_MAX_BODY_BYTES))`(패키지 `HttpError` 413은 3단계 `syncError`가 그대로 바꾼다) → `consumeCounter('backup-write', 1, BACKUP_LIMITS.write)` → `writeBackup(db, user.userId, body, newBackupId(deps), now)` → `syncJson(200, { now, backup })`.
    - `{ method: 'GET', path: /^\/v1\/backup\/data$/, pattern: '/v1/backup/data', allowWhenOff: true }` → `parseDataQuery(url)` → `requireSyncUser` → `consumeCounter('backup-read', …)` → 본문 문자열을 3단계 받기 경로와 같은 머리글(`Content-Type: application/json; charset=utf-8`, `Cache-Control: private, no-store`)의 `200` 응답으로.
    - `{ method: 'DELETE', path: /^\/v1\/backup$/, pattern: '/v1/backup', allowWhenOff: true }` → `requireSyncUser` → `deleteBackup` → `syncJson(204, null)`.
  - `router.ts`: `import { BACKUP_ROUTES } from './backup';`, `SYNC_ROUTES` 배열 끝에 `...BACKUP_ROUTES`. `backup.ts`는 `router.ts`를 `import type`으로만 가져온다(순환 방지). 3단계 `SyncRoute.method`에 `'POST'`가 없으면 그 유니온을 넓힌다.
- [ ] **Step 1: 실패하는 시험**(모두 `// @vitest-environment node`)
  - `backup-schema.test.ts`: `createSqliteD1()` + `ensureSchema` 뒤 `schema_meta.version === 6`, 두 표 존재(`PRAGMA table_info`로 열 이름 목록이 설계 SQL과 같음), `SCHEMA_STATEMENTS` 두 번 실행 오류 없음, 버전 5인 DB에서 올라감, 어떤 문장도 `ALTER` 없음.
  - `backup-api.test.ts`(`createSyncMemoryServer({ ALLOWED_ACCOUNTS: 'kakao:dev-me,kakao:dev-you' })`, 사용자 A=`login('me')`, B=`login('you')`, 요청은 `server.fetch('http://localhost:8796/api/sync/v1/backup', { headers: { Origin: 'http://localhost:8796', 'X-Landmark-Session': s, 'Content-Type': 'application/json' } })` 모양의 작은 도우미). 본문 도우미 `validBody(over?: Partial<BackupBody>)`는 `gzipSync(Buffer.from('{"format":"tripmap-backup"}')).toString('base64')`를 `data`로 쓴다.
    - 메타 없음 → `200 { backup: null, writable: true, maxStoredBytes: 1048576 }`, `now`는 숫자.
    - 쓰기 → 200, `backup.id`가 16자 hex, `storedBytes`가 gzip 바이트 수, `reason`, `counts`. 메타 다시 읽으면 같음.
    - 조각 나눔: `gzipSync(randomBytes(900_000))`(base64 약 120만 자) → `library_backup_parts` 3행, `GET /v1/backup/data`의 `data`가 올린 문자열과 같음(이어 붙이기).
    - 덮어쓰기: 두 번째 쓰기 뒤 조각 행은 새 id 것만, 메타 1행.
    - `ifMatch`: 메타 없을 때 `null` → 200, 있을 때 `null` → 409 `backup-changed`이고 조각 행은 기존 것만; 맞는 id → 200; 틀린 id → 409.
    - 데이터: `?id=<다른 id>` → 409, 없음 → 404 `{ error: 'no-backup' }`, `?x=1` → 422, `?id=XYZ` → 422.
    - 검사: 남는 키, `v: 2`, `format: 2`, `data`가 `H4sI`로 시작하지 않음, base64 아닌 문자, 길이 4의 배수 아님, `rawBytes: 0`·`16_777_217`·`1.5`, `contentHash: 'A!'`, `counts.places: -1`, `counts`에 남는 키, `exportedAt: 'x'`, `deviceId: 'short'`, `deviceLabel: ''`·41자·`'a\nb'`, `reason: 'cron'`, `ifMatch: 'nothex'` → 각각 422이고 `path`가 그 필드. `data` 1,398,105자(`'H4sI' + 'A'.repeat(…)`, 4의 배수로 맞춤) → 413 `too-large`. 본문 1,500,001바이트 → 413.
    - 격리: B는 A의 백업을 못 보고(`backup: null`), B가 써도 A 메타·조각이 그대로.
    - 지우기 → 204 → 메타 null, 조각 0행.
    - 한도: 쓰기 21번째 429, 읽기 201번째 429(메타·데이터 합산).
    - 스위치: `AUTO_BACKUP: 'off'` → 쓰기 503 `{ error: 'off' }`, 메타 200 `writable: false`, 데이터 200, 지우기 204. `LIBRARY_SYNC: 'off'` → 쓰기 503, 메타 200 `writable: false`, 지우기 204.
    - 세션 없음 → 401. 계정 지우기(`DELETE /v1/account` `{ confirm: 'delete' }`) 뒤 백업 두 표에 A 행 0, B 행 그대로.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/backup-schema.test.ts tests/unit/server/backup-api.test.ts` → 실패 확인
- [ ] **Step 3:** 구현. 검사 함수는 Effect 없이 직접 쓴다(CPU). `data` 정규식은 `/^[A-Za-z0-9+/]+={0,2}$/` 하나.
- [ ] **Step 4:** 시험 통과, `yarn vitest run tests/unit/server`(기존 서버 시험 포함, 버전 단언 6), `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(auto-backup): 서버 백업 표와 API(메타·쓰기·데이터·지우기)`

### Task 2: 브라우저 — 스냅샷·백업 API·로컬 기록

**Files:**
- Create: `src/services/server-backup/storage.ts`, `src/services/server-backup/snapshot.ts`, `src/services/server-backup/api.ts`
- Test: `tests/unit/services/server-backup-storage.test.ts`, `tests/unit/services/server-backup-snapshot.test.ts`(`// @vitest-environment node`), `tests/unit/services/server-backup-api.test.ts`

**Interfaces:**
- Consumes: `buildBackupText`(`src/domain/backup/build-backup.ts`), `readBackupText`·`BackupReadResult`·`BACKUP_FILE_MAX_BYTES`(`src/domain/backup/read-backup.ts`), `libraryCounts`·`LibraryCounts`(`src/domain/backup/summary.ts`), `hashItem`(3단계), `SyncApi`(3단계), `Library`, `Prefs`.
- Produces(`storage.ts`, **런타임 import 없음 — 타입만**):
  ```ts
  export const SERVER_BACKUP_KEY = 'tripmap:server-backup:v1';
  /** 설정에 한 줄로 보이는 자동 백업 결과 */
  export type AutoOutcome =
    | 'uploaded' | 'skipped-empty' | 'skipped-shrunk' | 'too-large' | 'unsupported' | 'off' | 'limit' | 'failed';
  export type ServerBackupLocal = {
    v: 1;
    auto: boolean;
    /** 이 기록을 쓴 3단계 사용자 id. 다르면 기한·결과를 버린다 */
    userId: string | null;
    /** 이 기기 ms. 이보다 이르면 요청하지 않는다 */
    nextCheckAt: number | null;
    last: { at: number; outcome: AutoOutcome } | null;
  };
  export const EMPTY_SERVER_BACKUP_LOCAL: ServerBackupLocal;
  /** 없거나 깨지면 EMPTY 사본. 저장소가 던져도 EMPTY. */
  export function readServerBackupLocal(storage: Storage | undefined): ServerBackupLocal;
  /** 실패는 console.warn만. 쓴 뒤 `window`에 `SERVER_BACKUP_EVENT` 이벤트를 보낸다(설정 구역이 다시 읽는다). */
  export function writeServerBackupLocal(storage: Storage | undefined, value: ServerBackupLocal): void;
  export const SERVER_BACKUP_EVENT = 'tripmap:server-backup';
  ```
  검사: `v === 1`, `auto` 불리언, `userId` 문자열|null, `nextCheckAt` 유한 정수|null, `last`는 null 또는 `{ at: 유한 정수, outcome: 위 8개 중 하나 }`. 하나라도 틀리면 EMPTY.
- Produces(`snapshot.ts`):
  ```ts
  export const SNAPSHOT_MAX_STORED_BYTES = 1_048_576;
  export const SNAPSHOT_MAX_RAW_BYTES = 16_777_216;
  export type SnapshotInput = { rawLibrary: unknown; library: Library; prefs: Prefs | null; now: Date };
  export type BuiltSnapshot = {
    data: string; storedBytes: number; rawBytes: number; contentHash: string;
    counts: LibraryCounts; exportedAt: string;
  };
  export type BuildFailure = 'too-large' | 'unsupported';
  export function compressionSupported(): boolean; // typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
  export async function gzipBytes(text: string): Promise<Uint8Array>;
  /** 풀면서 `maxBytes`를 넘으면 읽기를 취소하고 'too-big'. gzip이 아니면 'invalid'. */
  export async function gunzipLimited(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array | 'too-big' | 'invalid'>;
  /** 0x8000바이트씩 `String.fromCharCode` → `btoa`. */
  export function toBase64(bytes: Uint8Array): string;
  /** 형식이 틀리면 null(`atob`이 던지는 것 포함). */
  export function fromBase64(text: string): Uint8Array | null;
  export function libraryContentHash(lib: Library): string; // hashItem(lib)
  export async function buildSnapshot(input: SnapshotInput): Promise<{ ok: true; snapshot: BuiltSnapshot } | { ok: false; reason: BuildFailure }>;
  /** base64 → gunzip(16 MiB) → UTF-8(fatal) → readBackupText. 실패는 기존 오류 이름('invalid'·'too-big'·…). */
  export async function readSnapshotData(data: string): Promise<BackupReadResult>;
  ```
  `buildSnapshot`: `compressionSupported()`가 거짓이면 `unsupported` → `text = buildBackupText({ rawLibrary, prefs, now })` → `rawBytes = new TextEncoder().encode(text).length`, `SNAPSHOT_MAX_RAW_BYTES` 넘으면 `too-large` → `gzipBytes` → 길이가 `SNAPSHOT_MAX_STORED_BYTES` 넘으면 `too-large` → `{ data: toBase64(gz), storedBytes: gz.length, rawBytes, contentHash: libraryContentHash(library), counts: libraryCounts(library), exportedAt: now.toISOString() }`.
- Produces(`api.ts`):
  ```ts
  export type BackupFailure =
    | 'auth' | 'not-allowed' | 'offline' | 'off' | 'limit' | 'too-large' | 'invalid' | 'changed' | 'not-found' | 'server';
  export type BackupResult<T> = { ok: true; data: T } | { ok: false; reason: BackupFailure };
  export type BackupCounts = { places: number; labels: number; trips: number; meetings: number };
  export type ServerBackupMeta = {
    id: string; createdAt: number; exportedAt: string; storedBytes: number; rawBytes: number;
    contentHash: string; counts: BackupCounts; deviceId: string; deviceLabel: string; reason: 'manual' | 'auto';
  };
  export type BackupMetaReply = { now: number; writable: boolean; maxStoredBytes: number; backup: ServerBackupMeta | null };
  export type BackupUpload = {
    v: 1; format: 1; data: string; rawBytes: number; contentHash: string; counts: BackupCounts;
    exportedAt: string; deviceId: string; deviceLabel: string; reason: 'manual' | 'auto'; ifMatch?: string | null;
  };
  export type BackupApi = {
    meta(): Promise<BackupResult<BackupMetaReply>>;
    upload(body: BackupUpload): Promise<BackupResult<{ now: number; backup: ServerBackupMeta }>>;
    download(id: string): Promise<BackupResult<{ id: string; data: string }>>;
    remove(): Promise<BackupResult<null>>;
  };
  /** 3단계·패키지 실패를 이 기능의 이유로. */
  export function toBackupFailure(fail: { kind: string; code?: string; status?: number }): BackupFailure;
  export function createBackupApi(api: Pick<SyncApi, 'client'>): BackupApi;
  /** 스냅샷과 기기 정보를 올릴 본문으로. */
  export function uploadBody(s: BuiltSnapshot, device: { deviceId: string; deviceLabel: string }, reason: 'manual' | 'auto', ifMatch?: string | null): BackupUpload;
  ```
  `toBackupFailure`: `auth`→`auth`, `not-allowed`→`not-allowed`, `offline`→`offline`, `off`→`off`, `busy`→`changed`, `limit`(`code === 'off'`면 `off`, 아니면 `limit`), `invalid`(`code === 'too-large'`면 `too-large`, 아니면 `invalid`), `not-found`→`not-found`, `server`(`status === 409`면 `changed`, 아니면 `server`), 그 밖(`resync` 등)→`server`.
  `createBackupApi`: `meta` = `client.send<BackupMetaReply>('GET', '/v1/backup')`, `upload` = `send('POST', '/v1/backup', { body })`(`ifMatch`가 `undefined`면 키를 넣지 않는다), `download` = `send('GET', '/v1/backup/data?id=' + encodeURIComponent(id))`, `remove` = `send('DELETE', '/v1/backup')`(성공 데이터는 `null`로). 응답 모양은 검사하지 않고 타입만 붙인다(같은 출처 서버).
- [ ] **Step 1: 실패하는 시험**
  - storage: 없음·깨진 JSON·`v: 2`·`outcome: 'x'` → EMPTY, 왕복, `setItem`이 던져도 throw 없음, 쓰면 `tripmap:server-backup` 이벤트.
  - snapshot(`// @vitest-environment node`, Node 24에 `CompressionStream`이 있다): 작은 보관함(`tests/fixtures/builders.ts`·기존 시드)으로 `buildSnapshot` → `data`가 `H4sI`로 시작, `node:zlib` `gunzipSync(Buffer.from(data, 'base64'))`가 `buildBackupText` 결과와 같음, `storedBytes`·`rawBytes`·`counts`·`contentHash === hashItem(library)`; `readSnapshotData(data)`가 `ok`이고 `backup.library`가 같음·`prefs` 왕복; 키 순서만 다른 두 보관함의 `libraryContentHash`가 같음; `vi.stubGlobal('CompressionStream', undefined)` → `unsupported`; 압축 뒤 1 MiB 넘는 입력(`rawLibrary`에 `{ ...lib, junk: <crypto 무작위 hex 2,000,000자> }`를 넣음 — `rawLibrary`는 원문 값이라 모르는 키도 그대로 들어간다) → `too-large`; 원문 16 MiB 초과(`junk`에 `'가'.repeat(6_000_000)`, UTF-8 18MB) → 압축 전에 `too-large`; `gzipSync(Buffer.alloc(17_000_000))` base64 → `readSnapshotData`가 `too-big`; `'!!!'` → `invalid`; gzip 아닌 base64(`Buffer.from('hello').toString('base64')`) → `invalid`; gzip한 `'not json'` → `not-backup`.
  - api(가짜 `client.send`를 `vi.fn`으로): 경로·메서드·본문(`ifMatch` 없을 때 키 없음, `null`이면 `null`), 실패 해석 표 전부.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/server-backup-*.test.ts` → 실패 확인
- [ ] **Step 3:** 구현. `gunzipLimited`은 `new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()`로 읽으며 합계가 넘으면 `reader.cancel()`; `TypeError`(gzip 아님)는 `'invalid'`.
- [ ] **Step 4:** 시험 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(auto-backup): 서버 백업 스냅샷 압축·API 클라이언트·로컬 기록`

### Task 3: 자동 백업 실행기와 부트

**Files:**
- Create: `src/services/server-backup/auto-backup.ts`, `src/services/server-backup/boot.ts`, `src/sections/server-backup/use-auto-backup-boot.ts`
- Modify: `src/sections/shell/ShellRoute.tsx`(`LibraryShell`에서 3단계 `useSyncBoot()` 다음 줄에 `useAutoBackupBoot();`), `src/vite-env.d.ts`(`readonly VITE_AUTO_BACKUP_INTERVAL_MS?: string`)
- Test: `tests/unit/services/server-backup-auto.test.ts`, `tests/unit/services/server-backup-boot.test.ts`, `tests/unit/sections/server-backup/use-auto-backup-boot.test.tsx`

**Interfaces:**
- Consumes: Task 2 전부, 3단계 `SyncStatus`·`syncStatusAtom`·`readSyncMeta`·`deviceLabel`·`readBootFlag`·`loadSyncEngine`, Task 0 `getSharedSyncApi`, `LibraryStore`(`snapshot`), `startEffect`, `prefsAtom`, `hasLiveContent`·`libraryCounts`, `lazyChunk`.
- Produces(`auto-backup.ts`, 조각 `auto-backup`):
  ```ts
  export const AUTO_BACKUP_INTERVAL_MS = 86_400_000;
  export const AUTO_RETRY_MS = 3_600_000;
  export const AUTO_SHRINK_MIN = 20;
  export const AUTO_BACKUP_LOCK = 'tripmap:server-backup';
  /** 개발 모드에서만 VITE_AUTO_BACKUP_INTERVAL_MS(양의 정수)를 쓴다. 이 분기는 `import.meta.env.DEV &&` 안에 둔다. */
  export function autoBackupInterval(env?: Record<string, string | boolean | undefined>): number;
  /** 서버 places+trips가 20 이상이고 지금 값이 그 절반 미만인가. */
  export function shrunk(server: BackupCounts, current: LibraryCounts): boolean;
  export type AutoStep =
    | 'disabled' | 'not-synced' | 'waiting' | 'busy' | 'recent' | 'unchanged' | 'changed' | 'auth' | AutoOutcome;
  export type AutoBackupDeps = {
    api: BackupApi;
    storage: Storage;
    locks?: Pick<LockManager, 'request'>;
    now(): number;
    readLibrary(): Promise<{ raw: unknown; library: Library }>;
    prefs(): Prefs | null;
    syncUserId(): string | null;
    deviceId(): string;
    deviceLabel(): string;
    interval?: number;          // 기본 autoBackupInterval()
    build?: typeof buildSnapshot; // 시험용
  };
  /** 설계 §자동 백업 판단 표 1~15. 기록(`last`·`nextCheckAt`·`userId`)은 writeServerBackupLocal로. */
  export async function runAutoBackup(status: Pick<SyncStatus, 'phase'>, deps: AutoBackupDeps): Promise<AutoStep>;
  /** 엔진의 실행 끝마다 runAutoBackup. 붙일 때 current().phase가 synced면 한 번. 진행 중이면 그 사이 신호는 버린다. 떼는 함수를 돌려준다. */
  export function attachAutoBackup(
    engine: { onRunFinished(listener: (status: SyncStatus) => void): () => void },
    deps: AutoBackupDeps,
    current: () => Pick<SyncStatus, 'phase'>,
  ): () => void;
  /** 앱 기본 의존으로 한 번만 붙인다(두 번째 부름은 아무것도 안 함). 설정이 없으면(getSharedSyncApi() null) 아무것도 안 함. */
  export async function startAutoBackup(): Promise<void>;
  ```
  - 표 1~4는 잠금 밖(요청 없음), 5~15는 `deps.locks?.request(AUTO_BACKUP_LOCK, { ifAvailable: true }, async (lock) => lock === null ? 'busy' : …)` 안. `locks`가 없으면 잠금 없이.
  - 기록 규칙: 표의 "기록" 칸에 이름이 있으면 `last = { at: now, outcome }`. `nextCheckAt`은 표대로(`now`는 `deps.now()`, 7번은 `now + (interval - (reply.now - backup.createdAt))`).
  - 5번: 실패 이유가 `auth`·`not-allowed`면 `'auth'`를 돌려주고 기록·기한을 바꾸지 않는다. 그 밖은 `failed` + 1시간.
  - 12번 본문: `uploadBody(snapshot, { deviceId, deviceLabel }, 'auto', reply.backup?.id ?? null)`.
  - 기본 의존(`startAutoBackup`): `api = createBackupApi(getSharedSyncApi())`, `storage = localStorage`, `locks = navigator.locks`(없으면 undefined), `now = Date.now`, `readLibrary = () => startEffect(Effect.gen(function* () { const s = yield* (yield* LibraryStore).snapshot; return { raw: s.raw, library: s.library }; }))`, `prefs = () => getDefaultStore().get(prefsAtom)`, `syncUserId = () => readSyncMeta(localStorage).userId`, `deviceId = () => readSyncMeta(localStorage).deviceId`, `deviceLabel = () => deviceLabel(navigator.userAgent)`. 엔진은 `(await loadSyncEngine()).ensureLibrarySyncEngine()`, `current = () => getDefaultStore().get(syncStatusAtom)`.
- Produces(`boot.ts`, 첫 로딩 — 런타임 import는 `src/lib/lazy-chunk`, `src/services/library-sync/boot`, `./storage`만):
  ```ts
  /** 3단계 readBootFlag()가 참이고 로컬 auto가 참인가. 던지지 않는다. */
  export function readAutoBackupFlag(storage?: Storage): boolean;
  export const loadAutoBackup: () => Promise<typeof import('src/services/server-backup/auto-backup')>;
  export const loadServerBackupSection: () => Promise<typeof import('src/sections/server-backup/ServerBackupSection')>;
  ```
- Produces(`use-auto-backup-boot.ts`): `useAutoBackupBoot(): void` — 마운트 때 한 번 `readAutoBackupFlag()`가 참이면 `loadAutoBackup().then((m) => m.startAutoBackup()).catch(() => {})`.
- [ ] **Step 1: 실패하는 시험**
  - `server-backup-auto.test.ts`(가짜 `BackupApi`·메모리 `Storage`·고정 `now`): 표 1~15를 한 줄씩(돌려준 `AutoStep`, 저장된 `last`·`nextCheckAt`, `upload` 호출 여부와 본문의 `reason: 'auto'`·`ifMatch`), 2번(다른 사용자면 `nextCheckAt` 비우고 계속), 4번에서 `meta`를 부르지 않음, `shrunk` 경계(서버 19 → 거짓, 서버 20·지금 9 → 참, 지금 10 → 거짓), 잠금 `ifAvailable`에서 `null`이면 `'busy'`이고 요청 없음, `autoBackupInterval({ DEV: true, VITE_AUTO_BACKUP_INTERVAL_MS: '60000' }) === 60000`·`DEV: false`면 기본값·`'abc'`면 기본값. `attachAutoBackup`: 붙일 때 `synced`면 한 번, `local`이면 안 함, 리스너가 실행 중에 두 번 불려도 `runAutoBackup` 한 번, 떼면 더 안 부름.
  - `server-backup-boot.test.ts`: `readAutoBackupFlag` — 동기화 꺼짐(3단계 메타 `enabled: false`)이면 거짓, 켜짐+로컬 `auto: true`면 참, 저장소가 던지면 거짓.
  - `use-auto-backup-boot.test.tsx`(`vi.mock('src/services/server-backup/boot', …)`로 `loadAutoBackup`을 셈): 플래그 거짓이면 `loadAutoBackup` 0번, 참이면 1번·`startAutoBackup` 1번.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/server-backup-auto.test.ts tests/unit/services/server-backup-boot.test.ts tests/unit/sections/server-backup/use-auto-backup-boot.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`, `yarn build && yarn size --require-lazy auto-backup --require-lazy sync-engine`(`INEFFECTIVE_DYNAMIC_IMPORT`로 실패하면 정적 import를 찾아 없앤다)
- [ ] **Step 5:** 커밋 `feat(auto-backup): 앱을 열 때 하루 한 번 서버 백업을 새로 고치는 실행기`

### Task 4: 되살리기 대화상자 원격 모드

**Files:**
- Modify: `src/sections/backup/RestoreDialog.tsx`, `src/sections/backup/RestoreDialogHost.tsx`
- Test: `tests/unit/sections/backup/restore-remote.test.tsx`(기존 `tests/unit/sections/backup/*` 시험은 그대로 통과해야 한다)

**Interfaces:**
- Consumes: 기존 `ReadBackup`, `useBackupFile`, `useRestoreActions`, `hasLiveContent`.
- Produces:
  ```ts
  // RestoreDialog.tsx
  export type RemoteRestoreSource = {
    /** 대화상자 제목. 예: '서버 백업에서 되살리기' */
    title: string;
    /** 받는 동안 문구. 예: '서버 백업을 받는 중…' */
    loadingText: string;
    load(): Promise<{ ok: true; backup: ReadBackup; header: string } | { ok: false; message: string }>;
    /** 동기화가 켜져 있으면 "이 백업 뒤에 만든 장소·여행은 동기화로 다시 들어와요." 한 줄을 보인다 */
    syncNote: boolean;
  };
  export type RestoreDialogProps = { /* 기존 그대로 */ remote?: RemoteRestoreSource };
  ```
  동작(`remote`가 있을 때만, 없으면 지금과 한 글자도 다르지 않게):
  - 제목 `remote.title`. 파일 입력·`파일 고르기`·`PICK_HELP`를 그리지 않는다.
  - 열릴 때(기존 열기 초기화와 같은 자리, 실행 번호 규칙 그대로) `step = { kind: 'reading' }`이고 `remote.load()`를 부른다. 번호가 바뀌었으면 결과를 버린다. 성공이면 `preview`, 실패면 `readError = message`와 `다시 시도` 단추(같은 load를 다시). `remote`는 부모가 렌더마다 새 객체로 넘길 수 있으므로 **효과의 의존 배열에 넣지 않고** `useRef`로 최신 값을 읽는다(의존은 지금처럼 `[open, mode]`). 그래야 열려 있는 동안 load가 되풀이되지 않는다.
  - 읽는 중 문구는 `remote.loadingText`(`role="status"`).
  - 미리보기 머리 줄은 `header`. 나머지 미리보기 줄은 그대로.
  - `live`(살아 있는 항목이 있음)이면: 체크박스 `바꾸기 전에 지금 보관함을 파일로 받기`(MUI `FormControlLabel` + `Checkbox`, 열 때마다 참으로), 문구 `REMOTE_PREVIOUS_NOTE = "지금 보관함은 이 기기에 '되살리기 전 보관함'으로도 남아요. 설정 › 백업 › 되살리기 전으로 되돌리기로 돌아갈 수 있어요."`. `remote.syncNote`면 `REMOTE_SYNC_NOTE = '이 백업 뒤에 만든 장소·여행은 동기화로 다시 들어와요.'`.
  - `지금 보관함 먼저 받기` 단추는 원격 모드에서 그리지 않는다(체크박스가 대신한다).
  - `doReplace`: 원격이고 `live`이고 체크돼 있고 `downloaded === null`이면 **함수 첫 줄에서**(어떤 `await`보다 먼저) `const savedPromise = backupFile.save()`를 부른다(받기는 그 안에서 동기로 일어난다). 결과가 `null`이면 `error = { message: FILE_COPY_FAILED, downloadCurrent: false }`(`FILE_COPY_FAILED = '지금 보관함을 파일로 받지 못했어요. 체크를 풀고 바꾸거나 다시 해 주세요'`)로 멈춘다. 받았으면 `downloaded`를 그 값으로 두고 기존 `downloaded !== null` 갈래(`requirePrevious: false, savedText`)로 간다. 체크를 풀었으면 기존 규칙(`live`면 `requirePrevious: true`).
  - `replace`에는 `{ ...backup, exportedAt: null }`을 넘긴다(서버 백업은 파일이 아니라 `마지막 백업` 기록을 올리지 않는다).
  - `RestoreDialogHost`: `ShellDialog` 제목을 `props.remote?.title ?? '백업에서 되살리기'`로.
- [ ] **Step 1: 실패하는 시험** — `restore-remote.test.tsx`(기존 `restore-dialog` 시험의 렌더 도우미·저장소 설정을 본뜬다): 열면 `서버 백업을 받는 중…` → `load` 성공 → 머리 줄 `header`·`이 백업으로 바꾸기`; 파일 고르기 단추 없음; `load` 실패 → 문구와 `다시 시도` → 다시 부르면 성공; 닫았다 열면 앞 결과를 버림(느린 첫 load가 늦게 끝나도 미리보기가 바뀌지 않음); 살아 있는 보관함이면 체크박스가 기본 체크·두 안내 문구(`syncNote` 참일 때만 두 번째); 체크된 채 바꾸기 → `downloadText`(mock)가 `LibraryStore.replace`보다 먼저 불리고 `replace` 옵션이 `{ requirePrevious: false, savedText }`; 받기 실패(`downloadText`가 던짐) → 바꾸지 않고 `FILE_COPY_FAILED`; 체크 풀고 바꾸기 → `requirePrevious: true`; 성공 뒤 `backupMetaAtom.lastBackupAt`이 바뀌지 않음; 빈 보관함이면 체크박스 없음. 파일 모드 회귀: 기존 restore 시험 전부 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/backup` → 새 시험 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`, `yarn lint`
- [ ] **Step 5:** 커밋 `feat(auto-backup): 되살리기 대화상자 원격 모드와 바꾸기 전 파일 사본`

### Task 5: 설정 › 백업 › 서버 백업

**Files:**
- Create: `src/sections/server-backup/server-backup-copy.ts`, `src/sections/server-backup/ServerBackupSection.tsx`, `src/sections/server-backup/ServerBackupConfirmDialog.tsx`
- Modify: `src/sections/settings/SettingsPage.tsx`(`백업` 절 안, `BackupSection` 다음에 `syncFeatureVisible()`일 때만 지연 구역), `package.json` `build:ci`(`--require-lazy ServerBackupSection --require-lazy auto-backup` 추가; `folder-watch`는 Task 7)
- Test: `tests/unit/sections/server-backup/server-backup-section.test.tsx`, `tests/unit/sections/server-backup/server-backup-copy.test.ts`

**Interfaces:**
- Consumes: Task 2·3·4 전부(`loadAutoBackup`으로 `startAutoBackup`·`autoBackupInterval`을 받는다), 3단계 `readSession`·`readSyncMeta`·`readBootFlag`·`syncFeatureVisible`·`deviceLabel`, Task 0 `getSharedSyncApi`, `RestoreDialogHost`, `countsText`·`libraryCounts`·`formatLocalDateTime`·`calendarDaysAgo`·`hasLiveContent`, `LibraryStore`, `startEffect`, `prefsAtom`, `ChunkErrorBoundary`·`ChunkErrorNotice`.
- Produces(`server-backup-copy.ts`):
  ```ts
  export const SERVER_BACKUP_TITLE = '서버 백업';
  export const SIGNED_OUT = '로그인하면 서버에도 보관함 백업을 하나 둘 수 있어요';
  export const LOADING = '서버 백업을 확인하는 중…';
  export const CREATING = '서버 백업을 만드는 중…';
  export const NOTE = '서버 백업은 하나만 두고 새로 만들면 덮어써요. 암호화하지 않고 저장해요. 서버 장애에 대비해 백업 파일도 가끔 받아 두세요.';
  export const AUTO_LABEL = '자동 백업';
  export const AUTO_HELP = '이 기기에서 앱을 열 때, 마지막 서버 백업이 하루가 지났고 그 뒤로 바뀐 내용이 있으면 새로 올려요. 서버 백업은 하나만 두고 덮어써요.';
  export const AUTO_NEEDS_SYNC = '동기화를 켠 기기에서만 자동 백업을 할 수 있어요';
  export const NOT_WRITABLE = '지금은 서버 백업을 새로 만들 수 없어요';
  export const RESTORE_TITLE = '서버 백업에서 되살리기';
  export const RESTORE_LOADING = '서버 백업을 받는 중…';
  /** `서버 백업: 없음` / `서버 백업: 2026.10.29 15:12 (오늘) · 장소 120곳 · 라벨 8개 · 여행 3개 · iPhone · Safari · 자동` */
  export function metaLine(meta: ServerBackupMeta | null, now: Date): string;
  /** 되살리기 미리보기 머리 줄: `서버 백업 · 2026.10.29 15:12 · iPhone · Safari` */
  export function restoreHeader(meta: ServerBackupMeta): string;
  /** 설계 §오류·장애 표의 문구. action은 어느 단추에서 났는가 */
  export function failureText(reason: BackupFailure | BuildFailure | 'library', action: 'read' | 'write' | 'restore' | 'delete'): string;
  /** 설계 §자동 백업 켜기 4의 문구. `uploaded`는 `자동 백업: MM.DD HH:mm 올림` */
  export function autoOutcomeText(last: { at: number; outcome: AutoOutcome }): string;
  /** 덮어쓰기 확인이 필요한가(설계 §서버 백업 지금 만들기 4) — 필요하면 본문 문구, 아니면 null */
  export function overwriteConfirmText(meta: ServerBackupMeta | null, current: LibraryCounts, syncOn: boolean, now: Date): string | null;
  ```
  `failureText` 표(그 밖은 `'서버에 연결하지 못했어요'`): `auth` → `'동기화 로그인이 끊겼어요. 다시 로그인해 주세요'`, `not-allowed` → `'이 계정은 서버 백업을 쓸 수 없어요'`, `offline`·`server` → `read`면 `'서버 백업을 확인하지 못했어요'` 그 밖 `'서버에 연결하지 못했어요'`, `limit` → `restore`면 `'오늘은 서버 백업을 더 받을 수 없어요. 내일 다시 해 주세요'` 그 밖 `'오늘은 서버 백업을 더 만들 수 없어요. 내일 다시 해 주세요'`, `off` → `'지금은 서버 백업을 쓸 수 없어요'`, `too-large` → `'보관함이 커서 서버 백업을 만들 수 없어요. 백업 파일 받기를 이용해 주세요'`, `unsupported` → `'이 브라우저에서는 서버 백업을 만들 수 없어요'`, `changed` → `'서버 백업이 그사이 바뀌었어요. 창을 닫고 다시 열어 주세요'`, `not-found` → `'서버 백업이 없어요'`, `library` → `'보관함을 읽지 못해 서버 백업을 만들지 못했어요'`, `invalid` → `'서버 백업을 만들지 못했어요'`.
  `autoOutcomeText`: `uploaded` → `자동 백업: ${formatLocalDateTime(iso).slice(5)} 올림`(`MM.DD HH:mm`), `skipped-shrunk` → `"자동 백업 건너뜀: 장소·여행이 서버 백업보다 크게 줄었어요. 맞다면 '서버 백업 지금 만들기'를 눌러 주세요"`, `skipped-empty` → `'자동 백업 건너뜀: 보관함이 비어 있어요'`, `too-large` → `'자동 백업 못 함: 보관함이 커서 서버 백업을 만들 수 없어요'`, `unsupported` → `'자동 백업 못 함: 이 브라우저에서는 서버 백업을 만들 수 없어요'`, `off` → `'자동 백업 멈춤: 지금은 서버 백업을 쓸 수 없어요'`, `limit` → `'자동 백업 멈춤: 오늘 서버 백업 한도를 넘었어요'`, `failed` → `'자동 백업 실패: 다음에 앱을 열 때 다시 해요'`.
- Produces(`ServerBackupConfirmDialog.tsx`): `ServerBackupConfirmDialog({ open, title, body, confirmLabel, onConfirm, onClose, busy })` — `Dialog` + `DialogTitle` + 본문 `Typography` + `취소`·확인 단추(`minHeight: 44`), `busy`면 둘 다 끄고 닫히지 않음.
- Produces(`ServerBackupSection.tsx`, 이름 있는 내보내기 `ServerBackupSection`, props 없음): 설계 §화면 상태 표 그대로.
  - 세션 판단: `readSession(localStorage) === null`이면 로그인 전 화면(`SIGNED_OUT` + `Button component={Link} to="/settings#sync"` `동기화에서 로그인`).
  - 세션이 있으면 `createBackupApi(getSharedSyncApi()!)`로 마운트 때 `meta()`. 결과에 따라 `metaLine` 또는 `failureText(reason, 'read')`(+ `auth`면 로그인 단추, 그 밖은 `다시 시도`).
  - `서버 백업 지금 만들기`(contained, `!writable`이나 진행 중이면 꺼짐): 보관함 스냅샷을 `startEffect`로 읽음(실패 `library`) → `overwriteConfirmText(meta, libraryCounts(library), readBootFlag(), new Date())`가 문자열이면 확인 대화상자(제목 `서버 백업 바꾸기`, 확인 `바꾸기`) → `buildSnapshot` → `upload(uploadBody(s, { deviceId: readSyncMeta(localStorage).deviceId, deviceLabel: deviceLabel(navigator.userAgent) }, 'manual'))` → 성공: 토스트 `서버 백업을 만들었어요 (${countsText(counts)})`, 줄 갱신, 로컬 기록 `nextCheckAt = Date.now() + (await loadAutoBackup()).autoBackupInterval()`. 실패: `role="alert"` 문구 `failureText(reason, 'write')`.
  - `서버 백업에서 되살리기`(outlined, 백업 없으면 꺼짐) → 이 구역 안의 `RestoreDialogHost`를 `mode="normal"`, `remote={{ title: RESTORE_TITLE, loadingText: RESTORE_LOADING, syncNote: readBootFlag(), load }}`로 연다. `load` = `download(meta.id)` → 실패 `{ ok: false, message: failureText(reason, 'restore') }` → `readSnapshotData(data)` → 실패 `{ ok: false, message: BACKUP_READ_MESSAGES[error] }` → 성공 `{ ok: true, backup, header: restoreHeader(meta) }`.
  - `서버 백업 지우기`(text, 백업 있을 때만) → 확인 대화상자(제목 `서버 백업 지우기`, 본문 `'서버 백업을 지울까요? 이 기기 보관함과 백업 파일은 그대로예요.'` + 자동이 켜져 있으면 `' 자동 백업이 켜져 있어 다음에 다시 만들어요.'`, 확인 `지우기`) → `remove()` → 토스트 `서버 백업을 지웠어요`, 줄 `서버 백업: 없음`.
  - 자동 백업: MUI `FormControlLabel` + `Switch`(라벨 `AUTO_LABEL`), 설명 `AUTO_HELP`. `readBootFlag()` 거짓이면 꺼짐 + `AUTO_NEEDS_SYNC`. 켜면 로컬 `{ ...local, auto: true, userId: readSyncMeta(localStorage).userId }`를 쓰고 `loadAutoBackup().then((m) => m.startAutoBackup())`. 끄면 `auto: false`(실행기는 다음 판단의 1번에서 멈춘다). `last`가 있으면 그 아래 `autoOutcomeText(last)`. `SERVER_BACKUP_EVENT`를 들어 로컬 기록을 다시 읽는다.
  - `RemoteRestoreSource`는 `import type`으로만 가져온다(`RestoreDialog`는 `loadRestoreDialog`로 나뉜 조각이라 값으로 가져오면 `INEFFECTIVE_DYNAMIC_IMPORT`로 빌드가 실패한다). `RestoreDialogHost`는 값으로 가져와도 된다.
  - 모든 단추 `minHeight: 44`, 설명은 `var(--tm-text-secondary)`, 기존 `BackupSection`과 같은 `Typography variant="body2"`·`Box display flex wrap gap 1`. 구역 머리는 `Typography component="h3"`(`fontSize: 14, fontWeight: 700`) `서버 백업`, 바깥 `Box component="section" id="server-backup" aria-label="서버 백업"`.
  - `SettingsPage`: 모듈 위에 `const ServerBackupSection = lazy(() => loadServerBackupSection().then((m) => ({ default: m.ServerBackupSection })));`, `백업` 절 안 `BackupSection` 다음에 `{syncFeatureVisible() && (<ChunkErrorBoundary fallback={<ChunkErrorNotice />}><Suspense fallback={null}><ServerBackupSection /></Suspense></ChunkErrorBoundary>)}`.
- [ ] **Step 1: 실패하는 시험**
  - `server-backup-copy.test.ts`: `metaLine`(없음, 오늘, 3일 전, 약속 있음, `· 자동`), `restoreHeader`, `failureText` 표 전부, `autoOutcomeText` 8개, `overwriteConfirmText`(백업 없음 null, 동기화 꺼짐이면 문자열, 켜짐이고 서버 20·지금 9면 줄어듦 문구 포함, 켜짐이고 비슷하면 null).
  - `server-backup-section.test.tsx`(`vi.mock`으로 `getSharedSyncApi`·`createBackupApi`·`buildSnapshot`·`loadAutoBackup`·3단계 `readSession`/`readBootFlag`를 바꿈, `downloadText`·`sonner` mock): 빌드 변수 없으면 `SettingsPage`에 `서버 백업` 구역 없음; 세션 없음 → 로그인 안내; 메타 없음 → `서버 백업: 없음`·되살리기 꺼짐·지우기 없음; 있음 → 줄 문구·세 단추; `writable: false` → 만들기 꺼짐 + `NOT_WRITABLE`; 만들기 성공 → `upload` 본문 `reason: 'manual'`·`ifMatch` 키 없음·토스트·줄 갱신·로컬 `nextCheckAt` 기록; 동기화 꺼짐+백업 있음 → 확인 대화상자 → `취소`면 `upload` 0번 → `바꾸기`면 1번; `too-large` → 문구; 401 → 로그인 안내; 되살리기 → 대화상자 제목 `서버 백업에서 되살리기`·`download`가 메타 id로 불림; 지우기 확인 → `remove` → `없음`; 자동 스위치: 동기화 꺼짐이면 disabled·안내, 켜면 로컬 `auto: true`·`startAutoBackup` 호출, `last`가 있으면 결과 문구.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/server-backup` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`, `yarn lint`, `yarn vitest run tests/unit/sections/settings`(기존 설정 시험), `yarn build && yarn size --require-lazy ServerBackupSection --require-lazy auto-backup --require-lazy SettingsPage`
- [ ] **Step 5:** 커밋 `feat(auto-backup): 설정 서버 백업 구역(만들기·되살리기·지우기·자동)`

### Task 6: 폴더 변경 알림 — 상태·확인 실행기·부트

**Files:**
- Create: `src/services/folder-watch/state.ts`, `src/services/folder-watch/boot.ts`, `src/services/folder-watch/folder-watch.ts`, `src/stores/folder-watch.ts`, `src/sections/folder-watch/use-folder-watch-boot.ts`
- Modify: `src/sections/shell/ShellRoute.tsx`(`useAutoBackupBoot();` 다음 줄에 `useFolderWatchBoot();`)
- Test: `tests/unit/services/folder-watch-state.test.ts`, `tests/unit/services/folder-watch.test.ts`, `tests/unit/stores/folder-watch.test.ts`, `tests/unit/sections/folder-watch/use-folder-watch-boot.test.tsx`

**Interfaces:**
- Consumes: `planFolderSync`(`src/domain/library/folder-links.ts`), `FolderItem`(`src/domain/library/add-place.ts`), `PlaceLookup`·`PlaceLookupError`(`src/services/place-lookup.ts`, `src/services/errors.ts`), `startEffect`, `libraryAtom`, `openFolderSyncAtom`(`src/stores/add-place.ts`), `paths.labels`, `hashItem`(3단계), `lazyChunk`, `browserStorage`, `localDate`(`src/lib/local-date.ts`), `formatLocalDateTime`.
- Produces(`state.ts`, 첫 로딩 — **런타임 import 없음, `Library`·`FolderLink`는 `import type`**):
  ```ts
  export const FOLDER_WATCH_KEY = 'tripmap:folder-watch:v1';
  export const FOLDER_WATCH_INTERVAL_MS = 86_400_000;
  export const FOLDER_WATCH_MAX_PER_RUN = 5;
  export const FOLDER_WATCH_MAX_MANUAL = 20;
  export const FOLDER_WATCH_MANUAL_GAP_MS = 60_000;
  export const FOLDER_WATCH_DELAY_MS = 3_000;
  export const FOLDER_WATCH_LOCK = 'tripmap:folder-watch';
  export type FolderWatchEntry = {
    checkedAt: number; fresh: number; missing: number;
    signature: string | null; notified: string | null; error: 'not-found' | null;
  };
  export type FolderWatchState = {
    v: 1; enabled: boolean; lastRunAt: number | null; lastManualAt: number | null;
    folders: Record<string, FolderWatchEntry>;
  };
  export const EMPTY_FOLDER_WATCH: FolderWatchState; // enabled: true, 나머지 null·{}
  export function readFolderWatch(storage: Storage | undefined): FolderWatchState; // 깨지면 EMPTY 사본(항목 하나가 깨지면 그 항목만 버림)
  export function writeFolderWatch(storage: Storage | undefined, state: FolderWatchState): void; // 실패는 console.warn
  /** 살아 있고 가리키는 라벨도 살아 있는 연결의 shareId(`liveFolderLink`와 같은 뜻을 import 없이). */
  export function liveLinkIds(lib: Library): string[];
  /**
   * 확인할 연결: 기준 = max(entry.checkedAt ?? 0, Date.parse(link.checkedAt)).
   * ignoreInterval이 아니면 now - 기준 >= interval인 것만. 기준이 이른 순(같으면 shareId 순), 앞에서 max개.
   */
  export function dueFolders(
    lib: Library, state: FolderWatchState, now: number,
    opts?: { interval?: number; max?: number; ignoreInterval?: boolean },
  ): string[];
  ```
- Produces(`boot.ts`, 첫 로딩): `export const loadFolderWatch = lazyChunk(() => import('src/services/folder-watch/folder-watch'));`
- Produces(`folder-watch.ts`, 조각 `folder-watch`):
  ```ts
  export type FolderLookup = (shareId: string) => Promise<{ ok: true; items: readonly FolderItem[] } | { ok: false; code: string }>;
  export type FolderChange = { shareId: string; name: string; fresh: number; missing: number };
  export type FolderWatchRun = { checked: number; changes: FolderChange[]; skipped?: 'disabled' | 'busy' | 'gap' | 'none' };
  export type FolderWatchDeps = {
    storage: Storage | undefined;
    library(): Library;
    lookup: FolderLookup;
    now(): number;
    locks?: Pick<LockManager, 'request'>;
    /** 상태를 쓸 때마다(화면 atom 갱신) */
    onState?(state: FolderWatchState): void;
  };
  /** hashItem([새 sid 정렬, 빠진 sid 정렬]) */
  export function folderSignature(freshSids: readonly string[], missingSids: readonly string[]): string;
  /** 설계 §네이버 폴더 변경 알림 1~4·6. 토스트는 띄우지 않고 바뀐 것만 돌려준다. */
  export async function runFolderWatch(deps: FolderWatchDeps, opts?: { manual?: boolean }): Promise<FolderWatchRun>;
  /** 설계 §4의 토스트 문구 */
  export function changeMessage(changes: readonly FolderChange[]): string;
  /** 기본 의존(PlaceLookup·libraryAtom·localStorage·navigator.locks)으로 돌리고 토스트를 띄운다. */
  export async function startFolderWatch(opts: { navigate(path: string): void; manual?: boolean }): Promise<FolderWatchRun>;
  /** 개발 모드에서만 window.__landmarkDev.forgetFolderSids(shareId, count)를 단다. 운영 번들에는 본문이 없다(`if (!import.meta.env.DEV) return;`). */
  export function installFolderWatchDevTools(): void;
  ```
  - `runFolderWatch`: `state = readFolderWatch(storage)` → `!manual && !enabled`면 `disabled` → `manual && lastManualAt !== null && now - lastManualAt < FOLDER_WATCH_MANUAL_GAP_MS`면 `gap` → `ids = dueFolders(library(), state, now, manual ? { ignoreInterval: true, max: FOLDER_WATCH_MAX_MANUAL } : { max: FOLDER_WATCH_MAX_PER_RUN })`, 비면 `none`(수동이면 `lastManualAt`은 기록) → `locks?.request(FOLDER_WATCH_LOCK, { ifAvailable: true }, …)`가 `null`이면 `busy` → 폴더마다 차례로: 그 순간의 `library()`에서 연결을 다시 읽어(그사이 끊겼으면 건너뜀) `lookup` → 성공이면 `plan = planFolderSync(lib, link, items)`, `fresh = plan.fresh.length`, `missing = plan.missing.length`, `signature = folderSignature(plan.fresh.map((f) => f.item.sid), plan.missing.map((m) => m.sid))`, `notified = prev?.notified ?? null`, `fresh + missing > 0 && signature !== notified`면 바뀐 것에 넣고 `notified = signature`; `code === 'NOT_FOUND'`면 `{ checkedAt: now, fresh: 0, missing: 0, signature: null, notified: prev?.notified ?? null, error: 'not-found' }`; 그 밖 실패면 `{ ...(prev ?? 0인 항목), checkedAt: now }`. 폴더 하나마다 상태를 쓰고 `onState`. 끝에 `lastRunAt = now`(수동이면 `lastManualAt = now`도). 살아 있지 않은 연결의 항목은 지운다.
  - `changeMessage`: 하나이고 `fresh > 0` → `` `‘${name}’ 폴더에 새로 저장한 곳이 ${fresh}곳 있어요` `` + (`missing > 0`이면 `` ` · 빠진 곳 ${missing}곳` ``); 하나이고 `fresh === 0` → `` `‘${name}’ 폴더에서 빠진 곳이 ${missing}곳 있어요` ``; 여럿 → `` `네이버 폴더 ${n}개가 바뀌었어요` `` + (새 곳 합 > 0이면 `` ` (새로 저장한 곳 ${합}곳)` ``). 이름이 비면 `이름 없는 폴더`.
  - `startFolderWatch`: `lookup = (id) => startEffect(Effect.gen(function* () { const r = yield* (yield* PlaceLookup).lookupFolder(id); return { ok: true as const, items: r.places }; }).pipe(Effect.catch((e) => Effect.succeed({ ok: false as const, code: e instanceof PlaceLookupError ? e.code : 'UNKNOWN' }))))`(캐시 사용: `fresh` 옵션 없음). `onState = (s) => getDefaultStore().set(folderWatchAtom, s)`. 바뀐 것이 하나면 `toast(changeMessage(c), { action: { label: '가져오기', onClick: () => getDefaultStore().set(openFolderSyncAtom, c[0].shareId, null) } })`, 여럿이면 `{ label: '보기', onClick: () => opts.navigate(paths.labels) }`. 수동이고 바뀐 것이 없고 `skipped`가 없으면 `toast('바뀐 네이버 폴더가 없어요')`, `gap`이면 `toast('잠시 뒤에 다시 확인해 주세요')`.
  - `installFolderWatchDevTools`: `window.__landmarkDev = { ...window.__landmarkDev, forgetFolderSids }` — `forgetFolderSids(shareId: string, count = 1)`는 `LibraryStore.update`로 그 연결의 `seenSids`에서 뒤 `count`개를 빼고(`setField`, 지금 시각), `checkedAt`은 그대로 둔다. 같은 탭 `libraryAtom`도 바꾼다(`reflectSaved` 또는 기존 `useLibraryAction`과 같은 길). 개발 중 "새로 저장한 곳"을 흉내 낸다.
- Produces(`src/stores/folder-watch.ts`, 런타임 import는 `jotai`·`jotai/utils`·`src/services/folder-watch/state`·`src/services/browser-storage`·`src/lib/local-date`만):
  ```ts
  export const folderWatchAtom: PrimitiveAtom<FolderWatchState>; // atomWithLazy(() => readFolderWatch(browserStorage()))
  export const setFolderWatchEnabledAtom: WritableAtom<null, [boolean], void>; // 상태를 쓰고 atom 갱신
  export type FolderNotice = { fresh: number; missing: number; checkedAt: number; notFound: boolean };
  /** 기록이 없거나 기록 checkedAt <= Date.parse(link.checkedAt)이거나 (오류 없이) fresh+missing === 0이면 null */
  export function folderNotice(link: FolderLink, entry: FolderWatchEntry | undefined): FolderNotice | null;
  /** 라벨 줄 꼬리: 새 곳 합 > 0 → ` · 새로 저장한 곳 N곳`, 아니면 빠진 곳 합 > 0 → ` · 폴더에서 빠진 곳 N곳`, 아니면 null(찾지 못함은 줄에 안 보임) */
  export function labelNoticeText(notices: readonly (FolderNotice | null)[]): string | null;
  /** 라벨 고치기 한 줄: notFound → '마지막 확인 때 폴더를 찾지 못했어요. 네이버에서 공유를 껐을 수 있어요';
   *  둘 다 → `네이버에 새로 저장한 곳 ${f}곳 · 빠진 곳 ${m}곳 (${MM.DD} 확인)`, 새 곳만 → `네이버에 새로 저장한 곳 ${f}곳 (${MM.DD} 확인)`,
   *  빠진 곳만 → `네이버 폴더에서 빠진 곳 ${m}곳 (${MM.DD} 확인)`. MM.DD = localDate(iso).slice(5) */
  export function folderNoticeText(notice: FolderNotice): string;
  ```
- Produces(`use-folder-watch-boot.ts`): `useFolderWatchBoot(): void` — `useStore()`·`useNavigate()`. 마운트 때 `FOLDER_WATCH_DELAY_MS` 뒤(`setTimeout`) 그리고 `visibilitychange`로 보일 때마다 `tryRun()`: `readFolderWatch(browserStorage())`가 `enabled`이고 `navigator.onLine`이고 `navigator.connection?.saveData !== true`이고 `dueFolders(store.get(libraryAtom), state, Date.now(), { max: FOLDER_WATCH_MAX_PER_RUN }).length > 0`이며 이 훅이 지금 돌리는 중이 아니면 `loadFolderWatch().then((m) => m.startFolderWatch({ navigate: (p) => void navigate(p) })).catch(() => {})`. 언마운트 때 타이머·구독 해제. `import.meta.env.DEV`면 마운트 때 `loadFolderWatch().then((m) => m.installFolderWatchDevTools())`.
- [ ] **Step 1: 실패하는 시험**
  - `folder-watch-state.test.ts`: 읽기(없음·깨짐·항목 하나 깨짐), `liveLinkIds`(지운 연결·지운 라벨 제외), `dueFolders`(연결 `checkedAt` 2일 전·기록 없음 → 포함, 연결 1시간 전 → 제외, 기록 1시간 전 → 제외, 기록 2일 전·연결 3일 전 → 포함, 7개 중 오래된 5개 순서, `ignoreInterval`·`max: 20`).
  - `folder-watch.test.ts`(가짜 `lookup`·메모리 저장소·고정 `now`, 보관함은 `recordFolderLink`로 만든 연결 + `naver-folder.json` fixture의 3곳): 새 곳 1 → 바뀐 것 1·`fresh 1`·`notified` 기록, 같은 응답으로 다음 날 다시 → 바뀐 것 0(서명 같음)·`checkedAt` 갱신, 새 곳 2로 늘면 다시 1, 빠진 곳만, `NOT_FOUND` → `error`·바뀐 것 0, `OFFLINE` → 앞 기록 유지·`checkedAt`만, 꺼짐 → `disabled`·`lookup` 0번, 수동은 꺼져 있어도 돌고 1분 안 두 번째는 `gap`, 잠금 `null` → `busy`, 확인 중 연결이 끊기면 건너뜀, 끊긴 연결의 항목 정리, `changeMessage` 네 모양, 조회가 `fresh` 없이 불림(`startFolderWatch`의 `lookup`을 `PlaceLookup.layerWith({ fetch })`로 감싸 주소에 `fresh`가 없음을 확인하는 시험 하나).
  - `stores/folder-watch.test.ts`: `folderNotice` 네 조건, `labelNoticeText`(합·빠진 곳만·찾지 못함만이면 null), `folderNoticeText` 네 모양.
  - `use-folder-watch-boot.test.tsx`(`vi.mock('src/services/folder-watch/boot')`, 가짜 타이머): 꺼짐·오프라인·기한 없음이면 `loadFolderWatch` 0번, 기한 있으면 3초 뒤 1번, 보이기 이벤트에 다시 판단, 언마운트 뒤 타이머 없음.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/folder-watch-state.test.ts tests/unit/services/folder-watch.test.ts tests/unit/stores/folder-watch.test.ts tests/unit/sections/folder-watch` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`, `yarn build && yarn size --require-lazy folder-watch`
- [ ] **Step 5:** 커밋 `feat(folder-watch): 앱을 열 때 하루 한 번 네이버 폴더 변경 확인`

### Task 7: 폴더 변경 알림 — 화면

**Files:**
- Create: `src/sections/folder-watch/FolderWatchSetting.tsx`
- Modify: `src/sections/labels/LabelsPage.tsx`(줄 꼬리), `src/sections/labels/LabelEditor.tsx`(폴더 구역 한 줄), `src/sections/settings/SettingsPage.tsx`(`가져오기` 절 끝에 `<FolderWatchSetting />`), `package.json` `build:ci`(`--require-lazy folder-watch`)
- Test: 기존 `tests/unit/sections/labels/labels-page.test.tsx`에 사례 추가, `tests/unit/sections/folder-watch/folder-watch-setting.test.tsx`

**Interfaces:**
- Consumes: Task 6 전부, `folderLinksOfLabel`, `localDate`·`formatLocalDateTime`.
- Produces:
  - `LabelsPage`: `const watch = useAtomValue(folderWatchAtom)`. 줄마다 `notice = labelNoticeText(folders.get(id).map((l) => folderNotice(l, watch.folders[l.shareId])))`. `RowProps`에 `notice: string | null`. 개수 글자를 `` linked ? `장소 ${count}곳 · 네이버 폴더${notice ?? ''}` : `장소 ${count}곳` ``로.
  - `LabelEditor`: `Props`에 `notices: ReadonlyMap<string, FolderNotice | null>`(없으면 빈 Map). `FolderSection`의 날짜 줄 아래, notice가 있으면 `Box sx={{ fontSize: 13, fontWeight: 700 }}`로 `folderNoticeText(notice)`. `LabelsPage`가 열린 라벨의 연결마다 `folderNotice`로 채워 넘긴다.
  - `FolderWatchSetting()`: `useAtomValue(folderWatchAtom)`, `useSetAtom(setFolderWatchEnabledAtom)`, `useAtomValue(libraryAtom)`. MUI `FormControlLabel` + `Switch` 라벨 `네이버 폴더 변경 알림`, 설명 `앱을 열 때 하루 한 번, 가져온 네이버 폴더에 새로 저장한 곳이 있는지 확인해요`(`var(--tm-text-secondary)`). `liveLinkIds(library).length > 0`이면 `지금 확인`(outlined, `minHeight: 44`, 진행 중 꺼짐) → `loadFolderWatch().then((m) => m.startFolderWatch({ navigate, manual: true }))`. `state.lastRunAt`이 있으면 `` `마지막 확인 ${formatLocalDateTime(new Date(lastRunAt).toISOString()).slice(5)}` ``.
- [ ] **Step 1: 실패하는 시험** — labels-page: 기록이 연결보다 늦고 새 곳 2 → 줄 이름에 `장소 3곳 · 네이버 폴더 · 새로 저장한 곳 2곳`, 기록이 연결보다 이르면 꼬리 없음, 빠진 곳만 → `· 폴더에서 빠진 곳 1곳`, 편집기 구역에 `네이버에 새로 저장한 곳 2곳 · 빠진 곳 1곳 (MM.DD 확인)`, `not-found` → 찾지 못함 문구(줄 꼬리 없음). 기존 단언(`/장소 3곳 · 네이버 폴더/` 같은 정규식)은 그대로 통과. folder-watch-setting: 스위치 기본 켜짐·끄면 저장소 `enabled: false`, 연결 없으면 `지금 확인` 없음, 누르면 `startFolderWatch({ manual: true })`(`vi.mock('src/services/folder-watch/boot')`), 마지막 확인 문구.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/labels tests/unit/sections/folder-watch tests/unit/sections/settings` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`, `yarn lint`, `yarn build && yarn size --require-lazy folder-watch --require-lazy LabelsPage --require-lazy SettingsPage`
- [ ] **Step 5:** 커밋 `feat(folder-watch): 라벨 관리·설정에 네이버 폴더 변경 표시`

### Task 8: E2E — 서버 백업·폴더 변경 알림

**Files:**
- Create: `tests/e2e/server-backup.spec.ts`, `tests/e2e/folder-watch.spec.ts`
- Modify: `playwright.config.ts`(desktop `testMatch`에 `'server-backup.spec.ts'`, `'folder-watch.spec.ts'`), `tests/e2e/sync-server.ts`(`createSyncServer()`의 반환에 `db`가 없으면 더한다. 3단계 시험은 그대로 통과해야 한다)
- Test: 위 spec

**Interfaces:**
- Consumes: 3단계 `createSyncServer`·`installSyncServer`·`tests/e2e/library-sync.spec.ts`의 로그인 선택자, `seedStorage`·`LIBRARY_KEY`(`tests/e2e/fixtures.ts`), `tests/e2e/folder-resync.spec.ts`의 폴더 가져오기 단계와 fixture(`naver-folder.json`·`naver-folder-more.json`·`place-folder.json`).
- Produces:
  - `server-backup.spec.ts` `@desktop` 시험 하나(`@smoke` 없음):
    1. `server = createSyncServer()`, `installSyncServer(context, server)`. 시드 보관함으로 `/settings` → 3단계 spec 1단계와 같은 선택자로 `카카오로 로그인` → 가짜 화면 계정 `me`·`정상 로그인`·`계속` → `올리기` → `동기화 완료`.
    2. `서버 백업` 구역의 `서버 백업: 없음` → `서버 백업 지금 만들기` → 토스트 `서버 백업을 만들었어요` → `서버 백업: … · 장소 N곳`(N = 시드 장소 수).
    3. `/`에서 시드 장소 하나(`placeIdByName` 대상)를 지운다(기존 장소 지우기 흐름) → `/settings` → `서버 백업에서 되살리기` → 대화상자 `서버 백업에서 되살리기` → `서버 백업 · ` 머리 줄 → `바꾸기 전에 지금 보관함을 파일로 받기`가 체크됨 → `const download = page.waitForEvent('download')` → `이 백업으로 바꾸기` → `await download`(파일 이름 `landmark-backup-…json`) → 토스트 `백업에서 되살렸어요` → `/`에 지운 장소가 다시 보임.
    4. `자동 백업` 스위치 켜기(켜자마자 한 번 판단하지만 서버 백업이 방금 것이라 `recent`로 끝나고 로컬 `nextCheckAt`이 약 24시간 뒤로 잡힌다) → `server.db.prepare('UPDATE library_backups SET created_at = created_at - 90000000').run()` → `page.evaluate`로 `localStorage['tripmap:server-backup:v1']`의 `nextCheckAt`을 `null`로(로컬 기한이 서버 시각 변경을 가리지 않게) → 장소 메모를 `자동 백업 시험`으로 저장 → `page.reload()` → `/settings` → `서버 백업: … · 자동`이 보일 때까지(최대 10초) → DB `SELECT reason FROM library_backups`가 `auto`.
    5. `서버 백업 지우기` → 확인 `지우기` → `서버 백업: 없음`.
  - `folder-watch.spec.ts` `@desktop` 시험 둘(`@smoke` 없음). 공통 준비: `folder-resync.spec.ts` 1~2단계와 같이 `/api/place`·`/api/naver-folder`를 가로채고(요청 질의 `share`·`fresh`를 모음) 빈 보관함에서 폴더 링크로 3곳을 가져온다. 그다음 `page.evaluate`로 `localStorage[LIBRARY_KEY]`의 `folders[<shareId>].checkedAt`을 사흘 전 ISO로 바꾸고, 응답을 `naver-folder-more.json`(4곳)으로 바꾼다.
    1. 토스트에서 가져오기: `/`에서 `page.reload()` → 토스트 `‘속초, 고성, 양양 맛집’ 폴더에 새로 저장한 곳이 1곳 있어요` → 확인 요청(새로고침 뒤 첫 `/api/naver-folder`)의 `fresh`가 `null` → 토스트 `가져오기` → `새로 저장한 곳 1 · 그대로 3 · 폴더에서 빠진 곳 0` → `1곳 가져오기` → `1곳을 새로 넣었어요` → `/labels` 줄 이름이 `/장소 4곳 · 네이버 폴더$/`(꼬리 없음).
    2. 라벨 관리 표시: `/labels`에서 `page.reload()` → 토스트가 뜬 뒤 줄 이름에 `장소 3곳 · 네이버 폴더 · 새로 저장한 곳 1곳` → 줄을 눌러 편집기 `네이버에 새로 저장한 곳 1곳` → `/settings` → `네이버 폴더 변경 알림` 스위치 끄기 → `page.evaluate`로 `tripmap:folder-watch:v1`의 `folders`를 `{}`로 비우고(`enabled: false`는 남김) 연결 `checkedAt`을 다시 사흘 전으로(둘 다 해야 기한이 된다) → 요청 기록을 비우고 `page.reload()` 뒤 5초 동안 새 `/api/naver-folder` 요청 0 → 스위치를 다시 켜고 `page.reload()` → 요청 1 이상(꺼짐만이 막았음을 확인).
- [ ] **Step 1:** 시험 작성
- [ ] **Step 2:** `E2E_PORT=4186 E2E_MAP_PORT=4187 yarn test:e2e tests/e2e/server-backup.spec.ts tests/e2e/folder-watch.spec.ts --project desktop` → 처음엔 실패(문구·선택자 맞춤) → 고쳐 통과. 포트를 열 수 없으면 실행을 건너뛰고 보고에 적는다.
- [ ] **Step 3:** 기존 E2E 영향: `E2E_PORT=4186 E2E_MAP_PORT=4187 yarn test:e2e tests/e2e/folder-resync.spec.ts tests/e2e/backup-restore.spec.ts tests/e2e/library-sync.spec.ts` 그리고 `E2E_PORT=4186 E2E_MAP_PORT=4187 yarn test:e2e:ci`. 폴더 알림이 다른 시험에 토스트를 더할 수 있다: 시드 보관함에 폴더 연결이 있는 시험이 깨지면 그 시험이 아니라 시드의 연결 `checkedAt` 때문인지 보고, 필요하면 `tests/e2e/fixtures.ts`의 `seedStorage`에 `tripmap:folder-watch:v1`을 `{"v":1,"enabled":false,…}`로 넣는 선택 인자 `folderWatch?: boolean`(기본 그대로)을 더해 그 시험에서만 끈다(기존 단언은 바꾸지 않는다).
- [ ] **Step 4:** 커밋 `test(auto-backup): 서버 백업·폴더 변경 알림 E2E`

### Task 9: 로컬 실행·문서·도움말·마무리 검증

**Files:**
- Modify: `docs/development.md`(3단계 동기화 절 뒤에 새 절 "서버 백업과 네이버 폴더 변경 알림", 환경 변수 표에 `AUTO_BACKUP`·`VITE_AUTO_BACKUP_INTERVAL_MS` 줄), `src/sections/help/help-content.ts`·`docs/help/settings.md`(설정 팁 한 줄), `src/sections/help/help-content.ts`·`docs/help/labels.md`(라벨 팁 한 줄), `README.md`(기능 목록 한 줄)
- Test: 전체 검증

**Interfaces:**
- Produces:
  - `docs/development.md` 새 절 내용(기존 줄은 바꾸지 않음):
    - 무엇·설계 문서 링크. Pages 변수 `AUTO_BACKUP`(끌 때만 `off`: 쓰기만 503, 읽기·지우기 됨). D1 표 이름 `library_backups`·`library_backup_parts`, 스키마 6.
    - **로컬에서 키 없이 해 보기(서버 백업)**: `SYNC_VITE_PORT=4188 SYNC_DEV_PORT=8796 VITE_AUTO_BACKUP_INTERVAL_MS=60000 yarn dev:sync` → 기기 A `http://localhost:8796` → 설정 › 동기화 › `카카오로 로그인`(가짜, 계정 `me`) → `올리기` → 설정 › 백업 › `서버 백업 지금 만들기` → 기기 B `http://127.0.0.1:8796`에서 같은 로그인 → `서버 보관함 받기` → 장소 하나 지우기 → `서버 백업에서 되살리기`. 자동 백업: A에서 `자동 백업` 켜기 → 메모를 고치고 1분 뒤 새로고침 → 서버 백업 줄의 `· 자동`. 쓰기 끄기 시험: 위 `dev:sync`와 같은 `wrangler pages dev` 명령에 `--binding AUTO_BACKUP=off`를 더해 직접 실행(명령 전체를 적는다: `yarn build:viewer && VITE_SYNC_DEV_FAKE=1 wrangler pages dev --d1 DB --port 8796 --binding SYNC_DEV_FAKE_SOCIAL=1 --binding ALLOWED_ACCOUNTS=kakao:dev-me,naver:dev-me --binding AUTO_BACKUP=off --proxy 4188 -- vite --port 4188 --strictPort`. 3단계 `dev:sync` 스크립트가 다르면 그 스크립트에 `--binding AUTO_BACKUP=off`만 더한 모양으로).
    - **폴더 변경 알림 해 보기**: 네트워크가 되는 `yarn dev:full` 또는 위 `dev:sync`에서 아무 공개 네이버 폴더 공유 링크를 ＋ › `네이버 폴더 가져오기`로 가져온다 → 브라우저 콘솔 `__landmarkDev.forgetFolderSids('<공유 ID>', 2)`(개발 모드에서만 있음) → 설정 › 가져오기 › `지금 확인` → 토스트·라벨 관리 표시. 하루 기한 확인은 `localStorage['tripmap:folder-watch:v1']`을 지우고 연결의 `checkedAt`이 하루 지나야 한다는 점을 적는다.
    - API 표(설계 §API를 줄여 옮김), 하루 한도(쓰기 20·읽기 200), 크기(압축 1 MiB·조각 512 KiB·본문 1.5MB), 원격 확인 명령(읽기 전용) `npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta"` → `6`.
  - 도움말 설정 팁(`HELP_PAGES` `settings`의 `tips` 끝과 `docs/help/settings.md` `## 알아 두면 좋아요` 끝에 같은 문장): `'동기화에 로그인했다면 \`서버 백업\`으로 보관함 사본 하나를 서버에 둘 수 있어요. \`자동 백업\`을 켜면 앱을 열 때 하루 한 번 새로 고쳐요.'`
  - 도움말 라벨 팁(`labels`의 `tips` 끝과 `docs/help/labels.md` 같은 자리): `'앱을 열 때 하루 한 번 연결한 네이버 폴더를 확인해, 새로 저장한 곳이 있으면 알려 줘요. 설정 › 가져오기에서 끌 수 있어요.'`
  - 단계(`steps`)·그림 대체 글은 바꾸지 않는다(`yarn build:motion`을 돌리지 않는다). 도움말과 문서가 같은지 보는 기존 시험이 있으면 통과해야 한다.
  - README 기능 목록: `- 서버 백업: 로그인한 보관함의 사본 하나를 서버에 두고 하루 한 번 자동으로 새로 고쳐요(선택). 가져온 네이버 폴더에 새로 저장한 곳이 생기면 앱 안에서 알려 줘요`.
- [ ] **Step 1:** 문서 작성
- [ ] **Step 2: 로컬 화면 확인**(Codex 샌드박스에서 포트가 막히면 건너뛰고 보고) — `SYNC_VITE_PORT=4188 SYNC_DEV_PORT=8796 yarn dev:sync`를 백그라운드로 띄우고 가짜 로그인으로 세션을 만든 뒤(3단계 `docs/development.md`의 curl 순서 또는 브라우저) `curl -s -H 'Origin: http://localhost:8796' -H 'X-Landmark-Session: <세션>' http://localhost:8796/api/sync/v1/backup` → `{"now":…,"writable":true,"maxStoredBytes":1048576,"backup":null}`. 세션 값은 출력·파일에 남기지 않는다(변수에만). 확인 뒤 띄운 프로세스만 PID로 끈다.
- [ ] **Step 3: 전체 검증** — `yarn typecheck`, `yarn lint`, `yarn test`, `npx prettier --check <바꾼 파일들>`, `yarn build:ci`(바뀐 `--require-lazy` 포함), `E2E_PORT=4186 E2E_MAP_PORT=4187 yarn test:e2e:ci`, `grep -rnP '[\x{2028}\x{2029}]' src functions tests`(출력 없음). 첫 로딩 gzip 바이트와 이 기능 조각 이름(`auto-backup-*.js`, `folder-watch-*.js`, `ServerBackupSection-*.js`)을 보고에 적는다.
- [ ] **Step 4:** 커밋 `docs(auto-backup): 서버 백업·폴더 변경 알림 로컬 실행·설정 안내와 도움말`

## 최종 보고에 넣을 것

- 커밋 목록, 시험 수, `yarn build:ci`의 첫 로딩 gzip과 나뉜 조각 이름.
- Task 0에서 찾은 3단계와 다른 이름·시그니처(있으면).
- 실행하지 못한 검증(네트워크·포트)과 이유.
- 미리보기에서 사람이 확인할 것: 실제 보관함으로 수동·자동 백업, `POST /api/sync/v1/backup` CPU 시간(10ms 넘으면 `data` 정규식 검사를 머리·길이 검사로 줄임), 실제 압축 크기(`SELECT stored_bytes, raw_bytes, parts FROM library_backups`), iOS 사파리에서 되살리기 전 파일 받기, 다른 기기에서 되살리기, 실제 네이버 폴더로 알림.
- PR 본문 메모: 롤백·데이터 영향(설계 §호환·롤백 — `AUTO_BACKUP=off`, 3단계로 되돌릴 때 남는 표와 정리 SQL), `docs/rollback.md`는 병합 뒤 별도 PR, 사용자가 할 일(설계 §사용자가 할 일).
