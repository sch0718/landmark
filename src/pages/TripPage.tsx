import Box from '@mui/material/Box';
import { createStore, Provider, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useContext, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { ErrorScreen } from 'src/components/ErrorScreen';
import { NicknameDialog } from 'src/components/NicknameDialog';
import { ReconcileBanner } from 'src/components/ReconcileBanner';
import type { MapPadding } from 'src/components/map/MapAdapter';
import { MapView } from 'src/components/map/MapView';
import { keepMine } from 'src/domain/reconcile';
import { TripLayout } from 'src/layouts/TripLayout';
import { useLayoutKind } from 'src/layouts/layout-metrics';
import {
  mapBoundsAtom,
  mapFocusAtom,
  mapViewportUsableAtom,
  useExploreMarkers,
} from 'src/sections/explore/store/explore-state';
import { ExplorePanel } from 'src/sections/explore/view/ExplorePanel';
import { PlacesPanel } from 'src/sections/explore/view/PlacesPanel';
import {
  useItineraryLayers,
  useItineraryMarkerClick,
} from 'src/sections/itinerary/store/itinerary-state';
import { ItineraryPanel } from 'src/sections/itinerary/view/ItineraryPanel';
import {
  detailAtom,
  mobileRouteMapAtom,
  selectedPlaceScrollRequestAtom,
} from 'src/sections/views/store/view-session';
import { DetailSurface } from 'src/sections/views/view/DetailSurface';
import { TripToolbar } from 'src/sections/views/view/TripToolbar';
import { useViewQuerySync } from 'src/sections/views/use-view-query-sync';
import { useUrlPlaceDetailSync } from 'src/sections/views/use-url-place-detail-sync';
import {
  createTripStore,
  TripDepsContext,
  TripStoreContext,
  useTripStore,
} from 'src/stores/trip-store';
import { modeAtom, selectedDayAtom, selectedPlaceAtom, viewModeAtom } from 'src/stores/ui-store';

/** `/t/:publicId` — publicId가 바뀌면 store를 새로 만든다. */
export function TripRoute() {
  const { publicId = '' } = useParams();
  return <TripPage key={publicId} publicId={publicId} />;
}

export function TripPage({ publicId }: { publicId: string }) {
  const deps = useContext(TripDepsContext);
  const [scope] = useState(() => ({
    tripStore: createTripStore(publicId, deps),
    store: deps.jotaiStore ?? createStore(),
  }));
  return (
    <TripStoreContext value={scope.tripStore}>
      <Provider store={scope.store}>
        <TripScreen />
      </Provider>
    </TripStoreContext>
  );
}

function TripScreen() {
  const ts = useTripStore();
  const loadState = useAtomValue(ts.loadStateAtom);
  const load = useSetAtom(ts.loadAtom);
  const uiReady = useViewQuerySync();
  useUrlPlaceDetailSync(uiReady);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState.status === 'error') {
    if (loadState.kind === 'not-found') return <ErrorScreen title={loadState.message} />;
    return (
      <ErrorScreen
        title="여행 데이터를 읽지 못했어요"
        details={[`schemaVersion: ${String(loadState.schemaVersion ?? '없음')}`, loadState.message]}
      />
    );
  }

  return (
    <>
      {loadState.status === 'ready' && uiReady ? (
        <ReadyTrip />
      ) : (
        <Box sx={{ p: 3 }} role="status">
          불러오는 중…
        </Box>
      )}
      <NicknamePrompt />
    </>
  );
}

