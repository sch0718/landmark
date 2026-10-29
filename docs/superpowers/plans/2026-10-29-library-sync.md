# 기기 간 보관함 동기화(로그인) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 본인이 켠 기기끼리 보관함(장소·라벨·여행·폴더 연결·약속)을 Cloudflare D1을 거쳐 항목별로 맞춘다. 로그인은 `@sch0718/firebase-session@0.2.1`(Google·카카오·네이버 → D1 기기 세션)이다(서버 제안 로드맵 3단계).

**Architecture:** Pages Functions 한 진입점(`functions/api/sync/[[path]].ts`)이 `src/server/library-sync/router.ts`를 부르고, 라우터가 패키지 세션 API(`/v1/session*`)와 보관함 API(`/v1/library/*`)를 나눈다. 서버는 항목별 행(`library_items`)과 사용자별 단조 증가 `rev`를 커서로 쓰고, 올린 항목을 저장본과 **서버·브라우저 공용 순수 병합 함수**(`src/domain/library-sync/merge.ts`, 필드 단위 LWW)로 합친다. 브라우저는 항목 해시를 "마지막으로 서버와 맞춘 base"와 비교해 바뀐 항목을 올리고, 받은 항목을 `LibraryStore.update` 안에서 합친 뒤 결정적 정리(`repairLibrary`)를 거친다. 엔진은 동기화를 켠 사용자만 나눠 받는다.

**Tech Stack:** React 19, MUI 7, Jotai, Effect 4.0.2(Schema), Vitest 5, Playwright, Cloudflare Pages Functions + D1, `@sch0718/firebase-session@0.2.1`(worker·client·vite), `firebase@^12.19.0`(Google 로그인 때만 나눠 받음), Node 24 `node:sqlite`(시험 전용).

**설계 문서:** `docs/superpowers/specs/2026-10-29-library-sync-design.md` — 이 계획과 다르면 설계 문서가 맞다. 모든 과제 전에 한 번 읽는다. 1단계 본보기 `docs/superpowers/specs/2026-10-25-meeting-online-design.md`, 패키지 README(`node_modules/@sch0718/firebase-session/README.md`, Task 3 뒤 설치됨)도 읽는다.

## Global Constraints

