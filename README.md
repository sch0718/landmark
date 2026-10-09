# trip-map

평소에 모아 두고(보관함), 여행 때 꺼내 쓰는(계획) 장소 보관함 웹앱입니다. 맛집·가 보고 싶은 곳을 **라벨**(한 장소에 여러 개)로 모으고 메모를 남기며, 라벨·지역별로 나눠 보고 지도에서 확인합니다. 여행 계획(Day 배치·경로·이동 시간)은 이어지는 하위 프로젝트에서 붙습니다.

- 서버 DB와 로그인이 없습니다. 보관함은 **각 기기 브라우저의 localStorage**(`tripmap:library:v2`)에 저장되고, 화면 설정은 `tripmap:prefs`에 저장됩니다. 저장소를 쓸 수 없는 환경(예: 일부 사생활 보호 모드)에서는 메모리 모드로 동작하며 배너로 알립니다.
- 옛 버전(정적 여행 뷰어)의 여행은 `/t/<publicId>`에서 **미리보기 → 결정 → 가져오기**로 새 보관함에 옮깁니다. 옛 편집 레이어(`tripmap:edit:<publicId>`)는 읽기만 하고 지우지 않습니다.
- 앱은 Effect 4 기반입니다(`effect`·`@effect/vitest` 4.0.2 고정).
- 하위 프로젝트 1(기반 + 보관함) 설계 문서: `docs/superpowers/specs/2026-10-08-place-library-design.md`. 옛 설계: `docs/superpowers/specs/2026-10-03-trip-map-design.md`

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

### 환경변수

| 이름                       | 용도                                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| `VITE_NAVER_MAP_CLIENT_ID` | 네이버 지도 JS API v3(NCP) Client ID. 로컬은 `.env.local`(gitignore)에 둡니다 |
| `VITE_MAP_ADAPTER`         | `fake`면 네이버 SDK 대신 DOM 가짜 지도를 씁니다(E2E·키 없는 개발용)           |

```bash
echo 'VITE_NAVER_MAP_CLIENT_ID=<발급받은 Client ID>' > .env.local
```

**NCP 콘솔 도메인 등록**: Maps 애플리케이션의 Web 서비스 URL에 아래 두 곳을 등록해야 지도가 뜹니다.

- Cloudflare Pages 도메인(예: `https://<프로젝트>.pages.dev`, 커스텀 도메인을 쓰면 그것도)
- `http://localhost:5173`

NCP Maps 요금·무료 사용량: **확인 필요**(배포 후 확인해 날짜와 함께 여기에 기록).

## 개발

```bash
yarn dev                           # http://localhost:5173 (네이버 지도, .env.local 필요)
VITE_MAP_ADAPTER=fake yarn dev     # 가짜 지도
```

### 화면 경로

| 경로           | 화면                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `/`            | 보관함(카드·타일·목록·벤토 보기, 라벨·지역 필터, 정렬, 선택 일괄 작업)     |
| `/map`         | 보관함 지도(라벨 색 마커, 보관함과 같은 필터)                              |
| `/place/:id`   | 장소 상세(이름·분류 편집, 라벨 붙이기·떼기, 메모 자동 저장, 삭제 되돌리기) |
| `/labels`      | 라벨 관리(이름·색·아이콘·순서·병합·삭제)                                   |
| `/settings`    | 설정(테마, 옛 여행 가져오기)                                               |
| `/trips`       | 여행(자리 표시. 하위 프로젝트 3에서 채움)                                  |
| `/t/:publicId` | 옛 여행 가져오기                                                           |

