# 여행 일정 공유 (묶음 F7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계획 화면의 여행 하나를 일정 공유 파일(`tripmap-share` v2, HTML 하나)로 보내고, 받은 사람이 보기 화면에서 Day별 시간표·경로 지도를 보며, 원하면 자기 랜드마크에 여행째 가져온다.

**Architecture:** 앱의 순수 빌더(`buildTripShareDoc`)가 보관함의 여행과 경로 조회 결과로 v2 문서를 만들고, 기존 틀(`public/share-viewer.html`)에 넣는다. 보기 화면은 Effect 없이 v1·v2를 읽고, v2면 앱과 같은 `computeSchedule`로 시각을 계산해 일정 모드로 그린다. 지도 페이지는 규약 v2의 `draw`(핀·선)를 그리고, 옛 지도 페이지(`maxV < 2`)에는 v1 `init`으로 대체한다. 가져오기는 기존 장소 합치기에서 받은 id → 내 id 대응표를 얻어 새 여행을 만드는 연산 하나다.

**Tech Stack:** TypeScript 6, React 19, MUI 7, Jotai, Effect 4.0.2(앱만), Vite 8, Vitest 5(jsdom), Playwright, `CompressionStream('deflate-raw')`, 네이버 지도 JS v3(지도 페이지).

**Spec:** `docs/superpowers/specs/2026-10-16-trip-share-design.md`

## Global Constraints

