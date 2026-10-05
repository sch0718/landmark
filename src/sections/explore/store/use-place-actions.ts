import { useStore } from 'jotai';
import { overlay } from 'src/domain/overlay';
import { LIMITS } from 'src/schema/common';
import type { PlaceEdit } from 'src/schema/edit-layer';
import { useEditActions, useTripStore } from 'src/stores/trip-store';
import { addStopToDay } from './add-stop';

export type PlaceActionResult = 'saved' | 'cancelled' | 'limit';

export function usePlaceActions(placeKey: string) {
  const ts = useTripStore();
  const store = useStore();
  const { ensureAuthor, update } = useEditActions();
  const requirePlace = () => {
    const trip = store.get(ts.tripAtom);
    if (!trip || !Object.hasOwn(trip.places, placeKey))
      throw new RangeError('장소를 찾을 수 없어요');
    return trip;
  };
  const patch = async (
    change: (p: PlaceEdit, now: string) => PlaceEdit,
  ): Promise<PlaceActionResult> => {
    requirePlace();
    if (!(await ensureAuthor())) return 'cancelled';
    const now = ts.nowIso();
    await update((e) => ({
      ...e,
      places: { ...e.places, [placeKey]: change(e.places[placeKey] ?? { memos: {} }, now) },
    }));
    return 'saved';
  };
  return {
    async setMemo(text: string | null): Promise<PlaceActionResult> {
      requirePlace();
      const value = text === null ? null : text.trim();
      if (value !== null && (!value || value.length > LIMITS.memoChars))
        throw new RangeError('메모는 1~2000자로 입력하세요');
      if (!(await ensureAuthor())) return 'cancelled';
      const now = ts.nowIso();
      await update((e) => ({
        ...e,
        places: {
          ...e.places,
          [placeKey]: {
            ...(e.places[placeKey] ?? { memos: {} }),
            memos: {
              ...e.places[placeKey]?.memos,
              [e.authorId]: { text: value, updatedAt: now },
            },
          },
        },
      }));
      return 'saved';
    },
    async setTags(tags: string[]): Promise<PlaceActionResult> {
      const values = [...new Set(tags.map((tag) => tag.trim()))];
      if (
        values.length > LIMITS.tagsPerPlace ||
        values.some((t) => !t || t.length > LIMITS.tagChars)
      )
        throw new RangeError('태그 길이 또는 개수 제한을 넘었어요');
      return patch((p, now) => ({ ...p, tags: { value: values, updatedAt: now } }));
    },
    setHidden(value: boolean): Promise<PlaceActionResult> {
      return patch((p, now) => ({ ...p, hidden: { value, updatedAt: now } }));
    },
    async addToDay(date: string): Promise<PlaceActionResult> {
      const trip = requirePlace();
      if (!trip.days.some((day) => day.date === date))
        throw new RangeError('날짜를 찾을 수 없어요');
      if (!(await ensureAuthor())) return 'cancelled';
      let limited = false;
      const now = ts.nowIso();
      await update((e) => {
        const count = overlay(trip, e).days.find((day) => day.date === date)?.stops.length ?? 0;
        if (count >= LIMITS.stopsPerDay) {
          limited = true;
          return e;
        }
        return addStopToDay(trip, e, date, placeKey, now);
      });
      return limited ? 'limit' : 'saved';
    },
  };
}
