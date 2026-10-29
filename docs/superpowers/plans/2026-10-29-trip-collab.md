# 여행 함께 편집·당일 진행(2B) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소유자가 1회용 편집 초대 링크(`/trips/join/<id>#i=<토큰>`)를 보내면 받은 기기가 기기별 편집 권한을 얻어 같은 여행을 함께 고치고(겹친 변경은 비교 화면), 당일에는 방문 완료·다음 장소를 함께 본다(서버 로드맵 2B).

**Architecture:** 2A의 `trip_shares` 공동본(`LiveTripDoc`, 이제 `v: 2`) 위에 편집 기기 표·진행 표를 더한다. 서버(`src/server/trip-collab/handlers.ts`, `functions/api/trip-collab/[id]/**`)는 토큰 확인·문서 검사·`rev` 비교·교체만 한다. 병합은 각 기기의 맞추기 엔진(`CollabEngine`)이 3방향(기준 계획·이 기기 투영·공동본)으로 하고, 겹침이 있으면 비교 창에서 고른 뒤에만 올린다. 편집 기기는 공동본을 자기 보관함 여행으로 담아 지금의 계획 화면·당일 화면에서 쓴다. 화면이 보이는 동안 10초마다 `GET state`(문서·진행 함께, `304`).

**Tech Stack:** React 19, MUI 7, Jotai, Effect 4.0.2(앱·서버 입력 봉투만), Vitest, Playwright, Cloudflare Pages Functions + D1, Node 24 `node:sqlite`(시험 전용).

**설계 문서:** `docs/superpowers/specs/2026-10-29-trip-collab-design.md` — 이 계획과 다르면 설계 문서가 맞다. 모든 과제 전에 한 번 읽는다. 2A 설계 `docs/superpowers/specs/2026-10-29-trip-live-share-design.md`와 2A 계획 `docs/superpowers/plans/2026-10-29-trip-live-share.md`도 읽는다.

**작업 위치:** 워크트리 `/Users/shinchoonho/01.workspace/01.repositories/.worktrees/landmark-trip-collab`, 브랜치 `feat/trip-collab`(기반 `feat/trip-live-share`). 원본 체크아웃·다른 워크트리는 고치지 않는다.

## Global Constraints

- **2A 구현 결과 코드가 기준이다.** 이 계획은 2A 계획서의 파일·함수·타입·문구 이름(`src/domain/trip-live/*`, `src/server/trip-live/handlers.ts`, `src/services/trip-live/*`, `src/sections/trips/live/*`, `src/share-viewer/live.ts`, `tests/e2e/trip-live-server.ts` 등)을 그대로 쓴다. 2A 구현 결과와 이름·시그니처가 다르면 **코드를 따르고**, 다르게 쓴 곳을 커밋 메시지 본문과 완료 보고에 적는다. 2A 코드의 동작은 이 계획이 명시한 곳(Task 1·7·9·11·12·16)만 바꾼다.
- Task 0 전에는 시작하지 않는다: `feat/trip-live-share`에 2A 구현 커밋이 있어야 한다.
- 셸: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`, Yarn 1.22.22. 토큰 없이 설치된 트리에서 yarn 명령이 `Failed to replace env in config`로 멈추면 `export GITHUB_PACKAGES_TOKEN=`(빈 값)을 먼저 둔다. 토큰 값은 출력하지 않는다.
- 포트 5173·5174 서버는 띄우지도 죽이지도 않는다. `pkill` 금지. 개발 서버가 필요하면 4180~4199(Vite)·8790~8799(wrangler)를 쓰고 자기가 띄운 프로세스만 PID로 끈다. E2E는 `E2E_PORT=4181`.
- 첫 로딩 예산 `initialJsGzipMax` 327,680. 새 화면은 지연 청크로만 들어온다. `package.json` `build:ci`에 `--require-lazy TripCollabDialog --require-lazy CollabConflictDialog --require-lazy TripCollabJoinPage`를 더하고 통과해야 한다. `perf-budget.json`은 고치지 않는다.
- **새 의존성을 더하지 않는다.** `@cloudflare/workers-types`도 쓰지 않는다. **저장소에 `wrangler.toml`을 만들지 않는다.**
- 보관함 형식(`tripmap:library:v2`, schemaVersion 2)·백업 형식·공유 문서 형식(`ShareDoc` v1·v2)·2A 기기 키 `tripmap:trip-live:v1`의 모양·`/view#d=`·`/view#t=`·`/import#d=`·`/s/<id>` 동작은 바꾸지 않는다.
- `functions/**`와 `src/server/**` 파일은 서로를 상대 경로로 가져온다. 서버가 가져오는 도메인 모듈(`src/domain/trip-live/live-doc.ts`, `src/domain/trip-collab/constants.ts`, `src/domain/trip-collab/progress.ts`)은 React·MUI·Effect를 가져오지 않는다(`import type`만). `src/share-viewer/**`에 Effect·React가 들어가지 않는다(2A 규칙 그대로).
- 파일 이름에 `.sql`·`.txt`·`.html`·`.bin`·`.wasm`이 중간에 들어가면 안 된다(`tests/unit/server/module-imports.test.ts`).
- D1 스키마: `src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에만** 더하고 `SCHEMA_VERSION = 4`. 기존 문장은 건드리지 않는다. `ALTER TABLE` 금지.
- 서버 응답은 모두 `Cache-Control: private, no-store`. 기존 Cache API에 넣지 않는다.
- 토큰·IP 원문은 로그·URL 질의 문자열에 남기지 않는다. 초대 토큰은 `#i=`로만 전달하고 읽은 뒤 `history.replaceState`로 지운다. 서버는 편집 토큰·초대 토큰의 SHA-256 해시만 저장한다.
- 사용자 문자열은 React 텍스트·`textContent`로만. `dangerouslySetInnerHTML`·`innerHTML` 금지. 주석·UI 문구는 한국어, 주변 코드 관례를 따른다. `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 공용 문서(`docs/development.md`·`README.md`·`scripts/motion/help-pages.mjs`)는 **자기 절·자기 줄만 더하고** 기존 줄은 고치지 않는다. `docs/rollback.md`는 고치지 않는다.
- 고치지 않는다: `playwright.config.ts`의 포트·webServer·globalSetup(desktop `testMatch`에 새 spec 한 줄 더하기만 허용), `tests/e2e/global-setup*`, `perf-budget.json`, `.claude/`, `src/server/http.ts`의 허용 출처.
- 원격 D1·`wrangler secret put`·`wrangler pages deploy`·외부 계정·키 만들기 금지. Codex 샌드박스에서 네트워크·포트가 막히면 그 검증은 실행하지 말고 결과 보고에 남긴다(Claude가 직접 돌린다).
- 과제마다 커밋한다. 메시지는 한국어 conventional(`feat(trip-collab): …`, `test(e2e): …`, `docs(trip-collab): …`), 끝 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. push하지 않는다.

## Review Focus

1. **조용한 유실이 없는가**: 같은 필드·같은 목록을 양쪽이 바꾸면 반드시 겹침이 되는가, 겹침이 남은 동안 올리지도 반영하지도 않는가, 반영 도중 사람이 고치면 다시 하는가(`applyCollabPlan` 전 재투영 비교), 기준이 없을 때 다른 곳이 모두 겹침인가, 결과가 늘 여행 규칙(`checkTrip`)을 지키는가.
2. **권한**: 초대 1회(같은 초대로 두 번째 기기 401), 기한, 거둔 기기 즉시 401, 편집 기기가 `members`·초대·보기 토큰을 못 얻는가, 보기 토큰으로 `trip-collab` 경로가 모두 401인가.
3. **버전**: v1 문서로 v2를 덮는 2A `PUT`이 `409 version`인가, 2A 반영 훅이 공동 편집 중에 멈추는가(`collab`).
4. **스위치**: `TRIP_COLLAB=off`(또는 `TRIP_SHARE_LIVE=off`)가 쓰기만 막고 `state`·`members`·거두기·초대 취소·그만두기를 살려 두는가.
5. **요청 예산·첫 로딩**: 연결 기록이 없으면 요청이 0인가, 숨기면 멈추는가, `304`가 문서를 읽지 않는가, 새 창·화면이 첫 청크에 들어오지 않는가.
6. **스키마·정리**: `SCHEMA_STATEMENTS` 끝에만, 버전 4, 2A 지우기·만료 정리가 2B 행도 지우는가.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/domain/trip-live/live-doc.ts`(2A) | `v: 1 \| 2`, `LIVE_DOC_LATEST = 2`, v2 장소 id 검사 |
| `src/domain/trip-collab/constants.ts` | 한도·패턴·기기 이름 다듬기·초대 링크·해시 읽기·초대 기한(서버 공용, Effect 없음) |
| `src/domain/trip-collab/plan.ts` | `CollabPlan`, `planFromDoc`, `projectLocalTrip`, `planKey`, `checkPlan` |
| `src/domain/trip-collab/merge.ts` | `mergeCollabPlan`, `resolveCollabMerge`, 겹침 타입 |
| `src/domain/trip-collab/places.ts` | `mapServerPlaces`, `assignServerPlaceIds`, `serverIdOf`, `stopIdClashes`, `renameStopIds` |
| `src/domain/trip-collab/apply.ts` | `applyCollabPlan`, `importCollabTrip` |
| `src/domain/trip-collab/build-doc.ts` | `buildCollabDoc`, `CollabRouteOf` |
| `src/domain/trips/query.ts` | `legBetween` 내보내기(`dayLegs`의 쌍 계산을 꺼냄, 동작 같음) |
| `src/domain/trip-collab/progress.ts` | 진행 타입, `sharedMarkOf`, `sharedNextIndex`, `queueOp`, `withLocalOps`(서버 공용, Effect 없음) |
| `src/server/meet/{schema-sql,limits,env}.ts` | 스키마 4, 한도 키, `TRIP_COLLAB` |
| `src/server/trip-live/handlers.ts`(2A) | `PUT` 버전 거절, 지우기·만료 정리에 2B 표 |
| `src/server/trip-collab/handlers.ts` | 초대·수락·state·doc·progress·members·거두기 |
| `functions/api/trip-collab/[id]/{invites,invite,accept,state,doc,progress,members}.ts`, `functions/api/trip-collab/[id]/invites/[key].ts`, `functions/api/trip-collab/[id]/members/[device].ts` | Pages 진입점 |
| `src/services/trip-live/client.ts`(2A) | `TripLiveError`에 `'version'` |
| `src/services/trip-collab/store.ts` | `tripmap:trip-collab:v1` 기록, `tripmap:trip-collab-base:v1:<id>` 기준 |
| `src/services/trip-collab/client.ts` | `tripCollabApi` |
| `src/sections/trips/collab/texts.ts` | 문구 상수 |
| `src/sections/trips/collab/collab-engine.ts` | `CollabEngine`(React 없음), 엔진 등록부 |
| `src/sections/trips/collab/owner-join.ts` | `enableCollabAsOwner`, `joinCollabAsOwner` |
| `src/sections/trips/collab/use-trip-collab.ts` | `useTripCollab` |
| `src/sections/trips/collab/TripCollabSync.tsx`, `CollabBar.tsx` | 계획 화면 띠·엔진 연결·소유자 합류 확인 |
| `src/sections/trips/collab/TripCollabDialog.tsx`, `CollabDialogHost.tsx` | `함께 편집` 창(지연)과 입구 |
| `src/sections/trips/collab/CollabConflictDialog.tsx` | 비교 창(지연) |
| `src/sections/trips/collab/TripCollabJoinPage.tsx` | `/trips/join/:id`(지연) |
| `src/sections/settings/CollabTripsSection.tsx` | 설정 › 함께 편집 |
| 수정: `src/sections/trips/live/{use-trip-live-publish.ts,TripLiveShareDialog.tsx,TripLiveLinkPage.tsx,texts.ts}`(2A), `src/sections/trips/planner/TripPlannerPage.tsx`, `src/sections/trips/today/{TripTodayPage,use-today,use-visit-toggle,NextCard,TodayLists,TodayHeader}.tsx?`, `src/sections/trips/TripsPage.tsx`, `src/sections/settings/SettingsPage.tsx`, `src/routes/{paths,lazy-routes,router}.tsx?`, `package.json` | 연결 |
| `tests/e2e/trip-live-server.ts`(2A), `tests/e2e/trip-collab.spec.ts` | E2E |

시험 공용 도우미 `tests/unit/domain/trip-collab/builders.ts`(Task 2에서 만든다):
- `pid(short: string): string` = `short.padEnd(10, '0')`(예 `pid('a')` → `a000000000`), `sid(short)` = `('s' + short).padEnd(8, '0')`.
- `mkPlan(spec: { title?: string; start?: string; days: string[][]; candidates?: string[]; legModes?: Record<string, 'car' | 'walk'>; startTimes?: string[]; lodgings?: (string | null)[]; notes?: Record<string, string> }): CollabPlan` — `start` 기본 `'2026-11-01'`, 끝 날짜 = 시작 + (Day 수 − 1), Day id `d${i}`.padEnd(8, '0'), Stop은 `{ id: sid(p), placeId: pid(p), stayMin: null, fixedTime: null, note: notes?.[p] ?? '' }`, 시작 시각 기본 `'09:00'`.

---

### Task 0: 2A 구현 결과 가져오기와 이름 대조

**Files:** 없음(병합 커밋만)

- [ ] **Step 1:** `git fetch` 없이 로컬 브랜치를 쓴다: `git -C <워크트리> log --oneline feat/trip-live-share -20`로 2A 구현 커밋(Task 1~12의 `feat(trip-live): …`)이 있는지 본다. 없으면 멈추고 보고한다.
- [ ] **Step 2:** `git merge --no-edit feat/trip-live-share`. 충돌이 나면(이 브랜치는 문서 두 개만 더했으므로 나지 않아야 한다) 멈추고 보고한다.
- [ ] **Step 3:** 아래 이름이 코드에 있는지 `grep -rn`으로 확인하고, 다르면 실제 이름을 적어 둔다(이후 과제는 실제 이름을 쓴다): `parseLiveDoc`, `LiveTripDoc`, `LIVE_ID_PATTERN`, `LIVE_TOKEN_PATTERN`, `LIVE_DOC_MAX_BYTES`, `LIVE_REQUEST_MAX_BYTES`, `LIVE_PATH_POINTS_MAX`, `liveDocBytes`, `liveExpiresAt`, `alignDayIds`, `fitLiveDoc`, `liveEditKey`, `buildLiveTripDoc`, `ESTIMATE_ONLY`, `importLiveTrip`, `handleLiveUpdate`, `handleLiveDelete`, `pruneExpiredLive`, `readLimitedJson`, `tripLiveStore`, `TripLiveRecord`, `tripLiveApi`, `TripLiveError`, `LiveResult`, `LiveState`, `newLiveToken`, `newLiveId`, `newDayId`, `createLivePoll`, `useTripLivePublish`, `LivePublishState`, `LIVE_DEBOUNCE_MS`, `LIVE_MIN_GAP_MS`, `LIVE_OFF_RETRY_MS`, `LIVE_LIMIT_RETRY_MS`, `TripLiveShareDialog`, `LiveShareEntry`, `TripLiveLinkPage`, `LiveTripsSection`, `createTripLiveServer`.
- [ ] **Step 4:** `yarn install --frozen-lockfile && yarn typecheck && yarn vitest run tests/unit/domain/trip-live tests/unit/server/trip-live-handlers.test.ts` 통과 확인. 대조 결과를 완료 보고에 넣는다(커밋은 병합 커밋 하나).

