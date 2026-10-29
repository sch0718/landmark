# 서버 백업(자동 백업)·네이버 폴더 변경 알림 설계

로그인한 사용자의 보관함 스냅샷 하나를 서버(Cloudflare D1)에 두고, 앱을 열 때 하루 한 번 자동으로 새로 고친다. 네이버 폴더에서 가져온 라벨은 앱을 열 때 하루 한 번 원본 폴더를 다시 읽어, 바뀐 장소 수를 앱 안에서 알린다.
[서버·DB 도입 검토 제안서](2026-10-25-server-db-proposal.md) 9절 로드맵의 4단계이고, 3단계 [기기 간 보관함 동기화(로그인)](2026-10-29-library-sync-design.md)의 로그인 세션 위에 올라간다.

- 작성일: 2026-10-29
- 상태: 설계 확정(구현 전). 구현은 계획서 `docs/superpowers/plans/2026-10-29-auto-backup.md`를 따른다.
- 기준: `feat/library-sync` `317aa70`(3단계 설계·계획만 있음, 구현은 다른 워크트리에서 진행 중). 3단계 구현 결과 코드가 이름의 기준이다. D1 `SCHEMA_VERSION` 5 → **6**(2A=3, 2B=4, 3=5. 표 정의는 모두 멱등이라 병합 때 큰 번호로 맞춘다).

## 결정 요약

| 항목 | 결정 |
|---|---|
| 서버 백업 대상 | **3단계 로그인 세션이 있는 사용자만.** 사용자(=보관함)당 스냅샷 **최대 1개**, 새로 만들면 덮어쓴다 |
| 스냅샷 형식 | 기존 백업 파일 텍스트(`buildBackupText`, `format: 'tripmap-backup'`, `v: 1`, 보관함 원문 + 화면 설정)를 브라우저가 **gzip**(`CompressionStream`)하고 base64로 바꿔 JSON 본문에 싣는다. 서버는 내용을 풀거나 해석하지 않는다 |
| 크기 상한 | 압축 바이트 **1 MiB**(1,048,576), D1 행 하나에 base64 **512 KiB**(524,288자) 조각 최대 3개, 원문 16 MiB(백업 파일 한도와 같음). 넘으면 "보관함이 커서 서버 백업을 만들 수 없어요"와 백업 파일 받기 안내(제안서 §7.4) |
| D1 | 스키마 6: `library_backups`(사용자당 1행 메타) + `library_backup_parts`(조각). 새 스냅샷 id로 조각을 먼저 쓰고 메타를 바꾼 뒤 옛 조각을 지우는 한 `batch` |
| API | 3단계 진입점 `functions/api/sync/[[path]].ts`의 `SYNC_ROUTES`에 `GET·POST·DELETE /v1/backup`, `GET /v1/backup/data`를 더한다 |
| 수동 | 설정 › 백업 › `서버 백업`: `서버 백업 지금 만들기`·`서버 백업에서 되살리기`·`서버 백업 지우기` |
| 자동 | `자동 백업`을 켠 기기에서, 앱을 연 뒤 **동기화가 `synced`로 끝나면** 서버 스냅샷이 24시간(서버 시각)보다 오래됐고 보관함 해시가 다를 때만 올린다. Cron 없음 |
| 되살리기 | 기존 `RestoreDialog`를 원격 모드로 재사용(미리보기·되살리기 전 사본·되돌리기 그대로). 바꾸기 전에 **지금 보관함을 파일로 받기**(기본 체크)를 같은 클릭에서 한다 |
| 폴더 변경 알림 | **로그인과 무관하게 브라우저만으로.** 살아 있는 네이버 폴더 연결마다 하루 1번, 앱을 열 때 기존 `/api/naver-folder`(캐시 사용)로 다시 읽어 `planFolderSync`로 새로 저장한 곳·빠진 곳 수를 센다 → 토스트 하나 + 라벨 관리 표시 → 기존 `새로 저장한 곳 가져오기` 흐름 |
| 기능 스위치 | `AUTO_BACKUP=off`면 서버 백업 **쓰기**(`POST /v1/backup`)가 503 `off`. 읽기·지우기는 계속 된다(제안서 §8 "기능 플래그만으로도 읽기 사본에 접근"). 폴더 알림은 서버 기능이 아니라 설정 › 가져오기의 켜기·끄기로 다룬다 |
| 첫 로딩 | 부트 두 개(자동 백업 플래그 읽기, 폴더 알림 기한 계산)만 들어간다. 실행기·설정 화면은 `auto-backup`·`folder-watch`·`ServerBackupSection` 조각으로 나눈다 |
| 구현 | Codex(gpt-6.1-sol high)가 구현하고 Claude가 검증한다 |

### 결정과 근거(브레인스토밍 대신 하위 에이전트가 정함)

사용자에게 물을 수 없어 아래는 근거를 적고 정했다. 바꾸려면 이 표와 계획서를 함께 고친다.

