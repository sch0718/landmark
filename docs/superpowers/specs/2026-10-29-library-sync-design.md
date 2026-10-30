# 기기 간 보관함 동기화(로그인) 설계

본인이 켠 기기끼리 보관함(장소·라벨·여행·폴더 연결·약속)을 서버(Cloudflare D1)를 거쳐 맞춘다.
[서버·DB 도입 검토 제안서](2026-10-25-server-db-proposal.md) 9절 로드맵의 3단계이고, 4단계(서버 스냅샷 백업·폴더 변경 알림)가 이 단계의 로그인 세션 위에 올라간다.
로그인은 공용 패키지 `@sch0718/firebase-session@0.2.1`을 쓰며 가즈아(`sch0718/gazua`의 `sync-worker`, `src/lib/sync/`)와 repass(`sch0718/repass`의 `worker/`, `app/src/lib/sync/`)의 연결 방식을 본보기로 삼는다.

- 작성일: 2026-10-29
- 상태: 설계 확정(구현 전). 구현은 계획서 `docs/superpowers/plans/2026-10-29-library-sync.md`를 따른다.
- 기준: `main` `fb0fee5`(v0.20.2 뒤). D1 `SCHEMA_VERSION` 2 → **5**(2A=3, 2B=4가 먼저 병합된다. 표 정의는 모두 멱등이라 병합 때 큰 번호로 맞춘다).

## 결정 요약

| 항목 | 결정 |
|---|---|
| 켜는 사람 | **본인이 설정에서 켤 때만.** 로그인·업로드를 강제하지 않는다. 끈 기기는 지금과 똑같이 동작한다 |
| 로그인 | `@sch0718/firebase-session@0.2.1`. Google(Firebase Auth 팝업) + 카카오·네이버(OIDC 리다이렉트, 서버가 id_token 검증) → D1 자체 기기 세션. 허용 계정은 Google `ALLOWED_EMAILS`, 카카오·네이버 `ALLOWED_ACCOUNTS`. 설정이 없는 공급자는 버튼을 숨긴다 |
| 서버 연결 | Pages Functions 한 진입점 `functions/api/sync/[[path]].ts` → `src/server/library-sync/router.ts`. 패키지 경로(`/v1/session` 등)를 `/api/sync` 아래에 그대로 둔다. 같은 출처라 CORS를 쓰지 않는다 |
| 패키지 마이그레이션 | 패키지의 `0001_users_sessions.sql` + `firebase-session-0002_social_sessions.sql`을 **`identity` 열을 처음부터 넣은 `CREATE TABLE IF NOT EXISTS sessions`**로 합쳐 `SCHEMA_STATEMENTS` 끝에 넣는다(`ALTER TABLE`은 멱등이 아니라 `ensureSchema`에 넣지 않는다) |
| 저장 단위 | 서버는 **항목별 행**(`library_items`: 장소·라벨·여행·약속·폴더 연결 하나가 한 행). 사용자별 단조 증가 `rev`가 변경 커서다 |
| 로컬 형식 | `tripmap:library:v2`(schemaVersion 2)를 **그대로** 둔다. 동기화 정보는 별도 키 4개(`tripmap:sync:v1`·`tripmap:sync-base:v1`·`tripmap:sync-conflicts:v1`·`tripmap:sync-session:v1`)에 둔다. 백업 파일에 넣지 않는다 |
| 변경 큐 | 항목 해시를 "마지막으로 서버와 맞춘 해시(base)"와 비교해 **다른 항목이 큐**다(가즈아 `src/lib/sync/engine.ts`와 같은 방식). 따로 쓰는 큐가 없어 탭 종료·저장 실패 사이에 변경을 잃지 않는다 |
| 충돌 | **필드 단위 마지막 변경**(기존 `pickField`, `{ value, updatedAt }`). 삭제·복원은 base의 삭제 여부로 3-way 판단. 이 기기에서 지난 동기화 뒤 고친 값이 졌으면 `확인 필요한 충돌`로 남겨 되돌릴 수 있게 한다(조용한 유실 금지) |
| 삭제 | 보관함의 `deletedAt` 묘비를 그대로 올린다. 서버는 삭제 뒤 **90일**이 지난 묘비를 지우고(여행이 가리키는 장소 묘비는 남김), 그보다 오래된 커서를 가진 기기는 **전체 재동기화**한다 |
| 갱신 시점 | 앱 열기·탭 복귀(`visibilitychange`)·저장 직후(2초 모음)·온라인 복귀 때만. 주기 확인은 없다 |
| 서버 저장 | 일반 저장(종단간 암호화 없음). 설정 화면에서 켜기 전에 알린다 |
| 남용 방지 | 허용 계정만 읽고 쓴다. 로그인 시도는 IP 해시별 하루 60번, 동기화는 사용자별 하루 한도(요청·항목 수), 요청·항목 크기 상한, 만료 정리는 요청 때 함께(약속 온라인 집계와 같은 `rate_counters`·`IP_HASH_SALT`). Turnstile은 쓰지 않는다(아래 결정과 근거) |
| 첫 로딩 | 동기화를 켜지 않은 사용자는 설정 플래그 읽기(수백 바이트)만 받는다. 엔진·패키지·Firebase SDK는 나눠 받는다 |
| 기능 스위치 | `LIBRARY_SYNC=off`면 로그인·받기·올리기가 503(`off`). 연결 해제·서버 자료 지우기는 계속 된다 |
| 개발용 로그인 | 개발 서버에서만 켜지는 **가짜 카카오·네이버 공급자**(repass `devFakeSocial` 방식). 실제 패키지 코드 경로(`createSocial`·PKCE·nonce·JWKS 검증)를 그대로 지나며 키가 필요 없다 |
| 구현 | Codex(gpt-6.1-sol high)가 구현하고 Claude가 검증한다 |

### 결정과 근거(브레인스토밍 대신 하위 에이전트가 정함)

사용자에게 물을 수 없어 아래는 근거를 적고 정했다. 바꾸려면 이 표와 계획서를 함께 고친다.

