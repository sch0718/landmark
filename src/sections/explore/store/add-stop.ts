import { ensureOverride, overlay } from 'src/domain/overlay';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 여행 안(원본·실효·편집)에서 쓰이지 않은 4자 소문자 영숫자 stop id. */
export function newStopId(
  trip: TripData,
  edit: EditLayer,
  random: () => number = Math.random,
): string {
  const used = new Set<string>();
  for (const day of trip.days) for (const s of day.stops) used.add(s.id);
  for (const day of overlay(trip, edit).days) for (const s of day.stops) used.add(s.id);
  for (const dayEdit of Object.values(edit.days)) {
    if (dayEdit.mode === 'override') for (const s of dayEdit.stops) used.add(s.id);
  }
  for (;;) {
    let id = '';
    for (let i = 0; i < 4; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)]!;
    if (!used.has(id)) return id;
  }
}

/** 그날을 override로 시작해(ensureOverride) 새 stop을 끝에 붙인다. */
export function addStopToDay(
  trip: TripData,
  edit: EditLayer,
  date: string,
  placeKey: string,
  now: string,
  random?: () => number,
): EditLayer {
  const base = ensureOverride(trip, edit, date, now);
  const day = base.days[date];
  if (day?.mode !== 'override') throw new Error(`override가 아닙니다: ${date}`);
  const id = newStopId(trip, base, random);
  return {
    ...base,
    days: {
      ...base.days,
      [date]: { ...day, stops: [...day.stops, { id, placeKey }], updatedAt: now },
    },
  };
}
