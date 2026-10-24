import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { pastel } from '../src/theme/tokens/pastel.ts';

// README 맨 위의 움직이는 소개 그림(애니메이션 SVG)을 라이트·다크 두 장으로 만든다.
// GitHub는 README의 SVG를 <img>로 보여 주므로 스크립트·웹 글꼴 없이 CSS 애니메이션만 쓴다.
// 색은 기본 테마(파스텔) 토큰을 그대로 읽는다. 화면 문구를 바꾸면 이 파일을 고치고 `yarn build:hero`.

const root = new URL('../', import.meta.url);
const W = 960;
const H = 440;
/** 장면 하나의 길이(초). 장면 넷이 이어서 돈다. */
const SCENE = 4;
const SCENES = 4;
const CYCLE = SCENE * SCENES;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const delay = (scene, offset = 0) => `animation-delay:${(scene * SCENE + offset).toFixed(2)}s`;

function text(
  x,
  y,
  value,
  { size = 14, weight = 400, fill, anchor = 'start', cls = '', style = '' } = {},
) {
  const extra = `${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}`;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}>${esc(value)}</text>`;
}

/** 라벨 칩. 글자 폭은 근사(한글 1em, 그 밖 0.6em, 이모지 1.2em)로 잰다. */
function chipWidth(label, size) {
  let w = 0;
  for (const ch of label) {
    if (/\p{Extended_Pictographic}/u.test(ch)) w += size * 1.2;
    else if (/[ㄱ-힝]/u.test(ch)) w += size;
    else if (ch !== '️') w += size * 0.6;
  }
  return Math.round(w + 20);
}

function chip(x, y, label, tone, { size = 13 } = {}) {
  const w = chipWidth(label, size);
  return {
    w,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="${tone.fill}"/>${text(x + 10, y + 17.5, label, { size, weight: 700, fill: tone.text })}`,
  };
}

function chipRow(x, y, items, gap = 6) {
  let cx = x;
  return items
    .map(([label, tone]) => {
      const c = chip(cx, y, label, tone);
      cx += c.w + gap;
      return c.svg;
    })
    .join('');
}

/** 지도 바탕: 땅·물·길. */
function mapBase(x, y, w, h, t, dark) {
  const land = dark ? '#1F2A22' : '#EEF3E6';
  const water = dark ? '#16303F' : '#D7EAF6';
  const road = dark ? '#3A4A40' : '#FFFFFF';
  return `<g><clipPath id="m${x}${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/></clipPath>
<g clip-path="url(#m${x}${y})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${land}"/>
<path d="M${x + w * 0.72} ${y} C${x + w * 0.66} ${y + h * 0.4} ${x + w * 0.9} ${y + h * 0.6} ${x + w * 0.8} ${y + h} L${x + w} ${y + h} L${x + w} ${y} Z" fill="${water}"/>
<path d="M${x} ${y + h * 0.35} L${x + w} ${y + h * 0.55} M${x + w * 0.3} ${y} L${x + w * 0.42} ${y + h} M${x} ${y + h * 0.8} L${x + w * 0.7} ${y + h * 0.7}" stroke="${road}" stroke-width="6" fill="none" stroke-linecap="round"/>
</g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="none" stroke="${t.border}"/></g>`;
}

function pin(x, y, color, { label, r = 9, cls = 'pop', style = '', fg = '#FFFFFF' } = {}) {
  return `<g class="${cls}" style="${style}"><circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="#FFFFFF" stroke-width="2.5"/>${
    label ? text(x, y + 4.5, label, { size: 12, weight: 800, fill: fg, anchor: 'middle' }) : ''
  }</g>`;
}

function card(x, y, w, h, t) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${t.bg.raised}" stroke="${t.border}"/>`;
}

