# 여행 갱신 공유(2A) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여행 일정을 갱신 링크(`/view#t=<id>.<토큰>`)로 보내, 소유자가 고친 일정이 받은 사람의 보기 화면에 10초 안팎으로 들어오게 한다(서버 로드맵 2A).

**Architecture:** Pages Functions(`functions/api/trip-live/*`)가 처리 코드(`src/server/trip-live/handlers.ts`)를 부르고, 처리 코드는 약속의 `MeetDb`·`ensureSchema`·`consumeLimit`·`hashToken`·`verifyTurnstile`·`withRequest`를 같이 쓴다. 서버 문서 `LiveTripDoc`은 지금의 일정 공유 문서(`ShareDocV2`)에 Day·Stop 안정 id를 더한 것이고, 서버·보기 화면·앱이 같은 Effect 없는 검사 `parseLiveDoc`를 쓴다. 소유자 기기는 고친 뒤 자동으로 `PUT`하고, 보기 화면(`/view`, 별도 번들)은 보이는 동안 10초마다 `since=<rev>`로 확인한다.

**Tech Stack:** React 19, MUI 7, Jotai, Effect 4.0.2(앱·서버 입력 봉투만), Vitest, Playwright, Cloudflare Pages Functions + D1, Node 24 `node:sqlite`(시험 전용).

**설계 문서:** `docs/superpowers/specs/2026-10-29-trip-live-share-design.md` — 이 계획과 다르면 설계 문서가 맞다. 모든 과제 전에 한 번 읽는다. 본보기로 `docs/superpowers/specs/2026-10-25-meeting-online-design.md`, `docs/superpowers/specs/2026-10-28-share-short-link-design.md`도 읽는다.

**작업 위치:** 워크트리 `/Users/shinchoonho/01.workspace/01.repositories/.worktrees/landmark-trip-live-share`, 브랜치 `feat/trip-live-share`(기반 `origin/main` `fb0fee5`). 원본 체크아웃·다른 워크트리는 고치지 않는다.

## Global Constraints

- 셸: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`, Yarn 1.22.22. 토큰 없이 설치된 트리에서 yarn 명령이 `Failed to replace env in config`로 멈추면 `export GITHUB_PACKAGES_TOKEN=`(빈 값)을 먼저 둔다. 토큰 값은 출력하지 않는다.
- 포트 5173·5174 서버는 띄우지도 죽이지도 않는다. `pkill` 금지. 개발 서버가 필요하면 4180~4199(Vite)·8790~8799(wrangler)를 쓰고 자기가 띄운 프로세스만 PID로 끈다. E2E는 `E2E_PORT=4181`.
- 첫 로딩 예산 `initialJsGzipMax` 327,680. 새 화면은 지연 청크로만 들어온다. `package.json` `build:ci`에 `--require-lazy TripLiveShareDialog --require-lazy TripLiveLinkPage`를 더하고 통과해야 한다. `perf-budget.json`은 고치지 않는다.
- **새 의존성을 더하지 않는다.** `@cloudflare/workers-types`도 쓰지 않는다. **저장소에 `wrangler.toml`을 만들지 않는다.**
- 보관함 형식(`tripmap:library:v2`, schemaVersion 2)·백업 형식·공유 문서 형식(`ShareDoc` v1·v2)·`/view#d=`·`/import#d=`·`/s/<id>` 동작은 바꾸지 않는다.
- `functions/**`와 `src/server/**` 파일은 서로를 상대 경로로 가져온다. 거기서 가져오는 도메인 모듈 안의 `src/` 별칭은 지금처럼 둔다(약속 `src/domain/meeting/online-doc.ts`가 이미 그렇다). React·MUI는 서버 코드에서 금지. `src/domain/trip-live/live-doc.ts`와 `src/share-viewer/**`는 Effect·React를 가져오지 않는다(`import type`만 허용).
- 파일 이름에 `.sql`·`.txt`·`.html`·`.bin`·`.wasm`이 중간에 들어가면 안 된다(`tests/unit/server/module-imports.test.ts`).
- D1 스키마: `src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에만** 더하고 `SCHEMA_VERSION = 3`. 기존 문장은 건드리지 않는다. `ALTER TABLE` 금지.
- 서버 응답은 모두 `Cache-Control: private, no-store`. 기존 Cache API(`handleGet` in `src/server/handler.ts`)에 넣지 않는다.
- 토큰·IP 원문은 로그·URL 질의 문자열에 남기지 않는다. 소유자 토큰은 `#h=`로만 전달하고 읽은 뒤 `history.replaceState`로 지운다. 보기 토큰은 `/view#t=` 해시에만 둔다.
- 사용자 문자열은 React 텍스트·`textContent`로만. `dangerouslySetInnerHTML`·`innerHTML` 금지. 주석·UI 문구는 한국어, 주변 코드 관례를 따른다. `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 공용 문서(`docs/development.md`·`README.md`·`scripts/motion/help-pages.mjs`)는 **자기 절·자기 줄만 더하고** 기존 줄은 고치지 않는다(다른 기능 브랜치와 병합 충돌 최소화). `docs/rollback.md`는 고치지 않는다.
- 고치지 않는다: `playwright.config.ts`의 포트·webServer·globalSetup(desktop `testMatch`에 새 spec 한 줄 더하기만 허용), `tests/e2e/global-setup*`, `perf-budget.json`, `.claude/`, 다른 기능의 서버 처리 코드 동작(아래 Task 2의 `readLimitedJson` 내보내기는 동작 변경 없음).
- 원격 D1·`wrangler secret put`·`wrangler pages deploy`·외부 계정·키 만들기 금지. Codex 샌드박스에서 네트워크·포트가 막히면 그 검증은 실행하지 말고 결과 보고에 남긴다(Claude가 직접 돌린다).
- 과제마다 커밋한다. 메시지는 한국어 conventional(`feat(trip-live): …`, `test(e2e): …`, `docs(trip-live): …`), 끝 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. push하지 않는다.

## Review Focus

검토자는 아래를 특히 본다.

1. 조용한 유실이 없는가: 두 소유자 기기의 `409` 처리, 소유자 링크로 담은 직후 자동 반영이 일어나지 않는가(`publishedKey`), 응답이 사라진 만들기·링크 다시 만들기 재시도가 같은 결과를 주는가.
2. 권한: 보기 토큰으로 `PUT`·`rotate`·`DELETE`가 막히는가, 소유자에게만 `viewToken`·`sourceTripId`를 주는가, 철회 뒤 이전 토큰이 즉시 `401`인가.
3. 기능 스위치 `TRIP_SHARE_LIVE=off`가 만들기·올리기만 막고 읽기·지우기·`rotate`는 살려 두는가.
4. 첫 로딩: `TripLiveShareDialog`·`TripLiveLinkPage`가 첫 청크에 들어오지 않는가, 보기 화면 번들에 Effect·React가 들어가지 않는가.
5. 요청 예산: 보기 화면이 숨겨지면 멈추고 5분 손대지 않으면 60초로 늦추는가, `304`가 D1 문서를 읽지 않는가, 경로 재조회만으로는 올리지 않는가(편집 지문).
6. 스키마: `SCHEMA_STATEMENTS` 끝에만 더했는가, 모두 `IF NOT EXISTS`인가, `meet-db.test.ts`의 버전 기대가 3인가.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/domain/trip-live/live-doc.ts` | 상수, `LiveTripDoc` 타입, `parseLiveDoc`, `liveExpiresAt`, `alignDayIds`, `liveLinks`, `readLiveHash`(서버·보기 화면·앱 공용, Effect 없음) |
| `src/domain/trip-live/build-live-doc.ts` | `buildLiveTripDoc`, `fitLiveDoc`, `liveEditKey`, `ESTIMATE_ONLY` |
| `src/domain/trip-live/import-live.ts` | `importLiveTrip`(공개본을 새 여행으로) |
| `src/server/meet/schema-sql.ts` | 표 두 개 추가, `SCHEMA_VERSION = 3` |
| `src/server/meet/limits.ts` | `tripCreate`·`tripUpdate`·`tripRotate`·`tripRead` |
| `src/server/meet/env.ts` | `TRIP_SHARE_LIVE?: string` |
| `src/server/share/handlers.ts` | `readLimitedJson` 내보내기(한도 인자) |
| `src/server/trip-live/handlers.ts` | create·get·update·rotate·delete, 만료 정리 |
| `functions/api/trip-live/index.ts`, `functions/api/trip-live/[id].ts`, `functions/api/trip-live/[id]/rotate.ts` | Pages 진입점 |
| `src/services/trip-live/tokens.ts` | `newLiveToken`·`newLiveId`·`newDayId` |
| `src/services/trip-live/store.ts` | `tripmap:trip-live:v1` 기록 저장소 |
| `src/services/trip-live/client.ts` | `tripLiveApi` |
| `src/share-viewer/show.ts` | `main.ts`의 `show`를 옮긴 `showShareDoc` |
| `src/share-viewer/render-trip.ts` | `initialTab` 옵션·`currentTab()` |
| `src/share-viewer/live.ts` | `fetchLive`, `createLivePoll` |
| `src/share-viewer/live-view.ts` | `startLiveViewer`(띠·폴링·파일 저장) |
| `src/share-viewer/main.ts`, `src/share-viewer/styles.css` | `#t=` 분기, 띠 스타일 |
| `src/sections/trips/live/texts.ts` | 앱 쪽 문구 상수 |
| `src/sections/trips/live/use-trip-live-publish.ts` | 반영 훅 |
| `src/sections/trips/live/TripLivePublisher.tsx` | 계획 화면에 붙는 반영기(그리는 것 없음) |
| `src/sections/trips/live/TripLiveShareDialog.tsx` | 갱신 링크 창(지연 청크) |
| `src/sections/trips/live/LiveShareEntry.tsx` | 일정 공유 창 안 입구 줄 + `LazyDialogHost` |
| `src/sections/trips/live/TripLiveLinkPage.tsx` | `/trips/live/:id` 소유자 링크 화면(지연 청크) |
| `src/sections/settings/LiveTripsSection.tsx` | 설정 › 갱신 링크 목록 |
| `src/routes/{paths,lazy-routes,router}.tsx?` | 경로·지연 청크 |
| `src/sections/share-export/TripShareDialog.tsx`, `src/sections/trips/planner/TripPlannerPage.tsx`, `src/sections/trips/TripsPage.tsx`, `src/sections/settings/SettingsPage.tsx` | 입구·반영기·표시·목록 연결 |
| `tests/e2e/trip-live-server.ts`, `tests/e2e/trip-live.spec.ts` | E2E 가짜 서버와 흐름 |

