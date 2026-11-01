# AI 에이전트 일정 보내기(`yarn trip`) 설계

AI 에이전트(Claude Code 등)가 사람 손 없이 여행 일정을 만들어 ① 내 보관함으로 보내거나(받은함 경유) ② 남에게 보낼 공유 링크(데이터 링크 `/view#d=`, 짧은 링크 `/s/<id>`)를 만든다.
에이전트는 이 저장소의 TS CLI `yarn trip`에 계획 파일(`plan.json`)을 넘기고, CLI는 앱 코드를 그대로 가져다 앱과 같은 공유 문서(`ShareDocV2`)를 만들고 같은 검사를 통과시킨다.
서버는 3단계 [보관함 동기화](2026-10-29-library-sync-design.md)의 로그인 사용자 위에 **AI 연결 토큰**과 **받은함**을 더하고, 짧은 링크는 [공유 짧은 링크](2026-10-28-share-short-link-design.md)의 저장소를 그대로 쓴다.

- 작성일: 2026-11-01
- 상태: 설계(사용자 확정 결정 반영, 구현 전). 계획서는 `docs/superpowers/plans/2026-11-01-agent-trip.md`(새 파일)로 쓴다.
- 기준: `main` `bc055d6`(`v0.24.2`). D1 `SCHEMA_VERSION` 6 → **7**.

## 결정 요약(사용자 확정)

| 항목 | 결정 |
|---|---|
| CLI | 이 저장소의 `yarn trip …`(`tsx`, `src/*` 별칭으로 앱 코드 재사용). 명령은 `build`·`send`·`share`·`whoami`, 모두 `--json` 출력. 짧은 링크 철회용 `unshare`(2026-11-01 사용자 결정, 아래 B안) |
| 입력 | AI가 쓰기 쉬운 `plan.json`(제목·기간, 장소 목록, Day별 방문 순서·시각·머무는 시간·메모). Effect Schema로 정의하고, 오류는 경로와 이유를 구체적으로 낸다 |
| 장소 | 네이버 저장 sid 또는 네이버 장소 ID가 기본. 신규 제안 장소는 네이버 검색으로 장소 ID를 찾고, 못 찾으면 이름 + 좌표 핀 |
| 경로 | CLI가 구간마다 네이버 길찾기를 묻고, 실패한 구간은 `estimated`(앱과 같은 직선 추정) |
| 문서·검사 | 앱과 같은 `buildTripShareDoc` → `ShareDocV2Schema` + `checkShareTrip`. 서버도 받은함 문서를 같은 함수로 다시 검사한다 |
| 보내는 곳 | ① `send`: 내 받은함(앱에서 미리보기 뒤 `가져오기`) ② `share`: 짧은 링크 `/s/<id>#k=` ③ `build`: 서버·토큰 없이 `/view#d=`·`/import#d=` 링크 |
| AI 연결 토큰 | 동기화에 로그인한 허용 계정이 설정 › 동기화 › `AI 연결`에서 발급. 범위는 `inbox:write`·`share:create`뿐(보관함 읽기·쓰기 없음). 원문은 한 번만 보이고 서버는 해시만 둔다. 90일 만료, 목록·철회 |
| 토큰 검사 | 요청마다 허용 계정 재확인, 사용자별 하루 한도(`rate_counters`). Turnstile·출처 검사 대신 토큰. CORS는 열지 않는다 |
| 서버 | D1 스키마 7(`agent_tokens`·`agent_inbox`, 받은함 30일 보관). API `/api/agent/v1/inbox`·`/share`·`/whoami`. 발급·목록·철회와 앱의 받은함 읽기는 동기화 세션 경로(`/api/sync/v1/agent/…`) |
| 짧은 링크 | CLI가 브라우저와 같은 방식(AES-GCM, 키는 `#k=`)으로 암호화해 올린다. 서버는 내용을 못 본다. 기존 `share_links` 표·보관 기간 재사용 |
| 앱 받은함 | 로그인한 기기가 앱을 열 때·동기화할 때 확인 → 알림 「AI가 보낸 일정 N개」 → 미리보기(기존 공유 가져오기 화면) → `가져오기`/`버리기`. 가져온 여행은 동기화로 다른 기기에 퍼진다 |
| 비상 스위치 | `AGENT_API=off`. 로그에 문서·토큰을 남기지 않는다 |
| 워크스페이스 스킬 | `korea-trip-planner`가 사용자가 "랜드마크로 보내줘"라고 할 때만 `plan.json`을 만들고 `yarn trip`을 부른다. 이 문서에는 연결 규약만 적고 스킬 수정은 마지막 단계 |
| 단계 | PR 4개: ① CLI + 데이터 링크(서버 동작 변경 없음) ② 서버 토큰·받은함·짧은 링크 API(스키마 7) + CLI `send`·`share`·`whoami` ③ 앱 AI 연결 설정·받은함 화면 ④ 문서·스킬 연결. 각 PR 뒤 릴리스와 `docs/rollback.md` 갱신 |

### 세부 결정과 근거(설계자가 정함, 사용자 검토용)

바꾸려면 이 표와 계획서를 함께 고친다.