- 셸: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`, Yarn 1.22.22. `GITHUB_PACKAGES_TOKEN`은 환경 변수로 있다(값 출력 금지). 설치 없이 명령만 돌릴 때 비어 있으면 `export GITHUB_PACKAGES_TOKEN=`.
- **포트 5173·5174를 쓰거나 끄지 않는다(사용자 개발 서버). `pkill` 금지.** E2E는 `E2E_PORT=4181 E2E_MAP_PORT=4182`(Task 9가 `E2E_MAP_PORT`를 만든다), 로컬 실행은 Vite 4185·wrangler 8795. 띄운 프로세스는 PID로만 끈다.
- 원격 D1 마이그레이션·`wrangler secret put`·`wrangler pages deploy`·외부 계정·키 생성 금지. 저장소에 `wrangler.toml`을 만들지 않는다. 키·시크릿·세션·코드 값을 파일·로그·커밋에 쓰지 않는다.
- 새 의존성은 **`@sch0718/firebase-session@0.2.1`(정확한 버전)과 `firebase@^12.19.0`만**. `jose`는 패키지가 데려온다. `@cloudflare/workers-types`·`idb`·`fake-indexeddb`는 쓰지 않는다.
- 보관함 형식(`tripmap:library:v2`, schemaVersion 2)·백업 형식(`landmark-backup` v1)·공유 링크 형식은 바꾸지 않는다. 기존 도메인 함수(`src/domain/library/ops.ts`, `src/domain/trips/ops.ts`, `src/schema/*.ts`)의 시그니처를 바꾸지 않는다(2A·2B와 병합 충돌 방지). 필요하면 새 파일에 감싼다.
- D1: `src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에만** 더하고 `SCHEMA_VERSION = 5`. 모든 문장은 `CREATE … IF NOT EXISTS`. `ALTER TABLE` 금지.
- `functions/**`와 `src/server/**`는 서로 상대 경로로 가져온다(`src/` 별칭 금지). 서버 코드에서 React·MUI 금지. `src/server/library-sync/*`는 Effect Schema를 써도 된다(공용 도메인 검사). `.sql` 파일을 import하지 않는다(`tests/unit/server/module-imports.test.ts`).
- 엔진(`src/services/library-sync/sync-engine.ts`)은 **어디서나 `loadSyncEngine()`(동적 import)로만** 가져온다. 정적으로 가져오면 `vite.config.ts`의 `INEFFECTIVE_DYNAMIC_IMPORT` 검사로 빌드가 실패한다. 첫 로딩 상한 `initialJsGzipMax` 327,680을 지킨다. 패키지 `client`·`firebase`는 첫 로딩에 들어가면 안 된다.
- 동기화 API 응답은 모두 `Cache-Control: private, no-store`, 오류 본문은 `{ error: '<code>', ...extra }`(패키지 클라이언트 형식). 세션 헤더 이름은 `X-Landmark-Session`.
- 사용자 문자열은 React 텍스트로만(`dangerouslySetInnerHTML`·`innerHTML` 금지. 가짜 공급자 HTML은 `escapeHtml`). 주석·UI 문구는 한국어. `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 고치지 않는다: `docs/rollback.md`, `perf-budget.json`, `.claude/`, `tests/e2e/global-setup*`, 다른 기능의 기존 시험 단언. `playwright.config.ts`는 Task 9가 적은 줄만 바꾼다.
- 여러 기능이 같이 고치는 문서(`README.md`, `docs/development.md`, 도움말)는 자기 절만 더하고 기존 줄을 되도록 바꾸지 않는다.
- Codex 샌드박스에서 네트워크(`yarn add`)·포트 열기가 막히면 그 명령을 건너뛰고 보고에 적는다(감독 에이전트가 대신 실행해 결과를 넘긴다).
- 과제마다 커밋한다. 메시지는 한국어 conventional(`feat(library-sync): …`), 끝 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **수렴**: `mergeItem`이 모든 종류·사례에서 교환법칙(`merge(a,b).doc`와 `merge(b,a).doc`이 같은 JSON)과 멱등(`merge(m,m).doc = m`)을 지키는지. 서버(`pushItems`)와 브라우저(`applyRemote`·`applyPushResults`)가 같은 함수를 쓰는지.
- **유실 금지**: base 해시 비교·올리는 사이 수정(지금 해시 ≠ 올린 해시)·전체 재동기화·보류(`held`)·거절(`rejected`)에서 이 기기 변경이 조용히 사라지지 않는지. 충돌 기록 규칙(설계 §충돌 기록).
- **격리·권한**: 모든 SQL에 `user_id = ?`(세션 값), 가짜 공급자가 localhost 요청 주소에서만 열리는지, 허용 목록 밖 계정에 세션이 생기지 않는지.
- **D1 한도**: 올리기·받기 한 요청의 질의 수(10개 안), 받기 응답을 문자열로 이어 붙이는지(문서 재해석 없음).
- **첫 로딩**: `yarn size --require-lazy …` 통과, 부트 코드가 패키지·엔진을 정적으로 가져오지 않는지.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/domain/library-sync/items.ts` | 항목 종류·키·목록·넣기·해시·검사(`decodeItem`)·여행 참조·시각 |
| `src/domain/library-sync/merge.ts` | `mergeItem`(종류별 필드 LWW·삭제 3-way·여행 Day·전체 선택)·`mergeDeletion` |
| `src/domain/library-sync/repair.ts` | `repairLibrary`(라벨 이름·장소 출처 중복, 끊긴 라벨·폴더 정리) |
| `src/domain/library-sync/apply.ts` | base 타입·`dirtyItems`·`applyRemote`·`applyPushResults`·충돌·보류·검증 되돌림 |
| `src/server/meet/schema-sql.ts` | 표 5개 추가, `SCHEMA_VERSION = 5` |
| `src/server/library-sync/env.ts` | `SyncEnv`·`SyncContext`·`SyncDeps`·`productionDeps()` |
| `src/server/library-sync/http.ts` | `syncJson`·`syncError`·`SyncHttpError`·`isSyncOrigin`·`isLocalRequest` |
| `src/server/library-sync/limits.ts` | `SYNC_LIMITS`·`consumeCounter`·`counterKey` |
| `src/server/library-sync/auth.ts` | `redirectUrisFor`·`providerStatus`·`sessionAuthFor`·`requireSyncUser` |
| `src/server/library-sync/dev-fake-social.ts` | 개발용 가짜 카카오·네이버 공급자(repass `devFakeSocial` 이식) |
| `src/server/library-sync/library.ts` | `readMe`·`pullChanges`·`pushItems`·`purgeTombstones`·`deleteAccountData`·`ACCOUNT_DATA_TABLES` |
| `src/server/library-sync/router.ts` | `SYNC_ROUTES`·`handleSync` |
| `functions/api/sync/[[path]].ts` | Pages 진입점(모든 메서드) |
| `src/services/library-sync/boot.ts` | 첫 로딩: `readBootFlag`·`syncFeatureVisible`·`loadSyncEngine`·`loadSyncSection` |
| `src/services/library-sync/callback-capture.ts` | 첫 로딩: `/auth/callback` 코드를 메모리로 옮기고 주소에서 지움 |
| `src/services/library-sync/storage.ts` | 기록 키 4개 읽기·쓰기 |
| `src/services/library-sync/config.ts` | 빌드 설정 → 공급자·Firebase 설정 |
| `src/services/library-sync/api.ts` | 패키지 `createSessionClient` 위의 앱 API |
| `src/services/library-sync/login.ts` | Google·소셜 로그인·콜백 마무리·연결 판단·기기 이름·가짜 인가 주소 |
| `src/services/library-sync/sync-engine.ts` | 엔진(실행·예약·연결·충돌·보류·끄기·해제·지우기) |
| `src/stores/sync-status.ts` | 첫 로딩: `syncStatusAtom`·`SyncStatus`·`syncPhaseText` |
| `src/sections/library-sync/use-sync-boot.ts` | 첫 로딩: 셸에서 엔진 시작·저장 감지 |
| `src/sections/library-sync/AuthCallbackPage.tsx` | `/auth/callback` 화면 |
| `src/sections/library-sync/SyncSection.tsx` 외 대화상자 | 설정 › 동기화 |
| `tests/helpers/sqlite-d1.ts` | `run`·`all` 결과에 `success`·`meta`를 더해 패키지 `D1Database`와도 맞춤 |
| `tests/e2e/sync-server.ts`, `tests/e2e/library-sync.spec.ts` | E2E 가짜 서버·흐름 |

---

### Task 1: 공용 도메인 — 항목과 필드 병합

**Files:**
- Create: `src/domain/library-sync/items.ts`, `src/domain/library-sync/merge.ts`
- Test: `tests/unit/domain/library-sync/items.test.ts`, `tests/unit/domain/library-sync/merge.test.ts`

**Interfaces:**
- Consumes: `Library`·`Place`·`Label`·`FolderLink`·`PlaceSchema`·`LabelSchema`·`FolderLinkSchema`(`src/schema/library.ts`), `Trip`·`TripSchema`·`checkTrip`(`src/schema/trip.ts`), `Meeting`·`MeetingSchema`·`checkMeeting`(`src/schema/meeting.ts`), `pickField`·`Field`(`src/domain/library/lww.ts`), `safeParse`(`src/schema/parse.ts`).
- Produces(`items.ts`):
  - `ITEM_KINDS = ['label', 'place', 'folder', 'trip', 'meeting'] as const`(올리는 순서), `type ItemKind`, `type ItemDocOf = { label: Label; place: Place; folder: FolderLink; trip: Trip; meeting: Meeting }`, `type AnyItem = ItemDocOf[ItemKind]`, `type ItemKey = \`${ItemKind}:${string}\``.
  - `itemKey(kind: ItemKind, id: string): ItemKey`, `parseItemKey(key: string): { kind: ItemKind; id: string } | null`(모르는 종류·빈 id면 null).
  - `type ItemEntry = { key: ItemKey; kind: ItemKind; id: string; doc: AnyItem }`; `listItems(lib: Library): ItemEntry[]` — `ITEM_KINDS` 순서, 같은 종류 안에서는 id 사전순, 묘비 포함. 폴더 id는 `shareId`(키), 없는 선택 컬렉션은 빈 것으로.
  - `getItem(lib: Library, kind: ItemKind, id: string): AnyItem | undefined`.
  - `putItems(lib: Library, entries: readonly { kind: ItemKind; id: string; doc: AnyItem }[]): Library` — 바뀐 컬렉션만 새 객체. `meetings`·`folders`가 없으면 만든다. 빈 입력이면 같은 `lib`(`===`).
  - `removeItems(lib: Library, keys: readonly ItemKey[]): Library` — 보류 되돌림에서 "없던 항목"을 빼는 데만 쓴다.
  - `stableStringify(value: unknown): string` — 객체 키를 재귀적으로 사전순 정렬한 `JSON.stringify`. 배열 순서는 그대로, `undefined` 값 키는 뺀다.
  - `hashItem(doc: unknown): string` — `cyrb53(stableStringify(doc))`(시드 0)를 `toString(36)`. cyrb53 구현을 파일 안에 둔다:
    ```ts
    function cyrb53(text: string, seed = 0): number {
      let h1 = 0xdeadbeef ^ seed;
      let h2 = 0x41c6ce57 ^ seed;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }
    ```
  - `isDeleted(doc: AnyItem): boolean`(`deletedAt !== null`), `itemLabel(kind: ItemKind, doc: AnyItem): string`(장소·라벨·폴더 `name.value`, 여행·약속 `title.value`).
  - `lastTouched(doc: AnyItem): string` — 문서 안 모든 `{ value, updatedAt }`의 `updatedAt`, `createdAt`, `deletedAt`(있으면), 폴더 `checkedAt` 중 가장 늦은 ISO 문자열(재귀로 찾는다. 여행 `days[].stops` 등 포함).
  - `tripRefs(trip: Trip): string[]` — `origin.value`(null 제외), `candidates.value`, 모든 Day `stops.value[].placeId`, `lodging.value`(null 제외)의 중복 없는 목록(사전순).
  - `ITEM_DOC_MAX_CHARS = 200_000`.
  - `decodeItem(kind: ItemKind, id: string, value: unknown): { ok: true; doc: AnyItem } | { ok: false; reason: 'invalid' | 'too-large' }` — `stableStringify(value).length > ITEM_DOC_MAX_CHARS`면 `too-large`. 종류별 스키마를 `safeParse`(기본 옵션). 문서 id(폴더는 `shareId`)가 `id`와 다르면 `invalid`. 여행은 `checkTrip(trip, Object.fromEntries(tripRefs(trip).map((p) => [p, true])), [])`가 이슈를 내면 `invalid`(장소 존재는 보관함 전체 검사가 맡는다), 약속은 `checkMeeting(meeting, [])`.
- Produces(`merge.ts`):
  - `type Loser = { path: string; side: 'a' | 'b'; value: unknown; updatedAt: string }`, `type MergeResult<T> = { doc: T; losers: Loser[]; whole?: 'a' | 'b' }`.
  - `mergeDeletion(a: AnyItem, b: AnyItem, baseDeleted?: boolean): string | null` — 설계 §필드 병합의 삭제 규칙. 둘 다 묘비면 늦은 `deletedAt`. 다르고 `baseDeleted !== undefined`면 `isDeleted(x) !== baseDeleted`인 쪽의 `deletedAt`(둘 다 다를 수 없다: 불리언). `baseDeleted === undefined`면 묘비의 `deletedAt`과 살아 있는 쪽 `lastTouched` 비교, 늦은 쪽, 같으면 묘비.
  - `mergeItem<K extends ItemKind>(kind: K, a: ItemDocOf[K], b: ItemDocOf[K], opts?: { baseDeleted?: boolean }): MergeResult<ItemDocOf[K]>` — 규칙:
    - 모든 `Field`: `pickField(a.f, b.f)`. 진 쪽 값이 이긴 값과 다르면(`stableStringify` 비교) `losers`에 `{ path: '<필드명>', side, value, updatedAt }`.
    - 선택 필드(장소 `visitedOn`·`review`, 라벨 `emoji`): 한쪽만 있으면 그 값(진 쪽 없음), 둘 다 있으면 `pickField`.
    - 장소 `source`·`address`·`lng`·`lat`: `stableStringify([source,address,lng,lat])`가 같으면 그대로, 다르면 `createdAt`이 이른 쪽(같으면 문자열이 큰 쪽). `createdAt` = 이른 값. 폴더 `checkedAt` = 늦은 값.
    - `deletedAt` = `mergeDeletion(a, b, opts?.baseDeleted)`.
    - 여행: `dateWinner` = `max(startDate.updatedAt, endDate.updatedAt)`가 늦은 쪽(같으면 `stableStringify([startDate, endDate, days.length])`가 큰 쪽). `startDate`·`endDate`는 그쪽 것. `a.days.length === b.days.length`면 `days[i] = { stops: pickField, lodging: pickField, startTime: pickField }`(진 값은 `losers`에 `days.<i>.stops` 등), 다르면 `dateWinner.days` 그대로(다른 쪽 Day 필드 중 이긴 쪽과 다른 것을 `losers`에 `days`로 하나). 그 밖의 필드는 `pickField`. 결과가 `checkTrip(result, refs 전부 있음, [])`을 어기면 **전체 선택**: `lastTouched`가 늦은 쪽(같으면 `stableStringify`가 큰 쪽) 문서를 쓰고 `deletedAt`만 `mergeDeletion` 결과로 바꾼다. `whole`에 이긴 쪽 반대(진 쪽) `'a' | 'b'`, `losers`는 비운다.
    - 약속: 필드 LWW 뒤 `checkMeeting(result, [])`가 이슈를 내면 같은 방식의 전체 선택.
    - 결과 `doc`의 키 순서는 스키마 필드 순서(=`a`의 키 순서)로 만든다.
- [ ] **Step 1: 실패하는 시험** — `items.test.ts`: `listItems`가 종류 순서·id 순서·묘비 포함·폴더 키, `itemKey`/`parseItemKey` 왕복과 `parseItemKey('x:1') === null`, `putItems`가 빈 입력에 같은 참조·`folders` 없을 때 만듦, `stableStringify({b:1,a:{d:1,c:2}}) === '{"a":{"c":2,"d":1},"b":1}'`, 키 순서만 다른 두 문서의 `hashItem`이 같고 메모 한 글자 다르면 다름, `lastTouched`가 여행 Day Stop 필드 시각까지 봄, `tripRefs`, `decodeItem`(정상 장소, id 불일치 invalid, Stop 메모 500자를 400개 넣어 20만 자를 넘긴 여행 too-large, 날 수가 기간과 다른 여행 invalid, 참석자 id 중복 약속 invalid). 시험 문서는 `tests/fixtures/builders.ts`의 기존 빌더를 쓴다(없는 종류는 시험 파일 안에서 최소 문서를 만든다).
  `merge.test.ts`: 장소 메모 시각 늦은 쪽 승리와 `losers` 경로, 같은 시각 사전순, `visitedOn` 한쪽만, `review` 둘 다, 라벨 `emoji` null 값 LWW, 바뀌지 않는 값, 삭제 네 갈래(둘 다 살아 있음·둘 다 묘비 늦은 값·base로 바꾼 쪽 승리 a/b 양방향·base 없을 때 시각 비교와 같은 시각 묘비 승리), 여행 같은 날 수 Day별 병합, 날 수 다름 날짜 승자 `days`, 후보·Stop에 같은 장소가 생기는 병합의 전체 선택(`whole`), 약속 참석자 삭제와 답장 충돌의 전체 선택. **성질 시험**: 위 모든 쌍에서 `stableStringify(mergeItem(k,a,b).doc) === stableStringify(mergeItem(k,b,a).doc)`, `mergeItem(k,m,m).doc`이 `m`과 같은 문자열이고 `losers`가 비어 있음, `mergeItem(k, a, mergeItem(k,a,b).doc).doc`이 `mergeItem(k,a,b).doc`과 같음.
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/library-sync/items.test.ts tests/unit/domain/library-sync/merge.test.ts` → 실패 확인
- [ ] **Step 3:** 구현. `src/domain/library/lww.ts`의 `pickField`를 그대로 쓰고 바꾸지 않는다. 파일은 `src/` 별칭 import를 써도 된다(서버 번들도 tsconfig 경로로 읽는다. `src/domain/meeting/online-doc.ts`가 같은 방식).
- [ ] **Step 4:** 시험 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library-sync): 동기화 항목과 필드 병합 도메인`

### Task 2: 공용 도메인 — 받은 항목 반영·정리·보류

**Files:**
- Create: `src/domain/library-sync/repair.ts`, `src/domain/library-sync/apply.ts`
- Test: `tests/unit/domain/library-sync/repair.test.ts`, `tests/unit/domain/library-sync/apply.test.ts`

**Interfaces:**
- Consumes: Task 1 전부, `mergeLabels`·`OpCtx`(`src/domain/library/ops.ts`), `setField`(`lww.ts`), `normalizeLabelName`·`LibrarySchema`(`src/schema/library.ts`), `safeParse`·`Issue`.
- Produces(`repair.ts`):
  - `repairLibrary(lib: Library, ctx: OpCtx): Library` — 설계 §반영 뒤 정리 1~4를 이 순서로. 고칠 것이 없으면 같은 참조. 결정적이어야 한다(입력 순서와 무관, 앞선 쪽 = `createdAt` 작은 쪽, 같으면 id 작은 쪽).
    - 장소 출처 키: `naver:<sid>`, `kakao:<kakaoId>`, `google:<googleId>`, `legacy:<publicId>/<placeKey>`(pin이고 `legacy`가 있을 때만).
    - 장소 합치기: 남는 장소의 각 LWW 필드 = `pickField(남는, 뒤)`, `labelIds` = `{ value: 두 값의 합집합(남는 쪽 순서 뒤에 새 것), updatedAt: 둘 중 늦은 시각 }`, 선택 필드는 Task 1 규칙. 뒤 장소 `deletedAt = ctx.now`. 여행마다 뒤 id → 남는 id: `origin`·`lodging`은 늘 바꾸고(`setField`, `ctx.now`), `candidates`·Stop은 그 여행에 남는 id가 이미 없을 때만 바꾼다.
  - 끊긴 라벨: 살아 있는 장소의 `labelIds`에 없거나 지운 라벨이 있으면 빼서 `setField(…, ctx.now)`. 폴더: 살아 있는 연결의 `labelId`가 없거나 지운 라벨이면 `deletedAt = ctx.now`.
- Produces(`apply.ts`):
  - `type BaseEntry = { rev: number; hash: string; deleted: boolean }`, `type BaseMap = Record<string, BaseEntry>`.
  - `type RemoteItem = { kind: ItemKind; id: string; rev: number; deleted: boolean; doc: unknown }`.
  - `type Conflict = { id: string; key: ItemKey; kind: ItemKind; label: string; path: string; mine: unknown; theirs: unknown; at: string; whole?: true; deleted?: true }`.
  - `type HeldItem = { key: ItemKey; rev: number; reason: 'decode' | 'library' }`.
  - `type ApplyOptions = { ctx: OpCtx; lastSyncAt: string | null; fullResync: boolean; conflictId: () => string; skip?: ReadonlySet<string> }` — `skip`은 사용자가 `건너뛰기`한 키(반영하지 않고 base만 remote로).
  - `type ApplyResult = { lib: Library; base: BaseMap; conflicts: Conflict[]; held: HeldItem[] }`.
  - `type DirtyItem = { key: ItemKey; kind: ItemKind; id: string; doc: AnyItem; hash: string; baseRev: number; baseDeleted: boolean | null }`.
  - `dirtyItems(lib: Library, base: BaseMap, rejected: readonly { key: string; hash: string }[]): DirtyItem[]` — `listItems` 순서. base가 없거나 해시가 다른 항목. `rejected`에 같은 키·같은 해시가 있으면 뺀다. `baseRev`는 base 없으면 0, `baseDeleted`는 base 없으면 null.
  - `missingFromLocal(lib: Library, base: BaseMap): boolean` — base 키 중 보관함에 없는 것이 있는가.
  - `applyRemote(local: Library, base: BaseMap, remote: readonly RemoteItem[], opts: ApplyOptions): ApplyResult` — 설계 §받은 항목 반영 표 그대로, 그 뒤:
    1. `remote.doc`을 `decodeItem`으로 검사. 실패하면 반영하지 않고 `held`(`reason: 'decode'`).
    2. 충돌 판단(설계 §충돌 기록): 합칠 때 `losers` 중 `side`가 local이고 `opts.lastSyncAt !== null && loser.updatedAt > opts.lastSyncAt`인 것마다 `Conflict`(`mine` = 진 값, `theirs` = 결과 값, `at = ctx.now`). `whole`이 local이면 `{ path: '', whole: true, mine: local 문서, theirs: 결과 문서 }` 하나(`lastSyncAt` 조건은 `lastTouched(local) > lastSyncAt`). 결과가 묘비이고 local이 살아 있었으며 `lastTouched(local) > lastSyncAt`이면 `{ deleted: true }` 하나.
    3. `opts.fullResync`면 base에 있는데 `remote`에 없는 키: 보관함 항목이 살아 있으면 `deletedAt = ctx.now`로 바꾸고(이 기기 수정이 `lastSyncAt` 뒤면 `deleted` 충돌), base를 `{ rev: 0, hash: hashItem(새 묘비), deleted: true }`. 항목이 없으면 base에서 뺀다.
    4. `repairLibrary(next, ctx)`.
    5. `safeParse(LibrarySchema, next)`. 실패하면 이슈 `path`의 앞 두 마디(`places.<id>` 등 → `place:<id>`, `folders.<shareId>` → `folder:<shareId>`)로 키를 모아, 그 키들만 local 값으로 되돌리거나(없던 항목은 `removeItems`) 다시 4~5. 되돌린 키 중 이번 `remote`에 있던 것은 `held`(`reason: 'library'`, `rev` = 그 remote rev)이고 base는 바꾸지 않는다. 세 번 돌아도 실패하면 이번 `remote` 전체를 반영하지 않고 모두 `held`.
    6. 아무것도 안 바뀌었으면 `lib === local`.
  - `type PushResultItem = { kind: ItemKind; id: string; rev: number; doc?: unknown }`.
  - `applyPushResults(local: Library, base: BaseMap, sent: readonly DirtyItem[], results: readonly PushResultItem[], opts: ApplyOptions): ApplyResult` — 결과마다 서버 문서 = `result.doc ?? sent.doc`. 지금 보관함 항목 해시가 `sent.hash`와 같으면 서버 문서로 바꾸고, 다르면(올리는 사이 더 고침) `mergeItem(local, server, { baseDeleted: isDeleted(sent.doc) })`(공통 조상은 올린 문서)과 충돌 판단. base = `{ rev: result.rev, hash: hashItem(server), deleted: isDeleted(server) }`. 그 뒤 4~5 단계(정리·검증·되돌림)는 `applyRemote`와 같다.
- [ ] **Step 1: 실패하는 시험** — `repair.test.ts`: 이름만 대소문자·공백 다른 두 라벨 → 앞선 라벨만 남고 장소 `labelIds`·폴더 `labelId`가 옮겨짐, 같은 네이버 sid 두 장소 → 앞선 장소 남고 메모는 늦은 값·`labelIds` 합집합·뒤 장소 묘비, 여행 후보에 둘 다 있으면 뒤 id 자리 그대로·한쪽만 있으면 바뀜·`origin` 바뀜, 지운 라벨을 가리키는 `labelIds` 정리, 지운 라벨의 폴더 연결 묘비, 고칠 것 없으면 같은 참조, **입력 순서를 섞어도 같은 결과**(`stableStringify` 비교), 결과가 `LibrarySchema`를 통과.
  `apply.test.ts`: 메아리(`base.rev >= remote.rev`) 건너뜀, 새 항목·새 묘비 추가, 안 고친 항목은 remote로 바뀜, 양쪽 고침은 병합하고 base는 remote, `lastSyncAt` 뒤 고친 메모가 지면 충돌 1건·앞이면 0건·`lastSyncAt === null`이면 0건, 다른 기기 삭제 vs 이 기기 수정 → 묘비 + `deleted` 충돌, 전체 재동기화에서 서버에 없는 살아 있는 장소 → 묘비·base `rev 0`, 해석 실패 remote → `held: decode`·보관함 그대로, 여행이 없는 장소를 가리키는 remote → 그 여행만 `held: library`·다른 항목은 반영, `dirtyItems`(base 없음·해시 다름·rejected 같은 해시 제외·순서), `missingFromLocal`, `applyPushResults` 두 갈래(안 고침 → 서버 문서, 더 고침 → 병합하고 다음 dirty에 남음).
- [ ] **Step 2:** `yarn vitest run tests/unit/domain/library-sync/repair.test.ts tests/unit/domain/library-sync/apply.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library-sync): 받은 항목 반영·정리·보류`

### Task 3: 서버 기반 — 의존성·표·세션·가짜 공급자·진입점

**Files:**
- Modify: `package.json`·`yarn.lock`(의존성), `src/server/meet/schema-sql.ts`, `tests/helpers/sqlite-d1.ts`, `docs/development.md`의 공용 패키지 표(한 줄 추가), `public/third-party-notices.txt`(`yarn build:notices` 결과)
- Create: `src/server/library-sync/env.ts`, `src/server/library-sync/http.ts`, `src/server/library-sync/limits.ts`, `src/server/library-sync/auth.ts`, `src/server/library-sync/dev-fake-social.ts`, `src/server/library-sync/router.ts`, `functions/api/sync/[[path]].ts`
- Test: `tests/unit/server/sync-schema.test.ts`, `tests/unit/server/sync-auth.test.ts`, `tests/unit/server/sync-dev-fake.test.ts`, 기존 `tests/unit/server/meet-db.test.ts`의 버전 단언(2 → 5)

**Interfaces:**
- Consumes: `MeetDb`·`ensureSchema`(`src/server/meet/db.ts`), `hashIp`(`src/server/meet/tokens.ts`), `pruneLimits`(`src/server/meet/limits.ts`), `isAllowedOrigin`(`src/server/http.ts`), `requestOrigin`·`globalFetch`(`src/server/handler.ts`). 패키지 `@sch0718/firebase-session/worker`: `createSessionAuth`, `googleCerts`, `socialKeys`, `SESSION_PATHS`, `HttpError`, `CertsUnavailableError`, `readJson`, `publicSessionId`, `purgeSessions`, `SOCIAL_PROVIDERS`, `base64url`, 타입 `SessionAuth`·`AuthContext`·`CertSource`·`SocialProvider`·`SocialLoginOptions`·`D1Database`.
- Produces:
  - 의존성: `yarn add --exact @sch0718/firebase-session@0.2.1` 그리고 `yarn add firebase@^12.19.0`. `yarn build:notices`로 고지 갱신.
  - `SCHEMA_VERSION = 5`, `SCHEMA_STATEMENTS` 끝에 설계 §서버 데이터의 문장 10개(`users`, `sessions`, `sessions_user`, `library_state`, `library_items`, `library_items_rev`, `library_items_tomb`, `library_devices`)를 **그대로**(주석 포함, 각 문장은 배열 원소 하나).
  - `tests/helpers/sqlite-d1.ts`: `run()`·`execute()`가 `{ results: [], success: true, meta: { changes } }`, `all()`이 `{ results, success: true, meta: { changes: 0 } }`를 돌려준다(기존 `MeetDb` 소비자는 그대로 동작). 반환 타입을 `MeetDb & { close(): void }`로 유지.
  - `env.ts`:
    ```ts
    export type SyncEnv = {
      DB?: MeetDb;
      IP_HASH_SALT?: string;
      LIBRARY_SYNC?: string;
      FIREBASE_PROJECT_ID?: string;
      ALLOWED_EMAILS?: string;
      ALLOWED_ACCOUNTS?: string;
      KAKAO_CLIENT_ID?: string;
      KAKAO_CLIENT_SECRET?: string;
      NAVER_CLIENT_ID?: string;
      NAVER_CLIENT_SECRET?: string;
      SYNC_REDIRECT_URIS?: string;
      SYNC_DEV_FAKE_SOCIAL?: string;
    };
    export type SyncContext = {
      request: Request;
      env: SyncEnv;
      waitUntil(p: Promise<unknown>): void;
      params: Record<string, string | string[]>;
    };
    export type SyncDeps = {
      now(): number;
      fetch: typeof fetch;
      random(n: number): Uint8Array;
      uuid(): string;
      certs: CertSource;
      socialKeys: Record<SocialProvider, CertSource>;
      log(line: string): void;
    };
    /** 격리마다 하나(인증서·JWKS 캐시를 요청 사이에 나눈다). */
    export function productionDeps(): SyncDeps;
    ```
  - `http.ts`: `class SyncHttpError extends Error { constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) }`, `syncJson(status: number, body: unknown): Response`(`Content-Type: application/json; charset=utf-8`, `Cache-Control: private, no-store`, `body === null`이면 본문 없음), `syncError(error: unknown): Response | null` — `SyncHttpError`·패키지 `HttpError`는 `{ error: code, ...extra }`, `CertsUnavailableError`는 `503 { error: 'certs-unavailable' }`, 그 밖은 null(라우터가 500 `internal`로 바꾸고 `@sch0718/firebase-session:`으로 시작하는 메시지만 `deps.log`). `isLocalRequest(request: Request): boolean`(요청 주소 호스트가 `localhost`·`127.0.0.1`·`[::1]`), `isSyncOrigin(request: Request): boolean` = `isAllowedOrigin(origin) || (isLocalRequest(request) && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/.test(origin))`(`origin = requestOrigin(request)`).
  - `limits.ts`: `SYNC_LIMITS = { login: 60, pull: 5000, push: 2000, items: 30000 } as const`, `counterKey(action: string, subject: string, now: number): string` → `'<action>:<subject>:<YYYY-MM-DD UTC>'`, `consumeCounter(db: MeetDb, key: string, amount: number, max: number): Promise<boolean>` — `INSERT INTO rate_counters (key, count) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET count = count + excluded.count RETURNING count`가 `max` 이하면 true. `consumeLoginLimit(ctx: SyncContext, now: number): Promise<void>` — 소금 `IP_HASH_SALT`(없으면 `isLocalRequest`일 때만 `'dev-salt'`, 아니면 `503 config`), IP `CF-Connecting-IP ?? 'local'`, 키 `counterKey('sync-login', ipHash, now)`, 넘으면 `SyncHttpError(429, 'rate-limited')`.
  - `auth.ts`:
    ```ts
    export const SYNC_SESSION_HEADER = 'X-Landmark-Session';
    export type SyncUser = {
      userId: string;
      sessionHash: string;
      sessionId: string; // publicSessionId(sessionHash)
      provider: 'google' | 'kakao' | 'naver';
      account: string; // Google 이메일, 소셜 'kakao:<sub>'
    };
    export function devFakeEnabled(ctx: SyncContext): boolean; // isLocalRequest && env.SYNC_DEV_FAKE_SOCIAL === '1'
    export function redirectUrisFor(ctx: SyncContext): string[]; // SYNC_REDIRECT_URIS(콤마, https 또는 localhost http만) 또는 [요청 주소 origin + '/auth/callback']
    export function providerStatus(ctx: SyncContext): { google: boolean; kakao: boolean; naver: boolean; devFake: boolean };
    // google: FIREBASE_PROJECT_ID 있음. kakao: KAKAO_CLIENT_ID 있음 또는 devFake. naver: NAVER_CLIENT_ID와 SECRET 있음 또는 devFake.
    export function sessionAuthFor(ctx: SyncContext, deps: SyncDeps): SessionAuth;
    export async function requireSyncUser(ctx: SyncContext, deps: SyncDeps): Promise<SyncUser>;
    ```
    `sessionAuthFor`는 repass `worker/src/session.ts`의 `sessionAuth`와 같은 모양: `createSessionAuth({ db: ctx.env.DB as unknown as D1Database, projectId: env.FIREBASE_PROJECT_ID ?? '', allowedEmails: env.ALLOWED_EMAILS, certs: deps.certs, sessionHeader: SYNC_SESSION_HEADER, defaultLabel: '이름 없는 기기', now: deps.now, random: deps.random, uuid: deps.uuid, social })`. `social`은 카카오·네이버 중 하나라도 켜졌을 때만: 가짜면 `createFakeSocial`의 `keys`·`fetch`와 `{ clientId: 'dev-fake-kakao' | 'dev-fake-naver', clientSecret: 'dev-fake-secret', redirectUris }`, 허용 목록 `env.ALLOWED_ACCOUNTS ?? 'kakao:dev-me,naver:dev-me'`. 진짜면 `deps.socialKeys`, env 값, `redirectUris: redirectUrisFor(ctx)`. `requireSyncUser`는 `authenticate(request)` 결과를 `SyncUser`로 바꾼다(`provider = ctx.user.provider ?? 'google'`, `account = provider === 'google' ? user.email : user.sub`).
  - `dev-fake-social.ts`: repass `worker/src/devFakeSocial.ts`를 옮긴다(`gh api repos/sch0718/repass/contents/worker/src/devFakeSocial.ts?ref=main -H 'Accept: application/vnd.github.raw'`로 읽기만 한다). 바꿀 점: `createFakeSocial(options: { now: () => number })`가 `{ keys, fetch, handle(request: Request, redirectUris: readonly string[]): Promise<Response | null> }`를 돌려준다. 경로는 `/api/sync/dev/fake-social/authorize`·`/api/sync/dev/fake-social/approve`. `approve`의 성공·취소·오류는 302 대신 `200 text/html`(`<meta http-equiv="refresh" content="0;url=<escapeHtml(콜백)>">`와 같은 주소의 링크 하나)을 돌려준다. 폼 `action`도 새 경로. 기본 계정 입력값은 `dev-me`. 시크릿 비교 값 `dev-fake-secret`은 그대로. 키 쌍은 모듈 변수 하나(격리마다).
  - `router.ts`:
    ```ts
    export type SyncRoute = {
      method: 'GET' | 'POST' | 'DELETE';
      path: RegExp; // '/api/sync' 뒤 경로에 맞춘다
      pattern: string;
      /** off일 때도 열린다(연결 해제·지우기) */
      allowWhenOff?: true;
      run(ctx: SyncContext, deps: SyncDeps, params: string[], url: URL): Promise<Response>;
    };
    export const SYNC_ROUTES: SyncRoute[];
    export async function handleSync(ctx: SyncContext, deps: SyncDeps): Promise<Response>;
    ```
    순서: 경로가 `/api/sync/dev/fake-social/`로 시작하면 `devFakeEnabled`일 때만 가짜 공급자 `handle`(아니면 404 `not-found`) → `isSyncOrigin` 실패 403 `origin` → `DB` 없으면 503 `config` → `ensureSchema(DB)` → 경로·메서드 고르기(없으면 404, 메서드 다르면 405) → `LIBRARY_SYNC === 'off'`이고 `allowWhenOff`가 없으면 503 `off`(`/v1/status`는 자체 처리) → `run`. 오류는 `syncError`, 그 밖 500 `internal`. 로그 한 줄 `{ method, path: pattern, status, ms }`(repass `handler.ts`와 같음, 값·토큰 없음).
    이 과제의 경로(Task 4가 보관함 경로를 더한다):
    - `GET /v1/status` → `200 { enabled: off가 아니고 공급자가 하나라도 있음, reason?: 'off' | 'config', providers: { google, kakao, naver }, devFake }`
    - `POST /v1/session` → `consumeLoginLimit` → `auth.create(request, await readJson(request))` → 200, 성공 뒤 `waitUntil(purgeSessions(db, now, 100))`·`waitUntil(pruneLimits(db, new Date(now)))`
    - `POST /v1/session/social` → 같은 순서로 `auth.createSocial`
    - `DELETE /v1/session`(`allowWhenOff`) → `authenticate` → `revoke(ctx,'current')` + `DELETE FROM library_devices WHERE user_id = ? AND session_id = ?` → `200 { revoked }`
    - `GET /v1/sessions`(`allowWhenOff`) → `200 { sessions }`
    - `DELETE /v1/sessions`(`allowWhenOff`, 질의가 정확히 `others=1`, 아니면 422 `invalid`) → `revoke(ctx,'others')` + `DELETE FROM library_devices WHERE user_id = ? AND session_id <> ?`
    - `DELETE /v1/sessions/:id`(`allowWhenOff`) → `revoke(ctx,{ id })` + `DELETE FROM library_devices WHERE user_id = ? AND session_id = ?`
  - `functions/api/sync/[[path]].ts`:
    ```ts
    import { handleSync } from '../../../src/server/library-sync/router';
    import { productionDeps } from '../../../src/server/library-sync/env';
    import type { SyncContext } from '../../../src/server/library-sync/env';

    const deps = productionDeps();
    export const onRequest = (ctx: SyncContext): Promise<Response> => handleSync(ctx, deps);
    ```
- [ ] **Step 1: 의존성** — `yarn add --exact @sch0718/firebase-session@0.2.1`, `yarn add firebase@^12.19.0`, `yarn build:notices`. `docs/development.md` 공용 패키지 표에 한 줄: `| \`@sch0718/firebase-session\` | \`0.2.1\` | 보관함 동기화 로그인·기기 세션(\`src/server/library-sync/\`, \`src/services/library-sync/\`) |`. 표 아래 "GitHub Actions는 패키지마다(…)" 문장의 패키지 목록에 `firebase-session`을 더한다.
- [ ] **Step 2: 실패하는 시험**(모두 `// @vitest-environment node`, `createSqliteD1()`) — `sync-schema.test.ts`: `ensureSchema` 뒤 `schema_meta.version === 5`, 표 5개와 `sessions.identity` 열 존재(`PRAGMA table_info(sessions)`), `SCHEMA_STATEMENTS`를 두 번 돌려도 오류 없음, 버전 2인 DB(기존 문장만 있고 `schema_meta` 2)에서 올라감, 어떤 문장도 `ALTER`를 포함하지 않음. `sync-auth.test.ts`: `isSyncOrigin`(운영·미리보기 허용, `http://localhost:4185` 요청 주소 localhost면 허용·요청 주소가 운영이면 거절, `http://127.0.0.1:8795` 허용, `https://evil.example` 거절), `redirectUrisFor`(기본·환경 변수·`#` 포함 값 버림), `providerStatus`(빈 env 전부 false, 카카오 id만, 네이버 시크릿 없으면 false, 가짜는 localhost+플래그일 때만), `handleSync` `GET /api/sync/v1/status`(off면 `enabled:false, reason:'off'`, 공급자 없으면 `reason:'config'`), 출처 거절 403 `{ error: 'origin' }`, DB 없음 503 `config`, off에서 `POST /v1/session/social` 503 `off`·`DELETE /v1/session`은 401(세션 없음, off로 막히지 않음), 모르는 경로 404, 응답 헤더 `Cache-Control: private, no-store`, 로그인 한도 61번째 429. `sync-dev-fake.test.ts`: 가짜 공급자 전체 흐름 — `beginSocialSignIn`과 같은 값을 만들어(패키지 client의 `socialAuthorizeUrl`·`socialNonce` 사용, PKCE verifier 43자) `GET /api/sync/dev/fake-social/authorize?…&provider=kakao` 200 HTML(계정 입력·결과 라디오, `Content-Security-Policy` 헤더) → `approve?…&sub=me&result=ok` 200 HTML의 refresh 주소에서 `code`·`state` 추출 → `POST /api/sync/v1/session/social` 200(`sessionId` 43자, `user.sub === 'kakao:dev-me'`) → `sessions` 행에 `identity = 'kakao:dev-me'`이고 `id_hash`가 원문이 아님 → 그 세션으로 `GET /v1/sessions` 200. `sub=stranger` → 403 `{ error: 'not-allowed', account: 'kakao:dev-stranger' }`이고 세션 행 0. 요청 주소가 `https://landmark.sch0718.dev`면 가짜 경로 404이고 `providerStatus().devFake === false`. `result=down` → 503 `provider-unavailable`.
- [ ] **Step 3:** `yarn vitest run tests/unit/server/sync-schema.test.ts tests/unit/server/sync-auth.test.ts tests/unit/server/sync-dev-fake.test.ts tests/unit/server/meet-db.test.ts` → 실패 확인
- [ ] **Step 4:** 구현. 패키지 소스는 `node_modules/@sch0718/firebase-session/dist/worker/*.js`와 README를 본다. 가즈아·repass 저장소 체크아웃은 건드리지 않는다.
- [ ] **Step 5:** 시험 통과, `yarn typecheck`, `yarn vitest run tests/unit/server`(기존 서버 시험 포함)
- [ ] **Step 6:** 커밋 `feat(library-sync): 로그인 세션·D1 표·개발용 가짜 공급자와 진입점`

