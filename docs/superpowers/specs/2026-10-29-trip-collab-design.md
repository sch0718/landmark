# 여행 함께 편집·당일 진행 설계(2B)

여행 소유자가 **편집 초대 링크**를 보내면, 받은 사람의 기기도 그 여행을 함께 고치고, 여행 당일에는 방문 완료·다음 장소를 함께 본다.
[서버·DB 도입 검토 제안서](2026-10-25-server-db-proposal.md) 9절 로드맵의 2B 단계이고, [여행 갱신 공유 설계(2A)](2026-10-29-trip-live-share-design.md)의 서버 자료 모델(`trip_shares`·`trip_share_tokens`·`LiveTripDoc`) 위에 올라간다.
계정 로그인은 쓰지 않는다. 권한은 2A의 소유자 토큰과 이 문서가 더하는 **기기별 편집 토큰**으로 나눈다.

사용자 결정(룰링)은 작업 지시의 「서버 로드맵 2A·2B·3·4 공통 브리프」(2026-10-29) 3번에서 확정된 것이다. 이 문서에서 새로 정한 것은 맨 끝 「결정과 근거」 표에 이유와 함께 적었다.
2A는 설계·계획만 끝났고 구현은 같은 스택의 다른 워크트리에서 진행 중이다. 이 문서의 2A 이름(함수·파일·문구)은 2A 계획서 기준이며, 구현 결과와 다르면 **2A 코드가 기준**이다(구현 계획서 Global Constraints, 이 문서 §2A에 기대는 것).

## 결정 요약

| 항목 | 결정 |
|---|---|
| 권한 | 소유자(2A 소유자 토큰), **편집 기기**(기기마다 다른 편집 토큰, 개별 철회), 보기(2A 보기 토큰). 로그인 없음 |
| 초대 | 소유자가 만드는 **1회용 편집 초대 링크** `<출처>/trips/join/<공유 id>#i=<초대 토큰>`. 7일(공유 기한이 더 이르면 그때) 뒤 닫히고 수락하면 바로 사라진다. 2A 보기 링크(`/view#t=`)와 따로다 |
| 편집 자리 | 수락한 기기는 공동 여행을 **자기 보관함에 담고**(연결된 여행) 지금의 여행 계획 화면에서 고친다. 서버에는 공동본 하나 |
| 서버 문서 | `LiveTripDoc` **v2**. 모양은 v1과 같고 `v: 2`가 "장소 id는 서버 기준 id, 쓰기는 병합한 문서만"을 뜻한다. 서버는 저장된 것보다 낮은 `v`의 쓰기를 `409 { reason: 'version' }`로 거절한다 |
| 장소 id | 서버 문서의 장소 id가 기준 id. 기기마다 대응표(서버 장소 id → 로컬 장소 id)를 둔다. 새 장소는 처음 올린 기기의 로컬 id를 서버 id로 쓴다(겹치면 새 id) |
| 변경 단위 | 기기가 **3방향 병합**(마지막으로 맞춘 공동 계획 · 이 기기 · 지금 공동본)을 하고 전체 문서를 `baseRev`로 올린다. 서버는 검사·비교 후 교체만 한다(2A와 같은 낙관적 잠금) |
| 충돌 | 한쪽만 바꾼 필드는 자동 병합. **양쪽이 같은 필드를 다르게 바꾸거나, 같은 Day·후보 목록의 순서·배치를 함께 바꾸면 비교 화면**에서 곳마다 남길 쪽을 고른다. 고르기 전에는 이 기기에서 올리지 않는다(조용한 유실 없음) |
| 갱신 | 계획 화면·당일 화면이 보이는 동안 10초마다 `GET state?rev=&prev=`(문서·진행 함께, 같으면 `304`). 5분 손대지 않으면 60초. 숨기면 멈춤 |
| 당일 진행 | 개인 `visitedOn`과 따로인 **공동 진행 자료**(Stop별 다녀옴·누가·언제, 정해 둔 다음 장소). 별도 표·별도 revision(`prev`). 내가 누른 체크는 공동 진행과 내 `visitedOn`에 함께 쓴다 |
| 관리 | 소유자는 `함께 편집` 창에서 초대 만들기·기다리는 초대 취소·참여 기기 목록(이름·마지막 접속)·**기기별 편집 권한 거두기**. 거두면 그 기기의 다음 요청부터 `401` |
| 사본 | 편집 참여자·소유자는 `내 여행으로 따로 저장`으로 공동 여행을 연결 없는 새 여행으로 담는다. 편집을 그만두거나 거둬지거나 공유가 끝나도 연결된 여행은 보관함에 그대로 남는다 |
| 기능 스위치 | `TRIP_COLLAB=off`면 초대 만들기·수락·공동본 올리기·진행 올리기만 `503`. 읽기·목록·거두기·초대 취소·그만두기는 된다. 2A 보기 링크는 영향 없음 |
| D1 | `SCHEMA_VERSION` 4. `trip_collab_devices`·`trip_collab_meta`·`trip_progress` 세 표(+색인 1)를 `SCHEMA_STATEMENTS` 끝에 더한다. 초대는 2A `trip_share_tokens`(`kind='invite'`)에 둔다 |

## 하지 않는 것

- 즉시 갱신(WebSocket·Durable Objects). 10초 폴링으로 충분하다(룰링 1).
- 계정 로그인·계정 단위 권한(3단계). 같은 사람의 다른 기기도 초대를 따로 받는다.
- 서버의 필드 병합·경로 계산. 병합과 구간 시간은 올리는 기기가 한다. 서버는 문서 검사·`rev` 비교·교체만 한다.
- 변경 이력·이전 판 되돌리기. 각 기기 보관함의 연결된 여행이 사실상 사본이다. 비교 화면에서 고르지 않은 쪽은 사라진다고 미리 알린다.
- 장소 정보(이름·주소·라벨·메모·한 줄 평)의 함께 편집. 장소 정보는 그 장소가 공동 여행에 처음 들어올 때 고정된다. 이름을 바꿔도 내 보관함에만 바뀐다.
- 편집 참여자의 보기 링크·편집 초대 만들기, 2A 옵션(`메모 포함`) 바꾸기. 소유자만 한다.
- 보기 링크 화면(`/view#t=`)에 공동 진행 표시. 보기 화면은 2A 그대로 일정만 보인다.
- 같은 목록의 자동 순서 병합(예: 두 사람이 같은 Day에 각자 장소를 끼워 넣은 것을 합쳐 주기). 순서 겹침은 늘 비교 화면이다.
- `함께 편집 끝내기`(공유를 2A 상태로 되돌리기). 기기를 하나씩 거두거나 2A `서버에서 지우기`를 쓴다.
- 예약 작업(Cron). 만료 정리는 요청 때 한다(2A 정리에 2B 표를 더한다).

## 사용 흐름

### 소유자: 편집 초대 만들기

1. 2A `갱신 링크` 창(계획 화면 Day 머리의 `일정 공유` › `갱신 링크…`)의 새 줄 `함께 편집…`, 여행 목록 카드 메뉴의 `함께 편집…`, 또는 (켠 뒤에는) 계획 화면 띠의 `함께 편집` 단추로 `함께 편집` 창(새 지연 창 `TripCollabDialog`)을 연다.
   - 갱신 링크가 아직 없으면 창은 `함께 편집하려면 먼저 갱신 링크를 만들어야 해요` + `갱신 링크 만들기…`(2A 창을 연다)를 보인다.
2. 갱신 링크가 있으면 안내와 입력을 보인다.
   - 안내: `편집 초대 링크를 받은 사람이 수락하면 그 기기에서 이 여행을 함께 고칠 수 있어요. 초대 링크는 한 번만 쓸 수 있고 7일 뒤 닫혀요. 보기 링크와 달리 일정을 바꿀 수 있으니 함께 갈 사람에게만 보내세요`
   - 입력 `누구에게 보내나요? (선택)`(0~30자, 예 `민지`). 기다리는 초대 목록에서 구분하는 이름일 뿐 받는 사람에게는 보이지 않는다.
   - 단추 `편집 초대 링크 만들기`.
3. 처음 누르면 이 기기가 공동 편집을 켠다: 최신 서버 문서와 이 기기 여행을 병합하고, 겹치면 비교 창에서 고른 뒤 결과를 v2로 올린다(§화면 상태와 갱신의 「공동 편집 켜기」). 그다음 초대를 만들고 링크와 `링크 복사`·`링크 공유`·`카카오톡`(2A 창과 같은 조건) 단추를 보인다.
   링크 아래: `이 링크는 한 사람(기기 하나)만 쓸 수 있어요. 여러 명이면 사람마다 새로 만드세요`.
4. 창 아래 두 목록
   - `함께 고치는 기기`: `{기기 이름} · {마지막 접속}`(`오늘`·`어제`·`N일 전`)과 `편집 권한 거두기`. 비면 `아직 함께 고치는 기기가 없어요`.
   - `기다리는 초대`: `{누구에게 또는 '이름 없는 초대'} · {M월 D일}까지`와 `초대 취소`.
5. `편집 권한 거두기`는 확인 창 `‘{기기 이름}’ 기기의 편집 권한을 거둘까요?` / `그 기기는 더 이상 이 여행을 고치거나 새 내용을 받을 수 없어요. 그 기기 보관함에 담긴 여행은 그대로 남아요` / `거두기` 뒤 바로 반영한다.

### 받은 사람: 수락(`/trips/join/<id>#i=<초대 토큰>`)

