# trip-map 세 모드·반응형 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**개정:** 2026-10-05 r3 — 로드 세션·URL 상세 계약, 연결 작업 분할과 자원/포커스 검증 보완. 최초 작성일은 파일명대로 유지한다.

**Goal:** 사용자가 🗺️ 지도·🗓️ 일정·📌 장소를 선택해 포켓맵·데이패스·트립포켓 뷰를 사용하고, 모바일과 데스크톱에서 같은 여행을 자연스럽게 탐색·편집하게 한다.

**Architecture:** 여행별 Jotai Provider와 기존 편집 저장소를 유지하고, 화면 선택을 지도 레이어 선택에서 분리한다. 공통 셸 안에 지도 인스턴스 하나, 활성 뷰 하나, 공통 상세·편집 영역을 두며 반응형 배치는 CSS Grid로 바꾼다. 검색·선택·편집 초안은 공유하고, 뷰별 스크롤과 지도 탐색 위치는 복원한다.

**Tech Stack:** 기존 React 19·TypeScript·MUI 7·Jotai·React Router·Naver Maps 어댑터·dnd-kit·MDI/unplugin-icons·Vitest/Testing Library·Playwright. Node 24 / Yarn 1.22.22.

## Global Constraints

- 검토 기준 main: `3b36bdd9f1325f6c2264bdbd0e115d5f003c79f1` (2026-10-04 확인). 실행 시작 시 main 차이를 다시 확인한다.
- 이 문서는 구현 계획이다. 계획 작성 단계에서는 앱 코드를 변경하거나 구현 커밋·배포를 하지 않는다.
- 세 모드는 기능 뷰다. 별도의 디자인 테마 선택 + 기능 메뉴를 중첩하지 않는다.
- 화면 이름: `지도`, `일정`, `장소`. 공통 앱 이름·탐색 순서·아이콘·편집 문구를 유지하고 뷰별 부드러운 강조색만 다르게 한다.
- 기존 여행 JSON·EditLayer `schemaVersion: 1`, LWW 병합·되돌리기·Web Locks·storage event 처리를 유지한다. UI 선호와 초안을 편집 파일에 넣지 않는다.
- 기존 `?mode=explore|itinerary&day=<n>&place=<PlaceKey>` 링크와 `#e=...` 가져오기를 지원한다.
- 신규 뷰 쿼리: `view=map|day|places`. `day`는 기존 1부터 번호를 유지한다.
- 새 UI 프레임워크·아이콘 런타임·지도 라이브러리·원격 이미지 API·웹폰트·이모지 이미지 팩을 추가하지 않는다. 필요한 MDI 아이콘을 개별 정적 import한다.
- `.env`·시크릿·여행 원본 YAML·수집 파이프라인은 변경하지 않는다. 네이버 장소 연결은 기존 `naverPlaceUrl()`을 사용한다.
- GPS 추적·자동 다음 방문 판단·예약·새 즐겨찾기 상태·실시간 공동 편집은 범위에 넣지 않는다.
- 메모 2000자, 태그 20개/개당 30자, 하루 방문 50곳 등 기존 `LIMITS`와 입력 검증을 유지한다.
- 사용자 요청에 따라 웹 접근성 감사·인증을 별도 작업으로 넣지 않는다. 버튼 이름과 역할은 사용성과 기존 테스트를 위해 유지한다.
- 모든 새 기능에는 의미 있는 테스트를 추가한다. 기존 회귀 테스트를 삭제해 통과시키지 않는다.
- 커밋 전 `git diff --check`와 해당 diff를 확인한다. 관련 파일만 stage하고 Conventional Commits를 사용한다.

---

## 확정한 동작과 배치

### 모드와 지도 레이어

| **뷰** | **지도 레이어** | **주 콘텐츠** | **모바일 지도** |
|:---|:---|:---|:---|
| `map` · 포켓맵 | 필터를 통과한 저장 장소 | 지도 + 장소 요약/목록 시트 | 전체 배경 영역 |
| `day` · 데이패스 | 선택 날짜의 방문·구간·후보 | 날짜 선택 + 방문 순서 + 구간 정보 | 기본은 일정 목록. ‘동선 지도’ 버튼으로 지도 영역을 펼침 |
| `places` · 트립포켓 | 필터를 통과한 저장 장소 | 폴더/분류 + 카드 또는 목록 | 기본 숨김. ‘지도에서 보기’는 지도 뷰로 전환 |

데이패스의 실제 지도는 공통 지도 영역을 펼쳐서 보여준다. 일정 안에 두 번째 SDK 미니 지도를 만들지 않는다. 데스크톱에서는 동일한 공통 지도를 일정 옆에 표시한다.

### 화면 폭

기준은 **기기 이름이 아니라 앱이 사용할 수 있는 너비**다. 최초 구현에서는 전체 화면 앱의 CSS media query를 사용한다.

| **너비** | **배치** |
|:---|:---|
| `< 768px` | 한 주 영역 + 하단 탐색. 상세·필터·편집은 아래에서 여는 공통 패널 |
| `768–1439px` | 지도 뷰: 지도 + 320–400px 목록. 일정 뷰: 360–440px 일정 + 지도. 장소 뷰: 넓은 카드 영역. 상세는 겹쳐 여는 오른쪽 패널 |
| `>= 1440px` | 위 배치를 유지하며 선택 상세가 있을 때만 320px 세 번째 영역. 지도 최소 폭 500px, 장소 카드 영역 최소 폭 600px |

모든 뷰에 세 열을 강제하지 않는다. 여유 너비가 부족하면 상세를 겹쳐 표시한다. 카드 열 수는 `minmax(160px, 280px)` 기반으로 증가하며 모바일은 2열, 좁은 화면/긴 이름에는 1열 목록 전환을 제공한다.

### 상태와 URL 우선순위

1. 유효한 `view`가 있으면 그 값을 사용한다.
2. 유효한 기존 `mode`가 있으면 `explore → map`, `itinerary → day`로 해석한다.
3. 두 키가 모두 없으면 해당 여행의 저장된 마지막 뷰를 사용한다.
4. 두 키 모두 유효한 값이 없지만 `view` 또는 `mode` 키가 있으면 `map`으로 복구한다. 임의의 저장 선호로 보내지 않는다.
5. 저장소가 차단되었거나 선호 JSON이 잘못되면 `map`으로 시작한다. 선호 저장 실패 때문에 여행 편집을 막지 않는다.
6. 초기 진입에서는 기존 링크를 강제로 다시 쓰지 않는다. 사용자가 뷰·날짜·선택 장소를 바꿀 때 `view`로 정규화하고 기존 `mode` 키를 제거한다.
7. 기존처럼 상태 반영은 `replace`를 사용한다. 뷰마다 브라우저 방문 기록을 추가하는 기능은 넣지 않는다. 뒤로가기·외부 URL 변경 시 URL 값을 다시 따른다.
8. 검색어·필터·편집 초안·뷰별 스크롤은 여행별 메모리 상태다. 마지막 뷰만 별도 localStorage 키에 저장한다. 다른 탭의 뷰 선호 변경으로 현재 화면을 강제로 바꾸지 않는다.
9. 날짜가 명시되지 않은 `day` 진입은 여행 기간 중 현지 날짜, 그 외 첫 날짜를 택한다. 사용자가 고른 `all`/날짜는 이후 뷰 전환에서 유지한다. 기존 `mode=itinerary` 링크의 `day` 누락은 기존처럼 `all`을 유지한다.

### 편집·필터·오류

- 장소 선택과 상세 열기를 구분한다. 상세를 닫아도 선택 장소·지도 강조가 남는다.
- 작성 중인 본인 메모·방문 시간/노트는 뷰 전환·화면 크기 변경·패널 닫기 후 다시 열 때 유지한다. 저장 성공 또는 명시적 취소만 초안을 지운다. 새로고침 후 보존은 범위 밖이다.
- 같은 장소가 여러 날짜/순번에 있어도 방문 편집은 `stop.id`와 날짜로 찾는다. 장소 키로 방문을 수정하지 않는다.
- ‘지도 영역 안만 보기’는 **지도 뷰에서 사용 가능한 지도 경계가 있을 때만** 실제 필터에 적용한다. 다른 뷰/지도 실패 시 체크 의도는 기억하되 적용을 일시 중단하고 안내한다.
- 지도 SDK·인증 실패 시 현재 뷰의 목록·일정·상세·편집을 그대로 사용한다. 새로 지도 실패가 나도 뷰 선택을 임의 변경하지 않는다.
- 파일 공유 메뉴, 저장 불가 경고, 원본 변경 배너, 가져오기·되돌리기 확인은 모든 뷰에서 접근 가능해야 한다.
- 추가·숨김·편집 성공 메시지는 실제 저장 성공 후 표시한다. 닉네임 취소/용량 한도/저장 실패를 성공처럼 표시하지 않는다.

## 파일 구조와 책임

아래 경로는 실제 저장소 루트 기준이다. 문서를 실행 저장소의 같은 `docs/superpowers/plans/` 경로로 옮겨 사용할 수 있다.

| **파일** | **책임** |
|:---|:---|
| `src/stores/ui-store.ts` | 뷰·호환 지도 모드·URL 상태 |
| `src/sections/views/store/ui-preferences.ts` | 여행별 마지막 뷰 읽기/쓰기 |
| `src/sections/views/store/view-session.ts` | 상세 종류, 메모/방문/태그 초안, 지도 시트 높이, 편집 모드, 모바일 동선 지도 표시 |
| `src/sections/views/use-view-query-sync.ts` | URL↔atom 동기화, 여행/로드 준비 토큰 |
| `src/sections/views/use-url-place-detail-sync.ts` | 처리한 URL place 기록, 상세 열기/유효성 정리 |
| `src/sections/views/use-view-scroll.ts` | 활성 목록의 스크롤 저장/복원 |
| `src/sections/views/view/TripNavigation.tsx` | 공통 세 모드 메뉴 |
| `src/sections/views/view/TripToolbar.tsx` | 기존 설정·공유 기능을 보존한 간결한 상단 |
| `src/layouts/ResponsiveTripLayout.tsx` | 지도·활성 패널·상세의 반응형 배치 |
| `src/layouts/TripLayout.tsx` | Task 9d에서 새 셸을 재노출하는 기존 진입 파일 |
| `src/layouts/detail-focus.ts` | 중첩 MUI 팝업 동안 상세의 포커스 트랩 양보 |
| `src/layouts/layout-metrics.ts` | 공통 너비/시트 높이/지도 가림 여백 계산 |
| `src/components/map/use-map-size.ts` | 양수 크기의 지도 영역 감지·재표시 |
| `src/components/map/MapAdapter.ts` | 크기·카메라·fit padding 어댑터 계약 |
| `src/components/map/MapView.tsx` | 지도 한 인스턴스·지연 활성화·카메라 복원 |
| `src/sections/explore/store/place-summary.ts` | 메모 요약·실효 일정 표시·카테고리 이모지 |
| `src/sections/explore/store/use-place-actions.ts` | 기존 저장 경로를 이용하는 장소 편집·추가 |
| `src/sections/explore/view/ExplorePanel.tsx` | 지도 뷰의 간결한 목록 |
| `src/sections/explore/view/PlacesPanel.tsx` | 장소 뷰의 폴더·카드/목록 |
| `src/sections/explore/view/PlaceList.tsx` | 요약 목록, 상세를 행 안에 펼치지 않음 |
| `src/sections/explore/view/PlaceTile.tsx` | 이모지 카드와 빠른 날짜 추가 |
| `src/sections/explore/view/PlaceCard.tsx` | 기존 장소 상세·메모·태그 UI |
| `src/sections/explore/view/FilterBar.tsx` | 대표 카테고리와 상세 필터 진입 |
| `src/sections/views/view/DetailSurface.tsx` | 뷰에 독립적인 상세·필터·날짜 추가·방문 편집 호스트 |
| `src/sections/itinerary/view/StopEditPanel.tsx` | 방문 시간/노트 저장과 초안 |
| 기존 `src/sections/itinerary/view/*.tsx` | 날짜·합계·구간·compact 방문 행·되돌리기 |
| `src/theme/theme.ts`, `src/theme/view-tokens.ts` | 공통 토큰과 세 뷰의 강조색 |
| `tests/unit/sections/`, `tests/unit/components/`, `tests/e2e/` | 상태 계약·저장 회귀·반응형 상호작용 |

설계 참조: [모바일 세 시안 및 개선안](../../../outputs/mobile-design/모바일-디자인-개선안.md). 화면별 색·정보 우선순위는 시안을 따르고 실제 여행 데이터를 사용한다.

분리 대상은 현재 `TripPage.tsx`의 상단/URL 동기화와 `Timeline.tsx`의 편집 UI로 한정한다. 저장·병합·파이프라인을 함께 리팩터링하지 않는다.

## 실제 저장소 대조 결과 (2026-10-05)

문서 위치에는 앱 소스가 없지만, 검토에는 `/private/tmp/trip-map-design-main-20261004`의 실제 main checkout을 사용했다. GitHub main과 checkout HEAD가 모두 `3b36bdd9f1325f6c2264bdbd0e115d5f003c79f1`임을 다시 확인했다. 이 checkout은 검증용이며 구현 작업 브랜치는 별도로 만든다.

| **대조 대상** | **확인한 기존 계약** | **계획에 필요한 변경** |
|:---|:---|:---|
| TripPage/useUiQuerySync | 단일 useEffect, last의 url/state/atoms 가드 | 같은 순서를 보존하고 날짜 배열/준비 완료 조건 추가 |
| trip-page.test/renderAt | opts는 trip/response/storage/strict, 반환값은 storage/store/router | 지연 fetch용 load와 fetchFn 반환을 명시적으로 추가 |
| Timeline/ItineraryPanel | trip/item 입력, useItineraryDays, stop.id 편집 | 새 편집을 독립 Provider에서 검증한 뒤 연결 |
| MapAdapter | mount/markers/polylines/fitBounds/callbacks/destroy | resize/getCamera/setCamera/padding 추가 |
| NaverMapAdapter | getBounds/getZoom/setZoom/setCenter, fitBounds의 사방 margin | Size/getCenter/setSize를 좁은 타입에 추가 |
| naver-map-adapter.test | SDK 로딩 중 destroy 후 Map 생성 금지 한 개 테스트 | 실제 mount 경로의 Size/camera/padding mock을 별도로 추가 |
| MUI 7 설치본 | Unstable_TrapFocus가 있으며 open별 복귀, enforce 비활성화 지원 | 같은 호스트를 유지하며 modal/docked 포커스 정책 분리 |

`yarn test tests/unit/components/trip-page.test.tsx tests/unit/components/naver-map-adapter.test.ts`: **13개 PASS**. 이는 기존 동작의 검증이며 새 화면 전체 구현 통과를 의미하지 않는다.

계획의 URL/선호/hook 코드를 임시 파일로 추출해 실제 createTripStore·Jotai Provider·React Router 및 설치된 MUI FocusTrap으로 계약을 검증했다. **추가 테스트 8개 PASS, typecheck PASS, 검증 파일 ESLint PASS**. import 경로만 검증 폴더에 맞게 바꿨으며 앱 src는 수정하지 않았다. 검증 코드와 재실행 방법은 [리뷰 검증 산출물](../../../outputs/review-verification/2026-10-05/README.md)에 보존했다. SDK 요청 검사는 표시 가능한 상태의 Probe 계약이며 실제 신규 MapView/SDK 전체를 구현해 검증한 결과는 아니다.

r3의 새 준비 토큰·URL 상세 hook 및 비동기 포커스 계약은 **23개 테스트 PASS, typecheck PASS, 검증 파일 ESLint PASS**다. 실제 TripStore를 사용하고 로드 상태는 테스트 atom으로 주입했다. 실제 reload API는 추가하지 않았다. 제거된 opener의 복귀 실패를 재현해 닫힌 상세 host 내부 focus까지 fallback에 포함했고, 설치된 Vitest의 ViteUserConfig export로 예제를 수정했다. [r3 검증 코드·재실행 방법](../../../outputs/review-verification/2026-10-05-r3/README.md)에 결과를 보존했다. 새 셸/MapView 전체와 실제 SDK 자원·실물 기기 검증은 구현 시 수행한다.

저장 Markdown에서 `^\s*[0-9]+\|` 접두어는 **0건**이었다. 원문에 없는 접두어를 제거했다고 기록하지 않는다. 복사본에 번호가 붙어 들어오는 경우 아래 문서 검증 절차에서 실패로 처리한다.

## 실행 시작 전 확인

- 이 문서가 저장된 현재 워크스페이스에는 앱 소스가 없다. 실제 trip-map 저장소에서 main의 기준 커밋/차이를 확인한 다음 실행한다. 현재 docs/outputs를 앱 소스로 오인하지 않는다.
- 구현은 격리된 작업 브랜치에서 진행한다. 실행 시 using-git-worktrees 스킬과 저장소 AGENTS.md를 읽고 브랜치명을 결정한다. 없는 티켓 번호를 만들어 넣지 않는다.
- 시작 시 `yarn lint`, `yarn build:ci`, `yarn test:e2e`로 기준 상태를 확인하고 Task 11에서 비교할 빌드 크기를 기록한다. 시작부터 실패한 검증은 변경에 의한 실패와 구분한다.
- 기존 mockup은 샘플 표현이다. 실제 구현에서 sample 장소·임의 합계·목표 방문 수를 운영 화면 데이터처럼 사용하지 않는다.

## 작업 의존 순서

`1 상태/URL → 2 세션 초안 → 3 토큰/아이콘/메뉴 → 4 지도 계약 → 5 반응형 셸 → 6 장소 요약/추가 → 7 장소/필터 화면 → 8 일정 화면 → 9a 상세 → 9b 초안 → 9c 상단 → 9d 셸/지도 연결 → 9e URL 상세 → 9f 임시 API 제거 → 10 E2E → 11 성능/최종 검증`

각 작업은 실패 테스트 → 최소 구현 → 관련 테스트 → diff 확인 → 관련 파일 커밋 순서다. 현재 저장소에 없는 파일은 해당 작업에서 만든다. 커밋 명령의 파일 목록에는 구현 때 실제 변경한 관련 파일을 모두 포함한다.

Task 5–8은 새 화면을 독립 테스트에서 검증하며 기존 ReadyTrip에는 연결하지 않는다. 새 셸은 ResponsiveTripLayout으로 만들고, ExplorePanel/PlaceList/ItineraryPanel/Timeline에는 임시 compact?: boolean을 기본 false로 추가한다. false 경로는 현재 인라인 상세·편집·드래그 동작을 보존하고 새 경로의 테스트만 compact=true로 실행한다. Task 9d에서 새 셸을 연결하고 9e에서 URL 상세를 연결한 뒤 9f에서 임시 분기와 옛 코드를 제거한다. 이 방식으로 중간 커밋에서도 기존 편집 화면을 검증한다.

---

### Task 1: 세 뷰 상태·기존 링크·마지막 뷰 저장

**Files:** Modify `src/stores/ui-store.ts`, `src/pages/TripPage.tsx`; Create `src/sections/views/store/ui-preferences.ts`, `src/sections/views/use-view-query-sync.ts`, `tests/unit/sections/view-query.test.ts`; Extend `tests/unit/components/trip-page.test.tsx`.

**Interfaces:**
- Produces `ViewMode = 'map' | 'day' | 'places'`, `viewModeAtom`, 기존 호환 `modeAtom`.
- Produces `parseViewQuery(params, dates, fallback, today): ViewQueryState`, `buildViewQuery(current,state,dates): URLSearchParams`, `viewStateKey(state): string`.
- Produces `readPreferredView(storage,publicId): ViewMode`, `writePreferredView(storage,publicId,view): boolean`, `uiQueryReadyAtom: PrimitiveAtom<UiQuerySession | false>`, `useViewQuerySync(): boolean`.
- Consumes 기존 `selectedDayAtom`, `selectedPlaceAtom`, `useTripStore().repoDeps.storage`, `ts.nowIso()`.

- [ ] **Step 1: URL 우선순위와 선호 오류 테스트를 작성한다.**

`tests/unit/sections/view-query.test.ts`의 시작 테스트:

```ts
import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { buildViewQuery, modeAtom, parseViewQuery, viewModeAtom } from 'src/stores/ui-store';
import { readPreferredView, writePreferredView } from 'src/sections/views/store/ui-preferences';

const dates = ['2026-11-14', '2026-11-15'];
const parse = (query: string, fallback = 'places' as const) =>
  parseViewQuery(new URLSearchParams(query), dates, fallback, '2026-11-14');

describe('view query', () => {
  it('신규 view가 legacy mode보다 우선한다', () => {
    expect(parse('view=places&mode=itinerary&day=2')).toEqual({
      view: 'places', day: dates[1], place: null,
    });
  });
  it('기존 일정 링크는 날짜 누락 시 전체를 유지한다', () => {
    expect(parse('mode=itinerary')).toEqual({ view: 'day', day: 'all', place: null });
  });
  it('뷰 키가 없을 때만 선호를 사용한다', () => {
    expect(parse('').view).toBe('places');
    expect(parse('view=unknown').view).toBe('map');
    expect(parse('mode=unknown').view).toBe('map');
    expect(parse('view=unknown&mode=itinerary').view).toBe('day');
  });
  it('신규 일정 기본 날짜는 여행 중 현지 날짜다', () => {
    expect(parse('view=day').day).toBe(dates[0]);
    expect(parse('view=day&day=all').day).toBe('all');
  });
  it('정규화는 무관한 쿼리를 보존하고 day 번호를 유지한다', () => {
    const result = buildViewQuery(new URLSearchParams('mode=itinerary&x=1'),
      { view: 'places', day: dates[1]!, place: 'n:1' }, dates);
    expect(result.get('mode')).toBeNull();
    expect(result.get('view')).toBe('places');
    expect(result.get('day')).toBe('2');
    expect(result.get('x')).toBe('1');
  });
  it('places를 선택해도 탐색 마커 레이어가 활성이다', () => {
    const store = createStore();
    store.set(viewModeAtom, 'places');
    expect(store.get(modeAtom)).toBe('explore');
    store.set(modeAtom, 'itinerary');
    expect(store.get(viewModeAtom)).toBe('day');
  });
});

describe('preferred view', () => {
  it('여행별로 격리하고 손상 값은 map으로 복구한다', () => {
    const storage = createMemoryStorage();
    expect(writePreferredView(storage, 'trip-a', 'places')).toBe(true);
    expect(readPreferredView(storage, 'trip-a')).toBe('places');
    expect(readPreferredView(storage, 'trip-b')).toBe('map');
    storage.setItem('trip-map:ui:trip-a', '{');
    expect(readPreferredView(storage, 'trip-a')).toBe('map');
  });
  it('차단된 저장소를 전파하지 않는다', () => {
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    expect(readPreferredView(blocked, 'trip-a')).toBe('map');
    expect(writePreferredView(blocked, 'trip-a', 'day')).toBe(false);
  });
});
```