function render(mode) {
  const t = pastel[mode];
  const dark = mode === 'dark';
  const L = t.label;
  const soft = dark ? '#2A3E18' : '#ECFCCB';
  const font = t.font.body.replace(/"/g, "'");

  const steps = [
    ['모으기', '라벨·이모지로 장소 정리'],
    ['계획하기', 'Day별 일정과 이동 시간'],
    ['약속 잡기', '모두에게 공평한 중간 지점'],
    ['나누기', '링크 하나로 보내고 담기'],
  ];
  const stepY = (i) => 196 + i * 50;
  const stepList = steps
    .map(
      ([title, sub], i) => `<g>
<rect class="sc s${i}" style="${delay(i)}" x="40" y="${stepY(i) - 22}" width="300" height="46" rx="14" fill="${soft}"/>
<circle cx="64" cy="${stepY(i)}" r="13" fill="none" stroke="${t.borderStrong}" stroke-width="1.5"/>
${text(64, stepY(i) + 4.5, i + 1, { size: 13, weight: 800, fill: t.text.secondary, anchor: 'middle' })}
<g class="sc s${i}" style="${delay(i)}"><circle cx="64" cy="${stepY(i)}" r="13" fill="${t.accent.main}"/>${text(64, stepY(i) + 4.5, i + 1, { size: 13, weight: 800, fill: t.accent.contrast, anchor: 'middle' })}</g>
${text(88, stepY(i) - 2, title, { size: 17, weight: 800, fill: t.text.primary })}
${text(88, stepY(i) + 16, sub, { size: 13, fill: t.text.muted })}
</g>`,
    )
    .join('');

  // 장면 1: 보관함
  const places = [
    ['⛰️', '바다 전망대', '강원 강릉시', ['⛰️ 명소', L.green], L.green.fill],
    ['🍜', '시장 칼국수', '강원 속초시', ['🍜 맛집', L.red], L.red.fill],
    ['☕', '바다 뷰 카페', '강원 양양군', ['☕ 카페', L.orange], L.orange.fill],
  ];
  const scene1 = `<g class="sc s0" style="${delay(0)}">
${text(396, 82, '보관함', { size: 19, weight: 800, fill: t.text.primary })}
${text(896, 82, '장소 128곳', { size: 13, fill: t.text.muted, anchor: 'end' })}
<g class="rise" style="${delay(0, 0.2)}">
<rect x="396" y="98" width="46" height="26" rx="13" fill="${t.accent.main}"/>${text(419, 115.5, '전체', { size: 13, weight: 700, fill: t.accent.contrast, anchor: 'middle' })}
${chipRow(448, 98, [
  ['🍜 맛집', L.red],
  ['☕ 카페', L.orange],
  ['⛰️ 명소', L.green],
  ['🌊 바다', L.blue],
])}
</g>
${places
  .map(([emoji, name, addr, [chipLabel, tone], fill], i) => {
    const x = 396 + i * 170;
    return `<g class="rise" style="${delay(0, 0.5 + i * 0.25)}">${card(x, 138, 160, 128, t)}
<rect x="${x + 8}" y="146" width="144" height="44" rx="8" fill="${fill}"/>${text(x + 80, 177, emoji, { size: 24, anchor: 'middle' })}
${text(x + 12, 212, name, { size: 15, weight: 800, fill: t.text.primary })}
${text(x + 12, 230, addr, { size: 12, fill: t.text.muted })}
${chip(x + 10, 236, chipLabel, tone, { size: 12 }).svg}</g>`;
  })
  .join('')}
${mapBase(396, 278, 500, 96, t, dark)}
${[
  [450, 330, L.green.marker],
  [520, 300, L.red.marker],
  [600, 352, L.orange.marker],
  [680, 318, L.red.marker],
  [742, 296, L.blue.marker],
  [800, 344, L.orange.marker],
  [566, 322, L.green.marker],
]
  .map(([x, y, c], i) => pin(x, y, c, { r: 7, style: delay(0, 1.4 + i * 0.12) }))
  .join('')}
</g>`;

  // 장면 2: 여행 계획
  const stops = [
    ['10:00', '1', '바다 전망대'],
    ['🚗 24분', null, null],
    ['11:30', '2', '시장 칼국수'],
    ['🚶 8분', null, null],
    ['13:00', '3', '바다 뷰 카페'],
  ];
  const scene2 = `<g class="sc s1" style="${delay(1)}">
${text(396, 82, '강릉 1박 2일', { size: 19, weight: 800, fill: t.text.primary })}
${text(896, 82, '10.31(토) – 11.1(일)', { size: 13, fill: t.text.muted, anchor: 'end' })}
<g class="rise" style="${delay(1, 0.2)}">${chipRow(396, 100, [
    ['Day 1 · 토', L.blue],
    ['Day 2 · 일', { fill: t.bg.base, text: t.text.muted }],
  ])}</g>
${stops
  .map(([time, n, name], i) => {
    const y = 148 + i * 40;
    if (n === null)
      return `<g class="rise" style="${delay(1, 0.5 + i * 0.2)}"><path d="M420 ${y - 14} V${y + 14}" stroke="${t.border}" stroke-width="2" stroke-dasharray="3 4"/>${text(438, y + 5, time, { size: 13, weight: 700, fill: t.text.secondary })}</g>`;
    return `<g class="rise" style="${delay(1, 0.5 + i * 0.2)}">${card(396, y - 18, 230, 36, t)}${pin(420, y, L.blue.marker, { label: n, r: 11, cls: '' })}
${text(440, y + 5, name, { size: 14, weight: 800, fill: t.text.primary })}${text(616, y + 5, time, { size: 12, fill: t.text.muted, anchor: 'end' })}</g>`;
  })
  .join('')}
${mapBase(640, 100, 256, 274, t, dark)}
<path class="draw" style="${delay(1, 0.9)}" pathLength="1" d="M680 320 C700 260 760 270 770 220 S820 150 850 140" fill="none" stroke="${L.blue.marker}" stroke-width="4" stroke-linecap="round"/>
${pin(704, 176, L.purple.marker, { r: 5, cls: 'pop', style: delay(1, 0.6) })}${pin(734, 352, L.purple.marker, { r: 5, cls: 'pop', style: delay(1, 0.6) })}
${pin(680, 320, L.blue.marker, { label: '1', r: 11, style: delay(1, 0.8) })}
${pin(770, 220, L.blue.marker, { label: '2', r: 11, style: delay(1, 1.3) })}
${pin(850, 140, L.blue.marker, { label: '3', r: 11, style: delay(1, 1.8) })}
</g>`;

  // 장면 3: 약속
  const S = [660, 214];
  const origins = [
    [446, 134, '나', '32분'],
    [862, 160, '친구 1', '35분'],
    [520, 292, '친구 2', '29분'],
  ];
  const scene3 = `<g class="sc s2" style="${delay(2)}">
${text(396, 82, '금요일 저녁 약속', { size: 19, weight: 800, fill: t.text.primary })}
${text(896, 82, '대중교통 · 3명', { size: 13, fill: t.text.muted, anchor: 'end' })}
${mapBase(396, 98, 500, 212, t, dark)}
${origins
  .map(
    ([x, y], i) =>
      `<path class="draw" style="${delay(2, 0.7 + i * 0.15)}" pathLength="1" d="M${x} ${y} L${S[0]} ${S[1]}" stroke="${t.text.secondary}" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  )
  .join('')}
