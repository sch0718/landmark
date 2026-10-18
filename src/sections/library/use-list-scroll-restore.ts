import { useAtomValue } from 'jotai';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { focusPlaceAtom } from 'src/stores/library-ui';

/** DOM 스크롤 자리를 옮긴다. 훅 인자인 요소를 효과 안에서 직접 쓰지 않으려 따로 둔다. */
function setScrollTop(el: HTMLElement, top: number): void {
  el.scrollTop = top;
}

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
      if (!frozen.current)
        saved.current = { top: scrollElement.scrollTop, queryKey: latestKey.current };
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
      setScrollTop(scrollElement, saved.current.top);
    }
  }, [openId, scrollElement, queryKey]);
}
