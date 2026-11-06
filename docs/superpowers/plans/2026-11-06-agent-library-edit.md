# AI 보관함·여행 편집 구현 계획

> **작업자에게:** `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`로 작업 단위(Task)별로 진행한다. 설계는 `docs/superpowers/specs/2026-11-06-agent-library-edit-design.md`(이하 「설계서」)다. 이 계획은 파일·순서·검증 중심이며 코드는 설계서와 아래 인터페이스를 따라 쓴다.

**목표:** AI 토큰(`library:read`·`library:write`)이 서버 사본의 장소·라벨·폴더·여행·약속을 항목 단위로 읽고 고치며, 변경 기록으로 되돌릴 수 있게 한다.

**구조:** 기존 동기화의 `pullChanges`·`pushItems`를 재사용한다. 에이전트 쪽에 `library-edit.ts`(필드 시각 찍기·참조 검사·기록)를 얹고, 앱은 기존 AI 연결 화면에 스위치와 `AI 변경 기록` 창을 더한다. PR 2개.

**기술:** Cloudflare Pages Functions + D1(SQLite 시험 도우미 `tests/helpers/sqlite-d1.ts`), React + MUI, vitest, Effect Schema.

## 전역 제약(설계서에서 그대로)

- 서버 사본을 바로 수정(승인 화면 없음). 되돌리기 가능: 사용자당 최근 100건·30일, `before_doc` 합계 5MB 초과 시 오래된 것부터 삭제.
- 쓰기: 한 번에 최대 50개, 하루 500항목(`consumeCounter` 키 `agent-edit`), `baseRev` 불일치는 `conflict`(병합 없음).
- `AGENT_EDIT=off`면 `edit`·`undo`는 토큰 검사 전 `503 off`. 읽기와 앱의 기록 조회·되돌리기는 꺼져도 동작. `AGENT_API=off`는 에이전트 경로 전체를 끈다(앱 경로 예외).
- `library:write`는 `library:read`를 포함하지 않는다. 기존 토큰은 새 범위가 없다. PR ② 전에는 새 범위 토큰을 발급할 수 없다.
- 새 D1 표 `agent_changes`, `SCHEMA_VERSION` 7 → 8, `ACCOUNT_DATA_TABLES`에 더한다.
- 사용자에게 보이는 글은 한국어. 기기 키 `tripmap:agent-inbox:v1`에 알린 변경 id를 함께 둔다.
- 새 E2E는 만들지 않는다. 같은 동작을 여러 층에서 겹쳐 시험하지 않는다. 검토는 구현 뒤 최대 2회.

## 파일 구조

| 파일 | 역할 | PR |
|---|---|---|
| `src/domain/library-sync/stamp.ts`(새) | `stampChangedFields(before, after, now)`: `{value, updatedAt}` 필드 중 값이 바뀐 것의 `updatedAt`을 `now`로 | ① |
| `src/server/agent/library-edit.ts`(새) | `editItems`·`undoChanges`·참조 검사. `pushItems` 호출과 기록 | ① |
| `src/server/agent/changes.ts`(새) | `agent_changes` 기록·목록·정리 | ① |
| `src/server/meet/schema-sql.ts` | 표·인덱스 추가, `SCHEMA_VERSION = 8` | ① |
| `src/server/agent/tokens.ts` | 범위 상수 확장, `ISSUABLE_SCOPES` 분리, 한도 | ①·② |
| `src/server/agent/router.ts` | 에이전트 경로 4개, `handleAgent`의 인증 전 편집 스위치 검사 | ① |
| `src/server/library-sync/env.ts` | `SyncEnv`에 `AGENT_EDIT?: string`과 스위치 설명 주석 추가 | ① |
| `src/server/agent/sync-routes.ts` | 앱 경로 2개 | ① |
| `src/server/library-sync/library.ts` | `ACCOUNT_DATA_TABLES`, `pushItems` 사용자 타입 축소(T3), `pullChanges`의 세션 없는 읽기 지원(T5) | ① |
| `pipeline/agent-trip/client.ts`, `pipeline/cli/trip.ts`, `pipeline/agent-trip/help.ts`·`output.ts` | `library` 명령 | ① |
| `src/services/agent-inbox/api.ts` | 앱 API: 변경 기록·되돌리기, 범위 타입 | ② |
| `src/sections/agent/AgentTokenDialog.tsx`, `agent-copy.ts`, `AgentSection.tsx` | 스위치·범위 표시·`AI 변경 기록` 진입 | ② |
| `src/sections/agent/AgentChangesDialog.tsx`(새) | 기록 창 | ② |
| `src/services/agent-inbox/inbox-check.ts`, `src/services/agent-inbox/storage.ts` | 변경 알림·알린 변경 id 읽기·저장 | ② |
| `scripts/motion/help-pages.mjs`(+생성물), `privacy-content.ts`, `docs/development.md`, `docs/rollback.md` | 문서 | ② |

