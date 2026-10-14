/**
 * 키보드 포커스 표시(스펙 §2). 모든 조작 요소가 같은 바깥선을 쓴다. 색은 바탕 위 대비가 나오는 강조색 글자색.
 * 마우스로 누를 때는 그리지 않도록 `:focus-visible`(MUI는 `.Mui-focusVisible`)에서만 쓴다.
 * `outline: 2px solid var(--tm-accent-text)`를 낱낱의 속성으로 쓴 것이다(값은 같다).
 * 테마(`createAppTheme`)가 전역 `:focus-visible`과 MUI `.Mui-focusVisible`에 건다. 자리마다 다시 쓰지 않는다
 * (보이는 모양이 안쪽 요소일 때만 — 칩 등 — 그 요소에 이 값을 건다).
 */
export const FOCUS_RING = {
  outlineWidth: 2,
  outlineStyle: 'solid',
  outlineColor: 'var(--tm-accent-text)',
  outlineOffset: 2,
} as const;

/**
 * 넘침을 자르는 칸(탭 줄·메뉴·스크롤 목록) 안의 요소는 바깥선이 잘리지 않게 안쪽으로 그린다.
 * 직접 만든 요소는 전역 규칙을 그대로 두고 `'&:focus-visible': { outlineOffset: -2 }`만 덧붙인다.
 */
export const FOCUS_RING_INSET = { ...FOCUS_RING, outlineOffset: -2 } as const;
