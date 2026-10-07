# trip-map

네이버 지도에 저장해 둔 장소와 일정을 한 화면(지도 + 목록 + 일정)으로 보고, 동행자와 링크·파일로 메모·일정 편집을 주고받는 정적 웹앱(PoC)입니다.

- 데이터는 **빌드 타임에 로컬 CLI로 수집**해 `public/data/<publicId>.json`으로 커밋하고, 앱은 완전한 정적 사이트로 배포합니다.
- 로그인·서버 DB가 없습니다. 편집은 보는 사람 브라우저의 localStorage에 저장되고, **내보내기(링크/파일) → 상대가 가져오기 → 병합**으로 공유합니다.
- 설계 문서: `docs/superpowers/specs/2026-10-03-trip-map-design.md`

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

여행 화면은 `/t/<publicId>`입니다(`/`는 안내 문구만 보여 주며 여행 목록을 노출하지 않습니다). **지도·일정·장소** 세 뷰를 아래 링크로 공유합니다.

```text
/t/<publicId>?view=map
/t/<publicId>?view=day&day=2
/t/<publicId>?view=day&day=all
/t/<publicId>?view=places&place=n%3A12345
```

기존 `?mode=explore|itinerary&day=2&place=<PlaceKey>` 링크와 `#e=...` 가져오기도 사용할 수 있습니다. 날짜 번호는 1부터 시작하며 마지막으로 고른 뷰는 브라우저에 여행별로 저장됩니다.

모바일에서는 하단에서 뷰를 바꾸고, 지도 목록 시트를 탭하거나 드래그해 peek/half/full로 펼칩니다. 일정은 날짜 탭과 편집 버튼, 장소는 검색·필터·카드/목록·빠른 추가를 제공합니다. 모바일 일정의 지도는 경로 지도 열기로 표시합니다. 데스크톱에서는 왼쪽 탐색과 목록을 쓰며, 넓은 화면(1440px 이상)은 상세를 320px dock으로 나란히 보여 줍니다. 메모 초안은 뷰 전환 후에도 이어서 작성할 수 있습니다.

장소 상세의 **분류 변경**으로 장소 분류를 바꿀 수 있습니다(예: `customPlaces`의 미분류 장소를 "공항"으로). 바꾼 분류는 편집 레이어에 저장되어 목록·카드, 분류 필터 칩과 개수, 지도 마커 색에 반영되고 내보내기·가져오기로 동행자와 병합됩니다. **원본으로**를 누르면 수집한 원본 분류로 돌아갑니다.

편집 공유는 기존처럼 **편집 링크/파일 → 가져오기 → 병합**으로 동작합니다. 편집 내보내기는 `schemaVersion: 1` 계약을 유지하며 뷰·카드/목록·스크롤 같은 UI 선호와 저장 전 초안을 포함하지 않습니다.

[실측 성능과 예산 판정](docs/ui-performance.md), [실물 기기 확인 범위](docs/ui-device-checks.md)를 참고하세요. 실물 iPhone Safari/Android Chrome과 유효 키 Naver SDK는 미실행이며 자동화 결과와 구분합니다.

| 명령             | 내용                                                   |
| ---------------- | ------------------------------------------------------ |
| `yarn lint`      | ESLint                                                 |
| `yarn fm:check`  | Prettier 포맷 검사                                     |
| `yarn typecheck` | `tsc -b --noEmit`                                      |
| `yarn test`      | Vitest 단위·컴포넌트 테스트                            |
| `yarn test:e2e`  | Playwright E2E(아래)                                   |
| `yarn validate`  | `trips/*.yaml`과 `public/data/*.json` 스키마 검증      |
| `yarn build`     | 타입 검사 + Vite 빌드 → `dist`                         |
| `yarn build:ci`  | `validate → typecheck → test → build` (배포 빌드 명령) |

### E2E

```bash
yarn playwright install chromium webkit   # 처음 한 번
yarn test:e2e:ci                          # CI 핵심 사용자 흐름
yarn test:e2e                             # 필요할 때 세부 회귀 전체
```

