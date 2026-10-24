// README·도움말의 움직이는 그림(애니메이션 SVG)이 함께 쓰는 그리기 도구.
// GitHub는 SVG를 <img>로 보여 주므로 스크립트·웹 글꼴 없이 CSS 애니메이션만 쓴다.

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 장면 `scene`(0부터)이 시작하고 `offset`초 뒤에 움직임을 시작한다. */
export const at =
  (sceneLength) =>
  (scene, offset = 0) =>
    `animation-delay:${(scene * sceneLength + offset).toFixed(2)}s`;

export function text(
  x,
  y,
  value,
  { size = 14, weight = 400, fill, anchor = 'start', cls = '', style = '' } = {},
) {
  const extra = `${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}`;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}>${esc(value)}</text>`;
}

/** 글자 폭 근사(한글 1em, 이모지 1.2em, 그 밖 0.6em). */
export function textWidth(label, size) {
  let w = 0;
  for (const ch of label) {
    if (/\p{Extended_Pictographic}/u.test(ch)) w += size * 1.2;
    else if (/[\u3131-\uD79D]/u.test(ch)) w += size;
    else if (ch !== '\uFE0F') w += size * 0.6;
  }
  return Math.round(w);
}

/** 라벨 칩. `tone`은 라벨 색 토큰(`fill`·`text`). */
export function chip(x, y, label, tone, { size = 13, h = 26, stroke } = {}) {
  const w = textWidth(label, size) + 20;
  return {
    w,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${tone.fill}"${stroke ? ` stroke="${stroke}"` : ''}/>${text(x + 10, y + h / 2 + size * 0.35, label, { size, weight: 700, fill: tone.text })}`,
  };
}

export function chipRow(x, y, items, { gap = 6, size = 13, h = 26 } = {}) {
  let cx = x;
  return items
    .map(([label, tone]) => {
      const c = chip(cx, y, label, tone, { size, h, stroke: tone.stroke });
      cx += c.w + gap;
      return c.svg;
    })
    .join('');
}

let mapCount = 0;
/** 지도 바탕: 땅·물·길. */
export function mapBase(x, y, w, h, t, dark, { rx = 14 } = {}) {
  const id = `map${mapCount++}`;
  const land = dark ? '#1F2A22' : '#EEF3E6';
  const water = dark ? '#16303F' : '#D7EAF6';
  const road = dark ? '#3A4A40' : '#FFFFFF';
  return `<g><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/></clipPath>
<g clip-path="url(#${id})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${land}"/>
<path d="M${x + w * 0.72} ${y} C${x + w * 0.66} ${y + h * 0.4} ${x + w * 0.9} ${y + h * 0.6} ${x + w * 0.8} ${y + h} L${x + w} ${y + h} L${x + w} ${y} Z" fill="${water}"/>
<path d="M${x} ${y + h * 0.35} L${x + w} ${y + h * 0.55} M${x + w * 0.3} ${y} L${x + w * 0.42} ${y + h} M${x} ${y + h * 0.8} L${x + w * 0.7} ${y + h * 0.7}" stroke="${road}" stroke-width="6" fill="none" stroke-linecap="round"/>
</g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="${t.border}"/></g>`;
}

export function pin(x, y, color, { label, r = 9, cls = 'pop', style = '', fg = '#FFFFFF' } = {}) {
  return `<g${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}><circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="#FFFFFF" stroke-width="2.5"/>${
    label ? text(x, y + 4.5, label, { size: 12, weight: 800, fill: fg, anchor: 'middle' }) : ''
  }</g>`;
}

export function card(x, y, w, h, t, { rx = 12, fill } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill ?? t.bg.raised}" stroke="${t.border}"/>`;
}

