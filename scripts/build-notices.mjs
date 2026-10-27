import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import process from 'node:process';

// 오픈소스 고지 파일(public/third-party-notices.txt)을 만든다. 앱이 /third-party-notices.txt로 보여 준다.
// package.json의 dependencies와 빌드 때 앱에 묶이는 개발 의존성(아이콘)을 따라가며 각 패키지의 라이선스 원문을 모은다.
// `--check`면 파일을 쓰지 않고 지금 node_modules 기준 결과와 다르면 실패한다(CI용).
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'public/third-party-notices.txt');
/** devDependencies 중 빌드 결과에 들어가는 것(unplugin-icons가 아이콘 SVG를 묶는다). */
const BUNDLED_DEV = ['@iconify-json/lucide'];
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-.][\w.-]*)?$/i;
/** 패키지에 라이선스 파일이 없어 upstream 원문을 저장해 둔 것(scripts/licenses/). */
const VENDORED = { '@iconify-json/lucide': 'lucide.txt' };

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

/** Node 해석 규칙대로 `from` 디렉터리에서 위로 올라가며 패키지 폴더를 찾는다. */
function resolvePackageDir(name, from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 패키지 루트와 dist/에서 LICENSE·NOTICE 파일을 찾는다(Pretendard는 dist/LICENSE.txt). */
async function licenseTexts(dir) {
  const texts = [];
  for (const sub of ['', 'dist']) {
    const base = join(dir, sub);
    if (!existsSync(base)) continue;
    const names = (await readdir(base)).filter((n) => LICENSE_FILE.test(n)).sort();
    for (const n of names) texts.push((await readFile(join(base, n), 'utf8')).trim());
  }
  return texts;
}

const repoUrl = (repository) => {
  const url = typeof repository === 'string' ? repository : repository?.url;
  return url
    ? url
        .replace(/^git\+/, '')
        .replace(/^git:\/\//, 'https://')
        .replace(/\.git$/, '')
    : '';
};

const rootPkg = await readJson(join(root, 'package.json'));
const seen = new Map();
const queue = [...Object.keys(rootPkg.dependencies ?? {}), ...BUNDLED_DEV].map((name) => ({
  name,
  from: root,
}));
while (queue.length > 0) {
  const { name, from } = queue.shift();
  const dir = resolvePackageDir(name, from);
  // 설치되지 않은 선택 의존성은 건너뛴다.
  if (dir === null) continue;
  const pkg = await readJson(join(dir, 'package.json'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  const texts = await licenseTexts(dir);
  if (texts.length === 0 && VENDORED[pkg.name]) {
    texts.push((await readFile(join(root, 'scripts/licenses', VENDORED[pkg.name]), 'utf8')).trim());
  }
  seen.set(key, { pkg, texts });
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    queue.push({ name: dep, from: dir });
  }
}

const entries = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
const lines = [
  '랜드마크 오픈소스 고지 (Third-party notices)',
  '',
  '랜드마크는 아래 오픈소스 패키지를 씁니다. 각 패키지의 저작권과 라이선스는 해당 저작자에게 있습니다.',
  '이 파일은 scripts/build-notices.mjs가 만듭니다(yarn build:notices).',
  '랜드마크 자체의 라이선스: PolyForm Noncommercial 1.0.0 (https://github.com/sch0718/landmark/blob/main/LICENSE)',
  '',
  '지도·장소 정보: 지도 화면은 NAVER Corp.의 네이버 지도 JavaScript API v3를 씁니다. 지도 데이터의 저작권은',
  '지도 위에 표시되는 저작권자에게 있습니다. 장소 정보는 사용자가 붙여 넣은 네이버·카카오 지도 링크에서 가져옵니다.',
  '',
  `패키지 ${entries.length}개`,
];
for (const [key, { pkg, texts }] of entries) {
  lines.push('', '='.repeat(72), key, `License: ${pkg.license ?? '확인 필요'}`);
  const repo = repoUrl(pkg.repository) || pkg.homepage || '';
  if (repo) lines.push(`Source: ${repo}`);
  lines.push('-'.repeat(72));
  lines.push(texts.length > 0 ? texts.join('\n\n') : '(패키지에 라이선스 파일이 없음)');
}
const content = `${lines.join('\n')}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(output) ? await readFile(output, 'utf8') : '';
  if (current !== content) {
    console.error(
      'public/third-party-notices.txt가 의존성과 다릅니다. yarn build:notices로 다시 만드세요.',
    );
    process.exit(1);
  }
  console.log(`오픈소스 고지 최신: 패키지 ${entries.length}개`);
} else {
  await writeFile(output, content);
  console.log(`public/third-party-notices.txt: 패키지 ${entries.length}개`);
}
