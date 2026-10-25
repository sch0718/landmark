# 약속 온라인 집계 설계

새로 만드는 약속을 서버(Cloudflare D1)에 올려, 친구 답장이 답장 링크 없이 주최자에게 자동으로 모이게 한다.
[서버·DB 도입 검토 제안서](2026-10-25-server-db-proposal.md) 로드맵의 1단계다. 계정 로그인은 쓰지 않고 약속 단위 토큰으로 권한을 나눈다.

## 결정 요약(브레인스토밍 2026-10-25)

| 항목 | 결정 |
|---|---|
| 링크 방식 | **새 약속은 서버만** 쓴다. 이미 만든 약속은 지금의 링크 방식(`#d=`·`#r=`·`#f=`)으로 남는다 |
| 구조 | Pages Functions + D1. 약속 본문과 참석자별 답장을 다른 표에 둔다. 소요시간은 브라우저가 계산한다 |
| 갱신 | 약속 화면이 열려 있는 동안 10초마다 버전만 확인하고, 바뀌었을 때만 받는다. WebSocket은 쓰지 않는다 |
| 주최자 다른 기기 | 주최자 전용 비밀 링크(`/meet/<id>#h=<토큰>`, 복사·QR). 다시 발급하면 이전 링크는 철회 |
| 참석자 확인 | "나는 누구?"를 먼저 고른 기기가 그 참석자를 차지한다. 주최자가 풀어 줄 수 있다 |
| 서버 보관 | 약속 일시와 마지막 변경 중 늦은 쪽에서 30일 뒤 지운다. 주최자는 언제든 먼저 지울 수 있다. 주최자 보관함의 사본은 남는다 |
| D1 만들기 | 사용자가 대시보드에서 만든다(운영 `landmark`, 미리보기 `landmark-preview`). 결제 정보는 필요 없다 |
| 남용 방지 | 약속 올리기에 Turnstile(보이지 않는 방식) + IP 해시별 일 한도 |
| 구현 | Codex(gpt-6.1-sol high)가 구현하고 Claude가 검증한다 |

## 하지 않는 것

- 계정 로그인(제안서 §4: 3단계 직전에 정한다).
- 즉시 갱신(Durable Objects WebSocket). 약속은 몇 분 단위로 모이므로 10초 확인이면 충분하다.
- 서버에서 경로 계산. 지금처럼 브라우저가 `/api/route`로 계산한다.
- 이미 만든 링크 방식 약속을 서버 방식으로 옮기기.
- 이메일·푸시 알림. 확정은 열린 화면에서 보인다.
- 예약 작업(Cron). Pages 함수는 Cron을 못 쓰고 계정 Cron 5개를 아끼려고, 만료 정리는 요청 때 함께 한다.

## 사용 흐름

### 주최자

1. 지금처럼 약속을 만들고 참석자·후보를 고른다.
2. `후보 링크 보내기`를 처음 누르면 약속을 서버에 올리고(Turnstile 확인) 주최자 토큰을 받는다. 짧은 친구 링크 `/meet/<id>`를 Web Share API(없으면 클립보드)로 보낸다.
   서버에 올린 뒤 참석자·후보·일시·이동수단을 고치면 본문을 다시 올린다(`rev` 비교).
3. 약속 화면을 열어 두면 10초마다 확인해 친구 답장을 **자동으로** 집계표에 넣는다. `반영` 단추는 서버 방식 약속에는 없다.
   받은 답장은 보관함 `meetings[id].replies`와 참석자 출발지에도 써 둔다(백업·서버 만료 뒤에도 남음). 친구가 보낸 소요시간 줄도 화면 계산에 쓴다.
4. 약속 화면 메뉴
   - `다른 기기에서 열기`: 주최자 링크 복사·QR. `다시 발급`하면 이전 주최자 링크는 쓸 수 없다.
   - `참석자 차지 풀기`: 참석자를 고르면 그 기기의 참석자 토큰을 철회한다(다른 기기에서 다시 고를 수 있음).
   - `서버에서 지우기`: 서버 사본과 토큰을 지운다. 보관함의 약속은 남고 링크 방식이 아니라 "공유 끝남"으로 표시한다.
