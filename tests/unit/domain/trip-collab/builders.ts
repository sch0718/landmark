import { addDays } from 'src/lib/calendar';
import type { CollabPlan } from 'src/domain/trip-collab/plan';
export const pid = (short: string): string => short.padEnd(10, '0');
export const sid = (short: string): string => ('s' + short).padEnd(8, '0');
export function mkPlan(spec: {
  title?: string;
  start?: string;
  days: string[][];
  candidates?: string[];
  legModes?: Record<string, 'car' | 'walk'>;
  startTimes?: string[];
  lodgings?: (string | null)[];
  notes?: Record<string, string>;
}): CollabPlan {
  const startDate = spec.start ?? '2026-11-01';
  return {
    title: spec.title ?? '함께 여행',
    startDate,
    endDate: addDays(startDate, spec.days.length - 1),
    origin: null,
    candidates: (spec.candidates ?? []).map(pid),
    legModes: spec.legModes ?? {},
    days: spec.days.map((row, i) => ({
      id: `d${i}`.padEnd(8, '0'),
      startTime: spec.startTimes?.[i] ?? '09:00',
      lodging: spec.lodgings?.[i] == null ? null : pid(spec.lodgings[i]!),
      stops: row.map((p) => ({
        id: sid(p),
        placeId: pid(p),
        stayMin: null,
        fixedTime: null,
        note: spec.notes?.[p] ?? '',
      })),
    })),
  };
}
