# 카카오톡 공유

카카오 JavaScript SDK의 피드 공유를 감싸는 공용 모듈입니다. React·Effect·Vite와 런타임 의존성이 없으며 웹 표준 API만 씁니다. 모듈을 가져오는 시점에는 DOM이나 전역을 건드리지 않습니다.

## API

- `KakaoShareConfig`: 호출자가 `appKey`(JavaScript 키)를 주입합니다. `sdkUrl`, `integrity`, `maxLinkLength`를 바꿀 수 있습니다.
- `KakaoCard`: `title`, `url`과 선택적인 `description`, `imageUrl`, `imageWidth`, `imageHeight`, `buttonTitle`을 받습니다. 이미지 주소도 호출자가 주입합니다.
- `kakaoLinkFits(url, config)`: 키가 있고 링크가 한도 이내인지 동기로 검사합니다.
- `preloadKakao(config)`: SDK 스크립트를 한 번 받아 초기화합니다. 기존 `window.Kakao.Share`나 같은 주소의 스크립트를 재사용합니다. 실패·15초 시간 초과 시 다음 호출에서 다시 시도하며, 브라우저 밖이나 빈 키는 거절합니다. 초기화된 SDK는 다시 초기화하지 않습니다. 한 페이지에서는 한 앱의 키를 씁니다.
- `kakaoReady()`: SDK가 초기화됐는지 동기로 확인합니다.
- `sendKakao(card, config)`: 동기로 `Share.sendDefault`를 호출합니다. 준비 전·링크 한도 초과·SDK 예외는 `false`, 호출 성공은 `true`입니다. 메시지 전달 완료를 확인하는 콜백은 없습니다.
- `shareOrCopy(url, title, { share?, copy? })`: 공유를 먼저 시도하고 실패하면 복사합니다. 결과는 `shared`, `copied`, `cancelled`, `failed`입니다. `AbortError`는 취소로 끝내며 복사하지 않습니다. 브라우저 메서드는 호출자가 감싸거나 바인딩해 넘깁니다. 알림과 대체 정책은 앱에서 정합니다.

기본 상수는 `KAKAO_SDK_URL`(2.8.4), `KAKAO_SDK_INTEGRITY`, `KAKAO_LINK_MAX`(2,000자)입니다. 다른 SDK 주소를 쓰면 그 버전의 integrity도 함께 넘겨야 합니다.

SDK는 공유 단추를 보일 때 미리 받습니다. 준비된 뒤 클릭 처리 안에서 `sendKakao`를 동기로 호출해야 PC 팝업 차단을 피할 수 있습니다. 링크를 비동기로 만든다면 준비 완료 뒤 새 단추 클릭에서 호출합니다. 모바일 메시지 JSON 한도를 고려해 링크 기본 한도를 2,000자로 제한합니다.

카드 이미지는 외부에서 접근할 수 있는 절대 URL(200×200px 이상·5MB 이하)을 넘깁니다. 제목과 설명은 최대 두 줄이며 단추 문구는 8자 이하를 권장합니다.

## 공용 저장소로 옮길 때

이 폴더의 구현과 시험을 `sch0718/sch0718-toolkit-web`의 `packages/kakao-share`로 옮겨 `@sch0718/kakao-share`로 내보낼 수 있습니다. 구현은 의존성 0을 유지하고 환경변수·키·이미지 주소는 앱에서 주입합니다. 시험에만 Vitest와 jsdom이 필요합니다. TypeScript 5.9와 ESM을 기준으로 하며 enum·namespace·parameter property는 쓰지 않습니다. 가져오기 경로 별칭이나 폴더 밖 앱 파일을 추가하지 않습니다.

## 카카오 콘솔 설정

카카오 개발자 콘솔에서 앱을 만들고 JavaScript 키를 발급합니다. JavaScript SDK 도메인에 앱 출처를 등록하고, 제품 링크 관리 › 웹 도메인에도 카드 링크의 도메인을 등록합니다. 허용 도메인과 다른 링크는 보낼 수 없습니다. 키 값은 이 폴더에 넣지 않습니다.

확인일: **2026-10-27**. [카카오톡 공유 JavaScript 문서](https://developers.kakao.com/docs/latest/ko/kakaotalk-share/js).
