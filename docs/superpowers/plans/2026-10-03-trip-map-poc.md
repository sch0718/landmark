# trip-map PoC 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 저장 폴더를 여행 단위 지도로 묶어 탐색·일정 편집·동행자 공유(로컬 편집 + 내보내기/가져오기)를 하는 정적 웹앱과, 그 데이터를 만드는 로컬 CLI(collect, apply-edit, validate)를 만든다.

**Architecture:** 로컬 CLI가 `trips/*.yaml`을 읽어 네이버 비공식 API로 장소·경로를 수집하고 `public/data/<publicId>.json`(TripData)을 만든다. 앱은 이 JSON을 읽기 전용으로 받고, 각 브라우저의 localStorage에 있는 EditLayer를 덧씌워(`overlay`) 화면을 만든다. 병합·정리·되돌리기 규칙은 모두 `src/domain/`의 순수 함수이며, 앱과 CLI가 같은 함수를 쓴다.

**Tech Stack:** React 19, Vite, TypeScript, React Compiler, MUI 7 + Emotion, Jotai, Zod, react-router 7, dnd-kit, dayjs, es-toolkit, unplugin-icons, sonner, supercluster, tsx, yaml, Vitest, React Testing Library, Playwright, Yarn, Node ≥ 22.

**Spec:** `docs/superpowers/specs/2026-10-03-trip-map-design.md` (r5). 각 Task의 `§` 표기는 이 스펙의 절이다. 구현자는 담당 Task의 해당 절을 함께 읽는다.

## Global Constraints

- 언어: UI 문구와 문서는 한국어. 코드 식별자는 영어.
- 파일 이름: 컴포넌트는 PascalCase(`PlaceCard.tsx`), 그 외는 kebab-case(`edit-layer-repo.ts`).
- import 경로 별칭: `src/...` (rule_system_fe와 동일). `pipeline/`도 `src/schema`, `src/domain`을 이 별칭으로 import한다.
- `src/domain/`은 React, `window`, `localStorage`, `fetch`, `Date.now()`에 의존하지 않는다. 현재 시각은 인자 `now: string`(ISO)로 받는다.
- 모든 스키마 `schemaVersion: 1`. ISO 시각은 `Date.prototype.toISOString()` 형식(UTC, `Z`)만 허용해 문자열 비교가 시간 비교와 같게 한다.
- 좌표 범위(경계 포함): `124.0 ≤ lng ≤ 132.0`, `33.0 ≤ lat ≤ 39.0`.
- 크기 제한(§5.3): `#e=` 값 16,000자, 파일 1MB(1,048,576바이트), 해제 결과 1MB, 메모 2,000자, 장소당 태그 20개·태그당 30자, Day당 stop 50개, authors 50명. 링크 내보내기 안내 기준 8,000자.
- localStorage 키: `tripmap:edit:<publicId>`, 손상 백업 `tripmap:edit:<publicId>:corrupt:<epoch>`.
- 네이버 API 호출은 `pipeline/naver-client.ts` 한 파일에만 둔다. 요청 간 300ms 대기, `Origin` 헤더 금지.
- 테스트는 네트워크를 호출하지 않는다. 네이버 응답은 `tests/fixtures/naver/`의 녹화본만 쓴다.
- 의존성: 스펙 §2.2 목록 외 런타임 의존성을 추가하지 않는다. 제외 목록(Effect, bunshi, OpenTelemetry, MSW, lz-string 등)은 쓰지 않는다. rule_system_fe 파일은 복사하지 않는다.
- 커밋 메시지는 Conventional Commits(`feat:`, `test:`, `chore:` …), 본문 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

스펙이 직접 말하지 않지만 실제로 부딪힐 가능성이 큰 입력 다섯 가지. 각 줄의 테스트는 담당 Task에 들어 있다.

1. **네이버 장소명·메모에 HTML/스크립트 문자열** (`<img src=x onerror=alert(1)>`) — 문자 그대로 보이고 실행되지 않아야 한다. → Task 17 (`PlaceCard` 테스트), Task 16 (마커 라벨은 `textContent`로만 설정)
2. **저장 폴더에 해외 장소(좌표 범위 밖)** — collect 전체가 실패하지 않고 그 장소만 제외·보고해야 한다. 단, 일정 stop이 그 장소를 가리키면 stop 연결 실패와 같이 종료 코드 1. → Task 10
3. **방문이 없는 날·하루 한 곳뿐인 날** — 화면이 깨지지 않고 "방문 없음", 합계 없음으로 보여야 한다. → Task 4(`dayTotals([])`), Task 18(타임라인 빈 날)
4. **같은 여행을 두 탭에서 동시에 편집** — 두 탭이 서로 다른 장소에 메모를 저장해도 둘 다 남아야 한다(나중에 쓴 탭이 앞선 편집을 덮지 않음). → Task 15 (저장 직렬화 단위 테스트), Task 20 (두 페이지 경쟁 저장 E2E)
5. **클립보드·공유 시트를 모두 쓸 수 없는 모바일 브라우저** — 링크를 선택 가능한 텍스트 필드로 보여 줘 직접 복사할 수 있어야 한다. → Task 19

---

## 파일 구조

```
src/
  schema/
    common.ts            # IsoDateTime, CalendarDate, HHmm, Lng, Lat, PlaceKey, StopId, LIMITS
    trip-source.ts       # TripSourceSchema (+ 관계 검증)
    trip-data.ts         # TripDataSchema (+ 관계 검증)
    edit-layer.ts        # EditLayerSchema (+ 관계·크기 검증), newEditLayer()
  domain/
    day-hash.ts          # hashDayStops
    overlay.ts           # overlay, findDuplicateStopIds
    leg-index.ts         # buildLegIndex, effectiveLegs, DisplayLeg
    day-totals.ts        # dayTotals
    date-groups.ts       # groupDates (union-find)
    revert.ts            # planRevert, applyRevert
    reconcile.ts         # reconcile, keepMine
    merge.ts             # planMerge, applyMerge
    lww.ts               # pickLww (updatedAt + 직렬화 타이브레이크)
    codec.ts             # encodeEditLayer, decodeEditLayer, CodecError
  models/
    place.ts             # naverPlaceUrl, placeLabel
  repositories/
    trip-repo.ts         # loadTrip
    edit-layer-repo.ts   # storageKey, readEditLayer, writeEditLayer, isStorageAvailable
    import-flow.ts       # prepareImport, commitImport
  stores/
    trip-store.ts        # tripAtom, editLayerAtom, effectiveTripAtom, reconcileReportAtom
    ui-store.ts          # modeAtom, selectedDayAtom, selectedPlaceAtom (쿼리 동기화)
  components/
    map/MapAdapter.ts, NaverMapAdapter.ts, FakeMapAdapter.ts, MapView.tsx, load-naver-sdk.ts
    NicknameDialog.tsx, ReconcileBanner.tsx, ErrorScreen.tsx
  sections/
    explore/{store/filters.ts, view/ExploreFilters.tsx, view/PlaceList.tsx, view/PlaceCard.tsx}
    itinerary/{store/itinerary-actions.ts, view/DayTabs.tsx, view/Timeline.tsx, view/LegRow.tsx, view/DayTotals.tsx, view/RevertDialog.tsx}
    share/{view/ExportDialog.tsx, view/ImportDialog.tsx}
  layouts/TripLayout.tsx  # 데스크톱 패널 / 모바일 하단 시트
  routes/paths.ts, routes/router.tsx
  pages/HomePage.tsx, pages/TripPage.tsx
  theme/theme.ts
  app.tsx, main.tsx
pipeline/
  naver-client.ts, build-places.ts, ids.ts, resolve-stops.ts, route-cache.ts, simplify.ts, legs.ts,
  collect.ts, apply-edit.ts, validate.ts, git-port.ts, fs-port.ts
  cli/collect.ts, cli/apply-edit.ts, cli/validate.ts
tests/
  unit/{schema,domain,pipeline,repositories,components}/...
  e2e/share.spec.ts, e2e/itinerary.spec.ts
  fixtures/naver/{bookmarks-*.json, route-*.json}, fixtures/trips/*.{yaml,json}, fixtures/builders.ts
public/_headers, public/data/.gitkeep
trips/example.yaml
```

---

## Phase 1 — 기반과 도메인