### Task 4: 서버 보관함 API — 요약·받기·올리기·정리·지우기

**Files:**
- Create: `src/server/library-sync/library.ts`
- Modify: `src/server/library-sync/router.ts`(경로 추가)
- Test: `tests/unit/server/sync-library.test.ts`

**Interfaces:**
- Consumes: Task 1(`decodeItem`, `mergeItem`, `isDeleted`, `stableStringify`, `tripRefs`, `lastTouched`, `itemKey`, `ITEM_KINDS`), Task 3 전부.
- Produces(`library.ts`):
  - 상수: `TOMBSTONE_KEEP_MS = 90 * 24 * 60 * 60 * 1000`, `PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000`, `PULL_MAX_LIMIT = 500`, `PUSH_MAX_ITEMS = 100`, `PUSH_MAX_BYTES = 1_000_000`, `CLOCK_SKEW_MS = 10 * 60 * 1000`, `DEVICE_TOUCH_MS = 60 * 60 * 1000`, `ACCOUNT_DATA_TABLES: string[] = ['library_items', 'library_devices', 'library_state']`.
  - `type MeReply = { userId: string; provider: SyncUser['provider']; account: string; library: { rev: number; items: number; live: number }; devices: { deviceId: string; sessionId: string; lastSyncAt: number }[] }`; `readMe(db: MeetDb, user: SyncUser): Promise<MeReply>`.
  - `type PullQuery = { since: number; after: string; limit: number; deviceId: string | null }`; `parsePullQuery(url: URL): PullQuery` — `since` 0 이상 정수(없으면 0), `after`는 `''` 또는 `^(label|place|folder|trip|meeting):[A-Za-z0-9]{1,64}$`, `limit` 1~500(없으면 500), `device` `^[a-z0-9]{16}$` 또는 null. 모르는 질의 키·형식 오류는 `SyncHttpError(422, 'invalid', { path })`.
  - `pullChanges(db: MeetDb, user: SyncUser, q: PullQuery, now: number): Promise<{ body: string; purgedAt: number } | { resync: number }>` — `library_state`가 없으면 빈 응답. `q.since > 0 && q.since < purged_rev`면 `{ resync: purged_rev }`. 질의:
    ```sql
    SELECT kind, item_id AS id, rev, deleted, doc FROM library_items
    WHERE user_id = ?1 AND (rev > ?2 OR (rev = ?2 AND (kind || ':' || item_id) > ?3))
    ORDER BY rev, kind || ':' || item_id
    LIMIT ?4
    ```
    (`?4 = limit + 1`). 본문은 행의 `doc` 문자열을 해석하지 않고 `'{"rev":R,"purgedRev":P,"more":M,"next":{"rev":N,"key":K},"items":[' + rows.map((r) => '{"kind":' + JSON.stringify(r.kind) + ',"id":' + JSON.stringify(r.id) + ',"rev":' + r.rev + ',"deleted":' + (r.deleted === 1) + ',"doc":' + r.doc + '}').join(',') + ']}'`로 만든다. `next`는 마지막 행(없으면 요청의 `since`·`after`). `more = rows.length > limit`. `more`가 false이고 `deviceId`가 있으면 기기 기록을 한 시간에 한 번만 갱신:
    ```sql
    INSERT INTO library_devices (user_id, device_id, session_id, last_rev, last_sync_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    ON CONFLICT(user_id, device_id) DO UPDATE SET session_id = excluded.session_id,
      last_rev = excluded.last_rev, last_sync_at = excluded.last_sync_at
    WHERE library_devices.session_id <> excluded.session_id
       OR library_devices.last_sync_at <= excluded.last_sync_at - 3600000
    ```
  - `type PushItem = { kind: ItemKind; id: string; baseRev: number; baseDeleted: boolean | null; doc: unknown }` — `baseDeleted === null`(이 기기가 처음 올림)은 `mergeItem`에 `undefined`로 넘긴다., `type PushBody = { v: 1; deviceId: string; items: PushItem[] }`, `parsePushBody(value: unknown): PushBody` — `v === 1`, `deviceId` 16자, `items` 1~100개, 같은 키 두 번 금지, `kind`는 `ITEM_KINDS`, `id` `^[A-Za-z0-9]{1,64}$`, `baseRev` 0 이상 정수, `baseDeleted` 불리언 또는 null. 실패는 422 `invalid`(`path` 예: `items.3.baseRev`). 남는 키 거부.
  - `type PushReply = { rev: number; results: { kind: ItemKind; id: string; rev: number; doc?: unknown }[]; rejected: { kind: ItemKind; id: string; reason: 'invalid' | 'too-large' | 'clock' }[] }`; `pushItems(db: MeetDb, user: SyncUser, body: PushBody, now: number): Promise<PushReply>` — 설계 §올리기(서버) 1~4. 세부:
    - 저장본 읽기: `SELECT kind, item_id AS id, rev, deleted, doc FROM library_items WHERE user_id = ?1 AND (kind || ':' || item_id) IN (SELECT value FROM json_each(?2))`, `R0 = (SELECT rev FROM library_state WHERE user_id = ?) ?? 0`.
    - 시각 검사: `lastTouched(doc)`와 `createdAt`이 `now + CLOCK_SKEW_MS`보다 늦으면 `clock`.
    - 쓰는 행 값: `doc`(= `stableStringify(결과)`, 문자열), `deleted`(0|1), `deletedAt`(새로 묘비가 되면 `now`, 이미 묘비면 저장본 값 유지는 SQL이 한다), `refs`(여행만 `',' + tripRefs(trip).join(',') + ','`, 그 밖 null).
    - 배치:
      ```sql
      INSERT INTO library_state (user_id, rev, purged_rev, purged_at, created_at, updated_at)
      VALUES (?1, 1, 0, 0, ?2, ?2)
      ON CONFLICT(user_id) DO UPDATE SET rev = library_state.rev + 1, updated_at = excluded.updated_at;

      INSERT INTO library_items (user_id, kind, item_id, rev, doc, deleted, deleted_at, refs, device_id, updated_at)
      SELECT ?1, json_extract(value, '$.kind'), json_extract(value, '$.id'),
             (SELECT rev FROM library_state WHERE user_id = ?1),
             json_extract(value, '$.doc'), json_extract(value, '$.deleted'),
             json_extract(value, '$.deletedAt'), json_extract(value, '$.refs'), ?2, ?3
      FROM json_each(?4) WHERE true
      ON CONFLICT(user_id, kind, item_id) DO UPDATE SET
        rev = excluded.rev, doc = excluded.doc, deleted = excluded.deleted,
        deleted_at = CASE WHEN excluded.deleted = 0 THEN NULL
                          WHEN library_items.deleted = 1 THEN library_items.deleted_at
                          ELSE excluded.deleted_at END,
        refs = excluded.refs, device_id = excluded.device_id, updated_at = excluded.updated_at
      WHERE library_items.rev <= ?5;

      SELECT rev FROM library_state WHERE user_id = ?1;
      ```
      (`?2` = deviceId·`now`처럼 문장마다 맞춰 바인드한다. 위 번호는 문장 안 기준.) 두 번째 문장의 `meta.changes`가 쓸 항목 수보다 작으면 처음부터 다시(최대 3번), 그래도 모자라면 `SyncHttpError(409, 'busy')`.
    - 결과: 쓴 항목은 새 `rev`, 쓰지 않은 항목(결과가 저장본과 같음)은 저장본 `rev`. `doc`은 결과가 올린 `stableStringify(doc)`와 다를 때만.
  - `purgeTombstones(db: MeetDb, userId: string, now: number): Promise<number>` — 설계 §묘비 90일:
    ```sql
    SELECT i.kind, i.item_id AS id, i.rev FROM library_items i
    WHERE i.user_id = ?1 AND i.deleted = 1 AND i.deleted_at <= ?2
      AND NOT (i.kind = 'place' AND EXISTS (
        SELECT 1 FROM library_items t WHERE t.user_id = ?1 AND t.kind = 'trip'
          AND instr(t.refs, ',' || i.item_id || ',') > 0))
    ORDER BY i.deleted_at LIMIT 500
    ```
    (`?2 = now - TOMBSTONE_KEEP_MS`) → 배치 `DELETE FROM library_items WHERE user_id = ? AND (kind || ':' || item_id) IN (SELECT value FROM json_each(?))` + `UPDATE library_state SET purged_rev = max(purged_rev, ?), purged_at = ? WHERE user_id = ?`. 지울 것이 없어도 `purged_at`은 갱신. 지운 수를 돌려준다.
  - `deleteAccountData(db: MeetDb, userId: string): Promise<void>` — 한 배치: `ACCOUNT_DATA_TABLES`마다 `DELETE FROM <표> WHERE user_id = ?`, `DELETE FROM sessions WHERE user_id = ?`, `DELETE FROM users WHERE id = ?`. 표 이름은 상수 배열에서만 온다(문자열 끼워 넣기는 그 배열만 허용).
