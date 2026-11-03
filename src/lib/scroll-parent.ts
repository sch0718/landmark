/** 이 요소를 담은 스크롤 칸. 셸이 화면 사이에 칸을 재사용하므로 문서 스크롤만 보면 안 된다. */
export function scrollParent(element: HTMLElement): Element | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  // 브라우저 밖(시험 환경 등)에는 문서 스크롤 칸이 없을 수 있다.
  return document.scrollingElement ?? null;
}
