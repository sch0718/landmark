# 약속 온라인 집계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 약속을 Cloudflare D1에 올려 친구 답장이 답장 링크 없이 주최자에게 자동으로 모이게 한다(서버 제안 로드맵 1단계).

**Architecture:** Pages Functions(`functions/api/meet/*`)가 처리 코드(`src/server/meet/*`)를 부르고, 처리 코드는 작은 DB 인터페이스(`MeetDb`)에만 기대 D1·`node:sqlite`를 바꿔 끼운다. 권한은 약속 단위 토큰(주최자/참석자)의 SHA-256 해시로 나눈다. 브라우저는 열린 약속 화면에서 10초마다 `rev`를 확인하고, 주최자 기기가 받은 답장을 보관함 약속에 합친다.

**Tech Stack:** React 19, MUI 7, Jotai, Effect 4.0.2(Schema), Vitest 5, Playwright, Cloudflare Pages Functions + D1, Node 24 `node:sqlite`(시험 전용).

**설계 문서:** `docs/superpowers/specs/2026-10-25-meeting-online-design.md` — 이 계획과 다르면 설계 문서가 맞다. 모든 과제 전에 한 번 읽는다. 기존 약속 설계 `docs/superpowers/specs/2026-10-23-meeting-place-design.md`도 읽는다.

## Global Constraints

- 셸: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`, Yarn 1.22.22. `yarn test`(vitest), `yarn typecheck`, `yarn lint`, `yarn validate`. 5173·5174 포트 서버는 건드리지 않는다. `pkill` 금지.
- 첫 로딩 예산 `initialJsGzipMax` 327,680(지금 약 316,614B). 온라인 코드·Turnstile 로더는 첫 로딩 JS에 넣지 않는다. `yarn size --require-lazy …`(`package.json` `build:ci`)가 통과해야 한다.
- **새 의존성을 더하지 않는다.** `@cloudflare/workers-types`도 쓰지 않고 필요한 D1 타입은 직접 정의한다. QR은 만들지 않는다.
- **저장소에 `wrangler.toml`을 만들지 않는다**(Pages가 대시보드 바인딩을 덮음). D1 바인딩 이름은 `DB`.
- 보관함 형식(`tripmap:library:v2`, schemaVersion 2)·백업 형식·공유 링크(`/view`, `/import`) 형식은 바꾸지 않는다. 기존 약속 링크 `#d=`·`#r=`·`#f=` 읽기와 `반영`은 남긴다.
- `functions/api/**/*.ts`와 `src/server/**`는 `src/` 별칭 없이 상대 경로로 가져온다. `src/server/meet/*`는 Effect Schema를 써도 된다(설계 문서 §남용 방지·보안). 그 밖의 기존 `src/server/*` 파일에 Effect를 들이지 않는다. React·MUI는 서버 코드에서 금지.
- 서버 응답은 모두 `Cache-Control: private, no-store`. 기존 Cache API(`handleGet`)에 넣지 않는다.
- 토큰·IP 원문은 로그·DB·URL 질의 문자열에 남기지 않는다. 주최자 토큰은 URL 해시(`#h=`)로만 전달하고 읽은 뒤 `history.replaceState`로 지운다.
- 사용자 문자열은 React 텍스트로만. `dangerouslySetInnerHTML`·`innerHTML` 금지. 주석·UI 문구는 한국어, 주변 코드 관례(이름·주석 밀도·Effect 사용 방식)를 따른다. `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 고치지 않는다: `playwright.config.ts`의 포트·webServer·globalSetup(새 spec을 `testMatch` 목록에 더하는 것만 허용), `tests/e2e/global-setup*`, `docs/rollback.md`, `perf-budget.json`, `.claude/`.
- 네트워크가 없는 환경에서 실행된다. Turnstile·실제 D1 같은 외부 확인은 하지 말고 결과 보고에 남긴다.
- 과제마다 커밋한다. 메시지는 한국어 conventional(`feat(meet-online): …`), 끝 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/server/meet/db.ts` | `MeetDb` 인터페이스(D1의 필요한 부분), `ensureSchema(db)`(격리마다 한 번, 추가형) |
| `src/server/meet/schema.sql.ts` | 표 정의 SQL 문자열과 `SCHEMA_VERSION = 1` |
| `src/server/meet/tokens.ts` | 토큰 만들기(32바이트 base64url), SHA-256 해시, IP 해시 |
| `src/server/meet/limits.ts` | 일 한도 카운터(`rate_counters`), 동작별 한도 상수 |
| `src/server/meet/turnstile.ts` | Turnstile siteverify 호출(`fetch` 주입) |
| `src/server/meet/handlers.ts` | 요청별 처리(create·get·put·delete·claim·reply·release), 만료·정리, 친구 응답 가리기 |
| `src/server/meet/env.ts` | `MeetEnv` 타입(`DB`, `TURNSTILE_SECRET?`, `IP_HASH_SALT?`, `MEET_ONLINE?`)과 `MeetContext` |
| `src/server/http.ts` | `ApiErrorCode`에 `UNAUTHORIZED`·`CONFLICT`·`ENDED`·`RATE_LIMITED`·`UNAVAILABLE` 추가 |
| `src/domain/meeting/online-doc.ts` | `MeetingDocSchema`·`OnlineReplySchema`·`OnlineStateSchema`(서버·브라우저 공용), `docFromMeeting` |
| `src/domain/meeting/online-merge.ts` | 서버 상태를 보관함 약속에 합치는 순수 연산 `mergeOnline` |
| `functions/api/meet/index.ts`, `functions/api/meet/[id].ts`, `functions/api/meet/[id]/{claim,reply,release}.ts` | Pages 진입점(얇게) |
| `src/services/meet-online/store.ts` | `tripmap:meet-online:v1` 읽기·쓰기 |
| `src/services/meet-online/client.ts` | API 호출(`fetch` 래퍼, 오류 코드 해석) |
| `src/services/meet-online/turnstile-loader.ts` | Turnstile 스크립트 지연 로딩·토큰 받기 |
| `src/sections/meetings/use-online-poll.ts` | 보임·숨김·오프라인·실패 간격을 지키는 10초 확인 훅 |
| `src/sections/meetings/use-online-meeting.ts` | 주최자 쪽: 올리기·다시 올리기·합치기·메뉴 동작 |
| `src/sections/meetings/OnlineHostMenu.tsx` | `다른 기기에서 열기`·`참석자 차지 풀기`·`서버에서 지우기` |
| `src/sections/meetings/OnlineInviteView.tsx` | 친구 화면(차지·좋아요·출발지·자동 저장·확정) |
| `src/sections/meetings/MeetLinkPage.tsx`, `src/routes/{paths,router}.tsx` | `/meet/:id`와 `#h=` 처리 |
| `tests/helpers/sqlite-d1.ts` | `node:sqlite`로 만든 `MeetDb` 가짜 |
| `tests/unit/server/meet-*.test.ts`, `tests/unit/domain/meeting/online-*.test.ts`, `tests/unit/services/meet-online-*.test.ts`, `tests/unit/sections/meetings/online-*.test.tsx` | 단위 시험 |
| `tests/e2e/meet-server.ts`, `tests/e2e/meetings-online.spec.ts` | E2E 가짜 서버(`page.route` → 진짜 처리 코드)와 흐름 시험 |

