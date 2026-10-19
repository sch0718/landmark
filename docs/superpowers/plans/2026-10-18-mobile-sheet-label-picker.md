# 휴대폰 상세 시트·라벨 고르기 창 (A2) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 휴대폰에서 장소 상세를 지도 위 아래쪽 시트(반쯤/다 펼침)로 바꾸고, 모든 화면의 라벨 칸을 "붙은 라벨 + `라벨 바꾸기` 창"으로 바꾼다.

**Architecture:** 시트 단계와 뒤 화면은 기록 상태(`location.state.sheet`)가 유일한 출처다. `useOpenPlace`가 열 때 상태를 넣고(휴대폰에서 이미 열려 있으면 `replace`), `AppShell`이 그 상태로 `PlaceSheet`(끌기·버튼·포커스를 맡는 껍데기)를 그린다. 라벨 칸은 `LabelPicker`가 붙은 라벨만 보이고, lazy로 받는 `LabelPickerDialog`가 검색·체크 목록·새 라벨을 맡는다. 순서·거르기는 순수 함수다.

**Tech Stack:** React 19, react-router 7(데이터 라우터), MUI 7(`Dialog`·`IconButton`·`Box`), Jotai, Vitest 5 + Testing Library(jsdom), Playwright.

**스펙:** `docs/superpowers/specs/2026-10-18-mobile-sheet-label-picker-design.md`

## Global Constraints

- 시험·커밋 전에 항상 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.
- 5173·5174 서버는 쓰지도 끄지도 않는다. `pkill` 금지. E2E는 `E2E_PORT=5176 yarn test:e2e …`.
- 첫 로딩 JS gzip 예산 `initialJsGzipMax` 327,680. `LabelPickerDialog`는 첫 로딩에 들어가지 않는다(`--require-lazy LabelPickerDialog`).
- 저장 형식(`tripmap:library:v2` schemaVersion 2, `tripmap:prefs`)은 바꾸지 않는다. 시트 상태는 기록 상태에만 둔다.
- 사용자 문자열은 React 텍스트로만(`dangerouslySetInnerHTML` 금지). 주석·UI 문구는 한국어, 주변 코드 관례(주석 밀도·이름)를 따른다.
- `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 커밋 메시지 끝 줄: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 메시지는 한국어(`feat: …`, `test: …`).
- 브랜치 `feat/mobile-sheet-label-picker`. main에 직접 커밋하지 않는다.
- 중간·넓은 화면의 상세 배치·닫기 동작은 바꾸지 않는다(A1 세션 범위).
- 터치 영역 44×44px 이상.

## File Structure

| 파일 | 할 일 |
|---|---|
| Create `src/sections/shell/sheet-snap.ts` | 시트 단계 타입, `resolveSnap`(손 뗀 뒤 단계), 반쯤 높이(`sheetHalfPx`, `useSheetHalfPx`) |
| Create `src/sections/library/use-open-place.ts` | `SheetState`, `sheetStateOf`(기록 상태 읽기), `useOpenPlace`(push/replace) |
| Create `src/sections/shell/PlaceSheet.tsx` | 시트 껍데기: 단계 모양·끌기·펼치기/접기/닫기 버튼·Esc·포커스 |
| Modify `src/components/icons.tsx` | `ChevronUpIcon`·`ChevronDownIcon` 추가 |
| Modify `src/sections/shell/AppShell.tsx` | compact 갈래를 `PlaceSheet`로, `origin` 상태 지우기, 닫기를 `inApp`으로 |
| Modify `src/sections/shell/nav-items.ts`, `BottomTabs.tsx` | 시트 뒤가 지도면 `지도` 탭 켜기 |
| Modify `src/sections/map/LibraryMap.tsx` | `useOpenPlace`, compact 시트 여백·새로 생길 때 모으기 |
| Modify `src/sections/library/LibraryPage.tsx`, `src/sections/add-place/CandidateCard.tsx`, `PinCard.tsx` | 장소 열기를 `useOpenPlace`로 |
| Create `src/sections/place/label-picker-order.ts` | `orderLabelsForPicker`, `arrangeLabels`, `filterLabels`, `canCreateLabel` |
| Create `src/sections/place/LabelPickerDialog.tsx` | 라벨 고르기 창(검색·체크 목록·새 라벨) |
| Modify `src/routes/lazy-routes.ts`, `package.json` | 창 lazy 등록, `--require-lazy LabelPickerDialog` |
| Modify `src/sections/place/LabelPicker.tsx` | 붙은 라벨 + `라벨 바꾸기` 버튼 + 창 |
| Tests | `tests/unit/sections/shell/sheet-snap.test.ts`, `place-sheet.test.tsx`, `app-shell.test.tsx`, `tests/unit/sections/library/use-open-place.test.tsx`, `tests/unit/sections/map/library-map.test.tsx`, `tests/unit/sections/place/label-picker-order.test.ts`, `label-picker-dialog.test.tsx`, `label-picker.test.tsx`, `place-detail.test.tsx`, `tests/unit/sections/add-place/link-flow.test.tsx`, `pin-flow.test.tsx`, `tests/unit/helpers/label-picker.ts`, E2E `tests/e2e/*.spec.ts` |

---

### Task 1: 시트 단계 계산 (`sheet-snap.ts`)

**Files:**
- Create: `src/sections/shell/sheet-snap.ts`
- Test: `tests/unit/sections/shell/sheet-snap.test.ts`

**Interfaces:**
- Produces:
  - `type SheetSnap = 'half' | 'full'`
  - `type SnapTarget = SheetSnap | 'closed'`
  - `const SHEET_HALF_MAX = 320`, `const SHEET_HALF_RATIO = 0.45`, `const DRAG_SLOP_PX = 8`, `const FLICK_VELOCITY = 0.5`
  - `function sheetHalfPx(viewportHeight: number): number`
  - `function useSheetHalfPx(): number`
  - `function resolveSnap(input: { from: SheetSnap; offsetPx: number; velocity: number; halfPx: number; fullPx: number }): SnapTarget`

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// tests/unit/sections/shell/sheet-snap.test.ts
import { describe, expect, it } from 'vitest';
import { resolveSnap, sheetHalfPx } from 'src/sections/shell/sheet-snap';

const base = { halfPx: 320, fullPx: 760 };

describe('sheetHalfPx', () => {
  it('창 높이의 45%를 쓰되 320px을 넘지 않는다', () => {
    expect(sheetHalfPx(812)).toBe(320);
    expect(sheetHalfPx(600)).toBe(270);
  });
});

describe('resolveSnap', () => {
  it('빠르게 위로 튕기면 다 펼친다', () => {
    expect(resolveSnap({ ...base, from: 'half', offsetPx: -20, velocity: -0.8 })).toBe('full');
  });

  it('빠르게 아래로 튕기면 다 펼침은 반쯤, 반쯤은 닫힘', () => {
    expect(resolveSnap({ ...base, from: 'full', offsetPx: 30, velocity: 0.9 })).toBe('half');
    expect(resolveSnap({ ...base, from: 'half', offsetPx: 30, velocity: 0.9 })).toBe('closed');
  });

  it('천천히 놓으면 가장 가까운 단계로 간다', () => {
    expect(resolveSnap({ ...base, from: 'half', offsetPx: -300, velocity: 0 })).toBe('full');
    expect(resolveSnap({ ...base, from: 'half', offsetPx: -50, velocity: 0 })).toBe('half');
    expect(resolveSnap({ ...base, from: 'half', offsetPx: 200, velocity: 0 })).toBe('closed');
    expect(resolveSnap({ ...base, from: 'full', offsetPx: 300, velocity: 0 })).toBe('half');
  });

  it('다 펼침에서 한 번에 끝까지 끌어도 반쯤에서 멈춘다', () => {
    expect(resolveSnap({ ...base, from: 'full', offsetPx: 740, velocity: 0 })).toBe('half');
  });
});
```

- [ ] **Step 2: 시험이 실패하는지 확인**

Run: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH" && yarn vitest run tests/unit/sections/shell/sheet-snap.test.ts`
Expected: FAIL — `Failed to resolve import "src/sections/shell/sheet-snap"`

- [ ] **Step 3: 구현**

```ts
// src/sections/shell/sheet-snap.ts
import { useSyncExternalStore } from 'react';

/** 휴대폰 상세 시트의 단계(스펙 §4.1). 닫힘은 시트가 없는 것이라 단계에 넣지 않는다. */
export type SheetSnap = 'half' | 'full';
/** 손을 뗀 뒤 갈 곳. `'closed'`면 시트를 닫는다(선택 해제). */
export type SnapTarget = SheetSnap | 'closed';

/** 반쯤 높이의 상한(px). 이름·주소·분류·`네이버 지도에서 열기`·다녀옴까지 보이는 높이다. */
export const SHEET_HALF_MAX = 320;
/** 창이 낮으면 반쯤 높이를 창 높이의 이 비율로 줄인다. */
export const SHEET_HALF_RATIO = 0.45;
/** 이만큼(px) 움직여야 끌기로 본다. 그 전에 떼면 보통 누르기다. */
export const DRAG_SLOP_PX = 8;
/** 이보다 빠르면(px/ms) 놓인 자리와 상관없이 튕긴 방향의 다음 단계로 간다. */
export const FLICK_VELOCITY = 0.5;

