import { importSharedTrip } from 'src/domain/library/import-share-trip';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import type { Library } from 'src/schema/library';
import { LIVE_ID_PATTERN, type LiveTripDoc } from './live-doc';
/** 장소는 기존 가져오기 규칙으로 합치고 새 여행의 Stop 정체성을 보존한다. */
export function importLiveTrip(
  lib: Library,
  doc: LiveTripDoc,
  input: { preferredTripId: string | null },
  ctx: OpCtx,
): OpResult {
  let preferred = input.preferredTripId;
  const result = importSharedTrip(
    lib,
    doc.share,
    { titleLabel: null, appendMemo: false },
    {
      ...ctx,
      newId(kind) {
        if (
          kind === 'trip' &&
          preferred &&
          LIVE_ID_PATTERN.test(preferred) &&
          !Object.hasOwn(lib.trips, preferred)
        ) {
          const id = preferred;
          preferred = null;
          return id;
        }
        return ctx.newId(kind);
      },
    },
  );
  if (!result.ok || !result.createdId) return result;
  const trip = result.lib.trips[result.createdId]!;
  const days = trip.days.map((day, i) => ({
    ...day,
    stops: {
      ...day.stops,
      value:
        day.stops.value.length === doc.ids.stops[i]?.length
          ? day.stops.value.map((stop, j) => ({ ...stop, id: doc.ids.stops[i]![j]! }))
          : day.stops.value,
    },
  }));
  return {
    ...result,
    lib: { ...result.lib, trips: { ...result.lib.trips, [trip.id]: { ...trip, days } } },
  };
}
