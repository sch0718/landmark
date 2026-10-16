# 여행 당일 모드 (묶음 F5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여행하는 날 휴대폰으로 오늘 Day의 다음 장소·길찾기·다녀옴 체크·늦어짐·내 위치를 한 화면(`/trips/:id/today`)에서 쓰게 한다.

**Architecture:** 규칙(오늘 Day, 다음 장소, "지금 출발하면" 예상)은 `src/domain/trips/today.ts`의 순수 함수로 두고, 예상 시각은 기존 `computeSchedule`에 선택 입력 `startMin` 하나만 더해 다시 돌린다. 화면은 나눠 받는 새 조각 `src/sections/trips/today/*`이며 계획 화면의 `useDayPlan`·`tripMapLayers`·`naverDirectionsUrl`·`format.ts`를 그대로 쓴다. 다녀옴은 F2의 `visitedOn` 편집 연산(C1), 위치는 F4의 `Geolocation`·`MapView.myLocation`(C2)만 쓰고 저장 형식은 바꾸지 않는다.

**Tech Stack:** React 19, MUI 7, Jotai, Effect 4, react-router 7, sonner, Vitest 5(jsdom), Playwright(desktop·iphone·galaxy).

**Spec:** `docs/superpowers/specs/2026-10-16-trip-day-mode-design.md`

## Global Constraints

- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`(git 훅에도 필요). 주석·UI 문구는 한국어, 주변 코드 관례를 따른다. 화면 문구는 스펙 §3·§4·§5의 글자 그대로.
- 출발점은 F1~F4가 병합된 `main`. 브랜치 `feat/trip-day-mode`, 병합 뒤 태그 `v0.12.0`. C1·C2는 이 이름·형태만 쓴다(F2·F4 설계서 §6.2·§7.2 기준).
  - C1: `Place.visitedOn?: { value: string | null; updatedAt }`(날짜 스키마 `CalendarDate`), 읽기 `visitedOnOf(place): string | null`(`src/domain/library/visit.ts`), 쓰기 `setVisitedOn(lib, dates: Readonly<Record<string, string | null>>, ctx): OpResult`(`src/domain/library/ops.ts`). `markVisited`·`markVisitedToday`는 쓰지 않는다(늦은 날 유지·기기 날짜 규칙이 §4.4와 다르다 — 조정자 판정 B: 체크 날짜는 04:00 경계를 반영한 오늘 Day의 날짜).
  - C2: `Geolocation`(`src/services/geolocation.ts`, `current`, `watch(onFix, onError): () => void`, `layerWith({ api, secure })`), `GeoFix = { lng; lat; accuracyM; at }`, `GeolocationError.reason` = `denied | unavailable | timeout | unsupported`, 시험 도우미 `tests/unit/helpers/fake-geolocation.ts`(`fakeGeolocation()`), `MapView`의 `myLocation`·`controls` prop.
- 저장 형식·키(`schemaVersion` 2, `tripmap:library:v2`, `tripmap:prefs`, `tripmap:routes:v1`)를 바꾸지 않는다. 화면 상태(고른 Day·고른 장소·화면 켜 두기·위치 켜짐)는 저장하지 않는다.
- 숫자: 새벽 경계 `DAY_ROLLOVER_HOUR = 4`, 늦음 기준 `LATE_MIN = 5`(분), 지금 여기 `NEAR_M = 150`·`NEAR_ACCURACY_M = 200`, 쓸 수 있는 위치 `FIX_FRESH_MS = 120_000`, 시각 갱신 `NOW_TICK_MS = 30_000`, 토스트 `UNDO_MS`(8000, `use-trip-undo.ts`).
- 접근성(D3): 조작 요소 44×44 이상, 한국어 이름, 포커스 표시는 테마, 화면 `h1`은 `오늘 일정` 하나, 탭 제목 `useDocumentTitle('오늘 일정 · <여행 제목>')`.
- 첫 로딩: 새 화면은 `lazyChunk` + `ROUTE_CHUNKS`, `build:ci`에 `--require-lazy TripTodayPage`. `initialJsGzipMax` 327680.
- 커밋 메시지 끝: 세션이 알려 주는 Co-Authored-By 줄. **작업 하나 = 커밋 하나**(리뷰 수정은 같은 작업 이름을 붙인 커밋). 작업은 뒤에서부터 하나씩 되돌릴 수 있어야 하고, Task 6·7은 따로 되돌려도 다른 작업이 깨지지 않아야 한다(스펙 §6).
- 파일에 U+2028/U+2029 금지: 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- E2E는 `E2E_PORT=5175`(5173은 다른 프로젝트 — 끄지 않는다, 5174는 지도 미리보기). `pkill` 금지.

## Review Focus

1. **새벽·자정 경계**: 03:59와 04:00, 여행 첫날 새벽(어제가 기간 밖), 끝난 다음 날 새벽, 자정을 넘긴 예상(`nowMin ≥ 1440`) — 사람은 늦은 밤에도 그날 일정이 이어지길 기대한다. → Task 1 시험.
2. **체크가 다른 곳에서 바뀐 뒤 되돌리기, 체크 버튼 연타** — 되돌리기가 남의 변경을 덮거나, 두 번 눌러 체크·풀기가 엇갈리면 안 된다. → Task 3 시험.
3. **오래되거나 부정확한 위치** — 정확도 250m, 3분 전 위치로 `지금 여기`가 뜨거나 길찾기 출발점이 엉뚱한 곳이면 안 된다. → Task 5 시험.
4. **화면을 오래 열어 두거나 네이버 지도 앱에 다녀옴** — 돌아오면 시각·늦음이 바로 맞고, 화면 켜 두기와 위치 보기가 다시 걸려야 한다. → Task 4(시각)·Task 5(위치)·Task 6(켜 두기) 시험.
5. **그날 장소가 다른 탭에서 지워짐, 카드가 보던 장소가 사라짐, 장소 0곳·숙소만** — 빈 카드·예외 없이 다음 장소나 빈 상태로 넘어가야 한다. → Task 2 시험.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/domain/trips/schedule.ts` | `ScheduleInput.startMin?` |
| `src/domain/trips/today.ts` (새) | 오늘 Day·지금 분·다녀옴 판정·다음 장소·예상·위치 판정 (순수) |
| `src/domain/trips/today-visit.ts` (새) | 체크·풀기·되돌리기 연산(F2 `setVisitedOn`을 감쌈) |
| `src/routes/{paths,router,lazy-routes}.ts(x)` | 경로·라우트·나눠 받기 |
| `src/sections/trips/today/TripTodayPage.tsx` (새) | 화면 루트·배치 |
| `src/sections/trips/today/use-today.ts` (새) | 화면 모델 |
| `src/sections/trips/today/{TodayHeader,NextCard,TodayLists,TodayNotices,TodayMap}.tsx` (새) | 화면 조각 |
| `src/sections/trips/today/{today-map-layers,today-directions}.ts` (새) | 지도 레이어·길찾기 주소 |
| `src/sections/trips/today/{use-now,use-online,use-my-location,use-wake-lock,use-visit-toggle}.ts` (새) | 시각·연결·위치·켜 두기·체크 |
| `src/sections/trips/TripsPage.tsx`, `src/sections/trips/planner/TripPlannerPage.tsx` | 들어가는 버튼 |
| `tests/unit/domain/trips/{today,today-visit}.test.ts` (새), `tests/unit/domain/trips/schedule.test.ts` | 도메인 시험 |
| `tests/unit/sections/trips/today-*.test.tsx` (새), `today-fixtures.tsx` (새) | 화면 시험(가짜 `RouteLookup`·`Geolocation`) |
| `tests/e2e/trip-today.spec.ts` (새), `playwright.config.ts` | E2E |

