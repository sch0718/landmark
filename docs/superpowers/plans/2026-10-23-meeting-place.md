# 약속장소 정하기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여러 사람의 출발지에서 공평한 번화가 역·보관함 장소를 찾고, 후보·답장·확정 링크로 함께 골라 확정하는 '약속' 탭을 만든다.

**Architecture:** 약속은 보관함 문서의 선택 키 `meetings`에 LWW 필드로 저장한다. 계산(직선 사전 선별·순위)·링크(압축 해시)·답장 반영은 `src/domain/meeting/*`의 순수 함수다.
서버는 기존 `/api/route`에 `transit`을 더하고 `/api/search`를 새로 둔다. 화면은 `/meetings`, `/meetings/:id`, `/meet` 세 경로를 지연 로딩한다.

**Tech Stack:** React 19, MUI 7, Jotai, Effect 4.0.2(Schema, Context.Service), Vitest 5(@effect/vitest), Playwright, Cloudflare Pages Functions.

**설계 문서:** `docs/superpowers/specs/2026-10-23-meeting-place-design.md` — 이 계획과 다르면 설계 문서가 맞다. 모든 과제 전에 한 번 읽는다.

## Global Constraints

- 셸: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`, Yarn 1.22.22. `yarn test`(vitest), `yarn typecheck`, `yarn lint`/`yarn validate`.
- 첫 로딩 예산 `initialJsGzipMax` 327,680. 새 화면·데이터(번화가 역 포함)는 첫 로딩 JS에 넣지 않는다.
- `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 사용자 문자열은 React 텍스트로만. `dangerouslySetInnerHTML`·`innerHTML` 금지. 주석·UI 문구는 한국어, 주변 코드 관례(이름·주석 밀도·Effect 사용 방식)를 따른다.
- `functions/api/*.ts`는 `src/` 별칭 없이 상대 경로로 가져온다.
- 고치지 않는다: `playwright.config.ts`의 포트·webServer·globalSetup(새 spec을 `testMatch` 목록에 더하는 것만 허용), `tests/e2e/global-setup*`, `docs/rollback.md`, `perf-budget.json`, `.claude/`.
- 여행 계획의 구간 수단(`legModes`: `car|walk`)과 여행 저장 형식, 공유 파일·공유 링크(`/view`, `/import`) 형식은 바꾸지 않는다.
- 라벨을 그릴 때는 이름(과 이모지)만 쓰고 `LabelGlyph`의 선 아이콘은 쓰지 않는다.
- 이미 커밋된 것(고치지 말고 쓴다): `scripts/hubs-list.json`, `scripts/build-hubs.mjs`, `src/domain/meeting/hubs-data.ts`(150곳, `import type { Hub } from './hubs'`),
  고정물 `tests/fixtures/routes/transit-city.json`·`transit-intercity.json`·`transit-near.json`(`status: POINTS_ARE_TOO_CLOSE`, `paths: []`), `tests/fixtures/naver/instant-search-gangnam.json`.
- 네트워크가 없는 환경에서 실행된다. 외부 호출이 필요한 확인은 하지 말고 결과 보고에 남긴다.
- 과제마다 커밋한다. 커밋 메시지는 한국어 conventional(`feat(meeting): …`), 끝 줄은 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/schema/meeting.ts` | 약속 스키마·제한·관계 검사(`checkMeeting`) |
| `src/schema/library.ts`, `library-base.ts` | `meetings` 선택 키, `LIBRARY_LIMITS` 약속 항목 |
| `src/domain/meeting/hubs.ts` | `Hub` 타입, `loadHubs()`(데이터 모듈 동적 import 아님 — 이 파일 자체가 지연 덩어리 안에서만 쓰인다) |
| `src/domain/meeting/ops.ts` | 약속 생성·수정·삭제, 참석자·후보·좋아요·확정 연산(연쇄 정리 포함) |
| `src/domain/meeting/rank.ts` | 하버사인, 역 사전 선별, 순위 3기준 |
| `src/domain/meeting/link.ts` | 링크 문서 스키마, 인코딩·해석(`#d=`, `#r=`, `#f=`) |
| `src/domain/meeting/apply-reply.ts` | 답장 미리보기·반영 규칙 |
| `src/server/route.ts`, `cache-key.ts` | `transit` 모드 |
| `src/server/search.ts`, `functions/api/search.ts` | 이름 검색 |
| `src/services/route-lookup.ts` | `transit`·출발 시각 |
| `src/services/place-search.ts` | 검색 클라이언트 서비스 |
| `src/sections/trips/planner/naver-directions.ts` | `transit` 길찾기 주소 |
| `src/sections/meetings/*` | 목록·편집·링크 화면, 출발지 고르기, 지도 레이어, 계산 훅 |
| `src/routes/*`, `src/sections/shell/nav-items.ts`, `src/components/icons.tsx` | 경로·탭·아이콘 |
| `tests/unit/**`, `tests/e2e/meetings.spec.ts` | 시험 |

