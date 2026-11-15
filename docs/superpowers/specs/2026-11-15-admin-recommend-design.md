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
| 장소 데이터 | 공유 문서 v1(`ShareDocV1`)을 그대로 스냅숏으로 저장. `labels: []`, 각 장소 `labelIds: []`, 메모 없음 | 가져오기 미리보기·`importShare`·서버 검사(`validateShareValue`)를 그대로 쓴다. 관리자의 다른 라벨·메모가 새지 않는다 |
| 추천 id | 게시한 관리자 라벨의 id | 같은 라벨을 다시 게시하면 같은 행을 덮어쓴다(새 id 관리 없음) |
| 기간 | `startDate`·`endDate`(`YYYY-MM-DD`, 둘 다 필수, 양 끝 포함), **한국 시각(UTC+9) 날짜**로 판정 | 사용자가 한국에 있다. 끝 없는 추천은 먼 종료일로 대신한다 |
| 관리자 판별 | Pages 변수 `ADMIN_ACCOUNTS` = `<공급자>:<계정>` 콤마 목록(`kakao:<sub>`, `naver:<sub>`, `google:<이메일>`). 앞뒤 공백 무시, Google 이메일은 대소문자 무시. 변수가 없거나 비면 관리자 없음 | `ALLOWED_ACCOUNTS`와 같은 꼴. Google은 그 목록에 없어서 이메일로 더한다 |
| 관리자임을 앱이 아는 법 | 로그인한 상태에서 라벨 관리 화면을 열 때 관리자 목록 API를 한 번 부른다. 200이면 관리자 화면을 보이고, 403(`not-admin`)·그 밖 실패면 숨긴다 | `/v1/me`·세션 저장 형식을 건드리지 않는다 |
| 경로 | 기존 동기화 라우터(`/api/sync/v1/...`)에 경로를 더한다 | 출처 검사·세션 인증·오류 꼴을 그대로 쓴다 |
| 숨기기·지도 토글 저장 | 새 기기 키 `tripmap:recommend:v1` = `{ hidden: string[], mapOff: boolean }`. 읽지 못하면 기본값(숨긴 것 없음, 지도 켬) | 화면 설정 `tripmap:prefs`에 필드를 더하면 옛 버전이 선호 전체를 버린다(`prefs.ts` 주석). 숨긴 id는 지금 받은 추천에 없는 것을 읽을 때 지운다 |
| 숨긴 추천 | 카드와 지도 핀 모두 숨긴다. 다시 보이게 하는 화면은 만들지 않는다(같은 id로 다시 게시돼도 숨김 유지) | 작은 쪽. 필요하면 나중에 설정에 「숨긴 추천 다시 보기」 |
| 지도 핀 | 내 보관함에 이미 있는 장소(`existingShareIds`)는 핀을 그리지 않는다 | 같은 자리에 핀이 겹치지 않는다 |
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
- 검사: `id`는 라벨 id 꼴(`^[A-Za-z0-9_-]{1,64}$`), 제목은 `labelNameIssue`가 null, 설명 0–80자·줄바꿈 없음, 날짜는 실제 날짜이고 `endDate >= startDate`, `doc`은 `validateShareValue(doc, 500)` 통과 + `version === 1` + 장소 1곳 이상. 본문 상한 600,000바이트(`readJson`). 어긋나면 422 `invalid`(`path` 붙임). 행 수 상한 30개(새로 만들 때만, 넘으면 422 `too-many`).
- 하루 쓰기 한도: 관리자당 `recommend-write` 100회(`consumeCounter`).
- `LIBRARY_SYNC=off`면 관리자 경로는 기존처럼 503, 공개 읽기는 계속된다.
- 엣지 캐시: 공개 읽기는 `Cache-Control: public, max-age=60` 응답을 `caches.default`에 키 `${CACHE_ORIGIN}/recommendations/<KST 날짜>`로 넣고 먼저 꺼내 본다(날짜가 키에 있어 자정에 새로 읽는다). 관리자가 쓰거나 지우면 그 키를 지운다(같은 데이터센터만, 다른 곳은 최대 60초 늦게 반영). `caches`가 없는 시험·Node에서는 건너뛴다(`handler.ts`의 기존 함수).
- D1 사용량: 공개 읽기 한 번 = 데이터센터·분당 최대 1회 × 행 최대 30개. 무시할 만하다.

## 앱

### 데이터 (`src/services/recommend/`)

- `api.ts`: `fetchRecommendations()` = 세션 없이 `GET /api/sync/v1/recommendations`(타임아웃 8초). 실패·오프라인·꼴이 틀리면 `[]`. 각 `doc`을 `validateShareValue`로 다시 검사해 틀린 추천은 뺀다. 관리자 함수 `listAdmin`·`publish`·`remove`는 `getSharedSyncApi().client.send`(세션 붙음).
- `prefs.ts`: `tripmap:recommend:v1` 읽기·쓰기(저장소가 막히면 메모리).
- `src/stores/recommend.ts`: `recommendationsAtom`(앱 시작 때 한 번 받음, 받기 전·실패는 빈 목록), `recommendPrefsAtom`, 숨기지 않은 추천만 주는 `visibleRecommendationsAtom`.

