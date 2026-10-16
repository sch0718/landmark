# 랜드마크 F 묶음(F1~F7) 모음 — 교차 검토

- 작성일: 2026-10-16
- 상태: 교차 검토 끝 (사용자 결정 대기)
- 대상: 아래 7개 묶음의 설계서 7개·구현 계획 7개. 묶음마다 다른 에이전트가 따로 썼고, 이 문서는 그것들을 서로 맞춰 본 결과다.
- 이 문서만 보고 "그대로 / 바꿈"을 정할 수 있게 §5에 결정할 것을 모았다. 자세한 이유는 각 설계서의 "결정이 필요한 것"에 있다.

## 1. 7개 묶음

순서가 곧 병합·태그 순서다. 각 계획은 **앞 묶음이 모두 병합된 `main`** 에서 시작한다고 가정한다.

| 순서 | 기능 | 태그 · 브랜치 | 설계서 | 계획 | Task 수 | 저장 형식 변화 · 롤백 |
|---|---|---|---|---|---|---|
| F1 | 전체 백업·복원 | `v0.8.0` · `feat/backup-restore` | [설계서](2026-10-16-backup-restore-design.md) | [계획](../plans/2026-10-16-backup-restore.md) | 8 | 새 키 `tripmap:backup:v1`·`tripmap:library:v2:before-restore`. ✅ 옛 버전은 두 키를 읽지 않음 |
| F2 | 다녀온 곳·한 줄 평 | `v0.9.0` · `feat/visited-review` | [설계서](2026-10-16-visited-review-design.md) | [계획](../plans/2026-10-16-visited-review.md) | 8 (Task 8은 병합 뒤) | 장소 선택 필드 `visitedOn`·`review`, 선호 선택 키 `query.visited`. ⚠️ 옛 버전에서 보관함을 고치면 두 필드가 지워짐(손상 화면은 없음) |
| F3 | 네이버 폴더 다시 가져오기 | `v0.10.0` · `feat/folder-resync` | [설계서](2026-10-16-folder-resync-design.md) | [계획](../plans/2026-10-16-folder-resync.md) | 8 | 보관함 최상위 선택 컬렉션 `folders`. ⚠️ 옛 버전에서 저장하면 폴더 연결이 지워짐(링크를 한 번 더 붙여 넣으면 다시 생김) |
| F4 | 내 근처 저장 장소 | `v0.11.0` · `feat/nearby` | [설계서](2026-10-16-nearby-design.md) | [계획](../plans/2026-10-16-nearby.md) | 7 | 없음(위치·근처 모드는 메모리만). ✅ |
| F5 | 여행 당일 모드 | `v0.12.0` · `feat/trip-day-mode` | [설계서](2026-10-16-trip-day-mode-design.md) | [계획](../plans/2026-10-16-trip-day-mode.md) | 9 (Task 0·8은 커밋 없음) | 없음(F2의 `visitedOn`만 씀). ✅ |
| F6 | 영업시간·휴무 경고 | `v0.13.0` · `feat/business-hours` | [설계서](2026-10-16-business-hours-design.md) | [계획](../plans/2026-10-16-business-hours.md) | 8 (Task 8은 커밋 없음) | 새 캐시 키 `tripmap:hours:v1`(보관함 밖). ✅ 옛 버전은 읽지도 지우지도 않음 |
| F7 | 여행 일정 공유 | `v0.14.0` · `feat/trip-share` | [설계서](2026-10-16-trip-share-design.md) | [계획](../plans/2026-10-16-trip-share.md) | 11 | 보관함 형식 그대로. 공유 형식 v2(여행) 추가, 장소만 보낼 때는 v1 그대로. ✅ (되돌린 앱은 v2 파일을 가져오지 못함 — 보관함은 그대로) |

모든 묶음 공통: 구현 PR은 **병합 커밋(Create a merge commit)** 으로 넣고, 병합 커밋에 태그를 붙인 뒤 별도 문서 PR `docs: 롤백 표에 v0.X.0`으로 `docs/rollback.md`에 한 줄을 더한다(교차 검토에서 F3·F7도 이 방식으로 맞췄다).

### 1.1 무엇이 어디에 저장되나 (F1 백업이 담는지)

| 묶음 | 보관함 문서(`tripmap:library:v2`) | 선호(`tripmap:prefs`) | 별도 키 | 메모리만 | F1 백업 |
|---|---|---|---|---|---|
| F1 | — | — | `tripmap:backup:v1`(마지막 백업·미룸), `…:before-restore`(되살리기 전 사본) | — | 두 키는 이 기기 정보라 담지 않음(의도) |
| F2 | 장소 `visitedOn`·`review` | `query.visited`(선택 키) | — | `visitedSortAtom`(`다녀온 날순`) | ✅ 보관함 원문·선호에 들어감 |
| F3 | 최상위 `folders` | — | — | — | ✅ 보관함 원문에 들어감 |
| F4 | — | — | — | `myLocationAtom`·`nearbyAtom` | 해당 없음(저장 안 함, 개인정보) |
| F5 | (`visitedOn` 읽고 씀) | — | — | 고른 Day·화면 켜 두기 등 화면 상태 | 해당 없음 |
| F6 | — | — | `tripmap:hours:v1`(다시 받는 캐시) | `hoursStatesAtom` | ✗ 일부러 뺌(경로 캐시와 같은 이유) |
| F7 | — | — | — | — | 해당 없음 |

F1 백업은 보관함 **원문**을 그대로 담으므로 F2·F3이 더한 필드도 저절로 들어간다. 사용자 데이터는 모두 백업된다.

### 1.2 옛 버전에서 일어나는 일 (코드로 확인)

- Effect 4.0.2의 디코드 기본값 `onExcessProperty: "ignore"`는 모르는 키를 **지운다**(`node_modules/effect/src/SchemaAST.ts`의 `ParseOptions` 설명). 이 저장소의 `safeParse`(`src/schema/parse.ts`)는 옵션을 넘기지 않으면 이 기본값을 쓴다. F1·F2·F3·F6·F7 설계서가 각각 같은 사실을 확인했다.
- 그래서 **선택 필드·선택 키**를 더하는 것은 옛 버전에서 손상 화면을 만들지 않는다. 옛 버전에서 저장하면 그 필드만 사라진다(F2·F3의 ⚠️).
- **선호의 리터럴 유니온에 새 값을 더하는 것은 위험하다**(조정자 판정 A). `readPrefs`(`src/services/prefs-store.ts`, `v0.3.0`·`v0.7.2`·지금 `main` 모두 같은 코드 — 2026-10-16 `git show`로 확인)는 검증에 실패하면 `freshDefaults()`를 돌려줘 테마·보기 방식까지 기본값이 된다. 반면 `LibraryQuerySchema`는 `Struct`라 새 선택 키(`query.visited`)는 지우고 통과한다. 그래서 F2의 `다녀온 날순`과 F4의 `가까운 순`은 둘 다 메모리 정렬이다.

