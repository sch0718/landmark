# 여행 준비 1단계(MVP-①) 구현 계획

**목표:** 여행 문서에 준비 필드 세 개를 더하고, `/trips/:id/prep`에서 예약을 모아 보고 고친다.

**구조:** `Trip`의 선택 필드(필드 단위 LWW)로 저장해 동기화·백업·AI 편집을 그대로 쓴다. 화면은 지연 로딩 청크 하나.

**기술:** React 19·MUI, Effect v4 Schema, Cloudflare Pages Functions·D1, Vitest.

## 전역 제약

- 첫 로딩 JS gzip ≤ 328,704B(`perf-budget.json`, 기존 운영 측정값 327,844B). 이 기준값과의 증감 비교는 같은 Cloudflare Pages Production 빌드 환경(빌드에 영향을 주는 환경변수 포함)에서 잰 값으로 한다. 로컬·PR 빌드의 증감은 각각 같은 조건에서 잰 기준값과 비교한다([측정 조건과 운영 배포 기록](../../ui-performance.md)).
- 문서 하나 20만 자(`ITEM_DOC_MAX_CHARS`)는 올리지 않는다. 필드 상한 `bookings` 50,000·`prepNotes` 30,000·`phrases` 30,000자.
- `schemaVersion`(2)은 바꾸지 않는다. 공유·갱신 링크·함께 편집 문서에는 세 필드를 넣지 않는다.
- 화면 글은 한국어 해요체, 터치 대상 44px 이상, `~/.claude/rules/modern-web.md`.

- 기획서: [`../specs/2026-11-27-trip-prep-design.md`](../specs/2026-11-27-trip-prep-design.md) §4·§5.1·§5.2·§6 1단계·§9
- 전제: 사용자 1명(+동행), 여러 기기, Cloudflare 무료. 판단이 갈리면 작은 쪽.
- 범위 밖: 정보·문장 탭 내용, `speak.ts`, 당일 `오늘 예약`, 계획 화면 예약 배지, 외부 API, 릴리스.
- 진행: 아래 **A(저장·동기화·CLI·문서)** 와 **B(화면)** 를 Codex 두 번에 나눠 구현하고 A가 끝나면 커밋한다. 합쳐 2,000줄을 크게 넘으면 A·B를 PR 둘로 낸다.
- 규칙: `docs/convention.md`, Effect API는 `node_modules/effect/ai-docs`로 확인(기억으로 쓰지 않음). 시험은 동작을 지키는 만큼만, 같은 동작을 여러 층에서 겹쳐 시험하지 않는다.

## §9 검토 지적 처리

| 지적 | 처리 |
|---|---|
| 금액 `Schema.Finite` | 반영(`Schema.Finite` + 0 이상) |
| 당일 `오늘 예약`의 기준 Day | 2단계로 넘김 |
| 롤백 2단계에 `AI 변경 기록 › 되돌리기` 금지 | 반영(rollback.md) |
| 여행이 20만 자를 넘는 경우 안내 | 준비 화면에서 저장을 막고(되돌리기 포함) 「여행 문서가 너무 커요」. 일정 편집·수신 병합은 지금처럼 동기화 「올리지 못한 항목」 |
| AI 되돌리기가 정리된 묘비를 가리킴 | 하지 않음. `undoChanges`는 D1 장소 행을 확인하지 않아 복원은 성공하고, 그 장소가 없는 기기는 수신을 보류한다(`apply.ts`). 같은 경로가 지금 Stop 참조에도 있고(이번 기능이 새로 만들지 않음), 「90일 지난 묘비 + 마지막 참조 삭제 + 정리 + 30일 안 되돌리기」가 겹쳐야 해서 1인 전제에서 막는 장치를 붙이지 않는다 |
| 예약번호를 `library:read` 토큰으로 읽을 수 있고 이전 값이 AI 변경 기록·서버 백업에 남을 수 있음 | 처리방침과 AI 연결 안내에 함께 적음 |
| 공유 v2·v3 모두에서 빠짐 | 시험에 두 형식 모두 |

## A. 저장·동기화·CLI·문서