${origins
  .map(([x, y, name, mins], i) => {
    const mx = (x + S[0]) / 2;
    const my = (y + S[1]) / 2;
    return `${pin(x, y, L.purple.marker, { r: 9, style: delay(2, 0.2 + i * 0.15) })}
<g class="rise" style="${delay(2, 0.3 + i * 0.15)}">${text(x, y - 16, name, { size: 13, weight: 800, fill: t.text.primary, anchor: 'middle' })}</g>
<g class="rise" style="${delay(2, 1.2 + i * 0.15)}"><rect x="${mx - 24}" y="${my - 13}" width="48" height="24" rx="12" fill="${t.bg.raised}" stroke="${t.border}"/>${text(mx, my + 4, mins, { size: 12, weight: 800, fill: t.text.primary, anchor: 'middle' })}</g>`;
  })
  .join('')}
<circle class="pulse" style="${delay(2, 1.0)}" cx="${S[0]}" cy="${S[1]}" r="16" fill="none" stroke="${t.accent.main}" stroke-width="3"/>
${pin(S[0], S[1], t.accent.main, { r: 16, style: delay(2, 0.9) })}${text(S[0], S[1] + 6, '★', { size: 16, weight: 800, fill: t.accent.contrast, anchor: 'middle', cls: 'pop', style: delay(2, 0.9) })}
<g class="rise" style="${delay(2, 1.0)}">${text(S[0], S[1] + 38, '합정역', { size: 14, weight: 800, fill: t.text.primary, anchor: 'middle' })}</g>
<g class="rise" style="${delay(2, 1.7)}">${card(396, 320, 500, 54, t)}
${text(412, 343, '1위 합정역', { size: 15, weight: 800, fill: t.text.primary })}
${text(412, 362, '가장 먼 사람 35분 · 평균 32분', { size: 12, fill: t.text.muted })}
<rect x="742" y="332" width="142" height="30" rx="15" fill="${t.accent.main}"/>${text(813, 352, '후보 링크 보내기', { size: 13, weight: 800, fill: t.accent.contrast, anchor: 'middle' })}</g>
</g>`;

  // 장면 4: 나누기
  const phone = { x: 716, y: 92, w: 168, h: 286 };
  const scene4 = `<g class="sc s3" style="${delay(3)}">
