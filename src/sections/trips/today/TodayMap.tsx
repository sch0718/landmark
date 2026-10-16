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

/** 지도를 그 장소로 옮겨 달라는 요청. `seq`가 바뀔 때마다 한 번 옮긴다. */
export type TodayFocusRequest = { placeId: string; seq: number };

type Props = {
  trip: Trip;
  model: TodayModel;
  /** 카드가 보는 장소. 그 핀을 강조한다. */
  selectedPlaceId: string | null;
  /** 사람이 장소를 골랐을 때(행 누름·`다음 장소 보기`)만 화면이 준다. 체크·되돌리기·삭제로는 바뀌지 않는다. */
  focusRequest: TodayFocusRequest | null;
  /** 그날 Stop 핀을 눌렀다(출발점·숙소 핀은 알리지 않는다). */
  onPick(placeId: string): void;
  padding: MapPadding;
  /** 내 위치 점과 정확도 원. 없으면 그리지 않는다. */
  myLocation?: { lng: number; lat: number; accuracyM: number } | null;
};

/**
 * 당일 모드 지도(스펙 §5.4). 그날 번호 핀·출발점·숙소·경로선만 보이고, 다녀온 Stop 핀은 흐리게 한다.
 * Day를 바꾸면(`fitKey`) 그날에 맞춘다. 지도를 옮기는 것은 `focusRequest`뿐이다 — 사람이 고른 때만 옮기고,
 * 체크로 다음 장소가 넘어가거나 되돌리기·다른 탭 삭제로 카드가 바뀔 때는 옮기지도 다시 맞추지도 않는다
 * (보던 지도가 저절로 움직이지 않게). 방금 누른 핀은 이미 보이므로 옮기지 않는다.
 */
export function TodayMap({
  trip,
  model,
  selectedPlaceId,
  focusRequest,
  onPick,
  padding,
  myLocation,
}: Props) {
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

  // `MapView`는 `seq`가 바뀔 때만 옮기므로, 문서가 바뀌어 다시 계산해도(같은 `seq`) 지도는 그대로다.
  // 그사이 장소가 지워졌으면 옮기지 않는다.
  const focus = useMemo((): MapFocus | null => {
    if (focusRequest === null) return null;
    const place = library.places[focusRequest.placeId];
    if (place === undefined || place.deletedAt !== null) return null;
    return { point: [place.lng, place.lat], seq: focusRequest.seq };
  }, [focusRequest, library]);

  const onMarkerClick = useCallback(
    (markerId: string) => {
      const placeId = placeIdOfMarker(markerId);
      if (placeId !== markerId) return; // 출발점·숙소 핀
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
