import { createStore, Provider, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState, type ReactNode } from 'react';
import {
  createTripStore,
  TripStoreContext,
  useTripStore,
  type TripStoreDeps,
} from 'src/stores/trip-store';

/**
 * 옛 여행 화면(`TripPage`)이 지워진 뒤에도 유지 모듈(share·itinerary)을 시험하기 위한 최소 범위.
 * `TripPage`가 하던 일만 한다: 여행별 store를 만들고, jotai Provider를 두고, 원본을 불러와 `ready`가
 * 되면 `children`을 그린다. 화면 구성은 각 테스트가 정한다.
 */
export function LegacyTripScope({
  publicId,
  deps,
  jotaiStore,
  children,
}: {
  publicId: string;
  deps: TripStoreDeps;
  jotaiStore?: ReturnType<typeof createStore>;
  children: ReactNode;
}) {
  const [scope] = useState(() => ({
    tripStore: createTripStore(publicId, deps),
    store: jotaiStore ?? createStore(),
  }));
  return (
    <TripStoreContext value={scope.tripStore}>
      <Provider store={scope.store}>
        <Loaded>{children}</Loaded>
      </Provider>
    </TripStoreContext>
  );
}

function Loaded({ children }: { children: ReactNode }) {
  const ts = useTripStore();
  const state = useAtomValue(ts.loadStateAtom);
  const load = useSetAtom(ts.loadAtom);
  useEffect(() => {
    void load();
  }, [load]);
  if (state.status === 'error') return <p role="alert">{state.message}</p>;
  if (state.status !== 'ready') return <p role="status">불러오는 중…</p>;
  return <>{children}</>;
}