5. `확정`·`확정 취소`도 서버에 올린다. 열린 친구 화면은 10초 안에 확정 화면으로 바뀐다.

### 친구(`/meet/<id>`)

1. 약속 제목·일시·이동수단, 후보 지도·목록, 다른 사람들의 좋아요 집계를 본다.
2. "나는 누구?"에서 참석자를 고르거나 `목록에 없어요`로 이름을 넣는다. 고른 기기가 그 참석자를 차지한다.
   이미 다른 기기가 차지했으면 "다른 기기에서 이미 답했어요. 주최자에게 풀어 달라고 하세요"를 보인다.
3. 출발지를 바꾸면 이 기기에서 자기 줄의 소요시간을 다시 계산한다(지금과 같음).
4. 좋아요·출발지는 바꿀 때마다 저장한다(1초 모았다가 한 번에 보냄). `답장 링크 보내기`는 없다.
5. 확정되면 지금의 확정 화면(장소·일시·참석자별 길찾기)을 보인다.
6. 다시 열면 이 기기의 참석자 토큰으로 이어서 고친다.

### 주최자 링크(`/meet/<id>#h=<토큰>`)

- 토큰을 확인하면 서버 본문으로 이 기기 보관함에 약속을 담고(같은 id가 있으면 서버 본문으로 갱신) 주최자 화면 `/meetings/<id>`로 간다.
- 해시는 읽은 뒤 `history.replaceState`로 지운다(주소 표시줄·방문 기록에 토큰을 남기지 않기 위해).

### 끝난 약속·없는 약속

- 만료됐거나 지워진 약속은 "끝난 약속이에요"와 약속 목록 단추를 보인다. 주최자 기기는 보관함 사본을 그대로 쓰고 "공유 끝남"으로 표시한다.

## 서버 데이터(D1)

```sql
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,              -- 보관함 약속 id(10자 a-z0-9)
  doc TEXT NOT NULL,                -- 본문 JSON(아래 MeetingDoc)
  rev INTEGER NOT NULL,             -- 본문·답장·차지가 바뀔 때마다 서버가 1씩 올린다
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL          -- max(약속 일시, updated_at) + 30일
);
CREATE INDEX meetings_expires ON meetings(expires_at);

CREATE TABLE meeting_replies (
  meeting_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,     -- 본문 참석자 id, 또는 claim 때 서버가 만든 새 참석자 id
  name TEXT NOT NULL,
  origin TEXT,                      -- Origin JSON 또는 NULL(본문 출발지를 그대로 씀)
  likes TEXT NOT NULL,              -- 후보 id 배열 JSON
  times TEXT,                       -- 출발지를 바꿨을 때 그 줄의 후보 id → 값 JSON
  updated_at TEXT NOT NULL,
  PRIMARY KEY (meeting_id, participant_id)
);

CREATE TABLE meeting_tokens (
  hash TEXT PRIMARY KEY,            -- SHA-256(토큰) base64url
  meeting_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- 'host' | 'guest'
  participant_id TEXT,              -- guest만
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX meeting_tokens_guest ON meeting_tokens(meeting_id, participant_id) WHERE kind = 'guest';

CREATE TABLE rate_counters (
  key TEXT PRIMARY KEY,             -- '<동작>:<IP 해시>:<UTC 날짜>'
  count INTEGER NOT NULL
);

CREATE TABLE schema_meta (version INTEGER NOT NULL);  -- 1
```

- `MeetingDoc`은 지금 후보 링크 문서(`InviteDocSchema`, `src/domain/meeting/link.ts`)에서 `format`·`v`·`kind`를 빼고 `decided: 후보 id | null`을 더한 모양이다.
  참석자 원래 좌표·이름, 후보, 소요시간 표(`times`), 단위, 일시, 이동수단이 들어간다. 한도는 지금 약속 한도(참석자 10, 후보 8, 본문 64KB)를 그대로 쓴다.
- 친구가 `목록에 없어요`로 들어오면 서버가 새 참석자 id(8자)를 만들어 `meeting_replies`에 넣는다. 본문 참석자와 합쳐 10명을 넘으면 거절한다.
  주최자 기기는 다음 확인 때 그 참석자를 보관함 약속의 참석자 목록에 더한다.