- 화면 폭에 따라 ≥1280px 3단, 768–1279px 2단 + 상세 오버레이, 768px 미만 하단 탭입니다.
- **메모 자동 저장**: 입력을 멈춘 뒤 저장하고, 다른 화면으로 이동하거나 탭을 백그라운드로 보낼 때 대기 중인 초안을 먼저 저장합니다. 탭·브라우저를 바로 닫을 때는 저장이 비동기 Web Lock 안에서 실행되므로 **최선 노력(best-effort)** 입니다. 백그라운드 전환과 앱 안 이동에서는 안정적으로 저장됩니다.
- 장소 상세에 **길찾기 링크는 아직 없습니다.** 네이버 지도 앱 길찾기 URL 형식을 근거 있게 확인하지 못해 일부러 뺐고, 확인되면 추가합니다. "네이버 지도에서 열기"는 있습니다.

| 명령                 | 내용                                                                                |
| -------------------- | ----------------------------------------------------------------------------------- |
| `yarn lint`          | ESLint                                                                              |
| `yarn fm:check`      | Prettier 포맷 검사                                                                  |
| `yarn typecheck`     | `tsc -b --noEmit`                                                                   |
| `yarn test`          | Vitest 단위·컴포넌트 테스트                                                         |
| `yarn test:e2e`      | Playwright E2E(아래)                                                                |
| `yarn validate`      | `trips/*.yaml`과 `public/data/*.json` 스키마 검증                                   |
| `yarn effect:source` | `.reference/effect/`에 현재 `effect` 버전의 소스를 받습니다(API 확인용, 커밋 안 함) |
| `yarn build`         | 타입 검사 + Vite 빌드 → `dist`                                                      |
| `yarn build:ci`      | `validate → typecheck → test → build` (배포 빌드 명령)                              |

### E2E

```bash
yarn playwright install chromium webkit   # 처음 한 번
yarn test:e2e:ci                          # CI 핵심 사용자 흐름
yarn test:e2e                             # 전체
```

- 프로젝트(`playwright.config.ts`): `desktop`(Chromium 1280×800, 3단), `iphone`(WebKit, iPhone 13 390×844), `galaxy`(Chromium 360×780, 터치). 핵심 흐름 테스트 제목에 `@smoke`가 붙어 있고 CI(`test:e2e:ci`)는 그것만 돌립니다.
- spec: `library.spec.ts`(라벨 필터·목록·지도·상세, 모바일 시트·라벨·메모·새로고침, 두 탭 동시 메모), `legacy-import.spec.ts`(`/t/e2etest000001` 가져오기), `themes.spec.ts`(테마 3 × 라이트/다크 스크린샷).
- 보관함 시드는 `tests/fixtures/library/seed.json`(장소 30·라벨 6)을 `page.addInitScript`로 `localStorage['tripmap:library:v2']`에 심습니다. 형식은 `tests/unit/schema/library-seed.test.ts`가 `LibrarySchema`로 검증합니다.
- 스크린샷은 `test-results/screens/`(보관함·상세)와 `test-results/themes/<project>-<theme>-<mode>.png`에 남습니다. 비교 단언 없는 산출물이며, Playwright가 실행할 때마다 `test-results/`를 비우므로 전체 실행(`yarn test:e2e`) 뒤에 확인하세요.
- 실물 iPhone·Android는 이 E2E로 대체되지 않습니다(에뮬레이션). 실물 기기 점검은 하위 프로젝트 5에서 하며 아직 하지 않았습니다.
- global setup이 `tests/fixtures/trips/e2e.json`을 `public/data/e2etest000001.json`으로 복사하고 teardown이 지웁니다. 이 파일은 커밋하지 않습니다(`.gitignore`). 옛 여행 가져오기(`/t/e2etest000001`) 시험에 쓰입니다.
- 지도는 `VITE_MAP_ADAPTER=fake`로 DOM 가짜 지도를 씁니다. 유효 키의 실 SDK 및 실물 기기 테스트와 구분합니다.

### 측정과 구현 호환

제품 `f9f8fc2`의 과거 검증은 CI678·native68 PASS/3 skip·production39 first PASS/FLAKY0입니다. 활성 geometry의 과거 cache 복귀를 막는 수정과 실제 입력 회귀를 포함합니다. 당시 CPU4x p95 60.4/56.0/122.0/49.5/135.5ms와 장소→일정 >100ms 작업3건은 이전 엄격한 예산에서 FAIL이었습니다. 2026-10-05 사용자 결정으로 PoC 목표를 p95≤300ms·30회 중 >100ms 작업 최대5회로 완화해 이 기록을 수용합니다. 최신 성능 재측정 결과는 아닙니다. [성능 기록](docs/ui-performance.md)에 과거 판정과 원자료를 보존합니다.

