# 전체 백업·복원 (묶음 F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정에서 보관함 전체(라벨·장소·여행과 화면 설정)를 `tripmap-backup` 파일로 받고, 그 파일로 보관함을 통째로 되살리며(한 번 되돌리기 가능), 마지막 백업 날짜와 7일 알림 띠를 보인다.

**Architecture:** 파일 형식과 읽기는 순수 함수(`src/domain/backup/*`, `src/schema/backup.ts`)다. 저장은 `LibraryStore`에 잠금 안에서 도는 `snapshot`·`replace`·`previous`·`restorePrevious`·`dropPrevious`를 더하고, 되살리기 전 사본은 `tripmap:library:v2:before-restore` 한 벌로 둔다. 마지막 백업·알림 미룸은 잃어도 되는 `tripmap:backup:v1`(`BackupMetaStore`, `PrefsStore`와 같은 모양)에 둔다. 화면은 설정의 `백업` 칸(설정 단위 안), 따로 받는 `RestoreDialog`, 손상 화면 버튼, 셸의 알림 띠다.

**Tech Stack:** TypeScript 6, React 19, MUI 7, Jotai, Effect 4.0.2, sonner, Vite 8, Vitest 5(jsdom), Playwright(desktop·iphone·galaxy).

**Spec:** `docs/superpowers/specs/2026-10-16-backup-restore-design.md`

## Global Constraints