- Produces(라우터 경로 추가):
  - `GET /v1/me` → `requireSyncUser` → `200 MeReply`
  - `GET /v1/library/changes` → `requireSyncUser` → `consumeCounter(counterKey('sync-pull', userId, now), 1, 5000)`(넘으면 429) → `pullChanges` → `{ resync }`면 `410 { error: 'resync', purgedRev }`, 아니면 `body`를 그대로 `200`. 그 뒤 돌려받은 `purgedAt <= now - PURGE_INTERVAL_MS`이고 `library_state`가 있으면 `waitUntil(purgeTombstones(db, userId, now))`.
  - `POST /v1/library/push` → `requireSyncUser` → `readJson(request, PUSH_MAX_BYTES)`(넘으면 413 `too-large`) → `parsePushBody` → `consumeCounter('sync-push', 1, 2000)` → `consumeCounter('sync-items', items.length, 30000)` → `pushItems` → `200 PushReply`
  - `DELETE /v1/account`(`allowWhenOff`) → `requireSyncUser` → 본문 `{ confirm: 'delete' }`가 아니면 422 → `deleteAccountData` → `204`
- [ ] **Step 1: 실패하는 시험** — `sync-library.test.ts`(`// @vitest-environment node`, `createSqliteD1()`, 세션은 Task 3의 가짜 소셜 로그인 도우미로 만든 사용자 둘 `kakao:dev-me`·`naver:dev-me`, `ALLOWED_ACCOUNTS`에 둘 다): 
  - 올리기: 새 장소 2개 → `rev` 1·결과 rev 1·`doc` 없음, 같은 내용 다시 → 쓰지 않음(`library_state.rev` 그대로, 결과 rev 1), `baseRev === 저장본 rev`면 올린 값 그대로(오래된 메모라도), `baseRev`가 오래됐으면 병합하고 결과에 `doc`, 묘비 올리면 `deleted_at = now`·되살리면 NULL, 잘못된 문서 `rejected: invalid`, 20만 자 넘는 여행 `too-large`, 11분 뒤 시각 `clock`, 101개 422, 같은 키 두 번 422, 1,000,001바이트 413, 사용자 B가 같은 id를 올려도 A 행이 바뀌지 않음(격리), 두 요청의 저장본 읽기 뒤 끼어든 쓰기(가짜 DB의 `batch`를 한 번 가로채 다른 사용자 쓰기 대신 같은 사용자 같은 키의 rev를 올리는 문장을 먼저 실행)에서 재시도해 최종 문서가 두 쪽 병합인지.
  - 받기: 빈 사용자 `items: []`, `since`·`after` 쪽 나누기(`limit=2`로 5개를 세 번), 같은 `rev` 안 키 순서, 응답 `items[].doc`이 객체(문자열 아님), `purged_rev`보다 작은 `since`면 410, `since=0`은 410 아님, 기기 기록이 처음 생기고 한 시간 안 두 번째 받기에는 바뀌지 않음, 하루 5,001번째 429.
  - 정리: 91일 지난 묘비 지움·89일은 남음·여행 `refs`에 있는 장소 묘비 남음·`purged_rev`가 지운 최대 rev, 받기에서 하루 한 번만 `waitUntil`로 부름.
  - 요약: `items`·`live` 수, 기기 목록.
  - 계정 지우기: 204 뒤 A의 모든 표 행 0·세션 0·users 0, B 행은 그대로, 그 세션으로 `GET /v1/me` 401, `confirm` 없으면 422, `LIBRARY_SYNC=off`에서도 동작.
  - `DELETE /v1/session` 뒤 그 세션의 `library_devices` 행이 지워짐.