---

### Task 1: 서버 기반 — DB 인터페이스·표·토큰·한도

**Files:**
- Create: `src/server/meet/db.ts`, `src/server/meet/schema.sql.ts`, `src/server/meet/tokens.ts`, `src/server/meet/limits.ts`, `src/server/meet/env.ts`, `tests/helpers/sqlite-d1.ts`
- Modify: `src/server/http.ts`(오류 코드·`STATUS`)
- Test: `tests/unit/server/meet-db.test.ts`, `tests/unit/server/meet-tokens.test.ts`, `tests/unit/server/meet-limits.test.ts`, 기존 `tests/unit/server/http.test.ts`에 새 코드 상태값 사례

**Interfaces:**
- Produces:
  - `type MeetDb = { prepare(sql: string): MeetStatement; batch(stmts: MeetStatement[]): Promise<unknown[]> }`
  - `type MeetStatement = { bind(...values: (string | number | null)[]): MeetStatement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> }` — D1의 해당 메서드와 같은 모양(D1 바인딩을 그대로 넘길 수 있어야 한다).
  - `ensureSchema(db: MeetDb): Promise<void>` — 모듈 변수로 격리마다 한 번만 실행. 첫 DB에는 `schema_meta` 표가 없으므로 그 읽기 실패(`no such table`)는 버전 0으로 본다. `schema_meta.version`이 없거나 `SCHEMA_VERSION`보다 낮으면 `SCHEMA_STATEMENTS`(설계 문서 §서버 데이터의 `CREATE TABLE/INDEX IF NOT EXISTS`)와 버전 기록을 한 `batch`로. 실패하면 다음 요청에서 다시 시도(메모는 성공 때만). 시험용 `resetSchemaMemo()`도 내보낸다.
  - `SCHEMA_VERSION = 1`, `SCHEMA_STATEMENTS: string[]`
  - `newToken(): string`(32바이트 `crypto.getRandomValues` → base64url, 43자), `hashToken(token: string): Promise<string>`(SHA-256 → base64url), `hashIp(ip: string, salt: string): Promise<string>`
  - `LIMITS = { create: 20, claim: 60, reply: 600, update: 300, read: 5000 } as const`, `type LimitAction = keyof typeof LIMITS`
  - `consumeLimit(db, action: LimitAction, ipHash: string, now: Date): Promise<boolean>` — 키 `'<action>:<ipHash>:<YYYY-MM-DD UTC>'`를 `INSERT … ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`로 올리고 한도 이하면 true. `pruneLimits(db, now)`는 지난 날짜 키를 최대 200개 지운다.
  - `type MeetEnv = { DB: MeetDb; TURNSTILE_SECRET?: string; IP_HASH_SALT?: string; MEET_ONLINE?: string }`, `type MeetContext = { request: Request; env: MeetEnv; waitUntil(p: Promise<unknown>): void; params: Record<string, string | string[]> }`
  - `ApiErrorCode`에 `'UNAUTHORIZED'`(401)·`'CONFLICT'`(409)·`'ENDED'`(410)·`'RATE_LIMITED'`(429)·`'UNAVAILABLE'`(503) 추가.
  - `tests/helpers/sqlite-d1.ts`: `createSqliteD1(): MeetDb & { close(): void }` — `node:sqlite`의 `DatabaseSync(':memory:')` 위에 `MeetDb`를 구현. `batch`는 `BEGIN`/`COMMIT`(실패 시 `ROLLBACK`)로 묶는다. `RETURNING`을 쓰는 `first()`도 동작해야 한다.

