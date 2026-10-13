import { readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import process from 'node:process';
import console from 'node:console';

/** 태그 문자열에서 속성 값을 읽는다(따옴표 있는 형태만 — Vite가 내는 형태). */
function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[1] ?? match[2]) : undefined;
}

/**
 * `index.html`이 처음에 받는 JS 경로(`dist` 기준 상대, 중복 없음).
 * `<script type="module" src>`와 `<link rel="modulepreload" href>`만 센다.
 */
export function initialScriptPaths(html) {
  const found = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const isScript = /^<script/i.test(tag);
    if (
      isScript ? attribute(tag, 'type') !== 'module' : attribute(tag, 'rel') !== 'modulepreload'
    ) {
      continue;
    }
    const url = attribute(tag, isScript ? 'src' : 'href');
    if (url === undefined) continue;
    // 절대(`/assets/x.js`)든 상대든 `dist` 안의 경로로 풀고, 쿼리·해시는 버린다.
    const path = posix.normalize(url.replace(/[?#].*$/, '').replace(/^\/+/, ''));
    if (path.endsWith('.js') && !found.includes(path)) found.push(path);
  }
  return found;
}

async function measureFile(dist, path) {
  const data = await readFile(join(dist, path));
  return { name: path, bytes: data.length, gzipBytes: gzipSync(data).length };
}

const sum = (rows) =>
  rows.reduce(
    (total, row) => ({
      bytes: total.bytes + row.bytes,
      gzipBytes: total.gzipBytes + row.gzipBytes,
    }),
    { bytes: 0, gzipBytes: 0 },
  );

/** 첫 화면 JS(`initial`)와 `dist/assets`의 모든 JS(`total`)를 잰다. */
export async function measureBundle(dist = 'dist') {
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const files = [];
  for (const path of initialScriptPaths(html)) files.push(await measureFile(dist, path));
  const assets = (await readdir(join(dist, 'assets')))
    .filter((name) => name.endsWith('.js'))
    .sort();
  const all = [];
  for (const name of assets) all.push(await measureFile(dist, `assets/${name}`));
  return {
    files,
    initial: { ...sum(files), files: files.map((file) => file.name) },
    total: sum(all),
  };
}

/**
 * 예산 검사. 통과면 `undefined`, 아니면 한 줄 이유.
 * `budget`이 `undefined`(예산 파일 없음)면 통과하고, 파일이 있는데 값이 잘못되면 실패한다.
 */
export function budgetFailure(result, budget) {
  if (budget === undefined) return undefined;
  const max = budget?.initialJsGzipMax;
  if (typeof max !== 'number' || !Number.isFinite(max)) {
    return `예산 파일의 initialJsGzipMax가 유한한 숫자가 아닙니다: ${JSON.stringify(max) ?? '없음'}`;
  }
  if (result.initial.gzipBytes <= max) return undefined;
  return `첫 화면 JS gzip ${result.initial.gzipBytes}B가 예산 ${max}B를 넘었습니다.`;
}

/** 첫 화면 파일 이름에 `names` 중 하나가 들어 있으면 한 줄 이유. */
export function forbiddenFailure(result, names) {
  for (const name of names) {
    const hit = result.initial.files.find((file) => file.includes(name));
    if (hit !== undefined) return `첫 화면에 들어오면 안 되는 파일: ${hit} ('${name}')`;
  }
  return undefined;
}

function parseArgs(argv) {
  const options = { dist: 'dist', budget: 'perf-budget.json', forbid: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} 값이 없습니다.`);
    if (flag === '--dist') options.dist = value;
    else if (flag === '--budget') options.budget = value;
    else if (flag === '--forbid') options.forbid.push(value);
    else throw new Error(`알 수 없는 옵션: ${flag}`);
  }
  return options;
}

/** 예산 파일을 읽는다. 파일이 없으면 `{}`, 읽기·파싱에 실패하면 `{ failure }`. */
async function readBudget(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {}; // 예산 파일이 없으면 출력만 한다.
    return { failure: `예산 파일을 읽지 못했습니다(${path}): ${error?.message ?? error}` };
  }
  try {
    return { budget: JSON.parse(text) };
  } catch {
    return { failure: `예산 파일이 올바른 JSON이 아닙니다: ${path}` };
  }
}

/** 측정·검사. `{ result, failure }` — `failure`가 있으면 종료 코드 1. */
export async function run(argv = []) {
  const options = parseArgs(argv);
  const result = await measureBundle(options.dist);
  const { budget, failure: budgetReadFailure } = await readBudget(options.budget);
  const failure =
    budgetReadFailure ?? budgetFailure(result, budget) ?? forbiddenFailure(result, options.forbid);
  return { result, failure };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { result, failure } = await run(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (failure !== undefined) {
      console.error(failure);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