- 출발점: F 묶음 순서상 F1이 첫 묶음이므로 지금 `main`. 브랜치 `feat/backup-restore`, 병합은 **Create a merge commit**, 병합 커밋에 태그 `v0.8.0`.
- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`(git 훅에도 필요). 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: 세션이 알려 주는 Co-Authored-By 줄. 작업 하나 = 커밋 묶음 하나. 되돌릴 때는 **새 작업부터** 되돌린다(Task 6·7은 서로 기대지 않는다. 나머지는 앞 작업에 기댄다).
- 파일에 U+2028/U+2029 원문자 금지. 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 저장 형식: `schemaVersion` 2, `tripmap:library:v2`, `tripmap:prefs`, `tripmap:routes:v1`은 **바꾸지 않는다**. 새 키는 `tripmap:backup:v1`, `tripmap:library:v2:before-restore` 두 개뿐. 공유 형식(`tripmap-share`)은 건드리지 않는다.
- 백업 형식(C3): `{ format: 'tripmap-backup', v: 1, exportedAt: <IsoDateTime>, library: <저장소 원문 JSON 값>, prefs?: <Prefs> }`, 공백 없는 `JSON.stringify`, MIME `application/json`. 읽을 때 모르는 최상위 필드는 무시한다.
- 한도: 백업 파일 16,777,216바이트, 보관함 직렬화 4,000,000자(`LIBRARY_LIMITS.libraryChars`). 알림 7일, 미룸 7일.
- 파일 이름: `landmark-backup-YYYY-MM-DD-HHmm.json`(이 기기 시간). 손상 화면의 파일 이름은 바꾸지 않는다.
- 고정 문구(스펙 §2):
  - 설정 칸 제목 `백업`. 설명 `보관함(장소·라벨·여행)은 이 기기의 브라우저에만 저장돼요. 브라우저는 오래 쓰지 않은 사이트의 데이터를 지울 수 있어요(특히 아이폰 사파리). 가끔 백업 파일을 받아 두세요.`
  - 상태 `마지막 백업: YYYY.MM.DD HH:mm (N일 전)` / `(오늘)` / `마지막 백업: 없음`. 데이터 정보 뒤 `· 저장 보호 켜짐` / `· 저장 보호 꺼짐`.
  - 버튼 `백업 파일 받기`, `백업 공유`, `백업 파일로 되살리기`, `되살리기 전으로 되돌리기`, `지우기`. 사본 줄 `되살리기 전 보관함이 남아 있어요 (YYYY.MM.DD HH:mm · <수 문구>)`.
  - 수 문구 `장소 N곳 · 라벨 N개 · 여행 N개`(살아 있는 것만).
  - 토스트 `백업 파일을 만들었어요`, `백업에서 되살렸어요 (<수 문구>)` + 동작 `되돌리기`(10초), `되살리기 전으로 되돌렸어요`, `되살리기 전 보관함을 지웠어요`.
  - 대화상자 제목 `백업에서 되살리기`. 고르기: `Landmark 백업 파일(.json)을 고르세요. 손상 화면에서 받은 옛 백업 파일도 돼요.`, 버튼 `파일 고르기`, 입력 이름 `백업 파일 선택`, `읽는 중…`. 미리보기: `YYYY.MM.DD HH:mm에 만든 백업` / `만든 날짜를 모르는 옛 백업 파일`, `백업 파일: <수 문구>`, `지금 보관함: <수 문구>` / `지금 보관함: 읽지 못함`, `지금 보관함은 지워지고 이 백업 내용으로 바뀌어요.`, `테마·보기 설정도 백업 때로 돌아가요. 보관함 필터는 풀어요.`, `이 백업에는 이 버전이 모르는 정보가 있어요. 되살리면 그 정보는 빠져요. 앱을 새로 고친 뒤 되살리는 것이 좋아요.`, `지금 보관함과 같은 내용이에요`, 버튼 `취소`·`지금 보관함 먼저 받기`·`이 백업으로 바꾸기`.
  - 공간 부족: `저장 공간이 부족해 지금 보관함을 기기에 남겨 둘 수 없어요. 먼저 '지금 보관함 먼저 받기'로 파일을 받은 뒤 바꿔 주세요` / 손상 화면 `저장 공간이 부족해 지금 데이터를 남겨 둘 수 없어요. 먼저 '백업 파일 받기'로 받아 주세요`.
  - 읽기 오류: `파일이 너무 커요` / `공유 파일이에요. 설정 › 가져오기의 '공유 파일 가져오기'로 넣어 주세요` / `Landmark 백업 파일이 아니에요` / `더 새 버전의 Landmark에서 만든 백업이에요. 앱을 새로 고친 뒤 다시 시도해 주세요` / `백업 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요` / `보관함이 너무 커서 되살릴 수 없어요`.
  - 저장 오류: `저장 공간이 부족해 되살리지 못했어요. 지금 보관함은 그대로예요` / `되살리지 못했어요. 지금 보관함은 그대로예요` / `되돌리지 못했어요` / `공유하지 못했어요. 백업 파일 받기를 이용해 주세요` / `백업 파일을 만들지 못했어요. 새로고침해 주세요`.
  - 알림 띠(이름 `백업 알림`): `아직 백업하지 않았어요. 보관함은 이 기기에만 있어요` / `마지막 백업이 N일 전이에요. 그 뒤로 바뀐 내용이 있어요`, 버튼 `백업 받기`·`나중에`. 손상 화면 새 버튼 `백업 파일로 되살리기`.
- 접근성: 버튼 높이 44px, 포커스 표시는 테마 그대로, 오류·경고 `role="alert"`, 띠는 라이브 영역이 아님. 색은 기존 토큰 짝만(`--tm-text-primary`·`--tm-text-secondary` on `--tm-bg-raised`·`--tm-bg-surface`, 테두리 `--tm-border-strong`), 오류 글자 `color="error"`.
- 첫 로딩 JS gzip 한도 327,680(`perf-budget.json`). `RestoreDialog`는 따로 받는다(`--require-lazy RestoreDialog`).
- E2E는 `E2E_PORT=5175`(5173은 다른 프로젝트의 개발 서버 — 절대 끄지 않는다, 5174는 지도 미리보기 서버). `pkill` 금지.

## Review Focus

1. **새 버전이 만든 백업(장소에 F2의 `visitedOn`, 보관함 최상위에 F3의 `folders` 같은 모르는 필드)을 v0.8.0에서 되살림** → 손상으로 보지 않고 되살리며, 미리보기에 모르는 정보 경고. Task 1 시험(`droppedUnknown`)과 Task 5 화면 시험으로 고정.
2. **저장 공간이 거의 찬 기기에서 되살리기** → 어떤 실패에서도 지금 보관함이 그대로이고, 사본을 못 남기면 바꾸지 않고 먼저 받으라고 안내. Task 2(용량 초과 저장소)·Task 5 시험으로 고정.
3. **엉뚱한 파일**(손상 화면이 받은 원문, 내보낸 공유 HTML, 아무 JSON, 빈 파일) → 각각 옛 백업으로 되살림 / 공유 파일 안내 / 백업 아님 / 백업 아님. Task 1 시험으로 고정.
4. **되살리는 사이 다른 탭이 보관함을 고침** → 잠금 안에서 그 최신본이 사본이 되고, 되돌리면 그 상태로. Task 2 시험(`createHeldLocks`)으로 고정.
5. **휴대폰 공유 창을 그냥 닫음(`AbortError`), 또는 받기 중 두 번 누름** → 오류 없음, 마지막 백업 날짜 그대로, 파일은 한 번만. Task 4 시험으로 고정.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/schema/backup.ts` | 형식 상수, 봉투·기록 스키마 |
| `src/domain/backup/build-backup.ts`, `read-backup.ts`, `summary.ts`, `reminder.ts` | 파일 만들기·읽기, 수·마지막 변경, 알림 조건 |
| `src/services/library-store.ts`, `src/services/errors.ts` | 바꾸기·사본 |
| `src/services/backup-meta-store.ts`, `src/lib/effect/runtime.ts` | 마지막 백업 기록 |
| `src/stores/backup-state.ts`, `src/lib/storage-persist.ts` | atom·되살리기 동작·저장 보호 |
| `src/sections/backup/*` | 받기 훅, 설정 칸, 되살리기 대화상자와 틀 |
| `src/sections/settings/SettingsPage.tsx`, `src/sections/shell/CorruptScreen.tsx`, `src/sections/shell/BackupReminder.tsx`, `src/sections/shell/AppShell.tsx` | 자리 |
| `src/routes/lazy-routes.ts`, `package.json` | 따로 받는 단위 |
| `tests/e2e/backup-restore.spec.ts`, `playwright.config.ts`, `README.md`, `docs/rollback.md` | E2E·문서 |

---

### Task 1: 백업 형식 — 만들기·읽기·수 세기

**Files:**
- Create: `src/schema/backup.ts`, `src/domain/backup/build-backup.ts`, `src/domain/backup/read-backup.ts`, `src/domain/backup/summary.ts`
- Test: `tests/unit/domain/backup/build-backup.test.ts`, `tests/unit/domain/backup/read-backup.test.ts`, `tests/unit/domain/backup/summary.test.ts`

