# 장소 추가 (하위 프로젝트 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 링크 붙여넣기(네이버·카카오·구글), 네이버 공유 폴더 가져오기, 지도에서 핀 찍기로 보관함에 장소를 넣는다.

**Architecture:** Cloudflare Pages Functions(`functions/api/place.ts`, `functions/api/naver-folder.ts`)가 링크를 풀고 정규화한 결과를 돌려준다. 해석 로직은 `src/server/`(순수 함수 + 주입한 `fetch`)에 두어 함수와 테스트가 함께 쓴다. 앱은 Effect 서비스 `PlaceLookup`·`ReverseGeocoder`로 서버·SDK를 부르고, 도메인 연산 `addPlace`·`importFolder`로 `LibraryStore.update` 한 번에 저장한다.

**Tech Stack:** TypeScript 6, React 19, MUI 7, Jotai, Effect 4.0.2, Vite 8, Vitest 5, Playwright, Cloudflare Pages Functions(`wrangler`).

**Spec:** `docs/superpowers/specs/2026-10-12-place-adding-design.md`

## Global Constraints

- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`. 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 사용자 문자열은 `textContent`/React 텍스트로만 넣는다(`dangerouslySetInnerHTML`·`innerHTML` 금지).
- 파일에 U+2028/U+2029 원문자 금지(편집 도구가 이스케이프를 실제 문자로 바꾼 전례). 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 저장 형식 `schemaVersion`은 2 그대로. 저장 키(`tripmap:*`) 바꾸지 않는다.
- 서버 오류 코드와 HTTP 상태: `UNSUPPORTED_LINK` 400, `NOT_FOUND` 404, `FORBIDDEN_ORIGIN` 403, `TOO_MANY_PLACES` 413, `UPSTREAM_ERROR` 502, `TIMEOUT` 504. 앱 쪽 연결 실패는 `OFFLINE`.
- 허용 출처: `https://landmark-c5f.pages.dev`, `https://*.landmark-c5f.pages.dev`, `http://localhost:5173`, `http://localhost:8788`.
- 바깥 요청 시한 8초, 이동 따라가기 최대 3번(매번 허용 목록 재검사), 폴더 최대 1,000곳, 캐시 장소 1일·폴더 10분.
- 고정 문구(스펙 §2·§5):
  - 확인 중: `장소를 찾는 중…` / 폴더 안내: `네이버 공유 폴더 링크를 붙여 넣어 주세요`
  - `링크를 붙여 넣어 주세요` / `네이버·카카오·구글 지도의 장소 링크만 넣을 수 있어요` / `장소를 찾지 못했어요. 링크를 다시 확인해 주세요` / `위치를 알 수 없는 링크예요. 지도에서 위치를 맞춰 주세요` / `지금은 장소 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요` / `인터넷 연결을 확인하고 다시 시도해 주세요` / `장소가 너무 많은 폴더예요(최대 1,000곳)` / `주소를 찾지 못했어요. 직접 입력해 주세요` / `라벨 이름은 30자까지예요`
  - 이미 있음: `이미 있는 장소예요. 고른 라벨만 더할게요` / 버튼 `라벨 더하기`, `추가`, `취소`, `다시 시도`, `지도에서 핀으로 추가`, `여기에 추가`, `<N>곳 가져오기`
  - 핀 안내: `지도를 움직여 위치를 맞추세요` / 토스트: `추가했어요`, 폴더 결과는 세 가지 문장만 쓴다 — 둘 다 1 이상 `<새 수>곳을 새로 넣고, <합친 수>곳은 라벨만 더했어요` / 합친 것 0 `<새 수>곳을 새로 넣었어요` / 새것 0 `<합친 수>곳은 라벨만 더했어요`
- `wrangler`는 devDependency로 정확한 버전 고정(2주 이상 된 버전).

## Review Focus