## PR ① 서버·CLI

### Task 1: 필드 시각 찍기와 참조 목록 (순수 함수)

- 확인(코드 열기): `src/schema/library-base.ts`의 `FieldSchema`를 쓰는 모든 문서(장소·라벨·폴더·여행·약속)에서 `{value, updatedAt}`가 어디에 중첩되는지, `src/domain/library-sync/items.ts`의 `tripRefs`(160행)가 출발지·숙소·Stop·후보를 모두 얻는지.
- 만들기: `stampChangedFields<T>(before: T | undefined, after: T, now: string): T` — `before`가 없으면 모든 필드 시각을 `now`로. 객체·배열을 재귀로 걷고 `value`와 `updatedAt`만 가진 객체를 필드로 본다. 같은 값이면 `after`의 시각을 이전 시각으로 되돌린다(AI가 보낸 시각은 쓰지 않는다).
- 시험 `tests/unit/domain/library-sync/stamp.test.ts`: 바뀐 필드만 `now`, 같은 값은 이전 시각 유지, 새 문서는 전부 `now`, 장소·여행 실제 문서 각 1개로 `decodeItem` 통과.
- 검증: `yarn vitest run tests/unit/domain/library-sync/stamp.test.ts`

### Task 2: D1 표와 변경 기록 저장

- `schema-sql.ts`에 설계서의 `agent_changes`와 인덱스 `(user_id, at)`, `SCHEMA_VERSION = 8`. `library.ts`의 `ACCOUNT_DATA_TABLES`에 `'agent_changes'`.
- `changes.ts`: `recordChanges(db, rows)`, `listChanges(db, userId, now)`(최근 100건·30일·`before_doc` 제외), `pruneChanges(db, userId, now)`(100건 초과·30일 지난 행, 합계 5MB 초과 시 오래된 것부터).
- 시험 `tests/unit/server/agent-changes.test.ts`: 기록·목록 순서, 100건 상한, 30일 경과, 5MB 상한, 목록에 본문이 없음. `tests/unit/server/sync-library.test.ts`의 계정 삭제 시험에 새 표 포함 확인.
- 기존 시험 갱신: `tests/unit/server/agent-schema.test.ts`·`tests/unit/server/meet-db.test.ts`의 `SCHEMA_VERSION`·`schema_meta` 기대값을 8로 바꾸고, 표·색인 목록과 AI 스키마 문장 수에 `agent_changes` 및 새 인덱스를 반영한다. 기존 멱등성·자료 보존 검사는 유지한다.
- 검증: `yarn vitest run tests/unit/server/agent-changes.test.ts tests/unit/server/sync-library.test.ts tests/unit/server/agent-schema.test.ts tests/unit/server/meet-db.test.ts`

### Task 3: `editItems`