| 열린 결정 | 정한 것 | 근거 |
|---|---|---|
| CLI 코드 위치 | 진입점 `pipeline/cli/trip.ts`(새 파일), 모듈은 `pipeline/agent-trip/`(새 폴더). `package.json`에 `"trip": "tsx pipeline/cli/trip.ts"` | `pipeline/`은 이미 `tsx`·`src/*` 별칭으로 돌고(`yarn collect`), `tsconfig.app.json`의 `include`·`eslint`·`vitest`가 덮는다. 새 최상위 폴더는 설정 세 곳을 더 고쳐야 한다 |
| 문서를 만드는 길 | `plan.json` → 메모리 보관함(`emptyLibrary` + 앱 연산) → `buildTripShareDoc` | 공유 문서의 장소 순서·숙소·후보·`legModes` 규칙을 다시 만들지 않는다. 앱 연산(`createTrip`·`insertStop` 등)이 제목·날짜·Stop 한도를 이미 검사한다 |
| 경로 조회 | 서버 코드 `resolveRoute`(`src/server/route.ts`)를 Node에서 직접 부른다. 구간 수단은 앱 규칙(`legBetween`: 직선 800m 이하 도보, 사람이 고른 `legModes` 우선) | 앱과 같은 시간·거리·경로선(200점)·`queriedAt`이 나온다. 옛 `pipeline/naver-client.ts`의 `fetchCarRoute`·`pipeline/legs.ts`·`pipeline/route-cache.ts`는 옛 `trip-data` 모양(`durationMs`, `failed`)이라 쓰지 않는다. 디스크 캐시는 두지 않는다(결과는 조회 시각 교통 기준이고 `queriedAt`에 남는다) |
| 장소 조회 | `naverSid` → `fetchPlaceSummary`(`pipeline/naver-client.ts`), `link` → `resolveLink`(`src/server/resolve.ts`, 네이버·카카오·구글 링크), `search` → 새 `searchNaverPlaces`(`src/server/search.ts`) | 앱 `/api/place`·`/api/search`가 쓰는 같은 함수다. 배포된 API는 출처 검사가 있어 CLI가 부를 수 없으므로 코드를 직접 쓴다 |
| 검색으로 장소 ID 찾기 | 새 명령을 두지 않고 `plan.json` 장소의 `search: { q, near? }`로 받는다. 결과 중 이름이 정확히 같은 곳이 하나뿐이거나 결과가 하나뿐이면 그 sid를 쓰고, 여럿이면 후보(최대 5곳: sid·이름·주소·분류)를 오류로 돌려준다. 결과가 없고 `lng`·`lat`이 있으면 핀 | 명령은 사용자가 정한 넷으로 둔다. AI는 후보 오류를 보고 `naverSid`로 고쳐 다시 부른다. 네이버 자동완성 응답의 `id`가 장소 sid다(2026-11-01 확인: `초당순두부마을` → `id`·`sid` `31506191`) |
| 메모 포함 기본값 | `send`는 장소 메모를 넣는다(`--no-memo`로 뺌). `build`·`share`는 빼고 `--memo`일 때만 넣는다 | 받은함은 본인 보관함이다. 짧은 링크·데이터 링크는 남에게 간다. 앱 공유와 같이 이 옵션은 장소 `memo`만 좌우하고, Day 메모(Stop `note`)는 늘 들어간다(`buildTripShareDoc` 규칙) |
| 받은함 저장 값 | `/import#d=`의 값 그대로(경로선 뺀 `hashDoc` 사본을 압축한 base64url, 32,000자 이하). 서버는 `readShareHash`로 풀어 v2만 받는다 | 앱은 이 값을 기존 `/import#d=` 진입과 같은 함수로 읽어 미리보기를 연다. 값 길이(`MAX_HASH_CHARS` 32,000자)와 요청 크기(`SHARE_REQUEST_MAX_BYTES`)는 그대로 쓰고, 서버 CPU 때문에 풀린 크기·장소 수만 `AGENT_INBOX_LIMITS`로 줄인다(아래 보안). 받은함은 동기화와 같은 일반 저장이다(서버 운영자가 읽을 수 있다) |
| 같은 일정 두 번 | CLI가 요청 키 `key` = SHA-256(키 정렬한 `plan.json` 해석 결과 + 메모 포함 여부)의 base64url(43자)을 함께 보낸다. 서버는 사용자별로 만료되지 않은 같은 `key`가 있으면 그 항목을 `200 created: false`로 돌려준다 | 문서 `d`는 실행마다 바뀐다(`createdAt`, 무작위 장소·Stop id, 경로 `queriedAt`). 그래서 `d`의 해시로는 같은 계획의 재실행을 알 수 없다. 응답을 잃고 다시 부른 AI가 받은함을 채우지 않는다(짧은 링크 `delete_hash` 재시도와 같은 방식). `key`는 권한 근거가 아니라 본인 받은함의 중복 판단에만 쓴다 |
| 받은함 한도 | 사용자당 기다리는 항목 20개, 30일 보관. 넘으면 `409 inbox-full` | 사람이 확인하는 상자라 많을 필요가 없다. 프롬프트 주입으로 AI가 엉뚱한 일정을 보내도 쌓이는 양이 작다 |
| 토큰 모양·저장 | 원문 `lmk_` + 32바이트 base64url(47자). D1에는 `hashToken`(SHA-256 base64url)만. 공개 id 12자로 목록·철회 | 접두가 있어 비밀 검사 도구가 찾는다. 짧은 링크 삭제 토큰과 같은 해시 함수다 |
| 토큰 수·이름 | 사용자당 살아 있는 토큰 10개, 이름 1~40자(기본 `Claude Code`), 범위는 둘 중 하나 이상(기본 둘 다) | 도구·기기별로 나눠 철회할 수 있게 한다 |
| 만료 | 발급 뒤 90일 고정(사용해도 늘지 않음). CLI는 14일 이하로 남으면 경고 | 슬라이딩 만료면 잊힌 토큰이 계속 산다 |
| 마지막 사용 시각 | 1시간에 한 번만 갱신 | D1 쓰기를 줄인다(동기화 `DEVICE_TOUCH_MS`와 같은 간격) |
| 브라우저 요청 | 에이전트 API는 `Origin` 헤더가 있으면 `403 origin` | 브라우저에서 부를 이유가 없다. CORS를 열지 않으므로 다른 사이트는 응답을 읽지 못하고, 이 규칙으로 앱 출처 안의 스크립트도 막는다 |
| CLI가 토큰을 보낼 곳 | `isAllowedOrigin`(운영·Pages·미리보기) 또는 `http://localhost:*`·`http://127.0.0.1:*`만. 그 밖의 `--app`은 거절 | 프롬프트 주입으로 바뀐 주소에 토큰을 보내지 않는다 |
| 짧은 링크 철회(사용자 결정 B안, 2026-11-01) | `share`가 서버 성공 뒤 삭제 토큰을 로컬 파일 `~/.landmark/agent-shares.json`(폴더 `~/.landmark` 권한 700, 파일 600, 임시 파일에 쓰고 `rename`)에 남긴다. 형식 `{ "v": 1, "items": [{ "app": "https://landmark.sch0718.dev", "id": "<16자>", "deleteToken": "<43자>", "title": "…", "createdAt": "<ISO>", "expiresAt": "<ISO>" }] }`, 최대 200개, 읽고 쓸 때 만료된 항목을 뺀다. 만료되지 않은 항목이 200개면 `share`는 서버를 부르기 전에 끝 코드 2 `share-store-full`("`unshare`로 정리해 주세요")로 멈춘다(있던 삭제 토큰을 밀어내지 않는다). 읽기·고치기·바꾸기 전체를 잠금 파일 `~/.landmark/agent-shares.lock`(`open(…, 'wx')`, 50ms 간격으로 5초까지 다시 시도, 30초 넘은 잠금은 버려진 것으로 보고 지움)으로 묶어 `share`·`unshare`가 동시에 돌아도 항목을 잃지 않는다. 시험용으로 폴더를 `LANDMARK_TRIP_HOME`으로 바꿀 수 있다. `yarn trip unshare <id>`가 같은 `app`의 항목을 찾아 `DELETE /api/agent/v1/share/:id`로 지우고, `unshare --list`가 남은 링크(id·제목·기한)를 보인다. **PR ②**에 넣는다 | 삭제 토큰은 만든 쪽만 가진다(브라우저의 `tripmap:share-links:v1`과 같은 모델). 기존 `DELETE /api/share/:id`는 허용 출처 검사(`withRequest`)가 있어 CLI가 부를 수 없으므로 토큰 경로를 둔다. 서버에 소유 기록 표를 더하지 않는다 |
| 토큰 보관(CLI) | 환경변수 `LANDMARK_AGENT_TOKEN`이 먼저, 없으면 macOS 키체인 `security find-generic-password -s landmark-agent-token -a <앱 호스트> -w`(셸 없이 `execFile`) | 키체인 계정을 앱 호스트로 나눠 운영·로컬 토큰이 섞이지 않는다 |
| 받은함 확인 시점 | 동기화가 켜진 기기(`readBootFlag()`)에서 앱을 연 뒤 첫 동기화 실행이 끝날 때, 그 뒤로는 실행이 끝날 때마다 하되 10분에 한 번까지 | 동기화는 저장 2초 뒤에도 돈다. 매번 묻으면 요청이 많다. 자동 백업과 같은 `onRunFinished` 길을 쓴다 |
| 알림 반복 | 기기 키 `tripmap:agent-inbox:v1`에 알린 항목 id를 두고, 새 id가 있을 때만 알림 | 같은 항목으로 열 때마다 알리지 않는다 |
| `버리기` | 확인 대화상자 뒤 서버에서 지운다 | 지운 항목은 되살릴 수 없다 |
| `AGENT_API=off` 범위 | 토큰으로 부르는 에이전트 API(`whoami`·받은함 올리기·짧은 링크 만들기)와 새 토큰 발급이 503 `off`. 예외로 짧은 링크 지우기(`DELETE /api/agent/v1/share/:id`, 경로 속성 `allowWhenOff`)와 토큰 목록·철회, 앱의 받은함 읽기·지우기는 계속 된다 | 다른 스위치와 같이 새 자료만 막고, 이미 받은 일정과 철회는 남긴다 |
| `SHARE_SHORT=off`와의 관계 | 에이전트 `share`도 막는다(503 `off`) | 짧은 링크 저장소의 스위치가 하나로 모인다 |

## 하지 않는 것

- **갱신 링크(`/view#t=`, 2A)와 보관함 직접 쓰기.** 토큰으로는 보관함을 읽지도 고치지도 못한다. 일정은 받은함을 거쳐 사람이 `가져오기`를 눌러야 들어간다.
- 함께 편집(2B) 초대, 약속 만들기, 장소만 담은 v1 공유 문서.
- 앱의 `보낸 짧은 링크` 목록에 에이전트 링크 넣기, 다른 컴퓨터에서 철회하기. 에이전트 링크는 그 링크를 만든 컴퓨터의 `yarn trip unshare`로만 지울 수 있고(삭제 토큰이 그 컴퓨터에만 있다), 그 밖에는 기한(30~180일)이 지나면 지워진다.
- 장소 라벨 지정. 가져올 때 기존 화면의 `제목 라벨`이 붙는다.
- 받은함 알림의 푸시·이메일·셸 머리 아이콘. 동기화가 꺼진 기기의 자동 확인(설정 › AI 연결 줄에서 직접 볼 수는 있다).
- 경로 디스크 캐시, 대중교통 구간, 영업시간 확인.
- 새 외부 계정·키·새 `VITE_` 빌드 변수.

## 사용 흐름

### 처음 연결(사람, 한 번)

1. 설정 › `동기화`에 로그인한 상태에서 같은 절의 `AI 연결` → `새 연결 만들기`.
2. 이름(`Claude Code`)과 권한(`받은함으로 일정 보내기`·`공유 짧은 링크 만들기`, 기본 둘 다)을 고르고 `만들기`.
3. 토큰 원문이 한 번만 보인다: `복사` 단추, 키체인에 넣는 명령 예(`security add-generic-password -U -s landmark-agent-token -a landmark.sch0718.dev -w` — `-U`는 있던 항목을 바꾸고, `-w`를 맨 끝에 두어 값은 입력 프롬프트에 붙여 넣어 셸 기록에 남지 않게), 안내 "이 창을 닫으면 다시 볼 수 없어요. 잃어버리면 철회하고 새로 만드세요".
4. 터미널에서 `yarn trip whoami` → `AI 연결 「Claude Code」 · 받은함·짧은 링크 · 2027년 1월 30일까지`.

### 에이전트가 일정을 보낼 때

1. 에이전트가 `plan.json`을 쓴다(아래 형식).
2. `yarn trip build plan.json --json`으로 검사·요약·데이터 링크를 받는다(서버·토큰 불필요). 오류면 경로와 이유를 보고 고쳐 다시 부른다.
3. 사용자가 원하는 대로:
   - `yarn trip send plan.json --json` → 받은함 항목 id와 만료일.
   - `yarn trip share plan.json --json` → `https://landmark.sch0718.dev/s/<id>#k=<키>`와 기한, 보조로 긴 `/view#d=` 링크.

### 앱에서 받기

1. 동기화가 켜진 기기에서 앱을 열거나 동기화가 끝나면 받은함을 확인한다. 새 항목이 있으면 알림 「AI가 보낸 일정 N개」와 `보기`.
2. `보기` → `AI가 보낸 일정` 창(지연 로딩): 줄마다 제목 · `11월 20일~22일` · `장소 12곳` · 보낸 연결 이름 · 받은 때, 단추 `미리보기`·`버리기`. 설정 › 동기화 › AI 연결의 `받은 일정 N개 · 보기`로도 연다.
3. `미리보기` → 항목 값을 `readShareHash`로 읽어 기존 공유 가져오기 화면(`SharePreview`)을 연다. 머리에 `AI 연결 「Claude Code」이 보낸 일정`이 붙는다. 같은 여행이 이미 있으면 지금처럼 `sameTripExists` 경고가 보인다.
4. 여행째 `가져오기`가 성공하면 받은함 항목을 서버에서 지운다. 여행 스위치를 끄고 장소만 가져오거나 창을 닫으면 항목은 남는다. 가져온 장소·여행은 보관함 저장이라 동기화로 다른 기기에 퍼진다.
5. `버리기` → "이 일정을 버릴까요? 되살릴 수 없어요" → 지움.

### 철회

설정 › 동기화 › AI 연결 목록의 `철회`. 그 토큰의 다음 요청부터 `401 token-revoked`. 이미 받은함에 들어온 항목과 만든 짧은 링크는 그대로다. `서버 자료 모두 지우기`(3단계)는 토큰과 받은함도 지운다.