---

### Task 0: 출발점 확인 (커밋 없음)

- [ ] **Step 1:** `git log --oneline -5`에 F4 병합(`v0.11.0`)이 있는지, 그리고 아래가 모두 있는지 확인한다.
  - `grep -n "visitedOn" src/schema/library.ts` — C1 필드.
  - `grep -n "export function setVisitedOn" src/domain/library/ops.ts`, `grep -n "export function visitedOnOf" src/domain/library/visit.ts` — F2의 연산(Global Constraints의 모양).
  - `grep -n "class Geolocation\|GeoFix\|layerWith" src/services/geolocation.ts`, `ls tests/unit/helpers/fake-geolocation.ts` — C2와 시험 도우미.
  - `grep -n "setMyLocation\|myLocation\|controls" src/components/map/MapAdapter.ts src/components/map/MapView.tsx`.
- [ ] **Step 2:** 이름·모양이 다르면 이 계획의 Interfaces 줄을 실제 이름으로 바꿔 읽고, 다른 점을 보고서에 적는다. 없는 것이 있으면 멈추고 알린다.

---

### Task 1: 시간·다음 장소 규칙 (스펙 §4.1·§4.4·§4.5·§4.6·§4.7 판정)

**Files:**
- Modify: `src/domain/trips/schedule.ts`
- Create: `src/domain/trips/today.ts`
- Test: `tests/unit/domain/trips/schedule.test.ts`, `tests/unit/domain/trips/today.test.ts`

**Interfaces:**
- Produces (`schedule.ts`): `ScheduleInput.startMin?: number` — 유한하고 0 이상이면 `startTime` 대신 시작 시각(절대 분, 1440 이상 가능). 아니면 지금처럼 `startTime`.
- Produces (`today.ts`):
  - 상수 `DAY_ROLLOVER_HOUR`, `LATE_MIN`, `NEAR_M`, `NEAR_ACCURACY_M`, `FIX_FRESH_MS`(Global Constraints 값).
  - `type TodayStatus = { kind: 'during'; dayIndex: number; date: string } | { kind: 'before'; daysUntil: number } | { kind: 'after' }`
  - `todayStatus(trip: Pick<Trip, 'startDate' | 'endDate'>, now: Date): TodayStatus` — 스펙 §4.1. 날짜 계산은 `addDays`(`trip-dates.ts`)·`daysBetween`.
  - `dayClockMin(date: string, now: Date): number` — `date`의 지역 자정(`new Date(y, m - 1, d)`)부터 지난 분(내림).
  - `visitedInTrip(visitedOn: string | null | undefined, trip: Pick<Trip, 'startDate' | 'endDate'>): boolean`
  - `type NextPick = { nextIndex: number | null; wrapped: boolean; skipped: ReadonlySet<number> }`
  - `pickNext(visited: readonly boolean[]): NextPick` — 스펙 §4.5의 1~3(모두 다녀옴이면 `nextIndex: null`; 숙소는 화면 모델이 고른다).
  - `type Projection = { points: PointTime[]; delayMin: number }` — `points`는 다음 장소부터 그날 끝(도착점 포함)까지.
  - `projectFromNow(args: { input: ScheduleInput; planned: DaySchedule; nextIndex: number; nowMin: number; here: boolean }): Projection` — 스펙 §4.6. 앞 지점이 있고 `here`가 아니면 `computeSchedule({ ...input, hasStart: true, startMin: max(nowMin, 앞 지점 계획 출발), stops: input.stops.slice(nextIndex), legs: input.legs.slice(offset + nextIndex - 1) })`의 첫 점을 뺀 것, 그 밖에는 `hasStart: false, startMin: max(nowMin, 계획 도착)`, `legs.slice(offset + nextIndex)`. `offset = input.hasStart ? 1 : 0`. `delayMin = points[0].arriveMin - planned.points[offset + nextIndex].arriveMin`.
  - `usableFix(fix: GeoFix | null, nowMs: number): GeoFix | null` — `nowMs - fix.at ≤ FIX_FRESH_MS`면 그대로.
  - `isNear(fix: GeoFix, place: { lng: number; lat: number }): boolean` — `accuracyM ≤ NEAR_ACCURACY_M && haversineM ≤ NEAR_M`.

