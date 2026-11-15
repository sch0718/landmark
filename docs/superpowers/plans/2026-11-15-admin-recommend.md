# 관리자 추천 장소 구현 계획

> 설계: `docs/superpowers/specs/2026-11-15-admin-recommend-design.md`(이 계획과 충돌하면 설계가 우선). 구현은 Codex가 한 번에 하고, 시험·빌드·e2e는 상위 세션이 돌린다.

**목표:** 관리자가 라벨을 기간 있는 「추천」으로 게시하고, 모든 사용자가 보관함 카드·지도 핀에서 미리 보고 골라 담는다.

**구조:** 서버는 기존 동기화 라우터에 `RECOMMEND_ROUTES`를 더하고 D1 표 하나(스키마 9)를 둔다. 앱은 공개 목록을 받아 atom에 두고, 카드·핀은 기존 공유 가져오기 미리보기(`SharePreview`)를 `recommend` 정보와 함께 연다.

## 공통 제약

- 문구·주석·문서는 한국어. 기존 파일의 꼴(Effect 4, jotai, MUI, `sx`, 44px 최소 높이)을 따른다.
- 새 의존성 없음. 공유 문서 형식(`ShareDoc`)·보관함 형식·`tripmap:prefs` 형식은 바꾸지 않는다.
- 시험은 설계 「시험」 절만큼만. 같은 동작을 여러 층에서 겹쳐 시험하지 않는다.
- 운영 변수 등록·배포는 하지 않는다.

## 파일

| 파일 | 할 일 |
|---|---|
| `src/server/meet/schema-sql.ts` | `SCHEMA_VERSION` 9, `recommendations` 표(설계 그대로) 추가 |
| `src/server/library-sync/env.ts` | `SyncEnv.ADMIN_ACCOUNTS?: string` |
| `src/server/library-sync/recommend.ts` (새) | 관리자 판별, 본문 검사, 경로 4개, KST 날짜, 엣지 캐시 |
| `src/server/library-sync/router.ts` | `...RECOMMEND_ROUTES` 추가. `SyncRoute.method`에 이미 `GET`·`POST`·`DELETE` 있음 |
| `src/services/recommend/api.ts` (새) | 공개 읽기, 관리자 목록·게시·내리기 |
| `src/services/recommend/prefs.ts` (새) | `tripmap:recommend:v1` 읽기·쓰기 |
| `src/stores/recommend.ts` (새) | atom들과 새로 받기 훅 |
| `src/stores/add-place.ts` | `share` 흐름에 `recommend?`·`focusPlaceId?`, `addFlowStepKey` |
| `src/sections/share-import/SharePreview.tsx` | `recommend`·`focusPlaceId` 받기 |
| `src/sections/add-place/AddPlaceHost.tsx` | 흐름의 `recommend`·`focusPlaceId`를 `SharePreview`로 넘김 |
| `src/sections/recommend/RecommendCards.tsx` (새) | 보관함 위 카드 줄 |
| `src/sections/library/LibraryPage.tsx` | 목록 위·빈 화면에 `RecommendCards` |
| `src/sections/map/recommend-markers.ts` (새) + `LibraryMap.tsx` | 추천 핀·토글 |
| `src/sections/recommend/admin/*` (새) | 게시 창, 게시한 추천 목록, 관리자 확인 훅 |
| `src/sections/labels/LabelEditor.tsx`·`LabelsPage.tsx` | 관리자일 때만 `추천으로 게시` 단추·`게시한 추천` 구역 |
| `src/sections/shell/AppShell.tsx` | 새로 받기 훅 한 번 부르기 |
| `tests/unit/server/recommend.test.ts` (새) | 서버 시험 |
| `tests/unit/services/recommend.test.ts` (새) | 숨김 보존 시험 |
| `tests/e2e/recommend.spec.ts` (새) + `playwright.config.ts` | 카드 → 담기 e2e 하나. desktop 프로젝트 `testMatch` 목록에 `recommend.spec.ts` 추가 |
| `docs/development.md`, `docs/rollback.md`, `scripts/motion/help-pages.mjs` → `docs/help/*.md` | 문서 |

**설계와 다르게 정한 것(작은 쪽):** 라벨 관리 화면에는 라벨 줄 메뉴가 없고 줄을 누르면 라벨 편집 창(`LabelEditor`)이 열린다. 그래서 `추천으로 게시` 단추는 그 창의 아래 단추 줄(병합·삭제 옆)에 둔다.

## 순서

### 1. 서버

`src/server/library-sync/recommend.ts`가 내보낼 것:

