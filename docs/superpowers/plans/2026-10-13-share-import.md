# 받은 공유 파일 가져오기 (하위 프로젝트 C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다른 사람이 랜드마크에서 내보낸 공유 HTML 파일(또는 보기 화면의 `Landmark에 담기` 링크)로 받은 장소를 미리 보고, 내 보관함에 합쳐 넣는다.

**Architecture:** 읽기(`src/domain/share/read-share.ts`)가 파일 텍스트·압축 해시를 `ShareDoc`으로 바꾸고, 합치기(`src/domain/library/import-share.ts`)가 `LibraryStore.update` 한 번 안에서 최신본에 적용하는 순수 연산이다. 모든 진입은 앱 주소 `/import`로 모이고, 추가 흐름(`addFlowAtom`)의 새 단계 `share-pick`(파일 고르기)·`share`(미리보기)가 추가 칸에 그려진다. 보기 화면은 Effect 없는 자체 인코더로 `/import#d=…` 링크를 만든다.

**Tech Stack:** TypeScript 6, React 19, MUI 7, Jotai, Effect 4.0.2(앱만), Vite 8, Vitest 5(jsdom), Playwright, `CompressionStream('deflate-raw')`.

**Spec:** `docs/superpowers/specs/2026-10-13-share-import-design.md`

## Global Constraints

- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`. 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 사용자 문자열은 React 텍스트·`textContent`로만 넣는다(`dangerouslySetInnerHTML`·`innerHTML` 금지). 보기 화면은 기존 `el()` 도우미를 쓴다.
- 파일에 U+2028/U+2029 원문자 금지. 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 보기 화면(`src/share-viewer/*`)은 `src/schema/*`에서 **`import type`만** 한다. `src/domain/codec.ts`·`src/schema/common.ts` 등 Effect를 끌고 오는 모듈을 import하지 않는다.
- `schemaVersion`은 2, 저장 키 `tripmap:library:v2`, 공유 형식 `format: 'tripmap-share'`·`version: 1` 그대로.
- E2E는 `E2E_PORT=5175`로 돌린다. 5173은 다른 프로젝트(`stock-trade`)의 개발 서버이므로 **절대 끄지 않는다**. 5174는 Playwright가 직접 띄우는 지도 미리보기 서버(`playwright.config.ts`의 `MAP_PORT`)라 앱 포트로 쓰지 않는다.
- 한도: 파일 5,242,880바이트, 장소 1,000곳, 해시 값 32,000자, 풀린 해시 5,242,880바이트, 같은 장소 거리 50m, 라벨 이름 30자, 메모 10,000자.
- 앱 주소 기본값 `https://landmark-c5f.pages.dev`(빌드 변수 `VITE_APP_URL`이 있으면 그것). 진입 경로 `/import`, 해시 접두사 `#d=`.
- 고정 문구(스펙 §2·§4):
  - 진입: ＋ 시트 항목 `공유 파일 가져오기` / 설명 `받은 Landmark 공유 파일(.html)`. 설정 버튼 `공유 파일 가져오기`.
  - 고르기 칸: 제목 `공유 파일 가져오기`, 설명 `받은 Landmark 공유 파일(.html)을 고르면 장소를 미리 보고 내 보관함에 넣어요`, 버튼 `파일 고르기`, 읽는 중 `읽는 중…`, PC 안내 `여기로 끌어 놓아도 돼요`. 끌어 놓기 덮개 `여기에 놓으면 가져와요`.
  - 미리보기: `<제목> · <N>곳`, `<YYYY.MM.DD> 만든 파일`, `모두 선택`, `모두 해제`, `메모`, `이미 있음`, `내 라벨에 합침`, `새로 만듦`, `파일 제목 라벨도 붙이기`, `받은 메모도 덧붙이기`, `이미 있는 장소에만 해당해요. 새로 넣는 장소에는 받은 메모가 그대로 들어가요`, `<N>곳 가져오기`, `라벨 이름은 30자까지예요`, 제목이 빌 때 기본 라벨 `받은 장소`.
  - 결과: `<새 수>곳을 새로 넣고, <합친 수>곳은 라벨만 더했어요` / `<새 수>곳을 새로 넣었어요` / `<합친 수>곳은 라벨만 더했어요`(되살린 장소는 새 수에 센다).
  - 메모 블록: `— 받은 메모 (<파일 제목>):` + 줄바꿈 + 받은 메모. 기존 메모 뒤에는 빈 줄 하나(`\n\n`)로 잇는다. 받은 메모 원문이 기존 메모 어디에든 있으면 덧붙이지 않는다. 길이 규칙은 스펙 §3.4.
  - 오류: `파일이 너무 커요` / `Landmark 공유 파일이 아니에요` / `공유 파일을 읽지 못했어요. 파일이나 링크가 손상됐을 수 있어요` / `가져올 장소가 없는 파일이에요` / `장소가 너무 많은 파일이에요(최대 1,000곳)`.
  - 보기 화면: 링크 `Landmark에 담기`, 큰 파일 `장소가 많아 바로 담을 수 없어요. Landmark에서 이 파일을 가져와 주세요` + 링크 `Landmark 열기`.

## Review Focus

1. **같은 파일을 두 번 가져옴** → 장소가 늘지 않고(핀도 이름+50m로 찾음), 라벨·메모 블록이 한 번만 붙고, 토스트는 `<N>곳은 라벨만 더했어요`. Task 4 테스트로 고정.
2. **옛 앱이 만든 파일(`kakaoId`·`googleId` 없음) / 장소의 `labelIds`에 파일 `labels`에 없는 id가 섞임** → 문제없이 가져오고 없는 라벨은 무시. Task 2(읽기)·Task 4(합치기) 테스트로 고정.
3. **받은 라벨 이름이 공백·대소문자만 다름**(`강릉 맛집` ↔ ` 강릉  맛집 `, `Cafe` ↔ `cafe`) → 내 라벨을 다시 쓰고 새로 만들지 않음. 미리보기도 `내 라벨에 합침`. Task 4 테스트로 고정.
4. **기존 메모가 10,000자에 가깝거나 받은 메모가 아주 김** → 결과가 `LibrarySchema`를 통과하고 메모는 `…`로 끝나거나 그대로. Task 4 테스트로 고정.
5. **`/import#d=…`로 들어온 뒤 새로고침·뒤로 가기, 또는 해시가 깨진 링크** → 주소는 바로 `/`가 되어 다시 열리지 않고, 깨진 링크는 오류 토스트 후 보관함에 남음. Task 5 테스트로 고정.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/schema/share.ts`, `src/domain/share/build-share.ts`, `src/share-viewer/parse.ts` | `kakaoId`·`googleId` 선택 필드 |
| `src/domain/codec.ts` | 한도를 받는 압축 JSON 인코드·디코드 |
| `src/domain/share/read-share.ts` | 파일·해시 → `ShareDoc` 또는 오류 |
| `src/share-viewer/encode.ts`, `src/share-viewer/render.ts`, `src/share-viewer/main.ts` | `Landmark에 담기` 링크 |
| `src/domain/library/import-share.ts`, `src/domain/library/add-place.ts` | 미리보기 표시용 계획, 합치기 연산 |
| `src/stores/add-place.ts`, `src/routes/*`, `src/sections/share-import/*`, `src/sections/add-place/AddPlaceHost.tsx`, `src/sections/shell/*`, `src/sections/settings/SettingsPage.tsx` | 진입·고르기·미리보기·끌어 놓기 |
| `tests/e2e/share-import.spec.ts` | E2E |

---

### Task 1: 공유 형식에 카카오·구글 id

**Files:**
- Modify: `src/schema/share.ts`, `src/domain/share/build-share.ts`, `src/share-viewer/parse.ts`
- Test: `tests/unit/domain/share/build-share.test.ts`, `tests/unit/share-viewer/parse.test.ts`

**Interfaces:**
- Produces: `SharePlace` += `kakaoId?: string; googleId?: string`(주석 `카카오 장소일 때만 있다.` / `구글 장소일 때만 있다.`). `SharePlaceSchema` += `kakaoId`·`googleId`: `Schema.optionalKey(Schema.String)`.

- [ ] **Step 1: 실패하는 테스트**
  - `buildShareDoc`: 카카오 장소 → `kakaoId: '<값>'`만 있고 `naverSid`·`googleId` 키 없음, 구글 장소 → `googleId`만, 핀 → 셋 다 키 없음. 결과가 `ShareDocSchema`(`onExcessProperty: 'error'`)를 통과.
  - `parseShareDoc`: `kakaoId`·`googleId`가 있으면 결과에 그대로 남음, 숫자 등 문자열이 아니면 `null`, 없으면 키가 생기지 않음.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/share tests/unit/share-viewer/parse.test.ts` → FAIL
- [ ] **Step 3:** 구현. `parsePlace`는 `naverSid`와 같은 방식.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(share): 공유 파일에 카카오·구글 장소 id`

---

### Task 2: 공유 파일·해시 읽기

**Files:**
- Modify: `src/domain/codec.ts`
- Create: `src/domain/share/read-share.ts`
- Test: `tests/unit/domain/codec.test.ts`(기존 통과 유지 + 새 함수), `tests/unit/domain/share/read-share.test.ts`

**Interfaces:**
- Consumes: Task 1의 `ShareDocSchema`.
- Produces:
  ```ts
  // src/domain/codec.ts — 기존 encodeEditLayer/decodeEditLayer는 이 둘을 쓰도록 바꾸고 동작은 그대로
  export async function encodeCompressedJson(value: unknown): Promise<string>;
  /** 한도를 넘으면 CodecError('too-long' | 'too-large'), 그 밖 실패는 'corrupt'. */
  export async function decodeCompressedJson(value: string, limits: { maxChars: number; maxBytes: number }): Promise<unknown>;

  // src/domain/share/read-share.ts
  export const SHARE_IMPORT_LIMITS = { fileBytes: 5_242_880, places: 1000, hashChars: 32_000, decodedBytes: 5_242_880 } as const;
  export const SHARE_HASH_PREFIX = '#d=';
  export type ShareReadError = 'too-big' | 'not-share' | 'corrupt' | 'empty' | 'too-many';
  export const SHARE_READ_MESSAGES: Record<ShareReadError, string>; // Global Constraints의 오류 문구 순서대로
  export type ShareReadResult = { ok: true; doc: ShareDoc } | { ok: false; error: ShareReadError };
  export function readShareHtml(text: string): ShareReadResult;
  export async function readShareFile(file: Blob): Promise<ShareReadResult>;
  export async function readShareHash(value: string): Promise<ShareReadResult>; // value는 '#d=' 뒤 부분
  ```
- 순서: (파일) 크기 → `DOMParser('text/html')`로 `#tripmap-share`의 `textContent`(없으면 `not-share`) → `JSON.parse`(실패 `corrupt`) → 공통 검사. (해시) `decodeCompressedJson(value, { maxChars: hashChars, maxBytes: decodedBytes })` 실패는 모두 `corrupt` → 공통 검사. 공통 검사: `safeParse(ShareDocSchema, v, { onExcessProperty: 'error' })` 실패 `corrupt` → 장소 0곳 `empty` → 1,000곳 초과 `too-many`.