export function sheetHalfPx(viewportHeight: number): number {
  return Math.min(SHEET_HALF_MAX, Math.round(viewportHeight * SHEET_HALF_RATIO));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

/** 지금 창 높이에서의 반쯤 높이. 시트와 지도 여백이 같은 값을 쓴다. */
export function useSheetHalfPx(): number {
  const height = useSyncExternalStore(subscribe, () => window.innerHeight);
  return sheetHalfPx(height);
}

/**
 * 손을 뗀 뒤의 단계(스펙 §4.2). `offsetPx`는 끌기 시작점에서 아래로 간 거리(위로 끌면 음수), `velocity`는 마지막
 * 움직임의 빠르기(px/ms, 아래가 양수)다. 튕기면 그 방향의 다음 단계로, 아니면 보이는 높이가 가장 가까운 단계로 간다.
 * 다 펼침에서 한 번 끌어 바로 닫히지는 않는다(반쯤에서 멈춘다).
 */
export function resolveSnap({
  from,
  offsetPx,
  velocity,
  halfPx,
  fullPx,
}: {
  from: SheetSnap;
  offsetPx: number;
  velocity: number;
  halfPx: number;
  fullPx: number;
}): SnapTarget {
  if (velocity < -FLICK_VELOCITY) return 'full';
  if (velocity > FLICK_VELOCITY) return from === 'full' ? 'half' : 'closed';
  const visible = (from === 'full' ? fullPx : halfPx) - offsetPx;
  const stops: [SnapTarget, number][] = [
    ['closed', 0],
    ['half', halfPx],
    ['full', fullPx],
  ];
  let best = stops[0]!;
  for (const stop of stops) {
    if (Math.abs(visible - stop[1]) < Math.abs(visible - best[1])) best = stop;
  }
  if (from === 'full' && best[0] === 'closed') return 'half';
  return best[0];
}
```

- [ ] **Step 4: 시험 통과 확인**

Run: `yarn vitest run tests/unit/sections/shell/sheet-snap.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/sections/shell/sheet-snap.ts tests/unit/sections/shell/sheet-snap.test.ts
git commit -m "feat: 휴대폰 상세 시트의 단계 계산(resolveSnap·반쯤 높이)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 장소 열기 규칙 (`useOpenPlace`)과 여는 곳 바꾸기

**Files:**
- Create: `src/sections/library/use-open-place.ts`
- Modify: `src/sections/library/LibraryPage.tsx:159` (`onOpen`)
- Modify: `src/sections/map/LibraryMap.tsx:226-238` (`onMarkerClick`)
- Modify: `src/sections/add-place/CandidateCard.tsx` (저장 뒤 `navigate(paths.place(result.createdId!))`)
- Modify: `src/sections/add-place/PinCard.tsx` (같은 줄)
- Test: `tests/unit/sections/library/use-open-place.test.tsx`

**Interfaces:**
- Consumes: `SheetSnap` (Task 1)
- Produces:
  - `type SheetFrom = 'map' | 'list'`
  - `type SheetState = { from: SheetFrom; snap: SheetSnap; inApp: boolean }`
  - `function sheetStateOf(state: unknown): SheetState` — 상태가 없거나 이상하면 `{ from: 'map', snap: 'half', inApp: false }`(링크로 바로 들어옴)
  - `function sheetLocationState(sheet: SheetState): { sheet: SheetState }`
  - `function useOpenPlace(): (id: string, from: SheetFrom) => void`

- [ ] **Step 1: 실패하는 시험 쓰기**

```tsx
// tests/unit/sections/library/use-open-place.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sheetStateOf, useOpenPlace, type SheetFrom } from 'src/sections/library/use-open-place';
import { mockViewport } from '../shell/harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Opener({ id, from }: { id: string; from: SheetFrom }) {
  const open = useOpenPlace();
  return (
    <button type="button" onClick={() => open(id, from)}>
      {`${from} ${id}`}
    </button>
  );
}

function setup(width: number, path: string) {
  mockViewport(width);
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <Opener id="place00002" from="map" />
            <Opener id="place00003" from="list" />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('sheetStateOf', () => {
  it('상태가 없거나 모양이 다르면 링크로 바로 들어온 것으로 본다', () => {
    const direct = { from: 'map', snap: 'half', inApp: false };
    expect(sheetStateOf(null)).toEqual(direct);
    expect(sheetStateOf({ sheet: { from: 'sky', snap: 'half', inApp: true } })).toEqual(direct);
    expect(sheetStateOf({ sheet: { from: 'list', snap: 'full', inApp: true } })).toEqual({
      from: 'list',
      snap: 'full',
      inApp: true,
    });
  });
});

describe('useOpenPlace', () => {
  it('휴대폰 지도에서 처음 열면 반쯤 시트로 기록을 쌓는다', async () => {
    const router = setup(390, '/map');
    await userEvent.click(screen.getByRole('button', { name: 'map place00002' }));
    expect(router.state.location.pathname).toBe('/place/place00002');
    expect(router.state.historyAction).toBe('PUSH');
    expect(router.state.location.state).toEqual({
      sheet: { from: 'map', snap: 'half', inApp: true },
    });
  });

  it('휴대폰 목록에서 처음 열면 다 펼친 시트다', async () => {
    const router = setup(390, '/');
    await userEvent.click(screen.getByRole('button', { name: 'list place00003' }));
    expect(router.state.location.state).toEqual({
      sheet: { from: 'list', snap: 'full', inApp: true },
    });
  });

  it('휴대폰에서 이미 열려 있으면 바꿔치기하고 지금 시트 상태를 그대로 둔다', async () => {
    const router = setup(390, '/map');
    await userEvent.click(screen.getByRole('button', { name: 'map place00002' }));
    await userEvent.click(screen.getByRole('button', { name: 'list place00003' }));
    expect(router.state.location.pathname).toBe('/place/place00003');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.state).toEqual({
      sheet: { from: 'map', snap: 'half', inApp: true },
    });
  });

  it('넓은 화면은 열린 장소가 있어도 기록을 쌓는다', async () => {
    const router = setup(1280, '/place/place00002');
    await userEvent.click(screen.getByRole('button', { name: 'list place00003' }));
    expect(router.state.historyAction).toBe('PUSH');
  });
});
```

- [ ] **Step 2: 시험이 실패하는지 확인**

Run: `yarn vitest run tests/unit/sections/library/use-open-place.test.tsx`
Expected: FAIL — `Failed to resolve import "src/sections/library/use-open-place"`

- [ ] **Step 3: 구현**

```ts
// src/sections/library/use-open-place.ts
import { useCallback } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { paths } from 'src/routes/paths';
import type { SheetSnap } from 'src/sections/shell/sheet-snap';
import { useLayout } from 'src/sections/shell/use-layout';

/** 휴대폰 상세 시트 뒤에 깔리는 화면. */
export type SheetFrom = 'map' | 'list';

/**
 * 휴대폰 상세 시트의 상태(스펙 §4.4). 기록 상태(`location.state.sheet`)에 두어 새로고침에도 남는다.
 * `inApp`은 앱 안에서 연 기록인가다. 닫을 때 뒤로 갈지(앱 안) 뒤 화면으로 바꿔치기할지(링크로 바로 들어옴)를 정한다.
 */
export type SheetState = { from: SheetFrom; snap: SheetSnap; inApp: boolean };

/** 상태 없이 `/place/:id`에 들어왔을 때: 장소가 보이도록 지도 위 반쯤. */
const DIRECT: SheetState = { from: 'map', snap: 'half', inApp: false };

export function sheetStateOf(state: unknown): SheetState {
  if (typeof state !== 'object' || state === null || !('sheet' in state)) return DIRECT;
  const sheet = state.sheet;
  if (typeof sheet !== 'object' || sheet === null) return DIRECT;
  const { from, snap, inApp } = sheet as Record<string, unknown>;
  if (from !== 'map' && from !== 'list') return DIRECT;
  if (snap !== 'half' && snap !== 'full') return DIRECT;
  if (typeof inApp !== 'boolean') return DIRECT;
  return { from, snap, inApp };
}

export function sheetLocationState(sheet: SheetState): { sheet: SheetState } {
  return { sheet };
}

/**
 * 장소 상세를 연다(목록·지도·추가 카드 공통). 휴대폰에서 이미 상세가 열려 있으면 기록을 바꿔치기해서 마커를 몇 번
 * 눌러도 뒤로 가기 한 번이면 시트가 닫히게 한다(스펙 §4.4). 처음 열 때는 기록을 쌓고, 지도에서 열면 반쯤·목록에서
 * 열면 다 펼친 시트로 연다. 중간·넓은 화면은 늘 기록을 쌓는다.
 */
export function useOpenPlace(): (id: string, from: SheetFrom) => void {
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const compact = useLayout() === 'compact';
  return useCallback(
    (id: string, from: SheetFrom) => {
      if (compact && matchPath(paths.place(':id'), pathname) !== null) {
        void navigate(paths.place(id), {
          replace: true,
          state: sheetLocationState(sheetStateOf(state)),
        });
        return;
      }
      const snap: SheetSnap = from === 'map' ? 'half' : 'full';
      void navigate(paths.place(id), {
        state: sheetLocationState({ from, snap, inApp: true }),
      });
    },
    [compact, navigate, pathname, state],
  );
}
```

- [ ] **Step 4: 시험 통과 확인**

Run: `yarn vitest run tests/unit/sections/library/use-open-place.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: 여는 곳을 `useOpenPlace`로 바꾸기**

`src/sections/library/LibraryPage.tsx` — `onOpen` 줄을 바꾸고 import를 더한다. `navigate`·`paths`를 다른 곳에서 안 쓰게 되면 그 import도 지운다(타입 검사·eslint가 알려 준다).

```tsx
import { useOpenPlace } from 'src/sections/library/use-open-place';
// …
  const openPlace = useOpenPlace();
  const onOpen = useCallback((id: string) => openPlace(id, 'list'), [openPlace]);
```

`src/sections/map/LibraryMap.tsx` — `onMarkerClick`:

```tsx
import { useOpenPlace } from 'src/sections/library/use-open-place';
// …
  const openPlace = useOpenPlace();
// …
  const onMarkerClick = useCallback(
    (id: string) => {
      if (id === CANDIDATE_MARKER_ID) return; // 아직 보관함에 없는 후보다.
      if (pinning) return; // 핀 모드에서는 위치만 고른다.
      setFromMarker(id);
      requestListScroll((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
      openPlace(id, 'map');
    },
    [openPlace, requestListScroll, pinning],
  );
```

`LibraryMap`에서 `navigate`·`useNavigate`·`paths`를 더 쓰지 않으면 import를 지운다.

`src/sections/add-place/CandidateCard.tsx`·`PinCard.tsx` — 저장 뒤 상세로 가는 줄. 휴대폰 추가 흐름은 지도 화면에서만 열리므로 `'map'`이다(스펙 §4.3).

```tsx
import { useOpenPlace } from 'src/sections/library/use-open-place';
// 컴포넌트 안, 다른 훅 옆에
  const openPlace = useOpenPlace();
// 저장 뒤
    setFlow({ step: 'closed' });
    openPlace(result.createdId!, 'map');
```

`navigate`가 다른 곳(`backToTrip` 등)에서 계속 쓰이면 그대로 둔다.

- [ ] **Step 6: 관련 시험 돌리기**

Run: `yarn vitest run tests/unit/sections/library tests/unit/sections/map tests/unit/sections/add-place`
Expected: PASS. 실패하면 `router.state.location.state`를 비교하는 기존 단언이 없는지 보고, 기록 동작(`PUSH`)을 기대하는 시험은 그대로 통과해야 한다(넓은 화면 기본 폭 1280).

- [ ] **Step 7: 커밋**

```bash
git add src/sections/library/use-open-place.ts tests/unit/sections/library/use-open-place.test.tsx src/sections/library/LibraryPage.tsx src/sections/map/LibraryMap.tsx src/sections/add-place/CandidateCard.tsx src/sections/add-place/PinCard.tsx
git commit -m "feat: 장소 열기 규칙(useOpenPlace) — 휴대폰에서 열린 채 다시 열면 바꿔치기

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 시트 껍데기 (`PlaceSheet`)

**Files:**
- Create: `src/sections/shell/PlaceSheet.tsx`
- Modify: `src/components/icons.tsx` (`chevron-up`·`chevron-down` import와 export)
- Test: `tests/unit/sections/shell/place-sheet.test.tsx`

**Interfaces:**
- Consumes: `SheetSnap`, `resolveSnap`, `useSheetHalfPx`, `DRAG_SLOP_PX` (Task 1), `MAIN_ID` (`src/sections/shell/SkipLink`)
- Produces: `function PlaceSheet(props: { snap: SheetSnap; onSnapChange(snap: SheetSnap): void; onClose(): void; children: ReactNode }): JSX.Element` — `section aria-label="장소 상세"`, 버튼 `펼치기`/`접기`(`aria-expanded`), `닫기`. 부모는 `position: relative; overflow: hidden`이어야 한다.

- [ ] **Step 1: 아이콘 더하기**

`src/components/icons.tsx`의 `ChevronLeftIcon` import 아래:

```ts
import ChevronUpIcon from '~icons/lucide/chevron-up';
import ChevronDownIcon from '~icons/lucide/chevron-down';
```

export 목록의 `ChevronLeftIcon,` 아래에 `ChevronUpIcon,`·`ChevronDownIcon,`을 더한다.

- [ ] **Step 2: 실패하는 시험 쓰기**

```tsx
// tests/unit/sections/shell/place-sheet.test.tsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaceSheet } from 'src/sections/shell/PlaceSheet';
import type { SheetSnap } from 'src/sections/shell/sheet-snap';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Harness({
  initial = 'half',
  onSnapChange = vi.fn(),
  onClose = vi.fn(),
  onInner = vi.fn(),
  hideOnClose = false,
}: {
  initial?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  onClose?: () => void;
  onInner?: () => void;
  /** 참이면 닫기가 시트를 실제로 치운다(포커스 복귀 시험용). */
  hideOnClose?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>(initial);
  return (
    <div>
      <button type="button" onClick={() => setShown(true)}>
        연 요소
      </button>
      <button type="button" onClick={() => setShown(false)}>
        치우기
      </button>
      <main id="main" tabIndex={-1} />
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        {shown && (
          <PlaceSheet
            snap={snap}
            onSnapChange={(next) => {
              onSnapChange(next);
              setSnap(next);
            }}
            onClose={() => {
              onClose();
              if (hideOnClose) setShown(false);
            }}
          >
            <button type="button" onClick={onInner}>
              안쪽 단추
            </button>
            <input aria-label="편집칸" onKeyDown={(event) => event.preventDefault()} />
          </PlaceSheet>
        )}
      </div>
    </div>
  );
}

async function open(props: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...props} />);
  await userEvent.click(screen.getByRole('button', { name: '연 요소' }));
  return screen.getByRole('region', { name: '장소 상세' });
}

/** 끌기 흉내. 움직임 사이에 `ms`만큼 시간을 흘려 빠르기를 정한다(성능 시계만 가짜). */
function dragOn(el: HTMLElement, from: number, moves: { y: number; ms: number }[], upAfterMs = 0) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientY: from });
  let y = from;
  for (const move of moves) {
    vi.advanceTimersByTime(move.ms);
    y = move.y;
    fireEvent.pointerMove(el, { pointerId: 1, clientY: y });
  }
  vi.advanceTimersByTime(upAfterMs);
  fireEvent.pointerUp(el, { pointerId: 1, clientY: y });
}

describe('PlaceSheet', () => {
  it('열리면 시트로 포커스를 옮기고, 시트 안에서 닫으면 연 요소로 돌린다', async () => {
    const sheet = await open({ hideOnClose: true });
    expect(sheet).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.getByRole('button', { name: '연 요소' })).toHaveFocus();
  });

  it('시트 밖을 눌러 치워지면 그 요소의 포커스를 빼앗지 않는다', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: '치우기' }));
    expect(screen.getByRole('button', { name: '치우기' })).toHaveFocus();
  });

  it('펼치기·접기 버튼과 aria-expanded', async () => {
    const onSnapChange = vi.fn();
    await open({ onSnapChange });
    const toggle = screen.getByRole('button', { name: '펼치기' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    const collapse = screen.getByRole('button', { name: '접기' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(collapse);
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
  });

  it('닫기 버튼과 Esc는 닫는다. 이미 처리된 Esc는 무시한다', async () => {
    const onClose = vi.fn();
    const sheet = await open({ onClose });
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '편집칸' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('반쯤에서 천천히 끌어 내리면 닫는다', async () => {
    const onClose = vi.fn();
    const sheet = await open({ onClose });
    vi.useFakeTimers({ toFake: ['performance'] });
    dragOn(sheet, 500, [
      { y: 520, ms: 16 },
      { y: 700, ms: 1000 },
    ], 200);
    expect(onClose).toHaveBeenCalled();
  });

  it('반쯤에서 끌어 올리면 다 펼치고, 끌기 뒤의 클릭은 삼킨다', async () => {
    const onSnapChange = vi.fn();
    const onInner = vi.fn();
    await open({ onSnapChange, onInner });
    const inner = screen.getByRole('button', { name: '안쪽 단추' });
    vi.useFakeTimers({ toFake: ['performance'] });
    dragOn(inner, 500, [
      { y: 480, ms: 16 },
      { y: 200, ms: 1000 },
    ], 200);
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    fireEvent.click(inner);
    expect(onInner).not.toHaveBeenCalled();
    vi.useRealTimers();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.click(inner);
    expect(onInner).toHaveBeenCalledTimes(1);
  });

  it('8px보다 적게 움직이면 끌기가 아니다', async () => {
    const onSnapChange = vi.fn();
    const onClose = vi.fn();
    const sheet = await open({ onSnapChange, onClose });
    vi.useFakeTimers({ toFake: ['performance'] });
    dragOn(sheet, 500, [{ y: 505, ms: 16 }]);
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('다 펼침에서는 안쪽을 끌어도 단계가 바뀌지 않는다(안쪽은 스크롤)', async () => {
    const onSnapChange = vi.fn();
    await open({ initial: 'full', onSnapChange });
    vi.useFakeTimers({ toFake: ['performance'] });
    dragOn(screen.getByRole('button', { name: '안쪽 단추' }), 200, [
      { y: 220, ms: 16 },
      { y: 700, ms: 1000 },
    ], 200);
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  it('반쯤일 때 가려진 요소에 포커스가 가면 다 펼친다', async () => {
    const onSnapChange = vi.fn();
    const sheet = await open({ onSnapChange });
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ top: 400 } as DOMRect);
    const input = screen.getByRole('textbox', { name: '편집칸' });
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ bottom: 900 } as DOMRect);
    const inner = screen.getByRole('button', { name: '안쪽 단추' });
    vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue({ bottom: 600 } as DOMRect);
    act(() => inner.focus());
    expect(onSnapChange).not.toHaveBeenCalled();
    act(() => input.focus());
    expect(onSnapChange).toHaveBeenCalledWith('full');
  });
});
```

- [ ] **Step 3: 시험이 실패하는지 확인**

Run: `yarn vitest run tests/unit/sections/shell/place-sheet.test.tsx`
Expected: FAIL — `Failed to resolve import "src/sections/shell/PlaceSheet"`

- [ ] **Step 4: 구현**

```tsx
// src/sections/shell/PlaceSheet.tsx
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'src/components/icons';
import {
  DRAG_SLOP_PX,
  resolveSnap,
  useSheetHalfPx,
  type SheetSnap,
} from 'src/sections/shell/sheet-snap';
import { MAIN_ID } from 'src/sections/shell/SkipLink';

/** 마지막 움직임이 이보다 오래전이면(ms) 손가락이 멈춘 뒤 뗀 것이라 빠르기를 0으로 본다. */
const STALE_MOVE_MS = 100;

type Drag = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastT: number;
  velocity: number;
  active: boolean;
};

type Props = {
  snap: SheetSnap;
  onSnapChange(snap: SheetSnap): void;
  /** 닫기(선택 해제). 닫기 버튼·끌어 내리기·Esc가 부른다. */
  onClose(): void;
  children: ReactNode;
};

/**
 * 휴대폰 상세 시트(스펙 §4). 지도·목록 위 아래쪽에 붙고 모달이 아니라 뒤 화면을 계속 누를 수 있다.
 * - 반쯤: 윗부분만 보이고 안쪽은 스크롤하지 않는다. 시트 어디를 잡아도 끌린다.
 * - 다 펼침: 부모 높이 전체. 머리 줄만 끌리고 안쪽은 스크롤한다.
 * - 끌기 없이도 `펼치기`/`접기`·`닫기` 버튼과 Esc로 다 할 수 있다. 반쯤일 때 가려진 요소에 포커스가 가면 펼친다.
 * - 열리면 포커스를 시트로 옮기고, 시트 안에 포커스가 있던 채 닫히면 연 요소(없으면 본문)로 돌린다.
 * 부모는 `position: relative; overflow: hidden`이어야 한다(반쯤일 때 아래로 내려간 부분을 자른다).
 */
export function PlaceSheet({ snap, onSnapChange, onClose, children }: Props) {
  const halfPx = useSheetHalfPx();
  const rootRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    root?.focus({ preventScroll: true });
    return () => {
      // 포커스가 시트 안에 있었다면(치워지며 `body`로 떨어졌거나 아직 안에 있음) 연 요소나 본문으로 돌린다.
      // 시트 밖(하단 탭 등)을 눌러 닫혔으면 그 요소의 포커스를 그대로 둔다.
      const now = document.activeElement;
      if (now !== null && now !== document.body && !root?.contains(now)) return;
      const target = opener?.isConnected ? opener : document.getElementById(MAIN_ID);
      target?.focus({ preventScroll: true });
    };
  }, []);

  // 접으면 안쪽을 맨 위로 돌려 반쯤 자리에 이름·주소가 보이게 한다.
  useEffect(() => {
    if (snap === 'half' && contentRef.current !== null) contentRef.current.scrollTop = 0;
  }, [snap]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (snap === 'full' && !headerRef.current?.contains(event.target as Node)) return;
    const now = performance.now();
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: now,
      velocity: 0,
      active: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (d === null || d.pointerId !== event.pointerId) return;
    const dy = event.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < DRAG_SLOP_PX) return;
      d.active = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 포인터 잡기를 못 하는 환경(jsdom 등)에서도 끌기는 이어진다.
      }
    }
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) d.velocity = (event.clientY - d.lastY) / dt;
    d.lastY = event.clientY;
    d.lastT = now;
    setOffset(dy);
  };

  const endDrag = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = drag.current;
    if (d === null || d.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    setOffset(null);
    // 끌기로 끝난 손짓 뒤의 클릭은 버튼을 누르지 않는다. 클릭이 오지 않을 수도 있어 다음 차례에 푼다.
    swallowClick.current = true;
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 0);
    if (cancelled) return;
    const velocity = performance.now() - d.lastT > STALE_MOVE_MS ? 0 : d.velocity;
    const fullPx = rootRef.current?.parentElement?.clientHeight || window.innerHeight;
    const next = resolveSnap({
      from: snap,
      offsetPx: event.clientY - d.startY,
      velocity,
      halfPx,
      fullPx,
    });
    if (next === 'closed') onClose();
    else if (next !== snap) onSnapChange(next);
  };

  const onClickCapture = (event: MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const root = rootRef.current;
    if (snap !== 'half' || root === null || event.target === root) return;
    if (headerRef.current?.contains(event.target)) return;
    const visibleBottom = root.getBoundingClientRect().top + halfPx;
    if (event.target.getBoundingClientRect().bottom > visibleBottom) onSnapChange('full');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 편집칸·라벨 고르기 창이 먼저 쓴 Esc는 시트를 닫지 않는다(포털 이벤트도 React 트리로 올라온다).
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  const base = snap === 'full' ? '0px' : `calc(100% - ${halfPx}px)`;
  const transform =
    offset === null
      ? `translateY(${base})`
      : `translateY(max(0px, calc(${base} + ${offset}px)))`;

  return (
    <Box
      component="section"
      ref={rootRef}
      aria-label="장소 상세"
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
      onClickCapture={onClickCapture}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--tm-bg-surface)',
        borderRadius: 'var(--tm-radius-xl) var(--tm-radius-xl) 0 0',
        boxShadow: 'var(--tm-shadow-2)',
        pt: snap === 'full' ? 'env(safe-area-inset-top, 0px)' : 0,
        transform,
        transition: offset === null ? 'transform 200ms ease-out' : 'none',
        touchAction: snap === 'half' ? 'none' : 'auto',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        '&:focus': { outline: 'none' },
      }}
    >
      <Box
        ref={headerRef}
        sx={{
          flex: 'none',
          position: 'relative',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          minHeight: 44,
          px: 0.5,
          touchAction: 'none',
          cursor: 'grab',
        }}
      >
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute',
            top: 8,
            left: '50%',
            width: 36,
            height: 4,
            ml: '-18px',
            borderRadius: 999,
            bgcolor: 'var(--tm-border-strong, var(--tm-border))',
          }}
        />
        <IconButton
          onClick={() => onSnapChange(snap === 'half' ? 'full' : 'half')}
          aria-label={snap === 'half' ? '펼치기' : '접기'}
          aria-expanded={snap === 'full'}
        >
          {snap === 'half' ? (
            <ChevronUpIcon aria-hidden="true" />
          ) : (
            <ChevronDownIcon aria-hidden="true" />
          )}
        </IconButton>
        <IconButton onClick={onClose} aria-label="닫기">
          <XIcon aria-hidden="true" />
        </IconButton>
      </Box>
      <Box
        ref={contentRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: snap === 'full' ? 'auto' : 'hidden',
          overscrollBehavior: 'contain',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 5: 시험 통과 확인**

Run: `yarn vitest run tests/unit/sections/shell/place-sheet.test.tsx`
Expected: PASS (9 tests). 끌기 시험이 `clientY`를 못 받으면(값이 `undefined`) jsdom의 `PointerEvent`가 `clientY`를 넘기는지 확인하고, 안 넘기면 시험 파일 위에서 `MouseEvent`를 바탕으로 한 `PointerEvent` 대체 클래스를 `vi.stubGlobal('PointerEvent', …)`으로 심는다(구현은 바꾸지 않는다).

- [ ] **Step 6: 커밋**

```bash
git add src/sections/shell/PlaceSheet.tsx src/components/icons.tsx tests/unit/sections/shell/place-sheet.test.tsx
git commit -m "feat: 휴대폰 상세 시트 껍데기(PlaceSheet) — 반쯤/다 펼침, 끌기·버튼·Esc·포커스

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 셸에 시트 붙이기 (`AppShell`, 하단 탭)

**Files:**
- Modify: `src/sections/shell/AppShell.tsx`
- Modify: `src/sections/shell/nav-items.ts:22-28`, `src/sections/shell/BottomTabs.tsx:80`
- Test: `tests/unit/sections/shell/app-shell.test.tsx`

**Interfaces:**
- Consumes: `PlaceSheet` (Task 3), `sheetStateOf`, `sheetLocationState`, `SheetFrom` (Task 2), `SheetSnap` (Task 1)
- Produces: `isNavActive(item: NavLinkItem, pathname: string, placeOn?: SheetFrom): boolean` — 기본값 `'list'`

- [ ] **Step 1: 시험 고치기(실패하게)**

`tests/unit/sections/shell/app-shell.test.tsx`에서 다음 다섯 시험을 지운다: `compact layout shows one slot at a time and detail as a full-screen sheet`, `compact: closing a sheet opened from the list goes back instead of pushing`, `compact: a sheet opened from the map keeps the map behind it and closes to the map`, `compact: a sheet entered directly replaces history instead of leaving the app`, `marks the current destination and keeps library active on a place`. 그 자리에 아래를 넣는다(`PLACE` 상수 아래에 상태 상수 둘).

```tsx
const MAP_OPEN = { sheet: { from: 'map', snap: 'half', inApp: true } };
const LIST_OPEN = { sheet: { from: 'list', snap: 'full', inApp: true } };
const bottomNav = () => screen.getByRole('navigation', { name: '하단 메뉴' });

  it('compact layout shows one slot at a time', async () => {
    mockViewport(390);
    const { router } = await renderApp({ path: '/' });
    expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument();

    await userEvent.click(within(bottomNav()).getByRole('link', { name: '지도' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(await screen.findByRole('region', { name: '지도' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '장소 목록' })).not.toBeInTheDocument();
  });

  it('compact: a place opened from the map is a half sheet over the map and closes back', async () => {
    mockViewport(390);
    const { router } = await renderApp({ path: '/map' });
    await act(async () => {
      await router.navigate(PLACE, { state: MAP_OPEN });
    });
    expect(screen.getByRole('region', { name: '지도' })).toBeInTheDocument();
    const sheet = screen.getByRole('region', { name: '장소 상세' });
    expect(getComputedStyle(sheet).position).toBe('absolute');
    expect(screen.getByRole('button', { name: '펼치기' })).toHaveAttribute('aria-expanded', 'false');
    // 하단 탭은 시트가 열려 있어도 보이고, 시트 뒤가 지도라 `지도`가 켜져 있다.
    expect(within(bottomNav()).getByRole('link', { name: '지도' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(router.state.historyAction).toBe('POP');
  });

  it('compact: expanding only replaces the entry state, so one back step still closes', async () => {
    mockViewport(390);
    const { router } = await renderApp({ path: '/map' });
    await act(async () => {
      await router.navigate(PLACE, { state: MAP_OPEN });
    });
    await userEvent.click(screen.getByRole('button', { name: '펼치기' }));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.pathname).toBe(PLACE);
    expect(router.state.location.state).toEqual({
      sheet: { from: 'map', snap: 'full', inApp: true },
    });
    expect(screen.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(router.state.historyAction).toBe('POP');
  });

  it('compact: a place opened from the list opens fully over the list', async () => {
    mockViewport(390);
    const { router } = await renderApp({ path: '/' });
    await act(async () => {
      await router.navigate(PLACE, { state: LIST_OPEN });
    });
    expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '접기' })).toBeInTheDocument();
    expect(within(bottomNav()).getByRole('link', { name: '보관함' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument(),
    );
  });

  it('compact: a place entered directly is a half sheet over the map and closes without leaving the app', async () => {
    mockViewport(390);
    const { router } = await renderApp({ path: PLACE });
    expect(screen.getByRole('region', { name: '지도' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '펼치기' })).toBeInTheDocument();
    // 펼쳐서 기록 항목이 바뀌어도(`replace`) 앱 밖으로 나가지 않는다.
    await userEvent.click(screen.getByRole('button', { name: '펼치기' }));
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(router.state.location.pathname).toBe('/map');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('region', { name: '지도' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: 시험이 실패하는지 확인**

Run: `yarn vitest run tests/unit/sections/shell/app-shell.test.tsx`
Expected: FAIL — `펼치기` 버튼을 찾지 못함(아직 전체 화면 시트).

- [ ] **Step 3: `nav-items`·`BottomTabs` 고치기**

`src/sections/shell/nav-items.ts`:

```ts
import type { SheetFrom } from 'src/sections/library/use-open-place';
// …
/**
 * 장소 상세(`/place/:id`)는 보관함의 일부라 보관함 항목이 켜져 있다. 다만 휴대폰에서 시트 뒤가 지도면
 * (`placeOn` = `'map'`) 지도 항목이 켜져 있다.
 */
export function isNavActive(
  item: NavLinkItem,
  pathname: string,
  placeOn: SheetFrom = 'list',
): boolean {
  if (pathname.startsWith(`${paths.place('')}`)) {
    return item.key === (placeOn === 'map' ? 'map' : 'library');
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
```

주의: 원래 보관함 판정은 `pathname === paths.library || pathname.startsWith(place)`였다. 위 코드는 장소 경로를 먼저 가르고, 나머지는 `pathname === item.to || startsWith(item.to + '/')`로 판정한다. `paths.library`가 `'/'`이면 `startsWith('//')`는 거짓이라 보관함은 `'/'`에서만 켜진다 — 원래와 같다. 이 판정을 확인하는 기존 시험(`tests/unit/sections/shell/*`)을 돌려 확인한다.

`src/sections/shell/BottomTabs.tsx` — `useLocation()`에서 `state`도 받아 넘긴다:

```tsx
import { sheetStateOf } from 'src/sections/library/use-open-place';
// …
  const { pathname, state } = useLocation();
  const placeOn = sheetStateOf(state).from;
// …
        const active = isNavActive(item, pathname, placeOn);
```

(`BottomTabs`가 `pathname`을 이미 어떻게 받는지 보고 같은 자리에서 고친다. `NavRail`은 바꾸지 않는다 — 넓은·중간 화면은 늘 `보관함`.)

- [ ] **Step 4: `AppShell` 고치기**

1. import: `PlaceSheet`, `sheetLocationState`, `sheetStateOf`, `type SheetSnap`를 더하고 `ChevronLeftIcon`, `useState`를 더 쓰지 않으면 지운다.

```tsx
import { sheetLocationState, sheetStateOf } from 'src/sections/library/use-open-place';
import { PlaceSheet } from 'src/sections/shell/PlaceSheet';
import type { SheetSnap } from 'src/sections/shell/sheet-snap';
```

2. `DetailMode`를 `'column' | 'overlay'`로 줄이고 `DetailPane`에서 `sheet` 분기를 지운다:

```tsx
type DetailMode = 'column' | 'overlay';

/**
 * 넓은·중간 화면의 상세 슬롯. 폭에 따라 모양만 바뀌고 트리 위치는 그대로라서(`column` ↔ `overlay`) 창 폭이
 * 1280px을 오가도 안쪽 상세가 다시 만들어지지 않는다. 휴대폰은 `PlaceSheet`를 쓴다.
 * - `column`: 넓은 화면의 오른쪽 칸(항상 있고, 고른 장소가 없으면 안내만 보인다).
 * - `overlay`: 중간 폭에서 지도 오른쪽을 덮는 360px 패널.
 */
function DetailPane({
  mode,
  placeId,
  onClose,
}: {
  mode: DetailMode;
  placeId: string | null;
  onClose: () => void;
}) {
  const overlay = mode === 'overlay';
  return (
    <Box
      component="section"
      aria-label="장소 상세"
      sx={{
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--tm-bg-surface)',
        ...(overlay
          ? {
              position: 'absolute',
              zIndex: 1100,
              top: 0,
              right: 0,
              bottom: 0,
              width: DETAIL_WIDTH,
              maxWidth: '100%',
              borderLeft: '1px solid var(--tm-border)',
              boxShadow: 'var(--tm-shadow-2)',
            }
          : {
              flex: 'none',
              width: DETAIL_WIDTH,
              borderLeft: '1px solid var(--tm-border)',
            }),
      }}
    >
      {overlay && (
        <Box sx={{ flex: 'none', display: 'flex', p: 0.5 }}>
          <IconButton onClick={onClose} aria-label="닫기">
            <XIcon aria-hidden="true" />
          </IconButton>
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <DetailSlot placeId={placeId} />
      </Box>
    </Box>
  );
}
```

3. `AppShell` 안: `origin` 상태와 `viewOrigin`·`setOrigin` 줄, 기존 `sheetOnMap` 줄을 지우고 다음으로 바꾼다.

```tsx
  // 휴대폰 상세 시트의 뒤 화면·단계(스펙 §4.4). 기록 상태가 유일한 출처다(새로고침에도 남는다).
  const sheet = placeId === null ? null : sheetStateOf(location.state);
  const sheetOnMap = sheet?.from === 'map';
```

4. `closeDetail` 교체:

```tsx
  const closeDetail = () => {
    // 휴대폰은 시트를 연 기록을 되감아 모바일 뒤로가기와 어긋나지 않게 한다. 앱 안에서 연 기록이 아니면
    // (링크로 바로 들어옴) 앱을 벗어나지 않도록 뒤 화면으로 바꿔치기한다. 펼치기·접기가 기록 항목을
    // 바꿔치기해 `location.key`가 바뀌므로 키 대신 `inApp`으로 판단한다.
    if (layout === 'compact') {
      const current = sheetStateOf(location.state);
      if (current.inApp) void navigate(-1);
      else void navigate(current.from === 'map' ? paths.map : paths.library, { replace: true });
      return;
    }
    void navigate(paths.library);
  };

  // 펼치기·접기: 지금 기록 항목의 상태만 바꾼다(새 항목 없음).
  const changeSnap = (snap: SheetSnap) => {
    if (sheet === null) return;
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: sheetLocationState({ ...sheet, snap }) },
    );
  };
```

5. compact `body` 교체:

```tsx
  } else {
    body = (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {isMap || sheetOnMap ? (
          <Pane label="지도" sx={MAP_PANE_SX}>
            <MapSlot />
          </Pane>
        ) : (
          <Pane label="장소 목록" sx={{ flex: 1 }}>
            <ListSlot />
          </Pane>
        )}
        {sheet !== null && (
          <PlaceSheet snap={sheet.snap} onSnapChange={changeSnap} onClose={closeDetail}>
            <DetailSlot placeId={placeId} />
          </PlaceSheet>
        )}
      </Box>
    );
  }
```

6. `useAddFlowRoute(layout === 'compact' ? isMap : isLibraryView)` 위의 주석 "좁은 화면은 지도 탭에서만 지도가 가리지 않고 보인다(장소 시트는 지도를 덮는다)."를 "좁은 화면은 지도 탭에서만 추가 흐름의 지도를 쓴다(장소 시트 뒤의 지도는 시트가 다 펼치면 가려진다)."로 고친다. 동작은 그대로.

- [ ] **Step 5: 시험 통과 확인**

Run: `yarn vitest run tests/unit/sections/shell`
Expected: PASS. `headings.test.tsx`·`skip-link.test.tsx`에서 `목록으로`를 찾는 곳이 있으면 `닫기`로 바꾼다(`grep -rn "목록으로" tests/unit`).

- [ ] **Step 6: 나머지 단위 시험에서 `목록으로` 바꾸기**

Run: `grep -rn "목록으로" tests/unit src`
각 시험의 `{ name: '목록으로' }`를 `{ name: '닫기' }`로 바꾼다. 시험이 상태 없이 `router.navigate('/place/…')`로 휴대폰 시트를 열고 닫은 뒤 `/`를 기대하면, 이제 뒤 화면이 지도라 `/map`이 맞다 — 기대값을 고치거나 `{ state: { sheet: { from: 'list', snap: 'full', inApp: true } } }`를 넘겨 원래 뜻(목록에서 열기)을 지킨다. `src`에는 `목록으로`가 남지 않아야 한다.

Run: `yarn vitest run`
Expected: PASS(라벨 고르기는 아직 그대로라 그 시험들도 통과).

- [ ] **Step 7: 커밋**

```bash
git add src/sections/shell tests/unit
git commit -m "feat: 휴대폰 상세를 지도·목록 위 아래쪽 시트로(반쯤/다 펼침, 하단 탭 유지)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 휴대폰 지도가 시트에 가려지지 않게 (`LibraryMap`)

**Files:**
- Modify: `src/sections/map/LibraryMap.tsx`
- Test: `tests/unit/sections/map/library-map.test.tsx`

**Interfaces:**
- Consumes: `useSheetHalfPx` (Task 1), `useOpenPlace` (Task 2, 이미 연결됨)

- [ ] **Step 1: 실패하는 시험 쓰기**

`describe('library map', …)` 안 `opens the detail sheet from a marker and keeps the map behind it` 아래에 더한다. 샘플 장소 2는 `[128.95, 37.77]`이다.

```tsx
  it('휴대폰: 마커를 누르면 반쯤 시트가 열리고 장소를 시트 위 영역 가운데로 모은다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    await user.click(marker(2)!);
    expect(router.state.location.state).toEqual({
      sheet: { from: 'map', snap: 'half', inApp: true },
    });
    expect(await screen.findByRole('button', { name: '펼치기' })).toBeInTheDocument();
    // 아래쪽 여백(시트)만큼 지도 중심이 장소보다 남쪽이다 — 장소는 보이는 영역 가운데에 온다.
    await waitFor(() => {
      const camera = fakeAdapter().getCamera()!;
      expect(camera.zoom).toBe(16);
      expect(camera.center[0]).toBeCloseTo(128.95, 4);
      expect(camera.center[1]).toBeLessThan(37.77);
    });
  });

  it('휴대폰: 시트가 열린 채 다른 마커를 누르면 기록을 바꿔치기하고 지도는 그대로 둔다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 390, path: '/map' });
    await ready();
    await user.click(marker(2)!);
    await screen.findByRole('button', { name: '펼치기' });
    const panned = { center: [128.9, 37.7] as [number, number], zoom: 12 };
    fakeAdapter().setCamera(panned);

    await user.click(marker(1)!);

    expect(router.state.location.pathname).toBe(`/place/${id(1)}`);
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fakeAdapter().getCamera()).toEqual(panned);
  });
```

- [ ] **Step 2: 시험이 실패하는지 확인**

Run: `yarn vitest run tests/unit/sections/map/library-map.test.tsx -t '휴대폰'`
Expected: 첫 시험 FAIL — `camera.center[1]`이 37.77(여백이 없어 마커로 연 장소는 옮기지 않음). 둘째는 Task 2 덕분에 이미 통과할 수 있다.

- [ ] **Step 3: 구현**

`src/sections/map/LibraryMap.tsx`:

```tsx
import { useSheetHalfPx } from 'src/sections/shell/sheet-snap';
// …
  // 중간 폭에서는 상세 칸이나 추가 칸이 지도 오른쪽을 덮는다. 핀 모드에는 셸이 상세를 내려 지도 전체를 쓴다.
  const detailOverlaid =
    layout === 'medium' && !pinning && (placeId !== null || showsAddPanel(flow));
  // 휴대폰에서는 상세 시트가 지도 아래쪽을 덮는다(이 지도가 그려져 있으면 시트 뒤가 지도다). 다 펼치면 지도가
  // 통째로 가려지므로 여백은 늘 반쯤 높이로 둔다.
  const sheetOverlaid = layout === 'compact' && !pinning && placeId !== null;
  const sheetHalf = useSheetHalfPx();
```

`seenOverlay` 블록을 두 덮개 모두로 넓힌다(이름은 `covered`):

```tsx
  // 상세 덮개(중간 폭 오버레이·휴대폰 시트)가 새로 지도를 덮으면(넓은 화면에서 줄이거나 마커를 눌러 열 때) 열어 둔
  // 장소를 가려지지 않는 쪽으로 다시 모은다. 임시 마커가 있으면(핀 모드에서 입력 카드로 넘어갈 때) 그 위치를 모은다.
  // 덮개가 사라질 때는 장소가 계속 보이므로 지도를 그대로 둔다.
  const covered = detailOverlaid || sheetOverlaid;
  const [seenOverlay, setSeenOverlay] = useState(covered);
  if (seenOverlay !== covered) {
    setSeenOverlay(covered);
    const open = !covered || placeId === null ? undefined : library.places[placeId];
    if (covered && tempPoint !== null) {
      setFocus({ point: [tempPoint.lng, tempPoint.lat], seq: (focus?.seq ?? 0) + 1 });
    } else if (open !== undefined && open.deletedAt === null) {
      setFocus({ point: [open.lng, open.lat], seq: (focus?.seq ?? 0) + 1 });
    }
  }
```

주의: 링크로 바로 들어온 경우는 처음 렌더부터 `covered`가 참이라 이 블록이 돌지 않는다. 그 경우는 위의 `seen !== placeId` 블록(처음 `seen`은 `null`)이 장소로 옮긴다 — 여백은 아래 `padding`에 이미 들어 있어 시트 위 영역 가운데로 간다.

`padding` 줄 교체:

```tsx
  const padding = detailOverlaid
    ? OVERLAID_PADDING
    : sheetOverlaid
      ? { ...BASE_PADDING, bottom: sheetHalf + EDGE }
      : BASE_PADDING;
```

`padding` 객체가 렌더마다 새로 만들어져 `MapView`가 다시 맞추는지 확인한다: `MapView`가 `padding`을 `latest.current`로만 읽으면 괜찮다. 의존성 배열에 `padding`이 있으면 `useMemo`로 감싼다:

```tsx
  const padding = useMemo(
    () =>
      detailOverlaid
        ? OVERLAID_PADDING
        : sheetOverlaid
          ? { ...BASE_PADDING, bottom: sheetHalf + EDGE }
          : BASE_PADDING,
    [detailOverlaid, sheetOverlaid, sheetHalf],
  );
```

(어느 쪽이든 `useMemo` 판을 쓴다 — 안전하다.)

- [ ] **Step 4: 시험 통과 확인**

Run: `yarn vitest run tests/unit/sections/map`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/sections/map/LibraryMap.tsx tests/unit/sections/map/library-map.test.tsx
git commit -m "feat: 휴대폰 지도가 상세 시트에 가려지지 않게 아래 여백·새로 열 때 모으기

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 라벨 고르기 순서·거르기 (`label-picker-order.ts`)

**Files:**
- Create: `src/sections/place/label-picker-order.ts`
- Test: `tests/unit/sections/place/label-picker-order.test.ts`

**Interfaces:**
- Produces:
  - `orderLabelsForPicker(labels: readonly Label[], attachedIds: readonly string[], counts: ReadonlyMap<string, number>): string[]`
  - `arrangeLabels(labels: readonly Label[], order: readonly string[]): Label[]`
  - `filterLabels(labels: readonly Label[], text: string): Label[]`
  - `canCreateLabel(labels: readonly Label[], text: string): boolean`

- [ ] **Step 1: 실패하는 시험 쓰기**

`makeLabel(id, name, color, icon, order)`는 `tests/unit/sections/library/fixtures.tsx:22`에 있다.

```ts
// tests/unit/sections/place/label-picker-order.test.ts
import { describe, expect, it } from 'vitest';
import {
  arrangeLabels,
  canCreateLabel,
  filterLabels,
  orderLabelsForPicker,
} from 'src/sections/place/label-picker-order';
import { makeLabel } from '../library/fixtures';

const a = makeLabel('label00a', '서울 맛집', 'red', 'utensils', 0);
const b = makeLabel('label00b', '강원도 명소', 'blue', 'mountain', 1);
const c = makeLabel('label00c', '서울 카페&베이커리', 'yellow', 'coffee', 2);
const d = makeLabel('label00d', 'Bar', 'red', 'beer', 3);
const labels = [a, b, c, d];

describe('orderLabelsForPicker', () => {
  it('붙은 라벨 → 많이 쓴 순 → 원래 순서', () => {
    const counts = new Map([
      ['label00a', 3],
      ['label00b', 40],
      ['label00c', 40],
      ['label00d', 0],
    ]);
    expect(orderLabelsForPicker(labels, ['label00d'], counts)).toEqual([
      'label00d',
      'label00b',
      'label00c',
      'label00a',
    ]);
  });
});

describe('arrangeLabels', () => {
  it('고정한 순서대로 늘어놓고, 순서에 없는(새로 만든) 라벨은 맨 앞', () => {
    const e = makeLabel('label00e', '새 라벨', 'blue', 'star', 4);
    expect(arrangeLabels([...labels, e], ['label00b', 'label00a', 'label00d', 'label00c'])).toEqual([
      e,
      b,
      a,
      d,
      c,
    ]);
  });
});

describe('filterLabels', () => {
  it('이름에 검색어가 든 라벨만, 대소문자·앞뒤 공백 무시', () => {
    expect(filterLabels(labels, ' 서울 ')).toEqual([a, c]);
    expect(filterLabels(labels, 'bar')).toEqual([d]);
    expect(filterLabels(labels, '')).toEqual(labels);
  });
});

describe('canCreateLabel', () => {
  it('비어 있지 않고 같은 이름이 없을 때만', () => {
    expect(canCreateLabel(labels, '국밥')).toBe(true);
    expect(canCreateLabel(labels, '  서울   맛집 ')).toBe(false);
    expect(canCreateLabel(labels, 'BAR')).toBe(false);
    expect(canCreateLabel(labels, '   ')).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `yarn vitest run tests/unit/sections/place/label-picker-order.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// src/sections/place/label-picker-order.ts
import { normalizeLabelName, type Label } from 'src/schema/library';

/**
 * 라벨 고르기 창의 줄 순서(스펙 §5.2): ① 이 장소에 붙은 라벨 ② 많이 쓴 순 ③ 원래 라벨 순서(`labels`의 순서).
 * 창을 열 때 한 번 계산해 두고 창이 열려 있는 동안 고정한다(체크할 때마다 줄이 움직이지 않게).
 */
export function orderLabelsForPicker(
  labels: readonly Label[],
  attachedIds: readonly string[],
  counts: ReadonlyMap<string, number>,
): string[] {
  const attached = new Set(attachedIds);
  const index = new Map(labels.map((label, i) => [label.id, i]));
  return [...labels]
    .sort(
      (x, y) =>
        Number(attached.has(y.id)) - Number(attached.has(x.id)) ||
        (counts.get(y.id) ?? 0) - (counts.get(x.id) ?? 0) ||
        index.get(x.id)! - index.get(y.id)!,
    )
    .map((label) => label.id);
}

/** 고정해 둔 순서(`order`)로 라벨을 늘어놓는다. 순서에 없는(창을 연 뒤 만든) 라벨은 맨 앞에 둔다. */
export function arrangeLabels(labels: readonly Label[], order: readonly string[]): Label[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...labels].sort((x, y) => (rank.get(x.id) ?? -1) - (rank.get(y.id) ?? -1));
}

function fold(text: string): string {
  return text.trim().normalize('NFC').toLocaleLowerCase('ko-KR');
}

/** 이름에 검색어가 든 라벨만 남긴다. 검색어가 비면 전부. */
export function filterLabels(labels: readonly Label[], text: string): Label[] {
  const needle = fold(text);
  if (needle === '') return [...labels];
  return labels.filter((label) => fold(label.name.value).includes(needle));
}

/** 검색어로 새 라벨을 만들 수 있는가: 비어 있지 않고 같은 이름(`normalizeLabelName`)의 라벨이 없다. */
export function canCreateLabel(labels: readonly Label[], text: string): boolean {
  const wanted = normalizeLabelName(text);
  return wanted !== '' && !labels.some((label) => normalizeLabelName(label.name.value) === wanted);
}
```

- [ ] **Step 4: 통과 확인**

Run: `yarn vitest run tests/unit/sections/place/label-picker-order.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/sections/place/label-picker-order.ts tests/unit/sections/place/label-picker-order.test.ts
git commit -m "feat: 라벨 고르기 순서·거르기 함수

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 라벨 고르기 창 (`LabelPickerDialog`, lazy)

**Files:**
- Create: `src/sections/place/LabelPickerDialog.tsx`
- Modify: `src/routes/lazy-routes.ts` (load 함수·lazy 컴포넌트·`PANEL_CHUNKS`)
- Modify: `package.json` (`build:ci`에 `--require-lazy LabelPickerDialog`)
- Test: `tests/unit/sections/place/label-picker-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 6 함수들, `labelCounts`·`DEFAULT_QUERY` (`src/domain/library/query`), `libraryAtom`, `LibraryActionResult` (`src/stores/library-state`), `useLayout`, `fieldSx`, `LabelGlyph`, `PlusIcon`, `labelColors`
- Produces:
  - `LabelPickerDialog(props: { open: boolean; onClose(): void; labels: Label[]; attachedIds: readonly string[]; onToggle(labelId: string): void; onCreate(name: string): Promise<LibraryActionResult> })`
  - `src/routes/lazy-routes.ts`: `loadLabelPickerDialog`, `LabelPickerDialog`(lazy)

- [ ] **Step 1: 실패하는 시험 쓰기**

```tsx
// tests/unit/sections/place/label-picker-dialog.test.tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Label } from 'src/schema/library';
import { LabelPickerDialog } from 'src/sections/place/LabelPickerDialog';
import { libraryAtom, type LibraryActionResult } from 'src/stores/library-state';
import { L_CAFE, L_SEA, sampleLibrary } from '../library/fixtures';
import { mockViewport } from '../shell/harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup({
  attachedIds = [L_SEA],
  onCreate = vi.fn(async (): Promise<LibraryActionResult> => ({ ok: true }) as LibraryActionResult),
  width = 1280,
}: {
  attachedIds?: string[];
  onCreate?: (name: string) => Promise<LibraryActionResult>;
  width?: number;
} = {}) {
  mockViewport(width);
  const library = sampleLibrary();
  const store = createStore();
  store.set(libraryAtom, library);
  const labels = Object.values(library.labels).sort(
    (a, b) => a.order.value - b.order.value,
  ) as Label[];
  const onToggle = vi.fn();
  const onClose = vi.fn();
  const view = (open: boolean, ids = attachedIds) => (
    <Provider store={store}>
      <LabelPickerDialog
        open={open}
        onClose={onClose}
        labels={labels}
        attachedIds={ids}
        onToggle={onToggle}
        onCreate={onCreate}
      />
    </Provider>
  );
  const utils = render(view(true));
  return { ...utils, view, onToggle, onClose, onCreate, labels };
}

