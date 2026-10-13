import { useCallback } from 'react';
import { toast } from 'sonner';
import type { LngLat } from 'src/domain/trips/geo';
import { applyAutoSplit, diffTrip, isEmptyChange, reorderDay } from 'src/domain/trips/ops';
import { autoSplit, optimizeOrder, type OptStop } from 'src/domain/trips/optimize';
import { dayEndpoints, visibleCandidates, visibleStops } from 'src/domain/trips/query';
import type { Library, Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { useTripUndo } from 'src/sections/trips/planner/use-trip-undo';

// 순서 정리·Day 자동 나누기(스펙 §2.5)를 화면의 문서에서 계산하는 도우미. 순수 계산은 `domain/trips/optimize.ts`가 한다.

export const OPTIMIZED_MESSAGE = '순서를 정리했어요';
export const ALREADY_SHORTEST_MESSAGE = '이미 가장 짧은 순서예요';
export const SPLIT_APPLIED_MESSAGE = 'Day 자동 나누기를 적용했어요';
export const SPLIT_STALE_MESSAGE = '일정이 바뀌어 미리보기를 닫았어요. 다시 나눠 보세요';

const lngLat = (place: Place): LngLat => [place.lng, place.lat];
const orNull = (place: Place | null): LngLat | null => (place === null ? null : lngLat(place));

/**
 * 한 Day의 순서 정리 결과: 그 Day의 Stop id 전체 순서. 바뀌지 않으면 null.
 * 보관함에서 지운 장소의 Stop은 계산에서 빼고 제 자리에 그대로 둔다(되살리면 원래 자리).
 */
export function optimizedStopIds(lib: Library, trip: Trip, dayIndex: number): string[] | null {
  const day = trip.days[dayIndex];
  if (day === undefined) return null;
  const { start, end } = dayEndpoints(lib, trip, dayIndex);
  const visible = visibleStops(lib, day);
  const result = optimizeOrder({
    start: orNull(start),
    end: orNull(end),
    stops: visible.map((s) => ({
      id: s.id,
      at: lngLat(lib.places[s.placeId]!),
      fixedTime: s.fixedTime,
    })),
  });
  if (!result.changed) return null;
  const queue = [...result.order];
  const shown = new Set(visible.map((s) => s.id));
  return day.stops.value.map((s) => (shown.has(s.id) ? queue.shift()! : s.id));
}

/** 자동 나누기 미리보기: Day마다 둘 장소 id(`applyAutoSplit`의 `plan`). */
export function planAutoSplit(lib: Library, trip: Trip): string[][] {
  return autoSplit({
    candidates: visibleCandidates(lib, trip).map((p) => ({ id: p.id, at: lngLat(p) })),
    days: trip.days.map((day, d) => {
      const { start, end } = dayEndpoints(lib, trip, d);
      const stops: OptStop[] = visibleStops(lib, day).map((s) => ({
        id: s.placeId,
        at: lngLat(lib.places[s.placeId]!),
        fixedTime: s.fixedTime,
      }));
      return { start: orNull(start), end: orNull(end), stops };
    }),
  });
}

/**
 * `순서 정리`: 지금 Day의 순서를 바꾸고 `되돌리기` 토스트를 띄운다. 이미 가장 짧으면 바꾸지 않고 알린다.
 * 계산은 저장 직전 최신본(잠금 안)에서 한다. 그사이 다른 탭이 Stop을 바꿨어도 어긋나지 않는다.
 */
export function useOptimizeDay(tripId: string, dayIndex: number): () => Promise<void> {
  const { run } = useTripUndo(tripId);
  return useCallback(async () => {
    const box = { unchanged: false };
    const result = await run((lib, ctx) => {
      box.unchanged = false; // 저장소가 다시 시도하면 연산이 여러 번 불릴 수 있다
      const trip = lib.trips[tripId];
      if (trip === undefined) return { ok: true, lib };
      const ids = optimizedStopIds(lib, trip, dayIndex);
      if (ids === null) {
        box.unchanged = true;
        return { ok: true, lib };
      }
      return reorderDay(lib, tripId, dayIndex, ids, ctx);
    }, OPTIMIZED_MESSAGE);
    // 저장이 실패했으면(용량 초과 등) 이미 가장 짧다고 알리지 않는다.
    if (result.ok && box.unchanged) toast(ALREADY_SHORTEST_MESSAGE);
  }, [run, tripId, dayIndex]);
}

/**
 * `적용`: 미리보기 결과를 반영하고 `되돌리기` 토스트를 띄운다. `base`는 미리보기를 만든 때의 여행이다.
 * 저장 직전 최신본(잠금 안)이 `base`와 다르면(화면이 다시 읽기 전에 다른 탭이 바꿈) 낡은 plan으로 덮어쓰지 않고
 * 거절한 뒤 다시 나눠 보라고 알린다.
 */
export function useApplyAutoSplit(tripId: string): (plan: string[][], base: Trip) => Promise<void> {
  const { run } = useTripUndo(tripId);
  return useCallback(
    async (plan, base) => {
      const result = await run((lib, ctx) => {
        const latest = lib.trips[tripId];
        if (latest !== undefined && !isEmptyChange(diffTrip(base, latest))) {
          return { ok: false, error: { _tag: 'TripChanged', id: tripId } };
        }
        return applyAutoSplit(lib, tripId, plan, ctx);
      }, SPLIT_APPLIED_MESSAGE);
      if (!result.ok && isTripChanged(result.error)) toast(SPLIT_STALE_MESSAGE);
    },
    [run, tripId],
  );
}

const isTripChanged = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { _tag?: unknown })._tag === 'TripChanged';