- 마이그레이션은 저장소 `migrations/0001_meetings.sql`부터 추가형으로만 쓴다(`wrangler d1 migrations`).
  D1 행 한도 2MB(제안서 §3.1) 안에 본문 64KB가 들어간다.

### 브라우저 저장

- 보관함 형식(`tripmap:library:v2`, schemaVersion 2)은 바꾸지 않는다.
- 새 키 `tripmap:meet-online:v1`: `{ [meetingId]: { hostToken?: string, guest?: { participantId, token }, lastRev: number, ended?: true } }`.
  주최자 토큰이 있는 약속이 "서버 방식 약속"이다. 깨진 값은 빈 기록으로 읽고, 저장소가 막히면 그 페이지 동안 메모리에만 둔다(도움말 `tripmap:help-seen:v1`과 같은 관례).
- 토큰은 보관함·백업 파일에 넣지 않는다. 그래서 백업을 다른 기기에 복원하면 그 기기는 주최자가 아니다(주최자 링크로 연결).

## API(Pages Functions)

경로는 `functions/api/meet/*`, 처리 코드는 `src/server/meet/*`. 응답은 모두 `Cache-Control: private, no-store`이고 기존 Cache API에 넣지 않는다.
요청 출처 검사(`isAllowedOrigin`, `src/server/http.ts`)는 그대로 한다. 토큰은 `Authorization: Bearer <토큰>`으로 보낸다(쿠키를 쓰지 않아 CSRF가 없음).

| 요청 | 하는 일 | 권한 | 성공 |
|---|---|---|---|
| `POST /api/meet` | 본문 올리기(`{ doc, turnstile }`) | 출처 + Turnstile + 한도 | `201 { id, rev, hostToken }` |
| `PUT /api/meet/:id` | 본문 바꾸기·확정·확정 취소(`{ doc, baseRev }`) | 주최자 | `200 { rev }`, `rev`가 다르면 `409 { rev }` |
| `GET /api/meet/:id?since=<rev>` | 본문 + 답장 전체 | 링크 소지자(주최자면 원래 좌표 포함) | `200 { rev, doc, replies }`, 안 바뀌었으면 `304` |
| `POST /api/meet/:id/claim` | 참석자 고르기(`{ participantId }` 또는 `{ newName }`) | 링크 소지자 + 한도 | `200 { participantId, guestToken, rev }`, 이미 차지됐으면 `409` |
| `PUT /api/meet/:id/reply` | 내 좋아요·출발지·소요시간 줄 저장 | 참석자 | `200 { rev }` |
| `POST /api/meet/:id/release` | 참석자 차지 풀기(`{ participantId }`) 또는 주최자 토큰 다시 발급(`{ host: true }`) | 주최자 | `200 { rev, hostToken? }` |
| `DELETE /api/meet/:id` | 서버 사본·토큰·답장 지우기 | 주최자 | `204` |

- 만료됐거나 없는 약속은 `410 ENDED`/`404 NOT_FOUND`. 만료 판단은 읽을 때마다 `expires_at`으로 한다.
- 만료 정리: `POST /api/meet` 때 만료된 약속을 최대 20개 지운다(답장·토큰 포함, D1 `batch`로 한 번에).
- 요청 본문의 `participantId`는 권한 증거로 쓰지 않는다. 답장 저장은 토큰이 가리키는 참석자 줄만 바꾼다.
- 친구에게 주는 `GET` 응답은 다른 참석자의 원래 좌표(`origin.lng/lat`)를 빼고 이름·출발지 이름·소요시간만 준다. 주최자 토큰이 있으면 전부 준다.
  지금 후보 링크는 참석자 좌표를 모두 담으므로, 서버 방식이 노출이 더 적다.
- 오류 코드는 기존 `ApiErrorCode`에 `UNAUTHORIZED`(401)·`CONFLICT`(409)·`ENDED`(410)·`RATE_LIMITED`(429)를 더한다.

## 화면 상태와 갱신

