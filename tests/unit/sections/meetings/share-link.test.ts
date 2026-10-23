import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareLink } from 'src/sections/meetings/share-link';
const writeText = vi.fn(() => Promise.resolve());
afterEach(() => vi.unstubAllGlobals());
describe('약속 링크 보내기', () => {
  it('Web Share를 사용할 수 있으면 공유한다', async () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    expect(await shareLink('https://example.test/meet#d=abc', '약속')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: '약속', url: 'https://example.test/meet#d=abc' });
  });
  it('공유 실패 시 클립보드로 복사한다', async () => {
    vi.stubGlobal('navigator', {
      share: () => Promise.reject(new Error('실패')),
      clipboard: { writeText },
    });
    expect(await shareLink('https://example.test/meet#d=abc', '약속')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://example.test/meet#d=abc');
  });
  it('클립보드도 사용할 수 없으면 실패를 돌려준다', async () => {
    vi.stubGlobal('navigator', {});
    expect(await shareLink('https://example.test/meet#d=abc', '약속')).toBe('failed');
  });
});