- 출발점: F1~F6이 모두 병합된 `main`. 브랜치 `feat/trip-share`. 병합은 병합 커밋(Create a merge commit), 병합 뒤 태그 `v0.14.0`.
- 앞 묶음이 먼저 고친 파일(병합본을 읽고 시작한다): `SharePreview.tsx`(F2 `visited: 'all'`, F3 `localDate`를 `src/lib/local-date.ts`로 옮김, F4 제목 라벨로 거른 뒤 근처 모드 끄기), `TripsPage.tsx`(F5 `오늘 일정` 버튼), `DayTimeline.tsx`(F6 `StopRow`의 영업시간 줄), `TripPlannerPage.tsx`(F5·F6), `format.ts`(F6 `hoursCheckedLabel` — 보기 화면이 import해도 되는 순수 함수인지 확인), `schedule.ts`(F5 `ScheduleInput.startMin?` — 보기 화면은 넘기지 않는다), `lazy-routes.ts`·`package.json`(F1 `RestoreDialog`, F5 `TripTodayPage`가 이미 있음).
- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`. 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 사용자 문자열은 React 텍스트·`textContent`로만 넣는다(`dangerouslySetInnerHTML`·`innerHTML` 금지). 보기 화면은 기존 `el()` 도우미를 쓴다.
- 파일에 U+2028/U+2029 원문자 금지. 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 보기 화면(`src/share-viewer/*`)·지도 페이지(`src/share-map/*`)·`src/share-protocol.ts`·`src/domain/share/check-share-trip.ts`는 Effect·React·MUI를 끌고 오는 모듈을 import하지 않는다(`src/schema/*`는 `import type`만). 보기 화면이 런타임으로 import해도 되는 앱 모듈: `src/domain/trips/schedule.ts`, `src/sections/trips/planner/format.ts`, `src/sections/trips/planner/naver-directions.ts`, `src/sections/trips/trip-dates.ts`(Task 1 뒤), `src/lib/calendar.ts`, `src/components/map/map-colors.ts`, `src/schema/label-colors.ts`, `src/theme/tokens/*`.
- 보관함 저장 형식(`tripmap:library:v2`, `schemaVersion: 2`)은 바꾸지 않는다. 장소만 내보내는 `내보내기`는 v1 문서를 지금과 바이트까지 같게 쓴다.
- 지도 페이지의 `ready`는 늘 봉투 `v: 1`로 보낸다(`maxV: 2`). 파일 → 지도의 `draw`는 봉투 `v: 2`에서만 유효하다.
- E2E는 `E2E_PORT=5175`로 돌린다. 5173(다른 프로젝트 개발 서버)과 5174(Playwright 지도 미리보기 서버)는 쓰지도 끄지도 않는다.
- 한도: 장소 1,000곳, 파일 5,242,880바이트, 해시 32,000자, 풀린 해시 5,242,880바이트, `trips` 길이 1, 날 수 1~30, Stop 메모 500자, 한 줄 평 140자, 경로선 구간당 500점·문서 전체 40,000점(빌더는 40,000을 넘으면 솎음), 지도 메시지 핀 2,000·선 2,000·선 하나 1,000점·전체 60,000점·`day` 0~29, 보기 화면 틀 51,200바이트.
- 고정 문구(스펙 §3·§4·§5·§7):
  - 들어가는 곳: `일정 공유`(시간표 머리 버튼, 여행 목록 메뉴 항목).
  - 창: 제목 `일정 공유`, `‘<여행 제목>’ 일정을 HTML 파일 하나로 만들어요`, `Day <D>개 · 일정 <S>곳`(+ ` · 후보 <C>곳`), `제목`, `제목은 1~60자로 써 주세요`, `메모 포함`, `후보 <C>곳도 넣기`, `이동 경로를 받는 중이에요 (<받은 수>/<전체>)`, `<N>구간은 경로를 받지 못해 어림값으로 들어가요`, `이동 시간은 <M>월 <D>일 조회 기준이에요`, `일정에 넣은 장소가 없어요`, `닫기`, `공유`, `공유 준비 중…`, `파일 저장`, `파일을 만들었어요`.
  - 크기 초과(스펙 §3.2): `파일이 너무 커요(약 <X.X>MB). Landmark는 5MB까지 가져올 수 있어요. <줄이는 방법>`. 줄이는 방법: `'메모 포함'이나 '후보 <C>곳도 넣기'를 끄고 다시 해 주세요` / `'메모 포함'을 끄고 다시 해 주세요` / `'후보 <C>곳도 넣기'를 끄고 다시 해 주세요` / `일정을 나눠 보내 주세요`. v1 `내보내기`(스펙 §13 결정 9가 (a)일 때): `'메모 포함'을 끄거나 장소 수를 줄여 다시 해 주세요` / `장소 수를 줄여 다시 해 주세요`.
  - 보기 화면: 부제 `<periodLabel> · 일정 <S>곳`(+ ` · 후보 <C>곳`), 탭 이름 `Day 고르기`, 탭 `Day <n> <shortDate>`·`후보 <C>`, 목록 이름 `Day <n> 일정`, `<HH:mm> 출발`, `첫 장소에서 출발`, `<도착> ~ <출발>`, `체류 <formatSpan>`, `<HH:mm> 고정`, `여유 …`/`늦음 …`(`formatSlack`), `한 줄 평 <평>`, `네이버 지도에서 보기`, `자동차`/`도보`, `직선 추정`, `경로 없음 · 직선 추정`, `통행료 <n>원`, `길찾기`, `<HH:mm> 도착`, 합계 `formatTotals`, `<M>월 <D>일 조회`(`queriedLabel`), `경로를 받지 못해 어림값이에요`, `이 날은 아직 일정이 없어요`, `아직 Day에 넣지 않은 장소예요`, 큰 일정 `일정이 커서 바로 담을 수 없어요. Landmark에서 이 파일을 가져와 주세요` + `Landmark 열기`. 출발점 아이콘 `🏠`(1일차)·`🛏`.
  - 읽기 오류(새): `새 버전 Landmark에서 만든 파일이에요. 앱을 새로 고친 뒤 다시 열어 주세요`.
  - 미리보기: `여행 계획도 가져오기`, `새 여행으로 만들어요. 이동 시간은 내 Landmark에서 다시 조회해요`, `같은 이름·기간의 여행이 이미 있어요. 가져오면 하나 더 생겨요`, `여행에 쓰이는 장소는 모두 가져와요`, `여행 가져오기`, `일정 <S>곳 · 후보 <C>곳`, 빈 제목 `받은 여행`, 결과 `여행 ‘<제목>’<을/를> 가져왔어요`(+ `. <장소 결과 문장>`).

## Review Focus

1. **출발지·숙소가 지워진(묘비) 여행, 출발점과 숙소가 같은 Day, 출발점이 없는 Day** → 파일이 `checkShareTrip`을 통과하고 시간표·구간 수·마커가 앱 계획 화면과 같다(같은 장소 마커는 하나). Task 4(빌더)·Task 6(`dayView`·`tripPins`) 시험으로 고정.
2. **경로를 아직 다 받지 못했거나 오프라인일 때 저장** → 답 없는 구간은 `estimated`·경로선 없음, 창 상태 문구, 보기 화면 합계 앞 `약`·`직선 추정`. Task 8(창)·Task 6(`dayView`) 시험으로 고정.
3. **받은 두 장소가 내 장소 하나로 합쳐짐(같은 이름 핀 둘이 50m 안), 받은 출발지가 Stop과 같은 장소** → 새 여행이 `LibrarySchema`를 통과하고 뒤에 나온 Stop만 빠짐. Task 9 시험으로 고정.
4. **새 일정 파일을 옛 지도 페이지(`maxV: 1`)가 받음, 지도 페이지가 다시 읽힘(`ready` 두 번)** → v1 `init`·접두사 뗀 `focus`로 대체, 다시 읽히면 마지막 `draw`/`init`을 다시 보냄. Task 7 시험으로 고정.
5. **자정을 넘기는 일정·고정 시각보다 늦게 도착·`same-point` 구간** → 보기 화면 시각·여유/늦음이 앱 `computeSchedule` 결과와 같고 같은 지점 구간은 행·선이 없다. Task 6 시험으로 고정.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/lib/calendar.ts` | `daysBetween`(순수) |
| `src/schema/share.ts`, `src/domain/share/check-share-trip.ts` | v2 타입·스키마, 관계 검사(순수) |
| `src/domain/share/read-share.ts` | v1·v2 읽기, `newer` |
| `src/domain/share/build-trip-share.ts`, `src/sections/share-export/make-share-html.ts` | 일정 문서 만들기, HTML 만들기 |
| `src/share-protocol.ts`, `src/share-map/{main,map,trip-layers}.ts` | 규약 v2, 지도 페이지 `draw` |
| `src/share-viewer/{parse,trip-view,encode}.ts` | 보기 화면 데이터(순수) |
| `src/share-viewer/{render-trip,map-frame,main}.ts`, `styles.css` | 보기 화면 그리기·지도 연결 |
| `src/sections/share-export/*`, `src/sections/trips/planner/use-day-plan.ts`·`DayHeader.tsx`·`DayTimeline.tsx`, `src/sections/trips/TripsPage.tsx`, `src/routes/lazy-routes.ts`, `package.json` | 일정 공유 창과 들어가는 곳 |
| `src/domain/library/{import-share,import-share-trip}.ts` | 여행째 가져오기 연산 |
| `src/sections/share-import/{SharePreview,ShareTripBox}.tsx` | 미리보기 여행 칸 |
| `tests/e2e/trip-share.spec.ts`, `docs/rollback.md` | E2E, 롤백 표 |
6. **긴 메모(최대 10,000자)가 많은 일정을 `메모 포함`·`후보도 넣기`(둘 다 기본 켬)로 내보냄** → 받는 쪽 가져오기 한도 5,242,880바이트를 넘는 파일을 만들면 안 된다 → 최종 HTML 바이트를 재서 저장·공유를 막고 줄이는 방법을 창 안에. Task 4(`shareHtmlBytes`)·Task 8(창) 시험으로 고정.

---

### Task 1: 보기 화면이 쓸 순수 모듈 정리

**Files:**
- Create: `src/lib/calendar.ts`
- Modify: `src/schema/trip.ts`(`daysBetween` 정의를 옮기고 `export { daysBetween } from 'src/lib/calendar'`), `src/sections/trips/trip-dates.ts`(import 경로), `src/sections/trips/planner/use-day-plan.ts`(export 추가만)
- Test: `tests/unit/lib/calendar.test.ts`, 기존 `tests/unit/schema/*trip*`·`tests/unit/sections/trips/*`·`tests/unit/sections/trips/planner/*` 그대로

**Interfaces:**
- Produces:
  ```ts
  // src/lib/calendar.ts — import 없음
  export function daysBetween(start: string, end: string): number; // 지금 trip.ts의 것 그대로
  // src/sections/trips/planner/use-day-plan.ts — 이미 있는 함수에 export만 붙인다(동작 그대로)
  export const routeKeyOf: (leg: Leg) => string;
  export function planLeg(leg: Leg, state: RouteState | undefined): PlannedLeg;
  export const lookupAll: (store: Store, requests: { key: string; refresh: boolean }[]) => Effect.Effect<void>;
  ```

- [ ] **Step 1: 실패하는 시험**: `calendar.test.ts` — `daysBetween('2026-10-24','2026-10-26') === 3`, 같은 날 1, 거꾸로 0 이하, 서머타임 걸친 날짜(`'2026-03-28'`~`'2026-03-30'`) 3. 그리고 "`src/sections/trips/trip-dates.ts`의 정적 import에 `src/schema/` 가 없다"(파일 텍스트를 읽어 정규식으로 확인).
- [ ] **Step 2:** `yarn vitest run tests/unit/lib/calendar.test.ts` → FAIL
- [ ] **Step 3:** 옮기고 export를 붙인다.
- [ ] **Step 4:** `yarn vitest run tests/unit/lib tests/unit/schema tests/unit/sections/trips` PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `refactor(trips): 날짜·구간 계산을 보기 화면이 쓸 수 있게 내보내기`

---

### Task 2: 공유 형식 v2와 관계 검사

**Files:**
- Create: `src/domain/share/check-share-trip.ts`
- Modify: `src/schema/share.ts`
- Test: `tests/unit/domain/share/check-share-trip.test.ts`, `tests/unit/schema/share.test.ts`(없으면 만든다)

**Interfaces:**
- Produces:
  ```ts
  // src/schema/share.ts
  export type SharePlace = { /* 지금 필드 */ review?: string }; // 메모 포함이고 한 줄 평이 있을 때만(v2 문서만)
  export type ShareStop = { placeId: string; stayMin: number | null; fixedTime: string | null; note?: string };
  export type ShareLegStatus = 'routed' | 'estimated' | 'no-route' | 'same-point';
  export type ShareLeg = { from: string; to: string; mode: 'car' | 'walk'; durationS: number; distanceM: number;
    tollFare: number | null; status: ShareLegStatus; queriedAt: string | null; path: [number, number][] };
  export type ShareDay = { startTime: string; lodgingId: string | null; stops: ShareStop[]; legs: ShareLeg[] };
  export type ShareTrip = { title: string; startDate: string; endDate: string; originId: string | null;
    candidateIds: string[]; days: ShareDay[]; legModes: Record<string, 'car' | 'walk'> };
  export type ShareDocV1 = { format: 'tripmap-share'; version: 1; title: string; createdAt: string; labels: ShareLabel[]; places: SharePlace[] };
  export type ShareDocV2 = Omit<ShareDocV1, 'version'> & { version: 2; trips: ShareTrip[] };
  export type ShareDoc = ShareDocV1 | ShareDocV2;
  export const ShareDocSchema;   // v1, 이름·모양 그대로(SharePlaceSchema에 review를 더하지 않는다)
  export const ShareDocV2Schema; // v1 필드 + places[].review(optionalKey, ≤140) + trips(길이 정확히 1)
  // src/domain/share/check-share-trip.ts — `import type`만
  export const SHARE_TRIP_LIMITS = { trips: 1, maxDays: 30, stopNoteChars: 500, stayMaxMin: 1440,
    pathPointsPerLeg: 500, pathPointsTotal: 40_000 } as const;
  /** 그날 점 목록: [출발점?, …Stop, 도착점?]. 출발점은 Day 0이면 originId, 그 뒤는 전날 lodgingId. */
  export function dayPoints(trip: ShareTrip, dayIndex: number): string[];
  /** 스펙 §5.2 표의 관계 규칙. 문제마다 한국어 한 줄, 없으면 []. */
  export function checkShareTrip(doc: ShareDocV2): string[];
  ```
- `ShareDocV2Schema`의 `startDate`·`endDate`는 `CalendarDate`, `startTime`·`fixedTime`은 `HHmm`, `queriedAt`은 `NullOr(IsoDateTime)`, `stayMin`은 0~1440 정수 또는 `null`, `note`는 `optionalKey(String ≤500)`, `legModes`는 `Record(String, Literals(['car','walk']))`(키 형식은 `checkShareTrip`이 본다 — `library.ts`와 같은 이유), 장소 좌표는 v1과 같이 `Lng`/`Lat`, 경로선 점은 유한한 수 둘(`Schema.Tuple([Finite, Finite])`).
- `checkShareTrip`은 날짜 계산에 Task 1의 `daysBetween`을 쓴다.

- [ ] **Step 1: 실패하는 시험**
  - 스키마: 정상 v2 통과, 모르는 필드(`places[0].foo`, `trips[0].id`) 거절(`onExcessProperty: 'error'`), `review` 141자 거절, `trips: []`·두 개 거절, `version: 2`를 `ShareDocSchema`(v1)가 거절, v1 정상 문서는 그대로 통과(기존 시험).
  - `checkShareTrip`: 정상 → `[]`; 기간 3일인데 `days` 2개; 31일; `stops[0].placeId`가 `places`에 없음; 같은 장소가 Stop과 후보에 둘 다; `places`에 여행이 안 쓰는 장소; `legs` 수 어긋남 — (출발지 없음·숙소 없음 Stop 2 → 구간 1), (출발지 있음·숙소 있음 Stop 0 → 구간 1), (출발지 있음·숙소 없음 Stop 2 → 구간 2), Day 2의 출발점이 Day 1 숙소; `from`/`to` 순서 틀림; `routed`인데 `queriedAt: null`; `estimated`인데 `path` 점 있음; 한 구간 501점; 전체 40,001점; `legModes` 키 `abc`·없는 id.
  - `dayPoints`: 위 네 조합의 결과 배열.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/share/check-share-trip.test.ts tests/unit/schema/share.test.ts` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn vitest run tests/unit/domain/share` 전부 + `yarn typecheck`(`ShareDoc`이 합 타입이 되어 깨지는 곳은 `doc.version === 2` 좁히기로 고치되, v1 동작은 바꾸지 않는다)
- [ ] **Step 5:** 커밋 `feat(share): 일정 공유 형식 v2와 관계 검사`

---

### Task 3: v2 읽기

**Files:**
- Modify: `src/domain/share/read-share.ts`
- Test: `tests/unit/domain/share/read-share.test.ts`

**Interfaces:**
- Consumes: Task 2의 `ShareDocV2Schema`, `checkShareTrip`.
- Produces:
  ```ts
  export type ShareReadError = 'too-big' | 'not-share' | 'corrupt' | 'empty' | 'too-many' | 'newer';
  // SHARE_READ_MESSAGES.newer = '새 버전 Landmark에서 만든 파일이에요. 앱을 새로 고친 뒤 다시 열어 주세요'
  export type ShareReadResult = { ok: true; doc: ShareDoc } | { ok: false; error: ShareReadError };
  ```
- `validate` 순서: `format === 'tripmap-share'`이고 `version`이 3 이상의 유한한 수면 `newer`. `version === 2`면 `ShareDocV2Schema`(실패 `corrupt`) → 장소·라벨 id 겹침(`corrupt`) → 장소 0곳 `empty` → `checkShareTrip`(문제가 있으면 `corrupt`) → 1,000곳 초과 `too-many`. 그 밖은 지금의 v1 경로 그대로.

- [ ] **Step 1: 실패하는 시험**: Task 2 시험의 정상 v2 문서로 만든 HTML → `readShareHtml` ok·같은 문서; `encodeCompressedJson(v2)` → `readShareHash` ok; `version: 3` → `newer`; `version: 2`인데 관계 검사 실패 → `corrupt`; 장소 없이 Day만 있는 v2 문서 → `empty`; 장소 1,001곳 v2 → `too-many`; v1 시험 전부 그대로; `SHARE_READ_MESSAGES.newer` 문구가 Global Constraints와 같음.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/share/read-share.test.ts` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn vitest run tests/unit/sections/share-import` 그대로 PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(share): 일정 공유 파일 읽기`