## 계획 파일(`plan.json`) v1

Effect Schema `TripPlanSchema`(`pipeline/agent-trip/plan-schema.ts`, 새 파일)로 정의한다. `yarn trip --schema`가 `Schema.toJsonSchemaDocument`로 만든 JSON Schema를 출력해 에이전트가 참고한다. 모르는 필드는 거절한다(`onExcessProperty: 'error'`).

```json
{
  "format": "landmark-trip-plan",
  "version": 1,
  "title": "속초 1박 2일",
  "startDate": "2026-11-20",
  "endDate": "2026-11-21",
  "origin": "gangnam",
  "places": [
    { "key": "gangnam", "name": "강남역", "lng": 127.0276, "lat": 37.4979 },
    { "key": "tofu", "naverSid": "31506191", "memo": "[네이버 저장] 줄이 길다" },
    { "key": "market", "link": "https://naver.me/xxxxxxx" },
    { "key": "beach", "search": { "q": "속초해수욕장", "near": [128.6, 38.19] } },
    { "key": "hotel", "naverSid": "1234567890", "name": "예비 이름", "lng": 128.59, "lat": 38.2 }
  ],
  "days": [
    {
      "startTime": "09:00",
      "lodging": "hotel",
      "stops": [
        { "place": "tofu", "stayMin": 60, "fixedTime": "12:00", "note": "영업시간 확인 필요" },
        { "place": "beach", "stayMin": 90 }
      ]
    },
    {
      "startTime": "10:00",
      "lodging": "gangnam",
      "stops": [{ "place": "market", "stayMin": 60, "fixedTime": null }]
    }
  ],
  "candidates": [],
  "legModes": { "tofu>beach": "walk" }
}
```

| 필드 | 규칙 |
|---|---|
| `title` | 1~60자(`LIBRARY_LIMITS.tripTitleChars`). 공유 문서 제목과 여행 제목에 함께 쓴다 |
| `startDate`·`endDate` | `YYYY-MM-DD`, 1~30일(`SHARE_TRIP_LIMITS.maxDays`) |
| `places[]` | 1~200곳. `key`는 `^[A-Za-z0-9_-]{1,40}$`이고 겹치지 않는다. 출처는 `naverSid`(숫자 문자열)·`link`·`search` 중 하나 이하. 셋 다 없으면 핀이라 `name`·`lng`·`lat`이 필수. 출처가 있을 때 `name`·`address`·`lng`·`lat`은 조회 실패 때의 대체 값. 좌표(`lng`·`lat`·`search.near`)는 보관함·공유 스키마의 `Lng`·`Lat`(`src/schema/common.ts`: 경도 124~132, 위도 33~39)와 같은 범위. `name` 1~100자, `address` 200자까지, `memo` 10,000자까지(`memoChars`) |
| `days[]` | 기간의 날 수와 같은 개수. `startTime`(`HH:mm`, 기본 `09:00`), `lodging`(장소 key 또는 `null`, 마지막 날은 도착지), `stops[]` |
| `stops[]` | `place`(key), `stayMin`(0~1440 정수 또는 `null` = 앱 기본값), `fixedTime`(`HH:mm` 또는 `null`), `note`(500자까지) |
| `origin` | 1일차 출발지 key 또는 `null` |
| `candidates` | 아직 Day에 넣지 않은 후보 key |
| `legModes` | `"<key>><key>"` → `car`·`walk`. 그날 이웃한 두 점(출발점·Stop·숙소 순서의 실제 구간)인 쌍만 허용하고, 아니면 입력 오류 `leg-modes`. 없으면 앱 자동 규칙 |

의미 검사(스키마 다음, 장소 조회 전): 없는 key 참조, 여행 안 같은 장소 두 번(Stop·후보 — 출발지·숙소는 겹쳐도 됨), 날 수 불일치, 같은 네이버 sid 두 번, `legModes` 키 모양. 장소 조회 뒤에 출처 중복을 한 번 더 본다(아래 처리 순서 2). 여행이 참조하는 장소(출발지·숙소·Stop·후보)가 하나도 없으면 오류 `no-places`(경로 `days`, 끝 코드 2): `buildTripShareDoc`이 참조한 장소만 담아 `checkShareTrip`의 "장소가 하나도 없어요"에 걸리기 때문이다. 쓰지 않는 장소는 오류가 아니라 경고이고 문서에 들어가지 않는다(`buildTripShareDoc`가 쓰는 장소만 담는다).

## CLI(`yarn trip`)

```
yarn trip build <plan.json> [--memo] [--no-routes] [--out <doc.json>] [--app <주소>] [--json]
yarn trip send  <plan.json> [--no-memo] [--no-routes] [--app <주소>] [--json]
yarn trip share <plan.json> [--memo] [--no-routes] [--app <주소>] [--json]
yarn trip whoami [--app <주소>] [--json]
yarn trip unshare <id> [--app <주소>] [--json]
yarn trip unshare --list [--app <주소>] [--json]
yarn trip --schema
```

- 앱 주소: `--app` > `LANDMARK_APP_URL` > `DEFAULT_APP_URL`(`https://landmark.sch0718.dev`, `src/share-viewer/encode.ts`). `appUrl()`로 끝 `/`를 뗀다. 토큰을 쓰는 명령은 위 결정 표의 허용 출처만 받는다.
- 서버 요청(`send`·`share`·`whoami`·`unshare`)은 본문 수신까지 15초 제한, 자동 재시도는 하지 않는다. 시간 초과는 끝 코드 5 `timeout`. 다시 부르면 `send`는 같은 요청 키라 받은함에 하나만 남고, `share`는 새 암호문·삭제 토큰으로 새 링크를 만든다(앞 링크가 만들어졌어도 기한 뒤 지워진다).
- `--no-routes`: 길찾기를 묻지 않고 모든 구간을 직선 추정(`estimated`)으로 둔다(오프라인·시험용).

### 처리 순서(`build`, 다른 명령도 먼저 같은 단계를 거친다)

1. **읽기·검사**: `TripPlanSchema` 해석 → 의미 검사. 실패는 모두 모아 한 번에 낸다.
2. **장소 조회**(`pipeline/agent-trip/resolve-places.ts`, 새 파일): 차례로, 네이버 요청 사이 300ms. 모든 요청은 `makeRequester`(`src/server/request.ts`, 본문 수신까지 8초 제한)로 감싼다. `fetchPlaceSummary`는 그 자체로 시간 제한이 없으므로 `src/server/resolve.ts`의 `httpDeps(request)`처럼 요청기를 `fetch`로 주입한다(이 래퍼를 내보내거나 CLI에 같은 모양으로 둔다). 시간 초과는 조회 실패와 같게 다룬다. 조회 결과(특히 `resolveLink`의 구글 링크는 전 세계 좌표를 줄 수 있다)도 `Lng`·`Lat` 범위와 이름·주소 길이를 다시 보고, 벗어나면 대체 값이 있어도 그 장소 경로의 입력 오류 `out-of-range`(끝 코드 2)로 낸다. 너무 긴 네이버 이름·주소는 100자·200자로 자르고 경고한다. `naverSid` → `fetchPlaceSummary`(이름·주소·좌표·분류), `link` → `resolveLink`(네이버·카카오·구글 장소. 폴더 링크는 오류), `search` → `searchNaverPlaces`(위 결정 표). 실패하면 대체 값(`name`·`lng`·`lat`)이 있을 때 그것으로 쓰고 경고, 없으면 오류. 출처는 `{ kind: 'naver', sid }`·`kakao`·`google`·`pin`. 조회가 끝나면 `sourceKey`(`src/domain/library/add-place.ts`)로 다시 겹침을 본다. `naverSid`와 `link`·`search`가 같은 네이버 장소로 풀리는 경우처럼 두 key가 같은 출처면 `LibrarySchema`의 출처 중복 검사에 걸리므로, 합치지 않고 오류 `duplicate-source`로 두 경로(`places[1]`·`places[3]`)를 함께 알린다. AI가 한 key로 합쳐 다시 부른다.
3. **보관함 만들기**(`pipeline/agent-trip/build-library.ts`, 새 파일): `emptyLibrary()`에 `newPlace`(`src/domain/library/add-place.ts`)로 장소를 넣고, `createTrip`(`origin`·`candidates` 포함) → Day마다 `insertStop` → `setStopStay`·`setStopFixedTime`·`setStopNote` → `setLodging`(`alsoFollowingDays: false`) → `setDayStartTime` → `setLegMode`. id는 `src/services/id-gen.ts`의 `randomId`(지금 모듈 안 함수 → 내보냄). 연산이 `ok: false`면 해당 `plan.json` 경로로 바꿔 오류. 마지막에 `LibrarySchema`로 검사한다.
4. **구간 시간**(`pipeline/agent-trip/route-legs.ts`, 새 파일): 모든 Day의 `dayLegs`를 모아 `routeOf(leg)`를 만든다. 앱 일정 공유 창(`src/sections/share-export/use-trip-legs.ts`)과 같은 규칙이다.
   - 직선 `SAME_POINT_M`(10m) 미만 → `same-point`(0초·0m).
   - `resolveRoute({ mode: leg.mode, from, to }, { fetch })` 성공 → `routed`(시간·거리·통행료·경로선·`queriedAt`).
   - `NO_ROUTE` → `no-route`, 그 밖 실패 → `estimated`. 둘 다 `estimateLeg(leg.mode, leg.straightM)` 값, 경로선·조회 시각 없음.
   - 같은 입력 키(`routeInputKey`)는 한 실행에서 한 번만 묻는다. 요청 사이 300ms. `resolveRoute`는 `makeRequester`로 8초 제한이 있고, 시간 초과는 `estimated`.
   - `legModes`에서 `walk`를 골랐는데 두 장소의 직선거리가 `WALK_MAX_M`(50km)을 넘으면 `setLegMode`가 조용히 무시하고 `legBetween`이 자동차로 본다. CLI는 장소 조회 뒤(3단계 전에) 이를 입력 오류 `walk-too-far`(경로 `legModes["a>b"]`, 끝 코드 2)로 낸다.
