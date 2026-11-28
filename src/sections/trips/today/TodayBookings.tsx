import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { bookingsOn } from 'src/domain/trips/prep';
import { addDays } from 'src/lib/calendar';
import { paths } from 'src/routes/paths';
import type { Trip } from 'src/schema/trip';
import { shortDate } from 'src/sections/trips/trip-dates';

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast('예약번호를 복사했어요');
  } catch {
    toast.error('예약번호를 복사하지 못했어요');
  }
}

export function TodayBookings({
  trip,
  dayIndex,
  isToday,
}: {
  trip: Trip;
  dayIndex: number;
  isToday: boolean;
}) {
  const date = addDays(trip.startDate.value, dayIndex);
  const bookings = bookingsOn(trip.bookings?.value ?? [], date);
  if (bookings.length === 0) return null;

  return (
    <Box
      component="details"
      key={date}
      sx={{
        px: 2,
        border: '1px solid var(--tm-border)',
        borderRadius: 'var(--tm-radius-md)',
        bgcolor: 'var(--tm-bg-raised)',
        overflowWrap: 'anywhere',
        '& > summary': {
          minHeight: 44,
          alignContent: 'center',
          cursor: 'pointer',
          fontWeight: 800,
        },
      }}
    >
      <summary>
        {isToday ? '오늘' : shortDate(date)} 예약 {bookings.length}
      </summary>
      <Stack component="ul" sx={{ p: 0, m: 0, listStyle: 'none', gap: 1 }}>
        {bookings.map(({ id, title, at, code, links }) => (
          <Box component="li" key={id} sx={{ pt: 1, borderTop: '1px solid var(--tm-border)' }}>
            <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
            {at && (
              <Typography variant="body2">
                <time dateTime={at}>{at.slice(11)}</time>
              </Typography>
            )}
            {code && (
              <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
                <Typography variant="body2">예약번호 {code}</Typography>
                <Button
                  aria-label={`${title} 예약번호 복사`}
                  onClick={() => void copyCode(code)}
                  sx={{ minWidth: 44, minHeight: 44 }}
                >
                  복사
                </Button>
              </Stack>
            )}
            {links[0] && (
              <Button
                href={links[0].url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ minWidth: 44, minHeight: 44 }}
              >
                {links[0].label || '예약 링크'}
              </Button>
            )}
          </Box>
        ))}
      </Stack>
      <Button component={Link} to={paths.tripPrep(trip.id)} sx={{ minHeight: 44 }}>
        준비에서 보기
      </Button>
    </Box>
  );
}
