export type MarkerLabelOptions = {
  dimmed?: boolean;
  selected?: boolean;
  textColor?: string;
  borderColor?: string;
};

const MAX_WIDTH = 160;

/** 마커 라벨 DOM. 데이터는 `textContent`·`title`로만 넣는다(innerHTML 금지). */
export function createMarkerLabelElement(
  label: string,
  color: string,
  opts: MarkerLabelOptions = {},
): HTMLElement {
  const el = document.createElement('span');
  el.textContent = label;
  if (label !== '') el.title = label;
  const border = opts.selected
    ? `3px solid ${opts.borderColor ?? '#000'}`
    : `2px solid ${opts.borderColor ?? '#fff'}`;
  el.style.cssText = [
    `background:${color}`,
    'display:inline-block',
    'box-sizing:border-box',
    `max-width:${MAX_WIDTH}px`,
    'overflow:hidden',
    'text-overflow:ellipsis',
    'vertical-align:top',
    // 어댑터가 왼쪽 위 모서리를 좌표에 두므로, 가운데가 좌표에 오게 자기 크기의 절반만큼 옮긴다.
    'transform:translate(-50%, -50%)',
    `color:${opts.textColor ?? '#fff'}`,
    'border-radius:12px',
    'padding:2px 8px',
    `font-size:${opts.selected ? 13 : 12}px`,
    'font-weight:700',
    'white-space:nowrap',
    'box-shadow:0 1px 3px rgba(0,0,0,.4)',
    `opacity:${opts.dimmed ? 0.5 : 1}`,
    `border:${border}`,
  ].join(';');
  return el;
}
