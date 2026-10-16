# 네이버 폴더 다시 가져오기 (묶음 F3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 번 가져온 네이버 공유 폴더를 보관함 문서에 기억해 두고, 라벨 관리나 같은 링크로 다시 읽어 그사이 새로 저장한 곳만 같은 라벨로 더한다.

**Architecture:** 보관함 문서에 선택 컬렉션 `folders`(키 = 공유 ID)를 더하고, 순수 연산 파일 `src/domain/library/folder-links.ts`가 연결 기록·끊기·다시 가져오기 계획(`planFolderSync`)·적용(`syncFolder` = 기존 `importFolder` + 연결 기록)을 맡는다. 화면은 추가 칸의 기존 `folder` 단계를 그대로 쓰고, `FolderPreview`가 연결 여부를 보고 새 `FolderResync` 또는 기존 `FolderList`를 그린다. 다시 가져오기는 서버의 10분 캐시를 `fresh=1`로 건너뛴다.

**Tech Stack:** TypeScript 6, React 19, MUI 7, Jotai, Effect 4.0.2(Schema), Vite 8, Vitest 5(jsdom), Playwright, Cloudflare Pages Functions.

**Spec:** `docs/superpowers/specs/2026-10-16-folder-resync-design.md`

## Global Constraints

- 출발점: F1·F2가 병합된 `main`. 브랜치 `feat/folder-resync`. 구현 PR은 **병합 커밋(Create a merge commit)** 으로 넣고, 병합 뒤 태그 `v0.10.0`.
- 셸은 Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`. 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 저장 형식: `schemaVersion` 2, 키 `tripmap:library:v2` 그대로. 새 최상위 키 `folders`는 `Schema.optionalKey`. `emptyLibrary()`는 바꾸지 않는다. 읽는 쪽은 `lib.folders ?? {}`.
- 한도: `LIBRARY_LIMITS.folderNameChars = 100`, `LIBRARY_LIMITS.folderSids = 1000`. 공유 ID 패턴 `/^[0-9a-zA-Z]+$/`(서버 `SHARE_ID`와 같음), `sid` 패턴 `/^\d+$/`.
- `src/domain/library/ops.ts`는 첫 화면 번들이다. `folder-links.ts`를 import하지 않는다. 새 `lazyChunk`·`--require-lazy` 추가 없음. 첫 로딩 예산 `initialJsGzipMax` 327680.
- 서버 코드(`functions/api/*.ts`, `src/server/*`)는 상대 경로 import·웹 표준 API만. 바깥 호스트는 늘리지 않는다.
- 터치 대상 44px, 포커스 표시는 테마, 입력칸은 `fieldSx()`, 새 색 토큰 없음.
- E2E는 `E2E_PORT=5175`. 5173은 다른 프로젝트의 개발 서버이므로 끄지 않는다. 5174는 Playwright의 지도 미리보기 서버.
- 고정 문구(스펙 §4):
  - 라벨 줄: `장소 <N>곳 · 네이버 폴더`.
  - 라벨 고치기: 구역 제목 `네이버 폴더`, `이름 없는 폴더`, `<YYYY.MM.DD> 확인`, 단추 `새로 저장한 곳 가져오기`(접근 이름 `‘<폴더 이름>’에서 새로 저장한 곳 가져오기`), `연결 끊기`(접근 이름 `‘<폴더 이름>’ 연결 끊기`). 끊은 뒤 토스트 `폴더 연결을 끊었어요. 라벨과 장소는 그대로예요`.
  - 라벨 지우기 확인: 연결이 있으면 지금 문장 뒤에 ` 연결된 네이버 폴더도 끊겨요.`
  - 다시 가져오기: 제목 = 폴더 이름(비면 `이름 없는 폴더`), `‘<라벨 이름>’ 라벨 · 지난 확인 <YYYY.MM.DD>`, `새로 저장한 곳 <N> · 그대로 <M> · 폴더에서 빠진 곳 <K>`, 구역 `새로 저장한 곳`·`보관함에서 지운 곳`·`폴더에서 빠진 곳`, 안내 `전에 가져왔다가 보관함에서 지운 곳이에요. 다시 넣으려면 고르세요` / `네이버 폴더에서는 빠졌지만 보관함에서는 지우지 않았어요`, 빈 상태 `<YYYY.MM.DD> 뒤로 새로 저장한 곳이 없어요`, 표시 `이미 있음`·`지웠던 곳`, 단추 `전체 선택`/`전체 해제`, `폴더 전체 보기`, `취소`, `<N>곳 가져오기`/`확인했어요`.
  - 결과: `resultMessage` 문장 + 토스트 단추 `보관함에서 보기`. 0곳이면 `‘<폴더 이름>’ 폴더를 확인했어요`.
  - 읽는 중·오류(연결된 폴더): 제목 `네이버 폴더 다시 가져오기`, `새로 저장한 곳을 찾는 중…`, `폴더를 찾지 못했어요. 네이버 지도에서 폴더 공유를 껐거나 폴더를 지웠을 수 있어요`(단추 `연결 끊기`), 누른 순간 연결 없음 `폴더 연결이 바뀌었어요. 창을 닫고 다시 열어 주세요`.
- 날짜는 로컬 날짜 `YYYY.MM.DD`(`src/lib/local-date.ts`의 `localDate`).

## Review Focus

1. **여행 계획 화면에서 연 추가 흐름에 연결된 폴더 링크를 넣음** → 다시 가져오기 화면이 아니라 지금의 전체 미리보기가 열리고, 가져오면 그 여행의 후보에 들어간다. Task 6 시험.
2. **라벨 고치기 대화상자를 닫으며 추가 칸을 엶(특히 좁은 화면 시트)** → 포커스가 대화상자의 복귀 동작에 빼앗기지 않고 칸 안 첫 조작 요소에 있고, 칸을 닫으면 그 라벨 줄로 돌아온다. Task 7 시험.
3. **미리보기를 연 뒤 다른 탭에서 연결을 끊거나 라벨을 지움** → 가져오기를 누르면 `폴더 연결이 바뀌었어요…` 알림, 장소가 늘지 않고 저장도 없음, 단추는 다시 켜짐. Task 3(연산)·Task 6(화면) 시험.
4. **폴더 응답에 같은 `sid`가 두 번, 폴더 이름이 101자 이상, 빈 이름** → 연결 기록이 문서 검사를 통과한다(`LibraryInvalid` 없음), 이름은 100자로 잘리고 화면은 `이름 없는 폴더`. Task 2·Task 3 시험.
5. **다시 가져오기 직후 같은 공유 ID를 보통(첫 가져오기) 경로로 조회** → `fresh=1` 결과가 같은 캐시 키에 저장돼 옛 결과를 받지 않는다. Task 4 시험.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/schema/library.ts` | `NaverSid`·`ShareId`·`FolderLinkSchema`·`folders`, 문서 검사, 한도 |
| `src/schema/library-base.ts` | `LIBRARY_LIMITS`에 두 한도 |
| `src/domain/library/folder-links.ts` (새) | 연결 조회·기록·끊기, 다시 가져오기 계획·적용 |
| `src/domain/library/ops.ts` | 라벨 지우기·합치기가 연결을 고침 |
| `functions/api/naver-folder.ts`, `src/services/place-lookup.ts` | `fresh=1` |
| `src/lib/local-date.ts` (새), `src/sections/share-import/SharePreview.tsx` | 날짜 도우미 옮기기 |
| `src/sections/add-place/FolderPlaceRows.tsx`, `FolderList.tsx` | 표시 글자 일반화, 첫 가져오기가 연결 기록 |
| `src/sections/add-place/FolderResync.tsx` (새), `FolderPreview.tsx` | 다시 가져오기 화면·분기·오류 |
| `src/stores/add-place.ts` | `openFolderSyncAtom` |
| `src/sections/labels/LabelsPage.tsx`, `LabelEditor.tsx`, `DeleteLabelDialog.tsx` | 진입점 |
| `tests/e2e/folder-resync.spec.ts` (새), `tests/fixtures/links/api/naver-folder-more.json` (새) | E2E |
| `docs/rollback.md` | `v0.10.0` 줄 |

되돌리기: Task 6·7(화면)은 함께 되돌리면 연결 기록(Task 1~5)만 남아 앱은 지금처럼 동작한다. Task 1을 되돌리려면 PR 전체를 되돌린다(뒤 Task가 모두 기댄다).

---

### Task 1: 저장 형식에 폴더 연결

**Files:**
- Modify: `src/schema/library-base.ts`, `src/schema/library.ts`
- Test: `tests/unit/schema/library.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // library-base.ts: LIBRARY_LIMITS += { folderNameChars: 100, folderSids: 1000 }
  // library.ts
  export const NaverSid: Schema.String…;   // /^\d+$/, 'sid는 숫자입니다' — PlaceSource의 naver sid도 이것을 쓴다
  export const ShareId: Schema.String…;    // /^[0-9a-zA-Z]+$/, '공유 ID는 영문·숫자입니다'
  export const FolderLinkSchema: Schema.Struct<{ shareId; name: Field<string ≤100>; labelId: Field<LabelId>;
    seenSids: Field<readonly NaverSid[] ≤1000>; checkedAt: IsoDateTime; createdAt: IsoDateTime; deletedAt: IsoDateTime | null }>;
  export type FolderLink = typeof FolderLinkSchema.Type;
  // LibrarySchema 필드 += folders: Schema.optionalKey(Schema.Record(Schema.String, FolderLinkSchema))
  ```
- 문서 검사(기존 `.check` 필터 안): `folders`의 각 `[key, link]`에 `key !== link.shareId` → `{ path: ['folders', key], issue: '키와 id가 다릅니다: <key>' }`; `link.deletedAt === null`이고 라벨이 없거나 지워졌으면 `{ path: ['folders', key], issue: '없는 라벨입니다: <labelId>' }`.

- [ ] **Step 1: 실패하는 시험** (`describe('LibrarySchema folders')`)
  - `folders` 키가 없는 문서 통과(지금 fixture 그대로), `folders: {}` 통과, 연결 하나(살아 있는 라벨) 통과.
  - 키 ≠ `shareId` → 실패, issue path `folders.<키>`.
  - 살아 있는 연결의 `labelId`가 없는 라벨·지운 라벨 → 실패. 지운 연결(`deletedAt` 있음)은 지운 라벨을 가리켜도 통과.
  - 이름 101자, `seenSids` 1,001개, `seenSids`에 `'12a'`, 공유 ID `'ab-c'` → 각각 실패.
  - **옛 버전 호환**: 테스트 안에서 옛 모양 `Schema.Struct({ schemaVersion: Schema.Literal(2), places: Schema.Record(Schema.String, PlaceSchema), labels: Schema.Record(Schema.String, LabelSchema), trips: Schema.Record(Schema.String, TripSchema) })`를 만들고, 연결이 있는 문서를 `safeParse`하면 `success: true`이고 `'folders' in data === false`. (주석: 옛 버전의 `LibraryStore`가 이 기본 동작으로 읽고 다시 쓴다 — 스펙 §5.3.)
- [ ] **Step 2:** `yarn vitest run tests/unit/schema/library.test.ts` → FAIL(`FolderLinkSchema`·`folders` 없음)
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `yarn vitest run tests/unit/schema` → PASS, `yarn typecheck` → 오류 없음
- [ ] **Step 5:** 커밋 `feat(library): 보관함 문서에 네이버 폴더 연결(folders) 선택 컬렉션`

---

### Task 2: 연결 기록·끊기와 라벨 연산

**Files:**
- Create: `src/domain/library/folder-links.ts`
- Modify: `src/domain/library/ops.ts`
- Test: `tests/unit/domain/library/folder-links.test.ts`(새), `tests/unit/domain/library/ops.test.ts`

**Interfaces:**
- Consumes: Task 1의 `FolderLink`, `LIBRARY_LIMITS`.
- Produces:
  ```ts
  export function folderLinks(lib: Library): Readonly<Record<string, FolderLink>>; // lib.folders ?? {}
  export function liveFolderLink(lib: Library, shareId: string): FolderLink | undefined; // deletedAt null + 라벨 살아 있음
  export function folderLinksOfLabel(lib: Library, labelId: string): FolderLink[]; // 살아 있는 것, name.value의 localeCompare('ko') 순
  export type FolderLinkInput = { shareId: string; folderName: string; labelId: string; seenSids: readonly string[] };
  export function recordFolderLink(lib: Library, input: FolderLinkInput, ctx: OpCtx): Library;
  export function unlinkFolder(lib: Library, shareId: string, ctx: OpCtx): Library; // 살아 있지 않으면 lib 그대로
  ```
- `recordFolderLink`: 이름 `folderName.trim().slice(0, 100)`, `seenSids`는 순서 유지·중복 제거·`/^\d+$/`만·앞 1,000개. 기존 연결(지운 것 포함)이 있으면 `setField`로 `name`·`labelId`·`seenSids`를 바꾸고 `checkedAt = ctx.now`, `deletedAt = null`, `createdAt`은 그대로. 없으면 모든 필드 `updatedAt = ctx.now`, `createdAt = checkedAt = ctx.now`.
- `ops.ts`: 내부 도우미 `relinkFolders(lib, from: string, into: string | null, ctx)` — 살아 있는 연결 중 `labelId.value === from`인 것을 `into`가 있으면 `labelId`를 `setField`로 바꾸고, 없으면 `deletedAt = ctx.now`. `deleteLabel`은 `into = null`, `mergeLabels`는 `into = intoId`로 부른다. `folders`가 없는 문서는 그대로 둔다(키를 새로 만들지 않는다).

- [ ] **Step 1: 실패하는 시험**
  - `recordFolderLink`: 새 연결 → 필드·시각이 `ctx.now`; 같은 공유 ID 다시 → `createdAt` 유지, 라벨·이름·`seenSids` 교체, 같은 값 필드는 `updatedAt` 그대로; 지운 연결 → `deletedAt: null`로 되살림; 이름 `'  ' + '가'.repeat(120)` → 100자; `seenSids` `['1','1','x','2']` → `['1','2']`; 1,200개 → 1,000개; 결과가 `LibrarySchema` 통과(Review Focus 4).
  - `unlinkFolder`: 살아 있는 연결 → `deletedAt = ctx.now`; 없는 ID·이미 지운 연결 → 같은 참조.
  - `liveFolderLink`: 지운 연결·라벨이 지워진 연결 → `undefined`. `folderLinksOfLabel`: 이름순, 지운 연결 제외. `folders` 없는 문서 → `[]`·`undefined`.
  - `ops.test.ts`: `deleteLabel` → 그 라벨의 연결 `deletedAt = NOW`, 다른 라벨 연결 그대로; `mergeLabels(from, into)` → 연결의 `labelId.value === into`; 둘 다 결과가 `LibrarySchema` 통과; `folders` 없는 문서 → 결과에 `folders` 키 없음.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/library/folder-links.test.ts tests/unit/domain/library/ops.test.ts` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `yarn vitest run tests/unit/domain` → PASS, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library): 폴더 연결 기록·끊기, 라벨을 지우거나 합치면 연결도 따라가기`

---

### Task 3: 다시 가져오기 계획과 적용

**Files:**
- Modify: `src/domain/library/folder-links.ts`
- Test: `tests/unit/domain/library/folder-links.test.ts`

**Interfaces:**
- Consumes: `importFolder`, `indexBySource`, `uniqueBySid`, `FolderItem`(`src/domain/library/add-place.ts`), Task 2의 함수.
- Produces:
  ```ts
  export type FolderSyncPlan = {
    fresh: { item: FolderItem; mark: 'in-library' | 'deleted' | null }[];
    deleted: FolderItem[];
    unchanged: number;
    missing: { sid: string; placeId: string; name: string; address: string }[];
  };
  export function planFolderSync(lib: Library, link: FolderLink, items: readonly FolderItem[]): FolderSyncPlan;
  export function syncFolder(
    lib: Library,
    input: { shareId: string; folderName: string; items: readonly FolderItem[]; pickedSids: readonly string[] },
    ctx: OpCtx,
  ): OpResult;
  ```
- 분류(스펙 §3.2): `uniqueBySid(items)`마다 `seen = link.seenSids.value`, `existing = indexBySource(lib).get('naver:<sid>')`. `sid ∉ seen` → `fresh`(`mark`: 없음 `null`, 살아 있음 `'in-library'`, 지운 것만 `'deleted'`). `sid ∈ seen`이고 `existing`이 지운 장소 → `deleted`. 그 밖 → `unchanged += 1`. `missing` = `seen` 중 지금 폴더에 없고 `existing`이 살아 있는 것(이름은 `existing.name.value`), `seen` 순서.
- `syncFolder`: `liveFolderLink(lib, shareId)`가 없으면 `{ ok: false, error: { _tag: 'NotFound', id: shareId } }`. 있으면 `importFolder(lib, 고른 항목(uniqueBySid 후 pickedSids에 있는 것), { labelId: link.labelId.value }, ctx)` → 성공이면 `recordFolderLink(결과.lib, { shareId, folderName, labelId, seenSids: items의 모든 sid }, ctx)`를 `lib`로 하고 `createdId`·`summary`는 `importFolder`의 것.

- [ ] **Step 1: 실패하는 시험**
  - `planFolderSync`: 본 장소 `['1','2','3','4']`, 폴더 `['1','2','5','6','7','5']`, 보관함에 `1` 살아 있음·`2` 지움·`6` 살아 있음(다른 라벨)·`7` 지움·`3` 살아 있음·`4` 없음 → `fresh` = `5`(null)·`6`('in-library')·`7`('deleted'), `deleted` = `2`, `unchanged` = 1(`1`), `missing` = `3`만(`4`는 보관함에 없어 빠짐).
  - `syncFolder`: 고른 `['5','2']` → `summary` `{ created: 1, merged: 0, restored: 1 }`, `5`가 연결 라벨로 생김(네이버 메모 들어감), `2` 되살아나 라벨 붙음, `1`의 라벨은 그대로(뗐던 라벨이면 계속 없음), 연결의 `seenSids.value` = `['1','2','5','6','7']`, `checkedAt = NOW`, `createdId` = 라벨 id.
  - 고른 것 없음 → `summary` 모두 0, 장소 그대로, `seenSids`·`checkedAt`만 바뀜.
  - 연결 없음·지운 연결·라벨이 지워진 연결 → `NotFound`, 장소가 늘지 않음(Review Focus 3).
  - 같은 `sid`가 두 번인 폴더·이름 101자 → 결과가 `LibrarySchema` 통과(Review Focus 4).
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/library/folder-links.test.ts` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library): 새로 저장한 곳만 고르는 폴더 다시 가져오기 연산`

---

### Task 4: 다시 가져오기는 서버 캐시를 건너뛴다

**Files:**
- Modify: `functions/api/naver-folder.ts`, `src/services/place-lookup.ts`
- Test: `tests/unit/server/functions.test.ts`, `tests/unit/services/place-lookup.test.ts`(있는 파일에 더함; 없으면 그 이름으로 만듦)

**Interfaces:**
- Produces: `PlaceLookup` 서비스의 `lookupFolder(shareId: string, options?: { fresh?: boolean }): Effect<FolderResult, PlaceLookupError>`. `fresh`면 요청 주소 `/api/naver-folder?share=<인코딩>&fresh=1`, 아니면 지금 주소 그대로.
- `naver-folder.ts`: `bypassCache: (url) => url.searchParams.get('fresh') === '1'`, 머리 주석에 `[&fresh=1]`와 뜻(경로와 같은 방식) 한 줄.

- [ ] **Step 1: 실패하는 시험**
  - `functions.test.ts`: 새 `it('폴더도 fresh=1이면 캐시를 보지 않고 다시 받아, 같은 키에 저장한다')` — 캐시에 옛 응답을 넣고 `fresh=1` 요청 → 네이버 호출 1번, `cache.put` 키 `https://cache.landmark/folder/<SHARE_ID>`; 이어서 보통 요청 → 새 결과를 캐시에서 받음(네이버 호출 늘지 않음, Review Focus 5).
  - 기존 `it('장소·폴더는 fresh=1을 몰라 그대로 캐시를 본다')`를 `it('장소는 fresh=1을 몰라 그대로 캐시를 본다')`로 바꾸고 폴더 줄과 기대 횟수(1)를 고친다.
  - 조회 서비스: 가짜 `fetch`가 받은 주소가 `fresh: true` → `…&fresh=1`, 옵션 없음 → `fresh` 없음.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/functions.test.ts tests/unit/services` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(server): 폴더 조회도 fresh=1이면 엣지 캐시 건너뛰기`

---

### Task 5: 첫 가져오기가 연결을 남긴다

**Files:**
- Create: `src/lib/local-date.ts`
- Modify: `src/sections/share-import/SharePreview.tsx`(같은 함수를 지우고 import), `src/sections/add-place/FolderPlaceRows.tsx`, `src/sections/add-place/FolderList.tsx`, `src/sections/add-place/FolderPreview.tsx`(`FolderList`에 `shareId` 넘기기만)
- Test: `tests/unit/lib/local-date.test.ts`(새), `tests/unit/sections/add-place/folder-preview.test.tsx`

**Interfaces:**
- Consumes: Task 2의 `recordFolderLink`.
- Produces:
  ```ts
  export function localDate(iso: string): string; // 로컬 'YYYY.MM.DD'
  // FolderPlaceRows props: { places; selected; marks: ReadonlyMap<string, string>; onToggle(sid): void; label: string }
  //   marks에 있는 sid 행 오른쪽에 RowMark(값). label은 목록 aria-label. existingSids prop은 없앤다.
  // FolderList props: { shareId: string; folderName: string; places: FolderPlace[] }
  ```
- `FolderList.submit`의 연산: `importFolder` 성공이면 `recordFolderLink(imported.lib, { shareId, folderName, labelId: imported.createdId!, seenSids: places.map((p) => p.sid) }, ctx)`로 바꾼 결과를 이어서 쓴다(여행 대상이면 그 결과로 `thenAddCandidates`). 토스트·필터·여행 이동은 그대로. `FolderList`는 `label="가져올 장소"`, 표시 `이미 있음`을 `marks`로 넘긴다.

- [ ] **Step 1: 실패하는 시험**
  - `localDate`: 로컬 시간대 기준 날짜(`TZ`에 기대지 않게 `new Date(2026, 9, 3, 23, 30).toISOString()` → `'2026.10.03'`).
  - `folder-preview.test.tsx`: 3곳 중 2곳만 골라 가져오면 저장된 문서의 `folders['abc123']`가 `name.value === '속초 맛집'`, `labelId.value` = 새 라벨, `seenSids.value` = 세 sid 모두, `deletedAt: null`. 여행 대상 흐름에서도 연결이 남음. 기존 시험(`이미 있음` 표시, 토스트, 필터) 그대로 통과.
- [ ] **Step 2:** `yarn vitest run tests/unit/lib/local-date.test.ts tests/unit/sections/add-place/folder-preview.test.tsx tests/unit/sections/share-import` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(add-place): 폴더를 가져오면 다시 가져올 수 있게 연결 남기기`

---

### Task 6: 다시 가져오기 화면

**Files:**
- Create: `src/sections/add-place/FolderResync.tsx`
- Modify: `src/sections/add-place/FolderPreview.tsx`
- Test: `tests/unit/sections/add-place/folder-resync.test.tsx`(새, `folder-preview.test.tsx`의 `fakeFolderLookup`·`renderLibrary` 방식을 따름)

**Interfaces:**
- Consumes: Task 2·3의 `liveFolderLink`·`planFolderSync`·`syncFolder`·`unlinkFolder`, Task 4의 `lookupFolder(shareId, { fresh })`, Task 5의 `FolderPlaceRows`·`localDate`·`FolderList`, `resultMessage`(`shared.ts`), `addTargetAtom`, `useLibraryQuery`, `paths.library`.
- Produces:
  ```ts
  export function FolderResync(props: {
    shareId: string; folderName: string; places: FolderPlace[]; link: FolderLink; onShowAll(): void;
  }): JSX.Element;
  ```
- `FolderPreview`: 마운트 때 `linked = useAtomValue(addTargetAtom) === null && liveFolderLink(library, shareId) !== undefined`를 한 번 정해(ref) `lookupFolder(shareId, { fresh: linked })`. 준비되면 그 순간의 `liveFolderLink`가 있고 여행 대상이 없고 `showAll`이 거짓이면 `FolderResync`, 아니면 `FolderList`(Review Focus 1). 연결된 폴더의 읽는 중·오류 문구와 `NOT_FOUND`의 `연결 끊기`(→ `unlinkFolder` 저장 → 토스트 → 흐름 닫기)는 Global Constraints대로.
- `FolderResync`: 시작 선택 = `fresh`의 sid 전부. 주 단추는 고른 수(`fresh`+`deleted` 중 고른 것)로 `<N>곳 가져오기`/`확인했어요`. 누르면 `run((lib, ctx) => syncFolder(lib, { shareId, folderName, items: places, pickedSids }, ctx))` 한 번(`savingRef`·`aliveRef`는 `FolderList`와 같은 방식). 성공: 1곳 이상이면 `toast(resultMessage(summary), { action: { label: '보관함에서 보기', onClick } })` — `onClick`은 `patchQuery({ labelIds: [labelId], unlabeled: false, text: '', regions: [], visited: 'all' })`(`visited`는 F2의 방문 필터 — 새 곳이 `가 본 곳` 필터에 가려지지 않게) 뒤 `navigate(paths.library)`; 0곳이면 `‘<폴더 이름>’ 폴더를 확인했어요`. 그 뒤 흐름 닫기. `NotFound` 거절: 칸 안 `role="alert"` 문구, 단추 다시 켬(Review Focus 3).

- [ ] **Step 1: 실패하는 시험**
  - 연결된 `abc123`(본 장소 `9001`·`9002`), 폴더 `9001`·`9002`·`9003` → 제목 `속초 맛집`, `새로 저장한 곳 1 · 그대로 2 · 폴더에서 빠진 곳 0`, 목록 `새로 저장한 곳`에 `폴더 장소 3`만 체크, 단추 `1곳 가져오기`. 누르면 토스트 `1곳을 새로 넣었어요`와 `보관함에서 보기` 단추, 흐름 `closed`, 문서의 `seenSids` 세 개. 선호 `query.visited: 'visited'`로 시작해 `보관함에서 보기`를 누르면 조건이 `visited: 'all'`. 조회 호출이 `fresh: true`.
  - 보관함의 `9002`를 지운 상태 → `보관함에서 지운 곳` 구역, 체크 없음. 그것만 고르면 `1곳 가져오기` → 되살아남.
  - 본 장소에 있던 `9004`가 폴더에 없고 보관함에 살아 있음 → `폴더에서 빠진 곳` 구역에 그 이름, 체크박스 없음.
  - 새 곳 0 → `<날짜> 뒤로 새로 저장한 곳이 없어요`, 단추 `확인했어요` → 토스트 `‘속초 맛집’ 폴더를 확인했어요`, `checkedAt` 갱신.
  - 단추 두 번 빠르게 → `syncFolder` 적용 한 번(장소 수 1 증가).
  - `폴더 전체 보기` → `속초 맛집 · 3곳` 제목의 지금 미리보기, 조회 호출 늘지 않음.
  - 여행 대상이 있는 흐름(`addTargetAtom`에 여행) → 바로 지금 미리보기(Review Focus 1), 조회 호출 `fresh` 없음.
  - 조회 `NOT_FOUND` → `폴더를 찾지 못했어요. …` + `연결 끊기` → 연결 `deletedAt` 있음, 토스트 `폴더 연결을 끊었어요. 라벨과 장소는 그대로예요`, 흐름 닫힘. 연결 없는 폴더의 `NOT_FOUND`는 지금 문구 그대로.
  - 미리보기를 연 뒤 저장소의 연결을 지우고(다른 탭 흉내: `LIBRARY_KEY`에 직접 씀) 누르면 `폴더 연결이 바뀌었어요. 창을 닫고 다시 열어 주세요`, 장소 수 그대로.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/add-place` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `yarn vitest run tests/unit/sections/add-place` → PASS(기존 `lazy-steps*`·`panel-focus` 포함), `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(add-place): 새로 저장한 곳만 보여 주는 폴더 다시 가져오기 화면`

---

### Task 7: 라벨 관리에서 다시 가져오기

**Files:**
- Modify: `src/stores/add-place.ts`, `src/sections/labels/LabelsPage.tsx`, `src/sections/labels/LabelEditor.tsx`, `src/sections/labels/DeleteLabelDialog.tsx`
- Test: `tests/unit/sections/labels/labels-page.test.tsx`

**Interfaces:**
- Consumes: Task 2의 `folderLinksOfLabel`·`unlinkFolder`, Task 5의 `localDate`, `addFlowAtom`·`addTargetAtom`·`addOpenerAtom`.
- Produces:
  ```ts
  // src/stores/add-place.ts
  export const openFolderSyncAtom: WritableAtom<null, [shareId: string, opener: HTMLElement | null], void>;
  //   addTargetAtom ← null, addOpenerAtom ← opener, addFlowAtom ← { step: 'folder', shareId }
  // LabelEditor props += { folders: FolderLink[]; onResync(shareId: string): void; onUnlink(shareId: string): void }
  // DeleteLabelDialog props += { hasFolders: boolean }
  ```
- `LabelsPage`: 줄마다 연 단추 요소를 `Map<labelId, HTMLButtonElement>` ref에 모은다. `onResync`는 `setDialog(null)` 뒤 `openFolderSync(shareId, 그 라벨 줄 단추)`. `onUnlink`는 `run(unlinkFolder)` 성공 시 토스트. 줄 개수 글자는 연결이 있으면 `장소 <N>곳 · 네이버 폴더`.
- `LabelEditor`: `folders`가 있을 때만 `ColorPicker`·`IconPicker` 아래에 `<Box component="section" aria-labelledby=…>` + `h3` `네이버 폴더`, 줄마다 이름·`<날짜> 확인`·두 단추(Global Constraints의 접근 이름, `minHeight: 44`).

- [ ] **Step 1: 실패하는 시험**
  - 연결 있는 라벨 줄에 `장소 2곳 · 네이버 폴더`, 없는 줄은 지금 글자.
  - 그 줄을 열면 `네이버 폴더` 제목, 폴더 이름, `2026.10.12 확인`, 단추 `‘속초 맛집’에서 새로 저장한 곳 가져오기`. 연결 없는 라벨에는 구역 없음.
  - 그 단추 → 대화상자 닫힘, `addFlowAtom`이 `{ step: 'folder', shareId: 'abc123' }`, `addTargetAtom`이 `null`, `addOpenerAtom`이 그 라벨 줄 단추. 셸까지 그리는 하네스(`tests/unit/sections/shell/harness.tsx`)로 넓은 폭·좁은 폭 각각 포커스가 추가 칸 안에 있고, 칸을 `Esc`(넓음)·`취소`(좁음)로 닫으면 포커스가 그 라벨 줄 단추(Review Focus 2).
  - `‘속초 맛집’ 연결 끊기` → 연결 `deletedAt` 있음, 토스트, 구역 사라짐.
  - 연결 있는 라벨의 지우기 확인 문구 끝 ` 연결된 네이버 폴더도 끊겨요.`, 지우면 연결도 지워짐.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/labels` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `yarn vitest run tests/unit/sections` → PASS, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(labels): 라벨 고치기에서 네이버 폴더 다시 가져오기·연결 끊기`

---

### Task 8: E2E와 롤백 문서

**Files:**
- Create: `tests/e2e/folder-resync.spec.ts`, `tests/fixtures/links/api/naver-folder-more.json`
- Modify: (병합 뒤 별도 문서 PR) `docs/rollback.md`

**Interfaces:**
- Consumes: 전 Task. `seedStorage`(`tests/e2e/fixtures.ts`), `place-folder.json`·`naver-folder.json` 녹화 응답.
- `naver-folder-more.json` = `naver-folder.json`의 세 곳 + `tests/fixtures/naver/bookmarks-sokcho.json`에서 그 세 sid가 아닌 한 곳(같은 모양 `{ sid, name, address, lng, lat, memo }`). 새 녹화는 하지 않는다.

- [ ] **Step 1: E2E 작성** — `test('@smoke 가져온 폴더를 라벨 관리에서 다시 가져오면 새로 저장한 곳만 더한다')`(세 프로젝트에서 돌고 `@smoke`는 이 하나):
  1. 빈 보관함, `/api/place` → `place-folder.json`, `/api/naver-folder` → 처음엔 `naver-folder.json`(받은 `share`·`fresh` 값을 모은다).
  2. ＋ → `네이버 폴더 가져오기` → `https://naver.me/xjYaIYfe` → `3곳 가져오기` → `3곳을 새로 넣었어요`.
  3. 응답을 `naver-folder-more.json`으로 바꾼다. `/labels` → `속초, 고성, 양양 맛집` 줄(`장소 3곳 · 네이버 폴더`) → `‘속초, 고성, 양양 맛집’에서 새로 저장한 곳 가져오기`.
  4. `새로 저장한 곳 1 · 그대로 3 · 폴더에서 빠진 곳 0`, `1곳 가져오기` → `1곳을 새로 넣었어요` → `보관함에서 보기` → 목록 4행, 라벨 칩이 눌린 상태.
  5. 다시 가져오기 요청에 `fresh=1`이 있었고 첫 가져오기 요청에는 없었다.
  6. 같은 링크를 다시 붙여 넣으면 `새로 저장한 곳 0` 화면과 `확인했어요`.
- [ ] **Step 2:** `E2E_PORT=5175 yarn playwright test tests/e2e/folder-resync.spec.ts` → 세 프로젝트 PASS(먼저 `yarn build:map:e2e`)
- [ ] **Step 3:** (**병합 뒤**, 다른 묶음과 같이 별도 문서 PR `docs: 롤백 표에 v0.10.0`) `docs/rollback.md` 표에 줄 하나: `| \`v0.10.0\` | \`<병합 커밋>\` | 네이버 폴더 다시 가져오기 (#PR) | ✅ 그대로 읽음. ⚠️ 옛 버전에서 저장하면 네이버 폴더 연결(\`folders\`)이 지워져, 돌아온 뒤 폴더 링크를 한 번 더 붙여 넣어야 다시 가져오기를 쓸 수 있음(장소·라벨은 그대로) |`. 표 아래 `v0.3.0 이후로는 저장 형식이 바뀌지 않아…` 문장을 `v0.3.0~v0.7.x 사이는 저장 형식이 같고, 그 뒤로는 선택 필드만 더했다(옛 버전은 모르는 필드를 손상으로 보지 않고 떼어 낸다)`로 고친다(F2 계획 Task 8이 이미 고쳤으므로 보통은 그 문장에 `folders`만 더한다).
- [ ] **Step 4: 전체 확인** — `yarn build:ci` 통과(크기 예산 포함, `--require-lazy` 목록 그대로), `E2E_PORT=5175 yarn test:e2e` 통과.
- [ ] **Step 5:** 커밋 `test(e2e): 폴더 다시 가져오기`(롤백 표는 Step 3대로 병합 뒤 따로)
- [ ] **Step 6: 되돌리기 확인** — 임시 브랜치에서 Task 7, Task 6 커밋을 새것부터 `git revert --no-edit` 해 `yarn typecheck && yarn test`가 통과하는지 확인(연결 기록만 남는 상태). 결과를 PR 설명에 적고 임시 브랜치는 지운다. 원격에는 올리지 않는다.