1. **스키마** `src/schema/trip.ts`, `src/schema/library-base.ts`
   - `LIBRARY_LIMITS`에 한도 추가: `bookingsMax 60`, `prepNotesMax 40`, `phrasesMax 150`, `bookingsChars 50_000`, `prepNotesChars 30_000`, `phrasesChars 30_000`과 각 글자 수(기획서 §4.1 값).
   - `BookingSchema`·`PrepNoteSchema`·`PhraseSchema`(§4.1 그대로). id는 `^[a-z0-9]{8}$`. 통화는 `^[A-Z]{3}$`. 금액은 `Schema.Finite` + `isGreaterThanOrEqualTo(0)`(정확한 이름은 ai-docs 확인).
   - `at`·`freeCancelUntil`은 `null` 또는 시간대 없는 `YYYY-MM-DDTHH:mm` 문자열이다. `T`로 나눈 결과가 정확히 두 부분이어야 하며, 각 부분을 `src/schema/common.ts`의 `CalendarDate`와 `HHmm`으로 순서대로 검사한다.
   - 예약 링크와 정보 출처 URL은 `https://`로 시작하고 500자 이하여야 한다. `new URL`로 파싱할 수 있고 `protocol`이 `https:`인지 확인한다.
   - `lang`은 2~12자이며 `Intl.getCanonicalLocales(lang)`가 예외 없이 통과해야 한다(브라우저·Workers 모두 있음).
   - `TripSchema`에 `bookings`·`prepNotes`·`phrases`를 `Schema.optional(FieldSchema(Schema.Array(...).check(isMaxLength(n))))`로.
   - `checkTrip`: 예약 `placeId`가 `places`에 있는지(묘비 허용), 각 배열의 `id` 중복, 필드별 `JSON.stringify(field.value).length` 상한. `date`는 검사하지 않는다.
   - 타입 `Booking`·`PrepNote`·`Phrase` 내보내기.
2. **참조·병합·정리**
   - `src/domain/library-sync/items.ts` `tripRefs`: `bookings?.value`의 `null` 아닌 `placeId` 추가.
   - `src/domain/library-sync/merge.ts` `OPTIONAL_FIELD_EMPTY.trip`에 세 필드 `[]`.
   - `src/services/library-sync/sync-engine.ts` `FIELDS_REFRESH` 1 → 2.
   - `src/domain/library-sync/repair.ts`: 사라지는 장소를 가리키는 예약 `placeId`를 생존 ID로 바꾸고 `bookings` 시각 갱신(기존 trip 갱신 조건에 포함).
   - `src/server/library-sync/library.ts` `pushItems`: 병합 결과 `resultText.length > ITEM_DOC_MAX_CHARS`이면 저장하지 않고 `rejected`에 `too-large`(기존 `settled.tooLarge` 흐름 재사용). `refs` 저장은 `tripRefs`를 쓰므로 자동 반영되는지 확인.
3. **되돌리기** `src/domain/trips/undo.ts`: `TOP_FIELDS`·`TripFieldPath`에 세 필드. `legTransit`·`legMinutes`처럼 `before`가 없던 선택 필드를 되돌릴 때는 키를 지우지 않고 `OPTIONAL_FIELD_EMPTY` 값과 새 시각으로 남긴다(`revertTrip`의 `fc.before === undefined` 분기(255행 부근)와 `putField`의 `delete` 분기를 `OPTIONAL_FIELD_EMPTY.trip`으로 일반화).
4. **AI `put` 보존** `src/server/agent/library-edit.ts`
   - `emptyMissingFields`에 `skip` 키 목록 인자를 더하고, `editItems`의 `put`에서만 `bookings`·`prepNotes`·`phrases`를 건너뛴다. 되돌리기 경로는 그대로 둔다.
   - 여행 `put`은 저장된 여행 행을 먼저 읽는다. `stampChangedFields`와 `emptyMissingFields` 처리 뒤 `src/domain/library-sync/merge.ts`의 `keepMissingFields`로 누락된 준비 필드를 저장된 값과 시각 그대로 채운다. 명시한 `value: []`는 빈 배열로 유지한다.
   - 장소 행 조회(130~146행 부근): 첫 쿼리는 지금처럼 본문 `refKeys`로 읽는다. 그 결과의 저장된 여행 `doc`에서, 본문이 생략한 준비 필드의 예약 `placeId` 가운데 아직 읽지 않은 것을 모아 **한 번 더** 같은 형식의 쿼리로 읽어 `rows`·`places`에 합친다(없으면 쿼리를 건너뜀). 그래야 `bookings`를 생략한 `put`의 예약 장소 행이 `places`에 들어간다.
   - 이 문서를 `decodeItem`으로 검사하고 `tripRefs`로 장소 조회 키를 모은다. 같은 참조 목록으로 `invalid-ref`를 판정하고, 통과한 여행만 `liveTrips`에 반영한다. 뒤따르는 장소 `delete`는 이 목록으로 `referenced`를 판정한다. 검사한 문서를 `pushItems`에 넘긴다.