| 열린 결정 | 정한 것 | 근거 |
|---|---|---|
| 스냅샷을 누가 만드나 | **브라우저**가 만들어 올린다. 서버가 `library_items`로 만들지 않는다 | 무료 Workers CPU는 요청당 10ms다. 3MB JSON을 서버에서 gzip하면 넘는다. 압축하지 않으면 D1 행 2MB를 넘어 조각이 많아진다. 브라우저 스냅샷은 화면 설정까지 담아 백업 파일과 똑같이 되살릴 수 있다 |
| 전송 형식 | gzip 바이트의 **base64를 JSON 본문**에 실어 3단계 `api.client.send`로 보낸다 | 패키지 `send`는 본문을 `JSON.stringify`하고 응답을 `res.json()`으로 읽는다. 같은 클라이언트를 써야 세션 헤더·Google 토큰 갱신·401 재시도·오류 해석을 다시 만들지 않는다. base64 33% 늘어남은 상한(1 MiB → 1,398,104자) 안에서 감당된다 |
| 서버가 내용을 검사하나 | gzip 머리(`H4sI`)·base64 문자·길이만 본다. 풀거나 해석하지 않는다 | CPU 10ms. 내용 검사는 되살릴 때 브라우저가 한다(`readBackupText`가 `LibrarySchema`로 검사, 풀기는 16 MiB에서 끊음). 남의 자료가 아니라 본인 계정 자료다 |
| 크기 상한 | 압축 1 MiB, 조각 512 KiB | 제안서 §7.4 앱 상한(스냅샷 총합 1MB, 조각 512KiB)을 따른다. 실제 보관함 3,202곳(약 2.4MB JSON)은 gzip 뒤 약 0.3~0.5MB로 예상한다(미리보기에서 잰다) |
| 덮어쓰기 원자성 | 스냅샷마다 무작위 id(16자 hex). 조각은 `(user_id, backup_id, idx)`. 한 `batch`에서 새 조각 넣기 → 메타 upsert(조건부) → 메타가 가리키지 않는 조각 지우기 | 쓰는 중 실패하면 batch 전체가 취소되고, 동시 쓰기가 이기면 진 쪽 조각이 같은 batch에서 지워진다. 읽는 쪽은 메타 id로 조각을 잇는다 |
| 동시 자동 백업 | 자동 백업은 본 메타 id를 `ifMatch`로 보내고(없었으면 `null`), 그 사이 바뀌었으면 `409 backup-changed`로 포기한다. 수동은 조건 없이 덮어쓴다 | 두 기기가 같은 시각에 열려도 하나만 쓴다. 수동은 사용자가 지금 보관함을 올리겠다는 뜻이다 |
| "변경 있음" 판단 | `hashItem(snapshot.library)`(3단계 `src/domain/library-sync/items.ts`, 키 정렬 JSON의 cyrb53). 화면 설정은 넣지 않는다 | 저장소 원문은 기기마다 키 순서가 달라 같은 내용도 해시가 다를 수 있다. 정렬 해시는 동기화된 두 기기에서 같다. 필드 시각(`latestChangeAt`)은 다른 기기의 옛 시각 변경이 들어오면 놓친다 |
| 24시간 기준 시각 | 서버 응답의 `now - backup.createdAt`(둘 다 서버 ms) | 기기 시계와 무관하다 |
| 자동 백업이 도는 조건 | 동기화가 켜져 있고, 이 페이지에서 동기화가 `synced`로 끝난 뒤에만 | 오래 안 연 기기가 받기 전에 올리면 더 새 스냅샷을 옛 보관함으로 덮는다. 동기화가 꺼진 기기는 보관함이 계정과 다를 수 있다 |
| 줄어든 보관함 보호 | 자동 백업은 살아 있는 항목이 없거나, 서버 스냅샷의 `장소+여행`이 20 이상이고 지금 값이 그 절반 미만이면 건너뛰고 설정에 이유를 남긴다 | 실수로 지운 보관함이 하나뿐인 스냅샷을 자동으로 덮지 않게 한다. 맞는 변경이면 수동으로 만들면 된다 |
| 자동 백업 켜기 범위 | **기기별**(`tripmap:server-backup:v1`). 켠 기기가 열릴 때 확인한다 | 서버에 설정 표를 두지 않아 D1 쓰기가 없다. 동기화로 보관함이 같으므로 어느 기기가 올려도 같은 내용이다 |
| 되살리기 전 사본 | 기존 규칙(되살리기 전 보관함을 기기에 남김, 10초 `되돌리기`) + 원격 모드에서는 `바꾸기 전에 지금 보관함을 파일로 받기`(살아 있는 항목이 있으면 기본 체크) | 사본은 기기 저장 공간이 모자라면 못 남긴다. 파일은 기기 밖에 남는다. `이 백업으로 바꾸기`와 같은 클릭에서 받으므로 사파리의 사용자 활성화 조건을 지킨다 |
| 파일 백업 알림과의 관계 | 서버 백업은 `마지막 백업`(파일) 기록·백업 알림 띠를 바꾸지 않는다 | 제안서 §7.4: D1 사본은 같은 장애 범위라 독립 백업이 아니다. 수동 파일 백업을 계속 권한다 |
| 만료 | 따로 만료하지 않는다. `서버 백업 지우기`와 `서버 자료 모두 지우기`(3단계)가 지운다 | 허용 계정만 쓰고 사용자당 1MB 안이다. 정리 작업이 D1 쓰기를 더 쓴다 |
| `AUTO_BACKUP=off` 범위 | 쓰기만 막는다. 메타·데이터 읽기와 지우기는 연다. `LIBRARY_SYNC=off`도 쓰기만 막는다(읽기·지우기 경로는 `allowWhenOff`) | 비상구는 쓰기 부하와 새 자료를 멈추는 것이고, 이미 있는 사본으로 되살리는 길은 남겨야 한다 |
| 폴더 알림과 로그인 | **로그인 없이 모든 사용자**. 서버 표·세션을 쓰지 않는다 | 원본 폴더 읽기는 이미 공개 API `/api/naver-folder`(로그인 없음)이고, 비교는 보관함 안 `folders[].seenSids`와 `planFolderSync`(F3)로 브라우저에서 끝난다. 서버 예약 작업이 없으니 로그인이 줄 것이 없다 |
| 폴더 알림 조회 빈도 | 폴더마다 `max(마지막 확인, 연결의 checkedAt) + 24시간`이 지났을 때만, 한 번 열 때 오래된 것부터 **최대 5개**, 차례로. 캐시를 쓰는 보통 조회(`fresh` 없음). 탭 여럿이면 Web Lock(`tripmap:folder-watch`, `ifAvailable`)으로 하나만 | 하루 1번 상한(룰링 5). 10분 엣지 캐시를 같이 써서 네이버 요청이 늘지 않는다. 다시 가져오기 화면은 지금처럼 `fresh=1`로 새로 읽는다 |
| "바뀐 장소"의 뜻 | **새로 저장한 곳**(`plan.fresh`)과 **폴더에서 빠진 곳**(`plan.missing`) 두 수. 이름·주소가 바뀐 곳은 세지 않는다 | 다시 가져오기는 이미 있는 장소의 이름·주소를 덮어쓰지 않는다(F3 §2). 비교할 네이버 원본 이름을 보관함에 두지 않으며, 보관함 이름은 사용자가 고친 값일 수 있어 틀린 알림이 된다 |
| 알림 방식 | 확인이 끝나면 **토스트 하나**(폴더 하나면 `가져오기`, 여럿이면 `보기`). 라벨 관리 줄과 라벨 고치기 대화상자에 같은 수를 남긴다. 같은 변화(새·빠진 sid 집합이 같음)는 다시 띄우지 않는다 | `AppShell`·알림 띠를 고치지 않아 2A·2B와 병합 충돌이 없고 첫 로딩이 늘지 않는다. 다시 가져오기의 진입점(F3 §4.1)을 그대로 쓴다 |
| 알림 상태 위치 | 기기별 로컬 키 `tripmap:folder-watch:v1`. 보관함·동기화·백업에 넣지 않는다 | 보관함 형식을 바꾸지 않는다. 다른 기기에서 다시 가져오면 동기화된 연결의 `checkedAt`이 늦어져 이 기기의 표시가 저절로 사라진다(아래 §네이버 폴더 변경 알림 5) |
| 폴더 알림 기본값 | 켜짐. 설정 › 가져오기 `네이버 폴더 변경 알림`에서 끈다 | 연결을 만든 사용자는 그 폴더를 계속 쓰는 사람이다. 요청은 폴더당 하루 한 번이다 |

