# 여행 계획 (하위 프로젝트 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보관함 장소로 여행 후보를 모으고, Day에 넣어 순서를 정하며, 자동차·도보 경로와 도착 시각을 바로 보여 주는 여행 계획 기능을 만든다.

**Architecture:** 여행은 보관함 문서(`Library.trips`)에 저장한다. 계산(구간·시각·순서 정리·자동 나누기)은 `src/domain/trips/`의 순수 함수다. 경로는 Cloudflare Pages Function `/api/route`가 네이버 자동차·도보 길찾기를 정규화해 돌려주고, 앱의 Effect 서비스 `RouteLookup`이 문서 밖 캐시(`tripmap:routes:v1`)와 함께 부른다. 화면은 `/trips`(목록)와 `/trips/:id`(후보 · 지도 · Day 시간표)다.

**Tech Stack:** TypeScript 6, React 19, MUI 7, Jotai, Effect 4.0.2, @dnd-kit, Vite 8, Vitest 5, Playwright, Cloudflare Pages Functions.

**Spec:** `docs/superpowers/specs/2026-10-12-trip-planning-design.md`

## Global Constraints

- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`. 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 사용자 문자열은 React 텍스트로만 넣는다(`dangerouslySetInnerHTML`·`innerHTML` 금지).
- 파일에 U+2028/U+2029 원문자 금지. 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- `schemaVersion`은 2 그대로, 저장 키 `tripmap:library:v2` 그대로. 경로 캐시 키는 `tripmap:routes:v1`.
- `functions/`·`src/server/`는 상대 경로 import만, React·MUI·Effect·브라우저 전용 모듈 금지.
- 한도: 여행 이름 1–60자, 기간 최대 30일, Stop 메모 500자, 체류 0–1440분 정수, 경로 캐시 500개, 경로선 200점, 서버 시한 8초, 동시 경로 요청 4개.
- 이동 수단 자동 기준: 직선 **800m 이하 도보**, 그 밖 자동차. 직선 **50km 초과**는 도보 불가. 직선 추정: `직선 × 1.3`, 자동차 시속 40km, 도보 시속 4km.
- 순서 정리: 움직일 장소 **12곳 이하** Held–Karp, 13곳 이상 nearest neighbor + 2-opt, 지금 순서가 고정 시각 순서를 어기면 거리와 상관없이 바꾸고, 아니면 결과가 **1% 이상** 짧을 때만 바꾼다.
- 서버 오류 코드: 기존 + `BAD_REQUEST` 400, `NO_ROUTE` 404. 엣지 캐시 자동차 3,600초·도보 604,800초. 브라우저에는 `private, no-store`.
- 고정 문구(스펙 §6·§2):
  - `경로 없음 · 직선 추정` / `직선 추정` / `경로를 못 가져왔어요` / `다시 시도` / `인터넷에 연결되지 않아 이동 시간은 어림값이에요`
  - `이미 Day <N>에 있어요` / `이미 후보에 있어요` / `<N>곳을 후보에 넣었어요`
  - `Day <N>의 <M>곳은 후보로 돌아가요. 바꿀까요?` / `여행은 30일까지 만들 수 있어요` / `여행 이름을 넣어 주세요` / `여행 이름은 60자까지예요`
  - `순서를 정리했어요` / `이미 가장 짧은 순서예요` / `다른 곳에서 바뀐 부분은 그대로 두었어요` / `보관함에서 지운 <N>곳은 일정에서 빠졌어요` / `여행을 찾지 못했어요` / `여행 목록으로`
  - 버튼: `새 여행`, `순서 정리`, `Day 자동 나누기`, `적용`, `취소`, `되돌리기`, `Day <N>에 넣기`, `후보로 빼기`, `다른 Day로`, `숙소로 정하기`, `숙소 정하기`, `상세`, `← 일정으로`, `보관함에서 더하기`, `링크·핀으로 새로 추가`, `여행에 넣기`, `이 지역으로 여행 만들기`, `다시 계산`, `네이버 지도로 길찾기`, `여행 설정`
  - 시간표 꼬리: `<M>월 <D>일 조회`. 자정 넘김: `다음 날 HH:mm`. 고정 시각: `여유 <N>분` / `늦음 <N>분`(60분 이상은 `1시간 20분`).
- 되돌리기 토스트는 8초.

## Review Focus

1. **보관함에서 지운 장소가 일정에 있음** → 그 장소를 건너뛰어 앞뒤를 잇고, 되살리면 원래 자리로 돌아온다. 숙소·출발지가 지워졌으면 없는 것으로 본다. Task 2 테스트로 고정.
2. **같은 좌표의 두 장소(같은 건물의 카페와 식당) / 직선 10m 미만 구간** → 하버사인·최적화에 NaN이 없고, 경로는 서버에 묻지 않고 거리 0·시간 0으로 둔다. Task 2(구간)·Task 5(최적화)·Task 7(요청 생략) 테스트로 고정.
3. **장소 0곳인 Day** → 출발점·도착점이 모두 있으면 구간 하나, 하나만 있거나 없으면 구간 없음과 빈 안내(`장소를 넣어 보세요`). Task 2·Task 9 테스트로 고정.
4. **고정 시각이 Day 시작 시각보다 이르거나, 일정이 자정을 넘김** → 늦음으로 표시하고 `다음 날 01:10`처럼 보인다. 음수·NaN 없음. Task 4 테스트로 고정.
5. **경로 조회 중 오프라인·실패, 일부 구간만 성공** → 실패 구간은 직선 추정, 합계는 `약`으로 표시하고 나머지 구간은 실제 값을 쓴다. 저장소가 꽉 차도(쿼터) 화면은 계속 동작. Task 7·Task 9 테스트로 고정.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/schema/trip.ts` | `TripId`·`TripStopId`·`StopSchema`·`DaySchema`·`TripSchema`, 여행 검증 함수 `checkTrip` |
| `src/schema/library.ts` | `trips`를 `TripSchema`로, 불변식에 `checkTrip` 연결, 한도 추가 |
| `src/services/id-gen.ts`, `src/domain/library/ops.ts` | ID 종류에 `trip`(10자)·`stop`(8자) |
| `src/domain/trips/geo.ts` | 하버사인, 자동 수단, 직선 추정 |
| `src/domain/trips/query.ts` | 날짜·Day 출발/도착점·보이는 Stop·구간·여행 안 위치 |
| `src/domain/trips/ops.ts` | 여행 연산 |
| `src/domain/trips/schedule.ts` | 도착 시각·여유/늦음·합계, 시각 표시 |
| `src/domain/trips/optimize.ts` | 순서 정리·자동 나누기 |
| `src/server/route.ts`, `src/server/simplify.ts` | 경로 질의 해석·네이버 호출·정규화, 경로선 줄이기 |
| `src/server/http.ts`, `src/server/handler.ts`, `src/server/cache-key.ts` | 오류 코드 추가, 입력 읽기·캐시 기간 일반화, 경로 캐시 키 |
| `functions/api/route.ts` | 진입점 |
| `src/services/route-lookup.ts`, `src/services/errors.ts` | `RouteLookup` 서비스·캐시, `RouteLookupError` |
| `src/routes/paths.ts`, `src/routes/router.tsx` | `/trips/:id` |
| `src/stores/trip-planner.ts` | 계획 화면 상태(고른 Day·지도 카드·자동 나누기 미리보기) |
| `src/sections/trips/*` | 목록·대화상자·계획 화면 구성 요소 |
| `src/sections/library/*`, `src/sections/add-place/*`, `src/stores/add-place.ts`, `src/domain/library/add-place.ts` | 보관함·장소 추가와의 연결 |
| `tests/fixtures/routes/*` | 녹화한 네이버 응답 |
| `tests/e2e/trip-planning.spec.ts` | E2E |