---

### Task 4: 일정 문서 만들기

**Files:**
- Create: `src/domain/share/build-trip-share.ts`
- Modify: `src/sections/share-export/make-share-html.ts`
- Test: `tests/unit/domain/share/build-trip-share.test.ts`, `tests/unit/sections/share-export/make-share-html.test.ts`(없으면 만든다), `tests/unit/domain/share/inject.test.ts`(v2 한 경우 추가)

**Interfaces:**
- Consumes: Task 2 타입·`checkShareTrip`·`ShareDocV2Schema`, `dayLegs`·`dayEndpoints`·`visibleStops`·`visibleCandidates`(`src/domain/trips/query.ts`), `Leg`.
- Produces:
  ```ts
  // src/domain/share/build-trip-share.ts
  export type ShareLegTime = Pick<ShareLeg, 'durationS' | 'distanceM' | 'tollFare' | 'status' | 'queriedAt' | 'path'>;
  export type BuildTripShareOptions = { title: string; includeMemo: boolean; includeCandidates: boolean; now: Date };
  /** 여행이 없거나 지웠으면 null. 장소 순서·담는 것은 스펙 §3.3. */
  export function buildTripShareDoc(lib: Library, tripId: string, routeOf: (leg: Leg) => ShareLegTime,
    opts: BuildTripShareOptions): ShareDocV2 | null;
  /** 문서 전체 경로선 점이 max를 넘으면 구간마다 같은 비율로 솎는다(각 선의 첫·끝 점은 남김). 입력을 바꾸지 않는다. */
  export function thinPaths(days: ShareDay[], max: number): ShareDay[];
  // src/sections/share-export/make-share-html.ts
  export function renderTripShareHtml(template: string, lib: Library, tripId: string,
    routeOf: (leg: Leg) => ShareLegTime, opts: BuildTripShareOptions): Result.Result<ShareHtml, ShareDocInvalid>;
  /** 최종 파일 바이트(UTF-8). `new TextEncoder().encode(html).byteLength` — `File([html]).size`와 같다. */
  export function shareHtmlBytes(html: string): number;
  /** 가져오기 한도와 같은 값(`SHARE_IMPORT_LIMITS.fileBytes`, 5,242,880). 이 값과 같으면 통과. */
  export const SHARE_FILE_MAX_BYTES: number;
  ```
- 장소 하나의 필드는 기존 `buildShareDoc`의 장소 변환을 함수로 빼서(`toSharePlace(place, lib, includeMemo)`, 같은 파일 안 export) 같이 쓴다. v1 결과는 바뀌지 않는다. `review`는 `includeMemo`이고 `place.review?.value`가 빈 문자열이 아닐 때만(C1).
- `renderTripShareHtml`은 빌더가 `null`이면 `ShareDocInvalid('여행을 찾지 못했어요')`, 스키마·`checkShareTrip` 실패도 `ShareDocInvalid`. `count`는 장소 수, 파일 이름은 `shareFileName(title, now)`.
- 구간 상태 대응은 창(Task 8)의 `routeOf`가 한다. 빌더는 받은 값을 그대로 넣되 `status !== 'routed'`면 `path: []`·`queriedAt: null`로 맞춘다.

