# 여행 갱신 공유 설계(2A)

여행 일정을 **갱신 링크**로 보내면, 소유자가 일정을 고칠 때 받은 사람의 보기 화면도 10초 안팎에 바뀐다.
[서버·DB 도입 검토 제안서](2026-10-25-server-db-proposal.md) 9절 로드맵의 2A 단계다. 계정 로그인은 쓰지 않고 공유 단위 토큰(소유자·보기)으로 권한을 나눈다.
약속 온라인 집계([1단계 설계](2026-10-25-meeting-online-design.md))의 D1·토큰·Turnstile·IP 카운터·만료 정리·기능 스위치 관례를 그대로 따른다.
2B(여행 함께 편집·당일 진행)는 이 문서의 서버 자료 모델 위에 올라간다(§2B가 이어 쓰는 것).

사용자 결정(룰링)은 작업 지시의 「서버 로드맵 2A·2B·3·4 공통 브리프」(2026-10-29)에서 확정된 것이다. 이 문서에서 새로 정한 것은 맨 끝 「결정과 근거」 표에 이유와 함께 적었다.

## 결정 요약

| 항목 | 결정 |
|---|---|
| 권한 | 로그인 없음. 공유 하나에 **소유자 토큰**(기기 저장, 고치기·지우기·링크 다시 만들기)과 **보기 토큰**(링크 소지자 읽기)을 둔다 |
| 링크 | 보기 링크 `<출처>/view#t=<공유 id>.<보기 토큰>`(약 90자, 카카오톡 400자 한도 안). 소유자 링크 `<출처>/trips/live/<공유 id>#h=<소유자 토큰>` |
| 받는 화면 | 지금의 보기 화면(`/view`, Effect 없는 별도 번들)에 갱신 모드를 더한다. 앱 첫 로딩과 무관하다 |
| 서버 문서 | `LiveTripDoc` v1 = 지금의 일정 공유 문서(`ShareDocV2`) + Day·Stop 안정 id + 공유 옵션. 서버·보기 화면·앱이 같은 손 검사(`parseLiveDoc`)를 쓴다 |
| 저장 | D1 일반 저장(종단간 암호화 없음). 공유 창에서 누르기 전에 알린다 |
| 갱신 | 소유자 기기가 고친 뒤 자동으로 올린다(편집 지문이 바뀔 때만). 보기 화면은 보이는 동안 10초마다 `since=<rev>`로 확인 |
| 소유자 다른 기기 | 소유자 링크로 열면 서버 공개본을 그 기기 보관함에 **새 여행으로** 담고 소유자가 된다. 두 기기가 겹쳐 고치면 `409`로 묻는다(조용한 덮어쓰기 없음) |
| 철회 | `보기 링크 다시 만들기`(이전 보기 링크 즉시 철회), `소유자 링크 다시 만들기`, `서버에서 지우기` |
| 내보내기 | 보기 화면에서 지금 공개본을 `파일로 저장`(HTML)·`Landmark에 담기`(기존 여행 형식). 소유자 창에서 `공개본 파일 저장` |
| 보관 기간 | `min(갱신 + 180일, max(갱신 + 30일, 여행 끝날 + 30일))`. 소유자가 올릴 때마다 다시 계산 |
| 남용 방지 | 만들기에 Turnstile + IP 해시 일 한도, 요청 600,000바이트·문서 524,288바이트 한도, 없는·끝난 공유 읽기 한도, 요청 때 만료 정리 |
| 기능 스위치 | `TRIP_SHARE_LIVE=off`면 만들기·올리기만 `503`. 읽기·지우기·링크 다시 만들기는 계속 된다 |
| D1 | `SCHEMA_VERSION` 3. `trip_shares`·`trip_share_tokens` 두 표를 `SCHEMA_STATEMENTS` 끝에 더한다 |

## 하지 않는 것

- 함께 편집, 편집 초대, 기기별 편집 권한, 공동 진행 체크(2B).
- 보관함 전체 동기화·로그인(3단계).
- 즉시 갱신(WebSocket·Durable Objects). 10초 폴링으로 충분하다(룰링 1).
- 소유자 기기의 서버 폴링. 소유자는 올릴 때 `409`로 다른 기기의 변경을 안다.
- 서버에서 경로 계산. 구간 시간·경로선은 지금처럼 소유자 브라우저가 `/api/route`로 받아 문서에 넣는다.
- 기존 `링크 복사`(`/view#d=`)·HTML 파일·카카오톡 짧은 링크(`/s/<id>`)의 동작 변경. 셋은 그대로 남고, 갱신 링크는 그 옆에 더하는 선택지다.
- 장소 공유(장소 내보내기)의 갱신 링크. 여행 일정만 다룬다.
- 다른 소유자 기기 사이에서 장소 id 맞추기(2B에서 정한다. §2B가 이어 쓰는 것).
- 예약 작업(Cron). 만료 정리는 요청 때 한다.

## 사용 흐름

### 소유자(처음 기기)

1. 여행 계획 화면(또는 여행 목록 메뉴)의 `일정 공유`를 연다. 창 안 `후보 N곳도 넣기` 아래에 **갱신 링크** 줄이 생긴다:
   `받은 사람 화면도 일정을 고치면 바뀌는 링크를 만들 수 있어요` + `갱신 링크…` 단추.
2. `갱신 링크…`를 누르면 `갱신 링크` 창(새 지연 창)이 열린다. 제목(기본 여행 제목)·`메모 포함`(**기본 꺼짐**)·`후보 N곳도 넣기`(기본 켜짐)와 안내를 보인다.
   - 안내: `갱신 링크를 만들면 이 일정의 사본을 Landmark 서버에 {기한}까지 둬요. 서버에는 암호화하지 않고 저장해요. 링크를 받은 사람은 누구나 볼 수 있어요`
   - 메모 포함이면 `링크를 받은 사람은 누구나 메모를 볼 수 있어요`를 더한다.
   - 구간 경로 상태 줄은 일정 공유 창과 같다(`이동 경로를 받는 중이에요 (a/b)` 등).
3. `갱신 링크 만들기`를 누르면 Turnstile을 거쳐 서버에 올리고, 보기 링크와 `링크 복사`·`링크 공유`(Web Share API가 있을 때)·`카카오톡`(키가 있을 때) 단추를 보인다.
   보기 링크는 짧아서 카카오톡도 한 번 누르면 바로 보낸다.
