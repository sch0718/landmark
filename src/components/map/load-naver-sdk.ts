/**
 * NCP Maps JS v3 로더.
 * 클라이언트 ID 쿼리 파라미터명 확인(2026-10-04): 공식 문서(navermaps.github.io/maps.js.ncp,
 * Getting Started "변경사항")가 `ncpClientId`를 `ncpKeyId`로 바꿨다고 안내한다 → `ncpKeyId` 사용.
 *
 * `submodules=geocoder`는 주소 변환(`naver.maps.Service.reverseGeocode`)에 필요하다(2026-10-12 확인: 등록 도메인에서 200).
 *
 * 등록되지 않은 도메인이면 스크립트는 정상 로드되고 SDK가 전역 `navermap_authFailure`를 부른다
 * (보통 로드가 끝난 뒤 비동기 인증 확인을 거쳐서). 그래서 스크립트를 넣기 전에 이 함수를 정의해 두고,
 * 로드 대기 중이면 reject하고 이미 끝났으면 `onNaverAuthFailure`로 등록한 콜백을 부른다.
 */
type NaverWindow = { naver?: { maps?: unknown }; navermap_authFailure?: () => void };
export const NAVER_AUTH_FAILURE_MESSAGE = '네이버 지도 인증 실패(도메인 미등록 등)';

let pending: Promise<void> | null = null;
let rejectPending: ((message: string) => void) | null = null;
let authFailed = false;
const authFailureListeners = new Set<() => void>();

function installAuthFailureHandler(): void {
  (window as NaverWindow).navermap_authFailure = () => {
    authFailed = true;
    rejectPending?.(NAVER_AUTH_FAILURE_MESSAGE);
    for (const cb of [...authFailureListeners]) cb();
  };
}

/** 로드가 끝난 뒤 인증 실패가 오면 부를 콜백을 등록한다. 이미 실패했으면 바로 부른다. 해제 함수를 돌려준다. */
export function onNaverAuthFailure(cb: () => void): () => void {
  authFailureListeners.add(cb);
  if (authFailed) cb();
  return () => {
    authFailureListeners.delete(cb);
  };
}

export function loadNaverSdk(clientId: string, timeoutMs = 10000): Promise<void> {
  if (authFailed) return Promise.reject(new Error(NAVER_AUTH_FAILURE_MESSAGE));
  if ((window as NaverWindow).naver?.maps) return Promise.resolve();
  if (pending) return pending;
  installAuthFailureHandler();
  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const settle = () => {
      clearTimeout(timer);
      rejectPending = null;
    };
    const fail = (message: string) => {
      settle();
      script.remove();
      pending = null;
      reject(new Error(message));
    };
    rejectPending = fail;
    const timer = setTimeout(() => fail('네이버 지도 SDK 로드 시간 초과'), timeoutMs);
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}&submodules=geocoder`;
    script.async = true;
    script.onload = () => {
      if (!rejectPending) return;
      if ((window as NaverWindow).naver?.maps) {
        settle();
        resolve();
      } else fail('네이버 지도 SDK가 초기화되지 않았어요');
    };
    script.onerror = () => {
      if (rejectPending) fail('네이버 지도 SDK 로드 실패');
    };
    document.head.appendChild(script);
  });
  return pending;
}
