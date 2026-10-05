import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router';
import { useTripStore, type TripStore, type LoadState } from 'src/stores/trip-store';
import { selectedPlaceAtom } from 'src/stores/ui-store';
import { detailAtom } from './store/view-session';
import type { TripData } from 'src/schema/trip-data';

type HandledPlace = {
  owner: TripStore;
  load: LoadState;
  place: string | null;
  suppressed?: boolean;
  invalidTrip?: TripData;
  locationKey: string;
};

export function useUrlPlaceDetailSync(uiReady: boolean): void {
  const ts = useTripStore();
  const store = useStore();
  const trip = useAtomValue(ts.tripAtom);
  const load = useAtomValue(ts.loadStateAtom);
  const [params] = useSearchParams();
  const urlPlace = params.get('place') || null;
  const location = useLocation();
  const navigationType = useNavigationType();
  const fromUi =
    navigationType === 'REPLACE' &&
    location.state !== null &&
    typeof location.state === 'object' &&
    (location.state as Record<string, unknown>).tripMapUiQuery === params.toString();
  // 선택 변경 시 다시 판정하되 effect에서는 다른 URL effect가 갱신한 최신 store 값을 읽는다.
  const selectedPlace = useAtomValue(selectedPlaceAtom);
  const setSelected = useSetAtom(selectedPlaceAtom);
  const setDetail = useSetAtom(detailAtom);
  // 같은 URL의 재렌더는 건너뛰고, 억제된 UI 쓰기는 새 외부 탐색에서 다시 처리한다.
  const lastHandledUrlPlace = useRef<HandledPlace | null>(null);
  // URL 반영 전에 닫힌 상세를 자신의 늦은 REPLACE가 다시 열지 않게 한다.
  const dismissedPlace = useRef<string | null>(null);

  useEffect(() => {
    let previous = store.get(detailAtom);
    return store.sub(detailAtom, () => {
      const current = store.get(detailAtom);
      if (previous?.kind === 'place' && current === null)
        dismissedPlace.current = previous.placeKey;
      else if (current?.kind === 'place') dismissedPlace.current = null;
      previous = current;
    });
  }, [store]);

  useEffect(() => {
    if (!uiReady || !trip || load.status !== 'ready') {
      lastHandledUrlPlace.current = null;
      setDetail(null);
      dismissedPlace.current = null;
      return;
    }
    const previous = lastHandledUrlPlace.current;
    const same =
      previous?.owner === ts &&
      previous.load === load &&
      previous.place === urlPlace &&
      (!previous.suppressed || fromUi || previous.locationKey === location.key);
    if (urlPlace && !Object.hasOwn(trip.places, urlPlace)) {
      if (same && previous.invalidTrip === trip && previous.locationKey === location.key) return;
      lastHandledUrlPlace.current = {
        owner: ts,
        load,
        place: urlPlace,
        invalidTrip: trip,
        locationKey: location.key,
      };
      setSelected(null);
      setDetail((current) =>
        current?.kind === 'place' || current?.kind === 'add' ? null : current,
      );
      dismissedPlace.current = null;
      return;
    }
    if (fromUi && urlPlace !== store.get(selectedPlaceAtom)) return;
    if (same) return;
    if (
      urlPlace &&
      previous?.owner === ts &&
      previous.load === load &&
      fromUi &&
      dismissedPlace.current === urlPlace
    ) {
      lastHandledUrlPlace.current = {
        owner: ts,
        load,
        place: urlPlace,
        suppressed: true,
        locationKey: location.key,
      };
      return;
    }
    lastHandledUrlPlace.current = { owner: ts, load, place: urlPlace, locationKey: location.key };
    if (urlPlace) {
      setDetail({ kind: 'place', placeKey: urlPlace });
    } else {
      setDetail((current) =>
        current?.kind === 'place' || current?.kind === 'add' ? null : current,
      );
      dismissedPlace.current = null;
    }
  }, [
    uiReady,
    trip,
    load,
    urlPlace,
    fromUi,
    location.key,
    selectedPlace,
    ts,
    store,
    setSelected,
    setDetail,
  ]);
}