CI는 PR과 main push에서 핵심 사용자 흐름(`@smoke`)만 실행하고, 전체 E2E는 수동 실행(workflow_dispatch)으로 분리했습니다. (옛 화면 시절의 [검증 범위](docs/ui-validation.md) 문서는 v2에서 대체됐습니다.)

```bash
VITE_MAP_ADAPTER=fake yarn build
node scripts/measure-ui-assets.mjs dist/assets
```

측정 스크립트는 JS/CSS 파일별 원본·gzip 바이트와 전체 합을 JSON으로 출력하며 앱 코드·SDK 키를 읽지 않습니다. source map의 크기는 다운로드 비용에서 제외합니다. 초기 진입 청크·외부 SDK 요청은 별도 브라우저 측정이 필요합니다. v2 전후 번들 비교는 [성능 기록](docs/ui-performance.md)의 `2026-10-08 v2 하위 프로젝트 1` 절에 있습니다.

아이콘은 Lucide(`~icons/lucide/*`)를 개별 정적 import로 쓰고, 한 곳(`src/components/icons.tsx`)에서 내보냅니다.

단위 테스트는 `vitest.config.ts`에서 기본 worker를 2개로 제한합니다. 여러 jsdom/MUI 통합 테스트를 CPU 수만큼 병렬 실행할 때 생기는 과부하와 타임아웃 후 후속 테스트 간섭을 줄이기 위한 설정입니다. 일반 테스트의 기본 제한은 5초이며, 여러 뷰와 화면 폭을 연속 전환하는 지도 수명 통합 테스트 한 건만 15초입니다. 필요하면 `yarn test --maxWorkers=N`으로 병렬 수를 명시할 수 있습니다.

최종 검증은 lint → typecheck → `yarn test` → validate → build → E2E 순서로 실행합니다. 기존 미추적 scratch 파일 `inspect-mobile.mjs`, `verify-concepts.mjs`가 있는 로컬 checkout에서는 `yarn lint --ignore-pattern inspect-mobile.mjs --ignore-pattern verify-concepts.mjs`로 검사하며 이 제외는 제품 코드 제외가 아닙니다.

## 여행 추가 (옛 파이프라인 — 하위 프로젝트 2·3에서 대체 예정)

> 이 절과 아래 "일정 재계산 절차"는 옛 정적 뷰어의 데이터 파이프라인입니다. `yarn collect`/`yarn apply-edit`/`yarn validate`와 `pipeline/**`은 그대로 동작하지만, 새 보관함 화면에는 연결되어 있지 않습니다. 이 방식으로 만든 `public/data/<publicId>.json`은 `/t/<publicId>`에서 보관함으로 가져옵니다. 장소 추가(링크 붙여넣기·네이버 폴더 가져오기·핀 찍기)와 여행 계획은 하위 프로젝트 2·3에서 새로 만듭니다.

1. `trips/<여행>.yaml`을 작성합니다. 형식은 `trips/example.yaml` 참고.
   - `folders`에 네이버 지도 공유 폴더의 shareId를 적습니다(배포 JSON에는 들어가지 않음).
   - 폴더에 저장하지 않은 장소는 `naverPlaces`에 네이버 장소 ID(`map.naver.com/p/entry/place/<ID>`의 숫자)를 적습니다. collect가 장소 API로 이름·주소·좌표·분류를 가져오며, 폴더 장소처럼 분류 필터와 [네이버에서 열기]가 동작합니다. 같은 장소가 폴더에도 있으면 폴더 데이터(메모·저장일)를 쓰고, 폴더에서 사용 불가·범위 밖으로 제외된 장소는 `naverPlaces`로도 되살리지 않습니다.
   - 네이버 장소가 아닌 지점(역·랜드마크 대표 좌표 등)은 `customPlaces`에 좌표로 적습니다. 분류와 네이버 링크는 없습니다.
   - `days[].stops[].place`는 네이버 장소 `sid`(폴더 또는 `naverPlaces`) 또는 `customPlaces[].key`.
   - 출발지에 집 주소·좌표를 쓰지 말고 인근 역 같은 대표 지점을 씁니다(아래 공개 범위).
   - `publicId`와 `stop.id`는 비워 두면 collect가 생성해 yaml에 기록합니다.
