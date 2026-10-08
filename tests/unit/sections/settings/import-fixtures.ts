import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { TripData } from 'src/schema/legacy/trip-data';
import { makeTrip } from '../../../fixtures/builders';

/**
 * 장소 A·B의 새 ID 두 개, 그다음은 라벨 ID. 이름을 한 글자씩 입력할 때마다 유효한 이름이면 새 라벨 ID를
 * 하나씩 쓰므로 넉넉히 준비한다(8자, 어느 것이 최종 라벨이 되는지는 이름으로 찾는다).
 */
export const NEW_IDS = [
  'newplace01',
  'newplace02',
  ...Array.from({ length: 80 }, (_, i) => `newlab${String(i).padStart(2, '0')}`),
];

export const tripOf = (): TripData => makeTrip({ days: {}, places: ['A', 'B'] });

export const jsonFile = (trip: TripData): File =>
  new File([JSON.stringify(trip)], 'trip.json', { type: 'application/json' });

export const dialog = () => screen.getByRole('dialog', { name: '옛 여행 가져오기' });

/** `/data/<id>.json`을 `trips`에서 찾아 돌려주고 없으면 404. */
export function stubTripFetch(trips: Record<string, TripData>) {
  const fetchMock = vi.fn(async (url: string) => {
    const id = /\/data\/(.+)\.json$/.exec(url)?.[1] ?? '';
    const trip = trips[id];
    return trip === undefined
      ? new Response('missing', { status: 404 })
      : new Response(JSON.stringify(trip), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
