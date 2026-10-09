import type { EditLayer, PlaceEdit } from 'src/schema/legacy/edit-layer';
import type { Place, TripData } from 'src/schema/legacy/trip-data';

/** 편집 레이어의 분류를 적용한 분류. null이면 미분류. */
export function effectiveCategory(place: Place, edit: PlaceEdit | undefined): string | null {
  const value = edit?.category?.value;
  return typeof value === 'string' ? value : place.category;
}

/** trip.places 전체에 분류 편집을 적용한 새 객체. 입력은 변경하지 않는다. */
export function applyCategoryEdits(trip: TripData, edit: EditLayer | null): TripData['places'] {
  const out: TripData['places'] = {};
  for (const [key, place] of Object.entries(trip.places)) {
    const category = effectiveCategory(place, edit?.places[key]);
    out[key] = category === place.category ? place : { ...place, category };
  }
  return out;
}