2. `yarn collect trips/<여행>.yaml` — 네이버 저장 목록과 자동차 경로를 받아 `public/data/<publicId>.json`을 만듭니다.
   - 실패한 구간은 직선으로 표시되고 다음 collect에서 다시 시도합니다. `--refresh-routes`면 캐시를 무시하고 모든 구간을 다시 조회합니다.
3. yaml과 JSON을 함께 커밋·push → Cloudflare Pages가 배포합니다.
4. 옛 앱에서는 `https://<도메인>/t/<publicId>`가 공유 링크였습니다. 이제 이 경로는 옛 여행 가져오기 화면입니다.

### 경로 캐시 (`.cache/routes`)

- 구간 경로는 `.cache/routes/<sha256>.json`에 캐시합니다. 키는 출발·도착 좌표(소수 7자리)와 경로 옵션이라, 장소 좌표가 바뀌면 자동으로 캐시 미스가 납니다.
- **gitignore 대상**입니다. 다른 컴퓨터나 새 clone에서는 캐시가 비어 있어 첫 collect가 모든 구간을 다시 조회합니다.
- 실패한 조회는 캐시하지 않습니다.

## 일정 재계산 절차 (작성자, 옛 파이프라인)

> 옛 편집 내보내기(설정 → 내보내기)와 가져오기·병합 대화상자(`src/sections/share/**`)는 코드로 남아 있지만 지금 라우트에는 연결되어 있지 않습니다. 아래 절차의 1–2단계는 하위 프로젝트 4(공유)에서 새 화면으로 다시 만들어질 때까지 앱에서 할 수 없습니다.

앱에서 바꾼 일정(순서 변경·이동·추가)은 실경로가 없어 "직선 · 재계산 필요"로 표시됩니다. 실경로로 바꾸려면:

1. 동행자 편집을 가져와 병합하고, 일정이 원하는 상태인지 앱에서 확인합니다.
2. 앱에서 **파일로 내보내기**(설정 ⚙ → 내보내기 → 파일로 저장).
3. `yarn apply-edit trips/<여행>.yaml <파일>.tripedit.json`
   - 모든 검사를 통과했을 때만 yaml을 기록합니다. 하나라도 실패하면 yaml은 바뀌지 않습니다.
   - 로컬이 `origin`보다 뒤처졌거나 편집 파일이 로컬 JSON보다 새 원본 기준이면 멈추고 "`git pull`로 최신 yaml과 JSON을 함께 받으세요"라고 안내합니다. **최신 기준을 확보하는 방법은 `git pull`뿐입니다.** `collect`를 다시 돌려도 `dataVersion`만 새로워질 뿐 오래된 yaml 내용은 그대로이므로 해결책이 아닙니다.
   - 미해결 원본 변경, 정리 과정에서 사라질 방문, collect 이후 직접 고친 yaml이 있으면 목록을 출력하고 멈춥니다.
   - 메모·태그·숨김·분류는 yaml로 옮기지 않습니다(편집 레이어에 남음).
4. `yarn collect trips/<여행>.yaml` — 새 구간만 API를 호출하고 기존 구간은 캐시를 씁니다.
5. 커밋·push → 배포. 다음에 앱을 열면 내 override가 새 원본과 같음을 확인하고 자동으로 정리합니다.

## 배포 (Cloudflare Pages)

