# 여행 준비 2단계(MVP-②) 구현 계획

**목표:** 준비 화면에 `[예약] [정보] [문장]` 탭을 두고 정보·문장을 보고 고친다. 문장은 기기 음성으로 듣는다. 당일 모드에 그날 예약 카드를 둔다.

- 기획서: [`../specs/2026-11-27-trip-prep-design.md`](../specs/2026-11-27-trip-prep-design.md) §5.3·§5.4·§5.5·§6 2단계·§8·§9
- 1단계 계획: [`2026-11-27-trip-prep-phase1.md`](2026-11-27-trip-prep-phase1.md). 저장 형식·동기화·되돌리기는 이미 들어가 있어 이번에는 화면과 순수 함수만 더한다.
- 전제: 사용자 1명(+동행), 여러 기기, Cloudflare 무료. 외부 API·기본 문장 묶음·서비스 워커 없음(§7). 판단이 갈리면 작은 쪽.
- 규모 목표 약 900~1,100줄(시험 포함). 넘칠 것 같으면 A(탭·정보·문장·speak·6절 처리방침)와 B(오늘 예약·9절 사용자 안내 문서)로 PR을 나눈다.

## 전역 제약

- 첫 로딩 JS gzip ≤ 328,704B(`perf-budget.json`). 운영 예산의 남은 바이트는 검증 절차에서 운영과 같은 조건으로 측정해 계산한다. **첫 화면 파일(`src/routes/paths.ts`·`lazy-routes.ts`·`router.tsx`·`src/schema/*`·`src/services/id-gen.ts`)은 고치지 않는다.** 새 코드는 모두 준비 화면 청크(`TripPrepPage`)와 당일 모드 청크(`TripTodayPage`)에 둔다. 새 id 종류를 더하지 않고 `ctx.newId('booking')`(8자 영숫자, `PrepId`와 같은 형식)을 정보·문장에도 쓴다.
- 한도는 `src/schema/trip.ts`의 묶지 않은 상수(`PREP_NOTES_MAX`·`PHRASES_MAX`·`PREP_TEXT_CHARS`·`PREP_REGION_CHARS`·`PREP_SOURCES_MAX`·`PREP_URL_CHARS`·`PHRASE_*_CHARS`·`PREP_FIELD_CHARS`)를 가져다 쓴다.
- `FIELDS_REFRESH`·`schemaVersion`은 바꾸지 않는다.
- 화면 글은 한국어 해요체. 터치 대상 44px 이상. `~/.claude/rules/modern-web.md`(시맨틱 요소, `aria-pressed` 칩, 포커스 보임).
- 한글 입력: Enter로 확정하는 칸이 있으면 `event.nativeEvent.isComposing || event.keyCode === 229`일 때 무시한다(이번 시트는 여러 줄 칸·저장 단추로 확정하므로 Enter 확정 칸을 새로 만들지 않는 것을 기본으로 한다).
- 규칙 `docs/convention.md`. 시험은 동작을 지키는 만큼만, 같은 동작을 여러 층에서 겹쳐 시험하지 않는다.

## §9 「구현 계획 때 반영할 검토 지적」 가운데 2단계 몫

| 지적 | 처리 |
|---|---|
| 당일 모드에서 다른 Day를 골랐을 때 `오늘 예약`의 기준 | 고른 Day를 따른다. 보는 Day가 오늘이면 제목 `오늘 예약 N`, 아니면 `12.20(일) 예약 N`(`shortDate`) |

## 순서

### 1. 순수 함수 `src/domain/trips/prep.ts` (+`bookings.ts`와 같은 모양)

