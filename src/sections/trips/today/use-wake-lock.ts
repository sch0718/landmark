import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

const FAILED = '화면 켜 두기를 쓸 수 없어요';

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

type Sentinel = { release(): Promise<void> };
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

const apiOf = (): WakeLockApi | null =>
  typeof navigator !== 'undefined' && 'wakeLock' in navigator
    ? (navigator as Navigator & { wakeLock: WakeLockApi }).wakeLock
    : null;

/**
 * 화면 켜 두기(스펙 §4.9). 기본 끔이고 저장하지 않는다. 켜면 `wakeLock.request('screen')`을 하고, 브라우저가 화면을
 * 숨길 때 놓아 버리므로 켜 둔 채 다시 보이면 다시 요청한다. 요청이 거절되면(배터리 절약 등) 끔으로 돌리고 알린다.
 * 끄거나 화면을 떠나면 `release()`. `wakeLock`이 없으면 `supported`가 거짓이다.
 */
export function useWakeLock(): { supported: boolean; on: boolean; setOn(next: boolean): void } {
  const supported = apiOf() !== null;
  const [on, setOnState] = useState(false);
  const [visible, setVisible] = useState(isVisible);
  const setOn = useCallback((next: boolean) => setOnState(next), []);

  useEffect(() => {
    const onVisibility = () => setVisible(isVisible());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const api = apiOf();
    if (!on || !visible || api === null) return;
    let live = true;
    let held: Sentinel | null = null;
    api.request('screen').then(
      (sentinel) => {
        // 답을 기다리는 사이 끄거나 숨었으면 받은 잠금을 바로 놓는다.
        if (live) held = sentinel;
        else void sentinel.release().catch(() => {});
      },
      () => {
        if (!live) return;
        setOnState(false);
        toast(FAILED);
      },
    );
    return () => {
      live = false;
      void held?.release().catch(() => {});
    };
  }, [on, visible]);

  return { supported, on, setOn };
}