| 열린 결정 | 정한 것 | 근거 |
|---|---|---|
| 병합을 어디서 하나 | **서버와 브라우저가 같은 순수 함수**(`src/domain/library-sync/merge.ts`)로 합친다. 서버는 올린 항목을 저장본과 합쳐 저장하고(409로 되돌려 보내지 않음), 브라우저는 받은 항목을 보관함과 합친다 | 필드별 LWW는 교환·결합·멱등이라 어느 쪽에서 합쳐도 같은 값으로 모인다. 409 재시도 왕복이 없어 요청 수(무료 한도)가 준다. 약속 온라인 집계도 Effect Schema를 서버·브라우저가 함께 쓴다 |
| 변경 큐 저장 | localStorage에 항목별 base(`rev`+해시+삭제 여부, 항목당 약 40자)만 둔다. IndexedDB는 쓰지 않는다 | 실제 보관함 3,202곳 기준 base는 약 13만 자. 새 의존성(`idb`·`fake-indexeddb`) 없이 jsdom 시험이 된다. 넘치면 동기화를 멈추고 알린다 |
| 삭제·복원 판단 | 항목 base의 삭제 여부와 비교하는 3-way(바꾼 쪽이 이긴다). base가 없으면(처음 합치기) 시각 비교 | `deletedAt: null`만으로는 복원이 새 명령인지 오래된 사본인지 모른다(제안서 §5.2). 보관함 형식을 바꾸지 않고 해결한다 |
| 여행 `days` | 날짜 두 필드와 `days`를 한 덩어리로 보고(날짜 시각이 늦은 쪽), 날 수가 같으면 Day별 필드(`stops`·`lodging`·`startTime`)를 LWW로 합친다. 합친 결과가 `checkTrip`을 어기면 여행 전체를 마지막 변경 쪽으로 고르고 진 쪽을 충돌로 남긴다 | `days`는 LWW 필드가 아니고(제안서 §5.2) 날 수가 기간과 같아야 한다. `setTripDates`는 두 날짜를 같은 시각으로 쓴다 |
| 서로 다른 id의 같은 장소·라벨 | 동기화를 반영한 뒤 **결정적 정리**: 같은 네이버 sid(카카오·구글·옛 키 포함)의 살아 있는 장소, 같은 정규화 이름의 라벨은 `createdAt`·id가 가장 앞선 쪽으로 합친다(라벨은 기존 `mergeLabels`). 여행 참조도 옮긴다 | 두 기기가 오프라인에서 같은 장소를 따로 저장하면 `LibrarySchema`가 거부한다. 두 기기가 같은 규칙으로 같은 결과를 낸다 |
| 첫 연결 선택지 | 서버가 비면 `이 기기 보관함 올리기`. 서버에 자료가 있으면 `합치기`(권장)·`서버 보관함으로 바꾸기`(이 기기 보관함은 되살리기 사본으로 남김). **`이 기기 보관함으로 서버 바꾸기`는 하지 않는다** | 세 번째는 다른 기기에 삭제를 대량 전파하는 위험한 동작이고 세대 번호가 필요하다. 필요하면 `서버 자료 모두 지우기` 뒤 다시 켜면 된다 |
| Turnstile | 쓰지 않는다 | 읽기·쓰기는 허용 계정 세션만 된다. 로그인 시도만 익명인데 공급자 코드 교환이 먼저 필요해 자동 남용 이득이 작고 IP 한도로 충분하다. 로그인 화면이 바깥 스크립트를 받지 않아도 된다 |
| 상태 표시 위치 | 설정 › 동기화 줄 + 문제(충돌·다시 로그인·멈춤)가 생길 때 알림(`sonner`). 셸 머리에는 두지 않는다 | `AppShell`을 고치지 않아 2A·2B와 병합 충돌이 없고 첫 로딩이 늘지 않는다 |
| 개발용 Google 로그인 | 만들지 않는다. 개발 모드에서는 카카오·네이버 가짜 공급자만 보인다 | Google은 Firebase SDK 팝업이라 가짜로 바꾸려면 데모 프로젝트·개발 RSA 키(repass `devAuth`)까지 필요하다. 동기화 흐름 시험에는 가짜 소셜로 충분하고 Google 경로는 미리보기에서 확인한다 |
| 로컬 개발 출처 | 동기화 API만 "요청 주소가 localhost이고 출처도 `http://localhost:*`·`http://127.0.0.1:*`"이면 포트와 무관하게 받는다. 기존 `isAllowedOrigin`은 바꾸지 않는다 | 사용자 개발 서버(5173·5174)를 비켜 다른 포트로 시험해야 한다. 운영 요청 주소는 localhost가 아니라 열리지 않는다 |
| 두 기기 흉내 | 로컬은 `http://localhost:8795`와 `http://127.0.0.1:8795`(출처가 달라 localStorage가 따로)로, E2E는 Playwright 브라우저 문맥 둘로 | 같은 출처의 두 탭은 저장소를 같이 써 같은 기기다 |

## 하지 않는 것

- 종단간 암호화. 서버 운영자(=저장소 주인)는 D1에서 내용을 읽을 수 있다. 설정 화면에 알린다.
- 실시간 갱신(10초 확인·WebSocket·Durable Objects). 보관함은 열기·복귀·저장·온라인 때만 맞춘다.
- 화면 설정(`tripmap:prefs`), 약속 온라인 토큰(`tripmap:meet-online:v1`·`tripmap:meet-drafts:v1`), 경로·영업시간 캐시, 되살리기 사본, 손상 백업은 동기화하지 않는다(기기별).
- 다른 사람과 보관함 공유. 계정 하나 = 보관함 하나. 공급자가 다르면(같은 사람의 Google·카카오) 다른 사용자다(패키지 규칙: 자동 연결 없음).
- `이 기기 보관함으로 서버 바꾸기`(위 결정 표). 서버 스냅샷 백업·자동 백업·폴더 변경 알림(4단계).
- 개발용 가짜 Google 로그인. 이메일·푸시 알림. Cron.
- 셸 머리의 동기화 상태 아이콘.

## 사용 흐름

### 처음 켜기(첫 기기)

1. 설정 › `동기화`(새 절). 꺼져 있으면 설명을 보인다.
   - "장소·라벨·여행·약속·폴더 연결을 서버에 올려 내 다른 기기와 맞춰요. 메모·출발지도 올라가요."
   - "서버에는 암호화하지 않고 저장해요(운영자가 볼 수 있어요). 화면 설정과 약속 공유 연결은 기기마다 따로예요."
   - `백업 먼저 받기` 단추(기존 백업 받기와 같은 동작)와 로그인 단추 `Google로 로그인`·`카카오로 로그인`·`네이버로 로그인`. 이 배포에서 쓸 수 있는 공급자만 보인다(아래 §로그인).
2. 로그인이 끝나면(카카오·네이버는 `/auth/callback`을 거쳐 설정으로 돌아옴) `GET /api/sync/v1/me`로 서버 보관함 개수를 본다.
3. 연결 방식 대화상자.
   - 서버가 비어 있음: "이 기기 보관함을 올릴까요? 장소 N곳·라벨 N개·여행 N개·약속 N개" → `올리기` / `취소`(연결 해제).
   - 서버에 자료가 있고 이 기기가 비어 있음: `서버 보관함 받기` / `취소`.
   - 둘 다 있음: 선택지 둘.
     - `합치기`(권장): 둘 다 남긴다. 같은 항목은 필드마다 더 최근에 고친 값을 쓴다. 같은 네이버 장소·같은 이름 라벨은 하나로 합친다.
     - `서버 보관함으로 바꾸기`: 이 기기 보관함을 서버 것으로 바꾼다. 지금 보관함은 되살리기 사본으로 남아 설정 › 백업 › `되돌리기`로 돌아갈 수 있다(기존 `LibraryStore.replace`의 사본 규칙).
   - 같은 계정으로 다시 로그인한 기기(전에 맞춘 기록이 그대로 있음)는 묻지 않고 이어서 맞춘다.
4. 진행 중에는 `동기화 중 · 올리는 중 120/3,200`을 보이고, 모든 항목이 서버 확인을 받은 뒤에만 `동기화 완료`를 보인다.

### 두 번째 기기

같은 계정으로 로그인하면 3번 대화상자가 서버 개수와 이 기기 개수를 보여 준다. 새 기기는 보통 `서버 보관함 받기`, 따로 쓰던 기기는 `합치기`.

### 평소

- 앱을 열 때, 숨겼다 다시 볼 때, 저장하고 2초 뒤, 온라인으로 돌아올 때 받기 → 반영 → 올리기를 한 번 한다. 같은 기기의 여러 탭은 Web Locks(`tripmap:library-sync`)로 한 번에 하나만 돈다.
- 다른 기기에서 고친 값이 들어오면 보관함 화면이 그대로 갱신된다(기존 다른 탭 반영과 같은 길).
- 충돌이 생기면 알림 "다른 기기 변경과 겹친 항목이 있어요"와 `확인` 단추(설정 › 동기화의 충돌 목록으로).

### 끄기·연결 해제·서버 자료 지우기

| 동작 | 위치 | 하는 일 |
|---|---|---|
| `동기화 끄기` | 설정 › 동기화 | 이 기기만 보내기·받기를 멈춘다. 로그인과 맞춘 기록은 남겨 `다시 켜기`로 바로 이어 간다 |
| `연결 해제` | 설정 › 동기화 | 이 기기 세션을 철회(`DELETE /v1/session`)하고 저장된 세션을 지운다. 보관함은 그대로다. 맞춘 기록(base·커서·사용자 id)은 남겨 같은 계정으로 다시 로그인하면 묻지 않고 이어 간다 |
| `다른 기기 연결 끊기` | 설정 › 동기화 › 기기 목록 | 그 기기 세션을 철회(`DELETE /v1/sessions/:id`). 그 기기는 다음 동기화에서 "다시 로그인해 주세요"가 된다 |
| `서버 자료 모두 지우기` | 설정 › 동기화 (확인 대화상자에 "지우기" 입력) | 이 계정의 서버 보관함·기기 기록·모든 세션·사용자 행을 지운다(`DELETE /v1/account`). 모든 기기의 보관함은 그대로 남고 동기화만 꺼진다 |

### 허용되지 않은 계정