### Task 1: 공유 문서 v2와 함께 편집 상수

**Files:**
- Modify: `src/domain/trip-live/live-doc.ts`(2A)
- Create: `src/domain/trip-collab/constants.ts`
- Test: `tests/unit/domain/trip-live/live-doc.test.ts`(사례 추가), `tests/unit/domain/trip-collab/constants.test.ts`

**Interfaces:**
- Consumes: 2A `live-doc.ts`
- Produces:
  - `live-doc.ts`: `LiveTripDoc`의 `v`를 `1 | 2`로. `export const LIVE_DOC_LATEST = 2 as const`. `parseLiveDoc`은 `v === 1 || v === 2`를 받고, `v === 2`면 모든 `share.places[i].id`가 `/^[a-z0-9]{10}$/`이어야 한다(아니면 null). 반환 객체의 `v`는 입력 값 그대로. 2A의 `buildLiveTripDoc`은 계속 `v: 1`을 만든다(고치지 않는다).
  - `constants.ts`(Effect·React 없음, 서버도 가져온다):
    - `export const COLLAB_LIMITS = { devices: 20, invites: 10, inviteDays: 7, labelChars: 30, progressOps: 50, progressRows: 2_000, pendingOps: 200, progressRequestBytes: 16_384 } as const`
    - `export const COLLAB_DEVICE_ID_PATTERN = /^[a-z0-9]{8}$/`, `export const COLLAB_INVITE_KEY_PATTERN = /^[A-Za-z0-9_-]{16}$/`, `export const COLLAB_STOP_ID_PATTERN = /^[a-z0-9]{8}$/`
    - `export const OWNER_DEVICE = 'owner'`, `export const OWNER_LABEL = '만든 사람'`
    - `export function normalizeDeviceLabel(label: string): string | null` — `normalize('NFC')`, 앞뒤 공백 제거, 연속 공백 한 칸. 길이 1~30이면 그 값, 아니면 null.
    - `export function normalizeInviteLabel(label: string | null): string | null` — 같은 다듬기, 비면 null, 30자 넘으면 30자로 자른다.
    - `export function inviteExpiresAt(now: Date, shareExpiresAt: string): string` — `min(now + 7일, Date.parse(shareExpiresAt))`의 ISO.
    - `export function collabInviteLink(origin: string, liveId: string, token: string): string` — `${origin 끝 / 제거}/trips/join/${liveId}#i=${token}`.
    - `export function readInviteHash(hash: string): string | null` — `/^#i=([A-Za-z0-9_-]{43})$/`만.
    - `export function inviteKeyOf(hash: string): string` — `hash.slice(0, 16)`.
- [ ] **Step 1: 실패하는 시험** — `live-doc.test.ts`에: `v2 문서를 통과시키고 v를 그대로 돌려준다`, `v2인데 장소 id가 10자 소문자가 아니면 null`(예 `'ABC'`), `v: 3이면 null`, `v1 문서는 장소 id 패턴을 보지 않는다`(2A 기존 사례 그대로 통과). `constants.test.ts`: `normalizeDeviceLabel`(`'  민지   폰 '` → `'민지 폰'`, `''` → null, 31자 → null), `normalizeInviteLabel`(빈 문자열 null, 40자 → 30자), `inviteExpiresAt`(공유 기한이 3일 뒤면 그 값, 30일 뒤면 now + 7일), `collabInviteLink`(끝 슬래시 제거), `readInviteHash`(점·짧은 토큰·`#t=` → null).
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trip-live/live-doc.test.ts tests/unit/domain/trip-collab/constants.test.ts` → 새 사례 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`(2A 코드가 `v`를 `1` 리터럴로 좁혀 쓰던 곳이 있으면 `LiveTripDoc['v']`를 받도록 고친다), `yarn build:viewer` 후 `grep -c 'Effect.gen' public/view.html` → `0`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 공유 문서 v2와 함께 편집 상수`

### Task 2: 공동 계획 투영

**Files:**
- Create: `src/domain/trip-collab/plan.ts`, `tests/unit/domain/trip-collab/builders.ts`
- Test: `tests/unit/domain/trip-collab/plan.test.ts`

**Interfaces:**
- Consumes: `LiveTripDoc`(2A), `Trip`(`src/schema/trip.ts`), `daysBetween`(`src/lib/calendar`)
- Produces(`plan.ts`):
  - `export type CollabStop = { id: string; placeId: string; stayMin: number | null; fixedTime: string | null; note: string }`
  - `export type CollabDay = { id: string; startTime: string; lodging: string | null; stops: CollabStop[] }`
  - `export type CollabPlan = { title: string; startDate: string; endDate: string; origin: string | null; candidates: string[]; legModes: Record<string, 'car' | 'walk'>; days: CollabDay[] }`
  - `export const NEW_DAY_START = '09:00'`
  - `export function planFromDoc(doc: LiveTripDoc): CollabPlan` — `t = doc.share.trips[0]`: `title: t.title`, `startDate`, `endDate`, `origin: t.originId`, `candidates: [...t.candidateIds]`, `legModes: { ...t.legModes }`, `days[i] = { id: doc.ids.days[i], startTime: day.startTime, lodging: day.lodgingId, stops: day.stops.map((s, j) => ({ id: doc.ids.stops[i][j], placeId: s.placeId, stayMin: s.stayMin, fixedTime: s.fixedTime, note: s.note ?? '' })) }`.
  - `export function projectLocalTrip(trip: Trip, toServer: (localPlaceId: string) => string, dayIds: readonly string[]): CollabPlan` — `dayIds.length !== trip.days.length`면 `throw new Error('dayIds 길이가 Day 수와 다릅니다')`. **저장된 값 그대로**(`visibleStops`를 쓰지 않는다): `origin`·`candidates`·Stop `placeId`·`lodging`을 `toServer`로, `legModes` 키 `"a>b"`를 `"${toServer(a)}>${toServer(b)}"`로 옮긴다(옮긴 키가 겹치면 처음 것).
  - `export function planKey(plan: CollabPlan): string` — 객체 키를 정렬해 직렬화(배열 순서는 그대로)한 JSON.
  - `export function samePlan(a: CollabPlan, b: CollabPlan): boolean` — `planKey(a) === planKey(b)`.
  - `export function checkPlan(plan: CollabPlan): string[]` — 문제마다 한 줄: 날 수(`daysBetween(start, end)`)가 1~30이고 `days.length`와 같음, Stop id 패턴 `^[a-z0-9]{8}$`·중복 없음, Day id 패턴·중복 없음, 장소는 모든 Stop·후보 통틀어 한 번, `legModes` 키가 `^[a-z0-9]{10}>[a-z0-9]{10}$`. 없으면 `[]`.
- [ ] **Step 1: 실패하는 시험** — `builders.ts`(위 「시험 공용 도우미」)를 먼저 만든다. `plan.test.ts`(`// @vitest-environment node`): `planFromDoc가 ids와 Stop을 짝짓고 note가 없으면 빈 문자열`(2A `live-doc.test.ts`의 문서 만드는 방식 재사용), `projectLocalTrip이 지운 장소의 Stop도 담는다`(`tests/fixtures/builders.ts`로 보관함을 만들고 장소 하나에 `deletedAt`), `장소·legModes 키를 서버 id로 옮긴다`, `dayIds 길이가 다르면 던진다`, `planKey는 legModes 키 순서와 무관하다`, `checkPlan: 정상 []·장소 두 번·Stop id 중복·날 수 불일치를 각각 알린다`.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trip-collab/plan.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 공동 계획 투영과 검사`

### Task 3: 3방향 병합

**Files:**
- Create: `src/domain/trip-collab/merge.ts`
- Test: `tests/unit/domain/trip-collab/merge.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces:
  - `export type CollabSide = 'mine' | 'theirs'`
  - `export type ListId = 'c' | \`d${number}\``(`c` 후보, `dN` N번째 Day의 Stop 목록)
  - `export type FieldConflict = { kind: 'field'; id: string; field: 'title' | 'origin' | 'startTime' | 'lodging' | 'legMode' | 'stayMin' | 'fixedTime' | 'note'; dayIndex?: number; stopId?: string; placeId?: string; legKey?: string; mine: unknown; theirs: unknown }`
  - `export type PlacementSide = { period: { startDate: string; endDate: string }; lists: Partial<Record<ListId, string[]>> }` — 목록 내용은 장소 id 순서. 그쪽에 없는 Day 목록은 키가 없다.
  - `export type PlacementConflict = { kind: 'placement'; id: string; lists: ListId[]; period: boolean; mine: PlacementSide; theirs: PlacementSide }`
  - `export type CollabConflict = FieldConflict | PlacementConflict`
  - `export type CollabMerge = { base: CollabPlan | null; mine: CollabPlan; theirs: CollabPlan; conflicts: CollabConflict[]; plan: CollabPlan | null }` — `plan`은 겹침이 없을 때만 결과, 있으면 null.
  - `export function mergeCollabPlan(base: CollabPlan | null, mine: CollabPlan, theirs: CollabPlan): CollabMerge`
  - `export type ResolveResult = { ok: true; plan: CollabPlan } | { ok: false; reason: 'missing' } | { ok: false; reason: 'invalid'; merge: CollabMerge }`
  - `export function resolveCollabMerge(merge: CollabMerge, choices: Readonly<Record<string, CollabSide>>): ResolveResult`
  - `export function compareListIds(a: ListId, b: ListId): number` — `c`가 먼저, 그다음 Day 번호 오름차순(`d2` < `d10`).
- 규칙(설계 문서 §병합 규칙을 그대로 구현한다. 아래는 구현 순서):
  1. 값 3방향 `pick(b, m, t)`: 같음 비교는 `JSON.stringify`. `m === b` → `t`, `t === b` → `m`, `m === t` → `m`, 아니면 겹침. 기준이 없으면 `m === t` → `m`, 아니면 겹침.
  2. 기간 `{startDate, endDate}`를 `pick`. Day 수는 고른 기간의 날 수.
  3. 목록: Day 번호 `0..max(B,M,T Day 수)−1`과 `c`. 목록마다 `pick`(없는 목록은 `undefined`). 장소 위치 `loc(side, placeId): ListId | null`을 `pick`. 위치가 셋 다 다르면 `[locB, locM, locT]`의 null 아닌 목록을 겹친 목록으로.
  4. 삭제 대 수정: `B`에 있던 Stop id가 한쪽 목록에서 사라졌고 다른 쪽에서 그 Stop의 `stayMin`·`fixedTime`·`note`가 `B`와 다르면 그 Stop의 `B` 위치 목록과 다른 쪽 위치 목록을 겹친 목록으로.
  5. 기간: 한쪽만 바꾼 기간으로 결과 Day 수 N이 다른 쪽 Day 수보다 작고, 다른 쪽이 `i ≥ N`인 Day 목록을 `B`와 다르게 가졌으면(`B`에 그 Day가 없으면 비지 않은 목록) 기간 + 그 Day들 + `c`를 한 겹침(period true)으로. 기간 자체가 겹치면 기간 + `min(M Day 수, T Day 수)` 이상의 모든 Day 목록 + `c`.
  6. 묶음: 겹친 목록들을 합집합-찾기로 묶는다. 장소마다 `locM !== locT`이고 그 위치 목록 중 하나라도 겹친 목록이면 `[locB, locM, locT]`를 같은 묶음으로. 더 붙지 않을 때까지 반복. 묶음마다 `PlacementConflict` 하나, id는 `placement.` + (period면 `period,`) + `lists.sort(compareListIds).join(',')`.
  7. 값 필드: `title`, `origin`, Day 번호 i(결과 Day 수 안)별 `startTime`·`lodging`(`B`에 그 Day가 없으면 기준 값 `{ startTime: NEW_DAY_START, lodging: null }`, 한쪽에만 있으면 그쪽 값), `legModes`의 모든 키(키 없음은 `undefined` 값, 결과가 `undefined`면 키 없음), 양쪽 목록에 다 있는 Stop id별 `stayMin`·`fixedTime`·`note`. 겹침 id: `title`, `origin`, `day.${i}.startTime`, `day.${i}.lodging`, `legMode.${key}`, `stop.${stopId}.${field}`. 기준이 없을 때 Day 값 겹침은 양쪽에 있는 Day만.
  8. 결과 조립(`build(choices)`): 겹치지 않은 목록은 3의 결과, 묶음은 고른 쪽(기간 포함). Stop 객체는 결과 목록을 준 쪽의 Stop(같은 id가 양쪽에 있으면 7의 값 결과로 덮음), 결과에 없는 Stop의 값 겹침은 버린다. Day id: 결과 i < T Day 수면 `T.days[i].id`, 아니면 `M.days[i].id`. 결과 `checkPlan`이 문제를 내면 모든 목록·기간을 묶은 겹침 하나(`placement.all`, `lists` = 모든 목록, `period: true`)로 바꾼 `CollabMerge`를 돌려준다(안전망).
  9. 기준이 없을 때: 값은 1의 기준 없는 규칙, 목록은 `M`과 `T`가 다른 목록이 있으면 그 목록 전부(+ 기간이 다르면 기간 + `c`)를 한 묶음.