**Interfaces:**
- Consumes: `LibrarySchema`, `LIBRARY_LIMITS`, `type Library`(`src/schema/library`), `PrefsSchema`·`type Prefs`(`src/schema/prefs`), `IsoDateTime`(`src/schema/common`), `safeParse`(`src/schema/parse`).
- Produces:
  ```ts
  // src/schema/backup.ts
  export const BACKUP_FORMAT = 'tripmap-backup';
  export const BACKUP_VERSION = 1;
  export const BackupEnvelopeSchema; // Struct { format: Literal, v: Literal(1), exportedAt: IsoDateTime, library: Unknown, prefs: optionalKey(Unknown) }
  export type BackupEnvelope = { format: 'tripmap-backup'; v: 1; exportedAt: string; library: unknown; prefs?: unknown };

  // src/domain/backup/build-backup.ts
  export const BACKUP_MIME = 'application/json';
  export function buildBackupText(input: { rawLibrary: unknown; prefs: Prefs | null; now: Date }): string;
  export function backupFileName(now: Date): string;

  // src/domain/backup/read-backup.ts
  export const BACKUP_FILE_MAX_BYTES = 16_777_216;
  export type BackupReadError = 'too-big' | 'share-file' | 'not-backup' | 'newer' | 'invalid' | 'too-large';
  export const BACKUP_READ_MESSAGES: Record<BackupReadError, string>; // Global Constraints 읽기 오류 순서대로
  export type ReadBackup = { kind: 'backup' | 'legacy'; exportedAt: string | null; library: Library; prefs: Prefs | null; droppedUnknown: boolean };
  export type BackupReadResult = { ok: true; backup: ReadBackup } | { ok: false; error: BackupReadError };
  export function readBackupText(text: string): BackupReadResult;
  export async function readBackupFile(file: Blob): Promise<BackupReadResult>;

  // src/domain/backup/summary.ts
  export type LibraryCounts = { places: number; labels: number; trips: number };
  export function libraryCounts(lib: Library): LibraryCounts;   // deletedAt === null만
  export function countsText(counts: LibraryCounts): string;    // '장소 30곳 · 라벨 6개 · 여행 2개'
  export function hasAnyEntry(lib: Library): boolean;           // 묘비 포함 항목이 하나라도
  export function hasLiveContent(lib: Library): boolean;        // 살아 있는 장소·라벨·여행이 하나라도
  export function latestChangeAt(lib: Library): string | null;  // 스펙 §3.4
  export function earliestCreatedAt(lib: Library): string | null;
  export function formatLocalDateTime(iso: string): string;     // 'YYYY.MM.DD HH:mm', 이 기기 시간
  ```
- 읽기 순서는 스펙 §3.2 그대로. `latestChangeAt`은 객체를 재귀로 돌며 `{ value, updatedAt: string }` 모양의 `updatedAt`과 장소·라벨·여행의 `createdAt`·`deletedAt`을 모은다(필드 이름 목록을 두지 않는다).

- [ ] **Step 1: 실패하는 시험**
  - `build-backup`: `buildBackupText({ rawLibrary: raw, prefs, now: new Date('2026-10-16T05:30:00.000Z') })`를 `JSON.parse`하면 `{ format: 'tripmap-backup', v: 1, exportedAt: '2026-10-16T05:30:00.000Z', library: raw, prefs }`. `raw`의 장소에 모르는 필드(`futureField: { value: 1, updatedAt }`)가 있어도 그대로. `prefs: null`이면 `prefs` 키가 없다. 텍스트에 줄바꿈이 없다. `backupFileName(d)`는 `landmark-backup-<YYYY>-<MM>-<DD>-<HHmm>.json`이고 각 값은 `d`의 지역 메서드(`getFullYear`·`getMonth`·`getDate`·`getHours`·`getMinutes`, 두 자리 채움)와 같다(시험이 시간대에 기대지 않게). 이름에 `:`이 없다.
  - `read-backup`: 왕복(`readBackupText(buildBackupText(...))` → `kind: 'backup'`, `library`가 원래 디코드 결과와 `toEqual`, `prefs` 같음, `droppedUnknown: false`). 손상 화면 원문(`JSON.stringify(library)`) → `kind: 'legacy'`, `exportedAt: null`, `prefs: null`. `v: 2` → `newer`, `v: '1'` → `invalid`, 원문 `schemaVersion: 3` → `newer`. `'  <!doctype html>…'` → `share-file`. `''`, `'x'`, `'[]'`, `'{}'`, `'{"format":"tripmap-share"}'` → `not-backup`. 봉투는 맞는데 장소 키와 id가 다름 → `invalid`. `exportedAt: 'yesterday'` → `invalid`. 장소에 `futureField: { value: 1, updatedAt }` → `ok`·`droppedUnknown: true`이고 결과 장소에 `futureField` 없음. 보관함 최상위 `futureCollection: {}` → `ok`·`droppedUnknown: true`. 봉투 최상위 모르는 필드 `extra: {}` → `ok`·`droppedUnknown: false`. (모르는 필드 예는 뒤 묶음의 실제 이름(`visitedOn`·`folders`)을 쓰지 않는다 — 그 묶음이 병합되면 더 이상 모르는 필드가 아니어서 시험을 고쳐야 하기 때문이다.) `prefs: { theme: 'neon' }` → `ok`·`prefs: null`. 메모를 길게 채워 직렬화 4,000,001자 → `too-large`. `readBackupFile(new Blob([new Uint8Array(16_777_217)]))` → `too-big`이고 `text()`를 부르지 않음(스파이). `BACKUP_READ_MESSAGES` 여섯 문구가 Global Constraints와 글자까지 같음.
  - `summary`: 묘비는 세지 않음, `countsText({ places: 30, labels: 6, trips: 2 })` → `'장소 30곳 · 라벨 6개 · 여행 2개'`, `latestChangeAt`이 Day 안 `stops.updatedAt`을 고름, 빈 보관함 → `null`, `hasAnyEntry`(묘비만 있음 → 참), `hasLiveContent`(묘비만 있음 → 거짓).
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/backup` → FAIL(모듈 없음)
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `yarn vitest run tests/unit/domain/backup` PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(backup): 백업 파일 형식 만들기와 읽기`