## 2. 묶음 사이 약속 C1~C6 — 최종 모양

실제 문서에 쓰인 이름이다. 지침과 다른 곳은 굵게 표시했다.

### C1 다녀옴·한 줄 평 (주인 F2, 쓰는 쪽 F5·F7·F1)

- `src/schema/library.ts` `PlaceSchema`:
  - `visitedOn: Schema.optional(FieldSchema(Schema.NullOr(CalendarDate)))` — **`IsoDate`라는 이름은 저장소에 없어 `CalendarDate`(`src/schema/common.ts`)를 쓴다.**
  - `review: Schema.optional(FieldSchema(Schema.String.check(Schema.isMaxLength(LIBRARY_LIMITS.reviewChars))))` — `reviewChars = 140`(`src/schema/library-base.ts`).
- 도우미 `src/domain/library/visit.ts`: `visitedOnOf`, `isVisited`, `reviewOf`, `localDateOf`, `normalizeReview`, `formatVisitDate`. LWW `src/domain/library/lww.ts`: `setOptionalField`.
- 연산 `src/domain/library/ops.ts`: `setVisitedOn(lib, dates: Record<id, 'YYYY-MM-DD' | null>, ctx)`, `markVisited(lib, ids, date, ctx)`(늦은 날 유지), `markVisitedToday(lib, ids, ctx)`(기기 날짜), `setPlaceReview(lib, id, review, ctx)`. `OpError`에 `VisitDateInvalid`·`ReviewTooLong`.
- **판정 B**: F5는 체크할 때 `setVisitedOn`에 **오늘 Day의 날짜**(04:00 전이고 어제가 여행 기간이면 어제)를, 풀 때 `null`을 넘긴다. `markVisitedToday`는 장소 상세의 `다녀왔어요`와 일괄 편집만 쓴다. F2 §6.3·F5 §4.4·§10.3·§11-5가 이 뜻으로 맞다.
- 조건·선호: `LibraryQuery.visited: 'all' | 'unvisited' | 'visited'`(`tripmap:prefs`의 선택 키, 디코드 기본값 `all`), `visitCounts`, `hasVisited`, `sortByVisited`. **`sort` 리터럴은 `recent|name|label` 그대로**, `다녀온 날순`은 메모리 `visitedSortAtom`(`src/stores/visit-sort.ts`).
- F7: `메모 포함`일 때 `place.review?.value`를 v2 `places[].review`로 담는다. `visitedOn`은 담지 않는다. 가져올 때 둘 다 쓰지 않는다.

### C2 내 위치 (주인 F4, 쓰는 쪽 F5)

- `src/services/geolocation.ts`: `GeoFix = { lng; lat; accuracyM; at }`, `Geolocation`(`current: Effect<GeoFix, GeolocationError>`, `watch(onFix, onError): () => void`), `Geolocation.layerWith({ api, secure })`·`Geolocation.layer`, `GeolocationApi`, `CURRENT_OPTIONS`·`WATCH_OPTIONS`.
- `src/services/errors.ts`: `GeolocationError`(`reason`: `denied | unavailable | timeout | unsupported`, `userMessage`), `GEOLOCATION_ERROR_REASONS`.
- 지도: `MyLocation = { lng; lat; accuracyM }`, `MapAdapter.setMyLocation(fix: MyLocation | null)`(네이버·가짜 둘 다), `MapView` prop `myLocation`, 그리고 **덧붙인 것** `controls`(오른쪽 위 단추 기둥, ＋/− 아래)·`controlsRight`·`extraFitPoints`.
- 상태 `src/stores/my-location.ts`: `myLocationAtom`, `locateAtom`, `nearbyAtom`. 거리 글자 `formatDistanceM`(`src/domain/nearby.ts`). 시험 도우미 `tests/unit/helpers/fake-geolocation.ts`의 `fakeGeolocation()`.
- F5는 `watch`로 받고(화면이 숨으면 해제 — F4가 바란 것), `myLocationAtom`에는 쓰지 않고 화면 상태로 둔다. `내 위치로` 단추는 `MapView.controls`에 둔다. 거리 글자·위치 오류 문구는 F4 것을 그대로 쓴다(교차 검토에서 맞춤).

### C3 백업 형식 (주인 F1)

- `tripmap-backup` v1 = `{ format: 'tripmap-backup', v: 1, exportedAt, library, prefs? }`. `library`는 **저장소 원문을 `JSON.parse`한 값 그대로**(디코드한 값이 아님 — 모르는 선택 필드도 잃지 않는다). `prefs`는 `PrefsSchema`를 통과할 때만 쓴다.
- 늘리는 규칙: 읽는 쪽은 모르는 최상위 필드를 무시하므로, 뒤 묶음이 별도 키를 백업해야 하면 `v`를 올리지 않고 선택 최상위 필드를 더한다. 이번 F 묶음에서는 그럴 묶음이 없다(§1.1).
- 이름: `BACKUP_FORMAT`, `BACKUP_VERSION`, `BackupEnvelopeSchema`, `buildBackupText`, `readBackupText`·`readBackupFile`(`droppedUnknown` 경고), `LibraryStore.snapshot·replace·previous·restorePrevious·dropPrevious`.

### C4 공유 형식 (주인 F7)

- `tripmap-share` v2 = v1 필드 + `version: 2` + `trips`(길이 정확히 1) + `places[].review?`(≤140). 앱 `ShareDocV2Schema`(`onExcessProperty: 'error'`) + 관계 검사 `checkShareTrip`(순수, `src/domain/share/check-share-trip.ts`).
- **덧붙인 결정**: 장소만 내보내는 `내보내기`는 지금과 바이트까지 같은 v1을 계속 쓴다(옛 앱 호환). v1 파일은 계속 읽는다. `version ≥ 3`은 새 오류 `newer`.
- 지도 페이지 규약: `ready.maxV = 2`(봉투는 늘 v1), 파일 → 지도 `draw`(봉투 v2에서만). 옛 지도 페이지에는 v1 `init`으로 대체.
- 빌드·가져오기: `buildTripShareDoc`, `renderTripShareHtml`, `importSharedTrip`, `sameTripExists`. F1은 공유 형식을 건드리지 않는다.

