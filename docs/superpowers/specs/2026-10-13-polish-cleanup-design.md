# 랜드마크 설계 — 다듬기 1: 결함·코드 정리 (하위 프로젝트 D1)

- 작성일: 2026-10-13
- 상태: 초안 (사용자 검토 대기)
- 관련 문서: `2026-10-08-place-library-design.md` §2.1(하위 프로젝트 5 "다듬기"), `2026-10-12-place-adding-design.md`, `2026-10-12-trip-planning-design.md`, `2026-10-13-share-import-design.md`. 충돌하면 이 문서가 우선한다.

## 1. 배경과 목표

### 1.1 다듬기의 네 묶음 (사용자 결정 2026-10-13: 전부, 이 순서로 작은 PR 여러 개)

| 묶음 | 내용 |
|---|---|
| **D1 (이 문서)** | 미뤄 둔 결함·남은 코드 정리, README 최신화 |
| D2 | 성능: 첫 로딩(화면별 코드 나누기) |
| D3 | 디자인 QA·접근성: PC·휴대폰 화면 점검, 화면 읽기 프로그램·키보드, 중간 폭 겹침 |
| D4 | 실물 갤럭시·아이폰 점검(사용자가 직접, 점검표와 수정은 Claude) |

### 1.2 목표

사용자에게 보이는 동작은 아래 §3의 작은 UX 수정 말고는 **바뀌지 않는다**. 문구도 바꾸지 않는다(새 문구는 §3의 `주소 찾는 중…` 하나). D2·D3가 건드릴 코드를 미리 가볍게 만든다.

### 1.3 확인된 사실 (2026-10-13, main `88dd0cc`)

- 앱·보기 화면·공유 지도·서버 함수·파이프라인 어디에서도 닿지 않는 파일 11개가 있다(§2). 네이버 지도 인증 실패는 이미 `지도를 불러오지 못했어요. 도메인 등록을 확인하세요` 안내로 처리돼 있어 이번 범위가 아니다.
- 실제로 쓰는 저장 경로는 모두 예외를 잡는다. 잡지 않는 곳은 지울 옛 코드와, 보관함 저장의 쿼터 재시도 경로 한 곳뿐이다.

## 2. 옛 PoC 코드 삭제

**지우는 파일** (앱 진입점 `src/main.tsx`, `src/share-viewer/main.ts`, `src/share-map/main.ts`, `functions/**`, `pipeline/**`, `build/**`에서 닿지 않음):

`src/stores/ui-store.ts`, `src/stores/trip-store.ts`, `src/sections/share/**`(`view/ExportDialog.tsx`, `view/ImportDialog.tsx`, `store/export-link.ts`, `use-hash-import.ts`), `src/repositories/import-flow.ts`, `src/repositories/trip-repo.ts`, `src/domain/merge.ts`, `src/domain/lww.ts`, `src/domain/revert.ts`.

**함께 지우는 테스트**: `tests/unit/stores/trip-store.test.ts`, `tests/unit/components/import-dialog.test.tsx`, `tests/unit/components/export-dialog.test.tsx`, `tests/unit/repositories/import-flow.test.ts`, `tests/unit/repositories/trip-repo.test.ts`, `tests/unit/domain/merge.test.ts`, `tests/unit/domain/revert.test.ts`, `tests/unit/components/map-lifecycle.test.tsx`, `tests/fixtures/legacy-trip-scope.tsx`. `tests/unit/domain/reconcile.test.ts`가 `revert`를 쓰는 부분만 걷어 낸다.

**고쳐 쓰는 테스트**: `tests/unit/components/map-view.test.tsx`는 지금 쓰는 `MapView`(인증 실패 안내 포함)를 시험하므로 지우지 않는다. `trip-store`·`legacy-trip-scope` 의존을 걷어 내고 그 시험은 그대로 지킨다.

