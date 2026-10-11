# 랜드마크 설계 — 장소 추가 (하위 프로젝트 2)

- 작성일: 2026-10-12
- 상태: 초안 (사용자 검토 대기)
- 관련 문서: `2026-10-08-place-library-design.md`(하위 프로젝트 1, §1.3 사용 방식·§2.1 하위 프로젝트 목록). 이 문서는 그 문서의 하위 프로젝트 2를 구체화한다. 충돌하면 이 문서가 우선한다.

## 1. 배경과 목표

### 1.1 목표

지금 보관함에 장소를 넣는 길은 "옛 여행 가져오기"뿐이다. 사용자가 평소에 장소를 모을 수 있게 세 가지 추가 방법을 만든다.

1. **링크 붙여넣기**: 네이버·카카오·구글 지도의 장소 링크
2. **네이버 공유 폴더 가져오기**
3. **지도에서 핀 찍기**

앱 안 장소 검색은 하지 않는다(하위 프로젝트 1의 결정).

### 1.2 사용자 결정 (2026-10-11~12)

| 항목 | 결정 |
|---|---|
| 받는 링크 | 네이버 지도 앱 공유(`naver.me`), 네이버 지도 웹 주소, **카카오맵**, **구글 지도** 링크 모두 |
| 핀 주소 | 기본은 네이버 지도 SDK 주소 변환(Reverse Geocoding)으로 자동 채우고, 사람이 고칠 수 있게. 실패하면 빈칸에서 직접 입력 |
| 링크를 붙여 넣은 뒤 | **확인하고 추가**: 카드에서 이름·주소·분류를 확인하고 라벨·메모를 넣은 뒤 추가 |
| 폴더 가져오기 라벨 | **폴더 이름을 라벨로**(같은 이름 라벨이 있으면 재사용, 미리보기에서 이름 변경·기존 라벨 선택 가능) |
| 서버 방식 | **장소 해석을 서버에서 끝낸다**: Cloudflare Pages Functions 두 개가 링크를 풀고 정규화한 결과를 돌려준다 |
| 호스팅 | Cloudflare Pages 프로젝트 `landmark`(`https://landmark-c5f.pages.dev`, 저장소 `sch0718/landmark` `main` 연결) |

### 1.3 확인된 사실 (2026-10-11~12)

Cloudflare 미리보기 배포에 시험 함수를 올려 확인했다(서울 데이터센터 ICN, 한국 IP). 시험 코드는 지웠다.

| 대상 | 결과 |
|---|---|
| 네이버 장소 조회 `map.naver.com/p/api/place/summary/<id>` (`Accept-Language: ko-KR`) | 200. `data.placeDetail`에 `id`·`name`·`coordinate{longitude,latitude}`·분류 |
| 네이버 공유 폴더 `pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/<shareId>/bookmarks?start=0&limit=…` | 200. `folder.name`, `bookmarkList[]`(이름·주소·`px`/`py`·`sid`·메모) |
| `naver.me/Fk73Vab5` (장소) | 307 → `https://map.naver.com/p/entry/place/1958911015?placePath=%2Fhome` |
| `naver.me/xjYaIYfe` (폴더) | 307 → `https://map.naver.com/p/favorite/sharedPlace/folder/<shareId>` |
| 네이버 웹 주소 `map.naver.com/p/entry/place/1540168051?c=…&placePath=…` | 주소에서 ID를 바로 얻는다(조회 결과 "콤포트") |
| `kko.to/MWuG8x8eN4` | 301 → `https://applink.map.kakao.com/place?id=16990385` |
| 카카오 `place-api.map.kakao.com/places/panel3/<id>` (`pf: web`, `Referer: https://place.map.kakao.com/`) | 200. `summary.name`, `summary.address.disp`(도로명)·`jibun`, `summary.point{lon,lat}`(WGS84), `summary.category.name` |
| 카카오 `place.map.kakao.com/main/v/<id>` | 403 "Restricted User Agent" — 쓰지 않는다 |
| `maps.app.goo.gl/SsZWtW1xgZVgijxK6` (User-Agent를 브라우저가 아닌 값으로) | 302 → `https://www.google.com/maps/place/<이름>/data=…!1s0x…:0x…!…!20s<Plus Code>…`. 이름(이재모피자 본점), 장소 ID(`0x1520f8eed52456f1:0x129df2a4704f8520`), Plus Code(`8Q7F422J+R6X`). **좌표·주소 값은 없다** |
| 네이버 지도 JS SDK `naver.maps.Service.reverseGeocode` (geocoder 하위 모듈, 등록 도메인에서) | NCP 콘솔에서 Reverse Geocoding을 켠 뒤 200. 예: (37.5494047, 126.9833092) → "서울특별시 용산구 후암동 두텁바위로60길 45" |
| 네이버 지도 웹의 비공식 주소 변환 경로 | 찾지 못함(404·캡차) — 쓰지 않는다 |

