import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useEffect, useLayoutEffect, useRef, useState, type ElementType } from 'react';
import { createPortal } from 'react-dom';

/** 터치로 길게 눌러 툴팁을 여는 시간(ms). 목록 행의 길게 누르기(선택)와 같은 500ms다. */
export const TOOLTIP_TOUCH_DELAY_MS = 500;

/** 마우스를 올리고 툴팁을 열기까지(ms). */
const HOVER_DELAY_MS = 100;
/** 터치로 연 툴팁을 손을 뗀 뒤 닫기까지(ms). */
const TOUCH_LEAVE_MS = 1500;
/** 터치 뒤 브라우저가 흉내 내는 마우스 이벤트를 무시하는 시간(ms). */
const TOUCH_MOUSE_GUARD_MS = 1000;
/** 툴팁과 글자 사이, 툴팁과 화면 가장자리 사이(px). */
const GAP = 8;

/**
 * 툴팁 겉모양. MUI `Tooltip`은 Popper·전환을 끌고 와 운영 빌드(지도 키 포함)의 첫 로딩 예산을 넘겨서, 포털에
 * 고정 위치로 직접 그린다. 위치(`top`·`left`)는 그린 뒤 크기를 재서 정한다.
 */
const TIP_STYLE = {
  position: 'fixed',
  top: 0,
  left: 0,
  zIndex: 1500, // 대화상자(1300)보다 위. MUI tooltip과 같다.
  maxWidth: `min(320px, calc(100vw - ${GAP * 2}px))`,
  padding: '4px 8px',
  borderRadius: 4,
  background: 'var(--tm-text-primary)',
  color: 'var(--tm-bg-surface)',
  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
  fontSize: 12,
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
  whiteSpace: 'normal',
  pointerEvents: 'none',
} as const;

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

/**
 * 지금 열린 툴팁을 닫는 함수. 화면에 툴팁은 늘 하나만 둔다: 어떤 말줄임 글자가 툴팁을 열면 이전 것을 닫는다.
 * 같은 조작 요소 안의 포커스 툴팁과 마우스 오버 툴팁, 다른 행끼리의 툴팁이 겹치지 않는다.
 */
let closeOpenTip: (() => void) | null = null;

/** 말줄임 글자 요소 표시. 값은 줄 수다. 한 조작 요소 안의 여러 글자 중 툴팁을 띄울 하나를 고를 때 쓴다. */
const TEXT_ATTR = 'data-truncated-text';

/**
 * 조작 요소(`host`) 안에서 **잘린 첫 번째** 말줄임 글자(DOM 순서). 행 하나에 이름·칩·지역이 함께 있어도 키보드
 * 포커스 툴팁은 하나만 띄운다. 안쪽의 다른 조작 요소에 든 글자는 그쪽 몫이라 뺀다.
 */