비공개 GitHub repo를 Cloudflare Pages에 연결합니다.

| 설정                                | 값                                                               |
| ----------------------------------- | ---------------------------------------------------------------- |
| 빌드 명령                           | `yarn build:ci`                                                  |
| 출력 디렉터리                       | `dist`                                                           |
| 환경변수 `NODE_VERSION`             | `24` (engines 검사는 `.yarnrc`의 `ignore-engines true`로 건너뜀) |
| 환경변수 `VITE_NAVER_MAP_CLIENT_ID` | NCP Client ID (Production·Preview 모두)                          |

- `yarn build:ci`는 `yarn validate && yarn typecheck && yarn test && yarn build`입니다. 검증이나 테스트가 실패하면 배포되지 않습니다.
- SPA 라우팅은 Pages 기본 동작(404.html이 없으면 index.html)을 씁니다.
- `public/_headers`: 전체 `X-Robots-Tag: noindex`, `/data/*`는 `Cache-Control: public, max-age=60`.
- GitHub Actions(`.github/workflows/ci.yml`)는 push·PR마다 lint, `build:ci`, E2E를 돌리는 보조 검증입니다. 배포 여부는 Pages 빌드 명령이 결정합니다.

## 공개 범위 주의

비공개 repo여도 **배포된 `public/data/*.json`은 공개 파일**입니다. `noindex`는 검색 엔진에 대한 지시일 뿐 접근 제어가 아니며, URL을 아는 사람은 누구나 JSON 전체를 받을 수 있습니다.

| 데이터              | 처리                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 네이버 폴더 shareId | 배포하지 않습니다(`f1` 같은 내부 ID로 대체). shareId가 있으면 폴더 전체를 조회할 수 있기 때문                                    |
| 네이버 저장 메모    | 기본 배포. 민감한 메모가 있는 여행은 yaml에 `publish.naverMemo: false`                                                           |
| 집 등 사적 좌표     | customPlaces에 정확한 위치 대신 인근 역 등 대표 지점을 씁니다(구간 경로가 그 지점에서 시작하므로 좌표만 숨기는 방식은 쓰지 않음) |
| 제목·일정·장소      | 공개를 전제로 합니다. 더 강한 보호는 PoC 이후 로그인 단계에서 다룹니다                                                           |

보관함(장소·라벨·메모)은 각자 기기의 localStorage에만 있고 서버로 보내지 않습니다. 공유·내보내기 화면은 v2에 아직 없습니다(하위 프로젝트 4에서 새로 만듭니다).

## 알려진 한계

