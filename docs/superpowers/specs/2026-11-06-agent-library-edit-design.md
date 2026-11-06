# AI의 보관함·여행 편집 설계

- 작성일: 2026-11-06
- 상태: 사용자 승인(방식·안전장치·편집 단위) → 구현 계획 전
- 관련: `2026-11-01-agent-trip-design.md`(AI 연결), `2026-10-29-library-sync-design.md`(동기화)

## 배경과 전제

- 사용자 1명이 여러 기기로 쓰고, 소수 지인에게 공유한다. 무료 운영(Cloudflare Pages·D1)이다.
- **이미 있는 것으로는 안 되는 이유**: AI 연결의 받은함은 새 일정·장소를 *가져오기*만 한다. 보관함에 이미 있는 장소 메모, 라벨, 여행 일정은 AI가 고칠 수 없다.
- 동기화를 켠 기기는 서버의 항목별 사본(`library_items`)을 받아 온다. 그래서 AI가 서버 사본을 고치면 기기에는 평소 동기화로 퍼진다.

## 결정 요약(사용자 확정, 2026-11-06)

| 결정 | 내용 |
|---|---|
| 적용 방식 | AI가 서버 사본을 **바로 수정**한다. 승인 화면은 없다 |
| 안전장치 | 변경 기록 + 되돌리기(사용자당 최근 100건·30일) |
| 편집 단위 | 항목(문서) 단위 읽기·쓰기. 장소·라벨·폴더·여행·약속 모두 |

## 하지 않는 것

- 변경안을 사람이 승인하는 화면
- AI 쓰기의 필드 단위 병합(그 사이 바뀌었으면 거절하고 AI가 다시 읽는다)
- 동기화를 켜지 않은 기기로의 전달. 그 기기는 동기화를 켜기 전에는 AI 수정이 보이지 않는다
- 연산 단위 API(`setMemo`·`addStop` 등)
- 여러 사용자의 보관함을 한 토큰으로 편집

## 권한

- `AGENT_SCOPES`에 `library:read`·`library:write`를 더한다(`src/server/agent/tokens.ts`). `library:write`는 `library:read`를 포함하지 않는다. 쓰려면 둘 다 받는다.
- 기존 토큰은 두 범위가 없어 그대로 읽기·쓰기를 못 한다. 새 연결을 만들 때만 고른다(기본 꺼짐).
- 기능 스위치 `AGENT_EDIT=off`: `edit`·`undo` 요청이 토큰 검사 전에 `503 off`. 읽기와 앱의 기록 조회·되돌리기는 꺼져도 동작한다(되돌리기를 막으면 안 된다).
- 기존 `AGENT_API=off`는 이 경로도 함께 끈다(토큰 검사 전 `503 off`, 앱 쪽 되돌리기는 예외).

## 서버 API

### 에이전트 API(Bearer 토큰, `Origin` 헤더가 있으면 403 — 기존 규칙 그대로)

| 경로 | 범위 | 내용 |
|---|---|---|
| `GET /api/agent/v1/library/changes?since=<rev>&limit=` | `library:read` | 동기화의 `pullChanges`를 그대로 쓴다. 항목 `{ kind, id, rev, deleted, doc }`을 `rev` 순으로 준다 |
| `POST /api/agent/v1/library/edit` | `library:write` | 아래 |
| `POST /api/agent/v1/library/undo` | `library:write` | 아래 「되돌리기」 |
| `GET /api/agent/v1/library/edits` | `library:read` | 이 사용자의 변경 기록 목록 |

### `edit`

요청: `{ v: 1, requestId, ops: [{ op: 'put' | 'delete', kind, id, baseRev, doc? }] }`. 한 번에 최대 50개. `requestId`는 같은 요청의 변경을 묶는 UUID(되돌리기 묶음 단위이며, 같은 `requestId`로 다시 보내면 이미 적용된 항목은 건너뛴다).

