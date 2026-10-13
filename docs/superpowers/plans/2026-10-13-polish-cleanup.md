# 다듬기 1: 결함·코드 정리 (하위 프로젝트 D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 어디서도 쓰지 않는 옛 PoC 코드를 지우고, 미뤄 둔 작은 결함·UX·중복을 고치고, README를 지금 앱에 맞춘다. 사용자에게 보이는 동작은 스펙 §3의 수정 말고는 바뀌지 않는다.

**Architecture:** 삭제는 진입점에서 닿지 않는 파일만 대상으로 하고, 그 판정을 스크립트(`yarn orphans`)로 남긴다. 나머지는 기존 파일 안의 작은 수정과 공통 모듈(`src/sections/add-place/shared.ts`, `src/sections/share-import/drag-files.ts`, `src/schema/library.ts`의 라벨 이름 도우미)로 옮기기다.

**Tech Stack:** TypeScript 6, React 19, MUI 7, Jotai, Effect 4.0.2, Vite 8, Vitest 5(jsdom), Playwright, Node 24 스크립트.

**Spec:** `docs/superpowers/specs/2026-10-13-polish-cleanup-design.md`

## Global Constraints

- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`(git 훅에도 필요). 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 파일에 U+2028/U+2029 원문자 금지. 커밋 전 `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- **문구를 바꾸지 않는다.** 새 문구는 `주소 찾는 중…` 하나뿐. 기존 문구(`라벨 이름은 30자까지예요`, `이름이 30자를 넘어요`, `이름은 1–30자`, `최대 30자`, `1–30자로 입력하세요`, `추가했어요` 등)는 글자 그대로 둔다.
- **모양을 바꾸지 않는다.** 스타일 값은 옮기기만 한다.
- `schemaVersion` 2, 저장 키 `tripmap:library:v2`·`tripmap:routes:v1`, 공유 형식 `version: 1` 그대로.
- 지키는 것: 옛 여행 가져오기(`/t/<publicId>`, `src/sections/settings/*`, `src/domain/library/legacy-import.ts`), `src/schema/legacy/*`, `pipeline/**`과 그것만 쓰는 `src/domain/{overlay,reconcile,day-hash,leg-index,date-groups,day-totals}.ts`.
- E2E는 `E2E_PORT=5175`로 돌린다(5173은 다른 프로젝트 `stock-trade`의 개발 서버 — 절대 끄지 않는다, 5174는 Playwright가 띄우는 지도 미리보기 서버).
- 오류 응답 헤더 `Cache-Control: private, no-store`. 화면 크기 판정은 `useMediaQuery(query, { noSsr: true })`.

## Review Focus