- [ ] **Step 1: 실패하는 테스트**
  - `injectShareDoc`으로 만든 HTML(틀은 테스트 안의 작은 문자열) → `readShareHtml`이 같은 문서(한글·이모지·`</script>`가 든 메모 포함).
  - `readShareFile`: 5,242,881바이트 `Blob` → `too-big`(내용을 읽지 않음), 데이터 블록 없는 HTML → `not-share`, 깨진 JSON → `corrupt`, `version: 2` → `corrupt`, 장소에 모르는 필드 → `corrupt`, 0곳 → `empty`, 1,001곳 → `too-many`, 1,000곳 → ok.
  - `readShareHash`: `encodeCompressedJson(doc)` 왕복 ok, 32,001자 → `corrupt`, `'!!!'` → `corrupt`, 압축이 아닌 base64url → `corrupt`.
  - `SHARE_READ_MESSAGES` 다섯 문구가 Global Constraints와 글자까지 같음.
  - 기존 `codec.test.ts` 그대로 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/codec.test.ts tests/unit/domain/share/read-share.test.ts` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(share): 받은 공유 파일과 링크 읽기`

---

### Task 3: 보기 화면의 `Landmark에 담기`

**Files:**
- Create: `src/share-viewer/encode.ts`
- Modify: `src/share-viewer/render.ts`, `src/share-viewer/main.ts`, `src/share-viewer/styles.css`, `src/vite-env.d.ts`(있으면 `VITE_APP_URL` 타입)
- Test: `tests/unit/share-viewer/encode.test.ts`, `tests/unit/share-viewer/render.test.ts`

