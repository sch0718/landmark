# AI 에이전트 일정 보내기(`yarn trip`) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 에이전트가 `plan.json` 하나로 앱과 같은 일정 공유 문서를 만들어 데이터 링크(`/view#d=`·`/import#d=`)를 내고, AI 연결 토큰으로 내 받은함에 보내거나 짧은 링크(`/s/<id>#k=`)를 만들고 지우며, 앱은 받은함 일정을 기존 가져오기 화면으로 들인다.

**Architecture:** CLI(`pipeline/cli/trip.ts` + `pipeline/agent-trip/*`)는 `tsx`로 돌며 앱 코드(공유 문서·여행 연산·네이버 조회·암호화)를 `src/*` 별칭으로 그대로 가져온다. 서버는 3단계 동기화 사용자 위에 D1 스키마 7(`agent_tokens`·`agent_inbox`)과 토큰 경로 `/api/agent/v1/*`(`src/server/agent/router.ts`)를 더하고, 발급·목록·철회와 앱의 받은함 읽기는 기존 `SYNC_ROUTES`에 붙인다. 앱은 동기화 엔진의 `onRunFinished`에 받은함 실행기를 붙이고, 받은 값을 기존 `/import#d=`와 같은 `readShareHash` → `SharePreview` 흐름으로 연다.

**Tech Stack:** TypeScript, `tsx` 4, Effect 4.0.2(Schema), React 19, MUI 7, Jotai, Vitest, Playwright, Cloudflare Pages Functions + D1, `@sch0718/firebase-session@0.2.1`, Node 24(`node:sqlite`·`node:child_process`·`node:fs`), 브라우저·Node 내장 `CompressionStream`·`crypto.subtle`.

**설계 문서:** `docs/superpowers/specs/2026-11-01-agent-trip-design.md` — 이 계획과 다르면 설계 문서가 맞다. 모든 과제 전에 한 번 읽는다. 함께 읽을 것: 3단계 `docs/superpowers/specs/2026-10-29-library-sync-design.md`(「4단계가 쓰는 인터페이스」), 4단계 `docs/superpowers/specs/2026-10-29-auto-backup-design.md`(받은함 실행기가 같은 길을 쓴다), 짧은 링크 `docs/superpowers/specs/2026-10-28-share-short-link-design.md`.

## PR 나누기

| PR | 브랜치(예) | 과제 | 출시 단위로 되는 것 |
|---|---|---|---|
| ① CLI + 데이터 링크 | `feat/agent-trip-cli` | Task 1~6 | `yarn trip build`·`--schema`. 서버 동작 변경 없음 |
| ② 서버 토큰·받은함·짧은 링크 API | `feat/agent-trip-server` | Task 7~13 | 스키마 7, `/api/agent/v1/*`, 동기화 경로 `/v1/agent/*`, CLI `send`·`share`·`whoami`·`unshare`. 발급 화면이 없어 사용자는 아직 토큰을 못 만든다(시험은 메모리 서버) |
| ③ 앱 AI 연결·받은함 | `feat/agent-trip-app` | Task 14~19 | 설정 › 동기화 › AI 연결, 받은함 알림·창·가져오기 |
| ④ 문서 | `docs/agent-trip` | Task 20 | `docs/development.md`·README·도움말. 워크스페이스 스킬 연결은 저장소 밖(감독자 몫, 「병합 뒤」) |

- 각 PR은 앞 PR이 `main`에 병합된 뒤 `main`에서 새 브랜치로 시작한다. ①의 첫 커밋에 이 계획서와 설계서가 들어간다(지금 `feat/agent-trip`의 문서 커밋을 ① 브랜치로 가져온다: `git cherry-pick` 또는 ① 브랜치를 `feat/agent-trip`에서 시작).
- 각 PR 병합 뒤 감독자가 태그를 붙이고 `docs/rollback.md`를 별도 docs PR로 고친다(「병합 뒤」 절). Codex는 `docs/rollback.md`를 고치지 않는다.

## Global Constraints

- 셸: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`, Yarn 1.22.22. `GITHUB_PACKAGES_TOKEN`은 환경 변수로 있다(값 출력 금지). 설치 없이 명령만 돌릴 때 비어 있으면 `export GITHUB_PACKAGES_TOKEN=`.
- **포트 5173·5174를 쓰거나 끄지 않는다(사용자 개발 서버). `pkill` 금지.** E2E는 `E2E_PORT=4196 E2E_MAP_PORT=4197`, 로컬 실행은 `SYNC_VITE_PORT=4198 SYNC_DEV_PORT=8798 yarn dev:sync`. 띄운 프로세스는 PID로만 끈다.
- 원격 D1 쓰기·`wrangler secret put`·`wrangler pages deploy`·외부 계정·키 생성 금지. `wrangler.toml`을 만들지 않는다.
- **토큰·삭제 토큰·세션 값을 출력·로그·파일·커밋·시험 스냅샷에 쓰지 않는다.** 시험은 무작위로 만든 값만 쓰고, 출력에 그 값이 없는지 단언한다.
- **새 의존성 없음.** JSON Schema는 `Schema.toJsonSchemaDocument`(effect 4.0.2), 키체인은 `node:child_process`의 `execFile('security', …)`.
- 형식을 바꾸지 않는다: 보관함(`tripmap:library:v2`), 백업 파일, 공유 문서(`ShareDocV1`·`ShareDocV2`, `src/schema/share.ts`), `/api/search` 응답(`{ results: SearchResult[] }`).
- D1: `src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에만** 더하고 `SCHEMA_VERSION = 7`. 모든 문장은 `CREATE … IF NOT EXISTS`. `ALTER TABLE` 금지.
- `functions/**`와 `src/server/**` 파일은 서로 **상대 경로**로 가져온다(`src/` 별칭 금지). 이 파일들이 가져오는 `src/domain/**`·`src/schema/**`가 안에서 `src/` 별칭을 쓰는 것은 기존과 같이 괜찮다(`src/server/library-sync/library.ts` → `src/domain/library-sync/items.ts` 선례). 서버 코드에서 React·MUI 금지. `.sql` 파일 import 금지(`tests/unit/server/module-imports.test.ts`).
- CLI(`pipeline/**`)는 `src/` 별칭을 쓴다(`pipeline/build-places.ts` 선례). `import.meta.env`를 쓰는 모듈(`src/services/library-sync/*` 등)은 CLI에서 가져오지 않는다.
- 동기화 엔진은 **어디서나 `loadSyncEngine()`(동적 import)으로만**, 이 기능의 지연 조각(`inbox-check`·`AgentSection`·`AgentInboxDialog`)도 각자의 `lazyChunk` 함수로만 가져온다. 정적으로 섞이면 `INEFFECTIVE_DYNAMIC_IMPORT`로 빌드가 실패한다. 첫 로딩 상한 `perf-budget.json`의 `initialJsGzipMax` 327,680을 지킨다(`perf-budget.json`은 고치지 않는다).
- 새 `VITE_` 변수 없음(`vitest.config.ts`의 `test.env`는 그대로). CLI는 `LANDMARK_APP_URL`·`LANDMARK_AGENT_TOKEN`·`LANDMARK_TRIP_HOME`만 읽는다.
- 사용자 문자열은 React 텍스트로만. 주석·UI·CLI 문구는 한국어. `grep -rnP '[\x{2028}\x{2029}]' src functions tests pipeline` 출력 없음.
- 고치지 않는다: `docs/rollback.md`, `perf-budget.json`, `.claude/`, `tests/e2e/global-setup*`, `src/sections/shell/AppShell.tsx`, 워크스페이스 스킬(`/Users/shinchoonho/01.workspace/.claude/skills/**`), 다른 기능의 기존 시험 단언(단, 스키마 7 때문에 바뀌는 단언 — 버전 6 → 7과 `tests/unit/server/meet-db.test.ts`의 전체 표 목록에 `agent_inbox`·`agent_tokens`를 이름순 자리에 더하는 것 — 은 고친다).
- Codex 샌드박스에서 네트워크·포트가 막히면 그 명령을 건너뛰고 보고에 적는다. 네이버에 실제로 묻는 시험은 만들지 않는다(가짜 `fetch`).
- 과제마다 커밋. 메시지는 한국어 conventional(`feat(agent-trip): …`, `feat(agent-server): …`, `feat(agent-app): …`), 끝 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 각 PR 마지막 과제의 전체 검증: `yarn typecheck`, `yarn lint`, `yarn test`, `npx prettier --check <바꾼 파일들>`, `yarn build:ci`, `E2E_PORT=4196 E2E_MAP_PORT=4197 yarn test:e2e:ci`.

## Review Focus

- **앱과 같은 문서**: CLI가 `buildTripShareDoc`·`checkShareTrip`·`ShareDocV2Schema`·`readShareHash`를 그대로 쓰는지, 구간 상태 판정이 `src/sections/share-export/use-trip-legs.ts`와 같은지, 가져오기 모의 실행(`importSharedTrip`)으로 `merged-places`·`item-too-large`를 잡는지.
- **토큰 안전**: 원문은 발급 응답에만, D1은 `hashToken`만, 출력·로그·파일에 토큰·삭제 토큰이 없는지. 요청마다 허용 계정 재확인(`parseAccountList`·`parseAllowList`), 범위, 만료·철회, `Origin` 거절, CLI의 허용 출처.
- **받은함 원자성**: 같은 `key` → 만료 행 지움 → 조건부 INSERT(20개), 0행이면 같은 `key` 재조회. 토큰 10개도 같은 조건부 INSERT.
- **오류 형식**: `readLimitedJson`의 `ApiError`가 `413 too-large`·`400 bad-json`으로 바뀌는지(그대로 두면 `500 internal`).
- **앱 흐름**: 여행째 가져왔을 때만 받은함 항목 지움, 계정이 바뀌면 버림, 401·403에서 확인을 멈추고 재로그인 뒤 재개, 지연 조각.

## 파일 구조

| 파일 | PR | 책임 |
|---|---|---|
| `src/services/id-gen.ts` | ① | `randomId` 내보내기 |
| `src/server/search.ts` | ① | `searchNaverPlaces`(sid 포함) + `resolveSearch`는 그 결과를 줄여 지금 모양 |
| `src/server/resolve.ts` | ① | `httpDeps` 내보내기 |
| `src/domain/share/agent-limits.ts`(새) | ① | `AGENT_INBOX_LIMITS`·`AGENT_PLACE_LIMITS`(CLI·서버 공용, import 없음) |
| `src/domain/share/read-share.ts` | ① | `readShareHash(value, limits?)` |
| `pipeline/agent-trip/plan-schema.ts`(새) | ① | `TripPlanSchema`, `parsePlan`, `planJsonSchema` |
| `pipeline/agent-trip/errors.ts`(새) | ① | `TripError`, `TripFailure`, 끝 코드 |
| `pipeline/agent-trip/resolve-places.ts`(새) | ① | 장소 조회·범위·출처 중복 |
| `pipeline/agent-trip/build-library.ts`(새) | ① | 계획 → 메모리 보관함 |
| `pipeline/agent-trip/route-legs.ts`(새) | ① | 구간 시간 `routeOf` |
| `pipeline/agent-trip/build-doc.ts`(새) | ① | 문서·검사·모의 가져오기·링크 |
| `pipeline/agent-trip/summary.ts`(새) | ① | Day 요약 |
| `pipeline/agent-trip/output.ts`(새) | ① | 사람용·`--json` 출력 |
| `pipeline/agent-trip/run-build.ts`(새) | ① | 1~7단계를 묶는 `runBuild` |
| `pipeline/cli/trip.ts`(새) | ①② | 명령 해석·실행 |
| `tests/fixtures/agent-trip/plan.json`(새) | ① | 시험 고정 계획 |
| `src/server/meet/schema-sql.ts` | ② | 표 2개·`SCHEMA_VERSION = 7` |
| `src/server/library-sync/env.ts`·`library.ts`·`router.ts`·`backup.ts` | ② | `AGENT_API`·`SHARE_SHORT`, `ACCOUNT_DATA_TABLES`, `...AGENT_SYNC_ROUTES`, `requireBackupUser` 내보내기 |
| `src/server/share/handlers.ts` | ② | `insertShareLink`·`deleteShareLink` 꺼내기 |
| `src/server/agent/tokens.ts`(새) | ② | 토큰 모양·발급·목록·철회 |
| `src/server/agent/auth.ts`(새) | ② | `requireAgentToken` |
| `src/server/agent/inbox.ts`(새) | ② | 받은함 넣기·목록·항목·지우기·정리 |
| `src/server/agent/router.ts`(새) | ② | `handleAgent`, 토큰 경로 |
| `src/server/agent/sync-routes.ts`(새) | ② | `AGENT_SYNC_ROUTES` |
| `functions/api/agent/[[path]].ts`(새) | ② | 진입점 |
| `pipeline/agent-trip/{client,token,share-store}.ts`(새) | ② | 서버 요청·토큰 찾기·삭제 토큰 파일 |
| `tests/helpers/sync-memory-server.ts` | ② | `/api/agent/` 처리와 `agentFetch` |
| `src/services/agent-inbox/{api,storage,inbox-check,boot}.ts`(새) | ③ | 앱 API·기기 키·실행기·부트 |
| `src/sections/agent/{use-agent-inbox-boot.ts,AgentSection.tsx,AgentTokenDialog.tsx,AgentInboxDialog.tsx,agent-copy.ts}`(새) | ③ | 화면 |
| `src/stores/add-place.ts`, `src/sections/add-place/AddPlaceHost.tsx`, `src/sections/share-import/SharePreview.tsx` | ③ | 받은함 미리보기 |
| `src/sections/settings/SettingsPage.tsx`, `src/sections/shell/ShellRoute.tsx`, `package.json`(`build:ci`) | ③ | 연결 |
| `tests/e2e/sync-server.ts`, `tests/e2e/agent-inbox.spec.ts`(새) | ③ | E2E |
| `docs/development.md`, `README.md`, `src/sections/help/help-content.ts`, `docs/help/settings.md` | ④ | 문서 |