### C5 폴더 기록 (주인 F3)

- 보관함 최상위 `folders: Schema.optionalKey(Schema.Record(Schema.String, FolderLinkSchema))`, 키 = 공유 ID. `FolderLinkSchema = { shareId, name: Field<≤100>, labelId: Field<LabelId>, seenSids: Field<≤1000>, checkedAt, createdAt, deletedAt }`. `NaverSid`·`ShareId` 스키마, `LIBRARY_LIMITS.folderNameChars`·`folderSids`.
- `src/domain/library/folder-links.ts`: `folderLinks`, `liveFolderLink`, `folderLinksOfLabel`, `recordFolderLink`, `unlinkFolder`, `planFolderSync`, `syncFolder`. 라벨 지우기·합치기가 연결을 따라 고친다(`ops.ts` 안 도우미).
- 보관함 문서 안이라 F1 백업에 저절로 들어간다. `v0.8.0`·`v0.9.x`에서 그 백업을 되살리면 `droppedUnknown` 경고와 함께 빠진다.

### C6 영업 정보 (주인 F6)

- 보관함 밖 기기 캐시 `localStorage['tripmap:hours:v1']`(`HOURS_CACHE_KEY`) = `{ entries: { [sid]: PlaceHours & { usedAt } } }`, 300곳·40만 자, 7일. `PlaceSchema`에 필드를 더하지 않는다.
- 이름: `PlaceHours`(`src/server/hours.ts`), `checkVisit`·`checkDate`·`visitMessage`(`src/domain/trips/hours.ts`), `HoursLookup`, `usePlaceHours`·`useTripHoursRequests`, `noticeFor`·`HoursNotice`.
- 백업·공유에 넣지 않는다. F5는 F6에 기대지 않는다. F5 당일 모드에 경고를 넣는 일은 F6 병합 뒤 작은 후속으로 미룬다(F6 결정 5, 자리는 F5 §10.3이 비워 둠).
- **리뷰 반영**: F6은 하루 경계로 F5의 `DAY_ROLLOVER_HOUR`(`src/domain/trips/today.ts`, 4)를 import해 쓴다(F6 §3.2·§10). F6이 F5 코드에 기대는 유일한 곳이다.

## 3. 같은 파일을 고치는 곳 · 병합 순서 주의

뒤 묶음을 구현할 때는 **병합본의 그 파일을 먼저 읽고** 앞 묶음이 더한 것을 지키며 고친다. 각 계획의 Interfaces는 앞 묶음 결과를 전제로 쓰였고, 교차 검토에서 어긋난 곳을 고쳤다(§6).

| 파일 | 고치는 묶음 | 주의 |
|---|---|---|
| `src/services/library-store.ts` | F1 → F6 | F1이 `putItem`의 용량 초과 대체에 "경로 캐시 → 되살리기 전 사본 지우기"를 둔다. F6은 첫 단계를 "경로·영업시간 캐시"로 넓히고 사본 단계는 그대로 둔다(교차 검토에서 F6에 적음). |
| `src/services/errors.ts`, `src/lib/effect/runtime.ts`(`AppLayer`) | F1(`BackupMetaStore`, `PreviousNotKept`·`NoPrevious`) → F4(`Geolocation`, `GeolocationError`) → F6(`HoursLookup`, `HoursLookupError`) | 서로 다른 줄을 더한다. 글자 충돌만 |
| 시험 런타임(`tests/unit/sections/shell/harness.tsx`, `use-library-query.test.tsx`, `library-state.test.tsx`, `theme-root.test.tsx`, `planner-timeline.test.tsx` 등) | F1 → F4 → F6 | 셋 다 레이어 옵션을 더한다(F1 `BackupMetaStore.layerWith`, F4 `geolocation`, F6 `hoursLookup`·`PENDING_HOURS_LOOKUP`). 앞 묶음 옵션을 지우지 않는다 |
| `src/schema/library.ts`, `src/schema/library-base.ts` | F2(`visitedOn`·`review`, `reviewChars`) → F3(`folders`, `NaverSid`·`ShareId`, 두 한도) | F3의 `NaverSid`를 `PlaceSource`의 sid에도 쓴다 — F2 필드와 무관 |
| `src/domain/library/ops.ts` | F2(다녀옴 연산) → F3(라벨 지우기·합치기의 연결 처리) | 첫 화면 번들. F3은 `folder-links.ts`를 import하지 않는다 |
| `src/sections/library/{SortMenu,FilterBar,LibraryPage,PlaceRow,PlaceCard,LabelChips}.tsx`, `src/sections/map/LibraryMap.tsx` | F2 → F4 | 정렬: F2 `visitedSort`/`onVisitedSort` 위에 F4 `nearby`/`onNearby`, 둘 중 하나만 켜짐. 목록: `useNearby(visitedSort ? sortByVisited(q) : q)`. 좁은 지도 칩 줄: `leading` = F4 `내 근처` 칩 → F2 `방문` 묶음 → 라벨. 행: F2 이름 뒤 ✓, F4 지역 자리에 거리 |
| `src/components/map/{MapAdapter,FakeMapAdapter}.ts` | F2(`MapMarker.visited`) → F4(`setMyLocation`, `MyLocation`) | 글자 충돌만. `MapView.tsx`·`NaverMapAdapter.ts`는 F4만 |
| `src/sections/add-place/FolderList.tsx` | F2(가져온 뒤 `visited: 'all'`) → F3(`shareId` prop, 연결 기록) → F4(가져온 뒤 근처 모드 끄기) | F3의 다시 가져오기 `보관함에서 보기`도 `visited: 'all'`로 푼다(교차 검토에서 F3에 적음). F4 Task 6은 그 `onClick`(`FolderResync.tsx`)에서도 근처 모드를 끈다 |
| `src/stores/backup-state.ts` | F1(`useRestoreActions`) → F4(되살리기 뒤 근처 모드 끄기) | F4 Task 6. 리뷰 반영 |
| `src/sections/share-import/SharePreview.tsx` | F2(`visited: 'all'`) → F3(`localDate`를 `src/lib/local-date.ts`로 옮김) → F4(제목 라벨로 거른 뒤 근처 모드 끄기) → F7(여행 칸) | F7 계획 머리에 적음(F4 줄은 리뷰 반영으로 더함) |
| `src/sections/trips/TripsPage.tsx` | F5(카드 아래 `오늘 일정`) → F7(메뉴 `일정 공유`) | 다른 자리 |
| `src/sections/trips/planner/TripPlannerPage.tsx` | F5(지도 위 `오늘 일정`) → F6(요청 훅, `MapCard`에 `plan`) | |
| `src/sections/trips/planner/DayTimeline.tsx` | F6(`StopRow` 영업시간 줄) → F7(`DayHeader`의 `일정 공유`) | |
| `src/domain/trips/today.ts` | F5(새 파일, `DAY_ROLLOVER_HOUR`) → F6(import만) | F6이 하루 경계 상수를 함께 쓴다. 리뷰 반영 |
| `src/domain/trips/schedule.ts` | F5(`ScheduleInput.startMin?`) | F7 보기 화면이 `computeSchedule`을 import한다 — 선택 입력이라 영향 없음 |
| `src/sections/trips/planner/format.ts` | F6(`hoursCheckedLabel`) | F7 보기 화면이 이 파일을 런타임으로 import한다. 새 import 없는 순수 함수여야 한다(F6 계획에 적음) |
| `src/components/icons.tsx` | F4(`LocateFixedIcon`) → F6(`AlertIcon`) | |
| `src/routes/lazy-routes.ts` | F1(`loadRestoreDialog`→`PANEL_CHUNKS`) → (F4 `NearbyBar`, 예산을 넘을 때만) → F5(`loadTripTodayPage`→`ROUTE_CHUNKS`) → F7(`loadTripShareDialog`→`PANEL_CHUNKS`) | |
| `package.json` `build:ci` | F1 `--require-lazy RestoreDialog` → (F4 `--require-lazy NearbyBar`, 넘을 때만) → F5 `--require-lazy TripTodayPage` → F7 `--require-lazy TripShareDialog` | 모두 `&& yarn build:map` 앞, `--require-lazy` 목록 끝에 더한다. F2·F3·F6은 추가 없음 |
| `functions/api/*`, `src/server/cache-key.ts`, `tests/unit/server/functions.test.ts` | F3(`naver-folder` `fresh=1`) → F6(`/api/hours`, `hoursCacheKey`) | |
| `tests/unit/services/library-store.test.ts` | F1 → F2 → F6 | |
| `playwright.config.ts` | 일곱 묶음 모두(세 프로젝트 `testMatch`에 spec 하나씩) | |
| `docs/rollback.md` | 일곱 묶음 모두, 병합 뒤 | F2가 "`v0.3.0` 이후로는 저장 형식이 바뀌지 않아" 문장을 고치고 F3이 `folders`를 더한다 |
| `README.md` | F1(알려진 한계), F7(기능 한 줄) | |

