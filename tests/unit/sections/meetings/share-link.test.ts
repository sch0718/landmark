import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { onlineMeetingUrl, shareLink } from 'src/sections/meetings/share-link';
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const writeText = vi.fn(() => Promise.resolve());
beforeEach(() => vi.clearAllMocks());
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
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      '링크를 보내지 못했어요. 다시 시도해 주세요',
    );
  });
  it('실패 알림을 끄면 공유와 복사가 모두 거절돼도 실패 결과만 돌려준다', async () => {
    const denied = new DOMException('사용자 동작이 필요해요', 'NotAllowedError');
    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(denied),
      clipboard: { writeText: vi.fn().mockRejectedValue(denied) },
    });
    expect(
      await shareLink('https://example.test/meet/meeting001', '약속', { quietFailure: true }),
    ).toBe('failed');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('약속 카카오톡 보내기', () => {
  it('답장 링크를 만든 뒤 알림 단추의 클릭에서만 SDK를 부른다', async () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'e2e-kakao-key');
    const sendDefault = vi.fn();
    vi.stubGlobal('Kakao', { init: vi.fn(), isInitialized: () => true, Share: { sendDefault } });
    const { shareMeetingDoc } = await import('src/sections/meetings/share-link');
    await shareMeetingDoc(
      {
        format: 'tripmap-meet',
        v: 1,
        kind: 'r',
        meetingId: 'meeting01',
        participantId: 'person01',
        likes: [],
        sentAt: '2026-10-27T00:00:00.000Z',
      },
      '저녁 약속',
      'kakao',
    );
    expect(sendDefault).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      '링크가 준비됐어요',
      expect.objectContaining({
        action: { label: '카카오톡으로 보내기', onClick: expect.any(Function) },
      }),
    );
    const options = vi.mocked(toast).mock.calls.at(-1)![1]!;
    const action = options.action as unknown as { onClick: () => void };
    action.onClick();
    expect(sendDefault).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: '저녁 약속',
          description: '답장을 보냈어요',
          link: {
            webUrl: expect.stringContaining('/meet#r='),
            mobileWebUrl: expect.stringContaining('/meet#r='),
          },
        }),
        buttonTitle: '답장 열기',
      }),
    );
  });
  it('긴 링크와 SDK 실패는 안내하고 주최자 비밀 링크는 보내지 않는다', async () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'e2e-kakao-key');
    const { prepareKakaoLink, KAKAO_TOO_LONG, KAKAO_LOAD_FAILED } =
      await import('src/sections/share-export/kakao');
    await prepareKakaoLink({ title: '약속', url: `https://app.test/meet#d=${'a'.repeat(2001)}` });
    expect(toast.error).toHaveBeenCalledWith(KAKAO_TOO_LONG);
    vi.clearAllMocks();
    await prepareKakaoLink({ title: '약속', url: 'https://app.test/meet/meeting01#h=secret' });
    expect(toast).not.toHaveBeenCalled();
    expect(document.scripts).toHaveLength(0);
    vi.stubGlobal('Kakao', {
      init: () => {
        throw new Error('초기화 실패');
      },
      isInitialized: () => false,
      Share: { sendDefault: vi.fn() },
    });
    await prepareKakaoLink({ title: '약속', url: 'https://app.test/meet#d=abc' });
    expect(toast.error).toHaveBeenCalledWith(KAKAO_LOAD_FAILED);
  });
});