/** 단추. `variant`: 'filled'(강조 바탕) · 'outlined' · 'text'. */
export function button(x, y, w, label, t, { variant = 'filled', h = 34, size = 13 } = {}) {
  const cx = x + w / 2;
  const ty = y + h / 2 + size * 0.36;
  if (variant === 'filled')
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.accent.main}"/>${text(cx, ty, label, { size, weight: 800, fill: t.accent.contrast, anchor: 'middle' })}`;
  if (variant === 'outlined')
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="none" stroke="${t.borderStrong}"/>${text(cx, ty, label, { size, weight: 700, fill: t.text.primary, anchor: 'middle' })}`;
  return text(cx, ty, label, { size, weight: 800, fill: t.accent.text, anchor: 'middle' });
}

/** 누르는 곳을 알리는 동그라미. 장면이 시작하고 `offset`초 뒤에 퍼진다. */
export function tap(x, y, t, style) {
  return `<circle class="tap" style="${style}" cx="${x}" cy="${y}" r="16" fill="${t.text.primary}" fill-opacity=".28" stroke="${t.text.primary}" stroke-opacity=".5" stroke-width="2"/>`;
}

/**
 * 애니메이션 CSS. 장면 길이 `sceneLength`초, 장면 수 `scenes`. 각 장면의 요소는 `at(scene, offset)`으로 늦춘다.
 * 모든 움직임은 한 바퀴(`cycle`) 동안 한 번 일어나고, 장면 그룹(`.sc`)이 자기 차례에만 보인다.
 */
export function motionCss({ sceneLength, scenes, font }) {
  const cycle = sceneLength * scenes;
  const p = (s) => `${((s / cycle) * 100).toFixed(3)}%`;
  return `
text{font-family:${font}}
.sc{opacity:0;animation:scene ${cycle}s linear infinite backwards}
.rise{transform-box:fill-box;animation:rise ${cycle}s cubic-bezier(.2,.8,.2,1) infinite backwards}
.pop{transform-box:fill-box;transform-origin:center;animation:pop ${cycle}s ease-out infinite backwards}
.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw ${cycle}s ease-out infinite backwards}
.slide{transform-box:fill-box;animation:slide ${cycle}s cubic-bezier(.2,.8,.2,1) infinite backwards}
.pulse{transform-box:fill-box;transform-origin:center;opacity:0;animation:pulse ${cycle}s ease-out infinite backwards}
.tap{transform-box:fill-box;transform-origin:center;opacity:0;animation:tap ${cycle}s ease-out infinite backwards}
@keyframes scene{0%{opacity:0}${p(0.35)}{opacity:1}${p(sceneLength - 0.35)}{opacity:1}${p(sceneLength)}{opacity:0}100%{opacity:0}}
@keyframes rise{0%{opacity:0;transform:translateY(14px)}${p(0.45)}{opacity:1;transform:none}100%{opacity:1;transform:none}}
@keyframes pop{0%{transform:scale(0)}${p(0.3)}{transform:scale(1.15)}${p(0.45)}{transform:scale(1)}100%{transform:scale(1)}}
@keyframes draw{0%{stroke-dashoffset:1}${p(0.9)}{stroke-dashoffset:0}100%{stroke-dashoffset:0}}
@keyframes slide{0%{opacity:0;transform:translateX(-120px)}${p(0.6)}{opacity:1;transform:none}100%{opacity:1;transform:none}}
@keyframes pulse{0%{opacity:.7;transform:scale(1)}${p(0.9)}{opacity:0;transform:scale(2.4)}100%{opacity:0;transform:scale(2.4)}}
@keyframes tap{0%{opacity:0;transform:scale(.4)}${p(0.12)}{opacity:1;transform:scale(1)}${p(0.7)}{opacity:0;transform:scale(1.9)}100%{opacity:0;transform:scale(1.9)}}
@media (prefers-reduced-motion:reduce){
*{animation:none!important}
.s0{opacity:1}
.rise,.slide{opacity:1;transform:none}
.pop{transform:none}
.draw{stroke-dashoffset:0}
}`;
}

export function svgDocument({ w, h, title, desc, css, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="motion-title motion-desc">
<title id="motion-title">${esc(title)}</title>
<desc id="motion-desc">${esc(desc)}</desc>
<style>${css}</style>
${body}
</svg>
`;
}