- [ ] **Step 1: 실패하는 시험** — `merge.test.ts`(`// @vitest-environment node`, `mkPlan`·`pid` 사용). 사례(기대값을 정확히 단언한다):
  1. `한쪽만 바꾼 제목은 그대로 들어온다`(B=M, T title `'새 이름'` → plan.title `'새 이름'`, conflicts `[]`).
  2. `서로 다른 Day 출발 시각은 둘 다 남는다`(M d0 `10:00`, T d1 `08:00`).
  3. `같은 Day 출발 시각을 다르게 바꾸면 day.0.startTime 겹침, 같은 값이면 겹침 없음`.
  4. `legModes는 키마다 병합하고 같은 키를 다르게 바꾸면 legMode 겹침`.
  5. `같은 Day 순서를 다르게 바꾸면 placement.d0`(B `[a,b,c]`, M `[b,a,c]`, T `[a,c,b]`; `mine.lists.d0`·`theirs.lists.d0` 확인).
  6. `한쪽은 장소를 Day 0→1로, 다른 쪽은 Day 2 순서를 바꾸면 둘 다 남는다`.
  7. `같은 장소를 서로 다른 Day로 옮기면 placement.d0,d1,d2 하나`.
  8. `한쪽은 Stop을 후보로 빼고 다른 쪽은 그 Stop 메모를 고치면 placement.c,d0`.
  9. `한쪽이 기간을 3일→2일로 줄이고 다른 쪽이 Day 3(d2)에 장소를 더하면 placement.period,c,d2`.
  10. `양쪽이 같은 새 장소를 다른 Day에 넣으면 placement.d0,d1`.
  11. `옮긴 Stop의 머무는 시간을 다른 쪽이 바꾸면 겹침 없이 옮긴 자리에 바뀐 값`.
  12. `M이 Day를 하나 늘리면 결과 Day id는 T의 세 개 + M의 네 번째`.
  13. `기준이 없으면 같은 곳은 그대로, 다른 값은 값 겹침, 다른 목록은 한 묶음`.
  14. `resolve: 7번 사례에서 mine을 고르면 장소가 M의 Day에 있고 checkPlan이 []`, `theirs를 고르면 T의 Day`.
  15. `resolve: 고르지 않은 겹침이 있으면 missing`.
  16. `안전망: 장소가 두 번 든 M(잘못된 입력)이 이기는 목록이면 placement.all`.
  17. `겹침 id는 입력 객체 키 순서와 무관하게 같다`.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trip-collab/merge.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`, `yarn lint`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 3방향 병합과 겹침 묶음`

### Task 4: 장소 대응표와 보관함 반영

**Files:**
- Create: `src/domain/trip-collab/places.ts`, `src/domain/trip-collab/apply.ts`
- Test: `tests/unit/domain/trip-collab/places.test.ts`, `tests/unit/domain/trip-collab/apply.test.ts`

**Interfaces:**
- Consumes: Task 2, `importSharePlaces`(`src/domain/library/import-share.ts`), `receivedTripTitle`(`src/domain/library/import-share-trip.ts`), `setField`(`src/domain/library/lww.ts`), `checkTrip`(`src/schema/trip.ts`), `OpCtx`·`OpResult`·`OpError`(`src/domain/library/ops.ts`), `LiveTripDoc`
- Produces:
  - `places.ts`
    - `export type PlaceMap = Readonly<Record<string, string>>` — 서버 장소 id → 로컬 장소 id.
    - `export function sameSource(place: Place, shared: SharePlace): boolean` — 네이버 `sid === naverSid`, 카카오 `kakaoId`, 구글 `googleId`가 같으면 참. 둘 다 출처 id가 없고(로컬 `pin`, 공유에 세 id 모두 없음) `|lng 차| < 1e-7`·`|lat 차| < 1e-7`이면 참.
    - `export function mapServerPlaces(lib: Library, doc: LiveTripDoc, placeMap: PlaceMap, ctx: OpCtx): { ok: true; lib: Library; placeMap: Record<string, string> } | { ok: false; error: OpError }` — 대상은 `doc.share.places` 가운데 대응이 없거나 대응한 로컬 id가 `lib.places`에 없는 것. ① `lib.places[서버 id]`가 있고 `sameSource`면 항등으로 잇는다(지운 장소면 `deletedAt: null`로 되살린 새 객체). ② 나머지는 `importSharePlaces(lib, doc.share, { selected: 남은 id들, titleLabel: null, appendMemo: false }, ctx)`의 `placeIds`로 잇는다. 남은 것이 없으면 `lib`을 그대로(같은 참조) 돌려준다. 결과 대응표는 입력에 새 항목을 더한 새 객체.
    - `export function assignServerPlaceIds(trip: Trip, placeMap: PlaceMap, taken: ReadonlySet<string>, newId: () => string): Record<string, string>` — 여행이 참조하는 로컬 장소(출발지·후보·Stop·숙소) 가운데 대응표의 값에 없는 것마다 서버 id를 정한다: 로컬 id가 `taken`(공동본 장소 id)·대응표 키에 없으면 그 id, 있으면 겹치지 않을 때까지 `newId()`. 입력에 새 항목을 더한 새 객체를 돌려준다.
    - `export function serverIdOf(placeMap: PlaceMap): (localId: string) => string` — 역방향 표. 없는 로컬 id면 `throw new Error(\`대응이 없는 장소: ${localId}\`)`.
    - `export function stopIdClashes(mine: CollabPlan, theirs: CollabPlan, base: CollabPlan | null): string[]` — `mine`에만 새로 생긴(기준에 없는) Stop id 가운데 `theirs`에 다른 `placeId`로 있는 id.
    - `export function renameStopIds(lib: Library, tripId: string, ids: readonly string[], ctx: OpCtx): OpResult` — 그 여행의 해당 Stop id를 `ctx.newId('stop')`로 바꾼다(stops 필드 `setField`). 없는 id는 건너뛴다.
  - `apply.ts`
    - `export function applyCollabPlan(lib: Library, tripId: string, plan: CollabPlan, placeMap: PlaceMap, ctx: OpCtx): OpResult` — 계획의 서버 장소 id를 대응표로 로컬 id로 옮긴다(없으면 `{ ok: false, error: { _tag: 'NotFound', id: 서버 id } }`). 살아 있는 여행이 아니면 `NotFound`. 여행 필드 `title`·`startDate`·`endDate`·`origin`·`candidates`·`legModes`를 `setField`로(값이 같으면 같은 참조), `days`는 계획 Day 수로 맞춘다: 있는 Day는 `stops`·`lodging`·`startTime`을 `setField`, 새 Day는 세 필드 모두 `{ value, updatedAt: ctx.now }`. Stop 객체는 `{ id, placeId: 로컬, stayMin, fixedTime, note }`. 바뀐 것이 없으면 같은 `lib`. 결과 여행이 `checkTrip`에 걸리면 `{ ok: false, error: { _tag: 'TripChanged', id: tripId } }`.
    - `export function importCollabTrip(lib: Library, doc: LiveTripDoc, ctx: OpCtx): { ok: true; lib: Library; tripId: string; placeMap: Record<string, string>; dayIds: string[] } | { ok: false; error: OpError }` — `mapServerPlaces(lib, doc, {}, ctx)` 뒤 `ctx.newId('trip')`로 새 여행을 만든다: 모든 필드 `updatedAt: ctx.now`, `title: receivedTripTitle(plan.title)`, Stop id는 서버 Stop id 그대로, `createdAt: ctx.now`, `deletedAt: null`. `dayIds = plan.days.map((d) => d.id)`. `checkTrip` 실패면 `TripChanged`.
