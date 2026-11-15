# 관리자 추천 장소 설계

관리자가 고른 라벨의 장소를 정한 기간 동안 모든 사용자(로그인하지 않은 사용자 포함)에게 「추천」으로 보여 주고, 사용자가 골라 자기 보관함에 담게 한다.

- 작성일: 2026-11-15
- 전제: 운영자 1명(관리자) + 소수 사용자, Cloudflare Pages Functions + D1 무료(가즈아와 함께 씀, 읽기 500만·쓰기 10만 행/일). 판단이 갈리면 작은 쪽을 고른다.
- 기존 장치로 안 되는 이유: 공유 링크(`/s/:id`)는 종단 암호화·30일 만료라 「서버가 기간을 보고 모두에게 내려 주기」를 못 하고, 공유 파일은 사람마다 따로 보내야 한다.

## 사용자 결정 (2026-11-15, 다시 묻지 않음)

| 항목 | 결정 |
|---|---|
| 게시 | 앱 안에서(배포 없이 바로 반영) |
| 사용자 화면 | 보관함 카드 + 지도 핀 |
| 추천 내용 | 제목 + 한 줄 설명 + 기간 |
| 보관함과의 관계 | 자동으로 넣지 않는다. 따로 보여 주고 사용자가 골라 담는다 |
| 범위 밖(제안만) | 지역·근처 조건, 매년 반복 기간, 새 추천 알림, 다중 관리자 권한 체계 |

## 작은 쪽으로 정한 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 장소 데이터 | 공유 문서 v1(`ShareDocV1`)을 그대로 스냅숏으로 저장. `labels: []`, 각 장소 `labelIds: []`, 메모 없음 | 가져오기 미리보기·`importShare`·일반 공유 검사(`validateShareValue`)를 그대로 쓰고, 서버가 라벨·메모가 비었는지 따로 검사해 관리자의 다른 라벨·메모가 새지 않게 한다 |
| 추천 id | 게시한 관리자 라벨의 id | 같은 라벨을 다시 게시하면 같은 행을 덮어쓴다(새 id 관리 없음) |
| 기간 | `startDate`·`endDate`(`YYYY-MM-DD`, 둘 다 필수, 양 끝 포함), **한국 시각(UTC+9) 날짜**로 판정 | 사용자가 한국에 있다. 끝 없는 추천은 먼 종료일로 대신한다 |
| 관리자 판별 | Pages 변수 `ADMIN_ACCOUNTS` = `<공급자>:<계정>` 콤마 목록(`kakao:<sub>`, `naver:<sub>`, `google:<이메일>`). 앞뒤 공백 무시, Google 이메일은 대소문자 무시. 변수가 없거나 비면 관리자 없음 | `ALLOWED_ACCOUNTS`와 같은 꼴. Google은 그 목록에 없어서 이메일로 더한다 |
| 관리자임을 앱이 아는 법 | 로그인한 상태에서 라벨 관리 화면을 열 때 관리자 목록 API를 한 번 부른다. 200이면 관리자 화면을 보이고, 403(`not-admin`)·그 밖 실패면 숨긴다 | `/v1/me`·세션 저장 형식을 건드리지 않는다 |
| 경로 | 기존 동기화 라우터(`/api/sync/v1/...`)에 경로를 더한다 | 출처 검사·세션 인증·오류 꼴을 그대로 쓴다 |
| 숨기기·지도 토글 저장 | 새 기기 키 `tripmap:recommend:v1` = `{ hidden: string[], mapOff: boolean }`. 읽지 못하면 기본값(숨긴 것 없음, 지도 켬). 숨긴 id는 현재 공개 목록에 없어도 보존한다 | 추천 전용 상태를 화면 설정 `tripmap:prefs`와 나눠 둔다(prefs 스키마·시험을 건드리지 않음). 공개 목록은 현재 기간 안인 추천만 담고 조회 실패도 빈 목록이므로, 목록 부재를 숨김 기록 삭제 근거로 쓰지 않는다 |
| 숨긴 추천 | 카드와 지도 핀 모두 숨긴다. 다시 보이게 하는 화면은 만들지 않는다(같은 id로 다시 게시돼도 숨김 유지) | 작은 쪽. 필요하면 나중에 설정에 「숨긴 추천 다시 보기」 |
| 지도 핀 | 내 보관함에 이미 있는 장소(`existingShareIds`)는 핀을 그리지 않는다 | 같은 자리에 핀이 겹치지 않는다 |
| 새로 받기 | 앱 시작 때, 그리고 화면으로 돌아올 때(`visibilitychange`)·다시 온라인이 될 때 마지막으로 받은 지 5분이 지났으면 다시 받는다. 주기 타이머는 두지 않는다 | `use-folder-watch-boot.ts`의 화면 복귀 방식과 같다. 켜 둔 화면에서는 최대 「다음 복귀」까지 늦을 수 있고, 그 정도는 감수한다 |
| 카드 자리 | 보관함 목록 위(필터 막대 아래). 보관함이 비어 있는 첫 화면에도 보인다 | 새 사용자에게 가장 쓸모 있다 |