4. 그 뒤 이 기기에서 여행을 고치면(계획 화면이 열려 있거나 갱신 링크 창이 열려 있을 때) 3초 모았다가 자동으로 올린다. 받는 화면은 10초 안팎에 바뀐다.
   보관함의 장소 이름·메모를 다른 화면에서 고친 것은 다음에 이 여행 계획 화면이나 갱신 링크 창을 열 때 올라간다.
5. `갱신 링크` 창의 관리 단추
   - `다른 기기에서 관리`: 소유자 링크를 공유·복사한다. 안내 `이 링크를 가진 사람은 일정을 바꾸고 공유를 지울 수 있어요. 내 기기에만 보내세요`.
   - `보기 링크 다시 만들기`: 확인 창(`지금 링크를 받은 사람은 더 볼 수 없어요`) 뒤 새 보기 토큰으로 바꾼다. 새 링크를 바로 보여 준다.
   - `소유자 링크 다시 만들기`: 다른 소유자 기기의 관리 연결을 끊는다(이 기기는 새 토큰을 받는다).
   - `공개본 파일 저장`: 서버의 지금 공개본을 HTML 파일로 받는다.
   - `서버에서 지우기`: 확인 창 뒤 서버 사본·토큰을 지운다. 보관함의 여행은 그대로다.
6. 창 머리에는 `마지막 반영 {HH:mm} · {기한}까지 보관`(또는 아래 상태 문구)을 보인다.

### 보기 링크 받은 사람(`/view#t=<id>.<토큰>`)

1. 보기 화면이 `갱신되는 일정을 불러오는 중이에요`를 보이고 `GET /api/trip-live/<id>`로 공개본을 받아 지금의 일정 보기(Day 탭·시간표·지도)로 그린다.
2. 화면 위 띠: `보낸 사람이 일정을 고치면 이 화면도 바뀌어요 · {HH:mm} 확인`과 `파일로 저장` 단추. 머리글의 `Landmark에 담기`는 지금처럼 이 공개본을 가져온다.
3. 화면이 보이는 동안 10초마다 확인한다. 바뀌었으면 고른 Day 탭을 유지한 채 다시 그리고 띠를 `일정이 바뀌었어요 · {HH:mm}`으로 바꾼다(`aria-live="polite"`). 지도 iframe은 다시 읽힌다.
4. 링크가 철회되면(`401`) `보낸 사람이 이 링크를 닫았어요. 새 링크를 받아 주세요`, 지웠거나 기한이 지나면(`404`·`410`) `공유가 끝난 일정이에요`를 띠에 보이고 확인을 멈춘다.
   이미 그린 일정은 남기고 `파일로 저장`도 계속 된다(마지막 공개본 내보내기). 처음부터 받지 못했으면 같은 문구만 보인다.

### 소유자 다른 기기(`/trips/live/<id>#h=<토큰>`)

1. 앱이 해시를 읽고 `history.replaceState`로 지운 뒤 소유자 토큰으로 공개본을 받는다.
2. 이 기기에 이미 같은 공유의 기록이 있으면 그 여행 계획 화면으로 간다.
3. 없으면 요약(제목·기간·일정 N곳)과 `이 기기에서 관리하기`를 보인다. 안내: `이 기기 보관함에 이 여행을 담고, 여기서 고친 내용도 갱신 링크에 반영해요. 다른 기기에서 고친 내용과 겹치면 어느 쪽을 쓸지 물어봐요`.
4. 누르면 공개본을 **새 여행**으로 담는다(장소는 받은 공유 가져오기 규칙으로 합침, 여행 id는 원래 기기의 id가 비어 있으면 그대로, Stop id·Day id는 서버 것 유지). 기록을 만들고 계획 화면으로 간다.
   담은 직후의 편집 지문을 기록해 두므로, 이 기기에서 고치기 전에는 올리지 않는다.
5. 두 소유자 기기가 번갈아 고치면 늦게 올린 쪽이 `409`를 받고 알림을 띄운다:
   `다른 기기에서 갱신 링크의 일정을 바꿨어요` · `이 기기 일정으로 바꾸기`(서버 버전 위에 덮어씀) · `반영 멈추기`(이 기기는 더 올리지 않음).
   멈춘 기기의 갱신 링크 창은 `이 기기에서는 반영을 멈췄어요`와 `다시 반영하기`·`공개본을 새 여행으로 가져오기`를 보인다.

### 끝난 공유

- 소유자 기기가 `404`·`410`을 받으면 기록을 `ended`로 바꾸고 `갱신 링크 공유가 끝났어요`를 알린다. 창은 `새 갱신 링크 만들기`를 보인다(기록을 지우고 처음 상태로).
- 소유자 토큰이 철회되면(`401`) 기록을 `disconnected`로 바꾸고 `이 기기의 갱신 링크 관리 연결이 끊겼어요. 소유자 링크로 다시 연결하세요`를 알린다.
- 보관함에서 여행을 지워도 서버 사본은 지우지 않는다. 여행 지우기 확인 창에 `갱신 링크는 서버에 남아요. 설정 › 갱신 링크에서 지울 수 있어요`를 더한다.
- 설정 › `갱신 링크` 목록에서 이 기기가 만든·연결한 공유를 보고 지운다(제목·상태·기한, `지우기`).

## 서버 자료 모델

### 공유 문서 `LiveTripDoc` v1

```ts
type LiveTripDoc = {
  format: 'landmark-trip-live';
  v: 1;
  /** 보기 화면·HTML 파일·가져오기에 그대로 쓰는 일정 문서. 경로선은 문서 전체 10,000점까지 솎는다. */
  share: ShareDocV2;
  /** share.trips[0].days[i]의 안정 id(8자 a-z0-9)와 그 Day Stop들의 TripStopId. */
  ids: { days: string[]; stops: string[][] };
  /** 공유를 만들 때 고른 옵션(받는 쪽 표시와 다른 소유자 기기의 다시 만들기에 쓴다). */
  options: { includeMemo: boolean; includeCandidates: boolean };
};
```