- [ ] **Step 1: 실패하는 시험** — `places.test.ts`: `같은 id·같은 네이버 sid면 항등으로 잇는다`, `같은 id라도 출처가 다르면 가져오기로 새 장소`, `다른 id의 같은 네이버 장소를 찾아 잇는다(장소 수 그대로)`, `지운 장소는 되살아난다`, `대응이 모두 있으면 lib이 같은 참조`, `assignServerPlaceIds: 로컬 id를 쓰고, taken과 겹치면 newId`, `serverIdOf가 없는 id에 던진다`, `stopIdClashes`, `renameStopIds`. `apply.test.ts`: `계획이 여행이 되고 LibrarySchema(safeParse)를 통과한다`, `출발 시각만 바뀌면 그 Day의 startTime만 updatedAt이 바뀐다`, `Day가 늘면 새 Day 세 필드가 ctx.now`, `대응표에 없는 서버 id면 NotFound`, `importCollabTrip: Stop id·Day id 보존, 대응표가 모든 문서 장소를 덮음, 제목`.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trip-collab/places.test.ts tests/unit/domain/trip-collab/apply.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 장소 대응표와 보관함 반영`

### Task 5: 공동본 만들기

**Files:**
- Create: `src/domain/trip-collab/build-doc.ts`
- Modify: `src/domain/trips/query.ts`(`legBetween` 꺼내기)
- Test: `tests/unit/domain/trip-collab/build-doc.test.ts`, 기존 `tests/unit/domain/trips/*` 그대로 통과

**Interfaces:**
- Consumes: Task 2·4, `toSharePlace`·`toShareLabels`(`src/domain/share/build-share.ts`), `thinPaths`·`ShareLegTime`(`src/domain/share/build-trip-share.ts`), `dayPoints`(`src/domain/share/check-share-trip.ts`), 2A `parseLiveDoc`·`LIVE_PATH_POINTS_MAX`·`LiveTripOptions`
- Produces:
  - `query.ts`: `export function legBetween(trip: Trip, from: Place, to: Place): Leg` — 지금 `dayLegs` 반복문 안의 `key`·`straightM`·`walkAllowed`·`mode`·`modeSource` 계산을 그대로 옮긴 것. `dayLegs`는 이것을 부른다(동작 같음).
  - `build-doc.ts`
    - `export type CollabRouteOf = (fromServerId: string, toServerId: string) => { mode: 'car' | 'walk'; time: ShareLegTime }`
    - `export function buildCollabDoc(input: { plan: CollabPlan; previous: LiveTripDoc | null; lib: Library; placeMap: PlaceMap; role: 'owner' | 'editor'; options: LiveTripOptions; createdAt: string; routeOf: CollabRouteOf }): LiveTripDoc | null`
      - 장소 순서: 출발지 → Day마다 [Stop → 숙소] → 후보, 같은 id는 처음 한 번. 0곳이면 null.
      - 장소 정보: `previous`에 같은 id가 있으면 그 항목 사본. 없으면 `toSharePlace(lib.places[placeMap[id]], lib, role === 'owner' && options.includeMemo, true)`에 `id`를 서버 id로 바꾼 것(로컬 장소가 없으면 `throw`).
      - 라벨: `previous.share.labels` 가운데 쓰인 것 + 새 장소의 로컬 라벨(`toShareLabels`), id로 중복 제거(앞의 것 유지), `order` 오름차순. 장소의 `labelIds`는 목록에 있는 것만.
      - Day: `startTime`, `lodgingId: day.lodging`, `stops`(`note`가 비면 키 없음), `legs` = 그날 `dayPoints`(서버 id 기준 `ShareTrip`)의 이웃 쌍마다 `routeOf(from, to)` → `{ from, to, mode, durationS, distanceM, tollFare, status, queriedAt: status === 'routed' ? queriedAt : null, path: status === 'routed' ? path : [] }`. 경로선은 `thinPaths(days, LIVE_PATH_POINTS_MAX)`.
      - `legModes`: 계획의 키 가운데 두 끝이 문서 장소인 것만.
      - 결과 `{ format: 'landmark-trip-live', v: 2, share: { format: 'tripmap-share', version: 2, title: plan.title, createdAt, labels, places, trips: [{ title: plan.title, startDate, endDate, originId: plan.origin, candidateIds: plan.candidates, days, legModes }] }, ids: { days: 계획 Day id, stops: 계획 Stop id }, options: { includeMemo: options.includeMemo, includeCandidates: true } }`. `parseLiveDoc`가 null이면 `throw new Error('공동본 검사 실패')`(만드는 쪽 버그).
- [ ] **Step 1: 실패하는 시험** — `build-doc.test.ts`: `공동본에 있던 장소는 previous의 이름·라벨을 쓴다(로컬 이름이 달라도)`, `새 장소는 로컬 정보로 만들고 편집 기기면 memo·review가 없다`, `소유자이고 includeMemo면 새 장소 memo가 있다`, `구간 수가 dayPoints − 1이고 routeOf가 서버 id로 불린다`, `보관함에서 지운 장소의 Stop도 문서에 있다`, `parseLiveDoc 통과·v 2·includeCandidates true`, `장소가 없으면 null`. `tests/unit/domain/trips/query.test.ts`(있으면)·`planner-*` 시험이 그대로 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trip-collab/build-doc.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/domain tests/unit/sections/trips`, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 공동본 만들기`

### Task 6: 공동 진행 도메인

**Files:**
- Create: `src/domain/trip-collab/progress.ts`
- Test: `tests/unit/domain/trip-collab/progress.test.ts`

**Interfaces:**
- Consumes: Task 1(`COLLAB_LIMITS`)
- Produces(Effect 없음, 서버도 타입을 가져온다):
  - `export type ProgressOp = { stopId: string; visited: boolean; date: string; at: string }`
  - `export type NextOp = { stopId: string | null; date: string; at: string }`
  - `export type ProgressMark = { stopId: string; date: string; at: string; by: { device: string; label: string } }`
  - `export type SharedNext = { stopId: string; date: string; at: string; label: string }`
  - `export type SharedProgress = { prev: number; marks: ProgressMark[]; next: SharedNext | null }`
  - `export function sharedMarkOf(progress: SharedProgress | null, stopId: string, period: { startDate: string; endDate: string }): ProgressMark | null` — 그 Stop의 표시가 있고 `date`가 기간 안이면 그것.
  - `export function sharedNextIndex(progress: SharedProgress | null, date: string, stopIds: readonly string[], visited: readonly boolean[]): number | null` — `next`가 있고 `next.date === date`이고 그 Stop이 `stopIds`에 있고 아직 안 다녀왔으면 그 자리, 아니면 null.
  - `export function queueOp(queue: readonly ProgressOp[], op: ProgressOp, max: number = COLLAB_LIMITS.pendingOps): ProgressOp[]` — 같은 `stopId`는 지우고 끝에 더한다. 길이가 `max`를 넘으면 앞에서 버린다.
  - `export function withLocalOps(progress: SharedProgress | null, ops: readonly ProgressOp[], me: { device: string; label: string }): SharedProgress` — 보내지 못한 내 체크를 겹쳐 보인 사본(`visited`면 표시를 넣거나 바꾸고, 아니면 뺀다. `at`이 기존 표시보다 이를 때는 바꾸지 않는다).
- [ ] **Step 1: 실패하는 시험** — `기간 밖 날짜 표시는 null`, `정한 다음 장소: 날짜가 같고 안 다녀왔을 때만`, `다녀왔으면 null`, `queueOp: 같은 Stop은 마지막만·상한`, `withLocalOps: 체크·풀기·늦은 기존 표시 유지`.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trip-collab/progress.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 공동 진행 도메인`

### Task 7: 서버 기반 — 스키마 4·한도·스위치·2A 경로 고침

**Files:**
- Modify: `src/server/meet/schema-sql.ts`, `src/server/meet/limits.ts`, `src/server/meet/env.ts`, `src/server/trip-live/handlers.ts`(2A)
- Test: `tests/unit/server/meet-db.test.ts`, `tests/unit/server/meet-limits.test.ts`, `tests/unit/server/trip-live-handlers.test.ts`(사례 추가)

**Interfaces:**
- Produces:
  - `SCHEMA_VERSION = 4`. `SCHEMA_STATEMENTS` 끝에 설계 문서 §D1 표의 네 문장을 그 순서대로(`trip_collab_devices`, `trip_collab_devices_token`, `trip_collab_meta`, `trip_progress`), 앞에 주석 `// 4: 여행 함께 편집(2B). 초대는 2A trip_share_tokens(kind='invite')를 쓴다.`
  - `LIMITS`에 기존 키 뒤로 `collabInvite: 60, collabAccept: 30, collabUpdate: 1200, collabProgress: 2000, collabManage: 300, collabRead: 5000`.
  - `MeetEnv`에 `TRIP_COLLAB?: string`(`TRIP_SHARE_LIVE` 다음 줄).
  - 2A `handleLiveUpdate`: `parseLiveDoc`를 통과한 뒤 `SELECT json_extract(doc, '$.v') AS v FROM trip_shares WHERE id = ?`(2A가 이미 읽는 행 질의에 열로 더해도 된다)로 저장된 버전을 읽어 `doc.v < (v ?? 1)`이면 `MeetError('CONFLICT', '새 버전의 앱이 필요해요', { reason: 'version' })`. 순서는 토큰 확인 뒤, `UPDATE` 전.
  - 2A `handleLiveDelete`의 `batch` 앞쪽에 `DELETE FROM trip_progress WHERE share_id = ?`, `DELETE FROM trip_collab_meta WHERE share_id = ?`, `DELETE FROM trip_collab_devices WHERE share_id = ?`를 더한다(초대는 2A의 `trip_share_tokens` 지우기가 이미 지운다).
  - 2A `pruneExpiredLive`: 같은 배치 안 하위 질의(`SELECT id FROM trip_shares WHERE expires_at <= ? ORDER BY expires_at, id LIMIT ?`)로 세 표를 먼저 지우고 2A 문장을 그대로 둔다. 돌려주는 값(지운 공유 수)은 `trip_shares` 문장의 변경 수 그대로(문장 위치가 바뀌면 그 위치를 고친다).
- [ ] **Step 1: 실패하는 시험** — `meet-db.test.ts`: 버전 기대 `4`, `버전 3 DB에서 ensureSchema가 2B 표 세 개와 색인을 더하고 기존 trip_shares 행을 지킨다`, `SCHEMA_STATEMENTS의 마지막 네 문장은 함께 편집 표이고 모두 IF NOT EXISTS`. `meet-limits.test.ts`: `collabAccept는 30번까지 true, 31번째 false`. `trip-live-handlers.test.ts`: `저장 문서가 v2면 v1 PUT은 409 reason version, v2 PUT은 200`, `v1 저장 문서에 v2 PUT은 200(올리기)`, `지우기가 trip_collab_devices·trip_collab_meta·trip_progress 행도 지운다`, `pruneExpiredLive가 만료 공유의 2B 행을 지우고 만료 안 된 공유의 행은 남긴다`.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/meet-db.test.ts tests/unit/server/meet-limits.test.ts tests/unit/server/trip-live-handlers.test.ts` → 새 사례 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 위 명령 통과, `yarn vitest run tests/unit/server`, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): D1 표(스키마 4)·한도·스위치와 2A 버전 거절`

### Task 8: 함께 편집 서버 처리와 Pages 진입점

**Files:**
- Create: `src/server/trip-collab/handlers.ts`, `functions/api/trip-collab/[id]/invites.ts`, `functions/api/trip-collab/[id]/invites/[key].ts`, `functions/api/trip-collab/[id]/invite.ts`, `functions/api/trip-collab/[id]/accept.ts`, `functions/api/trip-collab/[id]/state.ts`, `functions/api/trip-collab/[id]/doc.ts`, `functions/api/trip-collab/[id]/progress.ts`, `functions/api/trip-collab/[id]/members.ts`, `functions/api/trip-collab/[id]/members/[device].ts`
- Test: `tests/unit/server/trip-collab-handlers.test.ts`(`// @vitest-environment node`, `createSqliteD1()`), `tests/unit/server/functions.test.ts`에 연결 사례

**Interfaces:**
- Consumes: Task 1·6·7, `withRequest`·`prepare`·`checkLimit`·`validate`·`MeetError`·`MeetDeps`·`readJson`(`src/server/meet/handlers.ts`), `MeetContext`, `hashToken`, `ApiError`·`jsonResponse`, 2A `LIVE_ID_PATTERN`·`LIVE_TOKEN_PATTERN`·`parseLiveDoc`·`liveDocBytes`·`LIVE_DOC_MAX_BYTES`·`LIVE_REQUEST_MAX_BYTES`·`liveExpiresAt`·`readLimitedJson`, 2A `pruneExpiredLive`
- Produces(`src/server/trip-collab/handlers.ts`, 모두 `(ctx: MeetContext, deps: MeetDeps) => Promise<Response>`, 모두 `withRequest`로 감싸고 응답에 `Cache-Control: private, no-store`):
  - 공통 도우미(내보내지 않아도 됨)
    - `readShareId(ctx)`: `params.id`가 `LIVE_ID_PATTERN`이 아니면 `ApiError('BAD_REQUEST', '공유 id가 올바르지 않아요')`.
    - `liveShare(db, id, now, countAction?)`: `SELECT s.rev, s.updated_at, s.expires_at, m.progress_rev, m.edited_label FROM trip_shares s LEFT JOIN trip_collab_meta m ON m.share_id = s.id WHERE s.id = ?`. 없으면(카운트 후) `404 NOT_FOUND`, 기한 지났으면(카운트 후) `410 ENDED`. 카운트는 `countAction`이 있을 때 `checkLimit(ctx, now, 'collabRead')`.
    - `bearer(ctx)`: `Authorization: Bearer <t>`의 `t`(없으면 null).
    - `resolveRole(ctx, id)`: 토큰 해시가 `trip_share_tokens`(`share_id = ? AND kind = 'owner'`)에 있으면 `{ role: 'owner', deviceId: null, label: OWNER_LABEL }`, `trip_collab_devices`(`share_id = ? AND token_hash = ?`)에 있으면 `{ role: 'editor', deviceId, label, seenAt }`, 아니면 `ApiError('UNAUTHORIZED', '함께 편집 권한을 확인해 주세요')`.
    - `switchesOff(ctx)`: `ctx.env.TRIP_COLLAB === 'off' || ctx.env.TRIP_SHARE_LIVE === 'off'` → `MeetError('UNAVAILABLE', '함께 편집이 꺼져 있어요', { reason: 'off' })`. 진행 올리기는 `TRIP_COLLAB`만 본다.
  - `handleCollabInviteCreate` — 순서: 스위치 → id → `prepare(ctx, now, 'collabInvite')` → `liveShare` → 소유자 확인(아니면 401) → `readJson` → `validate({ token: LIVE_TOKEN_PATTERN, label: NullOr(String) })` → `json_extract(doc,'$.v')`가 2가 아니면 `MeetError('CONFLICT', '먼저 공동 편집을 켜 주세요', { reason: 'upgrade' })` → 같은 해시의 `invite` 행이 이 공유에 있으면 `200 { key, expiresAt, created: false }` → 살아 있는 초대(`kind = 'invite' AND expires_at > now`) 수가 10이면 `MeetError('CONFLICT', '기다리는 초대가 너무 많아요', { reason: 'full' })` → 지난 초대 행을 지우고 `INSERT INTO trip_share_tokens (hash, share_id, kind, label, expires_at, created_at) VALUES (?, ?, 'invite', ?, ?, ?)`(`label` = `normalizeInviteLabel`, `expires_at` = `inviteExpiresAt(now, share.expires_at)`) → `201 { key: inviteKeyOf(hash), expiresAt, created: true }`.
  - `handleCollabInviteCancel` — id → `params.key`가 `COLLAB_INVITE_KEY_PATTERN` → `prepare(ctx, now, 'collabManage')` → 공유가 있는지(없으면 404, 기한 지난 것도 허용) → 소유자 → `DELETE FROM trip_share_tokens WHERE share_id = ? AND kind = 'invite' AND substr(hash, 1, 16) = ?` → `204`. 스위치와 무관.
  - `handleCollabInvitePreview` — id → `prepare(ctx, now)` → `liveShare(…, 'count')` → 초대 해시 행(`kind = 'invite' AND expires_at > now`)이 없으면 `checkLimit('collabRead')` 후 `MeetError('UNAUTHORIZED', '이미 쓴 초대이거나 닫힌 초대예요', { reason: 'invite' })` → `SELECT json_extract(doc,'$.share.title') AS title, json_extract(doc,'$.share.trips[0].startDate') AS startDate, json_extract(doc,'$.share.trips[0].endDate') AS endDate FROM trip_shares WHERE id = ?` → `200 { title, startDate, endDate, expiresAt: 초대 기한 }`. 스위치와 무관.
  - `handleCollabAccept` — 스위치 → id → `prepare(ctx, now, 'collabAccept')` → `liveShare` → `readJson` → `validate({ deviceToken: LIVE_TOKEN_PATTERN, label: String })` → `normalizeDeviceLabel`(null이면 400) → `deviceToken === 초대 토큰`이면 400 → 같은 `token_hash`의 기기가 이 공유에 있으면 `200 { deviceId, rev }`(재시도) → 기기 수 ≥ 20이면 `409 { reason: 'full' }` → `deviceId`를 8자 a-z0-9로 만든다(이 공유에서 겹치면 다시) → `batch([INSERT INTO trip_collab_devices (share_id, device_id, token_hash, label, created_at, seen_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM trip_share_tokens WHERE hash = ? AND share_id = ? AND kind = 'invite' AND expires_at > ?), DELETE FROM trip_share_tokens WHERE hash = ? AND share_id = ? AND kind = 'invite'])` → 첫 문장 변경 수가 0이면 같은 `token_hash` 기기를 다시 확인해 있으면 `200`, 없으면 `MeetError('UNAUTHORIZED', …, { reason: 'invite' })` → `INSERT INTO trip_collab_meta (share_id, progress_rev) VALUES (?, 0) ON CONFLICT(share_id) DO NOTHING` → `201 { deviceId, rev }`.
  - `handleCollabState` — id → `prepare(ctx, now)` → `liveShare(…, 'count')` → `resolveRole` → 질의 `rev`·`prev`(정수가 아니면 없는 것으로) → 둘 다 있고 같으면 `304`(본문 없음) → 편집 기기이고 `seen_at`이 1시간보다 오래면 `UPDATE trip_collab_devices SET seen_at = ? WHERE share_id = ? AND device_id = ?` → `members` = `SELECT count(*) FROM trip_collab_devices WHERE share_id = ?` → `rev`가 없거나 다르면 `SELECT doc FROM trip_shares WHERE id = ?`, `prev`가 없거나 다르면 진행(`SELECT stop_id, date, at, by_device, by_label FROM trip_progress WHERE share_id = ? AND visited = 1 ORDER BY at`과 meta의 `next_*`) → 본문은 2A `handleLiveGet`처럼 문자열로 잇는다: `{"rev":…,"updatedAt":…,"expiresAt":…,"role":…,"deviceId":…,"members":…,"editedBy":…` + (문서면 `,"doc":` + 저장 문자열) + (진행이면 `,"progress":` + `JSON.stringify({ prev, marks, next })`) + `}`.
  - `handleCollabPutDoc` — 스위치 → id → `prepare(ctx, now, 'collabUpdate')` → `liveShare` → `resolveRole` → `readLimitedJson(ctx.request, LIVE_REQUEST_MAX_BYTES)` → `validate({ doc: Unknown, baseRev: 정수 ≥ 1 })` → `parseLiveDoc`가 null이거나 `v !== 2`면 `MeetError('BAD_REQUEST', '일정 문서가 올바르지 않아요', { reason: 'doc' })` → 크기 초과 `413` → 저장된 `v`(`json_extract`)가 2보다 크면 `409 { reason: 'version' }` → `UPDATE trip_shares SET doc = ?, rev = rev + 1, updated_at = ?, expires_at = ? WHERE id = ? AND rev = ?`(`expires_at` = `liveExpiresAt(문서 끝날, now)`) → 변경 수 0이면 지금 `rev`로 `MeetError('CONFLICT', '다른 기기에서 일정을 바꿨어요', { rev })` → 성공 뒤 따로 `INSERT INTO trip_collab_meta (share_id, progress_rev, edited_label, edited_at) VALUES (?, 0, ?, ?) ON CONFLICT(share_id) DO UPDATE SET edited_label = excluded.edited_label, edited_at = excluded.edited_at`(이름 표시용이라 같은 배치가 아니어도 된다) → `200 { rev: baseRev + 1, expiresAt }` + `ctx.waitUntil(pruneExpiredLive(db, now, 20).catch(() => undefined))`.
  - `handleCollabProgress` — `TRIP_COLLAB === 'off'`면 503 → id → `prepare(ctx, now, 'collabProgress')` → `liveShare` → `resolveRole` → `readLimitedJson(ctx.request, COLLAB_LIMITS.progressRequestBytes)` → `validate({ ops: Array(0..50 of { stopId: COLLAB_STOP_ID_PATTERN, visited: Boolean, date: CalendarDate 패턴, at: IsoDateTime }), next: optionalKey({ stopId: NullOr(stop 패턴), date, at }) })`(ops가 0개인데 `next`도 없으면 400) → 새 Stop 행이 생기면 행 수가 2,000을 넘는지 확인(넘으면 `409 { reason: 'full' }`) → `at`은 `min(at, now)` → `batch([...ops.map(INSERT INTO trip_progress (share_id, stop_id, visited, date, by_device, by_label, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(share_id, stop_id) DO UPDATE SET visited = excluded.visited, date = excluded.date, by_device = excluded.by_device, by_label = excluded.by_label, at = excluded.at WHERE excluded.at > trip_progress.at), (next면) INSERT INTO trip_collab_meta (share_id, progress_rev, next_stop_id, next_date, next_label, next_at) VALUES (?, 0, ?, ?, ?, ?) ON CONFLICT(share_id) DO UPDATE SET next_stop_id = excluded.next_stop_id, next_date = excluded.next_date, next_label = excluded.next_label, next_at = excluded.next_at WHERE trip_collab_meta.next_at IS NULL OR excluded.next_at > trip_collab_meta.next_at, INSERT INTO trip_collab_meta (share_id, progress_rev) VALUES (?, 1) ON CONFLICT(share_id) DO UPDATE SET progress_rev = progress_rev + 1])` → 진행을 다시 읽어 `200 { prev, marks, next }`. 기기 이름: 소유자 `OWNER_LABEL`·`by_device = OWNER_DEVICE`, 편집 기기 그 기기 `label`·`device_id`.
  - `handleCollabMembers` — id → `prepare(ctx, now)` → `liveShare` → 소유자(아니면 401) → `200 { devices: [{ deviceId, label, createdAt, seenAt }](created_at 순), invites: [{ key, label, createdAt, expiresAt }](살아 있는 것, created_at 순) }`.
  - `handleCollabRemoveMember` — id → `params.device`가 `me`이거나 `COLLAB_DEVICE_ID_PATTERN` → `prepare(ctx, now, 'collabManage')` → 공유 확인(없으면 404, 기한 지난 것도 허용) → `me`면 편집 기기 토큰이어야 하고 그 기기 행을 지운다, 기기 id면 소유자여야 하고 `DELETE FROM trip_collab_devices WHERE share_id = ? AND device_id = ?` → `204`. 스위치와 무관.
- 진입점(모두 `{ fetch: globalFetch, now: () => new Date() }`):
  - `[id]/invites.ts`: `onRequestPost = handleCollabInviteCreate`
  - `[id]/invites/[key].ts`: `onRequestDelete = handleCollabInviteCancel`
  - `[id]/invite.ts`: `onRequestGet = handleCollabInvitePreview`
  - `[id]/accept.ts`: `onRequestPost = handleCollabAccept`
  - `[id]/state.ts`: `onRequestGet = handleCollabState`
  - `[id]/doc.ts`: `onRequestPut = handleCollabPutDoc`
  - `[id]/progress.ts`: `onRequestPost = handleCollabProgress`
  - `[id]/members.ts`: `onRequestGet = handleCollabMembers`
  - `[id]/members/[device].ts`: `onRequestDelete = handleCollabRemoveMember`
- [ ] **Step 1: 실패하는 시험** — `trip-collab-handlers.test.ts`. 준비 도우미: 2A `handleLiveCreate`로 공유를 만들고(2A 시험의 문서) 2A `handleLiveUpdate`로 v2 문서(같은 내용, `v: 2`)를 올린 상태 `setupV2()`. 사례와 단언:
  - 초대: `소유자가 만들면 201 created true, DB에는 해시만(원문 0행), kind invite, expires_at = min(+7일, 공유 기한)`, `같은 토큰 재시도 200 created false`, `v1 문서면 409 upgrade`, `11번째 살아 있는 초대 409 full`, `보기 토큰·편집 기기 토큰은 401`, `TRIP_COLLAB=off·TRIP_SHARE_LIVE=off면 503 off`, `61번째 429`.
  - 미리보기: `200 제목·기간·초대 기한`, `쓴 초대 401 reason invite이고 그때만 collabRead를 센다`, `지난 초대 401`.
  - 수락: `201 deviceId 8자, 초대 행이 지워지고 기기 행 하나`, `같은 초대로 다른 deviceToken은 401 invite`, `같은 deviceToken 재시도는 200 같은 deviceId`, `21번째 기기는 409 full`, `label이 비면 400`, `스위치 off 503`.
  - state: `편집 기기 200 role editor·deviceId·doc·progress`, `소유자 200 role owner`, `보기 토큰 401`, `rev·prev가 같으면 304 본문 없음`, `rev만 같으면 doc 없이 progress만`, `members 수·editedBy`, `seen_at은 1시간 안에는 그대로·지나면 갱신`, `거둔 기기 401`, `없는 공유 404·기한 지난 공유 410(그때만 셈)`, `Cache-Control`.
  - doc: `편집 기기 PUT 200 rev+1, edited_label이 기기 이름`, `baseRev 다르면 409 rev`, `v1 문서 400 doc`, `TRIP_SHARE_LIVE=off 503`, `거둔 기기 401`, `524,288바이트 초과 413`.
  - progress: `체크 200 prev 1·marks 하나·by label`, `늦은 at이 이기고 이른 at은 무시`, `미래 at은 서버 시각으로 자른다`, `풀기 뒤 marks에서 빠진다`, `51개 400`, `2,001번째 Stop 행 409 full`, `next 정하기·더 이른 next 무시`, `TRIP_COLLAB=off 503이고 TRIP_SHARE_LIVE=off는 영향 없음`.
  - members·거두기: `소유자 목록에 기기·살아 있는 초대`, `편집 기기는 members 401`, `거둔 뒤 그 기기 state 401`, `me로 그만두기 204 뒤 401`, `다른 기기 id를 편집 기기 토큰으로 지우려 하면 401`, `초대 취소 204 뒤 그 초대로 수락 401`, `off여도 거두기·취소·그만두기·state는 된다`.
  - `functions.test.ts`: `trip-collab 진입점이 env.DB로 초대 201·수락 201·state 200·거두기 204를 돌려준다`.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/trip-collab-handlers.test.ts tests/unit/server/functions.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/server`, `yarn typecheck`, `yarn lint`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 함께 편집 서버 처리와 Pages 진입점`

### Task 9: 기기 기록·기준 저장·API 클라이언트

**Files:**
- Create: `src/services/trip-collab/store.ts`, `src/services/trip-collab/client.ts`
- Modify: `src/services/trip-live/client.ts`(2A, `TripLiveError`에 `'version'`)
- Test: `tests/unit/services/trip-collab-store.test.ts`, `tests/unit/services/trip-collab-client.test.ts`, 2A `tests/unit/services/trip-live-client.test.ts`에 사례 하나

**Interfaces:**
- Consumes: Task 1·2·6, 2A `createTripLiveStore` 관례·`LiveResult`·`TripLiveError`·`parseLiveDoc`
- Produces:
  - 2A `client.ts`: `TripLiveError`에 `'version'`. 상태 해석 `409`이고 `reason === 'version'` → `'version'`(기존 `taken`·`conflict` 앞).
  - `store.ts`
    - `TRIP_COLLAB_KEY = 'tripmap:trip-collab:v1'`, `TRIP_COLLAB_MAX = 100`, `collabBaseKey(liveId: string) => \`tripmap:trip-collab-base:v1:${liveId}\``
    - `type TripCollabRecord`(설계 문서 §브라우저 저장 그대로), `type CollabBase = { rev: number; plan: CollabPlan; progress: SharedProgress | null }`
    - `createTripCollabStore(storage?: () => Storage)` → `{ subscribe(fn): () => void; list(): readonly TripCollabRecord[]; get(tripId): TripCollabRecord | undefined; byLiveId(liveId): TripCollabRecord | undefined; put(record): void; update(tripId, patch: Partial<Omit<TripCollabRecord, 'tripId'>>): void; remove(tripId): void /* 기준 키도 지움 */; readBase(liveId): CollabBase | null; writeBase(liveId, base: CollabBase): void /* 실패하면 메모리 */; }` — 2A `createTripLiveStore`와 같은 방식(항목마다 Effect Schema 검사·틀린 항목만 버림·100개 넘으면 `syncedAt` 오래된 것부터 버리고 그 기준 키도 지움·같은 원문이면 같은 배열·`storage` 이벤트·막힌 저장소는 메모리). 기준 값도 Effect Schema로 검사하고 틀리면 null.
    - `export const tripCollabStore = createTripCollabStore()`, `useTripCollabRecord(tripId)`, `useTripCollabRecords()`.
  - `client.ts`
    - `type TripCollabError = TripLiveError | 'invite' | 'full' | 'upgrade'`
    - `type CollabState = { rev: number; updatedAt: string; expiresAt: string; role: 'owner' | 'editor'; deviceId: string | null; members: number; editedBy: string | null; doc?: LiveTripDoc; progress?: SharedProgress }`
    - `tripCollabApi = { createInvite(id, ownerToken, body: { token: string; label: string | null }): Promise<LiveResult<{ key: string; expiresAt: string; created: boolean }, TripCollabError>>; cancelInvite(id, ownerToken, key): Promise<LiveResult<void, TripCollabError>>; previewInvite(id, inviteToken): Promise<LiveResult<{ title: string; startDate: string; endDate: string; expiresAt: string }, TripCollabError>>; accept(id, inviteToken, body: { deviceToken: string; label: string }): Promise<LiveResult<{ deviceId: string; rev: number }, TripCollabError>>; state(id, token, since: { rev: number | null; prev: number | null }): Promise<LiveResult<CollabState | 'unchanged', TripCollabError>>; putDoc(id, token, doc: LiveTripDoc, baseRev: number): Promise<LiveResult<{ rev: number; expiresAt: string }, TripCollabError>>; progress(id, token, body: { ops: ProgressOp[]; next?: NextOp }): Promise<LiveResult<SharedProgress, TripCollabError>>; members(id, ownerToken): Promise<LiveResult<{ devices: CollabDevice[]; invites: CollabInvite[] }, TripCollabError>>; removeMember(id, token, device: string /* 'me' 또는 기기 id */): Promise<LiveResult<void, TripCollabError>> }` — 2A `LiveResult`가 오류 타입 인자를 받지 않으면 `type CollabResult<A> = { ok: true; value: A } | { ok: false; error: TripCollabError; rev?: number }`를 이 파일에 둔다.
    - 경로는 설계 문서 §API. `credentials: 'same-origin'`, `cache: 'no-store'`, `Authorization: Bearer`. 응답 봉투는 Effect Schema(`onExcessProperty: 'error'`), `doc`은 `parseLiveDoc`로(실패 `invalid`). 상태 해석은 2A와 같고 더한다: `401 reason invite` → `invite`, `409 reason full` → `full`, `409 reason upgrade` → `upgrade`, `409 reason version` → `version`. `cancelInvite`·`removeMember`는 404·410도 성공.
- [ ] **Step 1: 실패하는 시험** — store: `왕복`, `깨진 JSON은 빈 목록`, `틀린 항목만 버린다`, `remove가 기준 키도 지운다`, `101번째에 가장 오래된 기록과 그 기준을 버린다`, `기준 쓰기가 던지면 메모리로 읽힌다`, `다른 탭 storage 이벤트`. client: `각 메서드의 경로·메서드·헤더·본문`, `state 304 → unchanged`, `state가 doc·progress를 검사(틀린 doc invalid)`, `401 invite·409 full·409 upgrade·409 version·409 rev`, `fetch 거절 offline`, `removeMember 404 성공`. 2A client: `409 reason version → version`.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/trip-collab-store.test.ts tests/unit/services/trip-collab-client.test.ts tests/unit/services/trip-live-client.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 기기 기록·기준 저장·API 클라이언트`