---

# PR ① CLI + 데이터 링크

### Task 1: 앱 코드 내보내기와 공용 한도

**Files:**
- Modify: `src/services/id-gen.ts`, `src/server/search.ts`, `src/server/resolve.ts`, `src/domain/share/read-share.ts`
- Create: `src/domain/share/agent-limits.ts`
- Test: `tests/unit/server/search.test.ts`(사례 추가), `tests/unit/domain/share/read-share-limits.test.ts`(새), `tests/unit/domain/share/agent-limits.test.ts`(새), `tests/unit/services/id-gen.test.ts`(있으면 추가, 없으면 새)

**Interfaces:**
- Produces:
  ```ts
  // src/services/id-gen.ts — 본문은 그대로, 앞에 export만
  export function randomId(length: number): string;

  // src/server/search.ts
  export type NaverSearchPlace = SearchResult & { sid: string | null };
  /** 자동완성의 장소 결과(최대 10곳). `sid`는 응답 `id`가 숫자 문자열일 때만(2026-11-01 확인: `id`·`sid`가 장소 sid). */
  export async function searchNaverPlaces(query: SearchQuery, deps: Deps): Promise<NaverSearchPlace[]>;
  // resolveSearch는 searchNaverPlaces 결과에서 sid를 뺀 { results }를 돌려준다(응답 모양 그대로).

  // src/server/resolve.ts — 지금 함수에 export만
  export function httpDeps(request: Requester, options?: RequestOptions): HttpDeps;

  // src/domain/share/agent-limits.ts (import는 `import type { ShareDocV2 }`만)
  export const AGENT_INBOX_LIMITS = {
    fileBytes: 5_242_880,
    places: 200,
    hashChars: 32_000,
    decodedBytes: 1_048_576,
  } as const;
  export const AGENT_PLACE_LIMITS = { nameChars: 100, addressChars: 200, titleChars: 60, memoChars: 10_000, numericIdPattern: /^\d{1,20}$/, googleIdChars: 64 } as const;
  /** 문서 하나를 받은함 기준으로 본다(제목·장소 이름·주소·메모·출처 id). 문제 이유 하나 또는 null. CLI(Task 5)와 서버(Task 10)가 같이 쓴다. */
  export function agentDocProblem(doc: ShareDocV2): 'title' | 'place-too-long' | null;

  // src/domain/share/read-share.ts
  export type ShareReadLimits = { places: number; hashChars: number; decodedBytes: number }; // SHARE_IMPORT_LIMITS는 as const라 Pick을 쓰면 리터럴 타입이 된다
  export async function readShareHash(value: string, limits: ShareReadLimits = SHARE_IMPORT_LIMITS): Promise<ShareReadResult>;
  ```
  `readShareHash`는 `decodeCompressedJson(value, { maxChars: limits.hashChars, maxBytes: limits.decodedBytes })`로 풀고, 내부 `validate(json, limits.places)`가 `SHARE_IMPORT_LIMITS.places` 대신 받은 값을 쓴다. `readShareHtml`·`readShareFile`은 기본값 그대로.
- [ ] **Step 1: 실패하는 시험**
  - `search.test.ts`: 가짜 응답 `{ place: [{ id: '31506191', sid: '31506191', title: '초당순두부마을', x: '128.9156023', y: '37.7906975', roadAddress: '…', ctg: '두부요리' }] }` → `searchNaverPlaces` 결과 `sid: '31506191'`, `id`가 없거나 숫자가 아니면 `sid: null`. 같은 응답의 `resolveSearch` 결과는 지금 시험의 모양 그대로(`sid` 키 없음 — `expect(Object.keys(r.results[0]!)).not.toContain('sid')`).
  - `agent-limits.test.ts`(같은 폴더): `agentDocProblem`이 제목 61자 `title`, 이름 101자·sid 21자리·`googleId` 65자 `place-too-long`, 정상 null.
  - `read-share-limits.test.ts`: 타입 확인으로 `const a: ShareReadLimits = SHARE_IMPORT_LIMITS; const b: ShareReadLimits = AGENT_INBOX_LIMITS;`(둘 다 `yarn typecheck` 통과). 장소 201곳 v2 문서(`tests/fixtures/builders.ts`의 빌더로 만듦)의 `encodeShareHash` 값 → 기본 한도 `ok`, `AGENT_INBOX_LIMITS`로는 `too-many`. 1,048,577바이트로 풀리는 문서(긴 `memo`) → 기본 `ok`, 에이전트 한도 `corrupt`.
  - `id-gen.test.ts`: `randomId(10)`이 `/^[a-z0-9]{10}$/`.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/search.test.ts tests/unit/domain/share/read-share-limits.test.ts tests/unit/services/id-gen.test.ts` → 새 사례 FAIL
- [ ] **Step 3: 구현** — `searchNaverPlaces`는 지금 `resolveSearch` 본문을 옮기고 각 결과에 `sid: typeof p.id === 'string' && /^\d+$/.test(p.id) ? p.id : null`을 더한다. `resolveSearch`는 `({ results: (await searchNaverPlaces(query, deps)).map(({ sid: _sid, ...rest }) => rest) })`. 나머지는 위 인터페이스대로.
- [ ] **Step 4:** 같은 명령 PASS, `yarn vitest run tests/unit/server tests/unit/domain/share`, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(agent-trip): 장소 검색 sid·요청 래퍼·id 생성 내보내기와 에이전트 한도`

### Task 2: 계획 파일 스키마와 오류 형식

**Files:**
- Create: `pipeline/agent-trip/errors.ts`, `pipeline/agent-trip/plan-schema.ts`
- Test: `tests/unit/pipeline/agent-trip/plan-schema.test.ts`

**Interfaces:**
- Consumes: `safeParse`(`src/schema/parse.ts`), `CalendarDate`·`HHmm`·`Lng`·`Lat`(`src/schema/common.ts`), `LIBRARY_LIMITS`(`src/schema/library-base.ts`), `daysBetween`(`src/lib/calendar.ts`), `SHARE_TRIP_LIMITS`(`src/domain/share/check-share-trip.ts`), `AGENT_PLACE_LIMITS`.
- Produces:
  ```ts
  // errors.ts
  export type TripErrorCode =
    | 'schema' | 'unknown-place' | 'duplicate-in-trip' | 'day-count' | 'duplicate-sid' | 'leg-modes'
    | 'no-places' | 'lookup-failed' | 'ambiguous' | 'not-found' | 'duplicate-source' | 'out-of-range'
    | 'walk-too-far' | 'merged-places' | 'item-too-large' | 'too-big' | 'app-origin'
    | 'unused-place' | 'no-token' | 'unauthorized' | 'token-expired' | 'token-revoked' | 'not-allowed' | 'scope'
    | 'delete-token' | 'unknown-share' | 'share-store-full' | 'share-store' | 'inbox-full' | 'rate-limited' | 'off' | 'config'
    | 'old-server' | 'offline' | 'timeout' | 'server' | 'internal';
    export type TripIssue = {
    path: string;            // 'days[1].stops[2].place', 'places[3]', 'legModes["a>b"]', ''(전체)
    code: TripErrorCode;
    message: string;         // 한국어 한 줄
    candidates?: { naverSid: string; name: string; address: string; category: string }[];
  };
  export const EXIT = { ok: 0, internal: 1, input: 2, lookup: 3, auth: 4, server: 5 } as const;
  export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
  /** 끝 코드 표(설계 「출력」)를 코드별로 고정한다. */
  export function exitFor(code: TripErrorCode): ExitCode;
  export class TripFailure extends Error {
    constructor(readonly issues: TripIssue[], readonly exit: ExitCode);
  }

  // plan-schema.ts
  export const TripPlanSchema: Schema.Codec<TripPlan>; // 아래 모양
  export type PlanPlace = {
    key: string; naverSid?: string; link?: string; search?: { q: string; near?: [number, number] };
    name?: string; address?: string; lng?: number; lat?: number; memo?: string;
  };
  export type PlanStop = { place: string; stayMin?: number | null; fixedTime?: string | null; note?: string };
  export type PlanDay = { startTime?: string; lodging?: string | null; stops: PlanStop[] };
  export type TripPlan = {
    format: 'landmark-trip-plan'; version: 1; title: string; startDate: string; endDate: string;
    origin?: string | null; places: PlanPlace[]; days: PlanDay[]; candidates?: string[];
    legModes?: Record<string, 'car' | 'walk'>;
  };
  /** 스키마(`onExcessProperty: 'error'`) → 의미 검사. 실패는 모은 `TripIssue[]`로 `TripFailure(…, EXIT.input)`. */
  export function parsePlan(value: unknown): TripPlan;
  /** Effect 경로 'days.0.stops.2.place' → 'days[0].stops[2].place'. */
  export function toPlanPath(path: string): string;
  /** effect 4.0.2의 `Schema.toJsonSchemaDocument(TripPlanSchema)`는 `{ dialect, schema, definitions }`를 돌려준다(루트에 properties가 없다). 이것을 표준 문서 `{ $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema, $defs: definitions }`로 조립하고, 생성 옵션 `{ onExcessProperty: 'error' }`를 넘겨 Struct만 닫는다(`additionalProperties: false`). `legModes` 같은 `Schema.Record`는 값 스키마가 `additionalProperties`에 그대로 남아야 하므로 손으로 모든 객체에 false를 넣지 않는다. */
  export function planJsonSchema(): Record<string, unknown>;
  ```
  스키마 규칙(설계 「계획 파일」 표 그대로): `key` `^[A-Za-z0-9_-]{1,40}$`, `naverSid` `^\d{1,20}$`, `link` 1~2,000자, `search.q` 1~40자(`parseSearchQuery`와 같음), `name` 1~100자, `address` 200자까지, `memo` 10,000자까지, 좌표·`near`는 `Lng`·`Lat`, `places` 1~200, `title` 1~60, `startTime`·`fixedTime` `HHmm`, `stayMin` 0~1440 정수 또는 null, `note` 500자까지, `legModes` 키는 문자열(모양은 의미 검사).
  의미 검사(코드·경로):
  - 장소마다 출처(`naverSid`·`link`·`search`)는 0~1개(`schema`, `places[i]`), 0개면 `name`·`lng`·`lat` 필수(`schema`).
  - key 중복(`schema`, 뒤 것의 `places[i].key`), 같은 `naverSid` 두 번(`duplicate-sid`).
  - `origin`·`lodging`·`stops[].place`·`candidates[]`가 없는 key(`unknown-place`).
  - 날 수: `daysBetween(startDate, endDate)`가 1~`SHARE_TRIP_LIMITS.maxDays`가 아니면 `schema`(`endDate`), `days.length`와 다르면 `day-count`(`days`, "기간은 3일인데 days가 2개예요").
  - Stop·후보 전체에서 같은 장소 두 번(`duplicate-in-trip`, 두 번째 경로).
  - 참조 장소가 하나도 없으면 `no-places`(`days`).
  - `legModes` 키가 `^[^>]+>[^>]+$`이 아니거나 key가 없으면 `leg-modes`. 이웃 쌍 검사는 Task 4(장소 순서가 정해진 뒤)에서 한다.
- [ ] **Step 1: 실패하는 시험** — `plan-schema.test.ts`(`// @vitest-environment node`): 고정 계획(`tests/fixtures/agent-trip/plan.json`을 이 과제에서 만든다. 설계 「계획 파일」 예시와 같은 1박 2일·장소 5곳·Day 구성이되, 네트워크 없이 돌도록 **모든 장소를 핀**(`name`·`address`·`lng`·`lat`, 출처 필드 없음)으로 둔다. 좌표는 강원 속초·강릉 일대와 서울 강남역처럼 `Lng`·`Lat` 범위 안)이 통과. 출처 필드 규칙은 이 고정 계획을 복사해 고친 사례로 본다. 위 규칙마다 한 사례씩 `TripFailure`의 `issues[].path`·`code`를 정확히 단언(예: `days[1].stops[0].place` `unknown-place`, `places[2]` 출처 둘 `schema`, `days` `day-count`, 모르는 필드 `places[0].foo` `schema`). 여러 오류가 한 번에 모이는지(두 개 이상). `toPlanPath('days.0.stops.2.place') === 'days[0].stops[2].place'`. `planJsonSchema()`의 루트에 `$schema`·`properties.places`가 있고, 루트와 `places` 항목 스키마(직접 또는 `$defs` 참조)의 `additionalProperties`가 `false`이고, `legModes`의 `additionalProperties`는 `car`·`walk` 열거(정상 키 허용, 다른 값 거절).
- [ ] **Step 2:** `yarn vitest run tests/unit/pipeline/agent-trip/plan-schema.test.ts` → FAIL
- [ ] **Step 3: 구현** — `safeParse(TripPlanSchema, value, { onExcessProperty: 'error' })` 실패면 `issues.map(i => ({ path: toPlanPath(i.path), code: 'schema', message: i.message }))`. 성공이면 의미 검사를 모두 돌려 하나라도 있으면 던진다.
- [ ] **Step 4:** PASS, `yarn typecheck`, `yarn lint pipeline tests/unit/pipeline`
- [ ] **Step 5:** 커밋 `feat(agent-trip): 계획 파일 스키마와 경로 붙은 오류`

### Task 3: 장소 조회

**Files:**
- Create: `pipeline/agent-trip/resolve-places.ts`
- Test: `tests/unit/pipeline/agent-trip/resolve-places.test.ts`

