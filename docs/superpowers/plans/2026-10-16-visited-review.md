# 다녀온 곳·한 줄 평 (묶음 F2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소마다 다녀온 날과 한 줄 평을 남기고, 보관함에서 안 가 본 곳·가 본 곳으로 거르고, 목록·지도에서 다녀온 곳을 알아보게 한다.

**Architecture:** 저장 형식은 `PlaceSchema`의 선택 LWW 필드 두 개(C1)와 UI 선호의 선택 키 `query.visited`뿐이고 `schemaVersion` 2 그대로다. 바꾸는 길은 `src/domain/library/ops.ts`의 순수 연산(`useLibraryAction().run`이 최신본에 적용)이며, 조건(`LibraryQuery`)에 방문 필터를 더해 목록·지도·칩 숫자가 함께 따른다. `다녀온 날순`은 저장하지 않는 메모리 atom(`visitedSortAtom`)이다(조정자 판정 A — `sort` 리터럴에 값을 더하지 않는다). 화면은 기존 조각(`EditableText`·`ChipButton`·`BulkBar` 메뉴·`createMarkerLabelElement`)을 넓혀 쓰고 새 화면 단위·지연 로딩은 없다.

**Tech Stack:** TypeScript 6, React 19, MUI 7, Jotai, Effect 4.0.2(Schema), Vitest 5(jsdom), Playwright(desktop·iphone·galaxy).

**Spec:** `docs/superpowers/specs/2026-10-16-visited-review-design.md`

## Global Constraints

- 출발점: F1(`v0.8.0`)이 병합된 `main`.
- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`(git 훅에도 필요). 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 브랜치 `feat/visited-review`, PR은 **병합 커밋(Create a merge commit)** 으로 넣는다. 작업 하나 = 커밋 묶음 하나. Task 2~7은 Task 1에, Task 5·6·7은 Task 2에 기댄다(Task 3·4는 Task 2 없이 돈다). 되돌릴 때는 새것부터.
- 파일에 U+2028/U+2029 원문자 금지. 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 저장 형식: `schemaVersion` 2, 키 `tripmap:library:v2`·`tripmap:prefs`·`tripmap:routes:v1` 그대로. 새 필드는 **선택**이고 기존 문서는 그대로 통과해야 한다. 공유 형식(`tripmap-share` v1)은 손대지 않는다.
- **판정 A**: `tripmap:prefs`에 저장되는 리터럴 유니온(`sort`·`theme`·`mode`·`libraryView`·`query.mode`)에 새 값을 더하지 않는다(옛 버전의 `readPrefs`가 검증에 실패해 선호 전체가 기본값이 된다). 새 선택 키(`query.visited`, 디코드 기본값 있음)는 괜찮다.
- 한도: 한 줄 평 140자(`String.length`, `LIBRARY_LIMITS.reviewChars`). 날짜 `YYYY-MM-DD`(`CalendarDate`). 되돌리기 토스트 5초(`UNDO_MS`).
- 고정 문구(스펙 §4.8, 이것뿐): `다녀옴` · `다녀왔어요` · `다녀온 날` · `다녀옴 취소` · `오늘 이후 날짜는 고를 수 없어요` · `다녀옴 표시를 지웠어요` · `되돌리기`(기존) · `한 줄 평` · `한 줄 평 남기기 (140자까지)` · `방문` · `안 가 본 곳` · `가 본 곳` · `다녀온 날순` · `오늘 다녀옴으로 표시` · `다녀옴 표시 지우기` · `${n}곳을 오늘 다녀옴으로 표시했어요` · `${n}곳의 다녀옴 표시를 지웠어요` · `이미 다녀옴으로 표시돼 있어요` · ` (가 본 곳만)` · ` (안 가 본 곳만)` · 카드 배지 `다녀옴 ${YYYY.MM.DD}` · 마커 글자 `✓ ${이름}`·title `${이름} · 다녀옴`. 검색칸 안내는 바꾸지 않는다.
- 접근성(D3): 터치 대상 44px, 입력칸 `fieldSx()`, 포커스는 테마 전역 규칙, 체크 아이콘 색 `var(--tm-accent-text)`, 다녀옴은 색만으로 알리지 않는다(숨은 글자·배지·`✓`).
- 첫 로딩: 새 지연 단위 없음. `build:ci`의 `--require-lazy` 목록은 그대로. `yarn size`가 `perf-budget.json` 상한(327,680 B) 안.
- E2E는 `E2E_PORT=5175`. 5173(다른 프로젝트)·5174(지도 미리보기)는 쓰지 않고 끄지 않는다. `pkill` 금지.

## Review Focus

1. **옛 문서·옛 선호** — 두 필드가 없는 보관함, `visited` 키가 없는 `tripmap:prefs` → 그대로 열리고 다시 저장해도 키가 생기지 않으며, 선호(테마·보기)가 기본값으로 바뀌지 않는다. `다녀온 날순`을 켜도 `tripmap:prefs`의 `sort`는 이전 값(옛 버전이 읽어도 선호가 깨지지 않음). Task 1·Task 2·Task 5 시험.
2. **자정 근처·시간대** — 한국 시각 00:30(UTC 전날 15:30)에 `다녀왔어요` → 그날(한국) 날짜. Task 1의 `localDateOf` 시험(기기 시각으로 만든 입력), Task 7 E2E(Asia/Seoul).
3. **날짜 칸 비우기·미래 날짜** — 휴대폰 날짜 창의 지우기, 데스크톱에서 `2099-01-01` 직접 입력 → 저장하지 않고 원래 날짜(미래는 안내 문구). Task 3 시험.
4. **`가 본 곳` 필터를 켠 채 가져오기·표시 지우기** — 새로 가져온 장소가 안 보이는 일, 표시를 지운 곳의 선택이 남는 일 → 가져오면 필터가 풀리고, 지운 곳은 목록·선택에서 빠진다. Task 2·Task 6 시험.
5. **이모지·붙여넣은 긴 평** — 이모지 70개(140 단위), 줄바꿈 섞인 붙여넣기 → 140 단위에서 멈추고 한 줄로 저장되며 `LibrarySchema` 통과. Task 1(연산)·Task 3(입력칸) 시험.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/schema/library-base.ts`, `src/schema/library.ts` | C1 필드와 한도 |
| `src/domain/library/lww.ts`, `src/domain/library/visit.ts`(새), `src/domain/library/ops.ts` | 선택 필드 LWW, 도우미, 편집 연산(F5가 쓰는 곳) |
| `src/domain/library/query.ts`, `src/schema/prefs.ts`, `src/sections/share-export/export-targets.ts`, `src/sections/add-place/FolderList.tsx`, `src/sections/share-import/SharePreview.tsx` | 방문 조건·정렬·숫자·검색 |
| `src/sections/place/VisitEditor.tsx`(새), `PlaceDetail.tsx`, `EditableText.tsx` | 상세 입력 |
| `src/sections/library/PlaceRow.tsx`, `PlaceCard.tsx`, `src/components/map/{MapAdapter,marker-label,FakeMapAdapter}.ts`, `src/sections/map/markers.ts` | 목록·지도 표시 |
| `src/sections/library/{VisitChips(새),LabelChips,FilterBar,SortMenu,LibraryPage}.tsx`, `src/sections/map/LibraryMap.tsx`, `src/stores/visit-sort.ts`(새) | 칩·정렬 UI, 저장하지 않는 `다녀온 날순` |
| `src/sections/library/BulkBar.tsx`, `LibraryPage.tsx` | 일괄 다녀옴 |
| `tests/e2e/visited-review.spec.ts`(새), `playwright.config.ts` | E2E |
| `docs/rollback.md` | 병합 뒤 표 한 줄 |