- `share`는 지금 `buildTripShareDoc`가 만드는 v2 문서 그대로다. `share.createdAt`은 공유를 처음 만든 시각으로 고정한다(편집 지문이 매번 바뀌지 않게).
- 검사 `parseLiveDoc(value): LiveTripDoc | null`(Effect 없음)은 `share`를 보기 화면의 엄격한 링크 검사 `parseLinkDoc`(`src/share-viewer/parse.ts`)로 보고, `version === 2`·여행 1개·장소 1곳 이상을 요구한다. 그리고
  - `ids.days.length === share.trips[0].days.length`, 각 id `^[a-z0-9]{8}$`, 서로 다름.
  - `ids.stops[i].length === share.trips[0].days[i].stops.length`, 각 id `^[a-z0-9]{8}$`, 여행 전체에서 서로 다름.
  - 모르는 키가 있으면 거절(`format`·`v`·`share`·`ids`·`options` 외, `options`는 두 불리언만).
  - 통과하면 `parseLinkDoc`가 돌려준 정규화 값으로 새 객체를 만든다. 서버는 이 값을 `JSON.stringify`해 저장한다(모르는 필드가 D1에 남지 않는다).
- 크기: 정규화 JSON의 UTF-8 바이트가 `LIVE_DOC_MAX_BYTES = 524,288` 이하. 브라우저는 넘으면 경로선을 모두 빼고 다시 재고, 그래도 넘으면 보내지 않는다(`too-big`).
- 장소 id는 올린 기기의 보관함 장소 id다. Stop id는 보관함 `TripStopId`를 그대로 싣는다. Day id는 로컬 여행에 없으므로 소유자 기기 기록(`dayIds`)이 Day 위치별로 만들어 둔다.
  Day는 로컬 규칙(`setTripDates`: 날 수가 줄면 뒤에서 자르고, 늘면 뒤에 붙임)대로 **위치가 정체성**이다. 그래서 `alignDayIds(prev, count)`도 앞에서부터 유지하고 뒤를 자르거나 새 id를 붙인다.

### D1 표(스키마 버전 3)