재전송 처리: 항목마다 1단계보다 먼저 같은 `request_id`·`kind`·`item_id`의 `agent_changes` 기록을 찾는다. 있으면 1~6단계를 건너뛰고 `{ status: 'ok', rev: <그 기록의 after_rev> }`로 답한다(저장된 행은 이미 `after_rev`로 올라가 있어 1단계를 먼저 하면 `conflict`가 난다). 기록이 없는 항목(앞 요청에서 거절됐거나 바뀐 내용이 없어 기록되지 않은 항목)은 1단계부터 다시 처리한다. 바뀐 내용이 없던 항목은 `rev`가 그대로라 다시 처리해도 같은 결과다.

항목마다 순서대로 1~4단계를 검사하고, 통과한 항목을 5단계에서 `pushItems` 한 번으로 쓴다(항목마다 따로 쓰면 50개 요청이 D1 질의를 수백 번 부른다). 하나가 실패해도 나머지는 적용한다(동기화 `push`와 같다). 같은 `kind:id`가 한 요청에 두 번 오면 요청 전체를 `422 invalid`로 거절한다(`parsePushBody`와 같다).

1. 저장된 행을 읽는다. 행이 있으면 `baseRev`가 행의 `rev`와 같아야 하고, 없으면 `baseRev`는 0이어야 한다. 다르면 `conflict`와 현재 문서를 돌려준다.
2. `put`: 서버가 문서의 필드 시각을 찍는다. `{ value, updatedAt }` 모양 필드 중 이전 값과 다른 것(새 항목은 전부)의 `updatedAt`을 `now`로 둔다. 그래야 기기의 마지막 변경 우선(LWW) 병합에서 AI 수정이 이긴다. 클라이언트가 보낸 `updatedAt`은 쓰지 않는다.
3. `delete`: 저장된 문서에 `deletedAt: now`를 둔 묘비로 바꾼다. 이미 지워진 항목이나 없는 항목은 `missing`.
4. 참조 검사(`pushItems`가 하지 않는 것):
   - 여행을 `put`할 때 참조하는 장소(출발지·숙소·Stop·후보)의 행이 없으면 `invalid-ref`. 행이 묘비인 장소는 참조할 수 있다(기존 여행 설계 §3.1·§3.3과 `src/schema/library.ts`의 `LibrarySchema` 검사와 같다). 따라서 묘비 장소를 참조하는 여행도 제목 등을 고칠 수 있다. 여행은 라벨을 참조하지 않는다. 장소(`labelIds`)·폴더(`labelId`)의 라벨 참조는 서버가 검사하지 않는다(사용자 결정 2026-11-06). 없거나 지워진 라벨을 가리키면 기기의 `repairLibrary`가 장소에서는 그 참조를 떼어 내고 폴더 연결은 지워서 AI 수정 일부가 사라질 수 있다. AI는 쓰기 전에 `library/changes`로 라벨이 있는지 확인한다.
   - 장소를 `delete`할 때 지워지지 않은 여행의 `refs`가 그 장소를 가리키면 `referenced`.
   - `put`의 문서는 `deletedAt: null`만 받는다(아니면 `invalid`). 삭제는 `delete`로만 한다. 그래서 묘비 `put`이 `referenced` 검사를 우회하지 못한다(사용자 결정 2026-11-06).
   - 검사 기준은 「저장된 행 + 같은 요청에서 앞서 1~4단계를 통과한 항목의 결과」다(메모리에서 겹쳐 본다). 그래서 앞에서 새로 만든 장소를 뒤의 여행 `put`이 참조할 수 있고, 앞의 여행 `put`으로 참조를 뺀 장소는 뒤에서 `delete`할 수 있다. 앞에서 `delete`를 통과한 장소도 행은 묘비로 남으므로 뒤의 여행 `put`에서 참조할 수 있다.
   - 5단계에서 `pushItems`가 앞 항목을 거절하면(`too-large` 등) 그 항목에 기댄 뒤 항목의 참조가 빌 수 있다. 드물고 기기 동기화로도 생기는 상태라 따로 막지 않는다. AI는 결과의 거절 사유를 보고 다시 읽어 고친다.