1. **지운 파일을 동적 import·문자열 경로·테스트 도우미가 여전히 참조** → 빌드·타입·테스트·E2E가 깨진다. `yarn orphans` + `yarn build:ci` + E2E 전체로 Task 1·6에서 고정.
2. **`map-view.test.tsx`를 고치다 지도 인증 실패 시험이 사라짐** → 네이버 인증 실패 안내가 회귀해도 모른다. Task 1에서 그 시험이 남아 있음을 확인.
3. **링크 입력 초안이 다음 흐름까지 남음**(다시 열었는데 지난 링크가 들어 있음) → 흐름이 `link`를 떠나면 비운다. Task 3 테스트.
4. **`noSsr`로 바꾼 뒤 matchMedia가 없는 테스트 환경에서 예외** → 기존 테스트의 matchMedia 모의가 그대로 동작해야 한다. Task 3에서 `yarn test` 전체.
5. **라벨 이름 도우미가 공백만 있는 이름·앞뒤 공백을 다르게 판단** → 지금 각 화면의 판단(앞뒤 공백 제거 후 길이)과 같아야 한다. Task 4 단위 테스트(빈 값·공백만·30자·31자·앞뒤 공백 포함 31자).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `scripts/find-orphans.mjs`, `package.json` | 진입점에서 닿지 않는 `src/**` 파일 보고(`yarn orphans`) |
| 스펙 §2의 파일·테스트 | 삭제 |
| `src/domain/codec.ts`, `src/repositories/edit-layer-repo.ts`, `src/schema/common.ts`, `tests/unit/components/map-view.test.tsx`, `tests/unit/domain/reconcile.test.ts`, `tests/unit/domain/codec.test.ts` | 옛 내보내기 걷어 내기 |
| `src/services/route-lookup.ts`, `src/server/http.ts`, `src/services/library-store.ts` | 동작 결함 |
| `src/stores/add-place.ts`, `src/sections/add-place/{LinkInputPanel,AddPlaceHost,PinCard,CandidateCard}.tsx`, `src/sections/shell/use-layout.ts` | 작은 UX |
| `src/sections/add-place/{shared.ts,FolderList.tsx,FolderPreview.tsx}`, `src/domain/library/add-place.ts`, `src/schema/library.ts` 외 라벨 이름 사용처 | 중복 정리 |
| `src/share-viewer/*`, `src/domain/share/read-share.ts`, `src/domain/codec.ts`, `src/domain/library/import-share.ts`, `src/sections/share-import/*`, `tests/e2e/share-import.spec.ts` | C에서 미룬 것 |
| `README.md` | 최신화 |

---

### Task 1: 옛 PoC 코드 삭제

**Files:**
- Create: `scripts/find-orphans.mjs`; Modify: `package.json`(`"orphans": "node scripts/find-orphans.mjs"`)
- Delete: 스펙 §2 "지우는 파일"·"함께 지우는 테스트" 전부
- Modify: `src/domain/codec.ts`, `src/repositories/edit-layer-repo.ts`, `src/schema/common.ts`, `tests/unit/components/map-view.test.tsx`, `tests/unit/domain/reconcile.test.ts`, `tests/unit/domain/codec.test.ts`, 그 밖에 삭제로 깨지는 import

**Interfaces:**
- Produces: `yarn orphans` — 루트(`src/main.tsx`, `src/share-viewer/main.ts`, `src/share-map/main.ts`, `functions/**/*.ts`, `pipeline/**/*.ts`, `build/**/*.ts`)에서 정적 `import`·`export … from`·동적 `import()`로 닿는 파일을 따라가 닿지 않는 `src/**/*.{ts,tsx}`를 한 줄씩 출력. 경로 별칭 `src/…`와 상대 경로를 푼다. `src/vite-env.d.ts`는 제외. 결과가 없으면 `orphans: none`, 종료 코드는 늘 0.

- [ ] **Step 1:** 스크립트를 먼저 만들고 지금 main에서 돌려, 스펙 §2의 11개 파일(과 `src/vite-env.d.ts` 제외)이 정확히 보고되는지 확인한다. 다르면 멈추고 보고한다(스펙의 삭제 목록이 틀렸을 수 있다).
- [ ] **Step 2:** 파일·테스트를 지우고, 걷어 낼 내보내기를 걷어 낸다. `map-view.test.tsx`는 `trip-store`·`legacy-trip-scope` 없이 `MapView`를 직접 그리도록 고친다. 인증 실패 시험(`onNaverAuthFailure` → `지도를 불러오지 못했어요. 도메인 등록을 확인하세요`)은 그대로 남는다.
- [ ] **Step 3:** `yarn orphans` → `orphans: none`. `yarn typecheck`, `yarn lint`(쓰지 않는 import 없음), `yarn test`, `yarn build`, `yarn build:map` 통과. `grep -rn "trip-store\|ui-store\|import-flow\|trip-repo\|sections/share/\|encodeEditLayer\|decodeEditLayer\|use-hash-import" src tests functions pipeline` 출력 없음.
- [ ] **Step 4:** `E2E_PORT=5175 yarn test:e2e` 전체 통과.
- [ ] **Step 5:** 커밋 `refactor: 쓰지 않는 옛 PoC 코드 삭제와 고아 파일 검사`