function firstTruncatedIn(host: HTMLElement): HTMLElement | null {
  for (const el of host.querySelectorAll<HTMLElement>(`[${TEXT_ATTR}]`)) {
    if (el.closest(FOCUS_HOST) !== host) continue;
    if (isTruncated(el, Number(el.getAttribute(TEXT_ATTR)) || 1)) return el;
  }
  return null;
}

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
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // 마우스 오버·길게 누르기·터치 뒤 닫기 타이머(하나만 걸린다).
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 마지막 터치 시각. 터치 뒤 흉내 낸 마우스 오버로 열지 않는다.
  const touchedAt = useRef(-Infinity);
  // 툴팁을 둔 때의 글자 위치. 스크롤로 글자가 움직였는지 본다.
  const anchorAt = useRef<{ top: number; left: number } | null>(null);

  const clearTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const openIfTruncated = () => {
    if (ref.current !== null && isTruncated(ref.current, lines)) setOpen(true);
  };
  const close = () => {
    clearTimer();
    setOpen(false);
  };

  // 언마운트되면 걸린 타이머를 푼다.
  useEffect(() => () => clearTimeout(timer.current), []);

  // 감싼 조작 요소가 키보드 포커스를 받으면 연다. 글자 자체는 포커스를 받지 않는다. 같은 조작 요소 안에 말줄임
  // 글자가 여럿이면 잘린 첫 번째만 연다(툴팁이 겹쳐 뜨지 않게).
  useEffect(() => {
    watchModality();
    const el = ref.current;
    const host = el?.closest<HTMLElement>(FOCUS_HOST);
    if (!el || !host) return;
    const onFocus = () => {
      if (keyboardModality && firstTruncatedIn(host) === el) setOpen(true);
    };
    const onBlur = () => setOpen(false);
    host.addEventListener('focus', onFocus);
    host.addEventListener('blur', onBlur);
    return () => {
      host.removeEventListener('focus', onFocus);
      host.removeEventListener('blur', onBlur);
    };
  }, [lines]);

  // 그린 뒤 툴팁 크기를 재서 둔다: 글자 아래 8px(아래에 자리가 없으면 위), 가로는 글자 왼쪽에 맞추되 화면 안으로
  // 당긴다. 위치는 DOM에 직접 써서 다시 그리지 않는다.
  useLayoutEffect(() => {
    const el = ref.current;
    const tip = tipRef.current;
    if (!open || !el || !tip) return;
    const anchor = el.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const below = anchor.bottom + GAP;
    const above = anchor.top - GAP - size.height;
    const top = below + size.height > window.innerHeight - GAP && above >= GAP ? above : below;
    const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - GAP - size.width));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    anchorAt.current = { top: anchor.top, left: anchor.left };
  }, [open, children]);

  // 열려 있는 동안: Esc는 툴팁만 닫는다(WCAG 1.4.13). 이벤트 경로에서 가장 먼저 받는 문서 capture 단계에서 받아
  // 전파를 멈추므로 뒤의 처리기(React 루트의 MUI 대화상자 Esc 닫기, 문서 bubble 단계의 상세 닫기 `useEscapeClose`)는
  // 이 Esc를 받지 못한다. MUI 대화상자는 `defaultPrevented`를 보지 않아 `preventDefault`만으로는 막히지 않는다.
  // `preventDefault`는 처리했다는 표시로 함께 둔다. 고정 위치가 글자와 어긋나지
  // 않게 스크롤로 글자가 움직이거나 창 크기가 바뀌면 닫는다. 포커스가 끌어온 스크롤처럼 글자가 그 자리면 둔다.
  // 툴팁이 화면에 붙는 커밋과 함께 달도록 레이아웃 효과로 둔다(일반 효과면 그 사이에 온 스크롤·Esc를 놓친다).
  // 열 때 이전에 열린 다른 툴팁을 닫고 이 툴팁을 지금 열린 것으로 둔다.
  useLayoutEffect(() => {
    if (!open) return;
    const shut = () => {
      clearTimeout(timer.current);
      setOpen(false);
    };
    closeOpenTip?.();
    closeOpenTip = shut;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      shut();
    };
    const onScroll = () => {
      const was = anchorAt.current;
      const now = ref.current?.getBoundingClientRect();
      if (!was || !now || now.top !== was.top || now.left !== was.left) shut();
    };
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', shut);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', shut);
      if (closeOpenTip === shut) closeOpenTip = null;
    };
  }, [open]);

  return (
    <>
      <Box
        component={component}
        ref={ref}
        data-truncated-text={lines}
        data-part={part}
        sx={[clampSx(lines), ...(Array.isArray(sx) ? sx : [sx])]}
        onMouseEnter={() => {
          if (Date.now() - touchedAt.current < TOUCH_MOUSE_GUARD_MS) return;
          clearTimer();
          timer.current = setTimeout(openIfTruncated, HOVER_DELAY_MS);
        }}
        onMouseLeave={close}
        onTouchStart={() => {
          touchedAt.current = Date.now();
          if (!touch) return;
          clearTimer();
          timer.current = setTimeout(openIfTruncated, TOOLTIP_TOUCH_DELAY_MS);
        }}
        onTouchMove={touch ? clearTimer : undefined}
        // 브라우저가 스크롤로 터치를 넘겨받으면 `touchend` 없이 `touchcancel`만 와 닫기 타이머가 걸리지 않는다.
        // 스크롤에 글자가 안 움직이는 고정 헤더면 스크롤 닫기도 안 걸리니, 열린 툴팁도 여기서 닫는다.
        onTouchCancel={touch ? close : undefined}
        onTouchEnd={() => {
          touchedAt.current = Date.now();
          if (!touch) return;
          clearTimer();
          if (open) timer.current = setTimeout(() => setOpen(false), TOUCH_LEAVE_MS);
        }}
      >
        {children}
      </Box>
      {open &&
        createPortal(
          <div ref={tipRef} role="tooltip" style={TIP_STYLE}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
