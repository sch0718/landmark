# 랜드마크·가즈아 코드 공통화 제안서 (2026-10-27)

상태: **초안, 검토 전**. 조사 기준일: **2026-10-27**. 구현·설정 변경·배포는 이 제안의 범위 밖이다.

> **추가 검토(6절):** 사용자가 "앞으로 새 서비스를 계속 만들 예정이고, 공통 코드를 한 곳에서 관리하고 싶다"고 전제를 보탰다. 이 전제에서는 **별도 공용 저장소(패키지 여러 개) + 공개 npm 발행**을 추천안으로 바꾼다. 아래 요약과 1~5절은 소비처가 두 앱뿐일 때의 검토다. 무엇을 공통화할지(1절)는 그대로 유효하다.
>
> **결정(2026-10-27):** 사용자가 "가즈아에는 카카오 모듈을 복사하지 말고, 공용 저장소에서 패키지를 발행한 뒤 설치하는 방향으로 가자"고 정했다. 1-a·2.6·4절 단계 1의 "가즈아에 복사" 부분은 이 결정으로 대체된다.

- 카카오 공유를 첫 후보로 삼되, 진행 중인 랜드마크 독립 모듈을 먼저 완성하고 출처를 기록해 가즈아에 복사한다.
- 기존 코드에서는 처음 안내 기록과 SVG 생성기의 작은 공통 함수부터 추출할 이득이 있다.
- 공유 링크 형식·백업·주 저장소·서버 인증·UI는 앱별로 유지한다.
- 두 소비처에서 인터페이스가 안정되면 빌드된 JS와 선언 파일을 공개 npm 패키지로 배포한다. 당장 모노레포로 합치지는 않는다.
- 라이선스 결정과 첫 로딩 검증을 이전 조건으로 둔다. 가즈아에는 첫 로딩 JS 예산이 없어 도입을 제안한다.

| 후보 | 추천 | 공통으로 둘 범위 |
| --- | --- | --- |
| a. 카카오 공유 | **공통화** | SDK 로더·메시지 전달 인터페이스. 첫 배포 수단은 복사 |
| b. 움직이는 그림 생성기 | **공통화** | `kit` 일부·도움말 직렬화. 실행기·앱 장면은 복사 유지 |
| b-2. 앱 아이콘 생성 | **복사 유지** | 가즈아에 대응 생성기가 없어 필요 시 원리만 도입 |
| c. 공유 링크 압축·인코딩 | **공통화하지 않음** | 데이터 URL과 서버 capability의 목적이 다름 |
| d. 백업·내보내기 형식 | **공통화하지 않음** | 복원·비밀정보·스키마 정책이 다름 |
| e. 주 저장소 래퍼 | **공통화하지 않음** | Effect 서비스와 프로필·IDB 저장소 유지 |
| e-2. 처음 안내 기록 | **공통화** | 키·유효 ID·Storage를 주입하는 작은 함수 |
| f. Functions·Worker | **공통화하지 않음** | 현재는 정책·회귀 사례만 교환 |
| g. CSP 생성 | **복사 유지** | 앱별 정책과 Vite 어댑터 유지 |
| h. 첫 로딩 크기 검사 | **공통화** | Node 검사기, 예산 수치는 앱별 |
| h-2. E2E 준비 | **복사 유지** | 시드·서버·선택자는 앱별, 소수 단언은 추후 후보 |
| i. 린트·TS·CI·릴리스 문서 | **복사 유지** | 공통 원칙을 맞추되 설정 파일은 분리 |
| j. 색·아이콘 | **공통화하지 않음** | 브랜드·토큰 체계·아이콘 렌더러 분리 |
| k. 도움말 화면 | **공통화하지 않음** | UI는 분리. 데이터 계약·생성 규약은 b/e-2로 공유 |

## 1. 공통 후보 목록

### 조사 기준과 수치 읽는 법

- 랜드마크: 현재 워크트리의 `HEAD`와 `origin/main`이 모두 `cbe2d426368e8475e4b36f6c0fed075bd3067f82`. 시작 시 `docs/shared-code-proposal` 브랜치이며 변경 파일이 없었다.
- 가즈아: 작업 트리는 사용하지 않았다. 로컬 원격 추적 참조 `origin/main` = `83fff70d6356a801f0991e17bfbe747e2e30fbb4`의 `git show`·`ls-tree`·`grep`을 기준으로 읽었다. fetch하지 않았으므로 GitHub 최신 main과 같은지는 확인 못 했다.
- 가즈아 라이선스 관련 예외 참조: `origin/chore/license-polyform-nc` = `16848586ccb1db0fa51a402783d2d81f9f582e13`. 이 참조의 내용을 main의 기능으로 서술하지 않는다.
- 도구 기준은 각 `package.json`·`.nvmrc`다. L은 React 19·MUI 7·Jotai·Effect 4.0.2, Vite 8·TS 6·Vitest 5, Yarn 1.22.22·Node 24다. G는 Svelte 5, Vite 6·TS 5.9·Vitest 3, pnpm 10.34.6·Node 22이며 proxy/sync-worker를 workspace로 관리한다. 패키지의 `engines.node`는 두 앱 모두 `>=22`지만 실제 CI 기준은 다르다.
- 이하 **L**은 랜드마크, **G**는 가즈아 `origin/main`이다. 모든 G 경로는 이 참조 기준이며, 다른 참조는 매번 명시한다.
- 줄 수는 실제 읽은 텍스트의 개행 수(`wc -l` 기준)이다. Python의 `text.count('\n')`로 집계했고 그림 생성기 L 파일은 `wc -l`로도 확인했다. **+L/−G**는 G에서 L로 바꿀 때의 추가·삭제 행 수다. 코드·주석·서식 변경을 모두 포함한다. 1-b 그림 생성기 표는 아래 재현 예시와 같은 `diff -u` 결과다. 나머지 절의 +/−는 Python `difflib.unified_diff`로 셌다. difflib는 최소 diff가 아니어서 `diff -u`보다 크게 나올 수 있다. 예: `help-pages.mjs`는 difflib +961/−646, `diff -u` +877/−562.
- 중복 근거의 **정규화 일치 행**은 빈 행과 `//`, `/*`, `*`로 시작하는 행을 제외하고 각 행을 `strip()`한 뒤 `SequenceMatcher(..., autojunk=False)`의 일치 블록 길이를 합한 값이다. 괄호·문자열 조각도 세므로 의미 있는 재사용 코드량의 대용치일 뿐, 제거 가능한 LOC가 아니다. 아래 절감량 평가는 이를 근거로 한 **추정**이다.

재현 예시(읽기 전용):

```sh
git -C /Users/shinchoonho/01.workspace/10.repository/gazua show origin/main:scripts/motion/kit.mjs | wc -l
diff -u <(git -C /Users/shinchoonho/01.workspace/10.repository/gazua show origin/main:scripts/motion/kit.mjs) scripts/motion/kit.mjs
```

### a. 카카오 공유 모듈 — 공통화, 첫 소비는 복사

**무엇인지·실제 경로.** 카카오 공유 모듈 자체는 아직 조사 대상 참조에 없다. 다른 세션에서 독립 폴더로 먼저 만들고 가즈아에 복사할 계획이라는 사용자 제공 사실을 전제로 한다. 기존 랜드마크 흐름은 `src/sections/library/{FilterBar,BulkBar}.tsx` → `src/sections/share-export/{ExportHtmlDialog,TripShareDialog,ShareFileDialog}.tsx` → `use-share-link.ts` → `src/share-viewer/encode.ts`다. 받은 화면은 `src/share-viewer/*`, 별도 지도와의 통신은 `src/share-protocol.ts`다. 가즈아는 `src/lib/share/{ShareDialog,ShareHost}.svelte`, `shareStore.svelte.ts`, `snapshot.ts`, `shareText.ts`, `src/lib/sync/controller.svelte.ts`, `sync-worker/src/shares.ts`, `src/routes/SharedView.svelte`다.

**차이·의존.** 신규 카카오 모듈의 diff·중복 줄 수는 **해당 없음: 코드가 없다**. 연결 대상은 L `encode.ts` 111행·`decode.ts` 64행·`share-protocol.ts` 246행, G `ShareDialog.svelte` 217행·`snapshot.ts` 189행·서버 `shares.ts` 95행이다. 주요 차이는 (1) L은 `/view#d=…`와 HTML 파일, G는 `#/s/<capability>` (2) L은 브라우저에서 문서 생성, G는 로그인·동기화 뒤 서버에 생성 (3) G는 만료·철회 지원 (4) L은 React/MUI/Jotai, G는 Svelte 상태에 의존한다. 공유 URL을 만드는 앱 어댑터는 분리하고 SDK 로딩과 메시지 전달만 프레임워크 무관하게 만든다.

**메시지에 공급할 값.**

| 값 | 랜드마크 어댑터 | 가즈아 어댑터 |
| --- | --- | --- |
| 제목 | `ShareFileDialog` 입력 제목, 여행 `title.value`, `export-targets.ts`의 기본 제목 | `ShareSnapshot.title` (`snapshot.ts`에서 정제) |
| 설명 | 문서의 장소 수, 여행 Day·일정 수. 메모 포함 선택을 존중하고 요약만 생성 | `snapshotLines()` 기반 그룹 종목 수·전략 종류 등의 짧은 요약. `capitalHidden` 준수 |
| 이미지 | 공개 HTTPS PNG, 우선 `public/icon-512.png`를 절대 URL로 제공하는 안 | 공개 HTTPS PNG, 우선 `public/icon-512.png`를 절대 URL로 제공하는 안 |
| 링크 | `useShareLink()` 결과가 `direct`인 `/view#d=…` | `createShare()` 성공 후 반환된 앱 `origin + pathname + '#/s/' + capability` |

이미지는 현재 지도·차트를 자동 캡처하는 기능이 있다는 뜻이 아니다. 첫 단계는 앱별 정적 이미지로 충분하다. `blob:`·로컬 파일·로그인해야 보이는 이미지는 쓰지 않는다. 랜드마크의 HTML 다운로드는 카카오 메시지의 웹 링크가 아니므로 파일 URL을 대신 넣지 않는다. 링크 한도 초과·압축 미지원·가즈아 공유 생성 실패 때는 기존 파일 공유/링크 복사 안내를 유지한다. 가즈아 내보내기 원문을 메시지로 재사용하면 선택적으로 포함한 키까지 노출할 수 있으므로 공유 스냅샷만 받는다.

**인터페이스 초안(제안이며 구현 아님).** 위치는 L `src/shared/kakao-share/`, 복사본은 G `src/lib/shared/kakao-share/`를 제안한다. 두 폴더 내용은 동일하게 유지하고 앱별 어댑터를 밖에 둔다.

```ts
type ShareCard = {
  title: string;
  description: string;
  imageUrl: string;
  link: { webUrl: string; mobileWebUrl: string };
};
type KakaoShareConfig = {
  javascriptKey: string;
  sdkUrl: string;       // 고정 버전 HTTPS URL
  integrity: string;    // 해당 버전 공식 배포값
};
type ShareResult =
  | { kind: 'requested' } // SDK 호출 성공. 실제 전송 완료를 뜻하지 않음
  | { kind: 'unavailable'; reason: 'sdk' | 'config' | 'payload' };
interface KakaoShareClient {
  prepare(): Promise<void>;
  isReady(): boolean;
  send(card: ShareCard): ShareResult;
}
// createKakaoShare(config, dependencies): KakaoShareClient
// dependencies로 문서/script 로딩·SDK 접근을 주입해 단위 시험한다.
```

`index.ts`(공개 타입/팩토리), `loader.ts`(단일 진행 요청·실패 후 재시도·시간 초과), `payload.ts`(URL/메시지 검사)를 분리하는 안이다. 특정 SDK 전역·DOM 접근은 호출 시점에만 하고 React·Svelte·Effect·Vite의 `import.meta.env`를 안에서 참조하지 않는다. 중복 script 삽입과 같은 페이지에서 다른 키로 초기화하는 경우를 명시적으로 처리한다. 제목 길이 등 공급자 한도는 공식 레퍼런스를 추가 확인해 상수로 정하며 임의 숫자를 약속하지 않는다.