---

### Task 2: 동작 결함

**Files:**
- Modify: `src/services/route-lookup.ts`, `src/server/http.ts`, `src/services/library-store.ts`
- Test: `tests/unit/services/route-lookup.test.ts`, `tests/unit/server/http.test.ts`, `tests/unit/services/library-store.test.ts`

**Interfaces:**
- Produces: `export function listenPageLeave(flush: () => void): () => void` (떼는 함수). `RouteLookup.layerWith`의 `onLeave?: (flush: () => void) => () => void`. Layer는 떼는 함수를 scope finalizer로 등록한다.

- [ ] **Step 1: 실패하는 테스트**
  - `RouteLookup.layer`(또는 `layerWith({ onLeave: listenPageLeave, … })`)로 Effect를 한 번 돌리고 scope를 닫으면 `window`의 `pagehide`와 `document`의 `visibilitychange`에 대해 `addEventListener` 호출 수와 같은 리스너로 `removeEventListener`가 불린다(spy). `listenPageLeave`가 돌려준 함수를 부르면 두 리스너가 떨어지고, 그 뒤 `pagehide`를 보내도 `flush`가 불리지 않는다.
  - `errorResponse(…)`의 `headers.get('Cache-Control') === 'private, no-store'`(대표 오류 코드 두 개 이상).
  - 쿼터 재시도 경로에서 `getItem` 또는 `removeItem`이 던지는 저장소 → 결과가 `StorageQuotaExceeded`(죽지 않음).
- [ ] **Step 2:** 해당 세 파일 테스트 → FAIL
- [ ] **Step 3:** 구현. `route-lookup.test.ts`의 기존 `listenPageLeave` 직접 호출 테스트는 돌려받은 함수로 정리한다.
- [ ] **Step 4:** PASS + `yarn test`(Layer를 만드는 다른 테스트들 포함) + `yarn typecheck`
- [ ] **Step 5:** 커밋 `fix: 경로 조회 페이지 이탈 리스너 해제, 오류 응답 캐시 금지, 쿼터 재시도 예외 처리`

---

### Task 3: 작은 UX

**Files:**
- Modify: `src/stores/add-place.ts`, `src/sections/add-place/LinkInputPanel.tsx`, `src/sections/add-place/AddPlaceHost.tsx`, `src/sections/add-place/PinCard.tsx`, `src/sections/add-place/CandidateCard.tsx`, `src/sections/shell/use-layout.ts`
- Test: `tests/unit/sections/add-place/*`(해당 파일), `tests/unit/sections/shell/*` 또는 새 `use-layout.test.tsx`

**Interfaces:**
- Produces: `export const linkDraftAtom: PrimitiveAtom<string>` (`src/stores/add-place.ts`). 흐름이 `link` 단계가 아니게 되면 `''`로 비운다(비우는 곳은 `AddPlaceHost`의 흐름 변화 효과 한 곳).

- [ ] **Step 1: 실패하는 테스트**
  - 링크 입력 칸에 글을 쓰고 레이아웃을 `compact` ↔ `medium`으로 바꿔 다시 그리면 글이 남는다. 흐름을 닫았다 `link`로 다시 열면 빈 칸.
  - 핀 카드: 주소 조회가 끝나기 전 `주소 찾는 중…`(`role="status"`)이 보이고, 조회가 끝나면(찾음·못 찾음 모두) 사라진다. 조회 중 사용자가 주소를 쓰면 사라진다.
  - 확인 카드: 이미 있는 장소 + 고른 라벨 없음 + 메모 빈 문자열(또는 공백만) → `라벨 더하기` 꺼짐. 라벨 하나를 고르면 켜짐, 메모를 쓰면 켜짐. 새 장소의 `추가` 버튼 조건은 그대로.
  - `useLayout`: 넓은 화면을 흉내 낸 matchMedia에서 첫 렌더 값이 `wide`(첫 렌더에서 기록한 값을 확인).