---

### Task 1: 공유 문서 모델(도메인, Effect 없음)

**Files:**
- Create: `src/domain/trip-live/live-doc.ts`
- Test: `tests/unit/domain/trip-live/live-doc.test.ts`

**Interfaces:**
- Consumes: `parseLinkDoc`(`src/share-viewer/parse.ts`), 타입 `ShareDocV2`(`src/schema/share.ts`, `import type`만)
- Produces(모두 `export`):
  - `LIVE_ID_PATTERN = /^[a-z0-9]{10}$/`, `LIVE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/`, `LIVE_DAY_ID_PATTERN = /^[a-z0-9]{8}$/`, `LIVE_STOP_ID_PATTERN = /^[a-z0-9]{8}$/`
  - `LIVE_DOC_MAX_BYTES = 524_288`, `LIVE_REQUEST_MAX_BYTES = 600_000`, `LIVE_PATH_POINTS_MAX = 10_000`, `LIVE_KEEP_DAYS = { afterTrip: 30, min: 30, max: 180 } as const`, `LIVE_POLL_MS = 10_000`
  - `type LiveTripOptions = { includeMemo: boolean; includeCandidates: boolean }`
  - `type LiveTripDoc = { format: 'landmark-trip-live'; v: 1; share: ShareDocV2; ids: { days: string[]; stops: string[][] }; options: LiveTripOptions }`
  - `parseLiveDoc(value: unknown): LiveTripDoc | null` — 설계 문서 §공유 문서 규칙. 최상위 키는 정확히 `format v share ids options`, `ids` 키는 `days stops`, `options` 키는 `includeMemo includeCandidates`(불리언). `share`는 `parseLinkDoc(share)` 결과가 `version === 2`·`trips.length === 1`일 때만. id 개수·패턴·중복 검사. 반환 값은 `parseLinkDoc`가 돌려준 `share`와 새로 만든 배열로 이루어진 새 객체(입력 객체를 그대로 돌려주지 않는다). 던지지 않는다.
  - `liveDocBytes(doc: LiveTripDoc): number` — `new TextEncoder().encode(JSON.stringify(doc)).byteLength`
  - `liveExpiresAt(endDate: string, now: Date): Date` — `min(now + 180일, max(now + 30일, Date.parse(`${endDate}T23:59:59.999+09:00`) + 30일))`. `endDate`가 `^\d{4}-\d{2}-\d{2}$`이 아니거나 파싱이 안 되면 `now + 30일`.
  - `alignDayIds(prev: readonly string[], count: number, make: () => string): string[]` — 앞에서부터 `count`개 유지, 모자라면 `make()`로 뒤에 붙임. 붙일 때 이미 있는 id와 겹치면 다시 만든다. 입력은 바꾸지 않는다.
  - `liveLinks(origin: string, liveId: string, tokens: { viewToken: string; ownerToken?: string }): { view: string; owner: string | null }` — `view = `${origin}/view#t=${liveId}.${viewToken}``, `owner = ownerToken ? `${origin}/trips/live/${liveId}#h=${ownerToken}` : null`. `origin` 끝의 `/`는 뗀다.
  - `readLiveHash(hash: string): { id: string; token: string } | null` — `/^#t=([a-z0-9]{10})\.([A-Za-z0-9_-]{43})$/`만 받는다.
  - `readOwnerHash(hash: string): string | null` — `/^#h=([A-Za-z0-9_-]{43})$/`.

- [ ] **Step 1: 실패하는 시험** — `live-doc.test.ts`(`// @vitest-environment node`). 시험용 문서는 `tests/fixtures/builders.ts`의 보관함 빌더로 여행을 만들고 `buildTripShareDoc`(경로는 `same-point`/`estimated` 고정 `routeOf`)로 `share`를 얻어 `ids`를 붙인다. 사례:
  - `정상 문서를 통과시키고 새 객체를 돌려준다` — 결과 `toEqual(input)`, `not.toBe(input)`.
  - `모르는 최상위 키·ids 키·options 키가 있으면 null`
  - `ids.days 개수가 Day 수와 다르면 null`, `Stop id 개수가 다르면 null`, `Day id가 겹치면 null`, `Stop id가 다른 Day와 겹치면 null`, `패턴이 아니면 null`
  - `v가 1이 아니면 null`, `share가 v1 문서면 null`, `장소가 없는 share면 null`
  - `liveExpiresAt: 미래 여행은 끝날 한국 자정 직전 + 30일` — `liveExpiresAt('2026-12-10', new Date('2026-11-01T00:00:00Z')).toISOString() === '2027-01-09T14:59:59.999Z'`
  - `liveExpiresAt: 지난 여행은 지금 + 30일`, `180일을 넘지 않는다`(`'2027-12-31'`, now `2026-11-01` → now + 180일), `날짜가 이상하면 지금 + 30일`
  - `alignDayIds: 같은 수면 그대로, 줄면 뒤를 자르고, 늘면 뒤에 붙인다, 입력을 바꾸지 않는다`
  - `liveLinks: 보기·소유자 링크 모양, origin 끝 슬래시 제거`
  - `readLiveHash·readOwnerHash: 맞는 모양만 읽는다`(점 없음·짧은 토큰·대문자 id → null)
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trip-live/live-doc.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-live): 갱신 공유 문서 모델과 검사`

### Task 2: 서버 기반 — 표·한도·환경·요청 크기

**Files:**
- Modify: `src/server/meet/schema-sql.ts`, `src/server/meet/limits.ts`, `src/server/meet/env.ts`, `src/server/share/handlers.ts`
- Test: `tests/unit/server/meet-db.test.ts`(버전 기대 3, 새 표 사례), `tests/unit/server/meet-limits.test.ts`(새 키 사례)

**Interfaces:**
- Produces:
  - `SCHEMA_VERSION = 3`. `SCHEMA_STATEMENTS` 끝에 설계 문서 §D1 표의 다섯 문장(`trip_shares`, `trip_shares_expires`, `trip_share_tokens`, `trip_share_tokens_share`) 순서대로, 앞에 주석 `// 3: 여행 갱신 공유(2A). 2B가 쓸 빈 열(label·expires_at)을 미리 둔다(ALTER는 멱등이 아니다).`
  - `LIMITS`에 기존 키 뒤로 `tripCreate: 20, tripUpdate: 600, tripRotate: 60, tripRead: 5000`.
  - `MeetEnv`에 `TRIP_SHARE_LIVE?: string`(`SHARE_SHORT` 다음 줄).
  - `src/server/share/handlers.ts`: `async function readLimitedJson(request: Request)` → `export async function readLimitedJson(request: Request, maxBytes: number = SHARE_REQUEST_MAX_BYTES): Promise<unknown>`. 함수 안의 `SHARE_REQUEST_MAX_BYTES`를 `maxBytes`로 바꾼다. 기존 호출은 그대로(동작 같음).
- [ ] **Step 1: 실패하는 시험** — `meet-db.test.ts`: 기존 `expect(SCHEMA_VERSION).toBe(2)`를 `3`으로. 새 사례 `버전 2 DB에서 ensureSchema가 trip_shares·trip_share_tokens를 더하고 기존 행을 지키며 버전을 3으로 쓴다`(`createSqliteD1()`에 버전 2 표를 만들고 `meetings`·`share_links` 행 하나씩 넣은 뒤 `resetSchemaMemo()`·`ensureSchema` → `sqlite_master`에 두 표·두 색인, 기존 행 수 그대로, `schema_meta.version === 3`), `SCHEMA_STATEMENTS의 마지막 다섯 문장은 갱신 공유 표다`(끝 문장들이 `trip_share` 문자열을 포함, 모두 `IF NOT EXISTS`). `meet-limits.test.ts`: `tripCreate는 20번까지 true, 21번째 false`.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/meet-db.test.ts tests/unit/server/meet-limits.test.ts tests/unit/server/share-handlers.test.ts` → 새 사례 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 위 명령 통과(짧은 링크 시험도 그대로 통과), `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-live): D1 표(스키마 3)·일 한도·기능 스위치 환경`

### Task 3: 서버 처리와 Pages 진입점

**Files:**
- Create: `src/server/trip-live/handlers.ts`, `functions/api/trip-live/index.ts`, `functions/api/trip-live/[id].ts`, `functions/api/trip-live/[id]/rotate.ts`
- Test: `tests/unit/server/trip-live-handlers.test.ts`(`// @vitest-environment node`, `createSqliteD1()`), `tests/unit/server/functions.test.ts`에 연결 사례

