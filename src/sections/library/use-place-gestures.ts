import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/** 길게 누르기로 인정하는 시간. */
export const LONG_PRESS_MS = 500;
/** 누른 채 이만큼(px) 움직이면 스크롤·드래그로 보고 길게 누르기를 취소한다. */
const MOVE_TOLERANCE = 10;

type Options = {
  id: string;
  /** 이미 선택 모드인가(선택된 장소가 하나라도 있음). */
  selecting: boolean;
  onOpen(id: string): void;
  onToggle(id: string): void;
};

/**
 * 장소 한 칸의 누르기 동작.
 * - Shift/Cmd/Ctrl+클릭, 또는 길게 누르기(500ms)는 선택을 바꾼다.
 * - 선택 모드에서는 일반 클릭도 선택을 바꾼다. 그 밖의 클릭은 장소를 연다.
 * - 길게 눌러 선택한 뒤 이어지는 클릭(손을 뗄 때)은 무시한다.
 */
export function usePlaceGestures({ id, selecting, onOpen, onToggle }: Options) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const latest = useRef({ id, onToggle });
  useEffect(() => {
    latest.current = { id, onToggle };
  });

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      cancel();
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        latest.current.onToggle(latest.current.id);
      }, LONG_PRESS_MS);
    },
    [cancel],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const from = start.current;
      if (from === null || timer.current === null) return;
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > MOVE_TOLERANCE) cancel();
    },
    [cancel],
  );

  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (fired.current) {
        fired.current = false;
        event.preventDefault();
        return;
      }
      if (selecting || event.shiftKey || event.metaKey || event.ctrlKey) onToggle(id);
      else onOpen(id);
    },
    [id, selecting, onOpen, onToggle],
  );

  return {
    onClick,
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // 터치 기기는 길게 누르면 컨텍스트 메뉴를 띄운다. 선택 동작과 겹치지 않게 막는다.
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (timer.current !== null || fired.current) event.preventDefault();
    },
  };
}
