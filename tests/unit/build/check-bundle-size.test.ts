import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialScriptPaths, measureBundle, run } from '../../../scripts/check-bundle-size.mjs';

const script = join(process.cwd(), 'scripts/check-bundle-size.mjs');
const contents = {
  'entry-AAA.js': 'export const entry = "' + 'e'.repeat(400) + '";\n',
  'vendor-BBB.js': 'export const vendor = "' + 'v'.repeat(900) + '";\n',
  'react-CCC.js': 'export const react = "' + 'r'.repeat(600) + '";\n',
  'later-DDD.js': 'export const later = "' + 'l'.repeat(1500) + '";\n',
};
const html = `<!doctype html>
<html><head>
<script type="module" crossorigin src="/assets/entry-AAA.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-BBB.js">
<link rel="modulepreload" crossorigin href="/assets/react-CCC.js">
<link rel="stylesheet" crossorigin href="/assets/index-EEE.css">
</head><body><div id="root"></div></body></html>`;

const gzip = (text: string) => gzipSync(Buffer.from(text)).length;
const initialNames = ['entry-AAA.js', 'vendor-BBB.js', 'react-CCC.js'] as const;
const initialGzip = initialNames.reduce((n, name) => n + gzip(contents[name]), 0);
const totalGzip = Object.values(contents).reduce((n, text) => n + gzip(text), 0);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'check-bundle-size-'));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), html);
  await writeFile(join(dir, 'assets/index-EEE.css'), 'body{margin:0}');
  for (const [name, text] of Object.entries(contents)) {
    await writeFile(join(dir, 'assets', name), text);
  }
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeBudget(initialJsGzipMax: number) {
  const path = join(dir, 'perf-budget.json');
  await writeFile(path, JSON.stringify({ initialJsGzipMax }));
  return path;
}

describe('initialScriptPaths', () => {
  it('module 스크립트와 modulepreload만 dist 기준 경로로 돌려준다', () => {
    expect(initialScriptPaths(html)).toEqual([
      'assets/entry-AAA.js',
      'assets/vendor-BBB.js',
      'assets/react-CCC.js',
    ]);
  });

  it('속성 순서가 달라도, 같은 파일이 두 번 나와도 한 번만 센다', () => {
    const swapped = `<link href="/assets/a.js" rel="modulepreload"><script src="/assets/a.js" type="module"></script><script src="/assets/classic.js"></script>`;
    expect(initialScriptPaths(swapped)).toEqual(['assets/a.js']);
  });
});

describe('measureBundle', () => {
  it('첫 화면은 진입+modulepreload의 합, 전체는 assets의 모든 JS 합', async () => {
    const result = await measureBundle(dir);
    expect(result.files.map((file) => file.name)).toEqual(initialNames.map((n) => `assets/${n}`));
    expect(result.initial.bytes).toBe(
      initialNames.reduce((n, name) => n + contents[name].length, 0),
    );
    expect(result.initial.gzipBytes).toBe(initialGzip);
    expect(result.initial.files).toHaveLength(3);
    expect(result.total.bytes).toBe(
      Object.values(contents).reduce((n, text) => n + text.length, 0),
    );
    expect(result.total.gzipBytes).toBe(totalGzip);
    expect(result.assets).toEqual(
      Object.keys(contents)
        .map((n) => `assets/${n}`)
        .sort(),
    );
  });
});

