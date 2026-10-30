import { receivedTripTitle } from '../library/import-share-trip';
import { setField } from '../library/lww';
import type { OpCtx, OpError, OpResult } from '../library/ops';
import type { Library } from '../../schema/library';
import { checkTrip, type Day, type Trip } from '../../schema/trip';
import type { LiveTripDoc } from '../trip-live/live-doc';
import { mapServerPlaces, type PlaceMap } from './places';
import { planFromDoc, type CollabPlan } from './plan';

function mappedTrip(
  trip: Trip,
  plan: CollabPlan,
  map: PlaceMap,
  ctx: OpCtx,
): Trip | { missing: string } {
  const refs = [
    plan.origin,
    ...plan.candidates,
    ...plan.days.flatMap((d) => [...d.stops.map((s) => s.placeId), d.lodging]),
  ];
  for (const id of refs) if (id !== null && !Object.hasOwn(map, id)) return { missing: id };
  const local = (id: string) => map[id]!;
  const optional = (id: string | null) => (id === null ? null : local(id));
  const modes: Record<string, 'car' | 'walk'> = {};
  for (const [k, mode] of Object.entries(plan.legModes)) {
    const [a, b] = k.split('>');
    if (!Object.hasOwn(map, a!)) return { missing: a! };
    if (!Object.hasOwn(map, b!)) return { missing: b! };
    const key = `${local(a!)}>${local(b!)}`;
    if (!Object.hasOwn(modes, key)) modes[key] = mode;
  }
  const f = <T>(value: T) => ({ value, updatedAt: ctx.now });
  const days: Day[] = plan.days.map((d, i) => {
    const before = trip.days[i],
      stops = d.stops.map((s) => ({ ...s, placeId: local(s.placeId) }));
    if (!before)
      return { stops: f(stops), lodging: f(optional(d.lodging)), startTime: f(d.startTime) };
    const after = {
      stops: setField(before.stops, stops, ctx.now),
      lodging: setField(before.lodging, optional(d.lodging), ctx.now),
      startTime: setField(before.startTime, d.startTime, ctx.now),
    };
    return after.stops === before.stops &&
      after.lodging === before.lodging &&
      after.startTime === before.startTime
      ? before
      : after;
  });
  const after: Trip = {
    ...trip,
    title: setField(trip.title, plan.title, ctx.now),
    startDate: setField(trip.startDate, plan.startDate, ctx.now),
    endDate: setField(trip.endDate, plan.endDate, ctx.now),
    origin: setField(trip.origin, optional(plan.origin), ctx.now),
    candidates: setField(trip.candidates, plan.candidates.map(local), ctx.now),
    legModes: setField(trip.legModes, modes, ctx.now),
    days:
      days.length === trip.days.length && days.every((d, i) => d === trip.days[i])
        ? trip.days
        : days,
  };
  return Object.keys(after).every((k) => after[k as keyof Trip] === trip[k as keyof Trip])
    ? trip
    : after;
}
export function applyCollabPlan(
  lib: Library,
  tripId: string,
  plan: CollabPlan,
  placeMap: PlaceMap,
  ctx: OpCtx,
): OpResult {
  const before = lib.trips[tripId];
  if (!before || before.deletedAt !== null)
    return { ok: false, error: { _tag: 'NotFound', id: tripId } };
  const after = mappedTrip(before, plan, placeMap, ctx);
  if ('missing' in after) return { ok: false, error: { _tag: 'NotFound', id: after.missing } };
  if (checkTrip(after, lib.places, ['trips', tripId]).length)
    return { ok: false, error: { _tag: 'TripChanged', id: tripId } };
  return {
    ok: true,
    lib: after === before ? lib : { ...lib, trips: { ...lib.trips, [tripId]: after } },
  };
}
export function importCollabTrip(
  lib: Library,
  doc: LiveTripDoc,
  ctx: OpCtx,
):
  | { ok: true; lib: Library; tripId: string; placeMap: Record<string, string>; dayIds: string[] }
  | { ok: false; error: OpError } {
  const mapped = mapServerPlaces(lib, doc, {}, ctx);
  if (!mapped.ok) return mapped;
  const plan = planFromDoc(doc),
    tripId = ctx.newId('trip');
  const f = <T>(value: T) => ({ value, updatedAt: ctx.now });
  const empty: Trip = {
    id: tripId,
    title: f(''),
    startDate: f(''),
    endDate: f(''),
    origin: f(null),
    candidates: f([]),
    legModes: f({}),
    days: [],
    createdAt: ctx.now,
    deletedAt: null,
  };
  const trip = mappedTrip(
    empty,
    { ...plan, title: receivedTripTitle(plan.title) },
    mapped.placeMap,
    ctx,
  );
  if ('missing' in trip) return { ok: false, error: { _tag: 'NotFound', id: trip.missing } };
  if (checkTrip(trip, mapped.lib.places, ['trips', tripId]).length)
    return { ok: false, error: { _tag: 'TripChanged', id: tripId } };
  return {
    ok: true,
    lib: { ...mapped.lib, trips: { ...mapped.lib.trips, [tripId]: trip } },
    tripId,
    placeMap: mapped.placeMap,
    dayIds: plan.days.map((d) => d.id),
  };
}