---

### Task 1: 저장 형식과 편집 연산 (스펙 §3, §5)

**Files:**
- Modify: `src/schema/library-base.ts`(`LIBRARY_LIMITS.reviewChars: 140`), `src/schema/library.ts`(`PlaceSchema`), `src/domain/library/lww.ts`, `src/domain/library/ops.ts`
- Create: `src/domain/library/visit.ts`
- Modify(시험 도우미): `tests/unit/sections/library/fixtures.tsx` — `makePlace` 옵션에 `visitedOn?: string | null`, `review?: string`(주면 `{ value, updatedAt: T0 }`로 넣고, 안 주면 키 없음)
- Test: `tests/unit/schema/visit-fields.test.ts`(새), `tests/unit/domain/library/visit.test.ts`(새), `tests/unit/services/library-store.test.ts`(한 건 추가)
- Modify(F1 시험): `tests/unit/domain/backup/read-backup.test.ts`에 한 건 더한다(아래). F1 계획은 "모르는 필드" 예로 처음부터 `futureField`를 쓴다(교차 검토에서 고침). 병합본에서 `grep -rn visitedOn tests/unit/domain/backup tests/unit/sections/backup tests/unit/services/library-store.test.ts`로 F1 시험이 `visitedOn`을 모르는 필드로 쓰는 곳이 없는지 확인하고, 있으면 `futureField: { value: 1, updatedAt }`로 바꾼다