- `library-edit.ts`의 `editItems(db, who: { userId, tokenId }, body, now)` — 설계서 「edit」 1~6단계 그대로. `deviceId`는 `'agnt' + tokenId`(공개 id 12자 a-z0-9 → 16자, 기존 `devicePattern` `/^[a-z0-9]{16}$/`에 맞음). `pushItems`의 사용자 인자는 `Pick<SyncUser, 'userId'>`로 좁혀 `AgentPrincipal`도 받게 한다(`pushItems`가 `userId` 외 필드를 쓰는지 먼저 확인). `requestId` 재전송은 항목마다 1단계(`baseRev` 검사)보다 먼저 같은 `request_id`·`kind`·`item_id` 기록을 찾고, 있으면 `ok`와 그 기록의 `after_rev`로 답한다. 기록이 없으면 1단계부터 처리한다.
- 결과 `status`: `ok`·`conflict`(현재 `doc` 포함)·`missing`·`referenced`·`invalid-ref`·`invalid`·`too-large`·`clock`.
- `src/server/library-sync/library.ts`의 `pushItems`에 설계서 5단계의 병합하지 않는 쓰기 방식을 추가한다(현재는 없는 기능). 실제 쓰기 조건으로 원래 `baseRev`를 확인하고, 재시도에서도 불일치 항목은 병합·저장하지 않고 `conflict`와 현재 문서를 반환한다. 기존 동기화 호출의 기본 병합 동작은 유지한다. 기록은 조건부 쓰기에 성공한 항목의 직전 문서·rev와 결과 rev만 사용한다. `results[].doc`을 보고 쓰기 후에 거절하는 방식은 쓰지 않는다.
- 경합 시험(아래 같은 파일): 1단계 이후 및 쓰기 직전의 다른 기기 수정·같은 id 생성은 `conflict`, 다른 기기 값 보존·기록 없음. 내부 재시도도 원래 `baseRev`를 유지하며 병합하지 않음. 기존 `sync-library.test.ts`의 기기 병합 시험은 유지한다.
- 시험 `tests/unit/server/agent-library-edit.test.ts`(SQLite D1): 장소 메모 교체, 새 장소 추가(`baseRev` 0), 새 항목에 `baseRev` ≠ 0 거절, 기존 항목 `baseRev` 불일치 `conflict`, 여행 put 시 행이 없는 장소 `invalid-ref`, 묘비 장소를 참조하는 여행 put `ok`(기존 참조를 둔 채 제목만 바꾸는 경우 포함), 여행이 쓰는 장소 delete `referenced`, `put`의 문서에 `deletedAt`이 있으면 `invalid`, 장소·폴더가 없는 라벨을 가리켜도 서버는 거절하지 않음(검사 안 함을 고정하는 시험), 한 요청에서 새 장소 put 뒤 그 장소를 넣은 여행 put `ok`, 한 요청에서 여행 put으로 뺀 장소 delete `ok`, 한 요청에서 참조되지 않은 장소 delete 뒤 그 묘비를 참조하는 여행 put `ok`, 같은 `kind:id` 두 번 `422 invalid`, 이미 지운 항목 delete `missing`, 필드 시각이 `now`, 클라이언트가 보낸 오래된 시각 무시, 크기·시계·상한 거절, 51개 요청 거절, 같은 `requestId` 재전송(적용된 항목은 `conflict` 없이 `ok`·기록의 `after_rev`, 행·기록 불변, 앞에서 `conflict`였던 항목은 다시 처리), 적용된 항목만 기록됨(바뀐 내용 없는 항목은 기록 안 됨).
- 검증: `yarn vitest run tests/unit/server/agent-library-edit.test.ts`

### Task 4: `undoChanges`

- `library-edit.ts`에 `undoChanges(db, who: { userId }, target: { ids: string[] } | { requestId: string }, now)` — 설계서 「되돌리기」. 가장 최근부터(`at` 내림차순, 같으면 `rowid` 내림차순), 지금 `rev === after_rev`일 때만, `before_doc`은 필드 시각을 `now`로 찍어 복원하고 `null`이면 묘비. 쓰기는 `pushItems`로 하고, `deviceId`는 그 변경 기록의 `token_id`로 `'agnt' + token_id`(Task 3과 같은 규칙, 앱 경로에서 불려도 같음. `library_items.device_id`는 마지막으로 쓴 기기 기록용이라 읽는 곳이 없다). 되돌린 행은 `undone_at`. 응답 `undone`·`changed`·`already`·`gone`. 되돌리기는 새 변경 기록을 만들지 않는다.
- 시험(같은 파일에 이어서): 수정 되돌리기, 새 항목 되돌리기(지워짐), 그 사이 다른 기기가 고쳤으면 `changed`, 두 번 되돌리기 `already`, 만료·없는 id `gone`, `requestId` 묶음 순서(같은 `at`이면 `rowid` 역순), 삭제 되돌리기(묘비 해제), 같은 항목에 변경 A·B가 있을 때 B를 되돌린 뒤 A는 `changed`로 남음.
- 되돌리기도 Task 3의 병합하지 않는 쓰기 방식을 쓰고 `baseRev`는 기록의 `after_rev`로 고정한다. 실제 쓰기 충돌은 `changed`로 반환하고 `undone_at`을 찍지 않는다. 검사 이후·쓰기 직전 다른 기기 변경이 보존되는 경우를 같은 시험에 포함한다.
- 검증: `yarn vitest run tests/unit/server/agent-library-edit.test.ts`

