import { pastel } from '../../src/theme/tokens/pastel.ts';
import { at, motionCss, svgDocument, text } from './kit.mjs';
import { PAGES } from './help-pages.mjs';

// 메뉴별 도움말 그림. 왼쪽에 단계 목록, 오른쪽에 휴대폰 화면을 두고 단계마다 실제 화면 흐름을 보여 준다.
// 누르는 곳은 동그라미(`tap`)로 알리고, 다음 단계에서 그 결과 화면이 나온다.

const W = 960;
const H = 520;
/** 단계 하나의 길이(초). */
const STEP = 3.6;

/** 휴대폰 화면 안쪽 영역. 단계 화면은 이 좌표로 그린다. */
export const SCREEN = { x: 612, y: 32, w: 276, h: 456 };
/** 앱 바 아래·탭 막대 위 본문 영역. */
export const BODY = {
  x: SCREEN.x + 14,
  y: SCREEN.y + 62,
  w: SCREEN.w - 28,
  bottom: SCREEN.y + SCREEN.h - 64,
};

const TABS = [
  ['library', '보관함'],
  ['map', '지도'],
  ['add', ''],
  ['trips', '여행'],
  ['meetings', '약속'],
  ['settings', '설정'],
];

export const HELP_PAGES = PAGES;

/** 도움말 글의 `단추 이름`을 그림 글자로 바꾼다(그림에는 ‘단추 이름’). */
const plain = (s) => s.replace(/`([^`]+)`/g, '‘$1’');

function tabBar(t, active) {
  const y = SCREEN.y + SCREEN.h - 58;
  const step = SCREEN.w / TABS.length;
  const items = TABS.map(([key, label], i) => {
    const cx = SCREEN.x + step * i + step / 2;
    if (key === 'add')
      return `<circle cx="${cx}" cy="${y + 26}" r="19" fill="${t.accent.main}"/>${text(cx, y + 33, '＋', { size: 20, weight: 800, fill: t.accent.contrast, anchor: 'middle' })}`;
    const on = key === active;
    const fill = on ? t.text.primary : t.text.muted;
    return `<rect x="${cx - 9}" y="${y + 12}" width="18" height="16" rx="5" fill="none" stroke="${fill}" stroke-width="${on ? 2.2 : 1.6}"/>${text(cx, y + 44, label, { size: 10.5, weight: on ? 800 : 500, fill, anchor: 'middle' })}`;
  }).join('');
  return `<path d="M${SCREEN.x} ${y} H${SCREEN.x + SCREEN.w}" stroke="${t.border}"/>${items}`;
}

export function renderHelp(page, mode) {
  const t = pastel[mode];
  const dark = mode === 'dark';
  const soft = dark ? '#2A3E18' : '#ECFCCB';
  const font = t.font.body.replace(/"/g, "'");
  const delay = at(STEP);
  const ctx = { t, dark, L: t.label, soft, delay, SCREEN, BODY };

  const stepY = (i) => 236 + i * 52;
  const steps = page.steps
    .map(
      (s, i) => `<g>
