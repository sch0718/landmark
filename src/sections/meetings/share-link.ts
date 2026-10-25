import { toast } from 'sonner';
import { meetLink, type MeetDoc } from 'src/domain/meeting/link';
import { appUrl } from 'src/share-viewer/encode';

/** 공유가 지원되지 않거나 거절되면 같은 주소를 복사한다. */
export async function shareLink(
  url: string,
  title: string,
): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, url });
      toast('링크를 보냈어요');
      return 'shared';
    }
  } catch {
    /* 복사를 이어서 시도한다. */
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('링크를 복사했어요');
    return 'copied';
  } catch {
    toast.error('링크를 보내지 못했어요. 다시 시도해 주세요');
    return 'failed';
  }
}

export async function shareMeetingDoc(doc: MeetDoc, title: string) {
  try {
    const app = appUrl(
      import.meta.env.VITE_APP_URL || (import.meta.env.DEV ? window.location.origin : undefined),
    );
    const link = await meetLink(doc, app);
    if (!link.ok) {
      toast.error('링크가 너무 길어요. 후보나 참석자를 줄여 주세요');
      return;
    }
    await shareLink(link.url, title);
  } catch {
    toast.error('링크를 만들지 못했어요. 다시 시도해 주세요');
  }
}

/** 주최자 비밀은 질의 문자열 대신 해시로만 전달한다. */
export function onlineMeetingUrl(id: string, hostToken?: string): string {
  const app = appUrl(
    import.meta.env.VITE_APP_URL || (import.meta.env.DEV ? window.location.origin : undefined),
  );
  return `${app}/meet/${encodeURIComponent(id)}${hostToken ? `#h=${encodeURIComponent(hostToken)}` : ''}`;
}
