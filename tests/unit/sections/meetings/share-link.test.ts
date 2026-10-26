import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineMeetingUrl, shareLink } from 'src/sections/meetings/share-link';
const writeText = vi.fn(() => Promise.resolve());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('약속 링크 보내기', () => {
  it.each([undefined, 'host-secret'])('미리보기 출처로 온라인 링크를 만든다: %s', (token) => {
    vi.stubEnv('VITE_APP_URL', 'https://landmark.example.com');
    vi.stubGlobal('window', { location: { origin: 'https://abc.landmark-c5f.pages.dev' } });
    expect(onlineMeetingUrl('meeting01', token)).toBe(
      `https://abc.landmark-c5f.pages.dev/meet/meeting01${token ? '#h=host-secret' : ''}`,
    );
  });
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