5. 통과한 항목을 `pushItems(db, user, { v: 1, deviceId, items }, now)`로 쓴다. 스키마 검사(`decodeItem`)·시계 검사·항목 크기·사용자별 상한(5,000항목·5MB)은 그대로 `rejected`(`invalid`·`clock`·`too-large`)로 나온다. `deviceId`는 `'agnt' + tokenId`(공개 토큰 id 12자 a-z0-9를 붙인 16자로, `src/server/library-sync/library.ts`의 `devicePattern` `/^[a-z0-9]{16}$/`에 맞음).
   - 현재 `pushItems`는 저장본의 `rev`가 `baseRev`와 다르면 `mergeItem`으로 병합하므로, 1단계 검사만으로는 「그 사이 바뀌었으면 거절」을 보장하지 못한다. 구현할 때 `pushItems`에 병합하지 않는 쓰기 방식을 추가해 에이전트 편집에 사용한다. 기존 기기 동기화의 기본 병합 동작은 유지한다.
   - 이 방식은 실제 쓰기 시점에도 항목의 `rev === baseRev`(없는 행은 `baseRev === 0`)를 조건으로 검사한다. 읽기와 쓰기 사이에 행이 바뀌거나 새로 생기면 해당 항목은 쓰지 않고 `conflict`와 현재 문서를 돌려준다. 내부 재시도에서도 원래 `baseRev`를 유지하고 병합하지 않는다. 다른 항목은 계속 적용한다. 쓰기 뒤 `results[].doc`의 유무로 충돌을 판단하는 것으로 대신하지 않는다(이미 병합해 저장한 뒤이기 때문이다).
6. 적용된 항목(`pushItems`가 실제로 쓴 항목. 바뀐 내용이 없어 쓰지 않은 항목은 빼고)마다 `agent_changes`에 이전 문서(새 항목이면 `null`)와 `before_rev`·`after_rev`를 기록한다.
   - `before_doc`·`before_rev`는 쓰기 조건을 통과한 이전 행, `after_rev`는 그 쓰기 결과다. `conflict` 항목은 기록하지 않는다. 따라서 1단계 이후 다른 기기의 변경을 병합한 결과와 낡은 이전 문서를 묶어 기록하지 않는다.

응답: `200 { rev, results: [{ kind, id, status, rev?, doc? }] }`. `status`는 `ok`·`conflict`·`missing`·`referenced`·`invalid-ref`·`invalid`·`too-large`·`clock`. `conflict`에는 현재 문서를 `doc`으로 싣는다.

한도: 사용자별 하루 AI 쓰기 500항목(기존 `consumeCounter`, 키 `agent-edit`). 넘으면 `429 rate-limited`.

### 되돌리기

요청(`undo`, 앱 경로도 같음): `{ ids: [<변경 id>] }` 또는 `{ requestId }`. 가장 최근 변경부터(`at` 내림차순, 같으면 `rowid` 내림차순) 하나씩 처리한다.

- 지금 행의 `rev`가 그 변경의 `after_rev`와 같을 때만 되돌린다. 다르면 그 사이 다른 기기나 AI가 고친 것이라 `changed`로 건너뛴다(덮어쓰지 않는다).
  - 되돌리기 쓰기도 위의 병합하지 않는 방식을 사용하고 `after_rev`를 `baseRev`로 넘긴다. 실제 쓰기 시점의 충돌은 `changed`로 처리하고 `undone_at`을 찍지 않는다.
- `before_doc`이 있으면 `put`처럼 필드 시각을 `now`로 찍어 복원한다. `null`(AI가 새로 만든 항목)이면 지운다(묘비).
- **제약(사용자 결정 2026-11-06)**: 되돌리기도 새 `rev`를 만들기 때문에, 같은 항목에 AI 변경이 여러 개 쌓였으면 그 항목은 가장 최근 변경 하나만 되돌릴 수 있다. 앞선 변경은 최신 변경을 되돌린 뒤에도 `changed`로 남는다. 필요하면 사람이 직접 고치거나 백업으로 되살린다.
- 되돌린 변경은 `undone_at`을 찍어 다시 되돌리지 못하게 한다. 되돌리기 자체는 새 변경 기록을 만들지 않는다.
- 응답: `{ results: [{ id, status: 'undone' | 'changed' | 'already' | 'gone' }] }`(`gone`은 기록 만료).