- [ ] **Step 1: 실패하는 시험** — `meet-db.test.ts`(`// @vitest-environment node`): `ensureSchema` 두 번 불러도 표가 한 번 생기고 `schema_meta.version = 1`, 첫 실행이 실패(가짜 `batch`가 던짐)하면 다음 호출이 다시 시도, `meeting_tokens_guest` 고유 색인이 같은 `(meeting_id, participant_id)` guest 두 줄을 막음. `meet-tokens.test.ts`: 토큰 43자·base64url 문자만·서로 다름, 같은 입력의 해시가 같고 다른 소금의 IP 해시가 다름. `meet-limits.test.ts`: 한도까지 true, 넘으면 false, 날짜가 바뀌면 다시 셈, `pruneLimits`가 지난 날짜만 지움.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/meet-db.test.ts tests/unit/server/meet-tokens.test.ts tests/unit/server/meet-limits.test.ts` → 실패 확인
- [ ] **Step 3:** 구현. 표 정의는 설계 문서 SQL을 그대로 옮기되 모두 `IF NOT EXISTS`. `rate_counters`도 포함.
- [ ] **Step 4:** 시험 통과, `yarn typecheck` 통과
- [ ] **Step 5:** 커밋 `feat(meet-online): 서버 DB 인터페이스·표·토큰·일 한도`

### Task 2: 공용 문서 스키마와 서버 상태 합치기

**Files:**
- Create: `src/domain/meeting/online-doc.ts`, `src/domain/meeting/online-merge.ts`
- Test: `tests/unit/domain/meeting/online-doc.test.ts`, `tests/unit/domain/meeting/online-merge.test.ts`

**Interfaces:**
- Consumes: `InviteDocSchema`·`inviteFromMeeting`·`ReplyDocSchema`(`src/domain/meeting/link.ts`), `MeetingSchema` 타입·`OriginSchema`(`src/schema/meeting.ts`), `meetingField`·`storeMeeting`·`meetingFailure`(`src/domain/meeting/ops.ts`), `OpCtx`·`OpResult`(`src/domain/library/ops.ts`)
- Produces:
  - `MeetingDocSchema` — `InviteDocSchema`의 필드에서 `format`·`v`·`kind`·`sentAt`을 빼고 `decided: Schema.NullOr(MeetingMemberId)`를 더한 구조체. 같은 참조 검사(참석자·후보 id 중복 없음, `times` 키, 단위)에 `decided`가 후보를 가리키는지를 더한다. 직렬화 64KB(`MEET_DOC_BYTES_MAX = 65_536`) 초과는 거부. 타입 `MeetingDoc`.
  - `docFromMeeting(meeting: Meeting, times: InviteDoc['times'], unit: InviteDoc['unit']): MeetingDoc`(화면 코드의 `MeetingTimes` 타입을 가져오지 않는다 — 도메인은 섹션을 import하지 않음) — `inviteFromMeeting` 결과에서 위 필드를 옮기고 `decided: meeting.decided.value`.
  - `OnlineReplySchema = { participantId: MeetingMemberId, name: MeetingName, origin: NullOr(OriginSchema), likes: Array(MeetingMemberId)(≤8, 중복 없음), times: NullOr(Record(후보 id, cell)), updatedAt: IsoDateTime }`. `origin: null`은 "본문 출발지 그대로". 타입 `OnlineReply`.
  - `ReplyInputSchema = { likes, origin?: NullOr(OriginSchema), times?: NullOr(Record) }` — 친구가 `PUT …/reply`로 보내는 본문(`participantId` 없음).
  - `OnlineStateSchema = { rev: 정수 ≥1, docRev: 정수 ≥1, doc: MeetingDoc, replies: Array(OnlineReply)(≤10), originNames?: Record(참석자 id, MeetingTitle) }`, 타입 `OnlineState`. 친구 응답에서는 남의 `doc.participants[].origin`과 남의 답장 `origin`을 `null`로 바꾸고, 그 출발지 **이름**만 `originNames[참석자 id]`에 둔다(설계 문서 §API: 좌표는 빼고 이름·출발지 이름·소요시간은 준다).
  - `mergeOnline(lib: Library, meetingId: string, state: OnlineState, ctx: OpCtx, syncedAt: string | null): OpResult` —
    `syncedAt`은 이 기기가 서버와 마지막으로 맞춘 시각(마지막으로 성공한 `create`/`update`가 올린 본문의 기준 시각, `OnlineRecord.syncedAt`. 합치기만으로는 올리지 않는다). 처음 담는 기기(주최자 링크)는 `null`.
    1. 약속이 없거나 지워졌으면 `meetingFailure('not-found')`.
    2. `state.replies` 중 보관함 참석자에 없는 `participantId`는 새 참석자 `{ id: participantId, name, origin }`으로 더한다(10명 한도 넘으면 그 답장은 건너뜀).
    3. 각 답장의 `origin`이 null이 아니면 그 참석자 출발지를 바꾼다.
    4. 주최자(`participants[0]`)가 아닌 답장은 `replies[participantId] = { likes(지금 후보만), sentAt: updatedAt, receivedAt: ctx.now }`. 같은 `participantId`의 기존 답장 `sentAt`이 `updatedAt`보다 같거나 새로우면 그대로 둔다(변경 없음이면 필드 시각도 그대로).
    5. 확정(`decided`): 본문 주인은 주최자 기기다. 서버 `state.doc.decided`가 보관함 값과 다르고, `syncedAt !== null`이며 보관함 `decided.updatedAt <= syncedAt`(이 기기가 마지막 동기화 뒤 확정을 바꾸지 않음)일 때만 서버 값으로 맞춘다(주최자의 다른 기기가 확정한 경우). `syncedAt === null`이면 서버 값을 쓴다. 그 밖에는 보관함 값을 지킨다(아직 올리지 않은 이 기기의 확정).
- [ ] **Step 1: 실패하는 시험** — `online-doc.test.ts`: 정상 문서 통과, `decided`가 없는 후보면 거부, 64KB 넘으면 거부, `docFromMeeting`이 참석자 출발지·후보·times·unit·decided를 그대로 옮김, 남는 키(`sentAt`) 거부(`onExcessProperty: 'error'`). `online-merge.test.ts`: 새 참석자 추가, 11번째 참석자 건너뜀, 출발지 변경, 좋아요 중 없는 후보 제외, 같은 `updatedAt` 두 번 합쳐도 보관함이 같은 객체(`===`)를 돌려줌, 주최자 답장은 무시, 확정 동기화 규칙 두 갈래.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/meeting/online-doc.test.ts tests/unit/domain/meeting/online-merge.test.ts` → 실패 확인
- [ ] **Step 3:** 구현. `apply-reply.ts`의 작성 방식(미리보기 규칙·`meetingField` 사용)을 따른다.
- [ ] **Step 4:** 시험 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(meet-online): 서버 약속 문서 스키마와 보관함 합치기`

### Task 3: 서버 처리 — 올리기·읽기·고치기·지우기

**Files:**
- Create: `src/server/meet/handlers.ts`(이 과제에서 create·get·put·delete와 공통 도우미), `src/server/meet/turnstile.ts`
- Test: `tests/unit/server/meet-handlers.test.ts`(`// @vitest-environment node`, `createSqliteD1()` 사용)

