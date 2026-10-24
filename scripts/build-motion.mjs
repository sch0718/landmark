import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { renderHero } from './motion/hero.mjs';
import { HELP_PAGES, renderHelp, renderHelpIndex, renderHelpMarkdown } from './motion/help.mjs';

// README 소개 그림(docs/readme/hero-*.svg)과 메뉴별 도움말 그림(docs/help/img/*-*.svg)을
// 라이트·다크 두 장씩 만들고, 도움말 글(docs/help/*.md)도 같은 단계 정의로 만든다. 화면 문구나 색이 바뀌면 scripts/motion/*.mjs를 고치고 `yarn build:motion`.

const root = new URL('../', import.meta.url);
const icon = await readFile(new URL('docs/branding/icon-a.svg', root), 'utf8');
const logo = icon
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

async function write(path, svg) {
  await writeFile(new URL(path, root), svg);
  console.log(`${path}: ${Buffer.byteLength(svg)} bytes`);
}

await mkdir(new URL('docs/readme/', root), { recursive: true });
await mkdir(new URL('docs/help/img/', root), { recursive: true });
for (const mode of ['light', 'dark']) {
  await write(`docs/readme/hero-${mode}.svg`, renderHero(mode, logo));
  for (const page of HELP_PAGES) {
    await write(`docs/help/img/${page.id}-${mode}.svg`, renderHelp(page, mode));
  }
}
for (const page of HELP_PAGES) await write(`docs/help/${page.id}.md`, renderHelpMarkdown(page));
await write('docs/help/README.md', renderHelpIndex(HELP_PAGES));