- 카카오·네이버: 서버가 `403 not-allowed`와 `account`(`kakao:<sub>`)를 돌려준다. 화면: "이 계정은 아직 동기화를 쓸 수 없어요. 아래 값을 관리자에게 알려 주세요" + 값 + `복사`. 세션은 생기지 않는다.
- Google: `403 not-allowed`. 화면에 로그인한 이메일을 보이고 같은 안내. Firebase에서 로그아웃한다.
- 관리자(=사용자)는 그 값을 `ALLOWED_ACCOUNTS`/`ALLOWED_EMAILS`에 더하고 다시 배포한다(§사용자가 할 일).

## 동기화 프로토콜 v1

### 항목과 키

| 종류(`kind`) | 보관함 위치 | id | 화면 이름(충돌 목록) |
|---|---|---|---|
| `label` | `labels[id]` | `LabelId`(8자) | `name.value` |
| `place` | `places[id]` | `PlaceId`(10자) | `name.value` |
| `folder` | `folders[shareId]` | `ShareId` | `name.value` |
| `trip` | `trips[id]` | `TripId`(10자) | `title.value` |
| `meeting` | `meetings[id]` | `MeetingId`(10자) | `title.value` |

- 키는 `<kind>:<id>`. 올리는 순서는 `label → place → folder → trip → meeting`(참조되는 쪽 먼저).
- 항목 문서(`doc`)는 보관함의 그 값 그대로다(스키마로 해석한 값, 키 정렬한 JSON). 서버와 브라우저는 종류별 스키마(`LabelSchema`·`PlaceSchema`·`FolderLinkSchema`·`TripSchema`+`checkTrip`·`MeetingSchema`+`checkMeeting`)로 검사한다.
- 해시: 키를 정렬한 JSON의 cyrb53(53비트, base36). 우연히 같을 확률은 무시할 수준이다.

### 이 기기의 기록(브라우저)

| 키 | 값 | 비고 |
|---|---|---|
| `tripmap:sync:v1` | `{ v: 1, enabled, pendingChoice, userId, provider, accountLabel, deviceId, cursor: { rev, key } \| null, lastSyncAt, held[], skipped[], rejected[] }` | 앱 시작 때 `enabled && !pendingChoice`만 읽는다. `deviceId`는 16자 a-z0-9(처음 만들 때) |
| `tripmap:sync-base:v1` | `{ v: 1, userId, items: { [key]: "<rev36>.<hash>" 또는 "<rev36>.<hash>.d" } }` | `.d`는 그 항목의 서버 쪽이 묘비였다는 뜻 |
| `tripmap:sync-conflicts:v1` | `{ v: 1, items: Conflict[] }` | 최신 50건, 직렬화 20만 자 넘으면 오래된 것부터 버림 |
| `tripmap:sync-session:v1` | `{ v: 1, sessionId, provider }` | 자격 증명. 로그·URL·백업에 넣지 않는다 |

깨진 값은 빈 기록으로 읽는다(`enabled: false`). 저장소가 막히면 동기화를 켤 수 없다고 안내한다(메모리 모드에서는 켜지 않음).

### 한 번의 실행

`tripmap:library-sync` Web Lock 안에서 차례로 한다.

1. **받기**: `GET /v1/library/changes?since=<cursor.rev>&after=<cursor.key>&limit=500&device=<deviceId>`를 `more=false`가 될 때까지 되풀이해 메모리에 모은다(중간 상태를 보관함에 쓰지 않는다 — 여행이 장소보다 먼저 오는 쪽 경계에서 검증이 깨지지 않게).
   - `410 resync`면 커서를 버리고 `since=0`부터 다시 받는다(전체 재동기화, 한 실행에 한 번).
   - base에는 있는데 보관함에 없는 키가 하나라도 있으면(백업 복원 등으로 항목이 사라짐) 이번 실행을 전체 재동기화로 한다.
2. **반영**: `LibraryStore.update` 하나 안에서 `applyRemote`(아래) → `repairLibrary` → 검증. 같은 탭의 `libraryAtom`도 바꾼다(다른 탭은 `storage` 이벤트로 받는다).
3. **올리기**: 보관함 스냅샷에서 해시가 base와 다른 항목을 순서대로 100개·90만 바이트씩 `POST /v1/library/push`. 응답의 서버 결과를 다시 `LibraryStore.update`로 반영하고 base를 바꾼다.
4. 기록 저장: 커서·`lastSyncAt`·base·충돌·보류.

### 받은 항목 반영(`applyRemote`)

키마다 `local`(보관함 값), `base`(기록), `remote`(서버 값)로 판단한다.

| 경우 | 결과 | base |
|---|---|---|
| `base.rev >= remote.rev` | 건너뜀(자기 올리기의 메아리) | 그대로 |
| `local` 없음 | `remote`를 넣는다(묘비도 넣는다: 여행이 묘비 장소를 가리킬 수 있다) | remote |
| `local` 해시 = `base` 해시(이 기기에서 안 고침) | `remote`로 바꾼다 | remote |
| 그 밖(양쪽이 고침) | `mergeItem(kind, local, remote, { baseDeleted })` | remote(합친 결과가 remote와 다르면 다음 올리기 대상) |

전체 재동기화일 때 base에 있는데 서버에 없는 키는 다음처럼 처리한다. 서버의 90일 지난 묘비가 정리돼도 base가 live이면 삭제가 이긴다. base가 묘비이고 로컬에서 되살린 live 항목만 보존한다.

| 로컬 항목 | 결과 | base |
|---|---|---|
| 없음 | 그대로 | 키 삭제 |
| 이미 묘비 | 그대로 | 로컬 묘비 해시·`rev 0`·`deleted: true`로 맞춰 다시 올리지 않음 |
| live이고 base도 live(`deleted === false`), 해시 일치 여부 무관 | 다른 기기 삭제가 전파된 것으로 보고 `deletedAt = 지금`으로 지움(기존 충돌 기록 조건 적용) | 그 묘비 해시·`rev 0`·`deleted: true` |
| live이고 base는 묘비(`deleted !== false`, 로컬에서 되살림) | 로컬 항목 그대로 보존 | 키 삭제. 다음 올리기에서 `dirtyItems`가 새 항목(`baseRev: 0`, `baseDeleted: null`)으로 보냄 |

### 필드 병합(`mergeItem`, 서버·브라우저 공용, 교환법칙 성립)

- `{ value, updatedAt }` 필드: `pickField`(시각이 늦은 쪽, 같으면 JSON 사전순).
- 선택 필드(`visitedOn`·`review`·라벨 `emoji`): 한쪽만 있으면 있는 쪽. 둘 다 있으면 `pickField`. 옛 앱이 모르는 새 필드를 지우지 못한다.
- 바뀌지 않는 값(`source`·`address`·`lng`·`lat`): 두 값이 같으면 그대로, 다르면 `createdAt`이 앞선 쪽(같으면 JSON 사전순). `createdAt`은 이른 값. 폴더 `checkedAt`은 늦은 값.
- 삭제(`deletedAt`):
  - 둘 다 같은 상태면 그대로(둘 다 묘비면 늦은 `deletedAt`).
  - 다르고 `baseDeleted`가 있으면 base와 달라진 쪽(바꾼 쪽)을 따른다.
  - `baseDeleted`가 없으면(처음 합치기) 묘비의 `deletedAt`과 살아 있는 쪽의 마지막 필드 시각 중 늦은 쪽, 같으면 묘비.
- 여행: 위 결정 표. `days` 길이가 다르면 날짜가 이긴 쪽의 `days` 전체를 쓴다. 합친 여행이 `checkTrip`(장소 존재 검사는 이 여행이 가리키는 id를 모두 있는 것으로 보고)을 어기면 여행 전체를 "모든 필드 시각 중 최대가 늦은 쪽"으로 고른다(`whole`).
- 약속: 필드 LWW 뒤 `checkMeeting`을 어기면 같은 방식으로 전체를 고른다.
- 결과에는 진 쪽 필드 목록(`losers: { path, side, value, updatedAt }[]`)과 `whole?: 'a' | 'b'`가 붙는다.

### 충돌 기록(`확인 필요한 충돌`)

