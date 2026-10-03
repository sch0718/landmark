# trip-map 설계 (PoC)

- 작성일: 2026-10-03
- 개정: 2026-10-03 r4 — 3차 리뷰 반영 (중복 방문 시 충돌 승격, 묶음 단위 되돌리기 §5.8, apply-edit 기준 버전 검사, 순서 무관성 범위 명시)
- 개정: 2026-10-03 r3 — 2차 리뷰 반영 (날짜 묶음 병합, apply-edit 미수집 yaml 보호, 가져오기 원본 버전 맞추기, 빈 날 구간 수, 병합 결과 검증, 사용자 선택 시각, 좌표 범위 표기)
- 개정: 2026-10-03 r2 — 설계 리뷰 반영 (되돌리기 병합, 가져오기 정리, 일정 재계산 절차, 작성자 ID, 경로 캐시 키, 미계산 합계, stopId, 필드별 병합, 공개 데이터 범위, 가져오기 제한, 관계 검증, 배포 게이트, 모바일 검증)
- 상태: 사용자 검토 대기
- 전신: `jeju_travel_map`(2025-05), `travel_map`(2025-06 ~ 2026-03, v0.1.0)
- 참고 스택: `rule_system_fe` (구조·스택·컨벤션만 따르고 파일은 복사하지 않음 — 회사 코드 및 유료 템플릿 라이선스)

## 1. 배경과 목표

### 1.1 해결하려는 불편 (네이버 지도)

| # | 불편 | PoC |
|---|---|---|
| A | 저장 장소가 많아지면 찾고 거르기 어렵다 (필터·태그·메모 부족) | **포함** |
| B | 저장 목록을 Day별 일정·동선으로 바꿀 수 없다 | **포함** |
| C | 동행자와 공유·함께 편집하기 어렵다 | 가벼운 형태로 포함 (링크 보기 + 로컬 편집 + 내보내기/가져오기) |
| D | 여행 중 모바일에서 "오늘 갈 곳"만 빠르게 보기 어렵다 | 현장 모드는 제외. 단 **모바일에서 보기·메모·내보내기는 필수** |

### 1.2 컨셉

네이버에 흩어져 저장해 둔 장소를 **여행 단위 지도**로 묶어, 거르고(탐색) 짜고(일정) 동행자와 함께 보는 개인용 뷰어.

### 1.3 기존 자산에서 가져오는 것

- `jeju_travel_map`: Day별 동선 시각화 UX
- `travel_map`: 라벨/카테고리 개념, 스키마로 데이터를 검증하는 방식
- 워크스페이스 `CLAUDE.md`·`korea-trip-planner`: 네이버 공유 폴더 API와 길찾기 API 호출 방법

기존 두 repo의 코드는 재사용하지 않는다.

### 1.4 성공 기준

다음 실제 여행 1건을 이 앱으로 계획하고, 동행자가 **휴대폰에서** 링크를 열어 메모를 남긴 뒤 내보내기로 돌려주고, 내가 가져와 병합할 수 있다. 내가 앱에서 바꾼 일정은 절차(§5.7)에 따라 실경로로 재계산되어 다시 배포된다.

### 1.5 제약과 결정

| 항목 | 결정 |
|---|---|
| 사용자 | 나(작성자) + 동행자. 로그인 없음 |
| 공유 | 여행별 공유 링크로 열람 |
| 편집 저장 | 보는 사람 브라우저의 localStorage |
| 편집 공유 | 내보내기(링크/파일) → 상대가 가져오기 → 병합 |
| 데이터 수집 | 빌드 타임(로컬 CLI). 앱은 완전 정적 |
| 지도 | 네이버 지도 JS API v3 (NCP) |
| 호스팅 | 비공개 GitHub repo → Cloudflare Pages, 추측 불가 URL + `noindex` |
| 공개 범위 | **배포된 JSON은 링크를 아는 누구나 읽을 수 있다**(§9.2). 공개할 필드를 최소화한다 |
| 확장 | PoC 검증 후 로그인·DB |

### 1.6 확인된 사실 (2026-10-03)

- 네이버 저장 목록 API(`pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/{shareId}/bookmarks`)는 `Origin` 헤더가 있으면 **403**, 없으면 200. 브라우저 직접 호출 불가 → 빌드 타임 수집으로 결정.
- 저장 목록 항목에 `sid`(네이버 장소 ID), `memo`, `mcidName`(대분류), `creationTime`, `lastUpdateTime`, `available`, `px`/`py`가 있다.
- 길찾기 API(`map.naver.com/p/api/directions/car`)는 `route.<옵션>[0]`에 `summary`(`distance`, `duration`, `staticDuration`, `tollFare`, `fuelPrice`)와 `path`(좌표 배열, 6.7km 구간에 282점)를 준다. 자동차 경로만 확인됨.

### 1.7 범위 밖 (PoC)

- 로그인, 서버 DB, 실시간 동시 편집
- 앱 안에서 새 장소 검색·추가 — **PoC 범위 제한**으로 제외. (네이버 JS API의 Geocoder 서브모듈로 주소→좌표 변환은 정적 페이지에서도 가능하지만, 상호 검색은 별도 기능이다. 새 장소는 네이버에 저장 후 collect 재실행.)
- 자동차 이외 이동수단의 실경로 (직선 + "경로 미계산" 표시)
- 현장 모드(현재 위치, 다음 장소, 방문 체크)
- 테마별 카테고리 정의
- `korea-trip-planner` 스킬의 yaml 출력 지원, 기존 repo archive (PoC 이후 별도 작업)

## 2. 아키텍처

### 2.1 데이터 흐름