**Interfaces:**
- Consumes: Task 2의 `readShareHash`(테스트에서만, 왕복 확인용).
- Produces:
  ```ts
  // src/share-viewer/encode.ts — Effect·앱 모듈 import 금지(타입만)
  export const DEFAULT_APP_URL = 'https://landmark-c5f.pages.dev';
  export const MAX_HASH_CHARS = 32_000;
  export function appUrl(value: string | undefined): string; // 비면 기본값, 끝의 '/'는 뗀다
  export async function encodeShareHash(doc: ShareDoc): Promise<string>; // deflate-raw + base64url(= 없음)
  export type ImportLink = { kind: 'direct'; href: string } | { kind: 'too-big'; href: string } | { kind: 'unsupported' };
  export async function importLink(doc: ShareDoc, app: string): Promise<ImportLink>;
  // direct: `${app}/import#d=${값}`, too-big(값 > 32,000자): `${app}/import`, CompressionStream 없음: unsupported
  // render.ts
  renderViewer(root, doc, map, opts: { app: string }): { highlight(placeId: string): void; setImportLink(link: ImportLink): void };
  ```
- `renderViewer`는 머리글의 날짜 줄 아래에 `Landmark에 담기` 링크(`href = ${app}/import`, `target="_blank"`, `rel="noopener noreferrer"`)를 바로 그린다. `setImportLink`: direct면 `href`만 바꾸고, too-big이면 링크 자리를 안내 문구 + `Landmark 열기` 링크로 바꾸고, unsupported면 그대로 둔다. `main.ts`는 `importLink(doc, appUrl(import.meta.env.VITE_APP_URL)).then(handle.setImportLink)`.

- [ ] **Step 1: 실패하는 테스트**
  - `encodeShareHash(doc)` → `readShareHash`로 같은 문서(한글·이모지·`<` 포함). 값은 `/^[A-Za-z0-9_-]+$/`.
  - `importLink`: 작은 문서 → `direct`, `href`가 `https://x.test/import#d=`로 시작. 압축해도 32,000자가 넘는 문서(장소 1,000곳에 무작위 메모) → `too-big`, `href === 'https://x.test/import'`. `globalThis.CompressionStream`을 지운 상태 → `unsupported`.
  - `appUrl(undefined)`·`appUrl('')` → 기본값, `appUrl('http://localhost:5174/')` → `'http://localhost:5174'`.
  - `renderViewer`: 링크 이름 `Landmark에 담기`, 처음 `href`가 `${app}/import`, `target`·`rel`; `setImportLink(direct)` 후 `href` 바뀜; `setImportLink(too-big)` 후 안내 문구와 `Landmark 열기` 링크가 있고 `Landmark에 담기`는 없음.
- [ ] **Step 2:** `yarn vitest run tests/unit/share-viewer` → FAIL
- [ ] **Step 3:** 구현. 링크 모양은 기존 보기 화면 버튼·필터 칩 스타일 변수(`styles.css`)를 따른다.
- [ ] **Step 4:** PASS + `yarn build:viewer` 성공, `wc -c public/share-viewer.html`이 작업 전보다 10KB 넘게 늘지 않음(Effect가 들어가지 않음)
- [ ] **Step 5:** 커밋 `feat(share-viewer): Landmark에 담기 링크`

---

### Task 4: 합치기 연산

**Files:**
- Create: `src/domain/library/import-share.ts`
- Modify: `src/domain/library/add-place.ts`(아래 export만, 동작 그대로)
- Test: `tests/unit/domain/library/import-share.test.ts`