- [ ] **Step 1: 실패하는 시험** (보관함 fixture: 출발지 `home`, Day 1 Stop A·B, Day 1 숙소 H, Day 2 Stop C(A와 같은 라벨), Day 2 숙소 H, 후보 D, 다른 여행의 장소 E)
  - 장소 순서 `[home, A, B, H, C, D]`, E 없음, H는 한 번.
  - `routeOf`가 받은 `Leg`의 `from.id`/`to.id` 순서가 `dayLegs`와 같고, 결과 `legs[].from/to`도 같다. Day 1 구간 3개(home→A, A→B, B→H), Day 2 구간 2개(H→C, C→H).
  - `includeCandidates: false` → `candidateIds: []`, D 없음. `includeMemo: false` → `memo`·`review` 키 없음, Stop `note`는 있음. 빈 Stop 메모 → `note` 키 없음.
  - 출발지가 묘비 → `originId: null`, Day 1 구간 1개 줄어듦. Stop B가 묘비 → B 없음, 구간이 A→H.
  - `legModes`: 담긴 장소 사이 키만, 다른 키 없음.
  - `status: 'estimated'`인데 `path`를 준 `routeOf` → 결과 `path: []`.
  - `thinPaths`: 3개 선(300·300·400점), `max` 500 → 합 ≤ 500, 각 선 첫·끝 점 그대로, 입력 배열 불변.
  - 모든 결과가 `ShareDocV2Schema`(`onExcessProperty: 'error'`)와 `checkShareTrip`을 통과.
  - `renderTripShareHtml`: 지운 여행 → 실패 `ShareDocInvalid`; 여행 제목·Stop 메모에 `</script><script>window.__injected = 1</script>` → 데이터 블록 안에 `<` 없음, `readShareHtml`로 같은 문서.
  - `shareHtmlBytes`: `'a'` → 1, `'가'` → 3, `'😀'` → 4, 메모 10,000자(한글) 장소 하나가 든 HTML → `new File([html], 'x.html').size`와 같음. `SHARE_FILE_MAX_BYTES === SHARE_IMPORT_LIMITS.fileBytes`.
  - 기존 `build-share.test.ts` 그대로 PASS(v1 불변).
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/share tests/unit/sections/share-export` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(share): 여행 하나로 일정 공유 문서 만들기`

---

### Task 5: 지도 규약 v2와 지도 페이지의 `draw`

**Files:**
- Create: `src/share-map/trip-layers.ts`
- Modify: `src/share-protocol.ts`, `src/share-map/map.ts`, `src/share-map/main.ts`
- Test: `tests/unit/share-protocol.test.ts`, `tests/unit/share-map/trip-layers.test.ts`, `tests/unit/share-map/map.test.ts`, `tests/unit/share-map/main.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/share-protocol.ts
  export const SHARE_PROTOCOL_VERSION = 1;       // 그대로: 지도 → 파일 봉투, v1 메시지
  export const SHARE_PROTOCOL_MAX_VERSION = 2;   // ready.maxV
  export type MapPin = { id: string; label: string; lng: number; lat: number; day: number | null; role: 'stop' | 'endpoint' | 'dim' };
  export type MapLine = { id: string; day: number; walk: boolean; path: [number, number][] };
  export type ToMap = /* 지금 셋 */ | { kind: 'draw'; pins: MapPin[]; lines: MapLine[] };
  export const MAP_DRAW_LIMITS = { pins: 2000, lines: 2000, pointsPerLine: 1000, pointsTotal: 60_000, maxDay: 29 } as const;
  export type Envelope<T> = T & { source: typeof SHARE_SOURCE; v: 1 | 2 };
  export function envelope<T extends ToMap | FromMap>(msg: T, v?: 1 | 2): Envelope<T>; // 기본 1
  export function parseToMap(data: unknown): ToMap | null; // 봉투 v 1·2, draw는 v 2에서만, 한도 넘으면 null, 아는 필드만 돌려줌
  export function parseFromMap(data: unknown): FromMap | null; // 그대로(v 1만)
  // src/share-map/trip-layers.ts
  export function drawLayers(pins: MapPin[], lines: MapLine[], selectedId: string | null):
    { markers: MapMarker[]; polylines: MapPolyline[] };
  // src/share-map/map.ts
  export type ShareMap = { init(places: MapPlace[]): void; draw(pins: MapPin[], lines: MapLine[]): void;
    focus(id: string | null): void; filter(ids: string[]): void };
  ```
- `drawLayers` 규칙(스펙 §6.1, 앱 `trip-map-layers.ts`와 같은 값): 색 `day === null ? NO_CATEGORY_COLOR : dayColor(day)`, `textColor: '#ffffff'`, `endpoint`는 `borderColor: '#000000'`, `dim`은 `label: ''`·`dimmed: true`·`fit: false`, `day === null`도 `fit: false`(맞출 핀이 없으면 어댑터 규칙대로 전부에 맞춘다), 모두 `clusterable: false`, `selected: id === selectedId`. 선은 `{ id, path, color: dayColor(day), dashed: walk }`.
- `map.ts`: 상태에 `mode: 'places' | 'trip'`. `draw`는 trip 모드로 바꾸고 마커·선을 그린 뒤 `fit`이 아닌 핀을 뺀 점들로 처음 맞추기(지금 `fitAll`과 같은 1곳·같은 좌표·줌 16 상한 규칙), `init`은 places 모드로 바꾸고 선을 비운다. 붙기 전에 온 `draw`는 붙은 뒤 반영(지금 `pendingCamera` 방식). `focus`·마커 클릭·`select`는 두 모드 모두 지금 규칙(trip 모드에서는 핀 id).
- `main.ts`: `ready`를 `{ kind: 'ready', maxV: SHARE_PROTOCOL_MAX_VERSION }`(봉투 기본 v 1)로, `draw` 메시지를 `shareMap.draw`로.

- [ ] **Step 1: 실패하는 시험**
  - 프로토콜: v 2 봉투 `draw` 정상 → 같은 값(모르는 필드는 빠짐); v 1 봉투 `draw` → `null`; v 2 봉투 `init`·`focus` → 정상; `day: 30`·`1.5`·`-1` → `null`; `role: 'x'` → `null`; 핀 2,001개·선 하나 1,001점·전체 60,001점 → `null`; `NaN` 좌표 → `null`; `parseFromMap`은 v 2 봉투를 버림(그대로). `envelope(msg)`의 `v === 1`, `envelope(msg, 2)`의 `v === 2`.
  - `drawLayers`: 위 규칙 값 하나씩(색·글자·테두리·흐림·fit·clusterable·selected·점선).
  - `map`(카메라 가짜 어댑터): `draw` → 마커 수·선 수, 흐린 점 빼고 맞춤, 그 뒤 `init` → 선 0개·장소 마커, 붙기 전 `draw` → 붙은 뒤 마커·선, 마커 클릭 → `select`에 핀 id(`start:…` 그대로).
  - `main`: 보낸 `ready`가 `{ source: 'tripmap-share', v: 1, kind: 'ready', maxV: 2 }`; v 2 `draw`가 오면 가짜 지도에 마커가 생김; 클라이언트 ID 없음 경로는 그대로(`ready` 뒤 `tiles-failed`).
