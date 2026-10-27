export const KAKAO_SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js';
export const KAKAO_SDK_INTEGRITY =
  'sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w';
export const KAKAO_LINK_MAX = 2000;

export type KakaoShareConfig = {
  appKey: string;
  sdkUrl?: string;
  integrity?: string;
  maxLinkLength?: number;
};
export type KakaoCard = {
  title: string;
  description?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  url: string;
  buttonTitle?: string;
};
export type KakaoFeed = {
  objectType: 'feed';
  content: Omit<KakaoCard, 'url' | 'buttonTitle'> & {
    link: { webUrl: string; mobileWebUrl: string };
  };
  buttonTitle?: string;
};
export type KakaoSdk = {
  init(appKey: string): void;
  isInitialized(): boolean;
  Share: { sendDefault(feed: KakaoFeed): void };
};

function sdk(): KakaoSdk | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as Window & { Kakao?: KakaoSdk }).Kakao;
}

/** 키와 링크 한도를 동기로 검사한다. */
export function kakaoLinkFits(url: string, config: KakaoShareConfig): boolean {
  return config.appKey.trim().length > 0 && url.length <= (config.maxLinkLength ?? KAKAO_LINK_MAX);
}

// 문서별로 보관하므로 시험용 문서나 다른 창의 로드를 섞지 않는다.
const loads = new WeakMap<Document, Map<string, Promise<void>>>();
function loadScript(doc: Document, config: KakaoShareConfig): Promise<void> {
  const src = new URL(config.sdkUrl ?? KAKAO_SDK_URL, doc.baseURI).href;
  let cache = loads.get(doc);
  if (!cache) {
    cache = new Map();
    loads.set(doc, cache);
  }
  const cached = cache.get(src);
  if (cached) return cached;
  const script =
    Array.from(doc.scripts).find((tag) => tag.src === src) ?? doc.createElement('script');
  const promise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const loaded = () => {
      cleanup();
      if (sdk()?.Share) resolve();
      else {
        script.remove();
        reject(new Error('카카오톡 SDK가 없어요'));
      }
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error('카카오톡 SDK를 불러오지 못했어요'));
    };
    const timer = setTimeout(failed, 15_000);
    script.addEventListener('load', loaded);
    script.addEventListener('error', failed);
    if (!script.isConnected) {
      script.src = src;
      script.integrity = config.integrity ?? KAKAO_SDK_INTEGRITY;
      script.crossOrigin = 'anonymous';
      script.async = true;
      doc.head.append(script);
    }
  }).finally(() => {
    cache.delete(src);
  });
  cache.set(src, promise);
  return promise;
}

/** SDK를 미리 받고 초기화한다. 실패한 로드는 다음 호출에서 다시 시도한다. */
export async function preloadKakao(config: KakaoShareConfig): Promise<void> {
  if (typeof document === 'undefined' || !config.appKey.trim())
    throw new Error('카카오톡을 준비할 수 없어요');
  if (!sdk()?.Share) await loadScript(document, config);
  const kakao = sdk();
  if (!kakao?.Share) throw new Error('카카오톡 SDK가 없어요');
  if (!kakao.isInitialized()) kakao.init(config.appKey);
}

export function kakaoReady(): boolean {
  try {
    const kakao = sdk();
    return !!kakao?.Share && kakao.isInitialized();
  } catch {
    return false;
  }
}

/** 클릭 안에서 기다림 없이 호출한다. true는 SDK 호출 성공이며 메시지 전달 완료를 뜻하지 않는다. */
export function sendKakao(card: KakaoCard, config: KakaoShareConfig): boolean {
  try {
    if (!kakaoLinkFits(card.url, config) || !kakaoReady()) return false;
    const { url, buttonTitle, ...content } = card;
    sdk()!.Share.sendDefault({
      objectType: 'feed',
      content: { ...content, link: { webUrl: url, mobileWebUrl: url } },
      ...(buttonTitle === undefined ? {} : { buttonTitle }),
    });
    return true;
  } catch {
    return false;
  }
}

export type ShareOrCopyOptions = {
  share?: (data: { url: string; title: string }) => Promise<unknown>;
  copy?: (url: string) => Promise<unknown>;
};

/** 알림 문구는 호출하는 앱에서 정한다. 취소한 공유는 복사하지 않는다. */
export async function shareOrCopy(
  url: string,
  title: string,
  { share, copy }: ShareOrCopyOptions,
): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (share) {
    try {
      await share({ url, title });
      return 'shared';
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError'
      )
        return 'cancelled';
    }
  }
  try {
    if (!copy) return 'failed';
    await copy(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