**Interfaces:**
- Consumes: `fetchPlaceSummary`(`pipeline/naver-client.ts`), `resolveLink`·`httpDeps`(`src/server/resolve.ts`), `searchNaverPlaces`(`src/server/search.ts`), `makeRequester`(`src/server/request.ts`), `sourceKey`·`PlaceCandidate`(`src/domain/library/add-place.ts`), `Lng`·`Lat`, `AGENT_PLACE_LIMITS`, `TripPlan`, `TripIssue`.
- Produces:
  ```ts
  export type ResolvedPlace = {
    key: string; index: number;            // places[index]
    candidate: PlaceCandidate;             // source·name·address·lng·lat·category
    memo: string;
  };
  export type ResolveDeps = { fetch: typeof fetch; sleep(ms: number): Promise<void>; gapMs?: number /* 기본 300 */ };
  /** 차례로 조회. 경고는 `warnings`에, 오류는 모두 모아 `TripFailure`(조회 실패·후보 여럿 → EXIT.lookup, 범위·출처 중복 → EXIT.input). */
  export async function resolvePlaces(plan: TripPlan, deps: ResolveDeps, warnings: TripIssue[]): Promise<ResolvedPlace[]>;
  ```
  규칙(설계 「처리 순서」 2):
  - 요청기: `const request = makeRequester({ fetch: deps.fetch })`. `naverSid` → `fetchPlaceSummary(sid, httpDeps(request))`, `link` → `resolveLink(link, { fetch: deps.fetch })`(결과가 `kind: 'folder'`면 `lookup-failed` "폴더 링크는 장소가 아니에요"), `search` → `searchNaverPlaces({ q, near }, { fetch: deps.fetch })`.
  - 검색 고르기: 이름 정규화(`normalize('NFC')`, 공백 제거, 소문자)가 `q`(또는 `name`이 있으면 `name`)와 같은 결과가 정확히 하나면 그것, 결과가 하나뿐이면 그것. `sid`가 null인 결과는 고르지 않는다. 여럿이면 `ambiguous` + `candidates`(최대 5곳). 0곳이면 `lng`·`lat`이 있을 때 핀(경고 `not-found`), 없으면 `not-found`.
  - 실패(던짐·시간 초과): 대체 값(`name`·`lng`·`lat`)이 있으면 그 값 + 원래 출처(`naverSid`면 `{ kind: 'naver', sid }`, `link`·`search`면 핀) + 경고 `lookup-failed`, 없으면 오류 `lookup-failed`.
  - 출처: 네이버 `{ kind: 'naver', sid }`, 카카오 `{ kind: 'kakao', kakaoId }`, 구글 `{ kind: 'google', googleId }`(구글 `providerId`가 null이면 핀), 핀 `{ kind: 'pin' }`.
  - 결과 검사: 좌표가 `Lng`·`Lat` 밖이면 `out-of-range`(대체 값이 있어도). 링크·검색으로 얻은 출처 id도 `AGENT_PLACE_LIMITS`로 본다(`naverSid`·`kakaoId` `numericIdPattern`, `googleId` 64자 — `src/server/links.ts`는 구글 id 길이를 제한하지 않는다). 넘으면 `out-of-range`, 경로는 `places[i].link`·`places[i].search`(끝 코드 2). 이름 0자면 대체 `name`, 그것도 없으면 `lookup-failed`. 이름·주소가 100·200자를 넘으면 자르고 경고 `out-of-range`.
  - 출처 중복: `sourceKey(candidate.source)`가 **null이 아니고** 같은 두 장소 → `duplicate-source`(일반 핀은 `sourceKey`가 null이라 검사하지 않는다 — 기존 `indexBySource`와 같음), `path`는 뒤 장소, `message`에 앞 장소 경로(`places[1]`과 같아요).
  - 요청 사이 `deps.sleep(gapMs)`(첫 요청 전 제외).
- [ ] **Step 1: 실패하는 시험** — 가짜 `fetch`가 URL별 응답을 준다(`tests/unit/pipeline/naver-client.test.ts`의 `makeDeps` 방식, 장소 응답은 `tests/fixtures/naver/`의 기존 장소 요약 고정 파일을 쓴다 — 없으면 `{ data: { placeDetail: { name, address: { roadAddress }, coordinate: { longitude, latitude }, category: { category } } } }`를 직접 만든다). 사례: sid 성공, sid 실패 + 대체 값(경고), sid 실패 대체 없음(`lookup-failed`, EXIT 3), 링크(네이버 단축 링크는 `followRedirects`가 쓰는 3xx 응답을 가짜로), 폴더 링크 거절, 검색 정확한 이름 하나, 결과 하나, 여럿 `ambiguous`(후보 5곳 이하), 없음 + 좌표 → 핀, 시간 초과(가짜 `fetch`가 `AbortSignal`을 기다림 — `vi.useFakeTimers()`로 8초 넘김) → 대체 값, 구글 링크의 범위 밖 좌표 `out-of-range`, 구글 링크에서 나온 65자 `googleId` → `places[i].link` `out-of-range`, sid와 검색이 같은 sid → `duplicate-source`, 서로 다른 핀 5곳(고정 계획)은 통과, 요청 사이 `sleep(300)` 호출 수.
- [ ] **Step 2:** FAIL 확인 → **Step 3:** 구현 → **Step 4:** `yarn vitest run tests/unit/pipeline/agent-trip/resolve-places.test.ts` PASS, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(agent-trip): 계획 장소를 네이버·링크·검색으로 조회`

### Task 4: 메모리 보관함과 구간 시간

**Files:**
- Create: `pipeline/agent-trip/build-library.ts`, `pipeline/agent-trip/route-legs.ts`
- Test: `tests/unit/pipeline/agent-trip/build-library.test.ts`, `tests/unit/pipeline/agent-trip/route-legs.test.ts`

**Interfaces:**
- Consumes: `emptyLibrary`·`LibrarySchema`(`src/schema/library.ts`), `newPlace`(`src/domain/library/add-place.ts`), `createTrip`·`insertStop`·`setStopStay`·`setStopFixedTime`·`setStopNote`·`setLodging`·`setDayStartTime`·`setLegMode`(`src/domain/trips/ops.ts`), `randomId`, `dayLegs`·`legKey`·`Leg`(`src/domain/trips/query.ts`), `haversineM`·`WALK_MAX_M`·`SAME_POINT_M`·`estimateLeg`(`src/domain/trips/geo.ts`), `resolveRoute`·`routeInputKey`(`src/server/route.ts`), `ApiError`(`src/server/http.ts`), `ShareLegTime`(`src/domain/share/build-trip-share.ts`).
- Produces:
  ```ts
  // build-library.ts
  export type BuiltLibrary = { lib: Library; tripId: string; placeIds: Map<string, string> /* plan key → PlaceId */; now: string };
  /** 장소를 넣고 여행을 만든다. 연산 실패는 해당 계획 경로의 `TripFailure`(EXIT.input). 마지막에 `LibrarySchema`로 검사(실패는 EXIT.internal). */
  export function buildLibrary(plan: TripPlan, places: ResolvedPlace[], now: Date, warnings: TripIssue[]): BuiltLibrary;
  /** `legModes`의 각 키가 그날 이웃한 두 점인지(`leg-modes`), 50km 넘는 walk인지(`walk-too-far`). buildLibrary 안에서 setLegMode 전에 부른다. */
  export function checkLegModes(plan: TripPlan, places: ResolvedPlace[]): TripIssue[];

  // route-legs.ts
  export type RouteStats = { legs: number; routed: number; estimated: number; noRoute: number; samePoint: number; oldestQueriedAt: string | null };
  export type RouteDeps = { fetch: typeof fetch; sleep(ms: number): Promise<void>; gapMs?: number; skip?: boolean /* --no-routes */ };
  /** 모든 Day 구간을 미리 물어 두고 동기 `routeOf`를 돌려준다. 실패한 구간은 경고(`path: 'days[d]'`, code 'lookup-failed'). */
  export async function prepareRoutes(built: BuiltLibrary, deps: RouteDeps, warnings: TripIssue[]): Promise<{ routeOf(leg: Leg): ShareLegTime; stats: RouteStats }>;
  ```
  - `buildLibrary`: `ctx = { now: now.toISOString(), newId: (kind) => randomId(kind === 'label' || kind === 'stop' || kind === 'meetingMember' ? 8 : 10) }`. 장소마다 `newPlace(ctx.newId('place'), r.candidate, [], r.memo, ctx.now)`. `createTrip(lib, { title, startDate, endDate, origin, candidates }, ctx)`. Day마다 Stop 순서대로 `insertStop(lib, tripId, placeId, d, position, ctx)` → 그 Day의 `stops.value`에서 `placeId`가 같은 Stop id로 `setStopStay`(`stayMin`이 `undefined`면 부르지 않음)·`setStopFixedTime`·`setStopNote`. `lodging` → `setLodging(lib, tripId, d, id, false, ctx)`, `startTime` → `setDayStartTime`. `legModes` → `setLegMode`. 연산 결과 `ok: false`의 경로: `TripDatesInvalid` → `endDate`, `TitleInvalid`류 → `title`, 그 밖 → 해당 Day·Stop 경로.
  - 쓰지 않는 장소: 출발지·숙소·Stop·후보 어디에도 없는 `places[i]`는 경고 `unused-place`("쓰지 않는 장소라 문서에 넣지 않았어요")로 `warnings`에 모은다. 문서에는 들어가지 않는다(`buildTripShareDoc`가 참조한 장소만 담음).
  - `checkLegModes`: Day마다 점 순서 `[출발점(Day 0은 origin, 그 뒤는 전날 lodging)?, …stops, lodging?]`의 이웃 쌍 집합을 만들어 `legModes` 키가 그 안에 없으면 `leg-modes`(`legModes["a>b"]`). `walk`이고 두 장소 `haversineM > WALK_MAX_M`이면 `walk-too-far`.
  - `prepareRoutes`: 모든 `dayLegs(lib, trip, d)` 중 `!(leg.straightM >= SAME_POINT_M)`가 아닌 것을 `routeInputKey({ mode: leg.mode, from: [lng, lat], to: [lng, lat] })`로 한 번씩 `resolveRoute(q, { fetch })`. 결과 맵을 보고 `routeOf`가 `use-trip-legs.ts`와 같은 값을 낸다: 같은 지점 → `{ durationS: 0, distanceM: 0, tollFare: null, status: 'same-point', queriedAt: null, path: [] }`; 성공 → `routed`(값 그대로); `ApiError` `NO_ROUTE` → `no-route` + `estimateLeg(leg.mode, leg.straightM)`; 그 밖 → `estimated` + `estimateLeg`. 둘 다 `tollFare: null`, `queriedAt: null`, `path: []`. `skip`이면 묻지 않고 모두 `estimated`.
- [ ] **Step 1: 실패하는 시험**
  - `build-library.test.ts`: 고정 계획 + 가짜 `ResolvedPlace` 5곳 → `LibrarySchema` 통과, Day 0 Stop 2개(순서·`stayMin`·`fixedTime`·`note`), Day 0 숙소, Day 1 시작 시각, `legModes`, `origin`. 날짜 31일 → `endDate` 오류. 어디에도 쓰지 않는 장소 하나 → 경고 `unused-place`(그 `places[i]` 경로)(문서에서 빠지는지는 `buildDoc`이 생기는 Task 5 시험에서 본다). `checkLegModes`: 이웃이 아닌 쌍 `leg-modes`, 60km 떨어진 두 핀 `walk` → `walk-too-far`.
  - `route-legs.test.ts`: 가짜 `fetch`로 자동차 성공·도보 성공·`code: 1`(→ `NO_ROUTE`)·HTTP 500·같은 지점(5m 떨어진 두 장소, 요청 없음)·같은 입력 키 두 번(요청 1번)·`skip`. 각 `routeOf` 값이 위 규칙과 같고 `stats`가 맞다. 요청 사이 `sleep(300)`.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `yarn vitest run tests/unit/pipeline/agent-trip` PASS, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(agent-trip): 계획으로 메모리 보관함·구간 시간 만들기`

### Task 5: 문서·검사·모의 가져오기·링크·요약

**Files:**
- Create: `pipeline/agent-trip/build-doc.ts`, `pipeline/agent-trip/summary.ts`
- Test: `tests/unit/pipeline/agent-trip/build-doc.test.ts`, `tests/unit/pipeline/agent-trip/summary.test.ts`