카카오·구글·네이버 조회는 모두 공식 API가 아닌 공개 웹 주소다. 바뀌면 막힐 수 있으므로 실패 시 핀 추가로 이어지게 한다(§5).

## 2. 화면 흐름

### 2.1 ＋추가 시트

- **링크 붙여넣기**와 **네이버 폴더 가져오기**는 같은 입력 창을 연다. 장소 링크인지 폴더 링크인지는 서버 해석 결과로 정한다. 폴더 항목으로 열면 안내 문구만 "네이버 공유 폴더 링크를 붙여 넣어 주세요"로 바뀐다.
- **지도에서 핀 찍기**는 지도를 핀 모드로 바꾼다.
- 휴대폰: 입력 창·확인 카드·미리보기는 아래에서 올라오는 시트(미리보기는 거의 전체 높이). PC: 오른쪽 상세 칸 자리에 열어 지도를 가리지 않는다.

### 2.2 링크 → 확인 카드

1. 입력 창에 링크를 넣고 **확인**(비어 있거나 `http(s)://` 링크가 아니면 비활성). 조회 중에는 "장소를 찾는 중…"과 함께 버튼을 막는다.
2. 확인 카드: 출처 표시(네이버·카카오·구글), 이름, 주소, 분류. 지도는 그 좌표로 이동(줌 16)하고 임시 핀을 보인다. **라벨**(기존 라벨 여러 개 선택, 새 라벨 바로 만들기 — 기존 `LabelPicker` 재사용), **메모** 입력, **추가** / **취소**.
3. 같은 출처 ID의 살아 있는 장소가 있으면 카드 위에 "이미 있는 장소예요. 고른 라벨만 더할게요", 버튼은 **라벨 더하기**(§3.4).
4. 구글 결과에 주소가 없으면 카드를 열 때 네이버 주소 변환으로 주소 칸을 채운다(실패하면 빈칸). 확인 카드의 주소 칸은 고칠 수 있다.
5. 추가하면 그 장소의 상세(`/place/:id`)를 열고 "추가했어요" 토스트.

### 2.3 폴더 링크 → 미리보기

1. 머리글: 폴더 이름 · 장소 수.
2. **붙일 라벨**: 기본값은 폴더 이름. 이름을 고치거나 기존 라벨을 고를 수 있다. 30자를 넘으면 "라벨 이름은 30자까지예요"로 막는다.
3. 목록: 모두 체크된 상태로 시작, 줄마다 이름·주소, 이미 있는 장소는 "이미 있음". 위에 전체 선택·해제.
4. **N곳 가져오기**(선택 0곳이면 비활성) → 토스트는 세 문장 중 하나: 둘 다 1 이상 "<새 수>곳을 새로 넣고, <합친 수>곳은 라벨만 더했어요", 합친 것이 0 "<새 수>곳을 새로 넣었어요", 새것이 0 "<합친 수>곳은 라벨만 더했어요".
5. 1,000곳을 넘는 폴더는 "장소가 너무 많은 폴더예요(최대 1,000곳)"로 막는다.

### 2.4 지도에서 핀 찍기

1. 지도 가운데 조준점 + 상단 안내 "지도를 움직여 위치를 맞추세요" + **여기에 추가** / **취소**.
2. **여기에 추가** → 입력 카드: **이름**(필수, 1자 이상), **주소**(네이버 주소 변환으로 자동 채움, 고칠 수 있음, 실패 시 빈칸과 안내 "주소를 찾지 못했어요. 직접 입력해 주세요"), 라벨, 메모, **추가** / **취소**.
3. 핀 모드는 **취소**·뒤로 가기·Esc로 끝난다.
4. 링크 조회 실패 화면의 **지도에서 핀으로 추가**는 알고 있는 이름을 채운 채 핀 모드로 들어간다(위치를 알면 그 좌표에서 시작).