**Interfaces:**
- Consumes: Task 1 타입, `haversineM`(`src/domain/trips/geo.ts`), `normalizeLabelName`, `createLabel`, `liveLabels`, `truncateMemo`, `OpCtx`/`OpResult`/`OpSummary`.
- `add-place.ts`에서 export: `nextLabelColor(lib)`, `isLiveLabel(lib, id)`, `newPlace(...)`, `mergeInto(...)`. `mergeInto`의 `memo` 인자를 `string | ((current: string) => string)`로 넓힌다(문자열이면 지금의 `appendMemo` 동작).
- Produces:
  ```ts
  // src/domain/library/import-share.ts
  export const SHARE_MATCH_RADIUS_M = 50;
  export function cutLabelName(name: string): string; // trim 후 30자(UTF-16), 서로게이트 쌍 안 깨짐
  export function defaultTitleLabel(title: string): string; // cutLabelName(title) || '받은 장소'
  export function shareSource(place: SharePlace): PlaceSource; // naverSid → kakaoId → googleId, 형식 틀리면 건너뜀, 없으면 { kind: 'pin' }
  export function appendReceivedMemo(current: string, title: string, memo: string): string; // 스펙 §3.4: 원문 포함이면 그대로, 길이 규칙 세 갈래
  export type ShareLabelPlan = { shareLabelId: string; name: string; color: LabelColor; reuse: boolean };
  export type SharePlan = {
    existing: ReadonlySet<string>; // 살아 있는 내 장소와 같은 받은 장소 id
    labels: ShareLabelPlan[]; // 고른 장소가 쓰는 받은 라벨, 파일의 order 순, 이름이 빈 것 제외
    titleReuse: boolean; // 제목 라벨 이름이 살아 있는 내 라벨과 같은가(titleLabel이 null이면 false)
  };
  export function planShareImport(lib: Library, doc: ShareDoc, selected: readonly string[], titleLabel: string | null): SharePlan;
  export type ShareImportInput = { selected: readonly string[]; titleLabel: string | null; appendMemo: boolean };
  /** summary는 결과 장소 기준(스펙 §3.5). createdId는 제목 라벨 id(없으면 undefined). */
  export function importShare(lib: Library, doc: ShareDoc, input: ShareImportInput, ctx: OpCtx): OpResult;
  ```
- 같은 장소 찾기(스펙 §3.1): id 있는 장소는 출처 키 색인(살아 있는 것 > 늦게 지운 것), 없는 장소는 정규형 이름 + `haversineM ≤ 50` 후보 중 살아 있는 것 > 가까운 것 > 늦게 지운 것. 받은 장소는 파일 순서대로 **작업 중인 문서**에 이어서 처리한다. 결과 장소마다 처음 손댄 순간의 원래 상태로 `created`/`restored`/`merged`를 한 번만 센다.
- 제목 라벨 이름이 1–30자가 아니면 `LabelNameInvalid`로 실패한다(화면이 막지만 연산도 지킨다).