- 브라우저가 `local`과 `remote`를 합칠 때만 판단한다. **진 쪽이 `local`이고 그 필드의 `updatedAt`이 이 기기의 지난 `lastSyncAt`보다 늦으면**(지난 동기화 뒤 이 기기에서 고친 값) 충돌로 남긴다. 첫 연결(`lastSyncAt === null`)의 합치기는 충돌로 남기지 않는다.
- 여행 날짜·날 수 충돌은 `dates` 한 건에 두 날짜와 `days`를 함께 기록한다. 날짜 충돌과 함께 생긴 Day 필드 충돌도 이 묶음에 포함한다. 내 값으로 되돌리면 두 날짜와 모든 Day 필드의 시각을 지금으로 갱신하고 함께 저장한다. 날짜가 같은 여행의 Day별 충돌은 기존 경로를 쓴다.
- 여행·약속 전체 선택(`whole`)에서 이 기기 쪽이 졌으면 항목 하나를 통째로 남긴다.
- 서버 묘비를 받아 삭제가 이긴 항목을 이 기기에서 고쳤으면 "다른 기기에서 지운 ○○을 이 기기에서 고쳤어요"로 남긴다(제안서 §5.3). 전체 재동기화에서 서버 행 자체가 없어도 base가 live이면 같은 규칙으로 삭제가 이긴다. `lastTouched(mine) > lastSyncAt`인 경우에만 충돌로 남겨 `내 값으로 되돌리기`로 살릴 수 있고, 그렇지 않거나 첫 연결이면 조용히 묘비로 맞춘다. base가 묘비이고 이 기기에서 되살린 live 항목만 보존해 다시 올리며, 이 경우에는 충돌로 남기지 않는다.
- `Conflict = { id, key, kind, label, path, mine, theirs, at, whole?: true, deleted?: true }`. 화면 동작: `내 값으로 되돌리기`(그 필드를 지금 시각으로 다시 씀 → 다음 동기화에서 이김. 전체·삭제면 이 기기 사본의 모든 필드 시각을 지금으로 바꿔 되살림) / `그대로 두기`(목록에서 지움).

### 반영 뒤 정리(`repairLibrary`, 결정적)

1. 살아 있는 라벨 중 정규화 이름이 같은 것: `(createdAt, id)`가 가장 앞선 라벨로 기존 `mergeLabels(lib, from, into, ctx)`를 부른다.
2. 살아 있는 장소 중 같은 출처 키(네이버 sid·카카오 id·구글 id·옛 `publicId/placeKey`): 앞선 장소가 남는다. 남는 장소의 LWW 필드는 두 장소를 `pickField`로 합치고 `labelIds`는 합집합(시각은 큰 쪽), 뒤 장소는 `deletedAt = now`. 모든 여행에서 뒤 장소 id를 앞 장소 id로 바꾸되, 그 여행의 후보·Stop에 앞 장소가 이미 있으면 그 자리만 그대로 둔다(묘비 참조는 허용).
3. 살아 있는 장소의 `labelIds`에서 없거나 지운 라벨을 뺀다(`setField`, now).
4. 살아 있는 폴더 연결의 라벨이 없거나 지워졌으면 연결을 지운다(`deleteLabel`의 연결 정리와 같은 뜻).

정리로 바뀐 항목은 해시가 base와 달라 다음 올리기 대상이 된다. 두 기기가 같은 입력에서 같은 결과를 낸다.

### 검증 실패와 보류(`held`)

정리 뒤 `LibrarySchema`가 실패하면 이슈 경로(`places.<id>.…`, `trips.<id>.…`)로 원인 항목을 찾아 그 항목만 반영 전 값으로 되돌리고(없던 항목이면 넣지 않음) 다시 검증한다. 되돌린 항목은 `held`(`{ key, rev, reason }`)에 남기고 커서를 `min(held.rev) - 1`로 둬 다음 실행에서 다시 받는다. 설정에 "이 기기에 넣지 못한 항목 N개"와 `이 기기 값으로 맞추기`(이 기기 값의 시각을 지금으로 바꿔 올림, 이 기기에 없으면 숨김) / `건너뛰기`(그 키를 다시 받지 않음)를 둔다. 상태는 `확인 필요한 충돌`이다.

### 올리기(서버)

요청 `{ v: 1, deviceId, items: [{ kind, id, baseRev, baseDeleted, doc }] }`(1~100개, 본문 1,000,000바이트 이하, 항목 `doc` 직렬화 200,000자 이하).

1. 저장본을 한 번에 읽는다(`json_each`로 키 목록). 지금 `library_state.rev`를 `R0`로 기억한다.
2. 항목마다: 스키마 검사(실패 `invalid`), 크기(`too-large`), 시각이 서버 시각 + 10분보다 늦은 필드(`clock`)는 `rejected`로 돌려준다. 저장본이 없으면 그대로, 저장본 `rev === baseRev`면 올린 값 그대로(다른 기기가 그 사이 안 고침), 그 밖에는 `mergeItem(stored, pushed, { baseDeleted })`. 결과가 저장본과 같으면 쓰지 않는다.
3. 쓸 항목이 있으면 한 `batch`: `library_state.rev += 1` → `json_each`로 모두 upsert(`rev`는 새 `library_state.rev`, `ON CONFLICT … DO UPDATE … WHERE library_items.rev <= R0`) → 새 `rev` 읽기. upsert 변경 수가 쓸 항목 수보다 적으면(그 사이 다른 기기가 같은 항목을 씀) 1부터 다시(최대 3번, 그래도 모자라면 `409 busy` → 브라우저가 다음 실행에서 다시).
4. 응답 `{ rev, results: [{ kind, id, rev, doc? }], rejected: [{ kind, id, reason }] }`. `doc`은 서버 결과가 올린 값과 다를 때만 싣는다.

브라우저는 결과를 받으면: 그 사이 이 기기에서 더 고치지 않았으면(지금 해시 = 올린 해시) 서버 결과로 바꾸고, 더 고쳤으면 `mergeItem`(충돌 판단 포함). base는 서버 결과 해시·`rev`. `rejected`는 `{ key, hash, reason }`로 남겨 그 항목이 다시 바뀌기 전까지 올리지 않는다.

### 묘비 90일과 전체 재동기화

- 서버는 행이 묘비가 될 때 서버 시각을 `deleted_at`에 적는다. 묘비에서 살아나면 `NULL`.
- 받기 요청 때 그 사용자의 `library_state.purged_at`이 24시간보다 오래됐으면 `waitUntil`로 정리한다: `deleted_at`이 90일 지난 묘비를 최대 500개 지우되, 어떤 여행 행의 `refs`(`,<placeId>,…,`)에 들어 있는 장소 묘비는 남긴다. 지운 행의 최대 `rev`로 `purged_rev`를 올린다.
- 받기 요청의 `since`가 0보다 크고 `purged_rev`보다 작으면 `410 { error: 'resync', purgedRev }`. 브라우저는 `since=0`부터 전체를 받아 위 규칙으로 맞춘다.
- 보관함 묘비는 지금처럼 이 기기에 남는다(지우는 기능은 이번 범위 밖).

## 서버 데이터(D1, 스키마 버전 5)

