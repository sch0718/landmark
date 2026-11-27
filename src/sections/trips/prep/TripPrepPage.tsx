import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { XIcon } from 'src/components/icons';
import {
  bookNow,
  BOOKING_COUNT_MESSAGE,
  checkTripSize,
  filterBookings,
  groupByDate,
  putBooking,
  removeBooking,
  summarizeBookings,
  type BookingFilter,
} from 'src/domain/trips/bookings';
import { localToday } from 'src/domain/trips/query';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import type { Library } from 'src/schema/library';
import { BOOKINGS_MAX, type Booking, type Trip } from 'src/schema/trip';
import { TripNotFound } from 'src/sections/trips/TripNotFound';
import { useTripUndo } from 'src/sections/trips/planner/use-trip-undo';
import { shortDate } from 'src/sections/trips/trip-dates';
import { libraryAtom } from 'src/stores/library-state';
import { BookingSheet } from './BookingSheet';
import { NEED_LABELS, STATUS_LABELS } from './booking-labels';

const FILTERS = [
  ['all', '전체'],
  ['todo', '할 것만'],
  ['open', '아직 안 한 것'],
] as const;

const formatAmount = ({ currency, amount }: { currency: string; amount: number }) =>
  new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 20,
  }).format(amount);

function LocalTime({ value }: { value: string }) {
  return <time dateTime={value}>{value.replace('T', ' ')}</time>;
}