**코드 되돌리기 의존**(묶음 하나를 통째로 되돌릴 때): F5는 F2·F4에 기대고, F7은 F2(`review`)에 기댄다. 리뷰 반영으로 F6은 F5(`DAY_ROLLOVER_HOUR`)에, F4(Task 6)는 F1(`backup-state.ts`)·F3(`FolderResync.tsx`)의 파일에 한 줄씩 기댄다. 앞 묶음을 되돌리려면 그에 기대는 뒤 묶음을 먼저 되돌린다(F4 설계서 §5.4가 F5에 대해 적은 것과 같은 규칙).

## 4. 첫 로딩 예산 누적 (추정)

기준: `perf-budget.json` 한도 327,680 B, 2026-10-14 측정 297,769 B → 여유 **29,911 B(약 29.2 KiB)**. 아래는 어느 묶음도 아직 재지 않은 추정이다. 각 계획의 마지막 확인 단계(`yarn build:ci`/`yarn size`)에서 실제 값을 `perf-budget.json`에 적는다.

| 묶음 | 첫 로딩에 붙는 것 | 추정(gzip) | 근거 | 넘을 때의 대안(설계서) |
|---|---|---|---|---|
| F1 | 알림 띠·메타 저장소·요약·받기 훅·저장소 메서드 | +2~4 KB | F1 설계서 §7 | 띠를 나눠 받기 |
| F2 | 다녀옴 칸·방문 칩·연산·조건·마커 글자 | +2~3 KB(검토자 추정) | 설계서는 "작다"만. 컴포넌트 2개·연산 몇 개 | 없음(첫 화면이라 나누지 않음) |
| F3 | 스키마·`ops.ts` 도우미 | +0.5 KB 이하 | F3 설계서 §8 | — |
| F4 | 위치 서비스·근처 계산·상태·근처 줄·지도 단추·아이콘 | +3~5 KB(검토자 추정) | 설계서는 "작다"만 | `NearbyBar` 나눠 받기 + `--require-lazy NearbyBar` |
| F5 | 경로·라우트·`lazy-routes` 몇 줄 | +0.3 KB 이하 | F5 설계서 §10.1 | — |
| F6 | `HoursLookup`·오류 클래스(`AppLayer`) | +2~3 KB(검토자 추정) | 비슷한 `route-lookup.ts`(원문 gzip 7.5 KB, 주석 포함)보다 작은 서비스 | `HoursLookup`을 계획 화면 레이어로 |
| F7 | v2 스키마·관계 검사·`read-share` 변경 | +1~2 KB | F7 설계서 §11 | `read-share`를 동적 import |
| **합계** | | **약 11~18 KB** | | 여유 약 11~18 KB가 남는 셈. 확인 필요 |

나눠 받는 새 단위: `RestoreDialog`(F1), `TripTodayPage`(F5), `TripShareDialog`(F7), (넘을 때만) `NearbyBar`(F4). F3의 `FolderResync`는 이미 나뉜 `FolderPreview`에, F6 화면은 이미 나뉜 `TripPlannerPage`에 들어간다. F7 보기 화면 틀 한도(51,200 B, 지금 15,103 B)는 앱 예산과 따로다.

## 5. 사용자 결정 모음