```ts
export const RECOMMEND_LIMITS = { places: 500, rows: 30, bodyBytes: 600_000, writes: 100, descChars: 80 } as const;
export type RecommendationMeta = { id: string; title: string; description: string; startDate: string; endDate: string; places: number; createdAt: number; updatedAt: number };
export type RecommendationPublic = RecommendationMeta & { doc: ShareDocV1 };
export function isAdmin(env: SyncEnv, user: Pick<SyncUser, 'provider' | 'account'>): boolean;
export function kstDate(now: number): string; // 'YYYY-MM-DD', now + 9h의 UTC 날짜
export function parseRecommendBody(value: unknown): { title: string; description: string; startDate: string; endDate: string; doc?: ShareDocV1 };
export const RECOMMEND_ROUTES: SyncRoute[];
```

- `isAdmin`: `ADMIN_ACCOUNTS`를 `,`로 나눠 `trim`, 빈 항목 버림. `${provider}:${account}`와 비교하되 `google:`은 소문자로 맞춰 비교. 변수 없음·빈 값이면 `false`.
- `requireAdmin(c, d)`: `requireSyncUser`(실패는 기존 401) 뒤 `isAdmin`이 아니면 `SyncHttpError(403, 'not-admin')`.
- `parseRecommendBody`: 키는 `title`·`description`·`startDate`·`endDate`·`doc`(선택)만. 제목 `labelNameIssue(title) === null`이고 `trim()`한 값 저장. 설명 문자열 0–80자, `\n`·`\r` 없음, `trim()`. 날짜는 `src/schema/common.ts`의 `CalendarDate`를 `safeParse`로 검사(실제 없는 날짜도 422, `toISOString`로 직접 만들지 않는다), `endDate >= startDate`. `doc`이 있으면 `validateShareValue(doc, 500)`(`src/domain/share/read-share.ts`) 성공 + `version === 1` + `labels.length === 0` + 모든 장소 `labelIds.length === 0`이고 `'memo' in place`가 아님. 어긋나면 `SyncHttpError(422, 'invalid', { path })`.
- 경로(`path`는 `/v1/...`, 경로식의 id 구간은 `([^/]+)`로 받고 핸들러에서 `^[a-z0-9]{8}$`이 아니면 422 `invalid`(`path: 'id'`)):
  - `GET /v1/recommendations` `allowWhenOff`: 캐시 키 `${CACHE_ORIGIN}/recommendations/${kstDate(now)}`(`src/server/cache-key.ts`의 `CACHE_ORIGIN`). `caches.default`가 있으면 먼저 `match`, 있으면 그 본문으로 `syncJson` 꼴 응답(`private, no-store`). 없으면 `SELECT ... WHERE start_date <= ? AND end_date >= ? ORDER BY start_date, id`, `doc`은 `JSON.parse`. 엣지 사본은 `Cache-Control: public, max-age=60`으로 `c.waitUntil(cache.put(key, copy))`. `handler.ts`의 `defaultCache`는 내보내지 않았으므로 같은 한 줄 함수를 이 파일에 둔다.
  - `GET /v1/admin/recommendations` `allowWhenOff`: `requireAdmin`, 메타만 `ORDER BY start_date DESC, id`.
  - `POST /v1/admin/recommendations/<id>`(off면 기존대로 503): `requireAdmin`, `readJson(c.request, 600_000)`, 검사, `consumeCounter(db, counterKey('recommend-write', user.userId, now), 1, 100)` 실패면 429 `rate-limited`. 기존 행이 없고 `doc`도 없으면 422 `invalid`(`path: 'doc'`). 새 행이고 행 수가 30 이상이면 422 `too-many`. `INSERT ... ON CONFLICT(id) DO UPDATE`(doc 없으면 doc·places 그대로, `created_at` 그대로). 성공 뒤 오늘 캐시 키 `delete`. 응답 `{ item: RecommendationMeta }`.
  - `DELETE /v1/admin/recommendations/<id>` `allowWhenOff`: `requireAdmin`, 한도 안 셈, 지운 행 0이면 404 `not-found`, 캐시 키 `delete`, 204.
- `router.ts`: `...BACKUP_ROUTES` 옆에 `...RECOMMEND_ROUTES`.

시험 `tests/unit/server/recommend.test.ts`(`// @vitest-environment node`, `createSyncMemoryServer({ ADMIN_ACCOUNTS: 'kakao:dev-me' })`, `backup-api.test.ts`의 `request` 꼴, 가짜 로그인은 `sub` 앞에 `dev-`가 붙어 `server.login()`은 `kakao:dev-me`(관리자), `server.login('you')`는 `kakao:dev-you`(관리자 아님). `ALLOWED_ACCOUNTS`에 `kakao:dev-you`도 넣는다):