- `PREP_TOPIC_ORDER`: 스키마 `topic` 리터럴 순서(언어 → 돈 → 물가 → 날씨 → 시간 → 전압 → 팁 → 치안 → 긴급 → 교통 → 서류 → 기타).
- `sortNotes(list)`: 주제 순서, 같은 주제 안에서는 저장 순서 유지(안정 정렬).
- `noteRegions(list)`: 빈칸이 아닌 `region`을 처음 나온 순서로 중복 없이.
- `filterNotes(list, { region: string | null, unsure: boolean })`: `region`이 `null`이면 전체. 값이 있으면 그 region과 **빈 region(여행 전체)** 을 함께 보인다. `unsure`이면 `unsure === true`만.
- `putPrepNote(lib, tripId, input, ctx)`·`removePrepNote(lib, tripId, id, ctx)`, `putPhrase`·`removePhrase`: `putBooking`·`removeBooking`과 같은 흐름(없는 여행 `NotFound`, `is(Schema, …)` 검사, 개수 `PREP_NOTES_MAX`·`PHRASES_MAX`, 필드 직렬화 `PREP_FIELD_CHARS`, `setOptionalField(…, [], ctx.now)`로 마지막 항목 삭제도 `[]` 유지, `checkTripSize`). 중복을 줄이려고 `bookings.ts`의 `saveBookings`를 필드 이름을 받는 `saveField(lib, trip, key, list, ctx)`로 일반화해 세 필드가 같이 쓴다(동작 그대로).
- `phraseLangs(list)`: 문장에 들어 있는 `lang`을 처음 나온 순서로 중복 없이. `phraseSituations(list, lang)`: 그 언어 문장에 있는 상황만 스키마 순서로.
- `bookingsOn(list, date)`: `date`가 같은 예약(`skipped` 제외). 순서는 `at` 있는 것 먼저 시각순, 그다음 저장 순서.

### 2. 음성 `src/lib/speak.ts` (의존성 없음, 약 80줄)

- `pickVoice(voices, lang)` → `{ voice, online: boolean } | null`. 태그는 소문자로 바꾸고 `_`를 `-`로 본다(안드로이드 `es_ES`). 순서: ① `lang` 정확히 같고 `localService` ② 앞부분(첫 `-` 앞, `es`)이 같은 `localService` ③ ①의 원격 ④ ②의 원격. 없으면 `null`.
- `loadVoices(timeoutMs = 2000)`: `speechSynthesis`가 없으면 `[]`. `getVoices()`가 비어 있으면 `voiceschanged`를 최대 2초 기다린 뒤 다시 읽고, 리스너를 지운다.
- `speak(text, voice, rate)` → `Promise<void>`. 재생 전 `cancel()`, `SpeechSynthesisUtterance`에 `voice`·`lang`·`rate`, `end`에 끝, `error`(`interrupted`·`canceled`는 실패로 보지 않음)에 실패.
- `googleTranslateUrl(text, lang)`: `https://translate.google.com/?sl=<앞부분>&tl=ko&text=<encodeURIComponent>&op=translate`.
- 처음 쓰는 언어 이름: `new Intl.DisplayNames(['ko'], { type: 'language' }).of(lang)`(실패하면 `lang` 그대로). 화면 쪽 도우미로 둔다.
- 단위 시험은 `pickVoice`만(`tests/unit/lib/speak.test.ts`: 정확·기기 안 → 앞부분·기기 안 → 원격 → 없음, `es_ES` 표기).

### 3. 준비 화면 탭 `src/sections/trips/prep/TripPrepPage.tsx`

- 머리 아래 `[예약] [정보] [문장]` 탭(MUI `Tabs`/`Tab`, 각 탭 높이 44px 이상, `variant="fullWidth"`). 지금 예약 내용은 `BookingsTab`(같은 파일이나 `BookingsTab.tsx`)으로 옮기고 동작은 그대로 둔다.
- 고른 탭은 주소의 `?tab=info|phrases`로 둔다(`useSearchParams`, 없으면 예약). 새로고침하면 주소에서 같은 탭을 복원하므로 따로 저장할 필요가 없다. 탭을 바꿀 때는 `replace: true`로 현재 브라우저 이력 항목을 교체한다. 계획 화면에서 준비를 열어 정보 → 문장 탭으로 바꾼 뒤 브라우저에서 뒤로 가면 계획 화면으로 돌아간다.
- 탭마다 개수를 붙이지 않는다(작게 유지).

### 4. 정보 탭 `src/sections/trips/prep/NotesTab.tsx` + `NoteSheet.tsx`