### Task 1: 프로젝트 골격

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `prettier.config.mjs`, `.editorconfig`, `.gitignore`, `.husky/pre-commit`, `index.html`, `src/main.tsx`, `src/app.tsx`, `src/vite-env.d.ts`, `public/_headers`, `public/data/.gitkeep`, `tests/setup.ts`
- Test: `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: 스크립트 `dev`, `build`(`tsc -b && vite build`), `typecheck`(`tsc -b --noEmit`), `test`(`vitest run`), `test:e2e`(`playwright test`), `lint`, `fm:check`, `collect`(`tsx pipeline/cli/collect.ts`), `apply-edit`(`tsx pipeline/cli/apply-edit.ts`), `validate`(`tsx pipeline/cli/validate.ts`), `build:ci`(`yarn validate && yarn typecheck && yarn test && yarn build`). 별칭 `src/*` → `./src/*` (tsconfig `paths`, Vite `resolve.alias`, Vitest 동일).

- [ ] **Step 1:** `yarn init`(Yarn 1, `"packageManager": "yarn@1.22.22"`, `"engines": {"node": ">=22"}`, `"type": "module"`), 스펙 §2.2 의존성 설치. React Compiler는 `@vitejs/plugin-react` + `babel-plugin-react-compiler`(프로덕션 빌드에만). Vitest 환경은 `jsdom`, `tests/setup.ts`에서 `@testing-library/jest-dom/vitest` 로드.
- [ ] **Step 2:** `.gitignore`에 `node_modules`, `dist`, `.cache/`, `playwright-report/`, `test-results/`, `.env*.local`. `public/_headers`:

```
/*
  X-Robots-Tag: noindex
/data/*
  Cache-Control: public, max-age=60
```

- [ ] **Step 3: 스모크 테스트 작성** — `tests/unit/smoke.test.ts`: `import { App } from 'src/app'`가 렌더되고 `screen.getByText('공유받은 링크로 접속하세요')`가 있다(이 문구는 Task 15에서 HomePage로 옮겨도 유지).
- [ ] **Step 4:** `src/app.tsx`에 위 문구만 렌더하는 `App` export. 실행: `yarn test && yarn typecheck && yarn lint && yarn build` → 모두 성공.
- [ ] **Step 5:** husky `pre-commit`에 `npx lint-staged`(eslint --fix, prettier --write). 커밋 `chore: 프로젝트 골격`.

---

### Task 2: 스키마 (TripSource, TripData, EditLayer)

**Files:**
- Create: `src/schema/common.ts`, `src/schema/trip-source.ts`, `src/schema/trip-data.ts`, `src/schema/edit-layer.ts`, `tests/fixtures/builders.ts`
- Test: `tests/unit/schema/trip-source.test.ts`, `trip-data.test.ts`, `edit-layer.test.ts`

**Interfaces:**
- Produces (`src/schema/common.ts`): `LIMITS = { linkChars: 16000, fileBytes: 1048576, decodedBytes: 1048576, memoChars: 2000, tagsPerPlace: 20, tagChars: 30, stopsPerDay: 50, authors: 50, exportLinkWarnChars: 8000 } as const`; Zod 원시 스키마 `IsoDateTime`, `CalendarDate`(`YYYY-MM-DD`이며 dayjs strict 파싱으로 실제 날짜), `HHmm`, `Lng`, `Lat`, `PlaceKey`(`/^(n:\d+|c:[A-Za-z0-9_-]+)$/`), `StopId`(`/^[a-z0-9]{4,}$/`), `PublicId`(`/^[a-z0-9]{10,}$/`).
- Produces (`trip-source.ts`): `TripSourceSchema`, `type TripSource` (§3.1 그대로; `publish.naverMemo` 기본 `true`; `stops[].id`, `publicId`는 optional — collect가 채운다).
- Produces (`trip-data.ts`): `TripDataSchema`, `type TripData`, `type Place`, `type Day`, `type Stop = { id: string; placeKey: string; time?: string; note?: string }`, `type Leg` (§3.2 그대로).
- Produces (`edit-layer.ts`): `EditLayerSchema`, `type EditLayer`, `type PlaceEdit`, `type DayEdit` (§3.3 그대로), `newEditLayer(args: { publicId: string; baseDataVersion: string; authorId: string; nickname: string; now: string }): EditLayer`.
- Produces (`tests/fixtures/builders.ts`): `sid(symbol: string): string` — 테스트 표기용 기호를 유효한 StopId로 바꾼다(`'X'` → `'x000'`, `'H2'` → `'h200'`; 소문자화 후 `0`으로 4자까지 채움). `makeTrip(spec: { days: Record<string, string[]>; places?: string[] }): TripData` — `days`는 `{ '2026-11-14': ['X', 'Y'] }`처럼 날짜→기호 목록이며, 각 기호는 `sid(기호)`를 id로, placeKey `n:<순번>`을 갖는 장소로 자동 생성(기호 끝 숫자를 뗀 같은 문자는 같은 장소: `H`와 `H2`는 같은 placeKey), 모든 구간 `routed`, `dataVersion`·`queriedAt`은 고정 UTC ISO. `makeEdit(overrides?: Partial<EditLayer>): EditLayer` — 기본 authorId `'a-local'`, authors에 포함. 이후 Task의 모든 도메인 테스트가 이 빌더를 쓰며, 테스트 본문에서 stop id를 비교할 때는 `sid('X')`를 쓴다.

- [ ] **Step 1: 실패 테스트 작성** — 표 기반(`it.each`)으로 §3.5의 규칙마다 통과 1건·거부 1건:
  - TripSource: `startDate > endDate` 거부, `2026-02-30` 거부, 기간 밖 날짜 거부, 날짜 중복 거부, customPlace key 중복 거부, 숫자만인 key(`"123"`) 거부, `lng: 123.99` 거부·`124.0` 통과·`132.0` 통과, `stops: []` 통과, `time: "25:00"` 거부, 전체 stop id 중복 거부, `publish` 생략 시 `naverMemo === true`.
  - TripData: 없는 placeKey 참조 거부, 없는 folderId 거부, `stops: []`이고 `legs: []` 통과, `stops` 1개·`legs: []` 통과, legs 수 불일치 거부, `legs[0].toStopId` 불일치 거부, `status: "failed"`인데 `durationMs: 0` 거부(null이어야 함), `dataVersion: "2026-10-03T10:00:00+09:00"` 거부(UTC `Z`만).
  - 빌더: `makeTrip({ days: { '2026-11-14': ['X','Y'], '2026-11-15': [] } })`가 `TripDataSchema`를, `makeEdit()`이 `EditLayerSchema`를 통과.
  - EditLayer: memos 키가 authors에 없으면 거부, override 안 stop id 중복 거부, 메모 2,001자 거부, 태그 21개 거부, 31자 태그 거부, stop 51개 거부, authors 51명 거부, `mode: "reset"`에 `stops`가 있으면 거부.
- [ ] **Step 2:** `yarn test tests/unit/schema` → FAIL(모듈 없음).
- [ ] **Step 3:** 스키마 구현. 관계 검증은 각 최상위 스키마의 `superRefine`에서 `ctx.addIssue`로, 경로(`path`)를 정확히 지정한다(에러 화면이 첫 이슈를 보여 준다).
- [ ] **Step 4:** `yarn test tests/unit/schema` → PASS.
- [ ] **Step 5:** 커밋 `feat(schema): TripSource/TripData/EditLayer 스키마와 관계 검증`.

---

### Task 3: 일 해시와 overlay

**Files:**
- Create: `src/domain/day-hash.ts`, `src/domain/overlay.ts`
- Test: `tests/unit/domain/overlay.test.ts`

**Interfaces:**
- Consumes: `TripData`, `EditLayer`, `Stop` (Task 2), `makeTrip`, `makeEdit`.
- Produces:
  - `hashDayStops(stops: Stop[]): string` — `[id, placeKey, time ?? null, note ?? null]` 배열의 `JSON.stringify`에 FNV-1a 32비트, 8자리 hex. 브라우저와 Node에서 같은 값.
  - `type EffectiveDay = { date: string; stops: Stop[]; source: 'base' | 'override'; unresolved: boolean; removedByPlacement: string[] }` (`removedByPlacement`: overlay 배치 규칙으로 이 날에서 뺀 stop id).
  - `type EffectiveTrip = { days: EffectiveDay[]; hiddenEditDates: string[] }` (`hiddenEditDates`: 원본에 없는 날짜의 DayEdit).
  - `overlay(trip: TripData, edit: EditLayer | null): EffectiveTrip`
  - `findDuplicateStopIds(days: { stops: Stop[] }[]): string[]`
  - `ensureOverride(trip: TripData, edit: EditLayer, date: string, now: string): EditLayer` — 그날이 이미 override면 그대로 반환. 아니면 **현재 실효 stops**(`overlay` 결과, 배치 규칙으로 빠진 방문 제외)를 복사해 `{ mode: 'override', stops, baseDayHash: hashDayStops(원본 그날 stops), updatedAt: now }`로 만든다. 앱의 모든 일정 편집(Task 17 일정에 추가, Task 18 전체)은 이 함수로 시작한다.

- [ ] **Step 1: 실패 테스트 작성**
  - `edit = null` → 원본 그대로, 모든 `source: 'base'`, `unresolved: false`.
  - override 날은 override stops, reset 날은 원본.
  - `unresolved`: override의 `baseDayHash !== hashDayStops(원본 그날)`이면 true.
  - **배치 규칙(§3.3)**: 원본 Day1=[], Day2=[X](v2), override Day1=[X'](X의 note만 다름) → Day1=[X'], Day2=[]이고 `days[1].removedByPlacement` = `['X']`, `findDuplicateStopIds` = `[]`.
  - 원본에 없는 날짜의 DayEdit → `hiddenEditDates`에 포함, `days`에는 없음.
  - **반복 방문**: Day1=[H, A, H2](H와 H2는 같은 placeKey, 다른 stop id) → stop 3개 유지.
  - **줄어든 원본 날에서 편집 시작**: 원본 D2=[A, X, B], local override D1=[X] → `ensureOverride(trip, edit, D2, now)`의 D2 stops = `[A, B]`(X 없음), `baseDayHash` = 원본 D2 [A, X, B]의 해시. 이어서 장소 P를 추가해도 실효 일정에 X는 한 번(D1)뿐.
- [ ] **Step 2:** `yarn test tests/unit/domain/overlay.test.ts` → FAIL.
- [ ] **Step 3:** 구현. 배치 규칙: 먼저 override 날들의 stop id 집합을 만들고, 원본을 따르는 날에서 그 id를 뺀다.
- [ ] **Step 4:** PASS 확인.
- [ ] **Step 5:** 커밋 `feat(domain): overlay와 일 해시`.

---

### Task 4: 구간 색인과 Day 합계

**Files:**
- Create: `src/domain/leg-index.ts`, `src/domain/day-totals.ts`
- Test: `tests/unit/domain/leg-index.test.ts`, `tests/unit/domain/day-totals.test.ts`

**Interfaces:**
- Consumes: `TripData`, `Leg`, `EffectiveDay`.
- Produces:
  - `type DisplayLeg = Omit<Leg, 'status'> & { status: 'routed' | 'failed' | 'unrouted' }`
  - `buildLegIndex(trip: TripData): Map<string, Leg>` — 키 `${fromPlaceKey}→${toPlaceKey}`, `routed`만.
  - `effectiveLegs(day: EffectiveDay, trip: TripData, index: Map<string, Leg>): DisplayLeg[]` — 원본 legs를 그대로 쓰는 조건은 `source === 'base'`이고 `removedByPlacement`가 비어 있을 때뿐(실패 구간 포함). 그 밖의 날(override, 또는 배치 규칙으로 방문이 빠진 원본 날)은 **실효 stops의 연속 쌍**으로 다시 만들며, 각 쌍은 색인 재사용 후 `fromStopId/toStopId`를 현재 stop으로 바꾸고, 없으면 `unrouted`(하버사인 직선거리, `distanceKind: 'straight'`, 시간·통행료·`queriedAt` null, path = 두 점).
  - `type DayTotals = { durationMs: number; roadDistanceM: number; tollFare: number; uncomputedCount: number; straightDistanceM: number }`
  - `dayTotals(legs: DisplayLeg[]): DayTotals` — `routed`만 시간·도로거리·통행료에 더하고, `failed`/`unrouted`는 개수와 직선거리에만.

- [ ] **Step 1: 실패 테스트 작성**
  - A→C→B로 바꾼 override: A→C, C→B가 원본 어디에도 없으면 둘 다 `unrouted`; B→A가 원본 다른 날에 있으면 재사용.
  - 반복 방문 H→A→H: 두 구간의 `fromStopId/toStopId`가 각 stop id와 일치.
  - **배치 규칙으로 줄어든 원본 날**: 원본 D2=[A, X, B](legs A→X, X→B), X가 local override D1로 배치됨 → D2 legs는 1개(A→B), 원본 어디에도 A→B가 없으면 `unrouted`, `fromStopId/toStopId` = `sid('A')/sid('B')`.
  - `dayTotals`: routed(3,600,000ms, 10,000m, 1,000원) + unrouted(직선 3,200m) → `{ durationMs: 3600000, roadDistanceM: 10000, tollFare: 1000, uncomputedCount: 1, straightDistanceM: 3200 }`.
  - **Review Focus 3**: `dayTotals([])` → 모두 0, `effectiveLegs`에 stop 0개·1개인 날 → `[]`.
- [ ] **Step 2:** FAIL 확인. **Step 3:** 구현. **Step 4:** PASS 확인.
- [ ] **Step 5:** 커밋 `feat(domain): 구간 색인과 Day 합계`.

---

### Task 5: 날짜 묶음과 되돌리기

**Files:**
- Create: `src/domain/date-groups.ts`, `src/domain/revert.ts`
- Test: `tests/unit/domain/date-groups.test.ts`, `tests/unit/domain/revert.test.ts`

**Interfaces:**
- Consumes: `overlay`, `TripData`, `EditLayer`.
- Produces:
  - `type Placement = Record<string /*date*/, string[] /*stop ids*/>`
  - `groupDates(placements: Placement[], allDates: string[]): string[][]` — union-find. 같은 stop id가 여러 placement에서 서로 다른 날짜에 있으면 그 날짜들을 합친다. 각 묶음은 날짜 오름차순, 묶음 목록은 첫 날짜 오름차순.
  - `placementOfTrip(trip: TripData): Placement`, `placementOfEffective(eff: EffectiveTrip): Placement`
  - `planRevert(trip: TripData, edit: EditLayer, date: string): { dates: string[] }` — 원본과 local 실효 일정 두 placement로 묶음을 구해 `date`가 속한 묶음 반환.
  - `applyRevert(edit: EditLayer, dates: string[], now: string): EditLayer` — 각 날짜를 `{ mode: 'reset', updatedAt: now }`.

- [ ] **Step 1: 실패 테스트 작성**
  - `groupDates`: 원본 {D1:[X]}, local {D1:[], D2:[X]} → `[['D1','D2']]` 외 나머지는 단독.
  - **이동 후 출발일 되돌리기(§5.8)**: X를 D1→D2로 옮긴 edit에서 `planRevert(trip, edit, 'D1').dates` = `['D1','D2']`; `applyRevert` 후 `overlay` 결과 X가 D1에만 한 번.
  - 이동 없는 날: `planRevert(...).dates` = 그날 하나.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(domain): 날짜 묶음과 묶음 단위 되돌리기`.