## 서버

### D1 표 (스키마 버전 8 → 9)

```sql
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,            -- 관리자 라벨 id
  title TEXT NOT NULL,            -- 1–30자(라벨 이름 규칙)
  description TEXT NOT NULL,      -- 0–80자, 한 줄
  doc TEXT NOT NULL,              -- ShareDocV1 JSON
  places INTEGER NOT NULL,
  start_date TEXT NOT NULL,       -- YYYY-MM-DD
  end_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

`src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` 끝에 더하고 `SCHEMA_VERSION`을 9로 올린다. 색인은 두지 않는다(행이 최대 30개).

### 경로 (`src/server/library-sync/recommend.ts`, `RECOMMEND_ROUTES`)

| 메서드·경로 | 누구 | 동작 |
|---|---|---|
| `GET /v1/recommendations` | 누구나(세션 없음), `allowWhenOff` | 오늘(KST)이 기간 안인 추천만 `{ items: RecommendationPublic[] }`. 시작일 오름차순, 같으면 id |
| `GET /v1/admin/recommendations` | 관리자 | 기간 지난 것·앞으로의 것 포함 전부(문서 제외, 메타만) `{ items: RecommendationMeta[] }` |
| `POST /v1/admin/recommendations/<id>` | 관리자 | 본문 `{ title, description, startDate, endDate, doc? }`. 있으면 덮어쓰고 없으면 만든다. `doc`이 없으면 기존 문서를 그대로 둔다(없는 행이면 422). 결과 `{ item: RecommendationMeta }` |
| `DELETE /v1/admin/recommendations/<id>` | 관리자 | 지운다. 없으면 404 |

- `RecommendationMeta` = `{ id, title, description, startDate, endDate, places, createdAt, updatedAt }`, `RecommendationPublic` = Meta + `doc`.
- 관리자 아님: 로그인 안 함 401(기존 세션 오류 그대로), 로그인했지만 목록 밖 403 `not-admin`.
- 검사: `id`는 `LabelId` 규칙(`^[a-z0-9]{8}$`, `src/schema/library.ts`), 제목은 `labelNameIssue`가 null, 설명 0–80자·줄바꿈 없음, 날짜는 실제 날짜이고 `endDate >= startDate`, `doc`은 `validateShareValue(doc, 500)` 통과 + `version === 1` + 장소 1곳 이상 + `labels`가 비었고 모든 장소의 `labelIds`가 비었으며 `memo` 키가 없음(관리자의 라벨·메모가 공개되지 않게). 어긋나면 422 `invalid`(`path` 붙임). 본문 상한 600,000바이트(`readJson`, 넘으면 기존대로 413 `too-large`). 행 수 상한 30개(새로 만들 때만, 넘으면 422 `too-many`).
- 하루 쓰기 한도: 관리자당 `recommend-write` 100회(`consumeCounter`). `POST`만 센다. `DELETE`는 한도를 쓰지 않는다(서버 백업 지우기와 같음).
- `LIBRARY_SYNC=off`면 게시(`POST /v1/admin/...`)만 기존처럼 503이다. 공개 읽기, 관리자 목록(`GET`), 관리자 `DELETE`는 `allowWhenOff`로 계속된다(기존 「끄면 쓰기는 멈추고 목록·지우기·철회는 계속」 규칙과 같음). 관리자 화면은 목록 API가 200이어야 보이므로 목록도 열어 둔다. 그래서 잘못 게시한 추천은 스위치를 꺼도, 한도를 다 써도 `게시한 추천` › `내리기`로 바로 내릴 수 있다(반영은 아래 엣지 캐시대로 최대 60초).
- 엣지 캐시: 공개 읽기는 `Cache-Control: public, max-age=60` 사본을 `caches.default`에만 넣고(브라우저 응답은 `handler.ts`의 기존 방식대로 `private, no-store`) 키 `${CACHE_ORIGIN}/recommendations/<KST 날짜>`로 넣고 먼저 꺼내 본다(날짜가 키에 있어 자정에 새로 읽는다). 관리자가 쓰거나 지우면 그 키를 지운다(같은 데이터센터만, 다른 곳은 최대 60초 늦게 반영). `caches`가 없는 시험·Node에서는 건너뛴다(`handler.ts`의 기존 함수).
- D1 사용량: 공개 읽기 한 번 = 데이터센터·분당 최대 1회 × 행 최대 30개. 무시할 만하다.

## 앱

### 데이터 (`src/services/recommend/`)

- `api.ts`: `fetchRecommendations()` = 세션 없이 `GET /api/sync/v1/recommendations`(타임아웃 8초). 결과는 `{ ok: true, items } | { ok: false }`(실패·오프라인·꼴이 틀림). 각 `doc`을 `validateShareValue`로 다시 검사해 틀린 추천은 뺀다. 관리자 함수 `listAdmin`·`publish`·`remove`는 `getSharedSyncApi().client.send`(세션 붙음).
- `prefs.ts`: `tripmap:recommend:v1` 읽기·쓰기(저장소가 막히면 메모리).
- `src/stores/recommend.ts`: `recommendationsAtom`(위 「새로 받기」 규칙, 받기 전은 빈 목록. 성공하면 받은 목록(빈 목록이면 비움)으로 바꾸고, 실패하면 앞서 받은 목록을 그대로 둔다. 처음부터 실패하면 빈 목록이라 아무것도 그리지 않는다), `recommendPrefsAtom`, 숨기지 않은 추천만 주는 `visibleRecommendationsAtom`.

### 보관함 카드 (`src/sections/recommend/RecommendCards.tsx`)

- 숨기지 않은 추천이 있을 때만 보관함 목록 위에 가로로 넘기는 카드 줄(`ChipScrollRow`처럼). 카드: 제목, 설명(한 줄 말줄임), `N곳 · MM.DD–MM.DD`, 오른쪽 위 `숨기기`(×, 접근 이름 「<제목> 추천 숨기기」).
- 카드를 누르면 추가 흐름 `{ step: 'share', doc, recommend: { id, title, description, startDate, endDate } }`을 연다.

### 미리보기 재사용 (`SharePreview`)

- `recommend`가 있으면: 머리글은 `<recommend.title> · N곳`(문서 없이 제목만 고쳐 `doc.title`이 옛 값이어도 메타 제목을 쓴다), 둘째 줄을 `<설명>`·`<기간> 추천`으로 바꾸고, 스위치 글은 `추천 제목 라벨도 붙이기`, 입력 이름표는 `추천 제목 라벨 이름`. 기본 이름은 `recommend.title`. 나머지(이미 있음, 라벨만 더하기, 가져오기 토스트, 제목 라벨로 거르기)는 그대로.
- 흐름에 `focusPlaceId`가 있으면 처음 고른 장소를 그 하나로 한다(지도 핀에서 왔을 때). 없으면 모든 장소.
- 미리보기를 닫지 않고 다른 카드·핀을 누르면 상태(선택·제목 라벨 스위치·이름)를 새로 시작해야 한다. `addFlowStepKey`가 추천 흐름에 `share-recommend-<id>-<focusPlaceId 또는 all>`을 돌려줘 화면이 다시 마운트되게 한다(받은함 흐름의 `share-inbox-<id>`와 같은 방식).

### 지도 핀 (`LibraryMap`)

- 지도 켬(`mapOff` 아님)일 때 숨기지 않은 추천의 장소 중 내 보관함에 없는 것을 마커로 더한다. id `rec:<추천 id>:<장소 id>`, 이름 앞 `☆ `, 바탕 표면색·테두리 강조색·`dimmed: true`로 내 장소와 구별, `fit: false`(다른 맞출 마커가 있으면 지도 맞추기에서 뺌. `camera.ts`의 `fitPoints`는 맞출 마커가 하나도 없으면 `fit: false` 마커로 맞추므로, 보관함이 비었거나 필터 결과가 없으면 추천 장소에 맞춰진다. 기존 동작을 그대로 따른다). 여러 추천에 같은 장소가 있으면 먼저 나온 추천 것 하나만.
- 누르면 그 추천의 미리보기를 `focusPlaceId`로 연다.
- 지도 위 토글 버튼 `추천 장소`(눌림 상태 `aria-pressed`). 보일 추천이 없으면 버튼도 숨긴다. 상태는 `mapOff`에 저장.

### 관리자 화면 (`src/sections/recommend/admin/`)

- 라벨 관리 화면에서 로그인했고 관리자 목록 API가 200을 주면:
  - 라벨 줄 메뉴에 `추천으로 게시`. 창: 제목(기본 라벨 이름, 그 라벨로 이미 게시했으면 그 값), 한 줄 설명, 시작일(기본 오늘), 종료일(기본 오늘+30일). `게시`를 누르면 그 라벨의 살아 있는 장소로 `buildShareDoc(includeMemo: false)`를 만들고 라벨을 비워 `POST`. 장소가 없거나 500곳을 넘으면 버튼을 끄고 「추천은 500곳까지예요」를 보인다. 이미 게시한 라벨이면 단추 글은 `다시 게시`(장소도 지금 것으로 바뀜).
  - 화면 아래 `게시한 추천` 목록: 제목, `N곳 · 기간`, 상태(`게시 중`·`예정`·`끝남`), `수정`(같은 창, 문서 없이 제목·설명·기간만 보냄), `내리기`(확인 후 `DELETE`).
- 결과는 토스트. 성공하면 앱의 `recommendationsAtom`도 다시 받는다.

### 실패 처리

- 공개 읽기가 실패하면 오류 문구 없이 앞서 받은 목록을 그대로 쓴다(처음이면 카드·핀·토글이 없다).
- 관리자 쓰기 실패는 토스트(`잠시 뒤 다시 시도해 주세요`, 422는 `입력을 확인해 주세요`, 413은 `추천이 너무 커요`, 403은 `관리자만 할 수 있어요`).

## 문서

- `docs/development.md`: 환경변수 표에 `ADMIN_ACCOUNTS`, 「관리자 추천」 절(경로·D1 표·한도·캐시·로컬에서 해 보기).
- 도움말: `scripts/motion/help-pages.mjs`의 보관함·라벨 쪽에 추천 카드·숨기기·지도 토글, 관리자 게시 설명 → `yarn build:motion`.
- `docs/rollback.md`: 새 버전 줄. 옛 버전으로 되돌려도 보관함 형식은 그대로, 새 키 `tripmap:recommend:v1`·D1 `recommendations` 표는 옛 버전이 무시.

## 시험

- 단위(`tests/unit/server/recommend.test.ts`): 관리자 판별(변수 없음·빈 값·목록 안·밖·Google 대소문자), 비관리자 403·비로그인 401, 기간 거르기(KST 경계: 시작일 당일·종료일 당일 포함, 전날·다음 날 제외), 문서 없는 새 행 422, 행 상한, 덮어쓰기.
- e2e(`tests/e2e/recommend.spec.ts`, desktop): 추천 API를 가로채(`page.route`) 추천 하나를 준 뒤 카드 → 미리보기 → 담기 → 추천 제목 라벨로 걸러진 목록에 장소가 보인다.
- 단위(`tests/unit/services/recommend.test.ts`): 숨긴 뒤 빈 목록을 받고 다시 읽은 다음 같은 id가 돌아와도 숨겨진 채인지, 서버 검사가 라벨·메모가 든 문서를 422로 거절하는지(서버 시험 쪽).
- e2e는 하나만 둔다. 카드 → 미리보기 → 담기를 보고, 응답의 `title`과 `doc.title`을 다르게 줘 머리글·기본 라벨 이름이 메타 제목인지 함께 본다.

## 사람이 할 일

- 운영 Pages 변수 `ADMIN_ACCOUNTS`에 관리자 계정을 넣고 다시 배포(값 예: `google:<운영자 이메일>` 또는 허용 목록 거절 화면이 알려 주는 것과 같은 `kakao:<sub>`·`naver:<sub>`).
- 실기기에서 카드·지도 핀·게시 화면 확인.
