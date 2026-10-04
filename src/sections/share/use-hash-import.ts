import { useEffect, useRef } from 'react';
import type { ImportInput } from 'src/repositories/import-flow';

const PREFIX = '#e=';

/**
 * 진입 시 `#e=<값>`이 있으면 `onImport`로 넘기고, 결과와 무관하게 해시를 바로 지운다(§5.3-7).
 * 지운 뒤에는 새로고침·뒤로 가기로 같은 가져오기가 다시 열리지 않는다.
 */
export function useHashImport(onImport: (input: ImportInput) => void): void {
  const latest = useRef(onImport);
  useEffect(() => {
    latest.current = onImport;
  });

  useEffect(() => {
    const { hash, pathname, search } = window.location;
    if (!hash.startsWith(PREFIX)) return;
    // react-router가 history.state에 둔 idx·key를 지우지 않도록 현재 state를 그대로 넘긴다.
    history.replaceState(history.state, '', pathname + search);
    latest.current({ kind: 'link', value: hash.slice(PREFIX.length) });
  }, []);
}