### Task 10: 맞추기 엔진과 소유자 합류

**Files:**
- Create: `src/sections/trips/collab/texts.ts`, `src/sections/trips/collab/collab-engine.ts`, `src/sections/trips/collab/owner-join.ts`, `src/sections/trips/collab/use-trip-collab.ts`
- Test: `tests/unit/sections/trips/collab-engine.test.ts`, `tests/unit/sections/trips/collab-owner-join.test.ts`

**Interfaces:**
- Consumes: Task 2~6·9, 2A `createLivePoll`(`src/share-viewer/live.ts`)·`LIVE_DEBOUNCE_MS`·`LIVE_MIN_GAP_MS`·`LIVE_OFF_RETRY_MS`·`LIVE_LIMIT_RETRY_MS`·`fitLiveDoc`·`liveEditKey`·`buildLiveTripDoc`·`ESTIMATE_ONLY`·`alignDayIds`·`newDayId`·`newLiveId`·`tripLiveStore`·`tripLiveApi`, `useTripLegs`(`src/sections/share-export/use-trip-legs.ts`), `legBetween`, `useLibraryAction`·`libraryAtom`(`src/stores/library-state.ts`)
- Produces:
  - `texts.ts`: 설계 문서의 문구를 상수로(그대로 복사). 최소: `COLLAB_SYNCED(hhmm)`, `COLLAB_CHANGED(label, hhmm)`, `COLLAB_SYNCING = '맞추는 중이에요'`, `COLLAB_CONFLICT(n)`, `COLLAB_COMPARE = '비교하기'`, `COLLAB_OFFLINE`, `COLLAB_OFF`, `COLLAB_LIMITED`, `COLLAB_TOO_BIG`, `COLLAB_REVOKED`, `COLLAB_ENDED`, `COLLAB_VERSION`, `COLLAB_FAILED`, `COLLAB_OK = '알겠어요'`, `COLLAB_RELOAD = '새로 고침'`, `COLLAB_OPEN = '함께 편집'`, 그 밖 Task 12~15의 문구.
  - `collab-engine.ts`
    - `export type CollabSyncState = 'idle' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'offline' | 'off' | 'limited' | 'too-big' | 'busy' | 'revoked' | 'ended' | 'version' | 'failed'`
    - `export type CollabSnapshot = { state: CollabSyncState; record: TripCollabRecord | undefined; merge: CollabMerge | null; syncedAt: string | null; changedBy: string | null; changedAt: string | null; members: number; progress: SharedProgress | null }`
    - `export type CollabEngineDeps = { tripId: string; api: typeof tripCollabApi; store: ReturnType<typeof createTripCollabStore>; liveStore: typeof tripLiveStore; getLibrary(): Library; run(op: (lib: Library, ctx: OpCtx) => Library | OpResult): Promise<LibraryActionResult>; routeOf(): CollabRouteOf; now(): Date; newPlaceId(): string; locks?: LockManager | null; win?: Window; reportError(error: unknown): void }`
    - `export class CollabEngine { constructor(deps: CollabEngineDeps); subscribe(fn: () => void): () => void; getSnapshot(): CollabSnapshot; retain(): () => void; localChanged(): void; sync(): Promise<void>; resolve(choices: Readonly<Record<string, CollabSide>>): Promise<void>; queueProgress(op: Omit<ProgressOp, 'at'>): void; setNext(stopId: string | null, date: string): void; dismiss(): void }`
      - `retain()`: 참조 수 0→1이면 기록이 `live`일 때만 `createLivePoll({ tick, win })`를 시작하고 바로 한 번 `sync()`. 1→0이면 폴링·타이머를 멈춘다. 반환 함수가 참조를 놓는다.
      - `sync()`: 설계 문서 §맞추기 엔진 「한 번 맞추기」 1~8. 잠금은 `deps.locks?.request(\`tripmap:trip-collab:${tripId}\`, …)`, 없으면 모듈 `Map<tripId, Promise>` 사슬. 첫 `sync`는 `rev`·`prev` 없이 부른다(엔진 메모리에 마지막 공동본 `LiveTripDoc`을 둔다). 토큰은 편집 기기면 `record.token`, 소유자면 `liveStore.get(tripId)?.ownerToken`(없으면 상태 `revoked`).
        - 4: `run(mapServerPlaces)` → 기록 `placeMap` 갱신. 이 기기 여행이 없거나 지워졌으면 상태 `idle`로 멈춘다(기록은 그대로). `dayIds = alignDayIds(record.dayIds, trip.days.length, newDayId)`. `assignServerPlaceIds(trip, placeMap, 공동본 장소 id 집합, deps.newPlaceId)` → 기록 갱신. `projectLocalTrip`. `stopIdClashes`가 있으면 `run(renameStopIds)` 뒤 4를 다시(한 번).
        - 5: `mergeCollabPlan(기준?.plan ?? null, mine, theirs)`. `resolve`에서 온 `choices`가 있으면 `resolveCollabMerge`로 푼다(`missing`이면 상태 `conflict` 유지, `invalid`면 새 `merge`로 `conflict`).
        - 6: `run((lib, ctx) => { 재투영이 mine과 다르면 { ok: true, lib }(바꾸지 않음)과 표시 남김; 아니면 applyCollabPlan(...) })` → 표시가 남았으면 1부터(최대 3번).
        - 7: `buildCollabDoc({ plan, previous: 공동본, lib: getLibrary(), placeMap, role, options: 공동본.options, createdAt: 공동본.share.createdAt, routeOf: deps.routeOf() })` → `fitLiveDoc` → null이면 `too-big` → `api.putDoc`. 마지막 올리기에서 10초가 안 지났으면 남은 시간 뒤로 미룬다.
        - 성공·같음: `store.writeBase(liveId, { rev, plan, progress })`, `store.update(tripId, { rev, dayIds: plan.days.map(d => d.id), syncedAt: now, title: plan.title })`. 공동본 변경을 이 기기에 반영했으면 `changedBy = state.editedBy`, `changedAt = now`.
        - 결과별 상태는 설계 문서 §결과별 상태 표. `unauthorized` → 편집 기기는 기록 `status: 'revoked'`, 소유자는 2A 기록 `status: 'disconnected'`와 기록 `revoked`. `ended`·`not-found` → `ended`. `switched-off` → `off`, 300,000ms 뒤 다시. `rate-limited` → `limited`, 3,600,000ms 뒤. `offline`·`unavailable` → `offline`. `version` → `version`. `conflict`(409 rev) → 1부터(3번 넘으면 `busy`, 30,000ms 뒤).
      - `localChanged()`: 지금 투영의 `planKey`가 기준과 다르면 상태 `pending`, `LIVE_DEBOUNCE_MS` 뒤 `sync()`(그사이 다시 부르면 타이머를 다시 건다). 같으면 아무것도 안 한다. 기준이 없으면 바로 `sync()` 예약.
      - `tick`(폴링): 보내지 못한 진행이 있으면 `api.progress`로 먼저 보낸다(성공하면 기록 `pendingProgress: []`, 진행 갱신). 그다음 `sync()`. `revoked`·`ended`·`version`이면 `'stop'`, 오류 상태면 `'error'`, 아니면 `'ok'`.
      - `queueProgress(op)`: `at = now ISO`, 기록 `pendingProgress = queueOp(…)`, 스냅샷 `progress = withLocalOps(…)`, 바로 한 번 보내기 시도(실패하면 대기열에 남김).
      - `setNext(stopId, date)`: `api.progress(id, token, { ops: [], next: { stopId, date, at } })`. 실패하면 알림만(대기열에 넣지 않는다).
      - `dismiss()`: `revoked`·`ended`일 때 `store.remove(tripId)` 후 상태 `idle`.
    - `export function collabEngineFor(tripId: string, makeDeps: () => CollabEngineDeps): CollabEngine` — 모듈 `Map` 등록부(여행마다 하나). 시험용 `export function resetCollabEngines(): void`.
  - `owner-join.ts`
    - `export async function enableCollabAsOwner(deps: CollabEngineDeps): Promise<{ ok: true } | { ok: false; error: TripCollabError | 'conflict' | 'empty' }>` — 설계 문서 §「공동 편집 켜기」. 2A `tripLiveApi.get(liveId, null, ownerToken)` → `doc.v === 2`면 `joinCollabAsOwner(deps, state, clean)`으로 넘긴다(`clean`은 아래 규칙). v1이면: 대응표 = 이 여행이 참조하는 모든 로컬 장소의 항등, `dayIds = alignDayIds(liveRecord.dayIds, trip.days.length, newDayId)`, `plan = projectLocalTrip(…)`, `doc = fitLiveDoc(buildCollabDoc({ previous: null, role: 'owner', options: { includeMemo: liveRecord.options.includeMemo, includeCandidates: true }, createdAt: liveRecord.createdAt, … }))`(null이면 `too-big`, 장소가 없으면 `empty`) → `tripLiveApi.update(liveId, doc, state.rev, ownerToken)` → `conflict`면 `{ ok: false, error: 'conflict' }` → 성공하면 `store.put({ tripId, liveId, role: 'owner', token: null, deviceId: null, label: OWNER_LABEL, status: 'live', rev: 새 rev, prev: 0, dayIds, placeMap, syncedAt: now, title: plan.title, pendingProgress: [] })`, `store.writeBase(liveId, { rev, plan, progress: null })`.
    - `export async function joinCollabAsOwner(deps: CollabEngineDeps, live: LiveState, clean: boolean): Promise<void>` — 연결 기록(`role: 'owner'`, `rev: live.rev`, `placeMap: {}`, `dayIds: [...live.doc.ids.days]`)을 만든다. `clean`이면 `run(mapServerPlaces)` 뒤 이 기기 투영을 기준(`rev: live.rev`)으로 쓴다(공동본을 그대로 받아들이게). 아니면 기준을 쓰지 않는다(다음 `sync`가 「기준이 없을 때」 규칙).
    - `export async function isCleanOwnerDevice(lib: Library, tripId: string, record: TripLiveRecord): Promise<boolean>` — 2A 지문: `liveEditKey(buildLiveTripDoc(lib, tripId, ESTIMATE_ONLY, { title: record.options.title, options: { includeMemo: record.options.includeMemo, includeCandidates: record.options.includeCandidates }, dayIds: alignDayIds(record.dayIds, trip.days.length, newDayId), createdAt: record.createdAt }))`가 `record.publishedKey`와 같은가(문서가 null이면 `publishedKey === undefined`).
  - `use-trip-collab.ts`
    - `export type CollabView = CollabSnapshot & { engine: CollabEngine | null }`
    - `export function useTripCollab(tripId: string, active: boolean): CollabView` — `useTripCollabRecord(tripId)`가 없으면 엔진을 만들지 않고 `{ state: 'idle', record: undefined, … , engine: null }`. 있으면 `collabEngineFor(tripId, () => deps)`; deps의 `getLibrary`는 `useStore().get(libraryAtom)`, `run`은 `useLibraryAction().run`, `routeOf`는 `useTripLegs(tripId, active)`의 최신 값을 ref로 읽어 `(from, to) => { 로컬 장소 두 개(대응표, 지운 장소 포함) → legBetween(trip, a, b) → { mode: leg.mode, time: legs.routeOf(leg) } }`(로컬 장소가 없으면 `{ mode: 'car', time: ESTIMATE_ONLY 값 }`), `newPlaceId = newLiveId`, `locks = navigator.locks ?? null`, `reportError`는 앱 오류 보고자. `active`면 `engine.retain()`. `libraryAtom`이 바뀔 때마다 `engine.localChanged()`. `useSyncExternalStore(engine.subscribe, engine.getSnapshot)`.