```
① trips/<여행>.yaml                 사람 또는 korea-trip-planner가 작성
        │  yarn collect trips/<여행>.yaml   (로컬 맥에서 실행)
        ▼
② pipeline
   폴더 API → sid 기준 병합 → stop 연결 → 구간별 길찾기(캐시 우선)
   → 경로 단순화 → 공개 필드 필터 → TripData 검증 → public/data/<publicId>.json
        │  git push
        ▼
③ Cloudflare Pages: 검증 + 빌드(§9.1) → https://<도메인>/t/<publicId>
        │
        ▼
④ 앱: TripData(읽기 전용) ⊕ EditLayer(localStorage) = 화면
   내보내기/가져오기 = EditLayer만 주고받음
        │  작성자가 일정 편집을 확정할 때
        ▼
⑤ yarn apply-edit trips/<여행>.yaml <파일>.tripedit.json   → yaml의 days 갱신 → ①로
```

- 파이프라인은 로컬에서만 실행한다. 이유: 빌드 서버 IP에서 비공식 API가 막힐 수 있고, 길찾기 결과는 조회 시점 교통에 따라 달라지므로 결과 JSON을 커밋해 고정한다.
- `publicId`와 `stop.id`는 처음 collect할 때 생성해 yaml에 기록하므로 재수집해도 URL과 방문 식별자가 유지된다.

### 2.2 기술 스택

rule_system_fe 기준에서 이 앱에 필요한 것만 가져온다.

| 영역 | 선택 |
|---|---|
| 기본 | React 19, Vite, TypeScript, React Compiler |
| UI | MUI 7 + Emotion (테마는 최소한으로 새로 작성) |
| 상태 | Jotai (`atomWithStorage`로 EditLayer 영속화), 라우트 단위 `Provider` |
| 스키마 | Zod — 파이프라인·앱·가져오기가 공유하는 유일한 데이터 정의 |
| 기타 | react-router 7, dnd-kit, dayjs, es-toolkit, unplugin-icons, sonner, supercluster |
| 압축 | 브라우저 내장 `CompressionStream`/`DecompressionStream`(`deflate-raw`) + base64url — 해제를 스트리밍으로 하며 크기 상한에서 중단할 수 있다(§5.3) |
| 파이프라인 | tsx, yaml(Document API) |
| 테스트 | Vitest, React Testing Library, Playwright |
| 품질 | ESLint flat config, Prettier, husky + lint-staged |
| 패키지 | Yarn, Node ≥ 22 |

제외: Effect, bunshi, OpenTelemetry, 인증, handsontable, tiptap, MCP, openapi-ts, Docker/nginx, mkcert, patch-package, MSW, lz-string.

### 2.3 디렉터리 구조

```
trip-map/
├── src/
│   ├── schema/          # Zod: TripSource, TripData, EditLayer (+ 관계 검증)
│   ├── models/          # Trip, Place 도메인 클래스 (naverUrl, day 합계 등 파생값)
│   ├── repositories/    # trip-repo (fetch + 검증), edit-layer-repo (저장·내보내기·가져오기)
│   ├── domain/          # 순수 함수: overlay, merge, reconcile, revert, leg-index, day-totals, codec
│   ├── sections/
│   │   ├── explore/{store,type,view}
│   │   └── itinerary/{store,type,view}
│   ├── components/map/  # MapAdapter 인터페이스, NaverMapAdapter, FakeMapAdapter, 마커·폴리라인
│   ├── routes/          # paths.ts 등
│   ├── theme/
│   └── layouts/
├── pipeline/            # collect, apply-edit CLI (src/schema, src/domain 재사용)
├── trips/               # *.yaml (원본)
├── public/
│   ├── data/            # <publicId>.json (생성물, 커밋)
│   └── _headers
├── tests/{unit,e2e,fixtures}/
└── docs/
```

- 파일 이름: 컴포넌트는 PascalCase, 그 외는 kebab-case (rule_system_fe 컨벤션).
- `src/domain/`은 React·브라우저 저장소 API에 의존하지 않는다. 테스트의 중심이다.

## 3. 데이터 모델

모든 스키마는 `src/schema/`에 Zod로 정의하고 `schemaVersion: 1`로 시작한다.

### 3.1 TripSource (`trips/*.yaml`)

```yaml
publicId: k3f9x2a7q1          # 없으면 collect가 생성해 기록
title: 강릉 2박3일
startDate: 2026-11-14
endDate: 2026-11-16
folders:                      # 네이버 공유 폴더 shareId (배포 JSON에는 포함하지 않음)
  - 72815c89a7b241558581a0d907f133c1
  - 99f1043b371b42c893b32fd55de340e6
publish:
  naverMemo: false            # 네이버 저장 메모를 배포 JSON에 포함할지 (기본 false)
customPlaces:                 # 네이버 폴더에 없는 곳. 집 대신 인근 역 등 대표 지점 권장
  - { key: start, name: 출발(사당역), lng: 126.9816, lat: 37.4765 }
days:
  - date: 2026-11-14
    stops:
      - { id: s7k2, place: start }                                # id 없으면 collect가 생성해 기록
      - { id: s9xa, place: "12028621", time: "12:00", note: 점심 }  # 네이버 sid
```

- `place`는 네이버 `sid`(숫자 문자열) 또는 `customPlaces[].key`.
- `publicId`: 영숫자 소문자 10자 이상, 무작위. `stop.id`: 여행 안에서 유일한 영숫자 4자 이상, 무작위.

### 3.2 TripData (`public/data/<publicId>.json`, 읽기 전용)

