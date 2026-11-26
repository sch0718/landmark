import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useAtomValue, useSetAtom } from 'jotai';
import { dayEndpoints, tripDates, visibleStops } from 'src/domain/trips/query';
import type { Trip } from 'src/schema/trip';
import { shortDate } from 'src/sections/trips/trip-dates';
import { libraryAtom } from 'src/stores/library-state';
import { mapCardAtom } from 'src/stores/trip-planner';

/** 전체 보기의 시간표 자리: Day별 장소 이름과 숙소 한 줄. 행을 누르면 그 장소 카드를 연다. */
export function OverviewList({ trip }: { trip: Trip }) {
  const library = useAtomValue(libraryAtom);
  const setCard = useSetAtom(mapCardAtom);
  const dates = tripDates(trip);
  const openCard = (placeId: string) => setCard({ tripId: trip.id, placeId });

  return (
    <Box sx={{ p: 1.5 }}>
      {trip.days.map((day, d) => {
        const date = dates[d];
        const { end } = dayEndpoints(library, trip, d);
        const stops = visibleStops(library, day);

        return (
          <Box key={d} sx={{ mb: 1.5 }}>
            <Box component="h2" sx={{ m: 0, px: 1, fontSize: 15, fontWeight: 800 }}>
              {`Day ${d + 1}`}
              {date === undefined ? '' : ` ${shortDate(date)}`}
            </Box>
            {stops.length === 0 && end === null && (
              <Box sx={{ px: 1, fontSize: 13, color: 'var(--tm-text-secondary)' }}>
                이 날은 아직 일정이 없어요
              </Box>
            )}
            {stops.map((stop, i) => (
              <Button
                key={stop.id}
                fullWidth
                onClick={() => openCard(stop.placeId)}
                sx={{
                  minHeight: 44,
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  textTransform: 'none',
                }}
              >
                {`${i + 1}. ${library.places[stop.placeId]!.name.value}`}
              </Button>
            ))}
            {end !== null && (
              <Button
                fullWidth
                onClick={() => openCard(end.id)}
                sx={{
                  minHeight: 44,
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  textTransform: 'none',
                }}
              >
                {`숙소 · ${end.name.value}`}
              </Button>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