---

### Task 2: 저장소 — 바꾸기와 되살리기 전 사본

**Files:**
- Modify: `src/services/library-store.ts`, `src/services/errors.ts`
- Test: `tests/unit/services/library-store.test.ts`

**Interfaces:**
- Consumes: Task 1의 `BACKUP_FORMAT`·`BACKUP_VERSION`·`BackupEnvelopeSchema`, `hasAnyEntry`.
- Produces:
  ```ts
  // src/services/library-store.ts
  export const PREVIOUS_KEY = 'tripmap:library:v2:before-restore';
  // LibraryStore 서비스에 추가 (기존 load·update·changes·resetWithBackup은 그대로)
  readonly snapshot: Effect.Effect<{ raw: unknown; library: Library }, LibraryCorrupt>;
  replace(next: Library, options: { requirePrevious: boolean }):
    Effect.Effect<{ library: Library; previousKept: boolean }, StorageQuotaExceeded | LibraryInvalid | PreviousNotKept>;
  readonly previous: Effect.Effect<{ savedAt: string; library: Library } | null>;
  readonly restorePrevious: Effect.Effect<Library, StorageQuotaExceeded | LibraryInvalid | NoPrevious>;
  readonly dropPrevious: Effect.Effect<void>;

  // src/services/errors.ts
  export class PreviousNotKept extends Schema.TaggedError<PreviousNotKept>()('PreviousNotKept', {}) // userMessage: 일반 화면의 공간 부족 문구
  export class NoPrevious extends Schema.TaggedError<NoPrevious>()('NoPrevious', {})             // userMessage: '되돌리지 못했어요'
  ```
- `snapshot`: 키 없음 → `{ raw: emptyLibrary(), library: emptyLibrary() }`. 정상 → `raw`는 `JSON.parse(원문)`. 손상 → `failCorruptReadOnly`와 같이 쓰지 않고 `LibraryCorrupt`.
- `replace`(잠금 안): 스펙 §5 순서. 사본 값은 `JSON.stringify({ format, v: 1, exportedAt: <Clock 시각>, library: <지금 원문 JSON 값> })`. 지금이 정상이고 `hasAnyEntry`면 사본을 쓰고, 항목이 없으면 사본 키를 지운다. 손상이면 `ensureBackup(raw)`(사본은 건드리지 않음). 사본·손상 백업 쓰기의 용량 초과는 `requirePrevious`면 `PreviousNotKept`. 보관함 쓰기 용량 초과면 방금 쓴 사본을 지우고, `requirePrevious`면 `PreviousNotKept`, 아니면 한 번 더 쓴 뒤 실패면 `StorageQuotaExceeded`. 이 경로의 `putItem`은 사본 지우기 단계를 건너뛴다(아래 참고).
- `putItem`의 용량 초과 대체 순서: 경로 캐시 지우고 다시 → 그래도 넘치면(쓰는 키가 `PREVIOUS_KEY`가 아니고 `replace` 안이 아닐 때) 사본 키 지우고 다시.
- `previous`: 사본을 `BackupEnvelopeSchema` → `LibrarySchema`로 읽는다. 없거나 읽지 못하면 `null`(지우지 않는다).
- `restorePrevious`(잠금 안): 사본을 읽어 검증한 보관함을 쓰고 사본을 지운다. 없거나 못 읽으면 `NoPrevious`.