- [ ] **Step 2:** `yarn vitest run tests/unit/share-protocol.test.ts tests/unit/share-map` → FAIL
- [ ] **Step 3:** 구현. 지도 페이지가 새로 import하는 파일이 `deploy-share-map.yml`의 `paths` 안(`src/share-map/**`, `src/share-protocol.ts`, `src/components/map/**`)인지 확인한다.
- [ ] **Step 4:** PASS + `yarn build:map:e2e` 성공 + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(share-map): 지도 규약 v2 draw(Day 색 핀·경로선)`

---

### Task 6: 보기 화면 데이터 (읽기·시간표 계산·핀·해시)

**Files:**
- Create: `src/share-viewer/trip-view.ts`
- Modify: `src/share-viewer/parse.ts`, `src/share-viewer/encode.ts`
- Test: `tests/unit/share-viewer/parse.test.ts`, `tests/unit/share-viewer/trip-view.test.ts`, `tests/unit/share-viewer/encode.test.ts`

**Interfaces:**
- Consumes: Task 2 타입·`checkShareTrip`·`dayPoints`, Task 5 `MapPin`·`MapLine`, `computeSchedule`, `addDays`·`shortDate`·`periodLabel`.
- Produces:
  ```ts
  // parse.ts
  export function parseShareDoc(value: unknown): ShareDoc | null; // v1 그대로 + v2 손 검사, v2는 장소 1곳 이상이고 checkShareTrip이 []일 때만
  // trip-view.ts
  export type DayRow =
    | { kind: 'start'; placeId: string; icon: '🏠' | '🛏'; departMin: number }
    | { kind: 'no-start'; departMin: number }
    | { kind: 'stop'; number: number; stop: ShareStop; arriveMin: number; departMin: number; slackMin: number | null }
    | { kind: 'leg'; leg: ShareLeg }                 // same-point는 넣지 않는다
    | { kind: 'end'; placeId: string; arriveMin: number };
  export type DayView = { date: string; rows: DayRow[];
    totals: { travelS: number; distanceM: number; tollFare: number; approximate: boolean };
    hasLegs: boolean; oldestQueriedAt: string | null };
  export function dayView(trip: ShareTrip, dayIndex: number): DayView;
  export type TripTab = { kind: 'day'; dayIndex: number } | { kind: 'candidates' };
  export function tripPins(doc: ShareDocV2, tab: TripTab): { pins: MapPin[]; lines: MapLine[] };
  /** 핀 id → 장소 id(`start:`·`end:`를 뗀다). */
  export function placeIdOfPin(id: string): string;
  // encode.ts
  export function hashDoc(doc: ShareDoc): ShareDoc; // v2면 모든 legs[].path를 []로 바꾼 사본, v1은 그대로
  // importLink(doc, app)는 hashDoc(doc)를 압축한다(나머지 동작 그대로)
  ```
- `dayView`의 시각은 `computeSchedule({ startTime, hasStart, stops, hasEnd, legs: legs.map(l => ({ durationS, distanceM, tollFare, estimated: l.status === 'estimated' || l.status === 'no-route' })) })`. 출발점·도착점 판단은 `dayPoints`와 같다.
- `tripPins`(day 탭): Stop `"<n> <이름>"`·`role: 'stop'`·`day: dayIndex`·id=장소 id; 출발점 `start:<id>`·`"🏠 "/"🛏 " + 이름`·`endpoint`; 숙소 `end:<id>`·`"🛏 " + 이름`·`endpoint`(출발점과 같은 장소면 숙소 핀 없음); 다른 Day Stop은 `dim`·`day: d`·id=장소 id(이미 있는 id는 건너뜀); 선은 `same-point`가 아닌 구간마다 `id: '<from>><to>'`, `routed`면 `path`, 아니면 두 점 직선. 후보 탭: 후보만 `role: 'stop'`·`day: null`·`label: 이름`, 선 없음.

- [ ] **Step 1: 실패하는 시험**
  - `parse`: v1 기존 시험 그대로; v2 정상 → 같은 값; `trips[0].days[0].stops[0].stayMin: '60'` → `null`; 관계 검사 실패 → `null`; v2 장소 0곳 → `null`; `version: 3` → `null`.
  - `dayView`: (1) 출발지 있음·숙소 있음·Stop 2, 구간 600·900·300초, 출발 `09:00`, 체류 60·`null` → 행 순서와 `departMin`·`arriveMin` 값이 같은 입력의 `computeSchedule` 결과와 같음; (2) 출발점 없음 → 첫 행 `no-start`; (3) 고정 `10:00`인데 `10:20` 도착 → `slackMin === -20`; (4) 출발 `23:00`·구간 2시간 → 도착 `1500`; (5) `same-point` 구간 → `leg` 행 없음·시간 0; (6) `estimated` 구간 → `totals.approximate`; (7) 조회 시각 둘 중 이른 것이 `oldestQueriedAt`.
  - `tripPins`: Review Focus 1의 경우(출발점=숙소 → 핀 하나, 다른 Day 점 dim, 후보 탭 회색·선 0).
  - `encode`: v2 문서의 `hashDoc` → 모든 `path` 길이 0이고 원본은 그대로; `importLink(v2)`의 해시를 앱 `readShareHash`로 풀면 `ok`(경로선 없는 문서).
- [ ] **Step 2:** `yarn vitest run tests/unit/share-viewer` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(share-viewer): 일정 파일 읽기와 시간표 계산`

---

### Task 7: 보기 화면 일정 모드 그리기와 지도 연결

**Files:**
- Create: `src/share-viewer/render-trip.ts`
- Modify: `src/share-viewer/map-frame.ts`, `src/share-viewer/main.ts`, `src/share-viewer/render.ts`(공용 도우미 `el`·`newTabLink`·`naverUrl`·`labelChip`·장소 카드 그리기를 export해 같이 씀), `src/share-viewer/styles.css`
- Test: `tests/unit/share-viewer/render-trip.test.ts`, `tests/unit/share-viewer/map-frame.test.ts`, `tests/unit/share-viewer/main.test.ts`, `tests/unit/share-viewer/render.test.ts`(그대로)

**Interfaces:**
- Consumes: Task 6 전부, Task 5 `envelope(msg, 2)`·`SHARE_PROTOCOL_MAX_VERSION`, `formatClock`·`formatSpan`·`formatSlack`·`formatDuration`·`formatDistance`·`formatTotals`·`queriedLabel`, `naverDirectionsUrl`, `dayColor`.
- Produces:
  ```ts
  // map-frame.ts
  export type MapPort = { focus(id: string | null): void; filter(ids: string[]): void;
    draw(layers: { pins: MapPin[]; lines: MapLine[] }): void };
  export function connectMapFrame(host: HTMLElement, opts: { mapUrl: string; places: MapPlace[];
    onSelect(id: string): void; win?: Window }): MapPort;
  // render-trip.ts
  export function renderTripViewer(root: HTMLElement, doc: ShareDocV2, map: MapPort,
    opts: { app: string; compact(): boolean }): { highlight(id: string): void; setImportLink(link: ImportLink): void };
  ```
- `connectMapFrame`: `draw`도 `latest`에 같은 종류 하나로 기억한다. `ready`가 오면 `maxV >= 2`이고 `draw`를 기억하면 `envelope(draw, 2)` 뒤 기억한 `focus`를 v 2로; 아니면 지금처럼 v 1 `init(places)` 뒤 `focus`·`filter`를 v 1로 보내되 `focus.placeId`는 `placeIdOfPin`으로 바꾼다. `draw`를 한 번도 부르지 않은 장소 모드는 지금과 똑같다.
- `renderTripViewer`: 스펙 §4.2~§4.5의 DOM과 문구. 탭은 `button[role=tab]`(`id`, `aria-controls`, `aria-selected`, 고른 것만 `tabIndex=0`), 좌우 화살표·Home·End로 옮기고 고른다. 탭을 바꿀 때마다 `map.draw(tripPins(doc, tab))`. 장소 행 누름·Enter·Space → 강조 + `map.focus(핀 id)`. `highlight(id)`: 그 핀의 Day가 지금 탭이 아니면(dim 점) 그 Day 탭으로 바꾼 뒤 행 강조·스크롤. `길찾기`는 `naverDirectionsUrl(…, opts.compact() ? 'app' : 'web')`, 주소가 `null`이면 링크 없음. 큰 일정 안내 문구는 Global Constraints.
- `main.ts`: `doc.version === 2`면 `renderTripViewer`(`compact = () => matchMedia('(max-width: 767px)').matches`), 아니면 지금 `renderViewer`. 지도 연결의 `places`는 두 경우 모두 `toMapPlaces(doc)`.
- `styles.css`: 768px 이상에서 왼쪽 칸 400px(일정 모드만, `#root[data-mode="trip"]`), 탭·행·`길찾기`·`Landmark에 담기` 최소 높이 44px, 탭 아래 Day 색 막대와 번호 동그라미 테두리는 인라인 `style.borderColor`(값은 `dayColor`), 늦음은 오류 색 + 굵게, `:focus-visible { outline: 2px solid var(--tm-accent-text); outline-offset: 2px }`.

