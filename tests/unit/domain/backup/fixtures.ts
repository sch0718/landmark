import { emptyLibrary, type Label, type Library, type Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';

export const T0 = '2026-10-08T01:00:00.000Z';
export const f = <V>(value: V, updatedAt = T0) => ({ value, updatedAt });

export const pid = (n: number) => `p${String(n).padStart(9, '0')}`;
export const lid = (n: number) => `l${String(n).padStart(7, '0')}`;

export function place(n: number, over: Partial<Place> = {}): Place {
  return {
    id: pid(n),
    source: { kind: 'naver', sid: String(1000 + n) },
    name: f(`장소 ${n}`),
    address: '강원 강릉시 창해로14번길 20',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

export function label(n: number, over: Partial<Label> = {}): Label {
  return {
    id: lid(n),
    name: f(`라벨 ${n}`),
    color: f('red' as const),
    icon: f('star' as const),
    order: f(n),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

/** Day 하나에 Stop 하나(장소 `placeN`)가 든 여행. */
export function trip(n: number, placeN: number, over: Partial<Trip> = {}): Trip {
  return {
    id: `t${String(n).padStart(9, '0')}`,
    title: f(`여행 ${n}`),
    startDate: f('2026-10-20'),
    endDate: f('2026-10-20'),
    origin: f<string | null>(null),
    candidates: f<string[]>([]),
    days: [
      {
        stops: f([
          {
            id: `s${String(n).padStart(7, '0')}`,
            placeId: pid(placeN),
            stayMin: 60,
            fixedTime: null,
            note: '',
          },
        ]),
        lodging: f<string | null>(null),
        startTime: f('09:00'),
      },
    ],
    legModes: f<Record<string, 'car' | 'walk'>>({}),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

export function makeLibrary(
  parts: { places?: Place[]; labels?: Label[]; trips?: Trip[] } = {},
): Library {
  return {
    ...emptyLibrary(),
    places: Object.fromEntries((parts.places ?? []).map((p) => [p.id, p])),
    labels: Object.fromEntries((parts.labels ?? []).map((l) => [l.id, l])),
    trips: Object.fromEntries((parts.trips ?? []).map((t) => [t.id, t])),
  };
}