- [ ] **Step 1: 실패하는 시험** (기존 `createMemoryStorage`·`seed`·`createHeldLocks` 도우미 사용, 용량 초과는 기존 시험의 쿼터 흉내 저장소 방식)
  - `snapshot`: 원문 장소에 `futureField`를 넣어 둠 → `raw`에는 있고 `library`에는 없음. 키 없음 → 빈 문서 둘. 손상 원문 → `LibraryCorrupt`이고 저장소의 키 목록이 그대로.
  - `replace`: 장소 2곳 → 다른 보관함으로 바꿈 → `LIBRARY_KEY`는 새 보관함, `PREVIOUS_KEY` 봉투의 `library`가 바꾸기 전 원문과 `toEqual`, `previousKept: true`. 빈 보관함에서 바꿈 → 사본 키 없음(미리 있던 사본도 지워짐), `previousKept: false`. 손상 원문에서 바꿈 → `corruptKey(…)`에 원문이 있고 보관함은 새 것, 사본 키 없음. `next`가 검증 실패 → `LibraryInvalid`, 아무 키도 안 바뀜.
  - 용량: 사본 쓰기만 넘침 + `requirePrevious: true` → `PreviousNotKept`, 보관함 그대로. 같은 조건 `requirePrevious: false` → 바뀜, `previousKept: false`. 보관함 쓰기가 넘침(사본은 들어감) + `requirePrevious: true` → `PreviousNotKept`, 보관함·옛 원문 그대로, 사본 키 없음. 손상 + 손상 백업 넘침 + `requirePrevious: true` → `PreviousNotKept`, 원문 그대로.
  - `restorePrevious`: `replace` 뒤 → 바꾸기 전 보관함으로 돌아오고 사본 키 없음. 사본 없음 → `NoPrevious`. 사본이 깨진 JSON → `NoPrevious`, `previous`는 `null`.
  - `dropPrevious` → 사본 키 없음. `previous` → `{ savedAt, library }`(`savedAt`은 `Clock` 시각).
  - 일반 `update`: 경로 캐시와 사본이 있고 쓰기가 넘침 → 경로 캐시 먼저 지우고, 그래도 넘치면 사본을 지운 뒤 저장 성공.
  - 잠금: `createHeldLocks`로 잠금을 쥔 채 다른 쪽이 장소를 하나 더한 원문을 써 두고 풀어 줌 → `replace`의 사본이 그 최신 원문.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/library-store.test.ts` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test`(기존 저장소·손상 화면 시험 그대로 통과) + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(backup): 저장소에 통째로 바꾸기와 되살리기 전 사본`

---

### Task 3: 마지막 백업 기록·알림 조건·저장 보호

**Files:**
- Modify: `src/schema/backup.ts`, `src/lib/effect/runtime.ts`, 그리고 `AppRuntime`으로 런타임을 만드는 시험 도우미(`tests/unit/sections/shell/harness.tsx` 등 — `yarn typecheck`가 알려 주는 곳)
- Create: `src/services/backup-meta-store.ts`, `src/stores/backup-state.ts`, `src/domain/backup/reminder.ts`, `src/lib/storage-persist.ts`
- Test: `tests/unit/services/backup-meta-store.test.ts`, `tests/unit/stores/backup-state.test.ts`, `tests/unit/domain/backup/reminder.test.ts`, `tests/unit/lib/storage-persist.test.ts`

**Interfaces:**
- Consumes: Task 1의 `latestChangeAt`·`earliestCreatedAt`·`libraryCounts`.
- Produces:
  ```ts
  // src/schema/backup.ts (추가)
  export const BackupMetaSchema; // Struct { lastBackupAt: NullOr(IsoDateTime), snoozedAt: NullOr(IsoDateTime) }
  export type BackupMeta = { lastBackupAt: string | null; snoozedAt: string | null };
  export const EMPTY_BACKUP_META: BackupMeta;

  // src/services/backup-meta-store.ts — PrefsStore와 같은 모양(읽기·검증 실패는 EMPTY, 쓰기 실패는 console.warn)
  export const BACKUP_META_KEY = 'tripmap:backup:v1';
  export class BackupMetaStore extends Context.Service<BackupMetaStore,
    { readonly get: Effect.Effect<BackupMeta>; set(meta: BackupMeta): Effect.Effect<void> }>()('tripmap/BackupMetaStore')
  { static layerWith(o: { storage: Storage | undefined }); static readonly layer; }

  // src/stores/backup-state.ts
  export const backupMetaAtom: PrimitiveAtom<BackupMeta>;            // atomWithLazy, prefs-state와 같은 방식
  export const markBackedUpAtom;   // atom(null, (get, set, at: string) => …) lastBackupAt = max(지금 값, at), snoozedAt = null, 저장
  export const snoozeReminderAtom; // atom(null, (get, set, at: string) => …) snoozedAt = at, 저장
  export const persistStateAtom: PrimitiveAtom<PersistState | null>;

  // src/domain/backup/reminder.ts
  export const REMIND_AFTER_DAYS = 7;
  export const SNOOZE_DAYS = 7;
  export type ReminderState = null | { kind: 'never' } | { kind: 'stale'; days: number };
  export function reminderState(input: { library: Library; meta: BackupMeta; persistence: 'local' | 'memory'; now: number }): ReminderState;
  export function reminderText(state: Exclude<ReminderState, null>): string;

  // src/lib/storage-persist.ts
  export type PersistState = 'persisted' | 'not-persisted' | 'unsupported';
  export async function persistState(): Promise<PersistState>;       // navigator.storage?.persisted, 던지면 'unsupported'
  export async function requestPersistOnce(): Promise<PersistState>; // 모듈 변수로 세션당 한 번 persist(), 이미 persisted면 부르지 않음
  ```
- `days`는 `Math.floor((now - lastBackupAt) / 86_400_000)`. 조건은 스펙 §2.5 그대로.

- [ ] **Step 1: 실패하는 시험**
  - 메타 저장소: 없음 → `EMPTY`, 깨진 JSON·스키마 실패 → `EMPTY`, `set` 뒤 `get` 왕복, `setItem`이 던져도 실패하지 않음.
  - atom: `markBackedUpAtom('2026-10-16T05:30:00.000Z')` 뒤 저장소 값, 더 이른 시각으로 다시 부르면 그대로, `snoozedAt` 지워짐. `snoozeReminderAtom` 저장.
  - `reminderState`: 메모리 모드 → `null`. 살아 있는 장소·여행 없음(라벨만) → `null`. 백업 없음 + 첫 `createdAt`에서 6일 23시간 → `null`, 7일 → `{ kind: 'never' }`. 백업 있음 + 그 뒤 변경 없음(10일) → `null`. 백업 뒤 변경 + 6일 → `null`, 9일 → `{ kind: 'stale', days: 9 }`. 미룸 3일 전 → `null`, 7일 전 → 다시 보임. `reminderText({ kind: 'stale', days: 9 })` → `'마지막 백업이 9일 전이에요. 그 뒤로 바뀐 내용이 있어요'`.
  - 저장 보호: `navigator.storage` 없음 → `'unsupported'`. `persisted()`가 거짓이면 `requestPersistOnce`가 `persist()`를 한 번 부르고, 두 번째 호출에서는 부르지 않음. `persisted()`가 참이면 부르지 않음.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/backup-meta-store.test.ts tests/unit/stores/backup-state.test.ts tests/unit/domain/backup/reminder.test.ts tests/unit/lib/storage-persist.test.ts` → FAIL
