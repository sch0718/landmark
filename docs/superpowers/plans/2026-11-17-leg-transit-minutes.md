# 구간 대중교통·시간 직접 입력 (v0.37.0)

해외 구간은 경로 API가 없어 이동 시간을 비워 두거나(앱 계획 화면·CLI는 0분) 직선 어림(직선×1.3, 자동차 40km/h)에 기댄다. 대중교통이 많은 도시에서 실제와 크게 다르다(파리 라 플렌역→노트르담: 어림 약 14분, 구글 RER 30분). 그래서 정류장 도착 시각이 맞지 않는다. 이미 있는 것으로 안 되는 이유: 구간 수단은 자동차·도보뿐이고, 시간을 사람이 고칠 방법이 없다.

## 할 일

1. 구간 수단에 `대중교통`을 더한다.
2. 구간 시간을 분으로 직접 적는다. 적은 시간이 계산값(경로·어림)을 대신하고, 그 뒤 정류장 도착 시각 계산에도 쓰인다.
3. AI CLI 계획 형식(`yarn trip build plan.json`)에서 둘 다 지정한다.
4. 공유 HTML·보기 링크(share-viewer)에도 대중교통과 적은 시간이 보인다.
5. 대중교통 구간의 길찾기: 구글 `travelmode=transit`, 네이버 앱 `nmap://route/public`, 네이버 웹 `/transit`(`naver-directions.ts`가 이미 지원한다. 넘기기만 한다).

## 데이터 형식과 옛 버전 호환

### 보관함 `Trip` (동기화·백업)

`legModes`의 리터럴(`'car'|'walk'`)은 **넓히지 않는다**. 옛 버전의 `LibrarySchema` 검사가 `'transit'`에서 실패해 보관함 전체가 손상 화면으로 간다(`library-store.ts` `failCorruptWithBackup`). 대신 선택 필드 둘을 더한다(`visitedOn`·`review`와 같은 방식).

```ts
// src/schema/trip.ts TripSchema
legTransit: Schema.optional(FieldSchema(Schema.Array(Schema.String))),   // 대중교통 구간 키(정렬·중복 없음)
legMinutes: Schema.optional(FieldSchema(Schema.Record(Schema.String, LegMinutes))), // 정수 1~1440
```

- 근거: Effect 기본 `onExcessProperty: 'ignore'`라 옛 버전은 두 키를 무시하고 통과한다(`visit-fields.test.ts`의 `futureField` 시험과 같은 계약). 옛 버전에는 그 구간이 `legModes`대로(자동차·도보) 보이고 어림 시간이 나온다.
- **한계(받아들임):** 옛 버전 기기가 그 여행을 고쳐 올리면 두 키가 빠진 문서가 올라간다. 서버는 `baseRev`가 같으면 병합 없이 올린 문서로 바꾸므로(`src/server/library-sync/library.ts` `evaluated`) 서버와 다른 기기에서도 대중교통·적은 시간이 사라질 수 있다. `visitedOn`·`review`·`emoji`도 같은 한계이고(`docs/rollback.md` v0.3.0~ 행), 사용자가 소수이며 새 버전 안내가 있다. 서버 보존 장치는 붙이지 않고, 롤백 표와 이 문서에 「옛 버전에서 그 여행을 고치면 다시 입력해야 할 수 있다」고 적는다.
- 두 필드는 따로 LWW로 병합된다. 두 기기가 같은 구간의 수단과 분을 동시에 바꾸면 섞일 수 있다(드묾, 사람이 다시 확인).
- 두 키는 처음 쓸 때만 생긴다(`setOptionalField`, 빈 값 `[]`·`{}`). 옛 문서를 다시 저장해도 키가 생기지 않는다.
- 키 형식은 `checkTrip`이 `legModes`와 같은 `LEG_KEY`로 검사한다.
- 실효 수단: `legTransit`에 키가 있으면 `'transit'`, 아니면 지금 규칙(`legModes` → 자동). 실효 분: `legMinutes[key]`.
- 대중교통은 직선거리 제한이 없다(도보 50km 제한 같은 것 없음).