1. 앱이 해시를 읽고 `history.replaceState`로 지운 뒤 `초대를 확인하는 중이에요`를 보이고 초대 미리보기(`GET …/invite`)를 받는다.
2. 이 기기에 같은 공유의 연결 기록이 이미 있고 그 여행이 살아 있으면 그 여행 계획 화면으로 간다(초대를 쓰지 않는다).
3. 미리보기: 제목 `함께 편집 초대`, 여행 제목·기간, 안내 `수락하면 이 기기 보관함에 이 여행을 담고, 여기서 고친 내용과 다른 사람이 고친 내용을 서로 맞춰요. 공동 여행은 Landmark 서버에 암호화하지 않고 저장돼요`, 입력 `이 기기 이름`(1~30자, 기본 `내 휴대폰` — `(pointer: coarse)`가 아니면 `내 컴퓨터`), 단추 `수락하고 함께 편집하기`·`취소`.
4. 누르면 `POST …/accept`(초대 토큰 + 이 기기가 만든 편집 토큰 + 기기 이름). 성공하면 `GET …/state`로 공동본을 받아 **새 여행**으로 담고(Stop id·Day id는 서버 것, 장소는 받은 공유 가져오기 규칙으로 합침) 연결 기록을 만든 뒤 `함께 편집을 시작했어요`를 알리고 계획 화면으로 간다.
   - 편집 토큰은 처음 누를 때 만들어 화면 상태에 두므로, 응답이 사라져 다시 누르면 같은 토큰으로 보내 서버가 같은 기기로 받는다(초대는 이미 썼어도). 수락 뒤 받기·보관함 반영이 실패하면 이 화면에서 재시도하도록 알리고, 새로 고쳐 토큰을 잃었으면 보낸 사람이 이 기기의 권한을 거두고 새 초대를 보내야 한다고 안내한다.
5. 실패 문구: 쓴·취소된·없는 초대 `이미 쓴 초대이거나 닫힌 초대예요. 보낸 사람에게 새 초대 링크를 받아 주세요`, 끝난 공유 `공유가 끝난 여행이에요`, 기기 수 초과 `함께 고칠 수 있는 기기 수(20대)를 넘었어요`, 스위치 `지금은 함께 편집을 시작할 수 없어요. 잠시 뒤 다시 해 주세요`, 오프라인 `인터넷 연결을 확인하고 다시 해 주세요` + `다시 시도`.

### 함께 고치기(모든 편집 기기와 소유자)

- 연결된 여행의 계획 화면은 지금 그대로다. 위에 한 줄 **함께 편집 띠**(`CollabBar`)가 생긴다: `함께 편집 중 · {HH:mm}에 맞췄어요` + `함께 편집` 단추(창을 연다). 다른 기기의 변경을 받아 반영하면 `‘{기기 이름}’에서 일정을 바꿨어요 · {HH:mm}`(`aria-live="polite"`).
- 이 기기에서 고치면 3초 모았다가 맞춘다(받기 → 병합 → 반영 → 올리기). 띠: `맞추는 중이에요` → `함께 편집 중 · {HH:mm}에 맞췄어요`.
- 다른 기기에서 고친 것이 이 기기에서 고친 것과 **다른 곳**이면 둘 다 남는다(예: 내가 Day 1 출발 시각, 친구가 Day 2 숙소).
- **같은 곳**을 다르게 고쳤으면 띠가 `다른 기기와 같은 곳을 고쳤어요 · {N}곳` + `비교하기`로 바뀌고, 이 기기는 고르기 전까지 올리지도 받은 것을 반영하지도 않는다(확인은 계속해 겹침 목록을 새로 고친다). 이 기기에서 계속 고칠 수는 있다.
- `비교하기`는 비교 창(`CollabConflictDialog`, 지연 청크)을 연다.
  - 안내: `이 기기와 다른 기기에서 같은 곳을 고쳤어요. 곳마다 남길 쪽을 골라 주세요. 고르지 않은 쪽의 변경은 사라져요`
  - 곳마다 두 칸 `이 기기` / `공동 여행`과 라디오. 값 겹침은 한 줄(`Day 2 출발 시각 — 10:00 / 09:30`), 순서·배치 겹침은 그 묶음의 Day·후보 목록을 두 열로 나란히(장소 이름 순서, 다른 쪽에 없는 장소와 자리가 다른 장소는 굵게).
  - `모두 이 기기로`·`모두 공동 여행으로`·`고른 대로 맞추기`(모두 골랐을 때만)·`나중에`.
  - 맞추는 사이 공동 여행이 또 바뀌어 겹침이 달라졌으면 창을 새 겹침으로 다시 그리고 `그사이 공동 여행이 또 바뀌었어요. 다시 골라 주세요`.
- 오프라인이어도 계속 고칠 수 있다. 띠 `오프라인이에요. 고친 내용은 연결되면 맞춰요`. 돌아오면 같은 순서로 맞춘다.

### 소유자: 참여 기기 관리

- `함께 편집` 창의 목록(§소유자: 편집 초대 만들기 4·5). 거둔 기기는 다음 요청(늦어도 10초 안팎)에 `401`을 받아 띠에 `이 기기의 편집 권한이 거둬졌어요. 이 여행은 이 기기에만 남아요`를 보이고 맞추기를 멈춘다.
- 소유자 토큰을 다시 만들거나(2A `소유자 링크 다시 만들기`) 보기 링크를 다시 만들어도 편집 기기는 영향이 없다.
- 2A `서버에서 지우기`는 편집 기기·초대·진행 자료까지 지운다. 편집 기기는 `404`를 받아 `공동 여행이 끝났어요. 이 여행은 이 기기에만 남아요`.

### 보기 초대와 편집 초대

- 2A 보기 링크(`/view#t=`)는 읽기 전용이고 여러 사람이 같은 링크를 쓴다. 편집 초대는 한 번만 쓰고 기기를 하나 만든다.
- 두 링크는 다른 창·다른 단추에서 만든다. 2A `갱신 링크` 창의 `함께 편집…` 줄 설명: `보기 링크는 누구나 볼 수만 있고, 편집 초대 링크는 받은 한 사람이 함께 고칠 수 있어요`.
- 편집 기기 화면은 보기 링크를 보이지 않는다(소유자가 보기 범위를 정한다). 편집 기기에서 연결된 여행의 `일정 공유` 창을 열면 갱신 링크 줄은 `함께 편집 중인 여행의 갱신 링크는 만든 사람이 관리해요`만 보이고 만들기 단추를 숨긴다(링크 복사·파일 저장은 그대로).

### 편집 참여자: 그만두기·사본

- `함께 편집` 창(참여자 모드): `함께 편집 중이에요 · 이 기기 이름 {이름} · 함께 고치는 기기 {N}대`, 단추 `내 여행으로 따로 저장`, `편집 그만두기`.
- `내 여행으로 따로 저장`: 지금 공동본을 2A `importLiveTrip`(`preferredTripId: null`)으로 **연결 없는 새 여행**에 담는다. 알림 `공동 여행을 새 여행으로 저장했어요` + `열기`.
- `편집 그만두기`: 확인 창 `이 기기에서 함께 편집을 그만둘까요?` / `이 여행은 이 기기 보관함에 그대로 남지만 더 이상 다른 사람의 변경을 받지 않아요. 다시 참여하려면 새 초대 링크가 필요해요` / `그만두기` → 서버에서 이 기기를 지우고 연결 기록을 지운다. 여행은 보통 여행이 된다. 오프라인이면 `인터넷 연결을 확인하고 다시 해 주세요`(기록은 남긴다).
- 연결된 여행을 보관함에서 지우면(여행 목록 지우기) 편집 기기는 확인 창에 `함께 편집 중인 여행이에요. 이 기기에서만 지워지고 공동 여행은 남아요. 이 기기의 함께 편집도 그만둬요`를 더하고(소유자 기기는 2A 문구만), 지운 뒤 그만두기 요청을 한 번 보낸다(실패해도 기록은 지운다).
- 소유자도 같은 창에 `내 여행으로 따로 저장`을 가진다.

### 공동 당일 진행

- 연결된 여행의 당일 화면(`/trips/:id/today`)은 체크·다음 장소를 **공동 진행 자료**로 그린다. 머리 부제 아래 표시 `함께 진행`.
- 다녀옴 상자를 누르면: 이 기기 보관함 장소의 `visitedOn`을 지금처럼 쓰고, 공동 진행에 `다녀옴`(그 Day 날짜, 누른 시각)을 보낸다. `되돌리기` 토스트는 둘 다 되돌린다.
- 다른 기기가 누른 체크는 `다녀옴 · {기기 이름}`으로 보이고 다음 장소 계산에 들어간다. 내 `visitedOn`은 바꾸지 않는다(개인 기록과 분리, 룰링 3).
- 다음 장소는 공동 체크로 계산한다(지금 `pickNext` 규칙). 카드에서 다른 장소를 고르면 `다음 장소로 정하기` 단추가 생기고, 누르면 모두에게 그 장소가 다음 장소로 보인다(`다음 장소 · ‘{기기 이름}’에서 정함`). 그 장소를 다녀옴으로 체크하거나 오늘 Day가 바뀌면 정한 것이 풀린다.
- 체크는 오프라인에서도 된다. 보내지 못한 체크는 기기에 모아 두었다가 연결되면 보낸다(누른 시각 기준으로 늦은 것이 이긴다).
- 당일 화면이 보이는 동안 10초마다 같이 확인한다(계획 화면과 같은 요청).

### 소유자 다른 기기

- 2A 소유자 링크로 연결한 다른 소유자 기기가 공동 편집이 켜진(v2) 공유를 만나면, 그 기기는 **소유자 역할로 합류**한다(연결 기록을 만들고 장소 대응표를 맞춘다).
  - 계획 화면을 열 때 2A 기록만 있고 연결 기록이 없으면 2A `GET`을 한 번 보내 `doc.v`를 본다. 2A 반영 훅이 `409 { reason: 'version' }`을 받을 때도 같다.
  - 기준으로 보관한 공동 계획이 있으면 그것을 쓴다. 받은 서버 문서의 `v`를 1로 놓은 편집 지문이 2A `publishedKey`와 같으면 받은 서버 계획을 기준으로 쓴다. 그렇지 않아도 2A 규칙(기록의 제목·공개 옵션·Day id)으로 다시 만든 v1 문서의 계획 지문(`livePlanKey`)이 기록의 `planKey`와 같으면 미공개 수정이 없는 기기다. 계획 지문은 만든 시각과 경로 조회 결과(시간·거리·요금·상태·조회 시각·경로선)를 제외하고 문서 전체를 담으며 구간은 `[from, to, mode]`만 남긴다. 따라서 제목·기간·출발지·공개 후보·Stop 값과 id·Day 시각과 숙소·이동 수단 등 공개 계획 값은 빠지지 않는다. `planKey`는 2A 공개 성공(처음 만들기·갱신)과 소유자 링크 담기 때 `publishedKey`와 함께 저장하는 선택 필드다. 옛 기록에 `planKey`가 없으면 현재 경로 상태로 만든 문서와 모든 구간을 `ESTIMATE_ONLY`로 만든 문서 중 하나라도 편집 지문이 `publishedKey`와 같을 때만 깨끗한 기기로 본다(둘 다 다르면 기준을 추측하지 않는다). 이때는 **다시 만든 공개 문서**를 장소 대응표와 서버 Day id로 바꾼 계획을 공통 기준으로 써서 다른 기기의 변경을 자동으로 받는다. 로컬 투영은 기준으로 쓰지 않는다(`includeCandidates: false`로 공개에서 뺀 후보는 기준에도 빠지고 로컬 변경으로 남는다). 미공개 수정이 없음을 확인하지 못하고 서버 공개본도 확인할 수 없으면 기준 없이 시작해 다른 곳을 모두 비교 화면에 올린다.