### 앱 경로(동기화 세션 인증, 기존 `/api/sync/v1/agent/*` 옆)

- `GET /api/sync/v1/agent/changes` → 변경 기록(최근 100건·30일, 항목 종류·이름·시각·토큰 이름·되돌림 여부). 문서 본문은 싣지 않는다.
- `POST /api/sync/v1/agent/changes/undo` → 위 되돌리기와 같은 함수.

## D1(스키마 버전 8)

`agent_changes`: `id TEXT PRIMARY KEY`, `user_id`, `token_id`, `request_id`, `kind`, `item_id`, `before_doc TEXT`(null 가능), `before_rev INTEGER`, `after_rev INTEGER`, `label TEXT`(표시 이름, 항목 이름을 잘라 저장), `at INTEGER`, `undone_at INTEGER`. 인덱스 `(user_id, at)`.

- 새 기록을 쓴 뒤 그 사용자의 100건 초과·30일 지난 행을 `waitUntil`로 지운다(기존 받은함 정리와 같은 방식). 크기 상한은 항목 상한(`ITEM_DOC_MAX_CHARS` 200,000자)과 같아 별도로 두지 않는다. 최악의 경우 사용자당 100 × 200KB = 20MB이므로, `before_doc`은 합계 5MB를 넘으면 가장 오래된 기록부터 지운다.
- `ACCOUNT_DATA_TABLES`에 `agent_changes`를 더한다(`서버 자료 모두 지우기`가 함께 지운다).

## CLI(`yarn trip library …`)

`list`(`--kind`, `--json`), `get <kind> <id>`, `put <kind> <id> --file <문서.json> --base-rev <N>`, `delete <kind> <id> --base-rev <N>`, `changes`, `undo <변경 id>|--request <id>`. `list`·`get`은 `library/changes`로 읽는다. `put`은 문서 본문을 앱 스키마로 검사한 뒤(`src/domain/library-sync/items.ts`의 `decodeItem`) 보낸다. 끝 코드는 기존 규칙(성공 0, 입력 2, 서버 5)을 따르고, `conflict`·참조 오류는 서버 거절로 끝 코드 5와 사유를 낸다.

워크스페이스 스킬 `korea-trip-planner`에 「보관함 편집(요청할 때만, 읽고 → baseRev와 함께 쓰기)」를 더한다(저장소 밖 파일, 계획 마지막 단계).

## 앱

- 설정 › 동기화 › AI 연결: `새 연결 만들기`에 스위치 「보관함 읽기·쓰기 — AI가 보관함·여행을 직접 고칠 수 있어요」(기본 꺼짐). 연결 목록 줄에 범위 표시.
- 같은 곳에 `AI 변경 기록` 창: 항목별 `되돌리기`, 같은 요청 묶음의 `모두 되돌리기`. `changed`로 건너뛴 항목은 「그 사이 바뀌어서 그대로 뒀어요」로 알린다. 창 위에 「같은 항목은 가장 최근 변경만 되돌릴 수 있어요」를 적는다. 되돌린 뒤 동기화를 한 번 부른다.
- 알림: 받은함 확인이 도는 때(동기화가 끝난 뒤, 10분에 한 번까지, 숨은 탭 제외) 변경 기록도 같이 읽어 새 변경이 있으면 「AI가 보관함을 바꿨어요 N건 · 기록 보기」. 이미 알린 변경 id는 기기 키 `tripmap:agent-inbox:v1`에 함께 둔다(옛 버전은 모르는 필드를 떼어 내므로 알림이 다시 뜰 수 있을 뿐 데이터 걱정은 없다).
- 도움말: 설정 도움말 팁 한 줄(생성기 원본 `scripts/motion/help-pages.mjs`에서 고치고 `yarn build:motion`).
- 개인정보 처리방침(`src/sections/privacy/privacy-content.ts`)의 AI 연결 항목에 「읽기·쓰기를 켠 연결은 보관함 전체를 읽고 고칠 수 있고, 고치기 전 값을 30일 보관해요」를 더한다.