---

### Task 1: 여행 저장 형식

**Files:**
- Create: `src/schema/trip.ts`
- Modify: `src/schema/library.ts`, `src/services/id-gen.ts`, `src/domain/library/ops.ts`(`OpCtx.newId` 종류), `src/domain/library/legacy-import.ts`·`src/sections/settings/import-effects.ts`(종류 타입만)
- Test: `tests/unit/schema/trip.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/schema/trip.ts
  export const TripId; // /^[a-z0-9]{10}$/
  export const TripStopId; // /^[a-z0-9]{8}$/
  export type Stop = { id: string; placeId: string; stayMin: number | null; fixedTime: string | null; note: string };
  export type Day = { stops: Field<Stop[]>; lodging: Field<string | null>; startTime: Field<string> };
  export type Trip = { id: string; title: Field<string>; startDate: Field<string>; endDate: Field<string>; origin: Field<string | null>; candidates: Field<string[]>; days: Day[]; legModes: Field<Record<string, 'car' | 'walk'>>; createdAt: string; deletedAt: string | null };
  export function daysBetween(start: string, end: string): number; // 같은 날 1
  export function checkTrip(trip: Trip, places: Record<string, unknown>, path: PropertyKey[]): Schema.FilterIssue[];
  // src/schema/library.ts
  LIBRARY_LIMITS += { tripTitleChars: 60, tripMaxDays: 30, stopNoteChars: 500, stayMaxMin: 1440 }
  // OpCtx.newId / IdGen.next 종류: 'place' | 'label' | 'trip' | 'stop' (길이 10 / 8 / 10 / 8)
  ```
- `Field<T>`는 기존 `FieldSchema`를 쓴다. `trips`의 키도 `places`처럼 `Schema.String`으로 받고 `키 === id`를 검사한다.

- [ ] **Step 1: 실패하는 테스트** — 정상 여행(Day 2개, 후보 1, Stop 2) 디코드·인코드 왕복; 다음은 각각 거부(이슈 메시지 확인):
  - `days.length`가 날 수와 다름(`Day 수가 기간과 다릅니다`)
  - 같은 장소가 후보와 Stop에 함께 있음 / 두 Day에 있음(`여행 안에서 장소가 중복됩니다: <id>`)
  - 없는 `placeId`·`origin`·`lodging`(`없는 장소입니다: <id>`)
  - `StopId` 중복(`Stop id가 중복됩니다: <id>`)
  - 기간 31일, `startDate > endDate`, 제목 61자·빈 제목, `stayMin` 1441·-1·1.5, `note` 501자
  - `origin`·`lodging`이 후보에도 있는 것은 **허용**, 묘비 장소 참조도 **허용**
- [ ] **Step 2:** `yarn vitest run tests/unit/schema/trip.test.ts` → FAIL
- [ ] **Step 3:** 구현. 기존 장소·라벨 검사와 같은 `Schema.makeFilter` 방식. `daysBetween`은 UTC 자정 기준 날짜 차 + 1.
- [ ] **Step 4:** PASS + `yarn test`·`yarn typecheck`(ID 종류 확장으로 생기는 타입 오류를 고친다)
- [ ] **Step 5:** 커밋 `feat(trips): 여행 저장 형식과 검증`

---

### Task 2: 구간과 위치 계산

**Files:**
- Create: `src/domain/trips/geo.ts`, `src/domain/trips/query.ts`
- Test: `tests/unit/domain/trips/query.test.ts`, `tests/unit/domain/trips/geo.test.ts`

**Interfaces:**
- Consumes: Task 1 타입.
- Produces:
  ```ts
  // geo.ts
  export type LngLat = [number, number];
  export const WALK_AUTO_MAX_M = 800, WALK_MAX_M = 50_000, SAME_POINT_M = 10;
  export function haversineM(a: LngLat, b: LngLat): number;
  export function autoMode(straightM: number): 'car' | 'walk';
  export function estimateLeg(mode: 'car' | 'walk', straightM: number): { distanceM: number; durationS: number };
  // query.ts
  export function tripDates(trip: Trip): string[];
  export function liveTrips(lib: Library): Trip[]; // 시작일 오름차순, 오늘 이전에 끝난 여행은 뒤로
  export function visibleStops(lib: Library, day: Day): Stop[]; // 묘비 장소 제외
  export function visibleCandidates(lib: Library, trip: Trip): Place[];
  export function hiddenPlaceCount(lib: Library, trip: Trip): number;
  export function dayEndpoints(lib: Library, trip: Trip, dayIndex: number): { start: Place | null; end: Place | null };
  export type Leg = { key: string; from: Place; to: Place; mode: 'car' | 'walk'; modeSource: 'auto' | 'user'; straightM: number; walkAllowed: boolean };
  export function dayLegs(lib: Library, trip: Trip, dayIndex: number): Leg[];
  export type TripLocation = { where: 'candidate' } | { where: 'day'; dayIndex: number; stopIndex: number };
  export function locatePlace(trip: Trip, placeId: string): TripLocation | null;
  export const legKey: (fromId: string, toId: string) => string; // `${from}>${to}`
  ```
- 구간 규칙은 스펙 §3.2: `[출발점?, …보이는 Stop, 도착점?]`의 이웃 쌍. Stop 0곳이면 출발점·도착점 둘 다 있을 때만 구간 하나. 사람이 고른 `walk`라도 직선 50km 초과면 `car`로 보고 `walkAllowed: false`.

