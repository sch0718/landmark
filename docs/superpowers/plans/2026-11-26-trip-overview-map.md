# 여행 계획 화면 「전체」 보기(오버뷰 지도)

사용자 요청: 여행의 모든 Day 장소를 한 지도에서 보고, 핀을 눌러 상세를 보고 보관함 장소 메모(Stop의 일정 메모 `note`와 다름)를 바로 고친다.

이미 있는 것으로 안 되는 이유: 계획 화면 지도(`TripMap`)는 고른 Day만 번호 핀으로 보이고 다른 Day는 글자 없는 흐린 점이며, 지도 맞춤도 고른 Day 기준이다. 당일 모드(`today/`)는 오늘 하루, 공유 지도(`src/share-map`)는 읽기 전용이다. 메모는 `상세`에 들어가야만 고친다.

범위: 화면만. 저장 형식·동기화·공유 형식·경로 계산·지도 어댑터는 바꾸지 않는다.

## 결정(작은 쪽)

- **상태:** `src/stores/trip-planner.ts`에 `overviewAtom: Record<tripId, boolean>`(화면 상태, 저장 안 함)을 둔다. `TripPlannerPage.tsx`에 `useSelectedDay`와 같은 모양의 `useOverview(trip)`를 두고, 계획 화면에서 Day를 고르는 `selectDay`와 당일 모드에서 보던 Day를 계획 화면에 넘기는 `selectPlannerDayAtom`은 모두 해당 여행의 전체 보기를 끈다. `Day 자동 나누기` 미리보기를 시작하면(`CandidatePanel`의 시작 동작) 그 여행의 전체 보기를 끄고 Day 보기로 돌아간다(전체 보기에서 미리보기 핀을 따로 그리지 않는다). `selectedDayAtom`의 값 뜻(0부터 Day 번호)은 그대로 둔다.
- **지도 핀:** `tripMapLayers`에 `overview` 인자(기본 `false`)를 더한다. 켜면
  - 모든 Day의 보이는 Stop을 Day 색 핀으로, 글자는 `D{Day}·{순번} {이름}`(예 `D1·2 중앙시장 닭강정`).
  - 장소 id마다 핀 하나만 둔다. 모든 Day의 보이는 Stop을 먼저 넣고, 여행 출발지 `🏠 이름`, Day 순서대로 숙소 `🛏 이름`(해당 Day 색, 검정 테두리)을 넣는다. Stop이 출발지나 숙소이기도 하면 Stop 핀을 남긴다(카드 `where`와 같은 우선순위). 여러 Day의 숙소로 반복되는 장소는 가장 이른 Day의 색이다.
  - 후보 핀·흐린 점·경로선은 그리지 않는다(경로선 없음). 모든 핀이 지도 맞춤 대상이다.
  - `TripMap`은 `fitKey`를 `${trip.id}:all`로 바꿔 모든 장소에 맞추고, 전체 보기에서는 `다른 Day 장소` 단추를 숨긴다.
- **탭:** `DayTabs`(가로·세로 모두) 맨 앞에 `전체` 탭(값 `'all'`, 끌어 놓기 대상 아님)을 둔다. 휴대폰 시트(`PlannerSheet.tsx`)는 탭 줄이 좁으므로 `Day 목록`(▾) 메뉴 맨 위에 `전체`를 둔다.
  - 시트의 `tab` 상태는 `'candidates' | 'day'`를 유지한다. 메뉴에서 `전체`를 고르면 `tab`을 `'day'`로 바꾸고 전체 보기를 켠다.
  - 전체 보기 중 두 번째 탭은 일반 `Tab`(값 `'all'`, 이름 `전체`, 끌어 놓기 대상 아님)이다. 이 탭을 선택하면 아래에서 정의하는 `OverviewList`를 표시한다. `후보` 탭으로 전환하면 후보 칸을 표시하고 지도는 전체 보기를 유지한다.
  - 메뉴에서 Day를 고르면 `tab`을 `'day'`로 바꾸고 `selectDay`로 전체 보기를 끈다. 두 번째 탭은 고른 Day의 `DropTab`으로 돌아가고 패널에는 그 Day의 시간표를 표시한다.
