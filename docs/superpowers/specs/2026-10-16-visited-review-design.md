# 랜드마크 설계 — 다녀온 곳·한 줄 평 (묶음 F2)

- 작성일: 2026-10-16
- 상태: 설계 (리뷰 전)
- 태그: `v0.9.0` · 파일 이름 조각 `visited-review`
- 출발점: F1(전체 백업·복원, `v0.8.0`)이 병합된 `main`
- 관련 문서: `2026-10-08-place-library-design.md`(§3 데이터 모델·LWW), `2026-10-14-design-qa-design.md`(접근성 기준). 충돌하면 이 문서가 우선한다.
- 묶음 사이 약속 C1(다녀옴·한 줄 평)의 주인이다. 정의는 §3.

## 1. 배경과 목표

### 1.1 목표

저장한 장소가 쌓이면 어디를 가 봤는지 알 수 없다. 장소마다 **다녀온 날**과 **한 줄 평**을 남기고, 보관함에서 **안 가 본 곳만 / 가 본 곳만** 거를 수 있게 한다.

구글·네이버 지도와 다른 점: "가 봤다"가 별도 목록이 아니라 **내 장소의 속성**이다. 라벨·지역 필터와 함께 걸 수 있다("강릉 · 카페 · 안 가 본 곳").

### 1.2 성공 기준

1. 장소 상세에서 한 번 눌러 오늘 날짜로 "다녀옴"을 남기고, 날짜를 바꾸거나 지울 수 있다.
2. 140자까지의 한 줄 평을 남기고 고칠 수 있다.
3. 보관함 목록 행·카드·지도 핀에서 다녀온 곳이 보인다.
4. `안 가 본 곳`·`가 본 곳` 칩으로 목록과 지도가 함께 걸러지고, 라벨·지역 칩의 숫자도 그 조건을 따른다.
5. `다녀온 날순`으로 정렬할 수 있다(이 정렬은 저장하지 않는다 — 새로고침하면 저장된 정렬로 돌아간다, §4.5·§12 D6).
6. 선택 모드에서 여러 곳을 한 번에 "오늘 다녀옴"으로 표시하거나 표시를 지운다.
7. 새 필드가 있는 문서를 옛 버전(`v0.3.0`~`v0.8.x`)이 열어도 손상 화면이 뜨지 않고, UI 선호(테마·보기)도 기본값으로 바뀌지 않는다(§5).
8. F5(당일 모드)가 연산 하나(`setVisitedOn`)에 오늘 Day의 날짜(04:00 경계 반영)를 넘겨 "다녀옴 체크"·풀기·되돌리기를 할 수 있다. 기기 날짜를 쓰는 `markVisitedToday`는 장소 상세·일괄 편집이 쓴다(§6.3).

### 1.3 지금 있는 것 (2026-10-16 `main` `942e77b` 기준, 읽어서 확인)

- `PlaceSchema`(`src/schema/library.ts`): 필드 12개. 바뀌는 값은 `FieldSchema` = `{ value, updatedAt }`(LWW).
- 편집 연산(`src/domain/library/ops.ts`): 입력을 바꾸지 않는 순수 함수. 바뀐 필드만 `updatedAt = ctx.now`. `setField`(`lww.ts`)가 값이 같으면 같은 참조를 돌려준다. `useLibraryAction().run(op)`이 `LibraryStore.update` 안에서 **저장된 최신본**에 연산을 적용하므로, 두 탭이 서로 다른 필드를 고쳐도 둘 다 남는다(필드 단위 LWW). `pickField`는 지금 쓰는 곳이 없다(시험만).
- 날짜 스키마는 `CalendarDate`(`src/schema/common.ts`, `YYYY-MM-DD` + 실제 달력 날짜). **`IsoDate`라는 이름은 없다** — C1의 `IsoDate`는 `CalendarDate`를 뜻하는 것으로 본다.
- 이 기기의 오늘: `localToday()`(`src/domain/trips/query.ts`).
- 보관함 조건 `LibraryQuery`(`src/domain/library/query.ts`)는 UI 선호(`tripmap:prefs`의 `query`)에 저장된다. 선호를 읽다 검증에 실패하면 **선호 전체가 기본값**이 된다(`src/services/prefs-store.ts` `readPrefs`).
- 지도 마커 글자는 `createMarkerLabelElement`(`src/components/map/marker-label.ts`) 하나를 네이버·가짜 어댑터가 함께 쓴다. 공유 지도 페이지(`src/share-map/map.ts`)도 `placeMarker`를 쓴다.

## 2. 범위

### 2.1 하는 것

- C1 필드 두 개(`visitedOn`, `review`)와 편집 연산.
- 장소 상세의 `다녀옴`·`한 줄 평` 칸.
- 목록 행·카드·지도 핀의 다녀옴 표시. 카드에는 한 줄 평도 보인다.
- 보관함 조건에 방문 필터(저장함), `다녀온 날순` 정렬(메모리에만). 검색이 한 줄 평도 찾는다.
- 일괄 편집 `다녀옴` 메뉴(오늘 다녀옴으로 표시 · 다녀옴 표시 지우기).
- F5가 부를 연산(§6.3).

### 2.2 안 하는 것

- **공유 형식(v1)은 그대로.** 내보낸 공유 파일에 다녀옴·평은 들어가지 않는다. 넣을지는 F7에 넘긴다(§12 D11).
- 여러 번 다녀온 기록(방문 이력), 별점, 사진.
- 여행 계획 화면의 후보·Day 목록과 계획 지도 핀의 다녀옴 표시(당일 모드 F5가 정한다). 계획 화면 안의 장소 상세는 같은 컴포넌트라 `다녀옴`·`한 줄 평` 칸이 그대로 보인다.
- 여행이 끝나면 자동으로 다녀옴 처리.
- 모르는 필드를 보존하는 저장(§12 D10).