**Interfaces:**
- Consumes: `buildTripShareDoc`(`src/domain/share/build-trip-share.ts`), `checkShareTrip`, `ShareDocV2Schema`, `safeParse`, `importSharedTrip`(`src/domain/library/import-share-trip.ts`), `defaultTitleLabel`(`src/domain/library/import-share.ts`), `stableStringify`·`ITEM_DOC_MAX_CHARS`(`src/domain/library-sync/items.ts`), `viewLink`·`importLink`·`hashDoc`·`encodeShareHash`(`src/share-viewer/encode.ts`), `readShareHash`, `AGENT_INBOX_LIMITS`, `computeSchedule`·`formatClock`(`src/domain/trips/schedule.ts`), `dayLegs`·`dayEndpoints`·`visibleStops`.
- Produces:
  ```ts
  // build-doc.ts
  export type BuiltDoc = {
    doc: ShareDocV2;
    view: string;        // `${app}/view#d=…`
    importHref: string;  // `${app}/import#d=…`
    importHash: string;  // `#d=` 뒤 값(받은함 `d`)
    viewHash: string;    // `/view#d=` 뒤 값(짧은 링크 암호화 대상)
  };
  /** 장소·라벨·여행 중 `stableStringify(item).length > max`인 항목 키(`place:<id>` 등). */
  export function oversizedItems(lib: Library, max: number): string[];
  export async function buildDoc(
    built: BuiltLibrary, routeOf: (leg: Leg) => ShareLegTime,
    opts: { title: string; includeMemo: boolean; app: string; now: Date }, plan: TripPlan,
  ): Promise<BuiltDoc>;
  // summary.ts
  export type DaySummary = {
    date: string;
    stops: { key: string; name: string; arrive: string; depart: string; fixedTime: string | null; slackMin: number | null }[];
    travelMin: number; estimatedLegs: number;
  };
  export function summarize(built: BuiltLibrary, routeOf: (leg: Leg) => ShareLegTime, plan: TripPlan): DaySummary[];
  ```
  `buildDoc` 순서(설계 5 → 5-1 → 6):
  1. `buildTripShareDoc(built.lib, built.tripId, routeOf, { title, includeMemo, includeCandidates: true, now })` → null이면 `internal`. `safeParse(ShareDocV2Schema, doc, { onExcessProperty: 'error' })`·`checkShareTrip(doc)` 실패면 `internal`(메시지에 문제 줄).
  2. 모의 가져오기: `importSharedTrip(emptyLibrary(), hashDoc(doc) as ShareDocV2, { titleLabel: defaultTitleLabel(doc.title), appendMemo: true }, ctx)` → `ok: false`면 `internal`. 새 여행의 Day별 `stops.value.length`·`candidates.value.length`가 문서와 다르면 `merged-places`(사라진 Stop의 계획 경로와 그 장소와 합쳐진 앞 장소 경로). 결과 보관함의 장소·라벨·여행마다 `stableStringify(item).length > ITEM_DOC_MAX_CHARS`면 `item-too-large`(장소는 `places[i]`, 여행은 `days`).
  3. `viewLink(doc, app)`·`importLink(doc, app)` — 둘 중 `kind !== 'direct'`면 `too-big`(EXIT.input, "장소·Day를 줄이거나 앱에서 파일로 공유해 주세요"). `importHash`를 `readShareHash(importHash, AGENT_INBOX_LIMITS)`로 다시 읽어 `ok: false`면 그 이유를 `too-big`(`too-many`·`corrupt`)으로 낸다. `agentDocProblem(doc)`(서버와 같은 검사: 제목 60자, 장소 이름 100자·주소 200자·메모 10,000자, `naverSid`·`kakaoId` 20자리 숫자, `googleId` 64자)이 null이 아니면 `internal`.
  - `summarize`: Day마다 `dayLegs`·`routeOf`로 `computeSchedule({ startTime, hasStart, stops, hasEnd, legs })`, 시각은 `formatClock`, `estimatedLegs`는 `status`가 `estimated`·`no-route`인 수.
- [ ] **Step 1: 실패하는 시험**
  - `build-doc.test.ts`: 고정 계획(가짜 조회·`skip` 구간) → 문서가 스키마·관계 검사 통과, `importHash`의 `readShareHash` 결과가 `hashDoc(doc)`과 같은 값(`toEqual`). `includeMemo: false`면 `places[].memo` 없음, Stop `note`는 있음. 제목 30·31·60자 모두 성공(31자는 `defaultTitleLabel`이 자르므로). 이름 같고 20m 떨어진 핀 두 개를 Day 0·Day 1 Stop에 넣으면 `merged-places`. 합법적인 최대 입력을 둘로 나눈다: (가) 이름 100자·주소 200자 장소 200곳, 메모 없음(`includeMemo: false`) → 성공, 어떤 항목도 동기화 상한에 닿지 않음. (나) 같은 계획에 장소 메모 10,000자씩 + `includeMemo: true` → 풀린 크기가 `AGENT_INBOX_LIMITS.decodedBytes`(1MB)를 넘어 `too-big`(전체 문서 상한이 먼저 걸린다). 크기 검사 자체는 `buildDoc`이 쓰는 내부 함수 `oversizedItems(lib, max)`를 내보내 직접 시험한다: `stableStringify` 길이가 정확히 `max`인 항목은 통과, `max + 1`이면 그 항목의 키(시험에서는 `max`를 작게 넘겨 만든다). 경로선 많은 문서는 `viewLink`가 경로선 없이 다시 만들어도 `direct`. 32,000자를 넘는 문서 `too-big`.
  - `summary.test.ts`: 설계 출력 예시와 같은 값 — 출발 09:00, 첫 구간 102분(가짜 `routeOf`), `stayMin` 60, `fixedTime` 12:00 → `arrive '10:42'`, `depart '13:00'`, `slackMin 78`.
  - `build-doc.test.ts`(이어서): 쓰지 않는 장소 하나가 있는 계획 → 결과 문서 `places`에 그 장소가 없고 경고 `unused-place`가 남음.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `yarn vitest run tests/unit/pipeline/agent-trip` PASS, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(agent-trip): 앱과 같은 공유 문서·모의 가져오기·데이터 링크·요약`

### Task 6: `yarn trip build`·`--schema` 명령과 ① 마무리

**Files:**
- Create: `pipeline/agent-trip/output.ts`, `pipeline/agent-trip/run-build.ts`, `pipeline/cli/trip.ts`, `tests/fixtures/agent-trip/doc.json`(Step 5의 `--out` 결과, E2E가 쓴다)
- Modify: `package.json`(`scripts.trip`)
- Test: `tests/unit/pipeline/agent-trip/cli-build.test.ts`

**Interfaces:**
- Consumes: Task 2~5 전부, `appUrl`·`DEFAULT_APP_URL`(`src/share-viewer/encode.ts`), `isAllowedOrigin`(`src/server/http.ts`).
- Produces:
  ```ts
  // run-build.ts
  export type BuildOptions = { file: string; includeMemo: boolean; noRoutes: boolean; app: string; out?: string };
  export type BuildResult = { plan: TripPlan; built: BuiltLibrary; doc: BuiltDoc; days: DaySummary[]; stats: RouteStats; warnings: TripIssue[] };
  export type BuildDeps = { fetch: typeof fetch; sleep(ms: number): Promise<void>; now(): Date; readFile(path: string): Promise<string>; writeFile(path: string, text: string): Promise<void> };
  export async function runBuild(opts: BuildOptions, deps: BuildDeps): Promise<BuildResult>;
  /** --app·LANDMARK_APP_URL·DEFAULT_APP_URL에서 고르고 `appUrl()`로 정리. `forToken`이면 isAllowedOrigin 또는 http://localhost:*·127.0.0.1:*만(아니면 'app-origin'). */
  export function pickApp(flag: string | undefined, env: NodeJS.ProcessEnv, forToken: boolean): string;
  // output.ts
  export type CommandName = 'build' | 'send' | 'share' | 'whoami' | 'unshare';
  export function successJson(command: CommandName, r: BuildResult | null, extra: Record<string, unknown>): string;
  export function failureJson(command: CommandName, issues: TripIssue[]): string;
  export function successText(command: CommandName, r: BuildResult | null, extra: Record<string, unknown>): string;
  export function failureText(issues: TripIssue[]): string;
  // trip.ts
  /** 인자를 해석해 실행하고 끝 코드를 돌려준다. 표준 출력·오류는 deps로(시험이 잡는다). */
  export async function main(argv: string[], deps: CliDeps): Promise<ExitCode>;
  export type CliDeps = BuildDeps & { env: NodeJS.ProcessEnv; stdout(text: string): void; stderr(text: string): void };
  ```
  - 인자: `node:util`의 `parseArgs`(`strict: true`). ①에서 받는 것: `build <plan.json> [--memo] [--no-routes] [--out <file>] [--app <url>] [--json]`, `--schema`. `send`·`share`·`whoami`·`unshare`는 ②에서 더한다(①에서는 "다음 버전에서 쓸 수 있어요" `internal` 아님, 끝 코드 2 `schema`).
  - 기계 판독 호출은 **`yarn --silent trip … --json`**(Yarn 1은 `yarn run`의 시작·종료 줄을 표준 출력에 쓴다). 문서·스킬 규약·사람용 안내의 `--json` 예는 모두 `--silent`를 붙인다(`--schema`도 같음).
  - `--json`: 표준 출력에 JSON 하나(설계 「출력」 모양: `ok`, `command`, `trip`, `days`, `routes`, `links: { view, import }`, `warnings`). 진행 상황은 표준 오류. 실패는 `{ ok: false, command, errors }`.
  - `--out`: 문서 JSON(`doc`)을 쓴다. 이미 있는 파일을 덮는다.
  - 파일 끝: `if (import.meta.url === pathToFileURL(process.argv[1]!).href) process.exitCode = await main(process.argv.slice(2), nodeDeps())`. `nodeDeps()`는 `globalThis.fetch`, `setTimeout` sleep, `node:fs/promises`.
  - `package.json`: `"trip": "tsx pipeline/cli/trip.ts"`(`validate` 줄 다음).
- [ ] **Step 1: 실패하는 시험** — `cli-build.test.ts`(`// @vitest-environment node`): `main(['build', 'tests/fixtures/agent-trip/plan.json', '--no-routes', '--json'], deps)`(가짜 `fetch`가 장소 조회에만 답함) → 끝 코드 0, 표준 출력 JSON의 `links.view`가 `https://landmark.sch0718.dev/view#d=`로 시작, `links.import`의 `#d=` 값으로 `readShareHash` 성공, `routes.estimated === routes.legs - routes.samePoint`. 잘못된 계획 → 끝 코드 2와 `errors[0].path`. `--app http://localhost:8798`이면 링크 주소가 바뀜. `pickApp('https://evil.example', env, true)` → `app-origin`, `forToken: false`면 허용(데이터 링크는 토큰이 없다). `--schema` → JSON Schema. 사람용 출력에 Day별 줄과 경고 줄.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: 손으로 확인** — `yarn --silent trip build tests/fixtures/agent-trip/plan.json --no-routes --json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"`와 `yarn --silent trip --schema | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"`가 오류 없이 끝남(실제 Yarn 프로세스의 표준 출력 전체가 JSON). 그리고 `yarn trip build tests/fixtures/agent-trip/plan.json --no-routes --out tests/fixtures/agent-trip/doc.json`(고정 계획은 `naverSid` 없이 핀·대체 값만 써서 네트워크 없이 돈다. 네트워크가 막혀도 성공해야 한다), `yarn trip --schema | head -5`. 나온 `/import#d=` 링크를 보고에 적는다(감독자가 브라우저로 가져오기를 확인).
- [ ] **Step 6: ① 전체 검증** — Global Constraints의 전체 검증 명령.
- [ ] **Step 7:** 커밋 `feat(agent-trip): yarn trip build와 계획 파일 JSON Schema`

---

# PR ② 서버 토큰·받은함·짧은 링크 API

### Task 7: 스키마 7과 연결 지점

**Files:**
- Modify: `src/server/meet/schema-sql.ts`, `src/server/library-sync/env.ts`, `src/server/library-sync/library.ts`, `src/server/library-sync/backup.ts`(`requireBackupUser` 앞에 `export`), `tests/unit/server/meet-db.test.ts`(30·32행 버전 6 → 7, 34행 이하 `sqlite_master` 표 목록 `toEqual`에 `{ name: 'agent_inbox' }`·`{ name: 'agent_tokens' }`를 이름순 맨 앞에), `tests/unit/server/sync-schema.test.ts`·`tests/unit/server/backup-schema.test.ts`(`{ version: 6 }` → 7)
- Test: `tests/unit/server/agent-schema.test.ts`(새)

**Interfaces:**
- Produces: `SCHEMA_VERSION = 7`, `SCHEMA_STATEMENTS` 끝에 설계 「서버 데이터」의 SQL을 **문장마다 배열 원소 하나로**(첫 원소에 주석 `-- 7: AI 연결 토큰과 받은함. 토큰 원문은 두지 않는다.`). `SyncEnv`에 `AGENT_API?: string;`(주석 `/** 'off'면 AI 연결 토큰 경로와 새 발급을 막는다(목록·철회·받은함 읽기·지우기·짧은 링크 지우기는 됨) */`)와 `SHARE_SHORT?: string;`. `ACCOUNT_DATA_TABLES` 끝에 `'agent_inbox', 'agent_tokens'`.
- [ ] **Step 1: 실패하는 시험** — `agent-schema.test.ts`(`createSqliteD1` + `ensureSchema`): 버전 0·6에서 표 두 개와 색인 5개(`agent_tokens_hash`·`agent_tokens_user`·`agent_inbox_key`·`agent_inbox_user`·`agent_inbox_expires`)가 생기고 `schema_meta` 7, 두 번 돌려도 오류 없음, `SCHEMA_STATEMENTS`에 `ALTER` 없음. `deleteAccountData`가 두 표의 그 사용자 행만 지움.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `yarn vitest run tests/unit/server` PASS(버전 단언 셋 고친 뒤)
- [ ] **Step 5:** 커밋 `feat(agent-server): D1 스키마 7(AI 연결 토큰·받은함)`

### Task 8: 짧은 링크 넣기·지우기 꺼내기

**Files:**
- Modify: `src/server/share/handlers.ts`
- Test: `tests/unit/server/share-handlers.test.ts`(기존 통과 + 새 함수 사례)

**Interfaces:**
- Produces:
  ```ts
  export const SHARE_CREATE_FIELDS: { body: …; kind: …; keepUntil: …; deleteToken: … }; // createSchema에서 turnstile을 뺀 필드 객체
  export type ShareInsertInput = { body: string; kind: ShortLinkKind; keepUntil?: string; deleteHash: string };
  export type ShareInsertResult = { id: string; expiresAt: string; created: boolean };
  /** handleShareCreate의 저장 부분(같은 delete_hash면 처음 행, id 충돌 3번, shortExpiresAt). waitUntil 정리는 부른 쪽이 한다. */
  export async function insertShareLink(db: MeetDb, input: ShareInsertInput, now: Date): Promise<ShareInsertResult>;
  export async function deleteShareLink(db: MeetDb, id: string, deleteToken: string): Promise<'deleted' | 'forbidden' | 'not-found'>;
  ```
  `createSchema`는 `Schema.Struct({ ...SHARE_CREATE_FIELDS, turnstile: Schema.String })`로 바꾸고, `handleShareCreate`·`handleShareDelete`는 새 함수를 불러 지금과 같은 응답을 낸다.
- [ ] **Step 1:** 새 함수 사례(넣기·같은 삭제 해시 `created: false`·id 충돌 재시도·지우기 세 결과) 추가 → FAIL
- [ ] **Step 2:** 구현 → `yarn vitest run tests/unit/server/share-handlers.test.ts` 전부 PASS(기존 사례 변경 없음)
- [ ] **Step 3:** 커밋 `refactor(share): 짧은 링크 넣기·지우기를 함수로 꺼냄`

