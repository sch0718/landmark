// 앱 진입점에서 import·export … from·동적 import()로 닿지 않는 src/**/*.{ts,tsx}를 찾는다.
// 쓰지 않는 옛 코드를 지운 뒤 다시 생기지 않았는지 확인하는 용도다: yarn orphans
// 정규식으로 import를 훑는 단순한 방식이다. 종료 코드는 늘 0이다(CI에는 넣지 않는다).
import console from 'node:console';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 진입점: HTML이 올리는 main 파일과, 서버 함수·파이프라인·빌드 도구 전체
const ENTRY_FILES = ['src/main.tsx', 'src/share-viewer/main.ts', 'src/share-map/main.ts'];
const ENTRY_DIRS = ['functions', 'pipeline', 'build'];
// 고아 검사에서 빼는 파일: 어디서도 import하지 않는 타입 선언
const IGNORED = new Set(['src/vite-env.d.ts']);

const SOURCE_EXT = /\.(ts|tsx)$/;
const EXT_CANDIDATES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function listSources(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...listSources(rel));
    else if (SOURCE_EXT.test(name)) out.push(rel);
  }
  return out;
}

// `import x from '…'`, `import type {…} from '…'`, `import '…'`, `export … from '…'`, `import('…')`
const SPECIFIER_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]*?)\s*from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function specifiersOf(code) {
  const text = stripComments(code);
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

// 경로 별칭 `src/…`와 상대 경로만 푼다. 패키지 import는 건너뛴다.
function resolveSpecifier(specifier, fromFile) {
  const base = specifier.startsWith('src/')
    ? join(root, specifier)
    : specifier.startsWith('.')
      ? resolve(root, dirname(fromFile), specifier)
      : null;
  if (base === null) return null;
  const withoutJs = base.replace(/\.js$/, '');
  for (const candidate of [base, withoutJs]) {
    for (const ext of EXT_CANDIDATES) {
      const file = candidate + ext;
      if (SOURCE_EXT.test(file) && existsSync(file) && statSync(file).isFile()) {
        return relative(root, file).split(sep).join('/');
      }
    }
  }
  return null;
}

const roots = [
  ...ENTRY_FILES.filter((file) => existsSync(join(root, file))),
  ...ENTRY_DIRS.flatMap(listSources),
];
const reached = new Set(roots);
const queue = [...roots];
while (queue.length > 0) {
  const file = queue.pop();
  const code = readFileSync(join(root, file), 'utf8');
  for (const specifier of specifiersOf(code)) {
    const target = resolveSpecifier(specifier, file);
    if (target !== null && !reached.has(target)) {
      reached.add(target);
      queue.push(target);
    }
  }
}

const orphans = listSources('src')
  .filter((file) => !IGNORED.has(file) && !reached.has(file))
  .sort();

if (orphans.length === 0) console.log('orphans: none');
else for (const file of orphans) console.log(file);
process.exit(0);
