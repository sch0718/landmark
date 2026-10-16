import Box from '@mui/material/Box';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import type { MapPadding } from 'src/components/map/MapAdapter';
import { MapView } from 'src/components/map/MapView';
import type { Trip } from 'src/schema/trip';
import { placeIdOfMarker } from 'src/sections/trips/planner/trip-map-layers';
import { todayMapLayers } from 'src/sections/trips/today/today-map-layers';
import type { TodayModel } from 'src/sections/trips/today/use-today';
import { libraryAtom } from 'src/stores/library-state';

type MapFocus = { point: [number, number]; seq: number };

type Props = {
  trip: Trip;
  model: TodayModel;
  /** 카드가 보는 장소. 그 핀을 강조하고, 바뀌면 지도를 그곳으로 옮긴다. */
  selectedPlaceId: string | null;
  /** 그날 Stop 핀을 눌렀다(출발점·숙소 핀은 알리지 않는다). */
  onPick(placeId: string): void;
  padding: MapPadding;
  /** 내 위치 점과 정확도 원. 없으면 그리지 않는다. */
  myLocation?: { lng: number; lat: number; accuracyM: number } | null;
};

/**
 * 당일 모드 지도(스펙 §5.4). 그날 번호 핀·출발점·숙소·경로선만 보이고, 다녀온 Stop 핀은 흐리게 한다.
 * Day를 바꾸면(`fitKey`) 그날에 맞추고, 카드가 보는 장소가 바뀌면 그곳으로 옮긴다(처음 그릴 때와 Day를 바꿀 때,
 * 방금 누른 핀은 옮기지 않는다). 다녀옴 체크로는 다시 맞추지 않는다.
 */
export function TodayMap({ trip, model, selectedPlaceId, onPick, padding, myLocation }: Props) {
  const library = useAtomValue(libraryAtom);
  const { dayIndex, plan, stops } = model;
  const visited = useMemo(
    () => new Set(stops.filter((s) => s.visited).map((s) => s.place.id)),
    [stops],
  );
  const { markers, polylines } = useMemo(
    () => todayMapLayers(library, trip, dayIndex, plan.legs, { visited, selectedPlaceId }),
    [library, trip, dayIndex, plan.legs, visited, selectedPlaceId],
  );

  // 카드의 장소가 바뀌면 그곳으로 옮긴다(렌더 중 상태 갱신). 처음과 Day를 바꾼 때는 `fitKey` 맞추기에 맡긴다.
  const [seen, setSeen] = useState({ dayIndex, placeId: selectedPlaceId });
  const [fromMarker, setFromMarker] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  if (seen.dayIndex !== dayIndex || seen.placeId !== selectedPlaceId) {
    const sameDay = seen.dayIndex === dayIndex;
    setSeen({ dayIndex, placeId: selectedPlaceId });
    setFromMarker(null);
    const place = selectedPlaceId === null ? undefined : library.places[selectedPlaceId];
    if (
      sameDay &&
      place !== undefined &&
      place.deletedAt === null &&
      fromMarker !== selectedPlaceId
    ) {
      setFocus({ point: [place.lng, place.lat], seq: (focus?.seq ?? 0) + 1 });
    }
  }

  const onMarkerClick = useCallback(
    (markerId: string) => {
      const placeId = placeIdOfMarker(markerId);
      if (placeId !== markerId) return; // 출발점·숙소 핀
      setFromMarker(placeId);
      onPick(placeId);
    },
    [onPick],
  );

  const [unavailable, setUnavailable] = useState<string | null>(null);

  return (
    <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'var(--tm-bg-raised)' }}>
      <MapView
        markers={markers}
        polylines={polylines}
        padding={padding}
        onMarkerClick={onMarkerClick}
        focus={focus}
        fitKey={`${trip.id}:today:${dayIndex}`}
        myLocation={myLocation ?? null}
        onUnavailable={setUnavailable}
      />
      {unavailable !== null && (
        <Box
          role="status"
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 3,
            textAlign: 'center',
            bgcolor: 'var(--tm-bg-raised)',
            color: 'var(--tm-text-secondary)',
          }}
        >
          {unavailable}
        </Box>
      )}
    </Box>
  );
}