- [ ] **Step 2:** 해당 테스트 → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn test` 전체(다른 테스트의 matchMedia 모의와 `noSsr` 호환) + `yarn typecheck` + `yarn lint`
- [ ] **Step 5:** 커밋 `fix(add-place): 폭이 바뀌어도 링크 입력 유지, 주소 찾는 중 표시, 바뀔 것 없는 라벨 더하기 막기, 첫 렌더부터 실제 화면 크기`

---

### Task 4: 중복 정리

**Files:**
- Create: `src/sections/add-place/shared.ts`, `src/sections/add-place/FolderList.tsx`
- Modify: `src/sections/add-place/{FolderPreview,LinkInputPanel}.tsx`, `src/sections/share-import/SharePreview.tsx`, `src/domain/library/add-place.ts`, `src/schema/library.ts`, `src/sections/place/LabelPicker.tsx`, `src/sections/labels/{rejection-message.ts,LabelsPage.tsx}`, `src/sections/settings/{import-decisions.ts,PendingItems.tsx}`
- Test: `tests/unit/schema/library.test.ts`(또는 라벨 이름 도우미 테스트 파일), 기존 테스트 그대로 통과

**Interfaces:**
- Produces:
  ```ts
  // src/sections/add-place/shared.ts — FolderPreview에서 옮김(값 그대로)
  export const FIELD_SX; export function resultMessage(summary: OpSummary): string | null; export const RETRY_CODES;
  // src/domain/library/add-place.ts
  export function uniqueBySid<T extends { sid: string }>(items: readonly T[]): T[];
  // src/schema/library.ts
  export type LabelNameIssue = 'empty' | 'too-long';
  export function labelNameIssue(name: string): LabelNameIssue | null; // trim 후 길이 0 → 'empty', > LIBRARY_LIMITS.labelNameChars → 'too-long'
  export const LABEL_NAME_RANGE_MESSAGE = '1–30자로 입력하세요'; // `1–${LIBRARY_LIMITS.labelNameChars}자로 입력하세요`
  ```
- `import-decisions.ts`의 `NAME_LENGTH_MESSAGE`는 `LABEL_NAME_RANGE_MESSAGE`를 다시 내보내거나 사용처를 바꾼다(문구 같음). 각 화면의 다른 문구는 그대로.

- [ ] **Step 1: 실패하는 테스트** — `labelNameIssue`: `''`→`'empty'`, `'   '`→`'empty'`, 30자→`null`, 31자→`'too-long'`, `' ' + 30자 + ' '`→`null`. `uniqueBySid`: 처음 것만 남기고 순서 유지(제네릭, `FolderPlace`·`FolderItem` 모두).
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 옮기기·바꿔 쓰기만 하고 동작·문구·스타일은 그대로. `FolderPreview.tsx`는 조회·재시도·오류만 남기고 `FolderList`를 `FolderList.tsx`에서 가져온다.
- [ ] **Step 4:** PASS + `yarn test` 전체 변경 없이 통과 + `yarn typecheck` + `yarn lint`. `grep -n "FIELD_SX\|RETRY_CODES\|uniqueBySid" -r src`로 정의가 한 곳씩인지 확인(`CARD_FIELD_SX`·`LegacyImportDialog`의 로컬 스타일은 D3 몫으로 둔다).
- [ ] **Step 5:** 커밋 `refactor(add-place): 공통 스타일·재시도 코드·uniqueBySid·라벨 이름 규칙을 한곳으로, FolderPreview 나누기`

---

### Task 5: 공유 가져오기(C)에서 미룬 것

**Files:**
- Create: `src/sections/share-import/drag-files.ts`
- Modify: `src/domain/codec.ts`, `src/domain/share/read-share.ts`, `src/share-viewer/{main.ts,render.ts}`, `src/domain/library/import-share.ts`, `src/sections/share-import/{use-import-entry.ts,SharePickPanel.tsx,ShareDropOverlay.tsx,SharePreview.tsx}`, `src/sections/shell/AppShell.tsx`, `tests/e2e/share-import.spec.ts`, `tests/e2e/fixtures.ts`
- Test: `tests/unit/share-viewer/parse.test.ts`, `tests/unit/domain/share/read-share.test.ts`, `tests/unit/share-viewer/render.test.ts`(또는 main), `tests/unit/sections/share-import/{share-preview,share-drop}.test.tsx`

**Interfaces:**
- Produces: `export function hasFiles(event: DragEvent): boolean` (`drag-files.ts`, `ShareDropOverlay`에서 옮김).

- [ ] **Step 1: 실패하는 테스트**
  - `readShareHtml`: 같은 id의 `<div id="tripmap-share">`가 앞에 있고 진짜 `<script type="application/json" id="tripmap-share">`가 뒤에 있는 HTML → ok(진짜 문서).
  - 보기 화면: `importLink`가 reject되어도 `Landmark에 담기` 링크가 `${app}/import`로 남고 처리되지 않은 rejection이 없다.
  - `parse`: `kakaoId`·`googleId`가 `null`·`{}`면 `null`.
  - `SharePreview`: 다시 그리기 전 같은 틱에 두 번 누르면(`act` 안에서 `onClick` 두 번) `importShare`가 한 번만 적용(장소 수로 확인). 메모 스위치가 설명 문구를 `aria-describedby`로 가리킨다. 이름 입력을 바꿔도 장소 찾기(`placeFinder`/`planShareImport`의 `existing` 계산)를 다시 하지 않는다(모듈 spy로 호출 수 확인 — 구조상 어려우면 `existing`을 따로 `useMemo`로 두고 그 의존성에 이름이 없음을 리뷰로 확인).
  - `ShareDropOverlay`: 읽는 중에 두 번째 파일을 놓으면 무시(읽기 한 번), `Files` 형식이지만 파일이 없는 drop은 아무 일 없음.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 스펙 §5 표의 나머지(변수 이름 `chunk`, `newTabLink` 모듈 수준, 이름 색인 제자리 추가, `use-import-entry.ts` 주석, `AppShell.tsx` import 정렬)도 같이. E2E: `emptyLibrary`는 `fixtures.ts`의 설정 기본값 도우미를 쓰고(필요하면 `fixtures.ts`에서 export), 주소 비교는 문자열(`toHaveURL(\`${base}/\`)`), `href!` 대신 `expect(href).not.toBeNull()` 뒤 사용, 새로고침 뒤에는 장소 목록이 그려진 것을 먼저 기다리고 미리보기가 없음을 확인.
- [ ] **Step 4:** PASS + `yarn test` + `yarn typecheck` + `yarn lint` + `yarn build:viewer` + `E2E_PORT=5175 yarn test:e2e tests/e2e/share-import.spec.ts`
- [ ] **Step 5:** 커밋 `refactor(share-import): 미뤄 둔 작은 정리와 테스트 보강`

---

### Task 6: README 최신화와 마무리 확인

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** 스펙 §6의 항목을 반영한다. 사실은 코드에서 확인한다(`src/routes/paths.ts`·`router.tsx`, `functions/api/*`, `package.json` scripts, `.github/workflows/*`, `playwright.config.ts`, `docs/superpowers/specs/*`). 없는 기능을 쓰지 않는다. 실물 기기 점검은 "D4에서 한다"로.
- [ ] **Step 2:** `yarn fm:check` 통과, `yarn orphans` → `orphans: none`, `yarn build:ci` 통과, `E2E_PORT=5175 yarn test:e2e` 전체 통과.
- [ ] **Step 3:** 커밋 `docs: README를 지금 앱에 맞춤`