- [ ] **Step 1: 실패하는 시험**

```ts
// schedule.test.ts
it('startMin이 있으면 startTime 대신 그 분에서 시작한다(1440 이상 포함)', () => {
  const s = computeSchedule({ startTime: '09:00', startMin: 1450, hasStart: true, stops: [{ stayMin: 30, fixedTime: null }], hasEnd: false, legs: [leg(600)] });
  expect(s.points.map((p) => p.arriveMin)).toEqual([1450, 1460]);
});
it('startMin이 NaN·음수면 startTime을 쓴다', () => { /* NaN, -5 → points[0].arriveMin === 540 */ });

// today.test.ts — 날짜는 지역 시각 생성자로(시간대에 흔들리지 않게)
const trip = { startDate: f('2026-10-24'), endDate: f('2026-10-26') };
it.each([
  [new Date(2026, 9, 25, 10, 0), { kind: 'during', dayIndex: 1, date: '2026-10-25' }],
  [new Date(2026, 9, 25, 3, 59), { kind: 'during', dayIndex: 0, date: '2026-10-24' }],
  [new Date(2026, 9, 25, 4, 0), { kind: 'during', dayIndex: 1, date: '2026-10-25' }],
  [new Date(2026, 9, 24, 3, 0), { kind: 'during', dayIndex: 0, date: '2026-10-24' }], // 어제가 기간 밖이면 경계 없음
  [new Date(2026, 9, 27, 3, 0), { kind: 'during', dayIndex: 2, date: '2026-10-26' }],
  [new Date(2026, 9, 27, 4, 0), { kind: 'after' }],
  [new Date(2026, 9, 23, 12, 0), { kind: 'before', daysUntil: 1 }],
  [new Date(2026, 9, 20, 12, 0), { kind: 'before', daysUntil: 4 }],
])('todayStatus(%s)', (now, expected) => expect(todayStatus(trip, now)).toEqual(expected));
it('dayClockMin', () => {
  expect(dayClockMin('2026-10-24', new Date(2026, 9, 24, 10, 30))).toBe(630);
  expect(dayClockMin('2026-10-24', new Date(2026, 9, 25, 1, 10))).toBe(1510);
});
it('visitedInTrip: 기간 안만', () => { /* '2026-10-23' false, '2026-10-24' true, '2026-10-26' true, '2026-10-27' false, null false, undefined false */ });
it.each([
  [[false, false, false], 0, false, []],
  [[true, false, false], 1, false, []],
  [[false, true, false], 2, false, [0]],
  [[false, false, true], 0, true, [0, 1]],
  [[true, true, true], null, false, []],
])('pickNext(%j)', (visited, nextIndex, wrapped, skipped) => {
  const r = pickNext(visited);
  expect([r.nextIndex, r.wrapped, [...r.skipped]]).toEqual([nextIndex, wrapped, skipped]);
});
describe('projectFromNow', () => {
  // 09:00 출발점 → A(60분) → B(30분, 고정 12:00) → 숙소, 구간 각 20분
  it('앞 지점 출발 = max(지금, 계획 출발): 계획 전이면 늦음 0', () => { /* nowMin 500, nextIndex 0 → delayMin 0, points[0].arriveMin 560 */ });
  it('지금 10:30이면 A 도착 10:50(계획 09:20), 늦음 90분', () => { /* nowMin 630 → points[0].arriveMin 650, delayMin 90 */ });
  it('here면 다음 장소 도착 = max(지금, 계획 도착)', () => { /* here true, nowMin 630, nextIndex 0 → points[0].arriveMin 630 */ });
  it('고정 시각에 늦으면 slackMin 음수', () => { /* nextIndex 1(A 계획 출발 10:20), nowMin 710 → B 도착 730 → points[0].slackMin === -10, delayMin === 730 - 계획 B 도착 */ });
  it('출발점이 없고 첫 Stop이면 도착 = max(지금, startTime)', () => { /* hasStart false */ });
  it('도착점이 points 끝에 들어 있다', () => { /* points.length === stops.length - nextIndex + 1 */ });
});
it('isNear·usableFix 경계', () => {
  // 정확도 200·149m → true, 정확도 201 → false, 151m → false
  // at = now - 120_000 → 그대로, now - 120_001 → null
});
```

- [ ] **Step 2:** `yarn vitest run tests/unit/domain/trips/today.test.ts tests/unit/domain/trips/schedule.test.ts` — FAIL(`today.ts` 없음, `startMin` 무시).
- [ ] **Step 3:** 구현. `computeSchedule`은 `startSec`만 `startMin`으로 바꾸고 나머지(고정 시각의 같은 날 HH:mm 비교)는 그대로 둔다 — 그래서 고정 시각은 Day 0시 기준 절대 분과 비교된다.
- [ ] **Step 4:** 위 시험 PASS + `yarn test tests/unit/domain` + `yarn typecheck` + `yarn lint`.
- [ ] **Step 5:** 커밋 `feat(trips): 당일 모드 규칙 — 오늘 Day·다음 장소·지금 출발하면 예상`