- [ ] **Step 1: 실패하는 시험**
  - `render-trip`(jsdom, 가짜 `MapPort`): `h1`·`document.title`; 부제 `10.24(금) ~ 10.26(일) · 2박 3일 · 일정 3곳 · 후보 1곳`; 탭 `Day 1 10.24(금)`·`Day 2 …`·`후보 1`; 처음 `draw` 한 번(Day 1 핀); `Day 2` 누름 → `draw` 다시·목록 이름 `Day 2 일정`; 오른쪽 화살표 → 다음 탭 고름·포커스; 행 누름 → `focus('<id>')`·`aria-current`; 행 안 링크 누름 → `focus` 안 부름; `highlight('end:<H>')` → 숙소 행 강조; `highlight('<Day 2 Stop id>')`(Day 1 탭에서) → Day 2 탭으로 바뀜; 빈 Day → `이 날은 아직 일정이 없어요`; 메모에 `<b>x</b>` → 글자 그대로; 구간 문구 `자동차 25분 · 18km`·`직선 추정`·`통행료 3,000원`; 합계와 `10월 16일 조회`; 받은 경로 없음 → `경로를 받지 못해 어림값이에요`; `길찾기` 주소(`compact` 참 → `nmap://`, 거짓 → `https://map.naver.com/p/directions/`); `setImportLink(too-big)` → 큰 일정 문구와 `Landmark 열기`.
  - `map-frame`: `draw` 부른 뒤 `ready(maxV 2)` → 받은 메시지가 `v: 2, kind: 'draw'` 다음 `v: 2, kind: 'focus'`; `ready(maxV 1)` → `v: 1, kind: 'init'`(라벨 색 장소) 다음 `focus.placeId`가 접두사 없음, `draw`는 보내지 않음; `ready` 두 번 → 두 번째도 마지막 `draw`; 장소 모드 기존 시험 그대로.
  - `main`: v2 데이터 블록 → 일정 모드(`tablist` 있음), v1 → 장소 목록(기존).
- [ ] **Step 2:** `yarn vitest run tests/unit/share-viewer` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn build:viewer` 성공 + `wc -c public/share-viewer.html`이 51,200 이하(값을 PR 설명에 적는다) + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(share-viewer): 일정 모드(Day 탭·시간표·경로 지도)`

---

### Task 8: 앱의 일정 공유 창과 들어가는 곳

**Files:**
- Create: `src/sections/share-export/ShareFileDialog.tsx`, `src/sections/share-export/LazyDialogHost.tsx`, `src/sections/share-export/TripShareDialog.tsx`, `src/sections/share-export/TripShareDialogHost.tsx`, `src/sections/share-export/use-trip-legs.ts`
- Modify: `src/sections/share-export/ExportHtmlDialog.tsx`, `src/sections/share-export/ExportHtmlDialogHost.tsx`, `src/sections/trips/planner/DayHeader.tsx`, `src/sections/trips/planner/DayTimeline.tsx`, `src/sections/trips/TripsPage.tsx`, `src/routes/lazy-routes.ts`, `package.json`(`build:ci`에 `--require-lazy TripShareDialog`)
- Test: `tests/unit/sections/share-export/*`(기존 `ExportHtmlDialog` 시험은 고치지 않고 PASS), `tests/unit/sections/share-export/trip-share-dialog.test.tsx`, `tests/unit/sections/share-export/use-trip-legs.test.tsx`, `tests/unit/sections/trips/planner/day-header.test.tsx`·`tests/unit/sections/trips/trips-page.test.tsx`(있는 파일에 더함), `tests/unit/routes/lazy-routes.test.ts`(있으면 `PANEL_CHUNKS`)

**Interfaces:**
- Consumes: Task 1 `planLeg`·`routeKeyOf`·`lookupAll`, Task 4 `renderTripShareHtml`·`ShareLegTime`, `isSamePointLeg`, `dayLegs`, `routeStatesAtom`, `queriedLabel`.
- Produces:
  ```ts
  // ShareFileDialog.tsx — 지금 ExportHtmlDialog의 몸통을 옮긴 것
  export type ShareFileOptions = { title: string; includeMemo: boolean; now: Date };
  export function ShareFileDialog(props: { open: boolean; onClose(): void; heading: string; summary: ReactNode;
    defaultTitle: string; emptyMessage: string | null; children?: ReactNode;
    make(template: string, opts: ShareFileOptions): Result.Result<ShareHtml, ShareDocInvalid>;
    /** 있으면 크기 검사를 켠다. 한도를 넘을 때 문구 끝에 붙일 줄이는 방법. */
    tooBigHint?(opts: ShareFileOptions): string }): JSX.Element;
  // LazyDialogHost.tsx — 지금 ExportHtmlDialogHost의 everOpened·ShellDialog·ChunkErrorBoundary·Suspense
  export function LazyDialogHost(props: { open: boolean; onClose(): void; heading: string; children: ReactNode }): JSX.Element | null;
  // use-trip-legs.ts
  export type TripLegs = { routeOf(leg: Leg): ShareLegTime; total: number; answered: number;
    estimated: number; oldestQueriedAt: string | null };
  export function useTripLegs(tripId: string, active: boolean): TripLegs;
  // TripShareDialog.tsx / Host
  export function TripShareDialog(props: { open: boolean; onClose(): void; tripId: string }): JSX.Element;
  export function TripShareDialogHost(props: { open: boolean; onClose(): void; tripId: string }): JSX.Element | null;
  // DayHeader.tsx
  Props += { onShare(): void };   // `여행 설정` 옆 `일정 공유` 버튼(size small, minHeight 44)
  // lazy-routes.ts
  export const loadTripShareDialog; export const TripShareDialog; // PANEL_CHUNKS에 더함
  ```
- `useTripLegs`: `active`일 때 여행의 모든 Day `dayLegs` 중 같은 지점이 아닌 구간의 `routeKeyOf` 키를 모아, `routeStatesAtom`에 없는 것만 `forkEffect(lookupAll(store, …))`(계획 화면 `useDayPlan`과 같은 방식, 닫히면 취소). `routeOf(leg)`: `isSamePointLeg` → `same-point`·0·0·`null`·`[]`; 그 밖은 `planLeg(leg, states[routeKeyOf(leg)])`의 `status`를 `routed→routed`, `no-route→no-route`, `estimated`·`failed→estimated`로 바꾸고 시간·거리·통행료·조회 시각·경로선을 옮긴다. `total`은 같은 지점이 아닌 구간 수, `answered`는 상태가 있는 수(`offline` 포함), `estimated`는 답이 있는데 `routed`가 아닌 수, `oldestQueriedAt`은 `routed`의 가장 이른 조회 시각.
- `ShareFileDialog` 크기 검사: `make` 성공 뒤, `tooBigHint`가 있고 `shareHtmlBytes(html) > SHARE_FILE_MAX_BYTES`이면 `downloadText`·`navigator.share`를 부르지 않고 `setError(`파일이 너무 커요(약 ${(bytes / 1_048_576).toFixed(1)}MB). Landmark는 5MB까지 가져올 수 있어요. ${tooBigHint(opts)}`)`(창 안 `role="alert"`, 지금 오류 문구 자리). 재기는 `navigator.share` 앞에서 동기로 한다. 다음에 누르면 다시 잰다. `ExportHtmlDialog`는 스펙 §13 결정 9가 (a)면 `tooBigHint`(Global Constraints의 v1 문구)를 넘기고, (b)면 넘기지 않는다.
- `TripShareDialog`: `heading` `일정 공유`, 문구·체크·상태 줄·빈 일정은 Global Constraints. `tooBigHint`는 켜진 체크(`메모 포함`, `후보 <C>곳도 넣기`)에 따라 Global Constraints의 네 문장 중 하나. `후보도 넣기`는 `ShareFileDialog`의 `children`으로 넣는다(열릴 때 켬으로 초기화). `make`는 `renderTripShareHtml(template, library, tripId, legs.routeOf, { ...opts, includeCandidates })`. 상태 줄: `answered < total` → 받는 중, 아니면 `estimated > 0` → 어림값, 아니면 `total > 0 && oldestQueriedAt` → 조회 기준.
- 여행 목록: 메뉴 `이름 바꾸기` 다음 `일정 공유` → `TripShareDialogHost`를 연다. 계획 화면: `DayTimeline`이 `DayHeader`의 `onShare`로 `TripShareDialogHost`를 연다.