- [ ] **Step 1: 실패하는 테스트** — `haversineM`(서울시청↔강릉역 약 165km ±1%, 같은 점 0, NaN 없음), `autoMode` 800 경계(800 → walk, 801 → car), `estimateLeg`(1000m 자동차: 거리 1300, 시간 117초), `dayEndpoints`(첫날 origin, 다음 날 전날 lodging, 마지막 날 lodging, 묘비 숙소는 null), `dayLegs`(출발·도착 있음/없음 네 경우, Stop 0곳 두 경우, 묘비 Stop 건너뜀, `legModes` 우선, 50km 초과 walk → car), `locatePlace`, `liveTrips` 정렬, `hiddenPlaceCount`.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(trips): 여행 구간과 위치 계산`

---

### Task 3: 여행 연산

**Files:**
- Create: `src/domain/trips/ops.ts`
- Test: `tests/unit/domain/trips/ops.test.ts`

**Interfaces:**
- Consumes: Task 1·2, 기존 `setField`(`src/domain/library/lww.ts`), `OpCtx`·`OpResult`.
- Produces (모두 `OpResult`; 바뀐 필드만 `updatedAt = ctx.now`; 결과 문서는 `LibrarySchema` 검증을 통과):
  ```ts
  export type TripOpError =
    | { _tag: 'TripTitleInvalid'; reason: 'empty' | 'too-long' }
    | { _tag: 'TripDatesInvalid'; reason: 'order' | 'too-many-days' }
    | { _tag: 'AlreadyInTrip'; location: TripLocation }
    | { _tag: 'NotFound'; id: string };
  // OpError 유니온에 TripOpError를 더한다.
  createTrip(lib, input: { title: string; startDate: string; endDate: string; origin: string | null; candidates: string[] }, ctx) // createdId = trip id
  renameTrip(lib, tripId, title, ctx)
  setTripDates(lib, tripId, startDate, endDate, ctx) // 줄면 잘린 Day의 Stop을 후보 끝으로(순서 유지), 늘면 빈 Day(startTime '09:00', lodging null)
  setOrigin(lib, tripId, placeId | null, ctx)
  deleteTrip(lib, tripId, ctx) / restoreTrip(lib, tripId, ctx)
  addCandidates(lib, tripId, placeIds, ctx) // 이미 여행에 있는 장소는 건너뜀, summary.created = 새로 넣은 수
  removeCandidate(lib, tripId, placeId, ctx)
  insertStop(lib, tripId, placeId, dayIndex, position, ctx) // 후보·다른 Day에서 옮겨 옴. 이미 그 자리면 그대로. 처음 넣는 장소면 Stop id = ctx.newId('stop')
  moveStop(lib, tripId, stopId, dayIndex, position, ctx)
  unscheduleStop(lib, tripId, stopId, ctx) // 후보 끝으로
  setStopStay(lib, tripId, stopId, minutes | null, ctx) / setStopFixedTime(…, 'HH:mm' | null, ctx) / setStopNote(…, note, ctx)
  setLodging(lib, tripId, dayIndex, placeId | null, alsoFollowingDays: boolean, ctx)
  setDayStartTime(lib, tripId, dayIndex, 'HH:mm', ctx)
  setLegMode(lib, tripId, fromId, toId, mode, ctx) // 자동 값과 같으면 legModes 항목 삭제
  reorderDay(lib, tripId, dayIndex, stopIds: string[], ctx) // 같은 집합이어야 함
  applyAutoSplit(lib, tripId, plan: string[][] /* Day별 전체 placeId 순서 */, ctx) // plan에 들어간 후보는 후보에서 빠짐
  // 되돌리기(스펙 §2.5)
  export type TripFieldPath = 'title' | 'startDate' | 'endDate' | 'origin' | 'candidates' | 'legModes' | { day: number; field: 'stops' | 'lodging' | 'startTime' };
  export type TripChange = { tripId: string; fields: { path: TripFieldPath; before: Field<unknown>; after: Field<unknown> }[]; days?: { before: Day[]; after: Day[] } };
  diffTrip(before: Trip, after: Trip): TripChange // 연산이 startDate·endDate를 바꿨으면 기간 단위(startDate·endDate·days 통째를 `days`에, `fields`에는 넣지 않음), 아니면 Day 필드 단위
  revertTrip(lib, change: TripChange, ctx) // summary.merged = 건너뛴 필드 수(재사용). 지금 updatedAt === after.updatedAt인 필드만 before 값으로. 결과의 장소 중복은 되돌리지 않은 필드 쪽을 남기고 되돌린 필드에서 뺀다
  ```

- [ ] **Step 1: 실패하는 테스트** — 연산마다 결과 + `LibrarySchema` 통과. 특히: `insertStop`로 후보 → Day, Day → 다른 Day(Stop id 유지), `addCandidates` 중복 건너뛰고 `summary.created`, `insertStop`에 이미 다른 Day에 있는 장소를 후보 칸에서 넣으려 하면 `AlreadyInTrip` 대신 옮김(장소 하나 규칙), `addCandidates`로 Day에 있는 장소를 넣으면 건너뜀, `setTripDates` 줄일 때 후보 복귀·늘릴 때 빈 Day·시작일만 옮기면 내용 유지, 31일 → `TripDatesInvalid`, `setLegMode` 자동 값으로 되돌리면 삭제, `setLodging(…, true)`가 뒤 Day들 모두 바꿈, 입력 불변(원본 객체 그대로). 되돌리기:
  - 왕복: `insertStop` 뒤 `revertTrip(diffTrip(전, 후))` → 후보·Day가 전과 같은 값
  - 리뷰 반례: Day 1 변경(시각 2) 기록 → 다른 편집이 Day 2 변경(시각 3) → 되돌리기(시각 4) → Day 1만 이전 값, Day 2는 시각 3 값 그대로, `summary.merged === 0`
  - 겹친 필드: 연산이 바꾼 `candidates`를 다른 편집이 또 바꿨으면 건너뜀(`summary.merged === 1`)
  - 중복 정리: 후보 X → Day 1 넣기 기록 → 다른 편집이 X를 Day 1 → Day 2로 옮김 → 되돌리기 → X는 Day 2에만 있고(후보에 다시 생기지 않음) 결과가 `LibrarySchema` 통과
  - 기간 변경 되돌리기: 그사이 기간·Day 필드가 모두 그대로면 기간·Day 수·내용 복원; Day 필드가 바뀌었으면 기간·days 모두 건너뜀
  - 리뷰 반례: `10/12~10/14`(Day 3) → 줄이기 `10/12~10/13` 기록 → 다른 편집이 Day는 그대로 두고 `10/20~10/21`로 옮김 → 되돌리기 → 기간 `10/20~10/21`·Day 2개 그대로(기간·days 모두 건너뜀, `summary.merged > 0`), 결과가 `LibrarySchema` 통과
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(trips): 여행 연산`

---

### Task 4: 시각 계산

**Files:**
- Create: `src/domain/trips/schedule.ts`
- Test: `tests/unit/domain/trips/schedule.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LegTime = { durationS: number; distanceM: number; tollFare: number | null; estimated: boolean };
  export type PointTime = { arriveMin: number; departMin: number; slackMin: number | null }; // slack: 양수 여유, 음수 늦음, 고정 시각 없으면 null
  export type DaySchedule = { points: PointTime[]; totals: { travelS: number; distanceM: number; tollFare: number; approximate: boolean } };
  export function computeSchedule(input: {
    startTime: string; // 'HH:mm'
    hasStart: boolean; // 출발점(출발지/숙소)이 있는가 — points[0]이 출발점
    stops: { stayMin: number | null; fixedTime: string | null }[];
    hasEnd: boolean;
    legs: LegTime[]; // dayLegs 순서
  }): DaySchedule;
  export function formatClock(min: number): string; // 640 → '10:40', 1510 → '다음 날 01:10'
  export function formatSlack(slackMin: number): string; // 40 → '여유 40분', -80 → '늦음 1시간 20분'
  ```
- 출발점이 없으면 첫 Stop의 도착 = `startTime`. 고정 시각 장소: `slack = fixed - arrive`; 여유면 출발 = `fixed + stay`, 늦으면 출발 = `arrive + stay`. 분은 반올림 정수. 합계 `approximate`는 `estimated`가 하나라도 있으면 참, 통행료는 `null`을 0으로.