---

### Task 2: 당일 화면 뼈대 (스펙 §3.3·§4.2·§4.3·§5 — 체크·늦음·위치 없이)

**Files:**
- Modify: `src/routes/paths.ts`, `src/routes/router.tsx`, `src/routes/lazy-routes.ts`, `package.json`(`build:ci`)
- Create: `src/sections/trips/today/{TripTodayPage.tsx, use-today.ts, TodayHeader.tsx, NextCard.tsx, TodayLists.tsx, TodayNotices.tsx, TodayMap.tsx, today-map-layers.ts, use-now.ts}`
- Test: `tests/unit/sections/trips/today-fixtures.tsx`, `tests/unit/sections/trips/today-page.test.tsx`, `tests/unit/sections/trips/today-map-layers.test.ts`, `tests/unit/routes/*`(라우트·조각 목록 시험이 있으면 거기에)

**Interfaces:**
- Consumes: Task 1 전부. `useDayPlan(tripId, dayIndex): DayPlan`, `tripMapLayers`, `visibleStops`, `dayEndpoints`, `tripDates`, `shortDate`, `formatClock`, `formatSpan`, `objectParticle`, `selectedDayAtom`, `useDocumentTitle`, `useLayout`, `LIST_WIDTH`.
- Produces:
  - `paths.tripToday(id: string): string` = `` `/trips/${id}/today` ``. 라우트 `{ path: paths.tripToday(':id'), element: lazyElement(<TripTodayPage />, 'trip-today') }`. `loadTripTodayPage`·`TripTodayPage`(lazy)를 `lazy-routes.ts`에, `loadTripTodayPage`를 `ROUTE_CHUNKS`에.
  - `useNow(tickMs = NOW_TICK_MS): Date` — `tickMs`마다, 그리고 `visibilitychange`로 보일 때 새 `Date`.
  - `type TodayStop = { stop: Stop; place: Place; number: number; visited: boolean; skipped: boolean; planned: PointTime; projected: PointTime | null }`
  - `type TodayNext = { kind: 'stop'; index: number } | { kind: 'end'; place: Place } | null`
  - `type TodayModel = { status: TodayStatus; todayIndex: number | null; dayIndex: number; isToday: boolean; date: string; canCheck: boolean; plan: DayPlan; stops: TodayStop[]; start: Place | null; end: Place | null; next: TodayNext; wrapped: boolean; here: boolean; delayMin: number | null; approximate: boolean }`
  - `useToday(trip: Trip, viewDay: number | null, fix?: GeoFix | null): TodayModel` — `viewDay`가 null이면 `during`은 오늘 Day, `before`는 0, `after`는 마지막. `canCheck = status.kind === 'during'`. 이 작업에서는 `projected`·`delayMin`은 늘 null, `here` false(Task 4·5가 채움). `visited`는 `visitedInTrip(visitedOnOf(place), trip)`.
  - `todayMapLayers(lib: Library, trip: Trip, dayIndex: number, legs: PlannedLeg[], opts: { visited: ReadonlySet<string>; selectedPlaceId: string | null }): { markers: MapMarker[]; polylines: MapPolyline[] }` — `tripMapLayers` 결과에서 `fit !== false`만, 다녀온 Stop은 `dimmed: true`.
  - `NextCard` props: `{ model: TodayModel; trip: Trip; selected: number | null; onShowNext(): void }`(버튼은 Task 3·4가 더한다). `TodayLists` props: `{ model: TodayModel; onSelect(index: number): void }`. `TodayHeader` props: `{ trip: Trip; model: TodayModel; onPickDay(dayIndex: number): void; extraMenu?: ReactNode; badge?: ReactNode }`. `TodayNotices` props: `{ model: TodayModel; trip: Trip; onToday(): void; children?: ReactNode }`(뒤 작업이 띠를 `children`으로 더한다).
  - `TodayMap` props: `{ trip: Trip; model: TodayModel; selectedPlaceId: string | null; onPick(placeId: string): void; padding: MapPadding; myLocation?: { lng: number; lat: number; accuracyM: number } | null }` — `fitKey` `` `${trip.id}:today:${dayIndex}` ``.