**Interfaces:**
- Consumes: Task 1·2, `withRequest`·`prepare`·`checkLimit`·`configurationError`·`isLocal`·`validate`·`MeetError`·`MeetDeps`(`src/server/meet/handlers.ts`), `MeetContext`(`env.ts`), `hashToken`, `verifyTurnstile`, `pruneLimits`, `readLimitedJson`(`src/server/share/handlers.ts`), `ApiError`·`jsonResponse`(`src/server/http.ts`), `globalFetch`(`src/server/handler.ts`)
- Produces(`src/server/trip-live/handlers.ts`):
  - `handleLiveCreate(ctx: MeetContext, deps: MeetDeps): Promise<Response>` — 순서: `withRequest`(출처) → `TRIP_SHARE_LIVE === 'off'`면 `MeetError('UNAVAILABLE', '갱신 링크 만들기가 꺼져 있어요', { reason: 'off' })` → `prepare(ctx, now, 'tripCreate')` → 시크릿 없고 로컬이 아니면 `configurationError()` → `readLimitedJson(ctx.request, LIVE_REQUEST_MAX_BYTES)` → Effect `validate`로 봉투 `{ id: LIVE_ID_PATTERN, sourceTripId: /^[a-z0-9]{10}$/, ownerToken: LIVE_TOKEN_PATTERN, viewToken: LIVE_TOKEN_PATTERN, doc: Schema.Unknown, turnstile: Schema.String }`(`ownerToken !== viewToken` 아니면 400) → 시크릿이 있으면 Turnstile(실패 `MeetError('BAD_REQUEST', '확인에 실패했어요. 다시 해 주세요', { reason: 'turnstile' })`) → `parseLiveDoc(doc)`(null이면 `MeetError('BAD_REQUEST', '일정 문서가 올바르지 않아요', { reason: 'doc' })`) → `liveDocBytes > LIVE_DOC_MAX_BYTES`면 `ApiError('TOO_LARGE', '일정이 너무 커요')` → 같은 id 행이 있으면: 이 공유의 owner 해시가 보낸 토큰과 같으면 `200 { id, rev, expiresAt, created: false }`, 아니면 `MeetError('CONFLICT', '이미 쓰인 공유 id예요', { reason: 'taken' })` → `batch([INSERT trip_shares (rev 1, view_token, source_trip_id, created_at=updated_at=now, expires_at=liveExpiresAt(endDate, now)), INSERT trip_share_tokens (hash, share_id, 'owner', NULL, NULL, now)])`. `UNIQUE constraint failed: trip_shares.id`가 나면 같은 id 확인을 한 번 더 한다(동시 재시도). 성공 뒤 `ctx.waitUntil(Promise.all([pruneExpiredLive(db, now, 20), pruneLimits(db, now)]).catch(() => undefined))` → `201 { id, rev: 1, expiresAt, created: true }`.
  - `handleLiveGet(ctx, deps)` — `withRequest` → `params.id`가 `LIVE_ID_PATTERN`이 아니면 `ApiError('BAD_REQUEST', …)` → `prepare(ctx, now)` → 문서를 뺀 행 읽기 `SELECT rev, view_token, source_trip_id, updated_at, expires_at FROM trip_shares WHERE id = ?` → 없으면 `checkLimit('tripRead')` 후 `404 NOT_FOUND`, 기한 지났으면 `checkLimit('tripRead')` 후 `410 ENDED` → `Authorization: Bearer <t>`가 없으면 401 → `t === view_token`이면 `role: 'view'`, 아니면 owner 해시 조회로 `role: 'owner'`, 둘 다 아니면 401 → `?since=`가 지금 `rev`와 같으면 `304`(본문 없음, 문서를 읽지 않는다) → 그때만 `SELECT doc FROM trip_shares WHERE id = ?` → 본문은 **문서를 파싱하지 않고** `'{"rev":…,"updatedAt":…,"expiresAt":…,"role":…' + (owner면 ',"viewToken":…,"sourceTripId":…') + ',"doc":' + row.doc + '}'` 문자열로 만들어 `new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } })`. 앞부분 값은 `JSON.stringify`로 감싼다.
  - `handleLiveUpdate(ctx, deps)` — `withRequest` → 스위치 off면 503 `{ reason: 'off' }` → id 검사 → `prepare(ctx, now, 'tripUpdate')` → 행 확인(404/410) → owner 토큰 확인(401) → `readLimitedJson(…, LIVE_REQUEST_MAX_BYTES)` → `validate({ doc: Unknown, baseRev: 정수 ≥ 1 })` → `parseLiveDoc`·크기 → `UPDATE trip_shares SET doc = ?, rev = rev + 1, updated_at = ?, expires_at = ? WHERE id = ? AND rev = ?` → 바뀐 행이 0이면 지금 `rev`를 읽어 `MeetError('CONFLICT', '다른 기기에서 일정을 바꿨어요', { rev })` → `200 { rev: baseRev + 1, expiresAt }` + `waitUntil` 정리.
  - `handleLiveRotate(ctx, deps)` — `withRequest` → id → `prepare(ctx, now, 'tripRotate')` → 행 확인(404/410) → `validate` 본문 `{ view: 토큰 } | { owner: 토큰 }`(정확히 하나) → `owner`이고 그 해시가 이미 이 공유의 owner 토큰이면 `200 { rev }`(재시도) → owner 토큰 확인(401) → `view`: 보낸 값이 지금 `view_token`과 같으면 `200 { rev }`, 아니면 `UPDATE trip_shares SET view_token = ? WHERE id = ?` → `200 { rev }`. `owner`: `batch([DELETE FROM trip_share_tokens WHERE share_id = ? AND kind = 'owner', INSERT … 'owner'])` → `200 { rev }`. 스위치와 무관하게 동작한다.
  - `handleLiveDelete(ctx, deps)` — `withRequest` → id → `prepare(ctx, now)` → 행이 없으면 404(기한이 지났어도 지운다) → owner 토큰 확인(401) → `batch([DELETE tokens, DELETE share])` → `204`. 스위치와 무관.
  - `pruneExpiredLive(db: MeetDb, now: Date, max: number): Promise<number>` — 약속 `pruneExpired`와 같은 방식(같은 배치 안 하위 질의로 대상 고르기). 토큰 먼저, 공유 다음. 지운 공유 수를 돌려준다.
  - 모든 응답 `Cache-Control: private, no-store`(`204`·`304` 포함).
- 진입점(모두 `{ fetch: globalFetch, now: () => new Date() }`을 넘긴다):
  - `functions/api/trip-live/index.ts`: `onRequestPost = handleLiveCreate`
  - `functions/api/trip-live/[id].ts`: `onRequestGet = handleLiveGet`, `onRequestPut = handleLiveUpdate`, `onRequestDelete = handleLiveDelete`
  - `functions/api/trip-live/[id]/rotate.ts`: `onRequestPost = handleLiveRotate`
- [ ] **Step 1: 실패하는 시험** — `trip-live-handlers.test.ts`. 요청 도우미는 `tests/unit/server/share-handlers.test.ts`의 방식(출처 `http://localhost:5173`, `request.url`은 `http://localhost:5173/api/trip-live…`)을 따른다. 사례와 단언:
  - 만들기: `201, created true, rev 1, DB에는 소유자 토큰 해시만 있고 원문이 없다`(`trip_share_tokens.hash !== ownerToken`, `SELECT count(*) … WHERE hash = ownerToken` 0), `같은 id·같은 소유자 토큰 재시도는 200 created false, 처음 문서 유지`, `같은 id 다른 토큰은 409 reason taken`, `TRIP_SHARE_LIVE=off면 503 reason off`, `운영 출처(https://landmark.sch0718.dev, url도 그 호스트)에서 TURNSTILE_SECRET이 없으면 503 reason config`, `가짜 fetch가 success:false면 400 reason turnstile`, `문서 검사 실패 400 reason doc`, `600,001바이트 Content-Length는 413`, `문서가 524,288바이트를 넘으면 413`, `21번째 만들기 429`, `허용하지 않는 출처 403`, `expires_at은 liveExpiresAt(끝날, now)`.
  - 읽기: `보기 토큰은 role view이고 viewToken·sourceTripId가 없다`, `소유자 토큰은 role owner이고 viewToken·sourceTripId가 있다`, `since가 같으면 304이고 본문이 비었다`, `토큰이 없으면 401, 틀리면 401`, `없는 id는 404, 기한 지난 공유는 410`, `404·410만 rate_counters에 tripRead를 남기고 200·304·401은 남기지 않는다`, `응답 doc이 저장한 문서와 같다(JSON.parse 비교)`, `Cache-Control: private, no-store`.
  - 올리기: `보기 토큰으로 401`, `baseRev가 다르면 409이고 rev가 지금 값`, `성공하면 rev 2, updated_at·expires_at 갱신, 다시 읽으면 새 문서`, `스위치 off면 503 reason off`, `off여도 읽기·rotate·delete는 된다`.
  - 링크 다시 만들기: `view를 바꾸면 이전 보기 토큰 GET 401, 새 토큰 200, rev 그대로`, `같은 view 값으로 다시 보내면 200`, `owner를 바꾸면 이전 소유자 토큰 PUT 401, 새 토큰 200`, `이미 바뀐 owner 값으로 (이전 토큰과 함께) 다시 보내면 200`, `보기 토큰으로 rotate는 401`, `61번째 rotate 429`.
  - 지우기: `204 뒤 GET 404`, `기한 지난 공유도 204`, `보기 토큰으로 DELETE 401`.
  - 정리: `pruneExpiredLive가 만료 공유 20개까지만 토큰과 함께 지운다`.
  - `functions.test.ts`: `trip-live 진입점이 env.DB로 만들기 201·읽기 200·rotate 200·지우기 204를 돌려준다`(각 1회).
- [ ] **Step 2:** `yarn vitest run tests/unit/server/trip-live-handlers.test.ts tests/unit/server/functions.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/server`, `yarn typecheck`, `yarn lint`
- [ ] **Step 5:** 커밋 `feat(trip-live): 갱신 공유 서버 처리와 Pages 진입점`

### Task 4: 브라우저 토큰·기록 저장소·API 클라이언트

**Files:**
- Create: `src/services/trip-live/tokens.ts`, `src/services/trip-live/store.ts`, `src/services/trip-live/client.ts`
- Test: `tests/unit/services/trip-live-store.test.ts`, `tests/unit/services/trip-live-client.test.ts`

