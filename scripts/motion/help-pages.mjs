import { button, card, chip, chipRow, mapBase, pin, tap, text, textWidth } from './kit.mjs';

// 메뉴별 도움말의 단계와 휴대폰 화면. 문구는 앱 화면의 실제 문구를 그대로 쓴다(src/sections/*).
// 좌표는 help.mjs의 휴대폰 화면(x 612–888, y 32–488) 기준이다. 본문은 x 626–874, y 94–424.

const X = 626;
const W = 248;
const R = X + W;
const TOP = 94;
const SX = 612;
const SY = 32;
const SW = 276;
const SH = 456;
const TOAST_Y = 384;

const PLACES = {
  view: { emoji: '⛰️', name: '바다 전망대', addr: '강원 강릉시', label: '⛰️ 명소', tone: 'green' },
  noodle: { emoji: '🍜', name: '시장 칼국수', addr: '강원 속초시', label: '🍜 맛집', tone: 'red' },
  cafe: {
    emoji: '☕',
    name: '바다 뷰 카페',
    addr: '강원 양양군',
    label: '☕ 카페',
    tone: 'orange',
  },
  tofu: { emoji: '🍜', name: '초당 순두부', addr: '강원 강릉시', label: '🍜 맛집', tone: 'red' },
};

const selected = (c) => ({ fill: c.t.accent.main, text: c.t.accent.contrast });
const neutral = (c) => ({ fill: c.t.bg.base, text: c.t.text.secondary, stroke: c.t.border });
const tone = (c, p) => c.L[p.tone];

function searchBox(c, y, placeholder, value) {
  return `<rect x="${X}" y="${y}" width="${W}" height="34" rx="17" fill="${c.t.bg.base}" stroke="${c.t.border}"/>
<circle cx="${X + 18}" cy="${y + 16}" r="5.5" fill="none" stroke="${c.t.text.muted}" stroke-width="1.6"/><path d="M${X + 22} ${y + 20} l4 4" stroke="${c.t.text.muted}" stroke-width="1.6"/>
${text(X + 32, y + 22, value ?? placeholder, { size: 12.5, fill: value ? c.t.text.primary : c.t.text.muted })}`;
}

/** 장소 한 줄. `check`가 있으면 왼쪽에 고르기 동그라미를 둔다. */
function placeRow(c, y, p, { check, right, h = 50, cls = 'rise', offset = 0.2 } = {}) {
  const left = check === undefined ? X + 12 : X + 36;
  const checkSvg =
    check === undefined
      ? ''
      : check
        ? `<circle cx="${X + 18}" cy="${y + h / 2}" r="9" fill="${c.t.accent.main}"/>${text(X + 18, y + h / 2 + 4, '✓', { size: 11, weight: 800, fill: c.t.accent.contrast, anchor: 'middle' })}`
        : `<circle cx="${X + 18}" cy="${y + h / 2}" r="9" fill="none" stroke="${c.t.borderStrong}" stroke-width="1.5"/>`;
  return `<g class="${cls}" style="${c.d(offset)}">${card(X, y, W, h, c.t, { fill: check ? c.soft : undefined })}${checkSvg}
${text(left, y + 21, `${p.emoji} ${p.name}`, { size: 13.5, weight: 800, fill: c.t.text.primary })}
${text(left, y + 38, p.addr, { size: 11, fill: c.t.text.muted })}
${right ?? chip(R - textWidth(p.label, 11) - 30, y + 26, p.label, tone(c, p), { size: 11, h: 18 }).svg}</g>`;
}

function label(c, x, y, value) {
  return text(x, y, value, { size: 11, weight: 700, fill: c.t.text.muted });
}

function field(c, y, name, value, { w = W, x = X, placeholder = false } = {}) {
  return `${label(c, x, y, name)}<rect x="${x}" y="${y + 6}" width="${w}" height="32" rx="9" fill="${c.t.bg.base}" stroke="${c.t.borderStrong}"/>${text(x + 10, y + 27, value, { size: 12.5, fill: placeholder ? c.t.text.muted : c.t.text.primary })}`;
}

function sectionTitle(c, y, value) {
  return text(X, y, value, { size: 13.5, weight: 800, fill: c.t.text.primary });
}

/** 화면을 덮는 아래쪽 시트. 시트가 탭 막대까지 덮는다. */
function sheet(c, top, title, { done, offset = 0.1 } = {}) {
  return `<rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" rx="32" fill="#000" fill-opacity=".35"/>
<g class="rise" style="${c.d(offset)}"><path d="M${SX} ${top + 22} q0 -22 22 -22 h${SW - 44} q22 0 22 22 V${SY + SH - 32} q0 32 -32 32 h${-(SW - 64)} q-32 0 -32 -32 Z" fill="${c.t.bg.surface}"/>
<rect x="${SX + SW / 2 - 18}" y="${top + 8}" width="36" height="5" rx="2.5" fill="${c.t.border}"/>
${text(X, top + 38, title, { size: 16, weight: 800, fill: c.t.text.primary })}${done ? text(R, top + 38, done, { size: 13, weight: 800, fill: c.t.accent.text, anchor: 'end' }) : ''}</g>`;
}

function toast(c, value, offset) {
  const w = Math.min(W, textWidth(value, 12) + 36);
  return `<g class="rise" style="${c.d(offset)}"><rect x="${X + (W - w) / 2}" y="${TOAST_Y}" width="${w}" height="32" rx="16" fill="${c.t.text.primary}"/>${text(X + W / 2, TOAST_Y + 20.5, value, { size: 12, weight: 700, fill: c.t.bg.base, anchor: 'middle' })}</g>`;
}

const tapAt = (c, x, y, offset = 2.2) => tap(x, y, c.t, c.d(offset));
const rise = (c, offset, body) => `<g class="rise" style="${c.d(offset)}">${body}</g>`;

function smallMap(c, y, h) {
  return mapBase(X, y, W, h, c.t, c.dark, { rx: 12 });
}

function markers(c, list, offset = 0.4) {
  return list
    .map(([x, y, toneName], i) =>
      pin(x, y, c.L[toneName].marker, { r: 7, style: c.d(offset + i * 0.08) }),
    )
    .join('');
}

const MAP_MARKERS = [
  [664, 160, 'green'],
  [720, 132, 'red'],
  [790, 176, 'orange'],
  [700, 214, 'red'],
  [832, 240, 'blue'],
  [760, 268, 'green'],
  [676, 300, 'orange'],
  [812, 318, 'red'],
];

