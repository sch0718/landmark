export type MarkerLabelOptions = { dimmed?: boolean; selected?: boolean };

/** 마커 라벨 DOM. 데이터는 `textContent`로만 넣는다(innerHTML 금지). */
export function createMarkerLabelElement(
  label: string,
  color: string,
  opts: MarkerLabelOptions = {},
): HTMLElement {
  const el = document.createElement('span');
  el.textContent = label;
  el.style.cssText = [
    `background:${color}`,
    'display:inline-block',
    'color:#fff',
    'border-radius:12px',
    'padding:2px 8px',
    'font-size:12px',
    'font-weight:700',
    'white-space:nowrap',
    'box-shadow:0 1px 3px rgba(0,0,0,.4)',
    `opacity:${opts.dimmed ? 0.5 : 1}`,
    `border:${opts.selected ? '2px solid #000' : '2px solid #fff'}`,
  ].join(';');
  return el;
}
