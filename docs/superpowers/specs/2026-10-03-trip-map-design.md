# trip-map 설계 (PoC)

- 작성일: 2026-10-03
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
| D | 여행 중 모바일에서 "오늘 갈 곳"만 빠르게 보기 어렵다 | 제외 (반응형으로 보이는 수준만) |

### 1.2 컨셉

네이버에 흩어져 저장해 둔 장소를 **여행 단위 지도**로 묶어, 거르고(탐색) 짜고(일정) 동행자와 함께 보는 개인용 뷰어.

### 1.3 기존 자산에서 가져오는 것

- `jeju_travel_map`: Day별 동선 시각화 UX
- `travel_map`: 라벨/카테고리 개념, 스키마로 데이터를 검증하는 방식
- 워크스페이스 `CLAUDE.md`·`korea-trip-planner`: 네이버 공유 폴더 API와 길찾기 API 호출 방법

기존 두 repo의 코드는 재사용하지 않는다.

### 1.4 성공 기준

다음 실제 여행 1건을 이 앱으로 계획하고, 동행자가 휴대폰에서 링크를 열어 메모를 남긴 뒤 내보내기로 돌려주고, 내가 가져와 병합할 수 있다.

### 1.5 제약과 결정

| 항목 | 결정 |
|---|---|
| 사용자 | 나 + 동행자. 로그인 없음 |
| 공유 | 여행별 공유 링크로 열람 |
| 편집 저장 | 보는 사람 브라우저의 localStorage |
| 편집 공유 | 내보내기(링크/파일) → 상대가 가져오기 → 병합 |
| 데이터 수집 | 빌드 타임(로컬 CLI). 앱은 완전 정적 |
| 지도 | 네이버 지도 JS API v3 (NCP) |
| 호스팅 | 비공개 GitHub repo → Cloudflare Pages, 추측 불가 URL + `noindex` |
| 확장 | PoC 검증 후 로그인·DB |

### 1.6 확인된 사실 (2026-10-03)

- 네이버 저장 목록 API(`pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/{shareId}/bookmarks`)는 `Origin` 헤더가 있으면 **403**, 없으면 200. 브라우저 직접 호출 불가 → 빌드 타임 수집으로 결정.
- 저장 목록 항목에 `sid`(네이버 장소 ID), `memo`, `mcidName`(대분류), `creationTime`, `px`/`py`가 있다.
- 길찾기 API(`map.naver.com/p/api/directions/car`)는 `route.<옵션>[0]`에 `summary`(`distance`, `duration`, `staticDuration`, `tollFare`, `fuelPrice`)와 `path`(좌표 배열, 6.7km 구간에 282점)를 준다. 자동차 경로만 확인됨.

### 1.7 범위 밖 (PoC)

- 로그인, 서버 DB, 실시간 동시 편집
- 앱 안에서 새 장소 검색·추가 (정적 앱이라 지오코딩 불가. 네이버에 저장 후 collect 재실행)
- 자동차 이외 이동수단의 실경로 (직선 + "경로 미계산" 표시)
- 현장 모바일 모드(현재 위치, 다음 장소, 방문 체크)
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
   → 경로 단순화 → TripData 검증 → public/data/<publicId>.json
        │  git push
        ▼
③ Cloudflare Pages 빌드·배포 → https://<도메인>/t/<publicId>
        │
        ▼
④ 앱: TripData(읽기 전용) ⊕ EditLayer(localStorage) = 화면
   내보내기/가져오기 = EditLayer만 주고받음