${text(396, 82, '링크로 나누기', { size: 19, weight: 800, fill: t.text.primary })}
<g class="rise" style="${delay(3, 0.2)}">${card(396, 100, 260, 226, t)}
${text(412, 128, '장소 3곳 공유', { size: 15, weight: 800, fill: t.text.primary })}
${places
  .map(
    ([emoji, name], i) =>
      `${text(414, 162 + i * 30, emoji, { size: 16 })}${text(442, 161 + i * 30, name, { size: 14, fill: t.text.primary })}`,
  )
  .join('')}
<rect x="412" y="250" width="110" height="32" rx="16" fill="${t.accent.main}"/>${text(467, 271, '링크 복사', { size: 13, weight: 800, fill: t.accent.contrast, anchor: 'middle' })}
<rect x="530" y="250" width="110" height="32" rx="16" fill="none" stroke="${t.borderStrong}"/>${text(585, 271, 'HTML 파일', { size: 13, weight: 700, fill: t.text.primary, anchor: 'middle' })}
${text(412, 308, '받는 사람은 설치·로그인 없이 봐요', { size: 12, fill: t.text.muted })}</g>
<g class="rise" style="${delay(3, 0.9)}"><rect x="420" y="338" width="210" height="34" rx="17" fill="${t.text.primary}"/>${text(525, 360, '링크를 복사했어요', { size: 13, weight: 700, fill: t.bg.base, anchor: 'middle' })}</g>
<rect x="${phone.x}" y="${phone.y}" width="${phone.w}" height="${phone.h}" rx="26" fill="${t.bg.base}" stroke="${t.borderStrong}" stroke-width="2"/>
<rect x="${phone.x + 62}" y="${phone.y + 10}" width="44" height="6" rx="3" fill="${t.border}"/>
<g class="slide" style="${delay(3, 1.2)}"><rect x="${phone.x + 12}" y="${phone.y + 30}" width="${phone.w - 24}" height="46" rx="14" fill="${soft}"/>
${text(phone.x + 22, phone.y + 50, 'landmark.sch0718.dev', { size: 11, weight: 800, fill: t.text.primary })}
${text(phone.x + 22, phone.y + 66, '/view#d=…', { size: 11, fill: t.text.secondary })}</g>
${places
  .map(
    ([emoji, name, , [, tone]], i) =>
      `<g class="rise" style="${delay(3, 1.9 + i * 0.15)}"><rect x="${phone.x + 12}" y="${phone.y + 90 + i * 44}" width="${phone.w - 24}" height="36" rx="10" fill="${t.bg.raised}" stroke="${t.border}"/>${pin(phone.x + 30, phone.y + 108 + i * 44, tone.marker, { r: 6, cls: '' })}${text(phone.x + 44, phone.y + 113 + i * 44, `${emoji} ${name}`, { size: 12, weight: 700, fill: t.text.primary })}</g>`,
  )
  .join('')}
