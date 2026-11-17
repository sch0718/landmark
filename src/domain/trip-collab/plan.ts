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
  legModes: Record<string, 'car' | 'walk' | 'transit'>;
  legMinutes?: Record<string, number>;
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
    ...(t.legMinutes && Object.keys(t.legMinutes).length
      ? { legMinutes: { ...t.legMinutes } }
      : {}),
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
  const sourceModes: CollabPlan['legModes'] = { ...trip.legModes.value };
  for (const key of trip.legTransit?.value ?? []) sourceModes[key] = 'transit';
  const settings = mapLegSettings(sourceModes, trip.legMinutes?.value, toServer);
  return {
    title: trip.title.value,
    startDate: trip.startDate.value,
    endDate: trip.endDate.value,
    origin: trip.origin.value === null ? null : toServer(trip.origin.value),
    candidates: trip.candidates.value.map(toServer),
    ...settings,
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
  const { legMinutes, ...rest } = plan;
  return JSON.stringify(
    sorted({ ...rest, ...(legMinutes && Object.keys(legMinutes).length ? { legMinutes } : {}) }),
  );
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
  for (const key of new Set([...Object.keys(plan.legModes), ...Object.keys(plan.legMinutes ?? {})]))
    if (!/^[a-z0-9]{10}>[a-z0-9]{10}$/.test(key))
      errors.push(`구간 키가 올바르지 않습니다: ${key}`);
  for (const minutes of Object.values(plan.legMinutes ?? {}))
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
      errors.push('구간 시간이 올바르지 않습니다');
  return errors;
}

/** 같은 키로 합쳐진 장소는 첫 원본의 수단·시간을 함께 보존한다. */
export function mapLegSettings(
  modes: CollabPlan['legModes'],
  minutes: CollabPlan['legMinutes'],
  toPlace: (id: string) => string,
): Pick<CollabPlan, 'legModes' | 'legMinutes'> {
  const legModes: CollabPlan['legModes'] = {},
    legMinutes: Record<string, number> = {},
    seen = new Set<string>();
  for (const key of new Set([...Object.keys(modes), ...Object.keys(minutes ?? {})])) {
    const [a, b] = key.split('>');
    const mapped = `${toPlace(a!)}>${toPlace(b!)}`;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    if (modes[key] !== undefined) legModes[mapped] = modes[key];
    if (minutes?.[key] !== undefined) legMinutes[mapped] = minutes[key];
  }
  return { legModes, ...(Object.keys(legMinutes).length ? { legMinutes } : {}) };
}
