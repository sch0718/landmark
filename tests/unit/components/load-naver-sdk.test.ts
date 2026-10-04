import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Win = { naver?: { maps?: unknown }; navermap_authFailure?: () => void };
const scripts = () => Array.from(document.head.querySelectorAll('script'));

async function freshModule() {
  vi.resetModules();
  return await import('src/components/map/load-naver-sdk');
}
async function freshLoader() {
  return (await freshModule()).loadNaverSdk;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as Win).naver;
  delete (window as Win).navermap_authFailure;
  document.head.querySelectorAll('script').forEach((s) => s.remove());
});

describe('loadNaverSdk', () => {
  it('src에 ncpKeyId=<인코딩된 id>를 쓴다', async () => {
    const load = await freshLoader();
    const p = load('a b&c');
    const assertion = expect(p).rejects.toThrow();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]!.src).toBe(
      `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent('a b&c')}`,
    );
    vi.advanceTimersByTime(10000);
    await assertion;
  });

  it('onload 후 naver.maps가 있으면 resolve한다', async () => {
    const load = await freshLoader();
    const p = load('id');
    (window as Win).naver = { maps: {} };
    scripts()[0]!.onload!(new Event('load'));
    await expect(p).resolves.toBeUndefined();
  });

  it('기본 10000ms 안에 끝나지 않으면 reject한다', async () => {
    const load = await freshLoader();
    const p = load('id');
    const assertion = expect(p).rejects.toThrow('시간 초과');
    vi.advanceTimersByTime(9999);
    expect(scripts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await assertion;
    expect(scripts()).toHaveLength(0);
  });

  it('onerror면 reject한다', async () => {
    const load = await freshLoader();
    const p = load('id');
    const assertion = expect(p).rejects.toThrow('로드 실패');
    scripts()[0]!.onerror!(new Event('error'));
    await assertion;
  });

  it('onload인데 naver.maps가 없으면 reject한다', async () => {
    const load = await freshLoader();
    const p = load('id');
    const assertion = expect(p).rejects.toThrow('초기화되지 않았어요');
    scripts()[0]!.onload!(new Event('load'));
    await assertion;
  });

  it('동시 호출은 같은 promise와 스크립트 하나를 공유한다', async () => {
    const load = await freshLoader();
    const p1 = load('id');
    const p2 = load('id');
    expect(p2).toBe(p1);
    expect(scripts()).toHaveLength(1);
    (window as Win).naver = { maps: {} };
    scripts()[0]!.onload!(new Event('load'));
    await p1;
  });

  it('이미 로드돼 있으면 스크립트를 추가하지 않는다', async () => {
    const load = await freshLoader();
    (window as Win).naver = { maps: {} };
    await expect(load('id')).resolves.toBeUndefined();
    expect(scripts()).toHaveLength(0);
  });

  it('실패 뒤 재시도하면 새 스크립트를 넣는다', async () => {
    const load = await freshLoader();
    const p1 = load('id');
    const first = expect(p1).rejects.toThrow();
    scripts()[0]!.onerror!(new Event('error'));
    await first;
    const p2 = load('id');
    expect(p2).not.toBe(p1);
    expect(scripts()).toHaveLength(1);
    (window as Win).naver = { maps: {} };
    scripts()[0]!.onload!(new Event('load'));
    await expect(p2).resolves.toBeUndefined();
  });

  it('스크립트를 넣기 전에 navermap_authFailure를 정의한다', async () => {
    const load = await freshLoader();
    const p = load('id');
    expect(typeof (window as Win).navermap_authFailure).toBe('function');
    (window as Win).naver = { maps: {} };
    scripts()[0]!.onload!(new Event('load'));
    await p;
  });

  it('로드 대기 중 인증 실패(navermap_authFailure)면 reject하고 이후 호출도 reject한다', async () => {
    const { loadNaverSdk, onNaverAuthFailure } = await freshModule();
    const cb = vi.fn();
    onNaverAuthFailure(cb);
    const p = loadNaverSdk('id');
    const assertion = expect(p).rejects.toThrow('인증 실패');
    (window as Win).naver = { maps: {} };
    (window as Win).navermap_authFailure!();
    await assertion;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(scripts()).toHaveLength(0);
    // 뒤늦은 onload는 무시한다.
    vi.advanceTimersByTime(10000);
    await expect(loadNaverSdk('id')).rejects.toThrow('인증 실패');
  });

  it('로드가 끝난 뒤 인증 실패면 등록한 콜백을 부르고, 늦게 등록해도 바로 부른다', async () => {
    const { loadNaverSdk, onNaverAuthFailure } = await freshModule();
    const cb = vi.fn();
    const unsubscribe = onNaverAuthFailure(cb);
    const removed = vi.fn();
    onNaverAuthFailure(removed)();
    const p = loadNaverSdk('id');
    (window as Win).naver = { maps: {} };
    scripts()[0]!.onload!(new Event('load'));
    await expect(p).resolves.toBeUndefined();
    expect(cb).not.toHaveBeenCalled();
    (window as Win).navermap_authFailure!();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    unsubscribe();
    const late = vi.fn();
    onNaverAuthFailure(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