- 프로젝트 `desktop`(Chromium 1280×800): 일정 편집·되돌리기·가져오기, 두 탭 동시 저장(Web Locks), 세 뷰·검색·초안·시트·긴 텍스트 회귀. 390–1920px 경계 및 1440/1920px dock도 확인합니다.
- 프로젝트 `mobile`(iPhone 13 설정, WebKit 390×844): 링크 내보내기·가져오기와 뷰 회귀. 검색 focus는 390×664도 따로 확인합니다.
- 프로젝트 `narrow-mobile`(Chromium 320×568, touch): 뷰 회귀와 작은 화면 시트 첫 행·빠른 추가 표시. touch/desktop 전용 사례 3개는 OS 조건에 따라 skip합니다.
- fake 지도 서버(5173)와 빈 Client ID의 Naver 서버(5174)를 실행합니다. CI가 아니면 기존 서버를 재사용하므로, 직접 실행한 서버의 어댑터 설정을 확인하세요. 유효 키의 실 SDK 및 실물 기기 테스트와 구분합니다.
- global setup이 `tests/fixtures/trips/e2e.json`을 `public/data/e2etest000001.json`으로 복사하고 teardown이 지웁니다. 이 파일은 커밋하지 않습니다(`.gitignore`).

### 측정과 구현 호환

제품 `f9f8fc2`의 과거 검증은 CI678·native68 PASS/3 skip·production39 first PASS/FLAKY0입니다. 활성 geometry의 과거 cache 복귀를 막는 수정과 실제 입력 회귀를 포함합니다. 당시 CPU4x p95 60.4/56.0/122.0/49.5/135.5ms와 장소→일정 >100ms 작업3건은 이전 엄격한 예산에서 FAIL이었습니다. 2026-10-05 사용자 결정으로 PoC 목표를 p95≤300ms·30회 중 >100ms 작업 최대5회로 완화해 이 기록을 수용합니다. 최신 성능 재측정 결과는 아닙니다. [성능 기록](docs/ui-performance.md)에 과거 판정과 원자료를 보존합니다.

CI는 PR과 main push에서 핵심 사용자 흐름만 실행합니다. 500곳 전수 순회·20회 왕복 검사를 축소/제거하고, 세부 E2E는 수동 실행으로 분리했습니다. [검증 범위](docs/ui-validation.md)에 유지·제거한 항목과 실행 방법을 정리했습니다.

```bash
VITE_MAP_ADAPTER=fake yarn build
node scripts/measure-ui-assets.mjs dist/assets
```

측정 스크립트는 JS/CSS 파일별 원본·gzip 바이트와 전체 합을 JSON으로 출력하며 앱 코드·SDK 키를 읽지 않습니다. source map과 개발용 MDI 컬렉션의 패키지 크기는 다운로드 비용에서 제외합니다. 초기 진입 청크·아이콘만의 비용·외부 SDK 요청은 별도 브라우저 측정이 필요합니다.

MDI 아이콘은 개별 정적 import와 로컬 `build/compile-react-svg-icon.ts` compiler로 빌드합니다. 상세 dock은 MUI FocusTrap의 안정된 `isEnabled=false`로 외부 Tab 이동을 허용합니다. 기존 설치 구성에 맞춘 구현이며 런타임 아이콘·새 UI 라이브러리를 추가하지 않습니다.

단위 테스트는 `vitest.config.ts`에서 기본 worker를 2개로 제한합니다. 여러 jsdom/MUI 통합 테스트를 CPU 수만큼 병렬 실행할 때 생기는 과부하와 타임아웃 후 후속 테스트 간섭을 줄이기 위한 설정입니다. 일반 테스트의 기본 제한은 5초이며, 여러 뷰와 화면 폭을 연속 전환하는 지도 수명 통합 테스트 한 건만 15초입니다. 필요하면 `yarn test --maxWorkers=N`으로 병렬 수를 명시할 수 있습니다.

최종 검증은 lint → typecheck → `yarn test` → validate → build → E2E 순서로 실행합니다. 기존 미추적 scratch 파일 `inspect-mobile.mjs`, `verify-concepts.mjs`가 있는 로컬 checkout에서는 `yarn lint --ignore-pattern inspect-mobile.mjs --ignore-pattern verify-concepts.mjs`로 검사하며 이 제외는 제품 코드 제외가 아닙니다. URL과 UI의 동기화 규칙은 [상태 전이 문서](docs/ui-url-sync.md)에 정리했습니다.

## 여행 추가

1. `trips/<여행>.yaml`을 작성합니다. 형식은 `trips/example.yaml` 참고.
   - `folders`에 네이버 지도 공유 폴더의 shareId를 적습니다(배포 JSON에는 들어가지 않음).
   - `days[].stops[].place`는 네이버 장소 `sid` 또는 `customPlaces[].key`.
   - 출발지에 집 주소·좌표를 쓰지 말고 인근 역 같은 대표 지점을 씁니다(아래 공개 범위).
   - `publicId`와 `stop.id`는 비워 두면 collect가 생성해 yaml에 기록합니다.
