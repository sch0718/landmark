# trip-map v2 설계 — 장소 보관함 (하위 프로젝트 1)

- 작성일: 2026-10-08
- 상태: 초안 (사용자 검토 대기)
- 선행 문서: `2026-10-03-trip-map-design.md`(PoC, r5). 이 문서와 충돌하는 결정은 이 문서가 우선한다(§2.3).

## 1. 배경과 목표

### 1.1 사용자가 정한 목표 (2026-10-08)

1. 데스크톱과 모바일(갤럭시·아이폰) 모두에서 쓰기 편하다.
2. 디자인이 모던하고 깔끔하다. 아이콘이 촌스럽지 않다.
3. 평소 맛집·가 보고 싶은 곳을 테마(라벨)로 저장하고 메모한다.
4. 라벨별로 나눠 본다. 한 장소에 라벨 여러 개를 붙인다.
5. 여행 일정을 짤 때 쓴다. 여러 장소를 방문 순서대로 놓으면 경로와 예상 이동 시간이 보인다.
6. 구글·네이버 지도와 너무 비슷하지 않다. 익숙한 사용성은 가져오되 디자인이나 기능에 차별성이 있다.

### 1.2 컨셉

**평소에 모으고(보관함), 여행 때 꺼내 쓰는(계획) 한 흐름.** 여행을 만들면 지역·라벨로 보관함에서 후보를 추려 주고("강릉에 저장한 맛집 12 · 카페 5"), 일정에 놓으면 경로와 시간이 바로 계산된다. 지도 앱은 "지금 여기서 찾기"가 중심이고, 이 앱은 "모아 둔 것으로 계획하기"가 중심이다.

### 1.3 사용 방식 (사용자 결정)

| 항목 | 결정 |
|---|---|
| 사용자 | 나 + 동행자(여행 단위 공동 계획) |
| 원본 저장소 | **각 기기 브라우저의 localStorage.** 서버 DB 없음 |
| 공유 | 내보내기/가져오기(파일·링크) + 병합 |
| 구글 드라이브 | 선택 기능. 구글 로그인은 **드라이브 연동에만** 쓴다. 드라이브에 저장하고 드라이브 파일에서 가져온다. 동행자에게 파일을 공유하는 일은 사용자가 드라이브에서 직접 하고, 동행자는 구글 Picker로 그 파일을 골라 가져온다(`drive.file` 범위) |
| 장소 추가 | 링크 붙여넣기, 네이버 공유 폴더 가져오기, 지도에서 핀 찍기. **앱 안 검색은 하지 않는다** |
| 이동수단 | 자동차 + 도보. 구간별로 고를 수 있고, 기본값은 거리로 정한다 |
| 서버 | Cloudflare Pages Functions **무상태 프록시**(네이버 API 중계만, 저장하지 않음) |

### 1.4 확인된 사실 (2026-10-08, 맥에서 curl로 확인)