- [ ] **Step 1: 실패하는 시험** — `collab-engine.test.ts`(가짜 타이머, 가짜 `api`(`vi.fn`)·메모리 저장소(`createTripCollabStore(() => 메모리 Storage)`)·실제 보관함 연산을 돌리는 `run`(보관함은 `tests/fixtures/builders.ts`), `locks: null`, `createLivePoll`은 실제(가짜 `win`)): 
  - `기록이 live가 아니면 retain해도 요청하지 않는다`
  - `처음 sync는 rev·prev 없이 state를 부르고 공동본을 기준으로 둔다(이 기기와 같으면 PUT 없음)`
  - `공동본만 바뀌면 이 기기 여행에 반영되고 PUT은 없다, changedBy가 editedBy`
  - `이 기기에서 출발 시각을 바꾸면 localChanged 3초 뒤 PUT 한 번(baseRev = 기준 rev), 성공하면 기록 rev 갱신`
  - `양쪽이 다른 Day를 고치면 반영과 PUT이 함께 일어나고 둘 다 남는다`
  - `같은 Day 순서를 다르게 고치면 conflict이고 PUT·반영이 없다`
  - `resolve({ 'placement.d0': 'theirs' })면 공동 순서로 반영되고 PUT하지 않는다(결과가 공동본과 같음)`, `mine이면 PUT`
  - `반영 연산 안에서 투영이 달라졌으면 반영하지 않고 다시 한다`(가짜 `run`이 처음 한 번 보관함을 바꿔 둠)
  - `409 rev면 다시 받아 병합해 올린다, 세 번 넘으면 busy`
  - `401이면 revoked이고 폴링이 멈춘다, 소유자면 2A 기록이 disconnected`
  - `410이면 ended`, `503 off면 off이고 5분 뒤 다시`, `429면 limited`, `version이면 version`
  - `queueProgress는 바로 보내고 실패하면 pendingProgress에 남기고 다음 tick에 보낸다`
  - `기준 저장소가 비면 기준 없이 병합한다(다른 곳은 conflict)`
  - `새 장소를 이 기기에서 넣으면 로컬 id가 서버 id로 올라가고 대응표에 남는다`
  - `collab-owner-join.test.ts`: `v1 공동본이면 v2를 2A update로 올리고 연결 기록·기준을 만든다`, `2A update 409면 conflict이고 기록이 없다`, `v2 공동본이면 joinCollabAsOwner로 넘어간다`, `clean이면 기준이 생기고 다음 sync에서 공동본을 받아들인다`, `clean이 아니면 기준이 없고 다른 곳이 conflict`, `isCleanOwnerDevice`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/trips/collab-engine.test.ts tests/unit/sections/trips/collab-owner-join.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`, `yarn lint`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 맞추기 엔진과 소유자 합류`

### Task 11: 계획 화면 연결·2A 반영 훅 멈춤

**Files:**
- Create: `src/sections/trips/collab/TripCollabSync.tsx`, `src/sections/trips/collab/CollabBar.tsx`
- Modify: `src/sections/trips/planner/TripPlannerPage.tsx`, 2A `src/sections/trips/live/use-trip-live-publish.ts`, 2A `src/sections/trips/live/TripLiveLinkPage.tsx`
- Test: `tests/unit/sections/trips/collab-bar.test.tsx`, 2A `tests/unit/sections/trips/live-publish.test.tsx`·`live-link-page.test.tsx`에 사례

**Interfaces:**
- Consumes: Task 9·10
- Produces:
  - `CollabBar({ view, onOpen, onCompare }: { view: CollabView; onOpen(): void; onCompare(): void })` — `role="status"`·`aria-live="polite"` 한 줄. 상태별 문구(설계 문서 §결과별 상태 표, `HH:mm`은 `toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`), 단추: 늘 `함께 편집`(`onOpen`), `conflict`면 `비교하기`(`onCompare`), `revoked`·`ended`면 `알겠어요`(`view.engine.dismiss()`), `version`이면 `새로 고침`(`location.reload()`). 단추 최소 높이 44px. `idle`이고 기록이 없으면 `null`.
  - `TripCollabSync({ tripId }: { tripId: string })` — `useTripCollab(tripId, true)`와 `CollabBar`를 그린다. `onOpen`·`onCompare`는 이 과제에서는 열림 상태(`useState`)만 바꾼다(창은 Task 12에서 붙인다). 그리고 **소유자 합류 확인**: 연결 기록이 없고 2A 기록이 `live`면 마운트당 한 번 `tripLiveApi.get(liveId, null, ownerToken)` → `doc.v === 2`면 `joinCollabAsOwner(deps, state, await isCleanOwnerDevice(...))`. 2A 기록이 없으면 요청하지 않는다.
  - `TripPlannerPage.tsx`: 계획 화면 본문 맨 위(시간표 칸 머리 위, 넓은 화면은 시간표 칸 안 맨 위)에 `<TripCollabSync tripId={trip.id} />`. 2A의 `<TripLivePublisher tripId={trip.id} />`는 그대로 둔다.
  - 2A `use-trip-live-publish.ts`: `LivePublishState`에 `'collab'`. 훅 시작에서 `useTripCollabRecord(tripId)?.status === 'live'`면 아무 요청 없이 `'collab'`. 올리기 결과가 `version`이면 기록을 바꾸지 않고 상태 `'collab'`, `joinCollabAsOwner(deps, (await tripLiveApi.get(...)).value, false)`를 부른다(같은 훅 인스턴스에서 한 번).
  - 2A `TripLiveShareDialog.tsx`: 반영 상태 `'collab'`이면 상태 문구 `함께 편집으로 맞추고 있어요`. 공동본이 v2이면(열 때 받은 `GET`의 `doc.v`) 제목 입력을 숨기고 `함께 편집 중에는 여행 이름을 따라요`.
  - 2A `TripLiveLinkPage.tsx`: `이 기기에서 관리하기`에서 `state.doc.v === 2`면 `importLiveTrip` 대신 `importCollabTrip`으로 담고, 2A 기록(`publishedKey`는 2A 규칙대로)과 함께 연결 기록(`role: 'owner'`, `rev: state.rev`, `placeMap`·`dayIds`는 `importCollabTrip` 결과)·기준(`planFromDoc(state.doc)`)을 만든다.
- [ ] **Step 1: 실패하는 시험** — `collab-bar.test.tsx`: 상태별 문구·단추(`synced` 시각, `changed`, `conflict` + 비교하기, `revoked` + 알겠어요 → `dismiss`, `version` + 새로 고침), `기록이 없으면 아무것도 그리지 않는다`, `TripCollabSync: 2A 기록만 있고 공동본이 v2면 joinCollabAsOwner를 부른다`, `2A 기록이 없으면 요청 0`. `live-publish.test.tsx`: `연결 기록이 live면 update를 부르지 않고 collab`, `update가 version이면 collab으로 바뀌고 joinCollabAsOwner를 부른다`. `live-link-page.test.tsx`: `v2 공동본을 담으면 연결 기록(role owner)과 기준이 생긴다`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/trips/collab-bar.test.tsx tests/unit/sections/trips/live-publish.test.tsx tests/unit/sections/trips/live-link-page.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/sections/trips`, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 계획 화면 띠와 2A 반영 멈춤`

### Task 12: `함께 편집` 창과 비교 창

