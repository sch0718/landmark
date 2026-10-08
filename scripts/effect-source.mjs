// package.json의 effect 버전과 같은 태그를 effect 저장소(Effect-TS/effect)에서 얕게 clone해
// .reference/effect/ 에 둔다. AI가 Effect API를 확인하는 참고용이며 커밋하지 않는다.
// 버전을 올리면 다시 실행한다: yarn effect:source
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.dependencies?.effect;
if (!version) {
  console.error('package.json dependencies에 effect가 없습니다.');
  process.exit(1);
}

const target = join(root, '.reference', 'effect');
rmSync(target, { recursive: true, force: true });

const tag = `effect@${version}`;
console.log(`clone ${tag} -> .reference/effect`);
execFileSync(
  'git',
  ['clone', '--depth', '1', '--branch', tag, 'https://github.com/Effect-TS/effect.git', target],
  { stdio: 'inherit' },
);
