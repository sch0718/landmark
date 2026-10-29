// 랜드마크만 쓰는 그리기 도구, 기반 함수는 @sch0718/motion-kit에 있음
// GitHub는 SVG를 <img>로 보여 주므로 스크립트·웹 글꼴 없이 CSS 애니메이션만 쓴다.

import { effects as baseEffects, text, textWidth } from '@sch0718/motion-kit';

export const MOTION_EFFECTS = [
  baseEffects.rise,
  baseEffects.pop,
  baseEffects.draw({ seconds: 0.9, keepDasharray: true }),
  baseEffects.slide,
  baseEffects.pulse,
  baseEffects.tap,
];

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