---

### Task 1: 약속 스키마와 보관함 `meetings` 키

**Files:**
- Create: `src/schema/meeting.ts`
- Modify: `src/schema/library-base.ts`(LIBRARY_LIMITS), `src/schema/library.ts`(LibrarySchema에 `meetings: Schema.optionalKey(Schema.Record(Schema.String, MeetingSchema))`, makeFilter에서 key===id·`checkMeeting`)
- Test: `tests/unit/schema/meeting.test.ts`, 기존 `tests/unit/schema/library*.test.ts`에 옛 문서 읽기 사례

**Interfaces:**
- Produces:
  - `MeetingId`(`/^[a-z0-9]{10}$/`), `MeetingMemberId`(`/^[a-z0-9]{8}$/`, 참석자·후보 공용)
  - `OriginSchema = { name: 1~60자, lng, lat, placeId?: PlaceId }`, 좌표는 경도 124~132·위도 33~39 유한수
  - `ParticipantSchema = { id, name: 1~20자, origin: NullOr(OriginSchema) }`
  - `CandidateSchema = { id, kind: 'hub'|'place', name: 1~60자, address?: ≤120자, lng, lat, hubId?: string(≤8), placeId?: PlaceId }`
  - `ReplySchema = { likes: Array(MeetingMemberId), sentAt: IsoDateTime, receivedAt: IsoDateTime }`
  - `MeetingSchema = { id, title: Field<1~60자>, at: Field<NullOr({date: CalendarDate, time: HHmm})>, mode: Field<'transit'|'car'|'straight'>, rank: Field<'max'|'avg'|'spread'>, participants: Field<Array(Participant) ≤10>, candidates: Field<Array(Candidate) ≤8>, replies: Field<Record(String, Reply)>, decided: Field<NullOr(MeetingMemberId)>, createdAt, deletedAt: NullOr(IsoDateTime) }`
  - 타입 `Meeting`, `Participant`, `Candidate`, `Origin`, `MeetingMode`, `MeetingRank`, `Reply`
  - `checkMeeting(meeting, path): Issue[]` — 참석자 id 중복, 후보 id 중복, `replies` 키가 참석자가 아님, `likes`가 후보가 아님·중복, `decided`가 후보가 아님. (`placeId`는 dangling 검사하지 않는다.)
  - `LIBRARY_LIMITS.meetingsMax = 200`, `meetingParticipantsMax = 10`, `meetingCandidatesMax = 8`, `meetingTitleChars = 60`, `meetingNameChars = 20`
  - 약속 개수 200 초과는 makeFilter에서 거부