## 3. 데이터 (C1 정의)

### 3.1 스키마

`src/schema/library.ts`의 `PlaceSchema`에 선택 필드 두 개를 더한다. `schemaVersion`은 2 그대로다.

```ts
visitedOn: Schema.optional(FieldSchema(Schema.NullOr(CalendarDate))),
review: Schema.optional(
  FieldSchema(Schema.String.check(Schema.isMaxLength(LIBRARY_LIMITS.reviewChars))),
),
```

- `LIBRARY_LIMITS.reviewChars = 140`(`src/schema/library-base.ts`). 길이는 `String.length`(UTF-16 단위)다. 브라우저 `maxlength`도 같은 단위라 입력칸과 검증이 어긋나지 않는다. 이모지 하나는 2로 센다.
- 타입: `visitedOn?: { value: string | null; updatedAt: string } | undefined`, `review?: { value: string; updatedAt: string } | undefined`.

### 3.2 의미

| 상태 | `visitedOn` | 뜻 |
|---|---|---|
| 한 번도 표시 안 함 | 키 없음 | 안 가 봄 |
| 다녀옴 | `{ value: '2026-10-16', updatedAt }` | 가장 최근에 다녀온 날 |
| 표시를 지움 | `{ value: null, updatedAt }` | 안 가 봄(지운 시각을 남겨 LWW가 동작) |

- `visitedOn`은 **가장 최근에 다녀온 날 하나**다. 이력이 아니다.
- `review` 키 없음과 `{ value: '' }`는 같은 뜻(평 없음)이다.
- 두 필드는 서로 독립이다. 안 가 본 곳에도 평을 남길 수 있고(예: "친구 추천"), 다녀옴을 지워도 평은 남는다(§12 D3·D4).
- 지운 장소(`deletedAt`)를 다시 저장해 되살리면 두 필드는 남아 있다(기존 되살리기가 장소를 펼쳐 복사하므로).
- 날짜는 **이 기기의 시간대**로 본 날이다. 저장 시각(`updatedAt`)은 UTC다.
- 새로 만드는 장소(링크·폴더·핀·공유 가져오기·옛 여행 가져오기)는 두 키를 넣지 않는다.

### 3.3 LWW와 "없음"

- 편집 연산은 `setOptionalField(f, value, empty, now)`(`lww.ts`)를 쓴다. 키가 없고 새 값이 빈 값(`visitedOn`은 `null`, `review`는 `''`)이면 **키를 만들지 않는다**(문서가 쓸데없이 바뀌지 않게). 그 밖에는 `setField`와 같다.
- 나중에 두 문서를 합치는 코드가 생기면(복원 합치기 등) "키 없음"은 **어떤 `updatedAt`보다 오래된 빈 값**으로 본다. 이번 묶음에는 합치는 코드가 없다.

### 3.4 편집 연산 (`src/domain/library/ops.ts`)

| 연산 | 하는 일 | 돌려주는 것 |
|---|---|---|
| `setVisitedOn(lib, dates, ctx)` | `dates: Record<장소 id, 'YYYY-MM-DD' \| null>`를 그대로 넣는다. 날짜 고치기·지우기·되돌리기 | `OpResult`. 틀린 날짜면 `VisitDateInvalid` |
| `markVisited(lib, placeIds, date, ctx)` | 다녀옴 표시. 이미 더 늦은 날이 있으면 그대로 둔다(가장 최근 날 유지) | `OpResult`. 틀린 날짜면 `VisitDateInvalid` |
| `markVisitedToday(lib, placeIds, ctx)` | `markVisited(…, localDateOf(ctx.now), …)` | `Library`(실패 없음) |
| `setPlaceReview(lib, placeId, review, ctx)` | 앞뒤 공백을 지우고 줄바꿈·연속 공백을 한 칸으로. 140자를 넘으면 거절 | `OpResult`. `ReviewTooLong`·`NotFound` |

- 공통: 없는 id·지운 장소는 건너뛴다(`setPlaceReview`는 `NotFound`). **`saved: false`(보관함에서 숨긴, 여행에만 있는) 장소는 바꾼다** — F5가 여행 장소를 체크한다.
- `OpError`에 `{ _tag: 'VisitDateInvalid'; date: string }`, `{ _tag: 'ReviewTooLong'; length: number }`를 더한다. 기존 `switch`들은 `default`가 있어 영향이 없다.
- 미래 날짜는 연산이 막지 않는다(연산은 UTC `ctx.now`만 알아 기기 날짜와 어긋날 수 있다). 화면이 막는다(§4.1).

### 3.5 도우미 (`src/domain/library/visit.ts`, 새 파일, React·Effect 없음)

- `visitedOnOf(place): string | null`, `isVisited(place): boolean`, `reviewOf(place): string`
- `localDateOf(iso: string): string` — UTC 시각을 이 기기 시간대의 `YYYY-MM-DD`로.
- `normalizeReview(text: string): string`
- `formatVisitDate(date: string): string` — `'2026-10-16'` → `'2026.10.16'`(앱의 다른 날짜 표기 `SharePreview`와 같은 모양).

## 4. 화면

### 4.1 장소 상세 (`src/sections/place/`)

`네이버 지도에서 열기` 아래, `라벨` 위에 두 칸을 둔다. 제목 단계는 다른 칸과 같다(`h2`, 여행 계획 안에서는 `h3`).