```

- 파이프라인은 로컬에서만 실행한다. 이유: 빌드 서버 IP에서 비공식 API가 막힐 수 있고, 길찾기 결과는 조회 시점 교통에 따라 달라지므로 결과 JSON을 커밋해 고정한다.
- `publicId`는 첫 collect 때 생성해 yaml에 기록하므로 재수집해도 URL이 유지된다.

### 2.2 기술 스택

rule_system_fe 기준에서 이 앱에 필요한 것만 가져온다.

| 영역 | 선택 |
|---|---|
| 기본 | React 19, Vite, TypeScript, React Compiler |
| UI | MUI 7 + Emotion (테마는 최소한으로 새로 작성) |
| 상태 | Jotai (`atomWithStorage`로 EditLayer 영속화), 라우트 단위 `Provider` |
| 스키마 | Zod — 파이프라인·앱·가져오기가 공유하는 유일한 데이터 정의 |
| 기타 | react-router 7, dnd-kit, dayjs, es-toolkit, unplugin-icons, sonner, lz-string, supercluster |
| 파이프라인 | tsx, yaml(Document API) |
| 테스트 | Vitest, React Testing Library, Playwright |
| 품질 | ESLint flat config, Prettier, husky + lint-staged |
| 패키지 | Yarn, Node ≥ 22 |

제외: Effect, bunshi, OpenTelemetry, 인증, handsontable, tiptap, MCP, openapi-ts, Docker/nginx, mkcert, patch-package, MSW.

### 2.3 디렉터리 구조

```
trip-map/
├── src/
│   ├── schema/          # Zod: TripSource, TripData, EditLayer
│   ├── models/          # Trip, Place 도메인 클래스 (naverUrl, day 합계 등 파생값)
│   ├── repositories/    # trip-repo (fetch + 검증), edit-layer-repo (저장·내보내기·가져오기)
│   ├── domain/          # 순수 함수: overlay, merge, reconcile, leg-index
│   ├── sections/
│   │   ├── explore/{store,type,view}
│   │   └── itinerary/{store,type,view}
│   ├── components/map/  # MapAdapter 인터페이스, NaverMapAdapter, FakeMapAdapter, 마커·폴리라인
│   ├── routes/          # paths.ts 등
│   ├── theme/
│   └── layouts/
├── pipeline/            # collect CLI (src/schema 재사용)
├── trips/               # *.yaml (원본)
├── public/
│   ├── data/            # <publicId>.json (생성물, 커밋)
│   └── _headers
├── tests/{unit,e2e,fixtures}/
└── docs/
```

- 파일 이름: 컴포넌트는 PascalCase, 그 외는 kebab-case (rule_system_fe 컨벤션).
- `src/domain/`은 React·브라우저 API에 의존하지 않는다. 테스트의 중심이다.

## 3. 데이터 모델

모든 스키마는 `src/schema/`에 Zod로 정의하고 `schemaVersion: 1`로 시작한다.

### 3.1 TripSource (`trips/*.yaml`)

```yaml
publicId: k3f9x2a7q1          # 없으면 collect가 생성해 기록
title: 강릉 2박3일
startDate: 2026-11-14
endDate: 2026-11-16
folders:                      # 네이버 공유 폴더 shareId
  - 72815c89a7b241558581a0d907f133c1
  - 99f1043b371b42c893b32fd55de340e6
customPlaces:                 # 네이버 폴더에 없는 곳
  - { key: home, name: 집, lng: 126.9575, lat: 37.4776 }
days:
  - date: 2026-11-14
    stops:
      - { place: home }
      - { place: "12028621", time: "12:00", note: 점심 }
```

- `place`는 네이버 `sid`(숫자 문자열) 또는 `customPlaces[].key`.
- `publicId`: 영숫자 소문자 10자 이상, 무작위.
- `days[].date`는 `startDate`~`endDate` 안에 있어야 한다.

### 3.2 TripData (`public/data/<publicId>.json`, 읽기 전용)

```
TripData {
  schemaVersion: 1
  publicId, title, startDate, endDate
  dataVersion: ISO 시각 (collect 실행 시각)
  folders: [{ shareId, name, count }]
  places: Record<PlaceKey, Place>
  days: [Day]
}
PlaceKey = "n:<sid>" | "c:<customKey>"
Place { name, address, lng, lat, category (mcidName, custom은 null),
        naverMemo, folderIds: shareId[], savedAt (custom은 null), sid? }
Day   { date, stops: [Stop], legs: [Leg] }
Stop  { placeKey, time?: "HH:mm", note? }
Leg   { from: PlaceKey, to: PlaceKey, status: "routed" | "failed",
        distanceM, durationMs, staticDurationMs, tollFare,
        path: [lng, lat][], queriedAt }
```

- 여러 폴더에 같은 `sid`가 있으면 Place 하나로 합치고 `folderIds`에 모두 남긴다.
- `legs`는 `stops`의 연속 쌍마다 하나. `status: "failed"`이면 `path`는 두 점(직선), 수치는 직선거리 기준 거리만 채우고 시간은 0.
- `path`는 Douglas-Peucker로 약 5m 허용 오차로 단순화한다.

### 3.3 EditLayer (localStorage, 내보내기·가져오기 단위)

```
EditLayer {
  schemaVersion: 1
  publicId
  baseDataVersion            # 마지막으로 정리(reconcile)한 TripData.dataVersion
  author                     # 첫 편집 시 입력하는 닉네임
  places: Record<PlaceKey, PlaceEdit>
  days: Record<date, DayEdit>
}
PlaceEdit { memos: Record<author, { text, updatedAt }>,
            tags: string[], hidden: boolean, updatedAt }   # updatedAt은 tags/hidden 기준
DayEdit   { stops: [Stop], baseDayHash, updatedAt }
```

- `days[date]`가 없으면 원본 일정을 따르고, 있으면 그날 일정 전체를 대체한다.
- `baseDayHash`: 편집을 시작할 때 그날 원본 `stops`의 해시.
- 원본(TripData)은 절대 수정하지 않는다. 화면은 항상 `overlay(TripData, EditLayer)`로 계산한다.

### 3.4 travel_map 개념의 대응

- 필터 축 = 카테고리(`mcidName`) + 소속 폴더 + 사용자 태그(EditLayer).
- 테마별 카테고리 정의는 PoC 범위 밖.

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
- 장소 카드: 이름, 카테고리, 주소, 소속 폴더, 네이버 메모, 작성자별 메모(내 것만 편집), 태그, 숨기기, `[일정에 추가 → Day 선택]`, `[네이버에서 열기]`(`https://m.place.naver.com/place/<sid>`; custom 장소는 숨김).

### 4.4 일정 모드

- Day 탭: 전체 / Day1 / Day2 / …
- 지도: 선택한 날의 실경로 폴리라인 + 순서 번호 마커. "전체"는 날짜별 색. 재계산 필요 구간은 직선 점선.
- 후보 레이어 토글: 일정에 없는 저장 장소를 흐린 마커로 표시, 탭하면 그날에 추가.
- 타임라인: 장소 행 사이에 구간 행(시간·거리·통행료 또는 "직선 n km · 재계산 필요"). Day 합계(총 시간·거리·통행료) 표시.
- 편집: 같은 날 안에서 드래그로 순서 변경, `⋯` 메뉴로 다른 날 이동·빼기, 시간·메모 인라인 편집, `[원본 일정으로 되돌리기]`(그날 DayEdit 삭제).

### 4.5 공통

- 첫 편집 시 닉네임 입력 대화상자.
- `dataVersion` 변경 시 정리 결과 배너 (5.5 참조).

## 5. 편집·병합·내보내기

### 5.1 저장

- 키: `tripmap:edit:<publicId>`. 편집 즉시 저장.
- 읽기 실패(파싱/검증) 시 원본 문자열을 `tripmap:edit:<publicId>:corrupt:<epoch>`로 백업하고 빈 레이어로 시작, 토스트 안내.
- `schemaVersion`이 낮으면 마이그레이션 함수 체인을 적용한다(PoC에서는 v1만 존재).

### 5.2 내보내기

1. 링크(기본): `/t/<publicId>#e=<lz-string 압축 EditLayer>`를 클립보드에 복사. 프래그먼트는 서버로 전송되지 않는다. 링크 길이가 8,000자를 넘으면 파일 내보내기를 안내한다.
2. 파일: `<제목>-<author>-<YYYYMMDD>.tripedit.json`.

### 5.3 가져오기

1. `#e=` 링크 진입 또는 파일 선택.
2. 압축 해제 → Zod 검증. 실패 시 에러 토스트, 아무것도 바꾸지 않음.
3. `publicId` 불일치 시 거부.
4. 미리보기: 메모 추가/변경 수, 태그·숨김 변경 수, Day 변경 목록과 충돌 표시.
5. 확인 시 병합, `history.replaceState`로 `#e` 제거. 취소 시에도 `#e` 제거.

### 5.4 병합 규칙 (`merge(local, incoming)`)

- 메모: `memos`를 author 키로 합집합. 같은 author는 `updatedAt`이 큰 쪽.
- 태그·숨김: PlaceEdit 단위 LWW (`updatedAt`이 큰 쪽의 `tags`, `hidden`).
- Day: 한쪽에만 있으면 그대로 채택. 양쪽에 있고 `stops`가 같으면 그대로. 다르면 **충돌** — 미리보기에서 사용자가 "내 것/받은 것" 선택, 기본값은 `updatedAt`이 큰 쪽.
- `updatedAt`이 같으면 JSON 직렬화 문자열을 사전순 비교해 큰 쪽을 택한다(결정적 타이브레이크).
- `author`, `baseDataVersion`은 local 값을 유지한다.
- 성질: 같은 입력을 두 번 병합해도 결과가 같다(멱등). 충돌 선택을 기본값으로 둘 때 메모·태그·숨김 결과는 병합 순서와 무관하다.

### 5.5 원본 재빌드 시 정리 (`reconcile(tripData, editLayer)`)

`editLayer.baseDataVersion !== tripData.dataVersion`일 때 앱 로드 시 실행한다.

- 원본에 없는 PlaceKey의 PlaceEdit: 삭제하지 않고 유지("고아"). 배너에 개수 표시, 내보내기에 포함.
- DayEdit 안의 사라진 PlaceKey: 해당 stop 제거 후 알림.
- 원본 그날 `stops` 해시 ≠ `baseDayHash`: 배너 "Day n 원본이 바뀌었어요 `[원본 보기]` `[내 편집 유지]`". `[원본 보기]`는 DayEdit 삭제, `[내 편집 유지]`는 `baseDayHash`를 새 값으로 갱신.
- 원본에 없는 날짜의 DayEdit: 유지하되 화면에는 표시하지 않고 배너로 알림.
- 완료 후 `baseDataVersion = tripData.dataVersion`.

### 5.6 편집한 날의 구간 (`leg-index`)

- TripData의 모든 Leg를 `from→to` 키로 색인(날짜 무관, 방향 구분).
- 실효 stops의 연속 쌍마다 색인에서 찾으면 그 Leg를 재사용, 없으면 직선 Leg(`status: "unrouted"`, 화면용)를 만든다.

## 6. 에러 처리

| 상황 | 동작 |
|---|---|
| TripData 404 | "링크가 잘못되었거나 만료된 여행입니다" |
| TripData 검증 실패 | 에러 화면에 `schemaVersion`과 첫 검증 오류 표시 |
| 네이버 지도 SDK 로드 실패 | 지도 숨기고 목록 전용 모드, 원인 안내(도메인 미등록 가능성) |
| localStorage 사용 불가 | 열람 가능, 편집 시 "이 브라우저에서는 저장되지 않아요. 내보내기를 이용하세요" |
| 가져오기 데이터 손상·불일치 | 토스트로 사유 표시, 상태 변경 없음 |

## 7. 파이프라인 (`yarn collect <yaml> [--refresh-routes]`)

1. yaml 로드 → `TripSource` 검증. `publicId` 없으면 생성해 Document API로 주석을 보존하며 기록.
2. 폴더를 순차 조회: `start=0&limit=500`, `count`가 500을 넘으면 `start`를 늘려 반복, 요청 간 300ms 대기. 헤더는 `User-Agent`와 `Referer: https://pages.map.naver.com/save-pages/detail-list/<shareId>`, `Origin` 없음.
3. `sid` 기준 병합 → `places` 구성. `available: false` 항목은 제외하고 개수를 보고.
4. stop 연결: 찾지 못한 `place`는 목록을 출력하고 종료 코드 1.
5. 구간: `.cache/routes/<from>__<to>.json`(gitignore) 캐시 우선. 없거나 `--refresh-routes`면 API 호출(순차, 300ms 대기). 실패 시 `status: "failed"`.
6. 경로 단순화 → `TripData` 검증 → `public/data/<publicId>.json` 기록.
7. 요약 출력: 폴더별 장소 수, 제외 수, Day별 거리·시간·통행료, 실패 구간.

## 8. 테스트

- 단위(Vitest)
  - `domain/merge`: 표 기반 — 멱등성, author별 메모 합집합, LWW, Day 충돌 감지.
  - `domain/overlay`, `domain/leg-index`, `domain/reconcile`.
  - `pipeline`: sid 병합, stop 연결 실패, 페이지네이션, 경로 단순화. **녹화한 실제 API 응답 fixture**(`tests/fixtures/`)만 사용, 네트워크 호출 없음.
  - `schema`: fixture TripData/EditLayer가 통과하는지.
- 컴포넌트(RTL): 타임라인 재정렬 → EditLayer 갱신, 가져오기 미리보기 표시.
- E2E(Playwright, `VITE_MAP_ADAPTER=fake`, fixture TripData): 메모 작성 → 링크 내보내기 → 새 브라우저 컨텍스트에서 열기 → 가져오기 → 병합 결과 확인.
- 수동: 배포 후 실제 네이버 지도로 1회 확인.

## 9. 배포

- Cloudflare Pages ← 비공개 GitHub repo. 빌드 `yarn build`, 출력 `dist`. SPA 라우팅은 Pages 기본 동작(404.html 없음 → index.html) 사용.
- `public/_headers`:
  - `/*` → `X-Robots-Tag: noindex`
  - `/data/*` → `Cache-Control: public, max-age=60`
- 환경변수 `VITE_NAVER_MAP_CLIENT_ID`. NCP 콘솔에 Pages 도메인과 `http://localhost:5173` 등록. NCP Maps 요금·무료 사용량은 **확인 필요**.
- GitHub Actions: lint, typecheck, test, `public/data/*.json` 스키마 검증. 배포는 Cloudflare가 수행.

## 10. 위험

| 위험 | 대응 |
|---|---|
| 네이버 비공식 API 변경·차단 | 로컬 수집 + 결과 커밋으로 앱은 영향 없음. 파이프라인 클라이언트를 한 파일로 격리 |
| 공유 링크 유출 | 추측 불가 ID, `noindex`, 루트 목록 미노출. 민감 정보(집 좌표 등)는 customPlaces 사용 시 주의 |
| localStorage 유실(브라우저 정리) | 내보내기 안내, 정리 배너에서 내보내기 유도 |