**Interfaces:**
- Consumes: Task 1, 저장소 관례 `src/services/share-short/store.ts`(`createSentLinksStore`의 구독·스냅샷·막힌 저장소 처리), 클라이언트 관례 `src/services/meet-online/client.ts`
- Produces:
  - `tokens.ts`: `newLiveToken(): string`(32바이트 → base64url 43자), `newLiveId(): string`(10자 a-z0-9, `src/services/id-gen.ts`와 같은 편향 없는 방식), `newDayId(): string`(8자).
  - `store.ts`:
    - `TRIP_LIVE_KEY = 'tripmap:trip-live:v1'`, `TRIP_LIVE_MAX = 100`
    - `type TripLiveStatus = 'pending' | 'live' | 'disconnected' | 'ended'`
    - `type TripLiveRecord`(설계 문서 §브라우저 저장의 모양 그대로)
    - `createTripLiveStore(storage?: () => Storage)` → `{ subscribe(fn: () => void): () => void; list(): readonly TripLiveRecord[]; get(tripId: string): TripLiveRecord | undefined; byLiveId(liveId: string): TripLiveRecord | undefined; put(record: TripLiveRecord): void; update(tripId: string, patch: Partial<Omit<TripLiveRecord, 'tripId'>>): void; remove(tripId: string): void }` — 저장 모양은 `Record<tripId, TripLiveRecord>`. 항목마다 Effect Schema로 검사하고 틀린 항목만 버린다. 100개를 넘으면 `createdAt`이 오래된 것부터 버린다. 원문이 같으면 같은 배열(`list()`)을 돌려준다. `storage` 이벤트(같은 키)로 구독자에게 알린다. 저장소가 막히면 메모리만.
    - `export const tripLiveStore = createTripLiveStore()`
    - `useTripLiveRecord(tripId: string): TripLiveRecord | undefined`, `useTripLiveRecords(): readonly TripLiveRecord[]` — `useSyncExternalStore` 감싸기.
  - `client.ts`:
    - `type TripLiveError = 'offline' | 'unauthorized' | 'conflict' | 'taken' | 'ended' | 'not-found' | 'rate-limited' | 'unavailable' | 'switched-off' | 'invalid' | 'turnstile' | 'too-big'`
    - `type LiveResult<A> = { ok: true; value: A } | { ok: false; error: TripLiveError; rev?: number }`
    - `type LiveState = { rev: number; updatedAt: string; expiresAt: string; role: 'owner' | 'view'; doc: LiveTripDoc; viewToken?: string; sourceTripId?: string }`
    - `tripLiveApi = { create(input: { id; sourceTripId; ownerToken; viewToken; doc: LiveTripDoc; turnstile: string }): Promise<LiveResult<{ id: string; rev: number; expiresAt: string; created: boolean }>>; get(id: string, since: number | null, token: string): Promise<LiveResult<LiveState | 'unchanged'>>; update(id: string, doc: LiveTripDoc, baseRev: number, ownerToken: string): Promise<LiveResult<{ rev: number; expiresAt: string }>>; rotate(id: string, body: { view: string } | { owner: string }, ownerToken: string): Promise<LiveResult<{ rev: number }>>; remove(id: string, ownerToken: string): Promise<LiveResult<void>> }`
    - 경로 `/api/trip-live`, `/api/trip-live/<id>`, `/api/trip-live/<id>/rotate`. `credentials: 'same-origin'`, 토큰은 `Authorization: Bearer`. 응답 봉투는 Effect Schema(`onExcessProperty: 'error'`), `doc`은 `parseLiveDoc`로 검사(실패 `invalid`). 상태 해석: 400 `reason: 'turnstile'` → `turnstile`, 그 밖 400 → `invalid`; 401 → `unauthorized`; 404 → `not-found`; 409 `reason: 'taken'` → `taken`, 그 밖 409 → `conflict`(+`rev`); 410 → `ended`; 413 → `too-big`; 429 → `rate-limited`; 503 `reason: 'off'` → `switched-off`, 그 밖 5xx → `unavailable`. `fetch` 거절 → `offline`. `remove`는 404·410도 성공으로 본다.
- [ ] **Step 1: 실패하는 시험** — store: `왕복`, `깨진 JSON은 빈 목록`, `틀린 항목만 버린다`, `setItem이 던지면 메모리로 계속`, `101번째를 넣으면 가장 오래된 것을 버린다`, `같은 원문이면 list()가 같은 배열`, `다른 탭 storage 이벤트에 구독자가 불린다`, `byLiveId`. client: `각 메서드의 경로·메서드·헤더·본문`, `304 → 'unchanged'`, `상태 코드별 오류(409 taken·409 conflict rev 3·503 off·503·413·410)`, `doc 검사 실패 → invalid`, `fetch 거절 → offline`, `remove 404는 성공`. tokens: `길이·문자 집합·서로 다름`.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/trip-live-store.test.ts tests/unit/services/trip-live-client.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-live): 기기 기록·API 클라이언트·토큰`

### Task 5: 공개본 만들기와 가져오기(앱 도메인)

**Files:**
- Create: `src/domain/trip-live/build-live-doc.ts`, `src/domain/trip-live/import-live.ts`
- Test: `tests/unit/domain/trip-live/build-live-doc.test.ts`, `tests/unit/domain/trip-live/import-live.test.ts`

**Interfaces:**
- Consumes: `buildTripShareDoc`·`thinPaths`·`ShareLegTime`(`src/domain/share/build-trip-share.ts`), `visibleStops`·`Leg`(`src/domain/trips/query.ts`), `importSharedTrip`(`src/domain/library/import-share-trip.ts`), `OpCtx`·`OpResult`(`src/domain/library/ops.ts`), Task 1
- Produces:
  - `ESTIMATE_ONLY: (leg: Leg) => ShareLegTime` — `{ durationS: 0, distanceM: 0, tollFare: null, status: 'estimated', queriedAt: null, path: [] }`(지문 계산용).
  - `buildLiveTripDoc(lib: Library, tripId: string, routeOf: (leg: Leg) => ShareLegTime, opts: { title: string; options: LiveTripOptions; dayIds: readonly string[]; createdAt: string }): LiveTripDoc | null` — `buildTripShareDoc(lib, tripId, routeOf, { title, includeMemo, includeCandidates, now: new Date(createdAt) })`가 null이거나 장소가 0곳이면 null. `opts.dayIds.length !== trip.days.length`면 `throw new Error('dayIds 길이가 Day 수와 다릅니다')`(호출하는 쪽이 `alignDayIds`로 맞춘다). 경로선은 `thinPaths(days, LIVE_PATH_POINTS_MAX)`. `ids.stops[i] = visibleStops(lib, trip.days[i]).map((s) => s.id)`(공유 문서와 같은 거르기·순서). 결과는 `parseLiveDoc`를 통과해야 한다.
  - `fitLiveDoc(doc: LiveTripDoc): LiveTripDoc | null` — `liveDocBytes(doc) <= LIVE_DOC_MAX_BYTES`면 그대로, 아니면 모든 구간 `path: []`로 바꾼 사본, 그래도 넘으면 null.
  - `liveEditKey(doc: LiveTripDoc): Promise<string>` — `{ ...doc, share: { ...doc.share, createdAt: '' , trips: [구간을 [from, to, mode] 배열로 바꾼 여행] } }`의 `JSON.stringify`를 `crypto.subtle.digest('SHA-256')` → base64url.
  - `importLiveTrip(lib: Library, doc: LiveTripDoc, input: { preferredTripId: string | null }, ctx: OpCtx): OpResult` — `importSharedTrip(lib, doc.share, { titleLabel: null, appendMemo: false }, ctx2)`. `ctx2.newId(kind)`는 `kind === 'trip'`이고 `preferredTripId`가 `/^[a-z0-9]{10}$/`이며 `lib.trips`에 그 키가 없으면 그 값을(한 번만), 그 밖에는 `ctx.newId(kind)`. `null`이면 늘 새 id. 성공하면 만든 여행의 `days[i].stops[j].id`를 `doc.ids.stops[i][j]`로 바꾼다(그 Day의 Stop 수가 같을 때만. 다르면 그 Day는 새 id 그대로). `createdId`는 그대로 돌려준다.
- [ ] **Step 1: 실패하는 시험** — build: `Day id와 Stop id가 짝지어진다`, `지운 장소의 Stop은 빠지고 id도 빠진다`, `경로선 합이 10,000점을 넘지 않는다`, `share.createdAt이 opts.createdAt이다`, `장소가 없으면 null`, `dayIds 길이가 다르면 던진다`, `fitLiveDoc이 큰 문서의 경로선을 빼고, 그래도 크면 null`, `liveEditKey: 구간 시간·경로선·queriedAt·createdAt이 달라도 같다`, `Stop 순서·제목·장소 이름이 다르면 다르다`. import: `새 여행이 생기고 원래 id가 비면 그 id를 쓴다`, `원래 id가 있으면 새 id`, `preferredTripId가 null이면 새 id`, `Stop id가 서버 id다`, `같은 네이버 장소는 합친다(장소 수 그대로)`.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trip-live` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-live): 공개본 만들기·편집 지문·새 여행으로 담기`

### Task 6: 보기 화면 갱신 모드

**Files:**
- Create: `src/share-viewer/show.ts`, `src/share-viewer/live.ts`, `src/share-viewer/live-view.ts`
- Modify: `src/share-viewer/main.ts`, `src/share-viewer/render-trip.ts`, `src/share-viewer/styles.css`
- Test: `tests/unit/share-viewer/live.test.ts`, `tests/unit/share-viewer/live-view.test.ts`, 기존 `tests/unit/share-viewer/render-trip.test.ts`·`main.test.ts`에 사례 추가

**Interfaces:**
- Consumes: Task 1(`readLiveHash`, `parseLiveDoc`, `LIVE_POLL_MS`), `injectShareDoc`·`shareFileName`(`src/domain/share/inject.ts`), `importLink`(`./encode`), 기존 `renderTripViewer`·`connectMapFrame`
- Produces:
  - `render-trip.ts`: `opts`에 `initialTab?: TripTab`. 처음 `select`는 `initialTab`이 지금 문서에 있는 탭이면 그것, 아니면 `{ kind: 'day', dayIndex: 0 }`. 반환에 `currentTab(): TripTab`.
  - `show.ts`: `showShareDoc(root: HTMLElement, doc: ShareDoc, opts: { app: string; importValue?: string; initialTab?: TripTab }): { currentTab(): TripTab | null }` — 지금 `main.ts`의 `show` 본문을 옮긴다(v1이면 `currentTab()`은 null). `importValue`가 있으면 지금처럼 `/import#d=<값>`(같은 탭), 없으면 `importLink(doc, app)`.
  - `main.ts`: 데이터 블록이 없을 때 `readLiveHash(location.hash)`가 있으면 `window.onhashchange = () => location.reload()` 후 `void startLiveViewer(root, live)`. 없으면 지금의 `#d=` 흐름(`showShareDoc` 사용).
  - `live.ts`:
    - `type LiveFetch = { kind: 'doc'; rev: number; updatedAt: string; doc: LiveTripDoc } | { kind: 'unchanged' } | { kind: 'revoked' } | { kind: 'ended' } | { kind: 'busy' } | { kind: 'failed' }`
    - `fetchLive(id: string, token: string, since: number | null, fetchFn: typeof fetch = fetch): Promise<LiveFetch>` — `GET /api/trip-live/<id>[?since=<rev>]`, `Authorization: Bearer`, `credentials: 'same-origin'`, `cache: 'no-store'`. 200은 봉투(`rev` 정수 ≥ 1, `updatedAt`·`expiresAt` 문자열)와 `parseLiveDoc(doc)` 검사, 실패면 `failed`. 304 → `unchanged`, 401 → `revoked`, 404·410 → `ended`, 429 → `busy`, 그 밖·네트워크 오류 → `failed`.
    - `createLivePoll(opts: { tick(): Promise<'ok' | 'error' | 'stop'>; win?: Window; idleMs?: number }): { stop(): void }` — 보이고 온라인일 때만. 간격: 기본 `LIVE_POLL_MS`, 연속 실패 1번 30,000·2번 이상 60,000, 마지막 입력(`pointerdown`·`keydown`·`scroll`·`touchstart`, `{ passive: true, capture: true }`)에서 `idleMs`(기본 300,000) 지나면 60,000. 쉬다가 입력이 오면 바로 한 번. `visibilitychange`로 보이면 바로, `online`에 바로. 실행 중이면 겹쳐 부르지 않는다. `stop`을 받거나 `stop()`을 부르면 듣기·타이머를 모두 푼다.
  - `live-view.ts`:
    - `LIVE_TEXT`(설계 문서 §사용 흐름의 문구): `loading`, `watching(hhmm)`, `changed(hhmm)`, `failing(hhmm)`, `revoked`, `ended`, `busy`, `firstFailed`, `retry: '다시 시도'`, `save: '파일로 저장'`, `saveFailed`, `keepHint: '마지막 일정은 파일로 저장할 수 있어요'`.
    - `startLiveViewer(root: HTMLElement, live: { id: string; token: string }, deps?: { fetch?: typeof fetch; win?: Window; now?: () => Date }): Promise<{ stop(): void }>` —
      1. `root`에 `LIVE_TEXT.loading` 문단.
      2. `fetchLive(id, token, null)`. `doc`이면 `showShareDoc(root, doc.share, { app: location.origin })` 후 띠를 `root.prepend`. `revoked`·`ended`·`busy`·`failed`이면 해당 문구(`failed`는 `firstFailed` + `다시 시도` 단추 → 1부터 다시)만 보이고 끝.
      3. 띠: `<div class="live-bar" role="status" aria-live="polite">`에 문구 `<p>`와 `파일로 저장` 단추. 시각은 `HH:mm`(`deps.now()`의 지역 시각, `toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`).
      4. `createLivePoll`의 `tick`: `fetchLive(id, token, rev)`. `doc`이면 `const tab = shown.currentTab()` → `showShareDoc(root, newDoc.share, { app, initialTab: tab ?? undefined })` → 띠 다시 붙이고 `changed`. `unchanged`면 `watching`. `revoked`·`ended`면 띠를 해당 문구 + `keepHint`로 바꾸고 `'stop'`. `failed`·`busy`면 `failing`, `'error'`.
      5. `파일로 저장`: `fetch('/share-viewer.html')` 텍스트 → `injectShareDoc(template, 지금 share)` → `Blob`(`text/html`) → 임시 `<a download=shareFileName(share.title, now)>` 클릭 → URL 해제. 실패하면 띠 문구 아래 `saveFailed`.
  - `styles.css`: `.live-bar`(본문 폭, 위쪽 고정이 아닌 일반 흐름, 테마 변수 사용, 단추 최소 높이 44px).
