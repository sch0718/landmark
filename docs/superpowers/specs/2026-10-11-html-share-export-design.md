# trip-map 설계 — 장소를 HTML 파일 하나로 내보내기

- 작성일: 2026-10-11
- 상태: r3 (구현 계획 작성)
- 개정: 2026-10-11 r3 — 계획 작성 중 정리. 틀은 `public/share-viewer.html`로 빌드하고 앱이 내보낼 때 `fetch`로 받는다(생성 파일을 `?raw`로 import하면 파일이 없을 때 런타임을 import하는 모든 모듈의 변환이 실패한다). `init` 메시지는 라벨 색 이름만 보내고 지도 페이지가 파스텔 토큰을 직접 번들한다.
- 개정: 2026-10-11 r2 — PR #21 리뷰 반영. 데이터 삽입 이스케이프 규칙을 바로잡고(§4.1), 지도를 `file://` 안의 OSM 직접 요청에서 GitHub Pages(`sch0718/landmark`)에 올린 지도 페이지를 iframe으로 띄우는 방식으로 바꿨다(§2.4, §4.5, §4.6). `file://` 문서는 Referer를 보내지 않아 OSM 공용 타일 정책(유효한 Referer 요구)을 지킬 수 없기 때문이다.
- 관련 문서: `2026-10-08-place-library-design.md`(하위 프로젝트 1). 이 기능은 하위 프로젝트 4(공유)의 일부를 먼저 만드는 것이다. 4번의 "가져오기·병합"은 이 문서 범위가 아니다.

## 1. 배경과 목표

### 1.1 사용자 요청 (2026-10-11)

앱에 저장한 장소를 HTML 파일 하나로 내보내 다른 사람에게 보낸다. 첫 데이터는 다른 세션에서 찾은 정자역 카페로 만든다.

### 1.2 사용자 결정

| 항목 | 결정 |
|---|---|
| 받는 사람이 하는 일 | **보기만**(A). 앱으로 가져오기(B)는 나중에 |
| 지도 | **OpenStreetMap 지도 + 카드마다 네이버 지도 링크**(C). 지도는 GitHub Pages에 올린 지도 페이지를 파일 안 iframe으로 띄운다(r2, D) |
| 지도 페이지 위치 | **공개 저장소 `sch0718/landmark`를 지도용으로 쓴다.** 기존 Java 코드는 `backup/java-gradle-2025` 브랜치로 옮겼다(2026-10-11) |
| 내보낼 범위 | **선택한 장소가 있으면 그것만, 없으면 지금 보이는 목록**(C). 누르기 전에 "N곳" 확인 |
| 카페 데이터 넣기 | **기존 "옛 여행 가져오기"로 넣는다**(A). 앱 코드 변경 없음 |
| 만드는 방식 | **보기 화면을 미리 빌드한 HTML 틀에 데이터만 끼워 넣는다**(1) |

### 1.3 전제