추가 케이스: `day=0/-1/999/not-number`, `view=day&day=2`, 신규 day 여행 기간 밖, 여행 날짜가 비어 있는 경우, 빈 place, StrictMode 진입 URL 보존, URL 외부 변경→뷰 동기화, 같은 atom 값의 반복 렌더→URL 쓰기 없음.

- [ ] **Step 2:** `yarn test tests/unit/sections/view-query.test.ts`를 실행해 신규 export 부재로 실패하는지 확인한다.
- [ ] **Step 3: 상태와 순수 URL 함수를 구현한다.** 기존 검색/날짜/장소 atom을 유지하고 다음 정의를 넣는다.

```ts
import { atom } from 'jotai';

export type ViewMode = 'map' | 'day' | 'places';
export type Mode = 'explore' | 'itinerary';
export const viewModeAtom = atom<ViewMode>('map');
export type UiQuerySession = {
  owner: import('src/stores/trip-store').TripStore;
  load: import('src/stores/trip-store').LoadState;
  trip: import('src/schema/trip-data').TripData;
};
export const uiQueryReadyAtom = atom<UiQuerySession | false>(false);
export const modeAtom = atom(
  (get): Mode => get(viewModeAtom) === 'day' ? 'itinerary' : 'explore',
  (_get, set, value: Mode) => set(viewModeAtom, value === 'itinerary' ? 'day' : 'map'),
);
export type ViewQueryState = { view: ViewMode; day: string | 'all'; place: string | null };
export function isViewMode(value: unknown): value is ViewMode {
  return value === 'map' || value === 'day' || value === 'places';
}
export function parseViewQuery(
  params: URLSearchParams, dates: string[], fallback: ViewMode, today: string,
): ViewQueryState {
  const raw = params.get('view');
  const legacy = params.get('mode');
  const view: ViewMode = isViewMode(raw) ? raw
    : legacy === 'itinerary' ? 'day'
    : legacy === 'explore' ? 'map'
    : params.has('view') || params.has('mode') ? 'map' : fallback;
  const rawDay = params.get('day');
  const n = rawDay !== null && /^\d+$/.test(rawDay) ? Number(rawDay) : 0;
  const explicitDay = rawDay !== null;
  const legacyEntry = !isViewMode(raw) && legacy !== null;
  const day = n >= 1 && n <= dates.length ? dates[n - 1]!
    : explicitDay || legacyEntry || view !== 'day' ? 'all'
    : dates.includes(today) ? today : dates[0] ?? 'all';
  return { view, day, place: params.get('place') || null };
}
export function buildViewQuery(
  current: URLSearchParams, state: ViewQueryState, dates: string[],
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete('mode');
  next.set('view', state.view);
  const index = state.day === 'all' ? -1 : dates.indexOf(state.day);
  if (index >= 0) next.set('day', String(index + 1));
  else if (state.view === 'day' && state.day === 'all') next.set('day', 'all');
  else next.delete('day');
  if (state.place) next.set('place', state.place);
  else next.delete('place');
  return next;
}
export const viewStateKey = (s: ViewQueryState): string =>
  JSON.stringify([s.view, s.day, s.place]);
```

기존 `parseUiQuery`·`buildUiQuery`·`uiStateKey`의 사용은 새 함수로 교체한 뒤 삭제한다. `modeAtom`은 지도 훅과 기존 컴포넌트 테스트의 호환 계약으로 유지한다. `day=all`을 명시해서 신규 day 링크가 재진입할 때 날짜 기본값으로 변하는 일을 막는다.

`ui-preferences.ts` 전체 구현:

```ts
import { isViewMode, type ViewMode } from 'src/stores/ui-store';
type UiStorage = Pick<Storage, 'getItem' | 'setItem'>;
const key = (id: string) => `trip-map:ui:${id}`;
export function readPreferredView(storage: UiStorage, publicId: string): ViewMode {
  try {
    const raw = storage.getItem(key(publicId));
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return 'map';
    const record = value as Record<string, unknown>;
    return record.version === 1 && isViewMode(record.view) ? record.view : 'map';
  } catch { return 'map'; }
}
export function writePreferredView(storage: UiStorage, publicId: string, view: ViewMode): boolean {
  try {
    storage.setItem(key(publicId), JSON.stringify({ version: 1, view }));
    return true;
  } catch { return false; }
}
```

- [ ] **Step 4: URL 동기화를 하나의 순서 있는 effect로 분리한다.** 실제 useUiQuerySync는 URL 우선 분기와 atom 변경 분기를 하나의 effect에서 처리한다. 그 구조를 유지한다. 아래 코드는 새 파일의 전체 hook이다. 렌더 본문에서는 atom·URL·선호를 변경하지 않는다.

```ts
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import dayjs from 'dayjs';
import { useTripStore } from 'src/stores/trip-store';
import {
  viewModeAtom, selectedDayAtom, selectedPlaceAtom, uiQueryReadyAtom,
  parseViewQuery, buildViewQuery, viewStateKey, type UiQuerySession,
} from 'src/stores/ui-store';
import { readPreferredView, writePreferredView } from './store/ui-preferences';
type AppliedQuery = { session: UiQuerySession; url:string; dates:string; state:string; atoms:string };
export function useViewQuerySync():boolean {
  const ts=useTripStore();
  const trip=useAtomValue(ts.tripAtom);
  const loadState=useAtomValue(ts.loadStateAtom);
  const [params,setParams]=useSearchParams();
  const [view,setView]=useAtom(viewModeAtom);
  const [day,setDay]=useAtom(selectedDayAtom);
  const [place,setPlace]=useAtom(selectedPlaceAtom);
  const ready=useAtomValue(uiQueryReadyAtom);
  const setReady=useSetAtom(uiQueryReadyAtom);
  const last=useRef<AppliedQuery|null>(null);
  useEffect(()=>{
    if(!trip||loadState.status!=='ready'){
      last.current=null;
      setReady(false);
      return;
    }
    const session={owner:ts,load:loadState,trip};
    if(last.current&&(last.current.session.owner!==ts||
      last.current.session.load!==loadState||last.current.session.trip!==trip)){
      last.current=null;
      setReady(false);
    }
    const dates=trip.days.map(d=>d.date);
    const datesKey=JSON.stringify(dates);
    const url=params.toString();
    const atoms=viewStateKey({view,day,place});
    const previous=last.current;
    if(previous===null||previous.url!==url||previous.dates!==datesKey){
      const parsed=parseViewQuery(params,dates,
        readPreferredView(ts.repoDeps.storage,ts.publicId),
        dayjs(ts.nowIso()).format('YYYY-MM-DD'));
      const fromUrl={...parsed,
        place:parsed.place&&Object.hasOwn(trip.places,parsed.place)?parsed.place:null};
      const state=viewStateKey(fromUrl);
      last.current={session,url,dates:datesKey,state,atoms};
      if(state!==atoms){
        setView(fromUrl.view);setDay(fromUrl.day);setPlace(fromUrl.place);
      }
      writePreferredView(ts.repoDeps.storage,ts.publicId,fromUrl.view);
      setReady(session);
      return;
    }
    if(atoms===previous.atoms)return;
    last.current={...previous,atoms};
    if(atoms===previous.state)return;
    const next=buildViewQuery(params,{view,day,place},dates);
    last.current={session,url:next.toString(),dates:datesKey,state:atoms,atoms};
    writePreferredView(ts.repoDeps.storage,ts.publicId,view);
    setParams(next,{replace:true});
  },[trip,loadState,params,setParams,view,day,place,setView,setDay,setPlace,setReady,ts]);
  return loadState.status==='ready'&&!!trip&&ready!==false&&
    ready.owner===ts&&ready.load===loadState&&ready.trip===trip;
}
```

**로드 세션 계약:** 실제 loadAtom은 idle에서만 한 번 실행되고 reload API는 없다. 이 작업에서 reload 기능을 새로 만들지 않는다. `UiQuerySession`은 현재 TripStore 객체·loadState 객체·trip snapshot을 묶는다. 기존 loadAtom이 성공할 때 새 `{status:'ready'}` 객체를 만들므로 동일 publicId의 새 로드 결과도 다른 세션이다. 로딩/오류/데이터 없음에는 effect에서 `setReady(false)`와 `last.current=null`을 수행한다. 다른 owner/load/snapshot이면 URL 해석 전에 둘을 초기화한다. **반환값도 현재 세션과 비교하므로 reset effect 이전 첫 렌더부터 false**다. effect만으로 boolean을 초기화하는 방식은 쓰지 않는다. 앞으로 retry API가 생기면 loading 전환 및 새 ready 객체 생성 계약을 반드시 유지한다.

두 방향의 실행 경계와 재진입 조건은 다음과 같다.

- **URL→atom:** 여행 데이터 준비 후 최초 실행, 외부 URL 변경, 여행 날짜 배열 변경 시에만 실행한다. 적용 전 atom 값과 URL의 해석 결과를 last에 저장하고 초기 URL은 정규화하지 않는다.
- **atom→URL:** 동일 URL에서 atom이 직전 관측값과 달라지고, URL 반영 목표값과도 다른 경우에만 실행한다. URL을 쓰기 전에 last를 갱신한다.
- **재진입 방지:** StrictMode의 같은 렌더 값으로 effect가 다시 실행되거나 atom이 URL 값을 따라잡은 경우에는 URL을 쓰지 않는다. 두 방향을 별도 effect로 나눠 경쟁시키지 않는다.

TripPage의 store 생성은 기존대로 유지하고 `parseViewQuery(params, [], ...)`로 날짜를 임시 확정하는 코드는 제거한다. 원시 day 값은 React Router의 search params에 보존하며 trip 준비 후 한 번 해석한다. TripScreen에서 hook을 항상 호출하고 데이터와 UI 쿼리가 모두 준비된 뒤 ReadyTrip을 마운트한다.

```tsx
// TripScreen의 기존 loadState/load/effect/오류 분기는 유지한다.
const uiReady=useViewQuerySync();
// 기존 성공 상태의 JSX 조건을 다음으로 교체한다.
{loadState.status==='ready'&&uiReady?<ReadyTrip/>:
  <Box sx={{p:3}} role="status">불러오는 중…</Box>}
```

ReadyTrip에서 이전 useUiQuerySync 호출을 제거한다. 새 hook도 한 곳에서만 호출한다. Provider/publicId key는 유지한다. `TripRoute`의 기존 `<TripPage key={publicId}>`는 필수 계약이다. `TripPage`를 직접 사용하는 테스트/호스트도 같은 key를 주고, 운영에서는 여행별 새 Jotai store를 만든다. 테스트의 deps.jotaiStore를 재사용하더라도 준비 토큰의 owner 검사로 이전 여행 ready를 사용하지 않는다. 최초 화면은 `view/day/place`가 확정된 뒤 표시한다. Task 4와 9d의 visible 계약까지 연결하면 places/모바일 day 진입 때 임시 map 상태로 SDK를 요청하지 않는다. 데이터 대기 중 selectedDayAtom의 초기 all은 확정된 UI 날짜가 아니며 준비 완료 화면으로 표시하지 않는다. 날짜 생략 신규 day는 최초 해석 시의 현지 날짜를 사용하며 단순 재렌더나 자정 경과로 다시 선택하지 않는다.

**초기화 테스트:** renderAt의 opts에 `load?:()=>Promise<Response>`를 추가하고 fetchFn 구현을 `async()=>opts.load?await opts.load():opts.response??jsonResponse(opts.trip)`로 변경한다. 기존 opts와 반환값을 유지한다.

```tsx
it('날짜를 해석하기 전에는 ReadyTrip을 표시하지 않는다',async()=>{
  let release!:(response:Response)=>void;
  const pending=new Promise<Response>(resolve=>{release=resolve;});
  const trip=makeTrip({days:{'2026-11-14':['A'],'2026-11-15':['B']}});
  const {store,router}=renderAt(`/t/${PID}?view=day&day=2`,{
    trip,strict:true,load:()=>pending,
  });
  expect(store.get(uiQueryReadyAtom)).toBe(false);
  expect(screen.queryByTestId('itinerary-panel')).toBeNull();
  await act(async()=>{release(jsonResponse(trip));await pending;});
  await screen.findByTestId('itinerary-panel');
  expect(store.get(uiQueryReadyAtom)).toMatchObject({trip});
  expect(store.get(viewModeAtom)).toBe('day');
  expect(store.get(selectedDayAtom)).toBe('2026-11-15');
  expect(router.state.location.search).toBe('?view=day&day=2');
});
```

기존 테스트에 act와 신규 atom을 import한다. 데이터 준비 전 외부 URL 변경, 날짜 생략, 현지 날짜가 여행 기간 밖인 경우, legacy 날짜 생략 all, 최초/저장 선호 places, URL 쓰기 횟수, 같은 값 재렌더, StrictMode도 검증한다.

- [ ] **Step 5:** 위 순수 테스트와 `trip-page.test.tsx`를 실행한다. 현재 두 메뉴 UI는 Task 3·9d까지 유지하므로 기존 legacy 버튼 테스트는 이 시점에 그대로 통과해야 한다. 변경 후 URL 기대값만 `view=...`로 갱신하고 legacy 진입 URL 기대는 유지한다.
- [ ] **Step 6:** `git diff --check`, 관련 diff 확인 후 커밋: `feat: add shared map day and places view state`.

**추가 세션 테스트:**

- 실제 route에서 A ready→B로 navigate하고 B 응답을 지연한다. 같은 테스트용 Jotai store를 주입해도 B 대기 중 ReadyTrip/MapView는 0개, B 해석 후 첫 화면의 view/day/place는 B URL 값이며 A 값으로 SDK를 활성화하지 않는다.
- hook 단위 harness는 컴포넌트/Provider/Jotai store를 그대로 둔 채 TripStoreContext만 A→B로 변경한다. ready 화면의 layout effect로 표시 이력을 기록해 B 원본 도착 전 표시가 0회임을 검사한다.
- 동일 owner에서 로드 상태 loading→ready 및 새 snapshot을 테스트용 atom으로 주입한다. 이 시뮬레이션은 실제 reload API 호출로 표시하지 않는다. loading 최초 commit부터 준비 화면은 없어야 하며 새 snapshot의 날짜·장소로 한 번 다시 해석한다. 새 ready 객체만 교체하는 경우도 포함한다.
- trip=null, load error에서 readiness=false/reset; 이후 같은 URL로 복구하면 다시 해석한다. StrictMode에서 무한 렌더·중복 URL 쓰기가 없어야 한다.

**완료 기준:** 신규·legacy 진입, 선호 오류, A→B 지연 전환·동일 ID 로드 세션 격리, URL 반복 쓰기 방지, 탐색 레이어 호환 테스트 통과.

### Task 2: 뷰와 무관한 상세 상태·미저장 초안

**Files:** Create `src/sections/views/store/view-session.ts`, `src/sections/views/use-view-scroll.ts`, `tests/unit/sections/view-session.test.ts`, `tests/unit/components/view-scroll.test.tsx`.

**Interfaces:**
- Produces `detailAtom: PrimitiveAtom<DetailState | null>`, `memoDraftsAtom`, `stopDraftsAtom`, `tagDraftsAtom`, `mapSheetSnapAtom`, `itineraryEditingAtom`, `mobileRouteMapAtom`, `placeDisplayAtom`.
- Produces `useViewScroll(ref, view): void`. 스크롤은 여행별 Jotai Provider 안에만 저장한다.
- Consumes Task 1 `ViewMode`. 초안/상세 상태는 localStorage·URL·EditLayer에 기록하지 않는다.

- [ ] **Step 1:** 다음 테스트를 추가한다.

```ts
import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { viewModeAtom } from 'src/stores/ui-store';
import { detailAtom, memoDraftsAtom, stopDraftsAtom } from 'src/sections/views/store/view-session';
it('뷰가 바뀌어도 초안을 유지하고 새 Provider에서는 비어 있다', () => {
  const store = createStore();
  store.set(memoDraftsAtom, { 'n:1:new': '작성 중' });
  store.set(stopDraftsAtom, { a000: { date: '2026-11-14', time: '12:30', note: '대기' } });
  store.set(detailAtom, { kind: 'place', placeKey: 'n:1' });
  store.set(viewModeAtom, 'day');
  store.set(detailAtom, null);
  expect(store.get(memoDraftsAtom)['n:1:new']).toBe('작성 중');
  expect(store.get(stopDraftsAtom).a000?.time).toBe('12:30');
  expect(createStore().get(memoDraftsAtom)).toEqual({});
});
describe('draft clear', () => {
  it('명시적 삭제는 해당 초안만 지운다', () => {
    const store = createStore();
    store.set(memoDraftsAtom, { 'n:1:new': 'A', 'n:2:new': 'B' });
    const next = { ...store.get(memoDraftsAtom) };
    delete next['n:1:new'];
    store.set(memoDraftsAtom, next);
    expect(store.get(memoDraftsAtom)).toEqual({ 'n:2:new': 'B' });
  });
});
```

- [ ] **Step 2:** `yarn test tests/unit/sections/view-session.test.ts` → 신규 module/export 부재로 FAIL 확인.
- [ ] **Step 3:** `view-session.ts` 전체 상태 계약을 구현한다.

```ts
import { atom } from 'jotai';
import type { ViewMode } from 'src/stores/ui-store';
export type DetailState =
  | { kind: 'place'; placeKey: string }
  | { kind: 'add'; placeKey: string }
  | { kind: 'filter' }
  | { kind: 'stop'; date: string; stopId: string };
export type StopDraft = { date: string; time: string; note: string };
export const detailAtom = atom<DetailState | null>(null);
export const memoDraftsAtom = atom<Record<string, string>>({});
export const tagDraftsAtom = atom<Record<string, string>>({});
export const mapSheetSnapAtom = atom<'peek'|'half'|'full'>('peek');
export const stopDraftsAtom = atom<Record<string, StopDraft>>({});
export const itineraryEditingAtom = atom(false);
export const mobileRouteMapAtom = atom(false);
export const placeDisplayAtom = atom<'grid' | 'list'>('grid');
export const viewScrollAtom = atom<Record<ViewMode, number>>({ map: 0, day: 0, places: 0 });
export const selectedPlaceScrollRequestAtom = atom(0);
```

`use-view-scroll.ts`:

```ts
import { useStore } from 'jotai';
import { useLayoutEffect, type RefObject } from 'react';
import type { ViewMode } from 'src/stores/ui-store';
import { viewScrollAtom } from './store/view-session';
export function useViewScroll(ref: RefObject<HTMLElement | null>, view: ViewMode): void {
  const store = useStore();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollTop = store.get(viewScrollAtom)[view];
    const remember = () => store.set(viewScrollAtom,
      (positions) => ({ ...positions, [view]: element.scrollTop }));
    element.addEventListener('scroll', remember, { passive: true });
    return () => {
      remember();
      element.removeEventListener('scroll', remember);
    };
  }, [ref, store, view]);
}
```

`ViewPanel key={view}`는 목록을 의도적으로 재마운트한다. 상태의 보존 범위를 다음으로 고정한다.

| **상태** | **보관 위치/전환 정책** |
|:---|:---|
| 검색·필터·날짜·선택·후보 레이어·카드/목록 표시 | 여행별 atom에 유지 |
| 메모·방문·작성 중 태그 문자열 | session draft atom, 성공/명시적 취소만 제거 |
| 지도 시트 peek/half/full·모바일 동선 표시·스크롤 | session atom에 유지, 새 여행에서는 초기값 |
| 열려 있는 행 메뉴 anchor·측정 높이·일시 hover | 리셋 허용, 저장된 데이터 변경 없음 |
| 일정 순서 편집 모드 | 뷰/날짜 전환 시 의도적으로 종료 |
| 진행 중 되돌리기 확인 | 모드 변경으로 사라지면 취소로 취급, 실제 되돌리기 실행 없음 |

이 hook은 Task 5의 **뷰별로 key가 다른 scroll host**에 붙인다. 선택 항목 자동 스크롤은 Task 7에서 선택 요청 번호가 증가했을 때만 실행한다. 재마운트 직후 저장된 위치를 무조건 선택 행 위치로 덮어쓰지 않는다.

