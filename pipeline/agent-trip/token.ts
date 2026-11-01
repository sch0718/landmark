import { AGENT_TOKEN_PATTERN } from 'src/server/agent/tokens';

export type TokenDeps = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  execFile(cmd: string, args: string[]): Promise<{ stdout: string }>;
};
/** 환경변수를 우선하고 macOS에서만 셸 없이 키체인을 읽는다. */
export async function findToken(app: string, deps: TokenDeps): Promise<string | null> {
  const value = deps.env.LANDMARK_AGENT_TOKEN;
  if (value) return AGENT_TOKEN_PATTERN.test(value) ? value : null;
  if (deps.platform !== 'darwin') return null;
  try {
    const { stdout } = await deps.execFile('security', [
      'find-generic-password',
      '-s',
      'landmark-agent-token',
      '-a',
      new URL(app).host,
      '-w',
    ]);
    const token = stdout.trim();
    return AGENT_TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}
