import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { startEffect } from 'src/lib/effect/runtime';
import {
  kakaoLinkFits,
  kakaoReady,
  preloadKakao,
  sendKakao,
  type KakaoCard,
} from 'src/lib/kakao-share';
import { appUrl } from 'src/share-viewer/encode';

export const KAKAO_TOO_LONG = '링크가 길어 카카오톡으로 보낼 수 없어요. 링크 복사를 이용해 주세요';
export const KAKAO_LOAD_FAILED = '카카오톡을 불러오지 못했어요. 링크 복사를 이용해 주세요';
export const KAKAO_SEND_FAILED = '카카오톡으로 보내지 못했어요. 링크 복사를 이용해 주세요';
const config = () => ({ appKey: import.meta.env.VITE_KAKAO_JS_KEY?.trim() ?? '' });
export const kakaoUrlFits = (url: string) => kakaoLinkFits(url, config());

const loadKakao = Effect.fnUntraced(function* (appKey: string) {
  yield* Effect.tryPromise({
    try: () => preloadKakao({ appKey }),
    catch: () => KAKAO_LOAD_FAILED,
  });
});

export function sendAppKakao(card: KakaoCard): boolean {
  const app = appUrl(
    import.meta.env.VITE_APP_URL || (import.meta.env.DEV ? window.location.origin : undefined),
  );
  return sendKakao(
    {
      ...card,
      imageUrl: new URL('icon-512.png', `${app}/`).href,
      imageWidth: 512,
      imageHeight: 512,
    },
    config(),
  );
}

/** 화면이 보일 때만 미리 받아 클릭 안에서 바로 보낼 수 있게 한다. */
export function useKakao(enabled = true) {
  const appKey = config().appKey;
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    if (!enabled || !appKey) return;
    let stale = false;
    void startEffect(loadKakao(appKey)).then(
      () => {
        if (!stale) setState('ready');
      },
      () => {
        if (!stale) setState('failed');
      },
    );
    return () => {
      stale = true;
    };
  }, [enabled, appKey]);
  return {
    enabled: !!appKey,
    ready: state === 'ready' && kakaoReady(),
    failed: state === 'failed',
  };
}

/** 비동기로 만든 링크는 알림의 새 클릭에서 보낸다. 주최자 비밀 링크는 받지 않는다. */
export async function prepareKakaoLink(card: KakaoCard): Promise<void> {
  if (new URL(card.url).hash.startsWith('#h=')) return;
  if (!kakaoUrlFits(card.url)) {
    toast.error(KAKAO_TOO_LONG);
    return;
  }
  try {
    await startEffect(loadKakao(config().appKey));
  } catch {
    toast.error(KAKAO_LOAD_FAILED);
    return;
  }
  toast('링크가 준비됐어요', {
    duration: Infinity,
    action: {
      label: '카카오톡으로 보내기',
      onClick: () => {
        if (!sendAppKakao(card)) toast.error(KAKAO_SEND_FAILED);
      },
    },
  });
}