**Interfaces:**
- Produces (스펙 §6.2 그대로):
  ```ts
  // src/schema/library.ts — PlaceSchema에
  visitedOn: Schema.optional(FieldSchema(Schema.NullOr(CalendarDate))),
  review: Schema.optional(FieldSchema(Schema.String.check(Schema.isMaxLength(LIBRARY_LIMITS.reviewChars)))),
  // src/domain/library/lww.ts
  export function setOptionalField<T>(f: Field<T> | undefined, value: T, empty: T, now: string): Field<T> | undefined;
  // src/domain/library/visit.ts
  export function visitedOnOf(place: Place): string | null;
  export function isVisited(place: Place): boolean;
  export function reviewOf(place: Place): string;           // 없으면 ''
  export function localDateOf(iso: string): string;         // new Date(iso)의 기기 시간대 YYYY-MM-DD
  export function normalizeReview(text: string): string;    // trim + /\s+/g → ' '
  export function formatVisitDate(date: string): string;    // '2026-10-16' → '2026.10.16'
  // src/domain/library/ops.ts
  // OpError에 | { _tag: 'VisitDateInvalid'; date: string } | { _tag: 'ReviewTooLong'; length: number }
  export function setVisitedOn(lib: Library, dates: Readonly<Record<string, string | null>>, ctx: OpCtx): OpResult;
  export function markVisited(lib: Library, placeIds: readonly string[], date: string, ctx: OpCtx): OpResult;
  export function markVisitedToday(lib: Library, placeIds: readonly string[], ctx: OpCtx): Library;
  export function setPlaceReview(lib: Library, placeId: string, review: string, ctx: OpCtx): OpResult;
  ```
- 규칙: 없는 id·`deletedAt !== null`은 건너뜀(`setPlaceReview`는 `NotFound`), `saved: false`는 바꿈. 날짜 검사는 `is(CalendarDate, date)`(`src/schema/parse.ts`). `markVisited`는 `visitedOnOf(p) !== null && visitedOnOf(p) >= date`면 그대로. 바뀐 장소가 없으면 같은 `lib` 참조(`ok: true`).

- [ ] **Step 1: 실패하는 시험**
  - `visit-fields.test.ts`: 두 필드 없는 장소 → 통과하고 `JSON.stringify(parsed.data) === JSON.stringify(input)`(키가 생기지 않음); `visitedOn: { value: '2026-10-16' }`·`{ value: null }`·`review: { value: '좋음' }` 통과; `visitedOn.value` `'2026-02-30'`·`'2026-1-5'`·`'2026-10-16T00:00:00.000Z'` 거절; `review.value` `'가'.repeat(141)`·`'😀'.repeat(71)`(142 단위)·`5` 거절, `'😀'.repeat(70)` 통과; 장소에 `futureField: 1`이 있으면 **통과하고 결과에 `futureField` 키가 없음**(옛 버전이 손상으로 보지 않고 다시 저장할 때 지운다는 근거 — 주석으로 스펙 §5.1을 가리킨다).
  - `visit.test.ts`: `localDateOf(new Date(2026, 9, 16, 0, 30).toISOString()) === '2026-10-16'`, `localDateOf(new Date(2026, 9, 16, 23, 59).toISOString()) === '2026-10-16'`; `normalizeReview('  일출\n\n최고  ') === '일출 최고'`; `formatVisitDate('2026-10-06') === '2026.10.06'`; `setOptionalField(undefined, null, null, NOW) === undefined`, `setOptionalField(undefined, '2026-10-16', null, NOW)` → `{ value: '2026-10-16', updatedAt: NOW }`, 같은 값이면 같은 참조.
  - 연산: `markVisitedToday`(ctx.now = `new Date(2026, 9, 16, 0, 30).toISOString()`) → `visitedOn.value === '2026-10-16'`, `updatedAt === ctx.now`, 다른 필드 같은 참조; `markVisited(…, '2026-10-10')`인데 이미 `'2026-10-12'` → 그대로(같은 `lib`); `'2026-10-01'` → `'2026-10-10'`; `saved: false` 장소도 바뀜; 지운 장소·없는 id 건너뜀; 틀린 날짜 → `{ ok: false, error: { _tag: 'VisitDateInvalid', date } }`; `setVisitedOn({ a: null, b: '2026-10-01' })` 각각; 키 없는 장소에 `null` → 그대로; `setPlaceReview` 공백 정리·`''` 저장(있던 평 지움)·키 없는 장소에 `''` → 그대로·141자 → `ReviewTooLong`(length 141)·지운 장소 → `NotFound`. 모든 결과가 `safeParse(LibrarySchema, …)` 통과.
  - `library-store.test.ts`: 두 필드가 있는 문서를 심고 `update`로 메모를 고치면 저장된 JSON에 두 필드가 그대로.
  - F1 시험: F1의 `futureField` 시험이 그대로 통과(`droppedUnknown: true`, 결과에 `futureField` 없음). `read-backup.test.ts`에 한 건 더: 장소에 `visitedOn`·`review`가 있는 백업 → `droppedUnknown: false`이고 결과 장소에 두 필드가 그대로.