### Task 9: 토큰 발급·검사

**Files:**
- Create: `src/server/agent/tokens.ts`, `src/server/agent/auth.ts`
- Test: `tests/unit/server/agent-tokens.test.ts`

**Interfaces:**
- Consumes: `hashToken`·`hashIp`(`src/server/meet/tokens.ts`), `MeetDb`, `SyncContext`·`SyncDeps`, `SyncHttpError`, `devFakeEnabled`(`src/server/library-sync/auth.ts`), `parseAllowList`·`parseAccountList`(`@sch0718/firebase-session/worker`), `consumeCounter`·`counterKey`(`src/server/library-sync/limits.ts`), `isLocalRequest`.
- Produces:
  ```ts
  // tokens.ts
  export const AGENT_SCOPES = ['inbox:write', 'share:create'] as const;
  export type AgentScope = (typeof AGENT_SCOPES)[number];
  export const AGENT_TOKEN_PATTERN = /^lmk_[A-Za-z0-9_-]{43}$/;
  export const AGENT_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  export const AGENT_TOKEN_MAX_ACTIVE = 10;
  export const AGENT_TOKEN_TOUCH_MS = 60 * 60 * 1000;
  export const AGENT_LIMITS = { tokenCreate: 20, inbox: 50, share: 50, shareDelete: 200, whoami: 500, inboxRead: 2000, authFail: 300 } as const;
  export type AgentTokenRow = { id: string; name: string; scopes: AgentScope[]; createdAt: number; expiresAt: number; lastUsedAt: number | null; revokedAt: number | null };
  export function newAgentToken(deps: Pick<SyncDeps, 'random'>): string;            // 'lmk_' + base64url(32바이트)
  export function newAgentTokenId(deps: Pick<SyncDeps, 'random'>): string;          // 12자 a-z0-9
  /** 이름 1~40자(trim), scopes는 AGENT_SCOPES의 부분집합 1개 이상(중복 제거·정렬). 실패 422 invalid. */
  export function parseIssueBody(value: unknown): { name: string; scopes: AgentScope[] };
  /** 조건부 INSERT. 살아 있는 토큰이 10개면 SyncHttpError(409, 'too-many-tokens'). 원문은 돌려주기만 하고 두지 않는다. */
  export async function issueAgentToken(db: MeetDb, userId: string, input: { name: string; scopes: AgentScope[] }, deps: Pick<SyncDeps, 'random' | 'now'>): Promise<{ token: string; row: AgentTokenRow }>;
  export async function listAgentTokens(db: MeetDb, userId: string, now: number): Promise<AgentTokenRow[]>;  // 살아 있는 것 + 만료·철회 30일 안, 만든 순
  export async function revokeAgentToken(db: MeetDb, userId: string, id: string, now: number): Promise<boolean>;
  export async function pruneAgentTokens(db: MeetDb, userId: string, now: number): Promise<void>;          // 만료·철회 뒤 30일 지난 행
  // auth.ts
  export type AgentPrincipal = { userId: string; tokenId: string; tokenName: string; scopes: AgentScope[]; expiresAt: number; provider: 'google' | 'kakao' | 'naver' };
  export async function requireAgentToken(ctx: SyncContext, deps: SyncDeps, scope: AgentScope | null): Promise<AgentPrincipal>;
  ```
  발급 SQL(바인드 순서 그대로):
  ```sql
  INSERT INTO agent_tokens (id, user_id, token_hash, name, scopes, created_at, expires_at, last_used_at, revoked_at)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL
  WHERE (SELECT count(*) FROM agent_tokens WHERE user_id = ?2 AND revoked_at IS NULL AND expires_at > ?6) < ?8
  ```
  바뀐 행 0이면 409. 검사 SQL:
  ```sql
  SELECT t.id, t.user_id, t.name, t.scopes, t.expires_at, t.last_used_at, t.revoked_at, u.firebase_sub, u.email
  FROM agent_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?
  ```
  `requireAgentToken` 순서: `Authorization`이 `Bearer <AGENT_TOKEN_PATTERN>`이 아니거나 행이 없으면 실패 카운터(`counterKey('agent-auth-fail', await hashIp(ip, salt), now)`, `AGENT_LIMITS.authFail`, 넘으면 429) 후 `401 unauthorized` → `revoked_at` `401 token-revoked` → `expires_at <= now` `401 token-expired` → 허용 계정: `firebase_sub`가 `/^(kakao|naver):/i`면 `parseAccountList(env.ALLOWED_ACCOUNTS ?? (devFakeEnabled(ctx) ? 'kakao:dev-me,naver:dev-me' : undefined)).has(firebase_sub)`, 아니면 `parseAllowList(env.ALLOWED_EMAILS).has(email.toLowerCase())`, 실패 `403 not-allowed` → `scope`가 있고 `scopes`에 없으면 `403 scope` → `now - (last_used_at ?? 0) >= AGENT_TOKEN_TOUCH_MS`면 `UPDATE agent_tokens SET last_used_at = ? WHERE id = ?`. `salt`는 `env.IP_HASH_SALT ?? (isLocalRequest(request) ? 'dev-salt' : null)`(없으면 503 `config`). `provider`는 `firebase_sub` 접두(`kakao`·`naver`) 아니면 `google`.
- [ ] **Step 1: 실패하는 시험** — `agent-tokens.test.ts`(`createSyncMemoryServer().login()`으로 사용자 행을 만들고 `db`로 직접 부름): 발급 원문이 패턴과 맞고 D1에 원문 문자열이 어디에도 없음(`SELECT * FROM agent_tokens`를 `JSON.stringify`해 `not.toContain(token)`), 해시가 `hashToken(token)`. 10개 뒤 409, 9개에서 `Promise.all`로 두 발급 → 정확히 하나 409. 목록·철회(남의 것 false). 검사: 모양 틀림·없음 401(카운터 증가), 철회·만료 401 코드, `ALLOWED_ACCOUNTS`에서 빠진 카카오 사용자 403, Google 사용자 행(`users`에 직접 넣음, `email` 대문자)과 `ALLOWED_EMAILS` 소문자 → 통과·빠지면 403, 범위 403, 마지막 사용 시각이 1시간 안에는 다시 쓰지 않음, 실패 301번째 429.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(agent-server): AI 연결 토큰 발급·검사`

### Task 10: 받은함 저장소

**Files:**
- Create: `src/server/agent/inbox.ts`
- Test: `tests/unit/server/agent-inbox.test.ts`

**Interfaces:**
- Consumes: `readShareHash`·`AGENT_INBOX_LIMITS`·`AGENT_PLACE_LIMITS`(상대 경로 `../../domain/share/…`), `dayPoints`(`../../domain/share/check-share-trip`), `MeetDb`, `SyncHttpError`.
- Produces:
  ```ts
  export const INBOX_MAX_PENDING = 20;
  export const INBOX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  export const INBOX_PRUNE_MAX = 50;
  export type InboxBody = { v: 1; key: string; d: string };
  export type InboxMeta = { id: string; title: string; startDate: string; endDate: string; places: number; from: string | null; createdAt: number; expiresAt: number };
  export function parseInboxBody(value: unknown): InboxBody;                     // 422 invalid
  /** readShareHash(d, AGENT_INBOX_LIMITS) + v2 + agentDocProblem + legModes 실제 구간. 실패는 422 invalid + reason. */
  export async function checkInboxDoc(d: string): Promise<{ title: string; startDate: string; endDate: string; places: number }>;
  /** 설계 「API」 처리 순서 1~3. */
  export async function putInbox(db: MeetDb, p: { userId: string; tokenId: string }, body: InboxBody, meta: Awaited<ReturnType<typeof checkInboxDoc>>, id: string, now: number): Promise<{ id: string; expiresAt: number; created: boolean }>;
  export async function listInbox(db: MeetDb, userId: string, now: number): Promise<InboxMeta[]>;   // 만료 제외, 오래된 순, LEFT JOIN 토큰 이름
  export async function readInboxItem(db: MeetDb, userId: string, id: string, now: number): Promise<{ id: string; data: string } | null>;
  export async function deleteInboxItem(db: MeetDb, userId: string, id: string): Promise<boolean>;
  export async function pruneInbox(db: MeetDb, now: number): Promise<number>;     // 전체에서 만료 행 최대 50
  ```
  `putInbox` SQL:
  ```sql
  -- 1. 같은 key(만료 전)
  SELECT id, expires_at FROM agent_inbox WHERE user_id = ? AND request_key = ? AND expires_at > ?
  -- 2·3. 한 batch
  DELETE FROM agent_inbox WHERE user_id = ?1 AND request_key = ?2 AND expires_at <= ?3;
  INSERT INTO agent_inbox (id, user_id, token_id, request_key, data, title, start_date, end_date, places, created_at, expires_at)
  SELECT ?4, ?1, ?5, ?2, ?6, ?7, ?8, ?9, ?10, ?3, ?11
  WHERE (SELECT count(*) FROM agent_inbox WHERE user_id = ?1 AND expires_at > ?3) < 20;
  ```
  INSERT가 0행이거나 `UNIQUE constraint failed: agent_inbox` 오류면 1을 다시 해 있으면 `created: false`, 없으면 `SyncHttpError(409, 'inbox-full')`. 목록 제목은 `trips[0].title`(비면 `title`). `legModes` 검사: 키마다 `dayPoints(trip, d)`의 이웃 쌍 중 하나여야 한다(reason `leg-modes`).
- [ ] **Step 1: 실패하는 시험** — `agent-inbox.test.ts`: `encodeShareHash(hashDoc(doc))`로 만든 정상 `d` → 201 값, 같은 `key` → `created: false`(20개 찬 뒤에도), 만료된 같은 `key`(시각을 31일 뒤로) → 새로 만듦, 19개에서 같은 `key` 두 `putInbox`를 `Promise.all` → 둘 다 같은 id, 서로 다른 `key` 두 개 → 하나 409, v1 문서 `not-trip`, 제목 61자 `title`, 이름 101자·21자리 sid `place-too-long`, 실제 구간 아닌 `legModes` 6,700개(설계 시험 사례) `leg-modes`, 풀린 크기 1MB 넘음 `corrupt`, 목록 만료 제외·`from`(토큰 이름, 토큰 행 지우면 null), 남의 항목 읽기·지우기 불가, `pruneInbox` 50개 상한.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(agent-server): 받은함 넣기·목록·지우기와 원자적 한도`

### Task 11: 경로 — 토큰 API와 동기화 API

**Files:**
- Create: `src/server/agent/router.ts`, `src/server/agent/sync-routes.ts`, `functions/api/agent/[[path]].ts`
- Modify: `src/server/library-sync/router.ts`(`...AGENT_SYNC_ROUTES`를 `...BACKUP_ROUTES` 다음), `tests/helpers/sync-memory-server.ts`
- Test: `tests/unit/server/agent-router.test.ts`, `tests/unit/server/agent-sync-routes.test.ts`, `tests/unit/server/functions.test.ts`(진입점 한 사례)

**Interfaces:**
- Consumes: Task 7~10, `readLimitedJson`·`SHARE_REQUEST_MAX_BYTES`·`insertShareLink`·`deleteShareLink`·`SHARE_CREATE_FIELDS`·`pruneExpiredShares`(`../share/handlers`), `ApiError`(`../http`), `ensureSchema`, `syncJson`·`syncError`·`SyncHttpError`, `requireBackupUser`(`../library-sync/backup`), `SyncRoute`, `productionDeps`.
- Produces:
  ```ts
  // router.ts
  export type AgentRoute = { method: 'GET' | 'POST' | 'DELETE'; path: RegExp; pattern: string; scope: AgentScope | null; allowWhenOff?: true;
    run(ctx: SyncContext, deps: SyncDeps, who: AgentPrincipal, params: string[]): Promise<Response> };
  export const AGENT_ROUTES: AgentRoute[];
  export async function handleAgent(ctx: SyncContext, deps: SyncDeps): Promise<Response>;
  // sync-routes.ts
  export const AGENT_SYNC_ROUTES: SyncRoute[];
  // functions/api/agent/[[path]].ts
  export const onRequest = (ctx: SyncContext) => handleAgent(ctx, deps);   // deps = productionDeps()
  // tests/helpers/sync-memory-server.ts 반환에 더함
  agentFetch: typeof globalThis.fetch;   // Origin을 넣지 않고 handleAgent로 보냄
  env: SyncEnv;                          // 시험이 AGENT_API 등을 바꿀 수 있게
  ```
  `handleAgent` 순서: 경로(`/api/agent` 뗀 값) 고르기(없으면 404 `not-found`, 메서드 다름 405) → `Origin` 헤더 있으면 403 `origin` → `DB` 없으면 503 `config` → `ensureSchema` → `AGENT_API === 'off' && !route.allowWhenOff`면 503 `off` → `requireAgentToken(ctx, deps, route.scope)` → `run`. `catch`: `ApiError` `TOO_LARGE` → `syncJson(413, { error: 'too-large' })`, `BAD_REQUEST` → 400 `bad-json`, 그 밖 `syncError(e) ?? syncJson(500, { error: 'internal' })`. 끝에 `deps.log(JSON.stringify({ method, path: pattern, status, ms }))`만(토큰·본문 없음).
  토큰 경로(`AGENT_ROUTES`, 하루 한도 넘으면 429 `rate-limited`):
  | 메서드·경로 | scope | 한도 키 | 하는 일 |
  |---|---|---|---|
  | `GET /v1/whoami` | null | `agent-whoami` | `200 { name, scopes, expiresAt, provider }` |
  | `POST /v1/inbox` | `inbox:write` | `agent-inbox` | `readLimitedJson` → `parseInboxBody` → `checkInboxDoc` → `putInbox`(id는 16자 base64url) → 201/200, `waitUntil(pruneInbox)` |
  | `POST /v1/share` | `share:create` | `agent-share` | `SHARE_SHORT === 'off'`면 503 `off` → `Schema.Struct(SHARE_CREATE_FIELDS)` 검사(`kind`는 `'trip'`만) → `insertShareLink(db, { …, deleteHash: await hashToken(deleteToken) }, new Date(now))` → 201/200, `waitUntil(pruneExpiredShares)` |
  | `DELETE /v1/share/:id` | `share:create` | `agent-share-delete` | `allowWhenOff`. `X-Delete-Token`이 43자 base64url이 아니면 400 `bad-json`. `deleteShareLink` → 204 / 403 `delete-token` / 404 `{ error: 'not-found' }`(CLI가 이 본문일 때만 로컬 항목을 지운다) |
  동기화 경로(`AGENT_SYNC_ROUTES`, 모두 `requireBackupUser(ctx, deps)`로 사용자 확인 — `X-Landmark-Backup-User` 머리글이 있으면 세션 사용자와 대조):
  | 메서드·경로 | `allowWhenOff` | 하는 일 |
  |---|---|---|
  | `GET /v1/agent/tokens` | 예 | `{ enabled: AGENT_API !== 'off', canCreate: enabled && LIBRARY_SYNC !== 'off', maxActive: 10, tokens }` |
  | `POST /v1/agent/tokens` | 아니오 | `AGENT_API === 'off'`면 503 `off` → `agent-token-create` 한도 → `issueAgentToken` → `201 { token, id, name, scopes, expiresAt }`, `waitUntil(pruneAgentTokens)` |
  | `DELETE /v1/agent/tokens/:id` | 예 | `revokeAgentToken` → 204 / 404 |
  | `GET /v1/agent/inbox` | 예 | `agent-inbox-read` 한도 → `{ items }`, `waitUntil(pruneInbox)` |
  | `GET /v1/agent/inbox/:id` | 예 | 같은 한도 → `{ id, data }` / 404 |
  | `DELETE /v1/agent/inbox/:id` | 예 | 204 / 404 |