<rect class="sc s${i}" style="${delay(i)}" x="32" y="${stepY(i) - 23}" width="510" height="48" rx="14" fill="${soft}"/>
<circle cx="58" cy="${stepY(i)}" r="13" fill="none" stroke="${t.borderStrong}" stroke-width="1.5"/>
${text(58, stepY(i) + 4.5, i + 1, { size: 13, weight: 800, fill: t.text.secondary, anchor: 'middle' })}
<g class="sc s${i}" style="${delay(i)}"><circle cx="58" cy="${stepY(i)}" r="13" fill="${t.accent.main}"/>${text(58, stepY(i) + 4.5, i + 1, { size: 13, weight: 800, fill: t.accent.contrast, anchor: 'middle' })}</g>
${text(82, stepY(i) - 2, plain(s.title), { size: 16, weight: 800, fill: t.text.primary })}
${text(82, stepY(i) + 16, plain(s.sub), { size: 13, fill: t.text.muted })}
</g>`,
    )
    .join('');

  const screens = page.steps
    .map((s, i) => {
      const d = (offset = 0) => delay(i, offset);
      const appBar =
        s.appBar === null
          ? ''
          : text(SCREEN.x + 18, SCREEN.y + 40, s.appBar ?? page.title, {
              size: 18,
              weight: 800,
              fill: t.text.primary,
            });
      return `<g class="sc s${i}" style="${delay(i)}">${appBar}${s.screen({ ...ctx, d })}</g>`;
    })
    .join('\n');

  const lead = page.lead
    .map((line, i) =>
      text(40, 150 + i * 23, plain(line), { size: 15, weight: 600, fill: t.text.secondary }),
    )
    .join('');

  const body = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="28" fill="${t.bg.base}" stroke="${t.border}"/>
${text(40, 66, '랜드마크 도움말', { size: 14, weight: 700, fill: t.text.muted })}
${text(40, 110, page.title, { size: 30, weight: 800, fill: t.text.primary })}
${lead}
${steps}
<rect x="600" y="20" width="300" height="480" rx="42" fill="${t.bg.raised}" stroke="${t.borderStrong}" stroke-width="2"/>
<rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" rx="32" fill="${t.bg.surface}"/>
<rect x="${SCREEN.x + SCREEN.w / 2 - 30}" y="${SCREEN.y + 8}" width="60" height="7" rx="3.5" fill="${t.border}"/>
<clipPath id="screen"><rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" rx="32"/></clipPath>
<g clip-path="url(#screen)">${tabBar(t, page.tab)}
${screens}</g>`;

  return svgDocument({
    w: W,
    h: H,
    title: `랜드마크 도움말 — ${page.title}`,
    desc: plain(
      `${page.title} 사용법: ${page.steps.map((s, i) => `${i + 1}. ${s.title}(${s.sub})`).join(' ')}`,
    ),
    css: motionCss({ sceneLength: STEP, scenes: page.steps.length, font }),
    body,
  });
}

const picture = (page, alt) => `<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/help/img/${page.id}-dark.svg">
    <img src="../../public/help/img/${page.id}-light.svg" width="960" alt="${alt.replace(/"/g, '&quot;')}">
  </picture>
</p>`;

/** 메뉴 하나의 도움말 글(docs/help/<id>.md). */
export function renderHelpMarkdown(page) {
  const alt = plain(
    `${page.title} 사용법: ${page.steps.map((s, i) => `${i + 1}. ${s.title}`).join(', ')}`,
  );
  return `# ${page.title}

${picture(page, alt)}

${page.lead.join(' ')}

## 이렇게 써요

${page.steps.map((s, i) => `${i + 1}. **${s.title}** — ${s.sub}`).join('\n')}

## 알아 두면 좋아요

${page.tips.map((tip) => `- ${tip}`).join('\n')}

---

[도움말 모음](README.md) · [README](../../README.md)
`;
}

/** 도움말 모음(docs/help/README.md). */
export function renderHelpIndex(pages) {
  return `# 랜드마크 도움말

메뉴마다 실제 화면 흐름을 움직이는 그림으로 보여 줍니다. 서비스 소개는 [README](../../README.md)에 있습니다.

| 메뉴 | 이렇게 써요 |
| --- | --- |
${pages.map((p) => `| [${p.title}](${p.id}.md) | ${p.steps.map((s) => s.title).join(' → ')} |`).join('\n')}

그림과 앱 도움말 데이터는 \`yarn build:motion\`이 \`scripts/motion/help-pages.mjs\`로 만듭니다. 화면 문구가 바뀌면 그 파일을 고치고 다시 만드세요.
`;
}

/** 앱에서 쓰는 도움말 문구. 그림을 그리는 함수와 탭 정보는 포함하지 않는다. */
export function renderHelpContent(pages) {
  const content = pages.map(({ id, title, lead, steps, tips }) => ({
    id,
    title,
    lead,
    steps: steps.map(({ title, sub }) => ({ title, sub })),
    tips,
  }));
  return `// 이 파일은 yarn build:motion으로 생성합니다. 직접 고치지 마세요.
// 도움말 문구는 scripts/motion/help-pages.mjs에서 고칩니다.

export const HELP_PAGES = ${JSON.stringify(content, null, 2)} as const;

export type HelpPageId = (typeof HELP_PAGES)[number]['id'];
export type HelpPage = (typeof HELP_PAGES)[number];
`;
}