**Files:**
- Create: `src/sections/trips/collab/TripCollabDialog.tsx`, `src/sections/trips/collab/CollabDialogHost.tsx`, `src/sections/trips/collab/CollabConflictDialog.tsx`
- Modify: `src/sections/trips/collab/TripCollabSync.tsx`(띠의 `함께 편집`·`비교하기`에 두 Host 연결), `src/routes/lazy-routes.ts`(`loadTripCollabDialog`·`TripCollabDialog`, `loadCollabConflictDialog`·`CollabConflictDialog`, `PANEL_CHUNKS`에는 넣지 않는다), 2A `src/sections/trips/live/TripLiveShareDialog.tsx`(`live` 상태 관리 단추 아래 `함께 편집…` 줄), 2A `src/sections/trips/live/LiveShareEntry.tsx`(편집 기기 여행이면 만들기 숨김), `src/sections/trips/TripsPage.tsx`(카드 메뉴 `일정 공유` 다음 `함께 편집…`), `package.json`(`build:ci`의 `--require-lazy TripShareDialog` 뒤에 `--require-lazy TripCollabDialog --require-lazy CollabConflictDialog`)
- Test: `tests/unit/sections/trips/collab-dialog.test.tsx`, `tests/unit/sections/trips/collab-conflict-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 3·9·10·11, `LazyDialogHost`, `shareLink`(`src/sections/meetings/share-link.ts`), `useKakao`·`kakaoUrlFits`·`sendAppKakao`(`src/sections/share-export/kakao.ts`), `HelpButton`, 2A `newLiveToken`·`importLiveTrip`·`tripLiveStore`, `formatShortExpiry`
- Produces:
  - `CollabDialogHost({ open, onClose, tripId })` — `LazyDialogHost`(heading `함께 편집`)로 지연 `TripCollabDialog`를 연다(한 번 연 뒤 마운트 유지, 2A `LiveShareEntry`와 같은 방식). 2A 창·여행 목록·띠가 이것을 쓴다.
  - `TripCollabDialog({ open, onClose, tripId })` — MUI `Dialog`(제목 `함께 편집`, `HelpButton page="trips"`). `useTripCollab(tripId, open)`.
    - 2A 기록이 없거나 `live`가 아니면: `함께 편집하려면 먼저 갱신 링크를 만들어야 해요` + `갱신 링크 만들기…`(2A `LiveShareEntry`의 창 열기 콜백을 prop `onOpenLiveShare`로 받는다. 없으면 단추를 숨긴다).
    - 소유자(2A 기록 `live`): 안내·`누구에게 보내나요? (선택)`·`편집 초대 링크 만들기`(설계 문서 §소유자 1~3). 누르면: 연결 기록이 없으면 `enableCollabAsOwner`(실패 문구: `conflict` → 2A `LIVE_CONFLICT`, `too-big`·`empty` → 2A 문구, 그 밖은 `편집 초대를 만들지 못했어요. 잠시 뒤 다시 해 주세요`) → 초대 토큰은 이 창 상태에 한 번 만들어 두고(재시도 때 같은 값) `api.createInvite(liveId, ownerToken, { token, label })` → 링크 `collabInviteLink(location.origin, liveId, token)`를 읽기 전용 입력칸과 `링크 복사`(`링크를 복사했어요`)·`링크 공유`·`카카오톡`(`sendAppKakao({ title, url, description: '함께 고치는 여행 일정 · 랜드마크', buttonTitle: '함께 편집하기' })`) 단추로. 오류 문구: `offline` `인터넷 연결을 확인해 주세요`, `switched-off` `지금은 편집 초대를 만들 수 없어요`, `rate-limited` `오늘은 더 만들 수 없어요`, `full` `기다리는 초대가 많아요. 쓰지 않는 초대를 취소해 주세요`. 성공 뒤 새 초대를 만들면 새 토큰.
    - 소유자 목록: 창을 열 때와 초대·거두기·취소 뒤 `api.members` → `함께 고치는 기기`(이름·`오늘`/`어제`/`N일 전` 접속·`편집 권한 거두기` → 확인 창 → `removeMember(id, ownerToken, deviceId)` → `편집 권한을 거뒀어요`), `기다리는 초대`(이름·`M월 D일까지`·`초대 취소` → `cancelInvite`). 빈 목록 문구. 소유자도 `내 여행으로 따로 저장`.
    - 편집 기기: `함께 편집 중이에요`, `이 기기 이름 {label}`, `함께 고치는 기기 {members}대`, `내 여행으로 따로 저장`(`api.state(id, token, { rev: null, prev: null })` → `run((lib, ctx) => importLiveTrip(lib, doc, { preferredTripId: null }, ctx))` → 알림 `공동 여행을 새 여행으로 저장했어요` + `열기`(`paths.trip(createdId)`)), `편집 그만두기`(확인 창 → `removeMember(id, token, 'me')` → 성공·404·410이면 `store.remove(tripId)`·`함께 편집을 그만뒀어요`·창 닫기, `offline`이면 문구만).
  - `CollabConflictDialog({ open, onClose, tripId })` — `useTripCollab(tripId, open)`의 `merge.conflicts`를 줄로 그린다(설계 문서 §비교 창). 장소 이름은 `lib.places[placeMap[서버 id]]?.name.value ?? 공동본 장소 이름 ?? '알 수 없는 장소'`. 줄마다 `RadioGroup`(`이 기기`·`공동 여행`). `모두 이 기기로`·`모두 공동 여행으로`·`고른 대로 맞추기`(모두 골랐을 때만 활성)·`나중에`. `고른 대로 맞추기` → `engine.resolve(choices)` → 상태가 `conflict`가 아니면 닫는다. 겹침 id 집합이 바뀌면 바뀐 줄의 선택을 지우고 `그사이 공동 여행이 또 바뀌었어요. 다시 골라 주세요`.
  - `CollabConflictDialogHost({ open, onClose, tripId })` — `LazyDialogHost`(heading `겹친 변경 비교`).
  - 2A `TripLiveShareDialog`: `live` 관리 단추들 아래 `함께 편집…` 줄(설명 `보기 링크는 누구나 볼 수만 있고, 편집 초대 링크는 받은 한 사람이 함께 고칠 수 있어요`) → `CollabDialogHost`.
  - `TripsPage`: 카드 메뉴 `함께 편집…` → `CollabDialogHost`(그 여행).
  - 2A `LiveShareEntry`: 그 여행의 연결 기록이 `role: 'editor'`면 문구 `함께 편집 중인 여행의 갱신 링크는 만든 사람이 관리해요`만 보이고 `갱신 링크…` 단추를 숨긴다(일정 공유 창의 링크 복사·파일 저장은 그대로).
  - `TripCollabSync`: `CollabDialogHost`(띠의 `함께 편집`)와 `CollabConflictDialogHost`(`비교하기`)를 붙인다.
- [ ] **Step 1: 실패하는 시험** — `collab-dialog.test.tsx`(가짜 `tripCollabApi`·`tripLiveApi`, 가짜 클립보드): `갱신 링크가 없으면 안내와 갱신 링크 만들기 단추`, `소유자 첫 초대: v1이면 enableCollabAsOwner 뒤 createInvite, 링크가 /trips/join/<id>#i=<43자>`, `createInvite offline 뒤 다시 누르면 같은 토큰`, `목록: 기기 이름·접속, 거두기 확인 뒤 removeMember(기기 id)`, `초대 취소`, `편집 기기: 그만두기 확인 뒤 removeMember('me')와 기록 지움`, `따로 저장이 연결 없는 새 여행을 만든다`, `오류 문구(switched-off·full)`, `편집 기기 여행의 일정 공유 창에는 갱신 링크 만들기 단추가 없다`. `collab-conflict-dialog.test.tsx`: `값 겹침 줄에 두 값`, `배치 겹침에 두 열 장소 이름`, `모두 고르기 전에는 맞추기 비활성`, `모두 공동 여행으로 → resolve에 모든 id가 theirs`, `겹침이 바뀌면 다시 고르라는 문구`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/trips/collab-dialog.test.tsx tests/unit/sections/trips/collab-conflict-dialog.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/sections/trips tests/unit/sections/share-export`, `yarn typecheck`, `yarn lint`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 함께 편집 창과 비교 창`

### Task 13: 초대 수락 화면 `/trips/join/:id`

**Files:**
- Create: `src/sections/trips/collab/TripCollabJoinPage.tsx`
- Modify: `src/routes/paths.ts`(`tripJoin: (id: string) => \`/trips/join/${id}\``), `src/routes/lazy-routes.ts`(`loadTripCollabJoinPage`·`TripCollabJoinPage`, `ROUTE_CHUNKS`에 넣지 않음), `src/routes/router.tsx`(`paths.trip(':id')` 줄 앞에 `{ path: paths.tripJoin(':id'), element: lazyElement(<TripCollabJoinPage />, 'trip-join') }`), `package.json`(`--require-lazy TripCollabJoinPage`)
- Test: `tests/unit/sections/trips/collab-join-page.test.tsx`, 기존 `tests/unit/routes/*`에 경로 사례

**Interfaces:**
- Consumes: Task 1·4·9, 2A `newLiveToken`·`LIVE_ID_PATTERN`, `useLibraryAction`, `useNavigate`·`useParams`
- Produces: `TripCollabJoinPage()`
  1. 첫 효과에서 `readInviteHash(location.hash)`를 읽어 상태에 두고, 해시가 있으면 `history.replaceState(history.state, '', location.pathname + location.search)`.
  2. `id`가 `LIVE_ID_PATTERN`이 아니거나 토큰이 없으면 `초대 링크를 읽지 못했어요. 보낸 사람에게 다시 받아 주세요` + `여행 목록`.
  3. `tripCollabStore.byLiveId(id)`가 있고 그 여행이 살아 있으면 `navigate(paths.trip(record.tripId), { replace: true })`.
  4. `previewInvite` → 성공하면 설계 문서 §받은 사람 3의 화면(`periodLabel(startDate, endDate)`로 기간), 실패 문구는 §받은 사람 5(`invite` → 쓴 초대 문구, `ended`·`not-found` → 끝남, `offline`·`unavailable` → 오프라인 + `다시 시도`).
  5. `수락하고 함께 편집하기`: 편집 토큰은 처음 누를 때 `newLiveToken()`으로 만들어 상태에 둔다 → `normalizeDeviceLabel`(null이면 입력칸 오류 `1~30자로 입력하세요`) → `accept(id, inviteToken, { deviceToken, label })` → `state(id, deviceToken, { rev: null, prev: null })` → `run((lib, ctx) => { const r = importCollabTrip(lib, doc, ctx); … })` → `tripCollabStore.put({ tripId, liveId: id, role: 'editor', token: deviceToken, deviceId, label, status: 'live', rev: state.rev, prev: state.progress?.prev ?? 0, dayIds, placeMap, syncedAt: now, title: doc.share.title, pendingProgress: [] })`, `writeBase(id, { rev: state.rev, plan: planFromDoc(doc), progress: state.progress ?? null })` → `toast('함께 편집을 시작했어요')` → `navigate(paths.trip(tripId), { replace: true })`. 실패 문구는 §받은 사람 5(`full`·`switched-off` 포함). 담기 실패는 `toast.error('여행을 담지 못했어요. 다시 해 주세요')`.
- [ ] **Step 1: 실패하는 시험** — `해시를 지운다`, `미리보기 제목·기간과 기본 기기 이름`, `수락하면 accept·state 뒤 새 여행이 생기고 기록 role editor·Stop id가 서버 것, /trips/<id>로 간다`, `accept offline 뒤 다시 누르면 같은 deviceToken`, `invite 오류 문구`, `full 문구`, `이미 같은 공유 기록이 있으면 바로 그 여행으로(accept 없음)`, `기기 이름이 비면 입력 오류`. 라우터: `/trips/join/abcdefghij가 TripCollabJoinPage 지연 덩어리로 열린다`, `/trips/abcdefghij/today는 그대로`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/trips/collab-join-page.test.tsx tests/unit/routes` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 편집 초대 수락 화면`

### Task 14: 공동 당일 진행

**Files:**
- Modify: `src/sections/trips/today/TripTodayPage.tsx`, `src/sections/trips/today/use-today.ts`, `src/sections/trips/today/use-visit-toggle.ts`, `src/sections/trips/today/NextCard.tsx`, `src/sections/trips/today/TodayLists.tsx`
- Test: `tests/unit/sections/trips/today-shared.test.tsx`, 기존 `today-page.test.tsx` 그대로 통과

**Interfaces:**
- Consumes: Task 6·10, `visitedInTrip`(`src/domain/trips/today.ts`)
- Produces:
  - `use-today.ts`: `useToday(trip, viewDay, fix = null, shared: { progress: SharedProgress | null; myDevice: string } | null = null)`. `shared`가 있으면 `visited[i] = sharedMarkOf(shared.progress, stop.id, trip) !== null`, `TodayStop`에 `visitedBy: string | null`(표시의 `by.device !== shared.myDevice`면 `by.label`, 아니면 null). 다음 장소: `isToday`이고 `sharedNextIndex(progress, date, shownIds, visited)`가 있으면 그 자리(`pickNext`의 결과보다 먼저, `wrapped: false`), `TodayModel`에 `nextBy: string | null`(정한 기기 이름, 내 것이면 null), `shared: boolean`. `shared`가 null이면 지금 동작 그대로(`visitedBy: null`, `nextBy: null`, `shared: false`).
  - `use-visit-toggle.ts`: `Options`에 `onWritten?(placeId: string, visitedOn: string | null): void`. `toggle`이 `run` 성공 뒤(바뀐 것이 없어도) `onWritten(id, written)`, 되돌리기가 실제로 이전 값을 썼을 때(`merged` 아님) `onWritten(id, previous)`.
  - `TripTodayPage.tsx`: `const collab = useTripCollab(trip.id, true)`. `collab.record?.status === 'live'`이면 `shared = { progress: collab.progress, myDevice: collab.record.deviceId ?? OWNER_DEVICE }`. `useVisitToggle({ onUndone, onWritten })`의 `onWritten`은 지금 보는 Day의 Stop 가운데 그 장소의 Stop을 찾아 `collab.engine?.queueProgress({ stopId, visited: visitedInTrip(visitedOn, trip), date: model.date })`. 머리 `badge`에 `함께 진행`(화면 켜 둠 표시와 함께 있으면 ` · `로 잇는다).
  - `NextCard.tsx`: prop `onSetNext?: (item: TodayStop) => void`. `selected !== null`이고 `model.shared`이고 그 Stop이 안 다녀왔으면 `다음 장소로 정하기` 단추(44px) → `onSetNext(target)` → 페이지가 `collab.engine.setNext(stop.id, model.date)`와 `toast('모두에게 다음 장소로 보여요')`. 머리 `다음`에 `model.nextBy`가 있으면 ` · ‘{nextBy}’에서 정함`.
  - `TodayLists.tsx`: 다녀온 줄 표시에 `item.visitedBy`가 있으면 `다녀옴 · {visitedBy}`(날짜 표시가 있으면 `다녀옴 · {날짜} · {visitedBy}`).