- [ ] **Step 1: 실패하는 시험**
  - `agent-router.test.ts`(메모리 서버 `login()` → 세션으로 `POST /api/sync/v1/agent/tokens` 발급 → `agentFetch`): whoami 200, `Origin` 있으면 403, 토큰 없음 401, `AGENT_API=off`면 whoami·inbox·share 503이고 share 지우기는 됨, `SHARE_SHORT=off` share 503, 본문 40,001바이트 413 `too-large`, JSON 아님 400 `bad-json`, inbox 정상 201·같은 `key` 200·하루 51번째 429(카운터를 미리 채움), share 201 → 응답 id로 `/s/<id>`(`handleShareOpen`)가 여는 쪽 HTML 200, 같은 삭제 토큰 재시도 같은 id, share 지우기 204·틀린 토큰 403·없음 404, 남의 토큰으로 만든 링크도 삭제 토큰이 맞으면 지워짐, `deps.log`로 모은 줄에 토큰·삭제 토큰·`d` 문자열 없음.
  - `agent-sync-routes.test.ts`: 발급 응답 원문 한 번(목록에는 `token` 키 없음), `LIBRARY_SYNC=off`면 발급 503·목록·철회 200/204·`canCreate: false`, `AGENT_API=off`면 `enabled: false`·발급 503, 받은함 목록·항목·지우기, 다른 사용자 세션으로는 404, `X-Landmark-Backup-User`가 다르면 거절(백업과 같은 코드), `DELETE /v1/account` 뒤 토큰 401.
  - `functions.test.ts`: `functions/api/agent/[[path]]`의 `onRequest`가 `DB` 없는 env에 503 `config`.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `yarn vitest run tests/unit/server` PASS
- [ ] **Step 5:** 커밋 `feat(agent-server): /api/agent/v1 토큰 경로와 동기화 AI 연결 경로`

### Task 12: CLI `send`·`share`·`whoami`·`unshare`

**Files:**
- Create: `pipeline/agent-trip/client.ts`, `pipeline/agent-trip/token.ts`, `pipeline/agent-trip/share-store.ts`
- Modify: `pipeline/cli/trip.ts`, `pipeline/agent-trip/output.ts`
- Test: `tests/unit/pipeline/agent-trip/token.test.ts`, `tests/unit/pipeline/agent-trip/share-store.test.ts`, `tests/unit/pipeline/agent-trip/cli-remote.test.ts`

**Interfaces:**
- Consumes: `runBuild`·`pickApp`, `encryptShareHash`·`newDeleteToken`(`src/services/share-short/crypto.ts`), `shortKeepUntil`(`src/domain/share/short-link.ts`), 메모리 서버 `agentFetch`.
- Produces:
  ```ts
  // token.ts
  export type TokenDeps = { env: NodeJS.ProcessEnv; platform: NodeJS.Platform; execFile(cmd: string, args: string[]): Promise<{ stdout: string }> };
  /** LANDMARK_AGENT_TOKEN → (darwin) `security find-generic-password -s landmark-agent-token -a <host> -w`. 패턴이 아니면 null. 값을 로그에 쓰지 않는다. */
  export async function findToken(app: string, deps: TokenDeps): Promise<string | null>;
  // client.ts
  export type AgentClientDeps = { fetch: typeof fetch; timeoutMs?: number /* 15_000 */ };
  export type AgentReply<T> = { ok: true; status: number; data: T } | { ok: false; issue: TripIssue };
  export function createAgentClient(app: string, token: string, deps: AgentClientDeps): {
    whoami(): Promise<AgentReply<{ name: string; scopes: string[]; expiresAt: number; provider: string }>>;
    sendInbox(body: { v: 1; key: string; d: string }): Promise<AgentReply<{ id: string; expiresAt: number; created: boolean }>>;
    createShare(body: { body: string; kind: 'trip'; keepUntil?: string; deleteToken: string }): Promise<AgentReply<{ id: string; expiresAt: string; created: boolean }>>;
    deleteShare(id: string, deleteToken: string): Promise<AgentReply<null>>;
  };
  /** 상태·`error` 코드 → TripIssue(설계 「오류·장애」 CLI 열). 404인데 JSON `error`가 없으면 'old-server'. */
  export function toIssue(status: number, body: unknown): TripIssue;
  /** 키 정렬한 plan JSON + includeMemo의 SHA-256 base64url(43자). */
  export async function requestKey(plan: TripPlan, includeMemo: boolean): Promise<string>;
  // share-store.ts
  export type StoredShare = { app: string; id: string; deleteToken: string; title: string; createdAt: string; expiresAt: string };
  export type StoreDeps = { home: string /* LANDMARK_TRIP_HOME ?? os.homedir()/.landmark */; now(): Date };
  export async function readShares(deps: StoreDeps): Promise<StoredShare[]>;     // 만료 뺌, 파일 없으면 [], 해석 실패면 share-store 오류(파일은 그대로)
  export const SHARE_STORE_MAX = 200;
  /** 잠금 안에서 읽기·고치기·바꾸기. 잠금은 `<home>/agent-shares.lock`을 `open(…, 'wx')`로 만들고 50ms 간격 5초까지 다시 시도, mtime 30초 넘은 잠금은 지우고 다시. 끝나면 지운다. */
  export async function withShareStore<T>(deps: StoreDeps, edit: (items: StoredShare[]) => { items: StoredShare[]; result: T }): Promise<T>;
  /** 잠금 안에서 만료 안 된 항목 + 예약 수가 200 미만이면 예약 항목(`{ id: 'pending:<무작위>', deleteToken: '', … }`)을 넣고 그 예약 id를 돌려준다. 200이면 null. */
  export async function reserveShare(deps: StoreDeps, title: string): Promise<string | null>;
  /** 예약을 실제 항목으로 바꾸거나(서버 성공) 지운다(서버 실패). 예약 항목은 5분 뒤 만료된 것으로 본다. */
  export async function settleShare(deps: StoreDeps, reservation: string, item: StoredShare | null): Promise<void>;
  export async function addShare(item: StoredShare, deps: StoreDeps): Promise<void>; // 폴더 0o700, 임시 파일 0o600 → rename
  export async function removeShare(app: string, id: string, deps: StoreDeps): Promise<void>;
  ```
  명령(설계 「CLI」):
  - `send <plan.json> [--no-memo] [--no-routes] [--app] [--json]`: `pickApp(…, true)` → `findToken`(없으면 `no-token`, 끝 코드 4) → `runBuild({ includeMemo: !noMemo })` → `sendInbox({ v: 1, key: await requestKey(plan, includeMemo), d: doc.importHash })` → 출력 `inbox: { id, expiresAt(ISO), created }`.
  - `share <plan.json> [--memo] [--no-routes] [--app] [--json]`: `runBuild` → `reserveShare`가 null이면 `share-store-full`(2, 서버 안 부름) → `encryptShareHash(doc.viewHash)` → `deleteToken = newDeleteToken()` → `createShare({ body, kind: 'trip', keepUntil: shortKeepUntil([plan.endDate]) ?? undefined, deleteToken })` → 성공이면 `settleShare(…, item)`, 서버 실패면 `settleShare(…, null)`(파일 쓰기 실패는 경고 `share-store` "이 링크는 기한까지 지울 수 없어요") → 출력 `links: { short: \`${app}/s/${id}#k=${key}\`, view }`, `expiresAt`. 삭제 토큰은 출력하지 않는다.
  - `whoami [--app] [--json]`: 이름·범위·만료(14일 이하면 경고 `token-expired` 아닌 경고 문구 "N일 뒤 만료돼요")·공급자.
  - `unshare <id> [--app] [--json]`: `readShares`에서 같은 `app`·`id`(없으면 `unknown-share`, 2) → `deleteShare` → 204, 또는 404이면서 JSON 본문 `{ error: 'not-found' }`일 때만 `removeShare`. JSON이 아니거나 `error`가 다른 404는 `old-server`(5)이고 항목을 남긴다. 403은 남기고 4. `unshare --list`: 같은 `app`의 `id`·`title`·`expiresAt`(삭제 토큰 없이).
- [ ] **Step 1: 실패하는 시험**
  - `token.test.ts`: 환경변수 우선, darwin에서 `execFile`이 받은 인자가 `['find-generic-password', '-s', 'landmark-agent-token', '-a', 'landmark.sch0718.dev', '-w']`, 다른 플랫폼은 키체인을 부르지 않음, 패턴 아닌 값 null, `execFile` 실패 null.
  - `share-store.test.ts`(`mkdtemp` 폴더): 추가 뒤 파일 권한 `0o600`·폴더 `0o700`(`stat().mode & 0o777`), 만료 항목은 읽을 때 빠짐, 만료 안 된 200개면 `reserveShare` null·199개면 예약 id, 199개에서 `reserveShare` 두 개를 `Promise.all` → 하나만 예약, 예약 5분 지나면 빈자리, `addShare` 10개를 `Promise.all`로 돌려도 10개 모두 남음, `addShare`·`removeShare` 동시 실행, 31초 된 잠금 파일은 지우고 진행, 깨진 JSON은 파일 없음과 구별해 `readShares`·`addShare`가 `TripFailure`(`share-store`, 끝 코드 1)로 멈추고 원본 바이트를 그대로 둠(덮어쓰지 않음 — 그 안의 삭제 토큰을 손으로 살릴 수 있게).
  - `cli-remote.test.ts`(메모리 서버 + `agentFetch`, 토큰은 시험 안에서 발급해 `env.LANDMARK_AGENT_TOKEN`으로): `send` 0·받은함 목록에 1개, 같은 계획 다시 `send` → `created: false`, `--no-memo`면 다른 `key`, `share` 0 → 출력 `links.short`가 `/s/<16자>#k=<22자>`, 파일에 삭제 토큰, `unshare --list`에 그 id, `unshare <id>` 0 → `/s/<id>` 404·파일에서 빠짐, 다시 `unshare` → `unknown-share` 2, 가짜 `fetch`가 HTML 404를 주면 `old-server` 5이고 파일 항목이 남음, 만료 안 된 200개를 미리 채우면 `share-store-full` 2이고 서버를 부르지 않음, `whoami` 0, 토큰 없음 4, 철회한 토큰 4(`token-revoked`), `AGENT_API=off`면 `send` 5, 응답 지연(가짜 `fetch`가 끝나지 않음, 가짜 타이머 15초) → `timeout` 5, `--app https://evil.example` → `app-origin` 2이고 `fetch`가 불리지 않음. **모든 사례에서 표준 출력·오류 합친 문자열에 토큰·삭제 토큰이 없다.**
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(agent-trip): yarn trip send·share·whoami·unshare`

### Task 13: ② 로컬 확인과 마무리

- [ ] **Step 1: 로컬 실행**(포트가 막히면 건너뛰고 보고) — `SYNC_VITE_PORT=4198 SYNC_DEV_PORT=8798 yarn dev:sync`를 백그라운드로 띄운다. Node 한 줄 스크립트(`tests/helpers/sync-memory-server.ts`의 `login()`과 같은 순서를 `http://localhost:8798`에 대고)로 세션을 만들고 `POST /api/sync/v1/agent/tokens`로 토큰을 받아 **변수에만** 둔다 → `LANDMARK_AGENT_TOKEN=$TOKEN yarn trip whoami --app http://localhost:8798` → `… send tests/fixtures/agent-trip/plan.json --no-routes --app http://localhost:8798 --json` → `… share …` → `curl -s -o /dev/null -w '%{http_code}' 'http://localhost:8798/s/<id>'` 200 → `… unshare <id>`. 세션·토큰은 출력·파일에 남기지 않는다. 띄운 프로세스는 PID로 끈다.
- [ ] **Step 2: ② 전체 검증** — Global Constraints의 전체 검증 명령.
- [ ] **Step 3:** 커밋(바뀐 것이 있으면) `test(agent-server): 로컬 확인 보완`

---

# PR ③ 앱 AI 연결·받은함

### Task 14: 앱 API와 기기 키