### 보관함 카드 (`src/sections/recommend/RecommendCards.tsx`)

- 숨기지 않은 추천이 있을 때만 보관함 목록 위에 가로로 넘기는 카드 줄(`ChipScrollRow`처럼). 카드: 제목, 설명(한 줄 말줄임), `N곳 · MM.DD–MM.DD`, 오른쪽 위 `숨기기`(×, 접근 이름 「<제목> 추천 숨기기」).
- 카드를 누르면 추가 흐름 `{ step: 'share', doc, recommend: { id, title, description, startDate, endDate } }`을 연다.

### 미리보기 재사용 (`SharePreview`)

- `recommend`가 있으면: 둘째 줄을 `<설명>`·`<기간> 추천`으로 바꾸고, 스위치 글은 `추천 제목 라벨도 붙이기`, 입력 이름표는 `추천 제목 라벨 이름`. 기본 이름은 추천 제목. 나머지(이미 있음, 라벨만 더하기, 가져오기 토스트, 제목 라벨로 거르기)는 그대로.
- 흐름에 `focusPlaceId`가 있으면 처음 고른 장소를 그 하나로 한다(지도 핀에서 왔을 때).

### 지도 핀 (`LibraryMap`)

- 지도 켬(`mapOff` 아님)일 때 숨기지 않은 추천의 장소 중 내 보관함에 없는 것을 마커로 더한다. id `rec:<추천 id>:<장소 id>`, 이름 앞 `☆ `, 바탕 표면색·테두리 강조색·`dimmed: true`로 내 장소와 구별, `fit: false`(지도 맞추기에서 뺌). 여러 추천에 같은 장소가 있으면 먼저 나온 추천 것 하나만.
- 누르면 그 추천의 미리보기를 `focusPlaceId`로 연다.
- 지도 위 토글 버튼 `추천 장소`(눌림 상태 `aria-pressed`). 보일 추천이 없으면 버튼도 숨긴다. 상태는 `mapOff`에 저장.

### 관리자 화면 (`src/sections/recommend/admin/`)

- 라벨 관리 화면에서 로그인했고 관리자 목록 API가 200을 주면:
  - 라벨 줄 메뉴에 `추천으로 게시`. 창: 제목(기본 라벨 이름, 그 라벨로 이미 게시했으면 그 값), 한 줄 설명, 시작일(기본 오늘), 종료일(기본 오늘+30일). `게시`를 누르면 그 라벨의 살아 있는 장소로 `buildShareDoc(includeMemo: false)`를 만들고 라벨을 비워 `POST`. 장소가 없으면 버튼을 끈다. 이미 게시한 라벨이면 단추 글은 `다시 게시`(장소도 지금 것으로 바뀜).
  - 화면 아래 `게시한 추천` 목록: 제목, `N곳 · 기간`, 상태(`게시 중`·`예정`·`끝남`), `수정`(같은 창, 문서 없이 제목·설명·기간만 보냄), `내리기`(확인 후 `DELETE`).
- 결과는 토스트. 성공하면 앱의 `recommendationsAtom`도 다시 받는다.

### 실패 처리

- 공개 읽기가 실패하면 카드·핀·토글을 그리지 않는다(오류 문구 없음).
- 관리자 쓰기 실패는 토스트(`잠시 뒤 다시 시도해 주세요`, 422는 `입력을 확인해 주세요`, 403은 `관리자만 할 수 있어요`).

## 문서

- `docs/development.md`: 환경변수 표에 `ADMIN_ACCOUNTS`, 「관리자 추천」 절(경로·D1 표·한도·캐시·로컬에서 해 보기).
- 도움말: `scripts/motion/help-pages.mjs`의 보관함·라벨 쪽에 추천 카드·숨기기·지도 토글, 관리자 게시 설명 → `yarn build:motion`.
- `docs/rollback.md`: 새 버전 줄. 옛 버전으로 되돌려도 보관함 형식은 그대로, 새 키 `tripmap:recommend:v1`·D1 `recommendations` 표는 옛 버전이 무시.

## 시험

- 단위(`tests/unit/server/recommend.test.ts`): 관리자 판별(변수 없음·빈 값·목록 안·밖·Google 대소문자), 비관리자 403·비로그인 401, 기간 거르기(KST 경계: 시작일 당일·종료일 당일 포함, 전날·다음 날 제외), 문서 없는 새 행 422, 행 상한, 덮어쓰기.
- e2e(`tests/e2e/recommend.spec.ts`, desktop): 추천 API를 가로채(`page.route`) 추천 하나를 준 뒤 카드 → 미리보기 → 담기 → 추천 제목 라벨로 걸러진 목록에 장소가 보인다.

## 사람이 할 일

- 운영 Pages 변수 `ADMIN_ACCOUNTS`에 관리자 계정을 넣고 다시 배포(값 예: `google:<운영자 이메일>` 또는 허용 목록 거절 화면이 알려 주는 것과 같은 `kakao:<sub>`·`naver:<sub>`).
- 실기기에서 카드·지도 핀·게시 화면 확인.
