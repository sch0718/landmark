# 다듬기 2: 첫 로딩 (하위 프로젝트 D2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 첫 화면(보관함·지도·장소 상세)에 필요 없는 화면을 나중에 받게 하고, 큰 라이브러리를 따로 묶고, 첫 화면 JS 크기에 예산 검사를 둔다.

**Architecture:** 나눠 받기는 한 도우미(`src/lib/lazy-chunk.ts`의 `lazyChunk`)를 거친다. 실패는 `ChunkLoadError`로 바꿔 오류 화면이 새 버전 안내를 고르게 하고, 같은 import 함수 목록을 한가할 때 미리 받는다. 라우트 화면·추가 칸 단계·내보내기 대화상자 모두 `React.lazy` + `Suspense`(라우트에 react-router의 `lazy`는 쓰지 않는다 — 직접 진입 때 셸까지 비기 때문, 스펙 §2). 크기는 `dist/index.html`이 처음 받는 JS를 세는 스크립트(`yarn size`)와 `perf-budget.json`으로 지킨다.

**Tech Stack:** React 19, react-router 7(data router, 라우트 `element`에 `Suspense`), Vite 8(rolldown), Vitest 5, Playwright, Node 24 스크립트.

**Spec:** `docs/superpowers/specs/2026-10-13-first-load-design.md`

## Global Constraints

- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`(git 훅에도 필요). 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: 세션이 알려 주는 Co-Authored-By 줄.
- 파일에 U+2028/U+2029 원문자 금지. 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 새 문구는 `새 버전이 나왔어요. 새로고침해 주세요` 하나. 버튼은 기존 문구 `새로고침`. 기다림 표시는 기존 `불러오는 중…`(`role="status"`)과 같은 모양. 그 밖의 문구·모양은 바꾸지 않는다.
- 첫 화면에 남는 것: 보관함·지도·장소 상세, 셸(메뉴·추가 시트·저장 배너·끌어 놓기 덮개·`/import` 진입 훅), 핀 찍기 덮개.
- 나눠 받는 것: `/trips`·`/trips/:id`·`/settings`·`/labels`·`/t/:publicId` 화면, 추가 칸 단계(링크 입력·확인 카드·폴더 미리보기·핀 카드·공유 파일 고르기·공유 미리보기), `ExportHtmlDialog`.
- 라이브러리 묶음 세 개: `react`(react·react-dom·react-router·scheduler), `mui`(@mui/*·@emotion/*), `effect`(effect).
- 미리 받기: 첫 화면을 그린 뒤 `requestIdleCallback`(없으면 `setTimeout` 2,000ms), 한 번만, 실패 무시, `navigator.connection?.saveData === true`면 안 함. 자동 새로고침은 하지 않는다.
- 예산: `perf-budget.json`의 `initialJsGzipMax` = 나눠 받은 뒤 잰 첫 화면 JS gzip × 1.10을 1,024바이트 단위로 올림. 스크립트가 예산을 자동으로 고치지 않는다.
- E2E는 `E2E_PORT=5175`(5173은 다른 프로젝트 `stock-trade`의 개발 서버 — 절대 끄지 않는다, 5174는 지도 미리보기 서버).

## Review Focus

1. **E2E·단위 테스트가 나눠 받은 화면을 기다리지 않아 깜박이는 실패** → `findBy`·`toBeVisible` 기다림으로 바꾸고 고정 sleep을 넣지 않는다. Task 3·4에서 기존 테스트 전체 통과로 고정.
2. **오류 경계가 `ChunkLoadError` 아닌 오류까지 새 버전 안내로 보임** → 다른 오류는 기존 문구. Task 2 단위 테스트.
3. **추가 칸이 받는 중 닫히거나 단계가 바뀜** → 늦게 온 모듈이 닫힌 칸을 다시 열지 않는다(Suspense가 그 단계만 기다림). Task 4 테스트.
4. **미리 받기가 첫 화면 렌더와 경쟁해 첫 화면을 늦춤** → 한가할 때만, 첫 렌더 뒤에만 예약. Task 2 단위 테스트(첫 렌더 전에는 import 함수가 불리지 않음).
5. **라이브러리 묶음 설정으로 첫 화면 파일 수가 늘거나 순환 청크가 생김** → `yarn size` 출력의 첫 화면 파일 4~6개, 빌드 경고 없음. Task 5 확인.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `scripts/check-bundle-size.mjs`, `perf-budget.json`, `package.json` | `yarn size` |
| `src/lib/lazy-chunk.ts` | `lazyChunk`, `ChunkLoadError`, `isChunkLoadError` |
| `src/lib/prefetch.ts` | `prefetchWhenIdle` |
| `src/components/ChunkErrorNotice.tsx`, `src/components/RouteErrorScreen.tsx` | 새 버전 안내 |
| `src/routes/router.tsx`, `src/routes/lazy-routes.ts` | 라우트 나눠 받기·미리 받기 목록 |
| `src/sections/add-place/AddPlaceHost.tsx`, `src/sections/library/LibraryPage.tsx` | 단계·대화상자 나눠 받기 |
| `vite.config.ts` | 라이브러리 묶음·청크 이름 |
| `docs/ui-performance.md`, `README.md` | 기록 |
| `tests/unit/…`, `tests/e2e/first-load.spec.ts` | 테스트 |

---

### Task 1: 크기 측정 스크립트

**Files:**
- Create: `scripts/check-bundle-size.mjs`, `tests/unit/build/check-bundle-size.test.ts`
- Modify: `package.json`(`"size": "node scripts/check-bundle-size.mjs"`)

**Interfaces:**
- Produces: `node scripts/check-bundle-size.mjs [--dist dist] [--budget perf-budget.json] [--forbid <이름>]...` — `dist/index.html`의 `<script type="module" src>`·`<link rel="modulepreload" href>`가 가리키는 JS를 첫 화면 파일로 보고, 파일별 `{ name, bytes, gzipBytes }`, `initial: { bytes, gzipBytes, files }`, `total: { bytes, gzipBytes }`(`dist/assets/*.js` 전부)를 JSON으로 출력. 예산 파일이 있으면 `initial.gzipBytes > initialJsGzipMax`일 때 종료 코드 1과 한 줄 이유. 예산 파일이 없으면 출력만 하고 0. `--forbid`로 받은 이름이 첫 화면 파일 이름에 들어 있으면 종료 코드 1. 계산 함수는 export해 테스트에서 부른다(스크립트로 실행될 때만 출력·종료).

- [ ] **Step 1: 실패하는 테스트** — 임시 디렉터리에 가짜 `index.html`(진입 1 + modulepreload 2)과 `assets/`(그 셋 + 나중 파일 1)를 만들고: 첫 화면 = 세 파일의 합, 전체 = 네 파일의 합, 예산 초과 → 1, 이하 → 0, 예산 파일 없음 → 0, `--forbid later`는 통과·`--forbid entry`는 1.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. gzip은 `zlib.gzipSync` 기본 수준(기존 `measure-ui-assets.mjs`와 같은 계산).
- [ ] **Step 4:** PASS. `yarn build && yarn size`로 지금(나누기 전) 값을 재서 보고서에 적는다(Task 5가 전후 기록에 쓴다).
- [ ] **Step 5:** 커밋 `build: 첫 화면 JS 크기 측정 스크립트(yarn size)`

---

### Task 2: 나눠 받기 도우미·새 버전 안내·미리 받기

**Files:**
- Create: `src/lib/lazy-chunk.ts`, `src/lib/prefetch.ts`, `src/components/ChunkErrorNotice.tsx`
- Modify: `src/components/RouteErrorScreen.tsx`
- Test: `tests/unit/lib/lazy-chunk.test.ts`, `tests/unit/lib/prefetch.test.ts`, `tests/unit/components/route-error-screen.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // src/lib/lazy-chunk.ts
  export class ChunkLoadError extends Error {} // name 'ChunkLoadError', cause = 원래 오류
  export function isChunkLoadError(error: unknown): boolean;
  export function lazyChunk<T>(load: () => Promise<T>): () => Promise<T>; // 실패를 ChunkLoadError로
  // src/lib/prefetch.ts
  export type IdleScheduler = (run: () => void) => void;
  export function prefetchWhenIdle(loads: readonly (() => Promise<unknown>)[], schedule?: IdleScheduler): void; // 한 번만(모듈 수준 플래그), saveData면 안 함, 실패 무시
  export function resetPrefetchForTest(): void;
  // src/components/ChunkErrorNotice.tsx
  export function ChunkErrorNotice(props: { fullScreen?: boolean }): JSX.Element; // 문구 + `새로고침`(location.reload)
  ```
- `RouteErrorScreen`: `isChunkLoadError(useRouteError())`면 `<ChunkErrorNotice fullScreen />`, 아니면 지금 화면 그대로.

- [ ] **Step 1: 실패하는 테스트** — `lazyChunk`: 성공 시 같은 모듈, 실패 시 `ChunkLoadError`(cause 보존). `prefetchWhenIdle`: 주입한 스케줄러가 부를 때만 load 함수들이 불리고, 두 번 불러도 한 번, `saveData` true면 스케줄러 자체를 안 부름, load가 reject해도 처리되지 않은 rejection 없음. 기본 스케줄러는 `requestIdleCallback`이 있으면 그것, 없으면 `setTimeout(…, 2000)`(가짜 타이머로 확인). `RouteErrorScreen`: `ChunkLoadError`면 `새 버전이 나왔어요. 새로고침해 주세요`와 `새로고침`, 다른 오류면 `문제가 생겨 화면을 표시하지 못했어요`.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. `ChunkErrorNotice`의 모양은 `RouteErrorScreen`과 같은 구성(전체 화면) / 칸 안(`fullScreen` 아님)은 기존 칸 오류 안내와 같은 여백·글자 크기.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat: 나눠 받기 도우미와 새 버전 안내, 한가할 때 미리 받기`

---

### Task 3: 화면(라우트) 나눠 받기

**Files:**
- Create: `src/routes/lazy-routes.ts`
- Modify: `src/routes/router.tsx`, 첫 화면을 그리는 곳(셸 — `AppShell` 또는 `ShellRoute`)에서 `prefetchWhenIdle` 한 번 예약
- Test: `tests/unit/routes/router.test.tsx`(없으면 생성), 영향받는 기존 테스트

**Interfaces:**
- Consumes: Task 2의 `lazyChunk`, `prefetchWhenIdle`.
- Produces: `lazy-routes.ts` — 각 화면의 `lazyChunk(() => import('…'))` 로더(`loadTripsPage`, `loadTripPlannerPage`, `loadSettingsPage`, `loadLabelsPage`, `loadLegacyImportPage`), 그것으로 만든 `React.lazy` 컴포넌트, 미리 받기 목록 `ROUTE_CHUNKS`. `router.tsx`는 그 라우트의 `element`를 `<Suspense fallback={<기존 '불러오는 중…' 표시/>}><LazyX /></Suspense>`로 둔다. **react-router의 라우트 `lazy`는 쓰지 않는다**(직접 진입·새로고침 때 셸까지 그리지 않아 빈 화면이 된다 — 스펙 §2). 받기 실패는 렌더 중 오류라 셸 라우트의 `errorElement`(`RouteErrorScreen`)가 처리한다.

- [ ] **Step 1: 실패하는 테스트** — `createMemoryRouter(routes, { initialEntries: ['/trips'] })`처럼 **처음부터** 그 주소로 시작해도 셸(메뉴)이 먼저 그려지고 화면 자리에 `불러오는 중…`, 받은 뒤 각 화면 제목/주요 요소가 나타난다(`findBy`). `/settings`·`/labels`·`/trips/<id>`도. 앱 안에서 이동해도 나타난다. 로더가 실패하도록 모의하면 새 버전 안내. 셸이 처음 그려진 뒤 `prefetchWhenIdle`이 `ROUTE_CHUNKS`(와 Task 4가 더할 목록)로 한 번 불린다.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 기존 테스트가 화면을 동기로 기대하던 곳은 `findBy`로 고친다(동작은 그대로).
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint` + `yarn build && yarn size`(첫 화면 JS가 줄었는지 보고서에) + `E2E_PORT=5175 yarn test:e2e`
- [ ] **Step 5:** 커밋 `perf: 여행·설정·라벨·옛 여행 가져오기 화면을 들어갈 때 받기`

---

### Task 4: 추가 칸 단계·내보내기 대화상자 나눠 받기

**Files:**
- Modify: `src/sections/add-place/AddPlaceHost.tsx`, `src/sections/library/LibraryPage.tsx`(또는 `ExportHtmlDialog`를 여는 곳), `src/routes/lazy-routes.ts`(미리 받기 목록에 더함)
- Test: `tests/unit/sections/add-place/*`, `tests/unit/sections/share-export/*`, 영향받는 기존 테스트

**Interfaces:**
- Consumes: Task 2의 `lazyChunk`·`ChunkErrorNotice`, Task 3의 `ROUTE_CHUNKS`.
- Produces: `StepContent`의 여섯 단계 컴포넌트를 `React.lazy(lazyChunk(() => import(…).then(m => ({ default: m.X }))))`로, 칸 안에 `Suspense`(`불러오는 중…`)와 받기 실패용 오류 경계(`ChunkLoadError`면 `<ChunkErrorNotice />`, 아니면 다시 던짐). `pin` 단계(`PinModeOverlay`)는 그대로. `ExportHtmlDialog`는 **처음 열 때 받고 그 뒤로는 계속 마운트**(`everOpened` 상태 — 한 번 `true`가 되면 유지 — 일 때 `<Suspense><LazyExportHtmlDialog open={open} … /></Suspense>`). 닫을 때 마운트를 지우면 `open=false`로 진행 중 저장을 무효화하는 지금 동작이 돌지 않는다(스펙 §2). 미리 받기 목록 `PANEL_CHUNKS`를 `lazy-routes.ts`에 두고 Task 3의 예약에 합친다.

- [ ] **Step 1: 실패하는 테스트** — 각 단계가 열리면 그 화면이 나타난다(`findBy`). 단계 로더 실패 → 칸 안에 새 버전 안내, 칸 닫기 버튼으로 닫힘. 받는 중에 흐름을 닫으면 늦게 온 모듈이 칸을 다시 열지 않는다. 내보내기 대화상자: 열면 나타나고, 로더 실패 시 대화상자 안 안내. 보관함 화면에서 연 대화상자로 기존 `export-dialog.test.tsx`의 재열기·저장 취소 시나리오(템플릿을 기다리는 동안 `파일 저장` → 닫기 → 다시 열기 → 이전 요청 완료 시 내려받기 0회, 새 창이 닫히지 않음)가 통과한다.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint` + `yarn build && yarn size` + `E2E_PORT=5175 yarn test:e2e`
- [ ] **Step 5:** 커밋 `perf: 추가 칸 단계와 공유 내보내기 대화상자를 열 때 받기`

---

### Task 5: 라이브러리 묶음, 예산, 기록

**Files:**
- Modify: `vite.config.ts`, `package.json`(`build:ci`에 `size`), `perf-budget.json`(생성), `docs/ui-performance.md`, `README.md`(스크립트 표에 `size`)
- Create: `tests/e2e/first-load.spec.ts`; Modify: `playwright.config.ts`(세 프로젝트의 `testMatch`에 추가)

**Interfaces:**
- Consumes: Task 1 스크립트, Task 3·4의 나눠 받기.
- `vite.config.ts`: rolldown 출력 설정으로 `react`·`mui`·`effect` 세 묶음(설치된 rolldown이 지원하는 방식 — `node_modules/rolldown`의 타입에서 `advancedChunks.groups` 또는 `manualChunks` 확인)과, 나눠 받는 화면 파일 이름에 화면 이름이 드러나게(`chunkFileNames`가 기본 `[name]-[hash].js`면 그대로).

- [ ] **Step 1:** 묶음 설정 후 `yarn build && yarn size --forbid TripPlannerPage --forbid TripsPage --forbid SettingsPage --forbid LabelsPage --forbid LegacyImportPage` 통과, 첫 화면 파일 4~6개, 빌드 경고 없음.
- [ ] **Step 2:** 잰 첫 화면 JS로 `perf-budget.json`을 만든다(Global Constraints의 식). `build:ci`를 `… && yarn build && yarn size --forbid …(위 다섯) && yarn build:map`으로.
- [ ] **Step 3: E2E** `tests/e2e/first-load.spec.ts`(세 프로젝트): 첫 화면을 열고 `/trips`·`/settings`·`/labels`로 이동(메뉴)해 각 화면이 나타남. `/trips`를 주소로 바로 열면 셸(메뉴)이 먼저 보이고 여행 화면이 나타난다. E2E 앱은 Vite **개발 서버**라 모듈 주소가 `/src/sections/trips/TripsPage.tsx`이므로 `page.route('**/src/sections/trips/TripsPage.tsx*', r => { blocked += 1; return r.fulfill({ status: 404 }); })`를 **`page.goto` 전에** 걸고 첫 화면을 연 뒤 메뉴로 `/trips`에 가면 `새 버전이 나왔어요. 새로고침해 주세요`, 그리고 `expect(blocked).toBeGreaterThan(0)`(차단이 실제로 일어났는지).
- [ ] **Step 4:** `docs/ui-performance.md`에 `2026-10-13 D2 첫 로딩` 절(스펙 §6: Task 1이 잰 전 값, 지금 값, 첫 화면 파일 목록, 첫 화면에 남은 여행 기능 경계, 명령). README 스크립트 표에 `size`.
- [ ] **Step 5:** `yarn build:ci` 통과, `E2E_PORT=5175 yarn test:e2e` 전체 통과.
- [ ] **Step 6:** 커밋 `perf: 라이브러리 묶음 분리와 첫 화면 JS 예산`