```
TripData {
  schemaVersion: 1
  publicId, title, startDate, endDate
  dataVersion: ISO 시각 (collect 실행 시각)
  folders: [{ id: "f1" | "f2" | …, name, count }]        # shareId는 넣지 않는다
  places: Record<PlaceKey, Place>
  days: [Day]
}
PlaceKey = "n:<sid>" | "c:<customKey>"
Place { name, address, lng, lat, category (mcidName, custom은 null),
        folderIds: ("f1"…)[], savedAt (custom은 null), sid?,
        naverMemos?: [{ folderId, memo }] }               # publish.naverMemo=true일 때만
Day   { date, stops: [Stop], legs: [Leg] }
Stop  { id, placeKey, time?: "HH:mm", note? }
Leg   { fromStopId, toStopId, fromPlaceKey, toPlaceKey,
        status: "routed" | "failed",
        distanceM, distanceKind: "road" | "straight",
        durationMs: number | null, staticDurationMs: number | null, tollFare: number | null,
        path: [lng, lat][], queriedAt: ISO | null }
```

**중복 장소 병합** (같은 `sid`가 여러 폴더에 있을 때):

| 필드 | 규칙 |
|---|---|
| `name`, `address`, `lng`, `lat`, `category` | `lastUpdateTime`이 가장 큰 항목의 값 |
| `folderIds` | 모두 (yaml `folders` 순서) |
| `savedAt` | `creationTime`의 최솟값 |
| `naverMemos` | 비어 있지 않은 메모를 폴더별로 모두 보존 |

**Leg**

- `stops`의 연속 쌍마다 하나. 같은 장소를 여러 번 방문해도 `stop.id`로 구분된다.
- `status: "failed"`: `path`는 두 점(직선), `distanceKind: "straight"`, `durationMs`·`staticDurationMs`·`tollFare`는 `null`(미상), `queriedAt`은 `null`.
- `path`는 Douglas-Peucker로 약 5m 허용 오차로 단순화한다.

### 3.3 EditLayer (localStorage, 내보내기·가져오기 단위)

```
EditLayer {
  schemaVersion: 1
  publicId
  baseDataVersion            # 마지막으로 정리(reconcile)한 TripData.dataVersion
  authorId                   # 첫 편집 시 생성하는 로컬 UUID
  authors: Record<authorId, { nickname, updatedAt }>     # 표시용 닉네임
  places: Record<PlaceKey, PlaceEdit>
  days: Record<date, DayEdit>
}
PlaceEdit {
  memos:  Record<authorId, { text: string | null, updatedAt }>   # null = 삭제(툼스톤)
  tags:   { value: string[], updatedAt } | undefined
  hidden: { value: boolean,  updatedAt } | undefined
}
DayEdit =
  | { mode: "override", stops: [Stop], baseDayHash, updatedAt }
  | { mode: "reset", updatedAt }                          # 원본으로 되돌림(툼스톤)
```

- `days[date]`가 없거나 `mode: "reset"`이면 원본 일정을 따른다. `override`면 그날 일정 전체를 대체한다.
- 앱에서 새로 일정에 넣은 방문은 새 `stop.id`를 받는다(로컬 생성, 여행 안에서 유일).
- 다른 날로 옮긴 방문은 **같은 `stop.id`를 유지**한다. 출발일과 도착일 두 DayEdit가 함께 기록되며, 병합은 이 id로 두 날을 묶는다(§5.4).
- `baseDayHash`: override를 만들 때 그날 원본 `stops`(id·placeKey·time·note)의 해시.
- 원본(TripData)은 절대 수정하지 않는다. 화면은 항상 `overlay(TripData, EditLayer)`로 계산한다.

### 3.4 travel_map 개념의 대응

- 필터 축 = 카테고리(`mcidName`) + 소속 폴더 + 사용자 태그(EditLayer).
- 테마별 카테고리 정의는 PoC 범위 밖.

### 3.5 관계 검증 (Zod `superRefine`)

TripSource·TripData 공통:
- `startDate ≤ endDate`, 모든 날짜는 실제 달력 날짜(`2026-02-30` 거부).
- `days[].date`는 기간 안, 중복 없음.
- `customPlaces[].key` 중복 없음, 숫자만으로 된 key 금지(sid와 구분).
- 좌표 범위(경계 포함): `124.0 ≤ lng ≤ 132.0`, `33.0 ≤ lat ≤ 39.0` (대한민국 영역).
- `stop.id` 여행 전체에서 유일. `time`은 `HH:mm`.
- 방문이 하나도 없는 날(`stops: []`)을 허용한다.

TripData 추가:
- 모든 `stop.placeKey`가 `places`에 존재, 모든 `folderIds`가 `folders`에 존재.
- `legs.length = max(0, stops.length - 1)`이고 `legs[i]`의 `fromStopId/toStopId`가 `stops[i]/stops[i+1]`과 일치, `fromPlaceKey/toPlaceKey`도 일치.
- `status`와 nullable 필드 조합이 §3.2 규칙과 일치.

EditLayer 추가:
- override의 `stop.id`가 그날 안에서 유일. `memos`의 키가 `authors`에 존재.
- 크기 제한은 §5.3.

실효 일정(`overlay(TripData, EditLayer)` 결과) 추가:
- `stop.id`가 여행 전체에서 유일. 병합(§5.4) 결과도 이 검사를 통과해야 한다.

## 4. 화면

### 4.1 라우트

| 경로 | 내용 |
|---|---|
| `/` | "공유받은 링크로 접속하세요" 안내만. 여행 목록 노출 금지 |
| `/t/:publicId` | 여행 화면. 쿼리 `mode=explore\|itinerary`, `day=<n>`, `place=<PlaceKey>` |

### 4.2 레이아웃

