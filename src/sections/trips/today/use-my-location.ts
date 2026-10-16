import { Effect } from 'effect';
import { useCallback, useEffect, useState } from 'react';
import { startEffectSync } from 'src/lib/effect/runtime';
import { Geolocation, type GeoFix } from 'src/services/geolocation';

/**
 * 당일 모드의 내 위치 상태(스펙 §4.7·§5.5). 화면 상태라 저장하지 않고, F4의 `myLocationAtom`에도 쓰지 않는다.
 * - `off`: 아직 켜지 않음(`내 위치 켜기`). `watching`: 지켜보는 중(받은 위치가 없으면 `fix`가 null).
 * - `unavailable`·`timeout`: 마지막 오류. 계속 지켜보고, 그 전에 받은 마지막 위치(`fix`)를 그대로 둔다
 *   (낡았는지는 쓰는 쪽이 `usableFix`로 본다).
 * - `denied`·`unsupported`: 더 받을 수 없다. 위치도 버린다.
 */
export type LocationState =
  | { status: 'unsupported' }
  | { status: 'off' }
  | { status: 'watching'; fix: GeoFix | null }
  | { status: 'denied' }
  | { status: 'unavailable'; fix: GeoFix | null }
  | { status: 'timeout'; fix: GeoFix | null };

/** 지켜보는 동안(오류 뒤 포함)의 마지막 위치. 켜지 않았거나 거절·미지원이면 null. */
export function lastFixOf(state: LocationState): GeoFix | null {
  return 'fix' in state ? state.fix : null;
}

/** 감시를 걸어 둘 상태인가. 거절·미지원이면 더 받을 수 없으므로 다시 걸지 않는다. */
const armed = (state: LocationState): boolean =>
  state.status === 'watching' || state.status === 'unavailable' || state.status === 'timeout';

/** 감시를 (다시) 건 상태. 마지막 위치는 이어 둔다. */
const watching = (prev: LocationState): LocationState => ({
  status: 'watching',
  fix: lastFixOf(prev),
});

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
    setState(watching);
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
            setState((prev) => (prev.status === 'off' ? watching(prev) : prev));
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
        if (!live) return;
        const { reason } = error;
        // 거절·미지원이면 서비스가 스스로 해제했다(미지원은 처음부터 걸지 않음). `on`이 꺼지므로 다시 보여도
        // 걸지 않고, 위치도 버린다. 못 찾음·시간 초과는 계속 지켜보며 마지막 위치를 둔다.
        if (reason === 'denied' || reason === 'unsupported') setState({ status: reason });
        else setState((prev) => ({ status: reason, fix: lastFixOf(prev) }));
      },
    );
    return () => {
      live = false;
      stop();
    };
  }, [geo, on, visible, session]);

  return { state, start };
}
