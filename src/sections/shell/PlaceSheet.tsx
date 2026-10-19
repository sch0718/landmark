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

/** 글을 쓰지 않는 `input` 종류. 이 칸들의 Esc는 시트를 닫는다. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'radio',
  'reset',
  'submit',
  'image',
  'range',
  'color',
  'file',
]);

/** 글을 쓰는 칸(입력칸·메모·날짜 등)인가. 그 칸의 Esc는 칸의 몫이다(입력 취소·조합 취소). */
function isEditable(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

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
 * 부모는 `position: relative`이고 `overflow: clip`으로 넘치는 부분을 잘라야 한다(반쯤일 때 아래로 내려간 부분을
 * 자른다). `hidden`은 포커스 이동만으로도 스크롤될 수 있어 쓰지 않는다.
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
    // 보조 손가락은 무시한다. 새 주 포인터가 왔는데 다른 포인터의 끌기가 남아 있으면 그 포인터는 사라진 것이라 버린다.
    if (!event.isPrimary) return;
    if (drag.current?.active) setOffset(null);
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
    // 단추가 이미 떼어졌는데 `up`을 못 받은 것(시트 밖에서 뗌)이다. 끌기를 버린다.
    if (event.buttons === 0) {
      drag.current = null;
      if (d.active) setOffset(null);
      return;
    }
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
    // 포털(라벨 고르기 창 등)에서 올라온 포커스는 시트 안 요소가 아니라 잰 위치가 맞지 않는다.
    if (!root.contains(event.target)) return;
    if (headerRef.current?.contains(event.target)) return;
    const visibleBottom = root.getBoundingClientRect().top + halfPx;
    if (event.target.getBoundingClientRect().bottom > visibleBottom) onSnapChange('full');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 편집칸·라벨 고르기 창이 먼저 쓴 Esc는 시트를 닫지 않는다(포털 이벤트도 React 트리로 올라온다).
    // 글을 쓰는 칸에서 누른 Esc와 한글 조합 중의 Esc도 그 칸의 몫이다(스펙 §4.6).
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229 || isEditable(event.target)) return;
    event.preventDefault();
    onClose();
  };

  const base = snap === 'full' ? '0px' : `calc(100% - ${halfPx}px)`;
  const transform =
    offset === null ? `translateY(${base})` : `translateY(max(0px, calc(${base} + ${offset}px)))`;

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
        userSelect: offset === null ? undefined : 'none',
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
