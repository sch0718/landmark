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

/** 가장 가까운 스크롤 조상(세로로 넘치면 스크롤하도록 둔 칸). 없으면 `null`(창이 스크롤한다). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/auto|scroll|overlay/.test(`${style.overflowY} ${style.overflow}`)) return node;
  }
  return null;
}

/** 요소가 스크롤 칸(없으면 창)의 보이는 영역에 조금이라도 걸쳐 있는가. 높이가 없는(숨은) 요소는 아니다. */
function isInScrollView(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const parent = scrollParent(el);
  const view = parent?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  return rect.height > 0 && rect.bottom > view.top && rect.top < view.bottom;
}

/**
 * 상세가 닫혀 포커스가 갈 곳을 잃으면(닫기 단추·상세 안에 있었음) 연 장소의 목록 행이 화면에 있을 때 그 행으로,
 * 아니면 본문으로 옮긴다(스펙 A1 §3.2). 화면은 스크롤하지 않는다. 목록 스크롤 복원(레이아웃 효과)이 먼저 열기 전
 * 자리로 되돌리므로, 마커로 연 행은 칸 밖일 수 있다 — 그 행에 포커스하면 가상 목록이 곧 행을 내려 포커스가
 * `body`로 빠진다.
 */
export function useFocusReturnOnClose(placeId: string | null): void {
  const previous = useRef(placeId);
  useEffect(() => {
    const closed = previous.current;
    previous.current = placeId;
    if (closed === null || placeId !== null || !focusIsLost()) return;
    const row = document.querySelector<HTMLElement>(`[data-place-id="${CSS.escape(closed)}"]`);
    const target = row !== null && isInScrollView(row) ? row : document.getElementById(MAIN_ID);
    target?.focus({ preventScroll: true });
  }, [placeId]);
}