**SDK·CSP·첫 로딩.** 공식 문서는 피드의 `title`, `description`, `imageUrl`, `link.webUrl/mobileWebUrl`과 사용자 버튼의 `Kakao.Share.sendDefault()`를 설명한다. SDK 도메인 및 제품 링크 설정도 요구한다. [카카오 공유 JavaScript 문서](https://developers.kakao.com/docs/ko/kakaotalk-share/js-link), 확인 2026-10-27.

SDK는 공유 버튼을 눌렀을 때 `prepare()`로 읽는다. 최초 비동기 로딩이 팝업에 필요한 사용자 동작 연결을 끊을 수 있으므로, 준비 중 상태를 보이고 완료 후 다시 누르면 동기적으로 `send()`하는 안을 기본으로 검증한다. 실제 iOS·Android 카카오 인앱 브라우저에서 한 번의 클릭만으로 가능한지는 확인 필요다. 클릭 전 prefetch·preload·서비스 워커 사전 캐시도 하지 않는다.

공식 설치 URL은 `https://t1.kakaocdn.net/kakao_js_sdk/${VERSION}/kakao.min.js` 형태이며 버전과 integrity를 맞춘다. [카카오 JavaScript 시작하기](https://developers.kakao.com/docs/ko/javascript/getting-started), 확인 2026-10-27. 채택 버전·integrity·gzip 크기는 아직 선택/측정하지 않았다. G의 현행 `script-src 'self'`는 외부 SDK를 막으므로 정확한 CDN 출처를 추가해야 한다. `connect-src`·`frame-src` 등 추가 요구 출처는 실제 네트워크와 위반 보고로 확인하며 `*`나 `unsafe-inline`로 일괄 완화하지 않는다. L의 저장소에는 CSP 선언을 찾지 못했다(1-g). SDK용 CSP 변경도 앱별 어댑터 책임이다.

**이득·비용·추천.** 기존 중복 절감은 산정 불가다. 대신 새 SDK 버그·중복 로딩·재시도 처리를 한 번 고쳐 두 앱에 전파하고 메시지 계약을 맞춘다. 비용은 모바일 동작·긴 fragment URL 전달·만료 링크·등록 도메인 검증이다. **공통화**를 추천하되 다른 세션의 결과를 먼저 검토하고, 폴더 이동·인터페이스 변경을 병행하지 않는다. 배포 수단은 초기 복사+출처 커밋, 안정 후 패키지다.

### b. 움직이는 그림 생성기 — 기반 함수와 앱 장면 분리

**무엇인지·경로.** 두 저장소 모두 `scripts/build-motion.mjs`, `scripts/motion/{kit,hero,help,help-pages}.mjs`가 README 소개 SVG·도움말 SVG·Markdown·앱 문구를 생성한다. G의 별도 `motion/gazua-demo.html`·`poc/gazua-poc.html`은 이 SVG 생성기와 다른 데모다.

각 파일을 개별 비교한 결과:

| 동일 상대 경로 | 행 수 L / G | +L / −G | 정규화 일치 행 |
| --- | ---: | ---: | ---: |
| `scripts/build-motion.mjs` | 41 / 34 | 22 / 15 | 14 |
| `scripts/motion/kit.mjs` | 134 / 216 | 60 / 142 | 51 |
| `scripts/motion/hero.mjs` | 201 / 182 | 155 / 136 | 36 |
| `scripts/motion/help.mjs` | 181 / 163 | 79 / 61 | 67 |
| `scripts/motion/help-pages.mjs` | 1,033 / 718 | 877 / 562 | 138 |

**주요 차이.**

1. `build-motion`: L 로고 원본은 `docs/branding/icon-a.svg`, G는 `public/icon.svg`. 앱 문구 출력도 L `src/sections/help/help-content.ts`, G `src/lib/help/content.ts`다. L의 package script는 생성 뒤 Prettier도 실행한다.
2. `kit`: `esc`·`at`·텍스트·SVG 문서·motion CSS의 뼈대는 비슷하다. G는 `loadTheme()`로 CSS를 파싱하고 `fit`·`walk`·`chart`·`segmented` 등을 가진다. L은 지도 `mapBase`·`pin`·`chipRow`가 있다. `chip`·`card`·`button`의 인수/색 토큰도 달라 파일 전체를 치환할 수 없다.
3. `hero`: L은 `pastel.ts`를 직접 읽고 모으기→계획→약속→공유를, G는 전달된 테마로 비교→매매 규칙→기준 검증→성과를 그린다. 장면 시간도 L 4초, G 4.2초다.
4. `help`: L 하단 탭·`BODY` 좌표와 G 상단 앱 아이콘/비교 앱 바가 다르다. 단계 시간은 L 3.6초, G 3.8초다. Markdown·문구 직렬화에는 재사용할 구조가 있다.
5. `help-pages`: 장소·라벨·지도와 종목·매매·차트라는 서로 다른 내용 및 그리기 함수다. 일치 행에는 SVG 템플릿/문법도 포함되어 138행을 그대로 공통 도메인으로 볼 수 없다.

**프레임워크 의존.** 렌더링은 Node ESM과 SVG 문자열이어서 React/Svelte에는 의존하지 않는다. 다만 L `hero`·`help`는 앱 TS 토큰을 직접 import하므로 Node 24의 실행 조건과 로컬 경로에 묶인다. G Node 22 환경으로 파일을 옮길 때 이 연결을 제거해야 한다. 공통 코어에는 단순 palette·font·scene 인수를 전달하고 CSS 파서·TS 토큰 읽기는 로컬 어댑터로 둔다.

**이득 추정.** `kit` 51행과 `help` 67행의 정규화 일치를 근거로 작은 기반 로직의 재사용 가능성이 있다. 동일 행 중 괄호 등을 제외해야 하므로 실제 절감량은 추출 후 재측정한다. XML 이스케이프, 텍스트 폭, reduced-motion, SVG 접근성, Markdown 생성 오류를 양쪽에 반영하는 이득이 LOC 절감보다 크다.

**비용·추천.** `kit` 전체의 추출은 색 계약과 함수 API를 먼저 정해야 하고 렌더 결과가 바뀔 수 있다. `mapCount` 같은 ID 상태를 고려해 결정성을 검증한다. **`kit`의 앱 무관 부분·문구 직렬화는 공통화**, `build-motion`의 경로/쓰기와 `help`의 앱 프레임은 **복사 유지**, `hero`·`help-pages`의 앱 내용은 **공통화하지 않음**을 추천한다. 앱 전체 토큰과 장면 파일을 공용 패키지에 넣지 않는다.

### b-2. 앱 아이콘 생성 — 대응 생성기 없음

**경로·수치.** L `scripts/build-icons.mjs` 32행은 `docs/branding/icon-a.svg`를 읽어 `public/favicon.svg`와 180·192·512 크기의 PNG들을 만든다. G `origin/main`의 `scripts/`에는 대응 생성기나 `build:icons` 명령이 없다. 대신 `public/icon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` 산출물이 있다. 따라서 생성기 간 diff와 기존 중복량은 **해당 없음**이다.

**차이·의존·비용.** L은 `wrangler → miniflare`의 중첩 `sharp`를 `createRequire`로 찾으며 마스커블 원본의 `rx`를 바꾼다. G의 제작 방법은 저장소에서 확인하지 못했다. Node 도구로서 프레임워크 의존은 없지만 L의 간접 의존 탐색을 공통 계약으로 삼으면 패키지 구조 변경에 취약하다.

**이득·추천.** G가 재생성을 원하면 같은 크기·안전 영역 규칙을 복사하는 정도가 유익하다. 현재 중복 절감은 없으므로 **복사 유지**. 나중에 CLI로 묶을 때 직접 선언한 이미지 의존성과 SVG 입력·출력 경로 옵션을 검토한다. 로고 그림 자체는 공유하지 않는다.

### c. 공유 링크 압축·인코딩 — 공통화하지 않음

**경로·행 수.** L `src/share-viewer/encode.ts` 111행·`decode.ts` 64행, 앱 측 `src/domain/codec.ts`, `src/domain/share/*`, 지도 규약 `src/share-protocol.ts` 246행. G는 `src/lib/sync/controller.svelte.ts`의 링크 조립, `sync-worker/src/{shares,http}.ts`의 capability 생성·base64url, `src/lib/share/snapshot.ts`의 검증이다. L 압축 codec과 같은 역할의 G 파일은 **해당 없음**이므로 두 codec의 diff는 없다.

**차이·의존.** L은 JSON → `CompressionStream('deflate-raw')` → base64url을 URL fragment에 담는다. 해시 32,000자, 해제 결과 5,242,880바이트, 보기 링크 장소 1,000개 한도를 검사한다. v2는 크면 경로선을 뺀 사본으로 재시도한다. decode는 스트리밍 도중 한도를 넘으면 중단한다. 앱 쪽 검증은 Effect를 쓰지만 viewer codec은 이를 끌어오지 않는다.

G 링크는 32바이트 난수의 43자 capability이고 스냅샷은 D1에 남긴다. 기본 7일·최대 30일이며 철회 가능하다. 100 KiB 스냅샷 상한은 URL 압축 예산이 아니다. `fflate`는 `scripts/{build-universe,collect-market-data}.mjs`의 ZIP 해제에 쓰인다. `src/lib/marketData/store.ts`의 gzip 해제는 시장 데이터 가져오기이며 공유 URL과 무관하다.

**이득·비용·추천.** base64url 변환 같은 작은 원리는 겹치지만 공통 공유 형식으로 옮길 근거는 없다(역할이 같은 압축 중복 코드는 발견하지 못함). 패키지화를 위해 fflate를 앱에 넣으면 기존 네이티브 스트림보다 번들이 늘 수 있고, 데이터 URL의 비철회성과 서버 공유의 만료 정책도 섞인다. **공통화하지 않음**. 카카오 모듈에는 완성된 URL만 전달한다. `share-protocol.ts`는 지도 iframe과 옛 내보낸 파일의 하위 호환 규약이어서 G 공유와 별개다.

### d. 백업·내보내기 파일 형식 — 공통화하지 않음

**경로·수치.** L `src/domain/backup/{build-backup,read-backup,reminder,summary}.ts`는 각각 31·113·54·103행, 봉투는 `src/schema/backup.ts`다. G 대응은 `src/lib/state/exportImport.ts` 162행·`schema.ts`·`validate.ts`, UI `src/lib/ui/settings/DataTools.svelte`다. G `exportImport.ts` 대비 L build/read는 각각 +25/−156, +107/−156이고 정규화 일치는 2행/6행뿐이다(같은 G 파일과 두 번 비교했으므로 합산 절감량으로 쓰지 않음).

**차이·의존.** L은 `format: 'tripmap-backup'`, 봉투 `v: 1`, 내부 library `schemaVersion: 2`, 원본 JSON의 모르는 필드 보존·16 MiB 선검사·되살리기 전 사본이 핵심이다. G는 `format: 'gazua-export'`, `schemaVersion: 1`, 프로필별 내보내기와 새 프로필로 가져오기를 한다. G는 사용자가 선택하면 저장된 키/암호화된 비밀정보를 포함하되 토큰은 내보내지 않는다. 손상값 정제·복원 대상·파일 이름의 시간대도 다르다(L 기기 시간, G KST). G의 `src/lib/marketData/format.ts`는 별도 `gazua-market-data` v1~v4 계약이며 사용자 프로필 백업과도 다르다. L은 Effect Schema, G는 앱별 수동 검증에 의존한다.

**이득·비용·추천.** 겹침은 JSON 봉투라는 원칙에 그친다. 같은 스키마로 묶으면 L의 원문 보존 또는 G의 비밀정보 제외 정책을 훼손할 위험이 크다. **공통화하지 않음**. 향후 파일 읽기 크기 선검사·안전한 파일명 규칙만 필요가 생기면 별도 검토한다. 버전 번호·마이그레이션·복원 트랜잭션은 계속 앱 소유다.

### e. localStorage·IndexedDB 래퍼 — 주 저장소는 공통화하지 않음

**경로·수치.** L `src/services/library-store.ts` 461행, `prefs-store.ts` 48행, `browser-storage.ts` 8행, `backup-meta-store.ts`, `src/repositories/edit-layer-repo.ts`. G `src/lib/state/storage.ts` 141행·`profileStore.ts`, IDB는 `src/lib/data/candleCache.ts` 144행·`src/lib/perf/orderCache.ts` 116행·`src/lib/marketData/store.ts` 246행·`src/lib/sync/store.ts` 158행이다. L library/G storage는 +453/−133, 정규화 일치 16행이다.

**차이·의존.** L은 localStorage 보관함의 Web Locks·변경 스트림·원문 보존·용량 초과·복원 사본을 Effect 서비스로 감싼다. G는 `gazua:v1:` 접두어, 실패 시 메모리 overlay, `persistent`·`issues`와 프로필별 키를 가진 동기식 API다. G의 IDB는 봉 TTL/종목별 퇴출, 주문 캐시, 큰 시장 파일, 동기화 문서를 각각 다른 스키마로 관리한다. L `src/services/*`와 dependencies에서는 대응 `idb` 저장소를 찾지 못했다. 16행의 일치에는 보편적인 예외 처리와 문법이 포함되어 저장소 공통 모델의 근거가 되지 않는다.

**이득·비용·추천.** 차단/손상/쓰기 실패 시험 사례를 교환하는 이득은 있다. 하지만 실패 시 쓰기를 거절하는 보관함과 메모리 대체를 계속하는 프로필 저장소를 하나의 래퍼로 바꾸면 데이터 손실을 숨길 수 있다. **공통화하지 않음**. G의 IDB 의존성을 L에 새로 넣지 않는다.

### e-2. 처음 안내 기록 — 작은 공통화 후보

**경로·diff.** L `src/services/help-seen.ts` 65행, G `src/lib/help/seen.ts` 58행. +22/−15, 원문 일치 43행, 정규화 일치 40행이다.

**차이·의존.** (1) 키 `tripmap:help-seen:v1` / `gazua:help-seen:v1` (2) L은 문구 전체를 처음에 받지 않도록 ID 배열만 보유, G는 `HELP_PAGES`를 값으로 import (3) 유효 ID와 개수 (4) G만 `HelpSeenStore` 타입 export가 다르다. Storage 주입, 손상 JSON을 빈 기록으로 취급, 모르는 ID 제외, 접근/쓰기 실패 시 페이지 수명 동안 메모리 사용, `read/mark/reset`은 같은 구조다. 프레임워크 의존은 없고 앱 ID 타입만 분리하면 된다.

**이득·비용·추천.** 40개의 정규화 일치 행을 근거로, 기존 후보 중 공통화 대비 비용이 작다고 **추정**한다. `createSeenStore<Id>({ key, ids, storage })`처럼 만들면 차단·reset 관련 수정이 같이 전파된다. 키와 ID를 잘못 공유하면 이미 본 기록이 섞이는 비용이 있으므로 기존 키를 그대로 주입한다. **공통화**. 처음 안내가 뜰 화면을 정하는 라우팅, UI 관찰·포커스 로직은 포함하지 않는다.

### f. Cloudflare Functions·Worker — 정책 차이가 커서 현재는 분리

**경로·수치.** L `functions/api/*`는 얇은 진입점이며 `src/server/{http,handler,request,cache-key}.ts`, `src/server/meet/{handlers,limits,tokens}.ts`가 본체다. G 대응은 `sync-worker/src/{cors,http,handler,session}.ts`와 `proxy/src/{allowlist,handler,worker}.ts`. L http 83행/G sync http 68행은 +72/−57·정규화 일치 7행, L handler 94행/G sync handler 93행은 +85/−84·일치 5행이다. 추가 G 파일은 cors 34행·session 125행·proxy allowlist/handler/worker 64/118/5행, L meet limits는 33행이다.

**주요 차이.**

1. **출처:** L은 고정 운영/로컬 목록+한 단계 Pages preview 정규식이며 Origin이 없으면 Referer의 origin을 본다. G sync/proxy는 설정 문자열의 정확 일치 Origin만 허용한다. Origin 검사는 인증을 대신하지 않는다.
2. **CORS:** L 같은 출처 API에는 별도 CORS 응답 로직이 없다. G sync는 OPTIONS, `Vary: Origin`, 세션/공유 헤더를 허용한다. G proxy는 증권사 전달/노출 헤더가 다르고 `/health`만 공개 `*` 응답을 허용한다.
3. **캐시:** L GET은 Cloudflare Cache API 내부 사본에 TTL을 주되 브라우저에는 `private, no-store`; 오류도 저장하지 않는다. G sync 개인/공유 응답은 `no-store`. G proxy는 상류 응답의 제한된 헤더만 전달하며 같은 엣지 결과 캐시를 구현하지 않는다. 이를 하나의 기본 캐시 정책으로 묶지 않는다.
4. **속도 제한:** L meet는 D1 일별 IP 해시 카운터와 action별 한도, 생성 Turnstile이 있다. G shares의 활성 공유 50개 제한은 객체 수 한도이며 요청률 제한과 다르다. 읽은 G sync/proxy 코드에서는 L과 같은 일별 IP rate limiter를 찾지 못했다. 계정/플랫폼 외부 제한은 확인 못 했다.
5. **인증/본문:** L 약속은 host/guest capability, G sync는 Firebase ID 토큰+D1 기기 세션이다. G `http.ts`는 본문을 스트리밍으로 300 KiB까지 읽고 공유 생성은 110 KiB 인수로 제한한다. 오류 응답 형태도 다르다.

**프레임워크·이득·비용.** HTTP 도우미는 Web API라 React/Svelte에는 의존하지 않지만 L meet는 Effect 검증을 쓰며 두 앱의 DB·인증 계약에 결합되어 있다. 낮은 일치 행 수로는 공동 서버 패키지의 절감 이득이 작다. 출처/캐시 기본값을 잘못 일반화하면 보안·개인정보 회귀 비용이 크다. **공통화하지 않음**. 한도 있는 JSON 읽기·해시·CORS 시험 사례는 로컬에 복사 검토할 수 있으나 이 제안에서 보안 리팩터링까지 묶지 않는다.

### g. CSP 생성 — 앱별 정책 유지

**경로·수치.** G `index.html`의 meta CSP, `csp.config.ts` 54행·`csp.config.test.ts` 50행, `vite.config.ts`에서 dev/Firebase 플러그인을 연결한다. L `public/_headers` 4행은 `X-Robots-Tag`와 `/data/*` 캐시만 설정한다. L `index.html`, `src/share-viewer/`, `src/share-map/`의 HTML/TS, `src/server`, `functions`, `build`, `vite*.config.ts`에서 CSP 선언을 찾지 못했다. 대응 CSP 생성기와 직접 diff는 **해당 없음**이다. 배포 계정에서 헤더를 추가하는지는 확인 못 했다.

**차이·의존.** G는 기본 `script-src 'self'`, `connect-src 'self' https:`이며 개발 환경에만 로컬 http 프록시를 추가하고 Firebase 설정이 있으면 gapi script와 인증 frame 출처를 추가한다. `devCsp`/`firebaseCsp`는 문자열 변환, 어댑터는 Vite Plugin 타입에 의존한다. L은 네이버 지도, 별도 iframe 지도, 인라인 자산을 가진 내보내기 HTML, Turnstile 등 서로 다른 출력 대상을 먼저 구분해야 한다.

**이득·비용·추천.** G의 테스트 방식과 잘못된 설정을 빌드 실패로 만드는 원칙을 L에 복사할 이득이 있다. 현재 같은 정책의 중복은 없다. meta와 HTTP 헤더의 적용 범위도 달라 G 정책을 그대로 가져오면 공유 파일/지도를 막을 수 있다. **복사 유지**. 카카오 허용 출처 검사부터 앱별로 추가하고, 반복 사용이 확인되면 순수 directive 직렬화만 추출한다.

### h. 첫 로딩 크기 검사 — 공통 도구, 앱별 예산

**경로·수치.** L `scripts/check-bundle-size.mjs` 170행, `perf-budget.json` 5행, `package.json`의 `size`/`build:ci`, `tests/e2e/first-load.spec.ts`다. G `origin/main`에는 대응 예산 파일·검사 명령·CI 단계가 **없다**. `.github/workflows/*`, `scripts/*`, `vite.config.ts`, `pwa.config.ts`에서 `gzip|budget|chunkSize|maximumFileSize`를 재검색했다. 잡힌 gzip은 시장 데이터 산출물용이고 JS 예산 검사가 아니다. 따라서 검사기 간 diff와 기존 중복 절감은 해당 없음이다.

**차이·의존.** L 검사기는 `dist/index.html`의 module script와 modulepreload 파일을 중복 없이 gzip 합산하고 전체 assets JS도 별도로 보고한다. `--dist`, `--budget`, `--forbid`, `--require-lazy`를 지원하며 예산 파일이 없으면 측정만 한다. G Vite에는 별도 크기 예산 설정이 없고 PWA는 도움말 그림·Firebase 로그인 청크·인증 도우미를 사전 캐시에서 제외한다. 이 제외와 Workbox 파일 제한/번들러 경고는 첫 로딩 JS 총 gzip 예산과 다르다.

**이득·비용·추천.** 프레임워크 무관 Node 도구이므로 **공통화**. 먼저 G에 같은 측정기를 적용해 예산을 새로 정하는 안이다. 다만 현재 검사기는 HTML이 열거한 파일만 센다. 정적 import 그래프에만 나타나는 청크나 외부 SDK·PWA 사전 다운로드를 모두 포괄한다고 보장할 수 없다. Vite 6/8 출력 fixture와 브라우저 네트워크 기록으로 범위를 검증한 후 필요하면 그래프 순회를 보강한다. 예산 JSON은 앱별로 두며 L 예산을 G에 그대로 적용하지 않는다.

**예산 기준.** L `perf-budget.json` 기록은 최대 **327,680 B**, 2026-10-16 측정 **309,312 B**, 차이 **18,368 B = 17.9375 KiB(약 18 KB)**다. 이는 오늘 빌드 실측 여유가 아니다. 이번에는 파일 생성 제한 때문에 빌드하지 않았다. G는 **예산 없음, 도입 제안**이며 현재 첫 로딩 크기/여유를 계산하지 않았다. CDN SDK를 지연 로딩해도 기존 로컬 검사기는 외부 script를 세지 못하므로 클릭 전 네트워크 요청 0건을 별도로 검증한다.

### h-2. E2E 공용 준비 — 앱 fixture는 복사 유지

**경로·diff.** L `tests/e2e/fixtures.ts` 300행 / G `tests/e2e/helpers.ts` 64행: +291/−55, 정규화 일치 7행. `playwright.config.ts`는 L 142행/G 36행: +131/−25, 일치 10행. G 테스트는 소스 옆 `src/**/*.test.ts`, 스크립트 `tests/*.test.mjs`, 브라우저 `tests/e2e/*`, worker/proxy 별도 하네스로 나뉜다. L은 `tests/unit/*`와 `tests/e2e/*`를 사용한다.

**차이·의존.** L은 보관함 JSON·선호·안내 이력 시드, 가짜 지도, viewer/map/meet 서버 준비와 desktop/iPhone WebKit/Galaxy 프로젝트, CI smoke를 쓴다. G는 고정 시계·데모 온보딩·관심종목 시드, production preview 4173, Chromium 4개 화면 폭, 서비스 워커 차단을 쓴다. 공통점은 ko-KR·Asia/Seoul·실패 trace/스크린샷과 Playwright API다. G `tests/e2e/a11y.spec.ts` 132행은 axe WCAG 태그 검사에서 serious/critical을 실패 처리한다. L package/E2E에서 axe 사용은 찾지 못했다.

**이득·비용·추천.** E2E 공통 준비의 의미 있는 중복은 작다. 앱 선택자·메뉴·데이터를 패키지로 합치면 각 앱 변경 때 양쪽 테스트 도구를 같이 고쳐야 한다. **복사 유지**. `expectNoHorizontalScroll`·유한 애니메이션 대기·axe 검사 방식을 L에 도입할 수 있지만 먼저 로컬 helper로 검증한다. 라이브러리화하더라도 Playwright 타입은 개발/peer 의존으로 한정하고 앱 런타임에서 import하지 않는다.

### i. 린트·포맷·TS·CI·릴리스 관례 — 설정은 복사 유지

**경로·수치.** L `eslint.config.mjs` 28행·`prettier.config.mjs` 7행·`.prettierignore`, `tsconfig{,.app,.node}.json` 23/10/27행. G에는 eslint/prettier 설정·직접 의존·실행 script가 없다. G `tsconfig{,.app,.e2e}.json`은 8/19/7행, proxy·sync-worker도 자체 tsconfig를 둔다. L 기본/G app 비교는 +13/−9·정규화 일치 10행이다. 이는 옵션명 일치이며 전체 설정 통일의 근거로 삼지 않는다.

**주요 차이.** L은 ESLint TS/React Hooks, strict+`noUncheckedIndexedAccess`, ES2023, project reference와 선언 출력 경로, `src/*` 별칭을 쓴다. G는 Svelte check·ES2022·noEmit·별도 E2E TS 검사이며 Svelte 플러그인 설정이 필요하다. L Prettier ignore에는 `docs`가 있으므로 `fm:check`가 제안서 포맷을 검사한다고 볼 수도 없다. G에 포맷 검사를 새로 도입하려면 전체 코드 재서식과 기능 PR을 분리해야 한다.

**CI 비교.** L `.github/workflows/ci.yml` 62행/G 동명 파일 108행은 +46/−92·정규화 일치 14행. L은 Node 24/Yarn 1 frozen install → lint → `build:ci`(데이터 검증·타입·단위·빌드·크기·지도) → Chromium/WebKit smoke, 수동 전체 E2E다. G는 Node 22/pnpm 10 frozen install → Svelte/E2E check·Vitest·Node 스크립트·앱 build·proxy test·sync-worker check/test, 별도 Chromium E2E job과 주간 종목 유니버스 캐시다. G CI의 `TZ=America/New_York`은 시장 시간 회귀 시험 의도이므로 L처럼 일괄 통일하지 않는다.

**배포·문서.** L `.github/workflows/deploy-share-map.yml` 88행은 `dist-map`을 `gh-pages`로 별도 배포한다. 앱은 Cloudflare Pages다. G `.github/workflows/deploy.yml` 53행은 앱 `dist`를 GitHub Pages artifact로 배포하고 평일 아침 재빌드한다. Worker 배포를 이 앱 workflow가 자동 수행한다고 보지 않는다. L `docs/rollback.md` 356행은 버전/커밋/데이터 호환·Pages 배포 복귀·코드 revert·지도 별도 롤백을 기록한다. G는 `README.md`의 릴리스 표·버전 규칙, `docs/development.md` 122행의 배포 설명, `docs/live-check.md`, `proxy/README.md`, `sync-worker/README.md`가 있으나 대응 전용 rollback 문서는 tree에서 발견하지 못했다.

**프레임워크·이득·비용·추천.** 옵션·Actions 문법·릴리스 표 같은 반복은 있지만 공통 작업 순서보다 앱별 의존이 더 크다. **복사 유지**. Node/패키지 관리자·공통 패키지 버전 고정, 실패 artifact 보관, 라이선스 고지·크기 검증이라는 원칙만 맞춘다. G에는 데이터/서비스 워커/Worker 마이그레이션을 고려한 롤백 문서 관례를 제안한다. L `.nvmrc`는 24, G는 22이며 한 파일로 공통화하지 않는다. L `.husky/pre-commit`은 lint-staged, G `.githooks/*`는 proxy 자동 갱신 목적이어서 공통 훅 대상으로 보지 않는다.

### j. 디자인 토큰·아이콘 — 공통화하지 않음

**경로·수치.** L `src/theme/{tokens,create-app-theme,contrast,fonts}.ts`, `src/theme/tokens/{pastel,paper,night}.ts`, `src/components/icons.tsx`, `build/compile-react-svg-icon.ts`, `scripts/build-icons.mjs`. G `src/lib/ui/tokens.css`, `theme.ts`, 각 `.svelte`의 inline SVG 및 `public/icon.svg`. L `tokens.ts` 45행/G CSS 253행 비교는 +42/−250, 정규화 일치 0행이다.

**차이·의존.** L은 세 테마×light/dark, MUI 변환과 `--tm-*`, 라벨 색·지도 마커/이모지, Lucide 개별 import를 React SVG 컴파일러로 처리한다. G는 light/dark CSS 변수와 종목 10색·한국/글로벌 상승·하락 관례를 가진다. `HelpButton.svelte`처럼 inline SVG를 그리며 L의 Lucide 생성 설정에 대응하는 공통 아이콘 생성 시스템은 확인하지 못했다. 브랜드 앱 PNG 생성은 b-2와 별개다.

**이득·비용·추천.** Pretendard 사용·접근성 대비 기준 같은 관례는 함께 가져갈 수 있다. 하지만 색상 자체의 중복은 확인되지 않고 테마 의존 UI를 공통화하면 MUI/React 또는 Svelte를 반대 앱에 끌어들인다. **공통화하지 않음**. SVG 생성기에 전달하는 최소 palette 계약만 b에서 합의하고 앱별 토큰을 변환한다. 색·아이콘의 디자인 저작권도 코드 라이선스와 구분한다.

### k. 도움말 화면 UI — 데이터 계약만 공유

**경로·diff.** L `src/sections/help/{HelpIndexPage,HelpPage,HelpFigure,HelpIntroDialog}.tsx`, `help-content.ts`, `help-routing.ts`, `src/services/help-seen.ts`. G `src/routes/Help.svelte`, `src/lib/ui/help/{HelpIntro,HelpFigure,HelpText,HelpButton}.svelte`, `src/lib/help/{content,routing,seen}.ts`. Intro UI는 L 68행/G 115행, +67/−114, 정규화 일치 1행이다. 생성 문구 파일은 L 285행/G 242행으로 앱별 내용이 다르다.

**차이·의존.** L은 MUI Dialog와 React Router, G는 Sheet와 Svelte effect/MutationObserver를 쓴다. 안내 시작 화면도 L 다섯 목록, G 네 메뉴이며 라우트 모델이 다르다. 따라서 UI 컴포넌트를 그대로 공유하기 어렵다. 다만 둘 다 `id/title/lead[]/steps[{title,sub}]/tips[]` 데이터로 문서·앱을 만들고 light/dark SVG를 같은 경로 규칙으로 읽는다.

**이득·비용·추천.** UI 중복량은 사실상 없으므로 화면은 **공통화하지 않음**. 데이터 **형식**과 SVG/Markdown 직렬화는 b, 확인 이력 로직은 e-2에서 공통화한다. 장면 정의는 공통 base type에 `render(ctx)` 같은 앱별 콜백을 붙이는 정도로 제한하며 문구·좌표·페이지 ID는 각 앱 소유다. 안내 노출 관찰/차단·포커스·이전/다음 라우팅은 앱에 남겨 첫 화면에 도움말 전체가 합쳐지지 않게 한다.

## 2. 공유 방식 비교

아래 패키지명·저장소명은 제안용이며 아직 생성하거나 이름 사용 가능 여부를 확인하지 않았다. 난이도와 적합도는 개인 프로젝트 두 개를 한 사람이 관리한다는 조건의 판단이다. 표의 설치 인증은 **소비자 설치** 기준이며 공개 npm도 발행에는 별도 인증이 필요하다.

| 방식 | 설정·설치 | 버전·변경 전파 | CI/배포 인증 | 현재 규모 적합도 |
| --- | --- | --- | --- | --- |
| 별도 저장소 → 공개 npm | 중간. Yarn/pnpm 모두 일반 버전 설치 | SemVer+소비 앱 갱신 PR | 공개 설치 토큰 불필요 | 안정 후 **추천** |
| 별도 저장소 → GitHub Packages | 중상. scope registry 설정 | SemVer+갱신 PR | 공개 npm 패키지도 토큰 필요 | 토큰 관리 비용으로 후순위 |
| 별도 저장소 → git 의존성 | 중간. 빌드 산출물 포함 tag/SHA | tag 또는 commit 고정, 앱별 갱신 | 공개 HTTPS는 보통 토큰 불필요 | 짧은 과도기만 |
| pnpm 모노레포 | 높음. L 패키지 관리자·경로 이전 | `workspace:`로 함께 변경 가능 | 외부 비공개 패키지 없으면 추가 토큰 불필요 | 지금은 비용 과다 |
| git submodule | 중상. 재귀 checkout 필요 | 포인터 commit 갱신 PR | 공개 소스는 불필요, 비공개는 Git 인증 | 실수 가능성에 비해 이득 작음 |
| git subtree | 중간. vendor 경로로 병합 | subtree pull 후 소비 앱 PR | 소스 갱신 때 Git 인증, 빌드는 보통 불필요 | 복사보다 갱신 빈도가 높아질 때 |
| JSR | 중간. Yarn 1은 호환 레이어 설정 | 발행 버전+갱신 PR | 공개 호환 설치는 추가 개인 토큰 없이 사용 | 새 도구 추가 비용으로 후순위 |
| 복사+동기화 검사 | 낮음. 설치 과정 추가 없음 | 원본 SHA+해시/diff로 드리프트 검사 | 공개 원본 읽기만, registry 토큰 없음 | **초기 추천** |
| 생성기만 CLI 패키지 | 중간. 두 앱 devDependency | CLI 버전 고정+산출물 검토 | 공개 npm이면 설치 토큰 불필요 | 생성기 안정 후 추천 |

### 2.1 모든 패키지 방식의 공통 계약

공통 런타임 패키지는 **빌드된 ESM JS + `.d.ts`**로 배포하고 명시적 `exports`와 `files`를 둔다. 선언은 최소 지원 TS 5.9로 생성/검사하고 TS 6에서도 소비해 확인하는 안이 안전하다. TS 6 전용 문법이나 최신 DOM 선언 타입을 공개 API에 내보내지 않는다. 브라우저용 `kakao-share`/`seen-store`, Node 도구 `motion`/`bundle-budget`를 별도 패키지 또는 확실한 subpath로 분리한다. 루트 barrel에서 Node 도구·React·Svelte·Effect를 재export하지 않는다. `sideEffects: false`는 실제 부작용 없는 entry에 한해 사용한다.

소스 TS를 바로 가져오면 소비 앱의 TS 5.9/6 문법·lib 차이, 경로 별칭, `.ts` import, Node 직접 실행 여부가 함께 문제가 된다. L의 `Uint8Array<ArrayBuffer>` 같은 공개 타입도 양쪽 compiler/lib로 확인해야 한다. Vite 8의 Rolldown 설정을 Vite 6의 Rollup 설정에 복사할 수 없으며 Vite 플러그인은 두 버전의 타입/API에 추가로 묶인다. 따라서 순수 함수/JS만 패키지에 두고 Vite·React·Svelte 어댑터와 테스트 runner 설정은 소비 앱에 남긴다. 두 Vitest 버전을 공용 런타임 의존성으로 맞출 필요는 없다.

안전한 tarball도 **실제 설치·타입 검사·번들 검증을 해 보기 전까지 호환 보장으로 표현하지 않는다**. 이번 조사에서는 설치 실험이나 빌드를 하지 않았다.

### 2.2 별도 저장소 패키지: 공개 npm / GitHub Packages / git

**공개 npm.** 예를 들어 `@sch0718/kakao-share`를 `yarn add ...@0.1.0`, `pnpm add ...@0.1.0`으로 각각 고정한다. 공용 저장소 발행 CI가 테스트·빌드·pack 내용을 검증하고 두 앱은 갱신 PR로 채택한다. 설치할 때 공용 저장소 devDependencies를 빌드할 필요가 없도록 결과 JS/d.ts/라이선스를 tarball에 넣는다. 버그 수정은 발행만으로 자동 반영되지 않으며 두 lockfile 갱신이 완료돼야 전파된 것이다. 랜드마크의 `private: true`는 앱의 오발행 방지 설정이므로 이를 해제하지 말고 별도 패키지를 만든다.

**GitHub Packages.** npm registry는 `@sch0718:registry=https://npm.pkg.github.com` 같은 scope 매핑과 인증을 요구한다. GitHub 공식 문서는 **private/internal/public 모두 설치 토큰 필요**라고 명시한다. Actions에서는 패키지 읽기 권한을 받은 소비 저장소의 `GITHUB_TOKEN`을 쓰거나 `read:packages` PAT classic을 쓸 수 있다. Cloudflare 빌드에는 Actions의 토큰이 자동 주입되지 않으므로 별도 build secret이 필요하다. 공개 패키지를 고르는 목적이 설치 간소화라면 공개 npm보다 불리하다. [GitHub npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), 확인 2026-10-27.

**git 의존성.** `github:sch0718/x#v0.1.0` 또는 commit SHA를 가리킬 수 있으나 branch/latest는 피한다. 두 관리자가 읽는 패키지는 저장소 루트에 두고 산출물도 해당 tag에 포함하는 편이 단순하다. Yarn Classic은 git URL의 branch/commit/tag를 지원하며, 1.22.22 구현은 `prepare`가 있으면 임시 clone에서 install 후 pack한다. [Yarn Classic add](https://classic.yarnpkg.com/lang/en/docs/cli/add/), [Yarn 1.22.22 Git fetcher](https://raw.githubusercontent.com/yarnpkg/yarn/v1.22.22/src/fetchers/git-fetcher.js), 확인 2026-10-27.

가즈아는 `pnpm@10.34.6`이다. pnpm 10.26부터 git 의존성의 `prepare`는 허용 목록 없이 실행되지 않으며 `onlyBuiltDependencies`/`allowBuilds`로 승인해야 한다. 이를 일반적인 npm 설치의 prepare 동작과 같다고 가정하면 안 된다. [pnpm 10.26 공식 릴리스 설명](https://pnpm.io/blog/releases/10.26), [pnpm 10 설정](https://pnpm.io/10.x/settings), 확인 2026-10-27. 그러므로 **소비자 install 시 prepare 빌드에 의존하지 않는 배포**를 추천한다. 직접 허용이 필요한 경우 최소 패키지만 지정하고 실제 설치 결과를 확인한다. L 앱의 `prepare: husky`를 그대로 공용 git 패키지에 가져오지 않는다.

### 2.3 모노레포(pnpm workspace)

제안 구조는 `apps/landmark`, `apps/gazua`, `packages/kakao-share`, `packages/motion-kit`, `workers/gazua-sync`, `workers/gazua-proxy` 정도다. 이는 가능성 비교이며 현재 폴더를 옮기자는 결정이 아니다.

pnpm의 `workspace:*`는 로컬 workspace 패키지만 허용하고 pack/publish 때 실제 버전 의존성으로 변환된다. Yarn 1도 workspace 자체는 지원하지만 Classic 문서는 일치하는 일반 버전으로 로컬 패키지를 연결하는 방식을 사용한다. **pnpm의 `workspace:` 표기를 Yarn 1 소비 manifest에 그대로 주지 않는다.** [pnpm 10 Workspace](https://pnpm.io/10.x/workspaces), [Yarn Classic Workspaces](https://classic.yarnpkg.com/lang/en/docs/workspaces/), 확인 2026-10-27.

비용은 L Yarn lock→pnpm lock, install/CI/README 명령, `.yarnrc`의 engines 처리, husky/빌드 script, 중첩 miniflare `sharp` 탐색, 경로 기반 테스트·생성기·도메인별 배포를 다시 검증하는 일이다. pnpm의 엄격한 의존성 배치에서 우연히 접근하던 간접 패키지를 잃을 수 있다. React/Svelte·TS·Vite 버전을 꼭 하나로 맞출 필요는 없지만 루트 override로 억지 통일하지 않아야 한다.

Cloudflare Pages는 monorepo의 프로젝트 root directory와 출력/빌드 명령을 지정할 수 있다. workspace 의존을 포함하도록 저장소 루트에서 install/build하고 결과를 `apps/landmark/dist`로 지정하는 안, 앱 root에서 상위 workspace 명령을 실행하는 안 중 실제 preview 빌드로 하나를 검증해야 한다. `functions/` 발견 위치·D1 binding·viewer 별도 출력도 함께 확인한다. [Pages 빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Pages Monorepos](https://developers.cloudflare.com/pages/configuration/monorepos/), 확인 2026-10-27.

L 공유 지도는 기존 `dist-map`, `gh-pages`, `https://sch0718.github.io/landmark/`와 워크플로의 path filter/working-directory가 영향을 받는다. 공통 패키지 경로도 trigger에 넣어야 한다. G 앱 Pages artifact 경로·평일 재빌드·커스텀 도메인/base도 조정한다. 저장소를 합치며 Pages URL이 자동 유지된다고 가정하면 안 된다. 당장은 두 저장소와 독립 릴리스를 유지하는 이득이 더 크다.

### 2.4 submodule / subtree

**submodule**은 소스 저장소 commit 포인터를 고정한다. Yarn/pnpm의 별도 프로토콜에 기대지 않고 checkout 후 로컬 패키지/도구로 쓸 수 있으나 Actions checkout의 submodule 준비, Cloudflare 빌드에서 해당 경로가 채워지는지, 비공개 소스의 Git 인증을 따로 처리해야 한다. Pages의 실제 재귀 checkout 동작은 이번 조사에서 확인 못 했다. TS 소스를 직접 링크하는 경우 2.1의 컴파일러 문제가 그대로 남는다.

**subtree**는 `vendor/shared` 같은 경로로 실제 파일을 포함하므로 소비 빌드는 일반 checkout만으로 가능하다. 갱신은 원본 commit을 병합하는 PR이 필요하고 양쪽에서 vendor를 고치면 충돌이 생긴다. source SHA·라이선스를 기록하고 한쪽 방향 갱신으로 제한해야 한다. 두 방식 모두 registry 발행은 없지만 공용 테스트·빌드 산출물 책임까지 없애 주지는 않는다. 현 단계에서는 아래 복사 방식보다 운영 개념이 많다.

### 2.5 JSR

JSR의 npm 호환 레이어는 Node/Vite/Workers 및 npm 호환 관리자를 지원하고 TS를 JS와 선언 파일로 변환해 설치한다. pnpm 10.9+는 `jsr:` 패키지 추가를 지원하지만 **Yarn 1은 네이티브 지원 대상이 아니다**. Yarn 1에서는 `npx jsr add @scope/pkg --yarn`으로 alias/registry 설정을 생성하거나 `@jsr:registry=https://npm.jsr.io`와 npm alias를 명시하는 호환 경로를 써야 한다. 소비 코드는 일반 패키지 import를 사용하며 `jsr:` 소스 import를 그대로 Vite에 넣지 않는다. `.npmrc`도 함께 관리해야 한다. [JSR npm compatibility](https://jsr.io/docs/npm-compatibility), 확인 2026-10-27.

TS 친화성은 장점이지만 현재 두 앱에는 npm 생태계로 충분하고 새 registry·발행 경로가 늘어난다. 공용 프로젝트를 Deno 등으로 넓힐 요구가 생길 때 재검토한다. 이름 사용 가능 여부·실제 Yarn 1 lockfile 설치는 확인 못 했다.

### 2.6 복사 + 동기화 스크립트

초기에는 L `src/shared/kakao-share/`를 원본으로 정하고 G의 복사본에 원본 저장소·고정 commit·상대 경로·파일별 SHA-256·라이선스를 기록하는 안을 추천한다. 메타데이터와 동기화 도구도 **후속 구현 대상**이며 이번 문서 외 파일을 만들지 않는다.

G CI는 고정된 **공개 원본 commit**을 읽어 복사본의 해시 또는 diff를 검사한다. 고정 원본과 일치하면 재현성을 보장하고, 새 원본 commit 알림/갱신 PR은 별도 절차로 처리한다. 최신 main을 매 빌드 즉시 복사하면 임의 변경으로 빌드가 흔들리므로 피한다. 원본 갱신 PR은 허용된 파일 목록만 바꾸고 소비 앱의 데이터/설정에는 쓰지 않도록 한다. 원본과 복사본 양쪽 수정은 금지하고 앱별 코드는 어댑터로 분리한다.

설치 인증·패키지 관리자 차이를 피하고 두 앱의 빌드 도구를 유지할 수 있다. 반면 두 PR이 필요하며 잊으면 수정이 전파되지 않는다. 양쪽에 반복 수정이 생기거나 다른 소비처가 추가되면 공개 npm으로 전환한다. 이 기준은 일정 강제가 아니라 비용을 재평가하는 신호다.

### 2.7 생성기만 CLI 패키지로

예를 들어 공개 npm의 `@sch0718/motion-kit`를 두 앱 devDependency로 고정하고 로컬 script가 palette·font·문서 제목·장면 콜백·출력 경로를 전달한다. CLI 내부는 Node ESM JS로 빌드하며 UI 코드를 import하지 않는다. `hero/help-pages`는 소비 저장소 소유로 둔다. 이미지 변환을 포함한다면 `sharp`를 직접 의존성으로 선언하고 두 Node 버전에서 설치를 시험한다.

이 방식은 생성 결과 SVG/Markdown/TS가 앱에 남아 런타임 JS를 늘리지 않는 장점이 있다. 다만 생성기 버전 갱신마다 양쪽 산출물과 reduced-motion·light/dark를 검토해야 한다. 동작을 바꾸는 새 버전 자동 실행보다 고정 버전 실행을 권한다. 같은 저장소에서 런타임 SDK 모듈과 개발 도구를 관리하더라도 설치·entry·릴리스 단위를 분리한다.

### 2.8 Actions·Cloudflare 설치 운영에서 확인된 사실과 남은 확인

**Pages 비공개 의존성.** 공식 안내는 Production/Preview 환경의 `NPM_TOKEN`과, 여러 registry일 때 scope 및 환경변수 참조를 둔 프로젝트 `.npmrc`를 설명한다. GitHub registry도 해당 출처용 토큰이 필요하다. 아래는 변수 이름만 보이는 제안 예시이며 실제 파일을 생성하지 않았다.

```ini
@sch0718:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${TOKEN_FOR_GITHUB}
```

토큰 값은 Cloudflare build secret/Actions secret에 두고 source·Vite 공개 변수·번들에 넣지 않는다. 레지스트리 인증은 빌드 시 설치 권한이며 배포된 Worker의 런타임 비밀값이 아니다. `.npmrc.pages`와 `NPM_CONFIG_USERCONFIG`로 별도 설정 파일을 지정하는 공식 방법도 있다. [Pages Install private packages](https://developers.cloudflare.com/pages/how-to/npm-private-registry/), 확인 2026-10-27.

**Pages 빌드 이미지.** 공식 v3 문서는 `YARN_VERSION`·`PNPM_VERSION`, Node의 `NODE_VERSION`/`.nvmrc` override를 제공한다. v3는 **lockfile의 버전에서 Yarn/pnpm 버전을 추론하거나 `package.json.engines`로 Node/관리자 버전을 감지하지 않는다**. v3의 기본값은 Yarn 4.9.1, pnpm 10.11.1, Node 22.23.4이고 Node는 `.nvmrc`·`.node-version`으로 바꿀 수 있다(같은 문서, 2026-10-27 확인). `YARN_VERSION`을 두지 않으면 L의 Yarn 1 lockfile을 Yarn 4가 읽게 된다. 따라서 L은 Yarn 1.22.22/Node 24, G를 Pages로 옮길 경우 pnpm 10.34.6/Node 22를 명시적으로 맞춰야 한다. 현재 L Pages 프로젝트가 v2/v3 중 어느 이미지와 어떤 변수를 쓰는지는 대시보드에서 확인 필요다. 자동 설치를 끄는 `SKIP_DEPENDENCY_INSTALL=1`과 고정 버전 install 명령을 쓰는 안이 재현하기 쉽다. **어느 lockfile을 우선해 관리자를 선택하는지, `packageManager`와 override의 정확한 우선순위는 이 공식 문서에서 확인하지 못했으므로 확인 필요**다. 현재 Pages 프로젝트의 이미지/환경 설정도 확인 못 했다. [Pages Build image](https://developers.cloudflare.com/pages/configuration/build-image/), 확인 2026-10-27.

**Workers.** Actions에서 먼저 frozen install 후 Wrangler bundle/deploy를 수행하면 같은 패키지 인증 규칙을 적용할 수 있다. Workers Builds를 직접 쓸 경우 공식 설정에 root directory·build command·빌드 전용 variables/secrets가 있다. 이 점에서 build secret을 쓰는 설계를 제안하지만, Pages의 자동 `.npmrc`/`NPM_TOKEN` 처리가 Workers Builds에서도 동일하다고 단정하지 않는다. 이 조합은 preview에서 확인 필요다. [Workers Builds Configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), 확인 2026-10-27. 현재 G 배포 workflow는 앱 GitHub Pages용이며 Worker 자동 배포 구성까지 검증한 것은 아니다.

## 3. 라이선스

이 절은 기술적 선택을 위한 검토이며 **법률 자문이 아니다**. 아래 재라이선스/별도 허락 제안은 **사용자가 두 저장소에서 이전할 자작 코드의 유일한 저작권자라는 전제**다. 외부 기여·고용계약·복사한 제3자 소스·브랜드/폰트/SDK의 권리는 이 전제에 포함되지 않는다.

### 3.1 현재 상태와 기여자 확인

| 대상 | 확인 상태 | 의미 |
| --- | --- | --- |
| L main | `package.json`의 `private: true`, license 필드·LICENSE 없음. `gh repo view sch0718/landmark --json licenseInfo,visibility` → `licenseInfo: null`, `PUBLIC`(2026-10-27 확인) | 공개 저장소이나 라이선스 미지정, 기본 저작권/All rights reserved |
| G `origin/main` | LICENSE·license 필드 없음. `gh repo view sch0718/gazua` → `licenseInfo: null`, `PUBLIC`(2026-10-27 확인) | 아직 PolyForm 적용 상태라고 쓰지 않음 |
| G 라이선스 브랜치 `1684858` | `LICENSE` PolyForm Noncommercial 1.0.0, 앱·proxy·sync-worker의 package license 필드, 고지 생성기 추가 | 병합 전 선택안. Required Notice의 저작권자는 신춘호 |

공개 열람·GitHub fork 가능성과 일반 재사용 허락은 다르며 `private: true`도 저장소 공개성이나 코드 라이선스를 정하지 않는다. [GitHub 저장소 라이선스 안내](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository), 확인 2026-10-27.

저자 조사는 L `git log origin/main --format='%an %ae' | sort -u`, G `git -C <가즈아> log origin/main --format='%an %ae' | sort -u`로 실행했다. 가즈아 작업 트리의 진행 중 브랜치를 기준으로 삼지 않았다. 추가로 L `--all`과 G 라이선스 브랜치도 확인했다.

- L main: 같은 `sch0718@naver.com`의 신춘호 이름이 완성형/분해형 두 표기로 나타났다. `--all`에서는 `landmark deploy <actions@users.noreply.github.com>`도 나타나며 배포 workflow가 쓰는 자동 저자다.
- G main 및 라이선스 참조: 위 두 이름 표기 외에 `Claude <noreply@anthropic.com>` 저자가 있다.
- 두 main의 커밋 본문 `Co-authored-by:` 검색에는 Claude Opus/Sonnet 표기가 있다. AI 도구 사용 기록을 별도 인간 기여자의 권리 증거로 단정하지 않는다. 반대로 log의 이름만으로 모든 코드의 권리 귀속을 확정할 수도 없다.
- **제공된 Git 이력에서는 별도 인간 외부 기여자를 발견하지 못했다.** 외부 복사·미기록 기여·실제 권리 이전 약정까지 확인한 것은 아니므로 사용자의 단독 권리 확인을 결정 항목으로 남긴다.

### 3.2 공통 코드의 선택지

| 선택 | 양쪽 소비/외부 재사용 | 판단 |
| --- | --- | --- |
| MIT 등 허용형 | 상업 이용까지 허용, 저작권/허락 고지 유지. MIT 공통 코어를 NC 앱에서도 소비 가능 | 범용 loader/seen/SVG 유틸에 **추천**, 상업 재사용 허용 여부 결정 필요 |
| PolyForm-NC | 비상업 목적 범위의 이용·배포, 조건 및 Required Notice 유지 | 공통 코드도 상업 사용을 제한하려면 선택. 허용형 OSS와 동일하게 표현하지 않음 |
| 랜드마크 현재와 같게(라이선스 미지정) | 소유자 자신의 두 앱에서는 명시적 내부 허락으로 사용 가능하나 제3자 재사용 권리는 불명확 | 임시 보류안. 공개 재사용 패키지에는 비추천 |
| 소유자가 범용 부분만 별도 MIT/이중 허락 | 앱 자체의 NC/미지정 정책과 범용 코어 정책을 분리 | 권리 범위를 명시할 수 있을 때 유용 |

MIT는 저작권/허락 고지 보존 조건을 가진다. [MIT 원문](https://opensource.org/license/mit), 확인 2026-10-27. PolyForm-NC의 구체 조건은 `git show origin/chore/license-polyform-nc:LICENSE`로 확인했으며 [해당 라이선스 원문](https://polyformproject.org/licenses/noncommercial/1.0.0/) URL도 문서 안에 명시되어 있다(웹 원문 별도 대조는 미실시). 라이선스를 root에 하나 추가했다고 제3자 의존성이나 이전의 모든 배포 조건을 바꿀 수 있는 것은 아니다.

### 3.3 코드 이동 방향별 검토

**L → G.** 현재 L은 재사용 라이선스가 없다. 단독 소유자인 사용자는 자신의 범용 코드에 MIT 또는 별도 허락을 부여해 G에 넣을 수 있지만, 공개라는 이유만으로 제3자가 복사할 권리가 생기는 것은 아니다. 원본 commit·파일·권리 선언을 남긴 뒤 G의 NC 적용 대상과 MIT 예외 경계를 표시한다.

**G → L.** main은 아직 미지정이고 NC 브랜치도 미병합이다. 나중에 NC가 적용된 코드를 L로 가져오는 경우 그 코드의 NC 조건/고지가 사라지는 것은 아니다. 사용자 단독 소유 코드라면 범용 부분을 별도로 MIT 배포할 수 있다는 전제에서 검토하되, 외부 NC 기여나 제3자 코드를 일괄 MIT로 바꾸지 않는다. NC 코드를 포함한 배포물의 조건은 경계를 검토해야 하며 “L 전체는 아무 제한 없음”이라고 선언하지 않는다.

**이미 복사된 생성기.** 사용자 제공 사실대로 G는 L 생성기에서 출발한 사본을 갖고 있다. 현재 diff는 공통 골격과 앱별 확장을 보여 준다. 같은 단독 소유자의 자체 복사라면 그 자체로 타인 저작권 침해라고 볼 근거는 없으나, 원본이 공개였으므로 자동 허용됐다는 설명도 틀리다. G에 NC를 더해도 L 원본과 별도 권리 부여까지 소급해 NC로 바뀌지는 않는다. 첫 추출 PR에서 원본 출처·이전 파일 범위·신규 수정분의 라이선스를 정리하는 편이 좋다. 최초 복사의 정확한 경계/별도 허락 기록은 확인 못 했다.

### 3.4 의존성 고지

G `scripts/build-notices.mjs`는 **main에는 없고** `origin/chore/license-polyform-nc`에 있다. `pnpm licenses list --prod --json`을 받아 패키지별 LICENSE/COPYING/NOTICE를 모아 `public/licenses.txt`에 원자적으로 쓰며, 라이선스 브랜치의 `prebuild`가 이를 실행하도록 변경되어 있다. 이 도구는 pnpm 출력에 결합되어 L Yarn 1에 그대로 이식할 수 없다.

공통 패키지는 자신의 LICENSE·저작권/Required Notice와 가져온 의존성 고지를 pack에 포함한다. 두 앱의 배포 고지에도 반영하고, L viewer처럼 자산을 HTML에 인라인하는 산출물에서도 필요한 고지를 확인한다. G 스크립트의 운영 의존성 목록만으로 빌드 도구가 산출물에 삽입한 SVG·아이콘·폰트·Kakao SDK 고지까지 전부 충족한다고 가정하지 않는다. 패키지에 라이선스 파일이 없을 때 같은 SPDX의 다른 패키지 원문을 보충하는 현재 방식도 패키지별 저작권/NOTICE 검토를 대신하지 못한다. 전체 의존성 감사와 SDK 재배포 조건은 이번에 확인하지 않았다.

## 4. 추천안과 단계별 이전 계획

> 서비스가 계속 늘어난다는 전제라면 이 절 대신 **6.10 단계 계획**을 따른다. 이 절은 소비처가 두 앱뿐일 때의 안으로 남긴다.

**권고:** 두 저장소를 유지한다. **카카오 독립 모듈 → 출처가 있는 복사+동기화 검사 → 작은 순수 로직 → 안정 후 공개 npm** 순서로 진행한다. 생성기 전체를 첫날 패키지로 바꾸거나 앱 저장소를 합치는 일은 미룬다. MIT 허용 여부가 결정되기 전에는 공개 범용 패키지를 발행하지 않는다.

아래 작업량은 한 명이 기존 구조를 이해하고 있다는 조건의 **추정**이며 이번에 수행한 작업이 아니다. 테스트 명령은 각 단계 구현 후 실행할 검증안이다. G 명령은 다른 세션이 끝난 뒤 별도의 승인된 checkout/CI에서만 실행하며 현재 G 체크아웃에는 실행하지 않는다. 테스트·build·생성기는 출력 파일을 쓰므로 이번 조사 중에는 어느 앱에서도 실행하지 않았다.

### 단계 0. 권리·연결 계약 확정 — 1~2시간, 결정/준비 PR 1개 추정

- **범위:** 단독 권리 전제 확인, 범용 코어 라이선스와 원본 저장소 결정, 다른 세션의 카카오 결과를 받아 인터페이스·출처 commit 고정. 계정별 SDK 도메인과 이미지/링크 소유 앱을 정한다.
- **검증:** 두 main과 카카오 완료 commit을 다시 고정하고 `git diff --stat <기준>..<완료>` 및 파일별 import 검토. `.env`를 열지 않고 공개 설정 이름과 배포 등록 상태만 확인한다. L 기록된 예산과 새 실측을 구분한다.
- **되돌리기:** 준비 문서/메타데이터만 revert. 앱 데이터 변경 없음.
- **첫 로딩 영향:** 실행 코드 변경이 없으면 추가 JS 없음. L의 과거 기록상 여유 18,368 B, G는 예산 없음. 실제 현황은 다음 단계 전 측정해야 한다.

### 단계 1. 카카오 모듈 두 앱 적용 + 첫 크기 기준 — 4~8시간, 앱별 PR 2개 추정

- **범위:** L 독립 폴더의 loader/payload만 G에 그대로 복사하고 어댑터 분리. 원본 SHA·파일 해시와 CI 드리프트 검사를 추가한다. G에 크기 측정기를 먼저 도입해 기준값과 예산을 결정한다. 현재 다른 세션의 구현을 이 단계 작업량에 중복 산입하지 않도록 조정한다.
- **단위 검증:** loader 중복 호출 1회, 실패 후 재시도, 시간 초과, 키 충돌, 잘못된 URL, 빈 설정, SDK 없음, 늦게 끝난 이전 요청 무시. 카카오 메시지는 정제된 제목/설명·공개 이미지·완성된 공유 URL만 받는지 검사한다.
- **앱 검증 명령:** L `yarn typecheck`, `yarn test`, `yarn build:ci`, 관련 `yarn test:e2e --grep '공유|링크'`(실제 test 제목과 match 확인 후 범위 확정). G `corepack pnpm check`, `corepack pnpm check:e2e`, `corepack pnpm test`, `corepack pnpm --filter sync-worker test`, `corepack pnpm e2e`. G 신규 예산 검사는 build 뒤 실행하도록 연결한다.
- **브라우저 검증:** 클릭 전 SDK 네트워크 0건, 클릭 후 단일 로드, 로딩 후 다시 누르기, CSP 위반/팝업 차단/오프라인 실패·기존 복사 안내. 긴 L fragment가 그대로 도착하는지, G capability가 만료/철회 전후 올바르게 동작하는지 실제 수신 링크로 수동 확인한다. 실전 전송 시험은 소유자 본인 대상 동의 후 수행한다.
- **되돌리기:** 카카오 버튼/어댑터/복사 모듈을 제거한 기존 공유 흐름으로 앱 PR revert. 기존 링크 형식과 서버 DB 스키마를 바꾸지 않아 복귀 범위를 작게 유지한다. 앱 배포와 지도 gh-pages는 각각 복귀한다.
- **첫 로딩 영향:** SDK는 클릭 때만 로드하고 helper도 기존 lazy 공유 경로 안에 둔다. 로컬 helper 증가량과 CDN SDK 클릭 후 전송량은 따로 잰다. L 327,680 B 통과와 lazy 유지가 조건이며 약 18 KB를 SDK 허용량으로 쓰지 않는다. G는 첫 측정 후 합의한 예산을 CI에 넣고 PWA 사전 캐시에 SDK가 섞이지 않는지 확인한다.

### 단계 2. 처음 안내 기록·SVG 기반 함수 추출 — 4~8시간, 2~3 PR 추정

- **범위:** `createSeenStore`를 먼저 양쪽 wrapper 뒤에 놓는다. 이어 `esc/at/textWidth/svgDocument/motionCss` 중 같은 계약으로 만들 수 있는 부분, 도움말 내용 직렬화만 추출한다. `chip/card/button`의 토큰 차이와 앱 장면은 당장 통합하지 않는다. Node 코어와 브라우저 코어는 분리한다.
- **검증:** L `tests/unit/services/help-seen.test.ts`, G `src/lib/help/seen.test.ts`를 바탕으로 차단 Storage·손상 JSON·쓰기 실패·모르는 ID·reset 동작 및 기존 키를 확인한다. L `yarn test`, G `corepack pnpm test`와 두 앱 help E2E를 실행한다. 생성기는 승인된 각 checkout에서 L `yarn build:motion`, G `corepack pnpm build:motion` 실행 후 L은 `git diff --stat -- docs/help docs/readme public/help/img src/sections/help/help-content.ts`, G는 `git diff --stat -- docs/help docs/readme public/help/img src/lib/help/content.ts`로 의도 밖 산출물 변경을 확인한다. light/dark·모션 감소·긴 한국어/이모지·XML 특수 문자를 렌더 확인하고 반복 생성의 결정성을 확인한다.
- **되돌리기:** 로컬 wrapper와 이전 generator 버전/산출물을 함께 revert. 기존 help-seen 키를 유지하므로 안내 이력이 그대로 남는다.
- **첫 로딩 영향:** SVG/Markdown 생성기는 dev 도구여서 앱 JS 추가 목표는 0 B. seen 추출은 import 관계에 따라 변하므로 다시 측정한다. 특히 G는 `HELP_PAGES` 전체 값 import를 ID 주입으로 줄일 수 있지만 절감 바이트는 미측정이다. L의 lazy HelpIntro/HelpPage를 유지하고 G 예산도 통과해야 한다.

### 단계 3. 안정된 코어의 패키지 발행·고정 — 4~8시간, 공용 저장소 1 PR+소비 앱 2 PR 추정

- **진입 조건:** 두 소비처에서 인터페이스가 검증되고 재사용/버그 수정이 반복되어 복사 관리보다 발행 비용이 낮아졌을 때. 그렇지 않으면 복사 방식을 계속 사용한다.
- **범위:** 공개 npm에 JS+d.ts, 명시적 exports·라이선스를 발행하고, 카카오 런타임/seen과 motion/budget 개발 도구를 분리한다. 정확 버전과 lockfile을 갱신한다. 생성기 CLI는 로컬 앱 장면을 입력으로 받도록 제한한다.
- **검증:** 발행 전 `npm pack --dry-run`으로 포함 파일 검토, 실제 tarball의 별도 소비 fixture에서 Yarn 1/Node 24/TS 6 및 pnpm 10.34.6/Node 22/TS 5.9 설치·타입 검사를 수행한다. scripts 의존 없이 결과 JS/d.ts가 있는지 확인한다. 양쪽 CI, L Cloudflare Preview·지도 build, G 앱 build 및 worker/proxy check/test를 통과시킨다. 클라이언트 번들에 Node/프레임워크/도구 의존성이 섞이지 않았는지 확인한다.
- **되돌리기:** 직전 패키지 정확 버전/lockfile로 되돌리거나 이전 복사본을 복구한다. 이미 발행한 버전을 덮어쓰는 방식으로 복귀하지 않는다. 배포 복귀 시 데이터 형식·공유 URL의 호환은 별도로 점검한다.
- **첫 로딩 영향:** 배포 방식 변경만으로 감소를 보장하지 않는다. 같은 기능이라도 entry/부작용 표시/청크 합쳐짐으로 달라질 수 있다. L `yarn size`/`build:ci`와 G 신규 예산 검사, 두 앱 클릭 전 네트워크 검사를 다시 통과해야 한다. CLI는 devDependency로만 설치해 앱 번들 영향 0 B를 목표로 한다.

### 이후 재검토

공용 코드가 늘어 동일 변경을 두 앱에 자주 동시에 반영하고, 배포·릴리스 주기까지 묶을 이유가 생겼을 때 모노레포를 다시 평가한다. CSP·CORS·백업·주 저장소는 줄 수 절감 목표로 추출하지 않고 동일한 정책이 실제 두 번 필요해졌을 때만 재검토한다. 프레임워크 UI 통합은 현재 계획에 포함하지 않는다.

## 5. 사용자가 결정할 질문 목록

| 질문 | 선택지 | 추천 |
| --- | --- | --- |
| 이전할 자작 코드의 권리를 단독 보유하는가? | 단독 보유 확인 / 외부 기여·복사 범위를 먼저 분류 | **확인 후 진행**. Git 저자 검색만으로 확정하지 않음 |
| 공통 코어의 상업 재사용을 허용할까? | MIT 등 허용형 / PolyForm-NC / 미지정+별도 허락 보류 | 범용 코어는 **MIT**, 앱 정책은 별도로 결정. 상업 재사용을 원치 않으면 NC |
| 초기 원본과 수정 방향은? | 랜드마크 원본→가즈아 복사 / 처음부터 공용 저장소 | 진행 중 세션과 맞춰 **랜드마크 원본**, 복사본 직접 수정 금지 |
| 첫 공통 범위는? | 카카오만 / 카카오+seen+SVG 기반 / 서버·저장소까지 | **카카오부터**, seen/SVG는 별도 후속 PR |
| 안정 후 배포 수단은? | 공개 npm / GitHub Packages / git tag / 복사 지속 | **공개 npm**. 반복 수정이 적으면 복사 지속 |
| 메시지 이미지는? | 앱별 정적 PNG / 동적 지도·차트 이미지 생성 | **정적 PNG**. 동적 렌더 서비스는 별도 과제로 분리 |
| SDK 최초 로딩 UX는? | 클릭→준비→다시 클릭 / 공유창 열 때 미리 로드 / 첫 로딩 포함 | **클릭 때 준비**, 모바일 실험 후 클릭 수를 조정 |
| 가즈아 첫 로딩 예산은? | 측정 후 한도 설정 / 측정만 먼저 / 당장 L 수치 적용 | **먼저 측정하고 별도 한도 설정**, L 수치 복사 금지 |
| 생성기 장면/테마는 공유할까? | 앱별 유지 / 공통 장면 언어까지 도입 | **앱별 유지**, 순수 기반 함수와 내용 형식만 공유 |
| 모노레포·pnpm 이전도 함께 할까? | 현 저장소 유지 / 지금 합치기 | **현 저장소 유지**, 필요가 커질 때 재평가 |
| 롤백·릴리스 기록은 어떻게 맞출까? | 공통 체크 항목만 복사 / 공통 배포 workflow로 강제 | **체크 항목만 복사**, 앱/지도/Worker의 복귀 방법은 각각 기록 |

**확인 못 한 항목(후속 검토 대상):** 진행 중 카카오 모듈의 최종 코드/테스트·등록 도메인, 채택 SDK 버전·integrity·크기·CSP 전체 요구 출처와 모바일 팝업/긴 URL 동작, 오늘의 두 앱 실제 첫 로딩 바이트와 가즈아 예산, Cloudflare 계정의 실제 빌드 이미지·root/환경 설정·응답 CSP, Pages 관리자 자동 선택/버전 우선순위·submodule 및 Workers Builds 인증 실험, 각 공유 방식의 실제 설치/pack/배포 호환, GitHub 최신 참조와 로컬 추적 참조 일치, Git 저자 외의 권리 귀속·원본 복사 허락 범위·전체 의존성/SDK 고지 충족. 이 문서의 제안 경로·패키지명·작업량은 확정된 구현이나 실측 성과가 아니다.

## 6. 별도 공용 저장소 안 (추가 검토, 2026-10-27)

사용자 요청: "앞으로 새로운 서비스를 계속 만들 예정이야. 공통으로 사용하는 코드들을 한 곳에서 관리하고 싶어." 이 절은 이 전제로 별도 공용 저장소 안을 검토한다. 1~5절은 소비처가 두 앱뿐이라는 조건에서 쓴 것이다.

### 6.1 결론이 바뀌는 부분

| 항목 | 1~5절(앱 2개) | 6절(앱이 계속 늘어남) |
| --- | --- | --- |
| 원본 위치 | 랜드마크 안 `src/shared/*` | **별도 공용 저장소** |
| 배포 | 처음엔 복사+동기화 검사, 안정 후 npm | **처음부터 공개 npm 패키지** |
| 가즈아의 카카오 모듈 | 랜드마크에서 복사 | 공용 패키지 `0.1.0`을 설치(복사 단계 생략) |
| 모노레포 | 하지 않음 | 앱은 여전히 합치지 않음. **공용 저장소 안에서만** pnpm workspace로 여러 패키지 관리 |

바뀌는 이유는 세 가지다.

1. 복사 방식은 소비처가 늘수록 복사본과 동기화 검사가 하나씩 늘어난다. 세 번째 서비스부터는 패키지 발행 비용보다 커진다.
2. 원본이 랜드마크 안에 있으면 공용 코드 수정이 랜드마크 릴리스·CI·Cloudflare 배포와 섞인다. 새 서비스는 랜드마크와 관계가 없어도 랜드마크 저장소에 의존하게 된다.
3. 공개 npm은 Yarn 1, pnpm, npm 어디서나, GitHub Actions와 Cloudflare 빌드 어디서나 토큰 없이 설치된다(2.2, 2.8). 새 서비스마다 설치 설정을 따로 할 일이 없다.

바뀌지 않는 것도 있다. **무엇을 공통화할지는 1절 판단을 그대로 쓴다.** 저장소를 따로 만든다고 공유 링크 형식, 백업 형식, 인증, 색 같은 앱 정책까지 넣지는 않는다.

### 6.2 저장소 형태

**저장소 하나에 패키지 여러 개**를 추천한다. 패키지마다 저장소를 만드는 안보다 CI·릴리스·라이선스·이슈를 한 곳에서 관리할 수 있어 개인 규모에 맞다. 패키지는 각자 버전을 가진다.

```
sch0718/<공용 저장소>           # 이름 예: kit, shared, common (결정 필요)
├─ packages/
│  ├─ kakao-share/      브라우저 런타임. 의존성 0. 카카오 SDK는 클릭 때 로드
│  ├─ seen-store/       처음 안내 기록(1-e-2)
│  ├─ motion-kit/       그림 생성기의 앱 무관 함수·도움말 직렬화(1-b). Node 전용
│  ├─ bundle-budget/    첫 로딩 크기 검사 CLI(1-h). Node 전용
│  └─ tsconfig/ …       설정 패키지. 새 서비스가 생길 때 추가(6.7)
├─ fixtures/            소비자 호환 시험용 작은 앱들(6.6)
├─ .changeset/          변경 기록(6.5)
├─ .github/workflows/   ci.yml · release.yml · 재사용 워크플로(6.7)
├─ pnpm-workspace.yaml
└─ LICENSE
```

- 공용 저장소의 패키지 매니저는 pnpm으로 한다. 가즈아·새 서비스와 같고, 소비자 쪽(랜드마크 Yarn 1)에는 영향이 없다. 소비자는 발행된 tarball만 설치한다.
- 저장소 이름이 정해지지 않아 이 문서에서는 `@sch0718/<패키지>`로 적는다.

### 6.3 패키지에 넣는 기준

이 기준을 공용 저장소 README에 그대로 두는 것을 제안한다. 기준이 없으면 공용 저장소가 한 앱의 사정에 끌려간다.

1. **프레임워크 무관.** React·Svelte·Effect·Vite·MUI를 import하지 않는다. 프레임워크 어댑터가 꼭 필요하면 `<이름>-react`, `<이름>-svelte` 같은 별도 패키지로 두고, 그 프레임워크 소비처가 두 곳 생길 때 만든다.
2. **소비처 두 곳 이상**이거나, 새 서비스에서 곧 쓸 것이 분명하다.
3. **도구는 넣고 값은 앱에 둔다.** 크기 검사기는 넣고 예산 수치는 앱에 둔다. CSP 직렬화는 넣을 수 있지만 허용 출처는 앱에 둔다. 카카오 JS 키·도메인·이미지 URL은 앱이 주입한다.
4. **앱 데이터 형식과 보안 정책은 넣지 않는다.** 백업 형식, 공유 링크 형식, 저장소 스키마, 인증, Worker 출처·캐시 정책이 여기에 해당한다(1-c, d, e, f).
5. **브라우저 패키지 규칙:** ESM만, 런타임 의존성 0 지향, `sideEffects: false`, `exports`로 진입점 명시, 루트 barrel에서 Node 도구를 다시 내보내지 않는다. 첫 로딩 예산(랜드마크 327,680 B)을 지키려는 규칙이다.
6. **비밀값 금지.** 공개 저장소·공개 패키지이므로 키·토큰·사내 주소를 넣지 않는다.

### 6.4 배포 수단: 공개 npm

| 수단 | 새 서비스에서 설치 | 판단 |
| --- | --- | --- |
| **공개 npm `@sch0718/*`** | 어디서나 토큰 없이 설치 | **추천** |
| GitHub Packages | 공개 패키지도 설치에 토큰 필요(2.2). 새 서비스마다 Actions·Cloudflare에 토큰 등록 | 비추천 |
| git 의존성 | 빌드 산출물을 커밋해야 함. pnpm 10.26부터 `prepare` 기본 차단(2.2). 저장소 하나에 패키지가 여럿이면 하위 폴더를 가리켜야 하는데, Yarn 1에서 되는지는 확인 필요 | 과도기에만 |
| JSR | Yarn 1은 호환 설정이 필요(2.5) | 후순위 |

- **npm 계정·scope는 확인 필요.** `@sch0718`은 npm 사용자 이름이 `sch0718`일 때 쓰는 개인 scope다. 이번 조사에서는 npmjs.com 사용자 페이지가 403을 돌려 계정이 있는지 확인하지 못했다. 레지스트리 검색 `maintainer:sch0718` 결과는 0건이었다(2026-10-27). 다른 이름의 계정이면 그 이름을 scope로 쓰거나 npm 조직을 만든다(공개 패키지만 발행하면 무료인지는 확인 필요).
- 공용 코드를 비공개로 두려면 npm 유료 비공개 패키지나 GitHub Packages+토큰이 필요하다. 지금 두 앱이 공개 저장소이므로 공개 패키지를 추천한다.

### 6.5 버전·릴리스·변경 전파

- **Changesets**로 패키지별 SemVer를 관리한다. PR마다 변경 기록 파일을 남기고, main에 병합되면 "Version Packages" PR이 자동으로 열린다. 이 PR을 병합하면 발행된다. `0.x` 동안은 minor 올림을 깨지는 변경으로 본다.
- **발행은 npm trusted publishing으로 한다.** GitHub Actions에서 OIDC로 발행하므로 장기 npm 토큰을 저장소에 두지 않는다. 조건은 npm CLI 11.5.1 이상·Node 22.14.0 이상이다. 공개 저장소에서 공개 패키지로 발행하면 provenance(출처 증명)가 자동으로 붙는다. 새 trusted publisher 설정은 2일 안에 첫 발행을 마쳐야 한다. 설정은 npmjs.com의 패키지 설정 화면에서 하므로 **첫 버전은 사용자가 직접 로컬에서 2FA로 발행해야 할 수 있다(확인 필요).** [npm Trusted publishing](https://docs.npmjs.com/trusted-publishers), 확인 2026-10-27.
- **미리보기 버전:** `changeset version --snapshot <이름>`으로 `0.0.0-<이름>-<시각>` 버전을 만들고 `changeset publish --tag <이름>`으로 `latest`가 아닌 태그에 발행한다. 앱의 Cloudflare Preview에서 공용 코드 변경을 미리 확인할 때 쓴다. [Changesets snapshot releases](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md), 확인 2026-10-27.
- **소비 앱 갱신:** 앱은 정확한 버전으로 고정하고 lockfile을 커밋한다. Dependabot이나 Renovate가 `@sch0718/*`를 묶어 앱마다 갱신 PR을 연다. 앱 CI(랜드마크 `yarn build:ci`의 크기 검사 포함)를 통과한 뒤 병합한다. 공용 패키지에 버그가 생겨도 갱신 PR을 병합하기 전까지 서비스에는 퍼지지 않는다.
- **되돌리기:** 이미 발행한 버전을 덮어쓰지 않는다. 앱은 이전 정확 버전으로 되돌리고, 공용 저장소는 고친 버전을 새로 발행한다. 문제 버전은 `npm deprecate`로 표시한다.

### 6.6 개발 흐름과 호환 시험

별도 저장소의 가장 큰 비용은 **공용 코드와 앱을 같이 고칠 때**다. 수정 하나가 공용 PR, 발행, 앱 PR로 나뉜다. 이 순서를 제안한다.

1. 공용 저장소에서 단위 테스트로 먼저 만든다.
2. 앱에서 빠르게 확인할 때는 로컬 tarball을 쓴다. 공용 저장소에서 `pnpm pack`을 실행하고, 앱에서 그 `.tgz`를 설치해 본다. 이 변경은 커밋하지 않는다. 브라우저 패키지는 의존성이 0이라 링크 방식(`yarn link`/`pnpm link`)으로 인한 의존성 중복 문제도 작지만, 실제 발행물과 같은 tarball이 더 정확하다.
3. Cloudflare Preview에서 확인해야 하면 snapshot 버전을 발행한다(6.5).
4. 정식 발행 후 앱 갱신 PR을 병합한다.

**호환 시험(공용 저장소 CI).** `fixtures/`의 작은 소비자 앱에 발행 직전 tarball을 설치해 `tsc --noEmit`과 `vite build`를 돌린다.

| fixture | 조건 | 대표 앱 |
| --- | --- | --- |
| `yarn1-ts6` | Yarn 1.22, TS 6, Vite 8, Node 24 | 랜드마크 |
| `pnpm-ts59` | pnpm 10, TS 5.9, Vite 6, Node 22 | 가즈아 |
| `new-service` | 새 서비스의 기본 조합 | 이후 서비스 |

- 지원 하한은 **TS 5.9, Node 22, ESM**으로 둔다. 선언 파일은 TS 5.9로 생성하고 TS 6에서도 검사한다(2.1).
- 빌드 도구는 `tsc`만으로 시작한다. 패키지가 작고 의존성이 없어 번들러가 필요 없다. JS와 `.d.ts`를 같이 낸다.

### 6.7 설정·CI·새 서비스 템플릿

새 서비스가 계속 생긴다면 코드보다 **설정 공유의 이득이 더 클 수 있다.**

- **설정 패키지:** `@sch0718/tsconfig`(앱은 `"extends": "@sch0718/tsconfig/base.json"`), 필요하면 `eslint-config`, `prettier-config`. 지금 eslint·prettier는 랜드마크에만 있다(1-i). 새 서비스부터 쓰고, 기존 두 앱은 억지로 옮기지 않는다.
- **재사용 워크플로:** 공용 저장소에 `on: workflow_call` 워크플로를 두면 다른 저장소가 `uses: sch0718/<공용 저장소>/.github/workflows/node-ci.yml@v1`처럼 부른다. 개인 계정이라 `secrets: inherit`는 쓸 수 없고(같은 조직·엔터프라이즈일 때만) 필요한 비밀값을 이름으로 넘긴다. [GitHub Reusing workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows), 확인 2026-10-27. 1-i의 판단대로 기존 두 앱의 CI는 앱별로 두고 새 서비스부터 쓴다.
- **새 서비스 템플릿:** 공용 패키지와 설정 패키지를 이미 쓰도록 만든 GitHub 템플릿 저장소를 따로 둔다. 템플릿은 패키지가 아니라 시작점이다. 세 번째 서비스를 만들 때 만드는 것을 추천한다. 두 번째 사례가 생기기 전에 만든 템플릿은 맞지 않기 쉽다.

### 6.8 라이선스

공용 저장소는 LICENSE 하나로 모든 패키지에 적용한다. **MIT를 추천한다.** 소비하는 서비스의 라이선스가 무엇이든(가즈아 PolyForm-NC, 랜드마크 미지정, 이후 상업 서비스) 제약 없이 넣을 수 있다. PolyForm-NC로 두면 사용자 본인은 저작권자라 상관없지만, 나중에 다른 사람과 함께 만드는 상업 서비스나 외부 기여를 받을 때 걸린다. 3절과 같이 **사용자가 옮길 코드의 유일한 저작권자라는 전제**이고, 법률 자문이 아니다. 패키지 tarball에는 LICENSE를 넣고, 각 앱의 오픈소스 고지(가즈아 `scripts/build-notices.mjs` 등)에 공용 패키지가 잡히는지 확인한다.

### 6.9 1절 후보의 배치

| 후보(1절) | 공용 저장소 | 시기 |
| --- | --- | --- |
| a. 카카오 공유 | `@sch0718/kakao-share` | 단계 A |
| e-2. 처음 안내 기록 | `@sch0718/seen-store` | 단계 B |
| h. 첫 로딩 크기 검사 | `@sch0718/bundle-budget`(CLI) | 단계 B, 가즈아 예산 도입과 함께 |
| b. 그림 생성기 | `@sch0718/motion-kit`: 앱 무관 함수·도움말 직렬화만. 장면은 앱에 | 단계 B |
| i. TS·린트 설정, CI | 설정 패키지·재사용 워크플로 | 단계 C(새 서비스 시작 때) |
| g. CSP | directive 직렬화만. 정책 값은 앱에 | 세 번째 앱에서 필요해지면 |
| f. Worker 공통부 | 한도 있는 JSON 읽기 등 작은 도우미만 후보 | 보류 |
| c, d, e, j, k, h-2 | 넣지 않음 | — |

### 6.10 단계별 계획

작업량은 추정이다. 이번 세션은 아무것도 만들거나 실행하지 않았다.

**단계 A. 공용 저장소 뼈대 + 카카오 이전 — 1일 안팎, 공용 PR 1~2개 + 앱 PR 2개**

- **결정:** 저장소 이름, npm 계정·scope, 라이선스(6.11).
- **만들기:** pnpm workspace, Changesets, `ci.yml`(테스트·빌드·fixture 호환), `release.yml`(trusted publishing). README에 6.3 기준.
- **카카오:** 다른 세션이 랜드마크에 만드는 독립 폴더를 `packages/kakao-share`로 옮기고 `0.1.0`을 발행한다. 랜드마크는 폴더를 지우고 패키지 의존으로 바꾼다. **가즈아는 복사하지 않고 처음부터 패키지를 설치한다(2026-10-27 사용자 결정).** 그래서 복사본 출처 기록과 동기화 검사는 만들지 않는다. 가즈아 카카오 공유는 `@sch0718/kakao-share` 첫 발행 뒤에 붙인다.
- **검증:** 공용 CI(fixture 3종), 랜드마크 `yarn build:ci`(`ExportHtmlDialog`·`TripShareDialog`의 `--require-lazy` 포함), 가즈아 `check`·`test`·`e2e`, 두 앱에서 공유 버튼을 누르기 전 카카오 SDK 요청 0건.
- **되돌리기:** 앱 PR을 revert해 이전 폴더를 복구한다. 패키지는 `npm deprecate`.
- **첫 로딩:** 같은 코드를 위치만 옮기므로 바이트 변화는 거의 없을 것으로 본다(추정). 공유 화면 lazy 청크에 그대로 있는지 확인한다.

**단계 B. seen-store · bundle-budget · motion-kit — 1~2일, 패키지당 공용 PR 1개 + 앱 PR 2개**

- 검증은 4절 단계 2와 같다. 생성기는 두 앱에서 `build:motion`을 다시 돌려 산출물이 바뀌지 않는지 `git diff --stat`으로 확인한다.
- 가즈아에 `bundle-budget`을 넣을 때 처음 측정값으로 예산을 정한다.
- 첫 로딩: motion-kit·bundle-budget은 devDependency라 앱 JS 0 B. seen-store는 다시 측정한다.

**단계 C. 설정 패키지 · 재사용 워크플로 · 템플릿 — 새 서비스를 시작할 때**

- 새 서비스 하나를 실제로 만들면서 필요한 만큼만 추출한다. 기존 두 앱 이전은 선택이다.

**하지 않는 것:** 앱 저장소 합치기, 랜드마크 pnpm 이전(공개 npm을 쓰면 필요 없다), 프레임워크 UI 공통화.

### 6.11 위험과 대응

| 위험 | 대응 |
| --- | --- |
| 수정 한 번에 PR이 여러 개 생김 | 안정된 코드만 넣는다(6.3). tarball·snapshot으로 확인 시간을 줄인다 |
| 공용 버그가 모든 서비스로 퍼짐 | 정확 버전 고정. 앱별 갱신 PR이 CI를 통과해야 반영된다 |
| npm 계정 탈취·공급망 공격 | npm 2FA, trusted publishing(장기 토큰 없음), provenance |
| 공개 패키지에 비밀값 노출 | 6.3-6 규칙, 키는 앱이 주입 |
| 관리할 저장소가 하나 늘어남 | 릴리스 자동화(Changesets)와 Dependabot 묶음 PR로 손일을 줄인다 |
| 첫 로딩 예산 초과 | 브라우저 패키지 규칙(6.3-5), 각 앱 CI의 크기 검사 |

### 6.12 이 안에서 사용자가 정할 것

| 질문 | 선택지 | 추천 |
| --- | --- | --- |
| 별도 공용 저장소로 갈까? | 별도 저장소 / 1~5절의 복사 방식 유지 | **별도 저장소**(서비스가 계속 늘어난다는 전제) |
| 저장소 이름은? | `kit` / `shared` / `common` / 기타 | 짧고 범용인 이름. 결정 필요 |
| npm 계정·scope는? | 개인 계정 `sch0718` / 다른 이름 / npm 조직 | 계정 존재 여부를 먼저 확인. 있으면 `@sch0718` |
| 공개 여부는? | 공개 npm / 비공개(유료·토큰) | **공개 npm** |
| 라이선스는? | MIT / PolyForm-NC | **MIT** |
| 가즈아의 카카오 모듈은? | 공용 패키지 발행 후 설치 / 일단 복사했다가 교체 | **결정됨(2026-10-27): 패키지 발행 후 설치.** 랜드마크 적용은 지금 계획대로 진행 |
| 설정 패키지·재사용 워크플로를 기존 두 앱에도 적용할까? | 새 서비스부터 / 지금 모두 | **새 서비스부터** |
| 랜드마크를 pnpm으로 옮길까? | 옮기지 않음 / 옮김 | **옮기지 않음**. 공개 npm이면 필요 없다 |

## 작성 과정

- **작성일:** 2026-10-27. 랜드마크 브랜치 `docs/shared-code-proposal`(기준 `origin/main` `cbe2d42`).
- **초안:** Codex CLI `codex-cli 0.164.0-alpha.11.1`, 모델 `gpt-6.1-sol`, `model_reasoning_effort=high`, `-s workspace-write`. 조사 범위와 이미 확인한 사실을 프롬프트로 주었다. Codex는 가즈아 경로를 쓰기 범위 밖에서 읽을 수 있었다(사전 확인). 가즈아는 `origin/main` `83fff70`과 `origin/chore/license-polyform-nc` `1684858`을 `git show`·`ls-tree`·`grep`으로만 읽었다. 가즈아 작업 트리는 수정하거나 체크아웃하지 않았다.
- **Claude 검수(Claude Opus 5.5):** 인용 경로가 실제로 있는지 확인했다. 줄 수와 그림 생성기 diff는 `wc -l`·`diff -u`로 다시 셌다. Codex가 difflib으로 센 그림 생성기 +/− 값을 `diff -u` 값으로 바꾸고 측정 방법 설명을 보탰다. 라이선스 확인 출처를 "사용자 제공"에서 이 세션의 `gh repo view` 결과로 고쳤다. Cloudflare Pages v3 빌드 이미지의 기본 Yarn 4.9.1 사실을 추가했다. 큰 판단(추천·단계)은 고치지 않았다.
- **공식 문서 재확인(Claude, 2026-10-27):** [Cloudflare Pages Build image](https://developers.cloudflare.com/pages/configuration/build-image/)(lockfile·engines 감지 안 함, v3 기본 버전), [pnpm 10.26 릴리스](https://pnpm.io/blog/releases/10.26)(git 의존성 `prepare` 기본 차단). 나머지 출처 URL은 Codex가 본문에 적었고 Claude는 다시 확인하지 않았다.
- **확인 못 한 항목:** 위 5절 끝 목록과 같다. 특히 카카오 모듈 실제 코드(다른 세션이 작업 중이고 아직 원격 브랜치 없음), 오늘 기준 두 앱의 첫 로딩 실측, Cloudflare 계정의 실제 빌드 설정, 각 공유 방식의 설치 실험, 가즈아 로컬 `origin/main`과 GitHub 최신 main의 일치 여부가 남아 있다. 이번 세션은 빌드·테스트·설치를 실행하지 않았다.
- **6절 추가(2026-10-27, Claude Opus 5.5):** 사용자 요청 "앞으로 새로운 서비스를 계속 만들 예정이야. 공통으로 사용하는 코드들을 한 곳에서 관리하고 싶어"에 따라 별도 공용 저장소 안을 덧붙였다. Codex를 거치지 않고 Claude가 썼다. 다시 확인한 공식 문서: [npm Trusted publishing](https://docs.npmjs.com/trusted-publishers), [GitHub Reusing workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows), [Changesets snapshot releases](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md)(모두 2026-10-27). 확인하지 못한 것: npm 계정 `sch0718`이 있는지(npmjs.com 사용자 페이지 403, 레지스트리 검색 `maintainer:sch0718` 0건), trusted publishing 설정 전에 첫 버전을 직접 발행해야 하는지, Yarn 1의 git 의존성으로 저장소 하위 폴더를 지정할 수 있는지, npm 조직의 공개 패키지 비용. 확인된 사실이 아닌 서술(작업량 등)은 본문에서 "추정"이나 "확인 필요"로 표시했다.