### 공유 문서 (HTML 내보내기·보기 링크·함께 편집 문서·AI 받은함)

공유 문서는 모르는 필드를 거절한다(`read-share.ts`·`share-viewer/parse.ts`가 엄격 검사). 그래서 **대중교통이나 적은 분이 실제로 담길 때만 `version: 3`** 으로 쓰고, 아니면 지금처럼 `version: 2`를 쓴다. 대부분의 공유는 형식이 그대로라 옛 버전에 영향이 없다.

v3 = v2 + 아래 차이뿐이다.

- `ShareTrip.legModes` 값에 `'transit'` 허용.
- `ShareTrip.legMinutes?: Record<key, 1~1440 정수>`(optionalKey, 비면 뺀다).
- `ShareLeg.mode`에 `'transit'`, `ShareLeg.status`에 `'manual'`(적은 분. `durationS = 분×60`, `distanceM`은 직선×1.3 어림, `path: []`, `queriedAt: null`, `tollFare: null`).

옛 버전의 반응: 앱 가져오기(`read-share.ts`)는 `version >= 3`을 이미 `newer`(새 버전 필요 안내)로 거절한다. 옛 보기 화면·옛 `parseLiveDoc`은 v3를 읽지 못해 열리지 않는다. 보관함 데이터는 깨지지 않는다. 보기 링크(`/s/...`)는 배포된 최신 보기 화면이 연다.

- 보기 링크 문서 `LiveTripDoc`: `share.version`이 2 또는 3이면 받는다. `v`(1|2)는 그대로 둔다.
- 함께 편집 `CollabPlan`: `legModes` 값에 `'transit'` 허용, `legMinutes?`(optionalKey, 비면 뺀다 → 옛 계획의 `planKey`가 바뀌지 않는다). `services/trip-collab/store.ts`의 `planSchema`도 같게 넓힌다. 3방향 병합(`merge.ts`)은 구간 키마다 `(수단, 분)` 묶음을 한 값으로 보고 지금 `legModes`의 키별 규칙을 쓴다(한쪽이 수단만, 다른 쪽이 분만 바꾸면 충돌로 다뤄, 다른 수단으로 잰 분이 붙지 않게). 충돌 화면 `src/sections/trips/collab/CollabConflictDialog.tsx`의 제목·값 표시에 `대중교통`과 `구간 시간`(분, 지움)을 더한다. `apply.ts`·`owner-join.ts`·`projectLocalTrip`이 `'transit'` ↔ `legTransit`, `legMinutes` ↔ `legMinutes`로 옮긴다.
- 함께 편집 중 옛 버전 기기: 새 공동본(v3)을 읽지 못한다. 옛 기기의 기본 처리(읽기 실패)를 그대로 따르고 따로 막지 않는다. 롤백 표에 적는다.

## 시간 규칙 (`src/domain/trips/geo.ts`, `query.ts`)

- `Leg`에 `mode: 'car'|'walk'|'transit'`, `minutes: number | null`를 더한다(`legBetween`이 채운다).
판정 순서(위가 우선):

1. 같은 지점(10m 미만): 지금 그대로 0.
2. 분을 적은 구간(국내·해외 모두): 경로를 묻지 않는다. 시간 = 분×60초, 거리 = 직선×1.3 어림, 상태 `manual`.
3. 해외 구간(`isAbroadLeg`), 분 없음: 수단과 상관없이 지금 그대로(시간 0, 앱 `abroad` 「이동 시간은 구글맵에서 확인」, CLI·공유 `estimated` 0초).
4. 국내 대중교통, 분 없음: 경로를 묻지 않는다. 어림 = 거리 직선×1.3, **시속 20km + 대기 10분**(상태 `estimated`). 근거: 도시 대중교통의 평균 운행 속도(정차 포함)가 대략 시속 20km 안팎이고, 걷기·기다림을 10분으로 둔 단순 값이다. 짧은 구간(직선 1km → 약 14분)은 실제보다 길고, 긴 구간은 환승에 따라 다르다. 정확한 값은 직접 입력하라는 것이 이 기능의 뜻이다.
5. 국내 자동차·도보: 지금 그대로(경로 조회, 실패하면 어림).

