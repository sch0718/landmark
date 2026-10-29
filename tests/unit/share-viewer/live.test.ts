import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLivePoll, fetchLive } from 'src/share-viewer/live';
import { buildLiveDoc } from '../../fixtures/live-trip';
const polls: { stop(): void }[] = [];
const poll = (tick: () => Promise<'ok' | 'error' | 'stop'>, idleMs?: number) => {
  const p = createLivePoll({ tick, idleMs });
  polls.push(p);
  return p;
};
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => {
  polls.splice(0).forEach((p) => p.stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('받는 화면 확인', () => {
  it('Bearer·since·no-store로 요청한다', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ rev: 1, updatedAt: '시각', expiresAt: '기한', doc: buildLiveDoc() }),
      );
    expect(await fetchLive('abcdefghij', 'v'.repeat(43), 2, fetcher)).toMatchObject({
      kind: 'doc',
      rev: 1,
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/trip-live/abcdefghij?since=2',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${'v'.repeat(43)}` },
      }),
    );
  });
  it.each([
    [304, 'unchanged'],
    [401, 'revoked'],
    [404, 'ended'],
    [410, 'ended'],
    [429, 'busy'],
    [500, 'failed'],
    [200, 'failed'],
  ])('상태 %i는 %s다', async (code, kind) => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(code === 304 ? null : '{}', { status: Number(code) }));
    expect(await fetchLive('abcdefghij', '토큰', null, f)).toEqual({ kind });
  });
  it('10초마다 확인하고 숨김·오프라인이면 쉬며 복귀 때 바로 확인한다', async () => {
    const tick = vi.fn(async () => 'ok' as const);
    poll(tick);
    await vi.advanceTimersByTimeAsync(10000);
    expect(tick).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(tick).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(tick).toHaveBeenCalledTimes(2);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(3);
  });
  it('실패는 30초·60초로 늦추고 성공하면 10초다', async () => {
    const tick = vi
      .fn<() => Promise<'ok' | 'error'>>()
      .mockResolvedValueOnce('error')
      .mockResolvedValueOnce('error')
      .mockResolvedValue('ok');
    poll(tick);
    await vi.advanceTimersByTimeAsync(10000);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(tick).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10000);
    expect(tick).toHaveBeenCalledTimes(4);
  });
  it('오래 손대지 않으면 60초로 늦추고 첫 입력은 바로 확인한다', async () => {
    const tick = vi.fn(async () => 'ok' as const);
    poll(tick, 15000);
    await vi.advanceTimersByTimeAsync(20000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect(tick).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(3);
  });
  it('진행 중인 확인은 겹치지 않고 stop 뒤 모두 멈춘다', async () => {
    let done!: (v: 'stop') => void;
    const tick = vi.fn(() => new Promise<'stop'>((r) => (done = r)));
    poll(tick);
    await vi.advanceTimersByTimeAsync(10000);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(tick).toHaveBeenCalledTimes(1);
    done('stop');
    await vi.advanceTimersByTimeAsync(100000);
    window.dispatchEvent(new Event('online'));
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
