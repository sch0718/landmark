import { setField, type Field } from 'src/domain/library/lww';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import type { Library } from 'src/schema/library';
import type { Day, Stop, Trip } from 'src/schema/trip';

// 되돌리기(스펙 §2.5). 연산 직후 `diffTrip(전, 후)`로 그 연산이 바꾼 필드를 기록하고,
// `revertTrip`은 그사이 아무도 바꾸지 않은 필드(지금 `updatedAt`이 기록한 이후 값과 같음)만
// 이전 값으로 쓴다. 다른 탭·다른 편집이 바꾼 필드는 건너뛴다.
// `ops.ts`가 다시 내보낸다. 파일이 길어져 나눴을 뿐 같은 연산 모음이다.

export type TripFieldPath =
  | 'title'
  | 'origin'
  | 'candidates'
  | 'legModes'
  | { day: number; field: 'stops' | 'lodging' | 'startTime' };

/** 기간 단위: 날짜 두 필드(값·updatedAt)와 Day 배열 전체. */
export type TripPeriod = { startDate: Field<string>; endDate: Field<string>; days: readonly Day[] };

export type TripFieldChange = {
  path: TripFieldPath;
  before: Field<unknown>;
  after: Field<unknown>;
};

export type TripChange = {
  tripId: string;
  fields: TripFieldChange[];
  period?: { before: TripPeriod; after: TripPeriod };
};

const TOP_FIELDS = ['title', 'origin', 'candidates', 'legModes'] as const;
const DAY_FIELDS = ['stops', 'lodging', 'startTime'] as const;

const sameField = (a: Field<unknown>, b: Field<unknown>): boolean =>
  a === b || (a.updatedAt === b.updatedAt && JSON.stringify(a.value) === JSON.stringify(b.value));

const periodOf = (trip: Trip): TripPeriod => ({
  startDate: trip.startDate,
  endDate: trip.endDate,
  days: trip.days,
});

/**
 * 연산 전후의 여행에서 바뀐 필드를 모은다. 날짜가 바뀌었으면 날짜·Day 배열 전체를 `period`
 * 한 단위로 담고(`fields`에는 날짜·Day 필드를 넣지 않는다), 아니면 Day 필드 단위로 `fields`에 담는다.
 */
export function diffTrip(before: Trip, after: Trip): TripChange {
  const fields: TripFieldChange[] = [];
  for (const key of TOP_FIELDS) {
    if (!sameField(before[key], after[key])) {
      fields.push({ path: key, before: before[key], after: after[key] });
    }
  }
  const periodChanged =
    !sameField(before.startDate, after.startDate) ||
    !sameField(before.endDate, after.endDate) ||
    before.days.length !== after.days.length;
  if (periodChanged) {
    return {
      tripId: after.id,
      fields,
      period: { before: periodOf(before), after: periodOf(after) },
    };
  }
  after.days.forEach((day, d) => {
    const prev = before.days[d]!;
    for (const field of DAY_FIELDS) {
      if (!sameField(prev[field], day[field])) {
        fields.push({ path: { day: d, field }, before: prev[field], after: day[field] });
      }
    }
  });
  return { tripId: after.id, fields };
}

function getField(trip: Trip, path: TripFieldPath): Field<unknown> | undefined {
  if (typeof path === 'string') return trip[path];
  return trip.days[path.day]?.[path.field];
}

// 기록의 값은 같은 경로에서 꺼낸 것이라 형이 맞는다. `Field<unknown>`을 제자리에 다시 넣는다.
function putField(trip: Trip, path: TripFieldPath, field: Field<unknown>): Trip {
  if (getField(trip, path) === field) return trip;
  if (typeof path === 'string') return { ...trip, [path]: field } as Trip;
  const days = trip.days.slice();
  days[path.day] = { ...days[path.day]!, [path.field]: field } as Day;
  return { ...trip, days };
}

/** 지금 날짜·모든 Day 필드의 `updatedAt`이 기록한 이후 기간과 모두 같은가. */
function periodUntouched(trip: Trip, after: TripPeriod): boolean {
  return (
    trip.startDate.updatedAt === after.startDate.updatedAt &&
    trip.endDate.updatedAt === after.endDate.updatedAt &&
    trip.days.length === after.days.length &&
    trip.days.every((day, d) =>
      DAY_FIELDS.every((field) => day[field].updatedAt === after.days[d]![field].updatedAt),
    )
  );
}

/** 이전 기간의 날짜·Day 배열을 쓴다. 값이 같은 필드는 지금 것을 그대로 둔다. */
function applyPeriod(trip: Trip, before: TripPeriod, now: string): Trip {
  const days = before.days.map((prev, d): Day => {
    const cur = trip.days[d];
    if (cur === undefined) {
      return {
        stops: { value: prev.stops.value, updatedAt: now },
        lodging: { value: prev.lodging.value, updatedAt: now },
        startTime: { value: prev.startTime.value, updatedAt: now },
      };
    }
    const stops = setField(cur.stops, prev.stops.value, now);
    const lodging = setField(cur.lodging, prev.lodging.value, now);
    const startTime = setField(cur.startTime, prev.startTime.value, now);
    return stops === cur.stops && lodging === cur.lodging && startTime === cur.startTime
      ? cur
      : { stops, lodging, startTime };
  });
  return {
    ...trip,
    startDate: setField(trip.startDate, before.startDate.value, now),
    endDate: setField(trip.endDate, before.endDate.value, now),
    days,
  };
}

