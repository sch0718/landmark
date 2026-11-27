import { describe, expect, it } from 'vitest';
import { ITEM_DOC_MAX_CHARS, stableStringify } from 'src/domain/library-sync/items';
import {
  bookNow,
  filterBookings,
  groupByDate,
  putBooking,
  removeBooking,
  summarizeBookings,
} from 'src/domain/trips/bookings';
import type { Booking } from 'src/schema/trip';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { booking } from '../../../fixtures/trip-prep';

const ID = 'trip000001';
const ctx = { now: '2026-11-27T02:00:00.000Z', newId: () => 'book0002' };

describe('예약 조회', () => {
  const booked = booking;
  const pending: Booking = { ...booking, id: 'pending0', status: 'pending' };
  const todo: Booking = {
    ...booking,
    id: 'todobook',
    status: 'todo',
    need: 'optional',
    price: { amount: 500, currency: 'KRW' },
  };
  const skipped: Booking = { ...booking, id: 'skipbook', status: 'skipped' };
  const list = [booked, pending, todo, skipped];

  it('안 하기로 한 예약을 집계에서 빼고, 금액은 통화별로 더한다', () => {
    expect(summarizeBookings(list)).toEqual({
      booked: 1,
      total: 3,
      requiredLeft: 1,
      totals: [
        { currency: 'EUR', amount: 50 },
        { currency: 'KRW', amount: 500 },
      ],
    });
  });

  it('예약 상태대로 걸러 낸다', () => {
    expect(filterBookings(list, 'all')).toEqual(list);
    expect(filterBookings(list, 'todo')).toEqual([booked, pending, todo]);
    expect(filterBookings(list, 'open')).toEqual([pending, todo]);
  });

  it('미완료 예약만 필수·기한순으로 다섯 개까지 고르고 오늘 이전만 기한 경과로 표시한다', () => {
    const dated = (id: string, bookBy: string, base = pending): Booking => ({
      ...base,
      id,
      bookBy,
    });
    const later = dated('book0003', '2026-11-29');
    const past = dated('book0004', '2026-11-26');
    const earlyOptional = dated('book0005', '2026-11-01', todo);
    const lateOptional = dated('book0006', '2026-12-01', todo);
    const extra = dated('book0007', '2026-12-02', todo);
    expect(
      bookNow(
        [
          lateOptional,
          later,
          booked,
          skipped,
          pending,
          earlyOptional,
          extra,
          past,
          { ...todo, bookBy: null },
        ],
        '2026-11-27',
      ).map(({ booking, overdue }) => [booking.id, overdue]),
    ).toEqual([
      [past.id, true],
      [pending.id, false],
      [later.id, false],
      [earlyOptional.id, true],
      [lateOptional.id, false],
    ]);
  });

  it('일정일 순서로 묶고 날짜 없는 예약을 마지막에 둔다', () => {
    const undated = { ...todo, date: null };
    const earlier = { ...pending, date: '2026-12-30' };
    expect(groupByDate([undated, booked, earlier, skipped])).toEqual([
      { date: earlier.date, bookings: [earlier] },
      { date: booked.date, bookings: [booked, skipped] },
      { date: null, bookings: [undated] },
    ]);
  });
});

describe('예약 변경', () => {
  it('처음 확정 일시를 적으면 비어 있는 일정일을 그 날짜로 채우고 기록 시각을 갱신한다', () => {
    const lib = buildLiveLibrary();
    const first = putBooking(lib, ID, { ...booking, date: null, at: null }, ctx);
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    const later = { ...ctx, now: '2026-11-27T03:00:00.000Z' };
    const updated = putBooking(first.lib, ID, { ...booking, date: null }, later);
    if (!updated.ok) throw new Error(JSON.stringify(updated.error));
    expect(updated.lib.trips[ID]?.bookings).toEqual({ value: [booking], updatedAt: later.now });

    const cleared = { ...booking, date: null };
    const edited = putBooking(updated.lib, ID, cleared, later);
    if (!edited.ok) throw new Error(JSON.stringify(edited.error));
    expect(edited.lib.trips[ID]?.bookings?.value).toEqual([cleared]);
  });

  it('결과 여행이 동기화 문서 상한을 넘으면 저장을 거절한다', () => {
    const lib = buildLiveLibrary();
    const trip = lib.trips[ID]!;
    const legModes = {
      ...trip.legModes,
      value: Object.fromEntries(
        Array.from(
          { length: Math.floor((ITEM_DOC_MAX_CHARS - stableStringify(trip).length - 32) / 31) },
          (_, i) => [`place00001>${String(i).padStart(10, '0')}`, 'walk' as const],
        ),
      ),
    };
    const largeTrip = { ...trip, legModes };
    const largeLib = { ...lib, trips: { ...lib.trips, [ID]: largeTrip } };
    expect(stableStringify(largeTrip).length).toBeLessThan(ITEM_DOC_MAX_CHARS);
    expect(putBooking(largeLib, ID, { ...booking, note: '가'.repeat(300) }, ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'TripTooLarge' },
    });
  });

  it('마지막 예약을 지우면 새 시각과 빈 배열을 남긴다', () => {
    const first = putBooking(buildLiveLibrary(), ID, booking, ctx);
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    const later = { ...ctx, now: '2026-11-27T03:00:00.000Z' };
    const removed = removeBooking(first.lib, ID, booking.id, later);
    if (!removed.ok) throw new Error(JSON.stringify(removed.error));
    expect(removed.lib.trips[ID]?.bookings).toEqual({ value: [], updatedAt: later.now });
  });
});
