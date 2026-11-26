import { shareOrCopy } from '@sch0718/kakao-share';
import { toast } from 'sonner';
import { meetLink, type MeetDoc } from 'src/domain/meeting/link';
import { appUrl } from 'src/share-viewer/encode';
import { prepareKakaoLink } from '../share-export/kakao';

/** 공유가 지원되지 않거나 실패하면 같은 주소를 복사한다. 사용자가 공유를 취소하면 복사하지 않는다. */
export async function shareLink(
  url: string,
  title: string,
  options: { quietFailure?: boolean } = {},
): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const result = await shareOrCopy(url, title, {
    share: typeof navigator.share === 'function' ? (data) => navigator.share(data) : undefined,
    copy: navigator.clipboard ? (text) => navigator.clipboard.writeText(text) : undefined,
  });
  if (result === 'shared') toast('링크를 보냈어요');
  else if (result === 'copied') toast('링크를 복사했어요');
  else if (result === 'failed' && !options.quietFailure)
    toast.error('링크를 보내지 못했어요. 다시 시도해 주세요');
  return result;
}

export async function shareMeetingDoc(
  doc: MeetDoc,
  title: string,
  channel: 'link' | 'kakao' = 'link',
) {
  try {
    const app = appUrl(
      import.meta.env.VITE_APP_URL || (import.meta.env.DEV ? window.location.origin : undefined),
    );
    const link = await meetLink(doc, app);
    if (!link.ok) {
      toast.error('링크가 너무 길어요. 후보나 참석자를 줄여 주세요');
      return;
    }
    if (channel === 'kakao')
      await prepareKakaoLink({ url: link.url, ...meetingKakaoCard(doc, title) });
    else await shareLink(link.url, title);
  } catch {
    toast.error('링크를 만들지 못했어요. 다시 시도해 주세요');
  }
}

/** 주최자 비밀은 질의 문자열 대신 해시로만 전달한다. */
export function onlineMeetingUrl(id: string, hostToken?: string): string {
  const app = window.location.origin;
  return `${app}/meet/${encodeURIComponent(id)}${hostToken ? `#h=${encodeURIComponent(hostToken)}` : ''}`;
}

/** 같은 링크라도 후보·답장·확정의 뜻을 카드에 담는다. */
export function meetingKakaoCard(doc: MeetDoc, title: string) {
  if (doc.kind === 'd')
    return {
      title,
      description: `후보 ${doc.candidates.length}곳 · 가능한 곳을 골라 주세요`,
      buttonTitle: '답하기',
    };
  if (doc.kind === 'r') return { title, description: '답장을 보냈어요', buttonTitle: '답장 열기' };
  const at = doc.at === null ? '' : ` · ${doc.at.date.replaceAll('-', '.')} ${doc.at.time}`;
  return { title, description: `${doc.place.name}${at}`, buttonTitle: '확정 보기' };
}
