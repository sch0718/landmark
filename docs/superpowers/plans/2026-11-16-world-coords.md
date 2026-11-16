# 해외 좌표 허용 — 설계·계획

12/19 출발 해외 여행(파리·포르투·세비야·바르셀로나)에 랜드마크를 쓰기 위한 1단계 중 한 조각이다. 작은 작업이라 설계와 계획을 이 문서 하나로 쓴다.

## 전제와 결정

- 운영자 1명·소수 지인·Cloudflare 무료. 판단이 갈리면 작은 쪽을 고른다.
- 사용자 결정(2026-11-16): 해외 장소는 **구글맵 링크 붙여넣기**로만 넣는다(구글 Places API 안 씀). 해외 이동은 **직선 + 「구글맵에서 길찾기」 링크**(구글 Routes API 안 씀). 지도 선택(네이버/구글)은 다른 세션이 맡는다.
- 이미 있는 것으로 안 되는 이유: 좌표 스키마(`Lng` 124~132, `Lat` 33~39)가 한국 밖을 거부해 구글맵 링크로 찾은 파리 장소도 보관함에 못 넣는다.
- 데이터·공유 파일 형식은 그대로 둔다(새 필드·새 상태 값·버전 올림 없음). 범위만 넓힌다.
- 시간대, 구글 API, 지도 표시·설정은 범위 밖.

## 설계

### 1. 좌표 범위와 한국 판정

- `src/schema/common.ts`: `Lng` -180~180, `Lat` -90~90. 이 스키마를 쓰는 보관함·공유 문서·옛 여행·약속·CLI 계획(`pipeline/agent-trip/plan-schema.ts`의 장소 `lng`·`lat`)·네이버 폴더 가져오기(`pipeline/build-places.ts`)가 함께 넓어진다. CLI의 `search.near`는 아래처럼 한국 범위를 유지한다.
- `pipeline/agent-trip/plan-schema.ts`의 `search.near`는 공용 `Lng`·`Lat`에서 분리해 유한한 경도 124~132·위도 33~39(경계 포함)의 튜플로 검사한다. `parsePlan`에서 한국 밖 검색 중심을 입력 오류로 거절하며, `planJsonSchema`에도 같은 범위를 낸다. `pipeline/agent-trip/resolve-places.ts`는 `parseSearchQuery`를 거치지 않고 `searchNaverPlaces`를 직접 부르므로, 서버의 `parseCoordinate`만 유지해서는 CLI 검색 입력을 제한할 수 없다. `near` 생략 시 기존 서울시청 기본 좌표는 그대로 쓴다.
- 새 파일 `src/lib/korea.ts`: `isInKorea(lng, lat)`(경도 124~132, 위도 33~39 사각형, 유한하지 않으면 false)와 `isAbroadLeg(from, to)`(둘 중 하나라도 한국 밖). import 없는 순수 함수라 서버 함수·CLI·공유 뷰어가 함께 쓴다. 드문 경계(대마도 등)는 신경 쓰지 않는다.
- 네이버만 부르는 곳은 한국 범위를 그대로 지키되 `isInKorea`로 바꾼다(동작 같음):
  - `src/server/route.ts` `parseCoordinate`(경로·HTTP 검색 `near` 입력 검사)
  - `src/server/search.ts` 네이버 결과 거르기, `src/services/place-search.ts` 응답 검사
  - `src/sections/meetings/MapPickOverlay.tsx` 약속 출발지 조준(지도 조준은 기존대로 한국만)
- 공유 뷰어 `src/share-viewer/parse.ts`의 `inKorea`는 전 세계 범위(유한, |경도|≤180, |위도|≤90)로 바꾼다(스키마와 같은 범위 유지).
- CLI `resolve-places.ts`의 범위 오류 문구를 「경도 -180~180, 위도 -90~90」으로 바꾼다.
- 약속(meeting)의 출발지·후보 스키마도 공용 `Lng`·`Lat`라 함께 넓어진다. 약속을 해외용으로 고치는 일은 하지 않으며, 기존 입력·계산 흐름에 미치는 영향은 다음과 같다.
  - 지도 조준·네이버 검색은 한국 범위를 유지하지만, `src/sections/meetings/OriginPicker.tsx`의 「보관함에서」는 `src/schema/meeting.ts`의 `OriginSchema`로만 검사하므로 범위 확장 뒤에는 해외 장소도 참석자 출발지로 고를 수 있다. 후보 선택은 `src/sections/meetings/NearbyPlaces.tsx`의 기존 역 반경 1km 조건을 그대로 쓴다.
  - `src/sections/meetings/use-meeting-compute.ts`의 `transit`·`car`는 경로 서비스를 쓴다. 출발지나 후보가 한국 밖인 구간을 서버에 조회하면 `src/server/route.ts`의 `parseCoordinate`가 `BAD_REQUEST`로 거절한다. 이 오류는 `src/sections/meetings/TimeCells.tsx`에서 「출발지와 조건을 확인해 주세요」로 보인다.
  - `straight`는 서버 조회 없이 `haversineM`으로 직선거리(m, 반올림)를 계산하므로 해외 출발지도 거리 계산에 포함된다. 이 작업에서 약속에 해외 구간용 구글 길찾기 링크를 추가하지는 않는다.