5. **CLI 안내** `pipeline/agent-trip/help.ts`의 `helpText`에 준비 필드 예시 JSON 한 묶음(예약 1·정보 1·문장 1)을 넣고 전체 도움말(`yarn trip --help`)의 `library` 안내에 표시한다.
   - AI가 조사해 채울 때 `sources`·`checkedOn`·`unsure`를 꼭 적도록 안내한다. 여행 `put`에서 준비 필드를 생략하면 서버 값이 유지된다. 비우려면 `{"bookings":{"value":[],"updatedAt":"2026-11-27T09:00:00.000Z"}}`처럼 `value`에 빈 배열을 넣는다.
   - `docs/development.md`의 「AI의 보관함 편집」 절에 같은 사용법과 예시를 3~5줄로 넣는다.
6. **문서**
   - `docs/rollback.md`: 표에 이 기능 행을 추가하고 태그 칸은 `다음 버전`으로 둔다. 표의 이전 버전 행을 모두 검토하고, 준비 필드를 읽지 못하는 롤백 대상 행(`v0.38.0` 포함)의 마지막 칸에 ⚠️ 「이 버전에서 보관함을 한 번이라도 저장하면 그 기기의 모든 여행에서 `bookings`·`prepNotes`·`phrases`가 사라짐」과 본문의 「준비 필드」 절로 가는 링크(`#준비-필드`)를 넣는다. 릴리스 때 표 머리의 「지금」을 실제 릴리스 버전으로 갱신하면서 롤백 대상 행의 경고와 링크를 확인한다. 본문에 「준비 필드」 절을 만들고 기획서 §4.3 1~4단계를 옮긴다. 2단계에 「앱의 `AI 변경 기록 › 되돌리기`도 쓰지 않는다(이 경로는 `LIBRARY_SYNC=off`·`AGENT_EDIT=off`로 막히지 않음)」를 더한다.
   - `src/sections/privacy/privacy-content.ts`: 동기화 보관함 항목 문구에 「여행 준비(예약번호·금액·메모)」를 넣는다. 시행일 표기가 있으면 갱신 규칙을 따른다.
   - 처리방침과 `docs/development.md` 「AI의 보관함 편집」 절에 「동기화된 예약번호는 `library:read` 토큰으로 읽을 수 있고, 고치거나 지운 뒤에도 이전 값이 AI 변경 기록(최대 30일)·서버 백업에 남을 수 있다」를 적는다.
7. **시험(A)** — 기존 파일에 사례를 더한다.
   - `tests/unit/schema/trip.test.ts`: 세 필드 없는 옛 문서 통과, 개수·글자 수·필드 직렬화 상한 초과 거부, `1e309` 금액 거부, `checkTrip`의 없는 `placeId`·중복 `id`.
   - 같은 파일에 형식 거절 사례를 추가한다. `at`·`freeCancelUntil`의 `2026-02-30T09:00`·`2026-11-27T24:00`, 예약 링크와 정보 출처의 `https://`, `lang`의 `en-1`.
   - `tests/unit/server/sync-optional-fields.test.ts`: 옛 클라이언트가 `bookings` 없이 같은 rev로 올려도 서버 값 유지.
   - `tests/unit/domain/library-sync/apply.test.ts`: §9의 두 기기 시나리오 두 개.
   - `tests/unit/server/sync-library.test.ts`: 예약만 참조하는 장소(살아 있음·묘비) 여행 올리기 성공, 그 묘비가 보존 기간 뒤에도 정리되지 않음, 병합 결과 20만 자 초과 `too-large`·저장 안 됨.
   - `tests/unit/server/agent-library-edit.test.ts`: 예약만 참조하는 장소 행이 있으면 `put` 성공·없으면 `invalid-ref`, 준비 필드 빠진 `put`은 서버 값 유지·`[]`는 지움, 기존 여행에 AI로 첫 예약을 넣고 되돌리면 응답의 해당 변경 항목이 `status: 'undone'`인지 확인한다. D1에 저장된 여행 문서에서는 `bookings.value`가 `[]`이고 `bookings.updatedAt`이 되돌리기 시각인지 확인한다.
     - 예약에서만 참조하는 장소가 있는 여행의 제목을 바꾼다. `bookings`를 생략한 `put`만 보내도 성공하고 예약을 유지한다. 같은 요청에서 `put` 뒤 그 장소를 `delete`하면 `bookings` 생략 시 `put`은 성공하고 삭제는 `referenced`다. D1에 예약과 살아 있는 장소가 남는지 확인한다. `bookings`에 `value: []`를 명시하면 두 연산이 성공하고 D1에 빈 예약 배열과 장소 묘비가 남는다.
   - `tests/unit/domain/library-sync/repair.test.ts`: 예약만 참조하던 중복 장소 합치기 → `placeId` 이전.
   - 되돌리기(`tests/unit/domain/trips/leg-transit-minutes.test.ts`의 첫 설정 되돌리기 시험 옆, 또는 같은 형식의 새 파일): 첫 예약 추가를 되돌리면 `bookings.value`가 `[]`이고 `updatedAt`이 새 시각.
   - 공유에서 빠짐: `build-trip-share.ts`(v2·v3), `build-live-doc`(갱신 링크 문서 생성 함수), `trip-collab/build-doc.ts`로 만든 직렬화에(각 빌더가 `null`이 아닌 문서를 냈는지, 일정 공유는 v2 사례와 대중교통·직접 입력 시간이 든 v3 사례 각각의 `v`를 먼저 확인) `bookings`·`prepNotes`·`phrases`와 가짜 예약번호 `ZZCODE123`이 없음. 함께 편집 `trip-collab/apply.ts` 적용 뒤 준비 필드가 남음. 한 시험 파일(`tests/unit/domain/share/prep-excluded.test.ts`)에 모은다.

