# 선택 해제·거를 때 지도·긴 이름 (A1) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 선택을 마커 다시 누르기·지도 빈 곳·Esc·X로 풀고, 거르기가 바뀌면 지도가 결과 전체에 맞으며, 잘린 이름을 툴팁으로 보이고, `라벨 관리`를 칩 줄 맨 앞에 둔다.

**Architecture:** 상세 닫기를 공유 훅 `useCloseDetail`(연 곳은 jotai `detailOriginAtom`)로 모으고 셸·지도·Esc가 함께 쓴다. 지도 어댑터에 `onMapClick`을 더한다. `LibraryMap`의 "거르면 열린 장소로 다시 모으기"를 "결과 밖이면 선택 풀기"로 바꾼다. 잘림 툴팁은 공통 컴포넌트 `TruncatedText`(MUI `Tooltip`)로 한다.

**Tech Stack:** React 19, MUI 7, Jotai, react-router 7, Vitest 5 + Testing Library(jsdom), Playwright.

스펙: `docs/superpowers/specs/2026-10-18-selection-filter-tooltip-design.md`

## Global Constraints

- 시험·커밋 전에 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.
- 5173·5174 서버는 쓰지도 끄지도 않는다. `pkill` 금지. E2E는 `E2E_PORT=5175 yarn test:e2e …`(겹치면 5176).
- 첫 로딩 예산 `initialJsGzipMax` 327,680. `yarn build:ci` 통과.
- `grep -rnP '[\x{2028}\x{2029}]' src functions tests` 출력 없음.
- 사용자 문자열은 React 텍스트로만(`dangerouslySetInnerHTML` 금지). 주석·UI 문구는 한국어, 주변 코드 관례를 따른다.
- 저장 형식(`tripmap:library:v2` schemaVersion 2, `tripmap:prefs`)을 바꾸지 않는다.
- 휴대폰(compact) 상세 구조(`DetailPane mode="sheet"`)와 상세의 라벨 칸은 바꾸지 않는다(A2 범위).
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 단위 시험 하나 돌리기: `yarn vitest run <파일>`.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/components/TruncatedText.tsx` (새) | 말줄임 글자 + 잘렸을 때만 뜨는 툴팁 |
| `src/components/map/MapAdapter.ts` | `onMapClick` 계약 |
| `src/components/map/FakeMapAdapter.ts`, `NaverMapAdapter.ts` | 지도 빈 곳 누르기 |
| `src/components/map/MapView.tsx` | `onMapClick` prop |
| `src/stores/library-ui.ts` | `detailOriginAtom` |
| `src/sections/shell/use-close-detail.ts` (새) | `useCloseDetail`·`useEscapeClose`·`useFocusReturnOnClose` |
| `src/sections/shell/AppShell.tsx` | 연 곳 기록, 넓은 화면 X, Esc, 포커스 복귀 |
| `src/sections/map/LibraryMap.tsx` | 다시 누르기·빈 곳·거르기 규칙 |
| `src/sections/library/use-list-scroll-restore.ts` (새) | 닫으면 목록 스크롤 복원 |
| `src/sections/library/LibraryPage.tsx` | 위 훅 연결 |
| `src/sections/library/LabelChips.tsx` | `라벨 관리` 맨 앞 고정 |
| 잘림 적용: `LabelBadge`, `PlaceRow`, `PlaceCard`, `views/overview`, `labels/LabelsPage`, `labels/MergeDialog`, `trips/planner/DayHeader`, `trips/planner/CandidatePanel`, `trips/today/TodayHeader` | `TruncatedText`로 교체 |

---

### Task 1: `TruncatedText` 공통 컴포넌트

**Files:**
- Create: `src/components/TruncatedText.tsx`
- Test: `tests/unit/components/truncated-text.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function isTruncated(el: HTMLElement, lines: number): boolean;
  export function TruncatedText(props: {
    children: string;
    lines?: number;           // 기본 1. 2 이상이면 줄 제한(-webkit-line-clamp)
    component?: ElementType;  // 기본 'span'
    touch?: boolean;          // 기본 true. false면 길게 누르기로 열지 않음
    sx?: SxProps<Theme>;
    'data-part'?: string;
  }): JSX.Element;
  ```

- [ ] **Step 1: 실패하는 시험 쓰기**

`tests/unit/components/truncated-text.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { TruncatedText } from 'src/components/TruncatedText';

afterEach(cleanup);

const NAME = '신세계 정용진이 모은 맛집-강원 강릉 순두부';

/** jsdom은 배치를 하지 않아 넘침 크기가 0이다. 잘린 것처럼 보이게 크기를 심는다. */
function fakeOverflow(el: HTMLElement, overflow: boolean) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: overflow ? 240 : 100 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 40 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: overflow ? 80 : 40 });
}

function renderInButton(props: { lines?: number } = {}) {
  render(
    <button type="button">
      <TruncatedText {...props}>{NAME}</TruncatedText>
    </button>,
  );
  return screen.getByText(NAME);
}