function ReadyTrip() {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const setMapUnavailable = useSetAtom(ts.mapUnavailableAtom);
  const unavailable = useAtomValue(ts.mapUnavailableAtom);
  const view = useAtomValue(viewModeAtom);
  const mode = useAtomValue(modeAtom);
  const day = useAtomValue(selectedDayAtom);
  const layout = useLayoutKind();
  const routeMapVisible = useAtomValue(mobileRouteMapAtom);
  const [detail, setDetail] = useAtom(detailAtom);
  const setSelectedPlace = useSetAtom(selectedPlaceAtom);
  const setScrollRequest = useSetAtom(selectedPlaceScrollRequestAtom);
  const setBounds = useSetAtom(mapBoundsAtom);
  const bounds = useAtomValue(mapBoundsAtom);
  const setUsable = useSetAtom(mapViewportUsableAtom);
  const [mapReady, setMapReady] = useState(false);
  const [padding, setPadding] = useState<MapPadding>({ top: 24, right: 24, bottom: 24, left: 24 });
  const mapVisible =
    !unavailable &&
    (view === 'map' || (view === 'day' && (layout !== 'compact' || routeMapVisible)));
  useEffect(() => {
    setUsable(mapReady && mapVisible && bounds !== null && !unavailable);
  }, [mapReady, mapVisible, bounds, unavailable, setUsable]);
  const focus = useAtomValue(mapFocusAtom);
  const exploreMarkers = useExploreMarkers();
  const itinerary = useItineraryLayers();
  const onItineraryMarkerClick = useItineraryMarkerClick();
  const panel =
    view === 'day' ? <ItineraryPanel /> : view === 'places' ? <PlacesPanel /> : <ExplorePanel />;
  return (
    <TripLayout
      topBar={
        <>
          <TripToolbar />
          <ConnectedReconcileBanner />
        </>
      }
      map={
        <MapView
          visible={mapVisible}
          padding={padding}
          onReadyChange={setMapReady}
          markers={mode === 'explore' ? exploreMarkers : itinerary.markers}
          polylines={mode === 'itinerary' ? itinerary.polylines : []}
          onMarkerClick={(id) => {
            if (mode === 'itinerary' && id.startsWith('candidate/')) {
              onItineraryMarkerClick(id);
              return;
            }
            const key = mode === 'itinerary' && day === 'all' ? id.slice(11) : id;
            if (!trip || !Object.hasOwn(trip.places, key)) return;
            setSelectedPlace(key);
            setDetail({ kind: 'place', placeKey: key });
            setScrollRequest((n) => n + 1);
          }}
          onBoundsChange={setBounds}
          focus={focus}
          fitKey={mode === 'itinerary' ? `itinerary:${day}` : 'explore'}
          onUnavailable={setMapUnavailable}
        />
      }
      panel={panel}
      detail={{
        open: detail !== null,
        content: <DetailSurface modal={layout !== 'wide'} onClose={() => setDetail(null)} />,
        onClose: () => setDetail(null),
      }}
      view={view}
      layout={layout}
      unavailable={unavailable}
      routeMapVisible={routeMapVisible}
      onMapPaddingChange={setPadding}
    />
  );
}

function ConnectedReconcileBanner() {
  const ts = useTripStore();
  const report = useAtomValue(ts.reconcileReportAtom);
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const effective = useAtomValue(ts.effectiveTripAtom);
  const keepMineGroup = useSetAtom(ts.keepMineAtom);
  const revertGroup = useSetAtom(ts.revertGroupAtom);
  if (!report || !trip || !effective) return null;

  const dayNumber = new Map(trip.days.map((d, i) => [d.date, i + 1]));
  const unresolved = new Set(effective.days.filter((d) => d.unresolved).map((d) => d.date));
  return (
    <ReconcileBanner
      report={report}
      isUnresolved={(date) => unresolved.has(date)}
      dayLabel={(date) => `Day ${dayNumber.get(date) ?? date}`}
      canKeepMine={(dates) => edit !== null && keepMine(trip, edit, dates, ts.nowIso()) !== null}
      onRevert={(dates) => {
        revertGroup(dates).catch(reportSaveError);
      }}
      onKeepMine={(dates) => {
        keepMineGroup(dates).catch(reportSaveError);
      }}
    />
  );
}

function NicknamePrompt() {
  const ts = useTripStore();
  const request = useAtomValue(ts.nicknameRequestAtom);
  return (
    <NicknameDialog
      open={request !== null}
      initialValue={request?.initial}
      onCancel={() => request?.resolve(null)}
      onSubmit={(nickname) => request?.resolve(nickname)}
    />
  );
}

function reportSaveError(e: unknown) {
  console.warn('편집을 저장하지 못했어요', e);
  toast.error('편집을 저장하지 못했어요');
}
