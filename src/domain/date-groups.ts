import type { EffectiveTrip } from 'src/domain/overlay';
import type { TripData } from 'src/schema/legacy/trip-data';

/** 날짜 → 그날의 stop id 목록. */
export type Placement = Record<string, string[]>;

export function placementOfTrip(trip: TripData): Placement {
  return Object.fromEntries(trip.days.map((day) => [day.date, day.stops.map((s) => s.id)]));
}

export function placementOfEffective(eff: EffectiveTrip): Placement {
  return Object.fromEntries(eff.days.map((day) => [day.date, day.stops.map((s) => s.id)]));
}

/**
 * 같은 stop id가 서로 다른 placement에서 다른 날짜에 있으면 그 날짜들을 한 묶음으로 합친다(union-find).
 * allDates와 placement에 나온 모든 날짜가 결과에 들어가며, 연결 없는 날짜는 단독 묶음이다.
 * 각 묶음은 날짜 오름차순, 묶음 목록은 첫 날짜 오름차순.
 */
export function groupDates(placements: Placement[], allDates: string[]): string[][] {
  const parent = new Map<string, string>();
  const find = (date: string): string => {
    let root = parent.get(date) ?? date;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    parent.set(date, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const date of allDates) parent.set(date, date);
  const datesOfStop = new Map<string, string>();
  for (const placement of placements) {
    for (const [date, ids] of Object.entries(placement)) {
      if (!parent.has(date)) parent.set(date, date);
      for (const id of ids) {
        const first = datesOfStop.get(id);
        if (first === undefined) datesOfStop.set(id, date);
        else union(first, date);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const date of [...parent.keys()].sort()) {
    const root = find(date);
    groups.set(root, [...(groups.get(root) ?? []), date]);
  }
  return [...groups.values()].sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
}