- [ ] **Step 2:** `yarn vitest run tests/unit/server/sync-library.test.ts` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`, `yarn vitest run tests/unit/server`
- [ ] **Step 5:** 커밋 `feat(library-sync): 보관함 받기·올리기·묘비 정리·계정 자료 지우기 API`

### Task 5: 브라우저 기록·API·로그인

**Files:**
- Create: `src/services/library-sync/storage.ts`, `src/services/library-sync/config.ts`, `src/services/library-sync/api.ts`, `src/services/library-sync/login.ts`
- Modify: `src/vite-env.d.ts`(변수 타입)
- Test: `tests/unit/services/library-sync-storage.test.ts`, `tests/unit/services/library-sync-config.test.ts`, `tests/unit/services/library-sync-api.test.ts`, `tests/unit/services/library-sync-login.test.ts`

**Interfaces:**
- Consumes: Task 2 타입(`BaseEntry`, `BaseMap`, `Conflict`, `HeldItem`), 패키지 `@sch0718/firebase-session/client`(`createSessionClient`, `readSyncConfig`, `firebaseAuth`, `beginSocialSignIn`, `readSocialCallback`, 타입 `AuthClient`·`SessionClient`·`BaseFail`·`Fail`·`FirebaseConfig`·`SocialProvider`·`DeviceSession`).
- Produces(`storage.ts`, **런타임 import 없음 — 타입만**):
  - 키 상수 `SYNC_META_KEY = 'tripmap:sync:v1'`, `SYNC_BASE_KEY = 'tripmap:sync-base:v1'`, `SYNC_CONFLICTS_KEY = 'tripmap:sync-conflicts:v1'`, `SYNC_SESSION_KEY = 'tripmap:sync-session:v1'`.
  - `type SyncProvider = 'google' | 'kakao' | 'naver'`, `type SyncCursor = { rev: number; key: string }`, `type RejectedItem = { key: string; hash: string; reason: 'invalid' | 'too-large' | 'clock' }`.
  - ```ts
    export type SyncMeta = {
      v: 1;
      enabled: boolean;
      pendingChoice: boolean;
      userId: string | null;
      provider: SyncProvider | null;
      accountLabel: string | null;
      deviceId: string;
      cursor: SyncCursor | null;
      lastSyncAt: string | null;
      held: HeldItem[];
      skipped: string[];
      rejected: RejectedItem[];
    };
    ```
  - `readSyncMeta(storage: Storage): SyncMeta` — 없거나 깨지면 `newDeviceMeta()`(쓰지 않음). `newDeviceMeta(): SyncMeta`는 `deviceId` 16자 a-z0-9(`crypto.getRandomValues`, `src/services/id-gen.ts`와 같은 편향 없는 방식).
  - `writeSyncMeta(storage: Storage, meta: SyncMeta): void` — 실패하면 `SyncStorageError`(`class SyncStorageError extends Error`)를 던진다.
  - `encodeBaseEntry(e: BaseEntry): string`(`<rev36>.<hash>` + 묘비면 `.d`), `decodeBaseEntry(s: string): BaseEntry | null`.
  - `readBase(storage): { userId: string | null; items: BaseMap }`, `writeBase(storage, userId: string, items: BaseMap): void`, `clearSyncRecords(storage): void`(base·충돌 키 지움, 메타의 `cursor`·`lastSyncAt`·`held`·`skipped`·`rejected` 비움).
  - `readConflicts(storage): Conflict[]`, `writeConflicts(storage, items: Conflict[]): void` — 최신 50건, `JSON.stringify` 길이 200,000 넘으면 오래된 것부터 버림.
  - `type StoredSession = { v: 1; sessionId: string; provider: SyncProvider }`, `readSession(storage): StoredSession | null`(형식 `^[A-Za-z0-9_-]{43}$` 아니면 null), `writeSession(storage, s)`, `clearSession(storage)`.
- Produces(`config.ts`):
  - `type SyncClientConfig = { apiBase: string; firebase: FirebaseConfig | null; kakao: { clientId: string } | null; naver: { clientId: string } | null; devFake: boolean }`.
  - `readSyncClientConfig(env: Record<string, string | boolean | undefined>, origin: string): SyncClientConfig | null` — `apiBase = origin + '/api/sync'`. `firebase = readSyncConfig({ ...env, VITE_SYNC_API_URL: apiBase })?.firebase ?? null`. `devFake = import.meta.env.DEV && env.VITE_SYNC_DEV_FAKE === '1'`; 가짜면 `kakao = { clientId: 'dev-fake-kakao' }`, `naver = { clientId: 'dev-fake-naver' }`(이 문자열은 `import.meta.env.DEV &&` 분기 안에만 둔다), 아니면 `VITE_KAKAO_LOGIN_CLIENT_ID`·`VITE_NAVER_LOGIN_CLIENT_ID`(trim, 비면 null). 셋 다 없으면 null.
- Produces(`api.ts`):
  - `type SyncFail = BaseFail | { ok: false; kind: 'resync'; purgedRev: number } | { ok: false; kind: 'busy' } | { ok: false; kind: 'off' }`. `mapStatus`: 410 `resync` → `resync`, 409 `busy` → `busy`, 503 `off` → `off`.
  - 응답 타입 `StatusReply`, `MeReply`, `PullReply = { rev: number; purgedRev: number; more: boolean; next: SyncCursor; items: RemoteItem[] }`, `PushRequest = { v: 1; deviceId: string; items: { kind; id; baseRev; baseDeleted; doc }[] }`, `PushReply`(Task 4와 같은 모양).
  - ```ts
    export type SyncApi = {
      client: SessionClient<Extract<SyncFail, { kind: 'resync' | 'busy' | 'off' }>>;
      status(): Promise<ApiResult<StatusReply, SyncFail>>;
      me(): Promise<ApiResult<MeReply, SyncFail>>;
      changes(q: { since: number; after: string; limit: number; deviceId: string }): Promise<ApiResult<PullReply, SyncFail>>;
      push(body: PushRequest): Promise<ApiResult<PushReply, SyncFail>>;
      deleteAccount(): Promise<ApiResult<unknown, SyncFail>>;
    };
    export function createSyncApi(opts: {
      config: SyncClientConfig;
      storage: Storage;
      /** Google 사용자만. 소셜·로그아웃이면 null */
      auth: AuthClient | null;
      fetch?: typeof fetch;
    }): SyncApi;
    ```
    `createSessionClient({ baseUrl: config.apiBase, sessionHeader: 'X-Landmark-Session', allowSessionOnly: true, credentials: { idToken: (force) => (readSession(storage)?.provider === 'google' && auth ? auth.idToken(force) : Promise.resolve(null)), sessionId: async () => readSession(storage)?.sessionId ?? null }, mapStatus, fetch })`. `status()`는 `auth: 'none'`.
  - `googleAuth(config: SyncClientConfig): AuthClient | null` — `config.firebase`가 있으면 `firebaseAuth(config.firebase)`(SDK는 부를 때 받는다).
- Produces(`login.ts`):
  - `type LoginOutcome = { ok: true; provider: SyncProvider; next: 'resume' | 'choose' } | { ok: false; reason: 'not-allowed'; account?: string; email?: string } | { ok: false; reason: 'cancelled' | 'mismatch' | 'expired' | 'provider-error' | 'no-pending' | 'limit' | 'offline' | 'auth' | 'server' | 'off' | 'storage' }`.
  - `AUTH_CALLBACK_PATH = '/auth/callback'`(boot와 같은 값을 `callback-capture.ts`에서 가져온다).
  - `deviceLabel(ua: string): string` — 기기(`iPhone`·`iPad`·`Android`·`Mac`·`Windows`·`Linux`, 모르면 `기기`) + ` · ` + 브라우저(`카카오톡`(`KAKAOTALK`)·`네이버`(`NAVER(inapp`)·`Edge`·`Chrome`·`Firefox`·`Safari`, 모르면 `브라우저`). 40자 안.
  - `fakeAuthorizeUrl(realUrl: string, origin: string): string` — repass `fakeAuthorizeUrl`과 같고 경로는 `origin + '/api/sync/dev/fake-social/authorize'`.
  - `startSocialLogin(provider: 'kakao' | 'naver', config: SyncClientConfig, opts?: { navigate?: (url: string) => void; storage?: Storage; origin?: string }): Promise<void>` — `beginSocialSignIn(provider, { clientId, redirectUri: origin + AUTH_CALLBACK_PATH, navigate: config.devFake ? (url) => nav(fakeAuthorizeUrl(url, origin)) : nav, storage })`. 시작 전에 `tripmap:sync-return`(sessionStorage 아님, localStorage)에 `'/settings#sync'`을 둔다.
  - `finishSocialLogin(api: SyncApi, href: string, storage: Storage, label: string): Promise<LoginOutcome>` — `readSocialCallback(href, { storage })`(null이면 `no-pending`, 실패 이유는 `redirect-mismatch`→`mismatch`, `state-mismatch`→`mismatch`, 나머지 같은 이름) → `api.client.createSocialSession(cb, label)` → 실패 매핑(`not-allowed`는 `account` 포함, `limit` 코드 `off`면 `off`) → `writeSession` → `afterLogin`.
  - `googleLogin(api: SyncApi, auth: AuthClient, storage: Storage, label: string): Promise<LoginOutcome>` — `auth.signIn()`(null이면 `cancelled`, `'redirect'`면 페이지가 떠나므로 메타에 아무것도 쓰지 않고 끝나지 않는 `new Promise(() => {})`를 돌려준다), 성공 → `api.client.createSession(idToken, label)` → 403이면 `auth.signOut()` 뒤 `{ reason: 'not-allowed', email }` → `writeSession({ provider: 'google' })` → `afterLogin`. `googleRedirectResult(api, auth, storage, label)`도 같은 처리(설정 화면이 열릴 때 부른다).
  - `afterLogin(api: SyncApi, storage: Storage, provider: SyncProvider): Promise<LoginOutcome>` — `api.me()` → 메타의 `userId`와 base의 `userId`가 모두 `me.userId`와 같고 base가 비어 있지 않으면 `{ enabled: true, pendingChoice: false }`·`next: 'resume'`, 아니면 `clearSyncRecords` 뒤 `{ enabled: true, pendingChoice: true, userId: me.userId }`·`next: 'choose'`. `provider`·`accountLabel`(`me.account`, 소셜은 `카카오 계정`/`네이버 계정`)도 쓴다.
- [ ] **Step 1: 실패하는 시험** — storage: 기본 메타·깨진 JSON·deviceId 형식, base 항목 인코딩 왕복(묘비 포함)·깨진 항목 버림, 충돌 50건·20만 자 상한, 세션 형식 검사, 저장소 `setItem`이 던지면 `SyncStorageError`. config: 아무 변수 없음 null, 카카오만, Firebase 넷 중 하나 빠지면 `firebase: null`, `VITE_SYNC_DEV_FAKE=1`은 `vi.stubEnv('DEV', true)`일 때만 가짜. api(가짜 `fetch`): 경로·`X-Landmark-Session` 헤더·`credentials: 'omit'`, Google 세션이면 `Authorization`도, 410·409·503 off 매핑, `status()`는 세션 헤더 없음. login: `deviceLabel` 표(아이폰 사파리·안드 크롬·맥 크롬·카카오톡 인앱), `fakeAuthorizeUrl`, `startSocialLogin`이 가짜일 때 가짜 주소로 이동, `finishSocialLogin` 성공(세션 저장·`choose`), 같은 사용자·base 있음이면 `resume`, 다른 사용자면 base 지움, `not-allowed` 계정 값, 콜백 없음 `no-pending`, state 다름 `mismatch`.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/library-sync-*.test.ts` → 실패 확인
- [ ] **Step 3:** 구현. `src/vite-env.d.ts`에 `VITE_FIREBASE_API_KEY`·`VITE_FIREBASE_AUTH_DOMAIN`·`VITE_FIREBASE_PROJECT_ID`·`VITE_FIREBASE_APP_ID`·`VITE_KAKAO_LOGIN_CLIENT_ID`·`VITE_NAVER_LOGIN_CLIENT_ID`·`VITE_SYNC_DEV_FAKE`(모두 `readonly …?: string`)를 더한다.
- [ ] **Step 4:** 시험 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library-sync): 동기화 기록·API 클라이언트·로그인`

### Task 6: 동기화 엔진과 상태

**Files:**
- Create: `src/stores/sync-status.ts`, `src/services/library-sync/sync-engine.ts`
- Test: `tests/unit/services/library-sync-engine.test.ts`, `tests/unit/stores/sync-status.test.ts`

**Interfaces:**
- Consumes: Task 2(`applyRemote`, `applyPushResults`, `dirtyItems`, `missingFromLocal`, `BaseMap`, `Conflict`), Task 1(`listItems`, `getItem`, `putItems`, `itemLabel`, `hashItem`, `ITEM_DOC_MAX_CHARS`, `stableStringify`), Task 5 전부, `LibraryStore`(`src/services/library-store.ts`: `update`, `snapshot`, `replace`), `IdGen`, `startEffect`(`src/lib/effect/runtime.ts`), `libraryAtom`(`src/stores/library-state.ts`), `hasAnyEntry`(`src/domain/backup/summary.ts`), `setField`(`lww.ts`), `restorePlaces`·`restoreTrip`·`restoreMeeting`은 쓰지 않는다(되살림은 아래 `reviveAsLatest`).
- Produces(`sync-status.ts`, 첫 로딩 — 런타임 import는 `jotai`만):
  ```ts
  export type SyncPhase = 'off' | 'pending-choice' | 'local' | 'syncing' | 'synced' | 'conflict'
    | 'auth' | 'not-allowed' | 'unavailable' | 'error';
  export type SyncStatus = {
    phase: SyncPhase;
    dirty: number;
    conflicts: number;
    held: number;
    rejected: number;
    offline: boolean;
    lastSyncAt: string | null;
    progress: { step: 'pull' | 'push'; done: number; total: number } | null;
    message: string | null;
  };
  export const OFF_STATUS: SyncStatus;
  export const syncStatusAtom: PrimitiveAtom<SyncStatus>;
  export function syncPhaseText(phase: SyncPhase): string; // 설계 §화면 상태 표의 굵은 문구
  ```
- Produces(`sync-engine.ts`):
  ```ts
  export type SyncRunReason = 'open' | 'visible' | 'save' | 'online' | 'manual' | 'connect' | 'retry';
  export type ConnectMode = 'upload' | 'merge' | 'replace-local';
  export type EngineDeps = {
    api: SyncApi;
    storage: Storage;
    locks?: LockManager;
    runLibrary<A, E>(effect: Effect.Effect<A, E, LibraryStore | IdGen>): Promise<A>;
    setLibrary(lib: Library): void;
    setStatus(status: SyncStatus): void;
    notify(kind: 'conflict' | 'auth'): void;
    now(): number;
    online(): boolean;
    visible(): boolean;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
    events?: EventTarget; // window. 없으면 이벤트를 구독하지 않는다
    newConflictId(): string;
  };
  export interface LibrarySyncEngine {
    start(): void;
    stop(): void;
    schedule(reason: SyncRunReason): void;
    runNow(reason: SyncRunReason): Promise<SyncStatus>;
    connect(mode: ConnectMode): Promise<SyncStatus>;
    resolveConflict(id: string, action: 'mine' | 'keep'): Promise<void>;
    resolveHeld(key: string, action: 'mine' | 'skip'): Promise<void>;
    disable(): void;
    enable(): void;
    disconnect(): Promise<void>;
    deleteServerData(): Promise<boolean>;
    onRunFinished(listener: (status: SyncStatus) => void): () => void;
    /** 엔진이 `setLibrary`로 넣은 바로 그 문서(`===`)인가. 부트 훅이 자기 반영을 저장으로 오인하지 않게 한다. */
    isOwnWrite(lib: Library): boolean;
  }
  export function createLibrarySyncEngine(deps: EngineDeps): LibrarySyncEngine;
  /** 앱 기본 의존(기본 jotai 저장소·startEffect·window·navigator.locks·sonner 알림)으로 하나만 만든다. */
  export function ensureLibrarySyncEngine(): LibrarySyncEngine;
  export const SAVE_DEBOUNCE_MS = 2000;
  export const RETRY_STEPS_MS = [30_000, 120_000, 600_000] as const;
  export const SYNC_LOCK = 'tripmap:library-sync';
  export const PUSH_CHUNK_ITEMS = 100;
  export const PUSH_CHUNK_BYTES = 900_000;
  ```
  - `runNow`: `locks?.request(SYNC_LOCK, …)` 안에서 설계 §한 번의 실행 1~4. 메타가 `enabled`가 아니거나 `pendingChoice`면 아무것도 안 하고 그 상태를 돌려준다. 세션이 없으면 `auth`. `online()`이 false면 `local`(`offline: true`).
    - 받기: `cursor ?? { rev: 0, key: '' }`부터 `api.changes({ since, after, limit: 500, deviceId })` 반복. `resync` 실패면 한 번만 `{0,''}`부터 다시, `fullResync = true`. 시작 전에 `missingFromLocal`이면 `fullResync = true`, 커서 `{0,''}`.
    - 반영: `runLibrary(LibraryStore.update((current) => …))` 안에서 `applyRemote(current, base, items, { ctx: { now, newId: ids.next }, lastSyncAt: meta.lastSyncAt, fullResync, conflictId, skip: new Set(meta.skipped) })`. 결과 `lib`을 돌려 `setLibrary`. 받은 것이 없고 `fullResync`도 아니면 이 단계를 건너뛴다.
    - 커서: 마지막 `next`. `held`가 있으면 `{ rev: min(held.rev) - 1, key: '' }`(0 미만이면 0).
    - 올리기: `runLibrary(LibraryStore.snapshot)`의 `library`로 `dirtyItems(lib, base, meta.rejected)` → `stableStringify(doc).length > ITEM_DOC_MAX_CHARS`는 보내지 않고 `rejected: too-large`. `PUSH_CHUNK_ITEMS`·`PUSH_CHUNK_BYTES`로 나눠 차례로 `api.push`. 응답마다 `applyPushResults`를 `LibraryStore.update` 안에서, `rejected`는 메타에 `{ key, hash, reason }`. `progress`를 갱신한다.
    - 끝: 메타(`cursor`, `lastSyncAt = new Date(now()).toISOString()`, `held`, `rejected`), base(`writeBase`), 충돌(기존 + 새 것 `writeConflicts`)을 쓴다. 상태: 충돌·보류·거절이 하나라도 있으면 `conflict`, 아니면 `synced`. 새 충돌이 생겼으면 `notify('conflict')`.
    - 실패: `offline` → `local`(`offline: true`); `auth` → `clearSession`·`auth`·`notify('auth')`; `not-allowed` → `clearSession`·`not-allowed`; `limit`·`off`·`server`·`busy` → `unavailable`(busy는 `local`)이고 `visible()`일 때 `RETRY_STEPS_MS` 차례로 `retry` 예약; `SyncStorageError`·`StorageQuotaExceeded` → `error`(문구 "저장 공간이 부족해 동기화를 멈췄어요"). 실패해도 보관함·base는 마지막 성공 상태를 유지한다.
  - `schedule`: `save`는 `SAVE_DEBOUNCE_MS` 모음, 나머지는 바로. 실행 중이면 끝난 뒤 한 번 더(여러 번 불려도 한 번).
  - `start`: `events`에 `visibilitychange`(보이면 `visible`), `online` 구독, `schedule('open')`. `stop`: 구독·타이머 해제.
  - `connect(mode)`: 메타 `pendingChoice`일 때만. `replace-local`: 커서 0부터 모두 받아 `putItems(emptyLibrary(), …)`로 보관함을 만들고 `repairLibrary` 뒤 `LibraryStore.replace(lib, { requirePrevious: hasAnyEntry(지금) })`, base = 받은 항목 전부. `upload`·`merge`: `pendingChoice = false` 뒤 `runNow('connect')`(받기 → 합치기 → 올리기가 같은 길이다. 첫 연결이라 `lastSyncAt === null`이므로 충돌은 생기지 않는다).
  - `resolveConflict(id, 'mine')`: 그 충돌의 항목을 `LibraryStore.update`로 고친다 — 필드 충돌은 `path`의 필드를 `{ value: mine, updatedAt: now }`로(여행 Day 경로 `days.<i>.<필드>` 포함), `whole`·`deleted`는 `reviveAsLatest(kind, mine, now)`(문서 안 모든 `updatedAt`을 `now`로, `deletedAt: null`). 결과가 `LibrarySchema`를 못 지나면 충돌을 남기고 실패 알림. 성공·`keep`이면 목록에서 지우고 `schedule('manual')`.
  - `resolveHeld(key, 'mine')`: 이 기기 항목을 `reviveAsLatest`로 바꿔 올리게 하고 `held`에서 뺀다(항목이 없으면 `skip`과 같음). `'skip'`: `skipped`에 키를 더하고 `held`에서 뺀다.
  - `disable()`: 메타 `enabled: false`, `stop()`, 상태 `off`. `enable()`: `enabled: true`, `start()`.
  - `disconnect()`: `api.client.endSession()`(실패해도 계속) → `clearSession` → 메타 `enabled: false`(base·커서·`userId`는 남김) → `off`.
  - `deleteServerData()`: `api.deleteAccount()` 성공이면 `clearSession`·`clearSyncRecords`·메타 `enabled: false, userId: null` → `off`·true. 실패면 false.
  - `ensureLibrarySyncEngine()`: `getDefaultStore()`로 `libraryAtom`·`syncStatusAtom`을 쓰고, `runLibrary = startEffect`, `notify`는 `sonner`의 `toast('다른 기기 변경과 겹친 항목이 있어요', { action: { label: '확인', onClick: () => location.assign('/settings#sync') } })`/`toast('동기화 로그인이 끊겼어요')`. `api`는 `createSyncApi({ config: readSyncClientConfig(import.meta.env, location.origin)!, storage: localStorage, auth: googleAuth(config) })`. 설정이 없으면 엔진은 늘 `off`.
- [ ] **Step 1: 실패하는 시험** — `sync-status.test.ts`: `syncPhaseText` 네 핵심 문구(`이 기기에 저장됨`·`동기화 중`·`동기화 완료`·`확인 필요한 충돌`). `library-sync-engine.test.ts`: 진짜 서버 처리 코드(**`tests/helpers/sync-memory-server.ts`를 만들어 Task 4 `handleSync`를 `createSqliteD1()` 위에서 부르는 `fetch`를 `createSyncApi`에 넣는다**. 이 도우미는 Task 9 E2E도 쓴다), `LibraryStore.layerWith({ storage: 메모리, locks: tests/fixtures/fake-locks.ts })`, 가짜 타이머. 사례: 꺼진 메타면 요청 0, 첫 연결 `upload` 뒤 서버에 모든 항목·상태 `synced`·base 크기 = 항목 수, 두 엔진(기기 A·B, 같은 서버·다른 저장소) A 메모 수정 → B `runNow('open')` 뒤 B 보관함 반영, B 오프라인(`online: false`)이면 요청 0·`local`·`offline`, 저장 2초 모음(세 번 `schedule('save')`에 실행 한 번), 실행 중 `schedule`이면 끝난 뒤 한 번 더, 충돌 흐름(B 오프라인 수정 → A 나중 수정·올림 → B 온라인 실행 → 충돌 1·상태 `conflict`·`notify('conflict')` 한 번 → `resolveConflict(id,'mine')` → B 실행 뒤 A 실행에서 A 메모 = B 값), 410 전체 재동기화(서버에서 묘비를 강제로 지우고 `purged_rev` 올림 → B 보관함의 그 장소 묘비), 401이면 세션 지움·`auth`, `replace-local`이 되살리기 사본을 남김(`LibraryStore.previous`가 null 아님), 올리는 사이 수정(가짜 fetch가 push 중에 `LibraryStore.update`로 메모를 바꿈) → 다음 실행에서 그 메모가 올라감, 다른 사용자로 로그인한 메타는 base를 지운 상태에서 시작, `disconnect`가 `DELETE /v1/session`을 부르고 base를 남김, `deleteServerData` 뒤 메타 `userId: null`.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/library-sync-engine.test.ts tests/unit/stores/sync-status.test.ts` → 실패 확인
- [ ] **Step 3:** 구현(`tests/helpers/sync-memory-server.ts` 포함: `createSyncMemoryServer(env?: Partial<SyncEnv>): { fetch: typeof fetch; handle(request: Request): Promise<Response | null>; db: MeetDb & { close(): void }; login(sub?: string): Promise<string> }` — `login(sub = 'me')`은 Task 3 시험의 가짜 소셜 흐름(인가 → 승인 → `POST /v1/session/social`)을 함수로 만든 것이고 세션 원문을 돌려준다. 시험은 그 값을 `writeSession`으로 기기 저장소에 넣는다)
- [ ] **Step 4:** 시험 통과, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(library-sync): 동기화 엔진과 상태`

### Task 7: 부트·콜백·라우트(첫 로딩)

**Files:**
- Create: `src/services/library-sync/boot.ts`, `src/services/library-sync/callback-capture.ts`, `src/sections/library-sync/use-sync-boot.ts`, `src/sections/library-sync/AuthCallbackPage.tsx`
- Modify: `src/main.tsx`(렌더 전 `captureAuthCallback()`), `src/sections/shell/ShellRoute.tsx`(`LibraryShell`에서 `useSyncBoot()`), `src/routes/paths.ts`(`authCallback: '/auth/callback'`), `src/routes/lazy-routes.ts`(`loadAuthCallbackPage`·`AuthCallbackPage`), `src/routes/router.tsx`(셸 자식 경로), `public/_headers`, `vite.config.ts`(`firebaseAuthHelper()`)
- Test: `tests/unit/services/library-sync-boot.test.ts`, `tests/unit/sections/library-sync/auth-callback.test.tsx`, `tests/unit/sections/library-sync/use-sync-boot.test.tsx`

**Interfaces:**
- Consumes: Task 5(`readSyncClientConfig`, `createSyncApi`, `finishSocialLogin`, `deviceLabel`), Task 6(`ensureLibrarySyncEngine`), `lazyChunk`(`src/lib/lazy-chunk.ts`), `libraryAtom`.
- Produces:
  - `boot.ts`(첫 로딩, 런타임 import는 `src/lib/lazy-chunk`만):
    ```ts
    /** `tripmap:sync:v1`의 enabled가 true이고 pendingChoice가 true가 아닌가. 읽기만 한다. 깨지면 false. */
    export function readBootFlag(storage?: Storage): boolean;
    /** 설정 › 동기화 절을 보일까: 로그인 빌드 변수가 하나라도 있거나 개발 가짜가 켜짐 */
    export function syncFeatureVisible(env?: Record<string, string | boolean | undefined>): boolean;
    export const loadSyncEngine: () => Promise<typeof import('src/services/library-sync/sync-engine')>;
    export const loadSyncSection: () => Promise<typeof import('src/sections/library-sync/SyncSection')>;
    ```
    `syncFeatureVisible`: Firebase 네 변수 모두 있음 || `VITE_KAKAO_LOGIN_CLIENT_ID` || `VITE_NAVER_LOGIN_CLIENT_ID` || (`import.meta.env.DEV && VITE_SYNC_DEV_FAKE === '1'`).
  - `callback-capture.ts`(첫 로딩, import 없음): `AUTH_CALLBACK_PATH = '/auth/callback'`, `captureAuthCallback(loc: Location = window.location, history: History = window.history): void` — 경로가 같고 질의에 `code` 또는 `error`가 있으면 `loc.href`를 모듈 변수에 두고 `history.replaceState(history.state, '', AUTH_CALLBACK_PATH)`. `takeCapturedCallback(): string | null`(한 번 읽으면 비움).
  - `use-sync-boot.ts`: `useSyncBoot(): void` — 마운트 때 `readBootFlag()`면 `loadSyncEngine().then((m) => m.ensureLibrarySyncEngine().start())`. `useStore().sub(libraryAtom, …)`로 바뀔 때마다 `readBootFlag()`가 참이고 엔진이 받아졌고 `!engine.isOwnWrite(새 문서)`이면 `engine.schedule('save')`. 언마운트 때 구독 해제(엔진은 멈추지 않는다 — 셸은 앱 동안 하나).
  - `AuthCallbackPage.tsx`: `takeCapturedCallback() ?? location.href`로 `finishSocialLogin`(`deviceLabel(navigator.userAgent)`) → 성공이면 `localStorage['tripmap:sync-return']`(없으면 `/settings#sync`)로 `navigate(…, { replace: true })`하고 그 키를 지움. `resume`이면 `loadSyncEngine().then((m) => m.ensureLibrarySyncEngine().start())`(엔진은 정적으로 가져오지 않는다). 실패 화면 문구: `not-allowed` "이 계정은 아직 동기화를 쓸 수 없어요" + 계정 값 + `복사` 단추 + "관리자에게 이 값을 알려 주세요", `cancelled` "로그인을 취소했어요", `mismatch`·`no-pending`·`expired` "이 브라우저에서 시작한 로그인이 아니거나 시간이 지났어요. 다시 로그인해 주세요", `limit`·`server`·`offline` "잠시 뒤 다시 해 주세요", `off` "지금은 동기화를 쓸 수 없어요". 모두 `설정으로 돌아가기` 링크. 진행 중 "로그인하는 중…".
  - 라우트: `{ path: paths.authCallback, element: lazyElement(<AuthCallbackPage />, 'auth-callback') }`를 셸 자식에 더한다. `ROUTE_CHUNKS`에는 넣지 않는다(동기화 사용자만).
  - `public/_headers` 끝에:
    ```
    /auth/callback
      Referrer-Policy: no-referrer
    ```
  - `vite.config.ts` 플러그인 목록에 `firebaseAuthHelper()`(`@sch0718/firebase-session/vite`). `VITE_FIREBASE_AUTH_DOMAIN`이 비면 아무것도 하지 않는다(패키지 동작). `firebaseCsp()`는 넣지 않는다(이 앱 `index.html`에 CSP 메타가 없다).