5. **문서**: `buildTripShareDoc(lib, tripId, routeOf, { title, includeMemo, includeCandidates: true, now })` → `ShareDocV2Schema`(`onExcessProperty: 'error'`) → `checkShareTrip`. 여기서 걸리면 CLI 결함이므로 `internal` 오류로 낸다.
5-1. **가져오기 모의 실행**: `importSharedTrip(emptyLibrary(), hashDoc(doc), { titleLabel: defaultTitleLabel(doc.title), appendMemo: true }, ctx)`(화면 `SharePreview`의 기본값과 같은 제목 라벨. 라벨 이름은 30자 한도라 60자 제목을 그대로 넘기면 `LabelNameInvalid`)로 앱이 가져올 결과를 만들고, 연산이 `ok: false`면 `internal` 오류로 낸다. 결과 여행의 Day별 Stop 수·후보 수가 문서와 같은지 본다. 앱 가져오기는 이름이 같고 50m 안인 핀을 한 장소로 합치고 같은 장소의 뒤 Stop을 버리므로, 줄었으면 입력 오류 `merged-places`(합쳐진 두 장소 경로)로 알려 AI가 한 key로 합치게 한다(앱 병합 규칙은 바꾸지 않는다). 그다음 장소·라벨·여행 항목마다 키 정렬 JSON이 동기화 항목 상한 `ITEM_DOC_MAX_CHARS`(200,000자, `src/domain/library-sync/items.ts`)를 넘지 않는지 본다. 넘으면 입력 오류 `item-too-large`(해당 장소·Day 경로). 가져온 뒤 다른 기기로 동기화되지 않는 일정을 받은함에 넣지 않기 위해서다.
6. **링크**: `viewLink(doc, app)`(경로선 포함, 32,000자를 넘으면 경로선 없이)와 `importLink(doc, app)`(경로선 뺀 사본). 둘 다 `direct`가 아니면 `too-big`. `/import#d=` 값을 `readShareHash`로 다시 읽어 앱이 받을 수 있는지 확인한다.
7. **요약**(`pipeline/agent-trip/summary.ts`, 새 파일): Day마다 `computeSchedule`로 도착·떠남 시각, 고정 시각 여유·늦음, 이동 합계, 추정 구간 수, 가장 이른 조회 시각.

`send`는 6의 `/import#d=` 값을 받은함에 올리고, `share`는 `/view#d=` 값을 `encryptShareHash`(`src/services/share-short/crypto.ts`)로 암호화해 올린다(아래 API). 삭제 토큰은 `newDeleteToken()`으로 만들고, 기한 기준일은 `shortKeepUntil([endDate])`다. 서버가 `201`(또는 같은 삭제 토큰 재시도의 `200`)을 주면 삭제 토큰을 `~/.landmark/agent-shares.json`에 더한다(`pipeline/agent-trip/share-store.ts`, 새 파일). 파일 쓰기에 실패해도 링크는 만들어졌으므로 성공으로 끝내되 경고 `share-store`("이 링크는 기한까지 지울 수 없어요")를 낸다. 삭제 토큰은 출력·`--json`에 넣지 않는다.

`unshare <id>`: 파일에서 같은 `app`·`id`를 찾는다(없으면 끝 코드 2 `unknown-share`) → `DELETE /api/agent/v1/share/:id`(헤더 `X-Delete-Token`) → `204`, 또는 `404`이면서 JSON 본문이 `{ error: 'not-found' }`(링크가 없거나 기한이 지남)일 때만 파일에서 뺀다. 본문이 JSON이 아니거나 `error`가 다른 `404`(옛 서버라 경로가 없음·정적 앱 응답)는 링크가 남아 있을 수 있으므로 항목을 남기고 끝 코드 5 `old-server`. `403 delete-token`이면 항목을 남기고 끝 코드 4.

### 출력

사람용은 한국어 요약과 링크. `--json`은 표준 출력에 JSON 하나만 낸다(진행 상황은 표준 오류).

```json
{
  "ok": true,
  "command": "send",
  "trip": { "title": "속초 1박 2일", "startDate": "2026-11-20", "endDate": "2026-11-21", "places": 5 },
  "days": [{ "date": "2026-11-20", "stops": [{ "key": "tofu", "name": "초당순두부마을", "arrive": "10:42", "depart": "13:00", "fixedTime": "12:00", "slackMin": 78 }], "travelMin": 214, "estimatedLegs": 0 }],
  "routes": { "legs": 5, "routed": 4, "estimated": 1, "noRoute": 0, "oldestQueriedAt": "2026-11-01T05:12:00.000Z" },
  "links": { "view": "https://…/view#d=…", "import": "https://…/import#d=…" },
  "inbox": { "id": "…", "expiresAt": "2026-12-01T05:12:00.000Z", "created": true },
  "warnings": [{ "path": "places[3]", "code": "fallback", "message": "네이버 장소를 받지 못해 적어 준 이름·좌표를 썼어요" }]
}
```

실패는 `{ "ok": false, "command": "…", "errors": [{ "path": "days[1].stops[2].place", "code": "unknown-place", "message": "places에 없는 key예요 (beachh)" }] }`. 검색 후보가 여럿이면 `code: "ambiguous"`와 `candidates: [{ naverSid, name, address, category }]`. 토큰·`Authorization` 값은 어떤 출력·오류에도 넣지 않는다.

| 끝 코드 | 뜻 |
|---|---|
| 0 | 성공(경고 있을 수 있음) |
| 2 | 입력 오류(`plan.json`, `too-big`, 허용 밖 `--app`) |
| 3 | 장소 조회 실패·검색 후보 여럿 |
| 4 | 토큰 없음·무효·만료·철회·허용 밖 계정·권한 없음 |
| 5 | 서버 거절·장애(`inbox-full`·429·503·옛 서버 404·연결 실패) |
| 1 | 그 밖(내부 오류) |

## 서버 데이터(D1, 스키마 버전 7)