- 잘못된 날짜(`2026-13-01`)·잘못된 id → 422.
- `isAdmin`: 변수 없음·빈 값 → false, 목록 안 → true, 밖 → false, `google:A@B.com` 변수와 `a@b.com` 계정 → true.
- 비로그인 POST 401, 목록 밖 계정 POST 403 `not-admin`.
- 게시 → 공개 GET에 보임. 기간 거르기: helper(`tests/helpers/sync-memory-server.ts`)가 만들 때 `Date.now` 참조를 잡으므로 `vi.spyOn(Date, 'now').mockImplementation(() => clock)`을 **서버를 만들기 전에** 걸고 `clock` 값을 바꿔 KST 경계(시작일 00:00 KST 포함, 종료일 23:59 KST 포함, 전날·다음 날 제외).
- 라벨이나 메모가 든 `doc` → 422. 새 행에 `doc` 없음 → 422. 31번째 새 행 → 422 `too-many`. 같은 id 다시 POST(doc 없이 제목만) → 덮어쓰고 `doc`은 그대로.
- `LIBRARY_SYNC: 'off'`에서 공개 GET·DELETE 됨, POST 503.

- 스키마 버전 8을 고정한 기존 시험(`tests/unit/server/meet-db.test.ts`의 버전·표 목록, `sync-schema.test.ts`, `backup-schema.test.ts`, `agent-schema.test.ts`)의 기대값을 9와 새 표로 고친다.

검증: `yarn vitest run tests/unit/server`

### 2. 앱 데이터

- `src/services/recommend/api.ts`:
  - `type Recommendation = { id; title; description; startDate; endDate; places; updatedAt; doc: ShareDocV1 }`.
  - `fetchRecommendations(fetchImpl = fetch): Promise<{ ok: true; items: Recommendation[] } | { ok: false }>`: `fetch('/api/sync/v1/recommendations', { signal: AbortSignal.timeout(8000), credentials: 'same-origin' })`. 200이 아니거나 꼴이 틀리면 `{ ok: false }`. 항목마다 `validateShareValue(item.doc, 500)`가 실패하거나 `version !== 1`이면 그 항목만 뺀다.
  - 관리자: `createRecommendAdminApi(api: Pick<SyncApi, 'client'>)` → `{ list(), publish(id, body), remove(id) }`. `api.client.send`를 그대로 쓰고 결과는 `{ ok: true; data } | { ok: false; reason: 'not-admin' | 'auth' | 'invalid' | 'too-large' | 'limit' | 'off' | 'offline' | 'server' }`(`server-backup/api.ts`의 `toBackupFailure` 꼴. 403은 `not-admin`, 413은 `too-large`).
- `src/services/recommend/prefs.ts`: `RECOMMEND_PREFS_KEY = 'tripmap:recommend:v1'`, `readRecommendPrefs(storage?)`, `writeRecommendPrefs(prefs, storage?)`. `{ hidden: string[]; mapOff: boolean }`. 꼴이 틀리거나 저장소가 막히면 기본값 `{ hidden: [], mapOff: false }`(쓰기 실패는 무시, 메모리 값은 atom이 들고 있음). 숨긴 id를 지우는 코드는 두지 않는다.
- `src/stores/recommend.ts`:
  - `recommendationsAtom: atom<Recommendation[]>([])`, `recommendPrefsAtom`(처음 값 `readRecommendPrefs()`, 바꿀 때 쓰기), `visibleRecommendationsAtom`(숨긴 id 뺀 것), `hideRecommendationAtom`(write-only, id 더함), `toggleRecommendMapAtom`.
  - `refreshRecommendations(store)`: 받아서 `ok`면 바꾸고, 실패면 그대로.
  - `useRecommendationsBoot()`: 마운트 때 한 번 받고, `visibilitychange`(보이게 될 때)·`online`에서 마지막으로 받은 지 5분(`300_000`ms) 지났으면 다시 받는다. `AppShell.tsx`에서 `useImportEntry()` 옆에 부른다.

시험 `tests/unit/services/recommend.test.ts`: 숨긴 뒤 `{ ok: true, items: [] }`로 바꾸고 prefs를 다시 읽은 다음 같은 id가 든 목록을 넣어도 `visibleRecommendationsAtom`이 비어 있다. `fetchRecommendations`가 실패하면 앞 목록이 남는다(`refreshRecommendations`).

검증: `yarn vitest run tests/unit/services/recommend.test.ts`

