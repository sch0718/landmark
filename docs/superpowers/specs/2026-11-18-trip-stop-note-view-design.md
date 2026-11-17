# 플래너에 일정 메모 보이기 — 설계·계획 (v0.37.1)

## 문제

일정 메모(`stop.note`, 최대 500자, `src/schema/trip.ts`)는 공유 일정 보기(`src/share-viewer/render-trip.ts`)에만 보인다. 앱 플래너에는 보이는 곳도 고치는 곳도 없다(`grep -rn note src/sections/trips` 확인: 영업시간 안내 `hours.note`와 충돌 창뿐). AI CLI로 넣은 메모(「가는 길: RER B 한 번에」)를 앱에서 볼 수 없다.

이미 있는 것으로 안 되는 이유: 지도 위 장소 카드(`MapCard`)와 행 메뉴(`StopMenu`)에도 메모가 없다.

## 범위

- 한다: 플래너 장소 행(`DayTimeline.tsx`의 `StopRow`)에 메모가 있으면 보여 준다.
- 안 한다: 메모 편집, 공유 페이지, 동기화, 당일 모드(`오늘 일정`), 지도 카드.

## 설계

- 위치: 행의 이름·체류·영업시간 안내 아래. 지금 그 내용은 `<button>`(누르면 지도 카드) 안에 있다. 버튼 안에는 대화형 요소를 둘 수 없으므로, 버튼과 메모를 세로로 묶는 `Box`(`flex: 1, minWidth: 0`)를 만들고 메모는 버튼 **다음 형제**로 둔다. 버튼의 `flex: 1`은 그 묶음으로 옮긴다.
- 요소: 표준 `<details>`(Baseline Widely available, Modern Web Guidance `search-hidden-content`가 권함). 별도 상태·JS 없음.
  - `<summary>`에 메모 전문을 넣는다. 닫혀 있으면 CSS로 2줄까지 줄인다(`display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden`). 열리면(`details[open] > summary`) 줄이지 않고 `white-space: pre-wrap`으로 줄바꿈을 살린다. 본문은 비운다.
  - 기본 표시 삼각형은 숨긴다(`list-style: none`, `::-webkit-details-marker { display: none }` — iOS Safari).
  - 짧은 메모도 같은 요소를 쓴다(넘침 감지 JS를 두지 않는다). 눌러도 모양이 같을 뿐이다.
  - 글자: 12~13px, `var(--tm-text-secondary)`, `overflowWrap: 'anywhere'`. 누를 자리 높이는 메모 2줄 정도로 충분하다(행 전체 `minHeight: 44` 유지).
- 메모 앞에 접근성 이름을 위해 눈에 안 보이는 접두어를 따로 두지 않는다. 메모 글이 곧 요약 이름이다.
- 빈 문자열(`''`)이면 아무것도 그리지 않는다. 공백만 있는 메모는 `trim()` 뒤 비면 그리지 않는다.

## 계획

1. `src/sections/trips/planner/DayTimeline.tsx` — `StopRow`에 위 구조와 `StopNote`(같은 파일 안 작은 함수 컴포넌트) 추가.
2. `tests/unit/sections/trips/planner-timeline.test.tsx` — 시험 하나: 메모가 있는 정류장 행에 메모 글이 `<summary>` 안에 보이고 그 `<summary>`는 지도 카드 `<button>` 밖에 있다. 메모가 없는(`''`) 행에는 `<details>`가 없다. 기존 픽스처(`plannerLibrary`, `makeTrip`, `stopRow`)를 쓴다. 공백만 있는 메모는 시험하지 않는다(한 줄 `trim()`).
3. 도움말 한 줄: 원본 `scripts/motion/help-pages.mjs`의 `trips.tips`(「장소나 마커를 누르면…」 다음)에 「장소에 적힌 일정 메모는 이름 아래 보여요. 길면 눌러서 펼쳐요.」를 더하고 `yarn build:motion`으로 `docs/help/trips.md`·`src/sections/help/help-content.ts`를 다시 만든다. 생성 파일을 손으로 고치지 않는다. 다른 생성물(svg 등)이 바뀌면 그대로 둔다(문구만 바뀌므로 바뀌지 않아야 한다).

## 검증

- `yarn vitest run tests/unit/sections/trips/planner-timeline.test.tsx`, 이어서 `yarn build:ci`(legacy-scan 새 후보 없음, 첫 로딩 예산 안).
- 눈으로 볼 것(통합 세션): 휴대폰(iOS Safari)에서 2줄 줄임과 펼침, 삼각형이 안 보이는지, 행 끌기·메뉴가 그대로인지.
