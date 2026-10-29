# 개발 문서

랜드마크를 고치거나 배포하는 사람을 위한 문서입니다. 서비스 소개와 사용법은 [README](../README.md)와 [도움말](help/README.md)에 있습니다.

- 수동 확인·첫 배포 체크리스트: [checklists.md](checklists.md)
- 버전별 되돌리기와 데이터 호환: [rollback.md](rollback.md)
- 변경 내역: [GitHub Releases](https://github.com/sch0718/landmark/releases)

## 저장소 이력

2026-10-11 저장소를 `sch0718/trip-map`에서 `sch0718/landmark`로 옮기며 이름을 바꿨습니다(옛 이름 trip-map). 기존 데이터와 이미 보낸 공유 파일이 계속 동작하도록 저장 키(`tripmap:*`)와 공유 파일 형식(`tripmap-share`)은 그대로 둡니다. 예전 landmark 저장소의 내용은 `archive/java-gradle-2025`(Java 코드), `archive/map-pages-2026-10`(이전 직전의 지도 페이지) 브랜치에 있습니다.

## 구조와 기술

- 로그인은 없습니다. 보관함은 **각 기기 브라우저의 localStorage**(`tripmap:library:v2`)에 저장되고, 화면 설정은 `tripmap:prefs`에 저장됩니다. 새 약속은 공유할 때 Cloudflare D1에 사본을 올려 친구 답장을 자동 집계합니다. 저장소를 쓸 수 없는 환경(예: 일부 사생활 보호 모드)에서는 메모리 모드로 동작하며 배너로 알립니다.
- 옛 버전(정적 여행 뷰어)의 여행은 `/t/<publicId>`에서 **미리보기 → 결정 → 가져오기**로 새 보관함에 옮깁니다. 옛 편집 레이어(`tripmap:edit:<publicId>`)는 읽기만 하고 지우지 않습니다.
- 앱은 Effect 4 기반입니다(`effect`·`@effect/vitest` 4.0.2 고정).
- 설계 문서(`docs/superpowers/specs/`, 계획은 `docs/superpowers/plans/`). 충돌하면 나중 문서가 우선합니다.
  - 기반·보관함 `2026-10-08-place-library-design.md`, 장소 추가 `2026-10-12-place-adding-design.md`, 여행 계획 `2026-10-12-trip-planning-design.md`
  - 공유: HTML 내보내기 `2026-10-11-html-share-export-design.md`, 가져오기 `2026-10-13-share-import-design.md`, 일정 공유 `2026-10-16-trip-share-design.md`, 링크 공유 `2026-10-22-share-link-design.md`
  - 다듬기: 결함·코드 정리 `2026-10-13-polish-cleanup-design.md`, 첫 로딩 `2026-10-13-first-load-design.md`, 디자인 QA `2026-10-14-design-qa-design.md`
  - F 묶음(개요 `2026-10-16-f-series-overview.md`): 백업·복원, 다녀온 곳·한 줄 평, 폴더 다시 가져오기, 내 근처, 당일 모드, 영업시간(`2026-10-16-*-design.md`)
  - 사용성 개선: 선택·거르기·툴팁 `2026-10-18-selection-filter-tooltip-design.md`, 휴대폰 시트·라벨 고르기 `2026-10-18-mobile-sheet-label-picker-design.md`, 많은 장소 `2026-10-22-large-library-design.md`, 라벨 이모지 `2026-10-23-label-emoji-design.md`·`2026-10-23-label-emoji-only-design.md`
  - 약속장소 `2026-10-23-meeting-place-design.md`, 온라인 집계 `2026-10-25-meeting-online-design.md`
  - 옛 설계: `2026-10-03-trip-map-design.md`

## 설치

### Node 요구 사항

- **Node 24** (`.nvmrc` = `24`). `nvm use`로 맞춥니다.
- 패키지 매니저는 Yarn 1(`packageManager: yarn@1.22.22`).
- 일부 개발 의존성의 `engines`가 `package.json`의 `engines.node`(`>=22`)보다 좁습니다.
  - jsdom 30: `^22.22.2 || ^24.15.0 || >=26`, @babel/core 8: `^22.18.0 || >=24.11.0`
  - 그래서 Node 24.1 같은 이른 마이너 버전에서는 `yarn install`이 engines 오류로 멈춥니다(2026-10-04 확인: 24.1.0에서 실패).
  - 그래서 저장소 루트의 `.yarnrc`에 `ignore-engines true`를 두었습니다. 로컬·CI·Cloudflare Pages 모두 플래그 없이 `yarn install`이 됩니다.

```bash
nvm use                         # Node 24
yarn install --frozen-lockfile  # .yarnrc의 ignore-engines가 적용된다
```

### 공용 패키지(GitHub Packages)

공용 코드는 `sch0718/sch0718-toolkit-web` 저장소의 `packages/<이름>`에서 GitHub Packages의 비공개 npm 패키지로 받으며, 정확한 버전으로 고정해 씁니다.

| 패키지 | 버전 | 쓰는 곳 |
| --- | --- | --- |
| `@sch0718/kakao-share` | `0.1.1` | 카카오톡 공유(`src/sections/share-export/kakao.ts`) |
| `@sch0718/seen-store` | `0.1.0` | 처음 안내 기록(`src/services/help-seen.ts`). 기기 키 `tripmap:help-seen:v1`을 그대로 넘겨 기존 기록을 이어 씁니다 |
| `@sch0718/firebase-session` | `0.2.1` | 보관함 동기화 로그인·기기 세션(`src/server/library-sync/`, `src/services/library-sync/`) |
| `@sch0718/motion-kit` | `0.1.0`(devDependency) | 움직이는 그림 생성기(`scripts/motion/`, 아래) |

`.npmrc`는 `@sch0718/*`만 GitHub Packages에서 받도록 합니다.

README·도움말의 움직이는 그림 생성기(`yarn build:motion`)의 기반 함수(`at`·`text`·`textWidth`·`effects`·`motionCss`·`svgDocument`)는 `@sch0718/motion-kit@0.1.0`을 정확한 버전으로 고정한 devDependency로 씁니다. 원본은 같은 저장소의 `packages/motion-kit`이며 Node 빌드 스크립트 전용이라 앱 JS에는 들어가지 않습니다. 장면 문구·좌표·팔레트와 `chip`·`card`·`mapBase` 같은 랜드마크 고유 그리기 도구는 `scripts/motion/`에 남깁니다. 패키지 버전을 올릴 때는 `yarn add --dev --exact @sch0718/motion-kit@<버전>`으로 바꾼 뒤(`--dev`를 빼면 dependencies로 옮겨져 고지 대상이 됩니다) `yarn build:motion`을 돌리고 `git diff`로 생성물 변화가 의도한 것인지 확인합니다.

GitHub Packages는 패키지 공개 여부와 관계없이 설치에 토큰이 필요하며 classic 토큰만 지원합니다. `read:packages` 권한만 준 classic 토큰을 로컬 셸의 `GITHUB_PACKAGES_TOKEN`(`export GITHUB_PACKAGES_TOKEN=…`)과 Cloudflare Pages 빌드 환경변수에 넣습니다. Pages는 Production·Preview 둘 다 비밀값으로 등록합니다. 토큰 값은 저장소·로그에 적지 않습니다.

GitHub Actions는 패키지마다(`kakao-share`, `seen-store`, `motion-kit`, `firebase-session`) 패키지 설정의 Manage Actions access에 `sch0718/landmark`를 Read로 추가해야 합니다. `ci.yml`·`deploy-share-map.yml`은 job에 `packages: read`를 주고 설치 단계에만 `secrets.GITHUB_TOKEN`을 넣습니다.

Yarn 1(1.22.22)은 `.npmrc`의 `GITHUB_PACKAGES_TOKEN`이 정의되지 않으면 설치뿐 아니라 `yarn lint`·`yarn run` 등 모든 yarn 명령을 멈춥니다(`Failed to replace env in config`). 토큰 없이 설치가 끝난 트리에서 다른 명령만 돌릴 때는 `export GITHUB_PACKAGES_TOKEN=`으로 빈 값을 둡니다. Actions도 job에는 빈 값을 두고 설치 단계에서만 토큰으로 덮습니다.

토큰이 만료되면 로컬·Cloudflare 설치가 실패하므로 만료일을 관리합니다. Actions는 `GITHUB_TOKEN`을 써서 이 classic 토큰의 만료와 무관합니다. 패키지 버전은 `yarn add --exact @sch0718/<이름>@<버전>`으로 바꾸고 lockfile·고지(`yarn build:notices`)를 함께 커밋합니다.

출처: [toolkit-web README 「서비스에서 설치하기」](https://github.com/sch0718/sch0718-toolkit-web#서비스에서-설치하기)(2026-10-27 확인). 이 저장소 적용: 2026-10-29.

### 환경변수

| 이름                       | 용도                                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| `VITE_NAVER_MAP_CLIENT_ID` | 네이버 지도 JS API v3(NCP) Client ID. 로컬은 `.env.local`(gitignore)에 둡니다 |
| `VITE_MAP_ADAPTER`         | `fake`면 네이버 SDK 대신 DOM 가짜 지도를 씁니다(E2E·키 없는 개발용)           |
| `VITE_KAKAO_JS_KEY` | 카카오톡 공유 JavaScript 키. Pages **Production에만** 넣습니다. 미리보기 도메인은 카카오에 등록할 수 없어 Preview에는 넣지 않습니다. 비어 있으면 단추를 숨깁니다 |
| `VITE_TURNSTILE_SITE_KEY` | 약속 올리기에 쓰는 Turnstile 공개 사이트 키. Pages Production·Preview의 빌드 환경 변수 |
| `GITHUB_PACKAGES_TOKEN` | GitHub Packages 빌드·설치용 토큰. 앱 번들에는 들어가지 않습니다 |
| `DB` | D1 바인딩. 운영은 `landmark`, 미리보기는 `landmark-preview` |
| `TURNSTILE_SECRET` | Turnstile 검증용 비밀 키. Pages의 서버 시크릿 |
| `IP_HASH_SALT` | 일 한도에 쓰는 IP 해시의 소금. Pages의 서버 시크릿(긴 무작위 값) |
| `MEET_ONLINE` | `off`면 새 약속의 서버 올리기만 중단하고 링크 방식으로 공유. 기존 온라인 약속 읽기·답장은 계속 동작 |
| `LIBRARY_SYNC` | `off`면 보관함 로그인·받기·올리기를 중단합니다. 연결 해제·서버 자료 지우기는 계속됩니다 |
| `VITE_FIREBASE_*`, `VITE_KAKAO_LOGIN_CLIENT_ID`, `VITE_NAVER_LOGIN_CLIENT_ID` | 동기화 공급자 공개 설정. 아래 보관함 동기화 절 참고 |
| `FIREBASE_PROJECT_ID`, `KAKAO_CLIENT_ID`, `NAVER_CLIENT_ID` | 서버 로그인 공급자 설정 |
| `KAKAO_CLIENT_SECRET`, `NAVER_CLIENT_SECRET`, `ALLOWED_EMAILS`, `ALLOWED_ACCOUNTS` | Pages 서버 시크릿. 값은 저장소에 넣지 않습니다 |
| `SYNC_REDIRECT_URIS` | 허용 콜백 URI 목록(콤마). 기본은 요청 출처 + `/auth/callback` |
| `VITE_SYNC_DEV_FAKE`, `SYNC_DEV_FAKE_SOCIAL` | 각각 개발 UI·localhost 서버 가짜 카카오·네이버 스위치(`1`) |
| `SHARE_SHORT` | `off`면 카카오톡용 짧은 링크 만들기만 중단(카카오톡 단추는 예전처럼 꺼지고 `링크 복사` 안내). 이미 만든 `/s/<id>` 열기·지우기는 계속 동작 |

```bash
echo 'VITE_NAVER_MAP_CLIENT_ID=<발급받은 Client ID>' > .env.local
```

**카카오 콘솔 도메인 등록**: 앱의 JavaScript SDK 도메인과 제품 링크 관리 › 웹 도메인에 운영 앱 주소를 등록합니다. JavaScript 키 값은 저장소에 기록하지 않습니다(확인일: 2026-10-27).

**NCP 콘솔 도메인 등록**: Maps 애플리케이션의 Web 서비스 URL에 아래 주소를 등록해야 지도가 뜹니다.

- 운영 도메인 `https://landmark.sch0718.dev`와 Pages 기본 주소 `https://landmark-c5f.pages.dev`
- `http://localhost:5173`(`yarn dev`)
- `http://localhost:8788`(`yarn dev:full`)

**NCP Reverse Geocoding 켜기**: 지도에서 핀으로 장소를 추가할 때 주소를 자동으로 채우려면 같은 Maps 애플리케이션에서 Reverse Geocoding API를 켜야 합니다. 꺼져 있으면 주소 칸이 비어 직접 입력해야 합니다.

NCP Maps 요금·무료 사용량: **확인 필요**(배포 후 확인해 날짜와 함께 여기에 기록).

### 라이선스와 오픈소스 고지

- 저장소 라이선스는 [PolyForm Noncommercial 1.0.0](../LICENSE)입니다(`package.json`의 `license`).
- 오픈소스 고지 `public/third-party-notices.txt`는 `yarn build:notices`가 `dependencies`와 앱에 묶이는 아이콘(`@iconify-json/lucide`)의 라이선스 원문을 모아 만듭니다. 의존성을 바꾸면 다시 만들어 커밋합니다. CI는 `node scripts/build-notices.mjs --check`로 어긋나면 실패합니다. 패키지에 라이선스 파일이 없으면 `scripts/licenses/`에 upstream 원문을 두고 스크립트의 `VENDORED`에 연결합니다.
- 저작권 표기·라이선스·고지·후원 링크는 설정 › 이 앱에 대해(`src/sections/settings/AboutSection.tsx`)에 있고, 주소는 `src/config/about.ts` 한 곳에서 바꿉니다. `KOFI_URL`이 비어 있으면 후원 링크를 숨깁니다.

## 개발

```bash
yarn dev                           # http://localhost:5173 (네이버 지도, .env.local 필요)
VITE_MAP_ADAPTER=fake yarn dev     # 가짜 지도
yarn dev:full                      # http://localhost:8788 (Vite + 서버 함수 /api/*)
```

### 서버 함수 함께 띄우기 (`yarn dev:full`)

링크·폴더로 장소를 추가하는 기능, 여행·약속의 경로 계산, 장소 이름 검색, 영업시간, 약속 온라인 집계는 Cloudflare Pages Functions(`functions/api/place.ts`, `naver-folder.ts`, `route.ts`, `search.ts`, `hours.ts`, `meet/*`)를 부릅니다. `yarn dev`만 띄우면 `/api/*`가 없어 링크 추가가 `인터넷 연결을 확인하고 다시 시도해 주세요`로 끝나고, 여행 구간의 이동 시간은 직선 추정으로 표시됩니다. 온라인 약속 올리기·읽기·답장도 `yarn dev:full`이 필요합니다.

`yarn dev:full`은 `wrangler pages dev --d1 DB --proxy 5173 -- vite --port 5173 --strictPort`를 실행합니다. 로컬 D1을 `DB`에 붙이고 Vite 개발 서버(5173) 앞에서 `http://localhost:8788`로 받습니다. `/api/*`는 함수가, 나머지는 Vite가 응답합니다(HMR 유지). **브라우저는 8788로 엽니다.** 운영 D1은 쓰지 않습니다.

```bash
curl -H 'Origin: http://localhost:8788' 'http://localhost:8788/api/place?url=https%3A%2F%2Fnaver.me%2FFk73Vab5'
```

- 함수는 요청 출처(`Origin`, 없으면 `Referer`)가 배포 주소·미리보기 주소·`http://localhost:5173`·`http://localhost:8788`일 때만 응답합니다(그 밖은 403 `FORBIDDEN_ORIGIN`).
- 함수 진입점(`functions/api/**/*.ts`)과 `src/server/**`는 상대 경로로 가져옵니다(wrangler에는 `src/` 별칭이 없음). React·MUI를 가져오지 않습니다. Effect도 쓰지 않되, `src/server/meet/*`의 약속 입력 검사는 브라우저와 공용인 Effect Schema를 씁니다. 그 밖의 기존 서버 코드에는 Effect를 들이지 않습니다.
- `wrangler pages dev`의 명령 프록시(`-- <명령>`, `--proxy`)는 wrangler 4.142.0에서 "deprecated" 경고를 냅니다. 이 버전에서 Vite 개발 서버와 함수를 함께 띄우는 방법은 이것뿐이라(대안 `wrangler pages dev dist`는 빌드 결과만 서빙해 HMR이 없음) 그대로 씁니다. IPv6·`compatibility_date` 경고도 무시해도 됩니다. 로컬 상태는 `.wrangler/`(gitignore)에 생깁니다.

### 약속 온라인 집계 설정과 API

바인딩·환경 변수·시크릿은 **Cloudflare Pages 대시보드**에서 관리합니다. 저장소에 `wrangler.toml`을 두지 않습니다. Pages는 설정 파일이 있으면 그 파일을 기준으로 대시보드 바인딩을 덮기 때문입니다.

1. D1에 운영용 `landmark`와 미리보기용 `landmark-preview`를 만듭니다(위치 힌트 `apac`). Pages 프로젝트의 Settings › Bindings에서 각 환경의 `DB`에 해당 DB를 연결합니다. 미리보기에 운영 DB를 연결하지 않습니다.
2. Turnstile 위젯을 보이지 않는 방식으로 만들고 운영·미리보기에서 쓸 호스트를 등록합니다. 공개 사이트 키는 빌드 환경 변수 `VITE_TURNSTILE_SITE_KEY`, 비밀 키는 서버 시크릿 `TURNSTILE_SECRET`에 넣습니다.
3. 운영·미리보기에 서버 시크릿 `IP_HASH_SALT`를 넣습니다. 키·시크릿 값은 저장소에 기록하지 않습니다.
4. 표는 첫 요청에서 `ensureSchema`가 `schema_meta` 버전을 확인해 추가형 SQL을 한 `batch`로 실행합니다. 수동 SQL이나 `wrangler d1 migrations`는 필요 없습니다. 실패하면 다음 요청에서 다시 시도합니다.

로컬은 `DB` 바인딩이 필요하지만, 실제 요청 주소의 호스트가 `localhost`·`127.0.0.1`·`[::1]`일 때만 `TURNSTILE_SECRET`이 없을 때 검증을 건너뛰고 `IP_HASH_SALT`가 없을 때 개발용 소금을 씁니다. 로컬에서 `VITE_TURNSTILE_SITE_KEY`를 비워 두면 브라우저도 외부 스크립트를 부르지 않습니다. 운영·미리보기에서 DB·시크릿 설정이 빠지면 약속 올리기는 `503 UNAVAILABLE`(`reason: 'config'`)로 실패합니다. `MEET_ONLINE=off`의 `503`(`reason: 'off'`)만 새 약속을 링크 방식으로 공유하게 하며, 일반 장애·설정 누락 때는 다시 시도 안내를 보입니다. 설정 후 미리보기에서 올리기·답장·집계와 함수 CPU 시간을 확인합니다.

| 요청 | 하는 일·성공 응답 | 권한 |
| --- | --- | --- |
| `POST /api/meet` | `{ doc, turnstile, hostToken }`(토큰은 브라우저가 만듦) 올리기 → `201 { id, rev, docRev, hostToken, created: true }`, 같은 토큰 재시도 → 현재 버전의 `200 { id, rev, docRev, hostToken, created: false }`(처음 본문 보존, 다른 토큰은 `409`) | 출처·Turnstile·일 한도 |
| `GET /api/meet/:id?since=<rev>` | `200 { rev, docRev, doc, replies, originNames? }`, 버전이 같으면 본문 없는 `304` | 링크 소지자 |
| `PUT /api/meet/:id` | `{ doc, baseRev, removed?, clearReplyOrigins? }` 갱신·확정·확정 취소 → `200 { rev, docRev }`. `removed?`: 지운 답장 전용 참석자 id 배열(최대 10명). `clearReplyOrigins?`: `Array<{ participantId, origin: Origin }>`(최대 10명), 주최자가 본 답장 출발지 | 주최자 |
| `DELETE /api/meet/:id` | 서버 사본·답장·토큰 삭제 → `204` | 주최자 |
| `POST /api/meet/:id/claim` | `{ participantId, guestToken }` 또는 `{ newName, guestToken }`로 참석자 차지. 브라우저가 43자 base64url `guestToken`을 먼저 저장하며, 응답 유실 뒤 같은 토큰으로 재시도하면 참석자·토큰·버전을 늘리지 않고 `200 { participantId, guestToken, rev }`를 돌려준다. 다른 토큰으로 이미 차지한 참석자를 고르면 `409 taken` | 링크 소지자·일 한도 |
| `PUT /api/meet/:id/reply` | `{ likes, origin?, times?, docRev? }` 저장 → `200 { rev, timesDropped? }` | 해당 참석자·주최자 |
| `POST /api/meet/:id/release` | `{ participantId }`로 차지 풀기, `{ host: true, hostToken }`(새 토큰은 브라우저가 만듦)로 주최자 토큰 재발급 → `200 { rev, hostToken? }`. 같은 새 토큰 재시도는 이전 인증이 철회됐어도 버전을 바꾸지 않고 성공 | 주최자 |

- 진입점은 `functions/api/meet/*`, 처리 코드는 `src/server/meet/*`입니다. `MeetDb` 인터페이스에 D1을 넘기며, 단위 시험은 Node 24 내장 `node:sqlite` 어댑터(`tests/helpers/sqlite-d1.ts`)를 씁니다. 브라우저 API·저장은 `src/services/meet-online/*`, 화면은 `use-online-meeting.ts`·`OnlineHostMenu.tsx`·`OnlineInviteView.tsx`·`MeetLinkPage.tsx`에 있습니다.
- `rev`는 본문·답장·차지 변경을 확인하는 버전이고, DB의 `doc_rev`(응답의 `docRev`)는 본문 변경 때만 오릅니다. 주최자가 보내는 `baseRev`는 `doc_rev`이며, 다르면 `409 CONFLICT`와 현재 `docRev`를 줍니다. 친구 답장 때문에 본문 저장이 충돌하지 않습니다. 참석자 차지·답장·풀기의 동시 변경은 최대 5번 시도하고 계속 충돌하면 `409 CONFLICT`(`reason: 'busy'`)를 줍니다.
- 올리지 않은 주최자 수정은 마지막으로 맞춘 본문(`syncedDoc`)과의 내용 비교로 판정합니다. 제목·일시·이동수단·후보·확정과 주최자 참석자 id·이름을 비교하며, `seen`의 답장 전용 참석자는 이름이 자동 추가 때의 `seenNames[id]`와 같을 때만 뺍니다. 이름이 다르면 주최자 수정으로 보존하고 다음 본문 저장에 싣습니다. `seenNames`는 `seen`과 함께 추가·삭제하며 원격 본문을 받으면 받은 이름으로 맞춥니다. 출발지가 `syncedDoc`과도 마지막 답장 출발지(`replyOrigins[id]`)와도 다르거나 아래 덮어쓰기 조건이면 주최자 수정입니다. 수정이 없고 `docRev`가 다르거나 기록이 없으면 서버 본문을 받고 `syncedDoc`·`docRev`를 맞춥니다. 첫 기기(`syncedDoc: null`)는 수정 없음으로 보며, 미전송 수정이 있으면 본문과 두 기록을 보존합니다.
- 참석자는 새 본문과 남는 답장 전용 참석자를 합쳐 10명까지입니다. 본문 갱신도 같은 `rev` 조건에서 검사·저장하며 초과하면 `409`(`reason: 'full'`)을 돌려줍니다.
- 모든 약속 API 응답은 `Cache-Control: private, no-store`이며 기존 Cache API에 넣지 않습니다. 토큰은 `Authorization: Bearer …`로 보내고 DB에는 SHA-256 해시만 둡니다. 주최자 링크는 `/meet/<id>#h=<토큰>`이며 해시를 읽은 뒤 `history.replaceState`로 지웁니다. 토큰·IP 원문을 로그·DB·URL 질의 문자열에 남기지 않습니다.
- 첫 올리기 전에 `pendingHostToken`과 처음 시도한 본문을 `syncedDoc`에 저장합니다. `created: false`로 복구하면 처음 본문을 기준으로 두고 그 뒤 고친 내용은 자동 갱신으로 올립니다. 주최자 재발급은 `syncedDoc`를 바꾸지 않고 새 토큰을 `pendingHostToken`에 먼저 저장하며, 응답 유실 뒤 다시 발급하거나 확인에서 401을 받으면 같은 토큰으로 한 번 재시도합니다. 성공하면 대기 토큰을 주최자 토큰으로 옮깁니다.
- 약속 읽기에서 틀린 토큰은 `401 UNAUTHORIZED`이며, 토큰 헤더가 없으면 링크 소지자용으로 좌표를 가린 응답을 줍니다.
- 본문의 이동수단·일시·후보 id별 좌표(추가·삭제 포함)가 바뀌면 같은 `doc_rev` 조건의 배치에서 답장 `times`만 `NULL`로 비우고 출발지는 보존합니다. 친구 화면은 어느 줄이든 답장 `times`가 있으면 쓰고 `null`이면 본문 시간을 씁니다. 자기 답장에 출발지가 있으면 초안 없이도 자기 줄을 재계산해 표시하고 값이 다르면 자동 저장합니다. 답장 `times`에는 계산에 쓴 `docRev`를 보내며, 없거나 현재 버전과 다르면 시간만 버리고 `timesDropped: true`를 돌려줍니다(다음 확인 뒤 재계산). 출발지는 새로 고를 수만 있고 되돌리기나 `origin: null` 전송은 없습니다.
- `replyOrigins[id]`는 이 기기가 마지막으로 받은 그 참석자의 답장 출발지입니다. 병합·본문 수신 모두 null이 아니고 이 기록과 다른 답장 출발지만 적용하고 기록을 바꿉니다. 같은 출발지의 좋아요 답장은 출발지를 건드리지 않습니다.
- 보관함 출발지가 `replyOrigins[id]`(있을 때)와 다르면 주최자의 명시적 덮어쓰기입니다. 본문이 `baseline`과 같아도 `clearReplyOrigins: [{ participantId, origin }]`(최대 10명, 주최자 id 무시)를 PUT에 보냅니다. `origin`은 주최자가 본 답장 출발지(`replyOrigins[id]`)입니다. 서버는 같은 배치·버전 조건에서 현재 답장 출발지가 이 값과 같을 때만 답장 `origin`·`times`를 `NULL`로 비웁니다. 친구가 그 뒤 새로 고른 출발지는 보존하며, 본문의 출발지가 바뀌었다는 이유만으로 답장 출발지를 비우지 않습니다. 성공한 id의 기록만 지우되 전송 중 새로 받은 출발지 기록은 보존합니다.
- 답장 `updated_at`은 매 시도에서 `max(서버 현재 시각, 그 참석자의 기존 시각 + 1ms)`로 저장합니다(기존 줄이 없으면 현재 시각). 주최자 기기는 받은 답장 시각이 보관함 `sentAt`과 다르면 크고 작음과 무관하게 좋아요를 반영합니다.
- 주최자 좋아요도 1초 모아 `reply`로 보내고 첫 생성 직후 기존 좋아요를 전송하며, 실패하면 다음 확인 때 다시 보냅니다. 주최자 토큰은 본문 첫 참석자의 이름·좋아요 줄만 쓰며 `origin`·`times`는 무시합니다.
- 친구 응답에서는 남의 본문·답장 출발지 좌표를 `null`로 가리고, 출발지 이름은 `originNames`, 소요시간은 `times`로 줍니다. 참석자 자신의 좌표는 남기고, 주최자는 전체를 받습니다.
- UTC 날짜·IP 해시별 일 한도는 올리기 20, 참석자 고르기 60, 답장 저장 600, 본문 바꾸기 300입니다. 읽기는 없는 약속(`404`)·만료된 약속(`410`)만 5,000번까지 세고, 정상 읽기·`304`는 카운터를 쓰지 않습니다. 초과하면 `429 RATE_LIMITED`입니다.
- 서버 사본은 `max(약속 일시(한국 시각), 마지막 변경) + 30일`에 만료됩니다. 읽을 때 만료를 판단하고, 새 약속 올리기 요청에서 만료 사본을 최대 20개씩 답장·토큰과 함께 지웁니다. 주최자가 먼저 지우면 화면은 `공유 끝남`이 됩니다. 보관함 약속과 이미 받은 답장은 남습니다.
- 화면이 보이고 온라인일 때 10초마다 확인합니다. 숨김·오프라인에서는 멈추며 복귀하면 바로 확인하고, 실패가 이어지면 간격을 30초·60초로 늘립니다. 친구의 변경은 1초 모아 자동 저장하며, 확인 중 건너뛴 저장은 표시를 남겼다가 확인 완료(성공·304·실패) 직후 최신 입력으로 다시 시도합니다. 화면이 숨겨질 때도 남은 저장을 한 번 시도합니다. 실패한 초안은 다음 확인 때 다시 보냅니다.
- 보관함·백업 형식은 그대로입니다. 토큰과 마지막 확인 버전·본문 버전·마지막 동기화 본문(64KB 이내)은 별도 키 `tripmap:meet-online:v1`에 두며 백업에 넣지 않습니다. 다른 기기의 주최자 연결은 메뉴의 `다른 기기에서 열기`로 링크를 공유·복사합니다. 다시 발급하면 이전 주최자 링크는 철회됩니다.
- 온라인 코드와 Turnstile 로더는 지연 로딩되는 약속 화면에서만 가져옵니다. Turnstile은 처음 올릴 때 불러오며, `yarn size --require-lazy …`로 첫 로딩 예산을 확인합니다.

### 보관함 동기화 설정과 API

본인이 설정에서 켠 기기끼리 장소·라벨·여행·약속·폴더 연결을 D1으로 맞춥니다. 서버에는 암호화하지 않고 저장하므로 운영자가 내용을 볼 수 있습니다. 화면 설정과 약속 주최자 연결은 기기별입니다. [설계서](superpowers/specs/2026-10-29-library-sync-design.md)의 「사용자가 할 일」에 Firebase·카카오·네이버 앱 등록, 허용 계정 등록 및 미리보기 확인 절차가 있습니다. 외부 계정·키 생성과 Pages 변수 등록은 사용자가 직접 합니다.

Pages 대시보드의 Variables and Secrets에서 Production과 Preview에 각각 등록합니다. 실제 값과 시크릿은 저장소에 기록하지 않습니다.

| 이름 | 종류 | 값 |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | 빌드 변수(Plaintext) | Firebase 웹 앱의 공개 값. Preview의 AUTH_DOMAIN은 `<projectId>.firebaseapp.com` |
| `VITE_KAKAO_LOGIN_CLIENT_ID` | 빌드 변수 | 카카오 REST API 키 |
| `VITE_NAVER_LOGIN_CLIENT_ID` | 빌드 변수 | 네이버 Client ID |
| `FIREBASE_PROJECT_ID` | 변수 | Firebase 프로젝트 ID |
| `KAKAO_CLIENT_ID` | 변수 | 카카오 REST API 키 |
| `NAVER_CLIENT_ID` | 변수 | 네이버 Client ID |
| `KAKAO_CLIENT_SECRET` | 시크릿(Encrypt) | 카카오 클라이언트 시크릿 |
| `NAVER_CLIENT_SECRET` | 시크릿 | 네이버 Client Secret |
| `ALLOWED_EMAILS` | 시크릿 | 허용 Google 이메일(콤마) |
| `ALLOWED_ACCOUNTS` | 시크릿 | 허용 `kakao:<sub>,naver:<sub>` 목록. 비어 있으면 허용하지 않음 |
| `LIBRARY_SYNC` | 변수(선택) | 끌 때만 `off` |
| `SYNC_REDIRECT_URIS` | 변수(선택) | 기본(요청 출처 + `/auth/callback`)과 다를 때만 |

Google 공급자를 쓰지 않으면 Firebase 변수는 생략합니다. 설정이 없는 공급자는 로그인 버튼을 숨깁니다. 카카오·네이버의 허용 밖 계정은 화면에 나온 계정 값을 관리자가 허용 목록에 더한 뒤 재배포해야 합니다. 공급자가 다르면 별도 사용자이며 자동으로 연결하지 않습니다. 동기화 API는 Turnstile을 쓰지 않습니다.

#### 로컬에서 키 없이 해 보기

```bash
yarn dev:sync
# 포트를 바꾸려면:
SYNC_DEV_PORT=8795 SYNC_VITE_PORT=4185 yarn dev:sync
```

Vite 4185와 wrangler 8795를 사용합니다. 사용자 개발 서버인 5173·5174를 건드리지 않습니다. `.wrangler/`는 gitignore에 있으며 저장소에 `wrangler.toml`을 만들지 않습니다.

1. 기기 A는 `http://localhost:8795`, 기기 B는 `http://127.0.0.1:8795`를 엽니다. 출처가 달라 보관함이 따로입니다.
2. 설정 › 동기화 › `카카오로 로그인`(또는 네이버)을 누릅니다. 가짜 화면의 계정은 `me`가 허용되며, 다른 값을 입력하면 허용 밖 안내를 확인할 수 있습니다. 결과 라디오로 취소·공급자 오류·코드 거절·장애도 시험합니다.
3. A에서 `올리기`, B에서 `서버 보관함 받기`를 누릅니다. 한쪽 메모를 고치고 다른 쪽을 새로고침하면 들어옵니다.
4. 충돌은 개발 도구 Network › Offline으로 한쪽을 끊은 뒤 양쪽의 같은 메모를 고쳐 시험합니다. 다시 온라인으로 바꾸고 새로고침하면 설정의 충돌 목록에서 `내 값으로 되돌리기`를 누를 수 있습니다.
5. `동기화 끄기`는 이 기기만 멈춥니다. `연결 해제`는 세션을 철회하고 보관함·맞춘 기록은 남깁니다. `서버 자료 모두 지우기`는 이 계정의 서버 자료와 모든 세션을 지우며 기기 보관함은 남깁니다.

가짜 공급자는 **요청 주소가 localhost 계열이고 `SYNC_DEV_FAKE_SOCIAL=1`일 때만** 열립니다. PKCE·nonce·서명 검증을 실제 패키지 코드로 통과하며 외부 통신은 없습니다. 가짜 Google 로그인은 없습니다. Google은 Firebase 설정을 넣은 미리보기에서 확인합니다. 지도도 키 없이 보려면 `VITE_MAP_ADAPTER=fake yarn dev:sync`를 씁니다.

상태 확인(로컬 서버를 띄운 뒤):

```bash
curl -s -H 'Origin: http://localhost:8795' http://localhost:8795/api/sync/v1/status
```

로컬 D1을 비우려면 서버를 끈 뒤 `rm -rf .wrangler/state`를 실행합니다. 이 명령은 로컬의 다른 서버 기능 시험 자료도 지웁니다.

#### API와 한도

모든 경로는 `/api/sync` 아래이며 응답은 `Cache-Control: private, no-store`입니다. 세션 헤더는 `X-Landmark-Session`, Google은 Firebase ID 토큰도 보냅니다. 보관함 schema 2와 백업 형식은 그대로이고 동기화 기록·세션은 백업에 넣지 않습니다.

| 요청 | 동작 |
| --- | --- |
| `GET /v1/status` | 기능 스위치·공급자·개발 가짜 상태 |
| `POST /v1/session`, `POST /v1/session/social` | Google·소셜 로그인 후 기기 세션 만들기 |
| `DELETE /v1/session` | 이 기기 연결 해제 |
| `GET /v1/sessions` | 기기 세션 목록 |
| `DELETE /v1/sessions?others=1`, `DELETE /v1/sessions/:id` | 다른 기기 연결 철회 |
| `GET /v1/me` | 서버 보관함 개수·기기 기록 |
| `GET /v1/library/changes?since=0&after=&limit=500&device=<16자>` | 변경 커서로 받기. `410 resync`면 전체 다시 받기 |
| `POST /v1/library/push` | `{ v: 1, deviceId, items: [{kind,id,baseRev,baseDeleted,doc}] }` 올리기 |
| `DELETE /v1/account` | `{ confirm: 'delete' }`로 계정 서버 자료 모두 지우기 |
| `GET /dev/fake-social/authorize`, `GET /dev/fake-social/approve` | localhost 개발 전용 공급자 화면 |

UTC 날짜별 한도는 로그인 IP 해시당 60회, 사용자당 받기 5,000회·올리기 2,000회·항목 30,000개입니다. 본문 1,000,000바이트·올리기 100개·항목 문서 200,000자·받기 500개 상한이며 미래 10분을 넘긴 시각은 거절합니다. 삭제 묘비는 90일 뒤 요청 때 정리하되 여행이 참조하는 장소는 남깁니다. Cron은 없습니다.

D1 표는 `users`, `sessions`, `library_state`, `library_items`, `library_devices`이며 기존 `rate_counters`를 함께 씁니다. 첫 동기화 요청의 `ensureSchema`가 버전 5 표를 멱등 생성하므로 원격 마이그레이션 명령은 필요 없습니다. 사용자가 원격 버전을 확인할 때만 다음 읽기 명령을 씁니다(Preview는 `landmark-preview`).

```bash
npx wrangler d1 execute landmark --remote --command "SELECT version FROM schema_meta"
```

비상 중단은 Pages의 `LIBRARY_SYNC=off` 후 재배포입니다. 로그인·받기·올리기가 503 `off`가 되고 이 기기 저장과 연결 해제·서버 자료 지우기는 계속됩니다. 옛 앱으로 롤백하면 동기화 UI·엔진이 없어져 멈추며 각 기기의 보관함과 D1 자료는 남습니다. `docs/rollback.md`의 버전 행은 병합 뒤 별도 문서 PR에서 추가합니다.

검증은 `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build:ci`와 `E2E_PORT=4181 E2E_MAP_PORT=4182 yarn test:e2e tests/e2e/library-sync.spec.ts --project desktop`입니다. 전체 핵심 E2E는 같은 포트 변수로 `yarn test:e2e:ci`를 실행합니다. 미리보기에서는 실제 Google·카카오·네이버 로그인, 100개 올리기 CPU 시간(무료 CPU 한도를 넘으면 `PUSH_MAX_ITEMS`를 50으로), iOS Safari·카카오톡 인앱 복귀를 사람이 확인합니다.

### 공유 짧은 링크(`/s/<id>`)

장소 내보내기·일정 공유의 긴 링크(`/view#d=…`)는 카카오톡 한도(400자)를 넘으므로, `카카오톡`을 누르면 브라우저가 해시를 압축 바이트로 되돌려 AES-GCM(링크마다 새 128비트 키)으로 암호화해 D1에 올리고 `<지금 출처>/s/<16자 id>#k=<22자 키>`(운영 72자)를 받습니다. 링크는 `VITE_APP_URL`이 아니라 사본을 올린 지금 출처로 만듭니다(다른 배포의 D1에는 그 링크가 없다). 키는 링크의 해시에만 있어 서버로 가지 않습니다. 약속과 같은 D1·Turnstile·`IP_HASH_SALT`를 쓰므로 새 설정은 없습니다(`SHARE_SHORT`만 선택). 설계: `docs/superpowers/specs/2026-10-28-share-short-link-design.md`.

| 요청 | 하는 일·성공 응답 | 권한 |
| --- | --- | --- |
| `POST /api/share` | `{ body, kind: 'places' \| 'trip', keepUntil?, turnstile, deleteToken }` → `201 { id, expiresAt, created: true }`. `deleteToken`(43자)은 브라우저가 먼저 만들고, 같은 토큰으로 다시 보내면 처음 링크를 `200 { …, created: false }`로 돌려준다(본문은 처음 것). `body`는 base64url 32,040자까지, 요청은 40,000바이트까지(넘으면 `413 TOO_LARGE`) | 출처·Turnstile·일 한도·`SHARE_SHORT` |
| `GET /s/:id` | 암호문을 데이터 블록에 넣은 작은 HTML(인라인 스크립트 하나, CSP 해시로만 실행). 스크립트가 `#k=`로 풀어 `location.replace('/view#d=…')`. 없는 링크 `404`·만료 `410`·한도 `429`·설정 누락·장애 `503`은 안내 HTML | 링크 소지자(출처를 보지 않는다 — 카카오톡에서 연 화면 이동에는 `Origin`이 없다) |
| `DELETE /api/share/:id` | `Authorization: Bearer <deleteToken>` → `204`(틀린 토큰 `401`, 없는 링크 `404`) | 출처·삭제 토큰 |

- 보관 기한: 장소 30일, 일정은 `max(30일, min(180일, 마지막 여행 끝날 + 7일의 한국 자정 직전))`. 규칙은 서버와 화면이 같이 쓰는 `src/domain/share/short-link.ts` 한 곳에 있다. 만들기·열기 요청 때 만료 행을 최대 20개씩 지운다.
- 일 한도(IP 해시당): 만들기 50, 지우기 200, 없는·만료 링크 열기 5,000(정상 열기는 세지 않는다).
- 서버는 본문을 풀 수 없어 검사하지 않는다. 문서 검사는 지금처럼 보기 화면이 한다. 모든 응답은 `Cache-Control: private, no-store`이고, `/s/:id` HTML은 `Referrer-Policy: no-referrer`·`X-Robots-Tag: noindex`를 직접 붙인다(`public/_headers`는 함수 응답에 붙지 않는다).
- 화면: `ShareFileDialog`의 `카카오톡`은 긴 링크가 400자를 넘을 때만 짧은 링크를 쓴다. 첫 클릭에 만들고(`짧은 링크 만드는 중…`), 다음 클릭(`카카오톡으로 보내기`)에 보낸다. 올리기가 비동기라 같은 클릭에서는 카카오톡을 열 수 없다. 창이 열려 있는 동안 긴 링크별로 기억하고, 실패 뒤 다시 누르면 같은 본문·삭제 토큰으로 보낸다. `링크 복사`·`링크 공유`는 계속 긴 링크다.
- 기기 기록 `tripmap:share-links:v1`: `{ id, deleteToken, title, kind, createdAt, expiresAt }`(최대 100개, 만료된 것은 보이지 않음). 키 `k`는 저장하지 않는다. 설정 › `보낸 짧은 링크`에서 지운다. 백업에 넣지 않는다.
- 코드: 진입점 `functions/api/share/*`·`functions/s/[id].ts`, 처리 `src/server/share/*`, 브라우저 `src/services/share-short/*`·`src/sections/share-export/use-short-link.ts`·`src/sections/settings/SentLinksSection.tsx`. E2E는 `tests/e2e/share-server.ts`가 요청을 진짜 처리 코드와 시험용 SQLite에 넘긴다.
- D1 무료 한도(Workers Free, 계정 전체 합계): 하루 읽은 행 500만·쓴 행 10만·저장 5 GB입니다. 매일 00:00 UTC에 초기화되며 한도를 넘으면 D1 쿼리가 오류를 냅니다. 출처: [Cloudflare D1 가격 문서](https://developers.cloudflare.com/d1/platform/pricing/)(문서 갱신일 2026-04-21, 조회일 2026-10-29). 운영 확인(2026-10-29): `share_links` 표가 생겼고 행 3개, DB 크기 111 kB입니다. 사용량은 Cloudflare 대시보드의 D1 Metrics에서 봅니다. `wrangler d1 info`의 24시간 조회·쓰기 수는 0으로 나와 집계 지연으로 보입니다.

### 화면 경로

| 경로               | 화면                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `/`                | 보관함(카드·타일·목록·벤토 보기, 라벨·지역·검색 거르기, 정렬, 내 근처, 선택 일괄 작업)           |
| `/map`             | 보관함 지도(라벨 색 마커·이모지, 보관함과 같은 거르기, 내 위치)                                  |
| `/place/:id`       | 장소 상세(이름·분류 편집, 라벨 바꾸기, 메모 자동 저장, 다녀옴·한 줄 평, 영업시간, 삭제 되돌리기) |
| `/labels`          | 라벨 관리(이름·색·이모지·순서·병합·삭제, 이름으로 이모지 정하기, 네이버 폴더 다시 가져오기)      |
| `/auth/callback` | 로그인 콜백. 코드·state를 렌더 전에 주소에서 지웁니다 |
| `/settings`        | 설정(테마·모드, 보관함 보기, 백업·되살리기, 옛 여행 가져오기, 데이터 정보)                       |
| `/help`            | 메뉴별 도움말 모음                                                                               |
| `/help/:id`        | 메뉴별 도움말(움직이는 그림, 단계별 사용법, 알아 둘 점)                                            |
| `/trips`           | 여행 목록(카드, 새 여행, 이름 바꾸기·삭제)                                                       |
| `/trips/:id`       | 여행 계획(후보 · 지도 · Day 시간표, 경로·도착 시각, 순서 정리·Day 자동 나누기, 일정 공유)        |
| `/trips/:id/today` | 여행 당일 모드(오늘 일정, 다음 장소 길찾기, 다녀옴 체크, 늦어짐)                                 |
| `/meetings`        | 약속 목록                                                                                        |
| `/meetings/:id`    | 약속 편집(참석자·출발지, 중간 지점 찾기, 후보, 답장 집계, 확정)                                  |
| `/meet`            | 약속 링크(`#d=` 후보 보고 답장, `#r=` 답장 반영, `#f=` 확정 보기)                                |
| `/meet/:id`        | 온라인 약속(참석자 고르기·답장 자동 저장·확정), `#h=`는 다른 기기의 주최자 연결 |
| `/view`            | 받은 공유 링크 보기(`#d=…`, `Landmark에 담기`)                                                   |
| `/t/:publicId`     | 옛 여행 가져오기                                                                                 |
| `/import`          | 받은 공유 파일 가져오기(`/`로 바뀌고 고르기·미리보기 칸이 열림)                                  |

- 화면 폭에 따라 ≥1280px 3단, 768–1279px 2단 + 상세 오버레이, 768px 미만 하단 탭(보관함·지도·＋·여행·약속·설정)입니다. 휴대폰의 장소 상세는 지도·목록 위 아래쪽 시트로 열립니다.
- **메모 자동 저장**: 입력을 멈춘 뒤 저장하고, 다른 화면으로 이동하거나 탭을 백그라운드로 보낼 때 대기 중인 초안을 먼저 저장합니다. 탭·브라우저를 바로 닫을 때는 저장이 비동기 Web Lock 안에서 실행되므로 **최선 노력(best-effort)** 입니다. 백그라운드 전환과 앱 안 이동에서는 안정적으로 저장됩니다.
- 네이버 지도 길찾기는 여행 구간(`네이버 지도로 길찾기`)·당일 모드의 다음 장소·약속 확정 화면에 있습니다(좁은 화면은 앱 주소 `nmap://`, 그 밖은 웹). 장소 상세에는 길찾기 대신 "네이버 지도에서 열기"가 있습니다.

| 명령                 | 내용                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn lint`          | ESLint                                                                                                                                                            |
| `yarn fm:check`      | Prettier 포맷 검사                                                                                                                                                |
| `yarn typecheck`     | `tsc -b --noEmit`                                                                                                                                                 |
| `yarn test`          | Vitest 단위·컴포넌트 테스트                                                                                                                                       |
| `yarn test:e2e`      | Playwright E2E(아래)                                                                                                                                              |
| `yarn validate`      | `trips/*.yaml`과 `public/data/*.json` 스키마 검증                                                                                                                 |
| `yarn orphans`       | 앱 진입점에서 닿지 않는 `src/**` 파일(쓰지 않는 옛 코드) 찾기. 정상이면 `orphans: none`                                                                           |
| `yarn effect:source` | `.reference/effect/`에 현재 `effect` 버전의 소스를 받습니다(API 확인용, 커밋 안 함)                                                                               |
| `yarn build:viewer`  | 공유 파일의 보기 화면 틀을 `public/share-viewer.html`로 빌드(gitignore). `dev`·`dev:full`·`build`가 먼저 실행                                                     |
| `yarn build:map`     | 공유 파일 안 iframe이 띄우는 지도 페이지를 `dist-map/`으로 빌드(아래 "공유 파일과 지도 페이지")                                                                   |
| `yarn build:icons`   | `docs/branding/icon-a.svg`(앱 아이콘 원본)에서 `public/favicon.svg`와 홈 화면·manifest용 PNG 아이콘을 다시 만듭니다                                               |
| `yarn build:motion` | README 소개 그림(`docs/readme/hero-*.svg`), 앱·문서 공용 도움말 그림(`public/help/img/*.svg`), 도움말 문서(`docs/help/*.md`), 앱 도움말 데이터(`src/sections/help/help-content.ts`)를 다시 만듭니다. 원본은 `scripts/motion/help-pages.mjs`이고 색은 파스텔 테마 토큰을 읽고, 글자·장면·움직임 CSS·SVG 틀 같은 기반 함수는 `@sch0718/motion-kit`에서 가져옵니다 |
| `yarn build`         | 보기 화면 틀 + 타입 검사 + Vite 빌드 → `dist`                                                                                                                     |
| `yarn size`          | 첫 화면 JS·전체 JS 크기(원본·gzip)를 재고 `perf-budget.json` 예산을 넘으면 실패(`docs/ui-performance.md`)                                                         |
| `yarn build:ci`      | `validate → typecheck → test → build → size → build:map` (배포 빌드 명령)                                                                                         |

### E2E

```bash
yarn playwright install chromium webkit   # 처음 한 번
yarn test:e2e:ci                          # CI 핵심 사용자 흐름
yarn test:e2e                             # 전체
E2E_PORT=5175 yarn test:e2e               # 5173을 다른 프로젝트가 쓰고 있을 때
```

- `test:e2e`·`test:e2e:ci`는 먼저 `yarn build:map:e2e`(가짜 지도로 지도 페이지 빌드)를 돌립니다. 작업자는 2개로, spec 파일 단위로 나눠 동시에 돕니다.
- 앱 개발 서버 포트는 기본 5173이고 `E2E_PORT`로 바꿉니다. 5173을 남의 서버가 쓰고 있으면 `reuseExistingServer` 때문에 그것을 앱으로 착각하고 시험하므로 그럴 때 `E2E_PORT`를 씁니다. 내보낸 파일 안 지도 페이지(`dist-map/`)는 5180에서 `vite preview`로 띄웁니다(`SHARE_MAP_URL`, `tests/e2e/fixtures.ts`).

- 프로젝트(`playwright.config.ts`): `desktop`(Chromium 1280×800, 3단), `iphone`(WebKit, iPhone 13 390×844), `galaxy`(Chromium 360×780, 터치). 핵심 흐름 테스트 제목에 `@smoke`가 붙어 있고 CI(`test:e2e:ci`)는 그것만 돌립니다.
- spec(`tests/e2e/`)
  - 보관함: `library.spec.ts`(라벨 필터·목록·지도·상세, 메모·새로고침, 두 탭 동시 메모), `mobile-sheet.spec.ts`(휴대폰 상세 시트), `large-library.spec.ts`(라벨 찾기·지역 두 단계), `labels-emoji.spec.ts`(라벨 이모지), `nearby.spec.ts`(내 근처), `visited-review.spec.ts`(다녀옴·한 줄 평), `business-hours.spec.ts`(영업시간·휴무 경고), `first-load.spec.ts`(첫 화면)
  - 장소 추가: `place-adding.spec.ts`(링크·폴더·핀), `folder-resync.spec.ts`(폴더 다시 가져오기), `legacy-import.spec.ts`(`/t/e2etest000001`)
  - 여행·약속: `trip-planning.spec.ts`(만들기·후보·Day 배치·경로), `trip-today.spec.ts`(당일 모드), `meetings.spec.ts`(약속장소·후보·답장·확정 링크), `meetings-online.spec.ts`(온라인 약속·자동 집계·확정·차지 충돌·다른 기기 주최자 연결)
  - 공유·백업: `share-export.spec.ts`(HTML 파일), `share-link.spec.ts`(링크·`/view`), `share-import.spec.ts`(＋ 시트·`Landmark에 담기`·PC 끌어 놓기), `trip-share.spec.ts`(일정 공유), `backup-restore.spec.ts`(받기 → 되살리기 → 되돌리기, 손상 화면)
  - `themes.spec.ts`(테마 3 × 라이트/다크 스크린샷)
- 보관함 시드는 `tests/fixtures/library/seed.json`(장소 30·라벨 6)을 `page.addInitScript`로 `localStorage['tripmap:library:v2']`에 심습니다. 형식은 `tests/unit/schema/library-seed.test.ts`가 `LibrarySchema`로 검증합니다.
- 스크린샷은 `test-results/screens/`(보관함·상세)와 `test-results/themes/<project>-<theme>-<mode>.png`에 남습니다. 비교 단언 없는 산출물이며, Playwright가 실행할 때마다 `test-results/`를 비우므로 전체 실행(`yarn test:e2e`) 뒤에 확인하세요.
- 실물 iPhone·Android는 이 E2E로 대체되지 않습니다(에뮬레이션). 실물 기기 점검은 다듬기 D4에서 하며 아직 하지 않았습니다.
- global setup이 `tests/fixtures/trips/e2e.json`을 `public/data/e2etest000001.json`으로 복사하고 teardown이 지웁니다. 이 파일은 커밋하지 않습니다(`.gitignore`). 옛 여행 가져오기(`/t/e2etest000001`) 시험에 쓰입니다.
- 지도는 `VITE_MAP_ADAPTER=fake`로 DOM 가짜 지도를 씁니다. 유효 키의 실 SDK 및 실물 기기 테스트와 구분합니다.
- 온라인 약속은 `meet-server.ts`가 `page.route` 요청을 진짜 처리 코드와 시험용 SQLite에 넘깁니다. 외부 D1·Turnstile은 부르지 않으며 실제 바인딩·검증·CPU 시간은 미리보기 배포에서 따로 확인합니다.

### 측정과 구현 호환

제품 `f9f8fc2`의 과거 검증은 CI678·native68 PASS/3 skip·production39 first PASS/FLAKY0입니다. 활성 geometry의 과거 cache 복귀를 막는 수정과 실제 입력 회귀를 포함합니다. 당시 CPU4x p95 60.4/56.0/122.0/49.5/135.5ms와 장소→일정 >100ms 작업3건은 이전 엄격한 예산에서 FAIL이었습니다. 2026-10-05 사용자 결정으로 PoC 목표를 p95≤300ms·30회 중 >100ms 작업 최대5회로 완화해 이 기록을 수용합니다. 최신 성능 재측정 결과는 아닙니다. [성능 기록](ui-performance.md)에 과거 판정과 원자료를 보존합니다.

CI는 PR과 main push에서 핵심 사용자 흐름(`@smoke`)만 실행하고, 전체 E2E는 수동 실행(workflow_dispatch)으로 분리했습니다. (옛 화면 시절의 [검증 범위](ui-validation.md) 문서는 v2에서 대체됐습니다.)

```bash
VITE_MAP_ADAPTER=fake yarn build
node scripts/measure-ui-assets.mjs dist/assets
```

측정 스크립트는 JS/CSS 파일별 원본·gzip 바이트와 전체 합을 JSON으로 출력하며 앱 코드·SDK 키를 읽지 않습니다. source map의 크기는 다운로드 비용에서 제외합니다. 초기 진입 청크·외부 SDK 요청은 별도 브라우저 측정이 필요합니다. v2 전후 번들 비교는 [성능 기록](ui-performance.md)의 `2026-10-08 v2 하위 프로젝트 1` 절에 있습니다.

아이콘은 Lucide(`~icons/lucide/*`)를 개별 정적 import로 쓰고, 한 곳(`src/components/icons.tsx`)에서 내보냅니다. 라벨에는 선 아이콘을 쓰지 않고 이모지만 보입니다(`v0.14.9`). 저장 형식의 라벨 `icon` 칸은 옛 버전이 읽도록 남겨 두었습니다.

단위 테스트는 `vitest.config.ts`에서 기본 worker를 2개로 제한합니다. 여러 jsdom/MUI 통합 테스트를 CPU 수만큼 병렬 실행할 때 생기는 과부하와 타임아웃 후 후속 테스트 간섭을 줄이기 위한 설정입니다. 테스트 한 건의 기본 제한은 5초입니다. 필요하면 `yarn test --maxWorkers=N`으로 병렬 수를 명시할 수 있습니다.

최종 검증은 lint → typecheck → `yarn test` → validate → build → build:map → E2E 순서로 실행합니다. 기존 미추적 scratch 파일 `inspect-mobile.mjs`, `verify-concepts.mjs`가 있는 로컬 checkout에서는 `yarn lint --ignore-pattern inspect-mobile.mjs --ignore-pattern verify-concepts.mjs`로 검사하며 이 제외는 제품 코드 제외가 아닙니다.

## 옛 파이프라인 (새 화면에는 연결되지 않은 남은 도구)

> 옛 정적 뷰어의 데이터 파이프라인입니다. `yarn collect`/`yarn validate`와 `pipeline/**`(`yarn apply-edit` 포함)은 그대로 동작하지만, 새 앱 화면에는 연결되어 있지 않습니다. 이 방식으로 만든 `public/data/<publicId>.json`은 `/t/<publicId>`에서 보관함으로 가져옵니다. 지금 앱에서 장소를 모으는 길은 링크 붙여넣기·네이버 폴더 가져오기·핀 찍기이고, 여행은 `/trips`에서 만듭니다. `yarn apply-edit`이 읽는 옛 편집 내보내기 파일(`*.tripedit.json`)은 앱이 더는 만들지 않습니다.

1. `trips/<여행>.yaml`을 작성합니다. 형식은 `trips/example.yaml` 참고.
   - `folders`에 네이버 지도 공유 폴더의 shareId를 적습니다(배포 JSON에는 들어가지 않음).
   - 폴더에 저장하지 않은 장소는 `naverPlaces`에 네이버 장소 ID(`map.naver.com/p/entry/place/<ID>`의 숫자)를 적습니다. collect가 장소 API로 이름·주소·좌표·분류를 가져오며, 폴더 장소처럼 분류 필터와 [네이버에서 열기]가 동작합니다. 같은 장소가 폴더에도 있으면 폴더 데이터(메모·저장일)를 쓰고, 폴더에서 사용 불가·범위 밖으로 제외된 장소는 `naverPlaces`로도 되살리지 않습니다.
   - 네이버 장소가 아닌 지점(역·랜드마크 대표 좌표 등)은 `customPlaces`에 좌표로 적습니다. 분류와 네이버 링크는 없습니다.
   - `days[].stops[].place`는 네이버 장소 `sid`(폴더 또는 `naverPlaces`) 또는 `customPlaces[].key`.
   - 출발지에 집 주소·좌표를 쓰지 말고 인근 역 같은 대표 지점을 씁니다(아래 공개 범위).
   - `publicId`와 `stop.id`는 비워 두면 collect가 생성해 yaml에 기록합니다.
2. `yarn collect trips/<여행>.yaml` — 네이버 저장 목록과 자동차 경로를 받아 `public/data/<publicId>.json`을 만듭니다.
   - 실패한 구간은 직선으로 표시되고 다음 collect에서 다시 시도합니다. `--refresh-routes`면 캐시를 무시하고 모든 구간을 다시 조회합니다.
3. 옛 앱에서는 yaml과 JSON을 함께 커밋·push해 Cloudflare Pages로 배포했습니다. 지금은 `.gitignore`가 `trips/*`(`example.yaml` 제외)와 `public/data/*`를 막으므로, 이 결과를 배포하려면 직접 판단해 강제로 추가해야 합니다(아래 공개 범위).
4. 옛 앱에서는 `https://<도메인>/t/<publicId>`가 공유 링크였습니다. 이제 이 경로는 옛 여행 가져오기 화면입니다.

### 경로 캐시 (`.cache/routes`)

- 구간 경로는 `.cache/routes/<sha256>.json`에 캐시합니다. 키는 출발·도착 좌표(소수 7자리)와 경로 옵션이라, 장소 좌표가 바뀌면 자동으로 캐시 미스가 납니다.
- **gitignore 대상**입니다. 다른 컴퓨터나 새 clone에서는 캐시가 비어 있어 첫 collect가 모든 구간을 다시 조회합니다.
- 실패한 조회는 캐시하지 않습니다.

## 배포 (Cloudflare Pages)

공개 GitHub repo `sch0718/landmark`의 `main`을 Cloudflare Pages 프로젝트 `landmark`에 연결했습니다. 운영 주소는 커스텀 도메인 **https://landmark.sch0718.dev**이고(Pages 프로젝트의 Custom domains에 연결), Pages 기본 주소 `https://landmark-c5f.pages.dev`도 그대로 열립니다. 브랜치 미리보기는 `https://<이름>.landmark-c5f.pages.dev`입니다.

장소·여행은 브라우저에 주소(출처)별로 따로 저장됩니다. 기본 주소에서 쓰던 기기는 그 주소에서 `전체 백업`을 받아 운영 도메인에서 `복원`하세요. 서버 함수가 받는 출처는 `src/server/http.ts`의 허용 목록에 있습니다(도메인을 바꾸면 여기와 `src/share-viewer/encode.ts`의 `DEFAULT_APP_URL`, `src/sections/trips/planner/naver-directions.ts`의 `APP_NAME`을 함께 고칩니다).

| 설정                                | 값                                                               |
| ----------------------------------- | ---------------------------------------------------------------- |
| 빌드 명령                           | `yarn build:ci`                                                  |
| 출력 디렉터리                       | `dist`                                                           |
| 환경변수 `NODE_VERSION`             | `24` (engines 검사는 `.yarnrc`의 `ignore-engines true`로 건너뜀) |
| 환경변수 `VITE_NAVER_MAP_CLIENT_ID` | NCP Client ID (Production·Preview 모두)                          |
| 환경변수 `GITHUB_PACKAGES_TOKEN` | `read:packages` classic 토큰(비밀값, Production·Preview 모두). 없으면 `yarn install`이 실패해 배포되지 않음 |

- `yarn build:ci`는 `yarn validate && yarn typecheck && yarn test && yarn build && yarn size --require-lazy … && yarn build:map`입니다. 검증이나 테스트가 실패하거나, 첫 화면 JS가 예산(`perf-budget.json`)을 넘거나, 나눠 받아야 하는 화면(`--require-lazy`로 지정)이 첫 화면에 합쳐져 따로 나뉘지 않으면 배포되지 않습니다.
- 저장소 루트의 `functions/`는 Pages가 자동으로 서버 함수(`/api/place`, `/api/naver-folder`, `/api/route`, `/api/search`, `/api/hours`, `/api/meet*`, `/api/share*`, `/s/*`)로 배포합니다. 약속·짧은 링크는 위의 D1·Turnstile·시크릿 설정이 필요합니다. 장소·폴더·경로·검색·영업시간 결과는 Cloudflare Cache API에 장소 1일·폴더 10분·경로(자동차·대중교통 1시간, 도보 7일)·검색 7일·영업시간 1일 동안 둡니다. 약속·짧은 링크 응답은 캐시하지 않습니다.
- **롤백**: 주요 변경마다 버전 태그(`v0.1.0`~)와 [GitHub Release](https://github.com/sch0718/landmark/releases)를 만듭니다. 배포만 되돌리기(Cloudflare 대시보드), 코드 되돌리기(`git revert` PR), 버전별 데이터 호환은 [롤백](rollback.md)에 있습니다.
- SPA 라우팅은 Pages 기본 동작(404.html이 없으면 index.html)을 씁니다.
- `public/_headers`: 전체 `X-Robots-Tag: noindex`, `/data/*`는 `Cache-Control: public, max-age=60`.
- GitHub Actions(`.github/workflows/ci.yml`)는 push·PR마다 lint, `build:ci`, 핵심 E2E(`test:e2e:ci`)를 돌리는 보조 검증입니다(수동 실행에서 `full_e2e`를 고르면 전체 E2E). `check`(lint·`build:ci`)와 `e2e`는 따로 동시에 돌고 각각 30분 제한입니다. `e2e`는 브라우저가 든 Playwright 공식 이미지(`mcr.microsoft.com/playwright:v<버전>-noble`)에서 돌므로 `@playwright/test`를 올리면 `ci.yml`의 이미지 태그도 같이 올립니다. 공용 패키지를 설치하려면 job의 `packages: read`와 패키지 Manage Actions access의 `sch0718/landmark` Read 등록이 필요합니다. 배포 여부는 Pages 빌드 명령이 결정합니다.

## 공유 파일과 지도 페이지

- **링크 공유**: 내보내기·일정 공유 창에서 `링크 복사` 또는 `링크 공유`로 보내면 `/view#d=…`에서 바로 보고 `Landmark에 담기`로 가져옵니다. 이 긴 링크의 데이터는 링크 안에만 있으며 서버에 저장하지 않습니다. 메모 포함 시 링크를 받은 누구나 메모를 볼 수 있고, 너무 큰 링크는 HTML 파일로 보내세요.
- **카카오톡 짧은 링크**: 긴 링크가 카카오톡 한도(400자)를 넘으면 `카카오톡`이 암호화한 사본을 서버에 맡기고 `/s/<id>#k=…`를 보냅니다(위 "공유 짧은 링크"). 받은 사람이 열면 같은 `/view#d=…`로 바뀝니다.
- **보기 경로**: `yarn build:viewer`가 `public/view.html`도 만듭니다. Cloudflare Pages의 정적 HTML 경로(`/view`)로 제공하며 옛 배포로 되돌리면 이 링크는 열리지 않습니다.
- **내보내기**: 보관함에서 장소를 고르고(없으면 지금 보이는 목록) `내보내기`를 누르면 HTML 파일 하나가 만들어집니다. 받는 사람은 설치·로그인 없이 휴대폰·PC에서 열어 보기만 합니다. 파일은 미리 빌드한 보기 화면 틀(`public/share-viewer.html`, `yarn build:viewer`)에 데이터를 끼워 만듭니다.
- **지도 페이지**: 내보낸 파일의 지도는 파일 안 iframe이 띄우는 별도 페이지(`https://sch0718.github.io/landmark/`, `yarn build:map` → `dist-map/`)입니다. 이 저장소의 `gh-pages` 브랜치(GitHub Pages)에 올라가며, 워크플로 `.github/workflows/deploy-share-map.yml`이 `main`에 지도 관련 파일(`src/share-map/**`, `src/components/map/**` 등)이 바뀔 때 자동으로, 또는 수동 실행으로 배포합니다. 저장소 변수 `NAVER_MAP_CLIENT_ID`가 비어 있으면 배포 전에 멈추고, NCP 콘솔 Web 서비스 URL에 `https://sch0718.github.io`가 등록돼 있어야 합니다.
- **가져오기**: 받은 파일을 앱의 ＋ 시트에서 고르거나(PC는 끌어 놓기도), 보기 화면의 `Landmark에 담기`로 `/import`를 열어 미리보기에서 넣을 장소와 라벨을 정해 내 보관함에 합칩니다.
- **약속 링크**: 새 약속의 `/meet/<id>`는 서버 사본을 읽어 답장을 자동 집계합니다. 주최자 토큰이 없고 다른 참석자의 답장이 이미 있는 약속은 기존 링크 방식을 유지합니다. 후보(`/meet#d=`)·답장(`#r=`)·확정(`#f=`) 읽기와 답장 `반영`은 그대로 남습니다. `MEET_ONLINE=off`일 때 처음 보내는 약속도 링크 방식으로 공유합니다.
- 설계: `docs/superpowers/specs/2026-10-11-html-share-export-design.md`, `2026-10-13-share-import-design.md`, `2026-10-16-trip-share-design.md`, `2026-10-22-share-link-design.md`, `2026-10-23-meeting-place-design.md`, `2026-10-25-meeting-online-design.md`, `2026-10-28-share-short-link-design.md`.

## 공개 범위 주의

저장소가 공개이므로 커밋한 파일은 누구나 볼 수 있습니다. 그래서 `.gitignore`가 개인 여행 yaml(`trips/*`, 네이버 폴더 shareId 포함)과 수집 결과(`public/data/*`)를 막고 `trips/example.yaml`만 추적합니다. 또 **배포된 `public/data/*.json`은 공개 파일**입니다. `noindex`는 검색 엔진에 대한 지시일 뿐 접근 제어가 아니며, URL을 아는 사람은 누구나 JSON 전체를 받을 수 있습니다.

| 데이터              | 처리                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 네이버 폴더 shareId | 배포하지 않습니다(`f1` 같은 내부 ID로 대체). shareId가 있으면 폴더 전체를 조회할 수 있기 때문                                    |
| 네이버 저장 메모    | 기본 배포. 민감한 메모가 있는 여행은 yaml에 `publish.naverMemo: false`                                                           |
| 집 등 사적 좌표     | customPlaces에 정확한 위치 대신 인근 역 등 대표 지점을 씁니다(구간 경로가 그 지점에서 시작하므로 좌표만 숨기는 방식은 쓰지 않음) |
| 제목·일정·장소      | 공개를 전제로 합니다. 더 강한 보호는 PoC 이후 로그인 단계에서 다룹니다                                                           |

보관함 전체를 서버로 보내지는 않습니다. 장소 추가·경로 계산에 쓰는 서버 함수는 입력한 링크·좌표를 해석하려고 받고 결과를 캐시합니다. 온라인 약속은 공유할 때 참석자 이름·출발지 좌표, 후보·소요시간과 답장을 D1에 저장합니다. 친구 링크를 받은 사람은 약속과 집계를 볼 수 있으며, 남의 출발지 좌표는 가립니다. 주최자 링크를 가진 기기는 약속을 고치고 전체 출발지 좌표를 볼 수 있습니다. 카카오톡으로 장소·일정을 보내면 짧은 링크를 위해 공유 문서(선택 시 메모 포함)를 브라우저에서 암호화해 D1에 장소 30일·일정 최대 180일 동안 둡니다. 푸는 키는 링크에만 있어 서버는 내용을 읽을 수 없고, 링크를 받은 사람은 누구나 볼 수 있습니다. 보낸 기기의 설정 › `보낸 짧은 링크`에서 먼저 지울 수 있습니다. 내보낸 HTML 파일에는 고른 장소(와 선택 시 메모)가 들어 있어, 그 파일을 받은 사람은 누구나 볼 수 있습니다. 보관함 전체의 기기 간 자동 동기화는 없습니다.

## 알려진 한계

- **Web Locks 미지원 브라우저의 동시 저장**: 보관함 저장(`LibraryStore.update`)은 Web Locks(`navigator.locks`)로 직렬화하고, 저장 직전에 최신 문서를 다시 읽어 변경만 적용합니다. 그래서 오래된 화면을 연 두 탭이 서로 다른 장소를 고쳐도 둘 다 남습니다. 지원하지 않는 브라우저에서는 잠금 없이 저장하므로, 두 탭이 거의 동시에 저장하면 한쪽 변경이 덮어써질 수 있습니다.
- **같은 필드를 두 탭에서 고칠 때는 최신 시각 우선(LWW)**: 이름·분류·메모·라벨 목록은 필드마다 `updatedAt`이 더 나중인 쪽이 이깁니다. 기기 시계가 틀리면 오래된 편집이 이길 수 있습니다.
- **메모 자동 저장은 탭을 바로 닫을 때 최선 노력(best-effort)**: 입력을 멈추고 600ms 뒤 저장합니다. 다른 화면으로 이동하거나 탭을 백그라운드로 보낼 때는 대기 중인 초안을 먼저 저장해 안정적이지만, 탭·브라우저를 강제로 닫는 순간에는 저장이 비동기 Web Lock 안에서 실행되어 마지막 입력(최대 약 0.6초)을 잃을 수 있습니다.
- **장소 상세에는 길찾기 링크 없음**: 길찾기는 여행 구간·당일 모드·약속 확정에만 있습니다. 장소 상세에는 "네이버 지도에서 열기"가 있습니다.
- **온라인 약속은 열린 화면에서 확인**: 친구 답장은 10초마다 확인하며 화면이 숨겨지거나 오프라인이면 멈춥니다. 서버 장애 때는 마지막 집계를 보이고, 새 약속 공유는 다시 시도해야 합니다(`MEET_ONLINE=off`만 링크 방식으로 공유). 이미 답장 링크로 주고받은 약속은 주최자가 `반영`하는 방식을 유지합니다. 대중교통 소요시간은 네이버 비공식 경로 API로 조회해 바뀌거나 막힐 수 있습니다.
- **localStorage 의존**: 보관함(장소·라벨·여행)은 이 기기·이 브라우저에만 있습니다. 브라우저 데이터 정리나 일부 사생활 보호 모드(저장소 차단)에서는 사라지거나 메모리 모드(배너로 알림, 새로고침하면 사라짐)로 동작합니다. 그래서 설정의 `백업`에서 보관함 전체(와 테마·보기 설정)를 백업 파일(`landmark-backup-YYYY-MM-DD-HHmm.json`)로 받거나 공유할 수 있고, 7일 넘게 백업하지 않으면 보관함 위에 알림 띠가 뜹니다. `백업 파일로 되살리기`는 지금 보관함을 `tripmap:library:v2:before-restore`에 사본으로 남긴 뒤 바꾸며, 토스트의 `되돌리기`와 설정의 `되살리기 전으로 되돌리기`로 사본을 되돌릴 수 있습니다. 저장된 문서가 손상됐으면 원문을 `tripmap:library:v2:corrupt-<시각>` 키에 남기고 복구 화면에서 `백업 파일 받기`·`백업 파일로 되살리기`·`새로 시작`을 고르게 합니다. 기기 간 자동 동기화는 없습니다. 다른 기기로 옮기려면 백업 파일을 받아 그 기기에서 되살리거나(여행·설정 포함), 장소·라벨과 (선택 시) 메모만 담은 HTML 공유 파일로 내보내 가져옵니다.
- **옛 여행 가져오기**: 가져오기는 옛 여행 하나(`/t/<publicId>`)를 미리보기·결정 후 보관함에 합칩니다. 긴 라벨 이름(30자 초과)·긴 메모(10,000자 초과)는 조용히 자르지 않고 사용자가 고르거나 제외해야 적용됩니다. 옛 편집 레이어(`tripmap:edit:<publicId>`)는 읽기만 하고 지우지 않으며, 같은 여행을 다시 가져오면 이미 있는 장소(네이버 `sid` 기준)는 새로 만들지 않고 라벨만 합칩니다.
- **네이버 비공식 API**: 저장 목록·길찾기 API는 공개 API가 아니어서 언제든 바뀌거나 막힐 수 있습니다. 옛 파이프라인의 수집은 로컬에서만 하고 결과를 커밋하므로 배포된 앱은 영향을 받지 않으며, 호출은 `pipeline/naver-client.ts` 한 파일에 모여 있습니다.
- **NaverMapAdapter는 실제 키로 수동 확인 필요**: 자동 테스트는 가짜 SDK·가짜 지도로만 돌기 때문에, 실제 네이버 지도 렌더링(라벨 색 마커·영역 이동·선택 연동)은 실제 Client ID로 배포한 뒤 눈으로 확인해야 합니다.
- **실물 기기 미확인**: E2E는 에뮬레이션(Chromium 1280×800·360×780, WebKit iPhone 13)입니다. 실제 iPhone·Android 점검은 다듬기 D4에서 합니다(아직 하지 않았습니다).