### 2. 해외 처리

- **검색**: 앱의 네이버 검색은 약속 출발지 고르기에만 쓰여 해외 검색 흐름이 없다. CLI `resolve-places.ts`의 `search` 결과가 없을 때 문구에 「해외 장소는 link에 구글맵 링크를 넣어 주세요」를 덧붙인다. 장소 추가 창의 링크 안내는 이미 구글 링크를 받는다고 적혀 있으므로 도움말만 보탠다.
- **경로(앱 계획 화면)** `src/sections/trips/planner/use-day-plan.ts`:
  - 해외 구간(`isAbroadLeg`)은 요청 목록(`requestKeys`)에서 빼서 네이버 경로를 부르지 않는다. `다시 계산`·`다시 시도`도 건너뛴다.
  - `planLeg`: 해외 구간은 새 화면 상태 `'abroad'`. 시간 `{ durationS: 0, distanceM: 직선거리(m, 반올림), tollFare: null, estimated: true }`, 경로선은 직선. 이동 시간을 추정하지 않으므로 일정 도착 시각에는 이동 시간이 0으로 들어가고, `estimated: true`라 Day 합계는 기존처럼 어림값 표시가 붙는다.
  - `PlannedLeg.status`에 `'abroad'`를 더한다(화면 상태일 뿐 저장·공유 형식이 아니다).
- **구간 행** `LegRow.tsx`: 해외 구간은 `시간 · 거리` 대신 `직선 N km`와 `이동 시간은 구글맵에서 확인`을 보이고, `네이버 지도로 길찾기` 대신 `구글맵에서 길찾기` 링크(새 탭)를 둔다.
- **구글 길찾기 주소** `src/sections/trips/planner/naver-directions.ts`에 `googleDirectionsUrl(leg)` 추가: `https://www.google.com/maps/dir/?api=1&origin=<lat>,<lng>&destination=<lat>,<lng>&travelmode=<driving|walking|transit>`. 좌표가 유효하지 않으면 null.
- **당일 화면 길찾기** `src/sections/trips/today/today-directions.ts`의 `todayDirections`: `directionsFrom`이 정한 실제 출발점(`origin.from`: 쓸 수 있는 내 위치 → 앞 지점)과 도착 장소(`to`)로 `isAbroadLeg`를 판정한다. 계획 구간의 상태·좌표로 대신 판정하지 않는다. 해외면 `googleDirectionsUrl`, 국내면 기존 `naverDirectionsUrl`로 분기한다. 수단은 기존대로 계획 구간이 있으면 그 수단, 내 위치 등 구간이 없으면 실제 출발점부터 도착까지의 `autoMode`를 쓴다. 출발점이 없거나 좌표가 유효하지 않으면 기존처럼 null. 해외는 app/web 모두 구글 HTTPS 주소를 쓰며, 이를 쓰는 `src/sections/trips/today/NextCard.tsx`는 기존 HTTPS 링크 처리로 새 탭을 연다.
- **일정 공유(앱)** `src/sections/share-export/use-trip-legs.ts`: 해외 구간은 공유 문서에 기존 상태 값 `'estimated'`, `durationS: 0`, `distanceM: 직선거리`, `path: []`로 넣는다(새 상태 값 없음).
  - 이 훅도 구간 키를 따로 요청하므로(`requestKeys` → `requestLegs`, `useOnlineRetry`) 해외 구간을 `requestKeys`에서 뺀다. 넣으면 `parseRouteInputKey`의 한국 범위 검사가 예외를 던진다.
  - 집계: 해외 구간은 조회 상태가 없어도 `answered`에 센다. 그래야 「이동 경로를 받는 중」이 끝난다. `estimated`에는 세지 않는다(상태 줄 「N구간은 경로를 받지 못해 어림값으로 들어가요」가 일부러 조회하지 않은 해외 구간에 붙지 않게). `total`은 그대로 모든 구간이고, `answered` 주석도 함께 고친다.
