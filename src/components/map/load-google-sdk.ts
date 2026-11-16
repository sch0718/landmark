/** Maps JavaScript API 로더. 스크립트 로드가 아니라 SDK의 전역 콜백을 기다린다. */
type GoogleWindow = {
  google?: { maps?: { Map?: unknown; importLibrary?: (name: string) => Promise<unknown> } };
  gm_authFailure?: () => void;
};
export const GOOGLE_AUTH_FAILURE_MESSAGE = '구글 지도 인증 실패(도메인 미등록 등)';

let pending: Promise<void> | null = null;
let rejectPending: ((message: string) => void) | null = null;
let authFailed = false;
let callbackSeq = 0;
const authFailureListeners = new Set<() => void>();

function installAuthFailureHandler(): void {
  (window as GoogleWindow).gm_authFailure = () => {
    authFailed = true;
    rejectPending?.(GOOGLE_AUTH_FAILURE_MESSAGE);
    for (const cb of [...authFailureListeners]) cb();
  };
}

/** 로드 뒤 인증 실패도 알린다. 이미 실패했으면 바로 부르고, 해제 함수를 돌려준다. */
export function onGoogleAuthFailure(cb: () => void): () => void {
  authFailureListeners.add(cb);
  if (authFailed) cb();
  return () => {
    authFailureListeners.delete(cb);
  };
}

export function loadGoogleSdk(apiKey: string, timeoutMs = 10000): Promise<void> {
  if (authFailed) return Promise.reject(new Error(GOOGLE_AUTH_FAILURE_MESSAGE));
  installAuthFailureHandler();
  if ((window as GoogleWindow).google?.maps?.Map) return Promise.resolve();
  if (pending) return pending;
  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const callback = `__tripmapGoogleReady${++callbackSeq}`;
    const globals = window as unknown as Record<string, (() => void) | undefined>;
    let settled = false;
    const settle = () => {
      settled = true;
      clearTimeout(timer);
      rejectPending = null;
      delete globals[callback];
    };
    const fail = (message: string) => {
      if (settled) return;
      settle();
      script.remove();
      pending = null;
      reject(new Error(message));
    };
    rejectPending = fail;
    const timer = setTimeout(() => fail('구글 지도 SDK 로드 시간 초과'), timeoutMs);
    globals[callback] = () => {
      if (settled) return;
      const finish = () => {
        if (settled) return;
        if ((window as GoogleWindow).google?.maps?.Map) {
          settle();
          resolve();
        } else fail('구글 지도 SDK가 초기화되지 않았어요');
      };
      // loading=async에서는 importLibrary('maps')가 끝나야 레거시 이름공간이 채워진다.
      const importLibrary = (window as GoogleWindow).google?.maps?.importLibrary;
      if (typeof importLibrary === 'function') {
        importLibrary
          .call((window as GoogleWindow).google!.maps, 'maps')
          .then(finish, () => fail('구글 지도 SDK가 초기화되지 않았어요'));
      } else finish();
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=${callback}&v=weekly`;
    script.async = true;
    script.onerror = () => fail('구글 지도 SDK 로드 실패');
    document.head.appendChild(script);
  });
  return pending;
}