### 3. 미리보기·카드·지도

- `src/stores/add-place.ts`: `{ step: 'share'; doc: ShareDoc; inbox?: InboxRef; recommend?: RecommendRef; focusPlaceId?: string }`, `type RecommendRef = { id: string; title: string; description: string; startDate: string; endDate: string }`. `addFlowStepKey`의 `share`: `inbox`면 기존, `recommend`면 `share-recommend-${id}-${focusPlaceId ?? 'all'}`, 아니면 `'share'`.
- `AddPlaceHost.tsx`: `share` 단계에서 `<SharePreview doc inbox recommend focusPlaceId />`.
- `SharePreview.tsx`(바꾸는 곳만):
  - `picked` 초기값: `focusPlaceId`가 문서에 있으면 그 하나, 아니면 전부.
  - `name` 초기값: `recommend ? defaultTitleLabel(recommend.title) : defaultTitleLabel(doc.title)`.
  - 머리글: `recommend ? `${recommend.title} · ${n}곳`` 아니면 기존.
  - 둘째 줄: `recommend`면 설명(비어 있지 않을 때)과 `${formatPeriod(start, end)} 추천`, `만든 파일` 줄은 숨김. `formatPeriod`는 `MM.DD–MM.DD`(해가 다르면 `YYYY.MM.DD–YYYY.MM.DD`), `src/sections/recommend/format.ts`에 둔다(카드와 같이 씀).
  - 스위치 글 `recommend ? '추천 제목 라벨도 붙이기' : '파일 제목 라벨도 붙이기'`, 입력 `aria-label` `추천 제목 라벨 이름` / 기존.
  - 그 밖(가져오기·토스트·제목 라벨로 거르기)은 그대로.
- `src/sections/recommend/RecommendCards.tsx`: `visibleRecommendationsAtom`이 비면 `null`. `section aria-label="추천"` 안에 가로 넘김 줄(`overflow-x: auto`, `scroll-snap`). 카드는 `button`(접근 이름 = 제목) 안에 제목(굵게)·설명(한 줄 말줄임)·`N곳 · 기간`. 카드 오른쪽 위 `IconButton aria-label={`${title} 추천 숨기기`}`(×, 44px). 누르면 `setFlow({ step: 'share', doc, recommend: {...} })`와 `addOpenerAtom`은 기존 흐름 여는 곳(`FolderList` 등)과 같은 방식.
- `LibraryPage.tsx`: `FilterBar` 아래(`flex: 'none'` 상자 안)와 빈 화면(`EmptyState` 위)에 `<RecommendCards />`.
- `src/sections/map/recommend-markers.ts`: `recommendMarkers(recs: Recommendation[], library: Library, tokens: Tokens): { markers: MapMarker[]; byId: Map<string, { rec: Recommendation; placeId: string }> }`. 추천마다 `existingShareIds(library, rec.doc)`(`src/domain/library/import-share.ts`)에 든 장소는 빼고, 이미 더한 같은 장소(이름+좌표 소수 5자리 같음)도 뺀다. 마커: `id: 'rec:' + rec.id + ':' + place.id`, `label: '☆ ' + name`, `color: tokens.bg.surface`, `textColor: tokens.text.secondary`, `borderColor: tokens.accent.main`, `dimmed: true`, `clusterable: true`, `fit: false`.
- `LibraryMap.tsx`: `mapOff`가 아니면 위 마커를 `shownMarkers` 뒤에 더한다. `onMarkerClick`에서 `rec:`로 시작하면 `byId`로 찾아 `setFlow({ step: 'share', doc, recommend, focusPlaceId })` 하고 기존 처리로 가지 않는다. 지도 위 오른쪽 위(기존 `position: 'absolute'` 단추 자리와 겹치지 않게)에 `추천 장소` 토글 단추(`aria-pressed={!mapOff}`), 보일 추천이 없으면 숨김.

시험: 이 단계는 e2e 하나(`tests/e2e/recommend.spec.ts`)로 지킨다. 기존 단위 시험이 깨지면 고친다(`addFlowStepKey` 시험 등).

e2e(`share-import.spec.ts`의 꼴): `page.route('**/api/sync/v1/recommendations', …)`로 추천 하나(장소 2곳, `title: '가을 단풍'`, `doc.title: '옛 제목'`)를 준다. 보관함에서 `추천` 구역의 `가을 단풍` 카드를 누름 → `가을 단풍 · 2곳` 머리글, `추천 제목 라벨도 붙이기` 켜짐, 이름 입력 값 `가을 단풍` → `2곳 가져오기` → 토스트 `2곳을 새로 넣었어요` → `가을 단풍` 라벨 칩 눌림, 목록 2줄. 숨기기 단추를 눌러 카드가 사라지는 것도 같은 시험 끝에 본다.