- [ ] **Step 1: 실패하는 시험** — boot: `readBootFlag`(없음·깨짐·`enabled:false`·`pendingChoice:true` false, 정상 true, 저장소가 던져도 false), `syncFeatureVisible` 표. callback: `captureAuthCallback`이 코드 있는 주소를 `/auth/callback`으로 바꾸고 `takeCapturedCallback`이 한 번만 돌려줌, 다른 경로는 그대로. auth-callback 화면(가짜 `finishSocialLogin` 모듈 `vi.mock`): 성공 → `/settings#sync`로 이동, `not-allowed` → 계정 값·복사 단추, `mismatch` 문구. use-sync-boot: 꺼진 사용자는 `loadSyncEngine`을 부르지 않음(`vi.mock`으로 셈), 켜진 사용자는 `start` 한 번, `libraryAtom`을 바꾸면 `schedule('save')`, 엔진이 넣은 문서(`isOwnWrite`가 참)면 부르지 않음.
- [ ] **Step 2:** `yarn vitest run tests/unit/services/library-sync-boot.test.ts tests/unit/sections/library-sync/auth-callback.test.tsx tests/unit/sections/library-sync/use-sync-boot.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 시험 통과, `yarn typecheck`, `yarn build && yarn size --require-lazy AuthCallbackPage --require-lazy sync-engine`(첫 로딩 예산 안. 빌드가 `INEFFECTIVE_DYNAMIC_IMPORT`로 실패하면 정적 import를 찾아 없앤다)
- [ ] **Step 5:** 커밋 `feat(library-sync): 동기화 부트·로그인 콜백 화면`

### Task 8: 설정 › 동기화 화면

**Files:**
- Create: `src/sections/library-sync/SyncSection.tsx`, `src/sections/library-sync/SyncConnectDialog.tsx`, `src/sections/library-sync/SyncConflictsDialog.tsx`, `src/sections/library-sync/SyncDevices.tsx`, `src/sections/library-sync/SyncDeleteDialog.tsx`, `src/sections/library-sync/sync-copy.ts`(문구 상수)
- Modify: `src/sections/settings/SettingsPage.tsx`(`syncFeatureVisible()`일 때 `<Section title="동기화">` 안에 `lazy` `SyncSection`, 절에 `id="sync"`, 주소 해시 `#sync`면 스크롤), `src/sections/backup/RestoreDialog.tsx`(동기화가 켜져 있으면 안내 한 줄), `package.json` `build:ci`(`--require-lazy SyncSection --require-lazy AuthCallbackPage --require-lazy sync-engine --require-lazy firebaseImpl`)
- Test: `tests/unit/sections/library-sync/sync-section.test.tsx`, `tests/unit/sections/backup/restore-sync-note.test.tsx`

