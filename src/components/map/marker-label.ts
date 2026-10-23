export type MarkerLabelOptions = {
  shape?: 'dot';
  dimmed?: boolean;
  selected?: boolean;
  /** 다녀온 곳: 글자 앞에 `✓`, title 뒤에 ` · 다녀옴`. 색만으로 알리지 않는다. */
  visited?: boolean;
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
  if (opts.shape === 'dot') {
    el.setAttribute('data-shape', 'dot');
    el.title = label;
    el.setAttribute('aria-label', label);
    // 보이는 점은 12px, 누름 영역은 32px. 이름표보다 아래에 쌓아 이웃 이름표를 가리지 않는다.
    el.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'width:32px',
      'height:32px',
      'border-radius:50%',
      'vertical-align:top',
      'transform:translate(-50%, -50%)',
    ].join(';');
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText = [
      'box-sizing:border-box',
      'width:12px',
      'height:12px',
      'border-radius:50%',
      `background:${color}`,
      'border:2px solid #fff',
      'box-shadow:0 1px 3px rgba(0,0,0,.4)',
      `opacity:${opts.dimmed ? 0.5 : 1}`,
      ...(opts.selected ? ['outline:2px solid #000', 'outline-offset:2px'] : []),
    ].join(';');
    el.appendChild(dot);
    return el;
  }
  const visited = opts.visited === true && label !== '';
  el.textContent = visited ? `✓ ${label}` : label;
  if (label !== '') el.title = visited ? `${label} · 다녀옴` : label;
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