## 보안

- 읽기·쓰기를 켠 토큰은 보관함 전체(메모·방문 기록·약속)를 읽고 바꿀 수 있다. 기본 꺼짐, 토큰 90일 만료·철회(기존)가 그 위험을 줄인다. 약속 문서(`MeetingSchema`)에는 주최자 토큰 같은 비밀 값이 없다는 것을 확인했다(비밀은 약속 서버 쪽에 있다).
- `edit`는 사용자별 하루 500항목(같은 사용자의 모든 토큰 합산), 한 번에 50개로 제한한다.
- 서버는 문서 내용을 AI 입력 지시로 해석하지 않는다. 항목 본문은 데이터다.

## 호환·롤백

- 새 D1 표 하나(스키마 7 → 8). 옛 코드로 되돌려도 표와 `schema_meta` 8은 남고, 옛 코드는 이를 읽지 않는다.
- 되돌려도 이미 반영된 AI 수정은 평범한 보관함 항목이라 그대로 남는다(문제가 있으면 앱의 `AI 변경 기록`은 새 버전에서만 보이므로, 되돌리기 전에 기록으로 되돌려 둔다).
- 저장 형식·공유 형식·백업 형식은 바뀌지 않는다.

## 단계(PR 2개)

1. **PR ①** 서버·CLI: 범위, `edit`·`undo`·`library/changes`·`edits`, `agent_changes`, 앱 경로 두 개, `AGENT_EDIT`, CLI. 서버 시험은 SQLite D1(`tests/helpers/sqlite-d1.ts`).
2. **PR ②** 앱: 연결 만들기 스위치, `AI 변경 기록` 창, 알림, 도움말, 처리방침, 롤백 문서·`docs/development.md`.

쓰기 범위 토큰은 PR ②가 병합되기 전에는 만들 수 없다(토큰 발급 경로가 `library:write`를 받지 않다가 PR ②에서 켠다). 되돌리기 화면 없이 AI가 쓰지 못하게 하려는 것이다.

## 병합 뒤 확인

병합 2주 뒤(2026-11-20 이후) 실제로 AI가 보관함을 고쳤는지 `agent_changes`로 확인한다. 쓰지 않았으면 걷어내는 PR을 제안한다.

## 시험

- 서버: `edit`(추가·교체·삭제, 새 항목 `baseRev` 0, `conflict`, 참조 오류, 필드 시각 찍기, 상한·시계·크기 거절, `requestId` 재전송), `undo`(복원·`changed`·`already`·새 항목 지우기·묶음), 기록 정리(100건·30일·5MB), 범위·`AGENT_EDIT`·`AGENT_API` 스위치, 계정 삭제 시 표 정리.
- 경합: `edit`의 1단계 이후·실제 쓰기 직전에 다른 기기가 수정하거나 같은 id를 만들면 `conflict`, 그 기기 값 보존·변경 기록 없음. 쓰기 재시도에서도 병합하지 않는지 확인한다. 정상 편집 뒤 되돌리기는 직전 문서를 복원하고, 되돌리기 검사와 쓰기 사이의 변경은 `changed`로 보존한다. 기존 기기 동기화는 계속 병합한다.
- CLI: 인자 검사, 서버 오류 → 끝 코드.
- 앱: 연결 만들기 스위치, `AI 변경 기록`(되돌리기·건너뜀 문구), 알림.
- 같은 동작을 여러 층에서 겹쳐 시험하지 않는다. 새 E2E는 만들지 않는다(기존 AI 연결 화면 E2E가 있으면 그것만 맞춘다).

## 열린 항목(계획 1단계에서 코드로 확인)

- 필드 시각 찍기 함수: `{ value, updatedAt }`를 재귀로 찾아 이전 값과 비교(`src/schema/library-base.ts`의 `FieldSchema` 사용처 전체).
- 여행 문서가 참조하는 항목 목록을 구하는 함수(`tripRefs`)로 출발지·숙소·Stop·후보를 모두 얻는지.