**다녀옴** (`VisitEditor`, 새 컴포넌트)

| 상태 | 보이는 것 |
|---|---|
| 안 가 봄 | 버튼 `✓ 다녀왔어요`(44px, 테두리 버튼). 누르면 오늘 날짜로 표시 |
| 다녀옴 | 체크 아이콘 · 날짜 입력칸(`type="date"`, 이름 `다녀온 날`, `max`=오늘, `fieldSx()`) · 버튼 `다녀옴 취소` |

- 날짜를 바꾸면 `change` 때 바로 저장한다(휴대폰 날짜 고르기 창은 `완료` 때 `change`가 온다).
- 입력칸을 비우면(브라우저의 지우기) 저장하지 않고 저장된 날짜로 돌아간다.
- 오늘보다 늦은 날을 직접 입력하면 저장하지 않고 칸 아래에 `role="alert"`로 `오늘 이후 날짜는 고를 수 없어요`.
- `다녀옴 취소` → 토스트 `다녀옴 표시를 지웠어요` + `되돌리기`(지우기 전 날짜로, `UNDO_MS` 5초).

**한 줄 평**

- 기존 `EditableText`(눌러서 고치는 한 줄 글)를 쓴다. 이름 `한 줄 평`, 빈 값 안내 `한 줄 평 남기기 (140자까지)`, 빈 값 저장 허용.
- `EditableText`에 선택 prop `maxLength`를 더해 입력칸 `maxLength`에 넣는다(브라우저가 140자에서 멈춘다. 붙여넣기도 잘린다).
- 저장 실패는 다른 칸처럼 `run`이 토스트로 알린다.

### 4.2 목록 행·카드 (`src/sections/library/`)

- **행**(`PlaceRow`): 이름 바로 뒤에 16px 체크 아이콘(`--tm-accent-text`, `aria-hidden`)과 화면에 안 보이는 글자 `다녀옴`(`visuallyHidden`). 행 버튼의 접근성 이름이 `경포대 다녀옴 바다 강릉`처럼 된다. 날짜·평은 행에 넣지 않는다(좁은 화면 폭).
- **카드**(`PlaceCard`): 아래 줄(지역·라벨)의 맨 앞에 `✓ 다녀옴 2026.10.16` 배지(`data-part="visited"`). 메모 아래에 평을 `“…”`로 2줄까지(`data-part="review"`, 14px, `text.secondary`).
- 벤토·타일은 블록 아래 목록이 행이라 같은 표시가 보인다.

### 4.3 지도 핀

- 다녀온 곳의 마커 글자 앞에 `✓ `를 붙인다(`✓ 경포대`). 마커 `title`은 `경포대 · 다녀옴`.
- 색·흐림·묶음(클러스터)은 바꾸지 않는다. 흐림(`dimmed`)은 여행 계획이 다른 뜻으로 쓰고, 색은 라벨 색이다.
- `MapMarker`에 선택 필드 `visited?: boolean`, `MarkerLabelOptions`에 `visited?: boolean`. 가짜 어댑터의 다시 그리기 비교 키에 `visited`를 더한다. 공유 지도 페이지는 값을 주지 않으므로 그대로다.

### 4.4 방문 필터 칩

- 라벨 칩 줄의 맨 앞에 칩 두 개: `안 가 본 곳 N` · `가 본 곳 N`. 그 뒤에 얇은 세로 구분선, 그다음 기존 `모두 포함`·`미분류`·라벨들.
- 둘 중 하나만 켤 수 있다. 켜진 칩을 다시 누르면 `전체`로 돌아간다.
- **보이는 조건**: 보관함에 다녀온 곳(살아 있고 `saved: true`)이 하나라도 있거나, 방문 필터가 켜져 있을 때. 기능을 쓰지 않는 사람의 화면은 바뀌지 않는다(§12 D5).
- 숫자는 검색·지역·라벨 조건을 적용하고 방문 조건은 빼고 센다(라벨 칩과 같은 규칙). 라벨·지역 칩 숫자는 방문 조건을 적용한다.
- 좁은 화면의 지도(`/map`)도 같은 칩 줄을 쓴다(`LibraryMap`이 이미 `LabelChips`를 쓴다).
- 접근성 구조: 칩 줄 바깥 상자(가로 스크롤)에 `role="group" aria-label="방문"` 묶음과 기존 `role="group" aria-label="라벨"` 묶음을 나란히 둔다. 칩은 기존 `ChipButton`(`aria-pressed`, 44px).
- 필터를 켜면 지도는 기존처럼 새 조건에 맞춘다(`fitKey`가 조건 전체다).
- `필터 지우기`(빈 목록 안내)는 방문 필터도 푼다(`DEFAULT_QUERY`).
- 폴더 가져오기·공유 가져오기가 끝나 목록을 새 라벨로 거를 때 방문 필터도 `전체`로 푼다(새 장소는 안 가 본 곳이라 `가 본 곳`에서 사라지므로).

### 4.5 정렬

- 정렬 메뉴에 `다녀온 날순`을 더한다(`최근 저장순`·`이름순`·`라벨순` 다음).
- 다녀온 날이 늦은 곳이 앞, 같으면 최근 저장순. 안 가 본 곳은 뒤에 최근 저장순.
- **저장하지 않는다**(조정자 판정 A, §5.4·§12 D6). `LibraryQuery.sort`(`tripmap:prefs`에 저장되는 값)는 이전 정렬 그대로 두고, 메모리 atom `visitedSortAtom`(`src/stores/visit-sort.ts`, 처음 `false`)이 켜져 있을 때만 목록을 `sortByVisited`로 다시 늘어놓는다. 정렬 단추 글자는 켜져 있으면 `다녀온 날순`. 다른 정렬을 고르면 꺼진다. 새로고침·탭 닫기로 꺼진다. F4의 `가까운 순`과 같은 방식이다(F4가 병합되면 둘 중 하나만 켜진다 — F4 설계서 §4.2).