- [ ] **Step 1: 실패하는 시험** — `today-fixtures.tsx`는 `planner-fixtures`의 `plannerLibrary`·`makeTrip`·`fakeRoutes`를 다시 쓰고, `renderToday(lib, { path })`(라우터 `MemoryRouter` + jotai `Provider` + `setAppRuntimeForTest`)를 둔다. `vi.setSystemTime(new Date(2026, 9, 24, 10, 0))`, 여행 2026-10-24~26.
  - `/trips/<id>/today`: `h1` `오늘 일정` 하나, `document.title` `오늘 일정 · <제목> · 랜드마크`, 머리 부제 `<제목> · Day 1 · 10.24(토)`.
  - 카드 `region` `다음 장소`: 머리 `다음 · 1번째`, `h2` 첫 Stop 이름, `계획 도착 09:00`. `남은 일정` 목록 행 수 = 그날 Stop 수, 행 시각 `09:00 도착 예정`.
  - 장소의 `visitedOn`이 `2026-10-24`인 첫 Stop → 카드가 2번째, `다녀온 곳 1곳` 버튼(접힘, 펼치면 `다녀옴 · 10.24(토)`). `visitedOn` `2025-05-01`이면 다녀옴 아님.
  - 행 이름을 누르면 카드 머리 `고른 장소 · 2번째`, `다음 장소 보기`로 돌아옴.
  - 메뉴 `오늘 일정 메뉴` → `Day 2 · 10.25(일)` → 띠 `오늘이 아닌 Day 2를 보고 있어요`, `오늘로` → Day 1. 오늘 Day 항목 이름 끝 ` · 오늘`.
  - 시각 2026-10-23 12:00 → 띠 `여행은 내일(10.24(토)) 시작해요. Day 1을 미리 보여 드려요`. 2026-10-27 12:00 → `여행이 끝났어요(10.26(월)). 마지막 Day를 보여 드려요`.
  - Stop 0곳 Day → `이 Day에는 일정이 없어요`, 링크 `계획 화면에서 장소 넣기`(href `/trips/<id>`). 모두 다녀옴 + 숙소 → 머리 `마지막 · 숙소`. 모두 다녀옴·숙소 없음 → `오늘 일정을 모두 다녀왔어요`.
  - (Review Focus 5) 카드가 고른 장소를 보는 중 그 장소를 보관함에서 지운 문서로 `libraryAtom`을 바꾸면 카드가 다음 장소로, 예외 없음. 그날 Stop이 모두 지워진 장소면 빈 상태.
  - 없는 여행 → `여행을 찾지 못했어요`.
  - `계획 화면으로` → `/trips/<id>`, `selectedDayAtom[<id>]` = 보던 Day.
  - 넓은 화면(`matchMedia` 1280) → 왼쪽 칸(너비 360)과 지도 `region` `지도`가 나란히, 좁은 화면 → 지도가 위.
  - `today-map-layers.test.ts`: 후보·다른 Day 마커가 없고, 다녀온 Stop은 `dimmed`, 출발점·숙소는 남음.
  - `useNow`: 30초 뒤 새 값, `visibilitychange`(visible)에 새 값.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 좁은 화면 지도 높이 `clamp(180px, 34dvh, 320px)`, 지도 여백 40px. 메뉴 항목은 `MenuItem role="menuitemradio" aria-checked`. 다음 장소 행에 `aria-current="step"`, 지나침 꼬리표 `지나침`. `build:ci`의 `--require-lazy` 목록 끝에 `--require-lazy TripTodayPage`.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`.
- [ ] **Step 5:** 커밋 `feat(trips): 여행 당일 화면 — 오늘 Day·다음 장소·남은 일정·지도`

---

### Task 3: 다녀옴 체크 (C1, 스펙 §4.4·§5.7)

**Files:**
- Create: `src/domain/trips/today-visit.ts`, `src/sections/trips/today/use-visit-toggle.ts`
- Modify: `NextCard.tsx`(`다녀옴` 버튼), `TodayLists.tsx`(체크 상자), `TodayMap.tsx`(변경 없음 — 레이어가 이미 `visited`를 읽음)
- Test: `tests/unit/domain/trips/today-visit.test.ts`, `tests/unit/sections/trips/today-page.test.tsx`

**Interfaces:**
- Consumes: F2 `setVisitedOn(lib, dates, ctx)`·`visitedOnOf(place)`(Task 0), `useLibraryAction`, `UNDO_MS`, `MERGED_NOTICE`, `TodayModel.canCheck`·`date`.
- Produces:
  - `markVisit(placeId: string, visitedOn: string | null): (lib: Library, ctx: OpCtx) => OpResult` = `setVisitedOn(lib, { [placeId]: visitedOn }, ctx)`.
  - `revertVisit(placeId: string, expected: string | null, previous: string | null): (lib: Library, ctx: OpCtx) => OpResult` — 지금 값이 `expected`면 `previous`로, 아니면 문서를 그대로 두고 `summary: { created: 0, merged: 1, restored: 0 }`.
  - `useVisitToggle(): { toggle(place: Place, next: boolean, date: string): Promise<void>; pending: ReadonlySet<string> }` — `next`가 참이면 `date`, 거짓이면 `null`을 쓴다. 저장 중인 장소 id는 `pending`(버튼 끔). 성공하면 토스트(스펙 §5.7 문구, `duration: UNDO_MS`, `action: 되돌리기` → `revertVisit(id, 쓴 값, 이전 값)`; 결과 `merged > 0`이면 `MERGED_NOTICE`).

- [ ] **Step 1: 실패하는 시험**
  - `today-visit.test.ts`: `markVisit(P1, '2026-10-24')` → `visitedOnOf` `'2026-10-24'`, `markVisit(P1, null)` → null, 결과 `LibrarySchema` 통과. `revertVisit(P1, '2026-10-24', '2025-05-01')`: 지금 `'2026-10-24'`면 `'2025-05-01'`로, 지금 `null`(다른 탭이 풀었음)이면 그대로 + `merged: 1`.
  - 화면: 체크 상자 `‘중앙시장 닭강정’ 다녀옴` 누름 → 토스트 `‘중앙시장 닭강정’ 다녀옴으로 표시했어요`(`duration` 8000, `되돌리기`), 카드가 다음 장소로, `다녀온 곳 1곳`. `되돌리기` → 원래 `visitedOn`(옛 날짜 `2025-05-01`이었으면 그 값). 다녀온 곳의 체크 상자로 풀기 → 토스트 `‘…’ 다녀옴 표시를 지웠어요`.
  - 카드 `다녀옴`(이름 `‘<이름>’ 다녀옴으로 표시`)도 같다. 체크 날짜: 시각 2026-10-25 01:30이면 `'2026-10-24'`이 쓰인다.
  - 기간 밖(2026-10-23)에는 체크 상자·`다녀옴`이 없다. 다른 Day(Day 2)에서는 체크할 수 있다.
  - (Review Focus 2) 체크 상자를 저장이 끝나기 전에 두 번 누르면 연산은 한 번(가짜 저장을 지연시켜 확인), 그동안 상자는 `disabled`. 되돌리기 전에 다른 탭 변경(문서의 `visitedOn`을 `null`로 바꾼 `libraryAtom`·저장소)이 있으면 바꾸지 않고 `다른 곳에서 바뀐 부분은 그대로 두었어요`.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`.
