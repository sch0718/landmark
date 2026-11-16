import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Win = { google?: { maps: { Map: unknown } }; gm_authFailure?: () => void };
const scripts = () => [...document.head.querySelectorAll('script')];
async function freshModule() {
  vi.resetModules();
  return import('src/components/map/load-google-sdk');
}
function complete() {
  (window as Win).google = { maps: { Map: class {} } };
  const callback = new URL(scripts()[0]!.src).searchParams.get('callback')!;
  (window as unknown as Record<string, () => void>)[callback]!();
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete (window as Win).google;
  delete (window as Win).gm_authFailure;
  scripts().forEach((s) => s.remove());
});

describe('loadGoogleSdk', () => {
  it('동시 호출은 스크립트 하나를 공유하고 onload 대신 콜백으로 끝난다', async () => {
    const { loadGoogleSdk } = await freshModule();
    const pending = loadGoogleSdk('a b&c');
    expect(loadGoogleSdk('a b&c')).toBe(pending);
    expect(scripts()).toHaveLength(1);
    const url = new URL(scripts()[0]!.src);
    expect(url.origin).toBe('https://maps.googleapis.com');
    expect(url.searchParams.get('key')).toBe('a b&c');
    expect(url.searchParams.get('loading')).toBe('async');
    expect(url.searchParams.get('v')).toBe('weekly');
    complete();
    await expect(pending).resolves.toBeUndefined();
    await loadGoogleSdk('key');
    expect(scripts()).toHaveLength(1);
  });
  it('인증 실패는 대기를 거절하고 구독자와 늦은 구독자에게 알린다', async () => {
    const { loadGoogleSdk, onGoogleAuthFailure, GOOGLE_AUTH_FAILURE_MESSAGE } = await freshModule();
    const cb = vi.fn();
    onGoogleAuthFailure(cb);
    const pending = expect(loadGoogleSdk('key')).rejects.toThrow(GOOGLE_AUTH_FAILURE_MESSAGE);
    (window as Win).gm_authFailure!();
    await pending;
    expect(cb).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    onGoogleAuthFailure(late)();
    expect(late).toHaveBeenCalledTimes(1);
    await expect(loadGoogleSdk('key')).rejects.toThrow('인증 실패');
  });
  it('로드 뒤 인증 실패도 알리고 해제된 구독자는 부르지 않는다', async () => {
    const { loadGoogleSdk, onGoogleAuthFailure } = await freshModule();
    const cb = vi.fn();
    const removed = vi.fn();
    onGoogleAuthFailure(cb);
    onGoogleAuthFailure(removed)();
    const pending = loadGoogleSdk('key');
    complete();
    await pending;
    (window as Win).gm_authFailure!();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
  it.each(['시간 초과', '로드 실패'])('%s면 스크립트를 지우고 재시도할 수 있다', async (reason) => {
    const { loadGoogleSdk } = await freshModule();
    const pending = expect(loadGoogleSdk('key')).rejects.toThrow(reason);
    const callback = new URL(scripts()[0]!.src).searchParams.get('callback')!;
    if (reason === '시간 초과') vi.advanceTimersByTime(10000);
    else scripts()[0]!.onerror!(new Event('error'));
    await pending;
    expect(scripts()).toHaveLength(0);
    const retry = loadGoogleSdk('key');
    // 이전 요청의 늦은 콜백이 새 요청을 끝내지 않는다.
    (window as unknown as Record<string, () => void>)[callback]?.();
    complete();
    await expect(retry).resolves.toBeUndefined();
  });
});