- **공유 뷰어** `src/share-viewer/render-trip.ts`: 두 장소 좌표로 해외 구간을 판정해(형식 변경 없이) `수단 직선 N km · 이동 시간은 구글맵에서 확인`을 보이고 길찾기 링크를 구글 주소로 바꾼다.
- **CLI 경로** `pipeline/agent-trip/route-legs.ts`: 해외 구간은 조회를 건너뛰고 경고 없이 `status: 'estimated'`, `durationS: 0`, `distanceM: 직선거리`, `path: []`. 통계는 `estimated`로 센다.
- **역지오코딩** `src/services/reverse-geocoder.ts`: `reverse`가 해외 좌표면 네이버 SDK를 부르지 않고 null(주소 빈칸 → 기존 「주소를 찾지 못했어요. 직접 입력해 주세요」). 구글 링크 결과의 주소 채우기와 핀 추가가 모두 이 경로를 탄다.

### 3. 시험(겹치지 않게 한 층씩)

- `isInKorea`·`isAbroadLeg`·`googleDirectionsUrl` 단위 시험.
- 스키마: 기존 장소 좌표 범위 경계 시험(`trip-source.test.ts`, `plan-schema.test.ts`, `meeting.test.ts`, `online-doc.test.ts`)을 새 범위(-180/180, -90/90 통과, 180.01·90.01 거부)로 고치고, 보관함 장소에 파리(2.2945, 48.8584) 통과 한 건. `search.near`의 기존 한국 범위 거부 시험은 유지하고 경계 통과 및 `planJsonSchema`의 한국 범위를 확인한다. `tests/unit/pipeline/agent-trip/resolve-places.test.ts`에서 해외 `search.near`가 든 계획은 `parsePlan`에서 거절되어 `resolvePlaces`의 검색 요청(fetch)이 호출되지 않는 시험 1건을 더한다.
  - 기존 오류 사례도 함께 고친다: `tests/unit/domain/meeting/ops.test.ts`, `tests/unit/domain/meeting/link.test.ts`, `tests/unit/server/meet-handlers.test.ts`, `tests/unit/services/meet-online-store.test.ts`, `tests/unit/sections/meetings/meet-drafts.test.ts`의 경도 0·140이나 좌표 (0, 0)은 새 범위에서 유효하므로, 경도 180.01 또는 위도 90.01처럼 전 세계 범위 밖 좌표로 바꿔 입력 거부·손상 기록 제외 검증을 유지한다.
- CLI 장소 조회(`tests/unit/pipeline/agent-trip/resolve-places.test.ts`):
  - 기존 한국 범위 밖 구글 좌표 네 사례는 링크 좌표로 성공하는 시험으로 바꾼다(대체 좌표를 쓰지 않음).
  - 전 세계 범위 밖 구글 좌표(±180.01·±90.01)는 `src/server/links.ts`에서 null이 되어 위치 없음 오류가 난다. CLI에서는 유효한 대체 이름·좌표가 있으면 핀으로 성공하고 `lookup-failed` 경고, 없으면 `lookup-failed` 오류(끝 코드 3)다. 이 사례를 `out-of-range` 시험으로 쓰지 않는다.
  - `checkCandidate`의 범위 거부는 기존 sid 조회 좌표 시험의 네이버 요약 응답을 전 세계 범위 밖 좌표로 바꿔 확인한다(대체 값이 있어도 `out-of-range`, 끝 코드 2).
