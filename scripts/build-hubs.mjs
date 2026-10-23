// 약속장소의 번화가 역 데이터(`src/domain/meeting/hubs-data.ts`)를 만든다.
// `scripts/hubs-list.json`의 이름마다 네이버 자동완성 검색을 불러 역·터미널·공항 분류의 첫 결과 좌표를 쓴다.
// 앱 실행 중에는 쓰지 않는다. 네트워크가 되는 곳에서 `node scripts/build-hubs.mjs`로 돌리고 결과를 사람이 확인해 커밋한다.
// id는 목록 순서(`h001`…)라 목록 중간에 끼우지 말고 끝에 더한다.
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';
import console from 'node:console';

const { fetch } = globalThis;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const KIND = /지하철|전철|기차|철도|정차역|버스터미널|터미널|공항/;
const NOT_KIND = /출구|주차장|방면/;
const OUT = 'src/domain/meeting/hubs-data.ts';

const list = JSON.parse(await readFile('scripts/hubs-list.json', 'utf8'));
const hubs = [];
const misses = [];
for (const [i, item] of list.entries()) {
  const url = `https://map.naver.com/p/api/search/instant-search?query=${encodeURIComponent(item.query)}&coords=37.5,127.0`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://map.naver.com/' },
  });
  const body = res.ok ? await res.json() : { place: [] };
  const hit = (body.place ?? []).find((p) => KIND.test(p.ctg ?? '') && !NOT_KIND.test(p.ctg ?? ''));
  if (hit === undefined) {
    misses.push(item.query);
  } else {
    hubs.push({
      id: `h${String(i + 1).padStart(3, '0')}`,
      name: item.name,
      region: item.region,
      lng: Math.round(Number(hit.x) * 1e6) / 1e6,
      lat: Math.round(Number(hit.y) * 1e6) / 1e6,
      found: hit.title,
    });
  }
  await sleep(300);
}

const rows = hubs
  .map(
    (h) =>
      `  { id: '${h.id}', name: '${h.name}', region: '${h.region}', lng: ${h.lng}, lat: ${h.lat} }, // ${h.found}`,
  )
  .join('\n');
await writeFile(
  OUT,
  `// \`node scripts/build-hubs.mjs\`가 만든 파일이다. 손으로 고치지 말고 목록을 고쳐 다시 만든다.\n` +
    `import type { Hub } from './hubs';\n\n` +
    `export const HUBS: readonly Hub[] = [\n${rows}\n];\n`,
);
console.log(`${hubs.length}곳 저장, 못 찾음 ${misses.length}: ${misses.join(', ')}`);
if (misses.length > 0) process.exitCode = 1;