---

### Task 6: 정리(reconcile)와 [내 편집 유지]

**Files:**
- Create: `src/domain/reconcile.ts`
- Test: `tests/unit/domain/reconcile.test.ts`

**Interfaces:**
- Consumes: `overlay`, `hashDayStops`, `groupDates`, `placementOfTrip`, `placementOfEffective`, `findDuplicateStopIds`.
- Produces:
  - `type ReconcileReport = { removedStops: { date: string; stopId: string; placeKey: string }[]; orphanPlaceKeys: string[]; hiddenEditDates: string[]; autoResetDates: string[]; unresolvedGroups: string[][] }`
  - `reconcile(trip: TripData, edit: EditLayer): { edit: EditLayer; report: ReconcileReport }` — §5.5 순서: (1) override에서 사라진 placeKey의 stop 제거, (2) override stops가 원본과 같으면 reset(`updatedAt`은 override 값 유지), (3) 고아·숨은 날짜 보고, (4) 미해결 날짜를 원본+local 실효 placement 묶음으로 확장해 `unresolvedGroups`, (5) `baseDataVersion = trip.dataVersion`. 입력 edit을 변경하지 않는다.
  - `keepMine(trip: TripData, edit: EditLayer, groupDates: string[], now: string): EditLayer | null` — §5.5 `[내 편집 유지]` 1~3단계. 검증 실패 시 `null`.

