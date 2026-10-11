# HTML 공유 파일 내보내기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보관함의 장소(선택분 또는 지금 보이는 목록)를 HTML 파일 하나로 내보내고, 그 파일을 열면 목록과 OSM 지도(GitHub Pages 지도 페이지를 iframe으로)가 보이게 한다.

**Architecture:** 세 조각이다. (1) 보기 화면 `src/share-viewer/`는 React 없이 빌드해 JS·CSS를 넣은 HTML 틀 하나(`public/share-viewer.html`)가 되고, 앱은 내보낼 때 이 틀을 받아 데이터 블록 한 곳에 `ShareDoc` JSON을 넣어 저장·공유한다. (2) 지도 페이지 `src/share-map/`(Leaflet + OSM)는 `sch0718/landmark`의 GitHub Pages에 배포되고, 보기 화면이 iframe으로 띄워 `postMessage` v1(`src/share-protocol.ts`)로 주고받는다. (3) 앱 쪽은 `ShareTemplate` 서비스·내보내기 창·도구줄/일괄 편집 버튼이다.

**Tech Stack:** TypeScript 6, Vite 8, React 19 + MUI 7(앱), Effect 4.0.2(앱만), Leaflet 1.9.4(지도 페이지만), Vitest 5 + jsdom, Playwright, GitHub Actions/Pages.

**Spec:** `docs/superpowers/specs/2026-10-11-html-share-export-design.md` (r3)

## Global Constraints

- 셸 명령은 Node 24로: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"` (Node 18이면 pre-commit이 실패한다).
- 주석·UI 문구는 한국어. 주변 코드의 주석 밀도·이름 규칙을 따른다.
- 사용자 문자열은 DOM에 `textContent`·속성 값으로만 넣는다. `innerHTML` 금지(보기 화면·지도 페이지 모두).
- 데이터 삽입: `JSON.stringify` 결과에서 `<`(U+003C)·U+2028·U+2029를 백슬래시+`u`+16진수 4자리 6글자 이스케이프로 바꾼다. 소스 코드에서는 이 세 문자를 리터럴로 쓰지 말고 `String.fromCharCode(0x3c)` 등이나 정규식 ``new RegExp(`[<\\u2028\\u2029]`, 'g')`` 형태로 쓴다(편집 도구가 이스케이프를 실제 문자로 바꾼 전례가 있다 — 커밋 전 `grep -P '[\x{2028}\x{2029}]'`로 확인).
- 틀의 데이터 자리 문자열: `__TRIPMAP_DATA__`, 데이터 블록: `<script type="application/json" id="tripmap-share">`.
- `ShareDoc`: `format: 'tripmap-share'`, `version: 1`.
- 메시지: `{ source: 'tripmap-share', v: 1, kind, ... }`. 지도 → 파일 `ready`(`maxV`)·`select`(`placeId`)·`tiles-failed`, 파일 → 지도 `init`(`places`)·`focus`(`placeId | null`)·`filter`(`placeIds`).
- 지도 페이지 기본 주소 `https://sch0718.github.io/landmark/`, 빌드 변수 `VITE_SHARE_MAP_URL`.
- 타일 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, 출처 `© OpenStreetMap contributors`(링크 `https://www.openstreetmap.org/copyright`). 지도 페이지에 `Referrer-Policy`를 두지 않는다.
- 장소로 이동할 때 줌 16. `ready` 시한 10초.
- `leaflet` 정확히 `1.9.4`, `@types/leaflet`은 devDependency. Leaflet은 지도 페이지에만 들어간다.
- 보기 화면 틀(데이터 제외) 50KB 이하.
- 고정 문구:
  - 지도 실패: `지도를 불러오지 못했어요. 목록과 네이버 지도 링크는 그대로 쓸 수 있어요`
  - 데이터 깨짐: `파일 내용을 읽지 못했어요`
  - 바닥글: `trip-map에서 만든 파일`
  - 지도 페이지를 직접 열었을 때: `trip-map에서 내보낸 파일 안에서 쓰는 지도예요`
  - 대상: `선택한 N곳을 내보냅니다` / `지금 보이는 N곳을 내보냅니다` + ` (라벨: 이름, 이름)` + ` (검색: 텍스트)`
  - 0곳: `내보낼 장소가 없어요`
  - 틀 실패: `내보내기 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요`
  - 공유 실패: `공유하지 못했어요. 파일 저장을 이용해 주세요`
  - 완료 토스트: `파일을 만들었어요`
  - 버튼: `내보내기`, `파일 저장`, `공유`, 체크박스 `메모 포함`, 입력 `제목`
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. 지도 페이지 `ready`가 10초 시한 뒤에 늦게 도착함(느린 휴대폰 망) → 안내를 걷고 지도를 보여 주는 것이 자연스럽다. Task 5 테스트로 고정.
2. 장소가 1곳이거나 모두 같은 좌표 → 처음 맞추기에서 줌이 터지지 않고 줌 16으로 그 지점. Task 6 테스트로 고정.
3. 고른 뒤 내보내기 전에 지워졌거나 목록에서 빠진 장소 id가 넘어옴 → 조용히 빼고, 0곳이면 버튼 비활성. Task 1·Task 8 테스트로 고정.
4. 카드 안 "네이버 지도에서 보기" 링크를 눌렀을 때 카드 동작(지도 이동)이 같이 일어남 → 링크만 열려야 한다. Task 4 테스트로 고정.
5. 내보내기 중 버튼을 빠르게 두 번 누름(틀을 받는 동안) → 파일이 두 번 저장되면 안 된다. 작업 중에는 버튼 비활성. Task 8 테스트로 고정.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/schema/share.ts` | `ShareDocSchema`(Effect), `ShareDoc`·`SharePlace`·`ShareLabel` 타입 |
| `src/domain/share/build-share.ts` | 보관함 → `ShareDoc` |
| `src/domain/share/inject.ts` | 틀에 데이터 넣기, 파일 이름 |
| `src/share-protocol.ts` | 메시지 타입·봉투·검사(보기 화면·지도 페이지 공용, 의존성 없음) |
| `src/share-viewer/{index.html,main.ts,parse.ts,render.ts,map-frame.ts,styles.css}` | 보기 화면 |
| `build/inline-assets.ts` | 빌드 결과 JS·CSS를 HTML에 넣는 Vite 플러그인 |
| `vite.viewer.config.ts` | 보기 화면 → `public/share-viewer.html` |
| `src/share-map/{index.html,main.ts,map.ts,styles.css}` | 지도 페이지 |
| `vite.map.config.ts` | 지도 페이지 → `dist-map/` |
| `src/services/share-template.ts` | `ShareTemplate` 서비스 |
| `src/sections/share-export/{export-targets.ts,make-share-html.ts,ExportHtmlDialog.tsx}` | 내보내기 대상 계산, 파일 만들기, 창 |
| `.github/workflows/deploy-share-map.yml` | 지도 페이지 배포 |
| `tests/e2e/share-export.spec.ts` | E2E |

---

### Task 0: 스펙 r3 정리

스펙의 두 곳을 실행 가능하게 고친다. **계획 문서와 같은 커밋에서 이미 반영했다.**

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-html-share-export-design.md`

