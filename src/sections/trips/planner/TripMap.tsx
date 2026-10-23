import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import type { MapPadding } from 'src/components/map/MapAdapter';
import { LayersIcon } from 'src/components/icons';
import { MapView } from 'src/components/map/MapView';
import type { Trip } from 'src/schema/trip';
import { placeIdOfMarker, tripMapLayers } from 'src/sections/trips/planner/trip-map-layers';
import type { PlannedLeg } from 'src/sections/trips/planner/use-day-plan';
import { libraryAtom } from 'src/stores/library-state';

type MapFocus = { point: [number, number]; seq: number };

type Props = {
  trip: Trip;
  dayIndex: number;
  /** 고른 Day의 구간(`useDayPlan`). 경로선을 그린다. */
  legs: PlannedLeg[];
  padding: MapPadding;
  /** 카드로 보고 있는 장소. 그 핀을 강조한다. */
  cardPlaceId: string | null;
  onOpenCard(placeId: string): void;
  /**
   * 자동 나누기 미리보기(`plan[d]` = Day d에 둘 장소 id). 후보 핀을 배정될 Day 색으로 칠하고, 고른 Day의 번호를
   * 새 순서로 매기며 경로선은 숨긴다.
   */
  splitPlan?: string[][] | null;
  /** 중간 폭에서 지도를 덮는 시간표 너비. 단추 기둥도 그만큼 옮긴다. */
  controlsRight?: number;
};

/**
 * 계획 화면의 지도(스펙 §2.3). 고른 Day의 번호 핀·경로선, 출발지·숙소 핀, 회색 후보 핀, 다른 Day의 흐린 점을
 * 보인다. Day를 바꾸면(`fitKey`) 그 Day에 맞추고, 지도 밖(시간표 행·후보 행)에서 카드를 열면 그 장소로 옮긴다.
 */
export function TripMap({
  trip,
  dayIndex,
  legs,
  padding,
  cardPlaceId,
  onOpenCard,
  splitPlan = null,
  controlsRight = 0,
}: Props) {
  const library = useAtomValue(libraryAtom);
  const [showOtherDays, setShowOtherDays] = useState(true);
  const { markers, polylines } = useMemo(
    () => tripMapLayers(library, trip, dayIndex, legs, cardPlaceId, splitPlan, showOtherDays),
    [library, trip, dayIndex, legs, cardPlaceId, splitPlan, showOtherDays],
  );

  // 카드가 새 장소로 열리면 그 장소로 옮긴다(렌더 중 상태 갱신). 방금 핀을 눌러 연 장소는 이미 보이므로 그대로 둔다.
  const [seen, setSeen] = useState<string | null>(null);
  const [fromMarker, setFromMarker] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  if (seen !== cardPlaceId) {
    setSeen(cardPlaceId);
    setFromMarker(null);
    const place = cardPlaceId === null ? undefined : library.places[cardPlaceId];
    if (place !== undefined && place.deletedAt === null && fromMarker !== cardPlaceId) {
      setFocus({ point: [place.lng, place.lat], seq: (focus?.seq ?? 0) + 1 });
    }
  }

  const onMarkerClick = useCallback(
    (markerId: string) => {
      const placeId = placeIdOfMarker(markerId);
      setFromMarker(placeId);
      onOpenCard(placeId);
    },
    [onOpenCard],
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
        fitKey={`${trip.id}:${dayIndex}`}
        onUnavailable={setUnavailable}
        controlsRight={controlsRight}
        controls={
          <Button
            aria-label="다른 Day 장소"
            aria-pressed={showOtherDays}
            title={
              showOtherDays ? '다른 Day 장소 보이는 중(점 색은 해당 Day)' : '다른 Day 장소 숨김'
            }
            onClick={() => setShowOtherDays((shown) => !shown)}
            sx={{
              // 다른 지도 단추(확대·축소·내 위치)와 같은 44px 정사각형이라, 위쪽 가운데 오프라인 안내가 비워 둔
              // 양옆 자리 안에 들어간다.
              minWidth: 44,
              width: 44,
              height: 44,
              p: 0,
              bgcolor: showOtherDays ? 'var(--tm-accent-main)' : 'var(--tm-bg-surface)',
              color: showOtherDays ? 'var(--tm-accent-contrast)' : 'var(--tm-text-primary)',
              border: '1px solid var(--tm-border-strong, var(--tm-border))',
              borderRadius: 'var(--tm-radius-md)',
              boxShadow: 'var(--tm-shadow-1)',
              '&:hover': {
                bgcolor: showOtherDays ? 'var(--tm-accent-main)' : 'var(--tm-bg-raised)',
              },
            }}
          >
            <LayersIcon aria-hidden="true" width={20} height={20} />
          </Button>
        }
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