검증(A): `yarn lint`를 통과한다. A·B를 한 PR로 내면 A가 끝났을 때 `yarn typecheck && yarn test`와 `yarn build && yarn size`를 실행한다. A를 별도 PR로 내면 PR 완료 전에 `yarn build:ci` 전체를 통과한다. 각 경우의 크기 검사에서 첫 로딩 JS gzip 예산(328,704B 이하)을 확인한다. `yarn trip --help`에 준비 필드 예시와 비우는 형식이 보이는지 확인한다.

## B. 화면

1. **순수 함수** `src/domain/trips/bookings.ts`: 기획서 §5.2 표 그대로 `summarizeBookings(bookings)` → `{ booked, total, requiredLeft, totals: {currency, amount}[] }`, `filterBookings(list, 'all'|'todo'|'open')`, `bookNow(list, today)`(`todo`·`pending` 중 `bookBy`가 있는 예약만, 필수 먼저·그 안에서 기한순으로 최대 5개, 기기 달력 날짜인 `today`보다 기한이 앞설 때(`bookBy < today`) `overdue` 표시), `groupByDate(list)`(날짜 순, `null` 맨 끝). 예약 연산 `putBooking(lib, tripId, booking, ctx)`·`removeBooking(...)`: 필드 시각 갱신, 확정 일시를 처음 적고 `date`가 비었으면 그 날짜로 채움, 결과 여행을 `src/domain/library-sync/items.ts`의 `stableStringify`로 직렬화한 길이가 `ITEM_DOC_MAX_CHARS`를 넘으면 거절(사유 「여행 문서가 너무 커요」), 마지막 항목 삭제도 `[]` 유지. 새 id는 기존 id 생성 도우미 사용.
2. **경로** `src/routes/paths.ts` `tripPrep(id) = /trips/${id}/prep`, `src/routes/lazy-routes.ts`에 `loadTripPrepPage`·`TripPrepPage`, `src/routes/router.tsx`에 `tripToday`와 같은 방식으로 등록. `package.json` `build:ci`의 `yarn size`에 `--require-lazy TripPrepPage`(편집 시트를 따로 나누면 그 이름도).
3. **준비 화면** `src/sections/trips/prep/TripPrepPage.tsx`(+필요하면 `BookingList.tsx`): 머리 「<여행 제목> · 준비」와 닫기(계획 화면으로). 탭은 1단계에서 **두지 않고** 예약 내용만 보인다(정보·문장 탭은 2단계에서 탭과 함께 넣음). 집계 줄(예약함 n / 전체 + 진행 막대, 필수인데 아직 n · 적은 금액 통화별), 「지금 예약할 것」(`src/domain/trips/query.ts`의 `localToday()`로 기기 달력 날짜를 구해 `bookNow`의 `today`로 넘기고, `bookBy < localToday()`인 항목을 빨간색으로 표시. 첫 링크가 있으면 `열기`(새 탭, `rel="noopener noreferrer"`), 없으면 편집 시트를 여는 `적기`), 필터 칩 `전체`·`할 것만`·`아직 안 한 것`, 날짜 묶음 목록(기간 밖이면 「기간 밖」), `＋ 예약 더하기`. 없는 여행은 `TripNotFound`. 편집은 `src/sections/trips/planner/use-trip-undo.ts`의 `useTripUndo`로 실행해 `되돌리기` 토스트.
   - 날짜 묶음의 각 예약 행에는 제목과 상태를 표시하고, 값이 있으면 확정 일시(`at`)·예약번호(`code`)·무료 취소 기한(`freeCancelUntil`)을 함께 표시한다. 확정 일시와 무료 취소 기한은 입력한 현지 날짜와 시각을 그대로 사용한다. 예약 행을 누르면 해당 예약의 편집 시트를 연다.
   - 준비 화면의 되돌리기에서는 `useTripUndo`가 저장소 잠금 안에서 최신 보관함에 `revertTrip`을 적용하고, 변경된 여행을 저장하기 전에 B.1과 같은 크기 검사를 한다. 상한을 넘으면 되돌리기 전체를 거절하고 「여행 문서가 너무 커요」 토스트를 띄운다.