- [ ] **Step 1: 실패하는 시험** — `tests/unit/schema/meeting.test.ts`: 정상 약속 통과, 각 제한 경계(제목 60/61자, 참석자 10/11명, 후보 8/9곳, 좌표 범위 밖), `checkMeeting`의 다섯 관계 오류 각각, key≠id 거부, `meetings` 없는 옛 문서 통과, `meetings: {}` 통과, 201개 거부. 시험 데이터 빌더는 `tests/fixtures/builders.ts`에 `buildMeeting(overrides)`로 더한다.
- [ ] **Step 2:** `yarn vitest run tests/unit/schema/meeting.test.ts` → 실패 확인
- [ ] **Step 3:** 구현. `src/schema/trip.ts`의 Field·체크 작성 방식을 그대로 따른다. Record 키는 일반 `String`(패턴 금지, library.ts:164 주석).
- [ ] **Step 4:** 시험 통과, `yarn typecheck` 통과. 백업 읽기(`read-backup.ts`)·`library-store`는 손대지 않아도 `meetings`가 보존되는지 `tests/unit/domain/backup` 쪽에 사례 하나(약속이 든 원본 → 백업 → 읽기 → 약속 그대로) 추가.
- [ ] **Step 5:** 커밋 `feat(meeting): 약속 저장 형식`

### Task 2: 약속 연산(ops)

**Files:**
- Create: `src/domain/meeting/ops.ts`
- Test: `tests/unit/domain/meeting/ops.test.ts`

**Interfaces:**
- Consumes: Task 1 타입, 기존 `OpCtx`/`OpResult` 관례(`src/domain/trips/ops.ts`), `setField`·LWW 도우미(`src/domain/library/lww.ts`), id 생성(`src/services/id-gen.ts` 관례 — ops는 ctx로 id·now를 받는다)
- Produces(모두 `(lib: Library, …, ctx: OpCtx) => OpResult`, 입력 불변):
  - `createMeeting(lib, { title, at, mode, hostName }, ctx)` → 참석자 1명('나' 또는 hostName, 출발지 null), rank 'max', 후보·답장 빈 값. 결과에 새 id.
  - `updateMeeting(lib, id, patch: Partial<{ title, at, mode, rank }>, ctx)`
  - `deleteMeeting(lib, id, ctx)`(deletedAt만), `restoreMeeting`
  - `addParticipant(lib, id, { name, origin }, ctx)`(10명 제한 오류 `participants-full`), `updateParticipant(lib, id, pid, { name?, origin? })`, `removeParticipant(lib, id, pid)` → 그 참석자의 `replies` 항목도 같은 갱신에서 지움
  - `addCandidate(lib, id, candidate 정보)`(8곳 제한 `candidates-full`, 같은 hubId/placeId 또는 50m 안 같은 이름이면 `candidate-exists`), `removeCandidate(lib, id, cid)` → 모든 `likes`에서 빼고 `decided`가 그것이면 null
  - `toggleLike(lib, id, pid, cid, ctx)` → `replies[pid]`가 없으면 `{likes:[cid], sentAt: now, receivedAt: now}`
  - `decide(lib, id, cid | null, ctx)`
  - 오류 유니온 `MeetingOpError = 'not-found' | 'participants-full' | 'candidates-full' | 'candidate-exists' | 'meetings-full' | 'invalid'`
- 같은 갱신에서 여러 필드를 바꿀 때 각 필드의 `updatedAt`을 ctx.now로 맞춘다. 결과는 Task 1 스키마를 반드시 통과한다(시험에서 매 연산 뒤 `safeParse(LibrarySchema, …)` 성공 확인).

- [ ] **Step 1:** 실패하는 시험: 연산마다 정상·제한·연쇄 정리(참석자 삭제→답장, 후보 삭제→좋아요·확정), 삭제된 약속에 연산하면 `not-found`, 201번째 생성 `meetings-full`.
- [ ] **Step 2:** 실패 확인 → **Step 3:** 구현 → **Step 4:** 통과·typecheck
- [ ] **Step 5:** 커밋 `feat(meeting): 약속 연산`

### Task 3: 번화가 역 타입과 순위 계산

**Files:**
- Create: `src/domain/meeting/hubs.ts`, `src/domain/meeting/rank.ts`
- Test: `tests/unit/domain/meeting/rank.test.ts`, `tests/unit/domain/meeting/hubs.test.ts`

