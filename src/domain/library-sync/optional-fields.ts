import type { ItemKind } from './items';

/** 선택 필드는 키 생략으로 지우지 않고 빈 값과 새 시각을 남긴다. */
export const OPTIONAL_FIELD_EMPTY: Record<ItemKind, Record<string, unknown>> = {
  place: { visitedOn: null, review: '' },
  label: { emoji: null },
  trip: { legTransit: [], legMinutes: {}, bookings: [], prepNotes: [], phrases: [] },
  folder: {},
  meeting: {},
};