**Files:**
- Create: `src/services/agent-inbox/api.ts`, `src/services/agent-inbox/storage.ts`
- Test: `tests/unit/services/agent-inbox-api.test.ts`, `tests/unit/services/agent-inbox-storage.test.ts`

**Interfaces:**
- Consumes: `getSharedSyncApi`·`getSharedSyncStorage`(`src/services/library-sync/shared-api.ts`), `readSyncMeta`·`readSession`(`src/services/library-sync/storage.ts`), `SyncApi`, `toBackupFailure`(`src/services/server-backup/api.ts` — 실패 해석을 그대로 쓴다).
- Produces:
  ```ts
  // api.ts
  export type AgentFailure = 'auth' | 'not-allowed' | 'offline' | 'off' | 'limit' | 'too-many' | 'not-found' | 'invalid' | 'server';
  export type AgentResult<T> = { ok: true; data: T } | { ok: false; reason: AgentFailure };
  export type AgentTokenView = { id: string; name: string; scopes: ('inbox:write' | 'share:create')[]; createdAt: number; expiresAt: number; lastUsedAt: number | null; revokedAt: number | null };
  export type InboxItemView = { id: string; title: string; startDate: string; endDate: string; places: number; from: string | null; createdAt: number; expiresAt: number };
  export type AgentApi = {
    owner: string | null;   // 만들 때의 readSyncMeta().userId
    tokens(): Promise<AgentResult<{ enabled: boolean; canCreate: boolean; maxActive: number; tokens: AgentTokenView[] }>>;
    issue(input: { name: string; scopes: AgentTokenView['scopes'] }): Promise<AgentResult<{ token: string; id: string; name: string; scopes: AgentTokenView['scopes']; expiresAt: number }>>;
    revoke(id: string): Promise<AgentResult<null>>;
    inbox(): Promise<AgentResult<{ items: InboxItemView[] }>>;
    item(id: string): Promise<AgentResult<{ id: string; data: string }>>;
    discard(id: string): Promise<AgentResult<null>>;
  };
  /** 서버 백업 `createBackupApi`처럼 요청마다 `X-Landmark-Backup-User: owner`를 붙인다. 설정이 없으면 null. */
  export function createAgentApi(api?: Pick<SyncApi, 'client'> | null): AgentApi | null;
  /** 지금 로그인 사용자가 owner와 같고 저장된 세션이 있는가. */
  export function sameOwner(owner: string | null): boolean;
  // storage.ts (런타임 import 없음)
  export const AGENT_INBOX_KEY = 'tripmap:agent-inbox:v1';
  export type AgentInboxLocal = { v: 1; userId: string | null; notified: string[] };
  export function readAgentInboxLocal(storage: Storage, userId: string | null): AgentInboxLocal;  // 다른 사용자·깨진 값 → 빈 기록
  export function writeAgentInboxLocal(storage: Storage, value: AgentInboxLocal): void;           // notified 최대 100(뒤쪽 유지)
  ```
  실패 해석: `toBackupFailure` 결과에서 `changed` → `server`, `too-large` → `invalid`, 그리고 `issue()`의 실패가 `{ kind: 'server', status: 409 }`이면 `too-many`로 본다. 패키지 클라이언트는 `mapStatus`가 처리하지 않는 409의 `error` 코드를 버리지만(`src/services/library-sync/api.ts`의 `mapStatus`는 `busy`만 안다), 발급 경로가 내는 409는 `too-many-tokens`뿐이라 상태로 구별해도 된다. 시험은 가짜 `send`가 아니라 실제 `createSyncApi`(가짜 `fetch`가 409 `{ error: 'too-many-tokens' }`)를 거쳐 `too-many`가 나오는지 본다.