- 받는 사람은 앱 설치·로그인 없이 메신저 등으로 받은 파일을 휴대폰·PC에서 바로 연다.
- 네이버 지도 JS는 등록한 도메인에서만 인증되므로 `file://`로 연 파일에서는 쓸 수 없다. 그래서 지도는 OpenStreetMap(Leaflet)이다.
- OSM 공용 타일 서버(`tile.openstreetmap.org`)는 웹 페이지의 요청에 유효한 Referer를 요구하고, 식별되지 않거나 꾸민 요청은 예고 없이 막을 수 있다([타일 이용 정책 §3.1·§3.4](https://operations.osmfoundation.org/policies/tiles/)). `file://` 문서는 Referer를 보내지 않고, 페이지 스크립트는 Referer를 바꿀 수 없다. 그래서 타일을 요청하는 문서를 실제 웹 페이지(`https://sch0718.github.io/landmark/`)로 두고, 내보낸 파일은 그 페이지를 iframe으로 띄운다. 브라우저가 그 페이지 주소를 Referer로 스스로 붙인다.

### 1.4 성공 기준

1. 보관함에서 라벨로 거르거나 장소를 골라 "내보내기"를 누르면 HTML 파일 하나가 저장된다(휴대폰에서는 공유 창으로 바로 보낼 수 있다).
2. 그 파일을 휴대폰·PC 브라우저에서 열면 목록과 지도가 보이고, 카드에서 네이버 지도로 넘어갈 수 있다. 파일 자체는 외부 스크립트를 불러오지 않는다(지도는 iframe 안의 지도 페이지가 그린다).
3. 인터넷이 없거나 지도 페이지가 응답하지 않으면 지도 영역에 안내가 나오고, 목록과 링크는 그대로 쓸 수 있다.
6. 지도 타일 요청은 OSM 타일 정책을 지킨다(지도 페이지의 실제 주소가 Referer로 붙고, 출처 표시가 보인다).
4. 장소 이름·메모에 어떤 문자열이 있어도 파일 안에서 스크립트로 실행되지 않는다.
5. 정자역 카페 5곳으로 만든 실제 파일을 사용자에게 전달한다.

## 2. 받는 사람이 보는 화면 (보기 화면)

### 2.1 머리글

- 제목: 내보낼 때 정한 값(§3.2).
- 부제: `2026.10.11 · 5곳`(만든 날짜·장소 수).
- 라벨 칩: 담긴 라벨이 2개 이상일 때만 한 줄. 누르면 그 라벨로 목록과 지도를 거른다(하나만 고르는 토글, "모두"가 기본). 보기용이며 저장하지 않는다.

### 2.2 배치

- 768px 미만: 위쪽 지도(화면 높이의 약 40%), 아래 스크롤되는 장소 목록.
- 768px 이상: 왼쪽 목록(360px), 오른쪽 지도.

### 2.3 장소 카드

- 이름, 라벨 칩(라벨 색), 주소.
- 메모: 줄바꿈을 살린 일반 텍스트(`white-space: pre-wrap`). 링크 자동 변환 없음.
- "네이버 지도에서 보기" 링크(새 탭):
  - `naverSid`가 있으면 `https://map.naver.com/p/entry/place/<sid>`
  - 없으면 `https://map.naver.com/p/search/<encodeURIComponent(이름 + ' ' + 주소)>`(주소가 비면 이름만)
- 카드를 누르면 지도가 그 장소로 이동하고(줌 16) 그 마커를 강조한다. 링크를 누를 때는 카드 동작을 하지 않는다.

### 2.4 지도

지도 영역은 지도 페이지(§4.5)를 띄운 iframe이다. 파일과 지도 페이지는 `postMessage`로만 주고받는다.

- 처음 열 때 모든 장소가 보이게 맞춘다(장소가 1곳이면 그 장소에 줌 16).
- 마커: 장소 이름이 적힌 라벨 색 알약(앱 마커와 같은 모양, Leaflet `divIcon`). 라벨이 없으면 표면색. 강조된 마커는 테두리를 굵게 하고 맨 위로 올린다.
- 마커를 누르면 해당 카드를 강조하고 목록에서 그 카드로 스크롤한다.
- 라벨 칩으로 거르면 지도에도 걸러진 장소만 보인다(다시 맞추지는 않는다).
- 클러스터 없음.
- 지도 타일: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, 오른쪽 아래 출처 표시 `© OpenStreetMap contributors`(링크 `https://www.openstreetmap.org/copyright`).
- 지도를 못 쓰는 경우 지도 영역에 "지도를 불러오지 못했어요. 목록과 네이버 지도 링크는 그대로 쓸 수 있어요"를 보인다(iframe을 감추고 파일 쪽에서 표시). 판단 기준:
  - iframe을 만든 뒤 10초 안에 지도 페이지의 `ready`가 오지 않음(오프라인, 지도 페이지 장애·주소 변경).
  - 지도 페이지가 `tiles-failed`를 보냄: 처음 맞춘 화면의 타일이 하나도 로드되지 않고 `tileerror`만 난 경우(첫 `tileload`가 오면 보내지 않는다).

### 2.5 모양

- 기본 테마(파스텔) 토큰(`src/theme/tokens/pastel`)으로 CSS 변수를 만들고, `prefers-color-scheme`에 따라 라이트·다크를 바꾼다. 라벨 색도 같은 토큰에서 온다.
- 맨 아래: "trip-map에서 만든 파일".
- 폰트는 시스템 폰트(파일 크기를 위해 웹폰트를 넣지 않는다).

### 2.6 오류

- 데이터 블록이 없거나 형식이 맞지 않으면(§4.1 검사 실패) 화면 가운데 "파일 내용을 읽지 못했어요"를 보이고 아무것도 그리지 않는다.

### 2.7 넣지 않는 것

검색, 편집, 경로·이동시간, 앱으로 가져오기, 클러스터, 웹폰트.

## 3. 앱에서 내보내는 흐름

### 3.1 진입점

- 보관함 목록 위 도구줄(정렬 메뉴 옆)의 "내보내기" 아이콘 버튼.
- 장소를 골랐을 때 나오는 일괄 편집 바(`BulkBar`)의 "내보내기" 버튼.
- 둘 다 같은 내보내기 창을 연다.

### 3.2 내보내기 창

- 대상 문구:
  - 고른 장소가 있으면 "선택한 N곳을 내보냅니다".
  - 없으면 "지금 보이는 N곳을 내보냅니다". 라벨 필터가 있으면 `(라벨: 정자역 카페)`, 검색어가 있으면 `(검색: 카페)`를 덧붙인다.
- 제목 입력(필수, 앞뒤 공백 제거 후 1~60자). 기본값:
  - 라벨 필터가 정확히 1개면 그 라벨 이름
  - 아니면 "장소 N곳"
- "메모 포함" 체크(기본 켬).
- 버튼:
  - **파일 저장**: `<제목>-YYYYMMDD.html`로 내려받는다(§4.3 파일 이름 규칙).
  - **공유**: `navigator.canShare({ files: [file] })`가 참일 때만 보인다. `navigator.share({ files, title })`로 시스템 공유 창을 연다.
- 0곳이면 두 버튼을 비활성으로 하고 "내보낼 장소가 없어요"를 보인다. 도구줄 버튼은 0곳이어도 누를 수 있다(창에서 이유를 보여 준다).

### 3.3 담기는 것

- 내보낼 장소: 고른 장소(지운 장소 제외) 또는 지금 목록에 보이는 장소, 목록과 같은 순서.
- 장소마다: id, 이름, 주소, 경도·위도, 살아 있는 라벨 id(대표 라벨 순서 유지), 메모("메모 포함"일 때만, 빈 메모는 생략), 네이버 장소 ID(`source.kind === 'naver'`일 때).
- 라벨: 담긴 장소에 붙은 살아 있는 라벨만, id·이름·색·순서.
- 담지 않는 것: 다른 장소, 지운 장소·라벨, 필드별 수정 시각, 분류(category), 여행.

### 3.4 오류

- 틀을 불러오지 못함(오프라인으로 동적 청크 로드 실패 등): 창 안에 "내보내기 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요"를 보이고 버튼은 다시 누를 수 있다.
- 공유 취소(`AbortError`): 아무 메시지 없이 창 유지.
- 공유 실패(그 외 오류): "공유하지 못했어요. 파일 저장을 이용해 주세요".
- 파일 저장·공유가 끝나면 창을 닫고 "파일을 만들었어요" 토스트를 띄운다.

## 4. 구조

### 4.1 파일 안 데이터 형식 (`ShareDoc` v1)

HTML 안의 데이터 블록 하나:

```html
<script type="application/json" id="tripmap-share">…</script>
```

```jsonc
{
  "format": "tripmap-share",
  "version": 1,
  "title": "정자역 카페",
  "createdAt": "2026-10-11T05:00:00.000Z",
  "labels": [{ "id": "label001", "name": "정자역 카페", "color": "yellow", "order": 0 }],
  "places": [
    {
      "id": "abc123def4",
      "name": "서혜커피",
      "address": "경기 성남시 분당구 …",
      "lng": 127.11,
      "lat": 37.36,
      "labelIds": ["label001"],
      "memo": "…",        // 선택
      "naverSid": "123"   // 선택
    }
  ]
}
```

- 앱: `src/schema/share.ts`의 Effect Schema(`ShareDocSchema`)로 만든 값을 검증한 뒤 파일에 쓴다. 검증 실패는 버그이므로 `ErrorReporter`로 보고하고 §3.4의 "만들지 못했어요"를 보인다.
- 보기 화면: Effect를 번들하지 않는다. 같은 타입(`import type`)에 맞춘 직접 짠 검사 함수(`parseShareDoc(unknown): ShareDoc | null`)를 쓴다. `format`·`version`이 다르거나 필수 필드 타입이 틀리면 `null`.
- 데이터는 틀의 `__TRIPMAP_DATA__` 자리 한 곳에만 넣는다. `JSON.stringify` 결과에서 다음 세 문자를 JSON 유니코드 이스케이프(백슬래시 + `u` + 16진수 4자리, 6글자)로 바꾼다: `<`(U+003C) → `\u003c`, LINE SEPARATOR(U+2028) → `\u2028`, PARAGRAPH SEPARATOR(U+2029) → `\u2029`. JSON으로는 같은 값이라 `JSON.parse` 결과는 바뀌지 않고, 결과 문자열에는 `<`가 하나도 남지 않으므로 `</script>`·`<!--`가 데이터 블록을 닫거나 바꿀 수 없다. 페이지 `<title>`은 보기 화면이 데이터의 제목으로 정한다. 따라서 사용자 문자열은 데이터 블록 밖 HTML에 들어가지 않는다.
- 보기 화면은 데이터를 `textContent`·속성 값으로만 넣는다(`innerHTML` 금지). 링크 `href`는 §2.3의 고정 접두사 + 인코딩한 값만 쓴다.

### 4.2 코드 배치

| 위치 | 역할 |
|---|---|
| `src/share-viewer/index.html` | 보기 화면 틀. 데이터 블록 자리 `__TRIPMAP_DATA__` 포함 |
| `src/share-viewer/main.ts` | 진입점: 데이터 읽기 → 화면 그리기 → 지도 iframe 연결 |
| `src/share-viewer/parse.ts` | `parseShareDoc` |
| `src/share-viewer/render.ts` | 머리글·라벨 칩·카드 DOM, 거르기·강조 상태 |
| `src/share-viewer/map-frame.ts` | 지도 iframe 만들기, 메시지 보내기·받기(§4.5), 10초 `ready` 시한, 실패 안내 |
| `src/share-viewer/styles.css` | 레이아웃·토큰 CSS 변수 |
| `vite.viewer.config.ts` | 보기 화면 빌드. 직접 짠 작은 플러그인이 JS·CSS를 HTML 안에 넣어 파일 하나로 만든다. 지도 페이지 주소는 빌드 변수 `VITE_SHARE_MAP_URL`(기본 `https://sch0718.github.io/landmark/`) |
| `src/share-map/index.html`, `main.ts`, `map.ts`, `styles.css` | 지도 페이지(GitHub Pages에 배포). Leaflet 지도, 마커, 타일 실패 판단, 메시지 처리 |
| `src/share-protocol.ts` | 파일 ↔ 지도 페이지 메시지 타입과 검사 함수(양쪽이 함께 쓴다) |
| `vite.map.config.ts` | 지도 페이지 빌드(`dist-map/`, 상대 경로 `base: './'`) |
| `public/share-viewer.html` | 빌드 결과(gitignore). 앱 배포에 함께 실린다 |
| `src/schema/share.ts` | `ShareDocSchema`, `ShareDoc` 타입 |
| `src/domain/share/build-share.ts` | `buildShareDoc(library, placeIds, { title, includeMemo, now })` 순수 함수 |
| `src/domain/share/inject.ts` | `injectShareDoc(template, doc)`, `shareFileName(title, now)` |
| `src/services/share-template.ts` | `ShareTemplate` 서비스(`Context.Service`): `load: Effect<string, ShareTemplateError>`. 실제 레이어는 `fetch(import.meta.env.BASE_URL + 'share-viewer.html')`로 받아 세션 동안 캐시한다(실패는 캐시하지 않는다). 테스트는 가짜 레이어 |
| `src/sections/share-export/ExportHtmlDialog.tsx` | 내보내기 창 |
| `src/sections/share-export/use-export-targets.ts` | 선택/보이는 목록 → 내보낼 장소 id와 대상 문구 |

- 기존 `src/sections/share`(옛 여행 공유, 4번 참고용)와는 분리한다.
- 새 의존성: `leaflet`(1.9.4, 정확히 고정), `@types/leaflet`(dev). Leaflet은 지도 페이지에만 들어가고 내보낸 파일에는 들어가지 않는다.

### 4.3 파일 이름 규칙

`shareFileName(title, now)`:
- 제목에서 `\ / : * ? " < > |`와 제어 문자를 `-`로, 공백 연속을 `-` 하나로 바꾸고 앞뒤 `-`·`.`을 지운다. 연속된 `-`는 하나로 줄인다.
- 결과가 비면 `trip-map`.
- 40자(코드 포인트)로 자른 뒤 `-YYYYMMDD.html`을 붙인다(로컬 날짜).
- 예: `정자역 카페` → `정자역-카페-20261011.html`.

### 4.4 빌드

- `build:viewer` 스크립트: `vite build --config vite.viewer.config.ts`.
- `dev`, `build`, `build:ci`, `test:e2e`, `test:e2e:ci`는 `build:viewer`를 먼저 실행한다.
- 타입 검사·단위 테스트는 생성 파일이 없어도 돈다(앱은 틀을 import하지 않고 런타임에 받는다, 테스트는 가짜 `ShareTemplate`).
- 보기 화면은 생성 HTML 하나에 JS·CSS가 모두 들어간다. 파일이 직접 하는 외부 요청은 지도 iframe(지도 페이지)과 사용자가 누른 링크뿐이다.
- `build:map` 스크립트: `vite build --config vite.map.config.ts`. 결과 `dist-map/`(gitignore)은 §4.6으로 배포한다. `build:ci`에 포함해 CI에서 깨지지 않는지 확인한다.

### 4.5 지도 페이지와 메시지 규약

지도 페이지 주소: `https://sch0718.github.io/landmark/`(빌드 변수 `VITE_SHARE_MAP_URL`로 바꿀 수 있다. e2e는 로컬 서버 주소를 쓴다).

**메시지 (`src/share-protocol.ts`, v1)** — 모든 메시지는 `{ source: 'tripmap-share', v: 1, kind, ... }` 모양이다.

| 방향 | `kind` | 내용 |
|---|---|---|
| 지도 → 파일 | `ready` | 지도 페이지가 메시지를 받을 준비가 됨. 지원하는 최고 버전 `maxV` 포함 |
| 파일 → 지도 | `init` | `places`(id·이름·경도·위도·첫 라벨의 색 이름 또는 `null`). 색 값과 라이트/다크는 지도 페이지가 번들한 파스텔 토큰과 `prefers-color-scheme`로 정한다 |
| 파일 → 지도 | `focus` | `placeId` 또는 `null`: 그 장소로 이동(줌 16)·강조, `null`은 강조 해제 |
| 파일 → 지도 | `filter` | `placeIds`: 보일 장소 id 목록 |
| 지도 → 파일 | `select` | `placeId`: 마커를 누름 |
| 지도 → 파일 | `tiles-failed` | 처음 화면 타일이 전부 실패함 |

- 지도 페이지에는 메모·주소·네이버 ID를 보내지 않는다. 마커에 필요한 것만 보낸다. 메시지는 받는 사람의 브라우저 안에서만 오가고 어떤 서버로도 가지 않는다. 다만 파일을 열면 GitHub Pages(지도 페이지)와 OSM 타일 서버가 받는 사람의 IP와 보는 지도 범위를 알 수 있다.
- **파일 쪽 검사**: `event.source === iframe.contentWindow`이고 `event.origin`이 지도 페이지 주소의 출처(`new URL(VITE_SHARE_MAP_URL).origin`)와 같은 메시지만 받는다. 보낼 때 `targetOrigin`도 그 출처로 지정한다.
- **지도 페이지 쪽 검사**: `event.source === window.parent`인 메시지만 받는다. 파일은 `file://`이라 출처가 `"null"`이므로 출처로는 거르지 않고, 내용을 `share-protocol`의 검사 함수로 확인한다(모양이 틀리면 무시). 보낼 때 `targetOrigin`은 `'*'`이다(받는 쪽 출처가 `"null"`이라 지정할 수 없다). 지도 페이지가 보내는 내용은 장소 id와 상태뿐이라 다른 곳에 새도 문제가 없다.
- 지도 페이지도 데이터를 DOM 텍스트로만 넣는다(마커 이름은 `textContent`).
- 지도 페이지는 Referer를 막는 `Referrer-Policy`를 두지 않는다(브라우저 기본 `strict-origin-when-cross-origin`으로 `https://sch0718.github.io/`가 붙는다).
- 지도 페이지를 iframe 없이 직접 열면 "trip-map에서 내보낸 파일 안에서 쓰는 지도예요" 안내만 보인다.
- **하위 호환**: 이미 보낸 파일이 계속 열려야 하므로 지도 페이지는 v1 메시지를 계속 받는다. 바꿀 때는 필드를 더하는 방식으로만 바꾸고, 깨지는 변경은 `v`를 올리고 옛 버전도 함께 처리한다.

### 4.6 지도 페이지 배포 (`sch0718/landmark`)

- `landmark`의 기존 Java 코드는 `backup/java-gradle-2025` 브랜치로 보존했다(2026-10-11, 커밋 `18ad6f0`).
- `landmark`의 `main`은 지도 페이지 빌드 결과(`index.html`, `assets/`), `.nojekyll`, 용도를 적은 `README.md`만 둔다. GitHub Pages는 `main`의 루트에서 배포한다.
- 자동 배포: trip-map의 GitHub Actions 워크플로(`deploy-share-map.yml`)가 `main`에 `src/share-map/**`, `src/share-protocol.ts`, `src/theme/tokens/**`, `vite.map.config.ts`가 바뀌어 들어올 때 `build:map`을 돌리고 `dist-map/`을 `landmark`의 `main`에 커밋·푸시한다. 수동 실행(`workflow_dispatch`)도 둔다.
- 인증: `landmark`에 쓰기 권한 배포 키(공개 키)를 등록하고, 개인 키는 trip-map 저장소 Secret `LANDMARK_DEPLOY_KEY`에 둔다.
- 처음 한 번 하는 일(구현 단계에서): `landmark` `main`을 README만 있는 상태로 바꾸기, Pages 켜기, 배포 키 만들기·등록, 첫 배포 후 지도 페이지 주소 확인.
- 지도 페이지가 바뀌어 배포되면 이미 보낸 파일도 새 지도 페이지를 쓴다(§4.5 하위 호환).

## 5. 카페 데이터 넣기 (준비 작업, 앱 코드 아님)

- 정자역 카페 5곳(서혜커피, 로스팅하우스 허깅 분당점, 카페 담, 오리지날, 카페 스프링)의 주소·좌표를 찾아 옛 여행 형식(`src/schema/legacy/trip-data.ts`) JSON으로 만든다.
- 폴더 1개 "정자역 카페" → 가져오면 라벨이 된다.
- 메모: 추천 이유, 정자역에서 걸리는 시간, 일요일 영업시간. 오리지날·카페 스프링은 "일요일 정기휴무"를 적는다. 정보 출처·확인 날짜를 함께 적는다.
- 대화 내용 등 그 세션의 개인적인 정보는 넣지 않는다.
- 이 JSON은 앱 저장소에 커밋하지 않는다(스크래치 위치에서 만들고 가져오기에만 쓴다).
- 설정 → 옛 여행 가져오기로 넣고, "정자역 카페" 라벨로 걸러 내보낸 HTML을 사용자에게 전달한다.

## 6. 테스트

### 6.1 단위

- `buildShareDoc`: 고른 장소/보이는 목록 순서 유지, 지운 장소·라벨 제외, 쓰인 라벨만 포함, "메모 포함" 끔 → 메모 없음, 빈 메모 생략, 네이버 장소의 `naverSid`, 결과가 `ShareDocSchema`를 통과.
- `injectShareDoc`: 이름·메모에 `</script><script>window.__injected = 1</script>`, `<!--`, U+2028/2029가 있을 때 (1) 데이터 블록 안 문자열에 `<`(U+003C)가 하나도 없고, (2) jsdom으로 파싱한 문서의 `script` 요소 수가 틀과 같고 `window.__injected`가 정의되지 않으며, (3) 데이터 블록을 `JSON.parse`하면 원래 값과 같다.
- `shareFileName`: 금지 문자, 빈 제목, 긴 제목, 날짜.
- `parseShareDoc`: 정상, `format`/`version` 불일치, 필드 타입 오류.
- 보기 화면 `render`(jsdom, 지도 iframe 모듈은 가짜): 카드·라벨 칩, 라벨 1개면 칩 줄 없음, 라벨 거르기(→ `filter` 메시지), 네이버 링크(sid 유무), 카드 클릭 → `focus` 메시지, `select` 메시지 → 카드 강조·스크롤, 깨진 데이터 안내, 메모 `pre-wrap`·HTML 미해석.
- 보기 화면 `map-frame`: `ready` → `init` 전송(메모·주소 없음), 10초 안에 `ready` 없으면 안내(가짜 타이머), `tiles-failed` → 안내, 다른 출처·다른 `source` 창의 메시지 무시, `targetOrigin`이 지도 페이지 출처.
- `share-protocol` 검사 함수: 정상 메시지, 모르는 `kind`, `v` 불일치, 필드 타입 오류.
- 지도 페이지(jsdom + Leaflet): `init`으로 마커 생성, `focus`·`filter` 처리, 마커 클릭 → `select` 전송, 부모가 아닌 창의 메시지 무시, 타일 실패만 나면 `tiles-failed`, 첫 `tileload` 뒤에는 보내지 않음(Leaflet 이벤트를 직접 발생시켜 확인), 직접 열었을 때 안내.
- `ExportHtmlDialog`: 대상 문구(선택/보이는 목록/라벨·검색 표기), 제목 기본값, 0곳 비활성, 틀 로드 실패 안내와 다시 시도, 공유 버튼 표시 여부(`canShare` 스텁), 공유 취소 무시, 저장 시 다운로드 호출과 파일 이름.

### 6.2 E2E (Playwright)

- 지도 페이지를 로컬 서버(`vite preview --config vite.map.config.ts`)로 띄우고, 보기 화면은 `VITE_SHARE_MAP_URL`을 그 주소로 해서 빌드한다.
- 앱에 샘플 보관함을 넣고 라벨로 거른 뒤 내보내기 → 다운로드 파일을 받아 `file://`로 연다. 지도 타일 요청은 가로채 빈 이미지를 돌려주고, 그 요청에 Referer(지도 페이지 출처)가 붙었는지 확인한다.
- 확인: 카드 수, iframe 안 마커 수, 마커 클릭 → 카드 강조, 카드 클릭 → 마커 강조, 라벨 거르기 → 마커 수, 네이버 링크 `href`, 파일이 직접 불러오는 외부 스크립트 없음.
- 지도 페이지 서버를 띄우지 않은 채 열면 10초 뒤 안내가 나오고 목록은 그대로인지 확인.
- 휴대폰 크기(375×812)에서도 같은 확인.

### 6.3 크기

- 생성된 틀(데이터 제외)이 50KB를 넘으면 실패하는 테스트(`build:viewer` 결과 파일 대상, e2e 단계에서 검사).

### 6.4 배포 확인

- 첫 배포 뒤 `https://sch0718.github.io/landmark/`를 직접 열어 안내 문구가 나오는지, 실제 내보낸 파일에서 지도가 뜨는지 확인한다.

### 6.5 직접 확인

정자역 카페 5곳을 가져와 내보내고, 결과 HTML을 인앱 브라우저에서 PC 크기와 휴대폰 크기로 열어 확인한 뒤 사용자에게 파일을 전달한다.

## 7. 범위 밖 (나중에)

- 받는 사람의 앱으로 가져오기(B) — 파일 안 `ShareDoc`을 그대로 읽어 4번에서 병합과 함께 만든다.
- 파일 안에서 편집(C), 경로·이동시간 표시, 검색, 클러스터.