**Interfaces:**
- Consumes: Task 1 전부, `MeetingDocSchema`·`OnlineState`(Task 2), `isAllowedOrigin`·`requestOrigin`·`jsonResponse`·`errorResponse`·`ApiError`(`src/server/http.ts`, `src/server/handler.ts`)
- Produces:
  - `type MeetDeps = { fetch: typeof fetch; now(): Date }`
  - `handleCreate(ctx: MeetContext, deps: MeetDeps): Promise<Response>` — 본문 `{ doc, turnstile }`. 순서: 출처 검사 → `MEET_ONLINE === 'off'`면 `503 { reason: 'off' }`(설정 누락 503은 `{ reason: 'config' }`) → `ensureSchema` → IP 해시(`CF-Connecting-IP`, 없으면 `'local'`; 소금 없으면 localhost 출처에서만 `'dev-salt'`, 그 밖엔 503) → `consumeLimit('create')`(넘으면 429) → Turnstile(`TURNSTILE_SECRET` 없으면 localhost 출처일 때만 건너뜀, 그 밖엔 503) → `MeetingDocSchema` 검사(400) → 같은 id가 있으면 409 → `meetings` 넣기(`rev = 1`, `expires_at` 계산) + host 토큰 해시 넣기를 한 `batch` → `ctx.waitUntil`로 만료 정리(`pruneExpired(db, now, 20)`)와 `pruneLimits`. 응답 `201 { id, rev: 1, docRev: 1, hostToken }`. `meetings`에는 `doc_rev INTEGER NOT NULL`(처음 1) 열이 있다(Task 1 표 정의에 추가).
  - `handleGet(ctx, deps)` — `?since=<rev>`. 출처 검사 → `ensureSchema` → 약속 없음 404, 만료(`expires_at <= now`) 410 — **이 두 경우에만** `consumeLimit('read')`를 올리고 넘으면 429(id 추측 막기. 정상 확인마다 D1 쓰기를 쓰지 않기 위해) → `since`가 지금 `rev`와 같으면 `304`(본문 없음) → `Authorization`이 이 약속의 host 토큰이면 전체(`originNames` 없음), 아니면 `redactForGuest(state, guestParticipantId | null)` — 남의 본문·답장 `origin`을 `null`로 바꾸고 이름을 `originNames`에 옮긴 상태(토큰의 참석자 자신 것은 그대로). 응답 `200 OnlineState`.
  - `handleUpdate(ctx, deps)` — host 토큰 필요(없거나 틀리면 401). 본문 `{ doc, baseRev }` — `baseRev`는 **본문 버전 `doc_rev`**다(답장·차지로 오르는 `rev`가 아님. 친구 답장 때문에 주최자 올리기가 충돌하지 않게). `baseRev`가 지금 `doc_rev`와 다르면 `409 { docRev }`. 통과하면 `doc`·`doc_rev+1`·`rev+1`·`updated_at`·`expires_at`을 갱신하고 `200 { rev, docRev }`. `doc.participants`에서 빠진 참석자의 답장 줄과 guest 토큰도 같은 `batch`로 지운다(주최자가 참석자를 지운 경우).
  - `handleDelete(ctx, deps)` — host 토큰 필요. 약속·답장·토큰 지우기 → `204`.
  - `expiresAt(doc: MeetingDoc, updatedAt: Date): string` — `max(doc.at의 날짜·시각을 Asia/Seoul로 읽은 시각, updatedAt) + 30일`의 ISO. `doc.at`이 null이면 `updatedAt + 30일`.
  - `pruneExpired(db, now, max): Promise<number>` — 만료된 약속을 `max`개까지 답장·토큰과 함께 지움.
  - `verifyTurnstile(token: string, secret: string, ip: string | null, fetchFn: typeof fetch): Promise<boolean>` — `https://challenges.cloudflare.com/turnstile/v0/siteverify`에 `application/x-www-form-urlencoded`(`secret`, `response`, `remoteip`) POST, `success === true`만 통과. 네트워크 오류는 false.
  - 모든 응답에 `Cache-Control: private, no-store`.
- [ ] **Step 1: 실패하는 시험** — 올리기 성공(201, 토큰 43자, DB에는 해시만), 같은 id 409, 스키마 오류 400, 허용하지 않는 출처 403, `MEET_ONLINE=off` 503, 운영 출처에서 시크릿 없음 503, localhost에서 시크릿 없으면 Turnstile 건너뜀, Turnstile 실패(가짜 fetch가 `success:false`) 403 또는 400(설계 문서 문구에 맞춰 `BAD_REQUEST`), 21번째 올리기 429, `MEET_ONLINE=off`는 `reason: 'off'`. 읽기: 304, 404, 410, 친구 응답에서 남의 좌표가 `null`이고 출발지 이름은 `originNames`에 있음, 자기 출발지는 그대로, host 토큰이면 전체, `Cache-Control` 확인. 고치기: 401, `baseRev`(doc_rev) 불일치 409, 친구 답장으로 `rev`만 오른 뒤에도 `baseRev = docRev`면 성공(409 아님), 성공 시 `rev`·`docRev` 증가, 빠진 참석자 답장 삭제. 읽기 한도: 정상 읽기·304는 `rate_counters`를 쓰지 않음, 404가 5,001번째면 429. 지우기 204 후 읽기 404. `expiresAt`: 일시가 미래면 일시+30일, 과거면 갱신+30일. `pruneExpired`가 20개까지만 지움.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/meet-handlers.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(meet-online): 약속 올리기·읽기·고치기·지우기 서버 처리`

### Task 4: 서버 처리 — 참석자 고르기·답장·풀기, Pages 진입점

**Files:**
- Modify: `src/server/meet/handlers.ts`
- Create: `functions/api/meet/index.ts`, `functions/api/meet/[id].ts`, `functions/api/meet/[id]/claim.ts`, `functions/api/meet/[id]/reply.ts`, `functions/api/meet/[id]/release.ts`
- Modify: `package.json`의 `dev:full`(`wrangler pages dev --d1 DB --proxy 5173 -- …` — 기존 인자 순서 유지, `--d1 DB`만 추가)
- Test: `tests/unit/server/meet-handlers.test.ts`에 이어서, `tests/unit/server/functions.test.ts`에 진입점 연결 사례

**Interfaces:**
- Consumes: Task 3
- Produces:
  - `handleClaim(ctx, deps)` — 본문 `{ participantId }` 또는 `{ newName }`(정확히 하나). `consumeLimit('claim')`. `participantId`가 본문 참석자가 아니면 404. 그 참석자의 guest 토큰이 이미 있으면 `409 { reason: 'taken' }`. 주최자(`participants[0]`)는 고를 수 없음 409 `{ reason: 'host' }`. `newName`이면 이름(NFC·공백 정리) 같은 참석자가 있으면 그 사람으로, 없으면 새 id(8자 `a-z0-9`)로 `meeting_replies`에 `{ name, origin: null, likes: [], times: null }` 줄을 만들되 본문 참석자 + 답장의 새 참석자가 10명을 넘으면 `409 { reason: 'full' }`. 성공 시 guest 토큰 해시 저장 + `rev+1` → `200 { participantId, guestToken, rev }`.
  - `handleReply(ctx, deps)` — guest 토큰 필요(401). `consumeLimit('reply')`. 본문 `ReplyInputSchema`. 좋아요 중 본문 후보가 아닌 id는 400. 토큰의 참석자 줄만 `INSERT … ON CONFLICT DO UPDATE`(이름은 본문 참석자 이름 또는 claim 때 이름). `rev+1`, `updated_at`·`expires_at` 갱신 → `200 { rev }`.
  - `handleRelease(ctx, deps)` — host 토큰 필요. 본문 `{ participantId }`면 그 guest 토큰을 지우고 `rev+1`(답장 줄은 남김) → `200 { rev }`. 본문 `{ host: true }`면 기존 host 토큰을 지우고 새 토큰 발급 → `200 { rev, hostToken }`.
  - Pages 진입점은 `MeetContext`를 만들고(`params` 포함) `{ fetch: globalFetch, now: () => new Date() }`로 처리 함수를 부르기만 한다. 경로·메서드:
    - `functions/api/meet/index.ts`: `onRequestPost = handleCreate`
    - `functions/api/meet/[id].ts`: `onRequestGet = handleGet`, `onRequestPut = handleUpdate`, `onRequestDelete = handleDelete`
    - `functions/api/meet/[id]/claim.ts`: `onRequestPost`, `reply.ts`: `onRequestPut`, `release.ts`: `onRequestPost`
    - 지원하지 않는 메서드는 Pages 기본(405)에 맡긴다.
  - `params.id`가 `MeetingId` 형식이 아니면 400(처리 함수 공통 도우미 `readMeetingId`).
- [ ] **Step 1: 실패하는 시험** — 고르기 성공·이미 차지 409·주최자 409·없는 참석자 404·새 이름(같은 이름이면 기존 참석자)·10명 초과 409·61번째 429. 답장: 토큰 없음 401, 남의 토큰으로 다른 참석자 줄을 못 고침(토큰의 참석자 줄만 바뀜), 없는 후보 400, 성공 시 `rev` 증가와 읽기 결과 반영. 풀기: 풀고 나면 같은 참석자를 다른 토큰이 고를 수 있음, 이전 guest 토큰으로 답장 401, 주최자 토큰 다시 발급 후 이전 host 토큰 401. `functions.test.ts`: 각 진입점이 `env.DB`(가짜 D1)를 받아 201/200을 돌려주는 연결 사례 1개씩.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/meet-handlers.test.ts tests/unit/server/functions.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`, `yarn lint`
- [ ] **Step 5:** 커밋 `feat(meet-online): 참석자 고르기·답장·풀기와 Pages 진입점`