## 하지 않는 것

- Cron·예약 작업·서버가 스스로 만드는 스냅샷. 앱을 열어야만 자동 백업·폴더 확인이 돈다.
- Google Drive 연동, 이메일 알림, Web Push(브라우저 밖 알림).
- 스냅샷 여러 개·변경 이력·날짜 고르기·부분 복원(합치기 복원). 스냅샷은 하나이고 되살리기는 통째로 바꾼다.
- 서버 백업 암호화. 3단계와 같이 일반 저장이고 설정에 알린다.
- 폴더 자동 가져오기. 알림만 하고 가져오기는 사용자가 누른다.
- 폴더 장소의 이름·주소·좌표 변경 감지(위 결정 표).
- 로그인하지 않은 사용자의 서버 백업. 동기화를 켜지 않은 기기의 자동 백업.
- 백업 알림 띠·`AppShell`·`perf-budget.json` 변경. `docs/rollback.md` 버전 표(병합 뒤 별도 PR).

## 사용 흐름

### 서버 백업 지금 만들기

1. 설정 › `백업` 절, 기존 파일 백업 단추 아래에 `서버 백업` 구역이 생긴다(3단계 `syncFeatureVisible()`가 참일 때만).
2. 로그인 전: "로그인하면 서버에도 보관함 백업을 하나 둘 수 있어요." + `동기화에서 로그인`(→ `/settings#sync`).
3. 로그인 뒤: `GET /api/sync/v1/backup`으로 지금 서버 백업을 보인다.
   - 없음: `서버 백업: 없음`
   - 있음: `서버 백업: 2026.10.29 15:12 (오늘) · 장소 120곳 · 라벨 8개 · 여행 3개 · iPhone · Safari · 자동`(`· 자동`은 자동 백업일 때만, 약속이 있으면 기존 `countsText`대로 `· 약속 N개`)
4. `서버 백업 지금 만들기` → 보관함 스냅샷을 읽어 압축한다 → 덮어쓰기 확인이 필요한 경우(아래)만 묻고 → `POST /v1/backup`(`reason: 'manual'`, `ifMatch` 없음) → 토스트 `서버 백업을 만들었어요 (장소 120곳 · 라벨 8개 · 여행 3개)` → 줄 갱신.
   - 확인을 묻는 경우: 서버 백업이 있고 (a) 이 기기의 동기화가 꺼져 있거나(`readBootFlag()` 거짓) (b) 지금 `장소+여행`이 서버 백업의 절반 미만(서버 쪽이 20 이상). 문구: "서버 백업을 이 기기 보관함으로 바꿔요. 지금 서버 백업: <줄 3의 문구>" + (b)면 "서버 백업보다 장소·여행이 많이 적어요." 단추 `바꾸기`/`취소`.
5. 진행 중에는 단추를 끄고 `서버 백업을 만드는 중…`(`role="status"`).

### 자동 백업 켜기

1. 같은 구역의 스위치 `자동 백업`. 설명: "이 기기에서 앱을 열 때, 마지막 서버 백업이 하루가 지났고 그 뒤로 바뀐 내용이 있으면 새로 올려요. 서버 백업은 하나만 두고 덮어써요."
2. 동기화가 켜져 있지 않으면(`readBootFlag()`가 거짓) 스위치를 끄고 "동기화를 켠 기기에서만 자동 백업을 할 수 있어요".
3. 켜면 로컬 키에 `auto: true`를 쓰고 바로 자동 백업 실행기를 붙인다(지금 상태가 `synced`면 곧 한 번 확인한다).
4. 앱을 열 때마다(그리고 이 페이지에서 동기화 실행이 끝날 때마다) 아래 §자동 백업 판단을 한다. 결과는 조용히 기록되고 설정 구역에 한 줄로 보인다(문구는 계획서 `AUTO_OUTCOME_TEXT`): `자동 백업: 10.29 09:12 올림` / `자동 백업 건너뜀: 장소·여행이 서버 백업보다 크게 줄었어요. 맞다면 '서버 백업 지금 만들기'를 눌러 주세요` / `자동 백업 건너뜀: 보관함이 비어 있어요` / `자동 백업 못 함: 보관함이 커서 서버 백업을 만들 수 없어요` / `자동 백업 못 함: 이 브라우저에서는 서버 백업을 만들 수 없어요` / `자동 백업 멈춤: 지금은 서버 백업을 쓸 수 없어요` / `자동 백업 멈춤: 오늘 서버 백업 한도를 넘었어요` / `자동 백업 실패: 다음에 앱을 열 때 다시 해요`.

### 서버 백업에서 되살리기

1. `서버 백업에서 되살리기`(서버 백업이 없으면 꺼짐) → 기존 `RestoreDialogHost`/`RestoreDialog`를 **원격 모드**로 연다. 제목 `서버 백업에서 되살리기`.
2. 파일 고르기 단계 대신 `서버 백업을 받는 중…` → `GET /v1/backup/data?id=<메타 id>` → base64 풀기 → gunzip(16 MiB 넘으면 멈춤) → `readBackupText`.
   - 실패: 문구(아래 §오류·장애) + `다시 시도` 단추. `409 backup-changed`면 "서버 백업이 그사이 바뀌었어요. 창을 닫고 다시 열어 주세요".
3. 미리보기는 지금과 같다. 머리 줄만 `서버 백업 · 2026.10.29 15:12 · iPhone · Safari`. 그 아래 기존 목록(`백업 파일: …`, `지금 보관함: …`), `지금 보관함은 지워지고 이 백업 내용으로 바뀌어요.`, 화면 설정 안내, 모르는 필드 경고, 3단계의 동기화 안내 한 줄.
4. 원격 모드 추가 안내(살아 있는 항목이 있을 때):
   - 체크박스 `바꾸기 전에 지금 보관함을 파일로 받기`(기본 체크).
   - 문구 "지금 보관함은 이 기기에 '되살리기 전 보관함'으로도 남아요. 설정 › 백업 › 되살리기 전으로 되돌리기로 돌아갈 수 있어요."
   - 동기화가 켜져 있으면 "이 백업 뒤에 만든 장소·여행은 동기화로 다시 들어와요." (3단계 §호환: 되살린 뒤 사라진 항목은 전체 재동기화로 다시 받는다)
5. `이 백업으로 바꾸기` → 체크돼 있고 이 창에서 아직 받지 않았으면 **같은 클릭 안에서** 기존 `useBackupFile().save()`로 파일을 받고(실패하면 멈추고 오류) 그 원문을 `savedText`로 넘겨 바꾼다. 체크를 풀었으면 지금처럼 `requirePrevious: true`(사본 필수). 나머지(토스트 `백업에서 되살렸어요`, `되돌리기`, 화면 설정 적용, 필터 풀기)는 지금과 같다. 단 원격 모드는 `마지막 백업`(파일) 기록을 `exportedAt`으로 올리지 않는다(파일이 아니다).