**걷어 내는 내보내기**:
- `src/domain/codec.ts`: `encodeEditLayer`·`decodeEditLayer`와 그 import(`EditLayer`, `LIMITS`). `encodeCompressedJson`·`decodeCompressedJson`·`CodecError`는 남긴다.
- `src/repositories/edit-layer-repo.ts`: `isAbortError`, `withEditLock`, `readEditLayer`, `writeEditLayer`, `updateEditLayer`, `ReadEditLayerResult`. `storageKey`, `migrateEditLayer`, `isStorageAvailable`, `createMemoryStorage`, `PROBE_KEY`는 남긴다(보관함·설정·옛 여행 가져오기가 쓴다).
- `src/schema/common.ts` `LIMITS`: 지운 코드만 쓰던 키(`linkChars`, `decodedBytes`, `exportLinkWarnChars` 등)를 뺀다. 남은 사용처가 있는 키는 둔다.
- 그 밖에 이 삭제로 쓰는 곳이 없어지는 내보내기(타입·상수)도 뺀다. 판단은 `tsc`와 아래 검사로 한다.

**지키는 것**: 옛 여행 가져오기(`/t/<publicId>`, `src/sections/settings/*`, `legacy-import.ts`), `src/schema/legacy/*`, `pipeline/**`과 그것만 쓰는 `src/domain/{overlay,reconcile,day-hash,leg-index,date-groups,day-totals}.ts`.

**결과**: 옛 편집 링크 형식(`#e=…`)을 받는 코드가 사라진다(지금도 화면에 연결돼 있지 않다).

**검사**: 삭제 뒤 위 진입점들에서 닿지 않는 `src/**` 파일이 `src/vite-env.d.ts` 말고 없어야 한다. 이 검사를 스크립트(`scripts/find-orphans.mjs`, import·동적 import 그래프)로 남겨 `yarn orphans`로 돌릴 수 있게 한다(CI에는 넣지 않는다).

## 3. 동작 결함과 작은 UX

| # | 지금 | 바꿈 |
|---|---|---|
| 3.1 | 경로 조회(`src/services/route-lookup.ts`)가 `pagehide`·`visibilitychange` 리스너를 Layer 안에서 걸고 떼지 않는다. Layer를 만들 때마다(테스트) 쌓인다. | `listenPageLeave`가 떼는 함수를 돌려주고, Layer의 scope가 닫힐 때(`Effect.acquireRelease`/`addFinalizer`) 뗀다. |
| 3.2 | 서버 오류 응답(`src/server/http.ts` `errorResponse`)에 캐시 헤더가 없다. 성공 응답만 `private, no-store`다. | 오류 응답에도 `Cache-Control: private, no-store`. |
| 3.3 | 보관함 저장(`src/services/library-store.ts`)이 쿼터 오류 뒤 경로 캐시를 지우고 다시 쓸 때 `getItem`·`removeItem`이 예외 처리 밖이다. | 그 두 호출도 예외를 잡는다. 실패하면 처음 쿼터 오류(`StorageQuotaExceeded`)를 그대로 낸다. |
| 3.4 | 링크 입력 중 창 폭이 768px 경계를 넘으면 추가 칸이 다시 그려지며 입력한 글이 사라진다. | 링크 입력 글을 흐름 밖 상태(`linkDraftAtom`)에 둔다. 추가 흐름이 `link` 단계를 떠나면 비운다. 다른 단계(확인 카드 등)는 이번 범위가 아니다. |
| 3.5 | 핀 카드가 주소를 찾는 동안 아무 표시가 없다. | 찾는 동안이고 주소가 비어 있으면 주소 칸 아래에 `주소 찾는 중…`(`role="status"`). |
| 3.6 | 이미 있는 장소의 확인 카드에서 라벨도 메모도 없이 `라벨 더하기`를 누르면 바뀐 것이 없는데 `추가했어요`가 뜬다. | 저장해도 **아무것도 바뀌지 않을 때만** `라벨 더하기`를 끈다: 이미 있는 장소 + 고른 라벨 없음 + 메모가 비었거나 공백 + 여행 대상 없음(여행 대상이 있으면 그 여행의 후보에 넣는 일이 있다) + 그 장소가 이미 보관함에 보임(`saved: true` — `false`면 저장이 보관함에 보이게 바꾼다). |
| 3.7 | 화면 크기 판정(`useLayout`)에 첫 렌더 보호 장치가 없었다. 구현 중 확인해 보니 MUI 7.3.11과 `createRoot`에서는 클라이언트 첫 렌더가 이미 실제 크기로 맞았고, 서버 스냅샷 경로(`getServerSnapshot`)만 달랐다(앱은 서버 렌더링을 쓰지 않아 실제 증상은 확인되지 않음). | `useMediaQuery(…, { noSsr: true })`를 둔다. 첫 렌더부터 실제 크기로 판정하는 것을 보장하는 무해한 보호 장치다. |

