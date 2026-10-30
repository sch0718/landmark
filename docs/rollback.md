# 롤백

주요 변경마다 `main`의 병합 커밋에 버전 태그를 붙인다. 문제가 생기면 **배포만 먼저 되돌리고**(1분), 필요하면 **코드를 되돌리는 PR**을 만든다.

## 버전

| 태그 | 커밋 | 내용 | 이 버전으로 되돌릴 때 지금(`v0.24.1`) 데이터 |
|---|---|---|---|
| `v0.1.0` | `bb1a705` | 보관함(하위 프로젝트 1)·HTML 공유 내보내기, 이름을 랜드마크로 | ⚠️ 여행이 하나라도 있거나 카카오·구글 장소가 있으면 손상 화면 |
| `v0.2.0` | `e92eacb` | 장소 추가: 링크·네이버 폴더·지도 핀 (#2) | ⚠️ 여행이 하나라도 있으면 손상 화면 |
| `v0.3.0` | `3ea21d1` | 여행 계획: 후보·Day·경로·시간 (#4) | ⚠️ 손상 화면 없이 열리지만, 그 버전에서 무엇이든 저장하면 모든 장소의 다녀옴·평(`visitedOn`·`review`)과 폴더 연결(`folders`)이 지워짐. 되돌리기 전에 백업 파일을 받아 두기 |
| `v0.4.0` | `88dd0cc` | 받은 공유 파일 가져오기 (#6) | ⚠️ `v0.3.0`과 같음(다녀옴·평·폴더 연결이 저장 때 지워짐) |
| `v0.5.0` | `15adf03` | 다듬기 1: 결함·코드 정리 (#8) | ⚠️ `v0.3.0`과 같음(다녀옴·평·폴더 연결이 저장 때 지워짐) |
| `v0.6.0` | `2cee518` | 다듬기 2: 첫 로딩 (#10) | ⚠️ `v0.3.0`과 같음(다녀옴·평·폴더 연결이 저장 때 지워짐) |
| `v0.7.0` | `a40e83b` | 다듬기 3: 디자인 QA·접근성 (#12, 묶음별 되돌리기는 아래 D3 절) | ⚠️ `v0.3.0`과 같음(다녀옴·평·폴더 연결이 저장 때 지워짐) |
| `v0.7.1` | `86f86e9` | 고침: 네이버 공유 폴더 새 링크(`/v5/favorite/myPlace/folder/…`)·저장 목록·v5 장소 주소 받기 (#14) | ⚠️ `v0.3.0`과 같음(다녀옴·평·폴더 연결이 저장 때 지워짐) |
| `v0.7.2` | `28269d7` | 고침: 터치 전용 기기의 지도는 네이버 확대·축소 막대 대신 44px ＋/− 버튼(공유 HTML 지도는 그대로), 테스트 제한 시간 20초 (#16) | ⚠️ `v0.3.0`과 같음(다녀옴·평·폴더 연결이 저장 때 지워짐) |
| `v0.8.0` | `9711e53` | 전체 백업·복원: 설정 › 백업, 되살리기·되돌리기, 손상 화면에서 되살리기, 백업 알림 (#19) | ⚠️ `v0.3.0`과 같음(다녀옴·평·폴더 연결이 저장 때 지워짐). 백업 키 `tripmap:backup:v1`·`tripmap:library:v2:before-restore`는 이 버전부터 읽는다 |
| `v0.9.0` | `1732bdb` | 다녀온 곳·한 줄 평: 장소 상세 다녀옴·평, 방문 칩, 다녀온 날순, 일괄 다녀옴 (#21) | ⚠️ 다녀옴·평은 그대로지만, 저장하면 폴더 연결(`folders`)이 지워짐. 장소·라벨은 그대로이고 돌아온 뒤 폴더 링크를 한 번 더 붙여 넣으면 다시 연결됨 |
| `v0.10.0` | `7d81384` | 네이버 폴더 다시 가져오기: 폴더 연결, 라벨 관리에서 새로 저장한 곳만 가져오기 (#22) | ✅ 다녀옴·평·폴더 연결 모두 그대로 |
| `v0.11.0` | `553310e` | 내 근처 저장 장소: 보관함 가까운 순·반경, 지도 내 위치 보기 (#24) | ✅ 저장 형식 그대로. 위치·`가까운 순`은 메모리에만 있어 저장되지 않음 |
| `v0.12.0` | `c908b2c` | 여행 당일 모드: 오늘 일정·다음 장소 길찾기·다녀옴 체크·늦어짐·내 위치·화면 켜 두기 (#25) | ✅ 저장 형식 그대로. 고른 Day·위치·화면 켜 두기는 저장하지 않음 |
| `v0.13.0` | `279cdcf` | 영업시간·휴무 경고: 시간표 행·지도 카드, 기기 캐시 `tripmap:hours:v1` (#26) | ✅ 보관함 형식 그대로. 새 키 `tripmap:hours:v1`은 다시 받는 캐시라 옛 버전은 읽지도 지우지도 않음 |
| `v0.13.1` | `0643a95` | 고침: 경로 조회가 본문을 받는 중 시간 초과가 나도 전송을 끊음 (#27) | ✅ |
| `v0.13.2` | `cf25516` | 근처 줄에 반경 밖 숨은 수(`· 3km 밖 N곳은 숨김`), 사용자의 `필터 지우기`도 근처 모드를 끔 (#30, 병합 `bf78a5d`) · 고침: 다크 테마의 늦음·오류 글자와 빨간 버튼 대비 4.5:1 이상 (#29) | ✅ |
| `v0.14.0` | `c3bc22a` | 여행 일정 공유: 일정 공유 파일(v2)·보기 화면 일정 모드·지도 페이지 규약 v2·여행째 가져오기 (#31) | ✅ |
| `v0.14.1` | `881907a` | 운영 도메인 `landmark.sch0718.dev`: 서버 함수 허용 출처, 보기 화면 `Landmark에 담기` 기본 주소, 네이버 지도 앱 길찾기 `appname` (#33) | ✅ |
| `v0.14.2` | `8d94fd0` | 선택 풀기(마커 다시 누르기·지도 빈 곳·Esc·넓은 화면 닫기), 거를 때 지도를 결과에 맞춤, 긴 이름 툴팁, `라벨 관리` 맨 앞 (#35, A1) | ✅ 저장 형식 그대로. 열기 전 화면은 메모리에만 있다 |
| `v0.14.3` | `c795029` | 휴대폰 상세를 지도·목록 위 아래쪽 시트로(반쯤/다 펼침), 라벨 칸은 붙은 라벨 + `라벨 바꾸기` 창(검색·많이 쓴 순·새 라벨) (#36, A2) | ✅ 저장 형식 그대로. 시트 단계·뒤 화면은 브라우저 기록 상태(`history.state`)에만 있어 옛 버전은 무시한다 |
| `v0.14.4` | `83aae0b` | 앱 아이콘(핀 안의 산)·파비콘·홈 화면 아이콘·`manifest.webmanifest`·모드별 `theme-color`, 넓은·중간 화면 내비 맨 위 로고 (#39, C) | ✅ 저장 형식 그대로 |
| `v0.14.5` | `b33442f` | 링크로 공유(`링크 복사`·`링크 공유`, `/view#d=…`, 서버 저장 없음)와 도메인 `/view` 보기 화면, `/view`의 `Landmark에 담기`는 같은 탭 (#40, E) | ✅ 저장 형식·공유 문서 형식 그대로 |
| `v0.14.6` | `c45490e` | `라벨 찾기` 창(검색·내 순서/많은 순·여러 개), 고른 라벨을 칩 줄 맨 앞, 넘칠 때 칩 줄 스크롤 단추, 지역 두 단계(시·도 → 시·군), 지역 계산 재사용·장소 선택 때 마커 재구성 없음, `여행에 넣기`·`새 여행` 창은 열 때 받음 (#41, D) | ✅ 보관함 저장 형식 그대로. 화면 선호의 지역 거르기(`query.regions`)에 새 값(`강원/전체`·`강원/강릉`)이 들어갈 수 있다(아래) |
| `v0.14.7` | `76887c1` | 라벨 이모지: 라벨 편집의 이모지 고르기, 이름으로 추천(새 라벨 처음 값), 라벨 관리 `이름으로 이모지 정하기`(미리보기·되돌리기), 이모지는 아이콘 대신·지도 마커 이름 앞에 (#43, B) | ⚠️ 라벨에 선택 필드 `emoji`를 더했다(`schemaVersion: 2` 그대로). 옛 버전은 떼어 내고 읽어 화면은 열리지만 옛 버전에서 저장하면 라벨 이모지가 지워진다(아래) |
| `v0.14.8` | `9985631` | 여행 계획 지도의 다른 Day 장소를 작은 점(설명 `Day N · 이름`)으로, 지도에 `다른 Day 장소` 켜기·끄기 단추, 공유 일정 지도 페이지도 같은 점 (#45) | ✅ 저장 형식·공유 형식 그대로 |
| `v0.14.9` | `7b7d5aa` | 라벨은 이모지만: 칩·배지·타일·라벨 관리·찾기·고르기·병합·일괄 편집·폴더 목록에서 선 아이콘을 그리지 않고, 이모지가 없으면 이름만. 라벨 편집의 `아이콘` 고르기를 뺌 (#47) | ✅ 저장 형식 그대로. 라벨의 `icon` 값은 옛 버전이 읽도록 계속 저장한다(새 라벨은 `star`) |
| `v0.15.0` | `9467aea` | 약속장소 정하기: 새 탭 `약속`(출발지 이름 검색·지도·보관함, 번화가 역 중간 지점 순위, 역 근처 보관함 장소를 후보로), 후보·답장·확정 링크(`/meet#d=`·`#r=`·`#f=`, 서버 저장 없음), `/api/route` 대중교통(`mode=transit`)·`/api/search` (#48) | ⚠️ 보관함에 선택 키 `meetings`(약속)를 더했다(`schemaVersion: 2` 그대로). 옛 버전은 떼어 내고 읽어 화면은 열리지만 옛 버전에서 저장하면 약속이 모두 지워진다(아래) |
| `v0.16.0` | `edaa752` | 앱 안 도움말: `/help` 목록과 `/help/<메뉴>` 화면(움직이는 그림·단계·팁), 설정 › `도움말`·내비 레일 `도움말`·각 화면 물음표 단추, 보관함·지도·여행·약속·라벨 관리 처음 안내 창(기기 키 `tripmap:help-seen:v1`), 도움말 그림을 `public/help/img`로 (#52) | ✅ 보관함·백업 형식 그대로. 새 키 `tripmap:help-seen:v1`은 옛 버전이 읽지 않음 |
| `v0.17.0` | `cbe2d42` | 약속 온라인 집계: 새 약속을 처음 보낼 때 서버(Cloudflare D1)에 올리고(Turnstile) 친구 링크 `/meet/<id>`로 보냄, 친구 답장(참석자 차지·좋아요·출발지)을 10초마다 자동 집계, 주최자 메뉴 `다른 기기에서 열기`(`/meet/<id>#h=…`)·`참석자 차지 풀기`·`서버에서 지우기`, 서버 사본 30일 보관, 서버 함수 `/api/meet`, 기능 스위치 `MEET_ONLINE=off` (#55) | ⚠️ 보관함·백업 형식 그대로. 새 기기 키 `tripmap:meet-online:v1`과 탭 세션 키 `tripmap:meet-host-link:v1`은 옛 버전이 읽지 않음. 서버(D1)의 약속은 남음. 다만 친구 답장 초안(`tripmap:meet-drafts:v1`)은 옛 버전이 읽지 못하고, 옛 버전에서 초안을 저장하면 지워짐(아래) |
| `v0.18.0` | `6144b70` | 라이선스 PolyForm Noncommercial 1.0.0(`LICENSE`·`package.json`·README), 설정 › `이 앱에 대해`(저작권·라이선스·오픈소스 고지·소스 링크, `KOFI_URL`이 있을 때만 Ko-fi 후원 링크), 오픈소스 고지 `public/third-party-notices.txt`와 `yarn build:notices`, CI 고지 확인 (#57) | ✅ 저장 형식·공유 형식 그대로. 새 저장 키 없음 |
| `v0.19.0` | `808902c` | 카카오톡으로 보내기: 장소 내보내기·일정 공유·약속(후보·답장·확정)에 `카카오톡` 단추(카카오 SDK 2.8.4 피드 카드, 링크 2,000자까지, `VITE_KAKAO_JS_KEY`가 없으면 숨김), 앱 무관 모듈 `src/lib/kakao-share/` (#59) | ✅ 저장 형식·공유 형식 그대로. 새 저장 키 없음 |
| `v0.19.1` | `0c28592` | 카카오톡 공유 고침: SDK 2.8.4가 `Kakao.init()` 뒤에 붙이는 `Share`를 init 전에 찾던 문제(운영에서 `카카오톡을 불러오지 못했어요`), 링크 길이 기본 한도 2,000자 → 400자(모바일 SDK 메시지 10,000자 한도 실측). 장소·일정 링크는 카카오톡 대신 `링크 복사` 안내 (#62) | ✅ 저장 형식·공유 형식 그대로. 새 저장 키 없음 |
| `v0.20.0` | `98956c2` | 카카오톡용 공유 짧은 링크: 장소 내보내기·일정 공유의 긴 링크가 400자를 넘으면 `카카오톡`이 브라우저에서 암호화한 사본을 D1에 올리고 `/s/<id>#k=<키>`(72자)를 보냄(누르면 만들고 다음 클릭에 보냄), 받는 쪽은 `/s/<id>`가 키로 풀어 `/view#d=…`로, 장소 30일·일정 여행 끝 + 7일(최대 180일) 보관, 설정 › `보낸 짧은 링크`에서 지우기, 서버 함수 `/api/share`·`/s/*`, D1 표 `share_links`(스키마 2), 기능 스위치 `SHARE_SHORT=off` (#67) | ✅ 보관함·백업·공유 문서 형식 그대로. 새 기기 키 `tripmap:share-links:v1`은 옛 버전이 읽지 않음. 서버(D1)의 짧은 링크 사본은 남음(아래) |
| `v0.20.1` | `58278d5` | 카카오 공유 모듈을 앱 안 사본(`src/lib/kakao-share/`) 대신 공용 패키지 `@sch0718/kakao-share` 0.1.1(GitHub Packages)로. 화면·동작은 그대로(0.1.1의 소스·타입·빌드 결과가 사본과 같음), 저장소 `.npmrc`와 빌드 토큰 `GITHUB_PACKAGES_TOKEN`(Pages Production·Preview, Actions는 `packages: read`) (#69) | ✅ 저장 형식·공유 형식 그대로. 새 저장 키 없음 |
| `v0.20.2` | `dd2964d` | 처음 안내 기록(`src/services/help-seen.ts`)을 공용 패키지 `@sch0718/seen-store` 0.1.0에 맡김(기기 키 `tripmap:help-seen:v1`·형식 그대로, #71), README·도움말 움직이는 그림 생성기의 기반 함수를 `@sch0718/motion-kit` 0.1.0(devDependency)에서 가져옴(생성물 31개 바이트 같음, #72) | ✅ 저장 형식·공유 형식 그대로. 처음 안내 기록 키·형식 그대로 |
| `v0.21.0` | `01b9930` | 여행 갱신 공유(2A): `일정 공유` › `갱신 링크…`로 보기 링크 `/view#t=<id>.<보기 토큰>`(보는 동안 10초마다 최신 일정)과 소유자 링크 `/trips/live/<id>#h=…`(다른 기기에서 담고 이어 고치기), 계획 화면이 열려 있는 동안 고친 내용 자동 올리기, 설정 › `갱신 링크`, 마지막 갱신 뒤 30~180일 보관, 서버 함수 `/api/trip-live`, D1 표 `trip_shares`·`trip_share_tokens`(스키마 3), 기능 스위치 `TRIP_SHARE_LIVE=off` (#74) | ✅ 보관함(`tripmap:library:v2`, schema 2)·백업·공유 문서 형식 그대로. 새 기기 키 `tripmap:trip-live:v1`(소유자 토큰)은 옛 버전이 읽지 않음. 서버(D1)의 갱신 공유 표는 남음(아래) |
| `v0.22.0` | `df7e4fe` | 여행 함께 편집·당일 진행(2B): 갱신 링크 창 › `함께 편집…`의 1회용 편집 초대 `/trips/join/<id>#i=…`, 기기별 편집 토큰·`편집 권한 거두기`, 3방향 병합과 같은 곳을 고쳤을 때의 `비교하기` 창, 당일 화면의 공동 다녀옴 체크·다음 장소, 공유 문서 `LiveTripDoc` v2, 서버 함수 `/api/trip-collab`, D1 표 `trip_collab_devices`·`trip_collab_meta`·`trip_progress`(스키마 4, 초대는 `trip_share_tokens`의 `kind = 'invite'`), 기능 스위치 `TRIP_COLLAB=off` (#77) | ⚠️ 보관함·백업·공유 문서 형식 그대로. 새 기기 키 `tripmap:trip-collab:v1`·`tripmap:trip-collab-base:v1:<공유 id>`·`tripmap:trip-live-plan:v1`은 옛 버전이 읽지 않음(2A 기록 모양은 그대로라 소유자 토큰 유지). D1 2B 표는 남음. **`v0.21.0`으로 되돌릴 때는 함께 편집으로 v2가 된 갱신 공유를 SQL로 v1로 돌려야 2A 보기 화면이 열림**(아래) |
| `v0.23.0` | `be341e9` | 기기 간 보관함 동기화(3): 설정 › `동기화`에서 Google·카카오·네이버 로그인(`@sch0718/firebase-session` 0.2.1, 허용 목록 `ALLOWED_ACCOUNTS`·`ALLOWED_EMAILS`) 뒤 장소·라벨·여행·폴더 연결·약속을 항목별로 맞춤(필드 단위 마지막 변경, 묘비 90일, 충돌 목록), 기기 관리·`서버 자료 모두 지우기`, `/auth/callback`, 서버 함수 `/api/sync`, D1 표 `users`·`sessions`·`library_state`·`library_items`·`library_devices`(스키마 5), 기능 스위치 `LIBRARY_SYNC=off` (#75) | ✅ 보관함·백업 형식 그대로. 새 기기 키 `tripmap:sync:v1`·`tripmap:sync-base:v1`·`tripmap:sync-conflicts:v1`·`tripmap:sync-session:v1`은 옛 버전이 읽지 않음. 서버(D1)의 계정·보관함 사본은 남음(아래) |
| `v0.24.0` | `56f8a5f` | 서버 자동 백업·네이버 폴더 변경 알림(4): 설정 › 백업 › `서버 백업`(로그인 계정당 하나, 지금 만들기·되살리기·지우기), 동기화를 켠 기기의 하루 한 번 자동 백업, 앱을 열 때 하루 한 번 네이버 폴더를 다시 읽어 새로 저장한 곳을 알림(토스트·라벨 관리, 설정 › 가져오기 스위치), 서버 함수 `/api/sync/v1/backup`, D1 표 `library_backups`·`library_backup_parts`(스키마 6), 기능 스위치 `AUTO_BACKUP=off` (#76) | ⚠️ 보관함·백업 파일 형식 그대로. 새 기기 키 `tripmap:server-backup:v1`·`tripmap:folder-watch:v1`은 옛 버전이 읽지 않음. D1 백업 표는 남음. **`v0.23.0`으로 되돌린 동안 `서버 자료 모두 지우기`를 한 계정의 서버 백업은 지워지지 않아 SQL로 정리**(아래) |
| `v0.24.1` | `82ab305` | 고침: 서버 API 형식 오류(`400 BAD_REQUEST`) 문구를 기능별로. 갱신 공유·함께 편집·짧은 링크가 약속 문구 「약속 입력이 올바르지 않아요」를 돌려주던 것을 「공유 일정 요청이…」·「함께 편집 요청이…」·「짧은 링크 요청이…」로(`validate`가 문구를 인자로 받음, 응답 모양·화면 그대로) (#79) | ✅ 저장 형식·공유 형식 그대로. 새 저장 키 없음 |

- 마지막 열은 2026-10-17에 `v0.8.0`·`v0.9.0`·`v0.10.0`의 `src/schema`로 지금 형식의 문서(`visitedOn`·`review`·`folders` 포함)를 읽어 확인했다(차례로 셋 다 지움 / `folders`만 지움 / 모두 유지). `v0.3.0`~`v0.7.2`는 `v0.8.0`과 저장 형식이 같다. 새 버전을 낼 때 저장 형식에 필드를 더했다면 그보다 옛 버전 줄을 모두 다시 본다.
- 보관함은 각 기기의 localStorage(`tripmap:library:v2`)에 있다(`v0.23.0`부터 동기화를 켠 계정은 D1에도 항목별 사본이 있지만 기기의 저장 형식은 그대로다). `v0.3.0`~`v0.8.0` 사이는 저장 형식이 같아 데이터 걱정 없이 오갈 수 있다. 그 뒤로는 선택 필드만 더했다(`v0.9.0` 장소의 `visitedOn`·`review`, `v0.10.0` 보관함의 `folders`). `v0.11.0`~`v0.14.6`은 보관함 저장 형식을 바꾸지 않았다. `v0.14.7`은 라벨에 선택 필드 `emoji`만 더했다(`v0.13.0`이 더한 `tripmap:hours:v1`은 지워도 다시 받는 캐시다. `v0.14.0`이 가져온 여행·장소도 지금 스키마 그대로다). `v0.15.0`은 보관함에 선택 키 `meetings`(약속)만 더했다. 옛 버전은 모르는 필드를 손상으로 보지 않고 떼어 낸 채 읽으므로 화면은 그대로 열리지만, **옛 버전에서 무엇이든 저장하는 순간 그 필드가 지워진다.** 되돌리기 전에 설정 › 백업에서 백업 파일을 받아 두면, 새 버전으로 돌아온 뒤 그 파일로 되살릴 수 있다.
- `v0.9.0`부터 화면 선호(`tripmap:prefs`)에 선택 키 `query.visited`가 있다. 옛 버전은 이 키를 떼어 내고 읽어 테마·보기 설정은 그대로다(리터럴 값은 늘리지 않았다).
- **손상 화면**: 옛 버전은 모르는 형식을 손상으로 보고 `tripmap:library:v2:corrupt-<시각>`에 백업을 남긴 뒤 `백업 파일 받기`·`새로 시작`을 보인다. 이때 **`새로 시작`을 누르지 않는다**(보관함이 비워진다). 다시 새 버전으로 되돌리면 원래 데이터를 그대로 읽는다(옛 버전은 원본 키를 지우지 않는다 — `새로 시작`을 눌렀을 때만 지운다).
- 공유 HTML 파일은 그 안에 보기 화면이 들어 있어 앱 버전과 상관없이 열린다. 공유 지도 페이지(`gh-pages`)는 따로 배포된다(아래).
- `v0.14.0`보다 옛 버전으로 되돌린 앱은 일정 공유 파일(v2)을 가져오면 `공유 파일을 읽지 못했어요…`를 보인다(보관함은 그대로). 장소만 보내는 파일(v1)은 영향이 없다. 지도 페이지를 `v0.14.0`보다 옛 것으로 되돌리면 v2 파일의 지도에는 장소 마커만 보이고 번호·Day 색·경로선이 없다(목록·시간표는 그대로). 그 사이에 만든 v2 파일은 다시 만들 필요가 없다. 지도 페이지를 다시 올리면 같은 파일이 일정 지도로 열린다.
- `v0.14.1`보다 옛 버전으로 되돌리면 운영 도메인 `https://landmark.sch0718.dev`에서 화면은 열리지만 서버 함수(링크로 장소 추가·폴더 가져오기·경로·영업시간)가 403 `FORBIDDEN_ORIGIN`이 된다. 그동안은 Pages 기본 주소 `https://landmark-c5f.pages.dev`를 쓴다. 보관함은 주소(출처)마다 따로라, 기본 주소에서 쓰려면 운영 도메인에서 `전체 백업`을 받아 기본 주소에서 `복원`한다. `v0.14.1` 뒤에 만든 공유 파일의 `Landmark에 담기`는 되돌린 뒤에도 운영 도메인을 연다.
- `v0.14.5`보다 옛 버전으로 되돌리면 이미 보낸 `/view#d=…` 링크는 앱 화면(보관함)으로 열려 받은 장소가 보이지 않는다. 링크 안의 데이터는 그대로라 다시 올리면 같은 링크가 열린다. 파일로 보낸 공유는 영향이 없다.
- `v0.14.6`보다 옛 버전으로 되돌리면 화면 선호에 저장된 새 지역 거르기 값(`강원/전체`·`강원/강릉`)을 옛 지역 칩이 알지 못해 결과가 0곳일 수 있다. 빈 결과의 `필터 지우기`로 푼다. 옛 단일 값(`강릉` 등)은 두 버전 모두 같은 뜻이다.
- `v0.14.7`보다 옛 버전으로 되돌리면 라벨의 `emoji`를 모르는 필드로 떼어 내고 읽는다. 화면은 열리고 라벨은 아이콘으로 보이지만, **옛 버전에서 무엇이든 저장하면 모든 라벨 이모지가 지워진다.** 되돌리기 전에 설정 › 백업에서 전체 백업을 받아 두면 새 버전으로 돌아온 뒤 되살릴 수 있다. 공유 파일·링크에는 원래 이모지가 들어가지 않아 영향이 없다.
- `v0.14.8`의 지도 페이지만 옛 것으로 되돌리면 그 뒤에 만든 일정 파일의 다른 Day 장소가 이름이 든 흐린 이름표로 보인다(목록·시간표는 그대로). 앱만 되돌리면 계획 화면의 다른 Day 장소가 다시 글자 없는 막대로 보인다.
- `v0.14.9`보다 옛 버전으로 되돌리면 라벨에 선 아이콘이 다시 보이고 라벨 편집에 `아이콘` 고르기가 다시 생긴다. `icon` 값은 계속 저장해 왔으므로 예전에 고른 아이콘이 그대로 나온다. 데이터 걱정은 없다.
- `v0.15.0`보다 옛 버전으로 되돌리면 보관함의 `meetings`를 모르는 키로 떼어 내고 읽는다. 화면은 열리고 장소·라벨·여행은 그대로지만 `약속` 탭이 없고, **옛 버전에서 무엇이든 저장하면 모든 약속이 지워진다.** 백업 파일은 원본 JSON을 담아 약속도 들어가므로, 되돌리기 전에 설정 › 백업에서 전체 백업을 받아 두면 새 버전으로 돌아온 뒤 되살릴 수 있다. 이미 보낸 `/meet#…` 링크(후보·답장·확정)는 옛 버전에서 없는 화면이 되지만 링크 안의 데이터는 그대로라 다시 올리면 같은 링크가 열린다. 공유 파일·링크(`/view`·`/import`)와 여행 저장 형식은 바뀌지 않았다. `/api/route`의 `transit`과 `/api/search`는 새 화면만 부르므로 옛 화면에는 영향이 없다.
- `v0.16.0`보다 옛 버전으로 되돌리면 `/help` 화면·물음표 단추·처음 안내가 사라진다. 기기에 남은 `tripmap:help-seen:v1`은 읽지도 지우지도 않으므로, 다시 새 버전으로 오면 이미 본 안내는 다시 뜨지 않는다. 데이터 걱정은 없다. 도움말 그림은 `public/help/img`에서 다시 `docs/help/img`로 돌아가며 GitHub 문서 그림 경로도 함께 돌아간다.
- `v0.17.0`보다 옛 버전으로 되돌리면 서버 함수 `/api/meet`가 사라져 온라인 약속을 더 올리거나 받을 수 없다. 이미 보낸 친구 링크 `/meet/<id>`와 주최자 링크(`#h=`)는 옛 앱이 몰라 `페이지를 찾을 수 없어요` 화면이 된다. 주최자 보관함의 약속과 그때까지 받아 둔 답장·출발지는 보관함에 있으므로 그대로 보이고, 옛 앱에서는 보통 약속(링크 방식 `#d=`·`#r=`·`#f=`)으로 다시 보낼 수 있다. 기기 키 `tripmap:meet-online:v1`(토큰)은 읽지도 지우지도 않고, D1의 약속·답장도 지우지 않으므로 다시 새 버전으로 오면 같은 링크로 이어서 쓴다(그동안 30일 보관 기한이 지나면 서버 사본은 끝난 약속이 된다). 친구 기기의 답장 초안 키 `tripmap:meet-drafts:v1`은 `v0.15.0`부터 있던 키인데, `v0.17.0`은 항목마다 `version`(온라인 초안은 `docRev`도)을 더해 저장한다. 옛 버전은 모르는 필드가 있는 항목을 버리고 읽으므로 새 버전이 저장한 초안(링크 방식·온라인 모두)은 보이지 않고, **옛 버전에서 링크 방식 답장 초안을 하나라도 저장하면 키를 다시 써서 새 버전의 초안이 모두 지워진다.** 보낸 답장과 서버의 답장은 영향이 없고, 아직 보내지 않은 초안만 잃는다. 서버 쪽 장애만 피하려면 되돌리기 대신 Pages 환경 변수 `MEET_ONLINE=off`를 넣고 다시 배포한다. 새 약속은 링크 방식으로 공유되고 이미 올린 약속의 읽기·답장은 계속 된다.
- `v0.20.0`보다 옛 버전으로 되돌리면 서버 함수 `/api/share`·`/s/<id>`가 사라진다. 이미 보낸 카카오톡 짧은 링크는 SPA 기본 동작으로 앱 화면이 열려 `페이지를 찾을 수 없어요`가 되고, 장소·일정 공유 창의 `카카오톡`은 다시 꺼져 `링크 복사`를 안내한다. D1의 `share_links` 행과 `schema_meta` 버전 2는 남는다. 옛 코드의 `ensureSchema`는 버전이 1 이상이면 아무것도 하지 않으므로 약속은 그대로 동작한다. 옛 코드에는 짧은 링크 만료 정리가 없어 되돌린 동안 기한이 지난 행이 남는다(열리지 않고, 암호문이라 내용도 읽을 수 없다). 오래 되돌려 둘 때는 `wrangler d1 execute landmark --remote --command "DELETE FROM share_links WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')"`로 지운다. 기기 키 `tripmap:share-links:v1`(삭제 토큰)은 옛 버전이 읽지도 지우지도 않으므로, 다시 새 버전으로 오면 설정 › `보낸 짧은 링크`에 그대로 보이고 기한 안의 링크도 다시 열린다. 서버 쪽 문제만 피하려면 되돌리기 대신 Pages 환경 변수 `SHARE_SHORT=off`를 넣고 다시 배포한다. 새로 만들기만 멈추고 이미 보낸 링크는 계속 열린다.
- `v0.20.1`보다 옛 버전으로 되돌리면 카카오 공유 모듈이 다시 앱 안 사본(`src/lib/kakao-share/`)이 되고 저장소 `.npmrc`가 사라진다. 사본은 패키지 0.1.1과 같은 코드라 화면·동작·데이터 걱정은 없다. Pages의 `GITHUB_PACKAGES_TOKEN`은 남겨 두어도 옛 버전 빌드가 쓰지 않는다. 반대로 `v0.20.1` 이상을 다시 빌드하려면 이 토큰이 Production·Preview 모두에 있어야 한다(없으면 `yarn install`이 `Failed to replace env in config: ${GITHUB_PACKAGES_TOKEN}`으로 멈춘다). 배포만 되돌리기(1절)는 빌드를 다시 하지 않으므로 토큰과 상관없다.
- `v0.20.2`보다 옛 버전으로 되돌리면 처음 안내 기록과 그림 생성기 기반 함수가 다시 앱 안 코드가 된다. 패키지와 같은 코드·같은 키(`tripmap:help-seen:v1`)·같은 저장 형식이라 이미 본 안내는 다시 뜨지 않고 생성물도 같다. 데이터 걱정은 없다.
- `v0.21.0`~`v0.24.0`(서버 로드맵 2A·2B·3·4)은 보관함·백업·공유 문서 형식을 바꾸지 않았다. 바뀐 것은 서버 함수·D1 표·기기별 새 키다. 되돌리는 순서, 기능 스위치, D1 스키마 버전, 2B → 2A의 SQL과 오래 되돌려 둘 때의 정리 명령은 아래 「서버 로드맵 2A·2B·3·4 되돌리기」 절에 모았다.
- `v0.24.1`보다 옛 버전으로 되돌리면 갱신 공유(`/api/trip-live`)·함께 편집(`/api/trip-collab`)·짧은 링크(`/api/share`)의 형식 오류 응답 문구가 다시 「약속 입력이 올바르지 않아요」가 된다. 클라이언트는 HTTP 상태와 `reason`으로만 나누고 이 문구를 화면에 쓰지 않으며 응답 모양도 같아, 화면·데이터 걱정은 없다.

## 1. 배포만 되돌리기 (가장 빠름, 코드는 그대로)

Cloudflare Pages는 지난 배포를 모두 보관한다.

1. Cloudflare 대시보드 → **Workers & Pages** → `landmark` → **Deployments**.
2. 되돌릴 버전의 커밋(위 표의 커밋 해시)이 적힌 **Production** 배포의 `…` → **Rollback to this deployment**.
3. 몇 초 안에 `https://landmark-c5f.pages.dev`가 그 배포로 바뀐다.

이 상태에서 `main`에 새 커밋이 병합되면 그 커밋이 다시 배포된다. 계속 옛 버전을 유지하려면 2번으로 코드를 되돌린다.

## 2. 코드 되돌리기 (PR로)

변경 하나(PR 하나)를 빼려면 그 병합 커밋을 되돌린다.

```bash
git switch main && git pull
git switch -c revert/<이름>
git revert -m 1 <병합 커밋>   # 병합 커밋(Merge pull request …)일 때
git revert <커밋>             # squash 병합 커밋일 때
```

PR을 만들어 CI를 통과하면 병합한다. 그 PR의 변경 일부(묶음 하나)만 빼려면 그 묶음의 커밋을 `git revert <커밋>`한다(묶음마다 커밋을 나눈 PR만 가능).

**뒤 PR이 그 PR의 코드를 쓰거나 고쳤으면 뒤 PR부터 되돌린다.** 최신 `main`에서 앞 PR만 되돌리면 충돌하거나, 남은 뒤 PR이 지워진 모듈을 가져와 빌드가 깨진다. F1~F7은 뒤 묶음마다 앞 묶음의 파일을 고치거나 함수를 가져다 쓰므로, **되돌리려는 묶음보다 뒤에 들어온 PR을 새 것부터 모두 먼저 되돌린다.** 고침 PR(`v0.x.1`)도 앞 묶음의 파일을 고쳤으면 같은 줄에 선다.

| 되돌리려는 PR | 먼저 되돌릴 PR(이 순서로) | 예 |
|---|---|---|
| #79 `82ab305` | 없음 | |
| #76 `56f8a5f` | 없음 | |
| #75 `be341e9` | #76 | #76이 #75가 만든 `src/server/library-sync/env.ts`·`library.ts`·`router.ts`·`src/services/library-sync/sync-engine.ts`와 시험(`tests/e2e/sync-server.ts`·`tests/unit/server/sync-schema.test.ts`·`tests/unit/services/library-sync-engine.test.ts`·`tests/unit/sections/backup/restore-sync-note.test.tsx`)을, #75가 고친 `src/server/meet/schema-sql.ts`·`src/sections/backup/RestoreDialog.tsx`·`src/sections/settings/SettingsPage.tsx`·`src/sections/shell/ShellRoute.tsx`·`src/vite-env.d.ts`·`package.json`·`playwright.config.ts`·`docs/development.md`·README를 다시 고쳤다(4는 3 위에 쌓였다) |
| #77 `df7e4fe` | #79 → #76 → #75 | #79가 #77이 만든 `src/server/trip-collab/handlers.ts`·`tests/unit/server/trip-collab-handlers.test.ts`와 #77이 고친 `tests/unit/server/trip-live-handlers.test.ts`를 다시 고쳤다. #75가 #77이 고친 `src/server/meet/schema-sql.ts`(`SCHEMA_VERSION` 4 → 5)·`tests/unit/server/meet-db.test.ts`·`package.json`을 다시 고쳤다. #76도 같은 파일을 고쳤다 |
| #74 `01b9930` | #79 → #76 → #75 → #77 | #77이 #74가 만든 `src/server/trip-live/handlers.ts`·`src/domain/trip-live/*`·`src/sections/trips/live/*`·`src/services/trip-live/client.ts`와 시험 등 41개 파일을 다시 고쳤다(2B는 2A 위에 쌓였다). #79도 `src/server/trip-live/handlers.ts`·`tests/unit/server/trip-live-handlers.test.ts`를 고쳤다 |
| #72 `dd2964d` | #79 → #76 → #75 → #77 → #74 | #74·#77·#75·#76이 #72가 고친 `docs/development.md`·`package.json`을, #74·#77이 `scripts/motion/help-pages.mjs`를, #75가 `yarn.lock`을 다시 고쳤다 |
| #71 `4fe011e` | #79 → #76 → #75 → #77 → #74 → #72 | #72가 #71이 고친 `docs/development.md`·공통화 문서·`yarn.lock`을 다시 고쳤다(#72 브랜치에 #71 뒤 main을 병합) |
| #69 `58278d5` | #79 → #76 → #75 → #77 → #74 → #72 → #71 | #71·#72가 #69가 고친 `docs/development.md`·공통화 문서·`package.json`·`yarn.lock`을, #71이 `public/third-party-notices.txt`를 다시 고쳤다 |
| #67 `98956c2` | #79 → #76 → #75 → #77 → #74 → #72 → #71 → #69 | #69가 #67이 고친 `tests/e2e/share-link.spec.ts`·`docs/development.md`를, #79가 `src/server/meet/handlers.ts`·`src/server/share/handlers.ts`·`tests/unit/server/share-handlers.test.ts`를 다시 고쳤다 |
| #65 `fad26d5` | #79 → #76 → #75 → #77 → #74 → #72 → #71 → #69 | #69가 #65가 고친 `.github/workflows/ci.yml`·`docs/development.md`를 다시 고쳤다 |
| #64 `701abc1` | #79 → #76 → #75 → #77 → #74 → #72 → #71 → #69 → #65 | #65가 #64가 고친 `.github/workflows/ci.yml`·`docs/development.md`를 다시 고쳤다 |
| #62 `0c28592` | #79 → #76 → #75 → #77 → #74 → #72 → #71 → #69 → #67 | #67이 #62가 고친 도움말(`scripts/motion/help-pages.mjs`·`src/sections/help/help-content.ts`·`docs/help/share.md`)·`tests/e2e/share-link.spec.ts`·`tests/unit/sections/share-export/share-link-dialog.test.tsx`를 다시 고쳤다 |
| #59 `808902c` | #79 → #76 → #75 → #77 → #74 → #72 → #71 → #69 → #67 → #62 | #62가 #59가 만든 `src/lib/kakao-share/*`·`tests/e2e/fixtures.ts`·`share-link.spec.ts`·공유 대화상자 시험과 도움말을 다시 고쳤다 |
| #57 `6144b70` | #79 → #76 → #75 → #77 → #74 → #72 → #71 → #69 → #67 | #67이 #57이 고친 `src/sections/settings/SettingsPage.tsx`를 다시 고쳤다. #59와는 `docs/development.md`만 겹치고 충돌하지 않는다 |
| #55 `cbe2d42` | #79 → #76 → #75 → #77 → #74 → #72 → #71 → #69 → #67 → #62 → #59 | #67이 #55가 만든 `src/server/meet/schema-sql.ts`·`limits.ts`·`handlers.ts`·`env.ts`를 고쳤다. #79가 #55가 만든 `src/server/meet/handlers.ts`·`tests/unit/server/meet-handlers.test.ts`를 다시 고쳤다. #59가 #55가 고친 `src/sections/meetings/MeetingResults.tsx`·`share-link.ts`·`use-online-meeting.ts`·`src/vite-env.d.ts`·`playwright.config.ts`·`tests/e2e/meetings*.spec.ts`·`tests/unit/sections/meetings/online-host.test.tsx`·`share-link.test.ts`와 도움말을 다시 고쳤다. #57과 겹치는 코드는 없다. 다만 #56이 #55의 설계 문서를 고쳐 `docs/superpowers/specs/2026-10-25-meeting-online-design.md`가 충돌(UD)하므로 그 파일을 지워 해결한다 |
| #52 `edaa752` | #55 | #55가 #52가 고친 `src/routes/paths.ts`·`router.tsx`·`src/sections/help/help-content.ts`·`src/sections/meetings/MeetingsPage.tsx`·`MeetingEditorPage.tsx`·`public/help/img/meetings-*.svg`·`package.json`·`playwright.config.ts`와 `tests/unit/sections/help/help-page.test.tsx`를 다시 고쳤다 |
| #48 `9467aea` | #55 → #52 | #55가 #48이 만든 `src/sections/meetings/*`(`MeetLinkPage.tsx`·`MeetingResults.tsx`·`share-link.ts`·`meet-drafts.ts` 등)·`src/domain/meeting/ops.ts`·`src/services/errors.ts`와 시험을 다시 고쳤고, #52가 #48이 만든 `src/sections/meetings/MeetingsPage.tsx`·`MeetingEditorPage.tsx`와 `src/routes/*`·`src/sections/shell/nav-items.ts`·`src/components/icons.tsx`·`package.json`·`playwright.config.ts`·`tests/e2e/fixtures.ts`를 다시 고쳤다 |
| #47 `7b7d5aa` | #55 → #52 → #48 | #48이 #47이 고친 `src/components/icons.tsx`·`src/domain/library/ops.ts`를, #52가 `src/components/icons.tsx`·`src/sections/labels/LabelsPage.tsx`를 다시 고쳤다 |
| #45 `9985631` | #55 → #52 → #48 → #47 | #52가 #45가 고친 `src/sections/trips/planner/TripPlannerPage.tsx`·`src/components/icons.tsx`를 다시 고쳤다 |
| #43 `76887c1` | #55 → #52 → #48 → #47 → #45 | #45가 #43이 고친 `src/sections/trips/planner/trip-map-layers.ts`·`src/components/icons.tsx`와 시험(`tests/unit/components/map-view.test.tsx`·`sections/trips/emoji-map-layers.test.ts`)을 다시 고쳤다 |
| #41 `c45490e` | #55 → #52 → #48 → #47 → #45 → #43 | #43이 #41이 고친 `src/sections/library/LabelChips.tsx`·`LabelFilterDialog.tsx`, `playwright.config.ts`·`package.json`을 다시 고쳤다 |
| #40 `b33442f` | #55 → #52 → #48 → #47 → #45 → #43 → #41 | #41이 `playwright.config.ts`(E2E 목록)를 함께 고쳤다 |
| #39 `83aae0b` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 | #41이 `package.json`(`build:ci`의 `--require-lazy`)을 함께 고쳤다 |
| #38 `cd3359d` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 | 시험만 고친 PR(`tests/e2e/library.spec.ts`). 겹치는 파일은 없지만 규칙대로 새 것부터 |
| #36 `c795029` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 | #41이 #36이 고친 `src/sections/library/LibraryPage.tsx`, `src/sections/map/LibraryMap.tsx`, `src/routes/lazy-routes.ts`, `tests/unit/sections/map/library-map.test.tsx`, `playwright.config.ts`·`package.json`을 다시 고쳤다 |
| #35 `8d94fd0` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 | #36이 #35가 고친 `src/sections/shell/AppShell.tsx`·`use-close-detail.ts`, `src/sections/map/LibraryMap.tsx`, `src/sections/library/LibraryPage.tsx`와 시험(`tests/e2e/library.spec.ts`, `tests/unit/sections/map/library-map.test.tsx`·`library/place-row.test.tsx`·`shell/app-shell.test.tsx`·`shell/close-detail.test.tsx`)을 다시 고쳤다(휴대폰에서 `useCloseDetail`이 시트 기록을 되감는다) |
| #33 `881907a` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 | 겹치는 파일은 없지만 규칙대로 새 것부터 |
| F7 `c3bc22a` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 | #33이 F7이 고친 `src/share-viewer/encode.ts`·`tests/e2e/fixtures.ts`·`tests/unit/share-viewer/main.test.ts`·`tests/unit/sections/trips/planner-timeline.test.tsx`를 다시 고쳤다 |
| #29 `cf25516` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 → F7 | 겹치는 파일은 없지만 규칙대로 새 것부터 |
| #30 `bf78a5d` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 → F7 → #29 | 겹치는 파일은 없지만 규칙대로 새 것부터 |
| #27 `0643a95` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 → F7 → #29 → #30 | |
| F6 `279cdcf` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 → F7 → #29 → #30 → #27 | #27이 F6의 `tests/unit/services/hours-lookup.test.ts`를 고쳤고, F7이 F6의 `DayTimeline.tsx`·`playwright.config.ts`를 고쳤다 |
| F5 `c908b2c` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 → F7 → #29 → #30 → #27 → F6 | F6이 F5의 `DAY_ROLLOVER_HOUR`·`addDays`를 쓰고, F7이 F5의 `trip-dates.ts`·`use-day-plan.ts`·`schema/trip.ts`(`addDays`를 `src/lib/calendar.ts`로)·`TripsPage.tsx`·`lazy-routes.ts`를 고쳤다 |
| F4 `553310e` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 → F7 → #29 → #30 → #27 → F6 → F5 | F7이 F4의 `SharePreview.tsx`를 고쳤고, #30이 F4의 `NearbyBar.tsx`·`LibraryPage.tsx`를 고쳤고, F5가 F4의 위치 서비스·`MyLocationButton`·`formatDistanceM`을 쓰고 위치 서비스를 고쳤다 |
| F3 `7d81384` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 → F7 → #29 → #30 → #27 → F6 → F5 → F4 | F4 Task 6이 F3의 `FolderResync.tsx`·`FolderList.tsx`에 근처 모드 끄기를 더했다 |
| F2 `1732bdb` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 → F7 → #29 → #30 → #27 → F6 → F5 → F4 → F3 | F5가 F2의 `setVisitedOn`·`visitedOnOf`를 쓰고, F3·F4가 F2의 파일을 고쳤다 |
| F1 `9711e53` | #55 → #52 → #48 → #47 → #45 → #43 → #41 → #40 → #39 → #38 → #36 → #35 → #33 → F7 → #29 → #30 → #27 → F6 → F5 → F4 → F3 → F2 | F2·F3·F4가 F1의 `backup-state.ts`·`summary.ts` 등을 고쳤다 |

2026-10-17에 `c908b2c`에서 F5 → F4 → F3 → F2 → F1 순서로 `git revert -m 1 <병합 커밋>`을 하나씩 실행했다. 다섯 번 모두 충돌이 없었고, 매번 `src`·`tests`가 그 PR이 들어오기 바로 전 커밋과 똑같았으며, typecheck와 시험이 통과했다.

| 되돌린 뒤 | 같아진 커밋 | 시험 |
|---|---|---|
| F5 | `553310e` | 2537 |
| F4 | `7d81384` | 2437 |
| F3 | `1732bdb` | 2363 |
| F2 | `c2d54c0` | 2273 |
| F1 | `b4b7e2c` | 2099 |

2026-10-18에 `0643a95`(최신 `main`)에서 #27 → F6 → F5 순서로 이어서 되돌렸다. 세 번 모두 충돌이 없었고 `src`·`tests`·`functions`가 그 PR 바로 전 커밋과 같았으며 typecheck와 시험이 통과했다(#27 뒤 2992개, F6 뒤 2747개, F5 뒤 2537개). F6만 바로 되돌리면 `hours-lookup.test.ts`에서 충돌한다. 2026-10-18에 `cf25516`(#29·#30 병합 뒤 `main`)에서 #29 → #30 → #27 → F6 순서로도 이어서 되돌려, 네 번 모두 충돌 없이 그 PR 바로 전 커밋과 같아지고 typecheck와 시험이 통과하는 것을 확인했다(2994 → 2993 → 2992 → 2747개).

2026-10-18에 `c3bc22a`(F7 병합 뒤 `main`, `v0.14.0`)에서 F7 → #29 → #30 → #27 → F6 순서로 `git revert -m 1 <병합 커밋>`을 이어서 실행했다. 다섯 번 모두 충돌이 없었고, 매번 `src`·`tests`·`functions`가 그 PR 바로 전 커밋과 같았으며, typecheck와 시험이 통과했다.

| 되돌린 뒤 | 같아진 커밋 | 시험 |
|---|---|---|
| F7 | `fca5dae` | 2997 |
| #29 | `bf78a5d` | 2994 |
| #30 | `0643a95` | 2993 |
| #27 | `279cdcf` | 2992 |
| F6 | `9f6856b` | 2747 |

F 묶음 사이에 다른 PR이 끼면 그 PR도 같은 기준(앞 PR의 파일을 고쳤는가)으로 본다.

2026-10-18에 `881907a`(#33 병합 뒤 `main`, `v0.14.1`)에서 #33 → F7 순서로 이어서 되돌렸다. 두 번 모두 충돌이 없었고 `src`·`tests`·`functions`가 그 PR 바로 전 커밋과 같았으며(#33 뒤 `d1c2c1b`, F7 뒤 `fca5dae`) typecheck와 시험이 통과했다(3319 → 2997개). 그 뒤 순서는 위 `c3bc22a`에서 확인한 것과 같다.

2026-10-19에 `c795029`(#36 병합 뒤 `main`, `v0.14.3`)에서 #36 → #35 → #33 → F7 순서로 `git revert -m 1 <병합 커밋>`을 이어서 실행했다. 네 번 모두 충돌이 없었고, 매번 `src`·`tests`·`functions`가 그 PR 바로 전 커밋과 같았으며, typecheck와 시험이 통과했다. #35만 바로 되돌리면 `src/sections/shell/AppShell.tsx`·`use-close-detail.ts`, `src/sections/map/LibraryMap.tsx`, `tests/unit/sections/shell/close-detail.test.tsx`에서 충돌한다.

| 되돌린 뒤 | 같아진 커밋 | 시험 |
|---|---|---|
| #36 | `8d94fd0` | 3385 |
| #35 | `fc7c062` | 3324 |
| #33 | `d1c2c1b` | 3319 |
| F7 | `fca5dae` | 2997 |

2026-10-22에 `c45490e`(#41 병합 뒤 `main`, `v0.14.6`)에서 #41 → #40 → #39 순서로 `git revert -m 1 <병합 커밋>`을 이어서 실행했다. 세 번 모두 충돌이 없었고, 매번 `src`·`tests`·`functions`가 그 PR 바로 전 커밋과 같았으며, typecheck와 시험이 통과했다. #39 뒤는 #38(시험만)을 지나 `c795029`에서 확인한 순서와 같다.

| 되돌린 뒤 | 같아진 커밋 | 시험 |
|---|---|---|
| #41 | `b33442f` | 3497 |
| #40 | `83aae0b` | 3448 |
| #39 | `cd3359d` | 3444 |

2026-10-23에 `76887c1`(#43 병합 뒤 `main`, `v0.14.7`)에서 #43을 `git revert -m 1`로 되돌렸다. 충돌이 없었고 `src`·`tests`·`functions`가 바로 전 커밋(`9581602`)과 같았으며 typecheck와 시험이 통과했다(3530개). 그 뒤 순서는 위 `c45490e`에서 확인한 것과 같다.

2026-10-23에 `9985631`(#45 병합 뒤 `main`, `v0.14.8`)에서 #45를 `git revert -m 1`로 되돌렸다. 충돌이 없었고 `src`·`tests`·`functions`가 바로 전 커밋(`263269a`)과 같았으며 typecheck와 시험이 통과했다(3632개).

2026-10-24에 `9467aea`(#48 병합 뒤 `main`, `v0.15.0`)에서 #48을 `git revert -m 1`로 되돌렸다. 충돌이 없었고 `src`·`tests`·`functions`가 바로 전 커밋(`7b7d5aa`, #47 병합)과 같았으며 typecheck와 시험이 통과했다(3653개). #48은 #47이 고친 `src/components/icons.tsx`·`src/domain/library/ops.ts`를 다시 고쳤으므로 #47을 되돌리려면 #48부터 되돌린다.

2026-10-24에 `72c1e7b`(최신 `main`)에서 #48 → #47 순서로 `git revert -m 1 <병합 커밋>`을 이어서 실행했다. 두 번 모두 충돌이 없었고 `src`·`tests`·`functions`가 #47 바로 전 커밋(`f465947`, `v0.14.8` 문서 병합)과 같았으며 typecheck와 시험이 통과했다(3643개).

2026-10-24에 `edaa752`(#52 병합 뒤 `main`, `v0.16.0`)에서 #52를 `git revert -m 1`로 되돌렸다. 충돌이 없었고 `src`·`tests`·`functions`·`public`·`scripts`가 바로 전 커밋(`8b75dfe`)과 같았으며 typecheck와 시험이 통과했다(3955개). 그 뒤 #48 → #47 순서는 위 `72c1e7b`에서 확인한 것과 같다.

2026-10-27에 `cbe2d42`(#55 병합 뒤 `main`, `v0.17.0`)에서 #55를 `git revert -m 1`로 되돌렸다. 충돌이 없었고 `src`·`tests`·`functions`·`public`·`scripts`가 바로 전 커밋(`af62631`, #54 병합)과 같았으며 typecheck와 시험이 통과했다(4013개). `af62631`은 `edaa752`에서 문서만 더했으므로 그 뒤 #52 → #48 → #47 순서는 위에서 확인한 것과 같다. D1의 표와 자료는 코드 되돌리기로 지워지지 않는다.

2026-10-27에 `6144b70`(#57 병합 뒤 `main`, `v0.18.0`)에서 #57을 `git revert -m 1`로 되돌렸다. 충돌이 없었고 `src`·`tests`·`functions`·`public`·`scripts`가 바로 전 커밋(`0c48aea`, #56 병합)과 같았다. `v0.18.0`보다 옛 버전으로 되돌리면 설정의 `이 앱에 대해`와 `/third-party-notices.txt`가 사라지지만 데이터 걱정은 없다. `LICENSE`도 함께 사라지므로 라이선스만 남기려면 #57 전체가 아니라 앱 화면 파일만 되돌린다.

2026-10-27에 `808902c`(#59 병합 뒤 `main`, `v0.19.0`)에서 #59를 `git revert -m 1`로 되돌렸다. 충돌이 없었고 결과 트리가 바로 전 커밋(`586ffc9`, #58 병합)과 같았다. 이어서 #57을 되돌려도 충돌이 없었고(#59를 먼저 되돌리지 않아도 충돌 없음), #55는 #59를 먼저 되돌려야 위의 설계 문서 충돌(UD) 하나만 남는다(#59를 두고 되돌리면 `MeetingResults.tsx`·`share-link.ts`·`use-online-meeting.ts` 등 9개 파일이 충돌). `v0.19.0`보다 옛 버전으로 되돌리면 `카카오톡` 단추가 사라질 뿐 데이터 걱정은 없다. Pages의 `VITE_KAKAO_JS_KEY`는 남겨 두어도 옛 버전이 읽지 않는다.

2026-10-28에 `0c28592`(#62 병합 뒤 `main`, `v0.19.1`)에서 #62를 `git revert -m 1`로 되돌렸다. 충돌이 없었고 결과 트리가 바로 전 커밋(`aafa8a4`, #61 병합)과 같았다. 이어서 #59를 되돌려도 충돌이 없었다. #62를 두고 #59를 되돌리면 `src/lib/kakao-share/*`(UD)·`tests/e2e/fixtures.ts`·`share-link.spec.ts`·도움말 등 9개 파일이 충돌한다. `v0.19.0`으로만 되돌리면 Pages에 `VITE_KAKAO_JS_KEY`가 있는 운영에서 카카오톡 단추가 다시 `카카오톡을 불러오지 못했어요`로 꺼진다(데이터 걱정은 없다). 카카오톡을 아예 감추려면 키를 지우고 다시 배포한다.

2026-10-28에 `98956c2`(#67 병합 뒤 `main`, `v0.20.0`)에서 #67을 `git revert -m 1`로 되돌렸다. 충돌이 없었고 결과 트리가 바로 전 커밋(`d8fb072`, #66 병합)과 같았다. 이어서 #66(설계 문서만)을 되돌려도 충돌이 없었고 결과가 `fad26d5`(#65 병합)와 같았다. #67을 두고 되돌리면 #62는 도움말·`share-link.spec.ts`·`share-link-dialog.test.tsx` 등 5개 파일이, #57은 `SettingsPage.tsx`가 충돌한다. #67을 먼저 되돌리면 #62·#57·(#62 뒤) #59는 충돌이 없고, #55는 위의 설계 문서 충돌(UD) 하나만 남는다. #65는 혼자 되돌려도 충돌이 없고, #64는 #65를 두면 `ci.yml`·`docs/development.md`가 충돌한다(#65를 먼저 되돌리면 충돌 없음). `v0.20.0`보다 옛 버전으로 되돌리면 짧은 링크가 열리지 않을 뿐 보관함 데이터 걱정은 없다.

2026-10-29에 `58278d5`(#69 병합 뒤 `main`, `v0.20.1`)에서 #69를 `git revert -m 1`로 되돌렸다. 충돌이 없었고 결과 트리가 바로 전 커밋(`d450de1`, #68 병합)과 같았다. 이어서 #67을 되돌려도 충돌이 없었고 `src`·`tests`·`functions`가 #67 바로 전 커밋과 같았다. #69를 두고 되돌리면 #67은 `docs/development.md`·`tests/e2e/share-link.spec.ts`가, #65·#64는 `.github/workflows/ci.yml`·`docs/development.md`가, #62는 `src/lib/kakao-share/*`(UD)·도움말 등 8개 파일이, #59는 `kakao.ts`·`tests/e2e/fixtures.ts` 등 8개 파일이, #57은 `public/third-party-notices.txt`·`SettingsPage.tsx`가 충돌한다. #69 → #65 → #64, #69 → #67 → #62 → #59, #69 → #67 → #57 순서로는 모두 충돌이 없었고, 그 뒤 #55는 위의 설계 문서 충돌(UD) 하나만 남는다.

2026-10-29에 `dd2964d`(#72 병합 뒤 `main`, `v0.20.2`)에서 #72를 `git revert -m 1`로 되돌렸다. 충돌이 없었고 결과 트리가 바로 전 커밋(`4fe011e`, #71 병합)과 같았다. 이어서 #71을 되돌려도 충돌이 없었고 결과 트리가 `34eac32`(#70 병합)와 같았다. #72를 두고 #71을 되돌리면 `docs/development.md`·공통화 문서·`yarn.lock`이, #72·#71을 두고 #69를 되돌리면 `docs/development.md`·공통화 문서·`package.json`·`public/third-party-notices.txt`·`yarn.lock`이 충돌한다. #72 → #71 → #69 → #67 → #62 → #59, #72 → #71 → #69 → #65 → #64, #72 → #71 → #69 → #67 → #57 순서로는 모두 충돌이 없었다.

2026-10-30에 `56f8a5f`(#76 병합 뒤 `main`, `v0.24.0`)에서 #76 → #75 → #77 → #74 순서로 `git revert -m 1 <병합 커밋>`을 이어서 실행했다. 네 번 모두 충돌이 없었고 결과 트리가 차례로 `be341e9`(#75 병합)·`df7e4fe`(#77 병합)·`01b9930`(#74 병합)·`fb0fee5`(#73 병합)와 같았다. 이어서 #72 → #71 → #69도 충돌 없이 되돌려졌고 `docs/rollback.md`만 빼고 각 PR 바로 전 커밋(`4fe011e`·`34eac32`·`d450de1`)과 같았다. `56f8a5f`에서 순서를 건너뛰면 #75는 18개 파일(그중 8개는 UD)이, #77은 `package.json`·`src/server/meet/schema-sql.ts`·`tests/unit/server/meet-db.test.ts`가, #74는 41개 파일(그중 20개는 UD)이, #72는 `docs/development.md`가 충돌한다. D1의 표와 자료는 코드 되돌리기로 지워지지 않는다(아래 「서버 로드맵 2A·2B·3·4 되돌리기」).

2026-10-30에 `82ab305`(#79 병합 뒤 `main`, `v0.24.1`)에서 #79를 `git revert -m 1`로 되돌렸다. 충돌이 없었고 결과 트리가 바로 전 커밋(`4ee8f6c`, #78 병합)과 같았다. 이어서 #76 → #75 → #77 → #74 → #72 → #71 → #69 → #67도 충돌 없이 되돌려졌고 매번 `src`·`tests`·`functions`가 그 PR 바로 전 커밋과 같았다. #79를 두고 #76 → #75 다음에 #77을 되돌리면 `src/server/trip-collab/handlers.ts`·`tests/unit/server/trip-collab-handlers.test.ts`(UD)와 `tests/unit/server/trip-live-handlers.test.ts`가 충돌한다.

특정 버전의 코드를 그대로 보려면 `git switch --detach v0.4.0`.

## D3 묶음별로 되돌리기 (다듬기 3: 디자인 QA·접근성)

`feat/design-qa`는 병합 커밋(Create a merge commit)으로 `main`에 들어가므로 아래 커밋 해시가 그대로 남는다(squash로 병합하면 해시가 바뀐다 — 그 경우 이 표는 쓸 수 없고 PR 전체를 되돌린다). 묶음 하나를 빼려면 그 묶음의 커밋을 **새것부터** `git revert`한다. 묶음끼리 기대지 않게 나눠 두었다.

| 묶음 | 커밋 (오래된 것 → 새 것) | 바꾸는 것 |
|---|---|---|
| T1 구조·이름 | `4d5da97` `479a3a0` `65cd5ba` `ed6fb04` | 화면별 `h1`·탭 제목·알림 영역 이름, 장소 상세 제목 구조(`h1`/`h2`), 추가 칸이 상세 자리를 차지해도 남는 `h1`, 여행 계획의 후보 칸이 그려지지 않을 때(중간 폭 접힘·휴대폰 시트 접힘·Day 탭) 남는 숨은 여행 제목 `h1`(`TripTitleHeading`) |
| T2 키보드·포커스 | `2ae21e5` `d4d7ae4` `2a95b36` `ea9a084` `97a29ac` | `<main id="main">`·본문 바로가기, 포커스 표시를 테마 하나로(`src/theme/focus-ring.ts`), 추가 칸 포커스 이동·`Esc` 닫기·복귀(＋로 연 `공유 파일 가져오기` 포함), 스위치·합치기 행의 안쪽 바깥선 |
| T3 대비 | `902f282` `7b2adcb` `22ab6b1` `01972f3` | 여섯 테마의 글자·강조색·입력칸 테두리 대비(`--tm-border-strong`), 칩 개수 글자, MUI 입력칸 안내 글자 |
| T4 입력칸 | `c9c34b9` `2d680b0` `d1b9d50` | `fieldSx` 하나로 통일, MUI 입력칸 테두리·포커스, 오류·비활성 상태의 호버, 검색칸 포커스 |
| T5 배치·터치 | `30719b9` `1fc25c1` | 휴대폰 공유 고르기 시트 높이, 좁은 폭 후보 칸 접기와 접고 펼친 뒤 포커스, 대화상자 제목 굵기, 끌기 손잡이 44px |

```bash
git switch main && git pull
git switch -c revert/d3-t3
git revert --no-edit 01972f3 22ab6b1 7b2adcb 902f282   # 새것부터. 충돌하면 아래를 보고 풀고 `git revert --continue`
yarn typecheck && yarn test
```

- **충돌**: 되돌리는 묶음이 다른 묶음과 같은 줄 가까이를 건드린 곳은 텍스트 충돌이 난다. 그 줄만 풀고(양쪽의 상관없는 줄은 모두 남긴다) 넘어간다. 임시 브랜치에서 한 묶음씩 되돌려 확인한 곳은 다음뿐이다. 나머지는 충돌 없이 되돌려진다.

  | 되돌리는 묶음 | 충돌 파일 | 푸는 방법 |
  |---|---|---|
  | T1 | `src/sections/place/EditableText.tsx` | 가져오기 줄과 입력칸 `sx`는 T4의 `fieldSx` 쪽을 남기고, `ReactNode`·`/>,`처럼 T1이 더한 부분만 뺀다 |
  | T2 | `src/theme/create-app-theme.ts` (두 군데) | 가져오기 줄은 T4의 `FIELD_BORDER_COLOR`만 남기고 `focus-ring` 줄을 뺀다. 컴포넌트 규칙에서는 T3의 `::placeholder`·`Mui-selected` 줄만 남기고 `:focus-visible`·`MuiButtonBase`·`FOCUS_RING*` 줄을 뺀다 |
  | T3 | `tests/unit/theme/create-app-theme.test.ts` | T4·T5의 시험(TextField 테두리·대화상자 제목)은 남기고 T3의 시험(안내 글자·고른 탭)만 뺀다 |
  | T4 | `tests/unit/theme/create-app-theme.test.ts` | T5의 대화상자 제목 시험은 남기고 T4의 TextField 테두리 시험만 뺀다 |
  | T5 | `src/sections/trips/planner/TripPlannerPage.tsx`, `src/sections/trips/planner/PlannerSheet.tsx` (파일마다 한 군데) | `30719b9`를 되돌릴 때 난다. T1의 `TripTitleHeading` 줄(주석 한 줄과 `<TripTitleHeading … />`)이 있는 HEAD 쪽을 남긴다(맞은편은 비어 있다). 파일 전체를 `--ours`로 고르면 같은 파일의 다른 되돌림까지 사라지므로 표시된 곳만 푼다 |

- 위 방법으로 풀면 묶음마다 `yarn typecheck`와 `yarn test`가 통과한다(2026-10-15 `ed6fb04` 위의 임시 작업 폴더에서 T1~T5를 하나씩 되돌려 확인). T5만 되돌려도 여행 계획은 후보 칸을 접었을 때·휴대폰 시트가 접혔거나 Day 탭일 때 `h1`이 하나 남는다.
- T1을 되돌리면(T5는 남김) `ed6fb04`를 되돌리면서 T5에 있던 원래의 숨은 제목(`CandidatePanel`의 `HiddenTripTitle`)이 돌아온다. T5의 시험(`planner-layout.test.tsx`)이 그 제목을 보므로 그대로 둔다.
- 공유 HTML 파일의 보기 화면(`src/share-viewer/`)은 앱 테마 밖이라 자기 포커스 표시를 따로 가진다. T2를 되돌려도 영향이 없고, 보기 화면의 모양은 바뀌지 않는다.
- 되돌린 묶음의 변경은 화면에만 영향이 있다. 저장 형식(`tripmap:library:v2` 등)과 공유 형식은 D3에서 바뀌지 않았으므로 데이터는 그대로 읽힌다.

## F1 작업별로 되돌리기 (전체 백업·복원)

`feat/backup-restore`는 병합 커밋으로 들어갔으므로 작업(Task) 단위로 되돌릴 수 있다. 뒤 작업이 앞 작업에 기대므로 **새 작업부터** 되돌린다. Task 6(손상 화면)과 Task 7(알림 띠)은 서로 기대지 않아 따로 되돌려도 된다. 마지막 묶음(최종 리뷰 반영)은 여러 작업에 걸쳐 있으니 앞 작업을 되돌리기 전에 먼저 되돌린다.

| 묶음 | 커밋 (오래된 것 → 새 것) | 바꾸는 것 |
|---|---|---|
| Task 1 백업 형식 | `6ec25dc` `4a3b345` | 파일 만들기·읽기, 수 세기 |
| Task 2 저장소 | `c19a7e4` `d1222a9` | 통째로 바꾸기, 되살리기 전 사본 |
| Task 3 기록·알림 조건 | `08ead9b` | `tripmap:backup:v1`, 7일 알림 조건, 저장 보호 요청 |
| Task 4 설정 칸 | `009bd56` | 설정 › 백업, 받기·공유 |
| Task 5 되살리기 | `485f0d0` | 되살리기 대화상자, 되돌리기, 사본 줄 |
| Task 6 손상 화면 | `df0324c` | 손상 화면의 `백업 파일로 되살리기`·`지금 원문 받기` |
| Task 7 알림 띠 | `0700b2d` `f948a95` | 보관함·지도의 백업 알림 띠 |
| Task 8 E2E·문서 | `84c72d8` | E2E, README, `perf-budget.json` |
| 최종 리뷰 반영 | `ffa0281` `4abc191` `5f3a769` `16f6747` `2b61a58` `319b29b` | 되돌리기 원문 보존, 공유 즉시 열기, N일 전 계산, 띠 계산 줄이기, 손상 화면 알림·포커스, 바꾼 뒤 실패 처리 |

```bash
git switch main && git pull
git switch -c revert/f1-reminder
git revert --no-edit 16f6747 f948a95 0700b2d   # 예: 알림 띠만 빼기(띠를 건드린 최종 수정 먼저)
# 0700b2d에서 tests/unit/sections/shell/backup-reminder.test.tsx가 충돌한다(5f3a769가 그 파일에 날짜 시험을 더했다).
# 띠를 통째로 빼는 것이므로 그 시험 파일도 지운다.
git rm tests/unit/sections/shell/backup-reminder.test.tsx && git revert --continue
yarn typecheck && yarn test
```

- 위 예시는 2026-10-16 `main`(`9711e53`) 위 임시 작업 폴더에서 확인했다(typecheck 통과, 단위 시험 2261개 통과). 띠를 빼도 `5f3a769`의 날짜 계산(`calendarDaysAgo`)은 설정 칸이 계속 쓴다.

- 되살리기 전 사본(`tripmap:library:v2:before-restore`)은 기기에 남아 있어도 되돌린 버전이 읽지 않는다. 지우려면 개발자 도구에서 그 키를 지운다.

## F2·F3 작업별로 되돌리기

두 PR 모두 병합 커밋으로 들어가 커밋 해시가 그대로 남는다. 뒤 작업이 앞 작업에 기대므로 **새 것부터** 되돌린다. 작업 하나만 빼는 일은 확인하지 않았으므로, 보통은 PR 전체를 되돌린다(`git revert -m 1 1732bdb`, `git revert -m 1 7d81384` — F3를 먼저).

| 묶음 | 커밋 (오래된 것 → 새 것) | 바꾸는 것 |
|---|---|---|
| F2 Task 1 형식·연산 | `13bab86` | `visitedOn`·`review` 필드, 편집 연산 |
| F2 Task 2 조건 | `8bf0b37` | 방문 필터, 다녀온 날순 함수, 평 검색 |
| F2 Task 3 상세 | `315a72b` | 장소 상세의 다녀옴·한 줄 평 |
| F2 Task 4 표시 | `4f017b4` | 목록·카드·지도 핀의 다녀옴 표시 |
| F2 Task 5 칩·정렬 | `0100d46` | 방문 칩, 다녀온 날순 메뉴 |
| F2 Task 6 일괄 | `99e083c` `38ca65e` | 일괄 다녀옴 표시·지우기와 되돌리기 보호 |
| F2 Task 7 시험 | `df082f4` `51ae646` `bf1207f` | 시험 시간대 고정, E2E, 예산 측정값 |
| F2 최종 리뷰 반영 | `9c7ad1b` `20273e4` `0569d3d` `7dc9b2c` `1cc0998` `9b97286` `bb676d1` `5a8b7af` | 날짜 칸 입력·포커스, 필터 지우기, 지도 계산, 복원 뒤 필터 풀기(F1 버그) |
| F3 Task 1~3 형식·연산 | `8f2c83a` `6b5cc47` `7ccaf1a` | `folders`, 연결 기록·끊기, 다시 가져오기 계획·적용 |
| F3 Task 4 서버 | `a7afab3` | 폴더 조회 `fresh=1` |
| F3 Task 5 첫 가져오기 | `9f9a87e` | 첫 가져오기가 연결을 남김 |
| F3 Task 6 화면 | `0088912` | 다시 가져오기 화면 |
| F3 Task 7 라벨 관리 | `94978c0` `2979231` | 라벨 고치기의 `네이버 폴더` 구역 |
| F3 Task 8 E2E | `8cc8a2b` | E2E |
| F3 리뷰 반영 | `7c1b280` `336bd1c` `66acbe2` `c5bdd8a` `354976f` `180af44` | 백업 알림 시각, 폴더 전체 보기 기본 라벨, 머리글 라벨 이름, 끊기 늦은 결과, 같은 폴더 다시 누르기 |

- F3의 화면 작업만 빼려면 `180af44 354976f c5bdd8a 66acbe2 336bd1c 2979231 94978c0 0088912`를 차례로 되돌린다(새 것부터). 2026-10-16에 Task 6·7(`2979231 94978c0 0088912`)만 되돌려 typecheck와 시험 2400개가 통과하는 것을 확인했다. 그러면 연결 기록만 남고 앱은 이전처럼 동작한다. 리뷰 반영 커밋을 함께 되돌린 경우는 확인하지 않았다.
- F3를 되돌려도 보관함에 남은 `folders`는 F2·F1 버전이 떼어 내고 읽는다(위 버전 표의 ⚠️와 같다).

## F4 작업별로 되돌리기 (내 근처 저장 장소)

병합 커밋 `553310e`로 들어갔다. 저장 형식을 바꾸지 않았으므로 되돌려도 데이터는 그대로다(위치와 `가까운 순`은 메모리에만 있다). 보통은 PR 전체를 되돌린다(`git revert -m 1 553310e`). **F5가 F4를 쓰므로 최신 `main`에서는 F5(`c908b2c`)를 먼저 되돌린다**(위 2절 표). F5가 남은 채로 F4만 되돌리면 `src/services/geolocation.ts`·`MyLocationButton.tsx` 등에서 충돌한다.

- 2026-10-16, F5 병합 전 `main`(`553310e`)에서 F4만 되돌려 typecheck와 시험 2437개가 통과했다.
- 2026-10-17, `c908b2c`에서 F5 → F4 순서로 되돌려 `src`·`tests`가 `7d81384`와 같아지고 시험 2437개가 통과하는 것을 확인했다(2절).
- 작업 하나만 빼는 일은 확인하지 않았다. 뒤 작업이 앞 작업에 기대므로 뺄 때는 새 것부터 되돌린다.

| 묶음 | 커밋 (오래된 것 → 새 것) | 바꾸는 것 |
|---|---|---|
| F4 Task 1 위치 서비스 | `4b5fd74` | `Geolocation`(current·watch), `GeolocationError` |
| F4 Task 2 지도 | `d10f669` | 어댑터 `setMyLocation`(점·정확도 원), `MapView` 단추 기둥, `내 위치 보기` 단추 |
| F4 Task 3 계산·상태 | `6853597` | 거리순·반경 계산, 메모리 내 위치 상태 |
| F4 Task 4 보관함 | `d7e57a9` `c45f5e6` | `가까운 순`, 근처 줄·반경 칩, 행의 직선거리, 빈 상태 |
| F4 Task 5 지도 화면 | `efae0ba` | `내 위치 보기`, 반경 맞추기, 좁은 화면 근처 칩 |
| F4 Task 6 끄는 흐름 | `41ab30e` | 가져오기·되살리기·`보관함에서 보기` 뒤 근처 모드 끄기 |
| F4 Task 7 E2E | `c6fe04b` | E2E |
| F4 리뷰 반영 | `a0d9dab` `4a052f8` `b9dacb4` `090e3d3` `cb51dcc` `70e7983` | 열린 장소와 반경 맞추기, 같은 위치로 다시 맞추기, 실패 뒤 기준 시각, 포커스, 반경 상자만 맞추기 |

- #30(`bf78a5d`, `v0.13.2`)이 F4의 근처 줄과 `필터 지우기`를 바꿨다(F4 스펙 §13 결정 11 (다)). #30만 되돌리면 숨은 수 안내가 없어지고 `필터 지우기`는 다시 근처 모드를 남긴다.
- 화면만 빼고 싶다면 Task 6·5·4와 그 리뷰 반영 커밋을 되돌린다. Task 1·2(위치 서비스·지도 어댑터의 내 위치·`MyLocationButton`)는 F5가 쓰므로 F5를 남긴 채로는 뺄 수 없다. Task 3의 `formatDistanceM`도 F5가 쓴다.

## F5 작업별로 되돌리기 (여행 당일 모드)

병합 커밋 `c908b2c`로 들어갔다. 저장 형식을 바꾸지 않았으므로 되돌려도 데이터는 그대로다(다녀옴 체크는 F2의 `visitedOn`에 쓰이고, 되돌린 뒤에도 남는다). 보통은 PR 전체를 되돌린다(`git revert -m 1 c908b2c`). 2026-10-17에 임시 작업 폴더에서 이렇게 되돌려 typecheck와 시험 2537개(F4 직후와 같은 수)가 통과하는 것을 확인했다. 뒤 작업이 앞 작업에 기대므로 작업 하나를 뺄 때는 새 것부터 되돌린다.

| 묶음 | 커밋 (오래된 것 → 새 것) | 바꾸는 것 |
|---|---|---|
| F5 Task 1 규칙 | `825a05e` `75628e5` | 오늘 Day(04:00 경계)·다음 장소·지금 출발하면 예상, `addDays`를 `src/schema/trip.ts`로 |
| F5 Task 2 화면 | `b87ce2e` | `/trips/:id/today` 화면 뼈대(나눠 받는 조각) |
| F5 Task 3 체크 | `80e8485` `0748b7a` | 다녀옴 체크·풀기·되돌리기, 체크 뒤 포커스 |
| F5 Task 4 늦음·길찾기 | `94dbcde` | 늦어짐 표시, 다음 장소 길찾기 |
| F5 Task 5 내 위치 | `292d047` `c7d139f` | 지도 점·지금 여기·직선거리·길찾기 출발점 |
| F5 Task 6 켜 두기 | `1901868` | 화면 켜 두기, 오프라인 띠 |
| F5 Task 7 진입·E2E | `5e8f7d0` | 여행 목록·계획 화면의 `오늘 일정`, E2E |
| F5 최종 리뷰 반영 | `f82444b` `8e088e2` `54c6165` `c29cce2` `7c007ab` `84f1587` `b591d0d` | 위치 시각 정규화(F4 서비스), 여행 목록 04:00 묶음, 고정 시각 행, 사라지는 버튼 뒤 포커스, 공용 `TripNotFound`, 잠금 다시 요청 |
| F5 PR 리뷰 반영 | `68ef6b3` `aa7ee2c` | 토스트 되돌리기 뒤 포커스 |

- 2026-10-17에 임시 작업 폴더에서 PR 리뷰 반영 전 17개 커밋(`b591d0d`까지)을 새 것부터 하나씩 되돌렸다. 충돌이 없었고, 작업 경계마다 typecheck와 시험이 통과했으며, 끝 상태는 `825a05e^`와 같았다.
- Task 6·7만 따로 빼려면 그 작업을 건드린 최종 리뷰 반영 커밋을 먼저 되돌려야 한다(새 것부터).
  - Task 7: `8e088e2` `7c007ab` `f82444b`를 되돌린 뒤 `5e8f7d0`. 시험 2720개가 통과했다.
  - Task 6: `84f1587` `7c007ab` `c29cce2`를 되돌린 뒤 `1901868`. 시험 2719개가 통과했다.
  - PR 리뷰 반영(`aa7ee2c` `68ef6b3`)도 같은 파일(`TripTodayPage.tsx`)을 건드리므로, Task 6을 뺄 때는 이 둘도 먼저 되돌린다. 이 조합은 확인하지 않았다.
- `f82444b`는 F4의 위치 서비스(`src/services/geolocation.ts`)를 고친 것이다. F5를 되돌려도 F4 화면은 동작하지만, 이 커밋까지 되돌리면 WebKit에서 마이크로초로 오는 위치 시각을 다시 그대로 쓴다. 이 커밋만 남기려면 위 표에서 이 커밋을 빼고 되돌린다.

## F6 작업별로 되돌리기 (영업시간·휴무 경고)

병합 커밋 `279cdcf`로 들어갔다. 보관함 형식은 그대로이고, 되돌려도 기기에 남는 `tripmap:hours:v1`은 옛 버전이 읽지도 지우지도 않는다(지워도 되는 캐시). 보통은 PR 전체를 되돌린다(`git revert -m 1 279cdcf`). 최신 `main`에서는 #27(`0643a95`)을 먼저 되돌린다(2절).

| 묶음 | 커밋 (오래된 것 → 새 것) | 바꾸는 것 |
|---|---|---|
| F6 Task 1 서버 읽기 | `34ca3aa` | 네이버 장소 홈에서 `newBusinessHours` 떼어 정리, 이동 2번 검사 |
| F6 Task 2 서버 함수 | `da654b6` `37cef59` | `/api/hours`(엣지 캐시 1일, `fresh=1`) |
| F6 Task 3 판정 | `9031699` | 도착 시각과 영업시간 판정·문구(자정 넘김·04:00 경계·고정 시각) |
| F6 Task 4 서비스 | `6fe504b` `d9d6637` | `HoursLookup`, 기기 캐시 `tripmap:hours:v1`, 용량 초과 때 캐시 지우기 |
| F6 Task 5 행 | `d34f9d3` | 상태 atom·요청 훅, 시간표 행 경고 |
| F6 Task 6 카드 | `0895dbf` | 지도 카드 `영업시간` 칸, `다시 확인` |
| F6 Task 7 E2E | `305c57c` | E2E |
| F6 최종 리뷰 반영 | `e5cfc34` `d3f6ea2` `c0051bd` `d786cea` `e0a73e9` | `null` 판별, 임시 휴무 연도·숫자 경계, 전날 밤 구간, 포커스·알림, 장소별 구독 |
| F6 PR 리뷰 반영 | `682254f` `9bd8f30` `c2ad345` `096c7db` `eb3277c` | 라스트오더 구간, 전날 임시 휴무, 날짜 빈칸, 본문 시간 초과 취소, 7일 지난 정보 다시 묻기 |

- 2026-10-18, PR 리뷰 반영 전(`d786cea`)에 임시 작업 폴더에서 Task 7 → 1을 새 것부터 하나씩 되돌렸다(리뷰 반영 커밋은 그 작업과 함께). 충돌이 없었고 매번 typecheck와 시험이 통과했으며 끝 상태는 `9f6856b`와 같았다(Task 7 뒤 2956개 → Task 1 뒤 2747개).
- 그 뒤 커밋(`e0a73e9`과 PR 리뷰 반영 다섯 개)은 고친 파일의 작업과 함께 되돌린다: 판정(`hours.ts`)은 Task 3, 서비스는 Task 4, 요청 훅은 Task 5. 이 조합은 따로 확인하지 않았다.
- #27은 F6과 같은 방식(Effect `AbortSignal`로 본문까지 끊기)을 `RouteLookup`에 옮긴 것이다. #27만 되돌리면 경로 조회가 예전처럼 본문을 받는 중 시간 초과에 전송을 끊지 않는다.

## F7 작업별로 되돌리기 (여행 일정 공유)

병합 커밋 `c3bc22a`로 들어갔다. 보관함 형식은 그대로이고, 가져온 여행·장소도 지금 스키마 그대로라 되돌려도 데이터는 그대로다. 보통은 PR 전체를 되돌린다(`git revert -m 1 c3bc22a`). 지도 페이지 파일(`src/share-map/**`, `src/share-protocol.ts`)이 바뀌므로 되돌리는 PR을 병합하면 워크플로가 옛 지도 페이지를 다시 올린다(3절). 뒤 작업이 앞 작업에 기대므로 작업 하나를 뺄 때는 새 것부터 되돌린다.

| 묶음 | 커밋 (오래된 것 → 새 것) | 바꾸는 것 |
|---|---|---|
| F7 Task 1 순수 모듈 | `5c6882f` | `daysBetween`·`addDays`를 `src/lib/calendar.ts`로, `use-day-plan.ts`의 구간 함수 export |
| F7 Task 2 형식 | `1786a84` `060768a` | 공유 형식 v2 타입·`ShareDocV2Schema`, 관계 검사 `checkShareTrip`·`dayPoints` |
| F7 Task 3 읽기 | `4e98970` | `read-share`의 v2 읽기, `newer` 오류 |
| F7 Task 4 문서 만들기 | `e90c932` | `buildTripShareDoc`·`thinPaths`, `renderTripShareHtml`·`shareHtmlBytes` |
| F7 Task 5 지도 페이지 | `d9d34e6` | 지도 규약 v2 `draw`(봉투 `v: 2`), `ready.maxV: 2`, Day 색 핀·경로선 |
| F7 Task 6 보기 화면 데이터 | `3d8af1e` | v2 손 검사, `dayView`(앱 `computeSchedule`)·`tripPins`, 경로선 뺀 해시 |
| F7 Task 7 보기 화면 일정 모드 | `48b9f63` | Day 탭·시간표·후보 탭·`길찾기`, 옛 지도 페이지(`maxV < 2`)에 v1 `init`으로 대체 |
| F7 Task 8 일정 공유 창 | `0dd7133` | `ShareFileDialog`·`LazyDialogHost`로 나누기, 크기 검사(v1 `내보내기`도), `useTripLegs`, `일정 공유` 버튼·메뉴 |
| F7 Task 9 가져오기 연산 | `05b985d` | `importSharePlaces`(id 대응표), `importSharedTrip`·`sameTripExists` |
| F7 Task 10 미리보기 | `1e32207` | 미리보기 여행 칸·`여행 계획도 가져오기` |
| F7 Task 11 E2E | `8f0a7b4` | `trip-share.spec.ts`, 공유 E2E 도우미를 `fixtures.ts`로 |
| F7 최종 리뷰 반영 | `1b1bab8` `2a361ae` `b61535b` | 창의 연결 실패 구간 다시 묻기(계획 화면과 같은 `requestLegs`·`useOnlineRetry`), 누른 행 강조·`highlight` 순서·`dayStartId`, 경로선 솎기 한도 |
| F7 PR 리뷰 반영 | `6042832` `bfde7b4` `7767387` `73b8dc5` | 1,000곳 넘는 일정 공유 막기, 화면 폭이 바뀌면 길찾기 링크 다시 정하기(옛 브라우저 보호), `dayEndId` |

- 작업 하나만 빼는 일은 확인하지 않았다. 리뷰 반영 커밋은 고친 파일의 작업과 함께 되돌린다: 창(`use-trip-legs.ts`·`ShareFileDialog`·`TripShareDialog`)은 Task 8, 보기 화면(`render-trip.ts`·`main.ts`)은 Task 7, `trip-view.ts`는 Task 6, `check-share-trip.ts`는 Task 2, `thinPaths`는 Task 4. `1b1bab8`은 계획 화면의 `use-day-plan.ts`도 고쳤으므로(동작은 그대로) Task 1과 함께 본다.
- 지도 페이지만 빼려면 3절처럼 `gh-pages`의 배포 커밋(`c7f0924 deploy: c3bc22a`)을 되돌린다. 그러면 v2 파일의 지도에는 장소 마커만 보인다(버전 표 아래 설명).

## 서버 로드맵 2A·2B·3·4 되돌리기 (갱신 공유·함께 편집·동기화·서버 백업)

네 PR 모두 병합 커밋으로 들어갔다: 2A #74 `01b9930`(`v0.21.0`), 2B #77 `df7e4fe`(`v0.22.0`), 3 #75 `be341e9`(`v0.23.0`), 4 #76 `56f8a5f`(`v0.24.0`). 보관함(`tripmap:library:v2`, schema 2)·백업 파일·공유 문서(`ShareDoc` v1·v2) 형식은 넷 모두 바꾸지 않았으므로 옛 버전도 보관함을 그대로 읽는다. 바뀐 것은 서버 함수·D1 표·기기별 새 키다. 토큰과 동기화 정보는 보관함과 백업 파일에 들어가지 않는다.

아래의 원격 D1 쓰기 명령(`UPDATE`·`DELETE`)은 사용자가 직접 실행한다. 미리보기 D1은 `landmark` 대신 `landmark-preview`다.

### 되돌리는 순서

- **4는 3 위에, 2B는 2A 위에 쌓였다.** 코드는 4 → 3 → 2B → 2A(#76 → #75 → #77 → #74, 병합의 역순)로 되돌린다. 3을 되돌리려면 4를, 2A를 되돌리려면 2B를 먼저 되돌린다. 3·4와 2A·2B는 공용 파일(`src/server/meet/schema-sql.ts`의 `SCHEMA_VERSION`, `package.json`, 설정 화면, 라우트, 문서)을 함께 고쳐 앞 PR만 되돌리면 충돌한다(2절 표와 실험 기록). `v0.24.1` 고침(#79)이 2A·2B의 서버 함수(`src/server/trip-live/handlers.ts`·`src/server/trip-collab/handlers.ts`)와 시험을 다시 고쳤으므로, 2B·2A를 되돌릴 때는 #79를 맨 먼저 되돌린다(#79 → #76 → #75 → #77 → #74).
- 배포만 되돌리기(1절)는 어느 버전으로든 바로 된다. 다만 2B보다 옛 버전(`v0.21.0`)으로 되돌리면 첫 단계로 아래 「2B → 2A」의 1번 SQL을 실행해야 갱신 링크의 보기 화면이 열린다.
- 서버 쪽 장애만 피하려면 되돌리기 대신 아래 기능 스위치를 먼저 쓴다.

### 기능 스위치로 끄기

Cloudflare 대시보드 › Workers & Pages › `landmark` › Settings › Variables and Secrets에서 Production·Preview에 값을 `off`로 넣고 다시 배포한다. 변수가 없거나 `off`가 아니면 켜진 상태이므로 평소에는 넣지 않는다.

| 변수 | 막는 것(`503 off`) | 계속 되는 것 |
|---|---|---|
| `TRIP_SHARE_LIVE=off` (2A) | 갱신 링크 만들기·올리기. 2B의 공동본 올리기·초대·수락도 막는다 | 이미 보낸 링크 읽기(마지막 공개본), 서버에서 지우기, 링크 다시 만들기 |
| `TRIP_COLLAB=off` (2B) | 초대 만들기·수락, 공동본 올리기(2A `PUT`의 v2 문서 포함), 진행 올리기 | `state` 읽기, 기기 목록·거두기, 초대 취소, 그만두기, 2A 보기 링크. 각 기기가 고친 것은 기기에 남고 다시 켜면 병합한다 |
| `LIBRARY_SYNC=off` (3) | 세션 만들기·`/v1/me`·받기·올리기, 서버 백업 쓰기 | 이 기기 세션 철회·기기 목록·다른 기기 철회·`서버 자료 모두 지우기`, 서버 백업 읽기·지우기. 앱은 `unavailable`로 보이고 이 기기 저장은 계속된다 |
| `AUTO_BACKUP=off` (4) | `POST /v1/backup`(지금 만들기·자동 백업) | 서버 백업 읽기·되살리기·지우기. 자동 백업은 `off`를 기록하고 하루 뒤 다시 본다. 동기화·폴더 알림은 영향 없다 |

네이버 폴더 변경 알림은 서버 기능이 아니라 각 기기의 설정 › 가져오기 스위치로 끈다(`/api/naver-folder`는 그대로).

### D1 스키마 버전

| 버전 | `SCHEMA_VERSION` | 더한 표 |
|---|---|---|
| `v0.20.0`~`v0.20.2` | 2 | `share_links` |
| `v0.21.0` (2A) | 3 | `trip_shares`·`trip_share_tokens`(색인 `trip_shares_expires`·`trip_share_tokens_share`) |
| `v0.22.0` (2B) | 4 | `trip_collab_devices`(고유 색인 `trip_collab_devices_token`)·`trip_collab_meta`·`trip_progress`. 초대는 2A의 `trip_share_tokens`에 `kind = 'invite'` 행 |
| `v0.23.0` (3) | 5 | `users`·`sessions`·`library_state`·`library_items`·`library_devices` |
| `v0.24.0` (4) | 6 | `library_backups`·`library_backup_parts` |

- 표는 모두 `IF NOT EXISTS`로만 더했고 `ALTER TABLE`은 없다. 배포 뒤 첫 요청에서 `ensureSchema`(`src/server/meet/db.ts`)가 만든다.
- `ensureSchema`는 `schema_meta`의 버전이 코드의 `SCHEMA_VERSION` 이상이면 아무것도 하지 않는다. 그래서 옛 코드로 되돌려도 `schema_meta`는 가장 높은 버전(지금은 6)으로 남고 표와 자료도 지워지지 않는다. 약속 온라인 집계·짧은 링크는 그대로 동작하고, 다시 새 버전으로 오면 남은 표를 이어 쓴다.
- 확인(읽기 전용): `npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta"`.

### 4 → 3 (`v0.23.0`으로)

- 설정의 서버 백업 구역·자동 백업·네이버 폴더 변경 알림이 사라진다. 보관함과 동기화는 그대로다.
- D1의 `library_backups`·`library_backup_parts`는 남고 읽히지 않는다. 다시 4로 오면 그대로 이어 쓴다. 기기 키 `tripmap:server-backup:v1`·`tripmap:folder-watch:v1`도 남았다가 다시 쓰인다.
- **되돌린 사이에 `서버 자료 모두 지우기`를 한 계정의 백업 행은 3단계 코드가 지우지 않는다.** 이 경우에만 남은 백업 행을 정리한다.

  ```bash
  npx wrangler d1 execute landmark --remote --command "DELETE FROM library_backup_parts WHERE user_id NOT IN (SELECT id FROM users); DELETE FROM library_backups WHERE user_id NOT IN (SELECT id FROM users)"
  ```

### 3 → 2B (`v0.22.0`으로)

- 동기화가 멈추고(설정 › `동기화`가 사라짐) 각 기기 보관함은 그대로다. `/auth/callback`은 옛 앱에서 `페이지를 찾을 수 없어요`가 된다.
- D1의 `users`·`sessions`·`library_state`·`library_items`·`library_devices`는 지우지 않고 남는다. 새 버전으로 돌아오면 이어서 쓰고, 옛 버전에서 고친 내용도 항목 해시 비교로 다시 올라간다.
- 기기 키 `tripmap:sync:v1`·`tripmap:sync-base:v1`·`tripmap:sync-conflicts:v1`·`tripmap:sync-session:v1`은 옛 버전이 읽지도 지우지도 않는다.
- 서버에 올라간 계정·보관함 사본은 새 버전의 설정 › 동기화 › `서버 자료 모두 지우기`로 지운다(옛 버전에는 이 단추가 없다). 되돌린 동안 서버에서 직접 지우는 명령은 PR·설계서에 정해 두지 않았다.
- 로그인용 Pages 변수(`VITE_FIREBASE_*`·`ALLOWED_ACCOUNTS`·`ALLOWED_EMAILS`·`KAKAO_CLIENT_ID`·`NAVER_CLIENT_ID` 등)는 남겨 두어도 옛 버전 코드가 읽지 않는다.

### 2B → 2A (`v0.21.0`으로)

1. 되돌리면 먼저 v2가 된 갱신 공유 문서를 2A가 읽는 v1로 돌린다. 모양이 같아 `v`만 바꾸고, 2A 클라이언트가 다시 받도록 `rev`를 올린다.

   ```bash
   npx wrangler d1 execute landmark --remote --command "UPDATE trip_shares SET doc = json_set(doc, '$.v', 1), rev = rev + 1 WHERE json_extract(doc, '$.v') = 2"
   ```

   이것을 하지 않으면 소유자가 다시 올릴 때까지 2A 보기 화면이 `일정을 불러오지 못했어요`를 보인다. 같은 SQL을 시험(`tests/unit/server/trip-collab-rollback.test.ts`)이 `docs/development.md`와 2B 설계서에서 뽑아 SQLite로 실행해 확인한다.

2. 편집 기기의 연결된 여행은 보관함에 보통 여행으로 남는다. 초대 링크 `/trips/join/<id>`는 `페이지를 찾을 수 없어요`가 된다.
3. 소유자 기기의 2A 반영 훅은 낡은 revision 때문에 `409`를 받고 2A 알림(`이 기기 일정으로 바꾸기`·`반영 멈추기`)을 띄운다. 소유자 기기 여행에는 마지막으로 맞춘 공동 편집 내용이 들어 있다.
4. 기기 키 `tripmap:trip-collab:v1`·`tripmap:trip-collab-base:v1:<공유 id>`·`tripmap:trip-live-plan:v1`은 옛 버전이 읽지도 지우지도 않는다. 2A 기록 `tripmap:trip-live:v1`의 모양은 그대로라 2A 소유자 기록과 토큰은 유지된다.
5. 2B 표는 남는다. 2A 코드의 공유 지우기·만료 정리는 2B 표를 모르므로, 오래 되돌려 둘 때만 정리한다.

   ```bash
   npx wrangler d1 execute landmark --remote --command "DELETE FROM trip_collab_devices; DELETE FROM trip_collab_meta; DELETE FROM trip_progress; DELETE FROM trip_share_tokens WHERE kind = 'invite'"
   ```

6. 다시 2B로 올리면 남은 연결 기록이 다음 맞추기에서 서버 판을 받고 평소 규칙대로 병합한다. 5번 정리를 했으면 편집 기기는 `401`로 끝나 다시 초대해야 한다.

### 2A → `v0.20.2`

- 서버 함수 `/api/trip-live`가 사라져 갱신 링크가 열리지 않는다. 옛 보기 화면은 `#t=`를 몰라 「링크가 손상됐거나 너무 길어요…」를 보이고, 소유자 링크 `/trips/live/<id>`는 `페이지를 찾을 수 없어요`가 된다. 받은 사람이 이미 저장한 HTML 파일과 `Landmark에 담기`로 가져간 여행은 남는다.
- D1의 `trip_shares`·`trip_share_tokens`는 남고, 기기 키 `tripmap:trip-live:v1`은 옛 버전이 읽지도 지우지도 않는다. 새 버전으로 돌아오면 기한이 남은 공유가 이어서 열린다.
- 옛 코드에는 갱신 공유 만료 정리가 없다. 오래 되돌려 둘 때만 지운다.

  ```bash
  wrangler d1 execute landmark --remote --command "DELETE FROM trip_share_tokens WHERE share_id IN (SELECT id FROM trip_shares WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')); DELETE FROM trip_shares WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')"
  ```

## 3. 공유 지도 페이지 (`https://sch0718.github.io/landmark/`)

`.github/workflows/deploy-share-map.yml`이 `main`에 지도 관련 파일이 바뀐 커밋이 들어올 때만 `gh-pages` 브랜치로 배포한다(다른 브랜치·태그에서 수동 실행하면 배포 단계는 건너뛴다. `main`에서 수동 실행하면 최신 `main`을 다시 배포할 뿐이라 옛 버전으로 되돌리지는 못한다). 되돌리는 방법은 둘이다.

- **코드로**: 2번처럼 `main`에서 해당 변경을 되돌리는 PR을 병합한다. 지도 관련 파일이 바뀌므로 워크플로가 되돌린 코드를 다시 배포한다.
- **`gh-pages`를 직접**: `gh-pages`는 배포할 때마다 커밋이 하나씩 쌓인다. 되돌릴 배포 커밋을 찾아 되돌리는 커밋을 올린다.

  ```bash
  git fetch origin gh-pages
  git switch -C gh-pages origin/gh-pages   # 로컬 gh-pages가 뒤처져 있어도 원격 최신에서 시작
  git log --oneline   # 배포 커밋 찾기
  git revert <되돌릴 배포 커밋>
  git push origin gh-pages
  ```

  이 방법은 `main`에 그 변경이 남아 있으므로, 다음에 지도 관련 파일이 바뀌어 배포되면 다시 덮인다.

## 새 버전을 낼 때

- 기능·다듬기 PR이 `main`에 병합되면 그 병합 커밋에 위 표의 마지막 태그 다음 번호(`v0.N.0`)로 태그를 붙이고 위 표에 한 줄 더한다. 결함만 고치는 PR은 마지막 태그의 셋째 자리만 올린다(`v0.N.M` → `v0.N.(M+1)`).
- 저장 형식을 바꾸는 변경은 옛 버전이 새 데이터를 손상으로 볼 수 있으므로 표의 마지막 칸에 적고, 가능하면 옛 버전이 무시할 수 있는 방식(선택 필드)으로 바꾼다.