function Prep({ trip, library }: { trip: Trip; library: Library }) {
  const [filter, setFilter] = useState<BookingFilter>('all');
  const [editor, setEditor] = useState<{ booking: Booking | null } | null>(null);
  const { run } = useTripUndo(trip.id, checkTripSize);
  const bookings = trip.bookings?.value ?? [];
  const summary = summarizeBookings(bookings);
  const now = bookNow(bookings, localToday());
  const groups = groupByDate(filterBookings(bookings, filter));
  const full = bookings.length >= BOOKINGS_MAX;
  const closeEditor = () => setEditor(null);

  return (
    <Stack sx={{ maxWidth: 760, mx: 'auto', px: { xs: 2, sm: 3 }, py: 2, gap: 2.5 }}>
      <Stack component="header" direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography
          component="h1"
          sx={{ flex: 1, minWidth: 0, fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}
        >
          {trip.title.value} · 준비
        </Typography>
        <IconButton
          component={Link}
          to={paths.trip(trip.id)}
          aria-label="준비 닫기"
          sx={{ width: 44, height: 44 }}
        >
          <XIcon aria-hidden="true" width={22} height={22} />
        </IconButton>
      </Stack>

      <Stack
        component="section"
        aria-label="예약 집계"
        sx={{
          gap: 1,
          p: 2,
          border: '1px solid var(--tm-border)',
          borderRadius: 'var(--tm-radius-md)',
          bgcolor: 'var(--tm-bg-raised)',
        }}
      >
        <Typography sx={{ fontWeight: 800 }}>
          예약함 {summary.booked} / {summary.total}
        </Typography>
        <LinearProgress
          aria-label="예약 진행률"
          variant="determinate"
          value={summary.total === 0 ? 0 : (summary.booked / summary.total) * 100}
          sx={{ height: 6, borderRadius: 3 }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          필수인데 아직 {summary.requiredLeft}
          {summary.totals.length > 0 &&
            ` · 적은 금액 ${summary.totals.map(formatAmount).join(' · ')}`}
        </Typography>
      </Stack>

      {now.length > 0 && (
        <Box component="section" aria-labelledby="book-now-heading">
          <Typography id="book-now-heading" component="h2" sx={{ mb: 0.5, fontWeight: 800 }}>
            지금 예약할 것
          </Typography>
          <Stack component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {now.map(({ booking, overdue }) => {
              const link = booking.links[0];
              return (
                <Stack
                  component="li"
                  key={booking.id}
                  direction="row"
                  sx={{
                    alignItems: 'center',
                    gap: 1,
                    py: 0.5,
                    borderBottom: '1px solid var(--tm-border)',
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Typography sx={{ fontWeight: 700 }}>{booking.title}</Typography>
                    <Typography variant="body2" color={overdue ? 'error' : 'text.secondary'}>
                      {shortDate(booking.bookBy)}까지 · {NEED_LABELS[booking.need]}
                      {overdue && ' · 기한 지남'}
                    </Typography>
                  </Box>
                  {link ? (
                    <Button
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${booking.title} 열기 (새 탭)`}
                      sx={{ minHeight: 44 }}
                    >
                      열기
                    </Button>
                  ) : (
                    <Button
                      aria-label={`${booking.title} 적기`}
                      onClick={() => setEditor({ booking })}
                      sx={{ minHeight: 44 }}
                    >
                      적기
                    </Button>
                  )}
                </Stack>
              );
            })}
          </Stack>
        </Box>
      )}

      <Stack component="section" aria-label="예약 목록" sx={{ gap: 1.5 }}>
        <Stack
          role="group"
          aria-label="예약 필터"
          direction="row"
          sx={{ flexWrap: 'wrap', gap: 1 }}
        >
          {FILTERS.map(([value, label]) => (
            <Chip
              key={value}
              component="button"
              type="button"
              clickable
              label={label}
              aria-pressed={filter === value}
              color={filter === value ? 'primary' : 'default'}
              variant={filter === value ? 'filled' : 'outlined'}
              onClick={() => setFilter(value)}
              sx={{ minHeight: 44, minWidth: 44 }}
            />
          ))}
        </Stack>
        {groups.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {bookings.length === 0 ? '아직 적은 예약이 없어요' : '이 조건에 맞는 예약이 없어요'}
          </Typography>
        )}
        {groups.map(({ date, bookings }) => {
          const outside =
            date !== null && (date < trip.startDate.value || date > trip.endDate.value);
          return (
            <Box key={date ?? 'undated'}>
              <Typography component="h2" variant="body2" sx={{ fontWeight: 800, mb: 0.5 }}>
                {date === null ? '날짜 없음' : shortDate(date)}
                {outside && ' · 기간 밖'}
              </Typography>
              <Box
                component="ul"
                sx={{
                  m: 0,
                  p: 0,
                  listStyle: 'none',
                  border: '1px solid var(--tm-border)',
                  borderRadius: 'var(--tm-radius-md)',
                  bgcolor: 'var(--tm-bg-raised)',
                  '& > li + li': { borderTop: '1px solid var(--tm-border)' },
                }}
              >
                {bookings.map((booking) => (
                  <Box component="li" key={booking.id}>
                    <ButtonBase
                      onClick={() => setEditor({ booking })}
                      sx={{
                        display: 'block',
                        width: '100%',
                        minHeight: 44,
                        p: 1.25,
                        textAlign: 'start',
                        overflowWrap: 'anywhere',
                        '&:focus-visible': { outlineOffset: -2 },
                      }}
                    >
                      <Typography component="span" sx={{ display: 'block', fontWeight: 700 }}>
                        {booking.title}
                      </Typography>
                      <Typography component="span" variant="body2" color="text.secondary">
                        {STATUS_LABELS[booking.status]}
                        {booking.at && (
                          <>
                            {' '}
                            · <LocalTime value={booking.at} />
                          </>
                        )}
                        {booking.code && ` · 예약번호 ${booking.code}`}
                        {booking.freeCancelUntil && (
                          <>
                            {' '}
                            · 무료 취소 <LocalTime value={booking.freeCancelUntil} />
                          </>
                        )}
                      </Typography>
                    </ButtonBase>
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}
      </Stack>

      <Stack sx={{ alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: 0.5 }}>
        <Button
          variant="contained"
          disabled={full}
          onClick={() => setEditor({ booking: null })}
          sx={{ minHeight: 44 }}
        >
          ＋ 예약 더하기
        </Button>
        {full && <Typography variant="body2">{BOOKING_COUNT_MESSAGE}</Typography>}
      </Stack>
      {editor !== null && (
        <BookingSheet
          initial={editor.booking}
          trip={trip}
          library={library}
          onClose={closeEditor}
          onSave={(booking) =>
            run(
              (lib, ctx) => putBooking(lib, trip.id, booking, ctx),
              editor.booking === null ? '예약을 더했어요' : '예약을 고쳤어요',
            )
          }
          onRemove={(id) =>
            run((lib, ctx) => removeBooking(lib, trip.id, id, ctx), '예약을 지웠어요')
          }
        />
      )}
    </Stack>
  );
}

export function TripPrepPage() {
  const { id = '' } = useParams();
  const library = useAtomValue(libraryAtom);
  const trip = library.trips[id];
  const found = trip !== undefined && trip.deletedAt === null;
  useDocumentTitle(found ? `${trip.title.value} · 준비` : null);
  if (!found) return <TripNotFound />;
  return <Prep key={trip.id} trip={trip} library={library} />;
}