### Task 5: 브라우저 저장·API 클라이언트·10초 확인 훅

**Files:**
- Create: `src/services/meet-online/store.ts`, `src/services/meet-online/client.ts`, `src/services/meet-online/turnstile-loader.ts`, `src/sections/meetings/use-online-poll.ts`
- Test: `tests/unit/services/meet-online-store.test.ts`, `tests/unit/services/meet-online-client.test.ts`, `tests/unit/sections/meetings/online-poll.test.tsx`

**Interfaces:**
- Consumes: `OnlineStateSchema`·`MeetingDoc`·`ReplyInputSchema`(Task 2), 서버 응답 모양(Task 3·4), `HELP_SEEN_KEY` 저장 방식(`src/services/help-seen.ts`, 깨진 값·막힌 저장소 처리 관례)
- Produces:
  - `MEET_ONLINE_KEY = 'tripmap:meet-online:v1'`
  - `type OnlineRecord = { hostToken?: string; guest?: { participantId: string; token: string }; lastRev: number; docRev?: number; syncedAt?: string; ended?: true }` — `syncedAt`은 `mergeOnline`의 다섯째 인자(Task 2).
  - `readOnline(id): OnlineRecord | null`, `writeOnline(id, record: OnlineRecord): void`, `removeOnline(id): void`, `allOnline(): Record<string, OnlineRecord>` — 깨진 값은 빈 기록, 저장소가 막히면 페이지 메모리에만. 약속 200개 한도 넘는 기록은 오래된 것부터 버린다.
  - `isLinkMeeting(meeting: Meeting, record: OnlineRecord | null): boolean` — `record?.hostToken`이 없고 주최자가 아닌 참석자의 `replies`가 하나라도 있으면 true(설계 문서 §브라우저 저장).
  - `type OnlineError = { code: 'offline' | 'unauthorized' | 'conflict' | 'ended' | 'not-found' | 'rate-limited' | 'unavailable' | 'switched-off' | 'invalid' | 'turnstile' | 'taken' | 'host' | 'full'; rev?: number }` — 503 `reason: 'off'`는 `switched-off`, 그 밖의 503은 `unavailable`.
  - `meetApi` — 모두 `Promise<{ ok: true; value } | { ok: false; error: OnlineError }>`:
    - `create(doc: MeetingDoc, turnstile: string) → { id, rev, docRev, hostToken }`
    - 오류 본문은 `{ error: { code, message }, reason?, rev?, docRev? }` 모양이다(`reason`·`rev`·`docRev`는 최상위). `reason`으로 `taken`·`host`·`full`·`off`·`config`·`turnstile`을 가른다.
    - `get(id, since: number | null, token: string | null) → OnlineState | 'unchanged'`
    - `update(id, doc, baseDocRev, hostToken) → { rev, docRev }`
    - `remove(id, hostToken) → void`
    - `claim(id, who: { participantId } | { newName }) → { participantId, guestToken, rev }`
    - `reply(id, input: ReplyInput, guestToken) → { rev }`
    - `release(id, body: { participantId } | { host: true }, hostToken) → { rev, hostToken? }`
    - 응답 본문은 스키마로 검사(틀리면 `invalid`). `fetch` 실패는 `offline`. `credentials: 'same-origin'`, 토큰은 `Authorization: Bearer`.
  - `getTurnstileToken(): Promise<string>` — `import.meta.env.VITE_TURNSTILE_SITE_KEY`가 비면 `'dev'`를 돌려준다(localhost 서버가 건너뜀). 있으면 `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`를 한 번만 넣고, 화면 밖 컨테이너에 `execution: 'execute'`·보이지 않는 위젯으로 토큰을 받는다(실패·30초 초과는 reject).
  - `useOnlinePoll(options: { enabled: boolean; tick: () => Promise<'ok' | 'error'> }): { lastOkAt: number | null; failing: boolean }` — `enabled`이고 `document.visibilityState === 'visible'`이며 `navigator.onLine`일 때만 10초마다 `tick`. 연속 실패면 10→30→60초. `visibilitychange`로 보이게 되면 바로 한 번, `online` 이벤트에도 바로 한 번. 겹쳐 부르지 않는다(실행 중이면 건너뜀). 언마운트 때 정리.