- 약속 화면(주최자 `/meetings/<id>`, 친구 `/meet/<id>`)이 보이는 동안만 10초마다 `GET ?since=<lastRev>`를 보낸다.
  숨겨지면 멈추고(`visibilitychange`), 다시 보이면 바로 한 번 확인한다. 오프라인이면 멈추고 온라인 복귀 때 확인한다.
- 실패가 이어지면 간격을 10초 → 30초 → 60초로 늘린다. 화면에 "○분 전 기준" 표시를 둔다.
- 주최자 본문 저장이 `409`면 서버 본문을 받아 보관함과 합친 뒤(서버의 새 참석자·답장 반영) 다시 올린다. 본문은 주최자만 고치므로 충돌은 주최자의 두 기기 사이에서만 생긴다.
- 친구 답장 저장 실패는 이 기기 초안(`tripmap:meet-drafts:v1`, 지금 있음)에 남기고 다음 확인 때 다시 보낸다.

## 오류·장애

| 상황 | 동작 |
|---|---|
| 서버 장애·무료 한도 초과·오프라인 | 약속 만들기·계산은 그대로 된다. `후보 링크 보내기`는 "지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요". 열린 화면은 마지막 집계를 보인다 |
| Turnstile 실패 | "확인에 실패했어요. 다시 해 주세요" |
| 일 한도 초과(429) | "오늘은 더 만들 수 없어요" 같은 동작별 안내 |
| 주최자 토큰 철회됨(401) | "이 기기의 주최자 연결이 끊겼어요. 주최자 링크로 다시 연결하세요" |
| 참석자 토큰 철회됨(401) | 참석자 선택으로 돌아간다 |
| 410/404 | "끝난 약속이에요" |

## 남용 방지·보안

- 토큰: `crypto.getRandomValues` 32바이트 → base64url. 서버는 SHA-256 해시만 저장·비교한다.
- IP 해시별 하루 한도(UTC 날짜 기준, `rate_counters`): 약속 올리기 20, 참석자 고르기 60, 답장 저장 600, 본문 바꾸기 300.
  IP는 `CF-Connecting-IP`를 서버 시크릿 `IP_HASH_SALT`와 함께 해시해 쓰고 원문은 저장하지 않는다. 지난 날짜 카운터는 만료 정리 때 함께 지운다.
- Turnstile: 약속 올리기에만 쓴다. 사이트 키는 프론트 환경 변수(`VITE_TURNSTILE_SITE_KEY`, 공개 값), 비밀 키는 Pages 시크릿 `TURNSTILE_SECRET`. 스크립트는 `후보 링크 보내기`를 누를 때만 불러온다.
  개발(localhost)은 Cloudflare가 공개한 시험용 키를 쓴다.
- 입력 검사는 Effect 스키마(`InviteDocSchema`에서 파생한 `MeetingDocSchema`, `ReplyDocSchema` 계열)를 서버에서도 쓴다.
  지금 함수 코드 규칙("React·MUI·Effect를 가져오지 않습니다", `docs/development.md:83`)을 이 기능에서 바꾸고 문서를 고친다.
  함수 번들은 첫 로딩과 무관하지만, 무료 CPU 10ms 안에 끝나는지 미리보기 배포에서 실측한다. 넘으면 그 경로만 손 검사로 바꾼다.
- 미리보기 배포(`*.landmark-c5f.pages.dev`)는 미리보기 D1(`landmark-preview`)을 쓴다. 운영 D1을 읽지 않는다.
- 시크릿·키는 저장소에 넣지 않는다. 저장소의 `wrangler.toml`에는 D1 바인딩 이름 `DB`와 DB id(비밀 아님)만 둔다.
- 약속 id는 10자 `a-z0-9`(약 51비트)라 추측하기 어렵고, 읽기도 IP별 한도(하루 5,000)를 둔다.

## 첫 로딩·코드 위치

- 온라인 코드(`src/services/meet-online/*`, Turnstile 로더)는 이미 지연 로딩되는 약속 화면(`MeetingsPage`·`MeetingEditorPage`·`MeetLinkPage`)에서만 가져온다.
  `yarn size --require-lazy`가 그대로 통과해야 한다. 지금 첫 로딩 여유는 약 11,066바이트다(제안서 §9.2).
