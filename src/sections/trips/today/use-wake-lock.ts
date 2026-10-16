import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

const FAILED = '화면 켜 두기를 쓸 수 없어요';

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** `WakeLockSentinel` 중 쓰는 것. 시스템이 놓아도(배터리 절약 등) `release` 이벤트가 온다. */
type Sentinel = {
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void, options?: { once?: boolean }): void;
};
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

const apiOf = (): WakeLockApi | null =>
  typeof navigator !== 'undefined' && 'wakeLock' in navigator
    ? (navigator as Navigator & { wakeLock: WakeLockApi }).wakeLock
    : null;

/**
 * 화면 켜 두기(스펙 §4.9). 기본 끔이고 저장하지 않는다. 켜면 `wakeLock.request('screen')`을 하고, 브라우저가 화면을
 * 숨길 때 놓아 버리므로 켜 둔 채 다시 보이면 다시 요청한다. 요청이 거절되면(배터리 절약 등) 끔으로 돌리고 알린다.
 * 보이는 동안 시스템이 잠금을 놓으면(`release` 이벤트) `켜 둠` 표시가 거짓말하지 않게 한 번 다시 요청하고, 그것도
 * 거절되거나 다시 놓이면 끔으로 돌리고 알린다. 끄거나 화면을 떠나면 `release()`. `wakeLock`이 없으면 `supported`가 거짓이다.
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
    // 이번에 보이는 동안 시스템이 놓은 잠금을 다시 요청했는가(한 번만 한다).
    let retried = false;
    const fail = () => {
      if (!live) return;
      setOnState(false);
      toast(FAILED);
    };
    // 끄기·숨김·떠남으로 우리가 놓은 것은 `live`가 거짓이다. 숨으면서 시스템이 놓은 것은 다시 보일 때 다시 요청한다.
    const onSystemRelease = () => {
      if (!live || !isVisible()) return;
      held = null;
      if (retried) {
        fail();
        return;
      }
      retried = true;
      acquire();
    };
    function acquire() {
      api!.request('screen').then((sentinel) => {
        // 답을 기다리는 사이 끄거나 숨었으면 받은 잠금을 바로 놓는다.
        if (!live) {
          void sentinel.release().catch(() => {});
          return;
        }
        held = sentinel;
        sentinel.addEventListener?.('release', onSystemRelease, { once: true });
      }, fail);
    }
    acquire();
    return () => {
      live = false;
      void held?.release().catch(() => {});
    };
  }, [on, visible]);

  return { supported, on, setOn };
}