- [ ] **Step 1: 실패하는 테스트** (`ctx`는 고정 `now`와 순번 `newId`)
  - 찾기: 같은 `naverSid`의 살아 있는 장소에 합침; 지운 장소만 있으면 되살림(`restored`); `naverSid: 'abc'`(형식 틀림) → 이름+거리로; 핀: 같은 이름 49m → 합침, 51m → 새로; 이름 `' 테라로사  강릉점 '` ↔ `'테라로사 강릉점'` 같음; 같은 이름 후보가 살아 있는 40m·지운 10m·살아 있는 70m(범위 밖) → 살아 있는 40m; id가 있는 받은 장소는 이름이 같은 핀이 옆에 있어도 새로 만듦.
  - 파일 안 중복: 같은 핀 두 개 → 장소 1개, `summary.created === 1`; 같은 `naverSid` 두 번 → 1개.
  - 새 장소: 이름·주소·좌표·메모 그대로, 카카오 → `{ kind: 'kakao', kakaoId }`, 없음 → `{ kind: 'pin' }`, `category.value === null`, `saved.value === true`, 메모 10,001자 → 10,000자이고 `…`로 끝남.
  - 라벨: 정규형 같은 살아 있는 라벨 재사용(색 그대로), 없으면 받은 색으로 새로 만듦, 31자 이름 → 30자, 빈 이름 라벨 무시, 받은 라벨 `Cafe`·`cafe` → 한 라벨, 파일 `labels`에 없는 id 무시, 고르지 않은 장소만 쓰는 라벨은 만들지 않음, 제목 라벨 켬 → 모든 결과 장소에 붙고 `createdId`, 끔 → 없음, 새 제목 라벨 색 = `nextLabelColor`.
  - 합치기: 라벨은 기존 뒤에 중복 없이, 되살릴 때 지워진 라벨 뗌, `saved: false` → `true`, 이름·주소·좌표·분류 그대로.
  - 메모(`appendReceivedMemo` + 연산): 빈 메모 → 블록만; 있으면 `기존\n\n— 받은 메모 (강릉 모음):\n받은`; 받은 메모 원문이 기존 메모 어디에든 있으면 그대로(원문과 같은 메모, 블록 뒤에 다른 블록이 붙은 메모); 제목 `강릉 모음`(머리 17자) 기준 — 기존 9,900자 + 받은 200자 → 정확히 10,000자이고 `…`로 끝남, 기존 9,980자 → 9,980 + 2 + 17 + 1 = 10,000이므로 머리 줄 + `…`만 붙어 10,000자, 기존 9,981자 → 그대로(9,981자), 기존 9,990자 → 그대로; 빈 기존 메모 + 받은 10,000자 → 정확히 10,000자이고 `…`로 끝남; `appendMemo: false` → 그대로; 받은 메모가 빈 문자열이면 그대로; 새 장소에는 토글과 상관없이 받은 메모.
  - 같은 파일 두 번: 두 번째 `summary`가 `{ created: 0, merged: N, restored: 0 }`, 장소 수·라벨 수·메모 그대로(첫 번째에 **새로 넣은** 장소와 **합친** 장소 모두). 파일 A → B → A: 세 번째 뒤의 메모가 두 번째 뒤와 같음.
  - 동시성: 미리보기 뒤 다른 탭이 같은 `naverSid` 장소를 넣은 문서에 적용 → 그 장소에 합치고 `merged`로 셈.
  - `planShareImport`: `existing`에 살아 있는 것만(지운 것은 없음), `labels[].reuse`, `titleReuse`.
  - 모든 결과 문서가 `safeParse(LibrarySchema, …)`를 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/library/import-share.test.ts` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn vitest run tests/unit/domain/library` 전부 + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library): 받은 공유 파일 합치기 연산`

---

### Task 5: `/import` 진입과 파일 고르기

**Files:**
- Modify: `src/stores/add-place.ts`, `src/routes/paths.ts`, `src/routes/router.tsx`, `src/sections/add-place/AddPlaceHost.tsx`, `src/sections/shell/AddSheet.tsx`, `src/sections/shell/AppShell.tsx`, `src/sections/settings/SettingsPage.tsx`, `src/components/icons*`(필요하면 아이콘 하나)
- Create: `src/sections/share-import/use-import-entry.ts`, `src/sections/share-import/use-share-file.ts`, `src/sections/share-import/SharePickPanel.tsx`
- Test: `tests/unit/sections/share-import/import-entry.test.tsx`, `tests/unit/sections/share-import/share-pick.test.tsx`, 기존 `tests/unit/sections/shell`·`settings` 테스트 갱신

**Interfaces:**
- Consumes: Task 2의 `readShareFile`·`readShareHash`·`SHARE_READ_MESSAGES`·`SHARE_HASH_PREFIX`.
- Produces:
  ```ts
  // src/stores/add-place.ts
  AddFlow += | { step: 'share-pick' } | { step: 'share'; doc: ShareDoc };
  // showsAddPanel: 두 단계 모두 true. AddPlaceHost는 두 단계도 폴더처럼 height '90vh'.
  // src/routes/paths.ts
  importShare: '/import',
  // src/sections/share-import/use-share-file.ts
  export function useShareFile(): { read(file: File): Promise<void>; reading: boolean; error: string | null };
  // 성공하면 setFlow({ step: 'share', doc }), 실패하면 error = SHARE_READ_MESSAGES[...]
  // src/sections/share-import/use-import-entry.ts — AppShell에서 한 번 부른다
  export function useImportEntry(): void;
  // src/sections/share-import/SharePickPanel.tsx
  export function SharePickPanel(): JSX.Element;
  ```
- `router.tsx`: `{ path: paths.importShare, element: null }`(보관함이 뒤에 그려진다).
- `useImportEntry`: `pathname === '/import'`이면 해시를 먼저 읽고 `navigate(paths.library, { replace: true })`(해시 없음), `addTargetAtom`을 `null`로. 해시가 `#d=`로 시작하면 `readShareHash` → 성공 `setFlow({ step: 'share', doc })`, 실패 `toast(SHARE_READ_MESSAGES[error])`. 해시가 없으면 `setFlow({ step: 'share-pick' })`. 해독이 끝나기 전에 다른 흐름이 열렸으면 결과를 버린다.
- ＋ 시트: `공유 파일 가져오기` 항목은 `addTargetAtom`이 `null`일 때만 보이고, 누르면 시트를 닫고 `navigate(paths.importShare)`. 설정: `옛 여행 가져오기` 옆 버튼 → `navigate(paths.importShare)`.
- 고르기 칸은 Global Constraints의 문구, 숨긴 `<input type="file" accept=".html,.htm,text/html">`를 `파일 고르기` 버튼이 연다. 넓은 화면에서는 칸 자체가 끌어 놓는 자리(`dragover`에서 `preventDefault`, `drop`에서 첫 파일을 `read`).

