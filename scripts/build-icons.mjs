import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import console from 'node:console';

// 기존 wrangler → miniflare의 렌더러를 쓴다. 의존성이 중첩 설치되어도 찾을 수 있다.
const wranglerRequire = createRequire(import.meta.resolve('wrangler'));
const miniflareRequire = createRequire(wranglerRequire.resolve('miniflare'));
const sharp = miniflareRequire('sharp');

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('docs/branding/icon-a.svg', root), 'utf8');
const outputs = [
  { name: 'apple-touch-icon.png', size: 180, fullBleed: true },
  { name: 'icon-192.png', size: 192, fullBleed: false },
  { name: 'icon-512.png', size: 512, fullBleed: false },
  { name: 'icon-maskable-512.png', size: 512, fullBleed: true },
];

for (const { name, size, fullBleed } of outputs) {
  // 홈 화면의 모서리 자르기는 운영체제에 맡기고 핵심 도형은 같은 위치에 둔다.
  const svg = fullBleed ? source.replace('rx="112"', 'rx="0"') : source;
  const png = await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(new URL(`public/${name}`, root), png);
  console.log(`${name}: ${size}×${size}, ${png.length}바이트`);
}

await writeFile(new URL('public/favicon.svg', root), source);