- 맨 위 거르기 줄: `확인 필요 N` 칩은 `unsure: true`인 항목 수가 1개 이상이면 보인다(`aria-pressed`). 그 뒤에 빈칸이 아닌 `region`이 하나 이상일 때만 지역 칩 `전체`와 각 지역을 보인다. 두 종류의 칩이 모두 보이면 함께 걸린다. 표시할 칩이 없을 때만 줄을 숨긴다.
- 항목: `<article>`에 아이콘+주제 이름(`prep-labels.ts`의 `TOPIC_LABELS`·`TOPIC_ICONS`), 오른쪽에 `region || '여행 전체'` · `M/D 확인`(`checkedOn`이 있을 때) · `⚠ 확인 필요`(`unsure`일 때, 경고 색). 본문은 `white-space: pre-line`의 일반 글(마크다운 해석 안 함). 본문은 CSS 줄 수 제한(`WebkitLineClamp: 4`)으로 4줄까지 보이고, 그린 뒤와 본문 너비가 바뀔 때(`ResizeObserver`) `isTruncated(el, 4)`(`src/components/TruncatedText.tsx`)로 실제로 잘렸는지 재서 잘렸을 때만 `더 보기`/`접기` 단추를 보인다(글자 수·개행 수로 짐작하지 않는다). 재기는 접힌 상태에서만 하고, 펼친 동안에는 마지막 값을 유지해 `접기`가 사라지지 않게 한다. `ResizeObserver`가 없으면(시험 환경) 그린 뒤 한 번만 잰다. 출처는 `<details><summary>출처 N</summary>` 안에 링크(새 탭, `rel="noopener noreferrer"`).
- 항목의 `고치기` 단추(또는 주제 줄 누르기)로 시트를 연다. 하단 `＋ 정보 더하기`(40개면 비활성·안내).
- `NoteSheet.tsx`: `BookingSheet.tsx`의 Drawer(좁은 화면)/Dialog(넓은 화면) 패턴. 칸: 주제(Select) → 지역(30자) → 내용(여러 줄, 1,500자, 남은 글자) → 출처 링크 최대 3칸(https) → 확인한 날(date) → `확인 필요` 체크. 저장·지우기·닫기. 입력 검사는 `safeParse(PrepNoteSchema, …)`와 필드 크기(`PREP_FIELD_CHARS.prepNotes`)로, 넘으면 저장 비활성·안내.
- 저장·지우기는 `useTripUndo(trip.id, checkTripSize)`의 `run`으로(`정보를 더했어요`/`고쳤어요`/`지웠어요` + 되돌리기 토스트).

### 5. 문장 탭 `src/sections/trips/prep/PhrasesTab.tsx` + `PhraseSheet.tsx`

- 언어 칩(문장에 있는 `lang`만, `스페인어 es-ES` 형식, 하나뿐이면 숨기지 않고 하나 보임). 처음 고른 언어는 첫 언어. 그 아래 상황 칩 `전체`+그 언어에 있는 상황(`SITUATION_LABELS`). 목록은 상황 순서로 묶고 머리 `── 식당 ──`.
- 문장 행: 한국어(굵게) / 현지어(`lang` 속성 붙임) / 한글 읽는 법(보조 색) / 메모. 오른쪽에 `▶`(듣기)·`🐢`(느리게, rate 0.6)·`⋯` 아이콘 단추(각 44px, `aria-label` 「<한국어> 듣기」 등).
- 음성: 탭이 처음 보일 때 `loadVoices()`를 한 번 부르고 언어마다 `pickVoice`. 원격이면 `▶` 옆에 작게 `온라인 음성`. 맞는 음성이 없거나 목록이 2초 안에 안 오면, 그 언어는 `▶`·`🐢` 대신 「이 기기에서 <언어 이름> 음성을 쓸 수 없어요」와 `구글 번역에서 듣기` 링크(새 탭) + 「문장이 Google로 전송돼요」를 문장마다 보인다. 재생 중 `error`가 나면 **그 문장에만** 「소리를 내지 못했어요」와 같은 구글 번역 링크·전송 안내를 보이고 `▶`·`🐢`는 남겨 다시 누를 수 있게 한다(다시 누르면 안내를 지운다).
- `⋯` 메뉴(MUI `Menu`): `크게 보기`(전체 화면 `Dialog`, 현지어만 큰 글씨 `clamp(28px, 8vw, 56px)`, 닫기 44px), `복사`(현지어를 `navigator.clipboard.writeText`, 성공·실패 토스트), `구글 번역에서 듣기`(새 탭 링크), `고치기`, `지우기`(되돌리기 토스트로 대신하므로 확인 창 없음).
- 긴 문장(`lodging`, 500자)도 같은 행으로 보이며 줄바꿈을 살린다(`pre-line`).
- `PhraseSheet.tsx`: 상황(Select) → 한국어(200자) → 현지어(여러 줄, 500자) → 언어(`es-ES` 텍스트, 기존 언어를 칩으로 골라 넣기, `safeParse`의 `lang` 검사) → 한글 읽는 법(300자) → 메모(200자). 새 문장은 지금 고른 언어·상황으로 시작. `＋ 문장 더하기`(150개면 비활성).
- 추가·수정은 1절의 `putPhrase`, 메뉴의 `지우기`는 `removePhrase`를 `useTripUndo(trip.id, checkTripSize)`의 `run`으로 실행한다. 변경이 저장되면 `되돌리기` 토스트를 띄운다.
- 추가·수정 결과가 문장 필드의 직렬화 상한(`PREP_FIELD_CHARS.phrases`)이나 여행 문서 상한을 넘으면, 저장을 막고 시트를 열어 둔 채 입력을 유지하며 사유를 표시한다. 문서 상한 안내는 「여행 문서가 너무 커요」로 쓴다. 메뉴에서 지우기가 거절되면 목록을 유지하고 사유를 토스트로 표시한다.