### Task 5: 경로·범위·스위치·한도

- `src/server/library-sync/env.ts`의 `SyncEnv`에 `AGENT_EDIT?: string`을 추가한다. 주석: `/** 'off'면 에이전트 edit·undo를 막는다(읽기·앱 기록 조회·되돌리기는 됨). 값이 없으면 켜짐. */`.
- `tokens.ts`: `AGENT_SCOPES = ['inbox:write','share:create','library:read','library:write']`, 발급 가능 목록 `ISSUABLE_SCOPES = ['inbox:write','share:create']`(PR ②에서 확장), `parseIssueBody`는 `ISSUABLE_SCOPES`만 받는다. `AGENT_LIMITS.edit = 500`(하루 항목)·읽기 한도. 키는 `counterKey('agent-edit', …)`.
- `router.ts`: `GET /v1/library/changes`(`library:read`, `parsePullQuery`+`pullChanges` 응답 그대로, `410 resync` 포함), `GET /v1/library/edits`(`library:read`, `listChanges`), `POST /v1/library/edit`·`POST /v1/library/undo`(`library:write`, `AGENT_EDIT === 'off'`면 토큰 검사 전 `503 off`). `edit` 항목 수만큼 `consumeCounter`(한도 초과 `429 rate-limited`). 본문 크기 한도는 `PUSH_MAX_BYTES`.
- `router.ts`의 `AgentRoute`에 `editSwitch?: true`를 추가하고 새 `edit`·`undo` 경로에만 `editSwitch: true`를 지정한다. `handleAgent`에서 기존 `AGENT_API` 검사 바로 뒤, `requireAgentToken` 호출 전에 `route.editSwitch && ctx.env.AGENT_EDIT === 'off'`이면 `SyncHttpError(503, 'off')`를 던진다. 이 검사를 경로의 `run` 안에 두면 인증 뒤가 되므로 `handleAgent`에서 수행한다. 읽기 경로에는 표시하지 않고 앱의 `sync-routes.ts`에는 이 검사를 적용하지 않는다.
- `library/changes`의 에이전트 요청은 기기 동기화가 아닌 서버 사본 읽기다(설계서 「에이전트 API」·「CLI」). `device` 질의는 값이 비었거나 유효한 기기 id여도 `url.searchParams.has('device')`로 확인해 `SyncHttpError(422, 'invalid', { path: 'device' })`로 거절한다. 나머지는 `parsePullQuery`로 검사하고 `pullChanges(db, principal, { ...query, deviceId: null }, now)`를 호출한다. `library.ts`의 `pullChanges` 사용자 타입은 `Pick<SyncUser, 'userId'> & Partial<Pick<SyncUser, 'sessionId'>>`로 좁힌다. 함수 진입 시 `q.deviceId !== null`인데 `user.sessionId`가 없으면 같은 422 오류로 거절하고, 기기 등록 분기는 세션 id가 있는 경우에만 실행한다. 동기화 경로의 `SyncUser`·기기 등록·갱신은 유지하며, 에이전트 읽기는 `library_devices`를 만들거나 갱신하지 않는다.
- `sync-routes.ts`: `GET /v1/agent/changes`, `POST /v1/agent/changes/undo`(`allowWhenOff: true`, 동기화 세션 인증).
- `edit` 뒤 `ctx.waitUntil(pruneChanges(...))`.
- 시험 `tests/unit/server/agent-router.test.ts`·`agent-sync-routes.test.ts`에 추가: 범위 없는 토큰 `403 scope`, `Origin` 헤더 `403`, `AGENT_EDIT=off`의 `edit`·`undo`는 토큰 없음·잘못된 토큰·유효 토큰 모두 `503 off`(인증 전 차단), 읽기·앱 되돌리기 정상, `AGENT_API=off` 에이전트 경로 `503`·앱 되돌리기 정상, 하루 한도 `429`, `parseIssueBody`가 `library:*`를 아직 거절(PR ②에서 뒤집음), `library/changes`가 `deviceId: null`인 `pullChanges`와 같은 본문·페이지 커서·`410 resync`, `device` 질의(정상 id·빈 값·잘못된 값) 모두 `422 invalid`(`path: device`), 에이전트 읽기 전후 `library_devices` 불변. `tests/unit/server/sync-library.test.ts`에는 세션 없는 사용자와 `deviceId: null`로 읽기 성공, 세션 없이 기기 등록 요청 시 422·행 불변을 추가하고 기존 세션 기기 등록·갱신 시험을 유지한다.
- 기존 시험 준비: `tests/unit/server/agent-tokens.test.ts`의 공용 `input.scopes = [...AGENT_SCOPES]`를 `['inbox:write', 'share:create']`로 고정해 `parseIssueBody`의 정렬·중복 제거 기대값과 일치시킨다(PR ②에서도 그대로 유지). `library:*` 발급 거절 시험은 PR ①에서 별도로 유지하고 PR ②에서 허용으로 전환한다. `tests/unit/server/agent-router.test.ts`의 기존 `issue()`는 HTTP 발급 경로를 쓰므로, 라이브러리 범위 시험용 토큰은 `src/server/agent/tokens.ts`의 `issueAgentToken(db, userId, { name, scopes }, deps)`를 직접 호출하는 별도 도우미로 만든다. 로그인한 사용자의 id와 시험 DB·의존성을 넘기고 반환된 토큰을 기존 비밀값 검사 목록에 더한다. 기존 HTTP 발급 시험은 유지한다.
- 검증: `yarn vitest run tests/unit/server`