### 서버 백업 지우기

`서버 백업 지우기`(있을 때만) → 확인 대화상자 "서버 백업을 지울까요? 이 기기 보관함과 백업 파일은 그대로예요."(자동 백업이 켜져 있으면 " 자동 백업이 켜져 있어 다음에 다시 만들어요."를 덧붙임) `지우기`/`취소` → `DELETE /v1/backup` → 토스트 `서버 백업을 지웠어요` → `서버 백업: 없음`.

### 네이버 폴더 변경 알림

1. 앱(셸)이 열리고 한가할 때(3초 뒤), 알림이 켜져 있고(`tripmap:folder-watch:v1`의 `enabled`, 기본 참) 온라인이고 데이터 절약 모드가 아니면, 확인할 때가 된 폴더(위 결정 표)가 있는지 본다. 없으면 아무것도 받지 않는다. 탭이 다시 보일 때(`visibilitychange`)도 같은 확인을 한다.
2. 있으면 `folder-watch` 조각을 받아 오래된 순서로 최대 5개를 `PlaceLookup.lookupFolder(shareId)`(캐시 사용)로 차례로 읽는다.
3. 폴더마다 `planFolderSync(지금 보관함, 연결, items)` → `fresh = plan.fresh.length`, `missing = plan.missing.length`, 서명 = `hashItem([새 sid 정렬, 빠진 sid 정렬])`. 기록 `{ checkedAt: now, fresh, missing, signature, notified, error: null }`.
4. 확인이 끝나면 `fresh + missing > 0`이고 서명이 `notified`와 다른 폴더만 모아 토스트 하나:
   - 하나: `‘속초, 고성, 양양 맛집’ 폴더에 새로 저장한 곳이 2곳 있어요`(빠진 곳도 있으면 ` · 빠진 곳 1곳`, 새 곳 없이 빠진 곳만이면 `‘…’ 폴더에서 빠진 곳이 1곳 있어요`) + `가져오기` → 기존 `openFolderSyncAtom(shareId, null)`(F3 다시 가져오기 화면).
   - 여럿: `네이버 폴더 3개가 바뀌었어요 (새로 저장한 곳 5곳)` + `보기` → `/labels`.
   - 띄운 폴더는 `notified = signature`. 같은 변화는 다음 날 다시 띄우지 않고, 새로 저장한 곳이 더 생기면 다시 띄운다.
5. 라벨 관리(`/labels`) 줄의 개수 글자: `장소 3곳 · 네이버 폴더 · 새로 저장한 곳 2곳`(새 곳이 없고 빠진 곳만 있으면 `· 폴더에서 빠진 곳 1곳`). 라벨 고치기의 `네이버 폴더` 구역에서 폴더마다 확인 날짜 아래 `네이버에 새로 저장한 곳 2곳 · 빠진 곳 1곳 (10.29 확인)`. 표시는 **기록의 `checkedAt`이 연결의 `checkedAt`보다 늦을 때만**(그 뒤 이 기기나 다른 기기에서 다시 가져오기·`확인했어요`를 하면 연결의 `checkedAt`이 늦어져 저절로 사라진다).
6. 원본 폴더를 찾지 못함(`NOT_FOUND`): 토스트는 띄우지 않고 기록에 `error: 'not-found'`. 라벨 고치기 구역에 "마지막 확인 때 폴더를 찾지 못했어요. 네이버에서 공유를 껐을 수 있어요". 그 밖의 조회 오류는 기록의 `checkedAt`만 갱신하고(다음 날 다시, 앞 기록의 수·서명은 그대로) 아무것도 보이지 않는다.
7. 설정 › `가져오기` 절에 스위치 `네이버 폴더 변경 알림`, 설명 "앱을 열 때 하루 한 번, 가져온 네이버 폴더에 새로 저장한 곳이 있는지 확인해요", 살아 있는 연결이 있으면 `지금 확인` 단추(기한을 무시하고 살아 있는 연결 최대 20개를 확인, 1분에 한 번만, 결과가 없으면 토스트 `바뀐 네이버 폴더가 없어요`)와 `마지막 확인 MM.DD HH:mm`.

## 스냅샷 형식

- 원문: 기존 `buildBackupText({ rawLibrary: snapshot.raw, prefs, now })`(백업 파일과 같은 한 줄 JSON, `format: 'tripmap-backup'`, `v: 1`). 3단계 문서의 `landmark-backup`은 오기이고 `src/schema/backup.ts`의 `BACKUP_FORMAT`이 맞다.
- 압축: `new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))`. `CompressionStream`이 없는 브라우저(사파리 16.4 미만)는 `unsupported` — "이 브라우저에서는 서버 백업을 만들 수 없어요".
- 전송: gzip 바이트를 표준 base64(`+/`, `=` 채움). 1 MiB 넘으면 `too-large`.
- 풀기: base64 → 바이트 → `DecompressionStream('gzip')`를 읽으며 16,777,216바이트를 넘으면 취소하고 `too-big`(압축 폭탄 방지) → `TextDecoder('utf-8', { fatal: true })` → `readBackupText`(기존 검사·오류 문구 그대로).
- 함께 올리는 메타: `rawBytes`(원문 UTF-8 바이트), `contentHash`(`hashItem(snapshot.library)`), `counts`(`libraryCounts`), `exportedAt`(봉투의 값), `deviceId`(3단계 메타), `deviceLabel`(3단계 `deviceLabel(navigator.userAgent)`), `reason`.

## 서버 데이터(D1, 스키마 버전 6)

`src/server/meet/schema-sql.ts`의 `SCHEMA_STATEMENTS` **끝에** 더하고 `SCHEMA_VERSION = 6`.

```sql
-- 6: 서버 백업. 사용자(=보관함)당 스냅샷 하나. data는 tripmap-backup v1 텍스트를 gzip한 바이트의 base64 조각
CREATE TABLE IF NOT EXISTS library_backups (
  user_id TEXT PRIMARY KEY,
  id TEXT NOT NULL,                      -- 스냅샷 id(16자 hex). 조각과 잇고 조건부 덮어쓰기에 쓴다
  format INTEGER NOT NULL,               -- 1
  parts INTEGER NOT NULL,                -- 조각 수(1~3)
  stored_bytes INTEGER NOT NULL,         -- gzip 바이트 수
  raw_bytes INTEGER NOT NULL,            -- 원문 UTF-8 바이트 수(브라우저가 알림)
  content_hash TEXT NOT NULL,            -- hashItem(보관함)
  places INTEGER NOT NULL,
  labels INTEGER NOT NULL,
  trips INTEGER NOT NULL,
  meetings INTEGER NOT NULL,
  exported_at TEXT NOT NULL,             -- 봉투 exportedAt(기기 시각 ISO)
  device_id TEXT NOT NULL,
  device_label TEXT NOT NULL,
  reason TEXT NOT NULL,                  -- 'manual' | 'auto'
  created_at INTEGER NOT NULL            -- 서버 ms
);
CREATE TABLE IF NOT EXISTS library_backup_parts (
  user_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  idx INTEGER NOT NULL,                  -- 0부터
  data TEXT NOT NULL,                    -- base64 조각(524,288자 이하)
  PRIMARY KEY (user_id, backup_id, idx)
);
```