- [ ] **Step 1: 실패하는 시험**
  - 기존 `ExportHtmlDialog`·`ExportHtmlDialogHost` 시험이 고치지 않고 통과(먼저 돌려 확인만).
  - `useTripLegs`(가짜 `RouteLookup` 레이어): 열 때 상태 없는 구간만 묻고(이미 `routed`인 키는 묻지 않음), 같은 지점 구간은 묻지 않음; `active: false` → 묻지 않음; 상태 대응 네 갈래와 `same-point`; `answered`·`estimated`·`oldestQueriedAt` 값.
  - `TripShareDialog`: 대상 문구 두 줄(후보 끄면 ` · 후보` 없음); 후보 0곳이면 체크 없음; 상태 줄 세 문구(받는 중 `(1/3)`, `1구간은 …`, `이동 시간은 10월 16일 조회 기준이에요`); 일정 0곳·후보 끔 → `일정에 넣은 장소가 없어요`·`파일 저장` 꺼짐; `파일 저장` → `downloadText`가 `<제목>-YYYYMMDD.html`과 v2 데이터 블록이 든 HTML로 불림(가짜 `ShareTemplate`), 토스트 `파일을 만들었어요`.
  - 크기 한도(스펙 §3.2·§12): 메모 10,000자(한글)인 장소 300곳(일정 200·후보 100, 약 9MB)으로 한도를 넘김 → `파일 저장` → `downloadText` 0번, `파일이 너무 커요(약 …MB). Landmark는 5MB까지 가져올 수 있어요. '메모 포함'이나 '후보 100곳도 넣기'를 끄고 다시 해 주세요`(`role="alert"`). `공유`(공유 되는 가짜 `navigator`) → `navigator.share` 0번, 같은 문구. `후보 100곳도 넣기`만 끔(일정 200곳, 약 6MB) → 문구 끝이 `'메모 포함'을 끄고 다시 해 주세요`(아직 넘음). `메모 포함`을 끔 → 저장됨·토스트. `ShareFileDialog`에 가짜 `make`로 정확히 5,242,880바이트 → 저장됨, 5,242,881바이트 → 막힘, `tooBigHint` 없음 → 넘어도 저장됨(결정 9가 (b)일 때의 v1).
  - (결정 9가 (a)면) `ExportHtmlDialog`: 메모 큰 장소로 한도를 넘김 → 막힘·`'메모 포함'을 끄거나 장소 수를 줄여 다시 해 주세요`. 기존 시험은 그대로 PASS.
  - `DayHeader`: `일정 공유` 버튼 → `onShare`. 여행 목록: 메뉴에 `일정 공유` → 창 제목 `일정 공유`.
  - `PANEL_CHUNKS`에 `loadTripShareDialog` 포함.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/share-export tests/unit/sections/trips tests/unit/routes` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint` + `yarn build && yarn size --require-lazy TripShareDialog`(첫 로딩 gzip이 `perf-budget.json` 한도 이하, 값을 PR 설명에 적는다. 넘으면 스펙 §11대로 `read-share.ts`를 진입 훅에서 동적 import로 바꾸고 그 시험을 더한다)
- [ ] **Step 5:** 커밋 `feat(trips): 일정 공유 창`

---

### Task 9: 여행째 가져오기 연산

**Files:**
- Create: `src/domain/library/import-share-trip.ts`
- Modify: `src/domain/library/import-share.ts`(안쪽 함수 분리만)
- Test: `tests/unit/domain/library/import-share-trip.test.ts`, `tests/unit/domain/library/import-share.test.ts`(그대로 PASS)

**Interfaces:**
- Consumes: Task 2 타입, `normalizeLabelName`, `cutPrefix`(`legacy-import.ts`), `legKey`, `LIBRARY_LIMITS`, `OpCtx`/`OpResult`.
- Produces:
  ```ts
  // import-share.ts
  export type SharePlacesResult = { ok: true; lib: Library; titleId: string | undefined; summary: OpSummary;
    placeIds: ReadonlyMap<string, string> }; // 받은 장소 id → 결과(내) 장소 id
  export function importSharePlaces(lib: Library, doc: ShareDoc, input: ShareImportInput, ctx: OpCtx): SharePlacesResult | Failure;
  // importShare는 importSharePlaces를 불러 지금과 같은 OpResult를 돌려준다(동작 그대로)
  // import-share-trip.ts
  export const RECEIVED_TRIP_TITLE = '받은 여행';
  export function receivedTripTitle(title: string): string; // trim → 60자 cutPrefix → 비면 RECEIVED_TRIP_TITLE
  export function sameTripExists(lib: Library, trip: ShareTrip): boolean; // 살아 있는 여행 중 제목 정규형·시작일·종료일이 같은 것
  export function importSharedTrip(lib: Library, doc: ShareDocV2,
    input: { titleLabel: string | null; appendMemo: boolean }, ctx: OpCtx): OpResult; // createdId = 새 여행 id, summary = 장소 결과
  ```
- `importSharedTrip`: `importSharePlaces(lib, doc, { selected: 모든 장소 id, ...input }, ctx)` → 스펙 §8.2 표대로 새 `Trip`(모든 `FieldSchema`의 `updatedAt`과 `createdAt`은 `ctx.now`, `days[].stops[].id`는 `ctx.newId('stop')`, 여행 id는 `ctx.newId('trip')`). 장소 한 번만: Day 순서로 Stop을 넣으며 이미 넣은 내 장소면 그 Stop을 빼고, 후보는 Stop·앞 후보에 있으면 뺀다. `legModes`는 두 끝을 바꾸고 같아지면 뺀다. 결과 `{ ok: true, lib: { ...placesLib, trips: { ...placesLib.trips, [id]: trip } }, createdId: id, summary }`.

