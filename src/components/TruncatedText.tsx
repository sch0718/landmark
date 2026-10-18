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
  const [open, setOpen] = useState(false);

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

  // 툴팁이 열려 있으면 Esc는 툴팁만 닫는다(WCAG 1.4.13). 문서 capture 단계에서 먼저 받아 `preventDefault`로
  // 처리했다고 표시하므로, 문서 bubble 단계의 상세 닫기 Esc(`useEscapeClose`)는 이 Esc를 무시한다.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

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
        data-truncated-text={lines}
        data-part={part}
        sx={[clampSx(lines), ...(Array.isArray(sx) ? sx : [sx])]}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