- [ ] **Step 1: 실패하는 테스트** — 기본 흐름(09:00 출발, 구간 600초, 체류 60분), 출발점 없음, 고정 시각 여유·늦음·시작보다 이른 고정 시각(늦음), 체류 비움, 자정 넘김 `다음 날 01:10`, `formatSlack` 60분 경계, 추정 섞인 합계 `approximate: true`, 구간 0개.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(trips): 도착 시각과 여유·늦음 계산`

---

### Task 5: 순서 정리와 자동 나누기

**Files:**
- Create: `src/domain/trips/optimize.ts`
- Test: `tests/unit/domain/trips/optimize.test.ts`

**Interfaces:**
- Consumes: `haversineM`, `LngLat`.
- Produces:
  ```ts
  export type OptStop = { id: string; at: LngLat; fixedTime: string | null };
  export function optimizeOrder(input: { start: LngLat | null; end: LngLat | null; stops: OptStop[] }): { order: string[]; changed: boolean };
  export function autoSplit(input: {
    candidates: { id: string; at: LngLat }[];
    days: { start: LngLat | null; end: LngLat | null; stops: OptStop[] }[];
  }): string[][]; // Day별 새 전체 순서(이미 넣은 장소 + 배정된 후보, §5.1 적용 후)
  ```
- 스펙 §5 그대로. `start`가 없으면 시작도 자유(Held–Karp는 모든 시작점을 본다). 고정 시각 장소끼리는 시각 오름차순(같은 시각은 지금 순서). `changed`: 지금 순서가 고정 시각 순서를 어기면 늘 참(제약을 지키는 최단 순서), 아니면 새 총 거리 ≤ 지금 × 0.99일 때만 참(거짓이면 `order`는 지금 순서). 자동 나누기의 k-means++ 초기화는 **결정적**(첫 중심 = 후보 중 id 사전순 첫째, 다음은 가장 먼 점, 동률은 id 순).

- [ ] **Step 1: 실패하는 테스트** — 시드 고정 무작위 좌표(강원 범위) 7곳 이하 50회: Held–Karp 결과 거리 = 모든 순열 최솟값; 고정 시각 순서 지킴; 출발·도착 고정; 출발 없음이면 시작 자유(리뷰 반례: 출발·도착 없음, 지금 순서 `[A(10:00) 128.8961,37.7953, B(09:00) 128.9,37.79]` → 두 순서 거리가 같아도 `changed: true`, `order: [B, A]`); 13곳·20곳 근사가 제약을 지키고 nearest neighbor보다 길지 않음; 같은 좌표 두 곳(NaN 없음); 1% 미만 개선이면 `changed: false`. 자동 나누기: 리뷰 반례 — 후보 `[128.8961 + i×0.0001, 37.7953]`(i=0…9), 빈 Day 3개 기준점 `[128.8961,37.7953]`·`[129.1,37.7953]`·`[129.4,37.7953]` → 새 장소 수 `[4, 3, 3]`; 무작위 입력에서 용량 합 = 후보 수·모두 배정; 이미 목표를 넘은 Day(Day 1에 이미 6곳, 후보 3, Day 3개) → Day 1 용량 0; 숙소 기준점에 가까운 후보가 그 Day로; 기준점 없는 Day는 k-means; 같은 입력 두 번 → 같은 결과; 후보 0 → 지금 순서 그대로.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(trips): 순서 정리와 Day 자동 나누기 계산`

---

### Task 6: 경로 서버 함수

**Files:**
- Create: `src/server/route.ts`, `src/server/simplify.ts`, `functions/api/route.ts`, `tests/fixtures/routes/car-gangneung.json`, `tests/fixtures/routes/walk-gangneung.json`, `tests/fixtures/routes/walk-too-far.json`
- Modify: `src/server/http.ts`(코드 `BAD_REQUEST` 400·`NO_ROUTE` 404), `src/server/handler.ts`, `src/server/cache-key.ts`, `functions/api/place.ts`·`functions/api/naver-folder.ts`(새 옵션 모양으로), `src/services/errors.ts`(코드 목록 컴파일 검사에 둘 추가)
- Test: `tests/unit/server/route.test.ts`, `tests/unit/server/simplify.test.ts`, `tests/unit/server/functions.test.ts`(경로 진입점 추가)

**Interfaces:**
- Produces:
  ```ts
  // route.ts
  export type RouteMode = 'car' | 'walk';
  export type RouteQuery = { mode: RouteMode; from: [number, number]; to: [number, number] };
  export type RouteResult = { mode: RouteMode; distanceM: number; durationS: number; tollFare: number | null; path: [number, number][]; queriedAt: string };
  export function parseRouteQuery(url: URL): RouteQuery; // 형식·한국 범위(경도 124–132, 위도 33–39) 아니면 ApiError('BAD_REQUEST')
  export function routeInputKey(q: RouteQuery): string; // `${mode}:${lng5},${lat5}>${lng5},${lat5}` (소수 5자리)
  export async function resolveRoute(q: RouteQuery, deps: Deps & { now?: () => Date }): Promise<RouteResult>;
  // simplify.ts
  export function simplifyPath(points: [number, number][], maxPoints: number): [number, number][]; // Douglas–Peucker, 끝점 유지, 허용 오차를 키워 가며 maxPoints 이하
  // handler.ts: GetHandlerOptions의 `param`·`missingMessage`를 바꾼다
  readInput(url: URL): string; // 없거나 틀리면 ApiError를 던진다
  maxAgeSeconds: number | ((input: string) => number);
  // cache-key.ts
  export function routeCacheKey(input: string): string; // `${CACHE_ORIGIN}/route/${encodeURIComponent(input)}`
  ```
- 네이버 호출은 기존 `makeRequester`(허용 호스트 `map.naver.com`, https, 8초)로. 헤더: `Referer: https://map.naver.com/`, 브라우저 User-Agent(기존 상수). 자동차 `/p/api/directions/car?start=lng,lat&goal=lng,lat`, 도보 `/p/api/directions/walk?o=all&l=lng,lat;lng,lat&lang=ko`. 본문 `code !== 0`이거나 결과가 비면 `NO_ROUTE`(HTTP 200이어도). 도보 직선 50km 초과는 네이버에 묻지 않고 `NO_ROUTE`. 자동차 `duration`은 ms → 초 반올림, 도보는 초 그대로. 도보 경로선은 `legs[0].steps[].path`(`null` 건너뜀, `"lng,lat lng,lat"` 파싱)를 이어 붙이고 연속 중복 점 제거.
- 진입점: `readInput = (url) => routeInputKey(parseRouteQuery(url))`, `cacheKey = routeCacheKey`, `maxAgeSeconds = (input) => input.startsWith('car:') ? 3600 : 604800`, `resolve = (input) => resolveRoute(parseRouteInputKey(input), { fetch: globalFetch })`(입력 키를 다시 질의로 푸는 `parseRouteInputKey`를 route.ts에 둔다).