- [ ] **Step 1: 실패하는 시험** (`ctx`: 고정 `now`, 순번 `newId`)
  - 빈 보관함 + Task 4 fixture 문서 → 장소 6곳 새로(`summary.created === 6`), 여행 1개: 제목·기간 그대로, `origin`·`lodging`·Stop·후보가 새 장소 id, Stop id가 새 8자, `legModes` 키가 새 id, `startTime`·`stayMin`·`fixedTime`·`note` 그대로, `createdId`가 새 여행 id.
  - 받은 장소 일부(같은 `naverSid`)가 이미 있음 → 그 내 장소 id로 이어짐, `summary.merged`.
  - 같은 이름 핀 둘(30m)이 Day 1 Stop과 Day 2 Stop → 내 장소 하나, Day 2 Stop 빠짐, 후보에도 없음.
  - 받은 출발지가 Day 1 Stop과 같은 장소 → 둘 다 남음(출발지는 규칙 밖).
  - 제목 `'  '` → `받은 여행`, 61자 → 60자.
  - 같은 문서 두 번 → 여행 2개, 장소 수 그대로, 두 번째 `summary.created === 0`.
  - `sameTripExists`: 제목 `' 강릉  여행 '`·같은 기간 → 참, 기간 다름 → 거짓, 지운 여행 → 거짓.
  - 모든 결과가 `safeParse(LibrarySchema, …)` 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/library/import-share-trip.test.ts tests/unit/domain/library/import-share.test.ts` → FAIL(새 시험만)
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn vitest run tests/unit/domain/library` + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library): 받은 일정을 새 여행으로 가져오기`

---

### Task 10: 미리보기의 여행 칸

**Files:**
- Create: `src/sections/share-import/ShareTripBox.tsx`
- Modify: `src/sections/share-import/SharePreview.tsx`, `src/sections/share-import/SharePlaceRows.tsx`(행 체크박스 `disabled` prop)
- Test: `tests/unit/sections/share-import/share-preview-trip.test.tsx`, 기존 `share-preview` 시험 그대로

**Interfaces:**
- Consumes: Task 9 `importSharedTrip`·`sameTripExists`·`receivedTripTitle`, `periodLabel`, `objectParticle`, `resultMessage`, `paths.trip(id)`, `useNavigate`.
- Produces:
  ```ts
  export function ShareTripBox(props: { trip: ShareTrip; on: boolean; onChange(on: boolean): void; duplicate: boolean }): JSX.Element;
  // SharePlaceRows props += { disabled?: boolean }
  ```
- `SharePreview`: `doc.version === 2`일 때만 `ShareTripBox`(머리글 아래, 제목은 `h3`). 스위치가 켜져 있으면 `selected`는 모든 장소로 고정, 행·`모두 선택`/`모두 해제`는 비활성, 목록 위 안내. 버튼 이름은 Global Constraints. 켬으로 가져오기: `run((lib, ctx) => importSharedTrip(lib, doc, { titleLabel, appendMemo }, ctx))` → 토스트 `여행 ‘${제목}’${objectParticle(제목)} 가져왔어요` + 장소 결과 문장이 있으면 `. ${문장}` → `setFlow({ step: 'closed' })` → `navigate(paths.trip(createdId))`. 목록 필터는 건드리지 않는다. 두 번 누름 막기·닫힌 뒤 늦은 결과 처리는 지금 `submit`과 같다.

- [ ] **Step 1: 실패하는 시험** (보관함에 같은 `naverSid` 장소 1곳, 같은 이름·기간의 여행 1개)
  - 여행 칸: `강릉 2박 3일`, `10.24(금) ~ 10.26(일) · 2박 3일`, `일정 3곳 · 후보 1곳`, 스위치 `여행 계획도 가져오기` 켜짐, 설명 문구, 경고 `같은 이름·기간의 여행이 이미 있어요. 가져오면 하나 더 생겨요`.
  - 켬: 행 체크박스 모두 체크·비활성, `모두 해제` 꺼짐, `여행에 쓰이는 장소는 모두 가져와요`, 버튼 `여행 가져오기`.
  - 끔: 행을 고를 수 있고 버튼 `<N>곳 가져오기`, 누르면 여행이 생기지 않음(v1 동작).
  - 켬으로 가져오기 → 토스트 `여행 ‘강릉 2박 3일’을 가져왔어요. 3곳을 새로 넣고, 1곳은 라벨만 더했어요`, 주소 `/trips/<새 id>`, 흐름 `closed`. 제목이 `제주`면 `를`.
  - 빠르게 두 번 눌러도 여행 하나.
  - v1 문서는 여행 칸이 없고 기존 시험 그대로.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/share-import` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(share-import): 받은 일정 미리보기와 여행 가져오기`

---

### Task 11: E2E, 롤백 표, 배포 확인

**Files:**
- Create: `tests/e2e/trip-share.spec.ts`
- Modify: `tests/e2e/fixtures.ts`(필요하면 강릉 여행 만들기·`mockRoutes`를 함께 쓰게 옮김), `README.md`(기능 목록이 있으면 한 줄), (병합 뒤 별도 문서 PR) `docs/rollback.md`

**Interfaces:**
- Consumes: `trip-planning.spec.ts`의 `mockRoutes`·`createGangneungTrip` 방식, `share-export.spec.ts`의 다운로드·`file://` 열기·`TEMPLATE_LIMIT`, `share-import.spec.ts`의 `Landmark에 담기` 주소 바꾸기.

- [ ] **Step 1: E2E 작성** (desktop·iphone·galaxy, 첫 시험에 `@smoke`)
  - 강릉 여행 만들기 → Day 1에 3곳, 숙소 정하기 → `일정 공유` → `파일 저장` → 다운로드를 `file://`로 연다: `h1`, `tab` `Day 1`·`Day 2`, `Day 1 일정` 목록의 장소 행 3개와 구간 문구(`자동차`/`도보`), 합계 줄, 조회 줄; iframe 안 `marker-<id>` 라벨이 `1 `로 시작하는 것 1개, `[data-testid^="polyline-"]` 수 = 그날 구간 수; `Day 2` 탭 → 마커·선 수 바뀜; 행 누름 → 그 마커 `aria-pressed="true"`; 마커 누름 → 행 `aria-current`; 메인 프레임이 직접 부른 외부 스크립트 없음; 틀 크기 ≤ 51,200.
  - 그 파일의 `Landmark에 담기` `href`의 앞부분을 `baseURL`로 바꿔 이동 → 미리보기 여행 칸 → `여행 가져오기` → 주소 `/trips/…`, 계획 화면 제목, Day 1 장소 순서가 보낸 것과 같음.
  - 같은 파일을 `공유 파일 가져오기`로 → 경고 문구 → `여행 가져오기` → 여행 목록에 같은 제목 카드 둘.
- [ ] **Step 2:** `E2E_PORT=5175 yarn test:e2e tests/e2e/trip-share.spec.ts` PASS(세 프로젝트), 이어서 `E2E_PORT=5175 yarn test:e2e` 전체 PASS(기존 `share-export`·`share-import` 포함)
- [ ] **Step 3:** `yarn build:ci` PASS, `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음. 커밋 `test(trip-share): 일정 공유 E2E`
- [ ] **Step 4:** (**병합 뒤**, 다른 묶음과 같이 별도 문서 PR `docs: 롤백 표에 v0.14.0`) `docs/rollback.md` 표 끝에 한 줄 `| \`v0.14.0\` | \`<병합 커밋>\` | 여행 일정 공유: 일정 공유 파일(v2)·보기 화면 일정 모드·지도 페이지 규약 v2·여행째 가져오기 (#<PR>) | ✅ |`과, 표 아래에 "되돌린 앱은 일정 공유 파일(v2)을 가져오면 `공유 파일을 읽지 못했어요…`(보관함은 그대로), 지도 페이지를 되돌리면 v2 파일 지도는 장소 마커만" 한 문단.
- [ ] **Step 5: 배포 확인**(병합 뒤): (1) Actions의 `Deploy share map` 실행 성공, `gh-pages` 최신 커밋의 `assets/*.js`에서 `grep -o 'maxV:[0-9]'`가 `maxV:2`(압축 모양이 다르면 실제 일정 파일을 열어 지도에 번호 마커·경로선이 보이는 것으로 갈음), (2) 운영 앱에서 실제 여행으로 일정 파일을 만들어 PC·휴대폰에서 열기 — 네이버 지도에 Day 색 번호 마커·경로선·네이버 로고, (3) 그 파일의 `Landmark에 담기` → 운영 앱에 여행 생김, (4) 지난번에 만든 v1 장소 파일이 그대로 열림. 결과를 PR에 적고 `main`의 병합 커밋에 태그 `v0.14.0`.