- 행 크기: 조각 512 KiB + 열 몇 개라 D1 행 2MB 안이다. 메타는 1KB 안.
- 쓰기 예산: 백업 한 번에 조각 1~3행 + 메타 1행 + 옛 조각 삭제 1~3행. 사용자당 하루 쓰기 20번 상한이면 최대 약 140행.
- 계정 지우기: 3단계 `ACCOUNT_DATA_TABLES`에 `'library_backup_parts'`, `'library_backups'`를 더한다(`DELETE /v1/account`가 함께 지운다).

## API(3단계 진입점 위)

모두 3단계 규칙을 따른다: 출처 검사·`ensureSchema`·`requireSyncUser`(세션 + Google ID 토큰)·`Cache-Control: private, no-store`·오류 `{ error: '<code>', ...extra }`. 하루 한도는 3단계 `consumeCounter`·`counterKey`(UTC 날짜, `rate_counters`).

| 요청 | 하는 일 | 권한·한도 | 성공 |
|---|---|---|---|
| `GET /v1/backup` | 메타 | 세션·사용자 `backup-read` 200/일. `allowWhenOff` | `200 { now, writable, maxStoredBytes, backup: BackupMeta \| null }` |
| `POST /v1/backup` | 스냅샷 쓰기(덮어쓰기) | 세션·사용자 `backup-write` 20/일. 본문 1,500,000바이트 이하. `AUTO_BACKUP=off`·`LIBRARY_SYNC=off`면 503 `off` | `200 { now, backup: BackupMeta }`, `409 { error: 'backup-changed' }` |
| `GET /v1/backup/data?id=<id>` | 스냅샷 데이터 | 세션·`backup-read`. `allowWhenOff` | `200 { id, data }`, 없으면 `404 { error: 'no-backup' }`, id가 다르면 `409 backup-changed` |
| `DELETE /v1/backup` | 지우기 | 세션. `allowWhenOff` | `204` |

`BackupMeta = { id, createdAt, exportedAt, storedBytes, rawBytes, contentHash, counts: { places, labels, trips, meetings }, deviceId, deviceLabel, reason }`. `writable = AUTO_BACKUP !== 'off' && LIBRARY_SYNC !== 'off'`.

`POST` 본문:

```json
{ "v": 1, "format": 1, "data": "<base64>", "rawBytes": 812345, "contentHash": "1x2y3z",
  "counts": { "places": 120, "labels": 8, "trips": 3, "meetings": 0 },
  "exportedAt": "2026-10-29T06:12:00.000Z", "deviceId": "abcdefgh12345678",
  "deviceLabel": "iPhone · Safari", "reason": "auto", "ifMatch": "0123456789abcdef" }
```

- 검사(실패는 `422 { error: 'invalid', path }`): 남는 키 금지, `v === 1`, `format === 1`, `data`는 `H4sI`로 시작·`^[A-Za-z0-9+/]+={0,2}$`·길이가 4의 배수, `data` 길이 1,398,104 초과는 `413 { error: 'too-large' }`, `rawBytes` 1~16,777,216 정수, `contentHash` `^[0-9a-z]{1,16}$`, `counts` 넷 다 0~1,000,000 정수(남는 키 금지), `exportedAt` ISO(`Date.parse` 가능, 30자 이하), `deviceId` `^[a-z0-9]{16}$`, `deviceLabel` 앞뒤 공백 제거 1~40자·제어 문자 없음, `reason` `manual|auto`, `ifMatch`는 없거나 `null` 또는 `^[0-9a-f]{16}$`.
- 쓰기(한 `batch`): 조각마다 `INSERT INTO library_backup_parts` → 메타 upsert(`ifMatch` 없음: 늘 덮어씀 / `null`: `ON CONFLICT DO NOTHING` / 문자열: `DO UPDATE … WHERE library_backups.id = ?`) → `DELETE FROM library_backup_parts WHERE user_id = ? AND backup_id IS NOT (SELECT id FROM library_backups WHERE user_id = ?)`. 그 뒤 메타를 읽어 id가 새 id가 아니면 `409 backup-changed`(진 쪽 조각은 이미 지워졌다).
- 읽기 응답 `GET /v1/backup/data`는 조각 문자열을 해석 없이 이어 붙여 만든다(`'{"id":"…","data":"' + 조각들 + '"}'`). base64 문자는 JSON 이스케이프가 필요 없다. 조각 수가 메타의 `parts`와 다르면(쓰는 중) `409 backup-changed`.
- 로그: 3단계 라우터 한 줄 로그(`{ method, path, status, ms }`) 그대로. 데이터·해시·기기 이름을 남기지 않는다.

## 자동 백업 판단

실행기(`auto-backup` 조각)는 3단계 엔진의 `onRunFinished(status)`마다(그리고 붙일 때 지금 상태가 `synced`면 한 번) 아래를 차례로 본다. 한 번에 하나만 돈다(같은 탭은 진행 중 플래그, 탭 사이는 Web Lock `tripmap:server-backup` `ifAvailable`).

| 순서 | 조건 | 결과(기록 `last`) | 다음 확인 `nextCheckAt` |
|---|---|---|---|
| 1 | 로컬 `auto`가 거짓 | 끝 | — |
| 2 | 3단계 메타 `userId`가 로컬 `userId`와 다름 | 로컬 `userId`를 바꾸고 `nextCheckAt`·`last`를 비운 뒤 계속 | — |
| 3 | `status.phase !== 'synced'` | 끝(기록 안 함) | 그대로 |
| 4 | `now < nextCheckAt` | 끝(요청 없음) | 그대로 |
| 5 | `GET /v1/backup` 실패 | `failed`(오프라인·서버), `auth`·`not-allowed`는 기록 안 함 | 지금 + 1시간 |
| 6 | `writable === false` | `off` | 지금 + 24시간 |
| 7 | 서버 백업이 있고 `now(서버) - createdAt < 24시간` | 끝(기록 안 함) | 지금 + (24시간 - 경과) |
| 8 | `hashItem(보관함) === backup.contentHash` | 끝(기록 안 함) | 지금 + 24시간 |
| 9 | 살아 있는 항목 없음 | `skipped-empty` | 지금 + 24시간 |
| 10 | 서버 `places+trips >= 20`이고 지금 값 `< 서버 값 / 2` | `skipped-shrunk` | 지금 + 24시간 |
| 11 | 스냅샷 만들기 `too-large`·`unsupported` | 그 이름 | 지금 + 24시간 |
| 12 | `POST`(`reason: 'auto'`, `ifMatch: backup?.id ?? null`) 성공 | `uploaded` | 지금 + 24시간 |
| 13 | `409 backup-changed` | 끝(기록 안 함) | 지금 + 1시간 |
| 14 | `429`·`503 off` | `limit`·`off` | 지금 + 24시간 |
| 15 | 그 밖 실패 | `failed` | 지금 + 1시간 |