`src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에** 더하고 `SCHEMA_VERSION = 7`. 모두 `IF NOT EXISTS`, `ALTER TABLE` 없음. 시각은 동기화 표처럼 서버 epoch ms 정수.

```sql
-- 7: AI 연결 토큰과 받은함. 토큰 원문은 두지 않는다.
CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,                   -- 공개 id 12자(a-z0-9). 목록·철회·받은함 출처
  user_id TEXT NOT NULL,                 -- users.id
  token_hash TEXT NOT NULL,              -- hashToken(원문), SHA-256 base64url
  name TEXT NOT NULL,                    -- 1~40자
  scopes TEXT NOT NULL,                  -- 'inbox:write share:create'(공백 구분)
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,           -- created_at + 90일
  last_used_at INTEGER,                  -- 1시간에 한 번만 갱신
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tokens_hash ON agent_tokens(token_hash);
CREATE INDEX IF NOT EXISTS agent_tokens_user ON agent_tokens(user_id);
CREATE TABLE IF NOT EXISTS agent_inbox (
  id TEXT PRIMARY KEY,                   -- 16자 base64url
  user_id TEXT NOT NULL,
  token_id TEXT NOT NULL,                -- 보낸 토큰(지워졌을 수 있다)
  request_key TEXT NOT NULL,             -- CLI가 계획으로 만든 요청 키(43자). 같은 계획 다시 보내기 판단
  data TEXT NOT NULL,                    -- /import#d= 값(압축 JSON base64url, 32,000자 이하)
  title TEXT NOT NULL,                   -- 목록 표시용(문서에서 꺼냄)
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  places INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL            -- created_at + 30일
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_inbox_key ON agent_inbox(user_id, request_key);
CREATE INDEX IF NOT EXISTS agent_inbox_user ON agent_inbox(user_id, created_at);
CREATE INDEX IF NOT EXISTS agent_inbox_expires ON agent_inbox(expires_at);
```

- `ACCOUNT_DATA_TABLES`(`src/server/library-sync/library.ts`)에 `'agent_inbox'`, `'agent_tokens'`를 더해 `DELETE /v1/account`가 함께 지운다.
- 만료와 삭제: `expires_at`이 지난 행은 어떤 경로로도 읽히지 않는다(목록·항목 읽기·중복 판단이 모두 `expires_at > now` 조건). 물리적 삭제는 요청 때 `waitUntil`로 한다: 받은함 올리기·앱 목록 읽기(누구의 요청이든) 때 전체에서 만료 행 최대 50개. Cron이 없으므로 요청이 없으면 만료 행이 더 남을 수 있다(짧은 링크 `pruneExpiredShares`와 같은 한계). 토큰 발급 때 만료·철회 뒤 30일 지난 그 사용자 토큰 행을 지운다.
- 짧은 링크는 새 표가 없다. 기존 `share_links`에 넣는다.
- D1 쓰기: 올리기 한 번에 카운터 1 + 받은함 1행(+ 토큰 사용 시각 1시간에 1). 무료 한도(하루 쓴 행 10만, 계정 합계)에 비해 작다.

## API(Pages Functions)

### 에이전트 API(토큰)

진입점 `functions/api/agent/[[path]].ts`(새 파일) → `handleAgent(ctx, deps)`(`src/server/agent/router.ts`, 새 파일). 환경·의존성은 `SyncContext`·`SyncDeps`를 그대로 쓰고 `SyncEnv`에 `AGENT_API?: string`·`SHARE_SHORT?: string`을 더한다. 응답·오류는 동기화와 같은 `syncJson`·`SyncHttpError`(`{ error: '<code>', ...extra }`), 모두 `Cache-Control: private, no-store`. 로그는 `handleSync`처럼 `{ method, path(패턴), status, ms }` 한 줄만.

공통 앞 단계: `Origin` 헤더가 있으면 `403 origin` → `DB` 없으면 `503 config` → `ensureSchema` → `AGENT_API === 'off'`이고 경로에 `allowWhenOff`가 없으면 `503 off`(`allowWhenOff`는 짧은 링크 지우기뿐) → 토큰 검사(`requireAgentToken`, 아래 보안) → 범위 → 사용자 하루 한도.

| 요청 | 범위 | 하는 일 | 하루 한도(사용자) | 성공 |
|---|---|---|---|---|
| `GET /api/agent/v1/whoami` | 없음 | 토큰 상태 | `agent-whoami` 500 | `200 { name, scopes, expiresAt, provider }` |
| `POST /api/agent/v1/inbox` | `inbox:write` | `{ v: 1, key, d }`를 받은함에 넣는다 | `agent-inbox` 50 | `201 { id, expiresAt, created: true }`, 만료되지 않은 같은 `key`면 `200 { …, created: false }` |
| `POST /api/agent/v1/share` | `share:create` | 암호문을 `share_links`에 넣는다 | `agent-share` 50 | `201 { id, expiresAt, created: true }` |
| `DELETE /api/agent/v1/share/:id` | `share:create` | 헤더 `X-Delete-Token`(43자)이 맞는 짧은 링크를 지운다 | `agent-share-delete` 200 | `204`, 없는·만료 링크 `404`, 토큰 다름 `403 delete-token` |

- 본문은 `readLimitedJson(request, SHARE_REQUEST_MAX_BYTES)`(40,000바이트, `src/server/share/handlers.ts`)로 읽는다. 이 함수는 `ApiError`(`TOO_LARGE`·`BAD_REQUEST`)를 던지고 `syncError`는 `ApiError`를 모르므로(그대로면 `500 internal`), `handleAgent`가 경계에서 바꾼다: `TOO_LARGE` → `413 { error: 'too-large' }`, `BAD_REQUEST`(본문을 못 읽음·JSON 아님) → `400 { error: 'bad-json' }`. 스키마 실패는 `422 { error: 'invalid' }`.
- `inbox`: `key`는 `^[A-Za-z0-9_-]{43}$`, `d`는 `^[A-Za-z0-9_-]{1,32000}$`. `readShareHash(d, AGENT_INBOX_LIMITS)`가 `ok`이고 `version === 2`이며, 문서 `title`과 `trips[0].title`이 모두 60자(`LIBRARY_LIMITS.tripTitleChars`) 이하, 장소마다 `name` 100자·`address` 200자·`memo` 10,000자 이하, 출처 id는 `naverSid`·`kakaoId` `^\d{1,20}$`, `googleId` 64자 이하(공유 스키마는 출처 id 길이를 제한하지 않아 21만 자 숫자 sid 하나로도 가져온 장소가 동기화 항목 상한을 넘는다), `trips[0].legModes`의 키가 모두 문서의 실제 구간(`dayPoints`의 이웃한 쌍)이어야 한다(관계 검사는 키의 장소 참조만 보고 개수를 제한하지 않아, 구간 설정 6,700개짜리 문서가 상한 안에서 통과한 뒤 가져온 여행이 `ITEM_DOC_MAX_CHARS`를 넘는다. 실제 구간만 받으면 키 수가 구간 수 이하로 묶인다)(공유 스키마는 이름 길이를 제한하지 않아 이름 21만 자 장소도 링크가 된다. 가져오면 동기화 항목 상한 `ITEM_DOC_MAX_CHARS`를 넘어 다른 기기에 퍼지지 않는다)(공유 스키마는 제목 길이를 제한하지 않아 50만 자 제목도 압축 1,000자 안에 들어간다. 목록 응답이 커지지 않게 서버가 막는다). 실패는 `422 { error: 'invalid', reason }`(`reason`은 `ShareReadError`·`not-trip`·`title`·`place-too-long`(이름·주소·메모·출처 id)·`leg-modes`). 목록의 `title`은 `trips[0].title`(비면 문서 `title`)이다. 처리 순서:
  1. 같은 사용자·같은 `key`의 **만료되지 않은** 행이 있으면 그 행을 `200 created: false`로 돌려준다(가득 찬 상태여도 먼저 본다).
  2. 같은 `key`의 만료된 행이 남아 있으면(정리 전) 같은 `batch`의 첫 문장에서 지운다.
  3. 넣기는 한 문장의 조건부 `INSERT … SELECT … WHERE (SELECT count(*) FROM agent_inbox WHERE user_id = ? AND expires_at > ?) < 20`. 바뀐 행이 0이거나 `UNIQUE` 충돌이면 1을 한 번 더 한다: 같은 `key`의 만료되지 않은 행이 있으면(같은 `key` 경쟁에서 진 쪽 — 19개 상태에서 두 요청이 동시에 오면 진 쪽은 `UNIQUE`가 아니라 개수 조건으로 0행이 된다) 그 행을 `200 created: false`로, 없으면 `409 inbox-full`. 두 요청이 동시에 와도 한도를 넘지 않는다.
- `share`: 본문 `{ body, kind: 'trip', keepUntil?, deleteToken }`. 검사는 `handleShareCreate`의 `createSchema`에서 `turnstile`만 뺀 것. `SHARE_SHORT === 'off'`면 `503 off`. 저장은 `handleShareCreate`에서 꺼낸 새 함수 `insertShareLink(db, { body, kind, keepUntil, deleteHash }, now)`를 둘이 함께 쓴다(같은 `delete_hash` 재시도·id 충돌 3번·`shortExpiresAt` 기한·`pruneExpiredShares`). 서버는 키가 없어 내용을 검사하지 못한다. 문서 검사는 CLI(위 5·6단계)와 보기 화면이 한다.
- `DELETE /share/:id`: `handleShareDelete`의 지우기 부분을 새 함수 `deleteShareLink(db, id, deleteToken): Promise<'deleted' | 'forbidden' | 'not-found'>`로 꺼내 둘이 함께 쓴다(`hashToken`으로 `delete_hash` 비교). 삭제 토큰만으로 권한을 보므로 다른 사용자 토큰으로도 지울 수 있다(브라우저 경로와 같다). 다른 스위치와 같이 지우기는 막지 않는다: `AGENT_API=off`·`SHARE_SHORT=off`여도 이 경로는 열린다(토큰 검사는 그대로).
- 토큰 실패는 IP 해시별 `agent-auth-fail` 하루 300번(`hashIp` + `IP_HASH_SALT`, 로컬은 `dev-salt`)을 넘으면 `429`. 정상 요청은 이 카운터를 쓰지 않는다.

### 동기화 세션 API(앱)

`AGENT_SYNC_ROUTES`(`src/server/agent/sync-routes.ts`, 새 파일)를 `SYNC_ROUTES` 끝에 더한다(`BACKUP_ROUTES`와 같은 방식, 같은 출처 검사·세션 인증 `requireSyncUser`). 앱은 `getSharedSyncApi().client.send`로 부른다.

| 요청 | 하는 일 | `allowWhenOff` | 한도 | 성공 |
|---|---|---|---|---|
| `GET /v1/agent/tokens` | 내 토큰 목록(살아 있는 것 + 만료·철회 30일 안) | 예 | — | `200 { enabled, canCreate, maxActive: 10, tokens: [{ id, name, scopes, createdAt, expiresAt, lastUsedAt, revokedAt }] }` |
| `POST /v1/agent/tokens` | 발급(`{ name, scopes }`) | 아니오 | `agent-token-create` 20/일 | `201 { token, id, name, scopes, expiresAt }`. 10개면 `409 too-many-tokens`(받은함과 같이 살아 있는 토큰 수를 조건으로 건 한 문장의 조건부 `INSERT … SELECT … WHERE (SELECT count(*) …) < 10`, 바뀐 행 0이면 409), `AGENT_API=off`면 `503 off` |
| `DELETE /v1/agent/tokens/:id` | 철회(`revoked_at`) | 예 | — | `204`, 남의 것·없음 `404` |
| `GET /v1/agent/inbox` | 받은함 목록(만료 제외, 오래된 순) | 예 | `agent-inbox-read` 2,000/일 | `200 { items: [{ id, title, startDate, endDate, places, from, createdAt, expiresAt }] }`. `from`은 토큰 이름(없으면 `null`) |
| `GET /v1/agent/inbox/:id` | 항목 값 | 예 | 위와 같음 | `200 { id, data }` |
| `DELETE /v1/agent/inbox/:id` | 가져온 뒤·버리기 | 예 | — | `204`, 없음 `404` |

- 응답은 `{ enabled, canCreate, … }` 둘로 나눈다. `enabled`는 `AGENT_API !== 'off'`(에이전트 API가 도는가), `canCreate`는 `enabled && LIBRARY_SYNC !== 'off'`(발급 경로가 받는가). `LIBRARY_SYNC=off`면 발급은 기존 라우터 규칙대로 `503 off`, 나머지는 `allowWhenOff`로 열린다.
- 발급 응답의 `token`은 이 응답에만 있다. 앱은 메모리에만 두고 창을 닫으면 버린다.

## 앱

### 받은함 확인

- 부트 `src/services/agent-inbox/boot.ts`(새 파일): `loadAgentInbox = lazyChunk(() => import('src/services/agent-inbox/inbox-check'))`, `loadAgentSection`, `loadAgentInboxDialog`. `src/sections/agent/use-agent-inbox-boot.ts`(새 파일)를 `LibraryShell`(`src/sections/shell/ShellRoute.tsx`)의 `useAutoBackupBoot()` 다음 줄에서 부른다. `readBootFlag()`가 거짓이면 실행기를 받지 않는다. 같은 페이지에서 동기화를 켜는 경우(첫 연결, 설정의 `다시 켜기`는 엔진 `enable()`만 부르고 셸을 다시 마운트하지 않는다)를 위해, 훅은 `syncStatusAtom`(첫 로딩 묶음)을 구독해 `phase`가 처음 `synced`가 될 때 실행기를 받아 붙인다. 이미 붙었으면 다시 붙이지 않는다.
- 실행기 `src/services/agent-inbox/inbox-check.ts`(새 파일, 조각 `inbox-check` — Vite 조각 이름은 파일 이름을 따른다): `loadSyncEngine()`의 `ensureLibrarySyncEngine().onRunFinished`에 붙어(자동 백업 `attachAutoBackup`과 같은 모양) 위 결정 표의 간격으로 `GET /v1/agent/inbox`. 새 id가 있으면 `sonner` 알림 「AI가 보낸 일정 N개」 + `보기`. 실패(오프라인·5xx·429)는 조용히 다음 실행에서 다시 한다. 401·403(`auth`·`not-allowed`)은 이 페이지에서 받은함 확인을 멈추고 알림을 내지 않는다. 세션 지우기·상태 바꾸기는 하지 않고 동기화 엔진의 다음 실행(`schedule('manual')`을 한 번 부름)이 자기 실패 처리로 `auth`·`not-allowed`를 정하게 한다(같은 세션으로 엔진도 같은 응답을 받는다). 멈출 때 그 세션 id(`readSession()`)를 기억하고, 이후 `onRunFinished`가 올 때 저장된 세션 id가 달라졌으면(같은 페이지에서 다시 로그인 — Google 재로그인은 페이지 이동 없이 엔진을 다시 시작한다) 멈춤을 풀고 확인을 이어 간다.
- 기기 키 `tripmap:agent-inbox:v1`(`src/services/agent-inbox/storage.ts`, 새 파일): `{ v: 1, userId, notified: string[] }`(최대 100개). 다른 사용자면 비운다. 백업·동기화에 넣지 않는다.

### 미리보기와 가져오기

- `AddFlow`(`src/stores/add-place.ts`)의 `share` 단계에 선택 필드 `inbox?: { id: string; from: string | null; owner: string }`을 더한다(`owner`는 요청을 시작할 때의 `readSyncMeta().userId`). 받은함 창의 `미리보기`가 `GET /v1/agent/inbox/:id` → `readShareHash(data)` → `setFlow({ step: 'share', doc, inbox })`. 읽기에 실패하면 `SHARE_READ_MESSAGES` 문구와 `버리기`만 보인다.
- **계정이 바뀐 경우**: 서버 백업 구역의 `sameOwner()`와 같이, 받은함 목록·항목 응답을 받은 뒤와 `SharePreview`의 가져오기 직전에 `readSyncMeta().userId === owner`이고 저장된 세션이 있는지 다시 본다. 다르면 결과를 버리고 흐름을 닫으며 알림 "로그인한 계정이 바뀌어 받은 일정을 닫았어요". 받은함 창이 열린 채 계정이 바뀌면(`storage` 이벤트로 동기화 기록이 바뀜) 창을 닫는다. 기기 키 `tripmap:agent-inbox:v1`의 `userId`가 다르면 알린 기록을 비운다.
- `SharePreview`(`src/sections/share-import/SharePreview.tsx`): `inbox`가 있으면 머리 한 줄을 더한다. 받은함 항목은 **여행째 가져오기(`tripSwitchOn`이 켜져 있어 `importSharedTrip`으로 새 여행을 만든 경우)가 성공했을 때만** `loadAgentInbox()`로 받은 지우기 함수를 부른다(실패해도 가져오기는 성공으로 두고 알림 "받은함에서 지우지 못했어요"). 여행 스위치를 끄고 고른 장소만 가져오면 항목을 남기고 알림 "받은 일정은 받은함에 남겨 둘게요. 다 쓰셨으면 버려 주세요". `SharePreview`는 지금처럼 `loadSharePreview` 조각이고 동기화 API를 정적으로 가져오지 않는다.

### 설정 › 동기화 › AI 연결

- `src/sections/agent/AgentSection.tsx`(새 파일, 설정 화면에서 `lazy`): `SettingsPage`의 `동기화` 절 안 `SyncSection` 아래. 동기화 로그인(`readSyncMeta().userId`와 저장된 세션)이 있을 때만 보인다.
- 설명: "Claude Code 같은 AI 도구가 일정을 받은함으로 보내거나 공유 짧은 링크를 만들 수 있게 연결해요. 연결 토큰으로는 보관함을 읽거나 고칠 수 없어요. 받은 일정은 내가 `가져오기`를 눌러야 보관함에 들어가요."
- 목록 줄: 이름 · 권한 · `만료 1월 30일(90일 남음)` · `마지막 사용 오늘` · `철회`. 만료·철회된 줄은 흐리게.
- `새 연결 만들기` 창(`AgentTokenDialog.tsx`, 같은 조각): 이름·권한 체크 → 토큰 한 번 표시(위 흐름). 10개면 단추를 끄고 "연결은 10개까지예요. 쓰지 않는 연결을 철회해 주세요".
- `받은 일정 N개 · 보기`(받은함 창). `canCreate: false`면 만들기를 끄고, `enabled: false`면 "지금은 AI 연결을 쓸 수 없어요", 동기화만 꺼졌으면 "동기화가 꺼져 있어 새 연결을 만들 수 없어요"를 보인다.

### 첫 로딩·조각

| 묶음 | 파일 | 첫 로딩 |
|---|---|---|
| 부트 | `src/services/agent-inbox/boot.ts`, `src/sections/agent/use-agent-inbox-boot.ts` | 들어감(합쳐 gzip 0.5KB 안) |
| 실행기 | `src/services/agent-inbox/inbox-check.ts`(+ `storage.ts`, 앱 API `src/services/agent-inbox/api.ts`) | `inbox-check-*.js` |
| 설정 구역 | `src/sections/agent/AgentSection.tsx`, `AgentTokenDialog.tsx` | `AgentSection-*.js` |
| 받은함 창 | `src/sections/agent/AgentInboxDialog.tsx` | `AgentInboxDialog-*.js` |

- `build:ci`에 `--require-lazy AgentSection --require-lazy AgentInboxDialog --require-lazy inbox-check`를 더한다. 첫 로딩 상한(`perf-budget.json` 327,680)은 그대로.
- 동기화 엔진은 `loadSyncEngine()`(동적 import)으로만 받는다. 정적으로 가져오면 `INEFFECTIVE_DYNAMIC_IMPORT`로 빌드가 실패한다(4단계 설계와 같음).
- 새 `VITE_` 변수가 없다. CLI는 `LANDMARK_APP_URL`·`LANDMARK_AGENT_TOKEN`만 읽는다(`vitest.config.ts`의 `test.env`는 그대로).

## 보안

- **토큰**: 32바이트 무작위(`crypto.getRandomValues`), 원문은 발급 응답에만. D1에는 `hashToken` 해시만 두고 해시로 찾는다. 공개 id는 목록·철회·받은함 출처에만 쓴다.
- **검사(`requireAgentToken(ctx, deps, scope)`, `src/server/agent/auth.ts` 새 파일)**: `Authorization: Bearer lmk_<43자>` 모양 → `agent_tokens JOIN users`를 해시로 한 번 읽음 → 없음 `401 unauthorized`, `revoked_at` `401 token-revoked`, `expires_at` 지남 `401 token-expired` → **허용 계정 재확인**: `users.firebase_sub`가 `kakao:`·`naver:`로 시작하면 `parseAccountList(ALLOWED_ACCOUNTS)`(개발 가짜 공급자가 켜졌고 변수가 없으면 `sessionAuthFor`와 같이 `kakao:dev-me,naver:dev-me`), 아니면 `parseAllowList(ALLOWED_EMAILS)`에 `users.email`(소문자) → 없으면 `403 not-allowed` → 범위가 없으면 `403 scope`. 두 함수는 `@sch0718/firebase-session/worker`가 내보내는 것으로 세션 인증과 같은 규칙이다.
- **범위**: `inbox:write`·`share:create`뿐. 보관함·동기화 표를 읽거나 쓰는 경로가 없다. 받은함은 사람이 `가져오기`를 눌러야 보관함에 들어간다.
- **사용자 격리**: 모든 질의에 토큰·세션에서 얻은 `user_id`. 본문의 값은 권한 근거로 쓰지 않는다.
- **브라우저·CSRF**: 에이전트 API는 쿠키를 쓰지 않고 `Authorization` 헤더만 받는다. `Origin`이 있는 요청은 거절하고 CORS 응답 헤더를 내지 않는다. 발급·목록·철회는 동기화 세션 헤더(`X-Landmark-Session`)와 기존 출처 검사(`isSyncOrigin`) 아래에 있다.
- **크기·빈도**: 본문 40,000바이트, 받은함 값 32,000자·풀린 JSON 1MB·장소 200곳(`AGENT_INBOX_LIMITS`). 하루 한도는 위 표(UTC 날짜, `rate_counters`). 받은함 20개·30일.
- **CPU**: 받은함 올리기는 풀기와 Effect Schema 검사를 한다. `readShareHash`(`src/domain/share/read-share.ts`)에 선택 인자 `limits`(기본 `SHARE_IMPORT_LIMITS`)를 더해 서버만 `AGENT_INBOX_LIMITS`(새 상수: `hashChars` 32,000 그대로, `decodedBytes` 1,048,576, `places` 200)를 넘긴다. 풀기 상한은 `decodeCompressedJson`의 `maxBytes`로 압축을 푸는 중에 끊는다. CLI도 보내기 전에 같은 상수로 검사해 서버가 거절할 문서를 보내지 않는다(장소 200곳 = `plan.json` 상한). 출시 전 미리보기에서 상한 크기 문서(30일·장소 200곳·Stop 메모 500자)와 압축률이 높은 입력(1MB까지 풀리는 반복 문자열)의 CPU 시간을 재고, 무료 한도(요청당 10ms)를 넘으면 `decodedBytes`를 더 낮춘다.
- **내용 공개 범위**: 받은함은 동기화와 같은 일반 저장(운영자가 D1에서 읽을 수 있음). 30일 뒤 읽을 수 없게 되고, 물리적 삭제는 그 뒤 첫 받은함 요청 때다(위 「서버 데이터」). 짧은 링크는 암호문만 저장하고 키는 링크 `#k=`에만 있다. 짧은 링크 기본값은 장소 메모 제외.
- **CLI**: 토큰을 허용 출처에만 보낸다. 토큰·헤더를 출력·오류·`--out` 파일에 쓰지 않는다. 키체인은 셸 없이 `execFile('security', [...])`. 토큰을 저장소 파일·`plan.json`에 넣지 않는다(문서와 스킬 규약에 적는다).
- **로그**: 서버는 경로 패턴·상태·시간만. 토큰·문서·계정 id를 남기지 않는다.
- **프롬프트 주입**: 받은함 항목은 일반 받은 공유 파일과 같은 검사(`readShareHash`)를 거치고 화면은 React 텍스트로만 그린다. 사람이 보고 가져온다.

## 오류·장애

| 상황 | 서버 | CLI | 앱 |
|---|---|---|---|
| 토큰 없음 | — | 끝 코드 4 "토큰이 없어요. 설정 › 동기화 › AI 연결에서 만든 뒤 `LANDMARK_AGENT_TOKEN` 또는 키체인에 넣어 주세요" | — |
| 토큰 무효·만료·철회 | `401 unauthorized`·`token-expired`·`token-revoked` | 4, 코드별 안내(만료·철회는 새로 만들기) | 목록에 상태 표시 |
| 허용 밖 계정·범위 없음 | `403 not-allowed`·`scope` | 4 | — |
| 받은함 가득 | `409 inbox-full` | 5 "앱에서 받은 일정을 가져오거나 버려 주세요" | — |
| 하루 한도 | `429 rate-limited` | 5 | 받은함 확인은 다음 실행에서 |
| 스위치 | `503 off` | 5 "지금은 AI 연결을 쓸 수 없어요" | 만들기 꺼짐, 받은함 읽기·지우기는 됨 |
| 설정 누락(`DB`) | `503 config` | 5 | — |
| 옛 서버(경로 없음) | `404`(정적 앱 응답일 수 있음) | 5 "서버가 이 기능을 몰라요(옛 버전)" | — |
| 문서 거절 | `422 invalid` + `reason` | 1(CLI 검사를 지났는데 거절이면 결함) | — |
| 링크가 너무 김 | — | 2 `too-big` "장소·Day를 줄이거나 앱에서 파일로 공유해 주세요" | — |
| 네이버 장소·검색 실패 | — | 대체 값이 있으면 경고, 없으면 3 | — |
| 길찾기 실패 | — | 그 구간 `estimated`·`no-route`, 경고 | 미리보기·보기 화면에 어림값 표시(지금 규칙) |
| 오프라인 | — | 5 `offline` | 받은함 확인 건너뜀 |
| 받은함 항목 읽기 실패 | — | — | `SHARE_READ_MESSAGES` 문구 + `버리기` |
| 가져온 뒤 지우기 실패 | — | — | 가져오기는 성공, 알림 "받은함에서 지우지 못했어요". 다음 확인 때 다시 보이며 `sameTripExists` 경고가 중복을 알린다 |

## 호환·롤백

- 보관함(`tripmap:library:v2`)·백업 파일·공유 문서(`ShareDoc` v1·v2) 형식은 바뀌지 않는다. 받은함 항목은 기존 `/import#d=` 값과 같다. 새 기기 키 `tripmap:agent-inbox:v1`은 옛 버전이 무시한다. `AddFlow`의 `inbox` 필드는 메모리 상태다.
- `/api/search` 응답 모양은 그대로다(`searchNaverPlaces`는 `sid`를 더 주고, `resolveSearch`가 지금 모양으로 줄인다).
- **스위치**: `AGENT_API=off`(Pages 변수, 다시 배포). 에이전트 API(짧은 링크 지우기 제외)·발급이 503, 짧은 링크 지우기·목록·철회·받은함 읽기·지우기는 계속. 짧은 링크 전체를 멈추려면 기존 `SHARE_SHORT=off`.
- **D1**: `schema_meta`는 7로 남는다. 옛 코드(`SCHEMA_VERSION` 6)는 `version >= SCHEMA_VERSION`이라 문장을 다시 돌리지 않고, `agent_tokens`·`agent_inbox`는 남아 읽히지 않는다. 다시 새 버전으로 오면 이어 쓴다. 옛 코드에는 받은함 만료 정리가 없어 되돌린 동안 만료 행이 남는다(읽히지 않음).
- **되돌리는 순서**: ④ → ③ → ② → ①(병합의 역순). ③은 ②의 동기화 경로를, ②는 ①의 CLI 모듈을 쓴다. ②가 `src/server/meet/schema-sql.ts`·`src/server/library-sync/router.ts`·`library.ts`·`env.ts`·`src/server/share/handlers.ts`를, ③이 `SettingsPage.tsx`·`ShellRoute.tsx`·`SharePreview.tsx`·`add-place.ts`·`package.json`을 고친다.
- **③만 되돌리면**: 앱의 AI 연결·받은함 화면이 사라진다. 이미 만든 토큰은 만료까지 동작하고 받은함은 20개에서 막힌다. 막으려면 `AGENT_API=off`.
- **②까지 되돌리면**: `/api/agent/*`가 사라져 CLI `send`·`share`·`whoami`는 끝 코드 5. `build`는 그대로 된다. 에이전트가 만든 짧은 링크는 `share_links`에 있어 계속 열린다.
- **되돌린 사이에 `서버 자료 모두 지우기`를 한 계정의 에이전트 행**은 옛 코드가 지우지 않는다. 이 경우에만 사용자가 직접 정리한다(원격 D1 쓰기):
  `npx wrangler d1 execute landmark --remote --command "DELETE FROM agent_inbox WHERE user_id NOT IN (SELECT id FROM users); DELETE FROM agent_tokens WHERE user_id NOT IN (SELECT id FROM users)"`
- 각 PR 병합 뒤 태그를 붙이고 `docs/rollback.md`(버전 표, 「서버 로드맵」 절의 스위치 표·스키마 버전 표에 7·`AGENT_API`, 되돌리는 순서)를 별도 docs PR로 고친다.

## 단계(PR 4개)

| PR | 범위 | 서버 동작 | 릴리스 뒤 |
|---|---|---|---|
| ① CLI + 데이터 링크 | `pipeline/cli/trip.ts`, `pipeline/agent-trip/*`(`plan-schema`·`resolve-places`·`build-library`·`route-legs`·`summary`·`links`·`output`), `package.json` `trip` 스크립트, `src/server/search.ts`의 `searchNaverPlaces`, `src/services/id-gen.ts`의 `randomId` 내보내기. 명령 `build`·`--schema` | 변경 없음 | 태그, `docs/rollback.md` 버전 표 한 줄(✅ 저장 형식 그대로) |
| ② 서버 토큰·받은함·짧은 링크 API | 스키마 7, `src/server/agent/{router,auth,tokens,inbox,sync-routes}.ts`, `functions/api/agent/[[path]].ts`, `insertShareLink` 꺼내기, `readShareHash`의 `limits` 인자와 `AGENT_INBOX_LIMITS`, `ACCOUNT_DATA_TABLES`, `SyncEnv`. `deleteShareLink` 꺼내기. CLI `send`·`share`·`whoami`·`unshare`(`pipeline/agent-trip/{client,token,share-store}.ts`) | 새 경로·표 | 태그, 롤백 표·스위치 표·스키마 표 |
| ③ 앱 AI 연결·받은함 | `src/sections/agent/*`, `src/services/agent-inbox/*`, `AddFlow`·`AddPlaceHost`(`src/sections/add-place/AddPlaceHost.tsx`의 `StepView`가 `share` 단계에서 `inbox`도 `SharePreview`에 넘김)·`SharePreview`(`inbox` 속성 추가)·`SettingsPage`·`ShellRoute`, `build:ci` 조각 검사 | 없음 | 태그, 롤백 표(③만 되돌릴 때) |
| ④ 문서·스킬 | `docs/development.md`(AI 연결 절: 명령·`plan.json`·토큰·로컬 실행·API·한도), `README.md` 기능 목록 한 줄, 도움말 설정 메뉴 한 단계(필요하면), `docs/rollback.md` 정리. 저장소 병합 뒤 워크스페이스 스킬 연결(저장소 밖) | 없음 | 태그 |

②는 발급 화면(③)보다 먼저 나가므로 그 사이에는 토큰을 만들 수 없다(시험은 메모리 서버로 한다).

## 워크스페이스 스킬 연결 규약

`/Users/shinchoonho/01.workspace/.claude/skills/korea-trip-planner`가 지킬 것. 스킬 파일 수정은 ④ 병합 뒤 마지막 단계에서 한다.

1. **부르는 때**: 사용자가 "랜드마크로 보내줘"(받은함 → `send`), "랜드마크 링크로 공유해줘"(→ `share`), "랜드마크 링크만 만들어줘"(→ `build`)라고 할 때만. 계획서를 쓸 때 자동으로 부르지 않는다.
2. **장소**: 저장 목록 장소는 `naver_bookmarks.py` 결과의 `sid` → `naverSid`, `name`·`address`·`px`→`lng`·`py`→`lat`(숫자로 바꿈)을 대체 값으로 함께 넣는다. 신규 제안은 `search: { q, near }`(`near`는 근처 저장 장소 좌표), 후보 오류가 나면 후보 중 하나의 `naverSid`로 고쳐 다시 부른다. 못 찾으면 이름 + 좌표 핀. 집 주소는 넣지 않고 인근 역 같은 대표 지점을 쓴다.
3. **메모**: Stop `note`에 출처(`[네이버 저장]`·`[신규 제안]`)와 "확인 필요"를 짧게 남긴다(500자까지). 장소 `memo`는 저장 목록 메모만.
4. **실행**: `plan.json`은 세션 스크래치 폴더에 쓰고 `yarn --silent --cwd /Users/shinchoonho/01.workspace/01.repositories/landmark trip <명령> <절대 경로> --json`(`--silent`가 없으면 Yarn 1이 시작·종료 줄을 표준 출력에 섞어 JSON으로 읽을 수 없다). 먼저 `build`로 요약·경고를 사용자에게 보이고, 그다음 `send`·`share`.
5. **토큰**: 스킬은 토큰을 읽거나 출력하지 않는다. 끝 코드 4면 사용자에게 설정 › 동기화 › AI 연결에서 토큰을 만들어 키체인에 넣어 달라고 안내한다.
6. **결과 보고**: 받은함이면 "앱을 열면 「AI가 보낸 일정」 알림이 떠요", 짧은 링크면 링크와 기한, 추정 구간이 있으면 그 수와 조회 시각.

## 사용자가 할 일

새 외부 계정·키는 없다. 3단계 동기화 로그인이 되어 있어야 한다.

1. **출시(③) 뒤 토큰 발급**: 설정 › 동기화 › AI 연결 › `새 연결 만들기` → 토큰 복사 → 터미널에서 `security add-generic-password -U -s landmark-agent-token -a landmark.sch0718.dev -w`를 실행하고 프롬프트에 붙여 넣는다(만료·철회 뒤 새 토큰도 같은 명령, `-U`가 있던 항목을 바꾼다. 처음 쓸 때 macOS가 키체인 접근을 물으면 `허용`). 환경변수로 쓰려면 `LANDMARK_AGENT_TOKEN`을 셸에서만 설정하고 파일에 적지 않는다.
2. **확인**: `yarn trip whoami`.
3. **(선택) 끄기**: Cloudflare 대시보드 › Workers & Pages › `landmark` › Settings › Variables and Secrets에서 Production·Preview에 `AGENT_API` = `off` → 다시 배포.
4. **D1 반영**: 할 일 없음. 배포 뒤 첫 요청에서 `ensureSchema`가 표를 만든다. 확인만 하려면(읽기 전용) `npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta"` → `7`(미리보기는 `landmark-preview`).
5. **미리보기 확인**: 큰 일정 `send`의 CPU 시간(Workers 지표, `POST /api/agent/v1/inbox`).

## 시험

- 단위(vitest)
  - CLI(`// @vitest-environment node`, 바깥 요청은 가짜 `fetch`): `TripPlanSchema`(필수·모르는 필드·`key` 모양·날짜·`stayMin` 범위·출처 둘 이상), 의미 검사(없는 key·같은 장소 두 번·날 수·같은 sid·`legModes` 키) 오류 경로 문자열, 장소 조회(sid 성공·실패와 대체 값·`link` 폴더 거절·검색 하나·정확한 이름 하나·후보 여럿 `ambiguous`·결과 없음 핀), 보관함 만들기(연산 오류를 경로로 바꿈·`LibrarySchema` 통과), 구간(같은 지점·`routed`·`NO_ROUTE`·실패 → 앱 `use-trip-legs`와 같은 값, 같은 키 한 번만, `--no-routes`), 문서가 `ShareDocV2Schema`·`checkShareTrip`을 통과하고 `importLink` 값이 `readShareHash`(`AGENT_INBOX_LIMITS` 포함)로 같은 문서(경로선 제외)가 됨, 요청 키가 같은 계획·같은 메모 옵션의 재실행에서 같고 메모 옵션이 다르면 다름, 조회 뒤 출처 중복 `duplicate-source`(sid와 검색이 같은 장소), 참조 장소 없음 `no-places`, 좌표 범위 밖(핀·대체 값·구글 링크 결과) `out-of-range`, 가져오기 모의 실행 `item-too-large`(이름 긴 장소 경계값)·제목 30·31·60자에서 성공·같은 이름 50m 안 핀 두 개 `merged-places`, 이웃하지 않은 `legModes` 쌍 `leg-modes`, 50km 넘는 도보 지정 `walk-too-far`, 네이버 응답 지연 시간 초과(대체 값 사용·오류), 메모 기본값 세 명령, `too-big`, 요약 시각(`computeSchedule`), `--json` 모양과 끝 코드, 허용 밖 `--app` 거절, 토큰 출처(환경변수 > 키체인, `execFile` 가짜), 어떤 출력에도 토큰 문자열이 없음.
  - `searchNaverPlaces`·`resolveSearch`(응답 모양 그대로), `randomId`.
  - 서버(`node:sqlite` 가짜 D1 `createSqliteD1`, `createSyncMemoryServer`로 로그인): 스키마 7·멱등·6에서 올라감·`ALTER` 없음, 발급(원문 한 번·해시만 저장·10개 409·하루 20번·`AGENT_API=off` 503·`LIBRARY_SYNC=off` 503), 목록·철회(남의 것 404), `Origin` 있는 에이전트 요청 403, 토큰 모양·없음·만료·철회 401, 허용 목록에서 빠진 계정 403(카카오·Google 각각), 범위 403, 받은함(제목 61자·장소 이름 101자·실제 구간이 아닌 `legModes` 키(장소 100곳·구간 설정 6,700개 사례) 422, 토큰 9개에서 두 발급 경쟁 시 10개를 넘지 않음, 정상 201·같은 `key` 200(20개 찬 상태에서도, 19개 상태에서 같은 `key` 두 요청 경쟁 시 둘 다 같은 id)·만료된 같은 `key`는 새로 201·`readShareHash` 실패와 v1 문서 422·풀린 크기 1MB 넘음 422·본문 413·JSON 아님 400·20개 409·동시 두 요청이 20개를 넘지 않음·하루 50번 429·사용자 격리·만료 행은 읽히지 않음·정리), 짧은 링크 지우기(204·없음 404 `{ error: 'not-found' }`·틀린 삭제 토큰 403·`AGENT_API=off`에서도 되고 같은 스위치에서 whoami·inbox·share는 503·하루 200번), 출처 id 21자 sid `place-too-long`, 짧은 링크(정상·`deleteToken` 재시도 같은 id·`SHARE_SHORT=off`·`AGENT_API=off`·`/s/<id>`가 CLI 암호문을 연다), 토큰 실패 IP 한도, 마지막 사용 1시간 간격, `DELETE /v1/account`가 두 표를 지움, 로그 줄에 토큰·문서 없음.
  - CLI ↔ 서버: 메모리 서버의 `fetch`로 `send`·`share`·`whoami`·`unshare` 전체(`share` → 파일에 삭제 토큰·권한 600 → `unshare --list` → `unshare` → `/s/<id>` 404 → 파일에서 빠짐, 파일 쓰기 실패 경고, 출력에 삭제 토큰 없음, 옛 서버 404(JSON 아님)면 파일 항목을 남기고 끝 코드 5, 만료 안 된 200개에서 `share-store-full`로 서버를 부르지 않음, `share` 두 개와 `share`·`unshare`를 동시에 돌려도 항목을 잃지 않음. 발급 → 키체인 가짜 → 명령 → 받은함 목록).
  - 앱: 받은함 실행기(첫 실행·10분 간격·새 id만 알림·다른 사용자·실패 무시·401/403이면 확인을 멈추고 엔진 실행을 한 번 예약·같은 페이지 재로그인 뒤 다시 확인), 받은함 창(줄 문구·미리보기·읽기 실패·버리기 확인), 실제 `AddPlaceHost`를 거친 `SharePreview`의 받은함 머리·여행째 가져온 뒤 지우기·장소만 가져오면 남김·지우기 실패 알림·응답 사이 계정이 바뀌면 버림·가져오기 직전 계정 재확인, AI 연결 구역(로그인 없으면 숨김·목록 문구·만들기 창·원문 한 번·10개·`enabled`·`canCreate` 경우별 문구), 새로고침 없이 `다시 켜기` → `synced` → 받은함 알림.
- E2E(Playwright, desktop): `agent-inbox.spec.ts` — `installSyncServer`(`tests/e2e/sync-server.ts`)에 `/api/agent/**`를 더해 가짜 카카오 로그인 → AI 연결 만들기 → 시험 코드가 그 토큰으로 `POST /api/agent/v1/inbox` → 새로고침 → 알림 → 미리보기 → 가져오기 → 여행 화면 → 받은함 비었음 → 철회 → 같은 토큰 401.
- 미리보기: 실제 계정으로 발급 → `yarn trip send --app <미리보기 주소>` → 휴대폰에서 알림·가져오기 → 다른 기기에 동기화. `share` 링크를 카카오톡으로 열기. CPU 시간.

## 완료 조건

- 위 시험 통과, `yarn typecheck`·`yarn lint`·`yarn test`·`yarn build:ci`(크기·나눔 검사 포함) 통과.
- 로컬에서 실제 키 없이 `yarn dev:sync`(+ 가짜 로그인)로 토큰 발급 → `yarn trip send plan.json --app http://localhost:8795` → 앱 알림 → 가져오기 → 다른 출처(`127.0.0.1`)에 동기화까지 화면으로 된다. `yarn trip share … --app http://localhost:8795`의 짧은 링크가 같은 서버의 `/s/<id>`에서 열린다.
- `yarn trip build tests/fixtures/agent-trip/plan.json --no-routes`(새 시험 고정 파일. `trips/*`는 `.gitignore` 대상이라 두지 않는다)이 서버 없이 데이터 링크를 내고, 그 `/import#d=` 링크로 앱이 같은 여행을 가져온다.
- ④에서 `docs/development.md`·`README.md`·(필요하면) 도움말을 고치고, 각 PR 뒤 `docs/rollback.md`를 갱신한다. 워크스페이스 스킬 연결은 마지막.

## 결정 기록

| 날짜 | 항목 | 결정 |
|---|---|---|
| 2026-11-01 | 에이전트가 만든 짧은 링크 철회 | **B안**: 삭제 토큰을 `~/.landmark/agent-shares.json`(600)에 두고 `yarn trip unshare`로 지운다(PR ②). 비교한 안: A. 기한까지 철회 없음, C. 서버가 토큰별 링크를 기록해 설정에서 지우기 |