- [ ] **Step 4:** `view-scroll.test.tsx`에서 Provider 하나 안에 `key={view}` scroll host를 렌더하는 harness를 만들고, map 180px→places 70px→map 180px 복원을 검사한다. RTL의 `fireEvent.scroll(element)`과 `Object.defineProperty(element,'scrollTop',{value:180,writable:true})`를 사용한다. 별도 Provider에는 전파되지 않아야 한다.
- [ ] **Step 5:** 두 신규 테스트 PASS 후 diff 확인·커밋: `feat: preserve view session and editing drafts`.

### Task 3: 디자인 토큰·MDI 아이콘·공통 모드 메뉴

**Files:** Modify `src/theme/theme.ts`, `vitest.config.ts`; Create `src/theme/view-tokens.ts`, `src/sections/views/view/TripNavigation.tsx`, `tests/unit/components/trip-navigation.test.tsx`.

**Interfaces:** Produces `VIEW_TOKENS`, `TripNavigation({orientation})`. 메뉴 선택은 Task 1 `viewModeAtom`만 변경한다. URL 처리는 Task 1 hook의 책임이다.

- [ ] **Step 1:** Provider에서 ‘지도/일정/장소’ 버튼을 클릭하고 atom·선택 표시가 바뀌는 테스트를 쓴다.

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { expect, it } from 'vitest';
import { TripNavigation } from 'src/sections/views/view/TripNavigation';
import { viewModeAtom } from 'src/stores/ui-store';
it('세 모드를 같은 Provider에서 전환한다', async () => {
  const store = createStore();
  render(<Provider store={store}><TripNavigation orientation="horizontal" /></Provider>);
  await userEvent.click(screen.getByRole('button', { name: '장소', exact: true }));
  expect(store.get(viewModeAtom)).toBe('places');
  expect(screen.getByRole('button', { name: '장소', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2:** 단위 테스트 FAIL 확인. Vitest에서도 icon virtual import가 필요하므로 `vitest.config.ts`에 Vite와 동일한 플러그인을 추가한다.

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig, type ViteUserConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';

// 현재 defineConfig 안의 객체를 existingConfig로 옮긴다.
// 실행 시 플러그인이 추가되어 있으면 아래 plugins 배열에 기존 항목을 그대로 둔다.
const existingConfig: ViteUserConfig = {
  resolve: { alias: { src: fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom', setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
  plugins: [],
};
export default defineConfig({
  ...existingConfig,
  plugins: [...(existingConfig.plugins ?? []), Icons({ compiler: 'jsx', jsx: 'react' })],
});
```

현재 checkout의 vitest.config에는 plugins가 없으므로 위 빈 배열은 실제 기준 설정이다. 실행 시 설정이 달라졌다면 resolve/test 및 React 등 모든 기존 plugin 항목을 existingConfig에 보존한다. 함수형/Promise형 config로 바뀌었으면 먼저 기존 함수를 평가한 결과에 같은 배열 확장을 적용한다. 최종 배열의 기존 플러그인 identity/순서와 icon import 렌더를 검사하며 배열 전체를 `[Icons(...)]`로 교체하지 않는다.

- [ ] **Step 3:** 토큰과 메뉴를 구현한다.

```ts
// src/theme/view-tokens.ts
export const VIEW_TOKENS = {
  map: { accent: '#167c66', soft: '#e6f3ee', surface: '#ffffff', ink: '#182b32' },
  day: { accent: '#ad4c2b', soft: '#fbebe3', surface: '#fffdf9', ink: '#342c28' },
  places: { accent: '#6952ba', soft: '#f0ecfa', surface: '#faf9fd', ink: '#302d46' },
} as const;
```

```tsx
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MapIcon from '~icons/mdi/map-outline';
import RouteIcon from '~icons/mdi/routes';
import PlacesIcon from '~icons/mdi/bookmark-multiple-outline';
import { useAtom } from 'jotai';
import { viewModeAtom, type ViewMode } from 'src/stores/ui-store';
import { VIEW_TOKENS } from 'src/theme/view-tokens';
const items = [
  { view: 'map', label: '지도', Icon: MapIcon },
  { view: 'day', label: '일정', Icon: RouteIcon },
  { view: 'places', label: '장소', Icon: PlacesIcon },
] as const;
export function TripNavigation({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  const [view, setView] = useAtom(viewModeAtom);
  const tokens = VIEW_TOKENS[view];
  return <Box component="nav" aria-label="보기 전환" sx={{
    display: 'flex', flexDirection: orientation === 'vertical' ? 'column' : 'row',
    gap: 1, p: 1, bgcolor: tokens.surface,
  }}>{items.map(({ view: value, label, Icon }) => <Button key={value}
    aria-pressed={view === value} onClick={() => setView(value as ViewMode)}
    sx={{ minWidth: 44, minHeight: 44, flex: orientation === 'horizontal' ? 1 : undefined,
      flexDirection: 'column', gap: 0.5, color: view === value ? tokens.accent : '#65767b',
      bgcolor: view === value ? tokens.soft : 'transparent', borderRadius: 2 }}>
    <Icon width={22} height={22} />{label}
  </Button>)}</Box>;
}
```

기존 theme의 fontFamily를 유지하면서 `shape.borderRadius=12`, Typography body1=16px/body2=14px/caption=12px를 설정한다. `MuiButton.defaultProps.disableElevation=true`, `MuiIconButton.styleOverrides.root.minWidth/minHeight=44`, `MuiInputBase.styleOverrides.input.fontSize=16`을 넣는다. 시스템 이모지는 카테고리 타일에만 쓰고 지도 마커에는 쓰지 않는다.

- [ ] **Step 4:** 신규 메뉴 테스트·`yarn typecheck` PASS. 모든 static icon import의 이름이 `@iconify-json/mdi/icons.json`에 존재하는지 확인하고 새 dependency가 없는지 `git diff package.json yarn.lock`으로 확인한다.
- [ ] **Step 5:** diff 확인·커밋: `feat: add compact three-view navigation and design tokens`.

### Task 4: 지도 한 인스턴스·크기 변경·카메라 복원

**Files:** Modify `src/components/map/MapAdapter.ts`, `FakeMapAdapter.ts`, `NaverMapAdapter.ts`, `MapView.tsx`; Create `src/components/map/use-map-size.ts`, `tests/unit/components/helpers/map-resources.ts`; Extend `tests/unit/components/map-view.test.tsx`, `naver-map-adapter.test.ts`; Create `tests/unit/components/map-size.test.tsx`.

**Interfaces:**
- Produces `MapCamera = { center: [number,number]; zoom: number }`, `MapPadding = {top:number;right:number;bottom:number;left:number}`.
- Adapter adds `resize(width,height): void`, `getCamera(): MapCamera | null`, `setCamera(camera): void`; `fitBounds(points,padding?:MapPadding)` remains compatible with existing callers.
- `MapView` props add optional `visible?: boolean` (default true), `padding?: MapPadding`, `onReadyChange?(ready:boolean):void`. 기존 SDK 인증 실패·비동기 mount 취소 처리를 유지한다.
- Produces `useMapSize(hostRef,adapter,visible): boolean`; result is true only for mounted adapter + visible positive-size host.

- [ ] **Step 0:** 실행 전 Naver SDK 계약을 재확인한다. 저장소 load-naver-sdk는 `https://oapi.map.naver.com/openapi/v3/maps.js`를 사용한다. SDK의 세부 배포 버전은 저장소가 고정하지 않는다. 공식 [Map API](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html)에서 setSize(Size), getCenter(), setCenter(Coord), getZoom/setZoom, fitBounds(bounds,{top,right,bottom,left})를 확인한다. 2026-10-05에 이 계약과 기존 fitBounds의 margin 객체가 일치함을 확인했다. 변경이 있으면 adapter 타입·mock·테스트를 함께 수정한다.

FakeMapAdapter는 mount마다 `data-instance-id`를 기록한다. Fake/Naver destroy는 observer 외의 callback 슬롯도 비우고 SDK listener/overlay를 정리한다. 반복 destroy는 안전해야 한다. 현재 naver-map-adapter.test.ts는 로드 중 취소만 검사하므로 완성된 SDK mock이 이미 있다고 가정하지 않는다. resize/camera/padding 테스트에는 Size/LatLng/LatLngBounds/Marker/Polyline/Event 및 Map의 getBounds/getZoom/getCenter/setCenter/setZoom/setSize/fitBounds/destroy를 갖춘 별도 mock을 만들고, 기존 취소 테스트는 그대로 유지한다. mock 기반 검증과 실제 SDK에서의 크기/가림 영역 검증을 구분한다.

- [ ] **Step 1:** 신규 크기·인스턴스 테스트를 먼저 쓴다.

```ts
// 기존 map-view.test.tsx의 mk와 cleanup/환경 설정을 재사용한다.
it('숨김 재표시와 크기 변경으로 SDK를 다시 만들지 않는다', async () => {
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  const mount = vi.spyOn(FakeMapAdapter.prototype, 'mount');
  const destroy = vi.spyOn(FakeMapAdapter.prototype, 'destroy');
  const props = { markers: [mk('a')], polylines: [], onMarkerClick: vi.fn(), onUnavailable: vi.fn() };
  const { rerender, unmount } = render(<MapView {...props} visible={true} />);
  await screen.findByTestId('fake-map');
  rerender(<MapView {...props} visible={false} />);
  rerender(<MapView {...props} visible={true} />);
  expect(mount).toHaveBeenCalledTimes(1);
  expect(destroy).not.toHaveBeenCalled();
  unmount();
  expect(destroy).toHaveBeenCalledTimes(1);
  mount.mockRestore(); destroy.mockRestore();
});
```

추가 테스트: 초기 visible=false이면 SDK 요청 없음; 첫 표시에서만 mount; 숨김 중 marker/polyline 재생성 없음; 0 크기는 resize에서 제외; 재표시 때 resize·그리기 재개; StrictMode 정리; SDK 로딩 중 취소; 인증 실패 시 목록 제공; 숨김 중 focus 연기; 최초 fitKey는 fit, 재방문은 camera 복원; 단순 크기 변경 시 zoom 보존; peek/half 목록 상태에서 선택 장소가 가리지 않도록 fit padding 적용.

- [ ] **Step 2:** `yarn test tests/unit/components/map-view.test.tsx tests/unit/components/map-size.test.tsx` → 신규 행동 FAIL 확인.
- [ ] **Step 3:** adapter 계약과 구현을 추가한다.

```ts
// MapAdapter.ts exports
export type MapCamera = { center: [number, number]; zoom: number };
export type MapPadding = { top: number; right: number; bottom: number; left: number };
// MapAdapter interface 추가/변경
resize(width: number, height: number): void;
getCamera(): MapCamera | null;
setCamera(camera: MapCamera): void;
fitBounds(points: [number, number][], padding?: MapPadding): void;
```

`NaverMaps`에 `Size: new (width:number,height:number) => unknown`, `NaverMap`에 `getCenter(): {x:number;y:number}`와 `setSize(size:unknown): void`를 추가한다. 기존 메서드를 보존하면서 다음 메서드를 넣는다.

```ts
resize(width: number, height: number): void {
  if (!this.map || width <= 0 || height <= 0) return;
  const camera = this.getCamera();
  this.map.setSize(new (maps().Size)(width, height));
  if (camera) this.setCamera(camera);
  this.drawMarkers();
  const bounds = this.currentBounds();
  if (bounds) this.boundsCb?.(bounds);
}
getCamera(): MapCamera | null {
  if (!this.map) return null;
  const point = this.map.getCenter();
  return { center: [point.x, point.y], zoom: this.map.getZoom() };
}
setCamera(camera: MapCamera): void {
  if (!this.map) return;
  this.map.setCenter(new (maps().LatLng)(camera.center[1], camera.center[0]));
  this.map.setZoom(camera.zoom);
}
```

`fitBounds` 마지막 호출을 `this.map.fitBounds(new m.LatLngBounds(sw,ne), padding ?? {top:40,right:40,bottom:40,left:40})`로 변경한다. Fake에는 `camera: MapCamera = {center:[128,37.5],zoom:8}`, `resizeCalls: [number,number][]`을 두고 resize 기록·get/set 복사·data 속성 갱신을 구현한다. Fake의 fitCalls·기존 marker id는 그대로 유지한다.

- [ ] **Step 4:** 크기 hook을 구현한다.

```ts
import { useMemo, useSyncExternalStore, type RefObject } from 'react';
import type { MapAdapter } from './MapAdapter';
const serverSnapshot = () => false;
export function useMapSize(
  hostRef: RefObject<HTMLElement | null>, adapter: MapAdapter | null, visible: boolean,
): boolean {
  const source = useMemo(() => {
    let positive = false;
    return {
      snapshot: () => positive,
      subscribe(notify: () => void) {
        const host = hostRef.current;
        if (!host || !adapter || !visible) return () => {};
        let frame = 0;
        let previous = '';
        const measure = () => {
          const rect = host.getBoundingClientRect();
          const w = Math.round(rect.width), h = Math.round(rect.height);
          const next = w > 0 && h > 0;
          if (next && `${w}:${h}` !== previous) {
            previous = `${w}:${h}`; adapter.resize(w,h);
          }
          if (positive !== next) { positive = next; notify(); }
        };
        const schedule = () => {
          cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(host); schedule();
        return () => { observer.disconnect(); cancelAnimationFrame(frame); positive = false; };
      },
    };
  }, [hostRef, adapter, visible]);
  return useSyncExternalStore(source.subscribe, source.snapshot, serverSnapshot);
}
```

테스트에서는 전역을 영구 변경하지 말고 해당 describe에 ResizeObserver·rAF stub을 등록/해제한다. `getBoundingClientRect`도 해당 host만 mock한다. 기존 jsdom의 0px 레이아웃을 실제로 390×500인 것처럼 명시한다.

- [ ] **Step 5:** MapView의 기존 mount/auth 로직에 한 번 활성화 상태를 넣는다.

```ts
const visible = props.visible ?? true;
const [activated, setActivated] = useState(visible);
const [mountedAdapter, setMountedAdapter] = useState<MapAdapter | null>(null);
useEffect(() => {
  if (!visible || activated) return;
  const frame = requestAnimationFrame(() => setActivated(true));
  return () => cancelAnimationFrame(frame);
}, [visible, activated]);
// 기존 mount effect 시작부: if (!activated) return;
// effect dependency: [activated]. visible로 직접 바꾸지 않는다.
// mount 성공: adapterRef.current = adapter; setMountedAdapter(adapter);
// 기존 취소/실패 분기를 보존한다. cleanup에서는 mountedAdapter state를 쓰지 않는다.
const ready = useMapSize(hostRef, mountedAdapter, visible);
useEffect(() => { latest.current.onReadyChange?.(ready); }, [ready]);
```

기존 `setMarkers/setPolylines` effect는 `[ready,props.markers]`, `[ready,props.polylines]`로 바꾸고 ready일 때만 실행한다. mount 성공 콜백의 setMarkers/setPolylines/fitBounds는 제거하고 아래 ready effect에서만 실행한다. 인증/SDK 실패 시 onReadyChange(false)를 먼저 알린다. 숨김은 SDK를 destroy하지 않지만 숨긴 동안 마커·구간 재생성을 하지 않는다.

```ts
const cameras = useRef(new Map<string, MapCamera>());
const fittedKeys = useRef(new Set<string>());
const displayedKey = useRef<string | null>(null);
const appliedFocus = useRef<number | null>(null);
const key = props.fitKey ?? 'explore';
useEffect(() => {
  const adapter = adapterRef.current;
  if (!ready || !adapter) return;
  if (displayedKey.current !== key) {
    if (displayedKey.current !== null && fittedKeys.current.has(displayedKey.current)) {
      const old = adapter.getCamera();
      if (old) cameras.current.set(displayedKey.current, old);
    }
    const remembered = cameras.current.get(key);
    if (remembered) adapter.setCamera(remembered);
    displayedKey.current = key;
  }
  if (!fittedKeys.current.has(key)) {
    const points = fitPoints(latest.current.markers);
    if (points.length > 0) {
      adapter.fitBounds(points, latest.current.padding);
      fittedKeys.current.add(key);
    }
  }
  const focus = latest.current.focus;
  if (focus && focus.seq !== appliedFocus.current) {
    const [lng,lat] = focus.point;
    adapter.fitBounds([[lng-FOCUS_PAD,lat-FOCUS_PAD],[lng+FOCUS_PAD,lat+FOCUS_PAD]],
      latest.current.padding);
    appliedFocus.current = focus.seq;
  }
}, [ready, key, props.focus, props.markers]);
```

`props.focus` 정책: 새 장소 선택 seq만 적용한다. 이미 fit한 같은 key의 마커·크기 변경에는 다시 fit하지 않는다. 빈 마커로 진입한 key는 fittedKeys에 넣지 않으므로 첫 데이터에 한 번 fit한다. StrictMode cleanup에서 cameras/fittedKeys/displayedKey/appliedFocus도 초기화해 파괴한 어댑터의 상태를 새 인스턴스에 재사용하지 않는다.

**padding 의존성:** padding만 바뀐 경우 카메라 effect는 실행하지 않는다. 시트 높이 변경은 가림 여백만 저장하고, 지도의 실제 host 크기도 바뀌었다면 resize를 실행한다. host 크기가 그대로이면 resize조차 필요 없다. 다음 새 focus/최초 fit에 최신 padding을 사용한다. 시트 이동만으로 사용자가 고른 중심/zoom을 덮지 않는 계약이다.

```tsx
it('padding만 변경하면 fit과 camera 복원 횟수가 늘지 않는다',async()=>{
  vi.stubEnv('VITE_MAP_ADAPTER','fake');
  const fit=vi.spyOn(FakeMapAdapter.prototype,'fitBounds');
  const camera=vi.spyOn(FakeMapAdapter.prototype,'setCamera');
  const props={markers:[mk('a')],polylines:[],fitKey:'explore',
    onMarkerClick:vi.fn(),onUnavailable:vi.fn(),visible:true};
  const {rerender}=render(<MapView {...props} padding={{top:24,right:24,bottom:164,left:24}}/>);
  await waitFor(()=>expect(fit).toHaveBeenCalledTimes(1));
  const before=camera.mock.calls.length;
  rerender(<MapView {...props} padding={{top:24,right:24,bottom:360,left:24}}/>);
  expect(fit).toHaveBeenCalledTimes(1);expect(camera).toHaveBeenCalledTimes(before);
  fit.mockRestore();camera.mockRestore();
});
```

- [ ] **Step 6:** Naver mock의 Size/getCenter/setSize와 Fake camera 테스트를 추가한다. resize·fit padding·숨김 재표시·기존 SDK 실패 테스트 PASS. `yarn typecheck` PASS.
- [ ] **Step 7:** diff 확인·커밋: `feat: preserve one map across responsive view changes`.

**기술 근거:** Naver SDK의 `setSize`/카메라 메서드는 [공식 Map API](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html#setSize), 반응형 토큰은 [MUI 7 문서](https://v7.mui.com/material-ui/customization/breakpoints/), 빌드 타임 아이콘은 [unplugin-icons 사용법](https://iconify.design/docs/usage/svg/unplugin/)을 따른다.

### Task 5: 반응형 공통 셸·시트·스크롤 호스트

**Files:** Create `tests/unit/components/map-lifecycle.test.tsx`, `src/layouts/ResponsiveTripLayout.tsx`, `src/layouts/layout-metrics.ts`, `src/layouts/detail-focus.ts`, `tests/unit/components/trip-layout.test.tsx`; Extend `tests/unit/components/helpers/map-resources.ts` 및 `tests/unit/components/map-view.test.tsx`의 목록 전용 모드 테스트.

**Interfaces:**
- `LayoutKind = 'compact' | 'split' | 'wide'`, `useLayoutKind(): LayoutKind`.
- `ResponsiveTripLayout` props: `{topBar,map,panel,detail,view,layout,unavailable,routeMapVisible,onMapPaddingChange}`.
- `detail`는 `{open:boolean; content:ReactNode; onClose():void}`. panel을 바꿔도 detail 호스트와 map 호스트의 React 위치/key를 바꾸지 않는다.
- Task 3 `TripNavigation`, Task 2 `useViewScroll`을 소비한다. 여기서는 panel 콘텐츠의 도메인 동작을 구현하지 않는다.

- [ ] **Step 1:** 동일한 map sentinel을 전달하고 compact→split→wide 및 세 뷰 전환에서 mount 횟수가 1인지 테스트한다. 선택 상세가 있으면 wide에 세 번째 영역, split에는 겹침 영역, compact에는 하단 상세를 나타내는 `data-layout`/`data-detail-presentation`을 검사한다. 지도 실패 시 panel·detail·메뉴가 남고 map만 사라져야 한다.

```tsx
// trip-layout.test.tsx 신규 describe 안. imports: render, useEffect, vi/it/expect, createStore/Provider, ResponsiveTripLayout, LayoutKind, ViewMode. 각 테스트는 Provider로 감싼다.
it('레이아웃과 뷰가 바뀌어도 지도 host를 재마운트하지 않는다', () => {
  const mounted = vi.fn();
  function Sentinel() { useEffect(() => { mounted(); }, []); return <div>지도 sentinel</div>; }
  const shared = {
    topBar: <div>상단</div>, map: <Sentinel />, panel: <div>목록</div>,
    detail: { open: false, content: null, onClose: vi.fn() },
    unavailable: null, routeMapVisible: false, onMapPaddingChange: vi.fn(),
  };
  const store = createStore();
  const wrap = (layout: LayoutKind, view: ViewMode) =>
    <Provider store={store}><ResponsiveTripLayout {...shared} layout={layout} view={view} /></Provider>;
  const { rerender } = render(wrap('compact','map'));
  rerender(wrap('split','day'));
  rerender(wrap('wide','places'));
  expect(mounted).toHaveBeenCalledTimes(1);
});
```

**지도 자원 검증:** 위 sentinel은 React 위치 검증만 담당한다. 별도 `tests/unit/components/map-lifecycle.test.tsx`에 실제 MapView+ResponsiveTripLayout을 넣고, Task 4에서 생성한 `tests/unit/components/helpers/map-resources.ts`를 확장해 다음 계측을 제공한다. Task 4에서는 adapter 단독 lifecycle, Task 5에서는 셸/뷰/breakpoint와 함께 검증한다.

- FakeMapAdapter의 mount에서 단조 증가 instance ID를 `fake-map.dataset.instanceId`에 기록한다. 테스트 helper의 mount/destroy spy는 adapter 객체별 호출 수와 현재 살아 있는 instance Set을 기록한다. 동일 객체의 destroy가 두 번 호출돼도 live Set은 한 번만 제거한다. 환경값은 vi.stubEnv로 fake를 선택하고 정리 때 복구한다.
- ResizeObserver stub은 각 객체의 관측 target Set을 유지하고 `activeTargets():number`, `emit(width,height):void`를 제공한다. observe는 Set.add, unobserve/disconnect는 삭제한다. rAF도 pending ID를 추적해 종료 시 0인지 확인한다. 생성 누적 횟수를 active 개수로 오인하지 않는다.
- onMarkerClick/onBoundsChange는 실제 API가 단일 callback 슬롯을 교체하는 void 메서드이므로, unsubscribe 반환 함수가 있다고 가정하지 않는다. Fake/Naver destroy에서 두 callback을 null로 비우고, 이벤트 주입 helper로 폐기된 인스턴스가 사용자 callback을 다시 호출하지 않는지 검사한다. 살아 있는 adapter의 marker/bounds callback 슬롯은 각 1개다.
- Naver SDK mock의 Event.addListener/removeListener는 실제 handle Set을 유지한다. 현재 구현은 map의 idle 하나를 등록한다. marker click은 SDK Event가 아니라 overlay DOM addEventListener이므로 별도로 mock Marker의 setMap(null) 때 detached overlay를 제거하고, **연결된 overlay 수·click 1회당 callback 1회**를 검사한다. 새 기능에서 event를 추가하면 기대값도 명시적으로 갱신한다.

| **시점** | **검증할 값** |
|:---|:---|
| 처음 places/compact day, 지도 미표시 | adapter mount/SDK Map 생성 0, 지도 size observer target 0 |
| 최초 map 활성화 완료 | live adapter 1, fake instance ID 1개, map size target 1, bounds/marker 슬롯 각 1 |
| map/day/places와 compact/split/wide를 10회 순환 | 최초 활성 ID 유지, 추가 mount/destroy 0, live adapter 1, size target은 표시 중 1·숨김 중 0 |
| 숨김→재표시 | observer 재등록은 가능하나 active target 1개, camera/마커 갱신 1세트, callback 중복 호출 없음 |
| 정상 unmount/여행 route 교체/SDK 오류 종료 | live adapter·active observer target·SDK Event handle·연결 overlay·pending rAF 각각 0 |
| StrictMode 초기 setup/cleanup/setup 후 | 개발 초기 mount 누적은 2회를 허용, 최종 live는 1; 안정화 이후 view/breakpoint 전환은 추가 mount 0 |

셸 자체의 body ResizeObserver가 있으면 지도 size observer와 분리해 계측한다. 표의 size target은 map-host target만 센다. 실제 SDK Map 생성/파괴 및 handle 정리는 naver-map-adapter.test의 mock에서도 검사하고, fake 카운터만으로 SDK 구독 정리를 증명했다고 표시하지 않는다.

- [ ] **Step 2:** `yarn test tests/unit/components/trip-layout.test.tsx` → 계약·동작 FAIL 확인.
- [ ] **Step 3:** 배치 기준을 구현한다.

```ts
// layout-metrics.ts
import useMediaQuery from '@mui/material/useMediaQuery';
export type LayoutKind = 'compact' | 'split' | 'wide';
export const SPLIT_QUERY = '(min-width: 768px)';
export const WIDE_QUERY = '(min-width: 1440px)';
export function useLayoutKind(): LayoutKind {
  const split = useMediaQuery(SPLIT_QUERY);
  const wide = useMediaQuery(WIDE_QUERY);
  return wide ? 'wide' : split ? 'split' : 'compact';
}
export type SheetSnap = 'peek' | 'half' | 'full';
export function sheetHeight(snap: SheetSnap, available: number): number {
  const max = Math.max(0, available - 48);
  const desired = snap === 'peek' ? 164 : snap === 'half' ? available * 0.48 : available * 0.88;
  return Math.round(Math.min(max, Math.max(0, desired)));
}
```

사용 가능한 높이는 viewport 전체가 아니라 상단·배너·하단 메뉴를 제외한 body host의 실제 높이다. 320×568 및 키보드 표시 상태에서 시트가 제목/메뉴를 덮지 않게 한다.

`ResponsiveTripLayout.tsx`에 다음 구조를 만든다. 기존 TripLayout/ReadyTrip은 Task 9d까지 유지한다. 지도 실패 메시지와 pointer drag 처리 의미를 재사용한다.

```tsx
// imports: Box, Alert, FocusTrap from @mui/material/Unstable_TrapFocus,
// detailFocusEnabled from ./detail-focus, ReactNode/useRef, TripNavigation, useViewScroll,
// ViewMode, LayoutKind, MapPadding, VIEW_TOKENS.
type Props = {
  topBar: ReactNode; map: ReactNode; panel: ReactNode;
  detail: { open: boolean; content: ReactNode; onClose(): void };
  view: ViewMode; layout: LayoutKind; unavailable: string | null;
  routeMapVisible: boolean; onMapPaddingChange(padding: MapPadding): void;
};
export function ResponsiveTripLayout(props: Props) {
  const viewportHeight = useViewportHeight();
  const wasOpen = useRef(false);
  const detailHostRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const closed=wasOpen.current&&!props.detail.open;
    wasOpen.current=props.detail.open;
    if(!closed)return;
    const frame=requestAnimationFrame(()=>{
      const active=document.activeElement;
      if(active===document.body||!active?.isConnected||
        (active!==null&&detailHostRef.current?.contains(active)))
        document.querySelector<HTMLButtonElement>(
          'nav[aria-label="보기 전환"] button[aria-pressed="true"]')?.focus();
    });
    return()=>cancelAnimationFrame(frame);
  },[props.detail.open]);
  const compact = props.layout === 'compact';
  const dock = props.layout === 'wide' && props.detail.open;
  const mapVisible = !props.unavailable && (props.view === 'map'
    || (props.view === 'day' && (!compact || props.routeMapVisible)));
  const tokens = VIEW_TOKENS[props.view];
  const columns = compact ? 'minmax(0,1fr)'
    : props.view === 'places' || props.unavailable ? 'minmax(0,1fr)'
    : props.view === 'day' ? 'minmax(360px,440px) minmax(0,1fr)'
    : 'minmax(0,1fr) minmax(320px,400px)';
  const areas = props.view === 'places' || props.unavailable ? 'panel'
    : props.view === 'day' ? 'panel map' : 'map panel';
  return <Box data-testid="trip-shell" data-layout={props.layout} data-view={props.view}
    sx={{ height:viewportHeight, minWidth:0, overflow:'hidden', bgcolor:tokens.surface,
      color:tokens.ink, display:'grid',
      gridTemplateColumns:compact?'minmax(0,1fr)':'72px minmax(0,1fr)',
      gridTemplateRows:compact?'auto minmax(0,1fr) auto':'auto minmax(0,1fr)' }}>
    <Box sx={{gridColumn:compact?1:2,minWidth:0}}>{props.topBar}</Box>
    <Box sx={{ gridColumn:compact?1:2,minHeight:0,minWidth:0,position:'relative',
      display:'grid', gap:0,
      gridTemplateColumns:dock?`${columns} 320px`:columns,
      gridTemplateAreas:compact
        ?props.view==='day'&&mapVisible?'"panel" "map"'
          :props.view==='map'&&mapVisible?'"map"':'"panel"'
        :`"${areas}${dock?' detail':''}"`,
      gridTemplateRows:compact&&props.view==='day'&&mapVisible
        ?'minmax(0,1fr) 180px':'minmax(0,1fr)' }}>
      <Box data-testid="trip-map-area" sx={{ gridArea:compact?undefined:'map',
        gridRow:compact&&props.view==='day'?2:1, minWidth:0,minHeight:0,
        display:mapVisible?'block':'none',position:'relative' }}>
        {!props.unavailable && props.map}
      </Box>
      <ViewPanel key={props.view} view={props.view}
        sheet={compact&&props.view==='map'&&!props.unavailable}
        onPaddingChange={props.onMapPaddingChange}>
        {props.unavailable && <Alert severity="warning">{props.unavailable}</Alert>}
        {props.panel}
      </ViewPanel>
      <FocusTrap open={props.detail.open} disableEnforceFocus={dock}
        isEnabled={detailFocusEnabled}>
      <Box ref={detailHostRef} tabIndex={-1} data-detail-presentation={dock?'docked':compact?'bottom':'overlay'}
        sx={{ display:props.detail.open?'block':'none',minWidth:0,minHeight:0,
          gridArea:dock?'detail':undefined,position:dock?'relative':'absolute',
          zIndex:5,bgcolor:tokens.surface,
          ...(dock?{}:compact?{left:0,right:0,bottom:0,maxHeight:'88%',borderRadius:'24px 24px 0 0'}
            :{right:0,top:0,bottom:0,width:360}),overflow:'auto' }}>
        {props.detail.content}
      </Box>
      </FocusTrap>
    </Box>
    <Box sx={{gridColumn:1,gridRow:compact?3:'1 / 3',
      borderTop:compact?'1px solid #eceeec':undefined,
      pb:compact?'env(safe-area-inset-bottom)':0}}>
      <TripNavigation orientation={compact?'horizontal':'vertical'} />
    </Box>
  </Box>;
}
```

같은 파일에 다음 ViewPanel을 추가한다. import에는 Box/Button/Typography, useEffect/useRef/useState, ReactNode/PointerEvent, MapPadding, ViewMode, SheetSnap/sheetHeight, useViewScroll, Jotai useAtom, mapSheetSnapAtom을 포함한다. 부모 body의 실제 높이를 측정하고, 뷰마다 하나의 overflow host에 스크롤 복원을 연결한다.

```tsx
function ViewPanel({view,sheet,onPaddingChange,children}:{
  view:ViewMode; sheet:boolean; children:ReactNode;
  onPaddingChange(padding:MapPadding):void;
}) {
  const hostRef=useRef<HTMLDivElement>(null);
  const scrollRef=useRef<HTMLDivElement>(null);
  const startY=useRef<number|null>(null);
  const [available,setAvailable]=useState(0);
  const [snap,setSnap]=useAtom(mapSheetSnapAtom);
  useViewScroll(scrollRef,view);
  useEffect(()=>{
    const body=hostRef.current?.parentElement;
    if(!body)return;
    let frame=0;
    const measure=()=>setAvailable(body.getBoundingClientRect().height);
    const schedule=()=>{
      cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);
    };
    const observer=new ResizeObserver(schedule);
    observer.observe(body);schedule();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[]);
  const height=sheetHeight(snap,available);
  useEffect(()=>{
    onPaddingChange({top:24,right:24,left:24,
      bottom:sheet?Math.min(height+12,Math.max(24,available-72)):24});
  },[sheet,height,available,onPaddingChange]);
  const change=(direction:number)=>setSnap(value=>{
    const values:SheetSnap[]=['peek','half','full'];
    return values[Math.min(2,Math.max(0,values.indexOf(value)+direction))]!;
  });
  const onPointerDown=(event:PointerEvent<HTMLDivElement>)=>{
    startY.current=event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerUp=(event:PointerEvent<HTMLDivElement>)=>{
    if(startY.current===null)return;
    const delta=event.clientY-startY.current;startY.current=null;
    change(Math.abs(delta)<40?1:delta<0?1:-1);
  };
  return <Box ref={hostRef} sx={{minHeight:0,minWidth:0,display:'flex',
    flexDirection:'column',bgcolor:'#fff',color:'#182b32',
    ...(sheet?{position:'absolute',left:0,right:0,bottom:0,height,zIndex:2,
      borderRadius:'24px 24px 0 0',boxShadow:'0 -4px 16px #00000012'}
      :{gridArea:'panel',overflow:'hidden'})}}>
    {sheet&&<Box sx={{display:'flex',alignItems:'center',px:2}}>
      <Box role="button" aria-label="시트 크기 조절" onPointerDown={onPointerDown}
        onPointerUp={onPointerUp} onPointerCancel={()=>{startY.current=null;}}
        onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();change(1);}}}
        tabIndex={0} sx={{minHeight:44,flex:1,touchAction:'none'}}>
        <Typography sx={{fontWeight:700}}>저장한 장소</Typography>
      </Box>
      <Button onClick={()=>setSnap(snap==='full'?'peek':'full')}>
        {snap==='full'?'접기':'목록 보기'}
      </Button>
    </Box>}
    <Box ref={scrollRef} sx={{overflow:'auto',overscrollBehavior:'contain',
      minHeight:0,flex:1}}>{children}</Box>
  </Box>;
}
```

가상 키보드가 열린 상태에서는 VisualViewport 높이를 사용해 root와 하단 조작을 보이는 영역에 맞춘다. layout-metrics에 다음 hook을 추가하고 ResponsiveTripLayout에서 `height:useViewportHeight()`의 반환값을 사용한다. window 접근은 snapshot/subscription 함수에 한정한다.

```ts
import { useSyncExternalStore } from 'react';
function subscribeViewport(notify:()=>void) {
  const viewport=window.visualViewport;
  window.addEventListener('resize',notify);
  viewport?.addEventListener('resize',notify);
  return()=>{
    window.removeEventListener('resize',notify);
    viewport?.removeEventListener('resize',notify);
  };
}
const viewportHeight=()=>Math.round(window.visualViewport?.height??window.innerHeight);
export function useViewportHeight():number {
  return useSyncExternalStore(subscribeViewport,viewportHeight,()=>800);
}
```

root 내부의 hook 호출은 `const viewportHeight=useViewportHeight()`로 분리해 모든 렌더에서 같은 순서로 실행한다. 시트 크기 변경은 padding만 갱신하고 fitBounds를 반복 호출하지 않는다.

포커스 계약은 다음과 같다. FocusTrap의 open은 상세 열림만 따른다. 너비가 바뀌어도 wrapper 종류나 open을 바꾸지 않으며 disableEnforceFocus만 변경한다. disableAutoFocus/disableRestoreFocus는 기본 false를 고정하고 열린 동안 바꾸지 않는다.

- overlay/bottom 상세는 aria-modal=true이고, 열리면 상세 호스트로 포커스를 이동한다. Tab/Shift+Tab은 상세 안에 머문다. 닫기/X/Escape/배경 닫기 후 열기 전 버튼으로 복귀한다.
- docked 상세는 aria-modal을 생략하고, Tab으로 다른 화면 요소로 나갈 수 있다. 열기·닫기 포커스 이동/복귀는 유지한다.
- 이름 입력/내보내기/가져오기/장소 메뉴가 MUI Modal/Popover를 열면 상세 트랩은 양보한다. 자식 팝업의 Escape가 상위 상세까지 닫지 않는다.
- 닫기 전에 열기 버튼이 제거되었으면 TripNavigation의 현재 선택 버튼으로 복귀하는 fallback을 추가한다. MUI 복귀 시도 뒤 body/연결 해제 요소뿐 아니라 **이미 닫힌 상세 host 안**에 focus가 남은 경우도 rAF fallback의 대상이다. 다른 유효한 외부 요소로 복귀했다면 가로채지 않는다. 같은 여행 안에서 너비만 바뀌는 경우 현재 입력의 focus/selection과 초안이 유지되어야 한다.

`detail-focus.ts`의 런타임 predicate는 MUI가 관리하는 팝업에 포커스를 양보한다. 열린 상세 자체는 MUI Modal을 새로 만들지 않으므로 이 predicate의 대상이 아니다.

```ts
export function detailFocusEnabled():boolean {
  return document.querySelector('.MuiModal-root:not(.MuiModal-hidden)')===null;
}
```

DetailSurface의 Escape 처리도 detailFocusEnabled()가 true인 경우에만 상위 닫기를 실행한다. 그 외에는 자식 MUI 팝업이 처리한다. 공식 [MUI Modal 포커스 설명](https://v7.mui.com/material-ui/react-modal/#focus-trap)과 설치본 FocusTrap 동작을 대조했다. 내부 primitive를 하나의 셸에서만 사용하며 새 패키지를 추가하지 않는다.

키보드 테스트를 trip-layout.test.tsx에 넣는다. 실제 ResizeObserver 테스트 stub은 기존 레이아웃 describe 설정을 재사용한다.

```tsx
it('modal 상세는 focus를 가두고 닫은 뒤 열기 버튼으로 돌려준다',async()=>{
  const store=createStore();
  function FocusHarness(){
    const [open,setOpen]=useState(false);
    return <ResponsiveTripLayout topBar={<button onClick={()=>setOpen(true)}>상세 열기</button>}
      map={<div>지도</div>} panel={<button>목록 버튼</button>}
      detail={{open,onClose:()=>setOpen(false),content:<div>
        <button>첫 입력</button><button onClick={()=>setOpen(false)}>상세 닫기</button>
      </div>}} view="map" layout="compact" unavailable={null}
      routeMapVisible={false} onMapPaddingChange={()=>{}}/>;
  }
  render(<Provider store={store}><FocusHarness/></Provider>);
  const opener=screen.getByRole('button',{name:'상세 열기'});
  await userEvent.click(opener);
  const first=screen.getByRole('button',{name:'첫 입력'});
  const last=screen.getByRole('button',{name:'상세 닫기'});
  first.focus();await userEvent.tab({shift:true});expect(last).toHaveFocus();
  last.focus();await userEvent.tab();expect(first).toHaveFocus();
  await userEvent.click(last);await waitFor(()=>expect(opener).toHaveFocus());
});
```

test imports에 useState/userEvent/screen/waitFor를 추가한다. Space로 시트 한 단계 전환 및 페이지 스크롤 없음, Escape 복귀, docked에서 Tab 이동, compact↔wide 입력 포커스 유지, NicknameDialog 중첩, 자식 Menu Escape, 열기 버튼 삭제 시 navigation fallback도 검증한다.

**복귀/중첩 테스트는 각각 독립 it로 둔다.** 공통 FocusHarness에 `removeOpener`, `popup:'none'|'menu'|'dialog'` 옵션을 추가한다. opener 삭제는 상세 안의 ‘열기 버튼 제거’ 버튼으로 일으키며, 셸의 실제 TripNavigation은 유지한다. Menu에는 최소 두 MenuItem, Dialog에는 TextField와 닫기 버튼을 넣고 실제 MUI 컴포넌트를 사용한다. 상세 content의 Escape 처리도 DetailSurface와 같은 detailFocusEnabled() 조건을 사용한다. MUI popup은 transition이 있으므로 숨김/복귀 assertion을 waitFor로 기다린다.

```tsx
it('열기 버튼이 없어지면 현재 보기 메뉴로 복귀한다',async()=>{
  renderFocusCase({removeOpener:true,popup:'none'});
  await userEvent.click(screen.getByRole('button',{name:'상세 열기'}));
  await userEvent.click(screen.getByRole('button',{name:'열기 버튼 제거'}));
  await userEvent.click(screen.getByRole('button',{name:'상세 닫기'}));
  await waitFor(()=>expect(within(screen.getByRole('navigation',{name:'보기 전환'}))
    .getByRole('button',{name:'지도',exact:true})).toHaveFocus());
});
it('중첩 Menu Escape는 Menu만 닫고 상세에 복귀한다',async()=>{
  renderFocusCase({removeOpener:false,popup:'menu'});
  await userEvent.click(screen.getByRole('button',{name:'상세 열기'}));
  const menuButton=screen.getByRole('button',{name:'장소 메뉴'});
  await userEvent.click(menuButton);
  await screen.findByRole('menu');
  await userEvent.keyboard('{Escape}');
  await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());
  expect(screen.getByRole('dialog',{name:'장소 상세'})).toBeVisible();
  await waitFor(()=>expect(menuButton).toHaveFocus());
});
it('중첩 Dialog Escape는 Dialog만 닫고 상세에 복귀한다',async()=>{
  renderFocusCase({removeOpener:false,popup:'dialog'});
  await userEvent.click(screen.getByRole('button',{name:'상세 열기'}));
  const dialogButton=screen.getByRole('button',{name:'닉네임 입력'});
  await userEvent.click(dialogButton);
  await screen.findByRole('dialog',{name:'닉네임'});
  await userEvent.keyboard('{Escape}');
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'닉네임'})).toBeNull());
  expect(screen.getByRole('dialog',{name:'장소 상세'})).toBeVisible();
  await waitFor(()=>expect(dialogButton).toHaveFocus());
});
```

`renderFocusCase`는 위 옵션을 받아 `<Provider store={createStore()}><FocusHarness .../></Provider>`를 render하는 테스트 helper다. FocusHarness는 기존 예제의 같은 ResponsiveTripLayout/map/detail host를 사용하고, popup의 open/anchor 상태는 content 안에서 관리한다. 제거된 opener를 restore하는 MUI effect보다 rAF fallback이 늦게 실행되는지 실제 timer로 확인한다. fake timer를 쓰면 rAF/transition을 act 안에서 진행하며 동기 focus 검사로 바꾸지 않는다. 테스트 import에 within·Menu/MenuItem·Dialog/TextField를 추가한다.

compact day/places에서는 시트를 쓰지 않고 전체 목록 영역을 쓴다. `onClose`와 닫기 아이콘·배경 클릭·Escape는 Task 9a DetailSurface에서 연결한다. 상세 호스트 앞에 `{props.detail.open && !dock && <Backdrop open onClick={props.detail.onClose} sx={{position:'fixed',zIndex:4}}/>}`를 추가하고 MUI Backdrop을 import한다. 배경 막은 지도/메뉴 클릭을 막으며, 호스트 크기 변경만으로 컴포넌트 종류를 교체하지 않는다.

- [ ] **Step 4:** 레이아웃 sentinel/목록 전용/스크롤 및 위 adapter·observer·event lifecycle 테스트를 통과시킨다. 실제 CSS 너비 검증은 Task 10에서 수행한다. map DOM이 CSS area 이동만으로 유지되는지 확인한다.
- [ ] **Step 5:** diff 확인·커밋: `feat: add responsive shell for three trip views`.

### Task 6: 실효 장소 요약·공통 일정 추가·장소 편집 액션

**Files:** Create `src/sections/explore/store/place-summary.ts`, `src/sections/explore/store/use-place-actions.ts`, `tests/unit/sections/place-summary.test.ts`, `tests/unit/components/place-actions.test.tsx`; Modify `src/sections/explore/view/PlaceCard.tsx`.

**Interfaces:**
- `PlaceSummary = {placeKey,name,category,emoji,memoCount,memoPreview,dayLabels,hidden}`.
- `summarizePlace(trip,edit,effective,placeKey): PlaceSummary | null`, `categoryEmoji(category): string`.
- `usePlaceActions(placeKey)` returns `setMemo(text|null)`, `setTags(tags)`, `setHidden(hidden)`, `addToDay(date)`; each returns `Promise<'saved'|'cancelled'|'limit'>` and throws actual storage/validation errors.
- Consumes `useEditActions`·`useTripStore`·`addStopToDay`·`overlay`·`LIMITS`. Writes only through existing `update`.

- [ ] **Step 1:** 요약과 한도 테스트를 쓴다.

```ts
import { describe, expect, it } from 'vitest';
import { makeTrip, makeEdit } from '../../fixtures/builders';
import { overlay } from 'src/domain/overlay';
import { summarizePlace } from 'src/sections/explore/store/place-summary';
describe('place summary', () => {
  it('삭제된 메모를 빼고 실제 일정 날짜를 중복 없이 표시한다', () => {
    const trip = makeTrip({days:{'2026-11-14':['A','A2'],'2026-11-15':['A3']}});
    const edit = makeEdit({places:{'n:1':{memos:{
      'a-local':{text:'내 메모',updatedAt:'2026-10-03T00:00:00.000Z'},
      other:{text:null,updatedAt:'2026-10-03T00:00:00.000Z'},
    }}}});
    const result = summarizePlace(trip,edit,overlay(trip,edit),'n:1');
    expect(result?.memoCount).toBe(1);
    expect(result?.memoPreview).toBe('내 메모');
    expect(result?.dayLabels).toEqual(['Day 1','Day 2']);
  });
  it('없는 장소에 가짜 카드를 만들지 않는다', () => {
    const trip = makeTrip({days:{}});
    expect(summarizePlace(trip,null,overlay(trip,null),'n:missing')).toBeNull();
  });
});
```

action harness는 기존 PlaceCard 테스트처럼 `createTripStore`, 메모리 Storage, 고정 now/nowIso, TripStoreContext·Provider를 사용한다. 닉네임 취소→`cancelled`/EditLayer 변경 없음, 50곳인 날 추가→`limit`/중복 stop id 없음, 두 번 추가→서로 다른 stop id, storage 예외→reject, 메모 권한→본인 authorId만 수정, 잘못된 date→reject를 테스트한다.

- [ ] **Step 2:** 신규 테스트 FAIL 확인.
- [ ] **Step 3:** 순수 요약을 구현한다.

```ts
import type { TripData } from 'src/schema/trip-data';
import type { EditLayer } from 'src/schema/edit-layer';
import type { EffectiveTrip } from 'src/domain/overlay';
import { dayName } from 'src/sections/itinerary/store/format';
export function categoryEmoji(category: string | null): string {
  const value = category ?? '';
  if (/카페|커피|디저트/.test(value)) return '☕';
  if (/숙박|호텔|펜션|모텔/.test(value)) return '🏨';
  if (/음식|식당|한식|중식|일식|분식/.test(value)) return '🍽️';
  if (/해변|바다|해수욕/.test(value)) return '🌊';
  if (/공원|산|자연/.test(value)) return '🌿';
  return '📍';
}
export type PlaceSummary = {
  placeKey:string; name:string; category:string; emoji:string; memoCount:number;
  memoPreview:string; dayLabels:string[]; hidden:boolean;
};
export function summarizePlace(
  trip:TripData, edit:EditLayer|null, effective:EffectiveTrip, placeKey:string,
):PlaceSummary|null {
  const place = trip.places[placeKey];
  if (!place) return null;
  const pe = edit?.places[placeKey];
  const mine = edit ? pe?.memos[edit.authorId]?.text : null;
  const user = Object.entries(pe?.memos ?? {}).sort(([a],[b])=>a.localeCompare(b))
    .flatMap(([,memo])=>memo.text === null ? [] : [memo.text]);
  const naver = (place.naverMemos ?? []).map(m=>m.memo);
  const candidates = [mine ?? '',...user,...naver];
  return {
    placeKey,name:place.name,category:place.category ?? '미분류',emoji:categoryEmoji(place.category),
    memoCount:user.length+naver.length,
    memoPreview:candidates.find(text=>text.trim().length>0)?.replace(/\s+/g,' ').trim() ?? '',
    dayLabels:effective.days.filter(day=>day.stops.some(s=>s.placeKey===placeKey))
      .map(day=>dayName(trip,day.date)),
    hidden:pe?.hidden?.value ?? false,
  };
}
```

- [ ] **Step 4:** `use-place-actions.ts`로 현재 PlaceCard의 저장 로직을 분리한다. 도메인 mutation 자체는 그대로 사용한다.

```ts
import { useStore } from 'jotai';
import { overlay } from 'src/domain/overlay';
import { LIMITS } from 'src/schema/common';
import type { EditLayer, PlaceEdit } from 'src/schema/edit-layer';
import { addStopToDay } from './add-stop';
import { useEditActions, useTripStore } from 'src/stores/trip-store';
export type PlaceActionResult = 'saved' | 'cancelled' | 'limit';
export function usePlaceActions(placeKey:string) {
  const ts = useTripStore();
  const store = useStore();
  const {ensureAuthor,update} = useEditActions();
  const patch = async (change:(p:PlaceEdit,now:string)=>PlaceEdit):Promise<PlaceActionResult> => {
    if (!store.get(ts.tripAtom)?.places[placeKey]) throw new RangeError('장소를 찾을 수 없어요');
    if (!await ensureAuthor()) return 'cancelled';
    const now = ts.nowIso();
    await update(e=>({ ...e,places:{...e.places,
      [placeKey]:change(e.places[placeKey] ?? {memos:{}},now)} }));
    return 'saved';
  };
  return {
    async setMemo(text:string|null):Promise<PlaceActionResult> {
      if (!store.get(ts.tripAtom)?.places[placeKey]) throw new RangeError('장소를 찾을 수 없어요');
      const value = text === null ? null : text.trim();
      if (value !== null && (!value || value.length>LIMITS.memoChars))
        throw new RangeError('메모는 1~2000자로 입력하세요');
      if (!await ensureAuthor()) return 'cancelled';
      const now = ts.nowIso();
      await update(e=>({ ...e,places:{...e.places,[placeKey]:{
        ...(e.places[placeKey] ?? {memos:{}}),memos:{...e.places[placeKey]?.memos,
          [e.authorId]:{text:value,updatedAt:now}} } } }));
      return 'saved';
    },
    async setTags(tags:string[]):Promise<PlaceActionResult> {
      const values=[...new Set(tags.map(tag=>tag.trim()))];
      if(values.length>LIMITS.tagsPerPlace||values.some(t=>!t||t.length>LIMITS.tagChars))
        throw new RangeError('태그 길이 또는 개수 제한을 넘었어요');
      return patch((p,now)=>({...p,tags:{value:values,updatedAt:now}}));
    },
    setHidden(value:boolean):Promise<PlaceActionResult> {
      return patch((p,now)=>({...p,hidden:{value,updatedAt:now}}));
    },
    async addToDay(date:string):Promise<PlaceActionResult> {
      const trip = store.get(ts.tripAtom);
      if(!trip||!trip.places[placeKey]||!trip.days.some(d=>d.date===date))
        throw new RangeError('장소 또는 날짜를 찾을 수 없어요');
      if(!await ensureAuthor()) return 'cancelled';
      let limited=false;
      const now=ts.nowIso();
      await update((e:EditLayer)=>{
        const count=overlay(trip,e).days.find(d=>d.date===date)?.stops.length ?? 0;
        if(count>=LIMITS.stopsPerDay){limited=true;return e;}
        return addStopToDay(trip,e,date,placeKey,now);
      });
      return limited?'limit':'saved';
    },
  };
}
```

PlaceCard의 액션 호출은 결과가 saved일 때만 완료 처리하고, 에러는 기존 `reportSaveError`로 한 번만 보고한다. JSX의 기존 네이버 메모·동행 메모·태그·숨김·외부 링크를 보존한다. 세 화면의 빠른 추가와 상세의 추가가 이 hook을 공유한다.

- [ ] **Step 5:** 요약/action/기존 place-card/중복 방문 테스트 PASS. 태그·메모 XSS를 문자열 JSX로 표시하는 기존 검증을 유지한다.
- [ ] **Step 6:** diff 확인·커밋: `refactor: share place summaries and saved edit actions`.

### Task 7: 포켓맵 목록·트립포켓 카드·필터 패널

**Files:** Modify `src/sections/explore/view/ExplorePanel.tsx`, `PlaceList.tsx`, `ExploreFilters.tsx`, `src/sections/explore/store/explore-state.ts`; Create `src/sections/explore/view/PlacesPanel.tsx`, `PlaceTile.tsx`, `FilterBar.tsx`, `tests/unit/components/places-panel.test.tsx`; Extend `tests/unit/sections/explore-filters.test.ts`.

**Interfaces:**
- 중간 커밋용 useExploreKeys 옵션은 `{readyGuard?:boolean}`이며 기본 false다. Task 9f 이후 최종 시그니처는 기존 `useExploreKeys():string[]`다.
- `PlaceTile({summary,onOpen,onAdd})` is presentational. `onAdd` opens `detailAtom={kind:'add',placeKey}`; it does not mutate a day without date selection.
- `PlacesPanel()` and `ExplorePanel()` consume the same `useExploreKeys()` and filters. `placeDisplayAtom` selects grid/list.
- `FilterBar()` selects up to three actual categoryCounts categories. Folders and categories remain different filter fields.
- `mapViewportUsableAtom: PrimitiveAtom<boolean>` added to `explore-state.ts` is set by ReadyTrip/MapView in Task 9d.

- [ ] **Step 1:** 카드/목록 선택, 메모 검색, 실제 일정 badge·빠른 추가, 상세 필터 조건 보존 테스트를 작성한다.

```tsx
// places-panel.test.tsx harness는 기존 PlaceCard 테스트의 createTripStore/Provider 패턴을 사용한다.
it('카드 빠른 추가는 날짜 선택 패널을 연다', async () => {
  const trip=makeTrip({days:{'2026-11-14':['A']},places:['B']});
  const {store}=setupPlaces(trip,makeEdit());
  await userEvent.click(screen.getByRole('button',{name:'B 일정에 추가'}));
  expect(store.get(detailAtom)).toEqual({kind:'add',placeKey:'n:2'});
});
it('카드를 열어도 목록 안에 메모 편집 폼을 중복 생성하지 않는다', async () => {
  const {store}=setupPlaces(makeTrip({days:{'2026-11-14':['A']}}),makeEdit());
  await userEvent.click(screen.getByRole('button',{name:'A 상세'}));
  expect(store.get(selectedPlaceAtom)).toBe('n:1');
  expect(store.get(detailAtom)).toEqual({kind:'place',placeKey:'n:1'});
  expect(screen.queryByLabelText('내 메모')).toBeNull();
});
```

테스트 파일에 다음 setupPlaces를 정의한다. import에는 React Testing Library의 render/screen, userEvent, Jotai createStore/Provider, Vitest expect/it, AppProviders, createMemoryStorage/storageKey, TripData/EditLayer, createTripStore/TripStoreContext, PlacesPanel, detailAtom, selectedPlaceAtom, fixtures의 makeTrip/makeEdit를 포함한다.

```tsx
function setupPlaces(trip: TripData, edit: EditLayer) {
  const storage = createMemoryStorage();
  storage.setItem(storageKey('testtrip0001'), JSON.stringify(edit));
  const ts = createTripStore('testtrip0001', {
    storage, locks: undefined,
    now: () => 1759460000000,
    nowIso: () => '2026-10-03T02:00:00.000Z',
  });
  const store = createStore();
  store.set(ts.tripAtom, trip);
  store.set(ts.editLayerAtom, edit);
  render(<AppProviders><TripStoreContext value={ts}><Provider store={store}>
    <PlacesPanel />
  </Provider></TripStoreContext></AppProviders>);
  return { store, ts, storage };
}
```

- [ ] **Step 2:** 신규 테스트 FAIL 확인.
- [ ] **Step 3:** 카드와 목록을 연결한다.

```tsx
// PlaceTile.tsx: imports Box/Button/Typography/Chip, CalendarPlusIcon,
// PlaceSummary type. 외부 사진·배경 이미지가 없는 순수 표현 컴포넌트.
export function PlaceTile({summary,onOpen,onAdd}:{
  summary:PlaceSummary;onOpen():void;onAdd():void;
}) {
  return <Box component="article" sx={{borderRadius:3,overflow:'hidden',
    border:'1px solid #ebe7f2',bgcolor:'#fff',minWidth:0}}>
    <Button aria-label={`${summary.name} 상세`} onClick={onOpen}
      sx={{display:'block',textAlign:'left',width:'100%',p:0,color:'inherit'}}>
      <Box sx={{height:72,bgcolor:'#f0ecfa',display:'flex',alignItems:'center',
        justifyContent:'center',fontSize:28}}>{summary.emoji}</Box>
      <Box sx={{p:1.25,pb:0}}>
        <Typography sx={{fontSize:14,fontWeight:700,overflowWrap:'anywhere'}}>{summary.name}</Typography>
        <Typography variant="caption">{summary.category} · 💬 {summary.memoCount}</Typography>
        <Typography variant="caption" component="div" noWrap>{summary.memoPreview || '메모 없음'}</Typography>
        <Box sx={{display:'flex',gap:0.5,flexWrap:'wrap',mt:0.5}}>
          {summary.dayLabels.slice(0,2).map(label=><Chip key={label} size="small" label={label} />)}
          {summary.dayLabels.length>2 && <Typography variant="caption">+{summary.dayLabels.length-2}</Typography>}
        </Box>
      </Box>
    </Button>
    <Button aria-label={`${summary.name} 일정에 추가`} onClick={onAdd}
      startIcon={<CalendarPlusIcon width={20} height={20} />} sx={{fontSize:12,minHeight:44}}>
      일정에 추가
    </Button>
  </Box>;
}
```

ExplorePanel은 compact 경로에서 FilterBar와 요약 목록을 제공한다. 기존 경로와 새 경로가 같은 검색/필터 atom을 사용한다.

```tsx
import Box from '@mui/material/Box';
import { useExploreKeys } from '../store/explore-state';
import { ExploreFilters } from './ExploreFilters';
import { PlaceList } from './PlaceList';
import { FilterBar } from './FilterBar';
export function ExplorePanel({compact=false}:{compact?:boolean}) {
  const keys=useExploreKeys({readyGuard:compact});
  return <Box data-testid="explore-panel">
    {compact?<FilterBar/>:<ExploreFilters/>}
    <PlaceList keys={keys} compact={compact}/>
  </Box>;
}
```

PlacesPanel은 검색·폴더·필터·카드/목록을 연결한다. 아래 코드를 사용한다.

```tsx
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTripStore } from 'src/stores/trip-store';
import { selectedPlaceAtom, searchQueryAtom } from 'src/stores/ui-store';
import { detailAtom, placeDisplayAtom } from 'src/sections/views/store/view-session';
import { exploreFilterAtom, useExploreKeys } from '../store/explore-state';
import { summarizePlace } from '../store/place-summary';
import { FilterBar } from './FilterBar';
import { PlaceList } from './PlaceList';
import { PlaceTile } from './PlaceTile';
export function PlacesPanel() {
  const ts=useTripStore();
  const trip=useAtomValue(ts.tripAtom);
  const edit=useAtomValue(ts.editLayerAtom);
  const effective=useAtomValue(ts.effectiveTripAtom);
  const keys=useExploreKeys({readyGuard:true});
  const [display,setDisplay]=useAtom(placeDisplayAtom);
  const [query,setQuery]=useAtom(searchQueryAtom);
  const [filter,setFilter]=useAtom(exploreFilterAtom);
  const setSelectedPlace=useSetAtom(selectedPlaceAtom);
  const setDetail=useSetAtom(detailAtom);
  if(!trip||!effective)return null;
  const summaries=keys.flatMap(key=>{
    const summary=summarizePlace(trip,edit,effective,key);
    return summary?[summary]:[];
  });
  const open=(key:string)=>{
    setSelectedPlace(key);setDetail({kind:'place',placeKey:key});
  };
  return <Box data-testid="places-panel">
    <TextField fullWidth placeholder="장소·메모·태그 검색" value={query}
      onChange={e=>setQuery(e.target.value)}
      slotProps={{htmlInput:{'aria-label':'검색','data-trip-search':true}}}/>
    <Box sx={{display:'flex',gap:0.75,p:1,overflowX:'auto'}}>
      {trip.folders.map(folder=><Chip key={folder.id} label={folder.name}
        aria-pressed={filter.folderIds.includes(folder.id)} onClick={()=>setFilter(f=>({
          ...f,folderIds:f.folderIds.includes(folder.id)?f.folderIds.filter(id=>id!==folder.id)
            :[...f.folderIds,folder.id],
        }))}/>)}
    </Box>
    <FilterBar/>
    <ToggleButtonGroup exclusive value={display} aria-label="장소 표시 방식"
      onChange={(_e,next:'grid'|'list'|null)=>{if(next)setDisplay(next);}}>
      <ToggleButton value="grid">카드</ToggleButton><ToggleButton value="list">목록</ToggleButton>
    </ToggleButtonGroup>
    {display==='list'?<PlaceList keys={keys} compact/>:
      <Box sx={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',
        '@media (min-width:768px)':{gridTemplateColumns:'repeat(auto-fit,minmax(160px,280px))'},
        gap:1.25,p:1.5}}>
        {summaries.map(summary=><PlaceTile key={summary.placeKey} summary={summary}
          onOpen={()=>open(summary.placeKey)}
          onAdd={()=>setDetail({kind:'add',placeKey:summary.placeKey})}/>) }
      </Box>}
    {keys.length===0&&<Typography sx={{p:2}}>조건에 맞는 장소가 없어요</Typography>}
  </Box>;
}
```

MUI 기본 `md=900`과 앱 split=768의 차이를 만들지 않도록 card columns는 `sx` 안의 `@media (min-width:768px)`로 설정한다. 나머지 반응형 판단은 layout-metrics를 사용한다. `auto-fit`을 써서 소수 카드가 무한히 커지지 않도록 카드 최대 폭 280px를 둔다.

PlaceList는 compact=true 경로에서 내부 `{isSelected && <PlaceCard/>}`를 렌더하지 않는다. 기존 경로는 Task 9f까지 보존한다. 새 행에는 `aria-label={`${name} 상세`}`를 지정하고 기존 선택+mapFocus 요청을 유지한다. 행 click은 `detailAtom`을 열고 `selectedPlaceScrollRequestAtom`을 증가시킨다. marker 선택도 같은 요청 번호를 증가시킨다. effect의 의존성을 `[selected,request]`로 두되 처음 mount는 자동 스크롤하지 않고 새 request에만 반응한다.

`FilterBar`는 categoryCounts 상위 세 항목과 상세 필터 버튼만 기본 노출한다. 폴더·카테고리·태그·일정 포함·메모·숨김·지도 영역 조건은 기존 `ExploreFilters`를 공통 상세 패널에서 보여준다. 선택 개수 badge를 표시하고 모든 필터 해제 버튼은 `DEFAULT_FILTER`로 복구하되 검색어도 명시적으로 비운다.

FilterBar.tsx 구현:

```tsx
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FilterIcon from '~icons/mdi/filter-variant';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTripStore } from 'src/stores/trip-store';
import { searchQueryAtom } from 'src/stores/ui-store';
import { detailAtom } from 'src/sections/views/store/view-session';
import { exploreFilterAtom } from '../store/explore-state';
import { categoryCounts, DEFAULT_FILTER } from '../store/filters';
export function FilterBar() {
  const ts=useTripStore();
  const trip=useAtomValue(ts.tripAtom);
  const [filter,setFilter]=useAtom(exploreFilterAtom);
  const [query,setQuery]=useAtom(searchQueryAtom);
  const setDetail=useSetAtom(detailAtom);
  if(!trip)return null;
  const count=filter.folderIds.length+filter.categories.length+filter.tags.length
    +Number(filter.hasMemo)+Number(filter.inItinerary!=='any')+Number(filter.showHidden)
    +Number(filter.inViewOnly)+Number(query.trim().length>0);
  return <Box sx={{display:'flex',gap:0.75,p:1,overflowX:'auto',alignItems:'center'}}>
    {categoryCounts(trip).slice(0,3).map(({category})=><Chip key={category}
      label={category} aria-pressed={filter.categories.includes(category)}
      onClick={()=>setFilter(f=>({...f,categories:f.categories.includes(category)
        ?f.categories.filter(c=>c!==category):[...f.categories,category]}))}/>)}
    <Button startIcon={<FilterIcon width={20} height={20}/>}
      sx={{flexShrink:0}} onClick={()=>setDetail({kind:'filter'})}>
      필터{count>0?` ${count}`:''}
    </Button>
    {count>0&&<Button sx={{flexShrink:0}} onClick={()=>{
      setFilter({...DEFAULT_FILTER});setQuery('');
    }}>모두 해제</Button>}
  </Box>;
}
```

- [ ] **Step 4:** 지도 영역 필터를 안전하게 제한한다.

```ts
// explore-state.ts
export const mapViewportUsableAtom = atom(false);
// Task 7의 useExploreKeys({readyGuard=false}={}) 내부에 추가한다.
// PlacesPanel/compact ExplorePanel은 readyGuard=true를 전달한다.
// Task 9f에서 이 임시 옵션을 삭제하고 usable 조건을 항상 적용한다.
const view = useAtomValue(viewModeAtom);
const usable = useAtomValue(mapViewportUsableAtom);
const effectiveFilter = {
  ...filter, query,
  inViewOnly:filter.inViewOnly && view==='map' && (readyGuard ? usable : true),
};
return filterPlaces(trip,edit,eff,effectiveFilter,bounds ?? undefined);
```

Task 7의 ExploreFilters는 compact=true 경로에서만 `view!=='map'||!usable`일 때 지도 영역 체크를 disabled 처리한다. Task 9f에서 compact 분기를 제거해 항상 적용한다. 이미 체크된 의도는 지우지 않고 `지도 보기에서 적용돼요` 문구를 표시한다. 숨겨진 지도 경계를 적용해 장소 뷰가 비는 일을 막는다.

- [ ] **Step 5:** 신규 카드/필터/기존 PlaceCard 회귀 테스트 PASS. 사용자 메모·네이버 메모·주소·태그 검색이 기존대로 작동해야 한다. 기본 목록 상단에서 세부 필터가 카드 첫 행을 밀어내지 않는지 Task 10에서 확인한다.
- [ ] **Step 6:** diff 확인·커밋: `feat: add map summaries and emoji place collections`.

### Task 8: 데이패스 날짜·compact 방문·공통 방문 편집

**Files:** Modify `src/sections/itinerary/view/DayTabs.tsx`, `Timeline.tsx`, `ItineraryPanel.tsx`, `DayTotals.tsx`; Create `src/sections/itinerary/view/StopEditPanel.tsx`, `tests/unit/components/stop-edit-panel.test.tsx`; Extend `tests/unit/components/timeline.test.tsx`.

**Interfaces:**
- `StopEditPanel({date,stopId,onClose})` uses `stopDraftsAtom`; reads the latest `effectiveTripAtom`; writes using existing `updateStop` + `useEditActions().update`.
- `Timeline` consumes `itineraryEditingAtom`. Browsing shows number·time·name·memo summary·⋯; edit mode additionally shows existing dnd-kit drag handle.
- Actions use existing `reorderStops`, `moveStop`, `removeStop` and group revert. Add ‘한 칸 위로/아래로’ without adding a second reorder algorithm.

- [ ] **Step 1:** 표시와 초안·저장 테스트를 추가한다.

```tsx
// timeline.test.tsx의 store를 반환하는 기존 harness 안.
it('조회 상태에는 드래그 손잡이가 없고 편집 상태에서 나타난다', async () => {
  const {store}=setupCompactTimeline();
  expect(screen.queryByRole('button',{name:'A 순서 바꾸기'})).toBeNull();
  act(()=>store.set(itineraryEditingAtom,true));
  expect(screen.getByRole('button',{name:'A 순서 바꾸기'})).toBeVisible();
});
// stop-edit-panel.test.tsx에서 provider/ts를 설정한 신규 harness 안.
it('HH:mm 오류는 저장하지 않고 draft를 유지한다', async () => {
  const {store,storage}=setupStopEditor();
  const before = storage.getItem(storageKey('testtrip0001'));
  await userEvent.clear(screen.getByLabelText('A 시간'));
  await userEvent.type(screen.getByLabelText('A 시간'),'25:61');
  await userEvent.click(screen.getByRole('button',{name:'저장',exact:true}));
  expect(screen.getByText('시간은 HH:mm 형식으로 입력하세요')).toBeVisible();
  expect(store.get(stopDraftsAtom).a000?.time).toBe('25:61');
  expect(storage.getItem(storageKey('testtrip0001'))).toBe(before);
});
```

두 파일의 독립 테스트에는 아래 harness를 각각 필요한 부분과 함께 둔다. React Testing Library의 render/act/screen, React의 ReactNode 타입, Jotai createStore/Provider, AppProviders, fixture 타입/생성기, createMemoryStorage/storageKey, createTripStore/TripStoreContext, useItineraryDays, Timeline, StopEditPanel, stopDraftsAtom/itineraryEditingAtom을 import한다. 기존 timeline의 renderPage는 그대로 유지한다.

```tsx
function setupItineraryPiece(node: ReactNode, trip: TripData) {
  const storage = createMemoryStorage();
  const edit = makeEdit();
  storage.setItem(storageKey('testtrip0001'), JSON.stringify(edit));
  const ts = createTripStore('testtrip0001', {
    storage, locks: undefined,
    now: () => 1759460000000,
    nowIso: () => '2026-10-03T02:00:00.000Z',
  });
  const store = createStore();
  store.set(ts.tripAtom, trip);
  store.set(ts.editLayerAtom, edit);
  store.set(stopDraftsAtom, { a000: { date: '2026-11-14', time: '', note: '' } });
  render(<AppProviders><TripStoreContext value={ts}><Provider store={store}>
    {node}
  </Provider></TripStoreContext></AppProviders>);
  return { store, storage, ts };
}
function CompactTimelineHarness({trip}:{trip:TripData}) {
  const days = useItineraryDays();
  return days[0] ? <Timeline trip={trip} item={days[0]} compact /> : null;
}
function setupCompactTimeline() {
  const trip = makeTrip({days:{'2026-11-14':['A','B']}});
  return setupItineraryPiece(<CompactTimelineHarness trip={trip}/>, trip);
}
function setupStopEditor() {
  const trip = makeTrip({days:{'2026-11-14':['A']}});
  return setupItineraryPiece(
    <StopEditPanel date="2026-11-14" stopId="a000" onClose={() => {}}/>, trip,
  );
}
```

추가: 같은 placeKey의 서로 다른 stopId 편집 분리, 취소→초안 제거, 패널 닫기→초안 유지, save 실패/닉네임 취소→초안 유지, 성공→해당 stop 초안만 제거, 다른 탭에서 stop 삭제/다른 날 이동→‘방문 정보가 변경됐어요. 다시 선택하세요’ 표시·쓰기 없음, 빈 시간/노트는 null patch, 순서 변경 후 미계산 표시, 다른 날 50곳이면 move 거부, 날짜 전체 보기와 빈 일정, 원본 그룹 되돌리기.

- [ ] **Step 2:** 신규·변경 테스트 FAIL 확인. 신규 compact dnd 테스트는 `itineraryEditingAtom=true`로 실행한다. 기존 전체 페이지 테스트는 Task 9d 통합 때 편집 모드 진입을 추가한다.
- [ ] **Step 3:** `Timeline`의 행을 compact하게 바꾼다. 기존 stop id와 메뉴/저장 함수를 유지하고 다음 JSX를 사용한다.

```tsx
const editingMode = useAtomValue(itineraryEditingAtom) || !compact;
const setDetail = useSetAtom(detailAtom);
const setDrafts = useSetAtom(stopDraftsAtom);
const openEditor = () => {
  setDrafts(drafts => drafts[stop.id] ? drafts : ({...drafts,
    [stop.id]:{date,time:stop.time ?? '',note:stop.note ?? ''}}));
  setDetail({kind:'stop',date,stopId:stop.id});
};
<Stack direction="row" spacing={1} sx={{alignItems:'center',py:0.75}}
  data-stop-id={stop.id} data-stop-name={name}>
  {editingMode && <IconButton ref={setActivatorNodeRef}
    aria-label={`${name} 순서 바꾸기`} {...attributes} {...listeners}
    sx={{touchAction:'none',cursor:'grab'}}><DragIcon width={20} height={20} /></IconButton>}
  <Box sx={{minWidth:28,fontWeight:700}}>{circled(position+1)}</Box>
  <Box sx={{flex:1,minWidth:0}}>
    <Typography variant="caption" color="primary">{stop.time ?? '시간 미정'}</Typography>
    <Typography sx={{fontWeight:600,overflowWrap:'anywhere'}}>{name}</Typography>
    {stop.note && <Typography variant="caption" noWrap>{stop.note}</Typography>}
  </Box>
  <IconButton aria-label={`${name} 메뉴`} onClick={e=>setMenuAnchor(e.currentTarget)}>
    <MoreIcon width={22} height={22} />
  </IconButton>
</Stack>
// 기존 Menu의 날짜 이동/빼기를 보존하며 항목을 추가한다.
<MenuItem onClick={()=>{setMenuAnchor(null);openEditor();}}>시간·메모 편집</MenuItem>
<MenuItem disabled={position===0} onClick={()=>{
  setMenuAnchor(null);save((t,e,now)=>reorderStops(t,e,date,stop.id,position-1,now));
}}>한 칸 위로</MenuItem>
<MenuItem disabled={position===dayStopCount-1} onClick={()=>{
  setMenuAnchor(null);save((t,e,now)=>reorderStops(t,e,date,stop.id,position+1,now));
}}>한 칸 아래로</MenuItem>
```

`RowProps`에 `dayStopCount:number`를 추가하고 Timeline에서 `day.stops.length`를 전달한다. compact=true 경로에서는 공통 StopEditPanel을 열고, false 경로는 기존 inline StopEditor와 드래그 손잡이를 유지한다. Task 9f에서 기존 경로와 editing local state를 제거한다. Timeline/StopRow/DaySection에 compact 값을 전달한다. `attributes/listeners`는 손잡이에만 붙여 스크롤·⋯ 버튼 조작과 충돌하지 않게 한다.

- [ ] **Step 4:** 날짜와 일정 header를 정리한다.

```tsx
// DayTabs: 기존 value/key/onChange/전체 탭을 유지한다.
<Tab key={d.date} value={d.date} label={
  <Box><Typography variant="caption">{dayjs(d.date).locale('ko').format('MM.DD ddd')}</Typography>
    <Typography sx={{fontSize:14,fontWeight:700}}>{dayName(trip,d.date)}</Typography></Box>
} aria-label={dayName(trip,d.date)} />
```

dayjs 한국어 locale를 파일에서 import하고 `.locale('ko')`를 사용한다. `전체` 탭은 유지한다. DaySection의 title 옆에 편집/완료 버튼을 두어 `itineraryEditingAtom`을 토글한다. 날짜 변경·뷰 변경 시 편집 모드는 false로 돌아가되 초안은 지우지 않는다. ‘동선 지도 보기/접기’는 `mobileRouteMapAtom`을 토글하며 compact에서만 노출한다. 새 메뉴의 뷰 전환 이벤트, 날짜 탭의 onChange 및 URL에서 뷰/날짜를 적용하는 분기에 `setItineraryEditing(false)`를 연결한다. 초안 atom은 건드리지 않는다.

첫 번째 방문 강조는 선택한 단일 날짜에만 작게 표시한다. 실제 첫 stop의 `naverPlaceUrl`이 있을 때만 ‘네이버에서 보기’를 제공한다. 시간은 stop.time이 있을 때만 표시한다. 전체 날짜 보기·빈 날에 가짜 장소나 이동 시간을 넣지 않는다. `DayTotals`·`LegRow`의 실제 `dayTotals`/`formatTotals`/`formatLeg`를 그대로 사용하고 미계산·직선·재계산 문구를 생략하지 않는다.

- [ ] **Step 5:** StopEditPanel의 저장 핵심을 구현한다. props date/stopId와 최신 eff에 모두 일치하는 stop이 있을 때만 저장한다.

```tsx
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { overlay } from 'src/domain/overlay';
import { HHmm } from 'src/schema/common';
import { useEditActions, useTripStore } from 'src/stores/trip-store';
import { stopDraftsAtom } from 'src/sections/views/store/view-session';
import { updateStop } from '../store/itinerary-actions';
import { reportSaveError } from '../store/itinerary-state';
export function StopEditPanel({date,stopId,onClose}:{
  date:string;stopId:string;onClose():void;
}) {
  const [drafts,setDrafts]=useAtom(stopDraftsAtom);
  const store=useStore();
  const ts=useTripStore();
  const trip=useAtomValue(ts.tripAtom);
  const effective=useAtomValue(ts.effectiveTripAtom);
  const {ensureAuthor,update}=useEditActions();
  const draft=drafts[stopId];
  const stop=effective?.days.find(d=>d.date===date)?.stops.find(s=>s.id===stopId);
  const [error,setError]=useState<string|null>(null);
  const [saving,setSaving]=useState(false);
  const clear=()=>setDrafts(all=>{const next={...all};delete next[stopId];return next;});
  const change=(field:'time'|'note',value:string)=>setDrafts(all=>{
    const current=all[stopId];
    return current?{...all,[stopId]:{...current,[field]:value}}:all;
  });
  if(!trip||!stop||!draft||draft.date!==date)return <Box sx={{p:2}}>
    <Alert severity="warning">방문 정보가 변경됐어요. 다시 선택하세요</Alert>
    <Button onClick={onClose}>돌아가기</Button>
  </Box>;
  const name=trip.places[stop.placeKey]?.name??stop.placeKey;
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(saving)return;
    const t=draft.time.trim(),n=draft.note.trim();
    if(t!==''&&!HHmm.safeParse(t).success){setError('시간은 HH:mm 형식으로 입력하세요');return;}
    const exists=()=>store.get(ts.effectiveTripAtom)?.days
      .find(d=>d.date===date)?.stops.some(s=>s.id===stopId);
    if(!exists()){setError('방문 정보가 변경됐어요. 다시 선택하세요');return;}
    setSaving(true);
    try{
      if(!await ensureAuthor())return;
      const latestTrip=store.get(ts.tripAtom);
      if(!latestTrip||!exists()){setError('방문 정보가 변경됐어요. 다시 선택하세요');return;}
      const now=ts.nowIso();
      await update(e=>{
        if(!overlay(latestTrip,e).days.find(d=>d.date===date)?.stops.some(s=>s.id===stopId))
          throw new Error('방문 정보가 변경됐어요. 다시 선택하세요');
        return updateStop(latestTrip,e,date,stopId,{time:t||null,note:n||null},now);
      });
      clear();onClose();toast.success('방문을 수정했어요');
    }catch(e){reportSaveError(e);}finally{setSaving(false);}
  };
  return <Box component="form" onSubmit={event=>void save(event)} sx={{p:2}}>
    {error&&<Alert severity="error">{error}</Alert>}
    <TextField fullWidth label={`${name} 시간`} value={draft.time}
      onChange={event=>change('time',event.target.value)} placeholder="HH:mm" sx={{mb:2}}/>
    <TextField fullWidth multiline label={`${name} 메모`} value={draft.note}
      onChange={event=>change('note',event.target.value)} minRows={3}/>
    <Button disabled={saving} onClick={()=>{clear();onClose();}}>취소</Button>
    <Button type="submit" disabled={saving}>저장</Button>
  </Box>;
}
```

폼은 ‘시간’·‘메모’ controlled TextField에 각각 draft.time/draft.note를 넣고 onChange에서 해당 stop 초안만 변경한다. 취소는 clear+onClose, 닫기(X/배경/Escape)는 onClose만 실행한다. saving 중 저장 버튼을 disabled하고 실패 시 폼을 닫지 않는다. 현재 방문이 삭제/이동됐으면 폼 대신 변경 안내와 닫기만 제공한다.

- [ ] **Step 6:** 일정/방문/되돌리기 회귀 테스트 PASS. 새 UI 때문에 기존 테스트 selector를 바꾸더라도 저장·병합·미계산·묶음 되돌리기 assertion은 유지한다.
- [ ] **Step 7:** diff 확인·커밋: `feat: add compact day itinerary and persistent stop editing`.

### Task 9a: 공통 상세와 날짜 추가

**Files:** Create `src/sections/views/view/DetailSurface.tsx`, `tests/unit/components/detail-surface.test.tsx`. 기존 ReadyTrip 연결은 9d까지 유지한다.

**Interfaces:** `DetailSurface({onClose,modal=true})`는 DetailState별 PlaceCard/ExploreFilters/StopEditPanel/AddToDayPanel을 제공한다. 날짜 추가는 Task 6의 Promise 결과를 따르며 saved 때만 닫는다. `modal=false`는 docked 상세이며 aria-modal을 부여하지 않는다.

- [ ] **Step 1:** 독립 Provider에서 날짜 추가 성공·한도·닉네임 취소·저장 실패를 검증한다. detail-surface.test.tsx에 다음 harness를 둔다. imports: React Testing Library render/screen/waitFor, userEvent, Jotai createStore/Provider, Vitest it/expect, AppProviders, createTripStore/TripStoreContext, createMemoryStorage/storageKey, overlay, makeTrip/makeEdit, detailAtom, DetailSurface.

```tsx
function renderAddDetail() {
  const trip=makeTrip({days:{'2026-11-14':[]},places:['A']});
  const edit=makeEdit();
  const storage=createMemoryStorage();
  storage.setItem(storageKey('testtrip0001'),JSON.stringify(edit));
  const ts=createTripStore('testtrip0001',{storage,locks:undefined,
    now:()=>1759460000000,nowIso:()=> '2026-10-03T02:00:00.000Z'});
  const store=createStore();
  store.set(ts.tripAtom,trip);store.set(ts.editLayerAtom,edit);
  store.set(detailAtom,{kind:'add',placeKey:'n:1'});
  const onClose=()=>store.set(detailAtom,null);
  render(<AppProviders><TripStoreContext value={ts}><Provider store={store}>
    <DetailSurface onClose={onClose}/>
  </Provider></TripStoreContext></AppProviders>);
  return {trip,store,storage};
}
it('날짜 추가는 저장 성공 후 닫는다',async()=>{
  const {trip,store,storage}=renderAddDetail();
  await userEvent.click(screen.getByRole('button',{name:'Day 1 (11/14)'}));
  await waitFor(()=>expect(store.get(detailAtom)).toBeNull());
  const edit=JSON.parse(storage.getItem(storageKey('testtrip0001'))!);
  expect(overlay(trip,edit).days[0]?.stops[0]?.placeKey).toBe('n:1');
});
```

- [ ] **Step 2:** `yarn test tests/unit/components/detail-surface.test.tsx` → 새 모듈 부재 FAIL.

- [ ] **Step 3:** DetailSurface의 종류별 내용을 연결한다.

```tsx
// imports: Box/Button/IconButton/Typography/Divider, CloseIcon,
// React useState, useAtom/useAtomValue, detailAtom, useTripStore, PlaceCard/ExploreFilters/StopEditPanel,
// usePlaceActions, dayLabel, toast, reportSaveError, detailFocusEnabled from src/layouts/detail-focus.
export function DetailSurface({onClose,modal=true}:{onClose():void;modal?:boolean}) {
  const detail=useAtomValue(detailAtom);
  if(!detail)return null;
  const title=detail.kind==='filter'?'필터':detail.kind==='add'?'일정에 추가':
    detail.kind==='stop'?'방문 편집':'장소 상세';
  return <Box role="dialog" aria-label={title} aria-modal={modal?true:undefined}
    onKeyDown={e=>{if(e.key==='Escape'&&detailFocusEnabled()){e.stopPropagation();onClose();}}}>
    <Box sx={{display:'flex',alignItems:'center',justifyContent:'space-between',px:2,pt:1}}>
      <Typography component="h2" sx={{fontWeight:700}}>{title}</Typography>
      <IconButton aria-label="닫기" onClick={onClose}><CloseIcon width={22} height={22}/></IconButton>
    </Box><Divider />
    {detail.kind==='place'&&<PlaceCard placeKey={detail.placeKey}/>}
    {detail.kind==='filter'&&<ExploreFilters/>}
    {detail.kind==='add'&&<AddToDayPanel placeKey={detail.placeKey} onClose={onClose}/>}
    {detail.kind==='stop'&&<StopEditPanel date={detail.date} stopId={detail.stopId} onClose={onClose}/>}
  </Box>;
}
function AddToDayPanel({placeKey,onClose}:{placeKey:string;onClose():void}) {
  const ts=useTripStore();
  const trip=useAtomValue(ts.tripAtom);
  const {addToDay}=usePlaceActions(placeKey);
  const [saving,setSaving]=useState(false);
  if(!trip||!trip.places[placeKey])return <Typography sx={{p:2}}>장소를 찾을 수 없어요</Typography>;
  const add=async(date:string)=>{
    if(saving)return;setSaving(true);
    try{
      const result=await addToDay(date);
      if(result==='saved'){onClose();toast.success('일정에 추가했어요');}
      else if(result==='limit')toast.error('하루에 50곳까지 넣을 수 있어요');
    }catch(e){reportSaveError(e);}finally{setSaving(false);}
  };
  return <Box sx={{p:2}}>
    <Typography sx={{mb:1}}>{trip.places[placeKey].name}</Typography>
    {trip.days.map(day=><Button key={day.date} fullWidth disabled={saving}
      onClick={()=>void add(day.date)} sx={{justifyContent:'flex-start',minHeight:48}}>
      {dayLabel(trip,day.date)}
    </Button>)}
  </Box>;
}
```

상세 없는 동안도 shell의 detail 호스트 위치는 유지하되 content만 null로 한다. 장소 상세와 stop 편집은 local state 대신 session atom의 초안을 쓰므로 종류 전환 후에도 입력을 복원할 수 있다. 공통 패널의 닫기는 detailAtom만 null로 바꾼다.


- [ ] **Step 4:** 위 테스트와 place-actions 회귀 PASS. 상세 kind 변경과 닫기로 메모/방문 초안이 지워지지 않는지 확인한다.
- [ ] **Step 5:** diff 확인·커밋: `feat: add shared detail surface and date selection`.

### Task 9b: PlaceCard의 메모·태그 초안 연결

**Files:** Modify `src/sections/explore/view/PlaceCard.tsx`, `src/sections/views/view/DetailSurface.tsx`; Extend `tests/unit/components/place-card.test.tsx`.

**Interfaces:** MemoForm의 onSave는 Promise<PlaceActionResult>다. 닫기는 초안을 남기고 명시적 취소/저장 성공은 해당 초안만 지운다. 임시 `sharedDetails?:boolean` 기본 false를 PlaceCard에 추가한다. true인 상세만 날짜 선택을 detailAtom으로 연다. 기존 일정 추가 Menu는 9f까지 유지해 중간 커밋의 동작을 보존한다.

- [ ] **Step 1:** 기존 setupCard 반환값의 rerender를 사용해 미저장 폼 복원을 검증한다. tests에 TripStoreContext/Provider를 같은 store로 유지하는 아래 노드를 사용한다.

```tsx
it('상세가 사라졌다 다시 나타나도 메모 초안을 복원한다',async()=>{
  const trip=makeTrip({days:{'2026-11-14':['A']}});
  const {ts,store,rerender}=setupCard(trip,makeEdit());
  await userEvent.click(screen.getByRole('button',{name:'메모 추가'}));
  await userEvent.type(screen.getByLabelText('내 메모'),'작성 중');
  const wrap=(open:boolean)=><TripStoreContext value={ts}><Provider store={store}>
    {open&&<PlaceCard placeKey="n:1"/>}
  </Provider></TripStoreContext>;
  rerender(wrap(false));rerender(wrap(true));
  expect(screen.getByLabelText('내 메모')).toHaveValue('작성 중');
});
```

- [ ] **Step 2:** `yarn test tests/unit/components/place-card.test.tsx` → 새 복원 행동 FAIL. 저장 실패/닉네임 취소/다른 작성자 읽기 전용도 유지한다.

- [ ] **Step 3:** PlaceCard의 메모 폼에 Task 2 draft를 연결한다. `MemoRow`/`NewMemo`에 `draftKey` prop을 추가하고 `MemoForm`은 다음 controlled 상태를 사용한다.

```tsx
const [drafts,setDrafts]=useAtom(memoDraftsAtom);
const value=drafts[props.draftKey] ?? props.initial;
const clear=()=>setDrafts(all=>{const next={...all};delete next[props.draftKey];return next;});
const change=(text:string)=>setDrafts(all=>({...all,[props.draftKey]:text}));
const submit=async(e:FormEvent)=>{
  e.preventDefault();
  if(!valid||saving)return;
  setSaving(true);
  try{
    const result=await props.onSave(value.trim());
    if(result==='saved'){clear();props.onSaved();}
  }catch(error){reportSaveError(error);}finally{setSaving(false);}
};
```

폼 props 계약은 `{draftKey,initial,onSave(text):Promise<PlaceActionResult>,onSaved():void,onCancel():void}`. 새 메모의 draftKey는 `${placeKey}:new`, 본인 수정은 `${placeKey}:mine`. NewMemo/MemoRow의 열림 여부는 해당 키 존재 여부로 판단한다. 버튼을 눌러 시작할 때 초기 문자열을 draft atom에 넣는다. 취소는 해당 키를 제거한다. 저장 중 닉네임 취소·저장 실패에는 제거하지 않는다. 동행 메모의 onSave·수정 버튼을 만들지 않는다.

메모 삭제·태그 추가/삭제·숨김도 Task 6 action을 사용한다. 태그 입력은 이전 검증과 중복 제한을 유지한다. PlaceCard의 ‘일정에 추가’는 `sharedDetails=true`일 때 공통 add 상세 상태를 연다. `sharedDetails=false`이거나 prop을 생략한 기존 경로는 자체 Menu를 Task 9f까지 유지한다. Task 9f에서 임시 prop과 기존 Menu 경로를 제거한 뒤에는 공통 add 상세 상태만 사용한다. 다른 장소로 이동하거나 파일을 가져와도 저장되지 않은 본인 초안은 명시적 취소 전까지 메모리에 남는다. 가져온 변경이 있는 경우 저장 전 보여 주는 현재 메모와 초안이 서로 다를 수 있음을 ‘작성 중인 내용’으로 구분한다.


TagInput의 작성 중 문자열도 tagDraftsAtom[placeKey]에 둔다. Enter로 추가 후 저장 성공할 때만 비우고, 검증/저장 실패에는 유지한다. DetailSurface의 PlaceCard에는 sharedDetails=true를 전달한다.

- [ ] **Step 4:** 메모/태그 복원·명시적 취소·저장 실패·동행 권한·XSS·기존 추가 Menu 테스트 PASS.
- [ ] **Step 5:** diff 확인·커밋: `feat: preserve memo and tag drafts across detail views`.

### Task 9c: 간결한 TripToolbar 준비

**Files:** Create `src/sections/views/view/TripToolbar.tsx`, `tests/unit/components/trip-toolbar.test.tsx`. 기존 TopBar는 9d에서 미호출 임시 export로 남기고 9f에서 제거한다.

**Interfaces:** TripToolbar는 기존 설정/내보내기/가져오기/닉네임 코드와 hash import를 사용한다. ReadyTrip은 아직 TopBar를 사용한다. 두 상단바를 동시에 렌더하지 않는다.

- [ ] **Step 1:** 실제 trip store를 넣은 MemoryRouter에서 TripToolbar의 설정 메뉴와 파일 가져오기 항목이 열리는지 테스트한다. 새 테스트의 setup은 Task 9a와 같은 store/Provider 구성을 사용하고, DetailSurface 대신 `<MemoryRouter><TripToolbar/></MemoryRouter>`를 렌더한다. detailAtom 설정은 필요 없다. MemoryRouter/TripToolbar import를 추가한다.

```tsx
it('간결한 상단에도 기존 공유 설정 항목이 남는다',async()=>{
  const trip=makeTrip({days:{'2026-11-14':['A']}});
  const storage=createMemoryStorage();
  const ts=createTripStore('testtrip0001',{storage,locks:undefined});
  const store=createStore();store.set(ts.tripAtom,trip);store.set(ts.editLayerAtom,makeEdit());
  render(<AppProviders><TripStoreContext value={ts}><Provider store={store}>
    <MemoryRouter><TripToolbar/></MemoryRouter>
  </Provider></TripStoreContext></AppProviders>);
  await userEvent.click(screen.getByRole('button',{name:'설정'}));
  expect(screen.getByRole('menuitem',{name:'파일 가져오기'})).toBeVisible();
});
```

- [ ] **Step 2:** `yarn test tests/unit/components/trip-toolbar.test.tsx` → 새 모듈 부재 FAIL.

- [ ] **Step 3:** 기존 TopBar를 TripToolbar로 이동하고 설정/공유 코드를 보존한다. ToggleButtonGroup과 항상 보이는 검색 TextField만 제거한다.

```tsx
const setView=useSetAtom(viewModeAtom);
const search=()=>{
  setView('places');
  requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('[data-trip-search]')?.focus());
};
<Toolbar variant="dense" sx={{gap:0.5,minHeight:56,flexWrap:'nowrap'}}>
  <Typography component="h1" noWrap sx={{fontWeight:700,flex:1,minWidth:0}}>{trip?.title}</Typography>
  <IconButton aria-label="검색" onClick={search}><SearchIcon width={22} height={22}/></IconButton>
  <IconButton aria-label="설정" onClick={e=>setMenuAnchor(e.currentTarget)}>
    <MoreIcon width={22} height={22}/>
  </IconButton>
</Toolbar>
```

기존 Menu, hidden file input의 change 이벤트, ExportDialog, ImportDialog(seq key), NicknameDialog, `useHashImport(startImport)`는 그대로 이동한다. 각 뷰마다 별도의 useHashImport를 호출하지 않는다. 검색 input에 `data-trip-search`를 지정하고 panel 렌더 후 focus되도록 callback ref로 보완한다. 여러 여행은 Provider가 분리되고 현재 앱 route는 하나이므로 현재 trip input만 선택한다.


기존 TopBar를 삭제하거나 ReadyTrip에 연결하는 작업은 여기서 하지 않는다. 9d에서는 새 상단만 렌더하고 복제된 옛 함수는 9f에서 삭제한다.

- [ ] **Step 4:** 새 상단 테스트와 기존 공유/닉네임 테스트 PASS, typecheck PASS.
- [ ] **Step 5:** diff 확인·커밋: `feat: prepare compact toolbar with existing share actions`.

### Task 9d: ReadyTrip 셸 연결과 지도 유지

**Files:** Modify `src/pages/TripPage.tsx`, `src/layouts/TripLayout.tsx`; Extend `tests/unit/components/trip-page.test.tsx`, `trip-layout.test.tsx`, `map-view.test.tsx`.

**Interfaces:** Task 5·7·8·9a–9c를 실제 화면에 연결한다. URL 상세 동기화는 9e, 임시 prop/TopBar 삭제는 9f에서 한다. useViewQuerySync는 TripScreen의 기존 한 호출만 유지한다.

- [ ] **Step 1:** 새 셸의 메뉴·세 패널·공통 상세 연결 테스트를 작성한다. renderAt 반환값에 fetchFn을 추가한다.

```tsx
it('장소에서 추가한 방문은 일정에 바로 반영되고 뷰만 바꿔도 원본 fetch는 한 번이다', async () => {
  const trip=makeTrip({days:{'2026-11-14':[]},places:['A']});
  const {router,store,storage,fetchFn}=renderAt(`/t/${PID}?view=places`,{trip});
  await userEvent.click(await screen.findByRole('button',{name:'A 일정에 추가'}));
  await userEvent.click(screen.getByRole('button',{name:'Day 1 (11/14)'}));
  const nickname = await screen.findByLabelText('닉네임');
  await userEvent.type(nickname, '나');
  await userEvent.click(within(nickname.closest('[role=dialog]')!).getByRole('button',{name:'저장'}));
  await waitFor(() => expect(overlay(trip,saved(storage)).days[0]?.stops).toHaveLength(1));
  await userEvent.click(screen.getByRole('button',{name:'일정',exact:true}));
  expect(store.get(viewModeAtom)).toBe('day');
  expect(await screen.findByTestId('itinerary-panel')).toHaveTextContent('A');
  expect(router.state.location.search).toContain('view=day');
  expect(fetchFn).toHaveBeenCalledTimes(1);
});
```

추가: 메모 작성→닫기→뷰 변경→재개방에서 draft 유지, 지도 실패 시 메뉴/공유/편집 유지, 최초 places/compact day는 SDK mount 0회, map을 처음 켠 후 세 뷰/너비 전환에서도 같은 adapter ID 유지. Task 5의 자원 카운터를 사용하며 React sentinel 통과만으로 완료하지 않는다.

- [ ] **Step 2:** 새 셸을 쓰지 않는 기준 UI에서 신규 계약 FAIL을 확인한다.
- [ ] **Step 3:** ReadyTrip을 아래 구성으로 연결한다. 기존 마커·후보 클릭·카메라 계산을 그대로 소비한다.

```tsx
const view=useAtomValue(viewModeAtom);
const mode=useAtomValue(modeAtom);
const layout=useLayoutKind();
const routeMapVisible=useAtomValue(mobileRouteMapAtom);
const unavailable=useAtomValue(ts.mapUnavailableAtom);
const [detail,setDetail]=useAtom(detailAtom);
const setSelectedPlace=useSetAtom(selectedPlaceAtom);
const setScrollRequest=useSetAtom(selectedPlaceScrollRequestAtom);
const [padding,setPadding]=useState<MapPadding>({top:24,right:24,bottom:24,left:24});
const mapVisible=!unavailable&&(view==='map'||(view==='day'&&(layout!=='compact'||routeMapVisible)));
const setUsable=useSetAtom(mapViewportUsableAtom);
const [mapReady,setMapReady]=useState(false);
const bounds=useAtomValue(mapBoundsAtom);
useEffect(()=>{setUsable(mapReady&&mapVisible&&bounds!==null&&!unavailable);},
  [mapReady,mapVisible,bounds,unavailable,setUsable]);
const panel=view==='day'?<ItineraryPanel compact/>:view==='places'?<PlacesPanel/>:<ExplorePanel compact/>;
<TripLayout topBar={<><TripToolbar/><ConnectedReconcileBanner/></>}
  map={<MapView visible={mapVisible} padding={padding} onReadyChange={setMapReady}
    markers={mode==='explore'?exploreMarkers:itinerary.markers}
    polylines={mode==='itinerary'?itinerary.polylines:[]}
    onMarkerClick={id=>{
      if(mode==='itinerary'&&id.startsWith('candidate/')){onItineraryMarkerClick(id);return;}
      const key=mode==='itinerary'&&day==='all'?id.slice(11):id;
      if(!trip||!Object.hasOwn(trip.places,key))return;
      setSelectedPlace(key);setDetail({kind:'place',placeKey:key});
      setScrollRequest(n=>n+1);
    }} onBoundsChange={setBounds} focus={focus}
    fitKey={mode==='itinerary'?`itinerary:${day}`:'explore'} onUnavailable={setMapUnavailable}/>}
  panel={panel} detail={{open:detail!==null,content:<DetailSurface modal={layout!=='wide'} onClose={()=>setDetail(null)}/>,
    onClose:()=>setDetail(null)}} view={view} layout={layout} unavailable={unavailable}
  routeMapVisible={routeMapVisible} onMapPaddingChange={setPadding}/>
```

TripLayout을 `export { ResponsiveTripLayout as TripLayout } from './ResponsiveTripLayout';`로 교체한다. mapViewportUsableAtom은 ready·현재 표시·bounds·실패 없음이 모두 성립해야 true다. 같은 MapView를 CSS로 숨기며 DOM/key/컴포넌트 종류를 교체하지 않는다. props/detail host도 같은 위치를 유지한다. 원본 변경·가져오기 배너가 늘면 body가 줄어들며 메뉴를 가리지 않아야 한다.

이 커밋에서는 compact/readyGuard/sharedDetails prop을 유지한다. ItineraryPanel/ExplorePanel에는 compact=true, 새 PlacesPanel 내부 PlaceList에는 compact=true, 두 패널의 useExploreKeys에는 readyGuard=true, DetailSurface의 PlaceCard에는 sharedDetails=true를 전달한다. 옛 TopBar는 임시로 export한 함수로 남겨 noUnusedLocals가 켜진 중간 커밋의 typecheck를 통과시키고 9f에서 export/함수/import를 함께 삭제한다. 새 화면에서 호출하지 않는다. 완성되지 않은 URL 상세 연결을 이 커밋의 검증 범위로 표시하지 않는다.

candidate/ 분기를 먼저 처리한다. 일정 전체 모드의 `${date}/${placeKey}` ID는 date(10자)+slash 뒤 key로 나눠 장소 상세를 연다. 방문 편집은 목록의 stop.id로만 연다.

- [ ] **Step 4:** 새 셸·지도 lifecycle·추가→일정·초안 유지 통합 테스트 및 typecheck PASS. 기존 저장/가져오기/되돌리기 assertion을 유지한다.
- [ ] **Step 5:** diff 확인·커밋: `feat: connect trip views with a persistent map shell`.

### Task 9e: URL 장소와 공통 상세의 단방향 연결

**Files:** Create `src/sections/views/use-url-place-detail-sync.ts`, `tests/unit/sections/url-place-detail.test.tsx`; Modify `src/pages/TripPage.tsx`; Extend `tests/unit/components/trip-page.test.tsx`.

**Interfaces:** URL→selectedPlace는 Task 1, URL→detail은 이 hook이 담당한다. X 닫기는 detailAtom만 null로 만들며 선택/URL을 지우지 않는다. 선택 atom 변화 자체로 상세를 다시 여는 effect를 만들지 않는다.

- [ ] **Step 1:** 같은 Provider/TripScreen에서 아래를 각각 테스트한다.

1. 유효 place 초기 진입→해당 상세, X 닫기→그대로 URL·선택 유지, unrelated atom·동일 URL/view 재렌더→상세 재개방 0회.
2. 외부 URL place A→B→B 상세, place 제거→장소 상세/추가만 닫힘, 다른 필터/방문 편집은 유지.
3. history entry를 A→B로 만든 뒤 X로 B 닫기, navigate(-1)→A 열림, navigate(1)→B 열림. UI의 replace 정책은 그대로 두고 테스트에서 Router navigate로 entry를 생성한다.
4. 처음부터 존재하지 않는 place→선택/detail null. URL 문자열은 기존 초기 링크 보존 계약대로 남기고 다음 사용자 선택 때 정규화한다.
5. 가져온 edit layer에 원본 없는 place key가 있어도 선택/detail은 null. 가져오기는 원본 trip.places를 삭제하지 않으므로 ‘import로 원본 장소 삭제’로 테스트하지 않는다. **별도 원본 snapshot 교체 테스트**에서 동일 URL의 기존 place가 사라지면 선택/detail 모두 정리한다. 날짜가 같아도 존재 검사는 실행한다.
6. A→B 지연 진입·동일 ID 새 ready load 결과에서는 처리 ref를 초기화하고 최신 URL만 연다. 무관한 뷰 변경과 edit layer import는 닫은 상세를 재개방하지 않는다.

- [ ] **Step 2:** 신규 hook 부재로 FAIL 확인. 테스트 helper는 Task 1의 실제 TripStore/Provider/Router를 사용하며 DetailSurface open을 관측한다.
- [ ] **Step 3:** 다음 전체 hook을 구현한다.

```ts
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useTripStore, type TripStore, type LoadState } from 'src/stores/trip-store';
import { selectedPlaceAtom } from 'src/stores/ui-store';
import { detailAtom } from './store/view-session';
type HandledPlace = { owner:TripStore; load:LoadState; place:string|null };
export function useUrlPlaceDetailSync(uiReady:boolean):void {
  const ts=useTripStore();
  const trip=useAtomValue(ts.tripAtom);
  const load=useAtomValue(ts.loadStateAtom);
  const [params]=useSearchParams();
  const urlPlace=params.get('place')||null;
  const setSelected=useSetAtom(selectedPlaceAtom);
  const setDetail=useSetAtom(detailAtom);
  const lastHandledUrlPlace=useRef<HandledPlace|null>(null);
  useEffect(()=>{
    if(!uiReady||!trip||load.status!=='ready'){
      lastHandledUrlPlace.current=null;
      setDetail(null);
      return;
    }
    const previous=lastHandledUrlPlace.current;
    const same=previous?.owner===ts&&previous.load===load&&previous.place===urlPlace;
    // 같은 URL도 원본의 장소 존재 여부를 먼저 검사한다.
    if(urlPlace&&!Object.hasOwn(trip.places,urlPlace)){
      lastHandledUrlPlace.current={owner:ts,load,place:urlPlace};
      setSelected(null);
      setDetail(current=>current?.kind==='place'||current?.kind==='add'?null:current);
      return;
    }
    if(same)return;
    lastHandledUrlPlace.current={owner:ts,load,place:urlPlace};
    if(urlPlace)setDetail({kind:'place',placeKey:urlPlace});
    else setDetail(current=>current?.kind==='place'||current?.kind==='add'?null:current);
  },[uiReady,trip,load,urlPlace,ts,setSelected,setDetail]);
}
```

TripScreen에서 항상 같은 순서로 `const uiReady=useViewQuerySync(); useUrlPlaceDetailSync(uiReady);`를 호출한다. ReadyTrip 내부로 옮기면 로딩 중 ref 정리가 실행되지 않으므로 옮기지 않는다. lastHandledUrlPlace는 ready 세션의 **raw URL place를 반영하기 직전** 기록한다. invalid-place 검사는 same 비교보다 먼저 실행하며 trip snapshot 변경에도 재검사한다. URL place 제거는 장소/날짜 추가 상세만 정리한다. 새 로드 대기에는 모든 상세를 닫고 초안 atom은 보존한다.

- [ ] **Step 4:** 위 6개 케이스·Task 1의 URL 쓰기/StrictMode/세션 테스트·trip-page 테스트 및 typecheck PASS.
- [ ] **Step 5:** diff 확인·커밋: `feat: synchronize URL place changes with trip details`.

### Task 9f: 임시 API·기존 셸 코드 제거와 회귀 정리

**Files:** Modify `src/pages/TripPage.tsx`, `src/sections/explore/view/ExplorePanel.tsx`, `PlaceList.tsx`, `PlaceCard.tsx`, `PlacesPanel.tsx`, `ExploreFilters.tsx`, `src/sections/explore/store/explore-state.ts`, `src/sections/itinerary/view/ItineraryPanel.tsx`, `Timeline.tsx`; Extend 기존 trip-page/place-card/timeline 테스트.

**Interfaces:** 9d–9e에서 연결된 동작을 기본 경로로 만든다. 이 작업은 새 도메인 동작을 추가하지 않는다.

- [ ] **Step 1:** compact/readyGuard/sharedDetails 없는 최종 prop 계약 테스트를 작성한다. standalone ItineraryPanel harness에도 DetailSurface를 연결한다. 기존 파일 가져오기·동행 메모·저장 실패·중복 방문·그룹 되돌리기 테스트를 유지한다.
- [ ] **Step 2:** 신규 prop 계약 FAIL을 확인한다.
- [ ] **Step 3:** 임시 false 경로/prop/호출 인자를 지우고 새 화면 경로만 남긴다. useExploreKeys를 인자 없이 호출한다. TopBar 함수와 옛 SidePanel/BottomSheet/useUiQuerySync·두 메뉴를 제거한다. TripToolbar와 hash import는 화면에 한 번만 존재해야 한다.
- [ ] **Step 4:** 아래 검색은 0건(exit 1)이어야 한다. 일반 layout 변수 compact는 금지 대상이 아니다.

```bash
rg -n 'readyGuard|sharedDetails|compact\s*\?:|<(ExplorePanel|PlaceList|ItineraryPanel|Timeline)\b[^>]*\bcompact(\s*=|\s*/?>)|function TopBar|function SidePanel|function BottomSheet|useUiQuerySync' src tests
```

- [ ] **Step 5:** 전체 unit/component와 typecheck PASS. 제거 전/후 URL·공유·저장 결과가 같아야 하며 지도 자원·초안·포커스 계약도 유지되어야 한다.
- [ ] **Step 6:** diff 확인·커밋: `refactor: remove legacy trip shell and temporary view props`.

### Task 10: 모바일·데스크톱 실제 브라우저 회귀

**Files:** Create `tests/e2e/views.spec.ts`; Modify `tests/e2e/trip.ts`, `itinerary.spec.ts`, `share.spec.ts`, `playwright.config.ts`.

**Interfaces:** 기존 fixture/publicId/global setup/teardown을 유지한다. 기존 desktop/mobile 프로젝트의 회귀도 유지하고 views spec을 두 프로젝트의 testMatch에 추가한다. 추가 `narrow-mobile` 프로젝트는 Chromium 320×568·hasTouch=true·isMobile=true, testMatch는 views.spec.ts만 사용한다.

- [ ] **Step 1:** E2E가 새 화면 요구사항을 먼저 검증하게 작성한다.

```ts
import {expect,test} from '@playwright/test';
import {TRIP_PATH,openTrip,placeName,submitNickname} from './trip';
test('세 뷰 전환·검색·상세와 반응형 배치',async({page},testInfo)=>{
  await openTrip(page,`${TRIP_PATH}?view=places`);
  await page.getByRole('textbox',{name:'검색',exact:true}).fill(placeName(1));
  await expect(page.getByRole('button',{name:`${placeName(1)} 상세`,exact:true})).toBeVisible();
  await page.getByRole('button',{name:`${placeName(1)} 상세`,exact:true}).click();
  await expect(page.getByRole('dialog',{name:'장소 상세'})).toBeVisible();
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'일정',exact:true}).click();
  await expect(page).toHaveURL(/[?&]view=day/);
  await page.getByRole('button',{name:'지도',exact:true}).click();
  await expect(page).toHaveURL(/[?&]view=map/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('three-views.png'),fullPage:true});
});
test('작성 중인 메모가 닫기·모드 전환 후 남는다',async({page})=>{
  await openTrip(page,`${TRIP_PATH}?view=places`);
  await page.getByRole('button',{name:`${placeName(1)} 상세`,exact:true}).click();
  await page.getByRole('button',{name:'메모 추가',exact:true}).click();
  await page.getByLabel('내 메모',{exact:true}).fill('작성 중인 메모');
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'일정',exact:true}).click();
  await page.getByRole('button',{name:'장소',exact:true}).click();
  await page.getByRole('button',{name:`${placeName(1)} 상세`,exact:true}).click();
  await expect(page.getByLabel('내 메모',{exact:true})).toHaveValue('작성 중인 메모');
});
test('카드에서 날짜를 선택해 추가하고 일정에서 확인한다',async({page})=>{
  await openTrip(page,`${TRIP_PATH}?view=places`);
  await page.getByRole('button',{name:`${placeName(7)} 일정에 추가`,exact:true}).click();
  await page.getByRole('button',{name:'Day 2 (11/15)',exact:true}).click();
  await submitNickname(page,'여행자');
  await expect(page.getByRole('dialog',{name:'일정에 추가'})).toBeHidden();
  await page.getByRole('button',{name:'일정',exact:true}).click();
  await page.getByRole('tab',{name:'Day 2',exact:true}).click();
  await expect(page.getByRole('list',{name:'Day 2 (11/15) 타임라인'})).toContainText(placeName(7));
});
```

추가 E2E를 명시적으로 넣는다:

- 390×844, 768×1024, 1280×800, 1440×900, 1920×1080에서 셸 폭·열 수·상세 docking·문서 가로 넘침 검사. WebKit에서 isMobile 고정 컨텍스트를 desktop viewport로 늘리며 OS 모드까지 바뀐다고 가정하지 않는다. desktop 프로젝트에서 데스크톱 resize 시나리오를 실행한다.
- desktop에서는 767↔768, 1439↔1440 경계를 넘어도 같은 `map-host`와 fake instance id가 유지되는지 검사한다. 작은 viewport에서도 자세한 레이아웃 검증은 real SDK 대신 fake로 한다.
- 모바일 시트 peek에서 장소 요약/목록 진입 버튼이 보이고, half에서 첫 목록 행이 필터 전문에 밀리지 않는지 boundingBox로 검사한다.
- 카드 표시→1열 목록 전환→검색 유지. 긴 제목·긴 장소명·3줄 메모 fixture를 추가할 때 기존 public fixture를 임의 변경하지 말고 이 spec의 route 응답만 변형한다.
- 지도 실패: `page.route`에서 SDK 요청 실패를 만들거나 키 없는 별도 환경에서 목록 전용 진입. 새 의존성 없이 기존 map 오류 컴포넌트 테스트와 함께 확인한다.
- legacy `?mode=itinerary&day=1` 진입·reload 시 URL 그대로, 사용자 뷰 변경 후 `view`로 정규화.
- 공유 링크·파일 import, 저장된 메모의 다른 뷰 반영, 동행 메모 권한, 기존 두 탭 동시 저장 회귀.

- [ ] **Step 2:** `yarn test:e2e --grep '세 뷰|작성 중인 메모|카드에서 날짜'` 실행. Task 9d 연결 전 기준 화면에서는 새 버튼/패널을 찾지 못해 FAIL이어야 한다. 연결 후 바로 PASS이면 의도된 UI·저장 결과를 실제로 검증하는지 assertion을 확인하고 테스트를 일부러 실패시키지는 않는다.
- [ ] **Step 3:** 기존 E2E helper를 새 UI에 맞게 수정한다. `openPlace`는 장소 뷰로 전환 후 `${placeName(n)} 상세` 버튼을 눌러 공통 상세의 `place-card-...`를 반환한다. `expandSheet`는 지도 시트 검증에서만 쓴다. share.spec에서 무조건 시트를 full로 펼치던 단계는 장소 뷰 진입으로 바꾼다. 링크 정규식은 기존 exportLink가 query 없이 만드는 원래 계약을 유지한다.

```ts
export async function openPlace(page:Page,n:number):Promise<Locator>{
  await page.getByRole('button',{name:'장소',exact:true}).click();
  await page.getByRole('button',{name:`${placeName(n)} 상세`,exact:true}).click();
  const card=page.getByTestId(`place-card-${placeKey(n)}`);
  await expect(card).toBeVisible();
  return card;
}
// itinerary.spec.ts의 순서 판독은 드래그 손잡이 존재에 의존하지 않는다.
async function day1Order(page:Page):Promise<string[]>{
  return page.getByRole('list',{name:`${DAY1} 타임라인`}).locator('[data-stop-id]')
    .evaluateAll(rows=>rows.map(row=>row.getAttribute('data-stop-name') ?? ''));
}
```

기존 키보드 드래그 E2E는 먼저 ‘편집’ 버튼을 누른다. 날짜 탭의 aria-label `Day 1`은 유지해 날짜+요일 시각 문구 변경과 독립적으로 찾을 수 있게 한다. share/concurrent의 저장·병합 assertion을 삭제하지 않는다.

- [ ] **Step 4:** `yarn test:e2e` 전체 PASS. 실패 시 trace와 screenshot을 읽고 원인을 해결한다. 브라우저 다운로드가 필요한 환경에서만 `yarn playwright install chromium webkit`을 실행한다.
- [ ] **Step 5:** 실제 iPhone Safari/Android Chrome에서 주소창 높이·safe area·가상 키보드·세로/가로 회전·엄지 조작을 확인한다. 담당자·기기 모델·정확한 OS/브라우저 버전·사례별 결과를 Task 11의 docs/ui-device-checks.md에 기록한다. 실물이 없으면 에뮬레이션 통과와 실물 미확인을 구분해 기록한다. 실물 검증을 했다고 표시하지 않는다.
- [ ] **Step 6:** diff 확인·커밋: `test: cover responsive trip views and editing continuity`.

### Task 11: 성능 예산·문서·최종 검증

**Files:** Create `scripts/measure-ui-assets.mjs`, `docs/ui-performance.md`, `docs/ui-device-checks.md`; Modify `README.md`. 필요시 오직 측정에서 문제가 확인된 앞 작업 UI 파일을 수정한다.

**Interfaces:** 측정 스크립트는 dist JS/CSS의 전체·gzip 크기를 JSON으로 출력한다. app 코드나 SDK 키를 읽지 않는다. 기준 빌드와 변경 빌드의 차이를 기록하며 수치를 미리 통과로 표시하지 않는다.

- [ ] **Step 1:** 실행 시작 시 기준 커밋 빌드의 dist를 외부 임시 측정 폴더에 저장한다. 이 작업의 계획 문서·검증 이미지 외에 운영 소스는 변경하지 않는다. 현재 작업 브랜치를 reset해서 baseline을 만들지 말고 기준 커밋의 별도 읽기용 checkout을 사용한다.
- [ ] **Step 2:** 다음 script를 추가하고 baseline/변경 dist에 실행한다.

```js
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
const directory=process.argv[2] ?? 'dist/assets';
const files=(await readdir(directory)).filter(name=>/\.(js|css)$/.test(name)).sort();
const rows=[];
for(const name of files){
  const data=await readFile(join(directory,name));
  rows.push({name,bytes:data.length,gzipBytes:gzipSync(data).length});
}
const totals=(extension)=>rows.filter(row=>row.name.endsWith(extension)).reduce(
  (sum,row)=>({bytes:sum.bytes+row.bytes,gzipBytes:sum.gzipBytes+row.gzipBytes}),
  {bytes:0,gzipBytes:0});
console.log(JSON.stringify({files:rows,js:totals('.js'),css:totals('.css'),
  totalBytes:rows.reduce((n,r)=>n+r.bytes,0),
  totalGzipBytes:rows.reduce((n,r)=>n+r.gzipBytes,0)},null,2));
```

Run: `node scripts/measure-ui-assets.mjs dist/assets`. 실제 빌드 산출물의 크기를 기록한다. 개발용 MDI 컬렉션의 패키지 크기를 사용자 다운로드 크기로 취급하지 않는다.

**성능 통과 기준:** 아래 수치는 설계 단계의 목표 예산이며 이미 달성한 실측값이 아니다. baseline/변경본은 같은 Node/Yarn/production build, source map 제외, fake map, 동일 fixture로 비교한다. SDK의 외부 스크립트/타일은 별도로 기록한다. KiB=1024 bytes다.

| **항목** | **통과 기준** | **기록** |
|:---|:---|:---|
| 전체 dist JS gzip 증가 | baseline 대비 20% 이내이면서 +75KiB 이하 | js.gzipBytes와 개별 chunk 표 |
| 전체 dist CSS gzip 증가 | +10KiB 이하 | css.gzipBytes |
| 초기 진입 JS/CSS gzip 증가 | baseline 대비 15% 이내이면서 +50KiB 이하 | 초기 로드의 실제 chunk 목록, 전체 dist 합과 구분 |
| 아이콘만의 gzip 증가 | +10KiB 이하 | 동일 UI에서 아이콘 유무 비교 |
| 추가 외부 요청 | 아이콘/이모지/사진 0, 숨긴 초기 지도 SDK 0 | Network 로그 |
| 500개 장소 검색·필터·뷰 전환 | 조작별 p95 다음 표시까지 200ms 이하 | 워밍업 5회 후 각 30회, median/p95/max |
| 반복 긴 작업 | 동일 조작군에서 100ms 초과 Long Task가 2회 이상이면 실패 | trace와 longtask 항목 |
| 20회 뷰 순환 | 지도/observer/event 구독 수가 원래 수로 복귀 | 인스턴스/구독 계수, heap은 보조 기록 |

상호작용의 기준 측정은 desktop Chromium 390×844, CPU 4배 제한, production preview, 최초 로드 완료 후 수행한다. 입력 이벤트/클릭 핸들러 시작부터 React 결과가 표시된 다음 프레임까지 측정하고 브라우저 버전·OS·CPU 모델을 기록한다. WebKit에서 CPU 제한을 지원한다고 가정하지 않는다. 실기기는 이 수치와 별도로 확인한다. 스크롤은 trace에서 연속 긴 작업 여부와 실제 조작 체감을 확인하며 FPS 통과값을 임의 보고하지 않는다.

예산 초과 시 trace/번들 분석 → 비활성 뷰 계산 차단/요약 중복 계산 제거/정적 import 확인 → 같은 조건 재측정 순서로 대응한다. 필요성이 확인되면 가상화 등 작은 변경을 별도 검토한다. 수치를 올려 통과 처리하거나 측정 누락을 PASS로 기록하지 않는다. 최적화 후에도 초과하면 원인·실측·사용성 영향·선택 가능한 절충안을 제시해 예산 변경 여부를 결정한다.

- [ ] **Step 3:** 아이콘만의 비용은 같은 UI에서 정적 아이콘 import를 빈 컴포넌트로 교체한 임시 측정용 복사본과 비교한다. 측정용 변경을 작업 브랜치에 섞지 않는다. **아이콘 추가 gzip 차이 10KB 이하를 초기 목표**로 둔다. 전체 JS 증분을 아이콘 비용이라고 기록하지 않는다.
- [ ] **Step 4:** 초기 Network/Performance를 측정한다. 장소/모바일 일정의 첫 화면에는 SDK 요청이 없고, 첫 지도 표시에서 한 번 로드되는지 확인한다. 아이콘·이모지·사진 때문에 추가 네트워크 요청이 생기지 않아야 한다. 지도→일정→장소→지도를 20회 전환하면서 지도 인스턴스와 이벤트 구독이 누적되지 않는지 확인한다.
- [ ] **Step 5:** 테스트 전용 500개 장소·하루 50개 방문 데이터로 검색·스크롤·전환 trace를 저장한다. 100ms를 넘는 반복 작업이 나타나면 비활성 화면의 DOM/marker 계산을 먼저 확인한다. 가상화 라이브러리 추가는 측정에서 필요성이 확인된 경우 별도 설계로 다룬다.
**실기기 기록 책임:** 구현 담당자가 검증 책임을 맡고, 실제 조작한 확인자의 이름/역할을 docs/ui-device-checks.md에 적는다. 최소 대상은 iPhone Safari와 Android Chrome 각 한 대다. 기기 모델·정확한 OS/브라우저 버전은 확인 시 기록하며 특정 버전을 확인했다고 미리 가정하지 않는다. 실물을 확보하지 못한 항목은 미실행으로 남긴다.

문서의 각 기록에는 확인 일시, 검증 커밋, 확인자, 기기/OS/브라우저 버전, 표시 모드/방향, 키보드/주소창/safe-area/회전/엄지 조작/실제 지도 가림/내보내기 사례, PASS/FAIL/미실행, 스크린샷·문제 링크를 포함한다. 자동화 결과는 docs/ui-performance.md 및 Playwright report, 실물 결과는 docs/ui-device-checks.md로 구분한다. 실제 사용성 실패는 수정 후 다시 확인하고, 미실행은 제한으로 완료 보고에 남긴다.

- [ ] **Step 6:** README 개발 절에 신규/기존 URL, 세 뷰, 모바일/데스크톱 조작, 편집 내보내기는 UI 선호를 포함하지 않는다는 계약, 테스트 프로젝트, 측정 결과와 실물 기기 확인 범위를 기록한다.

```text
/t/<publicId>?view=map
/t/<publicId>?view=day&day=2
/t/<publicId>?view=day&day=all
/t/<publicId>?view=places&place=n%3A12345
기존 ?mode=itinerary&day=2 링크도 사용할 수 있습니다.
마지막으로 고른 뷰는 브라우저에 여행별로 저장됩니다.
편집 공유는 기존처럼 편집 링크/파일 → 가져오기 → 병합으로 동작합니다.
```

- [ ] **Step 7:** 다음 검증을 순서대로 실행한다.

```bash
yarn lint
yarn typecheck
yarn test
yarn validate
yarn build
yarn test:e2e
git diff --check
```

예상 결과: lint/typecheck 오류 0, 전체 단위/컴포넌트 테스트 PASS, schema 검증 PASS, 빌드 성공, desktop/mobile/narrow-mobile E2E PASS. `yarn build:ci`가 validate/typecheck/test/build를 포함하므로 CI와 같은 검증에는 `yarn lint && yarn build:ci && yarn test:e2e`를 한 번 실행해도 된다. 새 변경이나 실패가 없다면 전체 검증을 중복 실행하지 않는다.

- [ ] **Step 8:** `git diff --stat`와 관련 diff를 읽고 시크릿·측정 전용 fixture가 포함되지 않았는지 확인한다. 관련 파일만 커밋한다. Commit: `docs: document responsive views and measured UI performance`. 병합·배포는 이 계획의 실행에 자동 포함하지 않는다.

---

## 요구사항과 완료 조건

| **요구사항** | **Task** | **최종 확인** |
|:---|:---|:---|
| 선택 가능한 세 기능 뷰 | 1·3·7·8·9d | 세 버튼이 서로 다른 주 콘텐츠를 엶 |
| 모바일에 맞는 간결한 UI | 3·5·7·8·10 | 320px에서도 본문과 조작이 가로로 넘치지 않음 |
| 데스크톱 화면 활용 | 5·10 | 768/1440 경계 및 1920px의 열 배치 확인 |
| 공통 여행·편집·메모 | 6·8·9a·9b·9d·10 | 뷰 전환 뒤에도 저장 결과 일치 |
| 검색·필터·날짜·선택 유지 | 1·2·7·9d·9e | 뷰 전환 시 초기화되지 않음 |
| 미저장 초안·스크롤 복원 | 2·8·9b·9d·10 | 저장 실패·닫기·크기 변경·재진입으로 확인 |
| 기존 URL·공유·가져오기 호환 | 1·9c·9d·9e·9f·10 | legacy 진입과 기존 공유 E2E 유지 |
| 지도 하나·resize·지연 로딩 | 4·5·9d·11 | adapter/SDK instance·observer·event 정리, 크기 변경으로 재생성 없음, 숨긴 초기 화면은 SDK 요청 없음 |
| 가벼운 아이콘/이모지·OSS 재사용 | 3·7·11 | 새 의존성 없음, 추가 에셋 요청 없음, gzip 실측 |
| 지도 실패·저장 불가·원본 변경 | 5·9d·10 | 목록·공유·복구 기능 접근 가능 |
| 중복 방문·동행 메모·되돌리기·동시 저장 | 6·8·9a·9b·9d·10 | 기존 의미 있는 검증 유지 |

**최종 완료 기준:** 자동 검증 통과, 세 뷰의 모바일/데스크톱 스크린샷 확인, 실제 빌드 크기 기록, 실물 기기 확인 여부 명시. 실물 확인 없이 ‘실기기 검증 완료’라고 쓰지 않는다. 완료 보고에는 변경 동작·보존한 기능·실행한 검증·남은 제약을 포함한다.

## 실행 중 검토 시점

1. Task 1–4 완료: 상태/URL·초안·지도 계약을 검토한다.
2. Task 5–9f 완료: 세 화면과 기존 편집이 함께 동작하는지 검토한다.
3. Task 10–11 완료: 브라우저 회귀·성능·문서를 검토한다.

구현은 실행 방식을 선택한 뒤 시작한다. 선택지는 작업별 새 subagent로 구현·검토하거나, 이 세션에서 `executing-plans`에 따라 순서대로 구현하는 방식이다.

## 실행용 문서 검사

원문은 줄 번호 접두어가 없어야 한다. Markdown을 도구 출력에서 복사한 경우, 아래 검사를 먼저 실행한다. 번호가 발견되면 원문 파일에서 다시 읽고 코드를 복사한다.

```bash
rg -n '^\s*[0-9]+\|' docs/superpowers/plans/2026-10-04-trip-map-responsive-views.md
```

예상: 일치 없음(exit 1). 코드 블록의 opening/closing fence 수가 같고, Task 9a/9b/9c/9d/9e/9f의 작업 범위·파일·검증·커밋이 각각 있어야 한다. 이 문서 수정 단계의 검사 결과를 새 UI 구현 테스트 결과로 표시하지 않는다.