const dialog = () => screen.getByRole('dialog', { name: '라벨 바꾸기' });
const rowNames = () =>
  within(within(dialog()).getByRole('group', { name: '라벨 목록' }))
    .getAllByRole('checkbox')
    .map((box) => box.closest('label')!.querySelector('[data-label-name]')!.textContent);

describe('LabelPickerDialog', () => {
  it('붙은 라벨이 먼저, 나머지는 많이 쓴 순이고 개수를 보인다', () => {
    setup();
    // 샘플: 맛집 2곳, 카페 1곳, 바다뷰 1곳. 바다뷰가 붙어 있다.
    expect(rowNames()).toEqual(['바다뷰', '맛집', '카페']);
    expect(within(dialog()).getByRole('checkbox', { name: /^바다뷰/ })).toBeChecked();
    expect(within(dialog()).getByRole('checkbox', { name: /^맛집/ })).toHaveAccessibleName(
      '맛집 2곳',
    );
  });

  it('체크하면 바로 onToggle을 부르고, 열려 있는 동안 순서는 그대로다', async () => {
    const { rerender, view, onToggle } = setup();
    await userEvent.click(within(dialog()).getByRole('checkbox', { name: /^카페/ }));
    expect(onToggle).toHaveBeenCalledWith(L_CAFE);
    rerender(view(true, [L_SEA, L_CAFE]));
    expect(rowNames()).toEqual(['바다뷰', '맛집', '카페']);
    expect(within(dialog()).getByRole('checkbox', { name: /^카페/ })).toBeChecked();
  });

  it('다시 열면 그때의 붙은 라벨 기준으로 순서를 새로 정한다', () => {
    const { rerender, view } = setup();
    rerender(view(false, [L_CAFE]));
    rerender(view(true, [L_CAFE]));
    expect(rowNames()).toEqual(['카페', '맛집', '바다뷰']);
  });

  it('검색어로 거르고, 맞는 게 없으면 알린다', async () => {
    setup();
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    expect(search).toHaveFocus();
    await userEvent.type(search, '맛');
    expect(rowNames()).toEqual(['맛집']);
    await userEvent.clear(search);
    await userEvent.type(search, '없는이름');
    expect(within(dialog()).getByText('‘없는이름’와 맞는 라벨이 없어요')).toBeInTheDocument();
  });

  it('같은 이름이 없으면 새 라벨 행이 생기고, 누르거나 Enter로 만든다', async () => {
    const { onCreate } = setup();
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    await userEvent.type(search, '맛집');
    expect(within(dialog()).queryByRole('button', { name: /새 라벨로 붙이기/ })).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, '야시장');
    await userEvent.click(within(dialog()).getByRole('button', { name: '‘야시장’ 새 라벨로 붙이기' }));
    expect(onCreate).toHaveBeenCalledWith('야시장');
    await waitFor(() => expect(search).toHaveValue(''));

    await userEvent.type(search, '국밥{Enter}');
    expect(onCreate).toHaveBeenLastCalledWith('국밥');
  });

  it('한글 조합 중 Enter는 무시한다', () => {
    const { onCreate } = setup();
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    fireEvent.change(search, { target: { value: '야시' } });
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('거절 이유를 검색 칸 아래에 보이고 입력은 남긴다', async () => {
    setup({
      onCreate: vi.fn(async () => ({
        ok: false as const,
        error: { _tag: 'LabelNameTaken', name: '야시장' },
      })) as unknown as (name: string) => Promise<LibraryActionResult>,
    });
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    await userEvent.type(search, '야시장{Enter}');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('같은 이름의 라벨이 있어요');
    expect(search).toHaveAttribute('aria-invalid', 'true');
    expect(search).toHaveValue('야시장');
  });

  it('완료로 닫는다', async () => {
    const { onClose } = setup();
    await userEvent.click(within(dialog()).getByRole('button', { name: '완료' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('휴대폰은 화면 전체로 열고 검색 칸에 포커스를 두지 않는다', () => {
    setup({ width: 390 });
    expect(screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' })).not.toHaveFocus();
  });
});
```

샘플(`sampleLibrary`): 맛집 2곳(닭강정·횟집), 카페 1곳, 바다뷰 1곳 — 위 기대값의 근거다. `LibraryActionResult`의 성공 모양이 `{ ok: true }`만으로 안 되면 실제 타입에 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `yarn vitest run tests/unit/sections/place/label-picker-dialog.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```tsx
// src/sections/place/LabelPickerDialog.tsx
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import { useAtomValue } from 'jotai';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { fieldSx } from 'src/components/field-style';
import { LabelGlyph, PlusIcon } from 'src/components/icons';
import { DEFAULT_QUERY, labelCounts } from 'src/domain/library/query';
import { LABEL_NAME_RANGE_MESSAGE, type Label } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';
import {
  arrangeLabels,
  canCreateLabel,
  filterLabels,
  orderLabelsForPicker,
} from 'src/sections/place/label-picker-order';
import { useLayout } from 'src/sections/shell/use-layout';
import { libraryAtom, type LibraryActionResult } from 'src/stores/library-state';

type Props = {
  open: boolean;
  onClose(): void;
  /** 붙일 수 있는 라벨(살아 있는 모든 라벨, 순서대로). */
  labels: Label[];
  /** 이 장소에 붙은 라벨 id. */
  attachedIds: readonly string[];
  /** 라벨을 켜거나 끈다. 실패는 호출한 쪽이 알린다(토스트). */
  onToggle(labelId: string): void;
  /** 이름으로 라벨을 만들어(같은 이름이 있으면 그것을) 붙인다. */
  onCreate(name: string): Promise<LibraryActionResult>;
};

/** 연산이 거절한 이유를 검색 칸 아래에 보일 문구로 바꾼다. 저장소 오류 같은 나머지는 `run`이 토스트로 알린다. */
function rejectionMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('_tag' in error)) return null;
  switch (error._tag) {
    case 'LabelNameInvalid':
      return LABEL_NAME_RANGE_MESSAGE;
    case 'LabelNameTaken':
      return '같은 이름의 라벨이 있어요';
    case 'NotFound':
      return '장소를 찾을 수 없어요';
    default:
      return null;
  }
}

const ROW_SX = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  width: '100%',
  minHeight: 44,
  px: 1,
  border: 0,
  borderRadius: 'var(--tm-radius-md)',
  background: 'transparent',
  color: 'var(--tm-text-primary)',
  font: 'inherit',
  fontSize: 15,
  textAlign: 'left',
  cursor: 'pointer',
  '&:hover': { bgcolor: 'var(--tm-bg-raised)' },
} as const;

/**
 * 라벨 고르기 창(스펙 §5.2). 체크할 때마다 바로 `onToggle`을 부르고(취소 없음), 닫기는 `완료`·Esc·바깥 누르기.
 * 줄 순서는 창을 연 순간 정해 열려 있는 동안 고정한다. 검색 칸은 이름으로 거르고, 같은 이름이 없으면 새 라벨을
 * 만들어 붙이는 행을 보인다(Enter도 같다).
 */
export function LabelPickerDialog({ open, onClose, labels, attachedIds, onToggle, onCreate }: Props) {
  const compact = useLayout() === 'compact';
  const library = useAtomValue(libraryAtom);
  const titleId = useId();
  const errorId = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const counts = useMemo(
    () => (open ? labelCounts(library, DEFAULT_QUERY) : new Map<string, number>()),
    [library, open],
  );

  // 열릴 때 순서를 정하고 검색을 비운다. 닫히면 다음 열기를 위해 잊는다(렌더 중 상태 갱신).
  if (open && order === null) {
    setOrder(orderLabelsForPicker(labels, attachedIds, counts));
    setText('');
    setError(null);
  }
  if (!open && order !== null) setOrder(null);

  const attached = new Set(attachedIds);
  const trimmed = text.trim();
  const shown = filterLabels(arrangeLabels(labels, order ?? []), text);
  const creatable = canCreateLabel(labels, text);

  const create = async () => {
    const result = await onCreate(text);
    if (result.ok) {
      setText('');
      setError(null);
    } else {
      setError(rejectionMessage(result.error));
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 한글 조합 중의 Enter는 글자를 확정하는 키라서 건너뛴다.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void create();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      fullScreen={compact}
      fullWidth
      maxWidth="xs"
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--tm-bg-surface)',
            backgroundImage: 'none',
            ...(compact
              ? { pt: 'env(safe-area-inset-top, 0px)' }
              : { height: 'min(640px, 80dvh)' }),
          },
        },
      }}
    >
      <Box sx={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 1.5 }}>
        <Box component="h2" id={titleId} sx={{ m: 0, flex: 1, fontSize: 18, fontWeight: 800 }}>
          라벨 바꾸기
        </Box>
        <Button onClick={onClose} sx={{ minHeight: 44, fontWeight: 800 }}>
          완료
        </Button>
      </Box>
      <Box sx={{ flex: 'none', px: 2, pt: 1, pb: 1 }}>
        <Box
          component="input"
          type="search"
          autoFocus={!compact}
          aria-label="라벨 검색 또는 새 라벨 이름"
          placeholder="라벨 검색 또는 새 이름"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          sx={fieldSx({ invalid: error !== null })}
        />
        {error !== null && (
          <Box id={errorId} role="alert" sx={{ mt: 0.5, fontSize: 12, color: 'error.main' }}>
            {error}
          </Box>
        )}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 1, pb: 2 }}>
        {creatable && (
          <Box component="button" type="button" onClick={() => void create()} sx={ROW_SX}>
            <PlusIcon aria-hidden="true" width={18} height={18} />
            {`‘${trimmed}’ 새 라벨로 붙이기`}
          </Box>
        )}
        {labels.length === 0 ? (
          <Box component="p" sx={{ m: 0, px: 1, py: 1.5, color: 'var(--tm-text-secondary)' }}>
            만든 라벨이 없어요. 검색 칸에 이름을 쓰고 Enter로 만들어요
          </Box>
        ) : shown.length === 0 ? (
          <Box component="p" sx={{ m: 0, px: 1, py: 1.5, color: 'var(--tm-text-secondary)' }}>
            {`‘${trimmed}’와 맞는 라벨이 없어요`}
          </Box>
        ) : (
          <Box
            component="ul"
            role="group"
            aria-label="라벨 목록"
            sx={{ listStyle: 'none', m: 0, p: 0 }}
          >
            {shown.map((label) => {
              const tone = labelColors(label.color.value);
              return (
                <li key={label.id}>
                  <Box component="label" sx={ROW_SX}>
                    <Box
                      component="input"
                      type="checkbox"
                      checked={attached.has(label.id)}
                      onChange={() => onToggle(label.id)}
                      sx={{ flex: 'none', width: 20, height: 20, m: 0, accentColor: tone.marker }}
                    />
                    <Box
                      component="span"
                      aria-hidden="true"
                      sx={{ flex: 'none', display: 'inline-flex', color: tone.marker }}
                    >
                      <LabelGlyph name={label.icon.value} size={16} />
                    </Box>
                    <Box
                      component="span"
                      data-label-name=""
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label.name.value}
                    </Box>
                    <Box
                      component="span"
                      sx={{ flex: 'none', fontSize: 13, color: 'var(--tm-text-secondary)' }}
                    >
                      {` ${counts.get(label.id) ?? 0}곳`}
                    </Box>
                  </Box>
                </li>
              );
            })}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
```

`labelColors`가 돌려주는 객체에 `marker`가 있는지 `src/sections/library/label-style.ts`에서 확인한다(`ChipButton`의 `tone` 타입이 `{ fill; text; marker }`다). `PlusIcon`이 `width`/`height` prop을 받지 않으면 `sx`가 있는 `Box`로 감싸 크기를 준다.

접근 이름이 `맛집 2곳`이 되도록 개수 span 앞의 공백을 확인한다(접근 이름은 텍스트를 이어 붙인다 — 이름 span 뒤에 `' 2곳'`).

- [ ] **Step 4: lazy 등록**

`src/routes/lazy-routes.ts` — `loadTripShareDialog` 정의 아래:

```ts
export const loadLabelPickerDialog = lazyChunk(
  () => import('src/sections/place/LabelPickerDialog'),
);
```

`TripShareDialog` lazy 아래:

```ts
export const LabelPickerDialog = lazy(() =>
  loadLabelPickerDialog().then((m) => ({ default: m.LabelPickerDialog })),
);
```

`PANEL_CHUNKS` 끝에 `loadLabelPickerDialog,`를 더하고, 그 위 주석 "추가 칸의 단계 화면과 공유 내보내기·일정 공유·백업 되살리기 대화상자도"를 "…백업 되살리기·라벨 고르기 대화상자도"로, `PANEL_CHUNKS` 주석도 같은 뜻으로 고친다.

`package.json` `build:ci`의 `--require-lazy TripShareDialog` 뒤에 ` --require-lazy LabelPickerDialog`를 더한다.

- [ ] **Step 5: 통과 확인**

Run: `yarn vitest run tests/unit/sections/place/label-picker-dialog.test.tsx tests/unit/routes`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/sections/place/LabelPickerDialog.tsx src/routes/lazy-routes.ts package.json tests/unit/sections/place/label-picker-dialog.test.tsx
git commit -m "feat: 라벨 고르기 창 — 검색·많이 쓴 순 체크 목록·새 라벨(lazy)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 라벨 칸을 "붙은 라벨 + 라벨 바꾸기"로 (`LabelPicker`)와 단위 시험 옮기기

**Files:**
- Modify: `src/sections/place/LabelPicker.tsx` (전체 교체)
- Create: `tests/unit/helpers/label-picker.ts`
- Modify: `tests/unit/sections/place/label-picker.test.tsx` (전체 교체)
- Modify: `tests/unit/sections/place/place-detail.test.tsx:113-162`
- Modify: `tests/unit/sections/add-place/link-flow.test.tsx`, `pin-flow.test.tsx` (`새 라벨 이름`·라벨 칩 `aria-pressed`를 쓰는 곳)

**Interfaces:**
- Consumes: lazy `LabelPickerDialog` (Task 7), `LazyDialogHost` (`src/sections/share-export/LazyDialogHost`), `LabelBadge` (`src/sections/library/LabelBadge`), `BUTTON_SX`, `TagsIcon`
- Produces: 같은 `LabelPicker` props(`labels`, `attachedIds`, `onToggle`, `onCreate`). DOM: `list "붙은 라벨"` 또는 문구 `붙은 라벨이 없어요`, 버튼 `라벨 바꾸기`(`aria-haspopup="dialog"`).
- 시험 도우미: `openLabelPicker(user: UserEvent, scope: HTMLElement): Promise<HTMLElement>`

- [ ] **Step 1: 시험 도우미 쓰기**

```ts
// tests/unit/helpers/label-picker.ts
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** `scope` 안의 `라벨 바꾸기`를 눌러 라벨 고르기 창을 열고 그 창을 돌려준다. */
export async function openLabelPicker(user: UserEvent, scope: HTMLElement): Promise<HTMLElement> {
  await user.click(within(scope).getByRole('button', { name: '라벨 바꾸기' }));
  return screen.findByRole('dialog', { name: '라벨 바꾸기' });
}

/** 창 안의 검색 칸. */
export const pickerSearch = (dialog: HTMLElement): HTMLElement =>
  within(dialog).getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });

/** 창 안의 라벨 체크박스(이름 앞부분으로 찾는다 — 접근 이름 끝에 `N곳`이 붙는다). */
export const pickerBox = (dialog: HTMLElement, name: string): HTMLElement =>
  within(dialog).getByRole('checkbox', { name: new RegExp(`^${name} \\d+곳$`) });

/** 라벨 칸에 붙은 라벨 이름들. */
export const attachedNames = (scope: HTMLElement): string[] => {
  const list = within(scope).queryByRole('list', { name: '붙은 라벨' });
  return list === null
    ? []
    : within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent ?? '');
};
```

- [ ] **Step 2: `label-picker.test.tsx`를 새 동작으로 바꾸기(실패하게)**

```tsx
// tests/unit/sections/place/label-picker.test.tsx
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Label } from 'src/schema/library';
import { LabelPicker } from 'src/sections/place/LabelPicker';
import { libraryAtom } from 'src/stores/library-state';
import { attachedNames, openLabelPicker } from '../../helpers/label-picker';
import { L_CAFE, L_SEA, sampleLibrary } from '../library/fixtures';
import { mockViewport } from '../shell/harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(attachedIds: string[]) {
  mockViewport(1280);
  const library = sampleLibrary();
  const store = createStore();
  store.set(libraryAtom, library);
  const labels = Object.values(library.labels).sort(
    (a, b) => a.order.value - b.order.value,
  ) as Label[];
  const onToggle = vi.fn();
  render(
    <Provider store={store}>
      <section aria-label="칸">
        <LabelPicker labels={labels} attachedIds={attachedIds} onToggle={onToggle} onCreate={vi.fn()} />
      </section>
    </Provider>,
  );
  return { onToggle, scope: screen.getByRole('region', { name: '칸' }) };
}

describe('LabelPicker', () => {
  it('붙은 라벨만 라벨 순서대로 보인다', () => {
    const { scope } = setup([L_SEA, L_CAFE]);
    expect(attachedNames(scope)).toEqual(['카페', '바다뷰']);
    expect(within(scope).queryByRole('checkbox')).toBeNull();
    expect(within(scope).queryByRole('textbox')).toBeNull();
  });

  it('붙은 라벨이 없으면 알린다', () => {
    const { scope } = setup([]);
    expect(within(scope).getByText('붙은 라벨이 없어요')).toBeInTheDocument();
  });

  it('라벨 바꾸기를 누르면 고르기 창이 열리고, 체크가 onToggle로 간다', async () => {
    const user = userEvent.setup();
    const { scope, onToggle } = setup([L_SEA]);
    const button = within(scope).getByRole('button', { name: '라벨 바꾸기' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    const dialog = await openLabelPicker(user, scope);
    await user.click(within(dialog).getByRole('checkbox', { name: /^카페/ }));
    expect(onToggle).toHaveBeenCalledWith(L_CAFE);
    await user.click(within(dialog).getByRole('button', { name: '완료' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();
  });
});
```

`attachedNames`가 `LabelBadge`의 아이콘 때문에 다른 글자를 섞으면(`textContent`) 실제 출력에 맞춰 기대값을 고친다(아이콘은 SVG라 글자가 없다).

Run: `yarn vitest run tests/unit/sections/place/label-picker.test.tsx`
Expected: FAIL — `붙은 라벨` 목록이 없음.

- [ ] **Step 3: `LabelPicker` 교체**

```tsx
// src/sections/place/LabelPicker.tsx
import Box from '@mui/material/Box';
import { useState } from 'react';
import { TagsIcon } from 'src/components/icons';
import { LabelPickerDialog } from 'src/routes/lazy-routes';
import type { Label } from 'src/schema/library';
import { LabelBadge } from 'src/sections/library/LabelBadge';
import { BUTTON_SX } from 'src/sections/place/button-style';
import { LazyDialogHost } from 'src/sections/share-export/LazyDialogHost';
import type { LibraryActionResult } from 'src/stores/library-state';

type Props = {
  /** 붙일 수 있는 라벨(살아 있는 모든 라벨, 순서대로). */
  labels: Label[];
  /** 이 장소에 붙은 라벨 id. */
  attachedIds: readonly string[];
  /** 라벨을 켜거나 끈다. 실패는 호출한 쪽이 알린다(토스트). */
  onToggle(labelId: string): void;
  /** 이름으로 라벨을 만들어(같은 이름이 있으면 그것을) 붙인다. */
  onCreate(name: string): Promise<LibraryActionResult>;
};

/**
 * 장소 상세·추가 카드의 라벨 칸(스펙 §5.1). 붙은 라벨만 보이고, `라벨 바꾸기`가 라벨 고르기 창(나눠 받음)을 연다.
 * 창을 닫으면 포커스는 이 버튼으로 돌아온다.
 */
export function LabelPicker({ labels, attachedIds, onToggle, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const attached = labels.filter((label) => attachedIds.includes(label.id));
  return (
    <Box>
      {attached.length > 0 ? (
        <Box
          component="ul"
          aria-label="붙은 라벨"
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}
        >
          {attached.map((label) => (
            <Box component="li" key={label.id} sx={{ minWidth: 0, maxWidth: '100%' }}>
              <LabelBadge label={label} />
            </Box>
          ))}
        </Box>
      ) : (
        <Box component="p" sx={{ m: 0, fontSize: 14, color: 'var(--tm-text-secondary)' }}>
          붙은 라벨이 없어요
        </Box>
      )}
      <Box
        component="button"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        sx={[BUTTON_SX, { mt: 1 }]}
      >
        <TagsIcon aria-hidden="true" />
        라벨 바꾸기
      </Box>
      <LazyDialogHost open={open} onClose={close} heading="라벨 바꾸기">
        <LabelPickerDialog
          open={open}
          onClose={close}
          labels={labels}
          attachedIds={attachedIds}
          onToggle={onToggle}
          onCreate={onCreate}
        />
      </LazyDialogHost>
    </Box>
  );
}
```

`sx={[BUTTON_SX, { mt: 1 }]}`가 타입 오류를 내면 `sx={{ ...BUTTON_SX, mt: 1 }}`로 쓴다.

Run: `yarn vitest run tests/unit/sections/place/label-picker.test.tsx`
Expected: PASS

- [ ] **Step 4: `place-detail.test.tsx` 라벨 시험 옮기기**

`toggle label chip and create new label with Enter; invalid name shows error`와 `ignores Enter that only confirms a Korean composition`을 아래로 바꾼다(위 import에 `openLabelPicker`, `pickerSearch`, `attachedNames`를 `../../helpers/label-picker`에서 더한다).

```tsx
  it('라벨 바꾸기 창에서 켜고 끄고, Enter로 새 라벨을 만든다. 잘못된 이름은 알린다', async () => {
    const user = userEvent.setup();
    const { store } = await open(P1, { ids: ['newlabel'] });
    expect(attachedNames(detail())).toEqual(['맛집']);
    const dialog = await openLabelPicker(user, detail());
    const food = within(dialog).getByRole('checkbox', { name: /^맛집/ });
    const cafe = within(dialog).getByRole('checkbox', { name: /^카페/ });
    expect(food).toBeChecked();
    expect(cafe).not.toBeChecked();

    await user.click(cafe);
    await waitFor(() => expect(cafe).toBeChecked());
    expect(store.get(libraryAtom).places[P1]!.labelIds.value).toEqual([L_FOOD, 'label002']);
    await user.click(food);
    await waitFor(() => expect(food).not.toBeChecked());
    expect(store.get(libraryAtom).places[P1]!.labelIds.value).toEqual(['label002']);

    const input = pickerSearch(dialog);
    await user.type(input, '   {Enter}');
    expect(await within(dialog).findByText('1–30자로 입력하세요')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.clear(input);
    await user.type(input, '가'.repeat(31));
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByText('1–30자로 입력하세요')).toBeInTheDocument();
    expect(Object.keys(store.get(libraryAtom).labels)).toHaveLength(3);
    expect(toastMock.error).not.toHaveBeenCalled();

    await user.clear(input);
    expect(within(dialog).queryByText('1–30자로 입력하세요')).not.toBeInTheDocument();
    await user.type(input, '야시장{Enter}');
    const created = await within(dialog).findByRole('checkbox', { name: /^야시장/ });
    expect(created).toBeChecked();
    expect(input).toHaveValue('');
    const lib = store.get(libraryAtom);
    expect(lib.labels.newlabel!.name.value).toBe('야시장');
    expect(lib.places[P1]!.labelIds.value).toEqual(['label002', 'newlabel']);

    await user.click(within(dialog).getByRole('button', { name: '완료' }));
    await waitFor(() => expect(attachedNames(detail())).toEqual(['카페', '야시장']));
  });

  it('ignores Enter that only confirms a Korean composition', async () => {
    const user = userEvent.setup();
    const { store } = await open(P1, { ids: ['newlabel'] });
    const input = pickerSearch(await openLabelPicker(user, detail()));
    fireEvent.change(input, { target: { value: '야시' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    await act(async () => {});
    expect(Object.keys(store.get(libraryAtom).labels)).toHaveLength(3);
    expect(input).toHaveValue('야시');

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(Object.keys(store.get(libraryAtom).labels)).toHaveLength(4));
  });
```

`attachedNames`의 마지막 기대값(`['카페', '야시장']`)은 라벨 `order` 순서다 — 샘플에서 새 라벨이 맨 뒤 `order`면 맞다. 다르면 실제 순서에 맞춘다. `open`(=`renderLibrary`)의 기본 폭은 1280이라 창의 검색 칸에 포커스가 간다.

Run: `yarn vitest run tests/unit/sections/place`
Expected: PASS

- [ ] **Step 5: 추가 카드 시험 옮기기**

Run: `grep -n "새 라벨 이름\|aria-pressed" tests/unit/sections/add-place/link-flow.test.tsx tests/unit/sections/add-place/pin-flow.test.tsx`

`folder-preview.test.tsx`는 `LabelPicker`를 쓰지 않으므로(폴더 미리보기 칩) 건드리지 않는다. `link-flow`·`pin-flow`에서 카드(`card`) 안 라벨을 다루는 곳마다 아래처럼 바꾼다.

| 전 | 후 |
|---|---|
| `within(card).getByRole('textbox', { name: '새 라벨 이름' })`에 `'데이트{Enter}'` 입력 | `const dialog = await openLabelPicker(user, card); await user.type(pickerSearch(dialog), '데이트{Enter}');` |
| 만든 칩 `getByRole('button', { name: '데이트' })` → `aria-pressed: true` | `within(dialog).findByRole('checkbox', { name: /^데이트/ })` → `toBeChecked()` |
| 칩을 눌러 켜고 끄기 | `within(dialog).getByRole('checkbox', { name: /^맛집/ })`를 `user.click` |
| 입력칸 값이 `''`인지 | `expect(pickerSearch(dialog)).toHaveValue('')` |
| 카드에 고른 라벨이 보이는지 | 창을 `완료`로 닫고 `expect(attachedNames(card)).toEqual([...])` |

각 시험이 다루는 뜻(새 라벨 만들기, 같은 이름은 기존 라벨을 고름, 거절 문구)은 그대로 지킨다. `checkbox` 접근 이름 끝에 `N곳`이 붙으니 늘 정규식 `^이름`으로 찾는다. 카드 시험의 `renderLibrary`/`renderApp` 폭이 390이면 창은 화면 전체(`fullScreen`)이고 검색 칸에 포커스가 없다 — `user.type`이 클릭해서 포커스를 주므로 그대로 된다.

Run: `yarn vitest run tests/unit/sections/add-place`
Expected: PASS

- [ ] **Step 6: 전체 단위 시험**

Run: `yarn vitest run && yarn typecheck && yarn lint`
Expected: 모두 통과. `grep -rn "새 라벨 이름" src tests/unit`이 아무것도 내지 않아야 한다.

- [ ] **Step 7: 커밋**

```bash
git add src/sections/place/LabelPicker.tsx tests/unit
git commit -m "feat: 라벨 칸은 붙은 라벨만, 라벨 바꾸기로 고르기 창을 연다(상세·추가 카드)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: E2E 고치기·더하기

**Files:**
- Modify: `tests/e2e/library.spec.ts`, `tests/e2e/visited-review.spec.ts`, `tests/e2e/place-adding.spec.ts` (`목록으로`·`새 라벨 이름`·상세 안 `group 라벨`)
- Create: `tests/e2e/mobile-sheet.spec.ts`
- Modify: `playwright.config.ts` (desktop `testMatch`에 `mobile-sheet.spec.ts`, iphone·galaxy 프로젝트도 같은 목록을 쓰는지 확인하고 더한다)

**Interfaces:**
- Consumes: 단위 시험과 같은 접근 이름: 시트 `region 장소 상세`, 버튼 `펼치기`/`접기`/`닫기`/`라벨 바꾸기`/`완료`, `dialog 라벨 바꾸기`, `searchbox 라벨 검색 또는 새 라벨 이름`, `group 라벨 목록`, `list 붙은 라벨`.

- [ ] **Step 1: 기존 E2E 바꾸기**

`tests/e2e/library.spec.ts` 모바일 시험(약 108~140줄):

```ts
    // 카드를 누르면 다 펼친 시트로 상세가 열린다(하단 탭은 그대로 보인다).
    const id = placeIdByName('칠성조선소');
    await page.getByRole('button', { name: /칠성조선소/ }).click();
    await expect(page).toHaveURL(new RegExp(`/place/${id}$`));
    const sheet = page.getByRole('region', { name: '장소 상세' });
    await expect(sheet.getByRole('button', { name: '접기' })).toBeVisible();
    await expect(tabs).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);

    // 새 라벨을 만들어 붙인다.
    await sheet.getByRole('button', { name: '라벨 바꾸기' }).click();
    const picker = page.getByRole('dialog', { name: '라벨 바꾸기' });
    await picker.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' }).fill('재방문');
    await picker.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' }).press('Enter');
    await expect(picker.getByRole('checkbox', { name: /^재방문/ })).toBeChecked();
    await picker.getByRole('button', { name: '완료' }).click();
    await expect(sheet.getByRole('list', { name: '붙은 라벨' })).toContainText('재방문');
```

그 뒤 `sheet.getByRole('button', { name: '목록으로' }).click()`을 `sheet.getByRole('button', { name: '닫기' }).click()`으로 바꾼다(목록에서 열었으니 `/`로 돌아간다 — 기존 단언 그대로).

`tests/e2e/visited-review.spec.ts:102`: `'목록으로'` → `'닫기'`. 이 시험이 목록에서 열었는지(카드 클릭) 확인한다 — 그러면 `/`로 돌아가는 기존 단언이 맞다.

`tests/e2e/place-adding.spec.ts`:
- `showLibraryTab`: `'목록으로'` → `'닫기'`, 주석의 "전체 화면 상세 시트"·"상세가 하단 탭을 덮고, `목록으로`는 직전 화면…"을 "상세 시트를 닫고 보관함 탭으로 간다. 시트는 지도 위에서 열렸으므로 닫으면 지도로 돌아간다."로 고친다.
- 122~127줄(카드의 새 라벨):

```ts
    // 라벨을 새로 만들면 고른 상태가 된다.
    await candidatePanel(page).getByRole('button', { name: '라벨 바꾸기' }).click();
    const picker = page.getByRole('dialog', { name: '라벨 바꾸기' });
    await picker.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' }).fill('데이트');
    await picker.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' }).press('Enter');
    await expect(picker.getByRole('checkbox', { name: /^데이트/ })).toBeChecked();
    await picker.getByRole('button', { name: '완료' }).click();
```

(`candidatePanel`이 이 파일에 import돼 있지 않으면 `./fixtures`에서 가져온다. 카드 영역을 가리키는 기존 locator가 이미 있으면 그것을 쓴다.)
- 135~137줄(상세 안 라벨):

```ts
    await expect(detail.getByRole('list', { name: '붙은 라벨' })).toContainText('데이트');
```

Run: `grep -rn "목록으로\|새 라벨 이름" tests/e2e` → 남은 것이 없어야 한다(`trip-today.spec.ts:75`의 주석 "목록으로 간다"는 다른 뜻이라 그대로).

- [ ] **Step 2: 새 E2E 쓰기**

```ts
// tests/e2e/mobile-sheet.spec.ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import { placeIdByName, seedStorage } from './fixtures';

const marker = (page: Page, name: string): Locator =>
  page.getByTestId(`marker-${placeIdByName(name)}`);
const sheetOf = (page: Page): Locator => page.getByRole('region', { name: '장소 상세' });

test.describe('휴대폰 상세 시트', { tag: '@mobile' }, () => {
  test('@smoke 지도에서 반쯤 열고, 다른 마커로 바꾸고, 펼치고 접고, 뒤로 한 번에 지도로', async ({
    page,
  }) => {
    await seedStorage(page);
    await page.goto('/map');
    await marker(page, '칠성조선소').click();
    const sheet = sheetOf(page);
    await expect(sheet.getByRole('button', { name: '펼치기' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: '이름 수정' })).toContainText('칠성조선소');
    // 지도와 하단 탭이 그대로 보인다.
    await expect(page.getByTestId('fake-map')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '하단 메뉴' })).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);

    // 다른 마커를 누르면 시트 내용만 바뀐다.
    const other = '경포대';
    await marker(page, other).click();
    await expect(sheet.getByRole('button', { name: '이름 수정' })).toContainText(other);

    // 펼치고 접는다.
    await sheet.getByRole('button', { name: '펼치기' }).click();
    await expect(sheet.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true');
    await sheet.getByRole('button', { name: '접기' }).click();

    // 새로고침해도 같은 장소의 시트가 남는다.
    await page.reload();
    await expect(sheetOf(page).getByRole('button', { name: '이름 수정' })).toContainText(other);

    // 뒤로 가기 한 번이면 지도로 돌아가고 시트가 없다.
    await page.goBack();
    await expect(page).toHaveURL(/\/map$/);
    await expect(sheetOf(page)).toHaveCount(0);
  });
});

test.describe('라벨 바꾸기', () => {
  test('@smoke 검색해서 체크하면 상세 라벨 칸에 보이고 새로고침 뒤에도 남는다', async ({ page }) => {
    await seedStorage(page);
    const id = placeIdByName('칠성조선소');
    await page.goto(`/place/${id}`);
    const sheet = sheetOf(page);
    await sheet.getByRole('button', { name: '라벨 바꾸기' }).click();
    const picker = page.getByRole('dialog', { name: '라벨 바꾸기' });
    await picker.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' }).fill('바다');
    const sea = picker.getByRole('group', { name: '라벨 목록' }).getByRole('checkbox', { name: /^바다/ });
    await sea.check();
    await picker.getByRole('button', { name: '완료' }).click();
    await expect(picker).toHaveCount(0);
    await expect(sheet.getByRole('list', { name: '붙은 라벨' })).toContainText('바다');

    await page.reload();
    await expect(sheetOf(page).getByRole('list', { name: '붙은 라벨' })).toContainText('바다');
  });
});
```

시드 장소 이름(`칠성조선소`, `경포대`)과 라벨(`바다…`)은 `tests/e2e/fixtures.ts`의 시드(`SEED_FILE`)를 보고 실제 있는 것으로 맞춘다 — `경포대`는 `visited-review.spec.ts`가, `바다`는 `library.spec.ts`가 쓰므로 있다. `칠성조선소`가 이미 `바다` 라벨을 가졌으면 다른 라벨(시드에 있는 것)을 고른다. 넓은 화면에서는 상세가 오른쪽 칸이라 `region 장소 상세`가 늘 있다(바로 들어와도 같다).

`playwright.config.ts`: `desktop` 프로젝트 `testMatch`에 `'mobile-sheet.spec.ts'`를 더하고, `iphone`·`galaxy` 프로젝트의 `testMatch`가 따로 있으면 거기에도 더한다(`@mobile`이 아닌 `라벨 바꾸기` 시험은 세 프로젝트 모두에서 돈다 — 그 프로젝트의 `grep`/`grepInvert` 설정을 보고 확인).

- [ ] **Step 3: E2E 돌리기**

Run: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH" && E2E_PORT=5176 yarn test:e2e`
Expected: 모두 통과(desktop·iphone·galaxy). 실패하면 `test-results/` 트레이스를 보고 고친다. 5173·5174는 건드리지 않는다(5174는 E2E가 스스로 띄우고 끈다 — 이미 다른 것이 쓰고 있으면 멈추고 알린다).

- [ ] **Step 4: 커밋**

```bash
git add tests/e2e playwright.config.ts
git commit -m "test: 휴대폰 상세 시트·라벨 바꾸기 E2E, 기존 E2E 문구 바꾸기

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 전체 확인

**Files:** 없음(고칠 것이 나오면 해당 파일)

- [ ] **Step 1: 전체 빌드·시험·크기**

Run: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH" && yarn build:ci`
Expected: 통과. 마지막 `size` 출력에서 첫 로딩 gzip이 327,680 이하이고 `LabelPickerDialog`가 lazy 청크로 확인된다. 숫자를 기록해 둔다(PR 본문에 쓴다).

- [ ] **Step 2: 형식·금지 문자**

Run: `yarn lint && yarn fm:check && grep -rnP '[\x{2028}\x{2029}]' src functions tests; echo "exit=$?"`
Expected: lint·prettier 통과, grep은 아무것도 내지 않고 `exit=1`.

- [ ] **Step 3: 쓰지 않게 된 코드**

Run: `yarn orphans`
Expected: 새로 생긴 고아 파일 없음. `grep -rn "ChevronLeftIcon" src`로 아직 쓰는 곳이 있는지 보고, 없으면 `icons.tsx`의 import·export도 지운다.

- [ ] **Step 4: 커밋(고친 것이 있을 때만)**

```bash
git add -A src tests
git commit -m "chore: A2 마무리 정리

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 계획 밖(이 세션이 이어서 할 일)

- 사용자 백업으로 브라우저 확인(375×812·1024·1440), 스크린숏, 확인용 복사본 삭제 — 스펙 §6.3.
- PR(한국어 본문, 끝 줄 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), ccd_pr 묶기·CI 확인.
- A1이 먼저 병합되면 `main`을 받아 `AppShell`·`LibraryMap` 충돌을 풀고 시트 닫기 = A1 선택 해제로 맞춘다(스펙 §7).
- 병합 확인 뒤 태그와 `docs/rollback.md` 문서 PR.
