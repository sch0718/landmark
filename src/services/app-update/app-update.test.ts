import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { NEW_VERSION_MESSAGE, RELEASE_SEEN_KEY, startAppUpdate } from './app-update';

vi.mock('sonner', () => ({ toast: vi.fn() }));
vi.mock('src/sections/help/release-notes', () => ({
  RELEASE_NOTES: [
    { version: 'v2.0.0', date: '2026-12-01', items: ['새 기능'] },
    { version: 'v1.0.0', date: '2026-11-01', items: ['첫 판'] },
  ],
}));

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

afterEach(() => {
  vi.mocked(toast).mockClear();
  vi.unstubAllGlobals();
});

describe('startAppUpdate', () => {
  it('처음 쓰는 사람에게는 바뀐 점을 알리지 않는다', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const storage = memoryStorage();
    startAppUpdate(
      'a',
      () => {},
      () => storage,
    )();
    expect(toast).not.toHaveBeenCalled();
    expect(JSON.parse(storage.getItem(RELEASE_SEEN_KEY) ?? '[]')).toEqual(['v2.0.0', 'v1.0.0']);
  });

  it('업데이트 뒤 첫 실행에서 한 번 알리고, 누르면 바뀐 점을 연다', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const storage = memoryStorage({ [RELEASE_SEEN_KEY]: '["v1.0.0"]' });
    const open = vi.fn();
    startAppUpdate('a', open, () => storage)();
    expect(toast).toHaveBeenCalledOnce();
    const [message, options] = vi.mocked(toast).mock.calls[0]!;
    expect(message).toBe('업데이트했어요 (v2.0.0)');
    (options?.action as unknown as { onClick: () => void }).onClick();
    expect(open).toHaveBeenCalledOnce();
  });

  it('쓰는 중에 새 배포를 알면 새로고침 안내를 띄운다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ version: 'b' }) })),
    );
    document.dispatchEvent(new Event('pointerdown'));
    const stop = startAppUpdate(
      'a',
      () => {},
      () => memoryStorage(),
    );
    // 시작 뒤 조작한 것으로 본다
    document.dispatchEvent(new Event('pointerdown'));
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        NEW_VERSION_MESSAGE,
        expect.objectContaining({ id: 'app-update' }),
      ),
    );
    stop();
  });
});