- 합류하면 그 여행의 2A 자동 반영은 멈추고(2A 반영 훅 상태 `collab`) 함께 편집 맞추기가 대신한다.
- 2A 소유자 링크 화면(`TripLiveLinkPage`)에서 v2 공동본을 담으면 처음부터 소유자 역할 연결 기록을 같이 만든다.

## 서버 자료 모델

### 공유 문서 `LiveTripDoc` v2

```ts
type LiveTripDoc = {
  format: 'landmark-trip-live';
  v: 1 | 2; // 2B: 2를 더한다. 모양은 같다.
  share: ShareDocV2;
  ids: { days: string[]; stops: string[][] };
  options: { includeMemo: boolean; includeCandidates: boolean };
};
```

- 키·모양은 v1과 같다. `v: 2`의 뜻
  1. `share.places[].id`는 **서버 장소 id**(10자 a-z0-9)이고 기기와 무관하게 유지된다.
  2. `share.trips[0]`·`ids`가 공동 계획 전체다. 후보는 늘 싣는다(`options.includeCandidates`는 `true`로 둔다). Stop은 보관함에서 지운 장소의 것도 싣는다(아래 §장소 서버 id와 기기별 대응).
  3. 쓰기는 병합을 아는 클라이언트(2B)만 한다. 서버는 저장된 `v`보다 낮은 `v`를 받으면 `409 { reason: 'version' }`.
- 검사 `parseLiveDoc`(2A)를 넓힌다: `v`는 1 또는 2. `v === 2`면 모든 `share.places[].id`가 `^[a-z0-9]{10}$`. 나머지 규칙은 2A 그대로.
- 모양이 같으므로 2A만 있는 버전으로 되돌릴 때 `json_set(doc, '$.v', 1)`로 버전을 바꾸고 `rev = rev + 1`로 캐시를 갱신하면 2A가 다시 읽는다(§호환·롤백).
- 문서 크기·경로선 한도는 2A 그대로(`LIVE_DOC_MAX_BYTES` 524,288, 경로선 10,000점).
- `share.title`과 `share.trips[0].title`은 v2에서 늘 같은 값(공동 여행 제목)이다. 2A 창의 제목 입력은 v2 공유에서 숨기고 `함께 편집 중에는 여행 이름을 따라요`를 보인다.

### 공동 계획 `CollabPlan`(병합 단위)

문서에서 병합에 쓰는 부분만 뽑은 모양이다. 모든 장소 id는 서버 id다. 경로·장소 정보는 없다.

```ts
type CollabStop = { id: string; placeId: string; stayMin: number | null; fixedTime: string | null; note: string };
type CollabDay = { id: string; startTime: string; lodging: string | null; stops: CollabStop[] };
type CollabPlan = {
  title: string;
  startDate: string;
  endDate: string;
  origin: string | null;
  candidates: string[];
  legModes: Record<string, 'car' | 'walk'>; // "<서버 id>><서버 id>"
  days: CollabDay[];
};
```

- `planFromDoc(doc)`: `share.trips[0]`과 `ids`로 만든다(`note`가 없으면 `''`).
- `projectLocalTrip(trip, toServer, dayIds)`: 로컬 여행의 **저장된 값 그대로**(지운 장소의 Stop 포함, `visibleStops`를 쓰지 않음)를 서버 id로 옮긴다.
- 지문 `planKey(plan)`: 객체 키를 정렬한 JSON 문자열. 이 기기에 올릴 것이 있는지(`planKey(mine) !== planKey(base)`)를 본다.

### 장소 서버 id와 기기별 대응

- 기기마다 연결 기록에 `placeMap: { [서버 장소 id]: 로컬 장소 id }`를 둔다.
- **받을 때**(`mapServerPlaces`): 공동본의 장소 가운데 대응이 없는 것은
  1. 같은 id의 로컬 장소가 있고 출처가 같으면(네이버 sid·카카오 id·구글 id가 같거나, 둘 다 핀이고 좌표가 같음) 그 장소에 잇는다(소유자 기기가 흔히 이렇다).
  2. 아니면 받은 공유 가져오기(`importSharePlaces`, 그 장소들만 `selected`)로 찾거나 새로 담는다. 같은 네이버·카카오·구글 장소는 합쳐지고, 지운 장소는 되살아난다. 장소의 라벨도 그 규칙대로 담긴다.
- **올릴 때**(`assignServerPlaceIds`): 이 기기 여행에만 있는 장소(대응표의 값에 없음)는 로컬 id를 서버 id로 쓴다. 그 id가 이미 공동본·대응표에 다른 장소로 있으면 새 10자 id를 만든다. 정한 값은 대응표에 바로 저장한다.
- 대응표는 서버에 올리지 않는다. 다른 기기는 출처로 같은 장소를 찾는다.
- **장소 정보**(이름·주소·좌표·출처·라벨): 공동본에 이미 있는 장소는 공동본 값을 그대로 둔다. 새 장소는 올린 기기 보관함 값으로 만든다. 메모·한 줄 평은 소유자 기기가 `메모 포함`을 켰을 때 소유자 기기가 들인 장소에만 싣고, 편집 기기가 들인 장소에는 싣지 않는다.
- **보관함에서 지운 장소**: 로컬 투영은 지운 장소의 Stop도 그대로 담는다. 그래서 내 보관함 정리가 공동 일정을 바꾸지 않는다. 계획 화면은 지금처럼 숨기고 `보관함에서 지운 N곳은 일정에서 빠졌어요`를 보인다(이 기기에서만).

### Stop·Day id

- Stop id는 서버·로컬이 같다(받을 때 서버 Stop id 그대로 담음, 이 기기에서 새로 만든 Stop의 로컬 id가 그대로 서버 id). 새 Stop id가 공동본의 다른 Stop id와 겹치면(8자 무작위, 드묾) 맞추기 전에 로컬 id를 새로 만든다.
- Day는 2A처럼 **위치가 정체성**이다. 병합은 Day를 번호로 맞추고, 결과의 `ids.days`는 공동본에 있는 위치는 공동본 id, 새 위치는 이 기기 id를 쓴다. 연결 기록의 `dayIds`를 그 값으로 바꾼다.

### 병합 규칙

입력은 `B`(마지막으로 맞춘 공동 계획, 없을 수 있음) · `M`(이 기기 투영) · `T`(지금 공동본). 결과는 병합한 계획과 겹침 목록이다.

1. **값 필드** — `title`, `origin`, Day 번호별 `startTime`·`lodging`, `legModes`의 키마다(없음도 값), Stop id별 `stayMin`·`fixedTime`·`note`.
   `M == B`면 `T`, `T == B`면 `M`, `M == T`면 그 값, 셋 다 다르면 **값 겹침**. 한쪽에만 있는 Day의 값은 그쪽 값이다. `B`에 없는 Day를 양쪽이 만들었으면 `B` 자리에 새 Day 기본값(`09:00`, 숙소 없음)을 놓고 비교한다.
2. **기간** — `{startDate, endDate}`를 한 값으로 1처럼 본다. 기간이 겹치면 아래 3의 배치 묶음에 기간을 함께 넣는다.
3. **배치(순서·소속)** — 목록은 후보(`c`)와 Day 번호별 Stop 목록(`d0`, `d1`, …)이다. 목록 내용은 장소 id 순서다.
   - 목록마다 1과 같은 3방향 규칙. 셋 다 다르면 그 목록은 **겹친 목록**.
   - 장소마다 위치(어느 목록, 없으면 빠짐)도 3방향 규칙. 셋 다 다르면(예: 한쪽은 Day 2로, 한쪽은 Day 3으로 옮김) 그 장소가 `B`·`M`·`T`에서 있던 목록을 모두 겹친 목록으로 둔다.
   - 한쪽이 없앤 Stop의 값(1의 Stop 필드)을 다른 쪽이 바꿨으면(삭제 대 수정) 그 Stop이 `B`에서 있던 목록과 다른 쪽에서 있는 목록을 겹친 목록으로 둔다.
   - 기간이 한쪽에서만 줄어 결과 Day 수가 N이 되었는데, 잘린 Day(`i ≥ N`)의 목록·출발 시각·숙소 중 하나라도 다른 쪽이 바꿨으면 기간·그 Day들·후보를 한 겹침으로 둔다(잘린 Day의 장소는 후보로 가기 때문). 기간 자체가 겹치면 기간·두 Day 수 중 작은 수 이상의 Day 목록·후보를 한 겹침으로 둔다.
   - **묶음**: 겹친 목록끼리, 그리고 `M`·`T` 위치가 다른 장소가 오간 목록끼리 이어 붙인다(더 붙지 않을 때까지). 묶음 하나가 비교 화면의 한 곳이고, 고르면 묶음 안 모든 목록(그리고 기간)을 그쪽 것으로 쓴다.
   - 겹치지 않은 목록은 3방향 결과를 쓴다. Stop 값은 양쪽에 있는 Stop은 1의 결과, 한쪽에만 있는 Stop은 그쪽 값이다. 같은 장소를 서로 다른 Stop id로 추가했으면 기준 없는 Stop 쌍으로 보고 `stayMin`·`fixedTime`·`note`가 다를 때 값 겹침으로 묻는다. 값 겹침 id는 배치 선택과 무관하게 공동 쪽 Stop id로 고정하고, 결과 Stop id는 고른 배치의 id를 써서 이 기기에도 맞춰 반영한다. 결과에서 빠진 Stop의 값 겹침은 버린다.
