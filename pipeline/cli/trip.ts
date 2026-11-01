import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { EXIT, TripFailure, type ExitCode } from '../agent-trip/errors';
import {
  failureJson,
  failureText,
  successJson,
  successText,
  type CommandName,
} from '../agent-trip/output';
import { planJsonSchema } from '../agent-trip/plan-schema';
import { pickApp, runBuild, type BuildDeps } from '../agent-trip/run-build';

export type CliDeps = BuildDeps & {
  env: NodeJS.ProcessEnv;
  stdout(text: string): void;
  stderr(text: string): void;
};

function commandName(value: string | undefined): CommandName | undefined {
  switch (value) {
    case 'build':
    case 'send':
    case 'share':
    case 'whoami':
    case 'unshare':
      return value;
    default:
      return undefined;
  }
}

function inputFailure(message: string): never {
  throw new TripFailure([{ path: '', code: 'schema', message }], EXIT.input);
}

function parseCliArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        memo: { type: 'boolean' },
        'no-routes': { type: 'boolean' },
        out: { type: 'string' },
        app: { type: 'string' },
        json: { type: 'boolean' },
        schema: { type: 'boolean' },
      },
    });
  } catch {
    inputFailure('명령 인자와 옵션을 확인해 주세요');
  }
}

/** 인자를 해석해 실행하고 끝 코드를 돌려준다. 출력은 주입한 함수만 쓴다. */
export async function main(argv: string[], deps: CliDeps): Promise<ExitCode> {
  let json = argv.includes('--json');
  let command: CommandName = 'build';
  try {
    const parsed = parseCliArgs(argv);
    const { values, positionals } = parsed;
    json = values.json ?? false;
    command = commandName(positionals[0]) ?? 'build';
    if (values.schema) {
      if (
        positionals.length > 0 ||
        Object.keys(values).some((key) => !['schema', 'json'].includes(key))
      )
        inputFailure('--schema는 다른 명령·옵션 없이 써 주세요');
      deps.stdout(JSON.stringify(planJsonSchema()) + '\n');
      return EXIT.ok;
    }
    const name = commandName(positionals[0]);
    if (name === undefined)
      inputFailure(
        '사용법: yarn trip build <plan.json> [--memo] [--no-routes] [--out <파일>] [--app <주소>] 또는 yarn --silent trip --schema',
      );
    if (name !== 'build') inputFailure('다음 버전에서 쓸 수 있어요');
    if (positionals.length !== 2 || !positionals[1])
      inputFailure('build에 계획 파일 하나를 적어 주세요');
    const initCwd = deps.env.INIT_CWD;
    const resolveFile = (path: string) => (initCwd ? resolve(initCwd, path) : path);
    const r = await runBuild(
      {
        file: resolveFile(positionals[1]),
        includeMemo: values.memo ?? false,
        noRoutes: values['no-routes'] ?? false,
        app: pickApp(values.app, deps.env, false),
        out: values.out === undefined ? undefined : resolveFile(values.out),
      },
      deps,
    );
    deps.stdout((json ? successJson(command, r, {}) : successText(command, r, {})) + '\n');
    return EXIT.ok;
  } catch (error) {
    const failure =
      error instanceof TripFailure
        ? error
        : new TripFailure(
            [{ path: '', code: 'internal', message: '일정을 만드는 중 내부 오류가 생겼어요' }],
            EXIT.internal,
          );
    if (json) deps.stdout(failureJson(command, failure.issues) + '\n');
    else deps.stderr(failureText(failure.issues) + '\n');
    return failure.exit;
  }
}

function nodeDeps(): CliDeps {
  return {
    fetch: globalThis.fetch,
    sleep: async (ms) => {
      await setTimeout(ms);
    },
    now: () => new Date(),
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, text) => writeFile(path, text, 'utf8'),
    env: process.env,
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2), nodeDeps());