describe('TruncatedText', () => {
  it('잘리지 않았으면 마우스를 올려도 툴팁이 없다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, false);
    await user.hover(text);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('잘렸으면 마우스를 올릴 때 전체 이름 툴팁이 뜬다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, true);
    await user.hover(text);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(NAME);
    await user.unhover(text);
  });

  it('잘린 글자를 감싼 단추에 키보드 포커스가 오면 툴팁이 뜬다', async () => {
    const user = userEvent.setup();
    const text = renderInButton();
    fakeOverflow(text, true);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(NAME);
    await user.tab();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('마우스·터치로 눌러 생긴 포커스에는 툴팁을 띄우지 않는다', async () => {
    const text = renderInButton();
    fakeOverflow(text, true);
    // 포인터를 누른 뒤의 포커스(글자 위에 마우스는 없음).
    fireEvent.pointerDown(document.body);
    screen.getByRole('button').focus();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('여러 줄이면 세로 넘침으로 잰다', async () => {
    const user = userEvent.setup();
    const text = renderInButton({ lines: 2 });
    fakeOverflow(text, true);
    Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 100 });
    await user.hover(text);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(NAME);
    await user.unhover(text);
  });

  it('단추의 접근 이름은 그대로다', () => {
    renderInButton();
    expect(screen.getByRole('button', { name: NAME })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `yarn vitest run tests/unit/components/truncated-text.test.tsx`
Expected: FAIL — `Failed to resolve import "src/components/TruncatedText"`

- [ ] **Step 3: 구현**

`src/components/TruncatedText.tsx`:

```tsx
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { useEffect, useRef, useState, type ElementType } from 'react';

/** 터치로 길게 눌러 툴팁을 여는 시간(ms). 목록 행의 길게 누르기(선택)와 같은 500ms다. */
export const TOOLTIP_TOUCH_DELAY_MS = 500;

/** 잘렸는가: 한 줄은 가로, 여러 줄은 세로로 넘쳤는가. */
export function isTruncated(el: HTMLElement, lines: number): boolean {
  return lines === 1 ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight;
}

/**
 * 마지막 입력이 키보드였는가(`:focus-visible`과 같은 판단). 마우스·터치로 눌러 생긴 포커스에는 툴팁을 띄우지
 * 않는다. 앱 전체에서 한 번만 듣는다.
 */
let keyboardModality = false;
let watchingModality = false;
function watchModality(): void {
  if (watchingModality || typeof document === 'undefined') return;
  watchingModality = true;
  document.addEventListener('keydown', () => (keyboardModality = true), true);
  document.addEventListener('pointerdown', () => (keyboardModality = false), true);
}

const clampSx = (lines: number) =>
  lines === 1
    ? ({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const)
    : ({
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: lines,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        // 공백 없는 긴 글자도 줄바꿈한다.
        overflowWrap: 'anywhere',
      } as const);

/** 키보드 포커스를 받는 가장 가까운 조작 요소(행·칩 단추, 링크). */
const FOCUS_HOST = 'button, a[href], [tabindex]:not([tabindex="-1"])';

type Props = {
  /** 보이는 글자이자 툴팁 내용. */
  children: string;
  /** 1이면 한 줄 말줄임, 2 이상이면 그 줄 수에서 자른다. */
  lines?: number;
  component?: ElementType;
  /** `false`면 길게 누르기로 열지 않는다(길게 누르기가 이미 다른 뜻인 곳: 보관함 행·카드). */
  touch?: boolean;
  sx?: SxProps<Theme>;
  'data-part'?: string;
};

/**
 * 말줄임 글자(스펙 A1 §5). **실제로 잘렸을 때만** 마우스 오버·키보드 포커스·길게 누르기로 전체 글자 툴팁을
 * 띄운다. 글자는 DOM에 그대로 있어 접근 이름은 바뀌지 않는다.
 */
export function TruncatedText({
  children,
  lines = 1,
  component = 'span',
  touch = true,
  sx,
  'data-part': part,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  // 감싼 조작 요소가 키보드 포커스를 받으면 연다. 글자 자체는 포커스를 받지 않는다.
  useEffect(() => {
    watchModality();
    const el = ref.current;
    const host = el?.closest<HTMLElement>(FOCUS_HOST);
    if (!el || !host) return;
    const onFocus = () => {
      if (keyboardModality && isTruncated(el, lines)) setOpen(true);
    };
    const onBlur = () => setOpen(false);
    host.addEventListener('focus', onFocus);
    host.addEventListener('blur', onBlur);
    return () => {
      host.removeEventListener('focus', onFocus);
      host.removeEventListener('blur', onBlur);
    };
  }, [lines]);

  return (
    <Tooltip
      title={children}
      open={open}
      onOpen={() => {
        if (ref.current !== null && isTruncated(ref.current, lines)) setOpen(true);
      }}
      onClose={() => setOpen(false)}
      disableFocusListener
      disableTouchListener={!touch}
      enterTouchDelay={TOOLTIP_TOUCH_DELAY_MS}
      disableInteractive
    >
      <Box
        component={component}
        ref={ref}
        data-part={part}
        sx={[clampSx(lines), ...(Array.isArray(sx) ? sx : [sx])]}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `yarn vitest run tests/unit/components/truncated-text.test.tsx`
Expected: PASS (6개). MUI가 글자에 `aria-label`을 붙여도 값이 같아 접근 이름 시험은 통과한다.

- [ ] **Step 5: 첫 로딩 예산 확인**

Run: `yarn build && yarn size`
Expected: 첫 로딩 gzip이 327,680 이하. (아직 앱에서 쓰지 않아 변화 없음 — Task 2 뒤에 다시 잰다.)

- [ ] **Step 6: 커밋**

```bash
git add src/components/TruncatedText.tsx tests/unit/components/truncated-text.test.tsx
git commit -m "feat: 잘렸을 때만 전체 글자를 보이는 TruncatedText

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 잘리는 곳에 `TruncatedText` 적용

**Files:**
- Modify: `src/sections/library/LabelBadge.tsx`, `src/sections/library/PlaceRow.tsx`, `src/sections/library/PlaceCard.tsx`, `src/sections/library/views/overview.tsx`, `src/sections/labels/LabelsPage.tsx:161-172`, `src/sections/labels/MergeDialog.tsx:70-82`, `src/sections/trips/planner/DayHeader.tsx:89-94`, `src/sections/trips/planner/CandidatePanel.tsx:109-120`, `src/sections/trips/today/TodayHeader.tsx:75-86`
- Test: `tests/unit/sections/library/place-row.test.tsx`(추가), `tests/unit/components/truncated-text.test.tsx`(LabelBadge 추가)

**Interfaces:**
- Consumes: `TruncatedText` (Task 1)
- Produces: `LabelBadge({ label, touch? })`, `ColorBadge({ color, icon?, name, touch? })` — `touch` 기본 true.

- [ ] **Step 1: 실패하는 시험 쓰기**

`tests/unit/sections/library/place-row.test.tsx`에 추가(파일 위쪽 import·렌더 도우미를 먼저 읽고 그 관례를 따른다. 아래는 독립 렌더 예):

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlaceRow } from 'src/sections/library/PlaceRow';
import { makeLabel, makePlace } from './fixtures';

describe('PlaceRow 긴 이름', () => {
  it('이름이 잘렸으면 마우스를 올릴 때 전체 이름 툴팁이 뜬다', async () => {
    const user = userEvent.setup();
    const name = '신세계 정용진이 모은 맛집-강원 강릉 초당 순두부 본점';
    render(
      <PlaceRow
        place={makePlace(1, { name })}
        region="강릉"
        labels={[makeLabel('label001', '저장 많은 TV 맛집 강원 100선', 'red', 'utensils', 0)]}
        selecting={false}
        selected={false}
        onOpen={() => {}}
        onToggle={() => {}}
      />,
    );
    const text = screen.getByText(name);
    Object.defineProperty(text, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 300 });
    await user.hover(text);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(name);
  });

  it('행에 장소 id 표시가 있다(닫은 뒤 포커스 복귀용)', () => {
    render(
      <PlaceRow
        place={makePlace(1, { name: '가' })}
        region="강릉"
        labels={[]}
        selecting={false}
        selected={false}
        onOpen={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('data-place-id', 'place00001');
  });
});
```

`tests/unit/components/truncated-text.test.tsx`에 추가:

```tsx
import { ColorBadge } from 'src/sections/library/LabelBadge';

describe('ColorBadge', () => {
  it('잘린 라벨 이름의 전체를 툴팁으로 보인다', async () => {
    const user = userEvent.setup();
    render(<ColorBadge color="red" name="신세계 정용진이 모은 맛집-강원" />);
    const text = screen.getByText('신세계 정용진이 모은 맛집-강원');
    fakeOverflow(text, true);
    await user.hover(text);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('신세계 정용진이 모은 맛집-강원');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `yarn vitest run tests/unit/sections/library/place-row.test.tsx tests/unit/components/truncated-text.test.tsx`
Expected: FAIL — 툴팁 없음, `data-place-id` 없음.

- [ ] **Step 3: 구현 — 각 파일**

`src/sections/library/LabelBadge.tsx` — 이름 `Box`를 `TruncatedText`로, `touch` 전달:

```tsx
import { TruncatedText } from 'src/components/TruncatedText';

/** 카드에 붙는 작은 라벨 칩. 이름이 길면 칩 안에서 말줄임하고, 잘렸으면 전체 이름 툴팁을 보인다. */
export function LabelBadge({ label, touch }: { label: Label; touch?: boolean }) {
  return (
    <ColorBadge
      color={label.color.value}
      icon={label.icon.value}
      name={label.name.value}
      touch={touch}
    />
  );
}

export function ColorBadge({
  color,
  icon,
  name,
  touch,
}: {
  color: LabelColor;
  icon?: LabelIcon;
  name: string;
  /** `false`면 길게 누르기로 툴팁을 열지 않는다(카드 안: 길게 누르기 = 선택). */
  touch?: boolean;
}) {
  // ... 바깥 Box 그대로 ...
      {icon !== undefined && <LabelGlyph name={icon} size={12} />}
      <TruncatedText touch={touch} sx={{ minWidth: 0 }}>
        {name}
      </TruncatedText>
  // ...
}
```

`src/sections/library/PlaceRow.tsx`:
- 바깥 단추에 `data-place-id={place.id}` 추가(`aria-current` 다음 줄).
- 이름:
  ```tsx
  <TruncatedText touch={false} sx={{ flex: 1, minWidth: 0, fontWeight: 700 }}>
    {place.name.value}
  </TruncatedText>
  ```
- 라벨 칩(`chips.map`) 안의 `Box`를:
  ```tsx
  <TruncatedText
    key={label.id}
    touch={false}
    sx={{
      flex: '0 1 auto',
      minWidth: 0,
      px: 0.75,
      borderRadius: 999,
      bgcolor: color.fill,
      color: color.text,
      fontSize: 11,
      fontWeight: 700,
      lineHeight: 1.6,
    }}
  >
    {label.name.value}
  </TruncatedText>
  ```
- 지역: 거리가 없을 때만 `TruncatedText`(거리는 짧아 잘리지 않는다):
  ```tsx
  {distanceM === undefined ? (
    <TruncatedText
      touch={false}
      sx={{ flex: 'none', maxWidth: '35%', fontSize: 13, color: 'var(--tm-text-secondary)' }}
    >
      {region}
    </TruncatedText>
  ) : (
    <Box
      component="span"
      sx={{
        flex: 'none',
        maxWidth: '35%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: 13,
        color: 'var(--tm-text-secondary)',
      }}
    >
      <RegionOrDistance region={region} distanceM={distanceM} />
    </Box>
  )}
  ```
- `import { TruncatedText } from 'src/components/TruncatedText';`

`src/sections/library/PlaceCard.tsx`:
- 바깥 단추에 `data-place-id={place.id}`.
- 이름: `<TruncatedText lines={2} touch={false} data-part="name" sx={{ fontWeight: 800 }}>{place.name.value}</TruncatedText>` (기존 `clamp(2)`와 같은 줄 제한·`overflowWrap`). `clamp`는 메모·한 줄 평에 계속 쓴다.
- 라벨: `<LabelBadge key={label.id} label={label} touch={false} />`.

`src/sections/library/views/overview.tsx` `LabelBlock`의 이름:
```tsx
<TruncatedText sx={{ display: 'block', pr: label === null ? 0 : 4.5, fontWeight: 800, fontSize: 15 }}>
  {label === null ? '미분류' : label.name.value}
</TruncatedText>
```

`src/sections/labels/LabelsPage.tsx` 이름:
```tsx
<TruncatedText sx={{ flex: 1, minWidth: 0, fontWeight: 700 }}>{name}</TruncatedText>
```

`src/sections/labels/MergeDialog.tsx` 이름:
```tsx
<TruncatedText sx={{ flex: 1, minWidth: 0 }}>{label.name.value}</TruncatedText>
```

`src/sections/trips/planner/DayHeader.tsx` 출발 장소:
```tsx
<TruncatedText>{start === null ? '첫 장소에서 출발' : start.name.value}</TruncatedText>
```

`src/sections/trips/planner/CandidatePanel.tsx` 후보 이름:
```tsx
<TruncatedText sx={{ display: 'block', fontWeight: 700 }}>{name}</TruncatedText>
```

`src/sections/trips/today/TodayHeader.tsx` 부제(`div`):
```tsx
<TruncatedText component="div" sx={{ fontSize: 13, color: 'var(--tm-text-secondary)' }}>
  {`${trip.title.value} · ${dayLabel(trip, model.dayIndex)}`}
</TruncatedText>
```

각 파일에 `import { TruncatedText } from 'src/components/TruncatedText';`. 쓰지 않게 된 `Box` import가 있으면 지운다(`yarn lint`가 잡는다).

- [ ] **Step 4: 통과·회귀 확인**

Run: `yarn vitest run tests/unit/sections/library tests/unit/sections/labels tests/unit/sections/trips tests/unit/components tests/unit/sections/share-import`
Expected: PASS. 기존 시험이 `[data-part="name"]`·이름 텍스트로 찾는 곳이 그대로 통과해야 한다.

- [ ] **Step 5: 린트·타입·예산**

Run: `yarn lint && yarn typecheck && yarn build && yarn size`
Expected: 통과, 첫 로딩 gzip ≤ 327,680. 넘으면 멈추고 보고한다(대안: `Tooltip` 대신 가벼운 자체 툴팁).

- [ ] **Step 6: 커밋**

```bash
git add src tests
git commit -m "feat: 잘리는 라벨·장소 이름에 전체 이름 툴팁

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `라벨 관리`를 칩 줄 맨 앞에 고정

**Files:**
- Modify: `src/sections/library/LabelChips.tsx`, `src/sections/map/LibraryMap.tsx:253`(배경 전달)
- Test: `tests/unit/sections/library/filters.test.tsx`(추가)

**Interfaces:**
- Produces: `LabelChips`에 `background?: string` prop(기본 `'var(--tm-bg-base)'`) — 고정된 링크 바탕색.

- [ ] **Step 1: 실패하는 시험**

`tests/unit/sections/library/filters.test.tsx`에 추가(파일의 렌더 관례를 따른다):

```tsx
it('라벨 관리 링크가 칩 줄의 첫 조작 요소다', async () => {
  await renderLibrary(sampleLibrary());
  const link = screen.getByRole('link', { name: '라벨 관리' });
  const group = screen.getByRole('group', { name: '라벨' });
  const row = group.parentElement!;
  const first = row.querySelector('a, button');
  expect(first).toBe(link);
  // 링크는 라벨 필터 묶음 밖에 있다.
  expect(group).not.toContainElement(link);
});
```

- [ ] **Step 2: 실패 확인**

Run: `yarn vitest run tests/unit/sections/library/filters.test.tsx`
Expected: FAIL — 첫 요소가 `모두 포함`(또는 방문 칩).

- [ ] **Step 3: 구현**

`LabelChips.tsx`: 링크를 `ManageLink`로 빼서 줄 맨 앞(`leading`보다 앞), 라벨 묶음 밖에 둔다.

```tsx
/** `라벨 관리` 링크. 칩 줄 맨 앞에 붙어(가로 스크롤해도) 늘 보인다(스펙 A1 §6). */
function ManageLink({ background }: { background: string }) {
  return (
    <Box
      component={Link}
      to={paths.labels}
      sx={{
        position: 'sticky',
        left: 0,
        zIndex: 1,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        minHeight: 44,
        // 줄의 왼쪽 여백(px 2)까지 덮어, 스크롤된 칩이 링크 왼쪽으로 비치지 않게 한다.
        ml: -2,
        pl: 2,
        pr: 1.5,
        bgcolor: background,
        borderRight: '1px solid var(--tm-border)',
        color: 'var(--tm-text-secondary)',
        fontSize: 14,
        fontWeight: 700,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        '&:focus-visible': { outlineOffset: -2 },
      }}
    >
      <TagsIcon aria-hidden="true" width={14} height={14} />
      라벨 관리
    </Box>
  );
}
```

`LabelChips` 본문:

```tsx
export function LabelChips({
  query,
  onChange,
  labels,
  counts,
  manageLink = true,
  leading,
  background = 'var(--tm-bg-base)',
}: Props) {
  // ... toggle 함수 그대로 ...
  return (
    <Box sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', px: 2, scrollbarWidth: 'none' }}>
      {manageLink && <ManageLink background={background} />}
      {leading}
      {/* 구분선 그대로 */}
      <Box role="group" aria-label="라벨" sx={{ display: 'flex', gap: 0.5, flex: 'none' }}>
        {/* 모두 포함 · 미분류 · 라벨들 (끝의 링크는 지운다) */}
      </Box>
    </Box>
  );
}
```

Props 주석 갱신: `manageLink` → "맨 앞에 `라벨 관리` 링크를 고정한다(기본 켬)…", `background` → "고정된 링크의 바탕색(칩 줄이 놓인 바탕과 같게). 기본 `var(--tm-bg-base)`." 줄 설명 주석도 `(라벨 관리 · 모두 포함 · 미분류 · 라벨들)`로.

`LibraryMap.tsx`의 compact 칩 줄(`bgcolor: 'var(--tm-bg-surface)'`)에서 `<LabelChips … background="var(--tm-bg-surface)" />`.

- [ ] **Step 4: 통과·회귀**

Run: `yarn vitest run tests/unit/sections/library tests/unit/sections/map tests/unit/sections/labels tests/unit/sections/trips`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src tests
git commit -m "feat: 라벨 관리 링크를 칩 줄 맨 앞에 고정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 지도 빈 곳 누르기(`onMapClick`)

**Files:**
- Modify: `src/components/map/MapAdapter.ts`, `src/components/map/FakeMapAdapter.ts`, `src/components/map/NaverMapAdapter.ts`, `src/components/map/MapView.tsx`
- Test: `tests/unit/components/fake-map-click.test.ts`(새), `tests/unit/components/naver-map-adapter.test.ts`(추가)

**Interfaces:**
- Produces: `MapAdapter.onMapClick(cb: () => void): void`; `MapView` prop `onMapClick?(): void`.

- [ ] **Step 1: 실패하는 시험**

`tests/unit/components/fake-map-click.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';

describe('FakeMapAdapter 지도 누르기', () => {
  it('마커가 아닌 곳을 누르면 onMapClick, 마커를 누르면 onMarkerClick만', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const adapter = new FakeMapAdapter();
    const onMap = vi.fn();
    const onMarker = vi.fn();
    adapter.onMapClick(onMap);
    adapter.onMarkerClick(onMarker);
    await adapter.mount(host);
    adapter.setMarkers([{ id: 'p1', lng: 128, lat: 37, color: '#000', clusterable: false, label: '가' }]);

    const marker = host.querySelector<HTMLElement>('[data-testid="marker-p1"]')!;
    (marker.firstElementChild as HTMLElement).click();
    expect(onMarker).toHaveBeenCalledWith('p1');
    expect(onMap).not.toHaveBeenCalled();

    host.querySelector<HTMLElement>('[data-testid="fake-map"]')!.click();
    expect(onMap).toHaveBeenCalledTimes(1);

    adapter.destroy();
    host.remove();
  });
});
```

`tests/unit/components/naver-map-adapter.test.ts`의 `describe('NaverMapAdapter SDK 계약')` 안에 추가:

```ts
it('지도 click은 onMapClick으로, 마커 DOM에서 온 click은 거른다', async () => {
  const sdk = installSdk();
  const adapter = new NaverMapAdapter('id');
  const onMap = vi.fn();
  adapter.onMapClick(onMap);
  const pending = adapter.mount(document.createElement('div'));
  release();
  await pending;
  adapter.setMarkers([{ id: 'p1', lng: 128, lat: 37.5, color: '#000', clusterable: false, label: '가' }]);
  const click = [...sdk.listeners].find((l) => (l as { name: string }).name === 'click') as {
    callback: (e?: unknown) => void;
  };
  click.callback({ domEvent: { target: document.createElement('div') } });
  expect(onMap).toHaveBeenCalledTimes(1);
  const markerEl = sdk.labels.at(-1)!;
  click.callback({ domEvent: { target: markerEl.firstElementChild ?? markerEl } });
  expect(onMap).toHaveBeenCalledTimes(1);
  adapter.destroy();
});
```

같은 파일 `installSdk`의 `addListener` 시그니처를 `(_: unknown, name: string, callback: (e?: unknown) => void)`로 넓힌다.

- [ ] **Step 2: 실패 확인**

Run: `yarn vitest run tests/unit/components/fake-map-click.test.ts tests/unit/components/naver-map-adapter.test.ts`
Expected: FAIL — `adapter.onMapClick is not a function`.

- [ ] **Step 3: 구현**

`MapAdapter.ts` 인터페이스에 (`onMarkerClick` 다음):

```ts
  /** 마커·클러스터가 아닌 지도 바탕을 눌렀을 때. 끌기·핀치는 누르기가 아니다. */
  onMapClick(cb: () => void): void;
```

`FakeMapAdapter.ts`:

```ts
  private mapCb: (() => void) | null = null;

  /** 마커 단추가 아닌 곳(지도 바탕)을 누르면 알린다. */
  private readonly handleRootClick = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('[data-testid^="marker-"]')) return;
    this.mapCb?.();
  };
```
- `mount`에서 `root.addEventListener('click', this.handleRootClick);`(root 만든 직후).
- `onMapClick(cb: () => void): void { this.mapCb = cb; }`
- `destroy`에서 `this.root?.removeEventListener('click', this.handleRootClick); this.mapCb = null;`(root 제거 전).

`NaverMapAdapter.ts`:
- 타입 `addListener(target: unknown, name: string, cb: (event?: unknown) => void): unknown;`
- 파일 위쪽:
  ```ts
  /** 마커·클러스터 아이콘 DOM 표시. 그 위를 누른 것이 지도 `click`으로도 오면 걸러 낸다. */
  const MARKER_ATTR = 'data-map-marker';

  /** SDK `click` 이벤트가 마커 아이콘에서 시작됐는가(`domEvent`는 SDK가 넘기는 원래 DOM 이벤트). */
  function fromMarker(event: unknown): boolean {
    const target = (event as { domEvent?: { target?: unknown } } | undefined)?.domEvent?.target;
    return target instanceof Element && target.closest(`[${MARKER_ATTR}]`) !== null;
  }
  ```
- 필드 `private mapClickCb: (() => void) | null = null;`
- `mount`의 `this.listeners.push(...)`에 둘째 리스너:
  ```ts
      m.Event.addListener(map, 'click', (event?: unknown) => {
        if (fromMarker(event)) return;
        this.mapClickCb?.();
      }),
  ```
- `drawMarkers`의 `add` 안 `el.addEventListener('click', onClick);` 앞에 `el.setAttribute(MARKER_ATTR, '');`
- `onMapClick(cb: () => void): void { this.mapClickCb = cb; }` (`onMarkerClick` 옆), `destroy`에서 `this.mapClickCb = null;`

`MapView.tsx`:
- Props에 `/** 마커가 아닌 지도 바탕을 눌렀을 때. */ onMapClick?(): void;`
- `adapter.onMarkerClick(...)` 다음 줄: `adapter.onMapClick(() => latest.current.onMapClick?.());`

`share-map`(`src/share-map/main.ts`) 등 `NaverMapAdapter`를 직접 쓰는 곳은 `onMapClick`을 부르지 않아도 된다(콜백 없음 = 무시).

- [ ] **Step 4: 통과 확인**

Run: `yarn vitest run tests/unit/components && yarn typecheck`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/components/map tests/unit/components
git commit -m "feat: 지도 어댑터에 지도 바탕 누르기(onMapClick)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 상세 닫기 공유 훅 · 넓은 화면 X · Esc · 포커스 복귀

**Files:**
- Modify: `src/stores/library-ui.ts`, `src/sections/shell/AppShell.tsx`
- Create: `src/sections/shell/use-close-detail.ts`
- Test: `tests/unit/sections/shell/close-detail.test.tsx`(새), `tests/unit/sections/shell/app-shell.test.tsx:62`(수정), `tests/unit/sections/map/library-map.test.tsx:88-131`(수정)

**Interfaces:**
- Consumes: `PlaceRow`/`PlaceCard`의 `data-place-id` (Task 2)
- Produces:
  ```ts
  // src/stores/library-ui.ts
  export const detailOriginAtom: PrimitiveAtom<'list' | 'map'>;
  // src/sections/shell/use-close-detail.ts
  export type CloseDetailOptions = { replace?: boolean };
  export function useCloseDetail(): (options?: CloseDetailOptions) => void;
  export function useEscapeClose(enabled: boolean, close: () => void): void;
  export function useFocusReturnOnClose(placeId: string | null): void;
  ```

- [ ] **Step 1: 실패하는 시험**

`tests/unit/sections/shell/close-detail.test.tsx`:

```tsx
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { installMapResources } from '../../components/helpers/map-resources';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

let resources: ReturnType<typeof installMapResources>;
beforeEach(() => {
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  resources = installMapResources();
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  resources.restore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const id = (n: number) => `place${String(n).padStart(5, '0')}`;
const detail = () => screen.getByRole('region', { name: '장소 상세' });
const closeButton = () => within(detail()).getByRole('button', { name: '닫기' });

describe('상세 닫기 (넓은·중간)', () => {
  it('넓은 화면 상세 칸에도 닫기가 있고, 누르면 목록으로 돌아가 안내만 남는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1280, path: `/place/${id(2)}` });
    await user.click(closeButton());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(detail()).toHaveTextContent('장소를 고르면 여기에 보여요');
    expect(within(detail()).queryByRole('button', { name: '닫기' })).not.toBeInTheDocument();
  });

  it.each([1280, 1100])('%ipx: 지도 화면에서 열었으면 닫을 때 /map으로 돌아간다', async (width) => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width, path: '/map' });
    await router.navigate(`/place/${id(2)}`);
    await user.click(await within(detail()).findByRole('button', { name: '닫기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
  });

  it('중간 화면에서 목록에서 열었으면 /로 돌아간다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1100, path: '/' });
    await router.navigate(`/place/${id(2)}`);
    await user.click(await within(detail()).findByRole('button', { name: '닫기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('Esc로 닫는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1280, path: '/' });
    await router.navigate(`/place/${id(2)}`);
    await within(detail()).findByRole('button', { name: '닫기' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('입력칸에서 누른 Esc로는 닫지 않는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1280, path: '/' });
    await router.navigate(`/place/${id(2)}`);
    await within(detail()).findByRole('button', { name: '닫기' });
    await user.click(screen.getByRole('searchbox', { name: '장소 검색' }));
    await user.keyboard('{Escape}');
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
  });

  it('메뉴가 열려 있으면 Esc는 메뉴만 닫는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1280, path: '/' });
    await router.navigate(`/place/${id(2)}`);
    await within(detail()).findByRole('button', { name: '닫기' });
    // 정렬 메뉴(목록 칸)를 연다. 단추 이름은 지금 정렬이라 `aria-haspopup`으로 찾는다.
    await user.click(document.querySelector<HTMLElement>('[aria-haspopup="menu"]')!);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
  });

  it('닫기를 키보드로 누르면 포커스가 연 장소의 목록 행으로 간다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), {
      width: 1280,
      path: '/',
      prefs: { libraryView: 'list' },
    });
    await router.navigate(`/place/${id(2)}`);
    closeButton().focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-place-id', id(2)),
    );
  });
});
```

기존 시험 고치기:
- `tests/unit/sections/shell/app-shell.test.tsx`의 `keeps the map and detail DOM nodes when crossing 1280px`: 1280에서 `expect(screen.queryByRole('button', { name: '닫기' })).not.toBeInTheDocument();` → `expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();` (주소에 장소가 있으면 넓은 화면에도 X).
- `tests/unit/sections/map/library-map.test.tsx`의 `keeps the selected place uncovered when a wide detail becomes an overlay`: `await waitFor(() => expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument());` → `await waitFor(() => expect(getComputedStyle(screen.getByRole('region', { name: '장소 상세' })).position).toBe('absolute'));`
- 같은 파일 `leaves the map alone when the overlay goes away`: `await waitFor(() => expect(screen.queryByRole('button', { name: '닫기' })).not.toBeInTheDocument());` → `await waitFor(() => expect(getComputedStyle(screen.getByRole('region', { name: '장소 상세' })).position).not.toBe('absolute'));`

- [ ] **Step 2: 실패 확인**

Run: `yarn vitest run tests/unit/sections/shell/close-detail.test.tsx`
Expected: FAIL — 넓은 화면에 `닫기` 없음 등.

- [ ] **Step 3: 구현**

`src/stores/library-ui.ts`에 추가:

```ts
/**
 * 장소를 열기 전에 보던 보관함 화면: `list`(`/`) 또는 `map`(`/map`). 상세를 닫으면 이리로 돌아간다(스펙 A1 §3.1).
 * 셸(`AppShell`)이 장소가 열리지 않은 보관함 경로를 볼 때마다 정한다.
 */
export const detailOriginAtom: PrimitiveAtom<'list' | 'map'> = atom<'list' | 'map'>('list');
```

`src/sections/shell/use-close-detail.ts`:

```ts
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { paths } from 'src/routes/paths';
import { focusIsLost } from 'src/sections/add-place/step-focus';
import { MAIN_ID } from 'src/sections/shell/SkipLink';
import { useLayout } from 'src/sections/shell/use-layout';
import { detailOriginAtom } from 'src/stores/library-ui';

export type CloseDetailOptions = {
  /** 기록을 쌓지 않고 바꾼다. 거르기로 선택이 풀릴 때 한 번의 거르기에 기록이 둘 쌓이지 않게 한다. */
  replace?: boolean;
};

/**
 * 장소 상세를 닫는다(스펙 A1 §3.1). 셸의 X·지도(다시 누르기·빈 곳)·Esc·거르기가 함께 쓴다.
 * - 넓은·중간: 열기 전에 보던 화면(`/` 또는 `/map`)으로 간다. 기록을 쌓아 뒤로가기로 방금 장소를 다시 연다.
 * - 좁은: 시트를 연 기록을 되감아 모바일 뒤로가기와 어긋나지 않게 한다. 앱 안에서 연 기록이 없으면(링크로
 *   바로 들어옴) 앱을 벗어나지 않도록 기록을 교체한다.
 */
export function useCloseDetail(): (options?: CloseDetailOptions) => void {
  const layout = useLayout();
  const { key } = useLocation();
  const navigate = useNavigate();
  const origin = useAtomValue(detailOriginAtom);
  return useCallback(
    ({ replace = false }: CloseDetailOptions = {}) => {
      const target = origin === 'map' ? paths.map : paths.library;
      if (layout === 'compact' && !replace && key !== 'default') {
        void navigate(-1);
        return;
      }
      void navigate(target, { replace: replace || layout === 'compact' });
    },
    [layout, key, navigate, origin],
  );
}

/** 글자를 입력하는 곳. 여기서 누른 Esc는 입력 취소 몫이다. */
const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
/** 열려 있으면 Esc가 그쪽 몫인 층(대화상자·메뉴·목록 상자). */
const LAYERS = '[role="dialog"], [role="menu"], [role="listbox"]';

/**
 * `enabled`인 동안 Esc로 `close`를 부른다(스펙 A1 §3.2). 다른 처리기가 먼저 받은 Esc(`preventDefault`·전파 중단:
 * MUI 대화상자·메뉴, 추가 칸, 핀 모드), 한글 조합 중, 입력칸, 열린 대화상자·메뉴가 있으면 무시한다.
 */
export function useEscapeClose(enabled: boolean, close: () => void): void {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest(TYPING)) return;
      if (document.querySelector(LAYERS) !== null) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/**
 * 상세가 닫혀 포커스가 갈 곳을 잃으면(닫기 단추·상세 안에 있었음) 연 장소의 목록 행으로, 행이 없으면 본문으로
 * 옮긴다(스펙 A1 §3.2). 화면은 스크롤하지 않는다.
 */
export function useFocusReturnOnClose(placeId: string | null): void {
  const previous = useRef(placeId);
  useEffect(() => {
    const closed = previous.current;
    previous.current = placeId;
    if (closed === null || placeId !== null || !focusIsLost()) return;
    const row = document.querySelector<HTMLElement>(`[data-place-id="${CSS.escape(closed)}"]`);
    (row ?? document.getElementById(MAIN_ID))?.focus({ preventScroll: true });
  }, [placeId]);
}
```

`src/sections/shell/AppShell.tsx`:
- import: `useAtom`(jotai), `useLayoutEffect`(react, `useState`는 남은 쓰임이 없으면 지운다), `detailOriginAtom`, `useCloseDetail`, `useEscapeClose`, `useFocusReturnOnClose`.
- `DetailPane`: 닫기 줄을 `floating || placeId !== null`일 때 그린다.
  ```tsx
  // 넓은 화면 칸도 장소가 열려 있으면 닫기를 둔다(스펙 A1 §3.2). 안내만 보일 때는 없다.
  const closable = floating || placeId !== null;
  // ...
  {closable && (
    <Box sx={{ flex: 'none', display: 'flex', p: 0.5 }}>
      <IconButton onClick={onClose} aria-label={sheet ? '목록으로' : '닫기'}>
        {sheet ? <ChevronLeftIcon aria-hidden="true" /> : <XIcon aria-hidden="true" />}
      </IconButton>
    </Box>
  )}
  ```
  `DetailPane` 문서 주석의 `column` 설명을 "넓은 화면의 오른쪽 칸(항상 있고, 고른 장소가 없으면 안내만 보인다. 열려 있으면 닫기가 있다)"로.
- `origin` 상태를 atom으로:
  ```tsx
  // 장소를 열기 전에 보던 화면(목록/지도). 좁은 화면에서는 시트 뒤에 깔 화면, 모든 폭에서 닫을 때 돌아갈 곳이다.
  const [origin, setOrigin] = useAtom(detailOriginAtom);
  const viewOrigin = isMap ? 'map' : 'list';
  useLayoutEffect(() => {
    if (placeId === null && isLibraryView) setOrigin(viewOrigin);
  }, [placeId, isLibraryView, viewOrigin, setOrigin]);
  const sheetOnMap = placeId !== null && origin === 'map';
  ```
  (기존 `useState` + 렌더 중 `setOrigin` 줄을 이것으로 바꾼다.)
- 기존 `closeDetail` 함수를 지우고:
  ```tsx
  const closeDetail = useCloseDetail();
  // Esc로 닫기. 추가 칸·핀 모드는 자기 Esc가 있다.
  useEscapeClose(isLibraryView && placeId !== null && !adding && !pinning, () => closeDetail());
  useFocusReturnOnClose(placeId);
  ```
- `DetailPane`의 `onClose={closeDetail}` 두 곳 → `onClose={() => closeDetail()}`.

- [ ] **Step 4: 통과·회귀**

Run: `yarn vitest run tests/unit/sections/shell tests/unit/sections/map tests/unit/sections/place tests/unit/sections/add-place`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src tests
git commit -m "feat: 상세 닫기를 한곳으로 — 넓은 화면 X, 연 곳으로 돌아가기, Esc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 지도에서 선택 풀기 · 거르면 결과 전체에 맞추기

**Files:**
- Modify: `src/sections/map/LibraryMap.tsx`
- Test: `tests/unit/sections/map/library-map.test.tsx`

**Interfaces:**
- Consumes: `useCloseDetail` (Task 5), `MapView` `onMapClick` (Task 4), `MapMarker.fit?: false` (기존)

- [ ] **Step 1: 실패하는 시험**

`library-map.test.tsx`의 `describe('library map')`에서 `re-focuses the open place when the filter changes`를 지우고 아래로 바꾼다.

```tsx
  it('고른 마커를 다시 누르면 선택이 풀린다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await user.click(marker(2)!);
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
    await waitFor(() => expect(marker(2)).toHaveAttribute('aria-pressed', 'true'));

    await user.click(marker(2)!);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(marker(2)).not.toHaveAttribute('aria-pressed'));
  });

  it('지도 빈 곳을 누르면 선택이 풀리고 카메라는 그대로다', async () => {
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await router.navigate(`/place/${id(2)}`);
    await waitFor(() => expectFocusedOn([128.95, 37.77]));
    const camera = fakeAdapter().getCamera();

    fireEvent.click(fakeMap());

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(fakeAdapter().getCamera()).toEqual(camera);
  });

  it('장소가 안 열렸을 때 빈 곳을 눌러도 아무 일 없다', async () => {
    const { router } = await renderLibrary(sampleLibrary(), { path: '/map' });
    await ready();
    fireEvent.click(fakeMap());
    expect(router.state.location.pathname).toBe('/map');
  });

  it('거르기로 열린 장소가 결과에서 빠지면 선택을 풀고, 결과 전체에 맞춘다', async () => {
    const user = userEvent.setup();
    // 샘플 장소는 좌표가 모두 같다. 속초 횟집만 속초로 옮겨 맞추기 점을 가른다.
    const library = sampleLibrary();
    library.places[id(3)] = { ...library.places[id(3)]!, lng: 128.59, lat: 38.2 };
    const { router } = await renderLibrary(library, { prefs: { libraryView: 'list' } });
    await ready();
    await router.navigate(`/place/${id(3)}`); // 속초 횟집(맛집·바다뷰)
    await waitFor(() => expect(marker(3)).toHaveAttribute('aria-pressed', 'true'));
    const fits = fakeAdapter().fitCalls.length;

    await user.click(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name: /^카페/ }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    // 강제로 보이던 열린 장소(`fit: false`)는 맞추기 점에 들지 않는다.
    expect(fakeAdapter().fitCalls.at(-1)).toEqual([[128.95, 37.77]]);
    expect(shownMarkers()).toEqual([id(2)]);
    // 거르기 한 번에 기록이 둘 쌓이지 않는다(교체).
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('열린 장소가 결과 안에 남으면 선택은 그대로이고 그 장소로 확대하지 않는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await ready();
    await router.navigate(`/place/${id(3)}`);
    await waitFor(() => expect(fakeAdapter().getCamera()?.zoom).toBe(16));
    const panned = { center: [127, 36] as [number, number], zoom: 9 };
    fakeAdapter().setCamera(panned);
    const fits = fakeAdapter().fitCalls.length;

    await user.type(screen.getByRole('searchbox', { name: '장소 검색' }), '횟집');

    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(fits));
    expect(router.state.location.pathname).toBe(`/place/${id(3)}`);
    expect(marker(3)).toHaveAttribute('aria-pressed', 'true');
    // 가짜 fitBounds는 카메라를 옮기지 않는다: 열린 장소로 다시 모으지 않았다.
    expect(fakeAdapter().getCamera()).toEqual(panned);
  });
```

(`keeps the selected place on the map even when the filter hides it`는 그대로 통과해야 한다: 주소로 연 것은 거르기 변화가 아니다.)

- [ ] **Step 2: 실패 확인**

Run: `yarn vitest run tests/unit/sections/map/library-map.test.tsx`
Expected: 새 시험 FAIL(다시 눌러도 그대로, 빈 곳 무시, 거르면 열린 장소로 확대).

- [ ] **Step 3: 구현**

`LibraryMap.tsx`:
- import: `useEffect`, `useRef`(react), `useCloseDetail`(`src/sections/shell/use-close-detail`).
- `const closeDetail = useCloseDetail();` (`navigate` 근처).
- 강제로 넣는 열린 장소 마커를 맞추기에서 뺀다:
  ```tsx
    const [hidden] = toMarkers([open], library.labels, tokens, placeId);
    // 맞추기에서는 뺀다: 지도는 거르기 결과에 맞춘다(스펙 A1 §4). 마커는 보인다.
    return [...shown, { ...hidden!, fit: false as const }];
  ```
- `seenQueryKey` 블록(“필터(근처 말고 `query`)가 바뀌면 … 다시 모은다”)을 지우고:
  ```tsx
  // 거르기(`query`)가 바뀌면 지도는 `fitKey`로 결과 전체에 맞춘다(스펙 A1 §4). 열린 장소가 새 결과에서 빠지면
  // 선택을 푼다(기록은 교체). 결과 안이면 선택·강조는 그대로 두고 그 장소로 확대하지 않는다. 근처 쪽 변화
  // (켜기·반경·새 위치)는 `query`가 아니라 풀지 않는다(기존 규칙: 열린 장소는 반경 밖이어도 보인다).
  const queryKey = JSON.stringify(query);
  const seenQueryKey = useRef(queryKey);
  useEffect(() => {
    if (seenQueryKey.current === queryKey) return;
    seenQueryKey.current = queryKey;
    if (placeId !== null && !places.some((p) => p.id === placeId)) closeDetail({ replace: true });
  }, [queryKey, placeId, places, closeDetail]);
  ```
- `onMarkerClick`:
  ```tsx
  const onMarkerClick = useCallback(
    (id: string) => {
      if (id === CANDIDATE_MARKER_ID) return; // 아직 보관함에 없는 후보다.
      if (pinning) return; // 핀 모드에서는 위치만 고른다.
      // 고른 마커를 다시 누르면 선택을 푼다(스펙 A1 §3.2).
      if (id === placeId) {
        closeDetail();
        return;
      }
      setFromMarker(id);
      requestListScroll((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
      void navigate(paths.place(id));
    },
    [navigate, requestListScroll, pinning, placeId, closeDetail],
  );
  ```
- 지도 빈 곳:
  ```tsx
  // 지도 빈 곳을 누르면 선택을 푼다. 핀 모드(조준점 조작)와 추가 칸이 열려 있을 때는 그쪽 몫이다.
  const adding = showsAddPanel(flow);
  const onMapClick = useCallback(() => {
    if (pinning || adding || placeId === null) return;
    closeDetail();
  }, [pinning, adding, placeId, closeDetail]);
  ```
  `<MapView … onMapClick={onMapClick} />`.
- 컴포넌트 문서 주석 갱신: "마커를 누르면 그 장소의 상세로 가고 … 고른 마커를 다시 누르거나 지도 빈 곳을 누르면 선택을 푼다", "거르기가 바뀌면 결과 전체에 맞추고, 열린 장소가 결과 밖이면 선택을 푼다".

- [ ] **Step 4: 통과·회귀**

Run: `yarn vitest run tests/unit/sections/map tests/unit/sections/library tests/unit/sections/shell tests/unit/sections/add-place`
Expected: PASS. 근처 모드 시험들(`library map 근처 모드의 지도 맞추기`)이 그대로 통과해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add src/sections/map/LibraryMap.tsx tests/unit/sections/map/library-map.test.tsx
git commit -m "feat: 마커 다시 누르기·빈 곳으로 선택 풀기, 거르면 결과 전체에 맞추기

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 닫으면 목록 칸을 열기 전 스크롤 자리로

**Files:**
- Create: `src/sections/library/use-list-scroll-restore.ts`
- Modify: `src/sections/library/LibraryPage.tsx`
- Test: `tests/unit/sections/library/page.test.tsx`(추가)

**Interfaces:**
- Consumes: `focusPlaceAtom`(기존), `useCloseDetail`의 닫기(Task 5)
- Produces: `useListScrollRestore(scrollElement: HTMLElement | null, openId: string | null, queryKey: string): void`

- [ ] **Step 1: 실패하는 시험**

`tests/unit/sections/library/page.test.tsx`에 추가(파일 위 import에 `fireEvent`, `waitFor`, `within`, `focusPlaceAtom`, `installMapResources` 등이 없으면 더한다. 지도 칸이 함께 그려지므로 `VITE_MAP_ADAPTER=fake`와 `installMapResources`가 필요하면 `library-map.test.tsx`의 beforeEach/afterEach를 따른다):

```tsx
describe('닫으면 목록 스크롤 되돌리기', () => {
  /** 목록을 감싼 가장 가까운 스크롤 칸. */
  const scroller = () => {
    let el: HTMLElement | null = screen.getByRole('list', { name: '장소 목록' });
    while (el !== null && getComputedStyle(el).overflow !== 'auto') el = el.parentElement;
    return el!;
  };
  const id = (n: number) => `place${String(n).padStart(5, '0')}`;

  it('마커로 열어 목록이 움직였어도 닫으면 열기 전 자리로 돌아간다', async () => {
    const user = userEvent.setup();
    const { router, store } = await renderLibrary(sampleLibrary(), {
      prefs: { libraryView: 'bento' },
    });
    const box = scroller();
    box.scrollTop = 120;
    fireEvent.scroll(box);
    // 마커를 누르면 목록 스크롤 요청이 먼저 오고 목록이 그 행으로 움직인다(여기서는 흉내).
    act(() => store.set(focusPlaceAtom, { id: id(3), seq: 99 }));
    box.scrollTop = 400;
    fireEvent.scroll(box);
    await router.navigate(`/place/${id(3)}`);

    await user.click(
      await within(screen.getByRole('region', { name: '장소 상세' })).findByRole('button', {
        name: '닫기',
      }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(box.scrollTop).toBe(120);
  });

  it('열린 사이 거르기가 바뀌면 되돌리지 않는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    const box = scroller();
    box.scrollTop = 120;
    fireEvent.scroll(box);
    await router.navigate(`/place/${id(3)}`);
    await user.type(screen.getByRole('searchbox', { name: '장소 검색' }), '횟집');
    box.scrollTop = 30;
    fireEvent.scroll(box);

    await user.click(
      within(screen.getByRole('region', { name: '장소 상세' })).getByRole('button', {
        name: '닫기',
      }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(box.scrollTop).toBe(30);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `yarn vitest run tests/unit/sections/library/page.test.tsx`
Expected: FAIL — 닫은 뒤 `scrollTop`이 400.

- [ ] **Step 3: 구현**

`src/sections/library/use-list-scroll-restore.ts`:

```ts
import { useAtomValue } from 'jotai';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { focusPlaceAtom } from 'src/stores/library-ui';

/**
 * 장소를 닫으면 목록 칸을 열기 전 스크롤 자리로 되돌린다(스펙 A1 §3.3). 벤토·타일 보기면 라벨 블록이 다시 보인다.
 * - 장소가 열려 있지 않을 때의 스크롤 자리를 기억한다.
 * - 행으로 스크롤하라는 요청(`focusPlaceAtom`)이 오면 그 자리를 굳힌다. 마커를 누르면 그 요청이 경로 전환보다
 *   먼저 그려져, 장소가 열리기 전에 목록이 움직일 수 있다. 스크롤 이벤트는 다음 프레임에 오므로 레이아웃 효과에서
 *   먼저 굳힌다.
 * - 닫히면(어느 수단이든, 뒤로가기 포함) 굳힌 자리로 돌린다. 연 사이 거르기가 바뀌었으면 돌리지 않는다.
 */
export function useListScrollRestore(
  scrollElement: HTMLElement | null,
  openId: string | null,
  queryKey: string,
): void {
  const focus = useAtomValue(focusPlaceAtom);
  const saved = useRef({ top: 0, queryKey });
  const frozen = useRef(openId !== null);
  const latestKey = useRef(queryKey);
  const prevOpen = useRef(openId);
  const prevSeq = useRef(focus?.seq ?? null);

  useLayoutEffect(() => {
    latestKey.current = queryKey;
  });

  // 장소를 열 때(행 스크롤 요청 또는 열림) 지금 자리를 굳히고, 그때의 거르기를 적어 둔다.
  useLayoutEffect(() => {
    const seq = focus?.seq ?? null;
    const requested = seq !== prevSeq.current;
    prevSeq.current = seq;
    if ((requested || openId !== null) && !frozen.current) {
      frozen.current = true;
      saved.current = { ...saved.current, queryKey: latestKey.current };
    }
  }, [focus, openId]);

  useEffect(() => {
    if (scrollElement === null) return;
    const onScroll = () => {
      if (!frozen.current) saved.current = { top: scrollElement.scrollTop, queryKey: latestKey.current };
    };
    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollElement.removeEventListener('scroll', onScroll);
  }, [scrollElement]);

  // 닫히면 굳힌 자리로 돌린다.
  useLayoutEffect(() => {
    const prev = prevOpen.current;
    prevOpen.current = openId;
    if (prev === null || openId !== null) return;
    frozen.current = false;
    if (scrollElement !== null && saved.current.queryKey === queryKey) {
      scrollElement.scrollTop = saved.current.top;
    }
  }, [openId, scrollElement, queryKey]);
}
```

`LibraryPage.tsx`: `scrollElement`·`openId`·`query` 선언 뒤에

```tsx
  // 장소를 닫으면 목록을 열기 전 자리로 되돌린다.
  useListScrollRestore(scrollElement, openId, JSON.stringify(query));
```

와 import `import { useListScrollRestore } from 'src/sections/library/use-list-scroll-restore';`.

- [ ] **Step 4: 통과·회귀**

Run: `yarn vitest run tests/unit/sections/library tests/unit/sections/map tests/unit/sections/shell`
Expected: PASS (`marker click scrolls a virtualized list to the row` 포함).

- [ ] **Step 5: 커밋**

```bash
git add src/sections/library tests/unit/sections/library
git commit -m "feat: 상세를 닫으면 목록을 열기 전 스크롤 자리로

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: E2E · 전체 확인

**Files:**
- Modify: `tests/e2e/library.spec.ts`

- [ ] **Step 1: E2E 시험 추가**

`test.describe('데스크톱 3단', …)` 안에:

```ts
  test('@smoke 마커 다시 누르기·빈 곳·Esc·X로 선택을 풀고, 거르면 결과 밖 장소가 닫힌다', async ({
    page,
  }) => {
    await seedStorage(page, { prefs: { libraryView: 'list' } });
    await page.goto('/');
    const detail = page.getByRole('region', { name: '장소 상세' });
    const id = placeIdByName('경포대');
    const marker = page.getByTestId(`marker-${id}`);

    // 다시 누르기
    await marker.click();
    await expect(page).toHaveURL(new RegExp(`/place/${id}$`));
    await marker.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(detail).toContainText('장소를 고르면 여기에 보여요');

    // 지도 빈 곳(마커가 없는 오른쪽 아래)
    await marker.click();
    const map = page.getByTestId('fake-map');
    const box = (await map.boundingBox())!;
    await page.mouse.click(box.x + box.width - 10, box.y + box.height - 10);
    await expect(page).toHaveURL(/\/$/);

    // Esc
    await marker.click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/$/);

    // X
    await marker.click();
    await detail.getByRole('button', { name: '닫기' }).click();
    await expect(page).toHaveURL(/\/$/);

    // 결과 밖이면 닫힘: 경포대를 연 채 경포대가 없는 라벨로 거른다.
    await marker.click();
    const chips = page.getByRole('group', { name: '라벨' });
    // 시드에서 경포대의 라벨은 바다·산책이다. 카페로 거르면 결과 밖이다.
    await chips.getByRole('button', { name: /^카페/ }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('중간 화면: 지도에서 연 장소의 X는 /map으로', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await seedStorage(page, { prefs: { libraryView: 'list' } });
    await page.goto('/map');
    const id = placeIdByName('경포대');
    await page.getByTestId(`marker-${id}`).click();
    await page.getByRole('region', { name: '장소 상세' }).getByRole('button', { name: '닫기' }).click();
    await expect(page).toHaveURL(/\/map$/);
  });
```

휴대폰 프로젝트(`@mobile`)에는 칩 줄 확인을 더한다:

```ts
test('휴대폰: 라벨 관리가 칩 줄 맨 앞에 보인다', { tag: '@mobile' }, async ({ page }) => {
  await seedStorage(page, { prefs: { libraryView: 'list' } });
  await page.goto('/');
  const link = page.getByRole('link', { name: '라벨 관리' });
  await expect(link).toBeInViewport();
});
```
(태그 관례는 파일의 기존 `@mobile` 시험을 따른다.)

- [ ] **Step 2: E2E 실행**

Run: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH" && E2E_PORT=5175 yarn test:e2e tests/e2e/library.spec.ts`
Expected: PASS(세 프로젝트). 5175가 쓰이고 있으면 `E2E_PORT=5176`.

- [ ] **Step 3: 전체 확인**

Run:
```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
yarn lint && yarn fm:check && yarn build:ci
grep -rnP '[\x{2028}\x{2029}]' src functions tests
grep -rn "dangerouslySetInnerHTML" src
```
Expected: 모두 통과, 첫 로딩 ≤ 327,680, 두 grep은 출력 없음.

- [ ] **Step 4: 커밋**

```bash
git add tests/e2e
git commit -m "test: 선택 풀기·거르기·라벨 관리 위치 E2E

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 실행 뒤(컨트롤러 몫)

- 브라우저 확인: 사용자 백업을 `.superpowers/inspect/backup.json`(git 무시)에 복사하고 포트 8788 실제 네이버 지도로 넓은(1440)·중간(1024)·휴대폰(375)에서 스펙 §1의 재현(인제 `고향집` → `서울 카페&베이커리`, 다시 누르기·빈 곳·Esc·X, 긴 라벨 툴팁, 칩 줄 맨 앞 `라벨 관리`)을 확인한다. **네이버 지도에서 마커 클릭이 지도 `click`으로도 오는지**(Task 4의 `fromMarker` 거르기)를 꼭 본다. 끝나면 복사본을 지운다.
- PR(`feat/selection-filter-tooltip` → `main`), ccd_pr로 묶기, CI 확인.