### Task 6: CLI `yarn trip library`

- `client.ts`: `libraryChanges`, `libraryEdit`, `libraryUndo`, `libraryEdits` 메서드. `trip.ts`: `library` 하위 명령 `list|get|put|delete|changes|undo`. `put`은 `decodeItem`으로 문서를 먼저 검사(입력 오류 끝 코드 2), `--file`은 JSON, `--base-rev` 필수. 서버의 `conflict`·`invalid-ref`·`referenced` 등은 사유와 함께 끝 코드 5. `help.ts`·`output.ts`에 명령·`--json` 형식 추가.
- 시험 `tests/unit/pipeline/agent-trip/library-command.test.ts`(기존 CLI 시험의 가짜 서버 방식 그대로): 인자 검사, `put` 입력 검증, 서버 상태별 끝 코드·출력, `--help`.
- 검증: `yarn vitest run tests/unit/pipeline` 후 `yarn tsc -b`, `yarn lint`

### PR ① 마무리

- `yarn test`, `yarn tsc -b`, `yarn lint`, `yarn prettier --check .`. 검토(Codex) 1회, 지적은 Critical·Warning만 확인. 브랜치 `feat/agent-library-edit-api`, PR 본문에 「이 PR만으로는 쓰기 토큰을 만들 수 없다(PR ②에서 켬)」 명시.

## PR ② 앱·문서 (PR ① 병합 뒤)

### Task 7: 앱 API와 연결 만들기 스위치

- `tokens.ts`의 `ISSUABLE_SCOPES`에 `library:read`·`library:write` 추가, 서버 시험의 「아직 거절」을 「받음」으로 뒤집고 `scopes`에 `library:write`만 있으면 거절(읽기 필수) 시험 추가.
- `api.ts`: 범위 타입 확장, `changes()`·`undo(input)`.
- `AgentTokenDialog.tsx`: 스위치 「보관함 읽기·쓰기 — AI가 보관함·여행을 직접 고칠 수 있어요」(기본 꺼짐, 켜면 `library:read`+`library:write`). `agent-copy.ts`의 `scopeLabel`에 「보관함」. 스위치를 켠 토큰 발급 직후 안내에 변경 기록 위치를 적는다.
- 시험: `tests/unit/sections/agent/`의 기존 토큰 대화상자·섹션 시험에 스위치 켜기·끄기·표시 추가.
- 검증: `yarn vitest run tests/unit/sections/agent tests/unit/server/agent-tokens.test.ts`

### Task 8: `AI 변경 기록` 창과 알림