- **시간표 자리:** 전체 보기일 때 시간표 대신 짧은 Day별 장소 목록(`OverviewList`, 새 파일 하나)을 보인다: Day마다 `Day N 날짜` 머리와 순서대로 장소 이름(번호), 숙소 한 줄. 행을 누르면 그 장소 카드를 연다(`mapCardAtom`). 끌기·시간 계산 없음. 기존 시간표를 그대로 두면 `전체` 탭이 골라진 채 한 Day 시간표가 보여 헷갈리기 때문이다.
- **카드:** `MapCard`에 `overview` prop을 더한다. 켜면 이름·분류·위치(`Day N · M번째`/`숙소`/`출발지`)와 `MemoEditor`(`src/sections/place/MemoEditor.tsx`, 저장은 `PlaceDetail`과 같은 `run((lib, ctx) => setPlaceMemo(lib, id, text, ctx))`), `상세` 버튼만 둔다. 체류·고정 시각·영업시간·다른 Day로·후보로 빼기·숙소로 정하기는 뺀다. 후보 카드는 위치 `후보`와 메모·`상세`만. 카드는 화면을 넘지 않게 `maxHeight`와 세로 스크롤을 둔다. 전체 보기에서 상세가 열려 있는 동안(`detailId !== null`)은 카드를 그리지 않는다(상세도 같은 장소의 `MemoEditor`를 열기 때문). 카드가 빠질 때 `MemoEditor`가 바로 저장하고 남은 초안은 `memoDraftsAtom`으로 상세가 이어받는다. `mapCardAtom`은 그대로라 상세에서 돌아오면 카드가 다시 보인다. Day 보기의 카드는 그대로다.

## 파일과 순서

1. `src/stores/trip-planner.ts`: `overviewAtom`을 추가하고, `selectPlannerDayAtom`이 Day를 설정할 때 해당 여행의 전체 보기도 끈다.
2. `src/sections/trips/planner/trip-map-layers.ts`: `overview` 인자와 주석.
3. `src/sections/trips/planner/TripMap.tsx`: `overview` prop, `fitKey`, 단추 숨김.
4. `src/sections/trips/planner/DayTimeline.tsx`: `DayTabs`에 `overview`·`onOverview` prop과 `전체` 탭.
5. `src/sections/trips/planner/OverviewList.tsx`(새 파일): Day별 장소 목록.
6. `src/sections/trips/planner/MapCard.tsx`: `overview` prop, 메모 편집.
7. `src/sections/trips/planner/PlannerSheet.tsx`: 메뉴의 `전체`, 전체일 때 탭·패널.
8. `src/sections/trips/planner/TripPlannerPage.tsx`: `useOverview`, 지도·카드·시간표 칸·시트에 넘김. 전체 보기에서 상세가 열리면 카드를 그리지 않음. 자동 나누기 시작 때 전체 보기 끄기(`CandidatePanel.tsx`의 시작 동작에서 `overviewAtom`을 끈다).
9. `scripts/motion/help-pages.mjs`의 여행(`id: 'trips'`) `tips`에 한 줄을 더한다(「Day 목록 맨 앞 `전체`로 모든 Day 장소를 한 지도에서 보고, 핀을 눌러 장소 메모를 바로 고쳐요.」). `yarn build:motion`으로 앱 도움말 `src/sections/help/help-content.ts`와 도움말 문서 `docs/help/trips.md`를 다시 만든다.

## 검증

- 단위 시험(겹치지 않게 두 개만):
  - `tests/unit/sections/trips/trip-map-layers.test.ts`: 전체 보기 핀 목록(모든 Day Stop의 `D·순번` 글자·Day 색, 숙소·출발지, 후보·점 없음, `fit` 없음)을 확인한다. 출발지나 숙소이기도 한 Stop은 Stop 핀 하나, 여러 Day 숙소인 장소는 가장 이른 Day 색 숙소 핀 하나인지 확인한다. 서로 다른 지점을 잇는 구간을 `legs`에 넣고, 같은 입력으로 Day 보기에는 경로선이 생기고 전체 보기의 `polylines`는 비어 있는지 확인한다.
  - `tests/unit/sections/trips/planner-map.test.tsx`(기존 픽스처 사용): 계획 화면에서 `전체` 탭을 누르고 Day별 장소 목록의 행을 눌러 해당 장소 카드를 연다. 카드에서 메모를 고쳐 저장한 뒤 보관함의 해당 장소 메모가 바뀌었는지 한 흐름으로 확인한다.
- `yarn typecheck && yarn lint && yarn test`, 마지막에 `yarn build:ci`(첫 로딩 예산 포함. 계획 화면은 지연 로딩 조각이라 영향이 작을 것으로 본다).