- **Web Locks 미지원 브라우저의 동시 저장**: 보관함 저장(`LibraryStore.update`)은 Web Locks(`navigator.locks`)로 직렬화하고, 저장 직전에 최신 문서를 다시 읽어 변경만 적용합니다. 그래서 오래된 화면을 연 두 탭이 서로 다른 장소를 고쳐도 둘 다 남습니다. 지원하지 않는 브라우저에서는 잠금 없이 저장하므로, 두 탭이 거의 동시에 저장하면 한쪽 변경이 덮어써질 수 있습니다.
- **같은 필드를 두 탭에서 고칠 때는 최신 시각 우선(LWW)**: 이름·분류·메모·라벨 목록은 필드마다 `updatedAt`이 더 나중인 쪽이 이깁니다. 기기 시계가 틀리면 오래된 편집이 이길 수 있습니다.
- **메모 자동 저장은 탭을 바로 닫을 때 최선 노력(best-effort)**: 입력을 멈추고 600ms 뒤 저장합니다. 다른 화면으로 이동하거나 탭을 백그라운드로 보낼 때는 대기 중인 초안을 먼저 저장해 안정적이지만, 탭·브라우저를 강제로 닫는 순간에는 저장이 비동기 Web Lock 안에서 실행되어 마지막 입력(최대 약 0.6초)을 잃을 수 있습니다.
- **길찾기 링크 없음**: 장소 상세에 길찾기 링크가 없습니다. 네이버 지도 길찾기 URL 형식을 근거 있게 확인하지 못해 일부러 뺐고, 실기기에서 확인되면 추가합니다. "네이버 지도에서 열기"는 있습니다.
- **localStorage 의존**: 보관함은 이 기기·이 브라우저에만 있습니다. 브라우저 데이터 정리나 일부 사생활 보호 모드(저장소 차단)에서는 사라지거나 메모리 모드(배너로 알림, 새로고침하면 사라짐)로 동작합니다. 저장된 문서가 손상됐으면 원문을 `tripmap:library:v2:corrupt-<시각>` 키에 남기고 복구 화면에서 "백업 파일 받기"를 안내합니다. 기기 간 동기화와 내보내기·공유는 아직 없습니다.
- **옛 여행 가져오기**: 가져오기는 옛 여행 하나(`/t/<publicId>`)를 미리보기·결정 후 보관함에 합칩니다. 긴 라벨 이름(30자 초과)·긴 메모(10,000자 초과)는 조용히 자르지 않고 사용자가 고르거나 제외해야 적용됩니다. 옛 편집 레이어(`tripmap:edit:<publicId>`)는 읽기만 하고 지우지 않으며, 같은 여행을 다시 가져오면 이미 있는 장소(네이버 `sid` 기준)는 새로 만들지 않고 라벨만 합칩니다.
- **네이버 비공식 API**: 저장 목록·길찾기 API는 공개 API가 아니어서 언제든 바뀌거나 막힐 수 있습니다. 옛 파이프라인의 수집은 로컬에서만 하고 결과를 커밋하므로 배포된 앱은 영향을 받지 않으며, 호출은 `pipeline/naver-client.ts` 한 파일에 모여 있습니다.
- **NaverMapAdapter는 실제 키로 수동 확인 필요**: 자동 테스트는 가짜 SDK·가짜 지도로만 돌기 때문에, 실제 네이버 지도 렌더링(라벨 색 마커·영역 이동·선택 연동)은 실제 Client ID로 배포한 뒤 눈으로 확인해야 합니다.
- **실물 기기 미확인**: E2E는 에뮬레이션(Chromium 1280×800·360×780, WebKit iPhone 13)입니다. 실제 iPhone·Android 점검은 하위 프로젝트 5에서 합니다.

## 수동 확인 체크리스트 (배포 후)

- [ ] 실제 네이버 지도 렌더링(라벨 색 마커·보관함 필터와 같은 표시·마커 선택 → 상세/목록 연동)
- [ ] iOS Safari: 보관함에 장소가 있는 상태에서 새로고침 → 라벨 붙이기 → 메모 입력 후 홈으로 나갔다 돌아와 저장 확인
- [ ] iOS Safari 사생활 보호 모드: 메모리 모드 배너가 뜨고 앱이 멈추지 않는지
- [ ] Android Chrome: 같은 흐름(하단 탭, 상세 시트, 일괄 선택 길게 누르기)
- [ ] 옛 여행 가져오기: `/t/<publicId>` 미리보기 → 긴 라벨 이름·긴 메모 결정 → 가져오기 → 보관함·지도에 반영
- [ ] 두 탭에서 각각 다른 장소의 메모를 고친 뒤 새로고침해 둘 다 남는지
- [ ] 다크 모드(세 테마)에서 다이얼로그·메뉴 표면색과 버튼 글자가 또렷한지

### 첫 배포 체크리스트 (작성자와 함께)

- [ ] Cloudflare Pages에 repo 연결, 빌드 명령·출력·`NODE_VERSION`·`VITE_NAVER_MAP_CLIENT_ID` 설정
- [ ] NCP 콘솔에 Pages 도메인과 `http://localhost:5173` 등록
- [ ] 실제 여행 yaml 작성 → `yarn collect` → 커밋·push → 배포 확인
- [ ] 위 수동 확인 체크리스트 수행
- [ ] NCP Maps 요금·무료 사용량을 확인해 이 README에 날짜와 함께 기록