- [ ] **Step 1: 실패하는 시험** — `today-shared.test.tsx`(`today-fixtures.tsx` 관례, 가짜 엔진 스냅샷을 `vi.mock('src/sections/trips/collab/use-trip-collab')`로): `다른 기기 표시가 있으면 다녀온 곳에 '다녀옴 · 민지 폰'이고 다음 장소가 그다음`, `내 visitedOn은 그대로(바뀌지 않음)`, `체크하면 visitedOn이 쓰이고 queueProgress가 visited true로 불린다`, `되돌리기도 queueProgress visited false`, `정한 다음 장소가 우선하고 '‘민지 폰’에서 정함'`, `고른 장소에서 다음 장소로 정하기 → setNext`, `연결 기록이 없으면 지금 동작 그대로(queueProgress 없음)`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/trips/today-shared.test.tsx tests/unit/sections/trips/today-page.test.tsx` → 새 사례 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/sections/trips`, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 공동 당일 진행`

### Task 15: 여행 목록 표시·지우기·설정 목록

**Files:**
- Create: `src/sections/settings/CollabTripsSection.tsx`
- Modify: `src/sections/trips/TripsPage.tsx`, `src/sections/settings/SettingsPage.tsx`(2A `<LiveTripsSection />` 다음 줄에 `<CollabTripsSection />`)
- Test: `tests/unit/sections/settings/collab-trips-section.test.tsx`, 기존 `tests/unit/sections/trips/trips-page.test.tsx`에 사례

**Interfaces:**
- Consumes: Task 9
- Produces:
  - `TripsPage`: `useTripCollabRecords()`로 `status === 'live'`인 여행 id 집합. 그 카드 `counts` 끝에 ` · 함께 편집 중`(화면·`aria-label` 모두, 2A ` · 갱신 공유 중`보다 뒤). 지우기 확인 창: 그 여행 기록이 `editor`·`live`면 `함께 편집 중인 여행이에요. 이 기기에서만 지워지고 공동 여행은 남아요. 이 기기의 함께 편집도 그만둬요` 문단, 지운 뒤 `tripCollabApi.removeMember(liveId, token, 'me')`(결과와 상관없이 `tripCollabStore.remove(tripId)`). 소유자 기록이면 2A 문구만 두고 기록은 그대로.
  - `CollabTripsSection()`: 기록이 없으면 `null`. `<section aria-label="함께 편집">`, 제목 `함께 편집`, 설명 `이 기기에서 함께 고치는 여행이에요. 공동 여행은 서버에 암호화하지 않고 저장해요`. 항목: 제목(`title`), 역할·상태(`owner` → `만든 사람`, `editor` → `{label}로 참여`, `revoked` → `편집 권한이 거둬짐`, `ended` → `끝남`), 단추 `목록에서 지우기`(`revoked`·`ended`, 요청 없이 기록만) 또는 `그만두기`(`editor`·`live`, Task 12와 같은 확인 창·요청).
- [ ] **Step 1: 실패하는 시험** — 설정: `기록이 없으면 섹션이 없다`, `editor live 그만두기는 removeMember('me') 뒤 빠진다`, `revoked는 요청 없이 빠진다`. 여행 목록: `연결된 여행 카드에 함께 편집 중`, `편집 기기 여행 지우기 확인 창 문구와 지운 뒤 removeMember('me')·기록 삭제`, `소유자 여행은 기록이 남는다`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/settings/collab-trips-section.test.tsx tests/unit/sections/trips/trips-page.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 통과, `yarn vitest run tests/unit/sections/settings`, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trip-collab): 여행 목록 표시와 설정 목록`

### Task 16: E2E — 두 기기로 함께 고치기·비교·거두기·공동 체크

**Files:**
- Modify: 2A `tests/e2e/trip-live-server.ts`(`/api/trip-collab*` 경로 더하기), `playwright.config.ts`(desktop `testMatch`에 `'trip-collab.spec.ts'` 한 줄만)
- Create: `tests/e2e/trip-collab.spec.ts`

**Interfaces:**
- Consumes: Task 8 처리 코드, 2A `createTripLiveServer`, `tests/e2e/fixtures.ts`(`test`·`createGangneungTrip`·`mockRoutes` 등), 2A `trip-live.spec.ts`의 준비 순서
- Produces:
  - `trip-live-server.ts`: `install`이 `url.pathname.startsWith('/api/trip-collab/')`도 가로채 표대로 넘긴다: `POST …/invites` → `handleCollabInviteCreate`, `DELETE …/invites/:key` → `handleCollabInviteCancel`(`params.key`), `GET …/invite` → `handleCollabInvitePreview`, `POST …/accept` → `handleCollabAccept`, `GET …/state` → `handleCollabState`, `PUT …/doc` → `handleCollabPutDoc`, `POST …/progress` → `handleCollabProgress`, `GET …/members` → `handleCollabMembers`, `DELETE …/members/:device` → `handleCollabRemoveMember`(`params.device`). `params.id`는 경로의 둘째 조각. 같은 DB를 쓴다. 처리 코드는 2A와 같이 tsx `require`로 읽는다.
- [ ] **Step 1: 시험 작성** — `trip-collab.spec.ts`(`@desktop`). 두 문맥: 소유자 `page`(2A spec처럼 클립보드 권한), 편집 기기 `browser.newContext()` + `server.install(context)` + 클립보드 권한. 두 문맥 모두 `clock.install()`.
  1. `@smoke 편집 초대로 두 기기가 함께 고친다`: 소유자 `mockRoutes` → `createGangneungTrip` → Day 1에 장소 셋 → `일정 공유` › `갱신 링크…` › `갱신 링크 만들기` → `함께 편집…` › `편집 초대 링크 만들기` › `링크 복사` → 클립보드 링크(정규식 `/\/trips\/join\/[a-z0-9]{10}#i=[A-Za-z0-9_-]{43}$/`). 편집 문맥에서 열기 → 주소에 `#i=` 없음 → 기기 이름 `민지 폰` → `수락하고 함께 편집하기` → 계획 화면 제목 같음·띠 `함께 편집 중`. 편집 문맥에서 Day 1 출발 시각 `10:00`(2A spec과 같은 조작) → `clock.runFor(3_000)` → 소유자 `clock.runFor(10_000)` → 소유자 Day 1 첫 행 시각이 `10:00`대, 띠 `‘민지 폰’에서 일정을 바꿨어요`. 소유자가 Day 1 셋째 장소를 맨 위로 옮김 → 3초·10초 → 편집 문맥 순서가 같다.
  2. `같은 Day 순서를 동시에 바꾸면 비교 창에서 고른다`: 1의 준비 → 편집 문맥 `context.setOffline(true)` → 편집 문맥에서 Day 1 순서 바꿈 → 소유자가 Day 1 순서를 다르게 바꿈 → 3초·10초 → 편집 문맥 `setOffline(false)` → `runFor(10_000)` → 띠 `다른 기기와 같은 곳을 고쳤어요 · 1곳` → `비교하기` → `모두 공동 여행으로` → `고른 대로 맞추기` → 편집 문맥 Day 1 순서가 소유자 순서와 같다 → 소유자 `runFor(10_000)` 뒤에도 소유자 순서 그대로.
  3. `기기를 거두면 그 기기는 더 맞추지 않는다`: 1의 준비 → 소유자 `함께 편집` 창(띠의 단추) › `민지 폰` `편집 권한 거두기` › `거두기` → 편집 문맥 `runFor(10_000)` → 띠 `이 기기의 편집 권한이 거둬졌어요` → 여행 목록에 그 여행이 남아 있다. 같은 초대 링크를 세 번째 문맥에서 열면 `이미 쓴 초대이거나 닫힌 초대예요`.
  4. `당일 화면에서 체크가 다른 기기에 보인다`: 시계를 여행 첫날 10:00으로 둔 두 문맥(2A·당일 모드 spec의 `clock.install({ time })` 방식) → 1과 같이 수락 → 두 문맥 `오늘 일정` → 소유자가 첫 장소 다녀옴 체크 → 편집 문맥 `runFor(10_000)` → `다녀옴 · 만든 사람`, 다음 장소 카드가 둘째 장소.
- [ ] **Step 2:** `E2E_PORT=4181 yarn test:e2e --project=desktop tests/e2e/trip-collab.spec.ts` → 통과. Codex 환경에서 포트를 열 수 없으면 실행하지 말고 보고에 남긴다.
- [ ] **Step 3:** 2A `trip-live.spec.ts`도 그대로 통과하는지(`E2E_PORT=4181 yarn test:e2e --project=desktop tests/e2e/trip-live.spec.ts`).
- [ ] **Step 4:** 커밋 `test(e2e): 여행 함께 편집 두 기기 흐름`

### Task 17: 문서·도움말·로컬 두 기기 확인·전체 검증

**Files:**
- Modify: `docs/development.md`, `README.md`, `scripts/motion/help-pages.mjs` → `yarn build:motion` 산출물(`docs/help/*.md`, `src/sections/help/help-content.ts`)
- Test: 전체

- [ ] **Step 1: 문서**
  - `docs/development.md`
    - `### 환경변수` 표 끝에 행 `| \`TRIP_COLLAB\` | \`off\`면 함께 편집의 초대 만들기·수락·공동본 올리기·진행 올리기만 중단(\`503\`). 읽기·기기 거두기·초대 취소·그만두기는 계속 동작 |`.
    - 2A가 더한 `### 여행 갱신 공유(\`/view#t=\`)` 절 다음에 새 절 `### 여행 함께 편집(\`/trips/join/<id>\`)`: 설계 문서 링크, API 표(설계 문서 §API 아홉 줄), 한도·기기 키(`tripmap:trip-collab:v1`, `tripmap:trip-collab-base:v1:<id>`)·코드 위치 요약, **로컬에서 키 없이 두 기기로 해 보기**(설계 문서 §로컬에서 실제 키 없이 해 보기의 두 프로필 순서·sqlite 확인·스위치·한계를 그대로), **사용자가 할 일**(설계 문서 §사용자가 할 일 1~4의 명령), **되돌릴 때**(설계 문서 §호환·롤백의 `json_set` 명령과 정리 명령).
    - `### 화면 경로` 표 끝에 행 `| \`/trips/join/:id#i=<토큰>\` | 함께 편집 초대 수락(1회용) |`.
    - `## 공개 범위 주의`의 2A 문단 다음에 새 문단: 함께 편집이 서버에 더 남기는 것(기기 이름·마지막 접속·다녀옴 체크와 누른 기기 이름·정한 다음 장소)과 기한·거두기 방법.
  - `README.md`: 2A가 더한 갱신 링크 줄 다음에 `- 여행을 \`함께 편집\`으로 초대하면 공동 일정과 기기 이름·당일 다녀옴 체크를 서버에 **암호화하지 않고** 둡니다(갱신 링크 기한과 같음). 초대 링크는 한 번만 쓸 수 있고, 소유자는 기기마다 편집 권한을 거둘 수 있습니다.`
  - `scripts/motion/help-pages.mjs`: `trips` 팁 끝에 `'갱신 링크 창의 \`함께 편집…\`으로 편집 초대 링크를 만들면, 받은 사람 기기에서도 이 여행을 함께 고칠 수 있어요. 같은 곳을 함께 고치면 어느 쪽을 남길지 물어봐요.'`, `'함께 편집 중인 여행은 \`오늘 일정\`의 다녀옴 체크와 다음 장소가 함께 가는 기기에 모두 보여요.'`. `share` 팁 끝에 `'보기 링크는 누구나 볼 수만 있고, 편집 초대 링크는 받은 한 사람(기기 하나)만 함께 고칠 수 있어요.'`
  - `yarn build:motion`
- [ ] **Step 2: 로컬 실제 함수 확인(Claude가 직접, Codex는 건너뜀)** — `yarn build:viewer` 뒤 `npx wrangler pages dev --d1 DB --port 8790 --proxy 4180 -- npx vite --port 4180 --strictPort`를 백그라운드로 띄운다. 헤더 `-H 'Origin: http://localhost:8788'`로 `curl`: 2A 만들기(`POST /api/trip-live`) → 2A `PUT`으로 v2 올리기 → `POST /api/trip-collab/<id>/invites` 201 → `GET …/invite` 200 → `POST …/accept` 201 → 같은 초대 두 번째 `accept` 401 → `GET …/state`(편집 토큰) 200 → 같은 `rev`·`prev`로 304 → `PUT …/doc` 200 → `POST …/progress` 200 → `DELETE …/members/<기기 id>`(소유자) 204 → 편집 토큰 `state` 401. 문서 JSON은 `tests/unit/server/trip-collab-handlers.test.ts`의 시험 문서를 `node`로 출력해 만든다. 확인 뒤 그 PID만 끈다.
- [ ] **Step 3: 로컬 두 기기 화면 확인(Claude가 직접, 포트 8788이 비어 있을 때만)** — `lsof -nP -iTCP:8788 -sTCP:LISTEN`이 비어 있으면 `npx wrangler pages dev --d1 DB --port 8788 --proxy 4180 -- npx vite --port 4180 --strictPort`로 띄운다(허용 출처 `localhost:8788`). 스크래치 폴더에 일회용 Playwright 스크립트(저장소에 넣지 않는다)를 써서 `chromium.launchPersistentContext`로 **사용자 데이터 폴더 두 개(두 프로필)**를 열고 설계 문서 §로컬에서 실제 키 없이 해 보기의 순서(초대 → 수락 → 서로 다른 곳 고치기 → 오프라인 겹침 → 비교 → 거두기 → 당일 체크)를 눌러 단계마다 스크린샷을 남긴다. 8788이 쓰이고 있으면(사용자 `yarn dev:full`) 이 단계는 건너뛰고 보고에 적는다. 끝나면 띄운 PID만 끈다.
- [ ] **Step 4:** `yarn build:ci` → 시험·크기 검사(`--require-lazy TripCollabDialog`·`CollabConflictDialog`·`TripCollabJoinPage` 포함) 통과. 첫 로딩 JS gzip 값을 보고에 적는다.
- [ ] **Step 5:** `yarn lint`, `yarn fm:check`(또는 바꾼 파일만 `npx prettier --check <파일들>`), `yarn validate`, `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음, `yarn test:e2e:ci`(`E2E_PORT=4181`, Codex는 건너뜀).
- [ ] **Step 6:** 커밋 `docs(trip-collab): 개발 문서·도움말·로컬 두 기기 실행 방법`

## 실행 뒤 Claude가 할 일(계획 밖, 순서)

1. E2E 직접 실행: `E2E_PORT=4181 yarn test:e2e --project=desktop tests/e2e/trip-collab.spec.ts tests/e2e/trip-live.spec.ts`, 이어서 `E2E_PORT=4181 yarn test:e2e:ci`. 포트 5173·5174는 건드리지 않는다.
2. Task 17 Step 2·3의 로컬 함수·두 프로필 확인.
3. PR 열기(기반은 2A가 먼저 병합되었으면 `main`, 아니면 `feat/trip-live-share`) → `codex review` 반복 → 지적 없음. PR 본문에 롤백·데이터 영향 메모(설계 문서 §호환·롤백, 특히 2A로 되돌릴 때의 `json_set` 명령)를 적는다. `docs/rollback.md`는 병합 뒤 별도 PR.
4. 사용자 할 일(설계 문서 §사용자가 할 일) 안내. 새 시크릿·키가 없으므로 병합 전에 막는 설정은 없다. 병합 뒤 미리보기에서 CPU 시간·휴대폰 두 대 확인.
