import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitPort = {
  /** `git fetch`. 성공 여부를 돌려주며 실패해도 던지지 않는다. */
  fetch(): Promise<boolean>;
  /** 현재 브랜치가 upstream보다 뒤처진 커밋 수. upstream이 없으면 0. */
  behindCount(): Promise<number>;
};

export function createShellGitPort(
  cwd: string,
  warn: (line: string) => void = (line) => console.warn(line),
  env: NodeJS.ProcessEnv = process.env,
): GitPort {
  const git = async (...args: string[]): Promise<string> =>
    (await execFileAsync('git', args, { cwd, env })).stdout;

  return {
    async fetch() {
      try {
        await git('fetch', '--quiet');
        return true;
      } catch {
        return false;
      }
    },
    async behindCount() {
      try {
        await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
      } catch {
        warn('경고: 현재 브랜치에 upstream이 없어 원격과 비교하지 못했습니다.');
        return 0;
      }
      const count = Number.parseInt((await git('rev-list', '--count', 'HEAD..@{u}')).trim(), 10);
      if (!Number.isInteger(count)) throw new Error('git rev-list 결과를 읽지 못했습니다');
      return count;
    },
  };
}