**Interfaces:**
- Consumes: Task 5·6·7 전부(엔진은 `loadSyncEngine()`으로만 받아 `ensureLibrarySyncEngine()`을 부른다), `useBackupFile`(`src/sections/backup/use-backup-file.ts`의 `save`·`busy`), `libraryCounts`(`src/domain/backup/summary.ts`), `syncStatusAtom`, `DeviceSession`(패키지).
- Produces:
  - `SyncSection()`(기본 내보내기 이름 `SyncSection`) — 상태별 화면:
    - 꺼짐·로그인 전: 설명 세 줄(설계 §처음 켜기 1의 문구 그대로), `백업 먼저 받기`(`useBackupFile().save`), 로그인 단추. 단추는 `readSyncClientConfig`와 `api.status()`의 `providers`가 모두 참인 공급자만(`Google로 로그인`·`카카오로 로그인`·`네이버로 로그인`). `status.enabled === false`면 단추 대신 "지금은 동기화를 쓸 수 없어요". 카카오톡 인앱(`/KAKAOTALK/i`)이면 Google 단추 아래 안내 한 줄. 상태 요청이 실패하면 "동기화 서버에 연결하지 못했어요".
    - 화면이 열릴 때 메타에 `pendingChoice`가 참이면 `SyncConnectDialog`를 연다. Google 리다이렉트에서 돌아온 경우를 위해 `googleRedirectResult`를 한 번 부른다(Firebase 설정이 있고 세션이 없을 때만).
    - 켜짐: 한 줄 상태(`syncPhaseText` 굵게 + 설계 표의 뒤 설명), 계정 표시(`accountLabel`, 공급자 이름), 단추 `지금 동기화`(`runNow('manual')`), `동기화 끄기`/`다시 켜기`, `연결 해제`, 충돌·보류·거절이 있으면 `확인`(→ `SyncConflictsDialog`), `SyncDevices`, `서버 자료 모두 지우기`(→ `SyncDeleteDialog`).
    - `auth`: "다시 로그인해 주세요" + 로그인 단추(같은 계정이면 이어 감). `not-allowed`: 허용 안내.
  - `SyncConnectDialog({ open, onClose })` — `api.me()`의 `library.live`와 이 기기 `libraryCounts`로 세 경우(설계 §처음 켜기 3). 단추 문구: `올리기`, `서버 보관함 받기`, 선택지 `합치기(권장)`·`서버 보관함으로 바꾸기` + `계속`, 모두 `취소`(= `disconnect`). 진행 중에는 `progress`(`올리는 중 120/3,200`)를 보이고 닫기 막음.
  - `SyncConflictsDialog({ open, onClose })` — 충돌마다 `label`·경로 이름(`memo`→`메모`, `name`→`이름`, `labelIds`→`라벨`, `visitedOn`→`다녀온 날`, `review`→`한 줄 평`, `title`→`제목`, `days.<i>.stops`→`<i+1>일차 일정`, 그 밖 경로 그대로), "이 기기 값"·"남은 값"을 짧게(문자열 80자, 배열은 개수), `내 값으로 되돌리기`·`그대로 두기`. 보류는 "이 기기에 넣지 못한 항목"과 `이 기기 값으로 맞추기`·`건너뛰기`. 거절은 사유 문구(`invalid` "형식이 맞지 않아 올리지 못했어요", `too-large` "너무 커서 올리지 못했어요", `clock` "기기 시계를 확인해 주세요")만.
  - `SyncDevices()` — `api.client.listSessions()`와 `api.me().devices`(세션 id로 이음): 기기 이름·마지막 동기화(없으면 마지막 사용)·`이 기기` 표시·다른 기기에 `연결 끊기`(`revokeSession(id)`).
  - `SyncDeleteDialog({ open, onClose })` — "서버에 있는 이 계정의 보관함과 기기 연결을 모두 지워요. 기기 안의 보관함은 그대로예요." 입력칸에 `지우기`를 쳐야 단추가 켜진다 → `deleteServerData()`.
  - `RestoreDialog`: `readBootFlag()`가 참이면 확인 단계에 "동기화가 켜져 있어요. 되살린 내용은 다른 기기에도 반영돼요." 한 줄.
