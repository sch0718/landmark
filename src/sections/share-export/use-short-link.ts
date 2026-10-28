import { useCallback, useEffect, useRef, useState } from 'react';
import { shortKeepUntil, type ShortLinkKind } from 'src/domain/share/short-link';
import type { ShareDoc } from 'src/schema/share';
import { getTurnstileToken } from 'src/services/meet-online/turnstile-loader';
import { shareApi, type ShortLinkError } from 'src/services/share-short/client';
import { encryptShareHash, newDeleteToken } from 'src/services/share-short/crypto';
import { sentLinks } from 'src/services/share-short/store';
import { appUrl } from 'src/share-viewer/encode';

export type ShortMeta = { kind: ShortLinkKind; keepUntil: string | null };
export type ShortLinkState =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'ready'; url: string; expiresAt: Date }
  | { status: 'failed'; error: ShortLinkError | 'turnstile-load' };

export const SHORT_FAILED: Record<ShortLinkError | 'turnstile-load', string> = {
  offline: '인터넷 연결을 확인해 주세요. 링크 복사를 이용해 주세요',
  'turnstile-load': '확인 도구를 불러오지 못했어요. 링크 복사를 이용해 주세요',
  turnstile: '확인에 실패했어요. 다시 해 주세요',
  'rate-limited': '오늘 만들 수 있는 짧은 링크를 다 썼어요. 링크 복사를 이용해 주세요',
  'switched-off': '링크가 길어 카카오톡으로 보낼 수 없어요. 링크 복사를 이용해 주세요',
  unavailable: '짧은 링크를 만들지 못했어요. 링크 복사를 이용해 주세요',
  'not-found': '짧은 링크를 만들지 못했어요. 링크 복사를 이용해 주세요',
  unauthorized: '짧은 링크를 만들지 못했어요. 링크 복사를 이용해 주세요',
  invalid: '짧은 링크를 만들지 못했어요. 링크 복사를 이용해 주세요',
};

export function shortMetaOf(doc: ShareDoc): ShortMeta {
  return doc.version === 2
    ? { kind: 'trip', keepUntil: shortKeepUntil(doc.trips.map((trip) => trip.endDate)) }
    : { kind: 'places', keepUntil: null };
}

// 응답이 사라진 뒤 다시 누르면 같은 본문·삭제 토큰으로 보내 서버가 같은 링크를 돌려주게 한다.
type Attempt = { body: string; key: string; deleteToken: string };

/**
 * 카카오톡용 짧은 링크. 사용자가 누를 때만 서버에 올리고, 창이 열려 있는 동안 긴 링크(제목·메모 포함이 담김)별로 기억한다.
 * 창을 닫으면 모두 잊고, 닫은 뒤 끝난 요청은 화면에 반영하지 않는다(만든 링크는 기기 목록에는 남는다).
 */
export function useShortLink(open: boolean, longHref: string | null) {
  const [states, setStates] = useState<ReadonlyMap<string, ShortLinkState>>(new Map());
  const attempts = useRef(new Map<string, Attempt>());
  const runId = useRef(0);
  // 열고 닫을 때 비운다(렌더 중 상태 갱신). 실행 번호·시도 기록은 그린 뒤에 바꾼다.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setStates(new Map());
  }
  useEffect(() => {
    runId.current += 1;
    attempts.current.clear();
  }, [open]);

  const set = (href: string, state: ShortLinkState) =>
    setStates((prev) => new Map(prev).set(href, state));

  const create = useCallback(async (href: string, title: string, meta: ShortMeta) => {
    const run = runId.current;
    const live = () => runId.current === run;
    set(href, { status: 'creating' });
    let attempt = attempts.current.get(href);
    try {
      if (!attempt) {
        const hash = new URL(href).hash.replace(/^#d=/, '');
        attempt = { ...(await encryptShareHash(hash)), deleteToken: newDeleteToken() };
        attempts.current.set(href, attempt);
      }
    } catch {
      if (live()) set(href, { status: 'failed', error: 'invalid' });
      return;
    }
    let turnstile: string;
    try {
      turnstile = await getTurnstileToken();
    } catch {
      if (live()) set(href, { status: 'failed', error: 'turnstile-load' });
      return;
    }
    const result = await shareApi.create({
      body: attempt.body,
      kind: meta.kind,
      keepUntil: meta.keepUntil,
      turnstile,
      deleteToken: attempt.deleteToken,
    });
    if (!result.ok) {
      if (live()) set(href, { status: 'failed', error: result.error });
      return;
    }
    const { id, expiresAt } = result.value;
    sentLinks.add({
      id,
      deleteToken: attempt.deleteToken,
      title,
      kind: meta.kind,
      createdAt: new Date().toISOString(),
      expiresAt,
    });
    if (!live()) return;
    // 긴 링크와 같은 앱 주소를 쓴다(카카오에 등록한 도메인).
    const app = appUrl(
      import.meta.env.VITE_APP_URL || (import.meta.env.DEV ? window.location.origin : undefined),
    );
    set(href, {
      status: 'ready',
      url: `${app}/s/${id}#k=${attempt.key}`,
      expiresAt: new Date(expiresAt),
    });
  }, []);

  const state: ShortLinkState = (longHref === null ? undefined : states.get(longHref)) ?? {
    status: 'idle',
  };
  return { state, create };
}