- `now`는 이 기기 ms(로컬 기한), 7은 서버 값끼리 비교한다. 개발 모드에서만 `VITE_AUTO_BACKUP_INTERVAL_MS`(양의 정수 ms)가 24시간을 바꾼다(운영 번들에는 그 분기가 없다).
- 수동 `지금 만들기`가 성공하면 `nextCheckAt = 지금 + 24시간`.

## 화면 상태

### 설정 › 백업 › 서버 백업

| 상태 | 문구 | 단추 |
|---|---|---|
| 기능 없음(`syncFeatureVisible()` 거짓) | 구역 없음 | — |
| 로그인 전(세션 없음) | 로그인하면 서버에도 보관함 백업을 하나 둘 수 있어요 | `동기화에서 로그인` |
| 읽는 중 | 서버 백업을 확인하는 중… | — |
| 없음 | 서버 백업: 없음 | `서버 백업 지금 만들기`, `서버 백업에서 되살리기`(꺼짐) |
| 있음 | 서버 백업: <시각> (<N일 전·오늘>) · <개수> · <기기 이름>[ · 자동] | 위 둘 + `서버 백업 지우기` |
| 쓰기 꺼짐(`writable: false`) | 위 줄 + "지금은 서버 백업을 새로 만들 수 없어요" | `지금 만들기` 꺼짐, 되살리기·지우기는 됨 |
| 다시 로그인(401) | 동기화 로그인이 끊겼어요. 다시 로그인해 주세요 | `동기화에서 로그인` |
| 허용 밖(403) | 이 계정은 서버 백업을 쓸 수 없어요 | — |
| 연결 실패 | 서버 백업을 확인하지 못했어요 | `다시 시도` |

공통 안내 한 줄(`--tm-text-secondary`): "서버 백업은 하나만 두고 새로 만들면 덮어써요. 암호화하지 않고 저장해요. 서버 장애에 대비해 백업 파일도 가끔 받아 두세요." 그 아래 `자동 백업` 스위치와 마지막 자동 결과 한 줄(위 §자동 백업 켜기 4).

### 폴더 알림 표시

| 자리 | 문구 | 보일 때 |
|---|---|---|
| 토스트 | 위 §네이버 폴더 변경 알림 4 | 확인 직후, 서명이 새로울 때 |
| 라벨 관리 줄 | `… · 새로 저장한 곳 N곳` 또는 `… · 폴더에서 빠진 곳 N곳` | 그 라벨의 연결 중 표시 조건(§5)을 지키는 것의 합 |
| 라벨 고치기 구역 | `네이버에 새로 저장한 곳 N곳 · 빠진 곳 N곳 (MM.DD 확인)` / 찾지 못함 문구 | 같은 조건 |
| 설정 › 가져오기 | 스위치·설명·`지금 확인`·`마지막 확인 MM.DD HH:mm` | 늘(단추는 살아 있는 연결이 있을 때) |

## 오류·장애

| 상황 | 동작 |
|---|---|
| 오프라인 | 수동: "서버에 연결하지 못했어요". 자동: `failed`, 1시간 뒤. 폴더 알림: 확인하지 않음 |
| 401 | 수동: 다시 로그인 안내(세션 정리는 3단계 엔진이 한다). 자동: 기록 안 함 |
| 403 `not-allowed` | "이 계정은 서버 백업을 쓸 수 없어요" |
| 429 | "오늘은 서버 백업을 더 만들 수 없어요. 내일 다시 해 주세요" / 되살리기 "오늘은 서버 백업을 더 받을 수 없어요. 내일 다시 해 주세요" |
| 503 `off` | "지금은 서버 백업을 쓸 수 없어요" |
| 413 / 스냅샷 `too-large` | "보관함이 커서 서버 백업을 만들 수 없어요. 백업 파일 받기를 이용해 주세요" |
| `unsupported` | "이 브라우저에서는 서버 백업을 만들 수 없어요" |
| 409 `backup-changed` | 수동 쓰기에는 생기지 않는다. 되살리기: "서버 백업이 그사이 바뀌었어요. 창을 닫고 다시 열어 주세요" |
| 404 `no-backup` | 되살리기 "서버 백업이 없어요", 줄을 `없음`으로 |
| 풀기·읽기 실패 | 기존 `BACKUP_READ_MESSAGES`(`invalid`·`too-big`·`newer`·`too-large`) |
| 보관함 읽기 실패(`LibraryCorrupt`) | 수동: "보관함을 읽지 못해 서버 백업을 만들지 못했어요". 자동: `failed` |
| 폴더 `NOT_FOUND` | 기록만(위 §6) |
| 폴더 그 밖 오류 | 기록 `checkedAt`만 갱신, 다음 날 다시 |
| 로컬 키 쓰기 실패 | 콘솔 경고만(`BackupMetaStore`와 같은 원칙). 자동 백업은 다음 열 때 다시 확인한다 |

## 보안·크기·빈도

- 사용자 격리: 모든 질의에 `user_id = ?`(세션의 `SyncUser.userId`). 본문의 `deviceId`·`deviceLabel`은 표시용이다.
- 크기: 본문 1,500,000바이트(`readJson(request, BACKUP_MAX_BODY_BYTES)`), base64 1,398,104자, 조각 524,288자, 원문 16 MiB. 서버는 압축을 풀지 않으므로 압축 폭탄은 브라우저의 풀기 상한이 막는다.
- 빈도: `backup-write` 사용자당 하루 20, `backup-read` 사용자당 하루 200(메타·데이터 합). 자동 백업은 기기당 하루 한 번 안팎의 메타 읽기와 많아야 한 번의 쓰기다.
- 폴더 알림: 폴더당 기기당 하루 1번, 한 번 열 때 최대 5개, 캐시 사용. 기존 `/api/naver-folder`의 남용 방지(엣지 캐시)를 그대로 쓴다. `지금 확인`은 1분에 한 번, 최대 20개.
- 내용: 서버 백업은 일반 저장이다(설정 안내). 되살릴 때 `readBackupText`가 `LibrarySchema`로 검사한다. 사용자 문자열은 React 텍스트로만 그린다.
- 로그·주소: 세션·데이터·해시를 로그·URL에 넣지 않는다. 스냅샷 id만 질의에 쓴다.