- [ ] **Step 1: 실패하는 시험** — `sync-section.test.tsx`(가짜 엔진·API를 `vi.mock`): 빌드 변수 없으면 설정에 `동기화` 절이 없음(`SettingsPage` 렌더), 카카오만 설정이면 카카오 단추만, 서버 `providers.kakao=false`면 숨김, 설명 문구에 "암호화하지 않고" 포함, `pendingChoice`면 연결 대화상자 — 서버 0개면 `올리기`, 이 기기 0개면 `서버 보관함 받기`, 둘 다면 `합치기(권장)`·`서버 보관함으로 바꾸기` 선택 뒤 `connect('merge'|'replace-local')`, 상태 문구 네 가지, 충돌 목록 `내 값으로 되돌리기` → `resolveConflict(id,'mine')`, 지우기 대화상자에서 `지우기` 입력 전 단추 비활성, 기기 목록 `연결 끊기`. `restore-sync-note.test.tsx`: 플래그 켜짐에서만 안내 한 줄.
- [ ] **Step 2:** `yarn vitest run tests/unit/sections/library-sync tests/unit/sections/backup/restore-sync-note.test.tsx` → 실패 확인
- [ ] **Step 3:** 구현. MUI 컴포넌트와 기존 설정 절의 모양(`Section`, `Button minHeight: 44`, `var(--tm-text-secondary)`)을 따른다. 대화상자는 기존 `RestoreDialog`처럼 `Dialog`+`DialogTitle`.
- [ ] **Step 4:** 시험 통과, `yarn typecheck`, `yarn lint`, `yarn build && yarn size --require-lazy SyncSection --require-lazy AuthCallbackPage --require-lazy sync-engine --require-lazy firebaseImpl`
- [ ] **Step 5:** 커밋 `feat(library-sync): 설정 동기화 화면·연결 방식·충돌 목록`

### Task 9: E2E — 두 기기 동기화

**Files:**
- Create: `tests/e2e/sync-server.ts`, `tests/e2e/library-sync.spec.ts`
- Modify: `playwright.config.ts`(`MAP_PORT = Number(process.env.E2E_MAP_PORT) || 5174`, 첫 webServer `env`에 `VITE_SYNC_DEV_FAKE: '1'`, desktop `testMatch`에 `'library-sync.spec.ts'`), `tests/e2e/fixtures.ts`(`SHARE_MAP_URL = \`http://localhost:${Number(process.env.E2E_MAP_PORT) || 5174}/\``)
- Test: 위 spec

**Interfaces:**
- Consumes: `tests/helpers/sync-memory-server.ts`(Task 6), `seedStorage`·`mockRoutes`(`tests/e2e/fixtures.ts`), 약속 `tests/e2e/meet-server.ts`의 `installMeetServer` 모양.
- Produces:
  - `createSyncServer(): { handle(request: Request): Promise<Response | null>; close(): void }` — `handleSync`를 `tsxRequire`로 불러(`meet-server.ts`와 같은 방식. ESM 전용 패키지를 `require`하지 못하면 `tsImport`(`tsx/esm/api`)로 바꾼다) `env = { DB: createSqliteD1(), SYNC_DEV_FAKE_SOCIAL: '1', ALLOWED_ACCOUNTS: 'kakao:dev-me,naver:dev-me' }`, `deps = { now: Date.now, fetch: 막음, random, uuid, certs: 막음, socialKeys: 막음(가짜가 대신 씀), log: () => {} }`. 경로가 `/api/sync/`로 시작하지 않으면 null.
  - `installSyncServer(context: BrowserContext, server): Promise<void>` — `context.route('**/api/sync/**', …)`(문서 이동 요청 포함). Origin 헤더는 바꾸지 않는다(로컬 출처 허용).
  - spec `@desktop` 시험 하나(`@smoke`는 붙이지 않는다 — 길다), 문맥 셋(A: 시드 보관함, B: 빈 보관함, C: 빈 보관함), 순서:
    1. A `/settings` → `동기화` 절 `카카오로 로그인` → 가짜 화면에서 계정 `me`·`정상 로그인`·`계속` → 설정으로 돌아와 대화상자 `올리기` → `동기화 완료`가 보임.
    2. B 같은 로그인 → `서버 보관함 받기` → `/`에서 시드 장소 이름 하나가 보임.
    3. A 그 장소 메모를 `A 메모`로 저장 → 3초 뒤 `동기화 완료` → B `page.reload()` → 장소 상세 메모 `A 메모`.
    4. B `context.setOffline(true)` → 메모 `B 오프라인` 저장 → A 메모 `A 나중` 저장·동기화 완료 → B `setOffline(false)` + `page.reload()` → B 설정 `확인 필요한 충돌` → `확인` → `내 값으로 되돌리기` → `동기화 완료` → A `reload` → 메모 `B 오프라인`.
    5. C 로그인 계정 `stranger` → "이 계정은 아직 동기화를 쓸 수 없어요"와 `kakao:dev-stranger`.
    6. A `서버 자료 모두 지우기` → `지우기` 입력 → 확인 → 동기화 꺼짐 → B `reload` → `다시 로그인해 주세요`.
- [ ] **Step 1:** 시험 작성
- [ ] **Step 2:** `E2E_PORT=4181 E2E_MAP_PORT=4182 yarn test:e2e tests/e2e/library-sync.spec.ts --project desktop` → 처음엔 실패(문구·선택자 맞춤) → 고쳐 통과. 포트를 열 수 없으면 실행을 건너뛰고 보고에 적는다.
- [ ] **Step 3:** 기존 E2E 영향 확인: `E2E_PORT=4181 E2E_MAP_PORT=4182 yarn test:e2e:ci`(설정 화면에 동기화 절이 생겨도 다른 시험이 통과하는지. 동기화 상태 요청은 다른 시험에서 가로채지 않으므로 "동기화 서버에 연결하지 못했어요"가 보이는 것이 정상)
- [ ] **Step 4:** 커밋 `test(library-sync): 두 기기 동기화 E2E`

### Task 10: 로컬 실행·문서·마무리 검증

**Files:**
- Modify: `package.json`(`dev:sync` 스크립트), `docs/development.md`(새 절 "보관함 동기화 설정과 API", 환경 변수 표에 줄 추가, 화면 경로 표에 `/auth/callback`), `src/sections/help/help-content.ts`·`docs/help/settings.md`(설정 단계에 동기화 한 단계), `README.md`(기능 목록에 한 줄), `.gitignore` 확인(`.wrangler/`가 이미 있는지)
- Test: 전체 검증

**Interfaces:**
- Produces:
  - `package.json` 스크립트(Yarn 1은 `sh`로 돌려 `${VAR:-기본}`이 된다):
    ```json
    "dev:sync": "yarn build:viewer && VITE_SYNC_DEV_FAKE=1 wrangler pages dev --d1 DB --port ${SYNC_DEV_PORT:-8795} --binding SYNC_DEV_FAKE_SOCIAL=1 --binding ALLOWED_ACCOUNTS=kakao:dev-me,naver:dev-me --proxy ${SYNC_VITE_PORT:-4185} -- vite --port ${SYNC_VITE_PORT:-4185} --strictPort"
    ```
  - `docs/development.md` 새 절(약속 온라인 절 뒤, 기존 줄은 바꾸지 않음) 내용:
    - 무엇·설계 문서 링크, Pages 변수 표(설계 §사용자가 할 일 5의 표 그대로), `LIBRARY_SYNC=off`.
    - **로컬에서 키 없이 해 보기**: `yarn dev:sync` → 기기 A `http://localhost:8795`, 기기 B `http://127.0.0.1:8795`(출처가 달라 보관함이 따로) → 설정 › 동기화 › `카카오로 로그인` → 가짜 화면에서 계정 `me`(허용) 또는 다른 값(허용 밖 시험), 결과 라디오로 취소·공급자 오류·코드 거절·장애 시험 → A `올리기`, B `서버 보관함 받기` → 한쪽 메모를 고치고 다른 쪽을 새로고침. 충돌: 브라우저 개발 도구 Network › Offline으로 한쪽을 끊고 양쪽에서 같은 메모를 고친다. 로컬 D1 비우기: 서버를 끄고 `rm -rf .wrangler/state`.
    - 가짜 공급자는 요청 주소가 localhost이고 `SYNC_DEV_FAKE_SOCIAL=1`일 때만 열린다. Google 로그인은 로컬 가짜가 없고 Firebase 설정이 있는 미리보기에서 확인한다.
    - API 표(설계 §API 표를 줄여 옮김), 하루 한도, D1 표 이름, 원격 확인 명령(읽기 전용) `npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta"`.
  - 도움말 설정 단계 하나 `{ title: '기기 간 동기화', sub: '설정 › 동기화에서 로그인' }`(움직이는 그림 재생성은 하지 않는다. `yarn build:motion`을 돌리지 않으면 그림은 그대로).
  - README 기능 목록: "보관함 동기화: 로그인한 내 기기끼리 장소·라벨·여행·약속을 맞춰요(선택)".
- [ ] **Step 1:** 문서·스크립트 작성
- [ ] **Step 2: 로컬 화면 확인**(Codex 샌드박스에서 포트가 막히면 건너뛰고 보고) — `SYNC_DEV_PORT=8795 SYNC_VITE_PORT=4185 yarn dev:sync`를 백그라운드로 띄우고 `curl -s -H 'Origin: http://localhost:8795' http://localhost:8795/api/sync/v1/status` → `{"enabled":true,…,"devFake":true}`. 확인 뒤 띄운 프로세스만 PID로 끈다.
- [ ] **Step 3: 전체 검증** — `yarn typecheck`, `yarn lint`, `yarn test`, `npx prettier --check <바꾼 파일들>`, `yarn build:ci`, `E2E_PORT=4181 E2E_MAP_PORT=4182 yarn test:e2e:ci`, `grep -rnP '[\x{2028}\x{2029}]' src functions tests`(출력 없음). 첫 로딩 gzip 바이트를 보고에 적는다.
- [ ] **Step 4:** 커밋 `docs(library-sync): 동기화 로컬 실행·설정 안내와 도움말`

## 최종 보고에 넣을 것

- 커밋 목록, 시험 수, `yarn build:ci`의 첫 로딩 gzip과 나뉜 조각 이름.
- 실행하지 못한 검증(네트워크·포트)과 이유.
- 미리보기에서 사람이 확인할 것: Google·카카오·네이버 실제 로그인, 올리기 100개 CPU 시간(넘으면 `PUSH_MAX_ITEMS` 50), iOS Safari·카카오톡 인앱 복귀.
- PR 본문 메모: 롤백·데이터 영향(설계 §호환·롤백), `docs/rollback.md`는 병합 뒤 별도 PR, 사용자가 할 일(설계 §사용자가 할 일).
