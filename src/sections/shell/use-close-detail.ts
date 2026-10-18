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