- 경로: `use-day-plan`의 `planLeg` 해외 구간 시험 1건, 해외 구간이 요청되지 않는 시험 1건(가능하면 같은 파일). CLI `route-legs` 해외 구간이 조회·경고 없이 비는 시험 1건. `use-trip-legs`: 해외만 있는 일정과 국내·해외 섞인 일정에서 해외 구간을 요청하지 않고, 국내 답이 오면 받는 중 표시가 끝나는 시험 1건.
- 당일 길찾기: 기존 `tests/unit/sections/trips/today-directions.test.ts`에 실제 출발점·도착점 중 하나라도 해외면 app/web 모두 구글 주소, 둘 다 국내면 기존 네이버 주소인 경우를 더한다. `directionsFrom`에 현재 위치를 주는 경우도 연결해 시험한다(계획 구간은 국내지만 내 위치는 해외인 경우, 앞 지점은 해외지만 내 위치·도착은 국내인 경우). 구글 주소의 출발·도착 좌표와 수단(계획 구간 수단 유지, 내 위치에서는 `autoMode`) 및 출발점 없음·유효하지 않은 좌표의 null 반환도 확인한다.
- 역지오코딩: 해외 좌표면 주입한 `reverse` 함수를 부르지 않고 null을 돌려주는 시험 1건. `tests/unit/services/reverse-geocoder.test.ts`의 기존 실패·5초 타임아웃 시험은 (1, 2) 대신 한국 좌표 (126.9833092, 37.5494047)를 써서 원래 검증을 유지한다.
- 공유 가져오기: 파리 장소가 든 공유 문서가 `share-viewer/parse.ts`와 가져오기 검사를 통과하는 시험 1건.
- e2e: 새로 더하지 않는다(단위 시험으로 동작을 지키고, 지도 표시는 다른 세션 범위). 기존 e2e는 돌려 확인한다.

### 4. 도움말

`scripts/motion/help-pages.mjs`의 `add`·`trips` 팁에 한 줄씩 더하고 `yarn build:motion`으로 `docs/help/*.md`·`src/sections/help/help-content.ts`를 다시 만든다.

- 장소 추가: 「해외 장소는 구글맵에서 장소를 열어 공유한 링크를 붙여 넣어요. 주소가 비면 직접 적어요.」
- 여행: 「해외 구간은 경로를 조회하지 않고 직선으로 이어요. 이동 시간은 비워 두니 `구글맵에서 길찾기`로 확인해요.」

## 데이터 호환(rollback.md용 메모)

이 버전에서 저장한 해외 장소(경도·위도가 한국 사각형 밖)는 옛 버전이 읽으면 보관함 스키마 검사에 걸린다.

- 현재 코드(`v0.34.1`과 `src`·`tests`가 같다)에서 확인한 처리: `library-store.ts`의 `load`는 스키마 검사 실패 시 `failCorruptWithBackup`으로 원문 사본을 `tripmap:library:v2:corrupt-<시각>`에 남기고 `LibraryCorrupt`로 실패한다(사본을 못 쓰면 `backupKey: null`). 원본 키는 지우지 않는다. `ShellRoute.tsx`의 `CorruptBoundary`가 이를 받아 `CorruptScreen`을 보인다. `library-store.test.ts`에도 같은 계약이 있다. 즉 `docs/rollback.md`의 「손상 화면」 설명과 같고, `새로 시작`만 누르지 않으면 새 버전으로 돌아와 원래 데이터를 읽는다.
- 구현 뒤 확인: 해외 장소가 든 보관함을 `v0.34.1`로 열어 손상 화면이 뜨는지 한 번 보고, 결과를 이 절에 적는다. 그보다 옛 버전은 따로 확인하지 않는다.
- 2026-11-16 구현 뒤 확인: `v0.34.1` 태그의 소스를 임시 폴더에 꺼내 파리 장소가 든 보관함으로 `LibraryStore.load`를 실행했다. `LibraryCorrupt` 실패, 손상 사본 생성, 원본 키 보존을 확인했다. 손상 화면·오류 경계 코드도 해당 태그와 동일하다. 브라우저에서 손상 화면을 직접 보는 확인은 샌드박스가 개발 서버 포트 열기를 거부해(`listen EPERM ::1:5173`) 남아 있다.

## 구현 순서와 검증

1. `src/lib/korea.ts` + 시험 → `plan-schema.ts`의 `search.near`를 한국 범위 스키마로 분리 → `common.ts` 범위 → 한국 판정 자리 교체(서버·검색·약속 조준·뷰어 parse·CLI 문구).
2. `naver-directions.ts`에 `googleDirectionsUrl` → `use-day-plan.ts` → `LegRow.tsx` → `today-directions.ts`(당일 길찾기 분기) → `use-trip-legs.ts` → `render-trip.ts`.
3. `route-legs.ts`, `resolve-places.ts` 문구, `reverse-geocoder.ts`.
4. 시험 고치기·더하기 → 도움말 팁 → `yarn build:motion`.
5. 검증: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`, `yarn test:e2e:ci`(smoke).

건드리지 않는 파일: `src/components/map/*`, `src/sections/settings/*`, `src/services/prefs-store.ts`, `src/share-map/*`, `vitest.config.ts`, `src/vite-env.d.ts`, `docs/development.md`, `docs/rollback.md`.