- `AgentChangesDialog.tsx`: 목록(종류·이름·시각·토큰 이름·되돌림 여부), 항목 `되돌리기`, 요청 묶음 `모두 되돌리기`, `changed`는 「그 사이 바뀌어서 그대로 뒀어요」, 창 위에 「같은 항목은 가장 최근 변경만 되돌릴 수 있어요」. 되돌린 뒤 동기화 1회 호출(기존 동기화 훅 사용). 진입: `AgentSection.tsx`의 `AI 변경 기록` 단추(`library:write` 토큰이 하나라도 있거나 기록이 있을 때만).
- `src/services/agent-inbox/inbox-check.ts`의 `check()`: 받은함 확인이 도는 때 `changes()`도 읽어 알리지 않은 변경 id가 있으면 알림 「AI가 보관함을 바꿨어요 N건 · 기록 보기」. 기존 `attachInboxCheck`의 동기화 완료·10분 간격·숨은 탭 제외 조건을 따른다.
- `src/services/agent-inbox/storage.ts`: `AgentInboxLocal`에 알린 변경 id 필드를 추가하고, `readAgentInboxLocal`·`writeAgentInboxLocal` 모두 확장해 `tripmap:agent-inbox:v1`에서 함께 읽고 저장한다. 없는 필드는 빈 배열로 읽는다.
- 시험: `tests/unit/sections/agent/`의 대화상자 시험(되돌리기·묶음·`changed` 문구), `tests/unit/services/agent-inbox-check.test.ts`(새 변경만 알림, 이미 알린 id 제외, 10분 한 번), `tests/unit/services/agent-inbox-storage.test.ts`(알린 변경 id 읽기·쓰기 왕복, 새 필드가 없는 기존 값은 빈 배열로 읽음).
- 검증: `yarn vitest run tests/unit/sections/agent tests/unit/services`

### Task 9: 문서와 마무리

- `scripts/motion/help-pages.mjs` 설정 팁 한 줄 → `yarn build:motion`(생성물 `src/sections/help/help-content.ts`·`docs/help/settings.md` 포함). `privacy-content.ts` AI 연결 항목에 설계서 문구. `docs/development.md`에 「AI의 보관함 편집」 절(경로·범위·`AGENT_EDIT`·`agent_changes`·CLI·한도·롤백). `docs/rollback.md`에 새 버전 줄과 「옛 버전으로 되돌리면」 메모(스키마 8 표 남음, 반영된 AI 수정은 보관함에 남으니 되돌리기 전에 기록으로 되돌려 둘 것, 기능 스위치 `AGENT_EDIT=off`).
- 검증: `yarn test`, `yarn tsc -b`, `yarn lint`, `yarn prettier --check .`, `yarn test:e2e`는 AI 연결 화면이 걸린 기존 시험만(`--project=desktop --project=iphone`).
- 검토(Codex) 1회.

### Task 10: 워크스페이스 스킬 (저장소 밖)

- `korea-trip-planner` 스킬의 `references/`에 「보관함 편집」 절(`yarn trip library list|get|put|delete|undo`, 읽은 뒤 `baseRev`와 함께 쓰기, `conflict`면 다시 읽기, 요청할 때만). git 관리 밖이라 백업은 세션 scratchpad에 둔다.

## 병합 뒤

- 실제 사용 확인: 2026-11-20 이후 `agent_changes`로 AI가 보관함을 고쳤는지 본다. 쓰지 않았으면 걷어내는 PR을 제안한다.
- 운영 설정: `AGENT_EDIT`는 기본 켜짐(값 없음). 문제가 생기면 Pages 변수 `AGENT_EDIT=off`로 쓰기만 막는다.

## 계획 자체 점검

- 설계서의 모든 절이 Task에 대응한다(권한 T5·T7, `edit` T3, 되돌리기 T4, 앱 경로 T5, D1 T2, CLI T6, 앱 T7~T8, 문서 T9, 스킬 T10).
- 이름 일치: `stampChangedFields`(T1·T3·T4), `editItems`·`undoChanges`(T3·T4·T5), `recordChanges`·`listChanges`·`pruneChanges`(T2·T3·T5), `ISSUABLE_SCOPES`(T5·T7).
- 열린 항목은 T1·T3의 「확인」 단계에서 코드로 닫는다. 확인 결과 설계서와 다르면 설계서를 먼저 고친다.