## 4. 중복 정리 (동작·모양 그대로)

- **입력칸 스타일·결과 문장**: `FolderPreview.tsx`가 내보내던 `FIELD_SX`·`resultMessage`를 `src/sections/add-place/shared.ts`로 옮기고 `FolderPreview`·`SharePreview`가 거기서 가져온다. 스타일 값은 바꾸지 않는다(다른 세 벌의 입력칸 스타일을 하나로 맞추는 것은 모양이 바뀌므로 D3에서 한다).
- **다시 시도할 오류 코드**: `LinkInputPanel.tsx`·`FolderPreview.tsx`의 같은 `RETRY_CODES`를 `shared.ts` 하나로.
- **`uniqueBySid`**: `src/domain/library/add-place.ts`의 것을 `uniqueBySid<T extends { sid: string }>(items: readonly T[]): T[]`로 export하고 `FolderPreview`의 사본을 지운다.
- **라벨 이름 규칙**: `src/schema/library.ts`에 `labelNameIssue(name: string): 'empty' | 'too-long' | null`(앞뒤 공백을 지운 길이로 판단)과 `LABEL_NAME_RANGE_MESSAGE = '1–30자로 입력하세요'`를 둔다. 같은 문구를 각자 만들던 `LabelPicker`·`rejection-message`·`import-decisions`는 상수를 쓰고, 길이 검사를 각자 하던 곳(`FolderPreview`, `SharePreview`, `import-decisions`, `LabelsPage`, `PendingItems`)은 도우미를 쓴다. 화면마다 다른 문구(`라벨 이름은 30자까지예요`, `이름이 30자를 넘어요`, `이름은 1–30자`, `최대 30자`)는 그대로 둔다.
- **`FolderPreview` 나누기**(384줄): 조회·재시도 부분은 `FolderPreview.tsx`에, 가져오기 양식(`FolderList`)은 `FolderList.tsx`로.

## 5. 공유 가져오기(C)에서 미룬 것

| 항목 | 바꿈 |
|---|---|
| `encodeCompressedJson`의 루프 변수 `value`가 매개변수를 가림 | `chunk`로 |
| `readShareHtml`이 같은 id의 다른 요소를 고를 수 있음 | `script[type="application/json"]#tripmap-share`만 본다 |
| 보기 화면 `importLink(...).then(...)`에 `catch`가 없음 | 실패하면 기본 링크(`/import`)를 그대로 둔다 |
| 보기 화면 `newTabLink`가 `renderViewer` 안의 함수 | 모듈 수준으로 |
| `placeFinder`의 이름 색인이 넣을 때마다 배열을 복사 | 제자리에 넣는다 |
| `use-import-entry.ts` 늦은 결과 판정에 이유 주석이 없음 | `use-share-file.ts`와 같은 주석 |
| `AppShell.tsx` import 순서 | 정렬 |
| `hasFiles`를 `SharePickPanel`이 `ShareDropOverlay`에서 가져옴 | `src/sections/share-import/drag-files.ts`로 |
| 미리보기가 이름 입력마다 같은 장소 찾기를 다시 함 | `이미 있음`(보관함·문서에만 달림)은 따로 계산해 이름이 바뀌어도 다시 하지 않는다 |
| 메모 스위치 설명이 스위치와 묶이지 않음 | `aria-describedby` |
| 테스트: 두 번 누르기 테스트가 꺼진 버튼을 눌러 `savingRef`를 시험하지 못함 | 다시 그리기 전에 두 번 누르는 테스트 |
| 테스트: 끌어 놓기의 읽는 중·파일 없음 가드 | 시험 추가 |
| 테스트: `parse`의 문자열 아닌 id를 `123`으로만 시험 | `null`·객체도 |
| E2E: `emptyLibrary`가 설정 JSON을 따로 가짐, `baseURL`을 정규식에 그대로 넣음, `href!`, 새로고침 확인이 약함 | `fixtures.ts`의 도우미를 쓰고, 문자열로 주소를 비교하고, 목록이 그려진 뒤 미리보기가 없음을 확인 |