- [ ] **Step 1: 픽스처 녹화** — 개발 PC에서 스펙 §1.3의 `curl`로 강릉 두 지점(`128.8961,37.7953` → `128.9006,37.7930`) 자동차·도보 응답, 서울→제주 도보(`code: 4`) 응답을 저장한다(헤더·쿠키 없이 본문만).
- [ ] **Step 2: 실패하는 테스트** — `parseRouteQuery`(정상, mode 틀림, 좌표 형식 틀림, 범위 밖 → `BAD_REQUEST`), `routeInputKey` 반올림, 자동차 픽스처 → `durationS = round(54655/1000)`·`tollFare`·경로선 점 수 ≤ 200, 도보 픽스처 → `durationS = 958`·`tollFare: null`·경로선 끝점 유지, `code: 4` → `NO_ROUTE`, 50km 초과 도보 → fetch 호출 0회 + `NO_ROUTE`, JSON 아님·503 → `UPSTREAM_ERROR`, 시한 → `TIMEOUT`, `simplifyPath`(직선 위 점 제거, 끝점, 200 이하), 진입점: 출처 검사·`private, no-store`·캐시 기간(자동차 3600/도보 604800)·기존 `/api/place`·`/api/naver-folder` 테스트 그대로 통과.
- [ ] **Step 3:** FAIL → **Step 4:** 구현 → **Step 5:** PASS + `yarn typecheck`·`yarn lint`
- [ ] **Step 6:** 커밋 `feat(server): 자동차·도보 경로 함수`

---

### Task 7: 앱의 경로 서비스

**Files:**
- Create: `src/services/route-lookup.ts`
- Modify: `src/services/errors.ts`(`RouteLookupError`), `src/lib/effect/runtime.ts`(`AppLayer`), 테스트 하네스 `tests/unit/sections/shell/harness.tsx`·`tests/unit/sections/library/fixtures.tsx`(옵션 `routeLookup?`, 기본은 조용히 `OFFLINE`)
- Test: `tests/unit/services/route-lookup.test.ts`

**Interfaces:**
- Consumes: `RouteResult`·`RouteMode`(Task 6), `estimateLeg`·`haversineM`·`SAME_POINT_M`(Task 2).
- Produces:
  ```ts
  export class RouteLookupError extends Schema.TaggedError(...)('RouteLookupError', { code: Schema.Literals(['NO_ROUTE', 'UPSTREAM_ERROR', 'TIMEOUT', 'OFFLINE', 'BAD_REQUEST', 'FORBIDDEN_ORIGIN']) })
  export class RouteLookup extends Context.Service<RouteLookup, {
    leg(mode: RouteMode, from: [number, number], to: [number, number], options?: { refresh?: boolean }): Effect.Effect<RouteResult, RouteLookupError>;
  }>()('tripmap/RouteLookup') {
    static layerWith(options: { fetch: typeof fetch; storage: Storage | null; base?: string; now?: () => Date }): Layer;
    static readonly layer: Layer; // 브라우저 fetch + localStorage(쓸 수 없으면 null)
  }
  ```
- 캐시: 키 `tripmap:routes:v1`, 값 `{ entries: Record<RouteKey, RouteResult & { usedAt: string }> }`, `RouteKey`는 Task 6의 `routeInputKey`. 읽을 때 `usedAt` 갱신, 500개 넘으면 `usedAt` 오래된 순으로 삭제. 쓰기 쿼터 초과 → 오래된 절반 삭제 후 한 번 더, 또 실패하면 메모리에만. 저장 값이 깨졌으면 비우고 시작.
- 같은 키 요청이 진행 중이면 합친다. 동시 요청 최대 4개(넘으면 대기열). 직선 10m 미만은 요청하지 않고 `{ distanceM: 0, durationS: 0, tollFare: mode === 'car' ? 0 : null, path: [from, to] }`.
- 서버 응답 처리는 `PlaceLookup`과 같다(HTML·`error` 없는 404·네트워크 실패 → `OFFLINE`, 5xx HTML → `UPSTREAM_ERROR`). 콘솔 경고는 `OFFLINE` 첫 번째에 한 번(`경로 서버에 연결하지 못했어요(로컬이면 yarn dev:full)`).

- [ ] **Step 1: 실패하는 테스트** — 캐시 적중 시 fetch 0회, `refresh`면 다시 요청, 같은 키 동시 2회 → fetch 1회, 6개 동시 → 최대 4개 진행, 501번째 저장 시 가장 오래 안 쓴 것 삭제, 쿼터 초과 처리(가짜 `Storage`), 깨진 저장 값, 10m 미만 요청 생략, 오류 코드 매핑(`NO_ROUTE` 404 본문, `UPSTREAM_ERROR`, HTML → `OFFLINE` + 경고 1회).
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS + `yarn test`
- [ ] **Step 5:** 커밋 `feat(trips): 경로 조회 서비스와 캐시`

---

### Task 8: 여행 목록과 새 여행

**Files:**
- Create: `src/sections/trips/TripsPage.tsx`, `src/sections/trips/TripFormDialog.tsx`, `src/sections/trips/PlacePickerDialog.tsx`
- Modify: `src/routes/paths.ts`(`trip: (id) => /trips/${id}`), `src/routes/router.tsx`(`/trips` → `TripsPage`, `/trips/:id` → 임시 `TripPlannerPage` 자리표시는 Task 9), `src/sections/shell/TripsPlaceholder.tsx` 삭제
- Test: `tests/unit/sections/trips/trips-page.test.tsx`

**Interfaces:**
- Consumes: `createTrip`·`renameTrip`·`deleteTrip`·`restoreTrip`·`setOrigin`(Task 3), `liveTrips`·`tripDates`(Task 2).
- Produces:
  ```ts
  export function TripFormDialog(props: { open: boolean; mode: 'create' | 'edit'; initial?: { title: string; startDate: string; endDate: string; origin: string | null }; candidates?: string[]; tripId?: string; onClose(): void; onDone?(tripId: string): void }): JSX.Element;
  export function PlacePickerDialog(props: { open: boolean; title: string; tripId?: string; onPick(placeId: string): void; onClose(): void; extra?: ReactNode }): JSX.Element; // 이 여행의 장소(후보·Stop) 먼저, 그다음 보관함 검색(이름·주소, saved:false 포함)
  ```
- 카드 문구: 제목, `10.24(금) ~ 10.26(일) · 2박 3일`(1일이면 `당일`), `일정 <N>곳 · 후보 <M>곳`. 지난 여행은 `지난 여행` 머리글 아래. 카드 메뉴 `이름 바꾸기`·`삭제`(확인 → 묘비, 토스트 `되돌리기` 8초).
- 대화상자 검증 문구는 Global Constraints. 날짜 입력은 `<input type="date">`(MUI `TextField`), 기본값 오늘~내일.

- [ ] **Step 1: 실패하는 테스트** — 빈 목록 안내, `새 여행` → 제목·기간 입력 → 만들기 → `/trips/<id>`로 이동·보관함에 여행 1개, 빈 제목·61자·31일 문구와 버튼 비활성, 출발지 고르기(PlacePicker에서 검색해 선택 → `origin` 저장), 카드 정렬(지난 여행 아래), 이름 바꾸기, 삭제 → 되돌리기.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS + `yarn test`·`yarn typecheck`·`yarn lint`
- [ ] **Step 5:** 커밋 `feat(trips): 여행 목록과 새 여행`