- [ ] **Step 3:** 구현. `AppLayer`에 `BackupMetaStore.layer`를 더하고, `AppRuntime`을 만드는 시험 도우미에 `BackupMetaStore.layerWith({ storage })`를 더한다.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(backup): 마지막 백업 기록과 알림 조건, 저장 보호 요청`

---

### Task 4: 설정의 `백업` 칸과 백업 받기

**Files:**
- Create: `src/sections/backup/use-backup-file.ts`, `src/sections/backup/BackupSection.tsx`
- Modify: `src/sections/settings/SettingsPage.tsx`(`가져오기` 앞에 `백업` 칸, `데이터 정보` 뒤 저장 보호)
- Test: `tests/unit/sections/backup/backup-section.test.tsx`, `tests/unit/sections/settings/settings-page.test.tsx`(칸 순서·저장 보호 줄)

**Interfaces:**
- Consumes: Task 1 `buildBackupText`·`backupFileName`·`BACKUP_MIME`·`formatLocalDateTime`, Task 2 `LibraryStore.snapshot`, Task 3 `backupMetaAtom`·`markBackedUpAtom`·`persistStateAtom`·`requestPersistOnce`·`persistState`, `prefsAtom`, `downloadText`.
- Produces:
  ```ts
  // src/sections/backup/use-backup-file.ts
  export function canShareBackup(): boolean; // canShare({ files: [new File([''], 'x.json', { type: 'application/json' })] }), 던지면 false
  export function useBackupFile(): {
    shareable: boolean;
    busy: boolean;
    error: string | null;
    save(): Promise<boolean>;   // 성공(받기 시작)이면 true
    share(): Promise<boolean>;  // 공유 완료면 true, AbortError면 false·오류 없음
  };
  // src/sections/backup/BackupSection.tsx
  export function BackupSection(props: { onRestore(): void }): JSX.Element; // onRestore는 Task 5가 채운다(이 작업에서는 SettingsPage가 아무것도 안 하는 함수를 넘김)
  ```
- 성공하면 `toast('백업 파일을 만들었어요')`, `markBackedUpAtom(now)`, `requestPersistOnce()` 결과를 `persistStateAtom`에. 진행 중에는 `busyRef`로 두 번째 누름을 막는다(내보내기 대화상자와 같은 방식). `snapshot`이 `LibraryCorrupt`면 `error`에 `백업 파일을 만들지 못했어요. 새로고침해 주세요`. 공유 파일 제목 `Landmark 백업`.
- 사본 줄(`되살리기 전 보관함이 남아 있어요 …`)은 Task 5에서 더한다.

- [ ] **Step 1: 실패하는 시험**
  - 설정 화면 칸 순서 `테마`·`모드`·`보관함 보기`·`백업`·`가져오기`·`데이터 정보`(h2 이름).
  - `백업` 칸: 설명 문구, `마지막 백업: 없음`. 기록 `2026-10-13T05:30:00.000Z` + 지금 `2026-10-16T05:30:00.000Z`(`vi.setSystemTime`) → `마지막 백업: 2026.10.13 14:30 (3일 전)`(Asia/Seoul 기준 기대값은 `formatLocalDateTime`으로 계산), 같은 날 → `(오늘)`.
  - `백업 파일 받기` → `downloadText`(모듈 mock)가 `(text, 'landmark-backup-…json', 'application/json')`로 한 번, `text`를 `readBackupText`하면 시드 보관함, 토스트 `백업 파일을 만들었어요`, 상태 줄이 `(오늘)`, 저장소 `tripmap:backup:v1`의 `lastBackupAt`이 지금. 빠르게 두 번 눌러도 `downloadText` 한 번.
  - `canShare` 거짓 → `백업 공유` 없음. 참 + `share`가 `AbortError`로 거부 → 오류 문구 없음, 기록 그대로. 참 + 다른 오류 → `공유하지 못했어요. 백업 파일 받기를 이용해 주세요`(`role="alert"`). 참 + 성공 → `share`가 `files[0].name`이 `landmark-backup-`로 시작하는 파일로 불림, 토스트.
  - 저장 보호: `persisted()` 참 → 데이터 정보 끝에 `· 저장 보호 켜짐`, `navigator.storage` 없음 → 덧붙이지 않음.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/backup tests/unit/sections/settings` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(backup): 설정에서 백업 파일 받기·공유와 마지막 백업 날짜`

---

### Task 5: 되살리기 대화상자와 되돌리기

**Files:**
- Create: `src/sections/backup/RestoreDialog.tsx`, `src/sections/backup/RestoreDialogHost.tsx`
- Modify: `src/stores/backup-state.ts`(동작 훅), `src/sections/backup/BackupSection.tsx`(사본 줄·되살리기 버튼 연결), `src/sections/settings/SettingsPage.tsx`, `src/routes/lazy-routes.ts`(`loadRestoreDialog`, `RestoreDialog`, `PANEL_CHUNKS`에 추가), `package.json`(`build:ci`에 `--require-lazy RestoreDialog`)
- Test: `tests/unit/sections/backup/restore-dialog.test.tsx`, `tests/unit/sections/backup/backup-section.test.tsx`

**Interfaces:**
- Consumes: Task 1 `readBackupFile`·`BACKUP_READ_MESSAGES`·`libraryCounts`·`countsText`·`hasLiveContent`·`formatLocalDateTime`, Task 2 `replace`·`previous`·`restorePrevious`·`dropPrevious`·`PreviousNotKept`, Task 3 `markBackedUpAtom`, Task 4 `useBackupFile`, `reflectSaved`·`libraryAtom`(`src/stores/library-state`), `setPrefsAtom`, `DEFAULT_QUERY`.
- Produces:
  ```ts
  // src/stores/backup-state.ts (추가)
  export type RestoreOutcome = { ok: true; previousKept: boolean; counts: LibraryCounts } | { ok: false; error: unknown };
  export function useRestoreActions(): {
    replace(backup: ReadBackup, options: { requirePrevious: boolean }): Promise<RestoreOutcome>; // 성공 시 reflectSaved, prefs(query는 structuredClone(DEFAULT_QUERY)), exportedAt이 있으면 markBackedUpAtom(exportedAt)
    undo(): Promise<boolean>;  // restorePrevious + reflectSaved
    drop(): Promise<void>;
  };
  export function usePreviousCopy(): { info: { savedAt: string; counts: LibraryCounts } | null; refresh(): void };

  // src/sections/backup/RestoreDialog.tsx (따로 받는 단위)
  export function RestoreDialog(props: {
    open: boolean;
    onClose(): void;
    mode: 'normal' | 'corrupt';
    /** 손상 화면에서 이미 `백업 파일 받기`를 했는가(그러면 requirePrevious 거짓). */
    currentSaved?: boolean;
    onRestored?(): void;
  }): JSX.Element;
  // src/sections/backup/RestoreDialogHost.tsx — 같은 props, ExportHtmlDialogHost와 같은 모양(처음 열 때 마운트, 기다림·받기 실패 틀)
  export function RestoreDialogHost(props: Parameters<typeof RestoreDialog>[0]): JSX.Element | null;
  ```
- `requirePrevious` = `mode === 'normal' ? hasLiveContent(지금) && !이 대화상자에서 받기 성공 : !currentSaved`. `PreviousNotKept`면 모드별 공간 부족 문구, `StorageQuotaExceeded`면 `저장 공간이 부족해 되살리지 못했어요. 지금 보관함은 그대로예요`, 그 밖은 `되살리지 못했어요. 지금 보관함은 그대로예요`. 성공 토스트: `previousKept`면 `toast(…, { action: { label: '되돌리기', onClick }, duration: 10_000 })`. 같은 내용 판정은 `isEqual(backup.library, 지금 libraryAtom)`(`es-toolkit`). 열 때마다 단계·오류·받기 표시를 초기화하고, 닫았다 열면 늦은 읽기·바꾸기 결과를 버린다(실행 번호).

- [ ] **Step 1: 실패하는 시험** (`renderLibrary` 도우미, `readBackupFile`은 실제 함수에 `File` 넘김)
  - 설정 `백업 파일로 되살리기` → 대화상자 `백업에서 되살리기`, 포커스 `파일 고르기`. 공유 HTML 파일 → `공유 파일이에요…` 문구(`role="alert"`), 다시 고를 수 있음.
  - 여행 2개·장소 30곳 백업 파일 → `… 에 만든 백업`, `백업 파일: 장소 30곳 · 라벨 6개 · 여행 2개`, `지금 보관함: …`, 경고 문구, 설정 문구, 포커스 `이 백업으로 바꾸기`. 옛 원문 파일 → `만든 날짜를 모르는 옛 백업 파일`, 설정 문구 없음. `futureField` 든 파일 → 모르는 정보 경고. 지금과 같은 파일 → `지금 보관함과 같은 내용이에요`, 바꾸기 꺼짐.
  - 바꾸기 → 저장소 보관함이 파일 보관함과 `toEqual`, 사본 키 있음, 토스트 `백업에서 되살렸어요 (장소 30곳 · 라벨 6개 · 여행 2개)`와 동작 `되돌리기`, prefs 테마가 파일 값이고 `query`는 기본값, `tripmap:backup:v1`의 `lastBackupAt`이 파일 `exportedAt`. 토스트 동작을 불러 되돌리기 → 원래 보관함, 토스트 `되살리기 전으로 되돌렸어요`.
  - 사본 쓰기가 넘치는 저장소 → 바꾸기 → 공간 부족 문구, 보관함 그대로. `지금 보관함 먼저 받기`(`downloadText` 불림) 뒤 바꾸기 → 바뀜, 토스트에 동작 없음.
  - 빈 보관함 → `지금 보관함 먼저 받기` 없음, 바로 바뀜.
  - 설정 사본 줄: 바꾼 뒤 `되살리기 전 보관함이 남아 있어요 (… · 장소 …)`, `지우기` → 줄 사라짐·토스트, `되살리기 전으로 되돌리기` → 원래 보관함.
  - 단위 나누기: `loadRestoreDialog`가 `PANEL_CHUNKS`에 있음(기존 lazy 시험 방식).
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/backup` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(backup): 백업 파일로 되살리기와 되돌리기`

---

### Task 6: 손상 화면에서 되살리기

**Files:**
- Modify: `src/sections/shell/CorruptScreen.tsx`
- Test: `tests/unit/sections/shell/corrupt-screen.test.tsx`

**Interfaces:**
- Consumes: Task 5 `RestoreDialogHost`(`mode: 'corrupt'`, `currentSaved`, `onRestored`).
- Produces: 없음. 버튼 순서 `백업 파일 받기` · `백업 파일로 되살리기` · `새로 시작`. `백업 파일 받기`가 성공하면 `currentSaved`를 참으로. `onRestored`는 기존 `onRecovered`.

- [ ] **Step 1: 실패하는 시험**: 손상 원문을 둔 셸 → `백업 파일로 되살리기` → 백업 파일 → 미리보기 `지금 보관함: 읽지 못함`, `지금 보관함 먼저 받기` 없음 → 바꾸기 → 셸(보관함 목록)이 보이고 `corruptKey(…)`에 손상 원문이 남음. 손상 백업 쓰기가 넘치는 저장소 + 받기 안 함 → 손상 화면 공간 부족 문구, 원문 그대로. 먼저 `백업 파일 받기` → 같은 저장소에서 바뀜. 기존 시험(`새로 시작` 등) 그대로 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/shell/corrupt-screen.test.tsx` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(backup): 손상 화면에서 백업 파일로 되살리기`

---

### Task 7: 백업 알림 띠

**Files:**
- Create: `src/sections/shell/BackupReminder.tsx`
- Modify: `src/sections/shell/AppShell.tsx`(`<StorageBanner />` 다음, `isLibraryView`일 때만)
- Test: `tests/unit/sections/shell/backup-reminder.test.tsx`

**Interfaces:**
- Consumes: Task 3 `reminderState`·`reminderText`·`backupMetaAtom`·`snoozeReminderAtom`, Task 4 `useBackupFile`, `libraryAtom`·`persistenceAtom`, `MAIN_ID`.
- Produces: `export function BackupReminder(): JSX.Element | null;` — `<section aria-label="백업 알림">`, 버튼 `백업 받기`(공유가 되면 `share`, 아니면 `save`)·`나중에`(`snoozeReminderAtom(now)`). 띠가 사라지면 `document.getElementById(MAIN_ID)?.focus({ preventScroll: true })`. `now`는 그릴 때의 `Date.now()`. 좁은 폭은 문구 아래 버튼 줄(`flexWrap`).

- [ ] **Step 1: 실패하는 시험**: 시드 장소 `createdAt` 8일 전·백업 없음 → `/`에 띠 `아직 백업하지 않았어요. 보관함은 이 기기에만 있어요`, `/settings`·`/trips`에는 없음. `나중에` → 띠 사라짐·포커스가 `#main`·저장소 `snoozedAt`. `백업 받기` → `downloadText` 한 번, 띠 사라짐. 마지막 백업 9일 전 + 그 뒤 메모 변경 → `마지막 백업이 9일 전이에요. 그 뒤로 바뀐 내용이 있어요`. 메모리 모드 → 띠 없음. 띠 안에 `role="status"`·`role="alert"` 없음.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/shell/backup-reminder.test.tsx` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(backup): 오래 백업하지 않으면 보관함에 알림 띠`