- [ ] **Step 1: 실패하는 시험** — `live.test.ts`(가짜 타이머, jsdom): `readLiveHash를 쓴 fetchLive 경로·헤더`, `상태별 LiveFetch`, `doc 검사 실패는 failed`, `보일 때 10초마다 tick`, `숨기면 멈추고 보이면 바로`, `오프라인이면 멈추고 online에 바로`, `실패 간격 10→30→60, 성공하면 10`, `5분 입력이 없으면 60초, 입력이 오면 바로 한 번`, `stop 결과면 더 부르지 않는다`, `겹쳐 부르지 않는다`. `live-view.test.ts`(가짜 fetch): `처음 받으면 제목·Day 탭과 띠가 보인다`, `rev가 바뀌면 고른 Day 2 탭을 유지해 다시 그리고 띠가 '일정이 바뀌었어요'`, `401이면 철회 문구와 keepHint, 일정은 남고 tick이 멈춘다`, `처음부터 410이면 끝남 문구만`, `처음 실패면 다시 시도 단추로 다시 받는다`, `파일로 저장이 /share-viewer.html 틀에 공개본을 넣은 Blob을 만든다`(`URL.createObjectURL` 가짜로 Blob 내용 확인: `__TRIPMAP_DATA__` 자리에 `share` JSON). `render-trip.test.ts`: `initialTab이 있으면 그 탭으로 시작, 없는 Day면 Day 1`, `currentTab()`. `main.test.ts`: `#t= 해시면 갱신 모드로 시작`(가짜 fetch 호출 경로 확인).
- [ ] **Step 2:** `yarn vitest run tests/unit/share-viewer` → 새 사례 실패 확인
- [ ] **Step 3:** 구현. `yarn build:viewer`로 번들이 만들어지고 `public/view.html`에 `effect` 문자열(예: `@effect`·`Effect.gen`)이 없는지 `grep -c 'Effect.gen' public/view.html` → `0`으로 확인.
- [ ] **Step 4:** `yarn vitest run tests/unit/share-viewer` 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-live): 보기 화면 갱신 모드(10초 확인·파일로 저장)`

### Task 7: 소유자 반영 훅과 계획 화면 연결

**Files:**
- Create: `src/sections/trips/live/texts.ts`, `src/sections/trips/live/use-trip-live-publish.ts`, `src/sections/trips/live/TripLivePublisher.tsx`
- Modify: `src/sections/trips/planner/TripPlannerPage.tsx`(`PlannerDnd` 안 `<Planner …/>` 다음에 `<TripLivePublisher tripId={trip.id} />`)
- Test: `tests/unit/sections/trips/live-publish.test.tsx`

**Interfaces:**
- Consumes: Task 1·4·5, `useTripLegs`(`src/sections/share-export/use-trip-legs.ts`), `libraryAtom`(`src/stores/library-state.ts`), `toast`(sonner)
- Produces:
  - `texts.ts`(문구 상수, 설계 문서 그대로): `LIVE_CONFLICT = '다른 기기에서 갱신 링크의 일정을 바꿨어요'`, `LIVE_OVERWRITE = '이 기기 일정으로 바꾸기'`, `LIVE_PAUSE = '반영 멈추기'`, `LIVE_DISCONNECTED = '이 기기의 갱신 링크 관리 연결이 끊겼어요. 소유자 링크로 다시 연결하세요'`, `LIVE_ENDED = '갱신 링크 공유가 끝났어요'`, `LIVE_OFF = '지금은 갱신이 잠시 멈췄어요'`, `LIVE_LIMITED = '오늘은 더 반영할 수 없어요. 내일 다시 반영돼요'`, `LIVE_TOO_BIG = "일정이 커서 반영하지 못했어요. '메모 포함'이나 후보를 끄고 다시 해 주세요"`, `LIVE_EMPTY = '일정에 넣은 장소가 없어 반영하지 않았어요'`, `LIVE_FAILED = '반영하지 못했어요. 인터넷이 돌아오면 다시 반영해요'`, 그 밖 Task 8·9·10의 문구도 여기에 모은다.
  - `type LivePublishState = 'idle' | 'pending' | 'publishing' | 'published' | 'conflict' | 'paused' | 'disconnected' | 'ended' | 'off' | 'limited' | 'too-big' | 'empty' | 'failed'`
  - `useTripLivePublish(tripId: string, active: boolean): { state: LivePublishState; publishedAt: string | null; overwrite(): Promise<void>; pause(): void; resume(): void }`
    - 설계 문서 §소유자 기기의 1~4와 결과 표대로. 시간 상수(내보내기): `LIVE_DEBOUNCE_MS = 3_000`, `LIVE_LEGS_WAIT_MS = 15_000`, `LIVE_MIN_GAP_MS = 10_000`, `LIVE_RETRY_MS = [30_000, 60_000, 120_000]`, `LIVE_OFF_RETRY_MS = 300_000`, `LIVE_LIMIT_RETRY_MS = 3_600_000`.
    - `dayIds`는 `alignDayIds(record.dayIds, trip.days.length, newDayId)`로 맞추고, 성공한 올리기와 함께 저장한다.
    - 모듈 수준 `Map<tripId, Promise<void>>` 잠금. 잠금 뒤 `tripLiveStore.get(tripId)?.publishedKey`를 다시 읽어 같으면 건너뛴다.
    - `409`: 상태 `conflict`, `serverRev` 기억, `toast(LIVE_CONFLICT, { id: `trip-live-conflict-${tripId}`, duration: Infinity, action: { label: LIVE_OVERWRITE, onClick: overwrite }, cancel: { label: LIVE_PAUSE, onClick: pause } })`. `overwrite()`는 `baseRev = serverRev`로 한 번 올린다. `pause()`는 기록 `paused: true`. `resume()`은 `paused` 지움.
    - `401`·`404`·`410`은 기록 상태를 바꾸고 `toast.error`/`toast`로 한 번 알린다.
    - 문서 만들기: `fitLiveDoc(buildLiveTripDoc(...))`. `buildLiveTripDoc`가 null이면 `empty`, `fitLiveDoc`가 null이면 `too-big`(요청하지 않음).
  - `TripLivePublisher({ tripId })`: `useTripLivePublish(tripId, true)`만 부르고 `null`을 그린다.
- [ ] **Step 1: 실패하는 시험** — `live-publish.test.tsx`(가짜 타이머, `vi.mock('src/services/trip-live/client')`, 훅은 모듈의 `tripLiveStore`를 쓰고 시험은 `localStorage.clear()`와 `tripLiveStore.put`으로 기록을 준비한다, 보관함은 `tests/unit/sections/trips/planner-fixtures.tsx` 관례): `기록이 없으면 요청하지 않는다`, `지문이 같으면 올리지 않는다`, `Stop을 옮기면 3초 뒤 update 한 번(baseRev=기록 rev), 성공하면 기록 rev·publishedKey 갱신`, `연달아 고치면 마지막 뒤 3초에 한 번`, `구간을 받는 중이면 15초까지 기다린다`, `409면 알림이 뜨고 덮어쓰기는 baseRev=서버 rev로 update`, `반영 멈추기면 paused이고 더 올리지 않는다`, `401이면 disconnected, 410이면 ended`, `503 off면 off이고 5분 뒤 다시`, `장소를 모두 빼면 empty이고 요청 없음`, `같은 여행 훅 두 개가 있어도 update는 한 번`, `paused면 아무것도 하지 않는다`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/trips/live-publish.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/sections/trips`(계획 화면 기존 시험 그대로 통과), `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-live): 소유자 기기 자동 반영`