각 줄: **항목 · 추천 · 한 줄 이유**. 표시: 🔗 다른 묶음과 맞물림, ⚖️ 조정자 판정으로 바뀜, ⚠️ 추천이 서로 부딪힘(조정자 판단 필요 §7).

### F1 전체 백업·복원

1. 복원 방식 · 통째로 바꾸기만 · 합치기는 사실상 동기화 설계라 별도 묶음감 🔗(F3이 합치기 규칙을 바랐으나 "통째로"면 해당 없음)
2. 바꾸기 전 지금 상태 남기기 · 기기 안 사본 한 벌(공간이 모자라면 먼저 파일로 받게) · `되돌리기` 한 번으로 끝난다. ⚖️ 리뷰 반영: 먼저 받은 뒤 다른 탭이 보관함을 고쳤으면(받은 원문 ≠ 잠금 안 원문) 사본을 꼭 남기고, 못 남기면 바꾸지 않고 다시 받게 함
3. 복원 미리보기 · 만든 날짜 + 개수 비교 + 경고 · "맞는 파일인가"만 확인하면 된다
4. 백업 알림 · 바뀐 내용이 있고 7일 지나면 띠, `나중에`는 7일 미룸 · 아이폰 사파리 7일 규칙
5. `navigator.storage.persist()` · 백업을 처음 받을 때 한 번 · 앱 열 때 물으면 파이어폭스가 이유 없이 권한 창
6. 선호·경로 캐시 포함 · 선호 포함(필터는 기본값으로), 경로 캐시 제외 · 선호는 작고 반갑다, 경로는 크고 다시 받는다 🔗(F2 `query.visited`도 들어감)
7. 파일 이름 · `landmark-backup-2026-10-16-1430.json` · 콜론은 파일 앱·윈도에서 문제
8. 휴대폰 저장 · 받기 + 공유(되는 기기만) · 공유 창은 바로 보내기 좋다
9. 손상 화면이 받은 옛 백업 파일 · 되살릴 수 있게 · 가진 사람이 있을 수 있고 비용이 거의 없다
10. 손상 화면에서 되살리기 · 넣는다 · `새로 시작` 말고 갈 길이 생긴다
11. 파일 크기 한도 · 16 MiB · 보관함 400만 자가 한글이면 12MB에 가깝다
12. 끌어 놓은 백업 파일 · 이번엔 그대로(`Landmark 공유 파일이 아니에요`) · 공유 가져오기 코드를 건드리지 않는다

### F2 다녀온 곳·한 줄 평

1. (D1) 다녀옴 데이터 모양 · 가장 최근 날짜 하나 · 필터·정렬·F5 체크에 충분, 이력은 LWW로 합치기 어렵다
2. (D2) 미래 날짜 · 화면에서 막음 · "다녀옴"의 뜻
3. (D3) 안 가 본 곳의 한 줄 평 · 허용(독립) · "친구 추천" 같은 쓰임
4. (D4) 다녀옴 취소 때 평 · 남김 · 실수로 취소해도 글을 잃지 않는다
5. (D5) 방문 칩 자리 · 라벨 칩 줄 맨 앞, 다녀온 곳이 있을 때만 · 안 쓰는 사람 화면은 그대로 🔗(F4 `내 근처` 칩이 그 앞에 온다)
6. (D6) `다녀온 날순` · 넣되 **메모리 정렬**(새로고침하면 풀림) · ⚖️ 판정 A: 선호의 `sort`에 저장하면 옛 버전에서 테마까지 기본값이 된다. 번거로우면 "안 넣음"
7. (D7) 지도 핀 표시 · 이름 앞 `✓` · 흐림·테두리는 이미 다른 뜻
8. (D8) 일괄 편집에 다녀옴 · 넣음(오늘 표시·지우기) · 여행 뒤 여러 곳을 한 번에
9. (D9) 검색에 평 · 찾되 안내 문구는 그대로 · 좁은 화면에서 문구가 잘린다
10. (D10) 모르는 필드 보존(앞으로의 롤백 대비) · 이번엔 안 함 · 옛 버전에는 효과가 없고 타입이 느슨해진다 🔗(F3 `folders`도 같은 ⚠️)
11. (D11) 공유 파일에 평 · F7 안: `메모 포함`일 때 함께, `visitedOn`은 뺌 · 🔗 F7 결정 3과 일치
12. (D12) 카드에 평 · 메모 아래 2줄 · 카드는 글을 보는 보기

### F3 네이버 폴더 다시 가져오기

1. 폴더 기록 위치(C5) · 보관함 문서의 선택 컬렉션 `folders` · 가져오기와 한 번에 저장되고 백업에 저절로 들어간다(대가: 옛 버전에서 저장하면 연결만 지워짐 ⚠️) 🔗(F1이 바란 방식)
2. "새로 저장한 곳" 판단 · 지난번에 본 `sid` 목록 · 네이버 시각 규칙을 확인하지 못했다
3. 폴더에서 빠진 곳 · 알리기만 · 내 정리본을 덮지 않는다
4. 보관함에서 지운 곳 · 따로 묶어 체크 없이 보이기 · 삭제를 지키고 실수는 되살린다
5. 진입점 · 라벨 고치기 대화상자 + 같은 링크 붙여 넣기 · 연결은 라벨에 붙는다
6. 연결된 링크를 다시 붙여 넣으면 · 다시 가져오기 화면(+`폴더 전체 보기`) · 링크로 다시 가져오는 습관 그대로
7. 여러 폴더 한 번에 · 이번엔 안 함 · 화면이 복잡하고 요청이 몰린다
8. 고르지 않은 새 곳 · 본 것으로 기억 · 매번 같은 곳을 다시 묻지 않는다
9. 다시 가져오기의 캐시 · 연결된 폴더만 `fresh=1` · 방금 저장한 곳이 보여야 하는 건 그때뿐
10. 가져온 뒤 필터 · 바꾸지 않고 토스트 `보관함에서 보기` · 라벨 관리 화면이 그대로 남는다 🔗(누르면 F2 방문 필터도 풂)
11. 라벨을 지우거나 합칠 때 · 지우면 연결도 끊고 합치면 옮김 · 불변식이 단순하다

### F4 내 근처 저장 장소