- [ ] **Step 5:** 커밋 `feat(trips): 당일 모드 다녀옴 체크·풀기·되돌리기`

---

### Task 4: 늦어짐·길찾기 (스펙 §4.6·§4.8, 위치 없이)

**Files:**
- Create: `src/sections/trips/today/today-directions.ts`
- Modify: `use-today.ts`(`projected`·`delayMin`·`approximate`), `NextCard.tsx`(줄 2, `길찾기`), `TodayLists.tsx`(예상 시각·고정 시각 늦음)
- Test: `tests/unit/sections/trips/today-directions.test.ts`, `tests/unit/sections/trips/today-page.test.tsx`

**Interfaces:**
- Consumes: `projectFromNow`, `dayClockMin`, `LATE_MIN`, `useNow`, `naverDirectionsUrl`, `autoMode`, `haversineM`, `formatSlack`, `useLayout`.
- Produces:
  - `useToday`가 `isToday && next?.kind === 'stop' && !wrapped`일 때 `projectFromNow`로 `stops[i].projected`(다음 장소부터)와 `delayMin`을 채운다. `approximate` = 다음 장소로 가는 구간의 `time.estimated`.
  - `type DirectionsFrom = { name: string; lng: number; lat: number }`
  - `todayDirections(args: { to: Place; from: DirectionsFrom | null; leg: PlannedLeg | null; platform: 'app' | 'web' }): string | null` — `from`이 null이면 null. 수단은 `leg?.mode`, 없으면 `autoMode(haversineM(from, to))`(50km 넘으면 `car`).
  - `directionsFrom(model: TodayModel, targetIndex: number | 'end'): DirectionsFrom | null` — 앞 지점(직전 Stop → 그날 출발점). Task 5가 내 위치를 앞에 끼운다.

- [ ] **Step 1: 실패하는 시험**
  - 화면(출발지 없는 Day 1, 09:00 시작, Stop P1 → P2, 구간 P1→P2 20분), 시각 08:50 → 카드 줄 2 `계획대로`. `vi.advanceTimersByTime`으로 10:30까지(30초 틱) → 앞 지점이 없으므로 `계획보다 1시간 30분 늦음`, 남은 일정 P1 행 `예상 10:30 · 계획 09:00`. P1을 다녀옴으로 둔 문서에서 10:30 → P2 카드 `지금 출발하면 10:50 도착 · 1시간 30분 늦음`.
  - 늦음 4분 → `계획대로`, 5분 → `5분 늦음`.
  - 고정 시각 Stop: 예상이 고정보다 늦으면 행에 `늦음 <N분>`.
  - 구간이 직선 추정이면 `약 ` 접두.
  - 다른 Day·기간 밖·되감음이면 줄 2 없음.
  - (Review Focus 4) `document.visibilityState`를 `hidden`으로 두고 시각을 20분 앞당긴 뒤 `visible` + `visibilitychange` → 틱을 기다리지 않고 늦음이 갱신.
  - `길찾기`(이름 `<이름>까지 길찾기`): 좁은 화면은 `nmap://route/<mode>?slat=<직전 지점 위도>…`, 넓은 화면은 `https://map.naver.com/p/directions/…`·`target="_blank"`. 출발점이 없으면(첫 Stop, 출발점 없음) 끈 버튼 + `출발 지점을 몰라요. 내 위치를 켜 주세요`.
  - `today-directions.test.ts`: `leg` 수단 반영, `leg` 없음 → 직선 800m 이하 `walk`, 이상 `car`, `from` null → null.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`.
- [ ] **Step 5:** 커밋 `feat(trips): 당일 모드 늦어짐 표시·다음 장소 길찾기`

---

### Task 5: 내 위치 (C2, 스펙 §4.7·§5.5)

**Files:**
- Create: `src/sections/trips/today/use-my-location.ts`
- Modify: `TripTodayPage.tsx`(`fix`를 `useToday`·`TodayMap`에), `use-today.ts`(`here`), `NextCard.tsx`(지금 여기·`직선 <거리>`·주 버튼), `today-directions.ts`(`directionsFrom`에 위치), `TodayNotices.tsx`(위치 띠), `TodayMap.tsx`(`myLocation`, `내 위치로`)
- Test: `tests/unit/sections/trips/today-location.test.tsx`

**Interfaces:**
- Consumes: `Geolocation`(`watch`), `GeoFix`, `GeolocationError.reason`, `usableFix`, `isNear`, `MapView.myLocation`·`controls`(`내 위치로`를 ＋/− 아래 기둥에), `formatDistanceM`(F4 `src/domain/nearby.ts`), `GeolocationError.userMessage`(F4), 시험 `fakeGeolocation()`.
- Produces:
  - `type LocationState = { status: 'unsupported' } | { status: 'off' } | { status: 'watching'; fix: GeoFix | null } | { status: 'denied' } | { status: 'unavailable' } | { status: 'timeout' }`
  - `useMyLocation(): { state: LocationState; start(): void }` — 서비스는 `startEffectSync(Effect.gen(function* () { return yield* Geolocation; }))`로 한 번 얻는다. 처음에 `navigator.permissions?.query({ name: 'geolocation' })`가 `granted`면 `start()`. 보이는 동안만 `watch`, `hidden`이면 해제, `visible`이면 다시. `onError`의 `error.reason`을 상태로(`denied`면 F4 서비스가 스스로 해제하므로 다시 걸지 않는다, `unsupported`면 버튼도 숨김). `timeout`·`unavailable` 뒤에도 서비스가 계속 지켜보므로 다음 위치가 오면 `watching`으로 돌아간다.
  - `directionsFrom(model, target, fix?: GeoFix | null)` — `fix`가 있으면 `{ name: '내 위치', lng, lat }` 먼저.
  - `useToday(trip, viewDay, fix)`의 `here` = 다음 장소가 Stop이고 `usableFix(fix)`가 `isNear`.

- [ ] **Step 1: 실패하는 시험** — `const geo = fakeGeolocation()`, 런타임에 `Geolocation.layerWith({ api: geo.api, secure: true })`(`geo.emit`·`geo.emitError`로 위치·오류, `geo.cleared`로 해제 확인), `navigator.permissions` 스텁.
  - 권한 `prompt` → 띠 `내 위치를 켜면 다음 장소까지 거리와 도착을 알려 드려요` + `내 위치 켜기` → `watch` 호출. 권한 `granted` → 들어오자마자 `watch`.
  - 위치(다음 장소에서 1.2km, 정확도 30m) → 카드 `직선 1.2km`, 길찾기 주소 `slat=<내 위도>`·`sname=%EB%82%B4%20%EC%9C%84%EC%B9%98`(좁은 화면), 지도 `myLocation` 전달(가짜 어댑터의 `my-location` 요소 data 속성), `내 위치로` 버튼.
  - 다음 장소에서 100m·정확도 30m → 머리 `지금 여기 · 1번째`, `다녀옴`이 주 버튼(`contained`), 늦음 계산은 `here`(도착 = max(지금, 계획 도착)).
  - (Review Focus 3) 100m·정확도 250m → `다음`; 3분 전 위치(`at = now - 180_000`) → `직선` 없음·길찾기 출발점은 직전 지점·`지금 여기` 아님.
  - 오류(문구는 F4 `GeolocationError.userMessage` 그대로): `denied` → `위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 켜 주세요`(버튼 없음), `unavailable` → `지금은 위치를 알 수 없어요. 잠시 뒤 다시 해 주세요` + `다시 시도`, `timeout` → `위치를 찾는 데 시간이 너무 오래 걸려요. 다시 해 주세요` + `다시 시도`, `unsupported` → 띠·버튼 없음.
  - (Review Focus 4) `hidden` → `geo.cleared` 1개, `visible` → 새 `watch`. 화면을 떠나면 해제. `denied` 뒤 `visible`이 되어도 다시 걸지 않음.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`.