- [x] **Step 1:** 머리말에 `개정: 2026-10-11 r3 — 계획 작성 중 정리. 틀은 `public/share-viewer.html`로 빌드하고 앱이 내보낼 때 `fetch`로 받는다(생성 파일을 `?raw`로 import하면 파일이 없을 때 런타임을 import하는 모든 모듈의 변환이 실패한다). `init` 메시지는 라벨 색 이름만 보내고 지도 페이지가 파스텔 토큰을 직접 번들한다.` 추가, 상태를 `r3`로.
- [x] **Step 2:** §4.2 표의 `src/generated/share-viewer.html` 행을 `public/share-viewer.html`(gitignore)로, `ShareTemplate` 행을 "`fetch(import.meta.env.BASE_URL + 'share-viewer.html')`로 받는다"로 바꾸고, §4.4의 "`?raw` 모듈 타입 선언" 문구를 지운다. §4.5 `init` 행을 `places`(id·이름·경도·위도·라벨 색 이름 또는 `null`)로 바꾼다.
- [x] **Step 3:** 커밋은 Task 0과 계획 문서를 함께: `docs: HTML 공유 내보내기 구현 계획과 스펙 r3`

---

### Task 1: 공유 데이터 형식과 만들기

**Files:**
- Create: `src/schema/share.ts`, `src/domain/share/build-share.ts`
- Test: `tests/unit/domain/share/build-share.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/schema/share.ts
  export const ShareDocSchema: Schema (Struct, 아래 타입과 같은 모양, onExcessProperty: 'error'로 검증)
  export type ShareLabel = { id: string; name: string; color: LabelColor; order: number };
  export type SharePlace = { id: string; name: string; address: string; lng: number; lat: number;
    labelIds: string[]; memo?: string; naverSid?: string };
  export type ShareDoc = { format: 'tripmap-share'; version: 1; title: string; createdAt: string;
    labels: ShareLabel[]; places: SharePlace[] };
  // src/domain/share/build-share.ts
  export function buildShareDoc(lib: Library, placeIds: readonly string[],
    opts: { title: string; includeMemo: boolean; now: Date }): ShareDoc
  ```
- 라벨 색 목록 `LABEL_COLORS`를 `src/schema/label-colors.ts`(의존성 없음)로 옮기고 `src/schema/library.ts`는 거기서 다시 export한다. 보기 화면·지도 페이지·메시지 규약은 이 파일만 import한다(Effect가 번들에 들어가지 않게).
- `ShareDoc` 타입은 보기 화면이 `import type`으로 쓰므로 `src/schema/share.ts`에서 타입만 따로 export한다(보기 화면 번들에 Effect가 들어가지 않게, 보기 화면은 반드시 `import type`).

- [ ] **Step 1: 실패하는 테스트** — `tests/unit/library/fixtures`의 `sampleLibrary`·`makePlace`·`withPlaces`를 쓴다.
  - `keeps the given order and drops deleted or unknown ids`: `buildShareDoc(lib, [id(3), 'zzzzzzzzzz', id(1), deletedId], …).places.map(p => p.id)` → `[id(3), id(1)]`
  - `includes only live labels used by exported places, in label order`: 장소 3(맛집+바다뷰)만 → `labels.map(l => l.name)` → `['맛집', '바다뷰']`, 지운 라벨이 붙은 장소면 그 라벨 id가 `labelIds`에서도 빠짐
  - `omits memo when includeMemo is false and drops empty memos`: 장소 5의 메모 → 켜면 `'비밀 메모: 창가 자리가 좋아요'`, 끄면 `'memo' in place === false`, 빈 메모 장소는 켜도 `memo` 없음
  - `sets naverSid only for naver places`: `source: { kind: 'naver', sid: '123' }` → `naverSid: '123'`, `pin` → 없음
  - `writes header fields`: `format`·`version`·`title`(앞뒤 공백 제거)·`createdAt === now.toISOString()`
  - `passes ShareDocSchema`: 결과를 `Schema.decodeUnknownSync(ShareDocSchema)(doc, { onExcessProperty: 'error' })`가 던지지 않음
  - `handles 300 places`: 300곳 보관함 → 300곳(Review Focus 3과 큰 목록)
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/share/build-share.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3:** 구현. 라벨 순서는 `label.order.value` 오름차순, 장소의 `labelIds`는 원래 순서에서 살아 있는 것만.
- [ ] **Step 4:** 같은 명령 → PASS
- [ ] **Step 5:** 커밋 `feat(share): 공유 데이터 형식과 보관함에서 만들기`

---

### Task 2: 틀에 데이터 넣기와 파일 이름

**Files:**
- Create: `src/domain/share/inject.ts`
- Test: `tests/unit/domain/share/inject.test.ts`

**Interfaces:**
- Consumes: `ShareDoc`(Task 1)
- Produces:
  ```ts
  export const SHARE_DATA_PLACEHOLDER = '__TRIPMAP_DATA__';
  export function serializeShareDoc(doc: ShareDoc): string;            // 이스케이프된 JSON
  export function injectShareDoc(template: string, doc: ShareDoc): string; // 자리가 정확히 1개가 아니면 throw
  export function shareFileName(title: string, now: Date): string;
  ```