---

### Task 8: E2E, 예산, 문서

**Files:**
- Create: `tests/e2e/backup-restore.spec.ts`
- Modify: `playwright.config.ts`(세 프로젝트의 `testMatch`에 `backup-restore.spec.ts`), `README.md`(소개 문단·화면 경로 표는 그대로, "알려진 한계"의 localStorage 문단을 백업·되살리기 안내로, E2E spec 목록에 한 줄), `docs/rollback.md`(병합 뒤 `v0.8.0` 줄 — 스펙 §3.5 문구, 커밋·PR 번호는 병합 뒤 채움)

**Interfaces:**
- Consumes: `tests/e2e/fixtures.ts`의 `LIBRARY_KEY`·`seedJson`·`PREFS_KEY`, `share-export.spec.ts`의 다운로드 받기 방식(`page.waitForEvent('download')` → `saveAs(testInfo.outputPath(suggestedFilename()))`).

- [ ] **Step 1: E2E 작성** (desktop·iphone·galaxy)
  - 시드 보관함에 여행 하나를 더한 원문을 `addInitScript`로 넣음 → `/settings` → `백업 파일 받기` → 다운로드 이름이 `/^landmark-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/` → `마지막 백업:` 줄에 `(오늘)`.
  - `localStorage.removeItem(LIBRARY_KEY)` 후 새로고침 → `/settings` → `백업 파일로 되살리기` → `setInputFiles(받은 파일)` → `백업 파일: 장소 30곳 · 라벨 6개 · 여행 1개` → `이 백업으로 바꾸기` → 토스트 → `page.evaluate`로 읽은 저장소 보관함이 넣었던 원문과 `toEqual` → `/trips`에 그 여행.
  - 되살린 뒤 장소를 하나 더 넣은 원문으로 다시 되살리고 토스트 `되돌리기` → 보관함이 첫 되살리기 상태.
  - 손상 원문(`'{"schemaVersion":2'`) → 손상 화면 → `백업 파일로 되살리기` → 파일 → 바꾸기 → 보관함 목록이 보임.