검증: `E2E_PORT=4181 E2E_MAP_PORT=4182 yarn test:e2e tests/e2e/recommend.spec.ts --project desktop`

### 4. 관리자 화면

- `src/sections/recommend/admin/use-recommend-admin.ts`: `readSession(getSharedSyncStorage())`로 세션이 있으면(`ServerBackupSection.tsx`와 같은 방식. 동기화 상태 atom은 세션 정보가 없고 서버 중단 때도 관리자 목록·내리기는 돼야 한다) `createRecommendAdminApi(getSharedSyncApi()!)`로 `list()`를 한 번 부른다. 결과 `{ admin: boolean; items: RecommendationMeta[]; reload(): Promise<void> }`. 로그인 안 함·실패·403이면 `admin: false`.
- `PublishDialog.tsx`: 입력 제목(기본 = 게시된 같은 id의 제목 또는 라벨 이름), 한 줄 설명(80자), 시작일·종료일(`type="date"`, 기본 오늘·오늘+30일, KST). `mode: 'publish' | 'edit'`. `publish`는 그 라벨의 살아 있는 장소로 `buildShareDoc(library, ids, { title, includeMemo: false, now: new Date() })` 뒤 `labels: []`, 각 장소 `labelIds: []`. 장소 0곳 또는 500곳 초과면 단추를 끄고 「추천은 500곳까지예요」(0곳이면 「이 라벨에 장소가 없어요」). 단추 글 `게시`/`다시 게시`(같은 id가 이미 있으면)/`저장`(edit). 성공 토스트 `추천을 게시했어요`·`추천을 고쳤어요`, 그 뒤 `reload()`와 `refreshRecommendations`. 실패 토스트는 설계 「실패 처리」 문구.
- `PublishedList.tsx`: `게시한 추천` 제목, 줄마다 제목, `N곳 · 기간`, 상태(`게시 중`/`예정`/`끝남`, KST 오늘 기준), `수정`, `내리기`(확인 대화상자 「‘제목’ 추천을 내릴까요?」 → `remove`, 토스트 `추천을 내렸어요`, 성공하면 `reload()`와 `refreshRecommendations`).
- `LabelEditor.tsx`: 새 선택 prop `onPublish?: () => void`. 있으면 아래 단추 줄에 `추천으로 게시`.
- `LabelsPage.tsx`: `useRecommendAdmin()`. `admin`이면 편집 창에 `onPublish`를 주고 `PublishDialog`를 연다. 목록 아래에 `PublishedList`.

시험: 따로 두지 않는다(서버 권한은 1단계 시험이 지킨다). 타입·빌드로 확인.

### 5. 문서

- `docs/development.md`: 환경변수 표에 `ADMIN_ACCOUNTS`(Pages 서버 변수, `kakao:<sub>,naver:<sub>,google:<이메일>`, 없으면 관리자 없음). 「보관함 동기화」 절 뒤에 「관리자 추천」 절: 경로 4개, D1 `recommendations` 표(스키마 9), 한도(30행·500곳·600,000바이트·하루 게시 100회), 캐시 60초·무효화 범위, `LIBRARY_SYNC=off` 동작, 로컬에서 해 보기(`--binding ADMIN_ACCOUNTS=kakao:dev-me`를 기존 `wrangler pages dev` 명령에 더함).
- `scripts/motion/help-pages.mjs`: 보관함 쪽에 추천 카드·숨기기, 지도 쪽에 `추천 장소` 토글, 라벨 쪽에 관리자 게시(관리자만 보임) 한두 줄씩. 그 뒤 `yarn build:motion`으로 `docs/help/*.md`를 다시 만든다(Codex 샌드박스에서 안 되면 상위 세션이 돌림).
- `docs/rollback.md`: 표의 새 버전 줄은 태그를 붙일 때 넣으므로, 이 PR에서는 「서버 로드맵 2A·2B·3·4와 AI 연결 되돌리기」 절 끝에 「`tripmap:recommend:v1`·D1 `recommendations` 표는 옛 버전이 읽지 않는다. 되돌려도 보관함 그대로」 한 줄.

## 마무리 검증(상위 세션)

```bash
yarn typecheck && yarn lint && yarn test && yarn build:ci
E2E_PORT=4181 E2E_MAP_PORT=4182 yarn test:e2e tests/e2e/recommend.spec.ts tests/e2e/share-import.spec.ts --project desktop
```