- 한 곳에 모은다: `fixedLegTime(leg): ShareLegTime | null`(`src/domain/trips/leg-time.ts` 새 파일, 경로 조회가 필요 없으면 시간, 필요하면 `null`. 1·3은 기존 분기 그대로 둬도 된다).
- **경로 조회 계층에 넣지 않는다:** `routeKeyOf`는 대중교통에서 출발 시각이 없으면 `floorTransitAt`이 예외를 던진다(`src/server/route.ts`). 그래서 2·4에 해당하는 구간은 `routeKeyOf`를 부르기 전에 걸러 낸다. `use-day-plan.ts`의 `dayStates`·`requestKeys`, 개별 다시 묻기(`onRetry`), `use-trip-legs.ts`, `use-trip-collab.ts`, `pipeline/agent-trip/route-legs.ts`(`queryOf`·요청 목록)·`summary.ts` 모두.
- `use-day-plan.ts`의 `sameLeg`에 `minutes` 비교를 더한다(안 하면 분만 바꿨을 때 이전 배열이 재사용된다).
- `use-trip-legs.ts`의 완료 집계(`answered`)는 고정 시간 구간을 바로 답한 것으로 센다(안 하면 「이동 경로를 받는 중」에 머물고 `use-trip-live-publish.ts`의 게시 대기가 끝나지 않는다).

## 편집 연산 (`src/domain/trips/ops.ts`, `undo.ts`)

- `setLegMode(..., mode: 'car'|'walk'|'transit')`: `transit`이면 `legTransit`에 넣는다(`legModes`는 그대로). `car`·`walk`면 `legTransit`에서 빼고 지금 규칙대로 `legModes`를 고친다.
- 수단을 바꾸면 그 구간의 `legMinutes`를 지운다(다른 수단으로 잰 시간이므로).
- `setLegMinutes(..., minutes: number | null)`: 1~1440 정수만, `null`이면 지운다. 범위 밖은 오류.
- 되돌리기(`undo.ts`)의 최상위 필드 목록에 `legTransit`·`legMinutes`를 더한다(선택 필드라 없음↔있음을 다룬다).

## 화면 (`src/sections/trips/planner/LegRow.tsx`)

- 수단 메뉴에 `대중교통`(아이콘은 기존 Lucide 중 버스·기차 계열 하나).
- 구간 줄에 `시간 직접 입력` 메뉴 항목 → 작은 입력(`inputmode="numeric"`, 분). Enter·저장으로 반영, 비우면 지움. **IME 조합 중 Enter는 무시**(`event.isComposing`). 시작 전에 `modern-web-guidance`로 `ime-safe-enter-submit`, 숫자 입력 가이드를 찾아 읽는다(`DISABLE_TELEMETRY=1`).
- 적은 시간은 `12분 · 직접 입력`, 대중교통 어림은 지금 어림 표시와 같은 방식(`약 …`).
- 길찾기 링크는 실효 수단을 넘긴다. 구글/네이버 선택은 상태(`abroad`)가 아니라 `isAbroadLeg(from, to)`로 정한다(해외 구간에 분을 적으면 상태가 `manual`이 되므로).

## 공유 보기 (`src/share-viewer/`)