- 라우터에 `/meet/:id`를 더한다(같은 `MeetLinkPage` 지연 덩어리). Pages SPA 기본 동작(`docs/development.md:211`)으로 서버 설정은 필요 없다.
- 서버 처리 코드는 작은 DB 인터페이스(`prepare/bind/first/all/run/batch`의 필요한 부분)에만 기대게 해 시험에서 바꿔 끼운다.

## 호환·롤백

- 이미 만든 약속(주최자 토큰이 없는 약속)은 링크 방식 그대로다. `#d=`·`#r=`·`#f=` 읽기와 `반영`도 남긴다.
- 보관함 형식이 그대로라 옛 버전도 보관함을 읽는다. 서버 방식 약속도 보관함에서는 보통 약속으로 보인다.
- **옛 버전으로 되돌리면** 친구 링크 `/meet/<id>`를 옛 앱이 모르므로 열리지 않는다(약속 목록으로 감). 주최자 보관함과 이미 받은 답장은 남는다. D1 자료는 지우지 않으며, 새 버전으로 돌아오면 이어서 쓴다.
  이 내용을 구현 PR 병합 뒤 `docs/rollback.md`에 적는다.
- 서버 기능 스위치: 환경 변수 `MEET_ONLINE=off`면 `POST /api/meet`가 `503`을 돌려주고, 앱은 새 약속을 링크 방식으로 공유한다(장애 때 비상구). 이미 올린 약속의 읽기·답장은 계속 된다.

## 사용자가 할 일(구현 PR 전)

1. Cloudflare 대시보드 › Storage & Databases › D1에서 DB 두 개를 만든다: `landmark`(운영), `landmark-preview`(미리보기). 위치 힌트는 `apac`.
2. Pages 프로젝트 `landmark` › Settings › Bindings에서 운영 환경에 `DB` → `landmark`, 미리보기 환경에 `DB` → `landmark-preview`를 연결한다.
3. Turnstile에서 위젯 하나를 만든다(호스트 `landmark.sch0718.dev`·`landmark-c5f.pages.dev`, 보이지 않는 방식). 사이트 키를 알려 주고, 비밀 키는 Pages 시크릿 `TURNSTILE_SECRET`에 직접 넣는다.
4. Pages 시크릿 `IP_HASH_SALT`(아무 긴 무작위 값)를 넣는다.
5. 두 DB의 id를 알려 준다(`wrangler.toml`에 적음). 마이그레이션 적용 명령은 구현 계획에 적는다.

모두 무료이고 결제 정보는 필요 없다(D1·Turnstile, 제안서 §3.1).

## 시험

- 단위(vitest): 서버 처리 함수를 Node 24 내장 `node:sqlite`로 만든 가짜 D1에서 시험한다(새 의존성 없음).
  - 올리기·읽기·304, 주최자 권한, `rev` 충돌(409), 차지 충돌·풀기, 새 이름 참석자와 10명 한도, 답장 권한(남의 줄 못 고침),
    친구 응답에서 원래 좌표 빠짐, 만료(410)와 정리, 일 한도(429), 기능 스위치(503), 입력 검사 실패.
- 단위: 브라우저 쪽 갱신 주기(보임·숨김·오프라인·실패 간격), 서버 답장을 보관함 약속에 합치기, `tripmap:meet-online:v1` 읽기·깨진 값.
- E2E(Playwright): `wrangler pages dev`의 로컬 D1로 주최자·친구 두 브라우저 문맥이 올리기 → 고르기 → 답장 → 자동 집계 → 확정 → 친구 확정 화면을 확인한다.
  차지 충돌(세 번째 문맥)과 주최자 링크로 다른 문맥 연결도 본다.
- 미리보기 배포에서 CPU 시간(Workers 지표)과 응답을 확인한다.

## 완료 조건

- 위 시험 통과, `yarn build:ci`(크기 검사 포함) 통과.
- 운영에서 휴대폰 두 대로 약속을 올리고 친구 답장이 10초 안에 주최자 화면에 들어오는 것을 확인한다.
- `docs/development.md`(D1·시크릿·로컬 실행·함수 규칙), 도움말 약속 메뉴, `docs/rollback.md`(병합 뒤 PR)를 고친다.