## 첫 로딩·코드 위치

| 묶음 | 파일 | 첫 로딩 |
|---|---|---|
| 자동 백업 부트 | `src/services/server-backup/boot.ts`(`readAutoBackupFlag`, `loadAutoBackup`, `loadServerBackupSection`), `src/sections/server-backup/use-auto-backup-boot.ts` | 들어감(합쳐 gzip 0.6KB 안) |
| 폴더 알림 부트 | `src/services/folder-watch/state.ts`(로컬 키·기한 계산, 런타임 import 없음), `src/services/folder-watch/boot.ts`(`loadFolderWatch`), `src/sections/folder-watch/use-folder-watch-boot.ts` | 들어감(합쳐 gzip 0.9KB 안) |
| 자동 백업 실행기 | `src/services/server-backup/auto-backup.ts`(+ `snapshot.ts`·`api.ts`·`storage.ts`) | `auto-backup-*.js` |
| 설정 구역 | `src/sections/server-backup/ServerBackupSection.tsx`(설정 화면에서 `lazy`) | `ServerBackupSection-*.js` |
| 폴더 확인 실행기 | `src/services/folder-watch/folder-watch.ts` | `folder-watch-*.js` |
| 라벨 관리 표시 | `src/stores/folder-watch.ts`(atom·표시 계산) | `LabelsPage`·`SettingsPage` 조각 안 |

- `build:ci`에 `--require-lazy ServerBackupSection --require-lazy auto-backup --require-lazy folder-watch`를 더한다. 첫 로딩 상한(`perf-budget.json` 327,680)은 그대로.
- 부트 훅 둘은 `LibraryShell`(`src/sections/shell/ShellRoute.tsx`)에서 3단계 `useSyncBoot()` 다음 줄에 부른다.
- 3단계 엔진은 어디서나 `loadSyncEngine()`(동적 import)으로만 받는다. `auto-backup.ts`가 `sync-engine`을 정적으로 가져오면 `INEFFECTIVE_DYNAMIC_IMPORT`로 빌드가 실패한다.
- 3단계 `ensureLibrarySyncEngine()`과 이 기능이 같은 `SyncApi`(같은 Firebase Auth 인스턴스)를 쓰도록 공용 접근자 `getSharedSyncApi()`를 둔다(3단계 코드에 같은 것이 있으면 그것을 쓴다).

## 3단계에 기대는 인터페이스

계획서 Task 0이 구현 결과에서 이 이름들을 확인한다. 다르면 코드를 따르고 계획서의 해당 줄을 고친다.

| 이름 | 위치 | 쓰는 곳 |
|---|---|---|
| `requireSyncUser(ctx, deps): Promise<SyncUser>`, `SyncUser.userId` | `src/server/library-sync/auth.ts` | 모든 백업 경로 |
| `SyncEnv`(여기에 `AUTO_BACKUP?: string`을 더함), `SyncContext`, `SyncDeps.now·random` | `src/server/library-sync/env.ts` | 스위치·시각·id |
| `syncJson`, `SyncHttpError` | `src/server/library-sync/http.ts` | 응답·오류 |
| `consumeCounter`, `counterKey` | `src/server/library-sync/limits.ts` | 하루 한도 |
| `SYNC_ROUTES`, `SyncRoute`(`allowWhenOff`) | `src/server/library-sync/router.ts` | 경로 4개 |
| `ACCOUNT_DATA_TABLES` | `src/server/library-sync/library.ts` | 계정 지우기 |
| `readJson` | `@sch0718/firebase-session/worker` | 본문 상한 |
| `hashItem` | `src/domain/library-sync/items.ts` | 변경 판단·폴더 서명 |
| `createSyncApi`, `SyncApi.client.send`, `readSyncClientConfig`, `googleAuth` | `src/services/library-sync/api.ts`, `config.ts` | 백업 API 클라이언트 |
| `readSyncMeta`(`userId`·`deviceId`·`enabled`), `readSession` | `src/services/library-sync/storage.ts` | 로그인 여부·기기 |
| `deviceLabel(ua)` | `src/services/library-sync/login.ts` | 기기 이름 |
| `readBootFlag`, `syncFeatureVisible`, `loadSyncEngine` | `src/services/library-sync/boot.ts` | 부트·화면 표시 |
| `ensureLibrarySyncEngine().onRunFinished(listener)` | `src/services/library-sync/sync-engine.ts` | 자동 백업 시점 |
| `syncStatusAtom`, `SyncStatus.phase` | `src/stores/sync-status.ts` | `synced` 판단 |
| `createSqliteD1`(+`meta.changes`), `createSyncMemoryServer(env).login(sub)`, `createSyncServer`·`installSyncServer` | `tests/helpers/*`, `tests/e2e/sync-server.ts` | 시험 |

## 호환·롤백

- 보관함 형식(`tripmap:library:v2`)·백업 파일 형식·공유 형식·폴더 연결 형식은 그대로다. 새 로컬 키 둘(`tripmap:server-backup:v1`, `tripmap:folder-watch:v1`)은 기기별이고 백업 파일·동기화에 넣지 않는다. 옛 버전은 무시한다.
- **`AUTO_BACKUP=off`**(Pages 변수, 다시 배포): `POST /v1/backup`이 503 `off`, `GET /v1/backup`의 `writable: false`. 화면은 `지금 만들기`를 끄고 되살리기·지우기는 그대로다. 자동 백업은 `off`를 기록하고 하루 뒤 다시 본다. 폴더 알림과 3단계 동기화는 영향 없다.
- **3단계만 있는 버전으로 되돌리면**: 서버 백업 구역·자동 백업·폴더 알림이 사라진다. 보관함은 그대로다. D1의 `library_backups`·`library_backup_parts`는 남고 읽히지 않는다. `schema_meta`는 6으로 남지만 3단계 코드(버전 5)는 `version >= SCHEMA_VERSION`이라 문장을 다시 돌리지 않는다. 다시 4단계로 오면 그대로 이어 쓴다. 로컬 키 둘은 남아 있다가 다시 쓰인다.
  - 주의: 되돌린 사이에 `서버 자료 모두 지우기`를 한 사용자의 백업 행은 3단계 코드가 지우지 않는다. 사용자가 원격 D1에서 지울 수 있다(아래 §사용자가 할 일 4).