- 데스크톱: 지도 + 오른쪽 접이식 패널(약 400px).
- 모바일(< 768px): 지도 + 하단 시트(peek / half / full).
- 상단 바: 여행 제목, `[탐색|일정]` 전환, 검색(이름·주소·메모·태그), 내보내기/가져오기 메뉴.

### 4.3 탐색 모드

- 필터 칩: 폴더(복수), 카테고리(개수 표시), 내 태그, 상태(메모 있음 / 일정 포함·미포함 / 숨김 보기).
- 지도: 필터 통과 장소를 카테고리 색 마커로. `supercluster`로 클러스터링.
- 목록: "지도 영역 안만 보기" 토글. 목록과 지도 선택 상태 동기화.
- 장소 카드: 이름, 카테고리, 주소, 소속 폴더, 네이버 메모(공개된 경우, 폴더별), 작성자별 메모(닉네임 표시, 내 것만 편집·삭제), 태그, 숨기기, `[일정에 추가 → Day 선택]`, `[네이버에서 열기]`(`https://m.place.naver.com/place/<sid>`; custom 장소는 숨김).

### 4.4 일정 모드

- Day 탭: 전체 / Day1 / Day2 / …
- 지도: 선택한 날의 실경로 폴리라인 + 순서 번호 마커(같은 장소 반복 방문은 번호를 함께 표시, 예: `①⑥`). "전체"는 날짜별 색. 미계산 구간은 직선 점선.
- 후보 레이어 토글: 일정에 없는 저장 장소를 흐린 마커로 표시, 탭하면 그날에 추가.
- 타임라인: 장소 행 사이에 구간 행.
  - 계산된 구간: `🚗 2시간 31분 · 도로 180km · 8,500원`
  - 미계산 구간: `┄ 직선 3.2km · 시간 미상 · 재계산 필요`
- Day 합계: 계산된 구간만 더하고 미계산 구간 수를 함께 표시한다. 예: `계산된 구간 2시간 40분 · 도로 186km · 8,500원 · 미계산 2구간(직선 5.1km)`. 미계산 구간의 시간·통행료를 0으로 더하지 않는다.
- 편집: 같은 날 안에서 드래그로 순서 변경, `⋯` 메뉴로 다른 날 이동·빼기, 시간·메모 인라인 편집, `[원본 일정으로 되돌리기]`(§5.8 — 연결된 날짜 묶음 단위로 `mode: "reset"` 기록).
- 작성자용 안내: 미계산 구간이 있는 override가 있으면 "재계산하려면 편집을 파일로 내보내 `apply-edit`을 실행하세요"(§5.7) 문구를 일정 패널 하단에 표시.

### 4.5 공통

- 첫 편집 시 닉네임 입력 대화상자(authorId 생성). 닉네임은 설정에서 변경 가능.
- 정리(reconcile) 결과와 미해결 원본 변경 배너(§5.5).

## 5. 편집·병합·내보내기

### 5.1 저장

- 키: `tripmap:edit:<publicId>`. 편집 즉시 저장.
- 읽기 실패(파싱/검증) 시 원본 문자열을 `tripmap:edit:<publicId>:corrupt:<epoch>`로 백업하고 빈 레이어로 시작, 토스트 안내.
- `schemaVersion`이 낮으면 마이그레이션 함수 체인을 적용한다(PoC에서는 v1만 존재).

### 5.2 내보내기

1. 링크(기본): EditLayer JSON → `deflate-raw` 압축 → base64url → `/t/<publicId>#e=<값>`. 프래그먼트는 서버로 전송되지 않는다.
   - 모바일에서 `navigator.share`가 있으면 공유 시트를 띄우고, 없으면 클립보드 복사.
   - 링크가 8,000자를 넘으면 파일 내보내기를 안내한다.
2. 파일: `<제목>-<닉네임>-<YYYYMMDD>.tripedit.json` (압축하지 않은 JSON).

### 5.3 가져오기

**크기 제한** (검증 전에 적용):

| 대상 | 상한 |
|---|---|
| `#e=` 값 길이 | 16,000자 |
| 파일 크기 | 1MB |
| 압축 해제 결과 | 1MB — 스트리밍 해제 중 초과하면 즉시 중단 |
| 메모 길이 | 2,000자 |
| 장소당 태그 | 20개, 태그당 30자 |
| Day당 stop | 50개 |
| authors | 50명 |

**순서**

1. `#e=` 링크 진입 또는 파일 선택 → 크기 제한 → 해제 → Zod 검증. 실패하면 사유 토스트, 상태 변경 없음.
2. `publicId` 불일치 시 거부.
3. **원본 버전 맞추기**: `incoming.baseDataVersion > tripData.dataVersion`(ISO 문자열 비교)이면 받은 편집이 내가 보고 있는 원본보다 새 원본 기준이다.
   - TripData를 캐시 무시(`cache: "no-cache"`)로 다시 받는다. 새 원본을 받았으면 로컬 EditLayer부터 `reconcile`한 뒤 다음 단계로 간다.
   - 다시 받아도 여전히 더 오래됐으면(CDN 전파 지연 등) **가져오기를 중단**한다: "최신 여행 데이터가 아직 반영되지 않았어요. 잠시 후 다시 시도하세요." 오래된 원본을 기준으로 방문을 제거하지 않는다.