2. `yarn collect trips/<여행>.yaml` — 네이버 저장 목록과 자동차 경로를 받아 `public/data/<publicId>.json`을 만듭니다.
   - 실패한 구간은 직선으로 표시되고 다음 collect에서 다시 시도합니다. `--refresh-routes`면 캐시를 무시하고 모든 구간을 다시 조회합니다.
3. yaml과 JSON을 함께 커밋·push → Cloudflare Pages가 배포합니다.
4. 공유 링크: `https://<도메인>/t/<publicId>`

### 경로 캐시 (`.cache/routes`)

- 구간 경로는 `.cache/routes/<sha256>.json`에 캐시합니다. 키는 출발·도착 좌표(소수 7자리)와 경로 옵션이라, 장소 좌표가 바뀌면 자동으로 캐시 미스가 납니다.
- **gitignore 대상**입니다. 다른 컴퓨터나 새 clone에서는 캐시가 비어 있어 첫 collect가 모든 구간을 다시 조회합니다.
- 실패한 조회는 캐시하지 않습니다.

## 일정 재계산 절차 (작성자)

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

편집 링크(`#e=…`)의 내용은 URL 프래그먼트라 서버로 전송되지 않지만, 링크를 받은 사람은 그 안의 메모를 모두 볼 수 있습니다.

## 알려진 한계

- **Web Locks 미지원 브라우저의 동시 저장**: 같은 여행을 여러 탭에서 편집할 때 저장은 Web Locks(`navigator.locks`)로 직렬화합니다. 지원하지 않는 브라우저에서는 잠금 없이 저장하므로, 두 탭이 거의 동시에 저장하면 한쪽 편집이 덮어써질 수 있습니다.
- **여러 파일 가져오기의 순서 의존**: 두 편집 사이의 병합은 순서와 무관하지만, 여러 파일을 차례로 가져오면 날짜 묶음을 매번 다시 계산하므로 가져오는 순서에 따라 결과가 달라질 수 있습니다. 파일을 하나씩 가져오며 매번 미리보기를 확인하세요.
- **LWW의 시계 의존**: 메모·태그·숨김·일정 병합은 `updatedAt` 최신 우선(LWW)이라 기기 시계가 틀리면 오래된 편집이 이길 수 있습니다. 가져오기 미리보기에서 덮어써지는 로컬 값을 보여 주는 것으로 보완합니다.
- **네이버 비공식 API**: 저장 목록·길찾기 API는 공개 API가 아니어서 언제든 바뀌거나 막힐 수 있습니다. 수집은 로컬에서만 하고 결과를 커밋하므로 배포된 앱은 영향을 받지 않으며, 호출은 `pipeline/naver-client.ts` 한 파일에 모여 있습니다.
- **NaverMapAdapter는 실제 키로 수동 확인 필요**: 자동 테스트는 가짜 SDK·가짜 지도로만 돌기 때문에, 실제 네이버 지도 렌더링(마커·클러스터·폴리라인·영역 이동)은 실제 Client ID로 배포한 뒤 눈으로 확인해야 합니다.
- localStorage는 브라우저 정리나 사생활 보호 모드에서 사라질 수 있습니다. 중요한 편집은 내보내 두세요.

## 수동 확인 체크리스트 (배포 후)

- [ ] 실제 네이버 지도 렌더링(마커·클러스터·폴리라인, 목록 선택 시 지도 이동)
- [ ] iOS Safari: 카카오톡으로 받은 링크 열기 → 메모 → 공유 시트로 내보내기 → 상대 기기에서 가져오기
- [ ] Android Chrome: 같은 흐름

### 첫 배포 체크리스트 (작성자와 함께)

- [ ] Cloudflare Pages에 repo 연결, 빌드 명령·출력·`NODE_VERSION`·`VITE_NAVER_MAP_CLIENT_ID` 설정
- [ ] NCP 콘솔에 Pages 도메인과 `http://localhost:5173` 등록
- [ ] 실제 여행 yaml 작성 → `yarn collect` → 커밋·push → 배포 확인
- [ ] 위 수동 확인 체크리스트 수행
- [ ] NCP Maps 요금·무료 사용량을 확인해 이 README에 날짜와 함께 기록