- [ ] **Step 1: 실패하는 시험** — 가짜 `client.send`로 경로·메서드·머리글·실패 해석 표(401 auth, 403 not-allowed, 503 off, 429 limit, 409 too-many-tokens → too-many, 404 not-found). 기기 키 읽기·쓰기·다른 사용자·100개.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(agent-app): AI 연결·받은함 앱 API와 기기 키`

### Task 15: 받은함 실행기와 부트

**Files:**
- Create: `src/services/agent-inbox/inbox-check.ts`, `src/services/agent-inbox/boot.ts`, `src/sections/agent/use-agent-inbox-boot.ts`, `src/stores/agent-inbox.ts`
- Modify: `src/sections/shell/ShellRoute.tsx`(`useAutoBackupBoot();` 다음 줄 `useAgentInboxBoot();`)
- Test: `tests/unit/services/agent-inbox-check.test.ts`, `tests/unit/sections/agent/use-agent-inbox-boot.test.tsx`

**Interfaces:**
- Consumes: Task 14, `loadSyncEngine`·`readBootFlag`(`src/services/library-sync/boot.ts`), `syncStatusAtom`(`src/stores/sync-status.ts`), `lazyChunk`, `sonner`의 `toast`.
- Produces:
  ```ts
  // boot.ts (첫 로딩, 런타임 import는 lazy-chunk만)
  export const loadAgentInbox: () => Promise<typeof import('src/services/agent-inbox/inbox-check')>;
  // loadAgentInboxDialog는 Task 17, loadAgentSection은 Task 18에서 대상 파일을 만들 때 이 파일에 더한다(없는 모듈을 import하면 이 과제의 typecheck가 깨진다).
  // inbox-check.ts (조각 agent-inbox)
  export const INBOX_CHECK_GAP_MS = 10 * 60 * 1000;
  export type InboxCheckDeps = { api(): AgentApi | null; storage: Storage; now(): number; notify(count: number): void; session(): string | null; schedule(): void };
  /** 한 번 확인. 새 id가 있으면 notify(전체 개수). 401·403이면 'paused'. */
  export async function checkInboxOnce(deps: InboxCheckDeps): Promise<'ok' | 'paused' | 'failed'>;
  /** engine.onRunFinished에 붙인다. 첫 synced에 바로, 그 뒤 10분 간격. 멈춘 세션 id와 지금 세션 id가 다르면 다시 시작. */
  export function attachInboxCheck(engine: { onRunFinished(l: (s: { phase: string }) => void): () => void }, deps: InboxCheckDeps, current: () => { phase: string }): () => void;
  /** 한 번만 붙인다(이미 붙었으면 아무것도 안 함). */
  export async function startInboxCheck(): Promise<void>;
  /** 받은함 창·SharePreview가 부른다. */
  export async function discardInboxItem(id: string, owner: string | null): Promise<boolean>;
  export function openInboxDialog(): void;   // 알림 `보기`가 부름(창 상태 atom을 켬)
  // use-agent-inbox-boot.ts
  export function useAgentInboxBoot(): void;
  ```
  - 훅: 마운트 때 `readBootFlag()`면 `loadAgentInbox().then(m => m.startInboxCheck())`. 아니면 `store.sub(syncStatusAtom, …)`로 `phase`가 처음 `synced`가 될 때 같은 일을 하고 구독을 푼다.
  - `startInboxCheck`: `createAgentApi()`가 null이면 끝. `loadSyncEngine()` → `ensureLibrarySyncEngine()` → `attachInboxCheck(engine, deps, () => store의 syncStatus)`. `notify(n)`은 `toast(\`AI가 보낸 일정 ${n}개\`, { action: { label: '보기', onClick: openInboxDialog } })`. `schedule`은 `engine.schedule('manual')`.
  - `paused`가 되면 그때의 `session()`(`readSession(getSharedSyncStorage())?.sessionId ?? null`)을 기억하고 `schedule()`을 한 번 부른다. 이후 실행 끝에서 `session()`이 달라졌으면 멈춤을 풀고 바로 확인한다.
  - 응답을 받은 뒤 `sameOwner(api.owner)`가 거짓이면 결과를 버린다.
  - **계정 전환**: 실행기는 `AgentApi`를 고정해 두지 않는다. 실행이 끝날 때마다 `readSyncMeta(getSharedSyncStorage()).userId`를 보고 지난번 사용자와 다르면 `createAgentApi()`로 새로 만들고, 마지막 확인 시각·멈춤 상태·알린 기록(기기 키는 `readAgentInboxLocal`이 사용자별로 비움)을 처음으로 돌린 뒤 바로 확인한다. `InboxCheckDeps.api`는 `api(): AgentApi | null`(함수)로 둔다.
  - 받은함 창 열림 상태는 `src/stores/agent-inbox.ts`(새, 작은 atom `agentInboxOpenAtom`)에 둔다. `AgentInboxDialog`는 이 atom을 보는 호스트(`src/sections/agent/AgentInboxHost.tsx`, Task 17에서 만듦, `ShellRoute`의 `LibraryShell`에 `<AgentInboxHost />`로 둠 — 열릴 때만 `lazy(() => loadAgentInboxDialog().then((m) => ({ default: m.AgentInboxDialog })))`, `src/routes/lazy-routes.ts`의 `SharePreview`와 같은 방식)로 연다. **atom 파일 `src/stores/agent-inbox.ts`(`export const agentInboxOpenAtom = atom(false)`)는 이 과제(Task 15)에서 만든다.** `openInboxDialog()`는 `getDefaultStore().set(agentInboxOpenAtom, true)`.
- [ ] **Step 1: 실패하는 시험** — `agent-inbox-check.test.ts`: 첫 synced에 확인, 10분 안 두 번째 실행은 건너뜀, 10분 뒤 다시, 새 id만 알림(알린 기록은 기기 키), 다른 사용자면 기록 비움, 오프라인·5xx 조용히 `failed`, 401 → `paused` + `schedule` 한 번 + 이후 같은 세션이면 확인 안 함 + 세션 id 바뀌면 재개, 응답 사이 계정이 바뀌면 알림 없음, 같은 페이지에서 A → B 계정 전환 뒤 다음 실행에서 새 API(머리글 `X-Landmark-Backup-User: B`)로 B의 받은함을 확인해 B 알림이 뜸. `use-agent-inbox-boot.test.tsx`: 동기화 꺼짐이면 `loadAgentInbox`를 부르지 않음, 같은 렌더에서 `syncStatusAtom`이 `synced`가 되면 한 번 부름.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(agent-app): 동기화 뒤 받은함 확인과 알림`

### Task 16: 받은함 미리보기와 가져오기

**Files:**
- Modify: `src/stores/add-place.ts`, `src/sections/add-place/AddPlaceHost.tsx`, `src/sections/share-import/SharePreview.tsx`
- Test: `tests/unit/sections/share-import/share-preview-inbox.test.tsx`(새), 기존 `SharePreview` 시험 통과

**Interfaces:**
- Produces:
  ```ts
  // add-place.ts
  export type InboxRef = { id: string; from: string | null; owner: string | null };
  | { step: 'share'; doc: ShareDoc; inbox?: InboxRef }
  // AddPlaceHost.tsx StepView
  case 'share': return <SharePreview doc={flow.doc} inbox={flow.inbox} />;
  // SharePreview
  export function SharePreview({ doc, inbox }: { doc: ShareDoc; inbox?: InboxRef }): JSX.Element;
  ```
  - `inbox`가 있으면 머리에 `Typography`: `AI 연결 「{from ?? '이름 없는 연결'}」이 보낸 일정`.
  - 가져오기 직전: `inbox`가 있고 `!(await loadAgentInbox()).sameOwnerNow(inbox.owner)`면 흐름을 닫고 `toast('로그인한 계정이 바뀌어 받은 일정을 닫았어요')`, 가져오지 않는다. (`sameOwnerNow`는 `inbox-check.ts`가 `sameOwner`를 다시 내보낸 것 — Task 15 파일에 `export { sameOwner as sameOwnerNow } from './api'`를 더한다.)
  - 가져오기 결과 `ok`이고 `tripDoc !== null`(여행째)이면 `loadAgentInbox().then(m => m.discardInboxItem(inbox.id, inbox.owner))` → 거짓이면 `toast('받은함에서 지우지 못했어요')`. 여행 스위치를 끈 채 가져오면 `toast('받은 일정은 받은함에 남겨 둘게요. 다 쓰셨으면 버려 주세요')`.
  - `SharePreview`는 `inbox-check`를 정적으로 가져오지 않는다(`loadAgentInbox`만).
- [ ] **Step 1: 실패하는 시험** — 실제 `AddPlaceHost`를 렌더하고 `addFlowAtom`에 `{ step: 'share', doc, inbox }`를 넣는다(`vi.mock('src/services/agent-inbox/boot', …)`로 `loadAgentInbox`를 가짜로): 머리 문구, 여행째 가져오기 → `discardInboxItem(id, owner)` 한 번, 스위치 끄고 장소만 → 부르지 않음 + 남김 알림, 지우기 실패 알림, 계정이 바뀐 상태 → 가져오지 않음(보관함 그대로) + 알림. `inbox` 없는 기존 흐름은 `loadAgentInbox`를 부르지 않음.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `yarn vitest run tests/unit/sections/share-import tests/unit/sections/add-place` PASS
- [ ] **Step 5:** 커밋 `feat(agent-app): 받은 일정을 공유 가져오기 화면으로 미리보기`

### Task 17: 받은함 창

**Files:**
- Create: `src/sections/agent/AgentInboxDialog.tsx`, `src/sections/agent/AgentInboxHost.tsx`, `src/sections/agent/agent-copy.ts`
- Modify: `src/sections/shell/ShellRoute.tsx`(`<AgentInboxHost />`)
- Test: `tests/unit/sections/agent/agent-inbox-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 14·15·16, `readShareHash`, `SHARE_READ_MESSAGES`, `addFlowAtom`, `readSyncMeta`.
- Produces: `src/services/agent-inbox/boot.ts`에 `export const loadAgentInboxDialog = lazyChunk(() => import('src/sections/agent/AgentInboxDialog'));` 추가, `export function AgentInboxDialog({ open, onClose }: { open: boolean; onClose(): void }): JSX.Element`, `agent-copy.ts`의 `inboxLine(item, now): string`(`{제목} · 11월 20일~21일 · 장소 5곳`), `fromLine(item, now): string`(`{연결 이름} · 오늘 오후 3:12`), `scopeLabel(scopes)`(`받은함·짧은 링크`), `expiryLabel(expiresAt, now)`(`만료 1월 30일(90일 남음)`).
  - 열 때 `api.inbox()`(받는 중 표시) → 줄마다 `미리보기`·`버리기`. 응답 뒤 `sameOwner` 거짓이면 닫는다. 동기화 기록 키가 `storage` 이벤트로 바뀌면 닫는다.
  - `미리보기`: `api.item(id)` → `readShareHash(data)` → `ok`이면 창을 닫고 `setFlow({ step: 'share', doc, inbox: { id, from, owner: api.owner } })`, 아니면 그 줄에 `SHARE_READ_MESSAGES[error]`를 보이고 `버리기`만 남긴다.
  - `버리기`: 확인 대화상자 "이 일정을 버릴까요? 되살릴 수 없어요" → `api.discard(id)` → 목록에서 뺀다.
  - 빈 목록 "받은 일정이 없어요".
- [ ] **Step 1: 실패하는 시험** — 가짜 `AgentApi`로 줄 문구, 미리보기 성공(흐름 값), 읽기 실패 문구, 버리기 확인·취소, 빈 목록, 계정이 바뀌면 닫힘.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(agent-app): AI가 보낸 일정 창`

### Task 18: 설정 › 동기화 › AI 연결

**Files:**
- Create: `src/sections/agent/AgentSection.tsx`, `src/sections/agent/AgentTokenDialog.tsx`
- Modify: `src/sections/settings/SettingsPage.tsx`(`동기화` 절 안 `SyncSection`의 `Suspense` 다음에 `const AgentSection = lazy(() => loadAgentSection().then((m) => ({ default: m.AgentSection })))`를 `Suspense`로), `package.json`(`build:ci`의 `--require-lazy firebaseImpl` 다음에 `--require-lazy AgentSection --require-lazy AgentInboxDialog --require-lazy inbox-check`)
- Test: `tests/unit/sections/agent/agent-section.test.tsx`

**Interfaces:**
- Produces: `src/services/agent-inbox/boot.ts`에 `export const loadAgentSection = lazyChunk(() => import('src/sections/agent/AgentSection'));` 추가, `export function AgentSection(): JSX.Element | null`, `export function AgentTokenDialog({ open, onClose, onIssued }: …)`.
  - 보이는 조건: `readSyncMeta(getSharedSyncStorage()).userId !== null && readSession(getSharedSyncStorage()) !== null`. 아니면 `null`. 같은 페이지의 로그인·로그아웃·연결 해제를 반영하려고 `ServerBackupSection.tsx`처럼 `useAtomValue(syncStatusAtom)`을 구독해 다시 그리고, 다른 탭의 변경은 `storage` 이벤트(`tripmap:sync:v1`·`tripmap:sync-session:v1`)로 다시 그린다. 사용자 id가 바뀌면 목록·받은함 개수를 다시 읽는다.
  - 설명 문구 설계 「설정 › 동기화 › AI 연결」 그대로. 목록 줄 `{이름} · {scopeLabel} · {expiryLabel} · 마지막 사용 {날짜|없음}` + `철회`(확인 뒤 `api.revoke`). 만료·철회 줄은 `color: var(--tm-text-secondary)`와 `철회됨`·`만료됨`.
  - `새 연결 만들기`: `canCreate`가 거짓이면 꺼짐 + 문구(`enabled` 거짓: "지금은 AI 연결을 쓸 수 없어요", 아니면 "동기화가 꺼져 있어 새 연결을 만들 수 없어요"), 살아 있는 토큰 10개면 꺼짐 + "연결은 10개까지예요. 쓰지 않는 연결을 철회해 주세요".
  - 만들기 창: 이름(기본 `Claude Code`, 1~40자), 권한 체크 둘(기본 둘 다, 둘 다 끄면 `만들기` 꺼짐) → `api.issue` → 같은 창에서 원문을 읽기 전용 칸에 보이고 `복사`(`navigator.clipboard.writeText`), 명령 예 `security add-generic-password -U -s landmark-agent-token -a {location.host} -w`, 안내 "이 창을 닫으면 다시 볼 수 없어요. 잃어버리면 철회하고 새로 만드세요". 원문은 컴포넌트 상태에만, 닫을 때 지운다. 저장소·로그에 쓰지 않는다.
  - `받은 일정 N개 · 보기`(`api.inbox()` 개수, 0이면 `받은 일정 없음`) → `openInboxDialog()`.
- [ ] **Step 1: 실패하는 시험** — 로그인 없으면 렌더 없음, 같은 렌더에서 동기화 기록·세션을 쓰고 `syncStatusAtom`을 바꾸면 구역이 나타남(로그아웃이면 사라짐), 목록 문구, 철회 확인, 만들기 창(기본값·권한 둘 끄면 꺼짐·원문 한 번 표시·닫으면 다시 열어도 없음·`localStorage`에 원문 없음), `canCreate`/`enabled` 경우별 문구, 10개.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS, `yarn build && yarn size --require-lazy AgentSection --require-lazy AgentInboxDialog --require-lazy inbox-check` 통과
- [ ] **Step 5:** 커밋 `feat(agent-app): 설정 AI 연결(발급·목록·철회)`

### Task 19: E2E와 ③ 마무리

**Files:**
- Modify: `tests/e2e/sync-server.ts`(`createSyncServer`의 `handle`이 `/api/agent/`도 `handleAgent`로 보냄 — `handleAgent`도 `tsxRequire`로 읽는다, `installSyncServer`가 `**/api/agent/**`도 가로챔. 기존 시험은 그대로 통과), `playwright.config.ts`(desktop 프로젝트 `testMatch` 목록의 `'server-backup.spec.ts',` 다음 줄에 `'agent-inbox.spec.ts',` 한 줄만)
- Create: `tests/e2e/agent-inbox.spec.ts`

- [ ] **Step 0: 토큰이 결과물에 남지 않게** — 이 파일 맨 위에 `test.use({ trace: 'off', screenshot: 'off', video: 'off' })`. Playwright 1.63은 이와 별도로 실패 때 `ariaSnapshot`을 `error-context.md`로 남기므로, 실행은 `PLAYWRIGHT_NO_COPY_PROMPT=1`을 붙이고(Step 1-1), 시험은 원문을 읽은 **즉시 만들기 창을 닫아** 이후 단계의 화면에 토큰이 없게 한다. 원문 표시부터 창 닫기까지에는 단언을 두지 않는다(실패 지점이 생기지 않게). 확인용으로 한 번, 창을 닫은 뒤 일부러 실패하는 임시 단언을 넣어 돌려 `test-results/`에 `lmk_`가 없음을 보고 그 단언을 지운다(커밋하지 않음). 토큰 값은 `expect(token).toMatch(…)`처럼 실패 메시지에 값이 찍히는 단언에 넣지 않고 `expect(/^lmk_[A-Za-z0-9_-]{43}$/.test(token)).toBe(true)`로만 본다. 시험이 끝나면(성공·실패 모두) `test-results/`·`playwright-report/`에서 이 파일 결과를 `grep -rl 'lmk_' test-results playwright-report`로 찾아 출력이 없음을 Step 1-1에서 확인한다.
- [ ] **Step 1: 시험** — `agent-inbox.spec.ts`(desktop, `@smoke` 아님): 가짜 카카오 로그인(기존 `library-sync.spec.ts`의 도우미 그대로) → 설정 › AI 연결 › `새 연결 만들기` → 원문 칸 값을 읽어 시험 변수에 둠(출력하지 않음) → 시험 코드가 `server.handle(new Request(origin + '/api/agent/v1/inbox', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ v: 1, key, d }) }))`(`d`는 `tests/fixtures/agent-trip/doc.json`(Task 6)을 읽어 `encodeShareHash(hashDoc(doc))`(`src/share-viewer/encode.ts`, 상대 경로 import)로 만든 값, `key`는 43자 무작위 base64url) → 새로고침 → 알림 「AI가 보낸 일정 1개」 → `보기` → `미리보기` → 머리 문구 → `가져오기` → 여행 화면 → 설정의 `받은 일정 없음` → `철회` → 같은 토큰으로 whoami 401.
- [ ] **Step 1-1: 실행** — `yarn build:map:e2e && PLAYWRIGHT_NO_COPY_PROMPT=1 E2E_PORT=4196 E2E_MAP_PORT=4197 npx playwright test agent-inbox.spec.ts library-sync.spec.ts server-backup.spec.ts --project desktop`(새 시험은 `@smoke`가 아니라 `test:e2e:ci`에 들어가지 않으므로 직접 돌린다. 프로젝트 이름은 `playwright.config.ts`의 desktop 프로젝트 `name`을 쓴다). 이어서 `grep -rl 'lmk_' test-results playwright-report 2>/dev/null` 출력 없음.
- [ ] **Step 2: 로컬 화면 확인**(포트가 막히면 건너뜀) — `SYNC_VITE_PORT=4198 SYNC_DEV_PORT=8798 yarn dev:sync` → 브라우저 가짜 로그인 → 토큰 발급 → `LANDMARK_AGENT_TOKEN=… yarn trip send tests/fixtures/agent-trip/plan.json --no-routes --app http://localhost:8798` → 앱 알림 → 가져오기 → `http://127.0.0.1:8798`(다른 출처)로 같은 계정 로그인 → 여행이 동기화됨. 화면 캡처는 저장하지 않는다.
- [ ] **Step 3: ③ 전체 검증** — Global Constraints의 전체 검증 명령, 첫 로딩 gzip 바이트와 조각 이름(`AgentSection-*.js`, `AgentInboxDialog-*.js`, `inbox-check-*.js`)을 보고에 적는다.
- [ ] **Step 4:** 커밋 `test(agent-app): 받은함 E2E`

---

# PR ④ 문서

### Task 20: 개발 문서·README·도움말

**Files:**
- Modify: `docs/development.md`(「서버 백업과 네이버 폴더 변경 알림」 절 다음에 새 절 `### AI 에이전트 일정 보내기(\`yarn trip\`)`), `README.md`(기능 목록 한 줄), `src/sections/help/help-content.ts`·`docs/help/settings.md`(설정 팁 한 줄, 두 곳 같은 문장)
- Test: 기존 도움말·문서 일치 시험

- [ ] **Step 1: 문서 작성**
  - `docs/development.md` 새 절: 명령 표(`build`·`send`·`share`·`whoami`·`unshare`·`--schema`, 옵션, 끝 코드), `plan.json` 예(설계 예시 그대로), 토큰 넣기(키체인 `-U` 명령·환경변수), 로컬 실행(`dev:sync` + 가짜 로그인 + `--app http://localhost:8795`), API 표(설계 「API」 줄임), 하루 한도, 받은함 20개·30일, 삭제 토큰 파일(`~/.landmark/agent-shares.json`, 600), `AGENT_API=off`, 확인 명령(읽기 전용) `npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta"` → `7`.
  - README: `- AI 에이전트 연결: Claude Code 같은 도구가 \`yarn trip\`으로 일정을 받은함에 보내거나 공유 링크를 만들어요(설정 › 동기화 › AI 연결에서 토큰 발급)`.
  - 도움말 설정 팁: `'동기화에 로그인했다면 \`AI 연결\`에서 토큰을 만들어 AI 도구가 일정을 받은함으로 보내게 할 수 있어요. 받은 일정은 내가 \`가져오기\`를 눌러야 들어가요.'`. 단계·그림은 바꾸지 않는다(`yarn build:motion` 안 돌림).
- [ ] **Step 2: 검증** — `yarn test`(도움말 일치 시험), `npx prettier --check docs/development.md README.md docs/help/settings.md src/sections/help/help-content.ts`, `yarn lint`.
- [ ] **Step 3:** 커밋 `docs(agent-trip): yarn trip·AI 연결 안내와 도움말`

## 병합 뒤(감독자 몫, Codex가 하지 않음)

| 때 | 할 일 |
|---|---|
| ① 병합 | 태그(다음 부 버전), `docs/rollback.md` 버전 표 한 줄 "✅ 저장 형식 그대로, 서버 변경 없음"(별도 docs PR) |
| ② 병합 | 태그. `docs/rollback.md`: 버전 표, 「서버 로드맵」 절의 스위치 표에 `AGENT_API=off`(막는 것: 토큰 경로·발급 / 계속: 목록·철회·받은함 읽기·지우기·짧은 링크 지우기), 스키마 표에 7(`agent_tokens`·`agent_inbox`), 되돌리는 순서(④→③→②→①), 옛 코드로 되돌린 사이 계정 지우기 정리 SQL(설계 「호환·롤백」) |
| ③ 병합 | 태그. `docs/rollback.md`: ③만 되돌릴 때(토큰은 만료까지 동작, 막으려면 `AGENT_API=off`) |
| ④ 병합 | 태그. 워크스페이스 스킬 `korea-trip-planner`에 설계 「워크스페이스 스킬 연결 규약」 반영(저장소 밖, 사용자 확인 뒤) |
| 미리보기 | 실제 계정 발급 → `yarn trip send --app <미리보기 주소>` → 휴대폰 알림·가져오기 → 다른 기기 동기화, `share` 링크 카카오톡, `POST /api/agent/v1/inbox` CPU 시간(설계 「보안」 CPU: 10ms 넘으면 `AGENT_INBOX_LIMITS.decodedBytes`를 낮춤) |

## 최종 보고에 넣을 것(PR마다)

- 커밋 목록, 시험 수, `yarn build:ci`의 첫 로딩 gzip과 새 조각 이름.
- 실행하지 못한 검증(네트워크·포트)과 이유.
- ①: `yarn trip build tests/fixtures/agent-trip/plan.json --no-routes`가 낸 `/import#d=` 링크(감독자가 앱으로 가져와 확인).
- 설계와 다르게 한 것(이름·시그니처·순서)과 이유.