### 4.6 일괄 편집

- 하단 바(`BulkBar`)에 `다녀옴` 버튼(체크 아이콘, `aria-haspopup="menu"`)을 `여행에 넣기` 앞에 둔다. 메뉴: `오늘 다녀옴으로 표시` · `다녀옴 표시 지우기`(고른 곳 중 다녀온 곳이 없으면 비활성).
- 결과 토스트(5초 `되돌리기`): `N곳을 오늘 다녀옴으로 표시했어요` / `N곳의 다녀옴 표시를 지웠어요`. N은 저장된 최신본에서 실제로 바뀐 곳 수다(삭제 되돌리기와 같은 방식). 바뀐 곳이 없으면 `이미 다녀옴으로 표시돼 있어요`(되돌리기 없음).
- 되돌리기는 바뀐 곳마다 이전 값을 `setVisitedOn`으로 넣는다.
- 선택은 유지한다(라벨 붙이기와 같다). `가 본 곳` 필터에서 표시를 지우면 그 곳들은 목록에서 빠지고 선택도 따라 빠진다(기존 규칙).

### 4.7 화면 크기별

| 폭 | 차이 |
|---|---|
| 좁음(<768) | 장소 상세는 시트 안. 칩 줄은 가로 스크롤. 하단 바는 줄바꿈(`flexWrap`)되어 버튼 하나가 늘어도 넘치지 않는다. 날짜 입력칸은 폭 100%, `다녀옴 취소`는 그 아래 줄로 내려갈 수 있다(`flexWrap`) |
| 중간(768~1279) | 상세가 지도 오른쪽을 덮는 칸. 차이 없음 |
| 넓음(≥1280) | 3단. 차이 없음 |

### 4.8 새 화면 문구 (이것뿐)

`다녀옴`(칸 제목·숨은 행 글자·일괄 버튼) · `다녀왔어요` · `다녀온 날` · `다녀옴 취소` · `오늘 이후 날짜는 고를 수 없어요` · `다녀옴 표시를 지웠어요` · `한 줄 평` · `한 줄 평 남기기 (140자까지)` · `방문`(칩 묶음 이름) · `안 가 본 곳` · `가 본 곳` · `다녀온 날순` · `오늘 다녀옴으로 표시` · `다녀옴 표시 지우기` · `N곳을 오늘 다녀옴으로 표시했어요` · `N곳의 다녀옴 표시를 지웠어요` · `이미 다녀옴으로 표시돼 있어요` · 내보내기 대상 문구 꼬리 ` (가 본 곳만)` / ` (안 가 본 곳만)` · 카드 배지 `다녀옴 2026.10.16` · 마커 title `<이름> · 다녀옴`.

검색칸 안내(`이름·주소·메모·라벨 검색`)는 바꾸지 않는다(§12 D9).

## 5. 저장 형식 호환과 롤백

### 5.1 코드로 확인한 것 (2026-10-16)

- 보관함 읽기·쓰기는 `v0.3.0`부터 `v0.7.2`까지 같은 경로다(`git show <태그>:…`로 `v0.3.0`·`v0.7.0`·지금 `main`을 읽어 확인).
  - 읽기: `parseLibrary` → `safeParse(LibrarySchema, json)`(`src/services/library-store.ts`).
  - `safeParse`는 `Schema.decodeUnknownExit(schema)(value, { errors: 'all' })`이고 `onExcessProperty`를 넘기지 않는다(`src/schema/parse.ts`).
  - Effect는 세 태그 모두 `4.0.2`(고정). `node_modules/effect/src/SchemaAST.ts`의 `ParseOptions` 설명: `onExcessProperty` 기본값 `"ignore"`는 **모르는 키를 지운다**(strip). `"error"`일 때만 실패한다. `"preserve"`는 4.0.2에 없다.
  - 쓰기: `update`가 저장소에서 다시 읽어(위 parse) 연산을 적용하고, 결과를 다시 `safeParse`한 `parsed.data`를 `JSON.stringify`해 쓴다.
- `v0.8.0`(F1)은 보관함 parse 경로를 바꾸지 않는다(F1 설계서 `2026-10-16-backup-restore-design.md` §3.5가 같은 사실을 확인해 적었다. 구현 전이라 병합본에서 한 번 더 본다). F1의 백업 파일은 `library`에 **저장소 원문을 `JSON.parse`한 값**을 그대로 담는다(같은 문서 §3.1).

### 5.2 옛 버전(`v0.3.0`~`v0.8.x`)에서 일어나는 일