**Interfaces:**
- Produces:
  - `type Hub = { id: string; name: string; region: string; lng: number; lat: number }` (`hubs.ts`), `export { HUBS } from './hubs-data'`
  - `haversineM(a: [lng,lat], b: [lng,lat]): number` — 이미 `src/domain/trips/geo.ts`나 `src/domain/nearby.ts`에 같은 함수가 있으면 그것을 쓰고 새로 만들지 않는다.
  - `preselectHubs(origins: [lng,lat][], hubs: readonly Hub[], n = 8): Hub[]` — 각 역의 '가장 먼 출발지 직선거리' 오름차순, 같으면 평균 오름차순, 그다음 id.
  - `type CellValue = number | null`(분 또는 미터), `type Score = { max: number; avg: number; spread: number; complete: boolean }`
  - `scoreRow(values: CellValue[]): Score | null` — null 칸이 있으면 `complete:false`, null 아닌 값으로 계산, 값이 하나도 없으면 null
  - `rankRows<T extends { id: string; values: CellValue[] }>(rows: T[], rank: MeetingRank): (T & { score: Score | null })[]` — complete를 먼저, 그다음 설계 문서 '순위 기준'대로(max: max→avg, avg: avg→max, spread: spread→max), 끝으로 id
  - `transitDeparture(at: { date; time } | null, now: Date): string` — `YYYY-MM-DDTHH:mm`(한국 시각), 일시가 있으면 약속 시각 −60분(날짜 넘어감 처리), 없으면 now
- [ ] **Step 1:** 실패하는 시험: 세 기준의 동점 처리, null 섞인 행 정렬, 2명·10명, `preselectHubs`가 서울 강남·홍대·잠실 출발에서 강남·홍대 사이 역(예: 시청·서울역·고속터미널 중 하나)을 상위 8에 넣는지(실제 `HUBS` 사용), `transitDeparture` 00:30 약속 → 전날 23:30. `hubs.test.ts`: 150곳, id 유일, 좌표 한국 범위, 이름 비어 있지 않음.
- [ ] **Step 2~4:** 실패 확인 → 구현 → 통과
- [ ] **Step 5:** 커밋 `feat(meeting): 번화가 역 순위 계산`

### Task 4: 링크 문서와 답장 반영

**Files:**
- Create: `src/domain/meeting/link.ts`, `src/domain/meeting/apply-reply.ts`
- Test: `tests/unit/domain/meeting/link.test.ts`, `tests/unit/domain/meeting/apply-reply.test.ts`

**Interfaces:**
- Consumes: `encodeCompressedJson`/`decodeCompressedJson`·`CodecError`(`src/domain/codec.ts`), `appUrl`(`src/share-viewer/encode.ts`), Task 1 스키마 조각, `safeParse`(`src/schema/parse.ts`)
- Produces:
  - 스키마(모두 `onExcessProperty: 'error'`): `InviteDocSchema`(`format:'tripmap-meet', v:1, kind:'d', meetingId, title, at, mode, participants[{id,name,origin}], candidates[{id,kind,name,address?,lng,lat}], times: Record<candidateId, Record<participantId, number|null>>, unit:'min'|'m', sentAt`), `ReplyDocSchema`(`kind:'r', meetingId, participantId?, newName?, origin?, likes[], sentAt` — participantId와 newName 중 정확히 하나), `FinalDocSchema`(`kind:'f', title, at, mode, place{name,address?,lng,lat}, participants[{name, origin}]`)
  - `MEET_HASH_MAX = 8_000`, 풀었을 때 64KB 제한(`decodeCompressedJson` 옵션 또는 길이 검사)
  - `meetLink(doc: MeetDoc, app: string): Promise<{ ok: true; url: string } | { ok: false; reason: 'too-long' }>` — `${app}/meet#${doc.kind}=${data}`
  - `readMeetHash(hash: string): Promise<{ ok: true; doc: MeetDoc } | { ok: false; reason: 'missing' | 'corrupt' | 'invalid' | 'too-long' }>`
  - `inviteFromMeeting(meeting, times, unit, now)`, `replyFromDraft(...)`, `finalFromMeeting(meeting)`(decided 없으면 null)
  - `previewReply(meeting: Meeting, doc: ReplyDoc): ReplyPreview` = `{ kind: 'ok'; participant: {id?, name, isNew}; likes: string[]; droppedLikes: number; originChanged: boolean } | { kind: 'stale' } | { kind: 'full' } | { kind: 'other-meeting' }`
  - `applyReply(lib, meetingId, doc, ctx): OpResult` — 설계 문서 '답장 반영 규칙' 전부(덮어쓰기, sentAt 오래됨 거부, newName 같은 이름 NFC·공백 정리 매칭, 10명 제한, origin 변경, 없는 후보 좋아요 버림, 확정 유지). `receivedAt`은 ctx.now.