4. **마지막 검사(안전망)** — 묶음마다 고른 뒤 결과가 여행 규칙(장소는 Stop·후보 통틀어 한 번, Stop id 중복 없음, Day 수 = 기간 날 수)을 어기면, 모든 목록과 기간을 한 묶음(`전체 배치`)으로 다시 묻는다. 이때도 값 겹침은 숨기지 않으며, 배치 선택 뒤 새 값 겹침이 드러나면 다시 묻는다. 정상 경로에서는 일어나지 않아야 하며 시험으로 막는다.
5. **기준이 없을 때**(`B` 없음: 기기 저장이 지워짐, 계획 지문·옛 기록의 두 편집 지문으로도 깨끗함을 확인하지 못하고 서버 공개 기준도 없는 소유자 다른 기기 합류, 롤백 뒤 다시 올림) — `M`과 `T`가 다른 값 필드는 모두 값 겹침, 다른 목록이 하나라도 있으면 다른 목록 전부와 (다르면) 기간을 한 묶음으로 둔다. 같은 곳은 그대로 둔다.
6. 겹침이 남아 있으면 결과를 올리지도 이 기기에 반영하지도 않는다. 고른 뒤 다시 1부터 계산한다(그사이 공동본이 바뀌었을 수 있다).

겹침 id(비교 화면·선택 기억용): `title`, `origin`, `day.<번호>.startTime`, `day.<번호>.lodging`, `legMode.<키>`, `stop.<Stop id>.<필드>`, `placement.<목록 id를 정렬해 ,로 이은 것>`(기간이 들면 앞에 `period,`, 예 `placement.period,c,d3,d4`).

### 공동 진행 자료

- 문서와 따로 둔다. 문서 `rev`를 올리지 않고 진행 revision `prev`만 올린다.
- 행: Stop id마다 `visited`(1·0)·`date`(그 Day 날짜)·`by_device`(`owner` 또는 기기 id)·`by_label`·`at`(누른 시각). 풀기도 `visited = 0` 행으로 남겨 늦게 누른 쪽이 이기게 한다(`at` 비교, 서버 시각보다 늦은 `at`은 서버 시각으로 자른다).
- 정한 다음 장소: 공유마다 하나 `{ stopId | null, date, label, at }`, 늦게 정한 쪽이 이긴다.
- 클라이언트는 지금 공동 계획에 없는 Stop의 행을 무시한다. 다녀옴으로 보이는 것은 `visited = 1`이고 `date`가 여행 기간 안인 행이다.
- 소유자 기기의 이름은 `만든 사람`이다.

## D1 표(스키마 버전 4)