### 2.5 넣지 않는 것

앱 안 검색, 여러 링크 한꺼번에, 네이버 비공개 저장 목록, 저장 뒤 주소 수정, 다른 서비스로 넣은 같은 가게 찾기, 카카오·구글의 메모·사진 가져오기.

## 3. 데이터

### 3.1 장소 출처 (`PlaceSource`)

| 종류 | 필드 | 중복 규칙(살아 있는 장소 기준) |
|---|---|---|
| `naver` | `sid`(숫자 문자열) | 같은 `sid`는 하나 (기존) |
| `kakao` (새로) | `kakaoId`(숫자 문자열) | 같은 `kakaoId`는 하나 |
| `google` (새로) | `googleId`(`0x[0-9a-f]+:0x[0-9a-f]+`) | 같은 `googleId`는 하나 |
| `pin` | `legacy?` (기존) | 옛 키가 있는 것만 하나 (기존). 직접 찍은 핀은 판단하지 않는다 |

- `schemaVersion`은 2 그대로다. 출처 종류만 늘어난다. 스키마 불변식 검사에 카카오·구글 중복 거부를 더한다.
- 서비스가 다르면 같은 가게여도 다른 장소로 저장한다.

### 3.2 새 장소 값

- 이름: 링크 결과 / 핀은 사용자 입력. 주소: 링크 결과(구글은 네이버 주소 변환 값) / 핀은 변환 값이나 사용자가 고친 값. 좌표: 링크·핀. 분류: 서비스 분류 / 핀은 `null`. 라벨·메모: 카드·미리보기에서.
- 주소는 지금 모델에서 수정 기록이 없는 값이라 **추가 전 카드에서만** 고친다.

### 3.3 도메인 연산 (`src/domain/library/ops.ts`에 추가)

- `addPlace(lib, candidate, { labelIds, memo }, ctx)` → `{ lib, placeId, outcome: 'created' | 'merged' | 'restored' }`
- `importFolder(lib, items, { labelId } | { newLabelName }, ctx)` → 성공 시 라벨 id와 `{ created, merged, restored }`(잠금 안 최신본 기준으로 연산이 직접 센 값). 화면의 결과 토스트는 이 값을 쓴다(되살린 것은 새로 넣은 수에 더한다).

후보(`PlaceCandidate`): `{ source: PlaceSource, name, address, lng, lat, category: string | null }`.

### 3.4 이미 있는 장소

| 경우 | 라벨 | 메모 | 이름·주소·분류 |
|---|---|---|---|
| 링크로 다시 추가 | 고른 라벨을 더한다 | 새 메모가 있으면 기존 메모 뒤에 줄바꿈 후 덧붙인다(10,000자 제한, 넘으면 생략 표시) | 바꾸지 않는다 |
| 폴더에서 다시 | 폴더 라벨을 더한다 | 바꾸지 않는다 | 바꾸지 않는다 |
| 같은 ID의 지운 장소 | **되살리고** 위 규칙을 적용한다 | 위와 같다 | 위와 같다 |

### 3.5 폴더 가져오기 라벨·메모

- 라벨: 정규형(`normalizeLabelName`)이 같은 살아 있는 라벨이 있으면 그것을, 없으면 새로 만든다. 색은 아직 안 쓴 색을 `LABEL_COLORS` 순서로, 모두 쓰였으면 처음부터.
- 메모: 네이버 메모가 있으면 넣는다. 10,000자를 넘으면 `truncateMemo`(옛 가져오기와 같은 규칙).

### 3.6 저장

모든 추가는 `LibraryStore.update` 한 번(잠금 → 최신본 다시 읽기 → 연산 → 검증 → 저장)이다. 폴더 가져오기도 한 번에 저장하고, 실패하면 아무것도 바뀌지 않는다. 중복 판단은 연산 안에서 최신본 기준으로 다시 하므로 다른 탭과 동시에 넣어도 중복이 생기지 않는다.

## 4. 서버 함수

### 4.1 구성

- `functions/api/place.ts`, `functions/api/naver-folder.ts`(Cloudflare Pages Functions 파일 라우팅). 서비스별 해석은 `src/server/`에 두고 함수·테스트가 함께 쓴다. 공유 폴더 해석은 `pipeline/naver-client.ts`를 재사용하거나 그 해석 부분을 `src/server/`로 옮긴다.
- 서버는 아무것도 저장하지 않고 요청 내용을 기록하지 않는다.