export const PAGES = [
  {
    id: 'library',
    tab: 'library',
    title: '보관함',
    lead: ['모아 둔 장소를 라벨·지역·이름으로 거르고,', '여러 곳을 한꺼번에 정리해요.'],
    tips: [
      '검색 칸은 이름·주소·메모·라벨을 함께 찾아요.',
      '정렬은 `최근 저장순`·`이름순`·`라벨순`·`다녀온 날순`·`가까운 순` 중에서 골라요. `가까운 순`을 고르면 내 위치에서 가까운 순서와 반경 칩이 나와요.',
      '라벨이 12개를 넘으면 칩 줄에 `라벨 찾기`가 생겨요. 이름으로 찾고, `하나라도`/`모두 포함`으로 여러 라벨을 함께 걸러요.',
      '시·도를 하나만 고르면 `이 지역으로 여행 만들기`가 나와요.',
      'PC에서는 Shift·Ctrl(⌘)+클릭으로 여러 곳을 골라요. 지운 장소는 알림의 `되돌리기`로 되살려요.',
    ],
    steps: [
      {
        title: '라벨로 거르기',
        sub: '칩을 누르면 그 라벨 장소만 보여요',
        screen: (c) => `${searchBox(c, TOP, '이름·주소·메모·라벨 검색')}
${rise(
  c,
  0.15,
  chipRow(
    X,
    TOP + 44,
    [
      ['라벨 관리', neutral(c)],
      ['🍜 맛집 12', c.L.red],
      ['☕ 카페 8', c.L.orange],
      ['⛰️ 명소 5', c.L.green],
    ],
    { size: 11.5, h: 24, gap: 5 },
  ),
)}
${placeRow(c, TOP + 82, PLACES.view, { offset: 0.3 })}${placeRow(c, TOP + 140, PLACES.noodle, { offset: 0.4 })}${placeRow(c, TOP + 198, PLACES.cafe, { offset: 0.5 })}${placeRow(c, TOP + 256, PLACES.tofu, { offset: 0.6 })}
${tapAt(c, 728, TOP + 56)}`,
      },
      {
        title: '지역·이름으로 좁히기',
        sub: '시·도 → 시·군을 고르고, 검색 칸에 이름',
        screen: (c) => `${searchBox(c, TOP, '', '칼국수')}
${chipRow(
  X,
  TOP + 44,
  [
    ['라벨 관리', neutral(c)],
    ['🍜 맛집 12', selected(c)],
    ['☕ 카페 8', c.L.orange],
  ],
  { size: 11.5, h: 24, gap: 5 },
)}
${rise(
  c,
  0.2,
  chipRow(
    X,
    TOP + 76,
    [
      ['강원 9', selected(c)],
      ['서울 2', neutral(c)],
      ['제주 1', neutral(c)],
    ],
    { size: 11.5, h: 24, gap: 5 },
  ),
)}
${rise(
  c,
  0.4,
  chipRow(
    X,
    TOP + 106,
    [
      ['강원 전체 9', neutral(c)],
      ['강릉 5', neutral(c)],
      ['속초 3', selected(c)],
    ],
    { size: 11.5, h: 24, gap: 5 },
  ),
)}
${placeRow(c, TOP + 144, PLACES.noodle, { offset: 0.7 })}
${tapAt(c, 836, TOP + 118, 1.4)}`,
      },
      {
        title: '길게 눌러 여러 곳 고르기',
        sub: '고른 뒤 아래 막대에서 한꺼번에 정리',
        screen: (c) => `${searchBox(c, TOP, '이름·주소·메모·라벨 검색')}
${placeRow(c, TOP + 44, PLACES.view, { check: true, cls: '', offset: 0 })}${placeRow(c, TOP + 102, PLACES.noodle, { check: true, cls: '', offset: 0 })}${placeRow(c, TOP + 160, PLACES.cafe, { check: false, cls: '', offset: 0 })}${placeRow(c, TOP + 218, PLACES.tofu, { check: false, cls: '', offset: 0 })}
${tapAt(c, 700, TOP + 127, 0.2)}
${rise(
  c,
  0.6,
  `<rect x="${SX}" y="${SY + SH - 116}" width="${SW}" height="116" rx="0" fill="${c.t.bg.raised}" stroke="${c.t.border}"/><path d="M${SX} ${SY + SH - 32} V${SY + SH - 116}" stroke="none"/>
${text(X, SY + SH - 90, '2곳 선택', { size: 13.5, weight: 800, fill: c.t.text.primary })}${text(R, SY + SH - 90, '선택 해제', { size: 12, weight: 700, fill: c.t.accent.text, anchor: 'end' })}
${chipRow(
  X,
  SY + SH - 76,
  [
    ['라벨 붙이기', neutral(c)],
    ['다녀옴', neutral(c)],
    ['여행에 넣기', neutral(c)],
  ],
  { size: 11.5, h: 28, gap: 5 },
)}`,
)}
${tapAt(c, 836, SY + SH - 62)}`,
      },
      {
        title: '여행에 넣기',
        sub: '고른 장소를 여행 후보로 보내요',
        screen: (
          c,
        ) => `${placeRow(c, TOP, PLACES.view, { check: true, cls: '', offset: 0 })}${placeRow(c, TOP + 58, PLACES.noodle, { check: true, cls: '', offset: 0 })}
${sheet(c, 196, '여행에 넣기')}
${rise(
  c,
  0.3,
  `${button(X, 250, 90, '새 여행', c.t, { variant: 'outlined', h: 30, size: 12 })}
${card(X, 292, W, 46, c.t)}${text(X + 12, 311, '강릉 1박 2일', { size: 13.5, weight: 800, fill: c.t.text.primary })}${text(X + 12, 328, '일정 4곳 · 후보 2곳', { size: 11, fill: c.t.text.muted })}
${card(X, 344, W, 46, c.t)}${text(X + 12, 363, '제주 여름 휴가', { size: 13.5, weight: 800, fill: c.t.text.primary })}${text(X + 12, 380, '일정 0곳 · 후보 6곳', { size: 11, fill: c.t.text.muted })}`,
)}
${tapAt(c, 720, 315, 1.4)}${toast(c, '2곳을 후보에 넣었어요', 2.2)}`,
      },
    ],
  },
  {
    id: 'map',
    tab: 'map',
    title: '지도',
    lead: ['보관함 장소를 라벨 색 마커로 보고,', '마커를 눌러 바로 상세를 열어요.'],
    tips: [
      '같은 마커를 다시 누르거나 지도 빈 곳을 누르면 선택이 풀려요.',
      '휴대폰에서는 시트를 끌어 올리거나 `펼치기`를 눌러 상세 전체를 봐요.',
      '`내 근처 1km` 칩의 ×를 누르면 근처 모드가 꺼져요.',
      '내 위치는 이 기기에서 거리를 재는 데만 쓰고 저장하지 않아요.',
    ],
    steps: [
      {
        title: '라벨 색 마커로 보기',
        sub: '보관함과 같은 라벨 거르기를 써요',
        appBar: '지도',
        screen: (c) => `${smallMap(c, TOP, 330)}
${rise(
  c,
  0.1,
  chipRow(
    X + 8,
    TOP + 8,
    [
      ['🍜 맛집', c.L.red],
      ['☕ 카페', c.L.orange],
      ['⛰️ 명소', c.L.green],
    ],
    { size: 11.5, h: 24, gap: 5 },
  ),
)}
${markers(c, MAP_MARKERS)}
${tapAt(c, 720, 132)}`,
      },
      {
        title: '마커 누르기',
        sub: '아래 시트에 장소 정보가 열려요',
        appBar: '지도',
        screen: (c) => `${smallMap(c, TOP, 330)}${markers(c, MAP_MARKERS, 0)}
${pin(720, 132, c.L.red.marker, { r: 11, cls: 'pop', style: c.d(0.1) })}
${rise(
  c,
  0.3,
  `<path d="M${SX} 296 q0 -20 20 -20 h${SW - 40} q20 0 20 20 V${SY + SH - 32} q0 32 -32 32 h${-(SW - 64)} q-32 0 -32 -32 Z" fill="${c.t.bg.surface}" stroke="${c.t.border}"/>
<rect x="${SX + SW / 2 - 18}" y="284" width="36" height="5" rx="2.5" fill="${c.t.border}"/>
${text(X, 318, '🍜 시장 칼국수', { size: 16, weight: 800, fill: c.t.text.primary })}${text(X, 338, '강원 속초시 중앙로 12', { size: 11.5, fill: c.t.text.muted })}
${chip(X, 348, '🍜 맛집', c.L.red, { size: 11.5, h: 22 }).svg}
${button(X, 380, 150, '네이버 지도에서 열기', c.t, { variant: 'outlined', h: 30, size: 12 })}${text(R, 400, '펼치기', { size: 12, weight: 700, fill: c.t.accent.text, anchor: 'end' })}`,
)}`,
      },
      {
        title: '내 위치 보기',
        sub: '지도 단추로 내 주변 저장 장소 확인',
        appBar: '지도',
        screen: (c) => `${smallMap(c, TOP, 330)}${markers(c, MAP_MARKERS, 0)}
<circle class="pop" style="${c.d(0.6)}" cx="742" cy="236" r="34" fill="#3B82F6" fill-opacity=".14" stroke="#3B82F6" stroke-opacity=".4"/>
<circle class="pop" style="${c.d(0.6)}" cx="742" cy="236" r="7" fill="#3B82F6" stroke="#FFFFFF" stroke-width="2.5"/>
<rect x="${R - 44}" y="${TOP + 230}" width="36" height="36" rx="18" fill="${c.t.bg.raised}" stroke="${c.t.border}"/><circle cx="${R - 26}" cy="${TOP + 248}" r="6" fill="none" stroke="${c.t.text.primary}" stroke-width="2"/>
${tapAt(c, R - 26, TOP + 248, 0.1)}${toast(c, '내 위치를 지도에 표시했어요', 1.2)}`,
      },
      {
        title: '가까운 곳만 보기',
        sub: '보관함 정렬 `가까운 순`과 반경 칩',
        appBar: '지도',
        screen: (c) => `${smallMap(c, TOP, 330)}
<circle cx="742" cy="236" r="92" fill="#3B82F6" fill-opacity=".08" stroke="#3B82F6" stroke-opacity=".5" stroke-dasharray="5 5"/>
<circle cx="742" cy="236" r="7" fill="#3B82F6" stroke="#FFFFFF" stroke-width="2.5"/>
${markers(c, MAP_MARKERS.slice(2, 6), 0.3)}
${rise(
  c,
  0.1,
  chipRow(
    X + 8,
    TOP + 8,
    [
      ['내 근처 1km ×', selected(c)],
      ['🍜 맛집', c.L.red],
    ],
    { size: 11.5, h: 24, gap: 5 },
  ),
)}`,
      },
    ],
  },
  {
    id: 'add',
    tab: 'library',
    title: '장소 추가',
    lead: ['가운데 ＋에서 링크·핀·네이버 폴더·공유 파일로', '장소를 담아요.'],
    tips: [
      '링크는 네이버·카카오·구글 지도의 장소 링크를 받아요.',
      '이미 담은 장소면 `이미 있는 장소예요. 고른 라벨만 더할게요`가 뜨고 단추가 `라벨 더하기`로 바뀌어요.',
      '링크로 장소를 못 찾으면 `지도에서 핀으로 추가`로 이어서 담아요.',
      '받은 공유 파일(.html)은 `공유 파일 가져오기`로 넣어요. PC에서는 화면에 끌어 놓아도 돼요. 여행 파일이면 `여행 계획도 가져오기`가 함께 나와요.',
    ],
    steps: [
      {
        title: '＋ 누르기',
        sub: '네 가지 방법 중 하나를 골라요',
        appBar: '보관함',
        screen: (
          c,
        ) => `${placeRow(c, TOP, PLACES.view, { cls: '', offset: 0 })}${placeRow(c, TOP + 58, PLACES.cafe, { cls: '', offset: 0 })}
${sheet(c, 176, '장소 추가', { offset: 0.2 })}
${[
  ['링크 붙여넣기', '네이버·카카오·구글 지도의 장소 링크'],
  ['지도에서 핀 찍기', '지도를 움직여 위치를 고르기'],
  ['네이버 폴더 가져오기', '네이버 공유 폴더의 장소를 한꺼번에'],
  ['공유 파일 가져오기', '받은 Landmark 공유 파일(.html)'],
]
  .map(([title, sub], i) =>
    rise(
      c,
      0.4 + i * 0.1,
      `${card(X, 230 + i * 50, W, 44, c.t)}${text(X + 12, 249 + i * 50, title, { size: 13.5, weight: 800, fill: c.t.text.primary })}${text(X + 12, 265 + i * 50, sub, { size: 10.5, fill: c.t.text.muted })}`,
    ),
  )
  .join('')}
${tapAt(c, 700, 252)}`,
      },
      {
        title: '링크 붙여넣기',
        sub: '네이버 지도 앱에서 공유한 링크를 그대로',
        screen: (c) => `${sheet(c, 60, '링크 붙여넣기', { offset: 0 })}
${text(X, 128, '링크를 붙여 넣어 주세요', { size: 12.5, fill: c.t.text.secondary })}
<rect x="${X}" y="140" width="${W}" height="64" rx="10" fill="${c.t.bg.base}" stroke="${c.t.borderStrong}"/>
${rise(c, 0.5, text(X + 12, 166, 'https://naver.me/xYz12AB', { size: 13, fill: c.t.text.primary }))}
${button(R - 80, 216, 80, '확인', c.t, { h: 32 })}
${tapAt(c, R - 40, 232, 1.6)}${rise(c, 2.2, text(X, 270, '장소를 찾는 중…', { size: 12, fill: c.t.text.muted }))}`,
      },
      {
        title: '확인하고 추가',
        sub: '라벨·메모를 골라 담아요',
        screen: (c) => `${sheet(c, 60, '링크 붙여넣기', { offset: 0 })}
${rise(
  c,
  0.1,
  `${field(c, 122, '이름', '시장 칼국수')}${field(c, 172, '주소', '강원 속초시 중앙로 12')}
${label(c, X, 228, '라벨')}${chipRow(
    X,
    236,
    [
      ['🍜 맛집', selected(c)],
      ['☕ 카페', neutral(c)],
      ['⛰️ 명소', neutral(c)],
    ],
    { size: 11.5, h: 24, gap: 5 },
  )}
${field(c, 276, '메모', '이 장소에 대한 메모', { placeholder: true })}
${button(X + 60, 330, 90, '취소', c.t, { variant: 'outlined', h: 32, size: 12.5 })}${button(R - 90, 330, 90, '추가', c.t, { h: 32 })}`,
)}
${tapAt(c, R - 45, 346, 1.8)}${toast(c, '추가했어요', 2.4)}`,
      },
      {
        title: '네이버 폴더 통째로',
        sub: '공유 폴더 링크로 한꺼번에 가져와요',
        screen: (c) => `${sheet(c, 60, '강릉맛집 · 50곳', { offset: 0 })}
${rise(c, 0.2, `${field(c, 120, '붙일 라벨', '강릉맛집')}${text(R, 120, '전체 해제', { size: 11.5, weight: 700, fill: c.t.accent.text, anchor: 'end' })}`)}
${placeRow(c, 170, PLACES.tofu, { check: true, offset: 0.4, right: '' })}
${placeRow(c, 226, PLACES.view, { check: true, offset: 0.5, right: '' })}
${placeRow(c, 282, PLACES.cafe, { check: false, offset: 0.6, right: chip(R - 70, 300, '이미 있음', neutral(c), { size: 11, h: 20 }).svg })}
${rise(c, 0.8, button(X, 346, W, '49곳 가져오기', c.t, { h: 34 }))}
${tapAt(c, X + W / 2, 363, 1.8)}${toast(c, '49곳을 새로 넣었어요', 2.4)}`,
      },
    ],
  },
  {
    id: 'place',
    tab: 'library',
    title: '장소 상세',
    lead: ['장소를 누르면 라벨·메모·다녀옴을 적고', '네이버 지도로 바로 열 수 있어요.'],
    tips: [
      '이름 옆 연필로 이름을, `분류 추가`로 분류를 고쳐요.',
      '`라벨 바꾸기`에서 없는 이름을 입력하면 `‘이름’ 새 라벨로 붙이기`가 나와요.',
      '메모는 10,000자까지, 한 줄 평은 140자까지 적을 수 있어요.',
      '맨 아래 `삭제`로 지워도 알림의 `되돌리기`로 되살릴 수 있어요.',
      '영업시간·휴무 경고는 여행 계획의 장소 카드에서 보여 줘요.',
    ],
    steps: [
      {
        title: '장소 열기',
        sub: '이름·주소와 `네이버 지도에서 열기`',
        appBar: null,
        screen: (c) => `${rise(
          c,
          0.1,
          `${text(X, 78, '🍜 시장 칼국수', { size: 19, weight: 800, fill: c.t.text.primary })}${text(X, 98, '강원 속초시 중앙로 12', { size: 12, fill: c.t.text.muted })}
${text(X, 120, '분류 추가', { size: 12, weight: 700, fill: c.t.accent.text })}
${button(X, 132, 150, '네이버 지도에서 열기', c.t, { variant: 'outlined', h: 30, size: 12 })}`,
        )}
${rise(
  c,
  0.3,
  `${sectionTitle(c, 192, '다녀옴')}${button(X, 202, 104, '다녀왔어요', c.t, { variant: 'outlined', h: 30, size: 12 })}
${sectionTitle(c, 260, '라벨')}${chip(X, 270, '🍜 맛집', c.L.red, { size: 11.5, h: 24 }).svg}${text(R, 287, '라벨 바꾸기', { size: 12, weight: 800, fill: c.t.accent.text, anchor: 'end' })}
${sectionTitle(c, 330, '메모')}<rect x="${X}" y="340" width="${W}" height="56" rx="10" fill="${c.t.bg.base}" stroke="${c.t.borderStrong}"/>`,
)}
${tapAt(c, R - 34, 283)}`,
      },
      {
        title: '라벨 바꾸기',
        sub: '눌러서 붙이고 떼고, 없으면 새로 만들기',
        screen: (c) => `${sheet(c, 60, '라벨 바꾸기', { done: '완료', offset: 0 })}
${searchBox(c, 116, '라벨 검색 또는 새 이름')}
${[
  ['🍜 맛집', true],
  ['🌊 바다', false],
  ['⭐ 또 갈 곳', true],
  ['☕ 카페', false],
]
  .map(
    ([name, on], i) =>
      `${text(X + 4, 182 + i * 38, name, { size: 13.5, weight: 700, fill: c.t.text.primary })}<g class="${on && i === 2 ? 'pop' : ''}" style="${c.d(1.6)}">${
        on
          ? `<circle cx="${R - 14}" cy="${177 + i * 38}" r="9" fill="${c.t.accent.main}"/>${text(R - 14, 181 + i * 38, '✓', { size: 11, weight: 800, fill: c.t.accent.contrast, anchor: 'middle' })}`
          : `<circle cx="${R - 14}" cy="${177 + i * 38}" r="9" fill="none" stroke="${c.t.borderStrong}" stroke-width="1.5"/>`
      }</g>`,
  )
  .join('')}
${tapAt(c, R - 14, 253, 1.4)}${tapAt(c, R, 98, 2.6)}`,
      },
      {
        title: '다녀옴·한 줄 평',
        sub: '다녀온 날과 140자 한 줄 평',
        appBar: null,
        screen: (
          c,
        ) => `${text(X, 78, '🍜 시장 칼국수', { size: 19, weight: 800, fill: c.t.text.primary })}${text(X, 98, '강원 속초시 중앙로 12', { size: 12, fill: c.t.text.muted })}
${sectionTitle(c, 136, '다녀옴')}
${rise(c, 0.2, `${field(c, 152, '다녀온 날', '2026-10-24', { w: 150 })}${text(R, 180, '다녀옴 취소', { size: 12, weight: 700, fill: c.t.accent.text, anchor: 'end' })}`)}
${sectionTitle(c, 226, '한 줄 평')}
<rect x="${X}" y="236" width="${W}" height="40" rx="10" fill="${c.t.bg.base}" stroke="${c.t.borderStrong}"/>
${rise(c, 0.9, text(X + 10, 261, '국물이 진하고 면이 쫄깃해요', { size: 12.5, fill: c.t.text.primary }))}
${sectionTitle(c, 314, '라벨')}${chipRow(
          X,
          324,
          [
            ['🍜 맛집', c.L.red],
            ['⭐ 또 갈 곳', c.L.yellow],
          ],
          { size: 11.5, h: 24 },
        )}`,
      },
      {
        title: '메모는 저절로 저장',
        sub: '입력을 멈추면 바로 저장돼요',
        appBar: null,
        screen: (
          c,
        ) => `${text(X, 78, '🍜 시장 칼국수', { size: 19, weight: 800, fill: c.t.text.primary })}${text(X, 98, '강원 속초시 중앙로 12', { size: 12, fill: c.t.text.muted })}
${sectionTitle(c, 136, '메모')}
<rect x="${X}" y="146" width="${W}" height="120" rx="10" fill="${c.t.bg.base}" stroke="${c.t.accent.main}" stroke-width="2"/>
${rise(c, 0.2, text(X + 10, 170, '11시 전에 가면 줄이 짧음', { size: 12.5, fill: c.t.text.primary }))}
${rise(c, 0.8, text(X + 10, 190, '물회도 맛있다고 함', { size: 12.5, fill: c.t.text.primary }))}
${rise(c, 1.4, text(X, 286, '저장 중…', { size: 11.5, fill: c.t.text.muted }))}
${rise(c, 2.2, `<rect x="${X}" y="274" width="80" height="18" fill="${c.t.bg.surface}"/>${text(X, 286, '저장됨', { size: 11.5, weight: 700, fill: c.t.text.secondary })}`)}
${text(R, 286, '9,974자 남음', { size: 11.5, fill: c.t.text.muted, anchor: 'end' })}`,
      },
    ],
  },
  {
    id: 'labels',
    tab: 'library',
    title: '라벨 관리',
    lead: [
      '보관함 칩 줄의 `라벨 관리`에서 라벨 색·이모지,',
      '순서, 합치기, 네이버 폴더 연결을 다뤄요.',
    ],
    tips: [
      '보관함 칩 줄 맨 앞의 `라벨 관리`로 들어가요.',
      '`합치기`는 두 라벨을 하나로 합치고, 붙어 있던 장소도 옮겨요.',
      '네이버 폴더로 가져온 라벨은 폴더와 연결돼 있어 `새로 저장한 곳 가져오기`로 새 장소만 받아요. `연결 끊기`로 끊을 수 있어요.',
      '`이름으로 이모지 정하기`는 알림의 `되돌리기`로 바로 취소할 수 있어요.',
    ],
    steps: [
      {
        title: '라벨 목록',
        sub: '끌어서 순서를 바꾸고, 눌러서 고쳐요',
        screen: (
          c,
        ) => `${field(c, TOP, '새 라벨 이름', '', { w: W - 64 })}${button(R - 56, TOP + 6, 56, '추가', c.t, { h: 32 })}
${rise(c, 0.1, button(X, TOP + 48, 160, '이름으로 이모지 정하기', c.t, { variant: 'outlined', h: 30, size: 12 }))}
${[
  ['🍜', '맛집', '장소 12곳 · 네이버 폴더', c.L.red],
  ['☕', '카페', '장소 8곳', c.L.orange],
  ['⛰️', '명소', '장소 5곳', c.L.green],
  ['', '강릉맛집', '장소 50곳 · 네이버 폴더', c.L.blue],
]
  .map(([emoji, name, sub, tn], i) =>
    rise(
      c,
      0.3 + i * 0.1,
      `${card(X, TOP + 92 + i * 52, W, 46, c.t)}${text(X + 12, TOP + 120 + i * 52, '⋮⋮', { size: 12, fill: c.t.text.muted })}<rect x="${X + 30}" y="${TOP + 104 + i * 52}" width="22" height="22" rx="6" fill="${tn.fill}"/>${text(X + 41, TOP + 120 + i * 52, emoji, { size: 13, anchor: 'middle' })}
${text(X + 62, TOP + 112 + i * 52, name, { size: 13.5, weight: 800, fill: c.t.text.primary })}${text(X + 62, TOP + 128 + i * 52, sub, { size: 11, fill: c.t.text.muted })}`,
    ),
  )
  .join('')}
${tapAt(c, 760, TOP + 113)}`,
      },
      {
        title: '색·이모지 고치기',
        sub: '`라벨 고치기`에서 이름·색·이모지',
        screen: (c) => `${sheet(c, 60, '라벨 고치기', { offset: 0 })}
${field(c, 120, '라벨 이름', '맛집')}
${label(c, X, 180, '색')}${['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']
          .map(
            (k, i) =>
              `<circle cx="${X + 14 + i * 30}" cy="${202}" r="11" fill="${c.L[k].marker}"/>`,
          )
          .join(
            '',
          )}<circle class="pop" style="${c.d(1.2)}" cx="${X + 14}" cy="202" r="15" fill="none" stroke="${c.t.text.primary}" stroke-width="2"/>
${label(c, X, 238, '이모지')}${chipRow(
          X,
          246,
          [
            ['🍜', selected(c)],
            ['🍣', neutral(c)],
            ['🍕', neutral(c)],
            ['🥟', neutral(c)],
            ['이모지 없음', neutral(c)],
          ],
          { size: 13, h: 28, gap: 5 },
        )}
${label(c, X, 296, '네이버 폴더')}${text(X, 316, '맛집 · 새로 저장한 곳 가져오기', { size: 12, fill: c.t.text.secondary })}
${button(X, 340, 74, '합치기', c.t, { variant: 'outlined', h: 30, size: 12 })}${button(X + 82, 340, 74, '지우기', c.t, { variant: 'outlined', h: 30, size: 12 })}${button(R - 74, 340, 74, '닫기', c.t, { h: 30, size: 12 })}
${tapAt(c, X + 14, 202, 1.0)}`,
      },
      {
        title: '이름으로 이모지 정하기',
        sub: '라벨 이름을 보고 이모지를 한꺼번에',
        screen: (c) => `${sheet(c, 60, '이름으로 이모지 정하기', { offset: 0 })}
${[
  ['🍜', '강릉맛집'],
  ['☕', '강릉 카페 & 베이커리'],
  ['🌊', '동해안 뷰 맛집'],
  ['⛰️', '강원도 명소'],
]
  .map(([emoji, name], i) =>
    rise(
      c,
      0.2 + i * 0.12,
      `<circle cx="${X + 10}" cy="${130 + i * 40}" r="9" fill="${c.t.accent.main}"/>${text(X + 10, 134 + i * 40, '✓', { size: 11, weight: 800, fill: c.t.accent.contrast, anchor: 'middle' })}${text(X + 28, 135 + i * 40, emoji, { size: 15 })}${text(X + 52, 135 + i * 40, name, { size: 13, weight: 700, fill: c.t.text.primary })}`,
    ),
  )
  .join('')}
${button(R - 80, 300, 80, '적용', c.t, { h: 32 })}
${tapAt(c, R - 40, 316, 1.6)}${toast(c, '라벨 4개의 이모지를 정했어요', 2.2)}`,
      },
      {
        title: '네이버 폴더 다시 가져오기',
        sub: '연결한 폴더에서 새로 저장한 곳만',
        screen: (c) => `${sheet(c, 60, '네이버 폴더 다시 가져오기', { offset: 0 })}
${rise(c, 0.2, text(X, 124, '새로 저장한 곳 2 · 그대로 48 · 폴더에서 빠진 곳 0', { size: 11.5, fill: c.t.text.secondary }))}
${rise(c, 0.3, sectionTitle(c, 152, '새로 저장한 곳'))}
${placeRow(c, 162, PLACES.tofu, { offset: 0.4, right: '' })}${placeRow(c, 218, PLACES.cafe, { offset: 0.5, right: '' })}
${rise(c, 0.7, button(X, 290, W, '2곳 가져오기', c.t, { h: 34 }))}
${tapAt(c, X + W / 2, 307, 1.8)}${toast(c, '‘강릉맛집’ 폴더를 확인했어요', 2.4)}`,
      },
    ],
  },
  {
    id: 'trips',
    tab: 'trips',
    title: '여행',
    lead: ['모아 둔 장소를 Day별로 배치하면', '이동 시간과 도착 시각이 붙어요.'],
    tips: [
      '`Day 자동 나누기`로 후보를 Day별로 나눠 미리 보고 `적용`해요. `순서 정리`는 이동이 가장 짧은 순서로 바꿔요.',
      '장소나 마커를 누르면 체류 시간·고정 시각·숙소를 정하고, 영업시간·휴무 경고를 봐요.',
      '구간 단추로 `자동차`·`도보`를 바꿔요. 경로를 못 받으면 `직선 추정`으로 보여 줘요.',
      '지도의 `다른 Day 장소` 단추로 다른 날 장소를 작은 점으로 켜고 꺼요.',
      '`일정 공유`로 일정을 링크나 HTML 파일로 보내요. 당일 모드 메뉴의 `화면 켜 두기`를 켜면 화면이 꺼지지 않아요.',
    ],
    steps: [
      {
        title: '새 여행 만들기',
        sub: '이름과 날짜, 첫날 출발지(선택)',
        screen: (c) => `${sheet(c, 60, '새 여행', { offset: 0 })}
${rise(
  c,
  0.2,
  `${field(c, 120, '여행 이름', '강릉 1박 2일')}${field(c, 172, '시작일', '2026-10-31', { w: 120 })}${field(c, 172, '종료일', '2026-11-01', { w: 120, x: R - 120 })}
${label(c, X, 228, '1일차 출발지 (선택)')}${button(X, 236, 110, '출발지 고르기', c.t, { variant: 'outlined', h: 30, size: 12 })}`,
)}
${rise(c, 0.5, button(R - 90, 300, 90, '만들기', c.t, { h: 34 }))}
${tapAt(c, R - 45, 317, 1.8)}`,
      },
      {
        title: '후보 담고 Day에 넣기',
        sub: '`보관함에서 더하기` → `Day 1에 넣기`',
        appBar: '강릉 1박 2일',
        screen: (c) => `${chipRow(
          X,
          TOP,
          [
            ['Day 1', selected(c)],
            ['Day 2', neutral(c)],
            ['후보 3', neutral(c)],
          ],
          { size: 12, h: 26, gap: 6 },
        )}
${rise(c, 0.1, button(X, TOP + 38, 130, '보관함에서 더하기', c.t, { variant: 'outlined', h: 28, size: 11.5 }))}
${[PLACES.view, PLACES.noodle, PLACES.cafe]
  .map((p, i) =>
    placeRow(c, TOP + 76 + i * 56, p, {
      offset: 0.3 + i * 0.1,
      right: text(R - 10, TOP + 106 + i * 56, '→ Day 1에 넣기', {
        size: 11,
        weight: 800,
        fill: c.t.accent.text,
        anchor: 'end',
      }),
    }),
  )
  .join('')}
${tapAt(c, R - 44, TOP + 102)}${toast(c, 'Day 1에 넣었어요', 2.6)}`,
      },
      {
        title: 'Day 일정과 이동 시간',
        sub: '도착 시각과 `네이버 지도로 길찾기`',
        appBar: '강릉 1박 2일',
        screen: (c) => `${chipRow(
          X,
          TOP,
          [
            ['Day 1', selected(c)],
            ['Day 2', neutral(c)],
            ['후보 1', neutral(c)],
          ],
          { size: 12, h: 26, gap: 6 },
        )}
${[
  ['10:00', '1', '바다 전망대'],
  ['🚗 자동차 24분', null, '네이버 지도로 길찾기'],
  ['11:30', '2', '시장 칼국수'],
  ['🚶 도보 8분', null, '네이버 지도로 길찾기'],
  ['13:00', '3', '바다 뷰 카페'],
]
  .map(([time, n, name], i) => {
    const y = TOP + 56 + i * 44;
    if (n === null)
      return rise(
        c,
        0.3 + i * 0.15,
        `<path d="M${X + 16} ${y - 14} V${y + 14}" stroke="${c.t.border}" stroke-width="2" stroke-dasharray="3 4"/>${text(X + 32, y + 4, time, { size: 12, weight: 700, fill: c.t.text.secondary })}${text(R, y + 4, name, { size: 11, weight: 700, fill: c.t.accent.text, anchor: 'end' })}`,
      );
    return rise(
      c,
      0.3 + i * 0.15,
      `${card(X, y - 18, W, 36, c.t)}${pin(X + 16, y, c.L.blue.marker, { label: n, r: 10, cls: '' })}${text(X + 34, y + 5, name, { size: 13, weight: 800, fill: c.t.text.primary })}${text(R - 10, y + 5, time, { size: 11.5, fill: c.t.text.muted, anchor: 'end' })}`,
    );
  })
  .join('')}
${tapAt(c, R - 50, TOP + 104)}`,
      },
      {
        title: '여행 당일 모드',
        sub: '`오늘 일정`에서 다음 장소와 다녀옴',
        appBar: '오늘 일정',
        screen: (c) => `${rise(
          c,
          0.1,
          `${card(X, TOP, W, 128, c.t, { fill: c.soft })}
${text(X + 12, TOP + 22, '다음 · 2번째', { size: 11.5, weight: 700, fill: c.t.text.secondary })}
${text(X + 12, TOP + 46, '🍜 시장 칼국수', { size: 17, weight: 800, fill: c.t.text.primary })}
${text(X + 12, TOP + 66, '계획 도착 11:30 · 계획대로', { size: 12, fill: c.t.text.secondary })}
${button(X + 12, TOP + 82, 70, '다녀옴', c.t, { variant: 'outlined', h: 30, size: 12 })}${button(X + 88, TOP + 82, 70, '길찾기', c.t, { h: 30, size: 12 })}`,
        )}
${rise(c, 0.4, sectionTitle(c, TOP + 156, '남은 일정 2곳'))}
${placeRow(c, TOP + 166, PLACES.noodle, { check: false, offset: 0.5, right: '' })}${placeRow(c, TOP + 222, PLACES.cafe, { check: false, offset: 0.6, right: '' })}
${tapAt(c, X + 47, TOP + 97, 1.8)}${toast(c, '‘시장 칼국수’ 다녀옴으로 표시했어요', 2.4)}`,
      },
    ],
  },
  {
    id: 'meetings',
    tab: 'meetings',
    title: '약속',
    lead: ['모두의 출발지에서 공평한 역을 찾고,', '친구 답장을 자동으로 모아 함께 골라요.'],
    tips: [
      '출발지가 있는 참석자가 2명 이상이어야 중간 지점을 찾아요.',
      '`카카오톡`을 누르면 링크를 준비해요. 알림의 `카카오톡으로 보내기`를 눌러 보내세요.',
      '역을 누르면 `반경 1km 안 보관함 장소`가 나오고 `후보에 담기`로 담아요.',
      '`후보 링크 보내기`를 처음 누르면 약속을 서버에 올리고 친구 링크를 공유해요. 공유 기능이 없으면 링크를 복사해요.',
      '친구는 받은 링크에서 `나는 누구?`를 고르고 좋아요와 자기 출발지를 바꿔요. 변경은 1초 뒤 자동 저장돼요.',
      '약속 화면을 열어 두면 10초마다 확인해 친구 답장을 자동으로 집계해요. 확정하면 열린 친구 화면에도 장소와 길찾기가 보여요.',
      '화면이 숨겨지거나 오프라인이면 확인을 멈춰요. 다시 열거나 연결되면 확인하고, 오류가 이어지면 확인 간격을 늘려요.',
      '약속 공유 메뉴의 `다른 기기에서 열기`에서 주최자 링크를 공유하거나 복사해 본인의 다른 기기로 보내세요. 주최자 링크를 가진 기기는 약속을 고칠 수 있어요.',
      '`주최자 링크 다시 발급`을 누르면 이전 주최자 링크는 쓸 수 없어요.',
      '참석자를 고른 기기가 그 이름을 차지해요. 다른 기기에서 답하려면 주최자가 메뉴의 `참석자 차지 풀기`를 눌러 주세요. 그 뒤 다른 기기에서 다시 고를 수 있어요.',
      '서버 사본은 약속 일시와 마지막 변경 중 늦은 쪽에서 30일 뒤 만료되고 정리돼요. `서버에서 지우기`로 먼저 지워도 보관함의 약속과 이미 받은 답장은 남아요.',
      '백업 파일에는 주최자 연결 정보가 포함되지 않아요. 다른 기기에서 약속을 고치려면 주최자 링크로 연결하세요.',
      '이미 답장 링크로 주고받던 약속은 예전 방식대로 써요. 친구의 `답장 링크 보내기`로 받은 링크를 열어 `반영`하면 집계에 더해져요.',
    ],
    steps: [
      {
        title: '새 약속',
        sub: '이름·날짜·시각, 이동수단',
        screen: (c) => `${sheet(c, 60, '새 약속', { offset: 0 })}
${rise(
  c,
  0.2,
  `${field(c, 120, '약속 이름', '금요일 저녁')}${field(c, 172, '날짜 (선택)', '2026-10-30', { w: 120 })}${field(c, 172, '시각 (선택)', '19:00', { w: 120, x: R - 120 })}
${label(c, X, 228, '이동수단')}${chipRow(
    X,
    236,
    [
      ['대중교통', selected(c)],
      ['자동차', neutral(c)],
      ['직선거리', neutral(c)],
    ],
    { size: 12, h: 28, gap: 6 },
  )}`,
)}
${rise(c, 0.5, button(R - 90, 300, 90, '만들기', c.t, { h: 34 }))}
${tapAt(c, R - 45, 317, 1.8)}`,
      },
      {
        title: '참석자 출발지',
        sub: '`검색` · `지도에서` · `보관함에서`',
        appBar: '금요일 저녁',
        screen: (c) => `${sectionTitle(c, TOP + 4, '참석자')}
${[
  ['나', '강남역'],
  ['민지', '홍대입구역'],
  ['준호', null],
]
  .map(([name, origin], i) =>
    rise(
      c,
      0.2 + i * 0.1,
      `${card(X, TOP + 16 + i * 52, W, 46, c.t)}${text(X + 12, TOP + 36 + i * 52, name, { size: 13.5, weight: 800, fill: c.t.text.primary })}${
        origin
          ? text(X + 12, TOP + 53 + i * 52, origin, { size: 11.5, fill: c.t.text.muted })
          : text(X + 12, TOP + 53 + i * 52, '출발지 없음', { size: 11.5, fill: c.t.text.muted })
      }${origin ? '' : text(R - 10, TOP + 44 + i * 52, '출발지 고르기', { size: 12, weight: 800, fill: c.t.accent.text, anchor: 'end' })}`,
    ),
  )
  .join('')}
${rise(c, 0.5, button(X, TOP + 178, 100, '참석자 추가', c.t, { variant: 'outlined', h: 30, size: 12 }))}
${tapAt(c, R - 46, TOP + 140, 1.2)}
${sheet(c, 236, '출발지 고르기', { offset: 1.8 })}
${rise(
  c,
  2.0,
  `${chipRow(
    X,
    290,
    [
      ['검색', selected(c)],
      ['지도에서', neutral(c)],
      ['보관함에서', neutral(c)],
    ],
    { size: 12, h: 26, gap: 6 },
  )}${searchBox(c, 326, '', '공덕역')}`,
)}`,
      },
      {
        title: '중간 지점 찾기',
        sub: '모두에게 공평한 번화가 역 순위',
        appBar: '금요일 저녁',
        screen: (c) => `${rise(c, 0.1, button(X, TOP, W, '중간 지점 찾기', c.t, { h: 34 }))}
${rise(
  c,
  0.4,
  chipRow(
    X,
    TOP + 46,
    [
      ['가장 먼 사람', selected(c)],
      ['평균', neutral(c)],
      ['편차', neutral(c)],
    ],
    { size: 12, h: 26, gap: 6 },
  ),
)}
${[
  ['1', '합정역', '가장 먼 사람 35분 · 평균 32분'],
  ['2', '공덕역', '가장 먼 사람 38분 · 평균 31분'],
  ['3', '신촌역', '가장 먼 사람 40분 · 평균 33분'],
]
  .map(([n, name, sub], i) =>
    rise(
      c,
      0.7 + i * 0.15,
      `${card(X, TOP + 86 + i * 54, W, 48, c.t, { fill: i === 0 ? c.soft : undefined })}${pin(X + 18, TOP + 110 + i * 54, i === 0 ? c.t.accent.main : c.L.purple.marker, { label: n, r: 11, cls: '', fg: i === 0 ? c.t.accent.contrast : '#FFFFFF' })}${text(X + 38, TOP + 106 + i * 54, name, { size: 13.5, weight: 800, fill: c.t.text.primary })}${text(X + 38, TOP + 123 + i * 54, sub, { size: 11, fill: c.t.text.muted })}`,
    ),
  )
  .join('')}
${rise(c, 1.4, button(X, TOP + 254, 120, '역 후보에 담기', c.t, { variant: 'outlined', h: 30, size: 12 }))}
${tapAt(c, X + 60, TOP + 269, 2.2)}`,
      },
      {
        title: '친구 답장 자동 집계',
        sub: '`후보 링크 보내기` → 자동 집계 → `확정`',
        appBar: '금요일 저녁',
        screen: (c) => `${sectionTitle(c, TOP + 4, '후보와 집계')}
${[
  ['합정역', '♥ 3 · 나, 민지, 준호', true],
  ['🍜 망원 칼국수', '♥ 1 · 민지', false],
]
  .map(([name, likes, top], i) =>
    rise(
      c,
      0.1 + i * 0.1,
      `${card(X, TOP + 16 + i * 56, W, 50, c.t, { fill: top ? c.soft : undefined })}${text(X + 12, TOP + 37 + i * 56, name, { size: 13.5, weight: 800, fill: c.t.text.primary })}${text(X + 12, TOP + 54 + i * 56, likes, { size: 11.5, fill: c.t.text.secondary })}${button(R - 62, TOP + 26 + i * 56, 52, '확정', c.t, { variant: top ? 'filled' : 'outlined', h: 28, size: 12 })}`,
    ),
  )
  .join('')}
${rise(c, 0.4, `${button(X, TOP + 138, 120, '후보 링크 보내기', c.t, { variant: 'outlined', h: 32, size: 12 })}${button(R - 120, TOP + 138, 120, '확정 링크 보내기', c.t, { h: 32, size: 12 })}`)}
${rise(c, 0.6, text(X, TOP + 196, '0분 전 기준', { size: 12, fill: c.t.text.muted }))}
${tapAt(c, R - 36, TOP + 40, 1.0)}${tapAt(c, R - 60, TOP + 154, 1.9)}${toast(c, '링크를 복사했어요', 2.5)}`,
      },
    ],
  },
  {
    id: 'share',
    tab: 'library',
    title: '공유',
    lead: [
      '보관함 장소나 여행 일정을 링크·HTML 파일로 보내고,',
      '받은 사람은 `Landmark에 담기`로 가져가요.',
    ],
    tips: [
      '장소를 고르지 않으면 지금 보이는(거른) 장소를 보내요. 고르면 고른 장소만 보내요.',
      '`메모 포함`을 켜면 받은 누구나 메모를 볼 수 있어요.',
      '`카카오톡`으로 바로 보낼 수 있어요. 링크가 너무 길면 `링크 복사`를 써요.',
      '장소가 많아 링크가 너무 길면 `파일 저장`으로 HTML 파일을 만들어 보내요.',
      '여행 일정은 여행 화면의 `일정 공유`로 보내요. `후보 N곳도 넣기`로 후보까지 담을 수 있어요.',
    ],
    steps: [
      {
        title: '내보내기 열기',
        sub: '지금 보이는 장소나 고른 장소를',
        appBar: '보관함',
        screen: (c) => `${searchBox(c, TOP, '이름·주소·메모·라벨 검색')}
${rise(
  c,
  0.1,
  `${chipRow(
    X,
    TOP + 44,
    [
      ['벤토', neutral(c)],
      ['카드', selected(c)],
      ['타일', neutral(c)],
      ['목록', neutral(c)],
    ],
    { size: 11.5, h: 24, gap: 4 },
  )}<rect x="${R - 30}" y="${TOP + 42}" width="28" height="28" rx="14" fill="${c.t.bg.raised}" stroke="${c.t.border}"/><path d="M${R - 16} ${TOP + 62} V${TOP + 50} m-5 5 l5 -5 l5 5" stroke="${c.t.text.primary}" stroke-width="1.8" fill="none"/>`,
)}
${placeRow(c, TOP + 82, PLACES.view, { offset: 0.3 })}${placeRow(c, TOP + 140, PLACES.noodle, { offset: 0.4 })}${placeRow(c, TOP + 198, PLACES.cafe, { offset: 0.5 })}
${tapAt(c, R - 16, TOP + 56)}`,
      },
      {
        title: '`링크 복사`',
        sub: '메신저에 붙여 넣으면 끝',
        screen: (c) => `${sheet(c, 60, '내보내기', { offset: 0 })}
${rise(
  c,
  0.2,
  `${text(X, 124, '지금 보이는 3곳을 내보냅니다', { size: 12, fill: c.t.text.secondary })}${field(c, 140, '제목', '강원 맛집 모음')}
<rect x="${X}" y="194" width="16" height="16" rx="4" fill="none" stroke="${c.t.borderStrong}" stroke-width="1.5"/>${text(X + 24, 207, '메모 포함', { size: 12.5, fill: c.t.text.primary })}
${button(X, 226, 120, '링크 복사', c.t, { h: 32, size: 12.5 })}${button(X + 128, 226, 120, '링크 공유', c.t, { variant: 'outlined', h: 32, size: 12.5 })}
${text(X, 278, '링크를 받은 사람은 누구나 메모를 볼 수 있어요', { size: 11, fill: c.t.text.muted })}
${button(X, 300, 80, '닫기', c.t, { variant: 'text', h: 32, size: 12.5 })}${button(R - 100, 300, 100, '파일 저장', c.t, { variant: 'outlined', h: 32, size: 12.5 })}`,
)}
${tapAt(c, X + 60, 242, 1.6)}${toast(c, '링크를 복사했어요', 2.2)}`,
      },
      {
        title: '받은 사람이 열기',
        sub: '설치·로그인 없이 지도와 목록으로',
        appBar: '강원 맛집 모음',
        screen: (c) => `${smallMap(c, TOP, 132)}${markers(
          c,
          [
            [660, 150, 'green'],
            [742, 128, 'red'],
            [820, 190, 'orange'],
          ],
          0.2,
        )}
${[PLACES.view, PLACES.noodle].map((p, i) => placeRow(c, TOP + 142 + i * 56, p, { offset: 0.5 + i * 0.1 })).join('')}
${rise(c, 0.8, button(X, TOP + 262, W, 'Landmark에 담기', c.t, { h: 36 }))}
${tapAt(c, X + W / 2, TOP + 280, 2.0)}`,
      },
      {
        title: '내 보관함에 담기',
        sub: '넣을 장소와 라벨을 고르고 가져오기',
        screen: (c) => `${sheet(c, 60, '강원 맛집 모음 · 3곳', { offset: 0 })}
${rise(c, 0.2, `<rect x="${X}" y="114" width="16" height="16" rx="4" fill="${c.t.accent.main}"/>${text(X + 8, 127, '✓', { size: 11, weight: 800, fill: c.t.accent.contrast, anchor: 'middle' })}${text(X + 24, 127, '파일 제목 라벨도 붙이기', { size: 12.5, fill: c.t.text.primary })}`)}
${placeRow(c, 142, PLACES.view, { check: true, offset: 0.3, right: '' })}${placeRow(c, 198, PLACES.noodle, { check: true, offset: 0.4, right: '' })}${placeRow(c, 254, PLACES.cafe, { check: false, offset: 0.5, right: chip(R - 70, 272, '이미 있음', neutral(c), { size: 11, h: 20 }).svg })}
${rise(c, 0.7, button(X, 322, W, '2곳 가져오기', c.t, { h: 34 }))}
${tapAt(c, X + W / 2, 339, 1.8)}`,
      },
    ],
  },
  {
    id: 'settings',
    tab: 'settings',
    title: '설정',
    lead: ['테마와 보기 방식을 고르고,', '보관함을 백업 파일로 받아 두세요.'],
    tips: [
      '되살리기 전 보관함은 따로 남아 있어 `되살리기 전으로 되돌리기`로 돌아갈 수 있어요.',
      '백업 파일에는 장소·라벨·여행·약속과 테마·보기 설정이 들어 있어요.',
      '`옛 여행 가져오기`는 예전 버전의 여행 파일(.json)이나 여행 ID로 불러와요.',
    ],
    steps: [
      {
        title: '테마와 모드',
        sub: '파스텔·수첩·나이트, 라이트·다크',
        screen: (c) => `${sectionTitle(c, TOP + 4, '테마')}
${rise(
  c,
  0.1,
  chipRow(
    X,
    TOP + 14,
    [
      ['파스텔', selected(c)],
      ['수첩', neutral(c)],
      ['나이트', neutral(c)],
    ],
    { size: 12.5, h: 30, gap: 6 },
  ),
)}
${sectionTitle(c, TOP + 74, '모드')}
${rise(
  c,
  0.2,
  chipRow(
    X,
    TOP + 84,
    [
      ['시스템', selected(c)],
      ['라이트', neutral(c)],
      ['다크', neutral(c)],
    ],
    { size: 12.5, h: 30, gap: 6 },
  ),
)}
${sectionTitle(c, TOP + 144, '보관함 보기')}
${rise(
  c,
  0.3,
  chipRow(
    X,
    TOP + 154,
    [
      ['벤토', neutral(c)],
      ['카드', selected(c)],
      ['타일', neutral(c)],
      ['목록', neutral(c)],
    ],
    { size: 12.5, h: 30, gap: 6 },
  ),
)}
${tapAt(c, X + 92, TOP + 99)}`,
      },
      {
        title: '백업 파일 받기',
        sub: '보관함 전체를 파일 하나로',
        screen: (c) => `${sectionTitle(c, TOP + 4, '백업')}
${rise(
  c,
  0.1,
  `${text(X, TOP + 26, '마지막 백업: 8일 전', { size: 12, fill: c.t.text.secondary })}
${button(X, TOP + 40, W, '백업 파일 받기', c.t, { h: 34 })}
${button(X, TOP + 82, W, '백업 공유', c.t, { variant: 'outlined', h: 34 })}
${button(X, TOP + 124, W, '백업 파일로 되살리기', c.t, { variant: 'outlined', h: 34 })}`,
)}
${sectionTitle(c, TOP + 190, '데이터 정보')}${text(X, TOP + 212, '장소 128곳 · 라벨 9개 · 사용 용량 약 410 KB', { size: 11.5, fill: c.t.text.secondary })}
${tapAt(c, X + W / 2, TOP + 57, 1.6)}${toast(c, 'landmark-backup-2026-10-24-0930.json', 2.2)}`,
      },
      {
        title: '다른 기기에서 되살리기',
        sub: '`백업 파일로 되살리기` → 파일 고르기',
        screen: (c) => `${sheet(c, 60, '백업에서 되살리기', { offset: 0 })}
${rise(
  c,
  0.2,
  `${button(X, 116, 100, '파일 고르기', c.t, { variant: 'outlined', h: 30, size: 12 })}
${text(X, 168, 'landmark-backup-2026-10-24-0930.json', { size: 12, weight: 700, fill: c.t.text.primary })}
${text(X, 186, '장소 128곳 · 라벨 9개 · 여행 2개', { size: 11.5, fill: c.t.text.secondary })}
${card(X, 200, W, 44, c.t, { fill: c.dark ? '#4A2520' : '#FFF1EE' })}${text(X + 12, 226, '지금 보관함은 지워지고 이 백업 내용으로 바뀌어요.', { size: 10.5, fill: c.t.error })}
${button(X, 258, W, '지금 보관함 먼저 받기', c.t, { variant: 'outlined', h: 32, size: 12.5 })}
${button(X, 298, W, '이 백업으로 바꾸기', c.t, { h: 32, size: 12.5 })}`,
)}
${tapAt(c, X + W / 2, 314, 1.8)}${toast(c, '백업에서 되살렸어요', 2.4)}`,
      },
      {
        title: '백업 알림',
        sub: '오래 백업하지 않으면 보관함 위에 알려요',
        appBar: '보관함',
        screen: (c) => `${rise(
          c,
          0.2,
          `${card(X, TOP, W, 80, c.t, { fill: c.soft })}
${text(X + 12, TOP + 22, '마지막 백업이 8일 전이에요.', { size: 12.5, weight: 800, fill: c.t.text.primary })}
${text(X + 12, TOP + 40, '그 뒤로 바뀐 내용이 있어요', { size: 12, fill: c.t.text.secondary })}
${button(X + 12, TOP + 48, 78, '백업 받기', c.t, { h: 26, size: 11.5 })}${button(X + 96, TOP + 48, 60, '나중에', c.t, { variant: 'text', h: 26, size: 11.5 })}`,
        )}
${placeRow(c, TOP + 92, PLACES.view, { cls: '', offset: 0 })}${placeRow(c, TOP + 150, PLACES.noodle, { cls: '', offset: 0 })}${placeRow(c, TOP + 208, PLACES.cafe, { cls: '', offset: 0 })}
${tapAt(c, X + 51, TOP + 61, 1.8)}`,
      },
    ],
  },
];