### 6. 처리방침 `src/sections/privacy/privacy-content.ts`

- 「5. 처리 위탁과 외부 전송」에 한 줄: 「발음 듣기: 기기에 그 언어 음성이 없어 `온라인 음성`을 쓰면 그 문장이 브라우저 회사(Apple·Google 등)의 음성 서버로, `구글 번역에서 듣기`를 누르면 그 문장이 Google 번역으로 전송돼요.」
- `PRIVACY_EFFECTIVE_DATE`를 병합일로(지금 기준 `2026년 11월 28일` 그대로이며, 병합일이 다르면 그 날짜로 고친다).

### 7. 당일 모드 `src/sections/trips/today/TodayBookings.tsx`

- `TripTodayPage.tsx`에서 `NextCard` 위에 둔다. 보는 Day의 날짜(`addDays(trip.startDate.value, model.dayIndex)`)로 `bookingsOn`(`model.date`는 다녀옴 체크용 오늘 날짜라 쓰지 않는다). 제목의 「오늘」 판정은 `model.isToday`. 0건이면 그리지 않는다.
- 접힌 카드(`<details>`나 `Collapse` + `aria-expanded` 단추). 제목: 보는 Day가 오늘이면 `오늘 예약 N`, 아니면 `src/sections/trips/trip-dates.ts`의 `shortDate(date)` 결과에 ` 예약 N`을 붙인다. 펼치면 예약마다 제목 · 확정 시각(`at`의 `HH:mm`) · 예약번호와 `복사` 단추 · 첫 링크(새 탭). 준비 화면으로 가는 `준비에서 보기` 링크 하나.

### 8. 계획 화면 Stop 예약 배지(§5.5)

- **이번에는 미룬다.** 규모 목표 안에 넣기 어렵고 예약 탭에서 찾을 수 있다(기획서 §5.5가 허용한 순서). 인계 메모에 남긴다.

### 9. 문서

- `scripts/motion/help-pages.mjs`의 `trips` 항목 `tips`에 「제목 밑 `준비`에서 예약·여행 정보·현지어 문장을 모아 봐요. 문장의 ▶로 발음을 듣고, `⋯ › 크게 보기`로 현지인에게 보여 줘요.」를 한 줄 더한다.
- `yarn build:motion`으로 `docs/help/trips.md`와 `src/sections/help/help-content.ts`를 갱신한다.
- `README.md` 기능 표 「여행 계획」 칸 끝에 「`준비`에서 예약·현지 정보·현지어 문장(발음 듣기)을 모아 봅니다.」

## 시험