describe('run', () => {
  it('예산 초과면 실패 이유를 낸다', async () => {
    const { failure } = await run(['--dist', dir, '--budget', await writeBudget(initialGzip - 1)]);
    expect(failure).toContain(String(initialGzip));
  });

  it('예산 이하면 통과한다', async () => {
    const { failure } = await run(['--dist', dir, '--budget', await writeBudget(initialGzip)]);
    expect(failure).toBeUndefined();
  });

  it('예산 파일이 없으면 출력만 하고 통과한다', async () => {
    const { result, failure } = await run(['--dist', dir, '--budget', join(dir, 'none.json')]);
    expect(failure).toBeUndefined();
    expect(result.initial.gzipBytes).toBe(initialGzip);
  });

  it.each([
    ['키가 없다', '{}', 'initialJsGzipMax'],
    ['키 이름이 틀렸다', '{"initialJsGzipmax": 100000}', 'initialJsGzipMax'],
    ['값이 문자열이다', '{"initialJsGzipMax": "100000"}', 'initialJsGzipMax'],
    ['값이 null이다', '{"initialJsGzipMax": null}', 'initialJsGzipMax'],
    ['JSON이 아니다', '{ not json', 'JSON'],
  ])('예산 파일이 있는데 %s: 실패', async (_name, body, reason) => {
    const path = join(dir, 'bad-budget.json');
    await writeFile(path, body);
    const { result, failure } = await run(['--dist', dir, '--budget', path]);
    expect(failure).toContain(reason);
    expect(result.initial.gzipBytes).toBe(initialGzip);
  });

  it('--forbid: 첫 화면에 없는 이름은 통과, 있는 이름은 실패', async () => {
    const none = join(dir, 'none.json');
    expect(
      (await run(['--dist', dir, '--budget', none, '--forbid', 'later'])).failure,
    ).toBeUndefined();
    expect((await run(['--dist', dir, '--budget', none, '--forbid', 'entry'])).failure).toContain(
      'entry',
    );
  });
});

describe('--require-lazy', () => {
  const none = () => join(dir, 'none.json');

  it('assets에 있고 첫 화면에는 없는 이름은 통과', async () => {
    const { failure } = await run(['--dist', dir, '--budget', none(), '--require-lazy', 'later']);
    expect(failure).toBeUndefined();
  });

  it('첫 화면 목록에 있으면 실패하고 이유에 이름과 파일이 나온다', async () => {
    const { failure } = await run(['--dist', dir, '--budget', none(), '--require-lazy', 'entry']);
    expect(failure).toContain('entry');
    expect(failure).toContain('assets/entry-AAA.js');
  });

  it('dist/assets에 그 이름의 파일이 없으면 실패한다(진입에 합쳐진 경우)', async () => {
    const { failure } = await run(['--dist', dir, '--budget', none(), '--require-lazy', 'Missing']);
    expect(failure).toContain('Missing');
  });

  it('이름 뒤에 해시 구분자(-)가 와야 한다: 접두어만 같은 파일은 인정하지 않는다', async () => {
    await writeFile(join(dir, 'assets/laterOther-FFF.js'), 'export const x = 1;\n');
    const { failure } = await run(['--dist', dir, '--budget', none(), '--require-lazy', 'lat']);
    expect(failure).toContain('lat');
  });

  it('여러 번 줄 수 있고 하나라도 어기면 실패한다', async () => {
    const ok = await run(['--dist', dir, '--budget', none(), '--require-lazy', 'later']);
    expect(ok.failure).toBeUndefined();
    const bad = await run([
      '--dist',
      dir,
      '--budget',
      none(),
      '--require-lazy',
      'later',
      '--require-lazy',
      'Missing',
    ]);
    expect(bad.failure).toContain('Missing');
  });
});

describe('스크립트로 실행', () => {
  const exec = promisify(execFile);

  it('예산 초과면 종료 코드 1, 아니면 JSON을 내고 0', async () => {
    const over = await exec('node', [
      script,
      '--dist',
      dir,
      '--budget',
      await writeBudget(1),
    ]).catch((error) => error as { code: number; stderr: string });
    expect(over).toMatchObject({ code: 1 });
    expect((over as { stderr: string }).stderr).toContain('예산');

    const bad = join(dir, 'bad-budget.json');
    await writeFile(bad, '{"initialJsGzipMax": "1000000"}');
    const invalid = await exec('node', [script, '--dist', dir, '--budget', bad]).catch(
      (error) => error as { code: number },
    );
    expect(invalid).toMatchObject({ code: 1 });

    const ok = await exec('node', [script, '--dist', dir, '--budget', await writeBudget(1e6)]);
    expect(JSON.parse(ok.stdout).initial.gzipBytes).toBe(initialGzip);

    const lazy = await exec('node', [
      script,
      '--dist',
      dir,
      '--budget',
      join(dir, 'none.json'),
      '--require-lazy',
      'Missing',
    ]).catch((error) => error as { code: number; stderr: string });
    expect(lazy).toMatchObject({ code: 1 });
    expect((lazy as { stderr: string }).stderr).toContain('Missing');
  });
});
