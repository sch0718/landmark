# AI 에이전트 일정 보내기(`yarn trip`) 설계

AI 에이전트(Claude Code 등)가 사람 손 없이 여행 일정을 만들어 ① 내 보관함으로 보내거나(받은함 경유) ② 남에게 보낼 공유 링크(데이터 링크 `/view#d=`, 짧은 링크 `/s/<id>`)를 만든다.
에이전트는 이 저장소의 TS CLI `yarn trip`에 계획 파일(`plan.json`)을 넘기고, CLI는 앱 코드를 그대로 가져다 앱과 같은 공유 문서(`ShareDocV2`)를 만들고 같은 검사를 통과시킨다.
서버는 3단계 [보관함 동기화](2026-10-29-library-sync-design.md)의 로그인 사용자 위에 **AI 연결 토큰**과 **받은함**을 더하고, 짧은 링크는 [공유 짧은 링크](2026-10-28-share-short-link-design.md)의 저장소를 그대로 쓴다.

- 작성일: 2026-11-01
- 상태: 구현 완료(PR ① #83·② #85·③ #87, v0.27.0). 아래 「구현 뒤 바뀐 점」과 본문은 구현 기준으로 고쳤다.
- 기준: 설계 당시 `main` `bc055d6`(`v0.24.2`), 갱신 기준 `main` `0b6a2c4`(`v0.27.0`). D1 `SCHEMA_VERSION` 6 → **7**.

## 결정 요약(사용자 확정)

| 항목 | 결정 |
|---|---|
| CLI | 이 저장소의 `yarn trip …`(`tsx`, `src/*` 별칭으로 앱 코드 재사용). 명령은 `build`·`send`·`share`·`whoami`, 모두 `--json` 출력. 짧은 링크 철회용 `unshare`(2026-11-01 사용자 결정, 아래 B안) |
| 입력 | AI가 쓰기 쉬운 `plan.json`(제목·기간, 장소 목록, Day별 방문 순서·시각·머무는 시간·메모). Effect Schema로 정의하고, 오류는 경로와 이유를 구체적으로 낸다 |
| 장소 | 네이버 저장 sid 또는 네이버 장소 ID가 기본. 신규 제안 장소는 네이버 검색으로 장소 ID를 찾고, 못 찾으면 이름 + 좌표 핀 |
| 경로 | CLI가 구간마다 네이버 길찾기를 묻고, 실패한 구간은 `estimated`(앱과 같은 직선 추정) |
| 문서·검사 | 앱과 같은 `buildTripShareDoc` → `ShareDocV2Schema` + `checkShareTrip` → 모의 가져오기·동기화 항목 상한 검사. 서버도 새 받은함 문서를 사전 검사 뒤 같은 스키마·관계 검사와 모의 가져오기로 검사한다 |
| 보내는 곳 | ① `send`: 내 받은함(앱에서 미리보기 뒤 `가져오기`) ② `share`: 짧은 링크 `/s/<id>#k=` ③ `build`: 서버·토큰 없이 `/view#d=`·`/import#d=` 링크 |
| AI 연결 토큰 | 동기화에 로그인한 허용 계정이 설정 › 동기화 › `AI 연결`에서 발급. 범위는 `inbox:write`·`share:create`뿐(보관함 읽기·쓰기 없음). 원문은 한 번만 보이고 서버는 해시만 둔다. 90일 만료, 목록·철회 |
| 토큰 검사 | 요청마다 허용 계정 재확인, 사용자별 하루 한도(`rate_counters`). Turnstile·출처 검사 대신 토큰. CORS는 열지 않는다 |
| 서버 | D1 스키마 7(`agent_tokens`·`agent_inbox`, 받은함 30일 보관). API `/api/agent/v1/inbox`·`/share`·`/whoami`. 발급·목록·철회와 앱의 받은함 읽기는 동기화 세션 경로(`/api/sync/v1/agent/…`) |
| 짧은 링크 | CLI가 브라우저와 같은 방식(AES-GCM, 키는 `#k=`)으로 암호화해 올린다. 서버는 내용을 못 본다. 기존 `share_links` 표·보관 기간 재사용 |
| 앱 받은함 | 로그인한 기기의 동기화 실행이 `synced`·`conflict`로 끝날 때, 보이는 탭에서 10분 간격으로 확인 → 알림 「AI가 보낸 일정 N개」 → 미리보기(기존 공유 가져오기 화면) → `가져오기`/`버리기`. 가져온 여행은 동기화로 다른 기기에 퍼진다 |
| 비상 스위치 | `AGENT_API=off`. 로그에 문서·토큰을 남기지 않는다 |
| 워크스페이스 스킬 | `korea-trip-planner`가 사용자가 "랜드마크로 보내줘"라고 할 때만 `plan.json`을 만들고 `yarn trip`을 부른다. 이 문서에는 연결 규약만 적고 스킬 수정은 마지막 단계 |
| 단계 | PR 4개: ① CLI + 데이터 링크(서버 동작 변경 없음) ② 서버 토큰·받은함·짧은 링크 API(스키마 7) + CLI `send`·`share`·`whoami` ③ 앱 AI 연결 설정·받은함 화면 ④ 문서·스킬 연결. 각 PR 뒤 릴리스와 `docs/rollback.md` 갱신 |

### 세부 결정과 근거(설계자가 정함, 사용자 검토용)

아래 정한 것은 구현 기준이다. 설계 때의 근거는 남기고, 달라진 점은 「구현 뒤 바뀐 점」에 모았다.

| 열린 결정 | 정한 것 | 근거 |
|---|---|---|
| CLI 코드 위치 | 진입점 `pipeline/cli/trip.ts`(새 파일), 모듈은 `pipeline/agent-trip/`(새 폴더). `package.json`에 `"trip": "tsx pipeline/cli/trip.ts"` | `pipeline/`은 이미 `tsx`·`src/*` 별칭으로 돌고(`yarn collect`), `tsconfig.app.json`의 `include`·`eslint`·`vitest`가 덮는다. 새 최상위 폴더는 설정 세 곳을 더 고쳐야 한다 |
| 문서를 만드는 길 | `plan.json` → 메모리 보관함(`emptyLibrary` + 앱 연산) → `buildTripShareDoc` | 공유 문서의 장소 순서·숙소·후보·`legModes` 규칙을 다시 만들지 않는다. 앱 연산(`createTrip`·`insertStop` 등)이 제목·날짜·Stop 한도를 이미 검사한다 |
| 경로 조회 | 서버 코드 `resolveRoute`(`src/server/route.ts`)를 Node에서 직접 부른다. 구간 수단은 앱 규칙(`legBetween`: 직선 800m 이하 도보, 사람이 고른 `legModes` 우선) | 앱과 같은 시간·거리·경로선(200점)·`queriedAt`이 나온다. 옛 `pipeline/naver-client.ts`의 `fetchCarRoute`·`pipeline/legs.ts`·`pipeline/route-cache.ts`는 옛 `trip-data` 모양(`durationMs`, `failed`)이라 쓰지 않는다. 디스크 캐시는 두지 않는다(결과는 조회 시각 교통 기준이고 `queriedAt`에 남는다) |
| 장소 조회 | `naverSid` → `fetchPlaceSummary`(`pipeline/naver-client.ts`), `link` → `resolveLink`(`src/server/resolve.ts`, 네이버·카카오·구글 링크), `search` → 새 `searchNaverPlaces`(`src/server/search.ts`) | 앱 `/api/place`·`/api/search`가 쓰는 같은 함수다. 배포된 API는 출처 검사가 있어 CLI가 부를 수 없으므로 코드를 직접 쓴다 |
| 검색으로 장소 ID 찾기 | 새 명령을 두지 않고 `plan.json` 장소의 `search: { q, near? }`로 받는다. sid가 있는 결과의 이름을 `name`(생략하면 `search.q`)과 NFC·공백 제거·소문자로 맞춰 비교한다. 정확히 같은 곳이 하나뿐이거나 결과가 하나뿐이면 그 sid를 쓰고, 여럿이면 후보(최대 5곳: sid·이름·주소·분류)를 오류로 돌려준다. 결과가 없고 `lng`·`lat`이 있으면 핀 | 명령은 사용자가 정한 넷으로 둔다(설계 당시 근거이며, 이후 철회용 `unshare`가 추가됐다). AI는 후보 오류를 보고 `naverSid`로 고쳐 다시 부른다. 네이버 자동완성 응답의 `id`가 장소 sid다(2026-11-01 확인: `초당순두부마을` → `id`·`sid` `31506191`) |
| 메모 포함 기본값 | `send`는 장소 메모를 넣는다(`--no-memo`로 뺌). `build`·`share`는 빼고 `--memo`일 때만 넣는다 | 받은함은 본인 보관함이다. 짧은 링크·데이터 링크는 남에게 간다. 앱 공유와 같이 이 옵션은 장소 `memo`만 좌우하고, Day 메모(Stop `note`)는 늘 들어간다(`buildTripShareDoc` 규칙) |
| 받은함 저장 값 | `/import#d=`의 값 그대로(경로선 뺀 `hashDoc` 사본을 압축한 base64url, 32,000자 이하). CLI는 장소 라벨도 만들지 않는다. 서버는 한 번만 풀어 `agentRawProblem` → `validateShareValue`로 v2를 검사하고 라벨·경로선을 거절한다. `AGENT_INBOX_LIMITS`는 `fileBytes` 5,242,880·`hashChars` 32,000·`decodedBytes` 393,216(384KB)·`places` 200이다 | 앱은 이 값을 기존 `/import#d=` 진입과 같은 함수로 읽어 미리보기를 연다. 값 길이(`MAX_HASH_CHARS` 32,000자)와 요청 크기(`SHARE_REQUEST_MAX_BYTES`)는 그대로 쓰고, 서버 CPU 때문에 풀린 크기·장소 수만 `AGENT_INBOX_LIMITS`로 줄인다(아래 보안). 받은함은 동기화와 같은 일반 저장이다(서버 운영자가 읽을 수 있다). 구현에서는 대량 스키마 오류와 라벨별 모의 가져오기 비용을 줄이려고 사전 검사·384KB 상한을 적용했다 |
| 같은 일정 두 번 | CLI가 요청 키 `key` = SHA-256(키 정렬 JSON `[plan 해석 결과, 메모 포함 여부, --no-routes 여부]`)의 base64url(43자)을 함께 보낸다. 서버는 사용자별로 만료되지 않은 같은 `key`가 있으면 문서 검사 전에 그 항목을 `200 created: false`로 돌려준다. 중복 방지는 그 항목이 받은함에 남아 있는 동안만이며, 가져오기·버리기로 지운 뒤나 만료 뒤 다시 보내면 새 항목이 생긴다 | 문서 `d`는 실행마다 바뀐다(`createdAt`, 무작위 장소·Stop id, 경로 `queriedAt`). 그래서 `d`의 해시로는 같은 계획의 재실행을 알 수 없다. 응답을 잃고 다시 부른 AI가 받은함을 채우지 않는다(짧은 링크 `delete_hash` 재시도와 같은 방식). `key`는 권한 근거가 아니라 본인 받은함의 중복 판단에만 쓴다. 구현에서는 경로 조회 생략 여부가 다른 전송을 구분하도록 키에 넣었다 |
| 받은함 한도 | 사용자당 기다리는 항목 20개, 30일 보관. 넘으면 `409 inbox-full` | 사람이 확인하는 상자라 많을 필요가 없다. 프롬프트 주입으로 AI가 엉뚱한 일정을 보내도 쌓이는 양이 작다 |
| 토큰 모양·저장 | 원문 `lmk_` + 32바이트 base64url(47자). D1에는 `hashToken`(SHA-256 base64url)만. 공개 id 12자로 목록·철회 | 접두가 있어 비밀 검사 도구가 찾는다. 짧은 링크 삭제 토큰과 같은 해시 함수다 |
| 토큰 수·이름 | 사용자당 살아 있는 토큰 10개, 이름 1~40자(기본 `Claude Code`), 범위는 둘 중 하나 이상(기본 둘 다) | 도구·기기별로 나눠 철회할 수 있게 한다 |
| 만료 | 발급 뒤 90일 고정(사용해도 늘지 않음). CLI는 14일 이하로 남으면 경고 | 슬라이딩 만료면 잊힌 토큰이 계속 산다 |
| 마지막 사용 시각 | 1시간에 한 번만 갱신 | D1 쓰기를 줄인다(동기화 `DEVICE_TOUCH_MS`와 같은 간격) |
| 브라우저 요청 | 에이전트 API는 `Origin` 헤더가 있으면 `403 origin` | 브라우저에서 부를 이유가 없다. CORS를 열지 않으므로 다른 사이트는 응답을 읽지 못하고, 이 규칙으로 앱 출처 안의 스크립트도 막는다 |
| CLI가 토큰을 보낼 곳 | `isAllowedOrigin`(운영·Pages·미리보기) 또는 `http://localhost:*`·`http://127.0.0.1:*`만. 그 밖의 `--app`은 거절 | 프롬프트 주입으로 바뀐 주소에 토큰을 보내지 않는다 |
| 짧은 링크 철회(사용자 결정 B안, 2026-11-01) | `share`는 서버를 부르기 전에 삭제 토큰이 든 `pending:<uuid>` 예약을 `~/.landmark/agent-shares.json`에 남기고, 성공 뒤 실제 id로 바꾼다. 형식 `{ "v": 1, "items": [{ "app": "https://landmark.sch0718.dev", "id": "<16자 또는 pending:uuid>", "deleteToken": "<43자>", "title": "…", "createdAt": "<ISO>", "expiresAt": "<ISO>" }] }`. 새 폴더만 권한 700으로 만들고 기존 폴더 권한은 바꾸지 않는다. 파일은 600, 임시 파일에 쓰고 `rename`한다. 만료된 항목을 빼며 예약도 200개 상한에 센다. 가득 차면 서버를 부르기 전에 끝 코드 2 `share-store-full`로 멈춘다. 알려진 서버 거절이면 예약을 지우고, `timeout`·`offline`·알 수 없는 응답 `server`이면 링크 기한까지 남긴다. 읽기·수정·교체는 `agent-shares.lock`(`open(…, 'wx')`, 50ms 간격·5초 제한)으로 묶고, 30초 넘은 잠금은 `.takeover` 회수 잠금 안에서 inode·dev·시각을 재확인해 지운다. 시험용 폴더는 `LANDMARK_TRIP_HOME`. `unshare --list`는 예약에 `unknown: true`를 붙인다. `unshare <id>`는 같은 앱의 링크를 지우고, `unshare pending:<uuid>`는 같은 삭제 토큰으로 링크 id를 회수한 뒤 지운다(아래 CLI). **PR ②**에 들어갔다 | 삭제 토큰은 만든 쪽만 가진다(브라우저의 `tripmap:share-links:v1`과 같은 모델). 기존 `DELETE /api/share/:id`는 허용 출처 검사(`withRequest`)가 있어 CLI가 부를 수 없으므로 토큰 경로를 둔다. 서버에 소유 기록 표를 더하지 않는다. 응답을 잃어도 철회할 수 있도록 구현에서는 성공 전 예약을 남긴다 |
| 토큰 보관(CLI) | 비어 있지 않은 환경변수 `LANDMARK_AGENT_TOKEN`이 있으면 그것만 검사한다. 모양이 틀려도 키체인으로 넘어가지 않는다. 없거나 빈 값이면 macOS(`darwin`)에서만 `security find-generic-password -s landmark-agent-token -a <앱 호스트> -w`(셸 없이 `execFile`). 계정은 `new URL(app).host`(포트 포함) | 키체인 계정을 앱 호스트로 나눠 운영·로컬 토큰이 섞이지 않는다. 틀린 환경변수가 다른 토큰으로 조용히 대체되지 않게 한다 |
| 받은함 확인 시점 | 부트 플래그가 있으면 실행기를 붙이고, 없으면 `syncStatusAtom`의 `synced`·`conflict`에서 붙인다. 확인은 동기화 실행이 `synced`·`conflict`로 끝날 때, 숨겨지지 않은 탭에서 확인 시작 시각 기준 10분에 한 번까지 한다 | 동기화는 저장 2초 뒤에도 돈다. 매번 묻으면 요청이 많다. 자동 백업과 같은 `onRunFinished` 길을 쓴다. 구현에서는 충돌 상태도 확인하고 숨긴 탭의 요청을 줄인다 |
| 알림 반복 | 기기 키 `tripmap:agent-inbox:v1`에 직전 확인 목록의 id(최대 100개)를 두고, 목록에 새 id가 있을 때 받은함 전체 항목 수로 알림 | 같은 항목으로 열 때마다 알리지 않는다 |
| `버리기` | 확인 대화상자 뒤 서버에서 지운다 | 지운 항목은 되살릴 수 없다 |
| `AGENT_API=off` 범위 | 토큰으로 부르는 에이전트 API(`whoami`·받은함 올리기·짧은 링크 만들기)와 새 토큰 발급이 503 `off`. 예외로 짧은 링크 지우기(`DELETE /api/agent/v1/share/:id`, 경로 속성 `allowWhenOff`)와 토큰 목록·철회, 앱의 받은함 읽기·지우기는 계속 된다 | 다른 스위치와 같이 새 자료만 막고, 이미 받은 일정과 철회는 남긴다. 단, 결과를 모르는 `pending:<uuid>` 복구는 만들기 API를 거쳐 이 스위치에서 실패한다 |
| `SHARE_SHORT=off`와의 관계 | 에이전트 `share`와 `pending:<uuid>` 복구도 막는다(503 `off`) | 짧은 링크 저장소의 스위치가 하나로 모인다 |

## 하지 않는 것

- **갱신 링크(`/view#t=`, 2A)와 보관함 직접 쓰기.** 토큰으로는 보관함을 읽지도 고치지도 못한다. 일정은 받은함을 거쳐 사람이 `가져오기`를 눌러야 들어간다.
- 함께 편집(2B) 초대, 약속 만들기, 장소만 담은 v1 공유 문서.
- 앱의 `보낸 짧은 링크` 목록에 에이전트 링크 넣기, 다른 컴퓨터에서 철회하기. 에이전트 링크는 그 링크를 만든 컴퓨터의 `yarn trip unshare`로만 지울 수 있고(삭제 토큰이 그 컴퓨터에만 있다), 그 밖에는 기한(30~180일)이 지나면 열 수 없다. 만료 행은 새 링크 만들기·링크 열기 때 최대 20개씩 비동기로 정리하며, 삭제 완료 시점은 보장하지 않는다.
- 장소 라벨 지정. CLI는 라벨·라벨 참조를 만들지 않고, 서버는 받은함 문서의 라벨·경로선을 `labels`·`path`로 거절한다(스키마·모의 가져오기 CPU 제한). `/import#d=`에는 `hashDoc`이 경로선을 뺀다. 보기용 문서에는 경로선이 있을 수 있다. 가져올 때 기존 화면의 `제목 라벨`이 붙는다.
- 받은함 알림의 푸시·이메일·셸 머리 아이콘. 동기화가 꺼진 기기의 자동 확인(설정 › AI 연결 줄에서 직접 볼 수는 있다).
- 경로 디스크 캐시, 대중교통 구간, 영업시간 확인.
- 새 외부 계정·키·새 `VITE_` 빌드 변수.

## 사용 흐름

### 처음 연결(사람, 한 번)

1. 설정 › `동기화`에 로그인한 상태에서 같은 절의 `AI 연결` → `새 연결 만들기`.
2. 이름(`Claude Code`)과 권한(`받은함으로 일정 보내기`·`공유 짧은 링크 만들기`, 기본 둘 다)을 고르고 `만들기`.
3. 토큰 원문이 한 번만 보인다: `복사` 단추, 키체인에 넣는 명령 예(`security add-generic-password -U -s landmark-agent-token -a landmark.sch0718.dev -w` — `-U`는 있던 항목을 바꾸고, `-w`를 맨 끝에 두어 값은 입력 프롬프트에 붙여 넣어 셸 기록에 남지 않게), 안내 "이 창을 닫으면 다시 볼 수 없어요. 잃어버렸다면 철회하고 새로 만들어 주세요".
4. 터미널에서 `yarn trip whoami` → 다음 네 줄(만료 시각은 ISO 문자열).

   ```text
   AI 연결: Claude Code
   범위: inbox:write, share:create
   만료: 2027-01-30T05:12:00.000Z
   공급자: kakao
   ```

### 에이전트가 일정을 보낼 때

1. 에이전트가 `plan.json`을 쓴다(아래 형식).
2. `yarn --silent trip build plan.json --json`으로 검사·요약·데이터 링크를 받는다(서버·토큰 불필요). 오류면 경로와 이유를 보고 고쳐 다시 부른다.
3. 사용자가 원하는 대로:
   - `yarn --silent trip send plan.json --json` → 받은함 항목 id와 만료일.
   - `yarn --silent trip share plan.json --json` → `https://landmark.sch0718.dev/s/<id>#k=<키>`와 기한, 보조로 긴 `/view#d=` 링크.

### 앱에서 받기

1. 동기화가 켜진 기기에서 실행이 `synced`·`conflict`로 끝나고 탭이 보이면 받은함을 확인한다(확인 시작 시각 기준 10분 간격). 새 항목이 있으면 알림 「AI가 보낸 일정 N개」와 `보기`.
2. `보기` → `AI가 보낸 일정` 창(지연 로딩): 줄마다 제목 · `11월 20일~22일` · `장소 12곳` · 보낸 연결 이름 · 받은 때, 단추 `미리보기`·`버리기`. 설정 › 동기화 › AI 연결의 `받은 일정 N개 · 보기`로도 연다. 창이 비었으면 `받은 일정이 없어요`를 보인다.
3. `미리보기` → 항목 값을 `readShareHash`로 읽어 기존 공유 가져오기 화면(`SharePreview`)을 연다. 머리에 `AI 연결 「Claude Code」가 보낸 일정`이 붙는다(이름에 맞춰 `이`·`가`를 고르고, 이름이 없으면 `이름 없는 연결`). 같은 여행이 이미 있으면 지금처럼 `sameTripExists` 경고가 보인다.
4. 여행째 `가져오기`가 성공하면 창이 닫혔더라도 받은함 항목을 서버에서 지운다. 여행 스위치를 끄고 장소만 가져오거나 가져오기 전에 창을 닫으면 항목은 남는다. 가져온 장소·여행은 보관함 저장이라 동기화로 다른 기기에 퍼진다.
5. `버리기` → 제목 "이 일정을 버릴까요?", 본문 "「일정 제목」 · 되살릴 수 없어요" → 지움.

### 철회

설정 › 동기화 › AI 연결 목록의 `철회`. 그 토큰의 다음 요청부터 `401 token-revoked`. 이미 받은함에 들어온 항목과 만든 짧은 링크는 그대로다. `서버 자료 모두 지우기`(3단계)는 토큰과 받은함도 지운다.

## 계획 파일(`plan.json`) v1

Effect Schema `TripPlanSchema`(`pipeline/agent-trip/plan-schema.ts`)로 정의한다. `yarn trip --schema`가 `Schema.toJsonSchemaDocument`로 만든 JSON Schema(draft 2020-12, `key`·`naverSid`·날짜·`HH:mm`의 `pattern`과 설명 포함)를 출력해 에이전트가 참고한다. 날짜 정규식은 모양의 근사 표현이며 실제 달력 날짜는 해석 때 더 엄격히 검사한다. 모르는 필드는 거절한다(`onExcessProperty: 'error'`).

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
| `places[]` | 1~200곳. `key`는 `^[A-Za-z0-9_-]{1,40}$`이고 겹치지 않는다. 출처는 `naverSid`(숫자 1~20자 문자열)·`link`·`search` 중 하나 이하. 셋 다 없으면 핀이라 `name`·`lng`·`lat`이 필수. 출처가 있을 때 `name`·`address`·`lng`·`lat`은 조회 실패 때의 대체 값이며, `search`에서는 `name`이 후보 이름 비교 기준이기도 하고 생략하면 `search.q`로 비교한다. 좌표(`lng`·`lat`·`search.near`)는 보관함·공유 스키마의 `Lng`·`Lat`(`src/schema/common.ts`: 경도 124~132, 위도 33~39)와 같은 범위. `search.near`는 `[경도, 위도]`이며 생략하면 서울시청 부근 `[126.9784, 37.5666]` 기준이므로 지방 장소는 여행지 근처 좌표를 준다. `name` 1~100자, `address` 200자까지, `memo` 10,000자까지(`memoChars`) |
| `days[]` | 기간의 날 수와 같은 개수. `startTime`(`HH:mm`, 기본 `09:00`), `lodging`(장소 key 또는 `null`, 마지막 날은 도착지), `stops[]` |
| `stops[]` | `place`(key), `stayMin`(0~1440 정수 또는 `null` = 앱 기본값), `fixedTime`(`HH:mm` 또는 `null`), `note`(500자까지) |
| `origin` | 1일차 출발지 key 또는 `null` |
| `candidates` | 아직 Day에 넣지 않은 후보 key |
| `legModes` | `"<key>><key>"` → `car`·`walk`. 그날 이웃한 두 점(출발점·Stop·숙소 순서의 실제 구간)인 쌍만 허용하고, 아니면 입력 오류 `leg-modes`. 없으면 앱 자동 규칙 |

장소 `name`·`memo`·`search.q`는 스키마 검사 뒤 앞뒤 공백을 뺀다. 빈 이름·검색어는 해당 경로의 `schema` 오류다. `search.q`는 1~40자, `link`는 1~2,000자다.

의미 검사(스키마 다음, 장소 조회 전): 없는 key 참조, 여행 안 같은 장소 두 번(Stop·후보 — 출발지·숙소는 겹쳐도 됨), 날 수 불일치, 같은 네이버 sid 두 번, `legModes` 키 모양. 장소 조회 뒤에 출처 중복을 한 번 더 본다(아래 처리 순서 2). 여행이 참조하는 장소(출발지·숙소·Stop·후보)가 하나도 없으면 오류 `no-places`(경로 `days`, 끝 코드 2): `buildTripShareDoc`이 참조한 장소만 담아 `checkShareTrip`의 "장소가 하나도 없어요"에 걸리기 때문이다. 선언한 모든 장소는 참조 여부와 상관없이 입력·조회·중복 검사를 통과해야 하고, 그중 참조하지 않는 장소만 경고 `unused-place` 뒤 문서에서 뺀다(`buildTripShareDoc`가 쓰는 장소만 담는다).

## CLI(`yarn trip`)

```
yarn --silent trip build <plan.json> [--memo] [--no-routes] [--out <doc.json>] [--app <주소>] [--json]
yarn --silent trip send  <plan.json> [--no-memo] [--no-routes] [--app <주소>] [--json]
yarn --silent trip share <plan.json> [--memo] [--no-routes] [--app <주소>] [--json]
yarn --silent trip whoami [--app <주소>] [--json]
yarn --silent trip unshare <id|pending:uuid> [--app <주소>] [--json]
yarn --silent trip unshare --list [--app <주소>] [--json]
yarn --silent trip --schema [--json]
```

- 앱 주소: `--app` > `LANDMARK_APP_URL` > `DEFAULT_APP_URL`(`https://landmark.sch0718.dev`, `src/share-viewer/encode.ts`). `appUrl()`로 끝 `/`를 뗀다. 토큰을 쓰는 명령은 위 결정 표의 허용 출처만 받는다.
- 서버 요청(`send`·`share`·`whoami`·`unshare`)은 본문 수신까지 15초 제한, 자동 재시도는 하지 않는다. 시간 초과는 끝 코드 5 `timeout`. 다시 부르면 `send`는 같은 요청 키의 만료되지 않은 항목이 받은함에 남아 있는 동안 하나만 남는다(가져오기·버리기로 지운 뒤나 만료 뒤 다시 보내면 새 항목이 생긴다). `share`는 새 암호문·삭제 토큰으로 새 링크를 만든다(결과를 모르는 앞 링크는 예약으로 남아 `unshare pending:<uuid>`로 회수·삭제할 수 있다).
- `--no-routes`: 길찾기를 묻지 않고 같은 지점(`same-point`)을 제외한 구간을 직선 추정(`estimated`)으로 둔다(오프라인·시험용).

- 계획 파일·`--out`의 상대 경로는 `INIT_CWD`(Yarn을 부른 폴더) 기준이며, 없으면 현재 작업 폴더 기준이다. `--out` 쓰기 실패는 경로 `--out`·코드 `schema`·끝 코드 2다.
- `--schema`는 `--json`만 함께 받을 수 있고, 다른 명령·옵션과 함께 쓰면 끝 코드 2다. `--help`는 없다(모르는 옵션은 `schema` 오류).

### 처리 순서(`build`·`send`·`share`)

1. **읽기·검사**: `TripPlanSchema` 해석 → 의미 검사. 실패는 모두 모아 한 번에 낸다.
2. **장소 조회**(`pipeline/agent-trip/resolve-places.ts`, 새 파일): 차례로, 외부 조회가 필요한 장소 항목(`naverSid`·`link`·`search`) 사이에 300ms 대기한다. 한 장소를 해석하는 내부 요청(예: 짧은 링크 리다이렉트 뒤 장소 조회) 사이에는 별도 대기가 없다. 모든 요청은 `makeRequester`(`src/server/request.ts`, 본문 수신까지 8초 제한)로 감싼다. `fetchPlaceSummary`는 그 자체로 시간 제한이 없으므로 `src/server/resolve.ts`의 내보낸 `httpDeps(request)`로 요청기를 `fetch`로 주입한다. 시간 초과는 조회 실패와 같게 다룬다. 조회 결과(특히 `resolveLink`의 구글 링크는 전 세계 좌표를 줄 수 있다)도 `Lng`·`Lat` 범위와 출처 id를 다시 보고, 벗어나면 대체 값이 있어도 그 장소 경로의 입력 오류 `out-of-range`(끝 코드 2)로 낸다. 조회 결과의 너무 긴 이름·주소는 100자·200자로 자르고 `out-of-range` 경고를 낸다. `naverSid` → `fetchPlaceSummary`(이름·주소·좌표·분류), `link` → `resolveLink`(네이버·카카오·구글 장소. 폴더 링크는 오류), `search` → `searchNaverPlaces`(`name`을 후보 이름 비교 기준으로 쓰고, 생략하면 `search.q`로 비교한다. NFC·공백 제거·소문자 정규화와 후보 선택 규칙은 위 결정 표). 요청이 실패하면 대체 값(`name`·`lng`·`lat`)이 있을 때 그것으로 쓰고 `lookup-failed` 경고, 없으면 오류다. 폴더 링크·검색 후보 여럿처럼 결과로 돌려준 오류는 대체 값으로 덮지 않는다. 출처는 `{ kind: 'naver', sid }`·`kakao`·`google`·`pin`. 조회가 끝나면 `sourceKey`(`src/domain/library/add-place.ts`)로 다시 겹침을 본다. `naverSid`와 `link`·`search`가 같은 네이버 장소로 풀리는 경우처럼 두 key가 같은 출처면 `LibrarySchema`의 출처 중복 검사에 걸리므로, 합치지 않고 뒤에 나온 장소 경로(예: `places[3]`)에 오류 `duplicate-source`를 붙이고 메시지로 앞 경로(예: `places[1]`)를 알린다. AI가 한 key로 합쳐 다시 부른다.
3. **보관함 만들기**(`pipeline/agent-trip/build-library.ts`, 새 파일): `emptyLibrary()`에 `newPlace`(`src/domain/library/add-place.ts`)로 장소를 넣고, `createTrip`(`origin`·`candidates` 포함) → Day마다 `insertStop` → `setStopStay`·`setStopFixedTime`·`setStopNote` → `setLodging`(`alsoFollowingDays: false`) → `setDayStartTime` → `setLegMode`. id는 `src/services/id-gen.ts`의 내보낸 `randomId`. 연산이 `ok: false`면 해당 `plan.json` 경로로 바꿔 오류. 마지막에 `LibrarySchema`로 검사한다.
4. **구간 시간**(`pipeline/agent-trip/route-legs.ts`, 새 파일): 모든 Day의 `dayLegs`를 모아 `routeOf(leg)`를 만든다. 앱 일정 공유 창(`src/sections/share-export/use-trip-legs.ts`)과 같은 규칙이다.
   - 직선 `SAME_POINT_M`(10m) 미만 → `same-point`(0초·0m).
   - `routeInputKey`를 `parseRouteInputKey`로 풀어 소수 5자리로 맞춘 좌표의 `resolveRoute(query, { fetch })` 성공 → `routed`(시간·거리·통행료·경로선·`queriedAt`).
   - `NO_ROUTE` → `no-route`, 그 밖 실패 → `estimated`. 둘 다 `estimateLeg(leg.mode, leg.straightM)` 값, 경로선·조회 시각 없음.
   - 같은 입력 키(`routeInputKey`)는 한 실행에서 한 번만 묻는다. 중복을 뺀 구간의 `resolveRoute` 호출 사이에 300ms 대기한다. 같은 지점과 `--no-routes`는 조회·대기하지 않는다. `resolveRoute`는 `makeRequester`로 8초 제한이 있고, 시간 초과는 `estimated`.
   - `legModes`에서 `walk`를 골랐는데 두 장소의 직선거리가 `WALK_MAX_M`(50km)을 넘으면 `setLegMode`가 조용히 무시하고 `legBetween`이 자동차로 본다. CLI는 장소 조회 뒤(3단계 전에) 이를 입력 오류 `walk-too-far`(경로 `legModes["a>b"]`, 끝 코드 2)로 낸다.
5. **문서**: `buildTripShareDoc(lib, tripId, routeOf, { title, includeMemo, includeCandidates: true, now })` → `ShareDocV2Schema`(`onExcessProperty: 'error'`) → `checkShareTrip`. 여기서 걸리면 CLI 결함이므로 `internal` 오류로 낸다.
5-1. **가져오기 모의 실행**: `importSharedTrip(emptyLibrary(), hashDoc(doc), { titleLabel: defaultTitleLabel(doc.title), appendMemo: true }, ctx)`(화면 `SharePreview`의 기본값과 같은 제목 라벨. 라벨 이름은 30자 한도라 60자 제목을 그대로 넘기면 `LabelNameInvalid`)로 앱이 가져올 결과를 만들고, 연산이 `ok: false`면 `internal` 오류로 낸다. 결과 여행의 Day별 Stop 수·후보 수가 문서와 같은지 본다. 앱 가져오기는 이름이 같고 50m 안인 핀을 한 장소로 합치고 같은 장소의 뒤 Stop을 버리므로, 줄었으면 입력 오류 `merged-places`(합쳐진 두 장소 경로)로 알려 AI가 한 key로 합치게 한다(앱 병합 규칙은 바꾸지 않는다). 그다음 장소·라벨·여행 항목마다 `JSON.stringify`의 길이가 동기화 항목 상한 `ITEM_DOC_MAX_CHARS`(200,000자, `src/domain/library-sync/items.ts`)를 넘지 않는지 본다. 넘으면 입력 오류 `item-too-large`(해당 장소·Day 경로). 가져온 뒤 다른 기기로 동기화되지 않는 일정을 받은함에 넣지 않기 위해서다. 키 정렬은 JSON 길이를 바꾸지 않아 생략한다. 서버도 공용 `importedItemProblem`으로 모의 가져오기·항목 크기를 검사한다.
6. **링크**: `viewLink(doc, app)`(경로선 포함, 32,000자를 넘으면 경로선 없이)와 `importLink(doc, app)`(경로선 뺀 사본). 둘 다 `direct`가 아니면 `too-big`. `/import#d=` 값(경로선 없음, CLI가 라벨을 만들지 않아 라벨도 없음)을 `readShareHash(importHash, AGENT_INBOX_LIMITS)`로 다시 읽고 `agentDocProblem(doc)`도 검사한다. 제목 출력은 원래 입력 대신 문서의 여행 제목을 쓴다.
7. **요약**(`pipeline/agent-trip/summary.ts`, 새 파일): Day마다 `computeSchedule`로 도착·떠남 시각, 고정 시각 여유·늦음, 이동 합계, 추정 구간 수를 낸다. 가장 이른 조회 시각은 4단계의 `routes.oldestQueriedAt`에 있다.

`send`는 6의 `/import#d=` 값을 받은함에 올리고, `share`는 `/view#d=` 값을 `encryptShareHash`(`src/services/share-short/crypto.ts`)로 암호화해 올린다(아래 API). 삭제 토큰은 `newDeleteToken()`으로 만들고, 기한 기준일은 `shortKeepUntil([endDate])`다. `share`는 서버 요청 **전에** 삭제 토큰·앱·예상 기한을 담은 `pending:<uuid>` 예약을 파일에 넣는다(`pipeline/agent-trip/share-store.ts`). 예약도 200개 상한에 센다. 예약 파일을 읽거나 쓰지 못하면 `share-store`·끝 코드 1로 서버를 부르지 않는다.

- 서버가 `201`(또는 같은 삭제 토큰 재시도의 `200`)을 주면 예약을 실제 id로 바꾼다. 교체 쓰기에 실패하면 링크는 만들어졌으므로 성공으로 끝내되 경고 `share-store`("이 링크는 기한까지 지울 수 없어요")를 낸다.
- 서버가 알려진 오류 코드로 거절하면 예약을 지운다. `timeout`·`offline`·알 수 없는 응답 `server`(JSON 아닌 5xx·틀린 성공 모양 포함)면 서버 저장 여부를 모르므로 링크 기한까지 예약을 남기고, 오류 문구에 `yarn trip unshare --list`로 확인·삭제하라는 안내를 붙인다. `share`를 다시 실행하면 새 삭제 토큰으로 새 링크를 만들므로 기존 예약은 따로 정리한다.
- 삭제 토큰은 출력·`--json`에 넣지 않는다. `unshare --list`는 토큰 없이 같은 앱의 `id`·`title`·`createdAt`·`expiresAt`을 보이고, 예약이면 `unknown: true`를 붙인다. 목록 확인에는 AI 연결 토큰이 필요 없다.

`unshare <id>`: 파일에서 같은 `app`·`id`를 찾는다(없으면 끝 코드 2 `unknown-share`) → `DELETE /api/agent/v1/share/:id`(헤더 `X-Delete-Token`) → `204`, 또는 `404`이면서 JSON 본문이 `{ error: 'not-found' }`(행이 없음)일 때만 파일에서 뺀다. 삭제 응답은 행 존재 여부와 삭제 토큰 일치로 결정한다. 만료됐어도 정리 전 행이 남아 있으면 맞는 삭제 토큰은 `204`, 다른 삭제 토큰은 `403 delete-token`이며, 행이 없으면 `404 not-found`다. 본문이 JSON이 아니거나 `error`가 다른 `404`(옛 서버라 경로가 없음·정적 앱 응답)는 링크가 남아 있을 수 있으므로 항목을 남기고 끝 코드 5 `old-server`. `403 delete-token`이면 항목을 남기고 끝 코드 4. `-`로 시작하는 16자 base64url id도 옵션 위치와 상관없이 읽는다.

`unshare pending:<uuid>`: 예약의 같은 삭제 토큰으로 `POST /api/agent/v1/share`(본문 `{ body: 'A', kind: 'trip', deleteToken: '<43자>' }`)를 부른다. 같은 `delete_hash` 행이 남아 있으면(만료 여부와 상관없이) 기존 id·`expiresAt`을 `created: false`로 받고, 없으면 빈 링크를 만든 뒤 그 id를 `DELETE`한다. 두 단계 중 하나라도 실패하면 예약을 남긴다. 이 복구는 `share:create`·하루 만들기 한도를 쓰며 `AGENT_API=off`·`SHARE_SHORT=off`에서는 실패한다. 실제 id를 아는 링크의 삭제는 두 스위치가 꺼져도 된다.

### 출력

사람용은 한국어 요약과 링크. `--json`은 표준 출력에 JSON 하나만 낸다(진행 상황은 표준 오류). Yarn 1은 `--silent` 없이는 시작·종료 줄을 표준 출력에 섞으므로 기계가 읽을 때는 `yarn --silent`로 부른다. `build`·`send`·`share`의 성공 공통 필드는 `trip`·`days`·`routes`·`links`·`warnings`다. `routes`는 `legs`·`routed`·`estimated`·`noRoute`·`samePoint`·`oldestQueriedAt`을 담는다. 상태별 개수는 서로 겹치지 않고, 같은 입력 키라도 실제 구간마다 센다. Day의 `estimatedLegs`는 `estimated`와 `no-route`를 합한 수다. 조회한 구간이 없으면 `oldestQueriedAt`은 `null`이다.

아래 예시는 Day·Stop 일부를 생략했다(실제로는 모든 Day와 각 Day의 모든 Stop이 나온다).

```json
{
  "ok": true,
  "command": "send",
  "trip": { "title": "속초 1박 2일", "startDate": "2026-11-20", "endDate": "2026-11-21", "places": 5 },
  "days": [{ "date": "2026-11-20", "stops": [{ "key": "tofu", "name": "초당순두부마을", "arrive": "10:42", "depart": "13:00", "fixedTime": "12:00", "slackMin": 78 }], "travelMin": 214, "estimatedLegs": 0 }],
  "routes": { "legs": 5, "routed": 4, "estimated": 1, "noRoute": 0, "samePoint": 0, "oldestQueriedAt": "2026-11-01T05:12:00.000Z" },
  "links": { "view": "https://…/view#d=…", "import": "https://…/import#d=…" },
  "inbox": { "id": "…", "expiresAt": "2026-12-01T05:12:00.000Z", "created": true },
  "warnings": [{ "path": "places[3]", "code": "lookup-failed", "message": "장소를 조회하지 못해 적어 준 이름·좌표를 썼어요" }]
}
```

명령별 성공 필드는 다음과 같다(각 응답에 `ok: true`·`command`가 붙는다).

| 명령 | 추가·대체 필드 |
|---|---|
| `build` | 공통 `links: { view, import }` |
| `send` | 공통 링크와 `inbox: { id, expiresAt, created }`. `expiresAt`은 ISO 문자열 |
| `share` | `links`를 `{ short, view }`로 바꾸고 `share: { id, expiresAt }`를 더한다. `expiresAt`은 ISO 문자열 |
| `whoami` | `connection: { name, scopes, expiresAt, provider }`·`warnings`. `expiresAt`은 ISO 문자열. `trip`·`days`·`routes`·`links`는 없다 |
| `unshare --list` | `shares: [{ id, title, createdAt, expiresAt }]`, 시각은 ISO 문자열. 결과 모르는 예약에만 `unknown: true`가 더해진다 |
| `unshare <id>` | `removed: { id }`·`warnings`. 예약 복구면 `id`는 입력한 `pending:<uuid>`다 |

경고는 `path`·`code`·`message`로 낸다. 대체 이름·좌표 사용과 길찾기 실패는 `lookup-failed`, 검색 결과가 없어 좌표 핀을 만들면 `not-found`, 조회한 이름·주소를 자르면 `out-of-range`, 참조하지 않는 장소는 `unused-place`, `whoami`에서 토큰 만료까지 올림한 날 수가 14일 이하이면 `token-expiring`, 환경변수 토큰을 운영이 아닌 앱 주소로 보내면 `token-origin`, 링크 성공 뒤 저장 파일 교체 실패는 `share-store`다. `token-origin`은 사람용에서 표준 오류, `--json`에서 `warnings`로 낸다.

실패는 `{ "ok": false, "command": "…", "errors": [{ "path": "days[1].stops[2].place", "code": "unknown-place", "message": "places에 없는 key예요 (beachh)" }] }`. 검색 후보가 여럿이면 `code: "ambiguous"`와 `candidates: [{ naverSid, name, address, category }]`. 서버 `422 invalid`는 CLI 코드 `internal`·끝 코드 1이며, 알려진 `reason`이면 오류 항목의 선택 필드 `reason`에도 넣는다(목록은 아래 API). `reason` 없는 모양 오류도 `internal`이다. 토큰·`Authorization` 값은 어떤 출력·오류에도 넣지 않는다.

| 끝 코드 | 뜻 |
|---|---|
| 0 | 성공(경고 있을 수 있음) |
| 2 | 입력 오류: `schema`(파일·옵션·`--out` 포함)·`unknown-place`·`duplicate-in-trip`·`day-count`·`duplicate-sid`·`leg-modes`·`no-places`·`duplicate-source`·`out-of-range`·`walk-too-far`·`merged-places`·`item-too-large`·`too-big`·`app-origin`·`unknown-share`·`share-store-full` |
| 3 | 장소 조회 실패·검색 후보 여럿: `lookup-failed`·`ambiguous`·`not-found` |
| 4 | 토큰·권한 오류: `no-token`·`unauthorized`·`token-expired`·`token-revoked`·`not-allowed`·`scope`·`delete-token` |
| 5 | 서버 거절·장애: `inbox-full`·`rate-limited`·`off`·`config`·`old-server`·`offline`·`timeout`·`server` |
| 1 | `internal`(서버 `422 invalid` 포함), `share-store`의 실제 저장 파일 읽기·쓰기 실패 |

`errors.ts`의 `EXIT_BY_CODE`는 경고 전용 코드를 실패로 분류할 때도 성공을 내지 않도록 `unused-place`·`share-store`를 2, `token-expiring`·`token-origin`을 4로 둔다. 다만 `share-store.ts`의 실제 파일 실패는 `TripFailure(..., EXIT.internal)`을 직접 던져 끝 코드 1이다. 경고로만 나간 경우는 성공 0을 유지한다.

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
- 만료와 삭제: 받은함은 30일 뒤 API 조회에서 제외하고, 새 항목 저장·목록 조회 뒤 최대 50개씩 비동기로 정리한다. 삭제 완료 시점은 보장하지 않는다. 목록·항목 읽기·중복 판단은 모두 `expires_at > now` 조건이다. `waitUntil`로 전체 사용자의 만료 행을 정리하며, 항목 읽기(`GET /v1/agent/inbox/:id`)는 정리를 예약하지 않는다. Cron은 없다. 토큰 발급 때 만료·철회 뒤 30일 지난 그 사용자 토큰 행을 지운다.
- 짧은 링크는 새 표가 없다. 기존 `share_links`에 넣는다.
- D1 쓰기: 올리기 한 번에 카운터 1 + 받은함 1행(+ 토큰 사용 시각 1시간에 1). 무료 한도(하루 쓴 행 10만, 계정 합계)에 비해 작다.

## API(Pages Functions)

### 에이전트 API(토큰)

진입점 `functions/api/agent/[[path]].ts`(새 파일) → `handleAgent(ctx, deps)`(`src/server/agent/router.ts`, 새 파일). 환경·의존성은 `SyncContext`·`SyncDeps`를 그대로 쓰고 `SyncEnv`에 `AGENT_API?: string`·`SHARE_SHORT?: string`을 더한다. 응답·오류는 동기화와 같은 `syncJson`·`SyncHttpError`(`{ error: '<code>', ...extra }`), 모두 `Cache-Control: private, no-store`. 로그는 `{ method, path(패턴), status, ms }` 한 줄이다. 알 수 없는 500에만 진단 필드 `error`(오류 이름 또는 값의 타입)·`d1`(메시지의 `D1_…` 접두가 있을 때)을 더한다. 오류 메시지 본문은 남기지 않는다.

공통 앞 단계: 경로·메서드 찾기(없으면 404·405) → `Origin` 헤더가 있으면 `403 origin` → `DB` 없으면 `503 config` → `ensureSchema` → `AGENT_API === 'off'`이고 경로에 `allowWhenOff`가 없으면 `503 off`(`allowWhenOff`는 짧은 링크 지우기뿐) → 토큰 검사(`requireAgentToken`, 아래 보안) → 범위 → 사용자 하루 한도.

| 요청 | 범위 | 하는 일 | 하루 한도(사용자) | 성공 |
|---|---|---|---|---|
| `GET /api/agent/v1/whoami` | 없음 | 토큰 상태 | `agent-whoami` 500 | `200 { name, scopes, expiresAt, provider }`, `expiresAt`은 epoch ms |
| `POST /api/agent/v1/inbox` | `inbox:write` | `{ v: 1, key, d }`를 받은함에 넣는다 | `agent-inbox` 50 | `201 { id, expiresAt, created: true }`, 만료되지 않은 같은 `key`면 `200 { …, created: false }`, `expiresAt`은 epoch ms |
| `POST /api/agent/v1/share` | `share:create` | 암호문을 `share_links`에 넣는다 | `agent-share` 50 | `201 { id, expiresAt, created: true }`, 같은 삭제 토큰 재시도는 만료 여부와 상관없이 같은 `delete_hash` 행이 남아 있으면 기존 id·`expiresAt`을 `200 { …, created: false }`로 반환. `expiresAt`은 ISO 문자열 |
| `DELETE /api/agent/v1/share/:id` | `share:create` | 헤더 `X-Delete-Token`(43자)이 맞는 짧은 링크를 지운다 | `agent-share-delete` 200 | 행 존재 여부와 삭제 토큰 일치로 결정: 만료됐어도 정리 전 행이 남아 있으면 토큰 일치 `204`·불일치 `403 delete-token`, 행 없음·틀린 모양 id `404 not-found`. 삭제 토큰 없음·모양 오류 `400 bad-json` |

- 본문은 `readLimitedJson(request, SHARE_REQUEST_MAX_BYTES)`(40,000바이트, `src/server/share/handlers.ts`)로 읽는다. 이 함수는 `ApiError`(`TOO_LARGE`·`BAD_REQUEST`)를 던지고 `syncError`는 `ApiError`를 모르므로(그대로면 `500 internal`), `handleAgent`가 경계에서 바꾼다: `TOO_LARGE` → `413 { error: 'too-large' }`, `BAD_REQUEST`(본문을 못 읽음·JSON 아님) → `400 { error: 'bad-json' }`. 스키마 실패는 `422 { error: 'invalid' }`.
- `inbox`: `key`는 `^[A-Za-z0-9_-]{43}$`, `d`는 `^[A-Za-z0-9_-]{1,32000}$`, 본문은 정확히 `{ v: 1, key, d }`다. 처리 순서는 다음과 같다.
  1. **하루 한도 소비** → 본문 읽기(크기 초과 `413 too-large`, 읽기·JSON 실패 `400 bad-json`) → 본문 모양 검사(`422 invalid`, `reason` 없음).
  2. 같은 사용자·같은 `key`의 **만료되지 않은** 행이 있으면 **문서 검사 전에** 그 행을 `200 created: false`로 돌려준다(가득 찬 상태여도 먼저 본다). 같은 키의 `d`가 달라져도 새 문서를 검사하지 않는다.
  3. 새 항목이면 아래 `checkInboxDoc` 검사로 메타데이터를 꺼낸다. 목록의 `title`은 `trips[0].title`(비면 문서 `title`)이다.
  4. `putInbox`에서 같은 키를 다시 조회하고, 없으면 같은 `batch`의 첫 문장에서 같은 `key`의 만료된 행을 지운다. 다음 문장은 조건부 `INSERT … SELECT … WHERE (SELECT count(*) FROM agent_inbox WHERE user_id = ? AND expires_at > ?) < 20`이다. 바뀐 행이 0이거나 `UNIQUE` 충돌이면 만료되지 않은 같은 키를 재조회해 승자 항목을 `200 created: false`로, 없으면 `409 inbox-full`로 돌려준다(19개 상태의 같은 키 경쟁은 개수 조건으로도 0행이 된다). 두 요청이 동시에 와도 한도를 넘지 않는다.
- **받은함 문서 검사(`checkInboxDoc`) 순서**: 각 실패는 `422 { error: 'invalid', reason }`다.
  1. `decodeCompressedJson(d, { maxChars: 32000, maxBytes: 393216 })`로 한 번만 푼다. 실패는 `corrupt`다.
  2. 원시 JSON의 `agentRawProblem`: v1 공유 문서는 `not-trip` → 문서·여행·장소·Stop·구간의 모양 오류, 날 30개 초과, 하루 구간 수가 Stop 수 + 1 초과, Stop + 후보 수가 장소 수 초과이면 `corrupt` → 장소 200곳 초과 `too-many` → 라벨·장소 `labelIds`가 비어 있지 않으면 `labels` → 구간 `path`가 비어 있지 않으면 `path` → `legModes` 키 수가 가능한 구간 수(날마다 Stop 수 + 1의 합)보다 많으면 `leg-modes`.
  3. `validateShareValue(json, 200)` 실패의 `ShareReadError`를 전달한다. 이 함수 자체는 `newer` → 장소 한도 `too-many` → 스키마(모르는 필드 거절) → 장소·라벨 id 중복 `corrupt` → 장소 없음 `empty` → v2 여행 관계 `corrupt` 순서다. 받은함에서는 앞의 원시 검사가 먼저이므로 여러 결함이 있으면 그 이유가 우선할 수 있다.
  4. v2가 아니면 `not-trip`.
  5. `agentDocProblem`: 문서 `title`·여행 제목이 60자 초과면 `title` → 라벨·라벨 참조가 있으면 `labels` → 장소 `name` 100자·`address` 200자·`memo` 10,000자 초과 또는 출처 id(`naverSid`·`kakaoId` 숫자 1~20자, `googleId` 64자 이하) 위반이면 `place-too-long`.
  6. 실제 구간(`dayPoints`의 이웃한 쌍)이 아닌 `legModes` 키가 있으면 `leg-modes`.
  7. 공용 `importedItemProblem`으로 기본 제목 라벨·메모 덧붙이기 설정의 모의 가져오기를 한다. 연산 실패는 `import`, 가져온 장소·라벨·여행 항목의 JSON이 `ITEM_DOC_MAX_CHARS`(200,000자)를 넘으면 `item-too-large`다.
- **거절 이유**: `ShareReadError`는 `too-big`·`not-share`·`corrupt`·`empty`·`too-many`·`newer`다. 받은함 전용 이유는 `not-trip`·`title`·`labels`·`path`·`place-too-long`·`leg-modes`·`import`·`item-too-large`다. 이는 CLI가 전달하는 알려진 `reason` 목록이며, 모든 값이 현재 받은함 경로에서 직접 생기는 것은 아니다. 공유 스키마만으로는 21만 자 이름·긴 출처 id·50만 자 제목도 압축 상한 안에 들 수 있고, 실제 구간이 아닌 설정 수천 개나 긴 Stop 메모는 가져온 항목을 동기화 상한 밖으로 키울 수 있다. 그래서 내용 상한·실제 구간·모의 가져오기를 함께 검사한다. 라벨과 경로선은 에이전트의 받은함 형식에 필요 없고 스키마·모의 가져오기 CPU를 늘려 사전에 거절한다.
- **앱의 공통 읽기**: `readShareHash`와 `readShareFile`도 `validateShareValue`를 쓰므로 압축·파일 크기 검사 뒤 `newer` → `too-many` → 스키마 순서를 따른다. 받은함 미리보기뿐 아니라 일반 공유 파일에도 적용되며, 기본 장소 상한은 1,000곳이고 받은함 서버·CLI는 200곳이다.
- **CLI 성공 응답 검사**: `whoami`는 문자열 이름·문자열 배열 범위·유한한 숫자 `expiresAt`·문자열 공급자, inbox는 16자 base64url id·불리언 `created`·유한한 숫자 `expiresAt`, share는 같은 id·`created`와 날짜로 해석할 수 있는 ISO `expiresAt` 문자열을 확인한다. 모양이 틀리면 `server`·끝 코드 5로 보고, share 예약은 남긴다.
- `share`: 본문 `{ body, kind: 'trip', keepUntil?, deleteToken }`. 검사는 `handleShareCreate`의 `createSchema`에서 `turnstile`만 뺀 것. `SHARE_SHORT === 'off'`면 `503 off`. 저장은 `handleShareCreate`에서 꺼낸 새 함수 `insertShareLink(db, { body, kind, keepUntil, deleteHash }, now)`를 둘이 함께 쓴다(같은 `delete_hash` 재시도·id 충돌 3번·`shortExpiresAt` 기한). 같은 `delete_hash` 행이 남아 있으면 만료 여부와 상관없이 기존 id·`expiresAt`을 `created: false`로 반환한다. 만료 행의 물리적 삭제는 `pruneExpiredShares`로 새 링크 저장 뒤·링크 열기 때 최대 20개씩 비동기로 예약하며, 같은 삭제 토큰 재시도(`created: false`)는 정리를 예약하지 않는다. 삭제 완료 시점은 보장하지 않는다. 서버는 키가 없어 내용을 검사하지 못한다. 문서 검사는 CLI(위 5·6단계)와 보기 화면이 한다.
- `DELETE /share/:id`: `handleShareDelete`의 지우기 부분을 새 함수 `deleteShareLink(db, id, deleteToken): Promise<'deleted' | 'forbidden' | 'not-found'>`로 꺼내 둘이 함께 쓴다(`hashToken`으로 `delete_hash` 비교). 만료 여부는 검사하지 않고 행 존재 여부와 삭제 토큰 일치로 결정한다(정리 전 행이 남아 있으면 토큰 일치 `204`·불일치 `403 delete-token`, 행이 없으면 `404 not-found`). 삭제 토큰만으로 권한을 보므로 다른 사용자 토큰으로도 지울 수 있다(브라우저 경로와 같다). 다른 스위치와 같이 지우기는 막지 않는다: `AGENT_API=off`·`SHARE_SHORT=off`여도 이 경로는 열린다(토큰 검사는 그대로).
- 조회 결과가 없는 토큰(없음·모양 오류·미등록)은 IP 해시별 `agent-auth-fail` 하루 300번(`hashIp` + `IP_HASH_SALT`, 로컬은 `dev-salt`)을 넘으면 `429`. 등록된 토큰의 만료·철회·권한 실패와 정상 요청은 이 카운터를 쓰지 않는다.

### 동기화 세션 API(앱)

`AGENT_SYNC_ROUTES`(`src/server/agent/sync-routes.ts`, 새 파일)를 `SYNC_ROUTES` 끝에 더한다(`BACKUP_ROUTES`와 같은 방식, 같은 출처 검사·세션 인증 `requireBackupUser`(계정 경계 헤더 검사 포함)). 앱은 `getSharedSyncApi().client.send`로 부르며 요청을 만들 때의 계정 id를 `X-Landmark-Backup-User`에 넣는다.

| 요청 | 하는 일 | `allowWhenOff` | 한도 | 성공 |
|---|---|---|---|---|
| `GET /v1/agent/tokens` | 내 토큰 목록(살아 있는 것 + 만료·철회 30일 안) | 예 | — | `200 { enabled, canCreate, maxActive: 10, tokens: [{ id, name, scopes, createdAt, expiresAt, lastUsedAt, revokedAt }] }` |
| `POST /v1/agent/tokens` | 발급(`{ name, scopes }`) | 아니오 | `agent-token-create` 20/일 | `201 { token, id, name, scopes, expiresAt }`. 10개면 `409 too-many-tokens`(받은함과 같이 살아 있는 토큰 수를 조건으로 건 한 문장의 조건부 `INSERT … SELECT … WHERE (SELECT count(*) …) < 10`, 바뀐 행 0이면 409), `AGENT_API=off`면 `503 off` |
| `DELETE /v1/agent/tokens/:id` | 철회(`revoked_at`) | 예 | — | `204`, 남의 것·없음 `404` |
| `GET /v1/agent/inbox` | 받은함 목록(만료 제외, 오래된 순) | 예 | `agent-inbox-read` 2,000/일 | `200 { items: [{ id, title, startDate, endDate, places, from, createdAt, expiresAt }] }`. `from`은 토큰 이름(없으면 `null`) |
| `GET /v1/agent/inbox/:id` | 항목 값 | 예 | 위와 같음 | `200 { id, data }` |
| `DELETE /v1/agent/inbox/:id` | 가져온 뒤·버리기 | 예 | — | `204`, 없음 `404` |

- 토큰 목록은 `enabled`·`canCreate`·`maxActive`·`tokens`를 반환하며 토큰 원문·해시는 포함하지 않는다. 목록·발급·받은함 응답의 시각은 epoch ms이고, `lastUsedAt`·`revokedAt`은 `null`일 수 있다.
- 응답은 `{ enabled, canCreate, … }` 둘로 나눈다. `enabled`는 `AGENT_API !== 'off'`(에이전트 API가 도는가), `canCreate`는 `enabled && LIBRARY_SYNC !== 'off'`(발급 경로가 받는가). `LIBRARY_SYNC=off`면 발급은 기존 라우터 규칙대로 `503 off`, 나머지는 `allowWhenOff`로 열린다.
- 발급 응답의 `token`은 이 응답에만 있다. 앱은 메모리에만 두고 창을 닫으면 버린다.

## 앱

### 받은함 확인

- 부트 `src/services/agent-inbox/boot.ts`(새 파일): `loadAgentInbox = lazyChunk(() => import('src/services/agent-inbox/inbox-check'))`, `loadAgentSection`, `loadAgentInboxDialog`. `src/sections/agent/use-agent-inbox-boot.ts`(새 파일)를 `LibraryShell`(`src/sections/shell/ShellRoute.tsx`)의 `useAutoBackupBoot()` 다음 줄에서 부른다. `readBootFlag()`가 참이면 바로 실행기를 받아 붙인다. 같은 페이지에서 동기화를 켜는 경우(첫 연결, 설정의 `다시 켜기`는 엔진 `enable()`만 부르고 셸을 다시 마운트하지 않는다)를 위해, 훅은 `syncStatusAtom`(첫 로딩 묶음)을 구독해 `phase`가 `synced`·`conflict`가 될 때 실행기를 받아 붙인다. 이미 붙었으면 다시 붙이지 않고, 조각 로딩·시작 실패면 구독을 유지해 다음 완료 때 다시 시도한다.
- 실행기 `src/services/agent-inbox/inbox-check.ts`(새 파일, 조각 `inbox-check` — Vite 조각 이름은 파일 이름을 따른다): `loadSyncEngine()`의 `ensureLibrarySyncEngine().onRunFinished`에 붙어(자동 백업 `attachAutoBackup`과 같은 모양) `synced`·`conflict` 결과에서만 `GET /v1/agent/inbox`를 부른다(붙일 때 현재 상태도 한 번 확인). `document.visibilityState === 'hidden'`이면 건너뛰고, 확인 시작 시각 기준 10분 간격으로 제한한다. 요청 중 세션 id가 바뀌면 성공·실패 모두 버리고 한 번만 바로 다시 확인한다. 새 id가 있으면 `sonner` 알림 「AI가 보낸 일정 N개」 + `보기`. 실패(오프라인·5xx·429)는 조용히 다음 실행에서 다시 한다. 401·403(`auth`·`not-allowed`)은 이 페이지에서 받은함 확인을 멈추고 알림을 내지 않는다. 세션 지우기·상태 바꾸기는 하지 않고 동기화 엔진의 다음 실행(`schedule('manual')`을 한 번 부름)이 자기 실패 처리로 `auth`·`not-allowed`를 정하게 한다(같은 세션으로 엔진도 같은 응답을 받는다). 멈출 때 그 세션 id(`readSession()`)를 기억하고, 이후 `onRunFinished`가 올 때 저장된 세션 id가 달라졌으면(같은 페이지에서 다시 로그인 — Google 재로그인은 페이지 이동 없이 엔진을 다시 시작한다) 멈춤을 풀고 확인을 이어 간다.
- 기기 키 `tripmap:agent-inbox:v1`(`src/services/agent-inbox/storage.ts`): `{ v: 1, userId: string | null, notified: string[] }`(최대 100개). 성공적으로 확인한 목록의 id로 바꾼다. 새 id가 하나라도 있으면 전체 목록 수로 알리고, 다른 사용자면 빈 기록으로 읽는다. 백업·동기화에 넣지 않는다.
- 받은함 창은 `LibraryShell`에 항상 마운트된 `AgentInboxHost.tsx`가 `agentInboxOpenAtom`(`src/stores/agent-inbox.ts`)으로 연다. 실행기는 atom만 켜고, 호스트가 `loadAgentInboxDialog`의 지연 조각을 받는다. 조각 로딩 실패면 `ChunkErrorNotice`와 `닫기`가 있는 안내 창을 보인다. 닫은 뒤 다시 열면 창을 새로 만든다.

### 미리보기와 가져오기

- `AddFlow`(`src/stores/add-place.ts`)의 `share` 단계에 선택 필드 `inbox?: { id: string; from: string | null; owner: string | null }`을 더한다(`owner`는 요청을 시작할 때의 `readSyncMeta().userId`). 받은함 창의 `미리보기`가 `GET /v1/agent/inbox/:id` → `readShareHash(data)` → `setFlow({ step: 'share', doc, inbox })`. 문서 해석 실패면 `SHARE_READ_MESSAGES` 문구와 `버리기`만 보인다. 항목 요청 실패면 "받은 일정을 읽지 못했어요. 다시 시도해 주세요"와 `미리보기`·`버리기`를 남기고, 이미 없는 항목은 목록에서 빼고 "이미 없는 일정이에요"를 알린다.
- **계정이 바뀐 경우**: 서버 백업 구역의 `sameOwner()`와 같이, 받은함 목록·항목 응답을 받은 뒤와 `SharePreview`의 가져오기 직전과 보관함 잠금을 얻은 뒤 연산 안에서 `readSyncMeta().userId === owner`이고 저장된 세션이 있는지 다시 본다. 다르면 결과를 버리고 흐름을 닫으며 알림 "로그인한 계정이 바뀌어 받은 일정을 닫았어요". 받은함 창이 열린 채 계정이 바뀌면(`storage` 이벤트로 동기화 기록이 바뀜) 창을 닫는다. 기기 키 `tripmap:agent-inbox:v1`의 `userId`가 다르면 알린 기록을 비운다.
- `SharePreview`(`src/sections/share-import/SharePreview.tsx`): `inbox`가 있으면 `AI 연결 「이름」이/가 보낸 일정` 머리를 더한다(`subjectParticle`로 주격 조사를 고르고, 이름이 없으면 `이름 없는 연결`). 받은함 항목은 **여행째 가져오기(`tripSwitchOn`이 켜져 있어 `importSharedTrip`으로 새 여행을 만든 경우)가 성공했을 때만** `loadAgentInbox()`로 받은 지우기 함수를 부른다(실패해도 가져오기는 성공으로 두고 알림 "받은함에서 지우지 못했어요"). 여행 스위치를 끄고 고른 장소만 가져오면 항목을 남기고 알림 "받은 일정은 받은함에 남겨 둘게요. 다 쓰셨으면 버려 주세요". `SharePreview`는 지금처럼 `loadSharePreview` 조각이고 동기화 API를 정적으로 가져오지 않는다.

### 설정 › 동기화 › AI 연결

- `src/sections/agent/AgentSection.tsx`(새 파일, 설정 화면에서 `lazy`): `SettingsPage`의 `동기화` 절 안 `SyncSection` 아래. 동기화 로그인(`readSyncMeta().userId`와 저장된 세션)이 있을 때만 보인다.
- 설명: "Claude Code 같은 AI 도구가 일정을 받은함으로 보내거나 공유 짧은 링크를 만들 수 있게 연결해요. 연결 토큰으로는 보관함을 읽거나 고칠 수 없어요. 받은 일정은 내가 `가져오기`를 눌러야 보관함에 들어가요."
- 목록 줄: 이름 · 권한 · `만료 1월 30일(90일 남음)` · `마지막 사용 오늘` · `철회`. 만료·철회된 줄은 흐리게.
- `새 연결 만들기` 창(`AgentTokenDialog.tsx`, 같은 조각): 이름·권한 체크 → 토큰 한 번 표시(위 흐름). 원문이 보이는 동안 바깥 누르기·Esc로 닫히지 않고 `닫기`로만 닫힌다. 닫으면 원문·요청 상태를 버린다. 창을 닫은 뒤 발급이 성공해도 같은 계정·세션이면 목록을 다시 읽고 원문은 버린다. 10개면 단추를 끄고 "연결은 10개까지예요. 쓰지 않는 연결을 철회해 주세요".
- 토큰 목록 실패는 원인별로 "지금은 AI 연결을 쓸 수 없어요"·"인터넷 연결을 확인해 주세요"·"AI 연결 정보를 불러오지 못했어요"와 `다시 시도`를 보인다. 목록을 읽었지만 받은함 읽기에 실패하면 "받은 일정을 불러오지 못했어요"와 별도 `다시 시도`를 보인다. 빈 받은함은 `받은 일정 없음`이다. 받은함 창 자체의 목록 실패는 "받은 일정을 불러오지 못했어요. 다시 시도해 주세요"와 `다시 시도`다.
- `받은 일정 N개 · 보기`(받은함 창). `canCreate: false`면 만들기를 끄고, `enabled: false`면 "지금은 AI 연결을 쓸 수 없어요", 동기화만 꺼졌으면 "동기화가 꺼져 있어 새 연결을 만들 수 없어요"를 보인다.

### 첫 로딩·조각

| 묶음 | 파일 | 첫 로딩 |
|---|---|---|
| 부트·창 호스트 | `src/services/agent-inbox/boot.ts`, `src/sections/agent/use-agent-inbox-boot.ts`, `src/sections/agent/AgentInboxHost.tsx`, `src/stores/agent-inbox.ts` | 들어감. 실행기·창 본문은 지연 로딩 |
| 실행기 | `src/services/agent-inbox/inbox-check.ts`(+ `storage.ts`, 앱 API `src/services/agent-inbox/api.ts`) | `inbox-check-*.js` |
| 설정 구역 | `src/sections/agent/AgentSection.tsx`, `AgentTokenDialog.tsx` | `AgentSection-*.js` |
| 받은함 창 | `src/sections/agent/AgentInboxDialog.tsx` | `AgentInboxDialog-*.js` |

- `build:ci`에 `--require-lazy AgentSection --require-lazy AgentInboxDialog --require-lazy inbox-check`를 더한다. 첫 로딩 상한(`perf-budget.json` 327,680)은 그대로.
- 동기화 엔진은 `loadSyncEngine()`(동적 import)으로만 받는다. 정적으로 가져오면 `INEFFECTIVE_DYNAMIC_IMPORT`로 빌드가 실패한다(4단계 설계와 같음).
- 새 `VITE_` 변수가 없다. CLI 설정은 `LANDMARK_APP_URL`·`LANDMARK_AGENT_TOKEN`, 시험용 저장 폴더는 `LANDMARK_TRIP_HOME`, 상대 파일 경로 기준은 `INIT_CWD`다(`vitest.config.ts`의 `test.env`는 그대로).

## 보안

- **토큰**: 32바이트 무작위(`crypto.getRandomValues`), 원문은 발급 응답에만. D1에는 `hashToken` 해시만 두고 해시로 찾는다. 공개 id는 목록·철회·받은함 출처에만 쓴다.
- **검사(`requireAgentToken(ctx, deps, scope)`, `src/server/agent/auth.ts` 새 파일)**: `Authorization: Bearer lmk_<43자>` 모양 → `agent_tokens JOIN users`를 해시로 한 번 읽음 → 없음 `401 unauthorized`, `revoked_at` `401 token-revoked`, `expires_at` 지남 `401 token-expired` → **허용 계정 재확인**: `users.firebase_sub`가 `kakao:`·`naver:`로 시작하면 `parseAccountList(ALLOWED_ACCOUNTS)`(개발 가짜 공급자가 켜졌고 변수가 없으면 `sessionAuthFor`와 같이 `kakao:dev-me,naver:dev-me`), 아니면 `parseAllowList(ALLOWED_EMAILS)`에 `users.email`(소문자) → 없으면 `403 not-allowed` → 범위가 없으면 `403 scope`. 두 함수는 `@sch0718/firebase-session/worker`가 내보내는 것으로 세션 인증과 같은 규칙이다.
- **범위**: `inbox:write`·`share:create`뿐. 보관함·동기화 표를 읽거나 쓰는 경로가 없다. 받은함은 사람이 `가져오기`를 눌러야 보관함에 들어간다.
- **사용자 격리**: 모든 질의에 토큰·세션에서 얻은 `user_id`. 본문의 값은 권한 근거로 쓰지 않는다.
- **브라우저·CSRF**: 에이전트 API는 쿠키를 쓰지 않고 `Authorization` 헤더만 받는다. `Origin`이 있는 요청은 거절하고 CORS 응답 헤더를 내지 않는다. 발급·목록·철회는 동기화 세션 헤더(`X-Landmark-Session`)와 기존 출처 검사(`isSyncOrigin`) 아래에 있다.
- **크기·빈도**: 본문 40,000바이트, 받은함 값 32,000자·풀린 JSON 393,216바이트(384KB)·장소 200곳(`AGENT_INBOX_LIMITS`). 하루 한도는 위 표(UTC 날짜, `rate_counters`). 받은함 20개·30일.
- **CPU**: `AGENT_INBOX_LIMITS`는 `fileBytes` 5,242,880·`hashChars` 32,000·`decodedBytes` 393,216(384KB)·`places` 200이다. `fileBytes`도 상수에 있지만 받은함 POST 본문 상한은 별도 40,000바이트다. 서버는 `decodeCompressedJson`의 `maxBytes`로 압축을 푸는 중 상한에서 끊고, 한 번 푼 JSON을 `agentRawProblem` → `validateShareValue` → 내용·실제 구간 검사 → 모의 가져오기로 넘긴다. 큰 모음·라벨·경로선·과다 구간 설정은 스키마·모의 가져오기 전에 거절한다. CLI도 링크를 같은 `AGENT_INBOX_LIMITS`로 다시 읽고, 양쪽 모두 가져온 항목의 동기화 상한을 본다. 앱 일반 공유 읽기의 기본은 `SHARE_IMPORT_LIMITS`(풀린 크기 5,242,880바이트·장소 1,000곳)이며 `newer` 다음 `too-many`를 스키마보다 먼저 검사한다. 미리보기에서는 상한 크기 문서(30일·장소 200곳·Stop 메모 500자)와 압축률이 높은 입력(384KB까지 풀리는 반복 문자열)의 CPU 시간을 확인한다(무료 한도 요청당 10ms 기준).
- **내용 공개 범위**: 받은함은 동기화와 같은 일반 저장(운영자가 D1에서 읽을 수 있음). 30일 뒤 API 조회에서 제외하고, 새 항목 저장·목록 조회 뒤 최대 50개씩 비동기로 정리한다. 삭제 완료 시점은 보장하지 않는다(위 「서버 데이터」). 짧은 링크는 암호문만 저장하고 키는 링크 `#k=`에만 있다. 짧은 링크 기본값은 장소 메모 제외.
- **CLI**: 토큰을 허용 출처에만 보낸다. 토큰·헤더를 출력·오류·`--out` 파일에 쓰지 않는다. 키체인은 셸 없이 `execFile('security', [...])`. 토큰을 저장소 파일·`plan.json`에 넣지 않는다(문서와 스킬 규약에 적는다).
- **로그**: 서버는 메서드·경로 패턴·상태·시간, 알 수 없는 500에만 `error`·선택 `d1` 진단 필드를 남긴다. 오류 메시지 본문·토큰·문서·계정 id는 남기지 않는다.
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
| 문서·본문 모양 거절 | `422 invalid`(문서 검사 실패면 `reason`, 본문 모양 오류면 없음) | 1 `internal`, 알려진 `reason`만 오류 항목에 전달 | — |
| 링크가 너무 김 | — | 2 `too-big` "장소·Day를 줄이거나 앱에서 파일로 공유해 주세요" | — |
| 네이버 장소·검색 실패 | — | 대체 값이 있으면 경고, 없으면 3 | — |
| 길찾기 실패 | — | 그 구간 `estimated`·`no-route`, 경고 | 미리보기·보기 화면에 어림값 표시(지금 규칙) |
| 오프라인 | — | 5 `offline`, share는 예약 유지·`unshare --list` 안내 | 자동 확인은 다음 동기화 완료 때, 설정은 실패 문구·`다시 시도` |
| 받은함 항목 읽기 실패 | — | — | 문서 해석 실패는 `SHARE_READ_MESSAGES` + `버리기`, 요청 실패는 다시 시도 안내 + `미리보기`·`버리기` |
| 가져온 뒤 지우기 실패 | — | — | 가져오기는 성공, 알림 "받은함에서 지우지 못했어요". 다음 확인 때 다시 보이며 `sameTripExists` 경고가 중복을 알린다 |

## 호환·롤백

- 보관함(`tripmap:library:v2`)·백업 파일·공유 문서(`ShareDoc` v1·v2) 형식은 바뀌지 않는다. 받은함 항목은 기존 `/import#d=` 값과 같다. 새 기기 키 `tripmap:agent-inbox:v1`은 옛 버전이 무시한다. `AddFlow`의 `inbox` 필드는 메모리 상태다.
- `/api/search` 응답 모양은 그대로다(`searchNaverPlaces`는 `sid`를 더 주고, `resolveSearch`가 지금 모양으로 줄인다).
- **스위치**: `AGENT_API=off`(Pages 변수, 다시 배포). 에이전트 API(짧은 링크 지우기 제외)·발급이 503, 짧은 링크 지우기·목록·철회·받은함 읽기·지우기는 계속. 짧은 링크 전체를 멈추려면 기존 `SHARE_SHORT=off`. 단, `pending:<uuid>` 복구는 생성 API를 먼저 불러 두 스위치 중 하나라도 꺼져 있으면 실패한다(실제 id 삭제는 계속 됨).
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
| ③ 앱 AI 연결·받은함 | `src/sections/agent/*`(`AgentInboxHost.tsx` 포함), `src/services/agent-inbox/*`, `src/stores/agent-inbox.ts`, `AddFlow`·`AddPlaceHost`(`src/sections/add-place/AddPlaceHost.tsx`의 `StepView`가 `share` 단계에서 `inbox`도 `SharePreview`에 넘김)·`SharePreview`(`inbox` 속성 추가)·`SettingsPage`·`ShellRoute`, `build:ci` 조각 검사 | 없음 | 태그, 롤백 표(③만 되돌릴 때) |
| ④ 문서·스킬 | `docs/development.md`(AI 연결 절: 명령·`plan.json`·토큰·로컬 실행·API·한도), `README.md` 기능 목록 한 줄, 도움말 설정 메뉴 한 단계(필요하면), `docs/rollback.md` 정리. 저장소 병합 뒤 워크스페이스 스킬 연결(저장소 밖) | 없음 | 태그 |

②는 발급 화면(③)보다 먼저 나가므로 그 사이에는 토큰을 만들 수 없다(시험은 메모리 서버로 한다).

## 워크스페이스 스킬 연결 규약

`/Users/shinchoonho/01.workspace/.claude/skills/korea-trip-planner`가 지킬 것. 스킬 파일 수정은 ④ 병합 뒤 마지막 단계에서 한다.

1. **부르는 때**: 사용자가 "랜드마크로 보내줘"(받은함 → `send`), "랜드마크 링크로 공유해줘"(→ `share`), "랜드마크 링크만 만들어줘"(→ `build`)라고 할 때만. 계획서를 쓸 때 자동으로 부르지 않는다.
2. **장소**: 저장 목록 장소는 `naver_bookmarks.py` 결과의 `sid` → `naverSid`, `name`·`address`·`px`→`lng`·`py`→`lat`(숫자로 바꿈)을 대체 값으로 함께 넣는다. 신규 제안은 `search: { q, near }`(`near`는 근처 저장 장소 좌표)로 찾는다. `search`의 `name`은 후보 이름 비교 기준이기도 하며 생략하면 `search.q`로 비교한다. 후보 오류가 나면 후보 중 하나의 `naverSid`로 고쳐 다시 부른다. 못 찾으면 이름 + 좌표 핀. 집 주소는 넣지 않고 인근 역 같은 대표 지점을 쓴다.
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
  - CLI(`// @vitest-environment node`, 바깥 요청은 가짜 `fetch`): `TripPlanSchema`(필수·모르는 필드·`key` 모양·날짜·`stayMin` 범위·출처 둘 이상), 의미 검사(없는 key·같은 장소 두 번·날 수·같은 sid·`legModes` 키) 오류 경로 문자열, 장소 조회(sid 성공·실패와 대체 값·`link` 폴더 거절·검색 하나·정확한 이름 하나·후보 여럿 `ambiguous`·결과 없음 핀), 보관함 만들기(연산 오류를 경로로 바꿈·`LibrarySchema` 통과), 구간(같은 지점·`routed`·`NO_ROUTE`·실패 → 앱 `use-trip-legs`와 같은 값, 같은 키 한 번만, `--no-routes`), 문서가 `ShareDocV2Schema`·`checkShareTrip`을 통과하고 `importLink` 값이 `readShareHash`(`AGENT_INBOX_LIMITS` 포함)로 같은 문서(경로선 제외)가 됨, 요청 키가 같은 계획·같은 메모·경로 옵션의 재실행에서 같고 메모 옵션·`--no-routes` 여부가 다르면 다름, 조회 뒤 출처 중복 `duplicate-source`(sid와 검색이 같은 장소), 참조 장소 없음 `no-places`, 좌표 범위 밖(핀·대체 값·구글 링크 결과) `out-of-range`, 가져오기 모의 실행 `item-too-large`(이름 긴 장소 경계값)·제목 30·31·60자에서 성공·같은 이름 50m 안 핀 두 개 `merged-places`, 이웃하지 않은 `legModes` 쌍 `leg-modes`, 50km 넘는 도보 지정 `walk-too-far`, 네이버 응답 지연 시간 초과(대체 값 사용·오류), 메모 기본값 세 명령, `too-big`, 요약 시각(`computeSchedule`), `--json` 모양과 끝 코드, 허용 밖 `--app` 거절, 토큰 출처(환경변수 > 키체인, `execFile` 가짜), 어떤 출력에도 토큰 문자열이 없음.
  - `searchNaverPlaces`·`resolveSearch`(응답 모양 그대로), `randomId`.
  - 서버(`node:sqlite` 가짜 D1 `createSqliteD1`, `createSyncMemoryServer`로 로그인): 스키마 7·멱등·6에서 올라감·`ALTER` 없음, 발급(원문 한 번·해시만 저장·10개 409·하루 20번·`AGENT_API=off` 503·`LIBRARY_SYNC=off` 503), 목록·철회(남의 것 404), `Origin` 있는 에이전트 요청 403, 토큰 모양·없음·만료·철회 401, 허용 목록에서 빠진 계정 403(카카오·Google 각각), 범위 403, 받은함(제목 61자·장소 이름 101자·실제 구간이 아닌 `legModes` 키(장소 100곳·구간 설정 6,700개 사례) 422, 토큰 9개에서 두 발급 경쟁 시 10개를 넘지 않음, 정상 201·같은 `key` 200(20개 찬 상태에서도, 19개 상태에서 같은 `key` 두 요청 경쟁 시 둘 다 같은 id)·만료된 같은 `key`는 새로 201·`readShareHash` 실패와 v1 문서 422·풀린 크기 384KB 넘음 422 `corrupt`·본문 413·JSON 아님 400·20개 409·동시 두 요청이 20개를 넘지 않음·하루 50번 429·사용자 격리·만료 행은 읽히지 않음·최대 50개씩 정리(56개 중 6개 남음)·항목 읽기는 정리를 예약하지 않음), 짧은 링크 지우기(행 존재 여부와 삭제 토큰 일치로 결정: 만료됐어도 정리 전 행이 남아 있으면 204/403, 행이 없으면 404 `{ error: 'not-found' }`·`AGENT_API=off`에서도 되고 같은 스위치에서 whoami·inbox·share는 503·하루 200번), 출처 id 21자 sid `place-too-long`, 짧은 링크(정상·`deleteToken` 재시도는 같은 `delete_hash` 행이 남아 있으면 만료 여부와 상관없이 기존 id·`expiresAt`(31일 뒤에도 `created: false`)·`SHARE_SHORT=off`·`AGENT_API=off`·`/s/<id>`가 CLI 암호문을 연다), 미등록·모양 오류 토큰 IP 한도(만료·철회는 카운터 제외), 마지막 사용 1시간 간격, `DELETE /v1/account`가 두 표를 지움, 로그 줄에 토큰·문서 없음.
  - CLI ↔ 서버: 메모리 서버의 `fetch`로 `send`·`share`·`whoami`·`unshare` 전체(`share` → 파일에 삭제 토큰·권한 600 → `unshare --list` → `unshare` → `/s/<id>` 404 → 파일에서 빠짐, 서버 요청 전 예약 쓰기 실패는 `share-store`·끝 코드 1, 성공 뒤 교체 쓰기 실패는 경고, 출력에 삭제 토큰 없음, 옛 서버 404(JSON 아님)면 파일 항목을 남기고 끝 코드 5, 만료 안 된 200개에서 `share-store-full`로 서버를 부르지 않음, `share` 두 개와 `share`·`unshare`를 동시에 돌려도 항목을 잃지 않음. 발급 → 키체인 가짜 → 명령 → 받은함 목록).
  - 앱: 받은함 실행기(첫 실행·10분 간격·새 id만 알림·다른 사용자·실패 무시·401/403이면 확인을 멈추고 엔진 실행을 한 번 예약·같은 페이지 재로그인 뒤 다시 확인), 받은함 창(줄 문구·미리보기·읽기 실패·버리기 확인), 실제 `AddPlaceHost`를 거친 `SharePreview`의 받은함 머리·여행째 가져온 뒤 지우기·장소만 가져오면 남김·지우기 실패 알림·응답 사이 계정이 바뀌면 버림·가져오기 직전 계정 재확인, AI 연결 구역(로그인 없으면 숨김·목록 문구·만들기 창·원문 한 번·10개·`enabled`·`canCreate` 경우별 문구), 새로고침 없이 `다시 켜기` → `synced` → 받은함 알림.
  - CLI 세부 회귀: JSON Schema의 `key`·`naverSid`·날짜·`HH:mm` 패턴·설명, `--schema --json` 허용과 다른 조합·`--help` 거절, `INIT_CWD` 상대 경로, `--out` 쓰기 실패의 경로·`schema`·끝 코드 2, 이름·메모·검색어 trim과 빈 이름·검색어 오류, 소수 5자리 길찾기 좌표, 문서 여행 제목 출력, `samePoint` 포함 상태별 개수, 모든 명령의 성공 키와 ISO 시각, 알려진 422 `reason` 전달과 `internal`·끝 코드 1, 경고 코드·끝 코드 분류. 환경변수 토큰 모양 오류는 키체인으로 넘어가지 않고 4, 빈 환경변수는 macOS 키체인, 다른 OS는 키체인을 부르지 않음, 포트 포함 계정, `token-origin`, `whoami` 14일 이하 경고.
  - 서버 검사 회귀: 풀기 실패 `corrupt` → 원시 검사(`not-trip`·`corrupt`·`too-many`·`labels`·`path`·키 수 `leg-modes`) → `ShareReadError` → v2 확인 → `title`·`labels`·`place-too-long` → 실제 구간 `leg-modes` → 모의 가져오기 `import`·`item-too-large` 순서와 이유. 날 30개 초과·Stop+후보 과다·구간 모양·라벨·경로선·구간 키 과다는 스키마·모의 가져오기까지 가지 않음. 일반 `readShareHash`·`readShareFile`도 `newer` → `too-many` → 스키마. 받은함 본문 모양 오류는 `reason` 없음, 같은 키는 하루 한도·본문 검사 뒤 문서 검사 전에 반환(다른 `d`라도 기존 id), 긴 Stop 메모의 동기화 항목 상한을 서버도 거절. `DELETE /share/:id`의 헤더 없음·모양 오류 400과 틀린 id 404, 성공 응답 시각 형식.
  - 짧은 링크 복구 회귀: 서버 요청 전 삭제 토큰 예약·200개 상한, 알려진 거절 뒤 예약 제거, 시간 초과·연결 실패·JSON 아닌 5xx·틀린 성공 모양 뒤 예약 유지와 `unshare --list` 안내, 예약의 `unknown: true`, 같은 삭제 토큰으로 `body: 'A'` 생성 재시도 → 같은 `delete_hash` 행이 남아 있으면 만료 여부와 상관없이 기존 id·`expiresAt`(`created: false`), 없으면 빈 링크 → 삭제, 두 단계 실패 때 예약 유지, 생성 권한·하루 한도·두 스위치의 제약, `-`로 시작하는 16자 id, 회수 잠금 경합·기존 폴더 권한 유지. `whoami`·inbox·share의 잘못된 성공 응답은 `server`·끝 코드 5.
  - 앱 세부 회귀: 부트·실행기의 `synced`·`conflict`, 숨긴 탭 건너뜀, 확인 시작 기준 10분, 요청 중 세션 교체 결과 버림과 한 번 재확인, 조각 시작 실패 뒤 재시도, 새 id가 있으면 전체 개수 알림과 직전 목록 id 기록, 토큰 목록 실패와 받은함 실패의 문구·재시도 분리, 설정의 `받은 일정 없음`과 창의 `받은 일정이 없어요`, 원문 표시 중 바깥 누르기·Esc 무시·`닫기`로 원문 폐기, 닫은 뒤 늦은 발급 성공의 목록 반영, `AgentInboxHost` 조각 실패 안내·닫고 다시 열기, 미리보기 머리의 주격 조사·이름 없는 연결, 보관함 잠금을 얻은 뒤 계정 재확인.
- E2E(Playwright, desktop): `agent-inbox.spec.ts` — `installSyncServer`(`tests/e2e/sync-server.ts`)에 `/api/agent/**`를 더해 가짜 카카오 로그인 → AI 연결 만들기 → 시험 코드가 그 토큰으로 `POST /api/agent/v1/inbox` → 새로고침 → 알림 → 미리보기 → 가져오기 → 여행 화면 → 받은함 비었음 → 철회 → 같은 토큰 401.
- 미리보기: 실제 계정으로 발급 → `yarn trip send --app <미리보기 주소>` → 휴대폰에서 알림·가져오기 → 다른 기기에 동기화. `share` 링크를 카카오톡으로 열기. CPU 시간.

## 완료 조건

- 위 시험 통과, `yarn typecheck`·`yarn lint`·`yarn test`·`yarn build:ci`(크기·나눔 검사 포함) 통과.
- 로컬에서 실제 키 없이 `yarn dev:sync`(+ 가짜 로그인)로 토큰 발급 → `yarn trip send plan.json --app http://localhost:8795` → 앱 알림 → 가져오기 → 다른 출처(`127.0.0.1`)에 동기화까지 화면으로 된다. `yarn trip share … --app http://localhost:8795`의 짧은 링크가 같은 서버의 `/s/<id>`에서 열린다.
- `yarn trip build tests/fixtures/agent-trip/plan.json --no-routes`(새 시험 고정 파일. `trips/*`는 `.gitignore` 대상이라 두지 않는다)이 서버 없이 데이터 링크를 내고, 그 `/import#d=` 링크로 앱이 같은 여행을 가져온다.
- ④에서 `docs/development.md`·`README.md`·(필요하면) 도움말을 고치고, 각 PR 뒤 `docs/rollback.md`를 갱신한다. 워크스페이스 스킬 연결은 마지막.

## 구현 뒤 바뀐 점(2026-11-02)

PR ① #83·② #85·③ #87의 코드와 검토 반영 커밋을 기준으로 본문을 고쳤다. 아래 「설계」 칸은 변경 전 값·설명이며 현재 동작은 「구현」과 해당 본문 절을 따른다.

| 항목 | 설계 | 구현 | 이유·관련 절 |
|---|---|---|---|
| 구현 상태·기준 | 구현 전, `bc055d6`·v0.24.2 | PR ①~③ 완료, `0b6a2c4`·v0.27.0. 설계 당시 기준도 보존 | 현재 기준 구분. 머리 「상태」·「기준」 |
| 받은함 문서 검사·reason | `readShareHash` → v2·길이·구간 검사, 일부 reason만 명시 | 한 번 풀기 → `agentRawProblem` → `validateShareValue` → v2 → `agentDocProblem` → 실제 구간 → `importedItemProblem`. `labels`·`path`·`import`·`item-too-large` 포함 | 대량 오류 수집·가져오기 비용 제한. 「API › 에이전트 API」·「시험」 |
| 라벨·경로선 | 장소 라벨은 범위 밖, 서버 거절은 미명시 | CLI는 라벨을 만들지 않고 `/import#d=`는 경로선 없음. 받은함 서버는 라벨·경로선을 사전 거절(보기 문서는 경로선 가능) | 모의 가져오기·스키마 CPU. 「세부 결정과 근거」·「하지 않는 것」·「CLI › 처리 순서」·「API」·「보안」 |
| 받은함 풀린 크기·상수 | `decodedBytes` 1,048,576(1MB), `fileBytes` 미명시 | `decodedBytes` 393,216(384KB), `fileBytes` 5,242,880. 본문 40,000바이트·해시 32,000자·장소 200곳 | CPU 절감(6f1fb43). 「세부 결정과 근거」·「보안」·「시험」 |
| 공유 읽기 검사 순서 | 장소 수를 스키마 뒤 검사 | `validateShareValue`는 `newer` → `too-many` → 스키마. 해시·공유 파일 공통, 받은함 서버에는 앞선 원시 검사도 있음 | 큰 모음의 스키마 검사 회피. 「API」·「보안」·「시험」 |
| 서버 모의 가져오기 | CLI만 동기화 항목 상한 검사 | 서버도 `importedItemProblem`으로 기본 가져오기와 200,000자 항목 상한 검사. JSON 길이는 정렬 없이 비교 | 긴 Stop 메모 등으로 가져온 뒤 동기화 실패 방지. 「CLI › 처리 순서」·「API」·「시험」 |
| 받은함 POST 순서 | 문서 검사 뒤 같은 키 처리로 읽힐 수 있음 | 하루 한도 → 본문 읽기·모양 → 만료 안 된 같은 키 반환 → 문서 검사 → 재조회·조건부 INSERT | 재시도의 CPU 절감·한도 원자성 유지. 「세부 결정과 근거」·「API」·「시험」 |
| CLI 성공 출력 | send 예만, `samePoint`와 명령별 키 미명시 | `trip`·`days`·`routes`·`links`·`warnings`, `whoami.connection`, `shares`, `removed`, `share`, `inbox`의 실제 키·시각 형식 | 호출자가 구현 출력 사용. 「CLI › 출력」·「시험」 |
| whoami 사람용 | 한 줄 연결·권한·기한 | `AI 연결:`·`범위:`·`만료:`·`공급자:` 네 줄 | `successText` 반영. 「사용 흐름 › 처음 연결」·「CLI › 출력」 |
| 경고·오류·끝 코드 | `fallback`, 포괄적인 끝 코드 표, reason 필드 없음 | `lookup-failed`·`not-found`·`out-of-range`·`unused-place`·`token-expiring`·`token-origin`·`share-store`. 알려진 서버 422 reason 전달, 코드 `internal`·1 | 오류 원인 보존. `EXIT_BY_CODE`와 실제 파일 실패의 1을 구분. 「CLI › 출력」·「오류·장애」·「시험」 |
| 요청 키 | 계획 해석 결과 + 메모 여부 | 키 정렬 `[plan, includeMemo, noRoutes]`의 SHA-256 base64url | 경로 생략 여부가 다른 전송 구분(877ae7d). 「세부 결정과 근거」·「시험」 |
| 결과 모르는 짧은 링크 | 성공 뒤 삭제 토큰 저장, 응답 상실은 기한 대기 | 요청 전 `pending:<uuid>` 예약, 알려진 거절은 제거, `timeout`·`offline`·`server`는 기한까지 유지·안내 | 응답 상실 뒤 철회 가능(877ae7d·9e41e61·e2a8059). 「세부 결정과 근거」·「CLI」·「시험」 |
| 예약 복구·스위치 | 실제 id 삭제만, 스위치에서도 철회 가능 | `unshare --list`의 `unknown: true`, `unshare pending:<uuid>`의 같은 삭제 토큰 `POST body: 'A'` → DELETE. 같은 `delete_hash` 행이 남아 있으면 만료 여부와 상관없이 기존 id·`expiresAt` 반환. 실패면 예약 유지. 생성 권한·한도 필요, 두 off 스위치에서 실패 | 실제 id 삭제 예외와 복구 제약 구분. 「CLI」·「호환·롤백」·「시험」 |
| 로컬 저장·id | 폴더 700, 옛 잠금 제거, id 인자 | 새 폴더만 700, 기존 권한 유지. 회수 잠금으로 직렬화·동일 파일 확인. `-` 시작 16자 id도 허용 | 기존 폴더·동시 실행 보호(283dcf9·728e279). 「세부 결정과 근거」·「CLI」·「시험」 |
| JSON Schema·입력·파일 | 스키마 출력·상대 경로·파일 실패 세부 미명시 | 패턴·설명, trim·빈 이름/검색어 거절, `INIT_CWD`, `--out`의 `schema`·2, `--schema`는 `--json`만 병용, `--help` 없음 | PR ① 검토 반영(82f9c9f). 「계획 파일」·「CLI」·「시험」 |
| 경로·제목·통계 | 원래 좌표 조회, 모든 구간 추정, 요약에서 조회 시각 | `parseRouteInputKey`의 소수 5자리 좌표, `same-point`는 조회 생략 때도 유지, 문서 여행 제목 출력, 조회 시각은 `routes` | 앱과 같은 조회·출력. 「CLI › 처리 순서」·「출력」·「시험」 |
| 장소 검색·오류 경로 | 정확한 이름 비교, 출처 중복 두 경로 오류 | sid 있는 결과를 NFC·공백 제거·소문자로 비교. 중복은 뒤 경로 오류에 앞 경로를 메시지로 표기. 폴더·후보 오류는 대체 값으로 덮지 않음 | `resolvePlaces`의 실제 진단 반영. 「세부 결정과 근거」·「CLI › 처리 순서」 |
| 토큰 찾기 | 환경변수 우선 → 키체인 | 비어 있지 않은 환경변수 모양 오류면 키체인 대체 없이 없음·4. 키체인은 darwin만, 계정은 포트 포함 host | 잘못된 설정의 조용한 대체 방지. 「세부 결정과 근거」·「시험」 |
| API 성공·삭제 응답 | 성공 모양·시각 타입, 삭제 헤더 오류 미명시 | whoami·inbox는 ms, share는 ISO 문자열. CLI 성공 모양 오류는 `server`·5. 삭제 헤더 없음/오류 400, 틀린 id 404. 만료 여부와 상관없이 남은 행·삭제 토큰 일치로 204/403, 행이 없으면 404 | 잘못된 서버 응답 차단(e2a8059). 「API」·「시험」 |
| 토큰 목록·한도·인증 | 응답·하루 한도 개별 명시, 토큰 실패를 포괄 서술 | 토큰 목록 `enabled`·`canCreate`·`maxActive`·`tokens`, 시각 ms·선택 null. `AGENT_LIMITS` 20/50/50/200/500/2,000/300 확인, 미등록·모양 오류만 IP 실패 카운터 | 실제 API·인증 경계 구체화. 「API」·「시험」 |
| 받은함 확인·부트 | 첫 synced·동기화 완료, 10분 기준 불명확 | synced·conflict, 숨긴 탭 제외, 시작 시각 기준 10분, 세션 교체 결과 버림·한 번 재확인, 시작 실패 뒤 재시도 | PR ③ 검토 반영(ff2a1d9). 「사용 흐름」·「앱 › 받은함 확인」·「시험」 |
| 알림 기록·창 문구 | 알린 id, 받은함 오류 포괄 | `{ v: 1, userId: string \| null, notified: string[] }`의 직전 목록 id 최대 100개, 새 id면 전체 수 알림. 빈 창·없는 항목·요청 실패·버리기 확인의 실제 문구 | 실제 저장·안내 반영. 「사용 흐름」·「앱」·「오류·장애」·「시험」 |
| AI 연결 설정·토큰 창 | 목록 실패·받은함 실패 분리 미명시, 원문 한 번 | 토큰 목록 원인별 실패와 받은함 실패·재시도 분리, `받은 일정 없음`. 원문 표시 중 바깥/ Esc 닫기 방지, 늦은 발급 성공은 목록만 갱신 | 오류 구분·원문 유실 방지. 「앱 › 설정」·「시험」 |
| 받은함 창·조각·미리보기 | 실행기가 창을 여는 것으로 설명, 부트 gzip 0.5KB 목표, 머리 조사 고정 | 셸의 `AgentInboxHost`·`agentInboxOpenAtom`, 지연 조각 실패 안내. 머리 주격 조사 자동·이름 없는 연결, 가져오기 잠금 안 계정 재확인 | 창 수명·실패 처리·계정 경계 반영. 「앱 › 미리보기와 가져오기」·「첫 로딩·조각」·「단계」·「시험」 |
| 서버 로그 | 메서드·경로·상태·시간만 | 알 수 없는 500에 `error`·선택 `d1` 진단 필드 추가, 메시지 본문은 제외 | 장애 원인 구분과 비밀 배제(877ae7d). 「API」·「보안」 |

## 결정 기록

| 날짜 | 항목 | 결정 |
|---|---|---|
| 2026-11-01 | 에이전트가 만든 짧은 링크 철회 | **B안**: 삭제 토큰을 `~/.landmark/agent-shares.json`(600)에 두고 `yarn trip unshare`로 지운다(PR ②). 비교한 안: A. 기한까지 철회 없음, C. 서버가 토큰별 링크를 기록해 설정에서 지우기 |
| 2026-11-02 | 설계서 구현 반영 | 본문을 구현 기준으로 고치고 차이는 「구현 뒤 바뀐 점」에 모음 |