- `tests/unit/domain/trips/prep.test.ts`: `sortNotes` 순서, `filterNotes`(region + 빈 region 포함, `unsure`), `putPrepNote`·`removePrepNote` 마지막 → `[]`, 개수 상한 거절, `putPhrase` 잘못된 `lang` 거절, `phraseLangs`, `bookingsOn`(같은 날·`skipped` 제외·시각순).
- `tests/unit/lib/speak.test.ts`: `pickVoice`만.
- `tests/unit/sections/trips/trip-prep-page.test.tsx`에서 기존 예약 사례가 탭 도입 뒤에도 통과하는지 확인하고 다음 사례를 더한다.
  - 정보 탭에서 확인이 끝난 여행 전체 메모가 있을 때 지역을 비우고(`region: ''`) `확인 필요`를 체크한 메모를 더한다. 두 메모가 목록에 보이고 지역 칩 없이 `확인 필요 1` 칩이 보이며, 그 칩을 누르면 새 메모만 남는다.
  - 문장 탭에서 음성이 없을 때(`speechSynthesis` 없음) 안내와 구글 번역 링크가 보이는지 확인한다.
  - 문장 탭에서 문장 하나를 추가해 목록에 표시되는지 확인한다. `고치기`로 내용을 바꿔 저장한 뒤, 메뉴에서 지우면 목록에서 사라지고 삭제 토스트의 `되돌리기`를 누르면 수정된 내용이 다시 보이는지 확인한다.
  - 문장 필드 또는 여행 문서의 상한을 넘는 변경은 각각 저장이 거절되고, 입력값과 시트가 유지되며 해당 사유가 표시되는지 확인한다.
- 당일 카드는 화면 시험을 두지 않고 `bookingsOn` 단위 시험과 검증 4의 실기기 절차로 확인한다.

## 검증

1. `yarn typecheck && yarn lint && yarn test`.
2. 첫 로딩 JS와 지연 로딩을 확인한다.
   - 로컬에서는 1단계 완료 시점과 이번 변경을 동일한 빌드 설정과 환경변수로 각각 빌드해 첫 로딩 JS gzip의 증감을 비교한다. [로컬·미리보기와 운영의 측정 차이](../../ui-performance.md#2026-10-13-d2-첫-로딩)
   - Cloudflare Pages Production과 같은 빌드 설정과 환경변수로 `yarn build:ci`를 실행한다. 첫 로딩 JS gzip이 328,704B 이하인지 확인하고, 기존 `--require-lazy TripPrepPage`와 `--require-lazy TripTodayPage` 검사로 두 화면 청크가 각각 생성되어 첫 로딩 목록에서 빠져 있는지 확인한다. [Cloudflare Pages 배포 설정](../../development.md#배포-cloudflare-pages)
   - PR 본문에 측정 조건, 로컬 전후 값과 증감, 운영과 같은 조건에서 잰 값과 상한까지 남은 바이트, 두 청크의 검사 결과를 적는다.
3. e2e는 CI에서 `gh workflow run ci.yml --ref <브랜치> -f full_e2e=true`.
4. iPhone Safari·안드로이드 크롬에서 실기기로 확인하고 결과를 PR 본문에 적는다.
   - 온라인에서 es-ES·fr-FR `▶`·`🐢`, 음성 없을 때 안내, `구글 번역에서 듣기` 링크가 원문을 듣기 칸에 띄우는지(주소 형식은 공식 문서가 없음), 당일 모드 `오늘 예약` 카드를 확인한다. 다른 Day를 고르면 카드 제목(`12.20(일) 예약 N`)과 예약이 일정과 함께 바뀌고 `오늘로`로 돌아오는지, 기기 시각 03:59에는 어제 일정과 어제 예약이, 04:00에는 오늘 것이 보이는지(제목 `오늘 예약 N`) 확인한다.
   - 비행기 모드에서는 [기획서 §9](../specs/2026-11-27-trip-prep-design.md#9-시험과-확인)에 따라 다음 세 경우의 결과를 각각 기록한다.
     1. 앱 신규 실행. 앱을 닫고 비행기 모드에서 다시 연다.
     2. 준비 화면 최초 진입. 온라인에서 여행 계획 화면을 연 뒤, 준비 화면을 처음 열기 전에 비행기 모드로 바꾸고 `준비`를 누른다. [`src/routes/lazy-routes.ts`](../../../src/routes/lazy-routes.ts)의 미리 받기 목록(`ROUTE_CHUNKS`)에 `loadTripPrepPage`가 있으므로, 비행기 모드 전환 전에 준비 화면 청크를 미리 받았는지도 함께 기록한다.
     3. 이미 열린 준비 화면. 온라인에서 준비 화면을 열어 둔 뒤 비행기 모드로 바꿔 저장된 정보가 보이는지와 문장 탭에서 es-ES·fr-FR 발음이 재생되는지를 각각 확인한다.

## 끝난 뒤

- 공유 노트에 인계: 미룬 계획 화면 배지, 남긴 지적, 첫 로딩 측정값.
