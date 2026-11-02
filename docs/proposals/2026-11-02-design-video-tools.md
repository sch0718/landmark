# 디자인·영상 도구 적용안: impeccable, hyperframes

> **상태**: 제안(미적용) · 2026-11-02 검토 · Claude와 Codex(gpt-6.1-sol high) 교차 검토 · 설치·실측 안 함 · repass·gazua 공통안

이 문서는 나중에 검토하려고 남겨 둔 제안입니다. 이 저장소에는 아직 아무것도 설치하거나 바꾸지 않았습니다. 두 도구 모두 landmark·repass·gazua 세 프로젝트에 같은 원칙으로 적용하는 것을 전제로 합니다.

## 1. impeccable

저장소: [github.com/pbakaus/impeccable](https://github.com/pbakaus/impeccable)

### 무엇인가

Anthropic frontend-design 스킬에서 출발한 디자인 스킬·플러그인입니다. 라이선스는 Apache-2.0입니다.

- 명령 23개가 있습니다(audit, critique, harden, clarify, polish 등).
- LLM 없이 도는 62개 규칙 검사기 `npx impeccable detect`가 있습니다.
- Rust 엔진 바이너리, 라이브 모드, 편집 훅이 함께 들어 있습니다.

### 위험·제약

- 전역으로 설치하면 Codex/Grok 훅을 프로젝트에 써 넣습니다(#1190).
- 설치된 훅은 모델이 명령을 거절해도 자동으로 돕니다.
- 새 디자인 방향을 impeccable.style에서 받아오고, 텔레메트리가 있습니다.
- 규칙의 취향이 강합니다.

### 적용 원칙 (세 프로젝트 공통)

- **설치 범위**: 프로젝트 단위로만 설치합니다(전역 X). 훅은 끕니다. `DO_NOT_TRACK=1`로 텔레메트리를 끕니다. 세 저장소가 같은 버전으로 고정합니다.
- **스크립트 이름**: 같은 이름의 스크립트를 둡니다. `package.json`에 `lint:design` → `impeccable detect <화면 소스 경로>`. 처음에는 보고만 하고 CI를 막지 않습니다. 오탐을 기록해서 무시 규칙 기준선을 만듭니다.
- **쓰는 명령**: 리뷰형 명령만 씁니다. audit, critique, harden(빈 상태·오류·접근성), clarify(문구). 생성형 명령(bolder, overdrive, colorize 등)은 이미 있는 디자인 언어를 흔들 수 있어 쓰지 않습니다.
- **디자인 맥락**: 이미 있는 문서를 근거로 만듭니다(landmark 문서는 아래 「landmark 메모」).
- **한계**: 정적 검사는 실제 기기·키보드·스크린리더 확인을 대신하지 못합니다. ui-device-checks 기록과 함께 씁니다.
- **공통화 순서**: 한 저장소에서 오탐률을 확인 → 쓸 만하면 무시 규칙과 스크립트를 세 저장소에 맞춤 → 그 뒤에 공용 위치로 뺄지 정합니다. 공용 위치 후보는 `@sch0718/*` 패키지나 sch0718 플러그인 마켓플레이스입니다.

### landmark 메모

- 디자인 맥락의 근거 문서: [docs/branding](../branding/README.md), [docs/ui-device-checks.md](../ui-device-checks.md), [docs/ui-performance.md](../ui-performance.md), [docs/convention.md](../convention.md).
- 세 앱 중 화면 코드가 가장 큽니다(React, tsx 약 315개 — 2026-11-02 `git ls-files '*.tsx'`로 세면 315개이고, 이 중 `src/` 179개·`tests/` 136개입니다). detect 오탐률을 재기에 좋은 표본입니다.
- [perf-budget.json](../../perf-budget.json)이 이미 있으니 impeccable의 optimize 명령은 그 예산과 겹치는지 먼저 봅니다. optimize는 위 「쓰는 명령」(리뷰형 4개)에 들어 있지 않으므로, 쓰려면 이 확인 뒤에 목록에 넣을지 정합니다.

### 시작 조건

따로 정한 시작 시점은 없습니다. 시작하면 공통화 순서의 첫 단계(한 저장소에서 오탐률 확인)부터 밟습니다.

## 2. hyperframes

저장소: [github.com/heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)

### 무엇인가

HTML/CSS/JS 컴포지션을 헤드리스 Chrome에서 프레임 단위로 seek한 뒤 FFmpeg로 MP4를 만듭니다.

- Apache-2.0이고 렌더 비용이나 상업 이용 제한이 없습니다. Node 22+와 FFmpeg가 필요합니다.
- Claude Code 플러그인과 스킬(`/hyperframes` 등)을 제공합니다.

### 위험·제약

- 애니메이션이 `seek(time)`으로 되감을 수 있어야 합니다. GSAP 정지 타임라인, WAAPI, CSS 등을 씁니다. `setTimeout`이나 rAF로 상태를 바꾸는 코드는 그대로 렌더되지 않습니다.
- 텔레메트리(PostHog)가 기본으로 켜져 있습니다. `HYPERFRAMES_NO_TELEMETRY=1`로 끕니다.
- macOS XProtect가 렌더 프로세스를 죽이는 이슈가 있습니다(#6530).
- 릴리스가 매우 잦고 breaking 변경도 나옵니다(0.9.0). 로컬 렌더가 느립니다(30초 1080p에 약 3분).

### 적용 원칙 (세 프로젝트 공통 파이프라인)

1. **원재료**: 각 앱을 가짜 데이터 모드로 띄워 Playwright로 화면을 녹화합니다. 실제 앱 화면이라 실물과 어긋나지 않고, 앱이 바뀌면 다시 찍기 쉽습니다.
2. **합성**: hyperframes 공통 템플릿 하나로 인트로 타이틀, 자막, 강조, 아웃트로(서비스 주소)를 입힙니다. 저장소마다 다른 것은 브랜드 값(색·로고·서비스명)만입니다.
3. **산출물**: MP4는 크니 git에 넣지 않습니다. 배포 위치(Pages 정적 자산 등)는 따로 정합니다.

버전 고정과 텔레메트리 끔은 공통입니다.

### landmark 메모

- 원재료: landmark는 이미 Playwright e2e가 있으니([tests/e2e](../../tests/e2e)), e2e 픽스처나 시드 데이터로 녹화용 시나리오를 만들 수 있는지 확인합니다.
  - 확인한 사실(2026-11-02): [playwright.config.ts](../../playwright.config.ts)의 e2e 웹서버는 `VITE_MAP_ADAPTER: 'fake'`로 뜨고, 이때 [MapView.tsx](../../src/components/map/MapView.tsx)는 실제 네이버 지도 대신 `FakeMapAdapter`를 씁니다. 같이 켜는 `VITE_SYNC_DEV_FAKE: '1'`은 가짜 로그인 스위치입니다([개발 문서](../development.md)). e2e 설정 그대로 녹화하면 지도가 가짜로 찍히므로, 녹화용으로는 실제 지도 어댑터로 띄우고 데이터만 픽스처에서 가져올 수 있는지 봅니다.
- 브랜드 값: [docs/branding](../branding/README.md) 아이콘과 [docs/readme](../readme) hero SVG를 씁니다.
- 쓸 만한 장면: [docs/help](../help/README.md)의 주제별 짧은 영상(장소 담기, 여행 일정, 약속 잡기, 나누기). [README의 6가지 흐름](../../README.md#이런-걸-할-수-있어요)과 1:1로 맞추면 좋습니다.
  - 확인한 사실(2026-11-02): 위 장면은 4개이고, README 「이런 걸 할 수 있어요」 표의 흐름은 6개(모으기, 찾기, 여행 계획, 약속 잡기, 나누기, 백업)이며, docs/help 주제는 9개입니다. 1:1로 맞추려면 영상 수를 어느 기준으로 정할지 시작할 때 정합니다.

### 시작 조건

시범 적용은 gazua(이미 HTML 모션 데모가 있음)에서 먼저 하고, 템플릿이 굳으면 landmark·repass가 가져다 씁니다. 영상을 실제로 배포할 필요가 확실할 때 시작합니다.

## 시작 전에 정할 것 (문서화 검토에서 나온 질문)

이 문서를 저장소에 옮기며 Codex·Claude 검토(2026-11-02)에서 나온 질문입니다. 위 제안의 결정이 아니라, 실제로 시작할 때 답할 항목으로 남깁니다. 저장소 쪽 사실은 2026-11-02에 확인했고, impeccable·hyperframes·Playwright 공식 문서 내용은 검토자가 인용한 것이며 직접 확인하지 않았습니다.

### impeccable

- **리뷰형 명령의 범위**: 검토자는 공식 정의상 harden은 인터페이스를 고치고 clarify는 문구를 다시 쓴다고 지적했습니다. 보고만 하는 명령(audit·critique)과 수정까지 하는 명령(harden·clarify)을 나눌지, 수정 명령을 쓰면 어떤 검증을 거칠지 정합니다. landmark에는 화면 문구에 기대는 e2e 시험이 있습니다(예: [tests/e2e/meetings.spec.ts](../../tests/e2e/meetings.spec.ts)).
- **「CI를 막지 않는 보고」의 종료 코드**: 검토자가 인용한 공식 CLI 계약은 발견 사항이 있으면 종료 코드 2, 검사하지 못한 대상이 있으면 1입니다. CI에 붙일 때 2(발견)와 1(실행 실패)을 어떻게 구분할지 정합니다.
- **첫 시범 저장소**: 공통화 순서는 「한 저장소에서」라고만 하고, landmark는 표본으로 좋다고만 적혀 있습니다. 어느 저장소에서 먼저 시작할지 정합니다.
- **TSX 소스 검사의 범위**: 검토자가 인용한 공식 README에 따르면 TSX에는 패턴 규칙만 적용되고 대비·작은 글자 검사는 URL 스캔에서 돕니다. landmark 화면은 MUI `sx`로 스타일을 주고([PlaceCard.tsx](../../src/sections/library/PlaceCard.tsx) 등) 테마 색을 CSS 변수로 런타임에 넣습니다([ThemeRoot.tsx](../../src/theme/ThemeRoot.tsx)). 오탐률과 함께 소스 스캔이 실제 결함을 얼마나 잡는지, 측정에 넣을 경로(`src/`만인지)를 정합니다.
- **시범의 통과·중단 기준**: 오탐률을 어떤 표본과 방법으로 잴지, 그만둘 때 의존성·설치 파일·훅 설정을 어떻게 되돌릴지 정합니다.

### hyperframes

- **녹화 조건**: landmark e2e는 보관함 데이터를 [tests/e2e/fixtures.ts](../../tests/e2e/fixtures.ts)의 `seedStorage`로, 경로 응답을 같은 파일의 `mockRoutes`로 따로 넣습니다. 앱 전체를 한 번에 바꾸는 「가짜 데이터 모드」는 없으므로, 녹화 때 무엇을 시드·모킹하고 실제 지도에 어떤 외부 요청을 허용할지 정합니다.
- **녹화·합성 규격**: [playwright.config.ts](../../playwright.config.ts)에는 영상 녹화 설정이 없고 프로젝트별 뷰포트가 다릅니다(1280×800, 390×844, 360×780). 녹화 크기, 출력 비율·FPS, 장면 길이, 실패한 영상을 거르는 기준을 시범 영상 하나로 먼저 정합니다.
- **기존 도움말 그림과의 관계**: [scripts/build-motion.mjs](../../scripts/build-motion.mjs)가 `@sch0718/motion-kit`으로 docs/readme hero SVG와 도움말 그림(`public/help/img/`)을 만들고, `docs/help/*.md`·`docs/help/README.md`·`src/sections/help/help-content.ts`도 다시 씁니다. 영상이 이 그림을 보완하는지 대체하는지, 영상 링크를 생성원에서 관리할지 정합니다(생성된 문서에 직접 넣으면 다시 만들 때 사라집니다). 기존 motion-kit이나 Playwright·FFmpeg만으로 되는지와 비교해 hyperframes가 필요한 이유도 적습니다.
- **버전 고정 대상**: 검토자가 인용한 공식 설치 문서에 따르면 CLI 버전이 같아도 플러그인·스킬 내용은 바뀔 수 있습니다. CLI와 플러그인·스킬 소스를 각각 무엇으로 고정하고, 업데이트 뒤 같은 버전인지 어떻게 확인할지 정합니다. 검토자에 따르면 CLI는 전역 설치일 때 백그라운드로 스스로 갱신하고 텔레메트리를 꺼도 이것은 막히지 않으므로, 프로젝트 로컬 설치를 쓸지 `HYPERFRAMES_NO_AUTO_INSTALL=1` 등으로 자동 갱신을 막을지도 함께 정합니다.
- **템플릿 입력의 범위**: 「저장소마다 다른 것은 브랜드 값만」이 템플릿 자체를 말하는지 정합니다. 녹화 파일·자막·강조는 장면마다 다르므로 장면별 입력으로 받는다는 뜻인지 확인합니다(landmark 도움말 문구·단계는 생성원 [scripts/motion/help-pages.mjs](../../scripts/motion/help-pages.mjs)에 주제별로 있고, `help-content.ts`는 그 생성 결과입니다).
- **배포 위치**: 「Pages 정적 자산」이 앱의 Cloudflare Pages인지 정합니다. GitHub Pages(`gh-pages`)는 공유 지도 배포용이고, [deploy-share-map.yml](../../.github/workflows/deploy-share-map.yml)이 배포 때마다 기존 내용을 지우고 `dist-map/`으로 바꾸므로 그쪽에 영상을 따로 올리면 다음 배포 때 사라집니다.
