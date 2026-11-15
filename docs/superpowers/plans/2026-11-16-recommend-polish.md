# 추천 다듬기 (v0.34.0 후속) 설계·계획

v0.34.0(PR #109) 관리자 추천을 운영자가 써 보고 남긴 작은 점 3가지를 한 PR로 고친다. 전제는 운영자 1명 + 소수 사용자, Cloudflare 무료다. 서버 API·D1·저장 키 형식은 바꾸지 않고 화면만 고친다.

## 1. 핀으로 연 미리보기에서 고른 장소가 목록 아래에 묻힘

- 확인한 동작: `LibraryMap.tsx`가 ☆ 핀을 누르면 `focusPlaceId`를 넣어 `SharePreview`를 연다. `SharePreview`는 그 장소만 미리 고르지만 `SharePlaceRows`는 `doc.places` 순서대로 그리고 스크롤도 하지 않는다. 고른 장소가 목록 뒤쪽이면 스크롤해야 보인다.
- 고침: `SharePlaceRows`에 `focusPlaceId?: string`을 넘기고, 있으면 그 장소 행을 맨 앞에 그린다(나머지는 원래 순서). 스크롤 타이밍에 기대지 않고 열자마자 첫 행에 보인다. 가져오기 순서·선택 상태는 바뀌지 않는다(그리기 순서만).
- 파일: `src/sections/share-import/SharePlaceRows.tsx`, `src/sections/share-import/SharePreview.tsx`(prop 전달).

## 2. 추천 핀이 내 장소 묶음 숫자에 섞임

- 확인한 동작: `recommend-markers.ts`가 `clusterable: true`라 `buildClusterIndex`(`src/components/map/cluster.ts`)가 내 장소와 한 인덱스로 묶어 숫자를 센다.
- 고침: 추천 핀을 `clusterable: false`로 바꾼다. `cluster.ts`는 `clusterable: false`를 `fixed`로 늘 개별 표시하고, `NaverMapAdapter`(`cluster.fixed`)와 `FakeMapAdapter` 모두 이미 이 값을 쓴다(일정·모임 지도 핀이 같은 방식). 추천 핀 묶음을 따로 만들지 않는다.
- 감수: 멀리서 볼 때 추천 핀이 많으면 개별로 겹쳐 보인다. 서버 한도는 추천 문서 30개 × 문서당 500곳이라 이론상 핀은 15,000개까지 생기고(중복·내 장소 제외 전), `NaverMapAdapter`는 `fixed` 핀을 모두 그린다. 운영자 1명이 직접 게시하므로 실제 핀은 이보다 훨씬 적고, 지도 `추천 장소` 토글로 끌 수 있어 이대로 둔다. 실제로 느려지거나 겹침이 문제가 되면 그때 추천 전용 묶음을 검토한다.
- 파일: `src/sections/map/recommend-markers.ts`, 도움말 원본 `scripts/motion/help-pages.mjs`의 지도(`id: 'map'`) 팁에서 「멀리서 볼 때 묶음 숫자에는 추천 핀도 함께 세어져요」 문장을 「추천 핀은 묶지 않고 따로 보여요」로 바꾼다.

## 3. 숨긴 추천 되살리기

- 기존 결정 대체 범위: [관리자 추천 장소 설계](../specs/2026-11-15-admin-recommend-design.md)의 「작은 쪽으로 정한 결정」 중 「숨긴 추천」의 “다시 보이게 하는 화면은 만들지 않는다”를 이 절의 복원 단추로 대체한다. 사용자가 `숨긴 추천 다시 보기`를 명시적으로 누르기 전에는 기존 「숨기기·지도 토글 저장」 정책대로 현재 공개 목록에 없는 id도 계속 보존하며, 같은 id로 다시 게시돼도 카드와 지도 핀을 숨긴다.
- 고침: `src/stores/recommend.ts`에 두 atom을 더한다.
  - `hiddenRecommendationCountAtom`: 지금 받은 추천 중 숨긴 개수.
  - `showHiddenRecommendationsAtom`: `hidden`을 빈 배열로 저장(`mapOff`는 그대로). 저장 키·형식 `{hidden, mapOff}`는 그대로다.
- 화면: `RecommendCards`가 숨긴 개수가 1 이상이면 `숨긴 추천 다시 보기` 글자 단추 하나를 보인다. 카드가 남아 있으면 추천 영역 바로 아래, 모두 숨겼으면 단추만 보인다. 단추는 `section[aria-label=추천]` 밖에 두어 「모두 숨기면 추천 영역이 사라진다」는 기존 동작을 유지한다. 누르면 hidden을 비우고 첫 카드로 포커스를 옮긴다.
- 숨긴 id를 모두 비우므로 지금 목록에 없는 옛 숨김 id도 지워진다. 이후 같은 id가 다시 게시되면 보인다. 드문 경우라 그대로 둔다.
- 새 설정 화면은 만들지 않는다.
- 문서: 도움말 원본 `scripts/motion/help-pages.mjs`의 보관함(`id: 'library'`) 팁에서 「×로 숨긴 추천은 이 기기에서 다시 보이지 않아요」 문장을 「×로 숨긴 추천은 이 기기에서 숨겨져요. `숨긴 추천 다시 보기`로 되살려요」로 바꾸고, `docs/development.md` 추천 절 「추천 숨기기…」 문단에 한 줄 더한다.

## 순서

1. 2번(한 줄) → 1번 → 3번 → 도움말·개발 문서.
2. 도움말 원본의 두 팁을 고친 뒤 `yarn build:motion`으로 `src/sections/help/help-content.ts`와 `docs/help/*.md` 등 도움말 산출물을 갱신한다. 생성 파일은 직접 고치지 않는다.
3. 시험
   - 단위: `tests/unit/services/recommend.test.ts` 또는 새 store 시험에 `showHiddenRecommendationsAtom`이 `hidden`만 비우고 `mapOff`·저장 키를 유지하는지, `hiddenRecommendationCountAtom`이 현재 목록 기준인지 한 건.
   - 단위: `recommendMarkers`가 `clusterable: false`를 내는지(기존 시험이 있으면 고치고 없으면 한 줄).
   - e2e `tests/e2e/recommend.spec.ts`의 기존 시험에 다음 확인을 필수로 이어 붙인다.
     - 핀: 추천 문서에 장소를 최소 3곳 두고, 문서 뒤쪽 장소의 ☆ 핀으로 미리보기를 연다(지도 가짜 어댑터의 핀 단추 이름 `☆ 가을 숲` 등). 그 장소가 첫 행이고 나머지 행은 문서의 상대 순서를 유지하며, 처음 선택된 체크박스는 핀으로 연 장소 하나뿐인지 확인한다. 기존 카드 → 미리보기 → 담기 확인도 유지한다. 담은 장소의 추천 핀은 사라지므로 핀 확인은 모든 장소를 가져오기 전에 수행한다.
     - 복원: 숨겨 추천 영역이 사라진 뒤 영역 밖의 `숨긴 추천 다시 보기`를 누른다. 카드와 추천 영역이 돌아오고, 첫 카드에 포커스가 있으며, 복원 단추가 사라지는지 확인한다.

## 검증

위 재생성을 마친 뒤 `yarn build:ci`(타입·시험·빌드, `tests/unit/sections/help/help-generator.test.ts`의 원본·앱 데이터·도움말 문서 대조 포함), `yarn playwright test tests/e2e/recommend.spec.ts`.