### Task 8: 갱신 링크 창과 일정 공유 창 입구

**Files:**
- Create: `src/sections/trips/live/TripLiveShareDialog.tsx`, `src/sections/trips/live/LiveShareEntry.tsx`
- Modify: `src/routes/lazy-routes.ts`(`loadTripLiveShareDialog`·`TripLiveShareDialog`, `PANEL_CHUNKS`에는 넣지 않는다), `src/sections/share-export/TripShareDialog.tsx`(children 끝에 `<LiveShareEntry tripId={tripId} />`, `legStatus`를 아래처럼 옮김), `src/sections/share-export/use-trip-legs.ts`(`legStatus`), `package.json`(`build:ci`의 `--require-lazy TripShareDialog` 다음에 `--require-lazy TripLiveShareDialog`)
- Test: `tests/unit/sections/trips/live-share-dialog.test.tsx`, 기존 `tests/unit/sections/share-export/trip-share-dialog.test.tsx`에 입구 사례

**Interfaces:**
- Consumes: Task 1·4·5·7, `getTurnstileToken`(`src/services/meet-online/turnstile-loader.ts`), `useTripLegs`, `useKakao`·`kakaoUrlFits`·`sendAppKakao`·`KAKAO_SEND_FAILED`(`src/sections/share-export/kakao.ts`), `shareLink`(`src/sections/meetings/share-link.ts`), `LazyDialogHost`, `ShareTemplate`·`startEffect`·`injectShareDoc`·`shareFileName`·`downloadText`, `HelpButton`, `formatShortExpiry`(`src/domain/share/short-link.ts`, 기한 날짜 표기)
- Produces:
  - `LiveShareEntry({ tripId })`: 기록이 없거나 `ended`면 문구 `받은 사람 화면도 일정을 고치면 바뀌는 링크를 만들 수 있어요` + 단추 `갱신 링크…`, `live`면 `갱신 링크로 공유 중이에요` + `갱신 링크 관리`, `disconnected`면 `갱신 링크 관리 연결이 끊겼어요` + `갱신 링크…`. 단추는 `LazyDialogHost`(heading `갱신 링크`) 안의 지연 `TripLiveShareDialog`를 연다(한 번 연 뒤 마운트 유지, `TripShareDialogHost`와 같은 방식).
  - `TripLiveShareDialog({ open, onClose, tripId })` — MUI `Dialog`(제목 `갱신 링크`, `HelpButton page="share"`). `useTripLivePublish(tripId, open)`을 부른다. 상태별 내용:
    - 기록 없음(또는 `ended` 뒤 `새 갱신 링크 만들기`): 제목 입력(1~60자, 기본 여행 제목), `메모 포함`(기본 꺼짐), `후보 N곳도 넣기`(후보가 있을 때, 기본 켜짐), 안내 `갱신 링크를 만들면 이 일정의 사본을 Landmark 서버에 {기한}까지 둬요. 서버에는 암호화하지 않고 저장해요. 링크를 받은 사람은 누구나 볼 수 있어요`(+ 메모 포함이면 `링크를 받은 사람은 누구나 메모를 볼 수 있어요`), 구간 상태 줄(일정 공유 창과 같은 문구 — `TripShareDialog.tsx`의 `legStatus`를 `src/sections/share-export/use-trip-legs.ts`로 옮겨 `export function legStatus(legs: TripLegs): string | null`로 내보내고 두 창이 같이 쓴다. 일정 공유 창 동작은 그대로), 단추 `갱신 링크 만들기`. `{기한}`은 `formatShortExpiry(liveExpiresAt(trip.endDate.value, now), now)`.
    - 만들기: ① `pending` 기록을 먼저 저장(`liveId = newLiveId()`, 토큰 둘, `dayIds = alignDayIds([], days, newDayId)`, `createdAt = now ISO`, `rev: 0`, `options`) ② `getTurnstileToken()` ③ `fitLiveDoc(buildLiveTripDoc(...))`(null이면 문구) ④ `tripLiveApi.create` → 성공하면 `status: 'live'`, `rev`, `expiresAt`, `publishedKey = await liveEditKey(doc)`, `publishedAt`. `taken`이면 새 id·토큰으로 한 번 다시. `offline`·`unavailable`이면 `pending` 그대로 두고 문구(다시 누르면 같은 id·토큰으로 보냄). 그 밖 오류면 기록을 지우고 문구. 문구는 설계 문서 §오류·장애 표 그대로.
    - `live`: 보기 링크(`liveLinks(location.origin, …)`)를 읽기 전용 입력칸으로, 단추 `링크 복사`(클립보드, `링크를 복사했어요`), `링크 공유`(`navigator.share`가 있을 때 `shareLink`), `카카오톡`(`useKakao(open).enabled`이고 `kakaoUrlFits(view)`일 때 `sendAppKakao({ title, url: view, description: '갱신되는 여행 일정 · 랜드마크', buttonTitle: '일정 보기' })`). 머리 줄 `마지막 반영 {HH:mm} · {기한}까지 보관`과 반영 상태 문구(Task 7 `texts.ts`). 옵션 칸(제목·메모·후보)을 바꾸면 `tripLiveStore.update(tripId, { options })`. 관리 단추: `다른 기기에서 관리`(`shareLink(owner, title)` + 경고 문구), `보기 링크 다시 만들기`(확인 창 → `rotate({ view: 새 토큰 })` → 기록 `viewToken` 갱신, `새 보기 링크를 만들었어요`), `소유자 링크 다시 만들기`(확인 창 `다른 기기의 관리 연결이 끊겨요` → `rotate({ owner: 새 토큰 })` → 성공하면 기록 `ownerToken` 갱신), `공개본 파일 저장`(`get(liveId, null, ownerToken)` → `ShareTemplate` 틀에 `injectShareDoc(template, state.doc.share)` → `downloadText(html, shareFileName(title, now), 'text/html')`), `서버에서 지우기`(확인 창 → `remove` → 기록 지움 → `갱신 링크를 지웠어요`). 두 다시 만들기의 새 토큰(`newLiveToken()`)은 확인 창을 열 때 만들어 창 상태에 두고, 실패 뒤 다시 누르면 같은 값으로 보낸다(서버가 같은 값을 `200`으로 받는다). 창을 닫으면 버린다.
    - 창을 열면 `live` 기록에 대해 `get(liveId, null, ownerToken)` 한 번(`since` 없이 — 보기 링크 다시 만들기는 `rev`를 올리지 않으므로 `304`로는 바뀐 보기 토큰을 알 수 없다): `viewToken`이 다르면 기록 갱신, `rev > record.rev`면 `다른 기기에서 마지막으로 반영했어요` 표시. `unauthorized`·`ended`·`not-found`는 Task 7과 같은 기록 변경.
    - `paused`: `이 기기에서는 반영을 멈췄어요` + `다시 반영하기`(`resume`) + `공개본을 새 여행으로 가져오기`(`get` → `run((lib, ctx) => importLiveTrip(lib, state.doc, { preferredTripId: null }, ctx))` — 늘 새 id. 기록은 만들지 않는다 → `paths.trip(createdId)`로 이동).
    - `disconnected`: 연결 끊김 문구 + `기록 지우기`. `ended`: `갱신 링크 공유가 끝났어요` + `새 갱신 링크 만들기`(기록 지우고 처음 상태).