- [ ] **Step 1: 실패하는 테스트**
  - `blocks script injection from user strings`: 메모 `'</script><script>window.__injected = 1</script><!-- '` + `String.fromCharCode(0x2028, 0x2029)`, 틀 `<!doctype html><html><head><script type="application/json" id="tripmap-share">__TRIPMAP_DATA__</script></head><body></body></html>`.
    `new JSDOM(html, { runScripts: 'dangerously' })`로 파싱해 (1) 블록 `textContent`에 `<` 없음, (2) `document.scripts.length === 1`, (3) `window.__injected === undefined`, (4) `JSON.parse(블록)`이 원래 doc과 같음.
  - `serialize contains no raw <, U+2028, U+2029`: `new RegExp(`[<\\u2028\\u2029]`).test(serializeShareDoc(doc)) === false`
  - `throws when the placeholder is missing or repeated`
  - `does not treat $ patterns in data as replacement tokens`: 이름 `'$& $1 $$'` → 파싱 결과에 그대로(교체는 함수 replacer 사용)
  - `shareFileName`: `('정자역 카페', 2026-10-11)` → `'정자역-카페-20261011.html'`; `('a/b:c*?"<>|d', …)` → `'a-b-c-d-20261011.html'`; `('   ', …)` → `'trip-map-20261011.html'`; `('..이름..', …)` → `'이름-20261011.html'`; 가(U+AC00) 50자 → 앞 40자 + `-20261011.html`; 이모지 40자 경계에서 서로게이트가 깨지지 않음(코드 포인트로 자름); 날짜는 로컬 기준(`new Date(2026, 9, 11, 23, 59)` → `20261011`)
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/share/inject.test.ts` → FAIL
- [ ] **Step 3:** 구현. 금지 문자 `[\\/:*?"<>|\u0000-\u001f]`·공백 연속 → `-`, `-` 연속 → 하나, 앞뒤 `-`·`.` 제거.
- [ ] **Step 4:** PASS, 그리고 `grep -nP '[\x{2028}\x{2029}]' src/domain/share/inject.ts tests/unit/domain/share/inject.test.ts` → 출력 없음
- [ ] **Step 5:** 커밋 `feat(share): 공유 데이터를 HTML 틀에 안전하게 넣고 파일 이름을 만든다`

---

### Task 3: 메시지 규약

**Files:**
- Create: `src/share-protocol.ts`
- Test: `tests/unit/share-protocol.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SHARE_SOURCE = 'tripmap-share';
  export const SHARE_PROTOCOL_VERSION = 1;
  export type MapPlace = { id: string; name: string; lng: number; lat: number; color: LabelColor | null };
  export type ToMap = { kind: 'init'; places: MapPlace[] } | { kind: 'focus'; placeId: string | null }
    | { kind: 'filter'; placeIds: string[] };
  export type FromMap = { kind: 'ready'; maxV: number } | { kind: 'select'; placeId: string }
    | { kind: 'tiles-failed' };
  export type Envelope<T> = T & { source: typeof SHARE_SOURCE; v: typeof SHARE_PROTOCOL_VERSION };
  export function envelope<T extends ToMap | FromMap>(msg: T): Envelope<T>;
  export function parseToMap(data: unknown): ToMap | null;   // 봉투 없는 메시지 반환
  export function parseFromMap(data: unknown): FromMap | null;
  ```
- 이 파일은 `src/schema/label-colors.ts`(Task 1)만 import한다. `color`는 `LABEL_COLORS`에 있는 값 또는 `null`만 통과.

- [ ] **Step 1: 실패하는 테스트**: 각 `kind` 정상 통과; `source` 다름·`v: 2`·모르는 `kind`·`places`가 배열 아님·`lng`가 문자열·`color: 'black'`·`placeId: 3` → `null`; `focus`의 `placeId: null` 통과; `envelope({kind:'tiles-failed'})` → `{ source: 'tripmap-share', v: 1, kind: 'tiles-failed' }`
- [ ] **Step 2:** FAIL 확인 → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat(share): 보기 화면과 지도 페이지 사이 메시지 규약 v1`

---

### Task 4: 보기 화면 — 데이터 읽기와 목록 그리기

**Files:**
- Create: `src/share-viewer/parse.ts`, `src/share-viewer/render.ts`, `src/share-viewer/styles.css`
- Test: `tests/unit/share-viewer/parse.test.ts`, `tests/unit/share-viewer/render.test.ts`

**Interfaces:**
- Consumes: `ShareDoc`(타입만), `TOKENS.pastel`(Task와 무관, 기존)
- Produces:
  ```ts
  // parse.ts
  export function parseShareDoc(value: unknown): ShareDoc | null;
  export function readShareDoc(doc: Document): ShareDoc | null; // #tripmap-share textContent → JSON.parse → parseShareDoc, 실패 null
  // render.ts
  export type MapPort = { focus(placeId: string | null): void; filter(placeIds: string[]): void };
  export function naverUrl(place: SharePlace): string;
  export function renderViewer(root: HTMLElement, doc: ShareDoc, map: MapPort): { highlight(placeId: string): void };
  export function renderBroken(root: HTMLElement): void; // '파일 내용을 읽지 못했어요'
  ```
- DOM 구조(테스트와 CSS가 기대): 머리글 `header`(제목 `h1`, 부제 `p`), 라벨 칩 `div[role=group][aria-label=라벨]` 안 `button[aria-pressed]`(첫 칩 "모두"), 목록 `ul[aria-label=장소 목록]` 안 `li > article[data-place-id]`(이름 `h2`, 라벨 칩 `span`, 주소 `p`, 메모 `p.memo`, 링크 `a`), 지도 자리 `div#map`, 바닥글 `footer`.
- CSS: `:root`에 파스텔 라이트 토큰을 CSS 변수로, `@media (prefers-color-scheme: dark)`에 다크. 토큰 값은 빌드 때 `main.ts`가 아니라 **CSS에 직접 쓰지 말고** `render.ts`의 `applyTheme(doc: Document)`가 `TOKENS.pastel.light/dark`로 `<style>`을 만들어 넣는다(값을 복제하지 않기 위해). 768px 미만: 지도 높이 `40vh` 위, 목록 아래 스크롤. 이상: 목록 360px 왼쪽 + 지도 오른쪽, 각자 스크롤. 메모 `white-space: pre-wrap`. 강조 카드 `aria-current="true"` + 테두리.

- [ ] **Step 1: 실패하는 테스트 (parse)**: 정상 doc 통과; `format` 다름·`version: 2`·`places` 아님·`lat` 문자열·라벨 `color: 'black'` → `null`; `memo`·`naverSid` 없어도 통과; `readShareDoc` — 블록 없음·JSON 깨짐 → `null`
- [ ] **Step 2: 실패하는 테스트 (render)**, `MapPort`는 `vi.fn()` 두 개:
  - 제목·부제(`2026.10.11 · 5곳`, `createdAt` 로컬 날짜)·`document.title === doc.title`
  - 카드 수 = 장소 수, 이름·주소·라벨 칩 이름
  - 라벨이 1개면 칩 줄 없음, 2개 이상이면 "모두" + 라벨 칩
  - 칩 클릭 → 해당 라벨 장소만 보임(`li` `hidden`), `map.filter`가 그 id 목록으로 호출, "모두" → 전부·전체 id
  - `naverUrl`: sid 있음 → `https://map.naver.com/p/entry/place/123`; 없음 → `https://map.naver.com/p/search/` + `encodeURIComponent('서혜커피 경기 성남시 …')`; 주소 빈 문자열 → 이름만. 링크 `target="_blank"`, `rel="noopener noreferrer"`
  - 카드 클릭 → `map.focus(id)`, 그 카드 `aria-current="true"`(이전 카드 해제)
  - **링크 클릭 → `map.focus` 호출 안 됨**(Review Focus 4)
  - `highlight(id)` → 그 카드 `aria-current`, `scrollIntoView` 호출(스텁)
  - 이름·메모의 `<b>x</b>` 가 태그가 아니라 글자로 보임(`querySelector('b') === null`), 메모 요소 `white-space`가 `pre-wrap`(계산 스타일 대신 클래스 확인)
  - 바닥글 문구 `trip-map에서 만든 파일`
  - `renderBroken` → 문구 `파일 내용을 읽지 못했어요`
  - 300곳 렌더 → 카드 300개
- [ ] **Step 3:** `yarn vitest run tests/unit/share-viewer` → FAIL → **Step 4:** 구현 → **Step 5:** PASS
- [ ] **Step 6:** 커밋 `feat(share-viewer): 공유 파일의 머리글·라벨 칩·장소 카드`

---

### Task 5: 보기 화면 — 지도 iframe 연결과 HTML 틀 빌드

**Files:**
- Create: `src/share-viewer/map-frame.ts`, `src/share-viewer/main.ts`, `src/share-viewer/index.html`, `build/inline-assets.ts`, `vite.viewer.config.ts`
- Modify: `package.json`(scripts), `.gitignore`(`public/share-viewer.html`), `tsconfig.node.json`(include에 두 설정 파일과 `build/inline-assets.ts`), `eslint` 설정이 새 설정 파일을 막으면 같은 방식으로 추가
- Test: `tests/unit/share-viewer/map-frame.test.ts`, `tests/unit/build/inline-assets.test.ts`

**Interfaces:**
- Consumes: `envelope`·`parseFromMap`·`MapPlace`(Task 3), `MapPort`·`renderViewer`·`renderBroken`·`readShareDoc`(Task 4)
- Produces:
  ```ts
  // map-frame.ts
  export const READY_TIMEOUT_MS = 10_000;
  export function toMapPlaces(doc: ShareDoc): MapPlace[]; // 첫 라벨 색 또는 null, 메모·주소·sid 없음
  export function connectMapFrame(host: HTMLElement, opts: { mapUrl: string; places: MapPlace[];
    onSelect(placeId: string): void; win?: Window }): MapPort;
  // build/inline-assets.ts
  export function inlineAssets(): Plugin; // vite Plugin
  ```
- `connectMapFrame` 동작: `iframe`(`title="지도"`, `src=mapUrl`, `loading` 기본) 생성 → `message` 수신 시 `event.source === iframe.contentWindow && event.origin === new URL(mapUrl).origin`인 것만 `parseFromMap`. `ready` → `init` 전송 후 대기 중이던 `focus`/`filter`를 순서대로 보냄(ready 전 호출은 큐에 쌓음). `select` → `onSelect`. `tiles-failed` 또는 10초 시한 → iframe 숨기고 실패 문구 표시. 시한 뒤 늦은 `ready` → 문구 걷고 iframe 보이고 `init`(Review Focus 1). 전송은 `iframe.contentWindow.postMessage(envelope(msg), new URL(mapUrl).origin)`.
- `main.ts`: `readShareDoc(document)` → `null`이면 `renderBroken(document.body)`; 아니면 `renderViewer`에 `connectMapFrame(#map, { mapUrl: import.meta.env.VITE_SHARE_MAP_URL ?? 'https://sch0718.github.io/landmark/', places: toMapPlaces(doc), onSelect: (id) => handle.highlight(id) })`가 돌려준 `MapPort`를 넘긴다(순환을 피하려 `onSelect`는 나중에 채우는 변수로).
- `index.html`: `<script type="application/json" id="tripmap-share">__TRIPMAP_DATA__</script>`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<meta charset="utf-8">`, 본문 비움, `main.ts` 모듈 스크립트.
- `inlineAssets` 동작(`apply: 'build'`, `enforce: 'post'`, `generateBundle`): HTML 자산의 `<script type="module" crossorigin src="…">`를 해당 청크 코드로, `<link rel="stylesheet" … href="…">`를 `<style>`로 바꾸고 그 청크·자산을 번들에서 지운다. 코드 안 `</script`는 `<\/script`로 바꾼다. 교체는 함수 replacer(`$` 패턴 방지).
- `vite.viewer.config.ts`: `root: 'src/share-viewer'`, `base: './'`, `build: { outDir: 'public', emptyOutDir: false, assetsInlineLimit: Infinity, modulePreload: false, rollupOptions: { input: 'src/share-viewer/index.html' } }` → 결과 이름을 `share-viewer.html`로(플러그인이 `fileName`을 바꾸거나 `closeBundle`에서 rename). `resolve.alias`의 `src`는 앱 설정과 같게.
- scripts: `"build:viewer": "vite build --config vite.viewer.config.ts"`, `"dev": "yarn build:viewer && vite"`, `"build": "yarn build:viewer && tsc -b && vite build"`.

- [ ] **Step 1: 실패하는 테스트 (map-frame)** — jsdom, 가짜 타이머. `iframe.contentWindow.postMessage`를 스텁하고, 받는 메시지는 `window.dispatchEvent(new MessageEvent('message', { data, origin, source: iframe.contentWindow }))`로 보낸다.
  - `ready` 전 `focus('a')`·`filter(['a'])` → 전송 없음; `ready` 후 `init`·`focus`·`filter` 순서로 전송, `targetOrigin === 'https://sch0718.github.io'`
  - `init.places`에 `memo`·`address`·`naverSid` 키 없음
  - origin이 다르거나 `source`가 다른 창인 `select` → `onSelect` 안 불림; 맞으면 불림
  - 10초 경과 → iframe `hidden`, 실패 문구 보임
  - `tiles-failed` → 같은 안내
  - 시한 뒤 늦은 `ready` → 안내 사라지고 iframe 보이고 `init` 전송
- [ ] **Step 2: 실패하는 테스트 (inline-assets)**: 가짜 번들(`{ 'index.html': {type:'asset', source:'<script type="module" crossorigin src="./assets/a.js"></script><link rel="stylesheet" crossorigin href="./assets/a.css">'}, 'assets/a.js': {type:'chunk', code:'x("</script>"); y("$&")'}, 'assets/a.css': {type:'asset', source:'b{}'} }`)로 `generateBundle` 호출 → HTML에 `<script type="module">`·`<\/script>`·`$&` 그대로·`<style>b{}</style>`, 외부 `src`/`href` 없음, `assets/*` 삭제
- [ ] **Step 3:** FAIL 확인 → **Step 4:** 구현 → **Step 5:** PASS
- [ ] **Step 6:** `yarn build:viewer` → `public/share-viewer.html` 생성, `grep -c '__TRIPMAP_DATA__' public/share-viewer.html` → `1`, `grep -c 'src="' public/share-viewer.html` → `0`(iframe은 런타임 생성), `wc -c` → 51200 이하
- [ ] **Step 7:** `yarn typecheck && yarn lint` 통과
- [ ] **Step 8:** 커밋 `feat(share-viewer): 지도 iframe 연결과 HTML 틀 하나로 빌드`

---

### Task 6: 지도 페이지 (Leaflet + OSM)

**Files:**
- Create: `src/share-map/index.html`, `src/share-map/main.ts`, `src/share-map/map.ts`, `src/share-map/styles.css`, `vite.map.config.ts`
- Modify: `package.json`(`leaflet` 1.9.4, `@types/leaflet`, script `build:map`, `build:ci`에 `yarn build:map` 추가), `.gitignore`(`dist-map/`), `tsconfig.node.json`(include)
- Test: `tests/unit/share-map/map.test.ts`, `tests/unit/share-map/main.test.ts`

**Interfaces:**
- Consumes: `parseToMap`·`envelope`·`MapPlace`·`FromMap`(Task 3), `createMarkerLabelElement`(기존 `src/components/map/marker-label.ts`), `TOKENS.pastel`
- Produces:
  ```ts
  // map.ts
  export const FOCUS_ZOOM = 16;
  export function createShareMap(container: HTMLElement, post: (msg: FromMap) => void,
    opts?: { dark?: boolean }): { init(places: MapPlace[]): void; focus(placeId: string | null): void;
    filter(placeIds: string[]): void; tileLayer: L.TileLayer };
  // main.ts
  export function startShareMap(win: Window, root: HTMLElement): void;
  ```
- 마커: `L.marker([lat,lng], { icon: L.divIcon({ html: element, className: '', iconSize: undefined, iconAnchor: [0,0] }) })`, `element = createMarkerLabelElement(name, fill, { selected, textColor, borderColor })`. 색: 라벨 있으면 `tokens.label[color].fill/text/marker`, 없으면 `bg.surface`/`text.primary`/`border`. 강조 시 아이콘을 다시 만들고 `setZIndexOffset(1000)`. 클릭 → `post({ kind: 'select', placeId })`.
- `init`: 모든 마커 추가, 점 1개 또는 고유 좌표 1개 → `setView(점, 16)`, 아니면 `fitBounds(점들, { padding: [40, 40] })`.
- `focus(id)`: `setView(점, 16)` + 강조, `null` → 강조 해제. `filter(ids)`: 그 id만 지도에 남김(다시 맞추지 않음).
- 타일 실패: `tileload` 횟수·`tileerror` 횟수를 세고, 타일 레이어 `load` 이벤트에서 `loaded === 0 && errors > 0`이면 한 번만 `post({ kind: 'tiles-failed' })`.
- 출처: `attributionControl` 접두어 끄고(`setPrefix(false)`) 타일 레이어 attribution `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`(Leaflet이 HTML로 넣는 유일한 고정 문자열, 사용자 데이터 아님).
- `startShareMap`: `win.parent === win`이면 `root`에 `trip-map에서 내보낸 파일 안에서 쓰는 지도예요`만 보이고 끝. 아니면 지도 생성(`dark = win.matchMedia('(prefers-color-scheme: dark)').matches`), `message` 중 `event.source === win.parent`인 것만 `parseToMap` → `init`/`focus`/`filter`. `post`는 `win.parent.postMessage(envelope(msg), '*')`. 시작 직후 `post({ kind: 'ready', maxV: 1 })`.
- `vite.map.config.ts`: `root: 'src/share-map'`, `base: './'`, `build.outDir: '../../dist-map'`(절대 경로로), `emptyOutDir: true`, `alias` 동일. Leaflet CSS는 `main.ts`에서 `import 'leaflet/dist/leaflet.css'`.

- [ ] **Step 1: 실패하는 테스트 (map)** — jsdom에서 실제 Leaflet. 컨테이너에 크기(`clientWidth/Height` 스텁 또는 `Object.defineProperty`)를 준다. `post = vi.fn()`.
  - `init` 3곳 → 마커 3개(`.leaflet-marker-icon` 3), 이름 글자 그대로(`<b>` 이름이 태그로 안 됨)
  - 1곳 → `map.getZoom() === 16`, 같은 좌표 2곳 → 16(Review Focus 2)
  - 마커 클릭 → `post({ kind: 'select', placeId })`
  - `focus(id)` → 줌 16·중심 근처, 그 마커 테두리 3px(`selected`)
  - `filter([a])` → 마커 1개
  - 타일: `tileLayer.fire('tileerror')` ×2 후 `fire('load')` → `tiles-failed` 1번; `fire('tileload')` 후 `fire('tileerror')`, `fire('load')` → 안 보냄; `load` 두 번 → 한 번만
- [ ] **Step 2: 실패하는 테스트 (main)**: `win.parent === win` → 안내 문구만; iframe 상황(가짜 `parent` 객체, `postMessage` 스텁) → 시작 시 `ready`(`source: 'tripmap-share', v: 1, maxV: 1`, targetOrigin `'*'`); `source`가 parent가 아닌 메시지 무시; parent의 `init` → 마커 생성
- [ ] **Step 3:** FAIL → **Step 4:** `yarn add -E leaflet@1.9.4 && yarn add -D -E @types/leaflet` 후 구현 → **Step 5:** PASS
- [ ] **Step 6:** `yarn build:map` → `dist-map/index.html`·`dist-map/assets/*` 생성, `grep -ci 'referrer' dist-map/index.html` → `0`
- [ ] **Step 7:** 커밋 `feat(share-map): GitHub Pages용 OSM 지도 페이지`

---

### Task 7: 앱 — 틀 서비스와 공유 파일 만들기

**Files:**
- Create: `src/services/share-template.ts`, `src/sections/share-export/make-share-html.ts`
- Modify: `src/services/errors.ts`(오류 2개), `src/lib/effect/runtime.ts`(`AppLayer`에 `ShareTemplate.layer`), `tests/unit/sections/shell/harness.tsx`(`renderApp` 옵션 `shareTemplate?: string | Error`, 테스트 레이어에 `ShareTemplate.layerWith(...)`)
- Test: `tests/unit/services/share-template.test.ts`, `tests/unit/sections/share-export/make-share-html.test.ts`

**Interfaces:**
- Consumes: `buildShareDoc`(Task 1), `injectShareDoc`·`SHARE_DATA_PLACEHOLDER`(Task 2), `ShareDocSchema`
- Produces:
  ```ts
  // errors.ts
  export class ShareTemplateUnavailable extends Schema.TaggedError<...>()('ShareTemplateUnavailable', { reason: Schema.String })
    // userMessage: '내보내기 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요'
  export class ShareDocInvalid extends Schema.TaggedError<...>()('ShareDocInvalid', { message: Schema.String })
    // userMessage: 같은 문구(프로그램 오류지만 사용자에게는 같은 안내)
  // share-template.ts
  export class ShareTemplate extends Context.Service<ShareTemplate,
    { readonly load: Effect.Effect<string, ShareTemplateUnavailable> }>()('tripmap/ShareTemplate') {
    static layerWith(options: { fetch: typeof fetch; url: string }): Layer<ShareTemplate>;
    static readonly layer; // fetch: globalThis.fetch, url: `${import.meta.env.BASE_URL}share-viewer.html`
  }
  // make-share-html.ts
  export function makeShareHtml(lib: Library, placeIds: readonly string[],
    opts: { title: string; includeMemo: boolean; now: Date }):
    Effect.Effect<{ html: string; fileName: string; count: number }, ShareTemplateUnavailable | ShareDocInvalid, ShareTemplate>;
  ```
- `load`: 응답이 ok가 아니거나, 네트워크 오류, 본문에 자리 문자열이 정확히 1개가 아니면 `ShareTemplateUnavailable`. 성공한 본문은 레이어 안에서 캐시(같은 세션 재사용), 실패는 캐시하지 않음(다시 시도 가능).
- `makeShareHtml`: `buildShareDoc` → `ShareDocSchema` 검증(실패 시 `ShareDocInvalid`, `ErrorReporter`가 보고하도록 실패로 둔다) → `load` → `injectShareDoc` → `shareFileName`.
- (나중 변경, Task 13) `makeShareHtml`은 지웠다. 지금 API는 틀 문자열을 받는 동기 함수 `renderShareHtml(template, lib, placeIds, opts): Result<ShareHtml, ShareDocInvalid>`이고, 틀은 내보내기 창이 `ShareTemplate.load`로 미리 받는다.

- [ ] **Step 1: 실패하는 테스트**(`@effect/vitest`의 `it.effect` 패턴, 기존 `tests/unit/services/*` 참고):
  - `load` 성공 → 본문; 두 번째 `load`는 `fetch` 1번만 호출
  - `fetch` 거부·`status 404`·자리 0개·자리 2개 → `ShareTemplateUnavailable`, 실패 뒤 다시 `load` → `fetch` 다시 호출
  - `makeShareHtml` → `html`에 데이터 블록, `fileName === '정자역-카페-20261011.html'`, `count`
  - 장소 0곳이어도 성공(`count: 0`) — 창이 막지만 함수는 막지 않는다
- [ ] **Step 2:** FAIL → **Step 3:** 구현 + `runtime.ts`·`harness.tsx` 연결 → **Step 4:** PASS, `yarn test` 전체 PASS(기존 테스트가 새 서비스 누락으로 깨지지 않는지)
- [ ] **Step 5:** 커밋 `feat(share): 공유 HTML 틀 서비스와 파일 만들기`

---

### Task 8: 앱 — 내보내기 창과 버튼

**Files:**
- Create: `src/sections/share-export/export-targets.ts`, `src/sections/share-export/ExportHtmlDialog.tsx`
- Modify: `src/components/icons.tsx`(`ShareIcon` = `~icons/lucide/share-2`), `src/sections/library/FilterBar.tsx`(`onExport(): void` prop, `SortMenu` 옆 아이콘 버튼 `aria-label="내보내기"`, 44px), `src/sections/library/BulkBar.tsx`(`onExport(): void` prop, `내보내기` 버튼), `src/sections/library/LibraryPage.tsx`(창 상태 연결)
- Test: `tests/unit/sections/share-export/export-targets.test.ts`, `tests/unit/sections/share-export/export-dialog.test.tsx`

**Interfaces:**
- Consumes: `makeShareHtml`(Task 7), `downloadText`(기존 `src/lib/download-text.ts`), `startEffect`, `LibraryQuery`, `toast`(sonner)
- Produces:
  ```ts
  // export-targets.ts
  export type ExportTargets = { ids: string[]; summary: string; defaultTitle: string };
  export function exportTargets(visible: Place[], selectedIds: readonly string[], query: LibraryQuery,
    labels: Label[]): ExportTargets;
  // ExportHtmlDialog.tsx
  export function ExportHtmlDialog(props: { open: boolean; onClose(): void; targets: ExportTargets }): JSX.Element;
  ```
- `exportTargets`: 선택이 있으면 보이는 목록 중 선택된 것(목록 순서) → `선택한 N곳을 내보냅니다`. 없으면 보이는 전부 → `지금 보이는 N곳을 내보냅니다` + 라벨 필터 있으면 ` (라벨: 이름, 이름)`(라벨 순서, 지운 라벨 제외) + `query.text.trim()` 있으면 ` (검색: 텍스트)`. `defaultTitle`: 라벨 필터가 정확히 1개(그리고 `unlabeled` 아님)면 그 이름, 아니면 `장소 N곳`.
- 창: 제목 입력(`label="제목"`, 앞뒤 공백 제거 후 1~60자가 아니면 두 버튼 비활성 + 도움말 `제목은 1~60자로 써 주세요`), `메모 포함` 체크(기본 켬), `파일 저장`, `공유`(`navigator.canShare?.({ files: [new File([''], 'x.html', { type: 'text/html' })] })`가 참일 때만 렌더). 0곳 → 두 버튼 비활성 + `내보낼 장소가 없어요`. 작업 중(`busy`) 두 버튼 비활성(Review Focus 5).
  - 저장: `startEffect(makeShareHtml(...))` → `downloadText(html, fileName, 'text/html;charset=utf-8')` → 창 닫기 + `toast('파일을 만들었어요')`.
  - 공유: 같은 html로 `new File([html], fileName, { type: 'text/html' })` → `navigator.share({ files: [file], title })`. `AbortError` → 조용히 창 유지. 그 외 → 창 안 `공유하지 못했어요. 파일 저장을 이용해 주세요`.
  - 만들기 실패(`ShareTemplateUnavailable`/`ShareDocInvalid`) → 창 안 `error.userMessage`, 버튼은 다시 누를 수 있음.
  - 창을 열 때마다 제목·체크·오류를 `targets` 기준으로 초기화.
- LibraryPage: `exportTargets(places, selectedIds, query, labels)`를 메모하고, 도구줄·BulkBar 버튼이 같은 창을 연다.

- [ ] **Step 1: 실패하는 테스트 (export-targets)**: 선택 2곳 → ids 목록 순서·`선택한 2곳을 내보냅니다`; 보이지 않는 선택 id는 무시(Review Focus 3); 선택 없음 + 라벨 `카페` 필터 + 검색 `서` → `지금 보이는 1곳을 내보냅니다 (라벨: 카페) (검색: 서)`, `defaultTitle: '카페'`; 라벨 2개 필터 → `defaultTitle: '장소 N곳'`; 필터 없음 → 부가 문구 없음
- [ ] **Step 2: 실패하는 테스트 (dialog)** — `renderLibrary`(기존 fixtures) + `renderApp`의 `shareTemplate` 옵션, `downloadText`는 `vi.mock`:
  - 도구줄 `내보내기` → 창, 대상 문구·제목 기본값
  - 저장 → `downloadText`가 데이터 블록이 든 html·`'<제목>-YYYYMMDD.html'`·`'text/html;charset=utf-8'`로 1번, 토스트 `파일을 만들었어요`, 창 닫힘
  - `메모 포함` 끔 → html에 메모 문자열 없음
  - 저장을 빠르게 두 번 클릭 → `downloadText` 1번(Review Focus 5)
  - 필터로 0곳 → 버튼 비활성, `내보낼 장소가 없어요`
  - 제목 공백만·61자 → 버튼 비활성
  - 틀 실패(`shareTemplate: new Error`) → 창 안 틀 실패 문구, 다시 누르면 재시도(성공으로 바꾼 뒤 저장됨)
  - `navigator.canShare` 없음 → `공유` 버튼 없음; 참 → 있음, `share`가 `AbortError`로 거부 → 문구 없음·창 유지; 다른 오류 → 공유 실패 문구
  - 장소 선택 후 BulkBar `내보내기` → `선택한 N곳을 내보냅니다`
- [ ] **Step 3:** FAIL → **Step 4:** 구현 → **Step 5:** PASS, `yarn test && yarn typecheck && yarn lint` 통과
- [ ] **Step 6:** 커밋 `feat(library): 장소를 HTML 파일로 내보내는 창과 버튼`

---

### Task 9: E2E — 내보낸 파일을 `file://`로 열기

**Files:**
- Create: `tests/e2e/share-export.spec.ts`
- Modify: `playwright.config.ts`(지도 페이지 webServer 추가, 프로젝트 testMatch), `tests/e2e/global-setup.ts`(e2e용 `build:viewer`), `package.json`(`test:e2e`·`test:e2e:ci` 앞에 `yarn build:map`)

**Interfaces:**
- Consumes: 앱 버튼·창 문구(Task 8), 보기 화면 DOM(Task 4), 마커 클래스 `.leaflet-marker-icon`(Task 6)

- [ ] **Step 1:** `playwright.config.ts`의 `webServer`를 배열로: 기존 앱 서버 + `{ command: 'yarn vite preview --config vite.map.config.ts --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: !isCI }`. `global-setup.ts`에서 `spawnSync('yarn', ['build:viewer'], { env: { ...process.env, VITE_SHARE_MAP_URL: 'http://localhost:5174/' }, stdio: 'inherit' })`(실패 시 throw) — 앱 서버를 재사용해도 틀이 e2e 주소를 가리키게 한다. `share-export.spec.ts`를 desktop·iphone 프로젝트 testMatch에 추가.
- [ ] **Step 2:** 테스트 작성 (`seedStorage` 기존 fixtures):
  - `@smoke 라벨로 거른 장소를 HTML로 내보내고 file://로 열면 목록과 지도가 보인다`: 라벨 칩 하나 → `내보내기` → `파일 저장` → `page.waitForEvent('download')` → `download.path()`; 새 페이지에서 `context.route('https://tile.openstreetmap.org/**', …)`로 1×1 PNG를 돌려주며 요청의 `referer` 헤더를 모은다; `page.goto('file://' + path)`.
    확인: 카드 수 = 거른 수; iframe(`title="지도"`) 안 `.leaflet-marker-icon` 수 = 같은 수; 마커 하나 클릭 → 그 카드 `aria-current="true"`; 다른 카드 클릭 → iframe 안 그 마커가 강조(3px 테두리); 라벨이 2개 이상이면 칩 하나 → 마커 수 감소; 첫 카드 링크 `href`가 `https://map.naver.com/p/`로 시작; 모은 타일 요청의 referer가 모두 `http://localhost:5174/`로 시작; 파일 페이지의 요청 중 `.js`가 없음(`page.on('request')`로 file 문서 프레임 기준).
  - `지도 페이지가 없으면 10초 뒤 안내가 나오고 목록은 그대로다`: 같은 파일을 열되 `context.route('http://localhost:5174/**', r => r.abort())` → 12초 안에 `지도를 불러오지 못했어요…` 보임, 카드 수 그대로.
  - `틀 크기`: `fs.statSync('public/share-viewer.html').size <= 51200`.
- [ ] **Step 3:** 개발 서버를 끈 상태에서 `yarn test:e2e --project desktop --grep 내보내` 와 `--project iphone` → PASS
- [ ] **Step 4:** `yarn test:e2e:ci` 전체 PASS(기존 스모크 회귀 없음)
- [ ] **Step 5:** 커밋 `test(e2e): 내보낸 HTML 파일을 file://로 열어 목록·지도·Referer 확인`

---

### Task 10: 지도 페이지 배포 (`sch0718/landmark`)

> 저장소 밖을 바꾸는 작업이다. Step 1~4는 실행 직전에 사용자에게 무엇을 할지 보여 주고 확인받는다(기존 Java 코드는 `backup/java-gradle-2025`에 이미 보존됨, `18ad6f0`).

**Files:**
- Create: `.github/workflows/deploy-share-map.yml`

- [ ] **Step 1 (확인 후):** 배포 키: `ssh-keygen -t ed25519 -N '' -C 'trip-map deploy-share-map' -f <스크래치>/landmark_deploy` → `gh repo deploy-key add <스크래치>/landmark_deploy.pub -R sch0718/landmark --allow-write -t trip-map-deploy` → `gh secret set LANDMARK_DEPLOY_KEY -R sch0718/trip-map < <스크래치>/landmark_deploy` → 개인 키 파일 삭제.
- [ ] **Step 2:** 워크플로: `on: push(branches: [main], paths: [src/share-map/**, src/share-protocol.ts, src/schema/label-colors.ts, src/theme/tokens/**, src/components/map/marker-label.ts, vite.map.config.ts, package.json, yarn.lock])` + `workflow_dispatch`. 단계: checkout → setup-node 24(yarn 캐시) → `yarn install --frozen-lockfile` → `yarn build:map` → `actions/checkout@v4`로 `repository: sch0718/landmark`, `ssh-key: ${{ secrets.LANDMARK_DEPLOY_KEY }}`, `path: landmark`를 받는다(이 체크아웃이 푸시 인증도 맡는다) → `landmark/`에서 `.git`·`README.md`를 뺀 모든 파일 삭제 → `dist-map/*` 복사, `.nojekyll` 생성 → 변경이 있으면 `git -c user.name='trip-map deploy' -c user.email='actions@users.noreply.github.com' commit -m "deploy: trip-map ${GITHUB_SHA::7}"` → `git push`. `concurrency: deploy-share-map`.
- [ ] **Step 3 (확인 후):** `landmark` `main`을 지도용으로 바꾼다: 임시 디렉터리에 `git clone`, `git rm -r` 전부, `README.md`(용도: "trip-map에서 내보낸 HTML 파일이 iframe으로 띄우는 지도 페이지. 소스는 sch0718/trip-map `src/share-map/`, 배포는 그 저장소의 Actions. 예전 Java 코드는 `backup/java-gradle-2025` 브랜치") + `.nojekyll` 커밋 → push.
- [ ] **Step 4 (확인 후):** Pages 켜기: `gh api -X POST repos/sch0718/landmark/pages -f 'source[branch]=main' -f 'source[path]=/'`.
- [ ] **Step 5:** 이 계획의 PR이 병합된 뒤 `gh workflow run deploy-share-map.yml -R sch0718/trip-map` → 완료 확인 → `curl -sI https://sch0718.github.io/landmark/` 200, 본문에 `assets/` 스크립트. 인앱 브라우저로 직접 열어 `trip-map에서 내보낸 파일 안에서 쓰는 지도예요` 확인.
- [ ] **Step 6:** 커밋(워크플로 파일) `ci: 지도 페이지를 sch0718/landmark GitHub Pages로 배포`

---

### Task 11: 정자역 카페 데이터로 실제 파일 만들기

> 앱 코드 변경 없음. 데이터 파일은 스크래치 디렉터리에만 두고 커밋하지 않는다. 김이든 세션의 카페 정보(이름·추천 이유·도보 시간·일요일 영업시간·휴무)만 쓰고 대화 내용은 쓰지 않는다.

- [ ] **Step 1:** 5곳(서혜커피, 로스팅하우스 허깅 분당점, 카페 담, 오리지날, 카페 스프링)의 도로명 주소를 웹 검색으로 확인하고, 좌표는 주소로 OSM Nominatim(`https://nominatim.openstreetmap.org/search?format=json&q=…`, `User-Agent: trip-map/0.1 (personal use)`, 요청 사이 1초 이상)에서 얻는다. 못 찾은 곳은 사용자에게 알리고 빼거나 확인을 받는다. 확인 날짜를 기록한다.
- [ ] **Step 2:** 옛 여행 JSON(`src/schema/legacy/trip-data.ts` 형식)을 만든다: `schemaVersion: 1`, `publicId`(형식은 `src/schema/common.ts`의 `PublicId`), `title: '정자역 카페'`, `startDate`=`endDate`=`2026-10-11`, `days: [{ date: '2026-10-11', stops: [], legs: [] }]`, `folders: [{ id: 'f1', name: '정자역 카페', count: 5 }]`, `places`의 키 `c:jeongja-<영문>`, `category: '카페'`, `folderIds: ['f1']`, `savedAt` 현재 시각, `naverMemos: [{ folderId: 'f1', memo: … }]`(추천 이유 / 정자역에서 도보 N분 / 일요일 영업시간 또는 `일요일 정기휴무` / `출처: 블로그 후기(2026-05~09), 2026-10-11 정리`).
  앱의 검증으로 미리 확인: `yarn tsx -e`로 `TripDataSchema`를 `TRIP_DATA_PARSE`와 함께 디코드해 통과.
- [ ] **Step 3:** 이 브랜치의 앱(`yarn dev`)에서 설정 → 옛 여행 가져오기로 파일을 넣는다. 가져온 메모 앞의 `[네이버 · 정자역 카페]` 줄은 상세의 메모 편집에서 지운다.
- [ ] **Step 4:** 보관함에서 `정자역 카페` 라벨로 거르고 내보내기 → 파일 저장. 지도 페이지가 아직 배포 전이면 `VITE_SHARE_MAP_URL=http://localhost:5174/`로 빌드한 틀과 `vite preview` 지도 서버로 먼저 확인하고, 배포 뒤 기본 주소로 다시 내보낸다.
- [ ] **Step 5:** 결과 파일을 인앱 브라우저로 PC 크기와 휴대폰 크기(375×812)에서 열어 카드 5개·마커 5개·카드↔마커 연결·네이버 링크를 확인하고 스크린샷을 남긴다.
- [ ] **Step 6:** 결과 HTML을 저장소 밖 사용자 폴더(`/Users/shinchoonho/01.workspace/여행계획/` 아래, 파일 이름은 `shareFileName` 결과)에 두고 `SendUserFile`로 전달한다.