4. **편집 시트** `src/sections/trips/prep/BookingSheet.tsx`: 휴대폰은 아래쪽 시트(`AddSheet.tsx`의 `Drawer anchor="bottom"` 패턴), 넓은 화면은 대화상자. 칸 순서 §5.2. 상태 네 칩, 장소 고르기는 이 여행 Stop·숙소 장소의 날짜순 목록(`Select`), 연결 장소가 일정에 없으면 「일정에 없는 장소」+`바꾸기`·`연결 끊기`. 예약번호 `복사`(`navigator.clipboard.writeText`, 실패 시 토스트). `지우기`. 입력 검사는 스키마 한도와 같게(넘으면 저장 단추 비활성·안내).
5. **들어가는 곳**
   - `src/sections/trips/planner/CandidatePanel.tsx` 단추 줄에 `준비` 링크(`paths.tripPrep`), 필수 미완료가 있으면 `준비 · n`.
   - `src/sections/trips/TripsPage.tsx` 카드에 `예약 n/m`(n=booked, m=skipped 뺀 수). m이 0이면(필드 없음·빈 배열·모두 안 하기로 함) 숨긴다. 기획서 「필드가 있을 때만」을 마지막 예약을 지운 뒤 `[]`가 남는 경우까지 넓힌 해석이다.
6. **시험(B)**
   - `tests/unit/domain/trips/bookings.test.ts`: 집계 표, 필터, 「지금 예약할 것」 후보·순서·5개 상한·기한 경계, 날짜 묶음, `putBooking`의 `date` 채움·크기 거절, `removeBooking` 마지막 → `[]`.
     - `bookBy`가 있는 `todo`·`pending`만 후보에 들고, 예약함(`booked`)·안 하기로 함(`skipped`)·기한 없는 예약은 빠지는지 확인한다. 기기 달력 날짜를 `today`로 넘겼을 때 `bookBy < today`인 항목만 `overdue`이고 기한이 오늘이나 그 이후인 항목은 `overdue`가 아닌지 확인한다.
   - `tests/unit/sections/trips/trip-prep-page.test.tsx`: 예약 하나 더하기 → 상태를 `예약함`으로 → 집계 숫자 변경. 예약을 삭제한 뒤 다른 탭이 일정만 늘려, 예약을 복원할 때만 20만 자를 넘는 경우도 확인한다. `되돌리기`를 눌러도 예약은 삭제된 상태로 남고 다른 탭의 일정 편집은 보존되며 「여행 문서가 너무 커요」가 표시된다. `tests/unit/sections/trips/planner-fixtures.tsx`의 `open(lib, { path: '/trips/<id>/prep' })` 재사용(`renderLibrary`는 `tests/unit/sections/library/fixtures.tsx`).

검증(B): PR 완료 전에 `yarn build:ci` 전체를 통과하고 크기 검사에서 첫 로딩 JS gzip을 다시 확인한다. e2e는 상위 세션이 CI에서(`gh workflow run ci.yml --ref <브랜치> -f full_e2e=true`).

## 끝난 뒤

- PR 본문에 첫 로딩 JS gzip 값(A 뒤·B 뒤)과 각 값을 잰 빌드 환경(로컬·PR·운영 구분과 번들에 영향을 주는 빌드 설정), §9 처리 표, 고치지 않은 것을 적는다. PR을 나누면 해당 단계의 값을 각 PR에 적는다.
- 공유 노트 `phase1-handoff.md`에 2단계가 알아야 할 것(탭 자리 없음, 순수 함수 위치, 크기 상한, 처리방침 시행일).