- [ ] **Step 1: 실패하는 테스트**
  - 진입: `MemoryRouter`를 `/import#d=<유효>`로 → 주소가 `/`, 흐름이 `share`, 문서가 같음. `/import#d=!!!` → `/`, 흐름 `closed`, 토스트 `공유 파일을 읽지 못했어요. 파일이나 링크가 손상됐을 수 있어요`. `/import` → `/`, 흐름 `share-pick`. 진입 뒤 다시 그려도(새로고침 흉내: 같은 주소 `/`로 다시 마운트) 흐름이 다시 열리지 않음.
  - 고르기 칸: 문구가 보임, 데이터 블록 없는 파일 → `Landmark 공유 파일이 아니에요`가 칸 안에, 다시 고르면 지워짐, 유효한 파일 → 흐름 `share`; 읽는 동안 `읽는 중…`과 꺼진 버튼.
  - ＋ 시트: 대상 없음 → 항목 보임·누르면 `/import`; 여행 대상 있음 → 항목 없음. 설정: 버튼 누르면 `/import`.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/share-import tests/unit/sections/shell tests/unit/sections/settings` → FAIL
- [ ] **Step 3:** 구현. 미리보기 단계(`share`)의 `StepContent`는 이 작업에서 임시로 고르기 칸과 같은 자리에 제목만 그리는 자리표시자를 두고, Task 6이 바꾼다.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(share-import): /import 진입과 공유 파일 고르기`

---

### Task 6: 미리보기와 가져오기

**Files:**
- Create: `src/sections/share-import/SharePreview.tsx`(필요하면 행 구성 요소를 같은 폴더에 나눔)
- Modify: `src/sections/add-place/AddPlaceHost.tsx`(Task 5의 자리표시자 교체), `src/sections/add-place/FolderPreview.tsx`(결과 문장 함수 `resultMessage`를 export해 함께 씀)
- Test: `tests/unit/sections/share-import/share-preview.test.tsx`

**Interfaces:**
- Consumes: Task 4의 `planShareImport`·`importShare`·`defaultTitleLabel`, Task 5의 `share` 단계, `useLibraryAction().run`, `useLibraryQuery()`의 `patchQuery`, `toast`(sonner).
- Produces: `export function SharePreview({ doc }: { doc: ShareDoc }): JSX.Element;`, `FolderPreview.tsx`의 `export function resultMessage(summary: OpSummary): string | null`.
- 화면은 스펙 §2.3. `FolderList`의 두 번 누름 막기(`savingRef`)·닫힌 뒤 늦은 결과 처리(`aliveRef`)·연산 안에서 결과 담기(`box`) 방식을 그대로 따른다. 가져온 뒤: 토스트 → 제목 라벨이 있으면 `patchQuery({ labelIds: [createdId], unlabeled: false, text: '', regions: [] })` → `setFlow({ step: 'closed' })`.
- `받은 메모도 덧붙이기`: 고른 장소 중 `plan.existing`에 있고 메모가 있는 것이 없으면 꺼진 채 비활성.