- [ ] **Step 5:** 커밋 `feat(trips): 당일 모드 내 위치 — 지도 표시·지금 여기·길찾기 출발점`

---

### Task 6: 화면 켜 두기·오프라인 안내 (스펙 §4.9·§4.10)

**Files:**
- Create: `src/sections/trips/today/use-wake-lock.ts`, `src/sections/trips/today/use-online.ts`
- Modify: `TripTodayPage.tsx`(`TodayHeader`의 `extraMenu`·`badge`, `TodayNotices`의 `children`에만 끼운다 — Task 2의 슬롯을 쓰므로 이 작업만 되돌려도 깨지지 않는다)
- Test: `tests/unit/sections/trips/today-wake-lock.test.tsx`, `tests/unit/sections/trips/today-page.test.tsx`(오프라인)

**Interfaces:**
- Produces:
  - `useWakeLock(): { supported: boolean; on: boolean; setOn(next: boolean): void }` — `supported = 'wakeLock' in navigator`. 켜면 `request('screen')`, 거절되면 끔 + 토스트 `화면 켜 두기를 쓸 수 없어요`. 켜 둔 채 `visible`이 되면 다시 요청. 언마운트 때 `release()`.
  - `useOnline(): boolean` — `navigator.onLine` + `online`·`offline` 이벤트.
  - 메뉴 항목 `화면 켜 두기`(`role="menuitemcheckbox"`, `aria-checked`), 켜져 있으면 머리 표시 `화면 켜 둠`. 오프라인 띠 `인터넷에 연결되지 않았어요. 일정과 체크는 그대로 쓸 수 있고, 이동 시간은 어림값이에요`(`!online || plan.offline`).