- `parse.ts`: v3 받기(위 차이). `render-trip.ts`: 수단 글자 `대중교통`, 상태 `manual`은 `직접 입력`. 해외 구간이라도 `manual`이면 시간을 보인다(지금은 해외면 시간·상태를 숨긴다).
- v2 전용 분기를 v2·v3 둘 다 받게 고친다: `show.ts`(일정 화면 열기), `encode.ts`(경로선 제거), `src/sections/share-import/SharePreview.tsx`(여행 가져오기), `src/sections/share-export/use-short-link.ts`(여행 만료일), `src/sections/share-export/make-share-html.ts`·`pipeline/agent-trip/build-doc.ts`(`ShareDocV2Schema` 검사 → 버전에 맞는 스키마). 그 밖에 `grep -rn "version === 2\|ShareDocV2" src pipeline`로 찾은 곳.

## AI CLI 계획 형식 (`pipeline/agent-trip/`)

```json
{
  "legModes": { "lodging>notredame": "transit", "notredame>louvre": "walk" },
  "legMinutes": { "lodging>notredame": 30 }
}
```

- 키는 `places[].key` 둘을 `>`로 잇는다(지금 `legModes`와 같음). 그날 이웃한 두 장소만.
- `legModes` 값에 `"transit"` 허용. `legMinutes` 값은 1~1440 정수. 수단을 안 정한 구간에도 분을 적을 수 있다(자동 수단 + 적은 분).
- `plan-schema.ts`(스키마·관계 검사·`toPlanPath`), `build-library.ts`(`setLegMode` 다음 `setLegMinutes`), `help.ts`(도움말·예시), `docs/`의 AI CLI 문서를 고친다. 받은함 서버 검사(`src/server/agent/inbox.ts`·`agent-limits.ts`)는 v3를 받는다.

## 하지 않는 것

- 국내 대중교통 경로 조회(서버 `pubtrans`는 약속 기능에 있지만 출발 시각이 필요하다). 어림 + 직접 입력으로 충분하다.
- 구간 요금·환승 표시.

## 순서와 검증

1. 스키마·연산·시간 규칙(`trip.ts`, `geo.ts`, `query.ts`, `ops.ts`, `undo.ts`) + 단위 시험: 옛 문서 통과·키 안 생김, 옛 모양 `TripSchema`(시험 안에서 두 필드 없는 Struct)로 새 문서를 읽으면 통과, `setLegMode`/`setLegMinutes`, 대중교통 어림 값(예: 직선 10km → 13km/20km/h = 39분 + 10분 = 49분), 분 우선.
2. 공유 v3(`show.ts`, `encode.ts`, `SharePreview.tsx`, `use-short-link.ts`, `make-share-html.ts`, `render-trip.ts`, `share.ts`, `build-trip-share.ts`, `check-share-trip.ts`, `read-share.ts`, `import-share-trip.ts`, `share-viewer/parse.ts`·보기, `live-doc.ts`, `agent-limits.ts`, `inbox.ts`) + 시험: 대중교통·분이 없으면 v2 그대로(기존 스냅샷 불변), 있으면 v3, v3 왕복 가져오기.
3. 함께 편집(교차 편집: 한쪽 수단·다른 쪽 분 → 충돌, `plan.ts`, `build-doc.ts`, `merge.ts`, `apply.ts`, `places.ts`, `owner-join.ts`, `store.ts`) + 시험: 분 없는 계획의 `planKey` 불변, 키별 병합.
4. 화면(`LegRow.tsx`, `use-day-plan.ts`, `use-trip-legs.ts`, `use-trip-collab.ts`, `CollabConflictDialog.tsx`) + 시험: 조합 중 Enter 무시, 분 입력·수정·지움 직후 구간 시간과 뒤 정류장 도착 시각 갱신, 대중교통·분 구간이 `routeKeyOf`·요청에 들어가지 않음(예외 없음), 공유 창 완료 집계, 해외 구간 분 표시와 구글 길찾기.
5. AI CLI(`plan-schema.ts`, `build-library.ts`, `route-legs.ts`, `summary.ts`, `help.ts`) + 시험.
6. 릴리스 v0.37.0: `package.json`, `src/sections/help/release-notes.ts`, 도움말(구간 수단 설명), `docs/rollback.md` 행, AI CLI 문서.
7. `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build:ci`.