- [ ] **Step 1:** 실패하는 시험: 세 문서 왕복, 여분 필드 거부, 좌표 범위 밖 거부, 해시 8,000자 초과 `too-long`, 깨진 base64 `corrupt`, participantId·newName 둘 다/둘 다 없음 거부, 반영 규칙 표의 각 행.
- [ ] **Step 2~4:** 실패 확인 → 구현 → 통과
- [ ] **Step 5:** 커밋 `feat(meeting): 약속 링크와 답장 반영`

### Task 5: 서버 — 대중교통 경로와 이름 검색

**Files:**
- Modify: `src/server/route.ts`, `src/server/cache-key.ts`, `functions/api/route.ts`(transit max-age 1시간)
- Create: `src/server/search.ts`, `functions/api/search.ts`
- Test: `tests/unit/server/route.test.ts`(있는 파일에 추가), `tests/unit/server/search.test.ts`, `tests/unit/server/functions.test.ts`(진입점: 허용 출처·캐시·잘못된 입력)

**Interfaces:**
- Produces:
  - `RouteMode = 'car' | 'walk' | 'transit'`. `RouteQuery`에 `at?: string`(`YYYY-MM-DDTHH:mm`, 한국 시각). transit은 `at` 필수(클라이언트가 늘 `transitDeparture`로 채운다), 없거나 형식이 틀리면 BAD_REQUEST. 다른 모드에 `at`이 오면 BAD_REQUEST.
  - `routeInputKey` transit 형식 `transit:<at을 10분 단위로 내린 값>:lng,lat>lng,lat`, 네이버에도 내린 값을 보낸다. `parseRouteInputKey` 왕복.
  - `RouteResult`에 선택 필드 `fare?: number | null`, `transfers?: number`, `walkS?: number`를 더한다(기존 car/walk 결과 모양은 그대로).
  - transit resolve: 설계 문서 '대중교통 경로'대로. `paths[0]`의 `duration`·`walkingDuration`은 분 → 초, `distance` m, `fare`, `transferCount`. `POINTS_ARE_TOO_CLOSE`면 walk resolve를 불러 `{mode:'transit', distanceM, durationS, fare:0, transfers:0, walkS:durationS, path: [] }`. 그 밖의 빈 paths → `NO_ROUTE`. `path`는 transit에서 항상 `[]`.
  - `/api/search?q=&near=` → `{ results: { name, address, category, lng, lat }[] }`(최대 10, place 항목만, 좌표 범위 밖 버림, address는 roadAddress 우선 jibunAddress). q 공백 정리 후 1~40자 아니면 BAD_REQUEST. 캐시 7일. 업스트림 실패 `UPSTREAM_ERROR`.
- [ ] **Step 1:** 실패하는 시험: 세 transit 고정물(도시·장거리·가까움), at 형식 오류, 검색 고정물 해석, q 길이, 진입점 출처 거부·캐시 키.
- [ ] **Step 2~4:** 실패 확인 → 구현 → 통과
- [ ] **Step 5:** 커밋 `feat(server): 대중교통 경로와 장소 이름 검색`

### Task 6: 클라이언트 서비스와 길찾기 주소

**Files:**
- Modify: `src/services/route-lookup.ts`, `src/services/errors.ts`(필요하면), `src/lib/effect/runtime.ts`(AppLayer에 새 서비스), `src/sections/trips/planner/naver-directions.ts`
- Create: `src/services/place-search.ts`
- Test: `tests/unit/services/route-lookup.test.ts`(추가), `tests/unit/services/place-search.test.ts`, `tests/unit/sections/trips/planner/naver-directions.test.ts`(추가)