| 함수 | 입력 | 성공 응답 |
|---|---|---|
| `GET /api/place` | `url` | 장소: `{ kind: 'place', provider: 'naver'\|'kakao'\|'google', providerId, name, address, lng, lat, category }` (구글은 `address: ''`, 구글만 `providerId`가 `null`일 수 있음) / 폴더: `{ kind: 'folder', shareId }` |
| `GET /api/naver-folder` | `share` | `{ folderName, places: [{ sid, name, address, lng, lat, memo }] }` |

실패: HTTP 4xx/5xx + `{ error: { code, message, reason?, placeName? } }`(`reason: 'no-location'`일 때만 `placeName`). `code`는 `UNSUPPORTED_LINK`(400), `NOT_FOUND`(404), `UPSTREAM_ERROR`(502), `TIMEOUT`(504), `TOO_MANY_PLACES`(413, 폴더 1,000곳 초과), `FORBIDDEN_ORIGIN`(403).

### 4.2 링크 해석

| 링크 | 처리 |
|---|---|
| `naver.me/*` | 이동을 따라가 아래 형식으로 |
| `map.naver.com/p/entry/place/<id>`, `map.naver.com/p/search/*/place/<id>`, `m.place.naver.com/<종류>/<id>`, `pcmap.place.naver.com/<종류>/<id>` | 네이버 장소 조회 |
| `map.naver.com/p/favorite/sharedPlace/folder/<shareId>` | 폴더 |
| `kko.to/*`, `place.map.kakao.com/<id>`, `applink.map.kakao.com/place?id=<id>`, `map.kakao.com/?itemId=<id>` | 카카오 panel3 조회 |
| `maps.app.goo.gl/*`, `goo.gl/maps/*`, `www.google.com/maps/place/*`, `maps.google.com/*` | 주소에서 이름(`/place/<이름>/`), 장소 ID(`!1s0x…:0x…`), 좌표: `!3d<위도>!4d<경도>` 또는 `@<위도>,<경도>`가 있으면 그것, 없으면 `!20s<Plus Code>`를 Open Location Code 규칙으로 계산. 둘 다 없으면 `NOT_FOUND`(사유 `no-location`과 링크의 장소 이름 `placeName`을 함께 돌려줘 앱이 이름을 채워 핀 모드로 간다). 장소 ID(`!1s…`)가 없고 좌표만 있으면 `providerId: null`로 돌려주고, 앱은 출처를 직접 찍은 핀(`pin`)으로 저장한다(중복 판단 없음) |

- 쿼리·해시의 부가 옵션은 무시한다. 이동은 `redirect: 'manual'`로 최대 3번까지 따라가고, 매번 허용 목록 검사를 다시 한다.
- 구글 짧은 링크는 브라우저가 아닌 User-Agent로 요청한다(브라우저 UA는 302 대신 HTML을 준다).
- 바깥 요청마다 8초 시한.

### 4.3 보안

- **접속 대상 고정**: §4.2 표의 호스트와 조회 API 호스트(`map.naver.com`, `pages.map.naver.com`, `place-api.map.kakao.com`)만 접속한다. 허용 밖이면 `UNSUPPORTED_LINK`.
- **요청 출처 확인**: `Origin`(없으면 `Referer`)이 `https://landmark-c5f.pages.dev`, `https://*.landmark-c5f.pages.dev`, `http://localhost:5173`, `http://localhost:8788` 중 하나가 아니면 `FORBIDDEN_ORIGIN`. 브라우저 밖 악용을 완전히 막지는 못한다.
- **캐시**: Cloudflare Cache API에 장소 결과 1일, 폴더 10분. 키는 입력에서만 만들어 조회·저장에 같은 키를 쓴다: 네트워크 없이 ID를 알 수 있는 링크(네이버 웹 주소·카카오 장소 주소)는 서비스·ID, 짧은 링크·구글은 쿼리·해시를 뺀 링크, 폴더는 공유 ID. 오류는 캐시하지 않는다.

### 4.4 앱 쪽