| 상황 | 결과 |
|---|---|
| 새 필드가 있는 문서를 연다 | ✅ 손상 화면 없음. 모르는 키라 지워진 채로 화면에 보인다(다녀옴·평은 안 보임). 저장소의 원문은 그대로 |
| 그 상태로 무엇이든 고친다(메모·라벨·장소 추가·여행 편집·되돌리기 등 `update`를 부르는 모든 것) | ⚠️ **모든 장소의 `visitedOn`·`review`가 사라진 채로 다시 저장된다**. 다시 `v0.9.0`으로 와도 돌아오지 않는다 |
| 고치지 않고 다시 `v0.9.0`으로 온다 | ✅ 그대로 남아 있다 |
| 다른 탭이 새 버전, 이 탭이 옛 버전 | 옛 탭이 고치는 순간 위와 같이 사라진다 |
| UI 선호에 `query.visited`가 있다 | ✅ 모르는 키라 지워진다(`v0.3.0`·`v0.7.2`·`main`의 `readPrefs`가 옵션 없이 `safeParse(PrefsSchema, …)`, `LibraryQuerySchema`는 `Struct` — 2026-10-16 `git show`로 확인). 선호 검증은 통과하므로 테마·보기는 그대로다. 옛 버전이 선호를 저장하면 방문 필터가 `전체`로 돌아간다 |
| `다녀온 날순` 정렬 | ✅ 저장하지 않으므로(§4.5) 옛 버전과 상관없다 |
| F1 백업 파일 | 백업 파일 안에는 두 필드가 남는다(원문 그대로). `v0.9.0`에서 만든 백업을 `v0.8.x`에서 되살리면 F1의 모르는 정보 경고(`droppedUnknown`, F1 §3.2 7번)가 뜨고 두 필드 없이 되살아난다. 선호의 `query.visited`는 조용히 지워지고 나머지 선호는 쓰인다(F1 §3.2 8번 — 되살릴 때 `query`는 어차피 기본값) |

### 5.3 롤백 표에 쓸 문장 (`docs/rollback.md`)