`src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에** 더하고 `SCHEMA_VERSION = 4`. 모두 `IF NOT EXISTS`, `ALTER TABLE` 없음.

```sql
-- 4: 여행 함께 편집(2B). 초대는 2A trip_share_tokens(kind='invite')를 쓴다.
CREATE TABLE IF NOT EXISTS trip_collab_devices (
  share_id TEXT NOT NULL,
  device_id TEXT NOT NULL,      -- 8자 a-z0-9, 서버가 만든다
  token_hash TEXT NOT NULL,     -- SHA-256(편집 토큰) base64url
  label TEXT NOT NULL,          -- 기기 이름 1~30자
  created_at TEXT NOT NULL,
  seen_at TEXT NOT NULL,        -- 마지막 요청(1시간 단위로만 고친다)
  PRIMARY KEY (share_id, device_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS trip_collab_devices_token ON trip_collab_devices(token_hash);
CREATE TABLE IF NOT EXISTS trip_collab_meta (
  share_id TEXT PRIMARY KEY,
  progress_rev INTEGER NOT NULL,  -- 진행 revision(prev)
  next_stop_id TEXT,              -- 정한 다음 장소(없으면 NULL)
  next_date TEXT,
  next_label TEXT,
  next_at TEXT,
  edited_label TEXT,              -- 마지막으로 공동본을 올린 기기 이름
  edited_at TEXT
);
CREATE TABLE IF NOT EXISTS trip_progress (
  share_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  visited INTEGER NOT NULL,
  date TEXT NOT NULL,
  by_device TEXT NOT NULL,
  by_label TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (share_id, stop_id)
);
```

- 초대: 2A `trip_share_tokens`에 `kind = 'invite'`, `label` = `누구에게`(없으면 NULL), `expires_at` = `min(지금 + 7일, 공유 기한)`. 수락하면 그 행을 지운다. 목록·취소에 쓰는 공개 키는 `substr(hash, 1, 16)`이다.
- 편집 기기는 2A가 예고한 `kind = 'editor'` 행 대신 `trip_collab_devices`에 둔다(기기 id·마지막 접속 열이 필요하고 ALTER는 쓰지 않는다. 결정 표 11).
- 공유를 지울 때(2A `DELETE`)와 만료 정리(2A `pruneExpiredLive`)는 같은 `batch`에서 2B 세 표의 행도 지운다(하위 질의로 같은 대상).
- 한도: 공유당 편집 기기 20대, 기다리는 초대 10개, 진행 행 2,000개.
- `rev`는 2A처럼 문서가 바뀔 때만 오른다. 진행·초대·기기 변경은 `rev`를 올리지 않는다.

## 브라우저 저장

- 보관함 형식(`tripmap:library:v2`, schemaVersion 2)·백업 형식·공유 문서 형식은 바꾸지 않는다. 2A 키 `tripmap:trip-live:v1`의 모양도 바꾸지 않는다.
- 새 키 `tripmap:trip-collab:v1`: `{ [로컬 여행 id]: TripCollabRecord }`(최대 100개).

```ts
type TripCollabRecord = {
  tripId: string;
  liveId: string;
  role: 'owner' | 'editor';
  /** 편집 기기의 편집 토큰(43자). 소유자는 null(2A 기록의 ownerToken을 쓴다). */
  token: string | null;
  /** 편집 기기 id(8자). 소유자는 null. */
  deviceId: string | null;
  label: string;
  status: 'live' | 'revoked' | 'ended';
  rev: number;           // 기준 공동 계획의 revision
  prev: number;          // 받은 진행 revision
  dayIds: string[];
  placeMap: Record<string, string>;
  syncedAt: string;
  title: string;         // 설정 목록 표시용(마지막으로 맞춘 제목)
  pendingProgress: ProgressOp[]; // 아직 못 보낸 체크(최대 200, 오래된 것부터 버림)
};
```

- 새 키 `tripmap:trip-collab-base:v1:<공유 id>`: `{ rev: number; plan: CollabPlan; progress: SharedProgress | null }`. 기준 계획과 마지막 진행(오프라인 당일 화면용)이다. 기록을 지우면 같이 지운다. 저장이 막히거나 넘치면 그 페이지 동안 메모리에만 두고, 다음에 없으면 「기준이 없을 때」 규칙을 쓴다.
- 깨진 값은 빈 기록으로 읽는다. 다른 탭의 변경은 `storage` 이벤트로 받는다(2A 관례).
- 토큰은 보관함·백업에 넣지 않는다. 백업을 다른 기기에 되살려도 연결은 따라가지 않는다.

## API(Pages Functions)

진입점 `functions/api/trip-collab/[id]/**`, 처리 `src/server/trip-collab/handlers.ts`. 모든 응답 `Cache-Control: private, no-store`, 모든 경로 출처 검사, 토큰은 `Authorization: Bearer <토큰>`. 역할은 토큰 해시로 찾는다: 2A `trip_share_tokens`의 `owner` → 소유자, `trip_collab_devices` → 편집 기기.

| 요청 | 하는 일 | 권한 | 성공 |
|---|---|---|---|
| `POST /api/trip-collab/:id/invites` | `{ token, label: string \| null }` 초대 만들기 | 소유자 + 두 스위치 + 한도 `collabInvite` | `201 { key, expiresAt, created: true }`. 같은 토큰 재시도 `200 { …, created: false }`. 문서가 v1이면 `409 { reason: 'upgrade' }`, 기다리는 초대 10개면 `409 { reason: 'full' }` |
| `DELETE /api/trip-collab/:id/invites/:key` | 초대 취소 | 소유자 + 한도 `collabManage` | `204`(없어도 `204`) |
| `GET /api/trip-collab/:id/invite` | 초대 미리보기 | 초대 토큰 | `200 { title, startDate, endDate, expiresAt }`. 없는·쓴·지난 초대 `401 { reason: 'invite' }`(그때만 `collabRead` 셈) |
| `POST /api/trip-collab/:id/accept` | `{ deviceToken, label }` 수락 | 초대 토큰 + 두 스위치 + 한도 `collabAccept` | `201 { deviceId, rev }`. 같은 `deviceToken`이 이미 이 공유의 기기면 `200 { deviceId, rev }`. 기기 20대면 `409 { reason: 'full' }`, 초대가 틀리면 `401 { reason: 'invite' }` |
| `GET /api/trip-collab/:id/state?rev=<n>&prev=<n>` | 공동본·진행 읽기 | 소유자·편집 기기 | `200 { rev, updatedAt, expiresAt, role, deviceId, members, editedBy, doc?, progress? }`. `doc`은 `rev`가 없거나 다를 때만, `progress`는 `prev`가 없거나 다를 때만. 둘 다 같으면 `304` |
| `PUT /api/trip-collab/:id/doc` | `{ doc, baseRev }` 공동본 올리기(v2만) | 소유자·편집 기기 + 두 스위치 + 한도 `collabUpdate` | `200 { rev, expiresAt }`. `rev`가 다르면 `409 { rev }`, 저장된 `v`가 더 크면 `409 { reason: 'version' }` |
| `POST /api/trip-collab/:id/progress` | `{ ops: ProgressOp[], next?: NextOp }` 진행 올리기 | 소유자·편집 기기 + `TRIP_COLLAB` + 한도 `collabProgress` | `200 { prev, marks, next }`. 행이 2,000개를 넘으면 `409 { reason: 'full' }` |
| `GET /api/trip-collab/:id/members` | 기기·기다리는 초대 목록 | 소유자 | `200 { devices: [{ deviceId, label, createdAt, seenAt }], invites: [{ key, label, createdAt, expiresAt }] }` |
| `DELETE /api/trip-collab/:id/members/:device` | 기기 거두기(`:device`가 `me`면 그 편집 기기 스스로 그만두기) | 소유자(기기 id) · 편집 기기(`me`) + 한도 `collabManage` | `204`(없어도 `204`) |

- "두 스위치"는 `TRIP_COLLAB`과 2A `TRIP_SHARE_LIVE`다. 어느 하나라도 `off`면 `503 { reason: 'off' }`.
- `ProgressOp = { stopId: string(8자), visited: boolean, date: 'YYYY-MM-DD', at: ISO }`(한 번에 0~50개, 0개면 `next`가 있어야 한다), `NextOp = { stopId: string | null, date, at }`. 응답 `marks`는 `visited = 1`인 행만 `{ stopId, date, at, by: { device, label } }`, `next`는 `{ stopId, date, at, label } | null`.
- `state`의 `members`는 편집 기기 수, `editedBy`는 마지막으로 올린 기기 이름(없으면 null). `doc`은 2A처럼 저장 문자열을 파싱하지 않고 이어 붙인다. `304` 판정은 `trip_shares`·`trip_collab_meta` 한 번의 조인으로 문서를 읽지 않고 한다.
- `state`는 편집 기기의 `seen_at`이 1시간보다 오래됐을 때만 고친다(쓰기 수 절약).
- 2A 경로의 바뀜: `PUT /api/trip-live/:id`(2A)는 v2 문서를 올릴 때 `TRIP_COLLAB=off`이면 `503 off`로 멈춘다(v1 쓰기·읽기는 그대로). 또한 `json_extract(doc, '$.v')`로 저장된 버전을 읽어 낮은 `v`를 `409 { reason: 'version' }`로 거절한다. `DELETE /api/trip-live/:id`·만료 정리는 2B 표도 지운다. 2A의 다른 동작은 그대로다.
- 오류 코드는 2A와 같다(새 코드 없음). `reason`만 `invite`·`full`·`upgrade`·`version`을 더한다.
- 편집 토큰·초대 토큰은 브라우저가 만든다(2A `newLiveToken`, 43자). 기기 id는 서버가 만든다.
- 수락은 한 `batch`로 한다: `INSERT … SELECT … WHERE EXISTS(살아 있는 초대)`로 기기를 만들고 같은 배치에서 초대 행을 지운다. 기기 행이 생기지 않았으면 같은 편집 토큰의 기기가 이미 있는지 보고(응답 유실 재시도) 아니면 `401 invite`.

## 화면 상태와 갱신

### 맞추기 엔진(`CollabEngine`)

여행마다 하나(참조 수로 시작·멈춤)이고 계획 화면·당일 화면·`함께 편집` 창이 같은 엔진을 본다. 같은 기기의 여러 탭은 `navigator.locks`(`tripmap:trip-collab:<여행 id>`)로 한 번에 하나만 맞춘다(없으면 모듈 잠금).

**한 번 맞추기**(`sync`)

1. 기록·기준을 저장소에서 다시 읽는다.
2. `GET state?rev=<메모리 문서 rev>&prev=<메모리 진행 prev>`(문서 캐시가 없으면 `rev`·`prev` 없이). 문서와 그 `rev`를 함께 기억해 병합 대상과 `baseRev`가 같은 판에서 나오게 한다. `304` 또는 `doc` 없는 응답인데 캐시 문서가 기록·기준보다 낡거나 응답 `rev`와 다르면 `rev` 없이 문서를 다시 받는다. 겹침 상태에서도 받은 문서의 `rev`를 보내 전체 문서를 반복해서 받지 않는다. 진행도 엔진이 실제로 가진 `prev`로 요청해 다른 탭이 기록한 체크·다음 장소를 빠뜨리지 않는다.
3. 받은 진행은 기준 저장소의 `progress`와 기록 `prev`에 넣는다.
4. 대응표를 맞추고(`mapServerPlaces`, 보관함 연산), 이 기기 여행을 투영한다(`assignServerPlaceIds`, Stop id가 겹치면 로컬 Stop id 바꾸기 연산 후 다시 투영).
5. 병합한다. 겹침이 있으면 상태 `conflict`로 멈춘다.
6. 결과가 이 기기 투영과 다르면 보관함에 반영한다(`applyCollabPlan`). 반영 연산은 보관함 잠금 안에서 이 기기 투영을 다시 만들어 5에서 쓴 것과 다르면 반영하지 않고 1부터 다시 한다(그사이 사람이 고침). 반영 성공 뒤에는 올리기 전에 기준을 `{ rev: 받은 문서 rev, plan: 받은 공동 계획 }`으로 저장한다. 이 기준은 409·최소 간격 대기·오프라인·off·limited에서도 유지하므로 상대의 되돌림을 내 변경으로 오해하지 않는다. 내 미전송 변경과 비교에서 고른 변경은 그 공동 계획과의 차이로 남는다.
7. 결과가 공동본과 다르거나 받은 문서가 v1이면 문서를 만들어(`buildCollabDoc` → `fitLiveDoc`) `PUT doc { baseRev: 공동본 rev }`. `409 { rev }`면 1부터 다시(세 번까지, 넘으면 `busy`로 30초 뒤). 성공하면 기준 = 결과, `rev` = 새 값.
8. 결과가 공동본과 같고 v2면 기준 = 결과, `rev` = 공동본 rev.

**공동 편집 켜기(소유자 처음 기기)**: 2A 기록이 `live`이고 연결 기록이 없을 때 `함께 편집` 창의 첫 초대 만들기가 부른다. 2A `GET`(소유자 토큰)으로 최신 문서를 받고 장소 대응표를 맞춘 뒤 소유자 연결 기록을 만든다. 기준은 보관된 공동 계획, 마지막 2A 공개 지문과 일치하는 서버 계획, 또는 경로 상태를 뺀 `planKey`(옛 기록은 현재·`ESTIMATE_ONLY` 편집 지문)로 미공개 수정이 없음을 확인해 다시 만든 2A 공개 문서를 서버 id로 바꾼 계획을 쓴다(「소유자 다른 기기」와 같은 규칙). 미공개 수정이 없음을 확인하지 못하고 공개 기준도 확인되지 않을 때만 기준 없는 병합으로 모든 차이를 비교한다.

그 뒤 기존 맞추기 엔진으로 최신 공동본을 다시 받아 3방향 병합한다. 겹치면 초대를 만들지 않고 비교 창을 열며 고를 때까지 로컬 여행과 서버 일정을 덮지 않는다. 겹침이 없거나 비교를 마치면 결과를 `buildCollabDoc`으로 v2로 만들어 `PUT /api/trip-collab/:id/doc`(`baseRev` = 병합한 문서의 `rev`)으로 올린다. 이 경로는 소유자 권한으로 v1을 v2로 올리는 것도 허용하므로 별도 2A 쓰기 흐름 없이 같은 병합·409 재시도·스위치 처리를 재사용한다. 결과 계획이 v1과 같아도 v2로 올린다. 실패·대기 동안 연결 기록과 기준을 남겨 다시 맞춘다. 겹침이 없으면 이어서 초대를 만들고, 비교를 마쳤으면 첫 초대 만들기를 다시 눌러 초대를 만든다. 이미 v2면 같은 합류 규칙을 거쳐 병합만 한다.

**언제 맞추나**

- 이 기기 투영의 지문이 기준과 달라지면 3초 모은다(2A `LIVE_DEBOUNCE_MS`). 맞추는 중 생긴 보관함 변경은 표시를 남겨 끝난 뒤 다시 투영하고, 아직 차이가 있으면 3초 모아 다시 맞춘다. 구간 시간은 기다리지 않는다(아는 것만 싣고 나머지는 추정).
- 화면이 보이는 동안 10초마다(2A 보기 화면의 `createLivePoll`을 같이 쓴다: 숨기면 멈춤, 보이면·`online`에 바로, 실패 10→30→60초, 5분 입력 없으면 60초).
- 보내지 못한 진행(`pendingProgress`)이 있으면 2의 앞에서 먼저 `POST progress`.
- 올리기 최소 간격 10초(2A `LIVE_MIN_GAP_MS`).

**결과별 상태(띠 문구)**

| 결과 | 상태·띠 |
|---|---|
| 맞춤 | `synced` · `함께 편집 중 · {HH:mm}에 맞췄어요`. 공동본 변경을 반영했으면 `‘{editedBy}’에서 일정을 바꿨어요 · {HH:mm}` |
| 고친 뒤 기다림·맞추는 중 | `pending`·`syncing` · `맞추는 중이에요` |
| 겹침 | `conflict` · `다른 기기와 같은 곳을 고쳤어요 · {N}곳` + `비교하기` |
| 오프라인·`5xx` | `offline` · `오프라인이에요. 고친 내용은 연결되면 맞춰요`(폴링 간격대로 다시) |
| `503 off` | `off` · `지금은 함께 편집이 잠시 멈췄어요. 고친 내용은 다시 켜지면 맞춰요`(5분 뒤 다시) |
| `429` | `limited` · `오늘은 더 맞출 수 없어요. 내일 다시 맞춰요`(1시간 뒤 다시) |
| `413`·문서가 너무 큼 | `too-big` · `일정이 커서 보내지 못했어요. 후보나 메모를 줄여 주세요` |
| `401` | 기록 `revoked` · `이 기기의 편집 권한이 거둬졌어요. 이 여행은 이 기기에만 남아요` + `알겠어요`(기록 지움). 소유자 기기면 2A 문구 `이 기기의 갱신 링크 관리 연결이 끊겼어요. 소유자 링크로 다시 연결하세요`이고 2A 기록도 `disconnected` |
| `404`·`410` | 기록 `ended` · `공동 여행이 끝났어요. 이 여행은 이 기기에만 남아요` + `알겠어요` |
| `409 version` | `version` · `새 버전의 앱이 필요해요. 페이지를 새로 고쳐 주세요` + `새로 고침` |
| 공동본 검사 실패·반영 실패 | `failed` · `공동 여행을 맞추지 못했어요. 잠시 뒤 다시 해 볼게요` |

- `revoked`·`ended`가 되면 엔진은 멈추고 여행은 보통 여행으로 남는다. 기록은 사용자가 `알겠어요`를 누르거나 설정 목록에서 지울 때 지운다.

### 비교 창

- 겹침마다 줄 하나. 값 겹침은 필드 이름과 두 값(장소는 이름으로, 시각은 `HH:mm`, 머무는 시간은 `N분`, 비면 `없음`). 배치 겹침은 묶음 이름(`Day 2 장소 순서`, `Day 2·Day 3 장소 배치`, `후보 목록`, 기간이 들면 `여행 기간과 장소 배치`)과 목록 두 열.
- 필드 이름: `여행 이름`, `여행 기간`, `출발지`, `Day {n} 출발 시각`, `Day {n} 숙소`, `‘{장소}’ 머무는 시간`, `‘{장소}’ 도착 시각 고정`, `‘{장소}’ 메모`, `‘{장소}’→‘{장소}’ 이동 수단`.
- 고른 값은 창 상태에만 둔다. `고른 대로 맞추기` → 엔진 `resolve(choices, 창이 본 merge)`: 1부터 다시 맞추고 5에서 창이 본 양쪽 계획과 최신 내용을 비교한다. 겹침 id뿐 아니라 값·목록·배치에 딸린 Day·Stop 내용도 같을 때만 선택을 적용한다. 내용이 바뀌었으면 선택을 모두 비우고 창을 다시 그리며 `그사이 공동 여행이 또 바뀌었어요. 다시 골라 주세요`를 보인다. 창의 폴링 갱신과 선택 직후 받기 중 경합에 같은 규칙을 적용한다.

### 당일 화면

- `useToday`에 공동 진행을 넘긴다: `visited[i]`는 공동 진행의 다녀옴(기간 안 날짜), `TodayStop`에 `visitedBy: string | null`(다른 기기 이름, 내 것이면 null). 다음 장소는 정해 둔 다음 장소가 오늘 Day의 아직 안 다녀온 Stop이면 그것, 아니면 지금 규칙.
- 체크는 `useVisitToggle`로 내 `visitedOn`을 쓰고(지금 그대로), 바뀐 뒤 엔진 `queueProgress`. 되돌리기도 같은 방식으로 반대 체크를 보낸다.
- 공동 진행을 아직 받지 못했으면(처음, 오프라인) 기준 저장소의 마지막 진행을 쓴다. 그것도 없으면 내 `visitedOn`으로 그린다(지금 동작).

## 오류·장애

| 상황 | 소유자·편집 기기 |
|---|---|
| 오프라인 | 고치기·체크는 된다. 띠 `오프라인이에요…`. 초대 만들기 `인터넷 연결을 확인해 주세요` |
| `503 off`(`TRIP_COLLAB`·`TRIP_SHARE_LIVE`) | 띠 `지금은 함께 편집이 잠시 멈췄어요…`. 초대 만들기 `지금은 편집 초대를 만들 수 없어요`. 수락 문구는 §받은 사람 5. 읽기는 되므로 다른 기기 변경은 계속 받는다 |
| `429` | 띠 `오늘은 더 맞출 수 없어요…`, 초대 `오늘은 더 만들 수 없어요` |
| D1 무료 한도 초과·`5xx` | 오프라인과 같다. 이 기기 여행은 그대로 쓸 수 있다 |
| 기준 저장 실패 | 메모리로 계속. 다음 실행에 기준이 없으면 다른 곳을 모두 비교로 묻는다(유실 없음) |
| 공동본 검사 실패(`parseLiveDoc` null) | `failed`. 올리지 않는다 |
| 반영 연산 실패(여행 규칙 위반) | 올리지 않고 `failed`, 앱 오류 보고자로 보고 |

## 남용 방지·보안·개인정보

- 토큰은 32바이트 무작위(43자 base64url). **편집 토큰·초대 토큰은 SHA-256 해시만 저장**한다(2A 소유자 토큰과 같음). 초대 토큰은 해시(`#i=`)로만 전달하고 읽은 뒤 `history.replaceState`로 지운다.
- 초대는 **한 번만**(수락 배치 안에서 지움), **기한**(7일·공유 기한), 공유당 10개. 소유자가 취소할 수 있다.
- 거두기는 즉시다: 기기 행을 지우면 그 토큰의 다음 요청은 `401`(캐시 없음). 그 기기가 보낸 마지막 공동본은 남는다(변경 이력 없음).
- 편집 기기는 보기 토큰·소유자 토큰·다른 기기 목록을 받지 못한다(`state`의 `members`는 수만).
- IP 해시별 하루 한도(`rate_counters`, 2A와 같은 방식): `collabInvite` 60, `collabAccept` 30, `collabUpdate` 1,200, `collabProgress` 2,000, `collabManage` 300, `collabRead` 5,000(없는·끝난 공유, 틀린 초대 읽기만 센다).
- Turnstile은 2B에 쓰지 않는다. 새 서버 자원을 만드는 요청은 소유자 토큰(초대) 또는 초대 토큰(수락)이 있어야 하고 일 한도가 있다(결정 표 12).
- 요청 크기는 2A `readLimitedJson(…, LIVE_REQUEST_MAX_BYTES)`, 문서 검사·크기는 2A `parseLiveDoc`·`LIVE_DOC_MAX_BYTES`. 진행 요청은 16,384바이트.
- 서버 저장은 일반 저장이다. 2B가 더 남기는 것: 편집 기기 이름·마지막 접속 시각, Stop별 다녀옴·날짜·누른 기기 이름·시각, 정해 둔 다음 장소, 기다리는 초대의 `누구에게`. 공유가 끝나면 함께 지운다. 수락 화면과 `함께 편집` 창에서 미리 알린다.
- 요청 수 예산(제안서 §3.1, 랜드마크 몫 하루 50,000건): 계획·당일 화면 하나가 1시간 보이면 최대 360건(손대지 않으면 60건). 다섯 기기가 하루 2시간씩 열어도 3,600건 안쪽이다. `304`는 D1 한 행 조인 읽기다.
- CPU: 서버는 병합하지 않는다. `PUT doc`는 2A `PUT`과 같은 검사(`parseLiveDoc`)이고 `state`는 문서를 파싱하지 않는다. 2A와 같이 미리보기 배포에서 큰 문서 `PUT`의 CPU 시간을 잰다.
- 시크릿·키는 없다. `wrangler.toml`을 두지 않는다.

## 첫 로딩·코드 위치

| 위치 | 내용 | 번들 |
|---|---|---|
| `src/domain/trip-live/live-doc.ts`(2A, 고침) | `v: 1 \| 2`, v2 장소 id 검사 | 서버·보기 화면·앱 |
| `src/domain/trip-collab/constants.ts` | 한도·패턴·`collabInviteLink`·`readInviteHash` | 서버·앱(Effect 없음) |
| `src/domain/trip-collab/plan.ts` | `CollabPlan`·`planFromDoc`·`projectLocalTrip`·`planKey` | 앱 |
| `src/domain/trip-collab/merge.ts` | `mergeCollabPlan`·`resolveCollabMerge`·`CollabConflict` | 앱 |
| `src/domain/trip-collab/places.ts` | `mapServerPlaces`·`assignServerPlaceIds`·`renameStopIds` | 앱 |
| `src/domain/trip-collab/apply.ts` | `applyCollabPlan`·`importCollabTrip` | 앱 |
| `src/domain/trip-collab/build-doc.ts` | `buildCollabDoc` | 앱 |
| `src/domain/trip-collab/progress.ts` | `SharedProgress`·`ProgressOp`·`sharedVisited`·`sharedNextStop`·`queueOp` | 앱 |
| `src/server/trip-collab/handlers.ts`, `functions/api/trip-collab/[id]/**` | 서버 처리·진입점 | 함수 |
| `src/services/trip-collab/{store,client}.ts` | 연결 기록·기준 저장·API | 앱(지연 청크) |
| `src/sections/trips/collab/*` | 엔진·띠·`함께 편집` 창·비교 창·수락 화면·문구 | 앱(지연 청크) |
| `src/sections/settings/CollabTripsSection.tsx` | 설정 › 함께 편집 목록 | `SettingsPage` 청크 |

- 새 지연 청크 `TripCollabDialog`·`CollabConflictDialog`·`TripCollabJoinPage`를 `build:ci`의 `--require-lazy`에 더한다. 엔진과 띠는 이미 지연인 계획 화면·당일 화면 청크에 들어가고, 연결 기록이 없으면 아무 요청도 하지 않는다. 첫 로딩 예산(`perf-budget.json`)을 넘지 않아야 한다.
- 라우터에 `/trips/join/:id`(`TripCollabJoinPage`)를 더한다. `ROUTE_CHUNKS`에는 넣지 않는다.
- 링크는 지금 출처(`window.location.origin`)로 만든다(2A와 같은 이유).

## 호환·롤백

- 보관함·백업·공유 문서 형식이 그대로다. 새 기기 키 두 개는 옛 버전이 읽지도 지우지도 않는다.
- **서버 쪽만 멈추려면** Pages 환경 변수 `TRIP_COLLAB=off`를 넣고 다시 배포한다. 초대 만들기·수락·공동본 올리기·진행 올리기만 `503`이 되고, 모든 기기는 마지막 공동본을 받아 보고 이 기기에서 고친 것은 기기에 남는다(다시 켜지면 병합). 2A 보기 링크·관리, 기기 거두기·초대 취소·그만두기는 계속 된다. 2A `TRIP_SHARE_LIVE=off`도 공동본 올리기·초대·수락을 막는다.
- **2A만 있는 버전으로 되돌리면**
  1. 먼저 사용자가 v2 문서를 2A가 읽는 v1로 돌린다(모양이 같아 `v`를 바꾸고, 캐시가 다시 받도록 `rev`도 올린다):
     `npx wrangler d1 execute landmark --remote --command "UPDATE trip_shares SET doc = json_set(doc, '$.v', 1), rev = rev + 1 WHERE json_extract(doc, '$.v') = 2"`
     이것을 하지 않으면 2A 보기 화면이 v2 문서를 읽지 못해 `일정을 불러오지 못했어요`를 보인다(소유자가 다시 올릴 때까지).
  2. 편집 기기의 연결된 여행은 보관함에 보통 여행으로 남는다(옛 앱은 `tripmap:trip-collab:v1`을 모른다). 초대 링크 `/trips/join/<id>`는 `페이지를 찾을 수 없어요`.
  3. 소유자 기기의 2A 반영 훅은 기록 `rev`가 낡아 `409`를 받고 2A 알림(`이 기기 일정으로 바꾸기`·`반영 멈추기`)을 띄운다. 소유자 기기 여행에는 마지막으로 맞춘 공동 편집 내용이 들어 있다.
  4. 2B 표는 남는다. `schema_meta`는 4이고 2A 코드의 `ensureSchema`(3 기준)는 아무것도 하지 않는다. 2A 코드의 공유 지우기·만료 정리는 2B 표를 모르므로 오래 되돌려 둘 때는 정리한다(사용자가 실행):
     `npx wrangler d1 execute landmark --remote --command "DELETE FROM trip_collab_devices; DELETE FROM trip_collab_meta; DELETE FROM trip_progress; DELETE FROM trip_share_tokens WHERE kind = 'invite'"`
  5. 다시 2B로 올리면: 남은 연결 기록의 기기는 다음 맞추기에서 v1 문서를 받는다. 장소 id가 소유자 기기 id로 바뀌었을 수 있어 대응표에 없는 장소는 출처로 다시 찾는다(못 찾은 핀 장소는 새로 담길 수 있다). 기준 계획과 다른 곳은 평소 규칙대로 병합한다. 4를 했으면 편집 기기는 `401`로 끝나고 다시 초대해야 한다.
- 롤백 표(`docs/rollback.md`)의 버전 행은 병합 뒤 별도 docs PR에서 쓴다. 기능 PR 본문에 위 내용을 롤백·데이터 영향 메모로 적는다(브리프 규칙).
- 코드 되돌리기 순서: 2B를 먼저 되돌린 뒤에야 2A를 되돌릴 수 있다.

## 사용자가 할 일

새 외부 계정·키는 없다. D1(`DB`)·`IP_HASH_SALT`는 약속 온라인 집계 때 만든 것을 그대로 쓴다.

1. (선택) 비상 스위치가 필요할 때만 Cloudflare 대시보드 › Workers & Pages › `landmark` › Settings › Variables and Secrets에서 Production·Preview에 `TRIP_COLLAB`=`off`를 넣고 다시 배포한다. 평소에는 넣지 않는다.
2. 표 만들기는 첫 요청 때 서버 코드가 스스로 한다(`SCHEMA_VERSION` 4). 배포 뒤 확인만 한다:
   `npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta; SELECT name FROM sqlite_master WHERE name LIKE 'trip_collab%' OR name = 'trip_progress'"` → `4`, `trip_collab_devices`, `trip_collab_devices_token`, `trip_collab_meta`, `trip_progress`.
3. 미리보기 배포에서 큰 일정(30일, 경로선 많음)의 공동본 올리기 CPU 시간이 10ms 안인지 Workers 지표로 본다(2A와 같은 확인).
4. 휴대폰 두 대(또는 PC와 휴대폰)로 편집 초대 → 수락 → 양쪽에서 다른 곳 고치기 → 같은 Day 순서를 동시에 바꿔 비교 화면 → 기기 거두기, 당일 화면에서 체크가 10초 안팎에 다른 기기에 보이는지 확인한다.

## 로컬에서 실제 키 없이 해 보기(두 기기)

- `yarn dev:full`(로컬 D1, `http://localhost:8788`)을 띄운다. 2B는 Turnstile을 쓰지 않는다. 갱신 링크 만들기의 Turnstile은 2A대로 키가 없으면 건너뛴다.
- 기기 저장소가 달라야 두 기기다. 같은 브라우저의 탭 두 개는 한 기기다.
  - 기기 A(소유자): 평소 Chrome 프로필.
  - 기기 B(편집): Chrome의 다른 프로필(오른쪽 위 프로필 › `추가`) 또는 다른 브라우저(Safari·Firefox). 시크릿 창도 되지만 닫으면 기록이 사라진다.
  - 보기 링크 확인은 또 다른 시크릿 창.
- 순서: A에서 여행을 만들고(당일 진행을 보려면 오늘이 들어간 기간) Day 1에 장소 셋 → `일정 공유` › `갱신 링크…` › `갱신 링크 만들기` → 같은 창의 `함께 편집…` › `편집 초대 링크 만들기` › `링크 복사` → B 주소창에 붙여 열기 → `수락하고 함께 편집하기`.
  - 다른 곳 고치기: A는 Day 1 출발 시각, B는 Stop 메모 → 10초 안팎에 서로 보인다.
  - 겹침: B의 개발자 도구 › Network › `Offline`으로 끊고 Day 1 순서를 바꾼다. A에서도 Day 1 순서를 다르게 바꾼다. B를 다시 `No throttling`으로 → B 띠 `다른 기기와 같은 곳을 고쳤어요` → `비교하기`.
  - 거두기: A `함께 편집` 창 › B 기기 `편집 권한 거두기` → B 띠에 거둬졌다는 문구.
  - 당일 진행: A·B 모두 `오늘 일정` → A에서 첫 장소 체크 → B에 `다녀옴 · 만든 사람`, 다음 장소가 둘째로.
- 로컬 D1 확인: `sqlite3 "$(find .wrangler/state -name '*.sqlite' | head -1)" "SELECT share_id, device_id, label, seen_at FROM trip_collab_devices; SELECT stop_id, visited, by_label FROM trip_progress"`.
- 기능 스위치는 `.dev.vars`에 `TRIP_COLLAB=off`를 넣고 `yarn dev:full`을 다시 띄워 본다.
- 한계: 허용 출처가 `localhost:5173`·`localhost:8788`뿐이라 같은 망의 휴대폰에서는 `/api/trip-collab`이 `403`이다(2A와 같음). 휴대폰은 미리보기 배포로 확인한다.
- 포트 5173·5174를 쓸 수 없는 개발 에이전트는 화면 대신 E2E(두 브라우저 문맥, 가짜 D1)와 `wrangler pages dev --port 8790`에 `curl`(헤더 `Origin: http://localhost:8788`)로 확인한다(구현 계획서 Task 16·17).

## 시험

- 단위(vitest)
  - `live-doc`(2A 고침): v2 통과, v2 장소 id 패턴, `v: 3` 거절, v1 그대로.
  - `plan`: `planFromDoc` 왕복, `projectLocalTrip`이 지운 장소의 Stop을 담고 장소·legModes 키를 서버 id로 옮김, `planKey`가 키 순서와 무관.
  - `merge`(가장 많이): 한쪽만 바꾼 값·목록, 같은 값, 값 겹침, legModes 키별, 같은 Day 순서 겹침, 장소를 서로 다른 Day로 옮김(묶음), 한쪽은 옮기고 한쪽은 지움, 삭제 대 수정, 기간 줄임 대 잘린 Day 수정, 기간 겹침, 양쪽이 같은 새 장소를 다른 Day에 넣음, 기준 없음, `resolveCollabMerge`가 고른 대로 쓰고 결과가 여행 규칙을 지킴, 겹침 id 안정, 안전망.
  - `places`: 같은 id·같은 출처면 그대로 잇기, 출처로 찾기·새로 담기, 지운 장소 되살림, 새 장소 서버 id(로컬 id, 겹치면 새 id), Stop id 겹침 바꾸기.
  - `apply`: 결과 계획이 보관함 여행이 되고 `LibrarySchema`를 통과, 바뀐 필드만 `updatedAt`이 바뀜, `importCollabTrip`의 Stop·Day id 보존과 대응표.
  - `build-doc`: 공동본 장소 정보 유지, 새 장소의 메모 제외(편집 기기), 구간이 `dayPoints`와 맞음, `parseLiveDoc` 통과, `v: 2`.
  - `progress`: 공동 다녀옴, 기간 밖 날짜 무시, 정한 다음 장소의 우선·해제, 대기열 합치기(같은 Stop은 마지막만, 200개 상한).
  - 서버(`node:sqlite` 가짜 D1): 초대 만들기(201·재시도 200·v1 문서 409 upgrade·10개 409 full·편집 기기 토큰 401·스위치 503), 미리보기(200, 쓴 초대 401·그때만 셈), 수락(201·같은 초대 두 번째 기기 401·응답 유실 재시도 200·20대 409 full·지난 초대 401·스위치 503·초대 행이 지워짐), state(편집 기기·소유자 200, 보기 토큰 401, `rev`·`prev` 같으면 304·한쪽만 다르면 그 부분만, `members`·`editedBy`, `seen_at` 1시간 규칙, 거둔 기기 401), PUT doc(v2만, `409 rev`, 저장 v보다 낮으면 409 version, 성공 시 `edited_label`·`expires_at`), 2A `PUT`의 version 409, progress(LWW·서버 시각 자르기·`prev` 증가·50개 초과 400·2,000행 409·next), members·거두기·그만두기·초대 취소, 2A 지우기·만료 정리가 2B 행도 지움, `SCHEMA_VERSION` 4와 표 생성.
  - 클라이언트·저장: 기록 왕복·깨진 값·100개·기준 키 지움·막힌 저장소, API 경로·헤더·상태 해석.
  - 엔진(가짜 타이머·가짜 API·실제 보관함 연산): 받기만, 고친 뒤 3초에 올림, 다른 곳 동시 수정 병합, 겹침이면 올리지 않음, `resolve` 뒤 올림, 반영 도중 사람이 고치면 다시 함, `409 rev` 재시도, 401·410·503·429 상태, 진행 대기열 보내기, 숨기면 멈춤.
  - 화면: `함께 편집` 창(소유자·참여자, 만들기·복사·거두기 확인·초대 취소·그만두기·따로 저장), 비교 창(값·배치 줄, 모두 고르기, 고른 대로 맞추기), 수락 화면(해시 지움·미리보기·수락 후 이동·각 오류 문구·이미 참여), 띠 문구, 당일 화면(다른 기기 체크 표시·다음 장소로 정하기·체크가 진행과 `visitedOn` 둘 다), 여행 목록 표시·지우기 문구, 설정 목록.
- E2E(Playwright, desktop): 2A `tests/e2e/trip-live-server.ts`가 `/api/trip-collab*`도 진짜 처리 코드와 가짜 D1로 넘긴다. 두 문맥(소유자·편집)으로 초대 → 수락 → 서로 다른 곳 고치기가 10초 뒤 보임 → 같은 Day 순서 겹침(한 문맥 `setOffline`) → 비교 창에서 `공동 여행` 고름 → 두 문맥 순서 같음 → 거두기 → 철회 문구. 당일 화면 공동 체크 하나.

## 완료 조건

- 위 시험 통과, `yarn typecheck`·`yarn lint`·`yarn test`·`yarn build:ci`(크기·`--require-lazy` 포함)·`yarn test:e2e:ci` 통과.
- `yarn dev:full`과 두 브라우저 프로필로 키 없이 초대·수락·함께 고치기·비교·거두기·공동 체크를 화면으로 끝까지 눌러 볼 수 있다(`docs/development.md`의 새 절대로).
- `docs/development.md` 새 절·환경 변수 행·화면 경로 행, README 개인정보 줄, 도움말(`trips`·`share` 팁)을 고친다. `docs/rollback.md`는 병합 뒤 별도 PR.

## 2A에 기대는 것

2A 계획서의 이름이다. 구현이 다르면 코드를 따르고 이 표만 바꿔 읽는다.

| 2A가 만드는 것 | 2B에서 |
|---|---|
| `trip_shares`(`rev`·`doc`·`expires_at`), `trip_share_tokens`(`owner`, 빈 `label`·`expires_at`) | 공동 여행·초대(`invite`) |
| `LiveTripDoc`·`parseLiveDoc`·`liveDocBytes`·`liveExpiresAt`·`alignDayIds`·`LIVE_*` 상수(`src/domain/trip-live/live-doc.ts`) | `v: 2`로 넓히고 그대로 쓴다 |
| `fitLiveDoc`·`liveEditKey`·`livePlanKey`·`buildLiveTripDoc`·`ESTIMATE_ONLY`(`build-live-doc.ts`), `importLiveTrip`(`import-live.ts`) | 크기 맞추기·소유자 합류 판단·사본 저장 |
| `handleLiveUpdate`·`handleLiveDelete`·`pruneExpiredLive`(`src/server/trip-live/handlers.ts`), `readLimitedJson`(`src/server/share/handlers.ts`) | 버전 거절·2B 표 지우기를 더한다, 요청 크기 |
| `tripLiveStore`·`TripLiveRecord`(`src/services/trip-live/store.ts`), `tripLiveApi`·`TripLiveError`·`LiveResult`(`client.ts`), `newLiveToken`·`newLiveId`·`newDayId`(`tokens.ts`) | 소유자 토큰 읽기, `version` 오류 더하기, 토큰·id 만들기 |
| `createLivePoll`(`src/share-viewer/live.ts`) | 엔진 폴링 |
| `useTripLivePublish`·`LivePublishState`·`LIVE_DEBOUNCE_MS`·`LIVE_MIN_GAP_MS`·`LIVE_OFF_RETRY_MS`·`LIVE_LIMIT_RETRY_MS`(`use-trip-live-publish.ts`), `texts.ts` | 공동 편집 중이면 멈춤(`collab`), 시간 상수 |
| `TripLiveShareDialog`·`LiveShareEntry`·`TripLiveLinkPage`·`LiveTripsSection` | `함께 편집…` 줄, v2 제목 안내, v2 소유자 합류 |
| `tests/e2e/trip-live-server.ts`(`createTripLiveServer`) | `/api/trip-collab*` 경로 더하기 |

## 결정과 근거

사용자에게 물을 수 없어 이 문서에서 정한 것이다. 룰링(브리프)과 다르게 정한 것은 없다.

| # | 항목 | 고른 안(다른 선택지) | 근거 |
|---|---|---|---|
| 1 | 편집 자리 | 각 기기 보관함에 연결된 여행 + 서버 공동본(서버 전용 편집 화면) | 지금 계획 화면·당일 화면·경로 조회·되돌리기를 그대로 쓰고 오프라인에서도 고친다. 룰링의 "자기 보관함 사본"과도 자연히 이어진다 |
| 2 | 변경 단위 | 기기에서 3방향 병합 후 전체 문서 + `baseRev`(필드 연산을 서버가 적용) | 서버는 병합·경로 계산 없이 검사·비교만 해 무료 CPU 10ms 안에 든다. 2A `PUT`과 같은 낙관적 잠금이라 서버 코드가 작다. 구간 시간은 어차피 브라우저만 안다 |
| 3 | 병합 기준 | 기기에 마지막으로 맞춘 공동 계획 저장(문서에 필드별 rev 도장) | 문서 모양이 v1과 같아 롤백이 `json_set` 한 줄이다. 기준을 잃어도 "다른 곳은 모두 비교"로 유실 없이 물러난다 |
| 4 | 같은 값 필드 겹침 | 비교 화면에 함께(늦게 맞춘 쪽 이김) | 룰링의 "조용한 유실 금지". 값 겹침은 드물고 한 줄로 고를 수 있다 |
| 5 | 배치 겹침 단위 | 장소 이동으로 이어진 목록 묶음(+기간)을 한쪽으로(장소 하나씩 / 여행 전체) | 장소 하나씩 고르면 "한 번만" 규칙이 깨지기 쉽고, 여행 전체는 다른 Day를 고친 사람까지 묻는다. 묶음은 결과가 늘 여행 규칙을 지키는 가장 작은 단위다 |
| 6 | 장소 id | 처음 올린 기기의 로컬 id를 서버 id로(겹치면 새로), 기기별 대응표(서버가 발급) | 서버 왕복 없이 오프라인에서 장소를 더할 수 있고 소유자 기기는 대응표가 항등이다. 다른 기기는 출처로 같은 장소를 찾는다 |
| 7 | 장소 정보 | 공동 여행에 들어올 때 고정, 편집 기기 장소에는 메모·한 줄 평을 싣지 않음(마지막 기기 값) | 장소 이름·라벨·메모는 개인 보관함 자료다. 기기마다 다른 값이 번갈아 덮이는 것을 막고, 소유자가 고르지 않은 메모가 보기 링크로 새지 않게 한다 |
| 8 | 보관함에서 지운 장소 | 공동 일정에서 빼지 않음(지우면 빠짐) | 내 보관함 정리가 함께 가는 사람의 일정을 바꾸면 안 된다. 이 기기 화면은 지금처럼 숨긴다 |
| 9 | Day 정체성 | 위치(2A와 같음) | 로컬 `setTripDates` 규칙이 위치 기준이고 2A `alignDayIds`와 맞는다 |
| 10 | 문서 버전 | `v: 2`, 모양은 v1과 같음(새 필드 더하기) | 2A가 예고한 대로 낮은 버전 쓰기를 거절해 옛 탭이 서버 id를 로컬 id로 덮지 못하게 한다. 새 필드가 없으니 롤백 때 2A가 다시 읽게 하기 쉽다 |
| 11 | 편집 기기 저장 | 새 표 `trip_collab_devices`(2A 예고의 `trip_share_tokens` `kind='editor'`) | 기기 id·마지막 접속 열이 필요하고 `ALTER`는 멱등이 아니다. 초대는 2A 예고대로 `kind='invite'`·`expires_at`을 쓴다 |
| 12 | Turnstile | 2B에는 없음(수락에 Turnstile) | 수락은 43자 1회 초대 토큰이, 초대 만들기는 소유자 토큰이 문이다. IP 일 한도·기기 20대·초대 10개가 남용을 막는다. 공유 만들기는 2A Turnstile을 이미 거친다 |
| 13 | 진행 충돌 | Stop마다 늦게 누른 쪽, 누가·언제를 보임(비교 화면) | 진행은 계획이 아니라 지금 상태다. 같은 Stop을 동시에 반대로 누르는 일은 드물고 `다녀옴 · 기기 이름`으로 바로 드러난다 |
| 14 | 개인 기록과의 관계 | 내 체크 = 공동 진행 + 내 `visitedOn`, 남의 체크는 내 `visitedOn`을 바꾸지 않음(공동만) | 룰링의 "개인 `visitedOn`과 분리"를 지키면서 지금 당일 화면의 다녀옴 기록 동작을 잃지 않는다 |
| 15 | 폴링 | 문서·진행 한 요청, `304`, 보일 때 10초·5분 손대지 않으면 60초 | 룰링 1의 10초를 지키고 요청 수를 반으로 줄인다. 2A `createLivePoll`을 같이 써 동작이 같다 |
| 16 | 기능 스위치 범위 | 쓰기만 끔(전부) | 제안서 §9 「공유 편집을 끄고 읽기 화면 유지」. 끈 동안에도 기기 거두기·그만두기 같은 정리는 되어야 한다 |
| 17 | 소유자 다른 기기 | 공동 편집 문서를 만나면 소유자로 합류. 경로 조회 상태를 뺀 계획 지문으로 미공개 수정이 없음을 확인하면 다시 만든 2A 공개 문서를 서버 id로 바꾸어 기준으로 쓰고, 미공개 수정이 없음을 확인하지 못하고 공개 기준도 확인되지 않으면 모든 차이를 비교 | 2A revision 조건으로 마지막 공개본은 공통 조상이다. 계획 지문은 공개 계획 값을 모두 담고 경로 응답 도착 여부에는 흔들리지 않는다. 2A 재공개용 `publishedKey`는 그대로 유지한다. 손대지 않은 기기는 공동 변경을 자동으로 받고, 확인할 수 없는 미공개 수정은 비교로 보존한다 |
| 18 | 참여 한도 | 기기 20대, 기다리는 초대 10개, 초대 7일 | 여행 동행 규모에 넉넉하고 요청 예산(§남용 방지) 안에 든다. 7일은 메신저로 받고 여는 데 충분하다 |
| 19 | 편집 참여자 권한 | 계획 전체 편집, 보기 링크·초대·옵션은 소유자만 | 편집 초대는 "함께 고칠 사람"이고, 공개 범위는 소유자가 정한다(2A 보기 링크 철회 권한과 맞춤) |
| 20 | 변경 이력 | 두지 않음(공동본 직전 판 1개 보관) | D1 쓰기·저장을 두 배로 늘린다. 각 기기 보관함의 연결된 여행과 `내 여행으로 따로 저장`이 사본 역할을 한다 |