1. 진입점 · 정렬 `가까운 순` + 지도 `내 위치 보기` · 라벨·지역 필터와 함께 쓴다
2. 반경 값과 기본값 · 500m·1km·3km·5km·10km·전체, 기본 3km · 강원도는 차로 다닌다
3. 가까운 순·반경 기억 · 메모리만 · 선호에 넣으면 옛 버전에서 선호 전체가 기본값 🔗(판정 A의 근거)
4. 계속 따라가기 · F4는 누를 때 한 번, watch는 F5만 · 배터리
5. 근처 모드 지도 맞추기 · 반경 원을 감싸는 상자 · 범위를 한눈에
6. 내 위치 점 색 · 고정 파랑 `#1a73e8` · 지도 앱 관례, 라벨 색과 헷갈리지 않게
7. 정확도 경고 기준 · 1km · 1km 반경이 의미 없어지는 선
8. 중간 폭 덮개가 있을 때 지도 단추 · 덮개 폭만큼 왼쪽으로(＋/− 포함) · 가려진 단추는 못 누른다
9. 거리 종류 · 직선거리(화면에 밝힘) · 경로 조회는 장소 수만큼 나가 느리다
10. 위치 유효 시간 · 얻은 시각만 보이고 만료 안 함 · 사람이 판단한다
11. 반경 밖에 숨은 장소 안내 · 근처 줄 끝에 `· 3km 밖 N곳은 숨김`(지금은 안내 없음) · 사용자 `필터 지우기`는 근처 모드를 끄지 않으므로 숨은 이유가 보여야 한다 ⚖️(리뷰 반영으로 더함. 앱이 필터를 푸는 흐름 — F1 되살리기·F3 `보관함에서 보기`·폴더/공유 가져오기 — 은 근처 모드를 끄도록 이미 바꿈) 🔗F1·F3

### F5 여행 당일 모드

1. 들어가는 길·자동 전환 · 여행 목록 + 계획 화면 버튼, 자동 전환 없음 · 저절로 넘어가면 놀란다 ⚠️(계획 화면 지도 위 버튼 자리 — §7-1)
2. 하루의 경계 · 04:00 전은 어제가 여행 기간이면 어제 · 자정을 넘는 일정 🔗(장소 상세의 `다녀왔어요`는 자정 경계 — 판정 B로 의도된 차이. F6이 같은 상수 `DAY_ROLLOVER_HOUR`로 영업 끝/영업 전을 가른다 — F6 결정 10)
3. 기간 밖 · 미리 보기 + 체크 숨김 · 전날 밤 내일 일정을 본다
4. "다음" 규칙 · 마지막 체크 뒤의 첫 미체크(되감음) · 건너뛴 곳에 막히지 않는다
5. 체크 날짜와 판정 · 오늘 Day의 날짜로 쓰고 여행 기간 안이면 다녀옴 · ⚖️ 판정 B로 확정
6. 체크 풀기 · `null`로, 옛 날짜는 8초 되돌리기에서만 · 단순
7. 늦어짐 계산 · "지금 출발하면", 기준 5분 · 기존 구간 결과만 쓴다
8. 내 위치 켜기 · 권한이 이미 허용이면 자동, 아니면 버튼 · 처음부터 권한 창이 뜨면 거절하기 쉽다
9. 화면 켜 두기 · 메뉴 토글, 기본 끔, 저장 안 함 · 배터리, 저장하면 선호 형식이 바뀐다 🔗(판정 A와 같은 방향)
10. 오프라인 새로 열기(서비스 워커) · 이 묶음 밖 · 배포·롤백 전체에 영향
11. 좁은 화면 배치 · 위 지도 + 아래 카드·목록 · 한 손으로 버튼에 닿는다
12. "지금 여기" 기준 · 정확도 200m, 150m 안, 2분 안 · 실제 기기로 확인한 값은 아니다

### F6 영업시간·휴무 경고

1. 영업 정보 저장 위치(C6) · 보관함 밖 캐시 `tripmap:hours:v1` · 롤백 안전, 보관함 용량을 안 쓴다 🔗(F1 동의)
2. 다시 받는 주기 · 7일 · 자주 안 바뀌고 네이버 요청을 아낀다
3. 정보 없는 장소의 행 표시 · 행·카드 모두 `영업시간 확인 필요` · "모르면 확인 필요" 원칙(시끄러우면 카드에만으로)
4. 공휴일 · 계산하지 않고 카드에 규칙만 · 근거 없는 추측을 피한다
5. 당일 모드(F5)에 경고 · 이번엔 안 넣고 F5 병합 뒤 작은 후속 · 🔗 F5 §10.3이 자리를 비워 둠
6. 카카오 장소 영업시간 · 이번엔 안 함 · 조사하지 않았다
7. 경고 종류 · 머무는 중 영업 끝·브레이크까지 · 체류가 문제인 경우가 흔하다
8. 지도 핀 표시 · 없음 · 행·카드로 충분
9. Cloudflare에서 네이버가 막힐 때 · 그대로 `확인 필요`, 미리보기 배포에서 먼저 확인 · 막히면 병합하지 않고 다시 논의
10. 영업 끝/영업 전을 가르는 하루 경계 · 04:00, F5 `DAY_ROLLOVER_HOUR`를 함께 씀 · 당일 모드와 같은 하루, 한 상수 ⚖️(리뷰 반영으로 더함) 🔗F5 결정 2

### F7 여행 일정 공유

1. v2에 담는 여행 수 · 1개 · 대개 여행 하나를 보낸다, 형식은 배열이라 넓힐 수 있다
2. 장소만 내보낼 때 형식 · v1 그대로 · 옛 앱이 계속 가져온다
3. 메모·한 줄 평·Stop 메모 · 장소 메모·평은 `메모 포함`으로, Stop 메모는 늘. 받은 평은 가져오지 않음 · 🔗 F2 D11과 일치
4. 지도 페이지 배포 순서 · 한 PR로 병합 · 대체 표시가 있어 몇 분 차이가 파일을 깨지 않는다
5. 이미 같은 여행이 있을 때 · 늘 새 여행 + 경고 · 받은 사람의 계획을 잃지 않는다
6. 경로선을 파일에 · 넣는다(해시 링크에서는 뺌) · 받은 사람은 파일 안에서 경로를 다시 조회할 수 없다
7. 들어가는 곳 · 시간표 머리 `일정 공유` + 여행 목록 메뉴 · 세 화면 크기 모두에서 보인다
8. 후보 기본값 · `후보도 넣기` 켬 · 동행과 "어디를 더 갈지" 함께 본다
9. 장소만 보내는 `내보내기`(v1)에도 파일 크기 검사 · 함께 적용 · 같은 `ShareFileDialog` 몸통이라 한 줄, 받을 수 없는 파일을 만들지 않는다 ⚖️(리뷰 반영으로 더함. 일정 공유는 최종 HTML이 5,242,880바이트를 넘으면 늘 막는다)

