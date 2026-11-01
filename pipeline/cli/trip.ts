import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { SHORT_ID_PATTERN, shortKeepUntil } from 'src/domain/share/short-link';
import { encryptShareHash, newDeleteToken } from 'src/services/share-short/crypto';
import { createAgentClient, requestKey, type AgentReply } from '../agent-trip/client';
import {
  EXIT,
  exitFor,
  TripFailure,
  type ExitCode,
  type TripErrorCode,
  type TripIssue,
} from '../agent-trip/errors';
import {
  failureJson,
  failureText,
  successJson,
  successText,
  type CommandName,
} from '../agent-trip/output';
import { planJsonSchema } from '../agent-trip/plan-schema';
import { pickApp, runBuild, type BuildDeps } from '../agent-trip/run-build';
import { readShares, removeShare, reserveShare, settleShare } from '../agent-trip/share-store';
import { findToken, type TokenDeps } from '../agent-trip/token';

export type CliDeps = BuildDeps & {
  env: NodeJS.ProcessEnv;
  stdout(text: string): void;
  stderr(text: string): void;
  platform?: NodeJS.Platform;
  execFile?: TokenDeps['execFile'];
  home?: string;
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
        'no-memo': { type: 'boolean' },
        list: { type: 'boolean' },
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

function fail(code: TripErrorCode, message: string): never {
  throw new TripFailure([{ path: '', code, message }], exitFor(code));
}
function unwrap<T>(reply: AgentReply<T>): T {
  if (!reply.ok) throw new TripFailure([reply.issue], exitFor(reply.issue.code));
  return reply.data;
}
const storeWarning = (): TripIssue => ({
  path: '',
  code: 'share-store',
  message: '이 링크는 기한까지 지울 수 없어요',
});

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
        '사용법: yarn trip build|send|share <plan.json>, whoami, unshare <id>|--list [--app <주소>] [--json] 또는 yarn --silent trip --schema',
      );
    const commandOptions: Record<CommandName, string[]> = {
      build: ['memo', 'no-routes', 'out'],
      send: ['no-memo', 'no-routes'],
      share: ['memo', 'no-routes'],
      whoami: [],
      unshare: ['list'],
    };
    if (Object.keys(values).some((key) => !['app', 'json', ...commandOptions[name]].includes(key)))
      inputFailure('이 명령에서 받지 않는 옵션이에요');
    const withoutArgument = name === 'whoami' || (name === 'unshare' && values.list);
    if (positionals.length !== (withoutArgument ? 1 : 2) || (!withoutArgument && !positionals[1]))
      inputFailure('명령에 필요한 인자를 확인해 주세요');
    if (name === 'unshare' && !values.list && !SHORT_ID_PATTERN.test(positionals[1]!))
      fail('unknown-share', '이 앱에서 만든 공유 링크를 찾지 못했어요');
    const app = pickApp(values.app, deps.env, name !== 'build');
    const store = {
      home: deps.env.LANDMARK_TRIP_HOME || deps.home || join(homedir(), '.landmark'),
      now: deps.now,
    };
    const print = (r: Parameters<typeof successJson>[1], extra: Record<string, unknown>) => {
      deps.stdout((json ? successJson(command, r, extra) : successText(command, r, extra)) + '\n');
    };
    if (name === 'unshare' && values.list) {
      const shares = (await readShares(store))
        .filter((x) => x.app === app)
        .map(({ id, title, createdAt, expiresAt }) => ({ id, title, createdAt, expiresAt }));
      print(null, { shares });
      return EXIT.ok;
    }
    let client: ReturnType<typeof createAgentClient> | undefined;
    if (name !== 'build') {
      const token = await findToken(app, {
        env: deps.env,
        platform: deps.platform ?? process.platform,
        execFile:
          deps.execFile ??
          (async () => {
            throw new Error('키체인 실행기가 없어요');
          }),
      });
      if (token === null)
        fail(
          'no-token',
          '토큰이 없어요. 설정 › 동기화 › AI 연결에서 만든 뒤 LANDMARK_AGENT_TOKEN 또는 키체인에 넣어 주세요',
        );
      client = createAgentClient(app, token, { fetch: deps.fetch });
    }
    if (name === 'whoami') {
      const info = unwrap(await client!.whoami());
      const days = Math.ceil((info.expiresAt - deps.now().getTime()) / 86_400_000);
      const warnings: TripIssue[] =
        days <= 14
          ? [{ path: '', code: 'token-expiring', message: `${Math.max(0, days)}일 뒤 만료돼요` }]
          : [];
      print(null, {
        connection: {
          name: info.name,
          scopes: info.scopes,
          expiresAt: new Date(info.expiresAt).toISOString(),
          provider: info.provider,
        },
        warnings,
      });
      return EXIT.ok;
    }
    if (name === 'unshare') {
      const item = (await readShares(store)).find((x) => x.app === app && x.id === positionals[1]);
      if (!item) fail('unknown-share', '이 앱에서 만든 공유 링크를 찾지 못했어요');
      unwrap(await client!.deleteShare(item.id, item.deleteToken));
      await removeShare(app, item.id, store);
      print(null, { removed: { id: item.id } });
      return EXIT.ok;
    }
    const initCwd = deps.env.INIT_CWD;
    const resolveFile = (path: string) => (initCwd ? resolve(initCwd, path) : path);
    const r = await runBuild(
      {
        file: resolveFile(positionals[1]!),
        includeMemo: name === 'send' ? !values['no-memo'] : (values.memo ?? false),
        noRoutes: values['no-routes'] ?? false,
        app,
        out: values.out === undefined ? undefined : resolveFile(values.out),
      },
      deps,
    );
    if (name === 'send') {
      const inbox = unwrap(
        await client!.sendInbox({
          v: 1,
          key: await requestKey(r.plan, !values['no-memo']),
          d: r.doc.importHash,
        }),
      );
      print(r, {
        inbox: {
          id: inbox.id,
          expiresAt: new Date(inbox.expiresAt).toISOString(),
          created: inbox.created,
        },
      });
    } else if (name === 'share') {
      const reservation = await reserveShare(store, r.doc.doc.trips[0]!.title);
      if (reservation === null)
        fail(
          'share-store-full',
          '저장한 공유 링크가 200개예요. 기존 링크를 지우거나 만료 뒤 다시 해 주세요',
        );
      let settled = false;
      try {
        const encrypted = await encryptShareHash(r.doc.viewHash);
        const deleteToken = newDeleteToken();
        const share = unwrap(
          await client!.createShare({
            body: encrypted.body,
            kind: 'trip',
            keepUntil: shortKeepUntil([r.plan.endDate]) ?? undefined,
            deleteToken,
          }),
        );
        try {
          await settleShare(store, reservation, {
            app,
            id: share.id,
            deleteToken,
            title: r.doc.doc.trips[0]!.title,
            createdAt: deps.now().toISOString(),
            expiresAt: share.expiresAt,
          });
        } catch {
          r.warnings.push(storeWarning());
        }
        settled = true;
        print(r, {
          links: { short: `${app}/s/${share.id}#k=${encrypted.key}`, view: r.doc.view },
          share: { id: share.id, expiresAt: share.expiresAt },
        });
      } finally {
        if (!settled) {
          try {
            await settleShare(store, reservation, null);
          } catch {
            deps.stderr(`경고: ${storeWarning().message}\n`);
          }
        }
      }
    } else print(r, {});
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
    platform: process.platform,
    execFile: promisify(execFile),
    home: join(homedir(), '.landmark'),
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
