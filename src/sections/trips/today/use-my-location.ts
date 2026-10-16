import { Effect } from 'effect';
import { useCallback, useEffect, useState } from 'react';
import { startEffectSync } from 'src/lib/effect/runtime';
import { Geolocation, type GeoFix } from 'src/services/geolocation';

/**
 * 당일 모드의 내 위치 상태(스펙 §4.7·§5.5). 화면 상태라 저장하지 않고, F4의 `myLocationAtom`에도 쓰지 않는다.
 * - `off`: 아직 켜지 않음(`내 위치 켜기`). `watching`: 지켜보는 중(받은 위치가 없으면 `fix`가 null).
 * - `denied`·`unavailable`·`timeout`·`unsupported`: 마지막 오류. `timeout`·`unavailable`은 계속 지켜본다.
 */
export type LocationState =
  | { status: 'unsupported' }
  | { status: 'off' }
  | { status: 'watching'; fix: GeoFix | null }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'timeout' };

const WATCHING: LocationState = { status: 'watching', fix: null };

/** 감시를 걸어 둘 상태인가. 거절·미지원이면 더 받을 수 없으므로 다시 걸지 않는다. */
const armed = (state: LocationState): boolean =>
  state.status === 'watching' || state.status === 'unavailable' || state.status === 'timeout';

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * 내 위치를 화면이 보이는 동안만 지켜본다(`Geolocation.watch`). 숨으면(`visibilitychange` → `hidden`) 해제하고
 * 다시 보이면 다시 건다. 브라우저 권한이 이미 `granted`면 들어오자마자 켜고, 아니면 `start()`(사람의 누름)를 기다린다.
 * `start()`는 `다시 시도`도 겸한다(감시를 새로 건다). 좌표는 화면 상태에만 두고 찍지도 저장하지도 않는다.
 */
export function useMyLocation(): { state: LocationState; start(): void } {
  const [geo] = useState(() =>
    startEffectSync(
      Effect.gen(function* () {
        return yield* Geolocation;
      }),
    ),
  );
  const [state, setState] = useState<LocationState>({ status: 'off' });
  // 늘 때마다 감시를 새로 건다(`다시 시도`).
  const [session, setSession] = useState(0);
  const [visible, setVisible] = useState(isVisible);

  const start = useCallback(() => {
    setState(WATCHING);
    setSession((n) => n + 1);
  }, []);

  useEffect(() => {
    const onVisibility = () => setVisible(isVisible());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // 권한이 이미 있으면 묻지 않고 켠다. 그사이 사람이 켰으면 그대로 둔다. 조회할 수 없으면 버튼을 기다린다.
  useEffect(() => {
    let live = true;
    try {
      const query = navigator.permissions?.query({ name: 'geolocation' });
      query?.then(
        (permission) => {
          if (live && permission.state === 'granted') {
            setState((prev) => (prev.status === 'off' ? WATCHING : prev));
          }
        },
        () => {},
      );
    } catch {
      // 이 브라우저는 위치 권한 조회를 모른다.
    }
    return () => {
      live = false;
    };
  }, []);

  const on = armed(state);
  useEffect(() => {
    if (!on || !visible) return;
    let live = true;
    const stop = geo.watch(
      (fix) => {
        if (live) setState({ status: 'watching', fix });
      },
      (error) => {
        // 거절이면 서비스가 스스로 해제했다. `on`이 꺼지므로 다시 보여도 걸지 않는다.
        if (live) setState({ status: error.reason });
      },
    );
    return () => {
      live = false;
      stop();
    };
  }, [geo, on, visible, session]);

  return { state, start };
}