- [ ] **Step 2:** `E2E_PORT=5175 yarn test:e2e tests/e2e/backup-restore.spec.ts` → PASS(세 프로젝트). 전체 `E2E_PORT=5175 yarn test:e2e` PASS.
- [ ] **Step 3:** `yarn build:ci` PASS(`--require-lazy RestoreDialog` 포함). 첫 로딩 gzip 값을 보고서에 적고 `perf-budget.json`의 `measuredInitialJsGzip`·`measuredAt`을 새 값으로. 늘어난 양이 4 KB를 넘으면 원인을 보고서에(스펙 §7의 대안: 띠를 따로 받는 단위로).
- [ ] **Step 4:** README·`playwright.config.ts` 고치고 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- [ ] **Step 5:** 커밋 `test(backup): 백업·되살리기 E2E와 문서`
- [ ] **Step 6: 배포 확인**(PR 미리보기 배포 뒤, 수동): 아이폰 사파리·안드로이드 크롬에서 `백업 파일 받기`가 파일 앱/다운로드에 저장되는지, `백업 공유`가 보이는지·보내지는지, 받은 파일로 되살려지는지. 결과(기기·OS·브라우저 버전·날짜)를 PR에 적는다. 병합 뒤 태그 `v0.8.0`과 `docs/rollback.md` 줄(별도 문서 커밋).