**그대로 두는 것**: 정확히 30번째에 짝 없는 서로게이트가 있을 때 하나 빠지는 것(이미 잘못된 글자일 때만), 끌기 도중 덮개 조건이 켜지면 다음 진입부터 덮개가 뜨는 것(드묾).

## 6. README 최신화

- 소개: 여행 계획·공유 내보내기·받은 파일 가져오기를 반영한다.
- 문서 목록: 하위 프로젝트 2·3·4(HTML 공유 내보내기)·C(가져오기)·D1 스펙.
- 서버 함수: `/api/place`, `/api/naver-folder`, `/api/route`.
- 화면 표: `/trips`(여행 목록), `/trips/:id`(계획), `/import`(공유 파일 가져오기) 추가, 자리 표시 문구 삭제.
- 빌드: 앱·보기 화면(`build:viewer`)·공유 지도(`build:map`, GitHub Pages 배포 워크플로).
- E2E 목록에 `place-adding`·`share-export`·`share-import`·`trip-planning`. 포트 안내(`E2E_PORT`, 지도 미리보기 5174).
- 옛 파이프라인 절: "대체 예정" → 새 화면에는 연결되지 않은 남은 옛 도구, 옛 편집 내보내기 절차(옛 `src/sections/share/**`)는 삭제.
- 데이터 안내: 공유·내보내기가 있다는 것, 기기 간 동기화는 없다는 것. 실물 기기 점검은 D4에서 한다.

## 7. 테스트

- 삭제: `yarn orphans`가 `src/vite-env.d.ts`만 보고하고, `yarn build:ci`·E2E 전체가 통과한다. `map-view.test.tsx`의 인증 실패 시험이 남아 있다.
- 3.1: Layer를 만들고 닫으면 `pagehide`·`visibilitychange` 리스너 수가 원래대로(`addEventListener`/`removeEventListener` 감시).
- 3.2: 오류 응답의 `Cache-Control`이 `private, no-store`.
- 3.3: 쿼터 재시도 중 `getItem`·`removeItem`이 던져도 결과가 `StorageQuotaExceeded`.
- 3.4: 링크를 입력하고 화면 폭을 바꿔도 입력이 남는다. 흐름을 닫았다 다시 열면 비어 있다.
- 3.5: 주소를 찾는 동안 `주소 찾는 중…`, 찾으면 사라진다. 사용자가 주소를 쓰면 사라진다.
- 3.6: 이미 있는 보이는 장소 + 라벨·메모 없음 + 여행 대상 없음 → `라벨 더하기` 꺼짐. 라벨을 고르거나 메모를 쓰면 켜짐. 여행 대상이 있으면 켜짐. 그 장소가 `saved: false`면 켜짐.
- 3.7: 넓은 화면의 첫 렌더부터 `wide`.
- §4: 기존 테스트가 그대로 통과(동작 그대로). `labelNameIssue` 단위 테스트(빈 값·공백만·30자·31자).
- §5: 표의 테스트 항목.