- [ ] **Step 1: 실패 테스트 작성**
  - **v2에 v1 편집**: v1 기준 override D1=[A, P]인데 v2에 P가 없음 → `removedStops`에 P, D1이 `unresolvedGroups`에 남음. 결과 edit을 다시 `reconcile`해도 미해결 유지(해시 기반 판정).
  - override가 원본과 같음 → reset, `updatedAt`이 원래 값과 같음.
  - 고아 PlaceEdit은 edit에 남고 `orphanPlaceKeys`에 보고.
  - **원본이 방문 날짜를 바꿈**: v1 D1=[X], local이 X note만 고친 override D1=[X'], v2 D2=[X] → `unresolvedGroups` = `[['D1','D2']]`. `keepMine(...)` → D2에 `[]` override가 생기고 두 날의 `baseDayHash`가 현재 원본 해시, 다시 `reconcile` 시 `unresolvedGroups` = `[]`, X는 한 번. `planRevert`+`applyRevert`(묶음 D1,D2) → X는 D2에만.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(domain): reconcile과 묶음 단위 내 편집 유지`.

---

### Task 7: 병합(merge)

**Files:**
- Create: `src/domain/lww.ts`, `src/domain/merge.ts`
- Test: `tests/unit/domain/merge.test.ts`

**Interfaces:**
- Consumes: `overlay`, `groupDates`, `placementOfTrip`, `placementOfEffective`, `findDuplicateStopIds`, `EditLayerSchema`.
- Produces:
  - `pickLww<T extends { updatedAt: string }>(a: T | undefined, b: T | undefined): T | undefined` — `updatedAt` 큰 쪽, 같으면 `JSON.stringify` 사전순 큰 쪽.
  - `type DayConflict = { id: string /* 묶음 첫 날짜 */; dates: string[]; defaultSide: 'local' | 'incoming'; promoted: boolean }`
  - `type MergeSummary = { memosAdded: number; memosChanged: number; memosDeleted: number; tagChanges: { placeKey: string; from: string[] | undefined; to: string[] }[]; hiddenChanges: { placeKey: string; from: boolean | undefined; to: boolean }[]; daysAdopted: string[] }`
  - `planMerge(local: EditLayer, incoming: EditLayer, trip: TripData): { conflicts: DayConflict[]; summary: MergeSummary }`
  - `applyMerge(local: EditLayer, incoming: EditLayer, trip: TripData, choices: Record<string, 'local' | 'incoming'>, now: string): { ok: true; edit: EditLayer } | { ok: false; reason: string }` — 선택이 없는 충돌은 `defaultSide`. 기본값이 아닌 쪽을 고른 묶음의 DayEdit은 `updatedAt = now`. 결과를 `EditLayerSchema`와 `findDuplicateStopIds(overlay(...).days)`로 검증. `authorId`, `baseDataVersion`은 local 값.

- [ ] **Step 1: 실패 테스트 작성** (§8.1 `domain/merge` 목록 전부, 각 1개 `it`)
  - 멱등: `applyMerge(m, incoming)` 결과에 같은 incoming을 다시 병합해도 같음.
  - 교환: 충돌 기본값에서 `merge(a,b)`와 `merge(b,a)`의 `{ authors, places, days }`가 같음.
  - 메모 툼스톤(`text: null`, 더 최신)이 옛 메모를 이김. 같은 닉네임·다른 authorId 메모는 둘 다 남음.
  - 태그(A)와 숨김(B) 필드별 유지.
  - reset(최신)이 옛 override 파일을 이김.
  - **날짜 간 이동**: 원본 D1=[X], D2=[Y]; A: D1=[], D2=[Y,X]; B(나중): D2=[Y']. `conflicts` = `[{ dates: ['D1','D2'], defaultSide: 'incoming' ... }]`; `local` 선택 → X는 D2에 한 번, `incoming` 선택 → X는 D1에 한 번. B가 D1을 고친 경우도 같은 묶음.
  - **같은 방문을 다른 날로**: A: D1=[], D2=[X]; B: D1=[], D3=[X] → `conflicts[0].dates` = `['D1','D2','D3']`, `promoted: true`, 어느 선택이든 `ok: true`, X 한 번.
  - authors 합집합 51명 → `{ ok: false }`, local 객체 불변(`toEqual` 원본 사본).
  - 기본값이 아닌 쪽 선택 → 결과 DayEdit `updatedAt === now`; 그 결과에 옛 incoming을 다시 병합해도 선택 유지.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 일정 병합 순서:

```
dates = 원본 날짜 ∪ local.days 키 ∪ incoming.days 키
groups = groupDates([원본, local 실효, incoming 실효], dates)
for g in groups:
  if 모든 날짜가 (한쪽만 DayEdit) 또는 (양쪽 mode·stops 동일):
     날짜별 채택(동일하면 pickLww) → 묶음 안 stop id 중복이면 promoted 충돌
  else: 충돌
  충돌의 defaultSide = 묶음 안 DayEdit 중 pickLww 승자 쪽
```

- [ ] **Step 4:** PASS 확인.
- [ ] **Step 5:** 커밋 `feat(domain): 필드별·날짜 묶음 병합`.

---

### Task 8: 편집 코덱

**Files:**
- Create: `src/domain/codec.ts`
- Test: `tests/unit/domain/codec.test.ts`

**Interfaces:**
- Produces:
  - `class CodecError extends Error { code: 'too-long' | 'too-large' | 'corrupt' }`
  - `encodeEditLayer(edit: EditLayer): Promise<string>` — JSON → `CompressionStream('deflate-raw')` → base64url(패딩 없음).
  - `decodeEditLayer(value: string): Promise<unknown>` — 길이 > `LIMITS.linkChars`면 `too-long`; `DecompressionStream`을 리더로 읽으며 누적 바이트가 `LIMITS.decodedBytes`를 넘는 순간 `reader.cancel()` 후 `too-large`; base64/압축/JSON 오류는 `corrupt`. 스키마 검증은 하지 않는다(호출자 몫).
  - (`CompressionStream`은 브라우저와 Node 22 전역 모두에 있다.)

- [ ] **Step 1: 실패 테스트** — 왕복 일치(`toEqual`), 16,001자 → `too-long`, 공백 2MB JSON을 압축한 값(16,000자 이내) → `too-large`, `"!!!"` → `corrupt`.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(domain): deflate-raw 편집 코덱과 크기 제한`.

---

## Phase 2 — 파이프라인

### Task 9: 네이버 클라이언트와 녹화 fixture

**Files:**
- Create: `pipeline/naver-client.ts`, `tests/fixtures/naver/bookmarks-sokcho.json`, `tests/fixtures/naver/bookmarks-page1.json`, `tests/fixtures/naver/bookmarks-page2.json`, `tests/fixtures/naver/route-ok.json`, `tests/fixtures/naver/route-error.json`, `tests/fixtures/naver/README.md`
- Test: `tests/unit/pipeline/naver-client.test.ts`

**Interfaces:**
- Produces:
  - `type Bookmark = { sid: string; name: string; address: string; px: number; py: number; memo: string; mcidName: string | null; creationTime: number; lastUpdateTime: number; available: boolean }`
  - `type FetchedFolder = { shareId: string; name: string; bookmarks: Bookmark[] }`
  - `type HttpDeps = { fetch: typeof fetch; sleep: (ms: number) => Promise<void> }`
  - `fetchFolder(shareId: string, deps: HttpDeps, pageSize = 500): Promise<FetchedFolder>` — `start=0&limit=<pageSize>`부터, 받은 수가 `pageSize`면 `start += pageSize` 반복. 요청 전마다 `sleep(300)`(첫 요청 제외).
  - `type RouteResult = { distanceM: number; durationMs: number; staticDurationMs: number; tollFare: number; path: [number, number][] }`
  - `fetchCarRoute(start: [number, number], goal: [number, number], deps: HttpDeps): Promise<RouteResult>` — `route` 첫 키의 `[0]`. 응답에 route가 없거나 HTTP 오류면 throw.
  - 헤더: UA `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36`, Referer는 폴더 `https://pages.map.naver.com/save-pages/detail-list/<shareId>`, 경로 `https://map.naver.com/`. `Origin`을 넣지 않는다.

- [ ] **Step 1: fixture 녹화(1회, 네트워크 사용)** — 워크스페이스 `CLAUDE.md`의 curl 명령으로 `fb65e7f93f8a4144a4ded594d604a7aa`(15곳) 폴더를 `limit=500`으로 받아 `bookmarks-sokcho.json`, 같은 폴더를 `limit=10`으로 `start=0`, `start=10` 두 번 받아 page1/page2로 저장(페이지네이션 테스트는 `pageSize = 10`을 주입). 경로는 `start=128.8961,37.7519&goal=128.9184,37.7952`를 `route-ok.json`으로. `route-error.json`은 `{"code":1,"message":"no route"}`. README에 녹화 날짜(2026-10-03)와 명령을 적는다.
- [ ] **Step 2: 실패 테스트** — 가짜 `fetch`가 URL별 fixture를 돌려준다:
  - `fetchFolder` 결과 `bookmarks.length === 15`, 첫 항목 `sid`가 문자열.
  - pageSize 10 → 요청 2회, `start=0`·`start=10`, 합계 15, `sleep`이 300으로 1회 호출.
  - 모든 요청 헤더에 `origin` 없음, `referer`가 규칙대로.
  - `fetchCarRoute` → `distanceM: 6689`, `path.length: 282`; error fixture → throw.
- [ ] **Step 3–4:** 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(pipeline): 네이버 폴더·경로 클라이언트와 녹화 fixture`.

---

### Task 10: 장소 구성, ID 생성, stop 연결

**Files:**
- Create: `pipeline/build-places.ts`, `pipeline/ids.ts`, `pipeline/resolve-stops.ts`
- Test: `tests/unit/pipeline/build-places.test.ts`, `ids.test.ts`, `resolve-stops.test.ts`

**Interfaces:**
- Consumes: `TripSource`, `Place`, `FetchedFolder`.
- Produces:
  - `buildPlaces(source: TripSource, folders: FetchedFolder[]): { folders: TripData['folders']; places: Record<string, Place>; report: { excludedUnavailable: number; excludedOutOfRange: { sid: string; name: string }[] } }` — §3.2 중복 병합 표, 폴더 ID `f1…`는 yaml `folders` 순서, `publish.naverMemo === false`면 `naverMemos` 생략, customPlaces는 `c:<key>`(category·savedAt null).
  - `ensureIds(doc: import('yaml').Document, random: (len: number) => string): { changed: boolean }` — `publicId`(10자), 각 stop `id`(4자, 기존 id와 충돌 시 재생성)를 Document에 써서 주석 보존.
  - `class UnresolvedPlacesError extends Error { places: { date: string; place: string }[] }`
  - `resolveStops(source: TripSource, places: Record<string, Place>): { date: string; stops: Stop[] }[]` — 숫자 문자열은 `n:<sid>`, 아니면 `c:<key>`. 없으면 `UnresolvedPlacesError`.

- [ ] **Step 1: 실패 테스트**
  - 같은 sid가 두 폴더: `lastUpdateTime` 큰 쪽 이름·좌표, `savedAt`은 작은 `creationTime`(ISO), `folderIds` = `['f1','f2']`, 두 메모 모두 `naverMemos`에(빈 메모 제외).
  - `available: false` 제외 및 개수 보고.
  - **Review Focus 2**: 좌표 `px: 139.7, py: 35.6`(도쿄) 항목은 `places`에 없고 `excludedOutOfRange`에 보고; 그 sid를 stop이 가리키면 `resolveStops`가 `UnresolvedPlacesError`.
  - `publish.naverMemo: false` → 어떤 Place에도 `naverMemos` 없음; 생략 → 있음. 출력 어디에도 shareId 문자열이 없음(`JSON.stringify(result)`에 `not.toContain(shareId)`).
  - `ensureIds`: id 없는 yaml에 주석 `# 점심`이 있는 stop → 실행 후 `doc.toString()`에 `# 점심` 유지, id 형식 `/^[a-z0-9]{4}$/`; 두 번째 실행은 `changed: false`.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(pipeline): 장소 병합·ID 생성·stop 연결`.

---

### Task 11: 경로 캐시, 단순화, 구간 생성

**Files:**
- Create: `pipeline/route-cache.ts`, `pipeline/simplify.ts`, `pipeline/legs.ts`
- Test: `tests/unit/pipeline/route-cache.test.ts`, `simplify.test.ts`, `legs.test.ts`

**Interfaces:**
- Consumes: `RouteResult`, `fetchCarRoute` 시그니처, `Place`, `Stop`.
- Produces:
  - `routeCacheKey(start: [number, number], goal: [number, number]): string` — `sha256(JSON.stringify({ cacheVersion: 1, start, goal, option: 'car:default' }))` hex, 좌표는 `Number(x.toFixed(7))`.
  - `type RouteCache = { get(key: string): Promise<(RouteResult & { queriedAt: string }) | null>; set(key: string, v: RouteResult & { queriedAt: string }): Promise<void> }`; `createFileRouteCache(dir: string): RouteCache` (`.cache/routes/<key>.json`).
  - `simplifyPath(path: [number, number][], toleranceM = 5): [number, number][]` — Douglas-Peucker, 거리는 위도 기준 등장방형 근사(m).
  - `buildLegs(days: { date: string; stops: Stop[] }[], places: Record<string, Place>, deps: { cache: RouteCache; fetchRoute: (s: [number, number], g: [number, number]) => Promise<RouteResult>; refresh: boolean; now: string }): Promise<{ days: Day[]; failed: { date: string; from: string; to: string }[] }>` — 순차 호출. 성공은 캐시 저장, **실패는 저장하지 않고** `failed` Leg(§3.2).

- [ ] **Step 1: 실패 테스트**
  - 좌표가 1e-7 바뀌면 키가 다름, 1e-8 차이는 같음.
  - 캐시 히트면 `fetchRoute` 미호출; `refresh: true`면 호출.
  - 실패 구간 → `status: 'failed'`, `durationMs: null`, `distanceKind: 'straight'`, 캐시에 없음 → 다음 호출에서 다시 `fetchRoute`.
  - `route-ok.json`의 282점 → `simplifyPath` 결과가 282점보다 적고 시작·끝점 동일.
  - stops 0개·1개 → legs `[]`.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(pipeline): 좌표 기반 경로 캐시와 구간 생성`.

---

### Task 12: collect·validate CLI

**Files:**
- Create: `pipeline/fs-port.ts`, `pipeline/collect.ts`, `pipeline/validate.ts`, `pipeline/cli/collect.ts`, `pipeline/cli/validate.ts`, `trips/example.yaml`, `tests/fixtures/trips/basic.yaml`
- Test: `tests/unit/pipeline/collect.test.ts`, `tests/unit/pipeline/validate.test.ts`

**Interfaces:**
- Consumes: Task 9–11 전부, `TripSourceSchema`, `TripDataSchema`.
- Produces:
  - `type FsPort = { readText(p: string): Promise<string>; writeTextAtomic(p: string, s: string): Promise<void>; listFiles(dir: string, ext: string): Promise<string[]> }` (`writeTextAtomic`: 같은 디렉터리 임시 파일 → `rename`).
  - `type CollectDeps = { fs: FsPort; http: HttpDeps; cache: RouteCache; random: (len: number) => string; now: () => string; log: (line: string) => void }`
  - `collect(yamlPath: string, opts: { refreshRoutes: boolean }, deps: CollectDeps): Promise<{ publicId: string; outPath: string; summary: CollectSummary }>` — §7.1 1–8. `dataVersion = now()`. 출력 `public/data/<publicId>.json`(2칸 들여쓰기 없이 한 줄).
  - `validateAll(deps: { fs: FsPort }): Promise<{ ok: boolean; errors: { file: string; message: string }[] }>` — `trips/*.yaml`, `public/data/*.json`.
  - CLI는 인자 파싱·실제 deps 조립·종료 코드만 담당(`UnresolvedPlacesError` → 1, 메시지에 날짜·place 목록).

- [ ] **Step 1: 실패 테스트(통합, 메모리 FsPort + fixture fetch)**
  - `basic.yaml`(id 없음) → yaml에 publicId·stop id가 써지고 주석 유지, JSON이 `TripDataSchema` 통과, 폴더 이름이 fixture 값.
  - 두 번째 실행: yaml 바이트 동일, 경로 API 호출 0회(캐시).
  - **빈 일정**: 마지막 stop을 지운 yaml → `stops: []`, `legs: []`로 통과.
  - 없는 sid → reject `UnresolvedPlacesError`, JSON 파일 미생성.
  - `validateAll`: 깨진 JSON 하나가 있으면 `ok: false`와 파일명.
- [ ] **Step 2–4:** FAIL → 구현 → PASS. `trips/example.yaml`은 §3.1 예시(출발지는 역 좌표, 주석으로 §9.2 안내).
- [ ] **Step 5: 실제 수집 1회(수동, 네트워크)** — `yarn collect trips/example.yaml` → 요약 출력 확인. 생성된 JSON과 yaml에 써진 ID는 커밋하지 않고 되돌린다(`git checkout trips/example.yaml`, JSON 삭제).
- [ ] **Step 6:** 커밋 `feat(pipeline): collect·validate CLI`.

---

### Task 13: apply-edit CLI

**Files:**
- Create: `pipeline/git-port.ts`, `pipeline/apply-edit.ts`, `pipeline/cli/apply-edit.ts`
- Test: `tests/unit/pipeline/apply-edit.test.ts`

**Interfaces:**
- Consumes: `reconcile`, `overlay`, `hashDayStops`, `EditLayerSchema`, `TripSourceSchema`, `TripDataSchema`, `FsPort`.
- Produces:
  - `type GitPort = { fetch(): Promise<boolean /*성공 여부*/>; behindCount(): Promise<number> }`; `createShellGitPort(cwd: string): GitPort` (`git fetch --quiet`, `git rev-list --count HEAD..@{u}`).
  - `class ApplyEditError extends Error { code: 'behind-origin' | 'newer-base' | 'invalid-edit' | 'unresolved' | 'would-remove' | 'yaml-drift' | 'invalid-result'; details: string[] }`
  - `applyEdit(yamlPath: string, editPath: string, deps: { fs: FsPort; git: GitPort; log: (l: string) => void }): Promise<{ appliedDates: string[] }>` — §5.7 검사 0→3 순서, 모두 통과 후에만 `writeTextAtomic`. 안내 문구는 §5.7 그대로(`git pull`로 최신 yaml과 JSON을 함께 받으세요). `collect` 재실행을 안내하지 않는다.

- [ ] **Step 1: 실패 테스트** (실패 케이스는 모두 yaml 바이트 불변을 함께 단언)
  - 정상: override D1을 yaml에 반영, 주석 유지, reset 날·편집 없는 날 그대로.
  - 미해결 원본 변경 → `unresolved`.
  - `edit.baseDataVersion > json.dataVersion` → `newer-base`.
  - **오래된 yaml 재수집 우회**: 편집이 customPlace `c:y`를 쓰는데 JSON(더 새 `dataVersion`)에 `c:y` 없음 → `would-remove`, details에 장소·날짜.
  - `behindCount() > 0` → `behind-origin`; `fetch()`가 false면 경고 로그 후 계속. 추가로 `createShellGitPort`를 임시 저장소 2개(원격·클론)로 구성해 클론이 뒤처졌을 때 `behindCount() === 1`.
  - **미수집 yaml 보호**: yaml D1 stops ≠ JSON D1 stops → `yaml-drift`, details에 날짜별 차이.
  - **빈 일정**: 마지막 stop을 뺀 override → 반영 후 `TripSourceSchema` 통과, 이어서 `collect`(Task 12 통합 deps) → `stops: []`, `legs: []`.
  - 통합: A→C→B 재정렬 → apply-edit → collect → 새 구간(A→C, C→B)만 `fetchRoute` 호출.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(pipeline): apply-edit CLI와 안전 검사`.

---

## Phase 3 — 앱

### Task 14: 저장소 계층과 가져오기 흐름

**Files:**
- Create: `src/repositories/trip-repo.ts`, `src/repositories/edit-layer-repo.ts`, `src/repositories/import-flow.ts`, `src/models/place.ts`
- Test: `tests/unit/repositories/trip-repo.test.ts`, `edit-layer-repo.test.ts`, `import-flow.test.ts`

**Interfaces:**
- Consumes: 스키마, `decodeEditLayer`, `reconcile`, `planMerge`, `applyMerge`.
- Produces:
  - `type TripLoadResult = { ok: true; trip: TripData } | { ok: false; kind: 'not-found' | 'invalid'; message: string; schemaVersion?: unknown }`
  - `loadTrip(publicId: string, opts?: { noCache?: boolean; fetchFn?: typeof fetch }): Promise<TripLoadResult>` — `GET /data/<publicId>.json`, `noCache`면 `cache: 'no-cache'`.
  - `storageKey(publicId: string): string`; `isStorageAvailable(storage: Storage | undefined): boolean` (쓰기·삭제 시도);
    `withEditLock<T>(publicId: string, deps: { locks?: LockManager }, fn: () => T | Promise<T>): Promise<T>` — `locks.request('tripmap:edit:<publicId>', fn)`, `locks`가 없으면 `fn()`을 그대로 실행(한계는 README).
    `updateEditLayer(publicId: string, fn: (current: EditLayer | null) => EditLayer, deps: { storage: Storage; locks?: LockManager; now: () => number }): Promise<EditLayer>` — `withEditLock` 안에서 **저장소의 최신 레이어를 다시 읽어**(없으면 null) `fn`을 적용하고 쓴다. **앱에서 EditLayer를 저장소에 쓰는 곳은 이 함수와 `commitImport` 둘뿐이다.**
    `readEditLayer(storage: Storage, publicId: string, now: number): { edit: EditLayer | null; raw: string | null; corruptBackedUp: boolean }` — 파싱 후 `migrateEditLayer(raw: unknown): unknown`(v1은 그대로 반환하는 체인의 자리, §5.1)을 거쳐 검증; 실패하거나 `schemaVersion`이 1보다 크면 `…:corrupt:<now>`로 백업 후 키 삭제; `writeEditLayer(storage: Storage, edit: EditLayer): void`.
  - `type ImportInput = { kind: 'link'; value: string } | { kind: 'file'; file: Blob }`
  - `type PreparedImport = { trip: TripData; tripRefreshed: boolean; local: EditLayer; localSnapshot: string | null; incoming: EditLayer; incomingReport: ReconcileReport; plan: ReturnType<typeof planMerge> }` — `localSnapshot`은 준비 시점 저장소의 원문(`readEditLayer().raw`, 처음 방문이면 null). `local`은 저장된 레이어 또는 임시 작성자 레이어.
  - `type ImportFailure = { ok: false; reason: 'too-long' | 'too-large' | 'corrupt' | 'invalid' | 'other-trip' | 'trip-stale'; message: string }`
  - `prepareImport(input: ImportInput, ctx: { trip: TripData; local: EditLayer; localSnapshot: string | null; refetchTrip: () => Promise<TripLoadResult> }): Promise<{ ok: true; prepared: PreparedImport } | ImportFailure>` — §5.3 1–5. 파일은 `file.size > LIMITS.fileBytes`면 `too-large`(읽기 전).
  - `commitImport(prepared: PreparedImport, choices: Record<string, 'local' | 'incoming'>, now: string, deps: { storage: Storage; locks?: LockManager }): Promise<{ ok: true; edit: EditLayer } | { ok: false; reason: 'changed' | string }>` — `withEditLock` 안에서 저장소 원문을 다시 읽어 `prepared.localSnapshot`과 다르면 **쓰지 않고** `{ ok: false, reason: 'changed' }`. 같으면 `applyMerge` 후 성공 시에만 저장.
  - `naverPlaceUrl(place: Place): string | null` (`https://m.place.naver.com/place/<sid>`, custom은 null).

- [ ] **Step 1: 실패 테스트**
  - `loadTrip`: 404 → `not-found`; 스키마 위반 → `invalid`와 `schemaVersion`.
  - `readEditLayer`: 깨진 문자열 → `corruptBackedUp: true`, 백업 키에 원문, 원래 키 삭제. `isStorageAvailable`: `setItem`이 throw하면 false.
  - **새 기준 파일 가져오기**: `incoming.baseDataVersion`이 더 새로우면 `refetchTrip` 호출; 새 trip이면 `tripRefreshed: true`로 진행, 여전히 오래되면 `{ ok: false, reason: 'trip-stale' }`이고 local 객체 불변.
  - 다른 publicId → `other-trip`. 1MB 초과 Blob → `too-large`.
  - 고아 PlaceEdit은 `prepared.local`에 유지.
  - **미리보기 후 다른 탭 편집**: `prepareImport` → 저장소를 장소 p1 메모가 추가된 레이어로 교체(다른 탭 흉내) → `commitImport` → `{ ok: false, reason: 'changed' }`, 저장소는 p1 메모 레이어 그대로. 최신 값으로 다시 `prepareImport` → `commitImport` → 결과에 p1 메모와 가져온 편집 모두 존재.
  - 처음 방문(snapshot null)인데 준비 후 다른 탭이 레이어를 만들었으면 `changed`.
  - `updateEditLayer`: 저장소가 L1(p1 메모)로 바뀐 뒤 오래된 화면에서 p2 메모 추가 → 저장 결과에 p1·p2 모두. `locks` 있음·없음 각각.
  - 첫 레이어 생성: 저장소가 비어 있으면 `fn`이 null을 받음; `current => current ?? draft`로 호출했는데 그사이 다른 레이어가 저장돼 있으면 기존 레이어가 그대로 남음(draft로 덮지 않음).
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(app): trip·edit 저장소와 가져오기 흐름`.

---

### Task 15: 앱 셸, 상태, 공통 화면

**Files:**
- Create: `src/routes/paths.ts`, `src/routes/router.tsx`, `src/pages/HomePage.tsx`, `src/pages/TripPage.tsx`, `src/theme/theme.ts`, `src/layouts/TripLayout.tsx`, `src/stores/trip-store.ts`, `src/stores/ui-store.ts`, `src/components/NicknameDialog.tsx`, `src/components/ReconcileBanner.tsx`, `src/components/ErrorScreen.tsx`
- Modify: `src/app.tsx`
- Test: `tests/unit/components/trip-page.test.tsx`, `tests/unit/stores/trip-store.test.ts`

**Interfaces:**
- Consumes: Task 14 저장소(`readEditLayer`, `updateEditLayer`, `withEditLock`), `overlay`, `reconcile`, `keepMine`, `planRevert`, `applyRevert`.
- Produces:
  - `paths = { home: '/', trip: (id: string) => `/t/${id}` }`
  - `tripAtom: PrimitiveAtom<TripData | null>`.
  - `editLayerAtom` — **저장을 일으키지 않는 메모리 atom**(`atomWithStorage`를 쓰지 않는다; 그 setter는 `storage.setItem`을 호출하므로 잠금 밖 재저장이 생긴다). `createTripStore(publicId, deps)`가 라우트 `Provider`용 atom 묶음을 만든다.
    - 초기값: `readEditLayer(storage, publicId, now())`(검증·백업 경유)의 `edit`.
    - `onMount`: `storage` 이벤트 중 같은 키만 받아 `readEditLayer`로 다시 읽어 유효하면 atom에 반영, 무효면 무시(`console.warn`).
    - `refreshEditLayer()`: 저장소에서 다시 읽어 atom에 반영. 저장 후 화면 갱신은 반환값이 아니라 **이 재읽기**로 한다 — 잠금 해제 직후 다른 탭이 쓴 값까지 보이게.
  - `effectiveTripAtom` (읽기 전용 = `overlay(trip, edit)`), `reconcileReportAtom`.
  - `useEditActions(): { ensureAuthor(): Promise<boolean>; prepareImportContext(): Promise<{ local: EditLayer; localSnapshot: string | null } | null>; update(fn: (e: EditLayer) => EditLayer): Promise<void> }`
    - `ensureAuthor`: 메모리 atom이 null이면 `NicknameDialog`로 닉네임을 받아 draft(`newEditLayer`, authorId = `crypto.randomUUID()`)를 만들고 `updateEditLayer(id, current => current ?? draft)`로 저장 — 닉네임 입력 중 다른 탭이 레이어를 만들었다면 그 레이어를 보존한다. 이어서 `refreshEditLayer()`. 대화상자 취소 시 false, 저장소 불변.
    - `prepareImportContext`: 가져오기 전용(Task 19). **`readEditLayer()`를 한 번 호출한 `{ edit, raw }` 쌍**으로 컨텍스트를 만든다. `edit`이 있으면 `{ local: edit, localSnapshot: raw }`(메모리 atom 값을 쓰지 않는다). `edit`이 null일 때만 닉네임을 받아 **저장하지 않은** draft로 `{ local: draft, localSnapshot: null }`. 닉네임 취소 시 null.
    - `update`: `ensureAuthor()` 후 `updateEditLayer(id, current => { if (!current) throw new Error('edit layer missing'); return fn(current) })`, 저장 뒤 `refreshEditLayer()`. atom setter는 메모리만 바꾼다. 스토리지 불가 시 토스트 "이 브라우저에서는 저장되지 않아요. 내보내기를 이용하세요"를 띄우고 메모리 상태로만 진행.
  - 상단 바 메뉴 `닉네임 변경` → `authors[authorId] = { nickname, updatedAt: now }`. 검색 입력은 상단 바에 두고 값은 Task 17의 `ExploreFilter.query`로 전달.
  - `ReconcileBanner`는 미해결 묶음 외에 `report.removedStops`("원본에서 사라진 장소 N곳을 일정에서 뺐어요"), `orphanPlaceKeys`("사라진 장소의 메모 N건을 보관 중이에요 — 내보내기에 포함돼요"), `hiddenEditDates`("여행 기간에서 빠진 날짜의 편집 N건이 있어요")를 각각 한 줄로 보여 준다(0건이면 생략).
  - `ui-store`: `modeAtom: 'explore' | 'itinerary'`, `selectedDayAtom: string | 'all'`, `selectedPlaceAtom: string | null` — URL 쿼리 `mode`, `day`(1부터 번호), `place`와 양방향 동기화.
  - `TripLayout` props: `{ topBar: ReactNode; map: ReactNode; panel: ReactNode }` — `useMediaQuery('(max-width: 767px)')`이면 하단 시트(peek/half/full 3단, 드래그 핸들), 아니면 오른쪽 400px 접이식 패널.

- [ ] **Step 1: 실패 테스트**
  - `/`에 "공유받은 링크로 접속하세요", 여행 목록·링크 없음.
  - 404 → "링크가 잘못되었거나 만료된 여행입니다". 검증 실패 → `schemaVersion`과 첫 오류 표시.
  - 로드 시 `reconcile` 실행: 미해결 묶음이 있으면 배너 "Day 1 원본이 바뀌었어요(관련: Day 2)"와 두 버튼; `[내 편집 유지]` → `keepMine` 결과 저장, 배너 사라짐; `keepMine`이 null이면 `[원본 보기]`만 남음.
  - **실제 store 경유 검증**(`createStore()` + `store.get/set`): 저장소에 `{"schemaVersion":1}`(JSON은 유효, 스키마 위반)을 넣고 store 생성 → atom 값 null, 백업 키에 원문, 원래 키 삭제. 다른 탭 이벤트(저장소를 유효 레이어로 바꾼 뒤 `StorageEvent` 발생) → atom이 새 값; 무효 값 이벤트 → atom 값 그대로.
  - **잠금 밖 재저장 없음**: `storage.setItem`을 spy. `update` 1회 → `setItem` 정확히 1회. 메모리 atom을 직접 `store.set` → `setItem` 0회.
  - **Review Focus 4 (끼어들기)**: 해제 시점을 제어하는 가짜 `LockManager`로 탭 A의 `update`가 잠금을 풀고 `refreshEditLayer` 전에 멈추게 한다 → 그 사이 탭 B 역할로 저장소에 p2 메모 레이어 기록 → A 재개 → 저장소는 B의 값(p1·p2 메모 모두)이고 A의 atom도 같은 값.
  - 쿼리 `?mode=itinerary&day=2` → `modeAtom === 'itinerary'`, `selectedDayAtom`이 두 번째 날짜.
  - 고아 2건·제거 방문 1건인 report → 해당 두 줄만 표시.
  - 닉네임 변경 → `authors[authorId].nickname` 갱신, `updatedAt` 현재 시각.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(app): 라우트·상태·레이아웃과 정리 배너`.

---

### Task 16: 지도 어댑터

**Files:**
- Create: `src/components/map/MapAdapter.ts`, `src/components/map/load-naver-sdk.ts`, `src/components/map/NaverMapAdapter.ts`, `src/components/map/FakeMapAdapter.ts`, `src/components/map/MapView.tsx`
- Test: `tests/unit/components/map-view.test.tsx`

**Interfaces:**
- Produces:
  - `type Bounds = { west: number; south: number; east: number; north: number }`
  - `interface MapAdapter { mount(el: HTMLElement): Promise<void>; setMarkers(markers: MapMarker[]): void; setPolylines(lines: MapPolyline[]): void; fitBounds(points: [number, number][]): void; onMarkerClick(cb: (id: string) => void): void; onBoundsChange(cb: (b: Bounds) => void): void; destroy(): void }`
  - `type MapMarker = { id: string; lng: number; lat: number; label?: string; color: string; dimmed?: boolean; selected?: boolean; clusterable: boolean }`
  - `type MapPolyline = { id: string; path: [number, number][]; color: string; dashed: boolean }`
  - `loadNaverSdk(clientId: string, timeoutMs = 10000): Promise<void>` — `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=<clientId>` 스크립트 주입, 실패·타임아웃 reject. (`ncpKeyId`/`ncpClientId` 파라미터명은 NCP 콘솔 발급 키 종류에 맞춰 확인 — 확인 결과를 이 파일 주석에 날짜와 함께 기록.)
  - `NaverMapAdapter`: 클러스터는 `supercluster`로 줌별 계산해 클러스터 마커로 그림. 마커 라벨은 HTML 문자열이 아니라 DOM 요소의 `textContent`로 만든다.
  - `FakeMapAdapter`: `<div data-testid="fake-map">` 안에 마커마다 `<button data-testid="marker-<id>">label</button>`, 폴리라인마다 `<div data-testid="polyline-<id>" data-dashed>`; E2E·RTL에서 사용.
  - `MapView` props: `{ markers: MapMarker[]; polylines: MapPolyline[]; onMarkerClick(id: string): void; onBoundsChange?(b: Bounds): void; onUnavailable(reason: string): void }`
  - `mapUnavailableAtom: PrimitiveAtom<string | null>` — `onUnavailable`이 사유를 기록하면 `TripLayout`이 지도 영역을 숨기고 패널을 전체 폭(모바일은 시트 full)으로 보여 주며 사유를 상단에 표시(§6 목록 전용 모드).
  - `categoryColor(category: string | null): string` — 카테고리 문자열 해시로 고정 팔레트(8색)에서 선택, null은 회색. `dayColor(index: number): string` — 날짜 순번별 팔레트. — 어댑터는 `import.meta.env.VITE_MAP_ADAPTER === 'fake'`면 Fake, 아니면 Naver. SDK 실패 시 `onUnavailable("지도를 불러오지 못했어요. 도메인 등록을 확인하세요")`.
- [ ] **Step 1: 실패 테스트** — Fake로 마커 클릭 콜백; `loadNaverSdk` 실패 시 `onUnavailable` 호출 → `TripLayout`에 지도 없이 패널과 사유 문구; **Review Focus 1**: label `<img src=x onerror=alert(1)>`인 마커가 텍스트 그대로 보이고 `img` 요소가 생기지 않음(Fake와 Naver 라벨 생성 함수 `createMarkerLabelElement` 공통 테스트).
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(map): 지도 어댑터(네이버·가짜)와 클러스터`.

---

### Task 17: 탐색 모드

**Files:**
- Create: `src/sections/explore/store/filters.ts`, `src/sections/explore/view/ExploreFilters.tsx`, `src/sections/explore/view/PlaceList.tsx`, `src/sections/explore/view/PlaceCard.tsx`, `src/sections/explore/view/ExplorePanel.tsx`
- Test: `tests/unit/sections/explore-filters.test.ts`, `tests/unit/components/place-card.test.tsx`

**Interfaces:**
- Consumes: `effectiveTripAtom`, `useEditActions`, `naverPlaceUrl`, `MapView`.
- Produces:
  - `type ExploreFilter = { folderIds: string[]; categories: string[]; tags: string[]; hasMemo: boolean; inItinerary: 'any' | 'in' | 'out'; showHidden: boolean; query: string; inViewOnly: boolean }`
  - `filterPlaces(trip: TripData, edit: EditLayer | null, eff: EffectiveTrip, f: ExploreFilter, bounds?: Bounds): string[]` (placeKey 목록) — 검색 대상: 이름·주소·네이버 메모·사용자 메모·태그, 대소문자·한글 자모 그대로 `includes`.
  - `categoryCounts(trip: TripData): { category: string; count: number }[]` (많은 순).
  - `PlaceCard` props: `{ placeKey: string }` — 메모 저장 시 `memos[authorId] = { text, updatedAt: now }`, 삭제는 `text: null`; 태그·숨김은 필드별 `updatedAt`; `[일정에 추가]`는 Day 선택 후 `ensureOverride`(Task 3)로 시작해 새 stop(id = 4자 무작위, 여행 내 유일)을 끝에 추가.
  - `ExplorePanel`은 필터 결과를 `MapView` 마커(`categoryColor`, `clusterable: true`, 선택 시 `selected`)로 넘기고, 목록 클릭 → `selectedPlaceAtom` 설정 + 지도 이동, 마커 클릭 → 목록 해당 항목으로 스크롤. `inViewOnly`면 `onBoundsChange`의 Bounds로 거른다.
- [ ] **Step 1: 실패 테스트**
  - 폴더·카테고리·태그·상태·검색 조합 표 기반.
  - Fake 지도에서 `marker-n:1` 클릭 → 목록의 해당 항목이 선택 상태, 목록 클릭 → 해당 마커 `selected`.
  - 숨김 장소는 기본 제외, `showHidden`이면 포함.
  - 다른 사람 메모는 닉네임과 함께 읽기 전용, 내 메모만 편집·삭제 버튼.
  - `publish.naverMemo: false`로 만든 trip(=`naverMemos` 없음)에서는 네이버 메모 영역이 없음.
  - **Review Focus 1**: 이름·네이버 메모에 `<img src=x onerror=alert(1)>` → 문자 그대로 보이고 `container.querySelector('img')`가 null.
  - custom 장소엔 `[네이버에서 열기]` 없음.
  - **줄어든 원본 날에 추가**: 원본 D2=[A, X, B]에서 X가 D1 override로 배치된 상태로 D2에 P 추가 → 실효 D2 = [A, B, P], `findDuplicateStopIds` = `[]`.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(explore): 필터·목록·장소 카드`.

---

### Task 18: 일정 모드

**Files:**
- Create: `src/sections/itinerary/store/itinerary-actions.ts`, `src/sections/itinerary/view/DayTabs.tsx`, `Timeline.tsx`, `LegRow.tsx`, `DayTotals.tsx`, `RevertDialog.tsx`, `ItineraryPanel.tsx`
- Test: `tests/unit/sections/itinerary-actions.test.ts`, `tests/unit/components/timeline.test.tsx`

**Interfaces:**
- Consumes: `effectiveTripAtom`, `buildLegIndex`, `effectiveLegs`, `dayTotals`, `planRevert`, `applyRevert`, `hashDayStops`, `useEditActions`, `MapView`.
- Produces (`itinerary-actions.ts`, 모두 순수 함수 `(trip, edit, …, now) => EditLayer`):
  - `moveStop(trip, edit, stopId, fromDate, toDate, now)` — 같은 stop id 유지, 두 날 override를 같은 `now`로 기록.
  - `removeStop(trip, edit, date, stopId, now)`
  - `updateStop(trip, edit, date, stopId, patch: { time?: string | null; note?: string | null }, now)`
  - 공통 규칙: 모든 액션은 `ensureOverride`(Task 3)로 시작한다. stop은 인덱스가 아니라 id로 가리킨다 — 다른 탭의 저장이 반영된 최신 레이어에 적용될 수 있기 때문(Task 15).
  - `reorderStops`의 시그니처는 `(trip, edit, date, stopId, toIndex, now)`.
  - 표시 문구(§4.4 그대로): 계산 `🚗 {h}시간 {m}분 · 도로 {km}km · {원}원`, 미계산 `┄ 직선 {km}km · 시간 미상 · 재계산 필요`, 합계 `계산된 구간 … · 미계산 {n}구간(직선 {km}km)` (미계산 0이면 뒷부분 생략), 거리는 소수 1자리 km, 금액은 천 단위 쉼표.
- [ ] **Step 1: 실패 테스트**
  - `moveStop` 후 `overlay` 결과 X는 도착일에 한 번, 두 DayEdit `updatedAt` 같음.
  - 타임라인 드래그(dnd-kit 키보드 센서로 Space→ArrowDown→Space) → `reorderStops` 반영, 구간 행이 미계산 문구로 바뀜.
  - Day 합계 문구가 위 형식과 정확히 일치(예: `계산된 구간 2시간 40분 · 도로 186.0km · 8,500원 · 미계산 2구간(직선 5.1km)`).
  - `[원본 일정으로 되돌리기]`: 이동 없는 날은 즉시 reset; 이동이 있으면 `RevertDialog`에 "Day 1의 방문이 Day 2로 옮겨져 있어 Day 1, Day 2를 함께 원본으로 되돌립니다. Day 2의 다른 편집도 함께 사라져요." 표시 후 확인 시 두 날 reset.
  - **Review Focus 3**: stop 0개인 날 → "방문 없음", 합계 줄 없음; 1개인 날 → 구간 행 없음.
  - 반복 방문 마커 라벨 `①⑥`(같은 placeKey의 순번을 원문자로 이어 붙임).
  - 미계산 구간이 있는 override가 하나라도 있으면 패널 하단에 "재계산하려면 편집을 파일로 내보내 `apply-edit`을 실행하세요".
  - 후보 레이어 토글 시 일정에 없는 장소가 `dimmed` 마커로, 클릭 → 선택한 날에 추가.
  - "전체" 탭: 모든 날의 폴리라인이 `dayColor(i)`로, 미계산 구간 폴리라인은 `dashed: true`.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(itinerary): Day 탭·타임라인·편집·묶음 되돌리기`.

---

### Task 19: 내보내기·가져오기 UI

**Files:**
- Create: `src/sections/share/view/ExportDialog.tsx`, `src/sections/share/view/ImportDialog.tsx`, `src/sections/share/use-hash-import.ts`
- Test: `tests/unit/components/export-dialog.test.tsx`, `tests/unit/components/import-dialog.test.tsx`

**Interfaces:**
- Consumes: `encodeEditLayer`, `prepareImport`, `commitImport`, `useEditActions`, `tripAtom`, `loadTrip`.
- Produces:
  - `ExportDialog`: 링크 = `${location.origin}/t/${publicId}#e=${encoded}`. 순서: `navigator.share`가 있으면 공유 시트 → 없거나 실패하면 `navigator.clipboard.writeText` → 그것도 실패하면 링크를 읽기 전용 `TextField`(전체 선택)로 표시. 링크가 8,000자 초과면 "링크가 길어요. 파일로 내보내 주세요" 안내와 파일 버튼 강조. 파일명 `<제목>-<닉네임>-<YYYYMMDD>.tripedit.json`(압축 안 한 JSON, `Blob` 다운로드).
  - `useHashImport()`: 진입 시 `location.hash`가 `#e=`로 시작하면 값을 꺼내 `ImportDialog`를 열고, 결과와 무관하게 `history.replaceState(null, '', location.pathname + location.search)`.
  - `ImportDialog`: 가져오기 전 `prepareImportContext()`로 `{ local, localSnapshot }`을 받는다(한 번의 저장소 읽기에서 나온 쌍; 처음 방문한 브라우저면 저장하지 않은 draft와 null). 이 쌍을 그대로 `prepareImport`의 `ctx.local`·`ctx.localSnapshot`으로 쓰고(미리보기 재생성 때도 매번 `prepareImportContext()`를 다시 호출), 저장은 확인 시 `commitImport`(잠금 안 스냅샷 비교 후 저장)가 한다. `reason: 'changed'`면 저장하지 않은 채 최신 저장값으로 `prepareImport`를 다시 실행해 미리보기를 새로 보여 주고 "다른 탭에서 편집이 바뀌어 미리보기를 새로 만들었어요"를 표시(충돌 선택은 기본값으로 초기화). 성공하면 `refreshEditLayer()`, 그리고 `prepared.tripRefreshed`이면 `tripAtom`에 `prepared.trip`을 반영(이후 overlay·reconcile 배너가 새 원본 기준이 되도록). 닉네임 취소·검증 실패·`ok: false`·대화상자 취소는 모두 저장소를 건드리지 않는다. 미리보기에 §5.3-5 항목(메모 추가/변경/삭제 수, 덮어써지는 태그·숨김 `from → to`, 충돌 묶음별 "내 것/받은 것" 라디오(기본값 선택), 정리 내역: 제거될 방문·표시되지 않을 날짜·원본이 바뀐 날). 확인 → `commitImport(..., new Date().toISOString())`; `ok: false`면 사유를 보여 주고 상태 유지. 실패 사유 문구: `too-long`/`too-large` "가져오기 데이터가 너무 커요", `corrupt`/`invalid` "가져오기 데이터가 손상됐어요", `other-trip` "다른 여행의 편집이에요", `trip-stale` "최신 여행 데이터가 아직 반영되지 않았어요. 잠시 후 다시 시도하세요."
- [ ] **Step 1: 실패 테스트**
  - 짧은 편집 → share 없음·clipboard 있음 → `writeText` 인자가 정확히 `` `${location.origin}/t/${publicId}#e=${await encodeEditLayer(edit)}` ``와 같고, 그 `#e=` 뒤 값을 `decodeEditLayer`하면 원래 편집과 `toEqual`.
  - **Review Focus 5**: share·clipboard 모두 없음(또는 reject) → 링크 텍스트 필드가 보이고 값이 링크.
  - 8,001자 링크 → 파일 안내 문구.
  - `#e=` 진입 → 대화상자 열림, 취소해도 `location.hash === ''`.
  - 충돌 묶음 라디오 기본값이 `defaultSide`, 반대쪽 선택 후 확인 → 결과 DayEdit `updatedAt`이 현재 시각.
  - `trip-stale` → 문구 표시, 저장소 미변경.
  - **atom은 오래되고 저장소는 최신**: 메모리 atom은 L0, 저장소는 L1(p1 메모)이고 `StorageEvent`는 아직 발생시키지 않은 상태에서 가져오기 → 미리보기의 local이 L1 → 확인 → 결과에 p1 메모와 가져온 편집 모두(스냅샷 검사 통과 후에도 B 편집 보존).
  - 원본을 다시 받은 가져오기(`tripRefreshed: true`) 성공 → `tripAtom`의 `dataVersion`이 새 값.
  - **미리보기 중 다른 탭 편집**: 미리보기 표시 → 저장소에 p1 메모 레이어 기록 + `StorageEvent` → 확인 → 안내 문구와 새 미리보기, 저장소는 p1 메모 그대로 → 다시 확인 → 저장 결과에 p1 메모와 가져온 편집 모두.
  - **첫 방문 브라우저(local = null)**: 손상 링크 가져오기 → 오류 문구, `localStorage.getItem(storageKey(id))`가 여전히 null. 정상 링크로 미리보기까지 간 뒤 취소 → 여전히 null. 확인 → 그때만 레이어 저장(닉네임·authorId 포함).
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** 커밋 `feat(share): 링크·파일 내보내기와 가져오기 미리보기`.

---

### Task 20: E2E, 배포 설정, 운영 문서

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/share.spec.ts`, `tests/e2e/itinerary.spec.ts`, `tests/e2e/concurrent.spec.ts`, `tests/fixtures/trips/e2e.json`(→ 테스트 시 `public/data/e2etest000001.json`으로 복사하는 global setup), `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: 완성된 앱, `VITE_MAP_ADAPTER=fake`.
- Produces:
  - Playwright 프로젝트 `desktop`(Chromium 1280×800), `mobile`(`devices['iPhone 13']`), `webServer`: `VITE_MAP_ADAPTER=fake yarn vite --port 5173`.
  - CI: push·PR에서 `yarn install --frozen-lockfile && yarn lint && yarn build:ci && npx playwright install --with-deps && yarn test:e2e`.
- [ ] **Step 1: E2E 작성**
  - `share.spec.ts`(mobile): 링크 열기 → 장소 카드에서 메모 → 닉네임 "동행" 입력 → 내보내기(클립보드 권한 부여, 실패 시 텍스트 필드에서 값 읽기) → 새 `browser.newContext()`에서 그 링크 열기 → 가져오기 확인 → 메모가 "동행" 이름으로 보임.
  - `concurrent.spec.ts`(desktop, **Review Focus 4**): 같은 context에서 페이지 A·B로 같은 여행을 연다(닉네임 미리 설정). (1) A가 장소 1 메모 저장 → B는 새로고침 없이 장소 2 메모 저장 → 두 페이지 새로고침 후 두 메모 모두 보임. (2) A·B에서 `Promise.all`로 거의 동시에 서로 다른 장소 메모 저장을 20회 반복 → 새로고침 후 40개 메모 모두 보임(실제 Web Locks 경로). 끼어들기 순서의 결정적 재현은 Task 15 단위 테스트가 담당.
  - `itinerary.spec.ts`(desktop): Day1 순서 변경 → 미계산 문구 → 파일 내보내기 A 저장 → 되돌리기 → A 다시 가져오기 → 충돌 기본값이 되돌린 상태(reset이 최신) → 일정이 원본과 같음.
- [ ] **Step 2:** `yarn test:e2e` → 두 프로젝트 모두 PASS.
- [ ] **Step 3: README** — 설치, 알려진 한계(Web Locks 미지원 브라우저의 동시 저장, 여러 파일 가져오기 순서 의존, LWW 시계 의존), 개발 서버, 환경변수 `VITE_NAVER_MAP_CLIENT_ID`, NCP 콘솔 도메인 등록(Pages 도메인, `http://localhost:5173`), 여행 추가 절차(yaml 작성 → `yarn collect` → 커밋·push), **재계산 절차(§5.7 1–5단계, "최신 기준은 `git pull`로만")**, Cloudflare Pages 설정(빌드 명령 `yarn build:ci`, 출력 `dist`, Node 22), 공개 범위 주의(§9.2 표 요약), 수동 확인 체크리스트(§8.4).
- [ ] **Step 4:** `yarn build:ci` 전체 성공 확인.
- [ ] **Step 5:** 커밋 `test(e2e): 공유·일정 시나리오와 배포 설정, 운영 문서`.

- [ ] **Step 6 (사용자와 함께, 배포 후):** Cloudflare Pages 연결·환경변수 설정, 실제 여행 yaml로 collect·배포, §8.4 수동 확인(실제 네이버 지도 렌더링, iOS Safari·Android Chrome에서 카카오톡 링크 → 메모 → 공유 시트 내보내기 → 상대 기기 가져오기). NCP Maps 요금·무료 사용량을 확인해 README에 날짜와 함께 기록.