- [ ] **Step 2:** `yarn vitest run tests/unit/schema/visit-fields.test.ts tests/unit/domain/library/visit.test.ts tests/unit/services/library-store.test.ts tests/unit/domain/backup` → FAIL(모듈·필드 없음)
- [ ] **Step 3:** 구현. 연산은 기존 `updatePlaces` 모양을 따르되, 지운 장소 건너뛰기는 갱신 함수 안에서 `p.deletedAt !== null ? p : …`로.
- [ ] **Step 4:** PASS + `yarn vitest run tests/unit/domain tests/unit/schema tests/unit/services tests/unit/sections/backup` + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library): 다녀옴·한 줄 평 필드와 편집 연산`

---

### Task 2: 보관함 조건 — 방문 필터·다녀온 날 정렬 함수·숫자·검색 (스펙 §4.4·§4.5·§5.4)

**Files:**
- Modify: `src/domain/library/query.ts`, `src/schema/prefs.ts`, `src/sections/share-export/export-targets.ts`, `src/sections/add-place/FolderList.tsx`(143줄 `patchQuery`), `src/sections/share-import/SharePreview.tsx`(116줄 `patchQuery`)
- Test: `tests/unit/domain/library/query.test.ts`, `tests/unit/services/prefs-store.test.ts`, `tests/unit/sections/share-export/export-targets.test.ts`, `tests/unit/sections/add-place/folder-preview.test.tsx`, `tests/unit/sections/share-import/share-preview.test.tsx`

**Interfaces:**
- Consumes: Task 1 `isVisited`, `visitedOnOf`, `reviewOf`.
- Produces:
  ```ts
  export type VisitFilter = 'all' | 'unvisited' | 'visited';
  // LibraryQuery: visited: VisitFilter; sort는 'recent' | 'name' | 'label' 그대로(판정 A)
  // DEFAULT_QUERY.visited = 'all'
  export function visitCounts(lib: Library, q: LibraryQuery): { visited: number; unvisited: number };
  export function hasVisited(lib: Library): boolean; // livePlaces 중 하나라도 isVisited
  export function sortByVisited(places: readonly Place[]): Place[]; // 새 배열
  // prefs.ts LibraryQuerySchema: (sort 줄은 바꾸지 않는다)
  visited: Schema.Literals(['all', 'unvisited', 'visited']).pipe(Schema.withDecodingDefault(Effect.succeed('all' as const))),
  ```
- `queryPlaces`·`labelCounts`·`regionCounts`는 방문 조건을 적용한다. `visitCounts`는 검색·지역·라벨 조건을 적용하고 방문 조건은 뺀다. `matchesText`의 대상에 `reviewOf(place)`. `sortByVisited`: `visitedOnOf` 내림차순(없는 곳은 뒤) → `compareRecent`. `queryPlaces`는 이것을 부르지 않는다(화면이 `visitedSortAtom`이 켜졌을 때만 결과에 적용 — Task 5).
- `exportTargets` 대상 문구: 고른 것이 없을 때 라벨 꼬리 뒤·검색 꼬리 앞에 `visited`면 ` (가 본 곳만)`, `unvisited`면 ` (안 가 본 곳만)`.
- 두 `patchQuery` 호출에 `visited: 'all'`을 더한다.

- [ ] **Step 1: 실패하는 시험**
  - 조건: 5곳 중 2곳 다녀옴(하나는 `visitedOn: { value: null }`인 장소 포함 — 안 가 본 곳으로 센다) → `visited: 'visited'` 2곳, `'unvisited'` 3곳; 라벨 필터와 함께 → 교집합; `visitCounts`가 라벨 필터를 따르고 방문 필터는 무시; `labelCounts`·`regionCounts`가 방문 필터를 따름; `sortByVisited` → `10-12`, `10-10`, 안 가 본 곳(최근 저장순), 입력 배열은 그대로; 검색어 `일출`이 평 `일출 최고`인 장소를 찾음; `hasVisited` 빈 보관함 false, `saved: false`인 다녀온 장소만 있으면 false.
  - 선호: `visited` 키가 없는 옛 `query`를 심은 저장소 → `get`이 `query.visited === 'all'`이고 `theme`·`libraryView`가 심은 값 그대로; `visited: 'maybe'` → 기본값(기존 동작); `sort: 'visited'` → 기본값(리터럴을 넓히지 않았음을 고정 — 판정 A); 옛 모양 `LibraryQuerySchema`(테스트 안에서 `visited` 없는 `Struct`로 만듦)로 새 선호(`query.visited: 'visited'`)를 읽으면 통과하고 `visited` 키가 없다(옛 버전이 선호 전체를 버리지 않는다는 근거).
  - `exportTargets`: `{ ...DEFAULT_QUERY, visited: 'visited', labelIds: [카페] }` → `지금 보이는 N곳을 내보냅니다 (라벨: 카페) (가 본 곳만)`; `'all'` → 기존 문구 그대로.
  - 가져오기 뒤: 선호 `query.visited: 'visited'`로 시작해 폴더 가져오기·공유 가져오기를 마치면 화면의 조건이 `visited: 'all'`(목록에 새 장소가 보임).
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/library/query.test.ts tests/unit/services/prefs-store.test.ts tests/unit/sections/share-export/export-targets.test.ts` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library): 방문 필터·다녀온 날순·평 검색`

---

### Task 3: 장소 상세의 다녀옴·한 줄 평 (스펙 §4.1)

**Files:**
- Create: `src/sections/place/VisitEditor.tsx`
- Modify: `src/sections/place/PlaceDetail.tsx`(네이버 링크 아래·`라벨` 위에 `Section` 두 개), `src/sections/place/EditableText.tsx`(선택 prop `maxLength?: number` → 입력칸 `maxLength`)
- Test: `tests/unit/sections/place/visit-editor.test.tsx`(새), `tests/unit/sections/place/place-detail.test.tsx`(평 저장 한 건)

**Interfaces:**
- Consumes: Task 1 `markVisitedToday`, `setVisitedOn`, `setPlaceReview`, `visitedOnOf`, `reviewOf`, `localDateOf`.
- Produces:
  ```ts
  export function VisitEditor(props: {
    visitedOn: string | null;
    /** 이 기기의 오늘(YYYY-MM-DD). 날짜 칸의 max. */
    today: string;
    onMarkToday(): void;
    onSetDate(date: string): void;
    onClear(): void;
  }): JSX.Element;
  ```
- `PlaceBody`가 `today = localDateOf(new Date().toISOString())`로 넘기고 연산을 `run`으로 잇는다. `onClear`는 지우기 전 값을 연산 안에서 읽어(`lib.places[id]`의 `visitedOnOf`) 성공하면 토스트 `다녀옴 표시를 지웠어요`(`duration: UNDO_MS`, 액션 `되돌리기` → `setVisitedOn({ [id]: prev })`).
- 화면: 안 가 봄 → 버튼 `다녀왔어요`(앞에 `CheckIcon`, `PlaceDetail`의 `BUTTON_SX`). 다녀옴 → `CheckIcon`(`--tm-accent-text`, `aria-hidden`) + `<input type="date" aria-label="다녀온 날" max={today} value={visitedOn}>`(`sx={[fieldSx(), { flex: '1 1 160px' }]}`) + 버튼 `다녀옴 취소`, 상자는 `flexWrap: 'wrap'`. 날짜 칸 `onChange`: 값이 `''`이면 무시하고 저장된 값으로, `> today`면 저장하지 않고 `role="alert"` `오늘 이후 날짜는 고를 수 없어요`(칸 `aria-describedby`·`aria-invalid`), 아니면 `onSetDate`.
- 평: `<EditableText label="한 줄 평" value={reviewOf(place)} emptyText="한 줄 평 남기기 (140자까지)" allowEmpty maxLength={LIBRARY_LIMITS.reviewChars} onSave={…setPlaceReview} />`. 칸 제목은 `Section title="다녀옴"`·`"한 줄 평"`.

- [ ] **Step 1: 실패하는 시험**
  - 시계: `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(…)`(앱 런타임의 기본 `Clock`이 `Date.now()`를 읽는다 — `node_modules/effect/src/internal/effect.ts`). `afterEach`에서 `vi.useRealTimers()`.
  - 안 가 본 장소 상세: `다녀옴`·`한 줄 평` 제목(`h2`, 계획 화면 안에서는 `h3`), 버튼 `다녀왔어요` → 저장소의 `visitedOn.value`가 (`vi.setSystemTime(new Date(2026, 9, 16, 0, 30))` 기준) `'2026-10-16'`, 화면에 `다녀온 날` 칸 값 `2026-10-16`·`max` `2026-10-16`.
  - 날짜 바꾸기 `2026-10-10` → 저장; `''` → 저장 안 함·칸 값 원래대로; `2099-01-01` → 저장 안 함·`오늘 이후 날짜는 고를 수 없어요`(`role="alert"`).
  - `다녀옴 취소` → `visitedOn.value === null`, 토스트 `다녀옴 표시를 지웠어요` 액션 `되돌리기` → 실행하면 `'2026-10-10'`으로.
  - 평: `한 줄 평 수정` → 입력칸 `maxLength === 140` → `  일출 최고  ` Enter → 저장 `'일출 최고'`; 비우고 Enter → `''`; 다녀옴 취소 뒤에도 평 그대로.
  - 새 버튼·입력칸 높이 44px 이상(`minHeight`), 접근성 이름이 위 문구.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/place` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(place): 장소 상세에 다녀옴·한 줄 평`

---

### Task 4: 목록 행·카드·지도 핀의 다녀옴 표시 (스펙 §4.2·§4.3)

**Files:**
- Modify: `src/sections/library/PlaceRow.tsx`, `src/sections/library/PlaceCard.tsx`, `src/components/map/MapAdapter.ts`(`MapMarker.visited?: boolean`), `src/components/map/marker-label.ts`(`MarkerLabelOptions.visited?: boolean`), `src/components/map/FakeMapAdapter.ts`(다시 그리기 비교 키에 `marker.visited`), `src/sections/map/markers.ts`
- Test: `tests/unit/sections/library/place-row.test.tsx`, `tests/unit/sections/library/views.test.tsx`(카드), `tests/unit/sections/map/markers.test.ts`, `tests/unit/components/map-view.test.tsx`(마커 글자)

**Interfaces:**
- Consumes: Task 1 `isVisited`, `visitedOnOf`, `reviewOf`, `formatVisitDate`.
- Produces: `placeMarker(place: { id; lng; lat; name; visited?: boolean }, palette, tokens, selected): MapMarker` — `visited`가 참이면 `marker.visited = true`. `toMarkers`는 `visited: isVisited(place)`를 넘긴다. `createMarkerLabelElement(label, color, { visited })` → `textContent = '✓ ' + label`, `title = label + ' · 다녀옴'`(빈 라벨이면 기존대로). 공유 지도 페이지(`src/share-map/map.ts`)는 바꾸지 않는다.
- 행: 이름 `span` 바로 뒤에 `CheckIcon`(16px, `flex: none`, `color: var(--tm-accent-text)`, `aria-hidden`) + `<Box component="span" sx={visuallyHidden}>다녀옴</Box>`(`@mui/utils`). 카드: 아래 줄 맨 앞 `data-part="visited"` 배지 `다녀옴 2026.10.16`(앞에 `CheckIcon` 12px), 메모 뒤 `data-part="review"` `“${review}”`(`clamp(2)`, 14px, `text.secondary`, 평이 빈 문자열이면 없음).

- [ ] **Step 1: 실패하는 시험**
  - 행: 다녀온 장소 버튼의 접근성 이름에 `다녀옴`이 들어가고 안 가 본 장소에는 없음(`visitedOn: { value: null }` 포함).
  - 카드: 배지 `다녀옴 2026.10.12`, 평 `“일출 최고”`; 평 `''`이면 `data-part="review"` 없음.
  - 마커: `toMarkers` 결과의 `visited`가 다녀온 곳만 `true`; 가짜 지도 마커 버튼 글자 `✓ 경포대`, `title` `경포대 · 다녀옴`; 같은 마커가 다녀옴으로 바뀌면 다시 그려짐(비교 키).
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/library/place-row.test.tsx tests/unit/sections/library/views.test.tsx tests/unit/sections/map/markers.test.ts tests/unit/components/map-view.test.tsx` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn build:map`(공유 지도 페이지가 빌드되는지)
- [ ] **Step 5:** 커밋 `feat(library): 목록·카드·지도 핀에 다녀옴 표시`

---

### Task 5: 방문 칩·정렬 메뉴 (스펙 §4.4·§4.5)

**Files:**
- Create: `src/sections/library/VisitChips.tsx`, `src/stores/visit-sort.ts`
- Modify: `src/sections/library/LabelChips.tsx`, `src/sections/library/FilterBar.tsx`, `src/sections/library/SortMenu.tsx`, `src/sections/library/LibraryPage.tsx`, `src/sections/map/LibraryMap.tsx`
- Test: `tests/unit/sections/library/filters.test.tsx`, `tests/unit/sections/library/chip-counts.test.tsx`, `tests/unit/sections/map/library-map.test.tsx`

**Interfaces:**
- Consumes: Task 2 `VisitFilter`, `visitCounts`, `hasVisited`, `LibraryQuery.visited`, `sortByVisited`.
- Produces:
  ```ts
  export function VisitChips(props: {
    value: VisitFilter;
    counts: { visited: number; unvisited: number };
    onChange(value: VisitFilter): void;
  }): JSX.Element; // role="group" aria-label="방문", ChipButton 두 개: `안 가 본 곳 N`, `가 본 곳 N`
  // LabelChips에 선택 prop: leading?: ReactNode
  ```
- `LabelChips` 구조: 바깥 상자(가로 스크롤, 지금 `sx` 그대로, role 없음) 안에 `leading`이 있으면 `leading` + 구분선(`aria-hidden`, `width: 1, height: 24, alignSelf: 'center', bgcolor: var(--tm-border)`) + `role="group" aria-label="라벨"` 상자(`display: flex, gap: 0.5, flex: none`, 지금의 칩·`라벨 관리` 링크). `leading`이 없으면 지금과 같은 DOM이어도 되고 같은 구조여도 된다 — 기존 시험의 `getByRole('group', { name: '라벨' })` 안에 라벨 칩이 있으면 된다.
- 칩 누르기: 꺼진 칩 → 그 값, 켜진 칩 → `'all'`. `FilterBar`·`LibraryMap`(좁은 화면 칩 줄)이 `leading`을 넘기는 조건: `hasVisited(library) || query.visited !== 'all'`. 숫자는 `visitCounts(library, query)`.
- `src/stores/visit-sort.ts`: `export const visitedSortAtom = atom(false)`(저장하지 않는다 — `atomWithStorage`·`prefsAtom`을 쓰지 않는다).
- `SortMenu` props: `{ value: LibraryQuery['sort']; visitedSort: boolean; onChange(sort: LibraryQuery['sort']): void; onVisitedSort(): void }`. `SORTS`(저장되는 셋) 뒤에 항목 `다녀온 날순`(`menuitemradio`, `aria-checked={visitedSort}`)을 두고 누르면 `onVisitedSort`. `visitedSort`면 단추 글자 `다녀온 날순`이고 저장되는 셋의 `aria-checked`는 모두 거짓. `FilterBar`는 이 두 prop을 그대로 넘긴다.
- `LibraryPage`·`LibraryMap`: `places = visitedSort ? sortByVisited(queryPlaces(...)) : queryPlaces(...)`. `onVisitedSort` → `visitedSortAtom = true`(`query.sort`는 그대로). 저장되는 정렬을 고르면 `patch({ sort })` + `visitedSortAtom = false`.

- [ ] **Step 1: 실패하는 시험**
  - 다녀온 곳이 없는 보관함 → `방문` 묶음 없음(지금 화면 그대로). 한 곳 다녀옴 → `안 가 본 곳 4`·`가 본 곳 1`.
  - `가 본 곳` → `aria-pressed="true"`, 목록 1줄, `라벨` 칩 숫자가 그 1곳 기준; 다시 누르면 5줄; `안 가 본 곳` → 4줄이고 `가 본 곳`은 꺼짐.
  - 라벨 `맛집`을 켜면 `방문` 칩 숫자가 맛집 안에서 셈.
  - 다녀온 곳이 0이 되어도 `가 본 곳`이 켜져 있으면 칩이 남고 빈 목록 안내 `필터 지우기` → 칩 꺼짐.
  - 정렬 메뉴에 `다녀온 날순`(`menuitemradio`) → 목록 순서가 다녀온 날 내림차순, 단추 글자 `다녀온 날순`. `vi.advanceTimersByTime(QUERY_PERSIST_DELAY_MS + 100)` 뒤 `JSON.parse(storage.getItem('tripmap:prefs')).query.sort`가 이전 값(`recent`). `이름순` → 이름순이고 `다녀온 날순` 꺼짐. 새 store로 다시 그리면 단추 글자 `최근 저장순`.
  - 좁은 지도(`/map`, 폭 390): `방문` 묶음이 같은 칩 줄에 있고 `가 본 곳` → 마커 1개.
  - 기존 `filters`·`chip-counts`·`library-map` 시험 그대로 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/library tests/unit/sections/map` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(library): 방문 칩과 다녀온 날순 정렬 메뉴`

---

### Task 6: 일괄 편집의 다녀옴 (스펙 §4.6)

**Files:**
- Modify: `src/sections/library/BulkBar.tsx`, `src/sections/library/LibraryPage.tsx`
- Test: `tests/unit/sections/library/bulk.test.tsx`

**Interfaces:**
- Consumes: Task 1 `markVisitedToday`, `setVisitedOn`, `visitedOnOf`, `isVisited`.
- Produces: `BulkBar` 새 props `visitedCount: number`(고른 곳 중 다녀온 곳 수), `onMarkVisited(): void`, `onClearVisited(): void`. `여행에 넣기` 앞에 `BarButton aria-haspopup="menu"`(`CheckIcon` + `다녀옴`), 메뉴 항목 `오늘 다녀옴으로 표시`·`다녀옴 표시 지우기`(`visitedCount === 0`이면 `disabled`), 항목 높이 44px. 메뉴 상태는 지금의 `menu.kind`에 `'visit'`를 더한다.
- `LibraryPage`: 연산 안에서 최신본의 고른 장소마다 `prev = visitedOnOf(p)`를 모으고 바뀐 곳만 센다(`deleted` 패턴). 표시: 바뀐 곳 = `prev === null || prev < 오늘`. 지우기: 바뀐 곳 = `prev !== null`. N > 0 → 토스트 `${n}곳을 오늘 다녀옴으로 표시했어요` / `${n}곳의 다녀옴 표시를 지웠어요`(`duration: UNDO_MS`, `되돌리기` → `setVisitedOn(prevById)`), N = 0(표시) → `이미 다녀옴으로 표시돼 있어요`(액션 없음). 선택은 그대로 둔다.

- [ ] **Step 1: 실패하는 시험**
  - 3곳 고름(하나는 `10-10` 다녀옴, `vi.setSystemTime(new Date(2026, 9, 16, 9))`) → `다녀옴` → `오늘 다녀옴으로 표시` → 3곳 모두 `2026-10-16`, 토스트 `3곳을 오늘 다녀옴으로 표시했어요` → `되돌리기` → 하나는 `2026-10-10`, 둘은 `null`.
  - 다시 `오늘 다녀옴으로 표시` → `이미 다녀옴으로 표시돼 있어요`.
  - 안 가 본 곳만 고르면 `다녀옴 표시 지우기`가 비활성.
  - 선호 `query.visited: 'visited'`로 시작해(칩 UI에 기대지 않게 `renderLibrary`의 `prefs`로 심는다) 2곳 고르고 `다녀옴 표시 지우기` → 목록에서 빠지고 하단 바 사라짐(선택 0), 토스트 `2곳의 다녀옴 표시를 지웠어요`.
  - 기존 일괄 시험 그대로 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/library/bulk.test.tsx` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(library): 일괄 편집에 다녀옴 표시·지우기`

---

### Task 7: E2E와 예산 확인 (스펙 §8.2·§9)

**Files:**
- Create: `tests/e2e/visited-review.spec.ts`
- Modify: `playwright.config.ts`(desktop·iphone·galaxy의 `testMatch`에 `'visited-review.spec.ts'`)
- Test: 위 spec

**Interfaces:**
- Consumes: `seedStorage`, `seedJson`, `placeIdByName`, `LIBRARY_KEY`(`tests/e2e/fixtures.ts`). 오늘(서울): `new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())`.

- [ ] **Step 1: 시험 작성**
  - `@desktop @smoke`: 목록 보기로 시드 → `경포대` 상세 → `다녀왔어요` → `다녀온 날` 칸이 오늘 → `fill('2026-10-10')` → `한 줄 평 수정` → `일출 최고` Enter → `getByRole('group', { name: '방문' })`의 `가 본 곳 1` → 목록 1줄 → 마커 `marker-<경포대 id>`에 `✓ 경포대` → 정렬 `다녀온 날순` → 새로고침 뒤 칸 값 `2026-10-10`·평·`가 본 곳` 그대로, 정렬 단추는 `최근 저장순`(저장하지 않는 정렬).
  - `@mobile`(iphone·galaxy): 카드 보기로 시드 → `경포대` 시트 → `다녀왔어요`·평 → 뒤로 → 카드에 `다녀옴`·`“일출 최고”`.
  - 호환(태그 없음, 세 프로젝트): 시드 JSON의 한 장소에 `visitedOn: { value: '2026-09-01', updatedAt }`·`review`를 넣어 `addInitScript`로 심고 열면 손상 화면(`백업 파일 받기`)이 없고 `가 본 곳 1`.
- [ ] **Step 2:** `E2E_PORT=5175 yarn test:e2e tests/e2e/visited-review.spec.ts` → PASS(세 프로젝트). 실패하면 화면 코드를 고친다(그 커밋은 해당 Task 이름을 붙인다).
- [ ] **Step 3:** `yarn build && yarn size` → 상한 안. 늘어난 양을 PR 설명에 적는다.
- [ ] **Step 4:** `yarn build:ci` 통과
- [ ] **Step 5:** 커밋 `test(e2e): 다녀옴·한 줄 평 흐름`

---

### Task 8: 병합 뒤 — 태그와 롤백 표 (스펙 §5.3)

**Files:**
- Modify: `docs/rollback.md`

- [ ] **Step 1:** PR(`feat/visited-review`)을 병합 커밋으로 넣은 뒤 그 커밋에 `v0.9.0` 태그.
- [ ] **Step 2:** `docs/rollback.md` 버전 표 끝에 스펙 §5.3의 줄을 병합 커밋 해시·PR 번호로 채워 더하고, 표 아래 목록에 스펙 §5.3의 설명 한 줄을 더하며, "`v0.3.0` 이후로는 저장 형식이 바뀌지 않아…" 문장을 스펙 §5.3대로 고친다. 작업별 되돌리기 표(커밋 해시, Global Constraints의 기대는 관계 — 새것부터 되돌린다)를 `## F2 작업별로 되돌리기` 절로 더한다.
- [ ] **Step 3:** 커밋 `docs: 롤백 표에 v0.9.0` → PR.
