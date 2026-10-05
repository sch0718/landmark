import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router';
import dayjs from 'dayjs';
import { useTripStore } from 'src/stores/trip-store';
import {
  viewModeAtom,
  selectedDayAtom,
  selectedPlaceAtom,
  uiQueryReadyAtom,
  parseViewQuery,
  buildViewQuery,
  viewStateKey,
  type UiQuerySession,
} from 'src/stores/ui-store';
import { itineraryEditingAtom } from './store/view-session';
import { readPreferredView, writePreferredView } from './store/ui-preferences';

type AppliedQuery = {
  session: UiQuerySession;
  url: string;
  locationKey: string;
  pendingUrl?: string;
  dates: string;
  state: string;
  atoms: string;
};

export function useViewQuerySync(): boolean {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const loadState = useAtomValue(ts.loadStateAtom);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [view, setView] = useAtom(viewModeAtom);
  const [day, setDay] = useAtom(selectedDayAtom);
  const [place, setPlace] = useAtom(selectedPlaceAtom);
  const ready = useAtomValue(uiQueryReadyAtom);
  const setReady = useSetAtom(uiQueryReadyAtom);
  const setEditing = useSetAtom(itineraryEditingAtom);
  // 확정 URL과 대기 중인 UI 쓰기를 구분해 늦은 URL 완료가 최신 atom을 되돌리지 않게 한다.
  const last = useRef<AppliedQuery | null>(null);

  useEffect(() => {
    if (!trip || loadState.status !== 'ready') {
      last.current = null;
      setReady(false);
      return;
    }
    const session = { owner: ts, load: loadState, trip };
    if (
      last.current &&
      (last.current.session.owner !== ts ||
        last.current.session.load !== loadState ||
        last.current.session.trip !== trip)
    ) {
      last.current = null;
      setReady(false);
    }
    const dates = trip.days.map((d) => d.date);
    const datesKey = JSON.stringify(dates);
    const url = params.toString();
    const atoms = viewStateKey({ view, day, place });
    const previous = last.current;
    const fromUi =
      previous?.pendingUrl === url &&
      navigationType === 'REPLACE' &&
      location.state !== null &&
      typeof location.state === 'object' &&
      (location.state as Record<string, unknown>).tripMapUiQuery === url;
    if (
      previous === null ||
      ((previous.url !== url || previous.locationKey !== location.key) && !fromUi) ||
      previous.dates !== datesKey
    ) {
      const parsed = parseViewQuery(
        params,
        dates,
        readPreferredView(ts.repoDeps.storage, ts.publicId),
        dayjs(ts.nowIso()).format('YYYY-MM-DD'),
      );
      const fromUrl = {
        ...parsed,
        place: parsed.place && Object.hasOwn(trip.places, parsed.place) ? parsed.place : null,
      };
      const state = viewStateKey(fromUrl);
      last.current = { session, url, locationKey: location.key, dates: datesKey, state, atoms };
      if (state !== atoms) {
        if (fromUrl.view !== view || fromUrl.day !== day) setEditing(false);
        setView(fromUrl.view);
        setDay(fromUrl.day);
        setPlace(fromUrl.place);
      }
      writePreferredView(ts.repoDeps.storage, ts.publicId, fromUrl.view);
      setReady(session);
      return;
    }
    const applied = fromUi
      ? { ...previous, url, locationKey: location.key, pendingUrl: undefined }
      : previous;
    last.current = { ...applied, atoms };
    if (atoms === previous.atoms) return;
    if (atoms === previous.state) return;
    const next = buildViewQuery(params, { view, day, place }, dates);
    last.current = {
      session,
      url,
      locationKey: location.key,
      pendingUrl: next.toString(),
      dates: datesKey,
      state: atoms,
      atoms,
    };
    writePreferredView(ts.repoDeps.storage, ts.publicId, view);
    const state =
      location.state !== null &&
      typeof location.state === 'object' &&
      !Array.isArray(location.state)
        ? (location.state as Record<string, unknown>)
        : {};
    setParams(next, { replace: true, state: { ...state, tripMapUiQuery: next.toString() } });
  }, [
    trip,
    loadState,
    params,
    setParams,
    location.state,
    location.key,
    navigationType,
    view,
    day,
    place,
    setView,
    setDay,
    setPlace,
    setReady,
    setEditing,
    ts,
  ]);

  return (
    loadState.status === 'ready' &&
    !!trip &&
    ready !== false &&
    ready.owner === ts &&
    ready.load === loadState &&
    ready.trip === trip
  );
}