| 대상 | 결과 |
|---|---|
| 도보 경로 `map.naver.com/p/api/directions/walk?l=<경도>,<위도>;<경도>,<위도>&st=1&o=all&lang=ko` | 200. `routes[0].summary`에 `distance`(m)·`duration`(초로 보임: 704m에 676). 단위는 2번 하위 프로젝트에서 다시 확인 |
| 자동차 경로 `directions/car`에 `Origin` 헤더 | 200 |
| 장소 조회 `map.naver.com/p/api/place/summary/<sid>` | `Accept-Language: ko-KR` 헤더가 있으면 200(이름·좌표·분류), 없으면 429 |
| 공유 폴더 `pages.map.naver.com/.../shares/<shareId>/bookmarks` | 200 (기존과 같음) |
| `naver.me` 장소 공유 링크 → 장소 ID | **확인 못 함**(예시 링크 없음). 2번에서 실제 링크로 확인 |
| Cloudflare 서버 IP에서 위 API 호출 | **확인 못 함**. 2번에서 배포 후 확인. 막히면 그 기능은 직선거리로 대체 |
| Cloudflare 무료 플랜 | Workers·Pages Functions 합산 하루 10만 요청, 요청당 CPU 10ms(대기 시간 제외) — [공식 문서](https://developers.cloudflare.com/workers/platform/limits/) |
| `effect` npm | 4.0.0이 2026-10-01 정식 출시, 최신 4.0.2(2026-10-07) |

## 2. 전체 구성

### 2.1 하위 프로젝트 (순서대로, 각각 스펙 → 계획 → 구현 → 검증)

| # | 이름 | 내용 |
|---|---|---|
| **1** | **기반 + 보관함 (이 문서)** | Effect 기반 구조, 새 데이터 모델, 라벨(복수)·메모, 라벨별 보기, 디자인 시스템(테마 3종), 데스크톱·모바일 뼈대, 옛 여행 가져오기 |
| 2 | 장소 추가 | Pages Functions 프록시, 링크 붙여넣기, 네이버 폴더 가져오기, 지도에서 핀 찍기 |
| 3 | 여행 계획 | 지역·라벨 후보 추리기, Day 배치·순서, 자동차·도보 경로와 시간 즉시 계산 |
| 4 | 공유 | 여행 단위·전체 백업 내보내기/가져오기와 병합, 구글 드라이브 저장·가져오기 |
| 5 | 다듬기 | 실물 갤럭시·아이폰 점검, 디자인 QA, 성능 |

2~5번의 세부 설계는 각자의 스펙에서 정한다. 이 문서의 데이터 모델은 2~4번이 확장할 수 있게 잡는다.

### 2.2 아키텍처 접근

**로컬 우선 "내 문서" 모델로 전환한다.** 빌드 타임에 만든 읽기 전용 여행 JSON + 편집 레이어 구조를 버리고, 사용자가 소유·편집하는 문서 하나(`Library`)를 브라우저에 둔다. 빌드 타임 파이프라인(`yarn collect`, `apply-edit`)은 역할을 다하고 정리 대상이 된다(§9).

### 2.3 PoC 설계에서 바뀌는 결정

| PoC 결정 | v2 |
|---|---|
| 데이터는 빌드 타임 수집, 앱은 완전 정적 | 앱에서 직접 편집. 네이버 조회는 무상태 프록시(2번) |
| 여행 단위 TripData + EditLayer | 보관함 + 여행을 담은 `Library` 문서 하나 |
| Zod | **Effect 4 `effect/Schema`**. Zod 제거 |
| Effect 제외 | **Effect 중심 구조**(§6) |
| MDI 아이콘 | **Lucide**(선 아이콘) |
| 테마별 카테고리 정의는 범위 밖 | 사용자 라벨(이름·색·아이콘) |

## 3. 데이터 모델

`src/schema/library.ts`에 Effect Schema로 정의한다. `schemaVersion: 2`.

```
Library
  schemaVersion: 2
  places: Record<PlaceId, Place>
  labels: Record<LabelId, Label>
  trips:  Record<TripId, Trip>          # 3번에서 정의. 1번에서는 빈 객체만 허용

Place
  id         PlaceId (무작위 영숫자 소문자 10자)
  source     { kind: 'naver', sid } | { kind: 'pin' }
  name       Field<string>
  address    string                    # 원본 값. 편집 대상 아님
  lng, lat   number                    # 한국 범위(경도 124–132, 위도 33–39)
  category   Field<string | null>      # 네이버 대분류 또는 사용자 수정
  labelIds   Field<LabelId[]>          # 0개 = 미분류. 순서 있음(첫 번째가 대표 색)
  memo       Field<string>             # 빈 문자열 = 메모 없음. 최대 2000자
  saved      Field<boolean>            # false = 여행에서만 쓰는 장소(보관함 목록에서 숨김)
  createdAt  IsoDateTime
  deletedAt  IsoDateTime | null        # 묘비

Label
  id         LabelId (무작위 영숫자 소문자 8자)
  name       Field<string>             # 1–30자, 보관함 안에서 대소문자·공백 무시 중복 금지
  color      Field<LabelColor>         # 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink'
  icon       Field<LabelIcon>          # Lucide 아이콘 이름 중 허용 목록(§5.4)
  order      Field<number>
  createdAt  IsoDateTime
  deletedAt  IsoDateTime | null

Field<T> = { value: T, updatedAt: IsoDateTime }
```

**규칙**

- **필드 단위 최신값 우선(LWW).** 병합(4번)은 필드마다 `updatedAt`이 큰 쪽을 고른다. 같으면 값의 정렬 순서로 결정해 순서 무관성을 지킨다. 이 비교 함수는 1번에서 만들고 테스트한다(병합 UI는 4번).
- **삭제는 묘비.** `deletedAt`이 있으면 화면에서 숨긴다. 묘비는 30일이 지나면 정리하되, 정리 시점은 4번에서 병합 규칙과 함께 확정한다(1번에서는 정리하지 않는다).
- **네이버 장소 중복 금지.** 같은 `sid`의 살아 있는 장소는 하나뿐이다. 같은 sid를 다시 추가하면(2번) 기존 장소에 라벨만 합친다. 스키마 검증에서 중복을 거부한다.
- **라벨 삭제**는 라벨 묘비 + 모든 장소의 `labelIds`에서 제거(그 필드의 `updatedAt` 갱신)한다. 장소는 남는다.
- **라벨 병합**(A → B): A가 붙은 장소에 B를 붙이고(이미 있으면 그대로), A를 삭제한다.
- **지역**은 저장하지 않고 `address`에서 계산한다(§4.2).
- **경로 캐시**는 문서에 넣지 않는다(3번, 별도 키).
- **UI 선호**(테마, 보기 방식, 정렬, 필터)는 문서 밖 `tripmap:prefs`에 기기별로 저장하고 내보내지 않는다.

**저장 키**

| 키 | 내용 |
|---|---|
| `tripmap:library:v2` | `Library` JSON |
| `tripmap:library:v2:corrupt-<ISO>` | 검증 실패한 원본 백업 |
| `tripmap:prefs` | UI 선호 |
| `tripmap:edit:<publicId>` | PoC 편집 레이어. 옛 여행 가져오기에서 읽기만 한다 |

용량 기준: 장소 1,000곳 ≈ 0.5MB(메모 평균 100자 가정). localStorage 한도(약 5MB) 안이다.

## 4. 화면과 동작

### 4.1 뼈대

| 폭 | 구성 |
|---|---|
| ≥ 1280px | 왼쪽 레일(내비게이션) · 목록 · 지도 · 상세 **3단** |
| 768–1279px | 레일 · 목록 · 지도. 상세는 지도 위 오른쪽 패널로 겹침 |
| < 768px | 하단 탭 5개: 보관함 · 지도 · **＋추가** · 여행 · 설정. 상세는 전체 화면 시트 |

- ＋추가는 링크 붙여넣기 / 지도에서 핀 찍기 / 네이버 폴더 가져오기 시트를 연다. 1번에서는 시트만 있고 항목은 "곧 제공" 상태로 비활성(2번에서 구현).
- 여행 탭은 1번에서 "준비 중" 화면.
- 하단 탭과 시트는 iOS 홈 인디케이터와 안드로이드 제스처 영역을 피한다(`env(safe-area-inset-bottom)`). 터치 대상은 최소 44×44px.

### 4.2 보관함

- **라벨 칩 필터**: 여러 개 선택. 기본 "하나라도"(OR), 토글로 "모두"(AND). `미분류` 칩은 라벨 0개인 장소. 칩마다 개수 표시.
- **지역 묶음**: 주소의 시·군(특별·광역시는 구까지 내려가지 않고 시 단위)을 뽑아 칩으로 제공한다. 예: "강릉 31 · 속초 12 · 제주 40". 주소 형식이 맞지 않으면 "기타".
- **검색**: 이름·주소·메모·라벨 이름. 한글 초성 검색은 하지 않는다(YAGNI).
- **정렬**: 최근 저장순(기본) · 이름순 · 라벨순.
- **보기 방식 4종**(설정·목록 상단에서 전환, 기기별 저장):
  - 벤토(기본): 라벨이 크기가 다른 블록. 블록을 누르면 그 라벨로 거른 목록.
  - 카드: 장소마다 메모와 라벨이 보이는 카드.
  - 타일: 라벨 2열 타일, 누르면 목록.
  - 간단 목록: 한 줄 행, 많이 훑을 때.
- 목록이 길어지면 기존 `@tanstack/react-virtual` 가상화를 쓴다.
- **일괄 편집**: 데스크톱 Shift/Cmd+클릭, 모바일 길게 누르기로 선택 모드. 선택한 장소에 라벨 붙이기·떼기·삭제.

### 4.3 장소 상세

- 이름(편집 가능), 주소, 분류(편집 가능), "네이버 지도에서 열기"(sid가 있을 때), "길찾기"(네이버 지도 앱 길찾기 링크).
- 라벨: 칩으로 켜고 끈다. 입력란에 이름을 치면 같은 이름이 없을 때 새 라벨을 만들어 붙인다.
- 메모: 여러 줄. 입력 후 600ms 쉬면 저장하고 "저장됨"을 작게 표시한다. 다른 화면으로 나가면 즉시 저장한다.
- 삭제: 묘비 처리 + 5초 "되돌리기" 토스트.
- `/place/:id`로 직접 열 수 있다(모바일 뒤로 가기와 맞물림).

### 4.4 라벨 관리 (`/labels`)

이름 · 색(8색) · 아이콘(허용 목록) · 순서(드래그, dnd-kit) · 병합 · 삭제. 삭제와 병합은 확인 대화상자에서 영향받는 장소 수를 보여 준다.

### 4.5 지도

- 기존 `MapAdapter`(네이버·가짜)를 쓴다. 마커 색은 첫 라벨의 색, 라벨이 없으면 중립색.
- 지도는 목록과 같은 필터를 공유한다. 마커를 누르면 목록이 그 장소로 스크롤되고 상세가 열린다. 목록에서 고르면 지도가 그 장소로 이동한다.
- 클러스터는 기존 supercluster 구현을 유지한다.

### 4.6 옛 여행 가져오기

1번에는 장소 추가(2번)가 없으므로, 기존 데이터로 보관함을 채우는 경로를 둔다.

- 입력: PoC `TripData` JSON 파일, 또는 `/t/:publicId` 링크(배포된 `public/data/<id>.json`이 있으면 그것을 읽음). 같은 브라우저에 `tripmap:edit:<publicId>`가 있으면 함께 읽는다.
- 변환: 장소 → `Place`(`source.kind`는 sid가 있으면 `naver`, custom 장소는 `pin`). 폴더 이름 → 라벨. 편집 레이어 태그 → 라벨. 편집 레이어 분류 → `category`. 네이버 메모와 편집 레이어 메모 → `memo`(여러 개면 줄바꿈으로 이어 붙이고 출처를 앞에 적는다).
- 미리보기 화면에서 "새로 추가 N · 이미 있음 M(라벨만 합침)"을 보여 주고 확인 후 적용한다. 가져온 장소는 `saved: true`.
- 일정(`days`)은 1번에서 가져오지 않는다(3번에서 여행 모델이 생긴 뒤 다시 가져올 수 있게 원본 파일 재사용).

### 4.7 설정 (`/settings`)

테마(파스텔·수첩·나이트) · 모드(시스템·라이트·다크) · 보관함 보기 방식 · 옛 여행 가져오기 · 데이터 정보(장소·라벨 수, 사용 용량). 테마는 미리보기 카드를 눌러 고른다.

## 5. 디자인 시스템

### 5.1 테마

같은 토큰 이름에 테마·모드별 값을 둔다. `src/theme/tokens/{pastel,paper,night}.ts`가 `{ light, dark }`를 내보내고, 이 값으로 MUI 테마와 CSS 변수(`--tm-*`)를 함께 만든다.

| 테마 | 인상 | 글꼴 |
|---|---|---|
| 파스텔(기본) | 흰 바탕, 파스텔 블록, 검정·라임 포인트, 굵은 산세리프 | Pretendard |
| 수첩 | 종이색 바탕, 벽돌·숲·바다색 잉크, 도장 같은 라벨 | 제목 고운바탕, 본문 Pretendard |
| 나이트 | 깊은 남색, 반투명 유리 카드, 빛나는 라벨 색 | Pretendard |

토큰: 배경(바탕·표면·올린 표면), 글자(주·보조·약함), 경계, 포인트, 라벨 8색 × (채움·글자·마커), 모서리(sm·md·lg·xl), 그림자(1·2), 간격 4px 배수.

### 5.2 구글·네이버와 다르게 보이는 지점

- 첫 화면이 지도가 아니라 **라벨 벤토**다.
- 초록(네이버)·파랑(구글) 포인트를 쓰지 않는다. 파스텔은 검정·라임, 수첩은 벽돌색, 나이트는 보라→하늘 그라데이션.
- 메모가 카드의 주인공이다(카드 보기에서 메모를 이름 바로 아래 크게).
- 지역 묶음 칩("강릉 31")이 늘 보인다(여행 계획 흐름의 입구).

### 5.3 글꼴

Pretendard·고운바탕을 `@fontsource` 계열 패키지나 자체 호스팅 woff2로 넣는다(외부 CDN 의존 없음). 한글 부분 집합 파일을 쓰고, 수첩 테마를 고를 때만 고운바탕을 불러온다.

### 5.4 아이콘

`@iconify-json/lucide` + 기존 `unplugin-icons` 컴파일 방식. 라벨 아이콘 허용 목록(약 30개): utensils, soup, coffee, croissant, beer, wine, ice-cream-cone, fish, beef, salad, waves, mountain, trees, tent, camera, landmark, castle, church, shopping-bag, store, bed, hotel, car, train-front, footprints, baby, dog, music, palette, star, heart, flag. 이름은 Lucide 1.x 기준이며 계획 단계에서 실제 존재 여부를 확인한다.

## 6. Effect 4 구조

`rule_system_fe` PR #1017(Effect v4 마이그레이션)의 **패턴만** 참고하고 파일은 복사하지 않는다(회사 코드).

### 6.1 런타임과 서비스

- `src/lib/effect/runtime.ts`: `ManagedRuntime.make(AppLayer)`. `startEffect(effect)`는 최상위 실행(Promise), `forkEffect(effect)`는 백그라운드 실행이며 처리되지 않은 실패를 `ErrorReporter`로 보고한다.
- `src/lib/effect/error-reporter.ts`: 보고 대상은 `console.error` + sonner 토스트(사용자에게 보일 메시지가 있는 태그 오류만). Sentry·OpenTelemetry는 쓰지 않는다.
- `src/lib/effect/atom.ts`: Jotai ↔ Effect 연결(`effectAtom`). 비동기 상태는 Jotai의 Suspense·ErrorBoundary 흐름을 따른다.
- `AppLayer`(1번):

| 서비스 | 역할 | 테스트 구현 |
|---|---|---|
| `LibraryStore` | 읽기(검증·손상 백업), 쓰기(Web Locks 직렬화, 크기 검사), 다른 탭 변경 구독(`storage` 이벤트 → `Stream`) | 메모리 |
| `PrefsStore` | UI 선호 읽기·쓰기 | 메모리 |
| `IdGen` | 무작위 ID | 고정 순서 |
| `Clock` | Effect 기본 `Clock` 사용 | `TestClock` |
| `LegacyTripSource` | 옛 여행 JSON fetch + 옛 편집 레이어 읽기 | 고정 응답 |

2~4번에서 `NaverProxy`, `Routing`, `Drive`를 같은 방식으로 추가한다.

### 6.2 Schema

- `src/schema/`의 4개 파일(공통·편집 레이어·여행 데이터·여행 원본)을 `effect/Schema`로 옮기고 `zod` 의존성을 없앤다. 파이프라인(`pipeline/`)도 같은 스키마를 쓰므로 함께 옮긴다.
- 관계 검증(`superRefine`에 해당)은 `Schema.filter`/`check`로 옮기고, 오류 메시지 문구는 유지한다(기존 테스트가 문구를 검사한다).
- v1 → v2 변환은 `Schema.decodeTo`/변환 스키마로 선언하고, 변환 결과를 v2 스키마로 다시 검증한다.

### 6.3 오류

`Schema.TaggedError`(또는 `Data.TaggedError`)로 정의한다.

| 태그 | 상황 | 화면 |
|---|---|---|
| `StorageUnavailable` | localStorage 사용 불가 | 메모리 저장 + "새로고침하면 사라져요" 배너 |
| `StorageQuotaExceeded` | 쓰기 용량 초과 | 토스트, 메모리 상태 유지 |
| `LibraryCorrupt` | 저장 문서 검증 실패 | 원본을 `corrupt-<ISO>` 키에 백업 → "데이터를 읽지 못했어요 · 백업 파일 받기 · 새로 시작" 화면. 조용히 덮어쓰지 않는다 |
| `LegacyImportInvalid` | 옛 여행 파일 검증 실패 | 가져오기 대화상자 안 오류 문구 |
| `LabelNameTaken` | 라벨 이름 중복 | 입력란 오류 |

다른 탭에서 문서가 바뀌면 다시 읽어 반영한다. 이 탭에서 편집 중인 메모는 덮어쓰지 않고 "다른 탭에서 바뀌었어요"를 알린다.

### 6.4 규칙 (`docs/convention.md`에 기록)

- 실패하거나 의존성이 있는 작업은 Effect로 쓴다. **동기 순수 함수(필터, 지역 추출, 검색)는 평범한 함수**로 둔다.
- 기본은 `Effect.fnUntraced(function* (...) {})`. 사용자 동작 한 번에 한 번 실행되는 단위는 `Effect.fn('영역/동작')`.
- React 컴포넌트는 `startEffect`/`effectAtom`을 통해서만 Effect를 실행한다.

### 6.5 AI 참고용 Effect 소스

`yarn effect:source`가 `effect` 저장소의 설치 버전 태그(`effect@4.0.2`)를 얕게 clone해 `.reference/effect/`에 둔다. `.gitignore`·ESLint·Prettier·TypeScript 대상에서 제외한다. `docs/convention.md`에 "Effect API는 `.reference/effect/`를 기준으로 확인한다"를 적는다. 버전을 올리면 스크립트를 다시 실행한다.

## 7. 디렉터리 (1번 이후)

```
src/
├── lib/effect/            runtime, error-reporter, atom
├── schema/                library(v2), common, legacy/{trip-data,edit-layer,trip-source}
├── services/              LibraryStore, PrefsStore, IdGen, LegacyTripSource (+ 메모리 구현)
├── domain/library/        filter, region, search, label-ops, lww, legacy-convert   (순수 함수)
├── sections/
│   ├── library/           보관함(보기 4종, 필터, 일괄 편집)
│   ├── place/             장소 상세
│   ├── labels/            라벨 관리
│   ├── settings/          설정, 옛 여행 가져오기
│   └── shell/             레일, 하단 탭, 추가 시트, 반응형 레이아웃
├── components/map/        (유지)
└── theme/                 tokens/{pastel,paper,night}, create-theme, css-vars
```

## 8. 테스트와 완료 기준

- **단위(Vitest + `@effect/vitest`)**: 필터 OR/AND·미분류, 지역 추출(강원·제주·서울·세종·잘못된 주소), 검색(메모·라벨 이름), 라벨 병합·삭제, LWW 비교(순서 무관), 묘비 숨김, sid 중복 거부, v1→v2 변환, `LibraryStore`(손상 백업, 용량 초과, 잠금, 다른 탭 변경), 스키마 이전 후 기존 스키마 테스트 통과.
- **컴포넌트**: 라벨 칩 편집·새 라벨 생성, 메모 자동 저장(600ms·나갈 때), 일괄 선택, 보기 방식 4종, 테마 전환.
- **E2E(Playwright, 가짜 지도)**: 데스크톱 1280 — 3단 연동(목록 → 지도 → 상세). 모바일 WebKit 390(아이폰)·Chromium 360(갤럭시 크기) — 하단 탭, 상세 시트, 라벨 추가, 메모, 뒤로 가기. 옛 여행 가져오기 흐름. 테마 3종 × 라이트/다크 스크린샷.
- **완료 기준**: `yarn lint` · `yarn typecheck` · `yarn test` · `yarn build` · E2E 통과, 데스크톱·모바일 스크린샷 제시, Zod 대비 번들 크기 전후 수치 보고(`scripts/measure-ui-assets.mjs`). 실물 기기 점검은 5번에서 하고 자동화 결과와 구분해 기록한다.

## 9. 기존 코드 정리

| 대상 | 1번에서 |
|---|---|
| `sections/explore`, `TripPage`, `layouts/*Trip*`, `sections/views` | 새 화면으로 대체 후 삭제 |
| `sections/itinerary`, `domain/{leg-index,day-totals,day-hash}` | 3번 참고용으로 유지(라우트에서는 분리) |
| `sections/share`, `domain/{merge,reconcile,revert,overlay,codec}` | 4번 참고용으로 유지(라우트에서는 분리) |
| `pipeline/` | 스키마만 Effect로 옮겨 동작 유지. `naver-client.ts`는 2번 프록시에서 재사용, CLI 정리는 2·3번 이후 |
| `@iconify-json/mdi` | Lucide로 바꾼 뒤 제거 |
| README | 새 구조·명령으로 갱신 |

## 10. 범위 밖 (1번)

장소 추가(2번), 여행·일정·경로(3번), 내보내기/가져오기 병합 UI·드라이브(4번), 실물 기기 점검(5번), 한글 초성 검색, 사진(장소 썸네일은 라벨 색 블록으로 대신한다), 오프라인 PWA 설치.
