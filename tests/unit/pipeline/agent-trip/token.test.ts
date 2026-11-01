// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { findToken, type TokenDeps } from '../../../../pipeline/agent-trip/token';

const app = 'https://landmark.sch0718.dev';
const newToken = () => 'lmk_' + randomBytes(32).toString('base64url');
function setup(env: NodeJS.ProcessEnv = {}, platform: NodeJS.Platform = 'darwin') {
  return { env, platform, execFile: vi.fn<TokenDeps['execFile']>() };
}
describe('CLI 토큰 찾기', () => {
  it('환경변수를 우선하고 키체인을 부르지 않는다', async () => {
    const token = newToken();
    const deps = setup({ LANDMARK_AGENT_TOKEN: token });
    const found = await findToken(app, deps);
    expect(found?.token === token).toBe(true);
    expect(found?.source).toBe('env');
    expect(deps.execFile).not.toHaveBeenCalled();
  });
  it.each([
    [app, 'landmark.sch0718.dev'],
    ['http://localhost:8798', 'localhost:8798'],
  ])('darwin 키체인에서 %s의 host를 계정으로 쓰고 stdout을 trim한다', async (url, host) => {
    const token = newToken();
    const deps = setup({ LANDMARK_AGENT_TOKEN: '' });
    deps.execFile.mockResolvedValue({ stdout: ` ${token}\n` });
    const found = await findToken(url, deps);
    expect(found?.token === token).toBe(true);
    expect(found?.source).toBe('keychain');
    expect(deps.execFile).toHaveBeenCalledExactlyOnceWith('security', [
      'find-generic-password',
      '-s',
      'landmark-agent-token',
      '-a',
      host,
      '-w',
    ]);
  });
  it.each(['linux', 'win32'] as const)('%s에서는 키체인을 부르지 않는다', async (platform) => {
    const deps = setup({}, platform);
    expect(await findToken(app, deps)).toBeNull();
    expect(deps.execFile).not.toHaveBeenCalled();
  });
  it('비어 있지 않은 환경변수가 패턴과 다르면 키체인으로 넘어가지 않는다', async () => {
    const deps = setup({ LANDMARK_AGENT_TOKEN: randomBytes(8).toString('hex') });
    expect(await findToken(app, deps)).toBeNull();
    expect(deps.execFile).not.toHaveBeenCalled();
  });
  it('키체인의 잘못된 값과 실행 실패를 null로 돌려준다', async () => {
    const deps = setup();
    deps.execFile.mockResolvedValue({ stdout: randomBytes(8).toString('hex') });
    expect(await findToken(app, deps)).toBeNull();
    deps.execFile.mockRejectedValue(new Error(newToken()));
    expect(await findToken(app, deps)).toBeNull();
  });
});
