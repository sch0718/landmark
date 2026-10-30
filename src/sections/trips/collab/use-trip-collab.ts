import { Cause, ErrorReporter } from 'effect';
import { useAtomValue, useStore } from 'jotai';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { legBetween } from 'src/domain/trips/query';
import { ESTIMATE_ONLY } from 'src/domain/trip-live/build-live-doc';
import { startEffect } from 'src/lib/effect/runtime';
import { useTripLegs } from 'src/sections/share-export/use-trip-legs';
import { tripCollabApi } from 'src/services/trip-collab/client';
import { tripCollabStore, useTripCollabRecord } from 'src/services/trip-collab/store';
import { tripLiveStore } from 'src/services/trip-live/store';
import { newLiveId } from 'src/services/trip-live/tokens';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
import {
  collabEngineFor,
  type CollabEngine,
  type CollabEngineDeps,
  type CollabSnapshot,
} from './collab-engine';
export type CollabView = CollabSnapshot & { engine: CollabEngine | null };
const IDLE: CollabSnapshot = {
  state: 'idle',
  record: undefined,
  merge: null,
  syncedAt: null,
  changedBy: null,
  changedAt: null,
  members: 0,
  progress: null,
};
const noSubscribe = () => () => undefined;
const idleSnapshot = () => IDLE;
export function useCollabDeps(tripId: string, active: boolean): CollabEngineDeps {
  const jotai = useStore(),
    { run } = useLibraryAction(),
    legs = useTripLegs(tripId, active);
  const latestLegs = useRef(legs);
  useEffect(() => {
    latestLegs.current = legs;
  }, [legs]);
  return useMemo(
    () => ({
      tripId,
      api: tripCollabApi,
      store: tripCollabStore,
      liveStore: tripLiveStore,
      getLibrary: () => jotai.get(libraryAtom),
      run,
      routeOf: () => (from, to) => {
        const lib = jotai.get(libraryAtom),
          trip = lib.trips[tripId],
          map = tripCollabStore.get(tripId)?.placeMap ?? {},
          a = lib.places[map[from] ?? from],
          b = lib.places[map[to] ?? to];
        if (!trip || !a || !b) return { mode: 'car', time: ESTIMATE_ONLY({} as never) };
        const leg = legBetween(trip, a, b);
        return { mode: leg.mode, time: latestLegs.current.routeOf(leg) };
      },
      now: () => new Date(),
      newPlaceId: newLiveId,
      locks: navigator.locks ?? null,
      win: window,
      reportError: (error) => {
        void startEffect(ErrorReporter.report(Cause.fail(error)));
      },
    }),
    [tripId, jotai, run],
  );
}
export function useTripCollab(tripId: string, active: boolean): CollabView {
  const record = useTripCollabRecord(tripId),
    library = useAtomValue(libraryAtom),
    deps = useCollabDeps(tripId, active && record?.status === 'live');
  const engine = useMemo(
    () => (record ? collabEngineFor(tripId, () => deps) : null),
    [tripId, record, deps],
  );
  const snapshot = useSyncExternalStore(
    engine?.subscribe ?? noSubscribe,
    engine?.getSnapshot ?? idleSnapshot,
  );
  useEffect(() => (active && engine ? engine.retain() : undefined), [engine, active]);
  useEffect(() => {
    if (active) engine?.localChanged();
  }, [engine, active, library]);
  return { ...snapshot, engine };
}