`src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에** 더하고 `SCHEMA_VERSION = 3`. 모두 `IF NOT EXISTS`라 `ensureSchema`가 다시 돌려도 안전하다.

```sql
-- 3: 여행 갱신 공유(2A).
CREATE TABLE IF NOT EXISTS trip_shares (
  id TEXT PRIMARY KEY,          -- 공유 id(10자 a-z0-9, 브라우저가 만든다)
  doc TEXT NOT NULL,            -- 정규화한 LiveTripDoc JSON
  rev INTEGER NOT NULL,         -- 공개 revision. 문서를 올릴 때마다 1씩 오른다
  view_token TEXT NOT NULL,     -- 보기 토큰 원문(아래 보안 절)
  source_trip_id TEXT NOT NULL, -- 처음 만든 기기의 여행 id(소유자에게만 돌려준다)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trip_shares_expires ON trip_shares(expires_at);
CREATE TABLE IF NOT EXISTS trip_share_tokens (
  hash TEXT PRIMARY KEY,        -- SHA-256(토큰) base64url
  share_id TEXT NOT NULL,
  kind TEXT NOT NULL,           -- 2A: 'owner'. 2B가 'editor'·'invite'를 더한다
  label TEXT,                   -- 2A는 NULL. 2B 기기 이름
  expires_at TEXT,              -- 2A는 NULL. 2B 1회 초대 기한
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trip_share_tokens_share ON trip_share_tokens(share_id, kind);
```

- `rev`는 문서가 바뀔 때만 오른다. 링크 다시 만들기는 `rev`를 올리지 않는다(보기 화면은 `401`로 안다).
- 행 크기: 문서 524,288바이트 + 나머지 열 < D1 행 한도 2MB(제안서 §3.1). 바인딩 값 하나로 넣는다.
- 보관 기한 `liveExpiresAt(endDate, now)` = `min(now + 180일, max(now + 30일, endDate의 한국 23:59:59.999 + 30일))`. 만들기·올리기 때 다시 계산하고, 읽기는 기한을 늘리지 않는다.
- `ALTER TABLE`은 `ensureSchema` 재실행에서 멱등이 아니므로 쓰지 않는다. 2A가 2B용 빈 열(`label`·`expires_at`)을 미리 둔 이유다. 열이 더 필요하면 2B는 새 표를 더한다.

### 2B가 이어 쓰는 것

| 2A가 정한 것 | 2B에서의 뜻 |
|---|---|
| 공유 id `trip_shares.id`(10자) | 공동 여행 id. 보기·편집 초대·진행 자료가 모두 이 id에 붙는다 |
| `rev`(문서 전체 revision, 낙관적 잠금 `baseRev`) | 편집 저장의 기준 버전. 2B는 필드 병합 뒤 같은 `rev` 조건으로 쓴다. 진행 자료는 별도 표·별도 버전으로 둔다(문서 `rev`를 올리지 않게) |
| `ids.days`(8자, 위치별) | Day 안정 id. 2B의 필드 경로(`days[<id>].startTime` 등)에 쓴다 |
| `ids.stops`(`TripStopId`) | Stop 안정 id. 순서 충돌 비교 화면의 단위 |
| `share.places[].id` | 올린 기기의 장소 id. **2B는 서버 문서의 장소 id를 기준 id로 삼고 기기별 대응표(서버 id → 로컬 id)를 둬야 한다**(2A는 다른 소유자 기기가 올리면 그 기기의 장소 id로 바뀐다) |
| `trip_share_tokens.kind`·`label`·`expires_at` | 기기별 편집 토큰(`editor`, 기기 이름 `label`)·1회 초대(`invite`, `expires_at`, 쓰면 지움) |
| `LiveTripDoc.v` | 2B가 필드별 시각 등을 더하면 `v: 2`로 올린다. 그때 서버는 저장된 `v`보다 낮은 `v`의 올리기를 `409 { reason: 'version' }`으로 거절해 옛 앱이 새 필드를 지우지 못하게 한다 |
| `parseLiveDoc` | 서버·보기 화면·앱 공용 검사. 2B 문서 모양도 여기서 넓힌다 |

## 브라우저 저장

- 보관함 형식(`tripmap:library:v2`, schemaVersion 2)·백업 형식·공유 문서 형식(`ShareDoc` v1·v2)은 바꾸지 않는다.
- 새 키 `tripmap:trip-live:v1`: `{ [로컬 여행 id]: TripLiveRecord }`(최대 100개).

```ts
type TripLiveRecord = {
  tripId: string;           // 키와 같은 로컬 여행 id
  liveId: string;           // 서버 공유 id
  status: 'pending' | 'live' | 'disconnected' | 'ended';
  ownerToken: string;       // 43자 base64url
  viewToken: string;        // 43자 base64url
  rev: number;              // 이 기기가 마지막으로 맞춘 revision(0 = 아직 확인 전)
  dayIds: string[];
  options: { title: string; includeMemo: boolean; includeCandidates: boolean };
  createdAt: string;        // share.createdAt 고정값(ISO)
  publishedKey?: string;    // 마지막으로 올린(또는 담은) 문서의 편집 지문
  publishedAt?: string;
  expiresAt?: string;
  paused?: true;            // 409 뒤 사용자가 반영을 멈춤
};
```

- `pending`: 만들기 요청 **전에** 공유 id·토큰을 정해 저장한다. 응답이 사라져도 같은 값으로 다시 보내면 서버가 같은 공유를 돌려준다(약속 `pendingHostToken`과 같은 방식).
- 깨진 값은 빈 기록으로 읽고, 저장소가 막히면 그 페이지 동안 메모리에만 둔다(`tripmap:share-links:v1`과 같은 관례). 다른 탭의 변경은 `storage` 이벤트로 받는다.
- 토큰은 보관함·백업 파일에 넣지 않는다. 백업을 다른 기기에 되살려도 그 기기는 소유자가 아니다(소유자 링크로 연결한다).
- **편집 지문** `liveEditKey(doc)`: `share.createdAt`을 빼고 구간은 `[from, to, mode]`만 남긴 JSON의 SHA-256(base64url). 경로 재조회로 시간·경로선만 바뀐 것은 올리지 않는다.

## API(Pages Functions)

진입점 `functions/api/trip-live/*`, 처리 `src/server/trip-live/handlers.ts`. 모든 응답 `Cache-Control: private, no-store`, 기존 Cache API에 넣지 않는다. 요청 출처 검사(`isAllowedOrigin`)는 모든 경로에서 한다(보기 화면의 `GET`은 같은 출처라 `Referer`로 통과한다). 토큰은 `Authorization: Bearer <토큰>`.

| 요청 | 하는 일 | 권한 | 성공 |
|---|---|---|---|
| `POST /api/trip-live` | `{ id, sourceTripId, ownerToken, viewToken, doc, turnstile }` 만들기 | 출처 + 스위치 + 한도 + Turnstile | `201 { id, rev: 1, expiresAt, created: true }`. 같은 id·같은 소유자 토큰 재시도는 `200 { …, rev: 지금, created: false }`(처음 문서 유지), 다른 토큰이면 `409 { reason: 'taken' }` |
| `GET /api/trip-live/:id?since=<rev>` | 공개본 읽기 | 보기 또는 소유자 토큰 | `200 { rev, updatedAt, expiresAt, role, doc }`(소유자면 `viewToken`·`sourceTripId` 더함), 같으면 `304` |
| `PUT /api/trip-live/:id` | `{ doc, baseRev }` 올리기 | 소유자 + 스위치 + 한도 | `200 { rev, expiresAt }`, `rev`가 다르면 `409 { rev }` |
| `POST /api/trip-live/:id/rotate` | `{ view: <새 토큰> }` 또는 `{ owner: <새 토큰> }` | 소유자 + 한도 | `200 { rev }` |
| `DELETE /api/trip-live/:id` | 공유·토큰 지우기 | 소유자 | `204` |

- 오류: 없는 공유 `404 NOT_FOUND`, 기한 지남 `410 ENDED`(지우기는 기한이 지나도 된다), 토큰 없음·틀림·철회 `401 UNAUTHORIZED`, 입력 오류 `400 BAD_REQUEST`(Turnstile 실패는 `reason: 'turnstile'`, 문서 검사 실패는 `reason: 'doc'`), 너무 큼 `413 TOO_LARGE`, 한도 `429 RATE_LIMITED`, 스위치 `503 UNAVAILABLE { reason: 'off' }`, 설정 누락 `503 { reason: 'config' }`. 새 오류 코드는 없다.
- `GET`은 저장된 `doc` 문자열을 다시 파싱하지 않고 응답 JSON에 이어 붙인다(CPU 절약, 저장 값은 이미 정규화됨).
- 새 토큰은 브라우저가 만든다(43자). `rotate`의 `owner` 재시도: 보낸 새 토큰이 이미 이 공유의 소유자 토큰이면 `200`(앞 요청의 응답이 사라진 경우). `view` 재시도: 지금 `view_token`과 같으면 `200`.
- 공유 id는 브라우저가 만든다(10자). 이미 다른 소유자의 공유면 `409 taken` → 브라우저가 새 id·토큰으로 한 번 다시 보낸다.
- 만료 정리: `POST`·`PUT` 성공 뒤 `waitUntil`로 만료 공유를 최대 20개(토큰 포함, 한 `batch`)와 지난 날짜 카운터(`pruneLimits`)를 지운다.

## 화면 상태와 갱신

### 보기 화면(받는 쪽)

- 보이는 동안만(`document.visibilityState === 'visible'`, `navigator.onLine !== false`) 10초마다 `GET ?since=<rev>`. 숨겨지면 멈추고 다시 보이면 바로 한 번, `online` 이벤트에도 바로 한 번.
- 연속 실패는 간격을 10초 → 30초 → 60초로 늘린다. 성공하면 10초로 돌아온다. 겹쳐 부르지 않는다.
- **오래 손대지 않으면 늦춘다**: 5분 동안 `pointerdown`·`keydown`·`scroll`·`touchstart`가 없으면 60초 간격으로 바꾸고, 그 뒤 첫 입력에 바로 확인하고 10초로 돌아온다(요청 수 예산, §남용 방지).
- 새 revision을 받으면 고른 탭(Day 번호 또는 후보)을 유지해 다시 그린다. 그 Day가 없어졌으면 Day 1. 지도 iframe은 다시 만든다(1~2초 깜빡임을 받아들인다. 결정 표 8).
- `401`·`404`·`410`을 받으면 멈춘다(`stop`). 그린 일정은 남긴다.
- `Landmark에 담기`는 지금 공개본으로 다시 만든다(같은 출처 `location.origin`의 `/import#d=`).
- `파일로 저장`: 같은 출처의 `/share-viewer.html` 틀을 받아 지금 공개본(`share`)을 `injectShareDoc`로 넣고 `shareFileName(제목, 지금)`으로 내려받는다. 틀을 받지 못하면 `파일을 만들지 못했어요. 잠시 뒤 다시 해 주세요`.

### 소유자 기기(올리는 쪽)

- 반영 훅 `useTripLivePublish(tripId, active)`는 여행 계획 화면과 갱신 링크 창에서 돈다. 기록이 `live`이고 `paused`가 아닐 때만 일한다.
  1. `useTripLegs(tripId, enabled)`로 모든 구간을 묻고 `buildLiveTripDoc`로 문서를 만든다.
  2. 편집 지문이 기록의 `publishedKey`와 같으면 할 일 없음(`published`).
  3. 다르면 3초 모은다. 구간을 다 받았거나(`answered === total`) 처음 바뀐 뒤 15초가 지나면 올린다. 같은 여행은 모듈 잠금으로 한 번에 하나만 올리고, 잠금을 얻은 뒤 기록의 지문을 다시 읽어 같으면 건너뛴다(계획 화면과 창이 함께 열린 경우).
  4. 올리기 간격은 최소 10초.
- 결과별 처리

| 결과 | 기록·화면 |
|---|---|
| 성공 | `rev`·`publishedKey`·`publishedAt`·`expiresAt`·`dayIds` 저장 |
| `409 { rev }` | 알림(닫힐 때까지 유지) `다른 기기에서 갱신 링크의 일정을 바꿨어요` · `이 기기 일정으로 바꾸기`(`baseRev = rev`로 다시 올림) · `반영 멈추기`(`paused`) |
| `401` | `disconnected`, 알림 `이 기기의 갱신 링크 관리 연결이 끊겼어요. 소유자 링크로 다시 연결하세요` |
| `404`·`410` | `ended`, 알림 `갱신 링크 공유가 끝났어요` |
| `503 off` | 상태 `off`(창에 `지금은 갱신이 잠시 멈췄어요`), 5분 뒤 다시 |
| `429` | 상태 `limited`(창에 `오늘은 더 반영할 수 없어요. 내일 다시 반영돼요`), 1시간 뒤 다시 |
| `413`·문서가 너무 큼 | 상태 `too-big`(창에 `일정이 커서 반영하지 못했어요. '메모 포함'이나 후보를 끄고 다시 해 주세요`) |
| 장소가 없어 문서를 못 만듦 | 상태 `empty`(창에 `일정에 넣은 장소가 없어 반영하지 않았어요`) |
| 오프라인·`5xx` | 상태 `failed`, `online` 이벤트나 30초·60초·120초 뒤 다시(세 번까지, 그 뒤는 다음 변경 때) |

- 갱신 링크 창을 열면 소유자 토큰으로 `since` 없이 `GET`을 한 번 보내 끝남·끊김·다른 기기 변경(받은 `rev`가 크면 `다른 기기에서 마지막으로 반영했어요`)을 보이고, 다른 기기가 바꾼 보기 토큰을 기록에 맞춘다(링크 다시 만들기는 `rev`를 올리지 않아 `304`로는 알 수 없다).
- 옵션(제목·메모·후보)을 창에서 바꾸면 기록에 저장하고 위 훅이 다시 올린다.

## 오류·장애

| 상황 | 소유자 | 받는 사람 |
|---|---|---|
| 오프라인 | 만들기: `인터넷 연결을 확인해 주세요. 링크 복사를 이용해 주세요`. 반영은 온라인 복귀 때 | 마지막 화면 유지, 띠에 `연결이 원활하지 않아요 · {HH:mm} 기준` |
| Turnstile 불러오기·확인 실패 | `확인에 실패했어요. 다시 해 주세요` | — |
| `429` | 만들기: `오늘은 더 만들 수 없어요. 링크 복사를 이용해 주세요` | 없는 공유를 너무 많이 열면 `잠시 뒤 다시 열어 주세요` |
| `503 off` | 만들기: `지금은 갱신 링크를 만들 수 없어요. 링크 복사·파일 저장을 이용해 주세요`. 반영은 멈춤 | 읽기는 계속 된다 |
| `503 config`·`5xx` | `갱신 링크를 만들지 못했어요. 잠시 뒤 다시 해 주세요` | 처음: `일정을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요` + `다시 시도` |
| D1 무료 한도 초과 | 위 `5xx`와 같다 | 위와 같다. 받는 쪽은 `파일로 저장`(이미 그린 경우)만 남는다 |
| 문서가 너무 큼 | `일정이 커서 갱신 링크를 만들 수 없어요. '메모 포함'이나 후보를 끄거나 파일로 보내 주세요` | — |

## 남용 방지·보안·개인정보

- 토큰: `crypto.getRandomValues` 32바이트 → base64url 43자. **소유자 토큰**은 SHA-256 해시만 저장·비교한다.
- **보기 토큰은 원문으로 둔다**(`trip_shares.view_token`). 보기 토큰이 여는 것은 같은 행의 `doc`뿐이라, D1이 새면 해시 여부와 상관없이 내용이 드러난다. 원문으로 두면 다른 소유자 기기가 `GET`으로 보기 링크를 다시 만들 수 있다(결정 표 4).
- IP 해시별 하루 한도(UTC 날짜, `rate_counters`): 만들기 `tripCreate` 20, 올리기 `tripUpdate` 600, 링크 다시 만들기 `tripRotate` 60, 없는·끝난 공유 읽기 `tripRead` 5,000(정상 읽기·`304`·`401`은 세지 않는다).
- Turnstile은 만들기에만 쓴다(약속·짧은 링크와 같은 위젯·키). 올리기는 소유자 토큰과 일 한도로 막는다.
- 요청 크기: 본문을 읽기 전에 `Content-Length` > 600,000이면 `413`, 헤더가 없거나 틀려도 읽으며 세다 넘는 순간 끊는다(`src/server/share/handlers.ts`의 `readLimitedJson`을 한도 인자와 함께 내보내 같이 쓴다).
- 공유 id 10자(약 51비트)는 추측하기 어렵고, 읽기에는 43자 토큰도 필요하다. 없는 공유 읽기만 센다.
- 서버 저장은 일반 저장이다(제안서 §10 「선택 공유의 일반 서버 저장」). 서버에 남는 것: 제목, 장소 이름·주소·좌표·라벨, (선택 시) 메모·한 줄 평, Day·시간·체류·구간 시간·경로선, 처음 기기의 여행 id. 기한이 지나면 지운다.
- `메모 포함` 기본값은 꺼짐이다(긴 링크·파일은 켜짐). 서버 운영자가 읽을 수 있는 사본이기 때문이다.
- 요청 수 예산: Pages Functions 요청은 Workers와 합쳐 계정 하루 100,000건이고 랜드마크 몫은 50,000건으로 잡았다(제안서 §3.1·§7.0). 보기 화면 하나가 1시간 보이면 최대 360건이다. 오래 손대지 않으면 60초로 늦추고, 숨겨지면 멈춘다. D1 읽기는 확인 한 번에 1~2행이다.
- CPU: 서버는 Effect 없이 `parseLiveDoc`로 검사하고 `GET`은 문서를 다시 파싱하지 않는다. 524,288바이트 문서의 `PUT` CPU 시간을 미리보기 배포에서 잰다(무료 10ms). 넘으면 `LIVE_DOC_MAX_BYTES`를 줄인다.
- 시크릿·키는 저장소에 넣지 않는다. `wrangler.toml`을 두지 않는다. 로컬 `.dev.vars`는 `.gitignore`에 더한다.

## 첫 로딩·코드 위치

| 위치 | 내용 | 번들 |
|---|---|---|
| `src/domain/trip-live/live-doc.ts` | 상수·`LiveTripDoc` 타입·`parseLiveDoc`·`liveExpiresAt`·`alignDayIds`·`liveLinks`·`readLiveHash` | 서버·보기 화면·앱 공용(Effect 없음) |
| `src/domain/trip-live/build-live-doc.ts` | `buildLiveTripDoc`·`fitLiveDoc`·`liveEditKey` | 앱(지연 청크) |
| `src/domain/trip-live/import-live.ts` | `importLiveTrip` | 앱(`TripLiveLinkPage`·갱신 링크 창) |
| `src/server/trip-live/handlers.ts`, `functions/api/trip-live/*` | 서버 처리·진입점 | 함수 |
| `src/services/trip-live/{store,client,tokens}.ts` | 기기 기록·API·토큰 | 앱(지연 청크) |
| `src/sections/trips/live/*` | 갱신 링크 창(`TripLiveShareDialog`), 반영 훅·`TripLivePublisher`, 소유자 링크 화면(`TripLiveLinkPage`), 입구 줄 | 앱(지연 청크) |
| `src/sections/settings/LiveTripsSection.tsx` | 설정 목록 | `SettingsPage` 청크 |
| `src/share-viewer/{live,live-view,show}.ts` | 보기 화면 갱신 모드 | 보기 화면 번들 |

- `TripLiveShareDialog`·`TripLiveLinkPage`는 새 지연 청크이고 `build:ci`의 `--require-lazy`에 더한다. 첫 로딩 예산(`perf-budget.json` 327,680바이트)을 넘지 않아야 한다.
- `TripLivePublisher`는 이미 지연인 여행 계획 화면 청크에 들어가고, 기록이 없으면 아무 요청도 하지 않는다. 여행 목록의 `갱신 공유 중` 표시는 기록 저장소만 읽는다.
- 라우터에 `/trips/live/:id`(`TripLiveLinkPage`)를 더한다. 미리 받기 목록(`ROUTE_CHUNKS`)에는 넣지 않는다(드물게 쓰는 화면).
- 보기 화면 번들에는 Effect·React가 들어가지 않는다(지금 규칙). `live-doc.ts`는 `parseLinkDoc`와 `check-share-trip.ts`만 가져온다.
- 링크는 `VITE_APP_URL`이 아니라 지금 출처(`window.location.origin`)로 만든다(다른 배포의 D1에는 그 공유가 없다. 짧은 링크와 같은 이유).

## 호환·롤백

- 보관함·백업·공유 문서 형식이 그대로라 옛 버전도 보관함을 읽는다. 기기 키 `tripmap:trip-live:v1`은 옛 버전이 읽지도 지우지도 않는다.
- **옛 버전으로 되돌리면**
  - `functions/api/trip-live/*`가 사라져 갱신 링크가 열리지 않는다. 옛 보기 화면은 `#t=`를 모르므로 `링크가 손상됐거나 너무 길어요…`(지금의 `renderBrokenLink`)를 보인다. 받은 사람이 이미 저장한 HTML 파일·`Landmark에 담기`로 가져간 여행은 남는다.
  - 소유자 링크 `/trips/live/<id>`는 옛 앱에서 `페이지를 찾을 수 없어요`다.
  - D1의 `trip_shares`·`trip_share_tokens`는 지우지 않는다. `schema_meta`는 3으로 남고 옛 코드의 `ensureSchema`(버전 2 이하 기준)는 아무것도 하지 않으므로 약속·짧은 링크는 그대로 동작한다. 새 버전으로 돌아오면 기한이 남은 공유는 이어서 열린다.
  - 옛 코드에는 갱신 공유 만료 정리가 없다. 오래 되돌려 둘 때는 `wrangler d1 execute landmark --remote --command "DELETE FROM trip_share_tokens WHERE share_id IN (SELECT id FROM trip_shares WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')); DELETE FROM trip_shares WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')"`(사용자가 실행).
- **서버 쪽만 멈추려면** 되돌리기 대신 Pages 환경 변수 `TRIP_SHARE_LIVE=off`를 넣고 다시 배포한다. 새 갱신 링크 만들기와 올리기만 `503`이 되고, 이미 보낸 링크는 마지막 공개본을 계속 보여 준다(제안서 §9 「공유 편집을 끄고 읽기 화면 유지」). 소유자는 `서버에서 지우기`·`보기 링크 다시 만들기`를 계속 쓸 수 있다.
- 롤백 표(`docs/rollback.md`)의 버전 행은 병합 뒤 별도 docs PR에서 쓴다. 기능 PR 본문에 위 내용을 롤백·데이터 영향 메모로 적는다(브리프 규칙).
- 코드 되돌리기 순서: 2B(`feat/trip-collab`)가 이 PR 위에 쌓이므로 2A를 되돌리려면 2B를 먼저 되돌린다.

## 사용자가 할 일

새 외부 계정·키는 없다. D1(`DB`)·Turnstile(`VITE_TURNSTILE_SITE_KEY`·`TURNSTILE_SECRET`)·`IP_HASH_SALT`는 약속 온라인 집계 때 만든 것을 그대로 쓴다.

1. (선택) 비상 스위치가 필요할 때만 Cloudflare 대시보드 › Workers & Pages › `landmark` › Settings › Variables and Secrets에서 Production·Preview에 `TRIP_SHARE_LIVE`=`off`를 넣고 다시 배포한다. 평소에는 넣지 않는다(없거나 `off`가 아니면 켜짐).
2. 표 만들기는 첫 요청 때 서버 코드가 스스로 한다(`SCHEMA_VERSION` 3). 배포 뒤 확인만 한다:
   `npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta; SELECT name FROM sqlite_master WHERE name LIKE 'trip_share%'"` → `3`, `trip_shares`, `trip_share_tokens`, `trip_shares_expires`, `trip_share_tokens_share`.
3. 미리보기 배포에서 큰 일정(경로선 많은 30일 여행)을 올려 Workers 지표의 CPU 시간이 10ms 안인지 본다.
4. 휴대폰 두 대(또는 PC와 휴대폰)로 갱신 링크를 보내고, 고친 내용이 받는 화면에 10초 안팎에 들어오는지, 카카오톡에서 링크가 열리는지 확인한다.

## 로컬에서 실제 키 없이 해 보기

- `yarn dev:full`(로컬 D1, `http://localhost:8788`)을 띄운다. `VITE_TURNSTILE_SITE_KEY`를 비워 두면 브라우저는 Turnstile을 부르지 않고(`dev` 토큰), 로컬 서버는 시크릿이 없어 검증을 건너뛴다. `IP_HASH_SALT`가 없으면 개발용 소금을 쓴다.
- 소유자는 보통 창, 받는 사람은 다른 브라우저(또는 시크릿 창), 소유자 다른 기기는 또 다른 시크릿 창으로 연다(기기 저장소가 달라야 한다).
- Turnstile 위젯까지 보려면 Cloudflare의 공개 시험 키를 쓴다(확인 2026-10-29, [Turnstile 시험 문서](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)): `.env.local`에 `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000BB`(보이지 않음·늘 통과), `.dev.vars`에 `TURNSTILE_SECRET=1x0000000000000000000000000000000AA`(늘 통과). 실패를 보려면 각각 `2x00000000000000000000BB`·`2x0000000000000000000000000000000AA`.
- 기능 스위치는 `.dev.vars`에 `TRIP_SHARE_LIVE=off`를 넣고 `yarn dev:full`을 다시 띄워 본다.
- 로컬 D1 확인: `sqlite3 "$(find .wrangler/state -name '*.sqlite' | head -1)" "SELECT id, rev, expires_at FROM trip_shares"`.
- 한계: 허용 출처가 `localhost:5173`·`localhost:8788`뿐이라 같은 망의 휴대폰(IP 주소 출처)에서는 `/api/trip-live`가 `403`이다. 휴대폰 확인은 미리보기 배포로 한다.

## 시험

- 단위(vitest)
  - `live-doc`: 정상 문서 통과·정규화, 모르는 키·`ids` 길이 불일치·중복 id·`v` 다름·장소 없음 거절, `liveExpiresAt` 세 갈래(미래 여행·지난 여행·180일 상한), `alignDayIds` 유지·자르기·붙이기, `readLiveHash`, `liveLinks`.
  - `build-live-doc`: Stop id·Day id 짝, 경로선 10,000점 솎기, `createdAt` 고정, 장소 없으면 null, `fitLiveDoc` 경로선 빼기·포기, `liveEditKey`가 구간 시간·경로선·`createdAt` 변화에는 같고 Stop 순서·이름 변화에는 다름.
  - `import-live`: 새 여행으로 담김, 원래 여행 id가 비면 그 id·차 있으면 새 id, Stop id 보존, 장소 합치기.
  - 서버(`node:sqlite` 가짜 D1): 만들기 201·재시도 200·다른 토큰 409 `taken`·스위치 503·설정 누락 503·Turnstile 실패 400·문서 검사 400 `doc`·413·21번째 429. 읽기: 보기·소유자 토큰, 소유자에게만 `viewToken`·`sourceTripId`, 304, 토큰 없음·틀림 401, 404·410과 그때만 세는 읽기 한도, `Cache-Control`. 올리기: 401, 409 `{ rev }`, 성공 시 `rev`·`expires_at` 갱신, 스위치 503. 링크 다시 만들기: 이전 보기 토큰 401·새 토큰 200, 소유자 재발급 뒤 이전 소유자 401, 재시도 200. 지우기 204 뒤 404, 기한 지난 공유도 지움. 만료 정리 20개. `SCHEMA_VERSION` 3과 표 생성.
  - 브라우저 저장·클라이언트: 왕복·깨진 값·막힌 저장소·100개 한도, 상태 코드별 오류 해석, 응답 검사 실패 `invalid`, `fetch` 거절 `offline`.
  - 반영 훅(가짜 타이머·가짜 API): 지문이 같으면 안 올림, 고친 뒤 3초 모아 한 번, 구간 받는 중이면 15초까지 기다림, 409 알림과 두 선택, 401·410 상태, 계획 화면과 창이 함께 있어도 한 번.
  - 갱신 링크 창: 처음 상태 안내·메모 기본 꺼짐, 만들기 성공·오류 문구, 링크 복사, 보기 링크 다시 만들기 확인 창, 서버에서 지우기, 멈춤 상태 단추.
  - 소유자 링크 화면: 해시 지움, 담기 후 계획 화면 이동·기록, 이미 기록이 있으면 바로 이동, 401·410 문구.
  - 보기 화면: 갱신 해시 읽기, 처음 그리기, 바뀐 revision에 탭 유지, 401·410 띠와 확인 멈춤, `파일로 저장`이 틀에 공개본을 넣음, 폴링 간격(보임·숨김·실패·오래 손대지 않음).
- E2E(Playwright, desktop): `page.route`로 `/api/trip-live*`를 진짜 처리 코드와 `node:sqlite` 가짜 D1에 넘긴다(`tests/e2e/trip-live-server.ts`). 소유자 → 갱신 링크 만들기 → 받는 문맥이 보기 링크로 일정 확인 → 소유자가 Day 1 출발 시각을 바꿈 → 받는 문맥이 10초 뒤 바뀐 시각을 봄 → 보기 링크 다시 만들기 → 받는 문맥에 철회 문구 → 소유자 링크로 세 번째 문맥이 담기 → 서버에서 지우기 → 끝남 문구.
- 미리보기 배포에서 CPU 시간·응답(사용자가 할 일 3).

## 완료 조건

- 위 시험 통과, `yarn typecheck`·`yarn lint`·`yarn test`·`yarn build:ci`(크기·`--require-lazy` 포함)·`yarn test:e2e:ci` 통과.
- `yarn dev:full`로 키 없이 소유자·받는 사람·소유자 다른 기기 흐름을 화면으로 끝까지 눌러 볼 수 있다(`docs/development.md`의 새 절대로).
- 운영에서 휴대폰 두 대로 갱신이 10초 안팎에 들어오는 것을 확인한다(배포 뒤).
- `docs/development.md` 새 절·환경 변수 행·화면 경로 행, README 개인정보 줄, 도움말(`share`·`trips` 팁)을 고친다. `docs/rollback.md`는 병합 뒤 별도 PR.

## 결정과 근거

사용자에게 물을 수 없어 이 문서에서 정한 것이다. 룰링(브리프)과 다르게 정한 것은 없다.

| # | 항목 | 고른 안(다른 선택지) | 근거 |
|---|---|---|---|
| 1 | 받는 화면 | 지금 보기 화면 `/view`에 갱신 모드(새 SPA 화면) | 일정 그리기·지도·`Landmark에 담기`·HTML 틀을 그대로 쓴다. 별도 번들이라 앱 첫 로딩 예산과 무관하다. 옛 앱으로 되돌려도 깨진 링크 안내가 이미 있다 |
| 2 | 서버 문서 | `ShareDocV2` + `ids` + `options`(보관함 여행 원형) | 보기·HTML·가져오기가 바뀌지 않고, 검사는 이미 있는 Effect 없는 `parseLinkDoc`를 다시 쓴다(서버 CPU·보기 번들 크기). 2B가 쓸 Stop·Day id는 `ids`로 따로 싣는다 |
| 3 | 저장 방식 | 일반 저장(짧은 링크처럼 브라우저 암호화) | 2B의 필드 병합·서버 검사에는 서버가 내용을 읽어야 한다. 제안서 §10이 선택 공유의 일반 저장을 추천했다. 대신 메모 기본 꺼짐과 누르기 전 안내를 둔다 |
| 4 | 보기 토큰 저장 | 원문(해시) | 같은 행의 문서가 이미 평문이라 해시가 보호를 더하지 않는다. 원문이면 다른 소유자 기기가 보기 링크를 다시 보여 줄 수 있다. 소유자 토큰은 쓰기 권한이라 해시만 둔다 |
| 5 | 링크 모양 | `/view#t=<id>.<토큰>`(경로에 토큰, 함수 경로 새로 만들기) | 해시는 서버·요청 기록에 남지 않는다. 약 90자라 카카오톡에 바로 보낸다. 정적 `/view`라 새 함수 경로가 필요 없다 |
| 6 | 소유자 다른 기기 | 공개본을 새 여행으로 담고 소유자가 됨, 겹치면 409 선택(관리만 허용 / 같은 id 여행에 연결) | 룰링의 `#h=` 방식을 따르되 2A에는 병합이 없어, 기존 여행에 연결하면 낡은 로컬 사본이 조용히 공개본을 덮을 수 있다. 새 여행으로 담고 담은 직후 지문을 기록하면 고치기 전에는 올리지 않는다 |
| 7 | 반영 시점 | 편집 지문이 바뀔 때 자동(수동 `반영` 단추) | "갱신 공유"의 뜻대로 고치면 따라간다. 구간 시간·경로선 재조회만으로는 올리지 않아 쓸데없는 revision·요청을 막는다 |
| 8 | 바뀐 공개본 그리기 | 탭을 유지한 채 전체 다시 그림(지도 iframe 유지하는 부분 갱신) | `renderTripViewer`는 매번 `root`를 비운다. 부분 갱신은 452줄 그리기 코드를 크게 고쳐야 한다. 공개본은 소유자가 고칠 때만 바뀌어 깜빡임이 드물다 |
| 9 | 보관 기간 하한 | 갱신 + 30일(여행 끝 + 30일만) | 이미 끝난 여행을 나누면 바로 만료되는 일을 막는다. 짧은 링크·약속의 30일과 맞춘다. 상한 180일은 룰링 그대로 |
| 10 | 기능 스위치 범위 | 만들기·올리기만 끔(만들기만 / 전부) | 제안서 §9 「공유 편집을 끄고 읽기 화면 유지」. 받은 링크는 마지막 공개본을 계속 보이고 소유자는 지우기·철회를 할 수 있어야 한다 |
| 11 | 문서 크기 | 524,288바이트, 경로선 10,000점(약속 64KB / 5MB) | 30일 여행의 경로선까지 담되 무료 CPU 10ms·D1 행 2MB 안에 둔다. 미리보기에서 재고 넘으면 줄인다 |
| 12 | 보기 화면 폴링 | 보일 때 10초, 5분 손대지 않으면 60초(늘 10초) | 룰링의 10초를 지키면서 켜 둔 탭이 무료 요청 예산(랜드마크 몫 하루 50,000)을 먹지 않게 한다 |
| 13 | 메모 포함 기본값 | 꺼짐(켜짐) | 서버 운영자가 읽을 수 있는 사본이고 오래 남는다. 사용자가 켜면 안내를 보인다 |