- 폴더 알림만 끄려면 코드 되돌림 없이 각 기기 설정 › 가져오기에서 끈다. `/api/naver-folder`는 그대로다.
- 3단계와 함께: 서버 백업에서 되살리면 3단계 규칙대로 되살린 내용이 이 기기의 새 변경으로 올라가 다른 기기에도 퍼진다(대화상자에 기존 안내 한 줄 + 위 원격 모드 안내).
- 병합 뒤 `docs/rollback.md`(별도 docs PR)에 위 내용을 적는다. 기능 PR 본문에 롤백·데이터 영향 메모를 쓴다.

## 사용자가 할 일(구현 PR 전후)

새 외부 계정·키는 없다. 3단계의 로그인 설정이 끝나 있어야 서버 백업이 보인다.

1. **Pages 변수**(선택): 끌 때만 `AUTO_BACKUP` = `off`(Cloudflare 대시보드 › Workers & Pages › `landmark` › Settings › Variables and Secrets, Production·Preview 각각) → 다시 배포.
2. **D1 반영**: 할 일 없음. 배포 뒤 첫 동기화 요청에서 `ensureSchema`가 표를 만든다. 확인만 하려면(읽기 전용) `npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta"` → `6`(미리보기는 `landmark-preview`).
3. **미리보기에서 확인**: 실제 보관함으로 `서버 백업 지금 만들기` → Workers 지표에서 `POST /api/sync/v1/backup`의 CPU 시간이 10ms 안인지. 넘으면 계획서의 `data` 문자 검사(정규식)를 머리·길이 검사만 남기도록 줄인다. 크기 확인(읽기 전용): `npx wrangler d1 execute landmark-preview --remote --command "SELECT stored_bytes, raw_bytes, parts FROM library_backups"`.
4. **(3단계로 되돌린 뒤에만)** 지운 계정의 남은 백업 행 정리(사용자가 직접, 쓰기 명령):
   `npx wrangler d1 execute landmark --remote --command "DELETE FROM library_backup_parts WHERE user_id NOT IN (SELECT id FROM users); DELETE FROM library_backups WHERE user_id NOT IN (SELECT id FROM users)"`

## 시험

- 단위(vitest)
  - 서버(`node:sqlite` 가짜 D1, `// @vitest-environment node`): 스키마 6·멱등·버전 5에서 올라감·`ALTER` 없음, 본문 검사(각 필드 422·남는 키·`data` 머리·길이 413·본문 1,500,001바이트 413), 쓰기(조각 1·3개 나눔, 덮어쓰기 뒤 옛 조각 없음, `ifMatch` 세 경우와 409, 사용자 격리), 읽기(메타 `writable`, 데이터 이어 붙이기·`id` 다름 409·없음 404), 지우기 204, 하루 한도(쓰기 21번째·읽기 201번째 429), `AUTO_BACKUP=off`(쓰기 503·읽기·지우기 됨), `LIBRARY_SYNC=off`(쓰기 503·읽기 됨), `DELETE /v1/account`가 백업 행을 지움.
  - 브라우저: 스냅샷(gzip·base64 왕복, 1 MiB 넘음 `too-large`, `CompressionStream` 없음 `unsupported`, 풀기 상한 `too-big`, 깨진 base64·gzip 아님 `invalid`, `readBackupText` 결과), API 실패 해석(409 `busy`·`server 409` → `changed`, `off`·`limit off` → `off`, 404 → `not-found`), 자동 백업 판단 표 15줄 각각과 `nextCheckAt` 값, 로컬 키 깨진 값·다른 사용자, 실행기 붙이기(붙일 때 `synced`면 한 번, `onRunFinished` 중복 실행 없음, Web Lock 못 얻으면 건너뜀).
  - 폴더 알림: 기한 계산(24시간·연결 `checkedAt`·지운 연결·지운 라벨·최대 5개·오래된 순), 확인(새·빠진 수, 서명 같으면 다시 알리지 않음, 새 곳이 늘면 다시, `NOT_FOUND` 기록, 그 밖 오류), 토스트 문구(하나·여럿·빠진 곳만), 표시 조건(기록이 연결보다 늦을 때만), 꺼짐이면 아무것도 받지 않음, Web Lock.
  - 화면: 설정 서버 백업 구역(위 상태 표 각 줄, 덮어쓰기 확인 두 경우, 자동 스위치 꺼짐 조건, 마지막 자동 결과 문구), `RestoreDialog` 원격 모드(받는 중·실패와 다시 시도·머리 줄·체크 기본값·체크면 파일을 먼저 받고 `savedText`로 바꿈·체크 풀면 `requirePrevious`·파일 모드는 그대로), 라벨 관리 줄·라벨 고치기 문구, 설정 › 가져오기 스위치·`지금 확인`.
- E2E(Playwright, desktop): `server-backup.spec.ts` — 3단계 `installSyncServer`로 가짜 로그인 → 올리기 → 서버 백업 지금 만들기 → 장소 하나 지움 → 서버 백업에서 되살리기(파일 받기 이벤트 확인) → 장소가 돌아옴 → 자동 백업 켜기 → 서버 행 `created_at`을 25시간 앞으로 → 메모 고치고 새로고침 → `· 자동` 줄 → 서버 백업 지우기. `folder-watch.spec.ts` — 폴더를 가져온 뒤 연결의 `checkedAt`을 사흘 전으로 → 응답을 4곳으로 → 새로고침 → 토스트 → `가져오기` → `새로 저장한 곳 1 · 그대로 3 · 폴더에서 빠진 곳 0` → 라벨 관리 줄. 확인 요청에 `fresh`가 없음.
- 미리보기: 실제 보관함으로 수동·자동 백업, `POST` CPU 시간, iOS 사파리에서 되살리기 전 파일 받기, 다른 기기에서 되살리기.

## 완료 조건

- 위 시험 통과, `yarn typecheck`·`yarn lint`·`yarn test`·`yarn build:ci`(크기·나눔 검사 포함) 통과.
- 로컬에서 실제 키 없이 3단계 `yarn dev:sync`(+ 가짜 로그인)로 서버 백업 만들기 → 다른 출처(`127.0.0.1`)에서 되살리기 → 자동 백업(개발용 간격)까지 화면으로 된다. 폴더 알림은 `yarn dev:full`/`dev:sync`에서 공개 폴더를 가져와 개발용 도우미로 본 장소를 줄인 뒤 `지금 확인`으로 된다.
- `docs/development.md`(새 절: 서버 백업·폴더 알림 실행·변수·API), 도움말 설정·라벨 팁 한 줄씩(움직이는 그림 재생성 없음), `README.md` 기능 목록 한 줄을 고친다. `docs/rollback.md`는 병합 뒤 별도 PR.