- [ ] **Step 1: 실패하는 시험** — store: 왕복, 깨진 JSON, 막힌 저장소(`localStorage.setItem`이 던짐), 200개 초과 정리, `isLinkMeeting` 세 갈래. client: 가짜 `fetch`로 각 메서드의 경로·메서드·헤더, 304 → `'unchanged'`, 상태 코드별 `OnlineError`(409 본문 `reason: 'taken'` → `taken`), 응답 스키마 오류 → `invalid`, fetch 거절 → `offline`. poll(가짜 타이머): 보일 때 10초 간격, 숨기면 멈춤·보이면 즉시, 오프라인 멈춤·`online`에 즉시, 실패 간격 10/30/60, 성공하면 10초로 돌아옴, 실행 중 겹침 없음.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/meet-online-store.test.ts tests/unit/services/meet-online-client.test.ts tests/unit/sections/meetings/online-poll.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(meet-online): 브라우저 저장·API 클라이언트·10초 확인`

### Task 6: 주최자 화면 — 올리기·자동 집계·메뉴

**Files:**
- Create: `src/sections/meetings/use-online-meeting.ts`, `src/sections/meetings/OnlineHostMenu.tsx`
- Modify: `src/sections/meetings/MeetingResults.tsx`(`후보 링크 보내기`·`확정 링크 보내기`), `src/sections/meetings/MeetingEditorPage.tsx`(메뉴·상태 표시 자리), `src/sections/meetings/share-link.ts`(짧은 링크 공유 함수 추가), `src/sections/meetings/MeetingsPage.tsx`(목록에 "공유 중"/"공유 끝남" 표시)
- Test: `tests/unit/sections/meetings/online-host.test.tsx`

**Interfaces:**
- Consumes: Task 2(`docFromMeeting`, `mergeOnline`), Task 5 전부, `useMeeting`(`src/sections/meetings/use-meeting.ts`), `useMeetingCompute`의 `times`·`unit`, `shareLink`(`share-link.ts`), `appUrl`(`src/share-viewer/encode.ts`)
- Produces:
  - `useOnlineMeeting(meeting: Meeting, compute: { times: MeetingTimes; unit: 'min' | 'm'; pending: boolean })`(`MeetingTimes`는 `use-meeting-compute.ts`의 타입, 섹션 안이라 괜찮다): { mode: 'link' | 'local' | 'online' | 'ended'; share(): Promise<void>; shareFinal(): Promise<void>; openOnOtherDevice(): Promise<void>; releaseParticipant(pid: string): Promise<void>; removeFromServer(): Promise<void>; status: { lastOkAt: number | null; failing: boolean } }`
    - `mode`: `isLinkMeeting`이면 `'link'`(지금 동작 그대로), 기록이 `ended`면 `'ended'`, host 토큰이 있으면 `'online'`, 아니면 `'local'`(아직 안 올림).
    - `share()`: `'link'`면 기존 `shareMeetingDoc(inviteFromMeeting(…))`. `'local'`이면 `getTurnstileToken()` → `meetApi.create(docFromMeeting(…))` → 기록 저장 → `shareLink(`${app}/meet/${id}`, 제목)`. 오류 코드별 안내는 설계 문서 §오류·장애 문구 그대로(`unavailable`·`offline`이면 "지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요"). `switched-off`면 서버 기능 스위치가 꺼진 것이므로 알림 없이 기존 해시 링크(`shareMeetingDoc(inviteFromMeeting(…))`)로 공유한다(설계 문서 §호환·롤백의 비상구). 기록은 만들지 않는다. `'online'`이면 올리지 않고 짧은 링크만 공유.
    - 자동 다시 올리기: `'online'`이고 `compute.pending`이 false일 때, `docFromMeeting` 결과의 JSON이 마지막으로 올린 JSON과 다르면 1초 모았다가 `update(id, doc, record.docRev, hostToken)`. 성공하면 `docRev`·`syncedAt` 저장. `409`(주최자의 다른 기기가 본문을 바꾼 경우)면 `get(id, null, hostToken)` → `mergeOnline` → 받은 `docRev`로 다시 `update`(한 번만 재시도).
    - 10초 확인: `'online'`이고 화면이 보일 때 `useOnlinePoll`로 `get(id, lastRev, hostToken)` → 바뀌었으면 `run((lib, ctx) => mergeOnline(lib, id, state, ctx, record.syncedAt ?? null))`, `lastRev` 저장. `syncedAt`은 성공한 `create`/`update`의 응답 시각(요청 직전에 잡은 본문의 기준 시각)으로만 올린다 — 합치기만으로 올리면 아직 안 올린 확정이 "동기화됨"으로 보이게 된다. `ended`/`not-found`면 기록에 `ended: true`.
    - `shareFinal()`: `'online'`이면 확정은 자동 다시 올리기로 반영되므로 짧은 링크를 공유(친구 화면이 확정 화면으로 바뀜). `'link'`면 기존 `finalFromMeeting` 링크.
    - `openOnOtherDevice()`: `${app}/meet/${id}#h=${hostToken}`을 `shareLink`로. 메뉴에 `주최자 링크 다시 발급`(→ `release({ host: true })` → 새 토큰 저장, 안내 "이전 주최자 링크는 이제 쓸 수 없어요")도 둔다.
    - `releaseParticipant(pid)`: 확인 창 뒤 `release({ participantId })`.
    - `removeFromServer()`: 확인 창 뒤 `remove` → 기록에 `ended: true`(토큰 지움). 보관함 약속은 그대로.
  - `OnlineHostMenu`: `mode === 'online'`일 때 약속 편집 화면 머리글 메뉴(기존 메뉴 관례를 따른다)에 세 항목. `참석자 차지 풀기`는 참석자 목록에서 고르는 작은 창.
  - 상태 줄: `'online'`이면 집계표 위에 "친구 답장이 자동으로 모여요 · ○분 전 기준"(`failing`이면 "연결이 원활하지 않아요 · ○분 전 기준"). `'ended'`면 "공유가 끝난 약속이에요".
  - `'online'` 약속에서는 `ReplyImport`로 가는 안내·`반영` 문구를 보이지 않는다(링크 방식 약속은 그대로).
