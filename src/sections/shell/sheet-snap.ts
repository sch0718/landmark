import { useSyncExternalStore } from 'react';

/** 휴대폰 상세 시트의 단계(스펙 §4.1). 닫힘은 시트가 없는 것이라 단계에 넣지 않는다. */
export type SheetSnap = 'half' | 'full';
/** 손을 뗀 뒤 갈 곳. `'closed'`면 시트를 닫는다(선택 해제). */
export type SnapTarget = SheetSnap | 'closed';

/** 반쯤 높이의 상한(px). 이름·주소·분류·`네이버 지도에서 열기`·다녀옴까지 보이는 높이다. */
export const SHEET_HALF_MAX = 320;
/** 창이 낮으면 반쯤 높이를 창 높이의 이 비율로 줄인다. */
export const SHEET_HALF_RATIO = 0.45;
/** 이만큼(px) 움직여야 끌기로 본다. 그 전에 떼면 보통 누르기다. */
export const DRAG_SLOP_PX = 8;
/** 이보다 빠르면(px/ms) 놓인 자리와 상관없이 튕긴 방향의 다음 단계로 간다. */
export const FLICK_VELOCITY = 0.5;

export function sheetHalfPx(viewportHeight: number): number {
  return Math.min(SHEET_HALF_MAX, Math.round(viewportHeight * SHEET_HALF_RATIO));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

/** 지금 창 높이에서의 반쯤 높이. 시트와 지도 여백이 같은 값을 쓴다. */
export function useSheetHalfPx(): number {
  const height = useSyncExternalStore(subscribe, () => window.innerHeight);
  return sheetHalfPx(height);
}

/**
 * 손을 뗀 뒤의 단계(스펙 §4.2). `offsetPx`는 끌기 시작점에서 아래로 간 거리(위로 끌면 음수), `velocity`는 마지막
 * 움직임의 빠르기(px/ms, 아래가 양수)다. 튕기면 그 방향의 다음 단계로, 아니면 보이는 높이가 가장 가까운 단계로 간다.
 * 다 펼침에서 한 번 끌어 바로 닫히지는 않는다(반쯤에서 멈춘다).
 */
export function resolveSnap({
  from,
  offsetPx,
  velocity,
  halfPx,
  fullPx,
}: {
  from: SheetSnap;
  offsetPx: number;
  velocity: number;
  halfPx: number;
  fullPx: number;
}): SnapTarget {
  if (velocity < -FLICK_VELOCITY) return 'full';
  if (velocity > FLICK_VELOCITY) return from === 'full' ? 'half' : 'closed';
  const visible = (from === 'full' ? fullPx : halfPx) - offsetPx;
  const stops: [SnapTarget, number][] = [
    ['closed', 0],
    ['half', halfPx],
    ['full', fullPx],
  ];
  let best = stops[0]!;
  for (const stop of stops) {
    if (Math.abs(visible - stop[1]) < Math.abs(visible - best[1])) best = stop;
  }
  if (from === 'full' && best[0] === 'closed') return 'half';
  return best[0];
}