`src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에** 더하고 `SCHEMA_VERSION = 5`.

```sql
-- 5: 보관함 동기화. users·sessions는 @sch0718/firebase-session 0.2.1의
--    migrations/0001_users_sessions.sql + firebase-session-0002_social_sessions.sql과 같은 최종 모양이다
--    (identity 열을 처음부터 둔다. ALTER TABLE은 ensureSchema가 매번 다시 돌리므로 넣지 않는다).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  firebase_sub TEXT NOT NULL UNIQUE,     -- Google: Firebase uid, 소셜: 'kakao:<sub>'·'naver:<sub>'
  email TEXT NOT NULL,                   -- 소셜은 ''
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,              -- 세션 원문의 SHA-256 hex
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER,
  identity TEXT                          -- 소셜 세션만. Google 세션은 NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS library_state (
  user_id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL,                  -- 마지막으로 발급한 변경 번호
  purged_rev INTEGER NOT NULL,           -- 이 번호 이하의 묘비는 지워졌을 수 있다
  purged_at INTEGER NOT NULL,            -- 마지막 묘비 정리(ms)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS library_items (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- 'label'|'place'|'folder'|'trip'|'meeting'
  item_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  doc TEXT NOT NULL,                     -- 항목 JSON(키 정렬)
  deleted INTEGER NOT NULL,              -- 0|1
  deleted_at INTEGER,                    -- 묘비가 된 서버 시각(ms). 90일 정리 기준
  refs TEXT,                             -- 여행만: ',<placeId>,<placeId>,'
  device_id TEXT NOT NULL,               -- 마지막으로 쓴 기기
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, item_id)
);
CREATE INDEX IF NOT EXISTS library_items_rev ON library_items(user_id, rev, kind, item_id);
CREATE INDEX IF NOT EXISTS library_items_tomb ON library_items(user_id, deleted_at) WHERE deleted = 1;
CREATE TABLE IF NOT EXISTS library_devices (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,               -- 브라우저가 만든 16자
  session_id TEXT NOT NULL,              -- publicSessionId(세션 해시 앞 12자). 세션 목록과 잇는다
  last_rev INTEGER NOT NULL,
  last_sync_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
```

- 시각은 패키지 관례대로 서버 epoch ms(정수)다(약속 표는 ISO 문자열 — 표마다 다르다).
- 행 크기: 항목 문서 20만 자 상한이라 D1 행 2MB 안이다. 실제 장소 행은 약 0.5~1KB.
- D1 쓰기 예산(계정 하루 10만 행, 가즈아와 공유 가능): 첫 올리기는 장소 3,202곳 기준 약 3,300행 + 색인. 평소 저장 한 번은 1~수 행.
- 4단계는 같은 방식으로 자기 표를 목록 끝에 더하고 `SCHEMA_VERSION = 6`으로 둔다.

## API(Pages Functions)

진입점 `functions/api/sync/[[path]].ts`(모든 메서드) → `handleSync(ctx, deps)`. `/api/sync` 뒤 경로로 고른다. 응답은 모두 `Cache-Control: private, no-store`, 오류 본문은 패키지 형식 `{ error: '<code>', ...extra }`(패키지 클라이언트 `toResult`가 401·403·413·422·429·503을 해석한다).
출처 검사: `isAllowedOrigin(origin)` 또는 (요청 주소 호스트가 `localhost`·`127.0.0.1`·`[::1]`이고 출처가 `http://(localhost|127.0.0.1|[::1]):<포트>`). 실패 `403 { error: 'origin' }`.
단, `GET`·`HEAD`이고 `Origin`·`Referer` 헤더가 모두 없으면 `Sec-Fetch-Site`가 `same-origin` 또는 `none`일 때만 허용한다. 리퍼러를 생략한 같은 출처 요청과 직접 탐색을 지원하기 위한 예외이며, Fetch Metadata도 없으면 출처를 확인할 수 없어 거절한다. 출처 헤더가 있거나 다른 메서드이면 기존 출처 검사를 적용한다. 세션 없이 부수 효과를 일으키는 GET은 추가하지 않는다.
`/auth/callback`은 코드가 주소에 있는 동안 `Referrer-Policy: no-referrer`로 보호한다. 렌더 전 코드·state를 주소에서 지우고, 로그인 성공이나 오류 화면의 복귀 링크는 전체 문서를 열어 기본 리퍼러 정책을 회복한다. `resume`의 엔진 시작은 새 문서의 부트 흐름이 담당한다.
인증 헤더: Google은 `Authorization: Bearer <Firebase ID 토큰>` + `X-Landmark-Session`, 카카오·네이버는 `X-Landmark-Session`만. 쿠키를 쓰지 않는다(`credentials: 'omit'`).

| 요청 | 하는 일 | 권한·한도 | 성공 |
|---|---|---|---|
| `GET /v1/status` | 쓸 수 있는지·공급자 | 출처 | `200 { enabled, reason?: 'off' \| 'config', providers: { google, kakao, naver }, devFake }` |
| `POST /v1/session` | Google 세션 만들기(`{ label }`, 5분 안에 로그인한 ID 토큰) | 출처·IP `sync-login` 60/일 | `200 { sessionId, expiresAt }` |
| `POST /v1/session/social` | 카카오·네이버 코드 교환·세션 만들기(`{ provider, code, codeVerifier, redirectUri, label }`) | 출처·IP `sync-login` 60/일 | `200 { sessionId, expiresAt, user }` |
| `DELETE /v1/session` | 이 기기 세션 철회 + 이 세션의 기기 기록 지우기 | 세션 | `200 { revoked }` |
| `GET /v1/sessions` | 로그인한 기기 목록(패키지) | 세션 | `200 { sessions }` |
| `DELETE /v1/sessions?others=1`, `DELETE /v1/sessions/:id` | 다른 기기 철회(패키지) + 그 세션의 기기 기록 지우기 | 세션 | `200 { revoked }` |
| `GET /v1/me` | 사용자·서버 보관함 요약·기기 기록 | 세션 | `200 { userId, provider, account, library: { rev, items, live }, devices: [{ deviceId, sessionId, lastSyncAt }] }` |
| `GET /v1/library/changes` | 받기(`since`, `after`, `limit`≤500, `device`) | 세션·사용자 `sync-pull` 5,000/일 | `200 { rev, items: [{ kind, id, rev, deleted, doc }], more, next: { rev, key }, purgedRev }`, `410 { error: 'resync', purgedRev }` |
| `POST /v1/library/push` | 올리기(위) | 세션·사용자 `sync-push` 2,000/일·항목 `sync-items` 30,000/일 | `200 { rev, results, rejected }`, `409 { error: 'busy' }` |
| `DELETE /v1/account` | 서버 자료 모두 지우기(`{ confirm: 'delete' }`) | 세션 | `204` |
| `GET /dev/fake-social/authorize`, `GET /dev/fake-social/approve` | 개발용 가짜 공급자 화면 | 요청 주소가 localhost **이고** `SYNC_DEV_FAKE_SOCIAL=1` | HTML |

- `LIBRARY_SYNC=off`: `GET /v1/status`는 `enabled: false, reason: 'off'`, 세션 만들기·`/v1/me`·받기·올리기는 `503 { error: 'off' }`. `DELETE /v1/session`·`/v1/sessions*`·`DELETE /v1/account`는 계속 된다.
- `DB`가 없으면 `503 { error: 'config' }`. 공급자 설정이 하나도 없으면 `status.enabled: false, reason: 'config'`.
- 받기 응답은 행의 `doc` 문자열을 다시 해석하지 않고 이어 붙여 만든다(CPU 10ms 안). 올리기는 종류별 Effect Schema 검사가 CPU를 가장 많이 쓴다. 미리보기에서 100개 올리기의 CPU를 재고, 넘으면 `PUSH_MAX_ITEMS`를 50으로 줄인다(상수 하나).
- 정리(요청 때 `waitUntil`): 세션 만들기 성공 때 `purgeSessions(db, now, 100)`와 `pruneLimits`. 받기 때 하루 한 번 그 사용자 묘비 정리.

## 로그인

### 공급자와 버튼

- 버튼은 **빌드 설정과 서버 상태가 둘 다 있을 때만** 보인다.
  - Google: 빌드 변수 `VITE_FIREBASE_API_KEY`·`VITE_FIREBASE_AUTH_DOMAIN`·`VITE_FIREBASE_PROJECT_ID`·`VITE_FIREBASE_APP_ID`가 모두 있고(`readSyncConfig`와 같은 규칙) 서버에 `FIREBASE_PROJECT_ID`가 있음.
  - 카카오: `VITE_KAKAO_LOGIN_CLIENT_ID`(REST API 키. 공유용 `VITE_KAKAO_JS_KEY`와 다름) + 서버 `KAKAO_CLIENT_ID`.
  - 네이버: `VITE_NAVER_LOGIN_CLIENT_ID` + 서버 `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`.
  - 개발 모드(`import.meta.env.DEV`)에서 `VITE_SYNC_DEV_FAKE=1`이면 카카오·네이버 버튼이 가짜 공급자로 간다(서버 `status.devFake`가 참일 때만). 운영 번들에는 가짜 id 문자열이 들어가지 않게 조건을 `import.meta.env.DEV &&` 분기에 직접 둔다(repass `config.ts`와 같음).
  - 설정 › 동기화 절 자체는 위 셋 중 하나라도 빌드 설정이 있거나 개발 가짜가 켜졌을 때만 보인다.
- Google: `firebaseAuth(config).signIn()`(팝업, 막히면 리다이렉트) → ID 토큰으로 `createSession`. 이후 요청마다 `auth.idToken()`을 붙인다(그래서 Google 사용자는 앱을 열 때 Firebase SDK 조각을 받는다). 카카오톡 인앱 브라우저에서는 Google 버튼 아래에 "카카오톡 안에서는 Google 로그인이 막혀요. 카카오·네이버로 로그인하거나 다른 브라우저에서 여세요"를 보인다(`/KAKAOTALK/i`).
- 카카오·네이버: `beginSocialSignIn(provider, { clientId, redirectUri: origin + '/auth/callback' })`. 돌아오면 `/auth/callback` 화면이 `readSocialCallback` → `createSocialSession(callback, label)` → 세션 저장 → `/settings`로 돌아가 연결 방식 대화상자.
- 콜백 URL의 `code`·`state`는 앱이 시작하자마자(`src/main.tsx`, 렌더 전) 메모리로 옮기고 `history.replaceState`로 주소에서 지운다. `public/_headers`에 `/auth/callback`의 `Referrer-Policy: no-referrer`를 둔다.
- 기기 이름(`label`): 브라우저 UA로 만든 `iPhone · Safari`·`Mac · Chrome` 같은 값(40자 안).
- 서버 쪽 리다이렉트 허용 목록(`redirectUris`): `SYNC_REDIRECT_URIS`(콤마)가 있으면 그것, 없으면 요청 주소 출처 + `/auth/callback` 하나.

### 개발용 가짜 공급자

- 서버: `src/server/library-sync/dev-fake-social.ts`. repass `worker/src/devFakeSocial.ts`를 옮긴다. 켜지는 조건은 **요청 주소 호스트가 localhost 계열이고 `SYNC_DEV_FAKE_SOCIAL === '1'`**. 이때 서버는 카카오·네이버 설정을 `clientId: 'dev-fake-kakao' | 'dev-fake-naver'`, `clientSecret: 'dev-fake-secret'`으로 채우고, 패키지 `social.keys`·`social.fetch`에 가짜 JWKS·가짜 토큰 엔드포인트를 넣는다(바깥 네트워크 접속 없음). 허용 목록은 `ALLOWED_ACCOUNTS`가 있으면 그것, 없으면 `kakao:dev-me,naver:dev-me`.
- 가짜 인가 화면(`/api/sync/dev/fake-social/authorize`)은 계정 id 입력(`dev-` 접두가 붙음)과 결과(정상·취소·공급자 오류·코드 거절·공급자 장애)를 고르게 한다. `approve`는 콜백 주소로 가는 HTML(`<meta http-equiv="refresh">`)을 돌려준다(Playwright 가로채기에서도 같은 동작).
- 브라우저: `beginSocialSignIn`의 `navigate`를 바꿔 실제 인가 주소의 질의를 그대로 `/api/sync/dev/fake-social/authorize?provider=…`로 보낸다(repass `fakeAuthorizeUrl`).
- 운영·미리보기에서는 요청 주소가 localhost가 아니라 켜지지 않는다. 시험으로 확인한다.

## 화면 상태

`syncStatusAtom`(첫 로딩 묶음, 작은 atom)의 `phase`와 설정 화면 문구.

| phase | 문구(굵게) | 뒤 설명 |
|---|---|---|
| `off` | 꺼짐 | — |
| `pending-choice` | 연결 방식을 골라 주세요 | 대화상자 다시 열기 단추 |
| `local` | **이 기기에 저장됨** | "올리지 않은 변경 N개" · 오프라인이면 "· 오프라인" |
| `syncing` | **동기화 중** | "받는 중" / "올리는 중 120/3,200" |
| `synced` | **동기화 완료** | "마지막 동기화 오후 3:12" |
| `conflict` | **확인 필요한 충돌** | "충돌 N건 · 넣지 못한 항목 N개 · 올리지 못한 항목 N개" + `확인` |
| `auth` | 다시 로그인해 주세요 | 세션 만료·철회. 보관함은 그대로 |
| `not-allowed` | 이 계정은 쓸 수 없어요 | 허용 계정 안내 |
| `unavailable` | 지금은 동기화를 쓸 수 없어요 | `LIBRARY_SYNC=off`·설정 누락·한도 초과. 이 기기에는 계속 저장 |
| `error` | 동기화를 멈췄어요 | 저장 공간 부족 등. 원인 한 줄 |

- 알림(`sonner`): `conflict`로 바뀔 때 "다른 기기 변경과 겹친 항목이 있어요"(`확인` → `/settings#sync`), `auth`로 바뀔 때 "동기화 로그인이 끊겼어요". 같은 상태에서는 다시 띄우지 않는다.

## 오류·장애

| 상황 | 동작 |
|---|---|
| 오프라인 | 실행하지 않고 `local`. `online` 이벤트에 다시 |
| 서버 장애·5xx·429·503 `off` | 보관함은 계속 저장된다. `unavailable`/`local`. 화면이 보일 때 30초 → 2분 → 10분 뒤 다시(최대 10분, 숨기면 멈춤) |
| 401(`session-expired`·`session-revoked`·`no-session` 등) | `auth`. 저장된 세션을 지운다. 맞춘 기록은 남겨 다시 로그인하면 이어 간다 |
| 403 `not-allowed`(로그인 뒤 허용 목록에서 빠짐) | `not-allowed`. 세션을 지운다 |
| 410 `resync` | 전체 재동기화(위) |
| 409 `busy` | 다음 실행에서 다시 |
| 413·422(크기·형식) | 그 항목을 `rejected`에 남기고 나머지는 계속 |
| 보관함 저장 공간 부족(`StorageQuotaExceeded`) | `error` "저장 공간이 부족해 동기화를 멈췄어요". 기존 캐시 정리 규칙 그대로 |
| 동기화 기록 키 쓰기 실패 | `error`. 보관함은 그대로 |
| 다른 계정으로 로그인 | `userId`가 다르면 base·커서·충돌을 지우고 첫 연결 대화상자. 이전 계정 자료를 자동으로 올리지 않는다 |
| 서버 자료가 지워짐(다른 기기에서 `서버 자료 모두 지우기`) | 세션이 사라져 401 → `auth`. 다시 로그인하면 새 사용자라 첫 연결 대화상자 |

## 보안

- 세션: 패키지 규칙(32바이트 무작위 → base64url 43자, D1에는 SHA-256 hex, 마지막 사용 뒤 30일 슬라이딩 만료, 기기별 철회). 원문은 `tripmap:sync-session:v1`에만 둔다(XSS 방어는 지금처럼 사용자 문자열을 React 텍스트로만 그린다).
- CSRF: 쿠키를 쓰지 않고 세션·토큰을 사용자 지정 헤더로 보낸다. 다른 사이트의 폼·이미지 요청은 헤더를 붙일 수 없다. 출처 검사도 한다.
- 허용 계정: Google은 `ALLOWED_EMAILS`(이메일 콤마), 카카오·네이버는 `ALLOWED_ACCOUNTS`(`kakao:<sub>,naver:<sub>`). 비면 아무도 못 들어온다. 소셜 세션은 요청마다 허용 목록을 다시 본다(패키지). Google 세션은 요청마다 ID 토큰과 허용 이메일을 본다.
- 사용자 격리: 모든 질의에 `user_id = ?`(세션에서 얻은 값). 요청 본문의 사용자·기기 값은 권한 근거로 쓰지 않는다. `deviceId`는 표시·메아리 판단용이다.
- 크기·빈도: 올리기 본문 1,000,000바이트·항목 100개·항목 20만 자, 받기 `limit` 500. 하루 한도(UTC 날짜, `rate_counters`): 로그인 시도 IP별 60, 받기 사용자별 5,000, 올리기 2,000, 올린 항목 30,000. 넘으면 429.
- 시각 조작: 항목의 `updatedAt`·`createdAt`·`deletedAt`이 서버 시각 + 10분보다 늦으면 `rejected: clock`("기기 시계를 확인해 주세요"). 미래 시각이 모든 변경을 이기는 것을 막는다.
- 로그: 세션·토큰·코드·계정 id·문서 내용을 남기지 않는다. 패키지 설정 오류(`@sch0718/firebase-session:` 메시지)만 남긴다.
- 개발용 가짜 공급자는 요청 주소가 localhost일 때만 열린다(위).
- 미리보기 배포는 미리보기 D1(`landmark-preview`)과 미리보기 변수를 쓴다.

## 첫 로딩·코드 위치

| 묶음 | 파일 | 첫 로딩 |
|---|---|---|
| 부트(플래그 읽기·이벤트·엔진 지연 로딩·콜백 옮기기) | `src/services/library-sync/boot.ts`, `src/services/library-sync/callback-capture.ts`, `src/sections/library-sync/use-sync-boot.ts`, `src/stores/sync-status.ts` | 들어감(gzip 1.5KB 안) |
| 엔진 | `src/services/library-sync/sync-engine.ts`(+ 도메인·API·패키지 client) | `sync-engine-*.js`로 나눔 |
| 설정 절 | `src/sections/library-sync/SyncSection.tsx`(설정 화면에서 `lazy`) | `SyncSection-*.js` |
| 콜백 화면 | `src/sections/library-sync/AuthCallbackPage.tsx` | `AuthCallbackPage-*.js` |
| Firebase SDK | 패키지 `firebaseImpl` | `firebaseImpl-*.js`(Google 로그인·Google 사용자만) |

- `build:ci`에 `--require-lazy SyncSection --require-lazy AuthCallbackPage --require-lazy sync-engine --require-lazy firebaseImpl`을 더한다. 첫 로딩 상한(`perf-budget.json` 327,680) 안이어야 한다.
- 엔진은 어디서나 `loadSyncEngine()`(동적 import)으로만 부른다(정적으로 가져오면 설정 조각에 섞인다).
- 부트는 `LibraryShell`(`src/sections/shell/ShellRoute.tsx`)에서 `useSyncBoot()`로 한 번. `enabled && !pendingChoice`일 때만 엔진을 받는다. 같은 탭의 저장은 `libraryAtom` 구독으로, 다른 탭의 저장은 기존 `storage` 반영으로 같은 atom이 바뀌므로 둘 다 "저장 직후" 실행을 예약한다. 엔진이 반영하며 넣은 문서(`isOwnWrite`)는 저장으로 보지 않는다.

## 호환·롤백

- 보관함 형식·백업 형식은 그대로다. 옛 버전은 동기화 키를 모르고 무시한다. 옛 버전에서 고친 내용도 새 버전으로 돌아오면 해시 비교로 올라간다.
- **옛 버전으로 되돌리면** 동기화가 멈추고(설정 절이 사라짐) 각 기기 보관함은 그대로다. `/auth/callback`은 옛 앱에서 `페이지를 찾을 수 없어요`. D1 자료는 지우지 않으며 새 버전으로 돌아오면 이어 간다. 병합 뒤 `docs/rollback.md`(별도 docs PR)에 적는다.
- 서버 비상구: `LIBRARY_SYNC=off`(Pages 변수, 다시 배포). 앱은 `unavailable`로 보이고 이 기기 저장을 계속한다.
- 백업 복원과 함께 쓸 때: 동기화가 켜진 기기에서 백업을 되살리면 되살린 내용이 이 기기의 새 변경으로 올라가 다른 기기에도 퍼진다(그 사이 다른 기기가 고친 항목은 필드마다 최근 값). 서버 묘비가 정리돼 행이 없으면, base가 묘비였는데 되살린 live 항목만 보존하고 base 키를 지워 새 항목으로 올린다. base가 live이면 해시가 달라도 묘비로 맞추며, 지난 동기화 뒤 이 기기에서 고친 항목은 충돌 목록의 `내 값으로 되돌리기`로 살릴 수 있다. 되살린 뒤 사라진 항목(백업 뒤 만든 것)은 전체 재동기화로 서버에 남아 있는 항목을 다시 받고, 서버에도 없으면 base 키를 지운다. 되살리기 대화상자에 동기화가 켜져 있으면 이 안내를 한 줄 보인다.
- 약속 온라인(1단계)과: 약속 본문·답장은 보관함 약속으로 동기화된다. 주최자 토큰은 기기별이라 다른 기기는 주최자 링크(`#h=`)로 연결해야 한다(지금과 같음).

## 4단계가 쓰는 인터페이스

| 이름 | 위치 | 뜻 |
|---|---|---|
| `requireSyncUser(ctx, deps): Promise<SyncUser>` | `src/server/library-sync/auth.ts` | 출처·스위치는 부른 쪽이 먼저 본다. 세션(+Google ID 토큰)을 검사하고 `SyncUser = { userId: string; sessionHash: string; sessionId: string; provider: 'google' \| 'kakao' \| 'naver'; account: string }`를 돌려준다. 실패는 `SyncHttpError`(401·403·503) |
| `SyncEnv`, `SyncContext`, `SyncDeps` | `src/server/library-sync/env.ts` | Pages 문맥·환경 변수·주입(`now`, `fetch`, `random`, `uuid`, `certs`, `socialKeys`) |
| `syncJson`, `syncError`, `SyncHttpError`, `isSyncOrigin` | `src/server/library-sync/http.ts` | 응답·오류 형식(`{ error: code }`)·출처 검사 |
| `ACCOUNT_DATA_TABLES` | `src/server/library-sync/library.ts` | `DELETE /v1/account`가 `user_id`로 지우는 표 목록(`['library_items', 'library_devices', 'library_state']`). 4단계는 자기 표 이름을 이 배열에 더한다. 세션·사용자 행은 마지막에 따로 지운다 |
| `SYNC_ROUTES` | `src/server/library-sync/router.ts` | `{ method, path: RegExp, run(ctx, deps, params) }[]`. 4단계는 `/v1/backup/*` 경로를 이 배열에 더한다(같은 진입점) |
| 사용자 id | D1 `users.id`(uuid 문자열), `AuthContext.userId`와 같음 | 공급자가 다르면 다른 사용자 |
| 표 이름 | `users`, `sessions`, `library_state`, `library_items`, `library_devices` | 4단계 스냅샷은 `library_items`를 읽어 만들 수 있다(묘비 포함, `deleted = 0`만 살아 있음) |
| `createSyncApi(): SyncApi` | `src/services/library-sync/api.ts` | 패키지 `SessionClient`(`send(method, path, opts)`) 위의 앱 API. 4단계는 `api.client.send('POST', '/v1/backup', { body })`처럼 같은 세션으로 부른다 |
| `readSyncMeta()`, `syncStatusAtom` | `src/services/library-sync/storage.ts`, `src/stores/sync-status.ts` | 로그인 여부(`meta.userId`·세션 있음)·상태 |
| `loadSyncEngine()` | `src/services/library-sync/boot.ts` | 엔진 지연 로딩. 4단계 자동 백업은 엔진의 `onRunFinished(listener)`로 "앱을 연 뒤 첫 동기화가 끝남"을 받는다 |

## 사용자가 할 일(구현 PR 전후)

값·키·시크릿은 저장소에 적지 않는다. 모두 무료이고 결제 정보가 필요 없다(Firebase Spark, 카카오·네이버 개발자 앱, Cloudflare Pages·D1).

1. **공용 패키지 접근**: GitHub › `sch0718` 패키지 `firebase-session` › Package settings › Manage Actions access › `sch0718/landmark` Read 추가. 로컬·Pages 빌드는 기존 `GITHUB_PACKAGES_TOKEN`으로 받는다.
2. **Firebase(Google 로그인)** — 쓰지 않으려면 건너뛴다(버튼이 숨겨짐).
   1. https://console.firebase.google.com 에서 프로젝트를 만든다(예: `landmark-sync`, Spark 요금제, 애널리틱스 끔).
   2. Authentication › Sign-in method › Google 사용 설정.
   3. Authentication › Settings › Authorized domains에 `landmark.sch0718.dev`, `landmark-c5f.pages.dev`를 더한다(`localhost`는 기본).
   4. 프로젝트 설정 › 내 앱 › 웹 앱 추가 → `apiKey`·`authDomain`·`projectId`·`appId`를 확인한다(공개 값).
   5. 운영 `authDomain`을 앱 도메인으로 쓰면(iOS Safari·홈 화면 앱 로그인 안정) Google Cloud Console › API 및 서비스 › 사용자 인증 정보 › OAuth 2.0 클라이언트 ID(Firebase가 만든 웹 클라이언트) › 승인된 리디렉션 URI에 `https://landmark.sch0718.dev/__/auth/handler`를 더한다. 빌드가 `firebaseAuthHelper()`로 `/__/auth/*`를 넣는다.
3. **카카오 로그인** — https://developers.kakao.com › 내 애플리케이션 › 앱 만들기 → 카카오 로그인 사용 설정·OpenID Connect 켜기 → 플랫폼 키 › REST API 키에 Redirect URI `https://landmark.sch0718.dev/auth/callback` 등록 → REST API 키와 클라이언트 시크릿(켜기) 확인. 이메일 동의는 필요 없다.
4. **네이버 로그인** — https://developers.naver.com/apps › 애플리케이션 등록 → 사용 API 네이버 로그인, 환경 PC 웹·모바일 웹, 서비스 URL `https://landmark.sch0718.dev`, Callback URL `https://landmark.sch0718.dev/auth/callback` → Client ID·Secret 확인. 개발 중 상태에서는 멤버관리에 본인 아이디를 등록한다.
5. **Pages 변수**(Cloudflare 대시보드 › Workers & Pages › `landmark` › Settings › Variables and Secrets, Production과 Preview 각각):

   | 이름 | 종류 | 값 |
   |---|---|---|
   | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | 빌드 변수(Plaintext) | 2-4의 값. Preview의 `AUTH_DOMAIN`은 `<projectId>.firebaseapp.com` |
   | `VITE_KAKAO_LOGIN_CLIENT_ID` | 빌드 변수 | 카카오 REST API 키 |
   | `VITE_NAVER_LOGIN_CLIENT_ID` | 빌드 변수 | 네이버 Client ID |
   | `FIREBASE_PROJECT_ID` | 변수 | Firebase 프로젝트 ID |
   | `KAKAO_CLIENT_ID` | 변수 | 카카오 REST API 키 |
   | `NAVER_CLIENT_ID` | 변수 | 네이버 Client ID |
   | `KAKAO_CLIENT_SECRET` | 시크릿(Encrypt) | 카카오 클라이언트 시크릿 |
   | `NAVER_CLIENT_SECRET` | 시크릿 | 네이버 Client Secret |
   | `ALLOWED_EMAILS` | 시크릿 | 허용 Google 이메일(콤마) |
   | `ALLOWED_ACCOUNTS` | 시크릿 | 처음엔 비워 두고 아래 7번에서 채움 |
   | `LIBRARY_SYNC` | 변수(선택) | 끌 때만 `off` |
   | `SYNC_REDIRECT_URIS` | 변수(선택) | 기본(요청 출처 + `/auth/callback`)과 다를 때만 |

   CLI로 넣을 때(사용자가 직접, wrangler 4.142.0): `npx wrangler pages secret put ALLOWED_ACCOUNTS --project-name landmark`(이 명령에는 환경 선택이 없으니 Preview 값은 대시보드에서 넣는다). `IP_HASH_SALT`·`DB` 바인딩은 1단계에서 이미 있다.
6. **D1 반영**: 할 일 없음. 배포 뒤 첫 동기화 요청에서 `ensureSchema`가 표를 만든다. 확인만 하려면(읽기 전용) `npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta"` → `5`(4단계 뒤 `6`), 미리보기는 `landmark-preview`.
7. **허용 계정 등록**: 배포 뒤 본인 카카오·네이버로 로그인 → "쓸 수 없어요" 화면의 값(`kakao:…`)을 복사 → `ALLOWED_ACCOUNTS`에 콤마로 더함 → **다시 배포**(Pages 변수는 새 배포부터 적용: Deployments › 최근 배포 › Retry deployment) → 다시 로그인.

## 시험

- 단위(vitest)
  - 도메인: 항목 목록·키·해시(같은 내용 같은 해시, 키 순서 무관), `mergeItem` 종류별(필드 LWW·선택 필드·바뀌지 않는 값·삭제 3-way 네 갈래·시각 비교·여행 Day 병합·날 수 다름·`checkTrip` 위반 전체 선택·약속 전체 선택) **교환법칙과 멱등**(모든 사례에서 `merge(a,b)`와 `merge(b,a)`의 문서가 같고 `merge(m,m) = m`), `applyRemote`(메아리·새 항목·안 고친 항목·양쪽 고침·충돌 판단·첫 연결 무충돌·전체 재동기화 삭제), `repairLibrary`(라벨 이름·장소 sid 중복·여행 참조 옮김·끊긴 라벨·폴더), 보류(검증 실패 항목만 되돌림).
  - 서버(`node:sqlite` 가짜 D1, `// @vitest-environment node`): 스키마 5와 멱등 재실행, 출처(운영·미리보기·로컬 임의 포트·운영 주소에 로컬 출처 거절), 스위치 off, 상태, 가짜 소셜 로그인 전체(인가 화면 → 승인 → `createSocial`) · 허용 밖 403·운영 주소에서 가짜 공급자 404, 세션 없는 요청 401, 받기 커서·쪽 나누기·410, 올리기(새 항목·같은 rev 그대로·병합·변경 없음 쓰지 않음·rejected 세 가지·동시 쓰기 재시도·사용자 격리), 묘비 정리(90일·여행 참조 장소 남김·`purged_rev`), 계정 지우기, 하루 한도 429.
  - 브라우저: 기록 키 읽기·깨진 값, API 오류 해석(410·409·503 off), 엔진(받기→반영→올리기 순서·Web Lock 직렬·실패 간격·오프라인·401에서 세션 지움·다른 계정), 부트(꺼진 사용자는 엔진을 받지 않음), 콜백 옮기기(주소에서 코드 지움).
  - 화면: 설정 절(공급자 버튼 숨김·설명 문구·상태 문구·연결 방식 세 경우·허용 밖 화면·충돌 목록 동작·지우기 확인).
- E2E(Playwright, desktop): `/api/sync/**`를 `page.route`로 시험 프로세스 안의 진짜 처리 코드와 `node:sqlite` D1에 넘긴다(`tests/e2e/sync-server.ts`, 약속 `meet-server.ts`와 같은 방식). 문맥 A(장소 있음) 가짜 카카오 로그인 → 올리기 → 문맥 B 로그인 → 받기 → A 메모 수정 → B 다시 열면 반영 → B 오프라인 수정·A 나중 수정 → B 충돌 → `내 값으로 되돌리기` → A 반영 → 문맥 C 허용 밖 계정 → A `서버 자료 모두 지우기` → B 다시 로그인 안내.
- 미리보기: Google·카카오·네이버 실제 로그인, 올리기 100개의 CPU 시간(Workers 지표), iOS Safari·카카오톡 인앱 복귀.

## 완료 조건

- 위 시험 통과, `yarn typecheck`·`yarn lint`·`yarn test`·`yarn build:ci`(크기·나눔 검사 포함) 통과.
- 로컬에서 실제 키 없이 `yarn dev:sync`로 두 출처(`localhost`·`127.0.0.1`)가 로그인 → 올리기 → 받기 → 충돌 → 지우기까지 화면으로 된다.
- `docs/development.md`(동기화 절: 변수·로컬 실행·가짜 로그인·두 기기 흉내·API), 도움말 설정 메뉴(동기화 한 단계), `README.md` 기능 목록 한 줄, 오픈소스 고지(`yarn build:notices`)를 고친다. `docs/rollback.md`는 병합 뒤 별도 PR.
- 운영에서 휴대폰과 PC로 같은 계정 로그인 뒤 한쪽 메모가 다른 쪽을 열 때 들어오는 것을 확인한다.
