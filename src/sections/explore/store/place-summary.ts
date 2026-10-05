import type { EffectiveTrip } from 'src/domain/overlay';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import { dayName } from 'src/sections/itinerary/store/format';

export function categoryEmoji(category: string | null): string {
  const value = category ?? '';
  if (/카페|커피|디저트/.test(value)) return '☕';
  if (/숙박|호텔|펜션|모텔/.test(value)) return '🏨';
  if (/음식|식당|한식|중식|일식|분식/.test(value)) return '🍽️';
  if (/해변|바다|해수욕/.test(value)) return '🌊';
  if (/공원|산|자연/.test(value)) return '🌿';
  return '📍';
}

export type PlaceSummary = {
  placeKey: string;
  name: string;
  category: string;
  emoji: string;
  memoCount: number;
  memoPreview: string;
  dayLabels: string[];
  hidden: boolean;
};

export function summarizePlace(
  trip: TripData,
  edit: EditLayer | null,
  effective: EffectiveTrip,
  placeKey: string,
): PlaceSummary | null {
  if (!Object.hasOwn(trip.places, placeKey)) return null;
  const place = trip.places[placeKey]!;
  const pe = edit?.places[placeKey];
  const mine = edit ? pe?.memos[edit.authorId]?.text : null;
  const user = Object.entries(pe?.memos ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, memo]) => (memo.text === null ? [] : [memo.text]));
  const naver = (place.naverMemos ?? []).map((m) => m.memo);
  const candidates = [mine ?? '', ...user, ...naver];
  return {
    placeKey,
    name: place.name,
    category: place.category ?? '미분류',
    emoji: categoryEmoji(place.category),
    memoCount: user.length + naver.length,
    memoPreview:
      candidates
        .find((text) => text.trim().length > 0)
        ?.replace(/\s+/g, ' ')
        .trim() ?? '',
    dayLabels: effective.days
      .filter((day) => day.stops.some((s) => s.placeKey === placeKey))
      .map((day) => dayName(trip, day.date)),
    hidden: pe?.hidden?.value ?? false,
  };
}
