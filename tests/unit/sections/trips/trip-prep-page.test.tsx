import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ITEM_DOC_MAX_CHARS, stableStringify } from 'src/domain/library-sync/items';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { LIBRARY_LIMITS } from 'src/schema/library-base';
import { LIBRARY_KEY } from 'src/services/library-store';
import { libraryAtom } from 'src/stores/library-state';
import { booking } from '../../../fixtures/trip-prep';
import { makePlace, withPlaces } from '../library/fixtures';
import { f, makeTrip, open, plannerLibrary, TRIP, withTrip } from './planner-fixtures';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));

const path = `/trips/${TRIP}/prep`;

afterEach(() => {
  setAppRuntimeForTest(null);
  vi.clearAllMocks();
});

it('휴대폰에서 예약을 추가하고 예약함으로 바꾸면 진행 숫자가 갱신된다', async () => {
  await open(withTrip(plannerLibrary(), makeTrip()), { path, width: 390, ids: [booking.id] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /예약 더하기/ }));
  let sheet = within(screen.getByRole('dialog', { name: '예약 더하기' }));
  await user.type(sheet.getByRole('textbox', { name: /제목/ }), '미술관 입장권');
  await user.click(sheet.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('예약함 0 / 1')).toBeVisible();

  await user.click(screen.getByRole('button', { name: /미술관 입장권/ }));
  sheet = within(screen.getByRole('dialog', { name: '예약 편집' }));
  await user.click(sheet.getByRole('button', { name: '예약함' }));
  await user.click(sheet.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('예약함 1 / 1')).toBeVisible();
});

it('다른 탭에서 늘린 일정 때문에 문서가 상한을 넘으면 삭제를 되돌리지 않는다', async () => {
  const places = Array.from({ length: 350 }, (_, i) => makePlace(100 + i));
  const initial = { ...makeTrip(), bookings: f([booking]) };
  const lib = withTrip(withPlaces(plannerLibrary(), places), initial);
  const { store, storage } = await open(lib, { path });
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: /입장권/ }));
  const sheet = within(screen.getByRole('dialog', { name: '예약 편집' }));
  await user.click(sheet.getByRole('button', { name: '지우기' }));
  await waitFor(() => expect(store.get(libraryAtom).trips[TRIP]?.bookings?.value).toEqual([]));

  const latest: Library = JSON.parse(storage.getItem(LIBRARY_KEY)!);
  const trip = latest.trips[TRIP]!;
  const expanded = makeTrip({ stops: [places.map(({ id }) => id)] });
  const days = [
    {
      ...expanded.days[0]!,
      stops: { ...expanded.days[0]!.stops, updatedAt: '2026-11-27T04:00:00.000Z' },
    },
    trip.days[1]!,
  ];
  const padding = ITEM_DOC_MAX_CHARS - stableStringify({ ...trip, days }).length;
  const stops = days[0]!.stops.value.map((stop, i) => ({
    ...stop,
    note: '가'.repeat(
      Math.min(
        LIBRARY_LIMITS.stopNoteChars,
        Math.max(0, padding - i * LIBRARY_LIMITS.stopNoteChars),
      ),
    ),
  }));
  const day = days[0]!;
  const enlarged = { ...trip, days: [{ ...day, stops: { ...day.stops, value: stops } }, days[1]!] };
  expect(stableStringify(enlarged).length).toBe(ITEM_DOC_MAX_CHARS);
  expect(stableStringify({ ...enlarged, bookings: initial.bookings }).length).toBeGreaterThan(
    ITEM_DOC_MAX_CHARS,
  );
  storage.setItem(LIBRARY_KEY, JSON.stringify({ ...latest, trips: { [TRIP]: enlarged } }));

  const undo = toastMock.mock.calls.findLast(([message]) => message === '예약을 지웠어요')?.[1]
    ?.action;
  expect(undo?.label).toBe('되돌리기');
  await act(async () => undo.onClick());
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('여행 문서가 너무 커요'));
  const saved: Library = JSON.parse(storage.getItem(LIBRARY_KEY)!);
  expect(saved.trips[TRIP]?.bookings?.value).toEqual([]);
  expect(saved.trips[TRIP]?.days[0]?.stops.value).toEqual(stops);
});