- [ ] **Step 1: 실패하는 시험** — `online-host.test.tsx`(가짜 `meetApi`·가짜 저장소·가짜 타이머): 링크 방식 약속은 기존 해시 링크 공유, 처음 공유 시 create 한 번 후 짧은 링크 공유와 기록 저장, 두 번째 공유는 create 없이 링크만, create 실패 코드별 알림 문구, `switched-off`면 해시 링크로 공유하고 기록 없음, 참석자 수정 뒤 1초 후 update 한 번, 409면 get→merge→update, 확인 결과의 새 답장이 보관함 약속 `replies`에 들어감, 확정 직후(올리기 전) 확인이 돌아도 확정이 지워지지 않음, 성공한 update·합치기 뒤 기록의 `syncedAt` 갱신, ended 응답이면 "공유가 끝난 약속이에요", 주최자 링크가 `#h=` 형식, 다시 발급 후 기록의 토큰이 바뀜, 서버에서 지우기 후 `ended`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/meetings/online-host.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현. 기존 `tests/unit/sections/meetings/*` 시험이 깨지면 링크 방식 약속 동작이 바뀐 것이니 고치지 말고 구현을 맞춘다.
- [ ] **Step 4:** 시험 통과(`yarn vitest run tests/unit/sections/meetings`), `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(meet-online): 주최자 온라인 공유·자동 집계·메뉴`

### Task 7: 친구 화면 `/meet/:id`와 주최자 링크

**Files:**
- Create: `src/sections/meetings/OnlineInviteView.tsx`
- Modify: `src/routes/paths.ts`(`meetOnline: (id: string) => `/meet/${id}``), `src/routes/router.tsx`(`/meet/:id` → 같은 `MeetLinkPage` 지연 덩어리), `src/sections/meetings/MeetLinkPage.tsx`(경로에 id가 있으면 온라인 흐름), `src/sections/meetings/FinalView.tsx`(문서 대신 서버 상태로도 그릴 수 있게 props를 넓힘 — 기존 `FinalDoc` 경로는 유지), `src/sections/meetings/meet-drafts.ts`(온라인 답장 초안 재사용)
- Test: `tests/unit/sections/meetings/online-invite.test.tsx`, 기존 `tests/unit/routes/*`에 `/meet/:id` 지연 덩어리 사례

**Interfaces:**
- Consumes: Task 5, `InviteView`의 출발지 고르기·좋아요 UI 조각(`OriginPicker`, `CandidateTally`, `TimeCells`), `useMeetingCompute`(자기 줄 계산), `paths.meeting(id)`
- Produces:
  - `MeetLinkPage`: `useParams().id`가 있으면
    - 해시가 `#h=<토큰>`이면 `history.replaceState`로 해시를 지운 뒤 `meetApi.get(id, null, 토큰)` → 성공하면 이 기기 보관함에 약속을 담고(없으면 `createMeeting` 대신 서버 본문으로 약속 객체를 만들어 `storeMeeting`, 있으면 `mergeOnline`) 기록에 `hostToken` 저장 → `navigate(paths.meeting(id), { replace: true })`. 401이면 "주최자 링크가 더 이상 쓸 수 없어요" 안내.
    - 아니면 `<OnlineInviteView id={id} />`.
    - 경로 id가 `MeetingId` 형식이 아니면 기존 "링크를 읽지 못했어요".
    - `/meet`(id 없음)의 기존 해시 처리는 그대로.
  - `OnlineInviteView({ id })`:
    - 처음 `get(id, null, guest?.token ?? null)`. 404·410이면 "끝난 약속이에요"와 약속 목록 단추.
    - 기록에 `guest`가 없으면 "나는 누구?"(본문 참석자 중 주최자 제외 + `목록에 없어요`). 고르면 `claim` → 기록에 `guest` 저장. `taken`이면 "다른 기기에서 이미 답했어요. 주최자에게 풀어 달라고 하세요", `full`이면 "참석자가 가득 찼어요".
    - 고른 뒤: 후보 지도·목록·좋아요(다른 사람 좋아요 집계 포함, 답장 줄의 `likes`로 계산), 참석자 목록은 이름과 `originNames`의 출발지 이름·소요시간만(남의 좌표가 없으므로 지도에 남의 출발지 표시는 없음), 내 출발지(바꾸면 `useMeetingCompute`로 내 줄 계산). 좋아요·출발지·내 줄 소요시간은 바뀔 때 1초 모았다가 `reply`. 실패하면 `meet-drafts`에 남기고 다음 확인 때 다시 보냄. 401이면 기록의 `guest`를 지우고 "나는 누구?"로.
    - `useOnlinePoll`로 10초 확인. `doc.decided`가 생기면 `FinalView`를 그린다(참석자별 길찾기는 받은 본문의 내 출발지와 확정 장소로. 남의 좌표가 없으므로 남의 길찾기 단추는 보이지 않는다).
    - 화면 하단에 "○분 전 기준" 표시.