**Interfaces:**
- Produces:
  - `RouteLookup.leg(mode: 'car'|'walk'|'transit', from, to, opts?: { refresh?: boolean; at?: string })` — transit만 `at`을 쓰고 로컬 캐시 키에 at(10분 내림)을 넣는다. 기존 호출은 바뀌지 않는다.
  - `PlaceSearch` 서비스: `search(q: string, near?: [lng,lat]): Effect<SearchResult[], PlaceSearchError>`, 같은 질의 진행 중 합치기, 메모리 LRU 50, 시간 초과 8초, 오류 코드 `BAD_REQUEST|UPSTREAM_ERROR|TIMEOUT|OFFLINE|FORBIDDEN_ORIGIN`(RouteLookup의 오류 해석 방식 재사용)
  - `DirectionsLeg['mode']`에 `'transit'`: 앱 `nmap://route/public?…`, 웹 `…/-/transit`
- [ ] **Step 1~4:** 실패하는 시험 → 구현 → 통과(기존 route-lookup 시험이 그대로 통과해야 함)
- [ ] **Step 5:** 커밋 `feat(meeting): 대중교통 경로·검색 클라이언트`

### Task 7: 경로·탭·지연 로딩 뼈대와 약속 목록

**Files:**
- Modify: `src/routes/paths.ts`(`meetings: '/meetings'`, `meeting: (id) => '/meetings/'+id`, `meet: '/meet'`), `src/routes/router.tsx`, `src/routes/lazy-routes.ts`(`loadMeetingsPage`/`MeetingsPage`, `loadMeetingEditorPage`/`MeetingEditorPage`, `loadMeetLinkPage`/`MeetLinkPage`를 `ROUTE_CHUNKS`에), `src/sections/shell/nav-items.ts`(key `'meetings'`, label '약속', '여행' 다음), `src/components/icons.tsx`(약속 아이콘 — 기존 아이콘 작성 방식, 사람 둘+핀 정도의 단순한 선), `package.json` `build:ci`에 `--require-lazy MeetingsPage --require-lazy MeetingEditorPage --require-lazy MeetLinkPage`
- Create: `src/sections/meetings/MeetingsPage.tsx`, `src/sections/meetings/MeetingFormDialog.tsx`(제목·일시·이동수단; 기존 `TripFormDialog` 모양을 따른다)
- Test: `tests/unit/sections/meetings/MeetingsPage.test.tsx`, `tests/unit/sections/shell/*`(탭 6개·활성 표시), `tests/unit/routes/*`(새 경로)

- 목록: 살아 있는 약속을 만든 시각 내림차순 카드(제목·일시·이동수단·참석자 수·후보 수·확정 장소 이름). 빈 상태 "아직 약속이 없어요" + '새 약속'. 카드 메뉴에 삭제(되돌리기 알림은 여행 삭제와 같은 방식).
- 아래 탭이 6개가 되어도 360px에서 칸마다 44px 이상인지 단위 시험 또는 E2E에서 확인.
- [ ] **Step 1~4:** 실패하는 시험 → 구현 → 통과
- [ ] **Step 5:** 커밋 `feat(meeting): 약속 탭과 목록`

### Task 8: 약속 편집 화면 — 참석자·출발지 고르기

**Files:**
- Create: `src/sections/meetings/MeetingEditorPage.tsx`, `ParticipantList.tsx`, `OriginPicker.tsx`(검색 상자 / 지도에서 고르기 / 보관함에서), `MapPickOverlay.tsx`(가운데 십자선, `addFlowAtom`과 무관), `meeting-map-layers.ts`, `use-meeting.ts`(id로 약속 읽기·연산 실행: `useLibraryAction` 사용)
- Test: `tests/unit/sections/meetings/*.test.tsx`, `meeting-map-layers.test.ts`