4. **incoming을 현재 TripData 기준으로 정리**: `reconcile(tripData, incoming)`(§5.5). 사라진 장소·날짜, 원본이 바뀐 날의 override를 찾아낸다.
5. 미리보기: 메모 추가/변경/삭제 수, 태그·숨김 변경(덮어써지는 로컬 값 표시), Day 변경과 충돌 묶음(§5.4), 4단계 정리 내역(제거될 방문, 표시되지 않을 날짜, 원본이 바뀐 날).
6. 확인 시 `merge(local, reconciledIncoming)` → **결과를 EditLayer 스키마·크기 제한·실효 일정 검증(§3.5)으로 다시 검사**. 실패하면 사유를 보여 주고 기존 상태를 유지한다(예: authors 합집합이 50명 초과).
7. 취소하거나 실패해도 상태 변경 없음. 어느 경우든 `history.replaceState`로 `#e` 제거.
8. 원본이 바뀐 날의 override는 병합 후에도 `baseDayHash` 불일치로 남으므로, §5.5의 미해결 배너로 이어진다(별도 상태 저장 불필요).

### 5.4 병합 규칙 (`merge(local, incoming)`)

모든 LWW는 `updatedAt`을 비교하고, 같으면 JSON 직렬화 문자열을 사전순 비교해 큰 쪽을 택한다(결정적 타이브레이크).

| 대상 | 규칙 |
|---|---|
| `authors` | authorId 단위 LWW (닉네임 변경 반영) |
| `memos` | authorId 단위 LWW. `text: null` 툼스톤도 비교 대상 — 삭제가 옛 메모에 의해 되살아나지 않는다 |
| `tags`, `hidden` | **필드별** LWW. 한 사람이 태그를, 다른 사람이 숨김을 바꾸면 둘 다 유지 |
| `days` | 날짜 하나가 아니라 **연결된 날짜 묶음** 단위로 병합한다 (아래) |
| `authorId`, `baseDataVersion` | local 값 유지 |

**일정 병합 (`days`)**