- Effect 서비스 `PlaceLookup`(`src/services/place-lookup.ts`): `lookupLink(url): Effect<PlaceResult | FolderRef, PlaceLookupError>`, `lookupFolder(shareId): Effect<FolderResult, PlaceLookupError>`. `PlaceLookupError`는 서버 `code`와 `OFFLINE`(연결 실패)을 담고 `userMessage`를 준다(§5).
- 주소 변환: `NaverMapAdapter`가 쓰는 SDK 로더에 geocoder 하위 모듈을 함께 불러 `ReverseGeocoder` 서비스(`reverse(lng, lat): Effect<string | null>`)로 감싼다. 결과는 도로명 우선, 없으면 지번.

### 4.5 개발 환경

- `wrangler`(devDependency, 정확한 버전 고정)로 함수와 Vite 개발 서버를 함께 띄우는 스크립트(`dev:full`)를 둔다. `yarn dev`만 띄우면 링크 추가는 `OFFLINE` 안내가 나온다.
- 함수 코드는 `tsconfig`·ESLint 대상에 넣는다.

## 5. 오류 문구

| 상황 | 문구 | 다음 행동 |
|---|---|---|
| 링크 아님/빈칸 | 링크를 붙여 넣어 주세요 | 확인 비활성 |
| `UNSUPPORTED_LINK` | 네이버·카카오·구글 지도의 장소 링크만 넣을 수 있어요 | 입력 유지 |
| `NOT_FOUND` | 장소를 찾지 못했어요. 링크를 다시 확인해 주세요 | 입력 유지 |
| `NOT_FOUND`(구글 위치 없음) | 위치를 알 수 없는 링크예요. 지도에서 위치를 맞춰 주세요 | 이름을 채워 핀 모드 |
| `UPSTREAM_ERROR`·`TIMEOUT` | 지금은 장소 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요 | 다시 시도, 지도에서 핀으로 추가 |
| `OFFLINE` | 인터넷 연결을 확인하고 다시 시도해 주세요 | 다시 시도 |
| `TOO_MANY_PLACES` | 장소가 너무 많은 폴더예요(최대 1,000곳) | 막음 |
| `FORBIDDEN_ORIGIN` | 지금은 장소 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요 | (개발 설정 오류이므로 콘솔에 원인 기록) |
| 주소 변환 실패 | 주소를 찾지 못했어요. 직접 입력해 주세요 | 빈칸 저장 가능 |
| 저장 실패 | 기존 저장 오류 문구(`userMessage`) | 카드 유지, 입력 보존 |

조회·저장 중에는 버튼을 막아 두 번 추가되지 않게 하고, 카드를 닫았다 다시 열면 지난 요청 결과가 끼어들지 않게 한다.

## 6. 테스트

- **서버 해석(단위)**: 녹화한 실제 응답 fixture로 링크 종류별 해석, 이동 따라가기·3번 제한, 허용 밖 거부(이동 중 바뀌는 경우 포함), Plus Code → 좌표(Open Location Code 공식 예제 값으로 검증), 오류 코드, 출처 확인, 캐시 키.
- **데이터(단위)**: 카카오·구글 출처 저장·중복 거부, 다시 추가(라벨 합치기·메모 덧붙이기·10,000자), 지운 장소 되살리기, 폴더 가져오기(라벨 재사용·생성·색, 이미 있는 장소, 메모 자르기, 한 번에 저장), 동시 추가 중복 없음.
- **화면(단위)**: 입력 창(판별·오류 문구·다시 시도), 확인 카드(라벨·메모, 이미 있는 장소, 구글 주소 채우기, 두 번 클릭), 폴더 미리보기(선택·해제, 라벨 이름, 30자, 결과 토스트, 1,000곳), 핀 모드(조준점, 주소 자동 채움·실패, 이름 필수, 취소).
- **E2E(desktop·iphone·galaxy)**: `/api`를 가로채 녹화 응답으로 — 링크 추가 → 목록·지도에 나타남, 폴더 가져오기 → 라벨로 거르면 그 장소만, 핀 추가. 지도는 가짜 어댑터.
- **배포 확인(직접)**: 미리보기 배포에서 사용자 예시 링크 네 개(`naver.me/Fk73Vab5`, 네이버 웹 주소, `kko.to/MWuG8x8eN4`, `maps.app.goo.gl/SsZWtW1xgZVgijxK6`)와 공유 폴더 하나로 실제 추가 결과를 보고한다.