const dayKey = (d: number) => `day:${d}`;

/** 위치 필드(후보·Day별 Stop)에 있는 장소. 후보, Day 순서다. */
function placedIds(trip: Trip): string[] {
  return [
    ...trip.candidates.value,
    ...trip.days.flatMap((d) => d.stops.value.map((s) => s.placeId)),
  ];
}

/**
 * 되돌린 결과가 "장소 한 번만"을 어기면 되돌리지 않은 필드(다른 곳에서 바뀐 쪽)의 위치를 남기고
 * 되돌린 필드에서 그 장소를 뺀다. `reverted`는 되돌린 위치 필드의 키('candidates' | 'day:N')다.
 */
function keepPlacesOnce(trip: Trip, reverted: ReadonlySet<string>, now: string): Trip {
  const seenPlaces = new Set<string>();
  const seenStops = new Set<string>();
  if (!reverted.has('candidates')) trip.candidates.value.forEach((p) => seenPlaces.add(p));
  trip.days.forEach((day, d) => {
    if (reverted.has(dayKey(d))) return;
    for (const s of day.stops.value) {
      seenPlaces.add(s.placeId);
      seenStops.add(s.id);
    }
  });

  let next = trip;
  if (reverted.has('candidates')) {
    const kept = trip.candidates.value.filter((p) => {
      if (seenPlaces.has(p)) return false;
      seenPlaces.add(p);
      return true;
    });
    next = putField(next, 'candidates', setField(next.candidates, kept, now));
  }
  trip.days.forEach((day, d) => {
    if (!reverted.has(dayKey(d))) return;
    const kept = day.stops.value.filter((s) => {
      if (seenPlaces.has(s.placeId) || seenStops.has(s.id)) return false;
      seenPlaces.add(s.placeId);
      seenStops.add(s.id);
      return true;
    });
    next = putField(next, { day: d, field: 'stops' }, setField(day.stops, kept, now));
  });
  return next;
}

/** 기록의 이전 값(후보·Day별 Stop)에 있던 장소. 연산 전에 여행에 있던 장소다. */
function placesBefore(change: TripChange): Set<string> {
  const ids = new Set<string>();
  const addStops = (stops: readonly Stop[]) => stops.forEach((s) => ids.add(s.placeId));
  for (const fc of change.fields) {
    if (fc.path === 'candidates') (fc.before.value as string[]).forEach((p) => ids.add(p));
    else if (typeof fc.path === 'object' && fc.path.field === 'stops') {
      addStops(fc.before.value as Stop[]);
    }
  }
  change.period?.before.days.forEach((d) => addStops(d.stops.value));
  return ids;
}

/**
 * 기록한 연산을 되돌린다. 지금 `updatedAt`이 기록한 이후 값과 같은 필드만 이전 값으로 쓰고
 * (`updatedAt = ctx.now`), 기간 단위(`period`)는 날짜·모든 Day 필드가 그대로일 때만 함께 쓴다.
 * `summary.merged`는 건너뛴 필드 수다(기간 단위는 1). 0보다 크면
 * `다른 곳에서 바뀐 부분은 그대로 두었어요`를 보인다.
 *
 * 일부만 되돌리면 장소가 두 곳에 있거나 아무 데도 없게 될 수 있다. 두 곳이면 되돌리지 않은 쪽을
 * 남기고, 연산 전에도 여행에 있던 장소가 어디에도 없게 되면 후보 끝에 둔다(장소를 잃지 않는다).
 */
export function revertTrip(lib: Library, change: TripChange, ctx: OpCtx): OpResult {
  const trip = lib.trips[change.tripId];
  if (trip === undefined || trip.deletedAt !== null) {
    return { ok: false, error: { _tag: 'NotFound', id: change.tripId } };
  }
  let skipped = 0;
  let next = trip;
  const reverted = new Set<string>();

  for (const fc of change.fields) {
    const current = getField(next, fc.path);
    if (current === undefined || current.updatedAt !== fc.after.updatedAt) {
      skipped++;
      continue;
    }
    next = putField(next, fc.path, setField(current, fc.before.value, ctx.now));
    if (fc.path === 'candidates') reverted.add('candidates');
    else if (typeof fc.path === 'object' && fc.path.field === 'stops') {
      reverted.add(dayKey(fc.path.day));
    }
  }

  if (change.period !== undefined) {
    if (periodUntouched(trip, change.period.after)) {
      next = applyPeriod(next, change.period.before, ctx.now);
      change.period.before.days.forEach((_, d) => reverted.add(dayKey(d)));
    } else {
      skipped++;
    }
  }

  next = keepPlacesOnce(next, reverted, ctx.now);

  const known = placesBefore(change);
  const present = new Set(placedIds(next));
  const lost = placedIds(trip).filter((p) => known.has(p) && !present.has(p));
  if (lost.length > 0) {
    const candidates = [...next.candidates.value, ...lost];
    next = putField(next, 'candidates', setField(next.candidates, candidates, ctx.now));
  }

  return {
    ok: true,
    lib: next === trip ? lib : { ...lib, trips: { ...lib.trips, [trip.id]: next } },
    summary: { created: 0, merged: skipped, restored: 0 },
  };
}
