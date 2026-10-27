import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Options = {
  callback(token: string): void;
  'error-callback'(): void;
  'expired-callback'(): void;
  'timeout-callback'(): void;
};
let options: Options;
const widget = () => ({
  render: vi.fn((_container: HTMLElement, input: Options) => {
    options = input;
    return 'widget';
  }),
  execute: vi.fn(),
  remove: vi.fn(),
});
let api: ReturnType<typeof widget>;
const script = () =>
  document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]');
async function load() {
  vi.stubGlobal('turnstile', api);
  script()!.dispatchEvent(new Event('load'));
  await Promise.resolve();
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'public-test-key');
  api = widget();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  script()?.remove();
  document.querySelectorAll('[data-meet-turnstile]').forEach((node) => node.remove());
});

describe('Turnstile 지연 로딩', () => {
  it('공개 사이트 키가 없으면 스크립트 없이 dev를 돌려준다', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    const { getTurnstileToken } = await import('src/services/meet-online/turnstile-loader');
    expect(script()).toBeNull();
    expect(await getTurnstileToken()).toBe('dev');
    expect(script()).toBeNull();
  });

  it('호출할 때 한 번만 스크립트를 넣고 보이지 않는 위젯을 실행·정리한다', async () => {
    const { getTurnstileToken } = await import('src/services/meet-online/turnstile-loader');
    expect(script()).toBeNull();
    const first = getTurnstileToken();
    expect(script()?.src).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    );
    await load();
    const container = api.render.mock.calls[0]![0];
    expect(container.isConnected).toBe(true);
    expect(api.render).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        sitekey: 'public-test-key',
        execution: 'execute',
      }),
    );
    expect(api.execute).toHaveBeenCalledWith('widget');
    options.callback('first-token');
    expect(await first).toBe('first-token');
    expect(api.remove).toHaveBeenCalledWith('widget');
    expect(container.isConnected).toBe(false);
    const second = getTurnstileToken();
    await Promise.resolve();
    options.callback('second-token');
    expect(await second).toBe('second-token');
    expect(document.querySelectorAll('script[src*="challenges.cloudflare.com"]')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('보이지 않는 방식은 사이트 키 설정을 쓰고 지원하지 않는 크기 값을 보내지 않는다', async () => {
    const { getTurnstileToken } = await import('src/services/meet-online/turnstile-loader');
    const promise = getTurnstileToken();
    await load();
    expect(api.render.mock.calls[0]![1]).not.toHaveProperty('size', 'invisible');
    options.callback('invisible-token');
    expect(await promise).toBe('invisible-token');
  });

  it.each(['error-callback', 'expired-callback', 'timeout-callback'] as const)(
    '%s면 거절하고 위젯을 정리한다',
    async (callback) => {
      const { getTurnstileToken } = await import('src/services/meet-online/turnstile-loader');
      const promise = getTurnstileToken();
      const rejected = expect(promise).rejects.toThrow();
      await load();
      options[callback]();
      await rejected;
      expect(api.remove).toHaveBeenCalled();
      expect(document.querySelector('[data-meet-turnstile]')).toBeNull();
    },
  );

  it('스크립트 오류는 거절하고 다음 호출에서 다시 시도한다', async () => {
    const { getTurnstileToken } = await import('src/services/meet-online/turnstile-loader');
    const first = getTurnstileToken();
    const rejected = expect(first).rejects.toThrow();
    script()!.dispatchEvent(new Event('error'));
    await rejected;
    const second = getTurnstileToken();
    await load();
    options.callback('retry-token');
    expect(await second).toBe('retry-token');
  });

  it.each([false, true])(
    '스크립트 또는 위젯 대기가 30초를 넘으면 거절한다 (로드=%s)',
    async (loaded) => {
      const { getTurnstileToken } = await import('src/services/meet-online/turnstile-loader');
      const promise = getTurnstileToken();
      const rejected = expect(promise).rejects.toThrow();
      if (loaded) await load();
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      expect(document.querySelector('[data-meet-turnstile]')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