## 6. 교차 검토에서 고친 것

| 파일 | 고친 것 |
|---|---|
| F2 설계서 | 판정 A: `다녀온 날순`을 메모리 atom(`visitedSortAtom`)으로, `sort` 리터럴은 그대로(§4.5·§5.2·§5.3·§5.4·§6.1·§6.2·§8·§11·D6). 판정 B: F5는 `setVisitedOn`+오늘 Day 날짜, `markVisitedToday`는 다른 화면(§1.2·§6.3). F1 시험 예를 F1이 처음부터 `futureField`로 쓰게 됐다는 것, 롤백 문서의 "저장 형식이 바뀌지 않아" 문장 고치기 |
| F2 계획 | 판정 A를 Global Constraints·Architecture에. Task 2(`sortByVisited`, `sort` 리터럴 그대로, 옛 `LibraryQuerySchema` 호환 시험), Task 5(`visit-sort.ts`, `SortMenu`의 `visitedSort`/`onVisitedSort`, 300ms 뒤 `sort` 그대로 시험), Task 7(새로고침 뒤 정렬 기대값), Task 1(F1 시험을 고치지 않고 한 건만 더함), Task 8(롤백 문장), 출발점 줄 |
| F1 설계서·계획 | "모르는 필드" 시험 예를 뒤 묶음 실제 이름(`visitedOn`·`folders`) 대신 `futureField`·`futureCollection`으로(병합 뒤 시험이 깨지지 않게). 봉투 최상위 / 보관함 최상위 모르는 필드를 나눠 시험. C1 줄에 F2 선호 변경 반영 |
| F3 설계서·계획 | 다시 가져오기 `보관함에서 보기`가 F2 방문 필터도 `전체`로 풂(Task 6 시험 추가). 롤백 줄에 ⚠️ 표시, 롤백 표는 병합 뒤 별도 문서 PR로 |
| F4 설계서·계획 | F2 `다녀온 날순`과의 관계(둘 중 하나만, 메뉴 순서), 목록 파이프라인(`useNearby(sortByVisited…)`), 좁은 지도 칩 순서(`내 근처` → `방문` → 라벨, F2 `leading` 자리), 출발점·브랜치 `feat/nearby` |
| F5 설계서·계획 | 판정 B 확정 문장(§11-5, Global Constraints). 위치 띠의 오류 문구를 F4 `GeolocationError.userMessage`로, 거리 글자를 F4 `formatDistanceM`으로, 풀기 토스트를 F2와 같은 `‘<이름>’ 다녀옴 표시를 지웠어요`로. 브랜치 `feat/trip-day-mode` |
| F6 설계서·계획 | 용량 초과 때 F1의 사본 지우기 단계를 지킴(시험 추가), `format.ts`는 F7 보기 화면이 import하므로 순수 함수로, 출발점·브랜치 `feat/business-hours`, 롤백 표는 별도 문서 PR |
| F7 계획 | 앞 묶음이 먼저 고친 파일 목록(SharePreview·TripsPage·DayTimeline·TripPlannerPage·format·schedule·lazy-routes), 롤백 표는 병합 뒤 별도 문서 PR로(E2E 커밋과 분리) |

### 6.1 리뷰 지적 반영 (2026-10-16, 조정자 판정)

| 묶음 | 고친 파일·절 | 고친 것 |
|---|---|---|
| F1 | 설계서 §2.3·§2.4·§2.7·§4·§5·§6·§10-2, 계획 Global Constraints·Review Focus 4·Task 2·4·5·6 | `지금 보관함 먼저 받기` 뒤 다른 탭이 보관함을 고치고 사본 저장이 실패하면 그 변경이 사라지던 문제. 받은 원문(`savedText`)을 기억해 잠금 안 원문과 비교하고, 다르면 사본 필수(`PreviousNotKept({ changedSinceSaved })`). 못 남기면 `그사이 보관함이 바뀌었어요…`로 다시 받게 함. `snapshot`이 원문 문자열 `text`를 돌려줌. 시험: 먼저 받기 → 다른 탭 수정 → 사본 실패 |
| F4 | 설계서 §4.2·§7.1·§7.3·§8.1·§13-11, 계획 Review Focus 6·Task 3·새 Task 6(E2E는 Task 7로) | 가져오기·되살리기 뒤 반경 때문에 방금 넣은 장소가 숨던 문제. F1 되살리기(`backup-state.ts`), F3 `보관함에서 보기`(`FolderResync.tsx`), 폴더 가져오기(`FolderList.tsx` `submit`의 `patchQuery`), 공유 가져오기(`SharePreview.tsx` `submit`의 제목 라벨 `patchQuery`)가 `nearbyOffAtom`으로 근처 모드를 끔. 사용자 `필터 지우기`는 그대로, 숨은 수 안내는 결정 11 |
| F6 | 설계서 §3.2·§3.3·§8·§10·§12-10, 계획 Global Constraints·Review Focus 2·Task 3 | (1) `X-1`·`X`만 만들어 24시간 영업의 23:30~다음 날 00:30 체류가 `closes-during-stay`로 나오던 문제 → `X-1`·`X`·`X+1` 세 날 구간을 만들고 맞닿는 구간(24:00 = 다음 날 00:00)을 합침. (2) `18:00~02:00`의 10:00 도착이 `after-close`가 되던 문제 → 하루 경계 04:00(`DAY_ROLLOVER_HOUR`, F5와 공유)으로 영업 끝/영업 전을 가름. 03:59·04:00 경계 시험 |
| F7 | 설계서 §3.2·§9.3·§12·§13-9·§15.1, 계획 Global Constraints·Review Focus 6·Task 4·8 | 메모 최대 10,000자를 빼고 "장소당 약 1KB"로 잡아 5MB 가져오기 한도를 넘는 파일을 만들 수 있던 문제(v1에도 있음). `ShareFileDialog`가 최종 HTML 바이트(`shareHtmlBytes`)를 재서 넘으면 저장·공유를 막고 줄이는 방법(메모·후보 빼기)을 창 안에. v1 적용은 결정 9 |

