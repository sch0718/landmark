import { ITEM_DOC_MAX_CHARS, stableStringify } from 'src/domain/library-sync/items';
import { setOptionalField } from 'src/domain/library/lww';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import type { Library } from 'src/schema/library';
import { is } from 'src/schema/parse';
import {
  BOOKINGS_MAX,
  BookingSchema,
  PREP_FIELD_CHARS,
  type Booking,
  type Trip,
} from 'src/schema/trip';

export type BookingFilter = 'all' | 'todo' | 'open';
export const BOOKING_COUNT_MESSAGE = `예약은 ${BOOKINGS_MAX}개까지 적을 수 있어요`;

const isOpen = (booking: Booking) => booking.status === 'todo' || booking.status === 'pending';

export function summarizeBookings(bookings: readonly Booking[]) {
  let booked = 0;
  let total = 0;
  let requiredLeft = 0;
  const amounts = new Map<string, number>();
  for (const booking of bookings) {
    if (booking.status === 'skipped') continue;
    total++;
    if (booking.status === 'booked') booked++;
    else if (booking.need === 'required') requiredLeft++;
    if (booking.price !== null) {
      const { currency, amount } = booking.price;
      amounts.set(currency, (amounts.get(currency) ?? 0) + amount);
    }
  }
  return {
    booked,
    total,
    requiredLeft,
    totals: Array.from(amounts, ([currency, amount]) => ({ currency, amount })),
  };
}

export function filterBookings(
  list: readonly Booking[],
  filter: BookingFilter,
): readonly Booking[] {
  if (filter === 'all') return list;
  if (filter === 'open') return list.filter(isOpen);
  return list.filter((booking) => booking.status !== 'skipped');
}

export function bookNow(list: readonly Booking[], today: string) {
  return list
    .filter(
      (booking): booking is Booking & { bookBy: string } =>
        isOpen(booking) && booking.bookBy !== null,
    )
    .sort(
      (a, b) =>
        Number(b.need === 'required') - Number(a.need === 'required') ||
        a.bookBy.localeCompare(b.bookBy),
    )
    .slice(0, 5)
    .map((booking) => ({ booking, overdue: booking.bookBy < today }));
}

export function groupByDate(list: readonly Booking[]) {
  const groups = new Map<string | null, Booking[]>();
  for (const booking of list) {
    const group = groups.get(booking.date);
    if (group === undefined) groups.set(booking.date, [booking]);
    else group.push(booking);
  }
  return Array.from(groups, ([date, bookings]) => ({ date, bookings })).sort((a, b) => {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date.localeCompare(b.date);
  });
}

export function checkTripSize(trip: Trip) {
  return stableStringify(trip).length > ITEM_DOC_MAX_CHARS
    ? { _tag: 'TripTooLarge' as const, message: '여행 문서가 너무 커요' }
    : null;
}

export type BookingInput = Omit<Booking, 'id'> & { id?: string };

export function proposeBookings(list: readonly Booking[], booking: BookingInput, id: string) {
  const previous = list.find((item) => item.id === booking.id);
  const next = {
    ...booking,
    id,
    date: booking.date ?? (previous?.at == null ? (booking.at?.slice(0, 10) ?? null) : null),
  };
  return previous === undefined
    ? [...list, next]
    : list.map((item) => (item === previous ? next : item));
}

export function bookingLimitsIssue(bookings: readonly Booking[]): string | null {
  if (bookings.length > BOOKINGS_MAX) return BOOKING_COUNT_MESSAGE;
  if (JSON.stringify(bookings).length > PREP_FIELD_CHARS.bookings) {
    return '예약 내용을 모두 합치면 너무 길어요';
  }
  return null;
}

const invalid = (message: string): OpResult => ({
  ok: false,
  error: { _tag: 'BookingInvalid', message },
});

function saveBookings(
  lib: Library,
  trip: Trip,
  bookings: readonly Booking[],
  ctx: OpCtx,
): OpResult {
  const field = setOptionalField(trip.bookings, bookings, [], ctx.now);
  if (field === trip.bookings) return { ok: true, lib };
  const next = { ...trip, bookings: field };
  const error = checkTripSize(next);
  if (error !== null) return { ok: false, error };
  return { ok: true, lib: { ...lib, trips: { ...lib.trips, [trip.id]: next } } };
}

export function putBooking(
  lib: Library,
  tripId: string,
  booking: BookingInput,
  ctx: OpCtx,
): OpResult {
  const trip = lib.trips[tripId];
  if (trip === undefined || trip.deletedAt !== null) {
    return { ok: false, error: { _tag: 'NotFound', id: tripId } };
  }

  const list = trip.bookings?.value ?? [];
  const id = booking.id ?? ctx.newId('booking');
  if (!is(BookingSchema, { ...booking, id })) return invalid('예약 내용을 다시 확인해 주세요');
  if (booking.placeId !== null && !Object.hasOwn(lib.places, booking.placeId)) {
    return invalid('연결할 장소를 찾지 못했어요');
  }
  if (booking.id === undefined && list.some((item) => item.id === id)) {
    return invalid('예약을 추가하지 못했어요. 다시 시도해 주세요');
  }

  const bookings = proposeBookings(list, booking, id);
  const issue = bookingLimitsIssue(bookings);
  return issue === null ? saveBookings(lib, trip, bookings, ctx) : invalid(issue);
}

export function removeBooking(lib: Library, tripId: string, id: string, ctx: OpCtx): OpResult {
  const trip = lib.trips[tripId];
  if (trip === undefined || trip.deletedAt !== null) {
    return { ok: false, error: { _tag: 'NotFound', id: tripId } };
  }
  return saveBookings(
    lib,
    trip,
    (trip.bookings?.value ?? []).filter((booking) => booking.id !== id),
    ctx,
  );
}