---

### Task 9: 계획 화면 — 후보 칸과 Day 시간표

**Files:**
- Create: `src/sections/trips/planner/TripPlannerPage.tsx`, `src/sections/trips/planner/CandidatePanel.tsx`, `src/sections/trips/planner/DayTimeline.tsx`, `src/sections/trips/planner/use-day-plan.ts`, `src/stores/trip-planner.ts`
- Modify: `src/routes/router.tsx`(`/trips/:id` → `TripPlannerPage`). `AppShell`·`useAddFlowRoute`는 바꾸지 않는다: 계획 화면은 보관함 밖 경로라 장소 추가 흐름의 확인 카드·핀 모드는 보관함 지도(`/`)로 옮겨 가고, 끝나면 Task 13이 계획 화면으로 돌려보낸다(스펙 §2.2-4). 계획 화면은 `Outlet` 본문을 높이 100%로 채운다.
- Test: `tests/unit/sections/trips/planner-timeline.test.tsx`

**Interfaces:**
- Consumes: Task 2·3·4·7.
- Produces:
  ```ts
  // stores/trip-planner.ts
  export const selectedDayAtom: PrimitiveAtom<Record<string, number>>; // tripId → dayIndex
  export const mapCardAtom: PrimitiveAtom<{ tripId: string; placeId: string } | null>;
  export const splitPreviewAtom: PrimitiveAtom<{ tripId: string; plan: string[][] } | null>;
  // use-day-plan.ts
  export type PlannedLeg = Leg & { time: LegTime; status: 'routed' | 'estimated' | 'no-route' | 'failed'; queriedAt: string | null; path: [number, number][] };
  export function useDayPlan(tripId: string, dayIndex: number): { legs: PlannedLeg[]; schedule: DaySchedule; oldestQueriedAt: string | null; offline: boolean; refresh(): void; retryLeg(key: string): void };
  ```
- `useDayPlan`은 `dayLegs`의 각 구간을 `RouteLookup.leg`로 요청(고른 Day 먼저, 그다음 다른 Day를 차례로 미리 요청). 결과 전에는 `estimateLeg`로 `estimated`. `NO_ROUTE` → `no-route`, 그 밖 실패 → `failed`(직선 추정 시간).
- **레이아웃**(스펙 §2.3): 넓은 화면 `[후보 칸 LIST_WIDTH][지도 자리][시간표 칸 DETAIL_WIDTH]` — 지도 자리는 이 Task에서 빈 상자(`aria-label="지도"`), Task 10에서 채운다. 중간 폭: 후보 칸 접기 버튼(`후보 칸 접기`/`후보 칸 펼치기`), 시간표 칸은 지도 위에 덮임. 좁은 화면: 지도 자리 + 아래 시트(`aria-label="일정 시트"`, 탭 `후보 N`·`Day 1`…; 높이 세 단계 접힘/반/거의 전체, 손잡이 끌기·누르기로 바꿈).
- **후보 칸**: 행(이름·지역·대표 라벨 색 점) + `＋`(`aria-label="<이름>을 Day <N>에 넣기"`) → `insertStop(…, 고른 Day, 끝)`. 아래 버튼 `보관함에서 더하기`·`링크·핀으로 새로 추가`·`Day 자동 나누기`(Task 12·13에서 동작; 이 Task에서는 자리만, 누르면 아무것도 안 함이 아니라 `disabled`).
- **시간표 칸**: Day 탭(`Day 1 10.24(금)`), 머리(출발 시각 입력 `aria-label="출발 시각"` → `setDayStartTime`, 출발점 이름, `순서 정리` 자리), 장소 행(번호·도착 시각·이름·체류·고정 시각 표시), 구간 행(수단 아이콘+`도보`/`자동차`, `12분 · 1.1km`, 상태 문구, 눌러 수단 바꾸기 → `setLegMode`, 50km 초과면 도보 비활성), 꼬리(숙소 이름 또는 `숙소 정하기` → PlacePickerDialog(`extra`에 체크박스 `다음 날들도 같은 숙소`, 기본 끔) → `setLodging(…, 체크 값)`, 합계 `이동 1시간 20분 · 54km · 통행료 3,000원`(추정 섞이면 앞에 `약`), `<M>월 <D>일 조회 · 다시 계산`). 장소 0곳이면 `장소를 넣어 보세요`.
- 계획 화면을 열 때 `hiddenPlaceCount > 0`이면 토스트 한 번. 없는 여행 → `여행을 찾지 못했어요` + `여행 목록으로`. 오프라인이면 시간표 위에 한 번 안내.

- [ ] **Step 1: 실패하는 테스트**(가짜 `RouteLookup`, 넓은 화면 기본) — 후보 `＋` → Day 1에 들어가고 시간표에 도착 시각; 구간 성공·`NO_ROUTE`·실패(`다시 시도` 누르면 재요청)·오프라인 문구; 수단 바꾸기 → `legModes` 저장·다시 요청; 출발 시각 바꾸면 도착 시각이 다시 계산됨; 숙소 정하기; Day 탭 전환; 장소 0곳 안내; 지운 장소 토스트; 없는 여행; 좁은 화면에 시트와 탭; 중간 폭 후보 칸 접기.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS + `yarn test`·`yarn typecheck`·`yarn lint`
- [ ] **Step 5:** 커밋 `feat(trips): 계획 화면의 후보 칸과 Day 시간표`

---

### Task 10: 계획 화면 — 지도와 지도 위 카드

**Files:**
- Create: `src/sections/trips/planner/TripMap.tsx`, `src/sections/trips/planner/MapCard.tsx`
- Modify: `src/sections/trips/planner/TripPlannerPage.tsx`, `src/sections/trips/planner/DayTimeline.tsx`·`CandidatePanel.tsx`(행 누르면 카드)
- Test: `tests/unit/sections/trips/planner-map.test.tsx`

**Interfaces:**
- Consumes: `MapView`(`markers`·`polylines`·`fitKey`·`focus`·`onMarkerClick`), `useDayPlan`, `mapCardAtom`, Task 3 연산.
- 마커(`clusterable: false` 전부): 고른 Day Stop은 `label: "<번호> <이름>"`·Day 색, 출발지·숙소는 `label: "🏠 <이름>"`/`"🛏 <이름>"`(같은 Day 색, 테두리 검정), 후보는 회색(`#9e9e9e`), 다른 Day Stop은 `dimmed: true`. Day 색은 Day 순서대로 `LABEL_COLORS` 팔레트를 돈다(라벨 색 팔레트 값 재사용). 경로선: 고른 Day 구간마다 하나, 도보는 `dashed: true`, `path`가 없으면(추정) 두 점 직선. `fitKey = "<tripId>:<dayIndex>"`.
- 카드(`role="dialog"`, `aria-label="<이름>"`): 이름·분류·위치 문구(`후보` / `Day 2 · 3번째`). 후보면 `Day <N>에 넣기`. Stop이면 체류 시간 입력(`aria-label="체류 시간(분)"`, 0–1440), 고정 시각 입력(`aria-label="고정 시각"`, 지우기 가능), `다른 Day로`(메뉴: 다른 Day 목록), `후보로 빼기`. 공통 `숙소로 정하기`(고른 Day의 숙소), `상세`(시간표 칸 자리에 기존 `PlaceDetail`과 `← 일정으로`). 좁은 화면은 카드를 열 때 시트를 접힘으로.