<g class="rise" style="${delay(3, 2.5)}"><rect x="${phone.x + 12}" y="${phone.y + 232}" width="${phone.w - 24}" height="36" rx="18" fill="${t.accent.main}"/>${text(phone.x + phone.w / 2, phone.y + 255, 'Landmark에 담기', { size: 13, weight: 800, fill: t.accent.contrast, anchor: 'middle' })}</g>
</g>`;

  const css = `
text{font-family:${font}}
.sc{opacity:0;animation:scene ${CYCLE}s linear infinite backwards}
.rise{transform-box:fill-box;animation:rise ${CYCLE}s cubic-bezier(.2,.8,.2,1) infinite backwards}
.pop{transform-box:fill-box;transform-origin:center;animation:pop ${CYCLE}s ease-out infinite backwards}
.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw ${CYCLE}s ease-out infinite backwards}
.slide{transform-box:fill-box;animation:slide ${CYCLE}s cubic-bezier(.2,.8,.2,1) infinite backwards}
.pulse{transform-box:fill-box;transform-origin:center;opacity:0;animation:pulse ${CYCLE}s ease-out infinite backwards}
@keyframes scene{0%{opacity:0}3%{opacity:1}22%{opacity:1}25%{opacity:0}100%{opacity:0}}
@keyframes rise{0%{opacity:0;transform:translateY(14px)}3%{opacity:1;transform:none}100%{opacity:1;transform:none}}
@keyframes pop{0%{transform:scale(0)}2%{transform:scale(1.15)}3%{transform:scale(1)}100%{transform:scale(1)}}
@keyframes draw{0%{stroke-dashoffset:1}6%{stroke-dashoffset:0}100%{stroke-dashoffset:0}}
@keyframes slide{0%{opacity:0;transform:translateX(-120px)}4%{opacity:1;transform:none}100%{opacity:1;transform:none}}
@keyframes pulse{0%{opacity:.7;transform:scale(1)}6%{opacity:0;transform:scale(2.4)}100%{opacity:0;transform:scale(2.4)}}
@media (prefers-reduced-motion:reduce){
*{animation:none!important}
.s0{opacity:1}
.rise,.slide{opacity:1;transform:none}
.pop{transform:none}
.draw{stroke-dashoffset:0}
}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="hero-title hero-desc">
<title id="hero-title">랜드마크 — 평소에 모아 두고, 여행 때 꺼내 쓰는 장소 보관함</title>
<desc id="hero-desc">장소를 라벨과 이모지로 모으고, Day별 여행 일정을 짜고, 여러 사람의 출발지에서 공평한 약속 장소를 찾고, 링크 하나로 나누는 흐름을 차례로 보여 주는 그림</desc>
<style>${css}</style>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="28" fill="${t.bg.base}" stroke="${t.border}"/>
<g transform="translate(40 44) scale(0.109375)">${LOGO}</g>
${text(112, 76, '랜드마크', { size: 30, weight: 800, fill: t.text.primary })}
${text(112, 100, 'landmark.sch0718.dev', { size: 13, fill: t.text.muted })}
${text(40, 140, '평소에 모아 두고,', { size: 17, weight: 700, fill: t.text.secondary })}
${text(40, 163, '여행 때 꺼내 쓰는 장소 보관함', { size: 17, weight: 700, fill: t.text.secondary })}
${stepList}
<rect x="372" y="40" width="548" height="360" rx="22" fill="${t.bg.surface}" stroke="${t.border}"/>
${scene1}
${scene2}
${scene3}
${scene4}
</svg>
`;
}

const icon = await readFile(new URL('docs/branding/icon-a.svg', root), 'utf8');
const LOGO = icon
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

await mkdir(new URL('docs/readme/', root), { recursive: true });
for (const mode of ['light', 'dark']) {
  const file = new URL(`docs/readme/hero-${mode}.svg`, root);
  const svg = render(mode);
  await writeFile(file, svg);
  console.log(`${file.pathname.split('/docs/')[1]}: ${Buffer.byteLength(svg)} bytes`);
}
