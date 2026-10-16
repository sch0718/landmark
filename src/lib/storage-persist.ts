export type PersistState = 'persisted' | 'not-persisted' | 'unsupported';

/** 지금 이 사이트의 저장소가 보호돼 있는가. 지원하지 않거나 던지면 `unsupported`. */
export async function persistState(): Promise<PersistState> {
  try {
    const storage = navigator.storage;
    if (storage === undefined || typeof storage.persisted !== 'function') return 'unsupported';
    return (await storage.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

let requested = false;

/**
 * 저장 보호(`navigator.storage.persist()`)를 세션당 한 번만 요청한다. 이미 보호돼 있으면 부르지 않는다.
 * 브라우저가 거절하면 `not-persisted`. 사용자 동작 없이 부르는 곳에서도 안전하다(던지지 않는다).
 */
export async function requestPersistOnce(): Promise<PersistState> {
  const state = await persistState();
  if (state !== 'not-persisted' || requested) return state;
  requested = true;
  try {
    return (await navigator.storage.persist()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}