1. 네이버 앱 "공유 → 복사"는 `[네이버 지도]\n콤포트\nhttps://naver.me/…`처럼 **링크 앞뒤에 글자가 붙는다** → 붙여 넣은 글에서 첫 `http(s)://` 링크를 뽑아 쓴다. Task 7 테스트로 고정.
2. 구글 장소 이름의 `+`·퍼센트 인코딩(`이재모피자+본점`) → `이재모피자 본점`으로 풀어야 한다. Task 3 테스트로 고정.
3. 폴더에 좌표가 없거나(`px`/`py` 비정상) `available: false`인 북마크 → 건너뛰고 미리보기에서 빼며 개수에 넣지 않는다. Task 4 테스트로 고정.
4. 같은 링크로 같은 메모를 두 번 추가 → 메모가 중복으로 두 번 붙지 않아야 한다(이미 같은 줄이 끝에 있으면 덧붙이지 않음). Task 2 테스트로 고정.
5. 서버 함수 없이 `yarn dev`만 띄운 상태에서는 `/api` 응답이 HTML(SPA 기본 페이지)이거나 `error` 본문 없는 404다 → 앱은 이를 `OFFLINE`으로 다뤄 `인터넷 연결을 확인하고 다시 시도해 주세요`를 보이고, 콘솔에 원인(`yarn dev:full`로 띄울 것)을 한 번 경고한다. Task 6 테스트로 고정.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/schema/library.ts` | `PlaceSource`에 `kakao`·`google` 추가, 중복 불변식 |
| `src/domain/library/add-place.ts` | `PlaceCandidate`, `findExisting`, `addPlace`, `planFolderImport`, `importFolder` |
| `src/server/links.ts` | 링크 분류(순수) |
| `src/server/plus-code.ts` | Open Location Code 디코드 |
| `src/server/resolve.ts` | 이동 따라가기·허용 목록·서비스별 조회 → `ResolvedPlace` / 폴더 |
| `src/server/http.ts` | 오류 코드·`ApiError`·응답 만들기·출처 검사·캐시 |
| `functions/api/place.ts`, `functions/api/naver-folder.ts` | Pages Functions 진입점(얇게) |
| `pipeline/naver-client.ts` | `fetchFolder`에 `maxCount` 추가 |
| `src/services/place-lookup.ts` | `PlaceLookup` Effect 서비스(`/api` 호출) |
| `src/services/reverse-geocoder.ts` | `ReverseGeocoder` Effect 서비스(SDK geocoder) |
| `src/components/map/load-naver-sdk.ts` | geocoder 하위 모듈을 함께 불러온다 |
| `src/stores/add-place.ts` | 추가 흐름 상태(jotai): 입력 창·후보·핀 모드 |
| `src/sections/add-place/*` | `LinkInputPanel`, `CandidateCard`, `FolderPreview`, `PinModeOverlay`, `PinCard`, `AddPlaceHost`(레이아웃별 시트/칸) |
| `src/sections/shell/AddSheet.tsx` | 세 항목 활성화 |
| `src/sections/map/LibraryMap.tsx`, `src/components/map/MapView.tsx` | 임시 후보 마커, 핀 모드 조준점·중심 좌표 |
| `tests/fixtures/links/*` | 녹화한 실제 응답 |
| `tests/e2e/place-adding.spec.ts` | E2E |

---

### Task 1: 장소 출처에 카카오·구글 추가

**Files:**
- Modify: `src/schema/library.ts`
- Test: `tests/unit/schema/library.test.ts`(있으면 그 파일, 없으면 새 파일)

**Interfaces:**
- Produces: `PlaceSource` 유니온에 `{ kind: 'kakao'; kakaoId: string }`(숫자 문자열, `^\d+$`), `{ kind: 'google'; googleId: string }`(`^0x[0-9a-f]+:0x[0-9a-f]+$`). 불변식: 살아 있는 장소 중 같은 `kakaoId`·같은 `googleId`가 둘이면 이슈(`카카오 장소가 중복됩니다: <id>`, `구글 장소가 중복됩니다: <id>`).

- [ ] **Step 1: 실패하는 테스트**: 카카오·구글 출처 장소가 디코드되고 인코드 왕복이 같음; `kakaoId: 'abc'`·`googleId: '123'`은 거부; 살아 있는 장소 둘이 같은 `kakaoId`면 검증 실패(메시지 포함), 하나가 지워졌으면 통과; 구글도 같음; 기존 네이버·핀 테스트 그대로 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/schema` → FAIL
- [ ] **Step 3:** 구현. 기존 네이버 `seenSid` 검사와 같은 모양으로 두 검사 추가.
- [ ] **Step 4:** PASS + `yarn test`(출처 `switch`가 있는 곳의 타입 오류를 고친다: `regionOf`, 공유 데이터 `naverSid` 등은 네이버일 때만 쓰도록 이미 되어 있는지 확인) + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library): 장소 출처에 카카오·구글을 더한다`

---

### Task 2: 장소 추가·폴더 가져오기 도메인 연산

**Files:**
- Create: `src/domain/library/add-place.ts`
- Test: `tests/unit/domain/library/add-place.test.ts`

**Interfaces:**
- Consumes: `PlaceSource`(Task 1), `OpCtx`·`OpResult`(`ops.ts`), `normalizeLabelName`·`LABEL_COLORS`·`LIBRARY_LIMITS`(`schema/library.ts`), `truncateMemo`(`legacy-import.ts`)
- Produces:
  ```ts
  export type PlaceCandidate = { source: PlaceSource; name: string; address: string; lng: number; lat: number; category: string | null };
  export function sourceKey(source: PlaceSource): string | null; // 'naver:<sid>' | 'kakao:<id>' | 'google:<id>' | 옛 핀 'pin:<publicId>/<placeKey>' | 직접 핀 null
  export function findExisting(lib: Library, source: PlaceSource): Place | undefined; // 살아 있는 것 우선, 없으면 지운 것
  export function addPlace(lib: Library, candidate: PlaceCandidate, input: { labelIds: string[]; memo: string }, ctx: OpCtx): OpResult; // createdId = 결과 장소 id(새로 만든 것·합친 것·되살린 것 모두)
  export type FolderItem = { sid: string; name: string; address: string; lng: number; lat: number; memo: string };
  export type FolderPlan = { create: FolderItem[]; merge: { item: FolderItem; placeId: string }[] };
  export function planFolderImport(lib: Library, items: FolderItem[]): FolderPlan;
  export function importFolder(lib: Library, items: FolderItem[], label: { labelId: string } | { newLabelName: string }, ctx: OpCtx): OpResult; // createdId = 쓴 라벨 id
  ```
- 규칙(스펙 §3.4·§3.5): 새로 만들기 / 같은 출처의 살아 있는 장소면 라벨 합치기 + (링크일 때만) 메모 덧붙이기 / 지운 장소면 되살리고 같은 규칙. 메모 덧붙이기는 `기존 + '\n' + 새 메모`, 10,000자 넘으면 `truncateMemo`. 폴더 라벨: 정규형이 같은 살아 있는 라벨 재사용, 없으면 새 라벨(이름 30자 넘으면 `LabelNameInvalid`), 색은 살아 있는 라벨이 쓰지 않은 첫 `LABEL_COLORS`(다 쓰였으면 `order` 기준 다음 색). 폴더 메모는 새 장소에만 넣는다.

- [ ] **Step 1: 실패하는 테스트**
  - `addPlace` 새 장소: 필드(이름·주소·좌표·분류·라벨·메모·`saved: true`·`createdAt = ctx.now`), `createdId`
  - 같은 `sid` 살아 있음 → 새로 만들지 않음, 라벨 합집합(순서: 기존 뒤에 새 것, 중복 없음), 메모 `'A'` + 새 `'B'` → `'A\nB'`, 이름·주소 그대로
  - **같은 메모를 다시 덧붙이면 그대로**(`'A\nB'` + `'B'` → `'A\nB'`) (Review Focus 4)
  - 빈 메모면 메모 필드 갱신 안 함(`updatedAt` 그대로)
  - 지운 장소 → `deletedAt: null`로 되살림 + 합치기
  - 메모 합쳐 10,000자 초과 → 길이 ≤ 10,000, 생략 표시로 끝남
  - 카카오·구글 출처도 같은 규칙, 직접 핀(`legacy` 없음)은 항상 새로 만듦
  - 없는 라벨 id → `{ ok: false, error: { _tag: 'NotFound' } }`
  - `planFolderImport`: 기존 `sid`는 `merge`, 나머지 `create`
  - `importFolder`: 새 라벨 생성(색 규칙), 같은 이름(대소문자·공백만 다름) 라벨 재사용, 기존 장소 라벨만 추가·메모 불변, 새 장소 메모 = 폴더 메모(10,000자 자름), 결과가 `LibrarySchema` 검증 통과, 31자 이름 → `LabelNameInvalid`
- [ ] **Step 2:** FAIL 확인 → **Step 3:** 구현 → **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library): 링크·폴더로 장소를 넣는 도메인 연산`

---

### Task 3: 링크 분류와 Plus Code

**Files:**
- Create: `src/server/links.ts`, `src/server/plus-code.ts`
- Test: `tests/unit/server/links.test.ts`, `tests/unit/server/plus-code.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // links.ts — 네트워크 없이 URL만 본다
  export type LinkKind =
    | { kind: 'redirect'; url: string }                 // naver.me, kko.to, maps.app.goo.gl, goo.gl/maps
    | { kind: 'naver-place'; sid: string }
    | { kind: 'naver-folder'; shareId: string }
    | { kind: 'kakao-place'; kakaoId: string }
    | { kind: 'google-place'; name: string; googleId: string | null; lat: number | null; lng: number | null; plusCode: string | null }
    | { kind: 'unsupported' };
  export function classifyLink(raw: string): LinkKind;
  export const ALLOWED_HOSTS: readonly string[]; // 스펙 §4.2·§4.3 호스트 전부(조회 API 호스트 포함)
  // plus-code.ts
  export function decodePlusCode(code: string): { lat: number; lng: number } | null; // 전역 코드(8자 이상 + '+')만, 셀 중심
  ```
- 분류 규칙은 스펙 §4.2 표 그대로. 구글: `/maps/place/<이름>/`의 이름은 `decodeURIComponent` 후 `+`를 공백으로, `!1s(0x[0-9a-f]+:0x[0-9a-f]+)`, `!3d(위도)!4d(경도)` 또는 `@(위도),(경도)`, `!20s(<Plus Code>)`. 허용 호스트가 아니거나 `http(s)`가 아니면 `unsupported`.

- [ ] **Step 1: 실패하는 테스트 (links)** — 스펙 §1.3의 실제 값으로:
  - `https://naver.me/Fk73Vab5` → redirect
  - `https://map.naver.com/p/entry/place/1958911015?placePath=%2Fhome` → `naver-place 1958911015`; 사용자 예시 웹 주소(`…/place/1540168051?c=12.33,0,0,0,dh&placePath=/home?bookmarkId%3D…`) → `1540168051`; `https://m.place.naver.com/restaurant/12028621/home` → `12028621`
  - `https://map.naver.com/p/search/콤포트/place/1540168051` → `1540168051`; `https://pcmap.place.naver.com/restaurant/12028621/home` → `12028621`
  - `https://map.naver.com/p/favorite/sharedPlace/folder/fb65e7f93f8a4144a4ded594d604a7aa` → folder
  - `https://kko.to/MWuG8x8eN4` → redirect; `https://applink.map.kakao.com/place?id=16990385` → `kakao-place 16990385`; `https://place.map.kakao.com/16990385` → 같음
  - 스펙의 구글 장소 주소 → `name: '이재모피자 본점'`, `googleId: '0x1520f8eed52456f1:0x129df2a4704f8520'`, `plusCode: '8Q7F422J+R6X'`, `lat/lng: null` (Review Focus 2)
  - `!3d35.1!4d129.0`이 있는 구글 주소 → 좌표 그대로
  - `https://evil.example.com/map.naver.com/p/entry/place/1`, `javascript:…`, `ftp://naver.me/x`, 빈 문자열 → unsupported
- [ ] **Step 2: 실패하는 테스트 (plus-code)**: Open Location Code 공식 테스트 예(`8FVC9G8F+6X` → 위도 47.365562, 경도 8.524813 근처, 오차 1e-5 이내), `8Q7F422J+R6X` → 부산 서면 근처(위도 35.15~35.16, 경도 129.05~129.07), 짧은 코드(`9G8F+6X`)·잘못된 문자 → null
- [ ] **Step 3:** FAIL → **Step 4:** 구현(OLC 디코드는 공식 알고리즘: 20진 알파벳 `23456789CFGHJMPQRVWX`, 쌍 자리 해상도 20,1,.05,.0025,.000125 후 그리드 자리 4×5 세분) → **Step 5:** PASS
- [ ] **Step 6:** 커밋 `feat(server): 지도 링크 분류와 Plus Code 해석`

---

### Task 4: 링크 해석·폴더 조회 (서버 로직)

**Files:**
- Create: `src/server/resolve.ts`, `src/server/http.ts`
- Modify: `pipeline/naver-client.ts`(`fetchFolder`에 `maxCount`, 초과 시 `TooManyPlacesError`), 관련 테스트
- Create: `tests/fixtures/links/`(실제 응답 녹화: 네이버 장소 1958911015·1540168051, 카카오 panel3 16990385(필요 필드만 남겨 줄인 JSON), `naver.me/Fk73Vab5`·`kko.to/MWuG8x8eN4`·`maps.app.goo.gl/SsZWtW1xgZVgijxK6`의 Location 값, 공유 폴더 1쪽)
- Test: `tests/unit/server/resolve.test.ts`, `tests/unit/server/http.test.ts`

**Interfaces:**
- Consumes: `classifyLink`·`ALLOWED_HOSTS`·`decodePlusCode`(Task 3), `fetchPlaceSummary`·`fetchFolder`(`pipeline/naver-client.ts`)
- Produces:
  ```ts
  // http.ts
  export type ApiErrorCode = 'UNSUPPORTED_LINK' | 'NOT_FOUND' | 'FORBIDDEN_ORIGIN' | 'TOO_MANY_PLACES' | 'UPSTREAM_ERROR' | 'TIMEOUT';
  export class ApiError extends Error { constructor(readonly code: ApiErrorCode, message: string, readonly reason?: 'no-location'); }
  export const STATUS: Record<ApiErrorCode, number>;
  export function isAllowedOrigin(origin: string | null): boolean;
  export function jsonResponse(body: unknown, init?: ResponseInit): Response;
  export function errorResponse(e: unknown): Response; // ApiError → 해당 상태, 그 밖 → UPSTREAM_ERROR(502)
  // resolve.ts
  export type ResolvedPlace = { kind: 'place'; provider: 'naver' | 'kakao' | 'google'; providerId: string; name: string; address: string; lng: number; lat: number; category: string | null };
  export type FolderRef = { kind: 'folder'; shareId: string };
  export type FolderResult = { folderName: string; places: { sid: string; name: string; address: string; lng: number; lat: number; memo: string }[] };
  export type Deps = { fetch: typeof fetch; timeoutMs?: number };
  export function resolveLink(raw: string, deps: Deps): Promise<ResolvedPlace | FolderRef>;
  export function resolveFolder(shareId: string, deps: Deps): Promise<FolderResult>;
  ```
- 규칙: 이동은 `redirect: 'manual'`, 응답 `Location`을 절대 주소로 풀어 `classifyLink` 다시, 최대 3번, 넘거나 허용 밖이면 `UNSUPPORTED_LINK`. 구글 짧은 링크는 `User-Agent: 'landmark-link-resolver'`. 네이버·카카오 조회 헤더는 스펙 §1.3 값. 요청마다 `AbortController` 8초 → `TIMEOUT`. 조회 404·데이터 없음 → `NOT_FOUND`; 구글 좌표·Plus Code 모두 없음 → `NOT_FOUND` + `reason: 'no-location'`. 폴더: 좌표가 유한하지 않거나 `available === false`인 북마크는 뺀다(Review Focus 3), 1,000곳 초과 → `TOO_MANY_PLACES`. 출처 패턴은 Global Constraints의 네 가지(와일드카드는 서브도메인 한 단계만).

- [ ] **Step 1: 녹화**: 위 fixture를 `curl`로 받아 저장(개인정보 없는 공개 장소만, 카카오 응답은 `summary`만 남김).
- [ ] **Step 2: 실패하는 테스트** — 가짜 `fetch`가 URL별 fixture를 돌려준다:
  - 사용자 예시 링크 네 개가 각각 `ResolvedPlace`(네이버 2개는 `provider: 'naver'`·`providerId: '1958911015'|'1540168051'`, 카카오 `16990385`·이름 `쟝블랑제리`·도로명 주소·`point` 좌표, 구글 `googleId`·`이재모피자 본점`·Plus Code 좌표·`address: ''`)
  - 공유 폴더 링크 → `FolderRef`, `resolveFolder` → 이름·장소(좌표 이상·`available:false` 제외)
  - 4번째 이동 → `UNSUPPORTED_LINK`; 이동 대상이 허용 밖(`https://evil.example.com`) → `UNSUPPORTED_LINK`, 그 주소로 `fetch`하지 않음
  - 조회 404 → `NOT_FOUND`; fetch가 끝나지 않음(가짜 타이머로 8초) → `TIMEOUT`; 조회 500 → `UPSTREAM_ERROR`
  - 1,001곳 폴더 → `TOO_MANY_PLACES`
  - `isAllowedOrigin`: 네 패턴 통과, `https://a.b.landmark-c5f.pages.dev`·`https://landmark-c5f.pages.dev.evil.com`·`null` 거부
  - `errorResponse`: 코드별 상태, 본문 `{ error: { code, message } }`(+ `reason`)
- [ ] **Step 3:** FAIL → **Step 4:** 구현 → **Step 5:** PASS, `pipeline` 기존 테스트도 PASS
- [ ] **Step 6:** 커밋 `feat(server): 장소 링크 해석과 공유 폴더 조회`

---

### Task 5: Pages Functions 진입점과 개발 환경

**Files:**
- Create: `functions/api/place.ts`, `functions/api/naver-folder.ts`
- Modify: `package.json`(`wrangler` 정확 고정, 스크립트 `"dev:full": "yarn build:viewer && wrangler pages dev --proxy 5173 -- vite --port 5173 --strictPort"` 또는 현재 wrangler가 지원하는 동등한 형태 — 실제 버전의 `wrangler pages dev --help`로 확인해 정함), `tsconfig.app.json`(include에 `functions`), `eslint.config.mjs`(필요 시 `.wrangler` 무시), `.gitignore`(`.wrangler/`), `README.md`(로컬 실행·Cloudflare 설정·NCP Reverse Geocoding 켜기)
- Test: `tests/unit/server/functions.test.ts`

**Interfaces:**
- Consumes: `resolveLink`·`resolveFolder`·`isAllowedOrigin`·`jsonResponse`·`errorResponse`(Task 4)
- Produces: `export const onRequestGet = (ctx: { request: Request; waitUntil(p: Promise<unknown>): void }) => Promise<Response>` 두 파일. 순서: 출처 검사(`Origin`, 없으면 `Referer`의 출처) → 입력 검사(`url`/`share` 없음 → `UNSUPPORTED_LINK`) → 캐시 조회(`caches.default`, 키 `https://cache.landmark/place/<provider>/<id>` 또는 `…/folder/<shareId>` — 장소는 해석 뒤 키를 만들어 저장, 조회 전에는 원 링크 정규화 키로도 찾기) → 해석 → `Cache-Control: max-age=86400`(장소)·`600`(폴더)로 캐시 저장(`waitUntil`) → 응답. `caches`가 없으면(테스트·로컬) 캐시를 건너뛴다.

- [ ] **Step 1: 실패하는 테스트**: 가짜 `fetch`·`Request`로 `onRequestGet` 호출 — 허용 출처 + 네이버 링크 → 200 `ResolvedPlace`; 출처 없음/다름 → 403 `FORBIDDEN_ORIGIN`; `url` 없음 → 400; 폴더 함수 200·413; `caches` 없는 환경에서 오류 없이 동작
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS, `yarn typecheck`·`yarn lint`·`yarn build`
- [ ] **Step 5:** 로컬 확인: `yarn dev:full`로 띄우고 `curl -H 'Origin: http://localhost:8788' 'http://localhost:8788/api/place?url=https%3A%2F%2Fnaver.me%2FFk73Vab5'` → 200 JSON(이름 포함). 서버 종료.
- [ ] **Step 6:** 커밋 `feat(server): 장소 조회 Pages Functions와 로컬 개발 명령`

---

### Task 6: 앱 서비스 — PlaceLookup·ReverseGeocoder

**Files:**
- Create: `src/services/place-lookup.ts`, `src/services/reverse-geocoder.ts`
- Modify: `src/services/errors.ts`(`PlaceLookupError`), `src/components/map/load-naver-sdk.ts`(스크립트 URL에 `&submodules=geocoder`), `src/lib/effect/runtime.ts`(`AppLayer`), `tests/unit/sections/shell/harness.tsx`(`renderApp` 옵션 `placeLookup?`·`reverseGeocoder?` 가짜 레이어, 기본값은 실패하지 않는 가짜), 런타임을 직접 만드는 테스트들
- Test: `tests/unit/services/place-lookup.test.ts`, `tests/unit/services/reverse-geocoder.test.ts`

**Interfaces:**
- Consumes: 서버 응답 모양(Task 4 `ResolvedPlace`·`FolderRef`·`FolderResult` — 타입은 `src/server/resolve.ts`에서 `import type`)
- Produces:
  ```ts
  export class PlaceLookupError extends Schema.TaggedError<...>()('PlaceLookupError', { code: Schema.Literals([...ApiErrorCode, 'OFFLINE']), reason: Schema.optional(Schema.Literal('no-location')) }) { get userMessage(): string } // 스펙 §5 문구
  export class PlaceLookup extends Context.Service<PlaceLookup, { lookupLink(url: string): Effect<ResolvedPlace | FolderRef, PlaceLookupError>; lookupFolder(shareId: string): Effect<FolderResult, PlaceLookupError> }>()('tripmap/PlaceLookup') { static layerWith(o: { fetch: typeof fetch; base?: string }); static readonly layer; }
  export class ReverseGeocoder extends Context.Service<ReverseGeocoder, { reverse(lng: number, lat: number): Effect<string | null> }>()('tripmap/ReverseGeocoder') { static layerWith(o: { reverse: (lng: number, lat: number) => Promise<string | null> }); static readonly layer; }
  ```
- `lookupLink`: `GET /api/place?url=<인코딩>`. 응답이 JSON이 아니거나(HTML), 네트워크 오류, 404이면서 본문에 `error`가 없으면 → `OFFLINE`, 이때 `console.warn('장소 조회 서버에 연결하지 못했어요(로컬이면 yarn dev:full)', …)` (Review Focus 5). 본문 `error.code`가 있으면 그 코드.
- `ReverseGeocoder.layer`: `loadNaverSdk` 뒤 `naver.maps.Service.reverseGeocode({ coords, orders: 'roadaddr,addr' })`, 도로명(`roadaddr`: area1~3 + `land.name` + `number1`(-`number2`)) 우선, 없으면 지번(`addr`), 실패·빈 결과·SDK 없음 → `null`. 5초 시한.

- [ ] **Step 1: 실패하는 테스트**: 가짜 `fetch`로 성공·각 오류 코드·HTML 응답→`OFFLINE`(경고 1번)·네트워크 거부→`OFFLINE`; 요청 URL 인코딩; `userMessage` 문구; 주소 조립 함수(`formatReverseGeocode(response)`: 스펙의 실제 응답 예 → `서울특별시 용산구 후암동 두텁바위로60길 45`, 도로명 없으면 지번, 빈 응답 null)
- [ ] **Step 2:** FAIL → **Step 3:** 구현 + 연결 → **Step 4:** PASS, `yarn test` 전체(새 서비스 누락으로 깨지는 테스트 없음)
- [ ] **Step 5:** 커밋 `feat(add-place): 장소 조회·주소 변환 서비스`

---

### Task 7: 링크 입력과 확인 카드

**Files:**
- Create: `src/stores/add-place.ts`, `src/sections/add-place/extract-url.ts`, `src/sections/add-place/LinkInputPanel.tsx`, `src/sections/add-place/CandidateCard.tsx`, `src/sections/add-place/AddPlaceHost.tsx`
- Modify: `src/sections/shell/AddSheet.tsx`(세 항목 활성, 고르면 흐름 상태 설정 후 시트 닫기), `src/sections/shell/AppShell.tsx`(`AddPlaceHost` 배치), `src/sections/map/LibraryMap.tsx`(후보가 있으면 후보 좌표로 이동·임시 마커 — 기존 `focus`·마커 목록에 `clusterable: false` 후보 마커 추가)
- Test: `tests/unit/sections/add-place/extract-url.test.ts`, `tests/unit/sections/add-place/link-flow.test.tsx`

**Interfaces:**
- Consumes: `PlaceLookup`·`ReverseGeocoder`(Task 6), `addPlace`·`findExisting`·`PlaceCandidate`(Task 2), `LabelPicker`(기존), `useLibraryAction`(기존)
- Produces:
  ```ts
  // stores/add-place.ts
  export type AddFlow = { step: 'closed' } | { step: 'link'; hint: 'place' | 'folder' } | { step: 'candidate'; candidate: PlaceCandidate } | { step: 'folder'; shareId: string } | { step: 'pin'; name: string; start: [number, number] | null } | { step: 'pin-card'; name: string; lng: number; lat: number };
  export const addFlowAtom: PrimitiveAtom<AddFlow>;
  // extract-url.ts
  export function extractUrl(text: string): string | null; // 첫 http(s) 링크, 끝의 구두점·괄호 제거
  ```
- `AddPlaceHost`: `compact`는 아래 시트(MUI `Drawer anchor="bottom"`, 폴더 미리보기는 높이 90vh), 그 밖은 오른쪽 칸(`DETAIL_WIDTH`) — 지도를 가리지 않게 기존 상세 칸 자리를 쓴다(상세가 열려 있으면 추가 흐름이 우선).
- `LinkInputPanel`: 입력 → `extractUrl` → `lookupLink`. 결과가 장소면 `{ step: 'candidate' }`(구글 `address === ''`이면 `ReverseGeocoder.reverse`로 채움), 폴더면 `{ step: 'folder' }`. 오류 시 문구 + 버튼(스펙 §5: `UPSTREAM_ERROR`·`TIMEOUT`은 `다시 시도`·`지도에서 핀으로 추가`, `no-location`은 바로 핀 모드로 이름 채움, `OFFLINE`은 `다시 시도`). 조회 중 버튼 비활성, 실행 번호 ref로 닫힌 뒤 결과 무시.
- `CandidateCard`: 출처 표시(`네이버`·`카카오`·`구글`), 이름·주소(입력칸, 고칠 수 있음)·분류, `LabelPicker`(새 라벨 만들기 포함), 메모, `findExisting`이 살아 있는 장소를 찾으면 안내 + `라벨 더하기`. 추가 → `run((lib, ctx) => addPlace(...))` → 성공 시 `navigate(paths.place(id))`, 토스트 `추가했어요`, 흐름 닫기. 저장 중 버튼 비활성.

- [ ] **Step 1: 실패하는 테스트 (extract-url)**: `'[네이버 지도]\n콤포트\nhttps://naver.me/Fk73Vab5'` → `https://naver.me/Fk73Vab5` (Review Focus 1); `'(https://kko.to/MWuG8x8eN4).'` → 괄호·마침표 제거; 링크 없음 → null
- [ ] **Step 2: 실패하는 테스트 (link-flow)** — `renderLibrary` + 가짜 `PlaceLookup`:
  - ＋추가 → `링크 붙여넣기` → 입력에 공유 문구 붙여넣기 → `확인` → `장소를 찾는 중…` → 카드(이름·주소·출처 `네이버`)
  - 라벨 하나 고르고 메모 쓰고 `추가` → 보관함에 장소 1개, 상세로 이동, 토스트
  - 같은 `sid` 장소가 있으면 안내 문구와 `라벨 더하기`, 누르면 장소 수 그대로·라벨 추가
  - 구글 후보(`address: ''`) → 가짜 `ReverseGeocoder`가 준 주소가 입력칸에
  - 오류별 문구·버튼(`UNSUPPORTED_LINK`, `NOT_FOUND`, `UPSTREAM_ERROR`→`다시 시도` 누르면 재요청, `OFFLINE`)
  - `추가` 빠른 두 번 클릭 → 장소 1개
  - 폴더 항목으로 열면 안내 문구가 폴더용, 폴더 링크 결과면 폴더 단계로 넘어감(Task 8 화면이 없으면 단계 상태만 확인)
- [ ] **Step 3:** FAIL → **Step 4:** 구현 → **Step 5:** PASS, `yarn test`·`yarn typecheck`·`yarn lint`
- [ ] **Step 6:** 커밋 `feat(add-place): 링크로 장소 추가 — 입력과 확인 카드`

---

### Task 8: 네이버 폴더 미리보기

**Files:**
- Create: `src/sections/add-place/FolderPreview.tsx`
- Modify: `src/sections/add-place/AddPlaceHost.tsx`
- Test: `tests/unit/sections/add-place/folder-preview.test.tsx`

**Interfaces:**
- Consumes: `lookupFolder`(Task 6), `planFolderImport`·`importFolder`·`FolderItem`(Task 2), `liveLabels`(`query.ts`)
- Produces: `FolderPreview({ shareId })` — 머리글(`<폴더 이름> · <N>곳`), 라벨 이름 입력(기본 폴더 이름) + 기존 라벨 선택(선택하면 입력 대신 그 라벨), 30자 초과 안내, 목록(체크박스, 이름·주소, `이미 있음`), 전체 선택/해제, `<선택 수>곳 가져오기`(0이면 비활성). 가져오기 → `run((lib, ctx) => importFolder(lib, 선택한 항목, label, ctx))` → 토스트(Global Constraints 문구, 개수는 실행 직전 `planFolderImport` 기준), 흐름 닫기, 그 라벨로 목록 필터(`useLibraryQuery`의 `labelIds`를 그 라벨 하나로).

- [ ] **Step 1: 실패하는 테스트**: 가짜 폴더(3곳, 1곳은 이미 있음) → 머리글·`이미 있음`; 하나 해제 후 가져오기 → 새 1·합친 1, 토스트 `1곳을 새로 넣고, 1곳은 라벨만 더했어요`; 모두 새것이면 `3곳을 새로 넣었어요`, 모두 이미 있으면 `3곳은 라벨만 더했어요`; 라벨 이름 31자 → 안내·버튼 비활성; 기존 라벨 선택 시 새 라벨 생기지 않음; 전체 해제 → 버튼 비활성; `TOO_MANY_PLACES` → 문구; 가져온 뒤 목록이 그 라벨로 걸러짐
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(add-place): 네이버 공유 폴더 미리보기와 가져오기`

---

### Task 9: 지도에서 핀 찍기

**Files:**
- Create: `src/sections/add-place/PinModeOverlay.tsx`, `src/sections/add-place/PinCard.tsx`
- Modify: `src/components/map/MapView.tsx`(prop `onCenterChange?(center: [number, number]): void` — 카메라가 바뀔 때마다 중심 좌표, 기존 `onBoundsChange` 경로를 이용), `src/sections/map/LibraryMap.tsx`(핀 모드일 때 조준점 오버레이 표시·중심 좌표를 흐름 상태에 전달, `start`가 있으면 그 좌표로 이동, 좁은 화면에서 핀 모드면 지도 탭으로 전환), `src/sections/add-place/AddPlaceHost.tsx`
- Test: `tests/unit/sections/add-place/pin-flow.test.tsx`

**Interfaces:**
- Consumes: `ReverseGeocoder`(Task 6), `addPlace`(Task 2, 출처 `{ kind: 'pin' }`), `addFlowAtom`(Task 7)
- Produces: 핀 모드 오버레이(가운데 조준점 + 상단 `지도를 움직여 위치를 맞추세요` + `여기에 추가`·`취소`, Esc도 취소) → `{ step: 'pin-card', lng, lat }` → `PinCard`(이름 필수, 주소: 열릴 때 `reverse` → 채움 / `null`이면 빈칸 + `주소를 찾지 못했어요. 직접 입력해 주세요`, 라벨, 메모, `추가`·`취소`).

- [ ] **Step 1: 실패하는 테스트**(가짜 지도 어댑터 `FakeMapAdapter`): ＋추가 → `지도에서 핀 찍기` → 조준점·안내 보임; 가짜 카메라 중심 이동 후 `여기에 추가` → 카드 좌표가 그 중심; 주소 자동 채움, `reverse`가 `null`이면 안내·빈칸; 이름 비면 `추가` 비활성; 추가 → 장소(출처 `pin`, `legacy` 없음, 분류 `null`) 생성·상세 이동; `취소`·Esc → 흐름 닫힘; 링크 실패의 `지도에서 핀으로 추가`가 이름을 채운 채 들어옴
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS, `yarn test` 전체
- [ ] **Step 5:** 커밋 `feat(add-place): 지도에서 핀을 찍어 장소 추가`

---

### Task 10: E2E와 배포 확인

**Files:**
- Create: `tests/e2e/place-adding.spec.ts`, `tests/fixtures/links/api/*.json`(앱이 받는 `/api` 응답 — Task 4 결과 모양)
- Modify: `playwright.config.ts`(새 spec을 desktop·iphone·galaxy testMatch에)

- [ ] **Step 1:** 테스트 작성(`page.route('**/api/place?**')`·`'**/api/naver-folder?**'`로 녹화 응답, 가짜 지도):
  - `@smoke 링크로 장소를 추가하면 목록과 지도에 나타난다`: 빈 보관함 → ＋ → 링크(공유 문구 형태) → 카드 → 라벨 새로 만들기 → 추가 → 상세 열림, 목록 행 1, 마커 1
  - `폴더를 가져오면 그 라벨로 걸러진 장소가 보인다`: 3곳 폴더 → 가져오기 → 목록 3행, 라벨 칩 선택됨
  - `지도에서 핀을 찍어 추가한다`: 핀 모드 → 여기에 추가 → 이름 입력 → 추가 → 행 1
  - `지원하지 않는 링크는 안내한다`
- [ ] **Step 2:** 개발 서버를 끈 상태에서 `yarn test:e2e --grep 장소` (세 프로젝트) PASS, `yarn test:e2e:ci` PASS
- [ ] **Step 3:** 커밋 `test(e2e): 링크·폴더·핀으로 장소 추가`
- [ ] **Step 4 (배포 확인, 직접):** 브랜치를 푸시해 Cloudflare 미리보기 배포(`<브랜치>.landmark-c5f.pages.dev`)가 끝나면, 그 주소의 `/api/place`로 사용자 예시 링크 네 개(`https://naver.me/Fk73Vab5`, 네이버 웹 주소, `https://kko.to/MWuG8x8eN4`, `https://maps.app.goo.gl/SsZWtW1xgZVgijxK6`)와 공유 폴더 `https://naver.me/xjYaIYfe`를 `curl -H 'Origin: https://<브랜치>.landmark-c5f.pages.dev'`로 조회해 결과(이름·좌표)를 보고한다. 미리보기 주소에서는 네이버 지도 인증이 안 되므로 화면 확인은 병합 뒤 `https://landmark-c5f.pages.dev`에서 한다.