- 레이아웃: 넓은 화면 왼쪽 패널 + 오른쪽 `MapView`, 좁은 화면 위 지도 + 아래 내용(기존 여행 플래너의 반응형 방식을 따른다).
- 기본 정보 편집(제목·일시·이동수단; 이동수단·일시를 바꾸면 결과 영역에 '조건이 바뀌었어요 — 다시 찾기').
- 참석자: 추가·이름 수정·삭제(확인), 출발지 표시. 출발지 고르기는 대화상자/시트 하나에서 세 탭:
  - 검색: 입력 300ms 디바운스로 `PlaceSearch`, 결과 목록(이름·주소·분류). 실패 문구는 설계 문서대로.
  - 지도에서 고르기: 십자선 + '여기로 정하기'(이름은 "지도에서 고른 곳", 고른 뒤 고칠 수 있음), Esc/취소.
  - 보관함에서: 살아 있는 장소 이름 검색 목록(기존 `PlacePickerDialog`를 쓸 수 있으면 쓴다), 고르면 `placeId`를 함께 저장.
- 지도 레이어: 출발지(참석자 이름 첫 글자 점), 역 순위(번호), 후보(강조), 확정 장소. `MapMarker`·`MapPolyline` 기존 형식, 문자열은 지도 textContent로만.
- 없는 id·삭제된 약속은 `TripNotFound`와 같은 안내.
- [ ] **Step 1~4:** 실패하는 시험 → 구현 → 통과
- [ ] **Step 5:** 커밋 `feat(meeting): 약속 편집과 출발지 고르기`

### Task 9: 중간 지점 찾기·후보·집계·확정과 링크 보내기

**Files:**
- Create: `src/sections/meetings/use-meeting-compute.ts`, `HubResults.tsx`, `NearbyPlaces.tsx`, `CandidateTally.tsx`, `share-link.ts`(Web Share API → 없거나 실패하면 클립보드, 결과 알림)
- Test: `tests/unit/sections/meetings/use-meeting-compute.test.ts`, 각 컴포넌트 시험

- `use-meeting-compute`: 입력(출발지가 있는 참석자들, 대상 지점 목록, mode, at) → 칸별 값(분 또는 m)·진행률·오류. 직선이면 하버사인 m, 아니면 `RouteLookup.leg`(transit은 `transitDeparture(at, now)`), 결과는 메모리에만. 조건(출발지·mode·at) 해시가 바뀌면 `stale: true`. 칸별 '다시 시도'.
- 결과: '중간 지점 찾기'(참석자 출발지 2명 이상일 때만 누를 수 있음) → `preselectHubs` 8곳 → 계산 → `rankRows`. 기준 단추 3개(`updateMeeting rank`). 행: 순위·역 이름·지역·최장/평균/편차·참석자별 값(분은 "1시간 5분", m는 "3.2km"), 조회 기준 문구(설계 문서 '대중교통 출발 시각').
- 역을 펼치면 반경 1km 안 살아 있는 보관함 장소(`src/domain/nearby.ts` 재사용, 라벨 칩으로 거르기 — 라벨은 이름·이모지만). '후보에 담기'(역 자체·장소 각각).
- 후보·집계: 후보마다 좋아요 수와 누가(이름), 참석자별 값(후보도 같은 계산 훅으로), 주최자 좋아요 토글(참석자 '나' = 첫 참석자; 참석자 고르기 선택은 YAGNI), 후보 빼기, '확정'/'확정 취소'.
- '후보 링크 보내기': 후보 1곳 이상일 때. `inviteFromMeeting`에 계산된 times를 넣는다(계산 안 된 칸은 null). '확정 링크 보내기': 확정 후.
- 답장 반영 진입은 Task 10의 `/meet#r=`. 편집 화면에는 참석자별 '답장 받음(시각)' 표시.
- [ ] **Step 1~4:** 실패하는 시험 → 구현 → 통과
- [ ] **Step 5:** 커밋 `feat(meeting): 중간 지점 찾기와 후보 집계`

### Task 10: `/meet` 링크 화면(친구·답장·확정)

**Files:**
- Create: `src/sections/meetings/MeetLinkPage.tsx`, `InviteView.tsx`, `ReplyImport.tsx`, `FinalView.tsx`, `meet-drafts.ts`(localStorage `tripmap:meet-drafts:v1`, 약속 id별 최대 20개 LRU, 모든 접근 try/catch)
- Test: 각 컴포넌트·`meet-drafts` 시험

