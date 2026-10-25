# 랜드마크 검토 제안 — 서버·DB 도입

- 작성일: 2026-10-25
- 상태: 2차 검토 제안 (제외 원칙은 결정됨, 나머지는 사용자 검토 대기, 구현하지 않음)
- 대상: 공개 저장소 `sch0718/landmark`, 운영 `https://landmark.sch0718.dev`
- 기준: 사용자 지정 `main` `05d3eaf`·`v0.16.0`. 작업 디렉터리의 파일을 직접 확인했다.
- 관련 문서: `2026-10-23-meeting-place-design.md`, `2026-10-16-trip-share-design.md`, `2026-10-16-trip-day-mode-design.md`, `2026-10-16-backup-restore-design.md`, `docs/development.md`, `docs/rollback.md`.
- 범위: 선택지 조사와 설계 방향만 제안한다. 코드·설정·다른 문서·외부 계정을 바꾸지 않는다.

## 1. 결정 요약

### 이번 판(2차)에서 반영한 결정

- 같은 날 검토한 [가즈아 서버·DB 제안 PR #38](https://github.com/sch0718/gazua/pull/38)의 사용자 결정을 적용한다. **Supabase는 후보에서 제외한다(2026-10-25).**
- **결제 수단 등록이 필요한 서비스는 쓰지 않는다. 무료 하드캡을 우선한다.** R2·Access/Zero Trust·임의 수신자용 Cloudflare Email Service·Oracle 신규 가입·Fly.io 계속 운영은 제외한다. 결제 조건이 확인되지 않은 선택지는 도입 보류다.
- 백업은 개수·용량을 제한한 D1 스냅샷과 기존 수동 백업 파일을 사용한다. Google Drive 연동은 별도 동의를 받는 선택 기능으로만 검토한다.
- 가즈아와 **같은 Cloudflare 계정이면** 무료량을 공유한다. 같은 계정인지는 확인 필요이며, §7은 랜드마크에 절반을 배정한 예산으로 다시 판단한다.

**추천 1안은 기존 Cloudflare Pages + Pages Functions + D1이다.** 지금의 로컬 저장을 기본으로 두고, 함께 쓰기로 선택한 약속·여행과 동기화를 켠 보관함만 서버에 올린다. 개인과 친구 몇 명 규모라면 무료 한도 안에서 시작할 여지가 크다. 기존 배포 환경을 유지할 수 있고, SQLite 계열 데이터라 내보내기도 비교적 쉽다.

**대안 1안은 Firebase Spark + Firestore + Firebase Auth다.** 결제 등록 없이 인증·권한 규칙·실시간 리스너를 함께 쓸 수 있어 랜드마크에도 맞는다. 친구에게는 Firebase 익명 인증을 앱 내부에서 사용해 가입 화면 없이 초대를 받을 수 있게 설계한다. 다만 Firestore 문서 읽기 예산과 SDK·Security Rules 의존이 늘어 본안보다 우선하지 않는다. [Spark 조건](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [익명 인증](https://firebase.google.com/docs/auth/web/anonymous-auth) · 확인 2026-10-25.

| 결정 | 추천 | 이유 |
|---|---|---|
| 첫 기능 | 약속 서버 집계 | 친구가 좋아요를 누르면 주최자에게 자동으로 모인다. 답장 링크를 하나씩 열 필요가 없어져 효과가 바로 보인다 |
| 다음 기능 | 여행의 갱신되는 공유 → 함께 편집 | 짧은 링크 하나로 최신 일정을 보고, 보기/편집 권한을 나눈다 |
| 전체 보관함 | 그다음에 선택형 기기 동기화 | 유실·중복·충돌 범위가 가장 크다. 약속·여행에서 운영 경험을 먼저 얻는다 |
| 신원 | 소유자는 Google 로그인, 친구는 제한된 초대 권한 | 초기 연결은 **Firebase Auth Spark로 신원만 확인 + D1 자체 세션**. 결제 등록 불필요가 명시된 경로이며 메일 발송이 필요 없다. 직접 GIS 연결은 결제 조건 추가 확인 뒤 판단(§4) |
| 갱신 방식 | 처음은 열린 화면에서 10초 간격 조회, 이후 필요하면 WebSocket | D1만으로도 자동 집계는 된다. 즉시 갱신에는 별도 전달 계층이 필요하다 |
| 운영비 | 추가 사용료 월 0달러, 결제 등록·유료 플랜 연결 없음 | 무료 한도를 넘으면 서버 기능을 제한하고 로컬 사용·내보내기를 유지한다. 같은 계정의 가즈아 사용량도 함께 관측한다 |

무료는 무제한·운영 부담 없음이라는 뜻이 아니다. 도메인 갱신비 등 기존 비용은 별도다. 아래 무료 수치의 확인일은 모두 **2026-10-25**다. 비용 시나리오는 측정이 아닌 어림이다.

## 2. 지금의 구조와 한계 — 파일 확인 결과

### 2.1 확인한 근거

아래 경로와 줄 번호는 작성 시점 작업 디렉터리 기준이다.

| 항목 | 확인함 | 근거 |
|---|---|---|
| 프론트 | React `^19.3.0`, Vite `^8.3.2`, TypeScript `~6.0`, MUI `^7`, Jotai `^3.0.1`, Effect `4.0.2` | `package.json:41`, `package.json:52`, `package.json:90` |
| 배포 | Cloudflare Pages, `yarn build:ci`, 출력 `dist`. CI 빌드에는 검증·시험·번들 예산 검사가 들어 있다 | `package.json:31`, `docs/development.md:195`, `docs/development.md:201` |
| 서버 함수 | 장소·네이버 폴더·경로·검색·영업시간 조회와 Cache API 캐시. 사용자 데이터를 보관하는 DB 기능은 없다 | `functions/api/place.ts:11`, `functions/api/naver-folder.ts:11`, `functions/api/route.ts:17`, `functions/api/search.ts:11`, `functions/api/hours.ts:10`, `src/server/handler.ts:58` |
| 로컬 보관함 | 키 `tripmap:library:v2`. `schemaVersion: 2`, 장소·라벨·여행, 선택 컬렉션 약속·폴더 연결 | `src/services/library-store.ts:18`, `src/schema/library.ts:163` |
| 필드 시각 | 바뀌는 필드는 `{ value, updatedAt }`. LWW 비교 도우미와 같은 시각의 결정 규칙이 있다 | `src/schema/library-base.ts:32`, `src/domain/library/lww.ts:1` |
| 탭 간 저장 | Web Locks로 읽기→변경→검사→저장을 직렬화한다. 다른 탭 변경은 `storage` 이벤트로 받는다. 잠금 미지원 시 잠금 없이 실행한다 | `src/services/library-store.ts:243`, `src/services/library-store.ts:260`, `src/services/library-store.ts:281`, `src/services/library-store.ts:453` |
| 설정 | `tripmap:prefs`는 테마·보기·필터용 별도 저장. 보관함과 성격이 다르다 | `src/services/prefs-store.ts:7`, `src/services/prefs-store.ts:22` |
| 백업 | `tripmap-backup` v1 봉투에 저장소 원문과 선택 설정을 담는다. 복원 전 사본과 손상 원문 보관도 있다 | `src/schema/backup.ts:4`, `src/domain/backup/build-backup.ts:6`, `src/domain/backup/read-backup.ts:43`, `src/services/library-store.ts:22` |
| 장소·여행 링크 | 압축 데이터를 `/view#d=…`에 담는다. 해시 데이터 값 최대 32,000자. 큰 여행은 경로선을 뺀 사본으로 재시도하거나 파일 사용을 안내한다 | `src/share-viewer/encode.ts:11`, `src/share-viewer/encode.ts:94`, `src/domain/share/read-share.ts:7` |
| 여행 가져오기 | 받은 일정으로 새 여행 id와 새 Stop id를 만든다. 원본과 연결되는 공동 문서가 아니다 | `src/domain/library/import-share-trip.ts:53`, `src/domain/library/import-share-trip.ts:93` |
| 약속 | `/meet#d=`·`#r=`·`#f=`를 읽는다. 답장 대상 약속이 기기에 없으면 반영할 수 없다. 주최자가 `반영`해야 저장된다 | `src/domain/meeting/link.ts:37`, `src/sections/meetings/MeetLinkPage.tsx:53`, `src/sections/meetings/ReplyImport.tsx:10` |
| 약속 링크 별도 한도 | 약속은 해시 8,000자, 압축 전 JSON 65,536바이트다. 일반 공유의 32,000자와 다르다 | `src/domain/meeting/link.ts:19`, `src/domain/meeting/link.ts:105` |
| 당일 체크 | 보관함 장소의 개인 `visitedOn`을 바꾼다. 일행 공통 진행 상태는 없다 | `src/sections/trips/today/use-visit-toggle.ts:28`, `src/domain/library/visit.ts:6`, `src/schema/library.ts:97` |
| 출처 검사 | 운영 도메인·Pages 기본 주소·일부 localhost·한 단계 미리보기 도메인을 허용한다. 사용자 신원·권한 검사는 아니다 | `src/server/http.ts:39`, `src/server/handler.ts:64` |
| 도메인·공유 지도 | Cloudflare Registrar 연결 기록이 있다. 공유 HTML의 지도 페이지는 `gh-pages`의 GitHub Pages에 별도 배포한다 | `docs/checklists.md:20`, `docs/development.md:220` |

현재 캐시 유효기간은 장소 1일, 폴더 10분, 자동차·대중교통 경로 1시간, 도보 경로 7일, 검색 7일, 영업시간 1일이다. 근거는 각 `functions/api/*.ts`의 `maxAgeSeconds`와 `docs/development.md:209`다. 이미 있는 캐시를 서버 DB 도입으로 새로 생기는 기능처럼 설명하지 않는다.

### 2.2 요약과 구분하거나 바로잡을 점

- **“서버가 없다”는 사용자 데이터용 서버 DB가 없다는 뜻이다.** 조회 프록시 서버는 이미 있다. 장소 해석에는 네이버 외 지도 링크 처리도 포함된다(`functions/api/place.ts:20`, `src/server/resolve.ts:98`).
- **LWW는 동기화 완제품이 아니다.** `pickField`는 비교 도우미이며 `src` 검색에서 정의 외 호출은 확인되지 않았다. 현재 `LibraryStore.update`는 최신 로컬 문서를 잠금 안에서 읽고 연산할 뿐, 두 기기의 보관함을 병합하지 않는다(`src/services/library-store.ts:260`).
- **오프라인은 일부 동작에 한정된다.** 이미 열린 앱의 로컬 데이터는 네트워크 없이 다룰 수 있다. 서비스 워커로 앱을 오프라인에서 새로 여는 기능은 기존 설계에서 제외했다. 지도·검색·경로도 네트워크에 의존한다(`docs/superpowers/specs/2026-10-16-trip-day-mode-design.md:46`). 이번에는 실행 검증하지 않았다.
- 태그 `v0.16.0`은 `edaa752`(#52 병합)를 가리킨다(`docs/rollback.md:37`). `main` `05d3eaf`는 그 뒤에 롤백 표만 고친 문서 병합(#53)이므로 앱 코드는 `v0.16.0`과 같다(커밋 세션이 `git log edaa752..05d3eaf`로 확인).

### 2.3 사용자가 겪는 문제와 유지할 장점

| 지금의 한계 | 영향 | 서버 도입으로 얻는 것 |
|---|---|---|
| 기기·브라우저·주소마다 별도 저장 | PC에서 고친 여행이 휴대폰에는 없다. Pages 기본 주소와 운영 도메인도 다르다 | 같은 소유자의 자료를 선택해 동기화 |
| 여행 공유는 읽기 전용 사본 | 한 명이 고친 내용을 다시 보내야 한다. 각자 가져오면 서로 다른 여행이 된다 | 같은 여행을 열고 갱신 보기·함께 편집 |
| 약속 답장을 링크로 수집 | 주최자가 친구 답장을 하나씩 열어 반영해야 한다 | 친구의 투표·출발지 변경을 서버에 바로 반영 |
| 백업 파일 의존 | 브라우저 데이터를 지우거나 기기를 잃으면 복구가 어렵다 | 서버 사본과 변경 기록. 단, 동기화만으로는 백업을 대체하지 못한다 |
| 긴 공유 링크 | 메신저 취급이 불편하고 앱의 길이 제한에 걸린다 | 짧은 식별자로 서버 자료 조회 |
| 이미 보낸 링크·HTML 철회 불가 | 링크 안의 사본은 바꾸거나 없앨 수 없다 | 새 서버 링크의 향후 조회를 만료·철회 가능 |

지금 구조의 장점도 크다. 가입 없이 바로 쓰고, 보관함 전체를 운영자에게 맡기지 않는다. 개인 데이터 DB 비용은 0이고 장애 지점도 적다. 서버 연결이 끊겨도 이미 열린 앱에서 로컬 자료를 다룰 수 있다. 따라서 **로컬 전용 사용을 계속 허용하고, 업로드는 사용자가 켠 범위에 한정**하는 편이 맞다. 위치 검색·경로 조회 때 외부 서버로 좌표가 전달되는 점까지 없어지는 것은 아니다.

## 3. 무료 선택지 비교

### 3.1 Cloudflare 구성 요소

수치는 서비스 전체 또는 계정 전체 무료 한도다. 사용자마다 따로 주어지는 양이 아니다. DB 요청 수와 읽은 행 수는 다르다. 인덱스 없는 조회는 한 요청으로 많은 행을 읽는다.

| 서비스 | 무료 한도·제약: 확인함 | 휴면·인증·실시간 | 이 앱에 맞는 용도와 판단 | 결제 등록 필요 | 공식 출처·확인일 |
| --- | --- | --- | --- | --- | --- |
| D1 | 읽기 500만 행/일, 쓰기 10만 행/일, 계정 저장 5GB. 무료 DB 10개, **DB 하나 500MB**, 행 하나 최대 2MB. Time Travel 7일 | DB 자체에 앱 로그인·실시간 구독 없음. Functions 바인딩으로 접근. 휴면 후 자동 중단 규정은 이번 확인 문서에서 찾지 못함 | **주 저장소 추천**. 약속·여행·권한·동기화 기록을 SQL로 관리. 5GB를 DB 하나의 크기로 오해하면 안 됨 | 필요 없음(Free) | [요금](https://developers.cloudflare.com/d1/platform/pricing/), [제한](https://developers.cloudflare.com/d1/platform/limits/), [결제 조건](https://www.cloudflare.com/products/d1/) · 2026-10-25 |
| Workers / Pages Functions | 둘을 합해 계정 100,000요청/일. Workers Free HTTP CPU 10ms/호출, 하위 요청 50개/호출. Functions를 거치지 않는 Pages 정적 요청은 무료·무제한 | 앱 인증은 직접 연결. 실행 인스턴스 상주를 보장하는 VM이 아님. 초과 시 무료 요청 실패 | 기존 API에 DB 경로를 더하기 좋음. 큰 JSON 병합·암호 연산이 CPU 한도에 맞는지는 별도 검증 필요 | 필요 없음(Workers Free) | [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/), [Functions 요금](https://developers.cloudflare.com/pages/functions/pricing/), [결제 조건](https://www.cloudflare.com/products/workers/) · 2026-10-25 |
| KV | 읽기 100,000키/일, 쓰기·삭제·목록 조회 각각 1,000/일, 저장 1GB | 앱 인증 없음. 변경 전파가 다른 위치에서 60초 이상 걸릴 수 있음. 휴면 중단 정책은 확인 필요 | 영업시간 같은 재생성 가능한 캐시에 적합. **투표·권한 철회·동시 편집의 원본으로 부적합** | 필요 없음(Workers Free 포함) | [요금](https://developers.cloudflare.com/kv/platform/pricing/), [일관성](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [Workers 결제 조건](https://www.cloudflare.com/products/workers/) · 2026-10-25 |
| Durable Objects + SQLite | **Workers Free에서 사용 가능**. DO 요청 100,000/일, 실행 13,000GB-s/일, SQLite 읽기 500만 행/일·쓰기 10만 행/일·계정 저장 5GB | WebSocket과 방별 순서 제어 가능. 연결 휴면과 데이터 삭제는 다름. 앱 인증은 별도. 공식 동시 연결 상한의 무료 적용값은 확인 필요 | 즉시 집계·편집 알림의 후속 선택. Free에서 legacy KV 저장 DO는 사용할 수 없음. Pages 안에서 클래스를 배포하지 못하므로 별도 Worker 필요 | 필요 없음(Free SQLite) | [요금](https://developers.cloudflare.com/durable-objects/platform/pricing/), [제한](https://developers.cloudflare.com/durable-objects/platform/limits/), [Pages 바인딩](https://developers.cloudflare.com/pages/functions/bindings/), [결제 조건](https://www.cloudflare.com/products/durable-objects/) · 2026-10-25 |
| R2 Standard | 저장 10GB-month/월, Class A 100만회/월, Class B 1,000만회/월, 인터넷 전송료 없음. Infrequent Access는 이 무료량 대상 아님 | 객체 저장이며 로그인·투표 DB·실시간 기능은 없음. 무료량 초과는 과금 대상 | **제외**. 결제 등록과 초과 과금이 있는 서비스이므로 자동 백업·스냅샷 보관에 쓰지 않음 | 필요(종량제 구독) | [요금](https://developers.cloudflare.com/r2/pricing/), [구독 checkout](https://developers.cloudflare.com/r2/get-started/), [결제 정책](https://developers.cloudflare.com/billing/understand/billing-policy/) · 2026-10-25 |
| Cron Triggers | Free 계정 트리거 5개. Free CPU 10ms/호출. UTC 일정으로 실행 | 예약 실행 Worker가 필요. Pages의 HTTP 함수에 크론을 선언하는 것만으로 되지 않음 | 만료 자료 정리·소량 폴더 재확인. 한 번에 전체 사용자 자료를 처리하지 않고 분할해야 함 | 필요 없음(Workers Free 기능) | [제한](https://developers.cloudflare.com/workers/platform/limits/), [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers 결제 조건](https://www.cloudflare.com/products/workers/) · 2026-10-25 |
| Access / Zero Trust | 무료 좌석 최대 50명 범위. 제품 페이지 표현은 “50명 미만 팀에 적합”. 좌석 산정·정확한 경계는 도입 시 재확인 | 승인 이메일에 PIN 발송 또는 외부 신원 제공자 연결. DB 권한 기능은 앱에서 별도 구현 | **제외**. 무료 좌석이 있어도 결제 정보를 입력해야 하므로 사용자 원칙에 맞지 않음. 소유자 로그인은 §4로 대체 | **필요(Free도 입력 단계 필수)** | [Access 플랜](https://www.cloudflare.com/sase/products/access/), [이메일 PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/), [조직 생성 절차](https://developers.cloudflare.com/learning-paths/clientless-access/initial-setup/create-zero-trust-org/) · 2026-10-25 |
| Turnstile | 무료 위젯 최대 20개, 위젯당 호스트명 10개, 챌린지 검증 요청 무제한 | 봇 완화 기능. 사용자 신원·자료 권한·속도 제한을 대신하지 않음 | 초대 수락·익명 약속 생성·반복 투표 남용 방지. 서버에서 결과 검증 필요 | 필요 없음(Free) | [플랜](https://developers.cloudflare.com/turnstile/plans/), [결제 조건](https://www.cloudflare.com/products/turnstile/) · 2026-10-25 |
| Email Service / Email Routing | 수신 라우팅은 Free에서도 무제한. 임의 수신자 발송은 **Workers Paid 필요**. Paid에 발송 3,000통/월 포함, 이후 1,000통당 $0.35. 계정에서 검증된 목적지 발송은 모든 플랜에서 무료 | 라우팅만으로 일반 사용자 매직 링크 발송 서비스를 대체할 수 없음 | **임의 수신자 발송 제외**. 결제 등록 없는 초기 로그인·알림은 메일 발송에 의존하지 않음. 라우팅·본인 알림도 도입 보류 | 필요(임의 발송: Workers Paid); 라우팅·검증 목적지 활성화 조건은 확인 필요 | [이메일 요금](https://developers.cloudflare.com/email-service/platform/pricing/) · 2026-10-25 |

DO 저장 한도 페이지는 표에서 객체당 10GB를 제시하지만, 같은 문서의 용량 초과 설명은 Free 객체당 1GB를 구분한다. **Free 객체당 적용 상한은 확인 필요**로 남긴다. 이 제안에서는 DO에 보관함 원본을 저장하지 않는다. DO 무료 제공 여부와 SQLite 읽기·쓰기·계정 총량은 요금 페이지에서 확인했다.

Cloudflare 네트워크에는 서울·도쿄가 있다. 하지만 엣지 위치가 DB 위치를 보장하지 않는다. D1은 생성 시 `apac` 위치 힌트를 줄 수 있을 뿐 서울·도쿄를 확정 지정하는 것과 다르다. DO의 실제 배치 위치와 한국에서의 지연은 측정하지 않았다. 따라서 “한국에서 몇 ms”라는 숫자는 제시하지 않는다. [네트워크](https://www.cloudflare.com/network/), [D1 위치](https://developers.cloudflare.com/d1/configuration/data-location/) · 확인 2026-10-25.

### 3.2 다른 DB·자체 호스팅

| 선택지 | 무료 저장·요청·연결: 확인함 | 휴면·인증·실시간 | 한국 접근·락인·적합도 | 결제 등록 필요 | 공식 출처·확인일 |
| --- | --- | --- | --- | --- | --- |
| Supabase | 사용자 결정으로 제외(2026-10-25) | — | — | — | — |
| Firebase Spark / Firestore Standard | 프로젝트의 무료 DB 한 개: 저장 1GiB, 읽기 50,000문서/일, 쓰기 20,000문서/일, 삭제 20,000문서/일, 외부 전송 10GiB/월. 리스너도 읽기 사용량을 소비 | 실시간 리스너·Auth·Security Rules 제공. Identity Platform을 쓰는 Spark는 Tier 1 DAU 3,000/일, Tier 2는 2/일. 이메일 링크 로그인 발송은 **5통/일**, 비밀번호 재설정 150통/일. SMS는 Blaze 필요 | Firestore 서울 `asia-northeast3`·도쿄 `asia-northeast1`. 지연 미측정. JSON 문서 모델·규칙·SDK 의존으로 SQL 계열보다 이전 부담 큼. 짧은 휴면에 따른 DB 일시정지 여부는 확인 필요. **대안 1안**. Cloud Functions·Blaze·Cloud Storage를 추가하지 않는 구성 | **필요 없음(Spark)** | [Firestore 한도](https://firebase.google.com/docs/firestore/quotas), [Auth 한도](https://firebase.google.com/docs/auth/limits), [리전](https://firebase.google.com/docs/firestore/locations), [실시간](https://firebase.google.com/docs/firestore/query-data/listen), [Spark 결제 조건](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) · 2026-10-25 |
| Turso Free | DB 100개, 저장 5GB, 월 읽기 5억 행·쓰기 1,000만 행, sync 데이터 3GB, 시점 복구 1일. 신용카드 없이 시작 가능 표기 | DB 토큰·외부 JWKS 인증 지원. 앱의 사용자 계정·초대 권한은 별도. SQL용 WebSocket은 있지만 그것만으로 앱의 변경 구독이 생기지는 않음. 휴면·재활성화 및 앱 구독 한도는 확인 필요 | SQLite 호환이라 데이터 이전 부담은 비교적 작음. 현재 Cloudflare 외에 운영 지점이 하나 늘어남. 서울·도쿄 생성 가능 여부는 공식 리전 문서에서 확인 필요 | 필요 없음(Free) | [요금](https://turso.tech/pricing?frequency=monthly), [소개](https://docs.turso.tech/introduction), [인증](https://docs.turso.tech/sdk/authentication) · 2026-10-25 |
| PocketBase 자체 호스팅 | 소프트웨어는 오픈소스. 자체의 무료 DB 수·월 행 사용량 상품 한도는 없음. **호스트 디스크·메모리·연결 자원이 실질 한도** | SQLite·내장 인증·실시간 구독 제공. 1.0 전 완전한 하위 호환 미보장. 패치·메일·복구·접근 제어·모니터링을 직접 운영 | SQLite 파일 이전은 쉬운 편이나 인증·API 규칙은 재작성. 서버 위치는 호스트 선택에 달림. 이 앱 규모에서는 운영 일이 무료 DB 이익보다 클 가능성 | 소프트웨어 자체는 필요 없음; 호스트별 확인 필요 | [공식 문서](https://pocketbase.io/docs/) · 2026-10-25 |
| PocketBase + Fly.io 신규 계정 | **상시 무료 호스트로 추천 불가**. 현재 체험은 VM 합계 2시간 또는 7일 중 먼저 도달하는 시점까지. 체험 중 볼륨 20GB | 체험 머신은 5분 후 자동 정지 설정. 체험 종료·자원 소진 후 결제 설정 없으면 앱 정지 | 서버 위치 선택과 지속 볼륨 비용 별도. 체험을 계속 무료 운영으로 오해하지 않아야 함. **계속 운영 후보에서 제외** | 필요 없음(체험만); **필요(계속 운영)** | [체험 조건](https://docs.fly.io/about/free-trial) · 2026-10-25 |
| PocketBase + Oracle Always Free | 홈 리전에서 AMD Micro 최대 2대 또는 A1 월 1,500 OCPU-hour·9,000 GB-hour(상시 환산 2 OCPU·12GB). 블록 볼륨 합계 200GB. 실제 배치는 조합·가용 자원에 따름 | 7일 저사용 조건의 인스턴스 회수 가능. 무료 자원 부족으로 생성 실패 가능. 상시 프로세스·볼륨 백업을 직접 운영 | 홈 리전 제약. 서울·도쿄에서 지금 무료 인스턴스를 확보할 수 있는지 확인 필요. **신규 가입 시 카드 확인 조건 때문에 제외**. 예외가 있다는 문구를 결제 없는 가입 보장으로 해석하지 않음 | **필요(대부분의 신규 가입자 카드 확인)** | [Always Free 조건](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [가입 조건](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm) · 2026-10-25 |

Firebase의 Auth 3,000 DAU는 **Identity Platform 사용 조건의 수치**다. 기본 Auth와 모든 로그인 제공자에 일괄 적용하는 숫자로 읽으면 안 된다. Firestore의 무료 읽기·쓰기는 요청이 아니라 문서 단위이며, 리스너 재연결과 권한 평가도 설계할 때 따져야 한다. 인증·실시간 동시 연결의 별도 Spark 적용 상한은 추가 확인이 필요하다.

서버 없는 대안도 남긴다. 백업 파일을 사용자가 자기 클라우드 폴더로 옮기거나 기존 공유 파일·링크를 쓰면 추가 DB 비용 없이 계속 사용할 수 있다. 그러나 이는 수동 복사이며 여행 공동 편집·자동 투표 집계를 해결하지 못한다. 개인 클라우드 API까지 직접 붙이는 방식도 인증과 충돌 처리가 필요해, 이번 두 추천안보다 먼저 할 이유가 작다.

### 3.3 추천 근거와 이전 가능성

| 평가 | 추천: Pages Functions + D1 | 대안: Firebase Spark + Firestore + Auth |
|---|---|---|
| 운영 변화 | 현재 배포에 D1 바인딩과 인증을 추가. 즉시 통신·크론 도입 시 Worker 추가 | 기존 정적 배포는 유지하고 Firebase 프로젝트·Security Rules·리스너 추가 |
| 결제 등록 필요 | 필요 없음: Workers Free·D1 + Firebase Auth Spark만 사용 | 필요 없음: Spark 유지. Cloud Billing 연결·Blaze 전환 금지 |
| 개발 부담 | 자체 세션·초대·차분 동기화·갱신 전달 설계. Auth는 신원 확인에만 사용 | Auth·리스너·규칙이 있어 즉시 갱신 시작은 쉬움. 로컬 병합·초대 권한은 여전히 설계 필요 |
| 개인 프로젝트의 휴면 | 확인한 D1 요금·제한 문서에는 1주 휴면 중단 조건이 없음. 무중단 보장은 아님 | Firestore의 짧은 휴면에 따른 일시정지 여부는 확인 필요 |
| 무료 범위 | 같은 계정이면 가즈아와 요청·D1 계정 예산 공유. 단일 DB 500MB·CPU 주의 | 프로젝트당 문서 읽기·쓰기·전송 예산. 리스너·규칙 평가·재연결의 읽기 비용 주의 |
| 친구 무가입 참여 | 초대 토큰을 앱 자체 참석자 세션으로 교환. 친구에게 Auth SDK 불필요 | 익명 Auth uid에 초대 권한을 연결. 이메일·가입 화면은 없어도 내부 익명 계정과 SDK 필요 |
| 락인 | SQL/JSON 내보내기는 비교적 쉬움. Functions 바인딩·DO 코드는 Cloudflare 의존 | 문서 모델·Security Rules·SDK·Auth 사용자 이전은 재작업 |
| 이전 대비 | 도메인 id·표준 JSON·내부 사용자 id 유지. 외부 제공자 값은 보관함에서 분리 | 동일 원칙. 익명 uid 유실·계정 연결과 콘텐츠 내보내기를 별도 처리 |

결제 조건 근거: [Workers](https://www.cloudflare.com/products/workers/), [D1](https://www.cloudflare.com/products/d1/), [Firebase Spark](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) · 확인 2026-10-25.

가즈아와 같은 대안을 고르되 이유는 랜드마크 기준으로 판단했다. 여행·약속은 리스너의 이점이 있고, 친구는 익명 Auth로 가입 없이 참여할 수 있다. 반면 현재 Cloudflare API를 유지하며 작은 기능부터 붙이는 이점과 SQL 이전 편의 때문에 본안은 D1이다. Firebase 대안에서도 Cloud Functions·유료 예약 작업·파일 저장을 필수로 넣지 않는다. 복잡한 서버 집계나 초대 교환이 필요하면 기존 Pages Functions를 이용하는 별도 권한 설계가 필요하며, Spark만으로 서버 코드가 자동 제공되는 것은 아니다.

## 4. 로그인과 신원

Access/Zero Trust는 **무료 플랜도 조직 생성 시 결제 정보 입력이 필요**해 제외한다. 사용자 제공 [기존 경로](https://developers.cloudflare.com/learning-paths/zero-trust-web-access/initial-setup/create-zero-trust-org/)는 이번 웹 도구로 본문을 확보하지 못했지만, 같은 공식 안내의 [현재 경로](https://developers.cloudflare.com/learning-paths/clientless-access/initial-setup/create-zero-trust-org/)에서 이 조건을 직접 확인했다(2026-10-25). 메일 발송이 필요 없는 소유자 로그인과 친구 초대를 우선한다.

### 4.1 네 가지 선택지 비교

| 방식 | 신원 확인·세션 | 결제 등록 필요 | 장점·부담 | 이 앱의 판단 |
|---|---|---|---|---|
| (a) 직접 Google Identity Services(GIS) | 브라우저 Google ID 토큰 → Pages Functions가 Google JWKS로 서명·aud·iss·만료 검증 → D1 자체 세션 | **확인 필요**. 공식 설정 절차에 결제 계정 연결은 없으나, 결제 불필요를 명시한 근거는 확보 못 함 | 별도 Auth 공급자·메일 발송 없이 Google 신원 사용. GIS도 외부 스크립트·네트워크 요청이 생기므로 로그인 시 지연 로딩 | 구조는 간결한 후보. 결제 등록 없는 클라이언트 생성 조건을 확정하기 전 도입 보류 |
| (b) Firebase Auth Spark는 신원만, 데이터는 D1 | Google 제공자로 로그인 → Firebase ID 토큰 검증 → 내부 userId·D1 자체 세션 | **필요 없음(Spark)** | 소셜 로그인·복구를 활용. 별도 공급자 운영과 SDK 부담. Firestore는 본안에 붙이지 않음 | **초기 소유자 로그인 추천**. 확인된 결제 조건을 우선. 친구는 앱 자체 초대로 참여 |
| (c) 계정 없는 보관함 비밀 키 + 기기 연결 코드/QR | 암호학적으로 긴 동기화 비밀 키의 해시·범위를 D1에 보관. 기존 기기가 새 기기를 승인. 약속·여행은 초대 토큰 | 별도 인증 서비스는 필요 없음; 본안 서버 무료 조건 사용 | Google 계정·메일 불필요. 비밀 키와 모든 승인 기기를 잃으면 복구 불가. 유출은 전체 보관함 탈취로 이어질 수 있음 | 계정을 원치 않는 소유자의 선택지. 비밀 키는 복구용으로 별도 보관하고 친구 초대와 분리 |
| (d) 패스키 직접 구현 | WebAuthn 공개키·challenge·credential을 서버에서 검증하고 자체 세션 발급 | 별도 인증 서비스는 필요 없음; 본안 서버 무료 조건 사용 | 메일 불필요. RP ID·origin·서명·사용자 검증·재전송 방지·다중 기기·복구 설계 부담 | 장기 후보. 초기 범위에서 직접 인증 구현 부담이 가장 큼 |

공식 근거: [GIS 설정](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [Google ID 토큰 검증](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Google Auth 결제 권고 설명](https://support.google.com/cloud/answer/15548748?hl=en), [Spark 결제 조건](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Firebase Google 로그인](https://firebase.google.com/docs/auth/web/google-signin), [Firebase ID 토큰 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [패스키 서버 검증](https://developers.google.com/identity/passkeys/developer-guides/server-authentication) · 확인 2026-10-25. 자체 비밀 키·기기 연결의 세부 규칙은 서비스 공식 기능이 아니라 설계 제안이다.

### 4.2 Google 설정·검증 범위와 첫 로딩

- **직접 GIS 결제 조건:** Google은 프로젝트·OAuth 웹 클라이언트·허용 origin/redirect·브랜딩 설정을 안내한다. Auth Platform 점검의 billing 연결은 일부 유료 API 때문에 권고한다고 설명한다. 이를 근거로 클라이언트 생성의 결제 등록 불필요를 확정하지 않는다. 무료 체험·유료 API·Cloud Billing을 연결하는 경로는 사용하지 않는다. 확인 전에는 (b)를 기준으로 제안한다. [설정](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [점검 설명](https://support.google.com/cloud/answer/15548748?hl=en) · 확인 2026-10-25.
- **검증 없이 쓸 수 있는 범위:** External/Testing은 기본적으로 테스트 사용자 최대 100명이나, `openid`·`email`·`profile`만 요청하면 테스트 명단 제한 예외가 있다. 테스트 표시·Workspace 관리자의 차단은 남는다. Published/Unverified는 접근 가능하더라도 이름·로고가 표시되지 않고 권장되지 않는다. 민감·제한 scope의 검증과 **브랜드 검증은 별개**이며, Google의 운영용 인증 지침은 인증만 쓰는 앱에도 브랜드 검증 제출을 요구한다. 따라서 개인·소수 시험 범위를 공개 운영의 영구 검증 면제로 해석하지 않는다. Firebase 경유도 Google의 동의·브랜드 정책을 면제하지 않는다. [앱 상태별 범위](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [인증 운영 정책](https://developers.google.com/identity/verification/authentication-policy-compliance) · 확인 2026-10-25.
- **SDK:** 현재 첫 로딩 여유는 약 **11,066바이트**다(§9.2의 기존 측정). Firebase Auth를 정적 import하면 이 예산을 위협한다. 모듈형 SDK도 무료 크기 예산을 보장하지 않으므로 로그인 단추를 누른 뒤 `firebase/app`·필요한 `firebase/auth`만 동적 로드하고, 첫 청크·공유 청크 유입을 확인한다. 본안에는 Firestore SDK를 넣지 않는다. 정확한 추가 gzip 바이트·로그인 지연·Functions 토큰 검증 CPU는 미측정이다. [모듈형 SDK](https://firebase.google.com/docs/web/learn-more#modular-version) · 확인 2026-10-25.

### 4.3 초기 추천 흐름과 두 앱의 Google 신원

1. 로컬 사용은 로그인 없이 유지한다. 소유자가 동기화·온라인 공유를 켤 때만 Firebase Auth Spark의 Google 로그인을 지연 로드한다. 앱은 메일·SMS를 보내지 않는다.
2. Pages Functions가 **Firebase ID 토큰**의 서명·고정 프로젝트 aud·`https://securetoken.google.com/<프로젝트 ID>` iss·만료 등을 검사하고 `(issuer, sub)`를 내부 userId에 연결한다. D1에는 예측 불가능한 자체 세션의 해시·만료·기기·철회 상태를 보관하고 쿠키로 사용한다. Firebase uid와 직접 Google sub는 다른 식별자이므로 혼용하지 않는다.
3. 직접 GIS로 바꾸는 경우에는 **Google ID 토큰**을 Google JWKS로 검증한다. 허용 aud는 랜드마크 웹 클라이언트로 고정하고 iss(`accounts.google.com` 또는 `https://accounts.google.com`)·만료를 검사한다. Google 공개키는 응답 Cache-Control에 맞춰 갱신한다. 검증한 sub로만 내부 신원을 연결하고 이메일 문자열을 id로 믿지 않는다. 단순 JWT decode나 운영 시 매 요청 tokeninfo 호출로 대체하지 않는다.
4. 친구는 약속별 초대를 수락해 앱 자체 참석자 세션을 받는다. Google·Firebase 가입 없이 **자기 투표·자기 출발지만** 수정한다. 여행 보기와 편집 초대도 분리한다. Firebase 전체 대안에서는 익명 Auth uid에 같은 범위의 권한을 부여한다.
5. 편집 초대는 가급적 1회 수락 후 개별 기기 세션으로 교환한다. 기기 연결 코드는 예를 들어 10분 만료·1회 사용·시도 횟수 제한과 기존 기기의 최종 승인을 요구한다. 표시명은 신원 증명이 아니며 짧은 코드만으로 보관함을 복구하지 않는다.
6. 로그아웃·분실 기기 철회·계정 삭제는 D1 세션을 무효화한다. 외부 토큰의 유효한 서명만으로 탈퇴·차단된 내부 사용자를 다시 활성화하지 않는다. 자체 세션 최대 수명·재인증·외부 계정 철회 반영 주기는 후속 설계로 정한다.

토큰 검증 근거: [Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Firebase](https://firebase.google.com/docs/auth/admin/verify-id-tokens) · 확인 2026-10-25. 세션·초대 수명은 앱 정책 제안이다.

가즈아와 같은 Google 계정을 쓰면 새 비밀번호 없이 익숙한 계정 복구를 쓰고 로그인 경험을 맞출 수 있다. 반면 Google 장애·계정 정지·탈취가 두 앱 접근에 함께 영향을 주고 운영자가 신원을 연결할 수 있어 개인정보 결합 위험이 커진다. **동일 신원 공급자 사용이 DB·세션·권한 공유를 뜻하지 않도록** 앱별 OAuth 클라이언트/Firebase 프로젝트·내부 userId·쿠키·세션을 분리한다. 가즈아 토큰의 aud를 랜드마크가 허용하지 않으며, 같은 이메일만으로 계정이나 데이터를 자동 합치지 않는다.

### 4.4 이메일이 꼭 필요한 경우

| 방법 | 기존에 확인한 무료 범위 | 결제 등록 필요 | 판단 |
|---|---|---|---|
| Resend Free API/SMTP | 월 3,000통, 일 100통, 발송 도메인 3개 | **확인 필요** | 도메인 인증·평판·발송 한도까지 검토 전 도입 보류. 초기 매직 링크·확정 알림의 의존성에서 제외 |
| Cloudflare Email Service | 임의 수신자 발송은 Workers Paid. 수신 라우팅·검증 목적지 발송은 Free 가능 | 임의 발송은 **필요**; 나머지 활성화 조건은 확인 필요 | 임의 수신자 발송은 사용자 결정으로 제외. 본인용 발송도 이번 구성에 포함하지 않음 |

공식 근거: [Resend 요금](https://resend.com/pricing), [Cloudflare Email 요금](https://developers.cloudflare.com/email-service/platform/pricing/) · 확인 2026-10-25. 메일 발송 후보의 무료량과 결제 등록 조건은 별개다.

확정 알림은 먼저 **앱을 열었을 때 확정·변경 상태 표시**로 시작한다. 매직 링크는 발송 서비스가 필요하므로 첫 단계에서 제외한다. Web Push는 서비스 워커·허용·재시도 설계가 별도로 필요하다. 향후 이메일을 재검토해도 결제 등록 없는 서비스라는 조건을 먼저 확인하고, 조건을 만족하지 못하면 사용하지 않는다.

## 5. 저장과 동기화 모델

### 5.1 로컬 우선 추천

| 모델 | 오프라인·체감 | 충돌·운영 부담 | 판단 |
|---|---|---|---|
| 로컬 우선 + 서버 동기화 | 저장은 우선 기기에 반영. 연결되면 전송. 서버 장애 중에도 개인 자료 사용 | 변경 큐·중복 방지·삭제 전파·충돌 안내 필요 | **개인 보관함에 추천**. 현재 사용 경험을 지키고 선택 업로드 가능 |
| 서버 우선 | 온라인 최신 상태를 다루기 쉽다. 오프라인은 읽기 사본·임시 초안 정도 | 서버 중단·한도 초과가 저장에 직접 영향. 기존 사용 방식의 변화 큼 | 보관함 전체 전환은 비추천 |
| 개인 보관함은 로컬 우선, 공동 자료는 서버 확정 | 공동 편집은 서버가 검증·승인하고 로컬에 마지막 사본 보관 | 승인 대기·실패·충돌을 화면에서 구별해야 함 | **전체 구성으로 추천**. 오프라인 수정은 초안이며 공동 반영 완료로 표시하지 않음 |

권장 흐름은 `화면 수정 → 로컬 문서 + 전송 대기 기록 → 서버 권한·스키마 검사 → 변경 확정 → 다른 기기가 차분 수신`이다. 서버에서 확정한 커서로 재연결 뒤 빠진 변경을 가져온다. 화면에는 `이 기기에 저장됨`, `동기화 중`, `동기화 완료`, `확인 필요한 충돌`을 구분한다.

### 5.2 이미 있는 것과 더 필요한 것

| 구분 | 지금 있는 것 | 더 필요한 것 |
|---|---|---|
| 필드 병합 | LWW 시각 비교, 같은 시각이면 JSON 문자열 사전순 결정. 같은 값이면 시각을 바꾸지 않는 도우미 | 필드·객체별 실제 병합기, 서버 변경 순서, 충돌 기록. 사전순 승리가 사용자의 의도에 맞는 것은 아님 |
| 로컬 저장 | 잠금 안에서 최신 문서 재조회, 검증·용량 검사, 다른 탭 통지 | 네트워크 큐, 전송 재시도, 서버 커서. Web Locks는 다른 기기를 잠그지 못함 |
| 삭제 | `deletedAt`으로 숨김. 장소 복원은 `deletedAt = null` | 삭제·복원 명령의 버전. `null`만으로는 복원이 오래된 사본인지 새 명령인지 알 수 없음 |
| 참조 무결성 | 여행의 장소·날짜·Stop, 약속의 참석자·후보·답장 관계 검사 | 서버 트랜잭션에서도 동일 검사. 소유자·멤버·권한까지 확인 |
| 보관함 형식 | `schemaVersion: 2`, 선택 컬렉션, 원문 백업·복원 전 사본 | 별도 동기화 프로토콜 버전, 지원 최소 앱 버전, 서버 마이그레이션 |
| 인증 | 현재 없음 | 소유자 세션, 초대 권한, 기기별 철회·분실 대응 |

근거: `src/domain/library/lww.ts:8`, `src/services/library-store.ts:260`, `src/domain/library/ops.ts:185`, `src/schema/trip.ts:67`, `src/schema/meeting.ts:71`.

**“필드마다 LWW가 있으니 그대로 공동 편집된다”는 가정은 피해야 한다.** 여행의 `Day.stops`는 목록 전체가 한 필드이며 Stop의 메모·시간은 독립 LWW 필드가 아니다. Day에는 안정적인 id도 없다(`src/schema/trip.ts:14`, `src/schema/trip.ts:28`). 약속도 `participants`·`candidates`·`replies` 전체가 각각 한 필드다(`src/schema/meeting.ts:44`). 두 사람이 서로 다른 답장을 추가해도 전체 `replies` 덮어쓰기로 처리하면 한쪽이 사라질 수 있다.

### 5.3 충돌·삭제·시계 규칙 제안

| 문제 | 제안 규칙 | 이유 |
|---|---|---|
| 단순 필드 변경 | 필드 단위 LWW 개념을 유지하되 서버 확정 버전과 변경 전 버전을 함께 관리 | 제목과 메모처럼 다른 필드의 수정은 함께 살릴 수 있음 |
| 같은 필드 동시 수정 | `baseVersion`이 다르면 충돌 사본을 남기고 최신 값·내 초안을 비교하게 함. 자동 선택 시에도 이전 값 기록 | 조용히 한쪽을 지우지 않기 위해 |
| 기기 시계 차이 | 기기 `updatedAt`을 서버 전체 순서로 신뢰하지 않음. 서버가 단조 증가 revision·수신 시각을 발급. 같은 기기 순서는 `deviceId`·순번으로 보존 | 미래로 맞춰진 시계가 모든 변경을 이기는 문제 방지 |
| 늦게 도착한 오프라인 변경 | 수신 시각이 늦다는 이유만으로 최신본을 무조건 덮지 않음. 기준 버전과 비교 후 병합·충돌 처리 | 서버 시각만 붙여도 오래된 오프라인 편집 문제는 해결되지 않음 |
| 약속 답장 | `(meetingId, participantId)` 단위 행으로 저장. 중복 요청 id는 한 번만 반영 | 다른 참석자의 응답을 덮지 않고 재시도 중복 방지 |
| 여행 목록·순서 | 처음에는 Day별 버전 비교 후 충돌 시 재적용. 이후 Day·Stop 안정 id와 명령 단위 추가·이동·삭제로 세분화 | 배열 전체 LWW만으로 순서 편집을 안전하게 합치기 어려움. CRDT부터 도입할 필요는 없음 |
| 삭제와 복원 | 객체 tombstone과 삭제 revision 유지. 복원은 새 revision을 가진 명시적 명령. 삭제 뒤의 일반 편집은 거부·초안 보관 | 오래된 기기가 삭제 자료를 다시 살리는 문제 방지 |
| tombstone 정리 | 제안 기본 90일. 그보다 오래 접속하지 않은 기기는 전체 재동기화. 서버 삭제 id 요약 또는 세대 번호로 재유입 차단 | 삭제 기록을 영원히 보관하지 않으면서 부활 방지 |
| 삭제와 오프라인 편집 충돌 | 삭제 상태를 우선 유지하고 로컬 편집은 별도 초안으로 남김 | 타인의 삭제를 모르게 취소하지 않으면서 내용 유실도 막음 |

LWW 값의 `{ value, updatedAt }` 모양은 호환을 위해 유지할 수 있다. 서버 revision·충돌·커서는 별도 메타데이터로 둔다. 기존 `pickField`를 그대로 호출하는 것만으로 위 규칙이 구현되는 것은 아니다. 진짜 동시 충돌에서는 전체 정렬보다 사용자 확인이 필요하다.

### 5.4 저장 키·DB·백업의 관계

- `tripmap:library:v2`는 개인 보관함의 호환 사본으로 유지한다. `tripmap:prefs`는 우선 기기별로 둔다. 화면 폭·필터·테마까지 같은 값으로 만들 필요는 작다.
- 동기화 메타데이터는 예를 들어 별도 `tripmap:sync:v1`에 상태·커서·기기 id만 둔다. **이 키는 제안이며 아직 존재하지 않는다.** 인증 토큰을 백업 파일이나 보관함에 넣지 않는다.
- 전송 큐는 문서와 따로 기록하면 충돌·중단 사이에 변경을 놓칠 수 있다. 초기에는 저장 전후 차이와 마지막 승인 사본을 대조해 누락을 복구한다. 지속 큐·문서·커서의 원자적 저장이 필요해지면 IndexedDB 트랜잭션으로 옮기는 별도 설계를 한다. localStorage와 IndexedDB를 함께 쓴다고 원자성이 생기지는 않는다.
- 서버는 `users`, `memberships`, `meetings`, `meeting_replies`, `trips`, `trip_places`, `changes`, `invites` 같은 책임별 자료를 둔다. 개인 보관함과 공동 여행의 공개 자료를 분리한다. 친구가 편집할 수 있는 것은 공유 여행이며 내 전체 보관함이 아니다.
- DB에는 객체·항목 단위 행을 쓴다. 로컬 보관함 최대값은 **4,000,000 UTF-16 길이**이지 4MB 파일이 아니다(`src/schema/library-base.ts:17`). D1 행 최대 2MB이므로 보관함 전체 JSON 한 행 저장은 일반 해법이 아니다. 큰 여행·스냅샷도 분할하고 byte 길이를 따로 검사한다.
- 백업 v1은 계속 독립 내보내기로 제공한다. 서버 세션·편집 토큰·ACL을 포함하지 않는다. 공동 자료는 사용자가 권한을 가진 콘텐츠만 호환 사본으로 내려받고, 복원은 **새 개인 사본 만들기**가 기본이다. 공유 권한을 복원하거나 서버 최신본을 자동 덮어쓰지 않는다.
- 향후 협업 기록·충돌·동기화 상태까지 옮기는 별도 내보내기가 필요하면 기존 백업 v1을 조용히 확장하지 않고 별도 형식·버전을 정한다.

### 5.5 기존 사용자 첫 연결

1. 로컬 전용 사용을 그대로 허용한다. 로그인·업로드를 강제하지 않는다.
2. 사용자가 `이 기기 보관함 연결`을 선택하면 장소·라벨·여행·약속·폴더 연결의 개수와 업로드 범위를 보인다. 출발지·메모가 포함됨을 알린다.
3. 먼저 기존 방식의 전체 백업을 받을 수 있게 한다. 실제 업로드는 명시적인 선택 뒤 시작한다. 현재 로컬 문서는 지우지 않는다.
4. 서버가 비어 있으면 id를 유지해 분할 업로드하고, 개수·스키마·참조를 검증한 뒤 최초 커서를 확정한다. 실패한 조각은 같은 작업 id로 재시도한다.
5. 서버 자료가 있으면 `서버 자료로 연결`·`이 기기 자료와 합치기`를 선택하게 한다. 같은 id는 기준 사본·필드 버전으로 비교한다. 별개 id의 같은 네이버 sid·같은 라벨 이름은 기존 도메인 규칙에 맞춰 합치기 미리보기를 제공하고 여행 참조 id도 함께 치환한다.
6. 모든 항목이 승인되기 전에는 `동기화 완료`라고 하지 않는다. 두 번째 기기는 서버 사본을 받은 뒤, 그 기기의 기존 자료도 별도 미리보기로 합친다.
7. 로그아웃은 전송을 멈추고 세션을 없앤다. 로컬 사본 삭제는 별도 선택이다. 다른 계정으로 로그인할 때 이전 계정 자료를 자동 업로드하지 않는다. 도메인별 로컬 저장은 서버 연결 전까지 계속 분리돼 있다(`docs/development.md:199`).

## 6. 기능별 개선안

난이도는 상대 평가다. `낮음`은 단일 자료 조회·링크 관리, `중간`은 권한·동시 저장·실패 복구, `높음`은 여러 기기의 충돌·이전·복구가 필요한 경우다. 확정 일정이나 인일 견적은 아니다.

| 기능 | 지금 → 서버가 있으면 | 필요한 서버 기능 | 난이도 | 우선순위·이유 |
|---|---|---|---|---|
| 여러 기기 보관함 동기화 | 백업으로 복사 → 같은 신원으로 장소·라벨·여행·약속·폴더 연결을 이어서 사용 | 인증·객체별 변경·차분 커서·멱등 요청·tombstone·충돌 기록 | 높음 | P2. 효과가 크지만 자료 유실 영향도 가장 큼 |
| 여행의 갱신되는 공유 | 읽기 전용 사본 재전송 → 짧은 링크를 다시 열면 최신 일정 표시 | 공유 여행·보기 권한·revision·만료·철회 | 중간 | P1 앞부분. 함께 편집 전에도 혼자 계획하고 친구에게 전달하기 편함 |
| 여행 함께 편집 | 각자 복사본 수정 → 같은 여행에서 보기/편집 권한으로 후보·순서·시간·메모 수정 | 소유자/편집자/보기 권한, 항목 변경, 버전 비교, 관계 검증·변경 내역 | 높음 | P1 뒷부분. 여행의 핵심 불편을 해결 |
| 여행 당일 진행 공유 | 개인 장소 `visitedOn` 체크 → 일행 공통의 방문 완료·다음 장소를 공유 | `(tripId, dayId, stopId)` 진행 자료, 수정자·시각, 구독 또는 주기 조회 | 중간 | P1 후속. 기존 개인 방문 기록과 분리해야 여행 밖 기록을 덮지 않음 |
| 약속 투표·출발지 저장 | 답장 링크를 보내고 수동 반영 → 친구 화면에서 저장 즉시 서버에 접수 | 약속별 참석자 권한, 출발지·투표 행, 수정·취소·중복 방지 | 중간 | **P0**. 가장 작은 유용한 시작점 |
| 약속 자동·실시간 집계 | 주최자 기기에서만 집계 → 모든 참여자가 현재 집계를 확인 | D1 집계·버전. 첫 단계는 10초 간격 조회, 즉시 갱신은 DO WebSocket, Firebase 대안은 Firestore 리스너 | 중간 | P0 자동 집계, P1 즉시 전달. 답장 링크가 없어지는 효과가 우선 |
| 약속 확정 알림 | 확정 링크를 따로 전송 → 화면에서 확정·변경 표시. 메일 발송은 초기 제외 | 확정 revision·미확인 상태·중복 표시 방지. 외부 발송 서비스 불필요 | 중간 | P1. 앱을 닫은 상태 알림은 별도 채널 필요 |
| 짧은 링크·만료·철회 | 긴 해시·고정 사본 → `/s/<무작위 식별자>`로 서버 조회 | 공유 레코드, 유효기간, 범위별 권한, 취소 상태, 갱신 확인 | 낮음~중간 | P0 약속 링크부터. 받은 사람이 최신본을 보기 쉬움 |
| 자동 백업·기록 | 수동 파일 → 서버의 최근 사본·변경 이력·선택 복원 | D1 소형 스냅샷 최대 1개/보관함·크기 제한·정합성 검사 + 기존 수동 백업 파일. Drive 연동은 선택 검토(§7.4) | 중간 | P2. D1 사본은 같은 장애 범위이므로 수동 파일을 독립 백업으로 유지 |
| 네이버 폴더 주기 재확인 | 사용자가 다시 가져오기 → 동의한 연결 폴더만 주기적으로 변경 감지 | Cron Worker·작업 분할·중복 폴더 묶기·실패 재시도·변경 미리보기 | 중간 | P3. 비공식 API에 부담을 줄 수 있어 자동 덮어쓰기보다 알림부터 |
| 영업시간 캐시 공유 | 이미 Cache API에 1일 캐시 → 조회 시각·실패 상태를 지속 저장하고 여러 기기에서 재사용 | 장소 id별 캐시·유효기간·요청 합치기. KV 또는 D1 선택 | 낮음~중간 | P3. 이미 있는 캐시 대비 추가 이득을 먼저 측정 |

여행 공유에서는 일정에 필요한 이름·좌표·시간·Stop 메모만 공유 자료로 복사한다. 보관함의 개인 메모·리뷰·라벨·약속 출발지를 통째로 공개하지 않는다. 편집자가 공유 장소 이름을 바꿔도 소유자 개인 보관함의 원본을 자동으로 바꾸지 않는 것을 기본으로 한다.

약속에서 친구 출발지는 기본으로 본인과 주최자만 원좌표를 본다. 다른 친구에게는 소요시간 또는 동의한 출발역 이름만 보인다. 지금 후보 링크는 참석자 출발지를 포함할 수 있으므로(`src/domain/meeting/link.ts:37`), 서버 도입 때 공개 범위를 오히려 줄일 수 있다. 서버가 네이버 경로를 대신 계산한다면 출처 헤더를 위조해 자기 HTTP API를 부르지 말고 권한 검증 뒤 기존 서버 해석 로직을 내부 호출하는 방향으로 설계한다.

서버 링크 철회는 **앞으로 서버에서 읽는 것**을 막는다. 이미 받은 HTML·해시 링크·스크린샷·가져온 개인 사본은 회수할 수 없다. 기존 링크를 서버 링크로 자동 변환하거나 삭제할 수도 없다.

## 7. 비용과 무료 한도 시나리오

### 7.0 같은 Cloudflare 계정이면 공유하는 예산

가즈아도 Workers Free + D1을 추천했고 기존 증권사 프록시 Worker가 있다(사용자 제공 전제). **두 앱이 같은 Cloudflare 계정인지는 확인 필요**다. 같은 계정이면 저장소·프로젝트·Worker·DB 이름을 나눠도 계정 무료량이 늘어나지 않는다. 아래 절반 배정은 공식 예약 기능이 아니라 **두 앱의 운영 예산 초안**이다. 가즈아의 기존 프록시·랜드마크의 기존 네이버 API·Preview·관리 작업·다른 앱까지 잔여량에서 차감해야 한다.

| 항목 | 같은 계정의 무료 한도·집계 범위 | 랜드마크 배정 초안 | 가즈아·다른 작업에 남길 몫 | 공식 출처·확인일 |
|---|---|---|---|---|
| Workers + Pages Functions | 합산 100,000요청/일, 계정 전체. Pages 정적 파일은 제외 | **50,000/일**. 기존 API·인증·서버 링크·거절 응답까지 포함 | 나머지 50,000/일. 증권사 프록시 포함 | [Functions 요금](https://developers.cloudflare.com/pages/functions/pricing/), [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/) · 2026-10-25 |
| D1 읽기·쓰기 | **계정 전체** 읽기 500만 행/일·쓰기 10만 행/일. FAQ도 계정이 한도에 닿으면 쿼리가 실패한다고 명시 | **250만 읽기·50,000쓰기/일**. 세션·인덱스·정리·스냅샷도 포함 | 나머지 절반. DB 분리로 일 예산을 격리할 수 없음 | [D1 요금·초과 동작](https://developers.cloudflare.com/d1/platform/pricing/) · 2026-10-25 |
| D1 저장·DB 수 | 계정 5GB·10개, Free **DB당 500MB** | 총량 2.5GB·DB 최대 5개라는 계획상 배분. 처음은 운영 1개+개발/Preview 1개, 운영 DB 경고선 400MB | 나머지 2.5GB·5개. 두 앱의 실제 DB 수 확인 필요 | [D1 제한](https://developers.cloudflare.com/d1/platform/limits/) · 2026-10-25 |
| Cron Triggers | 계정 전체 5개 | 최대 2개, 첫 도입은 정리·백업을 묶은 1개부터 | 가즈아 최대 2개·공통 예비 1개라는 초안 | [Workers 계정 한도](https://developers.cloudflare.com/workers/platform/limits/), [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · 2026-10-25 |
| Turnstile | 계정 전체 위젯 20개, 위젯당 호스트명 10개 | 최대 10개 배분, 실제로는 운영·시험용 최소 개수만 사용 | 나머지 10개 | [플랜·계정 단위 명시](https://developers.cloudflare.com/turnstile/plans/) · 2026-10-25 |
| KV | Free 읽기 100,000/일·쓰기/삭제/목록 각각 1,000/일·1GB | 보수적으로 절반 이하를 운영 예산으로 관리. 초기 필수 구성 아님 | 나머지 절반. namespace별 무료량으로 가정하지 않음 | [KV 요금](https://developers.cloudflare.com/kv/platform/pricing/) · 2026-10-25 |
| DO + SQLite | 저장 5GB·클래스 100개는 계정 단위. 무료 요청 100,000/일·실행 13,000GB-s/일·읽기 500만/일·쓰기 10만/일 | 후속 도입 때 각각 절반 이하: 요청 50,000·실행 6,500GB-s·읽기 250만·쓰기 50,000·저장 2.5GB·클래스 50개 | 나머지 절반. 요청·실행·행 수의 계정 합산 범위에 대한 명시적 문구는 추가 확인 필요하므로 앱마다 전체 무료량을 쓸 수 있다고 보장하지 않음 | [DO 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/), [계정 한도](https://developers.cloudflare.com/durable-objects/platform/limits/) · 2026-10-25 |

DO의 SQL 예산은 D1과 **별도 제품의 계량값**이다. 숫자가 같다고 D1과 DO를 하나의 5GB/읽기/쓰기 풀로 합치지 않는다. 한편 DO를 호출하는 Worker의 요청도 별도로 계산하므로 WebSocket을 붙인다고 Workers 예산이 사라지지 않는다. KV·DO의 세부 집계 범위가 미확정인 부분은 위 배분을 보수적인 운영 제안으로만 사용한다.

### 7.1 계산 가정 — 모두 어림

개인 백업·브라우저 저장소를 찾거나 읽지 않았다. 아래 크기는 스키마에 들어 있는 문자열·좌표·필드 시각·참조 배열을 보고 잡은 예시다. 실제 사용량은 도입 뒤 집계 지표로 확인한다.

| 가정 | 한 사람 기준 | 근거·계산 |
|---|---|---|
| 보관함 | 장소 500개, 라벨 30개, 여행 10개, 약속 10개, 폴더 연결 5개 | 실제 사용자 분포가 아니라 개인 여행 앱의 예시 규모 |
| 장소 JSON | 장소당 약 0.8KB → 400KB | 이름·주소·좌표·짧은 메모·여러 `{value, updatedAt}`. `src/schema/library.ts:86` |
| 나머지 JSON | 여행당 10KB, 약속당 5KB, 라벨·폴더·봉투 합계 50KB → 200KB | Day·Stop 배열, 최대 10명·8후보, 폴더 sid 목록. `src/schema/trip.ts:14`, `src/schema/meeting.ts:44`, `src/schema/library.ts:132` |
| 현재 보관함 크기 | 합계 약 600KB = 0.6MB | 장문 메모·수백 Stop·긴 폴더 이력이 있으면 크게 늘어남. 압축 전 UTF-8 크기의 어림이며 localStorage 문자 수와 다름 |
| 조회 시간 | 두 기기에서 각각 하루 30분, 열린 화면에서 10초마다 한 번 | 2 × 1,800초 ÷ 10 = 360조회/일. 숨겨진 탭·오프라인에서는 중단 |
| 다른 요청 | 수정 20회/일, 기존 조회 API 20회/일 | 합계 **400 HTTP 요청/일**. 여러 화면이 각각 polling하지 않고 기기당 하나로 합침 |
| D1 쓰기 | 수정 한 번에 최대 10행으로 계산 | 객체·revision·변경 기록·중복 방지·인덱스 갱신 포함 예산 → **200행/일**. 실제 SQL의 `rows_written`으로 검증해야 함 |
| D1 읽기 | 인덱스를 쓴 각 조회·수정에서 최대 10행 수준, 여유 포함 | **4,000행/일** 가정. 전체 스캔·큰 초기 수신은 별도 |
| 저장·이력 | 원본+인덱스 등 1.2MB, 30일 변경 기록 0.6MB, 직전 스냅샷 0.6MB | **2.4MB/인**. 변경 기록은 20회 × 30일 × 평균 1KB. tombstone·권한 포함 여부는 실측 후 보정 |

스냅샷은 **보관함당 최대 1개**만 두는 첫 구성이다. 교체는 여유 쓰기 예산 안에서 변경된 보관함에 한정한다. 0.6MB 사본을 30개씩 보관하면 100명에서 그것만 1.8GB가 된다. 무료 D1 한 개에 매일 전체 백업 30벌을 쌓는 방식을 추천하지 않는다. D1 Time Travel 7일은 운영자 복구 수단이며 사용자별 복원 화면을 자동 제공하지 않는다.

### 7.2 추천안의 정상 사용량

월은 30일로 계산했다. 1차의 사용자당 요청·행 수·저장 가정은 그대로 두고 **§7.0의 랜드마크 몫**과 비교한다. DB 저장은 단일 D1의 500MB와 비교한다. 정적 파일 요청은 아래 HTTP 수에서 제외한다. 로그인·세션 관리·최초 업로드·예약 작업은 별도 여유 예산이 필요하다.

| 동기화 사용자 | HTTP 요청: 일 / 월 | D1 읽기 행: 일 / 월 | D1 쓰기 행: 일 / 월 | 저장 어림 | DB·요청 무료량 판단 |
|---|---|---|---|---|---|
| 1명 | 400 / 12,000 | 4,000 / 120,000 | 200 / 6,000 | 2.4MB | 앱 몫의 요청 0.8%·읽기 0.16%·쓰기 0.4%. 여유 있음 |
| 10명 | 4,000 / 120,000 | 40,000 / 1,200,000 | 2,000 / 60,000 | 24MB | 앱 몫의 요청 8%·읽기 1.6%·쓰기 4%. 개인+친구 규모에 적합 |
| 100명 | 40,000 / 1,200,000 | 400,000 / 12,000,000 | 20,000 / 600,000 | 240MB | 앱 몫의 **요청 80%**·읽기 16%·쓰기 40%. DB 크기는 한도 안이나 요청 경계에 닿아 운영 주의. 로그인·스파이크 여유 미보장 |

비교한 공식 한도: [Functions 요청](https://developers.cloudflare.com/pages/functions/pricing/), [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/), [D1 단일 DB 크기](https://developers.cloudflare.com/d1/platform/limits/) · 확인 2026-10-25.

소유자 수에 따른 Access 좌석 계산은 더 이상 사용하지 않는다. 소유자는 Firebase Auth Spark의 조건별 제한을 따르고 친구는 앱 자체 초대로 참여한다. **100명은 요청 예산의 80%를 이미 쓰므로 무료 운영을 보장할 수 없다.** 특히 가즈아의 증권사 프록시 트래픽이 얼마인지, 두 앱이 같은 계정인지, 현재 플랜이 실제로 Free인지 확인하지 않았다. 같은 계정이면서 다른 작업까지 있다면 양쪽 배정량을 더 낮춰야 한다.

Firebase 전체 대안의 참고 계산도 단위를 바꿔 따져야 한다. 예를 들어 1차의 360조회/일에 조회당 문서 1~10개를 읽으면 10명은 3,600~36,000문서/일, 100명은 36,000~360,000문서/일이다. Firestore 무료 50,000문서/일과 비교하면 100명에는 여유를 보장할 수 없다. 이는 단순 polling 어림이며 리스너는 최초 수신·변경·재연결·권한 평가에 따라 달라진다. D1의 행 수를 Firestore 문서 수에 그대로 대응시키지 않는다. [Firestore 한도](https://firebase.google.com/docs/firestore/quotas), [리스너](https://firebase.google.com/docs/firestore/query-data/listen) · 확인 2026-10-25.

### 7.3 첫 업로드·집중 사용·실시간의 별도 예산

| 상황 | 어림과 대응 |
|---|---|
| 최초 업로드 | 555개 객체 × 최대 10행 = 5,550쓰기/인. 100명이 같은 날 올리면 555,000행으로 초과. 1차의 신규 10명+정상 100명은 75,500행이어서 이제 앱 몫 50,000행을 넘음. **하루 신규 3명부터**: 20,000 + 3 × 5,550 = **36,650행**. 80% 운영선 40,000행까지 남은 3,350행에서 세션·스냅샷·정리를 감당하지 못하면 더 줄이거나 연기. 최초 읽기·HTTP·분할 증가도 별도 계산 |
| 짧은 조회 주기 | 같은 체류 시간에서 1초 조회로 줄이면 polling만 3,600요청/인/일. 100명이면 360,000으로 계정 전체·앱 배정량 모두 초과. 기본 10초·화면 활성 때만 조회·변경 없으면 간격 늘리기 |
| 약속 경로 계산 | 후보 8개 × 참석자 10명은 한 번 계산에 최대 80개 경로 조합. 모든 기기가 반복 계산하면 표의 기존 조회 20회를 크게 넘음. 입력별 캐시·요청 합치기·재계산 단추의 제한 필요 |
| 큰 보관함 병합 | 무료 CPU 10ms 안에 큰 JSON 파싱·전체 병합·검증이 끝나는지는 미확인. 작은 변경·분할 업로드로 제한하고 실제 환경 측정 후 결정. Google/Firebase 토큰 서명 검증도 포함 |
| DO WebSocket 후속 도입 | 요청 외에 실행 GB-s가 있다. 100명이 각각 하루 1시간 동안 DO를 계속 깨어 있게 만들면 `100 × 3,600 × 0.128` ≈ 46,080GB-s로 제품 무료 13,000/일뿐 아니라 앱 배정 6,500/일도 초과 가능. 이는 단순 상주 어림이며 실제 객체·격리 단위와 휴면에 따라 달라짐. Hibernation 사용과 측정 없이 무료라고 보장하지 않음 |
| 알림 메일 | 100명이 매일 로그인 메일 1통+확정 메일 1통을 받으면 200통/일·6,000통/월. Resend 무료 100/일·3,000/월을 넘음. **메일 없는 Google 로그인 + 앱 내 확정 표시**가 기본. Resend 결제 조건 미확인, Cloudflare 임의 발송 제외이므로 메일을 필수 구성으로 넣지 않음 |
| 만료 정리·백업 | Cron의 삭제·기록 쓰기와 스냅샷도 같은 한도를 소비. 정상량 외의 작업은 남은 예산 안에서 분할 |

DO 비교 근거: [요청·실행 요금과 휴면](https://developers.cloudflare.com/durable-objects/platform/pricing/). 이메일 비교 근거: [Resend 요금](https://resend.com/pricing) · 확인 2026-10-25.

### 7.4 앱별 자체 상한·관측·백업

- **한도 정책:** 각 앱은 자기 배정량의 50%에서 운영 화면 경고, 80%에서 polling 간격 확대·신규 대용량 업로드·스냅샷·자동 작업 지연, 배정 상한에 닿기 전 비필수 기능 중단을 제안한다. 랜드마크의 80% 선은 요청 40,000/일·읽기 200만/일·쓰기 40,000/일이다. 저장은 운영 DB 400MB부터 신규 대용량 연결을 보류한다. 이는 공식 무료량 변경이 아니라 앱 정책이다.
- **가즈아와 합산 관측:** 앱별 Worker/Pages 프로젝트·운영/시험 D1 DB·Cron·DO namespace를 식별하고 계정 대시보드와 각 제품 지표를 함께 본다. HTTP는 기존 API·인증·초대·polling별 집계, D1은 `meta.rows_read`·`rows_written`·DB 크기, 스냅샷/정리는 별도 작업 태그로 관측한다. 가즈아 증권사 프록시의 평시·최대 트래픽도 포함한다. 원좌표·메일·토큰은 지표에 넣지 않는다. [D1 관측](https://developers.cloudflare.com/d1/observability/metrics-analytics/), [Workers 지표](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) · 확인 2026-10-25.
- **상한의 한계:** 무료 플랜의 플랫폼 제한은 계정 단위이며 두 앱 사이의 예약·장애 격리를 제공하지 않는다. 이미 실행된 제한 응답도 Worker 요청을 소비하므로 앱의 429만으로 상대 앱 예산을 지킬 수 없다. 앱별 생성량·참석자·조회 주기 제한과 작업 중지 장치를 두되 관측 지연·거절 요청·카운터 갱신의 소비량까지 여유에 포함한다. 계정이 한도에 닿으면 로컬 자료·기존 공유·내보내기를 유지하고 재시도 폭주를 막는다. **Free 유지·Cloud Billing/유료 플랜 미연결**을 전제로 하며 기존 계정의 플랜·유료 구독 상태는 확인 필요다.
- **백업 기본:** D1 스냅샷은 보관함당 최대 1개·보관함별 스냅샷 총합 1MB 이하, 조각당 512KiB 이하라는 앱 상한을 제안한다. 큰 자료는 자동 스냅샷이 생략됐음을 표시하고 기존 수동 파일 백업을 안내한다. 예시 0.6MB는 1차의 2.4MB/인 안에 이미 포함돼 있으며 매일 30벌을 쌓지 않는다. 교체 쓰기·오래된 조각 삭제도 일 쓰기 예산에 포함한다. D1 Time Travel 7일과 같은 DB 사본은 독립 백업이 아니므로 **기존 수동 백업 파일을 계속 유지**한다. R2는 보관 후보에서 제외한다.
- **Google Drive 선택 검토:** 사용자가 자기 Drive에 수동 백업 파일을 옮기는 방식은 그대로 가능하다. API 연동을 원하면 `drive.appdata` scope의 숨김 `appDataFolder`를 선택 기능으로 검토한다. 앱만 접근하며 친구와 공유할 수 없고 사용자가 앱 데이터를 삭제할 수 있다. Google 로그인만으로 Drive 권한이 생기지 않으므로 추가 동의·액세스 토큰·보관 개수·복구 UI가 필요하다. 브라우저에서 사용자가 실행하는 백업부터 검토하고 서버의 상시 refresh token 보관은 초기 제외한다. API의 결제 등록 조건·사용자 저장 잔여량·변경된 과금 조건·추가 OAuth 검증은 **확인 필요**이므로 무료 자동 백업으로 확정하지 않는다. [appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata), [현재 API 사용·과금 조건](https://developers.google.com/workspace/drive/api/guides/limits) · 확인 2026-10-25.

## 8. 개인정보와 보안

### 8.1 무엇이 서버에 올라가는가

| 자료 | 위험 | 기본 제안 |
|---|---|---|
| 장소 좌표·개인 메모·방문 날짜·리뷰·라벨 | 집·직장·취향·생활 패턴을 추정할 수 있음 | 개인 보관함은 본인만. 공유에는 선택한 필드만 |
| 여행 날짜·출발지·숙소·진행 상태 | 부재 일정과 이동 계획 노출 | 명시 초대한 사람만. 공개 검색·검색 엔진 노출 없음 |
| 약속 이름·출발지·투표 | 참석 관계와 생활 위치 노출 | 원좌표는 본인·주최자 중심. 정확한 주소 대신 출발역 입력 권장 |
| 로그인 식별자·초대·기기 기록 | 계정·자료 연결과 권한 탈취 | 내부 사용자 id 분리, 토큰 해시 저장, 최소 로그 |
| 브라우저 현재 위치 | 실시간 추적 위험 | **서버 저장하지 않음**. 진행 공유에 GPS는 필요하지 않음 |

일반 서버 저장은 운영자가 DB를 읽을 수 있는 구조다. 종단간 암호화는 이번 추천에 포함하지 않는다. 이를 원하면 서버 집계·검색·복구와의 절충을 별도 설계해야 한다.

### 8.2 공개 저장소에서의 경계

- 비밀값은 Cloudflare 대시보드 시크릿 또는 Wrangler secret 기능으로 넣는다. 공개 저장소에는 바인딩 이름·스키마·비밀값 없는 설정만 둔다. 프론트 번들에 들어가는 `VITE_*` 변수에는 DB 관리자 권한·서명 비밀·메일 발송 키를 넣지 않는다. [Workers 시크릿](https://developers.cloudflare.com/workers/configuration/secrets/) · 확인 2026-10-25.
- 개발·Preview와 운영의 DB·시크릿을 분리한다. 공개 PR의 미리보기 앱이 운영 사용자 자료를 읽게 하지 않는다. 기존 출처 허용 정규식이 Preview를 허용한다는 이유로 운영 쓰기 권한까지 주지 않는다.
- 모든 읽기·쓰기에 객체별 권한을 검사한다. 소유자는 공유·철회·확정, 편집자는 허용된 여행 수정, 참석자는 자기 응답, 보기 권한은 조회만 가능하게 한다. 본문에서 보낸 `ownerId`는 증거가 아니다.
- `src/server/http.ts:39`의 허용 출처 검사는 유지할 가치가 있지만 인증이 아니다. 비브라우저 요청은 헤더를 만들 수 있다. 쿠키 인증의 쓰기는 CSRF 방어와 출처 검사를 더하고, 세션에는 `HttpOnly`·`Secure`·적절한 `SameSite`를 적용한다.
- 기본 Pages 주소·Preview·Worker 직접 주소를 포함해 **모든 비공개 API 자체에서 D1 세션과 객체 권한을 검사**한다. 로그인 교환 때는 Firebase 공개키·고정 프로젝트 aud/iss·만료를 검증한다. 직접 GIS를 선택하면 Google JWKS·랜드마크 client aud·Google iss·만료 검증으로 대체한다. 서로 다른 종류의 토큰·다른 앱 토큰을 받아들이지 않는다. JWT decode·이메일 헤더만으로 인증하지 않는다. GIS POST 방식의 double-submit CSRF 검사와 선택한 Firebase 로그인 흐름의 요청 위조 방어를 적용한다. 외부 토큰·세션 원문은 로그·URL·백업에 넣지 않고, 앱의 철회·차단 상태를 별도로 확인한다. [Google 검증](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Firebase 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens) · 확인 2026-10-25.
- 초대·편집 권한에는 충분히 긴 암호학적 무작위 값을 쓴다. 공개 식별자만 알아서는 편집할 수 없게 한다. DB에는 토큰 원문 대신 해시를 두고 만료·범위·철회를 검사한다. 링크 토큰은 가능하면 URL 해시로 전달한 뒤 HTTPS 요청 본문으로 교환해 로그·Referer 노출을 줄인다.
- 개인 API·초대·투표 응답은 `private, no-store`로 취급한다. 기존 네이버 조회용 공유 Cache API에 넣지 않는다. 서버 링크 조회 때마다 만료·철회를 검사하고, 마지막으로 받은 사본에는 조회 시각을 보인다.
- 가입·익명 생성·초대 수락에는 Turnstile을 붙일 수 있다. IP·세션·약속별 속도 제한, 요청 본문 크기, 일별 생성량, 최대 참석자·후보 수를 함께 제한한다. DB 행 수와 인덱스 비용도 남용 지표에 포함한다.
- WebSocket도 최초 연결과 쓰기 권한을 검사한다. 철회된 연결은 끊고 이후 변경 전송을 멈춘다. D1에 저장한 뒤 알림 전달이 실패해도 재조회로 복구해야 한다.

### 8.3 삭제·내보내기·보관 기간

제안 기본값은 약속 종료 뒤 출발지 30일, 일반 변경 기록 30일, 만료 공유 자료 정리 유예 30일, tombstone 90일이다. 이는 서비스의 공식 정책이 아니라 사용자가 정할 **앱 정책 초안**이다. 개인 보관함은 사용자가 삭제하거나 동기화를 해제해 서버 삭제를 선택할 때까지 유지한다.

삭제는 서버 현재 자료·초대·활성 세션·파생 캐시를 함께 처리한다. 백업과 Time Travel에서 언제 완전히 사라지는지도 안내한다. 삭제 요청 뒤 백업을 복원하더라도 삭제를 재적용할 수 있는 최소 기록을 분리한다. 감사 로그에는 좌표·메모·토큰 원문을 남기지 않는다. 내보내기는 로그인된 본인 또는 권한 있는 여행·약속 범위에 한정한다.

동기화 해제, 로그아웃, 계정 삭제, 공동 여행 탈퇴는 다른 동작이다. 공동 여행에서 소유자가 나갈 때는 소유권 이전 또는 전체 삭제를 선택해야 한다. 서버 삭제만으로 다른 사람 기기의 이미 받은 사본이 없어지는 것은 아니다.

## 9. 단계별 로드맵과 롤백

전체를 한 번에 전환하지 않는다. 각 단계는 그 상태로 운영해도 쓸모가 있어야 한다. 아래는 **후속 구현의 승인 조건**이며 이번 작업에서 실행하지 않았다.

| 단계 | 혼자서도 얻는 이점·범위 | 저장 형식 변화 제안 | 롤백·호환 | 첫 로딩 영향 |
|---|---|---|---|---|
| 1. 약속 온라인 집계 | 주최자가 어느 기기에서든 집계를 보고, 친구 답장을 자동 수집. 짧은 약속 링크·만료·철회 포함 | D1에 약속·참석자 응답·초대·권한 v1. 로컬 보관함 schema 2 유지. 온라인 id·연결 메타는 별도 저장 | 서버 기능 입구를 끄고 기존 `/meet#…` 방식 사용. 서버 자료는 지우지 않고 호환 로컬 사본을 내려받기. 서버 전용 링크는 기존 해시로 저절로 바뀌지 않으므로 호환 조회 화면 유지 | 약속 화면에서만 클라이언트·인증 흐름 로드. 첫 보관함 화면에 SDK 넣지 않기. 소유자만 Firebase Auth 지연 로딩 |
| 2A. 여행 갱신 공유 | 혼자 계획해도 친구는 같은 짧은 링크로 최신본 확인 | D1 공유 여행·필요 장소 사본·보기 권한. 개인 보관함은 그대로 | 마지막 공개 revision을 HTML·기존 여행 형식으로 내보내기. 공유 편집을 끄고 읽기 화면 유지 | 공유 창·공유 여행 경로에서만 로드 |
| 2B. 여행 함께 편집·당일 진행 | 보기/편집 초대, 공동 진행 체크. 새로 고침 없이 갱신은 필요할 때 추가 | 서버 여행에 안정적인 Day·Stop id·revision·별도 진행 자료. 로컬 schema 2에는 호환 일정만 투영. 협업 메타는 별도 형식 | 공동 쓰기 중지→마지막 확정본 내보내기→개인 여행 사본으로 사용. 옛 앱은 협업 권한·진행·이력을 이해하지 못함. 별도 자료까지 유지하려면 별도 내보내기 필요 | 협업·WebSocket 코드는 여행/당일 경로에서만. 개인 당일 `visitedOn`과 구분 |
| 3. 전체 보관함 기기 동기화 | PC·휴대폰에서 같은 개인 자료 사용 | 로컬 schema 2 유지 + sync 프로토콜 v1·큐·커서·기기 기록. 서버는 항목별 저장. 저장소를 바꾸면 별도 마이그레이션 | 업로드 중지→양쪽 백업 확보→정상 로컬 사본 확정. 큐·커서 보존. 구버전은 서버 쓰기를 못 하게 차단하고 돌아오면 차분 비교 | 연결을 켠 사용자만 첫 화면 표시 후 동적 import. 비연결 사용자는 네트워크 동기화 코드 받지 않기 |
| 4. 자동 백업·예약 작업·앱 내 알림 | 직전 상태 복구·폴더 변경 표시. Drive는 선택 기능 검토 | D1 소형 스냅샷 최대 1개/보관함·크기 제한(§7.4), 기존 수동 파일, 배정량 안의 Cron. R2·임의 메일 제외. Drive API는 결제·권한 조건 확인 전 보류 | 먼저 Cron·자동 쓰기 중지. 기존 사본은 보관 기간까지 유지. 로컬 수동 백업은 계속 사용 | 설정·복원 화면에서만 추가 UI, Drive 인증은 선택 후 로드 |

즉시 갱신을 도입할 때도 D1을 원본으로 유지한다. D1 트랜잭션에서 변경과 전달 대기 기록을 함께 남기고, 커밋 뒤 DO가 “새 revision 있음”을 전달한다. DO 알림이 빠지면 다음 조회·재연결에서 D1 커서로 복구한다. **D1과 DO SQLite에 같은 원본을 이중 저장하는 설계는 초기 추천에서 제외**한다. 별도 DO Worker와 예약 Worker가 필요하다는 운영 증가는 각 단계에서 판단한다. [Pages의 DO 바인딩 제약](https://developers.cloudflare.com/pages/functions/bindings/), [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · 확인 2026-10-25.

### 9.1 기존 롤백 관례를 적용하는 방법

현재 관례는 버전별 표에 데이터 영향을 적고, 모르는 선택 필드를 옛 앱이 읽을 때 버리는 점과 **옛 앱에서 저장하면 그 필드가 사라지는 점**을 구분하는 것이다(`docs/rollback.md:39`, `docs/rollback.md:51`). v0.15.0의 `meetings`가 대표 사례다. 백업은 원문을 보존하지만 옛 앱의 재저장은 그렇지 않다(`src/domain/backup/build-backup.ts:6`).

후속 구현 때는 다음을 배포 조건으로 삼는다.

1. 개인 보관함 schema, 백업 봉투, 온라인 공유 형식, 동기화 프로토콜, 서버 DB migration을 **별도 버전**으로 관리한다. schema 2를 유지했다고 서버 호환까지 유지되는 것은 아니다.
2. 우선 추가형 DB 변경과 호환 읽기를 배포한다. 옛 클라이언트가 이해하지 못하는 필드를 전체 문서 교체로 지우지 못하게 한다. 서버가 받는 최소 프로토콜보다 오래된 앱은 업로드를 중지한다.
3. 롤백 전 서버 쓰기·크론·알림을 멈추고 서버 스냅샷과 로컬 백업을 확보한다. 프론트 배포를 되돌리는 것과 DB를 되돌리는 것은 별도 작업이다. 서비스 기능 플래그만으로도 읽기 사본에 접근할 수 있게 한다.
4. DB를 과거로 복구하면, 복구 이전 커서를 가진 기기가 변경을 놓치지 않도록 서버 세대 번호를 바꾸고 전체 재동기화를 요구한다. 백업 복구로 삭제 자료·초대 권한이 되살아나지 않게 삭제·철회 기록도 재적용한다.
5. 새 코드로 복귀할 때 자동 업로드를 바로 재개하지 않는다. 로컬 최신본과 서버 복구본의 차이를 확인한 뒤 재개한다. 파괴적 컬럼 삭제는 지원 구버전이 없어질 때까지 미룬다.
6. 구현 세션에서만 `docs/rollback.md`에 새 버전의 형식·구버전 저장 영향·서버 링크 가용성·DB 복구 절차를 기록한다. **이번 제안 작성에서는 해당 파일을 수정하지 않는다.**

### 9.2 첫 로딩 예산

- 확인한 상한은 `perf-budget.json:2`의 **327,680바이트**다. 이 파일의 측정 메모는 2026-10-16의 309,312바이트다. 현재 버전 측정값으로 취급하지 않는다.
- 저장소 문서의 최근 수치는 `docs/superpowers/plans/2026-10-23-label-emoji.md:30`의 315,142바이트다.
- 최신 측정은 `v0.16.0`을 만든 [sch0718/landmark#52](https://github.com/sch0718/landmark/pull/52) 본문의 **316,614바이트**(지도 키 포함, 예산 327,680바이트)다. 남은 여유는 **약 11,066바이트(약 10.8KiB)** 뿐이다. 이번에는 빌드·측정을 다시 실행하지 않았다.
- 여유가 이만큼 작으므로 서버 연동 코드가 첫 청크에 조금만 들어와도 예산을 넘을 수 있다. 아래 지연 로딩 원칙은 선택이 아니라 필수 조건으로 본다.
- 인증·동기화·협업 SDK를 앱 진입점이나 공용 barrel에서 정적으로 가져오지 않는다. 서버 연결을 켰을 때 또는 약속·여행 경로에 들어갔을 때 동적으로 받는다. 동기화 사용자는 화면을 먼저 보여 준 뒤 연결을 시작하되 사용자가 저장한 변경은 누락 없이 대기시킨다.
- 목표는 첫 진입 증가를 최소화하고 기존 327,680바이트 상한을 유지하는 것이다. “서버 코드는 프론트 크기가 0” 또는 “lazy라 증가가 0”이라고 단정하지 않는다. 후속 구현에서 실제 지도 코드 포함 조건으로 초기 청크·공유 청크·SDK의 유입을 확인하고 기존 `build:ci`의 lazy 검사를 확장한다(`package.json:31`, `docs/ui-performance.md:373`).

### 9.3 단계별 완료 조건 제안

| 단계 | 후속 구현에서 확인할 것 |
|---|---|
| 약속 집계 | 서로 다른 두 기기의 답장, 재시도 중복, 참석자 사칭 방지, 만료·철회, 서버 장애 때 초안 유지 |
| 여행 편집 | 같은 Day 순서 충돌, 다른 항목 수정 공존, 장소 참조·날짜 검증, 보기 권한의 쓰기 차단, 개인 메모 비노출 |
| 보관함 동기화 | 기기 시계 오차, 삭제·복원·장기 오프라인 재연결, 최초 합치기, 계정 전환, 큐 중간 중단, 용량 초과 |
| 복구·운영 | 구버전으로 저장했을 때의 영향, 서버 과거 복구 후 커서 재설정, 삭제 재적용, 무료 CPU·요청·행 수 실측, 번들 예산 |

## 10. 사용자가 결정할 질문

이미 정해진 두 원칙과 새로 고를 항목을 구분한다. 미결 항목은 이번 문서 수정의 진행 조건이나 구현 승인이 아니다.

| 질문·상태 | 선택지 | 추천과 이유 |
|---|---|---|
| **결정됨: Supabase 제외** | 사용자 결정(2026-10-25) | 재선택 질문으로 돌리지 않음 |
| **결정됨: 결제 등록 없는 서비스만** | 무료 하드캡 우선(2026-10-25) | R2·Access·임의 Cloudflare 메일·Oracle 신규 가입·Fly.io 계속 운영 제외. 조건 미확인은 도입 보류 |
| 처음 해결할 불편은? | 약속 자동 집계 / 여행 함께 편집 / 전체 기기 동기화 | **약속 자동 집계**. 작게 시작해도 수동 반영이 바로 없어짐 |
| DB는 어디에 둘까? | Cloudflare D1 / Firebase Spark + Firestore + Auth | **D1**. 기존 배포·SQL 이전 편의. 실시간 리스너·규칙 중심 개발을 우선하면 Firebase 대안 |
| 누구의 자료를 올릴까? | 선택한 약속·여행만 / 보관함 전체 / 항상 로컬만 | **선택 공유부터**. 전체 동기화는 나중에 본인이 켬 |
| 소유자 로그인은? | Firebase Auth Spark의 Google 신원 + D1 세션 / 직접 GIS / 비밀 키+기기 연결 / 직접 패스키 | **초기 Firebase Auth로 신원만 확인**. 친구 가입은 요구하지 않음. 직접 GIS는 OAuth 클라이언트 결제 조건 확인 뒤 재판단 |
| 친구 편집 권한은? | 전달 가능한 공통 편집 링크 / 1회 초대 후 개별 권한 / 계정 필수 | **1회 초대 후 개별 권한**. 가입 부담과 철회 가능성의 균형 |
| 공유 범위는? | 링크 소지자 열람 / 초대한 사람만 / 공개 검색 가능 | **초대한 사람만**을 기본, 보기 전용 링크는 명시 선택. 공개 검색은 필요성 작음 |
| 출발지는 누구에게 보일까? | 전원 정확한 좌표 / 본인·주최자만 / 출발역만 | **본인·주최자만 원좌표**, 다른 참석자에게는 소요시간·동의한 역 이름 |
| 갱신 속도는? | 10초 안팎 자동 갱신 / 즉시 WebSocket | **처음 10초**. 유용성을 먼저 확인한 뒤 즉시 전달 비용·복잡성 판단 |
| 공동 여행에서 충돌하면? | 마지막 변경 자동 승리 / 충돌 사본 비교 / 편집 잠금 | **단순 필드 병합 + 순서 충돌 비교**. 조용한 유실 방지 |
| 같은 계정의 예산 배분은? | 같은 계정 여부·가즈아 프록시 사용량 확인 후 절반 배분 / 사용량에 맞춰 더 작게 | **§7의 절반은 초안**. 랜드마크 50,000요청·250만 읽기·50,000쓰기/일 이내, 80%에서 자동 작업 지연 |
| 백업 범위는? | D1 제한 스냅샷+수동 파일 / 자기 Drive API 선택 연동 | **스냅샷 최대 1개+수동 파일**. Drive는 결제 조건·추가 권한 확인 전 보류 |
| 보관 기간은? | 출발지 30일·이력 30일·tombstone 90일 / 더 짧게 / 무기한 | **첫 선택지**. 장기 오프라인 재연결은 전체 재동기화로 처리 |
| 확정 알림은? | 앱 안에서만 / 추후 Web Push·결제 등록 없는 메일 별도 검토 | **앱 안에서 먼저**. 매직 링크·임의 수신자 메일은 초기 제외 |
| 서버 운영자가 내용을 읽을 수 있어도 될까? | 일반 서버 저장 / 종단간 암호화 필요 / 로컬만 | **선택 공유의 일반 서버 저장**. 전체 동기화 전에 다시 확인. 암호화 요구가 있으면 별도 설계 |

## 11. 작성 과정

### 1차 실행 및 사실 대조

- 작성 모델: **Codex gpt-6.1-sol, reasoning high**.
- 작성·공식 자료 확인 날짜: **2026-10-25**.
- 확인 방법: 작업 디렉터리의 코드·문서를 직접 열어 줄 번호를 확인했다. 무료 조건은 웹 검색 도구로 공식 문서·요금 페이지를 조사했다. 블로그·비공식 비교 글은 수치 근거로 사용하지 않았다.
- 작업 범위: 이 Markdown 파일만 새로 작성했다. git 명령, 코드·설정 수정, 빌드·테스트, 개발 서버 실행, 계정 가입·결제·키 생성은 하지 않았다. 개인 백업·개인 브라우저 데이터는 찾거나 읽지 않았다.
- 사실 대조: 커밋한 세션(Claude Opus 5.5)이 같은 날 공식 문서에서 D1·DO·KV·Workers/Pages Functions·R2·Turnstile·Access PIN·Email Service·Supabase(요금·Realtime·SMTP)·Firebase(요금·Auth 한도·리전)·Turso·Fly.io·Oracle·Resend 수치를 다시 열어 표의 값과 맞췄다(불일치 없음). 코드 근거 줄 번호도 다시 열어 확인했다. 고친 것은 기준 커밋 관계(§2.2)와 첫 로딩 측정값 출처(§9.2, PR #52 본문)뿐이다.
- 해석 기준: `확인함`은 파일·공식 자료에 적힌 내용, `어림`은 명시한 가정에 따른 계산, `확인 필요`는 이번 조사로 확정하지 못한 항목이다. 무료 조건은 변경될 수 있으므로 실제 도입 직전에 다시 확인한다.

### 2차 실행 — 2026-10-25

- 제안서를 끝까지 읽고 사용자 결정에 따라 §1·§3·§4·§6·§7·§8·§9·§10·§11을 수정했다. §2의 코드 사실·수치, §5의 동기화 모델, 1차의 사실 대조 문단과 무관한 한도·측정값은 유지했다.
- Supabase를 비교표의 제외 한 줄로 줄이고 대안을 Firebase Spark + Firestore + Auth로 재선정했다. R2 보관·Access PIN·임의 Cloudflare 메일을 구성에서 뺐고, Oracle 가입 카드 조건·Fly.io 계속 운영 결제 조건을 반영했다. 후보 표에 결제 등록 필요 여부를 추가했다.
- 직접 GIS·Firebase Auth 신원 전용·비밀 키/기기 연결·패스키를 비교했다. 직접 Google OAuth 생성의 결제 불필요를 공식 문구로 확정하지 못해 확인 필요로 두고, 초기 로그인은 결제 불필요가 명시된 Firebase Auth Spark의 Google 신원 + D1 세션으로 제안했다. Google의 시험 범위와 브랜드 검증·민감 scope 검증을 구분했다.
- 같은 계정일 때 Workers/Functions·D1 일 행 수·저장·DB 수·Cron·Turnstile 공유를 공식 문서로 확인했다. §7에 절반 배정·앱별 관측·상한을 추가하고, 기존 사용량 가정은 유지한 채 100명 시나리오와 최초 업로드 속도를 재평가했다. DO 저장·클래스는 계정 범위를 확인했지만 요청·실행·행 수의 합산 범위 명시는 추가 확인 대상으로 남겼다.
- 새로 확인한 출처: Zero Trust 조직 생성의 현재 공식 경로, Workers·D1·DO·Turnstile의 결제 조건, Firebase Spark 결제·Google/익명 인증·ID 토큰 검증·모듈형 SDK, Google GIS 설정·토큰 검증·앱 상태·브랜드 검증·billing 권고, 패스키 검증, R2 checkout·결제 정책, Oracle 가입·Fly.io 체험 종료, D1/Workers 지표, Drive appDataFolder·API 사용 조건이다. 아래 URL 목록의 관련 행에 추가했다. 모두 확인일은 **2026-10-25**다.
- 확인 못 한 항목: 두 앱의 실제 계정 일치·잔여량·현재 유료 구독, 직접 Google OAuth 클라이언트의 결제 등록 불필요 명시, DO/KV 일부 집계 범위, Resend·Drive API 활성화의 결제 조건, 실제 SDK 크기·무료 CPU·로그인 및 복구 UX. 아래 미확인 표에 유지·갱신했다.
- 2차 사실 대조(커밋 세션, Claude Opus 5.5): Zero Trust Free의 결제 정보 입력 단계, Firebase Spark의 결제 정보 불필요·한도 초과 시 과금 대신 중단, Oracle 신규 가입의 카드 확인(“most users”), D1 일 한도의 계정 단위 적용(FAQ), Google OAuth Testing 100명 상한과 기본 scope 예외를 공식 문서에서 다시 열어 본문과 맞췄다(불일치 없음). 문서의 외부 링크 57개가 모두 200으로 열리는 것도 확인했다.
- 범위 검증: 이 파일만 수정했다. git 명령·구현·코드/설정/다른 문서 수정·빌드/앱 테스트·서버 실행·계정 가입/결제/키 생성은 하지 않았다. 문서 원본과 비교해 지정한 변경과 보존 항목을 점검했다.

### 확인한 공식 출처 URL 목록

모든 항목의 확인일은 **2026-10-25**다. 같은 출처를 표와 본문에서 다시 사용한 경우 여기에는 한 번만 적었다.

| 구분 | 공식 출처 |
|---|---|
| Cloudflare D1 | [요금](https://developers.cloudflare.com/d1/platform/pricing/), [제한·Time Travel](https://developers.cloudflare.com/d1/platform/limits/), [데이터 위치](https://developers.cloudflare.com/d1/configuration/data-location/) |
| Cloudflare KV | [요금](https://developers.cloudflare.com/kv/platform/pricing/), [일관성·작동 방식](https://developers.cloudflare.com/kv/concepts/how-kv-works/) |
| Cloudflare Durable Objects | [요금·Free SQLite](https://developers.cloudflare.com/durable-objects/platform/pricing/), [제한](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Cloudflare R2(제외 근거) | [요금·무료량](https://developers.cloudflare.com/r2/pricing/), [구독 checkout](https://developers.cloudflare.com/r2/get-started/), [결제 정책](https://developers.cloudflare.com/billing/understand/billing-policy/) |
| Cloudflare Workers·Pages | [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/), [Functions 요금](https://developers.cloudflare.com/pages/functions/pricing/), [Functions 바인딩](https://developers.cloudflare.com/pages/functions/bindings/), [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [시크릿](https://developers.cloudflare.com/workers/configuration/secrets/), [Workers 결제 조건](https://www.cloudflare.com/products/workers/), [D1 결제 조건](https://www.cloudflare.com/products/d1/), [DO 결제 조건](https://www.cloudflare.com/products/durable-objects/), [Workers 지표](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [D1 지표](https://developers.cloudflare.com/d1/observability/metrics-analytics/) |
| Cloudflare 인증·남용 방지 | [Access 제외: 조직 생성 결제 단계](https://developers.cloudflare.com/learning-paths/clientless-access/initial-setup/create-zero-trust-org/), [Turnstile 플랜](https://developers.cloudflare.com/turnstile/plans/), [Turnstile 결제 조건](https://www.cloudflare.com/products/turnstile/) |
| Cloudflare 이메일·네트워크 | [Email Service 요금](https://developers.cloudflare.com/email-service/platform/pricing/), [네트워크 위치](https://www.cloudflare.com/network/) |
| Firebase | [Firestore 한도](https://firebase.google.com/docs/firestore/quotas), [Auth 한도](https://firebase.google.com/docs/auth/limits), [Firestore 리전](https://firebase.google.com/docs/firestore/locations), [실시간 리스너](https://firebase.google.com/docs/firestore/query-data/listen), [Spark 결제 조건](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Google 로그인](https://firebase.google.com/docs/auth/web/google-signin), [익명 인증](https://firebase.google.com/docs/auth/web/anonymous-auth), [ID 토큰 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [모듈형 SDK](https://firebase.google.com/docs/web/learn-more#modular-version) |
| Google 로그인·패스키 | [GIS 설정](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [Google ID 토큰 검증](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Auth Platform billing 설명](https://support.google.com/cloud/answer/15548748?hl=en), [OAuth 앱 상태](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [브랜드 검증·운영 정책](https://developers.google.com/identity/verification/authentication-policy-compliance), [패스키 서버 검증](https://developers.google.com/identity/passkeys/developer-guides/server-authentication) |
| Google Drive 선택 기능 | [appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata), [API 사용·과금 조건](https://developers.google.com/workspace/drive/api/guides/limits) |
| Turso | [요금](https://turso.tech/pricing?frequency=monthly), [소개](https://docs.turso.tech/introduction), [SDK 인증](https://docs.turso.tech/sdk/authentication) |
| PocketBase | [공식 문서: SQLite·인증·실시간·호환성](https://pocketbase.io/docs/) |
| 자체 호스팅 조건 | [Fly.io 체험](https://docs.fly.io/about/free-trial), [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Oracle 가입 카드 조건](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm) |
| 별도 이메일 | [Resend 요금](https://resend.com/pricing) |

### 확인 못 한 항목

| 항목 | 이번 판단과 후속 확인 |
|---|---|
| 두 앱의 계정 일치·현재 플랜·잔여량·실제 데이터 크기 | 같은 Cloudflare 계정인지는 확인 필요. 가즈아 증권사 프록시·랜드마크 기존 API·다른 앱/시험/관리 작업의 합산량과 기존 유료 구독 미확인. 절반 배정은 예약 보장이 아닌 운영 초안 |
| 한국 실제 지연 | 모든 후보 미측정. 확인된 서울·도쿄 리전·엣지 유무와 DB 위치 보장 여부만 구분 |
| Cloudflare 자동 휴면 정책의 전체 조건 | D1·KV 조사 문서에서 정기 휴면 중단 규정을 확인하지 못함. 중단이 절대 없다고 보장하지 않음 |
| DO Free 객체당 저장·동시 연결 상한 | 한도 문서의 10GB 표와 Free 1GB 설명이 달라 재확인. 연결 수의 Free 적용 상한도 확인 필요. 초기 원본 저장·무료 계산에는 DO를 넣지 않음 |
| 직접 Google OAuth 클라이언트의 결제 조건 | 설정 문서에 결제 단계가 없고 billing은 권고라고 설명하지만 결제 불필요를 명시한 공식 문구는 미확보. 확인 전 직접 GIS 도입 보류, Firebase Auth Spark 신원 전용을 기준으로 제안 |
| DO·KV의 일부 계정 합산 범위 | DO 저장·클래스는 계정 단위 확인. DO 요청·실행·행 수 및 KV 각 일 사용량의 합산 범위 명시는 추가 확인 필요. 서비스별 무료량 전체를 앱마다 중복 배정하지 않음 |
| Resend·Google Drive API의 결제 등록 조건 | 무료량 또는 기능 설명만으로 활성화의 결제 불필요를 확정하지 않음. Drive는 현재 API 사용·과금 정책·추가 scope·사용자 저장 용량도 확인 후 선택 |
| Firebase 휴면·Auth 조건별 상한 | Firestore의 짧은 비활성 일시정지 정책, 기본 Auth와 Identity Platform 구분, 선택 로그인 제공자별 조건, 실시간 동시 연결 무료 적용값 추가 확인 |
| Turso 리전·휴면·실시간 구독 | 가격 수치는 확인. 시도한 공식 리전 경로에서 본문을 확보하지 못해 서울·도쿄 생성 가능 여부는 확인 필요. 휴면 정책과 앱 변경 구독 보장은 확정하지 않음 |
| PocketBase 무료 호스트의 실제 확보 가능성 | Oracle 홈 리전의 서울·도쿄 무료 용량 미확인. 신규 가입 카드 확인·Fly.io 체험 후 결제 필요를 확인해 둘 다 운영 후보에서 제외. 다른 호스트는 결제 조건 확인 전 보류 |
| 무료 CPU·행 사용량·초대 UX | 큰 보관함 파싱·병합, Firebase/GIS 검증 CPU·SDK 실제 gzip 크기, 동의 화면·다중 도메인 자체 세션·기기 복구·초대 교환·DO 휴면은 후속 구현 때 실측·검증 필요 |
| 네이버 자동 재확인 운영 적합성 | 비공식 API의 지속 사용 허용 범위·안정성·빈도 기준 확인 필요. DB 도입만으로 공식 API나 SLA가 생기지 않음 |

