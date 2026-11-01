// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { main, type CliDeps } from '../../../../pipeline/cli/trip';
import { EXIT } from '../../../../pipeline/agent-trip/errors';
import { commandOptions, helpText } from '../../../../pipeline/agent-trip/help';

function setup() {
  const deps = {
    env: {},
    platform: 'darwin',
    fetch: vi.fn<CliDeps['fetch']>(),
    readFile: vi.fn<CliDeps['readFile']>(),
    writeFile: vi.fn<CliDeps['writeFile']>(),
    sleep: vi.fn<CliDeps['sleep']>(),
    execFile: vi.fn<NonNullable<CliDeps['execFile']>>(),
    now: vi.fn(() => new Date('2026-11-02T00:00:00Z')),
    stdout: vi.fn<CliDeps['stdout']>(),
    stderr: vi.fn<CliDeps['stderr']>(),
  } satisfies CliDeps;
  return {
    deps,
    stdout: () => deps.stdout.mock.calls.map(([s]) => s).join(''),
    stderr: () => deps.stderr.mock.calls.map(([s]) => s).join(''),
  };
}

describe('여행 CLI 도움말', () => {
  it('도움말은 80열 안팎에서 읽을 수 있다', () => {
    for (const line of helpText().split('\n')) {
      const width = [...line].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 2 : 1), 0);
      expect(width, line).toBeLessThanOrEqual(86);
    }
  });
  it.each([
    ['--help'],
    ['-h'],
    ['--help', '--json'],
    ['build', '--bogus', '--help'],
    ['--schema', '--help'],
    ['foo', '--help'],
    ['--app', '잘못된 주소', '--out', 'x.json', '--help', 'send'],
    ['--bogus', '-h', 'share'],
    ['whoami', '--help', '--out'],
  ])('도움말 %j는 검사·파일·네트워크·토큰보다 먼저 처리한다', async (...argv) => {
    const { deps, stdout, stderr } = setup();
    expect(await main(argv, deps)).toBe(EXIT.ok);
    expect(stdout()).toContain('사용법: yarn trip ');
    expect(stdout()).toContain('docs/development.md');
    expect(stdout().endsWith('\n')).toBe(true);
    expect(stderr()).toBe('');
    expect(deps.readFile).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.execFile).not.toHaveBeenCalled();
    expect(deps.now).not.toHaveBeenCalled();
  });

  it.each(Object.entries(commandOptions))(
    '%s 도움말에는 해당 명령의 옵션만 나온다',
    async (cmd, options) => {
      const { deps, stdout } = setup();
      expect(await main([cmd, '--help'], deps)).toBe(EXIT.ok);
      expect(stdout()).toContain(`사용법: yarn trip ${cmd}`);
      for (const option of [...options, 'app', 'json']) expect(stdout()).toContain(`--${option}`);
      const otherOptions = new Set(
        Object.values(commandOptions)
          .flat()
          .filter((o) => !options.includes(o)),
      );
      for (const option of otherOptions) expect(stdout()).not.toMatch(new RegExp(`--${option}\\b`));
      if (cmd === 'unshare') {
        expect(stdout()).toContain('unshare <id>');
        expect(stdout()).toContain('unshare --list');
      }
    },
  );

  it('전체 도움말에는 모든 명령·옵션·스키마·끝 코드가 나온다', async () => {
    const { deps, stdout } = setup();
    await main(['--help'], deps);
    expect(stdout()).toBe(helpText());
    expect(stdout()).toContain('yarn trip <명령> [옵션]');
    expect(stdout()).toContain('yarn --silent trip --schema');
    for (const cmd of Object.keys(commandOptions)) expect(stdout()).toContain(cmd);
    for (const option of Object.values(commandOptions).flat())
      expect(stdout()).toContain(`--${option}`);
    expect(stdout()).toContain('--app <주소>');
    expect(stdout()).toContain('--out <doc.json>');
    expect(stdout()).toContain('-h, --help');
    for (const [code, meaning] of [
      [EXIT.ok, '성공'],
      [EXIT.internal, '내부 오류'],
      [EXIT.input, '입력 오류'],
      [EXIT.lookup, '장소 조회 실패·후보 여럿'],
      [EXIT.auth, '토큰·계정·권한'],
      [EXIT.server, '서버 거절·장애'],
    ] as const)
      expect(stdout()).toMatch(new RegExp(`${code} +${meaning}`));
    expect(stdout().trimEnd().split('\n').at(-1)).toContain('docs/development.md');
  });

  it.each([
    ['--app', 'https://landmark.sch0718.dev', '-h', 'send'],
    ['--out', 'send', '--help', 'build'],
    ['foo', 'send', '--help'],
    ['--schema', '--help'],
  ])('첫 명령 자리로 도움말 종류를 정한다: %j', async (...argv) => {
    const { deps, stdout } = setup();
    expect(await main(argv, deps)).toBe(EXIT.ok);
    const expected = argv[0] === '--app' ? 'send' : argv[0] === '--out' ? 'build' : '<명령>';
    expect(stdout()).toContain(`사용법: yarn trip ${expected}`);
  });

  it.each([
    ['--app', '--help', 'build', 'x.json'],
    ['build', 'x.json', '--out', '--help'],
    ['--app', '-h', 'build', 'x.json'],
  ])('값 자리의 도움말 모양 %j는 기존 입력 오류다', async (...argv) => {
    const { deps, stdout, stderr } = setup();
    expect(await main(argv, deps)).toBe(EXIT.input);
    expect(stdout()).toBe('');
    expect(stderr()).toContain('오류 (schema)');
    expect(stderr()).not.toContain('docs/development.md');
  });

  it.each([[], ['foo'], ['--app', 'https://landmark.sch0718.dev']])(
    '명령이 없는 %j는 표준 오류에 오류와 전체 도움말을 쓴다',
    async (...argv) => {
      const { deps, stdout, stderr } = setup();
      expect(await main(argv, deps)).toBe(EXIT.input);
      expect(stdout()).toBe('');
      expect(stderr()).toMatch(/^오류 \(schema\).*\n\n사용법: yarn trip <명령>/);
      expect(stderr()).toContain('docs/development.md');
    },
  );

  it.each([['--json'], ['foo', '--json']])(
    '명령이 없는 JSON %j는 기존 봉투에 도움말 위치만 더한다',
    async (...argv) => {
      const { deps, stdout, stderr } = setup();
      expect(await main(argv, deps)).toBe(EXIT.input);
      expect(JSON.parse(stdout())).toMatchObject({
        ok: false,
        command: 'build',
        errors: [
          {
            code: 'schema',
            path: '',
            message: expect.stringMatching(/ \(자세한 사용법: yarn trip --help\)$/),
          },
        ],
      });
      expect(stderr()).toBe('');
    },
  );
});