> | `v0.9.0` | `<병합 커밋>` | 다녀온 곳·한 줄 평: 장소 상세의 다녀옴·한 줄 평, 방문 필터 칩·다녀온 날순, 목록·지도 표시, 일괄 다녀옴 (#N) | ✅ 그대로 읽음. ⚠️ `v0.8.x` 이하에서 보관함을 한 번이라도 고치면 모든 장소의 다녀온 날·한 줄 평이 지워진다(고치지 않고 다시 올리면 남아 있다) |

표 아래 설명 목록에 한 줄: "`v0.9.0`부터 장소에 선택 필드(`visitedOn`·`review`)가 있다. 옛 버전은 이 필드를 몰라 읽을 때 버리고, 고쳐서 저장할 때 지운다. 되돌릴 일이 있으면 되돌리기 전에 설정 → 백업 받기(F1)를 먼저 한다." 그리고 F2가 처음으로 저장 형식에 선택 필드를 더하므로, 지금 목록의 "`v0.3.0` 이후로는 저장 형식이 바뀌지 않아…" 문장을 "`v0.3.0`~`v0.8.x` 사이는 저장 형식이 같고, 그 뒤로는 선택 필드만 더했다(옛 버전은 모르는 필드를 손상으로 보지 않고 떼어 낸다)"로 고친다(F3 계획 Task 8이 이 문장에 `folders`를 더한다).

### 5.4 UI 선호 호환

- `LibraryQuerySchema`(`src/schema/prefs.ts`)에 `visited: Schema.Literals(['all', 'unvisited', 'visited']).pipe(Schema.withDecodingDefault(Effect.succeed('all' as const)))`. 키가 없는 지금의 선호도 그대로 통과한다(선호 전체가 기본값으로 돌아가지 않는다). 옛 버전은 이 키를 모르는 키로 지우고 검증을 통과한다(§5.2) — 새 **선택 키**는 괜찮다.
- **`sort` 리터럴에는 값을 더하지 않는다**(조정자 판정 A). 영구 저장하는 선호의 리터럴 유니온에 새 값을 넣으면, 옛 버전의 `readPrefs`가 그 값을 읽을 때 `PrefsSchema` 검증이 실패해 **선호 전체**(테마·보기 방식까지)가 기본값이 된다(`src/services/prefs-store.ts`의 `readPrefs`: `parsed.success ? parsed.data : freshDefaults()`). 그래서 `다녀온 날순`은 메모리 atom으로 둔다(§4.5). F4의 `가까운 순`과 같은 이유·같은 방식이다.

## 6. 구조

### 6.1 파일

| 파일 | 바뀌는 것 |
|---|---|
| `src/schema/library-base.ts` | `LIBRARY_LIMITS.reviewChars` |
| `src/schema/library.ts` | `PlaceSchema`에 `visitedOn`·`review` |
| `src/domain/library/lww.ts` | `setOptionalField` |
| `src/domain/library/visit.ts` (새) | §3.5 도우미 |
| `src/domain/library/ops.ts` | §3.4 연산, `OpError` 두 개 |
| `src/domain/library/query.ts` | `LibraryQuery.visited`, `sortByVisited`, `visitCounts`, `hasVisited`, 검색에 평 |
| `src/schema/prefs.ts` | §5.4(`query.visited`만. `sort`는 그대로) |
| `src/stores/visit-sort.ts` (새) | `visitedSortAtom`(메모리, 저장 안 함) |
| `src/sections/share-export/export-targets.ts` | 대상 문구 꼬리 |
| `src/sections/add-place/FolderList.tsx`, `src/sections/share-import/SharePreview.tsx` | 가져온 뒤 `visited: 'all'` |
| `src/sections/place/VisitEditor.tsx` (새), `PlaceDetail.tsx`, `EditableText.tsx` | §4.1 |
| `src/sections/library/PlaceRow.tsx`, `PlaceCard.tsx` | §4.2 |
| `src/components/map/MapAdapter.ts`, `marker-label.ts`, `FakeMapAdapter.ts`, `src/sections/map/markers.ts` | §4.3 |
| `src/sections/library/VisitChips.tsx` (새), `LabelChips.tsx`, `FilterBar.tsx`, `SortMenu.tsx`, `LibraryPage.tsx`, `src/sections/map/LibraryMap.tsx` | §4.4·§4.5 |
| `src/sections/library/BulkBar.tsx`, `LibraryPage.tsx` | §4.6 |

### 6.2 인터페이스

```ts
// src/domain/library/visit.ts
export function visitedOnOf(place: Place): string | null;
export function isVisited(place: Place): boolean;
export function reviewOf(place: Place): string;
export function localDateOf(iso: string): string;
export function normalizeReview(text: string): string;
export function formatVisitDate(date: string): string;

// src/domain/library/lww.ts
export function setOptionalField<T>(
  f: Field<T> | undefined, value: T, empty: T, now: string,
): Field<T> | undefined;

// src/domain/library/ops.ts
export function setVisitedOn(
  lib: Library, dates: Readonly<Record<string, string | null>>, ctx: OpCtx,
): OpResult;
export function markVisited(
  lib: Library, placeIds: readonly string[], date: string, ctx: OpCtx,
): OpResult;
export function markVisitedToday(lib: Library, placeIds: readonly string[], ctx: OpCtx): Library;
export function setPlaceReview(lib: Library, placeId: string, review: string, ctx: OpCtx): OpResult;

// src/domain/library/query.ts
export type VisitFilter = 'all' | 'unvisited' | 'visited';
// LibraryQuery에 visited: VisitFilter. sort는 'recent' | 'name' | 'label' 그대로(판정 A)
export function visitCounts(lib: Library, q: LibraryQuery): { visited: number; unvisited: number };
export function hasVisited(lib: Library): boolean;
/** 다녀온 날 내림차순(같으면 최근 저장순), 안 가 본 곳은 뒤에 최근 저장순. 입력을 바꾸지 않는다. */
export function sortByVisited(places: readonly Place[]): Place[];

// src/stores/visit-sort.ts
export const visitedSortAtom: PrimitiveAtom<boolean>; // 처음 false, 저장하지 않는다
```

### 6.3 F5(당일 모드)가 쓰는 법

- **F5가 쓰는 것(조정자 판정 B)**: `run((lib, ctx) => setVisitedOn(lib, { [placeId]: date }, ctx))`. `date`는 F5가 정한 **오늘 Day의 날짜**(04:00 전이고 어제가 여행 기간이면 어제 — F5 설계서 §4.1·§4.4), 풀기는 `null`. 둘 다 이 연산 하나로 된다. `markVisited`(늦은 날 유지)는 쓰지 않는다 — 새벽 경계로 어제 날짜를 쓸 때 오늘 날짜가 이미 있으면 바뀌지 않기 때문이다.
- **다른 화면이 쓰는 것**: `markVisitedToday(lib, [placeId], ctx)` — 기기 날짜(자정 경계). 오늘은 `ctx.now`(Effect `Clock`, 기본은 `Date.now()`)의 기기 날짜라 시험에서 시계를 고정할 수 있다. 장소 상세의 `다녀왔어요`와 일괄 편집이 이것을 쓴다. F5는 쓰지 않는다.
- 되돌리기: 쓰기 전에 연산 안에서 `visitedOnOf(lib.places[id])`를 읽어 두었다가 `setVisitedOn(lib, { [id]: prev }, ctx)`. "그사이 다른 탭이 바꿨으면 하지 않기"는 되돌리기 연산 안에서 지금 값과 내가 쓴 값을 비교해 다르면 `lib`를 그대로 돌려주면 된다.
- 읽기: `visitedOnOf(place)`·`isVisited(place)`. "이 여행 기간 안" 판정은 F5가 한다.
- 두 화면의 "오늘"이 다를 수 있다(장소 상세는 자정 경계, 당일 모드는 04:00 경계). 저장되는 값은 둘 다 그냥 날짜라 섞여도 문제없다.
- 여행에만 있는 장소(`saved: false`)도 체크된다(§3.4).

## 7. 오류 처리

| 경우 | 동작 |
|---|---|
| 저장 실패(용량·잠금·손상) | 기존처럼 `run`이 토스트. 화면 값은 저장된 값으로 남는다 |
| `VisitDateInvalid` | 화면은 틀린 날짜를 보내지 않는다(입력칸 값이 비면 저장 안 함). 오면 `run` 결과 `ok: false`, 아무것도 안 바뀐다 |
| 미래 날짜 직접 입력 | 저장하지 않고 `오늘 이후 날짜는 고를 수 없어요` |
| `ReviewTooLong` | 입력칸 `maxLength`로 생기지 않는다. 오면 `EditableText`가 원래 값으로 돌아간다 |
| 다른 탭이 같은 장소의 다녀옴을 바꿈 | 다른 탭 변경 구독으로 화면이 바뀐다. 마지막에 쓴 쪽이 남는다(필드 단위) |
| 고치는 사이 장소가 지워짐 | 연산이 건너뛴다. 상세는 `장소를 찾을 수 없어요` |

## 8. 시험

### 8.1 단위 (Vitest)

- 스키마: 두 필드가 없는 문서·있는 문서 통과, 없는 문서는 decode·저장 뒤에도 키가 생기지 않음(JSON이 같다), `2026-02-30`·`2026-1-5`·141자 평·숫자 평 거절, 장소에 모르는 키가 있으면 통과하고 결과에서 지워짐(옛 버전 동작의 근거를 고정).
- `LibraryStore`: `visitedOn`·`review`가 있는 문서에 메모를 고쳐도 두 필드가 남는다.
- F1 백업 시험: F1은 "모르는 필드" 예로 처음부터 `futureField`를 쓴다(교차 검토에서 F1 계획을 고침). F2는 `visitedOn`·`review`가 든 백업이 `droppedUnknown: false`로 그대로 읽히는 시험 한 건만 더한다.
- 선호: `PrefsSchema`의 `sort` 리터럴이 `recent|name|label` 그대로이고(판정 A), `visitedSortAtom`을 켠 채 기다려도 `tripmap:prefs`의 `sort`가 이전 값.
- 연산: §3.4 표의 모든 줄, `setOptionalField`의 "키 없음 + 빈 값 = 그대로", 같은 값이면 같은 참조, `markVisited`가 더 늦은 날을 지킴, `saved: false` 장소도 바뀜, 지운 장소는 건너뜀.
- `localDateOf`: 시간대와 무관하게 시험한다(입력을 `new Date(2026, 9, 16, 0, 30).toISOString()`처럼 기기 시각으로 만들고 `'2026-10-16'` 기대).
- 조건: 방문 필터 세 값, `visitCounts`, 라벨·지역 숫자에 방문 조건 적용, `sortByVisited`, 검색이 평을 찾음, 키 없는 옛 선호 → `visited: 'all'`이고 테마가 그대로.
- 화면: 상세의 표시·날짜 바꾸기·미래 날짜·취소+되돌리기·평 저장·140자, 행의 숨은 `다녀옴`, 카드 배지·평, 마커 `✓`·title, 칩의 보이는 조건·숫자·토글, 정렬 메뉴, 일괄 메뉴·토스트·되돌리기, 내보내기 대상 문구.

### 8.2 E2E (Playwright, 새 `tests/e2e/visited-review.spec.ts`, 세 프로젝트)

- 데스크톱: 경포대 상세 → `다녀왔어요` → 날짜 칸이 오늘(Asia/Seoul) → 날짜를 바꿈 → 평 저장 → `가 본 곳 1` → 목록 1줄·마커 `✓ 경포대` → `다녀온 날순` → 새로고침 뒤에도 다녀옴·평·방문 필터는 유지되고 정렬은 저장된 정렬(`최근 저장순`)로 돌아온다.
- 휴대폰(iphone·galaxy): 시트에서 `다녀왔어요`·평 → 카드 보기에서 배지와 평.
- 호환: 시드의 한 장소에 두 필드를 넣어 심고 열면 손상 화면 없이 그 장소가 `가 본 곳`에 있다.

## 9. 첫 로딩 예산

- 바뀌는 곳이 모두 첫 화면(보관함·지도·장소 상세)이라 나누지 않는다. 새 라이브러리 없음(날짜는 브라우저 `type="date"`, 아이콘은 이미 있는 `CheckIcon`).
- 늘어나는 양은 작다고 본다(컴포넌트 2개·연산 몇 개). 정확한 값은 구현 때 `yarn size`로 잰다 — **확인 필요**. 2026-10-14 측정 297,769 B, 상한 327,680 B(F1이 먼저 쓰는 양은 모른다).

## 10. 접근성 (D3 기준)

- 새 버튼·칩·메뉴 항목·입력칸은 44px, 한국어 이름(§4.8). 입력칸은 `fieldSx()`.
- 포커스 표시는 테마 전역 규칙(`src/theme/focus-ring.ts`). 칩은 기존 `ChipButton`이 보이는 알약에 그린다.
- 체크 아이콘은 `--tm-accent-text`(D3에서 여섯 테마의 `bg`·`bg.surface`·`bg.raised` 위 4.5:1을 맞춘 색)라 그림 대비 3:1을 넘는다. 선택된 행 바탕(`bg.raised`)에서도 같다.
- 다녀옴은 색만으로 알리지 않는다: 행은 숨은 글자, 카드는 글자 배지, 마커는 글자 `✓`와 `title`.
- 칸 제목은 기존 `Section`(`h2`/`h3`). 새 `h1` 없음. 탭 제목은 그대로.
- 미래 날짜 안내는 `role="alert"`, 입력칸 `aria-describedby`로 잇는다.

## 11. 묶음 사이 약속과의 관계

- **C1(주인)**: 정의는 §3. 약속과 다른 점은 이름뿐이다 — `IsoDate` → 지금 있는 `CalendarDate`, `isMaxLength(140)` → `Schema.isMaxLength(LIBRARY_LIMITS.reviewChars)`.
- **F5**: §6.3의 연산·도우미만 쓴다. 당일 모드의 "다녀옴 체크"는 같은 필드라 보관함의 방문 필터에 바로 보인다. F5 설계서의 이름 확인 질문(`visitedOn` 편집 연산 이름)에 대한 답이 §6.2다. F5에 바라는 것: 체크·풀기에 `setVisitedOn`을 쓰기(§6.3 첫 줄의 이유).
- **F1(C3)**: 백업은 원문을 그대로 담으므로 따로 할 일이 없다. 다만 F1의 시험이 `visitedOn`을 "이 버전이 모르는 필드"의 예로 쓴다(F1 계획 Task 1·2·5). F2가 병합되면 그 예는 더 이상 모르는 필드가 아니므로 **교차 검토에서 F1 계획이 처음부터 `futureField`를 쓰게 고쳤으므로 F2는 `visitedOn`이 보존되는 시험만 더한다**(계획 Task 1). F1이 바란 알림: F2는 `PrefsSchema`에 선택 키 `query.visited`(디코드 기본값 `all`)만 더한다. `sort`에는 값을 더하지 않는다(판정 A, §5.4). F1 백업의 `prefs`에 `query.visited`가 들어가고, `v0.8.0`이 그 백업을 읽으면 그 키만 지운다.
- **F7(C4)**: v1은 손대지 않는다. v2에 평을 넣을지는 §12 D11 제안.
- **C2·C5·C6**: 관계없음. F4의 `MapAdapter.setMyLocation`과 같은 파일(`MapAdapter.ts`)의 `MapMarker` 타입에 선택 필드를 더하므로 F4가 뒤에 병합될 때 글자 충돌만 날 수 있다.
- F3·F6이 장소에 선택 필드를 더하면 §5.2와 같은 일이 그 버전으로 되돌릴 때 생긴다(§12 D10).

## 12. 결정이 필요한 것

각 항목은 추천안으로 설계했다. 바꾸면 해당 절과 계획의 작업 하나가 바뀐다.

| # | 항목 | 선택지 | 추천 | 이유 |
|---|---|---|---|---|
| D1 | 다녀옴 데이터 모양 | (a) 가장 최근 날짜 하나(C1) (b) 날짜 배열(이력) | (a) | C1 약속 그대로. 필터·정렬·F5 체크에 충분하다. 이력은 LWW로 합치기 어렵다 |
| D2 | 미래 날짜 | (a) 화면에서 막음 (b) 허용 | (a) | "다녀옴"의 뜻에 맞다. 연산은 기기 날짜를 몰라 막지 않는다 |
| D3 | 안 가 본 곳의 한 줄 평 | (a) 허용(독립) (b) 다녀온 곳만 | (a) | "친구 추천" 같은 쓰임. 화면이 단순하다 |
| D4 | 다녀옴 취소 때 평 | (a) 남김 (b) 같이 지움 | (a) | 실수로 취소해도 글을 잃지 않는다. 되돌리기도 날짜만 다루면 된다 |
| D5 | 방문 칩 자리와 보이는 조건 | (a) 라벨 칩 줄 맨 앞, 다녀온 곳이 있을 때만 (b) 늘 보임 (c) 칩 줄 하나 더 (d) 줄 끝 | (a) | 쓰지 않는 사람 화면은 그대로, 쓰는 사람에게는 첫눈에 보인다. 좁은 화면 높이를 늘리지 않는다 |
| D6 | `다녀온 날순` 정렬 | (a) 넣음, 메모리 atom(저장 안 함) (b) 안 넣음 ~~(c) `tripmap:prefs`의 `sort`에 저장~~ | (a) | **조정자 판정 A로 (c)는 쓰지 않는다**: 영구 저장하는 선호의 리터럴 유니온(`sort`)에 새 값을 더하면 옛 버전의 `readPrefs`가 검증에 실패해 테마·보기까지 기본값이 된다(F4가 코드로 확인). "최근 다녀온 곳" 보기는 필요하므로 F4 `가까운 순`처럼 메모리에만 둔다. 대가: 새로고침하면 저장된 정렬로 돌아간다. 이것도 번거로우면 (b) |
| D7 | 지도 핀 표시 | (a) 이름 앞 `✓` (b) 다녀온 곳 흐리게 (c) 테두리 색 | (a) | 두 어댑터가 함께 쓰는 글자 함수 한 곳만 바뀐다. 흐림·테두리는 이미 다른 뜻(계획·선택)이다 |
| D8 | 일괄 편집에 다녀옴 | (a) 넣음(오늘 표시·지우기) (b) 안 넣음 | (a) | 여행 뒤 여러 곳을 한 번에 표시하는 일이 흔하다. 날짜 고르기는 넣지 않는다(오늘만) |
| D9 | 검색에 평 | (a) 찾음, 안내 문구 그대로 (b) 찾음, 안내를 `이름·주소·메모·평·라벨 검색`으로 (c) 안 찾음 | (a) | 메모를 찾는 것과 같은 기대. 안내가 길어지면 좁은 화면에서 잘린다 |
| D10 | 모르는 필드 보존(앞으로의 롤백 대비) | (a) 이번엔 안 함 (b) `PlaceSchema`를 `StructWithRest`로 바꿔 모르는 키를 남김 | (a) | 옛 버전(`v0.8.x` 이하)에는 효과가 없다. 장소 타입이 느슨해져(아무 키나 `unknown`) 실수를 못 잡는다. 지금 설계서로는 F6은 장소 필드를 더하지 않고, F3은 보관함 최상위에 선택 컬렉션 `folders`를 제안한다(같은 일이 최상위에서 생긴다). F3이 그렇게 정하면 그때 최상위까지 함께 본다 |
| D11 | 공유 파일에 평 (F7에 넘김) | (a) v2 장소에 선택 `review`, 따로 `내 한 줄 평도 담기` 스위치(기본 끔) (b) v2 장소에 선택 `review`, 기존 `메모 포함`이 켜졌을 때 함께(F7 설계서의 안) (c) 담지 않음. 셋 다 `visitedOn`은 담지 않고, 받은 평은 가져오지 않는다 | F7의 (b)에 동의 | 메모도 같은 스위치로 나가므로 사용자가 헷갈리지 않는다. 평만 따로 막고 싶다는 요구가 생기면 (a)로 나눈다. 다녀온 날은 사적인 기록이고 받은 사람이 다녀온 것으로 보이면 안 되므로 뺀다 |
| D12 | 카드에 평 | (a) 메모 아래 2줄 (b) 안 보임 | (a) | 카드는 글을 보는 보기다. 행에는 폭이 없어 넣지 않는다 |