- [ ] **Step 1: 실패하는 테스트**(`VITE_MAP_ADAPTER=fake`, `installMapResources`) — 마커 집합(번호·회색·흐림·숙소), 도보 점선, 회색 핀 누르기 → 카드 → `Day 1에 넣기` → 번호 마커로 바뀜, 카드에서 체류 시간 입력 → 시간표 도착 시각 갱신, 고정 시각 → 여유/늦음, `다른 Day로`, `후보로 빼기`, `숙소로 정하기`, `상세` → `← 일정으로`, Day 탭 바꾸면 지도 맞춤(`fitKey`).
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(trips): 계획 화면 지도와 장소 카드`

---

### Task 11: 끌어 옮기기·행 메뉴·되돌리기

**Files:**
- Create: `src/sections/trips/planner/use-trip-undo.ts`, `src/sections/trips/planner/StopMenu.tsx`
- Modify: `CandidatePanel.tsx`, `DayTimeline.tsx`, `TripPlannerPage.tsx`(`DndContext`)
- Test: `tests/unit/sections/trips/planner-dnd.test.tsx`

**Interfaces:**
- Consumes: `@dnd-kit/core`·`@dnd-kit/sortable`(이미 의존성), Task 3 연산.
- Produces: `useTripUndo(tripId): { run(op: (lib, ctx) => OpResult, message: string): Promise<void> }` — 같은 `run` 안(잠금 안 최신본)에서 연산 전후 여행으로 `diffTrip`을 만들어 두고, 성공하면 `toast(message, { action: { label: '되돌리기', onClick: () => run(revertTrip(change)) }, duration: 8000 })`. 되돌린 결과 `summary.merged > 0`이면 `다른 곳에서 바뀐 부분은 그대로 두었어요`. 넣기·빼기·옮기기·순서 정리·자동 나누기·기간 변경이 이것을 쓴다.
- 끌기 대상: 시간표 안 순서(`moveStop`), 후보 행 → 시간표의 자리(`insertStop`), 시간표 행 → 후보 칸(`unscheduleStop`), 행 → Day 탭(그 Day 끝으로 `moveStop`). 센서: 포인터(5px 이동 후 시작), 터치(250ms 누름), 키보드(`sortableKeyboardCoordinates`).
- 행 메뉴(`aria-label="<이름> 메뉴"`): `위로`·`아래로`·`다른 Day로`·`후보로 빼기`(후보 행은 `Day <N>에 넣기`·`후보에서 빼기`).
- 토스트 문구: 넣기 `Day <N>에 넣었어요`, 빼기 `후보로 뺐어요`, 옮기기 `Day <N>로 옮겼어요`.

- [ ] **Step 1: 실패하는 테스트** — 행 메뉴로 위로·아래로·다른 Day로·후보로 빼기(각각 저장 결과), 키보드 끌기(스페이스 → 화살표 → 스페이스)로 순서 바꾸기, 되돌리기 → 원래 값, 다른 탭이 그사이 같은 여행의 다른 Day를 바꿨을 때(저장소에 직접 써서 재현) 되돌리기 → 되돌린 Day만 이전 값, 다른 Day는 그대로; 같은 필드를 바꿨으면 그 필드는 그대로 + `다른 곳에서 바뀐 부분은 그대로 두었어요`.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(trips): 끌어 옮기기와 되돌리기`

---

### Task 12: 순서 정리·자동 나누기·여행 설정

**Files:**
- Create: `src/sections/trips/planner/AutoSplitPreview.tsx`, `src/sections/trips/planner/TripSettingsDialog.tsx`
- Modify: `DayTimeline.tsx`(`순서 정리`, `여행 설정`), `CandidatePanel.tsx`(`Day 자동 나누기`), `TripMap.tsx`(미리보기 중 Day별 색 마커)
- Test: `tests/unit/sections/trips/planner-optimize.test.tsx`

**Interfaces:**
- Consumes: `optimizeOrder`·`autoSplit`(Task 5), `reorderDay`·`applyAutoSplit`·`setTripDates`·`renameTrip`·`setOrigin`(Task 3), `useTripUndo`(Task 11), `splitPreviewAtom`.
- `순서 정리`: `changed`면 `reorderDay` + 토스트 `순서를 정리했어요`(되돌리기), 아니면 `이미 가장 짧은 순서예요`.
- `Day 자동 나누기`: 후보 1곳 이상일 때 활성. `splitPreviewAtom` 설정 → 후보 칸 자리에 미리보기(`Day 1에 4곳, Day 2에 3곳`) + `적용`·`취소`, 지도는 각 장소를 배정될 Day 색으로. `적용` → `applyAutoSplit` + 되돌리기 토스트(`Day 자동 나누기를 적용했어요`).
- `여행 설정`: TripFormDialog(`mode: 'edit'`)를 쓴다. 기간을 줄여 잘리는 Day에 Stop이 있으면 확인(`Day <N>의 <M>곳은 후보로 돌아가요. 바꿀까요?`, 잘리는 Day가 여럿이면 `Day 3~4의 6곳은…`).