- [ ] **Step 1: 실패하는 시험** — `online-invite.test.tsx`(가짜 `meetApi`): 처음 보면 "나는 누구?", 고르면 기록 저장 후 좋아요 화면, `taken` 문구, 좋아요 두 번 누르면 1초 뒤 reply 한 번(좋아요 둘), reply 실패 시 초안 저장, 401이면 다시 "나는 누구?", 확정된 상태를 받으면 확정 화면, 410이면 "끝난 약속이에요". `MeetLinkPage` `#h=` 사례: 해시가 지워지고(`history.replaceState` 호출) 보관함에 약속이 생기며 `/meetings/<id>`로 이동, 401 안내. 라우터: `/meet/abcdefghij`가 `MeetLinkPage` 지연 덩어리로 열림.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/meetings/online-invite.test.tsx tests/unit/routes` → 실패 확인
- [ ] **Step 3:** 구현. 기존 `InviteView`를 복사하지 말고 공통 조각을 나눠 쓴다(필요하면 `InviteView`에서 표시용 하위 컴포넌트를 꺼내되 링크 방식 동작은 바꾸지 않는다).
- [ ] **Step 4:** 시험 통과(`yarn vitest run tests/unit/sections/meetings tests/unit/routes`), `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(meet-online): 친구 화면과 주최자 링크`

### Task 8: E2E — 주최자·친구 두 문맥 흐름

**Files:**
- Create: `tests/e2e/meet-server.ts`, `tests/e2e/meetings-online.spec.ts`
- Modify: `playwright.config.ts`(세 프로젝트의 `testMatch`에 `'meetings-online.spec.ts'`만 추가)

**Interfaces:**
- Consumes: Task 1~4 서버 처리 코드, `createSqliteD1()`(`tests/helpers/sqlite-d1.ts`), 기존 `tests/e2e/fixtures.ts`의 경로·검색 녹화 응답 도우미
- Produces:
  - `installMeetServer(context: BrowserContext, server: MeetServer)` — `context.route('**/api/meet**', …)`로 요청을 `Request`로 바꿔 `handleCreate/handleGet/…`에 넘기고(`env = { DB, MEET_ONLINE: 'on' }`, 시크릿 없음 → localhost라 Turnstile 건너뜀), 응답을 `route.fulfill`로 돌려준다. 경로·메서드 연결은 `functions/api/meet/*`와 같게.
  - `createMeetServer(): MeetServer` — 시험 하나에 DB 하나. 여러 문맥이 같은 서버를 공유.
- [ ] **Step 1: 시험 작성** — `meetings-online.spec.ts`(desktop 프로젝트 기준, 모바일 프로젝트에는 `@desktop` 표시로 제외 가능):
  1. 주최자 문맥: 약속 만들기 → 참석자 둘 추가 → 후보 담기 → `후보 링크 보내기` → 클립보드(또는 공유 가짜)에서 `/meet/<id>` 얻기.
  2. 친구 문맥: 그 주소 열기 → "나는 누구?"에서 참석자 고르기 → 후보 하나 좋아요.
  3. 주최자 화면에서 시계를 앞당겨(`page.clock`) 10초 확인 → 집계표에 친구 좋아요가 보임, 보관함 `localStorage`의 약속 `replies`에 친구가 있음.
  4. 세 번째 문맥에서 같은 참석자 고르기 → "다른 기기에서 이미 답했어요" 문구.
  5. 주최자 확정 → 친구 문맥에서 10초 뒤 확정 화면.
  6. 주최자 `다른 기기에서 열기` 링크를 네 번째 문맥에서 열기 → 주소에 `#h=`가 남지 않고 `/meetings/<id>`에 같은 약속.
- [ ] **Step 2:** `E2E_PORT=5175 yarn test:e2e --project=desktop tests/e2e/meetings-online.spec.ts` → 통과 확인. Codex 환경에서 포트를 열 수 없으면 실행하지 말고 보고에 남긴다(Claude가 직접 돌린다).
- [ ] **Step 3:** 기존 `meetings.spec.ts`도 그대로 통과하는지 같은 방식으로 확인(링크 방식 약속 흐름이 바뀌지 않았는지). 기존 spec이 "새 약속의 후보 링크"를 해시 링크로 기대하면, 그 시험의 약속을 링크 방식 조건(다른 참석자 답장 있음)으로 만들거나 온라인 흐름으로 옮긴다 — 어느 쪽인지 보고에 적는다.
- [ ] **Step 4:** 커밋 `test(e2e): 약속 온라인 집계 흐름`

### Task 9: 문서·도움말·전체 검증

**Files:**
- Modify: `docs/development.md`(서버 함수 절: `/api/meet*`, D1 바인딩 `DB`·시크릿 `TURNSTILE_SECRET`·`IP_HASH_SALT`·환경 변수 `MEET_ONLINE`·`VITE_TURNSTILE_SITE_KEY`, `wrangler.toml`을 두지 않는 이유, 로컬 `yarn dev:full`의 `--d1 DB`, 함수 코드 규칙 "React·MUI·Effect를 가져오지 않습니다"에 `src/server/meet/*`의 Effect Schema 예외), `scripts/motion/help-pages.mjs`의 약속 도움말 정의(답장 링크 대신 자동 집계, 주최자 링크, 참석자 차지 풀기, 30일 뒤 서버 사본 삭제) → `yarn build:motion`으로 `docs/help/*.md`·`public/help/img/*.svg`·`src/sections/help/help-content.ts` 다시 만들기, `README.md`의 약속 소개 문장(답장 링크 언급이 있으면)
- Test: 전체

- [ ] **Step 1:** 문서·도움말 고치기, `yarn build:motion`
- [ ] **Step 2:** `yarn build:ci`(지도 키 없이도 됨) → 시험·크기 검사 통과 확인. 첫 로딩 JS gzip 값을 보고에 적는다.
- [ ] **Step 3:** `yarn validate`, `yarn lint`, `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음
- [ ] **Step 4:** 커밋 `docs(meet-online): 개발 문서·약속 도움말`

## 실행 뒤 Claude가 할 일(계획 밖, 순서)

1. E2E 직접 실행: `E2E_PORT=5175 yarn test:e2e`(전체). 포트 5173·5174 서버는 건드리지 않는다.
2. 로컬 실제 함수 확인: `yarn dev:full`(8788)로 로컬 D1에 약속 올리기·읽기 한 번(curl, `Origin: http://localhost:8788`).
3. PR 열기 → 메모리 규칙대로 `codex review --base origin/main`(gpt-6.1-sol high) 반복 → 지적 없음.
4. 사용자 할 일(설계 문서 §사용자가 할 일) 안내. D1 두 개·바인딩·Turnstile 위젯과 `VITE_TURNSTILE_SITE_KEY`·시크릿 두 개가 들어가기 전에는 운영에서 `POST /api/meet`가 503을 돌려주므로 **설정 전에는 병합하지 않는다**(병합하면 새 약속 공유가 막힘). 설정 확인 뒤 미리보기 배포에서 CPU 시간·흐름 확인 → 병합 → 태그·Release·`docs/rollback.md` PR.