- [ ] **Step 1: 실패하는 시험** — `vi.stubGlobal('navigator', …)`로 `wakeLock.request`·`release` 가짜.
  - 메뉴 → `화면 켜 두기` → `request('screen')` 1회, `화면 켜 둠` 보임, 다시 누르면 `release`.
  - (Review Focus 4) 켜 둔 채 `hidden` → `visible` → `request` 2회째. 끈 상태에서는 다시 요청하지 않음.
  - `request`가 거절 → `aria-checked="false"`, 토스트 `화면 켜 두기를 쓸 수 없어요`.
  - `wakeLock` 없음 → 메뉴 항목 없음.
  - 화면을 떠나면 `release`.
  - `offline` 이벤트 → 오프라인 띠, `online` → 사라짐. `plan.offline`(가짜 경로가 `OFFLINE`)도 띠.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`.
- [ ] **Step 5:** 커밋 `feat(trips): 당일 모드 화면 켜 두기·오프라인 안내`

---

### Task 7: 들어가는 길과 E2E (스펙 §3.1·§3.2·§9)

**Files:**
- Modify: `src/sections/trips/TripsPage.tsx`, `src/sections/trips/planner/TripPlannerPage.tsx`, `playwright.config.ts`(세 프로젝트 `testMatch`에 `'trip-today.spec.ts'`)
- Create: `tests/e2e/trip-today.spec.ts`
- Test: `tests/unit/sections/trips/trips-page.test.tsx`, `tests/unit/sections/trips/planner-layout.test.tsx`

**Interfaces:**
- Consumes: `todayStatus`, `paths.tripToday`.
- Produces: 여행 카드 `li` 안, 링크 다음 형제로 `Button component={Link} to={paths.tripToday(id)} variant="contained"` 글자 `오늘 일정`, 이름 `‘<제목>’ 오늘 일정`(오늘이 `during`일 때만). 계획 화면 지도 칸 왼쪽 위(펼치기 버튼이 있으면 `left: 60`) 링크 버튼 `오늘 일정`(아이콘 `NavigationIcon`, 높이 44)(`during`일 때만).

- [ ] **Step 1: 실패하는 시험**
  - `trips-page.test.tsx`: 시각 2026-10-24 → 2026-10-24~26 여행 카드에 `‘<제목>’ 오늘 일정` 링크(href `/trips/<id>/today`), 2026-11-01 시작 여행에는 없음, 2026-10-23에는 없음, 시작·끝이 2026-10-24인 하루 여행은 2026-10-25 03:00에도 있음(새벽 경계).
  - `planner-layout.test.tsx`: 기간 안 → 지도 칸에 `오늘 일정` 링크, 기간 밖 → 없음. 중간 폭에서 후보 칸을 접으면 `후보 칸 펼치기`와 겹치지 않음(`left` 60px).
  - `trip-today.spec.ts`(세 프로젝트, `mockRoutes`는 `trip-planning.spec.ts`의 것과 같은 녹화 응답):
    1. `page.clock.install({ time: new Date('2026-10-24T08:50:00+09:00') })` → 강릉 여행 만들기(지역 칩 `강릉` → `이 지역으로 여행 만들기` → `만들기`, 시작일 기본값 = 오늘) → `초당순두부 본점`·`경포대`를 Day 1에 넣음 → `/trips` → `‘강릉 여행’ 오늘 일정`.
    2. `region` `다음 장소`의 `h2` `초당순두부 본점`, `계획대로` → `‘초당순두부 본점’ 다녀옴으로 표시` → `h2` `경포대`, 토스트 `되돌리기` → `h2` `초당순두부 본점`.
    3. `page.clock.fastForward('01:40:00')` → 카드에 `늦음`.
    4. 위치: `context.grantPermissions(['geolocation'])` + `context.setGeolocation(<경포대 좌표 — 시드 JSON의 lng·lat>)`, 화면을 다시 열고 다음 장소를 `경포대`로(첫 장소 체크) → `지금 여기`. 좌표를 1km 옮기면 `직선` 거리, `길찾기` href에 그 좌표(좁은 화면 `nmap://route/`·`slat=`, 데스크톱 `https://map.naver.com/p/directions/<lng>,<lat>,`).
- [ ] **Step 2:** FAIL 확인(`yarn vitest run …` + `E2E_PORT=5175 yarn test:e2e tests/e2e/trip-today.spec.ts`). WebKit(iphone)에서 4번의 위치 권한을 줄 수 없으면 그 단계만 `test.skip(browserName === 'webkit', '…')`로 좁히고 보고서에 적는다.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint` + `E2E_PORT=5175 yarn test:e2e tests/e2e/trip-today.spec.ts`.
- [ ] **Step 5:** 커밋 `feat(trips): 여행 목록·계획 화면에 오늘 일정 버튼, 당일 모드 E2E`

---

### Task 8: 전체 확인·되돌리기 확인 (커밋 없음)

- [ ] **Step 1:** `E2E_PORT=5175 yarn test:e2e` 전체 통과.
- [ ] **Step 2:** `yarn build:ci` 통과(`--require-lazy TripTodayPage` 포함). 첫 로딩 JS gzip 값을 `perf-budget.json`의 `measuredInitialJsGzip`(297769)과 비교해 보고(327680 안).
- [ ] **Step 3: 대비** — `error.main`(늦음 글자)을 여섯 테마의 `bg.surface`·`bg.raised` 위에서 `contrastRatio`로 재어 4.5:1 이상인지 보고한다. 미달이면 고치지 말고 보고(계획 화면과 같은 색이라 별도 결정).
- [ ] **Step 4: 되돌리기 확인** — 임시 브랜치(`git switch -c tmp/revert-check`)에서 (a) Task 7 커밋만, (b) Task 6 커밋만, (c) Task 7→6→5→4→3→2→1 순서로 하나씩 `git revert --no-edit` 하며 매번 `yarn typecheck && yarn test`. 끝나면 `git switch -` 하고 임시 브랜치를 지운다. 원격에 올리지 않는다. 결과를 보고서에.
- [ ] **Step 5: 병합 뒤**(PR은 Create a merge commit) — 병합 커밋에 `v0.12.0` 태그, 별도 PR `docs: 롤백 표에 v0.12.0`로 `docs/rollback.md` 표에 `| \`v0.12.0\` | \`<병합 커밋>\` | 여행 당일 모드: 오늘 일정·다음 장소 길찾기·다녀옴 체크·늦어짐·내 위치·화면 켜 두기 (#N) | ✅ |`.