- [ ] **Step 1: 실패하는 테스트** — 순서 정리 바뀜/그대로, 자동 나누기 미리보기·적용·취소, 미리보기 중 다른 편집을 하면 미리보기 닫힘, 기간 줄이기 확인 → 후보 복귀, 기간 늘리기 → 빈 Day 탭.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(trips): 순서 정리·자동 나누기·여행 설정`

---

### Task 13: 보관함·장소 추가와 연결

**Files:**
- Create: `src/sections/trips/TripPickerDialog.tsx`, `src/sections/trips/planner/LibraryPickerDialog.tsx`
- Modify: `src/sections/library/FilterBar.tsx`·`RegionChips.tsx`(`이 지역으로 여행 만들기`), `src/sections/library/BulkBar.tsx`(`여행에 넣기`), `src/stores/add-place.ts`(`addTargetAtom`), `src/domain/library/add-place.ts`(`addPlace` 옵션 `saved?: boolean`), `src/sections/add-place/CandidateCard.tsx`·`PinCard.tsx`·`FolderPreview.tsx`·`AddPlaceHost.tsx`, `CandidatePanel.tsx`(두 버튼 연결)
- Test: `tests/unit/sections/trips/library-links.test.tsx`, `tests/unit/domain/library/add-place.test.ts`(옵션 추가분)

**Interfaces:**
- Produces:
  ```ts
  export const addTargetAtom: PrimitiveAtom<{ tripId: string } | null>; // 흐름이 'closed'가 되면 AddPlaceHost가 null로
  // addPlace(lib, candidate, { labelIds, memo, saved?: boolean }, ctx): saved 기본 true. false면 새 장소는 saved:false, 이미 있는 장소는 saved를 바꾸지 않는다.
  export function TripPickerDialog(props: { open: boolean; onPick(tripId: string): void; onCreateNew(): void; onClose(): void }): JSX.Element;
  export function LibraryPickerDialog(props: { open: boolean; tripId: string; onClose(): void }): JSX.Element; // 지역 칩·라벨 칩·검색, 체크 → `<N>곳 넣기` → addCandidates. 이미 이 여행에 있는 장소는 체크 상자가 비활성이고 `이미 Day <N>에 있어요` / `이미 후보에 있어요`를 보인다
  ```
- 지역 칩을 하나만 고르면 칩 줄 끝에 `이 지역으로 여행 만들기` → TripFormDialog(제목 `<지역> 여행`, `candidates` = 그 지역의 살아 있는 `saved: true` 장소 전부, `regionsByPlace` 기준).
- BulkBar `여행에 넣기` → TripPickerDialog → `addCandidates` → 토스트 `<N>곳을 후보에 넣었어요`(0곳이면 `이미 후보에 있어요`). `새 여행` → TripFormDialog(candidates = 선택 장소).
- `링크·핀으로 새로 추가`: `addTargetAtom = { tripId }` + AddSheet 열기. 대상이 있으면 CandidateCard·PinCard에 체크박스 `보관함에도 저장`(기본 켬). 저장 연산은 한 번의 `run`에서 `addPlace` → `addCandidates`(이미 여행에 있으면 건너뜀)를 잇고, 성공하면 `navigate(paths.trip(tripId))`(장소 상세가 아니라). FolderPreview는 `importFolder` 결과 문서에서 각 항목의 `sid`로 장소 id를 찾아 `addCandidates`를 같은 `run`에서 잇고, 성공하면 계획 화면으로.

- [ ] **Step 1: 실패하는 테스트** — `addPlace({ saved: false })` 새/기존 장소; 지역 칩 하나 → 버튼 → 대화상자 제목 `강릉 여행` → 만들기 → 후보 수 = 강릉 장소 수(다른 필터 무시); 칩 두 개면 버튼 없음; BulkBar `여행에 넣기` → 기존 여행 선택 → 토스트·후보 증가·중복 건너뜀; 계획 화면 `링크·핀으로 새로 추가` → 링크 흐름 → `보관함에도 저장` 끄고 추가 → 장소 `saved:false`·후보에 있음·`/trips/<id>`로 복귀; 폴더 흐름 → 가져온 장소가 모두 후보; `보관함에서 더하기` → 이미 Day 1에 있는 장소는 `이미 Day 1에 있어요`로 비활성, 체크 2곳 → 후보 +2.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS + `yarn test`·`yarn typecheck`·`yarn lint`
- [ ] **Step 5:** 커밋 `feat(trips): 보관함·장소 추가에서 여행으로`

---

### Task 14: 길찾기 연결·정리·E2E·배포 확인

**Files:**
- Create: `src/sections/trips/planner/naver-directions.ts`, `tests/e2e/trip-planning.spec.ts`, `tests/fixtures/routes/api/*.json`(앱이 받는 `/api/route` 응답)
- Modify: `DayTimeline.tsx`(구간 행에 `네이버 지도로 길찾기`), `playwright.config.ts`(새 spec을 세 프로젝트에), 옛 PoC 일정 파일(아래 Step)
- Test: `tests/unit/sections/trips/naver-directions.test.ts`

**Interfaces:**
- Produces: `naverDirectionsUrl(leg: { from: { name: string; lng: number; lat: number }; to: {…}; mode: 'car' | 'walk' }, platform: 'app' | 'web'): string | null`.
  - `app`(좁은 화면): `nmap://route/<car|walk>?slat=<lat>&slng=<lng>&sname=<인코딩>&dlat=…&dlng=…&dname=…&appname=landmark-c5f.pages.dev`(네이버 지도 URL Scheme 문서 형식).
  - `web`(넓은 화면): Step 1에서 확인한 형식. 확인하지 못하면 `null`을 돌려 넓은 화면에서는 링크를 숨긴다(추측한 주소를 내보내지 않는다).

- [ ] **Step 1: 웹 길찾기 주소 확인** — 개발 PC 브라우저(사용자 Chrome이 아닌 인앱 브라우저나 curl)로 `map.naver.com`의 길찾기 주소 형식(좌표 체계 포함)을 확인해 보고서에 근거를 적는다. 확인되면 그 형식, 아니면 `null`.
- [ ] **Step 2: 실패하는 테스트** — `app` 주소(이름 인코딩, 좌표 순서), `web` 결과(확인된 형식 또는 `null`), 구간 행 링크가 좁은 화면 `nmap://`·넓은 화면 확인 결과에 맞게 보이거나 숨김.
- [ ] **Step 3:** 구현 → PASS
- [ ] **Step 4: 옛 PoC 일정 코드 정리** — `src/sections/itinerary/**`, `src/domain/{leg-index,day-totals,day-hash}.ts`를 `src/` 밖 다른 곳(테스트 제외)이 가져오는지 `grep`으로 확인하고, `src/domain/reconcile.ts`·`overlay.ts`가 쓰는 부분이 `/t/:publicId`(LegacyImportPage) 경로에서 쓰이는지 추적한다. 어디서도 쓰지 않는 파일만 지우고(그 파일만의 테스트도), `yarn test`·`yarn typecheck`가 통과해야 한다. 지우지 못한 것은 보고서에 이유를 적는다.
- [ ] **Step 5: E2E** — `page.route('**/api/route?**')`로 녹화 응답, 가짜 지도. 테스트:
  - `@smoke 지역 칩으로 여행을 만들고 Day에 넣으면 시간표가 나온다`: 시드 보관함(강릉 장소 포함) → 지역 칩 `강릉` → `이 지역으로 여행 만들기` → 만들기 → 후보 `＋` 두 번 → 시간표에 도착 시각 2개·구간 1개
  - `순서 정리로 동선을 줄인다`
  - `Day 자동 나누기를 미리 보고 적용한다`
  - 세 프로젝트(desktop·iphone·galaxy) 통과. 실행은 `E2E_PORT=<빈 포트> yarn test:e2e --grep 여행`(5173이 다른 프로젝트에 쓰이고 있으면 빈 포트, 실행 전 `lsof`로 확인), `yarn test:e2e:ci`
- [ ] **Step 6:** 커밋 `feat(trips): 네이버 길찾기 연결, 옛 일정 코드 정리, E2E`
- [ ] **Step 7: 배포 확인(직접)** — 브랜치를 푸시해 미리보기 배포가 끝나면 `curl -H 'Origin: https://<브랜치>.landmark-c5f.pages.dev' '<미리보기>/api/route?mode=car&from=128.8961,37.7953&to=128.9006,37.7930'`과 `mode=walk` 같은 구간, `mode=walk&from=126.9780,37.5665&to=126.5312,33.4996`(→ `404 NO_ROUTE`)을 조회해 거리·시간·경로선 점 수를 보고한다. 도보가 Cloudflare에서 실패하면 원인(상태·본문)과 대안(도보는 직선 추정만)을 보고한다.