- `MeetLinkPage`: `location.hash`를 `readMeetHash`로 읽어 kind별 화면. 해시는 지우지 않는다. 실패는 "링크를 읽지 못했어요" + 약속 목록 단추(원인은 `console.warn`).
- `InviteView`(`#d=`): 제목·일시·이동수단·후보 지도·목록. "나는 누구?"(참석자 라디오 + '목록에 없어요' 이름 입력), 내 출발지(Task 8 `OriginPicker` 재사용; 바꾸면 내 줄만 `use-meeting-compute`로 다시 계산), 후보별 참석자 값 표, 좋아요 토글, '답장 링크 보내기'(`replyFromDraft` → `share-link`). 이 기기에 같은 id 약속이 있으면 '내 약속 열기'. 초안은 `meet-drafts`에 저장·복원. 친구 기기의 보관함은 바꾸지 않는다.
- `ReplyImport`(`#r=`): 약속이 있으면 `previewReply` 결과 문구("○○님 답장: 좋아요 n곳, 출발지 바뀜", 없어진 후보 n곳 제외 / 더 오래된 답장 / 10명이 차 있음) + '반영'(→ `applyReply` → `/meetings/<id>`로 이동, 출발지가 바뀌었으면 편집 화면이 그 참석자 칸을 다시 계산) / '반영하지 않기'. 약속이 없으면 "이 기기에 없는 약속의 답장이에요".
- `FinalView`(`#f=`): 제목·일시·장소 지도·주소, 참석자별 "○○ 출발 길찾기" 단추(`naverDirectionsUrl`, 직선 약속은 transit, 좁은 화면 앱/넓은 화면 웹 — 기존 `LegRow`의 플랫폼 판정 재사용), 출발지 없는 참석자는 단추 없이 이름만.
- [ ] **Step 1~4:** 실패하는 시험 → 구현 → 통과
- [ ] **Step 5:** 커밋 `feat(meeting): 약속 링크 화면`

### Task 11: E2E 시나리오

**Files:**
- Create: `tests/e2e/meetings.spec.ts`
- Modify: `tests/e2e/fixtures.ts`(`mockSearch(page)` 추가, `mockRoutes`에 transit 응답), `playwright.config.ts`의 세 프로젝트 `testMatch` 목록에 `'meetings.spec.ts'`만 추가

- 시나리오(설계 문서 '시험' 그대로): 약속 만들기 → 참석자 3명(검색·보관함·지도 핀 각각) → 중간 지점 찾기 → 역 펼쳐 장소 후보·역 후보 담기 → 후보 링크(클립보드 권한 또는 `navigator.share` 가로채기로 URL 얻기) → `browser.newContext()`로 친구가 열어 출발지 수정·좋아요 → 답장 링크 → 주최자 맥락에서 열어 반영 → 집계 확인 → 확정 → 확정 링크 열어 길찾기 단추 href 확인. 첫 시나리오에 `@smoke`.
- 추가: 답장을 약속 없는 맥락에서 열기, 깨진 링크, 좁은 화면(@mobile)에서 탭 6개가 보이고 '약속' 탭으로 이동.
- 이 과제는 E2E를 실행하지 못한다(포트 금지). `yarn tsc -p tsconfig.json --noEmit`·`yarn lint`로 타입·린트만 확인하고 보고에 "E2E 미실행"을 적는다.
- [ ] **Step 1:** 작성 → **Step 2:** 타입·린트 통과 → **Step 3:** 커밋 `test(meeting): 약속 E2E`

### Task 12: 마무리 확인

- [ ] `yarn validate && yarn typecheck && yarn test` 통과
- [ ] `yarn build && yarn size --require-lazy …(package.json의 build:ci 목록 전체)` 통과(지도 키 없는 크기)
- [ ] `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음, `grep -rn dangerouslySetInnerHTML src` 새 항목 없음
- [ ] 결과 보고: 과제별 커밋, 바꾼 파일, 시험 수, 못 한 것(E2E·실제 네이버 호출·미리보기 배포 CPU 확인)