- [ ] **Step 1: 실패하는 테스트** (보관함에 같은 `naverSid` 장소 1곳과 라벨 `카페`가 있는 상태, 파일 3곳·라벨 `카페`·`바다`)
  - 머리글 `강릉 모음 · 3곳`, `2026.10.13 만든 파일`; 행 3개 체크됨; 같은 장소 행에 `이미 있음`, 메모 있는 행에 `메모`; 라벨 줄 `카페 — 내 라벨에 합침`, `바다 — 새로 만듦`.
  - `모두 해제` → 버튼 `0곳 가져오기` 꺼짐; 한 행 켬 → `1곳 가져오기`; 그 행만 쓰는 라벨만 라벨 줄에 남음.
  - 제목 라벨: 기본값 `강릉 모음`, 31자 입력 → `라벨 이름은 30자까지예요`와 꺼진 버튼, 빈 입력 → 꺼진 버튼, 스위치 끔 → 입력 숨김·버튼 켜짐.
  - `받은 메모도 덧붙이기`: 이미 있는 장소에 받은 메모가 없으면 비활성.
  - 가져오기 → 토스트 `2곳을 새로 넣고, 1곳은 라벨만 더했어요`, 목록 필터가 제목 라벨, 흐름 `closed`. 제목 라벨 끈 채 가져오기 → 필터 그대로. 빠르게 두 번 눌러도 장소가 늘지 않음.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/share-import` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `feat(share-import): 받은 장소 미리보기와 가져오기`

---

### Task 7: PC 끌어 놓기

**Files:**
- Create: `src/sections/share-import/ShareDropOverlay.tsx`
- Modify: `src/sections/shell/AppShell.tsx`
- Test: `tests/unit/sections/share-import/share-drop.test.tsx`

**Interfaces:**
- Consumes: Task 5의 `useShareFile`, `useLayout()`(넓은 화면 판정), `addFlowAtom`.
- Produces: `export function ShareDropOverlay(): JSX.Element | null;` — 넓은 화면이고 경로가 `/` 또는 `/map`이며 흐름이 `closed`일 때만 `window`의 `dragenter`/`dragover`/`dragleave`/`drop`을 듣는다. `dataTransfer.types`에 `Files`가 있을 때만 덮개(`여기에 놓으면 가져와요`)를 띄우고 `preventDefault`. 들어오고 나간 횟수를 세어 자식 요소 위에서 깜빡이지 않게 한다. 놓으면 첫 파일을 `read`; 실패는 `toast(error)`. (흐름이 `share-pick`이면 고르기 칸이 받는다.)

- [ ] **Step 1: 실패하는 테스트**: 파일 끌어 옴 → 덮개 보임, 떠남 → 사라짐, 텍스트 끌기(`types: ['text/plain']`) → 덮개 없음, 유효한 파일 놓음 → 흐름 `share`, 잘못된 파일 → 토스트 `Landmark 공유 파일이 아니에요`, 좁은 화면·`/trips`·흐름이 열린 상태 → 덮개 없음.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/share-import/share-drop.test.tsx` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test`
- [ ] **Step 5:** 커밋 `feat(share-import): PC에서 공유 파일 끌어 놓기`

---

### Task 8: E2E와 배포 확인

**Files:**
- Create: `tests/e2e/share-import.spec.ts`
- Modify: `README.md`(기능 목록에 한 줄, 있으면)

**Interfaces:**
- Consumes: 기존 `tests/e2e/share-export.spec.ts`의 내보내기·다운로드 방식과 `fixtures.ts`.

- [ ] **Step 1: E2E 작성** (desktop·iphone·galaxy)
  - 내보내기로 파일을 받음 → 보관함을 비우거나 라벨 하나를 지운 상태로 만듦 → ＋ → `공유 파일 가져오기` → `파일 고르기`에 `setInputFiles` → 미리보기 → `<N>곳 가져오기` → 토스트와 목록(제목 라벨 필터).
  - 받은 파일을 `file://`로 연 보기 화면에서 `Landmark에 담기`의 `href`를 읽어 앞부분을 테스트 앱 주소(`baseURL`)로 바꿔 이동 → 주소가 `/` → 미리보기 → 가져오기. 같은 파일을 한 번 더 → `<N>곳은 라벨만 더했어요`.
  - desktop만: 보관함 위에 파일을 끌어 놓기(`DataTransfer`를 페이지에서 만들어 `dispatchEvent`) → 미리보기.
- [ ] **Step 2:** `E2E_PORT=5175 yarn test:e2e tests/e2e/share-import.spec.ts` → PASS(세 프로젝트). 기존 E2E 전체도 `E2E_PORT=5175 yarn test:e2e` PASS.
- [ ] **Step 3:** `yarn build:ci` PASS, `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음
- [ ] **Step 4:** 커밋 `test(share-import): 공유 파일 가져오기 E2E`
- [ ] **Step 5: 배포 확인**(PR 미리보기 배포 후): 미리보기 주소에서 내보낸 파일 → 앱 `공유 파일 가져오기`로 가져오기. 병합 뒤 운영(`https://landmark-c5f.pages.dev`)에서 내보낸 파일의 `Landmark에 담기` → 운영 앱 미리보기가 열리는지 확인하고 결과를 PR에 적는다.
