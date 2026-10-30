import type { LiveTripDoc } from '../trip-live/live-doc';
import type { Trip } from '../../schema/trip';
import { daysBetween } from '../../lib/calendar';

export type CollabStop = {
  id: string;
  placeId: string;
  stayMin: number | null;
  fixedTime: string | null;
  note: string;
};
export type CollabDay = {
  id: string;
  startTime: string;
  lodging: string | null;
  stops: CollabStop[];
};
export type CollabPlan = {
  title: string;
  startDate: string;
  endDate: string;
  origin: string | null;
  candidates: string[];
  legModes: Record<string, 'car' | 'walk'>;
  days: CollabDay[];
};
export const NEW_DAY_START = '09:00';
export function planFromDoc(doc: LiveTripDoc): CollabPlan {
  const t = doc.share.trips[0]!;
  return {
    title: t.title,
    startDate: t.startDate,
    endDate: t.endDate,
    origin: t.originId,
    candidates: [...t.candidateIds],
    legModes: { ...t.legModes },
    days: t.days.map((day, i) => ({
      id: doc.ids.days[i]!,
      startTime: day.startTime,
      lodging: day.lodgingId,
      stops: day.stops.map((s, j) => ({
        id: doc.ids.stops[i]![j]!,
        placeId: s.placeId,
        stayMin: s.stayMin,
        fixedTime: s.fixedTime,
        note: s.note ?? '',
      })),
    })),
  };
}
export function projectLocalTrip(
  trip: Trip,
  toServer: (localPlaceId: string) => string,
  dayIds: readonly string[],
): CollabPlan {
  if (dayIds.length !== trip.days.length) throw new Error('dayIds 길이가 Day 수와 다릅니다');
  const legModes: CollabPlan['legModes'] = {};
  for (const [key, mode] of Object.entries(trip.legModes.value)) {
    const [a, b] = key.split('>');
    const mapped = `${toServer(a!)}>${toServer(b!)}`;
    if (!Object.hasOwn(legModes, mapped)) legModes[mapped] = mode;
  }
  return {
    title: trip.title.value,
    startDate: trip.startDate.value,
    endDate: trip.endDate.value,
    origin: trip.origin.value === null ? null : toServer(trip.origin.value),
    candidates: trip.candidates.value.map(toServer),
    legModes,
    days: trip.days.map((day, i) => ({
      id: dayIds[i]!,
      startTime: day.startTime.value,
      lodging: day.lodging.value === null ? null : toServer(day.lodging.value),
      stops: day.stops.value.map((s) => ({ ...s, placeId: toServer(s.placeId) })),
    })),
  };
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sorted(v)]),
    );
  return value;
}
export function planKey(plan: CollabPlan): string {
  return JSON.stringify(sorted(plan));
}
export function samePlan(a: CollabPlan, b: CollabPlan): boolean {
  return planKey(a) === planKey(b);
}
export function checkPlan(plan: CollabPlan): string[] {
  const errors: string[] = [];
  const span = daysBetween(plan.startDate, plan.endDate);
  if (!Number.isFinite(span) || span < 1 || span > 30 || span !== plan.days.length)
    errors.push('Day 수가 여행 기간(1~30일)과 다릅니다');
  const places = new Set<string>();
  const place = (id: string) => {
    if (places.has(id)) errors.push(`장소가 중복됩니다: ${id}`);
    places.add(id);
  };
  plan.candidates.forEach(place);
  const days = new Set<string>(),
    stops = new Set<string>();
  for (const d of plan.days) {
    if (!/^[a-z0-9]{8}$/.test(d.id) || days.has(d.id))
      errors.push(`Day id가 올바르지 않거나 중복됩니다: ${d.id}`);
    days.add(d.id);
    for (const s of d.stops) {
      if (!/^[a-z0-9]{8}$/.test(s.id) || stops.has(s.id))
        errors.push(`Stop id가 올바르지 않거나 중복됩니다: ${s.id}`);
      stops.add(s.id);
      place(s.placeId);
    }
  }
  for (const key of Object.keys(plan.legModes))
    if (!/^[a-z0-9]{10}>[a-z0-9]{10}$/.test(key))
      errors.push(`구간 키가 올바르지 않습니다: ${key}`);
  return errors;
}