- [ ] **Step 1: 실패하는 시험** — `live-share-dialog.test.tsx`(가짜 `tripLiveApi`, `getTurnstileToken` → `'dev'`, 가짜 클립보드): `처음 상태: 메모 포함이 꺼져 있고 서버 보관 안내가 보인다`, `메모 포함을 켜면 메모 안내가 더해진다`, `만들기 성공: create 한 번, 기록 live, 보기 링크가 /view#t=<id>.<토큰>`, `create 응답 유실(offline) 뒤 다시 누르면 같은 id·토큰으로 보낸다`, `taken이면 새 id로 한 번 다시`, `switched-off 문구와 기록 없음`, `rate-limited·turnstile 문구`, `링크 복사`, `보기 링크 다시 만들기: 확인 뒤 rotate view, 링크가 바뀐다`, `소유자 링크 다시 만들기: rotate owner, 기록 ownerToken이 바뀐다`, `서버에서 지우기: remove 뒤 기록이 없다`, `공개본 파일 저장: downloadText에 share가 들어간 html`, `paused 상태 단추 두 개`, `ended 상태에서 새로 만들기`, `열 때 since 없이 get 한 번, rev가 크면 다른 기기 문구, 받은 viewToken이 다르면 링크가 바뀐다`. `trip-share-dialog.test.tsx`: `일정 공유 창에 갱신 링크 입구가 있고 누르면 갱신 링크 창이 열린다`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/trips/live-share-dialog.test.tsx tests/unit/sections/share-export/trip-share-dialog.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/sections/share-export`, `yarn typecheck`, `yarn lint`
- [ ] **Step 5:** 커밋 `feat(trip-live): 갱신 링크 창과 일정 공유 창 입구`

### Task 9: 소유자 링크 화면 `/trips/live/:id`

**Files:**
- Create: `src/sections/trips/live/TripLiveLinkPage.tsx`
- Modify: `src/routes/paths.ts`(`tripLive: (id: string) => `/trips/live/${id}``), `src/routes/lazy-routes.ts`(`loadTripLiveLinkPage`·`TripLiveLinkPage`, `ROUTE_CHUNKS`에는 넣지 않는다), `src/routes/router.tsx`(`paths.trip(':id')` 줄 앞에 `{ path: paths.tripLive(':id'), element: lazyElement(<TripLiveLinkPage />, 'trip-live') }`), `package.json`(`build:ci`에 `--require-lazy TripLiveLinkPage`)
- Test: `tests/unit/sections/trips/live-link-page.test.tsx`, 기존 `tests/unit/routes/*`에 경로 사례

**Interfaces:**
- Consumes: Task 1·4·5, `useLibraryAction`(`src/stores/library-state.ts`), `useNavigate`·`useParams`, `paths`
- Produces: `TripLiveLinkPage()`
  1. 처음 렌더 효과에서 `readOwnerHash(location.hash)`를 읽고 해시가 있으면 `history.replaceState(history.state, '', location.pathname + location.search)`.
  2. `id`가 `LIVE_ID_PATTERN`이 아니면 `링크를 읽지 못했어요` + `여행 목록` 단추.
  3. `tripLiveStore.byLiveId(id)`가 있고 그 여행이 살아 있으면 `navigate(paths.trip(record.tripId), { replace: true })`.
  4. 토큰이 없으면 `관리 링크가 아니에요. 보낸 사람에게 보기 링크를 받아 주세요` + `여행 목록`.
  5. `tripLiveApi.get(id, null, token)`: `role !== 'owner'`나 `unauthorized` → `이 관리 링크는 더 쓸 수 없어요. 다른 기기에서 다시 만들었거나 지웠어요`. `ended`·`not-found` → `공유가 끝난 일정이에요`. `offline`·`unavailable`·`invalid` → `지금은 열 수 없어요. 잠시 뒤 다시 열어 주세요` + `다시 시도`.
  6. 성공하면 요약(제목 `doc.share.title`, `periodLabel(start, end)`, `일정 N곳`)과 안내(설계 문서 §소유자 다른 기기 3) + `이 기기에서 관리하기` + `취소`(여행 목록).
  7. `이 기기에서 관리하기`: `run((lib, ctx) => importLiveTrip(lib, state.doc, { preferredTripId: state.sourceTripId! }, ctx))` → 성공 `createdId`로 기록 `put({ tripId: createdId, liveId: id, status: 'live', ownerToken: token, viewToken: state.viewToken!, rev: state.rev, dayIds: [...state.doc.ids.days], options: { title: state.doc.share.title, ...state.doc.options }, createdAt: state.doc.share.createdAt, expiresAt: state.expiresAt, publishedAt: state.updatedAt, publishedKey })`. `publishedKey`는 담은 뒤의 보관함으로 `buildLiveTripDoc(newLib, createdId, ESTIMATE_ONLY, { title, options, dayIds, createdAt })`를 만들어 `liveEditKey`로 구한다(새 보관함은 `useLibraryAction().run` 뒤 `libraryAtom`을 `useStore().get`으로 읽는다). 그다음 `toast('이 기기에서 갱신 링크를 관리해요')`, `navigate(paths.trip(createdId), { replace: true })`. 가져오기 실패는 `toast.error('여행을 담지 못했어요. 다시 해 주세요')`.
- [ ] **Step 1: 실패하는 시험** — `live-link-page.test.tsx`(`MemoryRouter`, 가짜 `tripLiveApi`): `해시를 지운다(replaceState 호출, 주소에 #h= 없음)`, `담기 뒤 /trips/<id>로 가고 기록이 live이며 Stop id가 서버 id`, `원래 여행 id가 비면 그 id로 담긴다`, `이미 같은 liveId 기록이 있으면 바로 그 여행으로`, `401 문구`, `410 문구`, `오프라인 다시 시도`, `토큰 없는 주소 문구`, `담은 직후 기록의 publishedKey가 지금 보관함으로 만든 지문과 같다`. 라우터 시험: `/trips/live/abcdefghij가 TripLiveLinkPage 지연 덩어리로 열린다`, `/trips/abcdefghij는 그대로 계획 화면`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/trips/live-link-page.test.tsx tests/unit/routes` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-live): 소유자 링크로 다른 기기 연결`

### Task 10: 설정 목록·여행 목록 표시

**Files:**
- Create: `src/sections/settings/LiveTripsSection.tsx`
- Modify: `src/sections/settings/SettingsPage.tsx`(`<SentLinksSection />` 다음 줄에 `<LiveTripsSection />`), `src/sections/trips/TripsPage.tsx`(카드 `counts`에 ` · 갱신 공유 중`, 지우기 확인 창 문구 한 줄)
- Test: `tests/unit/sections/settings/live-trips-section.test.tsx`, 기존 `tests/unit/sections/trips/trips-page.test.tsx`에 사례

**Interfaces:**
- Consumes: Task 4, `formatShortExpiry`
- Produces:
  - `LiveTripsSection()`: 기록이 없으면 `null`. `<section aria-label="갱신 링크">`, 제목 `갱신 링크`, 설명 `이 기기에서 만든·연결한 갱신 링크예요. 지우면 받은 사람도 더는 볼 수 없어요. 서버에는 암호화하지 않고 저장해요`. 항목마다 제목(`options.title`), 상태(`live` → `{기한}까지`, `pending` → `만드는 중 멈춤`, `disconnected` → `관리 연결 끊김`, `ended` → `끝남`), 단추 `지우기`(`live`·`pending`이면 `tripLiveApi.remove` 성공 뒤 기록 삭제, `갱신 링크를 지웠어요`. `offline`이면 `인터넷 연결을 확인하고 다시 해 주세요`, 그 밖 실패는 `갱신 링크를 지우지 못했어요. 잠시 뒤 다시 해 주세요`. `disconnected`·`ended`는 요청 없이 기록만 지운다).
  - `TripsPage`: `useTripLiveRecords()`로 `status === 'live'`인 여행 id 집합을 만들고, 그 카드의 `counts` 문자열 끝에 ` · 갱신 공유 중`(화면과 `aria-label` 모두). 지우기 확인 창 본문 끝에 그 여행이 `live`면 `갱신 링크는 서버에 남아요. 설정 › 갱신 링크에서 지울 수 있어요` 문단.
- [ ] **Step 1: 실패하는 시험** — 설정: `기록이 없으면 섹션이 없다`, `live 지우기는 remove 뒤 목록에서 빠진다`, `disconnected 지우기는 요청 없이 빠진다`, `remove 실패 문구`. 여행 목록: `live 기록이 있는 여행 카드에 갱신 공유 중`, `지우기 확인 창에 서버에 남는다는 문구`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/settings/live-trips-section.test.tsx tests/unit/sections/trips/trips-page.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/sections/settings`, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-live): 설정 갱신 링크 목록과 여행 목록 표시`

### Task 11: E2E — 소유자·받는 사람·다른 기기

**Files:**
- Create: `tests/e2e/trip-live-server.ts`, `tests/e2e/trip-live.spec.ts`
- Modify: `playwright.config.ts`(desktop 프로젝트 `testMatch`에 `'trip-live.spec.ts'` 한 줄만)

**Interfaces:**
- Consumes: Task 3 처리 코드, `createSqliteD1()`(`tests/helpers/sqlite-d1.ts`), `tests/e2e/fixtures.ts`의 `test`·`createGangneungTrip`·`addButton`·`mockRoutes`·`openSheetTab`·`timeline`, `tests/e2e/share-server.ts`의 가로채기 방식(tsx `require`로 처리 코드 읽기)
- Produces:
  - `createTripLiveServer(): { install(context: BrowserContext): Promise<void>; close(): void }` — 시험 하나에 DB 하나. 시험 중에 새로 만든 문맥도 `install`로 같은 DB에 붙인다. `install`은 그 문맥에 `context.route((url) => url.pathname === '/api/trip-live' || url.pathname.startsWith('/api/trip-live/'), …)`. 요청 헤더에 `Origin: http://localhost:5173`을 덮어 넣고(`E2E_PORT`와 무관하게 허용 출처), 경로·메서드를 `functions/api/trip-live/*`와 같게 `handleLiveCreate`·`handleLiveGet`·`handleLiveUpdate`·`handleLiveDelete`·`handleLiveRotate`에 넘긴다(`env = { DB: db }`, 시크릿 없음 → localhost라 Turnstile 건너뜀). `waitUntil` 약속을 기다린 뒤 `route.fulfill`. `close()`는 DB를 닫는다(`test.afterEach`).
- [ ] **Step 1: 시험 작성** — `trip-live.spec.ts`(`@desktop`):
  1. `@smoke 갱신 링크를 만들고, 소유자가 고치면 받는 화면이 10초 뒤 바뀐다`: 소유자 문맥(`page`, 클립보드 권한 `grantPermissions(['clipboard-read', 'clipboard-write'])`)에서 `mockRoutes` → `createGangneungTrip` → Day 1에 장소 두 곳 → `일정 공유` → `갱신 링크…` → `갱신 링크 만들기` → `링크 복사` → 클립보드에서 `/view#t=` 링크(정규식 `/\/view#t=[a-z0-9]{10}\.[A-Za-z0-9_-]{43}$/`). 받는 문맥(`browser.newContext()` 뒤 `server.install(context)`) `clock.install()` 뒤 링크 열기 → `h1`이 여행 제목, 띠에 `보낸 사람이 일정을 고치면`. 소유자가 창을 닫고 Day 1 출발 시각을 `10:00`으로 바꾼다(기존 `trip-planning.spec.ts`의 출발 시각 바꾸기와 같은 조작) → 창을 다시 열어 `마지막 반영` 시각이 바뀔 때까지 기다림(`expect.poll`) → 받는 문맥 `clock.runFor(10_000)` → 띠 `일정이 바뀌었어요`, Day 1 첫 행 시각이 `10:00`대.
  2. `보기 링크를 다시 만들면 이전 링크는 닫히고, 서버에서 지우면 끝남이 보인다`: 1과 같은 준비 → 받는 문맥 열기 → 소유자 `보기 링크 다시 만들기` 확인 → 받는 문맥 `runFor(10_000)` → `보낸 사람이 이 링크를 닫았어요` → 새 링크를 세 번째 문맥에서 열어 일정이 보임 → 소유자 `서버에서 지우기` → 세 번째 문맥 `runFor(10_000)` → `공유가 끝난 일정이에요`, `파일로 저장` 단추는 남음.
  3. `소유자 링크로 다른 기기가 담고 관리한다`: 1의 준비 → 소유자 `다른 기기에서 관리`(클립보드) → 새 문맥에서 `/trips/live/<id>#h=…` 열기 → 주소에 `#h=`가 없음 → `이 기기에서 관리하기` → `/trips/<id>` 계획 화면에 같은 제목과 Day 1 장소 두 곳.
- [ ] **Step 2:** `E2E_PORT=4181 yarn test:e2e --project=desktop tests/e2e/trip-live.spec.ts` → 통과. Codex 환경에서 포트를 열 수 없으면 실행하지 말고 보고에 남긴다(Claude가 직접 돌린다).
- [ ] **Step 3:** 기존 `trip-share.spec.ts`·`share-link.spec.ts`도 같은 방식으로 통과하는지 확인(`E2E_PORT=4181 yarn test:e2e --project=desktop tests/e2e/trip-share.spec.ts tests/e2e/share-link.spec.ts`).
- [ ] **Step 4:** 커밋 `test(e2e): 여행 갱신 공유 흐름`

### Task 12: 로컬 실행·문서·도움말·전체 검증

**Files:**
- Modify: `.gitignore`(`.wrangler/` 다음 줄에 `# wrangler pages dev가 읽는 로컬 비밀 값` + `.dev.vars`), `docs/development.md`(아래 절 추가), `README.md`(개인정보 목록의 짧은 링크 줄 다음에 한 줄 추가), `scripts/motion/help-pages.mjs`(`share`·`trips` 페이지 `tips` 배열 끝에 줄 추가) → `yarn build:motion` 산출물(`docs/help/*.md`, `src/sections/help/help-content.ts`, 그림은 바뀌지 않으면 그대로)
- Test: 전체

- [ ] **Step 1: 문서**
  - `docs/development.md`
    - `### 환경변수` 표 끝에 행 `| \`TRIP_SHARE_LIVE\` | \`off\`면 갱신 링크 만들기·올리기만 중단(\`503\`). 이미 보낸 링크 읽기·지우기·링크 다시 만들기는 계속 동작 |`.
    - `### 공유 짧은 링크(\`/s/<id>\`)` 절 다음에 새 절 `### 여행 갱신 공유(\`/view#t=\`)`: 설계 문서 링크, API 표(설계 문서 §API와 같은 다섯 줄), 보관 기한·일 한도·문서 크기·요청 예산 요약, 기기 기록 `tripmap:trip-live:v1`, 코드 위치, 그리고 **로컬에서 키 없이 해 보기**(설계 문서 §로컬에서 실제 키 없이 해 보기의 명령·시험 키·`.dev.vars`·sqlite 확인·한계를 그대로), **사용자가 할 일**(설계 문서 §사용자가 할 일 1~4의 명령).
    - `### 화면 경로` 표 끝에 행 두 개: `| \`/view#t=<id>.<토큰>\` | 갱신 링크 보기(10초마다 최신 일정, \`파일로 저장\`·\`Landmark에 담기\`) |`, `| \`/trips/live/:id\` | 갱신 링크 소유자 링크(\`#h=\`)로 다른 기기 연결 |`.
    - `## 공개 범위 주의`의 마지막 문단 다음에 새 문단: 갱신 링크가 서버에 일반 저장하는 항목·기한·철회 방법(설계 문서 §남용 방지·보안·개인정보 요약).
  - `README.md` 61행(짧은 링크 줄) 다음: `- 여행 일정을 \`갱신 링크\`로 보내면 일정 사본을 서버에 **암호화하지 않고** 둡니다(여행 끝 30일 뒤·최대 180일, 고칠 때마다 다시 계산). 링크를 받은 사람은 누구나 최신 일정을 볼 수 있고, \`보기 링크 다시 만들기\`·\`서버에서 지우기\`나 **설정 › 갱신 링크**로 닫을 수 있습니다.`
  - `scripts/motion/help-pages.mjs`: `share` 팁 끝에 `'여행 일정은 \`일정 공유\` › \`갱신 링크…\`로 보내면, 일정을 고칠 때 받은 사람 화면도 10초 안팎에 바뀌어요.'`, `'갱신 링크는 일정 사본을 서버에 암호화하지 않고 여행 끝 30일 뒤(최대 180일)까지 둬요. \`보기 링크 다시 만들기\`·\`서버에서 지우기\`로 닫을 수 있어요.'`. `trips` 팁 끝에 `'갱신 링크로 공유 중인 여행은 계획 화면에서 고치면 자동으로 반영돼요. 다른 기기에서도 고치려면 \`다른 기기에서 관리\` 링크로 여세요.'`
  - `yarn build:motion`
- [ ] **Step 2: 로컬 실제 함수 확인(Claude가 직접, Codex는 건너뜀)** — `yarn build:viewer && npx wrangler pages dev --d1 DB --port 8790 --proxy 4180 -- npx vite --port 4180 --strictPort`를 백그라운드로 띄우고, `curl -s -X POST -H 'Origin: http://localhost:8788' -H 'Content-Type: application/json' http://localhost:8790/api/trip-live -d @<시험 문서 JSON>` → `201`, 같은 요청 다시 → `200 created:false`, `GET`(보기 토큰) → `200`, `?since=1` → `304`. 확인 뒤 그 PID만 끈다. 문서 JSON은 `tests/unit/server/trip-live-handlers.test.ts`의 시험 문서를 `node`로 출력해 만든다.
- [ ] **Step 3:** `yarn build:ci` → 시험·크기 검사(`--require-lazy TripLiveShareDialog`·`TripLiveLinkPage` 포함) 통과. 첫 로딩 JS gzip 값을 보고에 적는다.
- [ ] **Step 4:** `yarn lint`, `yarn fm:check`(또는 바꾼 파일만 `npx prettier --check <파일들>`), `yarn validate`, `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음, `yarn test:e2e:ci`(포트 `E2E_PORT=4181`, Codex는 건너뜀).
- [ ] **Step 5:** 커밋 `docs(trip-live): 개발 문서·도움말·로컬 실행 방법`

## 실행 뒤 Claude가 할 일(계획 밖, 순서)

1. E2E 직접 실행: `E2E_PORT=4181 yarn test:e2e --project=desktop tests/e2e/trip-live.spec.ts`, 이어서 `E2E_PORT=4181 yarn test:e2e:ci`. 포트 5173·5174는 건드리지 않는다.
2. Task 12 Step 2의 로컬 함수 확인.
3. PR 열기(기반 `main`) → `codex review --base origin/main` 반복 → 지적 없음. PR 본문에 롤백·데이터 영향 메모(설계 문서 §호환·롤백)를 적는다. `docs/rollback.md`는 병합 뒤 별도 PR.
4. 사용자 할 일(설계 문서 §사용자가 할 일) 안내. 새 시크릿·키가 없으므로 병합 전에 막는 설정은 없다. 병합 뒤 미리보기에서 CPU 시간·운영에서 휴대폰 두 대 확인.
5. 2B(`feat/trip-collab`) 담당에게 설계 문서 §2B가 이어 쓰는 것을 넘긴다.
