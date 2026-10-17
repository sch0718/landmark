import { useSyncExternalStore } from 'react';

const subscribe = (notify: () => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};

const snapshot = () => navigator.onLine;

/**
 * 인터넷에 연결돼 있는가(스펙 §4.10). `navigator.onLine`을 `online`·`offline` 이벤트로 따라간다.
 * 브라우저가 "연결됨"이라 해도 실제로는 안 닿을 수 있으므로, 그날 구간의 연결 실패(`plan.offline`)와 함께 본다.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