이름·형태 확인 결과 그대로 맞은 것: C2의 `Geolocation`·`GeoFix`·`setMyLocation`·`MapView.myLocation`·`controls`(F4 ↔ F5), C1의 `setVisitedOn`·`visitedOnOf`(F2 ↔ F5), `review` 모양(F2 ↔ F7), `folders`(F3 ↔ F1), `tripmap:hours:v1` 제외(F6 ↔ F1), 태그 `v0.8.0`~`v0.14.0` 순서.

## 7. 조정자 판단 필요

1. **계획 화면 지도 왼쪽 위 `오늘 일정` 버튼(F5)과 네이버 SDK 확대·축소 막대.** 터치가 아닌 기기(데스크톱)에서는 SDK 막대가 지도에 그대로 있고, 코드 주석(`src/components/map/MapView.tsx`)은 그 자리를 "왼쪽 위"라고 적는다(F4가 실제 위치를 확인 필요로 남김). F5는 같은 왼쪽 위(펼치기 단추가 있으면 `left: 60`)에 44px 버튼을 둔다. 지금도 `후보 칸 펼치기`(왼쪽 위 8px)가 있으니 실제로 겹치는지 화면으로 봐야 한다. 겹치면 선택지: (a) SDK 막대 아래로 내림 (b) 지도 오른쪽 위 단추 기둥(`MapView.controls`)으로 (c) 시간표 머리(`DayHeader`)로 — 이 경우 F7의 `일정 공유`와 같은 줄이라 좁은 화면에서 줄이 넘친다.
2. **거리 글자 두 가지.** 기존 `formatDistance`(계획 화면 구간, F7 보기 화면): `1km`(`.0`을 뗌), 1m 단위. F4 `formatDistanceM`(보관함 근처, 이제 F5 카드도): `1.0km`, 10m 단위. 한 앱에서 `1km`/`1.0km`가 섞인다. 하나로 맞출지(F4가 기존 함수를 쓰게 하면 F4 시험 기대값이 바뀐다) 정해야 한다.
3. **"확인"·날짜 표기 두 가지.** F3 `2026.10.12 확인`, F1 `2026.10.16 14:30`, F2 카드 `다녀옴 2026.10.16`(`YYYY.MM.DD` 계열) ↔ F6 `10월 16일 확인 · 네이버`, 기존 경로 `10월 16일 조회`(`M월 D일` 계열). 바깥 정보(F6·경로)는 `M월 D일`, 내 기록(F1·F2·F3)은 `YYYY.MM.DD`로 나뉘어 있어 그대로 둬도 규칙은 있다. 맞출지 정해야 한다.
4. **되돌리기 토스트 시간.** 보관함 화면 5초(`LibraryPage`의 `UNDO_MS`, F2 따름), 여행 화면 8초(`use-trip-undo.ts`, F5 따름). 지금 코드 그대로라 고치지 않았다.
5. **새벽에 장소 상세에서 체크한 날짜.** 판정 B대로 장소 상세 `다녀왔어요`는 기기 날짜를 쓴다. 여행 마지막 날 새벽 1시에 당일 모드가 아니라 장소 상세에서 누르면 다음 날 날짜가 들어가 당일 모드에서는 "다녀옴"으로 세지 않는다. 드문 경우라 그대로 두는 것을 권하지만, 원하면 장소 상세도 진행 중인 여행이 있을 때 04:00 경계를 쓰게 할 수 있다.
6. **F2·F3의 ⚠️ 롤백.** 두 묶음 모두 옛 버전에서 저장하면 새 필드가 지워진다(손상 화면은 없다). F2 D10은 "모르는 필드 보존(`StructWithRest`)은 이번엔 안 함"을 추천했고 F3도 같은 처지다. 묶음마다 따로가 아니라 한 번에 정할 일이다(지금 추천: 하지 않고, 되돌리기 전에 F1 백업을 받도록 롤백 문서에 적음).

## 8. 확인하지 못한 사실 (묶음별)

- **F1**: 아이폰 사파리 7일 규칙을 영구 모드가 막는지, iOS 17 이후 바뀌었는지, 매니페스트 없이 홈 화면에 추가한 경우. 안드로이드 크롬·아이폰 사파리의 JSON 파일 공유. 첫 로딩 증가량.
- **F2**: 첫 로딩 증가량. (E2E는 Asia/Seoul 기준 날짜로 확인.)
- **F3**: 폴더 공유를 끄거나 비공개로 바꿨을 때 응답, 공유를 다시 켜면 공유 ID가 바뀌는지, 북마크를 다른 폴더로 옮기면 `creationTime`이 남는지(설계는 셋 다에 기대지 않음).
- **F4**: 네이버 SDK 확대·축소 막대의 실제 위치, `naver.maps.Circle` 옵션 이름·음수 `zIndex`, Playwright WebKit의 위치 흉내, iOS·삼성 인터넷의 권한 재요청과 15초 시한, 내 위치 점의 대비, 첫 로딩 증가량.
- **F5**: iOS 사파리 Screen Wake Lock·`navigator.permissions.query('geolocation')` 지원, WebKit `grantPermissions`, `error.main`의 여섯 테마 대비, 네이버 지도 앱에서 돌아올 때 화면 상태, "지금 여기" 기준값(실기기 확인 전).
- **F6**: 자정을 넘는 영업·24시간 표기의 실제 모양, 임시·정기 휴무가 찼을 때 형식, `공휴일`·`평일` 같은 표기, 없는 sid·영업시간 없는 장소의 홈 응답, 요청 빈도 한도, **Cloudflare 서버에서 `pcmap.place.naver.com` 접속 가능 여부**(막히면 묶음 전체가 `확인 필요`로 떨어짐), 카카오 `panel3`의 영업시간.
- **F7**: F1~F6 뒤 첫 로딩 여유, 일정 모드를 더한 보기 화면 틀 크기, 지도 페이지 한도(선 2,000·점 60,000) 성능, 카카오톡 안 브라우저에서 `nmap://` 길찾기.
- **공통**: §4의 예산 합계는 추정이다. 이 문서의 어떤 값도 빌드로 재지 않았다(교차 검토는 읽기만 했다).
