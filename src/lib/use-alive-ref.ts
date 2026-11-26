import { useEffect, useRef } from 'react';

/** 마운트돼 있는 동안 `true`. 저장하는 사이 칸이 닫혔는지 볼 때 쓴다. */
export function useAliveRef() {
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  return aliveRef;
}