다른 날로 옮긴 방문은 출발일과 도착일 두 DayEdit에 걸쳐 있으므로, 날짜별로 따로 고르면 방문이 사라지거나 두 날에 중복될 수 있다. 예: 원본 Day1=[X], Day2=[Y]에서 A가 X를 Day2로 옮기고(Day1=[], Day2=[Y,X]), B가 나중에 Day2의 Y 메모를 고치면(Day2=[Y']) 날짜별 LWW는 Day1=[], Day2=[Y']를 골라 X가 사라진다.

1. **날짜 묶기**: 원본, local 실효 일정, incoming 실효 일정 세 곳에서 각 `stop.id`가 놓인 날짜를 모은다. 같은 `stop.id`가 서로 다른 날짜에 나타나면 그 날짜들을 한 묶음으로 합친다(union-find). 다른 날과 연결되지 않은 날은 혼자 한 묶음이다.
2. **묶음별 판정**: 묶음 안 각 날짜의 local·incoming 상태(DayEdit 또는 "없음 = 원본")를 비교한다.
   - 모든 날짜에서 한쪽만 DayEdit를 가졌거나 양쪽 내용(`mode`, `stops`)이 같으면 날짜별로 채택한다(같으면 `updatedAt` 큰 쪽). 단, 이렇게 합친 묶음 안에서 `stop.id`가 두 번 이상 나타나면 **묶음 전체를 충돌로 승격**한다. 예: 원본 Day1의 X를 A는 Day2로, B는 Day3로 옮기면 Day1은 양쪽이 같고 Day2·Day3는 한쪽씩만 편집했지만, 합치면 X가 두 번 나오므로 {Day1, Day2, Day3}가 충돌 묶음이 된다.
   - 하나라도 양쪽이 다르면 **묶음 전체가 충돌**이다. 미리보기에서 묶음 단위로 "내 것/받은 것"을 고르고, 고른 쪽의 상태를 묶음의 **모든 날짜**에 그대로 적용한다("없음"도 포함). 기본값은 묶음 안 DayEdit 중 `updatedAt`이 가장 큰 쪽.
   - 위 예에서 {Day1, Day2}가 한 묶음으로 충돌이 되고, A를 고르면 Day1=[], Day2=[Y,X], B를 고르면 Day1=원본 [X], Day2=[Y']가 된다. 어느 쪽이든 X는 정확히 한 번 남는다.
3. **결과 검증**: 병합 결과의 실효 일정에서 `stop.id`가 여행 전체에서 유일해야 한다(§3.5). 2단계의 승격 때문에 정상 입력에서는 위반이 생기지 않으며, 위반하면 버그로 보고 병합을 중단하고 기존 상태를 유지한다.

**충돌 해결과 사용자 선택의 시각**

- 사용자가 명시적으로 고른 결과는 **새 편집**으로 기록한다. 고른 값에 `updatedAt = 지금`을 찍는다. 대상: 가져오기 충돌에서 기본값이 아닌 쪽을 고름, `[원본 보기]`, `[내 편집 유지]`. 이렇게 하면 이 선택을 다시 내보냈을 때 옛 값에 뒤집히지 않는다.
- 기본값을 그대로 받아들인 경우와 자동 정리(§5.5의 override→reset)는 원래 `updatedAt`을 유지한다.

**성질과 한계**

- 성질: 같은 입력을 두 번 병합해도 결과가 같다(멱등). 충돌 선택을 기본값으로 두면 `merge(a, b)`와 `merge(b, a)`의 결과가 같다.
- 보장 범위: 위 순서 무관성은 **두 입력 사이**에만 해당한다. 날짜 묶음은 병합할 때마다 그 시점의 세 일정으로 다시 계산하므로, 여러 파일을 차례로 가져오면 가져오는 순서에 따라 결과가 달라질 수 있다. PoC는 이를 받아들이고, 파일을 하나씩 가져오며 매번 미리보기를 확인하도록 안내한다.
- 한계: LWW는 기기 시계에 의존한다. PoC는 이를 받아들이고, 미리보기에서 덮어써지는 로컬 값을 보여 주는 것으로 보완한다.

### 5.5 정리 (`reconcile(tripData, editLayer)`)

순수 함수이며 다음 세 시점에 실행한다: 앱 로드, 가져오기의 incoming(§5.3), `apply-edit`(§5.7).

- 원본에 없는 PlaceKey의 PlaceEdit: 삭제하지 않고 유지("고아"). 배너에 개수 표시, 내보내기에 포함.
- override 안의 사라진 PlaceKey: 해당 stop 제거 후 알림.
- 원본에 없는 날짜의 DayEdit: 유지하되 화면에는 표시하지 않고 배너로 알림.
- override의 `stops`가 현재 원본 `stops`와 같으면 DayEdit를 `reset`으로 바꾼다(재계산 반영 후 자동 정리). 이때 `updatedAt`은 새로 찍지 않고 override의 값을 그대로 쓴다 — 자동 정리가 동행자의 더 최근 편집을 LWW에서 이기지 않도록.
- 원본 그날 `stops` 해시 ≠ `baseDayHash`: **미해결 원본 변경**. 이 판정은 저장된 플래그가 아니라 매 로드마다 해시를 비교해 계산하므로, 가져오기로 들어온 옛 override도 해결될 때까지 계속 배너에 남는다.
  - 배너: "Day n 원본이 바뀌었어요 `[원본 보기]` `[내 편집 유지]`". `[원본 보기]`는 그날이 속한 묶음 전체를 되돌린다(§5.8), `[내 편집 유지]`는 `baseDayHash`를 현재 값으로 갱신. 둘 다 `updatedAt = 지금`(§5.4).
- 완료 후 `baseDataVersion = tripData.dataVersion`.

### 5.6 편집한 날의 구간 (`leg-index`)

- TripData의 모든 `routed` Leg를 `fromPlaceKey→toPlaceKey` 키로 색인(날짜 무관, 방향 구분). 같은 TripData 안에서 PlaceKey의 좌표는 하나이므로 장소 키로 충분하다.
- 실효 stops의 연속 쌍마다 색인에서 찾으면 그 Leg를 재사용, 없으면 화면용 미계산 Leg(`distanceKind: "straight"`, 시간·통행료 `null`)를 만든다.

### 5.7 일정 재계산 절차 (작성자)

앱에서 바꾼 일정을 실경로로 만들려면 작성자가 다음 순서로 실행한다.

1. 동행자 편집을 가져와 병합하고, 일정이 원하는 상태인지 앱에서 확인한다.
2. 앱에서 **파일로 내보내기**.
3. `yarn apply-edit trips/<여행>.yaml <파일>.tripedit.json`
   - **모든 검사를 먼저 끝내고, 통과했을 때만 yaml을 기록한다**(임시 파일에 쓴 뒤 rename). 검사 중 하나라도 실패하면 yaml은 바뀌지 않는다.
   - 검사 0 (**기준 버전**): 편집 파일의 `baseDataVersion`이 로컬 `public/data/<publicId>.json`의 `dataVersion`보다 새로우면 종료 코드 1. "편집이 더 새 원본 기준입니다. `git pull`로 최신 JSON을 받거나 `collect`를 다시 실행하세요." 오래된 원본으로 reconcile해 방문을 지우지 않기 위해서다. 더 오래된 기준은 허용한다(검사 1의 reconcile이 처리).
   - 검사 1: EditLayer를 검증하고 현재 `public/data/<publicId>.json` 기준으로 `reconcile`한다. 미해결 원본 변경이 있으면 목록을 출력하고 종료 코드 1(앱에서 먼저 해결).
   - 검사 2 (**미수집 yaml 보호**): 반영 대상 날짜마다 현재 yaml의 `stops`(id·place·time·note)와 기준 JSON의 그날 `stops`를 비교한다. 다르면 yaml이 마지막 collect 이후 직접 수정된 것이므로, 날짜별 차이를 출력하고 종료 코드 1. (먼저 `collect`로 JSON을 맞추고 앱에서 편집을 다시 확인한다.) 날짜 목록 자체가 다를 때도 같다.
   - 검사 3: 반영 결과 yaml이 `TripSource` 검증(관계 포함, 빈 날 허용)을 통과해야 한다.
   - 기록: `override`인 날의 `stops`를 yaml `days`에 주석을 보존하며 반영한다. `reset`과 DayEdit가 없는 날은 건드리지 않는다.
   - 메모·태그·숨김은 yaml로 옮기지 않는다(EditLayer에 남는다).
   - 반영한 날과 변경 요약을 출력한다.
4. `yarn collect trips/<여행>.yaml` → 새 구간만 API 호출(캐시 미스), 기존 구간은 캐시 재사용.
5. 커밋·push → 배포. 다음에 앱을 열면 reconcile이 내 override와 새 원본이 같음을 확인하고 `reset`으로 정리한다.

### 5.8 원본으로 되돌리기

다른 날로 옮긴 방문이 있으면 한 날만 되돌릴 때 방문이 중복되거나(출발일만 되돌림) 사라진다(도착일만 되돌림). 그래서 되돌리기도 날짜 묶음 단위로 한다.

1. **묶음 계산**: 원본과 local 실효 일정 두 곳에서 각 `stop.id`가 놓인 날짜를 모아, 같은 `stop.id`가 다른 날짜에 있으면 묶는다(§5.4와 같은 union-find, 입력이 둘).
2. 묶음이 그날 하나뿐이면 바로 `reset`으로 기록한다.
3. 둘 이상이면 확인 대화상자: "Day1의 방문이 Day2로 옮겨져 있어 **Day1, Day2를 함께** 원본으로 되돌립니다. Day2의 다른 편집도 함께 사라져요." 확인 시 묶음의 모든 날짜를 `reset`(`updatedAt = 지금`)으로 기록한다. 부분 되돌리기는 PoC 범위 밖.
4. 원본 변경 배너의 `[원본 보기]`(§5.5)도 같은 절차를 따른다.

## 6. 에러 처리

| 상황 | 동작 |
|---|---|
| TripData 404 | "링크가 잘못되었거나 만료된 여행입니다" |
| TripData 검증 실패 | 에러 화면에 `schemaVersion`과 첫 검증 오류 표시 |
| 네이버 지도 SDK 로드 실패 | 지도 숨기고 목록 전용 모드, 원인 안내(도메인 미등록 가능성) |
| localStorage 사용 불가 | 열람 가능, 편집 시 "이 브라우저에서는 저장되지 않아요. 내보내기를 이용하세요" |
| 가져오기 크기 초과·손상·불일치 | 토스트로 사유 표시, 상태 변경 없음 |

## 7. 파이프라인

### 7.1 `yarn collect <yaml> [--refresh-routes]`

1. yaml 로드 → `TripSource` 검증(관계 포함). `publicId`·`stop.id`가 없으면 생성해 Document API로 주석을 보존하며 기록.
2. 폴더를 순차 조회: `start=0&limit=500`, `count`가 500을 넘으면 `start`를 늘려 반복, 요청 간 300ms 대기. 헤더는 `User-Agent`와 `Referer: https://pages.map.naver.com/save-pages/detail-list/<shareId>`, `Origin` 없음.
3. `sid` 기준 병합(§3.2 규칙) → `places` 구성. `available: false` 항목은 제외하고 개수를 보고. 폴더에는 `f1, f2, …` 내부 ID를 부여.
4. stop 연결: 찾지 못한 `place`는 목록을 출력하고 종료 코드 1.
5. 구간 경로: 캐시 우선.
   - 캐시 파일: `.cache/routes/<sha256(키)>.json` (gitignore). 키 = `{ cacheVersion: 1, start: [lng, lat], goal: [lng, lat], option: "car:default" }` — 좌표는 소수 7자리로 정규화. 장소 좌표가 바뀌면 자동으로 캐시 미스.
   - 캐시 미스 또는 `--refresh-routes`면 API 호출(순차, 300ms 대기).
   - **실패는 캐시하지 않는다.** 다음 collect에서 자동 재시도. 한 실행 안에서는 재시도하지 않는다.
6. 공개 필드 필터: `publish.naverMemo`가 false면 `naverMemos` 제외. shareId는 항상 제외.
7. 경로 단순화 → `TripData` 검증(관계 포함) → `public/data/<publicId>.json` 기록.
8. 요약 출력: 폴더별 장소 수, 제외 수, Day별 거리·시간·통행료, 실패 구간.

### 7.2 `yarn apply-edit <yaml> <tripedit.json>`

§5.7의 3단계. 성공 시 yaml만 바꾸고 TripData는 바꾸지 않는다(이어서 collect 실행).

### 7.3 `yarn validate`

`trips/*.yaml`과 `public/data/*.json`을 스키마(관계 포함)로 검증한다. 배포 빌드에 포함된다(§9.1).

## 8. 테스트

### 8.1 단위 (Vitest)

- `domain/merge` (표 기반)
  - 멱등성, 병합 순서 무관성(충돌 기본값 기준)
  - authorId별 메모, 메모 삭제 툼스톤이 옛 메모를 이김
  - 같은 닉네임 다른 authorId의 메모가 둘 다 남음
  - 태그와 숨김을 서로 다른 사람이 바꾸면 둘 다 유지
  - **되돌리기(reset) 후 옛 override 파일을 다시 가져와도 reset이 유지됨** (reset이 더 최신일 때)
  - Day 충돌 감지
  - **날짜 간 이동 병합**: A가 X를 Day1→Day2로 옮기고 B가 Day2(또는 Day1)를 나중에 고친 두 경우 모두, {Day1, Day2}가 한 충돌 묶음이 되고 어느 쪽을 골라도 X가 정확히 한 번 남음
  - **같은 방문을 서로 다른 날로 이동**: A는 X를 Day2로, B는 Day3로 옮기면 {Day1, Day2, Day3}가 충돌 묶음으로 승격되어 선택 후 X가 정확히 한 번 남음(가져오기가 실패하지 않음)
  - 병합 결과 검증 실패(authors 합집합 50명 초과) 시 local 상태 불변
  - 순서 무관성: 두 입력 `merge(a, b)`와 `merge(b, a)`가 충돌 기본값에서 같음
  - 기본값이 아닌 쪽을 고른 결과는 `updatedAt = 지금`으로 기록되어, 옛 파일을 다시 가져와도 뒤집히지 않음
- `domain/reconcile`
  - **v2 원본에 v1 편집을 가져오면** 사라진 장소의 방문이 제거되고, 원본이 바뀐 날이 미해결로 남으며, 병합 후 재로드해도 미해결 판정이 유지됨
  - override가 원본과 같아지면 reset으로 정리
- `domain/revert` (§5.8)
  - **이동 후 출발일 되돌리기**: X를 Day1→Day2로 옮긴 뒤 Day1을 되돌리면 묶음 {Day1, Day2}가 반환되고, 확인 후 둘 다 reset되어 X가 원본 Day1에만 남음
  - 이동이 없는 날은 그날만 reset
- 가져오기 흐름(`repositories/edit-layer-repo`, fetch 모킹)
  - **보고 있는 원본보다 새 기준의 파일 가져오기**: TripData를 다시 받아 진행하고, 다시 받아도 오래됐으면 중단하며 방문을 제거하지 않음
  - 고아 PlaceEdit 유지
- `domain/overlay`, `domain/leg-index`
  - **같은 장소 반복 방문**(숙소→A→숙소) 시 stop별로 구분되고 구간이 올바르게 연결됨
- `domain/day-totals`: 미계산 구간은 시간·통행료 합계에서 빠지고 개수·직선거리로 따로 집계됨
- `domain/codec`: 왕복 일치, 길이 상한 초과 거부, 해제 결과 1MB 초과 시 중단
- `schema`: 관계 검증 각 규칙의 통과/거부 사례
- `pipeline`
  - sid 병합 규칙(최신 이름, 최초 저장일, 폴더별 메모 보존), stop 연결 실패, 페이지네이션, 경로 단순화
  - **좌표가 바뀌면 경로 캐시 미스**, 실패 결과는 캐시되지 않음
  - 공개 필드 필터(shareId 없음, naverMemo 옵션)
  - **`apply-edit`**: override를 yaml에 반영(주석 보존), reset 날은 미변경, 미해결 원본 변경이 있으면 실패
  - **더 새 기준 편집 거부**: 편집의 `baseDataVersion`이 로컬 JSON보다 새로우면 reconcile 전에 실패, yaml 불변
  - **미수집 yaml 보호**: collect 이후 yaml을 직접 고친 날이 있으면 차이를 출력하고 실패, yaml 파일은 바이트 단위로 그대로
  - **빈 일정 재수집**: 마지막 방문을 뺀 override → apply-edit → collect 결과 `stops: []`, `legs: []`로 검증 통과
  - 통합: 편집 일정 → apply-edit → collect(녹화 fixture) → 새 구간만 조회됨
  - **녹화한 실제 API 응답 fixture**(`tests/fixtures/`)만 사용, 네트워크 호출 없음.

### 8.2 컴포넌트 (RTL)

- 타임라인 재정렬 → EditLayer 갱신, 되돌리기 → reset 기록, 묶음 되돌리기 확인 대화상자에 함께 되돌릴 날짜 표시
- 가져오기 미리보기: 덮어써지는 값, 충돌, 정리 내역 표시
- Day 합계의 미계산 표시

### 8.3 E2E (Playwright, `VITE_MAP_ADAPTER=fake`, fixture TripData)

- 프로젝트 2개: 데스크톱(Chromium 1280×800), **모바일(iPhone 13 에뮬레이션)**.
- 시나리오 1(모바일): 링크 열기 → 닉네임 입력 → 메모 작성 → 링크 내보내기(클립보드/공유 폴백) → 새 브라우저 컨텍스트에서 열기 → 가져오기 → 병합 결과 확인.
- 시나리오 2(데스크톱): 일정 순서 변경 → 미계산 표시 → 되돌리기 → 옛 내보내기 재가져오기 → 되돌린 상태 유지.

### 8.4 수동 확인 (배포 후)

- 실제 네이버 지도 렌더링.
- 실제 휴대폰(iOS Safari, Android Chrome)에서 카카오톡으로 받은 링크 열기 → 메모 → 공유 시트로 내보내기 → 상대 기기에서 가져오기.

## 9. 배포

### 9.1 빌드와 게이트

- Cloudflare Pages ← 비공개 GitHub repo. **빌드 명령 `yarn build:ci`** = `yarn validate && yarn typecheck && yarn test && yarn build`. 검증·테스트가 실패하면 배포되지 않는다. 출력 `dist`.
- SPA 라우팅은 Pages 기본 동작(404.html 없음 → index.html) 사용.
- GitHub Actions는 PR·push에 lint와 같은 검증을 돌리는 보조 수단이다. 배포 여부는 위 빌드 명령이 결정한다.
- `public/_headers`:
  - `/*` → `X-Robots-Tag: noindex`
  - `/data/*` → `Cache-Control: public, max-age=60`
- 환경변수 `VITE_NAVER_MAP_CLIENT_ID`. NCP 콘솔에 Pages 도메인과 `http://localhost:5173` 등록. NCP Maps 요금·무료 사용량은 **확인 필요**.

### 9.2 공개 데이터 범위

비공개 repo여도 **배포된 `public/data/*.json`은 공개 파일**이다. `noindex`는 검색 엔진에 대한 지시일 뿐 접근 제어가 아니며, URL을 아는 사람은 누구나 JSON 전체를 받을 수 있다.

| 데이터 | 처리 |
|---|---|
| 네이버 폴더 shareId | 배포하지 않음 (`f1` 등 내부 ID로 대체). shareId가 있으면 폴더 전체를 조회할 수 있기 때문 |
| 네이버 저장 메모 | 기본 미배포. 여행별 `publish.naverMemo: true`일 때만 |
| 집 등 사적 좌표 | customPlaces에 정확한 위치 대신 인근 역 등 대표 지점을 쓰도록 문서·예시로 안내. 구간 경로가 그 지점에서 시작하므로 좌표만 숨기는 방식은 쓰지 않는다 |
| 제목·일정·장소 | 공개를 전제로 한다. 더 강한 보호가 필요해지면 PoC 이후 접근 제어(로그인) 단계에서 다룬다 |

## 10. 위험

| 위험 | 대응 |
|---|---|
| 네이버 비공식 API 변경·차단 | 로컬 수집 + 결과 커밋으로 앱은 영향 없음. 파이프라인 클라이언트를 한 파일로 격리 |
| 공유 링크 유출 | §9.2 공개 범위 최소화, 추측 불가 ID, 루트 목록 미노출 |
| localStorage 유실(브라우저 정리) | 내보내기 안내, 정리 배너에서 내보내기 유도 |
| 기기 시계 차이로 LWW 오판 | 가져오기 미리보기에서 덮어써지는 값 표시 (§5.4) |
